// Offline test for the catalogue preview from shops' own websites (worker/web-shops.js). The websites are stand-ins;
// nothing leaves this machine. Made-up shops and products.
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { parseRobots, robotsAllow, readShop, refreshWebShops, handleWebShopsRoute, webShopProducts, shopRows, USER_AGENT, PRODUCTS_PER_SHOP, SHOW_FOR, WEB_SHOPS } from "../worker/web-shops.js";

// 1. robots.txt, as RFC 9309 reads it.
const SHOPIFY_DEFAULT = `# we use Shopify as our ecommerce platform\r\n\r\nUser-agent: *\r\nDisallow: /a/downloads/-/*\r\nDisallow: /admin\r\nDisallow: /cart\r\nDisallow: /orders\r\nDisallow: /checkouts/\r\nDisallow: /checkout\r\nDisallow: /collections/*sort_by*\r\nDisallow: /*/collections/*sort_by*\r\nDisallow: /search\r\nDisallow: /policies/\r\nSitemap: https://shop.test/sitemap.xml\r\n`;
const allow = (txt, path) => robotsAllow(parseRobots(txt), path);
assert.equal(allow(SHOPIFY_DEFAULT, "/products.json?limit=100"), true, "Shopify's usual rules allow the product list");
assert.equal(allow(SHOPIFY_DEFAULT, "/meta.json"), true);
assert.equal(allow(SHOPIFY_DEFAULT, "/collections/all?sort_by=price"), false, "wildcards");
assert.equal(allow(SHOPIFY_DEFAULT, "/cart.js"), false, "a rule is a prefix");
assert.equal(allow("User-agent: *\nDisallow: /", "/products.json?limit=100"), false, "everything disallowed");
assert.equal(allow("User-agent: *\nDisallow:", "/products.json"), true, "an empty disallow allows everything");
assert.equal(allow("", "/products.json"), true, "no rules: allowed");
assert.equal(allow("User-agent: RelayBot\nDisallow: /products.json\n\nUser-agent: *\nAllow: /", "/products.json?limit=100"), false, "RelayBot's own group comes first");
assert.equal(allow("User-agent: relaybot/2.1\nAllow: /\n\nUser-agent: *\nDisallow: /", "/products.json"), true, "its own group, whatever the case or version");
assert.equal(allow("User-agent: Googlebot\nUser-agent: RelayBot\nDisallow: /\n\nUser-agent: *\nAllow: /", "/meta.json"), false, "a group naming several robots");
assert.equal(allow("User-agent: OtherBot\nDisallow: /\n", "/products.json"), true, "another robot's rules don't apply");
assert.equal(allow("User-agent: *\nDisallow: /products\nAllow: /products.json", "/products.json?limit=100"), true, "the longest rule wins");
assert.equal(allow("User-agent: *\nDisallow: /products.json\nAllow: /products.json", "/products.json"), true, "same length: allow wins");
assert.equal(allow("User-agent: *\nDisallow: /*.json$", "/meta.json"), false, "$ ends the pattern");
assert.equal(allow("User-agent: *\nDisallow: /*.json$", "/products.json?limit=100"), true);
assert.equal(allow("Disallow: /\nUser-agent: *\nAllow: /x", "/products.json"), true, "rules before any user-agent line belong to no group");
console.log("ok - robots.txt: Shopify's usual rules, wildcards, $, RelayBot's own group, longest rule wins");

// A stand-in web: each address answers as set up below. Every request is kept, to check what was asked and how.
let web = new Map(), asked = [];
const res = (status, body, type, url) => ({ status, ok: status >= 200 && status < 300, url, headers: new Headers(type ? { "content-type": type } : {}), text: async () => body });
const fetchImpl = async (url, init) => {
  asked.push({ url: String(url), init });
  const a = web.get(String(url));
  if (!a) return res(404, "Not found", "text/html", String(url));
  if (a === "down") throw new TypeError("fetch failed");
  return res(a.status || 200, typeof a.body === "string" ? a.body : JSON.stringify(a.body), a.type || "application/json", a.url || String(url));
};
const NOW = 1_800_000_000_000;
const product = (id, title, o = {}) => ({ id, title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), published_at: new Date(NOW - id * 36e5).toISOString(),
  product_type: o.type || "Shirts", images: o.noPicture ? [] : [{ src: o.src || `https://cdn.shopify.com/s/files/1/0001/files/${id}.jpg?v=1` }],
  variants: o.variants || [{ id: id * 10, title: "Default Title", price: "45.00", available: true }] });
const shopSite = (origin, o = {}) => {
  web.set(origin + "/robots.txt", { body: o.robots ?? SHOPIFY_DEFAULT, type: "text/plain" });
  web.set(origin + "/meta.json", { body: { name: "x", currency: o.currency || "GBP", ships_to_countries: o.ships || ["GB", "IE"] } });
  web.set(origin + "/products.json?limit=100", { body: { products: o.products || [product(1, "Linen Shirt")] } });
};

// 2. One shop: robots.txt first, then its currency and where it delivers, then its products. RelayBot says who it is.
shopSite("https://www.oak-thread.test", { products: [
  ...Array.from({ length: 30 }, (_, i) => product(i + 1, "Shirt " + (i + 1))),
  product(40, "No Picture Tee", { noPicture: true }),
  product(41, "Free Sample", { variants: [{ id: 410, title: "Default Title", price: "0.00", available: true }] }),
  product(0.5, "Court Classic Trainers", { type: "Shoes", src: "//cdn.shopify.com/s/files/1/0001/files/court.jpg", variants: [
    { id: 51, title: "White / UK 8", price: "85.00", available: true, featured_image: { src: "https://cdn.shopify.com/s/files/1/0001/files/court-white.jpg" } },
    { id: 52, title: "White / UK 9", price: "85.00", available: false },
    { id: 53, title: "Black / UK 8", price: "89.50" } ] }),
] });
let r = await readShop(fetchImpl, { domain: "www.oak-thread.test", label: "Oak & Thread" }, NOW);
assert.equal(r.status, "ok");
assert.deepEqual(asked.map(a => a.url), ["https://www.oak-thread.test/robots.txt", "https://www.oak-thread.test/meta.json", "https://www.oak-thread.test/products.json?limit=100"]);
assert.ok(asked.every(a => a.init.headers["User-Agent"] === USER_AGENT && !a.init.method && !a.init.body), "only reads, saying who it is");
assert.match(USER_AGENT, /^RelayBot\/1\.0 \(\+https:\/\/\S+\/relaybot\.html\)$/);
assert.equal(r.products, PRODUCTS_PER_SHOP, "the newest 24 products with a price and a picture");
const first = r.rows.filter(x => x.position === 0);
assert.deepEqual(first.map(x => [x.product, x.variation, x.priceMinor, x.available]), [["Court Classic Trainers", "White / UK 8", 8500, 1], ["Court Classic Trainers", "White / UK 9", 8500, 0], ["Court Classic Trainers", "Black / UK 8", 8950, null]],
  "newest first; can be bought, can't, or not said");
assert.equal(first[0].imageUrl, "https://cdn.shopify.com/s/files/1/0001/files/court-white.jpg?width=600", "a colour's own picture, at 600 pixels");
assert.equal(first[2].imageUrl, "https://cdn.shopify.com/s/files/1/0001/files/court.jpg?width=600", "otherwise the product's");
assert.equal(first[0].productUrl, "https://www.oak-thread.test/products/court-classic-trainers?variant=51");
assert.equal(first[0].id, "web:www.oak-thread.test:51");
assert.equal(r.rows.find(x => x.product === "Shirt 1").variation, null, "Shopify's Default Title isn't a size");
assert.ok(!r.rows.some(x => /No Picture|Free Sample|Shirt 2[4-9]|Shirt 30/.test(x.product)), "no picture, no price, or past the newest 24: left out");
console.log("ok - a shop: robots.txt, currency and delivery, then its newest 24 products; read-only, as RelayBot");

// What makes a shop unreadable: each says why, and nothing more is asked once one says no.
const cases = [
  ["robots says no", { robots: "User-agent: *\nDisallow: /products.json" }, "robots", 1],
  ["robots says no to RelayBot", { robots: "User-agent: relaybot\nDisallow: /\n\nUser-agent: *\nAllow: /" }, "robots", 1],
  ["prices in euros", { currency: "EUR" }, "not_gbp", 2],
  ["no UK delivery", { ships: ["US", "CA"] }, "no_uk_delivery", 2],
];
for (const [what, o, status, requests] of cases) {
  web = new Map(); asked = []; shopSite("https://elm.test", o);
  r = await readShop(fetchImpl, { domain: "elm.test", label: "Elm" }, NOW);
  assert.deepEqual([r.status, r.rows.length, asked.length], [status, 0, requests], what);
}
web = new Map(); asked = []; shopSite("https://elm.test", { ships: ["*"] });
assert.equal((await readShop(fetchImpl, { domain: "elm.test", label: "Elm" }, NOW)).status, "ok", "delivers everywhere");
for (const [meta, status] of [[{ money_format: "£{{amount}}" }, "ok"], [{ money_format: "{{amount}} GBP" }, "ok"], [{ money_format: "€{{amount}}" }, "not_gbp"], [{}, "not_gbp"], [[], "not_gbp"]]) {
  web = new Map(); shopSite("https://elm.test"); web.set("https://elm.test/meta.json", { body: meta });
  assert.equal((await readShop(fetchImpl, { domain: "elm.test", label: "Elm" }, NOW)).status, status, "currency from the price format: " + JSON.stringify(meta));
}
web = new Map(); asked = []; web.set("https://elm.test/robots.txt", { status: 503, body: "busy", type: "text/plain" });
assert.deepEqual([(await readShop(fetchImpl, { domain: "elm.test", label: "Elm" }, NOW)).status, asked.length], ["unreachable", 1], "robots.txt erroring: nothing read");
web = new Map(); web.set("https://elm.test/robots.txt", "down");
assert.equal((await readShop(fetchImpl, { domain: "elm.test", label: "Elm" }, NOW)).status, "unreachable");
web = new Map(); asked = []; web.set("https://elm.test/meta.json", { body: { currency: "GBP" } }); web.set("https://elm.test/products.json?limit=100", { body: { products: [product(1, "Linen Shirt")] } });
assert.equal((await readShop(fetchImpl, { domain: "elm.test", label: "Elm" }, NOW)).status, "ok", "no robots.txt at all: allowed");
web = new Map(); shopSite("https://elm.test"); web.set("https://elm.test/products.json?limit=100", { body: "<html>Enter password</html>", type: "text/html", url: "https://elm.test/password" });
assert.equal((await readShop(fetchImpl, { domain: "elm.test", label: "Elm" }, NOW)).status, "not_shopify", "a closed shop's password page");
web = new Map(); shopSite("https://elm.test"); web.set("https://elm.test/meta.json", { status: 403, body: "Access denied", type: "text/html" });
assert.equal((await readShop(fetchImpl, { domain: "elm.test", label: "Elm" }, NOW)).status, "blocked");
web = new Map(); shopSite("https://elm.test"); web.set("https://elm.test/products.json?limit=100", { body: "{not json", type: "application/json" });
assert.equal((await readShop(fetchImpl, { domain: "elm.test", label: "Elm" }, NOW)).status, "not_shopify");
// Moved to www: the www address is used. Sent to another site: ignored.
web = new Map(); asked = []; shopSite("https://www.birch.test"); web.set("https://birch.test/robots.txt", { body: "", type: "text/plain", url: "https://www.birch.test/robots.txt" });
r = await readShop(fetchImpl, { domain: "birch.test", label: "Birch" }, NOW);
assert.deepEqual([r.status, asked[1].url, r.rows[0].productUrl], ["ok", "https://www.birch.test/meta.json", "https://www.birch.test/products/linen-shirt?variant=10"]);
web = new Map(); shopSite("https://elm.test"); web.set("https://elm.test/robots.txt", { body: "", type: "text/plain", url: "https://elsewhere.test/robots.txt" });
asked = []; await readShop(fetchImpl, { domain: "elm.test", label: "Elm" }, NOW);
assert.ok(asked.every(a => a.url.startsWith("https://elm.test/")), "never follows a shop to another site");
assert.equal(shopRows({ domain: "x.test" }, "https://x.test", [product(1, "Tee", { src: "javascript:alert(1)" })], NOW).length, 0, "pictures are https only");
console.log("ok - unreadable shops say why: robots.txt, euros, no UK delivery, closed, blocked, down; never another site");

// 3. The schedule: 2 shops a run, each about once a day; results kept; a passing failure keeps the last list.
const sqlite = new DatabaseSync(":memory:");
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { const x = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(x.changes) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
}
// Like D1: a batch is one transaction, and batches run one after another.
let queue = Promise.resolve();
const db = { prepare: sql => stmt(sql), batch: (list) => (queue = queue.then(async () => { sqlite.exec("BEGIN"); try { for (const s of list) await s.run(); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } })) };
const env = { RELAY_DB: db };
const SHOPS = [{ domain: "a.test", label: "Alder" }, { domain: "b.test", label: "Birch" }, { domain: "c.test", label: "Cedar" }];
web = new Map();
shopSite("https://a.test", { products: [product(1, "Alder Shirt"), product(2, "Alder Tote", { type: "Bags" })] });
shopSite("https://b.test", { products: [product(1, "Birch Jumper")] });
shopSite("https://c.test", { currency: "USD" });
env.WEB_SHOPS = "off";
assert.deepEqual(await refreshWebShops(env, { now: NOW, fetchImpl, shops: SHOPS }), { checked: 0, off: true }, "WEB_SHOPS=off stops it");
delete env.WEB_SHOPS;
asked = [];
let run = await refreshWebShops(env, { now: NOW, fetchImpl, shops: SHOPS });
assert.deepEqual(run, { checked: 2, results: [{ shop: "Alder", status: "ok", products: 2 }, { shop: "Birch", status: "ok", products: 1 }] });
run = await refreshWebShops(env, { now: NOW + 60e3, fetchImpl, shops: SHOPS });
assert.deepEqual(run.results, [{ shop: "Cedar", status: "not_gbp", products: 0 }]);
assert.equal((await refreshWebShops(env, { now: NOW + 120e3, fetchImpl, shops: SHOPS })).checked, 0, "nothing due again for a day");
const askedA = asked.filter(a => a.url.startsWith("https://a.test/")).length;
assert.equal(askedA, 3, "3 requests for a shop's day");

// The preview: each shop's newest first, shops taken in turn; who answered how.
const call = async (now, method = "GET") => { const req = new Request("https://w.test/relay/web-shops", { method }); const x = await handleWebShopsRoute(req, env, new URL(req.url), {}, { now }); return { status: x.status, cache: x.headers.get("cache-control"), body: await x.json() }; };
let page = await call(NOW + 3e5);
assert.equal(page.cache, "public, max-age=120");
assert.deepEqual(page.body.products.map(p => [p.storeName, p.product]), [["Alder", "Alder Shirt"], ["Birch", "Birch Jumper"], ["Alder", "Alder Tote"]], "shops mixed, newest first");
assert.deepEqual(page.body.products[0], { sku: "web:a.test:10", product: "Alder Shirt", variation: null, priceMinor: 4500, currency: "GBP", imageUrl: "https://cdn.shopify.com/s/files/1/0001/files/1.jpg?v=1&width=600",
  quantity: null, inStock: true, storeName: "Alder", shopDomain: "a.test", productUrl: "https://a.test/products/alder-shirt?variant=10", kind: "Shirts", checkedAt: new Date(NOW).toISOString(), webShop: true });
assert.deepEqual(page.body.shops.map(s => [s.name, s.status, s.products]), [["Alder", "ok", 2], ["Birch", "ok", 1], ["Cedar", "not_gbp", 0]]);
assert.equal(page.body.preview, true);
assert.equal((await call(NOW, "POST")).status, 404);

// A day later: Alder's website is down (its last list stays, tried again in 6 hours); Birch's robots.txt now says no
// (its products go). Then Alder is 3 days old: hidden.
web.set("https://a.test/robots.txt", "down");
shopSite("https://b.test", { robots: "User-agent: *\nDisallow: /" });
run = await refreshWebShops(env, { now: NOW + 864e5 + 1, fetchImpl, shops: SHOPS });
assert.deepEqual(run.results.map(x => [x.shop, x.status]), [["Alder", "unreachable"], ["Birch", "robots"]]);
page = await call(NOW + 864e5 + 2);
assert.deepEqual(page.body.products.map(p => p.product), ["Alder Shirt", "Alder Tote"], "a website that's down keeps its last list for now");
assert.deepEqual(page.body.shops.map(s => [s.name, s.status, s.products]), [["Alder", "unreachable", 2], ["Birch", "robots", 0], ["Cedar", "not_gbp", 0]]);
assert.equal(sqlite.prepare("SELECT next_at FROM web_shops WHERE domain = 'a.test'").get().next_at, NOW + 864e5 + 1 + 864e5 / 4, "tried again in 6 hours");
assert.equal(sqlite.prepare("SELECT next_at FROM web_shops WHERE domain = 'b.test'").get().next_at, NOW + 864e5 + 1 + 7 * 864e5, "robots.txt said no: asked again in a week");
assert.deepEqual((await webShopProducts(env, NOW + SHOW_FOR + 1)).map(p => p.product), [], "3 days old: hidden");

// Taken off the list: forgotten, products too. Two runs at once never read the same shop.
await refreshWebShops(env, { now: NOW + 2 * 864e5, fetchImpl, shops: SHOPS.slice(1) });
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM web_shops WHERE domain = 'a.test'").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM web_shop_items WHERE domain = 'a.test'").get().n, 0);
const later = NOW + 30 * 864e5;
web = new Map(); shopSite("https://b.test");
asked = [];
const [one, two] = await Promise.all([refreshWebShops(env, { now: later, fetchImpl, shops: SHOPS.slice(1, 2) }), refreshWebShops(env, { now: later, fetchImpl, shops: SHOPS.slice(1, 2) })]);
assert.equal(one.checked + two.checked, 1, "one run takes the shop");
assert.equal(asked.filter(a => a.url.endsWith("/robots.txt")).length, 1);
console.log("ok - 2 shops a run, each once a day; shops mixed, newest first; down keeps its list for now, robots.txt no removes it; 3 days old hidden; off the list forgotten");

// 4. The real list: UK shops on Shopify, each once, with a name.
assert.ok(WEB_SHOPS.length >= 10 && new Set(WEB_SHOPS.map(s => s.domain)).size === WEB_SHOPS.length && WEB_SHOPS.every(s => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s.domain) && s.label));
console.log("PASS shops' websites: robots.txt followed, read-only as RelayBot, pounds and UK delivery only, newest 24 a shop, once a day, hidden after 3 days");
