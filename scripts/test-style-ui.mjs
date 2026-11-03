// Browser test: Discover learns your style from receipts (opt-in), and Wrapped shows only real photos of things you bought.
// Stubbed Relay server, made-up data.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const PNG = await readFile("pics/products/linen-shirt.png");
const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const style = { receipts: [
  { id: "a1", retailer: { name: "Lululemon" }, category: "fashion", items: [{ name: "Align High-Rise Flared Pant", variant: "Black / M", pricePence: 9800 }, { name: "Define Jacket", variant: "Black / M", pricePence: 11800 }] },
  { id: "a2", retailer: { name: "Studio North" }, category: "fashion", items: [{ name: "Oversized Hoodie", variant: "Oat / M", pricePence: 5500 }] },
  { id: "a3", retailer: { name: "Kick Lane" }, category: "fashion", items: [{ name: "Court Classic Trainers", variant: "White / UK 8", pricePence: 8500 }] }] };
let photos = [{ id: "11111111-1111-4111-8111-111111111111", shop: "Lululemon", item: "Align Pant", more: 0, date: "2026-03-02" }, { id: "22222222-2222-4222-8222-222222222222", shop: "Kick Lane", item: "Court Trainers", more: 1, date: "2026-04-02" }, { id: "33333333-3333-4333-8333-333333333333", shop: "Gone", item: "Missing photo", more: 0 }];
// The whole year's Wrapped, or (with an industry) the Wrapped for one kind of shopping.
let industries = [{ category: "fashion", label: "Fashion", receipts: 4, spentPence: 33600 }, { category: "digital", label: "Digital & subscriptions", receipts: 8, spentPence: 3992 }];
const W = () => ({ ...base(), industries, industry: null, chapters: [
  { category: "fashion", label: "Fashion", receipts: 4, spentPence: 33600, withTotal: 4, share: 89, topShop: { name: "Kick Lane", receipts: 2, spentPence: 12000 }, shops: 3, items: 5,
    topItem: { name: "Align Pant", times: 3 }, things: ["Align Pant"], biggest: { shop: "Lululemon", item: "Align Pant", totalPence: 21600 }, busiestMonth: "Mar", favouriteDay: "Saturday", photos: [], subscriptions: 0, fact: { kind: "perPiece", pence: 6720, pieces: 5 } },
  { category: "digital", label: "Digital & subscriptions", receipts: 8, spentPence: 3992, withTotal: 8, share: 11, topShop: { name: "Apple", receipts: 8, spentPence: 3992 }, shops: 1, items: 8,
    topItem: null, things: [], biggest: null, busiestMonth: "Mar", favouriteDay: null, photos: [], subscriptions: 1, fact: { kind: "perMonth", pence: 499, months: 8 } }] });
const base = () => ({ year: 2026, years: [{ year: 2026, receipts: 4 }], receipts: 4, shops: 3, items: 5, spentPence: 33600, currency: "GBP", topItem: null, refundedPence: 0, refundsMatched: 0, topShopShare: 40, activeMonths: 3, firstDate: "2026-01-04",
  coverage: { withTotal: 4, noTotal: 0, otherCurrency: 0 }, topShops: [{ name: "Lululemon", receipts: 1, spentPence: 21600 }, { name: "Kick Lane", receipts: 2, spentPence: 12000 }],
  categories: [{ category: "fashion", label: "Fashion", receipts: 4, topShop: { name: "Kick Lane", receipts: 2 } }], byMonth: months.map((m, i) => ({ month: m, receipts: i === 2 ? 2 : 0, spentPence: 0 })), busiestMonth: "Mar",
  biggest: { shop: "Lululemon", totalPence: 21600, date: "2026-03-02", item: "Align Pant", photoId: photos.length ? photos[0].id : null }, returnsStarted: 0, personality: { label: "The Style Seeker", why: "4 of your 4 receipts were fashion, most of them from Kick Lane." },
  firstBuy: { shop: "Kick Lane", item: "Court Classic Trainers", date: "2026-01-04" }, photos,
  topItems: [{ name: "Align Pant", times: 3, spentPence: 29400, shop: "Lululemon" }, { name: "Socks, 3 pack", times: 2, spentPence: 1800, shop: "Kick Lane" }, { name: "Define Jacket", times: 1, spentPence: 11800, shop: "Lululemon" }],
  yearList: [{ name: "Align Pant", times: 3, spentPence: 29400, shop: "Lululemon" }, { name: "Socks, 3 pack", times: 2, spentPence: 1800, shop: "Kick Lane" }, { name: "Define Jacket", times: 1, spentPence: 11800, shop: "Lululemon" }],
  topBuys: [{ shop: "Lululemon", item: "Align Pant", items: 1, totalPence: 21600 }, { shop: "Kick Lane", item: null, items: 3, totalPence: 8500 }, { shop: "Kick Lane", item: "Hoodie", items: 1, totalPence: 3500 }],
  shoppingTime: { days: 23, favouriteDay: "Saturday", favouriteDayCount: 7, weekendShare: 45, longestMonthStreak: 5 },
  sprint: [{ name: "Lululemon", months: [0,0,2,1,0,0,0,0,0,0,0,0] }, { name: "Kick Lane", months: [1,0,1,0,0,0,0,0,0,0,0,0] }],
  subscriptions: [{ name: "Apple", months: 8, spentPence: 3992, item: "Match Masters" }],
  badges: [{ label: "Loyal to Lululemon", why: "64% of your spending went there." }, { label: "Weekend Shopper", why: "45% of your shopping days were Saturdays or Sundays." }], things: style.receipts.flatMap(r => r.items.map(i => ({ name: i.name, variant: i.variant, shop: r.retailer.name, pricePence: i.pricePence }))), note: "" });
// Products from shops on Relay: trainers and a tote at a shop the shopper buys from, and a dog bed (they've never bought pet things).
const shopProducts = [
  { product: "Court Classic Trainers", variation: "White / UK 8", catalogueId: "shopify:kick:1", sku: "shopify:kick:1", priceMinor: 8500, currency: "GBP", quantity: 9, storeName: "Kick Lane", provider: "shopify" },
  { product: "Court Classic Trainers", variation: "White / UK 9", catalogueId: "shopify:kick:2", sku: "shopify:kick:2", priceMinor: 8500, currency: "GBP", quantity: 9, storeName: "Kick Lane", provider: "shopify" },
  { product: "Canvas Tote", variation: "Natural", catalogueId: "shopify:kick:3", sku: "shopify:kick:3", priceMinor: 2400, currency: "GBP", quantity: 30, storeName: "Kick Lane", provider: "shopify" },
  { product: "Cosy Dog Bed", variation: "Large", catalogueId: "shopify:pets:1", sku: "shopify:pets:1", priceMinor: 3900, currency: "GBP", quantity: 12, storeName: "Pet Pantry", provider: "shopify" },
  // Two home shops (their products' names say what they are, or the shop's does).
  ...[["Linen Cushion", "Oat"], ["Metal Watering Can", ""], ["Knitted Throw Blanket", ""], ["Solar String Lights", ""]].map(([n, v], i) => ({ product: n, variation: v, catalogueId: "shopify:hg:" + i, sku: "shopify:hg:" + i, priceMinor: 2500 + i * 100, currency: "GBP", quantity: 8, storeName: "Home and Garden", provider: "shopify" })),
  ...[["Claw Hammer", ""], ["Cordless Drill 18V", ""], ["Aluminium Step Ladder", "3 step"], ["Aluminium Step Ladder", "5 step"]].map(([n, v], i) => ({ product: n, variation: v, catalogueId: "shopify:hh:" + i, sku: "shopify:hh:" + i, priceMinor: 1500 + i * 2000, currency: "GBP", quantity: 5, storeName: "Hammer & Home", provider: "shopify" }))];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const imageAsks = [], wrappedAsks = [];
await ctx.route("https://**/*", route => { const u = new URL(route.request().url()); const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!u.pathname.startsWith("/relay/")) return route.abort();
  const im = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/image$/.exec(u.pathname);
  if (im) { imageAsks.push(im[1]); return im[1].startsWith("3") ? route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "{}" }) : route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG }); }
  if (u.pathname === "/relay/my/style") return j(style);
  if (u.pathname === "/relay/shopify/catalogue") return j({ published: true, products: shopProducts });
  if (u.pathname === "/relay/my/wrapped") { wrappedAsks.push(u.searchParams.get("industry")); return j(W(u.searchParams.get("industry"))); }
  if (u.pathname === "/relay/my/gmail/history") return j({ years: [], earliest: 2020 });
  if (u.pathname === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (u.pathname === "/relay/my/gmail") return j({ connected: true, provider: "google", email: "c@example.com", lastScanAt: Date.now() });
  if (u.pathname === "/relay/my/profile") return j({ email: "c@example.com", name: "Cat", photo: null });
  return j({}); });
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.addInitScript(() => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "S".repeat(43), email: "c@example.com" })));
await page.goto(origin + "/index.html"); await page.waitForTimeout(800);

// Discover: picks are off until the shopper turns them on. Then they come from the year's spending (from Wrapped: 89% fashion
// here), the shops they buy from and their sizes from receipts, and each pick says why it's there.
await page.evaluate(() => window.go("discover"));
await page.locator(".dc-invite", { hasText: "Picks from what you spend" }).waitFor();
await page.locator(".dc-invite").getByRole("button", { name: "Turn on" }).click();
const panel = page.locator(".dc-for");
await panel.getByRole("heading", { name: "Picked for you" }).waitFor();
await panel.locator(".dc-basis", { hasText: "sporty" }).waitFor();
const basis = await panel.locator(".dc-basis").innerText();
assert.match(basis, /^From your 2026 spending: 89% fashion, 11% digital & subscriptions\./);
assert.match(basis, /You're sporty and relaxed, mostly in neutrals\. Usually a size M, UK 8 in shoes\./);
const picks = panel.locator(".dc-strip [data-card-select]");
assert.equal(await picks.first().locator("h3").innerText(), "Court Classic Trainers", "the best match comes first");
assert.equal(await picks.first().locator(".dc-why").innerText(), "You spend most on fashion · You buy from Kick Lane");
assert.ok(!(await panel.innerText()).includes("Cosy Dog Bed"), "nothing they've never spent on is pushed at them");
// The list below follows the same order, and the pet shop's product is still there, just later.
const grid = await page.locator("#catalogResults [data-card-select] h3").allInnerTexts();
assert.equal(grid[0], "Court Classic Trainers"); assert.ok(grid.includes("Cosy Dog Bed"));
// Two shops and two kinds of product: chips to narrow it down (and picks step aside while filtering).
await page.locator("#dcKinds").getByRole("button", { name: "Pets" }).click();
assert.deepEqual(await page.locator("#catalogResults [data-card-select] h3").allInnerTexts(), ["Cosy Dog Bed"]);
assert.equal(await page.locator(".dc-for").count(), 0);
await page.locator("#dcKinds").getByRole("button", { name: "Everything" }).click();
await panel.getByRole("heading", { name: "Picked for you" }).waitFor();
assert.equal(await page.locator('#catalogResults [data-card-select="shopify:kick:1"] .dc-opts').innerText(), "White · UK 8, UK 9", "the colour is said once, then the sizes");
await page.waitForTimeout(1300);   // the drawings finish drawing themselves in
await page.screenshot({ path: "/tmp/shots/discover-for-you.png", fullPage: true });
// Forgetting the style keeps the spending picks; turning picks off goes back to the invitation.
await panel.getByRole("button", { name: "Forget my style" }).click();
await page.waitForTimeout(200);
assert.doesNotMatch(await panel.locator(".dc-basis").innerText(), /sporty/);
await panel.getByRole("button", { name: "Turn off" }).click();
await page.locator(".dc-invite", { hasText: "Picks from what you spend" }).waitFor();
// Sizes read in their natural order, and the ladder's two sizes are one product.
assert.equal(await page.locator("#catalogResults [data-card-select]", { hasText: "Aluminium Step Ladder" }).count(), 1);
assert.equal(await page.locator("#catalogResults .dc-card", { hasText: "Aluminium Step Ladder" }).locator(".dc-opts").innerText(), "3 step, 5 step");
// Someone whose money mostly goes on their home: most picks are for the home, even though they buy from a shoe shop in their
// size. The places are shared out by spending (45% home to 10% fashion), never more than three from one shop, and nothing is
// picked for food because no shop on Relay sells it yet.
const fashionYear = industries;
industries = [{ category: "home", label: "Home & garden", receipts: 9, spentPence: 45000 }, { category: "food", label: "Food & drink", receipts: 20, spentPence: 33000 },
  { category: "fashion", label: "Fashion", receipts: 3, spentPence: 10000 }, { category: "other", label: "Other", receipts: 4, spentPence: 12000 }];
await page.evaluate(() => { try { localStorage.removeItem("relay.cache.v1"); } catch (e) {} });
await page.reload(); await page.waitForTimeout(600);
await page.evaluate(() => window.go("discover"));
await page.locator(".dc-invite").getByRole("button", { name: "Turn on" }).click();
await panel.locator(".dc-basis", { hasText: "45% home & garden" }).waitFor();
const homePicks = await panel.locator(".dc-strip [data-card-select]").evaluateAll(cs => cs.map(c => [c.querySelector(".dc-shop").textContent, c.querySelector("h3").textContent, c.querySelector(".dc-why").textContent]));
assert.equal(homePicks.length, 6);
assert.equal(homePicks.filter(p => p[0] === "Home and Garden" || p[0] === "Hammer & Home").length, 5, "five of six picks are for the home");
assert.deepEqual(homePicks.filter(p => p[0] === "Kick Lane").map(p => p[1]), ["Court Classic Trainers"], "one pick for the 10% spent on fashion");
assert.ok(homePicks.every(p => ["Home and Garden", "Hammer & Home", "Kick Lane"].includes(p[0]) && homePicks.filter(q => q[0] === p[0]).length <= 3), "at most three from one shop");
assert.match(homePicks[0][2], /^You spend most on home & garden/);
assert.equal(homePicks.find(p => p[1] === "Court Classic Trainers")[2], "10% of your spending is fashion · You buy from Kick Lane");
assert.deepEqual((await page.locator("#catalogResults [data-card-select] h3").allInnerTexts()).slice(0, 5).sort(), homePicks.slice(0, 5).map(p => p[1]).sort(), "the list below starts the same way");
await page.waitForTimeout(1300);
await page.screenshot({ path: "/tmp/shots/discover-home-picks.png", fullPage: false });
await panel.getByRole("button", { name: "Turn off" }).click();
industries = fashionYear;
await page.evaluate(() => { try { localStorage.removeItem("relay.cache.v1"); } catch (e) {} });
await page.reload(); await page.waitForTimeout(600);
console.log("PASS Discover: opt-in picks shared out by where the money goes (shops, sizes and price within each kind), each with a reason; filters, forget and turn off work");

// Wrapped: one story a year on the Profile page. Total, where it went, a chapter (with its own scene) per kind of
// shopping, then the year's highlights. Real photos only: a photo that can't be fetched is left out, never replaced.
await page.evaluate(() => window.go("wrapped"));
assert.equal(await page.evaluate(() => window.page), "me", "the old Wrapped address opens Profile");
await page.getByRole("button", { name: "Play your 2026 story" }).waitFor();
assert.match(await page.locator("#rl-wrapped").innerText(), /Your 2026 in purchases\.\s+£336\.00 · 4 receipts · 2 chapters/);
assert.equal(await page.locator(".rl-wr-kinds").count(), 0, "no separate Wrapped per kind any more: one story");
assert.equal(await page.locator("#rl-wrapped .rl-wr-dots i").count(), 2, "the card's colour strip shows how the year split");
await page.getByRole("button", { name: "Play your 2026 story" }).click();
assert.equal(await page.locator(".rl-story-x svg").count(), 1, "close is a drawn icon"); assert.equal((await page.locator(".rl-story-x").innerText()).trim(), "");
const texts = [], scenes = [];
for (let k = 0; k < 20; k++) {
  await page.waitForTimeout(900);
  texts.push(await page.locator(".rl-story-body").innerText());
  if (await page.locator(".rl-story-body .scene").count()) scenes.push(await page.locator(".rl-story-body .scene").getAttribute("class"));
  if (texts.at(-1).includes("Some things you brought home")) { assert.equal(await page.locator(".rl-story-body .ph img").count(), 2); assert.match(await page.locator(".rl-story-body .ph").getAttribute("class"), /\bn2\b/, "the grid re-flows for the photos that loaded"); }
  if (texts.at(-1).includes("CHAPTER 1")) await page.screenshot({ path: "/tmp/shots/wrapped-chapter-fashion.png" });
  if (texts.at(-1).includes("Where it went")) await page.screenshot({ path: "/tmp/shots/wrapped-split.png" });
  if (await page.getByRole("button", { name: "Watch again" }).count()) break;
  await page.keyboard.press("ArrowRight");
}
const story = texts.join("\n");
const order = [/RELAY WRAPPED 2026/, /In 2026 you spent/, /Where it went/, /CHAPTER 1 · FASHION/, /CHAPTER 2 · DIGITAL & SUBSCRIPTIONS/, /Your top shops/, /Your busiest month/, /MY 2026 ON RELAY/];
let at = -1; for (const re of order) { const i = texts.findIndex((x, n) => n > at && re.test(x)); assert.ok(i > at, "in order: " + re); at = i; }
for (const re of [/It started on 4 January with Court Classic Trainers from Kick Lane\./, /Fashion\s+89% · £336\.00|Fashion\s+\d+% · £/, /Digital & subscriptions/,
  /89% of your year · 4 orders · 3 places/, /5 pieces added to your wardrobe, about £67\.20 each\./, /Your go-to shop\s+Kick Lane · 2×/, /Bought again and again\s+Align Pant · 3×/, /Your style\s+Sporty & Relaxed/,
  /About £4\.99 a month on apps and subscriptions\./, /Your badges\s+Loyal to Lululemon/, /Biggest chapter\s+Fashion/]) assert.match(story, re);
assert.deepEqual(scenes.map(c => c.replace("scene ", "")), ["sc-fashion", "sc-digital"], "each chapter has its own scene");
for (const re of [/Your top 5/, /Your shop sprint/, /Your favourite kind of shopping/]) assert.doesNotMatch(story, re);
await page.keyboard.press("Escape");

// No checked photos: no photo slide and not a single picture anywhere in the story.
photos = [];
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/wrapped/.test(k)) localStorage.removeItem(k); });
await page.reload(); await page.waitForTimeout(800);
await page.evaluate(() => window.go("me"));
await page.getByRole("button", { name: "Play your 2026 story" }).click();
const plain = [];
for (let k = 0; k < 20; k++) {
  await page.waitForTimeout(500);
  plain.push(await page.locator(".rl-story-body").innerText());
  assert.equal(await page.locator(".rl-story-body img").count(), 0, "no stand-in pictures");
  if (await page.getByRole("button", { name: "Watch again" }).count()) break;
  await page.keyboard.press("ArrowRight");
}
assert.ok(!plain.join("\n").includes("brought home"));
assert.deepEqual(errors, []);
console.log("PASS Wrapped: one yearly story on Profile (total, split, a chapter with its own scene per kind, highlights), real photos only");
await browser.close(); server.close();
