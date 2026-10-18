# Relay: identifying an ordinary Square POS shopper

## Square evidence

On completed Square payment, retain payment.id, payment.order_id, payment.location_id,
payment.customer_id (when present), and payment.card_details.card.fingerprint (when present).
The card fingerprint is **merchant-scoped**, not a universal cross-retailer identifier; Apple Pay
and a physical card may have different fingerprints. Last four/brand/amount/time are candidate
signals, **never credentials**.

Square's customer_id may be an automatic/instant profile with no contact details. Neither an
instant Square profile nor the payment card fingerprint identifies a specific Relay login without
a prior verified link.

## First purchase: independent verified link

1. Customer logs into Relay.
2. Customer connects their participating retailer customer account with an authenticated
   retailer flow **or** claims a purchase through a secure, single-use retailer-confirmed
   proof process (not merely a typed receipt number/last four).
3. Verify retailer-provided identity or receipt ownership; obtain customer consent to associate
   future purchases and store a scoped link `(square_merchant_id,square_customer_id,relay_consumer_id,proof,verified_at)`.
   Never trust a browser-supplied customer ID, fingerprint, or email as verified proof.
4. Check for duplicate accounts/conflicting links before enabling the association.
5. If a fingerprint is present on the claimed payment, it can add a *merchant-specific*
   cross-check for subsequent purchases. Do not silently attach the same card to a different
   Relay consumer.

## Repeat ordinary POS purchase

Square event or payment poll -> fetch Payment and Order server-side -> check merchant-scoped
verified link -> check conflicts -> **only then** authorize itemised order access for the
authenticated Relay account. If Square customer_id is missing but a fingerprint repeats,
classify as REVIEW until a stronger buyer proof is available. Card/device/tokenization changes
can break the fingerprint signal.

## Security boundaries

- Server-side enforcement is required. Never expose Square order-item data from a public
  `?customerId=` or `?cardLast4=` endpoint.
- Square merchant authorisation (OAuth in production) is necessary.
- Maintain an audit trail and revoke/correct links. Model household/shared cards, merges,
  refunds, customer-identity changes, Apple Pay vs physical card, and offline delayed payments.
- Retailer contact data must be processed with clear authority and UK GDPR safeguards.
- A Square Sandbox API-created payment is not an actual hardware POS reader transaction.
- Open Banking may strengthen candidate evidence, but isn't an authoritative Square card link.
- Never show itemised receipts to strangers on a weak inferred match.

## Verification now

Run **Actions > Audit Square POS customer identity signals > Run workflow** to inspect the
existing Square Sandbox payment records. This is read-only and prints anonymised fingerprint
and customer-ID tags with aggregate availability and no personal contact values.

The engine and test suite deliberately return UNCLAIMED / REVIEW / CONFLICT when identity
has not been independently established. The result is a technical feasibility test, not an
automatic verified buyer feed.
