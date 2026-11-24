// The shopping bag (worker/bag.js), against a real SQLite engine. Made-up shops and products only; nothing reaches a shop
// (the shops' storefronts and Shopify are stand-ins). Checks: signed-in shoppers only; only products Relay shows can go in
// (a connected shop's, a shop's website's), never a test shop's or one Relay doesn't know, and what's kept comes from
// Relay's catalogue, not the app; adding, more of the same, setting and taking out; the limits (10 each, 30 things); the
// field rules; each account sees only its own; "I've paid at this shop" takes only that shop's things out; the price check
// asks the shop's own storefront, keeps the new price, says what sold out, can't be pointed at another address, says when
// it couldn't check, and is limited each day; the data export has the bag; deleting the account deletes it.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { checkBody } from "../worker/validate.js";
import { ensureWebShopTables } from "../worker/web-shops.js";
import { ensureShopPlanTable } from "../worker/shopify.js";
import { BAG_CHECKS_PER_DAY } from "../worker/bag.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    async run() { sqlite.prepare(sql).run(...args); return {}; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); }
  };
}
const db = { prepare: sql => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { list.forEach(s => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
// Two made-up connected Shopify shops: Juniper Row is a real shop, Test Kiln one of Relay's test shops.
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key",
  SHOPIFY_STORE_1_DOMAIN: "juniper-row.myshopify.com", SHOPIFY_STORE_1_ADMIN_ACCESS_TOKEN: "stand-in", SHOPIFY_STORE_1_CATALOGUE_PUBLIC: "true", SHOPIFY_STORE_1_LABEL: "Juniper Row",
  SHOPIFY_STORE_2_DOMAIN: "test-kiln.myshopify.com", SHOPIFY_STORE_2_ADMIN_ACCESS_TOKEN: "stand-in", SHOPIFY_STORE_2_CATALOGUE_PUBLIC: "true", SHOPIFY_STORE_2_LABEL: "Test Kiln" };
let emails = [], asked = [];
// What the shops say now. Hollow Pine's website: the beanie went up to £32 and the jumper's size M sold out.
const live = { beanie: { id: 101, price: 3200, available: true }, jumperM: { id: 202, price: 7900, available: false }, jumperL: { id: 203, price: 7900, available: true } };
let shopifyLive = { price: "60.00", availableForSale: true };
const fetchImpl = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://api.resend.com/")) { emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  asked.push(u);
  if (u === "https://hollow-pine.example/products/wool-beanie.js") return Response.json({ variants: [live.beanie] });
  if (u === "https://hollow-pine.example/products/ribbed-jumper.js") return Response.json({ variants: [live.jumperM, live.jumperL] });
  if (u === "https://juniper-row.myshopify.com/admin/api/2026-07/graphql.json") {
    const ids = JSON.parse(init.body).variables.ids;
    return Response.json({ data: { nodes: ids.map(id => ({ id, price: shopifyLive.price, availableForSale: shopifyLive.availableForSale, product: { status: "ACTIVE" } })) } });
  }
  return new Response("{}", { status: 404 });
};
const listStores = async () => [{ domain: "juniper-row.myshopify.com", token: "stand-in" }];
const clock = 1_800_000_000_000;
const call = (path, { method = "GET", body, raw, token, ip = "1.1.1.1", now = clock } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now, fetchImpl, listStores });
async function signIn(email, ip) {
  emails = [];
  assert.equal((await call("/relay/auth/request", { method: "POST", body: { email }, ip })).status, 200);
  const token = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  const r = await call("/relay/auth/verify", { method: "POST", body: { token } });
  assert.equal(r.status, 200);
  return (await r.json()).sessionToken;
}

// Relay's catalogue: a shop's website (Hollow Pine, read from /products.json), one read from its product pages (Saltmarsh,
// no basket Relay can fill), and the two connected shops.
await ensureWebShopTables(db); await ensureShopPlanTable(db);
sqlite.exec(`INSERT INTO web_shops (domain, label, origin, status, products, items, checked_at, next_at) VALUES
  ('hollow-pine.example', 'Hollow Pine', 'https://hollow-pine.example', 'ok', 2, 3, ${clock}, ${clock}),
  ('www.marksandspencer.com', 'M&S', 'https://www.marksandspencer.com', 'ok', 1, 1, ${clock}, ${clock})`);
const webItem = (id, key, product, variation, price, url, domain = "hollow-pine.example", available = 1) =>
  sqlite.prepare("INSERT INTO web_shop_items (id, domain, product_key, position, product, variation, price_minor, available, image_url, product_url, kind, checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, domain, key, 0, product, variation, price, available, "https://img.example/" + key + ".jpg", url, null, clock);
webItem("web:hollow-pine.example:101", "p1", "Wool Beanie", null, 2800, "https://hollow-pine.example/products/wool-beanie?variant=101");
webItem("web:hollow-pine.example:202", "p2", "Ribbed Jumper", "M", 7900, "https://hollow-pine.example/products/ribbed-jumper?variant=202");
webItem("web:hollow-pine.example:203", "p2", "Ribbed Jumper", "L", 7900, "https://hollow-pine.example/products/ribbed-jumper?variant=203");
webItem("web:hollow-pine.example:204", "p2", "Ribbed Jumper", "XL", 7900, "https://hollow-pine.example/products/ribbed-jumper?variant=204", "hollow-pine.example", 0);
webItem("web:www.marksandspencer.com:p60001:1", "p3", "Cotton Socks", "Navy", 900, "https://www.marksandspencer.com/cotton-socks/p/clp60001", "www.marksandspencer.com");
sqlite.exec(`INSERT INTO shopify_shop_plan (domain, test_shop, plan, checked_at) VALUES ('juniper-row.myshopify.com', 0, 'Basic', ${clock}), ('test-kiln.myshopify.com', 1, 'Development', ${clock})`);
const JUNIPER = "shopify:juniper-row.myshopify.com:variant:gid://shopify/ProductVariant/1", KILN = "shopify:test-kiln.myshopify.com:variant:gid://shopify/ProductVariant/9";
sqlite.exec(`INSERT INTO retailer_catalog_items (id, provider, external_item_id, title) VALUES
  ('shopify:juniper-row.myshopify.com:item:1', 'shopify:juniper-row.myshopify.com', 'gid://shopify/Product/1', 'Oak Stool'),
  ('shopify:test-kiln.myshopify.com:item:9', 'shopify:test-kiln.myshopify.com', 'gid://shopify/Product/9', 'Test Mug')`);
sqlite.prepare("INSERT INTO retailer_catalog_variants (id, item_id, external_variant_id, title, sku, price_minor, currency) VALUES (?,?,?,?,?,?,?)").run(JUNIPER, "shopify:juniper-row.myshopify.com:item:1", "gid://shopify/ProductVariant/1", "Default Title", null, 6000, "GBP");
sqlite.prepare("INSERT INTO retailer_catalog_variants (id, item_id, external_variant_id, title, sku, price_minor, currency) VALUES (?,?,?,?,?,?,?)").run(KILN, "shopify:test-kiln.myshopify.com:item:9", "gid://shopify/ProductVariant/9", "Blue", null, 1200, "GBP");

const jess = await signIn("jess@example.com", "3.3.3.3");
const jessPhone = await signIn("jess@example.com", "3.3.3.4");
const sam = await signIn("sam@example.com", "4.4.4.4");
const bag = async t => { const r = await call("/relay/my/bag", { token: t }); assert.equal(r.status, 200); return r.json(); };
const put = (t, body, raw) => call("/relay/my/bag", { method: "POST", token: t, body, raw });

// 1. Signed-in shoppers only.
for (const [p, m] of [["/relay/my/bag", "GET"], ["/relay/my/bag", "POST"], ["/relay/my/bag/paid", "POST"], ["/relay/my/bag/check", "POST"]])
  assert.equal((await call(p, { method: m, body: m === "POST" ? { shop: "hollow-pine.example" } : undefined })).status, 401, p + " needs a sign-in");
assert.deepEqual(await bag(jess), { items: [], updatedAt: null }, "a new account's bag is empty");
console.log("ok - signed-in shoppers only; a new bag is empty");

// 2. Adding: only products Relay shows, with what Relay knows about them.
let r = await put(jess, { sku: "web:hollow-pine.example:101", qty: 1, add: true });
assert.equal(r.status, 200);
let b = await r.json();
assert.equal(b.items.length, 1);
assert.deepEqual({ ...b.items[0], addedAt: undefined }, { sku: "web:hollow-pine.example:101", kind: "web", product: "Wool Beanie", variation: null, priceMinor: 2800,
  imageUrl: "https://img.example/p1.jpg", productUrl: "https://hollow-pine.example/products/wool-beanie?variant=101", shop: "Hollow Pine", shopKey: "hollow-pine.example",
  origin: "https://hollow-pine.example", variantId: "101", cart: true, qty: 1, addedAt: undefined }, "what's kept comes from Relay's catalogue");
assert.equal((await put(jess, { sku: "web:hollow-pine.example:101", qty: 2, add: true })).status, 200);
assert.equal((await bag(jessPhone)).items[0].qty, 3, "adding the same again adds to it, and another device of the account sees it");
assert.equal((await put(jess, { sku: "web:hollow-pine.example:101", qty: 9, add: true })).status, 200);
assert.equal((await bag(jess)).items[0].qty, 10, "never more than 10 of one thing");
assert.equal((await put(jess, { sku: "web:hollow-pine.example:101", qty: 2 })).status, 200);
assert.equal((await bag(jess)).items[0].qty, 2, "setting how many");
assert.equal((await put(jess, { sku: "web:hollow-pine.example:202", qty: 1, add: true })).status, 200);
assert.equal((await put(jess, { sku: "web:hollow-pine.example:203", qty: 2, add: true })).status, 200);
assert.equal((await put(jess, { sku: JUNIPER, qty: 1, add: true })).status, 200);
assert.equal((await put(jess, { sku: "web:www.marksandspencer.com:p60001:1", qty: 1, add: true })).status, 200);
b = await bag(jess);
const oak = b.items.find(x => x.sku === JUNIPER), socks = b.items.find(x => x.shopKey === "www.marksandspencer.com");
assert.deepEqual([oak.product, oak.variation, oak.priceMinor, oak.shop, oak.origin, oak.variantId, oak.cart], ["Oak Stool", null, 6000, "Juniper Row", "https://juniper-row.myshopify.com", "1", true], "a connected shop's product");
assert.equal(socks.cart, false, "a shop read from its product pages has no basket Relay can fill");
assert.equal((await put(jess, { sku: KILN, qty: 1, add: true })).status, 404, "a test shop's product never goes in");
assert.equal((await put(jess, { sku: "web:hollow-pine.example:999", qty: 1, add: true })).status, 404, "nor one Relay doesn't know");
assert.equal((await put(jess, { sku: "web:hollow-pine.example:204", qty: 1, add: true })).status, 409, "nor one sold out when Relay last looked");
assert.equal((await put(jess, { sku: "relay-demo-1", qty: 1, add: true })).status, 404);
assert.equal((await bag(jess)).items.length, 5);
console.log("ok - only products Relay shows go in, details from Relay's catalogue; more of the same adds up, 10 at most; test shops never");

// 3. The field rules and the route's own checks.
const checked = async (path, body) => (await checkBody(new Request("https://w.test" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), path)).response;
assert.equal(await checked("/relay/my/bag", { sku: "web:a:1", qty: 2, add: true }), undefined);
for (const bad of [{ sku: "x", qty: 11 }, { sku: "x", qty: -1 }, { sku: "x", qty: 1.5 }, { sku: "x".repeat(201) }, { sku: "x", priceMinor: 1 }, { sku: "x", imageUrl: "https://evil.example/a.png" }, { sku: "x", shop: "y" }]) {
  const res = await checked("/relay/my/bag", bad); assert.ok(res && res.status === 400, "the field rules refuse " + JSON.stringify(bad));
}
for (const path of ["/relay/my/bag/paid", "/relay/my/bag/check"]) {
  assert.equal(await checked(path, { shop: "hollow-pine.example" }), undefined);
  for (const bad of [{ shop: "x".repeat(121) }, { shop: "a", origin: "https://evil.example" }, { shop: 3 }]) { const res = await checked(path, bad); assert.ok(res && res.status === 400, path + " refuses " + JSON.stringify(bad)); }
}
for (const bad of [{}, { sku: "web:hollow-pine.example:101" }, { sku: "web:hollow-pine.example:101", qty: 0, add: true }, { sku: 4, qty: 1 }]) assert.equal((await put(jess, bad)).status, 400, "the route refuses " + JSON.stringify(bad));
assert.equal((await put(jess, undefined, "not json")).status, 400);
assert.equal((await call("/relay/my/bag", { method: "PUT", token: jess, body: { sku: "a", qty: 1 } })).status, 405);
assert.equal((await bag(jess)).items.length, 5, "a refused change leaves the bag as it was");
console.log("ok - the field rules and the route refuse anything else, and the bag stays as it was");

// 4. Each account its own.
assert.deepEqual((await bag(sam)).items, [], "another account sees only its own");
assert.equal((await put(sam, { sku: "web:hollow-pine.example:101", qty: 1, add: true })).status, 200);
assert.equal((await call("/relay/my/bag/paid", { method: "POST", token: sam, body: { shop: "juniper-row.myshopify.com" } })).status, 200);
assert.equal((await call("/relay/my/bag/check", { method: "POST", token: sam, body: { shop: "juniper-row.myshopify.com" } })).status, 404, "nothing of Juniper Row's in Sam's bag to check");
assert.equal((await bag(jess)).items.length, 5, "another shopper's 'paid' never touches Jess's bag");
assert.equal((await bag(sam)).items.length, 1);
console.log("ok - each account sees and changes only its own bag");

// 5. The price check: the shop's own storefront, the new price kept, sold out said.
asked = [];
r = await call("/relay/my/bag/check", { method: "POST", token: jess, body: { shop: "hollow-pine.example" } });
assert.equal(r.status, 200);
let c = await r.json();
assert.deepEqual(asked.sort(), ["https://hollow-pine.example/products/ribbed-jumper.js", "https://hollow-pine.example/products/wool-beanie.js"], "one look per product, at the address Relay keeps");
assert.equal(c.cart, true);
const res = sku => c.results.find(x => x.sku === sku);
assert.deepEqual(res("web:hollow-pine.example:101"), { sku: "web:hollow-pine.example:101", checked: true, priceMinor: 3200, was: 2800, available: true }, "the beanie went up");
assert.equal(res("web:hollow-pine.example:202").available, false, "size M sold out");
assert.equal(res("web:hollow-pine.example:203").available, true);
b = await bag(jess);
assert.equal(b.items.find(x => x.sku === "web:hollow-pine.example:101").priceMinor, 3200, "the bag keeps the new price");
assert.equal(b.items.find(x => x.sku === "web:hollow-pine.example:202").soldOut, true);
// A connected shop: its own Shopify.
shopifyLive = { price: "55.00", availableForSale: true };
c = await (await call("/relay/my/bag/check", { method: "POST", token: jess, body: { shop: "juniper-row.myshopify.com" } })).json();
assert.deepEqual(c.results, [{ sku: JUNIPER, checked: true, priceMinor: 5500, was: 6000, available: true }], "a connected shop's own Shopify says the price now");
// A shop Relay can't fill a basket at: nothing asked, and said.
asked = [];
c = await (await call("/relay/my/bag/check", { method: "POST", token: jess, body: { shop: "www.marksandspencer.com" } })).json();
assert.equal(c.cart, false); assert.equal(c.results[0].checked, false); assert.deepEqual(asked, [], "nothing asked of a shop whose basket Relay can't fill");
// A shop's website that doesn't answer: said it couldn't check, price left as it was.
sqlite.exec("UPDATE web_shops SET status = 'blocked' WHERE domain = 'hollow-pine.example'");
asked = [];
c = await (await call("/relay/my/bag/check", { method: "POST", token: jess, body: { shop: "hollow-pine.example" } })).json();
assert.deepEqual(asked, [], "a shop that no longer lets Relay read it isn't asked");
assert.ok(c.results.every(x => x.checked === false), "says it couldn't check");
sqlite.exec("UPDATE web_shops SET status = 'ok' WHERE domain = 'hollow-pine.example'");
// The address asked can't come from the app: a stored product address on another site is never fetched.
sqlite.exec("UPDATE shopper_bag SET items = replace(items, 'https://hollow-pine.example/products/wool-beanie', 'https://evil.example/products/wool-beanie') WHERE items LIKE '%wool-beanie%'");
asked = [];
await call("/relay/my/bag/check", { method: "POST", token: jess, body: { shop: "hollow-pine.example" } });
assert.ok(asked.every(u => u.startsWith("https://hollow-pine.example/")), "only the shop's own address: " + asked.join(", "));
assert.equal((await call("/relay/my/bag/check", { method: "POST", token: jess, body: { shop: "nowhere.example" } })).status, 404);
// The daily limit.
for (let i = 0; i < BAG_CHECKS_PER_DAY; i++) await call("/relay/my/bag/check", { method: "POST", token: sam, body: { shop: "hollow-pine.example" } });
assert.equal((await call("/relay/my/bag/check", { method: "POST", token: sam, body: { shop: "hollow-pine.example" } })).status, 429, BAG_CHECKS_PER_DAY + " checks a day");
assert.equal((await call("/relay/my/bag/check", { method: "POST", token: sam, body: { shop: "hollow-pine.example" }, now: clock + 864e5 })).status, 200, "and again the next day");
console.log("ok - the price check asks the shop's own storefront, keeps new prices, says what sold out or couldn't be checked, never another address, limited each day");

// 6. Paid at one shop: only that shop's things leave the bag.
assert.equal((await call("/relay/my/bag/paid", { method: "POST", token: jess, body: { shop: "hollow-pine.example" } })).status, 200);
b = await bag(jess);
assert.deepEqual(b.items.map(x => x.shopKey).sort(), ["juniper-row.myshopify.com", "www.marksandspencer.com"]);
assert.equal((await put(jess, { sku: JUNIPER, qty: 0 })).status, 200, "0 takes one out");
assert.deepEqual((await bag(jess)).items.map(x => x.shopKey), ["www.marksandspencer.com"]);
console.log("ok - 'I've paid at this shop' takes only that shop's things out; 0 takes one out");

// 7. Download my data, and deleting the account.
const exp = await (await call("/relay/my/export", { token: jess })).json();
assert.deepEqual(exp.bag.items.map(x => [x.shop, x.product, x.variation, x.quantity, x.priceMinor]), [["M&S", "Cotton Socks", "Navy", 1, 900]], "Download my data has the bag");
assert.equal((await call("/relay/my/delete", { method: "POST", token: sam })).status, 200);
assert.equal((await call("/relay/my/delete", { method: "POST", token: jess })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shopper_bag").get().n, 0, "deleting the account deletes the bag");
console.log("ok - in Download my data; deleted with the account");
console.log("PASS shopping bag: owner only, Relay's own products only (never test shops'), checked from the shop's storefront, exported and deleted");
