// Offline test for auctions (worker/auctions.js): prices, starting and cancelling an auction, bidding, the end of an auction,
// the winner's order at the shop, paying, not paying, what shops and shoppers can see, and the 10-minute length only Relay's
// own test shops get. The shop's Shopify and the email service are stand-ins: nothing leaves this machine. Made-up shops,
// people, addresses and products.
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { increment, standing, nextMinimum, publicAuction, orderInput, ensureAuctionTables, placeBid, runAuctions, handleRetailerAuctionRoute,
  handleAuctionPublicRoute, handleAuctionShopperRoute, forgetAuctionBidder, auctionsForExport, DURATIONS, TEST_MINUTES, EXTEND_MS, PAY_HOURS, MAX_LIVE_PER_SHOP } from "../worker/auctions.js";
import { ensureDeliveryTables } from "../worker/delivery.js";
import { ensureShopPlanTable } from "../worker/shopify.js";
import { REVIEW_BLOCKED } from "../worker/review-account.js";
import { checkBody, schemaFor } from "../worker/validate.js";
import { handleRetailerRoute, issueRetailerKey } from "../worker/retailer.js";
import { forgetShopifyShop } from "../worker/shopify-connect.js";

// 1. Prices: proxy bidding, steps, ties and the starting price.
assert.deepEqual([999, 1000, 4999, 5000, 19999, 20000, 99999, 100000].map(increment), [50, 100, 100, 200, 200, 500, 500, 1000]);
assert.deepEqual(standing([], 1000), { leader: null, price: null });
assert.deepEqual(standing([{ shopperId: "a", max: 5000, raisedAt: 1 }], 1000), { leader: "a", price: 1000 }, "one bidder pays the starting price");
assert.deepEqual(standing([{ shopperId: "a", max: 5000, raisedAt: 1 }, { shopperId: "b", max: 3000, raisedAt: 2 }], 1000), { leader: "a", price: 3100 }, "a step above the second maximum");
assert.deepEqual(standing([{ shopperId: "a", max: 3050, raisedAt: 1 }, { shopperId: "b", max: 3000, raisedAt: 2 }], 1000), { leader: "a", price: 3050 }, "never above the leader's own maximum");
assert.deepEqual(standing([{ shopperId: "a", max: 3000, raisedAt: 5 }, { shopperId: "b", max: 3000, raisedAt: 2 }], 1000), { leader: "b", price: 3000 }, "equal maximums: whoever got there first");
assert.deepEqual(standing([{ shopperId: "a", max: 1200, raisedAt: 1 }, { shopperId: "b", max: 1100, raisedAt: 2 }], 1500), { leader: "a", price: 1500 }, "never below the start");
assert.equal(nextMinimum({ price_minor: null, start_minor: 2000 }), 2000);
assert.equal(nextMinimum({ price_minor: 3100, start_minor: 2000 }), 3200);
console.log("ok - prices: the leader pays a step above the second-highest maximum, never more than their own; ties go to the first");

// The stand-in database and services.
const sqlite = new DatabaseSync(":memory:");
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { const x = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(x.changes) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
}
let queue = Promise.resolve();
const db = { prepare: sql => stmt(sql), batch: (list) => (queue = queue.then(async () => { sqlite.exec("BEGIN"); try { for (const s of list) await s.run(); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } })) };
const env = { RELAY_DB: db, RESEND_API_KEY: "stand-in", AUTH_SECRET: "a-test-secret-that-is-long-enough", RELAY_APP_URL: "https://app.relay.test/" };
await ensureAuctionTables(db); await ensureDeliveryTables(db); await ensureShopPlanTable(db);
sqlite.exec(`CREATE TABLE shoppers (id TEXT PRIMARY KEY, email TEXT NOT NULL, email_hash TEXT, created_at INTEGER);
  CREATE TABLE shopify_shops (domain TEXT PRIMARY KEY, label TEXT, scopes TEXT);
  CREATE TABLE retailer_catalog_items (id TEXT PRIMARY KEY, provider TEXT, external_item_id TEXT, title TEXT, description TEXT, store_label TEXT, image_url TEXT);
  CREATE TABLE retailer_catalog_variants (id TEXT PRIMARY KEY, item_id TEXT, external_variant_id TEXT, title TEXT, sku TEXT, price_minor INTEGER, currency TEXT);
  CREATE TABLE retailer_inventory_snapshots (variant_id TEXT, connection_id TEXT, quantity REAL, inventory_state TEXT);`);
const DOMAIN = "hollow-pine.myshopify.com", OTHER = "other-shop.myshopify.com", TESTSHOP = "relay-dev.myshopify.com";
sqlite.prepare("INSERT INTO shopify_shops VALUES (?, 'Hollow Pine', 'read_products,read_orders,write_order_edits,write_orders')").run(DOMAIN);
sqlite.prepare("INSERT INTO shopify_shops VALUES (?, 'Old Connection', 'read_products,read_orders')").run(OTHER);
sqlite.prepare("INSERT INTO shopify_shops VALUES (?, 'Relay Dev', 'read_products,write_orders')").run(TESTSHOP);
sqlite.prepare("INSERT INTO shopify_shop_plan (domain, test_shop, plan, checked_at) VALUES (?, 1, 'partner_test', 0)").run(TESTSHOP);
const item = (domain, n, title, variant, price, cur = "GBP", stock = 4) => {
  const conn = "shopify:" + domain, iid = conn + ":item:gid://shopify/Product/" + n, vid = conn + ":variant:gid://shopify/ProductVariant/" + n;
  sqlite.prepare("INSERT OR IGNORE INTO retailer_catalog_items VALUES (?, ?, ?, ?, NULL, 'Shop', ?)").run(iid, conn, "gid://shopify/Product/" + n, title, "https://cdn.shop.test/" + n + ".jpg");
  sqlite.prepare("INSERT INTO retailer_catalog_variants VALUES (?, ?, ?, ?, NULL, ?, ?)").run(vid, iid, "gid://shopify/ProductVariant/" + n, variant, price, cur);
  sqlite.prepare("INSERT INTO retailer_inventory_snapshots VALUES (?, ?, ?, 'AGGREGATE')").run(vid, conn, stock);
  return vid;
};
const WOOL = item(DOMAIN, 71, "Wool Beanie", "Navy", 2800), TEE = item(DOMAIN, 72, "Field Tee", "Default Title", 3500);
const THEIRS = item(OTHER, 81, "Not Yours", "M", 1000), DEVITEM = item(TESTSHOP, 91, "Test Jacket", "S", 9000);
const people = { a: "ana@example.com", b: "ben@example.com", c: "cat@example.com", d: "dev@example.com" };
for (const [id, email] of Object.entries(people)) sqlite.prepare("INSERT INTO shoppers VALUES (?, ?, NULL, 0)").run(id, email);
const address = (first) => JSON.stringify({ firstName: first, lastName: "Tester", line1: "12 High Street", line2: "Flat 3", town: "London", county: null, postcode: "SW11 1AA", phone: "+447700900456" });
const giveAddress = (id) => sqlite.prepare("INSERT OR REPLACE INTO delivery_details (shopper_id, details, updated_at) VALUES (?, ?, 0)").run(id, address(id.toUpperCase()));
const shop = { provider: "shopify", shop_ref: DOMAIN, store_label: "Hollow Pine" };
let NOW = 1_800_000_000_000;
// The stand-in Shopify and email service.
const calls = { orders: [], cancels: [], states: [], emails: [] };
let shopMode = "ok", paid = new Set(), cancelledAtShop = new Set(), orderNo = 9000;
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/")) { calls.emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  const m = /^https:\/\/([a-z0-9-]+\.myshopify\.com)\/admin\/api\/2026-07\/graphql\.json$/.exec(String(url));
  assert.ok(m, "only the shop's own Shopify is asked: " + url);
  assert.equal(init.headers["X-Shopify-Access-Token"], "shpat_stand_in");
  const q = JSON.parse(init.body);
  if (/orderCreate/.test(q.query)) {
    calls.orders.push({ shop: m[1], ...q.variables });
    if (shopMode === "busy") return new Response("slow down", { status: 429 });
    if (shopMode === "refuse") return Response.json({ data: { orderCreate: { order: null, userErrors: [{ field: ["lineItems"], message: "Not enough stock" }] } } });
    const n = ++orderNo;
    return Response.json({ data: { orderCreate: { order: { id: "gid://shopify/Order/" + n, legacyResourceId: String(n), name: "#" + n,
      paymentCollectionDetails: { additionalPaymentCollectionUrl: "https://" + m[1] + "/pay/" + n } }, userErrors: [] } } });
  }
  if (/RelayAuctionPaid/.test(q.query)) {
    calls.states.push(q.variables.id);
    return Response.json({ data: { order: { displayFinancialStatus: paid.has(q.variables.id) ? "PAID" : "PENDING", cancelledAt: cancelledAtShop.has(q.variables.id) ? "2027-01-01T00:00:00Z" : null,
      paymentCollectionDetails: { additionalPaymentCollectionUrl: "https://" + m[1] + "/pay/again" } } } });
  }
  if (/orderCancel/.test(q.query)) { calls.cancels.push(q.variables); return Response.json({ data: { orderCancel: { orderCancelUserErrors: [] } } }); }
  throw new Error("unexpected Shopify call");
};
const listStores = async () => [DOMAIN, OTHER, TESTSHOP].map(domain => ({ domain, token: "shpat_stand_in", label: domain }));
const O = () => ({ now: NOW, fetchImpl, listStores });
// A tiny real JPEG header, padded: Relay goes by the bytes, not the label.
const jpeg = "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]).toString("base64");
const pngLabelledJpeg = "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(400, 1)]).toString("base64");
const notAPicture = "data:image/jpeg;base64," + Buffer.from("<svg onload=alert(1)>" + "x".repeat(300)).toString("base64");
const tooBig = "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(460 * 1024, 1)]).toString("base64");
const asShop = async (method, path, body, who = shop) => {
  const r = await handleRetailerAuctionRoute(new Request("https://api.relay.test" + path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), env, new URL("https://api.relay.test" + path), {}, who, O());
  return { status: r.status, body: await r.json() };
};
const asShopper = async (who, method, path, body) => {
  const r = await handleAuctionShopperRoute(new Request("https://api.relay.test" + path, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), env, new URL("https://api.relay.test" + path), {}, { id: who, email: people[who] }, O());
  return { status: r.status, body: await r.json() };
};
const anyone = async (path) => {
  const r = await handleAuctionPublicRoute(new Request("https://api.relay.test" + path), env, new URL("https://api.relay.test" + path), {}, { now: NOW });
  return r;
};
const bid = (who, auctionId, maxMinor) => asShopper(who, "POST", "/relay/my/auctions/bid", { auctionId, maxMinor });
const base = { kind: "catalogue", variantKey: WOOL, condition: "new_tags", startMinor: 1000, deliveryMinor: 395, hours: 24, agree: true };
// The same auction with no length given, for asking in minutes instead; and Relay's own test shop.
const { hours: lengthLeftOut, ...noLength } = base;
const devShop = { provider: "shopify", shop_ref: TESTSHOP, store_label: "Relay Dev" };

// 2. Starting auctions: only from the shop's own catalogue or with its own photos; plain errors for everything else.
assert.equal((await asShop("POST", "/relay/retailer/auctions", base, { provider: "square", shop_ref: "M1", store_label: "Sq" })).body.error, "shopify_only");
assert.equal((await asShop("POST", "/relay/retailer/auctions", base, { provider: "shopify", shop_ref: OTHER, store_label: "Old" })).body.error, "needs_order_permission",
  "a shop that hasn't let Relay create orders is asked to first");
for (const [change, error] of [[{ agree: false }, "agree_needed"], [{ kind: "lot" }, "bad_kind"], [{ condition: "mint" }, "bad_condition"], [{ startMinor: 50 }, "bad_start"],
  [{ startMinor: 2000001 }, "bad_start"], [{ deliveryMinor: 6000 }, "bad_delivery"], [{ hours: 2 }, "bad_duration"], [{ variantKey: THEIRS }, "not_your_item"],
  [{ variantKey: WOOL.replace("71", "7x") }, "not_your_item"], [{ photos: [notAPicture] }, "bad_photo"], [{ photos: [tooBig] }, "photo_too_big"],
  [{ kind: "oneoff", title: "Sample coat" }, "photo_needed"], [{ kind: "oneoff", title: "x", photos: [jpeg] }, "title_needed"]])
  assert.equal((await asShop("POST", "/relay/retailer/auctions", { ...base, ...change })).body.error, error, JSON.stringify(change));
const made = await asShop("POST", "/relay/retailer/auctions", { ...base, photos: [jpeg] });
assert.equal(made.status, 200);
const A = made.body.auction;
assert.equal(A.title, "Wool Beanie"); assert.equal(A.variant, "Navy"); assert.equal(A.conditionText, "New with tags"); assert.equal(A.fromCatalogue, true);
assert.deepEqual(A.pictures, ["/relay/auctions/" + A.id + "/photos/1", "https://cdn.shop.test/71.jpg"], "the shop's own photo of this one first, then its catalogue picture");
assert.equal(A.endsAt, NOW + 24 * 3600e3); assert.equal(A.priceMinor, null); assert.equal(A.nextMinor, 1000); assert.equal(A.status, "live");
const oneoff = (await asShop("POST", "/relay/retailer/auctions", { kind: "oneoff", title: "  Sample   wax\tjacket ", size: "M", description: "Worn once at a shoot.\n\n\n\nSmall mark on the cuff.",
  condition: "sample", startMinor: 2500, deliveryMinor: 0, hours: 72, photos: [jpeg, pngLabelledJpeg], agree: true })).body.auction;
assert.equal(oneoff.title, "Sample wax jacket"); assert.equal(oneoff.size, "M"); assert.equal(oneoff.description, "Worn once at a shoot.\n\nSmall mark on the cuff.");
assert.equal(oneoff.pictures.length, 2); assert.equal(oneoff.fromCatalogue, false);
const tee = (await asShop("POST", "/relay/retailer/auctions", { ...base, variantKey: TEE, startMinor: 500, hours: 168 })).body.auction;
assert.equal(tee.variant, null, "Shopify's \"Default Title\" isn't shown as a size");
const dev = (await asShop("POST", "/relay/retailer/auctions", { ...base, variantKey: DEVITEM }, { provider: "shopify", shop_ref: TESTSHOP, store_label: "Relay Dev" })).body.auction;
assert.equal(dev.test, true, "an auction at a development store is marked as a test");
const cat = (await asShop("GET", "/relay/retailer/auctions/catalogue")).body.items;
assert.deepEqual(cat.map(x => x.variantKey), [TEE, WOOL], "the shop's own items in pounds only");
assert.equal(cat[1].stock, 4);
console.log("ok - starting an auction: Shopify shops that let Relay make orders; their own item or a one-off with real photos; each mistake named");

// 3. What anyone sees: live auctions (not test shops' unless the testing tools ask), photos as what they really are.
let r = await anyone("/relay/auctions");
let list = (await r.json()).auctions;
assert.deepEqual(list.map(x => x.id).sort(), [A.id, oneoff.id, tee.id].sort(), "test shops' auctions are left out");
assert.match(r.headers.get("Cache-Control"), /public, max-age=\d+/);
assert.ok((await (await anyone("/relay/auctions?test=1")).json()).auctions.some(x => x.id === dev.id));
assert.equal((await anyone("/relay/auctions/" + dev.id)).status, 404, "a test auction isn't found outside the testing tools");
r = await anyone("/relay/auctions/" + oneoff.id + "/photos/2");
assert.equal(r.status, 200); assert.equal(r.headers.get("Content-Type"), "image/png", "a PNG labelled as a JPEG is served as a PNG");
assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff");
assert.equal((await anyone("/relay/auctions/" + oneoff.id + "/photos/3")).status, 404);
assert.equal((await anyone("/relay/auctions/not-an-id")).status, 404);
console.log("ok - anyone can see live auctions and their photos; test shops' only in the testing tools");

// 4. Bidding.
assert.deepEqual((await bid("a", A.id, 1500)).body, { error: "delivery_details_needed" }, "the shop needs an address to send it to");
for (const id of ["a", "b", "c", "d"]) giveAddress(id);
assert.deepEqual((await bid("a", A.id, 900)).body, { error: "bid_too_low", nextMinor: 1000 });
let x = await bid("a", A.id, 5000);
assert.equal(x.status, 200); assert.equal(x.body.you.leading, true); assert.equal(x.body.auction.priceMinor, 1000, "alone, Ana pays the starting price");
x = await bid("b", A.id, 3000);
assert.equal(x.body.you.leading, false, "Ben is told someone's maximum is higher"); assert.equal(x.body.auction.priceMinor, 3100);
assert.deepEqual((await bid("b", A.id, 3100)).body, { error: "bid_too_low", nextMinor: 3200 });
x = await bid("b", A.id, 6000);
assert.equal(x.body.you.leading, true); assert.equal(x.body.auction.priceMinor, 5200, "now Ben leads, a step above Ana's maximum (steps are £2 from £50)");
x = await bid("c", A.id, 6000);
assert.equal(x.body.you.leading, false, "Cat matched Ben's maximum, but Ben got there first"); assert.equal(x.body.auction.priceMinor, 6000);
assert.deepEqual((await bid("b", A.id, 6000)).body, { error: "bid_not_higher", maxMinor: 6000 });
x = await bid("b", A.id, 8000);
assert.equal(x.body.auction.priceMinor, 6000, "raising your own maximum doesn't raise the price, even out of a tie");
assert.equal(x.body.auction.bids, 5);
const snap = sqlite.prepare("SELECT * FROM auctions WHERE id = ?").get(A.id);
assert.equal(snap.leader_id, "b"); assert.equal(snap.price_minor, 6000);
// A bid in the last two minutes moves the end.
NOW = A.endsAt - 30e3;
x = await bid("a", A.id, 7000);
assert.equal(x.body.auction.endsAt, NOW + EXTEND_MS, "a late bid gives everyone two more minutes");
assert.equal(x.body.auction.priceMinor, 7200, "Ana's 70 pushes Ben's proxy to a step above it");
assert.equal(REVIEW_BLOCKED.has("/relay/my/auctions/bid"), true, "the shared reviewer account can't bid");
// The shop can't cancel once anyone has bid, and another shop can't touch it.
assert.equal((await asShop("POST", "/relay/retailer/auctions/" + A.id + "/cancel")).body.error, "has_bids");
assert.equal((await asShop("POST", "/relay/retailer/auctions/" + tee.id + "/cancel", null, { provider: "shopify", shop_ref: TESTSHOP, store_label: "Relay Dev" })).status, 404);
console.log("ok - bidding: proxy bids, ties to the first, raising your own maximum, two more minutes for late bids, no cancelling once bid on");

// 5. Nobody sees who's bidding: not other shoppers, not anyone, not the shop.
const shopList = (await asShop("GET", "/relay/retailer/auctions")).body;
const everyone = JSON.stringify([shopList, (await (await anyone("/relay/auctions")).json()), (await (await anyone("/relay/auctions/" + A.id)).json())]);
for (const secret of ["ana@", "ben@", "cat@", "\"a\"", "\"b\"", "\"c\"", "leader", "shopper", "maxMinor", "max_minor", "\"you\""]) assert.ok(!everyone.includes(secret), "never shown: " + secret);
assert.ok(!/:8000[,}]/.test(everyone) && !/:7000[,}]/.test(everyone), "nobody's maximum, in any field");
assert.equal(shopList.canOrder, true); assert.deepEqual(shopList.durations, DURATIONS);
assert.ok(!("shortMinutes" in shopList), "a real shop's dashboard is given the four lengths in days and nothing shorter");
const mineB = (await asShopper("b", "GET", "/relay/my/auctions")).body;
assert.equal(mineB.canBid, true);
assert.deepEqual(mineB.auctions.map(y => [y.auction.id, y.you.state, y.you.maxMinor]), [[A.id, "leading", 8000]], "your own maximum, only to you");
assert.equal((await asShopper("a", "GET", "/relay/my/auctions")).body.auctions[0].you.state, "outbid");
console.log("ok - nobody sees who's bidding; each shopper sees only their own maximum");

// 6. The end: the winner's order at the shop, at the winning price, not paid yet; Relay never takes the money.
sqlite.prepare("DELETE FROM delivery_details WHERE shopper_id = 'c'").run(); // Cat removes her address (it matters later)
calls.emails.length = 0;
NOW = A.endsAt + EXTEND_MS + 1000;
let ran = await runAuctions(env, O());
assert.equal(ran.ended, 2, "the Wool Beanie, and the test shop's day-long auction (no bids)"); assert.equal(ran.offered, 1);
assert.equal(calls.orders.length, 1);
const ord = calls.orders[0];
assert.equal(ord.shop, DOMAIN);
assert.equal(ord.order.email, "ben@example.com"); assert.equal(ord.order.financialStatus, "PENDING"); assert.equal(ord.order.currency, "GBP");
assert.deepEqual(ord.order.lineItems, [{ variantId: "gid://shopify/ProductVariant/71", quantity: 1, priceSet: { shopMoney: { amount: "72.00", currencyCode: "GBP" } }, requiresShipping: true }]);
assert.deepEqual(ord.order.shippingLines, [{ title: "Delivery", priceSet: { shopMoney: { amount: "3.95", currencyCode: "GBP" } } }]);
assert.deepEqual(ord.order.shippingAddress, { firstName: "B", lastName: "Tester", address1: "12 High Street", address2: "Flat 3", city: "London", zip: "SW11 1AA", countryCode: "GB", phone: "+447700900456" });
assert.equal(ord.options.inventoryBehaviour, "DECREMENT_OBEYING_POLICY", "takes it from stock, and isn't made if there's none");
assert.equal(ord.options.sendReceipt, false); assert.ok(!("test" in ord.order), "a real shop's order isn't a test");
assert.ok(!("transactions" in ord.order), "no payment is recorded: the winner pays the shop themselves");
assert.equal(calls.emails.length, 1); assert.equal(calls.emails[0].to[0], "ben@example.com"); assert.equal(calls.emails[0].subject, "You won: Wool Beanie");
assert.match(calls.emails[0].text, /Pay Hollow Pine £75\.95 including delivery by .+ at their own checkout/);
assert.match(calls.emails[0].text, /https:\/\/app\.relay\.test\/#open=auction&id=/);
const benView = (await asShopper("b", "GET", "/relay/my/auctions")).body.auctions[0].you;
assert.equal(benView.state, "pay"); assert.equal(benView.priceMinor, 7200); assert.equal(benView.totalMinor, 7595);
assert.equal(benView.payUrl, "https://" + DOMAIN + "/pay/9001"); assert.equal(benView.payBy, NOW + PAY_HOURS * 3600e3);
assert.equal((await asShopper("a", "GET", "/relay/my/auctions")).body.auctions[0].you.state, "not_won");
assert.equal((await asShopper("a", "GET", "/relay/my/auctions")).body.auctions[0].you.payUrl, undefined, "only the winner gets the link to pay");
const shopNow = (await asShop("GET", "/relay/retailer/auctions")).body.auctions.find(y => y.id === A.id);
assert.equal(shopNow.outcome, "awaiting_payment"); assert.equal(shopNow.offers[0].status, "awaiting_payment");
assert.equal(shopNow.offers[0].orderUrl, "https://admin.shopify.com/store/hollow-pine/orders/9001");
assert.equal(shopNow.offers[0].orderName, "#9001");
assert.equal((await bid("a", A.id, 9000)).body.error, "auction_ended");
ran = await runAuctions(env, O());
assert.equal(ran.ended, 0); assert.equal(calls.orders.length, 1, "ended once, ordered once");
console.log("ok - when it ends, the winner's order is made in the shop's Shopify at the winning price plus delivery, unpaid, and the winner is told how to pay");

// 7. Not paid in 24 hours: the order is cancelled (stock goes back), and the next bidder gets it at their own price.
NOW += PAY_HOURS * 3600e3 + 1000;
calls.emails.length = 0;
ran = await runAuctions(env, O());
assert.equal(ran.expired, 1);
assert.deepEqual(calls.cancels, [{ orderId: "gid://shopify/Order/9001", note: "Relay auction: not paid within 24 hours, so it was offered to the next bidder." }]);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_strikes WHERE shopper_id = 'b'").get().n, 1, "an unpaid win counts against Ben");
// Ana is next (her maximum was 70, Cat's 60): she's offered it at a step above Cat, as if Ben had never bid.
const offers = sqlite.prepare("SELECT shopper_id, rank, price_minor, status FROM auction_offers WHERE auction_id = ? ORDER BY rank").all(A.id);
assert.deepEqual(offers.map(y => [y.shopper_id, y.rank, y.price_minor, y.status]), [["b", 1, 7200, "expired"], ["a", 2, 6200, "awaiting_payment"]]);
assert.deepEqual(calls.emails.map(e => [e.to[0], e.subject]), [["ben@example.com", "Time ran out: Wool Beanie"], ["ana@example.com", "Yours if you want it: Wool Beanie"]]);
assert.match(calls.emails[0].text, /wasn't paid for within 24 hours, .+ Not paying for two wins in 90 days stops bidding for 30 days\.$/m, "Ben is told it counts");
assert.equal((await asShopper("a", "GET", "/relay/my/auctions")).body.auctions[0].you.state, "offered");
assert.equal((await asShopper("b", "GET", "/relay/my/auctions")).body.auctions[0].you.state, "expired");
// 8. Ana pays at the shop: Relay notices, and the auction is sold.
paid.add("gid://shopify/Order/9002");
NOW += 5 * 60e3;
ran = await runAuctions(env, O());
assert.equal(ran.paid, 1);
assert.equal((await asShopper("a", "GET", "/relay/my/auctions")).body.auctions[0].you.state, "paid");
assert.equal((await (await anyone("/relay/auctions/" + A.id)).json()).auction.sold, true);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_strikes WHERE shopper_id = 'a'").get().n, 0, "a second-chance offer nobody asked for never counts against anyone");
console.log("ok - unpaid after 24 hours: the order is cancelled, the stock goes back, and the next bidder is offered it; paying is noticed from Shopify");

// 9. A winner without delivery details is asked to add them first; once they do, the order is made.
const T2 = (await asShop("POST", "/relay/retailer/auctions", { ...base, variantKey: TEE, startMinor: 1500, deliveryMinor: 0, hours: 24 })).body.auction;
NOW = T2.endsAt - 3600e3;
giveAddress("c");
assert.equal((await bid("c", T2.id, 2000)).status, 200);
sqlite.prepare("DELETE FROM delivery_details WHERE shopper_id = 'c'").run();
NOW = T2.endsAt + 1000; calls.emails.length = 0; const before = calls.orders.length;
await runAuctions(env, O());
assert.equal(calls.orders.length, before, "no order without an address");
assert.equal((await asShopper("c", "GET", "/relay/my/auctions")).body.auctions.find(y => y.auction.id === T2.id).you.state, "add_address");
assert.equal(calls.emails[0].subject, "You won: Field Tee"); assert.match(calls.emails[0].text, /Add your delivery details in Relay/);
assert.equal((await asShopper("c", "GET", "/relay/my/auctions")).body.canBid, false, "and can't bid again until there's an address");
giveAddress("c"); NOW += 3 * 60e3;
await runAuctions(env, O());
assert.equal(calls.orders.length, before + 1); assert.equal(calls.orders.at(-1).order.shippingLines[0].title, "Free delivery");
assert.equal((await asShopper("c", "GET", "/relay/my/auctions")).body.auctions.find(y => y.auction.id === T2.id).you.state, "pay");
console.log("ok - a winner without delivery details is asked for them, and the order is made as soon as they're added");

// 10. The shop's Shopify: busy is tried again for a while; a refusal (sold out) means nothing to pay; the shop cancelling too.
shopMode = "busy";
const T3 = (await asShop("POST", "/relay/retailer/auctions", { ...base, startMinor: 1000, hours: 24 })).body.auction;
NOW = T3.endsAt - 3600e3; await bid("d", T3.id, 1200);
NOW = T3.endsAt + 1000; await runAuctions(env, O());
assert.equal(sqlite.prepare("SELECT status FROM auction_offers WHERE auction_id = ?").get(T3.id).status, "pending", "a busy shop is tried again");
shopMode = "refuse"; NOW += 3 * 60e3; calls.emails.length = 0;
await runAuctions(env, O());
assert.equal(sqlite.prepare("SELECT status FROM auction_offers WHERE auction_id = ?").get(T3.id).status, "shop_problem");
assert.equal(calls.emails[0].subject, "Nothing to pay: Wool Beanie");
assert.equal((await asShopper("d", "GET", "/relay/my/auctions")).body.auctions.find(y => y.auction.id === T3.id).you.state, "shop_problem");
shopMode = "ok";
const T4 = (await asShop("POST", "/relay/retailer/auctions", { ...base, startMinor: 1000, hours: 24 })).body.auction;
NOW = T4.endsAt - 3600e3; await bid("d", T4.id, 1300);
NOW = T4.endsAt + 1000; await runAuctions(env, O());
const t4order = sqlite.prepare("SELECT order_gid FROM auction_offers WHERE auction_id = ?").get(T4.id).order_gid;
cancelledAtShop.add(t4order); NOW += 5 * 60e3;
await runAuctions(env, O());
assert.equal(sqlite.prepare("SELECT status FROM auction_offers WHERE auction_id = ?").get(T4.id).status, "shop_problem", "the shop cancelled the order itself");
// No bids: it just ends.
const T5 = (await asShop("POST", "/relay/retailer/auctions", { ...base, startMinor: 1000, hours: 24 })).body.auction;
NOW = T5.endsAt + 1000; const o5 = calls.orders.length; await runAuctions(env, O());
assert.equal(sqlite.prepare("SELECT outcome FROM auctions WHERE id = ?").get(T5.id).outcome, "no_bids"); assert.equal(calls.orders.length, o5);
console.log("ok - a busy shop is asked again; a shop that can't take the order, or cancels it, means nothing to pay; no bids, no order");

// 11. Two unpaid wins in 90 days pause bidding for 30 days.
const T6 = (await asShop("POST", "/relay/retailer/auctions", { ...base, startMinor: 1000, hours: 24 })).body.auction;
NOW = T6.endsAt - 3600e3; await bid("b", T6.id, 1500);
NOW = T6.endsAt + 1000; await runAuctions(env, O());
NOW += PAY_HOURS * 3600e3 + 1000; await runAuctions(env, O());
const paused = (await asShopper("b", "GET", "/relay/my/auctions")).body;
assert.equal(paused.canBid, false); assert.equal(paused.why, "bidding_paused"); assert.ok(paused.until > NOW + 29 * 864e5);
const T7 = (await asShop("POST", "/relay/retailer/auctions", { ...base, startMinor: 1000, hours: 24 })).body.auction;
NOW = T7.endsAt - 3600e3;
assert.equal((await bid("b", T7.id, 2000)).body.error, "bidding_paused");
console.log("ok - not paying for two wins in 90 days pauses bidding for 30 days");

// 12. Cancelling with no bids; limits on live auctions.
assert.equal((await asShop("POST", "/relay/retailer/auctions/" + oneoff.id + "/cancel")).status, 409, "an auction that has ended can't be cancelled");
const T8 = (await asShop("POST", "/relay/retailer/auctions", { ...base, startMinor: 1000, hours: 72 })).body.auction;
assert.equal((await asShop("POST", "/relay/retailer/auctions/" + T8.id + "/cancel")).body.auction.status, "cancelled");
sqlite.exec("UPDATE auctions SET created_at = 0");
const live = sqlite.prepare("SELECT COUNT(*) AS n FROM auctions WHERE shop_ref = ? AND status = 'live'").get(DOMAIN).n;
for (let i = live; i < MAX_LIVE_PER_SHOP; i++) assert.equal((await asShop("POST", "/relay/retailer/auctions", base)).status, 200);
assert.equal((await asShop("POST", "/relay/retailer/auctions", base)).body.error, "too_many_live");
console.log("ok - a shop can cancel an auction nobody has bid on, and run up to " + MAX_LIVE_PER_SHOP + " at once");

// 13. "Delete my account": their maximums leave live auctions, and the next bidder takes the lead; wins stop being theirs.
assert.equal((await asShop("POST", "/relay/retailer/auctions/catalogue")).status, 404, "the catalogue is only read");
sqlite.exec("UPDATE auctions SET status = 'cancelled' WHERE shop_ref = '" + DOMAIN + "' AND status = 'live' AND bids = 0");
const L = (await asShop("POST", "/relay/retailer/auctions", { ...base, startMinor: 1000, hours: 72 })).body.auction;
NOW = L.endsAt - 864e5;
giveAddress("a"); await bid("a", L.id, 4000); await bid("c", L.id, 2000);
assert.equal(sqlite.prepare("SELECT leader_id, price_minor FROM auctions WHERE id = ?").get(L.id).leader_id, "a");
const exp = await auctionsForExport(env, "a");
assert.ok(exp.bids.some(y => y.title === "Wool Beanie" && y.maxMinor === 4000)); assert.ok(exp.wins.some(y => y.status === "paid" && y.priceMinor === 6200));
await forgetAuctionBidder(env, "a", NOW);
const after = sqlite.prepare("SELECT leader_id, price_minor FROM auctions WHERE id = ?").get(L.id);
assert.deepEqual([after.leader_id, after.price_minor], ["c", 1000], "Cat now leads, at the starting price");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_offers WHERE shopper_id = 'a'").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_bidders WHERE shopper_id = 'a'").get().n, 0);
console.log("ok - deleting an account takes its bids out of live auctions (the next bidder leads) and unlinks its wins; the export lists bids and wins");

// 14. Tidying: 90 days after an auction ends, bidders' maximums and its photos go.
NOW += 200 * 864e5;
await runAuctions(env, O()); // the rest end now...
assert.ok(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_bidders").get().n > 0, "...and their bidders are kept for now");
NOW += 91 * 864e5;
await runAuctions(env, O());
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_bidders b JOIN auctions a ON a.id = b.auction_id WHERE a.status != 'live'").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_photos p JOIN auctions a ON a.id = p.auction_id WHERE a.status != 'live'").get().n, 0);
console.log("ok - 90 days after an auction ends, its bidders' maximums and photos are deleted");

// 15. The order Relay asks a test shop for is a test; a one-off is a line with its own name and no stock to take.
const t = orderInput({ kind: "oneoff", title: "Sample coat", size: "M", condition: "sample", delivery_minor: 0, test_shop: 1 }, { price_minor: 4500 }, "x@example.com",
  { firstName: "X", lastName: "Y", line1: "1 Road", line2: null, town: "Leeds", postcode: "LS1 1AA", phone: null });
assert.equal(t.order.test, true);
assert.deepEqual(t.order.lineItems, [{ title: "Sample coat, size M", quantity: 1, priceSet: { shopMoney: { amount: "45.00", currencyCode: "GBP" } }, requiresShipping: true, taxable: true }]);
assert.equal(t.options.inventoryBehaviour, "BYPASS"); assert.ok(!("phone" in t.order.shippingAddress) && !("address2" in t.order.shippingAddress));
assert.match(t.order.note, /Not paid yet: send it once it's paid\. Condition: Sample\./);
console.log("ok - a test shop's order is marked as a test; a one-off is its own line with no stock to take");

// 16. The server's input rules (validate.js) for the new routes, and the shop's key in front of them (retailer.js).
const check = async (path, body, raw) => checkBody(new Request("https://api.relay.test" + path, { method: "POST", body: raw ?? JSON.stringify(body) }), path, {});
assert.ok((await check("/relay/my/auctions/bid", { auctionId: A.id, maxMinor: 100 })).request);
assert.equal((await check("/relay/my/auctions/bid", { auctionId: A.id, maxMinor: 100, shopperId: "b" })).response.status, 400, "no one else's id");
assert.equal((await check("/relay/my/auctions/bid", { auctionId: A.id, maxMinor: 1.5 })).response.status, 400, "pennies only");
assert.ok((await check("/relay/retailer/auctions", { ...base, photos: [jpeg] })).request);
assert.equal((await check("/relay/retailer/auctions", { ...base, photos: [jpeg, jpeg, jpeg, jpeg, jpeg] })).response.status, 400, "four photos at most");
assert.equal((await check("/relay/retailer/auctions", null, JSON.stringify({ ...base, photos: ["x".repeat(700000)] }))).response.status, 400);
assert.ok(schemaFor("/relay/retailer/auctions/" + A.id + "/cancel"), "cancelling takes nothing");
assert.ok((await check("/relay/retailer/auctions", { ...noLength, minutes: 10 })).request, "a length in minutes is a field the route takes (auctions.js decides who may use it: 17, below)");
assert.equal((await check("/relay/retailer/auctions", { ...noLength, minutes: 10.5 })).response.status, 400, "whole minutes only");
assert.equal((await check("/relay/retailer/auctions", { ...noLength, minutes: "10" })).response.status, 400, "a number, not text");
const key = await issueRetailerKey(env, { provider: "shopify", shopRef: DOMAIN, storeLabel: "Hollow Pine" }, NOW);
const viaKey = await handleRetailerRoute(new Request("https://api.relay.test/relay/retailer/auctions", { headers: { Authorization: "Bearer " + key } }), env, new URL("https://api.relay.test/relay/retailer/auctions"), {}, { now: NOW });
assert.equal(viaKey.status, 200); assert.equal((await viaKey.json()).store, "Hollow Pine");
const noKey = await handleRetailerRoute(new Request("https://api.relay.test/relay/retailer/auctions"), env, new URL("https://api.relay.test/relay/retailer/auctions"), {}, { now: NOW });
assert.equal(noKey.status, 401);
console.log("ok - the new routes take only their own fields, and the shop's routes need the shop's key");

// 17. Trying it out: Relay's own test shops can run a 10-minute auction, so the team can try one from both sides in a
// sitting. No other shop is offered that length, or gets it by asking.
assert.deepEqual(TEST_MINUTES, [10]);
const devList = (await asShop("GET", "/relay/retailer/auctions", null, devShop)).body;
assert.deepEqual(devList.shortMinutes, [10], "the test shop's dashboard is offered 10 minutes"); assert.deepEqual(devList.durations, DURATIONS, "as well as the usual lengths");
assert.ok(!("shortMinutes" in (await asShop("GET", "/relay/retailer/auctions")).body), "a real shop's dashboard isn't offered it");
const realBefore = sqlite.prepare("SELECT COUNT(*) AS n FROM auctions WHERE shop_ref = ?").get(DOMAIN).n;
assert.deepEqual((await asShop("POST", "/relay/retailer/auctions", { ...noLength, minutes: 10 })).body, { error: "bad_duration" }, "a real shop that asks anyway is refused, like any length Relay doesn't offer");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auctions WHERE shop_ref = ?").get(DOMAIN).n, realBefore, "and nothing was started");
// A shop Relay hasn't checked yet (no plan on record) isn't a test shop either.
sqlite.prepare("INSERT INTO shopify_shops VALUES ('unchecked-shop.myshopify.com', 'Unchecked', 'read_products,write_orders')").run();
const unchecked = { provider: "shopify", shop_ref: "unchecked-shop.myshopify.com", store_label: "Unchecked" };
assert.ok(!("shortMinutes" in (await asShop("GET", "/relay/retailer/auctions", null, unchecked)).body));
assert.deepEqual((await asShop("POST", "/relay/retailer/auctions", { kind: "oneoff", title: "Sample scarf", photos: [jpeg], condition: "sample", startMinor: 1000, minutes: 10, agree: true }, unchecked)).body, { error: "bad_duration" });
// The test shop: only the length on the list, and hours or minutes, never both.
for (const [change, why] of [[{ minutes: 5 }, "a length that isn't offered"], [{ minutes: 0 }, "no time at all"], [{ minutes: 1440 }, "a day, in minutes"], [{ minutes: 10, hours: 24 }, "both at once"]])
  assert.deepEqual((await asShop("POST", "/relay/retailer/auctions", { ...noLength, variantKey: DEVITEM, ...change }, devShop)).body, { error: "bad_duration" }, why);
const day24 = (await asShop("POST", "/relay/retailer/auctions", { ...base, variantKey: DEVITEM, minutes: null }, devShop)).body.auction;
assert.equal(day24.endsAt, NOW + 24 * 3600e3, "minutes left out (null) means the length in hours, as before");
const quick = await asShop("POST", "/relay/retailer/auctions", { ...noLength, variantKey: DEVITEM, minutes: 10 }, devShop);
assert.equal(quick.status, 200);
const Q = quick.body.auction;
assert.equal(Q.endsAt, NOW + 10 * 60e3, "it ends ten minutes after it starts"); assert.equal(Q.test, true); assert.equal(Q.status, "live");
// Like any test shop's auction, real shoppers never see it; bidding is the same, late bids included.
assert.ok(!(await (await anyone("/relay/auctions")).json()).auctions.some(y => y.id === Q.id));
assert.ok((await (await anyone("/relay/auctions?test=1")).json()).auctions.some(y => y.id === Q.id));
assert.equal((await bid("c", Q.id, 2000)).body.you.leading, true);
NOW = Q.endsAt - 30e3;
x = await bid("d", Q.id, 3000);
assert.equal(x.body.you.leading, true); assert.equal(x.body.auction.priceMinor, 2100);
assert.equal(x.body.auction.endsAt, NOW + EXTEND_MS, "a late bid still gives everyone two more minutes");
// The every-minute run ends it and makes the winner's order at the test shop, as a test order. The time to pay is the same
// 24 hours as everywhere: the app, the dashboard and Relay's terms all say 24 hours, so a shorter one here would make them wrong.
NOW += EXTEND_MS + 1000; calls.emails.length = 0;
const ordersBeforeQuick = calls.orders.length;
ran = await runAuctions(env, O());
assert.equal(ran.ended, 1); assert.equal(ran.offered, 1); assert.equal(calls.orders.length, ordersBeforeQuick + 1);
assert.equal(calls.orders.at(-1).shop, TESTSHOP); assert.equal(calls.orders.at(-1).order.test, true, "the order at a test shop is a test order");
assert.equal(calls.orders.at(-1).order.email, "dev@example.com");
const devWin = (await asShopper("d", "GET", "/relay/my/auctions")).body.auctions.find(y => y.auction.id === Q.id).you;
assert.equal(devWin.state, "pay"); assert.equal(devWin.totalMinor, 2495); assert.equal(devWin.payBy, NOW + PAY_HOURS * 3600e3, "the winner has the same 24 hours to pay");
assert.match(calls.emails[0].text, /Pay Relay Dev £24\.95 including delivery by .+ at their own checkout/);
// Left unpaid on purpose: it goes to the next bidder as usual, but it doesn't count towards the pause on bidding, and the
// email doesn't warn of one.
NOW += PAY_HOURS * 3600e3 + 1000; calls.emails.length = 0;
ran = await runAuctions(env, O());
assert.equal(ran.expired, 1);
assert.equal(sqlite.prepare("SELECT status FROM auction_offers WHERE auction_id = ? AND shopper_id = 'd'").get(Q.id).status, "expired");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_strikes WHERE auction_id = ?").get(Q.id).n, 0, "an unpaid win at a test shop isn't counted");
const timeUp = calls.emails.find(e => e.subject === "Time ran out: Test Jacket");
assert.ok(timeUp, "the winner is still told the time ran out"); assert.match(timeUp.text, /wasn't paid for within 24 hours, so the order was cancelled and it's gone to the next bidder\.$/m);
assert.ok(!/stops bidding/.test(timeUp.text), "with no warning about a pause that isn't coming");
assert.equal((await asShopper("c", "GET", "/relay/my/auctions")).body.auctions.find(y => y.auction.id === Q.id).you.state, "offered", "Cat, next highest, is offered it");
// A second unpaid win straight after: at a real shop that pauses bidding for 30 days (11, above). At the test shop it doesn't.
const Q2 = (await asShop("POST", "/relay/retailer/auctions", { ...noLength, variantKey: DEVITEM, minutes: 10 }, devShop)).body.auction;
assert.equal((await bid("d", Q2.id, 1500)).status, 200);
NOW = Q2.endsAt + 1000; await runAuctions(env, O());
NOW += PAY_HOURS * 3600e3 + 1000; await runAuctions(env, O());
assert.equal(sqlite.prepare("SELECT status FROM auction_offers WHERE auction_id = ? AND shopper_id = 'd'").get(Q2.id).status, "expired");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_strikes WHERE shopper_id = 'd'").get().n, 0);
assert.equal((await asShopper("d", "GET", "/relay/my/auctions")).body.canBid, true, "two unpaid wins at the test shop don't pause bidding");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auctions WHERE test_shop = 0 AND ends_at - starts_at < 86400000").get().n, 0, "and no real shop's auction has ever run for less than a day");
console.log("ok - Relay's own test shops can run a 10-minute auction (no other shop is offered it or can ask for it); the time to pay stays 24 hours; unpaid wins there don't count");

// 18. A shop that removes Relay: its running auctions end without a sale; Shopify's erase request deletes them all.
const G = (await asShop("POST", "/relay/retailer/auctions", { ...base, startMinor: 1000, hours: 24 })).body.auction;
assert.equal(sqlite.prepare("SELECT status FROM auctions WHERE id = ?").get(G.id).status, "live");
await forgetShopifyShop(env, DOMAIN, { now: NOW });
assert.deepEqual({ ...sqlite.prepare("SELECT status, outcome FROM auctions WHERE id = ?").get(G.id) }, { status: "cancelled", outcome: "shop_left" });
assert.ok(sqlite.prepare("SELECT COUNT(*) AS n FROM auctions WHERE shop_ref = ?").get(DOMAIN).n > 0, "kept until Shopify's erase request");
await forgetShopifyShop(env, DOMAIN, { now: NOW, everything: true });
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auctions WHERE shop_ref = ?").get(DOMAIN).n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_offers o WHERE NOT EXISTS (SELECT 1 FROM auctions a WHERE a.id = o.auction_id)").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auction_photos p WHERE NOT EXISTS (SELECT 1 FROM auctions a WHERE a.id = p.auction_id)").get().n, 0);
console.log("ok - a shop that removes Relay: its running auctions end without a sale, and Shopify's erase request deletes them");
