// Browser test: return tracking in the app (worker/return-tracking.js). Stubbed Relay server, a made-up person, invented
// shops, orders and tracking numbers.
// Checks:
//  1. Home (Receipts first): "Needs you" shows a refund not seen 14 days after the shop had the return near the top, and a
//     return on its way with where it has got to; "To return" shows returns in progress beside what can still go back.
//  2. The receipt's page: the four steps in order, each done one with its day and who said so ("From Royal Mail", "From
//     Glow Lab's email", "You said"), steps still to come greyed, the tracking number with the carrier's own link, and
//     "Refund not seen yet" with what to do. Opening it asks the carrier once (never on Home, never on a timer); when
//     tracking isn't available the page says so plainly.
//  3. "I've sent it back": a number whose carrier the format doesn't give asks who's carrying it; Royal Mail's format
//     doesn't; the day; one tap saves once (a double tap doesn't send twice); plain words for a refusal; the timeline then
//     shows "You said".
//  4. The polish rules on all of it: 44px taps, no text under 13px, no symbol icons, no dot-joined facts, no test wording,
//     the page never wider than the phone; and no page errors.
// Screenshots go to RELAY_RETURNS_SHOTS (or /tmp/shots).
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeReady } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.RELAY_RETURNS_SHOTS || "/tmp/shots"; await mkdir(SHOTS, { recursive: true });

const EMAIL = "sam.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const shortDay = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const receipt = (id, shop, item, pence, ago, extra) => ({ id, status: "confirmed", kind: "receipt", retailer: { name: shop, domain: null }, orderRef: "R-" + id.slice(0, 4), orderDate: day(-ago), totalPence: pence, currency: "GBP",
  category: "fashion", returnable: true, items: [{ name: item, qty: 1, pricePence: pence, category: "fashion" }], returns: null, reminder: "off", ...extra });
const step = (s, done, at, from, more) => ({ step: s, done, at: at || null, from: from || null, ...(more || {}) });
const RM = { by: "carrier", name: "Royal Mail", via: "email" };
// On its way back, on Royal Mail's word (its email), with the number the shopper typed.
const COAT = receipt("22222222-2222-4222-8222-222222222222", "Harlow & Co", "Wool Coat", 12000, 20, {
  returnTracking: { state: "sent", steps: [step("started", true, day(-6), { by: "shop", name: "Harlow & Co", via: "email" }), step("sent", true, day(-3), RM), step("received", false), step("refunded", false)],
    trackingNumber: "KO123456789GB", carrier: "Royal Mail", trackUrl: "https://www.royalmail.com/track-your-item#/tracking-results/KO123456789GB", typed: null,
    returnInTransit: true, returnReceived: false, confirmedBy: { by: "carrier", name: "Royal Mail", at: day(-3) }, refundNotSeen: null, liveTracking: true },
  returnInTransit: true, returnReceived: false, returnProgress: { trackingNumber: "KO123456789GB", carrier: "Royal Mail", parcel: null, receivedAt: null, refundedAt: null, refundPence: null, currency: null } });
// At the shop for 16 days, no refund seen.
const SERUM = receipt("11111111-1111-4111-8111-111111111111", "Glow Lab", "Vitamin C Serum", 2400, 40, {
  returns: { portalUrl: "https://returns.glowlab.example/help" },
  returnTracking: { state: "received", steps: [step("started", true), step("sent", true, day(-20), { by: "you", name: null, via: "app" }), step("received", true, day(-16), { by: "shop", name: "Glow Lab", via: "email" }), step("refunded", false)],
    trackingNumber: null, carrier: null, trackUrl: null, typed: { trackingNumber: null, carrier: null, sentOn: day(-20) }, returnInTransit: false, returnReceived: true,
    confirmedBy: { by: "shop", name: "Glow Lab", at: day(-16) }, refundNotSeen: { since: day(-16), days: 16 }, liveTracking: false },
  returnInTransit: false, returnReceived: true, returnProgress: { trackingNumber: null, carrier: null, parcel: null, receivedAt: day(-16), refundedAt: null, refundPence: null, currency: null } });
// Nothing sent yet: "I've sent it back" is on its page.
const SHOES = receipt("44444444-4444-4444-8444-444444444444", "Kick Lane", "Court Classic Trainers", 8500, 5, { returns: { deadline: day(12) } });
const LAMP = receipt("55555555-5555-4555-8555-555555555555", "Larkspur Home", "Brass Table Lamp", 6000, 3, { category: "home", items: [{ name: "Brass Table Lamp", qty: 1, pricePence: 6000, category: "home" }], returns: { deadline: day(25) } });
let st;
const reset = (o = {}) => { st = { receipts: [COAT, SERUM, SHOES, LAMP], log: [], posts: [], parcel: { available: true }, sentReply: null, ...o }; };
reset();
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const browser = await chromium.launch();
async function shopper() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" }); await skipInterests(ctx);
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
    if (p === "/relay/my/receipts") return j({ receipts: st.receipts });
    if (p === "/relay/my/purchases") return j({ purchases: [] });
    if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Tester", photo: null });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [] });
    const rp = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/return-parcel$/.exec(p);
    if (rp && m === "GET") { const x = st.receipts.find(r => r.id === rp[1]); return j({ ...st.parcel, returnTracking: (x && x.returnTracking) || null }); }
    const rs = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/return-sent$/.exec(p);
    if (rs && m === "POST") {
      const body = JSON.parse(req.postData() || "{}"); st.posts.push(body);
      await new Promise(r => setTimeout(r, 300));    // a slow server, so a second tap lands while the first is on its way
      if (st.sentReply) return j(st.sentReply.body, st.sentReply.status);
      const x = st.receipts.find(r => r.id === rs[1]);
      const t = { state: "sent", steps: [step("started", true), step("sent", true, body.sentOn, { by: "you", name: null, via: "app" }), step("received", false), step("refunded", false)],
        trackingNumber: body.trackingNumber || null, carrier: body.carrier || null, trackUrl: body.carrier === "DPD" ? "https://track.dpd.co.uk/parcels/" + body.trackingNumber : null,
        typed: { trackingNumber: body.trackingNumber || null, carrier: body.carrier || null, sentOn: body.sentOn }, returnInTransit: false, returnReceived: false, confirmedBy: null, refundNotSeen: null, liveTracking: Boolean(body.trackingNumber) };
      x.returnTracking = t; x.returnProgress = { trackingNumber: t.trackingNumber, carrier: t.carrier, parcel: null, receivedAt: null, refundedAt: null, refundPence: null, currency: null };
      return j({ ok: true, carrierGuessed: false, needsCarrier: false, returnTracking: t, returnInTransit: false, returnReceived: false });
    }
    return j({});
  });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(origin + "/index.html");
  await homeReady(page);
  await page.locator("#homePage .h2-sec").first().waitFor();
  await page.waitForTimeout(700);
  return { ctx, page, errors };
}
// The polish rules on what's showing in a sheet (or on Home): 44px taps, 13px text, no symbol icons, no "A · B · C",
// no test wording, nothing wider than the phone.
const measure = (page, scope) => page.evaluate((scope) => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0.5; };
  const out = { small: [], tiny: [], symbols: [], dots: [], words: [], wide: [] };
  const box = document.querySelector(scope);
  for (const el of box.querySelectorAll("button, a, [role=button]")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓]|\p{Extended_Pictographic}/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
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
const sheet = page => page.locator(".rl-back .rl-sheet").last();
const closeTop = async page => { await page.waitForTimeout(400); const back = page.locator(".rl-back").last(); await back.click({ position: { x: 10, y: 10 } }); await back.waitFor({ state: "detached" }); };
const under = (page, name) => page.evaluate(name => {
  const kids = [...document.querySelectorAll("#homePage .h2-feed > *")], at = kids.findIndex(k => k.classList.contains("h2-sec") && k.textContent === name), out = [];
  if (at < 0) return null;
  for (const k of kids.slice(at + 1)) { if (k.classList.contains("h2-sec")) break; out.push(k.innerText.replace(/\s+/g, " ").trim()); }
  return out;
}, name);
const allErrors = [];

// 1. Home.
{
  const { ctx, page, errors } = await shopper();
  const needs = await under(page, "Needs you");
  assert.ok(needs && needs.length >= 2, "Needs you is there: " + JSON.stringify(needs));
  assert.match(needs[0], /^Refund not seen yet Glow Lab, Vitamin C Serum/, "the refund not seen comes first: " + needs[0]);
  assert.ok(needs.some(t => /^Sent back, on its way to Harlow & Co Harlow & Co, Wool Coat/.test(t)), "the return on its way, with where it has got to: " + JSON.stringify(needs));
  assert.equal(st.log.filter(l => /return-parcel/.test(l)).length, 0, "Home never asks the carrier");
  assert.deepEqual(await measure(page, "#homePage"), clean, "Home's polish");
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250);
  await page.screenshot({ path: SHOTS + "/home-return-in-progress.png" });
  // "To return": returns on their way beside what can still go back, each with its state.
  await page.locator(".h2-chip", { hasText: "To return" }).click();
  await page.waitForTimeout(300);
  const squares = await page.locator("#homePage .hl-sq").evaluateAll(xs => xs.map(x => x.getAttribute("aria-label")));
  assert.ok(squares.some(s => /Kick Lane/.test(s) && /Return by/.test(s)), "still returnable: " + JSON.stringify(squares));
  assert.ok(squares.some(s => /Harlow & Co/.test(s) && /Sent back/.test(s)), "on its way back: " + JSON.stringify(squares));
  assert.ok(squares.some(s => /Glow Lab/.test(s) && /Refund not seen yet/.test(s)), "refund not seen: " + JSON.stringify(squares));
  await page.screenshot({ path: SHOTS + "/home-to-return.png" });
  allErrors.push(...errors); await ctx.close();
  console.log("ok - Home: Needs you leads with the refund not seen yet, then the return on its way with its state; To return shows returns in progress beside what can still go back; nothing asked of the carrier");
}

// 2. The receipt's page: the timeline.
{
  const { ctx, page, errors } = await shopper();
  await page.locator("#homePage .h2-item", { hasText: "Sent back, on its way to Harlow & Co" }).first().click();
  const sh = sheet(page); await sh.locator(".rl-rt").waitFor();
  await page.waitForTimeout(500);
  const steps = await sh.locator(".rl-rt-step").evaluateAll(xs => xs.map(x => [x.classList.contains("done"), x.innerText.replace(/\s+/g, " ").trim()]));
  assert.deepEqual(steps, [[true, "Return started From Harlow & Co's email, " + shortDay(day(-6))], [true, "Sent back, on its way to Harlow & Co From Royal Mail, " + shortDay(day(-3))],
    [false, "Received by Harlow & Co"], [false, "Refund issued"]], "the steps in order, each with who said so and when");
  assert.match(await sh.locator(".rl-rt-tn").innerText(), /Tracking number KO123456789GB with Royal Mail/);
  assert.equal(await sh.locator(".rl-rt a.rl-ret-go").getAttribute("href"), "https://www.royalmail.com/track-your-item#/tracking-results/KO123456789GB");
  assert.equal(st.log.filter(l => /GET \/relay\/my\/receipts\/2222.*\/return-parcel/.test(l)).length, 1, "opening it asks the carrier once");
  assert.equal(await sh.locator("button", { hasText: "I've sent it back" }).count(), 0, "the carrier already has it: nothing to tell Relay");
  assert.deepEqual(await measure(page, ".rl-back:last-of-type .rl-sheet"), clean, "the receipt's page polish");
  await sh.evaluate(el => { el.scrollTop = 0; }); await page.waitForTimeout(200);
  await page.screenshot({ path: SHOTS + "/receipt-return-timeline.png" });
  await page.waitForTimeout(2500);
  assert.equal(st.log.filter(l => /return-parcel/.test(l)).length, 1, "and not again while it stays open (nothing on a timer)");
  await closeTop(page);
  // A refund not seen: what to do.
  await page.locator("#homePage .h2-item", { hasText: "Refund not seen yet" }).first().click();
  const s2 = sheet(page); await s2.locator(".rl-rt-nudge").waitFor();
  assert.match(await s2.locator(".rl-rt-nudge").innerText(), new RegExp("Refund not seen yet\\s+Glow Lab had your return on " + shortDay(day(-16)) + ", and Relay hasn't seen a refund email since\\. Contact Glow Lab with your order number, R-1111, and ask when they'll refund you\\."));
  assert.equal(await s2.locator(".rl-rt-nudge a").getAttribute("href"), "https://returns.glowlab.example/help");
  const s2steps = await s2.locator(".rl-rt-step").evaluateAll(xs => xs.map(x => x.innerText.replace(/\s+/g, " ").trim()));
  assert.deepEqual(s2steps, ["Return started", "Sent back You said, " + shortDay(day(-20)), "Received by Glow Lab From Glow Lab's email, " + shortDay(day(-16)), "Refund issued"]);
  assert.equal(st.log.filter(l => /1111.*return-parcel/.test(l)).length, 0, "no tracking number, or already at the shop: the carrier isn't asked");
  assert.deepEqual(await measure(page, ".rl-back:last-of-type .rl-sheet"), clean);
  await page.screenshot({ path: SHOTS + "/receipt-refund-not-seen.png" });
  allErrors.push(...errors); await ctx.close();
  console.log("ok - the receipt's page: the four steps in order with who said so and when, the tracking number and the carrier's link, Refund not seen yet with what to do; the carrier asked once on opening");
}

// 2b. Tracking not available: said plainly.
{
  reset({ parcel: { available: false } });
  const { ctx, page, errors } = await shopper();
  await page.locator("#homePage .h2-item", { hasText: "Sent back, on its way to Harlow & Co" }).first().click();
  const sh = sheet(page); await sh.locator(".rl-rt").waitFor();
  await sh.locator(".rl-rt-note", { hasText: "Relay can't follow the parcel with Royal Mail just now, so this shows what the emails and you said." }).waitFor();
  allErrors.push(...errors); await ctx.close();
  reset({ parcel: { available: true, reason: "limit" } });
  const b = await shopper();
  await b.page.locator("#homePage .h2-item", { hasText: "Sent back, on its way to Harlow & Co" }).first().click();
  await sheet(b.page).locator(".rl-rt-note", { hasText: "Relay can't check with Royal Mail again this month. You can still track it on Royal Mail's website." }).waitFor();
  allErrors.push(...b.errors); await b.ctx.close();
  console.log("ok - when live tracking is off or this month's checks are used up, the page says so plainly");
}

// 3. "I've sent it back".
{
  reset();
  const { ctx, page, errors } = await shopper();
  await page.locator(".h2-chip", { hasText: "To return" }).click(); await page.waitForTimeout(300);
  await page.locator("#homePage .hl-sq", { hasText: "Kick Lane" }).click();
  const sh = sheet(page); await sh.locator(".rl-rt").waitFor();
  await sh.locator("button", { hasText: "I've sent it back" }).click();
  const form = page.locator(".rl-sheet.rl-fix").last(); await form.waitFor();
  const carrierShown = () => form.locator(".rl-rt-pick[aria-label=\"Who's carrying it\"]").isVisible();
  assert.equal(await carrierShown(), false, "no number: nothing to ask about the carrier");
  await form.locator("#rl-rt-tn").fill("ko 1234 5678 9gb");
  assert.equal(await carrierShown(), false, "Royal Mail's format: not asked");
  await form.locator("#rl-rt-tn").fill("15501234567890");
  assert.equal(await carrierShown(), true, "a number whose format doesn't say: who's carrying it?");
  await form.locator(".rl-rt-pick button", { hasText: "DPD" }).click();
  assert.equal(await form.locator(".rl-rt-pick button[aria-pressed=true]", { hasText: "DPD" }).count(), 1);
  assert.equal(await form.locator(".rl-rt-pick button[aria-pressed=true]", { hasText: "Today" }).count(), 1, "today unless they say otherwise");
  assert.deepEqual(await measure(page, ".rl-sheet.rl-fix"), clean, "the form's polish");
  await page.screenshot({ path: SHOTS + "/sent-it-back-form.png" });
  // A refusal in plain words, then the save: one tap, once.
  st.sentReply = { status: 400, body: { error: "bad_date" } };
  await form.locator("button", { hasText: "Save" }).click();
  await form.locator(".rl-msg", { hasText: "Pick the day you sent it: today or earlier, and after you ordered." }).waitFor();
  st.sentReply = null; st.posts = [];
  await form.locator("button", { hasText: "Yesterday" }).click();
  await form.locator("button", { hasText: "Save" }).dblclick();
  await form.waitFor({ state: "detached" });
  await page.waitForTimeout(400);
  assert.equal(st.posts.length, 1, "a double tap saves once");
  assert.deepEqual(st.posts[0], { sentOn: day(-1), trackingNumber: "15501234567890", carrier: "DPD" }, "the number tidied, the carrier and the day");
  const steps = await sh.locator(".rl-rt-step").evaluateAll(xs => xs.map(x => x.innerText.replace(/\s+/g, " ").trim()));
  assert.deepEqual(steps, ["Return started", "Sent back, on its way to Kick Lane You said, " + shortDay(day(-1)), "Received by Kick Lane", "Refund issued"], "the timeline shows it at once");
  assert.ok(await sh.locator("button", { hasText: "Change what you told Relay" }).isVisible(), "and it can be changed");
  await page.screenshot({ path: SHOTS + "/sent-it-back-saved.png" });
  allErrors.push(...errors); await ctx.close();
  console.log("ok - I've sent it back: the carrier asked only when the number doesn't say, the day, plain words for a refusal, one save per tap, the timeline at once");
}
assert.deepEqual(allErrors, [], "no page errors");
await browser.close(); server.close();
console.log("PASS return tracking in the app: Home's Needs you and To return, the receipt's timeline with who said so, Refund not seen yet, I've sent it back, live tracking only on opening (stubbed server)");
