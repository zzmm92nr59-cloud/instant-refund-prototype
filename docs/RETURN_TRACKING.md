# Return tracking

Where a return has got to, on the receipt it belongs to, and the one fact a future Plus instant refund can rely on.
Nothing here pays anyone: it only records what Relay was told. Code: `worker/return-tracking.js`.

## The timeline on a receipt

| Step | Relay learns it from, most trusted first |
| --- | --- |
| Return started | The shop's return email (with its label, QR code or return number), a carrier's label email, or the shopper marking an item "I'm sending this back" |
| Sent back | The carrier's tracking (through Ship24: its first scan, with the time), the carrier's own email (dropped off, on its way back), the shop's email ("your return is on its way to us"), or the shopper's "I've sent it back" |
| Received by the shop | The carrier's tracking or email (delivered to the shop), or the shop's email ("we've received your return") |
| Refund issued / received | The shop's refund email ("issued"), or money in on the shopper's own bank payments ("received") |

Each step shows who said so and the day ("From Royal Mail's tracking, 21 Nov at 09:14", "From the shop's email", "Seen on
your account", "You said"). A step nobody told Relay about is not ticked, even when a later one is: it says "Relay wasn't
told". A refund email does not prove a parcel was sent.

Rules that keep it honest:

- An email counts only for what it says has happened. "Once you've dropped it off", a reminder, "we'll let you know when
  it's delivered" and "we'll process your refund" are not a drop-off, an arrival or a refund.
- A refund declined, refused, pending, requested, or "being processed" is not a refund. One being processed is kept as
  `refunding`: it ticks no step and makes no fact; it only lets money in at the bank be matched to the order.
- A shop's "your return label has been sent", "a replacement is on its way" or "your return is on its way back to you" is
  not the return parcel on its way. A carrier's email about a parcel coming to the shopper ("We've delivered your ASOS
  parcel"), even with a "Returning an item?" footer, is a delivery, not a return.
- A return email joins an order by its number and its shop together: two shops can both have an order 1042. Hiding an
  order hides only that shop's order with that number.
- A carrier is recognised by the address its email came from, never by a display name.
- An email or bank payment that could belong to two receipts is left out. Only the shopper's own inboxes, receipts and
  bank payments are used.
- A bank payment shows a refund only on a return Relay already knows of, when the bank's text names the shop, the amount
  is the one the shop's refund email gave (or, without one, the order's total, an item's price or a set of its items), and
  it came in on or after the day the return started. It never confirms that the parcel was sent or received.
- A tracking number only the shopper gave counts for the carrier's news only when that news fits a parcel going back after
  they sent it: the carrier's or shop's email about a return with that number, dated on or after the day they said they
  sent it and naming no other shop, or the carrier's tracking with a first scan on or after that day. A carrier's ordinary
  parcel email (delivered, out for delivery) for that number never counts, and a number on one of their purchases'
  deliveries is never a return's.
- The return's tracking number comes from the shop's or carrier's email, or the shopper pastes it in ("I've sent it back").
  It must look like one (8 to 40 letters and digits, at least one digit); the carrier is filled in only for Royal Mail's,
  Yodel's and Evri's own formats, otherwise the app asks.

## Which items a return is for

An order of several things is rarely sent back whole, so a return is for the items the shopper said (`worker/gmail.js`,
`POST /relay/my/receipts/<id>/items`; in the app, "I'm sending this back" on the order's page asks which).

- The timeline, its tracking number and the fact below are about those items: `returnTracking.items` is their positions
  on the receipt, with `itemsFrom: "you"`. It is left out when nobody said which. Then the order's page says "Relay
  wasn't told which items are in this return" and offers "Say which items"; nothing is assumed.
- The rest of the order keeps its return date and can still be sent back.
- A refund is said to be for an item (`refundItems` on the receipt) only when the amounts say so: the shop's refund is
  exactly what the items the shopper marked cost, or it fits exactly one set of the order's items, or it is every
  item's price together. With no marks, a refund that fits exactly one set also shows those items as returned
  (`itemsFrom: "refund"`, said in the app as "Relay matched the refund amount to …"). Two sets that fit, an item with no
  price, or an amount that fits nothing: the refund is shown as an amount on the order and against no item.
- Money in at the bank counts as this return's refund, when the shopper said which items went back, only if it is the
  price of those items (one, or a set of them) or the order's total: never the price of something they kept.
- Taking it back ("Not sending this back", or unticking everything) removes the shopper's own "Return started". A return
  the shop or a carrier told Relay about stays.

## The fact for a future instant refund

On the server: `returnFactsFor(env, shopperId, receiptId)` in `worker/gmail.js` (null unless the receipt is that shopper's
own). The same fields are on each receipt in `/relay/my/receipts`.

```
onItsWay: null
        | { by: "carrier" | "shop", name, via: "tracking" | "email", at: "2026-11-21", atTime: "2026-11-21T09:14:00" | null, arrived?: true }
statement: "On its way: confirmed by Royal Mail's tracking, first scan 2026-11-21T09:14:00"
returnInTransit, returnReceived, confirmedBy, trackingNumber, state
```

On the receipt itself, `returnTracking.items` says which of its items the return is for (see above). Before paying on
`onItsWay` for part of an order, check it: with no `items`, Relay doesn't know what is in the parcel.

- `onItsWay` is null until a carrier or the shop confirmed the parcel left the shopper. Pay on this, never on `state`.
- It is never set by the shopper's own word (even with a tracking number), a label being made, the carrier's expected
  delivery day, a problem report with no scan, or a bank payment.
- `via: "tracking"` is the strongest: the carrier's own scan. `atTime` is that first scan's time exactly as the carrier
  gave it (its local time unless it carries an offset); it is null when the word came from an email, which gives only a day.
- `arrived: true` means all Relay was told is that the parcel reached the shop; `at` is then the day it arrived.
- `statement` says the same in words, for logs and support.
- `payable` (on `returnFacts`) is true only when `onItsWay` is the carrier's own tracking scan (`via: "tracking"`). **Pay
  only when `payable` is true.** A fact from an email (`via: "email"`) is always `payable: false`, for the reason below.

## Emails the shopper could have written (security review M4, 25 Nov 2026)

Relay reads the shopper's own inbox, and the shopper is the one person who gains from a fake "your return was delivered to
the shop". They can put any message in their own mailbox (Gmail's `messages.insert`, IMAP `APPEND`): it skips spam
filtering and keeps whatever headers they wrote. So:

- When the receiving mail service wrote down how a return or parcel email checked out (`Authentication-Results`, the
  topmost one only: Gmail and Outlook add theirs above anything the email arrived with), the email must pass DMARC for its
  From domain, or DKIM or SPF for a domain under the same organisation's domain (`worker/mail-auth.js`). One that fails
  (`senderCheck: "fail"` on what the reader kept) is nobody's word: it is left off the timeline and makes no
  `returnInTransit`, `returnReceived` or `onItsWay`.
- One that passes, or says nothing (no header: an Outlook message read as JSON, or an email read before 25 Nov 2026),
  counts as before for the timeline and the facts, marked `via: "email"`, and is never `payable`.
- An email the shopper put in their own inbox can carry a forged "pass". That is why no email alone is ever payable: a
  payout needs the carrier's own tracking scan (Ship24 or the carrier's API) or the shop's own refund notice from Shopify
  or Square, which the shopper can't write. Verifying the DKIM signature itself (the carrier's public key from DNS) would
  let a genuine carrier email count; it isn't built.
- Tested in `scripts/test-return-email-auth.mjs`.

## Limits

- Ship24's free plan follows 10 new parcels a month for all of Relay, deliveries and returns together, and each shopper
  can start 3 a month (`worker/parcel-tracking.js`). After that the app says so and links to the carrier's own tracking
  page; emails still update the timeline. Raising it means a paid Ship24 plan and `PARCEL_TRACKS_PER_MONTH`.
- The carrier is asked only when the shopper opens that receipt, at most every 2 hours a parcel, only for a return sent in
  the last 30 days and not yet at the shop. Nothing runs on a timer, so a scan is seen the next time the receipt is opened
  (or when the carrier's or shop's email arrives).
- Live tracking is off until `SHIP24_API_KEY` is set as a Cloudflare secret. Only the tracking number goes to Ship24.
- Tested with a stand-in for Ship24 and made-up emails and bank payments (`scripts/test-return-tracking.mjs`,
  `scripts/test-return-tracking-ui.mjs`; items: `scripts/test-item-returns.mjs`, `scripts/test-item-return-pick-ui.mjs`). Real carriers' emails can be worded differently from the made-up ones.
