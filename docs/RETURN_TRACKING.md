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
- A carrier is recognised by the address its email came from, never by a display name.
- An email or bank payment that could belong to two receipts is left out. Only the shopper's own inboxes, receipts and
  bank payments are used.
- A bank payment shows a refund only on a return Relay already knows of, when the bank's text names the shop, the amount
  is the one the shop's refund email gave (or, without one, the order's total, an item's price or a set of its items), and
  it came in on or after the day the return started. It never confirms that the parcel was sent or received.
- The return's tracking number comes from the shop's or carrier's email, or the shopper pastes it in ("I've sent it back").
  It must look like one (8 to 40 letters and digits, at least one digit); the carrier is filled in only for Royal Mail's,
  Yodel's and Evri's own formats, otherwise the app asks.

## The fact for a future instant refund

On the server: `returnFactsFor(env, shopperId, receiptId)` in `worker/gmail.js` (null unless the receipt is that shopper's
own). The same fields are on each receipt in `/relay/my/receipts`.

```
onItsWay: null
        | { by: "carrier" | "shop", name, via: "tracking" | "email", at: "2026-11-21", atTime: "2026-11-21T09:14:00" | null, arrived?: true }
statement: "On its way: confirmed by Royal Mail's tracking, first scan 2026-11-21T09:14:00"
returnInTransit, returnReceived, confirmedBy, trackingNumber, state
```

- `onItsWay` is null until a carrier or the shop confirmed the parcel left the shopper. Pay on this, never on `state`.
- It is never set by the shopper's own word (even with a tracking number), a label being made, the carrier's expected
  delivery day, a problem report with no scan, or a bank payment.
- `via: "tracking"` is the strongest: the carrier's own scan. `atTime` is that first scan's time exactly as the carrier
  gave it (its local time unless it carries an offset); it is null when the word came from an email, which gives only a day.
- `arrived: true` means all Relay was told is that the parcel reached the shop; `at` is then the day it arrived.
- `statement` says the same in words, for logs and support.

## Limits

- Ship24's free plan follows 10 new parcels a month for all of Relay, deliveries and returns together, and each shopper
  can start 3 a month (`worker/parcel-tracking.js`). After that the app says so and links to the carrier's own tracking
  page; emails still update the timeline. Raising it means a paid Ship24 plan and `PARCEL_TRACKS_PER_MONTH`.
- The carrier is asked only when the shopper opens that receipt, at most every 2 hours a parcel, only for a return sent in
  the last 30 days and not yet at the shop. Nothing runs on a timer, so a scan is seen the next time the receipt is opened
  (or when the carrier's or shop's email arrives).
- Live tracking is off until `SHIP24_API_KEY` is set as a Cloudflare secret. Only the tracking number goes to Ship24.
- Tested with a stand-in for Ship24 and made-up emails and bank payments (`scripts/test-return-tracking.mjs`,
  `scripts/test-return-tracking-ui.mjs`). Real carriers' emails can be worded differently from the made-up ones.
