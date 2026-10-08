# Relay durable purchase ledger — phase 2

## Delivered
- `worker/migrations/0001_relay_purchase_ledger.sql`: D1-compatible relational schema with foreign keys, unique provider IDs for idempotent imports, order line items, matching evidence, verification challenges and audit history.
- `GET /relay/ledger/status`: safe configuration/readiness check. Returns `not_configured` until D1 is bound; `migration_required` before schema application; `schema_ready` after.

## Provisioning (not yet performed)
1. Create a Cloudflare D1 database in the existing account (suggested name: `relay-purchase-ledger`).
2. Bind it to Worker `relay-square-api2` as `RELAY_DB` in `worker/wrangler.toml` using its actual Cloudflare D1 database ID. Do not invent the ID.
3. Apply `worker/migrations/0001_relay_purchase_ledger.sql` with Wrangler's D1 migration command or Cloudflare dashboard, initially in Sandbox/development only.
4. Verify `/relay/ledger/status` reports `schema_ready` before any ingestion is enabled.

## Security gates before ingestion
- Add authenticated consumers, secure token vault/secrets and per-user authorization.
- Avoid exposing the existing Square Sandbox verified-purchase endpoint as production authorization: brand/last4 and an order ID are NOT sufficient to establish ownership.
- Never log raw bank payloads, PAN/CVV, tokens, full email or phone in match evidence.
- Validate provider webhooks, use idempotency keys and implement retention/deletion.
- Don't use D1 for raw secrets; store token references securely.

## Next engineering task
Create authenticated ingestion services for historical retailer orders and consented bank transactions, populate these tables, run the matching module and expose only verified or safely redacted candidate data to the owning customer.
