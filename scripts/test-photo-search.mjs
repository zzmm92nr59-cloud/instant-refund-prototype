// Offline test for search by photo (worker/photo-search.js). Anthropic is a stand-in; nothing leaves this machine. Made-up
// shops, items and people.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handlePhotoSearchRoute, cleanAnswer, photoSearchDeleteStatements, PHOTO_SEARCHES_PER_DAY, PHOTO_SYSTEM } from "../worker/photo-search.js";
import { ensureShopifyShopSchema, HOOKS_SET } from "../worker/shopify-connect.js";
import { ensureWebShopTables } from "../worker/web-shops.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
}
const db = { prepare: sql => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789" };
sqlite.exec(`ALTER TABLE retailer_catalog_items ADD COLUMN store_label TEXT; ALTER TABLE retailer_catalog_items ADD COLUMN image_url TEXT;
  CREATE TABLE IF NOT EXISTS shopify_shop_plan (domain TEXT PRIMARY KEY, test_shop INTEGER NOT NULL, plan TEXT, checked_at INTEGER NOT NULL);`);
await ensureShopifyShopSchema(db);
const OAK = "oak-thread.myshopify.com", BIRCH = "birch-lane.myshopify.com", FERN = "fern-test.myshopify.com";
for (const [domain, label, test] of [[OAK, "Oak & Thread", 0], [BIRCH, "Birch Lane", 0], [FERN, "Fern Test", 1]]) {
  sqlite.prepare("INSERT INTO shopify_shops (domain, label, access_iv, access_data, scopes, hooks, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(domain, label, "iv", "data", "read_products,write_orders", HOOKS_SET, 1, 1);
  sqlite.prepare("INSERT INTO shopify_shop_plan (domain, test_shop, plan, checked_at) VALUES (?,?,?,?)").run(domain, test, test ? "Development" : "Basic", 1);
  sqlite.prepare("INSERT OR IGNORE INTO retailer_connections (id, provider, merchant_external_id) VALUES (?,?,?)").run("shopify:" + domain, "shopify", domain);
}
const product = (shop, pid, title, variants, image) => {
  const conn = "shopify:" + shop, item = conn + ":item:gid://shopify/Product/" + pid;
  sqlite.prepare("INSERT INTO retailer_catalog_items (id, provider, external_item_id, title, image_url) VALUES (?,?,?,?,?)").run(item, conn, "gid://shopify/Product/" + pid, title, image || null);
  for (const [vid, vtitle, price, qty, cur = "GBP"] of variants) {
    const key = conn + ":variant:gid://shopify/ProductVariant/" + vid;
    sqlite.prepare("INSERT INTO retailer_catalog_variants (id, item_id, external_variant_id, title, sku, price_minor, currency) VALUES (?,?,?,?,?,?,?)").run(key, item, "gid://shopify/ProductVariant/" + vid, vtitle, "S" + vid, price, cur);
    sqlite.prepare("INSERT INTO retailer_inventory_snapshots (variant_id, connection_id, quantity, inventory_state) VALUES (?,?,?,?)").run(key, conn, qty, "AGGREGATE");
  }
};
product(OAK, 1, "Court Classic Trainers", [[11, "White / UK 8", 8500, 3]], "https://cdn.example/court.png");
product(BIRCH, 2, "Linen Shirt", [[21, "M", 4500, 4], [22, "L", 4700, 0]]);
product(BIRCH, 3, "Canvas Tote", [[31, "Default Title", 1800, 0], [32, "Euro", 1800, 5, "EUR"]]);
product(FERN, 4, "Test Trainers", [[41, "UK 9", 6000, 6]]);

const PNG = "data:image/png;base64," + Buffer.from("not really a png, just made-up bytes for the test").toString("base64");
let asked = [], reply = { found: true, item: "white leather trainers", matches: [1] }, status = 200, raw = null;
const fetchImpl = async (url, init) => {
  assert.equal(String(url), "https://api.anthropic.com/v1/messages", "only Anthropic is asked");
  const body = JSON.parse(init.body); asked.push({ headers: init.headers, body });
  if (status !== 200) return new Response("{}", { status });
  return new Response(JSON.stringify({ content: [{ type: "text", text: raw !== null ? raw : JSON.stringify(reply) }] }), { status: 200 });
};
const alice = { id: "alice-id", email: "alice@example.com", emailHash: "h-alice" }, bob = { id: "bob-id", email: "bob@example.com", emailHash: "h-bob" };
let clock = 1_800_000_000_000;
// A shop's website in the catalogue preview (web-shops.js), for Relay's testing tools only.
await ensureWebShopTables(db);
sqlite.prepare("INSERT INTO web_shops (domain, label, status, products, items, checked_at, next_at) VALUES (?,?,?,?,?,?,?)").run("hollow-pine.test", "Hollow Pine", "ok", 1, 2, clock, clock + 864e5);
for (const [vid, colour, price, available] of [[71, "Navy", 2800, 0], [72, "Grey", 2500, 1]])
  sqlite.prepare("INSERT INTO web_shop_items (id, domain, product_key, position, product, variation, price_minor, available, image_url, product_url, kind, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("web:hollow-pine.test:" + vid, "hollow-pine.test", "web:hollow-pine.test:7", 0, "Wool Beanie", colour, price, available, "https://cdn.shopify.com/s/files/1/beanie.jpg?width=600", "https://hollow-pine.test/products/wool-beanie?variant=" + vid, "Hats", clock);
const call = async (who, body) => {
  const req = new Request("https://w.test/relay/my/photo-search", { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const r = await handlePhotoSearchRoute(req, env, new URL(req.url), {}, who, { now: clock, fetchImpl });
  return { status: r.status, body: await r.json() };
};

// 1. Off until the AI key is set (and PHOTO_SEARCH=off switches it off); nothing is sent while off.
assert.deepEqual((await call(alice)).body, { available: false, perDay: PHOTO_SEARCHES_PER_DAY });
assert.deepEqual(await call(alice, { image: PNG }), { status: 503, body: { error: "ai_off" } });
env.ANTHROPIC_API_KEY = "sk-ant-test-key";
assert.equal((await call(alice)).body.available, true);
env.PHOTO_SEARCH = "off"; assert.equal((await call(alice)).body.available, false); delete env.PHOTO_SEARCH;
assert.equal(asked.length, 0);
console.log("ok - off until the AI key is set, and can be switched off");

// 2. Only a picture: a JPEG, PNG or WebP data address, not too big.
for (const image of [undefined, "", "https://example.com/x.png", "data:image/gif;base64,R0lGOD", "data:text/html;base64,PGI+", "data:image/png;base64,***", "data:image/png;base64," + "A".repeat(1_700_000)])
  assert.deepEqual(await call(alice, { image }), { status: 400, body: { error: "image_unreadable" } }, "refused: " + String(image).slice(0, 30));
assert.equal(asked.length, 0, "nothing sent for a bad picture");
console.log("ok - only a picture, not too big");

// 3. A search: the picture and the items real shops on Relay sell, nothing about the shopper; Claude's picks, best first.
reply = { found: true, item: "white leather trainers", matches: [1, 99, 1, "2", 0] };
let r = await call(alice, { image: PNG });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.deepEqual([r.body.found, r.body.item, r.body.results.map(x => x.product)], [true, "white leather trainers", ["Court Classic Trainers", "Linen Shirt"]],
  "only list numbers that exist, each once, best first");
assert.deepEqual(r.body.results[1], { sku: "shopify:" + BIRCH + ":variant:gid://shopify/ProductVariant/21", product: "Linen Shirt", variation: null, priceMinor: 4500, maxPriceMinor: 4700,
  currency: "GBP", imageUrl: null, inStock: true, storeName: "Birch Lane" }, "one per product: its prices, and a tap opens a size that can be bought");
assert.deepEqual(r.body.results[0], { sku: "shopify:" + OAK + ":variant:gid://shopify/ProductVariant/11", product: "Court Classic Trainers", variation: "White / UK 8", priceMinor: 8500,
  currency: "GBP", imageUrl: "https://cdn.example/court.png", inStock: true, storeName: "Oak & Thread" });
const sent = asked[0];
assert.equal(sent.headers["x-api-key"], "sk-ant-test-key");
assert.equal(sent.body.model, "claude-haiku-5-5");
const [img, txt] = sent.body.messages[0].content;
assert.deepEqual(img, { type: "image", source: { type: "base64", media_type: "image/png", data: PNG.split(",")[1] } });
assert.equal(txt.text, "Items shops on Relay sell:\n1. Court Classic Trainers · White / UK 8 · Oak & Thread · £85.00\n2. Linen Shirt · Birch Lane · £45.00–£47.00\n3. Canvas Tote · Birch Lane · £18.00 · out of stock",
  "public product details only, one line a product; real shops only (no test shops, no shops' websites); pounds only; in stock first");
assert.ok(!JSON.stringify(sent.body).includes("alice"), "nothing about the shopper");
assert.match(PHOTO_SYSTEM, /Never describe or identify people/);
assert.match(PHOTO_SYSTEM, /ignore names, addresses, messages, prices and other personal details/);
console.log("ok - the picture and real shops' items go to Claude, nothing about the shopper; its picks come back best first");

// 4. Testing tools: test shops' items and the shops' websites preview too, marked.
reply = { found: true, item: "trainers", matches: [4, 5] };
r = await call(alice, { image: PNG, test: true });
assert.match(asked.at(-1).body.messages[0].content[1].text, /\n4\. Test Trainers · UK 9 · Fern Test · £60\.00\n5\. Wool Beanie · Hollow Pine · £25\.00–£28\.00$/);
assert.deepEqual(r.body.results.map(x => [x.product, x.testShop, x.webShop]), [["Test Trainers", true, undefined], ["Wool Beanie", undefined, true]]);
assert.deepEqual([r.body.results[1].sku, r.body.results[1].productUrl, r.body.results[1].inStock], ["web:hollow-pine.test:72", "https://hollow-pine.test/products/wool-beanie?variant=72", true],
  "the colour the shop's website said can be bought, with its link");
console.log("ok - test shops and shops' websites only for the testing tools, marked");

// 5. No product in the picture, an answer that makes no sense, and Anthropic busy or refusing: plain errors, nothing shown.
reply = { found: false, item: "a cat", matches: [1] };
assert.deepEqual((await call(alice, { image: PNG })).body, { found: false, item: null, results: [] });
raw = "Sorry, I can't help with that."; assert.deepEqual(await call(alice, { image: PNG }), { status: 503, body: { error: "busy" } }); raw = null;
status = 429; assert.deepEqual(await call(alice, { image: PNG }), { status: 503, body: { error: "busy" } });
status = 400; assert.deepEqual(await call(alice, { image: PNG }), { status: 400, body: { error: "image_unreadable" } }); status = 200;
assert.deepEqual(cleanAnswer('{"found":true,"item":"  red\\n  dress  ","matches":[3,3,2]}', 2), { found: true, item: "red dress", matches: [2] });
console.log("ok - no product, nonsense, busy or refused: plain answers");

// 6. Nothing of the picture is kept: only that a search happened, for the limits (30 a day each), gone after 2 days.
const everything = JSON.stringify(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(t => sqlite.prepare(`SELECT * FROM ${t.name}`).all()));
assert.ok(!everything.includes(PNG.split(",")[1].slice(0, 30)), "the picture is in no table");
assert.ok(!everything.includes("white leather trainers"), "what Claude said isn't kept either");
const used = sqlite.prepare("SELECT COUNT(*) AS n FROM photo_search_uses WHERE shopper_id = ?").get(alice.id).n;
for (let i = used; i < PHOTO_SEARCHES_PER_DAY; i++) assert.equal((await call(alice, { image: PNG })).status, 200);
assert.deepEqual(await call(alice, { image: PNG }), { status: 429, body: { error: "too_many_searches" } });
assert.equal((await call(bob, { image: PNG })).status, 200, "the limit is each shopper's own");
clock += 3 * 864e5; await call(bob, { image: PNG });
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM photo_search_uses WHERE shopper_id = ?").get(alice.id).n, 0, "old records go after 2 days");
console.log("ok - nothing of the picture or the answer kept; 30 a day each; records gone after 2 days");

// 7. Deleting the account deletes the records.
for (const s of await photoSearchDeleteStatements(db, bob.id)) await s.run();
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM photo_search_uses WHERE shopper_id = ?").get(bob.id).n, 0);
console.log("PASS search by photo: off until the AI key is set, pictures only, real shops' items (test shops for testing), nothing about the shopper sent, nothing of the picture kept, 30 a day");
