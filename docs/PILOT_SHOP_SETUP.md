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
   - Scopes: `read_products,read_inventory,read_orders,write_order_edits,write_orders`
     (`write_orders` lets Relay refund the difference on a cheaper swap and make the order when someone wins one
     of the shop's auctions. Without it the shop refunds by hand and can't run auctions.)
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

## 4. The shop says how long it takes returns, and how to send them back

In the Relay shop dashboard the shop opens **Your returns** and fills in:

- **How many days it takes returns for**, counted from the order date (for example 28).
- **How to send something back**, in its own words (up to 600 characters): the address, whether to include the order
  number, who pays the postage.

Relay never makes these up. Until the shop fills them in:

- shoppers see no "Return by" date for that shop's orders (Relay only shows a date the shop gave);
- Relay still lets a shopper ask to return something for 30 days from the order date, which is Relay's own limit and is
  never shown as the shop's deadline;
- a shopper who starts a return is told the shop hasn't said how it wants returns sent, and to use the shop's usual way.

A shop that makes Royal Mail labels through Relay (docs/ROYAL_MAIL_RETURNS.md) doesn't need the "how to send it back"
part: the label does that.

## 5. The shop tells its customers

A shop's customers only find Relay if the shop tells them. In the Relay shop dashboard, **Tell your customers** gives the
shop three things, each with its own button:

- **The link to Relay**, to put on its returns page or anywhere else.
- **A line for its order emails.** It says a customer can swap an item before the shop sends it, or start a return. It
  gives a number of days only when the shop has set its own returns period (step 4), and changes when that does.
- **A QR code** of the same link, as a picture to print on a card that goes in the parcel (at least 2 cm wide).

Customers must sign up with the email they ordered with: that is how Relay matches them to their orders.

Before a shop hands any of this out, do both one-off jobs at the bottom of this page. Without Relay's own sending
address a new customer can't get a sign-in code, and the link and the QR code point at wherever Relay's app is today.

## Checking it worked

- The shop appears in the Relay shop dashboard and its products show up within a few minutes.
- `scripts/test-shopify-pilot-apps.mjs` covers this flow offline (run in every deploy).
- The shop's **Your returns** card shows what it saved, and a test order on Home shows "Return by" with the shop's date.
- **Tell your customers** shows Relay's address, and scanning its QR code with a phone opens Relay.

## Before the first pilot shop: Relay's own sending address (one-off)

Relay emails shops when a shopper starts a return or a swap, and emails shoppers their sign-in codes. Until Relay has a
sending address of its own, those go from the mail service's test address (`onboarding@resend.dev`), and Resend only
delivers that address's emails to the Resend account's own email. So a pilot shop would not get its return emails, and a
new shopper could not sign in with an email code. (The app says so honestly when a shop couldn't be emailed, and the
return is still listed in the shop's dashboard, but the shop would have to look there.)

1. Own a domain for Relay (any registrar).
2. In Resend → **Domains** → **Add Domain**, enter a subdomain of it for sending, for example `mail.<your domain>`
   (Resend recommends a subdomain). Resend then lists the DNS records to add.
3. Add those records where the domain's DNS is managed, exactly as shown. If the DNS is on Cloudflare, switch the proxy
   (the orange cloud) off for them. Verification usually takes a few minutes and can take up to 72 hours.
4. In GitHub → the repository → Settings → Secrets and variables → Actions, add the secret `RELAY_EMAIL_FROM` with the
   value `Relay <hello@mail.<your domain>>` (your own address in place of this one).
5. In GitHub → Actions → **Deploy Relay Worker** → Run workflow. It hands the address to the Relay server (so does the
   next change to the server that goes live).

Checking it worked: Profile → Team → Relay health → **Relay's emails** says "From Relay's own address". The morning
summary also says when Relay couldn't email a shop about a return.

## Before the first pilot shop: Relay's own web address for the app (one-off, not set up yet)

The link and the QR code in **Tell your customers**, and the links in Relay's emails, point at wherever Relay's app is.
Today that is `https://zzmm92nr59-cloud.github.io/instant-refund-prototype/`, which reads like a prototype. The Relay
server takes the app's address from `RELAY_APP_URL`, but moving the app there has not been done or rehearsed yet. It
needs, at least: the web address pointed at the app's pages (GitHub Pages custom domain), `RELAY_APP_URL` handed to the
server on every deploy (as `RELAY_EMAIL_FROM` is), and a check of every sign-in route afterwards.

Two things to know before choosing when:

- Passkeys (Face ID, fingerprint or screen lock sign-in) are tied to the app's address. After a move, everyone who has
  one sets it up again. So move before pilot shoppers sign up, not after.
- A QR code that's already printed keeps the old address. GitHub normally passes people on from the old address to the
  new one, but check that once the move is done, and don't rely on it for printed codes: move first, then let shops print.

