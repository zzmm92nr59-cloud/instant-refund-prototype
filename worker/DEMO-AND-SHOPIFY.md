# Relay multi-store demo and Shopify adapter

## Fictional inventory
`worker/migrations/0003_demo_inventory.sql` seeds three fictional demo stores,
12 products and 47 variants. The deploy workflow runs the seed with
`INSERT OR IGNORE` after creating the schema. These are not real merchants
and not live inventory.

Browse at `/demo-inventory.html` (GitHub Pages). The read-only API is
`GET /relay/demo/inventory`. It intentionally returns **only** rows with
`provider='relay_demo'` and `demo:` retailer connections. It never exposes
actual retailer or customer orders.

## Shopify (optional)
`worker/shopify.js` contains a read-only Shopify Admin GraphQL catalogue
adapter. To enable it, an authorised Shopify merchant must provide the
shop domain (e.g. `example.myshopify.com`) and an Admin API access token
with the necessary read_products and read_inventory permissions.
Configure Cloudflare Worker secrets `SHOPIFY_SHOP_DOMAIN` and
`SHOPIFY_ADMIN_ACCESS_TOKEN`. Do not commit tokens to GitHub.
The hourly cron calls the adapter only when both are configured.
`GET /relay/shopify/status` reports configuration status without
revealing secrets.

Current Shopify implementation is a catalogue/variant and shop-level
inventory-quantity snapshot, not an order importer, OAuth app,
per-location inventory, live reservation or refunds integration.
It currently reads up to 10 pages of 30 products and up to 100 variants
per product. Currency is read from Shopify shop settings.
Shopify's inventoryQuantity is aggregated and may not equal available
stock at a particular location.

## Historical orders
Square historical order imports remain merchant-authorised Sandbox only.
The importer runs hourly. The status endpoint returning a null lastImportAt
means no successful per-location import has been recorded yet.
