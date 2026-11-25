// Browser test: receipt fields the email reader keeps that the app now shows (stubbed Relay server, made-up person and orders).
//  1. A stay paid at the hotel (payAtProperty): its page says nothing has been paid yet and it's paid at the hotel; Home and
//     Receipts show "£240.00 to pay", never as if paid; it isn't added to the month's total.
//  2. A booking that can be cancelled for a refund within 24 hours of booking (returns.cancelWithin, windowHours): the
//     email's sentence and until when, while it's open; nothing once it has passed; never a return countdown.
//  3. The shop's own total when PayPal took a different amount (shopTotalPence): "The shop's total was £42.00; PayPal took £45.99."
//  4. A free gift at £0.00 (item free): "Free gift" on its line, never "£0.00".
//  5. A pack with one price for all its lines (itemsCheck.pack): its lines show no price, never "£0.00".
//  6. An order paid partly with a gift card (giftCardPence, cardPaid): what the gift card paid and what the card paid, as the
//     email gives them. A receipt whose amount is only in its PDF says so on its row, never a blank.
//  7. A receipt from one of Relay's own test shops (testShop, marked by the server) is never shown without the testing tools
//     (CLAUDE.md rule 15).
//  8. An order the shop edited after it was paid (amended.amountDuePence): "£20.00 still to pay to <shop>", with the date of the
//     invoice that says so, only when the server has the amount.
// RELAY_SHOTS=<folder> also saves a 390x844 screenshot of each page there.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname, join } from "node:path";
import { skipInterests, homeReady } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise((r) => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.RELAY_SHOTS || ""; if (SHOTS) await mkdir(SHOTS, { recursive: true });

const EMAIL = "sam.tester@example.com", day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const base = (id, shop, extra) => ({ id, status: "pending", kind: "receipt", retailer: { name: shop, domain: null }, orderRef: "R-" + id.slice(0, 4), orderDate: day(-1), currency: "GBP",
  category: "other", returnable: true, returns: null, gmailId: "m" + id.slice(0, 8), ...extra });
const SENTENCE = "You may cancel your flight booking and claim a refund without penalty, up to 24 hours from when you made the original booking.";
const HOTEL = base("a1111111-1111-4111-8111-111111111111", "Booking.com", { merchant: "Harbour View Hotel", totalPence: 24000, category: "travel", returnable: false, payAtProperty: true,
  items: [{ name: "Double Room", qty: 1, pricePence: 24000, lineTotal: true, variant: "2 nights" }], itemsCheck: { complete: true, itemsPence: 24000, expectedPence: 24000, missingPence: 0 } });
const sentAt = new Date(Date.now() - 3 * 36e5);
const FLIGHT = base("a2222222-2222-4222-8222-222222222222", "Skyway Air", { totalPence: 18950, orderDate: sentAt.toISOString().slice(0, 10), sentAt: sentAt.toISOString(), category: "travel", returnable: false,
  items: [{ name: "Flight to Lisbon", qty: 1, pricePence: 18950 }], itemsCheck: { complete: true, itemsPence: 18950, expectedPence: 18950, missingPence: 0 },
  returns: { windowHours: 24, windowFrom: "order", cancelWithin: true, instructions: [SENTENCE] } });
const OLDFLIGHT = base("a3333333-3333-4333-8333-333333333333", "Cloudhop", { totalPence: 9900, orderDate: day(-5), sentAt: new Date(Date.now() - 5 * 864e5).toISOString(), category: "travel", returnable: false,
  items: [{ name: "Flight to Dublin", qty: 1, pricePence: 9900 }], itemsCheck: { complete: true, itemsPence: 9900, expectedPence: 9900, missingPence: 0 },
  returns: { windowHours: 24, windowFrom: "order", cancelWithin: true, instructions: [SENTENCE] } });
const PAYPAL = base("a4444444-4444-4444-8444-444444444444", "Tidepool Prints", { totalPence: 4599, shopTotalPence: 4200, shopTotalPaidVia: "paypal.com", orderDate: day(-2),
  items: [{ name: "Harbour at Dawn print", qty: 1, pricePence: 4200 }], itemsCheck: { complete: true, itemsPence: 4200, expectedPence: 4200, missingPence: 0 } });
const GIFT = base("a5555555-5555-4555-8555-555555555555", "Glow Lab", { totalPence: 2800, orderDate: day(-3), category: "beauty",
  items: [{ name: "Vitamin C Serum 30ml", qty: 1, pricePence: 2800 }, { name: "Mini Cleanser Trial Set", qty: 1, pricePence: 0, lineTotal: true, free: true }], itemsCheck: { complete: true, itemsPence: 2800, expectedPence: 2800, missingPence: 0 } });
const PACK = base("a6666666-6666-4666-8666-666666666666", "Pixel Forge", { totalPence: 999, orderDate: day(-4), category: "digital", returnable: false,
  items: [{ name: "Starter Sword", qty: 1, pricePence: null }, { name: "Oak Shield", qty: 1, pricePence: null }, { name: "500 Gold", qty: 1, pricePence: null }],
  itemsCheck: { complete: true, itemsPence: 999, expectedPence: 999, missingPence: 0, pack: true } });
// For the month's total: a stay paid at the hotel and a book in the same month long ago. Only the book counts.
const OLDSTAY = base("a7777777-7777-4777-8777-777777777777", "Booking.com", { merchant: "Quayside Inn", totalPence: 31000, orderDate: "2025-03-10", category: "travel", returnable: false, payAtProperty: true,
  items: [{ name: "Twin Room", qty: 1, pricePence: 31000, lineTotal: true }], itemsCheck: { complete: true, itemsPence: 31000, expectedPence: 31000, missingPence: 0 } });
const BOOK = base("a8888888-8888-4888-8888-888888888888", "Page Turner", { totalPence: 1200, orderDate: "2025-03-12", items: [{ name: "A Novel", qty: 1, pricePence: 1200 }],
  itemsCheck: { complete: true, itemsPence: 1200, expectedPence: 1200, missingPence: 0 } });
const GIFTCARD = base("a9999999-9999-4999-8999-999999999999", "Teapot Corner", { totalPence: 4700, orderDate: day(-20), category: "home", giftCardPence: 625, cardPaid: { label: "Visa", pence: 4075 },
  items: [{ name: "Ceramic Teapot", qty: 1, pricePence: 2200 }, { name: "Breakfast Tea 250g", qty: 1, pricePence: 2500 }], itemsCheck: { complete: true, itemsPence: 4700, expectedPence: 4700, missingPence: 0, giftCardPence: 625 } });
const PDFONLY = base("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Northbridge Institute", { totalPence: null, currency: null, orderDate: day(-25), detailsInAttachment: "pdf", items: [],
  itemsCheck: { complete: false, itemsPence: 0, expectedPence: null, missingPence: null, inAttachment: "pdf" } });
const TESTSHOP = base("abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Kestrel Test Kicks", { totalPence: 9500, orderDate: day(-1), testShop: true,
  items: [{ name: "Trail Runner Shoes", qty: 1, pricePence: 9500 }], itemsCheck: { complete: true, itemsPence: 9500, expectedPence: 9500, missingPence: 0 } });
// An order the shop edited after it was paid (Shopify's invoice, worker/gmail.js attachEdits): what's still to pay, and one
// edited order whose invoice gave no amount to pay (nothing is said about paying).
const EDITED = base("accccccc-cccc-4ccc-8ccc-cccccccccccc", "Linden Lane", { totalPence: 12000, orderDate: day(-30), category: "fashion",
  amended: { at: "2026-11-21T10:00:00.000Z", changes: 1, byInvoice: true, amountDuePence: 2000 },
  items: [{ name: "Wool Coat", qty: 1, pricePence: 12000 }], itemsCheck: { complete: true, itemsPence: 12000, expectedPence: 12000, missingPence: 0 } });
const EDITED_NODUE = base("addddddd-dddd-4ddd-8ddd-dddddddddddd", "Copper Fern", { totalPence: 5000, orderDate: day(-31), category: "fashion",
  amended: { at: "2026-11-20T10:00:00.000Z", changes: 1, byInvoice: true },
  items: [{ name: "Linen Shirt", qty: 1, pricePence: 5000 }], itemsCheck: { complete: true, itemsPence: 5000, expectedPence: 5000, missingPence: 0 } });
const RECEIPTS = [HOTEL, FLIGHT, OLDFLIGHT, PAYPAL, GIFT, PACK, OLDSTAY, BOOK, GIFTCARD, PDFONLY, TESTSHOP, EDITED, EDITED_NODUE];

const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.addInitScript((e) => { try { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); } catch (x) {} }, EMAIL);
await ctx.route("https://**/*", async (route) => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
  if (!p.startsWith("/relay/")) return route.abort();
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 6e5, others: [] });
  if (p === "/relay/my/receipts") return j({ receipts: RECEIPTS });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Tester", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [] });
  return j({});
});
const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(origin + "/index.html");
await homeReady(page);
await page.locator("#homePage .h2-sec, #homePage .hx > *").first().waitFor();
await page.waitForTimeout(600);
if (SHOTS) await page.screenshot({ path: join(SHOTS, "0-home.png") });

const sheet = () => page.locator(".rl-sheet").last();
async function openFromHome(shop, shot) {
  await page.locator("#homePage .hl-sq, #homePage .hx-sq, #homePage .hx-live", { hasText: shop }).first().click(); await sheet().waitFor(); await page.waitForTimeout(400);
  const t = await sheet().innerText();
  if (SHOTS && shot) {
    // The part of the page that says it, in view.
    await sheet().locator(".rl-po-now, .rl-rr-list").first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(200); await page.screenshot({ path: join(SHOTS, shot) });
  }
  return t;
}
async function shut() { const b = page.locator(".rl-back").last(); await b.click({ position: { x: 10, y: 10 } }); await b.waitFor({ state: "detached" }).catch(() => {}); }
const noDots = (t, what) => assert.ok(!/ · /.test(t), what + ": no facts glued with dots\n" + t);

// 1. Paid at the hotel.
const hotelSq = await page.locator("#homePage .hl-sq, #homePage .hx-sq, #homePage .hx-live", { hasText: "Harbour View Hotel" }).first().innerText();
assert.match(hotelSq, /£240\.00 to pay/, "Home doesn't show the stay as paid\n" + hotelSq);
let t = await openFromHome("Harbour View Hotel", "1-pay-at-hotel.png");
assert.match(t, /Nothing has been paid yet\. You pay £240\.00 at the hotel, as the booking email says\./, t);
assert.doesNotMatch(t, /Usually can.t be returned/, "a stay paid at the hotel never says it usually can't be returned");
assert.doesNotMatch(t, /Size or colour/, "a stay's nights are never called a size or colour");
assert.match(t, /To pay at the hotel\s+£240\.00/, t);
assert.ok(!/^Price\s/m.test(t), "no 'Price' as if paid\n" + t);
noDots(t, "hotel"); await shut();
console.log("ok - a stay paid at the hotel: nothing paid yet, paid at the hotel, '£240.00 to pay' on Home");

// 2. Cancel within 24 hours, still open; and one that has passed.
t = await openFromHome("Skyway Air", "2-cancel-24h.png");
assert.ok(t.includes(SENTENCE), "the email's own sentence\n" + t);
const end = new Date(sentAt.getTime() + 24 * 36e5);
const until = end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) + " on " + end.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
assert.ok(t.includes("You can cancel for a refund until " + until + "."), "until when\n" + t);
for (const w of ["Return by", "days left", "Return today", "Usually can't be returned", "Deadline passed"]) assert.ok(!t.includes(w), "no '" + w + "'\n" + t);
noDots(t, "flight"); await shut();
t = await openFromHome("Cloudhop");
assert.ok(!t.includes(SENTENCE) && !/cancel for a refund/i.test(t), "nothing about cancelling once it has passed\n" + t); await shut();
console.log("ok - a 24-hour cancel window: the email's sentence and until when while open, nothing after, no return countdown");

// 3. The shop's total and what PayPal took.
t = await openFromHome("Tidepool Prints", "3-shop-total.png");
assert.match(t, /The shop's total was £42\.00; PayPal took £45\.99\./, t); await shut();
console.log("ok - the shop's own total beside what PayPal took");

// 4. A free gift.
t = await openFromHome("Glow Lab", "4-free-gift.png");
assert.match(t, /Mini Cleanser Trial Set\s+Free gift/, t); assert.ok(!t.includes("£0.00"), "never £0.00\n" + t);
const giftSq = await page.locator("#homePage .hl-sq, #homePage .hx-sq, #homePage .hx-live", { hasText: "Glow Lab" }).first().innerText();
assert.ok(!giftSq.includes("£0.00"), "Home: never £0.00\n" + giftSq);
await shut();
console.log("ok - a free gift says 'Free gift', never £0.00");

// The month's total leaves out the stay not paid yet.
await page.evaluate(() => window.go("receipts"));
await page.locator("#receiptsPage .rl-rr").first().waitFor(); await page.waitForTimeout(500);
const march = await page.locator("#receiptsPage .rl-cat-month", { hasText: "March 2025" }).innerText();
assert.match(march, /£12\.00/, "only the book counts in March 2025\n" + march); assert.ok(!/£322\.00|£310\.00/.test(march), march);
const stayRow = await page.locator("#receiptsPage .rl-rr", { hasText: "Harbour View Hotel" }).first().innerText();
assert.match(stayRow, /pay at the hotel/, stayRow);
const stayLine = await page.locator("#receiptsPage .rl-rr", { hasText: "Harbour View Hotel" }).first().locator(".rl-rr-sub").textContent();
assert.match(stayLine, /pay at the hotel/, "said in the line as drawn, not only to screen readers: " + stayLine); assert.match(stayRow, /£240\.00/, stayRow);
for (const r of ["Skyway Air", "Cloudhop"]) assert.equal(await page.locator("#receiptsPage .rl-rr", { hasText: r }).first().locator(".rl-rr-chip").count(), 0, r + ": no return chip");
// 5. A pack with one price (a game's pack is digital, so it is found in Receipts): its row opens to its lines.
const packRow = page.locator("#receiptsPage .rl-rr", { hasText: "Pixel Forge" }).first();
assert.ok(!(await packRow.innerText()).includes("£0.00"), "the row: never £0.00");
await packRow.locator(".rl-rr-main").click();
const packDetail = packRow.locator(".rl-rr-detail"); await packDetail.waitFor(); await page.waitForTimeout(300);
t = await packDetail.innerText();
assert.ok(!t.includes("£0.00"), "never £0.00\n" + t);
assert.match(t, /One price for all 3 of these: £9\.99\./, t);
const lines = await packDetail.locator(".rl-rr-list li").evaluateAll((ls) => ls.map((l) => ({ t: l.innerText, priced: Boolean(l.querySelector("b")) })));
assert.ok(lines.length === 3 && lines.every((l) => !l.priced), "each line without a price: " + JSON.stringify(lines));
if (SHOTS) { await packRow.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -60)); await page.waitForTimeout(200); await page.screenshot({ path: join(SHOTS, "5-pack.png") }); }
await packRow.locator(".rl-rr-main").click();
console.log("ok - a pack's lines show no price, and its one price is said once");

if (SHOTS) { await page.locator("#receiptsPage .rl-cat-month", { hasText: "March 2025" }).scrollIntoViewIfNeeded(); await page.waitForTimeout(200); await page.screenshot({ path: join(SHOTS, "6-month-total.png") }); }
console.log("ok - a month's total leaves out a stay not paid yet; Receipts shows it as to pay; no return chip on the flights");

// 6. A gift card's part and the card's; an amount only in the PDF.
const gcRow = page.locator("#receiptsPage .rl-rr", { hasText: "Teapot Corner" }).first();
await gcRow.scrollIntoViewIfNeeded(); await gcRow.locator(".rl-rr-main").click();
await gcRow.locator(".rl-rr-detail").waitFor(); await page.waitForTimeout(300);
t = await gcRow.locator(".rl-rr-detail").innerText();
assert.match(t, /£6\.25 was paid with a gift card and £40\.75 with Visa\./, t);
await gcRow.locator(".rl-rr-main").click();
const pdfEnd = await page.locator("#receiptsPage .rl-rr", { hasText: "Northbridge Institute" }).first().locator(".rl-rr-end").innerText();
assert.match(pdfEnd, /In the PDF/, "the row says where the amount is: " + pdfEnd);
console.log("ok - a gift card's part and the card's part, as the email gives them; an amount only in the PDF says so");

// 8. An order the shop edited: what its invoice says is still to pay, said once with the invoice's date; nothing when the
// server has no amount.
const edRow = page.locator("#receiptsPage .rl-rr", { hasText: "Linden Lane" }).first();
await edRow.scrollIntoViewIfNeeded(); await edRow.locator(".rl-rr-main").click();
await edRow.locator(".rl-rr-detail").waitFor(); await page.waitForTimeout(300);
t = await edRow.locator(".rl-rr-detail").innerText();
assert.equal(await edRow.locator(".rl-po-due").innerText(), "£20.00 still to pay to Linden Lane, as its invoice of 21 November says.");
assert.equal(t.split("still to pay").length, 2, "said once\n" + t); noDots(t, "edited order");
if (SHOTS) { await edRow.locator(".rl-po-due").scrollIntoViewIfNeeded(); await page.waitForTimeout(200); await page.screenshot({ path: join(SHOTS, "8-edited-still-to-pay.png") }); }
await edRow.locator(".rl-rr-main").click();
const ndRow = page.locator("#receiptsPage .rl-rr", { hasText: "Copper Fern" }).first();
await ndRow.scrollIntoViewIfNeeded(); await ndRow.locator(".rl-rr-main").click();
await ndRow.locator(".rl-rr-detail").waitFor(); await page.waitForTimeout(300);
assert.doesNotMatch(await ndRow.locator(".rl-rr-detail").innerText(), /still to pay|to pay to/, "no amount from the server: nothing said");
await ndRow.locator(".rl-rr-main").click();
console.log("ok - an edited order says what its invoice says is still to pay, with the invoice's date; nothing without an amount");

// 7. Relay's own test shops, without the testing tools.
assert.equal(await page.locator("#receiptsPage .rl-rr", { hasText: "Kestrel Test Kicks" }).count(), 0, "a test shop's receipt is never in Receipts without the testing tools");
await page.evaluate(() => window.go("home")); await page.waitForTimeout(500);
assert.ok(!(await page.locator("#homePage").innerText()).includes("Kestrel Test Kicks"), "nor on Home");
console.log("ok - a receipt from one of Relay's test shops shows only with the testing tools");

assert.deepEqual(errors, [], "no page errors");
await browser.close(); server.close();
console.log("PASS receipt fields: paid at the hotel, a 24-hour cancel window, the shop's own total, free gifts and packs");
