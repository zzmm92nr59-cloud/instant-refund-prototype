// Browser test: the sign-up journey. Stubbed Relay server, FAKE Google/Microsoft pages, made-up people.
// Checks: a first visit opens on the welcome story (four slides; tap, hold or arrow keys; readable on every colour), then
// a clean sign-in page with the three ways in, and Back returns to the story; Google (and Microsoft) sign in AND connect the inbox in one visit after the wording is agreed, so nobody signs in
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

// 0. A first visit opens on the welcome story: four short slides, then the way in.
await page.goto(origin + "/index.html");
const story = page.locator(".rl-welcome");
const titleNow = () => story.locator("h1").innerText();
const titleIs = t => story.locator("h1", { hasText: t }).waitFor({ timeout: 8000 });
await titleIs("Every receipt, in one place.");
assert.equal(await story.locator(".rl-wbars > div").count(), 4, "four slides, a bar for each");
assert.equal(await page.evaluate(() => !!document.activeElement && document.activeElement.classList.contains("rl-welcome")), true, "focus starts on the story itself, so a screen reader and the arrow keys start there");
// Each slide: readable on its colour, nothing tiny, both buttons a proper size.
const storyPolish = () => page.evaluate(() => {
  const rgb = c => c.match(/[\d.]+/g).map(Number);
  const over = (fg, bg) => { const [r, g, b, a = 1] = rgb(fg), [R, G, B] = rgb(bg); return `rgb(${r * a + R * (1 - a)},${g * a + G * (1 - a)},${b * a + B * (1 - a)})`; };
  const lum = c => { const f = v => (v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); const [r, g, b] = rgb(c); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const root = document.querySelector(".rl-welcome"), bg = getComputedStyle(root).backgroundColor, out = { small: [], tiny: [], dim: [] };
  for (const b of root.querySelectorAll("button")) if (b.getBoundingClientRect().height < 44) out.small.push(b.innerText);
  for (const n of root.querySelectorAll("*")) {
    if (![...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim())) continue;
    if (parseFloat(getComputedStyle(n).fontSize) < 13) out.tiny.push(n.textContent.trim());
  }
  // Headline, line under it (19px bold: large text, 3:1) and the second button's words (4.5:1) against the slide's colour.
  for (const [sel, min] of [[".rl-wslide h1", 3], [".rl-wslide p", 3], [".rl-wbrand b", 3], [".rl-whave", 4.5]]) {
    const n = root.querySelector(sel), s = getComputedStyle(n), back = over(s.backgroundColor, bg), r = ratio(s.color, back);
    if (r < min) out.dim.push(sel + " " + r.toFixed(2));
  }
  return out;
});
for (let k = 0; k < 4; k++) {
  if (k) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(650); // the colour change has finished
  assert.deepEqual(await storyPolish(), { small: [], tiny: [], dim: [] }, "slide " + (k + 1) + ": " + await titleNow());
  await page.screenshot({ path: "/tmp/shots/signup-0-story-" + (k + 1) + ".png" });
}
assert.equal(await titleNow(), "Your year, wrapped.", "the arrow keys move through the slides");
// Tapping the left third goes back, anywhere else goes on.
const vp = page.viewportSize();
await page.mouse.click(vp.width * 0.1, vp.height * 0.4); await titleIs("Catch the price drop.");
await page.mouse.click(vp.width * 0.1, vp.height * 0.4); await titleIs("Never miss a return.");
await page.mouse.click(vp.width * 0.8, vp.height * 0.4); await titleIs("Catch the price drop.");
// Holding pauses it, and letting go doesn't skip a slide; left alone, it moves on by itself.
await page.mouse.move(vp.width * 0.8, vp.height * 0.4); await page.mouse.down(); await page.waitForTimeout(800);
assert.equal(await story.evaluate(n => n.classList.contains("held")), true, "holding pauses the story");
await page.mouse.up(); await page.waitForTimeout(200);
assert.equal(await titleNow(), "Catch the price drop.", "letting go after a hold stays on the slide");
await titleIs("Your year, wrapped."); // within a few seconds, by itself
console.log("ok - the welcome story: four slides by tap, hold or arrow keys, moving on by itself, readable on every colour");

// 1. Google, one step: the story → "Get started" → the sign-in page → (Google once) → name, with the scan counting → all set.
await story.getByRole("button", { name: "Get started" }).click();
await sheet.getByRole("heading", { name: "Create your account" }).waitFor();
await sheet.getByRole("button", { name: "Continue with Google" }).waitFor();
assert.ok(await sheet.getByRole("button", { name: "Continue with Microsoft" }).isVisible());
assert.ok(await sheet.getByRole("button", { name: "Continue with email" }).isVisible());
assert.ok(await sheet.getByRole("link", { name: "Terms of use" }).count() && await sheet.getByRole("link", { name: "Privacy policy" }).count(), "terms and privacy linked before anything is agreed");
assert.equal(await sheet.getByRole("button", { name: "Close" }).count(), 0, "from the story, the way out is Back");
await polished("sign-in page"); await page.screenshot({ path: "/tmp/shots/signup-1-signin.png" });
// Back returns to the story; "I already have an account" opens the same three ways in, worded for coming back.
await sheet.getByRole("button", { name: "Back" }).click();
await story.getByRole("button", { name: "I already have an account" }).click();
await sheet.getByRole("heading", { name: "Welcome back" }).waitFor();
await sheet.getByRole("button", { name: "Continue with email" }).waitFor();
await polished("sign-in page, coming back");
await sheet.getByRole("button", { name: "Back" }).click();
assert.equal(await sheet.count(), 0);
await story.getByRole("button", { name: "Get started" }).click();
await sheet.getByRole("heading", { name: "Create your account" }).waitFor();
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
assert.equal(await story.count(), 0, "signed in: the welcome story has gone");
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
await page.getByRole("button", { name: "Get started" }).click();
await sheet.getByRole("button", { name: "Continue with email" }).click();
await page.locator("#rl-signin-email").fill("sam.new@gmail.com");
await sheet.getByText(/Using Gmail\? Continue with Google instead/).waitFor();
await polished("email"); await page.screenshot({ path: "/tmp/shots/signup-email.png" });
await sheet.getByRole("button", { name: "Email me a sign-in link" }).click();
await sheet.getByRole("heading", { name: "Check your inbox" }).waitFor();
// The code box: phones offer the code from the email's notification (one-time-code), six digits go by themselves, and
// pasting the whole subject line keeps just the code.
assert.equal(await page.locator("#rl-signin-code").evaluate(el => el.autocomplete + " " + el.inputMode), "one-time-code numeric");
await page.locator("#rl-signin-code").fill("000000");
await sheet.getByText("That code is wrong or has expired").waitFor();
assert.equal(await page.locator("#rl-signin-code").inputValue(), "", "a wrong code is cleared for the next try");
await page.locator("#rl-signin-code").evaluate((el, t) => { const dt = new DataTransfer(); dt.setData("text/plain", t); el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); },
  "123456 is your Relay sign-in code");
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
await page.getByRole("button", { name: "Get started" }).click();
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
await page.getByRole("button", { name: "I already have an account" }).click();
await sheet.getByRole("button", { name: "Continue with Google" }).click();
await sheet.getByRole("button", { name: "Just sign in for now" }).click();
await page.waitForURL(/accounts\.google\.com/);
assert.equal(st.starts[0].consentVersion, undefined, "identity only");
console.log("ok - 'Just sign in for now' asks Google for nothing but who you are");

assert.deepEqual(errors, [], "no page errors");
console.log("PASS sign-up journey: the welcome story and sign-in page, one visit to Google or Microsoft, scan from the start, name step, email route, returning people skip it");
await browser.close(); server.close();
