// Browser test: the wallet on Home only shows what can still go back, and every card has a picture.
// Stubbed Relay server, made-up account. Checks: an order from over a year ago whose only delivery email said "shipped"
// doesn't sit in the wallet as "On its way"; a delivery company's own email (Royal Mail) is never shown as a shop;
// a recent order still on its way, and one with a return deadline ahead, are shown; a card with no product photo shows
// the shop's logo instead of initials; old "On its way" lines aren't shown in Receipts either.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : extname(p) === ".ico" ? "image/x-icon" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const EMAIL = "jess.tester@gmail.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const LOGO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const ship = (orderDate, extra = {}) => ({ status: "shipped", at: null, carrier: "Royal Mail", trackingNumber: "1", trackUrl: "https://www.royalmail.com/track-your-item", ...extra });
const receipts = [
  // Over a year old, only ever "shipped", no deadline: not something you can still return.
  { id: "11111111-1111-4111-8111-111111111111", status: "pending", kind: "receipt", retailer: { name: "Red Dragon Darts", domain: "reddragondarts.com" }, orderDate: day(-463), totalPence: 15880, currency: "GBP", items: [], returnable: true, returns: { deadline: null }, delivery: ship() },
  // A delivery company's own email.
  { id: "22222222-2222-4222-8222-222222222222", status: "pending", kind: "receipt", retailer: { name: "Royal Mail", domain: "royalmail.com" }, orderDate: day(-3), items: [], returnable: true, returns: {}, delivery: ship() },
  // Ordered 4 days ago and on its way: shown, with its delivery line.
  { id: "33333333-3333-4333-8333-333333333333", status: "pending", kind: "receipt", retailer: { name: "Kick Lane", domain: "kicklane.example" }, orderDate: day(-4), totalPence: 8500, currency: "GBP", items: [{ name: "Court Classic Trainers", qty: 1, pricePence: 8500 }], returnable: true, returns: {}, delivery: ship() },
  // A deadline ahead (and an old delivery line, which isn't shown).
  { id: "44444444-4444-4444-8444-444444444444", status: "pending", kind: "receipt", retailer: { name: "Amazon.co.uk", domain: "amazon.co.uk" }, orderDate: day(-40), totalPence: 2599, currency: "GBP", items: [{ name: "Desk Lamp", qty: 1, pricePence: 2599 }], returnable: true, returns: { deadline: day(10) }, delivery: ship(null, { status: "due", at: day(-36) }) },
  // An older supermarket order that was mostly a jacket: its card is named after the jacket, not the loaf listed first.
  { id: "55555555-5555-4555-8555-555555555555", status: "pending", kind: "receipt", retailer: { name: "Tesco", domain: "tesco.com" }, orderDate: day(-200), totalPence: 2650, currency: "GBP", category: "fashion",
    items: [{ name: "Finest Sourdough", qty: 1, pricePence: 150, category: "food", categorySure: false }, { name: "F&F Denim Jacket", qty: 1, pricePence: 2500, category: "fashion", categorySure: true }], returnable: true, returns: {} },
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
const logoAsks = [];
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) { logoAsks.push(decodeURIComponent(p.slice(15))); return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: LOGO }); }
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL });
  if (p === "/relay/my/receipts") return j({ receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload();
const wallet = page.locator("#walletPage");
await wallet.getByText("Court Classic Trainers").waitFor();
await page.waitForTimeout(800);
const text = await wallet.innerText();
assert.ok(!/Red Dragon Darts/.test(text), "a year-old order that only ever said 'shipped' isn't in the wallet");
assert.ok(!/Order from Royal Mail|^Royal Mail$/im.test(text), "a delivery company isn't shown as a shop: " + text.slice(0, 300));
assert.ok(/Desk Lamp/.test(text), "an order with a return deadline ahead is shown");
assert.match(text, /2 items/);
const cards = wallet.locator(".rl-po");
const kick = cards.filter({ hasText: "Court Classic Trainers" }), lamp = cards.filter({ hasText: "Desk Lamp" });
assert.match(await kick.innerText(), /On its way with Royal Mail/, "a recent parcel still shows it's on its way");
assert.ok(!/Arriving |On its way|Out for delivery/.test(await lamp.innerText()), "an old delivery line isn't shown: " + await lamp.innerText());
// Pictures: no product photo, so the shop's logo (a known one from Relay's own set, or fetched once) instead of initials.
await kick.locator(".rl-po-img.rl-has-logo img").waitFor();
await lamp.locator(".rl-po-img.rl-has-logo img").waitFor();
assert.equal(await lamp.locator(".rl-po-img img").getAttribute("src"), "logos/amazon.co.uk.png", "Relay's own copy of a well-known shop's logo");
assert.deepEqual(logoAsks, ["kicklane.example"], "other shops' logos come from Relay, once");
await page.screenshot({ path: "/tmp/shots/wallet-fresh.png" });
console.log("ok - wallet: old 'shipped' orders and delivery companies left out; recent and returnable shown, each with the shop's logo");
// Receipts: the year-old order is still there (it's a receipt), but without a stale "On its way".
await page.evaluate(() => window.go("receipts"));
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
await page.waitForTimeout(800);
const r = await page.locator("#view").innerText();
assert.ok(!/On its way with Royal Mail[\s\S]*Red Dragon|Red Dragon[\s\S]{0,200}On its way/.test(r), "no stale delivery line in Receipts");
await page.locator("#view").getByText("Fashion", { exact: true }).click();
await page.locator("#view").getByText("F&F Denim Jacket + 1 more").waitFor();
assert.ok(!/Finest Sourdough \+ 1 more/.test(await page.locator("#view").innerText()), "a card is named after the costliest thing of the receipt's own kind, not the first line");
console.log("ok - receipts keep old orders without an out-of-date delivery line; each card is named after its main thing");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS wallet freshness: only what can still go back, no delivery companies as shops, logos when there's no photo");
await browser.close(); server.close();
