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
  { product: "Canvas Tote", variation: "Natural", catalogueId: "shopify-v-2", priceMinor: 2400, currency: "GBP", quantity: 30, storeName: "Kick Lane", shopDomain: "kick-lane.myshopify.com" }
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
  if (p === "/relay/shopify/catalogue") return j({ published: true, products: shopProducts.map(x => ({ ...x, sku: x.catalogueId, provider: "shopify" })) });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
const SHOPPER_NEVER_SEES = /\bdemo\b|sandbox|simulat|fictional|prototype|test mode|test shop|preview only|not yet coordinated|isn.t built|aren.t built|square catalogue/i;
const viewText = () => page.locator("#view").innerText();
const tabs = () => page.locator(page.viewportSize().width < 760 ? "#foot button" : "#side button").allInnerTexts();
const lit = () => page.locator("#foot button.active").innerText();

// 1. A new visitor: Home first, welcoming them; four tabs; nothing that reads like a test build.
await page.goto(origin + "/index.html");
await page.getByRole("heading", { name: "Welcome to Relay" }).waitFor();
assert.deepEqual((await tabs()).map(t => t.trim()), ["Home", "Receipts", "Discover", "Wrapped"]);
assert.doesNotMatch(await viewText(), SHOPPER_NEVER_SEES);
await page.getByRole("button", { name: "Sign in or create an account" }).click();
await page.locator(".rl-sheet").waitFor();
await page.keyboard.press("Escape").catch(() => {});
console.log("ok - a new visitor lands on Home with a welcome and four tabs");

// 2. Signed in: Home has the person, their wallet and price alerts.
await page.evaluate(e => {
  localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 }));
  // Watches someone made on the old Discover, on made-up and test-shop products.
  localStorage.setItem("relay-radar-v2", JSON.stringify({ "DEMO-NORTH-003": { name: "Retro High Trainers", variant: "White / UK 8", baseline: 12999, created: "2026-10-01T00:00:00Z" },
    "DEMO-SBX-1": { name: "Sandbox Hoodie", variant: "M", baseline: 4000, created: "2026-10-01T00:00:00Z" } }));
}, EMAIL);
await page.reload();
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
assert.equal(await page.locator("[data-card-select]").count(), 2);
assert.match(await page.locator('[data-card-select="shopify-v-1"]').innerText(), /KICK LANE|Kick Lane/i);
assert.match(await page.locator('[data-card-select="shopify-v-1"]').innerText(), /Only 4 left/);
await page.locator('[data-card-select="shopify-v-1"]').click();
await page.getByRole("heading", { name: "Court Classic Trainers" }).waitFor();
assert.doesNotMatch(await viewText(), SHOPPER_NEVER_SEES);
await page.getByRole("button", { name: "Watch price", exact: true }).click();
await page.getByRole("button", { name: "Watching · tap to stop" }).waitFor();
await page.screenshot({ path: "/tmp/shots/launch-product.png" });
await page.getByRole("button", { name: "Back", exact: true }).click();
await page.locator('[data-watch="shopify-v-1"]', { hasText: "Watching" }).waitFor();
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

// 4. Receipts and Wrapped read cleanly too.
for (const tab of ["Receipts", "Wrapped"]) {
  await page.locator("#foot").getByRole("button", { name: tab }).click();
  await page.waitForTimeout(900);
  assert.doesNotMatch(await viewText(), SHOPPER_NEVER_SEES, tab);
}
// 5. The Account page: no Market, no test card, no empty-purchases caveat.
await page.locator(".avatar").click();
await page.getByRole("heading", { name: "Account", exact: true }).waitFor();
await page.waitForTimeout(600);
const sheet = await page.locator(".rl-sheet").innerText();
assert.doesNotMatch(sheet, /Swap & resell|TEST MODE|Card for swaps|No purchases matched/);
assert.doesNotMatch(sheet, SHOPPER_NEVER_SEES);
await page.getByRole("button", { name: "Done" }).click();
// Someone who saved a card during a test-mode swap can always find it again to remove it (labelled as test mode).
cardSaved = true;
await page.locator(".avatar").click();
await page.locator(".rl-arow", { hasText: "Card for swaps" }).click();
await page.getByRole("button", { name: "Remove card" }).waitFor();
await page.getByText("TEST MODE · no real money").waitFor();
await page.getByRole("button", { name: "Done" }).click();
cardSaved = false;
console.log("ok - Receipts, Wrapped and the Account page carry no test wording; Market and the test card are hidden (a saved card can still be removed)");

// 6. Testing tools, switched on with a link: Market tab, sandbox items (labelled), test card and a way to switch off.
await page.goto(origin + "/index.html?testtools=1");
await page.locator("#homeHello", { hasText: "Jess" }).waitFor();
assert.deepEqual((await tabs()).map(x => x.trim()), ["Home", "Receipts", "Discover", "Wrapped", "Market"]);
await page.getByRole("heading", { name: "Testing tools" }).waitFor();
await page.getByText("Bought in a shop? Add it from the receipt").waitFor();
await page.locator("#foot").getByRole("button", { name: "Discover" }).click();
await page.locator("[data-card-select]", { hasText: "Sandbox Hoodie" }).getByText(/· TEST/).waitFor();
await page.locator(".avatar").click();
await page.getByRole("button", { name: "Swap & resell", exact: true }).waitFor();
await page.locator(".rl-arow", { hasText: "Card for swaps" }).click();
await page.getByText("TEST MODE · no real money").waitFor();
await page.getByRole("button", { name: "Done" }).click();
await page.goto(origin + "/index.html?testtools=0");
await page.locator("#homeHello", { hasText: "Jess" }).waitFor();
assert.deepEqual((await tabs()).map(x => x.trim()), ["Home", "Receipts", "Discover", "Wrapped"]);
assert.equal(await page.getByRole("heading", { name: "Testing tools" }).count(), 0);
console.log("ok - testing tools appear only after ?testtools=1, and ?testtools=0 hides them again");

// 7. Desktop: the same four tabs down the side, Home first.
await page.setViewportSize({ width: 1280, height: 900 });
await page.reload();
await page.locator("#homeHello", { hasText: "Jess" }).waitFor();
assert.deepEqual((await page.locator("#side button").allInnerTexts()).map(x => x.trim()), ["Home", "Receipts", "Discover", "Wrapped"]);
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
await p2.getByRole("heading", { name: "Welcome to Relay" }).waitFor();
await p2.goto(origin + "/index.html#signin=" + "L".repeat(43));
await p2.locator("#homeHello", { hasText: "Jess" }).waitFor();
await p2.waitForTimeout(800);
assert.equal(await p2.locator(".rl-sheet").count(), 0, "already set up (name, email connected): straight to Home, no sign-up steps");
console.log("ok - signing out shows the welcome screen, signing in by email link shows Home, without reloading");

// 10. The ?testing=1 tools keep their Wallet tab.
await p2.goto(origin + "/index.html?testing=1");
await p2.locator("#foot").getByRole("button", { name: "Wallet" }).click();
await p2.getByRole("heading", { name: "Wallet", exact: true }).first().waitFor();
await p2.locator("#walletPage").getByText("Long Jacket").waitFor();
assert.equal(await p2.locator("#foot button.active").innerText(), "Wallet");
assert.deepEqual((await p2.locator("#foot button").allInnerTexts()).map(x => x.trim()), ["Home", "Wallet", "Receipts", "Discover", "Wrapped", "Market"]);
await p2.close();
console.log("ok - ?testing=1 keeps a Wallet tab with the shopper's wallet");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS launch-ready app: tabs, Home with wallet, Discover with price alerts, no test wording, testing tools on request");
await browser.close(); server.close();
