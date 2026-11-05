// Search by photo (Discover): a shopper picks a screenshot or takes a picture, and Relay finds the closest items in the
// stock of the shops on Relay.
//
// How: the picture goes to Claude (an AI made by Anthropic) once, with the list of products shops on Relay have (public
// product details only: name, shop, price, and the size or colour when there's only one). Claude says what the product in the picture is and which items
// on the list are the closest, best first. Relay shows those.
// Kept: nothing of the picture or what Claude said. Only that a search happened (shopper and time), for the daily limits,
// deleted after 2 days. Claude is told to look only at the product, never to describe or identify people, and to ignore
// personal details a screenshot may show. Anthropic doesn't train its AI on what Relay sends (its commercial terms).
// The app shrinks the picture first, which also drops its hidden details (such as where a photo was taken).
// Off until the ANTHROPIC_API_KEY secret is set; PHOTO_SEARCH = "off" switches it off.
import { shopifyShopsForDisplay } from "./shopify-connect.js";
import { ensureImageTable } from "./shopify.js";
import { aiModel } from "./ai-runner.js";
import { webShopProducts } from "./web-shops.js";

export const PHOTO_SEARCHES_PER_DAY = 30;
export const PHOTO_SEARCHES_ALL_DAY = 2000;
const MAX_CANDIDATES = 800;
const MAX_RESULTS = 12;
const DAY = 864e5;
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
export const photoSearchAvailable = (env) => Boolean(env && env.ANTHROPIC_API_KEY) && String(env.PHOTO_SEARCH || "").toLowerCase() !== "off";
export const PHOTO_SEARCH_SQL = "CREATE TABLE IF NOT EXISTS photo_search_uses (shopper_id TEXT NOT NULL, created_at INTEGER NOT NULL)";
// A picture as the app sends it: a JPEG, PNG or WebP data address, at most about 1.2 MB.
const IMAGE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
export const MAX_IMAGE_CHARS = 1_700_000;

export const PHOTO_SYSTEM = `You help Relay, a UK shopping app, find products. The shopper sends a photo or a screenshot of something they'd like, and a numbered list of items that shops on Relay sell.
Look only at the main product for sale in the picture. Never describe or identify people, and ignore names, addresses, messages, prices and other personal details a screenshot may show.
Answer with JSON only, nothing else:
{"found": true or false, "item": "what the product is, in a few plain words, e.g. white leather trainers", "matches": [list numbers of the closest items, best first, at most 12]}
"found" is false when there's no product in the picture. Only list items a shopper would see as the same kind of thing (a bag for a bag, trainers for trainers); colour and style make them closer. An empty list is right when nothing is close.`;

// The products shops on Relay sell, as Discover shows them, one each: real shops only; for Relay's testing tools, test
// shops too; and the preview from shops' own websites (web-shops.js) for the testing tools or Relay's team's preview
// switch; each marked.
async function candidates(env, includeTest, now, includeWeb = includeTest) {
  const db = env.RELAY_DB;
  await ensureImageTable(db);
  const shops = await shopifyShopsForDisplay(env, { includeTest }).catch(() => []);
  const variants = [];
  for (const s of shops) {
    const sql = (picture) => `SELECT i.title AS product, v.title AS variation, v.id AS sku, v.price_minor AS priceMinor, v.currency AS currency, ${picture} AS imageUrl,
        MAX(q.quantity) AS quantity
      FROM retailer_catalog_items i JOIN retailer_catalog_variants v ON v.item_id = i.id
      LEFT JOIN retailer_item_images img ON img.item_id = i.id
      LEFT JOIN retailer_inventory_snapshots q ON q.variant_id = v.id
      WHERE i.provider = ? AND v.price_minor > 0 AND v.currency = 'GBP'
      GROUP BY i.id, v.id ORDER BY MAX(q.quantity) > 0 DESC, i.title, v.title LIMIT 120`;
    let rows;
    try { rows = (await db.prepare(sql("COALESCE(i.image_url, img.image_url)")).bind("shopify:" + s.domain).all()).results || []; }
    catch { rows = (await db.prepare(sql("img.image_url")).bind("shopify:" + s.domain).all()).results || []; }
    for (const r of rows) variants.push({ sku: r.sku, product: r.product, variation: r.variation && !/^default title$/i.test(r.variation) ? r.variation : null,
      priceMinor: r.priceMinor, imageUrl: r.imageUrl, inStock: r.quantity == null ? null : Number(r.quantity) > 0,
      storeName: s.label || s.domain.replace(/\.myshopify\.com$/, ""), ...(s.test ? { testShop: true } : {}) });
  }
  if (includeWeb) for (const p of await webShopProducts(env, now).catch(() => []))
    variants.push({ sku: p.sku, product: p.product, variation: p.variation, priceMinor: p.priceMinor, imageUrl: p.imageUrl, inStock: p.inStock,
      storeName: p.storeName, webShop: true, productUrl: p.productUrl });
  // One per product (a shop's sizes and colours of one thing): its lowest price, whether any of it can be bought, and the
  // one a tap opens (the first that can be bought).
  const byProduct = new Map();
  for (const v of variants) {
    const key = v.storeName.toLowerCase() + "|" + String(v.product).trim().toLowerCase();
    const g = byProduct.get(key);
    if (!g) { byProduct.set(key, { ...v, priceMinor: v.priceMinor, maxPriceMinor: v.priceMinor, count: 1, variations: [v.variation] }); continue; }
    g.count++; g.variations.push(v.variation);
    g.priceMinor = Math.min(g.priceMinor, v.priceMinor); g.maxPriceMinor = Math.max(g.maxPriceMinor, v.priceMinor);
    if (g.inStock !== true && v.inStock === true) { g.sku = v.sku; g.variation = v.variation; g.productUrl = v.productUrl || g.productUrl; }
    g.inStock = g.inStock === true || v.inStock === true ? true : g.inStock === null || v.inStock === null ? null : false;
    if (!g.imageUrl && v.imageUrl) g.imageUrl = v.imageUrl;
  }
  return [...byProduct.values()].slice(0, MAX_CANDIDATES).map(g => ({ sku: g.sku, product: g.product, variation: g.count === 1 ? g.variation : null,
    ...(g.count > 1 && optionWords(g.variations).length ? { options: optionWords(g.variations) } : {}),
    priceMinor: g.priceMinor, ...(g.maxPriceMinor > g.priceMinor ? { maxPriceMinor: g.maxPriceMinor } : {}), currency: "GBP",
    imageUrl: /^https:\/\/[^\s"'<>]{8,600}$/.test(String(g.imageUrl || "")) ? g.imageUrl : null, inStock: g.inStock, storeName: g.storeName,
    ...(g.testShop ? { testShop: true } : {}), ...(g.webShop ? { webShop: true, productUrl: g.productUrl } : {}) }));
}

// The colours (or materials, finishes) a product comes in, from its variants' names, without the sizes: "Navy / M" and
// "Oatmeal / L" give Navy, Oatmeal. At most 4, so a product's line stays short. Colour is often only in these names.
const SIZE_WORD = /^(?:x{0,3}s|m|x{0,3}l|\d?xl|one size|os|petite|regular|tall|long|short|small|medium|large|x-large|default title|buy|pre-?order|(?:uk|eu|us|w|l)\s?\d.*|\d.*)$/i;
function optionWords(variations) {
  const out = [];
  for (const v of variations) for (const part of String(v || "").split(/\s*[\/|,]\s*/)) {
    const p = part.trim();
    if (!p || p.length > 30 || SIZE_WORD.test(p) || /\(\s*uk/i.test(p) || out.some(x => x.toLowerCase() === p.toLowerCase())) continue;
    out.push(p);
    if (out.length >= 4) return out;
  }
  return out;
}

const money = (m) => "£" + (Number(m) / 100).toFixed(2);
const oneLine = (t, n) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

// The JSON in an answer: a ```json block if there is one, otherwise the first {...} that reads as JSON (the answer may have
// a sentence around it).
function firstJson(t) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  for (const candidate of [fenced && fenced[1], t]) {
    if (!candidate) continue;
    // A handful of tries each way is plenty for a short answer, and keeps a strange one from taking long.
    for (let start = candidate.indexOf("{"), a = 0; start >= 0 && a < 5; start = candidate.indexOf("{", start + 1), a++) {
      for (let end = candidate.lastIndexOf("}"), b = 0; end > start && b < 5; end = candidate.lastIndexOf("}", end - 1), b++) {
        try { const j = JSON.parse(candidate.slice(start, end + 1)); if (j && typeof j === "object" && !Array.isArray(j)) return j; } catch {}
      }
    }
  }
  return null;
}

// Claude's answer, checked: only list numbers that exist, each once, at most 12; the item's name in a few plain words.
export function cleanAnswer(text, count) {
  const j = firstJson(String(text || ""));
  if (!j || typeof j !== "object") return null;
  const seen = new Set(), matches = [];
  for (const n of Array.isArray(j.matches) ? j.matches : []) {
    const i = Number(n);
    if (Number.isInteger(i) && i >= 1 && i <= count && !seen.has(i)) { seen.add(i); matches.push(i); }
    if (matches.length >= MAX_RESULTS) break;
  }
  const found = j.found === true;
  return { found, item: found ? oneLine(j.item, 60) || null : null, matches: found ? matches : [] };
}

// GET /relay/my/photo-search: whether it's on. POST { image, test, web }: the search (web: the shops' websites preview).
export async function handlePhotoSearchRoute(request, env, url, cors, shopper, o = {}) {
  if (url.pathname !== "/relay/my/photo-search") return null;
  if (request.method === "GET") return json({ available: photoSearchAvailable(env), perDay: PHOTO_SEARCHES_PER_DAY }, 200, cors);
  if (request.method !== "POST") return json({ error: "not_found" }, 404, cors);
  if (!photoSearchAvailable(env)) return json({ error: "ai_off" }, 503, cors);
  const db = env.RELAY_DB, now = o.now || Date.now(), f = o.fetchImpl || ((...a) => fetch(...a));
  const body = await request.json().catch(() => null);
  const pic = IMAGE.exec(String(body && body.image || ""));
  if (!pic || body.image.length > MAX_IMAGE_CHARS) return json({ error: "image_unreadable" }, 400, cors);
  await db.prepare(PHOTO_SEARCH_SQL).run();
  await db.prepare("DELETE FROM photo_search_uses WHERE created_at < ?").bind(now - 2 * DAY).run();
  const mine = await db.prepare("SELECT COUNT(*) AS n FROM photo_search_uses WHERE shopper_id = ? AND created_at > ?").bind(shopper.id, now - DAY).first();
  if (Number(mine && mine.n) >= PHOTO_SEARCHES_PER_DAY) return json({ error: "too_many_searches" }, 429, cors);
  const all = await db.prepare("SELECT COUNT(*) AS n FROM photo_search_uses WHERE created_at > ?").bind(now - DAY).first();
  if (Number(all && all.n) >= PHOTO_SEARCHES_ALL_DAY) return json({ error: "busy" }, 503, cors);
  await db.prepare("INSERT INTO photo_search_uses (shopper_id, created_at) VALUES (?, ?)").bind(shopper.id, now).run();

  const items = await candidates(env, body.test === true, now, body.test === true || body.web === true);
  const list = items.length ? items.map((x, i) => (i + 1) + ". " + [x.product, x.variation, x.storeName, money(x.priceMinor) + (x.maxPriceMinor ? "–" + money(x.maxPriceMinor) : ""),
    x.options ? "in " + x.options.join(", ") : null, x.inStock === false ? "out of stock" : null].filter(Boolean).join(" · ")).join("\n")
    : "(No items on Relay yet.)";
  let r;
  try {
    r = await f("https://api.anthropic.com/v1/messages", { method: "POST", signal: AbortSignal.timeout(30000),
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      // Room for a model that thinks a little before it answers; the answer itself is a few dozen tokens.
      body: JSON.stringify({ model: env.PHOTO_SEARCH_MODEL || aiModel(env), max_tokens: 1024, system: PHOTO_SYSTEM, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/" + pic[1], data: pic[2] } },
        { type: "text", text: "Items shops on Relay sell:\n" + list } ] }] }) });
  } catch (e) { console.error("photo_search_failed", String(e && e.name || "error")); return json({ error: "busy" }, 503, cors); }
  if (r.status === 429 || r.status >= 500) { console.error("photo_search_busy", r.status); return json({ error: "busy" }, 503, cors); }
  // Anthropic refused: the picture itself only when it says so (a 400 about the image). No credit left, a key that doesn't
  // work and anything else mean photo search isn't available right now, never "couldn't read that picture".
  if (!r.ok) {
    const detail = String(await r.text().catch(() => "")).slice(0, 2000);
    const credit = /credit balance|billing|purchase credits/i.test(detail);
    const image = r.status === 400 && !credit && /image|media|base64/i.test(detail);
    console.error("photo_search_refused", r.status, image ? "image" : credit ? "no_credit" : "other");
    return image ? json({ error: "image_unreadable" }, 400, cors) : json({ error: "ai_off" }, 503, cors);
  }
  const answer = await r.json().catch(() => null);
  const text = answer && Array.isArray(answer.content) ? answer.content.filter(c => c && c.type === "text").map(c => c.text).join("") : "";
  const got = cleanAnswer(text, items.length);
  // Why an answer couldn't be used, for the logs: how it stopped and what it held (never the picture or the answer itself).
  if (!got) console.error("photo_search_unreadable_answer", JSON.stringify({ stop: answer && answer.stop_reason || null,
    blocks: answer && Array.isArray(answer.content) ? answer.content.map(c => c && c.type) : null, chars: text.length }));
  if (!got) return json({ error: "busy" }, 503, cors);
  return json({ found: got.found, item: got.item, results: got.matches.map(i => items[i - 1]) }, 200, cors);
}

// "Delete my account": the record of searches made (nothing else about them is kept).
export async function photoSearchDeleteStatements(db, shopperId) {
  await db.prepare(PHOTO_SEARCH_SQL).run();
  return [db.prepare("DELETE FROM photo_search_uses WHERE shopper_id = ?").bind(shopperId)];
}
