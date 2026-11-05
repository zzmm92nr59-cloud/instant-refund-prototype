// Search by photo (Discover): a shopper picks a screenshot or takes a picture, and Relay finds the closest items in the
// stock of the shops on Relay.
//
// How: the picture goes to Claude (an AI made by Anthropic) once, with the list of items shops on Relay have (public
// product details only: name, size or colour, shop, price). Claude says what the product in the picture is and which items
// on the list are the closest, best first. Relay shows those.
// Kept: nothing of the picture or what Claude said. Only that a search happened (shopper and time), for the daily limits,
// deleted after 2 days. Claude is told to look only at the product, never to describe or identify people, and to ignore
// personal details a screenshot may show. Anthropic doesn't train its AI on what Relay sends (its commercial terms).
// The app shrinks the picture first, which also drops its hidden details (such as where a photo was taken).
// Off until the ANTHROPIC_API_KEY secret is set; PHOTO_SEARCH = "off" switches it off.
import { shopifyShopsForDisplay } from "./shopify-connect.js";
import { ensureImageTable } from "./shopify.js";
import { aiModel } from "./ai-runner.js";

export const PHOTO_SEARCHES_PER_DAY = 30;
export const PHOTO_SEARCHES_ALL_DAY = 2000;
const MAX_CANDIDATES = 300;
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

// The items shops on Relay sell, as Discover shows them: real shops only, test shops too for Relay's testing tools.
async function candidates(env, includeTest) {
  const db = env.RELAY_DB;
  await ensureImageTable(db);
  const shops = await shopifyShopsForDisplay(env, { includeTest }).catch(() => []);
  const out = [];
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
    for (const r of rows) out.push({ sku: r.sku, product: r.product, variation: r.variation && !/^default title$/i.test(r.variation) ? r.variation : null,
      priceMinor: r.priceMinor, currency: "GBP", imageUrl: /^https:\/\/[^\s"'<>]{8,600}$/.test(String(r.imageUrl || "")) ? r.imageUrl : null,
      inStock: Number(r.quantity) > 0, storeName: s.label || s.domain.replace(/\.myshopify\.com$/, ""), ...(s.test ? { testShop: true } : {}) });
  }
  return out.slice(0, MAX_CANDIDATES);
}

const money = (m) => "£" + (Number(m) / 100).toFixed(2);
const oneLine = (t, n) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

// Claude's answer, checked: only list numbers that exist, each once, at most 12; the item's name in a few plain words.
export function cleanAnswer(text, count) {
  let j = null;
  const m = /\{[\s\S]*\}/.exec(String(text || ""));
  try { j = m ? JSON.parse(m[0]) : null; } catch { j = null; }
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

// GET /relay/my/photo-search: whether it's on. POST { image, test }: the search.
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

  const items = await candidates(env, body.test === true);
  const list = items.length ? items.map((x, i) => (i + 1) + ". " + [x.product, x.variation, x.storeName, money(x.priceMinor), x.inStock ? null : "out of stock"].filter(Boolean).join(" · ")).join("\n")
    : "(No items on Relay yet.)";
  let r;
  try {
    r = await f("https://api.anthropic.com/v1/messages", { method: "POST", signal: AbortSignal.timeout(30000),
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.PHOTO_SEARCH_MODEL || aiModel(env), max_tokens: 400, system: PHOTO_SYSTEM, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/" + pic[1], data: pic[2] } },
        { type: "text", text: "Items shops on Relay sell:\n" + list } ] }] }) });
  } catch { return json({ error: "busy" }, 503, cors); }
  if (r.status === 429 || r.status >= 500) return json({ error: "busy" }, 503, cors);
  if (!r.ok) { console.error("photo_search_refused", r.status); return json({ error: r.status === 400 ? "image_unreadable" : "busy" }, r.status === 400 ? 400 : 503, cors); }
  const answer = await r.json().catch(() => null);
  const text = answer && Array.isArray(answer.content) ? answer.content.filter(c => c && c.type === "text").map(c => c.text).join("") : "";
  const got = cleanAnswer(text, items.length);
  if (!got) return json({ error: "busy" }, 503, cors);
  return json({ found: got.found, item: got.item, results: got.matches.map(i => items[i - 1]) }, 200, cors);
}

// "Delete my account": the record of searches made (nothing else about them is kept).
export async function photoSearchDeleteStatements(db, shopperId) {
  await db.prepare(PHOTO_SEARCH_SQL).run();
  return [db.prepare("DELETE FROM photo_search_uses WHERE shopper_id = ?").bind(shopperId)];
}
