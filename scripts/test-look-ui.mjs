// Browser test: the Apple-Music-like look. Stubbed Relay server, made-up account.
// Checks: the app follows the phone's light or dark setting; Browse has a grid of colourful tiles (white names on each
// tile's own colour, readable in both modes) led by this year's Wrapped; a tile opens its group in Receipts in the same colour; returns
// due in three days are a red number on the Home tab of the glass tab bar; the tab bar steps aside while typing.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, litTab } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let n = 0;
const R = (shop, category, item, pence, ago, extra = {}) => ({ id: "00000000-0000-4000-8000-" + String(++n).padStart(12, "0"), kind: "receipt", status: "confirmed", orderRef: "R" + n, orderDate: day(-ago), totalPence: pence, currency: "GBP",
  retailer: { name: shop, domain: null }, category, items: [{ name: item, qty: 1, pricePence: pence, category, categorySure: true }], returnable: !["food", "travel", "digital"].includes(category), ...extra });
const receipts = [R("Kick Lane", "fashion", "Court Classic Trainers", 8500, 3, { returns: { deadline: day(9) } }), R("Glow Lab", "beauty", "Vitamin C Serum", 2400, 5, { returns: { deadline: day(2) } }),
  R("Corner Grocer", "food", "Cold Brew Coffee", 350, 1), R("Volt", "electronics", "Wireless Earbuds", 7900, 6), R("Odd Bits", "other", "Board Game", 2500, 30)];
const browser = await chromium.launch();
const tileColours = {};
for (const scheme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, serviceWorkers: "block" }); await skipInterests(ctx);
  await ctx.route("https://**/*", route => { const p = new URL(route.request().url()).pathname; const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (!p.startsWith("/relay/")) return route.abort();
    if (p === "/relay/my/receipts") return j({ receipts }); if (p === "/relay/my/wrapped") return j({ year: new Date().getFullYear(), receipts: receipts.length, years: [{ year: new Date().getFullYear(), receipts: receipts.length }], industries: [], coverage: {} }); if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google" }); if (p === "/relay/my/profile" || p === "/relay/me") return j({ email: "jess@example.com", name: "Jess Tester" });
    return j({}); });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(origin + "/index.html");
  await page.evaluate(() => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: "jess@example.com", expiresAt: Date.now() + 864e5 })));
  await page.reload();
  await page.evaluate(() => window.go("discover"));
  await page.locator("#browsePage .rl-tile").first().waitFor();
  await page.locator("#browsePage .rl-wr-door").waitFor();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, scheme === "dark" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)", scheme + ": the page follows the phone's setting");
  // The tiles: this year's Wrapped first, "Other" last, and each name readable on its tile.
  assert.ok(await page.evaluate(() => { const d = document.querySelector("#browsePage .rl-wr-door"), t = document.querySelector("#browsePage .rl-tile"); return Boolean(d.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING); }), "this year's Wrapped leads");
  const tiles = await page.locator("#browsePage .rl-tile").evaluateAll(ts => ts.map(t => ({ name: t.querySelector("b").textContent, bg: getComputedStyle(t).backgroundColor, fg: getComputedStyle(t.querySelector("b")).color, year: t.classList.contains("rl-year") })));
  assert.equal(tiles[tiles.length - 1].name, "Other", "Other comes last");
  const lum = c => { const v = c.match(/\d+/g).slice(0, 3).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
  for (const t of tiles) { const a = lum(t.bg), b = lum(t.fg); assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 3, scheme + ": " + t.name + " is readable on its tile"); }
  for (const t of tiles) { if (tileColours[t.name]) assert.equal(tileColours[t.name], t.bg, t.name + " keeps its colour in both modes"); tileColours[t.name] = t.bg; }
  assert.ok(new Set(tiles.map(t => t.bg)).size === tiles.length, "every kind of shopping has its own colour");
  // Returns due in the next three days are a red number on the Home tab (nothing floats over the page); the glass tab bar.
  const badge = page.locator('#foot [data-tab="profile"] .tab-badge');
  await badge.waitFor();
  assert.equal(await badge.innerText(), "1", "one return due in three days (the serum), not the trainers due in nine");
  assert.equal(await page.locator('#foot [data-tab="profile"]').getAttribute("aria-label"), "Home, 1 return due soon");
  assert.equal(await page.locator("#nextUp").isVisible(), false, "no strip floating over the page");
  assert.notEqual(await page.locator("#foot").evaluate(f => getComputedStyle(f).backdropFilter), "none", "the tab bar is frosted glass");
  await page.screenshot({ path: `/tmp/shots/look-receipts-${scheme}.png` });
  // A tile opens its group in the tile's own colour.
  await page.locator("#browsePage .rl-tile", { hasText: "Fashion" }).click();
  assert.equal(await page.locator(".rl-cat-hero").evaluate(h => getComputedStyle(h).backgroundColor), tileColours.Fashion);
  // While typing, the floating bars step aside for the keyboard.
  await page.locator(".rl-cat-search").focus();
  assert.equal(await page.locator("#foot").isVisible(), false);
  await page.locator(".rl-cat-search").blur();
  assert.equal(await page.locator("#foot").isVisible(), true);
  // The Wrapped card opens Wrapped, with Browse still lit.
  await page.evaluate(() => window.go("discover"));
  await page.locator("#browsePage .rl-wr-door").click();
  await page.locator(".rl-wr-play, .rl-wr-door").first().waitFor({ timeout: 10000 });
  assert.equal(await page.evaluate(() => window.page), "wrapped");
  assert.equal(await litTab(page), "Browse", "Wrapped lives in Browse");
  assert.deepEqual(errors, [], "no page errors");
  await ctx.close();
}
console.log("ok - Browse's colourful tiles led by Wrapped, readable in light and dark; returns due soon on the Home tab; the tab bar steps aside for the keyboard");
console.log("PASS look: follows the phone's light or dark setting, colourful tiles, floating glass tab bar with returns due soon on Home");
await browser.close(); server.close();
