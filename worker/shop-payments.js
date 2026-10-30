// How a shop's customers pay the difference when they swap to a dearer item. Each shop chooses in Relay for shops:
//
//  * "shopify" (the default): Relay updates the order in Shopify and Shopify itself asks the customer for the extra,
//    with a payment link and Shopify's own email. The customer pays through the shop's normal checkout, so it works with
//    whatever the shop already accepts (Shopify Payments, Stripe, PayPal, Klarna, Apple Pay, Google Pay…). The money goes
//    straight to the shop; Relay never touches it. Not instant: the customer has to open the link and pay.
//
//  * "card": instant. The customer's saved card (in Relay) is charged the moment the shop's order is updated, and the money
//    is paid straight into the SHOP's own Stripe account (Stripe Connect destination charge), never kept by Relay.
//    Needs the shop to connect a Stripe account, and Relay's Stripe keys. Test mode only for now (see payments.js).
//
// Stripe Connect set-up: the shop presses "Connect Stripe" in its dashboard; Relay creates a Stripe account for it and
// sends it to Stripe's own onboarding (identity, bank account). Relay never sees those details. Card mode can only be
// switched on once Stripe says the account can take payments.

import { ensureOnce } from "./once.js";
import { paymentsEnabled, stripe } from "./payments.js";

const json = (body, status = 200, cors = {}) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
const ACCT = /^acct_[A-Za-z0-9]{8,40}$/;

export function ensureShopPayTables(db) {
  return ensureOnce(db, "shop-pay", async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS relay_shop_pay (shop TEXT PRIMARY KEY, method TEXT NOT NULL DEFAULT 'shopify',
      stripe_account TEXT, stripe_ready INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`).run();
  });
}

async function row(env, shop) {
  await ensureShopPayTables(env.RELAY_DB);
  return env.RELAY_DB.prepare("SELECT * FROM relay_shop_pay WHERE shop = ?").bind(shop).first();
}

// What actually happens for this shop right now. "card" only when it is truly available; otherwise "shopify".
export async function shopPay(env, shop) {
  const r = await row(env, shop).catch(() => null);
  const ready = Boolean(r && r.stripe_ready && r.stripe_account && paymentsEnabled(env));
  return { method: r && r.method === "card" && ready ? "card" : "shopify", stripeAccount: ready ? r.stripe_account : null };
}

async function save(env, shop, fields, now) {
  const cur = (await row(env, shop)) || { method: "shopify", stripe_account: null, stripe_ready: 0 };
  const next = { ...cur, ...fields };
  await env.RELAY_DB.prepare(`INSERT INTO relay_shop_pay (shop, method, stripe_account, stripe_ready, updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(shop) DO UPDATE SET method = excluded.method, stripe_account = excluded.stripe_account, stripe_ready = excluded.stripe_ready, updated_at = excluded.updated_at`)
    .bind(shop, next.method, next.stripe_account || null, next.stripe_ready ? 1 : 0, now).run();
  return next;
}

// Asks Stripe whether the shop's account can take payments yet, and remembers the answer.
async function refreshStripe(env, shop, r, o) {
  if (!r || !r.stripe_account || !paymentsEnabled(env)) return r;
  try {
    const a = await stripe(env, "GET", "accounts/" + r.stripe_account, null, o);
    const ready = Boolean(a.charges_enabled);
    if (ready !== Boolean(r.stripe_ready)) r = await save(env, shop, { stripe_ready: ready, method: ready ? r.method : "shopify" }, o.now || Date.now());
    return { ...r, detailsSubmitted: Boolean(a.details_submitted) };
  } catch { return r; }
}

async function view(env, shop, o) {
  const r = await refreshStripe(env, shop, await row(env, shop), o);
  const cardPossible = paymentsEnabled(env);
  const ready = Boolean(r && r.stripe_ready && r.stripe_account && cardPossible);
  return { method: r && r.method === "card" && ready ? "card" : "shopify", cardPossible, testMode: cardPossible,
    stripe: { connected: Boolean(r && r.stripe_account), ready, detailsSubmitted: Boolean(r && r.detailsSubmitted) } };
}

// Routes under /relay/retailer/payments (Shopify shops only; the caller has already checked the shop's key).
export async function handleShopPayRoute(request, env, url, cors, shop, o = {}) {
  const path = url.pathname, now = o.now || Date.now();
  if (path === "/relay/retailer/payments" && request.method === "GET") return json(await view(env, shop, o), 200, cors);
  if (path === "/relay/retailer/payments" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const method = body && body.method;
    if (method !== "shopify" && method !== "card") return json({ error: "bad_method" }, 400, cors);
    if (method === "card") {
      const v = await view(env, shop, o);
      if (!v.cardPossible) return json({ error: "cards_not_available" }, 409, cors);
      if (!v.stripe.ready) return json({ error: "stripe_not_ready" }, 409, cors);
    }
    await save(env, shop, { method }, now);
    return json(await view(env, shop, o), 200, cors);
  }
  if (path === "/relay/retailer/payments/stripe" && request.method === "POST") {
    if (!paymentsEnabled(env)) return json({ error: "cards_not_available" }, 409, cors);
    let r = await row(env, shop);
    try {
      if (!r || !r.stripe_account) {
        // A Standard account: the shop owns it, logs into Stripe itself and is paid out by Stripe directly.
        const a = await stripe(env, "POST", "accounts", { type: "standard", country: "GB", metadata: { relay_shop: shop } },
          { ...o, idempotencyKey: "relay-connect-" + shop });
        if (!ACCT.test(String(a.id))) throw new Error("Stripe didn't create an account");
        r = await save(env, shop, { stripe_account: a.id, stripe_ready: 0 }, now);
      }
      const back = new URL("/relay/stripe/return", url.origin).toString();
      const link = await stripe(env, "POST", "account_links", { account: r.stripe_account, type: "account_onboarding",
        refresh_url: back + "?again=1", return_url: back }, o);
      if (!/^https:\/\/connect\.stripe\.com\//.test(String(link.url))) throw new Error("Stripe didn't return a set-up link");
      return json({ url: link.url }, 200, cors);
    } catch (e) {
      return json({ error: "stripe_unavailable", detail: String(e && e.message || e).slice(0, 140) }, 502, cors);
    }
  }
  if (path === "/relay/retailer/payments/stripe/remove" && request.method === "POST") {
    await save(env, shop, { stripe_account: null, stripe_ready: 0, method: "shopify" }, now);
    return json(await view(env, shop, o), 200, cors);
  }
  return null;
}

// Where Stripe sends the shop back after its own set-up pages. Nothing is changed here; the dashboard asks Stripe for the status.
export function stripeReturnPage(url) {
  const again = url.searchParams.get("again") === "1";
  const msg = again ? "That Stripe link has expired. Go back to Relay and press “Connect Stripe” again."
    : "You're back from Stripe. Close this tab and go back to Relay — it checks with Stripe and shows whether your account can take payments.";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relay · Stripe</title>
<style>body{margin:0;background:#f6f3ec;font:16px Inter,system-ui,sans-serif;color:#141827;display:grid;place-items:center;min-height:100vh}
main{background:#fff;border:1px solid #e6e1d6;border-radius:22px;padding:28px;max-width:420px;margin:16px}h1{font-family:Georgia,serif;font-weight:600;margin:0 0 8px}</style></head>
<body><main><h1>${again ? "Link expired" : "Stripe set-up"}</h1><p>${msg}</p></main></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" } });
}
