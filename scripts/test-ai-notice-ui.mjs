// Browser test: the one-time "AI help is now on" notice (worker/ai-choice.js; Connor, 24 Nov 2026: AI on for everyone).
// Stubbed Relay server, made-up people and shops. Checks:
//  1. Relay says it's due with the profile (no request of its own on opening the app); Home shows one small card in
//     "Needs you", nothing floating over the page.
//  2. Tapping it (twice, quickly) opens one sheet that says plainly it's on, what's sent, that Anthropic can't train on it
//     and where to switch it off; Relay is told it's been seen once.
//  3. Got it closes the sheet and the card is gone; opening Relay again doesn't show it, even if Relay hadn't recorded it
//     (this phone remembers, and tells Relay again); another phone doesn't show it once Relay has it.
//  4. AI settings opens Profile, AI help, with both switches.
//  5. Polish: tap targets, text sizes, no symbols as icons, no sideways scroll, in light and dark.
// Phone screenshots (390 wide) go to AION_SHOTS (or /tmp/shots).
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeShows } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.AION_SHOTS || "/tmp/shots"; await mkdir(SHOTS, { recursive: true });
const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const receipts = [{ id: "11111111-1111-4111-8111-111111111111", status: "confirmed", kind: "receipt", gmailId: "m1abcdef", retailer: { name: "Brindle & Co", domain: "brindle.example" },
  orderRef: "BR-1", orderDate: day(-5), totalPence: 4500, currency: "GBP", category: "fashion", categoryLabel: "Fashion", returnable: false, items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 4500 }] }];
const st = { due: true, posts: 0, log: [] };
const browser = await chromium.launch();
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "block" }); await skipInterests(ctx);
  await ctx.route("https://**/*", async route => {
    const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
    const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith("/relay/")) return route.abort();
    st.log.push(m + " " + p);
    if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
    if (p === "/relay/my/ai-notice" && m === "POST") { st.posts++; return j({ ok: true }); }
    if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null, ...(st.due ? { aiNotice: true } : {}) });
    if (p === "/relay/my/ai-reading") return j({ available: true, on: true, choice: null, since: null });
    if (p === "/relay/my/item-kinds") return j({ available: true, on: true, choice: null, kinds: {} });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5, scan: { state: "done", found: 1, finishedAt: Date.now() - 36e5 } });
    if (p === "/relay/my/receipts") return j({ receipts });
    if (p === "/relay/my/purchases") return j({ purchases: [] });
    if (p === "/relay/my/admin/me") return j({ admin: false });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
    if (p === "/relay/my/2fa") return j({ required: true, enrolled: true, verified: true, methods: ["passkey"] });
    return j({});
  });
  const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.goto(origin + "/index.html");
  await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
  return { ctx, page, errors };
}
const measure = (page, scope) => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const out = { small: [], tiny: [], symbols: [], wide: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓+×✕]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    const caps = s.textTransform === "uppercase" || (/[A-Z]/.test(el.textContent) && el.textContent === el.textContent.toUpperCase());
    if (px < 13 && !(caps && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const card = (page) => page.locator("#homePage .h2-feed .h2-item", { hasText: "AI help is now on" });

// 1. Due: one small card in Needs you.
let { ctx, page, errors } = await phone();
await page.reload(); await homeShows(page, "JT");
await card(page).waitFor();
assert.equal(await card(page).count(), 1, "one card");
assert.match(await card(page).innerText(), /What it does, and how to switch it off/);
assert.equal(await page.locator("#homePage .h2-feed h2", { hasText: "Needs you" }).count(), 1, "in Needs you");
assert.ok(!st.log.some(x => /ai-notice|ai-reading|item-kinds/.test(x)), "opening the app asks nothing extra for it: " + st.log.filter(x => /ai/.test(x)).join(", "));
assert.equal(await page.evaluate(() => [...document.querySelectorAll("body > *")].filter(e => /ai help is now on/i.test(e.textContent || "") && getComputedStyle(e).position === "fixed").length), 0, "nothing floating");
await page.screenshot({ path: SHOTS + "/notice-home-after.png" });
console.log("ok - due with the profile: one small card in Needs you, nothing extra asked, nothing floating");

// 2. Tapped twice quickly: one sheet, Relay told once.
// Two taps in a row on the card itself (a quick second tap would otherwise land on the sheet's backdrop).
await card(page).evaluate((c) => { c.click(); c.click(); });
const sheet = page.locator(".rl-back .rl-sheet").last();
await sheet.getByRole("heading", { name: "AI help is now on" }).waitFor();
assert.equal(await page.locator(".rl-back .rl-sheet").count(), 1, "one sheet");
const said = await sheet.innerText();
for (const s of ["Claude, an AI made by Anthropic", "name, addresses, links, phone numbers and card numbers hidden", "Anthropic can't train its AI on any of it", "tap your picture, then AI help", "Switching it off deletes what the AI made"])
  assert.ok(said.includes(s), "says: " + s);
await page.waitForTimeout(400);
assert.equal(st.posts, 1, "seen, told once");
for (const scheme of ["light", "dark"]) {
  await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150);
  assert.deepEqual(await measure(page, ".rl-back .rl-sheet"), { small: [], tiny: [], symbols: [], wide: [] }, "the sheet passes the polish rules (" + scheme + ")");
}
await page.emulateMedia({ colorScheme: "light" });
await page.screenshot({ path: SHOTS + "/notice-sheet-after.png" });
console.log("ok - one sheet for a double tap: on, what's sent, no training, where to switch it off; Relay told once");

// 3. Got it: the card is gone; opening Relay again doesn't show it, even when Relay hadn't recorded it.
await sheet.getByRole("button", { name: "Got it" }).click();
await page.locator(".rl-back .rl-sheet").waitFor({ state: "detached" });
await page.waitForTimeout(300);
assert.equal(await card(page).count(), 0, "gone from Home");
await page.reload(); await homeShows(page, "JT"); await page.waitForTimeout(800);
assert.equal(await card(page).count(), 0, "not shown again on this phone");
assert.equal(st.posts, 2, "and Relay, which still said it was due, is told again");
assert.deepEqual(errors, []);
await ctx.close();
st.due = false;
({ ctx, page, errors } = await phone());
await page.reload(); await homeShows(page, "JT"); await page.waitForTimeout(800);
assert.equal(await card(page).count(), 0, "another phone: not shown once Relay has it");
await ctx.close();
console.log("ok - Got it: gone, and never back on this phone or another");

// 4. AI settings opens Profile, AI help.
st.due = true; st.posts = 0;
({ ctx, page, errors } = await phone());
await page.reload(); await homeShows(page, "JT");
await card(page).click();
await page.locator(".rl-back .rl-sheet").last().getByRole("button", { name: "AI settings" }).click();
await page.getByRole("switch", { name: "AI help with receipts" }).waitFor();
assert.equal(await page.getByRole("switch", { name: "AI help with receipts" }).getAttribute("aria-checked"), "true");
assert.equal(await page.getByRole("switch", { name: "AI for picks" }).getAttribute("aria-checked"), "true");
await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + "/profile-ai-after.png", fullPage: true });
assert.deepEqual(errors, []);
await ctx.close();
console.log("ok - AI settings opens Profile, AI help, with both switches on");
console.log("PASS AI notice UI: once per account, a small card then one sheet, plain words, where to switch off (stubbed server)");
await browser.close(); server.close();
