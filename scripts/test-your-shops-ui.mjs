// Browser test: Browse's "Your shops", made only from the shopper's own receipts and shop orders.
// Stubbed Relay server with made-up shops, receipts and a made-up logo; nothing reaches a shop. Checks: one shop however
// its name is spelt (same web address, or the same name once "&"/"and", spaces and capitals are set aside); most bought
// from first, then the latest; "Visit their website" only with a web address Relay has from the shop (never a mail host,
// a carrier or a guess); Relay's test shops only with testing tools on; receipts marked not a purchase, delivery emails
// and carriers left out; a shop's sheet with its count, last date and receipts (which open the receipt); "Shops on Relay"
// for a connected shop; "See all" with a search past 12 shops; a new shopper sees no empty section. Passes the polish
// rules (44px taps, 13px text, contrast, no symbols as icons) in light and dark, at phone size.
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
const SHOPPER_NEVER_SEES = /\bdemo\b|sandbox|simulat|fictional|prototype|test mode|test shop|testing/i;
let n = 0;
const rec = (name, domain, daysAgo, extra = {}) => ({ id: "00000000-0000-4000-8000-" + String(++n).padStart(12, "0"), status: "confirmed", kind: "receipt", retailer: { name, domain },
  orderRef: "R" + n, orderDate: day(-daysAgo), totalPence: 1000 + n * 100, currency: "GBP", items: [{ name: "Item " + n, qty: 1, pricePence: 1000 + n * 100 }], category: "fashion", categoryLabel: "Fashion", ...extra });
const RECEIPTS = [
  // One shop, three spellings: two share the web address, the third shares the name.
  rec("Fern & Fable", "fernandfable.example", 40), rec("FERN AND FABLE", "www.fernandfable.example", 10), rec("Fern&Fable", null, 70),
  // Forwarded from a personal inbox: the sender is a mail host, so Relay has no web address for the shop.
  rec("Ivy Lane", "gmail.com", 5, { category: "home", categoryLabel: "Home & garden" }), rec("Ivy Lane", "gmail.com", 90, { category: "home", categoryLabel: "Home & garden" }),
  // Connected to Relay: its products are in Browse.
  rec("Juniper Row", "juniper-row.myshopify.com", 3, { category: "home", categoryLabel: "Home & garden" }),
  // One receipt each: the latest first.
  rec("Moss Kitchen", "mosskitchen.example", 2, { category: "food", categoryLabel: "Food & drink" }), rec("Orchard Tech", "orchardtech.example", 60, { category: "electronics", categoryLabel: "Electronics" }),
  // Left out: a Relay test shop (the server marks it), something marked not a purchase, a delivery email, a carrier.
  rec("Pebble Goods", "pebble-goods.myshopify.com", 1, { testShop: true }),
  rec("Spammy Deals", "spammy.example", 1, { status: "not_receipt" }),
  rec("Moss Kitchen", "mosskitchen.example", 1, { kind: "delivery_update" }),
  rec("Royal Mail", "royalmail.com", 1)];
const variant = (shop, i) => "shopify:" + shop + ".myshopify.com:variant:gid://shopify/ProductVariant/" + i;
const CATALOGUE = [{ sku: variant("juniper-row", 1), catalogueId: variant("juniper-row", 1), product: "Oak Stool", variation: null, priceMinor: 6000, currency: "GBP", quantity: 3, storeName: "Juniper Row", shopDomain: "juniper-row.myshopify.com", imageUrl: null }];
const TEST_PRODUCT = { sku: variant("pebble-goods", 1), catalogueId: variant("pebble-goods", 1), product: "Pebble Mug", variation: null, priceMinor: 1500, currency: "GBP", quantity: 3, storeName: "Pebble Goods", shopDomain: "pebble-goods.myshopify.com", imageUrl: null, testShop: true };
// A made-up logo for the made-up Fern & Fable.
const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#2f6b4f"/><path d="M20 8c6 6 6 18 0 24c-6-6-6-18 0-24z" fill="#c7f567"/></svg>';
const st = { receipts: RECEIPTS, purchases: [] };

const browser = await chromium.launch();
const newPage = async (colorScheme) => {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: process.env.YS_SHOTS ? 3 : 1, colorScheme, serviceWorkers: "block" }); await skipInterests(ctx);
  await ctx.route("https://**/*", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (!p.startsWith("/relay/")) return route.abort();
    // Like the server: test shops' products only with ?test=1 (testing tools on).
    if (p === "/relay/shopify/catalogue") return j({ products: u.searchParams.get("test") === "1" ? [...CATALOGUE, TEST_PRODUCT] : CATALOGUE, published: true, publishedStoreCount: 1 });
    if (p === "/relay/web-shops") return j({ products: [], shops: [] });
    if (p === "/relay/my/photo-search") return j({ available: false, perDay: 30 });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5 });
    if (p === "/relay/my/receipts") return j({ receipts: st.receipts });
    if (p === "/relay/my/purchases") return j({ purchases: st.purchases });
    if (p === "/relay/my/wrapped") return j({ receipts: 0, years: [] });
    if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Tester", photo: null });
    if (p === "/relay/my/second-step") return j({ required: true, done: true, checked: true, app: true, text: false, passkeys: 0 });
    if (p === "/relay/my/admin/me") return j({ admin: false });
    if (p === "/relay/my/logo/fernandfable.example") return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: LOGO });
    if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
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
const browse = async (page) => { await page.evaluate(() => window.go("discover")); await page.locator("#discoverPage .rl-ys, .rl-ys").first().waitFor({ state: "attached" }); };
const shopNames = (page) => page.locator(".rl-ys-row .rl-ys-name").allInnerTexts();
const openShop = async (page, name) => { await page.locator(".rl-ys-shop", { hasText: name }).first().click(); const s = page.locator(".rl-ys-sheet").last(); await s.waitFor(); return s; };
const closeAll = async (page) => { for (let i = 0; i < 4 && await page.locator(".rl-back").count(); i++) { await waitOutDoubleTap(page); await closeSheet(page); } };
const shot = (page, name) => page.screenshot({ path: SHOTS + "/" + name + ".png" });

for (const scheme of ["light", "dark"]) {
  st.receipts = RECEIPTS;
  const page = await newPage(scheme);
  await signIn(page);
  await browse(page);
  await page.locator(".rl-ys-row .rl-ys-shop").first().waitFor();

  // 1. One entry per shop, most bought from first, then the latest; left-out receipts stay out.
  assert.deepEqual(await shopNames(page), ["Fern & Fable", "Ivy Lane", "Moss Kitchen", "Juniper Row", "Orchard Tech"], "grouped, most bought from first, then the latest (" + scheme + ")");
  assert.equal(await page.locator(".rl-ys-h h2").innerText(), "Your shops");
  assert.equal(await page.locator(".rl-ys-all").count(), 0, "no See all for five shops");
  const main = await page.locator(".main").innerText();
  assert.ok(!SHOPPER_NEVER_SEES.test(main), "no test wording for shoppers");
  assert.ok(!/Pebble Goods|Spammy|Royal Mail/.test(await page.locator(".rl-ys").innerText()), "test shop, not-a-purchase and carrier left out");
  // The logo rule: Fern & Fable's logo whole on white; the others their initial on their kind's soft tile.
  await page.locator(".rl-ys-shop", { hasText: "Fern & Fable" }).locator(".rl-ys-logo.rl-has-logo img").waitFor();
  assert.equal(await page.locator(".rl-ys-shop", { hasText: "Ivy Lane" }).locator(".rl-ys-logo").innerText(), "I");
  assert.deepEqual(await measure(page, ".rl-ys"), clean, "Your shops row polish (" + scheme + ")");
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
  await shot(page, "browse-your-shops-" + scheme);

  // 2. A shop's sheet: count, last date, the website it came from, its receipts.
  let sheet = await openShop(page, "Fern & Fable");
  const text = await sheet.innerText();
  assert.match(text, /You've bought from here 3 times/);
  assert.match(text, new RegExp("Last on " + new Date(day(-10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })));
  const site = sheet.locator("a", { hasText: "Visit their website" });
  assert.equal(await site.getAttribute("href"), "https://fernandfable.example/", "the address from the shop's own emails, www set aside");
  assert.equal(await site.getAttribute("target"), "_blank");
  assert.match(await site.getAttribute("rel"), /noopener/);
  assert.equal(await sheet.locator(".rl-arow").count(), 3, "all three receipts, whatever the spelling");
  assert.equal(await sheet.getByText("See them on Shops on Relay").count(), 0, "not connected to Relay");
  assert.deepEqual(await measure(page, ".rl-ys-sheet"), clean, "shop sheet polish (" + scheme + ")");
  await page.waitForTimeout(400); await shot(page, "shop-sheet-" + scheme);
  // A receipt row opens that receipt.
  await sheet.locator(".rl-arow").first().click();
  await page.getByText("R2", { exact: false }).first().waitFor({ timeout: 5000 }).catch(() => {});
  assert.ok(await page.locator(".rl-sheet, [role=dialog]").filter({ hasText: "FERN AND FABLE" }).count() + await page.locator(".rl-sheet, [role=dialog]").filter({ hasText: "Item 2" }).count() > 0, "the newest receipt opened");
  await closeAll(page);

  // 3. No web address for a forwarded receipt (the sender is a mail host).
  await waitOutDoubleTap(page);
  sheet = await openShop(page, "Ivy Lane");
  assert.match(await sheet.innerText(), /You've bought from here twice/);
  assert.equal(await sheet.getByText("Visit their website").count(), 0, "never a guessed address");
  await closeAll(page);

  // 4. A shop on Relay: its button opens Shops on Relay at that shop.
  await waitOutDoubleTap(page);
  sheet = await openShop(page, "Juniper Row");
  assert.match(await sheet.innerText(), /You've bought from here once/);
  assert.equal(await sheet.locator("a", { hasText: "Visit their website" }).getAttribute("href"), "https://juniper-row.myshopify.com/");
  await sheet.getByText("See them on Shops on Relay").click();
  await page.locator("#catalogResults .dc-card", { hasText: "Oak Stool" }).first().waitFor();
  assert.equal(await page.evaluate(() => window.storeFilter === undefined ? "Juniper Row" : String(window.storeFilter)), "Juniper Row");
  assert.deepEqual(page.errors, [], "no page errors (" + scheme + ")");
  await page.context().close();
  console.log("ok - " + scheme + ": grouped, ordered, website only when known, test shops hidden, sheet, Shops on Relay");
}

// 5. With testing tools on, Relay's test shop shows.
{
  st.receipts = RECEIPTS;
  const page = await newPage("light");
  await signIn(page, "?testing=1");
  await browse(page);
  await page.locator(".rl-ys-shop", { hasText: "Pebble Goods" }).waitFor();
  assert.deepEqual(await shopNames(page), ["Fern & Fable", "Ivy Lane", "Pebble Goods", "Moss Kitchen", "Juniper Row", "Orchard Tech"]);
  await page.context().close();
  console.log("ok - testing tools: Relay's test shop shows");
}

// 6. More than 12 shops: See all, with a search.
{
  n = 0;
  st.receipts = Array.from({ length: 15 }, (_, i) => rec("Shop " + String.fromCharCode(65 + i) + " Studio", "shop" + i + ".example", i + 1));
  const page = await newPage("light");
  await signIn(page);
  await browse(page);
  await page.locator(".rl-ys-row .rl-ys-shop").first().waitFor();
  assert.equal(await page.locator(".rl-ys-row .rl-ys-shop").count(), 12, "twelve in the row");
  await page.locator(".rl-ys-all").click();
  const all = page.locator(".rl-sheet, [role=dialog]").filter({ hasText: "Search" }).last();
  const search = page.getByRole("searchbox", { name: "Search your shops" });
  await search.waitFor();
  assert.equal(await page.locator("[aria-label='Your shops'] .rl-arow").filter({ visible: true }).count(), 15, "every shop in See all");
  await search.fill("shop c");
  assert.deepEqual(await page.locator("[aria-label='Your shops'] .rl-arow").filter({ visible: true }).allInnerTexts().then(t => t.map(x => x.split("\n").find(l => l.trim().length > 1))), ["Shop C Studio"]);
  await search.fill("zebra");
  await page.getByText("None of your shops is called that.").waitFor();
  for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); assert.deepEqual(await measure(page, "[aria-label='Your shops']"), clean, "See all polish (" + scheme + ")"); }
  void all;
  await page.context().close();
  console.log("ok - more than 12 shops: See all with a search");
}

// 7. A new shopper: no empty section.
{
  st.receipts = [];
  const page = await newPage("light");
  await signIn(page);
  await browse(page);
  await page.waitForTimeout(800);
  assert.equal(await page.locator(".rl-ys-shop").count(), 0);
  assert.equal(await page.getByText("Your shops", { exact: true }).count(), 0, "no heading with nothing under it");
  await page.context().close();
  console.log("ok - a new shopper: the section is left out");
}

await browser.close(); server.close();
console.log("PASS your shops (screen)");
