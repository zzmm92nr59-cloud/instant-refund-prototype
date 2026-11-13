// Browser test: adding a missing receipt. Stubbed Relay server, made-up person and invented shops; the inbox search,
// adding and pasting are FAKED here (the real reading is checked in test-gmail).
// Checks: Receipts' "Add a missing receipt" (+) opens one page; typing searches the inbox by itself once typing pauses (not on
// every letter), and an older, slower search never replaces a newer one; the shopper's own shops are one tap away; Add adds
// once even on a double tap; an email that isn't an order says so; Paste reads what was copied in one tap and shows what
// was added, and when the phone won't share the clipboard a box to paste into appears; forwarding from another inbox names
// the inbox Relay reads; without a connected inbox the page offers connecting and pasting, and the Receipts page lists what
// was pasted. Every screen passes the polish rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", TOKEN = "T".repeat(43);
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const shortDay = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const card = (id, shop, ref, n, extra = {}) => ({ id, status: "pending", kind: "receipt", retailer: { name: shop, domain: null }, orderRef: ref, orderDate: day(-n), totalPence: 2500 + n,
  currency: "GBP", category: "fashion", categoryLabel: "Fashion", returnable: true, items: [{ name: "Item " + ref, qty: 1, pricePence: 2500 + n, category: "fashion" }], returns: null, ...extra });
// The shopper's receipts: Kestrel Outdoor most, then Harlow & Co, then Fernway Books.
const KNOWN = [card("a1111111-1111-4111-8111-111111111111", "Kestrel Outdoor", "KO-1", 5), card("a2222222-2222-4222-8222-222222222222", "Kestrel Outdoor", "KO-2", 40),
  card("a3333333-3333-4333-8333-333333333333", "Kestrel Outdoor", "KO-3", 90), card("a4444444-4444-4444-8444-444444444444", "Harlow & Co", "HC-1", 12),
  card("a5555555-5555-4555-8555-555555555555", "Harlow & Co", "HC-2", 70), card("a6666666-6666-4666-8666-666666666666", "Fernway Books", "FB-1", 20)];
const PASTED = "Your Kestrel Outdoor order is confirmed\nKestrel Outdoor <orders@kestreloutdoor.example>\nto me\n" + day(-1) + "\nOrder number: KO-55120\nTrail runner shoes - Qty 1 - £89.00\nOrder total: £89.00\n";
let st;
const reset = o => { st = { connected: true, receipts: KNOWN, finds: [], adds: [], pastes: [], slow: null, ...o }; };
reset();
const results = {
  kes: [{ id: "old1", subject: "An older, slower answer", from: "Kestrel Outdoor", date: day(-300), added: false }],
  kestrel: [{ id: "m1", subject: "Your Kestrel Outdoor order is confirmed", from: "Kestrel Outdoor", date: day(-2), added: false },
    { id: "m2", subject: "New season: the trail range is back", from: "Kestrel Outdoor", date: day(-3), added: false },
    { id: "m3", subject: "Your Kestrel Outdoor order has shipped", from: "Kestrel Outdoor", date: day(-30), added: true }],
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  const body = () => { try { return JSON.parse(route.request().postData() || "{}"); } catch { return {}; } };
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true, outlookAvailable: false });
  if (p === "/relay/my/gmail" && m === "GET") return j(st.connected ? { connected: true, provider: "google", email: EMAIL, googleEmail: EMAIL, lastScanAt: Date.now() - 6e5 } : { connected: false });
  if (p === "/relay/my/gmail/find") {
    const q = body().query; st.finds.push(q);
    if (q === "kes") await new Promise(r => setTimeout(r, 1500));
    if (q === "broken") return j({ error: "gmail_reconnect_needed" }, 401);
    return j({ results: results[q.toLowerCase()] || [] });
  }
  if (p === "/relay/my/gmail/add") {
    const id = body().messageId; st.adds.push(id); await new Promise(r => setTimeout(r, 300));
    return j(id === "m1" ? { ok: true, kind: "receipt", store: "Kestrel Outdoor", orderRef: "KO-55119" } : { ok: false, reason: "not_recognised", signals: { subject: false, body: false } });
  }
  if (p === "/relay/my/receipts/add-pasted") {
    const text = body().email; st.pastes.push(text); await new Promise(r => setTimeout(r, 300));
    if (!/Order number/.test(text)) return j({ ok: false, reason: "not_recognised" });
    return j({ ok: true, id: "b1111111-1111-4111-8111-111111111111", again: false, kind: "receipt", store: "Kestrel Outdoor", orderRef: "KO-55120", orderDate: day(-1),
      totalPence: 8900, currency: "GBP", items: [{ name: "Trail runner shoes", qty: 1, pricePence: 8900 }] });
  }
  if (p === "/relay/my/receipts") return j({ receipts: st.receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
// The polish rules, and readable colours, on whatever is showing.
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; }; // color-mix() comes back as color(srgb 0–1)
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c; } return rgb(getComputedStyle(document.body).backgroundColor); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " input, " + scope + " textarea")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el);
    if (parseFloat(s.fontSize) < 13 && !(s.textTransform === "uppercase" && parseFloat(s.fontSize) >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + s.fontSize);
    const a = lum(rgb(s.color)), b = lum(bgOf(el)), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3 && !el.closest("button:disabled")) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const polished = async (where, scope = ".rl-back .rl-sheet") => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(80);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/add-receipt-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png", fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const signedIn = async () => {
  await page.goto(origin + "/index.html");
  await page.evaluate(([e, t]) => { localStorage.clear(); localStorage.setItem("relay.session.v1", JSON.stringify({ token: t, email: e, expiresAt: 9e12 })); }, [EMAIL, TOKEN]);
  await page.reload();
};
const view = page.locator(".rl-back .rl-sheet").last();

// 1. Receipts -> Add a missing receipt (the + at the top): one page, with the shopper's own shops one tap away.
await signedIn();
await page.evaluate(() => window.go("receipts"));
const row = page.getByRole("button", { name: "Add a missing receipt" });
await row.waitFor();
assert.ok((await row.boundingBox()).height >= 44, "a 44px button");
assert.equal(await row.locator("svg").count(), 1, "a drawn plus, not a symbol");
await row.click();
await view.getByRole("heading", { name: "Add a receipt" }).waitFor();
await view.getByText("Relay brings your receipts in by itself. Missing one? Find it here.").waitFor();
const q = page.locator("#rl-ar-q");
await q.waitFor();
assert.equal(await q.getAttribute("placeholder"), "Search your Gmail");
assert.deepEqual(await page.locator(".rl-ar-chip").allInnerTexts(), ["Kestrel Outdoor", "Harlow & Co", "Fernway Books"], "the shops this shopper buys from most");
await view.getByText("Add that inbox to Relay as well, or forward the email to " + EMAIL + ".").waitFor();
await view.getByRole("button", { name: "Add a Gmail inbox" }).waitFor();
await polished("page");
console.log("ok - Receipts' Add a missing receipt opens one page: search, the shopper's own shops, paste, forward");

// 2. Typing searches by itself once typing pauses; a slower, older answer never replaces a newer one.
await q.pressSequentially("kes", { delay: 70 });
await page.waitForTimeout(650);
assert.deepEqual(st.finds, ["kes"], "one search after a pause, not one per letter");
await view.getByText("Searching Gmail…").waitFor();
await q.pressSequentially("trel", { delay: 70 });
await view.getByText("Your Kestrel Outdoor order is confirmed").waitFor();
await page.waitForTimeout(1600);
assert.deepEqual(st.finds, ["kes", "kestrel"]);
assert.equal(await view.getByText("An older, slower answer").count(), 0, "the older search's answer arrived later and was left out");
assert.equal(await page.locator(".rl-ar-row").count(), 3);
const r1 = page.locator(".rl-ar-row", { hasText: "Your Kestrel Outdoor order is confirmed" });
assert.match(await r1.innerText(), new RegExp("Kestrel Outdoor · " + shortDay(day(-2))));
const r3 = page.locator(".rl-ar-row", { hasText: "has shipped" });
assert.equal(await r3.locator(".rl-ar-add").innerText(), "Added"); assert.ok(await r3.locator(".rl-ar-add").isDisabled(), "already added");
await view.getByText("Tap Add on the order email.").waitFor();
await polished("results");
console.log("ok - the inbox is searched as you type (after a pause), and only the newest search is shown");

// 3. Add: once, even on a double tap; an email that isn't an order says so.
await r1.locator(".rl-ar-add").dblclick();
await r1.getByText("In your Receipts now.").waitFor();
assert.deepEqual(st.adds, ["m1"], "added once");
assert.equal(await r1.locator(".rl-ar-add").innerText(), "Added");
const r2 = page.locator(".rl-ar-row", { hasText: "trail range is back" });
await r2.locator(".rl-ar-add").click();
await r2.getByText("That one isn't an order, delivery or return email.").waitFor();
assert.equal(await r2.locator(".rl-ar-add").innerText(), "Add");
await polished("added");
console.log("ok - Add adds once on a double tap; a newsletter is explained in plain English");

// 4. One tap on a shop searches straight away; nothing found says what to try; a broken connection says what to do.
await page.locator(".rl-ar-chip", { hasText: "Harlow & Co" }).click();
await view.getByText("Nothing in Gmail for “Harlow & Co”. Try the shop's name or the order number.").waitFor();
assert.equal(st.finds.at(-1), "Harlow & Co"); assert.equal(await q.inputValue(), "Harlow & Co");
await q.fill("broken"); await page.waitForTimeout(600);
await view.getByText("Gmail needs connecting again first. Tap your picture at the top of the screen, then Inboxes, and tap Connect again.").waitFor();
await q.fill(""); await page.waitForTimeout(600);
assert.equal(await page.locator(".rl-ar-row").count(), 0, "clearing the search clears the list");
console.log("ok - a shop is one tap away; nothing found and a broken connection are explained");

// 5. Paste: one tap reads what was copied; a double tap adds it once; what was added is shown with a way to it.
await page.evaluate(t => navigator.clipboard.writeText(t), PASTED);
await view.getByRole("button", { name: "Paste", exact: true }).dblclick();
await view.getByText("Added: Kestrel Outdoor").waitFor();
assert.equal(st.pastes.length, 1, "pasted once"); assert.equal(st.pastes[0], PASTED, "the copied email, as copied");
const done = page.locator(".rl-ar-done");
assert.match(await done.innerText(), new RegExp("Order KO-55120 · " + shortDay(day(-1)) + " · £89\\.00"));
await done.getByText("Trail runner shoes").waitFor();
await polished("pasted");
// Something that isn't an order email.
await page.evaluate(() => navigator.clipboard.writeText("Hi Jess, are we still on for Friday? Let me know what time suits you best."));
await view.getByRole("button", { name: "Paste", exact: true }).click();
await view.getByText("That doesn't look like an order, delivery or return email. Copy the whole email and try again.").waitFor();
assert.equal(await page.locator(".rl-ar-done").count(), 0, "no Added card for it");
// Too short to be an email: said at once, nothing sent.
await page.evaluate(() => navigator.clipboard.writeText("KO-55120"));
const before = st.pastes.length;
await view.getByRole("button", { name: "Paste", exact: true }).click();
await view.getByText(/That's too short to be an order email/).waitFor();
assert.equal(st.pastes.length, before, "nothing sent");
console.log("ok - Paste reads the copied email in one tap (once on a double tap), shows what was added, and explains what it can't add");

// 6. When the phone won't share what was copied, a box to paste into appears, and pasting into it adds the receipt.
await page.evaluate(() => { navigator.clipboard.readText = () => Promise.reject(new Error("NotAllowedError")); });
await page.waitForTimeout(450); // (two taps on one button within 400ms count as one)
await view.getByRole("button", { name: "Paste", exact: true }).click();
const box = page.getByRole("textbox", { name: "The order email" });
await box.waitFor();
assert.ok(await box.evaluate(el => document.activeElement === el), "the box is ready to paste into");
assert.equal(await box.getAttribute("placeholder"), "Press and hold here, then tap Paste");
await view.getByRole("button", { name: "Add it", exact: true }).waitFor();
await polished("paste box");
await box.evaluate((el, t) => { const dt = new DataTransfer(); dt.setData("text/plain", t); el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, PASTED);
await view.getByText("Added: Kestrel Outdoor").waitFor();
assert.equal(st.pastes.at(-1), PASTED);
assert.equal(await box.isVisible(), false, "the box goes once it's added");
// A keyboard that types the copied text in (no paste event): "Add it" reads the box.
await page.waitForTimeout(450);
await view.getByRole("button", { name: "Paste", exact: true }).click();
await box.fill(PASTED.replace("KO-55120", "KO-55130"));
await view.getByRole("button", { name: "Add it", exact: true }).click();
await view.getByText("Added: Kestrel Outdoor").waitFor();
assert.match(st.pastes.at(-1), /KO-55130/);
console.log("ok - without clipboard access a box appears, focused; pasting into it (or Add it) adds the receipt");

// 7. Forwarding from another inbox: the address Relay reads, one tap to copy.
await view.getByRole("button", { name: "Copy " + EMAIL }).click();
await view.getByRole("button", { name: "Copied" }).waitFor();
assert.equal(await page.evaluate(() => { delete navigator.clipboard.readText; return navigator.clipboard.readText(); }), EMAIL, "the address is what was copied");
// The way to it: Receipts.
await done.getByRole("button", { name: "See it in Receipts" }).click();
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
assert.deepEqual(errors, [], "no page errors");
console.log("ok - forwarding names the inbox Relay reads (Copy works); See it in Receipts goes there");

// 8. From the Receipts page: "Missing a receipt? Add it" opens the same page over Receipts, with a Back button.
await page.getByRole("button", { name: "Add a missing receipt" }).click();
const sheet = page.locator(".rl-sheet");
await sheet.getByRole("heading", { name: "Add a receipt" }).waitFor();
await sheet.locator("#rl-ar-q").waitFor();
await polished("from receipts", ".rl-sheet");
await sheet.getByRole("button", { name: "Back", exact: true }).click();
await sheet.waitFor({ state: "detached" }).catch(() => {});
console.log("ok - the Receipts page's link opens the same page, with Back");

// 9. No inbox connected: the page offers connecting and pasting (no search), and what was pasted shows on Receipts.
reset({ connected: false, receipts: [card("c1111111-1111-4111-8111-111111111111", "Kestrel Outdoor", "KO-55120", 1)] });
await signedIn();
await page.evaluate(() => window.go("receipts"));
await page.getByRole("button", { name: "Connect Gmail" }).waitFor();
await page.getByRole("heading", { name: "Receipts you added" }).waitFor();
await page.locator("#view").getByText("Kestrel Outdoor · KO-55120").waitFor();
assert.match(await page.locator("#view .rl-order").first().innerText(), new RegExp("£25\\.01 · " + shortDay(day(-1)).replace(" ", " ")), "the date is written out");
await polished("receipts not connected", "#view");
await page.getByRole("button", { name: "Or add a receipt yourself" }).click();
await sheet.getByText("Let Relay find them for you").waitFor();
assert.equal(await sheet.getByText("Relay brings your receipts in by itself. Missing one? Find it here.").count(), 0, "not said before an inbox is connected");
assert.equal(await sheet.locator("#rl-ar-q").count(), 0, "no inbox to search");
await sheet.getByRole("button", { name: "Paste", exact: true }).waitFor();
await sheet.getByRole("button", { name: "Connect your email" }).waitFor();
await polished("page not connected", ".rl-sheet");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS add a receipt: inbox search as you type, one-tap paste, forwarding, and the not-connected page (stubbed server)");
await browser.close(); server.close();
