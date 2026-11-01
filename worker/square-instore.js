// In-store (tap-to-pay) Square purchases: whose are they?
//
// A card payment at the till usually carries no email, so Relay can't link it the way it links online orders. Rules
// (see docs/square-pos-customer-identification.md): card digits, amount or time alone never prove who bought something.
//
//  1. Card remembered only once proven. When a Square order is linked to a shopper by email (the shop has their verified
//     email on the order or its receipt), Relay keeps a keyed hash of the card's Square fingerprint for that shop, tied to
//     the same keyed email hash. Nothing readable about the card is stored.
//  2. "Is this yours?" When that card is later used at the same shop with no email, the purchase is SUGGESTED to that
//     shopper only: shop, amount, time, card brand and last 4 (what's on their own card statement). The items appear in
//     their wallet only after they say it's theirs. Only purchases made after the card was proven are suggested, and if
//     more than one Relay shopper has proven the same card, nothing is suggested to anyone (a shared card).
//  3. Add a receipt. A shopper can claim one purchase with the receipt number, amount, day and card's last 4 from their
//     receipt. Exactly one Square payment must match all four, and it must not already belong to someone else. A claim
//     links that one purchase; it doesn't make Relay remember the card. 10 tries a day.
import { normaliseEmail, emailHash, ensureAuthTables } from "./auth.js";
import { ensureOnce } from "./once.js";
import { squareIsProduction, squareShopName } from "./square-env.js";
import { sq, squareOrderStatements, squareItemsOfVariations, ensureSquareOrderTables, SQUARE_ORDER } from "./square-orders.js";

const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
const CLAIMS_PER_DAY = 10;

export function ensureInstoreTables(db) {
  return ensureOnce(db, "square-instore", async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS square_card_anchors (scope TEXT NOT NULL, card_hash TEXT NOT NULL, email_hash TEXT NOT NULL,
      first_seen TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (scope, card_hash, email_hash))`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS square_instore_suggestions (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, email_hash TEXT NOT NULL,
      brand TEXT, last4 TEXT, amount_minor INTEGER, currency TEXT, paid_at TEXT, store TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, answered_at INTEGER)`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_instore_suggest_email ON square_instore_suggestions(email_hash, status)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS square_claim_attempts (id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, created_at INTEGER NOT NULL, ok INTEGER NOT NULL)").run();
  });
}

export async function cardHash(env, scope, fingerprint) {
  return emailHash(env.AUTH_SECRET, "card:" + scope + ":" + fingerprint);
}

// What Relay needs from a Square payment (never the full card).
export function paymentFacts(p) {
  const card = (p && p.card_details && p.card_details.card) || {};
  return { email: normaliseEmail(p && p.buyer_email_address), fingerprint: typeof card.fingerprint === "string" && card.fingerprint.length >= 8 ? card.fingerprint : null,
    last4: /^\d{4}$/.test(String(card.last_4 || "")) ? card.last_4 : null, brand: card.card_brand || null, paidAt: (p && p.created_at) || null,
    amountMinor: p && p.amount_money ? Number(p.amount_money.amount) : null, currency: p && p.amount_money ? p.amount_money.currency : null,
    receipt: p && p.receipt_number ? String(p.receipt_number) : null, status: p && p.status, orderId: p && p.order_id, locationId: p && p.location_id };
}

// A proven card: this card was used on an order already linked to this email.
export async function anchorStatement(env, scope, facts, eHash, now) {
  if (!facts.fingerprint || !eHash || !facts.paidAt) return null;
  await ensureInstoreTables(env.RELAY_DB);
  return env.RELAY_DB.prepare("INSERT OR IGNORE INTO square_card_anchors (scope, card_hash, email_hash, first_seen, created_at) VALUES (?,?,?,?,?)")
    .bind(scope, await cardHash(env, scope, facts.fingerprint), eHash, facts.paidAt, now);
}

// A card-only purchase: suggested to the one shopper who has proven this card at this shop before it was made.
export async function suggestionStatement(env, scope, orderId, facts, store, now) {
  if (!facts.fingerprint || !facts.paidAt) return null;
  const db = env.RELAY_DB;
  await ensureInstoreTables(db);
  const rows = ((await db.prepare("SELECT email_hash AS e, first_seen AS f FROM square_card_anchors WHERE scope = ? AND card_hash = ?")
    .bind(scope, await cardHash(env, scope, facts.fingerprint)).all()).results || []);
  const owners = [...new Set(rows.map(r => r.e))];
  if (owners.length !== 1) return null;                                   // nobody, or a shared card
  if (!rows.some(r => r.f <= facts.paidAt)) return null;                 // only purchases after the card was proven
  return db.prepare(`INSERT OR IGNORE INTO square_instore_suggestions (id, order_id, email_hash, brand, last4, amount_minor, currency, paid_at, store, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,'pending',?)`).bind(crypto.randomUUID(), orderId, owners[0], facts.brand, facts.last4, facts.amountMinor, facts.currency, facts.paidAt, store || null, now);
}

// Statements removing a shopper's remembered cards and suggestions (account deletion).
export async function instoreDeleteStatements(db, eHash) {
  await ensureInstoreTables(db);
  return [db.prepare("DELETE FROM square_card_anchors WHERE email_hash = ?").bind(eHash),
    db.prepare("DELETE FROM square_instore_suggestions WHERE email_hash = ?").bind(eHash)];
}

const label = (env) => env.SQUARE_DEFAULT_LABEL || "Relay Demo Store";

async function listSuggestions(env, shopper) {
  await ensureInstoreTables(env.RELAY_DB);
  const rows = ((await env.RELAY_DB.prepare(`SELECT s.id, s.order_id AS orderId, s.brand, s.last4, s.amount_minor AS amountMinor, s.currency, s.paid_at AS paidAt, s.store
    FROM square_instore_suggestions s WHERE s.email_hash = ? AND s.status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM retailer_order_emails e WHERE e.order_id = s.order_id) ORDER BY s.paid_at DESC LIMIT 20`).bind(shopper.emailHash).all()).results || []);
  return rows.map(r => ({ ...r, store: squareShopName(env, r.store) }));
}

async function answer(env, shopper, id, mine, now) {
  const db = env.RELAY_DB;
  await ensureInstoreTables(db);
  const s = await db.prepare("SELECT id, order_id AS orderId FROM square_instore_suggestions WHERE id = ? AND email_hash = ? AND status = 'pending'").bind(String(id || ""), shopper.emailHash).first();
  if (!s) return [404, { error: "not_found" }];
  if (!mine) {
    await db.prepare("UPDATE square_instore_suggestions SET status = 'not_mine', answered_at = ? WHERE id = ?").bind(now, s.id).run();
    return [200, { ok: true, added: false }];
  }
  if (await db.prepare("SELECT 1 AS x FROM retailer_order_emails WHERE order_id = ?").bind(s.orderId).first()) {
    await db.prepare("UPDATE square_instore_suggestions SET status = 'taken', answered_at = ? WHERE id = ?").bind(now, s.id).run();
    return [409, { error: "already_claimed" }];
  }
  await db.batch([
    db.prepare("INSERT INTO retailer_order_emails (order_id, email_hash, created_at) VALUES (?,?,?)").bind(s.orderId, shopper.emailHash, now),
    db.prepare("UPDATE square_instore_suggestions SET status = 'mine', answered_at = ? WHERE id = ?").bind(now, s.id)
  ]);
  return [200, { ok: true, added: true, orderId: s.orderId }];
}

// The Square shops a receipt can be claimed at (Relay's own Square account's active locations).
async function shops(env, f) {
  const locs = ((await sq(env, "/v2/locations", {}, f)).locations || []).filter(l => l.status === "ACTIVE");
  return locs.map(l => ({ id: l.id, name: squareShopName(env, l.business_name || l.name), merchantId: l.merchant_id || null, currency: l.currency || "GBP" }));
}

async function claim(env, shopper, body, f, now) {
  const db = env.RELAY_DB;
  await ensureInstoreTables(db); await ensureSquareOrderTables(db);
  const tries = (await db.prepare("SELECT COUNT(*) AS n FROM square_claim_attempts WHERE shopper_id = ? AND created_at > ?").bind(shopper.id, now - 86400000).first()).n;
  if (tries >= CLAIMS_PER_DAY) return [429, { error: "too_many_tries" }];
  const day = String(body && body.date || ""), amount = Math.round(Number(body && body.amountMinor)), last4 = String(body && body.last4 || "").trim();
  const receipt = String(body && body.receiptNumber || "").trim().replace(/^#/, "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !(amount > 0) || !/^\d{4}$/.test(last4) || !/^[A-Za-z0-9]{3,12}$/.test(receipt)) return [400, { error: "check_details" }];
  const all = await shops(env, f);
  const shop = all.find(s => s.id === String(body && body.locationId || "")) || (all.length === 1 ? all[0] : null);
  if (!shop) return [400, { error: "pick_shop" }];
  await db.prepare("INSERT INTO square_claim_attempts (id, shopper_id, created_at, ok) VALUES (?,?,?,0)").bind(crypto.randomUUID(), shopper.id, now).run();
  // The whole day (UK), with an hour either side for the time zone.
  const start = new Date(Date.parse(day + "T00:00:00Z") - 3600000).toISOString(), end = new Date(Date.parse(day + "T00:00:00Z") + 25 * 3600000).toISOString();
  const q = "/v2/payments?location_id=" + encodeURIComponent(shop.id) + "&begin_time=" + encodeURIComponent(start) + "&end_time=" + encodeURIComponent(end) + "&last_4=" + last4 + "&limit=100";
  const matches = ((await sq(env, q, {}, f)).payments || []).map(paymentFacts)
    .filter(p => p.status === "COMPLETED" && p.amountMinor === amount && p.last4 === last4 && p.receipt && p.receipt.toLowerCase() === receipt.toLowerCase() && p.orderId);
  if (matches.length !== 1) return [404, { error: "no_match" }];
  const m = matches[0];
  const order = (await sq(env, "/v2/orders/" + encodeURIComponent(m.orderId), {}, f)).order;
  if (!order) return [404, { error: "no_match" }];
  const { id, statements } = squareOrderStatements(db, order, { id: shop.id, currency: shop.currency }, await squareItemsOfVariations(db));
  const owner = await db.prepare("SELECT email_hash AS e FROM retailer_order_emails WHERE order_id = ?").bind(id).first();
  if (owner && owner.e !== shopper.emailHash) return [409, { error: "already_claimed" }];
  if (owner) return [200, { ok: true, orderId: id, already: true }];
  statements.push(db.prepare("INSERT INTO retailer_order_emails (order_id, email_hash, created_at) VALUES (?,?,?)").bind(id, shopper.emailHash, now));
  statements.push(db.prepare("UPDATE square_claim_attempts SET ok = 1 WHERE shopper_id = ? AND created_at = ?").bind(shopper.id, now));
  await db.batch(statements);
  return [200, { ok: true, orderId: id, store: shop.name }];
}

// Test shop only: a card-only purchase at the till (no customer, no email), as a tap-to-pay customer would make.
async function testTap(env, shopper, body, f, now, linkOne) {
  const db = env.RELAY_DB;
  await ensureSquareOrderTables(db);
  const today = (await db.prepare("SELECT COUNT(*) AS n FROM square_test_orders WHERE shopper_id = ? AND created_at > ?").bind(shopper.id, now - 86400000).first()).n;
  if (today >= 5) return [429, { error: "too_many_test_orders" }];
  const variationId = String(body && body.variationId || "");
  const known = await db.prepare(`SELECT 1 AS x FROM retailer_catalog_variants v JOIN retailer_catalog_items i ON i.id = v.item_id
    WHERE i.provider = 'square_sandbox' AND i.store_label = ? AND v.external_variant_id = ?`).bind(label(env), variationId).first();
  if (!known) return [400, { error: "not_a_test_item" }];
  const location = ((await sq(env, "/v2/locations", {}, f)).locations || []).find(l => l.status === "ACTIVE");
  if (!location) return [503, { error: "square_unavailable" }];
  const created = (await sq(env, "/v2/orders", { method: "POST", body: JSON.stringify({ idempotency_key: crypto.randomUUID(),
    order: { location_id: location.id, reference_id: "relay-test-tap", line_items: [{ catalog_object_id: variationId, quantity: "1" }] } }) }, f)).order;
  const payment = (await sq(env, "/v2/payments", { method: "POST", body: JSON.stringify({ idempotency_key: crypto.randomUUID(), source_id: "cnon:card-nonce-ok",
    amount_money: created.total_money, order_id: created.id, location_id: location.id, autocomplete: true, note: "Relay sandbox in-store test" }) }, f)).payment || {};
  const order = (await sq(env, "/v2/orders/" + encodeURIComponent(created.id), {}, f)).order || created;
  const { id, statements } = squareOrderStatements(db, order, { id: location.id, currency: location.currency }, await squareItemsOfVariations(db));
  statements.push(db.prepare("INSERT INTO square_test_orders (id,shopper_id,order_id,created_at) VALUES (?,?,?,?)").bind(crypto.randomUUID(), shopper.id, id, now));
  await db.batch(statements);
  // What Relay's hourly check would do with it, straight away.
  const r = await linkOne(env, [{ id, order }], f, { scope: "square:" + (location.merchant_id || location.id), store: squareShopName(env, location.business_name || location.name), now });
  const facts = paymentFacts(payment);
  return [200, { ok: true, orderId: id, suggested: r.suggested > 0, card: facts.brand && facts.last4 ? facts.brand + " •• " + facts.last4 : null, receiptNumber: facts.receipt,
    message: r.suggested > 0 ? "Test card payment made at the till. Relay recognised the card and is asking if it's yours."
      : "Test card payment made at the till. Relay doesn't know this card yet, so it can't tell it's yours. Add it with the receipt instead." }];
}

// Routes under /relay/my/instore/* (and the test tap under /relay/my/testing/square-tap).
export async function handleInstoreRoute(request, env, url, cors, shopper, o = {}) {
  const path = url.pathname;
  if (!path.startsWith("/relay/my/instore/") && path !== "/relay/my/testing/square-tap") return null;
  if (!env.SQUARE_ACCESS_TOKEN || !env.AUTH_SECRET) return json({ error: "not_available" }, 404, cors);
  await ensureAuthTables(env.RELAY_DB); await ensureInstoreTables(env.RELAY_DB);
  const f = o.fetchImpl || ((...a) => fetch(...a)), now = o.now || Date.now();
  try {
    if (path === "/relay/my/instore/suggestions" && request.method === "GET") return json({ suggestions: await listSuggestions(env, shopper) }, 200, cors);
    const ans = /^\/relay\/my\/instore\/suggestions\/([A-Za-z0-9-]{8,64})$/.exec(path);
    if (ans && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const [s, out] = await answer(env, shopper, ans[1], body && body.answer === "mine", now);
      return json(out, s, cors);
    }
    if (path === "/relay/my/instore/shops" && request.method === "GET") return json({ shops: (await shops(env, f)).map(s => ({ id: s.id, name: s.name })) }, 200, cors);
    if (path === "/relay/my/instore/claim" && request.method === "POST") {
      const [s, out] = await claim(env, shopper, await request.json().catch(() => ({})), f, now);
      return json(out, s, cors);
    }
    if (path === "/relay/my/testing/square-tap" && request.method === "POST") {
      if (squareIsProduction(env)) return json({ error: "sandbox_only" }, 404, cors);
      const { linkSquareOrderEmails } = await import("./square-orders.js");
      const [s, out] = await testTap(env, shopper, await request.json().catch(() => ({})), f, now, linkSquareOrderEmails);
      return json(out, s, cors);
    }
  } catch (e) {
    return json({ error: "square_unavailable", detail: String(e && e.message || e).slice(0, 120) }, 502, cors);
  }
  return json({ error: "not_found" }, 404, cors);
}

export { SQUARE_ORDER };
