// Browser test (Connor, 18 Nov 2026): Wrapped takes the shopper on every trip out. For each: the map flies to the starting
// station (its name on a station board), the view moves into a train window with the countryside going by (lit for the
// month), the train slows, the destination's board slides in, then "Did you visit…?" with sights from the server's list, or
// "How was Brighouse?" where none are listed. The way back is never replayed; places Relay can't position are named, never
// plotted; nothing written on a slide ever overlaps other words; reduced motion gets a still card per trip. Also: a
// sweets-and-groceries year never opens with sweets. Stubbed Relay server; the Wrapped is built by the real worker/wrapped.js
// from made-up receipts, sorted the way the server sorts them. Screenshots at 390x844 @2x.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
import { buildWrapped } from "../worker/wrapped.js";
import { ATTRACTION_PLACES, attractionsFor } from "../worker/uk-attractions.js";
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
const ticket = (date, name, shop = ["Trainline", "thetrainline.com"]) => listed({ id: id(), retailer: R(shop[0], shop[1]), orderDate: date, totalPence: 3000, items: [{ name, pricePence: 3000 }] });
// Connor's: London to Brighouse in January and the single back two days later (not replayed), then four more.
const trains = [
  ticket("2026-01-14", "London King's Cross to Brighouse"),
  ticket("2026-01-16", "Brighouse to London Kings Cross"),
  ticket("2026-03-14", "London Kings Cross to York (Return)"),
  ticket("2026-06-20", "York to Edinburgh Waverley", ["LNER", "lner.co.uk"]),
  ticket("2026-06-23", "Edinburgh to Glasgow Queen Street"),
  ticket("2026-09-02", "Manchester Picc to Little Snoring Halt"),
];
const NOW = Date.UTC(2026, 10, 18);
let wrapped = buildWrapped(sweets, 2026, NOW);
const browser = await chromium.launch();
async function open(opts = {}, sound = "off") {
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
  await page.addInitScript((s) => {
    localStorage.setItem("relay.session.v1", JSON.stringify({ token: "S".repeat(43), email: "c@example.com" })); localStorage.setItem("relay.storySound.v1", s);
    // Notes every frequency the story's sound asks for, so the train's rhythm can be heard in the test.
    window.__hz = []; const set = AudioParam.prototype.setValueAtTime; AudioParam.prototype.setValueAtTime = function (v, t) { window.__hz.push(Math.round(v)); return set.call(this, v, t); };
  }, sound);
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
// Every visible piece of writing on the slide (opacity counted through its parents), and any two that cross.
const overlaps = (page) => page.evaluate(() => {
  const seen = (n) => { let o = 1; for (let e = n; e && e.nodeType === 1; e = e.parentElement) { const s = getComputedStyle(e); if (s.visibility === "hidden" || s.display === "none") return 0; o *= Number(s.opacity); } return o; };
  const words = [...document.querySelectorAll(".rl-story-body .k, .rl-story-body .jboard, .rl-story-body .jdep, .rl-story-body .jq p, .rl-story-body .jq h2, .rl-story-body .jq li, .rl-story-body .jroute, .rl-story-body .jwhen")]
    .filter(n => seen(n) > 0.05).map(n => ({ n: n.className + ":" + n.textContent.slice(0, 30), r: n.getBoundingClientRect() })).filter(x => x.r.width && x.r.height);
  const hit = [];
  for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) {
    const a = words[i].r, b = words[j].r;
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
      const inside = (x, y) => x.left >= y.left && x.right <= y.right && x.top >= y.top && x.bottom <= y.bottom;
      if (!inside(a, b) && !inside(b, a)) hit.push(words[i].n + " / " + words[j].n);
    }
  }
  return { hit, count: words.length };
});
const phase = (page) => page.locator(".rl-story-body .jstage").getAttribute("data-phase");
const onStage = (page, sel) => page.evaluate((s) => { const st = document.querySelector(".rl-story-body .jstage").getBoundingClientRect(), r = document.querySelector(s).getBoundingClientRect(); return r.left >= st.left - 1 && r.right <= st.right + 1 && r.top >= st.top - 1 && r.bottom <= st.bottom + 1; }, sel);

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
  wrapped = buildWrapped(sweets.concat(listed({ id: id(), retailer: R("Fernleigh Knitwear", "fernleighknit.example"), orderDate: "2026-06-01", totalPence: 1800, items: [{ name: "Navy Cable Knit Jumper", pricePence: 1800 }] })), 2026, NOW);
  const { ctx, page, errors } = await open();
  await page.waitForTimeout(900);
  assert.match(await body(page), /It started on 1 June with Navy Cable Knit Jumper from Fernleigh Knitwear\./);
  assert.equal(await page.locator(".rl-story-body .rl-wr-hero svg path").getAttribute("d"), "M8.5 4 4 7l2 3.2 2-1.1V20h8V9.1l2 1.1L20 7l-4.5-3c-.9 1.4-2.1 2-3.5 2s-2.6-.6-3.5-2Z", "the clothing icon for a jumper");
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - the first lasting thing opens it, with its own kind's icon");
}

// 2. Each trip out: zoom on the start, into the train, the countryside going by, arrival, the question; then the next.
{
  wrapped = buildWrapped(trains, 2026, NOW);
  const t = wrapped.travel;
  assert.deepEqual(t.trips.map(x => x.from + " > " + x.to), ["London King's Cross > Brighouse", "London Kings Cross > York", "York > Edinburgh Waverley", "Edinburgh > Glasgow Queen Street", "Manchester Picc > Little Snoring Halt"], "every trip out in order; the single back from Brighouse isn't one");
  assert.ok(t.trips[0].toAt && Math.abs(t.trips[0].toAt.lat - 53.70) < 0.02, "Brighouse is on the map");
  const { ctx, page, errors } = await open({}, "on");
  assert.ok(await toSlide(page, /JOURNEY 1 OF 5/), "the first trip has its own slide");
  const started = Date.now(), at = (ms) => page.waitForTimeout(Math.max(0, ms - (Date.now() - started)));
  // a. The map: the camera zooms in on the start; the station's name goes up on a board.
  await at(250);
  const w0 = await page.evaluate(() => Number(document.querySelector(".rl-story-body .jmap svg").getAttribute("viewBox").split(" ")[2]));
  assert.equal(await phase(page), "map");
  await at(1350);
  const zoom = await page.evaluate(() => { const s = document.querySelector(".rl-story-body .jmap svg"), st = document.querySelector(".rl-story-body .jstage").getBoundingClientRect(), p = s.querySelector(".pin").getBoundingClientRect();
    return { w: Number(s.getAttribute("viewBox").split(" ")[2]), dx: (p.left + p.width / 2) - (st.left + st.width / 2), dy: (p.top + p.height / 2) - (st.top + st.height / 2), board: document.querySelector(".rl-story-body .jboard.from").textContent, op: Number(getComputedStyle(document.querySelector(".rl-story-body .jboard.from")).opacity) }; });
  assert.ok(zoom.w < w0 / 3, "the camera zooms in on the start: " + w0 + " then " + zoom.w);
  assert.ok(Math.abs(zoom.dx) < 30 && Math.abs(zoom.dy) < 30, "on the starting station: " + zoom.dx + ", " + zoom.dy);
  assert.equal(zoom.board, "London King's Cross"); assert.ok(zoom.op > 0.9, "its name on a station board");
  assert.deepEqual((await overlaps(page)).hit, []);
  await page.screenshot({ path: SHOTS + "/1-zoom-on-start.png" });
  // b. Into the train: the countryside slides past (three layers at different speeds), winter light for January.
  await at(3500);
  assert.equal(await phase(page), "ride");
  const xs = () => page.evaluate(() => [...document.querySelectorAll(".rl-story-body .jl")].map(n => new DOMMatrix(getComputedStyle(n).transform).m41));
  const x1 = await xs(); await page.waitForTimeout(250); const x2 = await xs();
  const moved = x1.map((x, i) => Math.abs(x2[i] - x));
  assert.ok(moved[2] > moved[1] && moved[1] > moved[0] && moved[0] > 0.5, "near things pass faster than far ones: " + moved.map(v => v.toFixed(1)));
  assert.equal(await page.locator(".rl-story-body .jtrain").evaluate(n => getComputedStyle(n).backgroundColor), "rgb(207, 219, 228)", "a pale winter sky in January");
  assert.ok(await page.locator(".rl-story-body .jframe g[fill='#f4f8fb']").count(), "frost on the window in winter");
  assert.match(await page.locator(".rl-story-body .jdep").innerText(), /14 JANUARY\s+London King's Cross to Brighouse/, "the date and route on the departure board");
  assert.deepEqual((await overlaps(page)).hit, []);
  await page.screenshot({ path: SHOTS + "/2-inside-the-train.png" });
  assert.ok((await page.evaluate(() => window.__hz)).includes(110), "with sound on, the wheels' rhythm plays on the journey");
  // c. Arrival: the train slows, Brighouse's board slides in and stops in the window.
  await at(5200);
  assert.equal(await phase(page), "slow");
  const p1 = await page.locator(".rl-story-body .jplat").evaluate(n => new DOMMatrix(getComputedStyle(n).transform).m41);
  await at(6250);
  assert.equal(await phase(page), "arrived");
  assert.ok(p1 > 5, "the platform is still sliding in while the train slows");
  assert.equal(await page.locator(".rl-story-body .jplat").evaluate(n => getComputedStyle(n).transform), "none", "and stops");
  assert.equal(await page.locator(".rl-story-body .jboard.to").textContent(), "Brighouse");
  assert.ok(await onStage(page, ".rl-story-body .jboard.to"), "the destination's board is in the window");
  await page.screenshot({ path: SHOTS + "/3-arrival-board.png" });
  // Brighouse has no well-known sights listed: asked how it was, nothing made up.
  await at(6900);
  assert.match(await body(page), /How was Brighouse\?/); assert.doesNotMatch(await body(page), /Did you visit/);
  assert.deepEqual((await overlaps(page)).hit, []);
  // d. Then the next trip, by itself; a tap goes on sooner.
  await at(7900);
  assert.match(await body(page), /JOURNEY 2 OF 5/);
  // Journey 2, to York in March: Did you visit…? with York's sights from the list, asked, never claimed.
  await page.waitForTimeout(6500);
  const v = await body(page);
  assert.match(v, /Did you visit…\s+York Minster\s+The Shambles\s+The National Railway Museum\?/);
  assert.doesNotMatch(v, /You visited|you saw|you went/i);
  assert.equal(await page.locator(".rl-story-body .jsights .sic svg").count(), 3, "a drawn icon for each sight");
  assert.equal(await page.locator(".rl-story-body .jtrain").evaluate(n => getComputedStyle(n).backgroundColor), "rgb(191, 224, 245)", "spring light in March");
  assert.deepEqual((await overlaps(page)).hit, []);
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + "/4-did-you-visit.png" });
  // A tap goes on to the next trip. (Read where it is first: on a busy machine the slide may already have moved on by
  // itself, so the tap is checked against where it really was.)
  const jn = async () => Number((/JOURNEY (\d) OF 5/.exec(await body(page)) || [])[1] || 0);
  const before = await jn();
  await page.mouse.click(330, 500); await page.waitForTimeout(250);
  assert.ok(await jn() > before && before >= 2, "a tap goes on to the next trip");
  assert.ok(await toSlide(page, /JOURNEY 5 OF 5/, 4), "on to the last trip");
  await page.waitForTimeout(500);
  // A place Relay can't position is named, never guessed; the start it knows (Manchester Picc) is on the map.
  const unknown = await body(page);
  assert.match(unknown, /JOURNEY 5 OF 5/); assert.match(unknown, /Little Snoring Halt isn't on the map\./);
  assert.equal(await page.locator(".rl-story-body .jmap .pin").count(), 1); assert.equal(await page.locator(".rl-story-body .jmap .way").count(), 0, "no line to a place Relay can't position");
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(200);
  assert.doesNotMatch(await body(page), /JOURNEY 6/);
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - each trip: zoom on the start, the train and the countryside, arrival board, the question; no way back replayed");
}

// 3. More than ten trips: each place once, with how many times.
{
  const many = [];
  const legs = [["Leeds", "York"], ["Leeds", "Harrogate"], ["Leeds", "York"], ["Leeds", "Sheffield"], ["Leeds", "Manchester Piccadilly"], ["Leeds", "York"], ["Leeds", "Bradford Interchange"],
    ["Leeds", "Halifax"], ["Leeds", "Huddersfield"], ["Leeds", "Hull"], ["Leeds", "Durham"], ["Leeds", "Newcastle"]];
  legs.forEach((l, i) => many.push(ticket("2026-0" + (1 + Math.floor(i / 2)) + "-" + String(3 + (i % 2) * 10).padStart(2, "0"), l[0] + " to " + l[1] + " (Return)")));
  wrapped = buildWrapped(many, 2026, NOW);
  const t = wrapped.travel;
  assert.equal(t.trips.length, 10, "twelve trips, ten places");
  assert.deepEqual(t.trips.map(x => x.to + (x.times ? " x" + x.times : "")).slice(0, 3), ["York x3", "Harrogate", "Sheffield"]);
  const { ctx, page, errors } = await open();
  assert.ok(await toSlide(page, /JOURNEY 1 OF 10/));
  await page.waitForTimeout(6800);
  assert.match(await body(page), /3 times this year/);
  assert.deepEqual((await overlaps(page)).hit, []);
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - over ten trips, a place gone to three times is shown once: 3 times this year");
}

// 4. Reduced motion: a still card for each trip (the route on the map, names, date) and its question.
{
  wrapped = buildWrapped(trains, 2026, NOW);
  const { ctx, page, errors } = await open({ reducedMotion: "reduce" });
  assert.ok(await toSlide(page, /JOURNEY 1 OF 5/));
  const t = await body(page);
  assert.match(t, /London King's Cross to Brighouse\s+14 January\s+How was Brighouse\?/);
  assert.equal(await page.locator(".rl-story-body .jtrain, .rl-story-body .jmap").count(), 0, "nothing moving");
  assert.equal(await page.locator(".rl-story-body .jstill .way.solid").count(), 1, "the route drawn on the map");
  assert.equal(await page.locator(".rl-story-body .jstill .pin").count(), 2);
  assert.deepEqual((await overlaps(page)).hit, []);
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(200);
  assert.match(await body(page), /JOURNEY 2 OF 5[\s\S]*Did you visit…\s+York Minster/);
  await page.screenshot({ path: SHOTS + "/5-reduced-motion.png" });
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - with reduced motion, a still card for each trip and its question");
}
// A flight isn't shown from a train window: its route stands still on the map, with the question.
{
  wrapped = buildWrapped([ticket("2026-07-04", "London Stansted to Edinburgh", ["Ryanair", "ryanair.com"])], 2026, NOW);
  assert.equal(wrapped.travel.trips[0].mode, "flight");
  const { ctx, page, errors } = await open();
  assert.ok(await toSlide(page, /YOUR JOURNEY/));
  assert.equal(await page.locator(".rl-story-body .jtrain").count(), 0); assert.equal(await page.locator(".rl-story-body .jstill .way.solid").count(), 1);
  assert.match(await body(page), /London Stansted to Edinburgh\s+4 July[\s\S]*Did you visit…\s+Edinburgh Castle/);
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - a flight is a still route on the map, not a train window");
}
// 5. The sights are only ever the server's list.
{
  for (const tr of buildWrapped(trains, 2026, NOW).travel.trips) {
    const listedFor = attractionsFor(tr.place);
    if (tr.sights.length) assert.deepEqual(tr.sights, listedFor.attractions); else assert.ok(!listedFor || !ATTRACTION_PLACES.includes(listedFor.place));
  }
  console.log("ok - sights come only from uk-attractions.js");
}
await browser.close(); server.close();
console.log("PASS Wrapped journeys: no sweets opening, every trip out travelled (zoom, train, arrival, question), no way back, grouping, reduced motion");
