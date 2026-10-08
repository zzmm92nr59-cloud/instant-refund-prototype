// Relay Square Sandbox historical order importer.
// Retailer-authorised data is held separately from consumer identity and is NEVER
// shown to consumers or considered ownership-verified by this importer.
const API = "https://connect.squareupsandbox.com";
const LOCATION = "L8REYQ315CEM6";
const CONNECTION = "square:sandbox:" + LOCATION;
const DAYS = 60;
const MAX_PAGES = 10;
function minor(m) { return Number.isSafeInteger(m?.amount) ? m.amount : 0; }
function stamp(s) { return typeof s === "string" && !Number.isNaN(Date.parse(s)) ? s : null; }
async function square(env, path, init = {}) {
  if (!env.SQUARE_ACCESS_TOKEN) throw Error("Square token not configured");
  const response = await fetch(API + path, {
    ...init,
    headers: { Authorization: "Bearer " + env.SQUARE_ACCESS_TOKEN,
      "Square-Version": "2026-09-16", "Content-Type": "application/json" }
  });
  const data = await response.json();
  if (!response.ok) throw Error("Square API error " + response.status + ": " +
    (data.errors?.[0]?.code || "unknown"));
  return data;
}
export async function importHistoricalSquareOrders(env) {
  if (!env.RELAY_DB) throw Error("RELAY_DB binding missing");
  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  await env.RELAY_DB.prepare(
    "INSERT OR IGNORE INTO retailer_connections (id,provider,merchant_external_id) VALUES (?,?,?)"
  ).bind(CONNECTION, "square_sandbox", LOCATION).run();
  let cursor, pages = 0, orders = 0, items = 0, skipped = 0;
  do {
    const body = {
      location_ids: [LOCATION],
      limit: 100,
      query: { filter: { date_time_filter: { created_at: { start_at: since } } },
        sort: { sort_field: "CREATED_AT", sort_order: "DESC" } },
      ...(cursor ? { cursor } : {})
    };
    const data = await square(env, "/v2/orders/search", {
      method: "POST", body: JSON.stringify(body)
    });
    for (const order of data.orders || []) {
      if (!order.id || !stamp(order.created_at)) { skipped++; continue; }
      const currency = order.total_money?.currency || "GBP";
      const id = "square:sandbox:order:" + order.id;
      const amount = minor(order.total_money);
      await env.RELAY_DB.prepare(`INSERT INTO retailer_orders
        (id,connection_id,external_order_id,external_customer_id,ordered_at,amount_minor,currency,status)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(connection_id,external_order_id) DO UPDATE SET
        external_customer_id=excluded.external_customer_id,
        amount_minor=excluded.amount_minor,currency=excluded.currency,status=excluded.status`)
        .bind(id, CONNECTION, order.id, order.customer_id || null,
          order.created_at, amount, currency, order.state || "UNKNOWN").run();
      orders++;
      for (let index = 0; index < (order.line_items || []).length; index++) {
        const line = order.line_items[index];
        const quantity = Number(line.quantity);
        if (!Number.isSafeInteger(quantity) || quantity <= 0) { skipped++; continue; }
        const lineId = line.uid || String(index);
        await env.RELAY_DB.prepare(`INSERT INTO order_items
          (id,order_id,external_line_item_id,product_id,variant_id,title,quantity,price_minor,currency)
          VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT(order_id,external_line_item_id) DO UPDATE SET
          title=excluded.title,quantity=excluded.quantity,
          price_minor=excluded.price_minor,currency=excluded.currency,
          product_id=excluded.product_id,variant_id=excluded.variant_id`)
          .bind(id + ":item:" + lineId, id, lineId,
            line.catalog_object_id || null, line.variation_name || null,
            line.name || "Unnamed item", quantity, minor(line.base_price_money),
            line.base_price_money?.currency || currency).run();
        items++;
      }
    }
    cursor = data.cursor || null;
    pages++;
  } while (cursor && pages < MAX_PAGES);
  const result = { pages, orders, items, skipped, morePages: Boolean(cursor), lookbackDays: DAYS };
  await env.RELAY_DB.prepare(`INSERT INTO audit_events
    (id,actor_type,actor_id,event_type,subject_type,subject_id,metadata_json)
    VALUES (?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), "system", "square_importer", "historical_import",
      "retailer_connection", CONNECTION, JSON.stringify(result)).run();
  return result;
}
