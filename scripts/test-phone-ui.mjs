// Browser test: phone numbers and sign-in codes by text. Stubbed Relay server, made-up person and number (Ofcom's range
// for TV and film), and a FAKE text-message reader standing in for Android's: nothing here proves a real text arrives.
// Checks: Phone number appears in Profile only when Relay can send texts; adding a number takes a texted code; every code
// box lets the phone offer the code from the notification (one-time-code, numbers keypad), keeps just the code when the
// whole message is pasted, and sends six digits by itself; "Text me a new code" waits its turn; codes by text switch on
// with a fresh code and show recovery codes once; signing in stops at "Check your phone", texts the code at once, and
// takes the texted code, the app's or a recovery code; every screen passes the polish rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeShows, profileButton } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", TOKEN = "T".repeat(43), PENDING = "P".repeat(43);
const TEXT = code => code + " is your Relay code to confirm this number. It expires in 10 minutes. Don't share it with anyone.\n\n@zzmm92nr59-cloud.github.io #" + code;
const RECOVERY = ["aaaaa-bbbbb", "ccccc-ddddd", "eeeee-fffff", "ggggg-hhhhh", "jjjjj-kkkkk", "mmmmm-nnnnn", "ppppp-qqqqq", "rrrrr-sssss"];
let st;
const reset = o => { st = { available: true, ending: null, pendingEnding: null, twoStep: false, app: false, left: 0, starts: [], confirms: [], sends: 0, textCalls: [], signinTexts: 0, verifies: [], methods: ["text"], ...o }; };
reset();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
// The stand-in for Android's text reader: hands over a code only when the test says one has "arrived".
await ctx.addInitScript(() => {
  if (!("OTPCredential" in window)) window.OTPCredential = function () {};
  const real = navigator.credentials && navigator.credentials.get ? navigator.credentials.get.bind(navigator.credentials) : null;
  Object.defineProperty(navigator, "credentials", { configurable: true, value: { get: o => {
    if (!o || !o.otp) return real ? real(o) : Promise.reject(new Error("no"));
    window.__otpAsked = (window.__otpAsked || 0) + 1;
    return new Promise((res, rej) => { const t = setInterval(() => { if (o.signal && o.signal.aborted) { clearInterval(t); rej(new DOMException("aborted", "AbortError")); } else if (window.__otpCode) { clearInterval(t); res({ type: "otp", code: window.__otpCode }); window.__otpCode = null; } }, 100); });
  }, create: () => Promise.reject(new Error("no")) } });
});
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  const body = () => { try { return JSON.parse(route.request().postData() || "{}"); } catch { return {}; } };
  if (p === "/relay/auth/providers") return j({ email: true, google: false, microsoft: false });
  if (p === "/relay/auth/request") return j({ ok: true });
  if (p === "/relay/auth/verify-code") return body().code === "123456" ? j({ needsSecondStep: true, pendingToken: PENDING, methods: st.methods, ...(st.methods.includes("text") ? { phoneEnding: "123" } : {}), email: EMAIL }) : j({ error: "invalid_or_expired_code" }, 400);
  if (p === "/relay/auth/2fa/text") { st.signinTexts++; assert.equal(body().pendingToken, PENDING); return j({ ok: true, ending: "123", resendIn: 30 }); }
  if (p === "/relay/auth/2fa/verify") { const b = body(); st.verifies.push(b.code); return b.pendingToken === PENDING && ["654321", "246810", RECOVERY[0]].includes(b.code) ? j({ sessionToken: TOKEN, email: EMAIL, expiresAt: Date.now() + 864e5 }) : j({ error: "invalid_code" }, 400); }
  if (p === "/relay/my/phone" && m === "GET") return j({ available: st.available, ending: st.ending, confirmedAt: st.ending ? Date.now() - 6e4 : null, twoStep: st.twoStep });
  if (p === "/relay/my/phone/start") {
    const b = body(); st.starts.push(b.phone);
    const d = String(b.phone || "").replace(/[^\d+]/g, "");
    if (!/^(?:0|\+44|44)7\d{9}$/.test(d)) return j({ error: "phone_invalid" }, 400);
    st.pendingEnding = d.slice(-3); return j({ ok: true, ending: st.pendingEnding, resendIn: 30 });
  }
  if (p === "/relay/my/phone/confirm") { const b = body(); st.confirms.push(b.code); if (b.code !== "123456") return j({ error: "invalid_or_expired_code" }, 400); st.ending = st.pendingEnding; return j({ ok: true, ending: st.ending }); }
  if (p === "/relay/my/phone/remove") { if (st.twoStep) return j({ error: "two_step_on" }, 409); st.ending = null; return j({ ok: true }); }
  if (p === "/relay/my/devices/sign-out-others") { st.signedOutOthers = (st.signedOutOthers || 0) + 1; return j({ ok: true, count: 2 }); }
  if (p === "/relay/my/2fa" && m === "GET") return j({ enabled: st.twoStep || st.app, app: st.app, text: st.twoStep, phoneEnding: st.ending, textAvailable: st.available, recoveryCodesLeft: st.twoStep || st.app ? st.left : 0 });
  if (p === "/relay/my/2fa/text/send") { st.sends++; return st.ending ? j({ ok: true, ending: st.ending, resendIn: 30 }) : j({ error: "no_phone" }, 400); }
  if (p === "/relay/my/2fa/text") {
    const b = body(); st.textCalls.push(b);
    if (b.on === true) { if (b.code !== "123456") return j({ error: "invalid_code" }, 400); if (!st.ending) st.ending = st.pendingEnding; st.twoStep = true; st.left = 8; return j({ ok: true, recoveryCodes: RECOVERY }); }
    if (b.code !== "123456" && b.code !== RECOVERY[1]) return j({ error: "invalid_code" }, 400);
    st.twoStep = false; st.left = 0; return j({ ok: true });
  }
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, connectedAt: Date.now() - 864e5, lastScanAt: Date.now() - 36e5 });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  if (p === "/relay/my/wrapped") return j({ year: 2026, years: [], industries: [], receipts: 0 });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
const sheet = page.locator(".rl-sheet, #mePage");
// The polish rules, and readable colours, on whatever is showing.
const measure = () => page.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; }; // color-mix() comes back as color(srgb 0–1)
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c; } return rgb(getComputedStyle(document.body).backgroundColor); };
  const out = { small: [], tiny: [], symbols: [], faint: [] };
  for (const el of document.querySelectorAll(".rl-sheet button, .rl-sheet a, .rl-sheet input, #mePage button, #mePage a, #mePage input")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(".rl-sheet *, #mePage *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el);
    if (parseFloat(s.fontSize) < 13 && !(s.textTransform === "uppercase" && parseFloat(s.fontSize) >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + s.fontSize);
    const a = lum(rgb(s.color)), b = lum(bgOf(el)), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3 && !el.closest("button:disabled")) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  return out;
});
const polished = async where => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(80);
    assert.deepEqual(await measure(), { small: [], tiny: [], symbols: [], faint: [] }, where + " (" + scheme + ")");
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const shot = async name => { for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(80); await page.screenshot({ path: "/tmp/shots/phone-" + name + "-" + scheme + ".png" }); } await page.emulateMedia({ colorScheme: "light" }); };
const paste = (sel, text) => page.locator(sel).evaluate((el, t) => { el.focus(); const dt = new DataTransfer(); dt.setData("text/plain", t); el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
const codeBoxIs = async sel => assert.equal(await page.locator(sel).evaluate(el => [el.autocomplete, el.inputMode, el.getAttribute("pattern")].join(" ")), "one-time-code numeric [0-9]*", sel + ": the phone offers the code from the notification, on the numbers keypad");
const signedInAt = async () => {
  await page.goto(origin + "/index.html");
  await page.evaluate(([e, t]) => localStorage.setItem("relay.session.v1", JSON.stringify({ token: t, email: e, expiresAt: 9e12 })), [EMAIL, TOKEN]);
  await page.reload(); await profileButton(page).click();
  await page.getByRole("heading", { name: "Profile", exact: true }).waitFor(); await page.locator("#mePage .rl-arow").first().waitFor();
  // Phone number, Two-step sign-in and Devices live in Profile's Security and privacy.
  await page.locator("#mePage .rl-arow", { hasText: "Security and privacy" }).click();
  await page.locator("#mePage .rl-arow", { hasText: "Delete my account" }).waitFor(); await page.waitForTimeout(500);
};
const openRow = async label => { await page.locator(".rl-arow", { hasText: label }).first().click(); await page.getByRole("button", { name: "Back to Security" }).waitFor(); };

// 1. Phone number shows in Account only when Relay can send texts.
reset({ available: false });
await signedInAt();
assert.equal(await page.locator(".rl-arow", { hasText: "Phone number" }).isVisible(), false, "no texts, no Phone number row (nothing to set up)");
reset();
await signedInAt();
await page.locator(".rl-arow", { hasText: "Phone number" }).waitFor();
assert.match(await page.locator(".rl-arow", { hasText: "Phone number" }).innerText(), /Add one for sign-in codes/);
console.log("ok - Phone number appears in Profile only when Relay can send texts");

// 2. Adding a number: type it, a code is texted, paste the whole text (or let the phone fill it) and it's confirmed.
await openRow("Phone number");
await page.locator("#rl-phone").waitFor();
assert.equal(await page.locator("#rl-phone").evaluate(el => el.type + " " + el.autocomplete + " " + el.inputMode), "tel tel tel", "the phone keypad, and the phone can fill in its own number");
await polished("phone: number");
await page.locator("#rl-phone").fill("020 7946 0000");
await page.getByRole("button", { name: "Text me a code" }).click();
await page.getByText("That isn't a UK mobile number. Type it like 07700 900123.").waitFor();
await page.locator("#rl-phone").fill("07700 900123");
await page.getByRole("button", { name: "Text me a code" }).click();
await page.getByText("We've texted a 6-digit code to your number ending 123.").waitFor();
assert.deepEqual(st.starts, ["020 7946 0000", "07700 900123"]);
await codeBoxIs("#rl-phone-code");
const again = page.getByRole("button", { name: /Text me a new code/ });
assert.equal(await again.isDisabled(), true, "no second text straight away");
assert.match(await again.innerText(), /Text me a new code \((29|30)s\)/, "says how long until another can be sent");
await polished("phone: code"); await shot("code");
await page.locator("#rl-phone-code").fill("99999");
await page.getByRole("button", { name: "Confirm number" }).click();
await page.getByText("That code isn't right, or it has expired.").waitFor();
assert.equal(await page.locator("#rl-phone-code").inputValue(), "", "cleared for the next try");
await paste("#rl-phone-code", TEXT("123456"));
await page.getByText("Number confirmed.").waitFor(); // (waiting on this, not "number ending 123", which the code step already says)
await page.getByText("Number ending 123").waitFor();
assert.deepEqual(st.confirms, ["99999", "123456"], "pasting the whole text sends just the code, by itself");
await page.getByRole("button", { name: "Text me a code when I sign in" }).waitFor();
await polished("phone: confirmed"); await shot("confirmed");
console.log("ok - adding a number: UK mobiles only, a texted code (pasted whole, it keeps just the code and sends itself), a wait before another text");

// 3. Codes by text when signing in: switched on with a fresh code; recovery codes shown once.
await page.getByRole("button", { name: "Text me a code when I sign in" }).click();
await page.locator(".rl-2s", { hasText: "Text message" }).waitFor();
assert.match(await page.locator(".rl-2s", { hasText: "Text message" }).innerText(), /Off[\s\S]*number ending 123/);
await polished("two-step: off");
await page.getByRole("button", { name: "Turn on codes by text" }).click();
await page.getByText("We've texted a 6-digit code to your number ending 123. Type it to turn this on.").waitFor();
assert.equal(st.sends, 1, "a code is texted at once");
await page.locator("#rl-2s-manage").fill("000000");
await page.getByText("That code isn't right. Check it and try again.").waitFor();
assert.equal(st.twoStep, false);
await page.evaluate(() => { window.__otpCode = "123456"; });
await page.getByText("Codes by text are on.").waitFor();
assert.deepEqual(st.textCalls.map(c => c.code), ["000000", "123456"], "Android's text reader filled in the code and it went by itself");
for (const c of RECOVERY) await page.getByText(c, { exact: false }).first().waitFor();
await polished("two-step: recovery codes"); await shot("recovery");
await page.getByRole("button", { name: "I've saved them" }).click();
await page.locator(".rl-2s", { hasText: "Text message" }).getByText("On", { exact: true }).waitFor();
await page.getByText("8 recovery codes left.").waitFor();
assert.equal(await page.getByRole("button", { name: "Set up authenticator app" }).count(), 0, "one way at a time: no app while texts are on");
await page.getByText("One way at a time. To switch, turn this one off first.").waitFor();
await polished("two-step: on");
// The number can't be changed while codes go to it.
await page.getByRole("button", { name: "Back to Security" }).click();
await page.locator(".rl-arow", { hasText: "Two-step sign-in" }).getByText("On: text message").waitFor();
await openRow("Phone number");
await page.getByText("To change or remove this number, turn off codes by text under Two-step sign-in first.").waitFor();
assert.equal(await page.getByRole("button", { name: "Remove number" }).count(), 0);
await page.getByRole("button", { name: "Back to Security" }).click();
console.log("ok - codes by text: switched on with a code texted now, recovery codes shown once, the number locked while it's on");

// 4. Signing in with codes by text: "Check your phone", the code texted at once, finished by the texted code.
reset({ ending: "123", twoStep: true, left: 8 });
await page.evaluate(() => localStorage.clear()); await page.goto(origin + "/index.html");
await page.getByRole("button", { name: "I already have an account" }).click();
await page.getByRole("button", { name: "Continue with email" }).click();
await page.locator("#rl-signin-email").fill(EMAIL);
await page.getByRole("button", { name: "Email me a sign-in link" }).click();
await paste("#rl-signin-code", "123456 is your Relay sign-in code");
await page.getByRole("heading", { name: "Check your phone" }).waitFor();
assert.equal(await page.evaluate(() => localStorage.getItem("relay.session.v1")), null, "not signed in after the first step");
await page.getByText("Relay texts a 6-digit code to your number ending 123.").waitFor();
await page.waitForTimeout(300);
assert.equal(st.signinTexts, 1, "the code is texted as soon as the step shows, once");
await codeBoxIs("#rl-2s-code");
assert.equal(await page.getByRole("button", { name: /Text me a new code/ }).isDisabled(), true);
assert.equal(await page.getByRole("button", { name: "Use my authenticator app instead" }).count(), 0, "no app on this account");
await polished("sign-in: check your phone"); await shot("signin");
await page.locator("#rl-2s-code").fill("111111");
await page.getByText("That code isn't right. Check it and try again.").waitFor();
await page.locator("#rl-2s-code").fill("654321");
await homeShows(page, "J");
assert.ok((await page.evaluate(() => localStorage.getItem("relay.session.v1"))).includes(TOKEN), "signed in after the texted code");
assert.deepEqual(st.verifies, ["111111", "654321"]);
console.log("ok - signing in: 'Check your phone', the code texted once, straight away; the texted code finishes it");

// 5. With the authenticator app: "Enter your code", and a recovery code if the phone is lost.
reset({ ending: "123", twoStep: false, app: true, left: 8, methods: ["app"] });
await page.evaluate(() => localStorage.clear()); await page.goto(origin + "/index.html");
await page.getByRole("button", { name: "I already have an account" }).click();
await page.getByRole("button", { name: "Continue with email" }).click();
await page.locator("#rl-signin-email").fill(EMAIL);
await page.getByRole("button", { name: "Email me a sign-in link" }).click();
await page.locator("#rl-signin-code").fill("123456");
await page.getByRole("heading", { name: "Enter your code" }).waitFor();
await page.getByText("Open your authenticator app").waitFor();
await polished("sign-in: app code");
await page.getByRole("button", { name: "Use a recovery code" }).click();
await page.getByRole("heading", { name: "Use a recovery code" }).waitFor();
assert.equal(await page.locator("#rl-2s-code").evaluate(el => el.inputMode || "text"), "text", "recovery codes have letters");
await polished("sign-in: recovery code");
await page.locator("#rl-2s-code").fill("zzzzz-zzzzz");
await page.getByRole("button", { name: "Confirm" }).click();
await page.getByText("That recovery code isn't right, or it's already been used.").waitFor();
await page.locator("#rl-2s-code").fill(RECOVERY[0]);
await page.getByRole("button", { name: "Confirm" }).click();
await homeShows(page, "J");
assert.equal(st.signinTexts, 0, "no text when codes come from the app");
console.log("ok - with the app: its code, or a recovery code without the phone");

// 6. Turning codes by text off needs a code (texted now, or a recovery code).
reset({ ending: "123", twoStep: true, left: 8 });
await signedInAt();
await openRow("Two-step sign-in");
await page.getByRole("button", { name: "Turn off codes by text" }).click();
await page.getByText("To turn this off, type the code we've just texted to your number ending 123.").waitFor();
assert.equal(await page.locator("#rl-2s-manage").getAttribute("placeholder"), "6-digit code or recovery code");
await polished("two-step: turning off");
await paste("#rl-2s-manage", "ab234-567cd");
assert.equal(await page.locator("#rl-2s-manage").inputValue(), "", "a recovery code pasted here isn't turned into a 6-digit code");
await page.locator("#rl-2s-manage").fill(RECOVERY[1]);
await page.getByRole("button", { name: "Turn off", exact: true }).click();
await page.getByText("Codes by text are off.").waitFor();
assert.equal(st.twoStep, false);
await page.getByRole("button", { name: "Back to Security" }).click();
await openRow("Phone number");
await page.getByRole("button", { name: "Remove number" }).click();
await page.getByRole("button", { name: "Remove number" }).last().click();
await page.getByText("Number removed.").waitFor();
await page.locator("#rl-phone").waitFor();
console.log("ok - turning it off takes a code; then the number can be removed");

// 7. Devices: sign out every other phone and computer in one tap; this one stays signed in.
reset({});
await signedInAt();
await openRow("Devices");
await page.getByText("Signs Relay out on every other phone, tablet and computer, including ones that are lost or shared. You stay signed in here.").waitFor();
await page.getByText(/Relay emails you whenever how you sign in changes/).waitFor();
await polished("devices");
await page.getByRole("button", { name: "Sign out other devices" }).dblclick();
await page.getByText("2 other devices were signed out. Only this one is signed in now.").waitFor();
assert.equal(st.signedOutOthers, 1, "a double tap signs out once");
assert.equal(await page.locator("button.rl-btn", { hasText: /^Done$/ }).isDisabled(), true, "and the button can't be pressed again");
assert.ok(await page.evaluate(() => Boolean(localStorage.getItem("relay.session.v1"))), "this device is still signed in");
await polished("devices: done"); await shot("devices");
console.log("ok - Devices: other phones and computers signed out in one tap (once, even on a double tap); this one stays in");

assert.deepEqual(errors, []);
await browser.close(); server.close();
console.log("PASS phone numbers and codes by text: Account row only when texts work, texted codes that paste and send themselves, a wait between texts, recovery codes, polished in light and dark (FAKE text reader, stubbed server)");
