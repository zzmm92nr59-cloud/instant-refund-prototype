// Multi-location Square Sandbox adapter. Retailer records are not consumer-owned.
// Uses the merchant-authorised Square token only. Customer emails are read only to link orders to their owners (hashed).
import { squareHost } from "./square-env.js";
import { sq, squareOrderStatements, squareItemsOfVariations, linkSquareOrderEmails } from "./square-orders.js";
const DAYS = 60;
const MAX_PAGES_PER_LOCATION = 10;
const connectionId = location => "square:sandbox:" + location;
export async function squareRequest(env, path, init = {}) {
  const { token, ...rest } = init;
  const key = token || env.SQUARE_ACCESS_TOKEN;
  if (!key) throw Error("Square access token missing");
  const response = await fetch(squareHost(env) + path, {
    ...rest, headers: { Authorization: "Bearer " + key,
      "Square-Version": "2026-09-16", "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json();
  if (!response.ok) throw Error("Square HTTP " + response.status + " " +
    (body.errors?.[0]?.code || "unknown"));
  return body;
}
export async function listSquareLocations(env, token) {
  const data = await squareRequest(env, "/v2/locations", { token });
  return (data.locations || []).filter(l => l.id && l.status === "ACTIVE")
    .map(l => ({ id: l.id, name: l.name || "Square location", currency: l.currency || "GBP" }));
}
// Reads one location's recent orders, saves them in one batch per page, then finds whose orders they are
// (by the customer's email at Square) so they show up in that shopper's wallet.
export async function importLocation(env, location, since, f) {
  const db = env.RELAY_DB, connection = connectionId(location.id);
  const itemOfVariation = await squareItemsOfVariations(db);
  let cursor, pages = 0, orders = 0, items = 0, skipped = 0;
  const imported = [];
  do {
    const body = { location_ids: [location.id], limit: 100,
      query: { filter: { date_time_filter: { created_at: { start_at: since } } },
        sort: { sort_field: "CREATED_AT", sort_order: "DESC" } },
      ...(cursor ? { cursor } : {}) };
    const data = await sq(env, "/v2/orders/search", { method: "POST", body: JSON.stringify(body) }, f);
    const statements = [];
    for (const order of data.orders || []) {
      if (!order.id || !order.created_at || Number.isNaN(Date.parse(order.created_at))) { skipped++; continue; }
      const saved = squareOrderStatements(db, order, location, itemOfVariation);
      statements.push(...saved.statements);
      imported.push({ id: saved.id, order });
      orders++;
      for (const line of order.line_items || []) { const q = Number(line.quantity); if (Number.isSafeInteger(q) && q > 0) items++; else skipped++; }
    }
    if (statements.length) await db.batch(statements);
    cursor = data.cursor || null;
    pages++;
  } while (cursor && pages < MAX_PAGES_PER_LOCATION);
  let emails = { linked: 0, calls: 0 };
  try { emails = await linkSquareOrderEmails(env, imported, f); }
  catch (e) { console.error("Square order emails failed", String(e && e.message || e).slice(0, 120)); }
  const result = { locationId: location.id, pages, orders, items, skipped, morePages: !!cursor, linked: emails.linked };
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
