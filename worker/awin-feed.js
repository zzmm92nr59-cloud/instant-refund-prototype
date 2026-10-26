// Awin affiliate product feed ingestion for Relay.
//
// Pulls product feeds (Awin "Enhanced Feed" API, JSONL) for the UK retailers Relay has applied to,
// and upserts them into retailer_catalog_items / retailer_catalog_variants with provider = 'awin'.
//
// Runs inside the existing hourly scheduled() handler (see wrangler.toml crons).
// Requires two Worker env vars:
//   AWIN_PUBLISHER_ID  – plain variable (3134429)
//   AWIN_API_TOKEN     – secret, created in Awin under Account > API credentials
//
// Rules:
//  * A feed only downloads once the retailer has APPROVED Relay. Until then Awin answers 401/403/404;
//    that is recorded as "not_available" (not an error) and that shop is retried at most once a day.
//  * If a shop that used to work stops being available (it rejected us or we left the programme),
//    its products are removed so Relay never shows products it no longer has a feed for.
//  * Awin asks publishers for no more than 5 feed requests a minute, so one run fetches at most
//    MAX_RETAILERS_PER_RUN shops, oldest-synced first. All 10 shops are covered every few hours.
//  * Database writes go in batches so a large feed stays inside Cloudflare's per-run limits.
//
// Advertiser IDs below were read from each retailer's Awin profile page (merchant-profile/<id>) on 26 Oct 2026.

export const AWIN_RETAILERS = [
  { advertiserId: "1599",   label: "Currys",              locale: "en_GB" },
  { advertiserId: "1402",   label: "Marks & Spencer",     locale: "en_GB" },
  { advertiserId: "22735",  label: "Debenhams",           locale: "en_GB" },
  { advertiserId: "77022",  label: "adidas",              locale: "en_GB" },
  { advertiserId: "2515",   label: "Clarks",              locale: "en_GB" },
  { advertiserId: "2044",   label: "Schuh",               locale: "en_GB" },
  { advertiserId: "1946",   label: "New Look",            locale: "en_GB" },
  { advertiserId: "103217", label: "River Island",        locale: "en_GB" },
  { advertiserId: "72067",  label: "Wayfair",             locale: "en_GB" },
  { advertiserId: "2082",   label: "LOOKFANTASTIC",       locale: "en_GB" },
];

export const MAX_RETAILERS_PER_RUN = 3;
export const MAX_PRODUCTS_PER_RETAILER = 1500;
const BATCH_SIZE = 50;
const RESYNC_AFTER_MS = 6 * 60 * 60 * 1000;          // a working shop is refreshed every ~6 hours
const NOT_AVAILABLE_RETRY_MS = 24 * 60 * 60 * 1000;  // an unapproved shop is re-checked once a day
const AWIN_FEED_BASE = "https://api.awin.com/publishers";

function clean(v, maxLen = 500) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, maxLen);
}

function penceFromString(s) {
  const n = parseFloat(s);
  return isFinite(n) ? Math.round(n * 100) : null;
}

const itemId = (advertiserId, productId) => `awin:${advertiserId}:${productId}`;
const variantId = (advertiserId, productId, key) => `awin:${advertiserId}:${productId}:${key}`;

export class FeedNotAvailable extends Error {
  constructor(status) { super(`not_available (HTTP ${status})`); this.status = status; }
}

export function feedUrl(publisherId, retailer) {
  return `${AWIN_FEED_BASE}/${publisherId}/awinfeeds/download/${retailer.advertiserId}-retail-${retailer.locale}.jsonl`;
}

async function* streamAwinFeed(env, retailer, fetchImpl) {
  const res = await fetchImpl(feedUrl(env.AWIN_PUBLISHER_ID, retailer), {
    headers: { Authorization: `Bearer ${env.AWIN_API_TOKEN}`, Accept: "application/x-ndjson, application/json" },
  });
  // 401/403/404 = no access to this feed (not approved yet, rejected, left, or no feed in this locale).
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    await res.text().catch(() => "");
    throw new FeedNotAvailable(res.status);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (line) => {
    const t = line.trim();
    if (!t) return null;
    let obj;
    try { obj = JSON.parse(t); } catch { return null; }
    // Awin can't change the status once streaming has started, so a failure arrives as a final
    // {"error":500,"message":"..."} line. Treat that as a failed download, not as a product.
    if (obj && obj.error !== undefined && obj.message !== undefined && !obj.product_name) {
      throw new Error(`feed stopped part-way: ${String(obj.message).slice(0, 150)}`);
    }
    return obj;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = done ? "" : lines.pop();
      for (const line of lines) { const o = parse(line); if (o) yield o; }
      if (done) break;
    }
  } finally {
    // Stops the download if we break early (product cap reached).
    reader.cancel().catch(() => {});
  }
}

async function ensureAwinTables(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS awin_feed_log (
      advertiser_id TEXT NOT NULL,
      run_at        INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'ok',
      products      INTEGER NOT NULL DEFAULT 0,
      variants      INTEGER NOT NULL DEFAULT 0,
      error         TEXT,
      PRIMARY KEY (advertiser_id, run_at)
    )
  `).run();
}

async function runBatches(db, statements) {
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_SIZE));
  }
}

async function removeRetailerProducts(db, advertiserId) {
  const like = `awin:${advertiserId}:%`;
  const r = await db.prepare("SELECT COUNT(*) AS n FROM retailer_catalog_items WHERE id LIKE ?").bind(like).first();
  if (!r || !r.n) return 0;
  await db.batch([
    db.prepare("DELETE FROM retailer_catalog_variants WHERE item_id LIKE ?").bind(like),
    db.prepare("DELETE FROM retailer_catalog_items WHERE id LIKE ?").bind(like),
  ]);
  return r.n;
}

async function ingestRetailer(env, retailer, fetchImpl) {
  const db = env.RELAY_DB;
  const { advertiserId, label } = retailer;
  const now = new Date().toISOString();
  const itemSql = db.prepare(`
    INSERT INTO retailer_catalog_items
      (id, provider, external_item_id, title, description, image_url, store_label, updated_at)
    VALUES (?, 'awin', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, description = excluded.description,
      image_url = COALESCE(excluded.image_url, image_url),
      store_label = excluded.store_label, updated_at = excluded.updated_at`);
  const variantSql = db.prepare(`
    INSERT INTO retailer_catalog_variants
      (id, item_id, external_variant_id, title, sku, price_minor, currency, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'GBP', ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, price_minor = excluded.price_minor, updated_at = excluded.updated_at`);

  let products = 0, variants = 0;
  let pending = [];
  const seenVariants = new Set();
  let current = null;

  const flush = async (force) => {
    if (pending.length >= BATCH_SIZE * 4 || (force && pending.length)) {
      await runBatches(db, pending);
      pending = [];
    }
  };
  const closeProduct = () => {
    if (!current) return;
    const dbItemId = itemId(advertiserId, current.productId);
    pending.push(itemSql.bind(dbItemId, current.productId, current.title || "(untitled)", current.description,
      current.imageUrl || null, label, now));
    for (const v of current.variants) {
      pending.push(variantSql.bind(variantId(advertiserId, current.productId, v.key), dbItemId, v.key, v.title,
        v.sku, v.pricePence, now));
      variants++;
    }
    products++;
    current = null;
  };

  for await (const p of streamAwinFeed(env, retailer, fetchImpl)) {
    if (p.in_stock === "0" || p.in_stock === 0 || p.in_stock === false) continue;
    const currency = clean(p.currency, 5).toUpperCase();
    if (currency && currency !== "GBP") continue; // Relay is UK / pounds only
    const pid = clean(String(p.product_id ?? p.aw_product_id ?? ""), 100);
    if (!pid) continue;
    if (!current || current.productId !== pid) {
      closeProduct();
      await flush(false);
      if (products >= MAX_PRODUCTS_PER_RETAILER) break;
      current = {
        productId: pid,
        title: clean(p.product_name, 300),
        description: clean(p.description, 1000),
        imageUrl: clean(p.aw_image_url || p.merchant_image_url, 500),
        variants: [],
      };
    }
    const colour = clean(p.colour, 80), size = clean(p.size, 80);
    const key = [pid, colour, size].filter(Boolean).join("|");
    if (seenVariants.has(key)) continue;
    seenVariants.add(key);
    current.variants.push({
      key,
      title: [colour, size].filter(Boolean).join(" / ") || clean(p.product_name, 150) || "Standard",
      sku: clean(String(p.sku ?? p.merchant_product_id ?? ""), 100) || null,
      pricePence: penceFromString(p.search_price ?? p.store_price),
    });
  }
  closeProduct();
  await flush(true);
  return { products, variants };
}

// Picks which shops to fetch this run: never-tried first, then the longest-waiting ones that are due.
export async function pickRetailers(db, now = Date.now(), retailers = AWIN_RETAILERS, limit = MAX_RETAILERS_PER_RUN) {
  const { results } = await db.prepare(`
    SELECT l.advertiser_id, l.run_at, l.status FROM awin_feed_log l
    JOIN (SELECT advertiser_id, MAX(run_at) AS m FROM awin_feed_log GROUP BY advertiser_id) x
      ON x.advertiser_id = l.advertiser_id AND x.m = l.run_at`).all();
  const last = new Map((results || []).map(r => [String(r.advertiser_id), r]));
  return retailers
    .map(r => ({ r, l: last.get(r.advertiserId) }))
    .filter(({ l }) => !l || now - l.run_at >= (l.status === "not_available" ? NOT_AVAILABLE_RETRY_MS : RESYNC_AFTER_MS))
    .sort((a, b) => (a.l ? a.l.run_at : 0) - (b.l ? b.l.run_at : 0))
    .slice(0, limit)
    .map(x => x.r);
}

export async function syncAwinFeeds(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const db = env.RELAY_DB;
  if (!db) throw new Error("RELAY_DB missing");
  if (!env.AWIN_API_TOKEN || !env.AWIN_PUBLISHER_ID) {
    console.log("syncAwinFeeds: AWIN_API_TOKEN or AWIN_PUBLISHER_ID not set — skipping");
    return { skipped: true };
  }
  await ensureAwinTables(db);
  const totals = { checked: [], products: 0, variants: 0, notAvailable: [], errors: [], removed: 0 };
  for (const retailer of await pickRetailers(db, now)) {
    const runAt = now;
    totals.checked.push(retailer.label);
    try {
      const r = await ingestRetailer(env, retailer, fetchImpl);
      totals.products += r.products;
      totals.variants += r.variants;
      await db.prepare("INSERT OR REPLACE INTO awin_feed_log (advertiser_id, run_at, status, products, variants) VALUES (?,?,'ok',?,?)")
        .bind(retailer.advertiserId, runAt, r.products, r.variants).run();
      console.log(`Awin ${retailer.label}: ${r.products} products, ${r.variants} variants`);
    } catch (e) {
      const msg = String(e && e.message || e).slice(0, 300);
      if (e instanceof FeedNotAvailable) {
        totals.notAvailable.push(retailer.label);
        totals.removed += await removeRetailerProducts(db, retailer.advertiserId);
        await db.prepare("INSERT OR REPLACE INTO awin_feed_log (advertiser_id, run_at, status, error) VALUES (?,?,'not_available',?)")
          .bind(retailer.advertiserId, runAt, msg).run();
        console.log(`Awin ${retailer.label}: feed not available yet (${msg})`);
      } else {
        totals.errors.push({ retailer: retailer.label, error: msg });
        await db.prepare("INSERT OR REPLACE INTO awin_feed_log (advertiser_id, run_at, status, error) VALUES (?,?,'error',?)")
          .bind(retailer.advertiserId, runAt, msg).run();
        console.error(`Awin ${retailer.label} failed: ${msg}`);
      }
    }
  }
  return totals;
}
