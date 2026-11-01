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
const W = () => ({ year: 2026, years: [{ year: 2026, receipts: 4 }], receipts: 4, shops: 3, items: 5, spentPence: 33600, currency: "GBP", topItem: null, refundedPence: 0, refundsMatched: 0, topShopShare: 40, activeMonths: 3, firstDate: "2026-01-04",
  coverage: { withTotal: 4, noTotal: 0, otherCurrency: 0 }, topShops: [{ name: "Lululemon", receipts: 1, spentPence: 21600 }, { name: "Kick Lane", receipts: 2, spentPence: 12000 }],
  categories: [{ category: "fashion", label: "Fashion", receipts: 4, topShop: { name: "Kick Lane", receipts: 2 } }], byMonth: months.map((m, i) => ({ month: m, receipts: i === 2 ? 2 : 0, spentPence: 0 })), busiestMonth: "Mar",
  biggest: { shop: "Lululemon", totalPence: 21600, date: "2026-03-02", item: "Align Pant", photoId: photos.length ? photos[0].id : null }, returnsStarted: 0, personality: { label: "The Style Seeker", why: "4 of your 4 receipts were fashion, most of them from Kick Lane." },
  firstBuy: { shop: "Kick Lane", item: "Court Classic Trainers", date: "2026-01-04" }, photos, things: style.receipts.flatMap(r => r.items.map(i => ({ name: i.name, variant: i.variant, shop: r.retailer.name, pricePence: i.pricePence }))), note: "" });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const imageAsks = [];
await ctx.route("https://**/*", route => { const u = new URL(route.request().url()); const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!u.pathname.startsWith("/relay/")) return route.abort();
  const im = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/image$/.exec(u.pathname);
  if (im) { imageAsks.push(im[1]); return im[1].startsWith("3") ? route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "{}" }) : route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG }); }
  if (u.pathname === "/relay/my/style") return j(style);
  if (u.pathname === "/relay/my/wrapped") return j(W());
  if (u.pathname === "/relay/my/gmail/history") return j({ years: [], earliest: 2020 });
  return j({}); });
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.addInitScript(() => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "S".repeat(43), email: "c@example.com" })));
await page.goto(origin + "/index.html"); await page.waitForTimeout(800);

// Discover: off until the shopper turns it on, then a plain description from their receipts.
await page.evaluate(() => window.go("discover"));
await page.getByText("Let Relay learn what you like").waitFor();
await page.getByRole("button", { name: "Show me my style" }).click();
const card = page.locator("#tasteCard");
await card.getByText("YOUR STYLE, FROM YOUR RECEIPTS").waitFor();
const t = await card.innerText();
assert.match(t, /You're sporty and relaxed, mostly in neutrals\. Usually a size M, UK 8 in shoes\./);
for (const want of ["Sporty · 3", "Black", "Size M", "UK 8 shoes", "Lululemon"]) assert.ok(t.includes(want), "style card shows " + want);
assert.match(t, /From 4 items on your receipts/);
// Searching a store says what's put first there.
await page.locator("#storeSearch").fill("Kick Lane");
await card.getByText("At Kick Lane:").waitFor();
assert.match(await card.innerText(), /At Kick Lane: things in your size M, UK 8, black, sporty pieces are shown first\./);
await page.screenshot({ path: "/tmp/shots/style-card.png", fullPage: false });
// Forget clears it.
await card.getByRole("button", { name: "Forget" }).click();
assert.equal(await card.getByText("YOUR STYLE, FROM YOUR RECEIPTS").count(), 0);
console.log("PASS Discover style: opt-in, sizes/colours/styles from receipts, store search explains what goes first, forget works");

// Wrapped: real photos only; a photo that can't be fetched is left out, never replaced.
await page.evaluate(() => window.go("wrapped"));
await page.getByRole("button", { name: /Play your story/ }).waitFor();
const strip = page.locator(".rl-wr-strip");
await page.waitForFunction(() => document.querySelectorAll(".rl-wr-strip img").length === 2);
await page.waitForTimeout(300);
assert.equal(await strip.locator("figure").count(), 2, "the photo that couldn't load is removed, not swapped for another picture");
assert.ok((await strip.innerText()).includes("Court Trainers +1"));
await page.getByRole("button", { name: /Play your story/ }).click();
const texts = [];
for (let k = 0; k < 20; k++) {
  await page.waitForTimeout(1300);
  texts.push(await page.locator(".rl-story-body").innerText());
  if (texts.at(-1).includes("Some things you brought home")) { assert.equal(await page.locator(".rl-story-body .ph img").count(), 2); assert.match(await page.locator(".rl-story-body .ph").getAttribute("class"), /\bn2\b/, "the grid re-flows for the photos that loaded"); await page.screenshot({ path: "/tmp/shots/wrapped-photos.png" }); }
  if (await page.getByRole("button", { name: "Watch again" }).count()) break;
  await page.keyboard.press("ArrowRight");
}
const story = texts.join("\n");
for (const re of [/It started on 4 January with Court Classic Trainers from Kick Lane\./, /Some things you brought home/, /Photos from your own order emails/, /Your style in 2026/, /sporty and relaxed/,
  /your go-to was Kick Lane \(2\)/, /Align Pant, at Lululemon on 2 March/, /The Style Seeker/, /Style\s+Sporty & Relaxed/]) assert.match(story, re);
await page.keyboard.press("Escape");

// No checked photos: no photo slide and not a single picture anywhere in the story.
photos = [];
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/wrapped/.test(k)) localStorage.removeItem(k); });
await page.reload(); await page.waitForTimeout(800);
await page.evaluate(() => window.go("wrapped"));
await page.getByRole("button", { name: /Play your story/ }).click();
const plain = [];
for (let k = 0; k < 20; k++) {
  await page.waitForTimeout(900);
  plain.push(await page.locator(".rl-story-body").innerText());
  assert.equal(await page.locator(".rl-story-body img").count(), 0, "no stand-in pictures");
  if (await page.getByRole("button", { name: "Watch again" }).count()) break;
  await page.keyboard.press("ArrowRight");
}
assert.ok(!plain.join("\n").includes("brought home"));
assert.deepEqual(errors, []);
console.log("PASS Wrapped: real photos of things you bought (or none at all), first buy, style slide, go-to shop, biggest item");
await browser.close(); server.close();
