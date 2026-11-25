// Browser test: what the line-by-line review of the app found, fixed. Stubbed Relay server, made-up accounts and shops.
// Checks:
//  1. A group's page says why nothing in it goes back only when that's true of every receipt in it (the newest receipt's
//     reason used to sit above receipts that could still be returned).
//  2. An email receipt is the same purchase as a shop's order only when it's from about the same days: another order at
//     that shop for the same money, months apart, stays in Receipts.
//  3. Moving a receipt to another group thanks the shopper only once Relay saved it; if it didn't, the picker goes back
//     and says so.
//  4. A month's total that leaves out receipts with no amount says how many it was added up from.
//  5. Signing out, then in as someone else on the same phone: nothing of the first member's (what they watch, what Relay
//     learned of their style, their Swap & resell area, their pictures) is left for the second (CLAUDE.md rule 5).
//  6. Wrapped from Home opens once however quickly the chip is tapped twice, and a press that turns into a drag
//     (pointercancel) doesn't leave the story paused.
//  7. What a thing is drawn as, when it has no photo: socks are socks (not a T-shirt), a hat is a hat, and clothing the
//     words can't place is a neutral hanger, never the wrong thing.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeShows, openReceiptKind, openSettings, waitOutDoubleTap } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const A = "jess.tester@example.com", B = "sam.other@example.com";
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const month = new Date().toISOString().slice(0, 7), inMonth = d => month + "-" + String(d).padStart(2, "0");
let n = 0; const id = () => "1" + String(++n).padStart(7, "0") + "-1111-4111-8111-111111111111";
const R = (shop, item, o) => ({ id: id(), status: "confirmed", kind: "receipt", retailer: { name: shop, domain: shop.toLowerCase().replace(/\W+/g, "") + ".example" }, orderRef: "R" + n, orderDate: day(-2), totalPence: 2000,
  currency: "GBP", items: [{ name: item, qty: 1, pricePence: 2000 }], category: "fashion", categoryLabel: "Fashion", returnable: true, ...o });
const receipts = [
  // Fashion: the newest can't go back (a personalised order, in the seller's own words); the older one can.
  R("Engrave & Co", "Personalised Hoodie", { orderDate: day(-1), returnable: false, notReturnableReason: "Personalised items can't be returned, the seller says." }),
  R("Harlow Lane", "Linen Shirt", { orderDate: day(-6), returnBy: { date: day(20), basis: "stated" }, returns: { deadline: day(20) } }),
  // Food: none of it goes back, for the same reason.
  R("Tesco", "Bananas", { category: "food", categoryLabel: "Food & drink", returnable: false, notReturnableReason: "Food and drink usually can't be returned." }),
  R("Tesco", "Bread", { category: "food", categoryLabel: "Food & drink", orderDate: day(-9), returnable: false, notReturnableReason: "Food and drink usually can't be returned." }),
  // Kick Lane: an email for the order the shop confirmed (same days), and one for another £20 order four months earlier.
  R("Kick Lane", "Same Cap Email", { orderDate: day(-2) }),
  R("Kick Lane", "Old Cap Email", { orderDate: day(-120) }),
  // Home & garden this month: two with an amount, one Relay couldn't read an amount from.
  R("Fernway", "Desk Lamp", { category: "home", categoryLabel: "Home & garden", orderDate: inMonth(1), totalPence: 3000 }),
  R("Fernway", "Lamp Shade", { category: "home", categoryLabel: "Home & garden", orderDate: inMonth(1), totalPence: 1500 }),
  R("Fernway", "Light Bulbs", { category: "home", categoryLabel: "Home & garden", orderDate: inMonth(1), totalPence: null }),
];
const purchases = [{ id: "o1", store: "Kick Lane", retailer: "shopify:kick-lane.myshopify.com", orderedAt: new Date(Date.now() - 2 * 864e5).toISOString(), amountMinor: 2000, currency: "GBP",
  items: [{ title: "Logo Cap", lineId: "L1", quantity: 1, priceMinor: 2000, currency: "GBP", variant: "Black", exchangeable: false, returnable: false }] }];
const KICK_TRAINERS = { sku: "shopify-v-9", catalogueId: "shopify-v-9", product: "Jess's Watched Trainers", variation: "UK 5", priceMinor: 8000, currency: "GBP", quantity: 4,
  storeName: "Kick Lane", shopDomain: "kick-lane.myshopify.com", imageUrl: "https://cdn.kicklane.example/t.jpg" };
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
let st = {};
const browser = await chromium.launch();
async function open(email = A) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
  await ctx.route("https://**/*", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith("/relay/")) return route.abort();
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
    const who = st.who || email;
    if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
    if (p === "/relay/auth/verify") { st.who = B; return j({ sessionToken: "B".repeat(43), email: B, expiresAt: Date.now() + 864e5 }); }
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: who });
    if (p === "/relay/my/receipts") return j({ receipts: who === A ? receipts : [] });
    if (p === "/relay/my/purchases") return j({ purchases: who === A ? purchases : [] });
    if (p === "/relay/my/profile") return j({ email: who, name: who === A ? "Jess Tester" : "Sam Other", photo: null });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
    // Kick Lane still sells the trainers Jess watches. (With a catalogue that lacked them, her card was rightly taken off the
    // moment the shops answered, a few milliseconds after it showed: the check below raced that, and so proved nothing
    // about what Sam sees later either.)
    if (p === "/relay/shopify/catalogue") return j({ published: true, publishedStoreCount: 1, products: [KICK_TRAINERS] });
    if (p.endsWith("/category") && m === "POST") { st.catPosts = (st.catPosts || 0) + 1; return j({ error: "busy" }, 503); }
    if (p === "/relay/my/wrapped") { await new Promise(r => setTimeout(r, 1500)); return j({ year: Number(u.searchParams.get("year")), years: [], receipts: 3, shops: 2, items: 3, spentPence: 6000, currency: "GBP", categories: [], topShops: [], byMonth: [], coverage: { withTotal: 3, noTotal: 0, otherCurrency: 0 } }); }
    return j({});
  });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.addInitScript(([k, v]) => { if (!localStorage.getItem("relay.signed-out-test")) localStorage.setItem(k, v); }, ["relay.session.v1", JSON.stringify({ token: "A".repeat(43), email, expiresAt: Date.now() + 864e5 })]);
  await page.goto(origin + "/index.html"); await homeShows(page, "J");
  return { ctx, page, errors };
}

{
  st = {};
  const { ctx, page, errors } = await open();
  // 1. A group's note.
  await openReceiptKind(page, "Fashion");
  await page.locator("#view .rl-cat-hero").waitFor();
  assert.equal(await page.locator("#view .rl-cat-note").count(), 0, "Fashion: one receipt's reason isn't put above the others (one can still go back)");
  await openReceiptKind(page, "Food & drink");
  await page.locator("#view .rl-cat-note", { hasText: "Food and drink usually can't be returned." }).waitFor();
  console.log("ok - a group's 'can't be returned' note only when it's true of every receipt in it");

  // 2. Same purchase or another order.
  await waitOutDoubleTap(page); await page.locator("#view .rl-cat-back").first().click();
  await page.locator("#view .rl-calm-filter").first().waitFor();
  const search = async q => { await page.locator('#view .rl-search input').first().fill(q); await page.waitForTimeout(400); return page.locator("#view .rl-rr:visible").allInnerTexts(); };
  assert.ok((await search("Old Cap Email")).some(t => /Kick Lane/.test(t)), "an order at the same shop for the same money, four months earlier, is its own receipt");
  assert.equal((await search("Same Cap Email")).length, 0, "the email for the order the shop confirmed is shown once, as that order");
  await page.locator('#view .rl-search input').first().fill("");
  console.log("ok - an email receipt joins a shop's order only when it's from the same days");

  // 4. A month's total that leaves some out.
  await openReceiptKind(page, "Home & garden");
  const head = await page.locator("#view .rl-cat-month").first().innerText();
  assert.match(head, /£45\.00 from 2 of 3 receipts/, "the month's total says what it was added up from");
  assert.match(await page.locator("#view .rl-cat-hero").innerText(), /£45\.00 from 2 of 3 receipts since/);
  console.log("ok - totals say when some receipts had no amount to add");

  // 3. Moving a receipt to another group, when Relay doesn't save it.
  await openReceiptKind(page, "Home & garden");
  await page.locator("#view .rl-rr", { hasText: "Desk Lamp" }).first().click();
  const pick = page.locator("#view .rl-rc-pick").first(); await pick.waitFor();
  await pick.selectOption("electronics");
  await page.getByText("Couldn't save that. Please try again.").waitFor();
  assert.equal(await pick.inputValue(), "home", "the picker goes back to the group it's really in");
  assert.equal(await pick.isEnabled(), true);
  assert.equal(await page.getByText(/Thanks, Relay will remember this/).count(), 0, "no thanks for something that wasn't saved");
  assert.equal(st.catPosts, 1);
  console.log("ok - a group change that wasn't saved says so and goes back");

  // 6. Wrapped from Home, tapped twice while it's still coming; then a press that turns into a drag.
  await page.evaluate(() => window.go("profile")); await homeShows(page, "J");
  const chip = page.locator("#view .h2-chip-go", { hasText: "Wrapped" });
  await chip.click(); await page.waitForTimeout(700); await chip.click();
  await page.locator(".rl-story").first().waitFor();
  await page.waitForTimeout(2200);
  assert.equal(await page.locator(".rl-story").count(), 1, "one story, not two on top of each other");
  const frame = page.locator(".rl-story-frame");
  await frame.dispatchEvent("pointerdown", { pointerId: 1, isPrimary: true });
  assert.equal(await frame.evaluate(f => f.classList.contains("paused")), true);
  await frame.dispatchEvent("pointercancel", { pointerId: 1, isPrimary: true });
  assert.equal(await frame.evaluate(f => f.classList.contains("paused")), false, "a press that became a drag lets the story carry on");
  await page.keyboard.press("Escape");
  console.log("ok - Wrapped opens once, and doesn't freeze after a drag");

  // 7. Drawings for things with no photo.
  const draw = name => page.evaluate(x => window.RelayAccount.drawing.of(x).key, name);
  assert.equal(await draw("Wool Socks"), "sock"); assert.equal(await draw("Ankle Socks 3 Pack"), "sock");
  assert.equal(await draw("Mickey Mouse T-shirt"), "tshirt"); assert.equal(await draw("Wool Beanie"), "hat");
  assert.equal(await draw("Silk Scarf"), "hanger"); assert.equal(await draw("Sports Bra"), "hanger");
  assert.equal(await draw("Chelsea Boots"), "shoe"); assert.equal(await draw("Sock Boots"), "shoe");
  assert.equal(await page.evaluate(() => window.RelayAccount.drawing.key({ items: [{ name: "Item 4471" }], retailer: {}, category: "fashion" })), "hanger", "clothing the words can't place: a neutral hanger");
  console.log("ok - socks are drawn as socks, hats as hats, anything else in Fashion as a hanger");

  assert.deepEqual(errors, []);
  await ctx.close();
}

// 5. Sign out, then in as someone else.
{
  st = {};
  const { ctx, page, errors } = await open();
  await page.evaluate(() => {
    localStorage.setItem("relay-radar-v2", JSON.stringify({ "shopify-v-9": { name: "Jess's Watched Trainers", variant: "UK 5", baseline: 9000, created: new Date().toISOString(), store: "Kick Lane", image: "https://cdn.kicklane.example/t.jpg", now: 8000, cur: "GBP", real: true } }));
    localStorage.setItem("relay-discover-taps-v1", JSON.stringify([{ sku: "shopify-v-9", kind: "trainers" }]));
    localStorage.setItem("relay-discover-notfor-v1", JSON.stringify([{ key: "kick lane|socks" }]));
    localStorage.setItem("relay-discover-seen-v1", JSON.stringify({ "kick lane|cap": { n: 2, day: "2026-11-20" } }));
    localStorage.setItem("relay-discover-personalise-v1", "true");
    localStorage.setItem("relay-market-area", "SW11");
    localStorage.setItem("relay.photo-ok", "1");
  });
  await page.reload(); await homeShows(page, "J");
  await page.evaluate(() => window.go("radar"));
  await page.locator(".wl-card", { hasText: "Jess's Watched Trainers" }).waitFor();
  await openSettings(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.locator(".rl-welcome").first().waitFor();
  const left = await page.evaluate(() => ["relay-radar-v2", "relay-radar-history-v2", "relay-discover-taps-v1", "relay-discover-notfor-v1", "relay-discover-seen-v1", "relay-discover-personalise-v1", "relay-market-area", "relay.photo-ok"].filter(k => localStorage.getItem(k) !== null));
  assert.deepEqual(left, [], "nothing of the member's is left on the phone after signing out");
  // Sam signs in on the same phone (an emailed link), without reloading.
  await page.evaluate(() => localStorage.setItem("relay.signed-out-test", "1"));
  await page.goto(origin + "/index.html#signin=" + "L".repeat(43));
  await homeShows(page, "S");
  await page.evaluate(() => window.go("radar"));
  // Once the shops have answered (trainers included), so this isn't passed just because nothing has drawn yet.
  await page.waitForFunction(() => typeof window.relayNeedCatalog === "function" && window.relayNeedCatalog());
  await page.waitForTimeout(800);
  assert.doesNotMatch(await page.locator("#view").innerText(), /Jess's Watched Trainers/, "Sam never sees what Jess watched");
  // And Jess comes back to her own choice of picks (kept per member, not by her address), with her watches from her account.
  assert.equal(await page.evaluate(() => localStorage.getItem("relay-discover-personalise-v1")), null, "Sam hasn't chosen picks; Jess's choice isn't his");
  assert.doesNotMatch(await page.evaluate(() => localStorage.getItem("relay-discover-personalise-by-v1") || ""), /jess|example\.com/, "Jess's address isn't kept in what's remembered of her choice");
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - signing out and in as someone else leaves nothing of the first member's watches, style or settings");
}
{
  // The same when a sign-in link for someone else is opened without signing out first.
  st = {};
  const { ctx, page, errors } = await open();
  await page.evaluate(() => { localStorage.setItem("relay-radar-v2", JSON.stringify({ "shopify-v-9": { name: "Jess's Watched Trainers", real: true } })); localStorage.setItem("relay-market-area", "SW11"); });
  await page.goto(origin + "/index.html#signin=" + "L".repeat(43));
  await homeShows(page, "S");
  assert.equal(await page.evaluate(() => localStorage.getItem("relay-radar-v2")), null);
  assert.equal(await page.evaluate(() => localStorage.getItem("relay-market-area")), null);
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log("ok - opening someone else's sign-in link without signing out clears the first member's things too");
}
await browser.close(); server.close();
console.log("PASS review fixes: group notes, same purchase by date, honest saves and totals, nothing left for the next member, Wrapped once, drawings that fit (stubbed server)");
