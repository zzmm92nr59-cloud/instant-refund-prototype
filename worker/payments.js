// Shopper's payment card, for swaps that cost more. STRIPE TEST MODE ONLY.
//
// What this does:
//   - A shopper saves a card with a £0.00 check: Apple Pay (or Google Pay, or a typed card) through Stripe. Nothing is
//     charged. Stripe keeps the card; Relay keeps only Stripe's reference, the brand, the last 4 digits and the expiry.
//   - When a shopper swaps to a dearer size or colour, Relay first PUTS A HOLD on the difference (not a charge), then
//     edits the order in Shopify, then takes the held amount. If Shopify refuses the edit, the hold is cancelled.
//   - Every amount taken is recorded as owed to that shop (relay_swap_payments.owed_to_shop).
//
// What this does NOT do:
//   - Real money. It only switches on with Stripe test keys (sk_test_… and pk_test_…); with a live key it stays off.
//     Taking real money for a shop means passing it on to the shop (Stripe Connect payouts) and the rules that come
//     with holding other people's money. That is a business decision, not built here.
//   - Paying money back to the card. A saved card can't be sent money that was never charged on it, so for a cheaper
//     swap the shop refunds the difference through Shopify, to whatever the shopper originally paid with.
import { ensureOnce } from "./once.js";

const API = "https://api.stripe.com/v1/";
const json = (body, status = 200, cors = {}) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

export function paymentsEnabled(env) {
  return /^sk_test_[A-Za-z0-9]{10,}$/.test(String(env.STRIPE_SECRET_KEY || "")) && /^pk_test_[A-Za-z0-9]{10,}$/.test(String(env.STRIPE_PUBLISHABLE_KEY || ""));
}

export function ensurePaymentTables(db) {
  return ensureOnce(db, "payments", async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS relay_cards (shopper_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, payment_method_id TEXT,
      brand TEXT, last4 TEXT, wallet TEXT, exp_month INTEGER, exp_year INTEGER, test_mode INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS relay_swap_payments (id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, order_id TEXT NOT NULL, line_id TEXT NOT NULL,
      shop TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, payment_intent TEXT, status TEXT NOT NULL, owed_to_shop INTEGER NOT NULL DEFAULT 0,
      test_mode INTEGER NOT NULL DEFAULT 1, detail TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_swap_payments_shop ON relay_swap_payments(shop, status)").run();
  });
}

// Stripe's API takes form fields; nested ones as a[b]=c.
function form(fields, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? prefix + "[" + k + "]" : k;
    if (Array.isArray(v)) v.forEach((x) => out.append(name + "[]", String(x)));
    else if (typeof v === "object") form(v, name, out);
    else out.append(name, String(v));
  }
  return out;
}
export async function stripe(env, method, path, fields, o = {}) {
  const f = o.fetchImpl || ((...a) => fetch(...a));
  const headers = { Authorization: "Bearer " + env.STRIPE_SECRET_KEY, "Stripe-Version": "2024-06-20" };
  if (fields) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (o.idempotencyKey) headers["Idempotency-Key"] = o.idempotencyKey;
  const r = await f(API + path, { method, headers, body: fields ? form(fields).toString() : undefined, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || ("Stripe said " + r.status)); e.code = j.error && (j.error.decline_code || j.error.code); e.status = r.status; throw e; }
  return j;
}

export async function cardOf(env, shopperId) {
  await ensurePaymentTables(env.RELAY_DB);
  const row = await env.RELAY_DB.prepare("SELECT * FROM relay_cards WHERE shopper_id = ?").bind(shopperId).first();
  return row && row.payment_method_id ? row : null;
}
const publicCard = (c) => c ? { brand: c.brand, last4: c.last4, wallet: c.wallet, expMonth: c.exp_month, expYear: c.exp_year, testMode: Boolean(c.test_mode) } : null;
export const moneyText = (m) => "£" + (Math.round(Number(m) || 0) / 100).toFixed(2);

async function startSetup(env, shopper, o) {
  const db = env.RELAY_DB, now = o.now || Date.now();
  let row = await db.prepare("SELECT customer_id FROM relay_cards WHERE shopper_id = ?").bind(shopper.id).first();
  let customer = row && row.customer_id;
  if (!customer) {
    // The Stripe customer carries no name or email: only Relay's internal id, so Stripe can't link it to a person.
    customer = (await stripe(env, "POST", "customers", { metadata: { relay_shopper: shopper.id } }, { ...o, idempotencyKey: "relay-customer-" + shopper.id })).id;
    await db.prepare("INSERT INTO relay_cards (shopper_id, customer_id, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(shopper_id) DO UPDATE SET customer_id = excluded.customer_id, updated_at = excluded.updated_at")
      .bind(shopper.id, customer, now, now).run();
  }
  const si = await stripe(env, "POST", "setup_intents", { customer, usage: "off_session", payment_method_types: ["card"], metadata: { relay_shopper: shopper.id } }, o);
  return { clientSecret: si.client_secret, setupIntentId: si.id, publishableKey: env.STRIPE_PUBLISHABLE_KEY };
}

async function confirmSetup(env, shopper, body, o) {
  const db = env.RELAY_DB, now = o.now || Date.now();
  const id = String(body && body.setupIntentId || "");
  if (!/^seti_[A-Za-z0-9]{8,}$/.test(id)) return [400, { error: "bad_request" }];
  const row = await db.prepare("SELECT customer_id, payment_method_id FROM relay_cards WHERE shopper_id = ?").bind(shopper.id).first();
  if (!row) return [409, { error: "no_setup" }];
  const si = await stripe(env, "GET", "setup_intents/" + id, null, o);
  // Only accept a check that belongs to this shopper's own Stripe customer and actually went through.
  if (si.customer !== row.customer_id || si.status !== "succeeded" || !si.payment_method) return [409, { error: "card_not_saved" }];
  const pmId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method.id;
  const pm = await stripe(env, "GET", "payment_methods/" + pmId, null, o);
  const c = pm.card || {};
  if (row.payment_method_id && row.payment_method_id !== pmId) {
    try { await stripe(env, "POST", "payment_methods/" + row.payment_method_id + "/detach", {}, o); } catch { /* old card already gone */ }
  }
  await db.prepare("UPDATE relay_cards SET payment_method_id = ?, brand = ?, last4 = ?, wallet = ?, exp_month = ?, exp_year = ?, test_mode = 1, updated_at = ? WHERE shopper_id = ?")
    .bind(pmId, String(c.brand || "card").slice(0, 20), String(c.last4 || "").slice(0, 4), c.wallet && c.wallet.type ? String(c.wallet.type).slice(0, 20) : null,
      Number(c.exp_month) || null, Number(c.exp_year) || null, now, shopper.id).run();
  return [200, { card: publicCard(await cardOf(env, shopper.id)) }];
}

async function removeCard(env, shopper, o) {
  const c = await cardOf(env, shopper.id);
  if (c) { try { await stripe(env, "POST", "payment_methods/" + c.payment_method_id + "/detach", {}, o); } catch { /* already detached */ } }
  await env.RELAY_DB.prepare("UPDATE relay_cards SET payment_method_id = NULL, brand = NULL, last4 = NULL, wallet = NULL, exp_month = NULL, exp_year = NULL, updated_at = ? WHERE shopper_id = ?")
    .bind(o.now || Date.now(), shopper.id).run();
  return [200, { card: null }];
}

// Holds the difference on the shopper's saved card (nothing taken yet). Returns { id } or throws with a reason.
export async function holdDifference(env, shopper, card, { amountMinor, orderId, lineId, shop, label }, o = {}) {
  const now = o.now || Date.now(), id = crypto.randomUUID();
  await ensurePaymentTables(env.RELAY_DB);
  const pi = await stripe(env, "POST", "payment_intents", {
    amount: amountMinor, currency: "gbp", customer: card.customer_id, payment_method: card.payment_method_id, off_session: "true", confirm: "true",
    capture_method: "manual", description: ("Relay swap difference: " + label).slice(0, 200),
    metadata: { relay_shopper: shopper.id, relay_order: orderId, relay_line: lineId, shop }
  }, { ...o, idempotencyKey: "relay-swap-" + id });
  if (pi.status !== "requires_capture") {
    try { await stripe(env, "POST", "payment_intents/" + pi.id + "/cancel", {}, o); } catch { /* nothing held */ }
    const e = new Error("Card not accepted"); e.code = "card_declined"; throw e;
  }
  await env.RELAY_DB.prepare(`INSERT INTO relay_swap_payments (id, shopper_id, order_id, line_id, shop, amount_minor, currency, payment_intent, status, owed_to_shop, test_mode, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, shopper.id, orderId, lineId, shop, amountMinor, "GBP", pi.id, "held", 0, 1, now, now).run();
  return { id, paymentIntent: pi.id };
}
export async function takeHeld(env, hold, o = {}) {
  const now = o.now || Date.now();
  try {
    await stripe(env, "POST", "payment_intents/" + hold.paymentIntent + "/capture", {}, o);
    await env.RELAY_DB.prepare("UPDATE relay_swap_payments SET status = 'taken', owed_to_shop = amount_minor, updated_at = ? WHERE id = ?").bind(now, hold.id).run();
    return true;
  } catch (e) {
    await env.RELAY_DB.prepare("UPDATE relay_swap_payments SET status = 'take_failed', detail = ?, updated_at = ? WHERE id = ?").bind(String(e && e.message || e).slice(0, 200), now, hold.id).run();
    return false;
  }
}
export async function releaseHold(env, hold, why, o = {}) {
  const now = o.now || Date.now();
  try { await stripe(env, "POST", "payment_intents/" + hold.paymentIntent + "/cancel", {}, o); } catch { /* the hold lapses on its own after 7 days */ }
  await env.RELAY_DB.prepare("UPDATE relay_swap_payments SET status = 'released', detail = ?, updated_at = ? WHERE id = ?").bind(String(why || "").slice(0, 200), now, hold.id).run();
}

// Deleting a Relay account: the card is detached at Stripe and forgotten here. Records of swap payments are kept, because
// they're money owed to a shop; they hold no card details.
export async function forgetCard(env, shopperId, o = {}) {
  if (!env.RELAY_DB) return;
  await ensurePaymentTables(env.RELAY_DB);
  const row = await env.RELAY_DB.prepare("SELECT payment_method_id FROM relay_cards WHERE shopper_id = ?").bind(shopperId).first();
  if (row && row.payment_method_id && paymentsEnabled(env)) { try { await stripe(env, "POST", "payment_methods/" + row.payment_method_id + "/detach", {}, o); } catch { /* already gone */ } }
  await env.RELAY_DB.prepare("DELETE FROM relay_cards WHERE shopper_id = ?").bind(shopperId).run();
}

// Routes under /relay/my/card for a signed-in shopper.
export async function handleCardRoute(request, env, url, cors, shopper, o = {}) {
  const path = url.pathname;
  if (!path.startsWith("/relay/my/card")) return null;
  if (!env.RELAY_DB) return json({ error: "not_available" }, 503, cors);
  await ensurePaymentTables(env.RELAY_DB);
  const enabled = paymentsEnabled(env);
  if (path === "/relay/my/card" && request.method === "GET")
    return json({ enabled, testMode: true, publishableKey: enabled ? env.STRIPE_PUBLISHABLE_KEY : null, card: publicCard(await cardOf(env, shopper.id)) }, 200, cors);
  if (!enabled) return json({ error: "payments_off" }, 503, cors);
  try {
    if (path === "/relay/my/card/setup" && request.method === "POST") return json(await startSetup(env, shopper, o), 200, cors);
    if (path === "/relay/my/card/confirm" && request.method === "POST") { const [s, b] = await confirmSetup(env, shopper, await request.json().catch(() => null), o); return json(b, s, cors); }
    if (path === "/relay/my/card/remove" && request.method === "POST") { const [s, b] = await removeCard(env, shopper, o); return json(b, s, cors); }
  } catch (e) { return json({ error: "stripe_error", detail: String(e && e.message || e).slice(0, 160) }, 502, cors); }
  return json({ error: "not_found" }, 404, cors);
}
