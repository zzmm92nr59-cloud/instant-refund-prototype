// Browser test: "today" is the UK's date, whatever the phone's clock or time zone. Stubbed Relay server, made-up shops, and
// a clock the test sets itself.
// The date in UTC is still yesterday from midnight to 1am in British Summer Time. Relay used to take "today" from it, so
// for that hour a return's last day read "1 day left" and a date that had passed read "Return today".
// Checks, at 00:30 BST on a return's last day (14 July) and at 00:30 BST the day after, on a phone set to UTC, to UK time
// and to New York time:
//  1. Relay's own "today" (ukToday) is the UK date, in summer and in winter.
//  2. Receipts: the receipt whose shop gave 14 July says "Return today" on the 14th, and nothing on the 15th (it has passed);
//     the one whose shop gave 15 July says "1 day left" on the 14th and "Return today" on the 15th.
//  3. A receipt's own details say the same: Return today on the 14th, and no countdown at all on the 15th.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const EMAIL = "jess.tester@example.com";
const R = (id, shop, ref, deadline, item) => ({ id, status: "confirmed", kind: "receipt", retailer: { name: shop, domain: shop.toLowerCase().replace(/\W+/g, "") + ".example" }, orderRef: ref, orderDate: "2026-07-01",
  totalPence: 4500, currency: "GBP", category: "fashion", categoryLabel: "Fashion", returnable: true, items: [{ name: item, qty: 1, pricePence: 4500, category: "fashion", categorySure: true }],
  returns: { windowDays: null, windowFrom: null, deadline, instructions: [] }, returnBy: { date: deadline, basis: "stated" } });
const receipts = [R("11111111-1111-4111-8111-111111111111", "Harlow Lane", "HL-14", "2026-07-14", "Linen Shirt"), R("22222222-2222-4222-8222-222222222222", "Fernway", "FW-15", "2026-07-15", "Cord Trousers")];
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const browser = await chromium.launch();
async function at(iso, zone) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", timezoneId: zone }); await skipInterests(ctx);
  await ctx.route("https://**/*", async route => {
    const u = new URL(route.request().url()), p = u.pathname;
    const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify(b) });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith("/relay/")) return route.abort();
    if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL });
    if (p === "/relay/my/receipts") return j({ receipts });
    if (p === "/relay/my/purchases") return j({ purchases: [] });
    if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
    return j({});
  });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.clock.setFixedTime(new Date(iso));
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ["relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: EMAIL, expiresAt: Date.parse(iso) + 30 * 864e5 })]);
  await page.goto(origin + "/index.html");
  await page.waitForFunction(() => typeof window.relayUkToday === "function");
  return { ctx, page, errors };
}
// The words on a receipt's row in Receipts (its shop, and the return chip if it has one).
async function rows(page) {
  await page.evaluate(() => window.go("receipts"));
  await page.locator("#view .rl-calm-filter, #view .rl-rr").first().waitFor();
  await page.locator("#view", { hasText: "Harlow Lane" }).first().waitFor();
  return page.evaluate(() => { const out = {}; document.querySelectorAll("#view .rl-rr").forEach(r => { const t = r.innerText; for (const s of ["Harlow Lane", "Fernway"]) if (t.includes(s)) out[s] = (r.querySelector(".rl-rr-chip") || { textContent: "" }).textContent.trim(); }); return out; });
}
async function pageOf(page, shop) {
  const row = page.locator("#view .rl-rr", { hasText: shop }).first();
  await row.click(); await page.waitForTimeout(500);
  // The row and what opened under it (its details), not the other receipts.
  return row.evaluate(r => { let t = r.innerText, n = r.nextElementSibling; if (n && !n.classList.contains("rl-rr")) t += "\n" + n.innerText; return t; });
}

for (const zone of ["UTC", "Europe/London", "America/New_York"]) {
  // 00:30 British Summer Time on Tuesday 14 July 2026 (23:30 on the 13th in UTC): the last day of the first return.
  {
    const { ctx, page, errors } = await at("2026-07-13T23:30:00Z", zone);
    assert.equal(await page.evaluate(() => window.relayUkToday()), "2026-07-14", "today in the UK is the 14th (" + zone + ")");
    assert.equal(await page.evaluate(() => window.relayUkToday(-1)), "2026-07-13");
    const got = await rows(page);
    assert.deepEqual(got, { "Harlow Lane": "Return today", "Fernway": "1 day left" }, "on the last day, at half past midnight (" + zone + ")");
    const words = await pageOf(page, "Harlow Lane");
    assert.match(words, /Return today/, "the receipt's own page says so too");
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  // 00:30 British Summer Time on Wednesday 15 July: the first return's date has passed; the second is on its last day.
  {
    const { ctx, page, errors } = await at("2026-07-14T23:30:00Z", zone);
    assert.equal(await page.evaluate(() => window.relayUkToday()), "2026-07-15", "today in the UK is the 15th (" + zone + ")");
    const got = await rows(page);
    assert.deepEqual(got, { "Harlow Lane": "", "Fernway": "Return today" }, "the day after, at half past midnight (" + zone + ")");
    const words = await pageOf(page, "Harlow Lane");
    assert.doesNotMatch(words, /Return today|days? left|last day/i, "a date that has passed isn't counted down to");
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  console.log("ok - " + zone + ": at 00:30 BST the last day says Return today, and the day after it has passed");
}
// Winter (UK time is UTC): half past midnight and half past eleven at night are the same UK day as in UTC.
{
  const { ctx, page } = await at("2026-12-01T00:30:00Z", "UTC");
  assert.equal(await page.evaluate(() => window.relayUkToday()), "2026-12-01");
  await page.clock.setFixedTime(new Date("2026-12-01T23:30:00Z"));
  assert.equal(await page.evaluate(() => window.relayUkToday()), "2026-12-01");
  // And the last hour of a summer's day in UTC is already tomorrow in the UK.
  await page.clock.setFixedTime(new Date("2026-06-30T23:05:00Z"));
  assert.equal(await page.evaluate(() => window.relayUkToday()), "2026-07-01");
  await ctx.close();
  console.log("ok - winter and the turn of a month");
}
await browser.close(); server.close();
console.log("PASS UK today: return countdowns use the UK's date at 00:30 BST on a deadline day and the day after, on any phone time zone (stubbed server)");
