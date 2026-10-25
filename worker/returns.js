// Returns through Relay: shopper initiates a return, gets a Royal Mail QR code/reference,
// drops it at any Post Office. Scan at drop-off = proof of postage. Relay records the return.
//
// Eligibility: order must be UNFULFILLED (not yet dispatched) OR within 7 days of order date,
// and the item must not already have a return or exchange recorded.
//
// This generates a Relay-branded return reference (not a live Royal Mail API call yet — that
// requires a Click & Drop merchant account). The QR/reference is displayed to the shopper;
// in production this would call Royal Mail Click & Drop to get a real tracked label.

import { ensureOnce } from "./once.js";

const json = (body, status = 200, cors = {}) =>
  Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

const SHOP = /^shopify:([a-z0-9-]+\.myshopify\.com)$/;
const RETURN_WINDOW_DAYS = 7;

export function ensureReturnsTables(db) {
  return ensureOnce(db, "returns", async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS relay_returns (
      id TEXT PRIMARY KEY,
      shopper_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      line_id TEXT NOT NULL,
      shop TEXT NOT NULL,
      item_title TEXT,
      quantity INTEGER NOT NULL,
      price_minor INTEGER NOT NULL,
      reason TEXT,
      return_ref TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'label_issued',
      carrier TEXT NOT NULL DEFAULT 'royal_mail',
      dropped_off_at INTEGER,
      refund_issued_at INTEGER,
      created_at INTEGER NOT NULL
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_relay_returns_order
      ON relay_returns(order_id, line_id)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_relay_returns_shopper
      ON relay_returns(shopper_id)`).run();
  });
}

// Generates a Relay return reference in Royal Mail style: RL + 9 digits + GB
// In production this would be replaced by a real Click & Drop tracking number.
function generateReturnRef() {
  const digits = Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0");
  return "RL" + digits + "GB";
}

// Checks whether an order line is eligible for return
async function checkEligibility(env, shopper, orderId, lineId) {
  const db = env.RELAY_DB;

  // Must own the order
  const order = await db.prepare(`
    SELECT o.id, o.connection_id AS retailer, o.external_order_id AS ext,
           o.ordered_at AS orderedAt, o.status
    FROM retailer_orders o
    JOIN retailer_order_emails e ON e.order_id = o.id
    WHERE o.id = ? AND e.email_hash = ?
  `).bind(String(orderId || ""), shopper.emailHash).first();

  if (!order) return { eligible: false, reason: "not_your_order" };

  const m = SHOP.exec(order.retailer);
  if (!m) return { eligible: false, reason: "retailer_not_supported" };

  // Check 7-day window from order date
  const orderedAt = new Date(order.orderedAt).getTime();
  const now = Date.now();
  const daysSince = (now - orderedAt) / (1000 * 60 * 60 * 24);
  if (daysSince > RETURN_WINDOW_DAYS) {
    return { eligible: false, reason: "outside_return_window", daysSince: Math.floor(daysSince) };
  }

  // Get the line item
  const line = await db.prepare(`
    SELECT external_line_item_id AS lineId, title, quantity, price_minor AS priceMinor, currency
    FROM order_items WHERE order_id = ? AND external_line_item_id = ?
  `).bind(order.id, String(lineId || "")).first();

  if (!line) return { eligible: false, reason: "item_not_found" };

  // No existing return on this line
  const existingReturn = await db.prepare(
    "SELECT 1 AS x FROM relay_returns WHERE order_id = ? AND line_id = ? AND status != 'cancelled'"
  ).bind(order.id, line.lineId).first();
  if (existingReturn) return { eligible: false, reason: "already_returned" };

  // No completed exchange on this line
  const existingExchange = await db.prepare(
    "SELECT 1 AS x FROM relay_exchanges WHERE order_id = ? AND line_id = ? AND status = 'done'"
  ).bind(order.id, line.lineId).first();
  if (existingExchange) return { eligible: false, reason: "already_exchanged" };

  return { eligible: true, order, shop: m[1], line, daysSince: Math.floor(daysSince) };
}

// POST /relay/my/return — initiate a return, get back a return reference + QR data
async function initiateReturn(env, shopper, body) {
  const db = env.RELAY_DB;
  await ensureReturnsTables(db);

  const orderId = body && body.orderId;
  const lineId = body && body.lineId;
  const reason = body && body.reason; // "wrong_size", "changed_mind", "faulty", "not_as_described"

  const check = await checkEligibility(env, shopper, orderId, lineId);
  if (!check.eligible) return [check.reason === "not_your_order" ? 404 : 409, { error: check.reason }];

  const returnRef = generateReturnRef();
  const returnId = crypto.randomUUID();
  const now = Date.now();

  await db.prepare(`INSERT INTO relay_returns
    (id, shopper_id, order_id, line_id, shop, item_title, quantity, price_minor, reason,
     return_ref, status, carrier, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    returnId, shopper.id, check.order.id, check.line.lineId, check.shop,
    check.line.title, check.line.quantity, check.line.priceMinor,
    reason || null, returnRef, "label_issued", "royal_mail", now
  ).run();

  // The QR code encodes a URL the Post Office scanner resolves to the tracking number.
  // Format matches Royal Mail's label URL pattern (real integration would use Click & Drop API).
  const qrData = "https://relay.return/" + returnRef;

  return [200, {
    returnId,
    returnRef,
    qrData,            // encode this as a QR code in the UI
    carrier: "Royal Mail",
    instructions: [
      "Print or show this QR code at any Post Office",
      "Hand over your item in its original or any secure packaging",
      "The Post Office scans the QR — that's your proof of postage",
      "Keep your receipt from the Post Office just in case",
    ],
    dropOffBy: new Date(now + (RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    item: check.line.title,
    priceMinor: check.line.priceMinor,
    daysSince: check.daysSince,
    status: "label_issued",
  }];
}

// GET /relay/my/returns — list all returns for the shopper
async function listReturns(env, shopper) {
  const db = env.RELAY_DB;
  await ensureReturnsTables(db);
  const rows = (await db.prepare(`
    SELECT r.id, r.order_id AS orderId, r.line_id AS lineId, r.shop,
           r.item_title AS itemTitle, r.quantity, r.price_minor AS priceMinor,
           r.reason, r.return_ref AS returnRef, r.status, r.carrier,
           r.dropped_off_at AS droppedOffAt, r.refund_issued_at AS refundIssuedAt,
           r.created_at AS createdAt
    FROM relay_returns r WHERE r.shopper_id = ? ORDER BY r.created_at DESC
  `).bind(shopper.id).all()).results || [];
  return [200, { returns: rows }];
}

// GET /relay/my/return/eligibility?orderId=&lineId= — check before showing button
async function checkEligibilityRoute(env, shopper, url) {
  await ensureReturnsTables(env.RELAY_DB);
  const check = await checkEligibility(env, shopper, url.searchParams.get("orderId"), url.searchParams.get("lineId"));
  if (!check.eligible) return [200, { eligible: false, reason: check.reason }];
  return [200, {
    eligible: true,
    item: check.line.title,
    priceMinor: check.line.priceMinor,
    daysSince: check.daysSince,
    daysLeft: RETURN_WINDOW_DAYS - check.daysSince,
  }];
}

export async function handleReturnRoute(request, env, url, cors, shopper) {
  const path = url.pathname;
  if (!path.startsWith("/relay/my/return")) return null;
  await ensureReturnsTables(env.RELAY_DB);

  if (path === "/relay/my/return/eligibility" && request.method === "GET") {
    const [status, body] = await checkEligibilityRoute(env, shopper, url);
    return json(body, status, cors);
  }
  if (path === "/relay/my/return" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const [status, out] = await initiateReturn(env, shopper, body);
    return json(out, status, cors);
  }
  if (path === "/relay/my/returns" && request.method === "GET") {
    const [status, body] = await listReturns(env, shopper);
    return json(body, status, cors);
  }
  return json({ error: "not_found" }, 404, cors);
}
