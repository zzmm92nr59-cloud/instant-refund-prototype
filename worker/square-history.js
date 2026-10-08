// Multi-location Square Sandbox adapter. Retailer records are not consumer-owned.
// Uses the merchant-authorised Square token only; no customer order endpoints.
const API = "https://connect.squareupsandbox.com";
const DAYS = 60;
const MAX_PAGES_PER_LOCATION = 10;
const connectionId = location => "square:sandbox:" + location;
const minor = money => Number.isSafeInteger(money?.amount) ? money.amount : 0;
export async function squareRequest(env, path, init = {}) {
  if (!env.SQUARE_ACCESS_TOKEN) throw Error("Square access token missing");
  const response = await fetch(API + path, {
    ...init, headers: { Authorization: "Bearer " + env.SQUARE_ACCESS_TOKEN,
      "Square-Version": "2026-09-16", "Content-Type": "application/json" }
  });
  const body = await response.json();
  if (!response.ok) throw Error("Square HTTP " + response.status + " " +
    (body.errors?.[0]?.code || "unknown"));
  return body;
}
export async function listSquareLocations(env) {
  const data = await squareRequest(env, "/v2/locations");
  return (data.locations || []).filter(l => l.id && l.status === "ACTIVE")
    .map(l => ({ id: l.id, name: l.name || "Square location", currency: l.currency || "GBP" }));
}
async function importLocation(env, location, since) {
  const db = env.RELAY_DB, connection = connectionId(location.id);
  await db.prepare("INSERT OR IGNORE INTO retailer_connections (id,provider,merchant_external_id) VALUES (?,?,?)")
    .bind(connection, "square_sandbox", location.id).run();
  let cursor, pages = 0, orders = 0, items = 0, skipped = 0;
  do {
    const body = { location_ids: [location.id], limit: 100,
      query: { filter: { date_time_filter: { created_at: { start_at: since } } },
        sort: { sort_field: "CREATED_AT", sort_order: "DESC" } },
      ...(cursor ? { cursor } : {}) };
    const data = await squareRequest(env, "/v2/orders/search",
      { method: "POST", body: JSON.stringify(body) });
    for (const order of data.orders || []) {
      if (!order.id || !order.created_at || Number.isNaN(Date.parse(order.created_at))) { skipped++; continue; }
      const id = "square:sandbox:order:" + order.id;
      const currency = order.total_money?.currency || location.currency;
      await db.prepare(`INSERT INTO retailer_orders
        (id,connection_id,external_order_id,external_customer_id,ordered_at,amount_minor,currency,status)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(connection_id,external_order_id) DO UPDATE SET
        external_customer_id=excluded.external_customer_id,
        amount_minor=excluded.amount_minor,currency=excluded.currency,status=excluded.status`)
        .bind(id, connection, order.id, order.customer_id || null, order.created_at,
          minor(order.total_money), currency, order.state || "UNKNOWN").run();
      orders++;
      for (let index = 0; index < (order.line_items || []).length; index++) {
        const line = order.line_items[index], quantity = Number(line.quantity);
        if (!Number.isSafeInteger(quantity) || quantity <= 0) { skipped++; continue; }
        const lineId = line.uid || String(index);
        await db.prepare(`INSERT INTO order_items
          (id,order_id,external_line_item_id,product_id,variant_id,title,quantity,price_minor,currency)
          VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT(order_id,external_line_item_id) DO UPDATE SET
          title=excluded.title,quantity=excluded.quantity,price_minor=excluded.price_minor,
          currency=excluded.currency,product_id=excluded.product_id,variant_id=excluded.variant_id`)
          .bind(id + ":item:" + lineId, id, lineId, line.catalog_object_id || null,
            null, line.name || "Unnamed item", quantity, minor(line.base_price_money),
            line.base_price_money?.currency || currency).run();
        items++;
      }
    }
    cursor = data.cursor || null;
    pages++;
  } while (cursor && pages < MAX_PAGES_PER_LOCATION);
  const result = { locationId: location.id, pages, orders, items, skipped, morePages: !!cursor };
  await db.prepare(`INSERT INTO audit_events
    (id,actor_type,actor_id,event_type,subject_type,subject_id,metadata_json)
    VALUES (?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), "system", "square_importer", "historical_import",
      "retailer_connection", connection, JSON.stringify(result)).run();
  return result;
}
export async function importHistoricalSquareOrders(env) {
  if (!env.RELAY_DB) throw Error("RELAY_DB binding missing");
  const locations = await listSquareLocations(env);
  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  const results = [];
  for (const location of locations) {
    try { results.push({ ...await importLocation(env, location, since), success: true }); }
    catch (error) {
      results.push({ locationId: location.id, success: false, error: String(error.message).slice(0,160) });
    }
  }
  return { locations: locations.length, results, lookbackDays: DAYS };
}
