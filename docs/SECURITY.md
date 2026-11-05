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
| **Relay admin** | A signed-in shopper whose email is in `RELAY_ADMIN_EMAILS`. |
| **App reviewer** | A shopper signed in with the reviewer sign-in (below): a made-up address and a code that stays the same while it's on. |
| **Shop** | The shop's Relay key (`rk_...`), given when the shop connects with Square or Shopify (or opens Relay inside Shopify admin). Relay keeps only a keyed hash of it. |
| **Shopify, Square** | Webhooks signed with the shared secret (HMAC); unsigned or wrongly signed ones are refused. |
| **Relay's scheduled jobs** | Cloudflare's cron triggers. They aren't reachable over the web at all. |

### What each caller can do

"Own" means the caller's own records only. Blank means no access: the route answers "not signed in" (401), or "not
found" (404) where even saying it exists would tell too much.

| Resource | Visitor | Shopper | Relay admin | Shop | Shopify / Square | Scheduled jobs |
|---|---|---|---|---|---|---|
| Sign in, sign out | Start and finish sign-in | Sign out; sign out other devices | As a shopper | | | Tidy old text-message records |
| Account (email, name, photo, passkeys, two-step, phone) | | Own: read, change, delete the whole account, download a copy | As a shopper | | | |
| Email connections (Gmail, Outlook) | | Own: connect up to 5, disconnect, withdraw permission | As a shopper | | | Read connected inboxes for new receipts (every 15 min) |
| Receipts and their pictures | | Own: list, add (search, paste), confirm, hide, change category, mark items, tag as a gift (and who for), fix what was read wrong, reminders, open the original email | As a shopper | | | Return reminders |
| Purchases at connected shops | | Own (matched by verified email hash): list, return, swap | As a shopper | Sees counts only, never who | Shopify reports paid orders and refunds (signed), and asks for erasure | Catch up Square orders and refunds; erase a shop's orders 30 days after it removed Relay if Shopify's erase request never came |
| Card on file (Stripe) | | Own: add, remove. Relay keeps Stripe's reference, the brand, last 4 digits and expiry, never the card number | As a shopper | | | |
| Price alerts and phone notifications | | Own: watch items or shops, choose alert mode, turn notifications on and off | As a shopper | Sends an offer to its own watchers, without learning who they are | Catalogue changes (signed) | Compare prices, send alerts |
| Resale listings | Nothing | List items from own receipts; browse others' listings, shown only as "Member" | As a shopper | | | |
| Resale requests and messages | | Only the two members in a conversation; report one | Reviews reported conversations, without seeing who the members are; dismiss, remove a listing, block a member | | | |
| In-shop purchases (Square) | | Own: claim a card payment from a receipt; answer "is this yours?" | As a shopper | | | Suggest new in-shop payments to their owners |
| Shop figures | | | | Own shop only: how many watch each item, offers sent, results. Counts under 3 show as "fewer than 3" | | |
| Shop settings (payments, Royal Mail labels) | | | | Own shop only. The Royal Mail key is stored encrypted and never sent back | | |
| Catalogue (products, prices, stock) | Read (public product data) | Read | Read | Kept in the shop's own Square or Shopify | Report product and stock changes (signed) | Refresh it |
| List of connected shops | Read names | Read | Read | | | |
| Reviewer sign-in (`/relay/my/admin/review-account`) | | | Turn on (a new address and code), see the address and code, turn off (deletes the account) | | | |
| Help chat (`/relay/my/help/chat`, `/relay/my/help/handoff`) | | Own: ask the assistant (60 messages a day; 3,000 a day across everyone), send the chat to Relay's team (5 a day). Relay keeps no copy of the chat, only daily counts | As a shopper (300 messages a day) | | | |
| Emails sent to Relay (`/relay/my/receipts/<id>/share`, `/relay/my/admin/shared-emails`) | | Own receipts from an inbox only: see exactly what would be sent (details hidden), send it with a note (10 a day, 30 kept at once), delete it | List them without their text; read one (each opening recorded in `audit_events`; never who sent it); delete one | | | Delete them 30 days after they were sent |
| AI help (`/relay/my/ai-reading`) | | Own: switch on and off (off deletes what the AI read). Off for everyone until `ANTHROPIC_API_KEY` is set | As a shopper | | | Every hour: up to 20 receipts the rules weren't sure about, from shoppers with it on (40 a shopper and 1,500 in all a day), sent to Anthropic with personal details hidden |
| Relay health (`/relay/my/admin/health`) | | | Read counts of how well emails are read and how the app is used: never anything from a single receipt; a shop is named only once 3 or more shoppers have receipts from it; the admin's own receipts by shop. Orders from connected Shopify shops are checked against what was read from the same shopper's own emails about them (never anyone else's), shown as counts, with only the admin's own orders in detail. Email the summary to yourself (`/relay/my/admin/health/email`, no body, once in 5 minutes); every admin gets it each morning, and alerts when something breaks | | | |
| Testing tools (`/relay/my/testing/...`) | | Sandbox test shop only: off when Square is live; 5 test orders a day | | | | |
| Prototype test routes (`/relay/test-lab`, `/relay/live-test`, `/relay/ledger/...` and others) | Off: "not found" | Off | Off | Off | | |

The **app reviewer** can do what any shopper can, on its own account, except attach anything personal: connecting an
inbox, adding a passkey, two-step sign-in, a phone number or a card answer `403 {"error":"not_for_review_account"}`.

The prototype test routes are switched off by `worker/legacy-routes.js`. They take no sign-in and some place test payments
on Relay's Square sandbox account. To use the "Existing API and verification tools" testing page again, set
`LEGACY_TEST_ROUTES = "on"` under `[vars]` in `worker/wrangler.toml`, deploy, and set it back to `"off"` afterwards.

**Proved by** `scripts/test-access-control.mjs`. It tries every route the server's code mentions as each kind of caller:
no session, a made-up one, a malformed one, a shop's key, an admin route as a shopper, someone else's receipt, unsigned
webhooks. Ownership of purchases, swaps, returns, resale and inboxes is also tested in `test-auth`, `test-exchange`,
`test-square-orders`, `test-resale`, `test-resale-admin`, `test-more-inboxes` and `test-retailer`.

## The reviewer sign-in

`worker/review-account.js`. Shopify asks for a test account its reviewers can sign in to without an emailed code
(App Store requirement 4.5.5). It's off until a Relay admin turns it on in the app (Profile, Team).

- Turning it on makes a random address at `example.com`, a domain set aside for examples that can't receive email, so it
  can never be a real person's. Requesting a code for it sends nothing.
- Its 6-digit code is HMAC-SHA256 of the address with `AUTH_SECRET`, so it isn't stored, isn't in the repository and
  changes with the address. Only an admin can see it.
- It signs in through the ordinary code route and its limits (5 wrong codes per 15 minutes), plus at most 20 wrong codes
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
| Mailbox | The credential | 60 | Searching and adding from Gmail or Outlook, pasted emails, opening an original email |

- Over a limit, Relay answers `429` with `{"error":"too_many_requests","retryAfterMs":...}` and a `Retry-After` header. The
  app already shows plain English for it ("Too many attempts. Please try again later." on sign-in; elsewhere "Couldn't …
  Please try again", and inbox reading backs off and carries on in the background).
- Shopify's and Square's webhooks aren't limited (they're signed, and their senders retry in bursts). Nor is the
  browser's preflight check.
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
  300 KB). Bigger ones get `413` and, when the size is declared, aren't even read.
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
| `ANTHROPIC_API_KEY` | The help chat's AI assistant and AI help with receipts (both off until it's set) | Cloudflare secret | Claude Console → API keys → create a key; `wrangler secret put`; delete the old one | Nothing. Removing it turns both off; "Contact us" by email still works, and receipts are read by Relay's own rules as before. `AI_READER=off` turns off AI help alone |
| `CLOUDFLARE_API_TOKEN` | Lets GitHub deploy the Worker | GitHub secret | Cloudflare → My Profile → API Tokens → roll; update the GitHub secret | Nothing |

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
| `scripts/test-review-account.mjs` | The reviewer sign-in | Pull requests that change sign-in, and every deploy |
| `scripts/check-secrets.mjs` | No keys in the repository | Every pull request and every deploy |
| `scripts/record-app-requests.mjs` | Records what the app sends during the browser tests, then checks it against the rules | The browser tests on every pull request |
| `scripts/check-live-security.mjs` | The live server from outside: not-found answers, test routes off, sessions required, unexpected fields refused, a real 429 from Cloudflare's rate limiter | After every deploy (`live-security-check.yml`) |

## Not covered here

- Cloudflare's dashboard, GitHub, and the accounts at Google, Microsoft, Stripe, Square, Shopify, Resend and Twilio.
  Protect those with two-step sign-in. Anyone with Cloudflare access can read the database and set secrets.
- Denial of service at a scale beyond these limits: Cloudflare's own protection handles that.
- The Shopify embedded app page, which Shopify's admin frames and signs.
