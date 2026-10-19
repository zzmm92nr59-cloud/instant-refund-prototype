# Shopify retailer connection — Relay MVP

Relay's single-shop Shopify integration is prepared but **not connected to a real store until that retailer authorises access**. The consumer app's "Shopify demo" inventory is fictional and separate from any live merchant.

## What the integration does

- **Read-only catalogue**: `worker/shopify.js` synchronises Shopify products, variants, GBP prices and aggregate inventory snapshots into the Relay D1 ledger. It runs on the Worker hourly cron **only when credentials are configured**. Inventory snapshots are indicative and do not reserve stock.
- **Signed paid-order webhook**: `POST /relay/webhooks/shopify` accepts Shopify `orders/paid` only from the configured store after checking the raw-body Shopify HMAC. It stores an unverified retailer order and itemised lines privately. It never automatically attributes an order to a Relay customer, publicly exposes a receipt, creates a return, places a replacement order or pays a refund.
- **Catalogue publishing is opt-in**: `GET /relay/shopify/catalogue` returns items only if `SHOPIFY_CATALOGUE_PUBLIC` is set to the literal string `true` **and** catalogue credentials exist. Otherwise it returns `{products:[],published:false}`. The retailer must explicitly permit Relay to make those products public.
- **Status check**: `GET /relay/shopify/status` reports whether configuration is present, not whether Shopify has approved scopes or webhooks have been delivered.

## Connect a consenting test store

1. Create or use a Shopify development/test store you administer. Install an authorised Shopify app and request only the permissions required for this stage: `read_products`, `read_inventory` where needed, and `read_orders` for paid order ingestion. Shopify may require additional protected customer data approval for particular order fields or distribution methods. Do not request access to historical orders outside Shopify's default window without appropriate permission.
2. In the Cloudflare Worker settings, configure `SHOPIFY_SHOP_DOMAIN` (exact `example.myshopify.com`, not secret) and, as secrets, `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` from the Shopify Dev Dashboard app. Relay exchanges these for short-lived access tokens itself and reuses the client secret to verify webhook signatures. (Older setups can instead use a static `SHOPIFY_ADMIN_ACCESS_TOKEN` plus `SHOPIFY_WEBHOOK_SECRET`.) **Do not add any credentials to GitHub, browser JavaScript or demo data.**
3. Subscribe the store/app's `orders/paid` webhook to `https://relay-square-api2.9pts72cy5j.workers.dev/relay/webhooks/shopify`. Shopify signs the raw request body and supplies `X-Shopify-Hmac-Sha256`, `X-Shopify-Shop-Domain`, `X-Shopify-Topic` and `X-Shopify-Webhook-Id`.
4. Let the hourly Worker cron sync products, or explicitly trigger an authorised Worker sync through the deployment process. Inspect D1 privately to check new `shopify:` retailer connections, catalogues, unverified retailer orders and `order_items`. Test one GBP paid order with non-sensitive test customer details. This MVP intentionally rejects non-GBP order webhooks.
5. If and only if the merchant has granted Relay permission to publish catalogue metadata, set `SHOPIFY_CATALOGUE_PUBLIC=true` in Worker configuration. The consumer Discover tab can then browse those variants but **cannot create Shopify orders or show customer receipts**.

## Security and product boundaries

Shopify data is private retailer data unless explicitly approved for publication. Customer identifiers are not wallet verification. Relay should not associate an order with a connected bank account using only merchant, date and amount. The webhook stores no email, address, payment card or other order PII, only the minimal external customer ID and itemised financial/product identifiers required for later matching.

**Free roadmap:** returns and exchanges start in Relay, but refund/replacement processing follows retailer receipt and approval. **Plus concept:** eligible early advances before return receipt, subject to underwriting, fraud/chargeback controls, consent, funding and consumer protection. Both are only simulated in the current consumer app. A browser-side Plus preview is not an entitlement or payment product.

## Next integration milestones

- Merchant installation/authorisation for multiple stores (OAuth), secure token storage per retailer, permissions and uninstall handling.
- Signed product/inventory and returns webhooks, backfill, idempotency/reconciliation, sale/discount price history.
- Authenticated customer-to-order link with independent ownership verification and customer privacy controls.
- Retailer-approved exchange orchestration (return request, reserve/confirm replacement, funds difference, compensating actions on failure), then a guarded instant advance flow.
- UK commercial/legal review before consumers or real advances are onboarded.

Official Shopify references:
- https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
- https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order
- https://shopify.dev/docs/api/admin-graphql/2026-01/mutations/returnCreate
