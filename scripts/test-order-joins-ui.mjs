// Browser test: "Same order as another receipt", "These are different orders", fee lines, and Relay health's "Likely
// reading problems" (stubbed Relay server, a made-up person, shops and orders).
//  1. A receipt's page says "Same order as another receipt?"; Choose it shows greyed-out rows, then a short list; a double
//     tap on one joins them once; Home then shows one card, which says what it's made of and offers Undo; Undo makes two.
//  2. A receipt the reader made from two emails offers "Split it" (after a plain question); Home then shows two.
//  3. A receipt with fees shows each beside its money off, and says how they come to what was paid.
//  4. A failure says what to do in plain words, never the server's words. Every button is at least 44px.
//  5. Relay health (admins): "Likely reading problems" by shop, counts only.
// Screenshots (phone size) go to the scratchpad folder given in RELAY_SHOTS, or /tmp/joins-shots.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeReady } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const SHOTS = process.env.RELAY_SHOTS || "/tmp/joins-shots";
await mkdir(SHOTS, { recursive: true });
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise((r) => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;

const EMAIL = "sam.tester@example.com", day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const base = (id, shop, extra) => ({ id, status: "confirmed", kind: "receipt", retailer: { name: shop, domain: null }, orderRef: null, orderDate: day(-1), currency: "GBP",
  category: "home", returnable: true, returns: null, gmailId: "m" + id.slice(0, 8), ...extra });
const POT_A = base("11111111-1111-4111-8111-111111111111", "Fernhill Pottery", { totalPence: 2400, items: [{ name: "Speckled Bowl", qty: 2, pricePence: 1200 }],
  itemsCheck: { complete: true, itemsPence: 2400, expectedPence: 2400, missingPence: 0 } });
const POT_B = base("22222222-2222-4222-8222-222222222222", "Fernhill Pottery", { totalPence: 2400, items: [], orderDate: day(-1) });
const BOOK = base("33333333-3333-4333-8333-333333333333", "Quillbrook Books", { orderRef: "QB-7781", orderDate: day(-2), totalPence: 1599, items: [{ name: "The Salt Road", qty: 1, pricePence: 1599 }],
  itemsCheck: { complete: true, itemsPence: 1599, expectedPence: 1599, missingPence: 0 }, alsoEmails: [{ id: "44444444-4444-4444-8444-444444444444", shop: "Quillbrook Books", orderDate: day(-1), totalPence: 899, currency: "GBP" }] });
const BOOK_B = base("44444444-4444-4444-8444-444444444444", "Quillbrook Books", { orderRef: "QB-7781", orderDate: day(-1), totalPence: 899, items: [{ name: "Night Garden Atlas", qty: 1, pricePence: 899 }], splitByYou: true });
const TEA = base("55555555-5555-4555-8555-555555555555", "Wrenfold Tea", { category: "food", returnable: false, orderDate: day(-3), totalPence: 2699,
  items: [{ name: "Smoked Lapsang Tin", qty: 2, pricePence: 1200 }], fees: [{ label: "Shipping", pence: 499 }], discounts: [{ label: "Welcome offer", pence: 200 }],
  itemsCheck: { complete: true, itemsPence: 2400, expectedPence: 2400, missingPence: 0 } });
const JOINED = { ...POT_A, joinedByYou: true, alsoEmails: [{ id: POT_B.id, shop: "Fernhill Pottery", orderDate: POT_B.orderDate, totalPence: 2400, currency: "GBP" }] };
const PROBLEMS = { shops: [{ domain: "fernhill.example", people: 4, receipts: 31, duplicates: 5, sameTotalNoNumber: 3, paymentBeside: 2, notAddingUp: 2, noNumber: 9, noTotal: 1, saidSame: 2, saidApart: 0, problems: 19 },
  { domain: "quillbrook.example", people: 3, receipts: 12, duplicates: 0, sameTotalNoNumber: 0, paymentBeside: 0, notAddingUp: 0, noNumber: 0, noTotal: 0, saidSame: 0, saidApart: 1, problems: 1 }],
  moreShops: 0, others: { shops: 6, receipts: 40, duplicates: 1, sameTotalNoNumber: 1, paymentBeside: 0, notAddingUp: 3, noNumber: 7, noTotal: 2, saidSame: 0, saidApart: 0, problems: 13 },
  mine: [{ domain: "wrenfold.example", receipts: 4, duplicates: 0, sameTotalNoNumber: 0, paymentBeside: 0, notAddingUp: 1, noNumber: 2, noTotal: 0, saidSame: 1, saidApart: 0, problems: 4 }] };

let st;
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const browser = await chromium.launch();
async function shopper(email = EMAIL) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" }); await skipInterests(ctx);
  await ctx.addInitScript((e) => { try { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); } catch (x) {} }, email);
  await ctx.route("https://**/*", async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith("/relay/")) return route.abort();
    st.log.push(m + " " + p);
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
    if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email, lastScanAt: Date.now() - 6e5, others: [] });
    if (p === "/relay/my/receipts") return j({ receipts: st.receipts });
    if (p === "/relay/my/purchases") return j({ purchases: [] });
    if (p === "/relay/my/profile") return j({ email, name: "Sam Tester", photo: null });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [] });
    if (p === "/relay/my/admin/me") return j(st.admin ? { admin: true, openReports: 0 } : { admin: false });
    if (p === "/relay/my/admin/health") { if (!st.admin) return j({ error: "not_found" }, 404); await new Promise((r) => setTimeout(r, 400)); return j(st.health); }
    const jn = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/join$/.exec(p);
    if (jn && m === "GET") { await new Promise((r) => setTimeout(r, 500)); return j({ candidates: st.candidates }); }
    if (jn && m === "POST") { await new Promise((r) => setTimeout(r, 300)); const b = JSON.parse(req.postData() || "{}"); st.posts.push({ id: jn[1], ...b }); return st.post(jn[1], b, j); }
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
const squares = (page, shop) => page.locator("#homePage .hl-sq", { hasText: shop });
const openFromHome = async (page, shop) => { await squares(page, shop).first().click(); await page.locator(".rl-sheet").last().waitFor(); await page.waitForTimeout(300); };
const tall = async (loc, what) => { for (const b of await loc.all()) { if (!(await b.isVisible())) continue; const h = await b.evaluate((e) => e.getBoundingClientRect().height); assert.ok(h >= 44, what + " at least 44px: " + h); } };
const shot = (page, name) => page.screenshot({ path: SHOTS + "/" + name + ".png" });
const settle = async (page) => { await page.waitForTimeout(900); };

// 1. Same order, then undo.
st = { receipts: [POT_A, POT_B, BOOK, TEA], candidates: [POT_B, TEA].map((c) => ({ id: c.id, kind: "receipt", retailer: { name: c.retailer.name, domain: null }, orderDate: c.orderDate, totalPence: c.totalPence, currency: "GBP", items: c.items })),
  log: [], posts: [], post: (id, b, j) => j({ ok: true }) };
let { ctx, page, errors } = await shopper();
assert.equal(await squares(page, "Fernhill Pottery").count(), 2, "the reader left the pottery order as two cards");
await openFromHome(page, "Speckled Bowl");
let txt = await sheetText(page);
assert.match(txt, /Same order as another receipt\?/, txt);
assert.ok(!/Split it/.test(txt), "a receipt of one email has nothing to split");
const choose = page.locator(".rl-sheet .rl-jn-row .rl-pill", { hasText: "Choose it" });
await choose.scrollIntoViewIfNeeded();
await tall(page.locator(".rl-sheet .rl-jn button"), "the receipt page's join buttons");
await shot(page, "receipt-page-actions");
await choose.click();
await page.locator(".rl-jn-pick .rl-jn-sk .rl-skel").first().waitFor();
assert.equal(await page.locator(".rl-jn-pick").getByText(/Loading/).count(), 0, "greyed-out rows, never 'Loading…'");
await page.locator(".rl-jn-pick .rl-jn-cand").first().waitFor();
txt = await page.locator(".rl-jn-pick").innerText();
assert.match(txt, /Which receipt is the same order\?/); assert.match(txt, /Fernhill Pottery/); assert.match(txt, /£24\.00/);
await tall(page.locator(".rl-jn-pick button"), "the short list's rows");
await shot(page, "pick-same-order-sheet");
st.receipts = [JOINED, BOOK, TEA];
st.log = [];
await page.locator(".rl-jn-pick .rl-jn-cand").first().dblclick();
await page.locator(".rl-jn-pick").waitFor({ state: "detached" });
await settle(page);
assert.deepEqual(st.posts.map((x) => [x.id, x.action, x.with]), [[POT_A.id, "same", POT_B.id]], "a double tap joins them once");
assert.ok(st.log.includes("GET /relay/my/receipts"), "the receipts are asked for again: " + st.log.join(", "));
assert.equal(await squares(page, "Fernhill Pottery").count(), 1, "one card now");
await openFromHome(page, "Speckled Bowl");
txt = await sheetText(page);
assert.match(txt, /Made from 2 emails/, txt); assert.match(txt, /You said these are one order\./);
st.receipts = [POT_A, POT_B, BOOK, TEA]; st.posts = [];
await page.locator(".rl-sheet .rl-jn-row .rl-pill", { hasText: "Undo" }).click();
await settle(page);
assert.deepEqual(st.posts.map((x) => [x.action, x.kind]), [["undo", "same"]]);
assert.equal(await squares(page, "Fernhill Pottery").count(), 2, "undone: two cards again");
console.log("ok - same order: a short list (greyed out while it loads), one tap joins them once, one card, then Undo makes two again");

// 2. Different orders.
await openFromHome(page, "The Salt Road");
txt = await sheetText(page);
assert.match(txt, /Made from 2 emails/, txt); assert.match(txt, /Not all one order\?/);
await page.locator(".rl-sheet .rl-jn-row .rl-pill", { hasText: "Split it" }).click();
await page.locator(".rl-sheet[role=alertdialog]").waitFor();
st.receipts = [POT_A, POT_B, { ...BOOK, alsoEmails: undefined, splitByYou: true }, BOOK_B, TEA]; st.posts = [];
await page.locator(".rl-sheet[role=alertdialog] button", { hasText: "Split it" }).click();
await settle(page);
assert.deepEqual(st.posts.map((x) => [x.id, x.action]), [[BOOK.id, "apart"]]);
assert.equal(await squares(page, "Quillbrook Books").count(), 2, "split: two cards");
await openFromHome(page, "Night Garden Atlas");
txt = await sheetText(page);
assert.match(txt, /You said this is a separate order\./, txt);
await page.locator(".rl-back").last().click({ position: { x: 10, y: 10 } }); await page.locator(".rl-back").last().waitFor({ state: "detached" }).catch(() => {});
console.log("ok - different orders: Split it asks first, then the receipt is two, each saying it was kept apart");

// 3. Fee lines.
await openFromHome(page, "Smoked Lapsang Tin");
txt = await sheetText(page);
assert.match(txt, /£4\.99 added: Shipping\./, txt); assert.match(txt, /£2\.00 off: Welcome offer\./);
assert.match(txt, /£24\.00 of items, £4\.99 added and £2\.00 off: £26\.99, what you paid\./);
const feeAt = txt.indexOf("added: Shipping"), offAt = txt.indexOf("off: Welcome offer");
assert.ok(feeAt >= 0 && offAt > feeAt, "the fee sits beside the money off");
await page.locator(".rl-po-fee").first().scrollIntoViewIfNeeded();
await shot(page, "receipt-page-fees");
await page.locator(".rl-back").last().click({ position: { x: 10, y: 10 } }); await page.locator(".rl-back").last().waitFor({ state: "detached" }).catch(() => {});
console.log("ok - fees show beside the money off, and the lines add up to what was paid");

// 4. A failure in plain words.
st.post = (id, b, j) => j({ error: "internal", detail: "D1_ERROR: no such table" }, 500);
await openFromHome(page, "Speckled Bowl");
await page.locator(".rl-sheet .rl-jn-row .rl-pill", { hasText: "Choose it" }).click();
await page.locator(".rl-jn-pick .rl-jn-cand").first().click();
await page.locator(".rl-jn-pick .rl-msg", { hasText: "Couldn't join them. Try again in a moment." }).waitFor();
txt = await page.locator(".rl-jn-pick").innerText();
assert.ok(!/D1_ERROR|internal|500/.test(txt), "no raw error text\n" + txt);
assert.deepEqual(errors, [], "no page errors");
await ctx.close();
console.log("ok - a failure says what to do in plain words");

// 5. Relay health: likely reading problems.
st = { receipts: [], candidates: [], log: [], posts: [], post: (id, b, j) => j({ ok: true }), admin: true, health: null };
const q = (o) => ({ receipts: 0, high: 0, medium: 0, low: 0, confirmed: 0, dismissed: 0, noTotal: 0, noItems: 0, pasted: 0, ...o });
st.health = { generatedAt: new Date().toISOString(), minShoppersPerShop: 3, people: { shoppers: 8, newThisWeek: 1, newThisMonth: 3, signedIn: 6, signedInThisWeek: 4 },
  inboxes: { gmail: 6, outlook: 1, shoppers: 7, checkedToday: 7, notCheckedToday: 0, lastChecked: new Date().toISOString(), newThisWeek: 1, scansThisWeek: {}, scanErrorsThisWeek: [] },
  reading: { readerVersion: 48, emailsLookedAt: 900, notReceipts: 600, emailsThisWeek: 80, kinds: {}, purchases: q({ receipts: 300, high: 250 }), purchasesThisWeek: q({ receipts: 20, high: 18 }),
    byReader: [{ version: 48, emails: 900 }], waitingToBeRead: 0, shoppersTaught: { groupsChanged: 0, shopsMarkedPromotions: 0, people: 0 }, itemsMarkedReturning: 0,
    days: Array.from({ length: 14 }, (_, i) => ({ day: day(i - 13), kept: i % 4, skipped: i % 3 })) },
  shops: [], mine: { receipts: 4, personalMail: 0, noShop: 0, shops: [] }, returnsAndSwaps: { returns: {}, swaps: {}, labels: 0, payments: [] },
  extras: { gifts: 0, giftGivers: 0, earlierYearsRead: 0, notificationDevices: 0, notificationPeople: 0, priceWatches: 0, watchers: 0 }, shopsConnected: { shopify: 0, shopifyTest: 0, square: 0 },
  security: { wrongCodesToday: 0 }, mail: { ownAddress: false, returnsShopNotEmailedThisWeek: 0 }, readingProblems: PROBLEMS, checkedByShops: null };
({ ctx, page, errors } = await shopper("ops@example.com"));
await page.evaluate(() => window.go("me"));
const view = page.locator("#mePage");
await view.locator(".rl-arow").first().waitFor();
await view.locator(".rl-arow", { hasText: "Settings" }).first().click(); await page.waitForTimeout(450);
await view.locator(".rl-arow", { hasText: "Relay health" }).click();
await view.locator(".rl-hp .rl-skel").first().waitFor();
const sec = view.locator(".rl-agroup", { hasText: "Likely reading problems" });
await sec.waitFor();
txt = await sec.innerText();
for (const s of ["fernhill.example", "31 receipts from 4 people", "5 likely duplicates", "2 with items that don't add up", "9 with no order number", "1 with no total", "2 shoppers said same order",
  "quillbrook.example", "1 shopper said different orders", "Shops fewer than 3 people buy from", "6 shops with 40 receipts between them", "In your own receipts:", "wrenfold.example", "1 time you said same order"])
  assert.ok(txt.includes(s), "health shows '" + s + "'\n" + txt);
assert.ok(txt.indexOf("fernhill.example") < txt.indexOf("quillbrook.example"), "most problems first");
assert.ok(!/ · /.test(txt), "no facts glued together with dots");
await sec.scrollIntoViewIfNeeded();
await shot(page, "health-likely-problems");
assert.deepEqual(errors, [], "no page errors");
await ctx.close();
console.log("ok - Relay health: likely reading problems by shop, counts only, most first, with the admin's own");

await browser.close(); server.close();
