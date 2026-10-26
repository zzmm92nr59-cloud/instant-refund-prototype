// Offline test for exchanges through Relay (Shopify order edits). Shopify is a stand-in; nothing leaves this machine.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleExchangeRoute, enrichPurchases } from "../worker/exchange.js";
import { emailHash } from "../worker/auth.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
}
const db = { prepare: sql => stmt(sql) };
const SECRET = "unit-test-auth-secret-0123456789";
const env = { RELAY_DB: db, AUTH_SECRET: SECRET };
sqlite.exec(`ALTER TABLE retailer_catalog_items ADD COLUMN store_label TEXT; ALTER TABLE retailer_catalog_items ADD COLUMN image_url TEXT;
  CREATE TABLE IF NOT EXISTS retailer_order_emails (order_id TEXT PRIMARY KEY, email_hash TEXT NOT NULL, created_at INTEGER NOT NULL);`);
const SHOP = "oak-thread.myshopify.com", conn = "shopify:" + SHOP;
const item = conn + ":item:gid://shopify/Product/1";
sqlite.prepare("INSERT INTO retailer_catalog_items (id, provider, external_item_id, title, store_label, image_url) VALUES (?,?,?,?,?,?)").run(item, conn, "gid://shopify/Product/1", "Logo Cap", "Oak & Thread", "https://cdn.example/cap.png");
for (const [vid, title, price, qty] of [[11, "Black", 2000, 3], [12, "Navy", 2000, 5], [13, "Red", 2000, 0], [14, "Large", 2500, 4]]) {
  const key = conn + ":variant:gid://shopify/ProductVariant/" + vid;
  sqlite.prepare("INSERT INTO retailer_catalog_variants (id, item_id, external_variant_id, title, sku, price_minor, currency) VALUES (?,?,?,?,?,?,?)").run(key, item, "gid://shopify/ProductVariant/" + vid, title, "CAP-" + vid, price, "GBP");
  sqlite.prepare("INSERT OR IGNORE INTO retailer_connections (id, provider, merchant_external_id) VALUES (?,?,?)").run(conn, "shopify", SHOP);
  sqlite.prepare("INSERT INTO retailer_inventory_snapshots (variant_id, connection_id, quantity, inventory_state) VALUES (?,?,?,?)").run(key, conn, qty, "AGGREGATE");
}
const alice = { id: "alice-id", emailHash: await emailHash(SECRET, "alice@example.com") }, bob = { id: "bob-id", emailHash: await emailHash(SECRET, "bob@example.com") };
const order = (ext, who) => {
  const id = conn + ":order:" + ext;
  sqlite.prepare("INSERT INTO retailer_orders (id, connection_id, external_order_id, ordered_at, amount_minor, currency, payment_processor, status, raw_identifier_keys) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, conn, String(ext), "2026-10-25T11:00:00Z", 2000, "GBP", "shopify", "unverified", "[]");
  sqlite.prepare("INSERT INTO retailer_order_emails (order_id, email_hash, created_at) VALUES (?,?,?)").run(id, who.emailHash, 1);
  sqlite.prepare("INSERT INTO order_items (id, order_id, external_line_item_id, product_id, variant_id, title, quantity, price_minor, currency) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id + ":item:9" + ext, id, "9" + ext, "1", "11", "Logo Cap", 1, 2000, "GBP");
  return id;
};
const o500 = order(500, alice), o501 = order(501, alice), o502 = order(502, alice);

let calls = [], fulfilment = { "500": "UNFULFILLED", "501": "FULFILLED", "502": "UNFULFILLED" }, refuseAdd = false, removedLine = null;
const fetchImpl = async (url, init) => {
  assert.equal(String(url), "https://" + SHOP + "/admin/api/2026-07/graphql.json");
  assert.equal(init.headers["X-Shopify-Access-Token"], "tok");
  const { query, variables } = JSON.parse(init.body); calls.push({ query, variables });
  const ok = (data) => new Response(JSON.stringify({ data }), { status: 200 });
  if (/RelayExchangeCheck/.test(query)) return ok({ order: { cancelledAt: null, displayFulfillmentStatus: fulfilment[variables.o.split("/").pop()] }, productVariant: { inventoryQuantity: variables.v.endsWith("/12") ? 5 : 0, title: "x" } });
  // Order 502: the shop has since changed the product's variants, so Shopify no longer links the bought line to a variant.
  if (/orderEditBegin/.test(query) && variables.id.endsWith("/502")) return ok({ orderEditBegin: { calculatedOrder: { id: "gid://shopify/CalculatedOrder/2", lineItems: { nodes: [
    { id: "gid://shopify/CalculatedLineItem/777", quantity: 1, variant: { id: "gid://shopify/ProductVariant/99" } },
    { id: "gid://shopify/CalculatedLineItem/9502", quantity: 1, variant: null }] } }, userErrors: [] } });
  if (/orderEditBegin/.test(query)) return ok({ orderEditBegin: { calculatedOrder: { id: "gid://shopify/CalculatedOrder/1", lineItems: { nodes: [{ id: "gid://shopify/CalculatedLineItem/1", quantity: 1, variant: { id: "gid://shopify/ProductVariant/11" } }] } }, userErrors: [] } });
  if (/orderEditSetQuantity/.test(query)) { assert.match(query, /restock: true/); removedLine = variables.line; return ok({ orderEditSetQuantity: { userErrors: [] } }); }
  if (/orderEditAddVariant/.test(query)) return ok({ orderEditAddVariant: { userErrors: refuseAdd ? [{ message: "Variant is not available" }] : [] } });
  if (/orderEditCommit/.test(query)) { assert.match(variables.note, /Exchanged through Relay/); return ok({ orderEditCommit: { order: { id: "gid://shopify/Order/500" }, userErrors: [] } }); }
  throw Error("unexpected query");
};
const o = { now: 1_800_000_000_000, fetchImpl, listStores: async () => [{ domain: SHOP, token: "tok" }] };
const call = (who, path, body) => handleExchangeRoute(new Request("https://w.test" + path, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } }),
  env, new URL("https://w.test" + path), {}, who, o);

// 1. Only the shopper whose email the order was placed with can see options or exchange.
assert.equal((await call(bob, "/relay/my/exchange/options?orderId=" + encodeURIComponent(o500) + "&lineId=9500")).status, 404);
assert.equal((await call(bob, "/relay/my/exchange", { orderId: o500, lineId: "9500", variantKey: conn + ":variant:gid://shopify/ProductVariant/12" })).status, 404);
assert.equal(calls.length, 0, "nothing reaches the shop for someone else's order");

// 2. Options: other colours of the same product; out of stock and different price are shown but not allowed.
const opts = (await (await call(alice, "/relay/my/exchange/options?orderId=" + encodeURIComponent(o500) + "&lineId=9500")).json()).options;
assert.deepEqual(opts.map(x => [x.title, x.available, x.reason]), [["Large", false, "Different price (not supported yet)"], ["Navy", true, null], ["Red", false, "Out of stock"]]);
assert.equal((await call(alice, "/relay/my/exchange", { orderId: o500, lineId: "9500", variantKey: conn + ":variant:gid://shopify/ProductVariant/13" })).status, 409, "out of stock is refused");
assert.equal((await call(alice, "/relay/my/exchange", { orderId: o500, lineId: "9500", variantKey: "made-up" })).status, 400);
assert.equal(calls.length, 0);

// 3. An order already sent can't be edited; Relay says so and changes nothing.
const sent = await call(alice, "/relay/my/exchange", { orderId: o501, lineId: "9501", variantKey: conn + ":variant:gid://shopify/ProductVariant/12" });
assert.equal(sent.status, 409); assert.equal((await sent.json()).error, "already_sent");
assert.ok(!calls.some(c => /mutation/.test(c.query)), "no edit is attempted on a sent order");

// 4. If the shop refuses part-way, nothing is committed and the attempt is recorded as failed.
refuseAdd = true; calls = [];
assert.equal((await call(alice, "/relay/my/exchange", { orderId: o500, lineId: "9500", variantKey: conn + ":variant:gid://shopify/ProductVariant/12" })).status, 502);
assert.ok(!calls.some(c => /orderEditCommit/.test(c.query)), "never committed");

// 5. A good exchange: the old item goes back into stock, the new one is added, the edit is committed, nothing to pay.
refuseAdd = false; calls = [];
const done = await call(alice, "/relay/my/exchange", { orderId: o500, lineId: "9500", variantKey: conn + ":variant:gid://shopify/ProductVariant/12" });
assert.equal(done.status, 200); assert.match((await done.json()).message, /Navy instead\. Nothing to pay or refund/);
assert.deepEqual(calls.map(c => (/mutation (\w+)/.exec(c.query) || /query (\w+)/.exec(c.query))[1]), ["RelayExchangeCheck", "RelayEditBegin", "RelayEditRemove", "RelayEditAdd", "RelayEditCommit"]);
assert.equal(calls[3].variables.v, "gid://shopify/ProductVariant/12");
assert.equal((await call(alice, "/relay/my/exchange", { orderId: o500, lineId: "9500", variantKey: conn + ":variant:gid://shopify/ProductVariant/12" })).status, 409, "only once per item");

// 6. The purchase now shows the new colour, with its picture.
const purchases = await enrichPurchases(env, [{ id: o500, retailer: conn, items: [{ lineId: "9500", productId: "1", variantId: "11", title: "Logo Cap", quantity: 1 }] }]);
assert.equal(purchases[0].items[0].variant, "Navy"); assert.equal(purchases[0].items[0].imageUrl, "https://cdn.example/cap.png");
assert.equal(purchases[0].items[0].exchangeable, false); assert.equal(purchases[0].items[0].exchange.fromTitle, "Black");
// The shop changed the product's variants after the order: Relay finds the shopper's own line by its line id,
// and removes exactly that line (never the other item on the order).
const changed = await call(alice, "/relay/my/exchange", { orderId: o502, lineId: "9502", variantKey: conn + ":variant:gid://shopify/ProductVariant/12" });
assert.equal(changed.status, 200, "exchange works even though the bought variant no longer exists");
assert.equal(removedLine, "gid://shopify/CalculatedLineItem/9502");

console.log("exchange: all checks passed");
