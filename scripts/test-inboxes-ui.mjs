// Browser test: more than one inbox in the app. Stubbed Relay server, made-up person and addresses; Google's and
// Microsoft's pages are FAKED (nothing here proves real Google or Microsoft accept the request).
// Checks: Profile says how many inboxes are connected; the Email connection page lists each inbox with how its reading is
// going, each with its own Disconnect, and buttons to add a Gmail or an Outlook inbox; adding one asks Relay for "another
// inbox" and goes to Microsoft's (or Google's) page, once even on a double tap; coming back says what happened (added,
// already connected, or not added); disconnecting one inbox, or the main one (the next becomes the main inbox), asks first
// and says what happens; at most five; Receipts says how many inboxes; Add a receipt searches every inbox, shows which one
// each email is in, and adds from that one. Every screen passes the polish rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", HOME = "jess.home@outlook.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const receipts = [{ id: "11111111-1111-4111-8111-111111111111", status: "pending", kind: "receipt", retailer: { name: "Kestrel Outdoor", domain: null }, orderRef: "KO-1", orderDate: day(-3), totalPence: 8900, currency: "GBP",
  category: "fashion", returnable: true, items: [{ name: "Trail Runner Shoes", qty: 1, pricePence: 8900, category: "fashion" }], returns: { deadline: day(20) } }];
let st;
const reset = o => { st = { others: [{ mailbox: 2, provider: "microsoft", email: HOME, lastScanAt: null, autoAt: null, scan: { state: "running", found: 4 } }], connects: [], disconnects: [], finds: [], adds: [], connectError: null, ...o }; };
reset();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  const body = () => { try { return JSON.parse(route.request().postData() || "{}"); } catch { return {}; } };
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true, outlookAvailable: true });
  if (p === "/relay/my/gmail" && m === "GET") return j({ connected: true, provider: "google", email: EMAIL, googleEmail: EMAIL, lastScanAt: Date.now() - 6e5, needsReconnect: Boolean(st.mainProblem), others: st.others, maxInboxes: 5 });
  if (p === "/relay/my/gmail/connect") {
    st.connects.push(body());
    if (st.connectError) return j({ error: st.connectError, max: 5 }, 409);
    const again = body().again, ms = again ? again > 1 && (st.others.find(o => o.mailbox === again) || {}).provider === "microsoft" : body().provider === "microsoft";
    return j({ url: ms ? "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?state=x" : "https://accounts.google.com/o/oauth2/v2/auth?state=x" });
  }
  if (p === "/relay/my/gmail/disconnect") {
    const b = body(); st.disconnects.push(b);
    if (b.mailbox) st.others = st.others.filter(o => o.mailbox !== b.mailbox);
    else { st.main = st.others.shift(); }
    return j({ ok: true, deleted: true, ...(b.mailbox ? {} : { nowFirst: st.main ? st.main.email : null }) });
  }
  if (p === "/relay/my/gmail/find") {
    st.finds.push(body().query);
    return j({ results: [{ id: "a1aaaaaa", subject: "Your Kestrel Outdoor order", from: "Kestrel Outdoor", date: day(-3), added: true, inbox: EMAIL },
      { id: "AAMkOutlookMsg0001", subject: "Your Studio North order", from: "Studio North", date: day(-5), added: false, mailbox: 2, inbox: HOME }] });
  }
  if (p === "/relay/my/gmail/add") { st.adds.push(body()); await new Promise(r => setTimeout(r, 200)); return j({ ok: true, kind: "receipt", store: "Studio North", orderRef: "SN-1" }); }
  if (p === "/relay/my/receipts") return j({ receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  return j({});
});
// Stand-ins for Microsoft's and Google's own pages (registered last, so they win).
await ctx.route("https://login.microsoftonline.com/**", r => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>FAKE Microsoft</h1>" }));
await ctx.route("https://accounts.google.com/**", r => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>FAKE Google</h1>" }));
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
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
    if (/[◎✦↻▶⌂◈▤⇄→✓+]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    if (px < 13 && !(s.textTransform === "uppercase" && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    const back = bgOf(el), a = lum(flat(rgb(s.color), back)), b = lum(back), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3 && !el.closest("button:disabled")) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.wide.push(document.documentElement.scrollWidth);
  return out;
}, scope);
const polished = async (where, scope) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(100);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/inboxes-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png", fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const signedIn = async (hash = "") => {
  await page.goto(origin + "/index.html");
  await page.evaluate(e => { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })); }, EMAIL);
  await page.goto(origin + "/index.html" + hash);
};
const profile = async () => { await page.evaluate(() => window.go("me")); await page.locator("#mePage .rl-arow").first().waitFor(); };
const mailPage = async () => { await page.locator(".rl-ptile", { hasText: "Email connection" }).click(); await page.getByRole("button", { name: "Back to Profile" }).waitFor(); await page.locator(".rl-ibx-row").first().waitFor(); };
const view = page.locator("#mePage");

// 1. Profile and the Email connection page: each inbox, how its reading is going, its own Disconnect, and ways to add more.
await signedIn();
await profile();
await page.locator(".rl-ptile", { hasText: "Email connection" }).getByText("2 inboxes connected").waitFor();
await mailPage();
const rows = page.locator(".rl-ibx-row");
assert.equal(await rows.count(), 2);
assert.match(await rows.nth(0).innerText(), new RegExp(EMAIL.replace(/\./g, "\\.") + "[\\s\\S]*Gmail, your main inbox, checked today at \\d\\d:\\d\\d"));
assert.match(await rows.nth(1).innerText(), /jess\.home@outlook\.com[\s\S]*Outlook, reading now: 4 found so far/);
assert.ok(!(await page.locator(".rl-ibx").innerText()).includes("·"), "said plainly, not glued together with dots");
await view.getByRole("button", { name: "Disconnect " + EMAIL }).waitFor();
await view.getByRole("button", { name: "Disconnect " + HOME }).waitFor();
await view.getByText("Shop with more than one email address? Add the others and Relay reads them all.").waitFor();
await view.getByRole("button", { name: "Add a Gmail inbox" }).waitFor();
await view.getByRole("button", { name: "Add an Outlook inbox" }).waitFor();
await polished("email connection", "#mePage");
console.log("ok - the Email connection page lists each inbox with how its reading is going, its own Disconnect, and ways to add more");

// 2. Adding another inbox: Relay is asked for "another inbox", then Microsoft's page (once, even on a double tap).
await view.getByRole("button", { name: "Add an Outlook inbox" }).dblclick();
await page.waitForURL(/login\.microsoftonline\.com/);
assert.deepEqual(st.connects, [{ provider: "microsoft", another: true }], "asked once, for another inbox");
// Back from Microsoft: added (the app remembered, in this tab only, that an inbox was being added).
await page.goto(origin + "/index.html");
assert.equal(await page.evaluate(() => sessionStorage.getItem("relay.addingInbox")), "1");
await page.goto(origin + "/index.html#outlook=added");
await page.getByText("Outlook inbox added. Relay is reading it now, and its receipts appear here in a few minutes.").waitFor();
assert.equal(await page.evaluate(() => sessionStorage.getItem("relay.addingInbox")), null, "the note is used once");
// (Receipts no longer says how many inboxes are connected: Email connection in Profile lists them.)
await profile(); await mailPage();
await page.locator(".rl-ibx-row").nth(1).waitFor();
assert.equal(await page.locator(".rl-ibx-row").count(), 2, "both inboxes are listed");
await page.getByRole("button", { name: "Back to Profile" }).click();
// Already connected, and not added (cancelled at Google).
await page.goto(origin + "/index.html#gmail=already_connected");
await page.getByText("That inbox is already connected to Relay.").waitFor();
await page.evaluate(() => sessionStorage.setItem("relay.addingInbox", "1"));
await page.goto(origin + "/index.html#gmail=denied");
await page.getByText("No inbox was added. Your other inboxes carry on as before.").waitFor();
// Too many.
st.connectError = "too_many_inboxes";
await profile(); await mailPage();
await view.getByRole("button", { name: "Add a Gmail inbox" }).click();
await view.getByText("Relay can read up to 5 inboxes for one account.").waitFor();
st.connectError = null;
console.log("ok - adding asks for another inbox and goes to Microsoft's page once; coming back says added, already connected or not added; at most five");

// 3. Disconnecting: one inbox (asks first), then the main one (the next becomes the main inbox).
await view.getByRole("button", { name: "Disconnect " + HOME }).click();
const dialog = page.locator("[role=alertdialog]");
await dialog.getByText("Disconnect " + HOME + " and delete the receipts Relay captured from it?").waitFor();
await dialog.getByRole("button", { name: "Disconnect and delete" }).click();
await page.waitForFunction(() => document.querySelectorAll(".rl-ibx-row").length === 1);
assert.deepEqual(st.disconnects, [{ mailbox: 2 }]);
st.others = [{ mailbox: 2, provider: "microsoft", email: HOME, lastScanAt: Date.now() - 36e5, autoAt: null }];
await signedIn(); await profile(); await mailPage(); // (a fresh start: the app reuses what it read in the last minute)
await page.waitForFunction(() => document.querySelectorAll(".rl-ibx-row").length === 2);
await view.getByRole("button", { name: "Disconnect " + EMAIL }).click();
await dialog.getByText("Disconnect " + EMAIL + " and delete the receipts Relay captured from it? " + HOME + " becomes your main inbox.").waitFor();
await dialog.getByRole("button", { name: "Cancel" }).click();
assert.equal(st.disconnects.length, 1, "Cancel disconnects nothing");
await view.getByRole("button", { name: "Disconnect " + EMAIL }).click();
await dialog.getByRole("button", { name: "Disconnect and delete" }).click();
await page.waitForFunction(() => document.querySelectorAll(".rl-ibx-row").length === 1);
assert.deepEqual(st.disconnects.at(-1), {});
console.log("ok - disconnecting one inbox, or the main one (the next takes its place), asks first");

// 4. Add a receipt searches every inbox, says which inbox each email is in, and adds from that one.
reset();
await signedIn(); await profile();
await page.locator(".rl-ptile", { hasText: "Add a missing receipt" }).click();
const q = page.locator("#rl-ar-q");
await q.waitFor();
assert.equal(await q.getAttribute("placeholder"), "Search your inboxes");
await q.fill("order"); await page.waitForTimeout(600);
const studio = page.locator(".rl-ar-row", { hasText: "Studio North" });
await studio.getByText("In " + HOME).waitFor();
await page.locator(".rl-ar-row", { hasText: "Kestrel Outdoor" }).getByText("In " + EMAIL).waitFor();
await studio.getByRole("button", { name: "Add Your Studio North order" }).dblclick();
await studio.getByText("In your Receipts now.").waitFor();
assert.deepEqual(st.adds, [{ messageId: "AAMkOutlookMsg0001", mailbox: 2 }], "added once, from the inbox it's in");
await view.getByRole("button", { name: "Add an Outlook inbox" }).waitFor();
await polished("add a receipt, two inboxes", "#mePage");
console.log("ok - Add a receipt searches every inbox, shows which inbox each email is in, and adds from that one");

// 5. An inbox whose access ended: Profile and its tab say so, the Email connection page offers Connect again (that same
//    inbox, asked for once even on a double tap, then Microsoft's page), and coming back says it's connected again.
reset({ others: [{ mailbox: 2, provider: "microsoft", email: HOME, lastScanAt: Date.now() - 36e5, checkedAt: Date.now() - 36e5, needsReconnect: true }] });
await signedIn();
const tabNumber = page.locator('#foot [data-tab="me"] .tab-badge');
await tabNumber.waitFor();
assert.equal(await tabNumber.innerText(), "1", "a red number on the Profile tab");
assert.match(await page.locator('#foot [data-tab="me"]').getAttribute("aria-label"), /^Profile, an inbox needs connecting again$/);
assert.equal(await page.locator('#foot [data-tab="profile"] .tab-badge').count(), 0, "on Profile, where Email connection is, not Home");
await profile();
await page.locator(".rl-ptile", { hasText: "Email connection" }).getByText("Needs connecting again").waitFor();
await mailPage();
assert.match(await rows.nth(1).innerText(), /jess\.home@outlook\.com[\s\S]*Outlook needs connecting again/);
await view.getByText("Relay can't read one of your inboxes at the moment. Connect it again and Relay catches up on what it missed. Your receipts stay as they are.").waitFor();
await polished("email connection, connect again", "#mePage");
await view.getByRole("button", { name: "Connect " + HOME + " again" }).dblclick();
await page.waitForURL(/login\.microsoftonline\.com/);
assert.deepEqual(st.connects, [{ again: 2 }], "asked once, for that same inbox");
await page.goto(origin + "/index.html");
assert.equal(await page.evaluate(() => sessionStorage.getItem("relay.reconnecting")), "1");
st.others[0].needsReconnect = false;
await page.goto(origin + "/index.html#outlook=reconnected");
await page.getByText("Outlook is connected again. Relay is catching up on what it missed, and new receipts come in as before.").waitFor();
assert.equal(await page.evaluate(() => sessionStorage.getItem("relay.reconnecting")), null, "the note is used once");
await page.evaluate(() => window.go("home")); await page.waitForTimeout(400);
assert.equal(await tabNumber.count(), 0, "the red number goes once it's connected again");
console.log("ok - an inbox whose access ended: the Profile tab, its tile and its row say so; Connect again asks once for that inbox and says when it's back");

// 6. The first inbox's access ended: Receipts says so at the top, with the button; cancelling at Google says it still can't read it.
reset({ mainProblem: true, others: [] });
await signedIn();
await page.evaluate(() => window.go("receipts"));
const fixCard = page.locator(".rl-recfix");
await fixCard.getByText("Relay can't read your Gmail right now").waitFor();
await fixCard.getByText("Google has ended Relay's access to " + EMAIL + ", so new receipts and parcel updates aren't coming in. Connect it again and Relay catches up on what it missed.").waitFor();
await polished("receipts, connect again", "#receiptsPage");
await fixCard.getByRole("button", { name: "Connect Gmail again" }).dblclick();
await page.waitForURL(/accounts\.google\.com/);
assert.deepEqual(st.connects, [{ again: 1 }]);
await page.goto(origin + "/index.html");
await page.goto(origin + "/index.html#gmail=denied");
await page.getByText("Gmail wasn't connected again, so Relay still can't read it. You can try again from Profile, then Email connection.").waitFor();
console.log("ok - the first inbox's access ended: Receipts says so first with Connect Gmail again; cancelling says it still can't read it");

assert.deepEqual(errors, [], "no page errors");
console.log("PASS more than one inbox in the app: listed, added, removed one at a time, and searched together (stubbed server)");
await browser.close(); server.close();
