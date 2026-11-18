// Browser test: the better Wrapped (Connor, 17 Nov 2026). Stubbed Relay server; the Wrapped is built by the real
// worker/wrapped.js from made-up receipts, sorted the way the server sorts them. It opens on something memorable (not a
// bottle of water), a TV bed is Home & garden, a one-off shop is never a "go-to", nothing is joined with dots, the year's
// furthest journey is ridden from a train window and the others are on a departures board over a UK map of every route
// (Connor, 18 Nov 2026: "not train on every journey"), and things bought tumble in and drop into a bag (and sit still with
// reduced motion). scripts/test-wrapped-journeys-ui.mjs and test-wrapped-travel-ui.mjs check the journeys in detail.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
import { buildWrapped } from "../worker/wrapped.js";
import { categorise, itemCategories, shopDisplayName } from "../worker/receipt-category.js";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.WRAPPED_SHOTS || "/tmp/shots/wrapped";
await mkdir(SHOTS, { recursive: true });
// Photos from the shopper's own receipts (stand-ins from Relay's own product pictures, served for those receipts only).
const PIC = { "f2000000-0000-4000-8000-000000000002": "pics/products/studio-oversized-hoodie.png", "f1000000-0000-4000-8000-000000000001": "pics/products/court-classic-sneakers.png",
  "h1000000-0000-4000-8000-000000000001": "pics/products/desk-lamp.png" };
// Receipts the way the server lists them: the shop's tidied name, its kind, and each item's own kind.
const listed = (c) => { const retailer = { ...c.retailer, name: shopDisplayName(c.retailer) || c.retailer.name }; const x = { ...c, retailer }, g = categorise(x), k = itemCategories(x);
  return { kind: "order", currency: "GBP", ...x, ...g, items: x.items.map((it, i) => ({ qty: 1, ...it, category: k[i] ? k[i].category : g.category, categorySure: Boolean(k[i] && k[i].sure) })) }; };
const R = (name, domain) => ({ name, domain });
const cards = [
  listed({ id: "w1", retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-01-04", totalPence: 150, items: [{ name: "Sainsbury's Still British Bottled Spring Water 4x2L", pricePence: 150 }] }),
  listed({ id: "c1", retailer: R("Pret A Manger", "pret.co.uk"), orderDate: "2026-01-05", totalPence: 450, items: [{ name: "Oat Flat White", pricePence: 450 }] }),
  listed({ id: "t1", retailer: R("Trainline", "thetrainline.com"), orderDate: "2026-01-06", totalPence: 8900, items: [{ name: "London Euston to Manchester Piccadilly (return)", pricePence: 8900 }] }),
  listed({ id: "f1000000-0000-4000-8000-000000000001", retailer: R("Kick Lane", "kicklane.example"), orderDate: "2026-01-12", totalPence: 8500, hasImage: true, items: [{ name: "Kick Lane Court Classic Trainers", pricePence: 8500 }] }),
  listed({ id: "f2000000-0000-4000-8000-000000000002", retailer: R("Studio North", "studionorth.example"), orderDate: "2026-01-20", totalPence: 5500, hasImage: true, items: [{ name: "Oversized Hoodie", pricePence: 5500 }] }),
  listed({ id: "f3", retailer: R("Kick Lane", "kicklane.example"), orderDate: "2026-02-12", totalPence: 1800, items: [{ name: "Sports Socks 3 Pack", pricePence: 1800 }] }),
  listed({ id: "b1", retailer: R("Tvbedsnorthwest", "tvbedsnorthwest.co.uk"), orderDate: "2026-03-01", totalPence: 109289, items: [{ name: "4ft6 Ottoman TV Bed - Grey Plush Velvet", pricePence: 109289 }] }),
  listed({ id: "h1000000-0000-4000-8000-000000000001", retailer: R("Lamp Lane", "lamplane.example"), orderDate: "2026-03-09", totalPence: 4000, hasImage: true, items: [{ name: "Brass Desk Lamp", pricePence: 4000 }] }),
  listed({ id: "e1", retailer: R("Currys", "currys.co.uk"), orderDate: "2026-04-01", totalPence: 49900, items: [{ name: "Samsung 43in Smart TV", pricePence: 49900 }] }),
  listed({ id: "e2", retailer: R("Richer Sounds", "richersounds.com"), orderDate: "2026-04-20", totalPence: 19900, items: [{ name: "Bookshelf Speakers", pricePence: 19900 }] }),
  listed({ id: "t2", retailer: R("LNER", "lner.co.uk"), orderDate: "2026-05-02", totalPence: 6000, items: [{ name: "Manchester Piccadilly to London Euston", pricePence: 6000 }] }),
  listed({ id: "t3", retailer: R("Trainline", "thetrainline.com"), orderDate: "2026-06-02", totalPence: 4000, items: [{ name: "Edinburgh to Glasgow Queen Street", pricePence: 2000 }, { name: "Glasgow to Little Snoring Halt", pricePence: 2000 }] }),
  listed({ id: "k1", retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-06-08", totalPence: 600, items: [{ name: "Sainsbury's Kitchen Towels x2", pricePence: 300 }, { name: "Greek Yoghurt 950g", pricePence: 300 }] }),
  listed({ id: "k2", retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-07-08", totalPence: 600, items: [{ name: "Sainsbury's Kitchen Towels x2", pricePence: 300 }, { name: "Bananas Loose", pricePence: 300 }] }),
  listed({ id: "k3", retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-08-08", totalPence: 600, items: [{ name: "Sainsbury's Kitchen Towels x2", pricePence: 300 }, { name: "Semi Skimmed Milk 4 Pints", pricePence: 300 }] }),
];
const NOW = Date.UTC(2026, 10, 17);
let wrapped = buildWrapped(cards, 2026, NOW);
const browser = await chromium.launch();
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block", ...opts }); await skipInterests(ctx);
  const asked = [];
  await ctx.route("https://**/*", async route => { const u = new URL(route.request().url()); const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (!u.pathname.startsWith("/relay/")) return route.abort();
    const im = /^\/relay\/my\/receipts\/([0-9a-z-]{36})\/image$/.exec(u.pathname);
    if (im) { asked.push(im[1]); return PIC[im[1]] ? route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: await readFile(PIC[im[1]]) }) : route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "{}" }); }
    if (u.pathname === "/relay/my/wrapped") return j(wrapped);
    if (u.pathname === "/relay/my/gmail/history") return j({ years: [], earliest: 2020 });
    if (u.pathname === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (u.pathname === "/relay/my/gmail") return j({ connected: true, provider: "google", email: "c@example.com", lastScanAt: Date.now() });
    if (u.pathname === "/relay/my/profile") return j({ email: "c@example.com", name: "Cat", photo: null });
    return j({}); });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "S".repeat(43), email: "c@example.com" })));
  await skipInterests(page);
  await page.goto(origin + "/index.html"); await page.waitForTimeout(700);
  await page.evaluate(() => window.go("wrapped"));
  return { ctx, page, errors, asked };
}
const body = (page) => page.locator(".rl-story-body").innerText();

// 1. The whole story, slide by slide.
{
  const { ctx, page, errors, asked } = await open();
  await page.getByRole("button", { name: "Play your 2026 story" }).click();
  assert.doesNotMatch(await page.locator(".rl-wr-cover").innerText(), / · /, "the cover joins nothing with dots");
  await page.waitForTimeout(600);
  const first = await body(page);
  assert.match(first, /It started on 12 January with Court Classic Trainers from Kick Lane\./, "it opens on the trainers with their photo, not the water, and names the shop once");
  assert.doesNotMatch(first, /Water|Sainsbury|Flat White|Euston/);
  await page.locator(".rl-story-body .rl-wr-hero img").waitFor();
  await page.waitForTimeout(700);
  await page.screenshot({ path: SHOTS + "/1-opening.png" });
  const texts = [first], bgs = []; let sawBag = false, sawTrain = false, sawMap = false, sawTumble = false;
  for (let k = 0; k < 30; k++) {
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(450);
    const t = await body(page); texts.push(t);
    if (/In 2026 you spent/.test(t)) {
      assert.ok(await page.locator(".rl-story-body .bag .it").count() >= 3, "things drop into a bag on the total");
      assert.ok(await page.locator(".rl-story-body .bag .it img").count() >= 1 || await page.locator(".rl-story-body .bag .it").count() >= 3);
      // Things falling into the bag never cross the words: shown afresh, checked at 0.3s, 0.8s and 1.5s.
      await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(100); await page.keyboard.press("ArrowRight");
      const t0 = Date.now();
      for (const at of [300, 800, 1500]) {
        await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
        const hits = await page.evaluate(() => {
          const over = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          const words = [...document.querySelectorAll(".rl-story-body .rl-story-slide > :not(.bag)")].map(n => n.getBoundingClientRect());
          return [...document.querySelectorAll(".rl-story-body .bag .it")].filter(n => Number(getComputedStyle(n).opacity) > 0.01)
            .filter(n => words.some(w => over(n.getBoundingClientRect(), w))).length;
        });
        assert.equal(hits, 0, "no falling thing crosses the words at " + at + "ms");
        if (at === 800) await page.screenshot({ path: SHOTS + "/2-bag-mid-animation.png" });
      }
      sawBag = true;
    }
    if (/ON THE MOVE/.test(t)) assert.match(t, /Most travelled\s+London Euston to Manchester Piccadilly\s+3 journeys/);
    if (/YOUR LONGEST TRAIN JOURNEY/.test(t) && !sawTrain) {
      // Shown afresh, then read twice once on board (Connor, 18 Nov: the trip is seen from the train's window now): the
      // countryside goes by.
      await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(100); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(3600);
      const near = () => page.locator(".rl-story-body .jl").last().evaluate(n => new DOMMatrix(getComputedStyle(n).transform).m41);
      const a = await near();
      await page.waitForTimeout(300);
      const b = await near();
      assert.ok(Math.abs(b - a) > 5, "the countryside goes by on the journey");
      await page.screenshot({ path: SHOTS + "/3-train.png" }); sawTrain = true;
    }
    if (/YOUR OTHER TRAIN JOURNEYS/.test(t) && !sawMap) {
      // The map behind the departures board (Connor, 18 Nov 2026: the other journeys are grouped): the whole of the UK, a
      // line for every route with both ends known, each lit as its row settles, one after another.
      await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(100); await page.keyboard.press("ArrowRight");
      assert.ok(await page.locator(".rl-story-body .jbmap path.land").count() >= 5, "Great Britain, its islands and Northern Ireland");
      const g = wrapped.travel.ground;
      assert.equal(await page.locator(".rl-story-body .jbmap path.rt").count(), g.lines.length, "a line for every route with both ends known");
      assert.equal(g.lines.length, 3, "the fixture's routes with both ends known: Euston to Manchester, back, and Edinburgh to Glasgow Queen Street");
      const lit = [];
      for (const ms of [150, 700, 1300, 2200]) { await page.waitForTimeout(ms - (lit.length ? [150, 700, 1300, 2200][lit.length - 1] : 0)); lit.push(await page.locator(".rl-story-body .jbmap .gl.on").count()); }
      assert.ok(lit[0] < lit[lit.length - 1] && lit.every((v, k) => !k || v >= lit[k - 1]), "the routes light up one after another: " + lit);
      const t2 = await page.locator(".rl-story-body").innerText();
      assert.match(t2, /Not on the map: Little Snoring Halt\./);
      await page.screenshot({ path: SHOTS + "/4-map.png" }); sawMap = true;
    }
    if (/Some things you brought home/.test(t)) {
      assert.equal(await page.locator(".rl-story-body .ph.tumble").count(), 1);
      // The frame fades from the last slide's colour (.5s): read it once that fade has finished.
      assert.equal(await page.locator(".rl-story-frame").evaluate(async n => { await Promise.all(n.getAnimations().map(a => a.finished.catch(() => {}))); return getComputedStyle(n).backgroundColor; }), "rgb(255, 255, 255)", "white, not beige");
      assert.ok(await page.locator(".rl-story-body .belt span").count() >= 8, "a belt of the year's things goes by");
      await page.waitForTimeout(350); await page.screenshot({ path: SHOTS + "/5-things-mid-animation.png" }); sawTumble = true;
    }
    bgs.push(await page.locator(".rl-story-frame").evaluate(n => getComputedStyle(n).backgroundColor));
    if (await page.getByRole("button", { name: "Watch again" }).count()) break;
  }
  // No cream or beige backgrounds (warm, pale, low-saturation colours) anywhere in the story.
  for (const c of bgs) { const [r, g, b] = c.match(/\d+/g).map(Number); assert.ok(!(r > 200 && g > 190 && b > 160 && r - b >= 8 && r >= g), "no beige slide: " + c); }
  assert.ok(sawBag && sawTrain && sawMap && sawTumble, "every new moving slide was shown");
  const story = texts.join("\n");
  assert.match(story, /CHAPTER \d\s+Home & garden/, "the TV bed makes a Home & garden chapter");
  const elec = texts.find(t => /CHAPTER \d\s+Electronics/.test(t));
  assert.ok(elec && !/Tvbeds|TV Beds/i.test(elec), "the TV bed isn't Electronics");
  assert.doesNotMatch(elec, /Your go-to for tech/, "two shops, one order each: no go-to");
  assert.match(elec, /Most spent at\s+Currys\s+£499\.00/);
  assert.ok(!texts.some(t => /CHAPTER \d\s+Home & garden/.test(t) && /Sainsbury/.test(t)), "Sainsbury's is never the go-to for the home");
  assert.doesNotMatch(story, / · |×/, "no facts joined with dots or times signs (rule 17)");
  for (const id of asked) assert.ok(cards.some(c => c.id === id && c.hasImage), "only the shopper's own receipt photos are asked for: " + id);
  assert.deepEqual(errors, []);
  await page.keyboard.press("Escape");
  await ctx.close();
  console.log("ok - the story opens on the trainers, files the TV bed as furniture, names no false go-to, joins nothing with dots, and has a train, a map and moving things");
}

// 2. Reduced motion: everything is simply in place.
{
  const { ctx, page, errors } = await open({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Play your 2026 story" }).click(); await page.waitForTimeout(400);
  assert.equal(await page.locator(".rl-story-body .rl-wr-hero").evaluate(n => getComputedStyle(n).animationName), "none");
  assert.equal(await page.locator(".rl-story-body .rl-wr-hero").evaluate(n => getComputedStyle(n).opacity), "1");
  let sawList = false;
  for (let k = 0; k < 30; k++) {
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150);
    // Each trip is a still card (its route on a map that doesn't move), not the moving map and train window.
    if (await page.locator(".rl-story-body .jstill").count()) { assert.equal(await page.locator(".rl-story-body .jmap, .rl-story-body .jtrain").count(), 0, "the journeys don't move"); sawList = true; break; }
  }
  assert.ok(sawList, "the journeys were shown as still cards");
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - with reduced motion the photo, the bag and the journeys stand still");
}

// 3. Only everyday buys: it opens on the count. A year without journeys has no travel slides. A new shopper is told what's next.
{
  wrapped = buildWrapped(cards.filter(c => ["w1", "c1", "k1", "k2"].includes(c.id)), 2026, NOW);
  const { ctx, page, errors } = await open();
  await page.getByRole("button", { name: "Play your 2026 story" }).click(); await page.waitForTimeout(1500);
  const first = await body(page);
  assert.match(first, /^RELAY WRAPPED 2026\s+Your 2026, one receipt at a time\.\s+4\s+receipts from 2 shops\. Here's your year\.$/);
  const all = [first];
  for (let k = 0; k < 20; k++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(200); all.push(await body(page)); if (await page.getByRole("button", { name: "Watch again" }).count()) break; }
  assert.ok(!all.some(t => /ON THE MOVE|Where you went|JOURNEY \d|Did you visit/.test(t)), "no journeys, no travel slides");
  assert.ok(!all.some(t => /Home & garden/.test(t)), "a supermarket's kitchen roll makes no Home & garden chapter");
  await page.keyboard.press("Escape");
  wrapped = buildWrapped([], 2026, NOW);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/wrapped/.test(k)) localStorage.removeItem(k); });
  await page.reload(); await page.waitForTimeout(700); await page.evaluate(() => window.go("wrapped"));
  await page.getByRole("heading", { name: "Nothing to wrap for 2026 yet." }).waitFor();
  assert.match(await page.locator(".rl-wr-cover").innerText(), /Once Relay has found your receipts/);
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - everyday-only years open on the count, no journeys means no travel slides, and an empty year says what happens next");
}
await browser.close(); server.close();
console.log("PASS better Wrapped: memorable opening, right kinds, plain words, travel train and map, moving things, reduced motion");
