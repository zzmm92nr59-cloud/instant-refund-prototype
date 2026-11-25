# Relay security

How Relay's server (the Cloudflare Worker in `worker/`) decides who may do what, limits how often anyone can call it,
checks everything sent to it, and keeps its keys. Each part names the code that does it and the test that proves it.
Written for whoever works on Relay next, person or AI: keep it true when the code changes.

## The ground rules

- **No endpoint takes a shopper's id from the request.** Every `/relay/my/...` route works only on the shopper whose
  session made the request. Someone else's receipt, order or listing looks exactly like one that doesn't exist (404).
- **A purchase at a connected shop belongs to a shopper only when** the shop's order email, hashed with `AUTH_SECRET`,
  equals the shopper's verified email hash (`worker/auth.js`). Nothing else grants it.
- **Sessions are bearer tokens, not cookies.** 43 random characters; Relay stores only their SHA-256 hash. They last 90
  days and are renewed while in use. Because no cookie carries them, another website can't make a signed-in request on a
  shopper's behalf, which is why the API can answer any origin (`Access-Control-Allow-Origin: *`). A few account changes
  (signing out other devices, phone number, two-step sign-in, passkeys) also check the request came from Relay's own app.
- **Keys never reach the browser.** The app's files hold no keys; the server reads every key from Cloudflare secrets.
- **Errors say what happened in a word, never why in detail.** Stripe's, Square's or a shop's own error text stays in
  Relay's logs; the app gets a short code like `stripe_error` and shows its own plain-English message.

## Who can do what

### The callers

| Caller | How Relay knows it's them |
|---|---|
| **Visitor** | Nothing: anyone on the internet. |
| **Shopper** | A session token from signing in (email link or code, Google, Microsoft or a passkey, plus the second step if they turned it on). |
| **Shopper, half-way through two-step sign-in** | A short-lived "pending" token that only finishes signing in. It is not a session. |
| **Relay admin** | A signed-in shopper whose email is in `RELAY_ADMIN_EMAILS`, in a session that passed a second step (below). |
| **App reviewer** | A shopper signed in with the reviewer sign-in (below): a made-up address and a code that stays the same while it's on. |
| **Shop** | The shop's Relay key (`rk_...`), given when the shop connects with Square or Shopify (or opens Relay inside Shopify admin). Relay keeps only a keyed hash of it. |
| **Shopify, Square** | Webhooks signed with the shared secret (HMAC); unsigned or wrongly signed ones are refused. |
| **Google (Gmail notices)** | `/relay/webhooks/gmail`: a token Google signs for the Pub/Sub subscription's service account (OpenID Connect, RS256), checked against Google's published keys, Relay's own address as the audience, `GMAIL_PUSH_SERVICE_ACCOUNT`, and its dates. Anything else is refused (401). `worker/mail-push.js`. |
| **Microsoft (Outlook notices)** | `/relay/webhooks/outlook` and `/outlook/lifecycle`: each notice must carry the secret (`clientState`) Relay chose for that subscription. Relay keeps only its SHA-256 hash; a notice without it is ignored. |
| **Relay's scheduled jobs** | Cloudflare's cron triggers. They aren't reachable over the web at all. |

### Two-step sign-in for everyone

With `SECOND_STEP_REQUIRED = "on"` (worker/wrangler.toml; `worker/second-step.js`):

- Every account needs a second step: an authenticator app, codes by text, or a passkey (Face ID, Touch ID or the phone's screen lock). The shared app-reviewer account is the exception, because nothing personal can be attached to it.
- Until an account has a second step, a signed-in shopper can only do these: set one up (`/relay/my/2fa…`, `/relay/my/passkeys…`, `/relay/my/phone…`), see `/relay/me`, `/relay/my/second-step`, their profile, the email permission and `/relay/my/admin/me`, sign out, sign other devices out, or delete the account. Everything else answers `403 {"error":"second_step_needed"}`, and the app asks them to set one up.
- A Google or Microsoft sign-in is tied to the browser that started it by a secret only that browser holds (its nonce; the server keeps its hash). Whoever starts a sign-in chooses that secret and could send Google's genuine link to somebody else, so the secret alone never finishes a sign-in (`worker/auth.js`):
  - `/relay/auth/verify` finishes it only with the one-time token Google or Microsoft sent the browser back with **and** the secret: the same browser started and came back. An inbox agreed to on the sign-in screen is connected only this way (or the next).
  - The iPhone home-screen app's Google page comes back in a separate browser. If that browser holds the secret too (it shares the app's storage), it says so with `/relay/auth/confirm` (token and secret), and the app then collects the sign-in with `/relay/auth/claim` (the secret).
  - If the browser that came back doesn't hold the secret, `/relay/auth/verify` answers `confirm_needed` with a 6-character code (worked out from the secret's hash; `/start` gives the app the same one to show). The page shows it, says "Only continue if the Relay app on your phone shows this same code. If someone sent you this link, close this page.", and nothing happens until the person taps Continue (`/relay/auth/confirm` with `agree`) or "This wasn't me" (`deny`, which cancels it). A sign-in confirmed this way **never connects an inbox or records the agreement**: the inbox key that was waiting is deleted, and the app asks to connect it once signed in.
  - Times: 5 minutes to finish or confirm after coming back; once confirmed, 2 minutes for the app to claim it, once. `/start`, `/confirm` and `/claim` answer only Relay's own app (an allowed `Origin` must be sent; Relay's app is a web page wherever it runs, so it always is). All are counted with sign-in (30 a minute from one address).
  - Known limit: someone talked into tapping Continue on that page, by a person who sent them the link, lets that person in as far as the second step (never to their inbox through this). The page's wording, the code and "This wasn't me" are what stand in the way. **Proved by** `scripts/test-signin-claim.mjs` and `scripts/test-signup-ui.mjs`.
- Signing in with an email link or code, Google or Microsoft then always asks for the second step. That's a code, or, when the account's only second step is a passkey, the passkey itself (a passkey sign-in is complete on its own). A mailbox connected while signing in waits for that step.
- A session records whether it passed a second step (`auth_sessions.second_step`). It counts as passed after a passkey sign-in, after a code at sign-in, or when the account's first second step was set up in that session. Adding another way later doesn't change any session.
- Once an account has a second step, a session that never passed one is over. Setting up the account's first second step ends its other sessions there and then (whether or not two-step is required). And while it's required, a session that never passed one, on an account that has one, is ended the next time it's used: every route but signing out answers `401 {"error":"sign_in_again"}`, the session is deleted, and the app asks for a fresh sign-in (which asks for the second step). So someone who got in with the first step alone can't stay in, or add a way in of their own, after the owner turns two-step on.
- Relay's team tools need a session that passed a second step. An admin whose account has no second step yet gets `signInAgain` from `/relay/my/admin/me` and sets one up; with two-step not required, an unchecked admin session gets every admin route answered as if it didn't exist.
- While it's required, the last second step can't be turned off or removed (`409 {"error":"last_second_step"}`). Another has to be added first.
- Setting a second step up, turning it off or removing a passkey emails the account, as before (`security-mail.js`). Forced set-up has one known limit: someone who gets into an inbox before its owner has set up a second step could set up their own (which signs the owner's devices out). The owner is emailed when that happens.
- **Proved by** `scripts/test-second-step.mjs` and `scripts/test-second-step-ui.mjs`.

### What each caller can do

"Own" means the caller's own records only. Blank means no access: the route answers "not signed in" (401), or "not
found" (404) where even saying it exists would tell too much.

| Resource | Visitor | Shopper | Relay admin | Shop | Shopify / Square | Scheduled jobs |
|---|---|---|---|---|---|---|
| Sign in, sign out | Start and finish sign-in (a Google or Microsoft sign-in that came back in another browser: `/relay/auth/confirm` with its one-time token, and the starting browser's secret, `agree` or `deny`; `/relay/auth/claim` with the secret, only after that; see "Two-step sign-in for everyone"). Email codes: 5 guesses a code, counted in the same step that lets a guess through, then the code is cancelled; only the newest code for an address works; start a sign-in to approve from a phone (`/relay/auth/phone/start`: a short code to show and a 43-character poll token only that device holds; 5 minutes; at most 5 live per address) and ask whether it was approved (`/relay/auth/phone/check`, with the poll token: a session once, for the account that approved it) | Sign out; sign out other devices; approve a sign-in on another device by its code (`/relay/my/devices/look` says which kind of device, `/relay/my/devices/approve` approves it: Relay's own app only, 8 wrong codes per 15 minutes per account, an email to the shopper; the new session passes the second step only if the approving one had) | As a shopper | | | Tidy old text-message records |
| Account (email, name, photo, passkeys, two-step, phone) | | Own: read, change, delete the whole account, download a copy | As a shopper | | | |
| Email connections (Gmail, Outlook) | | Own: connect up to 5, connect one of them again when its access has ended (same place, same receipts), disconnect, withdraw permission | As a shopper | | Google and Microsoft (not Shopify or Square): say that a connected inbox has new mail (signed, or with the subscription's secret), which makes Relay read that inbox's newest mail with the usual reader. A notice says which inbox, never anything about an email | Read connected inboxes for new receipts (every 15 min); set up and renew each inbox's Gmail watch or Outlook subscription; read inboxes whose notices are waiting |
| Receipts and their pictures | | Own: list, add (search, paste: the copied text, and the copied page as HTML when the clipboard has it, `html`; read with the same reader and totals check as an email, and only what was read is kept), confirm, hide, change category, mark which items of an order are going back (`/relay/my/receipts/<id>/items`: only positions on their own receipt and "returning" or nothing; it answers with that receipt's own marks and return timeline, someone else's receipt answers 404), tag as a gift (and who for), fix what was read wrong, add their own photo of the item (or take it away), reminders, open the original email | As a shopper | | | Return reminders |
| Purchases at connected shops | | Own (matched by verified email hash): list (orders from Relay's own test shops, Square's sandbox and Shopify development stores, only with `?test=1`, which the app sends only with its testing tools on), return, swap. Swap with another shop (`/relay/my/cross-swap`): starts the return at the first shop, after the second shop's own Shopify confirms the item is for sale at the price the shopper agreed; answers with the second shop's checkout link, which carries nothing about the shopper. Relay places no order and takes no money. Real shops only swap with real shops, test shops with test shops, and only to a shop that tells Relay about its paid orders. The second shop's order is matched only by the shopper's own verified email. The shopper can stop their own swap while it waits (`/relay/my/cross-swap/<id>/cancel`); the return goes ahead | As a shopper | Sees counts only, never who | Shopify reports paid orders and refunds (signed), and asks for erasure | Catch up Square orders and refunds; erase a shop's orders 30 days after it removed Relay if Shopify's erase request never came |
| Interests: what the shopper shops for (`/relay/my/interests`) | | Own: read, change (up to 12 from a fixed list; anything else refused). Used only to put matching shops first in Browse. Kept with the account, in Download my data, deleted with the account | As a shopper | | | |
| First-run tips seen (`/relay/my/tips`) | | Own: read, change (which of the four tips, Home, Ask, Browse and Receipts, they've seen; anything else refused). Used only so each tip shows once. Kept with the account, in Download my data, deleted with the account | As a shopper | | | |
| Shopping bag (`/relay/my/bag`, `/relay/my/bag/paid`, `/relay/my/bag/check`; `worker/bag.js`) | | Own: read; add a product or change how many (1 to 10 each, 30 things at most), take one out; say they finished paying at a shop (`shop`), which takes that shop's things out. Only a product Relay shows can go in (`sku`): what's kept for it (name, size or colour, price, picture, shop) comes from Relay's own copy of the shop's catalogue, never from the app; a test shop's product, or one Relay doesn't know, answers 404. Check a shop's prices before paying (60 a day): for a shop connected to Relay its own Shopify is asked, for a shop's website its public product data (`/products/<handle>.js`) at the address Relay keeps, only while its robots.txt allowed Relay when last read; nothing about the shopper is sent. Relay moves no money: the app opens the shop's own checkout with the things in its basket. Kept with the account, in Download my data, deleted with the account | As a shopper | | | |
| Delivery details and shops' checkouts (`/relay/my/delivery`, `/relay/my/delivery/remove`, `/relay/my/web-checkout`, `/relay/my/address-lookup`) | | Own: find the addresses at a UK postcode (Find address: only the postcode goes to Ideal Postcodes; 20 lookups a day each and 400 a day across everyone, counted without the postcode and kept two days; off until `IDEAL_POSTCODES_KEY` is set); keep one UK delivery address (name, address, postcode, a phone number for the courier), change it, remove it. Start a checkout at a shop in Relay's own list of shops' websites (`worker/web-shops.js`), never an address the app sends: that shop gets the shopper's email and address so its checkout is filled in, and the shopper pays there (40 a day; each one noted, and listed in Download my data). Relay never takes payment | As a shopper | | | |
| Relay's agent profile for shops' checkouts (`/.well-known/ucp`) | Read: what Relay takes part in at shops' checkouts (checkout, delivery details). Nothing about anyone | Read | Read | Read | Read | |
| Auctions (`/relay/auctions`, `/relay/auctions/<id>`, its photos, `/relay/my/auctions`, `/relay/my/auctions/bid`, `/relay/retailer/auctions`) | Read live auctions and their photos (test shops' only with `?test=1`, which the app sends only with its testing tools on). Never who's bidding or anyone's maximum | Own: the auctions they bid on, with their own maximum, and anything they won, with the shop's own link to pay it. Bid: needs delivery details (the shop sends it there); two unpaid wins in 90 days pause bidding for 30 days (an unpaid win at one of Relay's own test shops doesn't count) | As a shopper | Own shop only, Shopify shops that let Relay create orders (`write_orders`): start an auction for an item in its own catalogue or a one-off with up to 4 photos (checked by their bytes, served as what they really are), lasting a day to a week, cancel one nobody has bid on, see prices, bid counts and outcomes with links to its own orders. Never who bid. Relay's own test shops (Shopify development stores) can also start one lasting 10 minutes (`minutes`): the dashboard is offered it only when the server says the shop is one, and the server refuses it from any other shop | | Every minute (`auctions.js`): end auctions that are due; make the winner's order in the shop's own Shopify, unpaid, with their email and delivery details at the winning price plus the shop's delivery price; ask Shopify whether it's paid; after 24 hours unpaid, cancel that order (stock goes back) and offer it to the next bidder; 90 days after an auction ends, delete its bidders' maximums and photos. Relay never takes or holds the money |
| Card on file (Stripe) | | Own: add, remove. Relay keeps Stripe's reference, the brand, last 4 digits and expiry, never the card number | As a shopper | | | |
| Price alerts and phone notifications | | Own: watch items or shops, choose alert mode, turn notifications on and off | As a shopper | Sends an offer to its own watchers, without learning who they are | Catalogue changes (signed) | Compare prices, send alerts |
| Resale listings | Nothing | List items from own receipts, with up to 4 of their own photos (seen by members while the listing is active, and by the seller); browse others' listings, shown only as "Member"; report a listing they can see that isn't their own (`/relay/my/resale/listings/<id>/report`, with what's wrong; one report per listing, 10 a day; the listing then stops showing to them); change their own listing while it's on sale (`/relay/my/resale/listings/<id>/edit`: price or open to offers, condition, note, a new set of up to 4 photos or none; never the title or shop, which come from the receipt; anyone else's listing, or one no longer on sale, answers "not found") | As a shopper; reviews reported listings, seeing the listing as members do, never who listed or reported it: dismiss, take the listing down, block the member | | | |
| Resale listing help (`/relay/my/resale/items` defaults, `/relay/my/resale/describe`) | | Own only. With their listable items, what Relay fills a new listing in with (`defaults`): the area for collection is only the first half of the postcode in their own delivery details (`SW11`, never the rest of the address, the street, their name or phone), or else the area of their last listing; how they hand things over and whether they're open to swaps, from their last listing. Each item also says its size and colour when the shop's email labelled them, and whether the receipt's photo is the item's (an order of one thing). A description written by AI (`/relay/my/resale/describe`: `receiptId`, `itemIndex`; only an item on a receipt of their own that can be resold, anything else answers "not found"; not when Relay's team has blocked them): only the item's name, the shop and its labelled size and colour go to Anthropic, never a price, order number, address or anything about the member; 20 a day each (only the daily count is kept, two days, deleted with the account), inside Relay's monthly AI limit (`ai-spend.js`, as `listing_text`). With no key, with AI help switched off by the member (`ai_choices` feature `receipts`), past the limit or when Anthropic can't answer, the answer is `description: null`, nothing is sent and the box stays empty. The app marks the text "Written by AI" until the member changes it, and nothing is listed until they tap Put it on Relay | As a shopper | | | |
| Resale conversations (`/relay/my/resale/conversations`) | | Own only: every conversation they're in, as buyer or seller, newest first (a request with a message, or an accepted one), with the item's name and shop, "Buyer" or "Seller" (never who), the last message's first 140 characters, how many they haven't read, and the listing's picture only where the picture route already lets them see it (on sale, or their own). No fields | As a shopper | | | |
| Resale requests and messages | | Only the two members in a conversation; report one. Any member can start their own chat with the seller about a listing on sale before asking for it (`/relay/my/resale/listings/<id>/chat`: no fields; not their own listing; not when either has blocked the other, or Relay's team has blocked them; counts toward the 30 requests a day; asking for the item later carries on in the same conversation). Several members can each chat with the seller about one listing, each only in their own. A conversation is open while the item is on sale, and after it's matched only for the member it went to: the others stay readable, say the item has gone, and refuse new messages (`item_gone`). Only someone who asked to buy or swap can be accepted, never a chat on its own. How many requests on their own listings they haven't seen and messages they haven't read (`/relay/my/resale/news`, and in `/relay/my/resale/mine`, which with `?seen=1` marks their requests seen; reading a conversation marks it read); a phone notification, on devices they turned notifications on for, for a new request on their listing or the first new message in a conversation since they last read it (the item's name only, never the other member's words or who they are). The member who asked is told the seller's answer the same ways: the seller accepted, declined, or accepted another member's request for the item (that last one also for a member chatting with the seller about it who had written something). It's kept on their own request (`outcome`), counted for them alone until they open Yours (`?seen=1`) or that conversation (`answers` in `/relay/my/resale/news`), said in the conversation, and sent as one phone notification each on devices they turned notifications on for: the item's name and the answer only, never who the seller or the other member is, and never that anything was paid for or sent (Relay takes no payment). Accept and decline still take no fields, and only the listing's seller can answer. Block the other member of a request or conversation (`/relay/my/resale/requests/<id>/block`): every conversation between them ends, requests between them are declined, and neither sees or can ask about the other's listings; the blocker sees only the item it was about (`/relay/my/resale/blocks`), never who, and can unblock (`/relay/my/resale/blocks/<id>/remove`, their own blocks only). The blocked member is never told. Separate from reports and from the team's block | Reviews reported conversations, without seeing who the members are; dismiss, remove a listing, block a member | | | |
| In-shop purchases (Square) | | Own: claim a card payment from a receipt; answer "is this yours?" | As a shopper | | | Suggest new in-shop payments to their owners |
| Shop figures | | | | Own shop only: how many watch each item, offers sent, results. Counts under 3 show as "fewer than 3" | | |
| Shop settings (payments, Royal Mail labels, returns period and how to send items back: `/relay/retailer/returns`) | | | | Own shop only. The Royal Mail key is stored encrypted and never sent back. The returns period (1 to 365 days) and the shop's own instructions (up to 600 characters) are shown to that shop's customers as plain text | | |
| Catalogue (products, prices, stock) | Read (public product data) | Read | Read | Kept in the shop's own Square or Shopify | Report product and stock changes (signed) | Refresh it |
| List of connected shops | Read names | Read | Read | | | |
| Shopify status (`/relay/shopify/status`) | Read: how many shops are connected and published, the published shops' names (as Browse shows them), whether paid-order notices are set up, and the last catalogue sync's time, outcome and totals. Never a shop's `myshopify.com` address, any one shop's order counts, or error text | Read | Each shop's latest order catch-up (counts, whether it failed) and notice set-up, on the health page (`shopifyDetail` in `/relay/my/admin/health`); the error text itself stays in the logs | | | |
| Shops' websites, a catalogue preview (`/relay/web-shops`) | Read: public product details that shops publish on their own websites, and how each website answered. The app asks for it only in Relay's testing tools | Read | Read | | | Every minute: up to 2 shops due, each about once a day, read as RelayBot (`relaybot.html`) only where the shop's robots.txt allows it; pounds and UK delivery only; products hidden 3 days after they were read (`worker/web-shops.js`) |
| Their own Outlook inbox, searched by Relay's team (`GET /relay/my/outlook/search`, `GET /relay/my/outlook/message/<id>`; `worker/outlook-search.js`) | | | Own connected Outlook only (the admin's own `gmail_connections` rows; nothing in the request names an account, an address or a shopper, and `inbox` is only a number 1 to 5 among their own; a cursor can only page `/me/messages` with their own token). Search (`q` up to 200 characters, no quotes or backslashes; `after`, `before` as YYYY-MM-DD; `cursor`; `inbox`; anything else refused): 50 a page, each with Outlook's id, the sender's name and address, subject, date received, whether Relay already has a receipt from it (by its Message-ID or `outlookId`) and what Relay read it as; never a body or preview. Sent Items, Drafts, Deleted Items and Outbox left out; Junk searched and marked. Read one email of their own, cleaned exactly as "View original email" (`original.js`), with its plain text. Microsoft Graph only with GET (never send, move, mark read or delete). 20 searches and 30 emails a minute, 400 and 600 a day, per admin (`outlook_search_uses`: only when, kept 2 days, in Download my data, deleted with the account), on top of the mailbox allowance. Nothing from an email is kept or logged | | | |
| Reviewer sign-in (`/relay/my/admin/review-account`) | | | Turn on (a new address and code), see the address and code, turn off (deletes the account) | | | |
| Testers (`/relay/my/admin/testers`) | | Learn only whether they are one (`tester` in `/relay/my/admin/me`); a tester's Browse shows shops' own websites, nothing else changes | List, add and remove testers by email (100 at most) | | | |
| Help chat (`/relay/my/help/chat`, `/relay/my/help/handoff`) | | Own: ask the assistant (60 messages a day; 3,000 a day across everyone), and show it one of their own receipts when they choose (`receiptId`: what Relay read, never the email, no order number, address or tracking; anyone else's receipt answers 404). Send the chat to Relay's team (5 a day). Relay keeps no copy of the chat, only daily counts | As a shopper (300 messages a day) | | | |
| Emails sent to Relay (`/relay/my/receipts/<id>/share`, `/relay/my/admin/shared-emails`) | | Own receipts from an inbox only: see exactly what would be sent (details hidden), send it with a note (10 a day, 30 kept at once), delete it | List them without their text; read one (each opening recorded in `audit_events`; never who sent it); delete one | | | Delete them 30 days after they were sent |
| Read it again (`/relay/my/receipts/<id>/reread`, no body) | | Own receipts from an inbox only (anyone else's answers 404; a pasted one 409), and only on the shopper's tap, which is the consent for that one email: that email is read again from its inbox with the rules (every reading tried on both parts). If its items still don't add up to the email's own totals (`itemsCheck`) and `ANTHROPIC_API_KEY` is set, the order section only (from just above the first amount to the total), with personal details hidden (`hideDetails`: names, addresses, postcodes, phones, email addresses, card and long numbers, links), goes to Anthropic; what comes back is kept only when its items add up to the email's own totals. 20 a shopper a day (`REREADS_PER_DAY`), of which 10 may go to the AI (`REREAD_AI_PER_DAY`), 1,000 AI reads a day across Relay; counted against the mailbox allowance (`limits.js`) | As a shopper | | | Only counts are kept (`receipt_rereads`: shopper, receipt, when, whether the AI was asked, how it ended), deleted with the receipt, the inbox, the permission or the account |
| AI help (`/relay/my/ai-reading`) | | Own: read whether it's on and their own choice; switch off and on (off deletes what the AI read). On for every shopper unless they switched it off (since 24 Nov 2026; the choice is kept per shopper and feature in `ai_choices`, worker/ai-choice.js, and goes only with the account). Off for everyone until `ANTHROPIC_API_KEY` is set | As a shopper | | | Every hour: up to 20 receipts the rules weren't sure about (not high confidence, no total, no items, items that don't add up, doubtful names, no shop name), from shoppers who haven't switched it off (40 a shopper and 1,500 in all a day), sent to Anthropic with personal details hidden. An email is sent once per `AI_READ_VERSION`: when Relay's own reader version changes, the stored AI reading is compared again, never re-sent |
| AI notice (`/relay/my/ai-notice`, no body; `aiNotice` on `GET /relay/my/profile`) | | Own: `GET /relay/my/profile` says `aiNotice: true` while the one-time "AI help is now on" notice is due (AI is available, the shopper hasn't seen it and hasn't made an AI choice of their own); `POST` marks it seen | As a shopper | | | `ai_notice_seen`: shopper and when, deleted with the account |
| AI spending limits (worker/ai-spend.js; no route of its own) | | Every call to Anthropic, from any feature, is checked first against `AI_MONTHLY_LIMIT_PENCE` (default 2000, £20 a calendar month) and, for reading one shopper's receipts (AI help, Read it again, receipt photos), `AI_SHOPPER_DAY_LIMIT_PENCE` (default 10p a day), as if it used all of its `max_tokens`. Past a limit the feature works as it does without the key until the next month or day | System | | | `ai_spend`: per month and feature, calls, tokens in and out, estimated pence (no shopper, nothing read). `ai_spend_shopper`: per shopper per day, calls and pence only, deleted after two days or with the account. Shown to Relay's team on the health page ("AI spending") |
| AI for picks (`/relay/my/item-kinds`, also used when `/relay/my/wrapped` opens) | | Own: switch off and on (on for every shopper unless they switched it off, `ai_choices` feature `picks`; off deletes what the AI said for them, `item_kinds`, and Relay stops using AI answers for their receipts); read what the AI made of their own item names. Off for everyone until `ANTHROPIC_API_KEY` is set | As a shopper | | | When the shopper opens picks or Wrapped: up to 40 item names (120 a day) not read before, with the shop's name, sent to Anthropic with anything personal hidden; the AI says what each thing is (worker/item-kind-core.js's fixed list, and whether it is sure) and what picks should follow. Never the email, address, order number or price. Only a sure answer is used, and only for that shopper's own receipts while it's on. A name with nothing hidden in it is also kept in `item_kind_cache` (name and answer only: no shopper, shop, date or price), so the same name isn't sent again for another shopper with it on; a name that had anything hidden is never kept there |
| Shop kinds (asked from `/relay/my/wrapped`) | | Nothing to switch: shared, not personal. Off for everyone until `ANTHROPIC_API_KEY` is set (or `AI_READER=off`) | As a shopper (when they open Wrapped) | | | Only for shops Relay doesn't know whose names don't say clearly what they sell (worker/shop-kind.js) and whose receipts' items don't either: up to 12 shops' names and web addresses a time, never a forwarded receipt's sender, a person's name, the shopper, items or prices. The answer is kept per shop in `shop_kinds` (shop key, kind, when), asked once per shop ever, and used only as a hint when nothing better says |
| Bank and cards (`/relay/my/bank`, `/connect`, `/sync`, `/payments`, `/disconnect`; `/relay/bank/callback`) | | Own: connect a bank or card on the bank's own page (read-only scopes: info, accounts, balance, cards, transactions, offline access), read own payments and their matches, disconnect (deletes the connection and its payments). Off until `TRUELAYER_CLIENT_ID` and `TRUELAYER_CLIENT_SECRET` are set; team and testers only, on test banks or real ones (`TRUELAYER_ENV` = `live`), until `BANK_FOR_EVERYONE` is `on` | As a shopper | | | The callback takes a single-use state (15 minutes) tied to the shopper who started; tokens kept encrypted; read at most every 10 minutes; payments kept 13 months (money in on those cards and accounts too: used only to show a refund arriving on a return Relay already knows of, never listed, matched as a purchase or counted), each with TrueLayer's own label for it (`transaction_classification`, such as Shopping, Clothing), which is in Download my data and deleted with the payment. `/connect` may name one of Relay's listed banks (`bank`, one of `BANK_CHOICES`); its TrueLayer id is taken from TrueLayer's public list of banks for Relay's app (read with only the app's public id, kept an hour), never from the request; `GET /relay/my/bank` says which of those banks that list has (`choices`), nothing about anyone |
| Which cards are yours (`/relay/my/bank/cards`) | | Own: say which of one of their own connection's cards and accounts are theirs (`cards`, each by the `ref` `GET /relay/my/bank` gave it), and change it any time. A connection listing more than one asks before any payment is read; one alone is theirs without asking. A card that isn't theirs is never read, kept, shown, matched or counted, and ticking it off deletes the payments read from it and what was said about them. A card whose payments say which card each was on (TrueLayer's `meta.cardNumber` or Amex's `meta.supplementary_card_id`) is split into a choice a card; with neither, nothing is guessed and an Amex connection says Relay can't tell them apart. Payments read before this (no card) are given the card they were saved under; one Relay can't place is never shown, matched, counted or exported (`visibleSql`), and one saved under a card that isn't theirs, or under one that turned out to be several cards, is deleted | As a shopper | | | Only their own connections (someone else's connection, or a ref from another connection, answers 404); an answer is carried only to the same shopper's own new connection of the same card (TrueLayer's account id, or the same bank and last four digits), never to anyone else; in Download my data; deleted with the bank and the account |
| Not mine (`/relay/my/bank/not-mine`) | | Own: mark one of their own payments (or every payment from that shop) as not theirs, or theirs again; or say one wasn't a shop purchase (`reason: "no_receipt"`), so Relay stops asking for its receipt | As a shopper | | | Only payments read from their own connections; left out of matching (not for "wasn't a shop purchase"); in Download my data; deleted with the bank and the account |
| Receipt photos (`/relay/my/bank/receipt-photo`, `/relay/my/receipts/<id>/receipt-photo`) | | Own: which of their own payments likely should have a receipt and don't (`needsReceipt` on `/relay/my/bank/payments`; the newest also come with `/relay/my/receipts` for Home); add a photo of the paper receipt for one of their own payments (someone else's answers 404), at most 1.1 MB, checked by its bytes, 20 a day; see that photo again. Relay makes a receipt from it, linked to that payment and marked "Receipt from your photo", never as the shop's own: with `ANTHROPIC_API_KEY` set, the photo alone (nothing about the shopper or the payment) goes to Anthropic, which reads the shop, date, items and total (1,000 a day across Relay); otherwise, or when it can't, only the bank's shop, amount and date, with no items. A total that isn't what the bank paid is kept and shown beside it | As a shopper | | | The photo is kept with the receipt; deleted when the shopper removes the receipt, withdraws email permission or deletes the account. Disconnecting a bank or an inbox keeps it |
| Codes to show or scan (`/relay/my/receipts/<id>/codes/<n>`, no body) | | Own receipts only: the picture of a barcode or QR code Relay kept from their own email (a return in store, a return dropped off, a collection, a ticket), as number `n` in that receipt's `codes` in `/relay/my/receipts` (what it is for, the shop's words, any date the email states, whether a picture was kept; never the picture or its address). Anyone else's receipt, or a code that isn't on that receipt, answers 404. Served as the type its bytes are (PNG, GIF, JPEG or WebP, never SVG), `nosniff`, private | As a shopper | | | Found when the shopper's own inbox is read (`worker/scan-codes.js`), only where the email says what the code is for; never an app-download code, a PIN, an eSIM's install code, a building pass, a marketing code or one printed elsewhere. The picture is fetched once, then: https and a public host name only, nothing of the shopper's sent (no cookie, no key), 300 KB and 6 seconds at most; its address is never kept. A code joins a receipt only by its own email or the order number and shop its email names (one receipt, or none). In Download my data; deleted with the receipt, its inbox, the permission or the account (`receipt_codes`) |
| Same order or different orders (`/relay/my/receipts/<id>/join`) | | Own receipts only (anyone else's, as either receipt, answers 404): see a short list of their own receipts likely to be the same order (GET); say this receipt is the same order as one of them (`action: "same"`, `with`), that a receipt made of several emails is different orders (`action: "apart"`), or undo either (`action: "undo"`, `kind`). Kept by the emails' ids and applied after the reader's joining every time receipts are listed, so a re-read never undoes it | As a shopper | | | Each choice keeps only the emails' ids, the kind, the shop's web address and the reader's version (`receipt_joins`), never anything from the email; Relay health counts them by shop. Deleted with the receipt, its inbox, the permission or the account |
| Live parcel tracking (`/relay/my/receipts/<id>/parcel`) | | Own: where a parcel on their own receipt is, from the carrier. Off until `SHIP24_API_KEY` is set | As a shopper | | | Only when they open a purchase not yet delivered, ordered in the last 30 days. Only the tracking number (and "GB") goes to Ship24. 10 new parcels a month for all of Relay (`PARCEL_TRACKS_PER_MONTH`), 3 per shopper, shared with return parcels (below); looked up again at most every 2 hours, never once delivered. Deleted with the inbox, the permission or the account |
| Return tracking (`/relay/my/receipts/<id>/return-sent`, `/relay/my/receipts/<id>/return-parcel`) | | Own receipts only (anyone else's answers 404): say "I've sent it back" (`trackingNumber`, `carrier` from Relay's list, `sentOn`, or `undo`; 10 saves a receipt a day, 300 receipts at most); see where the return has got to on the receipt (`returnTracking`, `returnInTransit`, `returnReceived` in `/relay/my/receipts`). `return-parcel` asks Ship24 about the return parcel, off until `SHIP24_API_KEY` is set | As a shopper | | | Carriers' and shops' return emails are read from the shopper's own inboxes and matched only to that shopper's own receipts (`worker/return-tracking.js`): the tracking number, else shop and order number, else shop, refund amount and a 120-day window, else shop and window with exactly one return started; never a guess. Ship24 only when they open that receipt, only with a tracking number, only before the shop has it, only for a return sent in the last 30 days; only the tracking number (and "GB") goes to it, counted in the same 10 a month and 3 per shopper as deliveries. A return step is read from an email only when the email says it has happened (never "once you've dropped it off" or "we'll process your refund"). A refund is also shown when money in on the shopper's own bank payments names the shop and fits the amount, only on a return Relay already knows of, never a guess between two, and never enough to confirm the parcel was sent or received. A step nobody told Relay about is not ticked. What they typed (`return_tracks`) is in Download my data and deleted with the receipt's inbox, the permission or the account |
| Search by photo (`/relay/my/photo-search`) | | Own: ask whether it's on; search with a picture (30 a day each, 2,000 a day across everyone). The picture goes to Anthropic with public product details of shops on Relay (test shops only for the testing tools; shops' websites for the testing tools or the team's preview switch), never anything about the shopper. Relay keeps neither the picture nor the answer, only when each search happened, for 2 days. Off for everyone until `ANTHROPIC_API_KEY` is set | As a shopper | | | |
| Relay health (`/relay/my/admin/health`) | | | Read counts of how well emails are read and how the app is used: never anything from a single receipt; a shop is named only once 3 or more shoppers have receipts from it; the admin's own receipts by shop. Likely reading problems by shop (likely duplicates, items that don't add up, no order number, no total, and how many shoppers said "same order" or "different orders"), as counts with the same naming rule, the rest counted together. Orders from connected Shopify shops are checked against what was read from the same shopper's own emails about them (never anyone else's), shown as counts, with only the admin's own orders in detail. Email the summary to yourself (`/relay/my/admin/health/email`, no body, once in 5 minutes); every admin gets it each morning, and alerts when something breaks | | | |
| Testing tools (`/relay/my/testing/...`) | | Square's sandbox test shop only: off when Square is live; 5 test orders a day. Shopify test orders (`/relay/my/testing/shopify-order`): only at shops Shopify says are development stores and that let Relay create orders, under the tester's own email, marked as a test, no receipt email; 5 a day | | | | |
| Prototype test routes (`/relay/test-lab`, `/relay/live-test`, `/relay/ledger/...` and others) | Off: "not found" | Off | Off | Off | | |

The **app reviewer** can do what any shopper can, on its own account, except attach anything personal: connecting an
inbox, adding a passkey, two-step sign-in, a phone number, a card, a delivery address or a bid in an auction answer `403 {"error":"not_for_review_account"}`.

### Return facts for instant refunds (nothing pays out yet)

Each receipt in `/relay/my/receipts` carries the facts a future Plus instant refund can rely on; on the server,
`returnFactsFor(env, shopperId, receiptId)` in `worker/gmail.js` gives them for one of that shopper's own receipts (null for
anyone else's), and `returnFacts(card)` in `worker/return-tracking.js` for a receipt already read. The full list, with
where each comes from, is in [RETURN_TRACKING.md](RETURN_TRACKING.md):

- `onItsWay`: the one fact to pay on. null until a carrier (its tracking through Ship24, or its own email) or the shop's
  own email confirmed the parcel left the shopper; then who said so, how, the day, and the time of the carrier's first
  scan when its tracking gave one.
- `returnInTransit`: confirmed on its way, and nobody has said it arrived.
- `returnReceived`: the shop's own email said it has the return (or has refunded it), or the carrier said it delivered the
  return parcel to the shop.

All are false or null on the shopper's word alone ("I've sent it back", even with a tracking number): that is shown on the
receipt as "You said" but never makes a fact true. Neither does a label being made, a carrier's expected delivery day, or a
bank payment that looks like the refund. `confirmedBy` says who confirmed the latest of them (`carrier` or `shop`, the name,
the day, `via` tracking or email). Only emails from the shopper's own inboxes are used, a carrier is recognised by its own
sending domain (never a display name), a step is read only when the email says it has happened, and an email that could
belong to more than one of their receipts is left out. A tracking number the shopper typed never turns a carrier's ordinary
parcel email into this return's news: only the carrier's or shop's email about a return with that number, dated on or after
the day they said they sent it and naming no other shop, or the carrier's tracking with a first scan on or after that day.
A number on one of their purchases' deliveries is never a return's. A refund email counts only when it says the refund was
made: declined, refused, pending, requested or "being processed" never does (being processed is kept as `refunding`, which
makes no fact). A return email joins an order only by its number and its shop together. No route moves money on these facts: an instant-refund route, when
built, must read them on the server (never from the app) and needs its own row above.

The prototype test routes are switched off by `worker/legacy-routes.js`. They take no sign-in and some place test payments
on Relay's Square sandbox account. To use the "Existing API and verification tools" testing page again, set
`LEGACY_TEST_ROUTES = "on"` under `[vars]` in `worker/wrangler.toml`, deploy, and set it back to `"off"` afterwards.

**Proved by** `scripts/test-access-control.mjs`. It tries every route the server's code mentions as each kind of caller:
no session, a made-up one, a malformed one, a shop's key, an admin route as a shopper, someone else's receipt, unsigned
webhooks. Ownership of purchases, swaps, returns, resale and inboxes is also tested in `test-auth`, `test-exchange`,
`test-cross-swap`, `test-square-orders`, `test-resale`, `test-resale-admin`, `test-more-inboxes` and `test-retailer`.
Resale is also tested end to end in `test-marketplace-e2e`: the real app in a browser against the server's own code run
locally (`scripts/local-worker.mjs`), where a third member tries every listing, request and conversation route that isn't theirs.

## The shop directory (not personal data)

`worker/shop-directory.js` decides which bank payments likely should have a receipt, from Relay's seed list of UK shops
(`worker/shop-seed.js`), TrueLayer's label on the payment, and the `shop_directory` table of shops Relay has seen send
receipts. No route reads or writes it: it's filled when a shopper's receipt email is saved (scan, add by id, paste) and read
once per request by `/relay/my/bank/payments` and `/relay/my/receipts`.

- **What a row holds:** the shop's key (its web address or name, letters and digits), the name to show, its kind, how many
  receipts and how many different shoppers, and the first and last day (not time) it was seen. Never a shopper's id or
  email, the order, amount, items or the email itself. `scripts/test-shop-directory.mjs` checks the columns and values.
- **Different shoppers, without keeping who:** when a receipt is saved, the shopper's own receipts (already theirs, deleted
  with their account) say whether they'd had one from that shop before; if not, the count goes up by one. Nothing links a
  count to anyone, so it isn't in Download my data and isn't changed by deleting an account (counts can run a little high).
- **A shop counts from two different shoppers**, so one person's mailbox or a pasted email can't add one.
- **Never counted:** receipts made from a shopper's photo, Relay's test shops (`shopify_shop_plan.test_shop`) and demo
  shop, `myshopify.com` addresses, the App Review account, emails from personal mailboxes (forwarded receipts) and names that
  look like a person's.

## The reviewer sign-in

`worker/review-account.js`. Shopify asks for a test account its reviewers can sign in to without an emailed code
(App Store requirement 4.5.5). It's off until a Relay admin turns it on in the app (Profile, Team).

- Turning it on makes a random address at `example.com`, a domain set aside for examples that can't receive email, so it
  can never be a real person's. Requesting a code for it sends nothing.
- Its 6-digit code is HMAC-SHA256 of the address with `AUTH_SECRET`, so it isn't stored, isn't in the repository and
  changes with the address. Only an admin can see it.
- It signs in through the ordinary code route and its limits (5 wrong guesses each time the code is asked for, and the code can be asked for 5 times an hour), plus at most 20 wrong codes
  a day, since the code doesn't change. The address isn't published anywhere: it goes only in the App Store submission.
- Several people share the account, so nothing personal can be attached to it (see above). Orders placed at a shop with
  that address show up for it, as for any shopper.
- Turning it off deletes the account and everything in it, as "Delete my account" does, signing it out everywhere.
  Turning it on again makes a new address, code and account.

**Proved by** `scripts/test-review-account.mjs`.

## Rate limits

`worker/limits.js`, checked for every request before any route runs. OWASP API4:2023, "Unrestricted Resource Consumption".

| Allowance | Counted by | Per minute | Covers |
|---|---|---|---|
| Address | Network address (IPv6 by its /64 block) | 1,200 | Every request |
| Sign-in | Network address | 30 | Sign-in, codes, passkeys, two-step, connecting Google, Microsoft, Square or Shopify |
| Account | The credential: a shopper's session or a shop's key | 600 | Everything a signed-in shopper or shop does, except pictures |
| Mailbox | The credential | 60 | Searching and adding from Gmail or Outlook, pasted emails, opening an original email, a photo of a paper receipt, the team's own-Outlook search and its emails |

- Over a limit, Relay answers `429` with `{"error":"too_many_requests","retryAfterMs":...}` and a `Retry-After` header. The
  app already shows plain English for it ("Too many attempts. Please try again later." on sign-in; elsewhere "Couldn't …
  Please try again", and inbox reading backs off and carries on in the background).
- Shopify's and Square's webhooks count against the sending address's allowance (1,200 a minute) and nothing else: they're
  signed, but a body has to be read before its signature can be checked, so a flood of fakes is stopped here. Over it they
  get `429` and send the notice again later. A request with no signature is refused before its body is read; otherwise the
  body is read only up to 256 KB (refused on its declared size first, and cut off as it arrives if it lied), and the
  signature is checked over the exact bytes sent (`validate.js` `readCappedBytes`). **Proved by** `scripts/test-webhook-limits.mjs`.
- Gmail's and Outlook's new-mail notices aren't limited (signed by Google, or carrying the subscription's secret; they come
  in bursts from a few of Google's and Microsoft's addresses for every shopper at once), nor is the browser's preflight
  check. Their bodies are read only up to 64 KB, and only the fields Relay uses are read from them.
- Counting uses Cloudflare's Rate Limiting binding (`[[ratelimits]]` in `worker/wrangler.toml`), which counts per
  Cloudflare location and is approximate by design. Without the binding, a counter in the Worker's memory stands in. If
  counting fails, the request goes ahead rather than locking everyone out.
- The tighter limits Relay already had stay on top: sign-in emails per email address and per network address, wrong codes, texts,
  test notifications, price checks, resale requests and messages, shop offers, pasted receipts, test orders.
- To change a limit: edit the number in `worker/wrangler.toml` (and `LIMITS` in `limits.js`, which the stand-in uses), then deploy.

**Proved by** `scripts/test-validation.mjs`, part 4.

## Input checks

`worker/validate.js`. OWASP API3:2023 and API8:2023, and the Input Validation and Mass Assignment cheat sheets.

- Every body Relay accepts is listed with exactly the fields it takes: type, longest length, range, list size, and the
  allowed values where there's a fixed set.
- **Unexpected fields are refused** (`400 {"error":"invalid_request","field":"..."}`). This also stops anyone setting a
  field they shouldn't, such as a resale listing's title, which always comes from the receipt.
- **Deny by default:** a route that isn't listed takes no fields at all.
- Bodies are read only up to the route's size limit (8 KB unless it needs more: pasted emails 1 MB, a profile photo
  260 KB, a photo of a paper receipt 1.6 MB, a shopper's own photo of what they bought 700 KB). Bigger ones get `413` and,
  when the size is declared, aren't even read. A photo field may fill its route's whole body, so a photo that is too big
  is always answered `photo_too_big` (by this check when the body is over the limit, by the route when the picture itself
  is: 1.1 MB for a paper receipt, 450 KB for a photo of what was bought, 150 KB for a profile photo), which the app
  explains in plain words; it is never refused as a plain `invalid_request`.
- The body must be valid UTF-8 and one JSON object. Keys named `__proto__`, `constructor` or `prototype` are refused
  anywhere (prototype pollution).
- Text is cleaned: control characters are removed, and in text written for other people (names, notes, messages) so are
  the invisible characters that flip which way text runs, which can disguise what a message says.
- Addresses are checked too: very long paths or query strings, more than 60 parameters, or control characters are refused.
- Signed-in routes are checked only after the session is known, so a request without one learns nothing beyond
  "not signed in". Each route still makes its own checks after these (a real email address, a known category, the
  shopper's own receipt) and gives its own specific error, as before.

**Proved by** `scripts/test-validation.mjs`:
1. the rules themselves;
2. every route the server's code mentions refuses an unexpected field;
3. every request the app made during the browser tests passes, recorded by `scripts/record-app-requests.mjs`;
4. every field the app's code sends, found by reading `account.js` and the other pages, is one the server takes.

So the checks can't quietly break the app.

## Keys and secrets

No key is written in the code. `scripts/check-secrets.mjs` runs on every pull request and fails if a key, token or
private key appears in any file. Add `--history` to check every commit ever made. The repository is public: a key
that's ever been pushed must be treated as leaked and rotated, even after it's deleted.

Where each one lives:

- **GitHub secret**: put into Cloudflare by `.github/workflows/deploy-worker.yml` on every deploy. To change it, update
  the GitHub secret (Settings → Secrets and variables → Actions), then run the deploy workflow.
- **Cloudflare secret**: set directly, with `npx wrangler secret put NAME` or in the Cloudflare dashboard under the
  Worker's Settings → Variables and Secrets.

| Key | What it's for | Where it lives | To rotate | What changes for people |
|---|---|---|---|---|
| `AUTH_SECRET` | Relay's master key (see below) | GitHub secret | Planned migration only (see below) | Lots, unless migrated |
| `GOOGLE_CLIENT_SECRET` | Google sign-in and reading Gmail | GitHub secret | Google Cloud console → Credentials → the OAuth client → add a secret; update; deploy; disable the old one | Nothing |
| `MICROSOFT_CLIENT_SECRET` | Microsoft sign-in and reading Outlook | Cloudflare secret | Azure app registration → Certificates & secrets → new secret; `wrangler secret put`; delete the old one | Nothing. These expire (24 months at most), so note the date |
| `RESEND_API_KEY` | Sending sign-in and security emails | GitHub secret | Resend → API keys → create; update; deploy; delete the old one | Nothing |
| `STRIPE_SECRET_KEY` (and `STRIPE_PUBLISHABLE_KEY`) | Cards on file and swap payments | Cloudflare secret | Stripe dashboard → Developers → API keys → roll key (Stripe can keep the old one working for a while); `wrangler secret put` | Nothing |
| `SQUARE_ACCESS_TOKEN`, `SQUARE_APPLICATION_SECRET`, `SQUARE_WEBHOOK_SIGNATURE_KEY` | Relay's own Square account, connecting Square shops, checking Square's webhooks | Cloudflare secrets (the sandbox seeding workflows keep their own copy of the access token as a GitHub secret) | Square Developer dashboard → the app → replace the token or secret, or the webhook's signature key; `wrangler secret put`; update the GitHub copy too | Nothing. Shops' own connections are separate |
| `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_WEBHOOK_SECRET` | Connecting Shopify shops, checking Shopify's webhooks | GitHub secrets | Shopify Partners → the app → rotate the secret; update; deploy | Nothing |
| `SHOPIFY_APP_n_CLIENT_SECRET`, `SHOPIFY_STORE_n_...` | Pilot shops' own Shopify apps | Cloudflare secrets | The shop's admin → its app → rotate; `wrangler secret put` | Nothing |
| `TWILIO_AUTH_TOKEN` (and `TWILIO_ACCOUNT_SID`) | Sign-in codes by text | GitHub secret | Twilio console → API keys & tokens → secondary token → promote; update; deploy | Nothing |
| `PLAID_SECRET` | The bank-link demo in the testing tools (sandbox) | GitHub secret | Plaid dashboard → Keys → rotate; update; deploy | Nothing |
| `AWIN_API_TOKEN` | Reading affiliate product feeds | Cloudflare secret | Awin → API credentials → new token; `wrangler secret put` | Nothing |
| `ANTHROPIC_API_KEY` | The help chat's AI assistant, AI help with receipts, reading photos of paper receipts and asking once what kind of shop an unclear shop name is (all off until it's set) | Cloudflare secret | Claude Console → API keys → create a key; `wrangler secret put`; delete the old one | Nothing. Removing it turns both off; "Contact us" by email still works, and receipts are read by Relay's own rules as before. `AI_READER=off` turns off AI help alone. Spending is capped at `AI_MONTHLY_LIMIT_PENCE` (a plain variable, default 2000 = £20 a month) across every AI feature |
| `CLOUDFLARE_API_TOKEN` | Lets GitHub deploy the Worker | GitHub secret | Cloudflare → My Profile → API Tokens → roll; update the GitHub secret | Nothing |

`GMAIL_PUSH_TOPIC` and `GMAIL_PUSH_SERVICE_ACCOUNT` (instant Gmail notices, `docs/MAIL_PUSH_SETUP.md`) aren't secrets:
they name Relay's Pub/Sub topic and the service account its notices are signed for. What stops a fake notice is Google's
signature, which only Google can make.

### `AUTH_SECRET` is special

It isn't used directly for anything outside Relay: Relay derives other keys from it. Each of these has its own label,
so each derived key is different:

- the email hashes that link a shopper to shops' orders, and card fingerprints for in-shop purchases;
- the encryption of every stored Gmail and Outlook key, shop's Square and Shopify keys, Royal Mail key, phone number and
  two-step sign-in secret;
- the keyed hashes of shops' Relay keys;
- the notification signing key;
- the signatures that protect connecting Square and Shopify;
- the reviewer sign-in's code (a new secret means a new code: update the App Store submission).

Sessions don't depend on it: they're plain SHA-256 hashes of random tokens.

Changing it on its own would cut every connected inbox and shop, stop authenticator-app and text codes working for
two-step sign-in (recovery codes would still work), unlink shoppers from their orders, and stop notifications. So rotate it only if it may have leaked,
and only with a migration that, while both the old and new keys are available:

1. decrypts and re-encrypts every stored inbox, shop, Royal Mail, phone and two-step secret;
2. recomputes the email hashes from shoppers' stored emails;
3. issues every shop a new Relay key, since the old keys can't be recomputed from their hashes;
4. asks shoppers to turn notifications on again.

If it has leaked, do the migration at once. Until then, assume anyone holding it could decrypt a copy of the database
(which they would also need).

## When something goes wrong: the incident and data breach plan

For anything that may have exposed, changed, lost or locked away people's data, or let someone in who shouldn't be. The
person who runs Relay leads it, writes everything down as it happens, and follows these steps in order. When in doubt,
treat it as a breach until it's shown not to be. Shops get the same promises in their terms (the draft is in the App
Store submission pack).

**What counts.** A personal data breach is any security incident that leads to personal data being destroyed, lost,
changed, disclosed or accessed without permission, by accident or on purpose; losing access to it counts too. Signs:
a key seen anywhere public (a commit, a screenshot, a chat); a sign-in nobody recognises on Cloudflare, GitHub, Shopify
Partners, Google Cloud, Azure, Stripe, Resend or Twilio; a shopper seeing someone else's receipt or order; an alert or
report from Shopify, a shop, a shopper or a researcher; unusual traffic in the Worker's logs.

### 1. Stop it (straight away)

- **A key may have leaked:** rotate it now, using the table in "Keys and secrets". For `AUTH_SECRET`, follow its own
  section.
- **A session may be in the wrong hands:** sign everyone out. Shoppers simply sign in again:
  `npx wrangler d1 execute relay-purchase-ledger --remote --command "DELETE FROM auth_sessions"`.
- **The Worker's own code is the problem:** roll back to the last good version (Cloudflare dashboard → Workers →
  relay-square-api2 → Deployments, or `npx wrangler rollback`), then revert the commit so the next deploy doesn't bring it
  back.
- **Inbox keys may be exposed:** rotate `GOOGLE_CLIENT_SECRET` and `MICROSOFT_CLIENT_SECRET` and disable the old ones.
  The stored keys are encrypted, and they can't be used without the app's own secret.
- **A shop's Shopify key may be exposed:** the shop can remove Relay, which deletes it at once. Relay's own app secret is
  rotated in Shopify Partners.
- **Keep the evidence.** Don't delete logs or rows. Note the time, and the database's restore point from before it
  started (`npx wrangler d1 time-travel info relay-purchase-ledger`).

### 2. Work out what happened (within 24 hours)

What data, whose, how many people, from when to when, and whether it has stopped. What Relay stores helps decide how
serious it is:

- order emails are only keyed hashes;
- email bodies are never kept, only the receipt details read from them;
- sessions are only hashes, so a copy of the database can't sign anyone in;
- inbox keys, shops' keys, phone numbers and two-step secrets are encrypted with keys derived from `AUTH_SECRET`.

A copy of the database alone exposes receipts, names, email addresses and orders. With `AUTH_SECRET` as well, it
exposes everything encrypted too.

### 3. Tell the people who must be told

| Who | When | How |
|---|---|---|
| Shopify, if any shop's data from Shopify may be involved (products, orders, customers' details, keys) | At once, and no later than 24 hours after Relay becomes aware, even if it's only suspected (Shopify API terms, 6.2.10) | Shopify Support, by email; then answer their questions and keep them updated |
| Each shop affected | Without undue delay, and no later than 48 hours after Relay becomes aware (the shop terms' promise) | Email to the shop's contact: what happened, what data, what Relay has done, what the shop should do |
| The ICO | When the breach is likely to put people's rights and freedoms at risk: without undue delay, and no later than 72 hours after becoming aware. Later than that, give the reasons | ico.org.uk, "Report a breach" |
| Shoppers affected | When it's likely to be a high risk to them: directly and without undue delay | An email from Relay in plain English: what happened, what data, what Relay is doing, what they can do (for example, change a password or watch for scam emails) |
| Google or Microsoft | If inbox access or Relay's app at Google or Microsoft was involved | As their developer terms ask |

Relay runs its own app for shoppers, so for shoppers' accounts Relay decides about telling the ICO. For the customer data
Relay handles for a shop, the shop decides, and Relay gives it what it needs to. The UK rules on this are under review
after the Data (Use and Access) Act 2025, so check the ICO's guidance each time.

### 4. Fix it and recover

Fix the cause, add a test that would have caught it, and deploy. Restore lost or damaged data from Time Travel (30 days
back on Workers Paid; a restore replaces the whole database, so export what's changed since first). Check the fix from
outside with `scripts/check-live-security.mjs`.

### 5. Write it down

Record every breach, even ones that didn't need reporting (the ICO expects this): when it was found, what happened, the
data and people involved, what was done, who was told and when, and why anyone wasn't. Keep the record somewhere
private, not in this repository: it's public.

### 6. Practise

Once a year, and after any big change, walk through a pretend incident with this plan (for example "`AUTH_SECRET`
appeared in a public commit"). Fix whatever was slow or unclear.

## Checking it all

| Check | What it covers | Runs |
|---|---|---|
| `scripts/test-validation.mjs` | Input checks and rate limits, every route, the app's own requests | Every pull request and every deploy |
| `scripts/test-access-control.mjs` | Who can do what | Every pull request and every deploy |
| `scripts/test-signin-claim.mjs` | Google and Microsoft sign-in: a sign-in someone else started can't be claimed with their secret and connects no inbox; the same browser and the installed app still finish; confirming by hand never connects an inbox; 2 minutes to claim | Every pull request and every deploy |
| `scripts/test-second-step.mjs` | Two-step sign-in for everyone; sessions that never passed the second step are ended once the account has one; the first second step signs other sessions out | Every pull request and every deploy |
| `scripts/test-shopify-status.mjs` | The public Shopify status: counts only; shop detail for Relay's team only | Every pull request and every deploy |
| `scripts/test-webhook-limits.mjs` | Shopify's and Square's webhooks: oversized bodies refused unread or cut off at 256 KB, unsigned ones not read, exact-byte signatures, counted per address | Every pull request and every deploy |
| `scripts/test-phone-signin.mjs` | Approving a sign-in from a phone: codes found only while live, used once, guessing capped, the email, the second step carried over | Sign-in pull requests and every deploy |
| `scripts/test-review-account.mjs` | The reviewer sign-in | Pull requests that change sign-in, and every deploy |
| `scripts/check-secrets.mjs` | No keys in the repository | Every pull request and every deploy |
| `scripts/test-shop-directory.mjs` | The shop directory keeps nothing about anyone; test shops and the reviewer left out | Every pull request and every deploy |
| `scripts/test-scan-codes.mjs` | Codes to show or scan: found only where the email says what they are for, look-alikes never; the picture fetched with nothing of the shopper's; the owner only (404); deleted with the receipt, inbox, permission and account | Every pull request and every deploy |
| `scripts/test-bag.mjs` | The shopping bag: the input rules, the owner only, only products Relay shows (never a test shop's), the price check, deleted with the account and in Download my data | Every pull request and every deploy |
| `scripts/test-return-tracking.mjs` | Return emails only ever on the shopper's own receipt; own receipts only (404); the input rules; `returnInTransit` / `returnReceived` / `onItsWay` never on the shopper's word alone, a label, a promise or a bank payment; a refund seen in the bank only from the shopper's own payments; Ship24 shares the parcel allowance | Every pull request and every deploy |
| `scripts/test-return-tracking-e2e.mjs` | One return from label to refund through the real server and app (Ship24, the inbox and the bank stand in): a label or a promise confirms nothing, the carrier's first scan does, only the tracking number goes to Ship24, one parcel counted, the real route's input rules, nobody else's receipt (404) | The browser tests on every pull request |
| `scripts/record-app-requests.mjs` | Records what the app sends during the browser tests, then checks it against the rules | The browser tests on every pull request |
| `scripts/check-live-security.mjs` | The live server from outside: not-found answers, test routes off, sessions required, unexpected fields refused, a real 429 from Cloudflare's rate limiter | After every deploy (`live-security-check.yml`) |

## Not covered here

- Cloudflare's dashboard, GitHub, and the accounts at Google, Microsoft, Stripe, Square, Shopify, Resend and Twilio.
  Protect those with two-step sign-in. Anyone with Cloudflare access can read the database and set secrets.
- Denial of service at a scale beyond these limits: Cloudflare's own protection handles that.
- The Shopify embedded app page, which Shopify's admin frames and signs.
