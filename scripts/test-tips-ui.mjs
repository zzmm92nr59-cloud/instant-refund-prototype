// Browser test: the first-run tips. Stubbed Relay server, made-up accounts and shops.
// Checks: after the interests sheet (or straight away when it isn't shown), on Home, one tip for each tab (Home, Ask,
// Browse, Receipts; no Ask tip without the assistant): the page dimmed but the tip's tab lit, an arrow to that tab, one
// line, Next (Done on the last) and Skip on every tip; buttons 44px or more, the tip's words at 4.5 to 1 in light and dark;
// keyboard and screen readers (a dialog named by its title, focus on Next and kept in the tip, Escape skips); a double
// tap on Next moves one tip; each tip is shown once per account: kept with the account, not shown again on this phone
// or another, and opening the app afterwards asks Relay nothing about tips; Skip ends them all; Profile, Help and legal,
// "Show the tips again" shows them again.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.SHOTS; if (SHOTS) await mkdir(SHOTS, { recursive: true });
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const receipts = [{ id: "33333333-3333-4333-8333-333333333333", status: "pending", kind: "receipt", retailer: { name: "Kick Lane", domain: "kicklane.example" }, orderDate: day(-4), totalPence: 8500, currency: "GBP", items: [{ name: "Court Classic Trainers", qty: 1, pricePence: 8500 }], returnable: true, returns: { deadline: day(20) }, category: "fashion" }];
// The server's side: per account, what they shop for and which tips they've seen.
const st = { interests: {}, tips: {}, tipGets: 0, tipPuts: [], ai: true };
const browser = await chromium.launch();
async function phone(email, { scheme = "light", view = { width: 390, height: 844 }, scale = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: scale, colorScheme: scheme, serviceWorkers: "block" });
  await ctx.route("https://**/*", async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, m = req.method();
    const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    const j = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", headers: H, body: JSON.stringify(b) });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith("/relay/")) return route.abort();
    const who = email, body = () => JSON.parse(req.postData() || "{}");
    if (p === "/relay/my/tips" && m === "GET") { st.tipGets++; return j({ seen: st.tips[who] || [], updatedAt: null }); }
    if (p === "/relay/my/tips" && m === "PUT") { const b = body(); st.tipPuts.push([who, b.seen]); st.tips[who] = b.seen; return j({ seen: b.seen, updatedAt: Date.now() }); }
    if (p === "/relay/my/interests" && m === "GET") return j({ interests: st.interests[who] || [], updatedAt: null });
    if (p === "/relay/my/interests" && m === "PUT") { st.interests[who] = body().interests; return j({ interests: st.interests[who], updatedAt: Date.now() }); }
    if (p === "/relay/my/help/chat" && m === "GET") return j({ available: st.ai, handoff: true });
    if (p === "/relay/my/receipts") return j({ receipts });
    if (p === "/relay/my/purchases") return j({ purchases: [] });
    if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
    if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: who, lastScanAt: Date.now() });
    if (p === "/relay/my/profile") return j({ email: who, name: "Jess Tester", photo: null });
    if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
    return j({});
  });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
  await page.addInitScript(e => { if (!localStorage.getItem("relay.session.v1")) localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); }, email);
  return { ctx, page, errors };
}
const tip = page => page.locator(".rl-tip[role=dialog]");
const title = async page => (await tip(page).locator("h2").innerText()).trim();
const tabOf = { Home: "profile", Ask: "ask", Browse: "discover", Receipts: "receipts" };
const contrast = page => page.evaluate(() => {
  const c = document.createElement("canvas").getContext("2d"), rgb = v => { c.clearRect(0, 0, 1, 1); c.fillStyle = "#000"; c.fillStyle = v; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const L = a => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }; return .2126 * f(a[0]) + .7152 * f(a[1]) + .0722 * f(a[2]); };
  const card = document.querySelector(".rl-tip"), bg = rgb(getComputedStyle(card).backgroundColor);
  return Math.min(...[...card.querySelectorAll("h2, p")].map(e => { const a = L(rgb(getComputedStyle(e).color)), b = L(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }));
});
// The tip on screen: its tab is lit inside the ring and the arrow points at it; the rest of the page is dimmed.
async function checkTip(page, name, last) {
  await tip(page).waitFor();
  assert.equal(await title(page), name);
  await page.waitForTimeout(350); // the ring moves to the next tab
  const g = await page.evaluate(key => {
    const r = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const tab = [...document.querySelectorAll('#foot [data-tab="' + key + '"], #side [data-tab="' + key + '"]')].find(t => t.getBoundingClientRect().width > 0);
    const ring = document.querySelector(".rl-tip-ring"), arrow = document.querySelector(".rl-tip-arrow");
    return { tab: r(tab), ring: r(ring), arrow: r(arrow), dim: getComputedStyle(ring).boxShadow, focus: document.activeElement && document.activeElement.textContent,
      buttons: [...document.querySelectorAll(".rl-tip button")].map(b => [b.textContent, Math.round(b.getBoundingClientRect().height)]), tiny: [...document.querySelectorAll(".rl-tip h2, .rl-tip p, .rl-tip button")].filter(e => parseFloat(getComputedStyle(e).fontSize) < 13).length };
  }, tabOf[name]);
  assert.ok(g.ring.l <= g.tab.l && g.ring.r >= g.tab.r && g.ring.t <= g.tab.t && g.ring.b >= g.tab.b, name + ": the tab is lit, inside the ring");
  assert.match(g.dim, /rgba\(0, 0, 0, 0\.[5-9]/, name + ": the page behind is dimmed");
  const ax = g.arrow.l + g.arrow.w / 2;
  assert.ok(ax >= g.tab.l && ax <= g.tab.r && g.arrow.b <= g.tab.t, name + ": the arrow points down at its tab");
  assert.deepEqual(g.buttons.map(b => b[0]), ["Skip", last ? "Done" : "Next"], name + ": Skip on every tip, then Next (Done on the last)");
  assert.ok(g.buttons.every(b => b[1] >= 44), name + ": buttons 44px or more");
  assert.equal(g.tiny, 0, name + ": no text under 13px");
  assert.equal(g.focus, last ? "Done" : "Next", name + ": the keyboard is on " + (last ? "Done" : "Next"));
  assert.ok(await contrast(page) >= 4.5, name + ": words at 4.5 to 1 or better");
  assert.equal(await tip(page).getAttribute("aria-modal"), "true");
  assert.equal(await tip(page).getAttribute("aria-labelledby"), "rl-tip-h", "a dialog named by its title");
}

// 1. Interests already chosen: the tips come straight away on Home, one per tab, in order.
st.interests["jess@example.com"] = ["fashion"];
{
  const { ctx, page, errors } = await phone("jess@example.com");
  await page.goto(origin + "/index.html");
  await checkTip(page, "Home");
  assert.match(await tip(page).locator("p").innerText(), /^What needs you comes first/);
  for (const scheme of ["dark", "light"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(100); assert.ok(await contrast(page) >= 4.5, scheme + ": 4.5 to 1"); }
  // Keyboard: Tab stays inside the tip.
  await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => document.activeElement.textContent), "Skip");
  await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => document.activeElement.textContent), "Next");
  // A double tap on Next moves one tip.
  await page.waitForTimeout(500);
  await tip(page).getByRole("button", { name: /^Next/ }).dblclick();
  await page.waitForTimeout(300);
  await checkTip(page, "Ask");
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter"); // Next, from the keyboard
  await checkTip(page, "Browse");
  await page.waitForTimeout(500);
  await tip(page).getByRole("button", { name: /^Next/ }).click();
  await checkTip(page, "Receipts", true);
  await page.waitForTimeout(500);
  await tip(page).getByRole("button", { name: /^Done/ }).click();
  await tip(page).waitFor({ state: "detached" });
  for (let i = 0; i < 50 && (st.tips["jess@example.com"] || []).length < 4; i++) await page.waitForTimeout(100);
  assert.deepEqual([...st.tips["jess@example.com"]].sort(), ["ask", "browse", "home", "receipts"], "kept with the account as each was shown");
  // Opened again: not shown again, and Relay isn't asked about tips.
  const gets = st.tipGets;
  await page.reload(); await page.locator("#homePage .h2-feed > *").first().waitFor(); await page.waitForTimeout(2500);
  assert.equal(await tip(page).count(), 0, "shown once: not again on this phone");
  assert.equal(st.tipGets, gets, "and opening the app asks Relay nothing about them");
  assert.deepEqual(errors, []);
  await ctx.close();
}
console.log("ok - straight away when there's no interests sheet: four tips, tab lit, arrow, Next/Done and Skip, 44px, keyboard, one step per double tap, 4.5 to 1, shown once");

// 2. The same account on another phone: the account says they've been seen, so they don't show.
{
  const { ctx, page, errors } = await phone("jess@example.com");
  await page.goto(origin + "/index.html"); await page.locator("#homePage .h2-feed > *").first().waitFor(); await page.waitForTimeout(2500);
  assert.equal(await tip(page).count(), 0, "not shown on another phone");
  // Profile, Help and legal: Show the tips again.
  await page.evaluate(() => window.go("me"));
  await page.locator("#mePage .rl-arow", { hasText: "Help and legal" }).click();
  await page.locator("#mePage .rl-arow", { hasText: "Show the tips again" }).click();
  await checkTip(page, "Home");
  assert.equal(await page.evaluate(() => window.page), "profile", "on Home");
  assert.deepEqual(st.tipPuts.find(p => p[0] === "jess@example.com" && !p[1].length), ["jess@example.com", []], "the account forgets them");
  // Escape is Skip: they all go, and stay gone.
  await page.keyboard.press("Escape");
  await tip(page).waitFor({ state: "detached" });
  for (let i = 0; i < 50 && (st.tips["jess@example.com"] || []).length < 4; i++) await page.waitForTimeout(100); // (sent in order, a moment later)
  assert.deepEqual([...st.tips["jess@example.com"]].sort(), ["ask", "browse", "home", "receipts"], "skipping counts them all as seen");
  assert.deepEqual(errors, []);
  await ctx.close();
}
console.log("ok - another phone doesn't show them again; Show the tips again does; Escape skips them all");

// 3. A new account with no interests: the interests sheet first, then (after Not now) the tips. Without the assistant,
//    there's no Ask tab, so no Ask tip, and Receipts says Done. Skip ends them.
st.ai = false;
{
  const { ctx, page, errors } = await phone("sam@example.com");
  await page.goto(origin + "/index.html");
  await page.locator(".rl-int-sheet").waitFor();
  await page.waitForTimeout(800);
  assert.equal(await tip(page).count(), 0, "not while the interests sheet is open");
  await page.locator(".rl-int-later").click();
  await checkTip(page, "Home");
  await page.waitForTimeout(500); await tip(page).getByRole("button", { name: /^Next/ }).click();
  await checkTip(page, "Browse");
  await page.waitForTimeout(500); await tip(page).getByRole("button", { name: "Skip" }).click();
  await tip(page).waitFor({ state: "detached" });
  for (let i = 0; i < 50 && (st.tips["sam@example.com"] || []).length < 3; i++) await page.waitForTimeout(100);
  assert.deepEqual([...st.tips["sam@example.com"]].sort(), ["browse", "home", "receipts"], "Skip: the ones left count as seen");
  assert.deepEqual(errors, []);
  await ctx.close();
}
console.log("ok - after the interests sheet; no Ask tip without the assistant; Skip ends them");

// 4. Relay can't be reached: kept on the phone instead, and still not shown again there.
st.ai = true;
{
  const { ctx, page } = await phone("amy@example.com");
  st.interests["amy@example.com"] = ["tech"];
  await ctx.route("https://**/relay/my/tips", r => r.abort());
  await page.goto(origin + "/index.html");
  await checkTip(page, "Home");
  await page.keyboard.press("Escape");
  await page.reload(); await page.locator("#homePage .h2-feed > *").first().waitFor(); await page.waitForTimeout(2500);
  assert.equal(await tip(page).count(), 0, "kept on the phone when Relay can't be reached");
  await ctx.close();
}
console.log("ok - with Relay out of reach, the phone remembers");

// Pictures (SHOTS=<folder>): a tip, life-size (402 by 874 at 3x), light and dark.
if (SHOTS) for (const scheme of ["light", "dark"]) {
  const email = "pic-" + scheme + "@example.com"; st.interests[email] = ["fashion"];
  const { ctx, page } = await phone(email, { scheme, view: { width: 402, height: 874 }, scale: 3 });
  await page.goto(origin + "/index.html"); await checkTip(page, "Home"); await page.waitForTimeout(600);
  await page.screenshot({ path: SHOTS + "/tip-home-" + scheme + ".png" });
  await page.waitForTimeout(500); await tip(page).getByRole("button", { name: /^Next/ }).click(); await checkTip(page, "Ask"); await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + "/tip-ask-" + scheme + ".png" });
  await ctx.close();
}
await browser.close(); server.close();
console.log("PASS first-run tips: after interests or straight away, one per tab, tab lit and pointed at, Next/Done and Skip, keyboard, once per account");
