// Browser test: Relay is quick on a phone with a big account, and Home is never left blank or stuck.
// Run: node --import ./scripts/record-app-requests.mjs scripts/test-app-speed-ui.mjs   (SPEED_REPORT=1 prints every number)
// A stubbed Relay server answers with a heavy, made-up account (400 receipts from 20 invented shops, 30 watched things,
// a catalogue of 3,000 products), each answer a little late as on 4G, and the phone is slowed down four times (CPU) with
// 4G for the app's own files. Budgets (the test fails past them):
//  1. Opening Relay with the last copy kept on the phone: Home's cards show within 300 ms of the page loading, before any
//     answer from Relay has come back; and the fresh answer then draws Home once more, not over and over.
//  2. Moving between Home, Receipts, Browse and Ask (and back) takes under 150 ms a tap, no single task over 200 ms, and
//     asks Relay for nothing new within 30 seconds of the last load.
//  3. A receipt's page and Wrapped open quickly, and closing them leaves the page scrollable.
//  4. Home always draws (cards or greyed outlines, never an empty page) and the page is never left unable to scroll:
//     after Contact us (sent to Relay's team), after Add a receipt's "forward it to Relay" (copy the address, go to the
//     Mail app and come back), after each sheet is closed, after Relay was in the background (and back from the
//     browser's back-forward cache), and when Relay is opened again from scratch with no connection at all.
//  5. The service worker answers the app's own files from its copy (no wait on the network to open Relay).
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { buildWrapped } from "../worker/wrapped.js";
import { skipInterests, homeReady, waitOutDoubleTap, openAccountRow } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const REPORT = process.env.SPEED_REPORT === "1", ENFORCE = process.env.SPEED_BUDGETS !== "0";
const root = resolve(".");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".html": "text/html" };
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;

// ---- A heavy, made-up account ----
const EMAIL = "sam.speed@example.com", NOW = Date.now(), day = n => new Date(NOW + n * 864e5).toISOString().slice(0, 10);
const SHOPS = ["Kick Lane", "Glow Lab", "Harlow & Co", "Northfold", "Fernway", "Larkspur Home", "Tidewater", "Copper Kettle", "Maple Row", "Brightside Tech",
  "Willow Lane", "Saltmarsh", "Oak & Ash", "Riverbend", "Pebble Toys", "Juniper Books", "Summit Outdoor", "Paw Pantry", "Linen Loft", "Cobalt Audio"];
const CATS = ["fashion", "electronics", "home", "beauty", "food", "fashion", "home", "other"];
const THINGS = { fashion: ["Wool Coat", "Linen Shirt", "Court Trainers", "Denim Jacket"], electronics: ["Wireless Earbuds", "USB-C Charger", "Smart Speaker"], home: ["Brass Table Lamp", "Linen Duvet Cover", "Ceramic Vase"],
  beauty: ["Vitamin C Serum", "Hand Cream"], food: ["Coffee Beans 1kg", "Fruit Pastilles 130g"], other: ["Gift Card", "Notebook A5"] };
const receipts = Array.from({ length: 400 }, (_, i) => {
  const cat = CATS[i % CATS.length], shop = SHOPS[i % SHOPS.length], ago = 1 + Math.floor(i * 0.9), things = THINGS[cat], n = 1 + (i % 3), pence = 1500 + (i * 137) % 9000;
  const id = "a" + String(i).padStart(7, "0") + "-1111-4111-8111-" + String(i).padStart(12, "0");
  // Every tenth one is still to be checked ("Is this right?") and came from the inbox, so it can be sent to Relay.
  return { id, status: i % 10 ? "confirmed" : "pending", gmailId: "m" + String(i).padStart(9, "0"), kind: "receipt", retailer: { name: shop, domain: shop.toLowerCase().replace(/[^a-z]+/g, "") + ".example" }, orderRef: "R-" + i, orderDate: day(-ago), totalPence: pence * n, currency: "GBP",
    category: cat, returnable: cat !== "food", source: "gmail", hasImage: i % 5 === 0,
    items: Array.from({ length: n }, (_, k) => ({ name: things[(i + k) % things.length] + (k ? " " + k : ""), qty: 1, pricePence: pence, category: cat })),
    returns: ago < 30 && cat !== "food" ? { windowDays: 30, deadline: day(30 - ago) } : null,
    delivery: ago < 4 ? { status: "shipped", carrier: "Royal Mail", at: day(-ago + 1) } : null };
});
const purchases = Array.from({ length: 8 }, (_, i) => ({ id: "o" + i, store: SHOPS[i], retailer: "shopify:" + SHOPS[i].toLowerCase().replace(/[^a-z]+/g, "") + ".myshopify.com", orderedAt: new Date(NOW - (i + 1) * 3 * 864e5).toISOString(), amountMinor: 2000 + i * 500, currency: "GBP",
  items: [{ title: "Logo Cap " + i, lineId: "L" + i, quantity: 1, priceMinor: 2000 + i * 500, currency: "GBP", variant: "Black", exchangeable: true, returnable: true, productId: String(i) }] }));
const KINDS = ["Trainers", "Coat", "Lamp", "Serum", "Earbuds", "Notebook", "Mug", "Jumper", "Backpack", "Candle"];
const products = Array.from({ length: 3000 }, (_, i) => ({ product: SHOPS[i % 20].split(" ")[0] + " " + KINDS[i % KINDS.length] + " " + (i + 1), variation: ["S", "M", "L", "One size"][i % 4], catalogueId: "shopify:s" + (i % 20) + ":variant:" + i, sku: "shopify:s" + (i % 20) + ":variant:" + i,
  priceMinor: 900 + (i * 53) % 15000, currency: "GBP", storeName: SHOPS[i % 20], shopDomain: "s" + (i % 20) + ".example", inStock: i % 7 !== 0, imageUrl: "https://img.example/p/" + i + ".png", productType: KINDS[i % KINDS.length] }));
const watches = {}; for (let i = 0; i < 30; i++) { const p = products[i * 97]; watches[p.sku] = { name: p.product, variant: p.variation, baseline: p.priceMinor + 300, created: new Date(NOW - i * 864e5).toISOString(), store: p.storeName, image: p.imageUrl }; }
const wrapped = buildWrapped(receipts.map(x => ({ ...x, orderDate: new Date().getFullYear() + x.orderDate.slice(4) })), new Date().getFullYear());
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" };

// ---- The phone: 4x slower CPU, 4G ----
const browser = await chromium.launch();
let log = [], offline = false;
const LATENCY = 150, BYTES_PER_MS = 1000; // about 8 Mbit/s and 150 ms to Relay's server and back
async function phone({ seedCache = true, workers = "block", assistant = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: workers, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await skipInterests(ctx);
  await ctx.addInitScript(([email, w, hc]) => {
    try {
      if (location.pathname.endsWith("index.html") || location.pathname.endsWith("/")) {
        if (!localStorage.getItem("relay.session.v1")) localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email }));
        if (!localStorage.getItem("relay-radar-v2")) localStorage.setItem("relay-radar-v2", JSON.stringify(w));
        localStorage.setItem("relay.ask.v1", hc ? "1" : "0"); localStorage.setItem("relay.mailbox", "gmail");
      }
    } catch (e) {}
    // What the test watches: long tasks, every time the screen (#view) or Home's feed is drawn again.
    window.__speed = { long: [], view: 0, feed: 0, feedAt: [] };
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__speed.long.push({ at: e.startTime, ms: e.duration }); }).observe({ type: "longtask", buffered: true }); } catch (e) {}
    const watch = () => {
      const v = document.getElementById("view"); if (!v) return setTimeout(watch, 5);
      new MutationObserver(recs => { for (const r of recs) {
        if (r.target === v && r.removedNodes.length) window.__speed.view++;
        else if (r.target.classList && r.target.classList.contains("h2-feed") && r.removedNodes.length && r.addedNodes.length === 0) { window.__speed.feed++; window.__speed.feedAt.push(performance.now()); }
      } }).observe(v, { childList: true, subtree: true });
    };
    watch();
  }, [EMAIL, watches, assistant]);
  await ctx.route("https://**/*", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    if (u.hostname === "img.example") return route.fulfill({ status: 200, contentType: "image/png", headers: H, body: PNG });
    if (!p.startsWith("/relay/")) return route.abort();
    if (offline) return route.abort("internetdisconnected");
    log.push({ at: Date.now(), r: m + " " + p + u.search });
    const j = async (b, status = 200) => { const body = JSON.stringify(b); await new Promise(r => setTimeout(r, LATENCY + body.length / BYTES_PER_MS)); return route.fulfill({ status, contentType: "application/json", headers: H, body }).catch(() => {}); };
    if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
    if (/^\/relay\/my\/receipts\/[0-9a-f-]{36}\/image$/.test(p)) return route.fulfill({ status: 200, contentType: "image/png", headers: H, body: PNG });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, googleEmail: EMAIL, connectedAt: NOW - 864e5, lastScanAt: NOW - 36e5, checkedAt: NOW - 36e5, scan: { state: "done", found: 400, finishedAt: NOW - 36e5 }, others: [], maxInboxes: 5 });
    if (p === "/relay/my/gmail/scan") return j({ ok: true, added: 0, updated: 0, more: false, job: { state: "done", found: 400, finishedAt: Date.now() } });
    if (p === "/relay/my/receipts") return j({ receipts });
    if (p === "/relay/my/purchases") return j({ purchases });
    if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Speed", photo: null });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], allShops: false, watches: Object.entries(watches).map(([sku, w]) => ({ sku, product: w.name, variant: w.variant, lastSeenMinor: w.baseline })) });
    if (p === "/relay/my/help/chat") return m === "GET" ? j({ available: assistant, handoff: true }) : j({ reply: "Hello" });
    if (p === "/relay/my/help/handoff") return j({ ok: true });
    if (p === "/relay/my/instore/shops") return j({ shops: [], live: false });
    if (p === "/relay/shopify/catalogue") return j({ published: true, products });
    if (p === "/relay/my/wrapped") return j(wrapped);
    if (p === "/relay/auctions") return j({ auctions: [] });
    if (p === "/relay/my/2fa") return j({ required: false, enrolled: true, verified: true, methods: ["passkey"] });
    if (p === "/relay/my/admin/me") return j({ admin: false });
    if (p === "/relay/my/gmail/find") return j({ results: [] });
    if (/^\/relay\/my\/receipts\/[0-9a-f-]{36}\/share$/.test(p)) return m === "GET" ? j({ subject: "Your order", from: "orders@kicklane.example", text: "Thanks for your order." }) : j({ ok: true, sent: { at: new Date().toISOString(), until: new Date(NOW + 30 * 864e5).toISOString() } });
    return j({});
  });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 70, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 });
  await cdp.send("Performance.enable");
  // Relay was used yesterday: the last copy of the receipts and orders is on the phone (account.js keeps it so).
  if (seedCache) await ctx.addInitScript(([email, r, p]) => { try { if (!localStorage.getItem("relay.cache.v1")) localStorage.setItem("relay.cache.v1", JSON.stringify({ email, receipts: r, purchases: p, needReceipt: [], at: Date.now() - 864e5 })); } catch (e) {} }, [EMAIL, receipts, purchases]);
  return { ctx, page, errors, cdp };
}
const results = {}, problems = [];
const budget = (what, value, max, unit = "ms") => { results[what] = Math.round(value) + (unit ? " " + unit : ""); if (value > max) problems.push(what + ": " + Math.round(value) + " (budget " + max + ")"); };
const speed = page => page.evaluate(() => ({ ...window.__speed, now: performance.now() }));
const nextFrame = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now())))));
// Home shows something: its cards, what to do first, or greyed outlines. Never an empty page.
const homeState = page => page.evaluate(() => {
  const v = document.getElementById("view"), hp = document.getElementById("homePage");
  const shown = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const cards = hp ? [...hp.querySelectorAll(".h2-feed > *:not(.rl-skel), .h2-feed .hl-grid > *")].filter(shown).length : 0;
  const bones = hp ? [...hp.querySelectorAll(".rl-skel")].filter(shown).length : 0;
  const covered = [...document.querySelectorAll(".rl-back, .rl-story")].filter(shown).length;
  const text = (v && v.innerText || "").trim();
  return { home: Boolean(hp), cards, bones, covered, loadingWords: /^Loading/.test(text), overflow: document.body.style.overflow || "", htmlOverflow: document.documentElement.style.overflow || "",
    bodyLock: getComputedStyle(document.body).overflowY, scrollable: document.documentElement.scrollHeight > innerHeight };
});
async function homeDrawn(page, where, { cardsNeeded = true } = {}) {
  let s;
  for (let i = 0; i < 40; i++) { s = await homeState(page); if (s.home && (s.cards || (!cardsNeeded && s.bones)) && !s.covered && !s.loadingWords) break; await page.waitForTimeout(50); }
  assert.ok(s.home, where + ": Home is on screen " + JSON.stringify(s));
  assert.ok(s.cards > 0 || (!cardsNeeded && s.bones > 0), where + ": Home shows its cards (or greyed outlines), never a blank page " + JSON.stringify(s));
  assert.equal(s.covered, 0, where + ": nothing left covering Home");
  assert.ok(!s.loadingWords, where + ": no bare Loading…");
  assert.equal(s.overflow, "", where + ": the page isn't left unable to scroll (body overflow)");
  assert.equal(s.htmlOverflow, "", where + ": the page isn't left unable to scroll (html overflow)");
  assert.notEqual(s.bodyLock, "hidden", where + ": the page isn't left unable to scroll");
  return s;
}
const reqsSince = t => log.filter(x => x.at >= t).map(x => x.r);
const tabKey = { Home: "profile", Receipts: "receipts", Browse: "discover", Ask: "ask" };
const tabReady = { Home: "#homePage .h2-feed > *:not(.rl-skel)", Receipts: "#receiptsPage .rl-tile, #receiptsPage .rl-calm-filter", Browse: "#view .title, #view h1", Ask: "#askPage .rl-chat, #askPage .rl-ask-q" };
const hide = (page, hidden) => page.evaluate(h => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => h }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange")); if (h) window.dispatchEvent(new Event("blur")); else window.dispatchEvent(new Event("focus"));
  if (h) window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })); else window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
}, hidden);

let shared;
process.on("exit", () => { if (REPORT) console.log(JSON.stringify(results, null, 2)); });
// 1. Opening Relay with yesterday's copy on the phone.
{
  const { ctx, page, errors, cdp } = await phone();
  log = [];
  await page.goto(origin + "/index.html", { waitUntil: "commit" });
  await page.waitForSelector("#homePage .h2-feed > *:not(.rl-skel)", { timeout: 20000 });
  const t = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { load: n.domContentLoadedEventEnd, now: performance.now() }; });
  const firstCards = (await speed(page)).feedAt[0] ?? t.now;
  // Home from the kept copy: drawn before any answer from Relay has come back.
  const recEnd = () => page.evaluate(() => { const e = performance.getEntriesByType("resource").filter(x => /\/relay\/my\/receipts$/.test(x.name)); return e.length ? e[0].responseEnd : null; });
  budget("Home from the kept copy, after the app's files loaded", firstCards - t.load, 300);
  results["Home from the kept copy, from opening"] = Math.round(firstCards) + " ms";
  let fresh = null;
  for (let i = 0; i < 80 && !(fresh = await recEnd()); i++) await page.waitForTimeout(100);
  await page.waitForTimeout(1500);
  const sp = await speed(page);
  const after = sp.feedAt.filter(x => x >= fresh);
  results["Home with Relay's fresh answer"] = after.length ? Math.round(after[0]) + " ms" : "no redraw (the answer matched the kept copy)";
  budget("Home's feed drawn while opening", sp.feed, 3, "times");
  const m = await cdp.send("Performance.getMetrics"), metric = n => (m.metrics.find(x => x.name === n) || {}).value || 0;
  results["JavaScript run while opening (parse, compile, run)"] = Math.round(metric("ScriptDuration") * 1000) + " ms";
  results["longest task while opening"] = Math.round(Math.max(0, ...sp.long.map(x => x.ms))) + " ms";
  results["requests to open"] = log.length;
  { const by = {}; log.forEach(x => { const k = x.r.replace(/\/logo\/.*/, "/logo/…").replace(/[0-9a-f-]{36}/, "{id}"); by[k] = (by[k] || 0) + 1; }); results["requests to open, by kind"] = by; }
  await homeDrawn(page, "opening Relay");
  shared = { ctx, page, errors, cdp };
}

// 2. Moving between the tabs.
{
  const { page } = shared;
  // Let the opening's own requests (the catalogue a few seconds in) finish, then visit each tab once.
  await page.waitForTimeout(6500);
  for (const name of ["Receipts", "Browse", "Ask", "Home"]) { await page.evaluate(k => window.tabTap(k), tabKey[name]); await page.waitForSelector(tabReady[name], { timeout: 20000 }); await page.waitForTimeout(1200); }
  const lastLoad = Date.now(); await page.waitForTimeout(400);
  const mark = Date.now(), worst = { task: 0 }, taps = {};
  const before = await speed(page);
  for (const name of ["Receipts", "Home", "Browse", "Home", "Ask", "Receipts", "Browse", "Ask", "Home"]) {
    await waitOutDoubleTap(page);
    const s0 = (await speed(page)).long.length;
    const ms = await page.evaluate(k => new Promise(done => { const t0 = performance.now(); window.tabTap(k); requestAnimationFrame(() => setTimeout(() => done(performance.now() - t0), 0)); }), tabKey[name]);
    await page.waitForSelector(tabReady[name], { timeout: 5000 });
    await page.waitForTimeout(600);
    const sp = await speed(page), longs = sp.long.slice(s0).map(x => x.ms);
    (taps[name] = taps[name] || []).push(ms); worst.task = Math.max(worst.task, ...longs, 0);
    if (name === "Home") await homeDrawn(page, "back on Home from another tab");
  }
  // Each tab's typical tap (the middle of its visits, so one hiccup of the test machine doesn't fail it), and the slowest.
  const mid = l => l.slice().sort((a, b) => a - b)[Math.floor((l.length - 1) / 2)];
  for (const [name, l] of Object.entries(taps)) budget("tap to " + name, mid(l), 150);
  budget("slowest single tab switch", Math.max(...Object.values(taps).flat()), 300);
  budget("longest task during tab switches", worst.task, 200);
  const sp = await speed(page);
  results["Home feed redrawn per visit to Home"] = ((sp.feed - before.feed) / 3).toFixed(1);
  const asked = reqsSince(mark);
  results["requests during tab switches"] = asked.length;
  if (asked.length) { const by = {}; asked.forEach(r => { const k = r.replace(/\/logo\/.*/, "/logo/…").replace(/[0-9a-f-]{36}/, "{id}"); by[k] = (by[k] || 0) + 1; }); results["requests during tab switches, by kind"] = by; }
  assert.ok(Date.now() - lastLoad < 30000, "the tab switches ran within 30 seconds of the last load");
  if (ENFORCE) assert.deepEqual(asked, [], "moving between tabs within 30 seconds of the last load asks Relay for nothing new");
}

// 3. A receipt's page, and Wrapped.
{
  const { page } = shared;
  await page.evaluate(() => window.tabTap("receipts")); await page.waitForSelector("#receiptsPage .rl-tile");
  await waitOutDoubleTap(page);
  let mark = Date.now();
  // A kind of thing (a tile), then one receipt in it.
  const g0 = await page.evaluate(() => performance.now());
  await page.locator("#receiptsPage .rl-tile").first().click();
  await page.locator("#receiptsPage .rl-rr .rl-rr-main").first().waitFor();
  budget("opening a kind of receipts", (await nextFrame(page)) - g0, 600);
  await waitOutDoubleTap(page);
  const t0 = await page.evaluate(() => performance.now());
  await page.locator("#receiptsPage .rl-rr .rl-rr-main").first().click();
  await page.locator("#receiptsPage .rl-rr").first().getByText("Something read wrong?").waitFor();
  budget("opening a receipt", (await nextFrame(page)) - t0, 400);
  results["requests to open a receipt"] = reqsSince(mark).join(", ") || 0;
  assert.equal(await page.evaluate(() => document.body.style.overflow), "", "a receipt's page leaves the page scrollable");
  await page.evaluate(() => window.tabTap("profile")); await homeDrawn(page, "Home after a receipt's page");
  // Wrapped, from Home's chip.
  await waitOutDoubleTap(page);
  mark = Date.now();
  const w0 = await page.evaluate(() => performance.now());
  await page.locator("#view .h2-chip-go", { hasText: "Wrapped" }).first().click();
  await page.locator(".rl-story").first().waitFor({ timeout: 20000 });
  await page.locator(".rl-story .rl-story-slide").first().waitFor({ timeout: 20000 });
  const w1 = await nextFrame(page);
  budget("opening Wrapped", w1 - w0, 1500);
  results["requests to open Wrapped"] = reqsSince(mark).length;
  await page.waitForTimeout(800);
  await page.locator(".rl-story-x").first().click();
  await page.locator(".rl-story").first().waitFor({ state: "detached" }).catch(() => {});
  await homeDrawn(page, "Home after Wrapped");
  // Wrapped left by the phone's back (the swipe from the edge) instead of its cross.
  await waitOutDoubleTap(page);
  await page.locator("#view .h2-chip-go", { hasText: "Wrapped" }).first().click();
  await page.locator(".rl-story .rl-story-slide").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(600); // as long as a person takes to decide to go back
  await page.goBack().catch(() => {}); await page.waitForTimeout(500);
  assert.equal(await page.locator(".rl-story").count(), 0, "the phone's back closes Wrapped (and stays in Relay)");
  if (await page.locator(".rl-story").count()) await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await homeDrawn(page, "Home after leaving Wrapped with the phone's back");
}

// 4a. Contact us (Relay's assistant off, as for Connor): a message to Relay's team, then back to Home; then off to the
// Mail app for the reply and back (the browser's back-forward cache).
{
  const { ctx, page, errors } = await phone({ assistant: false });
  await page.goto(origin + "/index.html"); await homeReady(page, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await openAccountRow(page, "Contact us");
  await page.locator("#mePage .rl-chat-in").fill("My receipt from Kick Lane is missing");
  await page.locator("#mePage .rl-chat-send").click();
  await page.locator(".rl-back .rl-sheet[role=alertdialog] button", { hasText: "Send" }).first().click();
  await page.locator("#mePage .rl-chat-b.note", { hasText: "Sent to Relay's team" }).waitFor();
  // Back, Back (as a person does) to Home.
  for (let i = 0; i < 4 && !(await page.locator("#homePage").count()); i++) { const b = page.locator("#view [data-back]:visible").first(); if (!(await b.count())) break; await waitOutDoubleTap(page); await b.click(); await page.waitForTimeout(300); }
  if (!(await page.locator("#homePage").count())) { await waitOutDoubleTap(page); await page.evaluate(() => window.tabTap("profile")); }
  const t0 = Date.now(); await homeDrawn(page, "Home after Contact us"); budget("Home drawn after Contact us", Date.now() - t0, 600);
  await hide(page, true); await page.waitForTimeout(400); await hide(page, false); await page.waitForTimeout(300);
  await homeDrawn(page, "Home after Contact us and the Mail app");
  // Relay closed by the phone meanwhile, opened again: Home straight from the kept copy.
  await page.goto("about:blank"); await page.goto(origin + "/index.html", { waitUntil: "commit" });
  const t1 = Date.now(); await page.waitForSelector("#homePage .h2-feed > *:not(.rl-skel)", { timeout: 20000 });
  results["Home on reopening after Contact us"] = (Date.now() - t1) + " ms";
  await homeDrawn(page, "Home opened again after Contact us");
  assert.deepEqual(errors, [], "no errors on the page");
  await ctx.close();
}

// 4b. Add a receipt: forward it to Relay (copy the address, off to the Mail app, back again).
{
  const { page, ctx } = shared;
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.evaluate(() => window.tabTap("receipts")); await page.waitForSelector("#receiptsPage .rl-rr, #receiptsPage .rl-tile");
  if (await page.locator("#view .rl-cat-back:visible").count()) { await waitOutDoubleTap(page); await page.locator("#view .rl-cat-back").first().click(); }
  await page.waitForSelector("#view button[aria-label='Add a missing receipt']");
  await waitOutDoubleTap(page);
  await page.locator("#view button[aria-label='Add a missing receipt']").first().click();
  const copy = page.locator(".rl-sheet .rl-ar-copy", { hasText: "Copy" }).first();
  await copy.waitFor({ timeout: 10000 });
  await copy.click(); await page.waitForTimeout(150);
  await hide(page, true); await page.waitForTimeout(600); await hide(page, false); await page.waitForTimeout(300);
  // Sent: the sheet is closed and Home opened (or Relay sends them there itself).
  if (await page.locator(".rl-back").count()) { await page.locator(".rl-back").last().click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(400); }
  await waitOutDoubleTap(page);
  await page.evaluate(() => window.tabTap("profile"));
  await homeDrawn(page, "Home after forwarding a receipt to Relay");
  // Every sheet Home opens, then closed: Home is still there, and scrolls.
  await waitOutDoubleTap(page);
  await page.locator("#homePage .h2-feed .h2-item, #homePage .hl-grid > *").first().click();
  await page.locator(".rl-back .rl-sheet").last().waitFor();
  await page.locator(".rl-back").last().click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(400);
  await homeDrawn(page, "Home after closing a card's sheet");
  // In the background for a while, and back from the back-forward cache.
  await hide(page, true); await page.waitForTimeout(800); await hide(page, false); await page.waitForTimeout(300);
  await homeDrawn(page, "Home after Relay was in the background");
  // A card's receipt read wrong: "Is this right?" No, some details are wrong, Send this email to Relay, Done. Back on Home
  // (Connor, 18 Nov 2026: "after I sent the email it went back to Home and was frozen on a blank page for ages"): Home's
  // cards are there at once, and Relay's new answer is drawn when it comes.
  await waitOutDoubleTap(page);
  await page.locator("#homePage .hl-grid > *").filter({ hasText: "On its way" }).filter({ hasText: "Kick Lane" }).first().click();
  const sheet = page.locator(".rl-back .rl-sheet").last(); await sheet.waitFor();
  await sheet.locator(".rl-rc-ask button", { hasText: "No" }).first().click();
  await page.locator(".rl-sheet[role=alertdialog] button", { hasText: "Some details are wrong" }).click();
  await page.locator(".rl-sheet button", { hasText: "Send this email to Relay" }).click();
  const send = page.locator(".rl-sheet button", { hasText: "Send to Relay" }); await send.waitFor();
  for (let i = 0; i < 40 && await send.isDisabled(); i++) await page.waitForTimeout(100);
  await send.click();
  await page.locator(".rl-sheet button", { hasText: "Done" }).click();
  const d0 = Date.now();
  let blankFor = 0;
  for (let i = 0; i < 100; i++) { const st = await homeState(page); if (st.home && st.cards) break; blankFor = Date.now() - d0; await page.waitForTimeout(50); }
  budget("Home without its cards after sending an email to Relay", blankFor, 300);
  // The receipt's own page is still open over Home: closed as a person does.
  while (await page.locator(".rl-back").count()) { await page.locator(".rl-back").last().click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(350); }
  await homeDrawn(page, "Home after sending an email to Relay");
  assert.deepEqual(shared.errors, [], "no errors on the page");
  await shared.ctx.close();
}

// 4c. Relay opened from scratch after the Mail app (the phone closed it meanwhile), with no connection at all: Home from
// the kept copy, never a blank page waiting on the network.
{
  const { ctx, page } = await phone();
  await page.goto(origin + "/index.html"); await homeReady(page, { timeout: 20000 });
  offline = true;
  await page.goto("about:blank"); await page.goto(origin + "/index.html", { waitUntil: "commit" });
  await page.waitForTimeout(1500);
  await homeDrawn(page, "Home opened again with no connection");
  offline = false;
  await ctx.close();
}

// 5. The service worker: the app's own files come from its copy, so opening Relay doesn't wait on the network.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
  await skipInterests(ctx);
  await ctx.route("https://**/*", route => route.fulfill({ status: 200, contentType: "application/json", headers: H, body: "{}" }));
  const page = await ctx.newPage();
  await page.goto(origin + "/index.html");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  for (let i = 0; i < 40 && !(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))); i++) await page.waitForTimeout(100);
  // The files the shell starts with are all kept.
  const kept = await page.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys.find(k => /^relay-shell-/.test(k))); return (await c.keys()).map(r => new URL(r.url).pathname + new URL(r.url).search); });
  const wants = await page.evaluate(() => [...document.scripts].map(s => s.getAttribute("src")).filter(Boolean).map(s => new URL(s, location.href)).filter(u => u.origin === location.origin).map(u => u.pathname + u.search));
  for (const w of wants) assert.ok(kept.includes(w), "the service worker keeps " + w + " for opening Relay without the network");
  // Opening again with the network slow: the page and its files are answered from the copy, before the network replies.
  let slow = 0;
  await ctx.route(origin + "/**", async route => { slow++; await new Promise(r => setTimeout(r, 3000)); return route.continue().catch(() => {}); });
  const t0 = Date.now();
  await page.reload({ waitUntil: "load" });
  const took = Date.now() - t0;
  budget("opening Relay on a slow network (service worker copy)", took, 2500);
  results["app files asked of the network in the background on reopening"] = slow;
  await ctx.close();
}

await browser.close(); server.close();
if (!REPORT && problems.length) console.log(JSON.stringify(results, null, 2));
if (ENFORCE) assert.deepEqual(problems, [], "within the speed budgets");
console.log("PASS Relay is quick with a big account on a slowed-down phone, Home always draws (after Contact us, forwarding a receipt, sheets, the background, offline) and the page never stays unable to scroll");
