// Browser test: codes to show or scan on a receipt (worker/scan-codes.js, account.js codesSection). Stubbed Relay server,
// a made-up person, invented shops, orders and codes; the pictures are drawn here.
// Checks:
//  1. A receipt's page (opened from Home) heads the code by what to do ("Return in store"), shows it big on a white tile
//     with the shop's own words exactly, and asks Relay for the picture only once the page is opened, once.
//  2. Full screen: a sheet that fills the phone, white, the code large, a drawn Back (44px) that returns to the receipt;
//     a double tap opens it once.
//  3. A date that has passed is said plainly and the code isn't offered (nor asked for); a code Relay has no copy of
//     says to open the email; tickets show one each, with Next and Previous full screen.
//  4. In the Receipts list the same section opens with the row.
//  5. The polish rules on all of it (44px taps, 13px text, no symbol icons, no dot-joined facts, no test wording,
//     nothing wider than the phone), and no page errors.
// Screenshots go to RELAY_CODES_SHOTS (or /tmp/shots).
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { deflateSync } from "node:zlib";
import { skipInterests, homeReady, bigCards, homeCard, closeSheet, waitOutDoubleTap } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.RELAY_CODES_SHOTS || "/tmp/shots"; await mkdir(SHOTS, { recursive: true });

// A real PNG drawn from a grid of black and white cells: bars for a barcode, squares for a QR code. Made up: it encodes nothing.
function pngOf(w, h, black) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = black(x, y) ? 0 : 255; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const rnd = (seed) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const barcode = (seed) => { const r = rnd(seed), bars = Array.from({ length: 150 }, () => r() > 0.5); return pngOf(300, 80, (x) => x > 8 && x < 292 && bars[Math.floor(x / 2)]); };
const qrcode = (seed) => { const r = rnd(seed), cells = Array.from({ length: 29 * 29 }, () => r() > 0.5); const eye = (cx, cy, x, y) => { const dx = Math.abs(x - cx), dy = Math.abs(y - cy), d = Math.max(dx, dy); return d <= 3 ? d !== 2 : null; };
  return pngOf(232, 232, (px, py) => { const x = Math.floor(px / 8), y = Math.floor(py / 8); for (const [cx, cy] of [[3, 3], [25, 3], [3, 25]]) { const e = eye(cx, cy, x, y); if (e !== null) return e; } return cells[y * 29 + x]; }); };

const EMAIL = "sam.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const long = d => { const t = new Date(d + "T00:00:00Z"), f = o => t.toLocaleDateString("en-GB", { timeZone: "UTC", ...o }); return f({ weekday: "short" }) + " " + f({ day: "numeric", month: "long", year: "numeric" }); };
const receipt = (id, shop, item, pence, ago, extra) => ({ id, status: "confirmed", kind: "receipt", retailer: { name: shop, domain: null }, orderRef: "R-" + id.slice(0, 4), orderDate: day(-ago), totalPence: pence, currency: "GBP",
  category: "fashion", returnable: true, items: [{ name: item, qty: 1, pricePence: pence, category: "fashion" }], returns: null, reminder: "off", gmailId: "abc123def456", ...extra });
const IN_STORE = "Bring your item(s) to your nearest store (excluding concessions and outlets) with the barcode below ready to be scanned by our team.", RULE = "Paypal and Klarna returns cannot be accepted in store.";
const MAILED = "99999999-9999-4999-8999-999999999999";
const JACKET = receipt("11111111-1111-4111-8111-111111111111", "Fellwear", "Ridge Running Jacket", 9800, 6, { returns: { deadline: day(22) }, delivery: { status: "delivered", at: day(-3), carrier: "Evri", trackingNumber: null },
  codes: [{ n: 1, purpose: "in_store_return", kind: "barcode", words: [IN_STORE, RULE], deadline: null, hasImage: true, emailId: MAILED }] });
const TIGHTS = receipt("22222222-2222-4222-8222-222222222222", "Fellwear", "Studio Tights", 8800, 9, { returns: { deadline: day(12) },
  codes: [{ n: 1, purpose: "drop_off_return", kind: "qr", words: ["Use a Print In ParcelShop device to scan your QR code and stick the label to your parcel."], deadline: day(12), hasImage: true, emailId: MAILED }] });
const SEAT = receipt("33333333-3333-4333-8333-333333333333", "Marlow Market", "Soft Close Toilet Seat", 2899, 70, { category: "home",
  codes: [{ n: 1, purpose: "drop_off_return", kind: "qr", words: ["Evri Drop Off - No Printer Required"], deadline: day(-40), hasImage: true, emailId: MAILED }] });
const AIRER = receipt("44444444-4444-4444-8444-444444444444", "Marlow Market", "Folding Clothes Airer", 2450, 8, { category: "home", returns: { deadline: day(20) },
  codes: [{ n: 1, purpose: "drop_off_return", kind: "qr", words: ["Royal Mail Drop off- No label needed"], deadline: day(20), hasImage: false, emailId: MAILED }] });
const FEST = receipt("55555555-5555-4555-8555-555555555555", "Lanternfield Festival", "Standard Entry", 7500, 5, { category: "other", returnable: false, items: [{ name: "Standard Entry", qty: 3, pricePence: 2500, category: "other" }],
  codes: ["100200300401", "100200300402", "100200300403"].map((v, i) => ({ n: i + 1, purpose: "ticket", kind: "barcode", words: ["Show each ticket's barcode at the gate to be scanned."], deadline: null, day: day(30), hasImage: true, value: v, emailId: "55555555-5555-4555-8555-555555555555" })) });
const PAST = receipt("66666666-6666-4666-8666-666666666666", "Old Mill Arena", "Evening Ticket", 3000, 90, { category: "other", returnable: false,
  codes: [{ n: 1, purpose: "ticket", kind: "barcode", words: [], deadline: null, day: day(-60), hasImage: true, value: "700800900100" }] });
const PLAIN = receipt("77777777-7777-4777-8777-777777777777", "Kick Lane", "Court Classic Trainers", 8500, 4, { returns: { deadline: day(24) } });
const BELT = receipt("88888888-8888-4888-8888-888888888888", "Fellwear", "Trail Running Belt", 2800, 50, {
  codes: [{ n: 1, purpose: "in_store_return", kind: "barcode", words: [IN_STORE], deadline: null, hasImage: true, emailId: MAILED }] });
const st = { receipts: [JACKET, TIGHTS, SEAT, AIRER, FEST, PAST, PLAIN, BELT], log: [], broken: false };
const codeAsks = () => st.log.filter(l => /\/codes\/\d+$/.test(l));
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" }); await skipInterests(ctx); await bigCards(ctx);
await ctx.addInitScript(([e]) => { try { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); localStorage.setItem("relay.mailbox", "gmail"); } catch (x) {} }, [EMAIL]);
await ctx.route("https://**/*", async route => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
  if (!p.startsWith("/relay/")) return route.abort();
  st.log.push(m + " " + p);
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 6e5, others: [] });
  if (p === "/relay/my/receipts") return j({ receipts: st.receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam Tester", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [] });
  const code = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/codes\/(\d{1,2})$/.exec(p);
  if (code && m === "GET") {
    const x = st.receipts.find(r => r.id === code[1]), c = x && (x.codes || []).find(k => k.n === Number(code[2]));
    if (!c || !c.hasImage || st.broken) return j({ error: "not_found" }, 404);
    return route.fulfill({ status: 200, contentType: "image/png", headers: { ...H, "x-content-type-options": "nosniff", "cache-control": "private, max-age=86400" }, body: c.kind === "qr" ? qrcode(7 + c.n) : barcode(11 + c.n + x.id.charCodeAt(0)) });
  }
  if (/\/original$/.test(p)) return j({ html: '<p>Take your parcel to a Post Office and show this QR code.</p>', links: [], extraImages: [] });
  return j({});
});
const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(origin + "/index.html");
await homeReady(page); await page.waitForTimeout(700);

// The polish rules on what's showing in one place.
const measure = (scope) => page.evaluate((scope) => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0.5; };
  const out = { small: [], tiny: [], symbols: [], dots: [], words: [], wide: [], purple: [] };
  const box = [...document.querySelectorAll(scope)].pop();
  for (const el of box.querySelectorAll("button, a, [role=button], select")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→←✓⤢]|\p{Extended_Pictographic}/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of box.querySelectorAll("*")) {
    if (!vis(el)) continue;
    const s = getComputedStyle(el);
    if (/gradient/.test(s.backgroundImage) && !el.classList.contains("rl-skel")) out.purple.push("gradient on " + el.className);
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const px = parseFloat(s.fontSize);
    if (px < 13 && !(s.textTransform === "uppercase" && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    const r = el.getBoundingClientRect(); if (r.right > innerWidth + 1 || r.left < -1) out.wide.push(el.textContent.trim().slice(0, 30));
  }
  if (/ · /.test(box.innerText)) out.dots.push("·");
  const w = box.innerText.match(/\b(demo|sandbox|test shop|testing|undefined|null|NaN)\b/i); if (w) out.words.push(w[0]);
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push("the page scrolls sideways");
  return out;
}, scope);
const polished = async (scope, where) => { const m = await measure(scope); for (const k of Object.keys(m)) assert.deepEqual(m[k], [], where + ": " + k); };
// Opens a receipt's page from its card on Home, as a person would: not within the double-tap guard of the tap before, and
// again if the tap landed while Home was still settling after a sheet closed.
async function openCard(text) {
  for (let i = 0; ; i++) {
    await waitOutDoubleTap(page);
    await homeCard(page, text).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(250);
    await homeCard(page, text).first().click();
    try { await page.locator(".rl-back .rl-sheet").last().waitFor({ timeout: 6000 }); return page.locator(".rl-back .rl-sheet").last(); } catch (e) { if (i === 2) throw e; }
  }
}
const loaded = (img) => img.evaluate(i => i.complete && i.naturalWidth > 0 && !i.hidden);

// ---- 1. The receipt's page ---------------------------------------------------------------------------------------------
assert.deepEqual(codeAsks(), [], "no code's picture is asked for until its receipt is opened");
let sheet = await openCard("Ridge Running Jacket");
const sec = sheet.locator('.rl-sc[data-purpose="in_store_return"]');
await sec.waitFor();
assert.equal((await sec.locator(".rl-sc-h").innerText()).trim(), "Return in store", "headed by what to do");
const tile = sec.locator(".rl-sc-tile");
await page.waitForFunction(() => { const i = document.querySelector(".rl-sheet .rl-sc-tile img"); return i && i.complete && i.naturalWidth > 0; });
assert.ok(await loaded(tile.locator("img")), "the barcode shows");
const look = await tile.evaluate(t => { const s = getComputedStyle(t), r = t.getBoundingClientRect(), i = t.querySelector("img").getBoundingClientRect(); return { bg: s.backgroundColor, w: r.width, iw: i.width, ih: i.height }; });
assert.equal(look.bg, "rgb(255, 255, 255)", "on a white tile, so it scans");
assert.ok(look.iw >= 250 && look.ih >= 80, "big: " + JSON.stringify(look));
const said = await sec.locator("p").allInnerTexts();
assert.ok(said.includes("“" + IN_STORE + "”") && said.includes("“" + RULE + "”"), "the shop's words exactly, as a quotation: " + JSON.stringify(said));
assert.ok(said.includes("As Fellwear's email says."), "and whose words they are, once");
assert.ok(!/paid|you used|klarna order/i.test(said.filter(t => !t.startsWith("“")).join(" ")), "nothing worked out about how it was paid");
assert.deepEqual(codeAsks(), ["GET /relay/my/receipts/" + JACKET.id + "/codes/1"], "asked for once, when the page opened");
await polished(".rl-back .rl-sheet", "the receipt's page");
await sec.scrollIntoViewIfNeeded(); await page.waitForTimeout(250);
await page.screenshot({ path: SHOTS + "/codes-1-receipt-return-in-store.png" });

// ---- 2. Full screen ------------------------------------------------------------------------------------------------------
const fullBtn = sec.getByRole("button", { name: "Show full screen to scan" });
await fullBtn.dblclick();
const full = page.locator(".rl-sheet.rl-sc-full");
await full.waitFor();
assert.equal(await page.locator(".rl-back").count(), 1, "a double tap opens it once");
await page.waitForFunction(() => { const i = document.querySelector(".rl-sc-full .rl-sc-stage img"); return i && i.complete && i.naturalWidth > 0 && !i.hidden; });
const fl = await full.evaluate(f => { const s = getComputedStyle(f), r = f.getBoundingClientRect(), i = f.querySelector(".rl-sc-stage img").getBoundingClientRect(), b = f.querySelector(".rl-navback"), br = b.getBoundingClientRect();
  return { bg: s.backgroundColor, h: r.height, w: r.width, top: r.top, iw: i.width, back: br.height, hasBack: b.hasAttribute("data-back"), word: b.innerText.trim(), svg: !!b.querySelector("svg") }; });
assert.equal(fl.bg, "rgb(255, 255, 255)", "white");
assert.ok(fl.h >= 840 && fl.w >= 389 && fl.top <= 1, "fills the phone: " + JSON.stringify(fl));
assert.ok(fl.iw >= 340, "the code is as wide as the phone allows: " + fl.iw);
assert.ok(fl.back >= 44 && fl.hasBack && fl.svg && fl.word === "Receipt", "Back is a drawn chevron and a word, 44px, with data-back: " + JSON.stringify(fl));
assert.ok((await full.innerText()).includes(IN_STORE), "the shop's words come with it");
await polished(".rl-sheet.rl-sc-full", "full screen");
await page.screenshot({ path: SHOTS + "/codes-2-full-screen.png" });
assert.deepEqual(codeAsks().length, 1, "full screen reuses the picture it has");
await full.locator(".rl-navback").click();
await page.locator('.rl-sheet .rl-sc[data-purpose="in_store_return"]').waitFor();
assert.equal(await page.locator(".rl-sheet.rl-sc-full").count(), 0, "Back returns to the receipt");
assert.deepEqual(codeAsks().length, 1, "and still nothing asked again");
// The tile itself opens it too.
await waitOutDoubleTap(page);
await page.locator(".rl-sheet .rl-sc-tile").click(); await page.locator(".rl-sheet.rl-sc-full").waitFor();
await page.locator(".rl-sc-full .rl-navback").click(); await page.locator(".rl-sheet .rl-sc").first().waitFor();
await closeSheet(page);
console.log("ok - the receipt's page shows the code on a white tile under what to do, with the shop's words; full screen fills the phone on white and Back returns");

// ---- 3. A drop-off QR code with its date; tickets ------------------------------------------------------------------------
sheet = await openCard("Studio Tights");
const drop = sheet.locator('.rl-sc[data-purpose="drop_off_return"]'); await drop.waitFor();
assert.equal((await drop.locator(".rl-sc-h").innerText()).trim(), "Drop off your return");
assert.equal((await drop.locator(".rl-sc-by").innerText()).trim(), "Drop off by " + long(day(12)), "the date the email stated");
await page.waitForFunction(() => { const i = document.querySelector(".rl-sheet .rl-sc-tile img"); return i && i.complete && i.naturalWidth > 0; });
const q = await drop.locator(".rl-sc-tile img").evaluate(i => { const r = i.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
assert.deepEqual(q, [200, 200], "a QR code keeps its square");
assert.equal(await sheet.getByRole("button", { name: /Show return (QR code|email)/ }).count(), 0, "no second button for the same code");
await polished(".rl-back .rl-sheet", "a drop-off code's page");
await page.screenshot({ path: SHOTS + "/codes-3-drop-off-qr.png" });
await closeSheet(page);

sheet = await openCard("Standard Entry");
const tk = sheet.locator('.rl-sc[data-purpose="ticket"]'); await tk.waitFor();
assert.equal((await tk.locator(".rl-sc-h").innerText()).trim(), "Your tickets");
assert.equal(await tk.locator(".rl-sc-tile").count(), 3, "each ticket's barcode");
assert.deepEqual(await tk.locator(".rl-sc-num").allInnerTexts(), ["100200300401", "100200300402", "100200300403"], "with its number");
assert.equal(await tk.getByText("“Show each ticket's barcode at the gate to be scanned.”").count(), 1, "the shop's words once, not three times");
await page.waitForFunction(() => [...document.querySelectorAll(".rl-sheet .rl-sc-tile img")].filter(i => i.complete && i.naturalWidth > 0).length === 3);
await polished(".rl-back .rl-sheet", "tickets");
await tk.scrollIntoViewIfNeeded(); await page.screenshot({ path: SHOTS + "/codes-4-tickets.png" });
await tk.locator(".rl-sc-tile").nth(1).click();
await page.locator(".rl-sheet.rl-sc-full").waitFor();
assert.equal((await page.locator(".rl-sc-full h2").innerText()).trim(), "Ticket 2 of 3");
assert.equal((await page.locator(".rl-sc-full .rl-sc-num").innerText()).trim(), "100200300402");
await polished(".rl-sheet.rl-sc-full", "a ticket full screen");
await waitOutDoubleTap(page); await page.getByRole("button", { name: "Next ticket" }).click();
await page.getByRole("heading", { name: "Ticket 3 of 3" }).waitFor();
assert.equal(await page.getByRole("button", { name: "Next ticket" }).count(), 0);
await waitOutDoubleTap(page); await page.getByRole("button", { name: "Previous ticket" }).click();
await page.getByRole("heading", { name: "Ticket 2 of 3" }).waitFor();
await page.locator(".rl-sc-full .rl-navback").click(); await page.locator('.rl-sheet .rl-sc[data-purpose="ticket"]').waitFor();
await closeSheet(page);
console.log("ok - a drop-off QR code with the date the email gave; three tickets, each with its number, Next and Previous full screen");

// ---- 4. The Receipts list: passed dates, a code with no copy, and a picture that doesn't arrive ---------------------------
await page.evaluate(() => window.go("receipts"));
const row = (text) => page.locator("#view .rl-rr", { hasText: text }).first();
const openRow = async (text) => { await row(text).waitFor(); await waitOutDoubleTap(page); await row(text).locator(".rl-rr-main").click(); await row(text).locator(".rl-rr-detail").waitFor(); return row(text).locator(".rl-rr-detail"); };
let before = codeAsks().length;
let d = await openRow("Soft Close Toilet Seat");
let box = d.locator(".rl-sc"); await box.waitFor();
assert.equal((await box.locator(".rl-sc-past").innerText()).trim(), "Drop off by " + long(day(-40)) + ". That date has passed.", "a passed date is said plainly");
assert.equal(await box.locator(".rl-sc-tile, img, button").count(), 0, "and the code isn't offered");
assert.match(await box.innerText(), /This QR code is no longer shown, because the date has passed\./);
d = await openRow("Evening Ticket");
assert.match(await d.locator(".rl-sc").innerText(), new RegExp("This was for " + long(day(-60)).replace(/ /g, " ") + "\\."), "a ticket whose day has gone says so");
assert.equal(await d.locator(".rl-sc-tile").count(), 0);
assert.equal(codeAsks().length, before, "nothing is asked for a code that isn't offered");
d = await openRow("Folding Clothes Airer");
box = d.locator(".rl-sc");
assert.match(await box.innerText(), /Relay doesn't have a copy of this QR code\. Open the email from Marlow Market to show it\./, "no copy: says to open the email");
assert.equal((await box.locator(".rl-sc-by").innerText()).trim(), "Drop off by " + long(day(20)), "the date is still there");
assert.ok((await box.innerText()).includes("“Royal Mail Drop off- No label needed”"), "and the shop's words");
assert.equal(await box.locator(".rl-sc-tile").count(), 0);
await polished("#view", "the Receipts list with codes open");
await box.scrollIntoViewIfNeeded(); await page.screenshot({ path: SHOTS + "/codes-5-no-copy-and-passed.png" });
await waitOutDoubleTap(page); await box.getByRole("button", { name: "Open the email" }).click();
await page.locator(".rl-sheet", { hasText: "The email with your QR code" }).waitFor();
assert.ok(st.log.includes("GET /relay/my/receipts/" + MAILED + "/original"), "the email the code came in is the one opened");
await closeSheet(page);
// A live code in the list, and one whose picture doesn't arrive.
d = await openRow("Ridge Running Jacket");
await d.locator(".rl-sc-tile img").waitFor();
assert.equal(codeAsks().length, before, "the picture fetched on Home is reused here");
assert.equal((await d.locator(".rl-sc-h").innerText()).trim(), "Return in store");
st.broken = true;
d = await openRow("Trail Running Belt");
await d.locator(".rl-sc-gone").first().waitFor();
assert.equal(await d.locator(".rl-sc-tile").count(), 0, "a picture that doesn't arrive leaves no empty tile");
assert.match(await d.locator(".rl-sc").innerText(), /Relay doesn't have a copy of this barcode/);
st.broken = false;
assert.equal(await row("Court Classic Trainers").count() > 0 && await (await openRow("Court Classic Trainers")).locator(".rl-sc").count(), 0, "a receipt with no code has no section");
console.log("ok - a passed date is said plainly and the code isn't offered; no copy says to open the email; the Receipts list shows the same section");

// ---- 5. Nothing on a timer, no errors -------------------------------------------------------------------------------------
const quiet = codeAsks().length; await page.waitForTimeout(2500);
assert.equal(codeAsks().length, quiet, "nothing is asked again while the page sits open");
// (The email shown in its sandboxed frame can't reach the service worker, and says so: not the app's error.)
assert.deepEqual(errors.filter(e => !/serviceWorker/.test(e)), [], "no page errors");
await browser.close(); server.close();
console.log("PASS codes to show or scan in the app: the section, full screen, passed dates, no copy, tickets, polish rules. Screenshots in " + SHOTS);
