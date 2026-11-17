// Browser test: Discover learns your style from receipts (opt-in), and Wrapped shows only real photos of things you bought.
// Stubbed Relay server, made-up data.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, openShops } from "./relay-places.mjs";
// Sort, kinds and the "Picks for you" switch are behind Shops on Relay's "Sort and filter".
const openFilters = async (page) => { if (await page.locator("#dcFilt").getAttribute("aria-expanded") !== "true") await page.locator("#dcFilt").click(); };
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
  // More of what they buy (leggings, a hoodie, trainers), a cup for someone who buys coffee, and a phone case nobody asked for.
  { product: "Everyday Leggings", variation: "Black / M", catalogueId: "shopify:kick:4", sku: "shopify:kick:4", priceMinor: 4500, currency: "GBP", quantity: 9, storeName: "Kick Lane", provider: "shopify" },
  { product: "Zip Hoodie", variation: "Grey / M", catalogueId: "shopify:kick:5", sku: "shopify:kick:5", priceMinor: 5000, currency: "GBP", quantity: 9, storeName: "Kick Lane", provider: "shopify" },
  { product: "Trail Trainers", variation: "Grey / UK 8", catalogueId: "shopify:kick:6", sku: "shopify:kick:6", priceMinor: 8000, currency: "GBP", quantity: 9, storeName: "Kick Lane", provider: "shopify" },
  { product: "Stoneware Espresso Cup", variation: "", catalogueId: "shopify:hg:8", sku: "shopify:hg:8", priceMinor: 1200, currency: "GBP", quantity: 9, storeName: "Home and Garden", provider: "shopify" },
  { product: "Breakfast Mug", variation: "", catalogueId: "shopify:hg:9", sku: "shopify:hg:9", priceMinor: 1400, currency: "GBP", quantity: 9, storeName: "Home and Garden", provider: "shopify" },
  { product: "Striped Phone Case", variation: "", catalogueId: "shopify:kick:7", sku: "shopify:kick:7", priceMinor: 3500, currency: "GBP", quantity: 9, storeName: "Kick Lane", provider: "shopify" },
  { product: "Studio Yoga Pants", variation: "Black / M", catalogueId: "shopify:kick:8", sku: "shopify:kick:8", priceMinor: 9000, currency: "GBP", quantity: 9, storeName: "Kick Lane", provider: "shopify" },
  { product: "Cosy Dog Bed", variation: "Large", catalogueId: "shopify:pets:1", sku: "shopify:pets:1", priceMinor: 3900, currency: "GBP", quantity: 12, storeName: "Pet Pantry", provider: "shopify" },
  // Two home shops (their products' names say what they are, or the shop's does).
  ...[["Linen Cushion", "Oat"], ["Metal Watering Can", ""], ["Knitted Throw Blanket", ""], ["Solar String Lights", ""]].map(([n, v], i) => ({ product: n, variation: v, catalogueId: "shopify:hg:" + i, sku: "shopify:hg:" + i, priceMinor: 2500 + i * 100, currency: "GBP", quantity: 8, storeName: "Home and Garden", provider: "shopify" })),
  ...[["Claw Hammer", ""], ["Cordless Drill 18V", ""], ["Aluminium Step Ladder", "3 step"], ["Aluminium Step Ladder", "5 step"]].map(([n, v], i) => ({ product: n, variation: v, catalogueId: "shopify:hh:" + i, sku: "shopify:hh:" + i, priceMinor: 1500 + i * 2000, currency: "GBP", quantity: 5, storeName: "Hammer & Home", provider: "shopify" }))];
const aiPicks = { available: true, on: false, posts: 0 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); await skipInterests(ctx);
const imageAsks = [], wrappedAsks = [];
await ctx.route("https://**/*", route => { const u = new URL(route.request().url()); const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!u.pathname.startsWith("/relay/")) return route.abort();
  const im = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/image$/.exec(u.pathname);
  if (im) { imageAsks.push(im[1]); return im[1].startsWith("3") ? route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "{}" }) : route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG }); }
  if (u.pathname === "/relay/my/style") return j(style);
  if (u.pathname === "/relay/my/item-kinds") { if (route.request().method() === "POST") { aiPicks.on = JSON.parse(route.request().postData()).on; aiPicks.posts++; return j({ available: true, on: aiPicks.on }); }
    return j({ available: aiPicks.available, on: aiPicks.on, kinds: aiPicks.on ? { "align high-rise flared pant": { mode: "again", kind: "leggings", look: ["leggings", "yoga pants"] } } : {} }); }
  if (u.pathname === "/relay/shopify/catalogue") return j({ published: true, products: shopProducts });
  if (u.pathname === "/relay/my/wrapped") { wrappedAsks.push(u.searchParams.get("industry")); return j(W(u.searchParams.get("industry"))); }
  if (u.pathname === "/relay/my/gmail/history") return j({ years: [], earliest: 2020 });
  if (u.pathname === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (u.pathname === "/relay/my/gmail") return j({ connected: true, provider: "google", email: "c@example.com", lastScanAt: Date.now() });
  if (u.pathname === "/relay/my/profile") return j({ email: "c@example.com", name: "Cat", photo: null });
  return j({}); });
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.addInitScript(() => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "S".repeat(43), email: "c@example.com" })));
await skipInterests(page); // (after the session, so it knows who's signed in)
await page.goto(origin + "/index.html"); await page.waitForTimeout(800);

// Discover: picks are off until the shopper turns them on. Then they come from the things on their receipts: more of a kind
// people buy again (leggings, a hoodie, trainers), in their colour and size where the shop has it, and each pick says why.
await openShops(page);
const invite = page.locator(".dc-pickrow", { hasText: "Turn on picks for you" });
await invite.getByText("Chosen from your receipts. Only you see them.").waitFor();
await invite.click();
const panel = page.locator(".dc-for");
await panel.getByRole("heading", { name: "Picked for you" }).waitFor();
const picks = panel.locator(".dc-strip [data-card-select]");
await picks.first().waitFor();
const said = await picks.evaluateAll(cs => cs.map(c => [c.querySelector("h3").textContent, c.querySelector(".dc-why").innerText]));
assert.deepEqual(said, [
  ["Trail Trainers", "Like the trainers you bought at Kick Lane\nIn your size, UK 8"],
  ["Everyday Leggings", "Like the leggings you bought at Lululemon\nIn black, like yours"],
  ["Zip Hoodie", "Like the hoodie you bought at Studio North\nIn your size, M"]], "one of each kind they buy, best match first");
const panelText = await panel.innerText();
assert.ok(!panelText.includes("Court Classic Trainers"), "never the very thing they already bought");
for (const no of ["Cosy Dog Bed", "Striped Phone Case", "Espresso Cup", "Canvas Tote", "Cordless Drill"]) assert.ok(!panelText.includes(no), "nothing unrelated to what they buy: " + no);
assert.doesNotMatch(panelText, /% |spending|spend most/i, "no shares of spending");
// The list below starts with the picks, and everything else is still there, just later.
const grid = await page.locator("#catalogResults [data-card-select] h3").allInnerTexts();
assert.deepEqual(grid.slice(0, 3), said.map(x => x[0])); assert.ok(grid.includes("Cosy Dog Bed"));
// "Not for me" on a pick's page: hidden, fewer of that kind, and it can be undone. Relay says it learnt it, and Forget my style
// clears what it learnt on this phone.
await page.locator("#dcForYou .dc-strip [data-card-select]", { hasText: "Everyday Leggings" }).click();
await page.locator(".dc-page h2", { hasText: "Everyday Leggings" }).waitFor();
await page.getByRole("button", { name: "Not for me" }).click();
await panel.locator(".dc-fewer", { hasText: "Fewer leggings from now on." }).waitFor();
assert.ok(!(await panel.locator(".dc-strip").innerText()).includes("Everyday Leggings"), "hidden from picks");
await panel.getByRole("button", { name: "Undo" }).click();
await panel.locator(".dc-strip [data-card-select]", { hasText: "Everyday Leggings" }).waitFor();
assert.equal(await panel.locator(".dc-fewer").count(), 0);
await panel.getByRole("button", { name: "Forget my style" }).waitFor();
// A product that isn't a pick has no "Not for me".
await page.locator("#catalogResults [data-card-select]", { hasText: "Cosy Dog Bed" }).click();
await page.locator(".dc-page h2", { hasText: "Cosy Dog Bed" }).waitFor();
assert.equal(await page.getByRole("button", { name: "Not for me" }).count(), 0);
await page.getByRole("button", { name: "Back" }).first().click();
await panel.getByRole("button", { name: "Forget my style" }).click();
await panel.getByRole("button", { name: "Forget my style" }).waitFor({ state: "detached" });
// AI for picks: offered in the panel, explained in a sheet, and only on once they say so. Then the AI's reading of their
// receipts counts: it knows the Align pants are leggings, and that yoga pants are like them.
assert.ok(!(await panel.locator(".dc-strip").innerText()).includes("Studio Yoga Pants"), "the word lists don't know yoga pants are leggings");
await panel.locator(".dc-airow", { hasText: "Smarter picks with AI" }).click();
const aiSheet = page.locator(".rl-sheet"); await aiSheet.getByRole("heading", { name: "Smarter picks with AI" }).waitFor();
assert.match(await aiSheet.innerText(), /It gets the item names and the shop, nothing else: not your emails, address, order numbers or prices\./);
assert.equal(aiPicks.posts, 0, "nothing changes until they choose");
await aiSheet.getByRole("button", { name: "Turn on" }).click();
await panel.locator(".dc-strip [data-card-select]", { hasText: "Studio Yoga Pants" }).waitFor();
assert.equal(aiPicks.on, true);
assert.equal(await panel.locator(".dc-airow").count(), 0, "not offered again once on");
assert.match(await panel.locator(".dc-strip [data-card-select]", { hasText: "Studio Yoga Pants" }).locator(".dc-why").innerText(), /^Like the leggings you bought at Lululemon/);
// Kinds of product: chips to narrow it down (and picks step aside while filtering).
await openFilters(page);
await page.locator("#dcKinds").getByRole("button", { name: "Pets" }).click();
assert.deepEqual(await page.locator("#catalogResults [data-card-select] h3").allInnerTexts(), ["Cosy Dog Bed"]);
assert.equal(await page.locator(".dc-for").count(), 0);
await page.locator("#dcKinds").getByRole("button", { name: "Everything" }).click();
await panel.getByRole("heading", { name: "Picked for you" }).waitFor();
assert.equal(await page.locator('#catalogResults [data-card-select="shopify:kick:1"] .dc-opts').innerText(), "White · UK 8, UK 9", "the colour is said once, then the sizes");
await page.waitForTimeout(1300);   // the drawings finish drawing themselves in
await page.screenshot({ path: "/tmp/shots/discover-for-you.png", fullPage: true });
// Turning picks off leaves a "Picks for you" switch in the filters (the invitation was answered, so it doesn't come back).
await panel.getByRole("button", { name: "Turn off" }).click();
await page.locator(".dc-for").waitFor({ state: "detached" });
assert.equal(await invite.count(), 0, "the invitation was answered");
await openFilters(page);
await page.locator(".dc-chips").getByRole("button", { name: "Picks for you" }).waitFor();
// Sizes read in their natural order, and the ladder's two sizes are one product.
assert.equal(await page.locator("#catalogResults [data-card-select]", { hasText: "Aluminium Step Ladder" }).count(), 1);
assert.equal(await page.locator("#catalogResults .dc-card", { hasText: "Aluminium Step Ladder" }).locator(".dc-opts").innerText(), "3 step, 5 step");
// Someone whose biggest purchase was a TV, who also buys coffee and groceries: a TV is a one-off, so no more electronics (and
// no phone cases); food picks nothing; the coffee gets one cup, the espresso one, because they probably have cups already.
const wardrobe = style.receipts;
style.receipts = [
  { id: "b1", retailer: { name: "Screen Barn" }, category: "electronics", items: [{ name: "55 inch QLED TV", variant: "", pricePence: 20000 }] },
  { id: "b2", retailer: { name: "Bean Post" }, category: "food", items: [{ name: "Espresso capsules, 50 pack", variant: "", pricePence: 2500 }] },
  { id: "b3", retailer: { name: "Corner Grocer" }, category: "food", items: [{ name: "Bananas", variant: "", pricePence: 120 }, { name: "Semi-skimmed milk", variant: "", pricePence: 150 }] }];
await page.evaluate(() => { try { localStorage.removeItem("relay.cache.v1"); } catch (e) {} });
await page.reload(); await page.waitForTimeout(600);
await openShops(page);
await openFilters(page);
await page.locator(".dc-chips").getByRole("button", { name: "Picks for you" }).click();
await picks.first().waitFor();
assert.deepEqual(await picks.evaluateAll(cs => cs.map(c => [c.querySelector("h3").textContent, c.querySelector(".dc-why").innerText])),
  [["Stoneware Espresso Cup", "Goes with your coffee from Bean Post"]], "one cup for the coffee, and nothing for the TV or the groceries");
await page.waitForTimeout(1300);
await page.screenshot({ path: "/tmp/shots/discover-home-picks.png", fullPage: false });
// Nothing on the receipts that a shop here follows: says so plainly.
style.receipts = [{ id: "c1", retailer: { name: "Screen Barn" }, category: "electronics", items: [{ name: "55 inch QLED TV", variant: "", pricePence: 20000 }] }];
await page.evaluate(() => { try { localStorage.removeItem("relay.cache.v1"); } catch (e) {} });
await page.reload(); await page.waitForTimeout(600);
await openShops(page);
await panel.getByText("Nothing in Browse goes with what you've bought yet. As more shops join, picks show up here.").waitFor();
assert.equal(await picks.count(), 0);
await panel.getByRole("button", { name: "Turn off" }).click();
style.receipts = wardrobe;
await page.evaluate(() => { try { localStorage.removeItem("relay.cache.v1"); } catch (e) {} });
await page.reload(); await page.waitForTimeout(600);
console.log("PASS Discover: opt-in picks from the things you bought (more of a kind you buy again, one companion, nothing for one-offs or food), each with a reason; Not for me, undo and forget; AI for picks only once chosen; filters and turn off work");

// Wrapped: one story a year, on its own page (Browse's Wrapped card opens it). Total, where it went, a chapter (with its own scene) per kind of
// shopping, then the year's highlights. Real photos only: a photo that can't be fetched is left out, never replaced.
await page.evaluate(() => window.go("wrapped"));
assert.equal(await page.evaluate(() => window.page), "wrapped", "Wrapped has its own page");
await page.getByRole("button", { name: "Play your 2026 story" }).waitFor();
assert.match(await page.locator(".rl-wr-cover").innerText(), /Your 2026 in purchases\.\s+£336\.00 over 4 receipts\. 2 chapters in your story\./);
assert.equal(await page.locator(".rl-wr-kinds").count(), 0, "no separate Wrapped per kind any more: one story");
assert.equal(await page.locator(".rl-wr-cover .rl-wr-dots i").count(), 2, "the card's colour strip shows how the year split");
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
const order = [/RELAY WRAPPED 2026/, /In 2026 you spent/, /Where it went/, /CHAPTER 1\s+Fashion/, /CHAPTER 2\s+Digital & subscriptions/, /Your top shops/, /Your busiest month/, /MY 2026 ON RELAY/];
let at = -1; for (const re of order) { const i = texts.findIndex((x, n) => n > at && re.test(x)); assert.ok(i > at, "in order: " + re); at = i; }
for (const re of [/It started on 4 January with Court Classic Trainers from Kick Lane\./, /Fashion\s+£[\d,]+\.\d\d\s+\d+%/, /Digital & subscriptions/,
  /4 orders from 3 places\. That's 89% of your year\./, /5 pieces added to your wardrobe, about £67\.20 each\./, /Your go-to shop\s+Kick Lane\s+2 orders/, /Bought again and again\s+Align Pant\s+3 times/, /Your style\s+Sporty & Relaxed/,
  /About £4\.99 a month on apps and subscriptions\./, /Your badges\s+Loyal to Lululemon/, /Biggest chapter\s+Fashion/]) assert.match(story, re);
assert.deepEqual(scenes.map(c => c.replace("scene ", "")), ["sc-fashion", "sc-digital"], "each chapter has its own scene");
for (const re of [/Your top 5/, /Your shop sprint/, /Your favourite kind of shopping/]) assert.doesNotMatch(story, re);
await page.keyboard.press("Escape");

// No checked photos: no photo slide and not a single picture anywhere in the story.
photos = [];
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/wrapped/.test(k)) localStorage.removeItem(k); });
await page.reload(); await page.waitForTimeout(800);
await page.evaluate(() => window.go("wrapped"));
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
console.log("PASS Wrapped: one yearly story on its own page (total, split, a chapter with its own scene per kind, highlights), real photos only");
await browser.close(); server.close();
