// Browser test: the app as a real shopper sees it at launch. Stubbed Relay server, made-up account and shops.
// Checks: four tabs with Home first (wallet inside it), Discover with Price alerts, only real shop products,
// no demo/sandbox/test wording anywhere a shopper looks, and testing tools only when switched on with ?testtools=1.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@outlook.com";
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const receipts = [
  { id: "11111111-1111-4111-8111-111111111111", status: "confirmed", kind: "receipt", retailer: { name: "RAINS", domain: "rains.com" }, orderRef: "RA-1", orderDate: day(-5), totalPence: 9500, currency: "GBP",
    items: [{ name: "Long Jacket", qty: 1, pricePence: 9500 }], category: "fashion", categoryLabel: "Fashion", returnable: true, returns: { deadline: day(20) } },
  { id: "22222222-2222-4222-8222-222222222222", status: "confirmed", kind: "receipt", retailer: { name: "Nespresso", domain: "nespresso.com" }, orderRef: "NE-1", orderDate: day(-9), totalPence: 4200, currency: "GBP",
    items: [{ name: "Vertuo Pods", qty: 10, pricePence: 420 }], category: "food", categoryLabel: "Food & drink", returnable: false }
];
const shopProducts = [
  { product: "Court Classic Trainers", variation: "White / UK 8", catalogueId: "shopify-v-1", priceMinor: 8500, currency: "GBP", quantity: 4, storeName: "Kick Lane", shopDomain: "kick-lane.myshopify.com" },
  { product: "Canvas Tote", variation: "Natural", catalogueId: "shopify-v-2", priceMinor: 2400, currency: "GBP", quantity: 30, storeName: "Kick Lane", shopDomain: "kick-lane.myshopify.com" },
  // Another size of the same trainers: one card per product, with its sizes on the product page.
  { product: "Court Classic Trainers", variation: "White / UK 9", catalogueId: "shopify-v-3", priceMinor: 8500, currency: "GBP", quantity: 0, storeName: "Kick Lane", shopDomain: "kick-lane.myshopify.com" }
];
const sandboxProducts = [{ product: "Sandbox Hoodie", variation: "M", sku: "DEMO-SBX-1", priceMinor: 4000, currency: "GBP", storeName: "Relay Ltd test shop", provider: "square_sandbox", quantity: 3 }];
let cardSaved = false;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method();
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!u.pathname.startsWith("/relay/")) return route.abort();
  const p = u.pathname;
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "microsoft", email: EMAIL, googleEmail: EMAIL, connectedAt: Date.now() - 864e5, lastScanAt: Date.now() - 36e5, autoAt: Date.now() - 6e5 });
  if (p === "/relay/my/receipts") return j({ receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/style") return j({ receipts: [] });
  if (p === "/relay/my/card") return j({ enabled: true, testMode: true, publishableKey: "pk_test_x", card: cardSaved ? { brand: "visa", last4: "4242" } : null });
  if (p === "/relay/my/instore/shops") return j({ shops: [{ id: "L1", name: "Relay Ltd test shop" }], live: false });
  if (p === "/relay/auth/verify") return j({ sessionToken: "S".repeat(43), email: EMAIL, expiresAt: Date.now() + 864e5 });
  if (p === "/relay/auth/logout") return j({ ok: true });
  if (p === "/relay/live-test/products") return j({ products: sandboxProducts });
  if (p === "/relay/shopify/catalogue") { catalogueAsks.push(u.search); return j({ published: true, products: shopProducts.map(x => ({ ...x, sku: x.catalogueId, provider: "shopify" })) }); }
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
// When the machine is very busy (tests run side by side), Chromium sometimes reports a reload as cut short (ERR_ABORTED)
// even though the page goes on to load: then that load is waited for, and the checks after it decide. Any other error fails.
const reload = () => page.reload().catch(async (e) => { if (!/ERR_ABORTED|frame was detached/.test(String(e))) throw e; await page.waitForLoadState("load"); });
const catalogueAsks = [];
const SHOPPER_NEVER_SEES = /\bdemo\b|sandbox|simulat|fictional|prototype|test mode|test shop|preview only|not yet coordinated|isn.t built|aren.t built|square catalogue/i;
const viewText = () => page.locator("#view").innerText();
const tabs = () => page.locator(page.viewportSize().width < 760 ? "#foot button" : "#side button").allInnerTexts();
const lit = () => page.locator("#foot button.active").innerText();

// 1. A new visitor: the welcome story first, then a clean sign-in page; four tabs behind; nothing that reads like a test build.
await page.goto(origin + "/index.html");
const story = page.locator(".rl-welcome");
await story.getByRole("heading", { name: "Every receipt, in one place." }).waitFor();
assert.deepEqual((await tabs()).map(t => t.trim()), ["Home", "Receipts", "Discover", "Profile"]);
for (let k = 0; k < 4; k++) { assert.doesNotMatch(await story.innerText(), SHOPPER_NEVER_SEES, "slide " + (k + 1)); await page.keyboard.press("ArrowRight"); }
await story.getByRole("button", { name: "Get started" }).click();
await page.locator(".rl-sheet").getByRole("heading", { name: "Create your account" }).waitFor();
assert.doesNotMatch(await page.locator(".rl-sheet").innerText(), SHOPPER_NEVER_SEES);
await page.locator(".rl-sheet").getByRole("button", { name: "Back" }).click();
await story.getByRole("button", { name: "Get started" }).waitFor();
console.log("ok - a new visitor sees the welcome story, then a clean sign-in page");

// 2. Signed in: Home has the person, their wallet and price alerts.
await page.evaluate(e => {
  localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 }));
  // Watches someone made on the old Discover, on made-up and test-shop products.
  localStorage.setItem("relay-radar-v2", JSON.stringify({ "DEMO-NORTH-003": { name: "Retro High Trainers", variant: "White / UK 8", baseline: 12999, created: "2026-10-01T00:00:00Z" },
    "DEMO-SBX-1": { name: "Sandbox Hoodie", variant: "M", baseline: 4000, created: "2026-10-01T00:00:00Z" } }));
}, EMAIL);
await reload();
await page.locator("#homeHello", { hasText: "Jess" }).waitFor();
await page.getByRole("heading", { name: "Wallet" }).waitFor();
await page.locator("#walletPage").getByText("Long Jacket").waitFor();
await page.getByRole("button", { name: /Price alerts/ }).waitFor();
assert.equal(await lit(), "Home");
let t = await viewText();
assert.doesNotMatch(t, SHOPPER_NEVER_SEES);
assert.doesNotMatch(t, /Testing|Your data|linked to this email|SIGNED IN/);
await page.waitForTimeout(400);
assert.equal(await page.getByText("Bought in a shop?").count(), 0, "in-shop receipts are only offered once real (not test) shops are connected");
await page.screenshot({ path: "/tmp/shots/launch-profile.png", fullPage: true });
await page.evaluate(() => window.go("wallet"));
assert.equal(await page.evaluate(() => window.page), "profile", "the wallet opens on Home");
console.log("ok - Home shows the person, their wallet (what can still go back) and price alerts");

// 3. Discover: only products from shops on Relay, a product page with Watch price, and Price alerts inside Discover.
await page.locator("#foot").getByRole("button", { name: "Discover" }).click();
await page.locator('[data-card-select="shopify-v-1"]').waitFor();
t = await viewText();
assert.doesNotMatch(t, SHOPPER_NEVER_SEES);
assert.ok(!t.includes("Sandbox Hoodie") && !t.includes("Retro High Trainers"), "no sandbox or made-up products");
assert.equal(await page.locator("[data-card-select]").count(), 2, "one card per product, not one per size");
assert.equal(await page.locator('#view img[src*="unsplash"]').count(), 0, "no stock photos: the shop's own picture or a drawing");
assert.equal(await page.locator('[data-card-select="shopify-v-1"] .rl-ill').count(), 1, "a product with no photo gets a drawing of what it is");
// Signed in with picks switched off: an invitation to turn them on, saying what they use.
await page.locator(".dc-invite", { hasText: "Picks for you" }).waitFor();
assert.match(await page.locator('[data-card-select="shopify-v-1"]').innerText(), /KICK LANE|Kick Lane/i);
assert.match(await page.locator('[data-card-select="shopify-v-1"]').innerText(), /Only 4 left/);
await page.locator('[data-card-select="shopify-v-1"]').click();
await page.getByRole("heading", { name: "Court Classic Trainers" }).waitFor();
assert.doesNotMatch(await viewText(), SHOPPER_NEVER_SEES);
// Every size is on the product page; one that's run out says so.
await page.getByRole("button", { name: "White / UK 8", exact: true }).waitFor();
await page.getByRole("button", { name: "White / UK 9 Sold out" }).waitFor();
await page.getByRole("button", { name: "Watch price", exact: true }).click();
await page.getByRole("button", { name: "Watching the price" }).waitFor();
await page.screenshot({ path: "/tmp/shots/launch-product.png" });
await page.getByRole("button", { name: "Back", exact: true }).click();
await page.locator('[data-watch="shopify-v-1"][aria-pressed="true"]').waitFor();
assert.equal(await page.locator('[data-card-select] [data-watch]').count(), 0, "the watch button sits beside the card, never a button inside a button");
// Searching for something that isn't there says so plainly.
await page.locator("#query").fill("zzz");
await page.getByText("Nothing matches that").waitFor();
await page.locator("#query").fill("");
console.log("ok - Discover shows shop products only; Watch price works from the product page and the list");

await page.getByRole("button", { name: /Price alerts/ }).click();
await page.getByRole("heading", { name: "Price alerts", exact: true }).waitFor();
assert.equal(await lit(), "Discover", "Price alerts sits inside Discover");
await page.locator("#radarList").getByText("Court Classic Trainers").waitFor();
await page.locator("#radarList").getByText("Was £85.00 when you started watching").waitFor();
assert.equal(await page.locator("#radarList .card").count(), 1, "old watches on made-up or test-shop products aren't listed");
assert.doesNotMatch(await page.locator("#radarList").innerText(), /Retro High Trainers|Sandbox Hoodie/);
assert.doesNotMatch(await viewText(), SHOPPER_NEVER_SEES);
await page.getByRole("button", { name: "Stop watching" }).click();
await page.getByText("Nothing watched yet").waitFor();
await page.getByRole("button", { name: "Discover", exact: true }).first().click();
await page.getByRole("heading", { name: "Discover" }).waitFor();
console.log("ok - Price alerts lists what's watched, lives under Discover, and stops watching on request");
// Swap & resell has no tab, but Discover leads to it.
await page.locator(".dc-sc", { hasText: "Swap & resell" }).waitFor();

// 4. Receipts and Wrapped read cleanly too.
for (const tab of ["Receipts", "Profile"]) {
  await page.locator("#foot").getByRole("button", { name: tab }).click();
  await page.waitForTimeout(900);
  assert.doesNotMatch(await viewText(), SHOPPER_NEVER_SEES, tab);
}
// 5. The Profile page (the avatar opens it): Swap & resell as a row (no Market tab), no test card, no empty-purchases caveat.
await page.locator(".avatar").click();
await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();
await page.locator("#mePage .rl-arow").first().waitFor(); await page.waitForTimeout(600);
assert.equal(await page.locator("#foot button.active").innerText(), "Profile");
assert.equal(await page.getByRole("button", { name: "Done" }).count(), 0, "a page, not a sheet: nothing to close");
const sheet = await page.locator("#mePage").innerText();
assert.match(sheet, /Swap & resell\s+Sell or swap what you can't return/, "Swap & resell is reachable from Profile");
assert.doesNotMatch(sheet, /TEST MODE|Card for swaps|No purchases matched/);
assert.doesNotMatch(sheet, SHOPPER_NEVER_SEES);
// Someone who saved a card during a test-mode swap can always find it again to remove it (labelled as test mode).
cardSaved = true;
// The card was saved away from this screen, so the app learns about it the next time it opens (reads are reused for a minute).
await reload();
await page.locator(".avatar").click();
await page.locator(".rl-arow", { hasText: "Card for swaps" }).click();
await page.getByRole("button", { name: "Remove card" }).waitFor();
await page.getByText("TEST MODE · no real money").waitFor();
await page.getByRole("button", { name: "Back to Profile" }).click();
cardSaved = false;
console.log("ok - Receipts, Wrapped and the Account page carry no test wording; Swap & resell is a Profile row, not a tab; the test card is hidden (a saved card can still be removed)");

// A shopper's Discover asks only for real shops' products (test shops are left out by the server).
assert.ok(catalogueAsks.length && catalogueAsks.every(q => !/test=1/.test(q)), "no test shops for shoppers: " + catalogueAsks.join(","));
// 6. Testing tools, switched on with a link: Market tab, sandbox items (labelled), test card and a way to switch off.
const asksBefore = catalogueAsks.length;
await page.goto(origin + "/index.html?testtools=1");
await page.locator("#homeHello", { hasText: "Jess" }).waitFor();
assert.deepEqual((await tabs()).map(x => x.trim()), ["Home", "Receipts", "Discover", "Profile", "Market"]);
await page.getByRole("heading", { name: "Testing tools" }).waitFor();
await page.getByText("Bought in a shop? Add it from the receipt").waitFor();
await page.locator("#foot").getByRole("button", { name: "Discover" }).click();
await page.locator("[data-card-select]", { hasText: "Sandbox Hoodie" }).getByText(/· TEST/).waitFor();
assert.ok(catalogueAsks.slice(asksBefore).some(q => /test=1/.test(q)), "with testing tools on, Discover asks for test shops too");
await page.locator(".avatar").click();
await page.locator(".rl-arow", { hasText: "Swap & resell" }).waitFor();
await page.locator(".rl-arow", { hasText: "Card for swaps" }).click();
await page.getByText("TEST MODE · no real money").waitFor();
await page.goto(origin + "/index.html?testtools=0");
await page.locator("#homeHello", { hasText: "Jess" }).waitFor();
assert.deepEqual((await tabs()).map(x => x.trim()), ["Home", "Receipts", "Discover", "Profile"]);
assert.equal(await page.getByRole("heading", { name: "Testing tools" }).count(), 0);
console.log("ok - testing tools appear only after ?testtools=1, and ?testtools=0 hides them again");

// 7. Desktop: the same four tabs down the side, Home first.
await page.setViewportSize({ width: 1280, height: 900 });
await reload();
await page.locator("#homeHello", { hasText: "Jess" }).waitFor();
assert.deepEqual((await page.locator("#side button").allInnerTexts()).map(x => x.trim()), ["Home", "Receipts", "Discover", "Profile"]);
await page.screenshot({ path: "/tmp/shots/launch-desktop.png" });
// 8. If the account part of the app can't load, the Home page says so instead of waiting forever.
//    (A fresh browser with no service worker, so account.js can't come from the app's offline copy.)
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx2.route("https://**/*", r => r.abort());
await ctx2.route("**/account.js*", r => r.abort());
const broken = await ctx2.newPage();
await broken.addInitScript(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e })), EMAIL);
await broken.goto(origin + "/index.html");
await broken.getByRole("heading", { name: "Couldn't load your account" }).waitFor({ timeout: 20000 });
await ctx2.close();
console.log("ok - a failed load ends in a clear message with a Reload button, not an endless spinner");

// 9. Signing out and in redraws the home screen straight away (no reload needed).
const p2 = await ctx.newPage();
await p2.goto(origin + "/index.html");
await p2.locator("#homeHello", { hasText: "Jess" }).waitFor();
await p2.locator(".avatar").click();
await p2.getByRole("button", { name: "Sign out" }).click();
await p2.locator(".rl-welcome").getByRole("heading", { name: "Every receipt, in one place." }).waitFor();
await p2.goto(origin + "/index.html#signin=" + "L".repeat(43));
await p2.locator("#homeHello", { hasText: "Jess" }).waitFor();
await p2.waitForTimeout(800);
assert.equal(await p2.locator(".rl-sheet").count(), 0, "already set up (name, email connected): straight to Home, no sign-up steps");
assert.equal(await p2.locator(".rl-welcome").count(), 0, "signed in: the story has gone");
console.log("ok - signing out shows the welcome story, signing in by email link shows Home, without reloading");

// 10. The ?testing=1 tools keep their Wallet tab.
await p2.goto(origin + "/index.html?testing=1");
await p2.locator("#foot").getByRole("button", { name: "Wallet" }).click();
await p2.getByRole("heading", { name: "Wallet", exact: true }).first().waitFor();
await p2.locator("#walletPage").getByText("Long Jacket").waitFor();
assert.equal(await p2.locator("#foot button.active").innerText(), "Wallet");
assert.deepEqual((await p2.locator("#foot button").allInnerTexts()).map(x => x.trim()), ["Home", "Wallet", "Receipts", "Discover", "Profile", "Market"]);
await p2.close();
console.log("ok - ?testing=1 keeps a Wallet tab with the shopper's wallet");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS launch-ready app: tabs, Home with wallet, Discover with price alerts, no test wording, testing tools on request");
await browser.close(); server.close();
