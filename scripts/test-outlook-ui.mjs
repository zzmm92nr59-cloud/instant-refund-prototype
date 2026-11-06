// Browser test: the Outlook screens. "Continue with Microsoft" on the sign-in sheet (only when switched on),
// "Connect Outlook" on the Receipts page, coming back from Microsoft, and every screen naming Outlook instead of Gmail.
// Stubbed Relay server and a stubbed Microsoft page; made-up data. Real Microsoft is not contacted.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const MS_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=x&state=s";
const RID = "44444444-4444-4444-8444-444444444444";
const state = { microsoft: true, accepted: true, earlier: false, connected: false, provider: "microsoft", oneStep: false };
const WORDING = ["With your permission, Relay reads your email (Gmail or Outlook) in read-only mode.", "You can disconnect your email at any time."];
const posts = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route("https://login.microsoftonline.com/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Microsoft</title><h1>Microsoft sign-in (stub)</h1>" }));
await ctx.route("https://accounts.google.com/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Google</title><h1>Google (stub)</h1>" }));
await ctx.route("https://**/*", route => {
  const u = new URL(route.request().url()), m = route.request().method();
  if (u.hostname === "login.microsoftonline.com" || u.hostname === "accounts.google.com") return route.fallback();
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!u.pathname.startsWith("/relay/")) return route.abort();
  if (m === "POST") posts.push({ path: u.pathname, body: route.request().postData() ? JSON.parse(route.request().postData()) : null });
  if (u.pathname === "/relay/auth/providers") return j({ email: true, google: true, microsoft: state.microsoft, ...(state.microsoft ? { consent: { version: "v5", text: WORDING } } : {}) });
  if (u.pathname === "/relay/auth/microsoft/start") return j({ url: MS_URL });
  if (u.pathname === "/relay/auth/verify") return j({ sessionToken: "T".repeat(43), email: "jess.tester@outlook.com", expiresAt: Date.now() + 864e5, ...(state.oneStep ? { outlookConnected: true } : {}) });
  if (u.pathname === "/relay/my/consent" && m === "GET") return j({ version: "v5", accepted: state.accepted, acceptedEarlier: state.earlier, gmailAvailable: true, outlookAvailable: true,
    text: ["With your permission, Relay reads your email (Gmail or Outlook) in read-only mode.", "You can disconnect your email at any time."] });
  if (u.pathname === "/relay/my/consent" && m === "POST") { state.accepted = true; return j({ ok: true }); }
  if (u.pathname === "/relay/my/gmail/connect") return j({ url: MS_URL });
  if (u.pathname === "/relay/my/gmail" && m === "GET") return j(state.connected ? { connected: true, provider: state.provider, googleEmail: "jess.tester@outlook.com", email: "jess.tester@outlook.com", connectedAt: Date.now(), lastScanAt: Date.now() - 3600e3 } : { connected: false });
  if (u.pathname === "/relay/my/gmail/scan") return j({ ok: true, added: 1, updated: 0, alreadyCaptured: 0, notReceipts: 0, more: false, cursor: null });
  if (u.pathname === "/relay/my/receipts") return j({ receipts: state.connected ? [{ id: RID, status: "pending", kind: "receipt", retailer: { name: "Example Outfitters", domain: "exampleoutfitters.test" },
    orderRef: "OL-1", orderDate: "2026-10-14", totalPence: 5900, currency: "GBP", items: [{ name: "Wool jumper", qty: 1, pricePence: 5900 }], outlookId: "AQMkADAwATM0MDAAMS1-receipt1", category: "fashion", categoryLabel: "Fashion" }] : [] });
  if (u.pathname === "/relay/my/receipts/" + RID + "/original") return j({ html: "<p>Order OL-1</p>", extraImages: [], links: [] });
  if (u.pathname === "/relay/my/gmail/history") return j({ years: [], earliest: 2020 });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));

// 1. Signed out: "Continue with Microsoft" shows only when Microsoft sign-in is switched on.
state.microsoft = false;
await page.goto(origin + "/index.html"); await page.waitForTimeout(600);
await page.evaluate(() => window.RelayAccount.open());
await page.getByRole("button", { name: "Continue with Google" }).waitFor();
await page.waitForTimeout(400);
assert.equal(await page.getByRole("button", { name: "Continue with Microsoft" }).count(), 0, "no dead Microsoft button before it is set up");
state.microsoft = true;
await page.reload(); await page.waitForTimeout(600);
await page.evaluate(() => window.RelayAccount.open());
const msBtn = page.getByRole("button", { name: "Continue with Microsoft" });
await msBtn.waitFor();
await page.screenshot({ path: "/tmp/shots/signin-microsoft.png" });
// One step: the wording is shown first, then "Agree and continue" signs in and connects Outlook together.
await msBtn.click();
await page.getByRole("heading", { name: "Sign in and bring in your receipts" }).waitFor();
assert.ok(await page.getByText(WORDING[0]).count(), "Relay's wording is shown before going to Microsoft");
await page.getByRole("button", { name: "Back" }).click();
await page.getByRole("button", { name: "Continue with Google" }).waitFor();
await page.getByRole("button", { name: "Continue with Microsoft" }).click();
await page.getByRole("button", { name: "Agree and continue with Microsoft" }).waitFor();
await page.screenshot({ path: "/tmp/shots/signin-microsoft-agree.png" });
await Promise.all([page.waitForURL(/login\.microsoftonline\.com/), page.getByRole("button", { name: "Agree and continue with Microsoft" }).click()]);
const start = posts.find(p => p.path === "/relay/auth/microsoft/start");
assert.match(start.body.nonce, /^[A-Za-z0-9_-]{43}$/);
assert.equal(start.body.consentVersion, "v5", "the wording version shown is the one agreed to");
console.log("ok - Continue with Microsoft shows Relay's wording, then Agree and continue goes to Microsoft with this browser's nonce");

// 2. Back from Microsoft: the one-time token and this browser's nonce sign the shopper in.
await page.goto(origin + "/index.html#signin=" + "A".repeat(43)); await page.waitForTimeout(900);
const verify = posts.find(p => p.path === "/relay/auth/verify");
assert.equal(verify.body.token, "A".repeat(43));
assert.equal(verify.body.nonce, start.body.nonce, "the nonce saved before leaving is sent back");
assert.equal(await page.evaluate(() => localStorage.getItem("relay_gnonce")), null, "and then forgotten");
assert.equal(await page.evaluate(() => window.RelayAccount.email()), "jess.tester@outlook.com");
// Signed in: the sign-up steps carry on (no name yet, so that's asked first).
await page.getByRole("heading", { name: "What should we call you?" }).waitFor();
await page.keyboard.press("Escape");
console.log("ok - coming back from Microsoft signs the shopper in");

// 2b. Signed in and Outlook connected in that one step: straight to Receipts, the first scan starts, no "Connect Outlook".
state.oneStep = true; state.connected = true; posts.length = 0;
await page.evaluate(() => { localStorage.removeItem("relay.session.v1"); localStorage.setItem("relay_gnonce", "N".repeat(43)); });
await page.goto(origin + "/index.html#signin=" + "B".repeat(43));
// The sign-up steps: the scan is already counting while the name is asked, then "See my receipts".
await page.getByRole("heading", { name: "What should we call you?" }).waitFor();
await page.waitForTimeout(800);
assert.ok(posts.some(p => p.path === "/relay/my/gmail/scan"), "the first scan starts by itself, straight away");
await page.locator(".rl-jscan").waitFor();
await page.getByRole("button", { name: "Skip" }).click();
await page.getByRole("button", { name: "See my receipts" }).click();
await page.getByText(/Found or updated 1 receipt/).waitFor();
assert.equal(await page.getByRole("button", { name: "Connect Outlook" }).count(), 0, "no second Microsoft step");
assert.equal(await page.evaluate(() => localStorage.getItem("relay.mailbox")), "outlook", "every screen now names Outlook");
await page.screenshot({ path: "/tmp/shots/one-step-receipts.png" });
// Group tiles use drawn pictures (or a photo of something bought), not emoji.
const tile = page.locator(".rl-tile:not(.rl-year)").first();
await tile.waitFor();
assert.equal(await page.locator(".rl-tile .rl-tile-art svg, .rl-tile .rl-tile-pic").count() >= 1, true);
const cardText = await page.locator(".rl-tiles").innerText();
assert.ok(!/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(cardText), "no emoji on the group tiles: " + cardText);
// A missing receipt can be added straight from the Receipts page, searching Outlook as you type.
await page.getByRole("button", { name: "Add a missing receipt" }).click();
await page.getByRole("heading", { name: "Add a receipt" }).waitFor();
assert.equal(await page.locator("#rl-ar-q").getAttribute("placeholder"), "Search your Outlook");
await page.getByRole("button", { name: "Back" }).click();
assert.equal(await page.locator(".rl-sheet").count(), 0, "Back closes the search");
state.oneStep = false; state.connected = false;
console.log("ok - one step: signed in with Outlook already connected, Receipts open and the scan starts; group tiles have drawn icons");

// 3. A Microsoft account with a non-Microsoft address is told to use the email link instead.
await page.evaluate(() => { localStorage.removeItem("relay.session.v1"); });
await page.goto(origin + "/index.html#msignin=other_address"); await page.waitForTimeout(700);
await page.getByText("Microsoft sign-in didn't work").waitFor();
assert.ok(await page.getByText(/works with Outlook, Hotmail and Live addresses/).count());
console.log("ok - a non-Outlook address is pointed to the email link");

// 4. Signed in, not connected: the Receipts page offers both Gmail and Outlook.
await page.evaluate(() => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "S".repeat(43), email: "jess.tester@outlook.com" })));
await page.goto(origin + "/index.html"); await page.waitForTimeout(700);
await page.evaluate(() => window.go("receipts"));
await page.getByRole("button", { name: "Connect Outlook" }).waitFor();
assert.ok(await page.getByRole("button", { name: "Connect Gmail" }).count(), "Gmail still offered");
assert.ok(await page.getByText("Connect the email you shop with, Gmail or Outlook").count());
assert.ok(await page.getByText("Outlook works with Outlook.com, Hotmail and Live addresses.").count());
await page.screenshot({ path: "/tmp/shots/receipts-connect-outlook.png" });
posts.length = 0;
await Promise.all([page.waitForURL(/login\.microsoftonline\.com/), page.getByRole("button", { name: "Connect Outlook" }).click()]);
assert.deepEqual(posts.find(p => p.path === "/relay/my/gmail/connect").body, { provider: "microsoft" });
console.log("ok - Connect Outlook asks Relay for an Outlook connection and goes to Microsoft");

// 5. Back from Microsoft with Outlook connected: the scan starts and every screen says Outlook.
state.connected = true;
posts.length = 0;
await page.goto(origin + "/index.html#outlook=connected"); await page.waitForTimeout(1200);
assert.ok(posts.some(p => p.path === "/relay/my/gmail/scan"), "the first scan starts by itself");
await page.getByText(/Found or updated 1 receipt/).waitFor();
assert.equal(await page.getByText("Outlook connected. Scanning for receipts…").count(), 0, "the 'scanning' note goes once the scan is done");
const pageText = await page.locator("body").innerText();
assert.ok(!/Gmail/.test(pageText), "no Gmail wording for an Outlook shopper: " + (pageText.match(/.{0,40}Gmail.{0,40}/) || [""])[0]);
await page.screenshot({ path: "/tmp/shots/receipts-outlook-connected.png" });
// The original email opens from Outlook.
await page.getByText("Fashion", { exact: true }).first().click();
await page.locator(".rl-rr-main", { hasText: "Example Outfitters" }).first().click();
await page.locator(".rl-rr-detail .rl-pill", { hasText: /^(View receipt|Receipt and (QR code|label))$/ }).first().click();
await page.getByText("Shown straight from your Outlook. Relay doesn't keep a copy.").waitFor();
await page.keyboard.press("Escape");
await page.evaluate(() => window.RelayAccount.open());
await page.locator(".rl-arow", { hasText: "Outlook · connected" }).click();
await page.locator(".rl-sheet").getByRole("button", { name: "Add a missing receipt" }).waitFor();
assert.ok(await page.getByRole("button", { name: "Disconnect jess.tester@outlook.com" }).count());
assert.match(await page.locator(".rl-ibx-row").innerText(), /jess\.tester@outlook\.com[\s\S]*Outlook · Checked/);
assert.ok(await page.getByText("Disconnecting an inbox deletes every receipt Relay captured from it. Receipts you added by hand stay.").count());
await page.locator(".rl-sheet").getByRole("button", { name: "Add a missing receipt" }).click();
await page.getByRole("searchbox", { name: "Search Outlook for a receipt" }).waitFor();
assert.equal(await page.locator("#rl-ar-q").getAttribute("placeholder"), "Search your Outlook");
console.log("ok - with Outlook connected, the scan starts, the original opens from Outlook and every screen names Outlook");

// 6. Someone who agreed to the earlier wording is told what changed.
state.accepted = false; state.earlier = true;
await page.goto(origin + "/index.html"); await page.waitForTimeout(600);
await page.evaluate(() => window.go("receipts"));
await page.getByText(/permission wording changed: it now works with Outlook as well as Gmail/).waitFor();
await page.getByRole("button", { name: "Review and agree" }).click();
await page.getByRole("heading", { name: "We've updated this" }).waitFor();
assert.ok(await page.getByText(/What Relay reads and keeps is the same/).count());
await page.screenshot({ path: "/tmp/shots/consent-updated.png" });
console.log("ok - a changed permission wording is explained, not shown as if for the first time");

assert.deepEqual(errors, []);
console.log("PASS Outlook screens: Microsoft sign-in, Connect Outlook, Outlook wording everywhere (stubbed server)");
await browser.close(); server.close();
