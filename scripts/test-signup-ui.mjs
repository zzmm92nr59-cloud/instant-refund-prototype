// Browser test: the sign-up journey. Stubbed Relay server, FAKE Google/Microsoft pages, made-up people.
// Checks: Google (and Microsoft) sign in AND connect the inbox in one visit after the wording is agreed, so nobody signs in
// twice; the scan starts at once and its count shows while the name is added; the name Google gave is offered, not saved
// unasked; email sign-in with a Gmail address points to the one-step route; email-link people connect once and come back
// to "You're all set"; someone already set up goes straight to Home; every step passes the polish rules.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const TOKEN = "S".repeat(43), LINK = "L".repeat(43);
const CONSENT = { version: "2026-11-v5", text: ["To work, Relay needs to see your online and in-store receipts.", "Relay never sends email from your account."] };
let st;
const reset = (o = {}) => { st = { email: "jess.tester@gmail.com", name: null, accepted: false, connected: false, provider: null, scanCalls: 0, starts: [], connects: 0, consentPosts: 0, profilePosts: [], verify: {}, ...o }; };
reset();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  const body = () => { try { return JSON.parse(route.request().postData() || "{}"); } catch { return {}; } };
  if (p === "/relay/auth/providers") return j({ email: true, google: true, microsoft: true, consent: CONSENT });
  if (p === "/relay/auth/google/start" || p === "/relay/auth/microsoft/start") { st.starts.push({ p, ...body() }); return j({ url: p.includes("google") ? "https://accounts.google.com/o/oauth2/v2/auth?x=1" : "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?x=1" }); }
  if (p === "/relay/auth/verify") { Object.assign(st, st.onVerify || {}); return j({ sessionToken: TOKEN, email: st.email, expiresAt: Date.now() + 864e5, ...st.verify }); }
  if (p === "/relay/auth/request") return j({ ok: true });
  if (p === "/relay/auth/verify-code") return body().code === "123456" ? j({ sessionToken: TOKEN, email: st.email, expiresAt: Date.now() + 864e5 }) : j({ error: "invalid_or_expired_code" }, 400);
  if (p === "/relay/my/profile" && m === "GET") return j({ email: st.email, name: st.name, photo: null });
  if (p === "/relay/my/profile" && m === "POST") { const b = body(); st.profilePosts.push(b); st.name = b.name; return j({ email: st.email, name: st.name, photo: null }); }
  if (p === "/relay/my/consent" && m === "GET") return j({ ...CONSENT, accepted: st.accepted, acceptedEarlier: false, gmailAvailable: true, outlookAvailable: true });
  if (p === "/relay/my/consent" && m === "POST") { st.consentPosts++; st.accepted = body().version === CONSENT.version; return j({ ok: true }); }
  if (p === "/relay/my/gmail" && m === "GET") return j(st.connected ? { connected: true, provider: st.provider, email: st.email, scan: { state: "running", found: 0 } } : { connected: false });
  if (p === "/relay/my/gmail/connect") { st.connects++; return j({ url: body().provider === "microsoft" ? "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?c=1" : "https://accounts.google.com/o/oauth2/v2/auth?c=1" }); }
  if (p === "/relay/my/gmail/scan") {
    const n = ++st.scanCalls; await new Promise(r => setTimeout(r, 250));
    const found = [3, 7, 12][Math.min(n - 1, 2)], more = n < 3;
    return j({ ok: true, more, added: 0, cursor: more ? "c" + n : null, job: { state: more ? "running" : "done", found, scannedBack: more ? "2026-0" + (8 - n * 2) + "-01" : "2025-07-01" } });
  }
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  return j({});
});
// Registered last so they win over the catch-all above: stand-ins for Google's and Microsoft's own pages.
await ctx.route("https://accounts.google.com/**", r => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>FAKE Google</h1>" }));
await ctx.route("https://login.microsoftonline.com/**", r => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>FAKE Microsoft</h1>" }));
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
const sheet = page.locator(".rl-sheet");
// The polish rules on whatever step is showing.
const measure = () => page.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const out = { small: [], tiny: [], symbols: [] };
  for (const el of document.querySelectorAll(".rl-sheet button, .rl-sheet a, .rl-sheet input, .rl-sheet summary")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(".rl-sheet *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    if (parseFloat(getComputedStyle(el).fontSize) < 12) out.tiny.push(el.textContent.trim().slice(0, 30));
  }
  return out;
});
const polished = async where => { const m = await measure(); assert.deepEqual(m, { small: [], tiny: [], symbols: [] }, where); };
const backFrom = async (host, hash) => {
  // Coming back from Google or Microsoft lands on the app with the sign-in (or connection) result in the address.
  await page.waitForURL(new RegExp(host));
  await page.goto(origin + "/index.html" + hash);
};

// 1. Google, one step: welcome → what Relay does → (Google once) → name, with the scan already counting → all set.
await page.goto(origin + "/index.html");
await page.getByRole("button", { name: "Sign in or create an account" }).click();
await sheet.getByRole("heading", { name: "Everything you buy, in one place." }).waitFor();
await sheet.getByRole("button", { name: "Continue with Google" }).waitFor();
assert.ok(await sheet.getByRole("button", { name: "Continue with Microsoft" }).isVisible());
assert.ok(await sheet.getByRole("link", { name: "Terms of use" }).count() && await sheet.getByRole("link", { name: "Privacy policy" }).count(), "terms and privacy linked before anything is agreed");
await polished("welcome"); await page.screenshot({ path: "/tmp/shots/signup-1-welcome.png" });
await sheet.getByRole("button", { name: "Continue with Google" }).click();
await sheet.getByRole("heading", { name: "Sign in and bring in your receipts" }).waitFor();
await sheet.getByText(CONSENT.text[1]).waitFor();
assert.ok(await sheet.getByText(CONSENT.text[1]).isVisible(), "the full wording is shown, not hidden behind a link");
assert.equal(await sheet.getByRole("img", { name: "Step 1 of 3" }).count(), 1, "the journey shows where you are");
await polished("permission"); await page.screenshot({ path: "/tmp/shots/signup-2-permission.png" });
st.verify = { mailConnected: "google", suggestedName: "Jess Tester" };
st.onVerify = { connected: true, provider: "google", accepted: true };
await sheet.getByRole("button", { name: "Agree and continue with Google" }).click();
await backFrom("accounts.google.com", "#signin=" + LINK);
assert.deepEqual(st.starts.map(s => [s.p, s.consentVersion]), [["/relay/auth/google/start", CONSENT.version]], "one visit to Google, carrying the agreement");
await sheet.getByRole("heading", { name: "What should we call you?" }).waitFor();
assert.equal(await page.locator("#rl-onboard-name").inputValue(), "Jess Tester", "the name Google holds is offered");
assert.equal(st.profilePosts.length, 0, "and not saved without asking");
await sheet.locator(".rl-jscan").getByText(/receipts? found so far/).waitFor();
assert.equal(await sheet.getByRole("img", { name: "Step 2 of 3" }).count(), 1, "the count carries on from the permission step");
await polished("name"); await page.screenshot({ path: "/tmp/shots/signup-3-name.png" });
await sheet.getByRole("button", { name: "Continue" }).click();
await sheet.getByRole("heading", { name: "You're all set, Jess." }).waitFor();
await sheet.locator(".rl-jscan").getByText("12 receipts found").waitFor({ timeout: 8000 });
assert.deepEqual(st.profilePosts, [{ name: "Jess Tester" }]);
assert.equal(st.connects, 0, "no second visit to Google to connect Gmail");
assert.equal(st.consentPosts, 0, "the agreement made before Google isn't asked for again");
assert.ok(st.scanCalls >= 3, "the scan ran from the start");
assert.equal((await page.locator(".avatar").first().textContent()).trim(), "JT", "both initials straight away");
await polished("all set"); await page.screenshot({ path: "/tmp/shots/signup-4-done.png" });
await sheet.getByRole("button", { name: "See my receipts" }).click();
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
assert.equal(await sheet.count(), 0);
console.log("ok - Google: one visit signs in and connects Gmail, the scan counts from the start, the offered name is saved only on Continue");

// 2. Someone already set up who signs in again goes straight to Home: no journey.
await page.evaluate(() => localStorage.clear()); reset({ name: "Jess Tester", accepted: true, connected: true, provider: "google" });
await page.goto(origin + "/index.html");
await page.evaluate(() => localStorage.setItem("relay_gnonce", "N".repeat(43)));
await page.goto(origin + "/index.html#signin=" + LINK);
await page.locator("#homeHello", { hasText: "Jess" }).waitFor();
await page.waitForTimeout(500);
assert.equal(await sheet.count(), 0, "returning: straight to Home");
console.log("ok - someone already set up lands on Home");

// 3. Email link with a Gmail address: pointed at the one-step route; choosing email anyway, they connect Gmail once
// (agreeing there), and coming back from Google lands on "You're all set".
await page.evaluate(() => localStorage.clear()); reset({ email: "sam.new@gmail.com" });
await page.goto(origin + "/index.html");
await page.getByRole("button", { name: "Sign in or create an account" }).click();
await sheet.getByRole("button", { name: "Continue with email" }).click();
await page.locator("#rl-signin-email").fill("sam.new@gmail.com");
await sheet.getByText(/Using Gmail\? Continue with Google instead/).waitFor();
await polished("email"); await page.screenshot({ path: "/tmp/shots/signup-email.png" });
await sheet.getByRole("button", { name: "Email me a sign-in link" }).click();
await sheet.getByRole("heading", { name: "Check your inbox" }).waitFor();
await page.locator("#rl-signin-code").fill("000000");
await sheet.getByRole("button", { name: "Continue" }).click();
await sheet.getByText("That code is wrong or has expired").waitFor();
await page.locator("#rl-signin-code").fill("123456");
await sheet.getByRole("button", { name: "Continue" }).click();
await sheet.getByRole("heading", { name: "What should we call you?" }).waitFor();
assert.equal(await page.locator("#rl-onboard-name").inputValue(), "", "nothing offered without Google");
assert.equal(await sheet.locator(".rl-jscan").count(), 0, "no scan before an inbox is connected");
await page.locator("#rl-onboard-name").fill("Sam");
await sheet.getByRole("button", { name: "Continue" }).click();
await sheet.getByRole("heading", { name: "Bring in your receipts" }).waitFor();
const firstBtn = await sheet.locator(".rl-btn").first().innerText();
assert.equal(firstBtn, "Agree and connect Gmail", "a Gmail address gets Gmail first, and agreeing is part of the same tap");
await polished("connect"); await page.screenshot({ path: "/tmp/shots/signup-connect.png" });
st.onVerify = {};
await sheet.getByRole("button", { name: "Agree and connect Gmail" }).click();
await page.waitForURL(/accounts\.google\.com/);
assert.equal(st.consentPosts, 1); assert.equal(st.connects, 1);
st.connected = true; st.provider = "google"; st.scanCalls = 0;
await page.goto(origin + "/index.html#gmail=connected");
await sheet.getByRole("heading", { name: "You're all set, Sam." }).waitFor();
await sheet.locator(".rl-jscan").getByText(/receipts? found/).waitFor();
await sheet.getByRole("button", { name: "Go to Home" }).click();
await page.locator("#homeHello", { hasText: "Sam" }).waitFor();
console.log("ok - email sign-in: Gmail users are pointed to the one-step route; otherwise they connect once and return to 'all set'");

// 4. Microsoft, one step, and "Later" for the name: never asked again on this device.
await page.evaluate(() => localStorage.clear()); reset({ email: "amy@outlook.com" });
await page.goto(origin + "/index.html");
await page.getByRole("button", { name: "Sign in or create an account" }).click();
await sheet.getByRole("button", { name: "Continue with Microsoft" }).click();
st.verify = { mailConnected: "microsoft", outlookConnected: true };
st.onVerify = { connected: true, provider: "microsoft", accepted: true };
await sheet.getByRole("button", { name: "Agree and continue with Microsoft" }).click();
await backFrom("login.microsoftonline.com", "#signin=" + LINK);
assert.equal(st.starts[0].consentVersion, CONSENT.version);
await sheet.getByRole("heading", { name: "What should we call you?" }).waitFor();
await sheet.getByText("Reading your Outlook").or(sheet.getByText(/found so far/)).first().waitFor();
await sheet.getByRole("button", { name: "Skip" }).click();
await sheet.getByRole("heading", { name: "You're all set." }).waitFor();
await sheet.getByRole("button", { name: "Go to Home" }).click();
await page.evaluate(() => localStorage.setItem("relay_gnonce", "N".repeat(43)));
st.verify = {};
await page.goto(origin + "/index.html#signin=" + LINK);
await page.locator("#homeHello").waitFor(); await page.waitForTimeout(500);
assert.equal(await sheet.count(), 0, "a skipped name isn't asked for again");
console.log("ok - Microsoft: one step too; a skipped name isn't asked again");

// 5. "Just sign in" for people who already use Relay: no agreement sent, no inbox requested.
await page.evaluate(() => localStorage.clear()); reset();
await page.goto(origin + "/index.html");
await page.getByRole("button", { name: "Sign in or create an account" }).click();
await sheet.getByRole("button", { name: "Continue with Google" }).click();
await sheet.getByRole("button", { name: "Just sign in for now" }).click();
await page.waitForURL(/accounts\.google\.com/);
assert.equal(st.starts[0].consentVersion, undefined, "identity only");
console.log("ok - 'Just sign in for now' asks Google for nothing but who you are");

assert.deepEqual(errors, [], "no page errors");
console.log("PASS sign-up journey: one visit to Google or Microsoft, scan from the start, name step, email route, returning people skip it");
await browser.close(); server.close();
