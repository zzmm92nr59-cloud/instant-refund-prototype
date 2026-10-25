// Awin affiliate product feed ingestion for Relay.
//
// Pulls JSONL product feeds from UK fashion & lifestyle retailers via the Awin publisher API,
// then upserts them into retailer_catalog_items / retailer_catalog_variants using provider = 'awin'.
//
// Runs inside the existing scheduled() handler once per hour (see wrangler.toml crons).
// Requires two Worker env vars:
//   AWIN_PUBLISHER_ID  – plain variable (already added: 3134429)
//   AWIN_API_TOKEN     – secret (add once Awin approves API access)

const AWIN_RETAILERS = [
  { advertiserId: "13318", label: "ASOS",         feedId: "13318-retail-en_GB",  categories: [] },
  { advertiserId: "3485",  label: "Next",          feedId: "3485-retail-en_GB",   categories: [] },
  { advertiserId: "15817", label: "M&S",           feedId: "15817-retail-en_GB",  categories: ["Clothing", "Footwear"] },
  { advertiserId: "6384",  label: "H&M",           feedId: "6384-retail-en_GB",   categories: [] },
  { advertiserId: "7157",  label: "JD Sports",     feedId: "7157-retail-en_GB",   categories: [] },
  { advertiserId: "3187",  label: "boohoo",        feedId: "3187-retail-en_GB",   categories: [] },
  { advertiserId: "15143", label: "Zara",          feedId: "15143-retail-en_GB",  categories: [] },
  { advertiserId: "4685",  label: "New Look",      feedId: "4685-retail-en_GB",   categories: [] },
  { advertiserId: "5138",  label: "River Island",  feedId: "5138-retail-en_GB",   categories: [] },
  { advertiserId: "5082",  label: "Topshop",       feedId: "5082-retail-en_GB",   categories: [] },
];

const MAX_PRODUCTS_PER_RETAILER = 2000;
const AWIN_FEED_BASE = "https://api.awin.com/publishers";

function clean(v, maxLen = 500) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, maxLen);
}

function penceFromString(s) {
  const n = parseFloat(s);
  return isFinite(n) ? Math.round(n * 100) : null;
}

function itemId(advertiserId, productId) {
  return `awin:${advertiserId}:${productId}`;
}
function variantId(advertiserId, productId, variantKey) {
  return `awin:${advertiserId}:${productId}:${variantKey}`;
}

async function* streamAwinFeed(env, retailer) {
  const { advertiserId, feedId } = retailer;
  const url = `${AWIN_FEED_BASE}/${env.AWIN_PUBLISHER_ID}/awinfeeds/download/${feedId}.jsonl`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.AWIN_API_TOKEN}`,
      Accept: "application/x-ndjson, application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Awin feed ${feedId} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { yield JSON.parse(trimmed); } catch { /* skip malformed lines */ }
    }
    if (done) {
      if (buffer.trim()) {
        try { yield JSON.parse(buffer.trim()); } catch { /* skip */ }
      }
      break;
    }
  }
}

async function ensureAwinTables(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS awin_feed_log (
      advertiser_id TEXT NOT NULL,
      run_at        INTEGER NOT NULL,
      products      INTEGER NOT NULL DEFAULT 0,
      variants      INTEGER NOT NULL DEFAULT 0,
      error         TEXT,
      PRIMARY KEY (advertiser_id, run_at)
    )
  `).run();
}

async function ingestRetailer(env, retailer) {
  const db = env.RELAY_DB;
  const { advertiserId, label, categories } = retailer;
  const catSet = new Set(categories.map(c => c.toLowerCase()));
  const now = new Date().toISOString();
  let products = 0, variants = 0;
  let currentProductId = null;
  let currentItem = null;
  const pendingVariants = [];

  async function flushProduct() {
    if (!currentItem) return;
    const dbItemId = itemId(advertiserId, currentItem.productId);
    await db.prepare(`
      INSERT INTO retailer_catalog_items
        (id, provider, external_item_id, title, description, image_url, store_label, updated_at)
      VALUES (?, 'awin', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title       = excluded.title,
        description = excluded.description,
        image_url   = COALESCE(excluded.image_url, image_url),
        store_label = excluded.store_label,
        updated_at  = excluded.updated_at
    `).bind(dbItemId, currentItem.productId, currentItem.title, currentItem.description,
            currentItem.imageUrl, currentItem.storeLabel, now).run();
    for (const v of pendingVariants) {
      const dbVarId = variantId(advertiserId, currentItem.productId, v.key);
      await db.prepare(`
        INSERT INTO retailer_catalog_variants
          (id, item_id, external_variant_id, title, sku, price_minor, currency, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'GBP', ?)
        ON CONFLICT(id) DO UPDATE SET
          title       = excluded.title,
          price_minor = excluded.price_minor,
          updated_at  = excluded.updated_at
      `).bind(dbVarId, dbItemId, v.key, v.title, v.sku || null, v.pricePence, now).run();
      variants++;
    }
    products++;
    pendingVariants.length = 0;
    currentItem = null;
    currentProductId = null;
  }

  for await (const product of streamAwinFeed(env, retailer)) {
    if (products >= MAX_PRODUCTS_PER_RETAILER) break;
    if (catSet.size > 0) {
      const cat = (product.category_name || "").toLowerCase();
      if (!catSet.has(cat)) continue;
    }
    if (product.in_stock === "0" || product.in_stock === 0) continue;
    const pid = clean(product.product_id || product.aw_product_id, 100);
    if (!pid) continue;
    if (pid !== currentProductId) {
      await flushProduct();
      currentProductId = pid;
      currentItem = {
        productId: pid,
        title: clean(product.product_name, 300),
        description: clean(product.description, 1000),
        imageUrl: clean(product.aw_image_url || product.merchant_image_url, 500),
        storeLabel: label,
      };
    }
    const colour = clean(product.colour, 80);
    const size   = clean(product.size, 80);
    const variantTitle = [colour, size].filter(Boolean).join(" / ") || clean(product.product_name, 150);
    const variantKey   = [pid, colour, size].filter(Boolean).join("|");
    pendingVariants.push({
      key: variantKey,
      title: variantTitle,
      sku: clean(product.sku || product.merchant_product_id, 100) || null,
      pricePence: penceFromString(product.search_price),
    });
  }
  await flushProduct();
  return { products, variants };
}

export async function syncAwinFeeds(env) {
  const db = env.RELAY_DB;
  if (!db) throw new Error("RELAY_DB missing");
  if (!env.AWIN_API_TOKEN) {
    console.log("syncAwinFeeds: AWIN_API_TOKEN not set — skipping");
    return { skipped: true };
  }
  await ensureAwinTables(db);
  const totals = { retailers: 0, products: 0, variants: 0, errors: [] };
  for (const retailer of AWIN_RETAILERS) {
    const runAt = Date.now();
    try {
      const r = await ingestRetailer(env, retailer);
      totals.products += r.products;
      totals.variants += r.variants;
      totals.retailers++;
      await db.prepare(
        "INSERT OR REPLACE INTO awin_feed_log (advertiser_id, run_at, products, variants) VALUES (?,?,?,?)"
      ).bind(retailer.advertiserId, runAt, r.products, r.variants).run();
      console.log(`Awin ${retailer.label}: ${r.products} products, ${r.variants} variants`);
    } catch (e) {
      const msg = String(e && e.message || e).slice(0, 300);
      totals.errors.push({ retailer: retailer.label, error: msg });
      await db.prepare(
        "INSERT OR REPLACE INTO awin_feed_log (advertiser_id, run_at, products, variants, error) VALUES (?,?,0,0,?)"
      ).bind(retailer.advertiserId, runAt, msg).run();
      console.error(`Awin ${retailer.label} failed: ${msg}`);
    }
  }
  return totals;
}
