// Browser test: the new layout as a try-out for Relay's team only (next.html, with its own account-next.js).
// Stubbed Relay server. Checks:
//  * the current app: only a team account sees "Try the new layout" (Profile, Team); it opens next.html;
//  * next.html shows nothing until Relay's server has said the account is on the team, then shows the new layout;
//  * "Back to the current layout" goes back to ./ and nothing is remembered: opening Relay again shows the current app;
//  * anyone else is sent to ./ without the new layout ever showing: signed out (and nothing of the app starts, nothing
//    is asked of the server), a shopper who isn't on the team, a team account that has to sign in again, no answer
//    from the server, the account changing in another tab, and signing out inside it;
//  * the service worker never keeps next.html or account-next.js (a changed copy shows on the very next open), and
//    with no connection next.html goes back to the current app. It asks for the two files past the browser's own
//    short-lived copies too; the test browser keeps none while a test answers for the server, so that is read from sw.js.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { readFileSync } from "node:fs"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const TYPES = { ".js": "text/javascript", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
// The page server. build marks a new release of next.html; down is the phone having no connection (the server hangs up).
const site = { build: 1, down: false };
const server = createServer(async (req, res) => {
  if (site.down) { req.socket.destroy(); return; }
  try {
    const path = new URL(req.url, "http://x").pathname, p = resolve(".", "." + path.replace(/\/$/, "/index.html"));
    let body = await readFile(p);
    if (path.endsWith("/next.html")) body = Buffer.from(body.toString("utf8").replace("<title>", '<meta name="test-build" content="' + site.build + '"><title>'));
    res.setHeader("Content-Type", TYPES[extname(p)] || "text/html"); res.end(body);
  } catch { res.statusCode = 404; res.end("not found"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
// Three made-up accounts, told apart by their sign-in: on the team, a shopper, and on the team but needing to sign in again.
const TEAM = "T".repeat(43), SHOPPER = "S".repeat(43), AGAIN = "A".repeat(43);
const EMAILS = { [TEAM]: "ops@example.com", [SHOPPER]: "member@example.com", [AGAIN]: "ops2@example.com" };
const st = { hold: 0, down: false };
const asked = []; // every request to Relay's server: which page asked, and for what
const stub = async ctx => {
  await ctx.route("https://**/*", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
    const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith("/relay/")) return route.abort();
    let from = ""; try { from = new URL(req.frame().url()).pathname; } catch { from = ""; }
    asked.push({ from, method: m, path: p, bookmark: await req.headerValue("x-d1-bookmark") });
    const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: H, body: JSON.stringify(b) });
    const token = ((await req.headerValue("authorization")) || "").replace(/^Bearer /, "");
    if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
    if (p === "/relay/my/admin/me") {
      if (st.down) return route.abort();
      if (st.hold) await new Promise(r => setTimeout(r, st.hold));
      return j(token === TEAM ? { admin: true, openReports: 0 } : token === AGAIN ? { admin: false, signInAgain: true } : { admin: false });
    }
    if (p === "/relay/my/admin/review-account") return token === TEAM ? j({ on: false }) : j({ error: "not_found" }, 404);
    if (p === "/relay/auth/logout") return j({ ok: true });
    if (p === "/relay/my/profile") return j({ email: EMAILS[token] || "", name: token === TEAM ? "Ops" : "Member", photo: null });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true, outlookAvailable: true });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAILS[token] || "", others: [] });
    if (p === "/relay/my/receipts") return j({ receipts: [] });
    if (p === "/relay/my/purchases") return j({ purchases: [] });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
    if (p === "/relay/my/2fa") return j({ required: true, enrolled: true, verified: true, methods: ["passkey"], app: true, text: false });
    if (p === "/relay/my/phone") return j({ available: false });
    if (p === "/relay/my/card") return j({ enabled: false });
    if (p === "/relay/my/help/chat" && m === "GET") return j({ available: true, handoff: true });
    if (p === "/relay/my/auctions") return j({ canBid: true, auctions: [] });
    if (p === "/relay/auctions") return j({ auctions: [] });
    if (p === "/relay/shopify/catalogue") return j({ published: true, products: [] });
    return j({});
  });
  // Written down by the page itself as it goes: whether next.html ever let anything show. It outlives the move to ./ .
  await ctx.addInitScript(() => {
    if (!/\/next\.html$/.test(location.pathname)) return;
    const note = () => { try {
      const root = document.documentElement, body = document.body;
      if (root && !root.classList.contains("rl-gate")) sessionStorage.setItem("test-gate-opened", "1");
      if (body && Number(getComputedStyle(body).opacity) > 0) sessionStorage.setItem("test-shown", "1");
    } catch (e) { /* the page is going away */ } };
    new MutationObserver(note).observe(document, { attributes: true, subtree: true, attributeFilter: ["class"] });
    const tick = () => { note(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    document.addEventListener("DOMContentLoaded", note);
  });
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await stub(ctx);
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
const pathOf = () => new URL(page.url()).pathname;
const signIn = async token => {
  await page.goto(origin + "/index.html");
  await page.evaluate(([t, e]) => { localStorage.clear(); sessionStorage.clear(); if (t) localStorage.setItem("relay.session.v1", JSON.stringify({ token: t, email: e, expiresAt: 9e12 })); }, [token, EMAILS[token] || ""]);
};
const tabs = () => page.evaluate(() => [...document.querySelectorAll("#foot button")].map(b => (b.getAttribute("aria-label") || b.innerText || "").trim().replace(/\s+/g, " ")));
const CURRENT_TABS = ["Home", "Receipts", "Discover", "Profile"];
const currentApp = async what => {
  await page.waitForURL(u => new URL(u).pathname === "/", { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll("#foot button").length > 0 || document.querySelector("#view .darkbtn"), null, { timeout: 15000 });
  assert.equal(await page.locator("html.rl-gate").count(), 0, what + ": the current app has no gate");
  assert.equal(await page.locator(".h2-band, #homePage.h2-home").count(), 0, what + ": the current layout is showing, not the new one");
};
// Opens next.html expecting to be sent away, and says whether anything of the new layout ever showed on the way.
const sentAway = async what => {
  const from = asked.length;
  await page.goto(origin + "/next.html", { waitUntil: "commit" }).catch(() => {});
  await currentApp(what);
  const seen = await page.evaluate(() => ({ opened: sessionStorage.getItem("test-gate-opened"), shown: sessionStorage.getItem("test-shown") }));
  assert.deepEqual(seen, { opened: null, shown: null }, what + ": nothing of the new layout ever showed");
  return asked.slice(from).filter(a => a.from === "/next.html");
};
const profileRows = async () => { await page.locator("#mePage .rl-arow").first().waitFor(); await page.locator("#mePage .rl-arow", { hasText: "Two-step sign-in" }).waitFor(); await page.waitForTimeout(500); };

// 1. The current app. A shopper has no way in; a team account has one row for it.
await signIn(SHOPPER);
await page.goto(origin + "/index.html");
await page.evaluate(() => window.go("me")); await profileRows();
assert.equal(await page.getByText("Try the new layout").count(), 0, "a shopper never sees the row");
assert.equal(await page.locator("#mePage").getByText("Team", { exact: true }).count(), 0, "a shopper has no Team group");
await signIn(TEAM);
await page.goto(origin + "/index.html");
assert.deepEqual(await tabs(), CURRENT_TABS, "opening Relay shows the current layout");
await page.evaluate(() => window.go("me")); await profileRows();
const way = page.locator("#mePage .rl-arow", { hasText: "Try the new layout" });
await way.waitFor();
for (const scheme of ["light", "dark"]) {
  await page.emulateMedia({ colorScheme: scheme });
  const m = await way.evaluate(e => ({ h: e.getBoundingClientRect().height, sizes: [...e.querySelectorAll("b, .rl-arow-d")].map(x => parseFloat(getComputedStyle(x).fontSize)), text: e.innerText.replace(/\s+/g, " ").trim() }));
  assert.ok(m.h >= 44, "the row is at least 44px tall (" + scheme + ")");
  assert.ok(m.sizes.every(s => s >= 13), "the row's words are at least 13px (" + scheme + ")");
  assert.equal(m.text, "Try the new layout Only Relay's team can open it");
}
await page.emulateMedia({ colorScheme: "light" });
await way.scrollIntoViewIfNeeded(); await page.screenshot({ path: "/tmp/shots/layout-preview-team-row.png" });
console.log("ok - the current app: only a team account has Try the new layout");

// 2. It opens next.html, which shows nothing until Relay's server has answered.
st.hold = 900;
await page.evaluate(() => localStorage.setItem("relay.bookmark.v1", "bookmark-0000000123"));
const before2 = asked.length;
await Promise.all([page.waitForURL(u => new URL(u).pathname === "/next.html"), way.click()]);
await page.waitForLoadState("domcontentloaded");
const waiting = await page.evaluate(() => ({ gate: document.documentElement.classList.contains("rl-gate"), opacity: getComputedStyle(document.body).opacity, taps: getComputedStyle(document.body).pointerEvents, inert: document.body.hasAttribute("inert") }));
assert.deepEqual(waiting, { gate: true, opacity: "0", taps: "none", inert: true }, "while Relay's server hasn't answered, nothing shows, and nothing can be tapped, reached by keyboard or read out");
assert.equal(await page.evaluate(() => sessionStorage.getItem("test-shown")), null, "nothing showed before the answer");
await page.waitForFunction(() => !document.documentElement.classList.contains("rl-gate") && getComputedStyle(document.body).opacity === "1", null, { timeout: 15000 });
assert.equal(await page.evaluate(() => document.body.hasAttribute("inert")), false, "once open, the page can be used");
assert.equal((asked.slice(before2).find(a => a.from === "/next.html" && a.path === "/relay/my/admin/me") || {}).bookmark, "bookmark-0000000123", "the team check is asked with the newest bookmark, as the app asks");
st.hold = 0;
await page.locator("#homePage.h2-home").waitFor();
await page.waitForFunction(() => document.querySelectorAll("#foot button").length === 4);
assert.deepEqual(await tabs(), ["Home", "Ask", "Browse", "Receipts"], "the new layout's four tabs");
assert.equal(await page.locator(".h2-band .h2-top").count(), 1, "the new Home with its pinned top row");
assert.ok(await page.evaluate(() => [...document.scripts].some(s => /account-next\.js$/.test(s.src)) && ![...document.scripts].some(s => /\/account\.js$/.test(s.src))), "next.html runs its own account script");
await page.screenshot({ path: "/tmp/shots/layout-preview-home.png" });
// Each tab opens without a script error.
for (const [key, mark] of [["ask", "#view"], ["discover", "#view"], ["receipts", "#view"], ["profile", "#homePage"]]) { await page.evaluate(k => window.tabTap(k), key); await page.locator(mark).waitFor(); await page.waitForTimeout(500); }
console.log("ok - a team account: nothing shows until the server has answered, then the new layout opens");

// 3. The way back, and nothing remembered.
await page.locator(".h2-me").click();
await page.locator("#mePage .rl-arow").first().waitFor();
const back = page.locator("#mePage .rl-arow", { hasText: "Back to the current layout" });
await back.waitFor();
const bm = await back.evaluate(e => ({ h: e.getBoundingClientRect().height, sizes: [...e.querySelectorAll("b, .rl-arow-d")].map(x => parseFloat(getComputedStyle(x).fontSize)), text: e.innerText.replace(/\s+/g, " ").trim() }));
assert.ok(bm.h >= 44 && bm.sizes.every(s => s >= 13), "the way back is 44px tall with 13px words");
assert.equal(bm.text, "Back to the current layout The app shoppers use today");
assert.equal(await page.getByText("Try the new layout").count(), 0, "the new layout doesn't offer itself");
await back.scrollIntoViewIfNeeded(); await page.screenshot({ path: "/tmp/shots/layout-preview-back-row.png" });
await Promise.all([page.waitForURL(u => new URL(u).pathname === "/"), back.click()]);
await currentApp("back");
assert.deepEqual(await tabs(), CURRENT_TABS, "back on the current layout");
await page.goto("about:blank"); await page.goto(origin + "/");
await currentApp("opening Relay again");
assert.deepEqual(await tabs(), CURRENT_TABS, "nothing is remembered: opening Relay shows the current layout");
// (relay-web-preview is the team's older switch for shops' websites in Discover, nothing to do with this.)
assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter(k => /layout|preview|next/i.test(k) && k !== "relay-web-preview")), [], "no switch is kept on the device");
console.log("ok - Back to the current layout, and opening Relay again shows the current app");

// 4. Signed out: sent to ./ at once. Nothing of the app starts, so Relay's server is asked nothing.
await signIn(null);
assert.deepEqual(await sentAway("signed out"), [], "signed out: next.html asks Relay's server nothing");
assert.equal(await page.evaluate(() => localStorage.getItem("relay.session.v1")), null);
console.log("ok - signed out: sent to the current app, nothing started");

// 5. A shopper who isn't on the team: sent to ./ . What the hidden page asked for is only what the app reads on opening.
await signIn(SHOPPER);
const shopperAsked = await sentAway("a shopper");
assert.ok(shopperAsked.some(a => a.path === "/relay/my/admin/me"), "the team check was asked");
assert.deepEqual(shopperAsked.filter(a => a.method !== "GET"), [], "nothing is changed on the server for someone being sent away");
console.log("ok - a shopper who isn't on the team: sent to the current app");

// 6. A team account that has to sign in again doesn't get in either.
await signIn(AGAIN);
await sentAway("a team account that must sign in again");
console.log("ok - a team account that must sign in again: sent to the current app");

// 7. No answer from Relay's server: nobody is let in on trust.
await signIn(TEAM);
st.down = true;
await sentAway("no answer");
st.down = false;
console.log("ok - no answer from the server: sent to the current app");

// 8. The account changes in another tab while the new layout is open: checked again, and sent away.
await signIn(TEAM);
await page.goto(origin + "/next.html");
await page.waitForFunction(() => !document.documentElement.classList.contains("rl-gate"));
const other = await ctx.newPage();
await other.goto(origin + "/terms.html");
await other.evaluate(([t, e]) => localStorage.setItem("relay.session.v1", JSON.stringify({ token: t, email: e, expiresAt: 9e12 })), [SHOPPER, EMAILS[SHOPPER]]);
await currentApp("another account");
await other.close();
console.log("ok - the account changing in another tab: checked again and sent to the current app");

// 9. Signing out inside the new layout lands on the current app, signed out.
await signIn(TEAM);
await page.goto(origin + "/next.html");
await page.waitForFunction(() => !document.documentElement.classList.contains("rl-gate"));
await page.locator(".h2-me").click();
await page.locator("#mePage .rl-arow").first().waitFor();
await Promise.all([page.waitForURL(u => new URL(u).pathname === "/"), page.locator("#mePage .rl-aout", { hasText: "Sign out" }).click()]);
await currentApp("signed out inside");
assert.equal(await page.evaluate(() => localStorage.getItem("relay.session.v1")), null, "signed out");
console.log("ok - signing out inside the new layout lands on the current app");
assert.deepEqual(errors, [], "no script errors");
await ctx.close();

// 10. The service worker, running for real: the try-out's two files are never kept, a new copy shows on the next open,
//     and with no connection next.html goes back to the current app.
const sw = readFileSync("sw.js", "utf8");
assert.ok(sw.includes('if (/\\/(next\\.html|account-next\\.js)$/.test(url.pathname)) {') && sw.includes('event.respondWith(fetch(req.url, { cache: "no-store" })'), "the two files are fetched past the browser's own copies, and not kept");
assert.ok(!/SHELL = \[[^\]]*next/.test(sw), "the try-out isn't in the list kept for use with no connection");
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
await stub(ctx2);
const p2 = await ctx2.newPage(); const errors2 = []; p2.on("pageerror", e => errors2.push(String(e)));
await p2.goto(origin + "/index.html");
await p2.evaluate(([t, e]) => { localStorage.clear(); localStorage.setItem("relay.session.v1", JSON.stringify({ token: t, email: e, expiresAt: 9e12 })); }, [TEAM, EMAILS[TEAM]]);
await p2.evaluate(() => navigator.serviceWorker.ready);
await p2.goto(origin + "/index.html");
await p2.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 20000 });
const build = () => p2.evaluate(() => (document.querySelector('meta[name="test-build"]') || {}).content || null);
await p2.goto(origin + "/next.html");
await p2.waitForFunction(() => !document.documentElement.classList.contains("rl-gate"));
assert.ok(await p2.evaluate(() => Boolean(navigator.serviceWorker.controller)), "the service worker is in charge of next.html");
assert.equal(await build(), "1");
site.build = 2; // a new release
await p2.goto(origin + "/index.html"); await p2.goto(origin + "/next.html");
await p2.waitForFunction(() => !document.documentElement.classList.contains("rl-gate"));
assert.equal(await build(), "2", "a new copy of next.html shows on the very next open");
const kept = await p2.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname); return out; });
assert.ok(kept.includes("/index.html") && kept.includes("/account.js"), "the current app is kept for use with no connection");
assert.deepEqual(kept.filter(x => /next\.html|account-next\.js/.test(x)), [], "the try-out's files are never kept");
site.down = true;
await p2.goto(origin + "/next.html", { waitUntil: "commit" }).catch(() => {});
await p2.waitForURL(u => new URL(u).pathname === "/", { timeout: 15000 });
await p2.waitForFunction(() => document.querySelectorAll("#foot button").length > 0, null, { timeout: 15000 });
assert.equal(await p2.locator(".h2-band, html.rl-gate").count(), 0, "with no connection, next.html goes back to the current app");
site.down = false;
assert.deepEqual(errors2, [], "no script errors with the service worker running");
console.log("ok - the service worker never keeps the try-out's files; a new copy shows at once; no connection goes back to the current app");

await browser.close(); server.close();
console.log("PASS the new layout as a team-only try-out: the way in and out, the gate, and the service worker (stubbed server)");
