import { getShopifyStores } from "./shopify.js";
// Shopify retailer-authorised, signature-verified orders/paid ingestion.
// Private retailer order and line item IDs stay in D1. Nothing here exposes consumer purchases.
const MAX_BYTES = 256 * 1024;
const DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
function asMoney(value) {
  if (typeof value !== "number" && typeof value !== "string") throw Error("Invalid money amount");
  const raw = String(value);
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) throw Error("Invalid money amount");
  const [p, c = ""] = raw.split(".");
  const result = Number(p) * 100 + Number(c.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw Error("Money out of range");
  return result;
}
function compare(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function validSignature(raw, encoded, secret) {
  try {
    if (!encoded || encoded.length > 120) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
    const supplied = Uint8Array.from(atob(encoded), x => x.charCodeAt(0));
    return compare(signed, supplied);
  } catch { return false; }
}
export async function receiveShopifyWebhook(request, env) {
  const shop = String(request.headers.get("x-shopify-shop-domain") || "").toLowerCase().trim();
  if (!env.RELAY_DB)
    return Response.json({ error: "not_configured" }, { status: 503 });
  const store = DOMAIN.test(shop) ? getShopifyStores(env).find(s => s.domain === shop) : null;
  if (!store || !store.webhookSecret)
    return new Response("Unauthorized store", { status: 403 });
  const topic = String(request.headers.get("x-shopify-topic") || "").toLowerCase();
  const deliveryId = String(request.headers.get("x-shopify-webhook-id") || "");
  if (!deliveryId || deliveryId.length > 128) return new Response("Missing delivery ID", { status: 400 });
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response("Payload too large", { status: 413 });
  if (!await validSignature(body, request.headers.get("x-shopify-hmac-sha256"), store.webhookSecret))
    return new Response("Invalid signature", { status: 401 });
  if (topic !== "orders/paid") return Response.json({ received: true, ignored: true });
  let event;
  try { event = JSON.parse(new TextDecoder().decode(body)); }
  catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!event || !event.id || !event.created_at || !Array.isArray(event.line_items))
    return new Response("Invalid order payload", { status: 400 });
  if (String(event.currency || "").toUpperCase() !== "GBP")
    return Response.json({ received: false, error: "GBP_only_MVP" }, { status: 422 });
  if (event.line_items.length > 100) return new Response("Too many lines", { status: 413 });
  const externalId = String(event.id), connection = "shopify:" + shop;
  const orderId = connection + ":order:" + externalId;
  let statements;
  try {
    const amount = asMoney(event.total_price);
    const lines = event.line_items.map(line => {
      const count = Number(line.quantity);
      if (!line.id || !line.title || !Number.isInteger(count) || count < 1 || count > 10000)
        throw Error("Invalid order line");
      const price = asMoney(line.price);
      return { id: String(line.id), title: String(line.title).slice(0, 300), quantity: count,
        price, productId: line.product_id == null ? null : String(line.product_id),
        variantId: line.variant_id == null ? null : String(line.variant_id) };
    });
    statements = [
      env.RELAY_DB.prepare("INSERT OR IGNORE INTO retailer_connections (id,provider,merchant_external_id) VALUES (?,?,?)")
        .bind(connection, "shopify", shop),
      env.RELAY_DB.prepare(`INSERT INTO retailer_orders
        (id,connection_id,external_order_id,external_customer_id,ordered_at,amount_minor,currency,payment_processor,status,raw_identifier_keys)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(connection_id,external_order_id) DO UPDATE SET
        ordered_at=excluded.ordered_at,amount_minor=excluded.amount_minor,currency=excluded.currency`)
        .bind(orderId, connection, externalId, event.customer?.id == null ? null : String(event.customer.id),
          String(event.processed_at || event.created_at), amount, "GBP", "shopify", "unverified", "[]"),
      ...lines.map(line => env.RELAY_DB.prepare(`INSERT INTO order_items
        (id,order_id,external_line_item_id,product_id,variant_id,title,quantity,price_minor,currency)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(order_id,external_line_item_id) DO UPDATE SET
        title=excluded.title,quantity=excluded.quantity,price_minor=excluded.price_minor`)
        .bind(orderId + ":item:" + line.id, orderId, line.id, line.productId, line.variantId,
          line.title, line.quantity, line.price, "GBP")),
      env.RELAY_DB.prepare(`INSERT OR IGNORE INTO audit_events
        (id,actor_type,actor_id,event_type,subject_type,subject_id,metadata_json)
        VALUES (?,?,?,?,?,?,?)`)
        .bind("shopify:webhook:" + shop + ":" + deliveryId, "system", "shopify_webhook",
          "shopify_paid_order_ingested", "retailer_order", orderId, JSON.stringify({ topic, shop, lines: lines.length }))
    ];
  } catch {
    return new Response("Invalid order amount or lines", { status: 400 });
  }
  try {
    await env.RELAY_DB.batch(statements);
    // Deliberately DO NOT create a verified match or expose orders to the public wallet.
    return Response.json({ received: true });
  } catch (error) {
    console.error("Shopify order ingest failed", String(error));
    return Response.json({ error: "ingest_failed" }, { status: 503 });
  }
}
