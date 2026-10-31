// Offline tests: how customers pay a price difference (through the shop's Shopify checkout, or instantly by card into the
// shop's own Stripe account via Stripe Connect), and returns that the shop refunds in Shopify.
// Stripe and Shopify are stand-ins; nothing leaves this machine and no money moves anywhere.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleExchangeRoute, enrichPurchases } from "../worker/exchange.js";
import { handleRetailerRoute, issueRetailerKey } from "../worker/retailer.js";
import { stripeReturnPage, shopPay } from "../worker/shop-payments.js";
import { recordShopRefund, recordBalancePaid } from "../worker/shopify-webhooks.js";
import { ensureReturnsTables } from "../worker/returns.js";
import { emailHash } from "../worker/auth.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
}
const db = { prepare: sql => stmt(sql) };
const SECRET = "unit-test-auth-secret-0123456789";
const KEYS = { STRIPE_SECRET_KEY: "sk_test_1234567890abcdef", STRIPE_PUBLISHABLE_KEY: "pk_test_1234567890abcdef" };
const envOff = { RELAY_DB: db, AUTH_SECRET: SECRET };
const env = { RELAY_DB: db, AUTH_SECRET: SECRET, ...KEYS };

// A cap in Black £20 (bought), Large £25 (dearer).
sqlite.exec(`ALTER TABLE retailer_catalog_items ADD COLUMN store_label TEXT; ALTER TABLE retailer_catalog_items ADD COLUMN image_url TEXT;
  CREATE TABLE IF NOT EXISTS retailer_order_emails (order_id TEXT PRIMARY KEY, email_hash TEXT NOT NULL, created_at INTEGER NOT NULL);`);
const SHOP = "kick-lane.myshopify.com", conn = "shopify:" + SHOP, item = conn + ":item:gid://shopify/Product/1";
sqlite.prepare("INSERT INTO retailer_catalog_items (id, provider, external_item_id, title, store_label) VALUES (?,?,?,?,?)").run(item, conn, "gid://shopify/Product/1", "Logo Cap", "Kick Lane");
sqlite.prepare("INSERT OR IGNORE INTO retailer_connections (id, provider, merchant_external_id) VALUES (?,?,?)").run(conn, "shopify", SHOP);
for (const [vid, title, price] of [[11, "Black", 2000], [14, "Large", 2500]]) {
  const key = conn + ":variant:gid://shopify/ProductVariant/" + vid;
  sqlite.prepare("INSERT INTO retailer_catalog_variants (id, item_id, external_variant_id, title, sku, price_minor, currency) VALUES (?,?,?,?,?,?,?)").run(key, item, "gid://shopify/ProductVariant/" + vid, title, "CAP-" + vid, price, "GBP");
  sqlite.prepare("INSERT INTO retailer_inventory_snapshots (variant_id, connection_id, quantity, inventory_state) VALUES (?,?,?,?)").run(key, conn, 4, "AGGREGATE");
}
const alice = { id: "alice-id", emailHash: await emailHash(SECRET, "alice@example.com") };
const order = (ext) => {
  const id = conn + ":order:" + ext;
  sqlite.prepare("INSERT INTO retailer_orders (id, connection_id, external_order_id, ordered_at, amount_minor, currency, payment_processor, status, raw_identifier_keys) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, conn, String(ext), new Date(Date.now() - 864e5).toISOString(), 2000, "GBP", "shopify", "unverified", "[]");
  sqlite.prepare("INSERT INTO retailer_order_emails (order_id, email_hash, created_at) VALUES (?,?,?)").run(id, alice.emailHash, 1);
  sqlite.prepare("INSERT INTO order_items (id, order_id, external_line_item_id, product_id, variant_id, title, quantity, price_minor, currency) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id + ":item:9" + ext, id, "9" + ext, "1", "11", "Logo Cap", 1, 2000, "GBP");
  return id;
};
const V = (n) => conn + ":variant:gid://shopify/ProductVariant/" + n;

let stripeCalls = [], shopifyCalls = [], payLink = "https://kick-lane.myshopify.com/1234/invoices/abc", acctReady = false, balanceLeft = "5.00", finStatus = "PARTIALLY_PAID";
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.stripe.com/v1/")) {
    const path = url.slice("https://api.stripe.com/v1/".length), body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    stripeCalls.push({ method: init.method, path, body, idem: init.headers["Idempotency-Key"] || null });
    if (path === "accounts" && init.method === "POST") return Response.json({ id: "acct_kicklane0001" });
    if (path === "accounts/acct_kicklane0001") return Response.json({ id: "acct_kicklane0001", charges_enabled: acctReady, details_submitted: acctReady });
    if (path === "account_links") return Response.json({ url: "https://connect.stripe.com/setup/s/abc123" });
    throw Error("unexpected Stripe call " + path);
  }
  const { query, variables } = JSON.parse(init.body); shopifyCalls.push({ query, variables });
  const ok = (data) => Response.json({ data });
  if (/RelayExchangeCheck/.test(query)) return ok({ order: { cancelledAt: null, displayFulfillmentStatus: "UNFULFILLED" }, productVariant: { inventoryQuantity: 4, title: "x" } });
  if (/orderEditBegin/.test(query)) return ok({ orderEditBegin: { calculatedOrder: { id: "gid://shopify/CalculatedOrder/1", lineItems: { nodes: [{ id: "gid://shopify/CalculatedLineItem/1", quantity: 1, variant: { id: "gid://shopify/ProductVariant/11" } }] } }, userErrors: [] } });
  if (/orderEditSetQuantity/.test(query)) return ok({ orderEditSetQuantity: { userErrors: [] } });
  if (/orderEditAddVariant/.test(query)) return ok({ orderEditAddVariant: { calculatedLineItem: { id: "gid://shopify/CalculatedLineItem/NEW" }, userErrors: [] } });
  if (/orderEditCommit/.test(query)) return ok({ orderEditCommit: { order: { id: "gid://shopify/Order/1" }, userErrors: [] } });
  if (/RelayBalance/.test(query)) return ok({ order: { displayFinancialStatus: finStatus, totalOutstandingSet: { shopMoney: { amount: balanceLeft } }, paymentCollectionDetails: { additionalPaymentCollectionUrl: balanceLeft === "0.00" ? null : payLink } } });
  throw Error("unexpected Shopify query " + query.slice(0, 40));
};
const o = { now: 1_800_000_000_000, fetchImpl, listStores: async () => [{ domain: SHOP, token: "tok", label: "Kick Lane" }] };
const req = (path, body, headers = {}) => new Request("https://w.test" + path, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json", ...headers } });
const swap = async (e, path, body) => { const r = await handleExchangeRoute(req(path, body), e, new URL("https://w.test" + path), {}, alice, o); return { status: r.status, body: await r.json() }; };

// 1. Default: the difference is paid through the shop's own Shopify checkout. No card, no Stripe, and it works without Relay's Stripe keys.
assert.deepEqual(await shopPay(envOff, SHOP), { method: "shopify", stripeAccount: null });
const o1 = order(700);
let x = (await swap(envOff, "/relay/my/exchange/options?orderId=" + encodeURIComponent(o1) + "&lineId=9700")).body;
assert.equal(x.payBy, "shopify");
assert.deepEqual(x.options.map(v => [v.title, v.available, v.payBy, v.needsCard]), [["Large", true, "shopify", false]]);
let r = await swap(envOff, "/relay/my/exchange", { orderId: o1, lineId: "9700", variantKey: V(14), agreedDiffMinor: 500 });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.deepEqual([r.body.payBy, r.body.paid, r.body.payUrl], ["shopify", null, payLink]);
assert.match(r.body.message, /Pay the £5\.00 difference to Kick Lane to finish\. Use the button below, or the link in Kick Lane's email\. You can pay however Kick Lane accepts\./);
assert.equal(stripeCalls.length, 0, "nothing goes to Stripe");
assert.equal(shopifyCalls.filter(c => /orderEditAddLineItemDiscount/.test(c.query)).length, 0, "no discount: the order shows the extra to pay");
const commit = shopifyCalls.find(c => /orderEditCommit/.test(c.query)).variables;
assert.equal(commit.notify, true, "Shopify emails the customer the payment link");
assert.match(commit.note, /Shopify has asked the customer to pay the £5\.00 balance\. Please don't send it until it's paid\./);
assert.equal(sqlite.prepare("SELECT detail FROM relay_exchanges WHERE order_id = ? AND status = 'done'").get(o1).detail, "shopify balance 500");
// No link from Shopify: the customer is pointed to the shop's email instead.
payLink = null; shopifyCalls = [];
const o2 = order(701);
r = await swap(envOff, "/relay/my/exchange", { orderId: o2, lineId: "9701", variantKey: V(14), agreedDiffMinor: 500 });
assert.equal(r.status, 200); assert.equal(r.body.payUrl, null);
assert.match(r.body.message, /Kick Lane has emailed you a link to pay it\./);
payLink = "https://kick-lane.myshopify.com/1234/invoices/abc";
console.log("PASS price difference paid through the shop's Shopify checkout (any payment method)");

// 2. The shop's settings: switching to instant card payments needs Relay's Stripe keys and a ready Stripe account of the shop's own.
const key = await issueRetailerKey(env, { provider: "shopify", shopRef: SHOP, storeLabel: "Kick Lane" });
const sq = await issueRetailerKey(env, { provider: "square", shopRef: "MZARA1", storeLabel: "Zara" });
const shopCall = async (e, k, method, path, body) => {
  const url = new URL("https://relay.test" + path);
  const res = await handleRetailerRoute(new Request(url, { method, headers: { Authorization: "Bearer " + k }, body: body ? JSON.stringify(body) : undefined }), e, url, {}, { fetchImpl });
  return { status: res.status, body: await res.json() };
};
let s = await shopCall(envOff, key, "GET", "/relay/retailer/payments");
assert.deepEqual(s.body, { method: "shopify", cardPossible: false, testMode: false, stripe: { connected: false, ready: false, detailsSubmitted: false } });
assert.equal((await shopCall(envOff, key, "POST", "/relay/retailer/payments", { method: "card" })).body.error, "cards_not_available");
assert.equal((await shopCall(envOff, key, "POST", "/relay/retailer/payments/stripe", {})).body.error, "cards_not_available");
assert.equal((await shopCall(env, sq, "GET", "/relay/retailer/payments")).body.error, "shopify_only");
assert.equal((await shopCall(env, key, "POST", "/relay/retailer/payments", { method: "card" })).body.error, "stripe_not_ready");
assert.equal((await shopCall(env, key, "POST", "/relay/retailer/payments", { method: "bitcoin" })).body.error, "bad_method");
// Connect Stripe: a Standard account for the shop, then Stripe's own set-up page.
stripeCalls = [];
s = await shopCall(env, key, "POST", "/relay/retailer/payments/stripe", {});
assert.equal(s.status, 200); assert.equal(s.body.url, "https://connect.stripe.com/setup/s/abc123");
const acc = stripeCalls.find(c => c.path === "accounts");
assert.deepEqual([acc.body.type, acc.body.country, acc.body["metadata[relay_shop]"], acc.idem], ["standard", "GB", SHOP, "relay-connect-" + SHOP]);
const link = stripeCalls.find(c => c.path === "account_links");
assert.deepEqual([link.body.account, link.body.type, link.body.return_url, link.body.refresh_url],
  ["acct_kicklane0001", "account_onboarding", "https://relay.test/relay/stripe/return", "https://relay.test/relay/stripe/return?again=1"]);
// Asking again re-uses the same account.
stripeCalls = [];
await shopCall(env, key, "POST", "/relay/retailer/payments/stripe", {});
assert.deepEqual(stripeCalls.map(c => c.path), ["account_links"]);
// Not finished at Stripe yet: still can't switch to card.
s = await shopCall(env, key, "GET", "/relay/retailer/payments");
assert.deepEqual(s.body.stripe, { connected: true, ready: false, detailsSubmitted: false });
assert.equal((await shopCall(env, key, "POST", "/relay/retailer/payments", { method: "card" })).body.error, "stripe_not_ready");
// Stripe says the account can take payments: card can be switched on, and swaps then pay into acct_kicklane0001.
acctReady = true;
s = await shopCall(env, key, "GET", "/relay/retailer/payments");
assert.deepEqual(s.body.stripe, { connected: true, ready: true, detailsSubmitted: true });
s = await shopCall(env, key, "POST", "/relay/retailer/payments", { method: "card" });
assert.equal(s.status, 200); assert.equal(s.body.method, "card");
assert.deepEqual(await shopPay(env, SHOP), { method: "card", stripeAccount: "acct_kicklane0001" });
// Relay's Stripe keys removed: falls back to Shopify checkout rather than failing.
assert.deepEqual(await shopPay(envOff, SHOP), { method: "shopify", stripeAccount: null });
// Stripe later disables the account: back to Shopify checkout.
acctReady = false;
s = await shopCall(env, key, "GET", "/relay/retailer/payments");
assert.equal(s.body.method, "shopify"); assert.equal(s.body.stripe.ready, false);
// Disconnect forgets the account.
acctReady = true; await shopCall(env, key, "GET", "/relay/retailer/payments");
s = await shopCall(env, key, "POST", "/relay/retailer/payments/stripe/remove", {});
assert.deepEqual([s.body.method, s.body.stripe.connected], ["shopify", false]);
assert.equal(sqlite.prepare("SELECT stripe_account FROM relay_shop_pay WHERE shop = ?").get(SHOP).stripe_account, null);
// The page Stripe sends the shop back to says nothing was changed and can't be framed.
const page = stripeReturnPage(new URL("https://relay.test/relay/stripe/return"));
assert.equal(page.headers.get("x-frame-options"), "DENY");
assert.match(await page.text(), /Close this tab and go back to Relay/);
assert.match(await stripeReturnPage(new URL("https://relay.test/relay/stripe/return?again=1")).text(), /That Stripe link has expired/);
console.log("PASS shop chooses Shopify checkout or instant card; card needs its own ready Stripe account");

// 3. The shop refunds a return in Shopify: the Relay return shows as refunded, with the amount.
await ensureReturnsTables(db);
const o3 = order(702);
sqlite.prepare("INSERT INTO relay_returns (id, shopper_id, order_id, line_id, shop, item_title, quantity, price_minor, reason, return_ref, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
  .run("ret-1", "alice-id", o3, "9702", SHOP, "Logo Cap", 1, 2000, "wrong_size", "RLY-AAAA-BBBB", "requested", 1);
let purchases = await enrichPurchases(env, [{ id: o3, retailer: conn, orderedAt: new Date().toISOString(), items: [{ lineId: "9702", productId: "1", variantId: "11", title: "Logo Cap" }] }]);
assert.deepEqual(purchases[0].items[0].returnInfo, { status: "requested", ref: "RLY-AAAA-BBBB", trackingNumber: null, refundMinor: null, refundedAt: null });
assert.equal(purchases[0].items[0].exchangeable, false, "an item being returned can't also be swapped");
assert.equal((await swap(env, "/relay/my/exchange", { orderId: o3, lineId: "9702", variantKey: V(14), agreedDiffMinor: 500 })).body.error, "already_returned");
// Someone else's line on the same order, and a different order: untouched.
let res = await recordShopRefund(env, SHOP, { order_id: 702, refund_line_items: [{ line_item_id: 9702, quantity: 1, subtotal: "20.00", subtotal_set: { shop_money: { amount: "20.00" } } }],
  transactions: [{ kind: "refund", status: "success", amount: "20.00" }] }, 1_800_000_500_000);
assert.deepEqual(res, { returns: 1, swaps: 0 });
assert.deepEqual({ ...sqlite.prepare("SELECT status, refund_minor, refund_issued_at FROM relay_returns WHERE id = 'ret-1'").get() }, { status: "refunded", refund_minor: 2000, refund_issued_at: 1_800_000_500_000 });
purchases = await enrichPurchases(env, [{ id: o3, retailer: conn, orderedAt: new Date().toISOString(), items: [{ lineId: "9702", productId: "1", variantId: "11", title: "Logo Cap" }] }]);
assert.deepEqual(purchases[0].items[0].returnInfo, { status: "refunded", ref: "RLY-AAAA-BBBB", trackingNumber: null, refundMinor: 2000, refundedAt: 1_800_000_500_000 });
// A refund on an order line with no Relay return changes nothing; nor does a malformed one.
assert.deepEqual(await recordShopRefund(env, SHOP, { order_id: 999, refund_line_items: [{ line_item_id: 1, subtotal: "5.00" }] }), { returns: 0, swaps: 0 });
assert.deepEqual(await recordShopRefund(env, SHOP, { order_id: "x' OR 1=1" }), { returns: 0, swaps: 0 });
// 4. The shop refunds a cheaper swap's difference by hand: the swap shows as refunded (same amount, no items).
const o4 = order(703);
sqlite.prepare("INSERT INTO relay_exchanges (id, shopper_id, order_id, line_id, shop, from_variant, from_title, to_variant, to_title, quantity, status, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run("ex-1", "alice-id", o4, "9703", SHOP, "a", "Black", "b", "Kids", 1, "done", "shop to refund 500", 1);
assert.deepEqual(await recordShopRefund(env, SHOP, { order_id: 703, refund_line_items: [], transactions: [{ kind: "refund", status: "success", amount: "4.00" }] }), { returns: 0, swaps: 0 }, "a different amount isn't matched");
assert.deepEqual(await recordShopRefund(env, SHOP, { order_id: 703, refund_line_items: [], transactions: [{ kind: "refund", status: "success", amount: "5.00" }] }), { returns: 0, swaps: 1 });
assert.equal(sqlite.prepare("SELECT detail FROM relay_exchanges WHERE id = 'ex-1'").get().detail, "refunded 500");
console.log("PASS refunds made in Shopify show on Relay returns and cheaper swaps");

// 5. After a swap paid through Shopify: the app shows what's still to pay (with Shopify's link) until Shopify says it's paid.
const line = (oid, lid) => [{ id: oid, retailer: conn, store: "Kick Lane", orderedAt: new Date().toISOString(), items: [{ lineId: lid, productId: "1", variantId: "11", title: "Logo Cap" }] }];
shopifyCalls = [];
let ex = (await enrichPurchases(env, line(o1, "9700"), o))[0].items[0].exchange;
assert.deepEqual(ex.balance, { owedMinor: 500, paid: false, payUrl: payLink });
assert.equal(ex.detail, undefined, "nothing internal sent to the app"); assert.equal(ex.id, undefined);
assert.equal(shopifyCalls.filter(c => /RelayBalance/.test(c.query))[0].variables.id, "gid://shopify/Order/700");
// Shopify can't be reached: still owed, no link, nothing changed.
ex = (await enrichPurchases(env, line(o1, "9700"), { ...o, fetchImpl: async () => new Response("down", { status: 503 }) }))[0].items[0].exchange;
assert.deepEqual(ex.balance, { owedMinor: 500, paid: false, payUrl: null });
// Cancelled or voided order: nothing outstanding but not paid either, so not marked paid.
balanceLeft = "0.00"; finStatus = "VOIDED";
assert.equal((await enrichPurchases(env, line(o1, "9700"), o))[0].items[0].exchange.balance.paid, false);
// Paid: marked once, then no more Shopify calls for it.
finStatus = "PAID";
assert.equal((await enrichPurchases(env, line(o1, "9700"), o))[0].items[0].exchange.balance.paid, true);
assert.equal(sqlite.prepare("SELECT detail FROM relay_exchanges WHERE order_id = ? AND status = 'done'").get(o1).detail, "shopify paid 500");
shopifyCalls = [];
assert.deepEqual((await enrichPurchases(env, line(o1, "9700"), o))[0].items[0].exchange.balance, { owedMinor: 500, paid: true, payUrl: null });
assert.equal(shopifyCalls.length, 0);
// Shopify's "order paid" notification marks it too (only when fully paid; never another order's swap).
assert.equal(await recordBalancePaid(env, SHOP, { id: 701, financial_status: "partially_paid" }), 0);
assert.equal(await recordBalancePaid(env, SHOP, { id: 701, financial_status: "paid", total_outstanding: "5.00" }), 0);
assert.equal(await recordBalancePaid(env, SHOP, { id: "701; DROP TABLE relay_exchanges", financial_status: "paid" }), 0);
assert.equal(await recordBalancePaid(env, "other-shop.myshopify.com", { id: 701, financial_status: "paid" }), 0);
assert.equal(await recordBalancePaid(env, SHOP, { id: 701, financial_status: "paid", total_outstanding: "0.00" }), 1);
assert.equal(sqlite.prepare("SELECT detail FROM relay_exchanges WHERE order_id = ? AND status = 'done'").get(o2).detail, "shopify paid 500");
assert.equal(await recordBalancePaid(env, SHOP, { id: 701, financial_status: "paid" }), 0, "already marked");
balanceLeft = "5.00"; finStatus = "PARTIALLY_PAID";
console.log("PASS balance paid through Shopify: shown until paid, then marked paid (by Shopify's notification or a check)");

// After a swap the card shows the new item's price (Large £25 instead of Black £20); nothing internal is sent.
const after = (await enrichPurchases(env, [{ id: o1, retailer: conn, store: "Kick Lane", orderedAt: new Date().toISOString(), items: [{ lineId: "9700", productId: "1", variantId: "11", title: "Logo Cap", priceMinor: 2000 }] }], o))[0].items[0];
assert.equal(after.priceMinor, 2500); assert.equal(after.exchange.fromPriceMinor, 2000); assert.equal(after.exchange.toVariant, undefined);
console.log("PASS swapped item shows its new price");

// 6. The app and dashboard words.
const app = readFileSync("account.js", "utf8"), dash = readFileSync("retailer.html", "utf8");
assert.match(app, /will update your order and send you a link to pay the/);
assert.match(app, /"Pay " \+ absPounds\(d\) \+ " to " \+ shop \+ " →"/);
assert.match(app, /✓ Refunded/);
assert.match(app, /" still to pay " \+ shopName \+ " for the swap"/);
assert.match(app, /" difference paid to " \+ shopName/);
assert.match(dash, /Through your Shopify checkout<\/b> \(recommended\)/);
assert.match(dash, /Works with every payment method you accept/);
console.log("shop payments: all checks passed");
