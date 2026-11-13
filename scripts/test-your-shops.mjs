// Offline test: receipts from Relay's own test shops are marked testShop in the receipts list (worker/gmail.js
// markTestShopReceipts), so Browse's "Your shops" shows them only with testing tools on. Made-up shops.
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { markTestShopReceipts } from "../worker/gmail.js";

const sqlite = new DatabaseSync(":memory:");
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
}
const env = { RELAY_DB: { prepare: (sql) => stmt(sql) } };
const rec = (name, domain) => ({ id: name + domain, retailer: { name, domain } });

// 1. Without the shop tables, nothing is marked and nothing breaks.
let list = [rec("Pebble Goods", "pebble-goods.myshopify.com")];
await markTestShopReceipts(env, list);
assert.equal(list[0].testShop, undefined, "no tables: nothing marked");
console.log("ok - no shop tables: nothing marked");

// 2. A test shop and a real one.
sqlite.exec("CREATE TABLE shopify_shop_plan (domain TEXT PRIMARY KEY, test_shop INTEGER NOT NULL, plan TEXT, checked_at INTEGER NOT NULL)");
sqlite.exec("CREATE TABLE shopify_shops (domain TEXT PRIMARY KEY, label TEXT NOT NULL)");
sqlite.exec("INSERT INTO shopify_shop_plan VALUES ('pebble-goods.myshopify.com',1,'partner_test',1),('fern-and-co.myshopify.com',0,'basic',1)");
sqlite.exec("INSERT INTO shopify_shops VALUES ('pebble-goods.myshopify.com','Pebble & Goods'),('fern-and-co.myshopify.com','Fern and Co')");
list = [rec("Pebble Goods", "pebble-goods.myshopify.com"), rec("Pebble and Goods", "pebblegoods-mail.example"), rec("Fern and Co", "fern-and-co.myshopify.com"), rec("Ivy Lane", "www.ivylane.example"), { id: "x" }];
await markTestShopReceipts(env, list);
assert.equal(list[0].testShop, true, "the test shop's address");
assert.equal(list[1].testShop, true, "the test shop's name, spelt another way");
assert.equal(list[2].testShop, undefined, "a real connected shop is not a test shop");
assert.equal(list[3].testShop, undefined, "a shop Relay doesn't know");
assert.equal(list[4].testShop, undefined, "a receipt with no shop");
console.log("ok - test shops marked by address or name; real shops left alone");
console.log("PASS your-shops (server)");
