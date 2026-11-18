// Browser test (Connor, 18 Nov 2026): Wrapped takes the shopper on each journey, asks "Did you visit…?", and never opens a
// sweets-and-groceries year with sweets. Stubbed Relay server; the Wrapped is built by the real worker/wrapped.js from made-up
// receipts, sorted the way the server sorts them (receipt-category.js and item-kind-core.js). Screenshots at 390x844 @2x.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
import { buildWrapped } from "../worker/wrapped.js";
import { categorise, itemCategories, itemKinds, shopDisplayName } from "../worker/receipt-category.js";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.WRAPPED_SHOTS || "/tmp/shots/journeys";
await mkdir(SHOTS, { recursive: true });
// Receipts the way the server lists them: the shop's tidied name, its group, and each item's own group and kind.
const listed = (c) => { const retailer = { ...c.retailer, name: shopDisplayName(c.retailer) || c.retailer.name }; const x = { ...c, retailer }, g = categorise(x), k = itemCategories(x), o = itemKinds(x);
  return { kind: "order", currency: "GBP", ...x, ...g, items: x.items.map((it, i) => ({ qty: 1, ...it, category: k[i] ? k[i].category : g.category, categorySure: Boolean(k[i] && k[i].sure),
    ...(o[i] ? { kind: o[i].kind, kindSure: o[i].confidence === "high", lasting: o[i].lasting && o[i].confidence === "high" } : {}) })) }; };
const R = (name, domain) => ({ name, domain });
let n = 0; const id = () => "a0000000-0000-4000-8000-" + String(++n).padStart(12, "0");
const sweets = [
  listed({ id: id(), retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-04-19", totalPence: 125, items: [{ name: "Rowntree's 130g Fruit Pastilles Sweets Sharing Bag Lollies", pricePence: 125 }] }),
  listed({ id: id(), retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-04-26", totalPence: 410, items: [{ name: "Haribo Starmix Sweets Sharing Bag 140g", pricePence: 135 }, { name: "Sainsbury's Bag For Life", pricePence: 25 }, { name: "Percy Pig 170g", pricePence: 250 }] }),
  listed({ id: id(), retailer: R("Tesco", "tesco.com"), orderDate: "2026-05-02", totalPence: 300, items: [{ name: "Kinder Bueno Twin Bar 43g", pricePence: 100 }, { name: "Pringles Original 165g", pricePence: 200 }] }),
  listed({ id: id(), retailer: R("Boots", "boots.com"), orderDate: "2026-05-03", totalPence: 600, items: [{ name: "Scholl Cracked Heel Repair Balm 60ml", pricePence: 600 }] }),
];
const trains = [
  listed({ id: id(), retailer: R("Trainline", "thetrainline.com"), orderDate: "2026-03-14", totalPence: 9800, items: [{ name: "London Kings Cross to York (Return)", pricePence: 9800 }] }),
  listed({ id: id(), retailer: R("LNER", "lner.co.uk"), orderDate: "2026-06-20", totalPence: 6400, items: [{ name: "York to Edinburgh Waverley", pricePence: 6400 }] }),
  listed({ id: id(), retailer: R("Trainline", "thetrainline.com"), orderDate: "2026-06-23", totalPence: 1500, items: [{ name: "Edinburgh to Glasgow Queen Street", pricePence: 1500 }] }),
  listed({ id: id(), retailer: R("Trainline", "thetrainline.com"), orderDate: "2026-09-02", totalPence: 3100, items: [{ name: "Manchester Piccadilly to Little Snoring Halt", pricePence: 3100 }] }),
];
const NOW = Date.UTC(2026, 10, 18);
let wrapped = buildWrapped(sweets, 2026, NOW);
const browser = await chromium.launch();
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block", ...opts }); await skipInterests(ctx);
  await ctx.route("https://**/*", async route => { const u = new URL(route.request().url()); const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (!u.pathname.startsWith("/relay/")) return route.abort();
    if (u.pathname === "/relay/my/wrapped") return j(wrapped);
    if (u.pathname === "/relay/my/gmail/history") return j({ years: [], earliest: 2020 });
    if (u.pathname === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (u.pathname === "/relay/my/gmail") return j({ connected: true, provider: "google", email: "c@example.com", lastScanAt: Date.now() });
    if (u.pathname === "/relay/my/profile") return j({ email: "c@example.com", name: "Cat", photo: null });
    return j({}); });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.addInitScript(() => { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "S".repeat(43), email: "c@example.com" })); localStorage.setItem("relay.storySound.v1", "off"); });
  await skipInterests(page);
  await page.goto(origin + "/index.html"); await page.waitForTimeout(700);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/wrapped/.test(k)) localStorage.removeItem(k); });
  await page.evaluate(() => window.go("wrapped"));
  await page.getByRole("button", { name: "Play your 2026 story" }).click();
  return { ctx, page, errors };
}
const body = (page) => page.locator(".rl-story-body").innerText();
async function toSlide(page, re, max = 40) {
  for (let k = 0; k < max; k++) { if (re.test(await body(page))) return true; await page.keyboard.press("ArrowRight"); await page.waitForTimeout(120); }
  return false;
}

// 1. A year of sweets and groceries opens on the count, never on the sweets, and nothing is drawn as clothing.
{
  assert.equal(wrapped.firstBuy, null);
  const { ctx, page, errors } = await open();
  await page.waitForTimeout(1400);
  const first = await body(page);
  assert.match(first, /^RELAY WRAPPED 2026\s+Your 2026, one receipt at a time\.\s+4\s+receipts from 3 shops\. Here's your year\.$/);
  assert.doesNotMatch(first, /Pastilles|started on/);
  await page.screenshot({ path: SHOTS + "/1-sweets-year-opening.png" });
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - a sweets-and-groceries year opens on the count");
}
// With a jumper later that year, it opens on the jumper, drawn as clothing.
{
  wrapped = buildWrapped(sweets.concat(listed({ id: id(), retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-06-01", totalPence: 1800, items: [{ name: "Tu Navy Cable Knit Jumper", pricePence: 1800 }] })), 2026, NOW);
  const { ctx, page, errors } = await open();
  await page.waitForTimeout(900);
  assert.match(await body(page), /It started on 1 June with Tu Navy Cable Knit Jumper from Sainsbury's\./);
  assert.equal(await page.locator(".rl-story-body .rl-wr-hero svg path").getAttribute("d"), "M8.5 4 4 7l2 3.2 2-1.1V20h8V9.1l2 1.1L20 7l-4.5-3c-.9 1.4-2.1 2-3.5 2s-2.6-.6-3.5-2Z", "the clothing icon for a jumper");
  await page.screenshot({ path: SHOTS + "/1b-first-lasting-thing.png" });
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - the first lasting thing opens it, with its own kind's icon");
}

// 2. Each journey: the map moves to the route, a drawn train runs along it, the stations' names appear, then the next.
{
  wrapped = buildWrapped(trains, 2026, NOW);
  assert.equal(wrapped.travel.trips.length, 4);
  const { ctx, page, errors } = await open();
  assert.ok(await toSlide(page, /JOURNEY 1 OF 4/), "the first journey has its own slide");
  const t = await body(page);
  assert.match(t, /14 March, there and back/);
  // Two moments of the same journey: the view zooms in, and the train moves along the route.
  await page.waitForTimeout(350);
  const early = await page.evaluate(() => { const s = document.querySelector(".rl-story-body .jmap svg"), tr = s.querySelector(".tiny-train"); return { vb: s.getAttribute("viewBox"), at: tr.getBoundingClientRect(), from: getComputedStyle(s.querySelector(".stn.from")).opacity, to: getComputedStyle(s.querySelector(".stn.to")).opacity }; });
  await page.screenshot({ path: SHOTS + "/2-journey-start.png" });
  await page.waitForTimeout(950);
  const mid = await page.evaluate(() => { const s = document.querySelector(".rl-story-body .jmap svg"), tr = s.querySelector(".tiny-train"); return { vb: s.getAttribute("viewBox"), at: tr.getBoundingClientRect() }; });
  await page.screenshot({ path: SHOTS + "/3-journey-mid.png" });
  const w = (vb) => Number(vb.split(" ")[2]);
  assert.ok(w(mid.vb) < w(early.vb), "the map zooms in on the route: " + early.vb + " then " + mid.vb);
  assert.ok(Math.hypot(mid.at.x - early.at.x, mid.at.y - early.at.y) > 8, "the train moves along the route");
  assert.ok(Number(early.from) > 0.5 && Number(early.to) < 0.5, "the starting station is named first; the other on arrival");
  await page.waitForTimeout(1300);
  const end = await page.evaluate(() => { const s = document.querySelector(".rl-story-body .jmap svg"); return { from: s.querySelector(".stn.from").textContent, to: s.querySelector(".stn.to").textContent, op: getComputedStyle(s.querySelector(".stn.to")).opacity, size: s.querySelector(".stn.to").getBoundingClientRect().height }; });
  assert.deepEqual([end.from, end.to], ["London Kings Cross", "York"]); assert.ok(Number(end.op) > 0.9, "named on arrival"); assert.ok(end.size >= 13, "station names are readable: " + end.size);
  await page.screenshot({ path: SHOTS + "/4-journey-arrived.png" });
  // It moves on to the next journey by itself (about 3 seconds each), and a tap goes on sooner, like other slides.
  await page.waitForTimeout(800);
  assert.match(await body(page), /JOURNEY 2 OF 4/);
  await page.mouse.click(330, 500); await page.waitForTimeout(200);
  assert.match(await body(page), /JOURNEY 3 OF 4/);
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300);
  const unknown = await body(page);
  assert.match(unknown, /JOURNEY 4 OF 4/); assert.match(unknown, /Little Snoring Halt isn't on the map\./, "a place Relay can't position is named, never guessed onto the map");
  // Did you visit? Asked, with well-known sights, never claimed.
  assert.ok(await toSlide(page, /Did you visit/));
  const v = await body(page);
  assert.match(v, /AROUND (YORK|EDINBURGH)/);
  assert.match(v, /York Minster|Edinburgh Castle/);
  assert.match(v, /\?/); assert.doesNotMatch(v, /You visited|you saw/i);
  assert.ok(await page.locator(".rl-story-body .sights .sic svg").count() >= 2, "a drawn icon for each sight");
  await page.waitForTimeout(1300);
  await page.screenshot({ path: SHOTS + "/5-did-you-visit.png" });
  const story = await body(page);
  assert.doesNotMatch(story, / · /, "nothing joined with dots");
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - each journey: the map moves to it, a train runs along it, stations named, then the next; then Did you visit");
}

// 3. Reduced motion: one still list of the journeys instead.
{
  const { ctx, page, errors } = await open({ reducedMotion: "reduce" });
  assert.ok(await toSlide(page, /Your journeys/));
  const t = await body(page);
  assert.match(t, /London Kings Cross to York\s+14 March, and back/); assert.match(t, /York to Edinburgh Waverley/);
  assert.equal(await page.locator(".rl-story-body .jmap").count(), 0, "no moving map");
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150);
  assert.doesNotMatch(await body(page), /JOURNEY 1 OF/);
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - with reduced motion the journeys are a still list");
}
await browser.close(); server.close();
console.log("PASS Wrapped journeys: no sweets opening, each journey travelled, Did you visit, reduced motion");
