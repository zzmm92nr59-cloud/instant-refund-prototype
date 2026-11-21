// Browser test: Shops on Relay with no shops yet is never a dead end. Stubbed Relay server, made-up person, no shops.
// Checks: "New products are on their way" stays, with one next step under it: "Connect your email" for someone with no
// inbox connected (it opens Receipts, where the connect flow is, as Home's "Connect your email" does), "See your receipts"
// for someone with one; a drawn icon, no symbols; at least 44px tall; it reacts when pressed; no test words.
// SHOPS_EMPTY_SHOTS=<folder> also saves 390x844 pictures at 2x. Nothing here proves a real phone.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname, join } from "node:path";
import { skipInterests, openShops, waitOutDoubleTap } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : extname(p) === ".svg" ? "image/svg+xml" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.SHOPS_EMPTY_SHOTS || "/tmp/shots"; await mkdir(SHOTS, { recursive: true });
const EMAIL = "robin.tester@example.com";
const NEVER = /\bdemo\b|\bsample\b|\btest\b|testing|sandbox|fictional|prototype/i;
const browser = await chromium.launch();

async function run(connected) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" }); await skipInterests(ctx);
  await ctx.route("https://**/*", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (!p.startsWith("/relay/")) return route.abort();
    if (p === "/relay/shopify/catalogue") return j({ products: [], published: true, publishedStoreCount: 0 });
    if (p === "/relay/web-shops") return j({ products: [], shops: [], preview: false });
    if (p === "/relay/my/gmail") return j(connected ? { connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5 } : { connected: false, maxInboxes: 5 });
    if (p === "/relay/my/receipts") return j({ receipts: [] });
    if (p === "/relay/my/purchases") return j({ purchases: [] });
    if (p === "/relay/my/photo-search") return j({ available: false, perDay: 30 });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Robin", photo: null });
    if (p === "/relay/my/second-step") return j({ required: false, done: true, checked: true });
    if (p === "/relay/my/admin/me") return j({ admin: false });
    if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
    return j({});
  });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(origin + "/index.html");
  await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
  await page.reload();
  await page.waitForFunction(() => window.RelayAccount && window.go);
  await openShops(page);
  const empty = page.locator("#catalogResults .dc-empty");
  await empty.waitFor();
  assert.equal(await empty.locator("h3").innerText(), "New products are on their way");
  assert.equal(await empty.locator("p").innerText(), "When shops join Relay, their newest products show up here.");
  const want = connected ? "See your receipts" : "Connect your email";
  const btn = empty.locator(".dc-nextbtn");
  await page.waitForFunction(w => { const b = document.querySelector("#catalogResults .dc-nextbtn"); return b && b.innerText.trim() === w; }, want);
  assert.equal(await empty.locator(".dc-nextbtn").count(), 1, "one next step");
  assert.equal(await btn.locator("svg.ico-i").count(), 1, "a drawn icon");
  const look = await btn.evaluate(b => { const r = b.getBoundingClientRect(), s = getComputedStyle(b); return { h: r.height, font: parseFloat(s.fontSize), text: b.innerText, wide: document.documentElement.scrollWidth > innerWidth + 1, transition: s.transitionProperty }; });
  assert.ok(look.h >= 44, "44px tall: " + look.h);
  assert.ok(look.font >= 13);
  assert.ok(!/[◎✦↻▶⌂◈▤⇄→✓+×✕↩]/u.test(look.text), "no symbols as icons");
  assert.ok(!look.wide, "no sideways scroll");
  assert.ok(/transform/.test(look.transition), "reacts when pressed");
  assert.ok(!NEVER.test(await page.locator("#view").innerText()), "no test words");
  await page.screenshot({ path: join(SHOTS, "shops-empty-" + (connected ? "connected" : "no-email") + ".png") });
  // Bigger text: the button still fits.
  await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; document.body.style.fontSize = "130%"; });
  assert.ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "bigger text: no sideways scroll");
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; document.body.style.fontSize = ""; });
  await waitOutDoubleTap(page);
  await btn.click();
  await page.waitForFunction(() => document.querySelector("#view") && !document.querySelector("#catalogResults .dc-empty"));
  assert.equal(await page.evaluate(() => typeof page !== "undefined" ? page : null), "receipts", "opens Receipts");
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - no shops yet, " + (connected ? "an inbox connected: See your receipts" : "no inbox: Connect your email") + ", which opens Receipts");
}
await run(false);
await run(true);
await browser.close(); server.close();
console.log("\nshops empty: all checks passed");
