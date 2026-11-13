// Browser test: shops' auctions in the app. Stubbed Relay server, made-up person, shop and products; nothing reaches a shop.
// Checks: Browse's Auctions door says how many are live (and nothing when none are); the Auctions page lists them as one-tap cards with the
// price and time left; an auction's page has its photos, condition, price, bids and delivery; bidding asks for delivery
// details first (then carries on), says plainly when a bid is too low, sends one bid for a double tap, and says whether you're
// winning; Your bids puts a win to pay for first, with the shop's own link to pay; Your bids says how many to pay for, and
// a win to pay for is a red number on the Home tab; a link from a notification opens the auction. Passes the polish rules
// in light and dark, at phone size.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com";
const A1 = "11111111-2222-4333-8444-555555555555", A2 = "66666666-7777-4888-8999-000000000000", A3 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const now = Date.now();
const auction = (id, o) => ({ id, shop: "Hollow Pine", title: "Wool Beanie", variant: "Navy", size: null, description: null, condition: "new_tags", conditionText: "New with tags",
  fromCatalogue: true, pictures: ["/relay/auctions/" + id + "/photos/1"], startMinor: 1000, priceMinor: null, nextMinor: 1000, bids: 0, deliveryMinor: 395, currency: "GBP",
  endsAt: now + 3 * 3600e3 + 5 * 60e3, status: "live", ...o });
// A small drawn picture (a navy knit on sand) for the photos.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAPAAAADwCAIAAACxN37FAAAC6klEQVR42u3dwUkDYRSFUWfIVgSbsgoLsQILsQoLSQHZZSWIgrhzGxARf/3jzc05S0GQmY/nCzx02e+2F9Bi9QgQNAgaBA2CRtAgaBA0CBoEjaBB0CBoEDQIGkGDoEHQIGgQNIIGQYOgQdAgaAQNggZBg6BB0AgaBA2CBkGDoBE0CBoEDYLmvG08gqlubu8/f/Hx4c6TmWTxjzeP1rGyBV2bsqzt0J01D38XJnRcyka1CV1bs1EtaBB06ng2pAXdVrOmBQ2Cjh+lhrSgQdAImuNsBbYOQYOgETQIGgQNgkbQ/Njs22W30YIGQSNoZm8F9g1Bg6AjR6nxLOieptUsaBB05JA2nn/PH5r5S8NHzFIW9JSw/G4RtIL1LWgdK1vQUpZ1YdBSlnVJ0FKW9bdWNdP0/FdPk6a3kL5ySNn60TOh1ey99AStZk33BK1mTfcErWZN93woPHxGl1fXosn08vyU+RnRPTRVsoK2bFg8elYONZ+0kMVjVTNNb9AOjR3aeCb1PZrQmNDGM6lv04TGhDaeSX2nJjRVNsk/nFuOWIe3HFYO+4atw8oBp75yxP5eI5YJjaBB0D4R+lxoQoOgETQIGgQNM7nlYIRbDhA0NK0cbjkwoRE0CBoEDYIGQSNoEDQkccvBCLccIGhoWjnccmBCI2gQNAgaBA2CRtAgaEjiloMRbjlA0NC0crjlwIRG0CBoEDQIGgSNoEHQkMQtByPccoCgoWnlcMuBCY2gQdAgaBA0CBpBg6AhiVsORrjlAEFD08rhlgMTGhP6P7y/vXr6mNAgaAQNggZBg6BB0AgaBA2CBkGDoBE0CBoEDYIGQSNoEDQIGgQNgkbQIGgQNAgaQYOgQdAgaBA0ggZBg6BB0CBoBA2CBkGDoOFLy3639RQwoUHQIGgQNIIGQYOgQdAgaAQNggZBg6BB0AgaBA2CBkGDoBE0CBoEDYIGQSNoEDQIGgQNgkbQIGgQNAgaBI2gQdAgaBA0Z+wDxna6tBW0HmMAAAAASUVORK5CYII=", "base64");
const st = {
  live: [auction(A1, { priceMinor: 3100, nextMinor: 3200, bids: 4 }),
    auction(A2, { title: "Sample wax jacket", variant: null, size: "M", condition: "sample", conditionText: "Sample", fromCatalogue: false, description: "Worn once at a shoot.\nSmall mark on the cuff.",
      pictures: ["/relay/auctions/" + A2 + "/photos/1", "/relay/auctions/" + A2 + "/photos/2"], startMinor: 2500, nextMinor: 2500, deliveryMinor: 0, endsAt: now + 2 * 864e5 + 3600e3 })],
  mine: [], canBid: true, why: null, delivery: null, bids: [], bidAnswer: null, deliverySaves: 0
};
const browser = await chromium.launch();
// (SHOTS=<folder>: pictures of slide to bid, life-size on a 402 by 874 phone at 3x.)
const ctx = await browser.newContext(process.env.SHOTS ? { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, serviceWorkers: "block" } : { viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
const picture = async name => { if (!process.env.SHOTS) return; for (const sc of ["light", "dark"]) { await page.emulateMedia({ colorScheme: sc }); await page.waitForTimeout(120); await page.screenshot({ path: process.env.SHOTS + "/slide-" + name + "-" + sc + ".png" }); } await page.emulateMedia({ colorScheme: "light" }); };
await ctx.route("https://**/*", async route => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  const body = () => { try { return JSON.parse(req.postData() || "{}"); } catch { return {}; } };
  if (p === "/relay/auctions") return j({ auctions: st.live });
  const photo = /^\/relay\/auctions\/[0-9a-f-]{36}\/photos\/\d$/.exec(p);
  if (photo) return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG });
  const one = /^\/relay\/auctions\/([0-9a-f-]{36})$/.exec(p);
  if (one) { const a = st.live.find(x => x.id === one[1]) || (st.mine.find(x => x.auction.id === one[1]) || {}).auction; return a ? j({ auction: a }) : j({ error: "not_found" }, 404); }
  if (p === "/relay/my/auctions") return j({ canBid: st.canBid && !!st.delivery, ...(st.delivery ? {} : { why: "delivery_details_needed" }), auctions: st.mine });
  if (p === "/relay/my/auctions/bid") {
    const b = body(); st.bids.push(b); await new Promise(r => setTimeout(r, 250));
    if (st.bidFail) return j({ error: "server_busy" }, 503);
    const a = st.live.find(x => x.id === b.auctionId);
    if (!st.delivery) return j({ error: "delivery_details_needed" }, 409);
    if (b.maxMinor < a.nextMinor) return j({ error: "bid_too_low", nextMinor: a.nextMinor }, 400);
    const ans = st.bidAnswer || { leading: true, price: a.priceMinor == null ? a.startMinor : a.nextMinor };
    Object.assign(a, { priceMinor: ans.price, bids: a.bids + 1, nextMinor: ans.price + 100 });
    st.mine = [{ auction: a, you: { maxMinor: b.maxMinor, state: ans.leading ? "leading" : "outbid" } }].concat(st.mine.filter(x => x.auction.id !== a.id));
    return j({ auction: a, you: { maxMinor: b.maxMinor, leading: ans.leading } });
  }
  if (p === "/relay/my/delivery" && m === "GET") return j({ delivery: st.delivery });
  if (p === "/relay/my/delivery" && m === "POST") { st.deliverySaves++; const b = body(); st.delivery = { ...b, postcode: "SW11 1AA", phone: null, line2: null, county: null }; return j({ delivery: st.delivery }); }
  if (p === "/relay/shopify/catalogue") return j({ products: [], published: true, publishedStoreCount: 0 });
  if (p === "/relay/web-shops") return j({ products: [], shops: [], preview: false });
  if (p === "/relay/my/photo-search") return j({ available: false, perDay: 30 });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile" || p === "/relay/me") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/second-step") return j({ required: true, done: true, checked: true, app: true, text: false, passkeys: 1 });
  if (p === "/relay/my/admin/me") return j({ admin: false });
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", () => { throw new Error("a browser pop-up appeared; Relay must ask inside the page"); });
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; }; // color-mix() comes back as color(srgb 0–1)
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [], dots: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " input, " + scope + " [role=button]")) {
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
    if (/\S · \S/.test([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(""))) out.dots.push(el.textContent.trim().slice(0, 40));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const polished = async (where, scope) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [], dots: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/auctions-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
await page.goto(origin + "/index.html");
await page.evaluate(e => { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })); }, EMAIL);
await page.reload();
await page.locator("#homePage .h2-feed > *, #homePage .h2-none").first().waitFor();

// 1. Browse: the Auctions door says how many are live, and opens the Auctions page (a page of Browse).
await page.evaluate(() => window.go("discover"));
const tile = page.locator('#browsePage [data-door="auctions"]');
await tile.getByText("2 live now").waitFor();
assert.equal((await tile.innerText()).replace(/\s+/g, " ").trim(), "Auctions 2 live now");
assert.equal(await tile.locator("svg").count(), 2, "drawn icons (the gavel and the chevron), not symbols");
await polished("discover", "#dcRoot");
await tile.click();
// The list is a page of Browse; an auction, bidding and Your bids open over it in a sheet. Whichever is on top:
const sheet = page.locator("#dcAlt, .rl-back .rl-sheet").last();
await page.getByRole("heading", { name: "Auctions" }).waitFor(); // its bar
const card1 = sheet.getByRole("button", { name: /^Wool Beanie, Hollow Pine, £31\.00, 4 bids/ });
await card1.waitFor();
assert.match(await card1.innerText(), /Wool Beanie, Navy\s+Hollow Pine\s+£31\.00, 4 bids\s+Ends in 3 hours/);
assert.match(await sheet.getByRole("button", { name: /^Sample wax jacket/ }).innerText(), /Starts at £25\.00\s+Ends in 2 days/);
assert.equal(await card1.locator("button").count(), 0, "one tap, no buttons on the card");
await polished("list", "#dcAlt");
console.log("ok - Browse shows how many auctions are live; the page lists them as one-tap cards with the price and time left");

// 2. An auction's page.
await sheet.getByRole("button", { name: /^Sample wax jacket/ }).click();
await sheet.getByRole("heading", { name: "Sample wax jacket" }).waitFor();
assert.equal(await sheet.locator(".rl-au-big img").count(), 1);
assert.equal(await sheet.getByRole("button", { name: /^Photo \d of 2$/ }).count(), 2, "both photos, to tap through");
assert.match(await sheet.locator(".rl-au-sub").first().innerText(), /^Size M, Sample$/);
assert.match(await sheet.locator(".rl-au-pricebox").innerText(), /Starting bid\s+£25\.00\s+No bids yet, free delivery\s+Ends in 2 days/);
assert.match(await sheet.locator(".rl-au-desc").innerText(), /From the shop\s+Worn once at a shoot\.\nSmall mark on the cuff\./);
await sheet.getByText("If you win, you pay Hollow Pine within 24 hours at its own checkout: Relay never takes the money.", { exact: false }).waitFor();
await polished("auction", ".rl-sheet");
await sheet.getByRole("button", { name: "Back to auctions" }).click();
await card1.waitFor();
console.log("ok - an auction's page: its photos, size and condition, the price, bids, delivery and time left, and how paying works");

// 3. Bidding: delivery details first, then the most you'd pay; plain words for a bid that's too low; one bid for a double tap.
await card1.click();
await sheet.getByRole("button", { name: "Place a bid" }).click();
await sheet.getByText("Add your delivery details first: if you win, Hollow Pine sends it there.").waitFor();
const field = name => page.getByLabel(name, { exact: true });
await field("First name").fill("Jess"); await field("Last name").fill("Tester"); await field("Address").fill("12 High Street");
await field("Town or city").fill("London"); await field("Postcode").fill("SW11 1AA");
await sheet.getByRole("button", { name: "Save and bid" }).click();
const max = page.getByLabel(/^The most you'd pay \(£32\.00 or more\)$/);
await max.waitFor();
assert.equal(await max.inputValue(), "32.00"); assert.equal(st.deliverySaves, 1);
await polished("bid", ".rl-sheet");
// Slide to bid: a round handle dragged to the end of a 56px pill that names the amount; the same bid is an ordinary
// button for screen readers and keyboards (it shows when it has the keyboard's focus).
const pill = sheet.locator(".rl-slide"), knob = sheet.locator(".rl-slide-k");
const knobAt = () => knob.evaluate(k => Math.round(new DOMMatrix(getComputedStyle(k).transform).m41));
const slideTo = async (part, { release = true } = {}) => {
  const k = await knob.boundingBox(), p = await pill.boundingBox();
  await page.mouse.move(k.x + k.width / 2, k.y + k.height / 2); await page.mouse.down();
  const end = k.x + k.width / 2 + (p.width - 56) * part;
  for (let i = 1; i <= 8; i++) await page.mouse.move(k.x + k.width / 2 + (end - k.x - k.width / 2) * i / 8, k.y + k.height / 2);
  if (release) await page.mouse.up();
};
assert.equal((await pill.boundingBox()).height, 56, "a 56px pill");
assert.equal(await pill.getAttribute("aria-hidden"), "true", "screen readers get the button instead");
assert.equal((await pill.innerText()).trim(), "Slide to bid £32.00", "the pill names the amount");
const placeBtn = sheet.getByRole("button", { name: "Place bid £32.00" });
await placeBtn.focus();
assert.ok((await placeBtn.boundingBox()).height >= 44, "with the keyboard's focus the button shows, 44px tall");
// Too low, by keyboard: said plainly, nothing sent.
await max.fill("20");
assert.equal((await pill.innerText()).trim(), "Slide to bid £20.00", "the pill follows the amount");
await sheet.getByRole("button", { name: "Place bid £20.00" }).focus(); await page.keyboard.press("Enter");
await sheet.getByText("Bid £32.00 or more.").waitFor();
assert.equal(st.bids.length, 0, "nothing sent for a bid that's too low");
await polished("bid too low", ".rl-sheet");
await max.fill("50");
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await picture("resting");
// Let go half-way: nothing is sent, and it springs back.
await slideTo(0.5, { release: false });
await picture("half-way");
await page.mouse.up();
await page.waitForTimeout(500);
assert.equal(st.bids.length, 0, "let go early: nothing sent");
assert.equal(await knobAt(), 0, "and the handle springs back");
// Held at the end without letting go: still nothing sent (it's sent on letting go at the end).
await slideTo(1, { release: false }); await page.waitForTimeout(300);
assert.equal(st.bids.length, 0, "not sent until let go at the end");
await page.mouse.up();
// Sent once, for exactly the amount on the pill; a second slide while it's being sent does nothing.
await knob.locator("svg").waitFor();
await sheet.getByText("Bid placed").waitFor();
if (process.env.SHOTS) { await page.screenshot({ path: process.env.SHOTS + "/slide-placed-light.png" }); await page.emulateMedia({ colorScheme: "dark" }); await page.screenshot({ path: process.env.SHOTS + "/slide-placed-dark.png" }); await page.emulateMedia({ colorScheme: "light" }); }
await slideTo(1).catch(() => {});
await sheet.getByRole("heading", { name: "You're the highest bidder" }).waitFor();
await sheet.getByText("The price is £32.00. If anyone else bids, Relay bids for you, up to £50.00. With notifications on, Relay tells you if you're outbid.").waitFor();
assert.equal(st.bids.length, 1, "one bid for a slide, and none for a second slide while it was sent");
assert.deepEqual(st.bids[0], { auctionId: A1, maxMinor: 5000 }, "exactly the amount the pill showed");
await polished("bid done", ".rl-sheet");
await sheet.getByRole("button", { name: "Done" }).click();
await sheet.getByText("You're winning. The most you'd pay is £50.00.").waitFor();
await sheet.getByRole("button", { name: "Raise the most you'd pay" }).waitFor();
await polished("winning", ".rl-sheet");
// Someone else's maximum is higher: said plainly, and they can bid again.
st.bidAnswer = { leading: false, price: 6000 };
await sheet.getByRole("button", { name: "Back to auctions" }).click();
await sheet.getByRole("button", { name: /^Sample wax jacket/ }).click();
await sheet.getByRole("button", { name: "Place a bid" }).click();
await page.getByLabel(/^The most you'd pay/).fill("55");
// A failure: plain words with what to do next, and the pill is ready again.
st.bidFail = true;
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await slideTo(1);
await sheet.getByText("Couldn't place your bid. Try again.").waitFor();
await page.waitForTimeout(400);
assert.equal(await knobAt(), 0, "after a failure the handle is back at the start");
assert.equal((await pill.innerText()).trim(), "Slide to bid £55.00");
assert.equal(st.bids.length, 2, "the failed one was sent once");
st.bidFail = false;
// By keyboard, a double press sends one bid.
await sheet.getByRole("button", { name: "Place bid £55.00" }).focus();
await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
await sheet.getByRole("heading", { name: "Someone bid more" }).waitFor();
await sheet.getByText("Their maximum is higher than yours, so the price is now £60.00. You can bid again.").waitFor();
assert.equal(st.bids.length, 3, "a double press of the button sent one bid");
await sheet.getByRole("button", { name: "Bid again" }).waitFor();
await sheet.getByRole("button", { name: "Back to the auction" }).click();
await sheet.getByText("You've been outbid. Bid again to win it.").waitFor();
console.log("ok - bidding asks for delivery details first, then the most you'd pay; slide to bid sends one bid of the amount shown only at the end (early let-go and a second slide send nothing; a failure resets); the button does the same for keyboards; winning or outbid in words");

// 4. Your bids: a win to pay for comes first, with the shop's own link to pay; the row says so, and Home's tab has a red number.
st.mine.push({ auction: auction(A3, { title: "Field Tee", variant: null, status: "ended", priceMinor: 7200, nextMinor: null, bids: 6, endsAt: now - 3600e3 }),
  you: { maxMinor: 8000, state: "pay", priceMinor: 7200, totalMinor: 7595, payBy: now + 20 * 3600e3, payUrl: "https://hollow-pine.myshopify.com/pay/9001" } });
await sheet.getByRole("button", { name: "Back to auctions" }).click();
const yourBids = page.locator("#dcAlt .rl-arow", { hasText: "Your bids" });
await yourBids.getByText("1 to pay for").waitFor();
await yourBids.click();
const firstMine = sheet.locator(".rl-au-card").first();
await firstMine.getByText(/^You won\. Pay £75\.95 to Hollow Pine by /).waitFor();
assert.match(await firstMine.innerText(), /^Field Tee\s+Hollow Pine\s+Ended/);
await polished("your bids", ".rl-sheet");
await firstMine.click();
const pay = sheet.getByRole("link", { name: "Pay £75.95 at Hollow Pine" });
await pay.waitFor();
assert.equal(await pay.getAttribute("href"), "https://hollow-pine.myshopify.com/pay/9001"); assert.equal(await pay.getAttribute("target"), "_blank");
await polished("pay", ".rl-sheet");
await sheet.getByRole("button", { name: "Back to auctions" }).click();
await sheet.getByRole("button", { name: "Close" }).click();
await page.evaluate(() => window.go("profile"));
const badge = page.locator('#foot [data-name="Home"] .tab-badge');
await badge.waitFor();
assert.equal(await badge.textContent(), "1");
assert.match(await page.locator('#foot [data-name="Home"]').getAttribute("aria-label"), /^Home, 1 auction win to pay for$/);
console.log("ok - Your bids puts a win to pay for first, with the shop's own link to pay; its row says so, and the Home tab shows a red number");

// 5. A link from a notification opens that auction.
await page.evaluate(id => { location.hash = "open=auction&id=" + id; }, A2);
await sheet.getByRole("heading", { name: "Sample wax jacket" }).waitFor();
await sheet.getByRole("button", { name: "Back to auctions" }).click();
await sheet.getByRole("button", { name: "Close" }).click();
console.log("ok - a link from a notification opens the auction");

// 6. No auctions: the door doesn't say any are live (and the page says what happens there).
st.live = [];
await page.evaluate(() => { window.go("profile"); });
await page.evaluate(() => window.RelayAccount.auctionsLive(true));
await page.evaluate(() => window.go("discover"));
await page.waitForTimeout(400);
await page.locator('#browsePage [data-door="auctions"]').waitFor();
assert.equal((await page.locator('#browsePage [data-door="auctions"]').innerText()).trim(), "Auctions", "nothing said to be live when nothing is");
await page.evaluate(() => window.RelayAccount.openAuctions("live"));
await sheet.getByText("When shops on Relay put clothes up for auction, they show here.", { exact: false }).waitFor();
await polished("empty", ".rl-sheet");
const words = await page.evaluate(() => document.body.innerText);
assert.ok(!/\b(test|sandbox|demo)\b/i.test(words), "no test wording for shoppers");
console.log("ok - with nothing live the door says none are, and the page says what will show there");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS auctions in the app");
await browser.close(); server.close();
