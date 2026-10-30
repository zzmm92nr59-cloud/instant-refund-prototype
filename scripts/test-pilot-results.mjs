// Offline test for the shop dashboard's "Pilot results": swaps and returns a shop can see, and nothing more.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleRetailerRoute, issueRetailerKey } from "../worker/retailer.js";
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
assert.deepEqual(r.body.totals, { swaps: 0, swapValueMinor: 0, returns: 0, returnValueMinor: 0, swapShare: null });

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
const swap = (shop, orderId, lineId, from, to, qty, status, at, detail = null) =>
  sqlite.prepare("INSERT INTO relay_exchanges (id, shopper_id, order_id, line_id, shop, from_variant, from_title, to_variant, to_title, quantity, status, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(crypto.randomUUID(), "alice", orderId, lineId, shop, "gid://a", from, "gid://b", to, qty, status, detail, at);
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
const dr = (await call(kick)).body.swaps.filter(s => ["Cloud Runner Trainers", "Rain Jacket", "Beanie"].includes(s.item));
assert.deepEqual(dr.map(s => [s.item, s.valueMinor, s.priceDiffMinor, s.differencePaid]),
  [["Cloud Runner Trainers", 11000, 1500, true], ["Rain Jacket", 5500, -500, null], ["Beanie", 1500, 300, false]]);
sqlite.prepare("DELETE FROM relay_exchanges WHERE order_id = ?").run(o3);
const dashPage = readFileSync("retailer.html", "utf8");
assert.match(dashPage, /Customer paid \$\{gbp\(diff, results\.currency\)\} more by card \(test mode\)/);
assert.match(dashPage, /please refund the customer/);

r = await call(kick);
assert.equal(r.status, 200);
const b = r.body;
// Only this shop's completed swaps, newest first, valued at price x quantity.
assert.deepEqual(b.swaps.map(s => [s.item, s.from, s.to, s.quantity, s.valueMinor]), [["Track Socks", "S", "M", 2, 1300], ["Logo Sports Cap", "Black", "Navy", 1, 2000]]);
assert.equal(b.swaps[0].orderUrl, "https://admin.shopify.com/store/kick-lane/orders/6100000000001");
// Only this shop's returns that weren't cancelled, with whether the shop was emailed.
assert.deepEqual(b.returns.map(x => [x.item, x.reason, x.ref, x.emailed, x.valueMinor]), [["Court Trainer", "faulty", "RLY-AAAA-BBBB", true, 6500]]);
assert.deepEqual(b.totals, { swaps: 2, swapValueMinor: 3300, returns: 1, returnValueMinor: 6500, swapShare: 67 });
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
assert.match(page, /Relay doesn't refund anyone/);

console.log("pilot results: all checks passed");
