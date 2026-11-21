// Browser test: what a Home card says, and "View receipt" after Profile was opened. Stubbed Relay server, made-up person,
// invented shops and restaurants. Nothing here proves a real phone.
// Checks: a takeaway of several dishes ordered through an app shows the restaurant, how many things and what the whole
// order came to (never the first dish and its own price: Connor, 19 Nov 2026), with the app first ("Just Eat, 5 items");
// one with no dishes listed shows the app under the restaurant, never "Order from" it again; a single thing keeps its name and price;
// after Profile has been opened and left, a receipt opened from Home still opens its email with "View receipt".
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeReady, tapPicture } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : extname(p) === ".svg" ? "image/svg+xml" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "pat.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const dish = (name, pence) => ({ name, qty: 1, pricePence: pence, lineTotal: true, category: "food" });
const receipts = [
  { id: "aaaaaaaa-1111-4111-8111-111111111111", status: "pending", kind: "receipt", retailer: { name: "Just Eat", domain: "just-eat.co.uk" }, merchant: "Golden Lantern",
    orderDate: day(-1), totalPence: 2645, currency: "GBP", category: "food", returnable: false, gmailId: "msgaaaa1111",
    items: [dish("Crispy Chilli Beef", 790), dish("Egg Fried Rice", 350), dish("Vegetable Spring Rolls", 420), dish("Prawn Toast", 480), dish("Curry Sauce", 220)],
    itemsCheck: { complete: true, itemsPence: 2260, expectedPence: 2260, missingPence: 0, namesOk: true } },
  { id: "bbbbbbbb-2222-4222-8222-222222222222", status: "pending", kind: "receipt", retailer: { name: "Fern & Finch", domain: "fernfinch.example" },
    orderDate: day(-3), totalPence: 4200, currency: "GBP", category: "fashion", returnable: true, gmailId: "msgbbbb2222",
    items: [{ name: "Ribbed Knit Scarf", qty: 1, pricePence: 4200, category: "fashion" }], itemsCheck: { complete: true, itemsPence: 4200, expectedPence: 4200, missingPence: 0, namesOk: true } },
  // A takeaway whose email lists no dishes: the restaurant, then the app (never "Order from" the restaurant again).
  { id: "cccccccc-3333-4333-8333-333333333333", status: "pending", kind: "receipt", retailer: { name: "Uber Eats", domain: "uber.com" }, merchant: "Saffron Corner (Bow)",
    orderDate: day(-2), totalPence: 2136, currency: "GBP", category: "food", returnable: false, gmailId: "msgcccc3333", items: [] }
];
let originals = 0;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p === "/relay/my/receipts") return j({ receipts });
  if (/\/relay\/my\/receipts\/[^/]+\/original$/.test(p)) { originals++; return j({ html: "<p>Thanks for your order from Golden Lantern.</p><p>Crispy Chilli Beef £7.90</p>", links: [], extraImages: [] }); }
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/second-step") return j({ required: false, done: true, checked: true });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Pat", photo: null });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5 });
  if (p === "/relay/my/admin/me") return j({ admin: false });
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload();
await homeReady(page);

// 1. The takeaway: the restaurant, how many dishes, the whole order's total.
const take = page.locator("#homePage .hl-sq", { hasText: "Golden Lantern" });
await take.waitFor();
assert.equal(await take.locator(".hl-sqn").innerText(), "Just Eat, 5 items");
assert.equal(await take.locator(".hl-sqp").innerText(), "£26.45");
assert.ok(!/Crispy Chilli Beef|£7\.90/.test(await take.innerText()), "not the first dish and its own price");
// One thing: its own name and price.
const one = page.locator("#homePage .hl-sq", { hasText: "Fern & Finch" });
assert.equal(await one.locator(".hl-sqn").innerText(), "Ribbed Knit Scarf");
assert.equal(await one.locator(".hl-sqp").innerText(), "£42.00");
// A takeaway with no dishes listed: the restaurant, then the app it came through, never the restaurant again.
const bare = page.locator("#homePage .hl-sq", { hasText: "Saffron Corner (Bow)" });
assert.equal(await bare.locator(".hl-sqs").innerText(), "Saffron Corner (Bow)");
assert.equal(await bare.locator(".hl-sqn").innerText(), "Uber Eats");
assert.ok(!/Order from/i.test(await bare.innerText()), "no 'Order from' line under the restaurant");
// And no card's second line is only its title again.
for (const sq of await page.locator("#homePage .hl-sq").all()) {
  const key = (t) => t.toLowerCase().replace(/^(?:your\s+)?order\s+from\s+/, "").replace(/[^a-z0-9]+/g, "");
  const t = await sq.locator(".hl-sqs").innerText(), n = await sq.locator(".hl-sqn").count() ? await sq.locator(".hl-sqn").innerText() : "";
  assert.ok(!n || !key(t).startsWith(key(n)), "second line repeats the title: " + t + " / " + n);
}
await page.screenshot({ path: "/tmp/shots/home-cards.png" });
console.log("ok - a takeaway card shows the restaurant, how many dishes and the total; one thing keeps its name and price");

// 2. Profile opened and left, then a receipt from Home: View receipt still opens its email.
await tapPicture(page);
await page.locator("[data-back]:visible, .rl-navback:visible").first().click();   // Profile's Back, to Home
await take.waitFor();
await take.click();
const sheet = page.locator(".rl-back .rl-sheet").last();
await sheet.waitFor();
await sheet.getByRole("button", { name: "View receipt" }).click();
const frame = page.locator('iframe[title="Original receipt email"]').last();
await frame.waitFor({ timeout: 8000 });   // shown, not drawn into the closed Profile
await page.frameLocator('iframe[title="Original receipt email"]').last().getByText("Thanks for your order from Golden Lantern.").waitFor();
assert.equal(originals, 1);
console.log("ok - after Profile was opened, View receipt on a card from Home opens the email");

// (The email sits in a sandboxed frame; the test browser blocks service workers, which only that frame complains about.)
assert.deepEqual(errors.filter(e => !/serviceWorker/.test(e)), []);
await browser.close(); server.close();
console.log("\nhome cards: all checks passed");
