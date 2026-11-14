// Browser test: Browse with real shops for Relay's team, from shops' own websites (worker/web-shops.js).
// Stubbed Relay server with made-up shops, products, photos and logos; nothing reaches a shop. Checks: shoppers never see
// the shops' websites (not asked for, not shown, not in a shop's sheet in Your shops); with the team's Shops' websites
// switch, or ?testing=1, Shops on Relay shows each shop as its logo and name, then products as square photo tiles with
// name, price and shop; a product's page says when Relay last checked, opens the product's own page on the shop's
// website first ("View on their website", a new tab) and says where the price came from and on what day; no stock words
// on a tile; "Your interests" filters by the kinds of shops the shopper picked; in Your shops, a shop's sheet shows its
// products from its website; no demo, sample or test words anywhere; 44px taps, 13px text and 4.5 contrast, light and dark.
// YS_SHOTS=<folder> also saves 402x874 pictures at 3x.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, waitOutDoubleTap, closeSheet } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : extname(p) === ".svg" ? "image/svg+xml" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.YS_SHOTS || "/tmp/shots"; await mkdir(SHOTS, { recursive: true });
const EMAIL = "sam.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const NEVER = /\bdemo\b|\bsample\b|\btest\b|testing|sandbox|fictional|prototype/i;
const CHECKED = new Date(Date.now() - 2 * 36e5).toISOString();

// Made-up shops and products. Each photo is a made-up drawing: a soft background and a simple shape.
const SHOPS = [
  { name: "Hollow Pine", domain: "hollow-pine.example", cat: "fashion", colour: "#2f5d50", items: [["Wool Beanie", 2800, "#e9e1d3", "beanie"], ["Ribbed Knit Jumper", 7900, "#d9cfc1", "jumper"], ["Waxed Field Jacket", 14900, "#cfd8cf", "jacket"], ["Linen Overshirt", 6500, "#ece6dc", "shirt"]] },
  { name: "Fern Row", domain: "fern-row.example", cat: "home", colour: "#6b4f2f", items: [["Stoneware Mug", 1800, "#f1e4d4", "mug"], ["Oak Serving Board", 4200, "#eadcc8", "board"], ["Linen Cushion Cover", 3200, "#dde4e8", "cushion"]] },
  { name: "Lark & Lantern", domain: "larkandlantern.example", cat: "home", colour: "#a8572e", items: [["Brass Table Lamp", 8900, "#f3e6cf", "lamp"], ["Glass Candle Holder", 2400, "#e6eef0", "candle"]] },
  { name: "Saltmarsh", domain: "saltmarsh.example", cat: "beauty", colour: "#3d5a80", items: [["Sea Salt Hand Cream", 1600, "#e3ecf3", "tube"], ["Seaweed Face Oil", 3400, "#dcebe2", "bottle"]] },
];
const SHAPES = {
  beanie: '<path d="M60 120a40 40 0 0 1 80 0z" fill="FG"/><rect x="54" y="118" width="92" height="16" rx="6" fill="FG" opacity=".8"/><circle cx="100" cy="76" r="9" fill="FG"/>',
  jumper: '<path d="M70 60h60l28 24-14 18-14-10v66H70V92l-14 10-14-18z" fill="FG"/>',
  jacket: '<path d="M72 56h56l26 30v82h-30V100h-48v68H46V86z" fill="FG"/><path d="M100 56v112" stroke="#fff" stroke-width="3" opacity=".5"/>',
  shirt: '<path d="M74 58h52l24 20-12 18-12-8v80H74V88l-12 8-12-18z" fill="FG"/><path d="M100 58v110" stroke="#fff" stroke-width="2" opacity=".5"/>',
  mug: '<rect x="62" y="70" width="64" height="74" rx="10" fill="FG"/><path d="M126 86h12a14 14 0 0 1 0 28h-12" stroke="FG" stroke-width="9" fill="none"/>',
  board: '<rect x="56" y="78" width="96" height="58" rx="18" fill="FG"/><circle cx="160" cy="107" r="9" fill="FG"/>',
  cushion: '<rect x="58" y="62" width="84" height="84" rx="16" fill="FG"/><path d="M58 104h84" stroke="#fff" stroke-width="2" opacity=".4"/>',
  lamp: '<path d="M74 60h52l14 46H60z" fill="FG"/><rect x="96" y="106" width="8" height="46" fill="FG"/><rect x="76" y="150" width="48" height="10" rx="4" fill="FG"/>',
  candle: '<rect x="76" y="80" width="48" height="70" rx="12" fill="FG" opacity=".55"/><rect x="88" y="94" width="24" height="48" rx="6" fill="FG"/><path d="M100 70c6 8 6 14 0 18-6-4-6-10 0-18z" fill="#e0a040"/>',
  tube: '<path d="M80 50h40l-4 104H84z" fill="FG"/><rect x="88" y="150" width="24" height="16" rx="3" fill="FG" opacity=".7"/>',
  bottle: '<rect x="78" y="78" width="44" height="80" rx="12" fill="FG"/><rect x="90" y="54" width="20" height="26" rx="4" fill="FG" opacity=".7"/>',
};
const photo = (bg, shape, fg) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="' + bg + '"/>' + SHAPES[shape].replace(/FG/g, fg) + "</svg>";
const logo = (shop) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="' + shop.colour + '"/><text x="20" y="26" font-family="Georgia,serif" font-size="17" text-anchor="middle" fill="#fff">' + shop.name.charAt(0) + "</text></svg>";
const WEB = [], PHOTOS = new Map();
SHOPS.forEach((sh, si) => sh.items.forEach(([name, price, bg, shape], i) => {
  const id = si * 100 + i + 1, slug = name.toLowerCase().replace(/[^a-z]+/g, "-");
  PHOTOS.set("/p/" + id + ".svg", photo(bg, shape, sh.colour));
  WEB.push({ sku: "web:" + sh.domain + ":" + id, product: name, variation: null, priceMinor: price, currency: "GBP", imageUrl: "https://img.example/p/" + id + ".svg", quantity: null, inStock: true,
    storeName: sh.name, shopDomain: sh.domain, shopCategory: sh.cat, productUrl: "https://" + sh.domain + "/products/" + slug + "?variant=" + id, kind: null, checkedAt: CHECKED, webShop: true });
}));
// A shop connected to Relay, which shoppers do see.
const CONNECTED = [{ sku: "shopify:juniper-row.myshopify.com:variant:gid://shopify/ProductVariant/1", catalogueId: "shopify:juniper-row.myshopify.com:variant:gid://shopify/ProductVariant/1", product: "Oak Stool", variation: null, priceMinor: 6000, currency: "GBP", quantity: 3, storeName: "Juniper Row", shopDomain: "juniper-row.myshopify.com", imageUrl: null }];
let n = 0;
const rec = (name, domain, daysAgo, cat = "fashion") => ({ id: "00000000-0000-4000-8000-" + String(++n).padStart(12, "0"), status: "confirmed", kind: "receipt", retailer: { name, domain },
  orderRef: "R" + n, orderDate: day(-daysAgo), totalPence: 2000 + n * 100, currency: "GBP", items: [{ name: "Item " + n, qty: 1 }], category: cat, categoryLabel: "Fashion" });
const RECEIPTS = [rec("Hollow Pine", "hollow-pine.example", 4), rec("Hollow Pine", "hollow-pine.example", 30), rec("Fern Row", "fern-row.example", 12, "home")];
const st = { webAsked: 0 };

const browser = await chromium.launch();
const newPage = async (colorScheme, team, admin = false) => {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: process.env.YS_SHOTS ? 3 : 1, colorScheme, serviceWorkers: "block" }); await skipInterests(ctx);
  if (team) await ctx.addInitScript(() => { try { localStorage.setItem("relay-web-preview", "1"); } catch (e) {} });
  await ctx.route("https://**/*", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
    if (u.hostname === "img.example") return PHOTOS.has(p) ? route.fulfill({ status: 200, contentType: "image/svg+xml", body: PHOTOS.get(p) }) : route.fulfill({ status: 404, body: "" });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (!p.startsWith("/relay/")) return route.abort();
    if (p === "/relay/shopify/catalogue") return j({ products: CONNECTED, published: true, publishedStoreCount: 1 });
    if (p === "/relay/web-shops") { st.webAsked++; return j({ products: WEB, shops: SHOPS.map(s => ({ name: s.name, domain: s.domain, status: "ok", products: s.items.length, checkedAt: CHECKED })), preview: true }); }
    if (p === "/relay/my/photo-search") return j({ available: false, perDay: 30 });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5 });
    if (p === "/relay/my/receipts") return j({ receipts: RECEIPTS });
    if (p === "/relay/my/purchases") return j({ purchases: [] });
    if (p === "/relay/my/interests") return j({ interests: ["home"], updatedAt: Date.now(), choices: [] });
    if (p === "/relay/my/wrapped") return j({ receipts: 0, years: [] });
    if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Tester", photo: null });
    if (p === "/relay/my/second-step") return j({ required: true, done: true, checked: true, app: true, text: false, passkeys: 0 });
    if (p === "/relay/my/admin/me") return j({ admin });
    const lg = /^\/relay\/my\/logo\/(.+)$/.exec(p), shop = lg && SHOPS.find(s => s.domain === decodeURIComponent(lg[1]));
    if (shop) return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: logo(shop) });
    if (lg) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
    return j({});
  });
  const page = await ctx.newPage(); page.errors = []; page.on("pageerror", e => page.errors.push(String(e)));
  page.on("dialog", () => { throw new Error("a browser pop-up appeared; Relay must ask inside the page"); });
  return page;
};
const measure = (page, scope) => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; };
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " input, " + scope + " [role=button]")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓+×✕↩]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest("svg")) continue; // a drawn logo's letter
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    const caps = s.textTransform === "uppercase" || (/[A-Z]/.test(el.textContent) && el.textContent === el.textContent.toUpperCase());
    if (px < 13 && !(caps && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    const back = bgOf(el), a = lum(flat(rgb(s.color), back)), b = lum(back), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 4.5 && !el.closest("button:disabled")) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const clean = { small: [], tiny: [], symbols: [], faint: [], wide: [] };
const signIn = async (page, query = "") => {
  await page.goto(origin + "/index.html" + query);
  await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
  await page.reload();
};
const shopsOnRelay = async (page) => { await page.evaluate(() => { window.go("discover"); window.dcShow("shops"); }); await page.locator("#catalogResults .dc-card").first().waitFor(); };
const tiles = (page) => page.$$eval("#catalogResults .dc-card", cs => cs.map(c => [c.querySelector(".dc-shop").textContent, c.querySelector("h3").textContent]));
const shot = (page, name) => page.screenshot({ path: SHOTS + "/" + name + ".png" });
const photosIn = (page) => page.waitForFunction(() => [...document.querySelectorAll("#catalogResults .dc-photo")].slice(0, 4).every(i => i.complete && i.naturalWidth > 0));

// 1. A shopper: shops' websites are never asked for or shown, here or in Your shops.
{
  const page = await newPage("light", false);
  await signIn(page);
  await shopsOnRelay(page);
  assert.equal(st.webAsked, 0, "a shopper's app never asks for shops' websites");
  assert.deepEqual(await tiles(page), [["Juniper Row", "Oak Stool"]], "only shops that joined Relay");
  assert.equal(await page.locator(".dc-shopb").count(), 0);
  await page.evaluate(() => window.go("discover"));
  await page.locator(".rl-ys-shop", { hasText: "Hollow Pine" }).click();
  const sheet = page.locator(".rl-ys-sheet").last(); await sheet.waitFor();
  assert.equal(await sheet.getByText("From their website").count(), 0, "no website products for a shopper");
  assert.deepEqual(page.errors, []);
  await page.context().close();
  console.log("ok - shoppers: shops' websites never asked for or shown");
}

// 2. Relay's team (the Shops' websites switch), light and dark.
for (const scheme of ["light", "dark"]) {
  const page = await newPage(scheme, true);
  await signIn(page);
  await shopsOnRelay(page);
  await page.locator("#catalogResults .dc-card", { hasText: "Wool Beanie" }).waitFor();
  assert.ok(st.webAsked >= 1);
  // The shops: each one's logo, whole on white, and name.
  const shops = await page.locator("#dcShops .dc-shopb .dc-shopb-n").allInnerTexts();
  assert.equal(shops[0], "All shops");
  for (const s of SHOPS) assert.ok(shops.includes(s.name), s.name + " in the shops row");
  if (false) { await page.waitForTimeout(1500); console.log(await page.evaluate(() => [...document.querySelectorAll("#dcShops .dc-shopb")].map(b => { const i = b.querySelector("img"), l = b.querySelector(".dc-shopb-l"); return b.innerText.replace(/\n/g, "/") + " " + (i ? JSON.stringify(i.getBoundingClientRect()) + getComputedStyle(i).display : "noimg") + " L=" + JSON.stringify(l.getBoundingClientRect()); }).join("\n"))); }
  await page.locator("#dcShops .dc-shopb", { hasText: "Saltmarsh" }).locator(".rl-has-logo img").waitFor();
  // Products: square photo tiles, each with name, price and shop; no stock words; the connected shop too.
  const beanie = page.locator("#catalogResults .dc-card", { hasText: "Wool Beanie" });
  assert.deepEqual((await beanie.innerText()).split("\n").filter(Boolean), ["Wool Beanie", "£28.00", "Hollow Pine"], "name, price, shop, in that order");
  const box = await beanie.locator(".dc-pic").boundingBox(); assert.ok(Math.abs(box.width - box.height) < 1.5 && box.width > 150, "a square photo, two to a row");
  assert.ok((await tiles(page)).some(t => t[0] === "Juniper Row"), "connected shops still there");
  for (const t of await page.locator("#catalogResults .dc-web").allInnerTexts()) assert.doesNotMatch(t, /Out of stock|Sold out|\bleft\b|Add to bag/, "no stock words on a website's tile");
  const main = await page.locator("#dcRoot").innerText();
  assert.doesNotMatch(main, NEVER, "no demo, sample or test words");
  await photosIn(page);
  assert.deepEqual(await measure(page, "#dcRoot"), clean, "Shops on Relay for the team (" + scheme + ")");
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
  await shot(page, "browse-real-shops-" + scheme);

  // Your interests (home): only home shops.
  // The filter (behind Sort and filter): Your interests, then the kinds of thing.
  if (await page.locator("#dcFilt").getAttribute("aria-expanded") !== "true") await page.locator("#dcFilt").click();
  await page.locator("#dcKinds [data-kind=mine]").click();
  assert.deepEqual([...new Set((await tiles(page)).map(t => t[0]))].sort(), ["Fern Row", "Lark & Lantern"], "Your interests: the kinds of shops picked");
  await waitOutDoubleTap(page); await page.locator("#dcKinds [data-kind=all]").click();
  await waitOutDoubleTap(page); await page.locator("#dcFilt").click();
  // A shop's logo shows just that shop.
  await page.locator("#dcShops .dc-shopb", { hasText: "Fern Row" }).click();
  assert.deepEqual([...new Set((await tiles(page)).map(t => t[0]))], ["Fern Row"]);
  assert.equal(await page.locator("#dcShops .dc-shopb", { hasText: "Fern Row" }).getAttribute("aria-pressed"), "true");
  await waitOutDoubleTap(page); await page.locator("#dcShops .dc-shopb[data-shop=all]").click();

  // A product's page: big photo, name, price, shop, when Relay last checked, View on their website first.
  await page.locator("#catalogResults .dc-card", { hasText: "Brass Table Lamp" }).click();
  const pg = page.locator(".dc-page"); await pg.locator("h2", { hasText: "Brass Table Lamp" }).waitFor();
  const text = await pg.innerText();
  assert.match(text, /Lark & Lantern/); assert.match(text, /£89\.00/);
  const d = new Date(CHECKED), dateLong = d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  assert.equal(await pg.locator(".dc-checked span").innerText(), "When Relay last checked");
  assert.equal(await pg.locator(".dc-checked b").innerText(), dateLong + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
  const view = pg.getByRole("link", { name: "View on their website" });
  assert.equal(await view.getAttribute("href"), WEB.find(w => w.product === "Brass Table Lamp").productUrl, "the product's own page");
  assert.equal(await view.getAttribute("target"), "_blank"); assert.match(await view.getAttribute("rel"), /noopener/);
  const acts = await pg.locator(".actions > *").evaluateAll(xs => xs.map(x => (x.innerText || "").trim()));
  assert.equal(acts[0], "View on their website", "View on their website comes first");
  assert.equal(await pg.locator(".dc-pricefrom").innerText(), "Prices from Lark & Lantern's website on " + dateLong + ".");
  assert.doesNotMatch(text, /Add to bag|Out of stock|Only \d+ left/);
  assert.doesNotMatch(text, NEVER);
  const pic = await pg.locator(".dc-pagepic").boundingBox(); assert.ok(pic.width > 340, "a big photo");
  await page.waitForFunction(() => { const i = document.querySelector(".dc-pagepic .dc-photo"); return i && i.complete && i.naturalWidth > 0; });
  assert.deepEqual(await measure(page, ".dc-page"), clean, "product page (" + scheme + ")");
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  await shot(page, "product-page-" + scheme);
  await page.getByRole("button", { name: "Back" }).click();

  // Your shops: a shop's sheet shows its products from its website.
  await page.evaluate(() => window.go("discover"));
  await waitOutDoubleTap(page);
  await page.locator(".rl-ys-shop", { hasText: "Hollow Pine" }).click();
  const sheet = page.locator(".rl-ys-sheet").last(); await sheet.waitFor();
  await sheet.getByText("From their website").waitFor();
  assert.equal(await sheet.locator(".rl-ys-webp").count(), 4);
  assert.equal(await sheet.locator(".rl-ys-webd").innerText(), "Prices from Hollow Pine's website on " + new Date(CHECKED.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) + ".");
  assert.doesNotMatch(await sheet.innerText(), NEVER);
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page, ".rl-ys-sheet"), clean, "Your shops sheet with website products (" + scheme + ")");
  await shot(page, "your-shop-sheet-" + scheme);
  await sheet.locator(".rl-ys-webp", { hasText: "Waxed Field Jacket" }).click();
  await page.locator(".dc-page h2", { hasText: "Waxed Field Jacket" }).waitFor();
  assert.deepEqual(page.errors, [], "no page errors (" + scheme + ")");
  await page.context().close();
  console.log("ok - team, " + scheme + ": logos, square tiles, product page with when Relay checked, interests, Your shops");
}

// 3. Testing tools (?testing=1) show them too; without the switch they're gone again.
{
  const page = await newPage("light", false);
  await signIn(page, "?testing=1");
  await shopsOnRelay(page);
  await page.locator("#catalogResults .dc-card", { hasText: "Wool Beanie" }).waitFor();
  assert.ok(await page.locator("#dcShops .dc-shopb").count() > 1);
  // Testing tools also show Relay's own test products, marked as such; the shops' websites never are.
  for (const t of await page.locator("#catalogResults .dc-web").allInnerTexts()) assert.doesNotMatch(t, NEVER);
  await page.goto(origin + "/index.html"); await page.evaluate(() => localStorage.setItem("relay-testing-tools", "0")); await page.reload();
  await shopsOnRelay(page);
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#catalogResults .dc-card", { hasText: "Wool Beanie" }).count(), 0, "switch off: gone");
  await page.context().close();
  console.log("ok - ?testing=1 shows them; off again, they're gone");
}

// Team accounts get the shops' websites straight away, without finding the switch; a choice they made stays.
{
  const page = await newPage("dark", false, true);
  await signIn(page);
  await page.evaluate(() => window.go("discover"));
  await page.waitForFunction(() => localStorage.getItem("relay-web-preview") === "1", null, { timeout: 15000 });
  await shopsOnRelay(page);
  await page.locator("#catalogResults .dc-card", { hasText: "Wool Beanie" }).waitFor();
  await page.context().close();
  const off = await newPage("dark", false, true);
  await off.goto(origin + "/index.html");
  await off.evaluate(() => { localStorage.setItem("relay-web-preview", "0"); localStorage.setItem("relay-web-preview-chosen", "1"); });
  await signIn(off);
  await off.evaluate(() => window.go("discover")); await off.waitForTimeout(1500);
  assert.equal(await off.evaluate(() => localStorage.getItem("relay-web-preview")), "0", "a team member who switched it off keeps it off");
  await off.context().close();
  const shopper = await newPage("dark", false, false);
  await signIn(shopper);
  await shopper.evaluate(() => window.go("discover")); await shopper.waitForTimeout(1500);
  assert.notEqual(await shopper.evaluate(() => localStorage.getItem("relay-web-preview")), "1", "a shopper never gets it");
  await shopper.context().close();
  console.log("ok - on by default for Relay's team (once they open Browse); a choice to switch it off stays; shoppers never");
}

// Browse, the way Connor asked (14 Nov): a section per kind of product, its name and a chevron, then two big photos a row,
// each with the shop's round logo and name, the product's name and price. Nothing Relay doesn't have (no ratings or discounts).
{
  const page = await newPage("dark", true);
  await signIn(page);
  await page.evaluate(() => window.go("discover"));
  await page.locator("#browseGrid .bg-sec .bg-card").first().waitFor({ timeout: 15000 });
  const secs = await page.$$eval("#browseGrid .bg-sec", ss => ss.map(s => ({ h: s.querySelector(".bg-h h2").textContent, cards: [...s.querySelectorAll(".bg-card")].map(c => [c.querySelector(".bg-sn").textContent, c.querySelector(".bg-name").textContent, c.querySelector(".bg-price").textContent]) })));
  assert.ok(secs.length >= 2, "a section for each kind with products: " + JSON.stringify(secs.map(s => s.h)));
  for (const sc of secs) { assert.ok(sc.cards.length >= 2 && sc.cards.length <= 4, sc.h + ": two to four products"); for (const c of sc.cards) assert.match(c[2], /^(From )?£\d/, "a price on every product"); }
  assert.ok(secs.some(sc => sc.cards.some(c => c[1] === "Wool Beanie" && c[0] === "Hollow Pine")), "real products with their shop");
  const text = await page.locator("#browseGrid").innerText();
  assert.doesNotMatch(text, NEVER); assert.doesNotMatch(text, /\bsave\b|%|\breviews?\b|\brating/i, "no made-up discounts or ratings");
  // Two to a row, big square photos, each shop's logo beside its name.
  const g = await page.evaluate(() => { const cs = [...document.querySelectorAll("#browseGrid .bg-sec")[0].querySelectorAll(".bg-card")].map(c => c.querySelector(".bg-pic").getBoundingClientRect());
    return { w: cs[0].width, h: cs[0].height, sameRow: Math.abs(cs[0].top - cs[1].top) < 1, logos: document.querySelectorAll("#browseGrid .bg-logo .rl-ys-logo").length, cards: document.querySelectorAll("#browseGrid .bg-card").length, bg: getComputedStyle(document.body).backgroundColor }; });
  assert.ok(g.w > 160 && Math.abs(g.w - g.h) < 1 && g.sameRow, "two big square photos a row: " + JSON.stringify(g));
  assert.equal(g.logos, g.cards, "every product shows its shop's logo");
  assert.equal(g.bg, "rgb(255, 255, 255)", "white, even with the phone in dark mode");
  await page.waitForFunction(() => [...document.querySelectorAll("#browseGrid .bg-pic img")].slice(0, 4).every(i => i.complete && i.naturalWidth > 0));
  assert.deepEqual(await measure(page, "#browseGrid"), clean);
  await shot(page, "browse-grid");
  // The heading opens Shops on Relay at that kind; a product opens its page.
  const first = secs[0].h;
  await waitOutDoubleTap(page); await page.locator("#browseGrid .bg-h").first().click();
  await page.locator("#catalogResults .dc-card").first().waitFor();
  assert.equal(await page.locator("#dcKinds .dc-chip.on").innerText(), first, "the heading's kind is picked");
  await page.evaluate(() => window.dcShow("home")); await page.locator("#browseGrid .bg-card").first().waitFor();
  await waitOutDoubleTap(page); await page.locator("#browseGrid .bg-card", { hasText: "Wool Beanie" }).click();
  await page.getByText("View on their website").first().waitFor();
  assert.deepEqual(page.errors, []);
  await page.context().close();
  console.log("ok - Browse: sections by kind, two big photos a row with logo, shop, name and price; heading and product open");
}
{
  const page = await newPage("light", false);
  await signIn(page);
  await page.evaluate(() => window.go("discover"));
  await page.locator("#browsePage .rl-ys-shop").first().waitFor();
  await page.waitForTimeout(600);
  assert.equal(await page.locator("#browseGrid .bg-card").count(), 0, "a shopper sees no shops' websites in Browse");
  assert.equal(await page.locator("#browseGrid .skel").count(), 0, "and no outlines left behind");
  await page.context().close();
  console.log("ok - Browse: shoppers see only shops on Relay with photos");
}

await browser.close(); server.close();
console.log("PASS real shops for the team (screen)");
