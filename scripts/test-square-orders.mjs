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
  ('square:sandbox:variant:MUG-1','square:sandbox:item:MUG','MUG-1','Regular',900,'GBP')`);

// ---- Fake Square --------------------------------------------------------------------------------------------------
const LOC = { id: "LOC1", name: "Relay Demo Store", status: "ACTIVE", currency: "GBP" };
const customers = { C_ALICE: { id: "C_ALICE", email_address: "Alice@Example.com" } };
const payments = { P_BOB: { id: "P_BOB", buyer_email_address: "bob@example.com" } };
const order = (id, extra) => ({ id, location_id: "LOC1", created_at: "2026-10-30T10:00:00Z", state: "COMPLETED", total_money: { amount: 2500, currency: "GBP" },
  line_items: [{ uid: "L1", name: "Organic T-shirt", catalog_object_id: "TEE-M", quantity: "1", base_price_money: { amount: 2500, currency: "GBP" } }], ...extra });
const orders = {
  O_ALICE: order("O_ALICE", { customer_id: "C_ALICE" }),                    // email on the customer profile
  O_BOB: order("O_BOB", { tenders: [{ payment_id: "P_BOB" }] }),            // email only on the payment
  O_NOBODY: order("O_NOBODY", { tenders: [{ payment_id: "P_NONE" }] })      // no email anywhere
};
payments.P_NONE = { id: "P_NONE" };
let squareCalls = [], fail = null;
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
  if (path === "/v2/orders/search") return json({ orders: Object.values(orders) });
  let m;
  if ((m = /^\/v2\/customers\/([A-Z_0-9]+)$/.exec(path)) && method === "GET") return customers[m[1]] ? json({ customer: customers[m[1]] }) : json({ errors: [{ code: "NOT_FOUND" }] }, 404);
  if ((m = /^\/v2\/payments\/([A-Z_0-9]+)$/.exec(path)) && method === "GET") return payments[m[1]] ? json({ payment: payments[m[1]] }) : json({ errors: [{ code: "NOT_FOUND" }] }, 404);
  if (path === "/v2/customers/search") return json({ customers: Object.values(customers).filter(c => c.email_address.toLowerCase() === body.query.filter.email_address.exact) });
  if (path === "/v2/customers" && method === "POST") { const c = { id: "C_NEW" + Object.keys(customers).length, email_address: body.email_address }; customers[c.id] = c; return json({ customer: c }); }
  if (path === "/v2/orders" && method === "POST") {
    const line = body.order.line_items[0], v = { "TEE-M": 2500, "TEE-L": 2500, "MUG-1": 900 }[line.catalog_object_id];
    const id = "O_TEST" + Object.keys(orders).length;
    orders[id] = { id, location_id: body.order.location_id, customer_id: body.order.customer_id, created_at: "2026-10-31T12:00:00Z", state: "OPEN",
      total_money: { amount: v, currency: "GBP" }, line_items: [{ uid: "T1", name: "Item", catalog_object_id: line.catalog_object_id, quantity: "1", base_price_money: { amount: v, currency: "GBP" } }] };
    return json({ order: orders[id] });
  }
  if (path === "/v2/payments" && method === "POST") {
    assert.equal(body.source_id, "cnon:card-nonce-ok", "only Square's sandbox test payment is used");
    orders[body.order_id].state = "COMPLETED"; orders[body.order_id].tenders = [{ payment_id: "P_T" }];
    return json({ payment: { id: "P_T", status: "COMPLETED" } });
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
console.log("All Square order tests passed");
