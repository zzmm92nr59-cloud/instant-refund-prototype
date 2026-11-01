// Square orders in Relay: whose order each one is, and a test-order tool for the Square sandbox.
//
// Square doesn't send the customer's email with an order, so Relay asks Square for it: the customer profile on the order
// (Customers API), or else the receipt email on the order's payment. As for Shopify orders, only a keyed hash of the email
// is stored, so an order appears in a shopper's wallet only when it matches their own verified sign-in email.
//
// Test orders (sandbox only, never on live Square): a signed-in shopper can place an order in Relay's own Square test shop
// under their sign-in email, paid with Square's sandbox test payment (no card, no real money). Up to 5 a day.
import { normaliseEmail, emailHash, ensureAuthTables } from "./auth.js";
import { squareHost, squareIsProduction } from "./square-env.js";
import { ensureOnce } from "./once.js";

export const SQUARE_ORDER = /^square:sandbox:order:([A-Za-z0-9_-]{4,64})$/;
export const SQUARE_CONNECTION = /^square:sandbox:([A-Za-z0-9_-]{4,64})$/;
const LOOKUP_CALLS_PER_RUN = 8, TEST_ORDERS_PER_DAY = 5;
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

// One call to Square's API. The fetch can be swapped for a fake in tests.
export async function sq(env, path, init = {}, f = (...a) => fetch(...a)) {
  const { token, ...rest } = init;
  const key = token || env.SQUARE_ACCESS_TOKEN;
  if (!key) throw Error("Square access token missing");
  const r = await f(squareHost(env) + path, { ...rest,
    headers: { Authorization: "Bearer " + key, "Square-Version": "2026-09-16", "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = Error("Square HTTP " + r.status + " " + ((body.errors && body.errors[0] && body.errors[0].code) || "unknown")); e.status = r.status; throw e; }
  return body;
}

export function ensureSquareOrderTables(db) {
  return ensureOnce(db, "square-orders", async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS square_email_checks (order_id TEXT PRIMARY KEY, checked_at INTEGER NOT NULL, found INTEGER NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS square_test_orders (id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, order_id TEXT NOT NULL, created_at INTEGER NOT NULL)").run();
  });
}

// Which product each size/colour (Square "variation") belongs to, from the catalogue Relay already read.
export async function squareItemsOfVariations(db) {
  const rows = ((await db.prepare(`SELECT v.external_variant_id AS v, i.external_item_id AS i FROM retailer_catalog_variants v
    JOIN retailer_catalog_items i ON i.id = v.item_id WHERE i.provider = 'square_sandbox'`).all()).results || []);
  return new Map(rows.map(r => [r.v, r.i]));
}

// Database statements that save one Square order and its lines. Each line keeps the product and the exact size/colour bought,
// which is what returns and swaps need.
export function squareOrderStatements(db, order, location, itemOfVariation) {
  const id = "square:sandbox:order:" + order.id, connection = "square:sandbox:" + location.id;
  const currency = (order.total_money && order.total_money.currency) || location.currency || "GBP";
  const minor = m => Number.isSafeInteger(m && m.amount) ? m.amount : 0;
  const statements = [
    db.prepare("INSERT OR IGNORE INTO retailer_connections (id,provider,merchant_external_id) VALUES (?,?,?)").bind(connection, "square_sandbox", location.id),
    db.prepare(`INSERT INTO retailer_orders (id,connection_id,external_order_id,external_customer_id,ordered_at,amount_minor,currency,status)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,external_order_id) DO UPDATE SET
      external_customer_id=excluded.external_customer_id, amount_minor=excluded.amount_minor, currency=excluded.currency, status=excluded.status`)
      .bind(id, connection, order.id, order.customer_id || null, order.created_at, minor(order.total_money), currency, order.state || "UNKNOWN")
  ];
  (order.line_items || []).forEach((line, index) => {
    const quantity = Number(line.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return;
    const lineId = line.uid || String(index), variation = line.catalog_object_id || null;
    statements.push(db.prepare(`INSERT INTO order_items (id,order_id,external_line_item_id,product_id,variant_id,title,quantity,price_minor,currency)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(order_id,external_line_item_id) DO UPDATE SET
      title=excluded.title, quantity=excluded.quantity, price_minor=excluded.price_minor, currency=excluded.currency,
      product_id=excluded.product_id, variant_id=excluded.variant_id`)
      .bind(id + ":item:" + lineId, id, lineId, variation ? (itemOfVariation.get(variation) || null) : null, variation,
        line.name || "Unnamed item", quantity, minor(line.base_price_money), (line.base_price_money && line.base_price_money.currency) || currency));
  });
  return { id, statements };
}

// Finds the customer's email for Square orders not yet linked to anyone, a few per run (each costs a call to Square).
// An order with no email anywhere is remembered so it isn't asked about again.
export async function linkSquareOrderEmails(env, list, f, o = {}) {
  const db = env.RELAY_DB;
  if (!env.AUTH_SECRET || String(env.AUTH_SECRET).length < 16 || !list.length) return { linked: 0, calls: 0 };
  await ensureAuthTables(db); await ensureSquareOrderTables(db);
  const ids = list.map(x => x.id), done = new Set();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90), q = part.map(() => "?").join(",");
    for (const r of ((await db.prepare(`SELECT order_id AS id FROM retailer_order_emails WHERE order_id IN (${q}) UNION SELECT order_id AS id FROM square_email_checks WHERE order_id IN (${q})`)
      .bind(...part, ...part).all()).results || [])) done.add(r.id);
  }
  let calls = 0, linked = 0;
  const budget = o.budget ?? LOOKUP_CALLS_PER_RUN, now = o.now || Date.now(), statements = [];
  for (const { id, order } of list) {
    if (done.has(id) || calls >= budget) continue;
    let email = null;
    try {
      if (order.customer_id) { calls++; email = normaliseEmail(((await sq(env, "/v2/customers/" + encodeURIComponent(order.customer_id), { token: o.token }, f)).customer || {}).email_address); }
      for (const t of order.tenders || []) {
        if (email || !t.payment_id || calls >= budget) break;
        calls++; email = normaliseEmail(((await sq(env, "/v2/payments/" + encodeURIComponent(t.payment_id), { token: o.token }, f)).payment || {}).buyer_email_address);
      }
    } catch { continue; /* asked again next run */ }
    if (email) {
      linked++;
      statements.push(db.prepare("INSERT INTO retailer_order_emails (order_id,email_hash,created_at) VALUES (?,?,?) ON CONFLICT(order_id) DO UPDATE SET email_hash=excluded.email_hash")
        .bind(id, await emailHash(env.AUTH_SECRET, email), now));
    } else statements.push(db.prepare("INSERT OR REPLACE INTO square_email_checks (order_id,checked_at,found) VALUES (?,?,0)").bind(id, now));
  }
  if (statements.length) await db.batch(statements);
  return { linked, calls };
}

// ---- Test orders (sandbox only) ---------------------------------------------------------------------------------
const TEST_LABEL = (env) => env.SQUARE_DEFAULT_LABEL || "Relay Demo Store";

// Products in Relay's Square test shop that come in more than one size/colour (so swaps can be tried), with a price.
async function testItems(env) {
  const rows = ((await env.RELAY_DB.prepare(`SELECT v.external_variant_id AS variationId, i.title AS product, v.title AS variant, v.price_minor AS priceMinor,
      (SELECT MAX(s.quantity) FROM retailer_inventory_snapshots s WHERE s.variant_id = v.id) AS quantity,
      (SELECT COUNT(*) FROM retailer_catalog_variants w WHERE w.item_id = i.id) AS siblings
    FROM retailer_catalog_variants v JOIN retailer_catalog_items i ON i.id = v.item_id
    WHERE i.provider = 'square_sandbox' AND i.store_label = ? AND v.currency = 'GBP' AND v.price_minor > 0
    ORDER BY siblings DESC, i.title, v.title LIMIT 60`).bind(TEST_LABEL(env)).all()).results || []);
  return rows.map(r => ({ ...r, inStock: Number(r.quantity) > 0, swappable: Number(r.siblings) > 1 }));
}

async function placeTestOrder(env, shopper, body, f, now) {
  const db = env.RELAY_DB;
  const variationId = String(body && body.variationId || "");
  const item = (await testItems(env)).find(x => x.variationId === variationId);
  if (!item) return [400, { error: "not_a_test_item" }];
  const today = (await db.prepare("SELECT COUNT(*) AS n FROM square_test_orders WHERE shopper_id = ? AND created_at > ?").bind(shopper.id, now - 86400000).first()).n;
  if (today >= TEST_ORDERS_PER_DAY) return [429, { error: "too_many_test_orders" }];
  const email = normaliseEmail(shopper.email);
  if (!email) return [400, { error: "no_email" }];
  const location = ((await sq(env, "/v2/locations", {}, f)).locations || []).find(l => l.status === "ACTIVE");
  if (!location) return [503, { error: "square_unavailable" }];
  // The shopper as a customer of the test shop (found by email, or added).
  const found = await sq(env, "/v2/customers/search", { method: "POST", body: JSON.stringify({ limit: 1, query: { filter: { email_address: { exact: email } } } }) }, f);
  let customer = (found.customers || [])[0];
  if (!customer) customer = (await sq(env, "/v2/customers", { method: "POST", body: JSON.stringify({ idempotency_key: crypto.randomUUID(), email_address: email, note: "Relay test customer" }) }, f)).customer;
  const created = (await sq(env, "/v2/orders", { method: "POST", body: JSON.stringify({ idempotency_key: crypto.randomUUID(),
    order: { location_id: location.id, customer_id: customer.id, reference_id: "relay-test", line_items: [{ catalog_object_id: variationId, quantity: "1" }] } }) }, f)).order;
  // Square's sandbox test payment: no card details, no real money.
  await sq(env, "/v2/payments", { method: "POST", body: JSON.stringify({ idempotency_key: crypto.randomUUID(), source_id: "cnon:card-nonce-ok",
    amount_money: created.total_money, order_id: created.id, customer_id: customer.id, location_id: location.id, buyer_email_address: email, autocomplete: true,
    note: "Relay sandbox test order" }) }, f);
  const order = (await sq(env, "/v2/orders/" + encodeURIComponent(created.id), {}, f)).order || created;
  const { id, statements } = squareOrderStatements(db, order, { id: location.id, currency: location.currency }, await squareItemsOfVariations(db));
  statements.push(db.prepare("INSERT INTO retailer_order_emails (order_id,email_hash,created_at) VALUES (?,?,?) ON CONFLICT(order_id) DO UPDATE SET email_hash=excluded.email_hash")
    .bind(id, shopper.emailHash, now));
  statements.push(db.prepare("INSERT INTO square_test_orders (id,shopper_id,order_id,created_at) VALUES (?,?,?,?)").bind(crypto.randomUUID(), shopper.id, id, now));
  await db.batch(statements);
  return [200, { ok: true, orderId: id, product: item.product, variant: item.variant, totalMinor: (order.total_money && order.total_money.amount) || item.priceMinor,
    store: TEST_LABEL(env), message: "Test order placed at " + TEST_LABEL(env) + " (Square sandbox, no real money). It's now in your wallet." }];
}

// Routes under /relay/my/testing/square-* for a signed-in shopper. Off entirely on live Square.
export async function handleSquareTestRoute(request, env, url, cors, shopper, o = {}) {
  const path = url.pathname;
  if (!path.startsWith("/relay/my/testing/square-")) return null;
  if (squareIsProduction(env) || !env.SQUARE_ACCESS_TOKEN) return json({ error: "sandbox_only" }, 404, cors);
  await ensureSquareOrderTables(env.RELAY_DB);
  const f = o.fetchImpl || ((...a) => fetch(...a));
  if (path === "/relay/my/testing/square-items" && request.method === "GET")
    return json({ store: TEST_LABEL(env), items: await testItems(env) }, 200, cors);
  if (path === "/relay/my/testing/square-order" && request.method === "POST") {
    try {
      const [status, out] = await placeTestOrder(env, shopper, await request.json().catch(() => ({})), f, o.now || Date.now());
      return json(out, status, cors);
    } catch (e) {
      return json({ error: "square_refused", detail: String(e && e.message || e).slice(0, 120) }, 502, cors);
    }
  }
  return json({ error: "not_found" }, 404, cors);
}

// Square orders in the wallet: the shop's name, and the size/colour and picture of each item, from the catalogue Relay already read.
// Swaps and returns aren't offered on Square orders yet, so those stay off.
export async function enrichSquarePurchases(env, purchases) {
  const sqOrders = purchases.filter(o => SQUARE_CONNECTION.test(String(o.retailer || "")));
  if (!sqOrders.length) return purchases;
  const keys = [...new Set(sqOrders.flatMap(o => (o.items || []).map(i => i.variantId).filter(Boolean)).map(v => "square:sandbox:variant:" + v))];
  const rows = new Map();
  for (let i = 0; i < keys.length; i += 90) {
    const part = keys.slice(i, i + 90);
    for (const r of ((await env.RELAY_DB.prepare(`SELECT v.id AS id, v.title AS variant, i.image_url AS imageUrl, i.store_label AS store
        FROM retailer_catalog_variants v JOIN retailer_catalog_items i ON i.id = v.item_id WHERE v.id IN (${part.map(() => "?").join(",")})`).bind(...part).all()).results || []))
      rows.set(r.id, r);
  }
  for (const o of sqOrders) {
    let store = null;
    for (const it of o.items || []) {
      const v = it.variantId ? rows.get("square:sandbox:variant:" + it.variantId) : null;
      if (v) { it.variant = v.variant && !/^(default|regular)$/i.test(v.variant) ? v.variant : null; it.imageUrl = v.imageUrl || null; store = store || v.store; }
      it.exchangeable = false; it.returnable = false;
    }
    o.store = o.store || store || TEST_LABEL(env);
    o.provider = "square";
  }
  return purchases;
}
