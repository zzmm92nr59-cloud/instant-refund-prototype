// Browser test: Home's For you (Connor chose it, 25 Nov 2026): "In progress" first, then shelves. Stubbed Relay server,
// made-up person; the shops are named as a shopper would see them, the orders are invented.
// Checks: what's moving leads (a return date this week, then returns going back, then parcels), each a card with its
// square, where it has got to and a bar of its steps lit only for the steps Relay has seen; more than four become one line;
// an order with part of it being sent back shows once (in progress, naming the part), never again on a shelf; Recent and
// Price drops are shelves of 140px squares; a photo fills its square, a logo sits whole on white, a takeaway is a drawing
// under the restaurant's name (never the delivery app's logo); everything else is one line that opens a sheet; the chips
// fit the phone whole (and with bigger text wrap rather than cut a word); More opens the rest of Relay; the tab bar never
// covers the last row; the polish rules; a new member gets a clear first step. RELAY_HOME_SHOTS=<folder>: screenshots.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeReady } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.RELAY_HOME_SHOTS || ""; if (SHOTS) await mkdir(SHOTS, { recursive: true });

const EMAIL = "sam.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const receipt = (id, shop, domain, items, ago, extra) => ({ id, status: "confirmed", kind: "receipt", retailer: { name: shop, domain }, orderRef: "R-" + id.slice(0, 4), orderDate: day(-ago),
  totalPence: items.reduce((t, i) => t + i.pricePence, 0), currency: "GBP", category: "fashion", returnable: true, items: items.map(i => ({ qty: 1, category: "fashion", ...i })), returns: { deadline: day(30 - ago) }, reminder: "off", ...extra });
const step = (s, done, at, from) => ({ step: s, done, at: at || null, from: from || null });
// The newest order: three things from On, one of them being sent back (the shopper said so; the shop hasn't had it yet).
const ON = receipt("11111111-1111-4111-8111-111111111111", "On", "on.com", [{ name: "Cloudsurfer Trail 2 Waterproof", variant: "UK 9", pricePence: 16000 }, { name: "Performance Run Sock", pricePence: 1800 }, { name: "Lightweight Cap", pricePence: 3500 }], 1,
  { itemReturns: { 0: "returning" }, returnTracking: { state: "started", steps: [step("started", true, day(0), { by: "you", name: null, via: "app" }), step("sent", false), step("received", false), step("refunded", false)] } });
// A takeaway through Just Eat, named after the restaurant.
const TAKEAWAY = receipt("22222222-2222-4222-8222-222222222222", "Just Eat", "just-eat.co.uk", ["Salt and Pepper Chips", "Crispy Duck", "Egg Fried Rice", "Spring Rolls", "Prawn Crackers", "Sweet and Sour Chicken", "Chow Mein"].map((name, i) => ({ name, pricePence: [450, 899, 350, 399, 250, 699, 566][i], category: "food" })), 2,
  { merchant: "East Ocean", category: "food", returnable: false, returns: null });
const LULU1 = receipt("33333333-3333-4333-8333-333333333333", "lululemon", "lululemon.com", [{ name: "Align High-Rise Pant 25\"", variant: "Black, 8", pricePence: 9800 }], 3, { hasImage: true, returns: { deadline: day(5) } });
const LULU2 = receipt("44444444-4444-4444-8444-444444444444", "lululemon", "lululemon.com", [{ name: "Define Jacket", pricePence: 11800 }, { name: "Swiftly Tech Short-Sleeve", pricePence: 5800 }], 6);
const BOOK = receipt("55555555-5555-4555-8555-555555555555", "Amazon", "amazon.co.uk", [{ name: "The Lighthouse Year (Paperback)", pricePence: 999, category: "books" }], 8, { category: "books", returns: { deadline: day(22) } });
// A parcel on its way, and an older return already refunded.
const PARCEL = receipt("66666666-6666-4666-8666-666666666666", "Northfold", null, [{ name: "Flow Flared Pant", variant: "UK 8", pricePence: 6900 }], 2, { hasImage: true, returns: null, delivery: { status: "shipped", carrier: "Royal Mail", at: day(-1) } });
const REFUNDED = receipt("77777777-7777-4777-8777-777777777777", "Harlow & Co", null, [{ name: "Wool Coat", pricePence: 12000 }], 20, { hasImage: true, returns: null,
  returnTracking: { state: "refunded", steps: [step("started", true, day(-12)), step("sent", true, day(-10)), step("received", true, day(-6)), { ...step("refunded", true, day(-4)), amountPence: 12000, currency: "GBP" }] } });
// A return at the shop whose start Relay never saw (the shopper said they sent it; the shop emailed when it arrived).
const GLOW = receipt("88888888-8888-4888-8888-888888888888", "Glow Lab", null, [{ name: "Vitamin C Serum", pricePence: 2400, category: "beauty" }], 12, { returns: null,
  returnTracking: { state: "received", steps: [{ step: "started", done: false, at: null, from: null, missed: true }, step("sent", true, day(-5), { by: "you", name: null, via: "app" }), step("received", true, day(-2), { by: "shop", name: "Glow Lab", via: "email" }), step("refunded", false)] } });
// A parcel only expected (the order email gave a day): sent isn't lit.
const DUE = receipt("99999999-9999-4999-8999-999999999999", "Kick Lane", null, [{ name: "Court Classic Trainers", pricePence: 8500 }], 1, { returns: null, delivery: { status: "due", at: day(2) } });
const RECEIPTS = [ON, TAKEAWAY, LULU1, LULU2, BOOK, PARCEL, REFUNDED, GLOW, DUE];
const NEED = ["Pret A Manger", "Boots", "Tesco Express", "Waterstones", "Caffe Nero"].map((shop, i) => ({ id: "pay-" + i, shop, amountPence: [645, 1299, 2210, 1599, 420][i], currency: "GBP", date: day(-2 - i), account: "Current account" }));
const PHOTO = { "33333333": "gym-leggings.png", "66666666": "slim-chinos.png", "77777777": "wool-coat.png" };
// A watched Nike bag whose price has dropped (kept on the phone as Relay keeps a watched thing from a shop's website).
const WATCH = { "web:nike.com:duffel": { name: "Academy Hardcase Football Duffel Bag (Medium, 60L)", variant: "", baseline: 4500, now: 3500, real: true, store: "Nike", dom: "nike.com", image: "https://img.example/duffel.png", created: day(-9) + "T10:00:00Z" } };

let NEW = false;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await skipInterests(ctx);
await ctx.addInitScript(([e, w]) => { try { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); if (localStorage.getItem("test-new")) localStorage.removeItem("relay-radar-v2"); else localStorage.setItem("relay-radar-v2", JSON.stringify(w)); } catch (x) {} }, [EMAIL, WATCH]);
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (u.hostname === "img.example") return route.fulfill({ status: 200, contentType: "image/png", body: await readFile(resolve(root, "pics/products/sports-holdall.png")) });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  const img = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/image$/.exec(p);
  if (img) { const f = PHOTO[img[1].slice(0, 8)]; return f ? route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: await readFile(resolve(root, "pics/products/" + f)) }) : route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" }); }
  if (p === "/relay/auth/providers") return j({ google: true, microsoft: true, consent: { version: "v5", text: ["To work, Relay needs to see your receipts."] } });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true });
  if (p === "/relay/my/gmail") return j(NEW ? { connected: false } : { connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 6e5 });
  if (p === "/relay/my/receipts") return j(NEW ? { receipts: [], needReceipt: [] } : { receipts: RECEIPTS, needReceipt: NEED });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Tester", photo: null, aiNotice: !NEW });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
const shot = async (name) => {
  if (!SHOTS) return;
  await page.locator("#homePage .h2-art img").evaluateAll(is => Promise.all(is.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 2000); }))));
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250);
  await page.screenshot({ path: SHOTS + "/" + name + "-1.png" });
  await page.evaluate(() => window.scrollTo(0, Math.min(document.documentElement.scrollHeight - innerHeight, Math.round(innerHeight * 0.8)))); await page.waitForTimeout(350);
  await page.screenshot({ path: SHOTS + "/" + name + "-2.png" });
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(150);
};
// The polish rules on Home's feed (as test-home-look-ui.mjs measures them).
const measure = () => page.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0.5; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; };
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [] }, scope = "#homePage";
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " [role=button]")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    if (px < 13 && !(s.textTransform === "uppercase" && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    const back = bgOf(el), a = lum(flat(rgb(s.color), back)), b = lum(back), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
});

const open = async (q) => { await page.goto(origin + "/index.html" + (q || "")); await homeReady(page); await page.locator("#homePage .h2-feed .rl-skel").first().waitFor({ state: "detached" }).catch(() => {}); await page.waitForTimeout(900); };
const feedText = () => page.locator("#homePage .h2-feed").innerText();
const closeTop = async () => { const back = page.locator(".rl-back").last(); await back.click({ position: { x: 10, y: 10 } }); await back.waitFor({ state: "detached" }); await page.waitForTimeout(450); };
const clean = { small: [], tiny: [], symbols: [], faint: [], wide: [] };

// 1. In progress, then shelves.
await open();
const heads = await page.locator("#homePage .hx-h").allInnerTexts();
assert.deepEqual(heads, ["In progress", "Recent", "Price drops"]);
const live = await page.locator("#homePage .hx-live").evaluateAll(cs => cs.map(c => c.getAttribute("aria-label")));
assert.equal(live.length, 4, "four cards at most: " + JSON.stringify(live));
assert.match(live[0], /^lululemon\. Align High-Rise Pant 25"\. 5 days to return\. Return by /, "a return closing this week first");
assert.match(live[1], /^On\. Cloudsurfer Trail 2 Waterproof\. Sending back\. Next: post it back$/, "the On return names the part going back: " + live[1]);
assert.match(live[2], /^Glow Lab\. Vitamin C Serum\. At the shop\. Next: your refund$/);
assert.match(live[3], /^Kick Lane\. Court Classic Trainers\. Arriving /, "then parcels, newest first");
// The steps: lit only for what Relay has seen.
const bars = await page.locator("#homePage .hx-live").evaluateAll(cs => cs.map(c => [...c.querySelectorAll(".hx-bar i")].map(i => i.classList.contains("on") ? 1 : 0).join("")));
assert.deepEqual(bars, ["", "1000", "0110", "100"], "no bar for a return date; On started only; Glow Lab's missed start stays unlit; a parcel only expected isn't sent");
assert.equal(await page.locator("#homePage .hx-live .hx-bar").nth(1).getAttribute("aria-label"), "Sent back, At the shop", "the bar says the steps seen");
// The fifth is one line that opens the rest.
const more = page.locator("#homePage .hx-note", { hasText: "1 more thing in progress" });
assert.match(await more.innerText(), /Northfold/);
await more.click(); let sh = page.locator(".rl-back .rl-sheet").last(); await sh.waitFor();
assert.match(await sh.innerText(), /Northfold\s+On its way/); await closeTop();
// Each thing once: nothing in progress is on a shelf again.
const squares = await page.locator("#homePage .hx-shelf .hx-sq").evaluateAll(cs => cs.map(c => c.getAttribute("aria-label")));
assert.equal((await feedText()).match(/Cloudsurfer/g).length, 1, "the On order once");
for (const shop of ["On.", "Glow Lab.", "Northfold.", "Kick Lane.", "lululemon. Align"]) assert.ok(!squares.some(s => s.startsWith(shop)), shop + " isn't on a shelf too: " + JSON.stringify(squares));
assert.match(squares[0], /^East Ocean/, "Recent: newest first");
assert.ok(squares.some(s => /^Harlow & Co\. Wool Coat\. £120\.00\. Refunded$/.test(s)), "a finished return is a purchase with its outcome");
// The takeaway: the restaurant, the app it came through said plainly, a drawing (not the app's logo).
const eo = page.locator("#homePage .hx-sq", { hasText: "East Ocean" });
assert.equal(await eo.locator(".hx-sq-n").innerText(), "Ordered on Just Eat");
assert.equal(await eo.locator("img.rl-logo-img").count(), 0, "never the delivery app's logo over the restaurant");
// Rule 16: 140px squares; a photo fills its square; a logo sits whole on white.
const sizes = await page.locator("#homePage .hx-pic").evaluateAll(ps => [...new Set(ps.map(p => Math.round(p.getBoundingClientRect().width) + "x" + Math.round(p.getBoundingClientRect().height)))]);
assert.deepEqual(sizes, ["140x140"]);
const photo = await page.locator("#homePage .hx-live", { hasText: "Align" }).locator(".h2-art img").evaluate(i => { const a = i.getBoundingClientRect(), b = i.closest(".hx-pic").getBoundingClientRect(); return [Math.round(a.width - b.width), Math.round(a.height - b.height), getComputedStyle(i).objectFit]; });
assert.deepEqual(photo, [0, 0, "cover"], "the photo fills its square");
const logo = page.locator("#homePage .hx-sq", { hasText: "Define Jacket" }).locator("img.rl-logo-img");
await logo.waitFor();
const lg = await logo.evaluate(i => { const a = i.getBoundingClientRect(), b = i.closest(".hx-pic").getBoundingClientRect(); return { inside: a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom, fit: getComputedStyle(i).objectFit, back: getComputedStyle(i.parentElement).backgroundColor }; });
assert.deepEqual(lg, { inside: true, fit: "contain", back: "rgb(255, 255, 255)" }, "the logo whole, on white");
// Price drops: the watched bag, its price now and before.
assert.match(await page.locator("#homePage .hx-shelf").nth(1).innerText(), /Nike[\s\S]*£35\.00\s*£45\.00/);
// Everything else, one line and one sheet.
const also = page.locator("#homePage .hx-needs");
assert.match(await also.innerText(), /5 shop payments with no receipt\s+And 1 more thing/);
await also.click(); sh = page.locator(".rl-back .rl-sheet").last(); await sh.waitFor();
assert.match(await sh.innerText(), /5 shop payments with no receipt[\s\S]*AI help is now on/); await closeTop();
// A card opens its page.
await page.locator("#homePage .hx-live", { hasText: "Cloudsurfer" }).click(); await page.locator(".rl-back .rl-sheet").last().waitFor(); await closeTop();
assert.deepEqual(await measure(), clean, "polish");
assert.deepEqual(errors, []);
console.log("ok - In progress first (a return date this week, returns, parcels), steps lit only when seen, the fifth behind one line, each thing once, shelves of 140px squares, photos fill, logos whole on white, the rest behind one line");

// 2. The chips fit the phone whole; with bigger text they wrap, never cut a word; More opens the rest of Relay.
assert.deepEqual(await page.locator("#view .h2-chip").allInnerTexts(), ["For you", "Watching", "Returns", "More"]);
const cut = () => page.evaluate(() => [...document.querySelectorAll("#view .h2-chip")].filter(c => { const r = c.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; }).map(c => c.innerText));
assert.deepEqual(await cut(), [], "every chip whole on a 390pt phone");
await page.evaluate(() => { for (const e of document.querySelectorAll("#view .h2-chip span")) e.style.setProperty("font-size", parseFloat(getComputedStyle(e).fontSize) * 1.3 + "px", "important"); });
assert.deepEqual(await cut(), [], "and with bigger text");
await page.evaluate(() => { for (const e of document.querySelectorAll("#view .h2-chip span")) e.style.removeProperty("font-size"); });
await page.waitForTimeout(450);
await page.locator("#view .h2-chip", { hasText: "More" }).click(); sh = page.locator(".rl-back .rl-sheet").last(); await sh.waitFor();
for (const n of ["Swap & resell", "Auctions", "Shops on Relay", "Wrapped"]) await sh.locator(".rl-arow", { hasText: n }).waitFor();
await closeTop();
// The tab bar never covers the last row.
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400);
const gap = await page.evaluate(() => { const last = document.querySelector("#homePage .hx-all").getBoundingClientRect(), bar = document.querySelector("#foot").getBoundingClientRect(); return Math.round(bar.top - last.bottom); });
assert.ok(gap >= 8, "All receipts clears the tab bar: " + gap);
await page.evaluate(() => window.scrollTo(0, 0));
await shot("home");
console.log("ok - four chips, whole on the phone and with bigger text; More has the rest of Relay; the tab bar clears the last row");

// 3. Bigger text: nothing wider than the phone, every tap target still at least 44.
await page.evaluate(() => { for (const e of document.querySelectorAll("#homePage *")) e.style.setProperty("font-size", parseFloat(getComputedStyle(e).fontSize) * 1.3 + "px", "important"); });
await page.waitForTimeout(300);
const big = await measure();
assert.deepEqual([big.small, big.tiny, big.wide], [[], [], []], "bigger text");
console.log("ok - bigger text");

// 4. A new member: a clear first step.
NEW = true;
await ctx.clearCookies(); await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k !== "relay.session.v1" && !/^relay\.(tips|interests)/.test(k)) localStorage.removeItem(k); localStorage.setItem("test-new", "1"); });
await open();
const start = page.locator("#homePage .h2-start");
await start.getByRole("heading", { name: "Bring in your receipts" }).waitFor();
await start.getByRole("button", { name: "Connect your email" }).waitFor();
assert.equal(await page.locator("#homePage .hx-live, #homePage .hx-sq").count(), 0, "nothing made up");
assert.deepEqual(await measure(), clean, "polish, new member");
if (SHOTS) { await page.screenshot({ path: SHOTS + "/new-member.png" }); }
console.log("ok - a new member's Home says what to do first");
assert.deepEqual(errors, []);
await browser.close(); server.close();
console.log("PASS Home: In progress, then shelves");
