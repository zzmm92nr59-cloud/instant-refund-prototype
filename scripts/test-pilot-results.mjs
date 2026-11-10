// Offline test for the shop dashboard's "Pilot results": swaps and returns a shop can see, and nothing more.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleRetailerRoute, issueRetailerKey, shopResults } from "../worker/retailer.js";
import { ensureExchangeTables } from "../worker/exchange.js";
import { ensureReturnsTables } from "../worker/returns.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
}
const db = { prepare: sql => stmt(sql) };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789" };
const now = 1_800_000_000_000;

const call = async (key, path = "/relay/retailer/results") => {
  const url = new URL("https://w.test" + path);
  const res = await handleRetailerRoute(new Request(url, { headers: key ? { Authorization: "Bearer " + key } : {} }), env, url, {}, { now });
  return { status: res.status, body: await res.json() };
};

// Before any swap or return: the tables may not even exist yet, and the dashboard still answers.
const kick = await issueRetailerKey(env, { provider: "shopify", shopRef: "kick-lane.myshopify.com", storeLabel: "Kick Lane" }, now);
let r = await call(kick);
assert.equal(r.status, 200);
assert.equal(r.body.supported, true);
assert.deepEqual(r.body.totals, { swaps: 0, swapValueMinor: 0, swapsThenReturned: 0, returns: 0, returnValueMinor: 0, swapShare: null });

await ensureExchangeTables(db); await ensureReturnsTables(db);
const order = (shop, ext, lines) => {
  const conn = "shopify:" + shop, id = conn + ":order:" + ext;
  sqlite.prepare("INSERT OR IGNORE INTO retailer_connections (id, provider, merchant_external_id) VALUES (?,?,?)").run(conn, "shopify", shop);
  sqlite.prepare("INSERT INTO retailer_orders (id, connection_id, external_order_id, ordered_at, amount_minor, currency, payment_processor, status, raw_identifier_keys) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, conn, String(ext), new Date(now).toISOString(), 0, "GBP", "shopify", "unverified", "[]");
  for (const [lineId, title, qty, price] of lines)
    sqlite.prepare("INSERT INTO order_items (id, order_id, external_line_item_id, product_id, variant_id, title, quantity, price_minor, currency) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id + ":item:" + lineId, id, lineId, "P", "V", title, qty, price, "GBP");
  return id;
};
// fromLine and fromPrice: only on swaps Relay followed onto the new item's own line (lineId is then that new line, and its
// order_items row already carries the new item's price).
const swap = (shop, orderId, lineId, from, to, qty, status, at, detail = null, fromLine = null, fromPrice = null) =>
  sqlite.prepare("INSERT INTO relay_exchanges (id, shopper_id, order_id, line_id, shop, from_variant, from_title, to_variant, to_title, quantity, status, detail, created_at, from_line_id, from_price_minor) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(crypto.randomUUID(), "alice", orderId, lineId, shop, "gid://a", from, "gid://b", to, qty, status, detail, at, fromLine, fromPrice);
const ret = (shop, orderId, lineId, item, qty, price, reason, ref, at, notified, status = "requested") =>
  sqlite.prepare("INSERT INTO relay_returns (id, shopper_id, order_id, line_id, shop, item_title, quantity, price_minor, reason, return_ref, status, created_at, shop_notified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(crypto.randomUUID(), "alice", orderId, lineId, shop, item, qty, price, reason, ref, status, at, notified);

const o1 = order("kick-lane.myshopify.com", "6100000000001", [["L1", "Logo Sports Cap", 1, 2000], ["L2", "Track Socks", 2, 650]]);
const o2 = order("kick-lane.myshopify.com", "6100000000002", [["L1", "Court Trainer", 1, 6500]]);
const other = order("oak-thread.myshopify.com", "7100000000001", [["L1", "Linen Cushion", 1, 2400]]);
swap("kick-lane.myshopify.com", o1, "L1", "Black", "Navy", 1, "done", now - 3000);
swap("kick-lane.myshopify.com", o1, "L2", "S", "M", 2, "done", now - 1000);
swap("kick-lane.myshopify.com", o2, "L1", "UK 8", "UK 9", 1, "failed", now - 500);          // didn't happen: not counted
swap("oak-thread.myshopify.com", other, "L1", "Sage", "Rust", 1, "done", now - 100);       // another shop: never shown
ret("kick-lane.myshopify.com", o2, "L1", "Court Trainer", 1, 6500, "faulty", "RLY-AAAA-BBBB", now - 2000, now - 2000);
ret("kick-lane.myshopify.com", o2, "L1", "Court Trainer", 1, 6500, "faulty", "RLY-CCCC-DDDD", now - 1500, null, "cancelled"); // cancelled: not counted
ret("oak-thread.myshopify.com", other, "L1", "Linen Cushion", 1, 2400, "changed_mind", "RLY-EEEE-FFFF", now - 50, null);

// Swaps at a different price: valued at the new item's price, with the difference and whether it was paid.
const o3 = order("kick-lane.myshopify.com", "6100000000003", [["L1", "Cloud Runner Trainers", 1, 9500], ["L2", "Rain Jacket", 1, 6000], ["L3", "Beanie", 1, 1500]]);
swap("kick-lane.myshopify.com", o3, "L1", "UK 8", "UK 7", 1, "done", now - 4000, "paid 1500");
swap("kick-lane.myshopify.com", o3, "L2", "M", "L", 1, "done", now - 4100, "shop to refund 500");
swap("kick-lane.myshopify.com", o3, "L3", "Red", "Blue", 1, "done", now - 4200, "payment not taken 300");
const o4 = order("kick-lane.myshopify.com", "6100000000004", [["L1", "Gilet", 1, 4000], ["L2", "Scarf", 1, 2000], ["L3", "Gloves", 1, 1800], ["L4", "Socks", 1, 800]]);
swap("kick-lane.myshopify.com", o4, "L1", "S", "M", 1, "done", now - 4300, "shopify balance 1000");
swap("kick-lane.myshopify.com", o4, "L2", "Red", "Blue", 1, "done", now - 4400, "paid to shop 250");
swap("kick-lane.myshopify.com", o4, "L3", "S", "XS", 1, "done", now - 4500, "refunded 300");
swap("kick-lane.myshopify.com", o4, "L4", "S", "L", 1, "done", now - 4600, "shopify paid 200");
const dr = (await call(kick)).body.swaps.filter(s => ["Cloud Runner Trainers", "Rain Jacket", "Beanie", "Gilet", "Scarf", "Gloves", "Socks"].includes(s.item));
assert.deepEqual(dr.map(s => [s.item, s.valueMinor, s.priceDiffMinor, s.differencePaid, s.differenceHow]),
  [["Cloud Runner Trainers", 11000, 1500, true, "card_owed"], ["Rain Jacket", 5500, -500, null, "shop_to_refund"], ["Beanie", 1500, 300, false, "card_failed"],
   ["Gilet", 5000, 1000, false, "shopify"], ["Scarf", 2250, 250, true, "card_to_shop"], ["Gloves", 1500, -300, null, "refunded"], ["Socks", 1000, 200, true, "shopify_paid"]]);
sqlite.prepare("DELETE FROM relay_exchanges WHERE order_id = ?").run(o4);
sqlite.prepare("DELETE FROM relay_exchanges WHERE order_id = ?").run(o3);

// Swaps Relay has followed onto the new item's own line: that line already carries the new item's price, so the
// difference is not added a second time (a £95 item swapped for a £110 one is worth £110, not £125). When the card
// payment for the difference failed, the shop has what the old item cost.
const o5 = order("kick-lane.myshopify.com", "6100000000005", [["N1", "Cloud Runner Trainers", 1, 11000], ["N2", "Rain Jacket", 1, 5500], ["N3", "Beanie", 1, 1800],
  ["N4", "Track Socks", 2, 800], ["N5", "Gilet", 1, 5000], ["N6", "Scarf", 1, 2000]]);
swap("kick-lane.myshopify.com", o5, "N1", "UK 8", "UK 9", 1, "done", now - 5000, "shopify balance 1500", "L1", 9500);
swap("kick-lane.myshopify.com", o5, "N2", "M", "L", 1, "done", now - 5100, "refunded 500", "L2", 6000);
swap("kick-lane.myshopify.com", o5, "N3", "Red", "Blue", 1, "done", now - 5200, "payment not taken 300", "L3", 1500);
swap("kick-lane.myshopify.com", o5, "N4", "S", "M", 2, "done", now - 5300, "paid to shop 300", "L4", 650);   // two pairs, 15p dearer each
swap("kick-lane.myshopify.com", o5, "N5", "S", "M", 1, "done", now - 5400, "shopify paid 1000", "L5", 4000);
swap("kick-lane.myshopify.com", o5, "N6", "Red", "Navy", 1, "done", now - 5500, null, "L6", 2000);
let fresh = (await call(kick)).body;
const moved = fresh.swaps.filter(s => s.at <= now - 5000 && s.at >= now - 5500);
assert.deepEqual(moved.map(s => [s.item, s.quantity, s.valueMinor, s.priceDiffMinor, s.differenceHow, s.thenReturned]),
  [["Cloud Runner Trainers", 1, 11000, 1500, "shopify", false], ["Rain Jacket", 1, 5500, -500, "refunded", false], ["Beanie", 1, 1500, 300, "card_failed", false],
   ["Track Socks", 2, 1600, 300, "card_to_shop", false], ["Gilet", 1, 5000, 1000, "shopify_paid", false], ["Scarf", 1, 2000, 0, null, false]]);
// Two swaps before these (the cap and the socks on the first order) plus these six.
assert.deepEqual(fresh.totals, { swaps: 8, swapValueMinor: 3300 + 11000 + 5500 + 1500 + 1600 + 5000 + 2000, swapsThenReturned: 0, returns: 1, returnValueMinor: 6500, swapShare: 89 });

// The customer swaps, then starts a return for the new item: the swap stays in the list (the shop's order was changed) but
// it ended as a return, so it is not counted as a swap, in the value of items swapped, or as a swap in the share.
ret("kick-lane.myshopify.com", o5, "N1", "Cloud Runner Trainers", 1, 11000, "wrong_size", "RLY-GGGG-HHHH", now - 4900, now - 4900);
fresh = (await call(kick)).body;
assert.equal(fresh.swaps.length, 8, "still listed");
assert.deepEqual(fresh.swaps.filter(s => s.thenReturned).map(s => [s.item, s.to, s.valueMinor]), [["Cloud Runner Trainers", "UK 9", 11000]]);
assert.deepEqual(fresh.totals, { swaps: 7, swapValueMinor: 3300 + 5500 + 1500 + 1600 + 5000 + 2000, swapsThenReturned: 1, returns: 2, returnValueMinor: 6500 + 11000, swapShare: 78 });
// A return the customer cancelled doesn't take a swap out of the count.
ret("kick-lane.myshopify.com", o5, "N2", "Rain Jacket", 1, 5500, "changed_mind", "RLY-JJJJ-KKKK", now - 4800, null, "cancelled");
// Nor does a return from before the swap on a line with the same id (it can only be an older, unrelated record).
ret("kick-lane.myshopify.com", o5, "N6", "Scarf", 1, 2000, "changed_mind", "RLY-LLLL-MMMM", now - 9000, null, "refunded");
fresh = (await call(kick)).body;
assert.deepEqual(fresh.swaps.filter(s => s.thenReturned).map(s => s.item), ["Cloud Runner Trainers"]);
assert.equal(fresh.totals.swaps, 7); assert.equal(fresh.totals.swapsThenReturned, 1);
sqlite.prepare("DELETE FROM relay_returns WHERE order_id = ?").run(o5);
sqlite.prepare("DELETE FROM relay_exchanges WHERE order_id = ?").run(o5);

// A database from before swaps kept the line they replaced (no from_line_id), and with no returns table at all: swaps
// are still listed, valued the older way.
{
  const old = new DatabaseSync(":memory:");
  for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) old.exec(readFileSync("worker/migrations/" + f, "utf8"));
  old.exec(`CREATE TABLE relay_exchanges (id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, order_id TEXT NOT NULL, line_id TEXT NOT NULL, shop TEXT NOT NULL,
    from_variant TEXT NOT NULL, from_title TEXT, to_variant TEXT NOT NULL, to_title TEXT, quantity INTEGER NOT NULL, status TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL)`);
  const conn = "shopify:kick-lane.myshopify.com", id = conn + ":order:6100000000009";
  old.prepare("INSERT INTO retailer_connections (id, provider, merchant_external_id) VALUES (?,?,?)").run(conn, "shopify", "kick-lane.myshopify.com");
  old.prepare("INSERT INTO retailer_orders (id, connection_id, external_order_id, ordered_at, amount_minor, currency, payment_processor, status, raw_identifier_keys) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, conn, "6100000000009", new Date(now).toISOString(), 0, "GBP", "shopify", "unverified", "[]");
  old.prepare("INSERT INTO order_items (id, order_id, external_line_item_id, product_id, variant_id, title, quantity, price_minor, currency) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id + ":item:L1", id, "L1", "P", "V", "Court Trainer", 1, 6500, "GBP");
  old.prepare("INSERT INTO relay_exchanges (id, shopper_id, order_id, line_id, shop, from_variant, from_title, to_variant, to_title, quantity, status, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("x1", "alice", id, "L1", "kick-lane.myshopify.com", "gid://a", "UK 8", "gid://b", "UK 9", 1, "done", "shopify balance 500", now);
  const oldStmt = (sql, args = []) => ({ bind: (...a) => oldStmt(sql, a), async run() { old.prepare(sql).run(...args); return {}; }, async first() { return old.prepare(sql).get(...args) ?? null; },
    async all() { return { results: old.prepare(sql).all(...args) }; } });
  const was = await shopResults({ RELAY_DB: { prepare: sql => oldStmt(sql) } }, { provider: "shopify", shop_ref: "kick-lane.myshopify.com", store_label: "Kick Lane" });
  assert.deepEqual(was.swaps.map(s => [s.item, s.valueMinor, s.thenReturned]), [["Court Trainer", 7000, false]]);
  assert.deepEqual(was.totals, { swaps: 1, swapValueMinor: 7000, swapsThenReturned: 0, returns: 0, returnValueMinor: 0, swapShare: 100 });
}
const dashPage = readFileSync("retailer.html", "utf8");
assert.match(dashPage, /Customer paid \$\{m\(diff\)\} more by card \(test mode\) · paid into your Stripe account/);
assert.match(dashPage, /Shopify asked the customer to pay \$\{m\(diff\)\} more · not paid yet/);
assert.match(dashPage, /Customer paid \$\{m\(diff\)\} more through your Shopify checkout/);
assert.match(dashPage, /please refund the customer/);

r = await call(kick);
assert.equal(r.status, 200);
const b = r.body;
// Only this shop's completed swaps, newest first, valued at price x quantity.
assert.deepEqual(b.swaps.map(s => [s.item, s.from, s.to, s.quantity, s.valueMinor]), [["Track Socks", "S", "M", 2, 1300], ["Logo Sports Cap", "Black", "Navy", 1, 2000]]);
assert.equal(b.swaps[0].orderUrl, "https://admin.shopify.com/store/kick-lane/orders/6100000000001");
// Only this shop's returns that weren't cancelled, with whether the shop was emailed.
assert.deepEqual(b.returns.map(x => [x.item, x.reason, x.ref, x.emailed, x.valueMinor]), [["Court Trainer", "faulty", "RLY-AAAA-BBBB", true, 6500]]);
assert.deepEqual(b.totals, { swaps: 2, swapValueMinor: 3300, swapsThenReturned: 0, returns: 1, returnValueMinor: 6500, swapShare: 67 });
// Never anything that identifies the shopper in Relay.
assert.doesNotMatch(JSON.stringify(b), /alice|shopper|email_hash|@/);

// A Square shop: swaps and returns run through Shopify, so the section is switched off rather than showing zeros.
const sq = await issueRetailerKey(env, { provider: "square_sandbox", shopRef: "MZARA1", storeLabel: "Zara" }, now);
r = await call(sq);
assert.equal(r.status, 200); assert.equal(r.body.supported, false); assert.equal(r.body.swaps.length, 0);

// No key or a made-up key: nothing.
assert.equal((await call(null)).status, 401);
assert.equal((await call("rk_" + "x".repeat(43))).status, 401);

// The dashboard page has the section and only says what Relay really does.
const page = readFileSync("retailer.html", "utf8");
assert.match(page, /id="results"/);
// Relay refunds the difference on a swap to a cheaper item (in the shop's Shopify), so the page must not say it never
// refunds anyone: it never refunds a return.
assert.match(page, /you refund them yourself: Relay never refunds a return/);
assert.doesNotMatch(page, /doesn't refund anyone/);
assert.match(page, /has since started a return for this item, so it's counted as a return, not a swap/);

console.log("pilot results: all checks passed");
