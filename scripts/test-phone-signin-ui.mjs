// Browser test: signing in on a computer by approving it from a phone that's already signed in (worker/phone-signin.js).
// A stubbed Relay server shared by two browsers: a signed-out "computer" and a signed-in "phone". Made-up people.
// Checks: "Sign in with your phone" on the Welcome back page shows a code (greyed outline first, never a spinner); the phone
// finds it under Security and privacy, says which device it is, and a double tap on Approve approves once; the computer
// then signs in by itself and stops asking; a code that ran out says so in plain words with a way to get a new one;
// a wrong code on the phone is explained. Tap targets, text sizes and contrast on both screens.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const PHONE = "P".repeat(43), COMPUTER = "C".repeat(43), EMAIL = "sam.tester@example.com";
let st;
const reset = (o = {}) => { st = { code: "KQ7MZ4XR", poll: "p".repeat(43), approved: false, used: false, expired: false, starts: 0, checks: 0, checksAfter: 0, looks: [], approves: 0, ...o }; };
reset();
const browser = await chromium.launch();
const route = async (route) => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  const body = () => { try { return JSON.parse(req.postData() || "{}"); } catch { return {}; } };
  if (p === "/relay/auth/providers") return j({ email: true, google: true, microsoft: true, consent: { version: "v5", text: ["Relay reads your receipts."] } });
  if (p === "/relay/auth/phone/start") { st.starts++; await new Promise(r => setTimeout(r, 300)); return j({ pollToken: st.poll, code: st.code, expiresAt: Date.now() + 300e3 }); }
  if (p === "/relay/auth/phone/check") {
    st.checks++; if (st.used) st.checksAfter++;
    if (body().pollToken !== st.poll) return j({ error: "invalid_request" }, 400);
    if (st.expired) return j({ error: "expired" }, 410);
    if (st.approved && !st.used) { st.used = true; return j({ sessionToken: COMPUTER, email: EMAIL, expiresAt: Date.now() + 864e5 }); }
    if (st.used) return j({ error: "expired" }, 410);
    return j({ waiting: true });
  }
  if (p === "/relay/my/devices/look") { st.looks.push(body().code); return body().code === st.code ? j({ device: "Chrome on a Mac", startedAt: Date.now() - 30e3 }) : j({ error: "code_not_found" }, 404); }
  if (p === "/relay/my/devices/approve") { st.approves++; await new Promise(r => setTimeout(r, 300)); if (body().code !== st.code || st.approved) return j({ error: "code_not_found" }, 404); st.approved = true; return j({ ok: true, device: "Chrome on a Mac" }); }
  if (p === "/relay/my/second-step") return j({ required: false, done: true, checked: true });
  if (p === "/relay/my/2fa") return j({ enabled: true, app: true, text: false, phoneEnding: null, textAvailable: false, recoveryCodesLeft: 10 });
  if (p === "/relay/my/passkeys") return j({ passkeys: [], rpId: "127.0.0.1" });
  if (p === "/relay/my/admin/me") return j({ admin: false });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Sam", photo: null });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5 });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/interests") return j({ interests: ["fashion"] });
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  return j({});
};
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
  await ctx.route("https://**/*", route);
  const page = await ctx.newPage(); page.errors = []; page.on("pageerror", e => page.errors.push(String(e)));
  page.on("dialog", () => { throw new Error("a browser pop-up appeared; Relay must ask inside the page"); });
  return page;
};
const measure = (page, scope) => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; };
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [], spinners: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " input")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓+×✕↩]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    if (px < 13) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    if (/^Loading/i.test(el.textContent.trim())) out.spinners.push(el.textContent.trim().slice(0, 30));
    if (el.closest(".rl-pcode-off")) continue;
    const back = bgOf(el), a = lum(flat(rgb(s.color), back)), b = lum(back), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3 && !el.closest("button:disabled")) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const polished = async (page, where, scope) => {
  assert.deepEqual(await measure(page, scope), { small: [], tiny: [], symbols: [], faint: [], wide: [], spinners: [] }, where);
  await page.screenshot({ path: "/tmp/shots/phone-signin-" + where.replace(/\W+/g, "-") + ".png" });
};
const SHEET = ".rl-sheet";
// The computer: signed out, Welcome back, then Sign in with your phone.
async function toPhoneSignIn(page) {
  await page.goto(origin + "/index.html");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByRole("button", { name: "Sign in with your phone" }).click();
}

// 1. The computer gets a code: a greyed outline first, then the code, and it waits.
const computer = await newPage();
await toPhoneSignIn(computer);
await computer.locator(".rl-pcode.rl-skel").waitFor();
await computer.locator(".rl-pcode", { hasText: "KQ7M Z4XR" }).waitFor();
await computer.getByText("Waiting for your phone. The code works for 5 minutes.").waitFor();
assert.equal(st.starts, 1, "one code asked for");
await polished(computer, "computer code", SHEET);
console.log("ok - the computer shows a code (a greyed outline first, never a spinner) and waits for the phone");

// 2. The phone: Security and privacy → Sign in on another device. A wrong code is explained; the right one names the device.
const phone = await newPage();
await phone.goto(origin + "/index.html");
await phone.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "P".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await phone.reload();
await phone.evaluate(() => window.go("me"));
await phone.locator(".rl-arow", { hasText: "Settings" }).first().click();
await phone.locator(".rl-arow", { hasText: "Sign in on another device" }).click();
const field = phone.getByLabel("Code from the other device");
await field.fill("kq7m-z4xb");
await phone.getByRole("button", { name: "Continue" }).click();
await phone.getByText("That code isn't right or has run out. Check the other screen, or get a new code there.").waitFor();
assert.deepEqual(st.looks, ["KQ7MZ4XB"], "dashes and lower case don't matter");
await field.fill("kq7m z4xr");
await phone.getByRole("button", { name: "Continue" }).click();
await phone.locator(".rl-adevice", { hasText: "Sign in Chrome on a Mac?" }).waitFor();
assert.match(await phone.locator("body").innerText(), /It will be signed in to your Relay account, sam\.tester@example\.com\. Only approve if this code is on a screen in front of you now\./);
assert.equal(st.approved, false, "looking isn't approving");
await polished(phone, "phone approve", "body");
console.log("ok - the phone finds the code, explains a wrong one, and says which device will be signed in");

// 3. A double tap on Approve approves once; the phone says it's done; the computer signs itself in and stops asking.
const approve = phone.getByRole("button", { name: "Approve" });
await approve.dblclick();
await phone.locator(".rl-adevice", { hasText: "Done" }).waitFor();
await phone.getByText("Chrome on a Mac is signed in to your Relay account.", { exact: false }).waitFor();
assert.equal(st.approves, 1, "approved once");
await computer.waitForFunction(() => { try { return (JSON.parse(localStorage.getItem("relay.session.v1")) || {}).token === "C".repeat(43); } catch (e) { return false; } }, null, { timeout: 8000 });
const after = st.checks;
await computer.waitForTimeout(7000);
assert.equal(st.checks, after, "no more asking once signed in");
assert.equal(st.checksAfter, 0);
console.log("ok - a double tap approves once, and the computer signs itself in and stops asking (" + after + " checks)");

// 4. A code that ran out: plain words, faded code, and a new one on request (asked for once per tap).
reset({ expired: false });
const late = await newPage();
await toPhoneSignIn(late);
await late.locator(".rl-pcode", { hasText: "KQ7M Z4XR" }).waitFor();
st.expired = true;
await late.getByText("That code has run out. Get a new one and try again.").waitFor({ timeout: 8000 });
const checksAtEnd = st.checks;
await late.waitForTimeout(4000);
assert.equal(st.checks, checksAtEnd, "stops asking once it ran out");
await polished(late, "computer expired", SHEET);
st.expired = false;
await late.getByRole("button", { name: "Get a new code" }).dblclick();
await late.getByText("Waiting for your phone. The code works for 5 minutes.").waitFor();
assert.equal(st.starts, 2, "one new code per tap");
console.log("ok - a code that ran out says so, stops asking, and a new one is one tap away");

// 5. Hidden while waiting (the app in the background): it doesn't ask.
await late.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
const hiddenAt = st.checks;
await late.waitForTimeout(7000);
assert.equal(st.checks, hiddenAt, "nothing asked while in the background");
console.log("ok - nothing is asked while Relay is in the background");

for (const p of [computer, phone, late]) assert.deepEqual(p.errors, []);
await browser.close(); server.close();
console.log("\nphone sign-in: all checks passed");
