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
const db = { prepare: sql => stmt(sql), batch: async (list) => { for (const st of list) await st.run(); return []; } };
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

// 2. Options: other colours of the same product; out of stock is shown but not allowed.
const opts = (await (await call(alice, "/relay/my/exchange/options?orderId=" + encodeURIComponent(o500) + "&lineId=9500")).json()).options;
// A dearer one is offered too: by default the customer pays the difference through the shop's own Shopify checkout.
assert.deepEqual(opts.map(x => [x.title, x.available, x.reason, x.payBy]), [["Large", true, null, "shopify"], ["Navy", true, null, null], ["Red", false, "Out of stock", null]]);
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

// 7. When Shopify says which line the new item is on, Relay's copy of the order follows: the line moves to the new item's
// own line (so the shop's refund can be matched to it), what the order comes to now is kept beside its amount (which stays
// what it came to when it was placed, the figure its confirmation email gives), and the swapped item can still be
// returned. One swap per item, as before.
{
  const { handleReturnRoute } = await import("../worker/returns.js");
  const { ingestShopifyOrder } = await import("../worker/shopify-webhooks.js");
  const id = conn + ":order:503";
  sqlite.prepare("INSERT INTO retailer_orders (id, connection_id, external_order_id, ordered_at, amount_minor, currency, payment_processor, status, raw_identifier_keys) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, conn, "503", new Date(Date.now() - 2 * 864e5).toISOString(), 4500, "GBP", "shopify", "unverified", "[]");
  sqlite.prepare("INSERT INTO retailer_order_emails (order_id, email_hash, created_at) VALUES (?,?,?)").run(id, alice.emailHash, 1);
  sqlite.prepare("INSERT INTO order_items (id, order_id, external_line_item_id, product_id, variant_id, title, quantity, price_minor, currency) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id + ":item:9503", id, "9503", "1", "11", "Logo Cap", 1, 2000, "GBP");
  sqlite.prepare("INSERT INTO order_items (id, order_id, external_line_item_id, product_id, variant_id, title, quantity, price_minor, currency) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id + ":item:9600", id, "9600", "2", "50", "Canvas Tote", 1, 2500, "GBP");
  const wasFetch = o.fetchImpl;
  o.fetchImpl = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    const ok = (data) => new Response(JSON.stringify({ data }), { status: 200 });
    if (/RelayExchangeCheck/.test(query)) return ok({ order: { cancelledAt: null, displayFulfillmentStatus: "UNFULFILLED" }, productVariant: { inventoryQuantity: 5, title: "x" } });
    if (/orderEditBegin/.test(query)) return ok({ orderEditBegin: { calculatedOrder: { id: "gid://shopify/CalculatedOrder/3", lineItems: { nodes: [
      { id: "gid://shopify/CalculatedLineItem/9600", quantity: 1, variant: { id: "gid://shopify/ProductVariant/50" } },
      { id: "gid://shopify/CalculatedLineItem/9503", quantity: 1, variant: { id: "gid://shopify/ProductVariant/11" } }] } }, userErrors: [] } });
    if (/orderEditSetQuantity|orderEditAddVariant/.test(query)) return ok({ orderEditSetQuantity: { userErrors: [] }, orderEditAddVariant: { calculatedLineItem: { id: "gid://shopify/CalculatedLineItem/abc" }, userErrors: [] } });
    if (/orderEditCommit/.test(query)) {
      assert.match(query, /currentTotalPriceSet/); assert.match(query, /currentQuantity/);
      return ok({ orderEditCommit: { order: { id: "gid://shopify/Order/503", currentTotalPriceSet: { shopMoney: { amount: "45.0" } }, lineItems: { nodes: [
        { id: "gid://shopify/LineItem/9600", currentQuantity: 1, variant: { id: "gid://shopify/ProductVariant/50" } },
        { id: "gid://shopify/LineItem/9503", currentQuantity: 0, variant: { id: "gid://shopify/ProductVariant/11" } },
        { id: "gid://shopify/LineItem/8801", currentQuantity: 1, variant: { id: "gid://shopify/ProductVariant/12" } }] } }, userErrors: [] } });
    }
    throw Error("unexpected query");
  };
  const NAVY = conn + ":variant:gid://shopify/ProductVariant/12";
  const swapped = await call(alice, "/relay/my/exchange", { orderId: id, lineId: "9503", variantKey: NAVY });
  assert.equal(swapped.status, 200);
  const rowsOf = () => sqlite.prepare("SELECT id, external_line_item_id AS line, variant_id AS v, price_minor AS p FROM order_items WHERE order_id = ? ORDER BY line").all(id).map(r => ({ ...r }));
  assert.deepEqual(rowsOf(), [{ id: id + ":item:8801", line: "8801", v: "12", p: 2000 }, { id: id + ":item:9600", line: "9600", v: "50", p: 2500 }], "the line is now the new item's own");
  assert.deepEqual({ ...sqlite.prepare("SELECT line_id AS l, from_line_id AS f, from_price_minor AS p FROM relay_exchanges WHERE order_id = ?").get(id) }, { l: "8801", f: "9503", p: 2000 });
  const amounts = () => ({ ...sqlite.prepare("SELECT amount_minor AS placed, current_amount_minor AS now FROM retailer_orders WHERE id = ?").get(id) });
  assert.deepEqual(amounts(), { placed: 4500, now: 4500 }, "what Shopify says the order comes to now, beside the amount it was placed at");
  assert.equal((await call(alice, "/relay/my/exchange", { orderId: id, lineId: "8801", variantKey: conn + ":variant:gid://shopify/ProductVariant/11" })).status, 409, "still one swap per item");
  // Shopify's own notice about the changed order lists the item taken off it too, and adds it into total_price.
  const again = await ingestShopifyOrder(env, SHOP, { id: 503, created_at: new Date(Date.now() - 2 * 864e5).toISOString(), currency: "GBP", email: "alice@example.com",
    total_price: "65.00", current_total_price: "45.00", line_items: [
      { id: 9600, title: "Canvas Tote", quantity: 1, current_quantity: 1, price: "25.00", product_id: 2, variant_id: 50 },
      { id: 9503, title: "Logo Cap", quantity: 1, current_quantity: 0, price: "20.00", product_id: 1, variant_id: 11 },
      { id: 8801, title: "Logo Cap", quantity: 1, current_quantity: 1, price: "20.00", product_id: 1, variant_id: 12 }] }, "evt-503", "orders/paid");
  assert.equal(again.status, 200);
  assert.equal(rowsOf().length, 2, "the item that's no longer on the order isn't added back");
  assert.deepEqual(amounts(), { placed: 4500, now: 4500 }, "neither amount is every item ever on the order (£65)");
  // The app's view: the new colour on its own line, swapped once, and still returnable.
  const view = (await enrichPurchases(env, [{ id, retailer: conn, orderedAt: new Date(Date.now() - 2 * 864e5).toISOString(),
    items: [{ lineId: "8801", productId: "1", variantId: "12", title: "Logo Cap", quantity: 1, priceMinor: 2000 }, { lineId: "9600", productId: "2", variantId: "50", title: "Canvas Tote", quantity: 1, priceMinor: 2500 }] }]))[0].items;
  assert.deepEqual([view[0].variant, view[0].exchange.fromTitle, view[0].exchange.fromPriceMinor, view[0].exchangeable, view[0].returnable, view[0].returnBy], ["Navy", "Black", 2000, false, true, undefined]);
  assert.equal(view.length, 2);
  // Another Navy cap bought on the same order is its own item: it isn't mistaken for the swapped one and hidden.
  const twoNavy = (await enrichPurchases(env, [{ id, retailer: conn, orderedAt: new Date(Date.now() - 2 * 864e5).toISOString(),
    items: [{ lineId: "8801", productId: "1", variantId: "12", title: "Logo Cap", quantity: 1, priceMinor: 2000 }, { lineId: "9700", productId: "1", variantId: "12", title: "Logo Cap", quantity: 1, priceMinor: 2000 }] }]))[0].items;
  assert.deepEqual(twoNavy.map(i => [i.lineId, Boolean(i.exchange), i.exchangeable]), [["8801", true, false], ["9700", false, true]]);
  const ret = async (lineId, orderId = id) => handleReturnRoute(new Request("https://w.test/relay/my/return", { method: "POST", body: JSON.stringify({ orderId, lineId, reason: "wrong_size" }), headers: { "content-type": "application/json" } }),
    env, new URL("https://w.test/relay/my/return"), {}, alice, { fetchImpl: async () => new Response("{}", { status: 500 }), listStores: async () => [] });
  const r1 = await ret("8801");
  assert.equal(r1.status, 200, "a swapped item can be returned"); assert.equal(sqlite.prepare("SELECT line_id AS l FROM relay_returns WHERE order_id = ?").get(id).l, "8801");
  // A swap made before Relay kept the new line (order 500 above) still can't be: its line is no longer on the shop's order.
  sqlite.prepare("UPDATE retailer_orders SET ordered_at = ? WHERE id = ?").run(new Date(Date.now() - 2 * 864e5).toISOString(), o500);
  const r2 = await ret("9500", o500);
  assert.equal(r2.status, 409); assert.equal((await r2.json()).error, "already_exchanged");
  // With the shop's own returns period set, the app is given the shop's date.
  const { saveShopReturns } = await import("../worker/shop-returns.js");
  await saveShopReturns(env, SHOP, { days: 28 });
  const dated = (await enrichPurchases(env, [{ id, retailer: conn, orderedAt: new Date(Date.now() - 2 * 864e5).toISOString(), items: [{ lineId: "9600", productId: "2", variantId: "50", title: "Canvas Tote", quantity: 1 }] }]))[0].items[0];
  assert.deepEqual(dated.returnBy, { date: new Date(Date.now() + 26 * 864e5).toISOString().slice(0, 10), days: 28 });
  const late = (await enrichPurchases(env, [{ id, retailer: conn, orderedAt: new Date(Date.now() - 29 * 864e5).toISOString(), items: [{ lineId: "9600", productId: "2", variantId: "50", title: "Canvas Tote", quantity: 1 }] }]))[0].items[0];
  assert.deepEqual([late.returnable, late.returnBy], [false, undefined], "past the shop's 28 days");
  o.fetchImpl = wasFetch;
  console.log("ok - a swap moves Relay's order line to the new item's own line, keeps the right amounts, and the new item can be returned");
}

console.log("exchange: all checks passed");
