// Browser test for the Wrapped story (Spotify-style slides), with a stubbed Relay server. No real data.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const W = (year) => ({ year, years: [{ year: 2026, receipts: 5 }, { year: 2024, receipts: 2 }], receipts: year === 2026 ? 5 : 0, shops: 3, items: 6, spentPence: 12200, currency: "GBP",
  topItem: { name: "<img src=x onerror=window.__xss=1>", times: 2, shop: "Zara" }, refundedPence: 2000, refundsMatched: 1, topShopShare: 65, activeMonths: 2, firstDate: "2026-03-01",
  coverage: { withTotal: 3, noTotal: 1, otherCurrency: 1 }, topShops: [{ name: "Zara", receipts: 2, spentPence: 7990 }, { name: "Tesco", receipts: 1, spentPence: 4210 }],
  categories: [{ category: "fashion", label: "Fashion", receipts: 3 }, { category: "food", label: "Food & drink", receipts: 1 }],
  byMonth: months.map((m, i) => ({ month: m, receipts: i === 2 ? 4 : i === 5 ? 1 : 0, spentPence: 0 })), busiestMonth: "Mar",
  biggest: { shop: "Zara", totalPence: 5990, date: "2026-03-10" }, returnsStarted: 1, personality: { label: "Fashion regular", why: "3 of your 5 receipts were fashion." }, note: "In-store card purchases without an email receipt aren't included." });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const asked = [], scans = [];
await ctx.route("https://**/*", route => { const u = new URL(route.request().url()); const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!u.pathname.startsWith("/relay/")) return route.abort();
  if (u.pathname === "/relay/my/gmail/history") return j({ years: [{ year: 2024, doneAt: 1 }], earliest: 2016 });
  if (u.pathname === "/relay/my/gmail/scan") { const b = JSON.parse(route.request().postData() || "{}"); scans.push(b); return j(b.cursor ? { ok: true, added: 2, more: false } : { ok: true, added: 1, more: true, cursor: "2025/06/01" }); }
  if (u.pathname === "/relay/my/wrapped") { asked.push(u.searchParams.get("year")); return j(W(Number(u.searchParams.get("year")))); }
  return j({}); });
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.addInitScript(() => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "S".repeat(43), email: "c@example.com" })));
await page.goto(origin + "/index.html"); await page.waitForTimeout(800);
await page.evaluate(() => window.go("wrapped"));
await page.getByRole("heading", { name: "Your 2026 in purchases." }).waitFor();
assert.deepEqual(await page.locator(".rl-wr-years").first().locator("button").allInnerTexts(), ["2026", "2024"], "only years with receipts (plus this year) are offered");
await page.getByText("from 3 of 5 receipts").waitFor();
await page.getByRole("button", { name: /Play your story/ }).click();
const texts = [];
for (let k = 0; k < 20; k++) {
  await page.waitForTimeout(1600); // let count-up numbers land
  texts.push(await page.locator(".rl-story-body").innerText());
  if (await page.getByRole("button", { name: "Watch again" }).count()) break;
  await page.keyboard.press("ArrowRight");
}
const story = texts.join("\n");
for (const re of [/Your 2026, one receipt at a time/, /In 2026 you spent/, /£122\.00/, /Added up from 3 of 5 receipts\. 1 had no amount Relay could read\./, /Your number one shop\s+Zara/, /65% of everything you spent/,
  /Your top shops/, /Your favourite kind of shopping\s+Fashion/, /On repeat/, /Your busiest month\s+March/, /Your biggest treat/, /£20\.00/, /Fashion regular/, /MY 2026 ON RELAY/])
  assert.match(story, re);
assert.equal(texts.length, 11, "11 slides for a full year");
// Tapping the left side goes back a slide.
await page.getByRole("button", { name: "Watch again" }).click();
await page.keyboard.press("ArrowRight");
await page.locator(".rl-story-frame").click({ position: { x: 20, y: 400 } });
assert.match(await page.locator(".rl-story-body").innerText(), /Your 2026, one receipt at a time/, "tap on the left goes back");
await page.keyboard.press("Escape");
assert.equal(await page.locator(".rl-story").count(), 0, "Escape closes the story");
assert.equal(await page.evaluate(() => window.__xss), undefined, "item and shop names never run as HTML");
// An empty year says so, and has no story to play.
await page.locator(".rl-wr-years").first().locator("button", { hasText: "2024" }).click();
await page.getByRole("heading", { name: "Nothing to wrap for 2024 yet." }).waitFor();
assert.equal(await page.getByRole("button", { name: /Play your story/ }).count(), 0);
// Earlier years: pick one, Relay reads it in rounds, then shows that year.
await page.locator(".rl-wr-glance", { hasText: "Add earlier years" }).waitFor();
const chips = await page.locator(".rl-wr-glance .rl-wr-years button").allInnerTexts();
assert.equal(chips[0], "2025"); assert.ok(chips.includes("2024 ✓"), "a year already read is ticked");
const read = page.getByRole("button", { name: "Read these years" });
assert.equal(await read.isDisabled(), true, "nothing picked, nothing to read");
await page.locator(".rl-wr-glance .rl-wr-years button", { hasText: /^2025$/ }).click();
await read.click();
await page.getByText("Done. Relay found 3 receipts in 2025.").waitFor();
assert.deepEqual(scans, [{ year: 2025 }, { year: 2025, cursor: "2025/06/01" }], "one year at a time, carrying on from where it got to");
await page.waitForFunction(() => document.querySelector(".rl-wr-years button.on") && document.querySelector(".rl-wr-years button.on").textContent === "2025");
assert.deepEqual(errors, []);
console.log("PASS Wrapped story: every slide, back/forward, close, empty years, safe names, and reading earlier years");
await browser.close(); server.close();
