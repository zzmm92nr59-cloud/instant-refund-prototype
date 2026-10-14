// Retailer-authorised Shopify Admin API catalogue importer. Strictly read-only.
// Configure up to five independent shops with SHOPIFY_STORE_{1..5}_DOMAIN,
// _ADMIN_ACCESS_TOKEN, _CATALOGUE_PUBLIC, optional _LABEL and _WEBHOOK_SECRET.
// Legacy single-shop secrets are still supported. Never send access tokens to a browser.
const VERSION = "2026-07";
const DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
export function getShopifyStores(env) {
  const configured = [];
  const seen = new Set();
  const configs = [];
  if (env.SHOPIFY_SHOP_DOMAIN || env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    configs.push({
      domain: env.SHOPIFY_SHOP_DOMAIN, token: env.SHOPIFY_ADMIN_ACCESS_TOKEN,
      label: env.SHOPIFY_STORE_LABEL, publish: env.SHOPIFY_CATALOGUE_PUBLIC,
      webhookSecret: env.SHOPIFY_WEBHOOK_SECRET
    });
  }
  for (let n = 1; n <= 5; n++) {
    const prefix = "SHOPIFY_STORE_" + n + "_";
    if (env[prefix + "DOMAIN"] || env[prefix + "ADMIN_ACCESS_TOKEN"]) {
      configs.push({
        domain: env[prefix + "DOMAIN"], token: env[prefix + "ADMIN_ACCESS_TOKEN"],
        label: env[prefix + "LABEL"], publish: env[prefix + "CATALOGUE_PUBLIC"],
        webhookSecret: env[prefix + "WEBHOOK_SECRET"]
      });
    }
  }
  for (const raw of configs) {
    const domain = String(raw.domain || "").toLowerCase().trim();
    const token = String(raw.token || "").trim();
    // Never attempt API calls with incomplete or invalid credentials.
    if (!DOMAIN.test(domain) || !token || seen.has(domain)) continue;
    seen.add(domain);
    const label = String(raw.label || domain.replace(/\.myshopify\.com$/, "").replace(/-/g, " ")).trim().slice(0, 80);
    configured.push({
      domain, token, label, published: String(raw.publish || "").toLowerCase() === "true",
      webhookSecret: String(raw.webhookSecret || "").trim()
    });
  }
  return configured;
}
export function shopifyConfigured(env) { return getShopifyStores(env).length > 0; }
async function query(store, q, variables = {}) {
  const response = await fetch("https://" + store.domain + "/admin/api/" + VERSION + "/graphql.json", {
    method: "POST",
    headers: { "X-Shopify-Access-Token": store.token, "Content-Type": "application/json" },
    body: JSON.stringify({query:q, variables})
  });
  if (!response.ok) throw Error("Shopify API HTTP " + response.status);
  const data = await response.json();
  if (data.errors?.length) throw Error("Shopify GraphQL request failed");
  return data.data;
}
async function syncStore(env, store) {
  if (!env.RELAY_DB) throw Error("RELAY_DB missing");
  const db = env.RELAY_DB;
  const connection = "shopify:" + store.domain;
  await db.prepare("INSERT OR IGNORE INTO retailer_connections(id,provider,merchant_external_id) VALUES (?,?,?)")
    .bind(connection, "shopify", store.domain).run();
  const gql = `query RelayProducts($cursor: String) {
    shop { currencyCode }
    products(first: 30, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id title description
        variants(first: 100) { nodes { id title sku price inventoryQuantity } }
      }
    }
  }`;
  let cursor = null, pages = 0, products = 0, variants = 0, inventorySnapshots = 0, more = false;
  do {
    const data = await query(store, gql, {cursor});
    for (const item of data.products?.nodes || []) {
      // Shopify GIDs are only guaranteed unique within a shop. Namespace by domain.
      const id = connection + ":item:" + item.id;
      await db.prepare(`INSERT INTO retailer_catalog_items
        (id,provider,external_item_id,title,description) VALUES (?,?,?,?,?)
        ON CONFLICT(provider,external_item_id) DO UPDATE SET
        title=excluded.title,description=excluded.description,updated_at=CURRENT_TIMESTAMP`)
        .bind(id, connection, item.id, item.title, item.description || null).run();
      products++;
      for (const v of item.variants?.nodes || []) {
        const vid = connection + ":variant:" + v.id;
        const price = Math.round(Number(v.price) * 100);
        await db.prepare(`INSERT INTO retailer_catalog_variants
          (id,item_id,external_variant_id,title,sku,price_minor,currency)
          VALUES (?,?,?,?,?,?,?) ON CONFLICT(item_id,external_variant_id) DO UPDATE SET
          title=excluded.title,sku=excluded.sku,price_minor=excluded.price_minor,
          currency=excluded.currency,updated_at=CURRENT_TIMESTAMP`)
          .bind(vid, id, v.id, v.title, v.sku || null,
            Number.isSafeInteger(price) ? price : null, data.shop?.currencyCode || "GBP").run();
        variants++;
        const qty = v.inventoryQuantity == null ? null : Number(v.inventoryQuantity);
        await db.prepare(`INSERT INTO retailer_inventory_snapshots
          (variant_id,connection_id,quantity,inventory_state) VALUES (?,?,?,?)
          ON CONFLICT(variant_id,connection_id) DO UPDATE SET
          quantity=excluded.quantity,inventory_state=excluded.inventory_state,
          observed_at=CURRENT_TIMESTAMP`)
          .bind(vid, connection, qty !== null && Number.isFinite(qty) ? qty : null, "AGGREGATE").run();
        inventorySnapshots++;
      }
    }
    pages++;
    more = Boolean(data.products?.pageInfo?.hasNextPage);
    cursor = data.products?.pageInfo?.endCursor || null;
  } while (more && cursor && pages < 10);
  return {shop:store.domain, products, variants, inventorySnapshots, pages, morePages:more,
    inventoryScope:"shop_aggregate"};
}
export async function syncShopifyCatalogues(env) {
  const results = [];
  for (const store of getShopifyStores(env)) {
    try { results.push({success:true, ...await syncStore(env, store)}); }
    catch (err) {
      // One retailer outage must not stop imports from other connected shops.
      console.error("Shopify catalogue sync failed for " + store.domain + ": " + String(err.message || err));
      results.push({success:false, shop:store.domain, error:"sync_failed"});
    }
  }
  return {configuredStores:results.length, results};
}
// Backwards compatibility with earlier single-shop callers.
export async function syncShopifyCatalogue(env) { return syncShopifyCatalogues(env); }
