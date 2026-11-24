// The shopping bag (first version, Connor 24 Nov 2026): things a shopper picked in Browse, kept with their account so the
// bag survives updates and follows them to their other phones. Relay never takes or moves any money for it: "Pay at <shop>"
// opens that shop's own checkout with the items in its basket (the app builds the shop's cart link), one shop after another.
// A later version may take one payment through Stripe Connect; nothing here does.
//
// Only the shopper reads or changes their bag. What's kept for each thing comes from Relay's own copy of the shop's
// catalogue (never from the app), so a bag can only hold products Relay shows: shops connected to Relay (never Relay's
// test shops) and shops' own websites (worker/web-shops.js). Deleted with the account and in Download my data.
//
// GET  /relay/my/bag                    { items, updatedAt }
// POST /relay/my/bag { sku, qty, add }  add: true adds qty (1 to 10) to what's there; otherwise sets it (0 takes it out)
// POST /relay/my/bag/paid { shop }      the shopper said they finished paying at that shop: its things leave the bag
// POST /relay/my/bag/check { shop }     before "Pay at <shop>": each thing's price and whether it can be bought now, from the
//                                       shop's own storefront (its Shopify for a connected shop, its public product data for
//                                       a shop's website). The bag keeps the new prices. 60 checks a day.
import { ensureOnce } from "./once.js";
import { ensureWebShopTables, pageShop, USER_AGENT } from "./web-shops.js";
import { shopifyShopsForDisplay, listConnectedShopifyStores } from "./shopify-connect.js";
import { ensureImageTable } from "./shopify.js";

export const BAG_MAX_ITEMS = 30;
export const BAG_MAX_QTY = 10;
export const BAG_CHECKS_PER_DAY = 60;
const API_VERSION = "2026-07";
const SHOPIFY_SKU = /^shopify:([a-z0-9][a-z0-9-]*\.myshopify\.com):variant:gid:\/\/shopify\/ProductVariant\/(\d{1,20})$/;
const WEB_SKU = /^web:([a-z0-9.-]{3,120}):([A-Za-z0-9:_-]{1,80})$/;
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
const https = (u, max = 600) => (typeof u === "string" && u.length <= max && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);

export function ensureBagTable(db) {
  return ensureOnce(db, "bag", () => db.prepare(
    `CREATE TABLE IF NOT EXISTS shopper_bag (
       shopper_id TEXT PRIMARY KEY, items TEXT NOT NULL, updated_at INTEGER NOT NULL,
       check_day TEXT, checks INTEGER NOT NULL DEFAULT 0)`).run());
}
// Deleting the account deletes the bag with it.
export function bagDeleteStatements(db, shopperId) {
  return [db.prepare("DELETE FROM shopper_bag WHERE shopper_id = ?").bind(shopperId)];
}

async function readRow(db, shopperId) {
  try { return await db.prepare("SELECT items, updated_at, check_day, checks FROM shopper_bag WHERE shopper_id = ?").bind(shopperId).first(); }
  catch (e) { if (/no such table/i.test(String(e && e.message))) return null; throw e; }
}
function itemsOf(row) {
  let list = [];
  try { list = JSON.parse((row && row.items) || "[]"); } catch { list = []; }
  return Array.isArray(list) ? list.filter((x) => x && typeof x.sku === "string" && Number.isInteger(x.qty) && x.qty > 0) : [];
}
export async function readBag(env, shopperId) {
  const row = await readRow(env.RELAY_DB, shopperId);
  return { items: itemsOf(row), updatedAt: (row && row.updated_at) || null };
}
async function writeBag(db, shopperId, items, now, checks) {
  if (!items.length && !checks) { await db.prepare("DELETE FROM shopper_bag WHERE shopper_id = ?").bind(shopperId).run(); return; }
  await db.prepare(`INSERT INTO shopper_bag (shopper_id, items, updated_at, check_day, checks) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(shopper_id) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at, check_day = excluded.check_day, checks = excluded.checks`)
    .bind(shopperId, JSON.stringify(items), now, checks ? checks.day : null, checks ? checks.n : 0).run();
}

// One product as Relay shows it, from Relay's own copy of the shop's catalogue. null when Relay doesn't show it to shoppers
// (unknown, a test shop's, Relay's sandbox, or not in pounds).
export async function catalogueItem(env, sku) {
  const db = env.RELAY_DB, s = String(sku || "");
  const sh = SHOPIFY_SKU.exec(s);
  if (sh) {
    // Connected shops shoppers see: never Relay's test shops (CLAUDE.md rule 15).
    const shops = await shopifyShopsForDisplay(env).catch(() => []);
    const shop = shops.find((x) => x.domain === sh[1]);
    if (!shop) return null;
    await ensureImageTable(db);
    let r;
    const sql = (pic) => `SELECT i.title AS product, v.title AS variation, v.price_minor AS priceMinor, v.currency AS currency, ${pic} AS imageUrl
      FROM retailer_catalog_variants v JOIN retailer_catalog_items i ON i.id = v.item_id LEFT JOIN retailer_item_images img ON img.item_id = i.id
      WHERE v.id = ? AND i.provider = ?`;
    try { r = await db.prepare(sql("COALESCE(i.image_url, img.image_url)")).bind(s, "shopify:" + shop.domain).first(); }
    catch { r = await db.prepare(sql("img.image_url")).bind(s, "shopify:" + shop.domain).first(); }
    if (!r || r.currency !== "GBP" || !(r.priceMinor > 0)) return null;
    return { sku: s, kind: "shopify", product: String(r.product || "").slice(0, 140), variation: r.variation && !/^default title$/i.test(r.variation) ? String(r.variation).slice(0, 80) : null,
      priceMinor: r.priceMinor, imageUrl: https(r.imageUrl), productUrl: null, shop: String(shop.label || shop.domain).slice(0, 80), shopKey: shop.domain,
      origin: "https://" + shop.domain, variantId: sh[2], cart: true };
  }
  const wb = WEB_SKU.exec(s);
  if (wb) {
    await ensureWebShopTables(db);
    const r = await db.prepare(`SELECT i.id, i.domain, i.product, i.variation, i.price_minor, i.available, i.image_url, i.product_url, s.label, s.origin, s.status
      FROM web_shop_items i JOIN web_shops s ON s.domain = i.domain WHERE i.id = ?`).bind(s).first();
    if (!r || !(r.price_minor > 0) || !https(r.product_url)) return null;
    let origin = null;
    try { origin = new URL(r.product_url).origin; } catch { origin = null; }
    const v = /:(\d{1,20})$/.exec(s), cart = !pageShop(r.domain) && Boolean(v);
    return { sku: s, kind: "web", product: String(r.product || "").slice(0, 140), variation: r.variation ? String(r.variation).slice(0, 80) : null,
      priceMinor: r.price_minor, imageUrl: https(r.image_url), productUrl: r.product_url, shop: String(r.label || r.domain).slice(0, 80), shopKey: r.domain,
      origin, variantId: cart ? v[1] : null, cart, soldOut: r.available === 0 };
  }
  return null;
}

async function change(env, shopper, body, now) {
  const db = env.RELAY_DB;
  const sku = typeof body.sku === "string" ? body.sku.trim() : "";
  const qty = body.qty === undefined || body.qty === null ? (body.add ? 1 : null) : body.qty;
  if (!sku || !Number.isInteger(qty) || qty < 0 || qty > BAG_MAX_QTY || (body.add && qty < 1)) return [400, { error: "bad_bag_item" }];
  const row = await readRow(db, shopper.id), items = itemsOf(row);
  const at = items.findIndex((x) => x.sku === sku);
  if (qty === 0 && !body.add) {
    if (at >= 0) items.splice(at, 1);
  } else if (at >= 0) {
    items[at].qty = Math.min(BAG_MAX_QTY, body.add ? items[at].qty + qty : qty);
  } else {
    if (items.length >= BAG_MAX_ITEMS) return [409, { error: "bag_full", max: BAG_MAX_ITEMS }];
    const item = await catalogueItem(env, sku);
    if (!item) return [404, { error: "not_found" }];
    if (item.soldOut) return [409, { error: "sold_out" }];
    const { soldOut, ...kept } = item;
    items.push({ ...kept, qty, addedAt: now });
  }
  await writeBag(db, shopper.id, items, now, row && row.check_day ? { day: row.check_day, n: row.checks || 0 } : null);
  return [200, { items, updatedAt: now }];
}

async function paid(env, shopper, body, now) {
  const shop = typeof body.shop === "string" ? body.shop.trim().toLowerCase() : "";
  if (!shop) return [400, { error: "bad_shop" }];
  const row = await readRow(env.RELAY_DB, shopper.id), items = itemsOf(row).filter((x) => x.shopKey !== shop);
  await writeBag(env.RELAY_DB, shopper.id, items, now, row && row.check_day ? { day: row.check_day, n: row.checks || 0 } : null);
  return [200, { items, updatedAt: now }];
}

// Shopify's storefront prices in a product's .js are whole pence (12900 is £129.00); some themes give "129.00".
const pence = (v) => { if (Number.isInteger(v)) return v > 0 ? v : null; const n = Number.parseFloat(String(v == null ? "" : v)); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };

// What the shop says now about each of these things: { [sku]: { priceMinor, available } }, or nothing for one it didn't say.
async function liveFromWebsite(env, items, f) {
  const out = {};
  const shop = await env.RELAY_DB.prepare("SELECT origin, status FROM web_shops WHERE domain = ?").bind(items[0].shopKey).first();
  // Only a shop whose website let Relay read it (its robots.txt allowed it when Relay last looked), at the address Relay keeps.
  if (!shop || shop.status !== "ok") return out;
  const byHandle = new Map();
  for (const x of items) {
    let u;
    try { u = new URL(x.productUrl); } catch { continue; }
    const h = /^\/products\/([^/?#]{1,200})$/.exec(u.pathname);
    if (!h || !x.variantId || u.origin !== x.origin || (shop.origin && u.origin !== shop.origin)) continue;
    if (!byHandle.has(h[1])) byHandle.set(h[1], []);
    byHandle.get(h[1]).push(x);
  }
  for (const [handle, xs] of [...byHandle].slice(0, 10)) {
    try {
      const r = await f(xs[0].origin + "/products/" + handle + ".js", { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const p = await r.json();
      const variants = Array.isArray(p && p.variants) ? p.variants : [];
      for (const x of xs) {
        const v = variants.find((y) => y && String(y.id) === x.variantId);
        out[x.sku] = v ? { priceMinor: pence(v.price), available: v.available === true ? true : v.available === false ? false : null } : { priceMinor: null, available: false };
      }
    } catch { /* this product couldn't be checked: said so to the shopper */ }
  }
  return out;
}
async function liveFromShopify(env, items, o) {
  const out = {}, f = o.fetchImpl || ((...a) => fetch(...a));
  const stores = await (o.listStores ? o.listStores() : listConnectedShopifyStores(env, o)).catch(() => []);
  const store = stores.find((s) => s.domain === items[0].shopKey);
  if (!store || !store.token) return out;
  try {
    const r = await f("https://" + store.domain + "/admin/api/" + API_VERSION + "/graphql.json", { method: "POST",
      headers: { "X-Shopify-Access-Token": store.token, "content-type": "application/json" }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ query: "query RelayBagCheck($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id price availableForSale product { status } } } }",
        variables: { ids: items.map((x) => "gid://shopify/ProductVariant/" + x.variantId) } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j.errors && j.errors.length)) return out;
    const nodes = (j.data && j.data.nodes) || [];
    items.forEach((x, i) => {
      const n = nodes[i];
      out[x.sku] = n ? { priceMinor: pence(n.price), available: n.availableForSale === true && (!n.product || !n.product.status || n.product.status === "ACTIVE") } : { priceMinor: null, available: false };
    });
  } catch { /* couldn't reach the shop: said so to the shopper */ }
  return out;
}

async function check(env, shopper, body, o) {
  const db = env.RELAY_DB, now = o.now || Date.now(), f = o.fetchImpl || ((...a) => fetch(...a));
  const shop = typeof body.shop === "string" ? body.shop.trim().toLowerCase() : "";
  if (!shop) return [400, { error: "bad_shop" }];
  const row = await readRow(db, shopper.id), items = itemsOf(row);
  const here = items.filter((x) => x.shopKey === shop);
  if (!here.length) return [404, { error: "not_found" }];
  const day = new Date(now).toISOString().slice(0, 10);
  const used = row && row.check_day === day ? row.checks || 0 : 0;
  if (used >= BAG_CHECKS_PER_DAY) return [429, { error: "too_many_checks" }];
  // A shop whose basket Relay can't fill (read from its product pages): nothing to check from its storefront.
  const canCart = here.every((x) => x.cart && x.variantId && https(x.origin));
  const live = !canCart ? {} : here[0].kind === "shopify" ? await liveFromShopify(env, here, { ...o, fetchImpl: f }) : await liveFromWebsite(env, here, f);
  const result = here.map((x) => {
    const l = live[x.sku];
    if (!l) return { sku: x.sku, checked: false, priceMinor: x.priceMinor, was: x.priceMinor, available: null };
    const priceMinor = l.priceMinor || x.priceMinor;
    return { sku: x.sku, checked: true, priceMinor, was: x.priceMinor, available: l.available };
  });
  // The bag keeps what the shop said: the new price, and whether it can be bought.
  for (const r of result) {
    const x = items.find((y) => y.sku === r.sku);
    if (!x || !r.checked) continue;
    x.priceMinor = r.priceMinor;
    if (r.available === false) x.soldOut = true; else delete x.soldOut;
    x.checkedAt = now;
  }
  await writeBag(db, shopper.id, items, now, { day, n: used + 1 });
  return [200, { shop, cart: canCart, checkedAt: now, results: result, items, updatedAt: now }];
}

// For "Download my data": what's in the bag.
export async function bagForExport(env, shopperId) {
  const { items, updatedAt } = await readBag(env, shopperId);
  if (!items.length) return null;
  return { updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
    items: items.map((x) => ({ shop: x.shop, product: x.product, variation: x.variation || null, quantity: x.qty, priceMinor: x.priceMinor, currency: "GBP", addedAt: x.addedAt ? new Date(x.addedAt).toISOString() : null })) };
}

export async function handleBagRoute(request, env, url, cors, shopper, o = {}) {
  const path = url.pathname;
  if (path !== "/relay/my/bag" && path !== "/relay/my/bag/paid" && path !== "/relay/my/bag/check") return null;
  await ensureBagTable(env.RELAY_DB);
  const now = o.now || Date.now();
  if (path === "/relay/my/bag" && request.method === "GET") return json(await readBag(env, shopper.id), 200, cors);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
  let body;
  try { const t = await request.text(); body = t ? JSON.parse(t) : {}; } catch { body = null; }
  if (!body || typeof body !== "object") return json({ error: "bad_request" }, 400, cors);
  const [status, out] = path === "/relay/my/bag" ? await change(env, shopper, body, now)
    : path === "/relay/my/bag/paid" ? await paid(env, shopper, body, now) : await check(env, shopper, body, { ...o, now });
  return json(out, status, cors);
}
