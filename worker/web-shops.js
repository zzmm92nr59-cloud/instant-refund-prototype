// Shops' own websites: a preview of what a catalogue of many shops looks like in Relay (the way Lyst shows them).
//
// Many shops built on Shopify publish their products at /products.json: names, sizes and colours, prices, pictures and
// whether each one can be bought right now. Relay's server reads that list for the shops below: about once a day each, a
// couple of shops a minute, and only where the shop's robots.txt allows it. It says who it is (RelayBot, with a page that
// explains it and how to opt out: relaybot.html). Pounds only: a shop whose prices aren't in GBP is skipped.
// Nothing about shoppers is involved: these are the shops' public product pages.
//
// These shops haven't joined Relay, so ordinary shoppers never see them. Only Relay's testing tools show them
// (?testtools=1): each product with when Relay last checked the shop's website and a link to buy it there. Relay never
// buys from these shops, and "can be bought" is only what the shop's website said when Relay checked.
// For shoppers, the real thing comes from shops that connect to Relay, or their product feeds through an affiliate network
// (awin-feed.js). WEB_SHOPS = "off" (a Worker variable) stops the reading.

// UK shops on Shopify, by what they sell. A shop that isn't (or no longer is) readable is recorded with why, and skipped.
export const WEB_SHOPS = [
  // Clothes and shoes
  { domain: "finisterre.com", label: "Finisterre" },
  { domain: "lucyandyak.com", label: "Lucy & Yak" },
  { domain: "www.rixo.co.uk", label: "RIXO" },
  { domain: "www.kitristudio.com", label: "Kitri" },
  { domain: "www.passenger-clothing.com", label: "Passenger" },
  { domain: "representclo.com", label: "Represent" },
  { domain: "ninetypercent.com", label: "Ninety Percent" },
  { domain: "damsonmadder.com", label: "Damson Madder" },
  { domain: "universalworks.co.uk", label: "Universal Works" },
  { domain: "www.folkclothing.com", label: "Folk" },
  { domain: "www.sunspel.com", label: "Sunspel" },
  { domain: "hiutdenim.co.uk", label: "Hiut Denim" },
  { domain: "loungeunderwear.com", label: "Lounge" },
  { domain: "www.allbirds.co.uk", label: "Allbirds" },
  { domain: "snagtights.com", label: "Snag" },
  { domain: "sinnersattire.com", label: "Sinners Attire" },
  { domain: "vqfit.com", label: "Vanquish" },
  { domain: "www.hanon-shop.com", label: "HANON" },
  // Bags and accessories
  { domain: "www.cambridgesatchel.com", label: "The Cambridge Satchel Company" },
  { domain: "skinnydiplondon.com", label: "Skinnydip" },
  // Home
  { domain: "www.emmabridgewater.co.uk", label: "Emma Bridgewater" },
  { domain: "thebritishblanketcompany.com", label: "The British Blanket Company" },
  // Beauty
  { domain: "www.kentbrushes.com", label: "Kent Brushes" },
  // Pets
  { domain: "www.lordsandlabradors.co.uk", label: "Lords & Labradors" },
];

export const USER_AGENT = "RelayBot/1.0 (+https://zzmm92nr59-cloud.github.io/instant-refund-prototype/relaybot.html)";
export const ROBOT_TOKEN = "relaybot";
export const PRODUCTS_PER_SHOP = 24;
const VARIANTS_PER_PRODUCT = 12;
const PAGE_LIMIT = 100;
const SHOPS_PER_RUN = 2;
const DAY = 864e5;
// Products are shown for 3 days after Relay last read them; older ones are hidden, so prices are never days out of date.
export const SHOW_FOR = 3 * DAY;
const MAX_SHOWN = 3000;
const json = (body, status, cors, cache) => Response.json(body, { status, headers: { ...cors, "Cache-Control": cache || "no-store" } });
const oneLine = (t, n) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export const WEB_SHOPS_SQL = [
  "CREATE TABLE IF NOT EXISTS web_shops (domain TEXT PRIMARY KEY, label TEXT NOT NULL, origin TEXT, status TEXT NOT NULL, products INTEGER NOT NULL DEFAULT 0, items INTEGER NOT NULL DEFAULT 0, checked_at INTEGER NOT NULL, next_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS web_shop_items (id TEXT PRIMARY KEY, domain TEXT NOT NULL, product_key TEXT NOT NULL, position INTEGER NOT NULL, product TEXT NOT NULL, variation TEXT, price_minor INTEGER NOT NULL, available INTEGER, image_url TEXT NOT NULL, product_url TEXT NOT NULL, kind TEXT, checked_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS web_shop_items_domain ON web_shop_items (domain)",
];
let tablesReady = null;
export function ensureWebShopTables(db) {
  if (!tablesReady) tablesReady = db.batch(WEB_SHOPS_SQL.map(s => db.prepare(s))).catch(e => { tablesReady = null; throw e; });
  return tablesReady;
}

// ---- robots.txt (RFC 9309) ----
// Groups of user-agent lines and their allow and disallow rules. Lines before any user-agent line belong to no group.
export function parseRobots(text) {
  const groups = [];
  let cur = null, agentsOpen = false;
  for (const raw of String(text || "").slice(0, 512 * 1024).split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !agentsOpen) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      agentsOpen = true;
    } else if (key === "allow" || key === "disallow") {
      if (cur) cur.rules.push({ allow: key === "allow", path: value });
      agentsOpen = false;
    }
  }
  return groups;
}
function patternMatches(pattern, path) {
  let p = pattern, end = false;
  if (p.endsWith("$")) { end = true; p = p.slice(0, -1); }
  const re = new RegExp("^" + p.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (end ? "$" : ""));
  return re.test(path);
}
// Whether RelayBot may read this path (with its query): RelayBot's own group if the file has one, otherwise the "*" group.
// The longest matching rule wins; between an allow and a disallow of the same length, allow wins.
export function robotsAllow(groups, path, token = ROBOT_TOKEN) {
  const named = groups.filter(g => g.agents.some(a => (/^[a-z_-]+/.exec(a) || [""])[0] === token));
  const rules = (named.length ? named : groups.filter(g => g.agents.includes("*"))).flatMap(g => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path || !patternMatches(r.path, path)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}

// The same shop: its own domain, with or without www.
function sameSite(origin, domain) {
  try {
    const host = new URL(origin).hostname, bare = domain.replace(/^www\./, "");
    return new URL(origin).protocol === "https:" && (host === bare || host.endsWith("." + bare));
  } catch { return false; }
}
async function readRobots(f, origin) {
  let r;
  try { r = await f(origin + "/robots.txt", { headers: { "User-Agent": USER_AGENT, Accept: "text/plain" }, redirect: "follow", signal: AbortSignal.timeout(15000) }); }
  catch { return { reachable: false }; }
  // A server error means the rules can't be read, so nothing may be read; no robots.txt at all (4xx) means no rules.
  if (r.status >= 500) return { reachable: false };
  const finalOrigin = r.url ? new URL(r.url).origin : origin;
  if (r.status >= 400) { await r.text().catch(() => ""); return { reachable: true, groups: [], origin: finalOrigin }; }
  return { reachable: true, groups: parseRobots(await r.text()), origin: finalOrigin };
}
async function getJson(f, url) {
  let r;
  try { r = await f(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, redirect: "follow", signal: AbortSignal.timeout(20000) }); }
  catch { return { status: "unreachable" }; }
  const done = () => r.text().catch(() => "");
  if (r.status === 401 || r.status === 403 || r.status === 429) { await done(); return { status: "blocked" }; }
  if (r.status >= 500) { await done(); return { status: "unreachable" }; }
  if (!r.ok || !/json/i.test(r.headers.get("content-type") || "")) { await done(); return { status: "not_shopify" }; }
  const text = await r.text();
  if (text.length > 20_000_000) return { status: "not_shopify" };
  try { return { status: "ok", json: JSON.parse(text), origin: r.url ? new URL(r.url).origin : null }; }
  catch { return { status: "not_shopify" }; }
}

const penceOf = (s) => { const n = Number.parseFloat(String(s == null ? "" : s)); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };
// A product picture: https only, asked for at 600 pixels wide (Shopify's picture server makes it that size).
function picture(src) {
  let s = String(src || "").trim();
  if (s.startsWith("//")) s = "https:" + s;
  if (!/^https:\/\/[^\s"'<>]{8,500}$/.test(s)) return null;
  try { const u = new URL(s); u.searchParams.set("width", "600"); return u.href; } catch { return null; }
}

// A shop's newest products (up to 24) with their sizes or colours (up to 12 each). Products without a price or a picture
// are left out.
export function shopRows(shop, origin, products, now) {
  const list = (Array.isArray(products) ? products : [])
    .filter(p => p && p.id && p.handle && p.title && Array.isArray(p.variants) && p.variants.length)
    .map((p, i) => [p, i])
    .sort((a, b) => (Date.parse(b[0].published_at || b[0].created_at || "") || 0) - (Date.parse(a[0].published_at || a[0].created_at || "") || 0) || a[1] - b[1])
    .map(x => x[0]);
  const rows = [];
  let position = 0;
  for (const p of list) {
    if (position >= PRODUCTS_PER_SHOP) break;
    const lead = picture(Array.isArray(p.images) && p.images[0] && p.images[0].src);
    const variants = p.variants.filter(v => v && v.id && penceOf(v.price) > 0).slice(0, VARIANTS_PER_PRODUCT);
    if (!lead || !variants.length) continue;
    const handle = encodeURIComponent(String(p.handle).slice(0, 200));
    for (const v of variants) {
      const title = oneLine(v.title, 80);
      rows.push({ id: `web:${shop.domain}:${v.id}`, domain: shop.domain, productKey: `web:${shop.domain}:${p.id}`, position,
        product: oneLine(p.title, 140), variation: !title || /^default title$/i.test(title) ? null : title, priceMinor: penceOf(v.price),
        available: v.available === true ? 1 : v.available === false ? 0 : null, imageUrl: picture(v.featured_image && v.featured_image.src) || lead,
        productUrl: `${origin}/products/${handle}?variant=${encodeURIComponent(String(v.id))}`, kind: oneLine(p.product_type, 60) || null, checkedAt: now });
    }
    position++;
  }
  return rows;
}

// One shop: its robots.txt, then its currency and where it delivers (/meta.json), then its products (/products.json).
export async function readShop(f, shop, now) {
  let origin = "https://" + shop.domain;
  const robots = await readRobots(f, origin);
  if (!robots.reachable) return { status: "unreachable", rows: [] };
  if (robots.origin && sameSite(robots.origin, shop.domain)) origin = robots.origin;
  const listPath = "/products.json?limit=" + PAGE_LIMIT;
  if (!robotsAllow(robots.groups, listPath) || !robotsAllow(robots.groups, "/meta.json")) return { status: "robots", rows: [], origin };
  const meta = await getJson(f, origin + "/meta.json");
  if (meta.status !== "ok") return { status: meta.status, rows: [], origin };
  // The shop's currency, or (if it isn't given) its price format: "£{{amount}}" is pounds.
  const m = meta.json && typeof meta.json === "object" ? meta.json : {};
  const currency = m.currency ? String(m.currency).toUpperCase() : /£|\bGBP\b/.test(String(m.money_format || "")) ? "GBP" : "";
  if (currency !== "GBP") return { status: "not_gbp", rows: [], origin };
  const ships = m.ships_to_countries;
  if (Array.isArray(ships) && ships.length && !ships.includes("GB") && !ships.includes("*")) return { status: "no_uk_delivery", rows: [], origin };
  const list = await getJson(f, origin + listPath);
  if (list.status !== "ok") return { status: list.status, rows: [], origin };
  if (!list.json || !Array.isArray(list.json.products)) return { status: "not_shopify", rows: [], origin };
  const at = list.origin && sameSite(list.origin, shop.domain) ? list.origin : origin;
  const rows = shopRows(shop, at, list.json.products, now);
  return { status: rows.length ? "ok" : "empty", rows, products: new Set(rows.map(r => r.productKey)).size, origin: at };
}

// A run: the shops due (each about once a day), at most 2, oldest first. Called every minute by the Worker's schedule, so
// the list fills within a quarter of an hour of a deploy and then stays a day fresh.
export async function refreshWebShops(env, o = {}) {
  const db = env && env.RELAY_DB;
  if (!db) return { checked: 0 };
  if (String(env.WEB_SHOPS || "").toLowerCase() === "off") return { checked: 0, off: true };
  const now = o.now || Date.now(), f = o.fetchImpl || ((...a) => fetch(...a)), shops = o.shops || WEB_SHOPS;
  await ensureWebShopTables(db);
  const known = (await db.prepare("SELECT domain, next_at FROM web_shops").all()).results || [];
  // Shops taken off the list are forgotten, with their products.
  const listed = new Set(shops.map(s => s.domain)), gone = known.filter(k => !listed.has(k.domain));
  if (gone.length) await db.batch(gone.flatMap(k => [db.prepare("DELETE FROM web_shop_items WHERE domain = ?").bind(k.domain), db.prepare("DELETE FROM web_shops WHERE domain = ?").bind(k.domain)]));
  const nextAt = new Map(known.map(k => [k.domain, Number(k.next_at) || 0]));
  const due = shops.filter(s => (nextAt.get(s.domain) || 0) <= now).sort((a, b) => (nextAt.get(a.domain) || 0) - (nextAt.get(b.domain) || 0)).slice(0, o.max || SHOPS_PER_RUN);
  const results = [];
  for (const shop of due) {
    // Taken first, so two runs never read the same shop at once.
    const claim = await db.prepare(`INSERT INTO web_shops (domain, label, status, checked_at, next_at) VALUES (?, ?, 'checking', ?, ?)
      ON CONFLICT(domain) DO UPDATE SET label = excluded.label, next_at = excluded.next_at WHERE web_shops.next_at <= ?`)
      .bind(shop.domain, shop.label, now, now + 10 * 60e3, now).run();
    if (!claim.meta || !claim.meta.changes) continue;
    const r = await readShop(f, shop, now).catch(() => ({ status: "unreachable", rows: [] }));
    // A website that didn't answer keeps its last list (hidden once it's 3 days old) and is tried again in 6 hours.
    // Anything else replaces the list, or removes it (robots.txt now says no, prices no longer in pounds, and so on).
    const passing = r.status === "unreachable";
    const stmts = passing ? [] : [db.prepare("DELETE FROM web_shop_items WHERE domain = ?").bind(shop.domain)];
    for (let i = 0; i < r.rows.length; i += 8) {
      const part = r.rows.slice(i, i + 8);
      stmts.push(db.prepare("INSERT OR REPLACE INTO web_shop_items (id, domain, product_key, position, product, variation, price_minor, available, image_url, product_url, kind, checked_at) VALUES "
        + part.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?)").join(","))
        .bind(...part.flatMap(x => [x.id, x.domain, x.productKey, x.position, x.product, x.variation, x.priceMinor, x.available, x.imageUrl, x.productUrl, x.kind, x.checkedAt])));
    }
    const wait = r.status === "robots" ? 7 * DAY : passing || r.status === "blocked" ? DAY / 4 : DAY;
    stmts.push(passing ? db.prepare("UPDATE web_shops SET status = ?, checked_at = ?, next_at = ? WHERE domain = ?").bind(r.status, now, now + wait, shop.domain)
      : db.prepare("UPDATE web_shops SET status = ?, origin = ?, products = ?, items = ?, checked_at = ?, next_at = ? WHERE domain = ?")
        .bind(r.status, r.origin || null, r.products || 0, r.rows.length, now, now + wait, shop.domain));
    await db.batch(stmts);
    results.push({ shop: shop.label, status: r.status, products: r.products || 0 });
  }
  return { checked: results.length, results };
}

// The products, as Discover shows them: each shop's newest first, the shops taken in turn so they're mixed.
export async function webShopProducts(env, now = Date.now()) {
  const db = env.RELAY_DB;
  await ensureWebShopTables(db);
  const rows = (await db.prepare(`SELECT i.id, i.domain, i.product, i.variation, i.price_minor, i.available, i.image_url, i.product_url, i.kind, i.checked_at, s.label
      FROM web_shop_items i JOIN web_shops s ON s.domain = i.domain
      WHERE i.checked_at > ? ORDER BY i.position, s.label, i.rowid LIMIT ${MAX_SHOWN}`).bind(now - SHOW_FOR).all()).results || [];
  return rows.map(r => ({ sku: r.id, product: r.product, variation: r.variation, priceMinor: r.price_minor, currency: "GBP", imageUrl: r.image_url,
    quantity: r.available === 0 ? 0 : null, inStock: r.available === 1 ? true : r.available === 0 ? false : null,
    storeName: r.label, shopDomain: r.domain, productUrl: r.product_url, kind: r.kind, checkedAt: new Date(r.checked_at).toISOString(), webShop: true }));
}

// GET /relay/web-shops: the preview catalogue, and how each shop's website answered when Relay last read it.
export async function handleWebShopsRoute(request, env, url, cors, o = {}) {
  if (url.pathname !== "/relay/web-shops") return null;
  if (request.method !== "GET") return json({ error: "not_found" }, 404, cors);
  if (!env.RELAY_DB) return json({ error: "database_unavailable" }, 503, cors);
  const now = o.now || Date.now();
  const products = await webShopProducts(env, now);
  const shops = ((await env.RELAY_DB.prepare("SELECT label, domain, status, products, checked_at FROM web_shops ORDER BY label").all()).results || [])
    .filter(s => s.status !== "checking")
    .map(s => ({ name: s.label, domain: s.domain, status: s.status, products: s.products, checkedAt: new Date(s.checked_at).toISOString() }));
  return json({ products, shops, preview: true }, 200, cors, "public, max-age=120");
}
