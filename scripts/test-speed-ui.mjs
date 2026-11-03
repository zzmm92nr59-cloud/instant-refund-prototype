// Browser test: the app doesn't ask Relay for the same thing over and over. Stubbed Relay server, made-up account.
// Checks: moving between tabs within a minute reuses what was just loaded (no second request for the same thing);
// two parts of a screen asking at once make one request; a change (POST) makes the next read go to Relay again; reads
// don't send a JSON header (so the browser has less reason to ask first); the shop catalogue waits until Discover (or a
// few seconds after start) instead of holding up Home.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const receipts = [{ id: "11111111-1111-4111-8111-111111111111", status: "confirmed", kind: "receipt", retailer: { name: "RAINS", domain: "rains.com" }, orderRef: "RA-1", orderDate: day(-5), totalPence: 9500, currency: "GBP", items: [{ name: "Long Jacket", qty: 1, pricePence: 9500, category: "fashion" }], category: "fashion", categoryLabel: "Fashion", returns: { deadline: day(20) } }];
const calls = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx.route("https://**/*", async route => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  calls.push({ m, p, q: p + u.search, at: Date.now(), json: /json/i.test(req.headers()["content-type"] || "") });
  await new Promise(r => setTimeout(r, 120)); // a little server time, so requests overlap as they do for real
  if (p === "/relay/my/receipts") return j({ receipts });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, connectedAt: Date.now() - 864e5, lastScanAt: Date.now() - 36e5 });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  if (p === "/relay/my/wrapped") return j({ year: 2026, years: [], industries: [], receipts: 1 });
  if (p === "/relay/my/instore/suggestions") return j({ suggestions: [] });
  if (p === "/relay/my/instore/shops") return j({ shops: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })), EMAIL);
const t0 = Date.now();
await page.reload();
await page.locator("#homeHello", { hasText: "Jess" }).waitFor();
await page.waitForTimeout(1500);
// Counted by address and question (Home asks for recent receipts, the Receipts page for all of them: two different things).
const count = (q, since = 0, m = "GET") => calls.filter(c => c.q === q && c.m === m && c.at >= since).length;
const catalogue = since => calls.filter(c => (c.p === "/relay/live-test/products" || c.p === "/relay/shopify/catalogue") && c.at >= since).length;
assert.equal(catalogue(t0), 0, "the shop catalogue doesn't hold up Home");
for (const p of new Set(calls.filter(c => c.m === "GET").map(c => c.q))) assert.ok(count(p, t0) <= 1, p + " asked " + count(p, t0) + " times while Home opened");
assert.ok(calls.filter(c => c.m === "GET").every(c => !c.json), "reads don't send a JSON header");
console.log("ok - Home opens with one request per thing, and without the shop catalogue");

// Tabs back and forth within a minute: nothing is asked twice.
const t1 = Date.now();
for (const tab of ["receipts", "me", "profile", "receipts", "me", "profile"]) { await page.evaluate(t => window.go(t), tab); await page.waitForTimeout(700); }
const again = [...new Set(calls.filter(c => c.m === "GET" && c.at >= t1).map(c => c.q))].filter(p => count(p, t0) > 1);
assert.deepEqual(again, [], "asked again within a minute: " + again.join(", "));
console.log("ok - moving between tabs within a minute reuses what was loaded (" + calls.filter(c => c.at >= t1).length + " requests for 6 tab changes)");

// A change sends the next read to Relay again.
const t2 = Date.now();
await page.evaluate(() => window.go("me"));
await page.locator(".rl-arow", { hasText: "Email connection" }).first().waitFor();
await page.locator(".rl-ahead").click();
await page.locator("#rl-name").fill("Jess T");
await page.getByRole("button", { name: /^Save/ }).first().click();
await page.waitForTimeout(800);
assert.ok(count("/relay/my/profile", t2, "POST") >= 1, "the name was saved");
const t3 = Date.now();
await page.evaluate(() => window.go("profile")); await page.waitForTimeout(900);
assert.ok(count("/relay/my/receipts", t3) + count("/relay/my/profile", t3) >= 1, "after a change, the next read goes to Relay");
console.log("ok - after a change, reads go to Relay again");

// The catalogue was asked for once, a few seconds after start, and opening Discover doesn't ask again.
assert.equal(catalogue(t0), 2, "Square and Shopify catalogues, once each");
const t4 = Date.now();
await page.evaluate(() => window.go("discover")); await page.waitForTimeout(600);
assert.equal(catalogue(t4), 0);
// Opening Discover straight away asks for it at once.
const t5 = Date.now();
await page.reload(); await page.locator("#homeHello", { hasText: "Jess" }).waitFor();
await page.evaluate(() => window.go("discover")); await page.waitForTimeout(800);
assert.equal(catalogue(t5), 2, "Discover opened early loads the catalogue there and then");
console.log("ok - the shop catalogue loads once: when Discover opens, or a few seconds after start");
assert.deepEqual(errors, []);
await browser.close(); server.close();
console.log("PASS speed: one request per thing, tabs reuse what was just loaded, changes refresh, the catalogue waits for Discover (stubbed server)");
