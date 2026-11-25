// Browser test: when something can't be loaded, Relay says so and offers Try again. Stubbed Relay server, made-up account.
// It never says "nothing here" because a load failed (that would be false), and never leaves greyed outlines for ever.
// Checks:
//  1. Receipts, on a phone with no kept copy: Relay answering with an error, the request being dropped, and the request
//     never being answered (given up on after 30 seconds) each end in "Relay couldn't load your receipts" with Try again,
//     never "No receipts found yet."; Try again brings the receipts.
//  2. Swap & resell (Browse, Yours, Sell, Messages), Bank and cards, and the swap sheet's choices: the same; and a swap
//     whose answer never arrives says Relay doesn't know whether it went through (the buttons come back).
//  3. The shops' products: when they can't be loaded, Shops on Relay says so (never "New products are on their way"),
//     Price alerts still shows what's watched from what the phone kept (never "Nothing watched yet"), and Home's Watching
//     never says a watched thing has gone from its shop's website. A pull to refresh that fails keeps the products that
//     were there. The last good copy is kept on the phone and shows at once, and with no signal, the next time.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, bigCards, openShops, openAccountRow, homeShows, waitOutDoubleTap, goTab } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const receipts = [0, 1, 2].map(i => ({ id: "1111111" + i + "-1111-4111-8111-11111111111" + i, status: "confirmed", kind: "receipt", retailer: { name: ["Harlow Lane", "Fernway", "Brindle"][i], domain: ["harlow", "fernway", "brindle"][i] + ".example" },
  orderRef: "R-" + i, orderDate: day(-3 - i), totalPence: 2500 + i * 100, currency: "GBP", items: [{ name: "Thing " + i, qty: 1, pricePence: 2500 + i * 100 }], category: "fashion", categoryLabel: "Fashion", returnable: false }));
const purchases = [{ id: "o1", store: "Kick Lane", retailer: "shopify:kick-lane.myshopify.com", orderedAt: new Date(Date.now() - 2 * 864e5).toISOString(), amountMinor: 2000, currency: "GBP",
  items: [{ title: "Logo Cap", lineId: "L1", quantity: 1, priceMinor: 2000, currency: "GBP", variant: "Black", exchangeable: true, returnable: false }] }];
const product = (i, name, price) => ({ product: name, variation: "One size", catalogueId: "shopify:kick:variant:" + i, sku: "shopify-v-" + i, priceMinor: price, currency: "GBP", storeName: "Kick Lane", shopDomain: "kicklane.example", inStock: true, quantity: 5, imageUrl: "https://cdn.kicklane.example/p" + i + ".jpg" });
const products = [product(1, "Court Classic Trainers", 8500), product(2, "Canvas Tote", 2400), product(3, "Wool Beanie", 1800), product(4, "Rain Jacket", 9900)];
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
// What the stand-in server does for each path: "ok", 503 ("error"), drop the connection ("drop"), or never answer ("hang").
let how = {}, asked = {};
const browser = await chromium.launch();
async function open({ cards = false, kept = null, session = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx); if (cards) await bigCards(ctx);
  await ctx.route("https://**/*", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith("/relay/")) return route.abort();
    asked[p] = (asked[p] || 0) + 1;
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
    const mode = how[m + " " + p] || how[p] || "ok";
    if (mode === "error") return j({ error: "busy" }, 503);
    if (mode === "drop") return route.abort("connectionfailed");
    if (mode === "hang") return;   // never answered
    if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, scan: { state: "done", found: 3, finishedAt: Date.now() - 36e5 } });
    if (p === "/relay/my/receipts") return j({ receipts });
    if (p === "/relay/my/purchases") return j({ purchases });
    if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [], allShops: false });
    if (p === "/relay/my/bank") return j({ available: true, testBanks: false, choices: ["monzo"], connections: [] });
    if (p === "/relay/my/resale/feed") return j({ listings: [] });
    if (p === "/relay/my/resale/mine") return j({ listings: [], requests: [] });
    if (p === "/relay/my/resale/items") return j({ items: [], defaults: {} });
    if (p === "/relay/my/resale/conversations") return j({ conversations: [] });
    if (p === "/relay/my/exchange/options") return j({ product: "Logo Cap", priceMinor: 2000, payments: false, card: null, options: [{ key: "k12", title: "Navy", priceMinor: 2000, quantity: 9, priceDiffMinor: 0, available: true, reason: null, needsCard: false }] });
    if (p === "/relay/my/exchange") return j({ exchanged: true, message: "Done. Your order now has Navy instead." });
    if (p === "/relay/shopify/catalogue") return j({ published: true, products });
    return j({});
  });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
  if (session) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ["relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: EMAIL, expiresAt: Date.now() + 864e5 })]);
  if (kept) await page.addInitScript(w => { if (!localStorage.getItem("relay-radar-v2")) localStorage.setItem("relay-radar-v2", JSON.stringify(w)); }, kept);
  return { ctx, page, errors };
}
const reset = (h = {}) => { how = h; asked = {}; };
// The "couldn't load" words inside a part of the page, and its Try again button.
const cant = (scope, what) => scope.locator(".rl-cantload", { hasText: "Relay couldn't load " + what + ". Check your connection and try again." });
const again = scope => scope.locator(".rl-cantload").getByRole("button", { name: "Try again" });

// 1. Receipts, with nothing kept on this phone.
for (const mode of ["error", "drop", "hang"]) {
  reset({ "/relay/my/receipts": mode });
  const { ctx, page, errors } = await open();
  if (mode === "hang") await page.clock.install();
  await page.goto(origin + "/index.html");
  await page.waitForFunction(() => window.RelayAccount && window.go);
  await page.evaluate(() => window.go("receipts"));
  const view = page.locator("#view");
  if (mode === "hang") {
    // Nothing is said while it could still arrive: greyed outlines. After 30 seconds Relay gives up on it.
    await page.waitForTimeout(400);
    assert.equal(await view.locator(".rl-cantload").count(), 0, "still waiting: nothing said yet");
    assert.doesNotMatch(await view.innerText(), /No receipts found yet/);
    for (let i = 0; i < 8 && !(await view.locator(".rl-cantload").count()); i++) { await page.clock.runFor(5000); await page.waitForTimeout(150); }
  }
  await cant(view, "your receipts").waitFor();
  assert.doesNotMatch(await view.innerText(), /No receipts found yet/, mode + ": never told there are no receipts");
  assert.equal(await view.locator(".rl-skel").count(), 0, mode + ": no outlines left behind");
  const btn = again(view); assert.ok((await btn.boundingBox()).height >= 44, "Try again is big enough to tap");
  // Try again, with Relay answering now.
  how = {};
  await btn.click();
  await view.getByText("Harlow Lane").first().waitFor();
  assert.equal(await view.locator(".rl-cantload").count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - Receipts, " + (mode === "error" ? "Relay answering with an error" : mode === "drop" ? "the connection dropped" : "no answer in 30 seconds") + ": says it couldn't load, Try again brings them");
}
// With a copy kept from before, a failed load leaves that copy showing (and says nothing false).
{
  reset();
  const { ctx, page } = await open();
  await page.goto(origin + "/index.html"); await homeShows(page, "J");
  await page.evaluate(() => window.go("receipts")); await page.locator("#view").getByText("Harlow Lane").first().waitFor();
  how = { "/relay/my/receipts": "drop" };
  await page.reload(); await page.waitForFunction(() => window.RelayAccount && window.go);
  await page.evaluate(() => window.go("receipts"));
  await page.locator("#view").getByText("Harlow Lane").first().waitFor();
  await page.waitForTimeout(600);
  assert.equal(await page.locator("#view .rl-cantload").count(), 0, "the kept copy stays; nothing about not loading over it");
  await ctx.close();
  console.log("ok - Receipts with a kept copy: it stays on screen when Relay can't be reached");
}

// 2. Swap & resell, Bank and cards, the swap sheet.
{
  reset({ "/relay/my/resale/feed": "drop", "/relay/my/resale/mine": "error", "/relay/my/resale/items": "drop", "/relay/my/resale/conversations": "drop" });
  const { ctx, page, errors } = await open();
  await page.goto(origin + "/index.html"); await homeShows(page, "J");
  await page.evaluate(() => window.RelayAccount.openMarket());
  await page.getByRole("heading", { name: "Swap & resell" }).waitFor();
  const mk = page.locator(".rl-sheet").last();
  for (const [tab, what] of [["browse", "what's listed"], ["mine", "your listings"], ["sell", "your items"], ["messages", "your messages"]]) {
    await waitOutDoubleTap(page);
    if (tab !== "browse") await page.locator('[data-tab="' + tab + '"]').click();
    await cant(mk, what).waitFor();
    assert.equal(await mk.locator(".rl-mk-skel").count(), 0, tab + ": no outlines left behind");
    assert.doesNotMatch(await mk.innerText(), /Nothing (listed|to list) yet|No messages yet|You haven't listed/i, tab + ": never told there's nothing");
  }
  // Try again on Messages, with Relay answering.
  how = {};
  await again(mk).click();
  await mk.locator(".rl-cantload").waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - Swap & resell: Browse, Yours, Sell and Messages each say they couldn't load, with Try again");
}
{
  reset({ "/relay/my/bank": "ok" });
  const { ctx, page, errors } = await open();
  await page.goto(origin + "/index.html"); await homeShows(page, "J");
  // The row shows once Relay has said banks are offered (Settings is one level down); then its page can't be loaded.
  const me = page.locator("#mePage");
  await page.evaluate(() => window.go("me"));
  await me.locator(".rl-arow:visible", { hasText: "Bank and cards" }).first().waitFor();
  how = { "/relay/my/bank": "drop", "/relay/my/bank/payments": "drop", "/relay/my/bank/sync": "drop" };
  await waitOutDoubleTap(page);
  await me.locator(".rl-arow:visible", { hasText: "Bank and cards" }).first().click();
  await cant(me, "your banks and cards").waitFor();
  assert.equal(await me.locator(".rl-skel").count(), 0, "no outline left behind");
  how = {};
  await again(me).click();
  await me.getByRole("button", { name: /bank or card/ }).first().waitFor();
  assert.equal(await me.locator(".rl-cantload").count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - Bank and cards: says it couldn't load, Try again brings it");
}
{
  reset({ "/relay/my/exchange/options": "drop" });
  const { ctx, page, errors } = await open({ cards: true });
  await page.goto(origin + "/index.html");
  await page.locator("#homePage .h2-feed > .h2-item").first().click();
  await page.locator(".rl-sheet").getByRole("button", { name: "Swap", exact: true }).click();
  const sheet = page.locator(".rl-sheet").last();
  await cant(sheet, "what the shop has in stock").waitFor();
  assert.doesNotMatch(await sheet.innerText(), /Checking what the shop has|no other sizes or colours/, "not left checking, and not told there are no other sizes");
  how = {};
  await again(sheet).click();
  await sheet.getByRole("button", { name: /^Navy/ }).waitFor();
  // The swap itself: the answer never arrives.
  how = { "POST /relay/my/exchange": "drop" };
  await sheet.getByRole("button", { name: /^Navy/ }).click();
  await page.getByRole("button", { name: "Yes, swap it" }).click();
  await page.getByText("Couldn't reach Relay, so it can't say whether the swap went through. Close this and look at your order before trying again.").waitFor();
  assert.equal(await sheet.getByRole("button", { name: /^Navy/ }).isEnabled(), true, "the choices come back");
  assert.doesNotMatch(await sheet.innerText(), /Swapped for/);
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - the swap sheet: choices that don't arrive say so with Try again; a swap with no answer is never called done");
}

// 3. The shops' products.
const WATCHED = { "shopify-v-1": { name: "Court Classic Trainers", variant: "One size", baseline: 9000, created: new Date().toISOString(), store: "Kick Lane", dom: "kicklane.example", image: "https://cdn.kicklane.example/p1.jpg", now: 8500, cur: "GBP", real: true } };
{
  // A phone that has never had the products, and they can't be loaded.
  reset({ "/relay/shopify/catalogue": "drop" });
  const { ctx, page, errors } = await open({ kept: WATCHED });
  await page.goto(origin + "/index.html"); await homeShows(page, "J");
  await openShops(page);
  const failed = page.locator("#dcFailed");
  await failed.waitFor();
  assert.match(await failed.innerText(), /Relay couldn't load the shops\s+Check your connection and try again\./);
  assert.doesNotMatch(await page.locator("#view").innerText(), /New products are on their way|When shops join Relay/, "never told there are no products");
  assert.ok((await failed.getByRole("button", { name: "Try again" }).boundingBox()).height >= 44);
  // Price alerts: what's watched is still there, from what the phone kept.
  await page.evaluate(() => window.go("radar"));
  await page.locator(".wl-card", { hasText: "Court Classic Trainers" }).waitFor();
  assert.doesNotMatch(await page.locator("#view").innerText(), /Nothing watched yet/);
  // Home's Watching: there, and nothing about it having gone from the shop's website.
  await page.evaluate(() => window.go("profile")); await homeShows(page, "J");
  await page.locator("#view .h2-chip", { hasText: "Watching" }).click();
  await page.locator("#homePage .wl-card", { hasText: "Court Classic Trainers" }).waitFor();
  await page.waitForTimeout(500);
  assert.doesNotMatch(await page.locator("#homePage").innerText(), /isn't on its shop's website|aren't on their shops' websites/, "a failed load never says a watched thing has gone");
  // Try again on Shops on Relay, with the shops answering: the products come.
  how = {};
  await openShops(page); await page.locator("#dcFailed").getByRole("button", { name: "Try again" }).click();
  await page.locator('[data-card-select="shopify-v-1"]').waitFor();
  assert.equal(await page.locator("#dcFailed").count(), 0);
  // A pull to refresh that fails keeps the products that were there.
  how = { "/relay/shopify/catalogue": "drop" };
  const before = asked["/relay/shopify/catalogue"];
  await page.evaluate(() => window.RelayShell.refresh());
  await page.waitForFunction(n => true, null); await page.waitForTimeout(800);
  assert.ok(asked["/relay/shopify/catalogue"] > before, "the refresh asked the shops again");
  await page.locator('[data-card-select="shopify-v-1"]').waitFor();
  assert.equal(await page.locator("[data-card-select]").count(), 4, "all four products still there after a refresh that failed");
  assert.deepEqual(errors, []);
  // The next open, still with no signal: the products show from the copy kept on the phone.
  await page.reload(); await page.waitForFunction(() => window.RelayAccount && window.go);
  await openShops(page);
  await page.locator('[data-card-select="shopify-v-1"]').waitFor();
  assert.equal(await page.locator("#dcFailed").count(), 0, "the kept copy shows; nothing about not loading over it");
  await ctx.close();
  console.log("ok - the shops' products: a failed load says so, keeps what's watched and what was there, and the last good copy shows next time");
}
{
  // Watching something this phone has nothing kept for (restored from the account), and the products can't be loaded:
  // Price alerts says it couldn't load, never "Nothing watched yet".
  reset({ "/relay/shopify/catalogue": "drop" });
  const { ctx, page } = await open({ kept: { "shopify-v-2": { name: "Canvas Tote", variant: "One size", baseline: 2400, created: new Date().toISOString() } } });
  await page.goto(origin + "/index.html"); await homeShows(page, "J");
  await page.evaluate(() => window.go("radar"));
  await cant(page.locator("#view"), "what you're watching").waitFor();
  assert.doesNotMatch(await page.locator("#view").innerText(), /Nothing watched yet/);
  how = {};
  await again(page.locator("#view")).click();
  await page.locator(".wl-card", { hasText: "Canvas Tote" }).waitFor();
  await ctx.close();
  console.log("ok - Price alerts with nothing kept: says it couldn't load, Try again brings what's watched");
}
await browser.close(); server.close();
console.log("PASS failed and slow loads: Receipts, Swap & resell, Bank and cards, the swap sheet and the shops' products say they couldn't load with Try again, never an empty-list message (stubbed server)");
