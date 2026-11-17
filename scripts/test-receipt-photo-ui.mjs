// Browser test: a bank payment with no receipt that likely should have one (an H&M payment), and adding a photo of its
// receipt. Stubbed Relay server, made-up shops and payments.
// Checks: Home shows one small card for it, with no extra request (it comes with the receipts Home already loads); a tap
// opens a sheet saying what the payment was, with "Add a photo of the receipt" (the camera, images only) and "This wasn't a
// shop purchase"; while the photo is read, greyed outlines (no spinner); the photo is made smaller first and sent once,
// however often it's tapped; then the receipt's page, labelled "Receipt from your photo", with what was read, the photo and,
// when the photo's total isn't what the bank paid, both said plainly; a refused photo is explained in plain English; Bank and
// cards marks the payment and offers the same sheet; Receipts shows the label too. Passes the polish rules.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeCard } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const short = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const CONN = "00000000-0000-4000-8000-0000000000aa", HM = CONN + ":hm", ZARA = CONN + ":zara", NEW_ID = "22222222-2222-4222-8222-222222222222";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const st = { uploads: [], marks: [], log: [], answer: "ok", delay: 900, made: false };
const hmPay = { id: HM, account: "Current account", date: day(-5), amountPence: 3499, currency: "GBP", shop: "H&M", photoRead: true };
const photoReceipt = () => ({ id: NEW_ID, status: "pending", kind: "receipt", photoReceipt: true, source: "receipt_photo", retailer: { name: "H&M", domain: null }, orderDate: day(-5), orderDateFrom: "photo",
  totalPence: 3299, currency: "GBP", totalFrom: "photo", totalMismatch: true, bankPaid: { amountPence: 3499, currency: "GBP", date: day(-5), account: "Current account" }, readBy: "ai", confidence: "high",
  needsShopperConfirmation: true, category: "fashion", returnable: true, items: [{ name: "Ribbed vest top", qty: 1, pricePence: 1299, category: "fashion" }, { name: "Wide-leg jeans", qty: 1, pricePence: 2000, category: "fashion" }], aiFilled: [] });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  st.log.push(m + " " + p);
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  if (p === "/relay/my/receipts/" + NEW_ID + "/receipt-photo") return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG });
  if (p === "/relay/my/bank/receipt-photo") {
    const b = JSON.parse(route.request().postData()); st.uploads.push(b);
    if (st.delay) await new Promise(r => setTimeout(r, st.delay));
    if (st.answer === "too_big") return j({ error: "photo_too_big" }, 413);
    st.made = true;
    const r = photoReceipt();
    return j({ ok: true, receipt: { id: NEW_ID, shop: "H&M", date: r.orderDate, dateFrom: "photo", items: r.items.map(({ name, qty, pricePence }) => ({ name, qty, pricePence })), totalPence: 3299, currency: "GBP",
      totalFrom: "photo", readBy: "ai", confidence: "high", photoNotRead: null, totalMismatch: true, bankPaid: r.bankPaid, receiptNumber: null } });
  }
  if (p === "/relay/my/receipts") return j({ receipts: st.made ? [photoReceipt()] : [], ...(st.made ? {} : { needReceipt: [hmPay] }) });
  if (p === "/relay/my/bank") return j({ available: true, testBanks: true, connections: [{ id: CONN, bank: "Mock Bank", connectedAt: new Date().toISOString(), syncedAt: new Date().toISOString(), needsReconnect: false, payments: 3, matched: 0 }] });
  if (p === "/relay/my/bank/sync") return j({ read: 0, gone: 0, matched: 0 });
  if (p === "/relay/my/bank/payments") return j({ payments: [
    { id: HM, account: "Current account", date: day(-5), amountPence: 3499, currency: "GBP", description: "H&M", merchant: null, shop: "H&M", ...(st.made ? { receiptId: NEW_ID, match: "photo" } : { receiptId: null, match: null, needsReceipt: true }), notMine: null },
    { id: ZARA, account: "Current account", date: day(-7), amountPence: 4999, currency: "GBP", description: "ZARA UK LTD", merchant: null, shop: "Zara", receiptId: null, match: null, notMine: null, ...(st.zaraNoReceipt ? { noReceipt: true } : { needsReceipt: true }) },
    { id: CONN + ":cafe", account: "Current account", date: day(-2), amountPence: 320, currency: "GBP", description: "COFFEE CORNER", merchant: null, shop: "Coffee Corner", receiptId: null, match: null, notMine: null }] });
  if (p === "/relay/my/bank/not-mine") { const b = JSON.parse(route.request().postData()); st.marks.push(b); if (b.reason === "no_receipt") st.zaraNoReceipt = b.on; return j({ ok: true }); }
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5 });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/admin/me") return j({ admin: false, tester: true });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; };
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [], dots: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " input")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓+×✕📷]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    const caps = s.textTransform === "uppercase" || (/[A-Z]/.test(el.textContent) && el.textContent === el.textContent.toUpperCase());
    if (px < 13 && !(caps && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    if (/ · /.test(el.textContent)) out.dots.push(el.textContent.trim().slice(0, 40));
    const back = bgOf(el), a = lum(flat(rgb(s.color), back)), b = lum(back), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3 && !el.closest("button:disabled")) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const polished = async (where, scope) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [], dots: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/receipt-photo-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png", fullPage: false });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
// A photo of a receipt as the phone's camera gives it: big, so the app has to make it smaller before sending.
const bigPhoto = async () => Buffer.from((await page.evaluate(() => {
  const c = document.createElement("canvas"); c.width = 2400; c.height = 3600; const g = c.getContext("2d");
  g.fillStyle = "#f4f1ea"; g.fillRect(0, 0, c.width, c.height); g.fillStyle = "#222"; g.font = "120px monospace";
  ["H&M", "Ribbed vest top 12.99", "Wide-leg jeans 20.00", "TOTAL 32.99"].forEach((t, i) => g.fillText(t, 200, 400 + i * 260));
  for (let i = 0; i < 4000; i++) { g.fillStyle = "rgba(0,0,0," + (Math.random() * 0.2) + ")"; g.fillRect(Math.random() * 2400, Math.random() * 3600, 6, 6); }
  return c.toDataURL("image/png");
})).split(",")[1], "base64");

await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload();

// 1. Home: one small card for the payment, with no request of its own.
const card = homeCard(page, "H&M, £34.99 on " + short(day(-5)));
await card.waitFor();
assert.match(await card.innerText(), /No receipt yet\. Add a photo of it/);
assert.ok(!st.log.some(x => /\/relay\/my\/bank/.test(x)), "Home asks nothing extra: the payment came with the receipts it already loads");
console.log("ok - Home: one small card for a shop payment with no receipt, no extra request");

// 2. The sheet: what the payment was, the camera, and the other answers.
await card.click();
const sheet = page.locator(".rl-sheet.rl-rp");
await sheet.getByRole("heading", { name: "H&M" }).waitFor();
assert.match(await sheet.innerText(), /You paid £34\.99 on \w+ \d{1,2} \w+ with Current account\. Relay hasn't found a receipt for it\./);
assert.match(await sheet.innerText(), /reads the shop, date, items and total from it\. It's marked as a receipt from your photo, not one the shop sent\./, "with the AI reader on");
const input = sheet.locator("input[type=file]");
assert.deepEqual(await input.evaluate(i => [i.accept, i.getAttribute("capture")]), ["image/*", "environment"], "images, from the back camera");
assert.ok(await sheet.getByRole("button", { name: "This wasn't a shop purchase" }).isVisible());
assert.ok(await sheet.locator(".rl-rp-add svg").count(), "a drawn camera, not an emoji");
await polished("ask sheet", ".rl-rp");
console.log("ok - the sheet: what the payment was, Add a photo of the receipt (camera), This wasn't a shop purchase");

// 3. A photo too big for Relay (the server says so): explained in plain English, and it can be tried again.
st.answer = "too_big"; st.delay = 0;
let chooser = page.waitForEvent("filechooser");
await sheet.getByRole("button", { name: "Add a photo of the receipt" }).click();
await (await chooser).setFiles({ name: "receipt.png", mimeType: "image/png", buffer: await bigPhoto() });
await sheet.getByText("That photo is too big to send. Take it again a little further away.").waitFor();
assert.ok(!/photo_too_big|413/.test(await sheet.innerText()), "no codes");
console.log("ok - a refused photo is explained in plain English");

// 4. The photo: made smaller, sent once however often it's tapped, greyed outlines while it's read, then the receipt.
st.answer = "ok"; st.delay = 1500; st.uploads = [];
chooser = page.waitForEvent("filechooser");
await sheet.getByRole("button", { name: "Add a photo of the receipt" }).click();
await (await chooser).setFiles({ name: "receipt.png", mimeType: "image/png", buffer: await bigPhoto() });
await sheet.locator(".rl-rp-sk .rl-skel").first().waitFor();
assert.equal(await page.locator(".rl-spinner, [class*=spin]").count(), 0, "no spinner");
assert.ok(!/Loading/.test(await sheet.innerText()));
await sheet.locator("input[type=file]").count().then(n => assert.equal(n, 0, "nothing to tap while it's read"));
await sheet.getByText("Receipt from your photo", { exact: true }).waitFor();
await sheet.locator(".rl-rp-warn").waitFor();
assert.equal(st.uploads.length, 1, "sent once");
assert.equal(st.uploads[0].id, HM);
assert.match(st.uploads[0].image, /^data:image\/jpeg;base64,/, "made into a JPEG");
assert.ok(st.uploads[0].image.length <= 1450000, "and small enough to send");
assert.deepEqual(Object.keys(st.uploads[0]).sort(), ["id", "image"]);
console.log("ok - made smaller and sent once; greyed outlines while it's read (no spinner)");

// 5. The receipt's page: labelled as from the photo, what was read, both totals when they differ, and the photo.
const words = await sheet.innerText();
assert.match(words, /Receipt from your photo/);
assert.match(words, /Ribbed vest top\s+£12\.99/); assert.match(words, /Wide-leg jeans\s+£20\.00/);
assert.match(words, /Total on the photo\s+£32\.99/);
assert.match(words, /The total on the photo is £32\.99; your bank paid £34\.99\./);
assert.match(words, /Read from your photo by AI\. Check it's right/);
assert.ok(!/e-receipt|from H&M's|verified|confirmed by/i.test(words), "never presented as the shop's own receipt");
await sheet.locator("img.rl-rp-photo[src^='blob:']").waitFor();
await polished("receipt page", ".rl-rp");
await sheet.getByRole("button", { name: "Done" }).click();
await sheet.waitFor({ state: "detached" });
await homeCard(page, "H&M, £34.99").waitFor({ state: "detached", timeout: 5000 }); // and Home stops asking for it
await page.waitForTimeout(450); // (a second tap within 400ms counts as a double tap)
console.log("ok - the receipt's page: Receipt from your photo, items, both totals said plainly, the photo");

// 6. Receipts: the receipt says it's from your photo, with the mismatch and the photo.
await page.evaluate(() => window.go("receipts"));
await page.locator(".rl-rr-main", { hasText: "Wide-leg jeans" }).first().click();
const detail = page.locator(".rl-rr-detail").first();
await detail.getByText("Receipt from your photo", { exact: true }).waitFor();
await detail.getByText("The total on the photo is £32.99; your bank paid £34.99.").waitFor();
await detail.locator("img.rl-rp-photo").waitFor();
console.log("ok - Receipts: labelled Receipt from your photo, with the mismatch and the photo");

// 7. Bank and cards: the payment with no receipt is marked and opens the same sheet; "This wasn't a shop purchase" works.
await page.evaluate(() => window.go("me"));
const view = page.locator("#mePage");
await view.locator(".rl-arow", { hasText: "Bank and cards" }).click();
await view.locator(".rl-bk-row").first().waitFor();
assert.match(await view.innerText(), /1 shop payment has no receipt\. Tap it to add a photo of the receipt\./);
const rows = await view.locator(".rl-bk-row").allInnerTexts();
assert.match(rows[0], /H&M\s+Receipt from your photo/);
assert.match(rows[1], /Zara\s+No receipt yet\. Add a photo/);
assert.match(rows[2], /Coffee Corner\s+No receipt yet\s+£3\.20/, "a café isn't asked about");
await polished("bank page", "#mePage");
await view.locator(".rl-bk-row", { hasText: "Zara" }).click();
await sheet.getByRole("heading", { name: "Zara" }).waitFor();
assert.match(await sheet.innerText(), /fills in the shop, amount and date from your bank\./, "without the AI reader, it says so instead of promising a read");
await sheet.getByRole("button", { name: "This wasn't a shop purchase" }).dblclick();
await view.getByText("Got it: Relay won't ask for that receipt.").waitFor();
assert.deepEqual(st.marks, [{ id: ZARA, on: true, reason: "no_receipt" }], "sent once for a double tap");
await view.locator(".rl-bk-row", { hasText: "Not a shop purchase" }).waitFor();
assert.ok(!(await view.innerText()).includes("shop payment has no receipt"));
console.log("ok - Bank and cards: marked, opens the same sheet; This wasn't a shop purchase, once");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS receipt photos UI: Home card, the sheet, outlines while reading, sent once, Receipt from your photo with both totals, Bank and cards (stubbed server)");
await browser.close(); server.close();
