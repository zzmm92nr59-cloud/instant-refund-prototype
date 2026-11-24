// Browser test: the sign-up journey. Stubbed Relay server, FAKE Google/Microsoft pages, made-up people.
// Checks: a first visit opens on the welcome story (four slides; tap, hold or arrow keys; readable on every colour), then
// a clean sign-in page with the three ways in, and Back returns to the story; Google (and Microsoft) sign in AND connect the inbox in one visit after the wording is agreed, so nobody signs in
// twice; the scan starts at once and its count shows while the name is added; the name Google gave is offered, not saved
// unasked; email sign-in with a Gmail address points to the one-step route; email-link people connect once and come back
// to "You're all set"; someone already set up goes straight to Home; every step passes the polish rules.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { homeShows, homeReady } from "./relay-places.mjs";
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
  if ((p === "/relay/auth/google/start" || p === "/relay/auth/microsoft/start") && st.slowStart) { await new Promise(r => setTimeout(r, 2500)); return j({ error: "google_not_configured" }, 503); }
  if (p === "/relay/auth/google/start" || p === "/relay/auth/microsoft/start") { st.starts.push({ p, ...body() }); return j({ url: p.includes("google") ? "https://accounts.google.com/o/oauth2/v2/auth?x=1" : "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?x=1" }); }
  if (p === "/relay/auth/claim") { st.claims = (st.claims || 0) + 1; if (!st.claimReady) return j({ error: "not_yet" }, 404); st.claimReady = false; Object.assign(st, st.onVerify || {}); return j({ sessionToken: TOKEN, email: st.email, expiresAt: Date.now() + 864e5, ...st.verify }); }
  if (p === "/relay/auth/verify") { st.verifies = (st.verifies || 0) + 1; Object.assign(st, st.onVerify || {}); return j({ sessionToken: TOKEN, email: st.email, expiresAt: Date.now() + 864e5, ...st.verify }); }
  if (p === "/relay/auth/request") return j({ ok: true });
  if (p === "/relay/auth/verify-code") return body().code === "123456" ? j({ sessionToken: TOKEN, email: st.email, expiresAt: Date.now() + 864e5 }) : j({ error: "invalid_or_expired_code" }, 400);
  if (p === "/relay/my/interests" && m === "GET") return j({ interests: st.interests || [], updatedAt: null });
  if (p === "/relay/my/interests" && m === "PUT") { st.interestPuts = (st.interestPuts || []).concat([body()]); st.interests = body().interests; return j({ interests: st.interests, updatedAt: Date.now() }); }
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
  // Cards and banks (worker/bank.js): offered to Relay's team and testers for now.
  if (p === "/relay/my/bank" && m === "GET") return j(st.bankOn ? { available: true, testBanks: false, connections: st.banks || [] } : { available: false, connections: [] });
  if (p === "/relay/my/bank/connect" && m === "POST") { st.bankConnects = (st.bankConnects || 0) + 1; st.bankChoices = (st.bankChoices || []).concat([body().bank || null]); return j({ url: "https://auth.truelayer.com/?response_type=code&state=" + "s".repeat(43) }); }
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  return j({});
});
// Registered last so they win over the catch-all above: stand-ins for Google's and Microsoft's own pages.
await ctx.route("https://accounts.google.com/**", r => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>FAKE Google</h1>" }));
await ctx.route("https://login.microsoftonline.com/**", r => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>FAKE Microsoft</h1>" }));
await ctx.route("https://auth.truelayer.com/**", r => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>FAKE bank</h1>" }));
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
  assert.doesNotMatch(await story.innerText(), /lululemon|Allbirds|Kitri|JD Sports|adidas|Restfeel/i, "slide " + (k + 1) + ": invented shops only, never a real shop with a made-up price");
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
// Tapping the last slide again keeps it as it is (it used to be drawn again, flashing on every tap); Get started nudges instead.
const lastSlide = await story.locator(".rl-wslide").elementHandle();
for (let k = 0; k < 3; k++) await page.mouse.click(vp.width * 0.8, vp.height * 0.4);
await page.waitForTimeout(150);
assert.equal(await lastSlide.evaluate(n => n.isConnected), true, "tapping the last slide doesn't draw it again");
assert.equal(await story.locator(".rl-wslide").count(), 1);
assert.equal(await story.locator(".rl-wgo").evaluate(n => n.classList.contains("rl-nudge")), true, "tapping on at the end nudges Get started");
console.log("ok - the welcome story: four slides by tap, hold or arrow keys, moving on by itself, readable on every colour, no flash at the end");

// 1. Google, one tap: the story → "Get started" → the sign-in page, which says what Relay does with the inbox → (Google
// once) → inboxes, with the scan counting → all set. Connor, 17 Nov 2026: no separate permission page, no name step (the
// name Google holds is used) and no "What do you shop for?" (Browse goes by their receipts).
await story.getByRole("button", { name: "Get started" }).click();
await sheet.getByRole("heading", { name: "Create your account" }).waitFor();
await sheet.getByRole("button", { name: "Continue with Google" }).waitFor();
// The pictures use invented shops and everyday things, never a real shop with a price Relay made up (Connor, 24 Nov 2026).
assert.match(await page.locator(".rl-sart").innerText(), /Canvas trainers[\s\S]*Wrenfield/);
for (const real of ["lululemon", "Allbirds", "Kitri", "JD Sports", "adidas"]) assert.equal(await page.getByText(real, { exact: false }).count(), 0, real + " isn't shown");
assert.ok(await sheet.getByRole("button", { name: "Continue with Microsoft" }).isVisible());
assert.ok(await sheet.getByRole("button", { name: "Continue with email" }).isVisible());
assert.ok(await sheet.getByRole("link", { name: "Terms of use" }).count() && await sheet.getByRole("link", { name: "Privacy policy" }).count(), "terms and privacy linked before anything is agreed");
// What Relay does with the inbox is said in one line before anyone goes to Google (Connor, 17 Nov 2026: a panel of
// points made the page busy); the points and the exact wording open under it with one tap.
await sheet.locator(".rl-sperm").waitFor();
assert.match(await sheet.locator(".rl-jlegal").innerText(), /^With Google or Microsoft, Relay reads only your order, receipt and return emails, and never changes anything\. By continuing you agree to Relay's Terms of use and Privacy policy\.$/);
const more = sheet.getByRole("button", { name: "What Relay reads" });
assert.equal(await more.getAttribute("aria-expanded"), "false");
assert.equal(await sheet.getByText("Never sells or shares what it finds").isVisible(), false, "the page stays clean until asked");
assert.equal(await sheet.getByText(CONSENT.text[1]).isVisible(), false);
await polished("sign-in page, clean"); await page.screenshot({ path: "/tmp/shots/signup-1-signin-clean.png" });
await more.click();
for (const t of ["Only order confirmations, receipts and return emails", "Read-only: never sends, deletes or changes anything", "Never sells or shares what it finds", "Disconnect and delete everything at any time", ...CONSENT.text]) assert.ok(await sheet.getByText(t).isVisible(), "shown: " + t.slice(0, 30));
assert.equal(await sheet.getByRole("button", { name: "Hide" }).getAttribute("aria-expanded"), "true");
await sheet.getByRole("button", { name: "Hide" }).click();
assert.equal(await sheet.getByRole("button", { name: "Close" }).count(), 0, "from the story, the way out is Back");
await polished("sign-in page"); await page.screenshot({ path: "/tmp/shots/signup-1-signin.png" });
// Back returns to the story; "I already have an account" opens the same three ways in, worded for coming back.
await sheet.getByRole("button", { name: "Back" }).click();
await story.getByRole("button", { name: "I already have an account" }).click();
await sheet.getByRole("heading", { name: "Welcome back" }).waitFor();
await sheet.getByRole("button", { name: "Continue with email" }).waitFor();
assert.equal(await sheet.locator(".rl-sperm").count(), 0, "coming back: just signing in, nothing to agree");
await polished("sign-in page, coming back");
await sheet.getByRole("button", { name: "Back" }).click();
assert.equal(await sheet.count(), 0);
await story.getByRole("button", { name: "Get started" }).click();
await sheet.getByRole("heading", { name: "Create your account" }).waitFor();
await sheet.locator(".rl-sperm").waitFor();
// Off to Google, then the phone's back without signing in: the buttons work again (they used to stay stuck).
await sheet.getByRole("button", { name: "Continue with Google" }).click();
await page.waitForURL(/accounts\.google\.com/);
await page.goBack();
await sheet.getByRole("heading", { name: "Create your account" }).waitFor();
await sheet.getByRole("button", { name: "Continue with Google", disabled: false }).waitFor({ timeout: 5000 });
assert.equal(await sheet.getByRole("button", { name: "Continue with Microsoft" }).isDisabled(), false);
// And again (Connor, 17 Nov 2026: the second time back, they stayed stuck).
await page.waitForTimeout(450);
await sheet.getByRole("button", { name: "Continue with Google" }).click();
await page.waitForURL(/accounts\.google\.com/);
await page.goBack();
await sheet.getByRole("heading", { name: "Create your account" }).waitFor();
await sheet.getByRole("button", { name: "Continue with Google", disabled: false }).waitFor({ timeout: 3000 });
assert.equal(await sheet.getByRole("button", { name: "Continue with email" }).isDisabled(), false);
// The phone putting the page back as it was (iPhone keeps it, buttons and all), twice while a check is still going.
st.slowStart = true; await page.waitForTimeout(450);
for (let k = 0; k < 2; k++) {
  await sheet.getByRole("button", { name: "Continue with Google" }).click();
  await sheet.getByRole("button", { name: "Continue with Google", disabled: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await sheet.getByRole("button", { name: "Continue with Google", disabled: false }).waitFor({ timeout: 1500 });
  await page.waitForTimeout(450);
}
st.slowStart = false; await page.waitForTimeout(2600);
st.starts = []; await page.waitForTimeout(450);
st.verify = { mailConnected: "google", suggestedName: "Jess Tester" };
st.onVerify = { connected: true, provider: "google", accepted: true };
await sheet.getByRole("button", { name: "Continue with Google" }).dblclick();
await backFrom("accounts.google.com", "#signin=" + LINK);
assert.deepEqual(st.starts.map(s => [s.p, s.consentVersion]), [["/relay/auth/google/start", CONSENT.version]], "one visit to Google (once for a double tap), carrying the agreement");
// Straight to their inboxes: the one just connected, the read counting, and adding another inbox is one tap.
await sheet.getByRole("heading", { name: "Your inboxes" }).waitFor();
assert.equal(await sheet.getByRole("heading", { name: "What should we call you?" }).count(), 0, "no name step: Google gave one");
assert.deepEqual(st.profilePosts, [{ name: "Jess Tester" }], "the name Google holds is kept");
await sheet.locator(".rl-jscan").getByText(/receipts? found so far/).waitFor();
assert.equal(await sheet.getByRole("img", { name: "Step 1 of 2" }).count(), 1, "two steps: your inboxes, all set");
assert.equal(await sheet.locator(".rl-jsegs i").count(), 2, "a segment a step across the top");
assert.equal(await sheet.locator(".rl-jsegs i.on").count(), 1, "lime up to this one");
// The first read finishes here: "You're all set" shows the count it reached straight away (it used to go back to
// "Reading your Gmail…" and stay there).
await sheet.locator(".rl-jscan").getByText("12 receipts found").waitFor({ timeout: 8000 });
await sheet.locator(".rl-jlist .rl-jrow", { hasText: "jess.tester@gmail.com" }).getByText("Gmail", { exact: true }).waitFor();
assert.ok(await sheet.getByRole("button", { name: "Add another Gmail inbox" }).isVisible(), "another inbox is one tap away");
await sheet.locator(".rl-jscan").getByText("12 receipts found").waitFor();
await polished("your inboxes"); await page.screenshot({ path: "/tmp/shots/signup-3b-inboxes.png" });
await sheet.getByRole("button", { name: "Continue", exact: true }).click();
await sheet.getByRole("heading", { name: "You're all set, Jess." }).waitFor();
assert.equal(await sheet.getByRole("img", { name: "Step 2 of 2" }).count(), 1);
assert.equal(st.interestPuts, undefined, "not asked what they shop for: their receipts say");
// What's connected, as big numbers: the receipts found carry over at once.
assert.deepEqual(await sheet.locator(".rl-jstat:not([hidden])").evaluateAll(n => n.map(x => x.innerText.replace(/\s+/g, " ").trim())), ["12 receipts found", "1 inbox"]);
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
console.log("ok - Google: one tap on the sign-in page (which says what Relay reads) signs in and connects Gmail; no permission page, name step or interests");

// 2. Someone already set up who signs in again goes straight to Home: no journey.
await page.evaluate(() => localStorage.clear()); reset({ name: "Jess Tester", accepted: true, connected: true, provider: "google" });
// A blank page first, so nothing still loading on the last screen (pictures, the read) can cut this load short.
await page.goto("about:blank"); await page.goto(origin + "/index.html");
await page.evaluate(() => localStorage.setItem("relay_gnonce", "N".repeat(43)));
await page.goto(origin + "/index.html#signin=" + LINK);
await homeShows(page, "JT");
await page.waitForTimeout(500);
assert.equal(await sheet.count(), 0, "returning: straight to Home");
console.log("ok - someone already set up lands on Home");

// 3. Email link with a Gmail address: pointed at the one-step route; choosing email anyway, they connect Gmail once
// (agreeing there), and coming back from Google lands back on their inboxes, ready to add another or carry on.
await page.evaluate(() => localStorage.clear()); reset({ email: "sam.new@gmail.com" });
await page.goto(origin + "/index.html");
await page.getByRole("button", { name: "Get started" }).click();
await sheet.getByRole("button", { name: "Continue with email" }).click();
await page.locator("#rl-signin-email").fill("sam.new@gmail.com");
await sheet.getByText(/Using Gmail\? With Google you're signed in/).waitFor();
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
await sheet.getByRole("heading", { name: "Your inboxes" }).waitFor();
await sheet.locator(".rl-jscan").waitFor();
await sheet.getByRole("button", { name: "Continue", exact: true }).click();
// With an inbox connected along the way, what they shop for isn't asked after all.
await sheet.getByRole("heading", { name: "You're all set, Sam." }).waitFor();
await sheet.locator(".rl-jstat:not([hidden])").getByText(/receipts? found/).waitFor();
await sheet.getByRole("button", { name: "Go to Home" }).click();
await homeShows(page, "S");
console.log("ok - email sign-in: Gmail users are pointed to the one-step route; otherwise they connect once and come back to their inboxes");

// 4. Microsoft, one step, and "Later" for the name: never asked again on this device.
await page.evaluate(() => localStorage.clear()); reset({ email: "amy@outlook.com" });
await page.goto(origin + "/index.html");
await page.getByRole("button", { name: "Get started" }).click();
st.verify = { mailConnected: "microsoft", outlookConnected: true };
st.onVerify = { connected: true, provider: "microsoft", accepted: true };
await sheet.locator(".rl-sperm").waitFor();
await sheet.getByRole("button", { name: "Continue with Microsoft" }).click();
await backFrom("login.microsoftonline.com", "#signin=" + LINK);
assert.equal(st.starts[0].consentVersion, CONSENT.version);
await sheet.getByRole("heading", { name: "What should we call you?" }).waitFor();
await page.waitForFunction(() => true); await page.waitForTimeout(600);
assert.ok(st.scanCalls >= 1, "the Outlook read starts behind the name step");
await sheet.getByRole("button", { name: "Skip" }).click();
await sheet.getByRole("heading", { name: "Your inboxes" }).waitFor();
await sheet.getByText("Reading your Outlook").or(sheet.getByText(/found so far/)).or(sheet.getByText(/receipts? found/)).first().waitFor();
// A second "Skip" in the same spot within 0.4s is a double tap (index.html's guard), so it doesn't skip two steps.
await sheet.getByRole("button", { name: "Skip" }).click();
assert.equal(await sheet.getByRole("heading", { name: "Your inboxes" }).count(), 1, "a double tap on Skip doesn't skip two steps");
await page.waitForTimeout(450);
await sheet.getByRole("button", { name: "Skip" }).click();
await sheet.getByRole("heading", { name: "You're all set." }).waitFor();
await sheet.getByRole("button", { name: "Go to Home" }).click();
await page.evaluate(() => localStorage.setItem("relay_gnonce", "N".repeat(43)));
st.verify = {};
await page.goto(origin + "/index.html#signin=" + LINK);
await homeReady(page); await page.waitForTimeout(500);
assert.equal(await sheet.count(), 0, "a skipped name isn't asked for again");
console.log("ok - Microsoft: one step too; a skipped name isn't asked again");

// 6. Cards and banks: someone with an inbox but no bank yet (where Relay offers banks) gets their inboxes, then their
// cards and banks: connect one through TrueLayer, come straight back to the same step with it listed, add another or carry
// on, and "You're all set" says what's connected.
await page.evaluate(() => localStorage.clear()); reset({ name: "Connor", accepted: true, connected: true, provider: "google", email: "connor.test@gmail.com", bankOn: true, banks: [] });
await page.goto("about:blank"); await page.goto(origin + "/index.html");
await page.evaluate(() => localStorage.setItem("relay_gnonce", "N".repeat(43)));
await page.goto(origin + "/index.html#signin=" + LINK);
await sheet.getByRole("heading", { name: "Your inboxes" }).waitFor();
assert.equal(await sheet.getByRole("img", { name: "Step 1 of 3" }).count(), 1, "inboxes, cards and banks, all set");
await sheet.getByRole("button", { name: "Continue", exact: true }).click();
await sheet.getByRole("heading", { name: "Your cards and banks" }).waitFor();
assert.equal(await sheet.getByRole("img", { name: "Step 2 of 3" }).count(), 1);
assert.match(await sheet.locator(".rl-jbody").innerText(), /It can only read, never move money\./, "says plainly it can't move money");
// The usual banks and cards, one tap each; any other through TrueLayer's list.
const tiles = sheet.getByRole("group", { name: "Choose your bank or card" }).getByRole("button");
assert.deepEqual(await tiles.evaluateAll(b => b.map(x => x.lastChild.textContent)), ["Amex", "Barclays", "Chase", "Halifax", "HSBC", "Lloyds", "Monzo", "Nationwide", "NatWest", "Revolut", "Santander", "Starling"]);
assert.ok(await sheet.getByRole("button", { name: "Another bank or card" }).isVisible());
await polished("cards and banks"); await page.screenshot({ path: "/tmp/shots/signup-banks.png" });
await tiles.filter({ hasText: "Amex" }).dblclick();
await page.waitForURL(/auth\.truelayer\.com/);
assert.deepEqual(st.bankChoices, ["amex"], "straight to that bank, once for a double tap");
st.banks = [{ id: "11111111-1111-4111-8111-111111111111", bank: "American Express", connectedAt: new Date().toISOString(), syncedAt: new Date().toISOString(), needsReconnect: false, payments: 12, matched: 3 }];
await page.goto(origin + "/index.html#bank=connected");
await sheet.getByRole("heading", { name: "Your cards and banks" }).waitFor();
await sheet.getByText("Connected. Relay has read your payments and is matching them to your receipts.").waitFor();
await sheet.locator(".rl-jlist").getByText("American Express").waitFor();
assert.equal(await sheet.getByRole("img", { name: "Step 2 of 3" }).count(), 1, "back from the bank, the same step count (it used to start again)");
assert.match(await sheet.locator(".rl-jlist").innerText(), /American Express\n3 matched to receipts/, "a bank with what Relay matched in it");
assert.equal(await tiles.filter({ hasText: "Amex" }).count(), 0, "a connected one isn't offered again");
assert.equal(await tiles.count(), 11, "the others still one tap away");
await polished("cards and banks, one connected"); await page.screenshot({ path: "/tmp/shots/signup-banks-2.png" });
await sheet.getByRole("button", { name: "Another bank or card" }).click();
await page.waitForURL(/auth\.truelayer\.com/);
assert.deepEqual(st.bankChoices, ["amex", null], "any other bank: TrueLayer's own list");
await page.goto(origin + "/index.html#bank=denied");
await sheet.getByText(/Not connected\. You can try again/).waitFor();
await sheet.getByRole("button", { name: "Continue", exact: true }).click();
await sheet.getByRole("heading", { name: "You're all set, Connor." }).waitFor();
assert.deepEqual(await sheet.locator(".rl-jstat:not([hidden])").evaluateAll(n => n.map(x => x.innerText.replace(/\s+/g, " ").trim())).then(a => a.filter(x => !/found/.test(x))), ["1 inbox", "1 bank"], "what's connected, as big numbers");
await polished("all set, with a bank"); await page.screenshot({ path: "/tmp/shots/signup-banks-done.png" });
// Coming back from the bank having said no: the same step, saying so, nothing listed.
// (Off the page first: clearing storage under the open app makes it sign out and reload, which can cut across the next goto.)
await page.goto("about:blank"); await page.goto(origin + "/index.html");
await page.evaluate(() => localStorage.clear()); reset({ name: "Connor", accepted: true, connected: true, provider: "google", email: "connor.test@gmail.com", bankOn: true, banks: [], interests: ["fashion"] });
await page.goto("about:blank"); await page.goto(origin + "/index.html");
await page.evaluate(() => localStorage.setItem("relay_gnonce", "N".repeat(43)));
await page.goto(origin + "/index.html#signin=" + LINK);
await sheet.getByRole("heading", { name: "Your inboxes" }).waitFor();
await sheet.getByRole("button", { name: "Continue", exact: true }).click();
await sheet.getByRole("button", { name: "Another bank or card" }).click();
await page.waitForURL(/auth\.truelayer\.com/);
await page.goto(origin + "/index.html#bank=denied");
await sheet.getByText(/Not connected\. You can try again/).waitFor();
assert.equal(await sheet.locator(".rl-jlist").count(), 0);
await sheet.getByRole("button", { name: "Later" }).click();
await sheet.getByRole("heading", { name: "You're all set, Connor." }).waitFor();
console.log("ok - cards and banks: connect through the bank's own page, straight back to the same step with it listed; no and Later handled");

// 7. Seeing getting started again (Relay's team, from Profile): someone fully set up signs in and gets every step, with
// what they have: their name filled in, their inboxes and banks listed, what they shop for already picked.
await page.evaluate(() => localStorage.clear()); reset({ name: "Connor", accepted: true, connected: true, provider: "google", email: "connor.test@gmail.com", bankOn: true, interests: ["fashion"],
  banks: [{ id: "11111111-1111-4111-8111-111111111111", bank: "Made-up Bank", connectedAt: new Date().toISOString(), syncedAt: new Date().toISOString(), needsReconnect: false, payments: 3, matched: 0 }] });
await page.goto("about:blank"); await page.goto(origin + "/index.html");
await page.evaluate(() => { localStorage.setItem("relay_gnonce", "N".repeat(43)); localStorage.setItem("relay.replay-setup.v1", "1"); });
await page.goto(origin + "/index.html#signin=" + LINK);
await sheet.getByRole("heading", { name: "What should we call you?" }).waitFor();
assert.equal(await sheet.getByRole("img", { name: "Step 1 of 4" }).count(), 1, "every step: name, inboxes, cards and banks, all set (no interests with an inbox)");
assert.equal(await page.locator("#rl-onboard-name").inputValue(), "Connor");
await sheet.getByRole("button", { name: "Continue" }).click();
await sheet.getByRole("heading", { name: "Your inboxes" }).waitFor();
await page.waitForTimeout(450);   // a second "Continue" in the same place within 400ms is taken as a double tap (index.html)
await sheet.getByRole("button", { name: "Continue", exact: true }).click();
await sheet.getByRole("heading", { name: "Your cards and banks" }).waitFor();
await sheet.locator(".rl-jlist").getByText("Made-up Bank").waitFor();
assert.equal(await sheet.getByRole("img", { name: "Step 3 of 4" }).count(), 1);
// Adding another bank and coming back carries on with the same steps and count (it used to start again at "2 of 4").
await sheet.getByRole("button", { name: "Another bank or card" }).click();
await page.waitForURL(/auth\.truelayer\.com/);
await page.goto(origin + "/index.html#bank=connected");
await sheet.getByRole("heading", { name: "Your cards and banks" }).waitFor();
assert.equal(await sheet.getByRole("img", { name: "Step 3 of 4" }).count(), 1, "back from the bank: still step 3 of 4");
await sheet.getByRole("button", { name: "Continue", exact: true }).click();
await sheet.getByRole("heading", { name: "You're all set, Connor." }).waitFor();
assert.equal(await page.evaluate(() => localStorage.getItem("relay.replay-setup.v1")), null, "once only");
console.log("ok - seeing getting started again: every step, with the account as it is");

// 4b. From the iPhone home-screen app, Google opens in a separate browser and comes back there, without the app's
// secret: that page says to go back (and doesn't use the sign-in up); the app, back on screen, finishes signing in.
{
  await page.evaluate(() => localStorage.clear()); reset({ email: "jess.tester@gmail.com" });
  const app = await ctx.newPage(); await app.addInitScript(() => { Object.defineProperty(navigator, "standalone", { get: () => true }); });
  await app.goto(origin + "/index.html");
  await app.getByRole("button", { name: "Get started" }).click();
  const appSheet = app.locator(".rl-back .rl-sheet").last();
  await appSheet.locator(".rl-sperm").waitFor();
  st.verify = { mailConnected: "google", suggestedName: "Jess Tester" };
  st.onVerify = { connected: true, provider: "google", accepted: true };
  await appSheet.getByRole("button", { name: "Continue with Google" }).click();
  await app.waitForURL(/accounts\.google\.com/);
  // The separate browser (same storage here, as on newer iPhones; not the home-screen app): it says to go back, no sign-in.
  const other = await ctx.newPage();
  await other.goto(origin + "/index.html#signin=" + LINK);
  await other.getByRole("heading", { name: "Nearly there" }).waitFor();
  assert.equal(st.verifies || 0, 0, "the separate browser doesn't use the sign-in up");
  await other.close();
  // The app back on screen: it asks, and finishes signing in.
  st.claimReady = true;
  await app.goto(origin + "/index.html");
  await appSheet.getByRole("heading", { name: "Your inboxes" }).waitFor();
  assert.ok(st.claims >= 1);
  assert.equal(await app.evaluate(() => localStorage.getItem("relay_gnonce")), null, "the secret is gone once used");
  await app.close();
}
console.log("ok - from the home-screen app: the separate browser says to go back; the app finishes signing in");

// 5. Coming back ("I already have an account"): Google just signs in. No agreement sent, no inbox requested.
await page.evaluate(() => localStorage.clear()); reset();
await page.goto(origin + "/index.html");
await page.getByRole("button", { name: "I already have an account" }).click();
await sheet.getByRole("button", { name: "Continue with Google" }).click();
await page.waitForURL(/accounts\.google\.com/);
assert.equal(st.starts[0].consentVersion, undefined, "identity only");
console.log("ok - coming back, Continue with Google asks Google for nothing but who you are");

// 8. Without an inbox (email, inbox left for later): asked what they shop for, so Browse has something to go on.
await page.goto(origin + "/terms.html"); await page.evaluate(() => localStorage.clear()); reset({ email: "kai@example.com" });
await page.goto(origin + "/index.html");
await page.getByRole("button", { name: "Get started" }).click();
await sheet.getByRole("button", { name: "Continue with email" }).click();
await page.locator("#rl-signin-email").fill("kai@example.com");
await sheet.getByRole("button", { name: "Email me a sign-in link" }).click();
await page.locator("#rl-signin-code").fill("123456");
await sheet.getByRole("heading", { name: "What should we call you?" }).waitFor();
await page.locator("#rl-onboard-name").fill("Kai");
await sheet.getByRole("button", { name: "Continue" }).click();
await sheet.getByRole("heading", { name: "Bring in your receipts" }).waitFor();
await page.waitForTimeout(450);
await sheet.getByRole("button", { name: "Later" }).click();
await sheet.getByRole("heading", { name: "What do you shop for?" }).waitFor();
await polished("what you shop for");
await sheet.getByRole("button", { name: "Fashion", exact: true }).click(); await page.waitForTimeout(500);
await sheet.getByRole("button", { name: "Tech", exact: true }).click();
assert.equal(await sheet.getByRole("button", { name: "Fashion", exact: true }).getAttribute("aria-pressed"), "true");
await sheet.getByRole("button", { name: "Continue" }).dblclick();
await sheet.getByRole("heading", { name: "You're all set, Kai." }).waitFor();
assert.deepEqual(st.interestPuts, [{ interests: ["fashion", "tech"] }], "saved with the account, once for a double tap");
console.log("ok - without an inbox, what they shop for is asked, and saved once");

assert.deepEqual(errors, [], "no page errors");
console.log("PASS sign-up journey: the welcome story and sign-in page (saying what Relay reads), one tap to Google or Microsoft, scan from the start, banks one tap each, email route, returning people skip it");
await browser.close(); server.close();
