// Browser test (Connor, 18 Nov 2026: "not train on every journey, it's too long ... do the same for flights ... where's the
// list of things to have seen?"). Wrapped's travel now: only the year's furthest train journey gets the whole ride; every
// other one is on one departures board that flips through them while their routes light up on a map; the furthest flight is
// seen from the window seat (wing, fields falling away, cloud, the arrivals board); the other flights are boarding passes
// dealt from a pile; then "Places you went", every place with sights to ask about (the nearest listed place's for a town
// with none, said as such). Totals: "N journeys, X miles by train", "N flights, X miles in the air". Reduced motion: still.
// Stubbed Relay server; the Wrapped is built by the real worker/wrapped.js from made-up receipts, the flights read by the
// real receipt reader from made-up airline emails. Screenshots at 390x844 @2x (TRAVEL_SHOTS).
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
import { buildWrapped } from "../worker/wrapped.js";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { categorise, itemCategories, itemKinds, shopDisplayName } from "../worker/receipt-category.js";
import * as MAIL from "./fixtures/flight-emails.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.TRAVEL_SHOTS || "/tmp/shots/travel";
await mkdir(SHOTS, { recursive: true });
const listed = (c) => { const retailer = { ...c.retailer, name: shopDisplayName(c.retailer) || c.retailer.name }; const x = { ...c, retailer }, g = categorise(x), k = itemCategories(x), o = itemKinds(x);
  return { kind: "order", currency: "GBP", ...x, ...g, items: x.items.map((it, i) => ({ qty: 1, ...it, category: k[i] ? k[i].category : g.category, categorySure: Boolean(k[i] && k[i].sure),
    ...(o[i] ? { kind: o[i].kind, kindSure: o[i].confidence === "high", lasting: o[i].lasting && o[i].confidence === "high" } : {}) })) }; };
const R = (name, domain) => ({ name, domain });
let n = 0; const id = () => "b0000000-0000-4000-8000-" + String(++n).padStart(12, "0");
const ticket = (date, name, shop = ["Trainline", "thetrainline.com"]) => listed({ id: id(), retailer: R(shop[0], shop[1]), orderDate: date, totalPence: 3000, items: [{ name, pricePence: 3000 }] });
const trains = [
  ticket("2026-01-14", "London King's Cross to Brighouse"), ticket("2026-01-16", "Brighouse to London Kings Cross"),
  ticket("2026-03-14", "London Kings Cross to York (Return)"), ticket("2026-06-20", "York to Edinburgh Waverley", ["LNER", "lner.co.uk"]),
  ticket("2026-06-23", "Edinburgh to Glasgow Queen Street"), ticket("2026-09-02", "Manchester Picc to Little Snoring Halt"),
];
const flights = [MAIL.BA, MAIL.RYANAIR, MAIL.EASYJET, MAIL.JET2, MAIL.EXPEDIA].map((raw) => { const r = parseReceiptEmail(raw); assert.ok(r.ok && r.flights, "read as a flight booking"); return listed({ id: id(), ...r }); });
const NOW = Date.UTC(2026, 10, 18);
let wrapped = buildWrapped(trains.concat(flights), 2026, NOW);
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
async function toSlide(page, re, max = 50) {
  for (let k = 0; k < max; k++) { if (re.test(await body(page))) return true; await page.keyboard.press("ArrowRight"); await page.waitForTimeout(120); }
  return false;
}
// Every visible piece of writing (opacity counted through its parents), and any two that cross.
const overlaps = (page) => page.evaluate(() => {
  const seen = (n) => { let o = 1; for (let e = n; e && e.nodeType === 1; e = e.parentElement) { const s = getComputedStyle(e); if (s.visibility === "hidden" || s.display === "none") return 0; o *= Number(s.opacity); } return o; };
  const words = [...document.querySelectorAll(".rl-story-body .k, .rl-story-body .jboard, .rl-story-body .jdep, .rl-story-body .jq p, .rl-story-body .jq h2, .rl-story-body .jq li, .rl-story-body .jtot, .rl-story-body .fine, " +
    ".rl-story-body .jbh, .rl-story-body .jbr, .rl-story-body .jpass, .rl-story-body .jarr, .rl-story-body .jplaces li, .rl-story-body h2.ch")]
    .filter(n => seen(n) > 0.05).map(n => ({ n: n.className + ":" + n.textContent.slice(0, 30), r: n.getBoundingClientRect() })).filter(x => x.r.width && x.r.height);
  const hit = [];
  for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) {
    const a = words[i].r, b = words[j].r;
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
      const inside = (x, y) => x.left >= y.left && x.right <= y.right && x.top >= y.top && x.bottom <= y.bottom;
      if (!inside(a, b) && !inside(b, a)) hit.push(words[i].n + " / " + words[j].n);
    }
  }
  // Nothing written goes off the phone's screen either.
  const off = words.filter(w => w.r.left < -1 || w.r.right > innerWidth + 1 || w.r.bottom > innerHeight + 1).map(w => w.n);
  return { hit, off };
});
const noOverlap = async (page, what) => { const o = await overlaps(page); assert.deepEqual(o.hit, [], what + ": nothing written overlaps"); assert.deepEqual(o.off, [], what + ": nothing written is off the screen"); };

const t = wrapped.travel, g = t.ground, a = t.air;
// 0. What the server sent: the furthest of each, the rest grouped, the totals.
{
  assert.equal(g.featured.to, "York", "London to York is the furthest train journey out: " + JSON.stringify(g.featured));
  assert.ok(g.others.every(o => o.miles == null || o.miles <= g.featured.miles));
  assert.deepEqual(g.others.map(o => o.place), ["Brighouse", "Edinburgh", "Glasgow", "Little Snoring Halt"]);
  assert.equal(a.featured.toCode, "DXB", "Gatwick to Dubai is the furthest flight");
  assert.deepEqual(a.others.map(o => o.toCode), ["BCN", "FAO", "ALC", "PMI"]);
  assert.equal(a.totals.journeys, 9, "two flights each for four return bookings, one for Ryanair's single");
  assert.equal(g.totals.atLeast, true, "a journey to a halt Relay can't place: at least");
}

// 1. The whole story: one train ride, the board, one flight from the window, the passes, Places you went.
{
  const { ctx, page, errors } = await open();
  // Count the slides that ride the train: only one.
  let rides = 0, flies = 0;
  const seenLabels = [];
  for (let k = 0; k < 60; k++) {
    const txt = await body(page);
    if (await page.locator(".rl-story-body .jtrain").count()) rides++;
    if (await page.locator(".rl-story-body .jplane").count()) flies++;
    const lab = (/^(YOUR [A-Z ]+|PLACES YOU WENT|ON THE MOVE)/m.exec(txt) || [])[1]; if (lab) seenLabels.push(lab);
    if (await page.getByRole("button", { name: "Watch again" }).count()) break;
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(140);
  }
  assert.equal(rides, 1, "only the furthest train journey is ridden"); assert.equal(flies, 1, "only the furthest flight is flown");
  assert.deepEqual(seenLabels.filter(l => /^YOUR|PLACES|ON THE/.test(l)), ["ON THE MOVE", "YOUR LONGEST TRAIN JOURNEY", "YOUR OTHER TRAIN JOURNEYS", "YOUR LONGEST FLIGHT", "YOUR OTHER FLIGHTS", "PLACES YOU WENT"]);
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - one train ride, one flight, then grouped boards, passes and Places you went");
}
// 2. The departures board: rows flip one after another, routes light up behind; then all of them, and the totals.
{
  const { ctx, page, errors } = await open();
  assert.ok(await toSlide(page, /YOUR OTHER TRAIN JOURNEYS/));
  await page.waitForTimeout(420);
  const mid = await page.evaluate(() => ({ set: document.querySelectorAll(".rl-story-body .jbr.set").length, lit: document.querySelectorAll(".rl-story-body .jbmap .gl.on").length, flipping: document.querySelector(".rl-story-body .jbstage").getAttribute("data-flipping") }));
  assert.ok(mid.set < 4, "mid-animation, not every row has settled yet: " + mid.set);
  await page.screenshot({ path: SHOTS + "/1-trains-board-mid-animation.png" });
  await page.waitForTimeout(2200);
  const rows = await page.locator(".rl-story-body .jbr.set").evaluateAll(ns => ns.map(n => [...n.children].map(c => c.textContent.trim()).filter(Boolean).join(" ")));
  assert.deepEqual(rows, ["14 JAN BRIGHOUSE", "20 JUN EDINBURGH", "23 JUN GLASGOW", "2 SEP LITTLE SNORING"], "every other trip, with its day and where to");
  const lit = await page.locator(".rl-story-body .jbmap .gl.on").count(), lines = await page.locator(".rl-story-body .jbmap .rt").count();
  assert.equal(lines, g.lines.length, "every route with both ends known is on the map");
  assert.equal(lit, 3, "the three grouped trips Relay can place are lit (Little Snoring Halt isn't on the map)");
  const txt = await body(page);
  assert.match(txt, /\b7 journeys, at least 879 miles by train\./, "totals (the way back from Brighouse and both ways of the York return count), said as at least");
  assert.match(txt, /Not on the map: Little Snoring Halt\./);
  assert.doesNotMatch(txt, / · |×/);
  await noOverlap(page, "board");
  await page.screenshot({ path: SHOTS + "/1b-trains-board-settled.png" });
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - the departures board flips through every other train journey while their routes light up");
}
// 3. The furthest flight from the window seat: map, sign, window (wing, fields falling away, cloud), arrivals board, sights.
{
  const { ctx, page, errors } = await open();
  assert.ok(await toSlide(page, /YOUR LONGEST FLIGHT/));
  const started = Date.now(), at = (ms) => page.waitForTimeout(Math.max(0, ms - (Date.now() - started)));
  const ph = () => page.locator(".rl-story-body .jstage").getAttribute("data-phase");
  await at(1300);
  assert.equal(await ph(), "map");
  assert.equal(await page.locator(".rl-story-body .jboard.from.air").textContent(), "London Gatwick", "the airport's name on a yellow sign");
  await noOverlap(page, "flight map");
  await at(2700);
  assert.equal(await ph(), "climb");
  const groundAt = () => page.locator(".rl-story-body .jground").evaluate(n => { const m = new DOMMatrix(getComputedStyle(n).transform); return { y: m.m42, s: m.a, o: Number(getComputedStyle(n).opacity) }; });
  const g1 = await groundAt(); await page.waitForTimeout(400); const g2 = await groundAt();
  assert.ok(g2.y > g1.y && g2.s < g1.s, "the fields fall away below as the plane climbs: " + JSON.stringify([g1, g2]));
  assert.equal(await page.locator(".rl-story-body .jwing").count(), 1, "the wing outside the window");
  assert.equal(await page.locator(".rl-story-body .jplane").evaluate(n => getComputedStyle(n).backgroundColor), "rgb(159, 209, 243)", "April's daylight sky");
  assert.match(await page.locator(".rl-story-body .jdep").innerText(), /12 APRIL\s+EK16\s+London Gatwick to Dubai/);
  await noOverlap(page, "flight window");
  await page.screenshot({ path: SHOTS + "/2-plane-window.png" });
  await at(4900);
  const c1 = await page.locator(".rl-story-body .jc-deck").evaluate(n => new DOMMatrix(getComputedStyle(n).transform).m41); await page.waitForTimeout(300);
  const c2 = await page.locator(".rl-story-body .jc-deck").evaluate(n => new DOMMatrix(getComputedStyle(n).transform).m41);
  assert.ok(c2 < c1, "the clouds drift by");
  await page.screenshot({ path: SHOTS + "/2b-plane-above-clouds.png" });
  await at(6500);
  assert.match(await page.locator(".rl-story-body .jarr").innerText(), /ARRIVALS\s+DUBAI\s+LANDED\s+EK16/);
  await at(7600);
  assert.equal(await ph(), "arrived");
  const v = await body(page);
  assert.match(v, /Did you visit…\s+The Burj Khalifa\s+The Dubai Mall\s+The Palm Jumeirah\?/);
  assert.doesNotMatch(v, /You visited|you saw|you went/i);
  await noOverlap(page, "arrived");
  await page.screenshot({ path: SHOTS + "/2c-plane-arrived.png" });
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - the furthest flight: the airport, the window seat climbing through cloud, the arrivals board, the question");
}
// 4. The other flights: dealt from a pile into a column; totals in the air.
{
  const { ctx, page, errors } = await open();
  assert.ok(await toSlide(page, /YOUR OTHER FLIGHTS/));
  await page.waitForTimeout(300);
  const moving = await page.locator(".rl-story-body .jpass").evaluateAll(ns => ns.filter(n => getComputedStyle(n).transform !== "none").length);
  assert.ok(moving >= 3, "they start as a pile");
  await page.waitForTimeout(2800);
  const passes = await page.locator(".rl-story-body .jpass").evaluateAll(ns => ns.map(n => ({ t: n.innerText.replace(/\s+/g, " ").trim(), tr: getComputedStyle(n).transform })));
  assert.deepEqual(passes.map(p => p.t), ["LHR London Heathrow BCN Barcelona 14 March BA0478", "STN London Stansted FAO Faro 7 May FR8352", "MAN Manchester ALC Alicante 3 July EZY1931", "LBA Leeds Bradford PMI Palma 9 August LS1203"]);
  assert.ok(passes.every(p => p.tr === "none"), "dealt out and still");
  assert.match(await body(page), /9 flights, 1[\d,]+ miles in the air\./);
  await noOverlap(page, "passes");
  await page.screenshot({ path: SHOTS + "/3-flights-grouped.png" });
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - the other flights as boarding passes, with the miles in the air");
}
// 5. Places you went: each place, its sights asked about; Brighouse borrows Halifax's, and says so.
{
  const { ctx, page, errors } = await open();
  assert.ok(await toSlide(page, /PLACES YOU WENT/));
  await page.waitForTimeout(2400);
  const items = await page.locator(".rl-story-body .jplaces li").evaluateAll(ns => ns.map(n => n.innerText.replace(/\s+/g, " ").trim()));
  assert.equal(items.length, 5);
  assert.equal(items[0], "Brighouse Nearby in Halifax: The Piece Hall, Shibden Hall or Eureka! The National Children's Museum?");
  assert.ok(items.includes("Barcelona The Sagrada Família, Park Güell or La Rambla?"), items.join("\n"));
  assert.ok(items.includes("York York Minster, The Shambles or the National Railway Museum?"));
  assert.match(await body(page), /Also Edinburgh, Glasgow, Alicante, Palma and Little Snoring Halt\./, "every place is named");
  assert.equal(await page.locator(".rl-story-body .jplaces .sic svg").count(), 5, "a drawn train or plane for each");
  await noOverlap(page, "places");
  await page.screenshot({ path: SHOTS + "/4-places-you-went.png" });
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - Places you went: every place with its sights asked about, a nearby town's said as such");
}
// 6. Reduced motion: nothing moves; the board, the passes and the flight are still cards.
{
  const { ctx, page, errors } = await open({ reducedMotion: "reduce" });
  assert.ok(await toSlide(page, /YOUR LONGEST TRAIN JOURNEY/));
  assert.equal(await page.locator(".rl-story-body .jtrain, .rl-story-body .jmap").count(), 0);
  assert.equal(await page.locator(".rl-story-body .jstill .way.solid").count(), 1);
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(250);
  assert.match(await body(page), /YOUR OTHER TRAIN JOURNEYS/);
  assert.equal(await page.locator(".rl-story-body .jbr.set").count(), 4, "every row already in place");
  assert.equal(await page.locator(".rl-story-body .jbmap .gl.on").count(), 3);
  await noOverlap(page, "still board");
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(250);
  assert.match(await body(page), /YOUR LONGEST FLIGHT\s+LGW\s+London Gatwick\s+DXB\s+Dubai\s+12 April\s+EK16[\s\S]*Did you visit…/);
  assert.equal(await page.locator(".rl-story-body .jplane").count(), 0);
  await noOverlap(page, "still flight");
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(250);
  assert.equal(await page.locator(".rl-story-body .jpass").evaluateAll(ns => ns.filter(n => getComputedStyle(n).transform !== "none").length), 0, "no pile, no dealing");
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(250);
  assert.equal(await page.locator(".rl-story-body .jplaces li").evaluateAll(ns => ns.filter(n => getComputedStyle(n).opacity !== "1").length), 0, "the places are simply there");
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - reduced motion: still cards for the ride, the board, the flight, the passes and the places");
}
// 7. One train journey and nothing else: no board; its miles on the opening slide.
{
  wrapped = buildWrapped([ticket("2026-05-01", "Leeds to York (Return)")], 2026, NOW);
  const { ctx, page, errors } = await open();
  assert.ok(await toSlide(page, /ON THE MOVE/));
  assert.match(await body(page), /On the rails\s+2 journeys, 4\d miles by train/);
  assert.ok(await toSlide(page, /YOUR TRAIN JOURNEY/, 4));
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(200);
  assert.doesNotMatch(await body(page), /YOUR OTHER TRAIN JOURNEYS/);
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - a single trip: no board, its miles on the opening slide");
}
// 8. A Wrapped from before this version (only `trips`, kept on the phone): still one ride, the others on the board.
{
  wrapped = buildWrapped(trains, 2026, NOW);
  delete wrapped.travel.ground; delete wrapped.travel.air; delete wrapped.travel.destinations;
  const { ctx, page, errors } = await open();
  assert.ok(await toSlide(page, /YOUR LONGEST TRAIN JOURNEY/));
  assert.ok(await toSlide(page, /YOUR OTHER TRAIN JOURNEYS/, 3));
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - an older Wrapped kept on the phone still plays the shorter way");
}
await browser.close(); server.close();
console.log("PASS Wrapped travel: one train ride, one flight, grouped board and passes, Places you went, totals, reduced motion, no overlaps");
