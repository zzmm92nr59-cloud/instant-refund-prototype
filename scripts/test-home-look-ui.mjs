// Browser test: the sign-in page and Home. Stubbed Relay server, made-up person and invented shops.
// Checks: the sign-in page is Relay's navy in light and dark mode (as the welcome story is), with Relay's name, a small
// wallet picture (hidden from screen readers), a white headline, three equal white buttons and Face ID in lime with its
// icon, all readable; it rises in, except where the phone asks for less motion; the next step (email) is back in the app's
// own colours, and Back from it returns to "Welcome back" when that's where it started. Home: each card shows its return
// date, and in the last week the days left (amber, red in the last three days) with those cards first; a card opens its
// own page, with the countdown, Start return (when the shop has a returns page) and "I'm sending this back". From Home,
// All receipts, the bell (Price alerts, with how many things are watched) and, through Receipts and Browse, Returns &
// swaps and Wrapped each open their page. Every screen passes the polish rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeCard, openHomeCard, closeSheet, openReceiptKind, goTab, bigCards } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const shortDay = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const receipt = (id, shop, item, pence, ago, extra) => ({ id, status: "pending", kind: "receipt", retailer: { name: shop, domain: null }, orderRef: "R-" + id.slice(0, 4), orderDate: day(-ago), totalPence: pence, currency: "GBP",
  category: "fashion", returnable: true, items: [{ name: item, qty: 1, pricePence: pence, category: "fashion" }], returns: null, ...extra });
const receipts = [
  // The shop's own date, 12 days away: plenty of time (green).
  receipt("11111111-1111-4111-8111-111111111111", "Kick Lane", "Court Classic Trainers", 8500, 2, { returns: { deadline: day(12) } }),
  // The shop's own date, 2 days away: urgent.
  receipt("22222222-2222-4222-8222-222222222222", "Glow Lab", "Vitamin C Serum", 2400, 26, { returns: { windowDays: 28, deadline: day(2) } }),
  // Six days left, and the shop has a returns page: Start return is the main button.
  receipt("33333333-3333-4333-8333-333333333333", "Harlow & Co", "Wool Coat", 12000, 24, { returns: { windowDays: 30, deadline: day(6), portalUrl: "https://returns.harlow.example/start" } }),
  // With the item's photo, on its way: the card is headed with the shop's name; the item's name is in Details.
  receipt("44444444-4444-4444-8444-444444444444", "Northfold", "Flow Flared Pant", 6900, 5, { hasImage: true, items: [{ name: "Flow Flared Pant", variant: "UK 8", qty: 1, pricePence: 6900, category: "fashion" }],
    delivery: { status: "shipped", carrier: "Royal Mail", at: day(-3) }, returnBy: { date: day(10), basis: "uk_law", from: "delivery" } }),
  // An app bought from Apple yesterday: can't be returned, so Wallet and Today leave it out (it stays in Receipts).
  receipt("55555555-5555-4555-8555-555555555555", "Apple", "Match Masters", 159, 1, { category: "digital", returnable: false, items: [{ name: "Match Masters", qty: 1, pricePence: 159, category: "digital" }] }),
  // Coffee pods bought today (usually can't go back): still on Home for a week, so a new purchase is there to see.
  receipt("66666666-6666-4666-8666-666666666666", "Nespresso", "Vertuo Pods", 4200, 0, { category: "food", returnable: false, items: [{ name: "Vertuo Pods", qty: 1, pricePence: 4200, category: "food" }] }),
  // The same a fortnight ago: gone from Home (it stays in Receipts).
  receipt("77777777-7777-4777-8777-777777777777", "Nespresso", "Original Pods", 3900, 14, { category: "food", returnable: false, items: [{ name: "Original Pods", qty: 1, pricePence: 3900, category: "food" }] }),
];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx); await bigCards(ctx);
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  if (/^\/relay\/my\/receipts\/[0-9a-f-]{36}\/image$/.test(p)) return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG });
  if (p === "/relay/auth/providers") return j({ google: true, microsoft: true, consent: { version: "v5", text: ["To work, Relay needs to see your receipts."] } });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 6e5 });
  if (p === "/relay/my/receipts") return j({ receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [{ sku: "shopify:fernway.example:101", product: "Linen Notebook", variant: "A5", lastSeenMinor: 1800 }, { sku: "shopify:fernway.example:102", product: "Desk Lamp", variant: "", lastSeenMinor: 4500 }] });
  if (p === "/relay/my/wrapped") return j({ year: new Date().getFullYear(), receipts: 4, spentPence: 29800, years: [{ year: new Date().getFullYear(), receipts: 4 }], industries: [], coverage: {} });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
// The polish rules, and readable colours, on whatever is showing in the given part of the page.
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0.5; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; }; // color-mix() comes back as color(srgb 0–1)
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
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
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(120);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/home-look-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const bgIs = sel => page.locator(sel).first().evaluate(n => getComputedStyle(n).backgroundColor);
const NAVY = "rgb(16, 24, 40)";

// 1. The sign-in page: Relay's navy whatever the phone's setting, the name, a small wallet picture, and the ways in.
await page.emulateMedia({ reducedMotion: "no-preference" });
await page.goto(origin + "/index.html");
await page.locator(".rl-welcome").waitFor();
await page.getByRole("button", { name: "I already have an account" }).click();
const sheet = page.locator(".rl-sheet");
await sheet.getByRole("heading", { name: "Welcome back" }).waitFor();
await page.waitForTimeout(1200); // the page has finished rising in
for (const scheme of ["light", "dark"]) {
  await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(80);
  assert.equal(await bgIs(".rl-sheet"), NAVY, "Relay's navy in " + scheme + " mode, as the welcome story");
  assert.equal(await sheet.getByRole("heading", { name: "Welcome back" }).evaluate(n => getComputedStyle(n).color), "rgb(255, 255, 255)");
}
await page.emulateMedia({ colorScheme: "light" });
assert.equal(await sheet.locator(".rl-wbrand").innerText(), "Relay");
assert.equal(await sheet.locator(".rl-sart").getAttribute("aria-hidden"), "true", "the picture is decoration, hidden from screen readers");
assert.match(await sheet.locator(".rl-sfront").innerText(), /Canvas Cruiser[\s\S]*Allbirds[\s\S]*12 days left/, "a real shop and thing, not a made-up one");
for (const name of ["Continue with Google", "Continue with Microsoft", "Continue with email"]) {
  const b = sheet.getByRole("button", { name }); await b.waitFor();
  assert.deepEqual(await b.evaluate(n => [getComputedStyle(n).backgroundColor, getComputedStyle(n).color]), ["rgb(255, 255, 255)", NAVY], name + ": white, navy words");
}
const face = sheet.getByRole("button", { name: "Sign in with Face ID or a passkey" });
await face.waitFor();
assert.equal(await face.locator("svg").count(), 1, "Face ID has its drawn icon");
assert.equal(await face.evaluate(n => getComputedStyle(n).color), "rgb(201, 216, 255)", "in Relay's soft blue (no lime, Connor 17 Nov 2026)");
assert.equal(await sheet.locator(".rl-jh").evaluate(n => getComputedStyle(n).animationName), "rlup", "the page rises in");
await polished("sign-in page", ".rl-sheet");
// Less motion: nothing moves.
await page.emulateMedia({ reducedMotion: "reduce" });
assert.equal(await sheet.locator(".rl-jh").evaluate(n => getComputedStyle(n).animationName), "none", "no animation where the phone asks for less motion");
// The next step is in the app's own colours; Back returns to the same page ("Welcome back", not "Create your account").
await sheet.getByRole("button", { name: "Continue with email" }).click();
await sheet.getByRole("heading", { name: "Continue with email" }).waitFor();
assert.equal(await sheet.evaluate(n => n.classList.contains("rl-signin")), false);
assert.equal(await bgIs(".rl-sheet"), NAVY, "the email step carries on in Relay's navy (Connor, 17 Nov 2026)");
assert.equal(await sheet.getByRole("heading", { name: "Continue with email" }).evaluate(n => getComputedStyle(n).color), "rgb(255, 255, 255)", "in white");
await sheet.getByRole("button", { name: "Back" }).click();
await sheet.getByRole("heading", { name: "Welcome back" }).waitFor();
assert.equal(await bgIs(".rl-sheet"), NAVY);
await page.waitForTimeout(450); // (a second tap on the same button within 400ms counts as a double tap)
await sheet.getByRole("button", { name: "Back" }).click();
await page.getByRole("button", { name: "Get started" }).click();
await sheet.getByRole("heading", { name: "Create your account" }).waitFor();
await page.waitForTimeout(300);
await polished("sign-in page, new", ".rl-sheet");
console.log("ok - the sign-in page: Relay's navy in light and dark, a wallet picture, white buttons, Face ID in lime, readable; the next step carries on in navy");

// 2. Home: each card shows its return date; in the last week, the days left, with those cards first.
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })), EMAIL);
await page.goto(origin + "/index.html");
await homeCard(page, "Court Classic Trainers").waitFor();
await page.waitForTimeout(500);
const card = name => homeCard(page, name);
const strip = name => card(name).locator(".h2-strip");
assert.equal(await card("Court Classic Trainers").locator(".h2-line-t b").innerText(), "Return by " + shortDay(day(12)));
assert.equal(await strip("Court Classic Trainers").count(), 0, "no countdown while there's more than a week");
assert.equal(await strip("Vitamin C Serum").innerText(), "2 days left");
assert.equal(await strip("Vitamin C Serum").getAttribute("class"), "h2-strip urgent", "red in the last three days");
assert.equal(await strip("Wool Coat").innerText(), "6 days left");
assert.equal(await strip("Wool Coat").getAttribute("class"), "h2-strip soon", "amber in the last week");
// (Receipts first, Home's default focus: they lead the page under "Needs you", one small card each.)
const order = await page.locator("#homePage .h2-feed > .h2-item.small .h2-line-t b").allInnerTexts();
assert.deepEqual(order.slice(0, 2), ["Vitamin C Serum", "Wool Coat"], "the ones about to run out come first");
assert.equal(await page.locator("#homePage .h2-feed > .h2-sec").first().innerText(), "Needs you", "under Needs you, at the top");
// No buttons on a card: the whole card opens its page, which has what you can do (Start return first when the shop has a
// returns page, then I'm sending this back).
assert.equal(await card("Court Classic Trainers").locator("button").count(), 0, "no buttons on the card itself");
assert.equal(await card("Court Classic Trainers").getAttribute("role"), "button", "the card is the button");
assert.match(await card("Court Classic Trainers").getAttribute("aria-label"), /^Kick Lane\. Court Classic Trainers\. Return by /);
assert.equal(await card("Court Classic Trainers").locator(".h2-one-n").innerText(), "Court Classic Trainers", "the card names what was bought");
assert.equal(await card("Court Classic Trainers").locator(".h2-head-t b").innerText(), "Kick Lane", "and the shop");
assert.equal(await card("Court Classic Trainers").locator(".h2-head-t b").evaluate(n => getComputedStyle(n).textTransform), "none");
let dsheet = await openHomeCard(page, "Court Classic Trainers");
assert.deepEqual(await dsheet.locator(".rl-dt-acts button").allInnerTexts(), ["I'm sending this back"]);
await dsheet.getByText("12 days left", { exact: true }).waitFor();
await dsheet.getByRole("button", { name: "Close" }).click(); await dsheet.waitFor({ state: "detached" });
await page.waitForTimeout(450);
dsheet = await openHomeCard(page, "Wool Coat");
assert.deepEqual(await dsheet.locator(".rl-dt-acts button").allInnerTexts(), ["Start return", "I'm sending this back"]);
assert.equal(await dsheet.getByRole("link", { name: /Start a return with/ }).count(), 0, "one way to start the return, not two");
await dsheet.getByRole("button", { name: "Close" }).click(); await dsheet.waitFor({ state: "detached" });
// A card with the item's photo: what it is, the shop, the price, and the parcel's news in a plain line.
const nf = card("Northfold");
await nf.locator(".h2-art.rl-has-photo img").waitFor();
assert.equal(await nf.locator(".h2-one-n").innerText(), "Flow Flared Pant");
assert.equal(await nf.locator(".h2-head-t b").innerText(), "Northfold");
assert.equal(await nf.locator(".h2-one-p").innerText(), "£69.00");
assert.equal(await nf.locator(".h2-line-t b").innerText(), "On its way");
assert.ok(!/Return by|days? left/.test(await nf.innerText()), "a date Relay worked out (UK law's minimum) is never shown as a return date or countdown");
await page.waitForTimeout(450);
dsheet = await openHomeCard(page, "Northfold");
assert.equal(await dsheet.getByRole("heading").first().innerText(), "Flow Flared Pant", "its page names what was bought");
assert.equal(await dsheet.locator(".rl-dt-sub").innerText(), "Northfold");
assert.match(await dsheet.locator(".rl-dt-facts").innerText(), /Price\s+£69\.00\s+Size or colour\s+UK 8\s+Ordered\s+\d+ \w+ \d{4}\s+Order number\s+R-4444/);
await dsheet.getByText("No return date in Northfold's email", { exact: true }).waitFor();
// (Still on its way, so no date even though the server counted one from a delivery: the screen never contradicts itself.)
await dsheet.getByText("By UK law you have at least 14 days from delivery to change your mind about most online orders. Relay adds the date once it arrives. Northfold may give longer.").waitFor();
assert.ok(!/days? left/.test(await dsheet.innerText()), "no countdown on its page either");
await dsheet.getByRole("button", { name: "Close" }).click(); await dsheet.waitFor({ state: "detached" });
await polished("home", "#view");
console.log("ok - Home's cards show the return date, the last week's days left (amber, red) first, lead with what was bought, and open a page with the countdown, Start return and I'm sending this back");
// The other two ways Home can look (Profile, Home layout): Today (what needs you, then a list) and Wallet (photo squares).
// With nothing chosen, Home is Wallet (Connor's pick, 15 Nov).
await page.evaluate(() => { localStorage.removeItem("relay-home-look"); window.go("receipts"); });
await page.evaluate(() => window.go("profile"));
await page.locator("#homePage .hl-sq").first().waitFor();
assert.equal(await page.locator("#homePage .h2-feed > .h2-item:not(.small)").count(), 0, "no big cards by default");
// Today was taken away (Connor, 17 Nov 2026): a phone that had it shows Wallet.
for (const look of ["today", "wallet"]) {
  await page.evaluate(l => { localStorage.setItem("relay-home-look", l); window.go("receipts"); }, look);
  await page.evaluate(() => window.go("profile"));
  if (look === "today") {
    await page.locator(".hl-sq").first().waitFor();
    assert.equal(await page.locator(".hl-row").count(), 0, "no Today rows: a phone that had Today shows Wallet");
    continue;
  } else {
    await page.locator(".hl-sq").first().waitFor();
    // (Each part of Home has its own grid, so the two squares are looked for in one with two or more.)
    const g = await page.evaluate(() => { const grid = [...document.querySelectorAll(".hl-grid")].find(x => x.querySelectorAll(".hl-sqpic").length >= 2); const a = [...grid.querySelectorAll(".hl-sqpic")].map(x => x.getBoundingClientRect()); return { w: a[0].width, h: a[0].height, row: Math.abs(a[0].top - a[1].top) < 1 }; });
    assert.ok(g.w > 150 && Math.abs(g.w - g.h) < 1 && g.row, "two big squares a row: " + JSON.stringify(g));
    assert.ok(await page.locator(".hl-tag").count() >= 1, "a label on what needs something");
    // Under each square, the product as a person would say it, never the shop's name twice (Connor, 17 Nov 2026).
    const caps = await page.locator(".hl-sq").evaluateAll(b => b.map(x => [x.querySelector(".hl-sqs")?.textContent, x.querySelector(".hl-sqn")?.textContent || null]));
    assert.ok(caps.every(([shop, name]) => !name || name.toLowerCase() !== String(shop).toLowerCase()), "no shop name twice: " + JSON.stringify(caps));
    assert.deepEqual(await page.evaluate(() => [window.relayCleanName("lululemon Align™ High-Rise Pant", "lululemon"), window.relayCleanName("Nespresso", "Nespresso"),
      window.relayCleanName("W Restfeel Slide TOPK/TOPK/SODA", "lululemon"), window.relayCleanName("iPhone 15 Case", "Apple")]), ["Align High-Rise Pant", "", "W Restfeel Slide", "iPhone 15 Case"]);
    // The top row: what's on Home, then the rest of Relay, scrolled sideways.
    const chipNames = await page.locator("#view .h2-chip").allInnerTexts();
    assert.deepEqual(chipNames.slice(0, 2), ["For you", "Watching"]);
    for (const c of ["Swap & resell", "Auctions", "Shops on Relay", "Wrapped"]) assert.ok(chipNames.includes(c), c + " is on the top row");
    assert.equal(await page.locator("#view .h2-chips").evaluate(n => getComputedStyle(n).overflowX), "auto", "scrolls sideways");
    await page.locator("#view .h2-chip", { hasText: "Watching" }).click();
    await page.getByText("Nothing watched yet.", { exact: false }).waitFor();
    await page.locator("#view .h2-chip", { hasText: "For you" }).click(); await page.locator(".hl-sq").first().waitFor();
  }
  assert.equal(await page.locator("#homePage .h2-feed", { hasText: "Match Masters" }).count(), 0, look + ": an app that can't be returned isn't on Home");
  assert.equal(await page.locator("#homePage .h2-feed", { hasText: "Vertuo Pods" }).count(), 1, look + ": something bought this week is on Home, even if it can't go back");
  assert.equal(await page.locator("#homePage .h2-feed", { hasText: "Original Pods" }).count(), 0, look + ": not when it's older than a week");
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
  await polished("home " + look, "#view");
  await page.locator(look === "today" ? ".hl-row" : ".hl-sq").first().click();
  await page.locator(".rl-sheet").last().waitFor(); await page.waitForTimeout(450); await page.locator(".rl-back").last().click({ position: { x: 20, y: 20 } }); await page.locator(".rl-back").waitFor({ state: "detached" });
}
await page.evaluate(() => localStorage.setItem("relay-home-look", "cards"));
console.log("ok - Home's other layouts: Today is gone (it shows Wallet) and Wallet (two big squares a row, labels), polished, each opens its page");

// 3. From Home: All receipts, the bell (how many things are watched) and, through Receipts and Browse, Returns & swaps and
//    Wrapped, each open their page. (The four tiles under the old wallet are gone; these are where each now lives.)
await page.getByRole("button", { name: "Price alerts, 2 watched" }).waitFor();
assert.equal(await page.locator("#view .profile-row").count(), 0, "no old Price alerts row");
await homeCard(page, "All receipts").click();
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
await goTab(page, "Home"); await homeCard(page, "Court Classic Trainers").waitFor();
await page.getByRole("button", { name: "Price alerts, 2 watched" }).click();
await page.getByRole("heading", { name: "Price alerts", exact: true }).waitFor();
await goTab(page, "Receipts"); await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
await openReceiptKind(page, "Returns and swaps");
await page.getByRole("heading", { name: "Returns & swaps", exact: true }).waitFor();
await goTab(page, "Receipts");
await page.getByRole("button", { name: /^Relay Wrapped \d{4}/ }).click();
await page.locator(".rl-wr-play").waitFor();
assert.equal(await page.evaluate(() => window.page), "wrapped", "Wrapped opens its own page from Receipts");
console.log("ok - All receipts, Price alerts (2 watched) on Home's bell, Returns & swaps from Receipts and Wrapped from Receipts each open their page");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS the sign-in page and Home: Relay's navy, a wallet picture, return dates and countdowns, and the way to every page (stubbed server)");
await browser.close(); server.close();
