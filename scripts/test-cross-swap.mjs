// Offline test for swapping an item for something from another shop on Relay (worker/cross-swap.js), and the testing tools'
// test orders at Shopify test shops (worker/shopify-test-orders.js). Shopify and the email service are stand-ins; nothing
// leaves this machine. Made-up shops, people and items.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleCrossSwapRoute, attachCrossSwaps, crossSwapsForExport } from "../worker/cross-swap.js";
import { handleShopifyTestRoute, TEST_ORDERS_PER_DAY } from "../worker/shopify-test-orders.js";
import { ingestShopifyOrder } from "../worker/shopify-webhooks.js";
import { ensureShopifyShopSchema } from "../worker/shopify-connect.js";
import { emailHash } from "../worker/auth.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
}
const db = { prepare: sql => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
const SECRET = "unit-test-auth-secret-0123456789";
const env = { RELAY_DB: db, AUTH_SECRET: SECRET, RESEND_API_KEY: "re_test_key" };
sqlite.exec(`ALTER TABLE retailer_catalog_items ADD COLUMN store_label TEXT; ALTER TABLE retailer_catalog_items ADD COLUMN image_url TEXT;
  CREATE TABLE IF NOT EXISTS retailer_order_emails (order_id TEXT PRIMARY KEY, email_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS shopify_shop_plan (domain TEXT PRIMARY KEY, test_shop INTEGER NOT NULL, plan TEXT, checked_at INTEGER NOT NULL);`);

// Shops: Oak & Thread and Birch Lane are real shops; Fern Test and Moss Test are Shopify development stores (test shops).
const OAK = "oak-thread.myshopify.com", BIRCH = "birch-lane.myshopify.com", FERN = "fern-test.myshopify.com", MOSS = "moss-test.myshopify.com";
await ensureShopifyShopSchema(db);
for (const [domain, label, test] of [[OAK, "Oak & Thread", 0], [BIRCH, "Birch Lane", 0], [FERN, "Fern Test", 1], [MOSS, "Moss Test", 1]]) {
  sqlite.prepare("INSERT INTO shopify_shops (domain, label, access_iv, access_data, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(domain, label, "iv", "data", 1, 1);
  sqlite.prepare("INSERT INTO shopify_shop_plan (domain, test_shop, plan, checked_at) VALUES (?,?,?,?)").run(domain, test, test ? "Development" : "Basic", 1);
  sqlite.prepare("INSERT OR IGNORE INTO retailer_connections (id, provider, merchant_external_id) VALUES (?,?,?)").run("shopify:" + domain, "shopify", domain);
}
const product = (shop, pid, title, variants) => {
  const conn = "shopify:" + shop, item = conn + ":item:gid://shopify/Product/" + pid;
  sqlite.prepare("INSERT INTO retailer_catalog_items (id, provider, external_item_id, title, image_url) VALUES (?,?,?,?,?)").run(item, conn, "gid://shopify/Product/" + pid, title, "https://cdn.example/" + pid + ".png");
  for (const [vid, vtitle, price, qty, cur = "GBP"] of variants) {
    const key = conn + ":variant:gid://shopify/ProductVariant/" + vid;
    sqlite.prepare("INSERT INTO retailer_catalog_variants (id, item_id, external_variant_id, title, sku, price_minor, currency) VALUES (?,?,?,?,?,?,?)").run(key, item, "gid://shopify/ProductVariant/" + vid, vtitle, "SKU" + vid, price, cur);
    sqlite.prepare("INSERT INTO retailer_inventory_snapshots (variant_id, connection_id, quantity, inventory_state) VALUES (?,?,?,?)").run(key, conn, qty, "AGGREGATE");
  }
};
product(OAK, 1, "Logo Cap", [[11, "Black", 2000, 3]]);
product(BIRCH, 2, "Linen Shirt", [[21, "M", 4500, 4], [22, "L", 4500, 0]]);
product(BIRCH, 3, "Canvas Tote", [[31, "Default Title", 1800, 2], [32, "Euro", 1800, 5, "EUR"]]);
product(FERN, 4, "Test Trainers", [[41, "UK 9", 6000, 6]]);
product(MOSS, 5, "Test Jacket", [[51, "M", 9000, 1]]);
const key = (shop, vid) => "shopify:" + shop + ":variant:gid://shopify/ProductVariant/" + vid;

const alice = { id: "alice-id", email: "alice@example.com", emailHash: await emailHash(SECRET, "alice@example.com") };
const bob = { id: "bob-id", email: "bob@example.com", emailHash: await emailHash(SECRET, "bob@example.com") };
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const order = (shop, ext, who, at, line) => {
  const conn = "shopify:" + shop, id = conn + ":order:" + ext;
  sqlite.prepare("INSERT INTO retailer_orders (id, connection_id, external_order_id, ordered_at, amount_minor, currency, payment_processor, status, raw_identifier_keys) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, conn, String(ext), at, line.price, "GBP", "shopify", "unverified", "[]");
  sqlite.prepare("INSERT INTO retailer_order_emails (order_id, email_hash, created_at) VALUES (?,?,?)").run(id, who.emailHash, 1);
  sqlite.prepare("INSERT INTO order_items (id, order_id, external_line_item_id, product_id, variant_id, title, quantity, price_minor, currency) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id + ":item:" + line.id, id, line.id, line.product, line.variant, line.title, 1, line.price, "GBP");
  return id;
};
const capLine = { id: "901", product: "1", variant: "11", title: "Logo Cap", price: 2000 };
const o1 = order(OAK, 1001, alice, daysAgo(2), capLine);
const o2 = order(OAK, 1002, alice, daysAgo(20), { ...capLine, id: "902" }); // past the 7 days Relay can start returns for
const o3 = order(FERN, 3001, alice, daysAgo(1), { id: "931", product: "4", variant: "41", title: "Test Trainers", price: 6000 });

// Shopify and the email service, as stand-ins.
let calls = [], live = { "21": { availableForSale: true, price: "45.00", product: { status: "ACTIVE" } }, "31": { availableForSale: true, price: "18.00", product: { status: "ACTIVE" } },
  "51": { availableForSale: true, price: "90.00", product: { status: "ACTIVE" } } }, emails = [], refuseOrder = false, shopDown = false;
const fetchImpl = async (url, init) => {
  url = String(url);
  if (url === "https://api.resend.com/emails") { emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  const m = /^https:\/\/([a-z0-9-]+\.myshopify\.com)\/admin\/api\/2026-07\/graphql\.json$/.exec(url);
  assert.ok(m, "only Shopify and the email service are asked: " + url);
  assert.equal(init.headers["X-Shopify-Access-Token"], "tok-" + m[1]);
  const { query, variables } = JSON.parse(init.body); calls.push({ shop: m[1], query, variables });
  const ok = (data) => new Response(JSON.stringify({ data }), { status: 200 });
  if (shopDown) return new Response("{}", { status: 503 });
  if (/RelayCrossSwapCheck/.test(query)) return ok({ productVariant: live[variables.v.split("/").pop()] || null });
  if (/RelayReturnShop/.test(query)) return ok({ shop: { name: "Oak & Thread", email: "shop@oak.example", contactEmail: "help@oak.example" }, order: { name: "#1001" } });
  if (/RelayTestOrder/.test(query)) {
    if (refuseOrder) return ok({ orderCreate: { order: null, userErrors: [{ field: ["lineItems"], message: "Variant is not available" }] } });
    const o = variables.order, n = 5000 + calls.filter(c => /RelayTestOrder/.test(c.query)).length;
    return ok({ orderCreate: { userErrors: [], order: { legacyResourceId: String(n), name: "#" + n, createdAt: new Date().toISOString(), processedAt: new Date().toISOString(), currencyCode: "GBP",
      totalPriceSet: { shopMoney: { amount: o.transactions[0].amountSet.shopMoney.amount } },
      lineItems: { nodes: [{ id: "gid://shopify/LineItem/7" + n, title: "Test Jacket", quantity: 1, originalUnitPriceSet: { shopMoney: { amount: "90.00" } }, product: { legacyResourceId: "5" },
        variant: { legacyResourceId: o.lineItems[0].variantId.split("/").pop() } }] } } } });
  }
  throw Error("unexpected Shopify question: " + query.slice(0, 60));
};
const stores = [OAK, BIRCH, FERN, MOSS].map(d => ({ domain: d, token: "tok-" + d, label: d }));
const o = { now: Date.now(), fetchImpl, listStores: async () => stores };
const req = (path, body) => new Request("https://w.test" + path, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } });
const call = async (who, path, body) => { const r = await handleCrossSwapRoute(req(path, body), env, new URL("https://w.test" + path), {}, who, o); return { status: r.status, body: await r.json() }; };
const optionsFor = (who, id, line) => call(who, "/relay/my/cross-swap/options?orderId=" + encodeURIComponent(id) + "&lineId=" + line);
const testOrder = async (who, variantKey) => { const r = await handleShopifyTestRoute(req("/relay/my/testing/shopify-order", { variantKey }), env, new URL("https://w.test/relay/my/testing/shopify-order"), {}, who, o); return { status: r.status, body: await r.json() }; };

// 1. Only the shopper the order belongs to can see what's on offer or start a swap, and nothing reaches any shop for anyone else.
assert.equal((await optionsFor(bob, o1, "901")).status, 404);
assert.equal((await call(bob, "/relay/my/cross-swap", { orderId: o1, lineId: "901", toKey: key(BIRCH, 21), reason: "changed_mind", agreedPriceMinor: 4500 })).status, 404);
assert.equal(calls.length + emails.length, 0, "nothing is asked of a shop for someone else's order");
console.log("ok - only the shopper whose order it is");

// 2. What's on offer: other real shops' items in stock and priced in pounds; never the same shop, never a test shop.
const opts = await optionsFor(alice, o1, "901");
assert.equal(opts.status, 200); assert.equal(opts.body.eligible, true);
assert.deepEqual(opts.body.item, { title: "Logo Cap", priceMinor: 2000, shop: "Oak & Thread" });
assert.deepEqual(opts.body.shops.map(s => [s.name, s.items.map(i => [i.product, i.variant, i.priceMinor])]),
  [["Birch Lane", [["Canvas Tote", null, 1800], ["Linen Shirt", "M", 4500]]]], "Birch Lane only: in stock, in pounds; no test shops, not Oak & Thread itself");
assert.equal(opts.body.shops[0].items[1].key, key(BIRCH, 21));
assert.equal(opts.body.shops[0].items[1].imageUrl, "https://cdn.example/2.png");
// Past the 7 days: not offered, with the reason.
assert.deepEqual((await optionsFor(alice, o2, "902")).body, { eligible: false, reason: "outside_return_window" });
// A test shop's order is offered other test shops only.
assert.deepEqual((await optionsFor(alice, o3, "931")).body.shops.map(s => s.name), ["Moss Test"]);
// The app offers the swap only where there's a choice: another shop of the same kind with something in stock.
let pre = await attachCrossSwaps(env, alice, [{ id: o1, retailer: "shopify:" + OAK, items: [{ lineId: "901", returnable: true }, { lineId: "909", returnable: false }] },
  { id: o3, retailer: "shopify:" + FERN, items: [{ lineId: "931", returnable: true }] }]);
assert.deepEqual([pre[0].items[0].otherShops, pre[0].items[1].otherShops, pre[1].items[0].otherShops], [true, undefined, true]);
const birchStock = sqlite.prepare("SELECT variant_id AS v, quantity AS q FROM retailer_inventory_snapshots WHERE connection_id = ?").all("shopify:" + BIRCH);
sqlite.prepare("UPDATE retailer_inventory_snapshots SET quantity = 0 WHERE connection_id = ?").run("shopify:" + BIRCH);
pre = await attachCrossSwaps(env, alice, [{ id: o1, retailer: "shopify:" + OAK, items: [{ lineId: "901", returnable: true }] }]);
assert.equal(pre[0].items[0].otherShops, undefined, "no other real shop has anything in stock: not offered (test shops don't count)");
for (const s of birchStock) sqlite.prepare("UPDATE retailer_inventory_snapshots SET quantity = ? WHERE variant_id = ?").run(s.q, s.v);
console.log("ok - other shops' items in stock, in pounds; real with real, test with test; offered only where there's a choice");

// 3. Refused without changing anything: no reason, an item that isn't on offer, the same shop, a test shop for a real order,
// an item the shop no longer sells, and a price the shopper didn't agree to.
const base = { orderId: o1, lineId: "901", toKey: key(BIRCH, 21), reason: "changed_mind", agreedPriceMinor: 4500 };
assert.equal((await call(alice, "/relay/my/cross-swap", { ...base, reason: undefined })).body.error, "reason_needed");
assert.equal((await call(alice, "/relay/my/cross-swap", { ...base, toKey: "made-up" })).body.error, "not_an_option");
assert.equal((await call(alice, "/relay/my/cross-swap", { ...base, toKey: key(OAK, 11) })).body.error, "not_an_option", "not the same shop");
assert.equal((await call(alice, "/relay/my/cross-swap", { ...base, toKey: key(MOSS, 51), agreedPriceMinor: 9000 })).body.error, "not_an_option", "a real order never swaps to a test shop");
assert.equal(calls.length + emails.length, 0);
live["21"] = { availableForSale: false, price: "45.00", product: { status: "ACTIVE" } };
let r = await call(alice, "/relay/my/cross-swap", base);
assert.deepEqual([r.status, r.body.error], [409, "out_of_stock"], "shop B's own Shopify says it can't be bought now");
live["21"] = { availableForSale: true, price: "47.50", product: { status: "ACTIVE" } };
r = await call(alice, "/relay/my/cross-swap", base);
assert.deepEqual([r.status, r.body], [409, { error: "price_changed", priceMinor: 4750 }], "a new price must be agreed first");
shopDown = true;
assert.deepEqual((await call(alice, "/relay/my/cross-swap", { ...base, agreedPriceMinor: 4750 })).body, { error: "shop_unavailable" });
shopDown = false;
assert.equal(emails.length, 0, "shop A hasn't been told about any return");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM relay_returns").get().n, 0, "no return was started");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM relay_cross_swaps").get().n, 0);
console.log("ok - refused without starting anything: reason, not an option, same shop, test shop, sold out, new price, shop not answering");

// 4. The swap: shop A's return starts (shop A emailed, a Relay reference), and the shopper gets shop B's own checkout link.
calls = [];
r = await call(alice, "/relay/my/cross-swap", { ...base, agreedPriceMinor: 4750 });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.match(r.body.returnRef, /^RLY-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
assert.equal(r.body.shopNotified, true); assert.equal(r.body.labelAvailable, false);
assert.equal(r.body.buyUrl, "https://" + BIRCH + "/cart/21:1", "shop B's own checkout, with nothing about the shopper in the link");
assert.deepEqual([r.body.fromShop, r.body.fromTitle, r.body.fromPriceMinor, r.body.toShop, r.body.toTitle, r.body.toPriceMinor, r.body.testShop],
  ["Oak & Thread", "Logo Cap", 2000, "Birch Lane", "Linen Shirt (M)", 4750, false]);
assert.equal(emails.length, 1); assert.deepEqual(emails[0].to, ["help@oak.example"]); assert.match(emails[0].subject, /^Return request RLY-/);
assert.ok(!calls.some(c => /mutation/.test(c.query)), "Relay places no order and changes nothing at either shop");
assert.ok(!calls.some(c => c.shop === BIRCH && !/RelayCrossSwapCheck/.test(c.query)), "shop B is only asked whether it can sell the item");
const ret = sqlite.prepare("SELECT order_id, line_id, status, reason FROM relay_returns").all();
assert.deepEqual(ret.map(x => ({ ...x })), [{ order_id: o1, line_id: "901", status: "requested", reason: "changed_mind" }]);
// Once started, the item can't be swapped or returned again (one swap per item; a double tap doesn't make a second).
assert.equal((await call(alice, "/relay/my/cross-swap", { ...base, agreedPriceMinor: 4750 })).body.error, "already_returned");
assert.deepEqual((await optionsFor(alice, o1, "901")).body, { eligible: false, reason: "already_returned" });
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM relay_cross_swaps").get().n, 1);
console.log("ok - the swap: return at shop A started and emailed; shop B's own checkout link; nothing placed or charged by Relay; once only");

// 5. On the purchases: the cap shows the swap waiting for shop B's order (with the link) and can't be returned or swapped.
const purchases = () => [{ id: o1, retailer: "shopify:" + OAK, items: [{ lineId: "901", variantId: "11", title: "Logo Cap", returnable: true, exchangeable: true }] }];
let p = await attachCrossSwaps(env, alice, purchases());
let cs = p[0].items[0].crossSwap;
assert.deepEqual([cs.status, cs.toShop, cs.toTitle, cs.toPriceMinor, cs.buyUrl, cs.returnRef], ["waiting", "Birch Lane", "Linen Shirt (M)", 4750, "https://" + BIRCH + "/cart/21:1", r.body.returnRef]);
assert.equal(p[0].items[0].returnable, false); assert.equal(p[0].items[0].exchangeable, false);
assert.equal(cs.newOrderId, undefined, "ids for matching aren't sent to the app");
assert.deepEqual((await attachCrossSwaps(env, bob, purchases()))[0].items[0].crossSwap, undefined, "never on anyone else's purchases");

// 6. Shop B's order: matched only when it's the shopper's own (verified email), for that item, placed after the swap started.
const birchOrder = (ext, who, at, variant = "21") => order(BIRCH, ext, who, at, { id: "95" + ext, product: "2", variant, title: "Linen Shirt", price: 4750 });
birchOrder(2001, alice, daysAgo(3));            // before the swap started: an earlier purchase, not this swap
birchOrder(2002, bob, new Date().toISOString()); // someone else's order for the same item
birchOrder(2003, alice, new Date().toISOString(), "22"); // the shopper's own, but another size
assert.equal((await attachCrossSwaps(env, alice, purchases()))[0].items[0].crossSwap.status, "waiting");
const b4 = birchOrder(2004, alice, new Date(Date.now() + 1000).toISOString());
p = await attachCrossSwaps(env, alice, [...purchases(), { id: b4, retailer: "shopify:" + BIRCH, items: [{ lineId: "952004", variantId: "21", title: "Linen Shirt" }] }]);
cs = p[0].items[0].crossSwap;
assert.deepEqual([cs.status, cs.buyUrl, cs.toKey], ["ordered", null, null], "ordered from shop B: no link any more");
assert.deepEqual(p[1].items[0].boughtInSwap, { fromShop: "Oak & Thread", fromTitle: "Logo Cap" }, "the new item says what it replaced");
assert.equal(sqlite.prepare("SELECT new_order_id AS n FROM relay_cross_swaps").get().n, b4);
console.log("ok - shop B's order matched: the shopper's own, that item, after the swap started; never someone else's");

// 7. Listed for the shopper, and in "Download my data".
const listed = await call(alice, "/relay/my/cross-swaps");
assert.deepEqual(listed.body.swaps.map(s => [s.fromShop, s.toShop, s.status]), [["Oak & Thread", "Birch Lane", "ordered"]]);
assert.deepEqual((await call(bob, "/relay/my/cross-swaps")).body.swaps, []);
const ex = await crossSwapsForExport(env, alice.id);
assert.deepEqual(ex.map(x => [x.fromShop, x.sentBack, x.toShop, x.gettingInstead, x.status]), [["Oak & Thread", "Logo Cap", "Birch Lane", "Linen Shirt (M)", "ordered"]]);
console.log("ok - listed for the shopper, and in their data download");

// 8. Testing tools: test orders only at test shops, under the tester's own email, shown in their account; 5 a day.
calls = [];
assert.equal((await testOrder(alice, key(BIRCH, 21))).body.error, "not_a_test_shop", "never at a real shop");
assert.equal((await testOrder(alice, "made-up")).body.error, "not_a_test_item");
assert.equal(calls.length, 0);
let t = await testOrder(alice, key(MOSS, 51));
assert.equal(t.status, 200, JSON.stringify(t.body)); assert.equal(t.body.shown, true);
assert.match(t.body.message, /^Test order #5001 placed at moss-test\.myshopify\.com under your Relay email\. No real money moved\.$/);
const sent = calls.find(c => /RelayTestOrder/.test(c.query)).variables;
assert.deepEqual([sent.order.email, sent.order.test, sent.order.financialStatus, sent.order.currency, sent.order.lineItems, sent.order.transactions[0].amountSet.shopMoney, sent.options],
  ["alice@example.com", true, "PAID", "GBP", [{ variantId: "gid://shopify/ProductVariant/51", quantity: 1 }], { amount: "90.00", currencyCode: "GBP" }, { sendReceipt: false, sendFulfillmentReceipt: false }]);
const mine = sqlite.prepare("SELECT o.id FROM retailer_orders o JOIN retailer_order_emails e ON e.order_id = o.id WHERE e.email_hash = ? AND o.connection_id = ?").all(alice.emailHash, "shopify:" + MOSS);
assert.equal(mine.length, 1, "the test order is in the tester's account straight away");
refuseOrder = true;
assert.equal((await testOrder(alice, key(MOSS, 51))).body.error, "shop_refused");
refuseOrder = false;
for (let i = 0; i < TEST_ORDERS_PER_DAY - 2; i++) assert.equal((await testOrder(alice, key(MOSS, 51))).status, 200);
assert.equal((await testOrder(alice, key(MOSS, 51))).body.error, "too_many_test_orders", "5 a day, failures included");
console.log("ok - test orders: test shops only, the tester's own email, shown straight away, 5 a day");

// 9. The whole thing on test shops: a test order at one test shop, swapped for a test shop's item, bought there with a test order.
const fernOrder = sqlite.prepare("SELECT id FROM retailer_orders WHERE connection_id = ?").get("shopify:" + FERN).id;
const sw = await call(alice, "/relay/my/cross-swap", { orderId: fernOrder, lineId: "931", toKey: key(MOSS, 51), reason: "wrong_size", agreedPriceMinor: 9000 });
assert.equal(sw.status, 200, JSON.stringify(sw.body)); assert.equal(sw.body.testShop, true);
sqlite.prepare("DELETE FROM shopify_test_orders").run();
await ingestShopifyOrder(env, MOSS, { id: 7777, name: "#7777", created_at: new Date(Date.now() + 2000).toISOString(), currency: "GBP", email: "alice@example.com", total_price: "90.00",
  line_items: [{ id: 8888, title: "Test Jacket", quantity: 1, price: "90.00", product_id: 5, variant_id: 51 }] }, "test:1");
p = await attachCrossSwaps(env, alice, [{ id: fernOrder, retailer: "shopify:" + FERN, items: [{ lineId: "931", variantId: "41", title: "Test Trainers" }] }]);
assert.equal(p[0].items[0].crossSwap.status, "ordered");
console.log("ok - end to end on test shops: test order, swap to another test shop, its order matched");

console.log("PASS swaps across shops: owner only, real with real and test with test, live stock and price at shop B, return started at shop A, shop B's own checkout, its order matched, test orders at test shops only");
