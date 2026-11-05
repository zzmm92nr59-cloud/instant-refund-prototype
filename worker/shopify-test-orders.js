// Relay's testing tools: a test order at one of Relay's Shopify test shops, placed under the tester's own Relay email so it
// shows in their account the way a real order from that shop would (and can be returned, swapped, or swapped with another
// shop). Only at shops Shopify says are development stores, never a real shop. Shopify marks the order as a test, sends no
// receipt email, and no card is used or money moved: the order is recorded as paid by a test payment. 5 a day per tester.
import { listConnectedShopifyStores } from "./shopify-connect.js";
import { ensureShopPlanTable } from "./shopify.js";
import { ingestShopifyOrder } from "./shopify-webhooks.js";
import { ITEM_KEY } from "./cross-swap.js";

const API_VERSION = "2026-07";
export const TEST_ORDERS_PER_DAY = 5;
const DAY = 864e5;
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

export const SHOPIFY_TEST_ORDERS_SQL = "CREATE TABLE IF NOT EXISTS shopify_test_orders (id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, shop TEXT NOT NULL, order_id TEXT, created_at INTEGER NOT NULL)";

// "Delete my account": the count of test orders made (the test orders themselves are at Relay's own test shops).
export async function shopifyTestOrderDeleteStatements(db, shopperId) {
  await db.prepare(SHOPIFY_TEST_ORDERS_SQL).run();
  return [db.prepare("DELETE FROM shopify_test_orders WHERE shopper_id = ?").bind(shopperId)];
}

const ORDER_CREATE = `mutation RelayTestOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    order { legacyResourceId name createdAt processedAt currencyCode totalPriceSet { shopMoney { amount } }
      lineItems(first: 10) { nodes { id title quantity originalUnitPriceSet { shopMoney { amount } } product { legacyResourceId } variant { legacyResourceId } } } }
    userErrors { field message } } }`;

// POST /relay/my/testing/shopify-order { variantKey }: places the test order and adds it to the tester's account straight away
// (Shopify's own order notification adds it again later, which changes nothing).
export async function handleShopifyTestRoute(request, env, url, cors, shopper, o = {}) {
  if (url.pathname !== "/relay/my/testing/shopify-order") return null;
  if (request.method !== "POST") return json({ error: "not_found" }, 404, cors);
  const db = env.RELAY_DB, f = o.fetchImpl || ((...a) => fetch(...a)), now = o.now || Date.now();
  const body = await request.json().catch(() => null);
  const key = String(body && body.variantKey || "");
  const k = ITEM_KEY.exec(key);
  if (!k) return json({ error: "not_a_test_item" }, 400, cors);
  await ensureShopPlanTable(db);
  const plan = await db.prepare("SELECT test_shop FROM shopify_shop_plan WHERE domain = ?").bind(k[1]).first();
  if (!plan || Number(plan.test_shop) !== 1) return json({ error: "not_a_test_shop" }, 403, cors);
  await db.prepare(SHOPIFY_TEST_ORDERS_SQL).run();
  const used = await db.prepare("SELECT COUNT(*) AS n FROM shopify_test_orders WHERE shopper_id = ? AND created_at > ?").bind(shopper.id, now - DAY).first();
  if (Number(used && used.n) >= TEST_ORDERS_PER_DAY) return json({ error: "too_many_test_orders" }, 429, cors);
  const item = await db.prepare("SELECT price_minor AS priceMinor, currency FROM retailer_catalog_variants WHERE id = ?").bind(key).first();
  if (!item || item.currency !== "GBP" || !(Number(item.priceMinor) > 0)) return json({ error: "not_a_test_item" }, 400, cors);
  const stores = await (o.listStores ? o.listStores() : listConnectedShopifyStores(env, o)).catch(() => []);
  const store = stores.find(s => s.domain === k[1]);
  if (!store || !store.token) return json({ error: "shop_unavailable" }, 502, cors);
  // Counted before asking Shopify, so a failure can't be retried more than 5 times a day either.
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO shopify_test_orders (id, shopper_id, shop, created_at) VALUES (?,?,?,?)").bind(id, shopper.id, k[1], now).run();
  const amount = (Number(item.priceMinor) / 100).toFixed(2);
  let made = null;
  try {
    const r = await f("https://" + k[1] + "/admin/api/" + API_VERSION + "/graphql.json", { method: "POST",
      headers: { "X-Shopify-Access-Token": store.token, "content-type": "application/json" }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ query: ORDER_CREATE, variables: {
        order: { email: shopper.email, currency: "GBP", test: true, tags: ["relay-test"], note: "Test order made with Relay's testing tools. No real money.",
          financialStatus: "PAID", lineItems: [{ variantId: "gid://shopify/ProductVariant/" + k[2], quantity: 1 }],
          transactions: [{ kind: "SALE", status: "SUCCESS", amountSet: { shopMoney: { amount, currencyCode: "GBP" } } }] },
        options: { sendReceipt: false, sendFulfillmentReceipt: false } } }) });
    const j = await r.json().catch(() => ({}));
    const out = j.data && j.data.orderCreate;
    if (!r.ok || (j.errors && j.errors.length) || !out || (out.userErrors && out.userErrors.length) || !out.order) {
      console.error("shopify_test_order_refused", r.status, String((j.errors && j.errors[0] && j.errors[0].message) || (out && out.userErrors && out.userErrors[0] && out.userErrors[0].message) || "").slice(0, 160));
      return json({ error: "shop_refused" }, 502, cors);
    }
    made = out.order;
  } catch (e) { console.error("shopify_test_order_failed", String(e && e.message || e).slice(0, 120)); return json({ error: "shop_unavailable" }, 502, cors); }
  const pick = (m) => m && m.shopMoney && m.shopMoney.amount;
  const event = { id: made.legacyResourceId, name: made.name, created_at: made.createdAt, processed_at: made.processedAt, currency: made.currencyCode, email: shopper.email,
    total_price: pick(made.totalPriceSet), customer: null,
    line_items: ((made.lineItems && made.lineItems.nodes) || []).map(l => ({ id: String(l.id).split("/").pop(), title: l.title, quantity: l.quantity, price: pick(l.originalUnitPriceSet),
      product_id: l.product ? l.product.legacyResourceId : null, variant_id: l.variant ? l.variant.legacyResourceId : null })) };
  const saved = await ingestShopifyOrder(env, k[1], event, "testing:" + id, "orders/testing");
  await db.prepare("UPDATE shopify_test_orders SET order_id = ? WHERE id = ?").bind("shopify:" + k[1] + ":order:" + String(made.legacyResourceId), id).run();
  const shopName = store.label || k[1].replace(/\.myshopify\.com$/, "");
  return json({ ok: true, name: made.name || null, shown: saved.status === 200,
    message: ["Test order", made.name, "placed at " + shopName + " under your Relay email. No real money moved."].filter(Boolean).join(" ") }, 200, cors);
}
