// Browser test: search by photo on Discover, and the catalogue preview from shops' own websites (testing tools only).
// Stubbed Relay server, made-up shops, products and people; nothing reaches Anthropic or a shop. Checks: the camera shows
// only once photo search is on (testing tools: always, explaining when it's off); the first time on a device it says
// where the picture goes before sending; the picture is made smaller (at most 1024 pixels) before it's sent; greyed
// outlines while it searches; one search for a double tap; results open the product; no match, no product and the daily
// limit in plain words; shoppers never see the preview or test words; the preview shows shops' websites with a link to
// buy on the shop's own website and when Relay checked. Passes the polish rules in light and dark, at phone size.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com";
const SHOPPER_NEVER_SEES = /\bdemo\b|sandbox|simulat|fictional|prototype|test mode|test shop|preview|testing/i;
const COURT = "shopify:oak-thread.myshopify.com:variant:gid://shopify/ProductVariant/11";
const BEANIE = "web:hollow-pine.test:72";
const CHECKED = new Date(Date.now() - 2 * 36e5).toISOString();

const st = { photoOn: false, answer: "results", posts: [], webAsked: 0, delay: 400 };
const shopify = [
  { sku: COURT, catalogueId: COURT, product: "Court Classic Trainers", variation: "White / UK 8", priceMinor: 8500, currency: "GBP", quantity: 3, storeName: "Oak & Thread", shopDomain: "oak-thread.myshopify.com", imageUrl: null },
  { sku: COURT.replace("/11", "/12"), catalogueId: COURT.replace("/11", "/12"), product: "Court Classic Trainers", variation: "White / UK 9", priceMinor: 8500, currency: "GBP", quantity: 2, storeName: "Oak & Thread", shopDomain: "oak-thread.myshopify.com", imageUrl: null },
  { sku: "shopify:oak-thread.myshopify.com:variant:gid://shopify/ProductVariant/21", catalogueId: "shopify:oak-thread.myshopify.com:variant:gid://shopify/ProductVariant/21", product: "Linen Shirt", variation: "M", priceMinor: 4500, currency: "GBP", quantity: 4, storeName: "Oak & Thread", shopDomain: "oak-thread.myshopify.com", imageUrl: null }];
const web = [
  { sku: "web:hollow-pine.test:71", product: "Wool Beanie", variation: "Navy", priceMinor: 2800, currency: "GBP", imageUrl: null, quantity: 0, inStock: false, storeName: "Hollow Pine", shopDomain: "hollow-pine.test", productUrl: "https://hollow-pine.test/products/wool-beanie?variant=71", kind: "Hats", checkedAt: CHECKED, webShop: true },
  { sku: BEANIE, product: "Wool Beanie", variation: "Grey", priceMinor: 2500, currency: "GBP", imageUrl: null, quantity: null, inStock: true, storeName: "Hollow Pine", shopDomain: "hollow-pine.test", productUrl: "https://hollow-pine.test/products/wool-beanie?variant=72", kind: "Hats", checkedAt: CHECKED, webShop: true },
  { sku: "web:fern-row.test:91", product: "Canvas Tote Bag", variation: null, priceMinor: 1800, currency: "GBP", imageUrl: null, quantity: null, inStock: true, storeName: "Fern Row", shopDomain: "fern-row.test", productUrl: "https://fern-row.test/products/canvas-tote-bag?variant=91", kind: "Bags", checkedAt: CHECKED, webShop: true }];
const ANSWERS = {
  results: () => ({ found: true, item: "white leather trainers", results: [
    { sku: COURT, product: "Court Classic Trainers", variation: null, priceMinor: 8500, currency: "GBP", imageUrl: null, inStock: true, storeName: "Oak & Thread" },
    { sku: "shopify:oak-thread.myshopify.com:variant:gid://shopify/ProductVariant/21", product: "Linen Shirt", variation: "M", priceMinor: 4500, maxPriceMinor: 4700, currency: "GBP", imageUrl: null, inStock: true, storeName: "Oak & Thread" }] }),
  web: () => ({ found: true, item: "grey wool beanie", results: [{ sku: BEANIE, product: "Wool Beanie", variation: null, priceMinor: 2500, maxPriceMinor: 2800, currency: "GBP", imageUrl: null, inStock: true, storeName: "Hollow Pine", webShop: true, productUrl: web[1].productUrl }] }),
  none: () => ({ found: true, item: "red dress", results: [] }),
  nothing: () => ({ found: false, item: null, results: [] }),
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx.route("https://**/*", async route => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p === "/relay/my/photo-search" && m === "GET") return j({ available: st.photoOn, perDay: 30 });
  if (p === "/relay/my/photo-search" && m === "POST") {
    st.posts.push(JSON.parse(req.postData() || "{}"));
    await new Promise(ok => setTimeout(ok, st.delay)); // long enough to see the outlines
    if (st.answer === "limit") return j({ error: "too_many_searches" }, 429);
    if (st.answer === "busy") return j({ error: "busy" }, 503);
    return j(ANSWERS[st.answer]());
  }
  if (p === "/relay/shopify/catalogue") return j({ products: shopify, published: true, publishedStoreCount: 1 });
  if (p === "/relay/web-shops") { st.webAsked++; return j({ products: web, shops: [], preview: true }); }
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5 });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/admin/me") return j({ admin: false });
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", () => { throw new Error("a browser pop-up appeared; Relay must ask inside the page"); });
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
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
  await page.evaluate(() => getSelection().removeAllRanges()); // a double tap in the test selects words; a phone doesn't
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/photo-search-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const signIn = async (url) => {
  await page.goto(url);
  await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
  await page.reload();
};
const discover = async () => { await page.evaluate(() => window.go("discover")); await page.locator(".dc-card").first().waitFor(); };
// A big screenshot-sized picture (1600 × 1000), as a phone would give.
const picture = Buffer.from(await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 1600; c.height = 1000; const g = c.getContext("2d");
  g.fillStyle = "#e9e4d8"; g.fillRect(0, 0, 1600, 1000); g.fillStyle = "#fafafa"; g.beginPath(); g.ellipse(800, 560, 520, 210, 0, 0, Math.PI * 2); g.fill();
  return c.toDataURL("image/png").split(",")[1]; }), "base64");
const pick = async () => {
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#dcCam").click();
  await (await chooser).setFiles({ name: "screenshot.png", mimeType: "image/png", buffer: picture });
};
const sheet = page.locator(".rl-ps");

// 1. Off: no camera for shoppers, and no shops' websites.
await signIn(origin + "/index.html");
await discover();
await page.waitForTimeout(300);
assert.equal(await page.locator("#dcCam").isVisible(), false, "no camera while photo search is off");
assert.equal(st.webAsked, 0, "shoppers never get the shops' websites preview");
assert.equal(await page.locator(".dc-preview").count(), 0);
console.log("ok - off: no camera; shoppers never get the preview");

// 2. On: the camera in the search box; the first time, where the picture goes, before anything is sent.
st.photoOn = true;
await page.reload();
await discover();
await page.locator("#dcCam").waitFor();
assert.equal(await page.locator("#dcCam").getAttribute("aria-label"), "Search by photo");
await polished("search box", ".dc-bar");
await pick();
await sheet.getByRole("button", { name: "Find it" }).waitFor();
assert.match(await sheet.innerText(), /Your picture is sent to Claude, an AI made by Anthropic, to see what's in it and find the closest items from shops on Relay\. Relay doesn't keep the picture\./);
assert.equal(st.posts.length, 0, "nothing sent before Find it");
const size = await sheet.locator(".rl-ps-pic").evaluate(i => [i.naturalWidth, i.naturalHeight]);
assert.deepEqual(size, [1024, 640], "made smaller before it's sent");
await polished("before sending", ".rl-ps");
console.log("ok - camera in the search box; says where the picture goes before sending; made smaller first");

// 3. One search for a double tap; outlines while it searches; then what it looks like and the closest products.
await sheet.getByRole("button", { name: "Find it" }).dblclick();
await sheet.locator(".rl-ps-skel").first().waitFor();
assert.equal(await sheet.getByText("Loading", { exact: false }).count(), 0, "no bare Loading text");
await sheet.getByText("Looks like: white leather trainers").waitFor();
assert.equal(st.posts.length, 1, "searched once for a double tap");
assert.match(st.posts[0].image, /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/);
assert.equal(st.posts[0].test, false);
assert.ok(st.posts[0].image.length < 400000, "a small picture is sent");
await sheet.getByRole("button", { name: "Court Classic Trainers, £85.00, from Oak & Thread" }).waitFor();
await sheet.getByRole("button", { name: "Linen Shirt, M, From £45.00, from Oak & Thread" }).waitFor();
assert.ok(!SHOPPER_NEVER_SEES.test(await sheet.innerText()), "no test or preview words for shoppers");
await polished("results", ".rl-ps");
console.log("ok - one search for a double tap; outlines while searching; what it looks like and the closest products");

// 4. A result opens that product.
await sheet.getByRole("button", { name: "Court Classic Trainers, £85.00, from Oak & Thread" }).click();
assert.equal(await sheet.count(), 0, "the sheet closes");
await page.locator(".dc-page h2", { hasText: "Court Classic Trainers" }).waitFor();
await page.getByRole("button", { name: /Watch price/ }).waitFor();
console.log("ok - a result opens its product");

// 5. The next search on this device goes straight ahead. Nothing close: says so, and offers a search by name.
await page.getByRole("button", { name: "Back" }).click();
st.answer = "none";
await pick();
await sheet.getByRole("heading", { name: "Nothing like it on Relay yet" }).waitFor();
assert.equal(st.posts.length, 2, "no Find it step the second time");
await polished("nothing close", ".rl-ps");
await sheet.getByRole("button", { name: "Search for “red dress”" }).click();
assert.equal(await page.locator("#query").inputValue(), "red dress");
await page.getByRole("heading", { name: "Nothing matches that" }).waitFor();
await page.locator("#query").fill(""); await page.evaluate(() => window.renderCatalog());
console.log("ok - remembered on this device; nothing close says so and searches by name");

// 6. No product in the picture, the daily limit, busy: plain words, and another photo can be tried.
for (const [answer, text] of [["nothing", "Couldn't see a product"], ["limit", "That's 30 photo searches today. Try again tomorrow."], ["busy", "Photo search is busy right now. Try again in a minute."]]) {
  st.answer = answer;
  await pick();
  await sheet.getByText(text).waitFor();
  assert.doesNotMatch(await sheet.innerText(), /too_many|busy"|503|429|error/i, "no codes or server words");
  await sheet.getByRole("button", { name: "Try another photo" }).waitFor();
  await sheet.getByRole("button", { name: "Close" }).click();
}
console.log("ok - no product, the daily limit and busy in plain words");

// 7. Testing tools: the preview from shops' own websites, mixed into Discover, each bought on the shop's own website.
st.photoOn = false; st.answer = "web";
await page.goto(origin + "/index.html?testing=1");
await discover();
await page.locator(".dc-preview").waitFor();
assert.match(await page.locator(".dc-preview").innerText(), /^Preview: products from 2 shops' own websites\. Relay reads their public product lists once a day\. These shops haven't joined Relay, so shoppers don't see them\. Tap a product to buy it on the shop's website\.$/);
assert.ok(st.webAsked >= 1);
const beanie = page.locator(".dc-cardwrap").filter({ hasText: "Wool Beanie" });
assert.equal(await beanie.locator("[data-watch]").count(), 0, "no price alerts for shops' websites");
await polished("discover preview", ".main");
await beanie.locator(".dc-card").click();
await page.locator(".dc-page h2", { hasText: "Wool Beanie" }).waitFor();
const buy = page.getByRole("link", { name: "Buy on their website" });
assert.equal(await buy.getAttribute("href"), web[1].productUrl, "opens the colour that can be bought");
assert.equal(await buy.getAttribute("target"), "_blank"); assert.match(await buy.getAttribute("rel"), /noopener/);
const when = new Date(CHECKED).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
assert.match(await page.locator("#watchNote").innerText(), new RegExp("^Price and stock as Hollow Pine's website showed them (today|yesterday) at " + when + "\\. You buy it there, not through Relay\\.$"));
assert.equal(await page.getByRole("button", { name: /Watch price/ }).count(), 0, "no price alerts for shops' websites");
await page.getByRole("button", { name: /^Navy/ }).click();
assert.equal(await page.getByRole("link", { name: "Buy on their website" }).getAttribute("href"), web[0].productUrl, "each colour links to its own page");
assert.match(await page.locator("#watchNote").innerText(), new RegExp("^Sold out on Hollow Pine's website when Relay checked (today|yesterday) at " + when + "\\."));
await polished("website product", ".main");
console.log("ok - testing tools: shops' websites in Discover, no price alerts, bought on the shop's website, with when Relay checked");

// 8. Testing tools while photo search is off: the camera explains what turns it on; nothing is picked or sent.
await page.getByRole("button", { name: "Back" }).click();
await page.locator("#dcCam").click();
await sheet.getByRole("heading", { name: "Search by photo is off" }).waitFor();
assert.match(await sheet.innerText(), /Add a secret named ANTHROPIC_API_KEY/);
await polished("off in testing", ".rl-ps");
await sheet.getByRole("button", { name: "Close" }).click();
// On: the search includes test shops and shops' websites, and a website's result opens there too.
st.photoOn = true;
await page.reload();
await discover();
await pick();
await sheet.getByText("Looks like: grey wool beanie").waitFor();
assert.equal(st.posts.at(-1).test, true, "testing tools ask for test shops and shops' websites too");
await sheet.getByRole("button", { name: "Wool Beanie, From £25.00, from Hollow Pine" }).click();
await page.locator(".dc-page h2", { hasText: "Wool Beanie" }).waitFor();
assert.equal(await page.getByRole("link", { name: "Buy on their website" }).getAttribute("href"), web[1].productUrl);
console.log("ok - testing tools: off explains the key; on, searches shops' websites too and opens them");

assert.deepEqual(errors, []);
await browser.close(); server.close();
console.log("PASS search by photo and the shops' websites preview");
