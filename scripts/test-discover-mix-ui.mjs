// Browser test: Discover mixes shops, so the first screen shows every shop instead of one shop's whole range; Relay's
// team has two switches in Profile (shops' websites, and testing tools), which a link can't do in the app on a phone's
// home screen; and a product's kind comes from what it is, not its colour.
// Stubbed Relay server with made-up shops and products; nothing reaches a shop. Checks: a shop with more products than
// Discover shows at once no longer hides the others; each shop keeps its own order; with testing tools, the preview from
// shops' own websites is on the first screen too; Lowest and Highest price still sort across every shop; a shop's chip
// shows just that shop, in its own order; the switches are only for Relay's team (also before they sign in again for
// team tools), work without reloading and are remembered on the device; the shops' websites switch shows real shops
// only (no test shops, and test orders aren't asked for); a device that had testing tools on moves to the shops'
// websites once; a "Plunge Bra - Chocolate" is fashion, and For you only gives a food reason for food.
// Passes the polish rules in light and dark, at phone size.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "sam.tester@example.com";
const SHOPPER_NEVER_SEES = /\bdemo\b|sandbox|simulat|fictional|prototype|test mode|test shop|preview|testing/i;
const CHECKED = new Date(Date.now() - 3 * 36e5).toISOString();

// One shop with more products than Discover shows at once (60), listed first, and a small shop after it.
const variant = (shop, n) => "shopify:" + shop + ".myshopify.com:variant:gid://shopify/ProductVariant/" + n;
const big = Array.from({ length: 70 }, (_, i) => ({ sku: variant("big-barn", 1000 + i), catalogueId: variant("big-barn", 1000 + i), product: "Barn Jumper " + (i + 1),
  variation: "M", priceMinor: 4000 + i * 10, currency: "GBP", quantity: 5, storeName: "Big Barn", shopDomain: "big-barn.myshopify.com", imageUrl: null }));
const small = [
  { sku: variant("pebble", 1), catalogueId: variant("pebble", 1), product: "Pebble Mug", variation: "Sage", priceMinor: 1500, currency: "GBP", quantity: 4, storeName: "Pebble & Co", shopDomain: "pebble.myshopify.com", imageUrl: null },
  { sku: variant("pebble", 2), catalogueId: variant("pebble", 2), product: "Pebble Bowl", variation: "Sage", priceMinor: 9900, currency: "GBP", quantity: 2, storeName: "Pebble & Co", shopDomain: "pebble.myshopify.com", imageUrl: null }];
const web = [
  { sku: "web:hollow-pine.test:71", product: "Wool Beanie", variation: "Navy", priceMinor: 2800, currency: "GBP", imageUrl: null, quantity: null, inStock: true, storeName: "Hollow Pine", shopDomain: "hollow-pine.test", productUrl: "https://hollow-pine.test/products/wool-beanie?variant=71", kind: "Hats", checkedAt: CHECKED, webShop: true },
  { sku: "web:hollow-pine.test:81", product: "Linen Scarf", variation: "Sand", priceMinor: 3000, currency: "GBP", imageUrl: null, quantity: null, inStock: true, storeName: "Hollow Pine", shopDomain: "hollow-pine.test", productUrl: "https://hollow-pine.test/products/linen-scarf?variant=81", kind: "Scarves", checkedAt: CHECKED, webShop: true },
  { sku: "web:fern-row.test:91", product: "Canvas Tote Bag", variation: null, priceMinor: 1800, currency: "GBP", imageUrl: null, quantity: null, inStock: true, storeName: "Fern Row", shopDomain: "fern-row.test", productUrl: "https://fern-row.test/products/canvas-tote-bag?variant=91", kind: "Bags", checkedAt: CHECKED, webShop: true }];
// A clothes shop whose colours are named after food and drink, and a chocolate shop.
const WEAR = ["Flutter Plunge Bra - Chocolate", "Jamie Drape Top In Bitter Chocolate", "Strike Light Grey Pullover Hoodie", "Everly Pink Cable Knit V-Neck Jumper", "Laptop Bag - Hot Pink Ripstop", "Adore G-String - Wine", "Miffy x Velvet Phone Fleece Twosie Set"];
WEAR.forEach((name, i) => web.push({ sku: "web:velvet-row.test:" + (200 + i), product: name, variation: null, priceMinor: 3000 + i * 100, currency: "GBP", imageUrl: null, quantity: null, inStock: true,
  storeName: "Velvet Row", shopDomain: "velvet-row.test", productUrl: "https://velvet-row.test/products/" + i, kind: "Clothing", checkedAt: CHECKED, webShop: true }));
web.push({ sku: "web:cocoa-cottage.test:300", product: "Dark Chocolate Truffles - Gift Box", variation: null, priceMinor: 1200, currency: "GBP", imageUrl: null, quantity: null, inStock: true,
  storeName: "Cocoa Cottage", shopDomain: "cocoa-cottage.test", productUrl: "https://cocoa-cottage.test/products/truffles", kind: "Chocolate", checkedAt: CHECKED, webShop: true });
web.push({ sku: "web:cocoa-cottage.test:301", product: "Black Toast Glass Cake Stand", variation: null, priceMinor: 3500, currency: "GBP", imageUrl: null, quantity: null, inStock: true,
  storeName: "Cocoa Cottage", shopDomain: "cocoa-cottage.test", productUrl: "https://cocoa-cottage.test/products/cake-stand", kind: "Homeware", checkedAt: CHECKED, webShop: true });
const st = { webAsked: 0, admin: { admin: false }, purchaseAsks: [], wrapped: { receipts: 0 } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p === "/relay/shopify/catalogue") return j({ products: [...big, ...small], published: true, publishedStoreCount: 2 });
  if (p === "/relay/web-shops") { st.webAsked++; return j({ products: web, shops: [], preview: true }); }
  if (p === "/relay/my/photo-search") return j({ available: false, perDay: 30 });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5 });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") { st.purchaseAsks.push(u.search); return j({ purchases: [] }); }
  if (p === "/relay/my/wrapped") return j(st.wrapped);
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Tester", photo: null });
  if (p === "/relay/my/second-step") return j({ required: true, done: true, checked: true, app: true, text: false, passkeys: 0 });
  if (p === "/relay/my/admin/me") return j(st.admin);
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", () => { throw new Error("a browser pop-up appeared; Relay must ask inside the page"); });
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; }; // color-mix() comes back as color(srgb 0–1)
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " input")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓+×✕↩]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    const caps = s.textTransform === "uppercase" || (/[A-Z]/.test(el.textContent) && el.textContent === el.textContent.toUpperCase());
    if (px < 13 && !(caps && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    const back = bgOf(el), a = lum(flat(rgb(s.color), back)), b = lum(back), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3 && !el.closest("button:disabled")) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const polished = async (where, scope) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/discover-mix-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const signIn = async (url) => {
  await page.goto(url);
  await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
  await page.reload();
};
// The grid's cards, in order: [shop, product].
const grid = () => page.$$eval("#catalogResults .dc-card", cards => cards.map(c => [c.querySelector(".dc-shop").textContent.replace(/ · TEST$/, ""), c.querySelector("h3").textContent]));
const discover = async (waitFor) => {
  await page.evaluate(() => window.go("discover"));
  await page.locator("#catalogResults .dc-card").first().waitFor();
  if (waitFor) await page.locator("#catalogResults .dc-card", { hasText: waitFor }).first().waitFor();
};
const inOwnOrder = (cards, shop) => { const names = cards.filter(c => c[0] === shop).map(c => c[1]); return names.join("|") === [...names].sort((a, b) => Number(a.replace(/\D+/g, "")) - Number(b.replace(/\D+/g, "")) || 0).join("|"); };

// 1. Shoppers: a shop with 70 products no longer hides the small shop listed after it.
await signIn(origin + "/index.html");
await discover("Pebble");
let cards = await grid();
assert.equal(cards.length, 60, "Discover still shows 60 at once");
assert.deepEqual(new Set(cards.slice(0, 2).map(c => c[0])), new Set(["Big Barn", "Pebble & Co"]), "the first two are from different shops");
assert.deepEqual(cards.filter(c => c[0] === "Pebble & Co").map(c => c[1]), ["Pebble Mug", "Pebble Bowl"], "the small shop's products, in its own order");
assert.ok(inOwnOrder(cards, "Big Barn"), "the big shop's products stay in its own order");
assert.equal(st.webAsked, 0, "shoppers never get the shops' websites preview");
assert.ok(!SHOPPER_NEVER_SEES.test(await page.locator(".main").innerText()), "no test or preview words for shoppers");
await polished("shoppers", ".main");
console.log("ok - shoppers: every shop near the top, each in its own order");

// 2. Lowest and Highest price still sort across every shop.
await page.selectOption("#filter", "low");
cards = await grid();
assert.deepEqual(cards.slice(0, 2), [["Pebble & Co", "Pebble Mug"], ["Big Barn", "Barn Jumper 1"]], "cheapest first, whichever shop");
await page.selectOption("#filter", "high");
cards = await grid();
assert.deepEqual(cards[0], ["Pebble & Co", "Pebble Bowl"], "dearest first, whichever shop");
await page.selectOption("#filter", "all");
console.log("ok - Lowest and Highest price sort across every shop");

// 3. A shop's chip: just that shop, in its own order.
await page.locator("#dcShops [data-shop='Big Barn']").click();
cards = await grid();
assert.ok(cards.every(c => c[0] === "Big Barn"), "only that shop");
assert.deepEqual(cards.slice(0, 3).map(c => c[1]), ["Barn Jumper 1", "Barn Jumper 2", "Barn Jumper 3"], "in the shop's own order");
await page.locator("#dcShops [data-shop='all']").click();
console.log("ok - a shop's chip shows just that shop, in its own order");

// 4. Testing tools (which add Relay's demo shops): one product from every shop comes first, the shops' websites
// included, instead of the first shop's whole range.
await page.goto(origin + "/index.html?testing=1");
await discover("Wool Beanie");
await page.locator(".dc-preview").waitFor();
cards = await grid();
const shops = await page.$$eval("#dcShops [data-shop]", bs => bs.map(b => b.dataset.shop).filter(s => s !== "all"));
assert.ok(shops.length > 4 && shops.length < 60, "the demo shops are there too (" + shops.length + " shops)");
const firstRound = cards.slice(0, shops.length).map(c => c[0]);
assert.deepEqual(new Set(firstRound), new Set(shops), "one product from every shop first");
assert.equal(firstRound.length, new Set(firstRound).size, "no shop twice before every shop has had one");
assert.ok(firstRound.includes("Hollow Pine") && firstRound.includes("Fern Row"), "the shops' websites are in the first round");
assert.ok(cards.some(c => c[1] === "Linen Scarf"), "a website shop's second product is there too");
await polished("testing tools", ".main");
console.log("ok - testing tools: one product from every shop first, the shops' websites included");

// 5. Shoppers never see the Testing tools switch.
const me = page.locator("#mePage");
const openProfile = async () => { await page.evaluate(() => window.go("me")); await me.locator(".rl-arow").first().waitFor(); await page.waitForTimeout(300); };
await page.goto(origin + "/index.html");
await page.evaluate(() => localStorage.removeItem("relay-testing-tools"));
await page.reload();
await openProfile();
assert.equal(await me.getByRole("switch", { name: "Testing tools on this device" }).count(), 0, "shoppers don't get the switch");
console.log("ok - shoppers never see the Testing tools switch");

// 6. Relay's team, still to sign in again for team tools: the switch is there, off. On: Discover gets the preview from
// shops' own websites straight away; off again: it goes. The device remembers it.
st.admin = { admin: false, signInAgain: true };
await page.reload();
await openProfile();
await me.locator(".rl-arow", { hasText: "Sign in again for team tools" }).waitFor();
const sw = me.getByRole("switch", { name: "Testing tools on this device" });
await sw.waitFor();
assert.equal(await sw.getAttribute("aria-checked"), "false");
assert.match(await me.locator(".rl-aih", { hasText: "Testing tools" }).innerText(), /Relay's test shops, test orders and sample items, for trying things out\. Off shows Relay as shoppers see it\./);
await polished("team switch off", "#mePage");
const askedBefore = st.webAsked;
await sw.click();
assert.equal(await sw.getAttribute("aria-checked"), "true");
assert.equal(await page.evaluate(() => localStorage.getItem("relay-testing-tools")), "1", "remembered on this device");
await discover("Wool Beanie");
await page.locator(".dc-preview").waitFor();
assert.ok(st.webAsked > askedBefore, "the shops' websites are loaded once it's on");
await page.reload();
await discover("Wool Beanie");
console.log("ok - the team's switch turns the shops' websites preview on, and the device remembers it");
await openProfile();
await me.getByRole("switch", { name: "Testing tools on this device" }).click();
assert.equal(await me.getByRole("switch", { name: "Testing tools on this device" }).getAttribute("aria-checked"), "false");
await discover();
await page.waitForTimeout(500);
assert.equal(await page.locator(".dc-preview").count(), 0, "off again: no preview");
assert.equal(await page.locator("#catalogResults .dc-card", { hasText: "Wool Beanie" }).count(), 0, "off again: no shops' websites");
console.log("ok - off again: the preview goes");

// 7. Relay's team after signing in again: the switch sits with the team tools.
st.admin = { admin: true, openReports: 0 };
await page.reload();
await openProfile();
await me.locator(".rl-arow", { hasText: "Relay health" }).waitFor();
await me.getByRole("switch", { name: "Testing tools on this device" }).waitFor();
await polished("team tools", "#mePage");
console.log("ok - the switch is with the team tools too");

// 8. The shops' websites switch on its own: real shops only (no test shops, no test orders asked for), and each product's
// kind from what it is: colours named after food don't make clothes food, and For you gives a food reason only for food.
await page.evaluate(() => { localStorage.setItem("relay-web-preview", "1"); localStorage.setItem("relay-testing-tools", "0"); localStorage.setItem("relay-discover-personalise-v1", "true"); });
st.wrapped = { year: new Date().getFullYear(), receipts: 30, topShops: [], industries: [
  { category: "food", label: "Food & drink", spentPence: 37000 }, { category: "home", label: "Home & garden", spentPence: 33000 }, { category: "fashion", label: "Fashion", spentPence: 30000 }] };
st.purchaseAsks = [];
await page.reload();
await page.waitForTimeout(800);
assert.ok(st.purchaseAsks.length > 0 && st.purchaseAsks.every(q => q === ""), "test orders aren't asked for without the testing tools");
await discover("Plunge Bra");
await page.locator(".dc-preview").waitFor();
const shopNames = await page.$$eval("#dcShops [data-shop]", bs => bs.map(b => b.dataset.shop).filter(s => s !== "all").sort());
assert.deepEqual(shopNames, ["Big Barn", "Cocoa Cottage", "Fern Row", "Hollow Pine", "Pebble & Co", "Velvet Row"], "real shops and shops' websites only: no test shops");
assert.equal(await page.locator("#catalogResults .dc-shop", { hasText: "TEST" }).count(), 0);
await page.locator("#dcKinds [data-kind='food']").click();
assert.deepEqual((await grid()).map(c => c[1]), ["Dark Chocolate Truffles - Gift Box"], "only food is food");
await page.locator("#dcKinds [data-kind='fashion']").click();
const wear = (await grid()).filter(c => c[0] === "Velvet Row").map(c => c[1]).sort();
assert.deepEqual(wear, [...WEAR].sort(), "a bra, a top, a hoodie, a jumper, a bag, a G-string and a twosie are fashion, whatever their colour or print");
await page.locator("#dcKinds [data-kind='home']").click();
assert.ok((await grid()).some(c => c[1] === "Black Toast Glass Cake Stand"), "a cake stand is for the home, not food");
await page.locator("#dcKinds [data-kind='all']").click();
const picks = await page.$$eval("#dcForYou .dc-strip .dc-card", cs => cs.map(c => [c.querySelector(".dc-shop").textContent, c.querySelector("h3").textContent, (c.querySelector(".dc-why") || {}).textContent || ""]));
assert.ok(picks.length >= 3, "picks from what you spend: " + JSON.stringify(picks));
for (const [, product, why] of picks) if (/food/i.test(why)) assert.equal(product, "Dark Chocolate Truffles - Gift Box", "a food reason only for food: " + product + " — " + why);
assert.ok(picks.some(([shop, , why]) => shop !== "Cocoa Cottage" && /^30% of your spending is fashion/.test(why)), "clothes get the fashion reason: " + JSON.stringify(picks));
await polished("shops websites only", ".main");
console.log("ok - the shops' websites switch: real shops only; clothes are fashion whatever their colour; food reasons only for food");

// 9. The team's two switches, and a device that had testing tools on moves to the shops' websites once.
st.admin = { admin: false, signInAgain: true };
await openProfile();
const webSw = me.getByRole("switch", { name: "Shops' websites in Discover on this device" }), testSw = me.getByRole("switch", { name: "Testing tools on this device" });
assert.equal(await webSw.getAttribute("aria-checked"), "true");
assert.equal(await testSw.getAttribute("aria-checked"), "false");
assert.match(await me.locator(".rl-aih", { hasText: "Shops' websites in Discover" }).innerText(), /Real products and prices from shops' own websites, read once a day, in Discover and search by photo\. Only Relay's team sees them\./);
await polished("team switches", "#mePage");
await testSw.click();
st.purchaseAsks = [];
await page.evaluate(() => window.go("profile"));
await page.waitForTimeout(800);
assert.ok(st.purchaseAsks.includes("?test=1"), "the testing tools ask for test orders too");
await page.evaluate(() => { localStorage.removeItem("relay-web-preview"); localStorage.setItem("relay-testing-tools", "1"); });
await page.reload();
assert.deepEqual(await page.evaluate(() => [localStorage.getItem("relay-web-preview"), localStorage.getItem("relay-testing-tools")]), ["1", "0"], "moved to the shops' websites, testing tools off");
await discover("Plunge Bra");
assert.equal(await page.locator("#catalogResults .dc-shop", { hasText: "TEST" }).count(), 0, "no test shops after the move");
// A fresh device: the ?testtools=1 link still turns testing tools on, and they stay on.
await page.evaluate(() => localStorage.clear());
await page.goto(origin + "/index.html?testtools=1");
await page.goto(origin + "/index.html");
assert.deepEqual(await page.evaluate(() => [localStorage.getItem("relay-web-preview"), localStorage.getItem("relay-testing-tools")]), ["0", "1"], "the link still works on a fresh device");
console.log("ok - the team's two switches; a device with testing tools on moves to the shops' websites once; the link still works");

assert.deepEqual(errors, []);
await browser.close(); server.close();
console.log("PASS Discover mixes shops; product kinds; Relay's team's switches for shops' websites and testing tools");
