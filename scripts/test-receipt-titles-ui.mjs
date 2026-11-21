// Browser test: what a receipt is called, in Receipts, on Home and on its page (stubbed Relay server, a made-up person,
// invented shops, restaurants and games). Nothing here proves a real phone.
// Checks (Connor, 21 Nov 2026: "Just Eat is called noodle and some say return now"):
//  1. Receipts is shop first: the title is the business (the restaurant for a takeaway through an app, the game for an
//     in-app purchase, otherwise the shop), and the line under it says what was bought and when. A takeaway through an app
//     with no restaurant named is the app ("Uber Eats").
//  2. Something digital (game coins, a subscription) gets no return countdown, no "Return today", no reminder and no red
//     number on the tab, even though its email gives 14 days to cancel. Its page says that, plainly, with the email's link.
//     A parcel with a return date from the shop's email still shows its countdown.
//  3. A refund is shown in full under a long order: what was bought gives way first.
//  4. Search still finds receipts by what was bought, by the restaurant and by the game.
//  5. Home names the same business, and has no return line for the digital ones.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname, dirname } from "node:path";
import { skipInterests, homeReady, goTab, closeSheet } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise((r) => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOT = process.env.SHOT || "/tmp/shots/receipt-titles.png";

const EMAIL = "robin.tester@example.com", day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const short = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
let n = 0;
const base = (shop, domain, extra) => ({ id: "aaaaaaaa-0000-4000-8000-" + String(++n).padStart(12, "0"), status: "confirmed", kind: "receipt", retailer: { name: shop, domain },
  orderDate: day(-1), currency: "GBP", category: "food", returnable: false, returns: null, gmailId: "msg" + n, ...extra });
const dish = (name, p) => ({ name, qty: 1, pricePence: p, category: "food" });
const TAKEAWAY = base("Just Eat", "just-eat.co.uk", { merchant: "Golden Lantern", orderDate: day(-2), totalPence: 2813,
  items: [dish("Sweet and Sour Chicken Balls", 699), dish("Spicy Singapore Chow Mein", 749), dish("Salt and Chilli Chips", 300), dish("Prawn Crackers", 310)] });
const UBER = base("Uber Eats", "uber.com", { merchant: "Harbour Grill", orderDate: day(-4), totalPence: 1740, items: [] });
const UBER_NONE = base("Uber Eats", "uber.com", { orderDate: day(-17), totalPence: 1747, items: [] });
const cancel = (deadline) => ({ cancelWithin: true, windowDays: 14, windowFrom: "order", deadline, cancelUrl: "https://reportaproblem.apple.com/",
  instructions: ["To cancel your purchase within 14 days of receiving this invoice, report a problem or contact us."] });
const COINS = base("Apple", "apple.com", { category: "digital", orderDate: day(-14), totalPence: 159, items: [{ name: "Stack of Coins", variant: "Puzzle Pals", qty: 1, pricePence: 159 }],
  returns: cancel(day(0)), reminder: "off", notReturnableReason: "Digital purchases and subscriptions usually can't be returned. Cancel or ask the provider instead." });
const OFFER = base("Apple", "apple.com", { category: "digital", orderDate: day(-11), totalPence: 319, items: [{ name: "Store Screen Offer 14 c", variant: "Puzzle Pals", qty: 1, pricePence: 319 }], returns: cancel(day(3)), reminder: "off" });
const MUSIC = base("Apple", "apple.com", { category: "digital", orderDate: day(-5), totalPence: 1099, items: [{ name: "Apple Music Individual (Monthly)", qty: 1, pricePence: 1099 }], returns: cancel(day(9)), reminder: "off" });
const SCARF = base("Fern & Finch", "fernfinch.example", { category: "fashion", returnable: true, orderDate: day(-9), totalPence: 4200, reminder: "off",
  items: [{ name: "Ribbed Knit Scarf", qty: 1, pricePence: 4200, category: "fashion" }], returns: { deadline: day(5), windowDays: 14, windowFrom: "order", instructions: [] } });
const groceries = Array.from({ length: 41 }, (_, i) => ({ name: i ? "Pantry Item " + i : "Hazelnut Cocoa Spread 750g", qty: 1, pricePence: i ? 200 : 450, category: "food" }));
const SHOP = base("Meadow Market", "meadowmarket.example", { orderDate: day(-15), totalPence: 9940, items: groceries,
  returnProgress: { refundedAt: day(-12), refundPence: 690, currency: "GBP" } });
const receipts = [TAKEAWAY, UBER, MUSIC, SCARF, OFFER, COINS, SHOP, UBER_NONE];

const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.addInitScript((e) => { try { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); } catch (x) {} }, EMAIL);
const log = [];
await ctx.route("https://**/*", async (route) => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
  if (!p.startsWith("/relay/")) return route.abort();
  log.push(m + " " + p);
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 6e5, others: [] });
  if (p === "/relay/my/receipts") return j({ receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Robin Tester", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [] });
  return j({});
});
const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(origin + "/index.html");
await homeReady(page);
await page.locator("#homePage .h2-sec").first().waitFor();
await page.waitForTimeout(600);

// 5 (first, as the app opens on Home). The same business on Home, and no return line for the digital ones.
const homeSq = page.locator("#homePage .hl-sq");
for (const name of ["Golden Lantern", "Harbour Grill"]) assert.ok(await homeSq.filter({ hasText: name }).count(), "Home names the restaurant " + name);
const homeText = await page.locator("#homePage").innerText();
assert.ok(!/Return to (Apple|Puzzle Pals)|Puzzle Pals[^\n]*Return by|Return today/.test(homeText), "no return line for game coins on Home\n" + homeText);
assert.equal(await page.evaluate(() => window.__relayDue || 0), 0, "no red number for coins whose cancel window ends today");
console.log("ok - Home names the restaurant, and game coins have no return line or red number");

// 1. Receipts: shop first.
await page.evaluate(() => window.go("receipts"));
const rows = page.locator("#receiptsPage .rl-rr");
await rows.first().waitFor();
await page.waitForTimeout(500);
const row = (title) => rows.filter({ has: page.locator(".rl-rr-mid > b", { hasText: new RegExp("^" + title.replace(/[()&]/g, "\\$&") + "$") }) });
const sub = async (title) => (await row(title).first().locator(".rl-rr-sub").textContent()).replace(/\s+/g, " ").trim();
const titles = await page.locator("#receiptsPage .rl-rr-mid > b").allInnerTexts();
for (const t of ["Golden Lantern", "Harbour Grill", "Uber Eats", "Puzzle Pals", "Apple", "Fern & Finch", "Meadow Market"]) assert.ok(titles.includes(t), "a row titled " + t + ": " + JSON.stringify(titles));
for (const t of ["Spicy Singapore Chow Mein", "Stack of Coins", "Sweet and Sour Chicken Balls", "Just Eat"]) assert.ok(!titles.some((x) => x.startsWith(t)), "no row titled by an item or a platform (" + t + ")");
let s = await sub("Golden Lantern");
assert.ok(s.startsWith("Just Eat, "), "the platform under the restaurant: " + s); assert.ok(s.endsWith(short(day(-2))), "and the day: " + s);
assert.ok(!/·/.test(s), "no dots: " + s);
const gaps = await row("Golden Lantern").locator(".rl-rr-sub").evaluate((e) => e.innerText.replace(/\n/g, ""));
assert.ok(/^Just Eat, \S/.test(gaps), "a space after each comma, as drawn: " + JSON.stringify(gaps));
assert.equal(await sub("Harbour Grill"), "Uber Eats, " + short(day(-4)));
assert.equal(await sub("Uber Eats"), short(day(-17)), "no restaurant named: the app is the title, the day under it");
s = await sub("Puzzle Pals"); assert.ok(/^Apple, (Stack of Coins|Store Screen Offer 14 c), /.test(s), "the game is the title, the coins under it: " + s);
// (A name too long for the line ends in "…" with its comma, the day after it; the whole name is still read out.)
const offer = row("Puzzle Pals").filter({ hasText: "Store Screen" });
assert.match(await offer.locator(".rl-rr-mid .rl-sr").textContent(), /^Apple, Store Screen Offer 14 c, /, "read out whole");
assert.equal(await offer.locator(".rl-rr-what").textContent(), "Store Screen Offer 14 c,");
assert.match(await sub("Apple"), /^Apple Music Individual \(Monthly\), /);
assert.match(await sub("Fern & Finch"), /^Ribbed Knit Scarf, /);
console.log("ok - Receipts is shop first: the restaurant, the game or the shop, with what was bought and when underneath");

// 2. No countdown on anything digital; the parcel keeps its own.
for (const t of ["Puzzle Pals", "Apple"]) {
  const r = row(t);
  for (let i = 0; i < await r.count(); i++) {
    assert.equal(await r.nth(i).locator(".rl-rr-chip").count(), 0, t + " has no return chip");
    assert.ok(!/Return today|days? left/.test(await r.nth(i).innerText()), t + ": no countdown");
  }
}
assert.match(await row("Fern & Finch").locator(".rl-rr-chip").innerText(), /^5 days left$/, "a parcel with the shop's return date keeps its chip");
assert.ok(!/Return today/.test(await page.locator("#receiptsPage").innerText()), "no 'Return today' anywhere on Receipts");
// Its page: the email's own window to cancel, said plainly, with its link, and no return wording or reminder.
await row("Puzzle Pals").first().locator(".rl-rr-main").click();
const detail = row("Puzzle Pals").first().locator(".rl-rr-detail");
await detail.waitFor();
const dt = await detail.innerText();
assert.match(dt, /You can cancel within 14 days of the invoice, as the email says\./);
const ask = detail.getByRole("link", { name: "Ask Apple to cancel" });
assert.equal(await ask.getAttribute("href"), "https://reportaproblem.apple.com/");
for (const w of ["Return by", "days to return", "Return today", "Remind me", "Start a return", "Usually can't be returned"]) assert.ok(!dt.includes(w), "no '" + w + "' on an in-app purchase's page\n" + dt);
await row("Puzzle Pals").first().locator(".rl-rr-main").click();
console.log("ok - game coins and a subscription have no countdown or 'Return today'; the page says the 14 days to cancel with Apple's link; a parcel keeps its chip");

// 3. A refund under a long order is shown whole; what was bought gives way.
s = await sub("Meadow Market");
assert.ok(s.includes("Refunded £6.90") && s.endsWith(short(day(-15))), "the refund and the day are shown: " + s);
assert.ok(!/Hazelnut Cocoa Spread 750g and 40 more/.test(s), "what was bought gave way: " + s);
assert.match(await row("Meadow Market").locator(".rl-rr-mid .rl-sr").textContent(), /^Hazelnut Cocoa Spread 750g and 40 more, Refunded £6\.90, /, "and is still read out");
const clipped = await row("Meadow Market").locator(".rl-rr-sub > span").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 && !e.classList.contains("rl-rr-what")).length);
assert.equal(clipped, 0, "nothing but what was bought is cut short");
const fits = await row("Meadow Market").locator(".rl-rr-sub").evaluate((e) => e.scrollWidth <= e.clientWidth + 1);
assert.ok(fits, "the line fits: " + s);
console.log("ok - a refund under a 41-item order is shown in full: " + s);

// 4. Search: by what was bought, by the restaurant, by the game.
const search = page.locator("#receiptsPage input[type=search]").first();
for (const [q, title] of [["chow mein", "Golden Lantern"], ["golden lantern", "Golden Lantern"], ["stack of coins", "Puzzle Pals"], ["puzzle pals", "Puzzle Pals"], ["hazelnut", "Meadow Market"]]) {
  await search.fill(q); await page.waitForTimeout(200);
  const shown = await page.locator("#receiptsPage .rl-rr:visible .rl-rr-mid > b").allInnerTexts();
  assert.ok(shown.length && shown.every((t) => t === title), "searching '" + q + "' shows " + title + ": " + JSON.stringify(shown));
}
await search.fill(""); await page.waitForTimeout(300);
await page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); window.scrollTo(0, 0); });
console.log("ok - search finds receipts by item, restaurant and game");

// The receipt's page from Home names the same business.
await goTab(page, "Home"); await page.locator("#homePage .hl-sq").first().waitFor();
await homeSq.filter({ hasText: "Golden Lantern" }).first().click();
const sheet = page.locator(".rl-sheet").last(); await sheet.waitFor(); await page.waitForTimeout(300);
assert.equal(await sheet.locator(".rl-dt-name h2").innerText(), "Golden Lantern");
assert.match(await sheet.locator(".rl-dt-sub").innerText(), /^Just Eat, Sweet and Sour Chicken Balls and 3 more$|^Just Eat, Spicy Singapore Chow Mein and 3 more$/);
await closeSheet(page); await page.waitForTimeout(300);
console.log("ok - the receipt's page from Home is titled by the restaurant too");

// The screenshot of the Receipts list.
await goTab(page, "Receipts"); await rows.first().waitFor(); await page.waitForTimeout(700);
// (Nothing left open, and the list under the categories, from its first receipt.)
for (const open of await page.locator("#receiptsPage .rl-rr-main[aria-expanded=true]").all()) { await open.click(); await page.waitForTimeout(450); }
await page.evaluate(() => { const r = document.querySelector("#receiptsPage .rl-rr"); const box = r && r.closest(".rl-month, .rl-cal-card, section") || r; window.scrollTo(0, window.scrollY + box.getBoundingClientRect().top - 70); });
await page.waitForTimeout(400);
await mkdir(dirname(SHOT), { recursive: true });
await page.screenshot({ path: SHOT });
assert.deepEqual(errors, [], "no page errors");
await browser.close(); server.close();
console.log("PASS receipt titles: shop first, no countdown on digital purchases, refunds shown whole, search by item (" + SHOT + ")");
