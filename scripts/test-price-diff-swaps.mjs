// Offline test: saving a card (Stripe TEST MODE) and swapping to a dearer or cheaper size/colour.
// Stripe and Shopify are stand-ins; nothing leaves this machine and no money moves anywhere.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { ensureShopPlanTable } from "../worker/shopify.js";
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
// Paying a swap's difference by card through Relay moves only Stripe's test money, so it exists only at Relay's own test
// shops (Shopify development stores). This shop is one. (Review E-2; the real-shop case is at the end.)
await ensureShopPlanTable(db);
sqlite.prepare("INSERT INTO shopify_shop_plan (domain, test_shop, plan, checked_at) VALUES (?, 1, 'partner_test', 0)").run(SHOP);
const oDear = order(600), oFail = order(601), oDecline = order(602), oCheap = order(603), oTwo = order(604, 2), oCheap2 = order(605);

// Stand-ins for Stripe and Shopify.
let stripeCalls = [], shopifyCalls = [], piStatus = "requires_capture", refuseAdd = false, siCustomer = null, refundAllowed = true, liveLine = null;
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
    if (path === "accounts/acct_kicklane0001") return ok({ id: "acct_kicklane0001", charges_enabled: true, details_submitted: true });
    throw Error("unexpected Stripe call " + path);
  }
  assert.equal(url, "https://" + SHOP + "/admin/api/2026-07/graphql.json");
  const { query, variables } = JSON.parse(init.body); shopifyCalls.push({ query, variables });
  const ok = (data) => Response.json({ data });
  if (/RelayExchangeCheck/.test(query)) return ok({ order: { cancelledAt: null, displayFulfillmentStatus: "UNFULFILLED", ...(liveLine ? { lineItems: { nodes: [liveLine] } } : {}) }, productVariant: { inventoryQuantity: 4, title: "x" } });
  if (/orderEditBegin/.test(query)) return ok({ orderEditBegin: { calculatedOrder: { id: "gid://shopify/CalculatedOrder/1", lineItems: { nodes: [{ id: "gid://shopify/CalculatedLineItem/1", quantity: 1, variant: { id: "gid://shopify/ProductVariant/11" } }, { id: "gid://shopify/CalculatedLineItem/2", quantity: 1, variant: { id: "gid://shopify/ProductVariant/14" } }] } }, userErrors: [] } });
  if (/orderEditSetQuantity/.test(query)) return ok({ orderEditSetQuantity: { userErrors: [] } });
  if (/orderEditAddVariant/.test(query)) return ok({ orderEditAddVariant: { calculatedLineItem: { id: "gid://shopify/CalculatedLineItem/NEW" }, userErrors: refuseAdd ? [{ message: "Variant is not available" }] : [] } });
  if (/orderEditAddLineItemDiscount/.test(query)) return ok({ orderEditAddLineItemDiscount: { userErrors: [] } });
  if (/orderEditCommit/.test(query)) return ok({ orderEditCommit: { order: { id: "gid://shopify/Order/1" }, userErrors: [] } });
  if (/RelayTx/.test(query)) return ok({ order: { transactions: [{ id: "gid://shopify/OrderTransaction/77", kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", amountSet: { shopMoney: { amount: "20.00" } } }] } });
  if (/refundCreate/.test(query)) return refundAllowed ? ok({ refundCreate: { refund: { id: "gid://shopify/Refund/9" }, userErrors: [] } })
    : Response.json({ errors: [{ message: "Access denied for refundCreate field. Required access: `write_orders` access scope." }] });
  throw Error("unexpected Shopify query");
};
const o = { now: 1_800_000_000_000, fetchImpl, listStores: async () => [{ domain: SHOP, token: "tok", label: "Kick Lane" }] };
const req = (path, body) => new Request("https://w.test" + path, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } });
const swapCall = async (e, path, body) => { const r = await handleExchangeRoute(req(path, body), e, new URL("https://w.test" + path), {}, alice, o); return { status: r.status, body: await r.json() }; };
const cardCall = async (e, path, body) => { const r = await handleCardRoute(req(path, body), e, new URL("https://w.test" + path), {}, alice, o); return { status: r.status, body: await r.json() }; };
const opts = async (e, orderId) => (await swapCall(e, "/relay/my/exchange/options?orderId=" + encodeURIComponent(orderId) + "&lineId=9" + orderId.split(":").pop())).body;
const V = (n) => conn + ":variant:gid://shopify/ProductVariant/" + n;

// 1. Card payments off: the dearer option is paid through the shop's Shopify checkout instead; card routes refuse; nothing reaches Stripe.
let x = await opts(envOff, oDear);
assert.deepEqual(x.options.map(v => [v.title, v.available, v.reason, v.payBy]), [["Kids", true, null, null], ["Large", true, null, "shopify"], ["Navy", true, null, null]]);
assert.equal(x.payBy, "shopify");
assert.equal((await cardCall(envOff, "/relay/my/card")).body.enabled, false);
assert.equal((await cardCall(envOff, "/relay/my/card/setup", {})).status, 503);
assert.equal(stripeCalls.length, 0);

// The shop chose instant card payments and connected its own Stripe account (shop-payments.js; tested in test-shop-payments.mjs).
sqlite.prepare("INSERT INTO relay_shop_pay (shop, method, stripe_account, stripe_ready, updated_at) VALUES (?,?,?,?,?)").run(SHOP, "card", "acct_kicklane0001", 1, 1);

// 2. Test mode on, no card yet: the dearer option asks for a card.
x = await opts(env, oDear);
assert.deepEqual(x.options.find(v => v.title === "Large"), { key: V(14), title: "Large", priceMinor: 2500, quantity: 4, priceDiffMinor: 500, available: false,
  reason: "Costs £5.00 more: add a card to pay the difference", needsCard: true, payBy: "card" });
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

// 4. Dearer swap: hold → edit order with a £5 discount on the new item → take. Stripe pays it into the shop's own account.
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
assert.deepEqual([pi.body["transfer_data[destination]"], pi.body.on_behalf_of], ["acct_kicklane0001", "acct_kicklane0001"], "paid straight to the shop's Stripe account");
const order_ = stripeCalls.map(s => s.path.replace(/pi_\d+/, "pi"));
assert.deepEqual(order_, ["payment_intents", "payment_intents/pi/capture"], "hold first, take after the order changed");
const disc = shopifyCalls.find(s => /orderEditAddLineItemDiscount/.test(s.query));
assert.deepEqual([disc.variables.line, disc.variables.d.fixedValue], ["gid://shopify/CalculatedLineItem/NEW", { amount: "5.00", currencyCode: "GBP" }]);
const note = shopifyCalls.find(s => /orderEditCommit/.test(s.query)).variables.note;
assert.match(note, /paid the £5\.00 difference by card through Relay \(Stripe TEST MODE, no real money; ref pi_/); assert.match(note, /paid into your Stripe account/);
assert.equal(shopifyCalls.find(s => /orderEditCommit/.test(s.query)).variables.notify, false, "nothing for Shopify to collect");
let pay = sqlite.prepare("SELECT status, amount_minor, owed_to_shop, test_mode, shop, destination FROM relay_swap_payments WHERE order_id = ?").get(oDear);
assert.deepEqual({ ...pay }, { status: "taken", amount_minor: 500, owed_to_shop: 0, test_mode: 1, shop: SHOP, destination: "acct_kicklane0001" });
assert.equal(sqlite.prepare("SELECT detail FROM relay_exchanges WHERE order_id = ? AND status = 'done'").get(oDear).detail, "paid to shop 500");

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

// 7. Cheaper swap: no card needed, nothing charged; Relay refunds £5 in Shopify to the customer's original payment.
stripeCalls = []; shopifyCalls = [];
r = await swapCall(env, "/relay/my/exchange", { orderId: oCheap, lineId: "9603", variantKey: V(15), agreedDiffMinor: -500 });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(stripeCalls.length, 0); assert.equal(r.body.paid, null); assert.equal(r.body.refunded, true);
assert.match(r.body.message, /Kick Lane has refunded the £5\.00 difference to how you paid/);
assert.equal(shopifyCalls.filter(s => /orderEditAddLineItemDiscount/.test(s.query)).length, 0);
const ref = shopifyCalls.find(s => /refundCreate/.test(s.query));
assert.match(ref.query, /@idempotent\(key: "relay-refund-[0-9a-f-]{36}"\)/);
assert.deepEqual(ref.variables.input.transactions, [{ orderId: "gid://shopify/Order/603", parentId: "gid://shopify/OrderTransaction/77", kind: "REFUND", gateway: "shopify_payments", amount: "5.00" }]);
assert.equal(ref.variables.input.notify, true);
assert.equal(sqlite.prepare("SELECT detail FROM relay_exchanges WHERE order_id = ? AND status = 'done'").get(oCheap).detail, "refunded 500");
// The shop hasn't given Relay permission to refund: the swap still happens, and the shop is asked to refund by hand.
refundAllowed = false; shopifyCalls = [];
r = await swapCall(env, "/relay/my/exchange", { orderId: oCheap2, lineId: "9605", variantKey: V(15), agreedDiffMinor: -500 });
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.refunded, false);
// (Review E-1: this used to say "Kick Lane will refund", while the shop's own note said "Relay is refunding": each was
// told the other would do it. Now the shopper is told what really happened, and the shop's note asks it to refund.)
assert.match(r.body.message, /Relay couldn't refund the £5\.00 difference itself, so it has asked Kick Lane to refund it to how you paid\. If it hasn't arrived in a few days, contact Kick Lane\./);
{
  const shopNote = shopifyCalls.find(s => /orderEditCommit/.test(s.query)).variables.note;
  assert.doesNotMatch(shopNote, /Relay is refunding/, "the shop is never told a refund is being made before it has been");
  assert.match(shopNote, /the customer is owed £5\.00\..+If no refund of £5\.00 shows on this order, Relay couldn't make it: please refund the customer £5\.00 yourself\./, "and is asked to refund if Relay's doesn't show");
}
assert.equal(sqlite.prepare("SELECT detail FROM relay_exchanges WHERE order_id = ? AND status = 'done'").get(oCheap2).detail, "shop to refund 500");
refundAllowed = true;

// 8. Two of the same item: a different price isn't offered (only for a single item).
x = await opts(env, oTwo);
assert.deepEqual(x.options.filter(v => v.priceDiffMinor !== 0).map(v => [v.title, v.available, v.reason]),
  [["Kids", false, "Different price (only for a single item)"], ["Large", false, "Different price (only for a single item)"]]);

// 8b. A real shop (and one Relay hasn't checked yet) never gets card mode, even with "card" saved and a ready Stripe
// account: a dearer swap goes through the shop's own Shopify checkout, no test money moves, and the real order isn't discounted.
for (const plan of [0, null]) {
  if (plan === null) sqlite.prepare("DELETE FROM shopify_shop_plan WHERE domain = ?").run(SHOP);
  else sqlite.prepare("UPDATE shopify_shop_plan SET test_shop = 0, plan = 'basic' WHERE domain = ?").run(SHOP);
  const real = order(plan === null ? 611 : 610);
  x = await opts(env, real);
  assert.equal(x.options.find(v => v.title === "Large").payBy, "shopify", "a real shop's dearer swap is paid at the shop");
  stripeCalls = []; shopifyCalls = [];
  r = await swapCall(env, "/relay/my/exchange", { orderId: real, lineId: String(real).endsWith("611") ? "9611" : "9610", variantKey: V(14), agreedDiffMinor: 500 });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.payBy, "shopify");
  assert.equal(stripeCalls.length, 0, "no test money moves for a real shop");
  assert.equal(shopifyCalls.filter(s => /orderEditAddLineItemDiscount/.test(s.query)).length, 0, "and its real order isn't discounted");
  assert.doesNotMatch(r.body.message, /test mode/i);
}
sqlite.prepare("INSERT INTO shopify_shop_plan (domain, test_shop, plan, checked_at) VALUES (?, 1, 'partner_test', 0)").run(SHOP);

// 9. Removing the card detaches it at Stripe and forgets it here.
stripeCalls = [];
c = await cardCall(env, "/relay/my/card/remove", {});
assert.equal(c.body.card, null);
assert.deepEqual(stripeCalls.map(s => s.path), ["payment_methods/pm_card0000001/detach"]);
assert.equal((await cardCall(env, "/relay/my/card")).body.card, null);

// 10. Deleting the Relay account forgets the card (and detaches it at Stripe); swap payment records are kept (no card details in them).
await cardCall(env, "/relay/my/card/setup", {}); await cardCall(env, "/relay/my/card/confirm", { setupIntentId: "seti_new000001" });
stripeCalls = [];
const { forgetCard } = await import("../worker/payments.js");
await forgetCard(env, "alice-id", o);
assert.deepEqual(stripeCalls.map(s => s.path), ["payment_methods/pm_card0000001/detach"]);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM relay_cards WHERE shopper_id = 'alice-id'").get().n, 0);
assert.deepEqual({ ...sqlite.prepare("SELECT status, amount_minor, destination FROM relay_swap_payments WHERE order_id = ?").get(oDear) }, { status: "taken", amount_minor: 500, destination: "acct_kicklane0001" });

// 11. A discounted order (security review M2, 25 Nov 2026): the difference is worked out from what the shopper actually paid
// for the line, never its price before the discount, so Relay never refunds more than was paid. Large is £25; this shopper
// paid £20 for it with a 20% code. Kids is £15: £5 back (not £10).
{
  const id = conn + ":order:620";
  sqlite.prepare("INSERT INTO retailer_orders (id, connection_id, external_order_id, ordered_at, amount_minor, currency, payment_processor, status, raw_identifier_keys) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, conn, "620", "2026-10-29T11:00:00Z", 2000, "GBP", "shopify", "unverified", "[]");
  sqlite.prepare("INSERT INTO retailer_order_emails (order_id, email_hash, created_at) VALUES (?,?,?)").run(id, alice.emailHash, 1);
  // (The swap code makes the column on first use, as it does on Relay's database.)
  await opts(env, oTwo);
  sqlite.prepare("INSERT INTO order_items (id, order_id, external_line_item_id, product_id, variant_id, title, quantity, price_minor, currency, paid_minor) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id + ":item:9620", id, "9620", "1", "14", "Logo Cap", 1, 2500, "GBP", 2000);
  x = await opts(env, id);
  assert.deepEqual(x.options.map(v => [v.title, v.priceDiffMinor]), [["Black", 0], ["Kids", -500], ["Navy", 0]], "against the £20 paid, not the £25 price");
  // Agreeing the old (list-price) difference is refused; the paid one goes through and refunds £5.
  assert.deepEqual((await swapCall(env, "/relay/my/exchange", { orderId: id, lineId: "9620", variantKey: V(15), agreedDiffMinor: -1000 })).body, { error: "price_changed", priceDiffMinor: -500 });
  shopifyCalls = [];
  r = await swapCall(env, "/relay/my/exchange", { orderId: id, lineId: "9620", variantKey: V(15), agreedDiffMinor: -500 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const refund = shopifyCalls.find(q => /refundCreate/.test(q.query));
  assert.equal(refund.variables.input.transactions[0].amount, "5.00", "£5 refunded: what was paid less the new price");
  assert.match(r.body.message, /refunded the £5\.00 difference/);
}
// What Shopify says the line cost now, when it says, comes first: the swap is re-agreed if Relay's copy was different.
{
  const id = conn + ":order:621";
  sqlite.prepare("INSERT INTO retailer_orders (id, connection_id, external_order_id, ordered_at, amount_minor, currency, payment_processor, status, raw_identifier_keys) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, conn, "621", "2026-10-29T11:00:00Z", 2500, "GBP", "shopify", "unverified", "[]");
  sqlite.prepare("INSERT INTO retailer_order_emails (order_id, email_hash, created_at) VALUES (?,?,?)").run(id, alice.emailHash, 1);
  // Relay's copy from before it kept what was paid (no paid_minor): it still shows the £25 price.
  sqlite.prepare("INSERT INTO order_items (id, order_id, external_line_item_id, product_id, variant_id, title, quantity, price_minor, currency) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id + ":item:9621", id, "9621", "1", "14", "Logo Cap", 1, 2500, "GBP");
  liveLine = { id: "gid://shopify/LineItem/9621", quantity: 1, discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: "17.50" } } };
  shopifyCalls = [];
  r = await swapCall(env, "/relay/my/exchange", { orderId: id, lineId: "9621", variantKey: V(15), agreedDiffMinor: -1000 });
  assert.deepEqual(r.body, { error: "price_changed", priceDiffMinor: -250 }, "Shopify says £17.50 was paid: £2.50 back, asked again");
  assert.equal(shopifyCalls.filter(q => /refundCreate|orderEditBegin/.test(q.query)).length, 0, "nothing changed at the shop");
  r = await swapCall(env, "/relay/my/exchange", { orderId: id, lineId: "9621", variantKey: V(15), agreedDiffMinor: -250 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(shopifyCalls.find(q => /refundCreate/.test(q.query)).variables.input.transactions[0].amount, "2.50");
  liveLine = null;
}

console.log("price-difference swaps: all checks passed");
