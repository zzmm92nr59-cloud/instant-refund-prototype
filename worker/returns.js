// Returns through Relay.
//
// What this does TODAY: records the shopper's return request against their shop-confirmed order, so the
// item is marked as being returned (it can't also be exchanged) and the shopper has a Relay reference.
//
// It also emails the shop (to the contact address set in its Shopify admin) with the order number, item,
// reason and Relay reference, so the shop knows a return is coming. Only if that email was actually accepted for
// delivery does the shopper's app say the shop was told; otherwise it says it wasn't. The shopper's own email
// address is not included: the shop already has it on the order.
//
// Postage labels: only when the shop has connected its own Royal Mail Click & Drop account in Relay for shops
// (see royal-mail.js). Then Relay asks Royal Mail for a return label and shows the shopper the QR code / label and
// tracking number exactly as Royal Mail sent them. If the shop hasn't connected Royal Mail, or Royal Mail doesn't
// return a tracking number, there is no label: Relay must never show a QR code, tracking number or "drop off at the
// Post Office" instruction without a real label behind it, and the app tells the shopper to use the shop's own
// returns process.
//
// Eligibility: order confirmed by the shop for this shopper, within 7 days of the order date,
// and the item must not already have a return or exchange recorded.

import { ensureOnce } from "./once.js";
import { listConnectedShopifyStores } from "./shopify-connect.js";
import { shopMakesLabels, orderAddress, createReturnLabel, saveLabel, labelResponse } from "./royal-mail.js";

const API_VERSION = "2026-07";
const REASON_TEXT = { wrong_size: "Wrong size or fit", changed_mind: "Changed their mind", faulty: "Faulty or damaged", not_as_described: "Not as described" };
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clean = (t, n) => String(t == null ? "" : t).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

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
      status TEXT NOT NULL DEFAULT 'requested',
      carrier TEXT,
      dropped_off_at INTEGER,
      refund_issued_at INTEGER,
      created_at INTEGER NOT NULL
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_relay_returns_order
      ON relay_returns(order_id, line_id)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_relay_returns_shopper
      ON relay_returns(shopper_id)`).run();
  }).then(() => ensureOnce(db, "returns-shop-notified", async () => {
    // When the shop's email about this return was accepted for delivery (null = not told). Added later.
    try { await db.prepare("ALTER TABLE relay_returns ADD COLUMN shop_notified_at INTEGER").run(); } catch { /* already there */ }
  })).then(() => ensureOnce(db, "returns-tracking", async () => {
    // Royal Mail tracking number, only when Royal Mail actually made a label. Added later.
    try { await db.prepare("ALTER TABLE relay_returns ADD COLUMN tracking_number TEXT").run(); } catch { /* already there */ }
  }));
}

// Tells the shop about a return by email. Returns true only when the email service accepted the message.
// Anything missing (no email service set up, shop not connected, no contact address) means false, never a guess.
export async function notifyShopOfReturn(env, r, o = {}) {
  const f = o.fetchImpl || ((...a) => fetch(...a));
  if (!env.RESEND_API_KEY) return false;
  try {
    const store = r.store || ((await (o.listStores ? o.listStores() : listConnectedShopifyStores(env, o)).catch(() => [])).find(x => x.domain === r.shop));
    if (!store || !store.token) return false;
    const ext = String(r.externalOrderId || "");
    const orderGid = /^\d{1,20}$/.test(ext) ? "gid://shopify/Order/" + ext : (/^gid:\/\/shopify\/Order\/\d{1,20}$/.test(ext) ? ext : null);
    const res = await f("https://" + r.shop + "/admin/api/" + API_VERSION + "/graphql.json", { method: "POST",
      headers: { "X-Shopify-Access-Token": store.token, "content-type": "application/json" },
      body: JSON.stringify({ query: "query RelayReturnShop($id: ID!) { shop { name email contactEmail } order(id: $id) { name } }", variables: { id: orderGid || "gid://shopify/Order/0" } }),
      signal: AbortSignal.timeout(10000) });
    const d = (await res.json().catch(() => ({}))).data || {};
    const shopInfo = d.shop || {};
    const to = [shopInfo.contactEmail, shopInfo.email].map(x => String(x || "").trim()).find(x => /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,}$/i.test(x));
    if (!to) return false;
    const shopName = clean(shopInfo.name || store.label || r.shop, 80);
    const orderName = clean((d.order && d.order.name) || (ext ? "#" + ext : "your order"), 40);
    const item = clean(r.itemTitle || "an item", 120), qty = Number(r.quantity) || 1;
    const price = "£" + (Math.round(Number(r.priceMinor) || 0) / 100).toFixed(2);
    const reason = REASON_TEXT[r.reason] || "Not given";
    const label = r.trackingNumber ? "Relay has created a Royal Mail return label (" + (r.serviceName || "Royal Mail returns") + ") on your Click & Drop account. Tracking number: " + r.trackingNumber + ". Royal Mail charges the postage to your account as usual. Relay has not issued a refund; any refund comes from you."
      : "Relay has not created a postage label and has not issued a refund. The customer has been told to send the item back using your usual returns process, and that any refund comes from you.";
    const labelHtml = r.trackingNumber ? "<p>Relay has created a <b>Royal Mail return label</b> (" + esc(r.serviceName || "Royal Mail returns") + ") on your Click &amp; Drop account. Tracking number: <b style=\"font-family:monospace\">" + esc(r.trackingNumber) + "</b>. Royal Mail charges the postage to your account as usual. Relay has <b>not</b> issued a refund; any refund comes from you.</p>"
      : "<p>Relay has <b>not</b> created a postage label and has <b>not</b> issued a refund. The customer has been told to send the item back using your usual returns process, and that any refund comes from you.</p>";
    const lines = [
      "A customer has asked to return an item from order " + orderName + " through Relay.",
      "",
      "Item: " + item + (qty > 1 ? " (x" + qty + ")" : "") + ", " + price,
      "Reason: " + reason,
      "Relay reference: " + r.returnRef,
      "",
      label,
      "Please handle this return as you normally would. You can find the customer's details on order " + orderName + " in your Shopify admin.",
      "",
      "You're getting this because " + shopName + " is connected to Relay."
    ];
    const html = "<p>A customer has asked to return an item from order <b>" + esc(orderName) + "</b> through Relay.</p>" +
      "<table style=\"border-collapse:collapse\"><tr><td style=\"padding:2px 12px 2px 0;color:#5b6275\">Item</td><td>" + esc(item) + (qty > 1 ? " (x" + qty + ")" : "") + ", " + esc(price) + "</td></tr>" +
      "<tr><td style=\"padding:2px 12px 2px 0;color:#5b6275\">Reason</td><td>" + esc(reason) + "</td></tr>" +
      "<tr><td style=\"padding:2px 12px 2px 0;color:#5b6275\">Relay reference</td><td style=\"font-family:monospace\">" + esc(r.returnRef) + "</td></tr></table>" +
      labelHtml +
      "<p>Please handle this return as you normally would. You can find the customer's details on order " + esc(orderName) + " in your Shopify admin.</p>" +
      "<p style=\"color:#5b6275;font-size:13px\">You're getting this because " + esc(shopName) + " is connected to Relay.</p>";
    const sent = await f("https://api.resend.com/emails", { method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.RELAY_EMAIL_FROM || "Relay <onboarding@resend.dev>", to: [to],
        subject: "Return request " + r.returnRef + " for order " + orderName, text: lines.join("\n"), html }),
      signal: AbortSignal.timeout(10000) });
    return Boolean(sent && sent.ok);
  } catch { return false; }
}

// A Relay reference, deliberately NOT shaped like a Royal Mail tracking number (RL123456789GB),
// so nobody mistakes it for a postage label. Unambiguous characters only (no 0/O, 1/I).
const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateReturnRef() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const c = Array.from(b, x => REF_CHARS[x % REF_CHARS.length]).join("");
  return "RLY-" + c.slice(0, 4) + "-" + c.slice(4);
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

// POST /relay/my/return — start a return; get back a Relay reference, plus a Royal Mail label when the shop has set that up
async function initiateReturn(env, shopper, body, o = {}) {
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
    reason || null, returnRef, "requested", null, now
  ).run();

  // A Royal Mail label, only if the shop connected its own Click & Drop account and Royal Mail returned a tracking number.
  let store = null, made = null;
  if (await shopMakesLabels(env, check.shop)) {
    store = ((await (o.listStores ? o.listStores() : listConnectedShopifyStores(env, o)).catch(() => [])).find(x => x.domain === check.shop)) || null;
    const from = store ? await orderAddress(store, check.order.ext, o) : null;
    made = from ? await createReturnLabel(env, check.shop, from, returnRef, o) : null;
    if (made) {
      await saveLabel(env, returnId, shopper.id, made, now);
      await db.prepare("UPDATE relay_returns SET carrier = 'royal_mail', tracking_number = ? WHERE id = ?").bind(made.trackingNumber, returnId).run();
    }
  }

  const shopNotified = await notifyShopOfReturn(env, { shop: check.shop, store, externalOrderId: check.order.ext, itemTitle: check.line.title,
    quantity: check.line.quantity, priceMinor: check.line.priceMinor, reason: reason || null, returnRef,
    trackingNumber: made && made.trackingNumber, serviceName: made && made.serviceName }, o);
  if (shopNotified) await db.prepare("UPDATE relay_returns SET shop_notified_at = ? WHERE id = ?").bind(Date.now(), returnId).run();

  return [200, {
    returnId,
    returnRef,
    status: "requested",
    // labelAvailable is true only when Royal Mail made a real label. shopNotified is true only if the shop's email was sent.
    labelAvailable: Boolean(made),
    ...(made ? { carrier: "Royal Mail", trackingNumber: made.trackingNumber, serviceName: made.serviceName, hasPdf: Boolean(made.label),
      qrImage: made.qr ? "data:" + made.qr.type + ";base64," + made.qr.data : null } : {}),
    shopNotified,
    item: check.line.title,
    priceMinor: check.line.priceMinor,
    daysSince: check.daysSince,
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
           r.created_at AS createdAt, r.shop_notified_at AS shopNotifiedAt, r.tracking_number AS trackingNumber
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

export async function handleReturnRoute(request, env, url, cors, shopper, o = {}) {
  const path = url.pathname;
  if (!path.startsWith("/relay/my/return")) return null;
  await ensureReturnsTables(env.RELAY_DB);

  if (path === "/relay/my/return/eligibility" && request.method === "GET") {
    const [status, body] = await checkEligibilityRoute(env, shopper, url);
    return json(body, status, cors);
  }
  if (path === "/relay/my/return" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const [status, out] = await initiateReturn(env, shopper, body, o);
    return json(out, status, cors);
  }
  if (path === "/relay/my/return/label" && request.method === "GET") return labelResponse(env, shopper, url, cors);
  if (path === "/relay/my/returns" && request.method === "GET") {
    const [status, body] = await listReturns(env, shopper);
    return json(body, status, cors);
  }
  return json({ error: "not_found" }, 404, cors);
}
