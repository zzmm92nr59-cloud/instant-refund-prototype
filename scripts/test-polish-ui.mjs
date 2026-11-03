// Browser test against the common "built in a hurry" tells. Stubbed Relay server, made-up account and shop.
// Checks: no purple; nothing tappable smaller than 44px; no text under 12px; no symbol characters used as icons;
// a press effect on buttons; one colour scheme; a second tap doesn't undo the first; what was loaded last time shows
// at once on the next visit (and is removed on sign-out); a new shopper is shown how to start; watches come back
// from the account; the keyboard space is tracked; no raw error text.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const EMAIL = "jess.tester@outlook.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const receipts = [{ id: "11111111-1111-4111-8111-111111111111", status: "confirmed", kind: "receipt", retailer: { name: "RAINS", domain: "rains.com" }, orderRef: "RA-1", orderDate: day(-5), totalPence: 9500, currency: "GBP", items: [{ name: "Long Jacket", qty: 1, pricePence: 9500 }], category: "fashion", categoryLabel: "Fashion", returnable: true, returns: { deadline: day(20) } },
  { id: "22222222-2222-4222-8222-222222222222", status: "confirmed", kind: "receipt", retailer: { name: "Nespresso", domain: "nespresso.com" }, orderRef: "NE-1", orderDate: day(-9), totalPence: 4200, currency: "GBP", items: [{ name: "Vertuo Pods", qty: 10, pricePence: 420 }], category: "food", categoryLabel: "Food & drink", returnable: false }];
const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const W = { year: 2026, years: [{ year: 2026, receipts: 2 }], industries: [{ category: "fashion", label: "Fashion", receipts: 1, spentPence: 9500 }, { category: "food", label: "Food & drink", receipts: 1, spentPence: 4200 }], receipts: 2, shops: 2, items: 2, spentPence: 13700, currency: "GBP", coverage: { withTotal: 2, noTotal: 0, otherCurrency: 0 }, topShops: [{ name: "RAINS", receipts: 1, spentPence: 9500 }, { name: "Nespresso", receipts: 1, spentPence: 4200 }], categories: [{ category: "fashion", label: "Fashion", receipts: 1 }, { category: "food", label: "Food & drink", receipts: 1 }], byMonth: months.map(m => ({ month: m, receipts: m === "Oct" ? 2 : 0, spentPence: 0 })), busiestMonth: "Oct", topItems: [], photos: [], personality: { label: "The Mixer", why: "Your shopping was spread across 2 kinds of shop." } };
const state = { connected: true, receiptsDelay: 0, serverWatches: [] };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", serviceWorkers: "block" });
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method();
  const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!u.pathname.startsWith("/relay/")) return route.abort();
  const p = u.pathname;
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j(state.connected ? { connected: true, provider: "microsoft", email: EMAIL, googleEmail: EMAIL, connectedAt: Date.now() - 864e5, lastScanAt: Date.now() - 36e5 } : { connected: false });
  if (p === "/relay/my/receipts") { if (state.receiptsDelay) await new Promise(r => setTimeout(r, state.receiptsDelay)); return j({ receipts: state.connected ? receipts : [] }); }
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/wrapped") return j(W);
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: state.serverWatches, stores: [], allShops: false });
  if (p === "/relay/auth/logout") return j({ ok: true });
  if (p === "/relay/my/export") { state.exports = (state.exports || 0) + 1; await new Promise(r => setTimeout(r, 300)); return j({ about: "Everything Relay keeps about you", account: { email: EMAIL }, receipts: receipts.map(r => ({ id: r.id, retailer: r.retailer })) }); }
  if (p === "/relay/shopify/catalogue") return j({ published: true, products: [{ product: "Court Classic Trainers", variation: "White / UK 8", catalogueId: "shopify:kick:variant:1", sku: "shopify:kick:variant:1", priceMinor: 8500, currency: "GBP", quantity: 4, storeName: "Kick Lane", provider: "shopify" }] });
  return j({});
});
// Counts the sound the story makes: each audio context made, and whether it's been closed again.
await ctx.addInitScript(() => {
  const Real = window.AudioContext; if (!Real) return;
  window.__audio = [];
  window.AudioContext = function (...a) { const c = new Real(...a); window.__audio.push(c); return c; };
  window.AudioContext.prototype = Real.prototype;
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e })), EMAIL);
await page.reload();
await page.locator("#homeHello", { hasText: "Jess" }).waitFor();

// The page measured as a shopper sees it.
const measure = () => page.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const out = { small: [], tiny: [], symbols: [], purple: [] };
  for (const el of document.querySelectorAll("#view button, #view a, #view summary, #view select, #view input, #foot button, .rl-sheet button, .rl-sheet a, .rl-sheet summary, .avatar")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll("#view *, .rl-sheet *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 12) out.tiny.push(el.textContent.trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll("*")) { const s = getComputedStyle(el); if (/rgb\((48, 37, 93|91, 33, 182|124, 77, 189|30, 27, 75|109, 40, 217|76, 29, 149)\)/.test(s.backgroundImage + s.backgroundColor)) out.purple.push(el.className || el.tagName); }
  return out;
});
for (const pg of ["profile", "receipts", "discover", "radar", "me"]) {
  await page.evaluate(p => window.go(p), pg); await page.waitForTimeout(1200);
  const m = await measure();
  assert.deepEqual(m.small, [], pg + ": everything tappable is at least 44px tall");
  assert.deepEqual(m.tiny, [], pg + ": no text smaller than 12px");
  assert.deepEqual(m.symbols, [], pg + ": no symbol characters used as icons in buttons");
  assert.deepEqual(m.purple, [], pg + ": no purple");
}
await page.locator(".avatar").click(); await page.getByRole("heading", { name: "Profile", exact: true }).waitFor(); await page.locator("#mePage .rl-arow").first().waitFor(); await page.waitForTimeout(600);
for (const sub of [null, "Email connection", "Email permission", "Download my data", "Delete my account", "Help", "Two-step sign-in"]) {
  if (sub) { await page.locator(".rl-arow", { hasText: sub }).first().click(); await page.getByRole("button", { name: "Back to Profile" }).waitFor(); await page.waitForTimeout(300); }
  const m = await measure(), where = "Profile" + (sub ? " > " + sub : "");
  assert.deepEqual(m.small, [], where + ": everything tappable is at least 44px tall");
  assert.deepEqual(m.tiny, [], where + ": no text smaller than 12px");
  assert.deepEqual(m.symbols, [], where + ": no symbol characters used as icons");
  assert.deepEqual(m.purple, [], where + ": no purple");
  if (sub) await page.getByRole("button", { name: "Back to Profile" }).click();
}
// Download my data: one file with the shopper's data, made once however fast the button is tapped twice.
await page.locator(".rl-arow", { hasText: "Download my data" }).first().click();
const dlBtn = page.locator(".rl-sheet, #mePage").getByRole("button", { name: "Download my data" }).last();
const [dl] = await Promise.all([page.waitForEvent("download"), dlBtn.click(), dlBtn.click({ force: true }).catch(() => {})]);
assert.match(dl.suggestedFilename(), /^relay-my-data-\d{4}-\d{2}-\d{2}\.json$/);
const saved = JSON.parse(await (await import("node:fs/promises")).readFile(await dl.path(), "utf8"));
assert.equal(saved.account.email, EMAIL); assert.equal(saved.receipts.length, 2);
await page.getByText("Your file is downloading.").waitFor();
assert.equal(state.exports, 1, "a second tap while it's preparing doesn't make a second file");
await page.getByRole("button", { name: "Back to Profile" }).click();
console.log("ok - Download my data gives one file with the shopper's data, once per tap");
// The legal pages are real pages, reachable from the Account page.
for (const [label, heading] of [["Terms of use", "Terms of use"], ["Privacy policy", "Privacy policy"]]) {
  const href = await page.locator(".rl-arow", { hasText: label }).getAttribute("href");
  const lp = await ctx.newPage(); await lp.goto(new URL(href, origin + "/index.html").href);
  await lp.getByRole("heading", { name: heading, level: 1 }).waitFor();
  assert.doesNotMatch(await lp.locator("body").innerText(), /\b(demo|sandbox|test mode|lorem|TODO)\b/i, label + ": no placeholder or test wording");
  await lp.close();
}
console.log("ok - no purple, 44px tap targets, no tiny text and no symbol icons on Profile, Receipts, Discover, Price alerts, Wrapped and every Account page");

// Wrapped: the story has no purple slides either.
await page.evaluate(() => window.go("me"));
await page.getByRole("button", { name: /Play your 2026 story/ }).click();
const slideBgs = [];
for (let k = 0; k < 14; k++) { await page.waitForTimeout(250); slideBgs.push(await page.locator(".rl-story-frame").evaluate(f => getComputedStyle(f).backgroundColor)); if (await page.getByRole("button", { name: "Watch again" }).count()) break; await page.keyboard.press("ArrowRight"); }
assert.ok(!slideBgs.some(c => /rgb\((48, 37, 93|91, 33, 182|30, 27, 75)\)/.test(c)), "no purple slides: " + slideBgs.join(" "));
assert.equal(await page.locator(".rl-story .sum").evaluate(n => getComputedStyle(n).backgroundImage), "none", "the summary card is a flat colour");
// The soundtrack: made by the app, on from the tap that opened the story, a 44px speaker button turns it off (remembered),
// and closing the story stops it.
assert.equal(await page.evaluate(() => window.__audio.length), 1, "the story makes its own music");
assert.equal(await page.evaluate(() => window.__audio[0].state), "running");
const snd = page.getByRole("button", { name: "Turn the music off" });
assert.ok((await snd.boundingBox()).height >= 44 && (await page.getByRole("button", { name: "Close" }).last().boundingBox()).height >= 44, "44px speaker and close buttons");
await snd.click();
await page.getByRole("button", { name: "Turn the music on" }).waitFor();
assert.equal(await page.evaluate(() => localStorage.getItem("relay.storySound.v1")), "off");
await page.waitForTimeout(600);
assert.equal(await page.evaluate(() => window.__audio[0].state), "closed", "turned off, the music stops");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: /Play your 2026 story/ }).click();
await page.locator(".rl-story-frame").waitFor(); await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => window.__audio.length), 1, "off stays off next time");
await page.getByRole("button", { name: "Turn the music on" }).click();
await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => window.__audio.length), 2); assert.equal(await page.evaluate(() => window.__audio[1].state), "running");
await page.keyboard.press("Escape"); await page.waitForTimeout(600);
assert.equal(await page.evaluate(() => window.__audio[1].state), "closed", "closing the story stops the music");
assert.equal(await page.evaluate(() => localStorage.getItem("relay.storySound.v1")), "on");
console.log("ok - the Wrapped story uses flat colours from Relay's palette, with its own music (off is remembered, closing stops it)");

// A real dark theme that follows the phone (this browser asks for dark), a press effect on buttons, and the keyboard
// space is tracked for sheets.
assert.equal(await page.evaluate(() => document.querySelector('meta[name="color-scheme"]').content), "light dark");
assert.deepEqual(await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color]), ["rgb(0, 0, 0)", "rgb(255, 255, 255)"],
  "in dark mode the page is black with white text");
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#foot")).backdropFilter !== "none"), true, "the tab bar is frosted glass");
assert.ok(await page.evaluate(() => [...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => /button:active/.test(r.selectorText || "") && /scale/.test(r.cssText)); } catch { return false; } })), "buttons shrink a little when pressed");
assert.match(await page.locator("#foot button").first().evaluate(b => getComputedStyle(b).transitionProperty), /transform/);
assert.match(await page.evaluate(() => document.querySelector('meta[name="viewport"]').content), /interactive-widget=resizes-content/);
assert.ok(await page.evaluate(() => [...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => /--rl-kb/.test(r.cssText)); } catch { return false; } })), "sheets make room for the keyboard");
console.log("ok - follows the phone's light or dark setting, press effect on buttons, sheets make room for the keyboard");

// A double tap on Watch price watches it once (it doesn't watch then unwatch).
await page.evaluate(() => window.go("discover"));
const watchBtn = page.locator('[data-watch="shopify:kick:variant:1"]');
// Discover redraws its list once live prices arrive, which can swap the button out mid-scroll: retry until it settles.
await watchBtn.waitFor(); await page.waitForTimeout(800);
for (let i = 0; ; i++) { try { await watchBtn.scrollIntoViewIfNeeded({ timeout: 3000 }); break; } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(400); } }
await page.waitForTimeout(600);
const box = await watchBtn.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("relay-radar-v2") || "{}")).length), 1, "watched once, not toggled back");
await page.waitForTimeout(600);
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("relay-radar-v2") || "{}")).length), 0, "a separate tap later still works");
console.log("ok - a quick double tap only counts once; a later tap still works");

// Caching: next visit shows the wallet straight away from this device, even while Relay is slow to answer.
state.receiptsDelay = 4000;
await page.reload();
await page.locator("#walletPage").getByText("Long Jacket").waitFor({ timeout: 1500 });
console.log("ok - the wallet shows at once on the next visit, from what was loaded last time");
state.receiptsDelay = 0;

// Watches kept with the account come back to a phone that lost them.
state.serverWatches = [{ sku: "shopify:kick:variant:1", product: "Court Classic Trainers", variant: "White / UK 8", store: "Kick Lane", via: "item", lastSeenMinor: 8500 }];
await page.evaluate(() => localStorage.removeItem("relay-radar-v2"));
await page.reload();
await page.locator("#homeHello", { hasText: "Jess" }).waitFor();
await page.getByText("1 thing watched").waitFor();
console.log("ok - watches come back from the account when this device lost them");

// Signing out removes the copy kept on this device.
assert.ok(await page.evaluate(() => !!localStorage.getItem("relay.cache.v1")));
await page.locator(".avatar").click();
await page.getByRole("button", { name: "Sign out" }).click();
await page.locator(".rl-welcome").getByRole("button", { name: "Get started" }).waitFor();
assert.equal(await page.evaluate(() => localStorage.getItem("relay.cache.v1")), null, "nothing of the account left on the device");
console.log("ok - signing out removes the receipts kept on this device");

// A new shopper (no email connected yet) is shown how to start, not an empty screen.
state.connected = false;
await page.evaluate(() => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "N".repeat(43), email: "new.person@example.com" })));
await page.reload();
await page.getByRole("heading", { name: "Bring in your receipts" }).waitFor();
await page.getByRole("button", { name: "Connect your email" }).click();
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
console.log("ok - a new shopper's Home starts with how to bring their receipts in");

// No raw error text in the code paths that used to show it.
const acct = await readFile("account.js", "utf8");
assert.ok(!/res\.body\.detail/.test(acct) && !/body\.why/.test(acct), "no shop or push-service error text shown as-is");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS polish: colours, sizes, icons, press effect, double taps, caching, first-time shoppers, saved watches, plain errors");
await browser.close(); server.close();
