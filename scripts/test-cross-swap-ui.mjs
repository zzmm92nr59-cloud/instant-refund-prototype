// Browser test: swapping an item for something from another shop on Relay. Stubbed Relay server, made-up shops, people and
// items; nothing reaches a shop. Checks: offered only where another shop has something; greyed outlines while it loads; both
// halves of the swap and the overall difference in plain words; a reason is needed; a new price at the second shop must be
// agreed again; one start for a double tap; the Relay reference and the second shop's own checkout (opens outside Relay);
// the order card then shows the swap waiting, and done once the second shop's order arrives; the testing tools' test order
// appears only with testing on. Passes the polish rules in light and dark, at phone size.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString();
const ORDER = "shopify:oak-thread.myshopify.com:order:1001", KEY = "shopify:birch-lane.myshopify.com:variant:gid://shopify/ProductVariant/21";
const TEST_KEY = "shopify:moss-test.myshopify.com:variant:gid://shopify/ProductVariant/51", SWAP = "dddddddd-dddd-4ddd-8ddd-000000000001";
const SHOPPER_NEVER_SEES = /\bdemo\b|sandbox|simulat|fictional|prototype|test mode|test shop|preview only/i;

const st = { phase: "new", otherShops: true, posts: [], testShop: false, livePrice: 4750 };
const cap = () => {
  const it = { title: "Logo Cap", lineId: "901", quantity: 1, priceMinor: 2000, currency: "GBP", variant: "Black", productId: "1", variantId: "11", exchangeable: false, returnable: st.phase === "new" };
  if (st.phase === "new" && st.otherShops) it.otherShops = true;
  if (st.phase !== "new") {
    it.returnInfo = { status: "requested", ref: "RLY-ABCD-EFGH", trackingNumber: null, refundMinor: null, refundedAt: null };
    it.crossSwap = { id: SWAP, orderId: ORDER, lineId: "901", fromShop: "Oak & Thread", fromTitle: "Logo Cap", fromPriceMinor: 2000, returnRef: "RLY-ABCD-EFGH",
      toShop: st.testShop ? "Moss Test" : "Birch Lane", toTitle: st.testShop ? "Test Jacket (M)" : "Linen Shirt (M)", toPriceMinor: 4750, status: st.phase === "ordered" ? "ordered" : "waiting",
      startedAt: day(0), orderedAt: st.phase === "ordered" ? day(0) : null, buyUrl: st.phase === "ordered" ? null : "https://birch-lane.myshopify.com/cart/21:1",
      toKey: st.phase === "ordered" ? null : (st.testShop ? TEST_KEY : KEY), testShop: st.testShop, testOrders: st.testShop };
    if (st.phase === "stopped") delete it.crossSwap;
  }
  return it;
};
const purchases = () => [{ id: ORDER, store: "Oak & Thread", retailer: "shopify:oak-thread.myshopify.com", orderedAt: day(-2), items: [cap()] }];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx.route("https://**/*", async route => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (m === "POST") st.posts.push([p, JSON.parse(req.postData() || "{}")]);
  if (p === "/relay/my/purchases") return j({ purchases: purchases() });
  if (p === "/relay/my/cross-swap/options") {
    await new Promise(ok => setTimeout(ok, 400)); // long enough to see the outlines
    return j({ eligible: true, item: { title: "Logo Cap", priceMinor: 2000, shop: "Oak & Thread" }, shops: [{ name: "Birch Lane", items: [
      { key: "shopify:birch-lane.myshopify.com:variant:gid://shopify/ProductVariant/31", product: "Canvas Tote", variant: null, priceMinor: 1800, imageUrl: "https://cdn.example/tote.png" },
      { key: KEY, product: "Linen Shirt", variant: "M", priceMinor: 4500, imageUrl: null }] }] });
  }
  if (p === "/relay/my/cross-swap" && m === "POST") {
    const b = JSON.parse(req.postData() || "{}");
    await new Promise(ok => setTimeout(ok, 300));
    if (b.agreedPriceMinor !== st.livePrice) return j({ error: "price_changed", priceMinor: st.livePrice }, 409);
    st.phase = "waiting";
    return j({ returnId: "r1", returnRef: "RLY-ABCD-EFGH", status: "requested", labelAvailable: false, shopNotified: true, item: "Logo Cap", priceMinor: 2000, swapId: SWAP,
      fromShop: "Oak & Thread", fromTitle: "Logo Cap", fromPriceMinor: 2000, toShop: "Birch Lane", toTitle: "Linen Shirt (M)", toPriceMinor: 4750, toKey: KEY,
      buyUrl: "https://birch-lane.myshopify.com/cart/21:1", testShop: false });
  }
  if (p === "/relay/my/cross-swap/" + SWAP + "/cancel" && m === "POST") { await new Promise(ok => setTimeout(ok, 300)); st.phase = "stopped"; return j({ ok: true }); }
  if (p === "/relay/my/testing/shopify-order" && m === "POST") { await new Promise(ok => setTimeout(ok, 300)); st.phase = "ordered"; return j({ ok: true, name: "#5001", message: "Test order #5001 placed at Moss Test under your Relay email. No real money moved." }); }
  if (p === "/relay/shopify/catalogue") return j({ products: [] });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5 });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/admin/me") return j({ admin: false });
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", () => { throw new Error("a browser pop-up appeared; Relay must ask inside the page"); });
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " input")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓+×✕↩]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    const caps = s.textTransform === "uppercase" || (/[A-Z]/.test(el.textContent) && el.textContent === el.textContent.toUpperCase());
    if (px < 13 && !(caps && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    const back = bgOf(el), a = lum(flat(rgb(s.color), back)), b = lum(back), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3 && !el.closest("button:disabled")) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const polished = async (where, scope) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/cross-swap-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const signIn = async (url) => {
  await page.goto(url);
  await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
  await page.reload();
};
const sheet = page.locator(".rl-xs");

// 1. Offered only where another shop has something in stock.
st.otherShops = false;
await signIn(origin + "/index.html");
await page.getByRole("button", { name: "Return", exact: true }).first().waitFor();
assert.equal(await page.getByRole("button", { name: "Swap with another shop" }).count(), 0, "not offered when no other shop has anything");
st.otherShops = true;
await page.reload();
const offer = page.getByRole("button", { name: "Swap with another shop" }).first();
await offer.waitFor();
console.log("ok - offered only where another shop has something in stock");

// 2. What other shops have: greyed outlines while it loads, then each shop's items with their prices.
await offer.click();
await sheet.locator(".rl-xs-skel").first().waitFor();
assert.equal(await sheet.getByText("Loading", { exact: false }).count(), 0, "no bare Loading text");
await sheet.getByRole("heading", { name: "Birch Lane" }).waitFor();
assert.equal(await sheet.locator(".rl-xs-skel").count(), 0);
assert.match(await sheet.innerText(), /Send Logo Cap back to Oak & Thread and choose something from another shop on Relay instead\./);
const shirt = sheet.getByRole("button", { name: "Linen Shirt, M, £45.00, from Birch Lane" });
await shirt.waitFor();
await polished("pick", ".rl-xs");
console.log("ok - outlines while loading, then other shops' items and prices");

// 3. The review: both halves, the overall difference, why it's going back; nothing starts without a reason.
await shirt.click();
await sheet.getByRole("heading", { name: "Check the swap" }).waitFor();
const review = await sheet.innerText();
for (const s of ["Send back to Oak & Thread", "Logo Cap (Black)", "£20.00. Oak & Thread refunds you to how you paid once they get it back.",
  "Get from Birch Lane", "Linen Shirt (M)", "£45.00. You pay Birch Lane at their own checkout.", "Once the refund arrives, you'll have paid £25.00 more overall.",
  "Relay doesn't take any payment: your refund comes from Oak & Thread, and you pay Birch Lane directly."])
  assert.ok(review.includes(s), "says: " + s);
await polished("review", ".rl-xs");
await sheet.getByRole("button", { name: "Start the swap" }).click();
await sheet.getByText("Pick why you're sending it back.").waitFor();
assert.equal(st.posts.length, 0, "nothing sent without a reason");
console.log("ok - both halves, the overall difference, and a reason needed");

// 4. A new price at the second shop is shown and must be agreed again; then one start for a double tap.
await sheet.getByRole("radio", { name: "Changed my mind" }).click();
assert.equal(await sheet.getByRole("radio", { name: "Changed my mind" }).getAttribute("aria-checked"), "true");
await sheet.getByRole("button", { name: "Start the swap" }).click();
await sheet.getByText("Birch Lane now charges £47.50 for it. Check the swap again.").waitFor();
assert.ok((await sheet.innerText()).includes("Once the refund arrives, you'll have paid £27.50 more overall."));
assert.deepEqual(st.posts.map(x => x[1].agreedPriceMinor), [4500]);
await sheet.getByRole("radio", { name: "Changed my mind" }).click();
await sheet.getByRole("button", { name: "Start the swap" }).dblclick();
await sheet.getByRole("heading", { name: "Return started with Oak & Thread" }).waitFor();
assert.deepEqual(st.posts.slice(1), [["/relay/my/cross-swap", { orderId: ORDER, lineId: "901", toKey: KEY, reason: "changed_mind", agreedPriceMinor: 4750 }]], "started once for a double tap");
console.log("ok - a new price is agreed again; started once for a double tap");

// 5. Done: the Relay reference, what happens at each shop, and the second shop's own checkout (outside Relay).
const done = await sheet.innerText();
for (const s of ["RLY-ABCD-EFGH", "It isn't a postage label or tracking number.", "Relay has emailed Oak & Thread to say it's coming back. Send it back using Oak & Thread's own returns process.",
  "Next: buy it from Birch Lane", "Use your Relay email there, so Relay can show the swap as done."]) assert.ok(done.includes(s), "says: " + s);
const buy = sheet.getByRole("link", { name: "Go to Birch Lane's checkout" });
assert.equal(await buy.getAttribute("href"), "https://birch-lane.myshopify.com/cart/21:1");
assert.equal(await buy.getAttribute("target"), "_blank"); assert.match(await buy.getAttribute("rel"), /noopener/);
assert.equal(await sheet.getByRole("button", { name: /Test shop/ }).count(), 0, "no testing tools for shoppers");
assert.ok(!SHOPPER_NEVER_SEES.test(done), "no test or demo words for shoppers");
await polished("done", ".rl-xs");
await sheet.getByRole("button", { name: "Done" }).click();
console.log("ok - the reference, each shop's part, and the second shop's own checkout");

// 6. The order card: waiting for the second shop's order, with its checkout; nothing more to return or swap.
await page.evaluate(() => window.go("returns"));
const card = page.locator(".rl-po").filter({ hasText: "Swapping for Linen Shirt (M) from Birch Lane" });
await card.waitFor();
assert.match(await card.innerText(), /Return started · ref RLY-ABCD-EFGH/);
assert.equal(await card.getByRole("link", { name: "Buy it from Birch Lane" }).getAttribute("href"), "https://birch-lane.myshopify.com/cart/21:1");
assert.equal(await card.getByRole("button", { name: /^(Swap|Return|Swap with another shop)$/ }).count(), 0, "can't be returned or swapped again");
assert.ok(!SHOPPER_NEVER_SEES.test(await card.innerText()));
await polished("waiting card", ".rl-po");
console.log("ok - the card shows the swap waiting, with the second shop's checkout");

// 6b. Stopping the swap asks first, says the return goes ahead, and is sent once; then only the return shows.
await card.getByRole("button", { name: "Stop the swap" }).click();
const confirmBox = page.getByRole("alertdialog");
await confirmBox.getByText("Stop swapping for Linen Shirt (M) from Birch Lane? Your return to Oak & Thread still goes ahead, and Oak & Thread refunds you as usual.").waitFor();
await confirmBox.getByRole("button", { name: "Stop the swap" }).dblclick();
await page.locator(".rl-po").filter({ hasText: "Return started · ref RLY-ABCD-EFGH" }).filter({ hasNotText: "Swapping for" }).waitFor();
assert.deepEqual(st.posts.filter(x => /cancel$/.test(x[0])).map(x => x[0]), ["/relay/my/cross-swap/" + SWAP + "/cancel"], "stopped once for a double tap");
console.log("ok - stopping a swap asks first, keeps the return, and is sent once");
st.phase = "waiting";

// 7. With testing on, a swap to a test shop can be finished with a test order; then the card shows it done.
st.testShop = true;
await page.goto(origin + "/index.html?testing=1");
await page.evaluate(() => window.go("returns"));
const testCard = page.locator(".rl-po").filter({ hasText: "Swapping for Test Jacket (M) from Moss Test" });
await testCard.getByRole("button", { name: "Test shop: place this order at Moss Test" }).dblclick();
await page.locator(".rl-po").filter({ hasText: "Swapped for Test Jacket (M) from Moss Test, ordered" }).waitFor({ timeout: 8000 });
assert.deepEqual(st.posts.filter(x => x[0] === "/relay/my/testing/shopify-order"), [["/relay/my/testing/shopify-order", { variantKey: TEST_KEY }]], "one test order for a double tap");
console.log("ok - testing tools: a test order finishes a test shop swap; the card shows it done");

assert.deepEqual(errors, [], "no page errors");
console.log("PASS swap with another shop UI: offered where there's a choice, outlines, plain words, reason needed, new price agreed, once per tap, own checkout, card states, polished");
await browser.close(); server.close();
