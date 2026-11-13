// Browser test: Relay doesn't keep asking its server for things. Stubbed Relay server, made-up account and shops, and a
// clock the test moves forward itself (ten minutes pass in a moment).
// Checks:
//  1. An ordinary shopper's app asks for seven things when it opens and none of them is test-shop data; left open on any
//     tab for ten minutes it asks for nothing at all; nor when it's hidden for half an hour and shown again (Receipts
//     looks once at the inbox and the list then, so a read that finished meanwhile shows; a quick look away asks nothing).
//  2. With testing tools on, the test-shop data is still asked for (people testing Relay keep their tools).
//  3. Once Square shops are real, "Is this yours?" is asked about without testing tools.
//  4. An auction's page keeps its price fresh every 20 seconds only while it's on screen: nothing in the background, once
//     on coming back, and not at all once the auction has been over for ten minutes or the page is closed.
//  5. A conversation looks for new messages every 30 seconds (asking Relay itself, not a remembered copy), only while
//     it's on screen, and stops once the conversation has ended.
//  6. The first read of an inbox: a round that fails is tried again after 5, 10, then 20 seconds (not every 5 for ever),
//     and nothing is asked while Relay is in the background.
//  7. The Receipts page stops asking how a read is getting on while Relay is in the background, and picks it up after.
//  8. The shopper's own details (name, address, phone, card, sign-in settings) are asked for once in ten minutes, not
//     on every visit to Profile.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeShows } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : extname(p) === ".svg" ? "image/svg+xml" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;

const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const A1 = "11111111-2222-4333-8444-555555555555", CHAT = "77777777-7777-7777-7777-777777777777";
const receipts = Array.from({ length: 6 }, (_, i) => ({ id: "1111111" + i + "-1111-4111-8111-11111111111" + i, status: "confirmed", kind: "receipt", retailer: { name: ["RAINS", "Nespresso"][i % 2], domain: ["rains.com", "nespresso.com"][i % 2] },
  orderRef: "R-" + i, orderDate: day(-3 - i * 5), totalPence: 2500 + i * 300, currency: "GBP", items: [{ name: "Item " + i, pricePence: 2500 + i * 300, quantity: 1 }], category: "fashion", categoryLabel: "Fashion", returnable: false, source: "shopper_email" }));
const purchases = [{ id: "o1", store: "Kick Lane", retailer: "shopify:kick-lane.myshopify.com", orderedAt: new Date(Date.now() - 2 * 864e5).toISOString(), amountMinor: 2000, currency: "GBP",
  items: [{ title: "Logo Cap", lineId: "L1", quantity: 1, priceMinor: 2000, currency: "GBP", variant: "Black", exchangeable: true, returnable: true, productId: "1" }] }];
// What the stand-in server is told to do, and everything it was asked for (not counting the browser's own preflights).
let st, log;
const reset = (o = {}) => { log = []; st = { instoreLive: false, auction: null, chatOpen: true, scan: { state: "done", found: 6, finishedAt: Date.now() - 36e5 }, scanAnswer: "ok", scanPosts: 0, ...o }; };
reset();
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const browser = await chromium.launch();
async function shopper({ testingTools = false, hash = "" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
  await ctx.route("https://**/*", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith("/relay/")) return route.abort();
    log.push(m + " " + p + u.search);
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, googleEmail: EMAIL, connectedAt: Date.now() - 864e5, lastScanAt: Date.now() - 36e5, checkedAt: Date.now() - 36e5, scan: st.scan, others: [] });
    if (p === "/relay/my/gmail/scan") {
      st.scanPosts++;
      if (st.scanAnswer === "fail") return j({ error: "busy" }, 503);
      if (st.scanAnswer === "busy") return j({ ok: true, busy: true, added: 0, updated: 0, more: true, retryAfterMs: 4000, job: st.scan });
      return j({ ok: true, added: 0, updated: 0, more: false, job: { state: "done", found: 6, finishedAt: Date.now() } });
    }
    if (p === "/relay/my/receipts") return j({ receipts });
    if (p === "/relay/my/purchases") return j({ purchases });
    if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [], allShops: false });
    if (p === "/relay/my/2fa") return j({ required: true, enrolled: true, verified: true, methods: ["passkey"] });
    if (p === "/relay/my/instore/shops") return j({ shops: [{ id: "LOC1", name: "Kiln Road Ceramics" }], live: st.instoreLive });
    if (p === "/relay/my/instore/suggestions") return j({ suggestions: [] });
    if (p === "/relay/live-test/products") return j({ products: [] });
    if (p === "/relay/verified-purchases") return j({ purchases: [] });
    if (p === "/relay/shopify/catalogue") return j({ published: true, products: [{ product: "Court Classic Trainers", variation: "White / UK 8", catalogueId: "shopify:kick:variant:1", sku: "shopify:kick:variant:1", priceMinor: 8500, currency: "GBP", storeName: "Kick Lane", inStock: true }] });
    if (p === "/relay/auctions") return j({ auctions: st.auction ? [st.auction] : [] });
    if (p === "/relay/auctions/" + A1) return st.auction ? j({ auction: st.auction }) : j({ error: "not_found" }, 404);
    if (p === "/relay/my/auctions") return j({ canBid: true, auctions: [] });
    if (p === "/relay/my/resale/items") return j({ items: [] });
    if (p === "/relay/my/resale/feed") return j({ listings: [] });
    if (p === "/relay/my/resale/mine") return j({ listings: [{ id: "66666666-6666-6666-6666-666666666666", title: "Wool jumper", store: "Example Outfitters", size: "L", condition: "good", askPence: 2500, currency: "GBP", swapOk: true, hasImage: false, status: "active",
      requests: [{ id: CHAT, who: "Member 1", kind: "buy", message: null, status: "accepted", offered: null }] }], myRequests: [] });
    if (p === "/relay/my/resale/requests/" + CHAT + "/messages") return j({ title: "Wool jumper", status: "accepted", with: "Buyer", open: st.chatOpen, messages: [{ mine: false, body: "Is it still available?", createdAt: 1 }] });
    return j({});
  });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.clock.install();
  await page.goto(origin + "/index.html");
  await page.evaluate(([e, t, back]) => {
    localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e })); if (t) localStorage.setItem("relay-testing-tools", "1");
    // Part-way through first-time set-up, as someone is when Google sends them back from connecting their inbox.
    if (back) { let h = 0; for (let i = 0; i < e.length; i++) h = (Math.imul(h, 31) + e.charCodeAt(i)) >>> 0; localStorage.setItem("relay.onboard.v1", JSON.stringify({ ["a" + h.toString(36)]: { back: true } })); }
  }, [EMAIL, testingTools, Boolean(hash)]);
  log.length = 0;
  // A fresh load of the app (from another page, as when Google sends someone back with "#gmail=connected").
  await page.goto("about:blank"); await page.goto(origin + "/index.html" + hash);
  return { ctx, page, errors };
}
// Lets what's on its way arrive (real time), then moves the app's clock on.
const settle = async (page, ms = 350) => { await page.waitForTimeout(ms); };
const pass = async (page, ms) => { await page.clock.runFor(ms); await settle(page); };
const count = (re) => log.filter(x => re.test(x)).length;
const until = async (page, f, what) => { for (let i = 0; i < 60; i++) { if (f()) return; await page.waitForTimeout(100); } assert.fail("timed out waiting for " + what + "; asked for so far: " + JSON.stringify(log.slice(-12))); };
const hide = (page, hidden) => page.evaluate((h) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => h }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
  document.dispatchEvent(new Event("visibilitychange")); if (!h) window.dispatchEvent(new Event("focus"));
}, hidden);
const TEST_ONLY = /live-test\/products|verified-purchases|instore\/suggestions|web-shops|\/my\/testing\//;
const TEN_MINUTES = 600000;

// 1. An ordinary shopper.
{
  const { ctx, page, errors } = await shopper();
  await homeShows(page, "J");
  await pass(page, 6000);   // Discover's catalogue is fetched a few seconds after the start, so that tab opens at once
  await until(page, () => count(/shopify\/catalogue/) === 1, "the catalogue");
  assert.deepEqual([...log].sort(), ["GET /relay/my/alerts/status", "GET /relay/my/gmail", "GET /relay/my/instore/shops", "GET /relay/my/profile", "GET /relay/my/purchases", "GET /relay/my/receipts", "GET /relay/shopify/catalogue"],
    "opening Relay asks for these seven things, once each. If this list has to grow, make sure it's worth a request every time someone opens the app.");
  let mark = log.length;
  await pass(page, TEN_MINUTES);
  assert.deepEqual(log.slice(mark), [], "Home, left open for ten minutes, asks for nothing");
  for (const [key, name] of [["receipts", "Receipts"], ["discover", "Discover"], ["me", "Profile"], ["profile", "Home"]]) {
    await page.evaluate(k => window.tabTap(k), key);
    await pass(page, 3000); await settle(page, 500);
    mark = log.length;
    await pass(page, TEN_MINUTES);
    assert.deepEqual(log.slice(mark), [], name + ", left open for ten minutes, asks for nothing");
  }
  // The phone locks, or the shopper goes to another app for half an hour and comes back: nothing is asked for.
  mark = log.length;
  await hide(page, true); await pass(page, 30 * 60000); await hide(page, false); await pass(page, 5000);
  assert.deepEqual(log.slice(mark), [], "Home asks for nothing when Relay comes back to the front");
  // On Receipts, coming back after half an hour looks once at how the inbox is doing and at the list (a read may have
  // finished meanwhile, and new receipts may be in): one request each, then nothing more.
  await page.evaluate(() => window.tabTap("receipts")); await pass(page, 3000);
  mark = log.length;
  await hide(page, true); await pass(page, 30 * 60000);
  assert.deepEqual(log.slice(mark), [], "nothing while it's in the background");
  await hide(page, false); await pass(page, 5000);
  assert.deepEqual(log.slice(mark).map(x => x.split("?")[0]).sort(), ["GET /relay/my/gmail", "GET /relay/my/purchases", "GET /relay/my/receipts"], "Receipts looks once at the inbox and the list when Relay comes back");
  mark = log.length;
  // Flicking away and straight back doesn't ask again (what was just loaded is reused for a minute).
  await hide(page, true); await pass(page, 5000); await hide(page, false); await pass(page, 5000);
  assert.deepEqual(log.slice(mark), [], "and not again for a quick look away");
  await pass(page, TEN_MINUTES);
  assert.deepEqual(log.slice(mark), [], "nor while it's then left open");
  assert.deepEqual(log.filter(x => TEST_ONLY.test(x)), [], "an ordinary shopper's app never asks for test-shop data");
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - an ordinary shopper: seven requests to open, none for test-shop data, and nothing at all while a tab is left open or Relay is in the background");
}

// 2. With testing tools on, the test-shop data is still asked for.
{
  reset();
  const { ctx, page } = await shopper({ testingTools: true });
  await homeShows(page, "J");
  await pass(page, 6000);
  await until(page, () => count(/live-test\/products/) === 1 && count(/verified-purchases/) >= 1 && count(/instore\/suggestions/) >= 1, "the test shop's products, the old test purchases and in-store suggestions");
  const mark = log.length;
  await pass(page, TEN_MINUTES);
  assert.deepEqual(log.slice(mark), [], "and with testing tools on, Home still asks for nothing while it's left open");
  await ctx.close();
  console.log("ok - testing tools on: Relay's test shop and test purchases are still loaded");
}

// 3. Once Square shops are real, in-store purchases are asked about without testing tools.
{
  reset({ instoreLive: true });
  const { ctx, page } = await shopper();
  await homeShows(page, "J");
  await until(page, () => count(/instore\/suggestions/) === 1, "in-store suggestions");
  await pass(page, 6000);
  assert.equal(count(/live-test\/products|verified-purchases/), 0);
  await ctx.close();
  console.log("ok - real Square shops: 'Is this yours?' is asked about without testing tools");
}

// 4. An auction's page.
{
  reset();
  const { ctx, page, errors } = await shopper();
  await homeShows(page, "J");
  const now = await page.evaluate(() => Date.now());
  st.auction = { id: A1, shop: "Hollow Pine", title: "Wool Beanie", variant: "Navy", size: null, description: null, condition: "new_tags", conditionText: "New with tags", fromCatalogue: true, pictures: [],
    startMinor: 1000, priceMinor: 3100, nextMinor: 3200, bids: 4, deliveryMinor: 395, currency: "GBP", endsAt: now + 3 * 3600e3, status: "live" };
  const asks = () => count(new RegExp("GET /relay/auctions/" + A1 + "$"));
  await page.evaluate(id => { location.hash = "open=auction&id=" + id; }, A1);
  await page.getByRole("heading", { name: "Wool Beanie" }).waitFor();
  await settle(page);
  assert.equal(asks(), 1, "opened: asked once");
  await pass(page, 61000);
  await until(page, () => asks() === 4, "three more looks in a minute");
  assert.equal(asks(), 4, "on screen: the price is looked at every 20 seconds");
  // Relay goes to the background: nothing more, however long.
  await hide(page, true); await pass(page, 5 * 60000);
  assert.equal(asks(), 4, "in the background: nothing is asked for");
  // Back in front: once straight away (a turn was missed), then every 20 seconds again.
  await hide(page, false);
  await until(page, () => asks() === 5, "one look on coming back");
  await pass(page, 21000); await until(page, () => asks() === 6, "the next look 20 seconds later");
  // The auction ended a minute ago: the page keeps up a little longer (a winner's link to pay arrives), then stops.
  const later = await page.evaluate(() => Date.now());
  st.auction = { ...st.auction, status: "ended", endsAt: later - 60000 };
  await pass(page, 21000); await until(page, () => asks() === 7, "the look that finds it has ended");
  await pass(page, 41000); await until(page, () => asks() === 9, "still keeping up just after the end");
  await pass(page, 10 * 60000);
  const after = asks();
  await pass(page, TEN_MINUTES);
  assert.equal(asks(), after, "ten minutes after the end there's nothing left to keep up with: it stops");
  assert.ok(after <= 9 + 27, "and it never asked more often than every 20 seconds (" + after + " looks)");
  // A live auction again, then the page is closed: nothing more.
  const fresh = await page.evaluate(() => Date.now());
  st.auction = { ...st.auction, status: "live", endsAt: fresh + 3 * 3600e3 };
  await page.getByRole("button", { name: "Back to auctions" }).click(); await settle(page);
  const left = asks();
  await pass(page, 5 * 60000);
  assert.equal(asks(), left, "off the page: nothing is asked about that auction");
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - an auction's page: every 20 seconds while on screen, nothing in the background, once on return, and it stops when the auction is over or the page is closed");
}

// 5. A conversation.
{
  reset();
  const { ctx, page, errors } = await shopper();
  await homeShows(page, "J");
  const asks = () => count(/GET \/relay\/my\/resale\/requests\/.*\/messages/);
  await page.locator(".avatar").click();
  await page.getByRole("button", { name: "Swap & resell", exact: true }).click();
  await page.getByRole("heading", { name: "Swap & resell" }).waitFor();
  await page.locator('[data-tab="mine"]').click();
  await page.getByRole("button", { name: "Open messages" }).click();
  await page.getByText("Is it still available?").waitFor();
  await settle(page);
  assert.equal(asks(), 1, "opened: asked once");
  await pass(page, 61000);
  await until(page, () => asks() === 3, "two more looks in a minute");
  assert.equal(asks(), 3, "on screen: new messages are looked for every 30 seconds, each time from Relay itself");
  await hide(page, true); await pass(page, 5 * 60000);
  assert.equal(asks(), 3, "in the background: nothing is asked for");
  await hide(page, false);
  await until(page, () => asks() === 4, "one look on coming back");
  // The other person ends the conversation: the next look finds out, and that's the last.
  st.chatOpen = false;
  await pass(page, 31000); await until(page, () => asks() === 5, "the look that finds it has ended");
  await pass(page, TEN_MINUTES);
  assert.equal(asks(), 5, "an ended conversation isn't asked about again");
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - a conversation: every 30 seconds while on screen, nothing in the background, and nothing once it has ended");
}

// 6. The first read of an inbox, when Relay can't do a round just now.
{
  reset({ scan: { state: "running", found: 0 }, scanAnswer: "fail" });
  const { ctx, page } = await shopper({ hash: "#gmail=connected" });
  await page.locator(".rl-jscan").first().waitFor();
  await until(page, () => st.scanPosts === 1, "the first round");
  await settle(page);
  // How many seconds of the app's clock until the next try.
  const gap = async (most) => { const had = st.scanPosts; for (let s = 1; s <= most; s++) { await page.clock.runFor(1000); await page.waitForTimeout(60); if (st.scanPosts > had) return s; } return null; };
  const g1 = await gap(30), g2 = await gap(40), g3 = await gap(60);
  assert.ok(g1 >= 4 && g1 <= 7, "tried again after about 5 seconds (" + g1 + ")");
  assert.ok(g2 >= 9 && g2 <= 13, "then after about 10 (" + g2 + "), not every 5");
  assert.ok(g3 >= 18 && g3 <= 24, "then after about 20 (" + g3 + ")");
  // In the background nothing is asked; back in front it carries on.
  await hide(page, true);
  const had = st.scanPosts;
  await pass(page, 5 * 60000);
  assert.equal(st.scanPosts, had, "in the background: no rounds are asked for");
  st.scanAnswer = "ok";
  await hide(page, false);
  await until(page, () => st.scanPosts === had + 1, "the round that was waiting");
  await ctx.close();
  console.log("ok - the first inbox read: a failed round is retried after 5, 10, then 20 seconds, and never while Relay is in the background");
}

// 7. The Receipts page while Relay itself is reading the inbox.
{
  reset({ scan: { state: "running", full: false, found: 5, scannedBack: "2026-03-01", startedAt: Date.now() - 60000, updatedAt: Date.now(), finishedAt: null, error: null }, scanAnswer: "busy" });
  const { ctx, page, errors } = await shopper();
  await homeShows(page, "J");
  await page.evaluate(() => window.tabTap("receipts"));
  await until(page, () => st.scanPosts >= 1, "the page asking how the read is getting on");
  await pass(page, 9000);
  const seen = st.scanPosts;
  assert.ok(seen >= 2 && seen <= 4, "on screen: it looks again every few seconds while Relay is reading (" + seen + ")");
  await hide(page, true); await pass(page, 5 * 60000);
  assert.ok(st.scanPosts <= seen + 1, "in the background: it stops asking (" + (st.scanPosts - seen) + " more)");
  const quiet = st.scanPosts;
  await pass(page, 5 * 60000);
  assert.equal(st.scanPosts, quiet, "and stays stopped");
  await hide(page, false);
  await until(page, () => st.scanPosts > quiet, "the page picking the read up again");
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - Receipts: progress on a read isn't asked for while Relay is in the background, and is picked up again after");
}

// 8. What only the shopper can change (name, address, phone, card, sign-in settings, what they agreed to) is asked for
// once in ten minutes, not every time Profile is opened. What the world can change is still asked for after a minute.
{
  reset();
  const { ctx, page, errors } = await shopper();
  await homeShows(page, "J");
  const OWN = /GET \/relay\/my\/(profile|delivery|phone|card|2fa|consent|admin\/me)$/;
  await page.evaluate(() => window.tabTap("me")); await pass(page, 3000); await settle(page, 500);
  const first = log.filter(x => OWN.test(x)).sort();
  assert.deepEqual(first, ["GET /relay/my/2fa", "GET /relay/my/admin/me", "GET /relay/my/card", "GET /relay/my/consent", "GET /relay/my/delivery", "GET /relay/my/phone", "GET /relay/my/profile"], "each asked for once when Profile first opens");
  let mark = log.length;
  await page.evaluate(() => window.tabTap("profile")); await pass(page, 2 * 60000);
  await page.evaluate(() => window.tabTap("me")); await pass(page, 3000); await settle(page, 500);
  assert.deepEqual(log.slice(mark).filter(x => OWN.test(x)), [], "two minutes later, Profile doesn't ask for them again");
  assert.ok(log.slice(mark).some(x => x === "GET /relay/my/purchases"), "but it does look again at what a shop could have changed");
  mark = log.length;
  await page.evaluate(() => window.tabTap("profile")); await pass(page, 9 * 60000);
  await page.evaluate(() => window.tabTap("me")); await pass(page, 3000); await settle(page, 500);
  // (What they agreed to is also kept by the page that asks for it, so it's left out of this count.)
  const notAgreement = x => OWN.test(x) && !/consent/.test(x);
  assert.deepEqual(log.slice(mark).filter(notAgreement).sort(), first.filter(notAgreement), "after ten minutes they are asked for again, once each");
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - the shopper's own details are asked for once in ten minutes, not on every visit to Profile");
}

await browser.close(); server.close();
console.log("PASS quiet: nothing is asked for on a timer except an open auction or conversation, and never in the background");
