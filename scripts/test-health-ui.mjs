// Browser test: the Relay health page (Profile, Team; admins only). Stubbed Relay server with made-up counts.
// Checks: only an admin sees "Relay health"; the page shows the headline numbers, how confidently purchases were read, a
// 14-day chart whose columns give their numbers when tapped (and a table of them all), shops (named only from 3 people)
// and the admin's own receipts by shop, inboxes and scans (in plain words, never an error code), returns, swaps and the
// rest; orders checked against shops' own records (with the admin's own differences in plain words); it shows greyed
// outlines while loading, keeps the last copy, and Refresh asks again once for a double tap. Every part passes the polish
// rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const ADMIN = "ops@example.com", MEMBER = "member@example.com", DAY = 864e5, now = Date.now();
const days = Array.from({ length: 14 }, (_, i) => ({ day: new Date(now - (13 - i) * DAY).toISOString().slice(0, 10), kept: [0, 3, 5, 2, 0, 7, 4, 1, 0, 6, 9, 3, 2, 4][i], skipped: [1, 8, 12, 4, 0, 15, 9, 3, 1, 10, 22, 7, 5, 8][i] }));
const q = (o) => ({ receipts: 0, high: 0, medium: 0, low: 0, confirmed: 0, dismissed: 0, noTotal: 0, noItems: 0, pasted: 0, ...o });
const HEALTH = {
  generatedAt: new Date(now).toISOString(), minShoppersPerShop: 3,
  people: { shoppers: 12, newThisWeek: 3, newThisMonth: 7, signedIn: 9, signedInThisWeek: 6 },
  inboxes: { gmail: 10, outlook: 3, shoppers: 11, checkedToday: 12, notCheckedToday: 1, lastChecked: new Date(now - 600e3).toISOString(), newThisWeek: 2,
    scansThisWeek: { done: 14, failed: 2, running: 1 }, scanErrorsThisWeek: [{ error: "gmail_reconnect_needed", count: 1 }, { error: "something_new", count: 1 }] },
  reading: { readerVersion: 26, emailsLookedAt: 4210, notReceipts: 3570, emailsThisWeek: 312, kinds: { receipt: 540, delivery_update: 80, return_update: 20 },
    purchases: q({ receipts: 540, high: 466, medium: 51, low: 23, confirmed: 120, dismissed: 14, noTotal: 19, noItems: 11, pasted: 6 }),
    purchasesThisWeek: q({ receipts: 46, high: 41, medium: 4, low: 1 }),
    byReader: [{ version: 26, emails: 4100 }, { version: 25, emails: 110 }], waitingToBeRead: 2,
    shoppersTaught: { groupsChanged: 9, shopsMarkedPromotions: 4, people: 5 }, itemsMarkedReturning: 3, days },
  shops: [{ domain: "brindle.example", people: 4, ...q({ receipts: 22, high: 15, medium: 3, low: 4, dismissed: 2, noTotal: 3 }) },
    { domain: "larkspur.example", people: 3, ...q({ receipts: 9, high: 9 }) }],
  mine: { receipts: 61, personalMail: 2, noShop: 0, shops: [{ domain: "fennel.example", ...q({ receipts: 5, high: 3, low: 2, noTotal: 2, pasted: 1 }) }, { domain: "brindle.example", ...q({ receipts: 8, high: 8 }) }] },
  returnsAndSwaps: { returns: { requested: 2, refunded: 1 }, swaps: { completed: 3 }, labels: 2, payments: [{ status: "succeeded", test: true, count: 4 }] },
  extras: { gifts: 7, giftGivers: 2, earlierYearsRead: 5, notificationDevices: 4, notificationPeople: 3, priceWatches: 11, watchers: 4 },
  shopsConnected: { shopify: 6, shopifyTest: 6, square: 1 }, security: { wrongCodesToday: 0 },
  mail: { ownAddress: false, returnsShopNotEmailedThisWeek: 1 },
  sharedEmails: { kept: 3, waiting: 2, thisWeek: 1, people: 2, keptDays: 30 },
  aiReader: { on: true, shoppersOn: 2, reads: 14, thisWeek: 5, failed: 1, notPurchase: 2,
    parts: { shop: { filled: 2, agreed: 8, differed: 0 }, total: { filled: 6, agreed: 3, differed: 1 }, date: { filled: 0, agreed: 0, differed: 0 },
      number: { filled: 1, agreed: 9, differed: 0 }, items: { filled: 4, agreed: 5, differed: 2 } } },
  checkedByShops: { days: 90, orders: 14, shoppers: 6, withInbox: 12, found: 10, byNumber: 8, notFound: 1, unsure: 1, allRight: 7,
    parts: { shop: { right: 9, wrong: 1, missing: 0 }, total: { right: 8, wrong: 1, missing: 1 }, date: { right: 10, wrong: 0, missing: 0 },
      number: { right: 8, wrong: 0, missing: 0 }, items: { right: 8, none: 1, missing: 0, extra: 1, quantity: 0 } },
    byReader: [{ version: 26, found: 9, allRight: 7 }, { version: 25, found: 1, allRight: 0 }],
    shops: [{ name: "Brindle & Co", people: 3, orders: 7, found: 6, allRight: 4, totalRight: 5, itemsRight: 5 }],
    mine: { orders: 3, withInbox: true, found: 2, allRight: 1,
      differences: [{ shop: "Larkspur Home", day: "2026-10-20", number: "#1002", readerVersion: 26, how: "number", parts: [
        { part: "total", read: 5000, shop: 6000 }, { part: "items", verdict: "extra", read: 2, shop: 1, missing: [], extra: ["Shipping"] }] }],
      notFound: [{ shop: "Larkspur Home", day: "2026-11-01", number: "#1004", unsure: false }] } }
};
const st = { admin: true, healthCalls: 0 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  if (p === "/relay/my/admin/me") return j(st.admin ? { admin: true, openReports: 1 } : { admin: false });
  if (p === "/relay/my/admin/review-account") return st.admin ? j({ on: false }) : j({ error: "not_found" }, 404);
  if (p === "/relay/my/admin/health/email" && m === "POST") { st.mails = (st.mails || 0) + 1; await new Promise(r => setTimeout(r, 300)); return st.mails === 1 ? j({ ok: true, to: ADMIN }) : j({ error: "too_many_requests" }, 429); }
  if (p === "/relay/my/admin/health") {
    if (!st.admin) return j({ error: "not_found" }, 404);
    st.healthCalls++; await new Promise(r => setTimeout(r, 400)); // slow enough to see the outlines, and for a second tap to land
    return j(HEALTH);
  }
  if (p === "/relay/my/profile") return j({ email: st.admin ? ADMIN : MEMBER, name: st.admin ? "Ops" : "Member", photo: null });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true, outlookAvailable: true });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: ADMIN });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  if (p === "/relay/my/2fa") return j({ app: false, text: false });
  if (p === "/relay/my/phone") return j({ available: true, ending: null });
  if (p === "/relay/my/card") return j({ enabled: true, testMode: false, card: null });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
// The polish rules within one part of the page (see test-review-ui.mjs): 44px tap targets, 13px text (12px capitals),
// readable contrast, no symbol characters as icons, nothing wider than the screen.
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; }; // color-mix() comes back as color(srgb 0–1)
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " input, " + scope + " summary")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓+▾▸]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    const caps = s.textTransform === "uppercase" || (/[A-Z]/.test(el.textContent) && el.textContent === el.textContent.toUpperCase());
    if (px < 13 && !(caps && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    const back = bgOf(el), a = lum(flat(rgb(s.color), back)), b = lum(back), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3 && !el.closest("button:disabled")) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const polished = async (where, scope) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/health-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png", fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const signedInAs = async email => {
  await page.goto(origin + "/index.html");
  await page.evaluate(e => { localStorage.clear(); localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); }, email);
  await page.goto(origin + "/index.html");
};
const view = page.locator("#mePage");
const profile = async () => { await page.evaluate(() => window.go("me")); await view.locator(".rl-arow").first().waitFor(); };

// 1. A member never sees it.
st.admin = false;
await signedInAs(MEMBER);
await profile();
await view.locator(".rl-arow", { hasText: "Security and privacy" }).waitFor();
await page.waitForTimeout(400);
assert.equal(await view.getByText("Relay health").count(), 0, "members don't see Relay health");
console.log("ok - only admins see Relay health");

// 2. The admin opens it: outlines while it loads, then the numbers.
st.admin = true;
await signedInAs(ADMIN);
await profile();
const row = view.locator(".rl-arow", { hasText: "Relay health" });
await row.waitFor();
await row.click();
await view.locator(".rl-hp .rl-skel").first().waitFor();
assert.equal(await view.getByText(/Loading/).count(), 0, "no bare 'Loading…'");
await view.getByText("Read confidently", { exact: true }).first().waitFor();
const text = await view.innerText();
for (const s of ["Shoppers", "12", "+3 this week", "Inboxes connected", "13", "Receipts this week", "46", "86%", "of 540 purchases",
  "Relay asks the shopper to check the rest: 51 with medium confidence, 23 with low.", "Receipts found each day", "Most in a day: 9",
  "Emails looked at", "4,210", "3,570 weren't receipts, so only that was kept", "Removed as not theirs", "Added by hand", "Receipts Relay missed",
  "Reader version", "4,100 emails read by this version, 110 by older ones", "brindle.example", "22 receipts from 4 people", "2 removed as not theirs", "3 no total",
  "Your own receipts", "fennel.example", "Nothing to fix", "2 receipts were forwarded from a personal address",
  "Inbox needs connecting again", "Other problems", "14 finished, 1 still going, 2 stopped", "Returns: requested", "Swaps: completed", "Swap payments", "0 live, 4 test",
  "Gifts tagged", "by 2 people", "Shops on Shopify", "6 of them test shops", "Wrong sign-in codes in the last day",
  // Relay's own emails: still from the mail service's test address here, and what that means.
  "Relay's emails", "From a test address", "Only reach your own email, so shops and new shoppers don't get them yet. Relay needs a sending address of its own",
  "Returns the shop wasn't emailed about"])
  assert.ok(text.toLowerCase().includes(s.toLowerCase()), "the page shows: " + s); // section names are shown in capitals
for (const code of ["gmail_reconnect_needed", "something_new"]) assert.ok(!text.includes(code), "no error codes on screen: " + code);
console.log("ok - the page shows the headline numbers, reading quality, shops (from 3 people), the admin's own receipts, inboxes, returns and the rest");
// Checked against shops' own records.
const key = await view.locator(".rl-agroup", { hasText: "Checked against shops' own records" }).innerText();
for (const s of ["Read exactly right", "70%", "10 orders were found, out of 12 orders in the last 90 days from shoppers with an inbox connected.",
  "Found in the shopper's inbox", "8 by order number, the rest by shop and day", "Not sure which receipt", "From shoppers without an inbox",
  "Total right", "8 of 10, 1 wrong, 1 not read", "Items right", "8 of 10, 1 with none read, 1 with extra lines", "Reader version 26", "7 of 9",
  "Brindle & Co", "7 orders from 3 people, 6 found", "1 total wrong", "Items wrong in 1 order", "Your own orders: 2 of 3 found, 1 read exactly right.",
  "Larkspur Home #1002", "20 Oct, read by version 26", "Total read as £50.00, shop says £60.00", "Extra lines read: Shipping", "Larkspur Home #1004", "1 Nov: not found in your inbox"])
  assert.ok(key.includes(s), "the answer key shows: " + s);
assert.match(await view.locator(".rl-agroup", { hasText: "Checked against shops' own records" }).locator(".rl-hp-meter").getAttribute("aria-label"), /^70% of orders found were read exactly right$/);
console.log("ok - orders checked against shops' own records: each part, each reader version, shops from 3 people, and the admin's own differences in plain words");
// AI help, and emails shoppers sent.
const aiGroup = (await view.locator(".rl-agroup", { hasText: "Emails read by the AI" }).innerText()).replace(/^AI HELP\n/, "AI help\n");
for (const s of ["AI help", "On", "Shoppers with it on", "Emails read by the AI", "14", "5 this week, 1 couldn't be read, 2 not purchases", "Totals", "6 filled in",
  "3 agreed with the rules, 1 differed", "Items", "4 filled in", "Order numbers"]) assert.ok(aiGroup.includes(s), "AI help shows: " + s);
assert.ok(!aiGroup.includes("Dates"), "a part with nothing to say is left out");
const sentGroup = view.locator(".rl-agroup", { hasText: "Each is deleted 30 days after it was sent" });
const sentText = (await sentGroup.innerText()).toLowerCase(); // section names are shown in capitals
for (const s of ["Emails shoppers sent", "Waiting to be read", "Each is deleted 30 days after it was sent", "From 2 people in all"]) assert.ok(sentText.includes(s.toLowerCase()), "emails sent shows: " + s);
assert.equal(await sentGroup.getByRole("button", { name: "Read them" }).count(), 1);
console.log("ok - AI help: on, who has it, where it agreed and differed; emails shoppers sent: waiting, kept, a way to read them");

// 3. The chart: 14 columns; tapping one gives its numbers; the table has them all.
const cols = view.locator(".rl-hp-chart button");
assert.equal(await cols.count(), 14);
assert.match(await cols.nth(10).getAttribute("aria-label"), /: 9 receipts found, 22 other emails skipped$/);
await cols.nth(10).click();
const tip = view.locator(".rl-hp-tip");
await tip.waitFor();
assert.match(await tip.innerText(), /9 receipts · 22 skipped/);
assert.equal(await view.locator(".rl-hp-table").isVisible(), false, "the table stays folded away until asked for");
await view.getByText("See the numbers").click();
assert.equal(await view.locator(".rl-hp-table").isVisible(), true);
assert.equal(await view.locator(".rl-hp-table tbody tr").count(), 14);
assert.match(await view.locator(".rl-hp-table tbody tr").first().innerText(), /\t4\t8$/, "newest day first");
console.log("ok - the chart's columns give their numbers when tapped, and the table has them all");
await polished("page", "#mePage .rl-asub");

// 4. Refresh asks again once for a double tap; the last copy stays on screen meanwhile.
const before = st.healthCalls;
await view.getByRole("button", { name: "Refresh" }).dblclick();
await page.waitForTimeout(900);
assert.equal(st.healthCalls - before, 1, "a double tap refreshes once");
assert.ok((await view.innerText()).includes("4,210"), "the numbers stay on screen while refreshing");
// With no shop orders to check yet, the part says so (and what it will do); if it couldn't be worked out, it says that.
HEALTH.checkedByShops = { ...HEALTH.checkedByShops, orders: 0, withInbox: 0, found: 0 };
await view.getByRole("button", { name: "Refresh" }).click();
await view.getByText("Nothing to check yet: none of the last 90 days' orders from connected shops belong to a Relay shopper.", { exact: false }).waitFor();
await page.waitForTimeout(500);
HEALTH.checkedByShops = null;
await view.getByRole("button", { name: "Refresh" }).click();
await view.getByText("Couldn't check this part just now. Try Refresh in a moment.").waitFor();
assert.ok((await view.innerText()).includes("4,210"), "and the rest of the page is still there");
await view.getByRole("button", { name: /Back to/ }).click();
await row.click();
assert.ok((await view.innerText()).includes("4,210"), "opening it again shows the last copy at once");
// 5. By email: one now (once for a double tap), and a plain message when one was sent a moment ago.
await view.getByText("Each morning from 8am, Relay's admins get a summary of these numbers by email", { exact: false }).waitFor();
await view.getByRole("button", { name: "Email me one now" }).dblclick();
await view.getByText("Sent to " + ADMIN + ". It can take a minute to arrive.").waitFor();
assert.equal(st.mails, 1, "a double tap sends once");
await page.waitForTimeout(500); // a deliberate second tap, not part of the double tap (the app ignores repeats within 400ms)
await view.getByRole("button", { name: "Email me one now" }).click();
await view.getByText("One was sent a moment ago. Try again in a few minutes.").waitFor();
console.log("ok - Email me one now: sends once, then says plainly when one was just sent");

// 6. The morning email's link opens the page.
await page.goto(origin + "/index.html#open=health");
await view.locator(".rl-hp-kpis").waitFor();
assert.ok((await view.innerText()).includes("4,210"), "the link from the email opens Relay health");
await page.goto("about:blank");
await page.goto(origin + "/index.html#open=health"); // opening the app fresh from the email
await view.locator(".rl-hp-kpis").waitFor();
assert.ok(!/open=/.test(await page.evaluate(() => location.hash)), "the address is tidied, so a reload doesn't open it again");
console.log("ok - the link in the morning email opens Relay health");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS Relay health page: admins only, outlines then numbers, chart and table, plain words, refresh once, polished in light and dark");
await browser.close(); server.close();
