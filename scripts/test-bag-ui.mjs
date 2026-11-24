// Browser test: the shopping bag (account.js mountBag, index.html's product page and Browse). Stubbed Relay server with
// made-up shops, products and photos; nothing reaches a shop. Checks:
//  - a product's page has Add to bag with how many (1 to 10) and the sizes or colours; it adds the one picked; a sold-out
//    one can't be added; signed out, it asks to sign in first;
//  - the bag at the top of Browse shows how many things are in it, and opens the bag (an inner screen with its own Back);
//  - the bag: each shop with its logo and name, its things as one-tap cards (140px photo, name, size, quantity, price),
//    a subtotal and one "Pay at <shop>" button each; the plain line that each shop is paid at its own checkout;
//  - a card's page changes how many and takes it out; a double tap changes it only once;
//  - Pay checks the prices first: says plainly what costs more and what sold out, and its button is the shop's own cart
//    link with every thing and how many (https://<shop>/cart/<variant>:<qty>,<variant>:<qty>), leaving out what sold out;
//    a shop Relay can't fill a basket at gives each thing's own page instead and says so; when the check can't be made
//    it says so; coming back, it asks once "Did you finish paying at <shop>?": Yes takes that shop's things out, No keeps them;
//  - a new shopper's bag says what to do; shoppers without the shops' websites preview never see those products;
//  - no demo or test words, 44px taps, 13px text, contrast, no sideways scroll, and bigger text keeps everything apart.
// BAG_SHOTS=<folder> saves phone pictures (402x874 at 2x).
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, waitOutDoubleTap, closeSheet } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : extname(p) === ".svg" ? "image/svg+xml" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.BAG_SHOTS || ""; if (SHOTS) await mkdir(SHOTS, { recursive: true });
const EMAIL = "sam.tester@example.com";
const NEVER = /\bdemo\b|\bsample\b|\btest\b|testing|sandbox|fictional|prototype/i;
const CHECKED = new Date(Date.now() - 2 * 36e5).toISOString();

// Made-up shops. Hollow Pine and Saltmarsh are shops' websites (the team's preview); Juniper Row is connected to Relay.
const photo = (bg, fg) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="' + bg + '"/><path d="M70 60h60l28 24-14 18-14-10v66H70V92l-14 10-14-18z" fill="' + fg + '"/></svg>';
const PHOTOS = new Map([["/p/1.svg", photo("#e9e1d3", "#2f5d50")], ["/p/2.svg", photo("#d9cfc1", "#6b4f2f")], ["/p/3.svg", photo("#e3ecf3", "#3d5a80")], ["/p/4.svg", photo("#eadcc8", "#a8572e")]]);
const web = (domain, store, id, product, variation, price, pic, extra = {}) => ({ sku: "web:" + domain + ":" + id, product, variation, priceMinor: price, currency: "GBP", imageUrl: "https://img.example/p/" + pic + ".svg",
  quantity: extra.inStock === false ? 0 : null, inStock: extra.inStock === false ? false : true, storeName: store, shopDomain: domain, shopCategory: "fashion",
  productUrl: "https://" + domain + "/products/" + product.toLowerCase().replace(/[^a-z]+/g, "-") + "?variant=" + id, kind: null, checkedAt: CHECKED, webShop: true, ...extra });
const WEB = [
  web("hollow-pine.example", "Hollow Pine", "202", "Ribbed Jumper", "M", 7900, 2),
  web("hollow-pine.example", "Hollow Pine", "203", "Ribbed Jumper", "L", 7900, 2),
  web("hollow-pine.example", "Hollow Pine", "204", "Ribbed Jumper", "XL", 7900, 2, { inStock: false }),
  web("hollow-pine.example", "Hollow Pine", "101", "Wool Beanie", null, 2800, 1),
  web("saltmarsh.example", "Saltmarsh", "p7:1", "Sea Salt Hand Cream", null, 1600, 3, { checkout: false, productUrl: "https://saltmarsh.example/hand-cream/p/7" }),
];
const OAK = "shopify:juniper-row.myshopify.com:variant:gid://shopify/ProductVariant/1";
const CONNECTED = [{ sku: OAK, catalogueId: OAK, product: "Oak Stool", variation: null, priceMinor: 6000, currency: "GBP", quantity: 3, storeName: "Juniper Row", shopDomain: "juniper-row.myshopify.com", imageUrl: "https://img.example/p/4.svg" }];
const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#2f5d50"/><text x="20" y="26" font-size="17" text-anchor="middle" fill="#fff">H</text></svg>';

// The stand-in server's bag, as worker/bag.js keeps it (what it keeps comes from the catalogue above).
const known = new Map([...WEB, ...CONNECTED].map(p => [p.sku, p]));
const itemFor = (p) => {
  const shopify = p.sku.startsWith("shopify:"), v = /(\d+)$/.exec(p.sku)[1];
  return { sku: p.sku, kind: shopify ? "shopify" : "web", product: p.product, variation: p.variation, priceMinor: p.priceMinor, imageUrl: p.imageUrl, productUrl: p.productUrl || null,
    shop: p.storeName, shopKey: p.shopDomain, origin: shopify ? "https://" + p.shopDomain : new URL(p.productUrl).origin, variantId: p.checkout === false ? null : v, cart: p.checkout !== false };
};
let st;
const reset = () => { st = { bag: [], posts: [], checks: [], paid: [], live: {}, checkFails: false }; };
reset();

const browser = await chromium.launch();
const newPage = async (team, opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: SHOTS ? 2 : 1, colorScheme: "light", serviceWorkers: "block" }); await skipInterests(ctx);
  if (team) await ctx.addInitScript(() => { try { localStorage.setItem("relay-web-preview", "1"); } catch (e) {} });
  await ctx.route("https://**/*", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
    if (u.hostname === "img.example") return PHOTOS.has(p) ? route.fulfill({ status: 200, contentType: "image/svg+xml", body: PHOTOS.get(p) }) : route.fulfill({ status: 404, body: "" });
    if (/\.example$|myshopify\.com$/.test(u.hostname)) return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Checkout</title>" }); // the shop's own page
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (!p.startsWith("/relay/")) return route.abort();
    if (p === "/relay/shopify/catalogue") return j({ products: CONNECTED, published: true, publishedStoreCount: 1 });
    if (p === "/relay/web-shops") return j({ products: WEB, shops: [], preview: true });
    if (p === "/relay/my/bag" && m === "GET") return j({ items: st.bag, updatedAt: Date.now() });
    if (p === "/relay/my/bag" && m === "POST") {
      const b = JSON.parse(req.postData() || "{}"); st.posts.push(b);
      const at = st.bag.findIndex(x => x.sku === b.sku);
      if (b.qty === 0 && !b.add) { if (at >= 0) st.bag.splice(at, 1); }
      else if (at >= 0) st.bag[at].qty = Math.min(10, b.add ? st.bag[at].qty + b.qty : b.qty);
      else { const k = known.get(b.sku); if (!k) return j({ error: "not_found" }, 404); st.bag.push({ ...itemFor(k), qty: b.qty, addedAt: Date.now() }); }
      return j({ items: st.bag, updatedAt: Date.now() });
    }
    if (p === "/relay/my/bag/check") {
      const b = JSON.parse(req.postData() || "{}"); st.checks.push(b.shop);
      if (st.checkFails) return j({ error: "busy" }, 503);
      const here = st.bag.filter(x => x.shopKey === b.shop), cart = here.every(x => x.cart);
      const results = here.map(x => { const l = cart && st.live[x.sku]; if (!cart) return { sku: x.sku, checked: false, priceMinor: x.priceMinor, was: x.priceMinor, available: null };
        const r = { sku: x.sku, checked: true, priceMinor: l ? l.priceMinor : x.priceMinor, was: x.priceMinor, available: l ? l.available : true };
        x.priceMinor = r.priceMinor; if (r.available === false) x.soldOut = true; else delete x.soldOut; return r; });
      return j({ shop: b.shop, cart, checkedAt: Date.now(), results, items: st.bag, updatedAt: Date.now() });
    }
    if (p === "/relay/my/bag/paid") { const b = JSON.parse(req.postData() || "{}"); st.paid.push(b.shop); st.bag = st.bag.filter(x => x.shopKey !== b.shop); return j({ items: st.bag, updatedAt: Date.now() }); }
    if (p === "/relay/my/photo-search") return j({ available: false, perDay: 30 });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5 });
    if (p === "/relay/my/receipts") return j({ receipts: [] });
    if (p === "/relay/my/purchases") return j({ purchases: [] });
    if (p === "/relay/my/interests") return j({ interests: [], updatedAt: Date.now(), choices: [] });
    if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Tester", photo: null });
    if (p === "/relay/my/second-step") return j({ required: true, done: true, checked: true, app: true, text: false, passkeys: 0 });
    if (p === "/relay/my/admin/me") return j({ admin: false });
    if (/^\/relay\/my\/logo\/hollow-pine\.example$/.test(p)) return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: LOGO });
    if (/^\/relay\/my\/logo\//.test(p)) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
    return j({});
  });
  const page = await ctx.newPage(); page.errors = []; page.on("pageerror", e => page.errors.push(String(e)));
  page.on("dialog", () => { throw new Error("a browser pop-up appeared; Relay must ask inside the page"); });
  if (opts.signedOut) { await page.goto(origin + "/index.html"); return page; }
  await page.goto(origin + "/index.html");
  await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
  await page.reload();
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
    if (/[◎✦↻▶⌂◈▤⇄→✓+×✕↩−]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest("svg")) continue;
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
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(350); await page.screenshot({ path: SHOTS + "/" + name + ".png" }); } };
const openProduct = async (page, name) => {
  await page.evaluate(() => { window.go("discover"); window.dcShow("shops"); });
  await page.locator("#catalogResults .dc-card", { hasText: name }).first().click();
  await page.locator(".dc-page h2", { hasText: name }).waitFor();
};
// The bag, as a person opens it: the bag at the top of Browse.
const openBag = async (page) => { await page.evaluate(() => window.go("discover")); await waitOutDoubleTap(page); await page.locator("#dcBag").click(); await page.locator("#bagPage .bg-group, #bagPage .bg-empty").first().waitFor(); };
const sheet = (page) => page.locator(".rl-back .rl-sheet").last();

// 1. A new shopper (no shops' websites): an empty bag says what to do; only shops on Relay; Add to bag on a product.
{
  reset();
  const page = await newPage(false);
  await openBag(page);
  const empty = await page.locator("#bagPage").innerText();
  assert.match(empty, /Your bag is empty/); assert.match(empty, /tap Add to bag/);
  assert.equal(await page.locator("#view > .rl-navback[data-back]").innerText(), "Browse", "its own Back, to Browse");
  assert.deepEqual(await measure(page, "#view"), clean, "the empty bag");
  await page.locator("#bagPage .rl-po-primary", { hasText: "Go to Browse" }).click();
  await page.locator("#dcRoot").waitFor();
  await page.evaluate(() => window.dcShow("shops")); await page.locator("#catalogResults .dc-card").first().waitFor();
  assert.deepEqual(await page.$$eval("#catalogResults .dc-card h3", hs => hs.map(h => h.textContent)), ["Oak Stool"], "shops' websites never show for a shopper");
  assert.equal(await page.locator("#dcBag").getAttribute("aria-label"), "Your bag");
  assert.equal(await page.locator("#dcBagN").isHidden(), true, "no number on an empty bag");
  await openProduct(page, "Oak Stool");
  await page.locator("#bagAdd").click();
  await page.locator("#bagNote", { hasText: "Added to your bag." }).waitFor();
  assert.deepEqual(st.posts, [{ sku: OAK, qty: 1, add: true }]);
  assert.equal(await page.locator("#dcBagN").innerText(), "1", "the bag now shows 1");
  assert.deepEqual(page.errors, []);
  await page.context().close();
  console.log("ok - a new shopper: an empty bag says what to do; a connected shop's product goes in the bag; no websites' products");
}

// 2. Signed out (the welcome covers the app, but a product's page can still be reached from a link): Add to bag asks to
//    sign in first, and nothing is sent.
{
  reset();
  const page = await newPage(false, { signedOut: true });
  await page.waitForFunction(() => window.go && window.chooseSku);
  await page.evaluate(() => { window.go("discover"); });
  await page.waitForFunction(() => document.querySelector("#catalogResults .dc-card"));
  await page.evaluate(sku => window.chooseSku(sku), OAK);
  await page.locator(".dc-page h2", { hasText: "Oak Stool" }).waitFor({ state: "attached" });
  assert.equal(await page.locator("#dcBag").count(), 0, "no bag at the top while signed out");
  await page.evaluate(() => document.getElementById("bagAdd").click());
  await page.waitForTimeout(400);
  assert.deepEqual(st.posts, [], "nothing sent while signed out");
  assert.ok(await page.locator(".rl-welcome, .rl-back").count() > 0, "asks to sign in");
  await page.context().close();
  console.log("ok - signed out: Add to bag asks to sign in first");
}

// 3. Relay's team (shops' websites): sizes, how many, sold out; two shops in the bag; the card's page; Pay.
{
  reset();
  const page = await newPage(true);
  await openProduct(page, "Ribbed Jumper");
  // Pick a size: L.
  await page.locator(".dc-size", { hasText: "L" }).filter({ hasNotText: "XL" }).click();
  await page.locator(".dc-size.on", { hasText: /^L$/ }).waitFor();
  assert.equal(await page.locator("#bagLess").isDisabled(), true, "never fewer than 1");
  await page.locator("#bagMore").click(); await waitOutDoubleTap(page); await page.locator("#bagMore").click();
  assert.equal(await page.locator("#bagQty").innerText(), "3");
  const pg = await page.locator(".dc-page").innerText();
  assert.doesNotMatch(pg, NEVER);
  assert.deepEqual(await measure(page, ".dc-page"), clean, "a product's page with Add to bag");
  assert.equal(await page.locator(".dc-page .actions > *").first().innerText(), "View on their website", "the shop's own page is still there");
  await page.evaluate(() => window.scrollTo(0, 260));
  await shot(page, "product-add-to-bag");
  // A double tap adds once.
  await page.locator("#bagAdd").dblclick();
  await page.locator("#bagNote", { hasText: "Added to your bag." }).waitFor();
  await page.waitForTimeout(400);
  assert.deepEqual(st.posts, [{ sku: "web:hollow-pine.example:203", qty: 3, add: true }], "size L, 3 of them, added once");
  assert.equal(await page.locator("#bagQty").innerText(), "1", "back to 1 after adding");
  // A sold-out size can't be added.
  await waitOutDoubleTap(page);
  await page.locator(".dc-size", { hasText: "XL" }).click();
  await page.locator(".dc-size.on", { hasText: "XL" }).waitFor();
  assert.equal(await page.locator("#bagAdd").isDisabled(), true); assert.equal(await page.locator("#bagAdd").innerText(), "Sold out");
  await openProduct(page, "Wool Beanie"); await page.locator("#bagAdd").click(); await page.locator("#bagNote", { hasText: "Added" }).waitFor();
  await openProduct(page, "Oak Stool"); await page.locator("#bagAdd").click(); await page.locator("#bagNote", { hasText: "Added" }).waitFor();
  assert.equal(await page.locator("#dcBagN").innerText(), "5", "3 jumpers, a beanie and a stool");
  assert.equal(await page.locator("#dcBag").getAttribute("aria-label"), "Your bag, 5 things");
  await page.locator("#bagNote .dc-seebag").click();

  // The bag: grouped by shop, subtotals, one Pay button each.
  await page.locator("#bagPage .bg-group").first().waitFor();
  assert.equal(await page.locator("#view > .title").innerText(), "Your bag");
  assert.equal(await page.locator("#bagPage .bg-intro").count(), 0, "no grey explaining line under the title (rule 17)");
  assert.deepEqual(await page.locator("#bagPage .bg-sub span").allInnerTexts(), ["Subtotal before delivery", "Subtotal before delivery"], "each subtotal says delivery comes on top");
  const groups = await page.$$eval("#bagPage .bg-group", gs => gs.map(g => ({ shop: g.querySelector(".bg-shop-n").textContent, cards: [...g.querySelectorAll(".wl-card")].map(c => c.innerText.split("\n").filter(Boolean)), sub: g.querySelector(".bg-sub b").textContent, pay: g.querySelector(".bg-pay").textContent })));
  assert.deepEqual(groups, [
    { shop: "Hollow Pine", cards: [["Ribbed Jumper", "L", "Quantity 3", "£237.00", "£79.00 each"], ["Wool Beanie", "Quantity 1", "£28.00"]], sub: "£265.00", pay: "Pay at Hollow Pine" },
    { shop: "Juniper Row", cards: [["Oak Stool", "Quantity 1", "£60.00"]], sub: "£60.00", pay: "Pay at Juniper Row" }], "grouped by shop, with subtotals");
  await page.locator("#bagPage .bg-group[data-shop='hollow-pine.example'] .bg-logo.rl-has-logo img").waitFor();
  const pic = await page.locator("#bagPage .wl-card .wl-pic").first().boundingBox();
  assert.ok(Math.abs(pic.width - 140) < 1 && Math.abs(pic.height - 140) < 1, "140px photo squares");
  assert.equal(await page.locator("#bagPage .wl-card button").count(), 0, "no buttons on a card");
  assert.doesNotMatch(await page.locator("#view").innerText(), /·|sandbox|demo|\btest/i);
  await page.waitForFunction(() => [...document.querySelectorAll("#bagPage .wl-pic img")].every(i => i.complete && i.naturalWidth > 0));
  assert.deepEqual(await measure(page, "#view"), clean, "the bag");
  await shot(page, "bag-two-shops");

  // A card's page: how many, and a double tap changes it once.
  st.posts = [];
  await page.locator("#bagPage .wl-card", { hasText: "Wool Beanie" }).click();
  await sheet(page).locator(".bg-step").waitFor();
  assert.deepEqual(await measure(page, ".rl-sheet"), clean, "a thing's page in the bag");
  await sheet(page).getByRole("button", { name: "One more" }).dblclick();
  await sheet(page).locator(".bg-qn", { hasText: "2" }).waitFor(); await page.waitForTimeout(500);
  assert.deepEqual(st.posts, [{ sku: "web:hollow-pine.example:101", qty: 2 }], "a double tap changes it once");
  await closeSheet(page);
  await page.locator("#bagPage .bg-group[data-shop='hollow-pine.example'] .bg-sub b", { hasText: "£293.00" }).waitFor();
  await waitOutDoubleTap(page);
  await page.locator("#bagPage .wl-card", { hasText: "Wool Beanie" }).click();
  await sheet(page).getByRole("button", { name: "One fewer" }).click();
  await sheet(page).locator(".bg-qn", { hasText: "1" }).waitFor(); await page.waitForTimeout(300);
  await closeSheet(page);

  // Pay at Hollow Pine: the beanie costs more now.
  st.live = { "web:hollow-pine.example:101": { priceMinor: 3200, available: true } };
  await waitOutDoubleTap(page);
  await page.locator(".bg-group[data-shop='hollow-pine.example'] .bg-pay").dblclick();
  await sheet(page).locator(".bg-msgs").waitFor(); await page.waitForTimeout(300);
  assert.deepEqual(st.checks, ["hollow-pine.example"], "checked once, even with a double tap");
  let s = await sheet(page).innerText();
  assert.match(s, /Wool Beanie is now £32\.00\. It was £28\.00\./, "says plainly what costs more");
  assert.match(s, /Total before delivery\s*£269\.00/);
  let go = sheet(page).locator("a.bg-go");
  assert.equal(await go.innerText(), "Go to Hollow Pine's checkout");
  assert.equal(await go.getAttribute("href"), "https://hollow-pine.example/cart/203:3,101:1", "the shop's own cart link with every thing and how many");
  assert.equal(await go.getAttribute("target"), "_blank");
  assert.doesNotMatch(s, NEVER);
  assert.deepEqual(await measure(page, ".rl-sheet"), clean, "Pay at a shop");
  await shot(page, "pay-price-changed");
  await closeSheet(page);
  // Again: the jumper sold out meanwhile. It's left out of the link, and said.
  st.live["web:hollow-pine.example:203"] = { priceMinor: 7900, available: false };
  await waitOutDoubleTap(page);
  await page.locator(".bg-group[data-shop='hollow-pine.example'] .bg-pay").click();
  await sheet(page).locator(".bg-msgs").waitFor();
  s = await sheet(page).innerText();
  assert.match(s, /Ribbed Jumper \(L\) has sold out at Hollow Pine, so it's left out\./);
  assert.equal(await sheet(page).locator("a.bg-go").getAttribute("href"), "https://hollow-pine.example/cart/101:1", "what sold out is left out of the link");
  assert.match(s, /Total before delivery\s*£32\.00/);
  await closeSheet(page);
  await page.locator(".bg-group[data-shop='hollow-pine.example'] .bg-out", { hasText: "Sold out at Hollow Pine" }).waitFor();
  await page.locator(".bg-group[data-shop='hollow-pine.example'] .bg-sub b", { hasText: "£32.00" }).waitFor();
  // The jumper is back: go to the checkout, come back, and say Yes.
  st.live["web:hollow-pine.example:203"] = { priceMinor: 7900, available: true };
  await waitOutDoubleTap(page);
  await page.locator(".bg-group[data-shop='hollow-pine.example'] .bg-pay").click();
  await sheet(page).locator("a.bg-go").waitFor();
  assert.match(await sheet(page).innerText(), /Nothing has changed/);
  const [popup] = await Promise.all([page.context().waitForEvent("page"), sheet(page).locator("a.bg-go").click()]);
  assert.equal(popup.url(), "https://hollow-pine.example/cart/203:3,101:1");
  const away = (hidden) => page.evaluate(h => { Object.defineProperty(document, "hidden", { configurable: true, get: () => h }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") }); document.dispatchEvent(new Event("visibilitychange")); }, hidden);
  await away(true); await popup.close(); await away(false);
  await sheet(page).locator("h2", { hasText: "Did you finish paying at Hollow Pine?" }).waitFor();
  assert.doesNotMatch(await sheet(page).innerText(), /payment (was|is) (made|complete|successful)|you('ve| have) paid|order (is )?confirmed|Relay (has )?(taken|received)/i, "it asks; it never says a payment happened");
  assert.deepEqual(await measure(page, ".rl-sheet"), clean, "did you finish paying");
  await sheet(page).getByRole("button", { name: "Yes, I paid" }).dblclick();
  await page.locator(".bg-group[data-shop='hollow-pine.example']").waitFor({ state: "detached" });
  assert.deepEqual(st.paid, ["hollow-pine.example"], "Yes takes that shop's things out, once");
  assert.equal(await page.locator(".bg-group").count(), 1, "the other shop's things stay");
  await away(true); await away(false); await page.waitForTimeout(400);
  assert.equal(await page.locator(".rl-back .rl-sheet").count(), 0, "asked only once");

  // Juniper Row: the check can't be made; it says so, and the link still has the stool. No keeps it.
  st.checkFails = true;
  await waitOutDoubleTap(page);
  await page.locator(".bg-group[data-shop='juniper-row.myshopify.com'] .bg-pay").click();
  await sheet(page).locator(".bg-msgs").waitFor();
  assert.match(await sheet(page).innerText(), /Relay couldn't check the prices at Juniper Row just now/);
  assert.equal(await sheet(page).locator("a.bg-go").getAttribute("href"), "https://juniper-row.myshopify.com/cart/1:1");
  const [p2] = await Promise.all([page.context().waitForEvent("page"), sheet(page).locator("a.bg-go").click()]);
  await away(true); await p2.close(); await away(false);
  await sheet(page).getByRole("button", { name: "No, keep them in my bag" }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".bg-group").count(), 1, "No keeps them");
  assert.deepEqual(st.paid, ["hollow-pine.example"]);
  st.checkFails = false;

  // A shop whose basket Relay can't fill: each thing's own page, and it says so.
  await openProduct(page, "Sea Salt Hand Cream"); await page.locator("#bagAdd").click(); await page.locator("#bagNote", { hasText: "Added" }).waitFor();
  await openBag(page);
  await page.locator(".bg-group[data-shop='saltmarsh.example'] .bg-pay").click();
  await sheet(page).locator(".rl-arow").first().waitFor();
  assert.match(await sheet(page).innerText(), /Relay can't fill Saltmarsh's basket for you\. Open each one on Saltmarsh's website/);
  assert.equal(await sheet(page).locator("a.rl-arow").getAttribute("href"), "https://saltmarsh.example/hand-cream/p/7");
  assert.equal(await sheet(page).locator("a.bg-go").count(), 0, "no cart link where Relay can't build one");
  await closeSheet(page);

  // Bigger text: everything 30% larger stays apart and on the page.
  await page.evaluate(() => { for (const e of document.querySelectorAll("#view *")) { const c = getComputedStyle(e); e.style.fontSize = parseFloat(c.fontSize) * 1.3 + "px"; if (c.lineHeight !== "normal") e.style.lineHeight = parseFloat(c.lineHeight) * 1.3 + "px"; } });
  await page.waitForTimeout(300);
  const big = await page.evaluate(() => {
    const out = { overlaps: [], spills: [], wide: document.documentElement.scrollWidth > innerWidth + 1 };
    for (const c of document.querySelectorAll("#bagPage .wl-card")) {
      const r = c.getBoundingClientRect(), mid = c.querySelector(".wl-mid").getBoundingClientRect();
      if (mid.bottom > r.bottom + 0.5 || mid.right > r.right + 0.5) out.spills.push(c.innerText.slice(0, 20));
      const kids = [...c.querySelectorAll(".wl-mid > *")].map(k => k.getBoundingClientRect());
      for (let i = 1; i < kids.length; i++) if (kids[i].top < kids[i - 1].bottom - 0.5) out.overlaps.push(c.innerText.slice(0, 20));
    }
    const bs = [...document.querySelectorAll("#bagPage .bg-group > *")].map(k => k.getBoundingClientRect());
    for (let i = 1; i < bs.length; i++) if (bs[i].top < bs[i - 1].bottom - 0.5) out.overlaps.push("group part " + i);
    return out;
  });
  assert.deepEqual(big, { overlaps: [], spills: [], wide: false }, "bigger text");
  await page.evaluate(() => { for (const e of document.querySelectorAll("#view *")) { e.style.fontSize = ""; e.style.lineHeight = ""; } });
  assert.deepEqual(page.errors, []);
  // The bag at the top of Browse, beside the picture, with how many things are in it.
  await page.evaluate(() => window.go("discover")); await page.locator("#dcBag").waitFor();
  const [bagB, me] = await page.evaluate(() => [document.querySelector("#dcBag").getBoundingClientRect(), [...document.querySelectorAll(".topline .avatar")].map(a => a.getBoundingClientRect()).find(r => r.width > 0)].map(r => r && { x: r.x, y: r.y, w: r.width, h: r.height }));
  assert.ok(bagB.w >= 44 && bagB.h >= 44, "the bag is a 44px tap");
  if (me) assert.ok(bagB.x + bagB.w <= me.x && Math.abs((bagB.y + bagB.h / 2) - (me.y + me.h / 2)) < 8, "beside the picture, not on it: " + JSON.stringify([bagB, me]));
  await shot(page, "browse-bag-button");
  await page.context().close();
  console.log("ok - the team: sizes, how many, sold out, two shops grouped with subtotals, a card's page, Pay checks prices, the cart link, did you finish paying, bigger text");
}

// 4. The cart link itself.
{
  const page = await newPage(false);
  const links = await page.evaluate(() => [
    window.RelayAccount.bagCartUrl("https://shop.example", [{ variantId: "11", qty: 2 }, { variantId: "22", qty: 1 }, { variantId: "33", qty: 12 }]),
    window.RelayAccount.bagCartUrl("http://shop.example", [{ variantId: "11", qty: 1 }]),
    window.RelayAccount.bagCartUrl("https://shop.example/x", [{ variantId: "11", qty: 1 }]),
    window.RelayAccount.bagCartUrl("https://shop.example", [{ variantId: "11a", qty: 1 }]),
    window.RelayAccount.bagCartUrl("https://shop.example", [])]);
  assert.deepEqual(links, ["https://shop.example/cart/11:2,22:1,33:10", null, null, null, null], "variant:quantity pairs, https only, 10 at most each");
  await page.context().close();
  console.log("ok - the cart link: https://<shop>/cart/<variant>:<qty>,... and nothing else");
}
console.log("PASS shopping bag: add from a product, sizes and how many, grouped by shop, Pay checks prices and opens the shop's own checkout, asked once, empty state, bigger text, double taps");
await browser.close(); server.close();
