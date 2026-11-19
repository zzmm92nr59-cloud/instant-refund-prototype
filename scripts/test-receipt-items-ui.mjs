// Browser test: how a receipt's items show (stubbed Relay server, a made-up person and orders).
//  1. Home names a multi-item order by an item and "+ N more", never just one name; a receipt whose email lists no items
//     shows how many the email says ("3 items") and its total, never a blank.
//  2. A receipt whose items don't add up (itemsCheck.complete === false) says so plainly on its page: "Relay may have missed
//     some items on this receipt", with "Read it again" and "See the email" (each at least 44px, one request on a double tap).
//  3. Read it again: when Relay then has every item, the page says so and Home is asked again; when it still can't, a plain
//     sentence and "Fix it yourself"; a receipt pasted in (no email) offers "Fix it yourself" only. No raw error text.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeReady } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise((r) => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;

const EMAIL = "sam.tester@example.com", day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const TAKEAWAY_ITEMS = [["Sweet and Sour Chicken Balls", 699], ["Special Fried Rice", 520], ["Crispy Chilli Beef", 780], ["Salt and Pepper Ribs", 650], ["Egg Fried Rice", 700], ["Prawn Toast", 420]];
const base = (id, shop, extra) => ({ id, status: "pending", kind: "receipt", retailer: { name: shop, domain: null }, orderRef: "R-" + id.slice(0, 4), orderDate: day(-1), currency: "GBP",
  category: "food", returnable: false, returns: null, gmailId: "m" + id.slice(0, 8), ...extra });
const TAKEAWAY = base("11111111-1111-4111-8111-111111111111", "Just Eat", { totalPence: 4257, items: TAKEAWAY_ITEMS.map(([name, p]) => ({ name, qty: 1, pricePence: p })),
  itemsCheck: { complete: true, itemsPence: 3769, expectedPence: 3769, missingPence: 0 } });
const PODS = base("22222222-2222-4222-8222-222222222222", "Nespresso", { orderDate: day(-2), totalPence: 6300, items: [], itemCount: 3, itemsCheck: { complete: false, itemsPence: 0, expectedPence: 6300, missingPence: 6300 } });
const SHORT = base("33333333-3333-4333-8333-333333333333", "Lucky Star", { orderDate: day(-3), totalPence: 4257, items: [{ name: "Special Fried Rice", qty: 1, pricePence: 520 }],
  itemsCheck: { complete: false, itemsPence: 520, expectedPence: 3769, missingPence: 3249 } });
const PASTED = base("44444444-4444-4444-8444-444444444444", "Kitchen Nine", { orderDate: day(-4), gmailId: undefined, pasted: true, totalPence: 1745, items: [{ name: "Katsu Curry", qty: 1, pricePence: 1150 }],
  itemsCheck: { complete: false, itemsPence: 1150, expectedPence: 1745, missingPence: 595 } });
let st;
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const browser = await chromium.launch();
async function shopper() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" }); await skipInterests(ctx);
  await ctx.addInitScript((e) => { try { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); } catch (x) {} }, EMAIL);
  await ctx.route("https://**/*", async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith("/relay/")) return route.abort();
    st.log.push(m + " " + p);
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
    if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 6e5, others: [] });
    if (p === "/relay/my/receipts") return j({ receipts: st.receipts });
    if (p === "/relay/my/purchases") return j({ purchases: [] });
    if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Tester", photo: null });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [] });
    const rr = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/reread$/.exec(p);
    if (rr && m === "POST") { await new Promise((r) => setTimeout(r, 300)); return st.reread(rr[1], j); }
    return j({});
  });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(origin + "/index.html");
  await homeReady(page);
  await page.locator("#homePage .h2-sec").first().waitFor();
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}
const sheetText = (page) => page.locator(".rl-sheet").last().innerText();
const openFromHome = async (page, shop) => { await page.locator("#homePage .hl-sq", { hasText: shop }).first().click(); await page.locator(".rl-sheet").last().waitFor(); await page.waitForTimeout(300); };

// 1. Home's names.
st = { receipts: [TAKEAWAY, PODS, SHORT, PASTED], log: [], reread: (id, j) => j({ error: "x" }, 500) };
let { ctx, page, errors } = await shopper();
const home = await page.locator("#homePage").innerText();
// A multi-item order: how many things and what the whole order came to, never the first item's own price (Connor, 19 Nov 2026).
const take = await page.locator("#homePage .hl-sq", { hasText: "Just Eat" }).first().innerText();
assert.match(take, /6 items/, "a six-item order says how many\n" + take); assert.match(take, /£42\.57/, "and the order's total\n" + take);
assert.ok(!/£6\.99/.test(take), "not the first item's price\n" + take);
const pods = await page.locator("#homePage .hl-sq", { hasText: "Nespresso" }).first().innerText();
assert.match(pods, /3 items/, "no item list: how many the email says\n" + pods); assert.match(pods, /£63\.00/, "and its total");
console.log("ok - Home: '6 items' and the total for a multi-item order; '3 items' and the total when the email lists none");

// 2. The receipt's page says items may be missing, with the email and Read it again.
await openFromHome(page, "Lucky Star");
let txt = await sheetText(page);
assert.match(txt, /Relay may have missed some items on this receipt/); assert.match(txt, /come to £32\.49 less than the email says/);
const again = page.locator(".rl-miss .rl-btn", { hasText: "Read it again" }), see = page.locator(".rl-miss .rl-btn", { hasText: "See the email" });
for (const b of [again, see]) { const h = await b.evaluate((e) => e.getBoundingClientRect().height); assert.ok(h >= 44, "button at least 44px: " + h); }
// Still can't: a plain sentence, Fix it yourself, one request for a double tap.
st.reread = (id, j) => j({ ok: true, complete: false, via: null, reason: "not_sure", items: SHORT.items, itemsCheck: SHORT.itemsCheck });
st.log = [];
await again.dblclick();
await page.locator(".rl-miss .rl-msg", { hasText: "still can't read every item" }).waitFor();
assert.equal(st.log.filter((l) => l.endsWith("/reread")).length, 1, "a double tap reads it again once");
assert.ok(await page.locator(".rl-miss .rl-btn", { hasText: "Fix it yourself" }).count() === 1, "Fix it yourself offered");
// A server failure: plain English, never the server's words.
st.reread = (id, j) => j({ error: "gmail_unavailable", detail: "upstream 503" }, 502);
await again.click();
await page.locator(".rl-miss .rl-msg", { hasText: "Couldn't read it again just now" }).waitFor();
assert.ok(!(await sheetText(page)).includes("503") && !(await sheetText(page)).includes("gmail_unavailable"), "no raw error text");
// It works this time: the page says so, and the list is asked again.
st.reread = (id, j) => { st.receipts = [TAKEAWAY, PODS, { ...SHORT, items: TAKEAWAY.items, itemsCheck: TAKEAWAY.itemsCheck }, PASTED];
  return j({ ok: true, complete: true, via: "rules", items: TAKEAWAY.items, itemsCheck: TAKEAWAY.itemsCheck, totalPence: 4257 }); };
st.log = [];
await again.click();
await page.locator(".rl-miss", { hasText: "Relay has all 6 items now." }).waitFor();
await page.waitForTimeout(800);
assert.ok(st.log.some((l) => l === "GET /relay/my/receipts"), "the receipts are asked for again: " + st.log.join(", "));
console.log("ok - the page says items may be missing; Read it again (once on a double tap), plain words when it can't, all items when it can");
await page.keyboard.press("Escape").catch(() => {});
await ctx.close();

// 3. A receipt pasted in has no email to read again: Fix it yourself only. A receipt with no items says so.
({ ctx, page, errors } = await shopper());
await openFromHome(page, "Kitchen Nine");
txt = await sheetText(page);
assert.match(txt, /Relay may have missed some items on this receipt/);
assert.equal(await page.locator(".rl-miss .rl-btn", { hasText: "Read it again" }).count(), 0, "no Read it again without an email");
assert.equal(await page.locator(".rl-miss .rl-btn", { hasText: "Fix it yourself" }).count(), 1);
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(300);
await page.evaluate(() => { document.querySelectorAll(".rl-back").forEach((n) => n.remove()); });
await openFromHome(page, "Nespresso");
txt = await sheetText(page);
assert.match(txt, /Relay couldn't read the items on this receipt/); assert.match(txt, /The email says 3 items\./);
assert.deepEqual(errors, [], "no page errors");
await ctx.close();
console.log("ok - a pasted receipt offers Fix it yourself only; a receipt with no items says how many the email says");
// 4. Round 4: a receipt whose items are only in the email's attachment (a PDF) says so, offers the email and fixing it by
// hand, and never "Read it again" (the email has no items in it to read); nothing is made up for it.
const PDF = base("55555555-5555-4555-8555-555555555555", "Harbour Hardware", { orderDate: day(-5), totalPence: 8640, items: [], detailsInAttachment: "pdf",
  itemsCheck: { complete: false, itemsPence: 0, expectedPence: 8640, missingPence: 8640, inAttachment: "pdf" } });
st = { receipts: [TAKEAWAY, PDF], log: [], reread: (id, j) => j({ error: "x" }, 500) };
({ ctx, page, errors } = await shopper());
await openFromHome(page, "Harbour Hardware");
txt = await sheetText(page);
assert.match(txt, /The items on this receipt are in its attachment/, txt); assert.match(txt, /sent the receipt as a PDF/);
assert.equal(await page.locator(".rl-miss .rl-btn", { hasText: "Read it again" }).count(), 0, "no Read it again for items only in an attachment");
assert.equal(await page.locator(".rl-miss .rl-btn", { hasText: "See the email" }).count(), 1);
assert.equal(await page.locator(".rl-miss .rl-btn", { hasText: "Fix it yourself" }).count(), 1);
for (const b of await page.locator(".rl-miss .rl-btn").all()) { const hgt = await b.evaluate((e) => e.getBoundingClientRect().height); assert.ok(hgt >= 44, "button at least 44px: " + hgt); }
assert.deepEqual(errors, [], "no page errors");
await ctx.close();
console.log("ok - a receipt only in its PDF says the items are in the attachment, with See the email and Fix it yourself");

// 5. Round 10 (a real inbox): an app-delivery email with no item list, a later refund on it, and a delivery-day payment.
const NOLIST = base("66666666-6666-4666-8666-666666666666", "Uber Eats", { merchant: "Lotus Grill", totalPence: 1740, items: [], orderDate: day(-1),
  itemsCheck: { complete: false, itemsPence: 0, expectedPence: 1740, missingPence: null, noItemList: true }, adjusted: { refundPence: 876, newTotalPence: 864, currency: "GBP" } });
const PAYDAY = base("77777777-7777-4777-8777-777777777777", "Fresh Basket", { totalPence: 9940, items: [], orderDate: day(-2), itemsCheck: { complete: false, itemsPence: 0, expectedPence: null, missingPence: null, orderUpdate: true } });
st = { receipts: [NOLIST, PAYDAY], log: [], reread: (id, j) => j({ error: "x" }, 500) };
({ ctx, page, errors } = await shopper());
const lotus = await page.locator("#homePage .hl-sq", { hasText: "Lotus Grill" }).first().innerText();
assert.match(lotus, /£8\.64/, "Home shows what it comes to after the refund\n" + lotus); assert.ok(!/Uber Eats/.test(lotus), "named after the restaurant\n" + lotus);
await openFromHome(page, "Lotus Grill");
txt = await sheetText(page);
assert.match(txt, /Uber Eats' email doesn't list what you ordered/, txt); assert.match(txt, /It only gives the total, £17\.40\./);
assert.ok(!/may have missed some items|less than the email says/.test(txt), "never says items were missed when the email lists none\n" + txt);
assert.match(txt, /£8\.76 refunded\. It now comes to £8\.64\./);
assert.equal(await page.locator(".rl-miss .rl-btn", { hasText: "Read it again" }).count(), 0, "nothing to read again");
assert.equal(await page.locator(".rl-miss .rl-btn", { hasText: "See the email" }).count(), 1);
await page.locator(".rl-back").last().click({ position: { x: 10, y: 10 } }); await page.locator(".rl-back").last().waitFor({ state: "detached" }).catch(() => {});
await openFromHome(page, "Fresh Basket");
txt = await sheetText(page);
assert.match(txt, /This is the payment for an order/, txt); assert.match(txt, /hasn't found the email that lists what you ordered yet/);
for (const b of await page.locator(".rl-miss .rl-btn").all()) { const hgt = await b.evaluate((e) => e.getBoundingClientRect().height); assert.ok(hgt >= 44, "button at least 44px: " + hgt); }
assert.deepEqual(errors, [], "no page errors");
await ctx.close();
console.log("ok - an email with no item list says so with the total (never 'missed'); a later refund shows the new total; a payment-only email says so");

// 6. Round 12 (a real inbox): a hotel that can't be refunded, credit back, a booking paid in parts, a swapped item, and a
// second order inside one email (shown, with its email, but nothing that would change the first order).
const HOTEL = base("88888888-8888-4888-8888-888888888888", "Stayfinder", { totalPence: 11513, currency: "EUR", orderDate: day(-4), items: [{ name: "Standard Double Room", variant: "Harbour Hotel", qty: 1, pricePence: 11513 }],
  itemsCheck: { complete: true, itemsPence: 11513, expectedPence: 11513, missingPence: 0 }, returns: { nonRefundable: true } });
const CREDIT = base("99999999-9999-4999-8999-999999999999", "Just Eat", { merchant: "Olive Grove", totalPence: 2410, orderDate: day(-5), items: [{ name: "Falafel Wrap", qty: 1, pricePence: 2410 }],
  itemsCheck: { complete: true, itemsPence: 2410, expectedPence: 2410, missingPence: 0 }, adjusted: { refundPence: 499, creditPence: 399, currency: "GBP" } });
const TRIP = base("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Sunbreaks", { totalPence: null, orderDate: day(-6), items: [], payments: [{ pence: 3800 }, { pence: 20077 }], paidSoFarPence: 23877,
  itemsCheck: { complete: false, itemsPence: 0, expectedPence: null, missingPence: null } });
const SWAP = base("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Fresh Basket", { totalPence: 320, orderDate: day(-7), items: [{ name: "Italian Burrata 150g", qty: 1, pricePence: 320, substitutedFor: "Truffle Burrata 125g" }],
  itemsCheck: { complete: true, itemsPence: 320, expectedPence: 320, missingPence: 0 } });
const SECOND = base("cccccccc-cccc-4ccc-8ccc-cccccccccccc-2", "Riverside Market", { fromEmail: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", gmailId: "msgcccc0000", totalPence: 2400, orderDate: day(0), items: [{ name: "Eau de Toilette 30ml", qty: 1, pricePence: 2400 }],
  itemsCheck: { complete: true, itemsPence: 2400, expectedPence: 2400, missingPence: 0 } });
st = { receipts: [HOTEL, CREDIT, TRIP, SWAP, SECOND], log: [], reread: (id, j) => j({ error: "x" }, 500) };
({ ctx, page, errors } = await shopper());
const sheetOf = async (shop) => { await openFromHome(page, shop); const t = await sheetText(page); await page.locator(".rl-back").last().click({ position: { x: 10, y: 10 } }); await page.locator(".rl-back").last().waitFor({ state: "detached" }).catch(() => {}); return t; };
assert.match(await sheetOf("Stayfinder"), /Non-refundable, as the booking email says\./);
txt = await sheetOf("Olive Grove"); assert.match(txt, /£4\.99 refunded/); assert.match(txt, /£3\.99 given back as account credit\./);
assert.match(await sheetOf("Sunbreaks"), /Paid so far: £238\.77 in 2 payments\./);
assert.match(await sheetOf("Fresh Basket"), /Italian Burrata 150g was sent instead of Truffle Burrata 125g\./);
await openFromHome(page, "Riverside Market");
txt = await sheetText(page);
assert.match(txt, /Eau de Toilette 30ml/);
for (const word of ["Fix it yourself", "I'm sending this back", "Remind me"]) assert.ok(!txt.includes(word), "no '" + word + "' on a second order inside one email\n" + txt);
assert.deepEqual(errors, [], "no page errors");
await ctx.close();
console.log("ok - non-refundable, credit back, paid so far, a swapped item, and a second order inside one email (shown, nothing that changes the first)");

// 7. Round 13: a hotel with free cancellation, an app's cancel window, a subscription that ends, a gift card, discounts, pesos.
const HOTEL2 = base("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "Stayfinder", { totalPence: 23140, orderDate: day(-1), returnable: false, items: [{ name: "Double Room", variant: "Quayside Hotel", qty: 1, pricePence: 23140 }],
  itemsCheck: { complete: true, itemsPence: 23140, expectedPence: 23140, missingPence: 0 }, returns: { freeCancellationUntil: "2025-06-06" } });
const APP = base("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "Apple", { totalPence: 159, orderDate: day(-2), returnable: false, items: [{ name: "Stack of Coins", variant: "Puzzle Pals", qty: 1, pricePence: 159 }],
  itemsCheck: { complete: true, itemsPence: 159, expectedPence: 159, missingPence: 0 }, returns: { cancelWithin: true, windowDays: 14 } });
const SUB = base("ffffffff-ffff-4fff-8fff-ffffffffffff", "Google Play", { totalPence: 599, orderDate: day(-3), items: [{ name: "Docs Pro (Monthly)", qty: 1, pricePence: 599 }],
  itemsCheck: { complete: true, itemsPence: 599, expectedPence: 599, missingPence: 0 }, subscriptionEnds: { on: "2019-08-13", refund: false } });
const GIFT = base("12121212-1212-4121-8121-121212121212", "Riverside Market", { totalPence: 0, orderDate: day(-4), giftCardPence: 810, items: [{ name: "Notebook", qty: 1, pricePence: 810 }],
  itemsCheck: { complete: true, itemsPence: 810, expectedPence: 810, missingPence: 0 } });
const PUB = base("13131313-1313-4131-8131-131313131313", "Crown & Anchor", { totalPence: 1785, orderDate: day(-5), items: [{ name: "Lager (Pint)", qty: 2, pricePence: 1100 }, { name: "Burger", qty: 1, pricePence: 1349 }],
  itemsCheck: { complete: true, itemsPence: 2449, expectedPence: 2449, missingPence: 0 }, discounts: [["discount", "Promotion Applied", 664]] });
const PESO = base("14141414-1414-4141-8141-141414141414", "Puzzle Pals", { totalPence: 15000, currency: "MXN", orderDate: day(-6), items: [{ name: "Coins bundle", qty: 1, pricePence: 15000 }],
  itemsCheck: { complete: true, itemsPence: 15000, expectedPence: 15000, missingPence: 0 } });
st = { receipts: [HOTEL2, APP, SUB, GIFT, PUB, PESO], log: [], reread: (id, j) => j({ error: "x" }, 500) };
({ ctx, page, errors } = await shopper());
txt = await sheetOf("Stayfinder"); assert.match(txt, /Free cancellation until 6 June 2025, as the booking email says\./); assert.ok(!/Usually can't be returned/.test(txt), txt);
txt = await sheetOf("Apple"); assert.match(txt, /You can cancel within 14 days of the invoice, as the email says\./); assert.ok(!/Usually can't be returned/.test(txt), txt);
assert.match(await sheetOf("Google Play"), /This subscription ends on 13 August 2019, with no refund\./);
assert.match(await sheetOf("Riverside Market"), /£8\.10 was paid with a gift card\./);
assert.match(await sheetOf("Crown & Anchor"), /£6\.64 off: Promotion Applied\./);
assert.match(await sheetOf("Puzzle Pals"), /MX\$150\.00/);
assert.deepEqual(errors, [], "no page errors");
await ctx.close();
console.log("ok - free cancellation, a cancel window, a subscription ending, a gift card, money taken off, and pesos are each said plainly");
await browser.close(); server.close();
console.log("PASS receipt items: '+ N more', item counts, 'may have missed some items' with Read it again and See the email");
