// Browser test: Home's three trial layouts (A calm, B feed, C now), for Relay's team only, against today's Home.
// Stubbed Relay server, made-up person; the shops are named as the shopper would see them, the orders are invented.
// Checks: an order being sent back stays among the purchases on Home (with where its return has got to), on today's Home
// and on each trial; ?home=a|b|c does nothing without testing tools; each trial passes the polish rules (tap targets, text
// sizes, no symbol icons, readable, nothing wider than the phone); every card opens its page; the "needs you" sheet lists
// the rest. With RELAY_HOME_SHOTS=<folder>, phone screenshots (390 x 844 at 2x) of each: <name>-1.png (top), <name>-2.png
// (scrolled).
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
const RECEIPTS = [ON, TAKEAWAY, LULU1, LULU2, BOOK, PARCEL, REFUNDED];
const NEED = ["Pret A Manger", "Boots", "Tesco Express", "Waterstones", "Caffe Nero"].map((shop, i) => ({ id: "pay-" + i, shop, amountPence: [645, 1299, 2210, 1599, 420][i], currency: "GBP", date: day(-2 - i), account: "Current account" }));
const PHOTO = { "33333333": "gym-leggings.png", "66666666": "slim-chinos.png", "77777777": "wool-coat.png" };
// A watched Nike bag whose price has dropped (kept on the phone as Relay keeps a watched thing from a shop's website).
const WATCH = { "web:nike.com:duffel": { name: "Academy Hardcase Football Duffel Bag (Medium, 60L)", variant: "", baseline: 4500, now: 3500, real: true, store: "Nike", dom: "nike.com", image: "https://img.example/duffel.png", created: day(-9) + "T10:00:00Z" } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await skipInterests(ctx);
await ctx.addInitScript(([e, w]) => { try { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); localStorage.setItem("relay-radar-v2", JSON.stringify(w)); } catch (x) {} }, [EMAIL, WATCH]);
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
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 6e5 });
  if (p === "/relay/my/receipts") return j({ receipts: RECEIPTS, needReceipt: NEED });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Tester", photo: null, aiNotice: true });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
const shot = async (name) => {
  if (!SHOTS) return;
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
const open = async (q) => { await page.goto(origin + "/index.html" + q); await homeReady(page); await page.locator("#homePage .h2-feed .rl-skel").first().waitFor({ state: "detached" }).catch(() => {}); await page.waitForTimeout(900); };
const feedText = () => page.locator("#homePage .h2-feed").innerText();
const closeTop = async () => { const back = page.locator(".rl-back").last(); await back.click({ position: { x: 10, y: 10 } }); await back.waitFor({ state: "detached" }); await page.waitForTimeout(450); };

// 1. Today's Home: the On order (newest, one of its three things being sent back) is among the purchases, saying so.
await open("");
await shot(process.env.RELAY_HOME_NOW || "today");
assert.equal(await page.locator("#homePage .hx").count(), 0, "today's Home is unchanged by the trials");
const onSq = page.locator("#homePage .hl-sq", { hasText: "On" }).filter({ hasText: "3 items" });
await onSq.first().waitFor();
assert.match(await onSq.first().innerText(), /1 of 3 going back/, "with where its return has got to");
const recentFirst = await page.locator("#homePage .hl-grid").last().locator(".hl-sq").first().getAttribute("aria-label");
assert.match(recentFirst, /^On\b/, "the newest purchase leads Recent: " + recentFirst);
assert.deepEqual(await measure(), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, "today's Home");
// The trials are for Relay's team: without testing tools, ?home=a is today's Home.
await open("?home=a");
assert.equal(await page.locator("#homePage .hx").count(), 0, "no trial without testing tools");
console.log("ok - today's Home keeps an order being sent back among the purchases, newest first, with its return's state");

// 2. Each trial, with testing tools.
for (const [k, name] of [["a", "calm"], ["b", "feed"], ["c", "now"]]) {
  await open("?testtools=1&home=" + k);
  await page.locator("#homePage .hx.hx-" + k).waitFor();
  const text = await feedText();
  assert.match(text, /Sending back|going back/, k + ": the On return says where it has got to");
  assert.match(text, /East Ocean/, k + ": the takeaway is named after the restaurant");
  assert.ok(!/Just Eat, 7 items/.test(text), k + ": never the app glued to a count");
  assert.ok(!/Cloudsurfer Trail 2 Waterproof[\s\S]{0,80}Cloudsurfer Trail 2 Waterproof/.test(text), k + ": the item's name once, not twice in a row");
  assert.deepEqual(await measure(), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, "trial " + k);
  assert.ok(errors.length === 0, errors.join("\n"));
  await shot(k);
  // The On order opens its page.
  await page.locator("#homePage .hx [data-hx=o]", { hasText: "On" }).first().click();
  await page.locator(".rl-back .rl-sheet").last().waitFor(); await closeTop();
  // What needs you, all of it, a tap away (A's strip, C's "Also" row; B shows it in the feed).
  if (k !== "b") {
    await page.locator("#homePage .hx-needs").first().click();
    const sh = page.locator(".rl-back .rl-sheet").last(); await sh.waitFor();
    assert.match(await sh.innerText(), /shop payments with no receipt[\s\S]*AI help is now on/, k + ": the rest in one sheet");
    await closeTop();
  }
  console.log("ok - trial " + k + " (" + name + "): purchases first, the return's state on its card, polish rules, cards open their pages");
}
assert.deepEqual(errors, []);
await browser.close(); server.close();
console.log("ok - Home trials");
