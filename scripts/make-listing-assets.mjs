// Makes Relay's Shopify App Store listing pictures: the app icon (1200 × 1200) and screenshots (1600 × 900) of the shop
// dashboard as it shows inside Shopify admin. Everything on screen comes from Relay's real dashboard page (retailer.html)
// and Relay's real server code (worker/retailer.js and friends), run here against a made-up shop: Kestrel Outdoor, its
// products and its shoppers are invented. No real shop, shopper or order appears.
//   node scripts/make-listing-assets.mjs [output folder]      (default /tmp/relay-listing)
// Re-run it whenever the dashboard or Relay's colours change.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
import { handleRetailerRoute, issueRetailerKey } from "../worker/retailer.js";
import { ensurePushTables } from "../worker/push.js";
import { ensureSquareMerchantSchema } from "../worker/square-connect.js";
import { ensureShopifyShopSchema } from "../worker/shopify-connect.js";
import { ensureExchangeTables } from "../worker/exchange.js";
import { ensureReturnsTables } from "../worker/returns.js";
import { ensureShopPayTables } from "../worker/shop-payments.js";
import { ensureRoyalMailTables } from "../worker/royal-mail.js";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");

const OUT = resolve(process.argv[2] || "/tmp/relay-listing");
mkdirSync(OUT, { recursive: true });
const API = "https://relay-square-api2.9pts72cy5j.workers.dev";

// ---- A made-up shop, its products, shoppers and activity, in Relay's own tables ----
const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; }, _exec() { sqlite.prepare(sql).run(...args); } };
}
const db = { prepare: sql => stmt(sql), async batch(list) { list.forEach(s => s._exec()); return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "listing-pictures-secret-0123456789" };
const now = Date.now(), DAY = 864e5;
const DOMAIN = "kestrel-outdoor.myshopify.com", STORE = "Kestrel Outdoor";
await ensurePushTables(db); await ensureSquareMerchantSchema(db); await ensureShopifyShopSchema(db);
await ensureExchangeTables(db); await ensureReturnsTables(db); await ensureShopPayTables(db); await ensureRoyalMailTables(db);
sqlite.prepare("INSERT INTO shopify_shops (domain, label, access_iv, access_data, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(DOMAIN, STORE, "x", "x", now, now);
const products = [
  ["trail", "Trail Runner Shoes", [["UK 8", 8900], ["UK 9", 8900], ["UK 10", 8900]]],
  ["jacket", "Waxed Field Jacket", [["M", 12900], ["L", 12900]]],
  ["shell", "Packable Rain Shell", [["S", 7900], ["M", 7900]]],
  ["socks", "Merino Hiking Socks", [["M", 1600]]],
  ["pack", "Canvas Day Pack", [["20L", 5400]]],
  ["fleece", "Grid Fleece Pullover", [["L", 6400]]]
];
let n = 0;
for (const [id, title, variants] of products) {
  sqlite.prepare("INSERT INTO retailer_catalog_items (id, provider, external_item_id, title, store_label) VALUES (?,?,?,?,?)").run("i:" + id, "shopify:" + DOMAIN, "gid://shopify/Product/" + (8100 + ++n), title, STORE);
  variants.forEach(([vt, p], k) => sqlite.prepare("INSERT INTO retailer_catalog_variants (id, item_id, external_variant_id, title, sku, price_minor, currency) VALUES (?,?,?,?,?,?,?)")
    .run("v:" + id + k, "i:" + id, "gid://shopify/ProductVariant/" + (5100 + n * 10 + k), vt, "KO-" + id.toUpperCase() + "-" + vt.replace(/\W/g, ""), p, "GBP"));
}
// Invented shoppers watching for a price drop: how many per item, and how many of those started this week.
const watch = (shopper, sku, product, at, via = "item") =>
  sqlite.prepare("INSERT INTO price_watches (shopper_id, sku, product, variant, store, via, baseline_minor, last_seen_minor, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(shopper, sku, product, null, STORE, via, 0, 0, at);
let s = 0;
for (const [sku, product, count, recent] of [["v:jacket0", "Waxed Field Jacket", 34, 9], ["v:trail1", "Trail Runner Shoes", 27, 6], ["v:shell1", "Packable Rain Shell", 18, 4],
  ["v:pack0", "Canvas Day Pack", 11, 2], ["v:fleece0", "Grid Fleece Pullover", 7, 1], ["v:socks0", "Merino Hiking Socks", 4, 0]])
  for (let i = 0; i < count; i++) watch("shopper-" + (++s), sku, product, i < recent ? now - (1 + i % 5) * DAY : now - (9 + i) * DAY);
for (let i = 0; i < 23; i++) sqlite.prepare("INSERT INTO store_optins (shopper_id, store, created_at) VALUES (?,?,?)").run("follower-" + i, STORE, now - (2 + i) * DAY);
// One offer already sent.
await issueRetailerKey(env, { provider: "shopify", shopRef: DOMAIN, storeLabel: STORE }, now); // makes the offers table
sqlite.prepare(`INSERT INTO retailer_offers (id, provider, shop_ref, store_label, sku, product, variant, offer_minor, was_minor, note, starts_at, ends_at, shoppers, devices)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("offer-1", "shopify", DOMAIN, STORE, "v:shell1", "Packable Rain Shell", "M", 6500, 7900, "In store and online", now - DAY, now + DAY, 18, 21);
// Swaps and returns customers started in Relay.
sqlite.prepare("INSERT INTO retailer_connections (id, provider, merchant_external_id) VALUES (?,?,?)").run("conn-ko", "shopify", DOMAIN);
const order = (no, title, price, at) => {
  sqlite.prepare("INSERT INTO retailer_orders (id, connection_id, external_order_id, ordered_at, amount_minor, currency) VALUES (?,?,?,?,?,?)").run("o" + no, "conn-ko", String(no), new Date(at).toISOString(), price, "GBP");
  sqlite.prepare("INSERT INTO order_items (id, order_id, external_line_item_id, title, quantity, price_minor, currency) VALUES (?,?,?,?,?,?,?)").run("li" + no, "o" + no, "L" + no, title, 1, price, "GBP");
};
const swap = (no, title, price, from, to, at, detail = null) => {
  order(no, title, price, at - 3 * DAY);
  sqlite.prepare(`INSERT INTO relay_exchanges (id, shopper_id, order_id, line_id, shop, from_variant, from_title, to_variant, to_title, quantity, status, detail, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("x" + no, "shopper-x" + no, "o" + no, "L" + no, DOMAIN, "a", from, "b", to, 1, "done", detail, at);
};
swap(5100231, "Trail Runner Shoes", 8900, "UK 9", "UK 10", now - 0.2 * DAY);
swap(5100224, "Waxed Field Jacket", 12900, "M", "L", now - 1.1 * DAY);
swap(5100217, "Packable Rain Shell", 7900, "S", "M", now - 2.3 * DAY);
swap(5100209, "Grid Fleece Pullover", 6400, "M", "L", now - 3.4 * DAY);
swap(5100198, "Trail Runner Shoes", 8900, "UK 8", "UK 9", now - 4.6 * DAY);
swap(5100190, "Canvas Day Pack", 5400, "20L", "30L", now - 5.2 * DAY, "shopify paid 1000");
order(5100212, "Merino Hiking Socks", 1600, now - 6 * DAY);
// The shop was emailed about the return a minute after it started, as happens when Relay's email sending is set up.
sqlite.prepare(`INSERT INTO relay_returns (id, shopper_id, order_id, line_id, shop, item_title, quantity, price_minor, reason, return_ref, status, created_at, shop_notified_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("r1", "shopper-r1", "o5100212", "L5100212", DOMAIN, "Merino Hiking Socks", 1, 1600, "changed_mind", "RLY-7KQ2-M4PX", "requested", now - 2.8 * DAY, now - 2.8 * DAY + 60e3);
sqlite.prepare("INSERT INTO relay_shop_pay (shop, method, updated_at) VALUES (?,?,?)").run(DOMAIN, "shopify", now);
// Royal Mail labels stay off: they haven't been tried on a real Click & Drop account yet (docs/ROYAL_MAIL_RETURNS.md),
// so the listing doesn't show them switched on.

// ---- Serve the real dashboard page, opened the way Shopify admin opens it (embedded) ----
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css" };
const server = createServer(async (req, res) => {
  try {
    const p = new URL(req.url, "http://x").pathname;
    let body = await readFile(resolve(".", "." + p));
    // As worker/shopify-embedded.js does inside Shopify admin (App Bridge itself isn't loaded here; the page is given
    // a stand-in for its sign-in token below).
    if (p === "/retailer.html") body = String(body).replace("<head>", "<head><script>window.RELAY_EMBEDDED={shop:" + JSON.stringify(DOMAIN) + "};</script>");
    res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(body);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const shopKey = await issueRetailerKey(env, { provider: "shopify", shopRef: DOMAIN, storeLabel: STORE }, now);
const browser = await chromium.launch();
// 1280 × 720 drawn at 1.25× = 1600 × 900, Shopify's size, with the dashboard filling more of each picture and its
// text large enough to read in the listing.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.25, serviceWorkers: "block" });
await ctx.addInitScript(() => { window.shopify = { idToken: async () => "stand-in-id-token" }; });
await ctx.route(API + "/**", async route => {
  const r = route.request(), u = new URL(r.url());
  const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: H });
  // The shop's own session (Shopify's token check is tested in test-shopify-embedded.mjs).
  if (u.pathname === "/relay/shopify/embedded/session") return route.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify({ key: shopKey }) });
  const out = await handleRetailerRoute(new Request(r.url(), { method: r.method(), headers: r.headers(), body: r.method() === "GET" ? undefined : r.postData() }), env, u, H, { now });
  if (!out) return route.fulfill({ status: 404, headers: H, body: "" });
  return route.fulfill({ status: out.status, contentType: "application/json", headers: H, body: await out.text() });
});
await ctx.route("https://cdn.shopify.com/**", r => r.abort());
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(origin + "/retailer.html");
await page.locator("#items .row").first().waitFor();
await page.locator("#activity .row").first().waitFor();
await page.evaluate(() => document.fonts && document.fonts.ready);
const shots = [];
// Each picture shows a different part of the dashboard (Shopify asks for distinct screenshots).
async function shot(name, alt, prepare) {
  await prepare();
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT + "/" + name + ".png" });
  shots.push({ file: name + ".png", alt });
}
// Scrolls so a section heading (by its words) sits near the top, or so an element's bottom sits near the bottom.
const toHeading = (text, above = 20) => page.evaluate(([text, above]) => {
  const h = [...document.querySelectorAll("h2")].find(h => h.textContent.trim() === text);
  window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - above);
}, [text, above]);
const toBottomOf = (sel, below = 24) => page.evaluate(([sel, below]) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  window.scrollTo(0, r.bottom + window.scrollY + below - window.innerHeight);
}, [sel, below]);
await shot("1-swaps-and-returns", "The shop's Relay dashboard: swaps made instead of returns, the value of the items swapped, and each recent swap and return.",
  () => page.evaluate(() => window.scrollTo(0, 0)));
await shot("2-demand", "Demand: how many Relay shoppers are watching the shop's products for a lower price, and which products they watch most.",
  () => toHeading("Demand"));
await shot("3-send-offer", "Sending everyone watching the Grid Fleece Pullover an offer price for two days, above the offers already sent.", async () => {
  const row = page.locator("#items .row", { hasText: "Grid Fleece Pullover" });
  await row.locator("[data-open]").click();
  await row.locator("input[name=price]").fill("52.00");
  await row.locator("input[name=note]").fill("In store and online");
  await page.evaluate(() => document.activeElement && document.activeElement.blur()); // no blinking cursor in the picture
  await toBottomOf("#offers");
});
await shot("4-price-differences", "When a customer swaps to a dearer item, they pay the difference through the shop's own Shopify checkout.", async () => {
  await page.locator("#items [data-form]:not(.hidden)").evaluateAll(fs => fs.forEach(f => f.classList.add("hidden")));
  await toHeading("Price differences on swaps");
});

// ---- The app icon: Relay's R as on the phone app's icon (icons/icon-512.png), square with room around it (Shopify
// rounds the corners itself), in the dashboard's own two colours, so it follows any change to Relay's colours. ----
const dashCss = readFileSync("retailer.html", "utf8");
const colour = (name) => { const m = new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{6})").exec(dashCss); if (!m) throw new Error("retailer.html has no --" + name); return m[1]; };
const navy = colour("navy"), lime = colour("lime");
const icon = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 });
await icon.setContent(`<!doctype html><html><body style="margin:0;background:${navy};display:grid;place-items:center;width:1200px;height:1200px">
  <svg width="1200" height="1200" viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="1200" fill="${navy}"/>
  <text x="600" y="610" text-anchor="middle" dominant-baseline="central" font-family="'DejaVu Serif', Georgia, 'Times New Roman', serif" font-weight="700" font-size="640" fill="${lime}">R</text>
  </svg></body></html>`);
await icon.screenshot({ path: OUT + "/app-icon.png" });

await browser.close(); server.close();
if (errors.length) { console.error("script errors on the page:", errors); process.exit(1); }
console.log(JSON.stringify({ out: OUT, icon: "app-icon.png", screenshots: shots }, null, 2));
