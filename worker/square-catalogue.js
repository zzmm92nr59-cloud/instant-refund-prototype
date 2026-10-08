import { squareRequest, listSquareLocations } from "./square-history.js";

// Catalogue snapshots are retailer-side data. Never treat stock as reserved or guaranteed.
export async function syncSquareCatalogue(env) {
  const db = env.RELAY_DB;
  if (!db) throw Error("RELAY_DB missing");
  const locations = await listSquareLocations(env);
  let cursor, pages = 0, products = 0, variants = 0;
  const variantIds = [];
  do {
    const data = await squareRequest(env, "/v2/catalog/list?types=ITEM&limit=100" +
      (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
    for (const item of data.objects || []) {
      if (item.type !== "ITEM" || !item.id) continue;
      const productId = "square:sandbox:item:" + item.id;
      await db.prepare(`INSERT INTO retailer_catalog_items
        (id,provider,external_item_id,title,description)
        VALUES (?,?,?,?,?) ON CONFLICT(provider,external_item_id) DO UPDATE SET
        title=excluded.title,description=excluded.description,updated_at=CURRENT_TIMESTAMP`)
        .bind(productId, "square_sandbox", item.id, item.item_data?.name || "Unnamed product",
          item.item_data?.description || null).run();
      products++;
      for (const variant of item.item_data?.variations || []) {
        if (!variant.id) continue;
        const id = "square:sandbox:variant:" + variant.id;
        await db.prepare(`INSERT INTO retailer_catalog_variants
          (id,item_id,external_variant_id,title,sku,price_minor,currency)
          VALUES (?,?,?,?,?,?,?) ON CONFLICT(item_id,external_variant_id) DO UPDATE SET
          title=excluded.title,sku=excluded.sku,price_minor=excluded.price_minor,
          currency=excluded.currency,updated_at=CURRENT_TIMESTAMP`)
          .bind(id, productId, variant.id, variant.item_variation_data?.name || "Default",
            variant.item_variation_data?.sku || null,
            variant.item_variation_data?.price_money?.amount ?? null,
            variant.item_variation_data?.price_money?.currency || null).run();
        variants++; variantIds.push(variant.id);
      }
    }
    cursor = data.cursor || null;
    pages++;
  } while (cursor && pages < 10);
  let inventoryCounts = 0;
  for (let start = 0; start < variantIds.length; start += 100) {
    const batch = variantIds.slice(start, start + 100);
    const data = await squareRequest(env, "/v2/inventory/counts/batch-retrieve", {
      method: "POST", body: JSON.stringify({
        catalog_object_ids: batch, location_ids: locations.map(l => l.id)
      })
    });
    for (const count of data.counts || []) {
      if (!count.catalog_object_id || !count.location_id) continue;
      const quantity = Number(count.quantity);
      const state = count.state || "UNKNOWN";
      await db.prepare(`INSERT INTO retailer_inventory_snapshots
        (variant_id,connection_id,quantity,inventory_state)
        VALUES (?,?,?,?) ON CONFLICT(variant_id,connection_id) DO UPDATE SET
        quantity=excluded.quantity,inventory_state=excluded.inventory_state,
        observed_at=CURRENT_TIMESTAMP`)
        .bind("square:sandbox:variant:" + count.catalog_object_id,
          "square:sandbox:" + count.location_id,
          Number.isFinite(quantity) ? quantity : null, state).run();
      inventoryCounts++;
    }
  }
  await db.prepare(`INSERT INTO audit_events
    (id,actor_type,actor_id,event_type,subject_type,subject_id,metadata_json)
    VALUES (?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), "system", "square_catalogue", "catalogue_sync",
      "retailer_connection", "square:sandbox",
      JSON.stringify({ products, variants, inventoryCounts, pages, morePages: !!cursor })).run();
  return { products, variants, inventoryCounts, pages, morePages: !!cursor };
}
