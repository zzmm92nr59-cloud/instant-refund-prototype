// Browser test: the sign-in for app reviewers in the app. Stubbed Relay server, made-up addresses and codes.
// Checks: a Relay admin turns it on under Profile, Team, sees the address and code with Copy buttons, and turns it off
// (asked first); ordinary members never see it. Signing in with the reviewer's address says no email is sent and asks for
// the code from the instructions; the journey skips connecting an inbox; Home says what to do first instead; Receipts
// points to Home; Profile leaves out the inbox and sign-in settings the account can't have; Discover asks for test shops.
// Every screen passes the polish rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const ADMIN = "ops@relay.test", MEMBER = "jess.tester@relay.test", REVIEW = "relay-review-k7m2q9xw4t@example.com", CODE = "482916";
let st;
const reset = o => { st = { on: false, admin: false, posts: [], catalogue: [], verify: [], name: null, ...o }; };
reset();
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
  if (p === "/relay/shopify/catalogue") { st.catalogue.push(u.search); return j({ published: true, products: [] }); }
  if (p === "/relay/auth/providers") return j({ email: true, google: true, microsoft: true, consent: { version: "v5", text: ["Relay reads order emails."] } });
  // The server marks the reviewer's address: no email is sent for it (worker/review-account.js).
  if (p === "/relay/auth/request") return j(body().email === REVIEW ? { ok: true, review: true } : { ok: true });
  if (p === "/relay/auth/verify-code") {
    const b = body(); st.verify.push(b);
    if (b.email === REVIEW && b.code === CODE) return j({ sessionToken: "R".repeat(43), email: REVIEW, expiresAt: Date.now() + 864e5, reviewAccount: true });
    return j({ error: "invalid_or_expired_code" }, 400);
  }
  if (p === "/relay/my/admin/me") return j(st.admin ? { admin: true, openReports: 0 } : { admin: false });
  if (p === "/relay/my/admin/review-account") {
    if (!st.admin) return j({ error: "not_found" }, 404);
    if (m === "POST") { const b = body(); st.posts.push(b); st.on = b.on; await new Promise(r => setTimeout(r, 150)); }
    return j(st.on ? { on: true, email: REVIEW, code: CODE, since: Date.now() } : { on: false });
  }
  if (p === "/relay/my/profile" && m === "POST") { st.name = body().name; return j({ email: REVIEW, name: st.name, photo: null }); }
  if (p === "/relay/my/profile") return j({ email: st.admin ? ADMIN : st.member ? MEMBER : REVIEW, name: st.admin ? "Ops" : st.name, photo: null });
  // Members and the admin agreed to email reading; the reviewer account never has (it has no inbox).
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: Boolean(st.admin || st.member), text: [], gmailAvailable: true, outlookAvailable: true });
  if (p === "/relay/my/gmail" && m === "GET") return j({ connected: false });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  if (p === "/relay/my/2fa") return j({ app: false, text: false });
  if (p === "/relay/my/phone") return j({ available: true, ending: null });
  if (p === "/relay/my/card") return j({ enabled: true, testMode: false, card: null });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
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
    if (/[◎✦↻▶⌂◈▤⇄→✓+]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
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
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(120);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/review-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png", fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const signedInAs = async email => {
  await page.goto(origin + "/index.html");
  await page.evaluate(e => { localStorage.clear(); localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); }, email);
  await page.goto(origin + "/index.html");
};
const profile = async () => { await page.evaluate(() => window.go("me")); await page.locator("#mePage .rl-arow").first().waitFor(); };
const view = page.locator("#mePage");

// 1. Ordinary members never see the reviewer sign-in.
reset({ member: true });
await signedInAs(MEMBER);
await profile();
await view.locator(".rl-arow", { hasText: "Two-step sign-in" }).waitFor();
await page.waitForTimeout(300);
assert.equal(await view.getByText("Sign-in for app reviewers").count(), 0);
assert.equal(await view.locator(".rl-ptile", { hasText: "Email connection" }).count(), 1, "members keep the inbox rows");
console.log("ok - members don't see the reviewer sign-in, and keep every row of their own");

// 2. An admin turns it on, copies the address and code, and turns it off (asked first).
reset({ admin: true });
await signedInAs(ADMIN);
await profile();
const revRow = view.locator(".rl-arow", { hasText: "Sign-in for app reviewers" });
await revRow.getByText("Off").waitFor();
await revRow.click();
await view.getByRole("button", { name: "Turn on" }).waitFor();
await view.getByText(/Shopify's reviewers need an account they can sign in to without an emailed code/).waitFor();
await polished("admin off", "#mePage");
const turnOn = view.getByRole("button", { name: "Turn on" });
await turnOn.dblclick();
await view.getByText(REVIEW).waitFor();
assert.deepEqual(st.posts, [{ on: true }], "a double tap turns it on once");
await view.getByText(CODE).waitFor();
await view.getByText("On. Copy the email and code into the testing instructions.").waitFor();
await view.getByText(/anyone with the code can sign in: share it only with Shopify/).waitFor();
await polished("admin on", "#mePage");
await view.getByRole("button", { name: "Copy the code" }).click();
await view.getByRole("button", { name: "Copy the code" }).getByText("Copied").waitFor();
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), CODE);
await view.getByRole("button", { name: "Copy the email" }).click();
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), REVIEW);
await view.getByRole("button", { name: "Turn off" }).click();
const dialog = page.locator("[role=alertdialog]");
await dialog.getByText(/Its account and everything in it are deleted/).waitFor();
await dialog.getByRole("button", { name: "Cancel" }).click();
assert.equal(st.posts.length, 1, "Cancel changes nothing");
await view.getByRole("button", { name: "Turn off" }).click();
await dialog.getByRole("button", { name: "Turn off" }).click();
await view.getByRole("button", { name: "Turn on" }).waitFor();
await view.getByText("Off. The account and everything in it are deleted.").waitFor();
assert.deepEqual(st.posts, [{ on: true }, { on: false }]);
await view.getByRole("button", { name: "Back to Profile" }).click();
await revRow.getByText("Off").waitFor();
console.log("ok - an admin turns it on (once, even on a double tap), copies the address and code, and turns it off after confirming");

// 3. A reviewer signs in with the address and code: told no email is sent, no inbox step, a clear Home.
reset();
await page.goto(origin + "/index.html");
await page.evaluate(() => localStorage.clear());
await page.goto(origin + "/index.html");
const sheet = page.locator(".rl-sheet");
await page.getByRole("button", { name: "Get started" }).click();
await sheet.getByRole("button", { name: "Continue with email" }).click();
await page.locator("#rl-signin-email").fill(REVIEW);
await sheet.getByRole("button", { name: "Email me a sign-in link" }).click();
await sheet.getByRole("heading", { name: "Enter your code" }).waitFor();
await sheet.getByText("Type the 6-digit code from Relay's instructions for reviewers. No email is sent to this address.").waitFor();
assert.equal(await sheet.getByText(/We sent a sign-in link/).count(), 0, "it doesn't claim an email was sent");
await polished("code", ".rl-sheet");
await page.locator("#rl-signin-code").fill("000000");
await sheet.getByText("That code is wrong or has expired").waitFor();
await page.locator("#rl-signin-code").fill(CODE);
await sheet.getByRole("heading", { name: "What should we call you?" }).waitFor();
await page.locator("#rl-onboard-name").fill("App Review");
await sheet.getByRole("button", { name: "Continue" }).click();
await sheet.getByRole("heading", { name: "You're all set, App." }).waitFor();
assert.equal(await sheet.getByRole("heading", { name: "Bring in your receipts" }).count(), 0, "no inbox step");
await sheet.getByText("Orders you place at shops that use Relay, with this email address, show up on Home.").waitFor();
await sheet.getByText("Swap a size or colour before the shop sends your order").waitFor();
assert.equal(await sheet.getByText(/connect your email/i).count(), 0);
await polished("all set", ".rl-sheet");
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("relay.session.v1")).review), true);
await sheet.getByRole("button", { name: "Go to Home" }).click();
const card = page.locator(".rl-po", { hasText: "Shop with this email" });
await card.waitFor();
assert.match(await card.innerText(), new RegExp("Orders you place at shops that use Relay with " + REVIEW.replace(/\./g, "\\.") + " show up here\\. You can swap a size or colour until the shop sends the order\\."));
assert.equal(await page.getByRole("button", { name: "Connect your email" }).count(), 0, "Home doesn't offer an inbox");
await polished("home", ".rl-po");
console.log("ok - the reviewer is told no email is sent, skips the inbox step, and Home says what to do first");

// 4. Receipts points to Home; Profile leaves out what the account can't have; Discover includes test shops.
await page.evaluate(() => window.go("receipts"));
await page.getByRole("heading", { name: "Your orders are on Home" }).waitFor();
assert.equal(await page.getByRole("button", { name: /Connect Gmail|Connect Outlook|Review and agree/ }).count(), 0);
await polished("receipts", ".rl-empty");
await page.getByRole("button", { name: "Go to Home" }).click();
await card.waitFor();
await profile();
await view.locator(".rl-arow", { hasText: "Devices" }).waitFor();
await view.locator(".rl-ptile", { hasText: "Shop orders" }).getByText("None yet").waitFor();
await page.waitForTimeout(400);
for (const gone of ["Email connection", "Add a missing receipt", "Face ID & passkeys", "Two-step sign-in", "Phone number", "Card for swaps", "Email permission"])
  assert.equal(await view.locator(".rl-arow, .rl-ptile", { hasText: gone }).count(), 0, gone + " isn't offered");
await view.getByText("This account is shared by Relay's reviewers, so a passkey, two-step sign-in, a phone number or a card can't be added to it.").waitFor();
assert.equal(await view.locator("#rl-wrapped").count(), 0, "no Wrapped: it's made from inbox receipts");
await polished("profile", "#mePage");
await view.locator(".rl-ptile", { hasText: "Shop orders" }).click();
await view.getByText("None yet. An order shows up here when a shop that uses Relay confirms one placed with " + REVIEW + ".").waitFor();
st.catalogue = [];
await page.evaluate(() => window.go("discover"));
await page.waitForFunction(() => true);
for (let i = 0; i < 40 && !st.catalogue.length; i++) await page.waitForTimeout(100);
assert.ok(st.catalogue.length, "Discover asked for the catalogue");
assert.ok(st.catalogue.every(q => q === "?test=1"), "the reviewer's Discover includes test shops: " + st.catalogue.join(","));
console.log("ok - Receipts points to Home, Profile leaves out the inbox and sign-in settings, Discover includes test shops");

// 5. A member's Discover still never asks for test shops.
reset({ member: true });
await signedInAs(MEMBER);
st.catalogue = [];
await page.evaluate(() => window.go("discover"));
for (let i = 0; i < 40 && !st.catalogue.length; i++) await page.waitForTimeout(100);
assert.ok(st.catalogue.length && st.catalogue.every(q => q === ""), "members' Discover doesn't ask for test shops: " + st.catalogue.join(","));
console.log("ok - members' Discover never asks for test shops");

assert.deepEqual(errors, [], "no page errors");
console.log("PASS reviewer sign-in in the app: admin on and off, the reviewer's sign-in and journey, Home, Receipts, Profile and Discover");
await browser.close(); server.close();
