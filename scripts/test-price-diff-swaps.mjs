// Offline test: saving a card (Stripe TEST MODE) and swapping to a dearer or cheaper size/colour.
// Stripe and Shopify are stand-ins; nothing leaves this machine and no money moves anywhere.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleExchangeRoute } from "../worker/exchange.js";
import { handleCardRoute, paymentsEnabled } from "../worker/payments.js";
import { emailHash } from "../worker/auth.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
}
const db = { prepare: sql => stmt(sql) };
const SECRET = "unit-test-auth-secret-0123456789";
const TEST_KEYS = { STRIPE_SECRET_KEY: "sk_test_1234567890abcdef", STRIPE_PUBLISHABLE_KEY: "pk_test_1234567890abcdef" };
const envOff = { RELAY_DB: db, AUTH_SECRET: SECRET };
const env = { RELAY_DB: db, AUTH_SECRET: SECRET, ...TEST_KEYS };

// Payments only ever switch on with Stripe TEST keys.
assert.equal(paymentsEnabled(envOff), false);
assert.equal(paymentsEnabled(env), true);
assert.equal(paymentsEnabled({ STRIPE_SECRET_KEY: "sk_live_1234567890abcdef", STRIPE_PUBLISHABLE_KEY: "pk_live_1234567890abcdef" }), false, "live keys never switch it on");
assert.equal(paymentsEnabled({ STRIPE_SECRET_KEY: "sk_live_1234567890abcdef", STRIPE_PUBLISHABLE_KEY: "pk_test_1234567890abcdef" }), false);

// Catalogue: a cap in Black £20 (bought), Navy £20, Large £25 (dearer), Kids £15 (cheaper).
sqlite.exec(`ALTER TABLE retailer_catalog_items ADD COLUMN store_label TEXT; ALTER TABLE retailer_catalog_items ADD COLUMN image_url TEXT;
  CREATE TABLE IF NOT EXISTS retailer_order_emails (order_id TEXT PRIMARY KEY, email_hash TEXT NOT NULL, created_at INTEGER NOT NULL);`);
const SHOP = "kick-lane.myshopify.com", conn = "shopify:" + SHOP, item = conn + ":item:gid://shopify/Product/1";
sqlite.prepare("INSERT INTO retailer_catalog_items (id, provider, external_item_id, title, store_label) VALUES (?,?,?,?,?)").run(item, conn, "gid://shopify/Product/1", "Logo Cap", "Kick Lane");
sqlite.prepare("INSERT OR IGNORE INTO retailer_connections (id, provider, merchant_external_id) VALUES (?,?,?)").run(conn, "shopify", SHOP);
for (const [vid, title, price, qty] of [[11, "Black", 2000, 3], [12, "Navy", 2000, 5], [14, "Large", 2500, 4], [15, "Kids", 1500, 4]]) {
  const key = conn + ":variant:gid://shopify/ProductVariant/" + vid;
  sqlite.prepare("INSERT INTO retailer_catalog_variants (id, item_id, external_variant_id, title, sku, price_minor, currency) VALUES (?,?,?,?,?,?,?)").run(key, item, "gid://shopify/ProductVariant/" + vid, title, "CAP-" + vid, price, "GBP");
  sqlite.prepare("INSERT INTO retailer_inventory_snapshots (variant_id, connection_id, quantity, inventory_state) VALUES (?,?,?,?)").run(key, conn, qty, "AGGREGATE");
}
const alice = { id: "alice-id", emailHash: await emailHash(SECRET, "alice@example.com") };
const order = (ext, qty = 1) => {
  const id = conn + ":order:" + ext;
  sqlite.prepare("INSERT INTO retailer_orders (id, connection_id, external_order_id, ordered_at, amount_minor, currency, payment_processor, status, raw_identifier_keys) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, conn, String(ext), "2026-10-29T11:00:00Z", 2000 * qty, "GBP", "shopify", "unverified", "[]");
  sqlite.prepare("INSERT INTO retailer_order_emails (order_id, email_hash, created_at) VALUES (?,?,?)").run(id, alice.emailHash, 1);
  sqlite.prepare("INSERT INTO order_items (id, order_id, external_line_item_id, product_id, variant_id, title, quantity, price_minor, currency) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id + ":item:9" + ext, id, "9" + ext, "1", "11", "Logo Cap", qty, 2000, "GBP");
  return id;
};
const oDear = order(600), oFail = order(601), oDecline = order(602), oCheap = order(603), oTwo = order(604, 2);

// Stand-ins for Stripe and Shopify.
let stripeCalls = [], shopifyCalls = [], piStatus = "requires_capture", refuseAdd = false, siCustomer = null;
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.stripe.com/v1/")) {
    assert.equal(init.headers.Authorization, "Bearer " + TEST_KEYS.STRIPE_SECRET_KEY);
    const path = url.slice("https://api.stripe.com/v1/".length), body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    stripeCalls.push({ method: init.method, path, body, idem: init.headers["Idempotency-Key"] || null });
    const ok = (o) => Response.json(o);
    if (path === "customers") return ok({ id: "cus_alice0001" });
    if (path === "setup_intents") return ok({ id: "seti_new000001", client_secret: "seti_new000001_secret_x" });
    if (path.startsWith("setup_intents/seti_")) return ok({ id: path.split("/")[1], status: "succeeded", customer: siCustomer, payment_method: "pm_card0000001" });
    if (path === "payment_methods/pm_card0000001") return ok({ id: "pm_card0000001", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030, wallet: { type: "apple_pay" } } });
    if (/^payment_methods\/.+\/detach$/.test(path)) return ok({});
    if (path === "payment_intents") {
      if (piStatus === "error") return Response.json({ error: { message: "Your card was declined.", code: "card_declined" } }, { status: 402 });
      return ok({ id: "pi_" + stripeCalls.length.toString().padStart(8, "0"), status: piStatus });
    }
    if (/^payment_intents\/.+\/(capture|cancel)$/.test(path)) return ok({});
    throw Error("unexpected Stripe call " + path);
  }
  assert.equal(url, "https://" + SHOP + "/admin/api/2026-07/graphql.json");
  const { query, variables } = JSON.parse(init.body); shopifyCalls.push({ query, variables });
  const ok = (data) => Response.json({ data });
  if (/RelayExchangeCheck/.test(query)) return ok({ order: { cancelledAt: null, displayFulfillmentStatus: "UNFULFILLED" }, productVariant: { inventoryQuantity: 4, title: "x" } });
  if (/orderEditBegin/.test(query)) return ok({ orderEditBegin: { calculatedOrder: { id: "gid://shopify/CalculatedOrder/1", lineItems: { nodes: [{ id: "gid://shopify/CalculatedLineItem/1", quantity: 1, variant: { id: "gid://shopify/ProductVariant/11" } }] } }, userErrors: [] } });
  if (/orderEditSetQuantity/.test(query)) return ok({ orderEditSetQuantity: { userErrors: [] } });
  if (/orderEditAddVariant/.test(query)) return ok({ orderEditAddVariant: { calculatedLineItem: { id: "gid://shopify/CalculatedLineItem/NEW" }, userErrors: refuseAdd ? [{ message: "Variant is not available" }] : [] } });
  if (/orderEditAddLineItemDiscount/.test(query)) return ok({ orderEditAddLineItemDiscount: { userErrors: [] } });
  if (/orderEditCommit/.test(query)) return ok({ orderEditCommit: { order: { id: "gid://shopify/Order/1" }, userErrors: [] } });
  throw Error("unexpected Shopify query");
};
const o = { now: 1_800_000_000_000, fetchImpl, listStores: async () => [{ domain: SHOP, token: "tok", label: "Kick Lane" }] };
const req = (path, body) => new Request("https://w.test" + path, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } });
const swapCall = async (e, path, body) => { const r = await handleExchangeRoute(req(path, body), e, new URL("https://w.test" + path), {}, alice, o); return { status: r.status, body: await r.json() }; };
const cardCall = async (e, path, body) => { const r = await handleCardRoute(req(path, body), e, new URL("https://w.test" + path), {}, alice, o); return { status: r.status, body: await r.json() }; };
const opts = async (e, orderId) => (await swapCall(e, "/relay/my/exchange/options?orderId=" + encodeURIComponent(orderId) + "&lineId=9" + orderId.split(":").pop())).body;
const V = (n) => conn + ":variant:gid://shopify/ProductVariant/" + n;

// 1. Payments off: dearer options say so, card routes refuse, nothing reaches Stripe.
let x = await opts(envOff, oDear);
assert.deepEqual(x.options.map(v => [v.title, v.available, v.reason]), [["Kids", true, null], ["Large", false, "Costs £5.00 more (not available yet)"], ["Navy", true, null]]);
assert.equal((await cardCall(envOff, "/relay/my/card")).body.enabled, false);
assert.equal((await cardCall(envOff, "/relay/my/card/setup", {})).status, 503);
assert.equal(stripeCalls.length, 0);

// 2. Test mode on, no card yet: the dearer option asks for a card.
x = await opts(env, oDear);
assert.deepEqual(x.options.find(v => v.title === "Large"), { key: V(14), title: "Large", priceMinor: 2500, quantity: 4, priceDiffMinor: 500, available: false,
  reason: "Costs £5.00 more: add a card to pay the difference", needsCard: true });
assert.equal((await swapCall(env, "/relay/my/exchange", { orderId: oDear, lineId: "9600", variantKey: V(14), agreedDiffMinor: 500 })).body.error, "card_needed");

// 3. Saving a card with the £0.00 check.
let c = await cardCall(env, "/relay/my/card");
assert.deepEqual([c.body.enabled, c.body.testMode, c.body.publishableKey, c.body.card], [true, true, TEST_KEYS.STRIPE_PUBLISHABLE_KEY, null]);
c = await cardCall(env, "/relay/my/card/setup", {});
assert.equal(c.status, 200); assert.equal(c.body.clientSecret, "seti_new000001_secret_x");
assert.deepEqual(stripeCalls.map(s => s.path), ["customers", "setup_intents"]);
assert.equal(stripeCalls[0].body["metadata[relay_shopper]"], "alice-id"); assert.equal(stripeCalls[0].body.email, undefined, "no email sent to Stripe");
assert.deepEqual([stripeCalls[1].body.usage, stripeCalls[1].body["payment_method_types[]"]], ["off_session", "card"]);
// A check that belongs to someone else's Stripe customer is refused.
siCustomer = "cus_someone_else";
assert.equal((await cardCall(env, "/relay/my/card/confirm", { setupIntentId: "seti_new000001" })).status, 409);
siCustomer = "cus_alice0001";
c = await cardCall(env, "/relay/my/card/confirm", { setupIntentId: "seti_new000001" });
assert.equal(c.status, 200);
assert.deepEqual(c.body.card, { brand: "visa", last4: "4242", wallet: "apple_pay", expMonth: 12, expYear: 2030, testMode: true });
assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT * FROM relay_cards").all()), /4242 4242|cvc|number/i, "no card number stored");

// 4. Dearer swap: hold → edit order with a £5 discount on the new item → take. Relay owes the shop £5.
x = await opts(env, oDear);
assert.equal(x.options.find(v => v.title === "Large").available, true);
assert.deepEqual(x.card, { brand: "visa", last4: "4242", wallet: "apple_pay" });
let r = await swapCall(env, "/relay/my/exchange", { orderId: oDear, lineId: "9600", variantKey: V(14) });
assert.equal(r.status, 409); assert.equal(r.body.error, "price_changed", "must agree the difference first");
stripeCalls = []; shopifyCalls = [];
r = await swapCall(env, "/relay/my/exchange", { orderId: oDear, lineId: "9600", variantKey: V(14), agreedDiffMinor: 500 });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.paid, true); assert.equal(r.body.priceDiffMinor, 500);
assert.match(r.body.message, /£5\.00 was taken from your card \(test mode, no real money\)/);
const pi = stripeCalls.find(s => s.path === "payment_intents");
assert.deepEqual([pi.body.amount, pi.body.currency, pi.body.capture_method, pi.body.off_session, pi.body.confirm, pi.body.customer, pi.body.payment_method],
  ["500", "gbp", "manual", "true", "true", "cus_alice0001", "pm_card0000001"]);
assert.ok(pi.idem && pi.idem.startsWith("relay-swap-"));
const order_ = stripeCalls.map(s => s.path.replace(/pi_\d+/, "pi"));
assert.deepEqual(order_, ["payment_intents", "payment_intents/pi/capture"], "hold first, take after the order changed");
const disc = shopifyCalls.find(s => /orderEditAddLineItemDiscount/.test(s.query));
assert.deepEqual([disc.variables.line, disc.variables.d.fixedValue], ["gid://shopify/CalculatedLineItem/NEW", { amount: "5.00", currencyCode: "GBP" }]);
const note = shopifyCalls.find(s => /orderEditCommit/.test(s.query)).variables.note;
assert.match(note, /paid the £5\.00 difference through Relay \(Stripe TEST MODE, no real money; ref pi_/); assert.match(note, /Relay owes the shop £5\.00/);
let pay = sqlite.prepare("SELECT status, amount_minor, owed_to_shop, test_mode, shop FROM relay_swap_payments WHERE order_id = ?").get(oDear);
assert.deepEqual({ ...pay }, { status: "taken", amount_minor: 500, owed_to_shop: 500, test_mode: 1, shop: SHOP });

// 5. Shopify refuses the edit after the hold: the hold is cancelled and nothing is owed.
refuseAdd = true; stripeCalls = [];
r = await swapCall(env, "/relay/my/exchange", { orderId: oFail, lineId: "9601", variantKey: V(14), agreedDiffMinor: 500 });
assert.equal(r.status, 502);
assert.deepEqual(stripeCalls.map(s => s.path.replace(/pi_\d+/, "pi")), ["payment_intents", "payment_intents/pi/cancel"]);
pay = sqlite.prepare("SELECT status, owed_to_shop FROM relay_swap_payments WHERE order_id = ?").get(oFail);
assert.deepEqual({ ...pay }, { status: "released", owed_to_shop: 0 });
refuseAdd = false;

// 6. Card declined: the order is never touched.
piStatus = "error"; shopifyCalls = [];
r = await swapCall(env, "/relay/my/exchange", { orderId: oDecline, lineId: "9602", variantKey: V(14), agreedDiffMinor: 500 });
assert.equal(r.status, 402); assert.equal(r.body.error, "card_declined");
assert.equal(shopifyCalls.filter(s => /orderEdit/.test(s.query)).length, 0);
piStatus = "requires_capture";

// 7. Cheaper swap: no card needed, nothing charged, the shop is asked (in the order note) to refund £5.
stripeCalls = []; shopifyCalls = [];
r = await swapCall(env, "/relay/my/exchange", { orderId: oCheap, lineId: "9603", variantKey: V(15), agreedDiffMinor: -500 });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(stripeCalls.length, 0); assert.equal(r.body.paid, null);
assert.match(r.body.message, /Kick Lane will refund the £5\.00 difference to how you paid/);
assert.match(shopifyCalls.find(s => /orderEditCommit/.test(s.query)).variables.note, /Please refund the customer £5\.00/);
assert.equal(shopifyCalls.filter(s => /orderEditAddLineItemDiscount/.test(s.query)).length, 0);

// 8. Two of the same item: a different price isn't offered (only for a single item).
x = await opts(env, oTwo);
assert.deepEqual(x.options.filter(v => v.priceDiffMinor !== 0).map(v => [v.title, v.available, v.reason]),
  [["Kids", false, "Different price (only for a single item)"], ["Large", false, "Different price (only for a single item)"]]);

// 9. Removing the card detaches it at Stripe and forgets it here.
stripeCalls = [];
c = await cardCall(env, "/relay/my/card/remove", {});
assert.equal(c.body.card, null);
assert.deepEqual(stripeCalls.map(s => s.path), ["payment_methods/pm_card0000001/detach"]);
assert.equal((await cardCall(env, "/relay/my/card")).body.card, null);

// 10. Deleting the Relay account forgets the card (and detaches it at Stripe); swap payment records stay as money owed.
await cardCall(env, "/relay/my/card/setup", {}); await cardCall(env, "/relay/my/card/confirm", { setupIntentId: "seti_new000001" });
stripeCalls = [];
const { forgetCard } = await import("../worker/payments.js");
await forgetCard(env, "alice-id", o);
assert.deepEqual(stripeCalls.map(s => s.path), ["payment_methods/pm_card0000001/detach"]);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM relay_cards WHERE shopper_id = 'alice-id'").get().n, 0);
assert.equal(sqlite.prepare("SELECT owed_to_shop FROM relay_swap_payments WHERE order_id = ?").get(oDear).owed_to_shop, 500);

console.log("price-difference swaps: all checks passed");
