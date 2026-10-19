// One-off, safe to re-run: subscribes the Relay Worker to Shopify "orders/paid" for the test store.
// Uses the app's own credentials (client credentials grant), so Shopify signs deliveries with the
// app client secret, which the Worker already uses to verify them. Secrets are never printed.
const shop = process.env.SHOPIFY_SHOP_DOMAIN, id = process.env.SHOPIFY_CLIENT_ID, secret = process.env.SHOPIFY_CLIENT_SECRET;
const callback = "https://relay-square-api2.9pts72cy5j.workers.dev/relay/webhooks/shopify";
if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop || "") || !id || !secret) { console.error("Missing Shopify settings"); process.exit(1); }
const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: id, client_secret: secret, grant_type: "client_credentials" }) });
if (!tokenRes.ok) { console.error("Token request failed", tokenRes.status); process.exit(1); }
const { access_token: token } = await tokenRes.json();
async function gql(query, variables = {}) {
  const r = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, { method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) { console.error("Shopify API error", r.status, JSON.stringify(j.errors || j).slice(0, 600)); process.exit(1); }
  return j.data;
}
const existing = await gql(`{ webhookSubscriptions(first: 50, topics: ORDERS_PAID) { nodes { id endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }`);
const found = existing.webhookSubscriptions.nodes.find(n => n.endpoint && n.endpoint.callbackUrl === callback);
if (found) { console.log("Already subscribed:", found.id); process.exit(0); }
const created = await gql(`mutation($u:URL!){ webhookSubscriptionCreate(topic: ORDERS_PAID, webhookSubscription:{callbackUrl:$u, format:JSON}){ webhookSubscription{ id } userErrors{ field message } } }`, { u: callback });
const out = created.webhookSubscriptionCreate;
if (out.userErrors.length) { console.error("Could not subscribe:", JSON.stringify(out.userErrors)); process.exit(1); }
console.log("Subscribed orders/paid:", out.webhookSubscription.id);
