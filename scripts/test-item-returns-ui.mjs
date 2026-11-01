// Browser test: a multi-item email order shows one card per item in the wallet; marking one moves it to Returns,
// the rest stays; a return Relay can't place asks which items went back. Stubbed server, made-up data.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10);
const order = { id: "11111111-1111-4111-8111-111111111111", kind: "receipt", retailer: { name: "Northwind", domain: "northwind.test" }, orderDate: today, totalPence: 10700, currency: "GBP", category: "fashion",
  items: [{ name: "Flared Pant", variant: "UK 8", pricePence: 6900, qty: 1 }, { name: "Cropped Tee", variant: "M", pricePence: 3800, qty: 1 }], returnBy: { date: soon }, returns: { portalUrl: "https://returns.northwind.test/" }, status: "confirmed" };
const other = { id: "22222222-2222-4222-8222-222222222222", kind: "receipt", retailer: { name: "Fieldhouse", domain: "fieldhouse.test" }, orderDate: today, totalPence: 9000, currency: "GBP", category: "fashion",
  items: [{ name: "Rain Jacket", pricePence: 6000 }, { name: "Cap", pricePence: 3000 }], returnBy: { date: soon }, returnProgress: { parcel: { status: "in_transit" } }, status: "confirmed" };
let marks = {}; const posts = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.route("https://**/*", route => { const u = new URL(route.request().url()), m = route.request().method(); const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!u.pathname.startsWith("/relay/")) return route.abort();
  const it = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/items$/.exec(u.pathname);
  if (it && m === "POST") { const b = JSON.parse(route.request().postData()); posts.push([it[1], b]); const e = marks[it[1]] = marks[it[1]] || {}; b.items.forEach(x => { e[x.index] = x.status || "kept"; }); return j({ ok: true }); }
  if (u.pathname === "/relay/my/receipts") return j({ receipts: [order, other].map(o => marks[o.id] ? { ...o, itemReturns: marks[o.id] } : o) });
  if (u.pathname === "/relay/my/purchases") return j({ purchases: [] });
  return j({}); });
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.addInitScript(() => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "S".repeat(43), email: "c@example.com" })));
await page.goto(origin + "/index.html");
const wallet = page.locator("#walletPage");
await wallet.getByText("Flared Pant").waitFor();
await wallet.getByText("Cropped Tee").waitFor();
assert.equal(await wallet.getByText("1 of 2 in this order").count(), 2, "each item of the order has its own card");
assert.equal(await wallet.getByText("Rain Jacket").count(), 0, "an order with a return in progress waits until Relay knows which items");
await wallet.locator(".rl-po", { hasText: "Cropped Tee" }).getByRole("button", { name: "I'm sending this back" }).click();
await page.waitForFunction(() => !document.querySelector("#walletPage").innerText.includes("Cropped Tee"));
assert.deepEqual(posts[0], [order.id, { items: [{ index: 1, status: "returning" }] }]);
await wallet.getByText("Flared Pant").waitFor();
await page.screenshot({ path: "/tmp/shots/items-wallet.png", fullPage: true });
// Returns page: the marked item, and a question for the order Relay can't place.
await page.evaluate(() => window.go("returns"));
const ret = page.locator("#returnsPage");
await ret.getByText("Cropped Tee").waitFor();
assert.equal(await ret.getByText("Flared Pant").count(), 0, "only the item being returned");
await ret.getByText("Which items did you send back?").waitFor();
const q = ret.locator(".rl-po", { hasText: "Which items did you send back?" });
assert.equal(await q.getByRole("button", { name: "Save" }).isDisabled(), true);
await q.getByText("Rain Jacket").click();
await q.getByRole("button", { name: "Save" }).click();
await ret.locator(".rl-po", { hasText: "Rain Jacket" }).getByText("Sent back · on its way to the shop").waitFor();
assert.deepEqual(posts[1], [other.id, { items: [{ index: 0, status: "returning" }] }]);
await page.screenshot({ path: "/tmp/shots/items-returns.png", fullPage: true });
// Changed your mind: the item goes back to the wallet.
await ret.locator(".rl-po", { hasText: "Cropped Tee" }).getByRole("button", { name: "Not sending this back" }).click();
await page.waitForFunction(() => !document.querySelector("#returnsPage").innerText.includes("Cropped Tee"));
await page.evaluate(() => window.go("wallet"));
await wallet.getByText("Cropped Tee").waitFor();
await wallet.getByText("Cap").waitFor();
assert.deepEqual(errors, []);
console.log("PASS item returns UI: one card per item, mark and undo, and Relay asks which items when it can't tell");
await browser.close(); server.close();
