// Offline test for the Awin product-feed sync. Awin is faked; nothing leaves this machine.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { syncAwinFeeds, pickRetailers, AWIN_RETAILERS, feedUrl, MAX_RETAILERS_PER_RUN } from "../worker/awin-feed.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
sqlite.exec("ALTER TABLE retailer_catalog_items ADD COLUMN store_label TEXT; ALTER TABLE retailer_catalog_items ADD COLUMN image_url TEXT;");
let queries = 0;
function stmt(sql, args = []) {
  return { sql, args, bind: (...a) => stmt(sql, a),
    async run() { queries++; sqlite.prepare(sql).run(...args); return {}; },
    async first() { queries++; return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { queries++; return { results: sqlite.prepare(sql).all(...args) }; } };
}
const db = { prepare: sql => stmt(sql), async batch(list) { queries++; sqlite.exec("BEGIN"); try { for (const s of list) sqlite.prepare(s.sql).run(...s.args); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AWIN_PUBLISHER_ID: "3134429", AWIN_API_TOKEN: "test-token" };

// 1. IDs are the real ones read from Awin, and the URL matches Awin's documented format.
assert.equal(AWIN_RETAILERS.length, 10);
assert.equal(AWIN_RETAILERS.find(r => r.label === "Currys").advertiserId, "1599");
assert.equal(AWIN_RETAILERS.find(r => r.label === "Marks & Spencer").advertiserId, "1402");
assert.equal(feedUrl("3134429", AWIN_RETAILERS[0]), "https://api.awin.com/publishers/3134429/awinfeeds/download/1599-retail-en_GB.jsonl");

// 2. No token = skipped, nothing touched.
assert.deepEqual(await syncAwinFeeds({ RELAY_DB: db, AWIN_PUBLISHER_ID: "3134429" }), { skipped: true });

// Fake Awin: Currys (1599) is approved, everything else is not.
const line = o => JSON.stringify(o) + "\n";
const currysFeed = [
  line({ product_id: "A1", product_name: "Kettle", description: "1.7L", aw_image_url: "https://img/a1.jpg", search_price: "29.99", currency: "GBP", in_stock: "1", colour: "Black" }),
  line({ product_id: "A1", product_name: "Kettle", search_price: "29.99", currency: "GBP", in_stock: "1", colour: "White" }),
  line({ product_id: "A2", product_name: "Toaster", search_price: "19.50", currency: "GBP", in_stock: "0" }),   // out of stock -> skipped
  line({ product_id: "A3", product_name: "Euro Iron", search_price: "10", currency: "EUR", in_stock: "1" }),    // not GBP -> skipped
  line({ product_id: "A4", product_name: "Headphones", search_price: "49", currency: "GBP", in_stock: "1" }),
].join("");
let requests = [], auth = new Set(), currysMode = "ok";
const fetchImpl = async (url, init) => {
  requests.push(url); auth.add(init.headers.Authorization);
  const id = url.match(/download\/(\d+)-retail/)[1];
  if (id !== "1599" || currysMode === "gone") return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  if (currysMode === "broken") return new Response(currysFeed + line({ error: 500, message: "Internal server error" }), { status: 200 });
  // Deliver in awkward chunks to prove line splitting works across chunk boundaries.
  const bytes = new TextEncoder().encode(currysFeed);
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 37) c.enqueue(bytes.slice(i, i + 37)); c.close(); } }), { status: 200 });
};

// 3. First run: only MAX_RETAILERS_PER_RUN shops are fetched (Awin asks for <= 5 requests a minute).
const t0 = Date.parse("2026-10-27T10:00:00Z");
let r = await syncAwinFeeds(env, { fetchImpl, now: t0 });
assert.equal(requests.length, MAX_RETAILERS_PER_RUN);
assert.deepEqual([...auth], ["Bearer test-token"]);
assert.deepEqual(r.checked, ["Currys", "Marks & Spencer", "Debenhams"]);
assert.deepEqual(r.notAvailable, ["Marks & Spencer", "Debenhams"], "unapproved shops are 'not available', not errors");
assert.deepEqual(r.errors, []);
assert.equal(r.products, 2); // Kettle + Headphones
assert.equal(r.variants, 3); // Kettle Black, Kettle White, Headphones
const items = sqlite.prepare("SELECT id, provider, title, store_label, image_url FROM retailer_catalog_items WHERE provider='awin' ORDER BY id").all();
assert.deepEqual(items.map(i => [i.id, i.store_label]), [["awin:1599:A1", "Currys"], ["awin:1599:A4", "Currys"]]);
assert.equal(items[0].image_url, "https://img/a1.jpg");
const vars = sqlite.prepare("SELECT title, price_minor, currency FROM retailer_catalog_variants WHERE item_id='awin:1599:A1' ORDER BY title").all();
assert.deepEqual(vars.map(v => [v.title, v.price_minor, v.currency]), [["Black", 2999, "GBP"], ["White", 2999, "GBP"]]);

// 4. Next runs work through the remaining shops; nothing is re-fetched early.
requests = [];
r = await syncAwinFeeds(env, { fetchImpl, now: t0 + 60 * 60 * 1000 });
assert.deepEqual(r.checked, ["adidas", "Clarks", "Schuh"]);
requests = [];
await syncAwinFeeds(env, { fetchImpl, now: t0 + 2 * 3600e3 });
await syncAwinFeeds(env, { fetchImpl, now: t0 + 3 * 3600e3 });
r = await syncAwinFeeds(env, { fetchImpl, now: t0 + 4 * 3600e3 });
assert.deepEqual(r.checked, [], "every shop has been tried; nothing is due yet");

// 5. After 6 hours the approved shop is refreshed; unapproved shops wait a full day. Upsert keeps it at 2 products.
const due = await pickRetailers(db, t0 + 7 * 3600e3);
assert.deepEqual(due.map(x => x.label), ["Currys"]);
r = await syncAwinFeeds(env, { fetchImpl, now: t0 + 7 * 3600e3 });
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM retailer_catalog_items WHERE provider='awin'").get().n, 2);

// 6. A download that fails part-way is an error (not silently treated as complete).
currysMode = "broken";
r = await syncAwinFeeds(env, { fetchImpl, now: t0 + 14 * 3600e3 });
assert.equal(r.errors.length, 1);
assert.match(r.errors[0].error, /stopped part-way/);

// 7. If Currys stops giving us its feed (rejected us / we left), its products are removed.
currysMode = "gone";
r = await syncAwinFeeds(env, { fetchImpl, now: t0 + 21 * 3600e3 });
assert.deepEqual(r.notAvailable.includes("Currys"), true);
assert.equal(r.removed, 2);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM retailer_catalog_items WHERE provider='awin'").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM retailer_catalog_variants WHERE item_id LIKE 'awin:%'").get().n, 0);

// 8. Other shops' products are never touched.
sqlite.prepare("INSERT INTO retailer_catalog_items (id, provider, external_item_id, title) VALUES ('sq:1','square_sandbox','1','Mug')").run();
await syncAwinFeeds(env, { fetchImpl, now: t0 + 60 * 3600e3 });
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM retailer_catalog_items WHERE provider='square_sandbox'").get().n, 1);

console.log("test-awin-feed: all checks passed");
