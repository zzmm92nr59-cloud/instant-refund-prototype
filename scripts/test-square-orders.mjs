// Offline tests (FAKE Square, real SQLite) for Square orders in Relay: linking each order to its owner by email,
// keeping the exact size/colour bought, and the sandbox-only test-order tool.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { importLocation } from "../worker/square-history.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
for (const [t, c] of [["retailer_catalog_items", "store_label TEXT"], ["retailer_catalog_items", "image_url TEXT"]]) {
  try { sqlite.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* already there */ }
}
let dbCalls = 0;
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    async run() { dbCalls++; sqlite.prepare(sql).run(...args); return {}; },
    async first() { dbCalls++; return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { dbCalls++; return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); }
  };
}
const db = { prepare: sql => stmt(sql), async batch(list) { dbCalls++; sqlite.exec("BEGIN"); try { list.forEach(s => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", SQUARE_ACCESS_TOKEN: "sandbox-token-test" };

// The test shop's catalogue: a T-shirt in two sizes, and a mug in one.
sqlite.exec(`INSERT INTO retailer_catalog_items (id,provider,external_item_id,title,store_label,image_url) VALUES
  ('square:sandbox:item:TEE','square_sandbox','TEE','Organic T-shirt','Relay Demo Store','https://img.test/tee.jpg'),
  ('square:sandbox:item:MUG','square_sandbox','MUG','Mug','Relay Demo Store',NULL)`);
sqlite.exec(`INSERT INTO retailer_catalog_variants (id,item_id,external_variant_id,title,price_minor,currency) VALUES
  ('square:sandbox:variant:TEE-M','square:sandbox:item:TEE','TEE-M','Medium',2500,'GBP'),
  ('square:sandbox:variant:TEE-L','square:sandbox:item:TEE','TEE-L','Large',2500,'GBP'),
  ('square:sandbox:variant:MUG-1','square:sandbox:item:MUG','MUG-1','Regular',900,'GBP'),
  ('square:sandbox:variant:TEE-XL','square:sandbox:item:TEE','TEE-XL','Extra large',3000,'GBP'),
  ('square:sandbox:variant:TEE-S','square:sandbox:item:TEE','TEE-S','Small',2000,'GBP')`);
sqlite.exec("INSERT INTO retailer_connections (id,provider,merchant_external_id) VALUES ('square:sandbox:LOC1','square_sandbox','LOC1')");
for (const v of ["TEE-M", "TEE-L", "MUG-1", "TEE-XL", "TEE-S"])
  sqlite.prepare("INSERT INTO retailer_inventory_snapshots (variant_id,connection_id,quantity,inventory_state) VALUES (?,?,?,?)").run("square:sandbox:variant:" + v, "square:sandbox:LOC1", 5, "IN_STOCK");

// ---- Fake Square --------------------------------------------------------------------------------------------------
const LOC = { id: "LOC1", name: "Relay Demo Store", status: "ACTIVE", currency: "GBP" };
const customers = { C_ALICE: { id: "C_ALICE", email_address: "Alice@Example.com" } };
const payments = { P_BOB: { id: "P_BOB", buyer_email_address: "bob@example.com" } };
const order = (id, extra) => ({ id, location_id: "LOC1", created_at: new Date(Date.now() - 86400000).toISOString(), state: "COMPLETED", total_money: { amount: 2500, currency: "GBP" },
  line_items: [{ uid: "L1", name: "Organic T-shirt", catalog_object_id: "TEE-M", quantity: "1", base_price_money: { amount: 2500, currency: "GBP" } }], ...extra });
const orders = {
  O_ALICE: order("O_ALICE", { customer_id: "C_ALICE" }),                    // email on the customer profile
  O_BOB: order("O_BOB", { tenders: [{ payment_id: "P_BOB" }] }),            // email only on the payment
  O_NOBODY: order("O_NOBODY", { tenders: [{ payment_id: "P_NONE" }] })      // no email anywhere
};
payments.P_NONE = { id: "P_NONE" };
let squareCalls = [], fail = null, payCalls = [], refundSeq = 0, refundStatus = "COMPLETED", refundKeys = {};
const PRICES = { "TEE-M": 2500, "TEE-L": 2500, "MUG-1": 900, "TEE-XL": 3000, "TEE-S": 2000 };
const stock = { "TEE-M": 5, "TEE-L": 5, "MUG-1": 5, "TEE-XL": 5, "TEE-S": 5 };
function makeOrder(o) {
  const line = o.line_items[0], q = Number(line.quantity), v = PRICES[line.catalog_object_id] * q;
  const off = (o.discounts || []).reduce((n, d) => n + d.amount_money.amount, 0);
  const id = "O_TEST" + Object.keys(orders).length;
  orders[id] = { id, location_id: o.location_id, customer_id: o.customer_id, created_at: new Date().toISOString(), state: "OPEN", reference_id: o.reference_id,
    total_money: { amount: Math.max(0, v - off), currency: "GBP" }, net_amount_due_money: { amount: Math.max(0, v - off), currency: "GBP" },
    line_items: [{ uid: line.uid || "T1", name: "Item", catalog_object_id: line.catalog_object_id, quantity: String(q), base_price_money: { amount: PRICES[line.catalog_object_id], currency: "GBP" } }] };
  return orders[id];
}
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { mails.push(JSON.parse(init.body)); return json({}); }
  assert.ok(url.startsWith("https://connect.squareupsandbox.com/"), "only Square's sandbox is called: " + url);
  assert.equal(init.headers.Authorization, "Bearer sandbox-token-test");
  const path = url.slice("https://connect.squareupsandbox.com".length), method = init.method || "GET", body = init.body ? JSON.parse(init.body) : null;
  squareCalls.push(method + " " + path);
  if (fail && path.startsWith(fail)) return json({ errors: [{ code: "INTERNAL_SERVER_ERROR" }] }, 500);
  if (path === "/v2/locations") return json({ locations: [LOC] });
  if (path === "/v2/locations/LOC1") return json({ location: { ...LOC, business_name: "Relay Demo Store", business_email: "owner@demostore.test" } });
  if (path === "/v2/orders/search") return json({ orders: Object.values(orders) });
  let m;
  if ((m = /^\/v2\/customers\/([A-Z_0-9]+)$/.exec(path)) && method === "GET") return customers[m[1]] ? json({ customer: customers[m[1]] }) : json({ errors: [{ code: "NOT_FOUND" }] }, 404);
  if ((m = /^\/v2\/payments\/([A-Z_0-9]+)$/.exec(path)) && method === "GET") {
    if (payments[m[1]]) return json({ payment: payments[m[1]] });
    const o = orders[m[1].slice(2)];
    return o ? json({ payment: { id: m[1], refund_ids: (o.refunds || []).map(r => r.id) } }) : json({ errors: [{ code: "NOT_FOUND" }] }, 404);
  }
  if ((m = /^\/v2\/refunds\/([A-Z_0-9]+)$/.exec(path)) && method === "GET") {
    const rf = Object.values(orders).flatMap(o => o.refunds || []).find(r => r.id === m[1]);
    return rf ? json({ refund: rf }) : json({ errors: [{ code: "NOT_FOUND" }] }, 404);
  }
  if (path === "/v2/customers/search") return json({ customers: Object.values(customers).filter(c => c.email_address.toLowerCase() === body.query.filter.email_address.exact) });
  if (path === "/v2/customers" && method === "POST") { const c = { id: "C_NEW" + Object.keys(customers).length, email_address: body.email_address }; customers[c.id] = c; return json({ customer: c }); }
  if (path === "/v2/orders" && method === "POST") {
    return json({ order: makeOrder(body.order) });
  }
  if (path === "/v2/online-checkout/payment-links" && method === "POST") {
    const o = makeOrder(body.order);
    return json({ payment_link: { id: "PL1", url: "https://sandbox.square.link/u/" + o.id, order_id: o.id } });
  }
  if ((m = /^\/v2\/orders\/([A-Z_0-9]+)\/pay$/.exec(path)) && method === "POST") {
    assert.equal(orders[m[1]].total_money.amount, 0, "only £0 orders are closed without a payment");
    orders[m[1]].state = "COMPLETED"; payCalls.push(m[1]);
    return json({ order: orders[m[1]] });
  }
  if ((m = /^\/v2\/inventory\/([A-Z0-9-]+)\?location_ids=LOC1$/.exec(path))) {
    return json({ counts: stock[m[1]] == null ? [] : [{ catalog_object_id: m[1], location_id: "LOC1", state: "IN_STOCK", quantity: String(stock[m[1]]) }] });
  }
  if (path === "/v2/payments" && method === "POST") {
    assert.equal(body.source_id, "cnon:card-nonce-ok", "only Square's sandbox test payment is used");
    orders[body.order_id].state = "COMPLETED"; orders[body.order_id].tenders = [{ id: "P_" + body.order_id, payment_id: "P_" + body.order_id }];
    return json({ payment: { id: "P_" + body.order_id, status: "COMPLETED" } });
  }
  if (path === "/v2/refunds" && method === "POST") {
    const o = orders[body.payment_id.slice(2)];
    if (refundKeys[body.idempotency_key]) return json({ refund: { ...refundKeys[body.idempotency_key] } }); // Square's idempotency
    const rf = refundKeys[body.idempotency_key] = { id: "R" + (++refundSeq), status: refundStatus, amount_money: body.amount_money };
    (o.refunds = o.refunds || []).push(rf);
    return json({ refund: { ...rf } });
  }
  if ((m = /^\/v2\/orders\/([A-Z_0-9]+)$/.exec(path))) return json({ order: orders[m[1]] });
  return json({ errors: [{ code: "NOT_FOUND" }] }, 404);
};
let mails = [], clock = Date.UTC(2026, 9, 31, 12);
const call = (path, { method = "GET", body, token, ip = "1.1.1.1", e = env } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), e, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function signIn(email, ip) {
  mails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(mails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const purchases = async (t) => (await (await call("/relay/my/purchases", { token: t })).json()).purchases;
const alice = await signIn("alice@example.com", "5.5.5.5");
const bob = await signIn("bob@example.com", "6.6.6.6");
const carol = await signIn("carol@example.com", "7.7.7.7");

// 1. Importing orders links each one to the email Square has for it (customer profile, else payment receipt email).
squareCalls = []; dbCalls = 0;
const r1 = await importLocation(env, { id: "LOC1", currency: "GBP" }, "2026-09-01T00:00:00Z", fetchImpl);
assert.equal(r1.orders, 3); assert.equal(r1.linked, 2);
assert.ok(dbCalls <= 12, "orders are saved in batches, not one call per row (" + dbCalls + " database calls)");
const a = await purchases(alice);
assert.equal(a.length, 1); assert.equal(a[0].id, "square:sandbox:order:O_ALICE");
assert.equal(a[0].store, "Relay Demo Store");
assert.equal(a[0].items[0].variantId, "TEE-M", "the exact size bought is kept");
assert.equal(a[0].items[0].productId, "TEE", "and which product it is");
assert.equal(a[0].items[0].variant, "Medium"); assert.equal(a[0].items[0].imageUrl, "https://img.test/tee.jpg");
const b = await purchases(bob);
assert.equal(b.length, 1); assert.equal(b[0].id, "square:sandbox:order:O_BOB");
assert.equal((await purchases(carol)).length, 0, "nobody else sees these orders");
// Someone else's order looks exactly like a missing one.
assert.equal((await call("/relay/my/purchases/square:sandbox:order:O_ALICE", { token: bob })).status, 404);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM retailer_order_emails").get().n, 2);
assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM retailer_order_emails").all()).includes("@"), "only a keyed hash of the email is stored");
console.log("1 ok: orders linked to their owners, size/colour kept");

// 2. A second import doesn't ask Square about the same orders again (the order with no email is remembered too).
squareCalls = [];
const r2 = await importLocation(env, { id: "LOC1", currency: "GBP" }, "2026-09-01T00:00:00Z", fetchImpl);
assert.deepEqual(squareCalls, ["POST /v2/orders/search"], "no repeat customer/payment lookups: " + squareCalls.join(", "));
assert.equal(r2.linked, 0);
console.log("2 ok: no repeat lookups");

// 3. If Square fails while looking up an email, the order is asked about again next time (not marked as having no email).
sqlite.exec("DELETE FROM retailer_order_emails WHERE order_id = 'square:sandbox:order:O_BOB'");
fail = "/v2/payments/P_BOB";
await importLocation(env, { id: "LOC1", currency: "GBP" }, "2026-09-01T00:00:00Z", fetchImpl);
assert.equal((await purchases(bob)).length, 0);
fail = null;
await importLocation(env, { id: "LOC1", currency: "GBP" }, "2026-09-01T00:00:00Z", fetchImpl);
assert.equal((await purchases(bob)).length, 1, "linked on the next run");
console.log("3 ok: failed lookups retried");

// 4. Test orders: the list offers items from the test shop, swappable ones first.
const items = (await (await call("/relay/my/testing/square-items", { token: carol })).json()).items;
assert.equal(items[0].product, "Organic T-shirt"); assert.equal(items[0].swappable, true);
assert.equal(items.find(i => i.product === "Mug").swappable, false);
assert.equal((await call("/relay/my/testing/square-items")).status, 401, "signed-in shoppers only");

console.log("4 ok: test items listed");

// 5. Placing a test order: under the shopper's own email, paid with Square's sandbox test payment, straight into their wallet.
squareCalls = [];
const placed = await (await call("/relay/my/testing/square-order", { method: "POST", token: carol, body: { variationId: "TEE-L" } })).json();
assert.equal(placed.ok, true, JSON.stringify(placed));
assert.equal(customers.C_NEW2 ? customers.C_NEW2.email_address : Object.values(customers).at(-1).email_address, "carol@example.com");
const c = await purchases(carol);
assert.equal(c.length, 1); assert.equal(c[0].items[0].variant, "Large"); assert.equal(c[0].status, "COMPLETED");
assert.equal((await purchases(alice)).length, 1, "it isn't in anyone else's wallet");
// Not something from outside the test shop.
assert.equal((await call("/relay/my/testing/square-order", { method: "POST", token: carol, body: { variationId: "NOPE" } })).status, 400);
console.log("5 ok: test order placed and shown only to its owner");

// 6. At most 5 test orders a day per shopper.
for (let i = 0; i < 4; i++) assert.equal((await call("/relay/my/testing/square-order", { method: "POST", token: carol, body: { variationId: "MUG-1" } })).status, 200);
assert.equal((await call("/relay/my/testing/square-order", { method: "POST", token: carol, body: { variationId: "MUG-1" } })).status, 429);
assert.equal((await call("/relay/my/testing/square-order", { method: "POST", token: alice, body: { variationId: "MUG-1" } })).status, 200, "the limit is per shopper");
console.log("6 ok: daily limit");

// 7. Never on live Square.
const live = { ...env, SQUARE_ENVIRONMENT: "production" };
assert.equal((await call("/relay/my/testing/square-items", { token: carol, e: live })).status, 404);
assert.equal((await call("/relay/my/testing/square-order", { method: "POST", token: carol, e: live, body: { variationId: "TEE-L" } })).status, 404);
console.log("7 ok: test orders are off on live Square");

// 8. Square refusing the order gives a clear error and saves nothing.
const before = sqlite.prepare("SELECT COUNT(*) AS n FROM retailer_orders").get().n;
fail = "/v2/orders";
const bad = await call("/relay/my/testing/square-order", { method: "POST", token: bob, body: { variationId: "TEE-M" } });
assert.equal(bad.status, 502); fail = null;
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM retailer_orders").get().n, before);
console.log("8 ok: Square errors handled");

// ---- Returns ---------------------------------------------------------------------------------------------------------
const { syncSquareRefunds } = await import("../worker/square-orders.js");
// 9. A Square item can be returned: a Relay reference, the shop emailed at its Square address, and no Royal Mail label.
let ca = (await purchases(carol)).find(p => p.items[0].variant === "Large");
assert.equal(ca.items[0].returnable, true, "a recent Square item can be returned");
assert.equal(ca.testOrder, true);
mails = [];
const started = await call("/relay/my/return", { method: "POST", token: carol, body: { orderId: ca.id, lineId: ca.items[0].lineId, reason: "wrong_size" } });
const sb = await started.json();
assert.equal(started.status, 200, JSON.stringify(sb));
assert.match(sb.returnRef, /^RLY-/); assert.equal(sb.labelAvailable, false); assert.equal(sb.inStore, true); assert.equal(sb.shopNotified, true);
assert.equal(mails.length, 1); assert.deepEqual(mails[0].to, ["owner@demostore.test"]);
assert.ok(mails[0].text.includes(sb.returnRef) && mails[0].text.includes("Wrong size"));
assert.ok(!mails[0].text.includes("carol@"), "the shopper's email isn't sent to the shop");
ca = (await purchases(carol)).find(p => p.id === ca.id);
assert.equal(ca.items[0].returnable, false); assert.equal(ca.items[0].returnInfo.status, "requested");
assert.equal((await call("/relay/my/return", { method: "POST", token: carol, body: { orderId: ca.id, lineId: ca.items[0].lineId } })).status, 409, "not twice");
assert.equal((await call("/relay/my/return", { method: "POST", token: bob, body: { orderId: ca.id, lineId: ca.items[0].lineId } })).status, 404, "not someone else's");
console.log("9 ok: Square return started, shop emailed");

// 10. Nothing is marked refunded until Square has a completed refund.
let sync = await syncSquareRefunds(env, fetchImpl);
assert.equal(sync.refunded, 0);
assert.equal((await purchases(carol)).find(p => p.id === ca.id).items[0].returnInfo.status, "requested");
// The test shop refunds it (test orders only, only the owner, only with a return started).
assert.equal((await call("/relay/my/testing/square-refund", { method: "POST", token: bob, body: { orderId: ca.id, lineId: ca.items[0].lineId } })).status, 404);
refundStatus = "PENDING";
let tr = await (await call("/relay/my/testing/square-refund", { method: "POST", token: carol, body: { orderId: ca.id, lineId: ca.items[0].lineId } })).json();
assert.equal(tr.refunded, false, "a pending refund isn't shown as refunded");
assert.equal((await purchases(carol)).find(p => p.id === ca.id).items[0].returnInfo.status, "requested");
Object.values(orders).flatMap(o => o.refunds || []).forEach(r => { r.status = "COMPLETED"; }); refundStatus = "COMPLETED";
tr = await (await call("/relay/my/testing/square-refund", { method: "POST", token: carol, body: { orderId: ca.id, lineId: ca.items[0].lineId } })).json();
assert.equal(tr.refunded, true, JSON.stringify(tr)); assert.equal(tr.amountMinor, 2500);
assert.equal(orders[ca.id.split(":").pop()].refunds.length, 1, "pressing again doesn't refund twice");
const ri = (await purchases(carol)).find(p => p.id === ca.id).items[0].returnInfo;
assert.equal(ri.status, "refunded"); assert.equal(ri.refundMinor, 2500);
assert.equal((await call("/relay/my/testing/square-refund", { method: "POST", token: carol, body: { orderId: ca.id, lineId: ca.items[0].lineId } })).status, 409, "not refunded twice");
console.log("10 ok: refund shown only once Square completed it");

// 11. A real shop's refund (not a test order) is picked up by the hourly check; the test refund tool won't touch real orders.
const al = (await purchases(alice)).find(p => p.id === "square:sandbox:order:O_ALICE");
assert.equal((await call("/relay/my/return", { method: "POST", token: alice, body: { orderId: al.id, lineId: "L1", reason: "faulty" } })).status, 200);
assert.equal((await call("/relay/my/testing/square-refund", { method: "POST", token: alice, body: { orderId: al.id, lineId: "L1" } })).status, 404);
orders.O_ALICE.refunds = [{ id: "RX", status: "PENDING", amount_money: { amount: 2500, currency: "GBP" } }];
assert.equal((await syncSquareRefunds(env, fetchImpl)).refunded, 0, "a pending refund doesn't count");
orders.O_ALICE.refunds[0].status = "APPROVED";
assert.equal((await syncSquareRefunds(env, fetchImpl)).refunded, 1);
assert.equal((await purchases(alice)).find(p => p.id === al.id).items[0].returnInfo.status, "refunded");
// A partial refund smaller than the item doesn't mark it refunded.
const mug = (await purchases(alice)).find(p => p.items[0].variantId === "MUG-1");
assert.equal((await call("/relay/my/return", { method: "POST", token: alice, body: { orderId: mug.id, lineId: mug.items[0].lineId } })).status, 200);
orders[mug.id.split(":").pop()].refunds = [{ id: "RP", status: "COMPLETED", amount_money: { amount: 300, currency: "GBP" } }];
assert.equal((await syncSquareRefunds(env, fetchImpl)).refunded, 0);
console.log("11 ok: real shop refunds picked up; partial refunds not counted");

// ---- Swaps -------------------------------------------------------------------------------------------------------------
const dan = await signIn("dan@example.com", "8.8.8.8"), eve = await signIn("eve@example.com", "9.9.9.9"), fay = await signIn("fay@example.com", "10.10.10.10");
const testBuy = async (t) => { const r = await (await call("/relay/my/testing/square-order", { method: "POST", token: t, body: { variationId: "TEE-M" } })).json(); assert.equal(r.ok, true); return r.orderId; };
const lineOf = async (t, id) => (await purchases(t)).find(p => p.id === id).items[0];
const optionsOf = async (t, id, line) => (await (await call("/relay/my/exchange/options?orderId=" + encodeURIComponent(id) + "&lineId=" + line, { token: t })).json());
const swap = (t, id, line, key, agreed) => call("/relay/my/exchange", { method: "POST", token: t, body: { orderId: id, lineId: line, variantKey: "square:sandbox:variant:" + key, agreedDiffMinor: agreed } });

// 12. Options: the other sizes of the same product, with the price difference.
const dOrder = await testBuy(dan);
let dl = await lineOf(dan, dOrder);
assert.equal(dl.exchangeable, true);
const opts = await optionsOf(dan, dOrder, dl.lineId);
assert.deepEqual(opts.options.map(x => [x.title, x.priceDiffMinor, x.available]).sort(), [["Extra large", 500, true], ["Large", 0, true], ["Small", -500, true]]);
assert.equal((await optionsOf(bob, dOrder, dl.lineId)).error, "not_your_order");
console.log("12 ok: swap options listed");

// 13. Same price: a new £0 order at the shop for the new size, closed straight away; the shop is told.
mails = []; payCalls = [];
let sw = await swap(dan, dOrder, dl.lineId, "TEE-L", 0);
let swb = await sw.json();
assert.equal(sw.status, 200, JSON.stringify(swb)); assert.equal(swb.exchanged, true); assert.equal(payCalls.length, 1);
const newOrd = orders[payCalls[0]];
assert.equal(newOrd.total_money.amount, 0); assert.equal(newOrd.line_items[0].catalog_object_id, "TEE-L"); assert.equal(newOrd.state, "COMPLETED");
assert.equal(mails.length, 1); assert.ok(mails[0].text.includes("Medium → Large") || mails[0].text.includes("(Medium) → Large"), mails[0].text);
dl = await lineOf(dan, dOrder);
assert.equal(dl.exchange.status, "done"); assert.equal(dl.variant, "Large"); assert.equal(dl.exchangeable, false); assert.equal(dl.returnable, false);
assert.equal((await swap(dan, dOrder, dl.lineId, "TEE-S", -500)).status, 409, "only one swap per item");
assert.equal((await call("/relay/my/return", { method: "POST", token: dan, body: { orderId: dOrder, lineId: dl.lineId } })).status, 409, "no return after a swap");
console.log("13 ok: same-price swap");

// 14. Dearer: Square's payment page for the difference; done only once Square says it's paid.
const eOrder = await testBuy(eve), el1 = (await lineOf(eve, eOrder)).lineId;
assert.equal((await swap(eve, eOrder, el1, "TEE-XL", 0)).status, 409, "the shopper must agree the difference");
sw = await swap(eve, eOrder, el1, "TEE-XL", 500); swb = await sw.json();
assert.equal(sw.status, 200, JSON.stringify(swb)); assert.equal(swb.awaitingPayment, true); assert.match(swb.payUrl, /^https:\/\/sandbox\.square\.link\//);
const linkOrder = orders[swb.payUrl.split("/").pop()];
assert.equal(linkOrder.total_money.amount, 500, "credited with the £25 already paid, £5 left to pay");
let el = await lineOf(eve, eOrder);
assert.equal(el.exchange.status, "awaiting_payment"); assert.equal(el.exchange.balance.owedMinor, 500); assert.equal(el.exchange.balance.paid, false);
assert.equal(el.exchange.balance.payUrl, swb.payUrl); assert.equal(el.variant, "Medium", "still the old size until paid");
assert.equal((await call("/relay/my/return", { method: "POST", token: eve, body: { orderId: eOrder, lineId: el1 } })).status, 409);
linkOrder.tenders = [{ id: "PX", payment_id: "PX" }]; linkOrder.net_amount_due_money.amount = 0; linkOrder.state = "COMPLETED";
el = await lineOf(eve, eOrder);
assert.equal(el.exchange.status, "done"); assert.equal(el.exchange.balance.paid, true); assert.equal(el.variant, "Extra large"); assert.equal(el.priceMinor, 3000);
console.log("14 ok: dearer swap paid on Square's page");

// 15. Cheaper: £0 new order, and the difference refunded at Square to the original payment.
const fOrder = await testBuy(fay), fl = (await lineOf(fay, fOrder)).lineId;
sw = await swap(fay, fOrder, fl, "TEE-S", -500); swb = await sw.json();
assert.equal(sw.status, 200, JSON.stringify(swb)); assert.equal(swb.refunded, true);
assert.deepEqual(orders[fOrder.split(":").pop()].refunds.map(r => r.amount_money.amount), [500]);
console.log("15 ok: cheaper swap refunds the difference");

// 16. Live stock is checked at Square at the moment of the swap.
const gil = await signIn("gil@example.com", "11.11.11.11");
const gOrder = await testBuy(gil), gl = (await lineOf(gil, gOrder)).lineId;
stock["TEE-L"] = 0;
assert.equal((await swap(gil, gOrder, gl, "TEE-L", 0)).status, 409);
stock["TEE-L"] = 5;
console.log("16 ok: sold-out sizes refused");
console.log("All Square order tests passed");
