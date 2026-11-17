// Browser test: what Home leads with (Settings, Home layout, "What Home shows first"). Stubbed Relay server, a made-up
// person and invented shops.
// Checks:
//  1. Receipts first (the default): "Needs you" at the top with only what really needs the shopper, most urgent first
//     (a return with 2 days left, one with 6, an inbox to connect again, a bank payment with no receipt), each one small
//     card that opens its page; then "On the way", then "Recent" (Wallet squares, or Cards). Nothing urgent: one calm line.
//  2. Orders first: "Your orders" from shops on Relay, each with where it has got to (on its way, from the shop's own
//     email; return started), opening its page with what can be done and Track your parcel; then "Shops on Relay" (the
//     shops bought from, and All shops); then other receipts, compact. A test shop's order only with testing tools.
//     Without orders from shops on Relay: a first step, never an empty screen and never a made-up order.
//  3. Switching: in Settings (kept on this phone as relay-home-focus) and with ?focus= (tried, not kept), at any time,
//     independent of Wallet or Cards.
//  4. The polish rules on both, in Wallet and Cards; and switching asks Relay's server for nothing more.
// Screenshots go to RELAY_FOCUS_SHOTS (or /tmp/shots).
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeReady, openAccountRow, goTab, waitOutDoubleTap } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.RELAY_FOCUS_SHOTS || "/tmp/shots"; await mkdir(SHOTS, { recursive: true });

const EMAIL = "sam.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const shortDay = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const receipt = (id, shop, item, pence, ago, extra) => ({ id, status: "pending", kind: "receipt", retailer: { name: shop, domain: null }, orderRef: "R-" + id.slice(0, 4), orderDate: day(-ago), totalPence: pence, currency: "GBP",
  category: "fashion", returnable: true, items: [{ name: item, qty: 1, pricePence: pence, category: "fashion" }], returns: null, ...extra });
const SERUM = receipt("11111111-1111-4111-8111-111111111111", "Glow Lab", "Vitamin C Serum", 2400, 26, { returns: { windowDays: 28, deadline: day(2) } });
const COAT = receipt("22222222-2222-4222-8222-222222222222", "Harlow & Co", "Wool Coat", 12000, 24, { returns: { windowDays: 30, deadline: day(6), portalUrl: "https://returns.harlow.example/start" } });
const PANT = receipt("33333333-3333-4333-8333-333333333333", "Northfold", "Flow Flared Pant", 6900, 4, { delivery: { status: "shipped", carrier: "Royal Mail", at: day(-2) } });
const SHOES = receipt("44444444-4444-4444-8444-444444444444", "Kick Lane", "Court Classic Trainers", 8500, 2, { returns: { deadline: day(12) } });
const PODS = receipt("55555555-5555-4555-8555-555555555555", "Nespresso", "Vertuo Pods", 4200, 0, { category: "food", returnable: false, items: [{ name: "Vertuo Pods", qty: 1, pricePence: 4200, category: "food" }] });
// Fernway's own email about the order below (same shop, same amount): it's on its way with Evri.
const SHIP = receipt("66666666-6666-4666-8666-666666666666", "Fernway", "Linen Overshirt", 4800, 3, { delivery: { status: "shipped", carrier: "Evri", trackingNumber: "H01ABC123", at: day(-1) } });
const HM = { id: "77777777-7777-4777-8777-777777777777", account: "Current account", date: day(-5), amountPence: 3499, currency: "GBP", shop: "H&M", photoRead: true };
const order = (id, store, title, minor, ago, item = {}, extra = {}) => ({ id, store, retailer: "shopify:" + store.toLowerCase().replace(/\W+/g, "-") + ".myshopify.com", orderedAt: new Date(Date.now() - ago * 864e5).toISOString(),
  amountMinor: minor, currency: "GBP", status: "unverified", items: [{ title, lineId: "L-" + id, quantity: 1, priceMinor: minor, currency: "GBP", variant: "M", productId: "1", variantId: "11", returnable: true, exchangeable: true,
    returnBy: { date: day(30 - ago) }, ...item }], ...extra });
const ORDERS = [
  order("shopify:fernway.myshopify.com:order:1001", "Fernway", "Linen Overshirt", 4800, 3),
  order("shopify:kiln-road.myshopify.com:order:2002", "Kiln Road", "Stoneware Mug", 1800, 9, { returnable: false, exchangeable: false, returnInfo: { status: "requested", ref: "KR-55" } }),
  // One of Relay's own test shops: only with testing tools on (the stand-in sends it even without, as an old copy could).
  order("square:LTEST:order:3003", "Relay Test Shop", "Sample Tote", 2500, 1, {}, { test: true }),
];
let st;
const reset = (o = {}) => { st = { receipts: [SERUM, COAT, PANT, SHOES, PODS, SHIP], orders: ORDERS, needReceipt: [HM], reconnect: true, log: [], ...o }; };
reset();
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const browser = await chromium.launch();
async function shopper({ look = null, focus = null, path = "/index.html" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" }); await skipInterests(ctx);
  await ctx.addInitScript(([e, l, f]) => { try {
    localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 }));
    if (l) localStorage.setItem("relay-home-look", l); if (f && !localStorage.getItem("relay-focus-set")) { localStorage.setItem("relay-home-focus", f); localStorage.setItem("relay-focus-set", "1"); }
  } catch (x) {} }, [EMAIL, look, focus]);
  await ctx.route("https://**/*", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith("/relay/")) return route.abort();
    st.log.push(m + " " + p + u.search);
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
    if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 6e5, others: st.reconnect ? [{ provider: "microsoft", email: "sam@outlook.example", needsReconnect: true }] : [] });
    if (p === "/relay/my/receipts") return j({ receipts: st.receipts, needReceipt: st.needReceipt });
    if (p === "/relay/my/purchases") return j({ purchases: st.orders });
    if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Tester", photo: null });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [] });
    return j({});
  });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(origin + path);
  await homeReady(page);
  await page.locator("#homePage .h2-sec").first().waitFor();
  await page.waitForTimeout(700);
  return { ctx, page, errors };
}
const heads = page => page.locator("#homePage .h2-feed > .h2-sec").allInnerTexts();
// What's under a heading: the feed's children after it, up to the next heading.
const under = (page, name) => page.evaluate(name => {
  const kids = [...document.querySelectorAll("#homePage .h2-feed > *")], at = kids.findIndex(k => k.classList.contains("h2-sec") && k.textContent === name), out = [];
  if (at < 0) return null;
  for (const k of kids.slice(at + 1)) { if (k.classList.contains("h2-sec")) break; out.push(k); }
  return out.map(k => k.matches(".hl-grid, .hl-list, .rl-ys-row") ? [...k.children].map(c => c.getAttribute("aria-label") || c.innerText.replace(/\s+/g, " ").trim()) : [k.getAttribute("aria-label") || k.innerText.replace(/\s+/g, " ").trim()]).flat();
}, name);

// The polish rules (as scripts/test-home-look-ui.mjs measures them) on what's showing, plus Home's own: no "A · B · C",
// no buttons on a card, and the page never wider than the phone.
const measure = page => page.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0.5; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; };
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], dots: [], cardButtons: [], wide: [] };
  for (const el of document.querySelectorAll("#view button, #view a, #view [role=button]")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓]|\p{Extended_Pictographic}/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll("#view *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    if (px < 13 && !(s.textTransform === "uppercase" && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    const back = bgOf(el), a = lum(flat(rgb(s.color), back)), b = lum(back), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  if (/ · /.test(document.querySelector("#homePage .h2-feed").innerText)) out.dots.push("·");
  for (const c of document.querySelectorAll("#homePage .h2-item, #homePage .hl-sq, #homePage .hl-row")) if (c.querySelector("button, a")) out.cardButtons.push(c.innerText.slice(0, 30));
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
});
const polished = async (page, where) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(120);
    assert.deepEqual(await measure(page), { small: [], tiny: [], symbols: [], faint: [], dots: [], cardButtons: [], wide: [] }, where + " (" + scheme + ")");
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const shot = async (page, name) => {
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250);
  await page.screenshot({ path: SHOTS + "/" + name + ".png" });
  await page.screenshot({ path: SHOTS + "/" + name + "-full.png", fullPage: true });
};
const close = async page => { await page.waitForTimeout(450); const back = page.locator(".rl-back").last(); await back.click({ position: { x: 10, y: 10 } }); await back.waitFor({ state: "detached" }); };
const allErrors = [];

// 1. Receipts first, the default: urgent things first, then on the way, then the latest.
{
  const { ctx, page, errors } = await shopper();
  assert.equal(await page.evaluate(() => localStorage.getItem("relay-home-focus")), null, "nothing chosen yet");
  assert.deepEqual(await heads(page), ["Needs you", "On the way", "Recent"]);
  const needs = await under(page, "Needs you");
  assert.equal(needs.length, 4, "only what really needs the shopper: " + JSON.stringify(needs));
  assert.match(needs[0], /^Vitamin C Serum\. 2 days left$/, "the return closing soonest first");
  assert.match(needs[1], /^Wool Coat\. 6 days left$/);
  assert.equal(needs[2], "Connect Outlook again");
  assert.match(needs[3], /^H&M, £34\.99 on /, "the bank payment with no receipt");
  const serum = page.locator("#homePage .h2-feed > .h2-item.small", { hasText: "Vitamin C Serum" });
  assert.equal(await serum.locator(".h2-line-t span").innerText(), "Return to Glow Lab by " + shortDay(day(2)));
  assert.equal(await serum.locator(".h2-strip").getAttribute("class"), "h2-strip urgent", "red in the last three days");
  assert.equal(await page.locator("#homePage .h2-feed > .h2-item.small", { hasText: "Wool Coat" }).locator(".h2-strip").getAttribute("class"), "h2-strip soon", "amber in the last week");
  assert.deepEqual(await under(page, "On the way"), ["Northfold. Flow Flared Pant. £69.00. On its way"], "the parcel on its way");
  const recent = await under(page, "Recent");
  assert.ok(recent.some(t => /Court Classic Trainers/.test(t)) && recent.some(t => /Vertuo Pods/.test(t)) && recent.some(t => /Linen Overshirt/.test(t)), "the latest: " + JSON.stringify(recent));
  assert.ok(!recent.some(t => /Vitamin C Serum|Wool Coat|Flow Flared Pant/.test(t)), "each thing once: what's above isn't repeated");
  assert.ok(!(await page.locator("#homePage .h2-feed").innerText()).includes("Sample Tote"), "no test shop order without testing tools");
  assert.ok(await page.locator("#homePage .h2-feed > .hl-grid").count() >= 2, "Wallet squares (the default look)");
  // A small card is one tap: it opens the thing's own page, with what can be done.
  await waitOutDoubleTap(page);
  await page.locator("#homePage .h2-feed > .h2-item.small", { hasText: "Wool Coat" }).click();
  const sheet = page.locator(".rl-back .rl-sheet").last(); await sheet.waitFor();
  assert.deepEqual(await sheet.locator(".rl-dt-acts button").allInnerTexts(), ["Start return", "I'm sending this back"]);
  await close(page);
  await polished(page, "receipts first, wallet");
  await shot(page, "receipts-first-wallet");
  // The same in Cards.
  await page.evaluate(() => { localStorage.setItem("relay-home-look", "cards"); window.go("receipts"); }); await page.evaluate(() => window.go("profile"));
  await page.locator("#homePage .h2-feed > .h2-item:not(.small)").first().waitFor();
  assert.deepEqual(await heads(page), ["Needs you", "On the way", "Recent"], "the same parts in Cards");
  assert.equal(await page.locator("#homePage .h2-feed > .hl-grid").count(), 0);
  await polished(page, "receipts first, cards");
  await shot(page, "receipts-first-cards");
  allErrors.push(...errors); await ctx.close();
}
// Nothing urgent: one calm line, never something made up.
{
  reset({ receipts: [SHOES, PODS], needReceipt: [], reconnect: false, orders: [] });
  const { ctx, page, errors } = await shopper();
  assert.deepEqual(await heads(page), ["Needs you", "Recent"]);
  assert.equal(await page.locator("#homePage .h2-feed > .h2-sec + .h2-calm").innerText(), "Nothing needs you right now.");
  assert.equal(await page.locator("#homePage .h2-feed > .h2-item.small:not(:last-child)").count(), 0, "no urgent cards (only All receipts at the end)");
  await polished(page, "receipts first, nothing urgent");
  await shot(page, "receipts-first-calm");
  allErrors.push(...errors); await ctx.close();
}
console.log("ok - Receipts first (the default): Needs you, most urgent first, one small card each that opens its page; then On the way and Recent, each thing once; a calm line when nothing needs you; polished in Wallet and Cards");

// 2. Orders first, chosen in Settings: orders from shops on Relay with where they've got to, the shops, then the rest.
reset();
{
  const { ctx, page, errors } = await shopper();
  await openAccountRow(page, "Home layout");
  const row = name => page.locator("#mePage .rl-arow:visible", { hasText: name }).first();
  assert.equal(await row("Receipts first").getAttribute("aria-pressed"), "true", "Receipts first is ticked to begin with");
  assert.equal(await row("Wallet").getAttribute("aria-pressed"), "true", "and Wallet, the other choice, separately");
  await row("Orders first").click();
  await page.getByText("Orders first is on your Home now.").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("relay-home-focus")), "orders", "kept on this phone");
  assert.equal(await page.evaluate(() => localStorage.getItem("relay-home-look")), null, "the look is left as it was");
  await page.waitForTimeout(700);
  await openAccountRow(page, "Home layout");
  assert.equal(await row("Orders first").getAttribute("aria-pressed"), "true", "ticked when Home layout is opened again");
  assert.equal(await row("Receipts first").getAttribute("aria-pressed"), "false");
  await goTab(page, "Home");
  await page.locator("#homePage .h2-sec", { hasText: "Your orders" }).waitFor();
  assert.deepEqual(await heads(page), ["Your orders", "Shops on Relay", "Other receipts"]);
  const ords = await under(page, "Your orders");
  assert.deepEqual(ords, ["Fernway. Linen Overshirt. £48.00. On its way", "Kiln Road. Stoneware Mug. £18.00. Return started"], "each order with where it has got to");
  assert.deepEqual(await under(page, "Shops on Relay"), ["Fernway", "Kiln Road", "All shops on Relay"], "the shops bought from, and all of them");
  const others = await under(page, "Other receipts");
  assert.equal(others[0], "Connect Outlook again"); assert.match(others[1], /^H&M, £34\.99 on /);
  assert.ok(others.some(t => /^Glow Lab\. Vitamin C Serum\. .*2 days left/.test(t)), "other shops' receipts, compact: " + JSON.stringify(others));
  assert.ok(!others.some(t => /Linen Overshirt/.test(t)), "Fernway's own email is the order above, not a second receipt");
  assert.equal(await page.locator("#homePage .h2-feed > .hl-list .hl-row").count(), 5, "five of them, then All receipts");
  assert.ok(!(await page.locator("#homePage .h2-feed").innerText()).includes("Sample Tote"), "no test shop order without testing tools");
  // The order's page: where it is, what can be done now, and the parcel.
  await page.locator("#homePage .hl-sq", { hasText: "Linen Overshirt" }).click();
  const sheet = page.locator(".rl-back .rl-sheet").last(); await sheet.waitFor();
  assert.equal(await sheet.locator("h2").first().innerText(), "Fernway");
  assert.equal(await sheet.locator(".rl-po-now").innerText(), "On its way");
  await sheet.getByRole("button", { name: "Track your parcel" }).waitFor();
  await polished(page, "the order's page");
  await sheet.getByRole("button", { name: "Track your parcel" }).click();
  await page.locator(".rl-back .rl-sheet", { hasText: "Linen Overshirt" }).first().waitFor();
  await close(page);
  await polished(page, "orders first, wallet");
  await shot(page, "orders-first-wallet");
  // Cards: the same parts, the orders as big cards with their line.
  await page.evaluate(() => { localStorage.setItem("relay-home-look", "cards"); window.go("receipts"); }); await page.evaluate(() => window.go("profile"));
  await page.locator("#homePage .h2-feed > .h2-item:not(.small)").first().waitFor();
  assert.deepEqual(await heads(page), ["Your orders", "Shops on Relay", "Other receipts"]);
  assert.equal(await page.locator("#homePage .h2-feed > .h2-item", { hasText: "Linen Overshirt" }).locator(".h2-line-t b").innerText(), "On its way");
  await polished(page, "orders first, cards");
  await shot(page, "orders-first-cards");
  // All shops opens Shops on Relay.
  await page.locator("#homePage .rl-ys-shop", { hasText: "All shops" }).click();
  await page.waitForFunction(() => window.page === "discover");
  // ?focus=receipts tries the other one without changing what was chosen.
  await page.goto(origin + "/index.html?focus=receipts"); await homeReady(page); await page.locator("#homePage .h2-sec").first().waitFor();
  assert.equal((await heads(page))[0], "Needs you", "?focus=receipts shows Receipts first");
  assert.equal(await page.evaluate(() => localStorage.getItem("relay-home-focus")), "orders", "and keeps what was chosen");
  // And back to Receipts first in Settings, at any time.
  await openAccountRow(page, "Home layout");
  await row("Receipts first").click(); await page.getByText("Receipts first is on your Home now.").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("relay-home-focus")), "receipts");
  allErrors.push(...errors); await ctx.close();
}
// ?focus=orders on a phone that never chose.
{
  const { ctx, page, errors } = await shopper({ path: "/index.html?focus=orders" });
  assert.equal((await heads(page))[0], "Your orders");
  assert.equal(await page.evaluate(() => localStorage.getItem("relay-home-focus")), null, "?focus= isn't kept");
  allErrors.push(...errors); await ctx.close();
}
// With testing tools on, the test shop's order is there too (on Orders first only, as Home's other cards never show it).
{
  const { ctx, page, errors } = await shopper({ focus: "orders", path: "/index.html?testtools=1" });
  assert.ok((await under(page, "Your orders")).some(t => /Relay Test Shop\. Sample Tote/.test(t)), "the test shop's order with testing tools");
  allErrors.push(...errors); await ctx.close();
}
console.log("ok - Orders first: chosen in Settings (kept on the phone, apart from Wallet or Cards) or tried with ?focus=; orders with where they've got to, their page with Track your parcel, the shops, then other receipts; test shop orders only with testing tools; polished");

// No orders from shops on Relay: a first step, never an empty screen and never a made-up order.
reset({ orders: [] });
{
  const { ctx, page, errors } = await shopper({ focus: "orders" });
  const start = page.locator("#homePage .h2-orders-start");
  await start.waitFor();
  assert.equal(await start.locator("h3").innerText(), "Orders from shops on Relay show here");
  assert.match(await start.locator("p").innerText(), /sam\.tester@example\.com/);
  assert.equal(await page.locator("#homePage .hl-sq, #homePage .h2-item:not(.small)", { hasText: /Linen Overshirt|Stoneware Mug|Sample Tote/ }).count(), 0, "no orders made up");
  assert.equal((await heads(page)).includes("Your orders"), false);
  assert.ok((await heads(page)).includes("Other receipts"), "the shopper's receipts are still there underneath");
  await polished(page, "orders first, no shop orders");
  await shot(page, "orders-first-no-orders");
  await start.getByRole("button", { name: "See shops on Relay" }).click();
  await page.waitForFunction(() => window.page === "discover");
  allErrors.push(...errors); await ctx.close();
}
console.log("ok - Orders first without orders from shops on Relay: says what they are and where to find them, no made-up orders, receipts below");

// 3. Switching asks Relay's server for nothing more: opening the app asks for the same things either way, and Home
//    drawn again in the other focus asks for nothing new.
reset();
{
  const opened = {};
  for (const focus of ["receipts", "orders"]) {
    const { ctx, page, errors } = await shopper({ focus });
    await page.waitForTimeout(1500);
    opened[focus] = st.log.map(x => x.split("?")[0]).sort(); st.log = [];
    await page.evaluate(f => { localStorage.setItem("relay-home-focus", f); window.go("receipts"); }, focus === "orders" ? "receipts" : "orders");
    await page.evaluate(() => window.go("profile")); await page.locator("#homePage .h2-sec").first().waitFor(); await page.waitForTimeout(1200);
    const afterReceipts = st.log.slice(); st.log = [];
    await page.evaluate(() => window.go("receipts")); await page.waitForTimeout(800); st.log = [];
    await page.evaluate(() => window.go("profile")); await page.locator("#homePage .h2-sec").first().waitFor(); await page.waitForTimeout(1200);
    assert.deepEqual(st.log, [], "Home drawn again (" + focus + " switched) asks for nothing it didn't just load: " + JSON.stringify(st.log) + " / " + JSON.stringify(afterReceipts));
    allErrors.push(...errors); await ctx.close();
  }
  assert.deepEqual(opened.orders, opened.receipts, "opening the app asks for the same things in either focus");
  assert.ok(opened.receipts.includes("GET /relay/my/purchases") && opened.receipts.includes("GET /relay/my/receipts"));
}
console.log("ok - switching focus adds no requests: the same ones on opening, nothing new when Home is drawn again");
assert.deepEqual(allErrors, [], "no page errors");
console.log("PASS what Home shows first: Receipts first and Orders first, switchable in Settings and with ?focus=, real data only, polished, no extra requests (stubbed server)");
await browser.close(); server.close();
