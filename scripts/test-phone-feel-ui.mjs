// Browser test: Relay's phone gestures and conventions, on a phone-sized touch screen. Stubbed Relay server; made-up
// person, shops and receipts. Touches are real touch events sent through Chromium (DevTools protocol), not clicks.
// Checks:
//   - Back: the phone's back (history) does what the screen's Back does, for Profile (opened from your picture) and its
//     inner pages, a Receipts group, a product in Shops on Relay and a sheet; it never leaves extra history behind; on a tab's own screen there's no extra step.
//   - The installed app (no back gesture of its own): a swipe in from the left edge goes back; a short one snaps back.
//   - Pull to refresh on a tab's own screen: asks Relay again (Receipts also checks the inbox), shows Relay's drawn icons
//     (no spinner) and hides again; a short pull, a pull on an inner page, or with the list scrolled down does nothing.
//   - Tapping the tab you're on goes to its top without redrawing; each tab remembers how far down it was.
//   - Coming back from a Discover product or a Receipts group lands where the list was.
//   - A long Receipts group brings in its next part before you reach the end.
//   - Sheets from the bottom have a grabber and close when swiped down; a short swipe snaps back.
//   - Links into the app (#open=…, and a tapped notification via the service worker's message) open that exact screen.
//   - Drafts: a pasted email that wasn't added is still there next time; signing out removes it.
//   - Watching: shown at once; with no connection it's sent again when the connection is back. Following a shop is instant.
//   - Every screen visited passes the polish rules (sizes, symbols, contrast, no sideways scroll) in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, profileButton, openReceiptKind } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
// 130 fashion receipts (a long group) and a few others.
const receipts = Array.from({ length: 130 }, (_, i) => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-" + String(i).padStart(12, "0"), status: "pending", kind: "receipt",
  retailer: { name: "Kestrel Outdoor", domain: null }, orderRef: "KO-" + i, orderDate: day(-1 - (i % 60)), totalPence: 1000 + i, currency: "GBP", category: "fashion", returnable: true,
  items: [{ name: "Trail Sock " + i, qty: 1, pricePence: 1000 + i, category: "fashion" }], returns: { deadline: day(20) } }))
  .concat([{ id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", status: "pending", kind: "receipt", retailer: { name: "Copper Kettle Co", domain: null }, orderRef: "CK-1", orderDate: day(-4),
    totalPence: 3900, currency: "GBP", category: "home", returnable: true, items: [{ name: "Stovetop Kettle", qty: 1, pricePence: 3900, category: "home" }], returns: { deadline: day(10) } }]);
const shopProducts = [
  { product: "Court Classic Trainers", variation: "White / UK 8", catalogueId: "shopify-v-1", priceMinor: 8500, currency: "GBP", quantity: 4, storeName: "Kick Lane", shopDomain: "kick-lane.myshopify.com" },
  ...Array.from({ length: 24 }, (_, i) => ({ product: "Canvas Tote " + (i + 1), variation: "Natural", catalogueId: "shopify-t-" + i, priceMinor: 2400 + i * 100, currency: "GBP", quantity: 30, storeName: "Kick Lane", shopDomain: "kick-lane.myshopify.com" }))
];
const hits = {}; let st;
const reset = o => { st = { watchFails: false, watches: [], stores: [], scans: 0, storeDelay: 0, ...o }; };
reset();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/") && !p.startsWith("/plaid/")) return route.abort();
  hits[m + " " + p] = (hits[m + " " + p] || 0) + 1;
  const body = () => { try { return JSON.parse(route.request().postData() || "{}"); } catch { return {}; } };
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true, outlookAvailable: true });
  if (p === "/relay/my/gmail" && m === "GET") return j({ connected: true, provider: "google", email: EMAIL, googleEmail: EMAIL, lastScanAt: Date.now() - 6e5, others: [], maxInboxes: 5 });
  if (p === "/relay/my/gmail/scan") { st.scans++; return j({ ok: true, added: 0, more: false }); }
  if (p === "/relay/my/receipts") return j({ receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: st.watches, stores: st.stores });
  if (p === "/relay/my/alerts/watch") { if (st.watchFails) return route.abort("internetdisconnected"); st.watches.push(body()); return j({ ok: true }); }
  if (p === "/relay/my/alerts/store") { await new Promise(r => setTimeout(r, st.storeDelay)); st.stores = body().on === false ? [] : [body().store]; return j({ ok: true }); }
  if (p === "/relay/shopify/catalogue") return j({ published: true, products: shopProducts.map(x => ({ ...x, sku: x.catalogueId, provider: "shopify" })) });
  if (p === "/relay/live-test/products") return j({ products: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
const cdp = await ctx.newCDPSession(page);
// A real touch drag: down at (x0,y0), through `steps` moves, up at (x1,y1).
async function drag(x0, y0, x1, y1, { steps = 10, ms = 16 } = {}) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] });
    await page.waitForTimeout(ms);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; }; // color-mix() comes back as color(srgb 0–1)
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], faint: [], wide: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " input")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    if (px < 13 && !(s.textTransform === "uppercase" && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    const back = bgOf(el), a = lum(flat(rgb(s.color), back)), b = lum(back), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3 && !el.closest("button:disabled")) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const polished = async (where, scope) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(100);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], faint: [], wide: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/feel-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const signedIn = async (hash = "", { standalone = false } = {}) => {
  await page.goto(origin + "/index.html");
  await page.evaluate(([e, sa]) => { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); sessionStorage.setItem("standalone", sa ? "1" : ""); }, [EMAIL, standalone]);
  await page.goto(origin + "/index.html" + hash);
  await page.waitForFunction(() => window.RelayShell && window.RelayBack && window.RelayAccount);
};
// The installed app on iPhone reports navigator.standalone; this stands in for it before Relay's scripts run.
await ctx.addInitScript(() => { if (sessionStorage.getItem("standalone") === "1") Object.defineProperty(navigator, "standalone", { get: () => true }); });
const tab = name => page.locator('#foot button[data-name="' + name + '"]');
// Profile isn't a tab: it opens from your picture.
// (A tap while the screen is still drawing can land on the picture just as it's replaced: then tap again, as a person would.)
const openProfileHere = async () => {
  // The picture is there once the screen has drawn its top row.
  await page.waitForFunction(() => [...document.querySelectorAll(".h2-me, .topline .avatar")].some(e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && c.display !== "none" && Number(c.opacity) > 0.5; }), null, { timeout: 15000 });
  for (let i = 0; i < 3; i++) {
    try {
      await profileButton(page).click({ timeout: 8000 });
      await page.locator("#mePage .rl-arow").first().waitFor({ timeout: 6000 }); return;
    } catch (e) { if (i === 2) throw e; await page.waitForTimeout(450); }
  }
};
const settle = () => page.waitForTimeout(250);
const histState = () => page.evaluate(() => ({ len: history.length, relayBack: Boolean(history.state && history.state.relayBack), can: RelayBack.can() }));

// ---- Back, with the phone's own back ----
await signedIn();
await page.waitForSelector("#foot button");
assert.equal((await histState()).relayBack, false, "a tab's own screen has no extra history step");
const base = (await histState()).len;
await openProfileHere(); await settle();
let h = await histState();
assert.ok(h.relayBack && h.can && h.len === base + 1, "Profile adds one history step: " + JSON.stringify(h));
await page.getByRole("button", { name: /Inboxes/ }).click();
await page.locator(".rl-abar-t", { hasText: "Inboxes" }).waitFor(); await settle();
h = await histState();
assert.ok(h.relayBack && h.can && h.len === base + 1, "an inner page of Profile is still one step: " + JSON.stringify(h));
await page.goBack(); await settle();
assert.equal(await page.locator(".rl-abar-t", { hasText: "Inboxes" }).count(), 0, "the phone's back closed the inner page");
await page.getByRole("button", { name: /Inboxes/ }).waitFor();
assert.equal((await histState()).relayBack, true, "back on Profile: one step left, to the tab it came from");
await page.goBack(); await settle();
h = await histState(); assert.ok(!h.relayBack && !h.can, "back on Home: no step left " + JSON.stringify(h));
assert.equal(await page.evaluate(() => window.page), "profile", "Profile's Back returns to the tab it came from (Home)");
// Back by the screen's own button removes the step quietly.
await openProfileHere(); await settle();
assert.equal((await histState()).relayBack, true);
await page.locator("[data-back]").first().click(); await page.waitForTimeout(400);
h = await histState(); assert.ok(!h.relayBack && h.len <= base + 1, "the screen's Back took the step away again " + JSON.stringify(h));
console.log("ok - the phone's back runs the screen's Back on Profile and its inner pages; no extra steps are left behind");

// A sheet (Disconnect's "are you sure?"): the phone's back closes it, and the inner page under it stays.
await openProfileHere(); await page.getByRole("button", { name: /Inboxes/ }).click();
await page.getByRole("button", { name: "Disconnect " + EMAIL }).click();
await page.locator(".rl-back .rl-sheet").waitFor(); await settle();
assert.equal((await histState()).relayBack, true, "a sheet over an inner page: still one step");
await page.goBack(); await settle();
assert.equal(await page.locator(".rl-back").count(), 0, "the phone's back closed the sheet");
assert.equal(await page.locator(".rl-abar-t", { hasText: "Inboxes" }).count(), 1, "the page under it stays");
assert.equal((await histState()).relayBack, true, "and its Back is ready for the next back");
await page.goBack(); await settle();
assert.equal(await page.locator(".rl-abar-t", { hasText: "Inboxes" }).count(), 0, "the next back leaves the inner page");
await page.goBack(); await settle();
console.log("ok - the phone's back closes a sheet first, then the page under it");

await tab("Receipts").click(); await page.locator("#view .rl-calm-filter").waitFor();
// A Receipts group: back returns to all receipts.
await page.evaluate(() => window.scrollTo(0, 0));
await openReceiptKind(page, "Fashion"); await page.locator(".rl-cat-back").waitFor(); await settle();
await page.goBack(); await settle();
assert.equal(await page.locator(".rl-cat-back").count(), 0, "back from a group shows the groups");
console.log("ok - the phone's back leaves a Receipts group");

// ---- Pull to refresh ----
await page.evaluate(() => window.scrollTo(0, 0)); await settle();
let before = hits["GET /relay/my/receipts"] || 0, scans = st.scans;
await drag(195, 260, 195, 300); await page.waitForTimeout(900);
assert.equal(hits["GET /relay/my/receipts"] || 0, before, "a short pull does nothing");
// Mid-pull screenshot: the disc with its arrow.
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 240 }] });
for (let i = 1; i <= 12; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 195, y: 240 + i * 22 }] }); await page.waitForTimeout(16); }
assert.ok(await page.locator(".rl-ptr.on.ready").count(), "pulled far enough: the arrow turns to say let go");
await page.screenshot({ path: "/tmp/shots/feel-pull-ready.png" });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(400);
assert.ok(await page.locator(".rl-ptr svg").count(), "Relay's drawn icon, not a spinner");
await page.waitForFunction(() => !document.querySelector(".rl-ptr.on"), null, { timeout: 12000 });
assert.ok((hits["GET /relay/my/receipts"] || 0) > before, "receipts were asked for again");
assert.ok(st.scans > scans, "pulling down on Receipts checks the inbox too");
assert.equal(await page.locator("#view .rl-rr, #view .rl-crow").count() > 0, true, "the receipts stayed on screen");
console.log("ok - pull to refresh on Receipts: asks again, checks the inbox, drawn icons, hides; a short pull does nothing");
// Not on an inner page, and not while scrolled down.
await openReceiptKind(page, "Fashion"); await page.locator(".rl-cat-back").waitFor(); await settle();
before = hits["GET /relay/my/receipts"] || 0;
await drag(195, 240, 195, 520); await page.waitForTimeout(800);
assert.equal(hits["GET /relay/my/receipts"] || 0, before, "no pull to refresh on an inner page");
await page.locator(".rl-cat-back").click(); await settle();
// Scrolled down on Receipts, pulling down just scrolls.
await page.evaluate(() => window.scrollTo(0, 600)); await settle();
const y0 = await page.evaluate(() => window.scrollY), rec0 = hits["GET /relay/my/receipts"] || 0;
assert.ok(y0 > 300, "Receipts scrolled down (" + y0 + ")");
await drag(195, 300, 195, 560); await page.waitForTimeout(800);
assert.equal(hits["GET /relay/my/receipts"] || 0, rec0, "scrolled down, pulling down just scrolls");
assert.ok(await page.evaluate(() => window.scrollY) < y0, "it scrolled up instead");
// At the top of Browse, pulling down asks again for what its tiles are made of (your receipts).
await tab("Browse").click(); await page.locator("#browsePage .rl-tile").first().waitFor(); await settle();
await page.evaluate(() => window.scrollTo(0, 0)); await settle();
const b0 = hits["GET /relay/my/receipts"] || 0;
await drag(195, 240, 195, 520); await page.waitForFunction(() => !document.querySelector(".rl-ptr.on"), null, { timeout: 12000 });
assert.ok((hits["GET /relay/my/receipts"] || 0) > b0, "at the top of Browse, pulling down asks again");
console.log("ok - no pull to refresh on an inner page or when scrolled down; on Browse it asks again");

// ---- Tabs: tap the one you're on to go to its top; each remembers where it was ----
await tab("Receipts").click(); await page.locator("#view .rl-calm-filter").waitFor(); await settle();
await page.evaluate(() => window.scrollTo(0, 700)); await settle();
const remembered = await page.evaluate(() => window.scrollY);
assert.ok(remembered > 300, "Receipts scrolled down (" + remembered + ")");
await tab("Browse").click(); await page.waitForTimeout(400);
assert.ok(await page.evaluate(() => window.scrollY) < 5, "Browse starts at its top");
await tab("Receipts").click(); await page.waitForTimeout(900);
assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - remembered) < 4, "back on Receipts where it was (" + await page.evaluate(() => window.scrollY) + " vs " + remembered + ")");
await page.evaluate(() => document.getElementById("receiptsPage").setAttribute("data-mark", "1"));
await tab("Receipts").click(); await page.waitForFunction(() => window.scrollY < 2, null, { timeout: 3000 });
assert.equal(await page.locator("#receiptsPage[data-mark]").count(), 1, "tapping the tab you're on scrolls up without redrawing");
console.log("ok - tapping the current tab goes to its top without redrawing; tabs remember how far down they were");

// ---- A long group brings in its next part before the end ----
await openReceiptKind(page, "Fashion"); await page.locator(".rl-cat-back").waitFor(); await settle();
const rows = () => page.locator(".rl-cat-list > *").count();
const first = await rows();
assert.ok(first >= 30 && first <= 45, "a part at a time (" + first + ")");
const more = page.locator(".rl-cat-more");
const moreY = await more.evaluate(b => b.getBoundingClientRect().top + window.scrollY);
await page.evaluate(y => window.scrollTo(0, y - window.innerHeight - 900), moreY); await page.waitForTimeout(600);
assert.ok(await rows() > first, "the next part arrived before reaching the button (" + await rows() + ")");
console.log("ok - a long Receipts group brings in its next part about two screens before the end");
await page.locator(".rl-cat-back").click(); await settle();

// ---- Shops on Relay (Browse): a product and back, landing where the list was ----
await tab("Browse").click(); await page.locator("#browsePage .rl-arow", { hasText: "Shops on Relay" }).click(); await page.locator(".dc-card").first().waitFor(); await settle();
await page.evaluate(() => window.scrollTo(0, 500)); await settle();
const listY = await page.evaluate(() => window.scrollY);
// Tap a card that's on screen as it is (a test click would scroll first).
await page.evaluate(() => [...document.querySelectorAll(".dc-card")].find(c => { const r = c.getBoundingClientRect(); return r.top > 80 && r.bottom < innerHeight - 120; }).click());
await page.locator("#backToResults").waitFor(); await settle();
await page.goBack(); await page.waitForTimeout(700);
assert.equal(await page.locator("#backToResults").count(), 0, "the phone's back left the product");
assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - listY) < 4, "back where the list was");
console.log("ok - Shops on Relay: the phone's back leaves a product and lands where the list was");

// ---- Watching and following: instant, and sent again when the connection is back ----
reset({ watchFails: true });
await page.locator(".dc-card").first().click(); await page.locator("#watchSelected").waitFor();
await page.locator("#watchSelected").click(); await page.waitForTimeout(500);
assert.match(await page.locator("#watchSelected").innerText(), /Watching|Stop/i, "shown as watched at once");
const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("relay.pending-watches.v1") || "{}"));
assert.ok(pending.items && Object.keys(pending.items).length === 1, "no connection: the watch waits on the phone");
st.watchFails = false;
await page.evaluate(() => window.dispatchEvent(new Event("online"))); await page.waitForTimeout(600);
assert.equal(st.watches.length, 1, "sent once the connection is back"); assert.equal(st.watches[0].sku, "shopify-v-1");
assert.equal(await page.evaluate(() => localStorage.getItem("relay.pending-watches.v1")), null, "nothing left waiting");
console.log("ok - watching shows at once; without a connection it's sent again when the connection is back");
await page.locator("#backToResults").click(); await settle();

// ---- Links into the app ----
await page.goto(origin + "/index.html#open=receipts"); await page.waitForFunction(() => window.RelayShell);
await page.locator("#receiptsPage").waitFor();
assert.equal(new URL(page.url()).hash, "", "the address is tidied after opening");
await page.goto(origin + "/index.html#open=product&sku=shopify-t-3"); await page.locator("#backToResults").waitFor();
assert.match(await page.locator(".dc-page h2").innerText(), /Canvas Tote 4/, "a price-drop link opens that exact product");
await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "relay-open", url: location.origin + "/#open=profile" } })));
await page.locator("#mePage").waitFor();
console.log("ok - links (#open=…) and a tapped notification (the service worker's message) open the exact screen");

// ---- Sheets swipe down to close ----
await tab("Home").click(); await openProfileHere(); await page.getByRole("button", { name: /Inboxes/ }).click();
await page.getByRole("button", { name: "Disconnect " + EMAIL }).click();
const sheet = page.locator(".rl-back .rl-sheet"); await sheet.waitFor(); await settle();
assert.equal(await sheet.evaluate(s => getComputedStyle(s, "::before").content), '""', "the sheet has a grabber");
const box = await sheet.boundingBox();
await drag(195, box.y + 30, 195, box.y + 70); await page.waitForTimeout(400);
assert.equal(await page.locator(".rl-back").count(), 1, "a short swipe snaps back");
await page.screenshot({ path: "/tmp/shots/feel-sheet-grabber.png" });
await polished("sheet", ".rl-back");
await drag(195, box.y + 30, 195, box.y + 330, { steps: 12 }); await page.waitForTimeout(500);
assert.equal(await page.locator(".rl-back").count(), 0, "swiped down: closed");
assert.equal(await page.locator(".rl-abar-t", { hasText: "Inboxes" }).count(), 1, "closing it changed nothing else (nothing disconnected)");
console.log("ok - sheets have a grabber, close when swiped down, and snap back from a short swipe");
await page.locator("[data-back]").filter({ visible: true }).first().click(); await settle();

// ---- Drafts ----
await page.locator("[data-back]").filter({ visible: true }).first().click(); await settle(); // (back to Home)
await tab("Receipts").click(); await page.locator("#view .rl-calm-filter").waitFor();
const addRow = page.getByRole("button", { name: "Add a missing receipt" });
const arBack = page.locator(".rl-back .rl-sheet").getByRole("button", { name: "Back", exact: true });
await addRow.click(); await arBack.waitFor();
const draft = "Thanks for your order with Studio North. Order SN-77, Linen shirt, 45.00 pounds, delivered tomorrow.";
await page.getByRole("button", { name: "Paste", exact: true }).click();
await page.locator(".rl-ar-box").waitFor(); await page.locator(".rl-ar-box").fill(draft);
await page.waitForTimeout(500);
await page.goBack(); await settle(); // leave without adding it
await page.locator(".rl-back").waitFor({ state: "detached" });
await addRow.click(); await arBack.waitFor();
assert.equal(await page.locator(".rl-ar-box").inputValue(), draft, "the email pasted last time is still there");
assert.ok(await page.locator(".rl-ar-box").isVisible());
assert.match(await page.locator(".rl-msg", { hasText: "still here" }).innerText(), /still here/);
await arBack.click(); await settle();
// Signing out (Profile) removes it.
await openProfileHere();
assert.ok(await page.evaluate(() => localStorage.getItem("relay.drafts.v1")), "kept while signed in");
await page.locator(".rl-aout").click();
await page.waitForFunction(() => !localStorage.getItem("relay.session.v1"), null, { timeout: 5000 });
assert.equal(await page.evaluate(() => localStorage.getItem("relay.drafts.v1")), null, "signing out removes drafts");
console.log("ok - a pasted email that wasn't added is still there next time; signing out removes drafts");

// ---- The installed app on iPhone: swipe in from the left edge ----
await signedIn("", { standalone: true });
assert.equal(await page.evaluate(() => navigator.standalone), true);
await openProfileHere(); await page.getByRole("button", { name: /Inboxes/ }).click();
await page.locator(".rl-abar-t", { hasText: "Inboxes" }).waitFor(); await settle();
await drag(4, 400, 70, 405); await page.waitForTimeout(400);
assert.equal(await page.locator(".rl-abar-t", { hasText: "Inboxes" }).count(), 1, "a short edge swipe snaps back");
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 4, y: 400 }] });
for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 4 + i * 20, y: 402 }] }); await page.waitForTimeout(16); }
await page.screenshot({ path: "/tmp/shots/feel-edge-swipe.png" });
for (let i = 9; i <= 14; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 4 + i * 20, y: 402 }] }); await page.waitForTimeout(16); }
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(500);
assert.equal(await page.locator(".rl-abar-t", { hasText: "Inboxes" }).count(), 0, "a swipe in from the left edge went back");
await page.getByRole("button", { name: /Inboxes/ }).waitFor();
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("main.main")).transform), "none", "the screen is back in place");
console.log("ok - installed app: a swipe in from the left edge goes back; a short one snaps back");

await tab("Browse").click(); await page.locator("#browsePage .rl-tile").first().waitFor();
assert.deepEqual(errors, [], "no script errors");
await polished("browse", "#view");
await browser.close(); server.close();
console.log("PASS phone gestures and conventions: back, edge swipe, pull to refresh, tabs, scroll memory, next part early, sheets, links, drafts, watches (stubbed server)");
