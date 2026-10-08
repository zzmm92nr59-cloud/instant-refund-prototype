// Optional read-only Shopify Admin GraphQL adapter.
// Requires retailer authorisation and Worker secrets SHOPIFY_SHOP_DOMAIN,
// SHOPIFY_ADMIN_ACCESS_TOKEN. No credentials are sent to the browser.
// Shopify store inventoryQuantity is an aggregate snapshot, NOT per-location stock.
const VERSION = "2026-07";
function domain(env) {
  const d = String(env.SHOPIFY_SHOP_DOMAIN || "").toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(d)) throw Error("Invalid Shopify shop domain");
  return d;
}
export function shopifyConfigured(env) {
  return Boolean(env.SHOPIFY_ADMIN_ACCESS_TOKEN && env.SHOPIFY_SHOP_DOMAIN);
}
async function query(env, q, variables = {}) {
  const response = await fetch("https://" + domain(env) + "/admin/api/" + VERSION + "/graphql.json", {
    method: "POST", headers: { "X-Shopify-Access-Token": env.SHOPIFY_ADMIN_ACCESS_TOKEN,
      "Content-Type": "application/json" }, body: JSON.stringify({ query: q, variables })
  });
  const data = await response.json();
  if (!response.ok || data.errors?.length) throw Error("Shopify GraphQL request failed");
  return data.data;
}
export async function syncShopifyCatalogue(env) {
  if (!shopifyConfigured(env)) return { configured: false };
  if (!env.RELAY_DB) throw Error("RELAY_DB missing");
  const db = env.RELAY_DB, shop = domain(env), connection = "shopify:" + shop;
  await db.prepare("INSERT OR IGNORE INTO retailer_connections(id,provider,merchant_external_id) VALUES (?,?,?)")
    .bind(connection, "shopify", shop).run();
  const gql = `query RelayProducts($cursor: String) {
    shop { currencyCode }
    products(first: 30, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id title description
        variants(first: 100) { nodes { id title sku price inventoryQuantity } }
      }
    }
  }`;
  let cursor = null, pages = 0, products = 0, variants = 0, inventorySnapshots = 0;
  let more = false;
  do {
    const data = await query(env, gql, { cursor });
    for (const item of data.products.nodes || []) {
      const id = "shopify:item:" + item.id;
      await db.prepare(`INSERT INTO retailer_catalog_items
        (id,provider,external_item_id,title,description) VALUES (?,?,?,?,?)
        ON CONFLICT(provider,external_item_id) DO UPDATE SET
        title=excluded.title,description=excluded.description,updated_at=CURRENT_TIMESTAMP`)
        .bind(id, "shopify:" + shop, item.id, item.title, item.description || null).run();
      products++;
      for (const variant of item.variants.nodes || []) {
        const vid = "shopify:variant:" + variant.id;
        const price = Math.round(Number(variant.price) * 100);
        await db.prepare(`INSERT INTO retailer_catalog_variants
          (id,item_id,external_variant_id,title,sku,price_minor,currency)
          VALUES (?,?,?,?,?,?,?) ON CONFLICT(item_id,external_variant_id) DO UPDATE SET
          title=excluded.title,sku=excluded.sku,price_minor=excluded.price_minor,
          currency=excluded.currency,updated_at=CURRENT_TIMESTAMP`)
          .bind(vid, id, variant.id, variant.title, variant.sku || null,
            Number.isSafeInteger(price) ? price : null, data.shop?.currencyCode || "GBP").run();
        variants++;
        const qty = Number(variant.inventoryQuantity);
        await db.prepare(`INSERT INTO retailer_inventory_snapshots
          (variant_id,connection_id,quantity,inventory_state) VALUES (?,?,?,?)
          ON CONFLICT(variant_id,connection_id) DO UPDATE SET
          quantity=excluded.quantity,inventory_state=excluded.inventory_state,
          observed_at=CURRENT_TIMESTAMP`)
          .bind(vid, connection, Number.isFinite(qty) ? qty : null, "AGGREGATE").run();
        inventorySnapshots++;
      }
    }
    pages++; more = Boolean(data.products.pageInfo.hasNextPage);
    cursor = data.products.pageInfo.endCursor;
  } while (more && cursor && pages < 10);
  return { configured: true, shop, products, variants, inventorySnapshots,
    morePages: more, inventoryScope: "shop_aggregate" };
}
