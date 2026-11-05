// Swapping across shops: send an item back to the shop it came from (shop A) and get something from another shop on Relay
// (shop B) instead, in one go.
//
// What Relay does:
//  - Starts the return at shop A exactly as a return through Relay does (returns.js): it's noted on the shopper's account,
//    shop A is emailed, and there's a Royal Mail label when shop A has set that up.
//  - Gives the shopper a link that opens shop B's own checkout with the new item in the basket. The shopper pays shop B
//    there, however shop B takes payment. Shop A refunds the shopper to how they paid once the item is back.
//  - Relay never takes, holds or moves money, and never places an order at shop B itself.
//  - When shop B tells Relay about a paid order for that item placed with the shopper's verified sign-in email (orders
//    reach Relay from connected shops, see shopify-webhooks.js), the swap shows as ordered.
//
// Who: only the shopper whose verified sign-in email matches shop A's order (returns.js checks). What: an item that can still
// be returned through Relay, for an item shop B has for sale right now (asked of shop B's Shopify before anything starts).
// Test shops (Shopify development stores) only swap with test shops, and real shops only with real shops.
import { ensureOnce } from "./once.js";
import { checkEligibility, initiateReturn, ensureReturnsTables, REASON_TEXT } from "./returns.js";
import { listConnectedShopifyStores, shopifyShopsForDisplay } from "./shopify-connect.js";
import { ensureImageTable } from "./shopify.js";
import { ensureExchangeTables } from "./exchange.js";

const API_VERSION = "2026-07";
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
// A catalogue item at a Shopify shop: "shopify:<shop>.myshopify.com:variant:gid://shopify/ProductVariant/<number>".
export const ITEM_KEY = /^shopify:([a-z0-9-]+\.myshopify\.com):variant:gid:\/\/shopify\/ProductVariant\/(\d{1,20})$/;
const PER_SHOP = 40;
// An order at shop B counts for the swap if it was placed after the swap started, give or take the shop's clock.
const MATCH_SLACK_MS = 10 * 60 * 1000;
// A swap that started but never finished starting (the worker stopped part-way) stops blocking the item after this long.
const STUCK_MS = 5 * 60 * 1000;
const iso = (t) => (Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null);
const shopWord = (domain) => String(domain || "").replace(/\.myshopify\.com$/, "");

export const CROSS_SWAP_SQL = `CREATE TABLE IF NOT EXISTS relay_cross_swaps (id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, order_id TEXT NOT NULL,
  line_id TEXT NOT NULL, from_shop TEXT NOT NULL, from_shop_name TEXT, from_title TEXT, from_price_minor INTEGER, return_id TEXT, return_ref TEXT,
  to_shop TEXT NOT NULL, to_shop_name TEXT, to_variant TEXT NOT NULL, to_title TEXT, to_price_minor INTEGER, status TEXT NOT NULL,
  new_order_id TEXT, created_at INTEGER NOT NULL, ordered_at INTEGER)`;

export function ensureCrossSwapTables(db) {
  return ensureOnce(db, "cross-swaps", async () => {
    await db.prepare(CROSS_SWAP_SQL).run();
    // One swap per item: the return it starts means the item can't be returned or swapped again anyway.
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_cross_swaps_line ON relay_cross_swaps(order_id, line_id)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_cross_swaps_shopper ON relay_cross_swaps(shopper_id)").run();
  });
}

async function gql(shop, token, query, variables, f) {
  const r = await f("https://" + shop + "/admin/api/" + API_VERSION + "/graphql.json", { method: "POST",
    headers: { "X-Shopify-Access-Token": token, "content-type": "application/json" }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.errors && j.errors.length)) throw new Error("Shopify said " + r.status);
  return j.data || {};
}

// The shops a swap from shop A may go to: other shops connected to Relay through Shopify, of the same kind as shop A.
async function shopsFor(env, fromShop) {
  const all = await shopifyShopsForDisplay(env, { includeTest: true }).catch(() => []);
  const from = all.find(s => s.domain === fromShop);
  // A shop Relay can't place is treated as a test shop, so it's never mixed with real ones.
  const fromTest = !from || Boolean(from.test);
  return { fromName: (from && from.label) || shopWord(fromShop), fromTest,
    shops: all.filter(s => s.connected && s.domain !== fromShop && Boolean(s.test) === fromTest) };
}

// Items at a shop from the catalogue Relay keeps of it (refreshed from the shop): priced in pounds and in stock when Relay
// last looked. keys: only these items (any stock), for checking one the shopper picked.
async function itemsAt(db, shop, keys) {
  await ensureImageTable(db);
  const only = keys ? " AND v.id IN (" + keys.map(() => "?").join(",") + ")" : "";
  const sql = (picture) => `SELECT i.title AS product, v.title AS variant, v.id AS key, v.price_minor AS priceMinor, ${picture} AS imageUrl, MAX(q.quantity) AS quantity
    FROM retailer_catalog_items i JOIN retailer_catalog_variants v ON v.item_id = i.id
    LEFT JOIN retailer_item_images img ON img.item_id = i.id
    LEFT JOIN retailer_inventory_snapshots q ON q.variant_id = v.id
    WHERE i.provider = ? AND v.price_minor > 0 AND v.currency = 'GBP'${only}
    GROUP BY i.id, v.id ${keys ? "" : "HAVING MAX(q.quantity) > 0 "}ORDER BY i.title, v.title LIMIT ${PER_SHOP}`;
  const args = ["shopify:" + shop.domain, ...(keys || [])];
  let rows;
  // Older databases may not have the item picture column yet (it's added when a shop's catalogue is first read).
  try { rows = (await db.prepare(sql("COALESCE(i.image_url, img.image_url)")).bind(...args).all()).results || []; }
  catch { rows = (await db.prepare(sql("img.image_url")).bind(...args).all()).results || []; }
  return rows.map(r => ({ key: r.key, product: r.product, variant: r.variant && !/^default title$/i.test(r.variant) ? r.variant : null,
    priceMinor: r.priceMinor, imageUrl: /^https:\/\/[^\s"'<>]{8,600}$/.test(String(r.imageUrl || "")) ? r.imageUrl : null, shop: shop.label || shopWord(shop.domain) }));
}
const titleOf = (x) => x.product + (x.variant ? " (" + x.variant + ")" : "");

// GET /relay/my/cross-swap/options?orderId=&lineId=: whether this item can be swapped with another shop, and what's on offer.
async function options(env, shopper, url) {
  const check = await checkEligibility(env, shopper, url.searchParams.get("orderId"), url.searchParams.get("lineId"));
  if (!check.eligible) return check.reason === "not_your_order" ? [404, { error: "not_your_order" }] : [200, { eligible: false, reason: check.reason }];
  if (check.square) return [200, { eligible: false, reason: "retailer_not_supported" }];
  const { fromName, shops } = await shopsFor(env, check.shop);
  const out = [];
  for (const s of shops) {
    const items = await itemsAt(env.RELAY_DB, s);
    if (items.length) out.push({ name: s.label || shopWord(s.domain), items: items.map(({ shop, ...x }) => x) });
  }
  return [200, { eligible: true, item: { title: check.line.title, priceMinor: check.line.priceMinor, shop: fromName }, shops: out }];
}

// POST /relay/my/cross-swap { orderId, lineId, toKey, reason, agreedPriceMinor }: checks shop B has the item at the price the
// shopper agreed, starts the return at shop A, and answers with the link to shop B's checkout.
async function start(env, shopper, body, o) {
  const db = env.RELAY_DB, f = o.fetchImpl || ((...a) => fetch(...a)), now = o.now || Date.now();
  const reason = body && body.reason;
  if (!Object.prototype.hasOwnProperty.call(REASON_TEXT, String(reason))) return [400, { error: "reason_needed" }];
  const k = ITEM_KEY.exec(String(body && body.toKey || ""));
  if (!k) return [400, { error: "not_an_option" }];
  const check = await checkEligibility(env, shopper, body.orderId, body.lineId);
  if (!check.eligible) return [check.reason === "not_your_order" ? 404 : 409, { error: check.reason }];
  if (check.square) return [409, { error: "retailer_not_supported" }];
  const { fromName, shops } = await shopsFor(env, check.shop);
  const to = shops.find(s => s.domain === k[1]);
  if (!to) return [400, { error: "not_an_option" }];
  const item = (await itemsAt(db, to, [body.toKey]))[0];
  if (!item) return [400, { error: "not_an_option" }];
  // Shop B's own Shopify decides: the item is on sale and can be bought now, and at what price.
  const stores = await (o.listStores ? o.listStores() : listConnectedShopifyStores(env, o)).catch(() => []);
  const store = stores.find(s => s.domain === to.domain);
  if (!store || !store.token) return [502, { error: "shop_unavailable" }];
  let pv = null;
  try {
    pv = (await gql(to.domain, store.token, "query RelayCrossSwapCheck($v: ID!) { productVariant(id: $v) { availableForSale price product { status } } }",
      { v: "gid://shopify/ProductVariant/" + k[2] }, f)).productVariant;
  } catch { return [502, { error: "shop_unavailable" }]; }
  if (!pv || pv.availableForSale !== true || (pv.product && pv.product.status && pv.product.status !== "ACTIVE")) return [409, { error: "out_of_stock" }];
  const livePrice = Math.round(Number(pv.price) * 100);
  if (!Number.isInteger(livePrice) || livePrice <= 0) return [502, { error: "shop_unavailable" }];
  // The shopper must have agreed to the price shop B charges now (the list shows the price Relay last saw).
  if (Number(body.agreedPriceMinor) !== livePrice) return [409, { error: "price_changed", priceMinor: livePrice }];

  await ensureCrossSwapTables(db);
  await ensureReturnsTables(db);
  // Saved first, as "starting", so a second tap can't start a second swap (one per item); a start that never finished
  // (the server stopped part-way, so there's no return) stops blocking the item after a few minutes.
  await db.prepare("DELETE FROM relay_cross_swaps WHERE order_id = ? AND line_id = ? AND status = 'starting' AND created_at < ?").bind(check.order.id, check.line.lineId, now - STUCK_MS).run();
  const id = crypto.randomUUID(), toTitle = titleOf(item);
  try {
    await db.prepare(`INSERT INTO relay_cross_swaps (id, shopper_id, order_id, line_id, from_shop, from_shop_name, from_title, from_price_minor, to_shop, to_shop_name,
      to_variant, to_title, to_price_minor, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, shopper.id, check.order.id, check.line.lineId, check.shop, fromName, check.line.title, check.line.priceMinor, to.domain, to.label || shopWord(to.domain),
        "gid://shopify/ProductVariant/" + k[2], toTitle, livePrice, "starting", now).run();
  } catch { return [409, { error: "already_swapping" }]; }
  let st, ret;
  try { [st, ret] = await initiateReturn(env, shopper, { orderId: body.orderId, lineId: body.lineId, reason }, o); }
  catch (e) { st = 503; ret = { error: "return_not_started" }; console.error("cross_swap_return_failed", String(e && e.message || e).slice(0, 120)); }
  if (st !== 200) {
    await db.prepare("DELETE FROM relay_cross_swaps WHERE id = ?").bind(id).run();
    return [st, ret];
  }
  await db.prepare("UPDATE relay_cross_swaps SET status = 'waiting', return_id = ?, return_ref = ? WHERE id = ?").bind(ret.returnId, ret.returnRef, id).run();
  return [200, { ...ret, swapId: id, fromShop: fromName, fromTitle: check.line.title, fromPriceMinor: check.line.priceMinor,
    toShop: to.label || shopWord(to.domain), toTitle, toPriceMinor: livePrice, toKey: body.toKey, buyUrl: buyLink(to.domain, k[2]), testShop: Boolean(to.test) }];
}

// Shop B's own checkout with the item in the basket (Shopify's cart link). Nothing about the shopper goes in it.
const buyLink = (domain, variant) => "https://" + domain + "/cart/" + variant + ":1";

// The shopper's swaps across shops, newest first. A swap waiting for shop B's order is matched to it here: a paid order at
// shop B for that item, placed with the shopper's verified sign-in email after the swap started, not already counted for
// another swap. Never anyone else's order.
export async function crossSwapsFor(env, shopper) {
  const db = env.RELAY_DB;
  await ensureCrossSwapTables(db);
  const rows = (await db.prepare(`SELECT * FROM relay_cross_swaps WHERE shopper_id = ? AND status IN ('waiting','ordered') ORDER BY created_at DESC LIMIT 100`)
    .bind(shopper.id).all()).results || [];
  for (const r of rows) {
    if (r.status !== "waiting") continue;
    const variant = (/\/(\d{1,20})$/.exec(String(r.to_variant)) || [])[1];
    if (!variant) continue;
    const found = (await db.prepare(`SELECT o.id AS id, o.ordered_at AS at FROM retailer_orders o JOIN retailer_order_emails e ON e.order_id = o.id
        JOIN order_items i ON i.order_id = o.id
      WHERE o.connection_id = ? AND e.email_hash = ? AND i.variant_id = ?
        AND o.id NOT IN (SELECT new_order_id FROM relay_cross_swaps WHERE new_order_id IS NOT NULL)`)
      .bind("shopify:" + r.to_shop, shopper.emailHash, variant).all()).results || [];
    const hit = found.map(x => ({ id: x.id, t: Date.parse(x.at) })).filter(x => Number.isFinite(x.t) && x.t >= r.created_at - MATCH_SLACK_MS).sort((a, b) => a.t - b.t)[0];
    if (!hit) continue;
    const done = await db.prepare("UPDATE relay_cross_swaps SET status = 'ordered', new_order_id = ?, ordered_at = ? WHERE id = ? AND status = 'waiting'").bind(hit.id, hit.t, r.id).run();
    if (Number(done && done.meta && done.meta.changes) === 0) continue;
    r.status = "ordered"; r.new_order_id = hit.id; r.ordered_at = hit.t;
  }
  const tests = new Set((await shopifyShopsForDisplay(env, { includeTest: true }).catch(() => [])).filter(s => s.test).map(s => s.domain));
  return rows.map(r => {
    const variant = (/\/(\d{1,20})$/.exec(String(r.to_variant)) || [])[1];
    const waiting = r.status === "waiting" && variant;
    return { id: r.id, orderId: r.order_id, lineId: r.line_id, fromShop: r.from_shop_name || shopWord(r.from_shop), fromTitle: r.from_title,
      fromPriceMinor: r.from_price_minor, returnRef: r.return_ref, toShop: r.to_shop_name || shopWord(r.to_shop), toTitle: r.to_title, toPriceMinor: r.to_price_minor,
      status: r.status, startedAt: iso(r.created_at), orderedAt: iso(r.ordered_at), newOrderId: r.new_order_id || null, toVariantId: variant || null,
      buyUrl: waiting ? buyLink(r.to_shop, variant) : null, toKey: waiting ? "shopify:" + r.to_shop + ":variant:gid://shopify/ProductVariant/" + variant : null,
      testShop: tests.has(r.to_shop) };
  });
}

// Every shop connected to Relay through Shopify (domain -> whether it's a test shop), and which of them have something a swap
// could go to (in stock and priced in pounds when Relay last looked).
async function shopsWithStock(env) {
  const all = await shopifyShopsForDisplay(env, { includeTest: true });
  const stocked = new Set(((await env.RELAY_DB.prepare(`SELECT DISTINCT i.provider AS p FROM retailer_catalog_items i JOIN retailer_catalog_variants v ON v.item_id = i.id
      JOIN retailer_inventory_snapshots q ON q.variant_id = v.id WHERE i.provider LIKE 'shopify:%' AND v.price_minor > 0 AND v.currency = 'GBP' AND q.quantity > 0`).all()).results || [])
    .map(r => String(r.p).slice(8)));
  return { kinds: new Map(all.map(s => [s.domain, Boolean(s.test)])), stocked: all.filter(s => s.connected && stocked.has(s.domain)) };
}

// Puts each swap on the purchases it belongs to: the item sent back (crossSwap, which stops it being offered for another
// swap or return) and the item bought from shop B (boughtInSwap). Marks items that can still be returned with otherShops
// when another shop of the same kind has something in stock, so the app offers the swap only where there's a choice.
// A failure leaves the purchases as they were.
export async function attachCrossSwaps(env, shopper, purchases) {
  let swaps;
  try { swaps = await crossSwapsFor(env, shopper); } catch (e) { console.error("cross_swaps_unavailable", String(e && e.message || e).slice(0, 120)); return purchases; }
  for (const s of swaps) {
    const from = purchases.find(p => p.id === s.orderId);
    const line = from && (from.items || []).find(it => String(it.lineId) === String(s.lineId));
    if (line) { const { newOrderId, toVariantId, ...shown } = s; line.crossSwap = shown; line.exchangeable = false; line.returnable = false; }
    const to = s.newOrderId && purchases.find(p => p.id === s.newOrderId);
    const bought = to && (to.items || []).find(it => String(it.variantId) === String(s.toVariantId));
    if (bought) bought.boughtInSwap = { fromShop: s.fromShop, fromTitle: s.fromTitle };
  }
  const shopify = purchases.filter(p => /^shopify:[a-z0-9-]+\.myshopify\.com$/.test(String(p.retailer || "")) && (p.items || []).some(it => it.returnable));
  if (!shopify.length) return purchases;
  let shops;
  try { shops = await shopsWithStock(env); } catch { return purchases; }
  for (const p of shopify) {
    const domain = String(p.retailer).slice(8);
    // A shop Relay can't place counts as a test shop, as in shopsFor.
    const test = shops.kinds.has(domain) ? shops.kinds.get(domain) : true;
    if (shops.stocked.some(s => s.domain !== domain && Boolean(s.test) === test)) for (const it of p.items || []) if (it.returnable) it.otherShops = true;
  }
  return purchases;
}

// "Delete my account": the swaps across shops are deleted. The return each one started at the first shop is kept, like any
// return through Relay, because that shop relies on it (see privacy.html); the second shop's order stays with that shop.
export async function crossSwapDeleteStatements(db, shopperId) {
  await ensureCrossSwapTables(db);
  return [db.prepare("DELETE FROM relay_cross_swaps WHERE shopper_id = ?").bind(shopperId)];
}

// What "Download my data" includes.
export async function crossSwapsForExport(env, shopperId) {
  try {
    const rows = (await env.RELAY_DB.prepare(`SELECT id, order_id AS orderId, from_shop_name AS fromShop, from_title AS sentBack, return_ref AS returnReference,
        to_shop_name AS toShop, to_title AS gettingInstead, to_price_minor AS pricePence, status, new_order_id AS newOrderId, created_at AS startedAt, ordered_at AS orderedAt
      FROM relay_cross_swaps WHERE shopper_id = ? AND status IN ('waiting','ordered') ORDER BY created_at`).bind(shopperId).all()).results || [];
    return rows.map(r => ({ ...r, startedAt: iso(r.startedAt), orderedAt: iso(r.orderedAt) }));
  } catch (e) { if (/no such table/i.test(String(e && e.message))) return []; throw e; }
}

// Routes under /relay/my/cross-swap for a signed-in shopper.
export async function handleCrossSwapRoute(request, env, url, cors, shopper, o = {}) {
  const path = url.pathname;
  if (path !== "/relay/my/cross-swap" && path !== "/relay/my/cross-swap/options" && path !== "/relay/my/cross-swaps") return null;
  await ensureCrossSwapTables(env.RELAY_DB);
  await ensureReturnsTables(env.RELAY_DB);
  await ensureExchangeTables(env.RELAY_DB); // the return checks look for a swap of another size or colour too
  if (path === "/relay/my/cross-swap/options" && request.method === "GET") { const [s, b] = await options(env, shopper, url); return json(b, s, cors); }
  if (path === "/relay/my/cross-swaps" && request.method === "GET") return json({ swaps: await crossSwapsFor(env, shopper) }, 200, cors);
  if (path === "/relay/my/cross-swap" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const [s, b] = await start(env, shopper, body || {}, o);
    return json(b, s, cors);
  }
  return json({ error: "not_found" }, 404, cors);
}
