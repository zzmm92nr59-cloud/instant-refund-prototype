import { squareRequest, listSquareLocations } from "./square-history.js";
import { listSquareAccounts, ensureSquareMerchantSchema } from "./square-connect.js";

// Catalogue snapshots are retailer-side data. Never treat stock as reserved or guaranteed.
// Reads every connected Square shop (the default one plus any that approved "Connect with Square").
// One shop failing never stops the others; it only throws if every shop failed.
export async function syncSquareCatalogue(env, opts = {}) {
  const db = env.RELAY_DB;
  if (!db) throw Error("RELAY_DB missing");
  await ensureSquareMerchantSchema(db);
  let accounts = await listSquareAccounts(env);
  // opts.only: read just one connected shop (used straight after it connects).
  if (opts.only) accounts = accounts.filter(a => a.id === opts.only);
  if (!accounts.length) throw Error("Square access token missing");
  const total = { products: 0, variants: 0, inventoryCounts: 0, pages: 0, morePages: false, shops: 0, shopErrors: [] };
  let firstError = null;
  for (const account of accounts) {
    try {
      const r = await syncOneShop(env, account);
      total.products += r.products; total.variants += r.variants; total.inventoryCounts += r.inventoryCounts;
      total.pages += r.pages; total.morePages = total.morePages || r.morePages; total.shops++;
    } catch (e) {
      firstError = firstError || e;
      total.shopErrors.push({ shop: account.label, error: String(e && e.message || e).slice(0, 120) });
    }
  }
  if (!total.shops && firstError) throw firstError;
  return total;
}

async function syncOneShop(env, account) {
  const db = env.RELAY_DB, token = account.token, label = account.label;
  const locations = await listSquareLocations(env, token);
  for (const l of locations) {
    await db.prepare("INSERT OR IGNORE INTO retailer_connections (id,provider,merchant_external_id) VALUES (?,?,?)")
      .bind("square:sandbox:" + l.id, "square_sandbox", l.id).run();
  }
  let cursor, pages = 0, products = 0, variants = 0;
  const variantIds = [];
  // Pictures are separate IMAGE objects in the shop's catalogue; an item points at them by id.
  const imageUrlById = new Map(), itemImage = new Map();
  do {
    const data = await squareRequest(env, "/v2/catalog/list?types=ITEM,IMAGE&limit=100" +
      (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), { token });
    for (const item of data.objects || []) {
      if (item.type === "IMAGE" && item.id && /^https:\/\//.test(item.image_data?.url || "")) imageUrlById.set(item.id, item.image_data.url);
      if (item.type !== "ITEM" || !item.id) continue;
      if (item.item_data?.image_ids?.length) itemImage.set(item.id, item.item_data.image_ids[0]);
      const productId = "square:sandbox:item:" + item.id;
      await db.prepare(`INSERT INTO retailer_catalog_items
        (id,provider,external_item_id,title,description,store_label)
        VALUES (?,?,?,?,?,?) ON CONFLICT(provider,external_item_id) DO UPDATE SET
        title=excluded.title,description=excluded.description,store_label=excluded.store_label,updated_at=CURRENT_TIMESTAMP`)
        .bind(productId, "square_sandbox", item.id, item.item_data?.name || "Unnamed product",
          item.item_data?.description || null, label).run();
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
  // Only a picture the shop itself supplied is ever stored; items without one stay empty.
  let images = 0;
  for (const [itemId, imageId] of itemImage) {
    const url = imageUrlById.get(imageId);
    if (!url) continue;
    await db.prepare("UPDATE retailer_catalog_items SET image_url=? WHERE provider='square_sandbox' AND external_item_id=?").bind(url, itemId).run();
    images++;
  }
  let inventoryCounts = 0;
  for (let start = 0; start < variantIds.length; start += 100) {
    const batch = variantIds.slice(start, start + 100);
    const data = await squareRequest(env, "/v2/inventory/counts/batch-retrieve", {
      token, method: "POST", body: JSON.stringify({
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
      JSON.stringify({ shop: label, products, variants, images, inventoryCounts, pages, morePages: !!cursor })).run();
  return { products, variants, inventoryCounts, pages, morePages: !!cursor };
}
