// Square orders in Relay: whose order each one is, and a test-order tool for the Square sandbox.
//
// Square doesn't send the customer's email with an order, so Relay asks Square for it: the customer profile on the order
// (Customers API), or else the receipt email on the order's payment. As for Shopify orders, only a keyed hash of the email
// is stored, so an order appears in a shopper's wallet only when it matches their own verified sign-in email.
//
// Test orders (sandbox only, never on live Square): a signed-in shopper can place an order in Relay's own Square test shop
// under their sign-in email, paid with Square's sandbox test payment (no card, no real money). Up to 5 a day.
import { normaliseEmail, emailHash, ensureAuthTables } from "./auth.js";
import { squareHost, squareIsProduction, squareShopName } from "./square-env.js";
import { ensureOnce } from "./once.js";
import { ensureReturnsTables, REASON_TEXT, esc, clean } from "./returns.js";
import { RELAY_RETURN_LIMIT_DAYS } from "./shop-returns.js";

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

// What account deletion removes: the test orders a shopper made with the testing tool.
export async function squareOrderDeleteStatements(db, shopperId) {
  await ensureSquareOrderTables(db);
  return [db.prepare("DELETE FROM square_test_orders WHERE shopper_id = ?").bind(shopperId)];
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

// Finds whose Square orders are not yet linked to anyone, a few per run (each costs a call or two to Square):
//  - the receipt email on the order's payment, else the email on the order's customer profile: linked to that email, and
//    the card used is remembered (hashed) as proven for that shopper at this shop (square-instore.js);
//  - no email but a card already proven by one shopper at this shop: suggested to that shopper ("Is this yours?").
// An order with no email anywhere is remembered so it isn't asked about again.
export async function linkSquareOrderEmails(env, list, f, o = {}) {
  const db = env.RELAY_DB;
  if (!env.AUTH_SECRET || String(env.AUTH_SECRET).length < 16 || !list.length) return { linked: 0, calls: 0, suggested: 0 };
  await ensureAuthTables(db); await ensureSquareOrderTables(db);
  const { paymentFacts, anchorStatement, suggestionStatement } = await import("./square-instore.js");
  const ids = list.map(x => x.id), done = new Set();
  // Each id is bound twice (two tables), and D1 allows at most 100 bound values a query: 45 ids at a time.
  for (let i = 0; i < ids.length; i += 45) {
    const part = ids.slice(i, i + 45), q = part.map(() => "?").join(",");
    for (const r of ((await db.prepare(`SELECT order_id AS id FROM retailer_order_emails WHERE order_id IN (${q}) UNION SELECT order_id AS id FROM square_email_checks WHERE order_id IN (${q})`)
      .bind(...part, ...part).all()).results || [])) done.add(r.id);
  }
  let calls = 0, linked = 0, suggested = 0;
  const budget = o.budget ?? LOOKUP_CALLS_PER_RUN, now = o.now || Date.now(), scope = o.scope || "square:default";
  const statements = [], cardOnly = [];
  for (const { id, order } of list) {
    if (done.has(id) || calls >= budget) continue;
    let facts = { email: null, fingerprint: null }, email = null;
    try {
      const t = (order.tenders || []).find(x => x.payment_id || x.id);
      if (t) { calls++; facts = paymentFacts((await sq(env, "/v2/payments/" + encodeURIComponent(t.payment_id || t.id), { token: o.token }, f)).payment || {}); email = facts.email; }
      if (!email && order.customer_id && calls < budget) { calls++; email = normaliseEmail(((await sq(env, "/v2/customers/" + encodeURIComponent(order.customer_id), { token: o.token }, f)).customer || {}).email_address); }
      else if (!email && order.customer_id) continue; // out of calls: asked next run
    } catch { continue; /* asked again next run */ }
    if (email) {
      linked++;
      const eHash = await emailHash(env.AUTH_SECRET, email);
      statements.push(db.prepare("INSERT INTO retailer_order_emails (order_id,email_hash,created_at) VALUES (?,?,?) ON CONFLICT(order_id) DO UPDATE SET email_hash=excluded.email_hash")
        .bind(id, eHash, now));
      const anchor = await anchorStatement(env, scope, facts, eHash, now);
      if (anchor) statements.push(anchor);
    } else {
      statements.push(db.prepare("INSERT OR REPLACE INTO square_email_checks (order_id,checked_at,found) VALUES (?,?,0)").bind(id, now));
      if (facts.fingerprint) cardOnly.push({ id, facts });
    }
  }
  if (statements.length) await db.batch(statements);
  // Card-only purchases, after this run's proven cards are saved.
  const suggestions = [];
  for (const c of cardOnly) { const st = await suggestionStatement(env, scope, c.id, c.facts, o.store || null, now); if (st) { suggestions.push(st); suggested++; } }
  if (suggestions.length) await db.batch(suggestions);
  return { linked, calls, suggested };
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
  const paid = await sq(env, "/v2/payments", { method: "POST", body: JSON.stringify({ idempotency_key: crypto.randomUUID(), source_id: "cnon:card-nonce-ok",
    amount_money: created.total_money, order_id: created.id, customer_id: customer.id, location_id: location.id, buyer_email_address: email, autocomplete: true,
    note: "Relay sandbox test order" }) }, f);
  const order = (await sq(env, "/v2/orders/" + encodeURIComponent(created.id), {}, f)).order || created;
  const { id, statements } = squareOrderStatements(db, order, { id: location.id, currency: location.currency }, await squareItemsOfVariations(db));
  statements.push(db.prepare("INSERT INTO retailer_order_emails (order_id,email_hash,created_at) VALUES (?,?,?) ON CONFLICT(order_id) DO UPDATE SET email_hash=excluded.email_hash")
    .bind(id, shopper.emailHash, now));
  statements.push(db.prepare("INSERT INTO square_test_orders (id,shopper_id,order_id,created_at) VALUES (?,?,?,?)").bind(crypto.randomUUID(), shopper.id, id, now));
  // The order is linked by the shopper's verified email, so the card used is proven for them at this shop.
  const { paymentFacts, anchorStatement } = await import("./square-instore.js");
  const anchor = await anchorStatement(env, "square:" + (location.merchant_id || location.id), paymentFacts((paid && paid.payment) || {}), shopper.emailHash, now);
  if (anchor) statements.push(anchor);
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
  if (path === "/relay/my/testing/square-refund" && request.method === "POST") {
    try {
      const [status, out] = await testRefund(env, shopper, await request.json().catch(() => ({})), f, o.now || Date.now());
      return json(out, status, cors);
    } catch (e) {
      console.error("square_refused", String(e && e.message || e).slice(0, 120)); return json({ error: "square_refused" }, 502, cors);
    }
  }
  if (path === "/relay/my/testing/square-order" && request.method === "POST") {
    try {
      const [status, out] = await placeTestOrder(env, shopper, await request.json().catch(() => ({})), f, o.now || Date.now());
      return json(out, status, cors);
    } catch (e) {
      console.error("square_refused", String(e && e.message || e).slice(0, 120)); return json({ error: "square_refused" }, 502, cors);
    }
  }
  return json({ error: "not_found" }, 404, cors);
}

// Square orders in the wallet: the shop's name, the size/colour and picture of each item (from the catalogue Relay already
// read), and whether it can be returned (no return or swap yet) or already has a return. Square shops can't set their own
// returns period in Relay yet, so this is Relay's own limit on starting a return (shop-returns.js): no date is shown for it.
const RETURN_WINDOW_DAYS = RELAY_RETURN_LIMIT_DAYS;
export async function enrichSquarePurchases(env, purchases, o = {}) {
  const sqOrders = purchases.filter(p => SQUARE_CONNECTION.test(String(p.retailer || "")));
  if (!sqOrders.length) return purchases;
  const db = env.RELAY_DB, now = o.now || Date.now();
  const inList = (n) => "(" + Array(n).fill("?").join(",") + ")";
  const keys = [...new Set(sqOrders.flatMap(p => (p.items || []).map(i => i.variantId).filter(Boolean)).map(v => "square:sandbox:variant:" + v))];
  const rows = new Map();
  for (let i = 0; i < keys.length; i += 90) {
    const part = keys.slice(i, i + 90);
    for (const r of ((await db.prepare(`SELECT v.id AS id, v.title AS variant, i.image_url AS imageUrl, i.store_label AS store
        FROM retailer_catalog_variants v JOIN retailer_catalog_items i ON i.id = v.item_id WHERE v.id IN ${inList(part.length)}`).bind(...part).all()).results || []))
      rows.set(r.id, r);
  }
  const ids = sqOrders.map(p => p.id).slice(0, 90);
  let rets = [], tests = new Set();
  try {
    await ensureReturnsTables(db);
    rets = ((await db.prepare(`SELECT order_id AS orderId, line_id AS lineId, status, return_ref AS ref, refund_minor AS refundMinor, refund_issued_at AS refundedAt
      FROM relay_returns WHERE status != 'cancelled' AND order_id IN ${inList(ids.length)} ORDER BY created_at DESC`).bind(...ids).all()).results || []);
  } catch { rets = []; }
  try {
    await ensureSquareOrderTables(db);
    for (const r of ((await db.prepare(`SELECT order_id AS id FROM square_test_orders WHERE order_id IN ${inList(ids.length)}`).bind(...ids).all()).results || [])) tests.add(r.id);
  } catch { /* no test orders yet */ }
  const retOf = new Map();
  for (const r of rets) { const k = r.orderId + "|" + r.lineId; if (!retOf.has(k)) retOf.set(k, r); }
  for (const p of sqOrders) {
    let store = null;
    const days = p.orderedAt ? (now - Date.parse(p.orderedAt)) / 86400000 : 999;
    for (const it of p.items || []) {
      const v = it.variantId ? rows.get("square:sandbox:variant:" + it.variantId) : null;
      if (v) { it.variant = v.variant && !/^(default|regular)$/i.test(v.variant) ? v.variant : null; it.imageUrl = v.imageUrl || null; store = store || v.store; }
      const ret = retOf.get(p.id + "|" + it.lineId) || null;
      if (ret) it.returnInfo = { status: ret.status, ref: ret.ref, trackingNumber: null, refundMinor: Number.isFinite(ret.refundMinor) ? ret.refundMinor : null, refundedAt: ret.refundedAt || null };
      const open = !ret && days <= RETURN_WINDOW_DAYS && p.status === "COMPLETED";
      it.returnable = open;
      it.exchangeable = open && Boolean(it.productId && it.variantId);
    }
    p.store = p.store || store || TEST_LABEL(env);
    p.provider = "square";
    if (tests.has(p.id)) p.testOrder = true;
  }
  await addSquareSwaps(env, sqOrders, o);
  return purchases;
}

// ---- Returns at Square shops ---------------------------------------------------------------------------------------
const locationOf = (connection) => (SQUARE_CONNECTION.exec(String(connection || "")) || [])[1] || null;
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,}$/i;

// Emails the shop about a return, at the business email on its Square location. True only if the email was accepted.
export async function notifySquareShopOfReturn(env, r, o = {}) {
  const f = o.fetchImpl || ((...a) => fetch(...a));
  if (!env.RESEND_API_KEY || !env.SQUARE_ACCESS_TOKEN) return false;
  try {
    const loc = locationOf(r.connection);
    if (!loc) return false;
    const location = (await sq(env, "/v2/locations/" + encodeURIComponent(loc), {}, f)).location || {};
    const to = String(location.business_email || "").trim();
    if (!EMAIL.test(to)) return false;
    const shopName = clean(squareShopName(env, location.business_name || location.name), 80);
    const item = clean(r.itemTitle || "an item", 120), qty = Number(r.quantity) || 1;
    const price = "£" + (Math.round(Number(r.priceMinor) || 0) / 100).toFixed(2);
    const reason = REASON_TEXT[r.reason] || "Not given";
    const orderRef = clean(r.externalOrderId || "", 64);
    const text = ["A customer has asked to return an item through Relay.", "",
      "Item: " + item + (qty > 1 ? " (x" + qty + ")" : "") + ", " + price, "Reason: " + reason, "Relay reference: " + r.returnRef,
      "Square order: " + orderRef, "",
      "The customer may bring it back to the shop or send it using your usual returns process, quoting the Relay reference.",
      "Relay has not issued a refund. When you refund it in Square (against this order), Relay will show the customer it's refunded.", "",
      "You're getting this because " + shopName + " is connected to Relay."].join("\n");
    const html = "<p>A customer has asked to return an item through Relay.</p><table style=\"border-collapse:collapse\">" +
      "<tr><td style=\"padding:2px 12px 2px 0;color:#5b6275\">Item</td><td>" + esc(item) + (qty > 1 ? " (x" + qty + ")" : "") + ", " + esc(price) + "</td></tr>" +
      "<tr><td style=\"padding:2px 12px 2px 0;color:#5b6275\">Reason</td><td>" + esc(reason) + "</td></tr>" +
      "<tr><td style=\"padding:2px 12px 2px 0;color:#5b6275\">Relay reference</td><td style=\"font-family:monospace\">" + esc(r.returnRef) + "</td></tr>" +
      "<tr><td style=\"padding:2px 12px 2px 0;color:#5b6275\">Square order</td><td style=\"font-family:monospace\">" + esc(orderRef) + "</td></tr></table>" +
      "<p>The customer may bring it back to the shop or send it using your usual returns process, quoting the Relay reference.</p>" +
      "<p>Relay has <b>not</b> issued a refund. When you refund it in Square (against this order), Relay will show the customer it's refunded.</p>" +
      "<p style=\"color:#5b6275;font-size:13px\">You're getting this because " + esc(shopName) + " is connected to Relay.</p>";
    const sent = await f("https://api.resend.com/emails", { method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.RELAY_EMAIL_FROM || "Relay <onboarding@resend.dev>", to: [to], subject: "Return request " + r.returnRef + " (Square order)", text, html }),
      signal: AbortSignal.timeout(10000) });
    return Boolean(sent && sent.ok);
  } catch { return false; }
}

// Marks Relay returns on Square orders as refunded once the shop's refund is complete in Square. An itemised Square return
// for that line counts first; otherwise a completed refund on the order not already matched to another return, of at least
// the item's price. Never creates or changes anything at Square.
export async function syncSquareRefunds(env, f, o = {}) {
  const db = env.RELAY_DB;
  if (!db || !env.SQUARE_ACCESS_TOKEN) return { checked: 0, refunded: 0 };
  await ensureReturnsTables(db);
  const now = o.now || Date.now();
  const where = o.orderId ? "AND order_id = ?" : "";
  const open = ((await db.prepare(`SELECT id, order_id AS orderId, line_id AS lineId, quantity, price_minor AS priceMinor FROM relay_returns
    WHERE shop LIKE 'square:%' AND status = 'requested' AND created_at > ? ${where} ORDER BY created_at LIMIT 40`)
    .bind(now - 90 * 86400000, ...(o.orderId ? [o.orderId] : [])).all()).results || []);
  const byOrder = new Map();
  for (const r of open) { if (!byOrder.has(r.orderId)) byOrder.set(r.orderId, []); byOrder.get(r.orderId).push(r); }
  let checked = 0, refunded = 0;
  const statements = [];
  for (const [orderId, list] of byOrder) {
    if (checked >= (o.budget ?? 10)) break;
    const ext = (SQUARE_ORDER.exec(orderId) || [])[1];
    if (!ext) continue;
    checked++;
    let order;
    try { order = (await sq(env, "/v2/orders/" + encodeURIComponent(ext), {}, f)).order; } catch { continue; }
    if (!order) continue;
    // Completed refunds, from the order's payments (Square's refund records say COMPLETED only once the money has gone back).
    // If the payments can't be read, the order's own refund list is used (Square marks those APPROVED once done).
    let pool = 0, viaPayments = false;
    for (const t of (order.tenders || []).slice(0, 3)) {
      const pid = t.payment_id || t.id;
      if (!pid) continue;
      try {
        const pay = (await sq(env, "/v2/payments/" + encodeURIComponent(pid), {}, f)).payment || {};
        viaPayments = true;
        for (const rid of (pay.refund_ids || []).slice(0, 10)) {
          const rf = (await sq(env, "/v2/refunds/" + encodeURIComponent(rid), {}, f)).refund || {};
          if (rf.status === "COMPLETED") pool += Number(rf.amount_money && rf.amount_money.amount) || 0;
        }
      } catch { /* fall back to the order's list */ }
    }
    if (!viaPayments) pool = (order.refunds || []).filter(x => x.status === "APPROVED" || x.status === "COMPLETED")
      .reduce((n, x) => n + (Number(x.amount_money && x.amount_money.amount) || 0), 0);
    if (!pool) continue;
    // Refunds already matched to returns on this order are taken out of the pool first.
    const already = (await db.prepare("SELECT COALESCE(SUM(refund_minor),0) AS n FROM relay_returns WHERE order_id = ? AND status = 'refunded'").bind(orderId).first()).n;
    pool -= Number(already) || 0;
    const itemised = new Map();
    for (const ret of order.returns || []) for (const li of ret.return_line_items || [])
      if (li.source_line_item_uid) itemised.set(li.source_line_item_uid, (itemised.get(li.source_line_item_uid) || 0) + (Number(li.total_money && li.total_money.amount) || 0));
    for (const r of list) {
      const due = (Number(r.priceMinor) || 0) * (Number(r.quantity) || 1);
      let amount = null;
      if (itemised.has(r.lineId) && itemised.get(r.lineId) > 0 && pool >= itemised.get(r.lineId)) amount = itemised.get(r.lineId);
      else if (due > 0 && pool >= due) amount = due;
      if (amount == null) continue;
      pool -= amount; refunded++;
      statements.push(db.prepare("UPDATE relay_returns SET status = 'refunded', refund_issued_at = ?, refund_minor = ? WHERE id = ? AND status = 'requested'").bind(now, amount, r.id));
    }
  }
  if (statements.length) await db.batch(statements);
  return { checked, refunded };
}

// Test shop only: refunds a returned item from a test order, as the shop would in Square, so the whole return can be tried.
async function testRefund(env, shopper, body, f, now) {
  const db = env.RELAY_DB, orderId = String(body && body.orderId || ""), lineId = String(body && body.lineId || "");
  const own = await db.prepare("SELECT order_id FROM square_test_orders WHERE shopper_id = ? AND order_id = ?").bind(shopper.id, orderId).first();
  if (!own) return [404, { error: "not_found" }];
  await ensureReturnsTables(db);
  const ret = await db.prepare("SELECT id, quantity, price_minor AS priceMinor, status FROM relay_returns WHERE order_id = ? AND line_id = ? AND shopper_id = ? AND status != 'cancelled'")
    .bind(orderId, lineId, shopper.id).first();
  if (!ret) return [409, { error: "no_return" }];
  if (ret.status === "refunded") return [409, { error: "already_refunded" }];
  const ext = SQUARE_ORDER.exec(orderId)[1];
  const order = (await sq(env, "/v2/orders/" + encodeURIComponent(ext), {}, f)).order || {};
  const payment = ((order.tenders || []).find(t => t.payment_id || t.id) || {});
  const paymentId = payment.payment_id || payment.id;
  if (!paymentId) return [409, { error: "no_payment" }];
  const amount = (Number(ret.priceMinor) || 0) * (Number(ret.quantity) || 1);
  const refund = (await sq(env, "/v2/refunds", { method: "POST", body: JSON.stringify({ idempotency_key: "relay-test-refund-" + ret.id,
    payment_id: paymentId, amount_money: { amount, currency: (order.total_money && order.total_money.currency) || "GBP" }, reason: "Relay test return" }) }, f)).refund || {};
  // Square usually completes sandbox refunds within seconds; if not, the hourly check picks it up.
  const synced = await syncSquareRefunds(env, f, { orderId, now });
  return [200, { ok: true, refundStatus: refund.status || "PENDING", refunded: synced.refunded > 0, amountMinor: amount }];
}

// ---- Swaps at Square shops ---------------------------------------------------------------------------------------------
// A shopper swaps an item on their Square order for another size/colour of the same product the shop has in stock.
// Square can't edit a completed order, so Relay makes a NEW order at the shop for the new item, credited with what the
// shopper already paid for the old one (a discount on the new order), and tells the shop by email to expect the old item back.
//  - Same price: the new order comes to £0 and is closed straight away.
//  - Dearer: the new order is left with the difference to pay, on Square's own payment page (a Square payment link).
//    The swap counts as done only once Square says it's paid.
//  - Cheaper: the new order comes to £0, and the difference is refunded at Square to the card used for the original order.
// Single items only when the price differs (as for Shopify).
const swapItemKey = (productId) => "square:sandbox:item:" + productId;
const swapVariantKey = (variationId) => "square:sandbox:variant:" + variationId;
const moneyGBP = (m) => "£" + (Math.abs(Number(m) || 0) / 100).toFixed(2);

async function ownedSquareLine(env, shopper, orderId, lineId) {
  const db = env.RELAY_DB;
  const order = await db.prepare(`SELECT o.id, o.connection_id AS retailer, o.external_order_id AS ext, o.external_customer_id AS customerId, o.ordered_at AS orderedAt, o.status
    FROM retailer_orders o JOIN retailer_order_emails e ON e.order_id = o.id WHERE o.id = ? AND e.email_hash = ?`).bind(String(orderId || ""), shopper.emailHash).first();
  if (!order || !SQUARE_CONNECTION.test(String(order.retailer || ""))) return null;
  const line = await db.prepare(`SELECT external_line_item_id AS lineId, product_id AS productId, variant_id AS variantId, title, quantity, price_minor AS priceMinor, currency
    FROM order_items WHERE order_id = ? AND external_line_item_id = ?`).bind(order.id, String(lineId || "")).first();
  if (!line || !line.productId || !line.variantId) return null;
  return { order, line, location: locationOf(order.retailer) };
}

export function isSquareOrderId(id) { return SQUARE_ORDER.test(String(id || "")); }

async function swapOptions(env, owned) {
  const rows = ((await env.RELAY_DB.prepare(`SELECT v.id AS key, v.external_variant_id AS variationId, v.title, v.price_minor AS priceMinor, v.currency,
      (SELECT MAX(s.quantity) FROM retailer_inventory_snapshots s WHERE s.variant_id = v.id) AS quantity
    FROM retailer_catalog_variants v WHERE v.item_id = ? ORDER BY v.title`).bind(swapItemKey(owned.line.productId)).all()).results || []);
  return rows.filter(r => r.variationId !== owned.line.variantId).map(r => {
    const inStock = Number(r.quantity) >= Number(owned.line.quantity || 1);
    const diff = r.currency === "GBP" && Number.isFinite(r.priceMinor) && Number.isFinite(owned.line.priceMinor) ? r.priceMinor - owned.line.priceMinor : null;
    let reason = !inStock ? "Out of stock" : null;
    if (!reason && diff === null) reason = "Different price (not supported yet)";
    else if (!reason && diff !== 0 && Number(owned.line.quantity) !== 1) reason = "Different price (only for a single item)";
    return { key: r.key, title: r.title, priceMinor: r.priceMinor, quantity: r.quantity, priceDiffMinor: diff, available: !reason, reason, needsCard: false,
      payBy: diff > 0 ? "square" : null };
  });
}

// Why a line can't be swapped right now (or null if it can).
async function swapBlock(env, owned, now) {
  const db = env.RELAY_DB;
  if (owned.order.status !== "COMPLETED") return "order_not_complete";
  if ((now - Date.parse(owned.order.orderedAt)) / 86400000 > RETURN_WINDOW_DAYS) return "outside_window";
  await ensureReturnsTables(db);
  if (await db.prepare("SELECT 1 AS x FROM relay_returns WHERE order_id = ? AND line_id = ? AND status != 'cancelled'").bind(owned.order.id, owned.line.lineId).first()) return "already_returned";
  if (await db.prepare("SELECT 1 AS x FROM relay_exchanges WHERE order_id = ? AND line_id = ? AND status IN ('done','awaiting_payment')").bind(owned.order.id, owned.line.lineId).first()) return "already_exchanged";
  return null;
}

// How many the shop has right now at this location (Square's own count). Falls back to Relay's last copy if Square doesn't count it.
async function liveStock(env, variationId, location, f) {
  try {
    const counts = (await sq(env, "/v2/inventory/" + encodeURIComponent(variationId) + "?location_ids=" + encodeURIComponent(location), {}, f)).counts || [];
    const c = counts.find(x => x.state === "IN_STOCK" && x.location_id === location);
    if (c) return Number(c.quantity);
  } catch { /* use Relay's copy */ }
  const r = await env.RELAY_DB.prepare("SELECT MAX(quantity) AS q FROM retailer_inventory_snapshots WHERE variant_id = ?").bind(swapVariantKey(variationId)).first();
  return Number(r && r.q) || 0;
}

async function emailShopAboutSwap(env, location, text, f) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const loc = (await sq(env, "/v2/locations/" + encodeURIComponent(location), {}, f)).location || {};
    const to = String(loc.business_email || "").trim();
    if (!EMAIL.test(to)) return false;
    const r = await f("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.RELAY_EMAIL_FROM || "Relay <onboarding@resend.dev>", to: [to], subject: "Exchange through Relay", text: text.join("\n"),
        html: text.map(l => l ? "<p>" + esc(l) + "</p>" : "").join("") }), signal: AbortSignal.timeout(10000) });
    return Boolean(r && r.ok);
  } catch { return false; }
}

async function doSquareSwap(env, shopper, body, o) {
  const db = env.RELAY_DB, f = o.fetchImpl || ((...a) => fetch(...a)), now = o.now || Date.now();
  const owned = await ownedSquareLine(env, shopper, body && body.orderId, body && body.lineId);
  if (!owned) return [404, { error: "not_your_order" }];
  const blocked = await swapBlock(env, owned, now);
  if (blocked) return [409, { error: blocked }];
  const choice = (await swapOptions(env, owned)).find(x => x.key === String(body && body.variantKey || ""));
  if (!choice) return [400, { error: "not_an_option" }];
  if (!choice.available) return [409, { error: choice.reason === "Out of stock" ? "out_of_stock" : "different_price" }];
  const diff = choice.priceDiffMinor || 0;
  if (diff !== 0 && Number(body && body.agreedDiffMinor) !== diff) return [409, { error: "price_changed", priceDiffMinor: diff }];
  const toId = choice.key.split(":variant:")[1], qty = Number(owned.line.quantity) || 1;
  if (await liveStock(env, toId, owned.location, f) < qty) return [409, { error: "out_of_stock" }];
  const fromRow = await db.prepare("SELECT title FROM retailer_catalog_variants WHERE id = ?").bind(swapVariantKey(owned.line.variantId)).first();
  const fromTitle = fromRow ? fromRow.title : null;
  const paidMinor = (Number(owned.line.priceMinor) || 0) * qty, newMinor = (Number(choice.priceMinor) || 0) * qty;
  const credit = Math.min(paidMinor, newMinor);
  const record = (status, detail) => db.prepare(`INSERT INTO relay_exchanges (id, shopper_id, order_id, line_id, shop, from_variant, from_title, to_variant, to_title, quantity, status, detail, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), shopper.id, owned.order.id, owned.line.lineId, owned.order.retailer, owned.line.variantId, fromTitle, toId, choice.title,
    qty, status, detail ? String(detail).slice(0, 300) : null, now).run();
  const newOrder = { location_id: owned.location, reference_id: "relay-swap", ...(owned.order.customerId ? { customer_id: owned.order.customerId } : {}),
    line_items: [{ uid: "swap", catalog_object_id: toId, quantity: String(qty) }],
    discounts: [{ uid: "relay-credit", name: "Exchange credit from Square order " + owned.order.ext, type: "FIXED_AMOUNT", amount_money: { amount: credit, currency: "GBP" }, scope: "ORDER" }],
    metadata: { relay_swap_from_order: String(owned.order.ext).slice(0, 255), relay_swap_from_line: String(owned.line.lineId).slice(0, 255) } };
  const label = owned.line.title + (fromTitle ? " (" + fromTitle + ")" : "") + " → " + choice.title;
  try {
    let payUrl = null, newId = null, refunded = null;
    if (diff > 0) {
      // Square's own payment page for the difference. The new order is created with it.
      const link = (await sq(env, "/v2/online-checkout/payment-links", { method: "POST", body: JSON.stringify({ idempotency_key: crypto.randomUUID(), order: newOrder,
        description: "Exchange through Relay: " + label }) }, f));
      payUrl = link.payment_link && link.payment_link.url; newId = link.payment_link && link.payment_link.order_id;
      if (!payUrl || !/^https:\/\//.test(payUrl) || !newId) throw new Error("Square didn't make a payment page");
      await record("awaiting_payment", "square balance " + diff + " " + newId + " " + payUrl);
    } else {
      const created = (await sq(env, "/v2/orders", { method: "POST", body: JSON.stringify({ idempotency_key: crypto.randomUUID(), order: newOrder }) }, f)).order;
      newId = created && created.id;
      if (!newId || Number(created.total_money && created.total_money.amount) !== 0) throw new Error("Square didn't make the exchange order");
      await sq(env, "/v2/orders/" + encodeURIComponent(newId) + "/pay", { method: "POST", body: JSON.stringify({ idempotency_key: crypto.randomUUID(), payment_ids: [] }) }, f);
      if (diff < 0) {
        const orig = (await sq(env, "/v2/orders/" + encodeURIComponent(owned.order.ext), {}, f)).order || {};
        const t = (orig.tenders || []).find(x => x.payment_id || x.id) || {};
        const pid = t.payment_id || t.id;
        if (pid) {
          try {
            const rf = (await sq(env, "/v2/refunds", { method: "POST", body: JSON.stringify({ idempotency_key: "relay-swap-" + owned.order.id + "-" + owned.line.lineId,
              payment_id: pid, amount_money: { amount: -diff, currency: "GBP" }, reason: "Exchange through Relay: " + label }) }, f)).refund;
            refunded = Boolean(rf && rf.id && rf.status !== "REJECTED" && rf.status !== "FAILED");
          } catch { refunded = false; }
        } else refunded = false;
      }
      await record("done", diff < 0 ? (refunded ? "square refunded " : "square shop to refund ") + (-diff) + " " + newId : "square same " + newId);
    }
    const store = TEST_LABEL(env);
    await emailShopAboutSwap(env, owned.location, [
      "A customer has exchanged an item through Relay.", "",
      "Original Square order: " + owned.order.ext, "Exchange: " + label + (qty > 1 ? " (x" + qty + ")" : ""),
      "New Square order: " + newId + (diff > 0 ? " (waiting for the customer to pay the " + moneyGBP(diff) + " difference on Square's payment page)" : " (credited, nothing to pay)"),
      diff < 0 ? (refunded ? "The " + moneyGBP(diff) + " difference has been refunded in Square to the customer's original payment." : "Please refund the customer " + moneyGBP(diff) + " (the difference) in Square.") : "",
      "", "Please give the customer the new item and take back the original (or send it, and expect the original back by post). Restock the original when it arrives.",
      "", "You're getting this because " + store + " is connected to Relay."].filter(x => x !== null), f);
    const after = diff === 0 ? "Nothing to pay or refund."
      : refunded ? "The " + moneyGBP(diff) + " difference has been refunded to how you paid. It can take a few days to show."
      : store + " will refund the " + moneyGBP(diff) + " difference to how you paid.";
    const message = (diff > 0
      ? "Nearly done. Pay the " + moneyGBP(diff) + " difference to " + store + " on Square's secure payment page to finish the swap to " + choice.title + "."
      : "Done. " + store + " has a new order for " + choice.title + " for you, credited with what you paid. " + after)
      + " Take your original back to " + store + " (or send it) when you collect the new one.";
    return [200, { exchanged: diff <= 0, awaitingPayment: diff > 0, to: choice.title, priceDiffMinor: diff, paid: null, payBy: diff > 0 ? "square" : null, payUrl,
      refunded: diff < 0 ? Boolean(refunded) : null, message }];
  } catch (e) {
    await record("failed", e && e.message).catch(() => {});
    console.error("shop_refused", String(e && e.message || e).slice(0, 160)); return [502, { error: "shop_refused" }];
  }
}

// Square swaps waiting for payment: done once Square says the new order is paid. Asked at most a few times per wallet load.
async function settleSquareSwaps(env, rows, f, budget = 3) {
  let n = 0;
  for (const r of rows) {
    if (r.status !== "awaiting_payment" || n >= budget) continue;
    const m = /^square balance (\d{1,9}) ([A-Za-z0-9_-]{4,64}) /.exec(String(r.detail || ""));
    if (!m) continue;
    n++;
    try {
      const ord = (await sq(env, "/v2/orders/" + encodeURIComponent(m[2]), {}, f)).order || {};
      const due = ord.net_amount_due_money ? Number(ord.net_amount_due_money.amount) : null;
      const paid = (ord.tenders || []).length > 0 && (due === 0 || ord.state === "COMPLETED");
      if (paid) {
        await env.RELAY_DB.prepare("UPDATE relay_exchanges SET status = 'done', detail = ? WHERE id = ? AND status = 'awaiting_payment'").bind("square paid " + m[1] + " " + m[2], r.id).run();
        r.status = "done"; r.detail = "square paid " + m[1] + " " + m[2];
      } else if (ord.state === "CANCELED") {
        await env.RELAY_DB.prepare("UPDATE relay_exchanges SET status = 'cancelled' WHERE id = ?").bind(r.id).run();
        r.status = "cancelled";
      }
    } catch { /* asked again next time */ }
  }
}

// Adds swaps to Square purchases in the wallet (called from enrichSquarePurchases).
async function addSquareSwaps(env, sqOrders, o) {
  const ids = sqOrders.map(p => p.id).slice(0, 90);
  if (!ids.length) return;
  let rows = [];
  try {
    rows = ((await env.RELAY_DB.prepare(`SELECT id, order_id AS orderId, line_id AS lineId, from_title AS fromTitle, to_variant AS toVariant, to_title AS toTitle, status, detail, created_at AS at
      FROM relay_exchanges WHERE status IN ('done','awaiting_payment') AND order_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC`).bind(...ids).all()).results || []);
  } catch { return; }
  await settleSquareSwaps(env, rows, o.fetchImpl || ((...a) => fetch(...a)));
  const prices = new Map();
  const keys = [...new Set(rows.map(r => swapVariantKey(r.toVariant)))];
  if (keys.length) for (const v of ((await env.RELAY_DB.prepare(`SELECT id, price_minor AS p FROM retailer_catalog_variants WHERE id IN (${keys.map(() => "?").join(",")})`).bind(...keys).all()).results || [])) prices.set(v.id, v.p);
  for (const p of sqOrders) for (const it of p.items || []) {
    const r = rows.find(x => x.orderId === p.id && x.lineId === it.lineId && x.status !== "cancelled");
    if (!r) continue;
    const ex = { toTitle: r.toTitle, fromTitle: r.fromTitle, status: r.status, at: r.at };
    const bal = /^square (balance|paid) (\d{1,9}) [A-Za-z0-9_-]+(?: (https:\/\/\S+))?/.exec(String(r.detail || ""));
    if (bal) ex.balance = { owedMinor: Number(bal[2]), paid: bal[1] === "paid", payUrl: bal[1] === "balance" ? bal[3] || null : null };
    if (r.status === "done") { const np = prices.get(swapVariantKey(r.toVariant)); if (Number.isFinite(np) && np > 0) { ex.fromPriceMinor = it.priceMinor; it.priceMinor = np; } it.variant = r.toTitle || it.variant; }
    it.exchange = ex; it.exchangeable = false; it.returnable = false;
  }
}

// Routes /relay/my/exchange* for Square orders (the Shopify module hands these over). Returns null for non-Square orders.
export async function handleSquareExchange(request, env, url, cors, shopper, o = {}) {
  if (url.pathname === "/relay/my/exchange/options" && request.method === "GET") {
    if (!isSquareOrderId(url.searchParams.get("orderId"))) return null;
    const owned = await ownedSquareLine(env, shopper, url.searchParams.get("orderId"), url.searchParams.get("lineId"));
    if (!owned) return json({ error: "not_your_order" }, 404, cors);
    const blocked = await swapBlock(env, owned, o.now || Date.now());
    return json({ product: owned.line.title, priceMinor: owned.line.priceMinor, options: blocked ? [] : await swapOptions(env, owned), blocked,
      card: null, payments: false, payBy: "square" }, 200, cors);
  }
  if (url.pathname === "/relay/my/exchange" && request.method === "POST") {
    const body = await request.clone().json().catch(() => null);
    if (!body || !isSquareOrderId(body.orderId)) return null;
    if (!env.SQUARE_ACCESS_TOKEN) return json({ error: "shop_not_connected" }, 409, cors);
    const [status, out] = await doSquareSwap(env, shopper, body, o);
    return json(out, status, cors);
  }
  return null;
}
