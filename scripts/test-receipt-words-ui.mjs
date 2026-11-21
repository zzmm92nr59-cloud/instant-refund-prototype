// Browser test: what the shopper SEES from their receipts is what the receipts say (round 7, 19 Nov 2026).
// The app's answers are not written by hand: corpus emails (scripts/fixtures/receipt-emails) and a few made-up shops' emails
// go through Relay's real scan route, reader and totals check into a real SQLite database (scripts/real-receipts.mjs), and
// the app is sent exactly what the server would send (GET /relay/my/receipts, ?all=1, /relay/my/wrapped).
// Home, Receipts, each receipt's page and Wrapped are then opened in a phone-sized browser, and the words on screen must
// match the receipt exactly:
//   * every item's name, quantity ("2 ×") and price, and each total, in its own currency (€ stays €, never £);
//   * "+ N more" on Home ("and N more" under the shop in Receipts) counts the other items exactly;
//   * "Relay may have missed some items" only when the totals check says so (and always when it does);
//   * "Some item names on this receipt may not be right" only when the name check says so (round 9), never on Home;
//   * "Cancelled" / "Part cancelled" on cancelled orders; refunded money is said, never counted as spending without saying so;
//   * a return date only when the email states one; Relay's own estimate is worded as an estimate ("at least");
//   * no facts glued with dots ("A · B · C"); no raw codes, JSON or "undefined".
// Everything is MADE UP. Nothing leaves this machine. RECEIPT_WORDS_REPORT=1 lists every problem and carries on.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { readFileSync } from "node:fs"; import { resolve, extname } from "node:path";
import { skipInterests, homeReady } from "./relay-places.mjs";
import { realInbox } from "./real-receipts.mjs";
import { rawEmail } from "./fixtures/receipt-emails/lib.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const REPORT = process.env.RECEIPT_WORDS_REPORT === "1", SHOTS = process.env.RECEIPT_WORDS_SHOTS || "";

// ---- The inbox: corpus emails and made-up shops' emails, read by the real reader -----------------------------------------
const NOW = Date.UTC(2026, 10, 19, 12), DAY = 864e5;
const fx = (n) => JSON.parse(readFileSync("scripts/fixtures/receipt-emails/" + n + ".json", "utf8"));
const CORPUS = ["argos-1", "deliveroo-3", "holdout4-zalando-eur-comma", "nespresso-3", "holdout8-clipped-missing-item", "boots-2"];
const rfc = (daysAgo) => new Date(NOW - daysAgo * DAY).toUTCString();
const longDay = (daysAgo) => new Date(NOW - daysAgo * DAY).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const gbp = (p) => "£" + (p / 100).toFixed(2);
let mid = 0;
const mail = (from, subject, daysAgo, lines) => ["From: " + from, "To: sam.taylor@example.co.uk", "Subject: " + subject, "Date: " + rfc(daysAgo), "Message-ID: <words-" + (++mid) + "@mail.example>",
  "Content-Type: text/plain; charset=utf-8", "", ...lines].join("\r\n");
const order = (shop, ref, daysAgo, items, extra = [], refLabel = "Order number") => mail(`${shop.name} <orders@${shop.domain}>`, `Your ${shop.name} order ${ref}`, daysAgo,
  ["Thanks for your order, Sam!", `${refLabel}: ${ref}`, `Order date: ${longDay(daysAgo)}`, "", ...items.map(([n, q, p]) => `${n} - Qty ${q} - ${gbp(q * p)}`), "",
    `Subtotal: ${gbp(items.reduce((s, [, q, p]) => s + q * p, 0))}`, `Order total: ${gbp(items.reduce((s, [, q, p]) => s + q * p, 0))}`, ...extra]);
const KESTREL = { name: "Kestrel Outdoor", domain: "kestrel-outdoor.example" }, LARK = { name: "Lark & Finch", domain: "larkandfinch.example" };
const WREN = { name: "Wren Pharmacy", domain: "wrenpharmacy.example" };
const MOSS = { name: "Moss Lane Clothing", domain: "mosslane.example" }, BRAMBLE = { name: "Bramble Home", domain: "bramblehome.example" }, FERN = { name: "Fern & Tide", domain: "fernandtide.example" };
const MADE_UP = [
  order(KESTREL, "KO-20001", 12, [["Ridge Fleece Jacket", 1, 6400], ["Trail Socks", 2, 1000]]),
  mail(`${KESTREL.name} <orders@${KESTREL.domain}>`, "Your order KO-20001 has been cancelled", 11, ["Your order KO-20001 has been cancelled.", "Order number: KO-20001", "We've refunded £84.00 to your original payment method."]),
  order(LARK, "LF-3001", 10, [["Linen Tea Towel", 1, 1200], ["Stoneware Mug", 2, 900]]),
  mail(`${LARK.name} <orders@${LARK.domain}>`, "Part of your order LF-3001 has been cancelled", 9, ["Sorry, part of your order has been cancelled.", "Order number: LF-3001", "Linen Tea Towel is out of stock.", "Refund of £12.00."]),
  order(MOSS, "ML-4001", 6, [["Cord Overshirt", 1, 4500], ["Wool Beanie", 1, 1800]], ["", "You can return unworn items by 15 December 2026."]),
  order(BRAMBLE, "INV-2290", 8, [["Rattan Lamp Shade", 1, 3200], ["Cotton Throw", 1, 2800]], [], "Invoice number"),
  order(FERN, "FT-5001", 30, [["Canvas Tote Bag", 1, 2400], ["Enamel Pin Set", 3, 500]]),
  // (Round 9) The money adds up, but a name is a label from the email: the name check flags it.
  order(WREN, "WP-7001", 4, [["Hayfever Relief Tablets", 1, 450], ["Pack size: 30 tablets", 1, 350]]),
  mail(`${FERN.name} <returns@${FERN.domain}>`, "Your refund for order FT-5001 has been processed", 5, ["We've processed your refund of £39.00.", "Order number: FT-5001", "It can take 3-5 working days to reach your account."]),
];
const inbox = await realInbox({ now: NOW }).start();
for (const n of CORPUS) inbox.deliver(rawEmail(fx(n)));
for (const m of MADE_UP) inbox.deliver(m);
await inbox.scan();
const ALL = await inbox.receipts(true), NEWEST = await inbox.receipts(false), WRAPPED = await inbox.wrapped(2026);
if (process.env.RECEIPT_WORDS_DUMP) (await import("node:fs")).writeFileSync(process.env.RECEIPT_WORDS_DUMP, JSON.stringify({ ALL, NEWEST, WRAPPED }, null, 1));
const receipts = ALL.receipts.filter((r) => (r.kind || "receipt") === "receipt");
// (Round 7) A shop that sends an invoice: its invoice number is the order number.
assert.equal((receipts.find((r) => r.retailer && r.retailer.name === "Bramble Home") || {}).orderRef, "INV-2290", "the invoice number is the order number");

// ---- What each receipt says, for the checks ------------------------------------------------------------------------------
const SIGN = { GBP: "£", EUR: "€", USD: "US$" };
const money = (p, cur) => (p < 0 ? "−" : "") + (SIGN[cur || "GBP"] || cur + " ") + Math.floor(Math.abs(p) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + String(Math.abs(p) % 100).padStart(2, "0");
const named = (r) => (r.items || []).filter((i) => i.name);
const lineOf = (i) => (i.lineTotal ? i.pricePence : i.pricePence * (Number(i.qty) > 1 ? Number(i.qty) : 1));
const shopOf = (r) => (r.retailer && (r.retailer.name || r.retailer.domain)) || "Unknown store";
const problems = [];
const check = (ok, what) => { if (!ok) { if (REPORT) problems.push(what); else assert.fail(what); } };
const RAW = /\bundefined\b|\bNaN\b|\[object |\bnull\b|[{}]|"[a-z]+":|\b[a-z]+_[a-z_]+\b/;
const DOTS = / · /;
function everywhere(where, text) {
  check(!DOTS.test(text), where + ": facts joined with dots: " + (text.split("\n").find((l) => DOTS.test(l)) || ""));
  const raw = text.split("\n").find((l) => RAW.test(l));
  check(!raw, where + ": raw code on screen: " + raw);
  // A euro amount is never shown in pounds, nor added into pounds.
  for (const r of receipts.filter((x) => x.currency && x.currency !== "GBP" && Number.isInteger(x.totalPence)))
    check(!text.includes(money(r.totalPence, "GBP")), where + ": " + shopOf(r) + "'s " + money(r.totalPence, r.currency) + " shown as " + money(r.totalPence, "GBP"));
}
// A receipt's own page (or its open row): every item, quantity and price; the total; the flag; cancelled; return date.
function pageWords(where, r, text) {
  everywhere(where, text);
  const flat = text.replace(/\s+/g, " ");
  for (const i of named(r)) {
    check(flat.includes(i.name), where + ": item missing: " + i.name);
    if (Number(i.qty) > 1) check(flat.includes(i.qty + " × " + i.name), where + ": quantity missing: " + i.qty + " × " + i.name);
    if (Number.isInteger(i.pricePence) && named(r).length > 1) check(flat.includes(money(lineOf(i), r.currency)), where + ": " + i.name + "'s price " + money(lineOf(i), r.currency) + " not shown");
  }
  if (Number.isInteger(r.totalPence)) check(flat.includes(money(r.totalPence, r.currency)), where + ": total " + money(r.totalPence, r.currency) + " not shown");
  const flagged = Boolean(r.itemsCheck && r.itemsCheck.complete === false);
  const says = /Relay may have missed some items|Relay couldn't read the items|items on this receipt are in its attachment/.test(flat);
  check(flagged === says, where + ": " + (flagged ? "the totals check says items may be missing, but the page doesn't say so" : "the page says items may be missing, but they add up"));
  const namesFlag = !flagged && Boolean(r.itemsCheck && r.itemsCheck.namesOk === false);
  const saysNames = /Some item names on this receipt may not be right/.test(flat);
  check(namesFlag === saysNames, where + ": " + (namesFlag ? "the name check says a name may be wrong, but the page doesn't say so" : "the page says names may be wrong, but the name check doesn't"));
  if (namesFlag) check(/See the email/.test(flat) && /Read it again/.test(flat), where + ": a suspect name offers neither the email nor Read it again");
  if (r.cancelled) check(/cancelled/i.test(flat), where + ": cancelled order not said to be cancelled");
  else check(!/\bcancelled\b/i.test(flat), where + ": says cancelled but isn't");
  const stated = r.returns && r.returns.deadline;
  if (!stated) check(!/\bReturn by\b/.test(flat), where + ": 'Return by' a date the email never stated");
  else check(flat.includes("Return by"), where + ": the email's return date isn't shown");
  // Relay's own estimate of a date (a shop's policy or the legal minimum) is worded as one: "at least".
  if (!stated && r.returnBy && r.returnBy.estimate) {
    const d = new Date(r.returnBy.date + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    if (flat.includes(d)) check(/at least/.test(flat), where + ": Relay's estimated return date " + d + " isn't worded as an estimate");
  }
  if (r.refund || (r.returnProgress && r.returnProgress.refundPence != null)) check(/refund/i.test(flat), where + ": refunded order doesn't say it was refunded");
}
// (Shop first since 21 Nov 2026: a row's title is the business, the restaurant for a takeaway through an app or the game
// for an Apple in-app purchase, and the line under it says what was bought: "… and 3 more".)
function titleOf(r) { const n = named(r); return n.length > 1 ? " and " + (n.length - 1) + " more" : null; }
const bizOf = (r) => { const m = typeof r.merchant === "string" && r.merchant.trim(); if (m) return m;
  const v = named(r).map((i) => (typeof i.variant === "string" ? i.variant.trim() : ""));
  const apple = r.category === "digital" && (/(^|\.)apple\.com$/i.test((r.retailer && r.retailer.domain) || "") || /^apple$/i.test((r.retailer && r.retailer.name) || ""));
  return apple && v.length && v[0] && v.every((x) => x === v[0]) ? v[0] : shopOf(r); };

// ---- The browser ------------------------------------------------------------------------------------------------------------
const root = resolve(".");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise((r) => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const EMAIL = "sam.taylor@example.co.uk";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.addInitScript(([e, now]) => { try { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); } catch (x) {}
  const RealDate = Date, off = now - RealDate.now();
  // The app's clock is the inbox's (19 Nov 2026), so "days left" and "this year" match what the server worked out.
  globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } };
}, [EMAIL, NOW]);
await ctx.route("https://**/*", async (route) => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
  if (!p.startsWith("/relay/")) return route.abort();
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: NOW - 6e5, others: [] });
  if (p === "/relay/my/receipts") return j(u.searchParams.get("all") === "1" ? ALL : NEWEST);
  if (p === "/relay/my/wrapped") return j(WRAPPED);
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Taylor", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [] });
  return j({});
});
const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => { errors.push(String(e)); if (REPORT) console.log("page error: " + e); });
await page.goto(origin + "/index.html");
await homeReady(page);
await page.waitForTimeout(900);
if (SHOTS) await mkdir(SHOTS, { recursive: true });

// 1. Home: every receipt Home shows has its "+ N more" right, and nothing raw or dotted.
const home = await page.locator("#homePage").innerText();
everywhere("Home", home);
// (Round 9) Home's cards stay quiet: the name check is said only on the receipt's own page.
check(!/item names on this receipt may not be right/i.test(home), "Home: the name check's wording shows on Home");
check(receipts.some((r) => r.itemsCheck && r.itemsCheck.namesOk === false && r.itemsCheck.complete !== false), "the made-up label-as-name receipt is flagged by the name check");
for (const r of NEWEST.receipts.filter((x) => (x.kind || "receipt") === "receipt")) {
  const more = / \+ (\d+) more/.exec(home.split("\n").find((l) => named(r).some((i) => l.startsWith(i.name + " + "))) || "");
  if (more) check(Number(more[1]) === named(r).length - 1, "Home: " + shopOf(r) + " says + " + more[1] + " more for " + named(r).length + " items");
}
console.log("ok - Home: '+ N more' counts, no dots, no raw codes");

// 2. Receipts: each row's title and price, then each row opened.
await page.evaluate(() => window.go("receipts"));
await page.locator("#receiptsPage .rl-rr").first().waitFor();
await page.waitForTimeout(500);
const list = await page.locator("#receiptsPage").innerText();
everywhere("Receipts", list);
// Each month's total is what was paid in pounds (an order the shop cancelled isn't; part cancelled, less what came back), and
// money refunded is said beside it, never silently left in. The same rule as Wrapped's, so the two agree.
const months = new Map();
for (const r of receipts.filter((x) => Number.isInteger(x.totalPence) && (x.currency || "GBP") === "GBP" && x.orderDate)) {
  const m = r.orderDate.slice(0, 7), e = months.get(m) || { spent: 0, back: 0 }; const c = r.cancelled;
  e.spent += c && !c.partial ? 0 : c && c.partial && Number.isInteger(c.amountPence) ? r.totalPence - c.amountPence : r.totalPence;
  const p = r.returnProgress; if (p && p.refundedAt && Number.isInteger(p.refundPence)) e.back += p.refundPence;
  months.set(m, e);
}
for (const [m, e] of months) {
  const name = new Date(m + "-01T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const want = money(e.spent, "GBP") + (e.back ? ", " + money(e.back, "GBP") + " refunded" : "");
  check(list.includes(name + "\n" + want), "Receipts: " + name + " should total '" + want + "': " + (list.split(name + "\n")[1] || "").split("\n")[0]);
}
const yearSpent = [...months].filter(([m]) => m.startsWith("2026")).reduce((n, [, e]) => n + e.spent, 0), yearBack = [...months].filter(([m]) => m.startsWith("2026")).reduce((n, [, e]) => n + e.back, 0);
check(WRAPPED.spentPence === yearSpent, "Wrapped's total " + WRAPPED.spentPence + " isn't the months' " + yearSpent);
check(WRAPPED.refundedPence === yearBack, "Wrapped's refunds " + WRAPPED.refundedPence + " aren't the receipts' " + yearBack);
check((WRAPPED.otherCurrencies || []).some((o) => o.currency === "EUR" && o.spentPence === 9494), "Wrapped lists the euros apart: " + JSON.stringify(WRAPPED.otherCurrencies));
for (const r of receipts) {
  const esc = bizOf(r).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const row = page.locator("#receiptsPage .rl-rr").filter({ has: page.locator(".rl-rr-mid > b").filter({ hasText: new RegExp("^" + esc + "$") }) }).first();
  if (!(await row.count())) { check(false, "Receipts: no row for " + bizOf(r)); continue; }
  const head = await row.locator(".rl-rr-main").innerText();
  const more = titleOf(r), whole = await row.locator(".rl-rr-mid .rl-sr").textContent();
  if (more) check(whole.includes(more), "Receipts: " + shopOf(r) + "'s row should say '" + more.trim() + "': " + whole);
  if (Number.isInteger(r.totalPence)) check(head.includes(money(r.totalPence, r.currency)), "Receipts: " + shopOf(r) + "'s row total " + money(r.totalPence, r.currency) + ": " + head.replace(/\n/g, " | "));
  if (r.cancelled) check(new RegExp(r.cancelled.partial ? "Part cancelled" : "Cancelled").test(head), "Receipts: " + shopOf(r) + "'s row doesn't say " + (r.cancelled.partial ? "Part cancelled" : "Cancelled"));
  const back = r.returnProgress && r.returnProgress.refundedAt && r.returnProgress.refundPence;
  if (back) check(head.includes("Refunded " + money(back, "GBP")), "Receipts: " + shopOf(r) + "'s row doesn't say it was refunded: " + head.replace(/\n/g, " | "));
  await row.locator(".rl-rr-main").click();
  await row.locator(".rl-rr-detail").waitFor();
  await page.waitForTimeout(150);
  const more2 = row.locator(".rl-rr-more"); if (await more2.count()) await more2.click();
  pageWords("Receipts, " + shopOf(r), r, await row.innerText());
  if (SHOTS && ["Argos", "Nespresso", "Kestrel Outdoor"].includes(shopOf(r))) { await row.scrollIntoViewIfNeeded(); await page.screenshot({ path: SHOTS + "/receipts-" + shopOf(r).replace(/\W+/g, "-").toLowerCase() + ".png" }); }
  await row.locator(".rl-rr-main").click();
}
console.log("ok - Receipts: each row's title (the business), 'and N more', total and Cancelled; each opened row's items, quantities, prices, flag and return words");

// 3. Each receipt's page, opened from Home.
await page.evaluate(() => window.go("profile"));
await homeReady(page); await page.waitForTimeout(400);
for (const r of NEWEST.receipts.filter((x) => (x.kind || "receipt") === "receipt")) {
  const sq = page.locator("#homePage .hl-sq", { hasText: bizOf(r) }).first();
  if (!(await sq.count())) continue;
  await sq.scrollIntoViewIfNeeded(); await sq.click();
  const sheet = page.locator(".rl-back .rl-sheet").last(); await sheet.waitFor(); await page.waitForTimeout(300);
  pageWords("Receipt page, " + shopOf(r), r, await sheet.innerText());
  if (SHOTS && ["Deliveroo", "Nespresso", "Kestrel Outdoor", "Lark & Finch"].includes(shopOf(r))) await page.screenshot({ path: SHOTS + "/page-" + shopOf(r).replace(/\W+/g, "-").toLowerCase() + ".png" });
  const back = page.locator(".rl-back").last(); await back.click({ position: { x: 10, y: 10 } }); await back.waitFor({ state: "detached" }).catch(() => {});
}
console.log("ok - each receipt's page from Home");

// 4. Wrapped: its total is the money the receipts say was spent, refunds and cancellations said, euros never added in.
await page.evaluate(() => window.go("wrapped"));
await page.waitForTimeout(1200);
await page.locator("#wrappedPage h2").first().waitFor();
const wr = await page.locator("#view").innerText();
everywhere("Wrapped", wr);
check(wr.includes(money(WRAPPED.spentPence, "GBP") + " over " + WRAPPED.receipts + " receipts."), "Wrapped: the year's total " + money(WRAPPED.spentPence, "GBP") + " isn't said: " + wr.slice(0, 300));
if (WRAPPED.refundedPence) check(wr.includes(money(WRAPPED.refundedPence, "GBP") + " of it was refunded."), "Wrapped: the " + money(WRAPPED.refundedPence, "GBP") + " refunded isn't said beside the total");
if (SHOTS) await page.screenshot({ path: SHOTS + "/wrapped.png" });
console.log("ok - Wrapped: the year's total is the receipts' (cancelled orders out, refunds said), euros kept apart");

if (errors.length) check(false, "page errors: " + errors.join(" | "));
await browser.close(); server.close();
if (REPORT) { console.log(problems.length ? "PROBLEMS (" + problems.length + "):\n  - " + problems.join("\n  - ") : "no problems"); }
else console.log("PASS receipt words: what the shopper sees matches the receipts");
export { ALL, WRAPPED };
