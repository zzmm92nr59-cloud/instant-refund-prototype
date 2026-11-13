// Browser test: returning something bought online, from the wallet on Home. Relay can't send a return to a shop by itself
// (the shop's own returns page does that), so it makes that page quick: Start return shows the order number and the email
// address the page asks for, one tap to copy each, and opens the page with the order number already copied. Once the
// shop's return email has arrived, the card's main button shows the return QR code instead. Stubbed server, made-up orders.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : extname(p) === ".svg" ? "image/svg+xml" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const EMAIL = "jess.tester@gmail.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const QR = (await readFile("icons/icon-192.png")).toString("base64");
const PORTAL = "https://click.e.shop.test/returns?o=1234567890";
const receipts = [
  // Delivered, inside its return window, with the shop's returns link from its own email.
  { id: "11111111-1111-4111-8111-111111111111", status: "pending", kind: "receipt", retailer: { name: "lululemon", domain: "e.lululemon.com", logoDomain: "lululemon.com" }, orderRef: "1234567890",
    orderDate: day(-6), totalPence: 9800, currency: "GBP", items: [{ name: "Align High-Rise Pant", qty: 1, pricePence: 9800, variant: "Black / 8" }], returnable: true,
    returns: { windowDays: 30, deadline: day(24), portalUrl: PORTAL, qrMentioned: true }, delivery: { status: "delivered", at: day(-3), carrier: "Royal Mail" } },
  // Ordered with a Hide My Email address: the shop's page wants that address, not the inbox it lands in.
  { id: "44444444-4444-4444-8444-444444444444", status: "pending", kind: "receipt", retailer: { name: "Rains", domain: "rains.com" }, orderRef: "RA-77812", sentTo: "quiet_fox_12@privaterelay.appleid.com",
    orderDate: day(-5), totalPence: 11000, currency: "GBP", items: [{ name: "Long Jacket", qty: 1, pricePence: 11000 }], returnable: true,
    returns: { windowDays: 30, deadline: day(25), portalUrl: "https://rains.com/returns" } },
  // A return already started: the shop's return email (with its QR code) has arrived.
  { id: "22222222-2222-4222-8222-222222222222", status: "pending", kind: "receipt", retailer: { name: "Kick Lane", domain: "kicklane.example" }, orderRef: "1004",
    orderDate: day(-8), totalPence: 8500, currency: "GBP", items: [{ name: "Court Classic Trainers", qty: 1, pricePence: 8500 }], returnable: true,
    returns: { windowDays: 30, deadline: day(22), portalUrl: "https://kicklane.example/returns" },
    returnPlan: { id: "33333333-3333-4333-8333-333333333333", kind: "return_instructions", qrMentioned: true, carrier: "Evri", returnId: "RT-5551234", deadline: day(10), gmailId: "abc123def456" } },
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
const originalAsks = [];
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (u.hostname === "click.e.shop.test" || u.hostname === "kicklane.example") return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Returns</h1>" });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "{}" });
  const orig = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/original$/.exec(p);
  // Relay's server sends the email with its pictures already in place (see worker/original.js).
  if (orig) { originalAsks.push(orig[1]); return j({ html: '<p>Show this QR code at an Evri ParcelShop.</p><img alt="QR code" src="data:image/png;base64,' + QR + '">', links: [], extraImages: [] }); }
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() });
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
const lulu = wallet.locator(".rl-po", { hasText: "Align High-Rise Pant" });
await lulu.waitFor();

// 1. Start return: what the shop's page asks for, ready to copy.
// (The card opens its page; Start return is its main button.)
await lulu.click();
const sheet = page.locator(".rl-sheet");
await sheet.getByRole("button", { name: "Start return" }).click();
await sheet.getByRole("heading", { name: "Return to lululemon" }).waitFor();
await sheet.getByText(/^Send it back by /).waitFor();
const order = sheet.getByRole("button", { name: "Copy your order number, 1234567890" });
const email = sheet.getByRole("button", { name: "Copy your email address, " + EMAIL });
await order.waitFor(); await email.waitFor();
await order.click();
await order.getByText("Copied").waitFor();
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "1234567890", "the order number is copied");
await email.click();
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), EMAIL, "and the email address");
for (const b of await sheet.locator("button, a").all()) { const box = await b.boundingBox(); if (box && box.width) assert.ok(box.height >= 44, "tap targets at least 44px: " + (await b.innerText())); }
await page.screenshot({ path: "/tmp/shots/return-guide.png" });
console.log("ok - Start return shows the order number and email the shop's page asks for, one tap to copy each");

// 2. The shop's returns page opens in a new tab, with the order number already copied (paste it straight in).
await page.evaluate(() => navigator.clipboard.writeText("something else"));
const link = sheet.getByRole("link", { name: "Copy order number and open lululemon" });
assert.equal(await link.getAttribute("href"), PORTAL, "the returns link from the shop's own email");
assert.equal(await link.getAttribute("target"), "_blank");
const [tab] = await Promise.all([ctx.waitForEvent("page"), link.click()]);
await tab.waitForLoadState();
assert.equal(tab.url(), PORTAL);
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "1234567890");
await tab.close();
await sheet.getByText(/lululemon emails you a return QR code or label\. Relay shows it on this card/).waitFor();
await sheet.getByRole("button", { name: "Close" }).click();
console.log("ok - the shop's returns page opens with the order number copied, and Relay says what happens next");

// The email address offered is the one the shop sent the order to (here a Hide My Email address).
await wallet.locator(".rl-po", { hasText: "Long Jacket" }).click();
await sheet.getByRole("button", { name: "Start return" }).click();
await sheet.getByRole("button", { name: "Copy your email address, quiet_fox_12@privaterelay.appleid.com" }).waitFor();
assert.equal(await sheet.getByRole("button", { name: /^Copy your email address/ }).count(), 1, "one address: the one the shop knows");
await sheet.getByRole("button", { name: "Close" }).click();
console.log("ok - the email address offered is the one the order was sent to");

// 3. The shop's return email has arrived: the main button on the card's page shows the QR code from it.
const kl = wallet.locator(".rl-po", { hasText: "Court Classic Trainers" });
await kl.click();
await page.locator(".rl-sheet").getByRole("button", { name: "Show return QR code" }).click();
await page.locator(".rl-sheet").getByRole("heading", { name: "Your return QR code" }).waitFor();
const qr = page.frameLocator('iframe[title="Original receipt email"]').locator("img[alt='QR code']");
await qr.waitFor();
assert.deepEqual(originalAsks, ["33333333-3333-4333-8333-333333333333"], "the QR code comes from the shop's own return email, fetched when asked for");
assert.match(await qr.getAttribute("src"), /^data:image\/png;base64,/);
await page.screenshot({ path: "/tmp/shots/return-qr.png" });
console.log("ok - once the return email is in, the card's main button shows its QR code");

// (The test browser blocks service workers in every frame, and says so as an error inside the email's sandboxed frame.)
assert.deepEqual(errors.filter(e => !/Service worker is disabled because the context is sandboxed/.test(e)), []);
await browser.close(); server.close();
console.log("PASS guided returns: order number and email to copy, the shop's page with the order number copied, then the QR code on the card");
