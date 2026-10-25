import { getShopifyStores } from "./shopify.js";
import { normaliseEmail, emailHash, ensureAuthTables } from "./auth.js";
import { forgetShopifyShop, removeShopifyItems } from "./shopify-connect.js";
// Shopify webhooks, every one checked against Shopify's signature before anything happens.
// - orders/paid (shops set up in the server settings only): private order ingestion. Nothing here exposes consumer purchases.
// - products/create|update|delete: a shop changed its products, so Relay reads that shop again at once (and checks price alerts).
// - app/uninstalled: the shop removed Relay, so its tokens, dashboard keys and products are deleted.
// - customers/data_request, customers/redact, shop/redact: Shopify's required privacy requests.
// Shopify signs webhooks for Relay's app with the app's secret; a shop set up in the server settings may have its own secret.
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
const PRODUCT_TOPICS = new Set(["products/create", "products/update", "products/delete"]);
const PRIVACY_TOPICS = new Set(["customers/data_request", "customers/redact", "shop/redact"]);
async function audit(env, type, shop, deliveryId, meta) {
  try {
    await env.RELAY_DB.prepare(`INSERT OR IGNORE INTO audit_events (id,actor_type,actor_id,event_type,subject_type,subject_id,metadata_json) VALUES (?,?,?,?,?,?,?)`)
      .bind("shopify:webhook:" + shop + ":" + deliveryId, "system", "shopify_webhook", type, "shopify_store", shop, JSON.stringify(meta)).run();
  } catch { /* the record is a nice-to-have */ }
}
async function deleteOrders(db, connection, customerId) {
  const ids = ((await db.prepare("SELECT id FROM retailer_orders WHERE connection_id = ?" + (customerId ? " AND external_customer_id = ?" : ""))
    .bind(...(customerId ? [connection, customerId] : [connection])).all()).results || []).map(r => r.id);
  let n = 0;
  for (const id of ids) {
    try { await db.prepare("DELETE FROM retailer_order_emails WHERE order_id = ?").bind(id).run(); } catch { /* table not created yet */ }
    try {
      await db.prepare("DELETE FROM order_items WHERE order_id = ?").bind(id).run();
      await db.prepare("DELETE FROM retailer_orders WHERE id = ?").bind(id).run();
      n++;
    } catch { /* an order already matched to a shopper's purchase is kept; its email link above is always removed */ }
  }
  return n;
}

// o.onCatalogueChange(shop): called when a shop's products changed, to read that shop again in the background.
export async function receiveShopifyWebhook(request, env, o = {}) {
  const shop = String(request.headers.get("x-shopify-shop-domain") || "").toLowerCase().trim();
  if (!env.RELAY_DB)
    return Response.json({ error: "not_configured" }, { status: 503 });
  if (!DOMAIN.test(shop)) return new Response("Unauthorized store", { status: 403 });
  const store = getShopifyStores(env).find(s => s.domain === shop) || null;
  const secrets = [...new Set([store && store.webhookSecret, env.SHOPIFY_CLIENT_SECRET].filter(Boolean))];
  if (!secrets.length)
    return new Response("Unauthorized store", { status: 403 });
  const topic = String(request.headers.get("x-shopify-topic") || "").toLowerCase();
  const deliveryId = String(request.headers.get("x-shopify-webhook-id") || "");
  if (!deliveryId || deliveryId.length > 128) return new Response("Missing delivery ID", { status: 400 });
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response("Payload too large", { status: 413 });
  let signed = false;
  for (const secret of secrets) if (await validSignature(body, request.headers.get("x-shopify-hmac-sha256"), secret)) { signed = true; break; }
  if (!signed) return new Response("Invalid signature", { status: 401 });
  let payload = null;
  try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { payload = null; }
  const db = env.RELAY_DB, connection = "shopify:" + shop;

  if (topic === "app/uninstalled") {
    await forgetShopifyShop(env, shop);
    await audit(env, "shopify_app_uninstalled", shop, deliveryId, { topic });
    return Response.json({ received: true });
  }
  if (PRODUCT_TOPICS.has(topic)) {
    if (topic === "products/delete") {
      const id = payload && (payload.admin_graphql_api_id || (payload.id != null ? "gid://shopify/Product/" + payload.id : null));
      const removed = id && /^gid:\/\/shopify\/Product\/\d{1,20}$/.test(String(id)) ? await removeShopifyItems(db, connection, String(id)) : 0;
      return Response.json({ received: true, removed });
    }
    if (typeof o.onCatalogueChange === "function") { try { o.onCatalogueChange(shop); } catch { /* the hourly read still catches up */ } }
    return Response.json({ received: true });
  }
  if (PRIVACY_TOPICS.has(topic)) {
    // Relay never reads Shopify customers for shops that connected themselves; orders exist only for server-configured shops.
    let deleted = 0;
    if (topic === "customers/redact" && payload && payload.customer && payload.customer.id != null) deleted = await deleteOrders(db, connection, String(payload.customer.id));
    if (topic === "shop/redact") { await forgetShopifyShop(env, shop, { everything: true }); deleted = await deleteOrders(db, connection, null); }
    await audit(env, "shopify_privacy_request", shop, deliveryId, { topic, deleted });
    return Response.json({ received: true });
  }
  if (topic !== "orders/paid" || !store) return Response.json({ received: true, ignored: true });
  let event;
  try { event = JSON.parse(new TextDecoder().decode(body)); }
  catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!event || !event.id || !event.created_at || !Array.isArray(event.line_items))
    return new Response("Invalid order payload", { status: 400 });
  if (String(event.currency || "").toUpperCase() !== "GBP")
    return Response.json({ received: false, error: "GBP_only_MVP" }, { status: 422 });
  if (event.line_items.length > 100) return new Response("Too many lines", { status: 413 });
  const externalId = String(event.id);
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
    // Ownership link: only a keyed hash of the order email is kept (never the address itself),
    // and only when sign-in is configured. Matched later against a shopper's verified email.
    const orderEmail = normaliseEmail(event.email || event.contact_email || (event.customer && event.customer.email));
    if (orderEmail && env.AUTH_SECRET && String(env.AUTH_SECRET).length >= 16) {
      await ensureAuthTables(env.RELAY_DB);
      statements.push(env.RELAY_DB.prepare(`INSERT INTO retailer_order_emails (order_id,email_hash,created_at)
        VALUES (?,?,?) ON CONFLICT(order_id) DO UPDATE SET email_hash=excluded.email_hash`)
        .bind(orderId, await emailHash(env.AUTH_SECRET, orderEmail), Date.now()));
    }
    await env.RELAY_DB.batch(statements);
    // Deliberately DO NOT create a verified match or expose orders to the public wallet.
    return Response.json({ received: true });
  } catch (error) {
    console.error("Shopify order ingest failed", String(error));
    return Response.json({ error: "ingest_failed" }, { status: 503 });
  }
}
