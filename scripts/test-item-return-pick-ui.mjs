// Browser test: sending back one item of an order, for every shopper, from the order's own page (25 Nov 2026).
// Stubbed Relay server (it answers /items the way worker/gmail.js does), a made-up person, invented shops and orders.
// Checks:
//  1. An order of several things: its page shows each item's own size or colour beside that item, and never one item's
//     as the order's ("Size or colour: UK 8").
//  2. "I'm sending this back" on that page asks which items: each with its picture, name, size and price, plus
//     "Everything in this order". Nothing ticked can't be saved. One item ticked and Save tapped twice sends one request,
//     for that item only.
//  3. Everywhere then says that item and not the order: the page ("In this return: …", "Sending back" beside the item),
//     Home's "In progress" and "Returns", and Returns & swaps (the item's card only).
//  4. "Change what's going back": everything; then nothing, which is "Not sending anything back" (undo), and the page and
//     Home go back to how they were.
//  5. "I've sent it back" on an order of several things asks which items first, then the tracking number and the day.
//  6. An order of one thing behaves as before: no question, one request however often it's tapped; opened again, the
//     same button takes it back ("Not sending this back").
//  7. A return Relay learned of from the shop or carrier, on an order of several things: the page says Relay wasn't told
//     which items, and "Say which items" asks.
//  8. A refund is said to be for an item only when its amount is that item's (refundItems from the server): otherwise the
//     amount alone.
//  9. The server refusing: plain words, nothing saved, and it can be tried again.
// 10. The polish rules on all of it: 44px taps, no text under 13px, no symbol icons, no dot-joined facts, no test
//     wording, never wider than the phone; and no page errors.
// Screenshots go to RELAY_ITEMS_SHOTS (or /tmp/shots).
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeReady } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.RELAY_ITEMS_SHOTS || "/tmp/shots"; await mkdir(SHOTS, { recursive: true });

const EMAIL = "sam.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const step = (s, done, at, from, more) => ({ step: s, done, at: at || null, from: from || null, ...(more || {}) });
const YOU = { by: "you", name: null, via: "app" }, missed = (s) => ({ step: s, done: false, at: null, from: null, missed: true });
const order = (id, shop, ago, items, extra) => ({ id, status: "confirmed", kind: "receipt", retailer: { name: shop, domain: null }, orderRef: "R-" + id.slice(0, 4), orderDate: day(-ago),
  totalPence: items.reduce((n, i) => n + i.pricePence * (i.qty || 1), 0), currency: "GBP", category: "fashion", returnable: true, items, returns: { deadline: day(14 - ago) }, reminder: "off", ...extra });
// Three things, each with its own size.
const NORTH = order("11111111-1111-4111-8111-111111111111", "Northwind", 4, [{ name: "Flared Pant", variant: "UK 8", pricePence: 6900, qty: 1 }, { name: "Cropped Tee", variant: "M, Sage", pricePence: 3800, qty: 1 }, { name: "Wool Socks", variant: "One size", pricePence: 1200, qty: 1 }]);
// One thing.
const KICK = order("22222222-2222-4222-8222-222222222222", "Kick Lane", 5, [{ name: "Court Classic Trainers", variant: "UK 9", pricePence: 8500, qty: 1 }]);
// Two things, nothing said yet: for "I've sent it back".
const FIELD = order("33333333-3333-4333-8333-333333333333", "Fieldhouse", 3, [{ name: "Rain Jacket", variant: "L", pricePence: 6000, qty: 1 }, { name: "Canvas Cap", variant: "Navy", pricePence: 3000, qty: 1 }]);
// Two things, a return on its way on the carrier's word: nobody said which items.
const RM = { by: "carrier", name: "Royal Mail", via: "email" };
const HARLOW = order("44444444-4444-4444-8444-444444444444", "Harlow & Co", 9, [{ name: "Wool Coat", variant: "12", pricePence: 12000, qty: 1 }, { name: "Silk Scarf", variant: "Rust", pricePence: 4000, qty: 1 }], {
  returnTracking: { state: "sent", steps: [missed("started"), step("sent", true, day(-2), RM), step("received", false), step("refunded", false)], trackingNumber: "HC123456789GB", carrier: "Royal Mail",
    trackUrl: "https://www.royalmail.com/track-your-item#/tracking-results/HC123456789GB", typed: null, returnInTransit: true, returnReceived: false, confirmedBy: null, onItsWay: null, refundNotSeen: null, liveTracking: false },
  returnProgress: { trackingNumber: "HC123456789GB", carrier: "Royal Mail", parcel: null, receivedAt: null, refundedAt: null, refundPence: null, currency: null } });
// Refunded: the shopper marked the shirt, and the refund is the shirt's price (the server says so: refundItems).
const refunded = (pence) => ({ state: "refunded", steps: [step("started", true, day(-12), YOU), missed("sent"), missed("received"), step("refunded", true, day(-3), { by: "shop", name: "x", via: "email" }, { amountPence: pence, currency: "GBP" })],
  trackingNumber: null, carrier: null, trackUrl: null, typed: null, returnInTransit: false, returnReceived: true, confirmedBy: null, onItsWay: null, refundNotSeen: null, liveTracking: false, items: [1], itemsFrom: "you" });
const TALL = order("55555555-5555-4555-8555-555555555555", "Tall Pines", 20, [{ name: "Cord Trousers", variant: "32R", pricePence: 5500, qty: 1 }, { name: "Linen Shirt", variant: "M", pricePence: 2400, qty: 1 }], {
  returns: null, itemReturns: { 1: "returning" }, refundItems: [1], returnTracking: refunded(2400), returnProgress: { trackingNumber: null, carrier: null, parcel: null, receivedAt: null, refundedAt: day(-3), refundPence: 2400, currency: "GBP" } });
// Refunded an amount that is no item's price (some of it kept back): never said to be for the item.
const FERN = order("66666666-6666-4666-8666-666666666666", "Fern & Finch", 22, [{ name: "Copper Kettle", variant: "1.5 litre", pricePence: 4500, qty: 1 }, { name: "Tea Towel", variant: "Stripe", pricePence: 900, qty: 1 }], {
  category: "home", returns: null, itemReturns: { 1: "returning" }, returnTracking: refunded(500), returnProgress: { trackingNumber: null, carrier: null, parcel: null, receivedAt: null, refundedAt: day(-3), refundPence: 500, currency: "GBP" } });
const ALL = [NORTH, KICK, FIELD, HARLOW, TALL, FERN];
let st;
const reset = (o = {}) => { st = { marks: {}, sent: {}, log: [], posts: [], sentPosts: [], refuse: null, ...o }; };
reset();
// The receipt as Relay's server would list it: the shopper's marks, and a return started by them ("You said").
const view = (o) => {
  const out = JSON.parse(JSON.stringify(o)), m = st.marks[o.id], on = m ? Object.keys(m).filter(k => m[k] === "returning").map(Number).sort((a, b) => a - b) : [], sent = st.sent[o.id];
  if (m) out.itemReturns = { ...(out.itemReturns || {}), ...m };
  if (!out.returnTracking && (on.length || sent)) out.returnTracking = { state: sent ? "sent" : "started", steps: [on.length ? step("started", true, day(0), YOU) : missed("started"), sent ? step("sent", true, sent.sentOn, YOU) : step("sent", false), step("received", false), step("refunded", false)],
    trackingNumber: (sent && sent.trackingNumber) || null, carrier: (sent && sent.carrier) || null, trackUrl: null, typed: sent ? { trackingNumber: sent.trackingNumber || null, carrier: sent.carrier || null, sentOn: sent.sentOn } : null,
    returnInTransit: false, returnReceived: false, confirmedBy: null, onItsWay: null, refundNotSeen: null, liveTracking: false };
  if (out.returnTracking && on.length) { out.returnTracking.items = on; out.returnTracking.itemsFrom = "you"; }
  return out;
};
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const browser = await chromium.launch();
async function shopper() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "block" }); await skipInterests(ctx);
  await ctx.addInitScript(([e]) => { try { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); } catch (x) {} }, [EMAIL]);
  await ctx.route("https://**/*", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith("/relay/")) return route.abort();
    st.log.push(m + " " + p + u.search);
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
    if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 6e5, others: [] });
    if (p === "/relay/my/receipts") return j({ receipts: ALL.map(view) });
    if (p === "/relay/my/purchases") return j({ purchases: [] });
    if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Tester", photo: null });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [] });
    const it = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/items$/.exec(p);
    if (it && m === "POST") {
      const body = JSON.parse(req.postData() || "{}"); st.posts.push([it[1], body]);
      await new Promise(r => setTimeout(r, 300));    // a slow server, so a second tap lands while the first is on its way
      if (st.refuse) return j(st.refuse.body, st.refuse.status);
      const e = st.marks[it[1]] = st.marks[it[1]] || {};
      body.items.forEach(x => { e[x.index] = x.status || "kept"; });
      const now = view(ALL.find(o => o.id === it[1]));
      return j({ ok: true, itemReturns: now.itemReturns || null, returnTracking: now.returnTracking || null });
    }
    const rs = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/return-sent$/.exec(p);
    if (rs && m === "POST") {
      const body = JSON.parse(req.postData() || "{}"); st.sentPosts.push([rs[1], body]); st.sent[rs[1]] = body;
      return j({ ok: true, carrierGuessed: false, needsCarrier: false, returnTracking: view(ALL.find(o => o.id === rs[1])).returnTracking, returnInTransit: false, returnReceived: false });
    }
    if (/\/return-parcel$/.test(p)) return j({ available: true, returnTracking: view(ALL.find(o => p.includes(o.id))).returnTracking || null });
    return j({});
  });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(origin + "/index.html");
  await homeReady(page);
  await page.locator("#homePage .h2-sec, #homePage .hx > *").first().waitFor();
  await page.waitForTimeout(700);
  return { ctx, page, errors };
}
// The polish rules on what's showing: 44px taps, 13px text, no symbol icons, no "A · B · C", no test wording, nothing wider
// than the phone (as scripts/test-return-tracking-ui.mjs).
const measure = (page, scope) => page.evaluate((scope) => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0.5; };
  const out = { small: [], tiny: [], symbols: [], dots: [], words: [], wide: [] };
  const all = document.querySelectorAll(scope), box = all[all.length - 1];
  for (const el of box.querySelectorAll("button, a, [role=button], [role=checkbox]")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓☐☑]|\p{Extended_Pictographic}/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of box.querySelectorAll("*")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    if (px < 13 && !(s.textTransform === "uppercase" && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
  }
  if (/ · /.test(box.innerText)) out.dots.push("·");
  if (/\b(demo|sandbox|test shop|testing)\b/i.test(box.innerText)) out.words.push(box.innerText.match(/\b(demo|sandbox|test shop|testing)\b/i)[0]);
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const clean = { small: [], tiny: [], symbols: [], dots: [], words: [], wide: [] };
const sheet = page => page.locator(".rl-back .rl-sheet").first();          // the order's page
const picker = page => page.locator('.rl-sheet[aria-label="What are you sending back?"]');
const closeTop = async page => { await page.waitForTimeout(400); const back = page.locator(".rl-back").last(); await back.click({ position: { x: 10, y: 10 } }); await back.waitFor({ state: "detached" }); };
// Home's In progress cards, as each says itself.
const live = page => page.locator("#homePage .hx-live").evaluateAll(cs => cs.map(c => c.getAttribute("aria-label")));
const openOrder = async (page, shop) => { await page.locator("#homePage .hl-sq, #homePage .h2-item, #homePage .hx-sq, #homePage .hx-live", { hasText: shop }).first().click(); const sh = sheet(page); await sh.locator(".rl-dt-head").waitFor(); await page.waitForTimeout(400); return sh; };
// The items on an order's page: each line's words, as a person reads them.
const lines = sh => sh.locator(".rl-dt-items li").evaluateAll(ls => ls.map(l => l.innerText.replace(/\s+/g, " ").trim()));
const top = async sh => { await sh.evaluate(s => { s.scrollTop = 0; if (s.parentNode) s.parentNode.scrollTop = 0; }); };
const allErrors = [];

// 1 to 4. An order of several things, from Home.
{
  const { ctx, page, errors } = await shopper();
  let sh = await openOrder(page, "Northwind");
  // 1. Each item's own size, beside that item; never one item's as the order's.
  assert.deepEqual(await lines(sh), ["Flared Pant UK 8 £69.00", "Cropped Tee M, Sage £38.00", "Wool Socks One size £12.00"], "each item with its own size and price");
  assert.equal(await sh.getByText("Size or colour").count(), 0, "no size said for the whole order");
  assert.equal(await sh.locator(".rl-dt-fact", { hasText: "UK 8" }).count(), 1, "UK 8 is said once, with the item it belongs to");
  assert.equal(await sh.locator(".rl-rt .rl-ret-h").count(), 0, "no return yet");
  // 2. Which items?
  await sh.getByRole("button", { name: "I'm sending this back" }).click();
  const pk = picker(page); await pk.waitFor(); await page.waitForTimeout(350);
  assert.equal(st.posts.length, 0, "nothing is marked by opening it");
  const rows = await pk.locator(".rl-pick-row:not(.rl-pick-all)").evaluateAll(rs => rs.map(r => ({ words: r.innerText.replace(/\s+/g, " ").trim(), pic: Boolean(r.querySelector(".rl-pick-pic svg, .rl-pick-pic img")), ticked: r.getAttribute("aria-checked"), h: Math.round(r.getBoundingClientRect().height) })));
  assert.deepEqual(rows.map(r => [r.words, r.pic, r.ticked]), [["Flared Pant UK 8 £69.00", true, "false"], ["Cropped Tee M, Sage £38.00", true, "false"], ["Wool Socks One size £12.00", true, "false"]], "each item with its picture, name, size and price, none ticked");
  assert.ok(rows.every(r => r.h >= 44), "rows big enough to tap: " + JSON.stringify(rows.map(r => r.h)));
  assert.equal(await pk.locator(".rl-pick-all").innerText(), "Everything in this order");
  const save = pk.getByRole("button", { name: "Save" });
  assert.equal(await save.isDisabled(), true, "nothing ticked: nothing to save");
  assert.deepEqual(await measure(page, ".rl-back .rl-sheet"), clean, "the question's polish");
  await pk.locator(".rl-pick-row", { hasText: "Cropped Tee" }).click();
  assert.equal(await pk.locator(".rl-pick-row", { hasText: "Cropped Tee" }).getAttribute("aria-checked"), "true");
  assert.equal(await save.isDisabled(), false);
  await page.screenshot({ path: SHOTS + "/items-which.png" });
  // A double tap on Save: one request, for that item only.
  await save.dblclick();
  await pk.waitFor({ state: "detached" });
  assert.deepEqual(st.posts, [[NORTH.id, { items: [{ index: 1, status: "returning" }] }]], "one request, for the one item");
  // 3. The page, drawn again: the return is for that item.
  sh = sheet(page); await sh.locator(".rl-rt .rl-ret-h").waitFor(); await page.waitForTimeout(300);
  assert.equal(await sh.locator(".rl-rt-items").innerText(), "In this return: Cropped Tee (M, Sage).");
  assert.match(await sh.locator(".rl-rt-step.done").first().innerText(), /Return started\s+You said/);
  assert.deepEqual(await lines(sh), ["Flared Pant UK 8 £69.00", "Cropped Tee M, Sage Sending back £38.00", "Wool Socks One size £12.00"], "only the tee says it's going back");
  assert.equal(await sh.getByRole("button", { name: "I'm sending this back" }).count(), 0);
  await sh.getByRole("button", { name: "Change what's going back" }).waitFor();
  assert.match(await sh.innerText(), /Return by/, "the rest of the order still has its return date");
  assert.deepEqual(await measure(page, ".rl-back .rl-sheet"), clean, "the page's polish");
  await top(sh); await page.screenshot({ path: SHOTS + "/items-page-one-going-back.png" });
  await closeTop(page);
  // Home: the card says the item, never the whole order.
  await page.waitForFunction(() => [...document.querySelectorAll("#homePage .hx-live")].some(c => /^Northwind\. Cropped Tee\. Sending back/.test(c.getAttribute("aria-label"))));
  let needs = await live(page);
  assert.ok(needs.some(t => t === "Northwind. Cropped Tee. Sending back. Next: post it back"), "In progress names the item: " + JSON.stringify(needs));
  assert.ok(!needs.some(t => /^Northwind\. (Flared Pant|3 items)|Return started/.test(t)), "never the whole order");
  assert.equal((await page.locator("#homePage .h2-feed").innerText()).match(/Northwind/g).length, 1, "the order once on Home");
  await page.screenshot({ path: SHOTS + "/items-home.png" });
  await page.locator(".h2-chip", { hasText: "Returns" }).click(); await page.waitForTimeout(300);
  let squares = await page.locator("#homePage .hl-sq").evaluateAll(xs => xs.map(x => x.getAttribute("aria-label")));
  assert.ok(squares.some(s => /Northwind/.test(s) && /1 of 3 going back/.test(s)), "Returns says how many of the order: " + JSON.stringify(squares));
  assert.ok(!squares.some(s => /Northwind/.test(s) && /Return started/.test(s)), "never 'Return started' for the whole order");
  assert.deepEqual(await measure(page, "#homePage"), clean, "Home's polish");
  // Returns & swaps: the item's own card, and not the things that were kept.
  await page.evaluate(() => window.go("returns"));
  const ret = page.locator("#returnsPage");
  await ret.locator(".rl-po", { hasText: "Cropped Tee" }).first().waitFor();
  const north = await ret.locator(".rl-po", { hasText: "Northwind" }).evaluateAll(cs => cs.map(c => c.innerText.replace(/\s+/g, " ").trim()));
  assert.equal(north.length, 1, "one card, for the one item: " + JSON.stringify(north));
  assert.match(north[0], /Cropped Tee, 1 of 3 in this order/); assert.ok(!/Flared Pant|Wool Socks/.test(north[0]), "the kept items aren't in Returns: " + north[0]);
  await page.evaluate(() => window.go("profile")); await homeReady(page);
  // (Home remembers the chip that was picked: back to "For you", where "In progress" is.)
  await page.locator(".h2-chip", { hasText: "For you" }).click(); await page.locator("#homePage .hx-h").first().waitFor(); await page.waitForTimeout(500);
  // 4. Change it: everything.
  sh = await openOrder(page, "Northwind");
  await sh.getByRole("button", { name: "Change what's going back" }).click();
  let pk2 = picker(page); await pk2.waitFor(); await page.waitForTimeout(350);
  assert.deepEqual(await pk2.locator(".rl-pick-row:not(.rl-pick-all)").evaluateAll(rs => rs.map(r => r.getAttribute("aria-checked"))), ["false", "true", "false"], "what was chosen starts ticked");
  await pk2.locator(".rl-pick-all").click();
  assert.deepEqual(await pk2.locator(".rl-pick-row").evaluateAll(rs => rs.map(r => r.getAttribute("aria-checked"))), ["true", "true", "true", "true"]);
  await pk2.getByRole("button", { name: "Save" }).click(); await pk2.waitFor({ state: "detached" });
  assert.deepEqual(st.posts[1], [NORTH.id, { items: [0, 1, 2].map(index => ({ index, status: "returning" })) }]);
  sh = sheet(page); await sh.locator(".rl-rt-items").waitFor();
  assert.equal(await sh.locator(".rl-rt-items").innerText(), "In this return: everything in this order.");
  assert.equal((await lines(sh)).filter(l => /Sending back/.test(l)).length, 3);
  // …then nothing: that's taking it back.
  await sh.getByRole("button", { name: "Change what's going back" }).click();
  pk2 = picker(page); await pk2.waitFor(); await page.waitForTimeout(350);
  await pk2.locator(".rl-pick-all").click();
  assert.deepEqual(await pk2.locator(".rl-pick-row").evaluateAll(rs => rs.map(r => r.getAttribute("aria-checked"))), ["false", "false", "false", "false"]);
  const undo = pk2.getByRole("button", { name: "Not sending anything back" });
  await undo.dblclick(); await pk2.waitFor({ state: "detached" });
  assert.equal(st.posts.length, 3, "one request for the undo, however it was tapped");
  assert.deepEqual(st.posts[2], [NORTH.id, { items: [0, 1, 2].map(index => ({ index, status: null })) }]);
  sh = sheet(page); await sh.getByRole("button", { name: "I'm sending this back" }).waitFor();
  assert.equal(await sh.locator(".rl-rt .rl-ret-h").count(), 0, "no return any more");
  assert.equal((await lines(sh)).filter(l => /Sending back/.test(l)).length, 0);
  await closeTop(page);
  await page.waitForFunction(() => !/Sending back|going back/.test(document.querySelector("#homePage").innerText));
  squares = await page.locator("#homePage .hx-sq").evaluateAll(xs => xs.map(x => x.getAttribute("aria-label")));
  assert.ok(squares.some(s => /Northwind/.test(s) && /Return by/.test(s)), "Home shows it as it was: " + JSON.stringify(squares));
  // 9. The server refusing: plain words, nothing changed, and it can be tried again.
  sh = await openOrder(page, "Northwind");
  await sh.getByRole("button", { name: "I'm sending this back" }).click();
  const pk3 = picker(page); await pk3.waitFor(); await page.waitForTimeout(350);
  st.refuse = { status: 500, body: { error: "internal_error" } };
  await pk3.locator(".rl-pick-row", { hasText: "Wool Socks" }).click();
  await pk3.getByRole("button", { name: "Save" }).click();
  await pk3.getByText("Couldn't save that. Please try again.").waitFor();
  assert.ok(!/internal_error|500/.test(await pk3.innerText()), "no codes");
  assert.equal(await pk3.locator(".rl-pick-row", { hasText: "Wool Socks" }).getAttribute("aria-checked"), "true", "the choice is still there to try again");
  st.refuse = null;
  await pk3.getByRole("button", { name: "Save" }).click(); await pk3.waitFor({ state: "detached" });
  assert.deepEqual(st.posts[st.posts.length - 1], [NORTH.id, { items: [{ index: 2, status: "returning" }] }]);
  assert.equal(await sheet(page).locator(".rl-rt-items").innerText(), "In this return: Wool Socks (One size).");
  allErrors.push(...errors); await ctx.close();
}
// 5. "I've sent it back" on an order of several things: which items first, then the number and the day.
{
  reset();
  const { ctx, page, errors } = await shopper();
  let sh = await openOrder(page, "Fieldhouse");
  await sh.getByRole("button", { name: "I've sent it back" }).click();
  const pk = picker(page); await pk.waitFor(); await page.waitForTimeout(350);
  assert.equal(st.sentPosts.length, 0);
  await pk.locator(".rl-pick-row", { hasText: "Canvas Cap" }).click();
  await pk.getByRole("button", { name: "Save" }).click(); await pk.waitFor({ state: "detached" });
  assert.deepEqual(st.posts, [[FIELD.id, { items: [{ index: 1, status: "returning" }] }]]);
  const form = page.locator('.rl-sheet[aria-label="I\'ve sent it back"]'); await form.waitFor(); await page.waitForTimeout(350);
  await form.getByRole("button", { name: "Save" }).click(); await form.waitFor({ state: "detached" });
  assert.equal(st.sentPosts.length, 1, "then the return is saved as sent");
  sh = sheet(page); await sh.locator(".rl-rt-step.done", { hasText: "Sent back" }).waitFor();
  assert.equal(await sh.locator(".rl-rt-items").innerText(), "In this return: Canvas Cap (Navy).");
  assert.deepEqual(await lines(sh), ["Rain Jacket L £60.00", "Canvas Cap Navy Sent back £30.00"]);
  await closeTop(page);
  await page.waitForFunction(() => [...document.querySelectorAll("#homePage .hx-live")].some(c => c.getAttribute("aria-label") === "Fieldhouse. Canvas Cap. Sent back. Next: Fieldhouse gets it"));
  allErrors.push(...errors); await ctx.close();
}
// 6. An order of one thing: no question; one request; the same button takes it back.
{
  reset();
  const { ctx, page, errors } = await shopper();
  let sh = await openOrder(page, "Kick Lane");
  assert.equal(await sh.locator(".rl-dt-fact", { hasText: "Size or colour" }).innerText().then(t => t.replace(/\s+/g, " ")), "Size or colour UK 9", "one thing's size is the order's");
  await sh.getByRole("button", { name: "I'm sending this back" }).dblclick();
  await page.locator(".rl-back").waitFor({ state: "detached" });
  assert.equal(await picker(page).count(), 0, "no question for one thing");
  assert.deepEqual(st.posts, [[KICK.id, { items: [{ index: 0, status: "returning" }] }]], "one request");
  const kickBack = () => [...document.querySelectorAll("#homePage .hx-live")].some(c => c.getAttribute("aria-label") === "Kick Lane. Court Classic Trainers. Sending back. Next: post it back");
  await page.waitForFunction(kickBack);
  sh = await openOrder(page, "Kick Lane");
  assert.equal(await sh.locator(".rl-rt-items").count(), 0, "one thing: nothing to say about which");
  assert.equal(await sh.getByRole("button", { name: "I'm sending this back" }).count(), 0, "it isn't offered twice");
  await sh.getByRole("button", { name: "Not sending this back" }).dblclick();
  await page.locator(".rl-back").waitFor({ state: "detached" });
  assert.deepEqual(st.posts.slice(1), [[KICK.id, { items: [{ index: 0, status: null }] }]], "one request to take it back");
  await page.waitForFunction(() => ![...document.querySelectorAll("#homePage .hx-live")].some(c => /^Kick Lane\./.test(c.getAttribute("aria-label"))) && !/Sending back|Return started/.test(document.querySelector("#homePage").innerText));
  allErrors.push(...errors); await ctx.close();
}
// 7 and 8. A return Relay wasn't told the items of; and refunds.
{
  reset();
  const { ctx, page, errors } = await shopper();
  const needs = await live(page);
  assert.ok(needs.some(t => /^Harlow & Co\. 2 items\. Sent back\./.test(t)), "items not known: nothing is said about which: " + JSON.stringify(needs));
  let sh = await openOrder(page, "Harlow & Co");
  assert.equal(await sh.locator(".rl-rt-items").innerText(), "Relay wasn't told which items are in this return.");
  assert.equal((await lines(sh)).filter(l => /Sent back|Sending back/.test(l)).length, 0, "no item is said to be going back");
  await sh.getByText("Tracking number").waitFor();
  await sh.getByRole("button", { name: "Say which items" }).click();
  const pk = picker(page); await pk.waitFor(); await page.waitForTimeout(350);
  await pk.locator(".rl-pick-row", { hasText: "Silk Scarf" }).click();
  await pk.getByRole("button", { name: "Save" }).click(); await pk.waitFor({ state: "detached" });
  assert.deepEqual(st.posts, [[HARLOW.id, { items: [{ index: 1, status: "returning" }] }]]);
  sh = sheet(page); await sh.locator(".rl-rt-items").waitFor();
  assert.equal(await sh.locator(".rl-rt-items").innerText(), "In this return: Silk Scarf (Rust).");
  assert.deepEqual(await lines(sh), ["Wool Coat 12 £120.00", "Silk Scarf Rust Sent back £40.00"]);
  assert.equal(await sh.getByRole("button", { name: "Say which items" }).count(), 0);
  await top(sh); await page.screenshot({ path: SHOTS + "/items-page-sent.png" });
  await closeTop(page);
  // 8. A refund that is the item's price is said for the item; one that isn't is only an amount.
  const home = await page.locator("#homePage").innerText();
  const tall = await openOrder(page, "Tall Pines");
  assert.deepEqual(await lines(tall), ["Cord Trousers 32R £55.00", "Linen Shirt M Refunded £24.00"]);
  assert.equal(await tall.locator(".rl-rt-items").innerText(), "In this return: Linen Shirt (M).");
  await tall.locator(".rl-rt-step.done", { hasText: "Refund of £24.00 issued" }).waitFor();
  await closeTop(page);
  const fern = await openOrder(page, "Fern & Finch");
  assert.deepEqual(await lines(fern), ["Copper Kettle 1.5 litre £45.00", "Tea Towel Stripe In this return £9.00"], "a refund of another amount isn't said to be the towel's");
  assert.ok(!/Refunded £5\.00 for/.test(await fern.innerText()) && !/Refunded £5\.00 for/.test(home), "never 'for' an item the amount doesn't fit");
  assert.deepEqual(await measure(page, ".rl-back .rl-sheet"), clean, "the page's polish");
  await closeTop(page);
  // Returns & swaps: each item's card says where its return has got to.
  await page.evaluate(() => window.go("returns"));
  const ret = page.locator("#returnsPage");
  await ret.locator(".rl-po", { hasText: "Linen Shirt" }).getByText("Refunded £24.00 for Linen Shirt").waitFor();
  await ret.locator(".rl-po", { hasText: "Tea Towel" }).locator(".rl-po-ship", { hasText: "Refunded £5.00" }).waitFor();
  assert.equal(await ret.getByText(/Refunded £5\.00 for/).count(), 0, "an amount that fits no item is never said to be for one");
  assert.equal(await ret.locator(".rl-po", { hasText: "Cord Trousers" }).count() + await ret.locator(".rl-po", { hasText: "Copper Kettle" }).count(), 0, "the kept items aren't in Returns");
  allErrors.push(...errors); await ctx.close();
}
assert.deepEqual(allErrors, [], "no page errors");
console.log("PASS item return from an order's page: each item's own size, which items asked (picture, name, size, price), one request on a double tap, the item named on the page, Home and Returns & swaps, change and undo, sent back, one-item orders as before, items not known said so, refunds only for items the amount fits, plain refusals, polish");
await browser.close(); server.close();
