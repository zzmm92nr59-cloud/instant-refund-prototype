// Relay for retailers: tells a shop which of its items Relay shoppers are watching, and lets the shop send those watchers an offer.
//
// Who can see a shop's figures: only someone holding that shop's retailer key. A key is handed out when the shop signs in
// with Square ("Connect with Square"), which proves they run that Square account. Relay keeps only a hash of each key.
// What a shop sees: counts only — how many shoppers watch each item, how many follow the whole shop, how many started this week.
// Never a shopper's name, email, id or device. A count below 3 is shown as "fewer than 3", so a shop can't single anyone out.
// Only UK shops selling in pounds take part. The same is true of offers: the shop never learns who received one.
// What an offer does: sends a phone alert to the shoppers watching that item. It does not change the shop's price in Square
// or Shopify and Relay does not take payment; the shop honours the offer price itself.
import { ensureOnce } from "./once.js";
import { ensurePushTables, sendPush, subsOf, priceText } from "./push.js";

const enc = new TextEncoder();
const MAX_KEYS_PER_SHOP = 5, OFFERS_PER_DAY = 10, MAX_HOURS = 168;
export const PRIVACY_MIN = 3;
// A count a shop may see: the number itself from 3 upwards; below that only "fewer than 3" (0 stays 0 where it's shown at all).
const shown = (n) => (n >= PRIVACY_MIN ? n : null);
const shownText = (n) => (n >= PRIVACY_MIN ? String(n) : n > 0 ? "Fewer than " + PRIVACY_MIN : "0");
const SKU = /^[A-Za-z0-9:_.\-\/]{1,200}$/;
const json = (body, status = 200, cors = {}) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
const clean = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) : "");
const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hashKey(env, key) {
  const k = await crypto.subtle.importKey("raw", enc.encode("relay-retailer-key:" + env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(key))));
}

export function ensureRetailerTables(db) {
  return ensureOnce(db, "retailer", async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS retailer_keys (key_hash TEXT PRIMARY KEY, provider TEXT NOT NULL, shop_ref TEXT NOT NULL,
      store_label TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER)`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_retailer_keys_shop ON retailer_keys(provider, shop_ref)").run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS retailer_offers (id TEXT PRIMARY KEY, provider TEXT NOT NULL, shop_ref TEXT NOT NULL, store_label TEXT NOT NULL,
      sku TEXT NOT NULL, product TEXT NOT NULL, variant TEXT, offer_minor INTEGER NOT NULL, was_minor INTEGER NOT NULL, note TEXT,
      starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, shoppers INTEGER NOT NULL DEFAULT 0, devices INTEGER NOT NULL DEFAULT 0)`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_retailer_offers_shop ON retailer_offers(provider, shop_ref, starts_at)").run();
  });
}

// Makes a new key for a shop and returns it once. Older keys beyond the newest few stop working.
export async function issueRetailerKey(env, { provider, shopRef, storeLabel }, now = Date.now()) {
  const db = env.RELAY_DB;
  await ensureRetailerTables(db);
  const key = "rk_" + b64u(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare("INSERT INTO retailer_keys (key_hash, provider, shop_ref, store_label, created_at) VALUES (?,?,?,?,?)")
    .bind(await hashKey(env, key), provider, shopRef, storeLabel, now).run();
  await db.prepare(`DELETE FROM retailer_keys WHERE provider = ? AND shop_ref = ? AND key_hash NOT IN
    (SELECT key_hash FROM retailer_keys WHERE provider = ? AND shop_ref = ? ORDER BY created_at DESC LIMIT ${MAX_KEYS_PER_SHOP})`)
    .bind(provider, shopRef, provider, shopRef).run();
  return key;
}

async function shopFromRequest(request, env, now) {
  const m = /^Bearer (rk_[A-Za-z0-9_-]{20,80})$/.exec(request.headers.get("Authorization") || "");
  if (!m) return null;
  const h = await hashKey(env, m[1]);
  const row = await env.RELAY_DB.prepare("SELECT provider, shop_ref, store_label FROM retailer_keys WHERE key_hash = ?").bind(h).first();
  if (!row) return null;
  await env.RELAY_DB.prepare("UPDATE retailer_keys SET last_used_at = ? WHERE key_hash = ?").bind(now, h).run();
  // The shop's current name (it may have been renamed in Square since the key was made).
  if (row.provider === "square") {
    const cur = await env.RELAY_DB.prepare("SELECT label FROM square_merchants WHERE merchant_id = ?").bind(row.shop_ref).first().catch(() => null);
    if (cur && cur.label) row.store_label = cur.label;
  }
  if (row.provider === "shopify") {
    const cur = await env.RELAY_DB.prepare("SELECT label FROM shopify_shops WHERE domain = ?").bind(row.shop_ref).first().catch(() => null);
    if (cur && cur.label) row.store_label = cur.label;
  }
  return row;
}

// The shop's own catalogue rows, one per variant. "sku" is the key shoppers watch the item by: the shop's SKU for Square,
// and Relay's shop-scoped variant id for Shopify (Shopify SKUs are optional and can repeat between shops).
async function shopVariants(db, shop) {
  const shopify = shop.provider === "shopify";
  const sql = `SELECT ${shopify ? "v.id" : "v.sku"} AS sku, v.sku AS retailerSku, v.title AS variant, v.price_minor AS priceMinor, v.currency AS currency, i.title AS product, i.image_url AS imageUrl
      FROM retailer_catalog_variants v JOIN retailer_catalog_items i ON i.id = v.item_id
     WHERE ${shopify ? "i.provider = ?" : "i.provider = 'square_sandbox' AND i.store_label = ? AND v.sku IS NOT NULL"} AND v.currency = 'GBP' LIMIT 2000`;
  return ((await db.prepare(sql).bind(shopify ? "shopify:" + shop.shop_ref : shop.store_label).all()).results || []);
}
// If the shop's catalogue is in another currency, the dashboard says why nothing shows.
async function otherCurrency(db, shop) {
  const shopify = shop.provider === "shopify";
  const row = await db.prepare(`SELECT v.currency AS c FROM retailer_catalog_variants v JOIN retailer_catalog_items i ON i.id = v.item_id
     WHERE ${shopify ? "i.provider = ?" : "i.provider = 'square_sandbox' AND i.store_label = ?"} AND v.currency IS NOT NULL AND v.currency <> 'GBP' LIMIT 1`)
    .bind(shopify ? "shopify:" + shop.shop_ref : shop.store_label).first();
  return row ? row.c : null;
}

// Demand for one shop: counts only, never who.
export async function shopDemand(env, shop, now = Date.now()) {
  const db = env.RELAY_DB, label = shop.store_label;
  await ensurePushTables(db);
  const variants = await shopVariants(db, shop);
  const bySku = new Map(variants.map(v => [v.sku, v]));
  const rows = ((await db.prepare(`SELECT shopper_id, sku, via, created_at FROM price_watches WHERE store = ? LIMIT 50000`).bind(label).all()).results || []);
  const week = now - 7 * 86400000;
  const items = new Map(), people = new Set();
  for (const r of rows) {
    const v = bySku.get(r.sku);
    if (!v) continue; // only items still in the shop's own catalogue
    const it = items.get(r.sku) || { sku: r.sku, retailerSku: v.retailerSku || null, product: v.product, variant: v.variant, priceMinor: v.priceMinor, currency: v.currency || "GBP", imageUrl: v.imageUrl || null, watchers: 0, viaShopFollow: 0, newThisWeek: 0 };
    if (r.via === "item") { it.watchers++; people.add(r.shopper_id); } else it.viaShopFollow++;
    if (r.via === "item" && r.created_at >= week) it.newThisWeek++;
    items.set(r.sku, it);
  }
  const followers = (await db.prepare("SELECT COUNT(*) AS n FROM store_optins WHERE store = ?").bind(label).first()).n;
  // Busiest first; items with fewer than 3 watchers come last in name order, so their order gives nothing away.
  const big = (i) => i.watchers >= PRIVACY_MIN;
  const list = [...items.values()].filter(i => i.watchers > 0)
    .sort((a, b) => (big(b) - big(a)) || (big(a) ? b.watchers - a.watchers || b.newThisWeek - a.newThisWeek : 0) || a.product.localeCompare(b.product) || String(a.variant || "").localeCompare(String(b.variant || "")))
    .map(i => ({ ...i, watchers: shown(i.watchers), watchersText: shownText(i.watchers), viaShopFollow: shown(i.viaShopFollow), newThisWeek: shown(i.newThisWeek) }));
  const notUk = variants.length ? null : await otherCurrency(db, shop);
  return { store: label, platform: shop.provider === "shopify" ? "shopify" : "square", currency: "GBP", generatedAt: new Date(now).toISOString(), privacyMinimum: PRIVACY_MIN,
    followers: shown(followers), followersText: shownText(followers), shoppersWatchingItems: shown(people.size), shoppersWatchingItemsText: shownText(people.size),
    itemsInCatalogue: variants.length, watchedItems: list, ...(notUk ? { notUkCurrency: notUk } : {}) };
}

async function listOffers(db, shop, now) {
  return ((await db.prepare(`SELECT id, sku, product, variant, offer_minor AS offerMinor, was_minor AS wasMinor, note, starts_at AS startsAt, ends_at AS endsAt, shoppers, devices
      FROM retailer_offers WHERE provider = ? AND shop_ref = ? ORDER BY starts_at DESC LIMIT 50`).bind(shop.provider, shop.shop_ref).all()).results || [])
    .map(o => ({ ...o, shoppers: shown(o.shoppers), shoppersText: shownText(o.shoppers), devices: undefined, active: o.endsAt > now }));
}

async function sendOffer(env, shop, body, o) {
  const db = env.RELAY_DB, now = o.now;
  const sku = body && body.sku, offer = body && body.offerMinor, hours = body && body.hours === undefined ? 48 : body && body.hours;
  if (typeof sku !== "string" || !SKU.test(sku)) return [400, { error: "bad_item" }];
  if (!Number.isInteger(offer) || offer < 1) return [400, { error: "bad_price" }];
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) return [400, { error: "bad_duration" }];
  const v = (await shopVariants(db, shop)).find(x => x.sku === sku);
  if (!v) return [404, { error: "not_your_item" }];
  if (!Number.isInteger(v.priceMinor) || offer >= v.priceMinor) return [400, { error: "offer_must_be_lower", priceMinor: v.priceMinor }];
  const live = await db.prepare("SELECT id FROM retailer_offers WHERE provider = ? AND shop_ref = ? AND sku = ? AND ends_at > ?").bind(shop.provider, shop.shop_ref, sku, now).first();
  if (live) return [409, { error: "offer_already_running" }];
  const today = (await db.prepare("SELECT COUNT(*) AS n FROM retailer_offers WHERE provider = ? AND shop_ref = ? AND starts_at > ?").bind(shop.provider, shop.shop_ref, now - 86400000).first()).n;
  if (today >= OFFERS_PER_DAY) return [429, { error: "too_many_offers_today" }];
  const note = clean(body.note, 80);
  const ends = now + hours * 3600000;
  // Everyone watching this item, whether they watch it on its own or follow the whole shop.
  const shoppers = ((await db.prepare("SELECT DISTINCT shopper_id FROM price_watches WHERE sku = ? AND store = ?").bind(sku, shop.store_label).all()).results || []).map(r => r.shopper_id);
  const endText = new Date(ends).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  const message = {
    title: "Offer from " + shop.store_label,
    body: v.product + (v.variant ? " · " + v.variant : "") + ": " + priceText(offer, v.currency) + " for Relay watchers (usually " + priceText(v.priceMinor, v.currency) + "). Ends " + endText + "." + (note ? " " + note : ""),
    url: "./"
  };
  let devices = 0;
  for (const id of shoppers) {
    for (const s of await subsOf(db, id)) { try { const r = await sendPush(env, s, message, o); if (r.ok) devices++; } catch { /* one device failing never stops the rest */ } }
  }
  const row = { id: crypto.randomUUID(), sku, product: v.product, variant: v.variant || null, offerMinor: offer, wasMinor: v.priceMinor, note: note || null, startsAt: now, endsAt: ends,
    shoppers: shown(shoppers.length), shoppersText: shownText(shoppers.length), active: true };
  await db.prepare(`INSERT INTO retailer_offers (id, provider, shop_ref, store_label, sku, product, variant, offer_minor, was_minor, note, starts_at, ends_at, shoppers, devices)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(row.id, shop.provider, shop.shop_ref, shop.store_label, sku, row.product, row.variant, offer, v.priceMinor, row.note, now, ends, shoppers.length, devices).run();
  // The exact counts stay inside Relay; the shop sees them only from 3 upwards.
  return [200, { offer: row }];
}

// Routes under /relay/retailer/ — every one needs the shop's key.
export async function handleRetailerRoute(request, env, url, cors = {}, o = {}) {
  const path = url.pathname;
  if (!path.startsWith("/relay/retailer/")) return null;
  const now = o.now || Date.now();
  if (!env.RELAY_DB || !env.AUTH_SECRET) return json({ error: "not_available" }, 503, cors);
  await ensureRetailerTables(env.RELAY_DB);
  const shop = await shopFromRequest(request, env, now);
  if (!shop) return json({ error: "not_signed_in" }, 401, cors);
  if (path === "/relay/retailer/demand" && request.method === "GET") return json(await shopDemand(env, shop, now), 200, cors);
  if (path === "/relay/retailer/offers" && request.method === "GET") return json({ store: shop.store_label, offers: await listOffers(env.RELAY_DB, shop, now) }, 200, cors);
  if (path === "/relay/retailer/offers" && request.method === "POST") {
    const text = await request.text();
    let body = null; try { body = text.length < 2000 ? JSON.parse(text) : null; } catch { body = null; }
    const [status, out] = await sendOffer(env, shop, body, { ...o, now });
    return json(out, status, cors);
  }
  return json({ error: "not_found" }, 404, cors);
}
