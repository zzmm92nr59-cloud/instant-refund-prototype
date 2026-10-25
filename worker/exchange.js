// Exchanges through Relay: a shopper swaps an item on their own order for another size or colour of the same product.
//
// Who can exchange: only the shopper whose verified sign-in email matches the order's email (the shop confirmed the order).
// What can be swapped: another variant of the same product, at the same price, that the shop has in stock.
// How: Relay edits the order inside the shop's own Shopify (removes the old item, restocks it, adds the new one) using
// Shopify's order editing. Same price, so nothing is charged or refunded. Orders already sent out can't be edited this way;
// those need the shop's returns process (not built yet), and Relay says so.
import { ensureOnce } from "./once.js";
import { listConnectedShopifyStores } from "./shopify-connect.js";

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
  for (const o of purchases) {
    const m = SHOP.exec(String(o.retailer || ""));
    for (const it of o.items || []) {
      it.exchangeable = false;
      if (!m || !it.variantId) continue;
      const v = await db.prepare(`SELECT v.title AS variant, i.image_url AS imageUrl, i.title AS product FROM retailer_catalog_variants v JOIN retailer_catalog_items i ON i.id = v.item_id WHERE v.id = ?`)
        .bind(variantKey(m[1], it.variantId)).first();
      if (v) { it.variant = v.variant && v.variant !== "Default Title" ? v.variant : null; it.imageUrl = v.imageUrl || null; }
      const ex = await db.prepare("SELECT to_title AS toTitle, from_title AS fromTitle, status, created_at AS at FROM relay_exchanges WHERE order_id = ? AND line_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1")
        .bind(o.id, it.lineId).first();
      if (ex) { it.exchange = ex; it.variant = ex.toTitle || it.variant; }
      it.exchangeable = !ex && Boolean(it.productId);
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

async function options(env, owned) {
  const db = env.RELAY_DB;
  const rows = ((await db.prepare(`SELECT v.id AS key, v.external_variant_id AS gid, v.title, v.price_minor AS priceMinor, v.currency,
      (SELECT MAX(s.quantity) FROM retailer_inventory_snapshots s WHERE s.variant_id = v.id) AS quantity
    FROM retailer_catalog_variants v WHERE v.item_id = ? ORDER BY v.title`).bind(itemKey(owned.shop, owned.line.productId)).all()).results || []);
  const done = await db.prepare("SELECT to_variant AS v FROM relay_exchanges WHERE order_id = ? AND line_id = ? AND status = 'done' ORDER BY created_at DESC LIMIT 1")
    .bind(owned.order.id, owned.line.lineId).first();
  const current = done ? done.v : "gid://shopify/ProductVariant/" + owned.line.variantId;
  return rows.filter(r => r.gid !== current).map(r => {
    const inStock = Number(r.quantity) > 0;
    const samePrice = r.priceMinor === owned.line.priceMinor && r.currency === "GBP";
    return { key: r.key, title: r.title, priceMinor: r.priceMinor, quantity: r.quantity, available: inStock && samePrice,
      reason: !inStock ? "Out of stock" : !samePrice ? "Different price (not supported yet)" : null };
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

async function doExchange(env, shopper, body, o) {
  const db = env.RELAY_DB, f = o.fetchImpl || ((...a) => fetch(...a));
  const owned = await ownedLine(env, shopper, body && body.orderId, body && body.lineId);
  if (!owned) return [404, { error: "not_your_order" }];
  const already = await db.prepare("SELECT 1 AS x FROM relay_exchanges WHERE order_id = ? AND line_id = ? AND status = 'done'").bind(owned.order.id, owned.line.lineId).first();
  if (already) return [409, { error: "already_exchanged" }];
  const choice = (await options(env, owned)).find(x => x.key === String(body && body.variantKey || ""));
  if (!choice) return [400, { error: "not_an_option" }];
  if (!choice.available) return [409, { error: choice.reason === "Out of stock" ? "out_of_stock" : "different_price" }];
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
  try {
    // Live checks at the shop: the order hasn't been sent, and the new item really is in stock right now.
    const live = await gql(owned.shop, store.token, `query RelayExchangeCheck($o: ID!, $v: ID!) { order(id: $o) { cancelledAt displayFulfillmentStatus }
      productVariant(id: $v) { inventoryQuantity title } }`, { o: "gid://shopify/Order/" + owned.order.ext, v: toGid }, f);
    if (!live.order || live.order.cancelledAt) return [409, { error: "order_cancelled" }];
    if (live.order.displayFulfillmentStatus !== "UNFULFILLED") return [409, { error: "already_sent" }];
    if (!live.productVariant || !(Number(live.productVariant.inventoryQuantity) >= owned.line.quantity)) return [409, { error: "out_of_stock" }];
    // Shopify order edit: begin, take the old item out (back into stock), add the new one, commit.
    const begin = await gql(owned.shop, store.token, `mutation RelayEditBegin($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { id lineItems(first: 100) { nodes { id quantity variant { id } } } } userErrors { message } } }`,
      { id: "gid://shopify/Order/" + owned.order.ext }, f);
    const calc = begin.orderEditBegin && begin.orderEditBegin.calculatedOrder;
    if (!calc) throw new Error(firstError(begin.orderEditBegin) || "Shopify wouldn't open the order for editing");
    const oldLine = ((calc.lineItems && calc.lineItems.nodes) || []).find(n => n.variant && n.variant.id === fromGid && n.quantity > 0);
    if (!oldLine) throw new Error("The item isn't on the order any more");
    const out = await gql(owned.shop, store.token, `mutation RelayEditRemove($id: ID!, $line: ID!) { orderEditSetQuantity(id: $id, lineItemId: $line, quantity: 0, restock: true) { userErrors { message } } }`,
      { id: calc.id, line: oldLine.id }, f);
    if (firstError(out.orderEditSetQuantity)) throw new Error(firstError(out.orderEditSetQuantity));
    const add = await gql(owned.shop, store.token, `mutation RelayEditAdd($id: ID!, $v: ID!, $q: Int!) { orderEditAddVariant(id: $id, variantId: $v, quantity: $q, allowDuplicates: false) { userErrors { message } } }`,
      { id: calc.id, v: toGid, q: owned.line.quantity }, f);
    if (firstError(add.orderEditAddVariant)) throw new Error(firstError(add.orderEditAddVariant));
    const commit = await gql(owned.shop, store.token, `mutation RelayEditCommit($id: ID!, $note: String) { orderEditCommit(id: $id, notifyCustomer: false, staffNote: $note) { order { id } userErrors { message } } }`,
      { id: calc.id, note: "Exchanged through Relay: " + owned.line.title + " → " + choice.title + ". Same price, nothing to pay or refund." }, f);
    if (!(commit.orderEditCommit && commit.orderEditCommit.order)) throw new Error(firstError(commit.orderEditCommit) || "Shopify didn't save the change");
    await record("done", null);
    return [200, { exchanged: true, to: choice.title, message: "Done. Your order now has " + choice.title + " instead. Nothing to pay or refund." }];
  } catch (e) {
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
    return json({ product: owned.line.title, priceMinor: owned.line.priceMinor, options: await options(env, owned) }, 200, cors);
  }
  if (path === "/relay/my/exchange" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const [status, out] = await doExchange(env, shopper, body, o);
    return json(out, status, cors);
  }
  return json({ error: "not_found" }, 404, cors);
}
