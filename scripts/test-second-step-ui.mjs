// Browser test: two-step sign-in for everyone (worker/second-step.js). Stubbed Relay server, made-up people.
// Checks: a signed-in account without a second step gets "Protect your account" (no way past it but setting one up or
// signing out), sets up the authenticator app (once per tap), and the app carries on; a new sign-up protects the account
// before the name step; an account whose only second step is a passkey finishes signing in with it; the last second step
// can't be turned off (said in plain words); Relay's team are asked to sign in again for team tools. Polished, light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const TOKEN = "T".repeat(43);
const OPEN = /^\/relay\/(me|auth\/logout|my\/(second-step|2fa(\/.*)?|passkeys(\/.*)?|phone(\/.*)?|profile|consent|delete|devices\/sign-out-others|admin\/me))$/;
let st;
const reset = (o = {}) => { st = { email: "jess.tester@example.com", name: "Jess", done: false, app: false, passkeys: 0, enables: [], disables: [], admin: { admin: false }, verify: null, gated: 0, ...o }; };
reset();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  const body = () => { try { return JSON.parse(req.postData() || "{}"); } catch { return {}; } };
  if (p === "/relay/auth/providers") return j({ email: true, google: false, microsoft: false });
  if (p === "/relay/auth/request") return j({ ok: true });
  if (p === "/relay/auth/verify-code") return j(st.verify || { sessionToken: TOKEN, email: st.email, expiresAt: Date.now() + 864e5 });
  if (p === "/relay/auth/logout") return j({ ok: true });
  // The server's rule: until the account has a second step, only these answer.
  if (p.startsWith("/relay/my/") && !st.done && !OPEN.test(p)) { st.gated++; return j({ error: "second_step_needed" }, 403); }
  if (p === "/relay/my/second-step") return j({ required: true, done: st.done, checked: st.done, app: st.app, text: false, passkeys: st.passkeys });
  if (p === "/relay/my/2fa" && m === "GET") return j({ enabled: st.app, app: st.app, text: false, phoneEnding: null, textAvailable: true, recoveryCodesLeft: st.app ? 10 : 0 });
  if (p === "/relay/my/2fa/setup") return j({ secret: "ABCD EFGH IJKL MNOP QRST", otpauthUrl: "otpauth://totp/Relay:jess?secret=ABCDEFGHIJKLMNOPQRST&issuer=Relay" });
  if (p === "/relay/my/2fa/enable") { st.enables.push(body()); await new Promise(r => setTimeout(r, 250));
    if (body().code !== "123456") return j({ error: "invalid_code" }, 400);
    st.app = true; st.done = true; return j({ ok: true, recoveryCodes: ["aaaaa-11111", "bbbbb-22222"] }); }
  if (p === "/relay/my/2fa/disable") { st.disables.push(body()); return j({ error: "last_second_step" }, 409); }
  if (p === "/relay/my/passkeys") return j({ passkeys: [], rpId: "127.0.0.1" });
  if (p === "/relay/my/admin/me") return j(st.admin);
  if (p === "/relay/my/profile" && m === "GET") return j({ email: st.email, name: st.name, photo: null });
  if (p === "/relay/my/profile" && m === "POST") { st.name = body().name; return j({ email: st.email, name: st.name, photo: null }); }
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: st.email, lastScanAt: Date.now() - 600e3, maxInboxes: 5 });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
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
  await page.evaluate(() => getSelection().removeAllRanges());
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/second-step-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const signedIn = async () => {
  await page.goto(origin + "/index.html");
  await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), st.email);
  await page.reload();
};
const protect = page.locator('.rl-sheet[aria-label="Protect your account"]');

// 1. Signed in, but the account has no second step: "Protect your account", and only setting one up or signing out.
await signedIn();
await protect.getByRole("heading", { name: "Protect your account" }).waitFor();
assert.match(await protect.innerText(), /Relay asks everyone for a second step when they sign in, so nobody can get into your account with just your email\./);
for (const name of ["Use Face ID or screen lock", "Set up authenticator app", "Turn on codes by text", "Sign out"]) await protect.getByRole("button", { name }).waitFor();
assert.equal(await protect.getByRole("button", { name: "Close" }).count(), 0, "can't be closed without a second step");
assert.ok(st.gated > 0, "the app's own requests were refused by the server's rule");
assert.equal(await page.locator('.rl-sheet[aria-label="Protect your account"]').count(), 1, "shown once, however many requests were refused");
await polished("protect", '.rl-sheet[aria-label="Protect your account"]');
console.log("ok - no second step yet: Protect your account, once, with no way past but setting one up or signing out");

// 2. The authenticator app: the key, a code (one tap counted once), recovery codes, then Relay carries on.
await protect.getByRole("button", { name: "Set up authenticator app" }).click();
await protect.getByText("ABCD EFGH IJKL MNOP QRST").waitFor();
// Six digits send it by themselves; a tap on Turn on while it's checking does nothing more.
await protect.getByLabel("6-digit code from the app").fill("123456");
await protect.getByRole("button", { name: "Turn on" }).click({ force: true, noWaitAfter: true }).catch(() => {});
await protect.getByText("aaaaa-11111").waitFor();
assert.equal(st.enables.length, 1, "turned on once");
await polished("recovery codes", '.rl-sheet[aria-label="Protect your account"]');
await protect.getByRole("button", { name: "I've saved them" }).click();
await protect.waitFor({ state: "detached" });
const before = st.gated;
await page.evaluate(() => window.go("receipts")); await page.waitForTimeout(600);
assert.equal(st.gated, before, "nothing refused once the account has a second step");
assert.equal(await protect.count(), 0);
console.log("ok - the authenticator app set up (once per tap), recovery codes shown, and Relay carries on");

// 3. The last second step can't be turned off: said in plain words.
await page.evaluate(() => window.go("me"));
await page.locator(".rl-arow", { hasText: "Security and privacy" }).click();
await page.locator(".rl-arow", { hasText: "Two-step sign-in" }).click();
await page.getByRole("button", { name: "Turn off the app" }).click();
await page.getByLabel("App code or recovery code").fill("654321"); // six digits send it by themselves
await page.getByText("Relay needs at least one second step for signing in. Add another way first, then turn this one off.").waitFor();
assert.equal(st.disables.length, 1);
console.log("ok - the last second step can't be turned off, in plain words");

// 4. Relay's team, with a sign-in from before: asked to sign in again for team tools.
reset({ done: true, app: true, admin: { admin: false, signInAgain: true } });
await signedIn();
await page.evaluate(() => window.go("me"));
await page.locator(".rl-arow", { hasText: "Sign in again for team tools" }).waitFor();
assert.equal(await page.locator(".rl-arow", { hasText: "Relay health" }).count(), 0, "no team tools until then");
await polished("team sign in again", "#mePage");
console.log("ok - the team are asked to sign in again before team tools show");

// 5. A new sign-up: the account is protected first, then the journey carries on (name).
reset({ name: null });
await page.goto(origin + "/index.html");
await page.evaluate(() => { localStorage.clear(); });
await page.reload();
await page.getByRole("button", { name: "Get started" }).click();
await page.getByRole("button", { name: "Continue with email" }).click();
await page.locator("#rl-signin-email").fill(st.email);
await page.getByRole("button", { name: "Email me a sign-in link" }).click();
await page.getByRole("heading", { name: "Check your inbox" }).waitFor();
await page.locator("#rl-signin-code").fill("123456"); // six digits go by themselves
await protect.getByRole("heading", { name: "Protect your account" }).waitFor();
await protect.getByRole("button", { name: "Set up authenticator app" }).click();
await protect.getByLabel("6-digit code from the app").fill("123456");
await protect.getByRole("button", { name: "I've saved them" }).click();
await page.getByRole("heading", { name: /What should we call you/ }).waitFor();
console.log("ok - a new sign-up protects the account first, then carries on with the journey");

// 6. An account whose only second step is a passkey: the email code is followed by Face ID.
reset({ done: true, passkeys: 1, verify: { needsSecondStep: true, methods: ["passkey"], email: "jess.tester@example.com" } });
await page.evaluate(() => { localStorage.clear(); });
await page.reload();
await page.getByRole("button", { name: "Get started" }).click();
await page.getByRole("button", { name: "Continue with email" }).click();
await page.locator("#rl-signin-email").fill(st.email);
await page.getByRole("button", { name: "Email me a sign-in link" }).click();
await page.getByRole("heading", { name: "Check your inbox" }).waitFor();
await page.locator("#rl-signin-code").fill("123456");
await page.getByRole("heading", { name: "Finish with Face ID" }).waitFor();
await page.getByRole("button", { name: "Use Face ID or a passkey" }).waitFor();
assert.equal(await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem("relay.session.v1") || "null"))), false, "not signed in on the email code alone");
await polished("finish with passkey", ".rl-sheet");
console.log("ok - a passkey-only account finishes signing in with its passkey");

assert.deepEqual(errors, []);
await browser.close(); server.close();
console.log("PASS two-step sign-in for everyone: protect the account, set it up once, the last can't go, team signs in again, passkey finish");
