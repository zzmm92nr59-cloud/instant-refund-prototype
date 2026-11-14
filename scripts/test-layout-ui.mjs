// Browser test: the layout every shopper has (index.html with account.js): the Ask tab, the pictures in their tiles, the
// three colour looks, and interests. Stubbed Relay server. Checks:
//  * Ask before anything is asked: no big title and no avatar; the six newest purchases as tiles (newest first, never an
//    "on its way" email), four questions to try, the AI line, what is kept and Talk to a person; the measured sizes;
//    nothing tappable under 44px and no text under 13px, in light and dark;
//  * a tile asks first and names the receipt, then attaches exactly that receipt, and asks Relay's server nothing
//    until a question is sent; the question then goes with that receipt and no other;
//  * a typed question gets "Search your receipts for this instead" under it, which opens Receipts with those words in
//    its search; a question the page offered doesn't; and a chat puts nothing new on the phone;
//  * pictures, with made-up photos and logos (scripts/sample-pictures.mjs) that arrive after the page is drawn, the way
//    Relay's server and the shops' own picture servers send them: every tile is a square; a photo's box lies inside
//    its tile, covers it, and the photo's own middle is at the tile's middle on the screen; a logo lies wholly inside
//    its tile on white (or on the logo's own background colour), with no ring; one item has its name and price beside
//    its square and several have the price on each; on Ask the day is under the tile. In light and dark;
//  * the three colour looks behind look-q, look-n and look-s: look-s on by default; with each, card words at 4.5 to 1;
//  * interests: the sheet "What do you shop for?" shows once, saves once, isn't shown again (nor after Not now); the
//    Profile row shows and changes them; Shops on Relay puts shops of matching kinds first, the normal order otherwise;
//  * the old try-out address, next.html, sends anyone to the app (keeping what came after it), and the service worker
//    fetches it past the browser's own copies, so an old copy of the try-out never shows again.
// (Before the new layout went to everyone, this was scripts/test-layout-preview-ui.mjs, with the team-only gate.)
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { readFileSync } from "node:fs"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
import { samplePictures, MARK_COLOUR, LOGO_GREY } from "./sample-pictures.mjs";
const TYPES = { ".js": "text/javascript", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
// The page server.
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://x").pathname, p = resolve(".", "." + path.replace(/\/$/, "/index.html"));
    const body = await readFile(p);
    res.setHeader("Content-Type", TYPES[extname(p)] || "text/html"); res.end(body);
  } catch { res.statusCode = 404; res.end("not found"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
// Three made-up accounts, told apart by their sign-in: on the team, a shopper, and on the team but needing to sign in again.
const TEAM = "T".repeat(43), SHOPPER = "S".repeat(43), AGAIN = "A".repeat(43);
const EMAILS = { [TEAM]: "ops@example.com", [SHOPPER]: "member@example.com", [AGAIN]: "ops2@example.com" };
const st = { hold: 0, down: false, receipts: false, pictures: false, interests: { ["T".repeat(43)]: ["home"] }, interestPuts: [], shops: false }; // the team account has interests saved until part 15, so the sheet stays out of the way
const asked = []; // every request to Relay's server: which page asked, and for what
const chats = []; // what was sent to the assistant
// Made-up receipts for the Ask page: eight purchases out of date order, and an "on its way" email, which isn't one.
const dayAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const SHOPS = [["Fernhill Outfitters", "fernhill.example", "fashion", "Cord Trousers"], ["Brindle Coffee", "brindle.example", "food", "House Espresso 1kg"], ["Quillon Tech", "quillon.example", "electronics", "USB-C Hub"], ["Ashby Home", "ashbyhome.example", "home", "Desk Lamp"]];
const bought = n => { const sh = SHOPS[n % 4]; return { id: "aaaa000" + n + "-1111-4111-8111-00000000000" + n, status: "confirmed", kind: "receipt", retailer: { name: sh[0], domain: sh[1] }, orderRef: "R-" + (500 + n), orderDate: dayAgo(n), totalPence: 1000 + n * 100, currency: "GBP",
  items: [{ name: sh[3], pricePence: 1000 + n * 100, qty: 1 }], category: sh[2], categoryLabel: sh[2], returnable: true, returns: null, source: "shopper_email", parserVersion: 28 }; };
const RECEIPTS = [5, 2, 8, 1, 7, 3, 6, 4].map(bought).concat([{ ...bought(0), id: "bbbb0001-1111-4111-8111-000000000001", kind: "delivery_update", totalPence: null, items: [] }]);
// Pictures (part 14), drawn by scripts/sample-pictures.mjs with its test marks on. Which made-up shop has which logo (one
// has none, so Relay draws for it), which receipts have a checked photo of the one thing bought, and two shop orders
// whose items come with the shop's own photos: one thing, and three things in the three shapes.
let PICS = {};
const dayAhead = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const LOGOS = { "fernhill.example": "logo-wide", "brindle.example": "logo-white-a", "quillon.example": "logo-grey", "ashbyhome.example": "logo-clear" };
const PHOTOS = { [bought(1).id]: "photo-tall", [bought(2).id]: "photo-square", [bought(3).id]: "photo-wide" };
const LONG_NAME = "A Made-Up Thing With A Name So Long That It Runs On Well Past Three Whole Lines Beside Its Picture On Any Phone";
const pictured = () => RECEIPTS.map(r => { const n = Number(r.id.slice(7, 8)); if (r.kind !== "receipt") return r;
  const x = { ...r, retailer: { ...r.retailer, logoDomain: r.retailer.domain }, hasImage: Boolean(PHOTOS[r.id]), returnBy: { date: dayAhead(2 + n), basis: "policy" } };
  if (n === 5) x.items = [{ ...x.items[0], name: LONG_NAME }];
  if (n === 8) x.items = [{ name: "Wool Throw", pricePence: 6500, qty: 1 }, { name: "Stoneware Mug Set", pricePence: 2800, qty: 1 }, { name: "Desk Lamp", pricePence: 3900, qty: 1 }];
  return x; })
  .concat([{ ...bought(9), id: "aaaa0009-1111-4111-8111-000000000009", retailer: { name: "Larkspur Beauty", domain: "larkspur.example", logoDomain: "larkspur.example" }, items: [{ name: "Hand Balm", pricePence: 900, qty: 1 }], category: "beauty", categoryLabel: "beauty", hasImage: false, returnBy: { date: dayAhead(12), basis: "policy" } }]);
const CDN = "https://pictures.relay-samples.example/";
// Two made-up shops on Relay for part 15: a home shop with three products and a tech shop with two. Their categories are
// the ones the server sends (shopCategory).
const shopItem = (n, store, cat, title, minor) => ({ product: title, variation: "One size", catalogueId: "shopify:" + store + ":variant:" + n, sku: "shopify:" + store + ":variant:" + n, priceMinor: minor, currency: "GBP", provider: "shopify", storeName: store, store, shopDomain: store.toLowerCase().replace(/\W+/g, "-") + ".example", shopCategory: cat, quantity: 5, inStock: true, imageUrl: null });
const SHOP_PRODUCTS = [shopItem(1, "Larch House", "home", "Oak Side Table", 12000), shopItem(2, "Larch House", "home", "Linen Cushion", 2500), shopItem(3, "Larch House", "home", "Stoneware Vase", 3400),
  shopItem(4, "Voltline", "electronics", "USB-C Charger", 2900), shopItem(5, "Voltline", "electronics", "Desk Speaker", 6500)];
const thing = (id, title, minor, pic) => ({ title, lineId: id, quantity: 1, priceMinor: minor, currency: "GBP", variant: "One size", exchangeable: true, returnable: true, productId: id, returnBy: { date: dayAhead(20) }, imageUrl: CDN + pic + ".png" });
const ORDERS = [{ id: "o1", store: "Marlow Lane", retailer: "shopify:marlow-lane.example", orderedAt: new Date(Date.now() - 3 * 864e5).toISOString(), amountMinor: 8500, currency: "GBP", items: [thing("L1", "Court Trainers", 8500, "photo-wide")] },
  { id: "o2", store: "Northfold Supply", retailer: "shopify:northfold.example", orderedAt: new Date(Date.now() - 6 * 864e5).toISOString(), amountMinor: 14300, currency: "GBP", items: [thing("L2", "Waxed Field Jacket", 6400, "photo-tall"), thing("L3", "Enamel Camp Mug", 1400, "photo-square"), thing("L4", "Trail Runner", 6500, "photo-wide")] }];
const stub = async ctx => {
  await ctx.route("https://**/*", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    // A picture is handed over half a second after it is asked for, so it always arrives after the page is drawn.
    const picture = async name => { await new Promise(r => setTimeout(r, 500)); return st.pictures && PICS[name] ? route.fulfill({ status: 200, contentType: "image/png", headers: H, body: PICS[name] }) : route.fulfill({ status: 404, headers: H, body: "" }); };
    if (u.origin + "/" === CDN) return picture(p.slice(1).replace(/\.png$/, ""));
    if (!p.startsWith("/relay/")) return route.abort();
    let from = ""; try { from = new URL(req.frame().url()).pathname; } catch { from = ""; }
    asked.push({ from, method: m, path: p, bookmark: await req.headerValue("x-d1-bookmark") });
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
    const token = ((await req.headerValue("authorization")) || "").replace(/^Bearer /, "");
    if (p.startsWith("/relay/my/logo/")) return st.pictures ? picture(LOGOS[p.split("/").pop()] || "none") : route.fulfill({ status: 404, headers: H, body: "" });
    { const photo = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/image$/.exec(p); if (photo) return picture(PHOTOS[photo[1]] || "none"); }
    if (p === "/relay/my/admin/me") {
      if (st.down) return route.abort();
      if (st.hold) await new Promise(r => setTimeout(r, st.hold));
      return j(token === TEAM ? { admin: true, openReports: 0 } : token === AGAIN ? { admin: false, signInAgain: true } : { admin: false });
    }
    if (p === "/relay/my/admin/review-account") return token === TEAM ? j({ on: false }) : j({ error: "not_found" }, 404);
    if (p === "/relay/auth/logout") return j({ ok: true });
    if (p === "/relay/my/profile") return j({ email: EMAILS[token] || "", name: token === TEAM ? "Ops" : "Member", photo: null });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true, outlookAvailable: true });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAILS[token] || "", others: [] });
    if (p === "/relay/my/receipts") return j({ receipts: st.receipts && token === TEAM ? (st.pictures ? pictured() : RECEIPTS) : [] });
    if (p === "/relay/my/purchases") return j({ purchases: st.pictures && token === TEAM ? ORDERS : [] });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
    if (p === "/relay/my/2fa") return j({ required: true, enrolled: true, verified: true, methods: ["passkey"], app: true, text: false });
    if (p === "/relay/my/phone") return j({ available: false });
    if (p === "/relay/my/card") return j({ enabled: false });
    if (p === "/relay/my/help/chat" && m === "GET") return j({ available: true, handoff: true });
    if (p === "/relay/my/help/chat" && m === "POST") { chats.push(JSON.parse(req.postData() || "{}")); return j({ reply: "A stand-in answer from the test." }); }
    if (p === "/relay/my/auctions") return j({ canBid: true, auctions: [] });
    if (p === "/relay/auctions") return j({ auctions: [] });
    if (p === "/relay/my/interests" && m === "GET") return j({ interests: st.interests[token] || [], updatedAt: null });
    if (p === "/relay/my/interests" && m === "PUT") { const b = JSON.parse(req.postData() || "{}"); st.interestPuts.push(b); st.interests[token] = b.interests; return j({ interests: b.interests, updatedAt: Date.now() }); }
    if (p === "/relay/shopify/catalogue") return j({ published: true, products: st.shops ? SHOP_PRODUCTS : [] });
    return j({});
  });
};
const browser = await chromium.launch();
PICS = await samplePictures(browser, { marks: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await stub(ctx);
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
const pathOf = () => new URL(page.url()).pathname;
const signIn = async token => {
  await page.goto(origin + "/index.html");
  await page.evaluate(([t, e]) => { localStorage.clear(); sessionStorage.clear(); if (t) localStorage.setItem("relay.session.v1", JSON.stringify({ token: t, email: e, expiresAt: 9e12 })); }, [token, EMAILS[token] || ""]);
};
const tabs = () => page.evaluate(() => [...document.querySelectorAll("#foot button")].map(b => (b.getAttribute("aria-label") || b.innerText || "").trim().replace(/\s+/g, " ")));
const profileRows = async () => { await page.locator("#mePage .rl-arow").first().waitFor(); await page.locator("#mePage .rl-arow", { hasText: "Two-step sign-in" }).waitFor(); await page.waitForTimeout(500); };

// Everything tappable under 44px either way, and every bit of text under 13px (capitals may be 12px), on the page as it stands.
const sizes = () => page.evaluate(() => {
  const vis = e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && c.display !== "none" && Number(c.opacity) > 0; };
  const small = [], tiny = new Set();
  for (const e of document.querySelectorAll("#view button, #view a, #view [role=button], #view input, #view textarea, #foot button")) {
    if (!vis(e)) continue; const r = e.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) small.push((e.getAttribute("aria-label") || e.innerText || e.placeholder || e.className).trim().replace(/\s+/g, " ").slice(0, 40) + " " + Math.round(r.width) + "x" + Math.round(r.height));
  }
  const walk = document.createTreeWalker(document.querySelector("#view"), NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { const e = n.parentElement; if (!n.textContent.trim() || !e || !vis(e) || e.closest(".rl-sr")) continue;
    const c = getComputedStyle(e), px = parseFloat(c.fontSize); if (px < 13 && !(c.textTransform === "uppercase" && px >= 12)) tiny.add(n.textContent.trim().slice(0, 30) + " " + px); }
  return { small, tiny: [...tiny] };
});
const bothSchemes = async what => { for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(120); assert.deepEqual(await sizes(), { small: [], tiny: [] }, what + ": nothing tappable under 44px, no text under 13px (" + scheme + ")"); } await page.emulateMedia({ colorScheme: "light" }); };
const dayWords = d => page.evaluate(d => { const t = new Date(d), o = { day: "numeric", month: "short" }; if (t.getFullYear() !== new Date().getFullYear()) o.year = "numeric"; return t.toLocaleDateString("en-GB", o); }, d);
const openAsk = async () => {
  await page.goto(origin + "/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#foot button").length === 4);
  await page.evaluate(() => window.tabTap("ask"));
  await page.locator("#askPage .rl-ask-q").first().waitFor();
};
const box = sel => page.locator(sel).first().evaluate(e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return { x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom, radius: c.borderRadius, font: c.fontSize, weight: c.fontWeight }; });
const newest = [1, 2, 3, 4, 5, 6].map(bought);

// 10. Before anything is asked.
st.receipts = true;
await signIn(TEAM);
await openAsk();
await page.locator(".rl-ask-tile").first().waitFor();
assert.deepEqual(await page.locator("#view h1").evaluate(e => [e.innerText.trim(), e.getBoundingClientRect().width <= 1]), ["Ask", true], "the page's name is there for screen readers only: no big title");
assert.equal(await page.locator(".topline .avatar").isVisible(), false, "no avatar on Ask");
assert.equal((await page.locator(".rl-ask-hb").innerText()).trim(), "Ask about a receipt");
assert.deepEqual(await page.locator(".rl-ask-tile").evaluateAll(ts => ts.map(t => t.getAttribute("data-receipt"))), newest.map(r => r.id), "the six newest purchases, newest first, and never the 'on its way' email");
assert.equal(await page.locator(".rl-ask-tile").first().getAttribute("aria-label"), "Ask about your receipt from " + newest[0].retailer.name + ", " + await dayWords(newest[0].orderDate));
assert.equal((await page.locator(".rl-ask-tile .rl-ask-day").first().innerText()).trim(), await dayWords(newest[0].orderDate), "each tile has the day it was bought under it");
assert.equal((await page.locator(".rl-ask-h2").innerText()).trim(), "Try asking");
assert.deepEqual(await page.locator(".rl-ask-q").evaluateAll(qs => qs.map(q => q.innerText.trim())), ["How do I return something?", "How does a swap work?", "Why is a receipt missing?", "How does Relay find my receipts?"], "the same four questions, with no second line");
assert.equal((await page.locator(".rl-ask-ai").innerText()).trim(), "Relay's assistant is an AI, so it can get things wrong.");
assert.ok(await page.locator(".rl-ask-ai").isVisible(), "the AI line shows before anything is asked");
assert.match(await page.locator("#askPage .rl-anote").innerText(), /^Relay keeps no copy of this chat\. Your messages go to Anthropic/, "what is kept is still said");
assert.ok(await page.locator("#askPage .rl-chat-person", { hasText: "Talk to a person" }).isVisible(), "Talk to a person is still there");
assert.equal(await page.locator("#askPage .rl-chat-in").getAttribute("placeholder"), "Search receipts or ask about Relay");
assert.equal(await page.locator("#askPage .rl-chat-about, #askPage .rl-chat-b").count(), 0, "no earlier chat is listed or shown");
// The measured arrangement.
{ const t0 = await box(".rl-ask-sq"), t1 = await page.locator(".rl-ask-tile").nth(1).evaluate(e => e.getBoundingClientRect().left);
  assert.deepEqual([t0.w, t0.h, t0.radius, t1 - (t0.x + t0.w)], [115, 115, "24px", 8], "tiles are 115px squares with a 24px corner, 8px apart");
  const h = await box(".rl-ask-h2"), chev = await box(".rl-ask-chev"), row = await box(".rl-ask-q"), pic = await box(".rl-ask-qi"), words = await box(".rl-ask-q b");
  assert.deepEqual([h.font, h.weight, chev.w, chev.h], ["20px", "700", 20, 20], "headings are 20px bold; the round chevron is 20px");
  assert.deepEqual([row.h, pic.w, pic.h, pic.radius, words.font], [64, 48, 48, "12px", "16px"], "a question is a 64px row with a 48px tile and 16px words");
  const bar = await box("#askPage .rl-chat-bar"), field = await box("#askPage .rl-chat-in"), send = await box("#askPage .rl-chat-send"), ring = await box("#askPage .rl-chat-send .rl-jic"), foot = await box("#foot");
  assert.deepEqual([bar.h, bar.radius, field.font, ring.w, ring.h], [56, "28px", "16px", 40, 40], "the box is one 56px pill with 16px words and a 40px round send button");
  assert.ok(send.w >= 44 && send.h >= 44 && field.h >= 44, "the send button and the field are still 44px to tap");
  assert.equal(Math.round(foot.y - bar.bottom), 16, "the box rests 16px above the tab bar");
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), 0, "with room to spare the page doesn't scroll"); }
await bothSchemes("Ask before anything is asked");
await page.screenshot({ path: "/tmp/shots/layout-preview-ask-open.png" });
console.log("ok - Ask before anything is asked: newest receipts as tiles, four questions, the AI line, the measured sizes");

// 11. A tile: asks first and names the receipt, attaches exactly that one, and nothing goes anywhere until a question is sent.
{ const pick = newest[2], label = pick.retailer.name + ", " + await dayWords(pick.orderDate), n0 = asked.length, c0 = chats.length;
  await page.locator('.rl-ask-tile[data-receipt="' + pick.id + '"]').dblclick(); // a double tap asks once
  const sheet = page.locator(".rl-sheet").last();
  await sheet.getByRole("button", { name: "Show it" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Show it" }).count(), 1, "a double tap on a tile opens one sheet");
  assert.match(await sheet.innerText(), new RegExp("^Show Relay's assistant your receipt from " + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\? It sees what Relay read from it \\(the shop, date, total, items and return date\\), not the email itself\\."), "the sheet names the receipt and says what the assistant will see");
  assert.equal(await page.locator(".rl-chat-about").count(), 0, "nothing is attached until Show it");
  await sheet.getByRole("button", { name: "Show it" }).click();
  await page.locator(".rl-chat-about").waitFor();
  assert.equal((await page.locator(".rl-chat-about span").first().innerText()).trim(), "About your receipt from " + label, "Ask opens with that receipt attached");
  assert.equal(await page.locator("#askPage .rl-chat-in").getAttribute("placeholder"), "Ask about this receipt");
  await page.waitForTimeout(600);
  assert.deepEqual(asked.slice(n0), [], "tapping a tile and showing the receipt asks Relay's server nothing");
  assert.equal(chats.length, c0, "nothing is sent to the assistant until a question is");
  await bothSchemes("Ask with a receipt attached");
  await page.locator(".rl-chat-chips button", { hasText: "The total is wrong" }).click();
  await page.locator(".rl-chat-b.bot", { hasText: "A stand-in answer from the test." }).waitFor();
  assert.deepEqual(chats.slice(c0), [{ messages: [{ role: "user", text: "The total is wrong" }], receiptId: pick.id }], "the question goes with that receipt, and only that one");
  assert.equal(await page.locator(".rl-ask-find").count(), 0, "a question about a receipt isn't offered as a search");
  await page.getByRole("button", { name: "Stop showing it" }).click();
  assert.equal(await page.locator("#askPage .rl-chat-in").getAttribute("placeholder"), "Search receipts or ask about Relay"); }
console.log("ok - a tile asks first, attaches exactly that receipt, and sends nothing until a question is sent");

// 12. A typed question: sent to the assistant as today, and the same words can be looked for in Receipts instead.
{ await openAsk();
  const keys0 = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).sort()), c0 = chats.length;
  await page.locator("#askPage .rl-chat-in").fill("brown cord trousers");
  await page.locator("#askPage .rl-chat-send").click();
  await page.locator(".rl-chat-b.bot", { hasText: "A stand-in answer from the test." }).waitFor();
  assert.deepEqual(chats.slice(c0), [{ messages: [{ role: "user", text: "brown cord trousers" }] }], "the question goes to the assistant with no receipt");
  const find = page.locator(".rl-chat-b.me .rl-ask-find");
  assert.equal(await find.count(), 1, "one control, under the shopper's own message");
  const look = await find.evaluate(e => { const c = getComputedStyle(e), probe = document.createElement("span"); probe.style.color = "var(--rl-accent)"; document.body.appendChild(probe); const accent = getComputedStyle(probe).color; probe.remove();
    return { text: e.innerText.trim(), tall: e.getBoundingClientRect().height >= 44, accent: c.color === accent, underline: c.textDecorationLine, font: c.fontSize }; });
  assert.deepEqual(look, { text: "Search your receipts for this instead", tall: true, accent: true, underline: "none", font: "15px" }, "quiet: accent colour, no underline, 44px to tap");
  assert.ok(await page.locator("#askPage .rl-chat-person", { hasText: "Talk to a person" }).isVisible() && /^Relay keeps no copy of this chat/.test(await page.locator("#askPage .rl-anote").innerText()), "Talk to a person and what is kept are still there once a chat is under way");
  await bothSchemes("Ask after a question");
  await page.screenshot({ path: "/tmp/shots/layout-preview-ask-sent.png" });
  // A second typed question: the control moves to the newest one.
  await page.locator("#askPage .rl-chat-in").fill("tall desk lamp"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("#askPage .rl-chat-b.bot").length === 3);
  assert.deepEqual(await page.locator(".rl-chat-b.me").evaluateAll(bs => bs.map(b => [b.querySelector("p").innerText, Boolean(b.querySelector(".rl-ask-find"))])), [["brown cord trousers", false], ["tall desk lamp", true]], "only the newest typed question carries it");
  // Nothing about the chat is put on the phone.
  const keys1 = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).sort());
  assert.deepEqual(keys1.filter(k => !keys0.includes(k)), [], "a chat adds nothing to what the phone keeps");
  assert.equal(await page.evaluate(() => Object.values(localStorage).concat(Object.values(sessionStorage)).some(v => /brown cord trousers|tall desk lamp|stand-in answer/i.test(String(v)))), false, "no copy of the chat is kept on the phone");
  await Promise.all([page.locator("#receiptsPage").waitFor(), find.click()]);
  assert.equal(await page.getByRole("searchbox", { name: "Search your receipts" }).inputValue(), "tall desk lamp", "Receipts opens with those words in its search");
  assert.equal(await page.locator('#foot button[aria-current="page"]').getAttribute("data-tab"), "receipts", "on the Receipts tab"); }
console.log("ok - a typed question can be looked for in Receipts instead, and a chat puts nothing on the phone");

// 13. A question the page offered is sent as it is, with no search under it; the heading's chevron opens Receipts.
{ await openAsk(); const c0 = chats.length;
  await page.locator(".rl-ask-q", { hasText: "How does a swap work?" }).dblclick(); // a double tap asks once
  await page.locator(".rl-chat-b.bot", { hasText: "A stand-in answer from the test." }).waitFor();
  await page.waitForTimeout(400);
  assert.deepEqual(chats.slice(c0), [{ messages: [{ role: "user", text: "How does a swap work?" }] }], "an offered question is sent once, even on a double tap");
  assert.equal(await page.locator(".rl-ask-find").count(), 0, "an offered question isn't offered as a search");
  await openAsk();
  await Promise.all([page.locator("#receiptsPage").waitFor(), page.locator(".rl-ask-hb").click()]);
  // With no receipts the block is left out and the questions come first.
  st.receipts = false;
  await openAsk();
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".rl-ask-tile").count(), 0, "no receipts, no tiles");
  assert.equal(await page.locator(".rl-ask-hb").isVisible(), false, "and no heading for them");
  assert.ok(await page.locator(".rl-ask-h2", { hasText: "Try asking" }).isVisible());
  await bothSchemes("Ask with no receipts"); }
console.log("ok - an offered question has no search under it; the heading opens Receipts; with no receipts the block is left out");

// 14. Pictures: photos and logos in their tiles, on Home and on Ask.
{ st.receipts = true; st.pictures = true;
  // Every picture box on the page: its tile, what kind of picture is in it, where the picture shows (an image fitted
  // whole shows smaller than its box), and how much of the tile it covers.
  const tiles = sel => page.evaluate(sel => [...document.querySelectorAll(sel)].map(t => {
    const r = t.getBoundingClientRect(), art = t.querySelector(".h2-art") || t, img = art.querySelector("img"), inner = img || art.querySelector("svg"); if (!inner) return { kind: "empty" };
    const b = inner.getBoundingClientRect(), look = img ? getComputedStyle(img) : null; let s = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    if (img && look.objectFit === "contain" && img.naturalWidth) { const k = Math.min(b.width / img.naturalWidth, b.height / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k; s = { left: b.left + (b.width - w) / 2, top: b.top + (b.height - h) / 2, right: b.left + (b.width + w) / 2, bottom: b.top + (b.height + h) / 2 }; }
    const ix = Math.max(0, Math.min(s.right, r.right) - Math.max(s.left, r.left)), iy = Math.max(0, Math.min(s.bottom, r.bottom) - Math.max(s.top, r.top)), back = getComputedStyle(art);
    return { kind: !img ? "drawing" : img.classList.contains("rl-logo-img") ? "logo" : "photo", w: r.width, h: r.height, radius: getComputedStyle(t).borderRadius, covers: Math.round(100 * ix * iy / (r.width * r.height)),
      inside: s.left >= r.left - .5 && s.top >= r.top - .5 && s.right <= r.right + .5 && s.bottom <= r.bottom + .5, margin: Math.round(Math.min(s.left - r.left, s.top - r.top, r.right - s.right, r.bottom - s.bottom)),
      fit: look && look.objectFit, at: look && look.objectPosition, back: back.backgroundColor, ring: back.boxShadow, loaded: !img || (img.complete && img.naturalWidth > 0), price: Boolean(t.querySelector(".h2-price")) }; }), sel);
  // The colour on the screen at the middle of an element (it is scrolled to the middle of the screen first).
  const middle = async loc => { await loc.evaluate(e => e.scrollIntoView({ block: "center", inline: "center" })); await page.waitForTimeout(120);
    const r = await loc.evaluate(e => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    const shot = await page.screenshot({ clip: { x: Math.round(r.x) - 1, y: Math.round(r.y) - 1, width: 3, height: 3 } });
    return page.evaluate(async b64 => { const im = new Image(); im.src = "data:image/png;base64," + b64; await im.decode(); const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const g = c.getContext("2d"); g.drawImage(im, 0, 0); return [...g.getImageData(im.width >> 1, im.height >> 1, 1, 1).data].slice(0, 3); }, shot.toString("base64")); };
  const marked = c => Math.abs(c[0] - MARK_COLOUR[0]) + Math.abs(c[1] - MARK_COLOUR[1]) + Math.abs(c[2] - MARK_COLOUR[2]) < 60;
  const WHITE = "rgb(255, 255, 255)", GREY = "rgb(" + LOGO_GREY.join(", ") + ")";
  const sitRight = (list, side, radius, where) => {
    for (const t of list) {
      assert.deepEqual([t.w, t.h, t.radius], [side, side, radius], where + ": every tile is a " + side + "px square");
      if (t.kind === "photo") assert.ok(t.inside && t.covers >= 80 && t.fit === "cover" && t.at === "50% 50%", where + ": a photo's box lies inside its tile, covers it and is centred " + JSON.stringify(t));
      if (t.kind === "logo") { assert.ok(t.inside && t.margin >= 12 && t.fit === "contain", where + ": a logo lies wholly inside its tile with room around it " + JSON.stringify(t));
        assert.ok((t.back === WHITE || t.back === GREY) && t.ring === "none", where + ": a logo sits on white, or on its own background colour, with no ring " + JSON.stringify(t)); }
    }
  };

  await page.goto(origin + "/index.html");
  await page.locator("#foot button").first().waitFor();
  await page.locator(".h2-feed .h2-pic").first().waitFor();
  assert.equal(await page.evaluate(() => [...document.querySelectorAll(".h2-feed img")].filter(i => i.complete && i.naturalWidth).length), 0, "the page is drawn before any picture has arrived");
  // "To return" lists every one of them (For you stops at eight cards).
  await page.locator(".h2-chip", { hasText: "To return" }).click();
  await page.waitForFunction(() => { const all = [...document.querySelectorAll(".h2-feed .h2-pic img")]; return all.length >= 11 && all.every(i => i.complete && i.naturalWidth) && document.querySelectorAll(".h2-feed .h2-logo.rl-has-logo").length >= 7; }, null, { timeout: 30000 });
  await page.waitForTimeout(700); // the shop with no logo has had its answer too, and has its drawing
  // The pinned top row and the tab bar are put aside for this part, so nothing lies over a tile's middle.
  await page.addStyleTag({ content: ".h2-band,#foot{visibility:hidden!important}html{scroll-snap-type:none!important}" });
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150);
    const home = await tiles(".h2-feed .h2-pic");
    assert.deepEqual([home.filter(t => t.kind === "photo").length, home.filter(t => t.kind === "logo").length, home.filter(t => t.kind === "drawing").length, home.filter(t => t.kind === "empty" || !t.loaded).length], [7, 4, 4, 0],
      "Home (" + scheme + "): three checked photos, a shop order's one photo and another's three; four logos; one receipt's three drawings and one for the shop with no logo");
    sitRight(home, 140, "22px", "Home (" + scheme + ")");
    assert.deepEqual(home.filter(t => t.kind === "logo").map(t => t.back).sort(), [GREY, WHITE, WHITE, WHITE].sort(), "Home (" + scheme + "): the logo with its own pale grey sits on that grey; the others, the see-through one too, on white");
    // On the screen: the photo's own middle is at the tile's middle (it was far below the tile).
    const photos = page.locator(".h2-feed .h2-pic:has(img:not(.rl-logo-img))");
    for (let i = 0; i < await photos.count(); i++) assert.ok(marked(await middle(photos.nth(i))), "Home (" + scheme + "): photo " + (i + 1) + " shows its own middle at the middle of its tile");
    // The header's logo: a circle in the logo's own white or grey, no ring, the logo whole inside it.
    const heads = await page.locator(".h2-feed .h2-logo.rl-has-logo").evaluateAll(cs => cs.map(c => { const r = c.getBoundingClientRect(), i = c.querySelector("img").getBoundingClientRect(), look = getComputedStyle(c), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return { back: look.backgroundColor, ring: look.boxShadow, round: look.borderRadius, whole: [[i.left, i.top], [i.right, i.top], [i.left, i.bottom], [i.right, i.bottom]].every(p => Math.hypot(p[0] - cx, p[1] - cy) <= r.width / 2 + .5) }; }));
    assert.ok(heads.length >= 7 && heads.every(h => (h.back === WHITE || h.back === GREY) && h.ring === "none" && h.round === "50%" && h.whole), "Home (" + scheme + "): each header logo is whole inside a white (or its own colour) circle with no ring " + JSON.stringify(heads.filter(h => !h.whole || h.ring !== "none")));
    // One thing: its square, then its name (three lines at most) and price beside it, and no price on the picture.
    const ones = await page.locator(".h2-feed .h2-one").evaluateAll(os => os.map(o => { const pic = o.querySelector(".h2-pic").getBoundingClientRect(), n = o.querySelector(".h2-one-n"), pr = o.querySelector(".h2-one-p"), nl = getComputedStyle(n), pl = pr && getComputedStyle(pr);
      return { beside: n.getBoundingClientRect().left >= pic.right + 8 && n.getBoundingClientRect().top >= pic.top - 1 && n.getBoundingClientRect().bottom <= pic.bottom + 1, name: nl.fontSize, lines: Math.round(n.getBoundingClientRect().height / parseFloat(nl.lineHeight)), price: pl && [pl.fontSize, pl.fontWeight], pill: Boolean(o.querySelector(".h2-price")), long: n.textContent.length > 80 }; }));
    assert.ok(ones.length >= 8 && ones.every(o => o.beside && o.name === "16px" && o.lines <= 3 && !o.pill && o.price && o.price[0] === "16px" && o.price[1] === "600"), "Home (" + scheme + "): one thing has its name and price beside its square, 16px, and no price on the picture " + JSON.stringify(ones.filter(o => !o.beside || o.lines > 3)));
    assert.ok(ones.some(o => o.long && o.lines === 3), "Home (" + scheme + "): a very long name stops at three lines");
    // Several things: a row of squares with the price on each, and the name under the row.
    const rows = await page.locator(".h2-feed .h2-tiles").evaluateAll(rs => rs.map(r => ({ squares: r.querySelectorAll(".h2-pic").length, priced: r.querySelectorAll(".h2-pic .h2-price").length, name: Boolean(r.nextElementSibling && r.nextElementSibling.classList.contains("h2-name")) })));
    assert.deepEqual(rows, [{ squares: 3, priced: 3, name: true }, { squares: 3, priced: 3, name: true }], "Home (" + scheme + "): several things are squares in a row with the price on each and the name under them");
    assert.deepEqual(await sizes(), { small: [], tiny: [] }, "Home with pictures: nothing tappable under 44px, no text under 13px (" + scheme + ")");
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: "/tmp/shots/layout-preview-home-pictures.png" });
  // The three colour looks (look-q, look-n, look-s): none is on by default, and with each, in light and dark, every
  // card's words read at 4.5 to 1 or better on the card's own colour, and the pictures still sit right.
  assert.deepEqual(await page.evaluate(() => [...document.documentElement.classList].filter(c => /^look-/.test(c))), ["look-s"], "the softer colours (look-s) are on by default");
  await page.evaluate(() => document.documentElement.classList.remove("look-s"));
  const lowest = () => page.evaluate(() => { const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true }), px = () => [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const L = a => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }; return .2126 * f(a[0]) + .7152 * f(a[1]) + .0722 * f(a[2]); };
    let low = 99;
    for (const card of document.querySelectorAll(".h2-feed .h2-card")) { const bgc = getComputedStyle(card).backgroundColor; c.fillStyle = "#000"; c.fillRect(0, 0, 1, 1); c.fillStyle = bgc; c.fillRect(0, 0, 1, 1); const bg = px();
      for (const e of card.querySelectorAll(".h2-head-t b, .h2-head-t span, .h2-line-t b, .h2-line-t span, .h2-one-n, .h2-one-p, .h2-name")) { c.fillStyle = bgc; c.fillRect(0, 0, 1, 1); c.fillStyle = getComputedStyle(e).color; c.fillRect(0, 0, 1, 1); const a = L(px()), b = L(bg); low = Math.min(low, (Math.max(a, b) + .05) / (Math.min(a, b) + .05)); } }
    return Math.round(low * 100) / 100; });
  for (const look of ["q", "n", "s"]) {
    await page.evaluate(l => document.documentElement.classList.add("look-" + l), look);
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(120);
      const low = await lowest();
      assert.ok(low >= 4.5, "look " + look + " (" + scheme + "): every card's words read at 4.5 to 1 or better, lowest " + low);
      sitRight(await tiles(".h2-feed .h2-pic"), 140, "22px", "look " + look + " (" + scheme + ")");
    }
    await page.evaluate(l => document.documentElement.classList.remove("look-" + l), look);
  }
  await page.evaluate(() => document.documentElement.classList.add("look-s"));
  await page.emulateMedia({ colorScheme: "light" });

  // Ask: the same rules at 115px, and the day under the tile, never on it.
  await page.evaluate(() => window.tabTap("ask"));
  await page.locator(".rl-ask-sq").first().waitFor();
  await page.waitForFunction(() => { const all = [...document.querySelectorAll(".rl-ask-sq img")]; return all.length === 6 && all.every(i => i.complete && i.naturalWidth); }, null, { timeout: 30000 });
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150);
    const ask = await tiles(".rl-ask-sq");
    assert.deepEqual(ask.map(t => t.kind), ["photo", "photo", "photo", "logo", "logo", "logo"], "Ask (" + scheme + "): the three newest have photos, the next three logos");
    sitRight(ask, 115, "24px", "Ask (" + scheme + ")");
    const photos = page.locator(".rl-ask-sq:has(img:not(.rl-logo-img))");
    for (let i = 0; i < 3; i++) assert.ok(marked(await middle(photos.nth(i))), "Ask (" + scheme + "): photo " + (i + 1) + " shows its own middle at the middle of its tile");
    const days = await page.locator(".rl-ask-tile").evaluateAll(ts => ts.map(t => { const sq = t.querySelector(".rl-ask-sq").getBoundingClientRect(), d = t.querySelector(".rl-ask-day"), r = d.getBoundingClientRect(); return { under: r.top >= sq.bottom, font: getComputedStyle(d).fontSize, text: d.innerText.trim().length > 0, onPicture: Boolean(t.querySelector(".rl-ask-sq .rl-ask-day")) }; }));
    assert.ok(days.every(d => d.under && d.font === "13px" && d.text && !d.onPicture), "Ask (" + scheme + "): the day is a 13px line under the tile and never over the picture");
    assert.deepEqual(await sizes(), { small: [], tiny: [] }, "Ask with pictures: nothing tappable under 44px, no text under 13px (" + scheme + ")");
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: "/tmp/shots/layout-preview-ask-pictures.png" });
  st.pictures = false; }
// 15. Interests: asked once, saved, not asked again; Profile shows them; Browse puts matching shops first.
{ st.interests = {}; st.interestPuts = []; st.shops = true; st.receipts = false; st.pictures = false;
  await signIn(TEAM);
  await page.goto(origin + "/index.html");
  const sheet = page.locator(".rl-int-sheet");
  await sheet.waitFor({ timeout: 15000 });
  assert.equal((await sheet.locator(".rl-int-h").innerText()).trim(), "What do you shop for?");
  assert.match(await sheet.innerText(), /Pick a few and Relay shows shops you'll like first\./);
  assert.equal(await sheet.locator(".rl-int").count(), 12, "twelve interests");
  assert.equal(await sheet.locator(".rl-int-save").isDisabled(), true, "Save waits until one is chosen");
  await sheet.locator('.rl-int[data-interest="tech"]').click();
  await sheet.locator('.rl-int[data-interest="home"]').click();
  await page.waitForTimeout(500); // (two taps within 400ms count as one: the app's double-tap guard)
  await sheet.locator('.rl-int[data-interest="home"]').click(); // tap again to undo
  await sheet.locator('.rl-int[data-interest="gaming"]').click();
  assert.deepEqual(await sheet.locator('.rl-int[aria-pressed="true"]').evaluateAll(bs => bs.map(b => b.getAttribute("data-interest"))), ["tech", "gaming"]);
  for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(120);
    const m = await sheet.evaluate(sh => { const out = { small: [], tiny: [] }; for (const b of sh.querySelectorAll("button")) { const r = b.getBoundingClientRect(); if (r.height < 43.5) out.small.push(b.innerText.trim() + " " + r.height); }
      for (const e of sh.querySelectorAll("*")) { if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue; const f = parseFloat(getComputedStyle(e).fontSize); if (f < 13) out.tiny.push(e.textContent.trim() + " " + f); } return out; });
    assert.deepEqual(m, { small: [], tiny: [] }, "the sheet: nothing tappable under 44px, no text under 13px (" + scheme + ")"); }
  await page.emulateMedia({ colorScheme: "light" });
  await sheet.locator(".rl-int-save").dblclick(); // a double tap saves once
  await sheet.waitFor({ state: "detached" });
  await page.waitForTimeout(400);
  assert.deepEqual(st.interestPuts, [{ interests: ["tech", "gaming"] }], "saved once, with what was chosen");
  // Opening the new layout again doesn't ask again.
  await page.goto(origin + "/index.html"); await page.waitForTimeout(2500);
  assert.equal(await page.locator(".rl-int-sheet").count(), 0, "not asked again once saved");
  // Profile shows them, and can change them.
  await page.locator(".h2-me").click();
  const row = page.locator('#mePage [data-row="interests"]'); await row.waitFor();
  assert.equal((await row.innerText()).replace(/\s+/g, " ").trim(), "Your interests Tech and Games and apps", "the Profile row says what was chosen");
  await row.click();
  await page.locator('#mePage .rl-int[data-interest="travel"]').click();
  await page.locator("#mePage .rl-int-save").click();
  await page.locator('#mePage [data-row="interests"]').waitFor();
  assert.equal((await page.locator('#mePage [data-row="interests"]').innerText()).replace(/\s+/g, " ").trim(), "Your interests Tech, Games and apps and 1 more");
  assert.deepEqual(st.interestPuts[1], { interests: ["tech", "gaming", "travel"] });
  // Browse: Shops on Relay puts the tech shop first; the shop chips too.
  const order = async () => { await page.evaluate(() => { window.go("discover"); window.dcShow("shops"); }); await page.locator("#catalogResults [data-card-select]").first().waitFor(); await page.waitForTimeout(400);
    return page.locator("#catalogResults [data-card-select]").evaluateAll(cs => cs.map(c => /Larch House|Voltline/.exec(c.getAttribute("aria-label") || "")[0])); };
  assert.deepEqual(await order(), ["Voltline", "Voltline", "Larch House", "Larch House", "Larch House"], "shops matching the interests come first");
  // Nothing matching: the normal order (the shops mixed, the one with more products first).
  st.interests[TEAM] = ["travel"]; await page.evaluate(() => localStorage.removeItem("relay.interests.v1"));
  await page.goto(origin + "/index.html"); await page.locator("#foot button").first().waitFor();
  assert.deepEqual(await order(), ["Larch House", "Voltline", "Larch House", "Voltline", "Larch House"], "nothing matching: the normal order");
  // Another account on this phone, with none saved: "Not now" means it isn't shown again on this phone.
  st.interests[TEAM] = [];
  await signIn(TEAM); await page.goto(origin + "/index.html");
  await page.locator(".rl-int-sheet").waitFor({ timeout: 15000 });
  await page.locator(".rl-int-later").click(); await page.locator(".rl-int-sheet").waitFor({ state: "detached" });
  await page.goto(origin + "/index.html"); await page.waitForTimeout(2500);
  assert.equal(await page.locator(".rl-int-sheet").count(), 0, "after Not now it isn't shown again on this phone");
  assert.equal(st.interestPuts.length, 2, "Not now saves nothing");
  st.shops = false; }
console.log("ok - interests: asked once, saved once, not asked again; Profile shows and changes them; Shops on Relay puts matching shops first, normal order when nothing matches");
console.log("ok - pictures: photos fill their squares with their middle in the middle, logos sit whole on white with no ring, one thing has its name and price beside it, in light and dark");
assert.deepEqual(errors, [], "no script errors");

// 16. next.html, the old try-out address: anyone is sent to the app, keeping what came after it, and the service worker
//     fetches it past the browser's own copies (so an old copy of the gated try-out never shows again).
const sw = readFileSync("sw.js", "utf8");
assert.ok(sw.includes("if (/\\/next\\.html$/.test(url.pathname)) {") && sw.includes('event.respondWith(fetch(req.url, { cache: "no-store" })'), "next.html is fetched past the browser's own copies");
assert.ok(!/SHELL = \[[^\]]*next/.test(sw), "and isn't in the list kept for use with no connection");
assert.ok(!(await readFile("account-next.js").then(() => true, () => false)), "the try-out's own account-next.js is gone");
await signIn(SHOPPER);
await page.goto(origin + "/next.html?x=1#open=receipts");
await page.waitForURL(u => new URL(u).pathname === "/" || new URL(u).pathname === "/index.html", { timeout: 15000 });
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
assert.equal(await page.evaluate(() => window.page), "receipts", "the link after it still opens Receipts");
assert.equal(new URL(page.url()).search, "?x=1", "and what came after the address is kept");
assert.equal(await page.locator("html.rl-gate").count(), 0, "no gate");
console.log("ok - next.html sends anyone to the app, keeping the link, and is never kept by the service worker");
assert.deepEqual(errors, [], "no script errors");
await ctx.close();

await browser.close(); server.close();
console.log("PASS the layout for everyone: its Ask tab, pictures in their tiles, the three looks, interests, and the old next.html address (stubbed server)");
