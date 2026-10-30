// Exchanges through Relay: a shopper swaps an item on their own order for another size or colour of the same product.
//
// Who can exchange: only the shopper whose verified sign-in email matches the order's email (the shop confirmed the order).
// What can be swapped: another variant of the same product that the shop has in stock.
// How: Relay edits the order inside the shop's own Shopify (removes the old item, restocks it, adds the new one) using
// Shopify's order editing. Orders already sent out can't be edited this way; those need the shop's returns process.
// Price differences (single items only):
//  - Dearer, shop pays by "shopify" (default, shop-payments.js): the order is left with the extra to pay, Shopify emails the
//    customer and Relay shows Shopify's own payment link. Works with any payment method the shop accepts.
//  - Dearer, shop pays by "card": the customer's saved card is charged and Stripe pays it into the shop's own account.
//  - Cheaper: Relay refunds the difference in Shopify to how the customer paid (needs the shop's permission to change
//    orders). If Shopify won't, the order note asks the shop to refund it, and Relay says so.
import { ensureOnce } from "./once.js";
import { listConnectedShopifyStores } from "./shopify-connect.js";
import { paymentsEnabled, cardOf, holdDifference, takeHeld, releaseHold, moneyText } from "./payments.js";
import { shopPay } from "./shop-payments.js";

const json = (body, status = 200, cors = {}) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
const SHOP = /^shopify:([a-z0-9-]+\.myshopify\.com)$/;
const API_VERSION = "2026-07";

export function ensureExchangeTables(db) {
  return ensureOnce(db, "exchanges", async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS relay_exchanges (id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, order_id TEXT NOT NULL, line_id TEXT NOT NULL,
      shop TEXT NOT NULL, from_variant TEXT NOT NULL, from_title TEXT, to_variant TEXT NOT NULL, to_title TEXT, quantity INTEGER NOT NULL,
      status TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL)`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_relay_exchanges_order ON relay_exchanges(order_id, line_id)").run();
  });
}

const itemKey = (shop, productId) => "shopify:" + shop + ":item:gid://shopify/Product/" + productId;
const variantKey = (shop, variantId) => "shopify:" + shop + ":variant:gid://shopify/ProductVariant/" + variantId;

// Adds what the app needs to each purchased line: picture, size/colour, and any exchange already made.
export async function enrichPurchases(env, purchases) {
  const db = env.RELAY_DB;
  await ensureExchangeTables(db);
  const RETURN_WINDOW_DAYS = 7;
  const now = Date.now();
  for (const o of purchases) {
    const m = SHOP.exec(String(o.retailer || ""));
    const daysSinceOrder = o.orderedAt ? (now - new Date(o.orderedAt).getTime()) / (1000 * 60 * 60 * 24) : 999;
    for (const it of o.items || []) {
      it.exchangeable = false;
      it.returnable = false;
      if (!m || !it.variantId) continue;
      const v = await db.prepare(`SELECT v.title AS variant, i.image_url AS imageUrl, i.title AS product FROM retailer_catalog_variants v JOIN retailer_catalog_items i ON i.id = v.item_id WHERE v.id = ?`)
        .bind(variantKey(m[1], it.variantId)).first();
      if (v) { it.variant = v.variant && v.variant !== "Default Title" ? v.variant : null; it.imageUrl = v.imageUrl || null; }
      const ex = await db.prepare("SELECT to_title AS toTitle, from_title AS fromTitle, status, created_at AS at FROM relay_exchanges WHERE order_id = ? AND line_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1")
        .bind(o.id, it.lineId).first();
      if (ex) { it.exchange = ex; it.variant = ex.toTitle || it.variant; }
      it.exchangeable = !ex && Boolean(it.productId);
      // A return started in Relay for this item: its reference, Royal Mail tracking and whether the shop has refunded it.
      let ret = null;
      try {
        ret = await db.prepare(`SELECT status, return_ref AS ref, tracking_number AS trackingNumber, refund_minor AS refundMinor, refund_issued_at AS refundedAt
          FROM relay_returns WHERE order_id = ? AND line_id = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1`).bind(o.id, it.lineId).first();
      } catch {
        try { ret = await db.prepare("SELECT status, return_ref AS ref FROM relay_returns WHERE order_id = ? AND line_id = ? AND status != 'cancelled' LIMIT 1").bind(o.id, it.lineId).first(); }
        catch { ret = null; /* relay_returns table may not exist yet */ }
      }
      if (ret) it.returnInfo = { status: ret.status, ref: ret.ref, trackingNumber: ret.trackingNumber || null,
        refundMinor: Number.isFinite(ret.refundMinor) ? ret.refundMinor : null, refundedAt: ret.refundedAt || null };
      // returnable: within window, no completed return, no completed exchange
      if (daysSinceOrder <= RETURN_WINDOW_DAYS && !ex) it.returnable = !ret;
      if (ret) it.exchangeable = false;
    }
  }
  return purchases;
}

async function ownedLine(env, shopper, orderId, lineId) {
  const db = env.RELAY_DB;
  const order = await db.prepare(`SELECT o.id, o.connection_id AS retailer, o.external_order_id AS ext FROM retailer_orders o JOIN retailer_order_emails e ON e.order_id = o.id
    WHERE o.id = ? AND e.email_hash = ?`).bind(String(orderId || ""), shopper.emailHash).first();
  if (!order) return null;
  const m = SHOP.exec(order.retailer);
  if (!m) return null;
  const line = await db.prepare(`SELECT external_line_item_id AS lineId, product_id AS productId, variant_id AS variantId, title, quantity, price_minor AS priceMinor
    FROM order_items WHERE order_id = ? AND external_line_item_id = ?`).bind(order.id, String(lineId || "")).first();
  if (!line || !line.productId || !line.variantId) return null;
  return { order, shop: m[1], line };
}

// What the shopper can swap to. Same price: always (if in stock). Dearer: paid through the shop's Shopify checkout, or with a
// saved card if the shop chose instant card payments. Cheaper: refunded in Shopify. A different price only for a single item.
async function options(env, owned, card, pay) {
  const db = env.RELAY_DB;
  const rows = ((await db.prepare(`SELECT v.id AS key, v.external_variant_id AS gid, v.title, v.price_minor AS priceMinor, v.currency,
      (SELECT MAX(s.quantity) FROM retailer_inventory_snapshots s WHERE s.variant_id = v.id) AS quantity
    FROM retailer_catalog_variants v WHERE v.item_id = ? ORDER BY v.title`).bind(itemKey(owned.shop, owned.line.productId)).all()).results || []);
  const done = await db.prepare("SELECT to_variant AS v FROM relay_exchanges WHERE order_id = ? AND line_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1")
    .bind(owned.order.id, owned.line.lineId).first();
  const current = done ? done.v : "gid://shopify/ProductVariant/" + owned.line.variantId;
  const byCard = pay && pay.method === "card";
  const payments = byCard && paymentsEnabled(env);
  return rows.filter(r => r.gid !== current).map(r => {
    const inStock = Number(r.quantity) > 0;
    const diff = r.currency === "GBP" && Number.isFinite(r.priceMinor) && Number.isFinite(owned.line.priceMinor) ? r.priceMinor - owned.line.priceMinor : null;
    let reason = !inStock ? "Out of stock" : null;
    if (!reason && diff === null) reason = "Different price (not supported yet)";
    else if (!reason && diff !== 0 && Number(owned.line.quantity) !== 1) reason = "Different price (only for a single item)";
    else if (!reason && diff > 0 && byCard && !payments) reason = "Costs " + moneyText(diff) + " more (not available yet)";
    else if (!reason && diff > 0 && byCard && !card) reason = "Costs " + moneyText(diff) + " more: add a card to pay the difference";
    return { key: r.key, title: r.title, priceMinor: r.priceMinor, quantity: r.quantity, priceDiffMinor: diff, available: !reason, reason,
      needsCard: Boolean(inStock && diff > 0 && byCard && payments && !card), payBy: diff > 0 ? (byCard ? "card" : "shopify") : null };
  });
}

async function gql(shop, token, query, variables, f) {
  const r = await f("https://" + shop + "/admin/api/" + API_VERSION + "/graphql.json", { method: "POST", headers: { "X-Shopify-Access-Token": token, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.errors && j.errors.length)) throw new Error("Shopify said " + r.status + " " + String((j.errors && j.errors[0] && j.errors[0].message) || "").slice(0, 140));
  return j.data || {};
}
const firstError = (x) => (x && x.userErrors && x.userErrors[0] && x.userErrors[0].message) || null;

// The link Shopify gives for paying an order's outstanding balance (only an https link on Shopify's own domains).
async function balanceLink(shop, token, orderGid, f) {
  try {
    const d = await gql(shop, token, `query RelayBalance($id: ID!) { order(id: $id) { totalOutstandingSet { shopMoney { amount } } paymentCollectionDetails { additionalPaymentCollectionUrl } } }`, { id: orderGid }, f);
    const u = d.order && d.order.paymentCollectionDetails && d.order.paymentCollectionDetails.additionalPaymentCollectionUrl;
    // From Shopify itself; it may be on the shop's own domain, so any plain https address is accepted.
    return typeof u === "string" && /^https:\/\/[^\s"'<>]{8,500}$/.test(u) ? u : null;
  } catch { return null; }
}

// Refunds an amount to the payment the customer made on this order. True only if Shopify created the refund.
// Needs the shop's permission to change orders ("write_orders"); without it Shopify refuses and the shop refunds by hand.
async function refundDifference(shop, token, orderGid, amountMinor, label, f) {
  try {
    const d = await gql(shop, token, `query RelayTx($id: ID!) { order(id: $id) { transactions(first: 20) { id kind status gateway amountSet { shopMoney { amount } } } } }`, { id: orderGid }, f);
    const txs = (d.order && d.order.transactions) || [];
    const parent = txs.find(t => (t.kind === "SALE" || t.kind === "CAPTURE") && t.status === "SUCCESS" && Number(t.amountSet && t.amountSet.shopMoney && t.amountSet.shopMoney.amount) * 100 >= amountMinor);
    if (!parent) return false;
    const key = "relay-refund-" + crypto.randomUUID();
    const r = await gql(shop, token, `mutation RelayRefund($input: RefundInput!) { refundCreate(input: $input) @idempotent(key: "${key}") { refund { id } userErrors { message } } }`,
      { input: { orderId: orderGid, note: ("Relay swap: " + label + ". Difference refunded.").slice(0, 250), notify: true,
        transactions: [{ orderId: orderGid, parentId: parent.id, kind: "REFUND", gateway: parent.gateway, amount: (amountMinor / 100).toFixed(2) }] } }, f);
    return Boolean(r.refundCreate && r.refundCreate.refund && r.refundCreate.refund.id && !firstError(r.refundCreate));
  } catch { return false; }
}

async function doExchange(env, shopper, body, o) {
  const db = env.RELAY_DB, f = o.fetchImpl || ((...a) => fetch(...a));
  const owned = await ownedLine(env, shopper, body && body.orderId, body && body.lineId);
  if (!owned) return [404, { error: "not_your_order" }];
  const already = await db.prepare("SELECT 1 AS x FROM relay_exchanges WHERE order_id = ? AND line_id = ? AND status = 'done'").bind(owned.order.id, owned.line.lineId).first();
  if (already) return [409, { error: "already_exchanged" }];
  let returning = null;
  try { returning = await db.prepare("SELECT 1 AS x FROM relay_returns WHERE order_id = ? AND line_id = ? AND status != 'cancelled'").bind(owned.order.id, owned.line.lineId).first(); }
  catch { returning = null; /* no returns table yet */ }
  if (returning) return [409, { error: "already_returned" }];
  const pay = await shopPay(env, owned.shop);
  const card = pay.method === "card" ? await cardOf(env, shopper.id).catch(() => null) : null;
  const choice = (await options(env, owned, card, pay)).find(x => x.key === String(body && body.variantKey || ""));
  if (!choice) return [400, { error: "not_an_option" }];
  if (!choice.available) return [409, { error: choice.reason === "Out of stock" ? "out_of_stock" : choice.needsCard ? "card_needed" : "different_price" }];
  const diff = choice.priceDiffMinor || 0;
  // The shopper must have seen and agreed the same difference the server works out now (prices can change meanwhile).
  if (diff !== 0 && Number(body && body.agreedDiffMinor) !== diff) return [409, { error: "price_changed", priceDiffMinor: diff }];
  const stores = await (o.listStores ? o.listStores() : listConnectedShopifyStores(env, o)).catch(() => []);
  const store = stores.find(s => s.domain === owned.shop);
  if (!store) return [409, { error: "shop_not_connected" }];
  const toGid = choice.key.split(":variant:")[1], fromGid = "gid://shopify/ProductVariant/" + owned.line.variantId;
  const fromRow = await db.prepare("SELECT title FROM retailer_catalog_variants WHERE id = ?").bind(variantKey(owned.shop, owned.line.variantId)).first();
  const fromTitle = fromRow && fromRow.title !== "Default Title" ? fromRow.title : null;
  const record = async (status, detail) => {
    await db.prepare(`INSERT INTO relay_exchanges (id, shopper_id, order_id, line_id, shop, from_variant, from_title, to_variant, to_title, quantity, status, detail, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), shopper.id, owned.order.id, owned.line.lineId, owned.shop, fromGid, fromTitle, toGid, choice.title,
      owned.line.quantity, status, detail ? String(detail).slice(0, 300) : null, o.now).run();
  };
  let hold = null;
  try {
    // Live checks at the shop: the order hasn't been sent, and the new item really is in stock right now.
    const live = await gql(owned.shop, store.token, `query RelayExchangeCheck($o: ID!, $v: ID!) { order(id: $o) { cancelledAt displayFulfillmentStatus }
      productVariant(id: $v) { inventoryQuantity title } }`, { o: "gid://shopify/Order/" + owned.order.ext, v: toGid }, f);
    if (!live.order || live.order.cancelledAt) return [409, { error: "order_cancelled" }];
    if (live.order.displayFulfillmentStatus !== "UNFULFILLED") return [409, { error: "already_sent" }];
    if (!live.productVariant || !(Number(live.productVariant.inventoryQuantity) >= owned.line.quantity)) return [409, { error: "out_of_stock" }];
    // Dearer: hold the difference on the saved card before touching the order. Nothing is taken until the order is changed.
    const byCard = diff > 0 && pay.method === "card";
    if (byCard) {
      try { hold = await holdDifference(env, shopper, card, { amountMinor: diff, orderId: owned.order.id, lineId: owned.line.lineId, shop: owned.shop,
        label: owned.line.title + " → " + choice.title, destination: pay.stripeAccount }, o); }
      catch (e) { return [402, { error: "card_declined", detail: String(e && e.message || e).slice(0, 120) }]; }
    }
    // Shopify order edit: begin, take the old item out (back into stock), add the new one, commit.
    const begin = await gql(owned.shop, store.token, `mutation RelayEditBegin($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { id lineItems(first: 100) { nodes { id quantity variant { id } } } } userErrors { message } } }`,
      { id: "gid://shopify/Order/" + owned.order.ext }, f);
    const calc = begin.orderEditBegin && begin.orderEditBegin.calculatedOrder;
    if (!calc) throw new Error(firstError(begin.orderEditBegin) || "Shopify wouldn't open the order for editing");
    // Find the shopper's line: by its variant, or, if the shop has since changed that product's variants (e.g. added
    // colours, so the variant bought no longer exists), by the order line itself. Never any other line.
    const nodes = ((calc.lineItems && calc.lineItems.nodes) || []).filter(n => n.quantity > 0);
    const oldLine = nodes.find(n => n.variant && n.variant.id === fromGid) ||
      nodes.find(n => String(n.id).split("/").pop() === String(owned.line.lineId));
    if (!oldLine) throw new Error("The item isn't on the order any more");
    const out = await gql(owned.shop, store.token, `mutation RelayEditRemove($id: ID!, $line: ID!) { orderEditSetQuantity(id: $id, lineItemId: $line, quantity: 0, restock: true) { userErrors { message } } }`,
      { id: calc.id, line: oldLine.id }, f);
    if (firstError(out.orderEditSetQuantity)) throw new Error(firstError(out.orderEditSetQuantity));
    const add = await gql(owned.shop, store.token, `mutation RelayEditAdd($id: ID!, $v: ID!, $q: Int!) { orderEditAddVariant(id: $id, variantId: $v, quantity: $q, allowDuplicates: false) { calculatedLineItem { id } userErrors { message } } }`,
      { id: calc.id, v: toGid, q: owned.line.quantity }, f);
    if (firstError(add.orderEditAddVariant)) throw new Error(firstError(add.orderEditAddVariant));
    // Dearer, by card: the shopper pays the difference by card (into the shop's Stripe account), so the new item is discounted by
    // that much in Shopify and the order total stays what the shopper already paid the shop.
    // Dearer, through Shopify: no discount, so the order shows the extra still to pay and Shopify collects it.
    if (byCard) {
      const newLine = add.orderEditAddVariant && add.orderEditAddVariant.calculatedLineItem && add.orderEditAddVariant.calculatedLineItem.id;
      if (!newLine) throw new Error("Shopify didn't return the new item");
      const disc = await gql(owned.shop, store.token, `mutation RelayEditDiscount($id: ID!, $line: ID!, $d: OrderEditAppliedDiscountInput!) { orderEditAddLineItemDiscount(id: $id, lineItemId: $line, discount: $d) { userErrors { message } } }`,
        { id: calc.id, line: newLine, d: { description: "Difference paid through Relay", fixedValue: { amount: (diff / 100).toFixed(2), currencyCode: "GBP" } } }, f);
      if (firstError(disc.orderEditAddLineItemDiscount)) throw new Error(firstError(disc.orderEditAddLineItemDiscount));
    }
    const note = "Exchanged through Relay: " + owned.line.title + " → " + choice.title + ". " + (diff === 0 ? "Same price, nothing to pay or refund."
      : byCard ? "Customer paid the " + moneyText(diff) + " difference by card through Relay (Stripe TEST MODE, no real money; ref " + hold.paymentIntent + ")" +
        (hold.destination ? ", paid into your Stripe account." : ". Relay owes the shop " + moneyText(diff) + ".")
      : diff > 0 ? "The new item costs " + moneyText(diff) + " more. Shopify has asked the customer to pay the " + moneyText(diff) + " balance. Please don't send it until it's paid."
      : "The new item costs " + moneyText(-diff) + " less. Relay is refunding the customer " + moneyText(-diff) + " from this order.");
    // Through Shopify: Shopify's own "order updated" email goes to the customer with a link to pay the balance.
    const commit = await gql(owned.shop, store.token, `mutation RelayEditCommit($id: ID!, $note: String, $notify: Boolean) { orderEditCommit(id: $id, notifyCustomer: $notify, staffNote: $note) { order { id } userErrors { message } } }`,
      { id: calc.id, note, notify: diff > 0 && !byCard }, f);
    if (!(commit.orderEditCommit && commit.orderEditCommit.order)) throw new Error(firstError(commit.orderEditCommit) || "Shopify didn't save the change");
    const orderGid = "gid://shopify/Order/" + owned.order.ext;
    let paid = null, payUrl = null, refunded = null;
    if (hold) paid = await takeHeld(env, hold, o);
    if (diff > 0 && !byCard) payUrl = await balanceLink(owned.shop, store.token, orderGid, f);
    if (diff < 0) refunded = await refundDifference(owned.shop, store.token, orderGid, -diff, owned.line.title + " → " + choice.title, f);
    await record("done", byCard ? (paid ? (hold.destination ? "paid to shop " : "paid ") + diff : "payment not taken " + diff)
      : diff > 0 ? "shopify balance " + diff : diff < 0 ? (refunded ? "refunded " : "shop to refund ") + (-diff) : null);
    const store_ = store.label || "the shop";
    const message = "Done. Your order now has " + choice.title + " instead. " + (diff === 0 ? "Nothing to pay or refund."
      : byCard ? (paid ? moneyText(diff) + " was taken from your card (test mode, no real money)." : "We couldn't take the " + moneyText(diff) + " from your card, so Relay will be in touch.")
      : diff > 0 ? "Pay the " + moneyText(diff) + " difference to " + store_ + " to finish. " + (payUrl ? "Use the button below, or the link in " + store_ + "'s email." : store_ + " has emailed you a link to pay it.") + " You can pay however " + store_ + " accepts."
      : refunded ? store_ + " has refunded the " + moneyText(-diff) + " difference to how you paid. It can take a few days to show."
      : store_ + " will refund the " + moneyText(-diff) + " difference to how you paid.");
    return [200, { exchanged: true, to: choice.title, priceDiffMinor: diff, paid: byCard ? paid : null, payBy: diff > 0 ? (byCard ? "card" : "shopify") : null,
      payUrl, refunded: diff < 0 ? Boolean(refunded) : null, message }];
  } catch (e) {
    if (hold) await releaseHold(env, hold, e && e.message, o);
    await record("failed", e && e.message);
    return [502, { error: "shop_refused", detail: String(e && e.message || e).slice(0, 160) }];
  }
}

// Routes under /relay/my/exchange* for a signed-in shopper.
export async function handleExchangeRoute(request, env, url, cors, shopper, o) {
  const path = url.pathname;
  if (!path.startsWith("/relay/my/exchange")) return null;
  await ensureExchangeTables(env.RELAY_DB);
  if (path === "/relay/my/exchange/options" && request.method === "GET") {
    const owned = await ownedLine(env, shopper, url.searchParams.get("orderId"), url.searchParams.get("lineId"));
    if (!owned) return json({ error: "not_your_order" }, 404, cors);
    const pay = await shopPay(env, owned.shop);
    const card = pay.method === "card" ? await cardOf(env, shopper.id).catch(() => null) : null;
    return json({ product: owned.line.title, priceMinor: owned.line.priceMinor, options: await options(env, owned, card, pay),
      card: card ? { brand: card.brand, last4: card.last4, wallet: card.wallet } : null, payments: pay.method === "card", payBy: pay.method }, 200, cors);
  }
  if (path === "/relay/my/exchange" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const [status, out] = await doExchange(env, shopper, body, o);
    return json(out, status, cors);
  }
  return json({ error: "not_found" }, 404, cors);
}
