# Adding a pilot shop

Shopify only lets a "custom distribution" app be installed on the one shop it was made for.
So each pilot shop gets its own copy of the Relay app. The Relay server accepts up to 20 of these
alongside the main app.

You need the shop's address first: it ends in `.myshopify.com` (the shop owner sees it in their
Shopify admin under Settings → Domains).

## 1. Make the app in Shopify (Dev Dashboard)

1. Create a new app, named e.g. `Relay – <shop name>`.
2. Copy the settings from the existing Relay app version:
   - App URL: `https://relay-square-api2.9pts72cy5j.workers.dev/relay/shopify/launch`
   - Redirect URL: `https://relay-square-api2.9pts72cy5j.workers.dev/relay/shopify/oauth/callback`
   - Scopes: `read_products,read_inventory,read_orders,write_order_edits`
   - Compliance webhooks (customer data request, customer redact, shop redact):
     `https://relay-square-api2.9pts72cy5j.workers.dev/relay/webhooks/shopify`
3. Release that version.
4. Distribution → **Custom distribution** → enter the shop's `.myshopify.com` address → generate the
   install link. (This choice is permanent for that app, which is why each shop gets its own.)

## 2. Give the Relay server the app's keys (you do this; never paste keys into a chat)

In Cloudflare → Workers → `relay-square-api2` → Settings → Variables and secrets, add, using the next
free number `N` (1, 2, 3 …):

| Name | Type | Value |
| --- | --- | --- |
| `SHOPIFY_APP_N_CLIENT_ID` | Secret | the new app's Client ID |
| `SHOPIFY_APP_N_CLIENT_SECRET` | Secret | the new app's Client secret |
| `SHOPIFY_APP_N_SHOP` | Secret | the shop's address, e.g. `kick-lane.myshopify.com` |

Use **Secret** for all three: plain text variables set in the dashboard are wiped by the next
automatic deploy, secrets are kept. Save and deploy.

## 3. Send the shop its install link

Send the link from step 1.4 together with the pilot pack. When the shop clicks **Install**, Relay
checks the approval was signed by that shop's own app, stores which app it came through (for token
renewal and webhooks), and refuses the app for any other shop.

## Checking it worked

- The shop appears in the Relay shop dashboard and its products show up within a few minutes.
- `scripts/test-shopify-pilot-apps.mjs` covers this flow offline (run in every deploy).
