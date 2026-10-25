// Offline tests for Relay for retailers: shop keys, watch-demand figures and offers sent to watchers.
// The push service is a stand-in; a pretend phone decrypts what it receives. Nothing leaves this machine.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleRetailerRoute, issueRetailerKey } from "../worker/retailer.js";
import { ensurePushTables, b64u, handlePushRoute, runPriceAlerts } from "../worker/push.js";
import { ensureSquareMerchantSchema } from "../worker/square-connect.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; }, _exec() { sqlite.prepare(sql).run(...args); } };
}
const db = { prepare: sql => stmt(sql), async batch(list) { list.forEach(s => s._exec()); return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789" };
await ensurePushTables(db); await ensureSquareMerchantSchema(db);

let pushes = [];
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://fcm.googleapis.com/")) { pushes.push({ url: String(url), body: init.body }); return new Response("", { status: 201 }); }
  throw Error("unexpected network call to " + url);
};
let now = 1_800_000_000_000;

// Two shops' catalogues.
const item = (id, title, label, variants, img = null) => {
  sqlite.prepare("INSERT INTO retailer_catalog_items (id, provider, external_item_id, title, store_label, image_url) VALUES (?,?,?,?,?,?)").run("i:" + id, "square_sandbox", id, title, label, img);
  for (const [vid, vt, sku, p] of variants) sqlite.prepare("INSERT INTO retailer_catalog_variants (id, item_id, external_variant_id, title, sku, price_minor, currency) VALUES (?,?,?,?,?,?,?)").run("v:" + vid, "i:" + id, vid, vt, sku, p, "GBP");
};
item("SCF", "Knit Scarf", "Zara", [["SCF1", "One size", "ZAR-SCF-1", 1799]], "https://images.example/scarf.png");
item("COAT", "Tailored Wool Coat", "Zara", [["COAT1", "M", "ZAR-COAT-M", 11900]]);
item("SKIRT", "Pleated Midi Skirt", "Zara", [["SK1", "S", "ZAR-SKT-S", 2999]]);
item("CND", "Argan Oil Conditioner", "Health & Beauty Company", [["CND1", "250ml", "HBC-CND-250", 899]]);
sqlite.prepare("INSERT INTO square_merchants (merchant_id, label, access_iv, access_data, created_at) VALUES (?,?,?,?,?)").run("MZARA1", "Zara", "x", "x", now);
sqlite.prepare("INSERT INTO square_merchants (merchant_id, label, access_iv, access_data, created_at) VALUES (?,?,?,?,?)").run("MHBC1", "Health & Beauty Company", "x", "x", now);

// Shoppers and their watches.
const watch = (shopper, sku, product, store, via = "item", at = now) =>
  sqlite.prepare("INSERT INTO price_watches (shopper_id, sku, product, variant, store, via, baseline_minor, last_seen_minor, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(shopper, sku, product, null, store, via, 0, 0, at);
watch("alice-id", "ZAR-SCF-1", "Knit Scarf", "Zara");
watch("bob-id", "ZAR-SCF-1", "Knit Scarf", "Zara", "item", now - 10 * 86400000);
watch("cara-id", "ZAR-COAT-M", "Tailored Wool Coat", "Zara");
watch("dan-id", "ZAR-SCF-1", "Knit Scarf", "Zara", "store");     // follows the whole shop
sqlite.prepare("INSERT INTO store_optins (shopper_id, store, created_at) VALUES (?,?,?)").run("dan-id", "Zara", now);
watch("alice-id", "HBC-CND-250", "Argan Oil Conditioner", "Health & Beauty Company");
watch("erin-id", "GONE-SKU", "Old thing", "Zara");                 // no longer in Zara's catalogue
watch("fay-id", "ZAR-SCF-1", "Knit Scarf", "Zara"); watch("gus-id", "ZAR-SCF-1", "Knit Scarf", "Zara");
// An item priced in dollars never counts: Relay is for UK shops selling in pounds.
sqlite.prepare("INSERT INTO retailer_catalog_items (id, provider, external_item_id, title, store_label) VALUES (?,?,?,?,?)").run("i:USD", "square_sandbox", "USD", "Dollar Hat", "Zara");
sqlite.prepare("INSERT INTO retailer_catalog_variants (id, item_id, external_variant_id, title, sku, price_minor, currency) VALUES (?,?,?,?,?,?,?)").run("v:USD1", "i:USD", "USD1", "One size", "ZAR-USD-1", 2000, "USD");
watch("hal-id", "ZAR-USD-1", "Dollar Hat", "Zara"); watch("ida-id", "ZAR-USD-1", "Dollar Hat", "Zara"); watch("jon-id", "ZAR-USD-1", "Dollar Hat", "Zara");

async function phone() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
  return { kp, pub, auth };
}
async function read(ph, body) {
  const b = new Uint8Array(body), salt = b.slice(0, 16), idlen = b[20], asPub = b.slice(21, 21 + idlen), cipher = b.slice(21 + idlen);
  const hk = async (s, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []) }, ph.kp.privateKey, 256));
  const T = new TextEncoder(), cat = (...a) => Uint8Array.from(a.flatMap(x => [...x]));
  const prk = await hk(ph.auth, secret, cat(T.encode("WebPush: info\0"), ph.pub, asPub), 32);
  const cek = await hk(salt, prk, T.encode("Content-Encoding: aes128gcm\0"), 16), nonce = await hk(salt, prk, T.encode("Content-Encoding: nonce\0"), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), cipher));
  return JSON.parse(new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2))));
}
const phones = {};
for (const who of ["alice-id", "bob-id", "cara-id", "dan-id"]) {
  phones[who] = await phone();
  sqlite.prepare("INSERT INTO push_subscriptions (id, shopper_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)").run("s-" + who, who, "https://fcm.googleapis.com/fcm/send/" + who, b64u(phones[who].pub), b64u(phones[who].auth), now);
}

const call = (path, { method = "GET", key, body } = {}) =>
  handleRetailerRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", ...(key ? { authorization: "Bearer " + key } : {}) }, body: body ? JSON.stringify(body) : undefined }),
    env, new URL("https://w.test" + path), {}, { now, fetchImpl });

// 1. No key, a made-up key, or a malformed key sees nothing.
for (const key of [undefined, "rk_" + "A".repeat(43), "not-a-key"]) assert.equal((await call("/relay/retailer/demand", { key })).status, 401);

// 2. A key is shown once and only its hash is kept.
const zara = await issueRetailerKey(env, { provider: "square", shopRef: "MZARA1", storeLabel: "Zara" }, now);
const hbc = await issueRetailerKey(env, { provider: "square", shopRef: "MHBC1", storeLabel: "Health & Beauty Company" }, now);
assert.match(zara, /^rk_[A-Za-z0-9_-]{43}$/);
assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM retailer_keys").all()).includes(zara), "the key itself is never stored");

// 3. Zara sees counts for its own watched items only, busiest first, and nothing that identifies a shopper.
//    Any count under 3 is shown only as "fewer than 3", so a shop can't single out one shopper.
const d = await (await call("/relay/retailer/demand", { key: zara })).json();
assert.equal(d.store, "Zara");
assert.deepEqual(d.watchedItems.map(i => [i.sku, i.watchers, i.watchersText, i.viaShopFollow, i.newThisWeek]), [["ZAR-SCF-1", 4, "4", null, 3], ["ZAR-COAT-M", null, "Fewer than 3", null, null]]);
assert.equal(d.followers, null); assert.equal(d.followersText, "Fewer than 3");
assert.equal(d.shoppersWatchingItems, 5); assert.equal(d.itemsInCatalogue, 3, "the dollar-priced item is not counted");
assert.ok(!JSON.stringify(d).includes("ZAR-USD-1"), "items in another currency never show");
assert.equal(d.watchedItems[0].imageUrl, "https://images.example/scarf.png");
const text = JSON.stringify(d);
for (const secret of ["alice", "bob", "cara", "dan", "erin", "fay", "gus", "HBC-CND-250", "Argan"]) assert.ok(!text.includes(secret), "Zara's figures never show " + secret);

const offer0 = (key, body) => call("/relay/retailer/offers", { method: "POST", key, body });
// 4. Health & Beauty only sees its own item.
const h = await (await call("/relay/retailer/demand", { key: hbc })).json();
assert.deepEqual(h.watchedItems.map(i => [i.sku, i.watchers, i.watchersText]), [["HBC-CND-250", null, "Fewer than 3"]]);
assert.equal((await offer0(zara, { sku: "ZAR-USD-1", offerMinor: 1000 })).status, 404, "no offers on items priced in another currency");

// 5. Offers: must be the shop's own item, lower than today's price, sensible length.
const offer = (key, body) => call("/relay/retailer/offers", { method: "POST", key, body });
assert.equal((await offer(zara, { sku: "HBC-CND-250", offerMinor: 500 })).status, 404, "a shop can't send an offer on another shop's item");
assert.equal((await offer(zara, { sku: "ZAR-SCF-1", offerMinor: 1799 })).status, 400, "an offer must be lower than the current price");
assert.equal((await offer(zara, { sku: "ZAR-SCF-1", offerMinor: 1200, hours: 500 })).status, 400);
assert.equal((await offer(zara, { sku: "ZAR-SCF-1", offerMinor: -1 })).status, 400);
assert.equal(pushes.length, 0, "rejected offers send nothing");

// 6. A good offer reaches every watcher of that item (item watchers and shop followers), and nobody else.
const ok = await offer(zara, { sku: "ZAR-SCF-1", offerMinor: 1299, hours: 24, note: "In store and online" });
assert.equal(ok.status, 200);
const o = (await ok.json()).offer;
assert.equal(o.shoppers, 5); assert.equal(o.devices, undefined, "the shop is never told how many devices");
assert.deepEqual(pushes.map(p => p.url.split("/").pop()).sort(), ["alice-id", "bob-id", "dan-id"]);
const msg = await read(phones["alice-id"], pushes.find(p => p.url.endsWith("alice-id")).body);
assert.equal(msg.title, "Offer from Zara");
assert.match(msg.body, /^Knit Scarf · One size: £12\.99 for Relay watchers \(usually £17\.99\)\. Ends .+\. In store and online$/);

// 6b. Shoppers see live offers on items they watch inside the app; nobody else sees them.
const myOffers = async (id) => (await (await handlePushRoute(new Request("https://w.test/relay/my/alerts/offers"), env, new URL("https://w.test/relay/my/alerts/offers"), {}, { id }, { now })).json()).offers;
const aliceOffers = await myOffers("alice-id");
assert.deepEqual(aliceOffers.map(x => [x.store, x.product, x.offerMinor, x.wasMinor, x.imageUrl]), [["Zara", "Knit Scarf", 1299, 1799, "https://images.example/scarf.png"]]);
assert.equal((await myOffers("dan-id")).length, 1, "shop followers see it too");
assert.equal((await myOffers("cara-id")).length, 0, "someone watching a different item sees nothing");
assert.ok(!JSON.stringify(aliceOffers).includes("bob"), "no other shopper appears");
// 7. One running offer per item; the shop can list what it sent.
assert.equal((await offer(zara, { sku: "ZAR-SCF-1", offerMinor: 1199 })).status, 409);
const list = await (await call("/relay/retailer/offers", { key: zara })).json();
assert.equal(list.offers.length, 1); assert.equal(list.offers[0].active, true);
assert.equal((await (await call("/relay/retailer/offers", { key: hbc })).json()).offers.length, 0, "shops never see each other's offers");

// 8. An offer to an item nobody watches sends nothing but is still recorded honestly.
pushes = [];
const quiet = await (await offer(zara, { sku: "ZAR-SKT-S", offerMinor: 1999 })).json();
assert.equal(quiet.offer.shoppers, null); assert.equal(quiet.offer.shoppersText, "0"); assert.equal(pushes.length, 0);

// 9. Only the newest few keys for a shop keep working.
const keys = [];
for (let i = 0; i < 6; i++) keys.push(await issueRetailerKey(env, { provider: "square", shopRef: "MZARA1", storeLabel: "Zara" }, now + 1000 + i));
assert.equal((await call("/relay/retailer/demand", { key: keys[0] })).status, 401);
assert.equal((await call("/relay/retailer/demand", { key: keys[5] })).status, 200);
// 10. An offer that has ended disappears from the app.
now += 8 * 86400000;
assert.equal((await myOffers("alice-id")).length, 0, "ended offers are not shown");
// 11. Two alert choices: "my watchlist" (default) or "price drops at every shop".
const my = (id, path, body) => handlePushRoute(new Request("https://w.test" + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }),
  env, new URL("https://w.test" + path), {}, { id }, { now, fetchImpl });
assert.equal((await (await my("cara-id", "/relay/my/alerts/status")).json()).allShops, false, "watchlist only by default");
assert.equal((await (await my("alice-id", "/relay/my/alerts/mode", { mode: "all" })).json()).allShops, true);
await runPriceAlerts(env, { now, fetchImpl });            // first look only records every price
pushes = [];
sqlite.prepare("UPDATE retailer_catalog_variants SET price_minor = 2499 WHERE sku = 'ZAR-SKT-S'").run();   // nobody watches the skirt
await runPriceAlerts(env, { now, fetchImpl });
assert.deepEqual(pushes.map(p => p.url.split("/").pop()), ["alice-id"], "only the shopper who chose every shop hears about an unwatched item");
const everyMsg = await read(phones["alice-id"], pushes[0].body);
assert.equal(everyMsg.title, "Price drop at Zara"); assert.match(everyMsg.body, /^Pleated Midi Skirt · S is now £24\.99 \(was £29\.99\)$/);
pushes = []; await runPriceAlerts(env, { now, fetchImpl });
assert.equal(pushes.length, 0, "the same drop is never sent twice");
await my("alice-id", "/relay/my/alerts/mode", { mode: "watchlist" });
sqlite.prepare("UPDATE retailer_catalog_variants SET price_minor = 1999 WHERE sku = 'ZAR-SKT-S'").run();
pushes = []; await runPriceAlerts(env, { now, fetchImpl });
assert.equal(pushes.length, 0, "back on watchlist-only: unwatched items stay quiet");
console.log("retailer: all checks passed");
