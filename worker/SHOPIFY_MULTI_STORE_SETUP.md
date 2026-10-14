# Relay: Square + multiple Shopify retail stores

This repository supports:
- **Square Sandbox** (existing catalogue, inventory and order test APIs).
- **Fictional retailers** in the Relay app (North & Co. Square-style demo; Relay Studio and Harbour Goods Shopify-style demos), each with separate browser-local prices and quantities. These are not live merchants.
- **Up to five authorised Shopify Admin API stores**, synced to the existing Cloudflare D1 retailer catalogue tables on the hourly Worker cron, with separate store-scoped product and variant IDs.

## Connect a real Shopify store

A retailer must approve Relay's access and install/authorise a Shopify app with the minimum catalogue permissions. Do not request Shopify store owners' passwords, send Admin API tokens to the browser, or commit credentials to GitHub.

For each authorised shop, configure these **Cloudflare Worker secrets** (not public GitHub files). Replace `1` with `2`, `3`, `4`, or `5` for further shops:

```text
SHOPIFY_STORE_1_DOMAIN=your-store.myshopify.com
SHOPIFY_STORE_1_ADMIN_ACCESS_TOKEN=[private admin API token]
SHOPIFY_STORE_1_CATALOGUE_PUBLIC=true
SHOPIFY_STORE_1_LABEL=Your Store Display Name
SHOPIFY_STORE_1_WEBHOOK_SECRET=[private Shopify webhook signing secret, optional]
```

`SHOPIFY_STORE_1_LABEL` and `SHOPIFY_STORE_1_CATALOGUE_PUBLIC` are plain configuration rather than secrets, but can still be deployed as Worker secrets for convenience. `_CATALOGUE_PUBLIC` **must** be the literal string `true` to publish the retailer's read-only catalogue to visitors. Otherwise product data remains private in D1. If a retailer has not agreed to public catalogue publication, **leave this false or unset**. Only GBP variants are shown in Relay's current public feed (the UI is GBP-denominated).

Legacy `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_CATALOGUE_PUBLIC`, `SHOPIFY_STORE_LABEL`, and `SHOPIFY_WEBHOOK_SECRET` are still recognised for one previously connected shop.

**Do not put tokens in the GitHub Pages app or in `wrangler.toml`.** Use Cloudflare Worker secrets under the deployed Worker. Each retailer can have its own token. Merchant permissions must separately cover catalogue/inventory read and any paid-order webhook. For other Shopify merchants, obtain a separate legitimate store authorisation, ideally via an OAuth distribution flow before public production use. No third-party Shopify store can be connected without its owner's approval.

The importer reads Shopify GraphQL products and variants, price, SKU and **shop-aggregate inventoryQuantity**. This is not per-location available-to-sell stock and is not a reservation. The importer is currently capped at 10 pages of 30 products per shop and 100 variants per product per page. Improve pagination before using on large catalogues.

## Verify

After setting secrets, run **Deploy Relay Worker** from GitHub Actions if changes have not already deployed. Then check:
- `GET /relay/shopify/status`: number of authorised and published stores, with no API tokens.
- `GET /relay/shopify/catalogue`: products grouped under their actual opted-in Shopify store names; no private orders or customer details.
- `GET /relay/demo/inventory`: seeded fictional stock, separate from Shopify's live data.
- Relay GitHub Pages **Discover** > **All stores** to browse and filter each named published retailer.

Cron runs hourly. Allow time for the first import (or add a protected manual sync operation for retailer admins). The status endpoint means *credentials are configured*, not necessarily that Shopify has accepted them. Publication must not be enabled without retailer permission.

The paid-order webhook at `POST /relay/webhooks/shopify` verifies the Shopify-signed body against the store's own `_WEBHOOK_SECRET` (or legacy secret). It records orders privately as **unverified**. It never automatically assigns a purchase to a Relay consumer. Subscription/configuration of `orders/paid` is a separate merchant action, not performed by the catalogue sync.

### Testing

```sh
node --check worker/worker.js
node --check worker/shopify.js
node --check worker/shopify-webhooks.js
node scripts/test-shopify-multi-store.mjs
```

These validate connector configuration and shop-scoped IDs using mock Shopify responses. They don't test real Shopify authorisation. A connected store, a synced catalogue, verified purchase ownership, return authorisation, refund advances and replacement-order creation are separate milestones.
