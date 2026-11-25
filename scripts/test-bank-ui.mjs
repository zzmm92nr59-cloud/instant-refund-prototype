// Browser test: Bank and cards (Profile). Stubbed Relay server, made-up bank, shops and payments.
// Checks: hidden until Relay can offer it to this account, and while there are only test banks without the testing tools; says what it does (read-only, the bank's own page); Connect goes to
// the bank's page; coming back opens the page with what happened; connected banks and card payments, each saying which
// receipt it matches (or that there's none yet); disconnecting asks first. Passes the polish rules.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, openReceiptKind } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ID1 = "11111111-1111-4111-8111-111111111111";
const st = { available: false, links: [], disconnects: [], syncs: 0 };
const receipts = [{ id: ID1, status: "pending", needsShopperConfirmation: true, kind: "receipt", gmailId: "m1abcdef", retailer: { name: "Brindle & Co", domain: "brindle.example" },
  orderRef: "BR-1", orderDate: day(-5), totalPence: 4500, currency: "GBP", category: "fashion", categoryLabel: "Fashion", returnable: true, returns: null,
  items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 3500, category: "fashion" }], aiFilled: [] }];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (u.hostname === "auth.truelayer-sandbox.com") { st.went = u.toString(); return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Your bank</title><p>Bank sign-in</p>" }); }
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  if (p === "/relay/my/bank") return j(st.available ? { available: true, testBanks: !st.live, ...(st.live ? { choices: st.choices } : {}), connections: st.links } : { available: false, connections: [] });
  if (p === "/relay/my/bank/sync") { st.syncs++; if (st.syncDelay) await new Promise(r => setTimeout(r, st.syncDelay)); return j({ read: 0, gone: 0, matched: 1 }); }
  if (p === "/relay/my/bank/connect") { st.connectBodies = (st.connectBodies || []).concat([route.request().postData() ? JSON.parse(route.request().postData()) : null]); } 
  // Back from the bank's page: the app hands in the single-use code (worker/bank.js finishBank).
  if (p === "/relay/my/bank/finish") { const b = JSON.parse(route.request().postData() || "{}"); st.finishes = (st.finishes || []).concat([b]);
    if (st.finishAnswer === "not_your_link") return j({ error: "not_your_link" }, 403);
    st.links = st.pending || st.links; return j({ ok: true, id: "00000000-0000-4000-8000-0000000000aa" }); }
  if (p === "/relay/my/bank/connect") return j({ url: "https://auth.truelayer-sandbox.com/?response_type=code&state=" + "s".repeat(43) });
  if (p === "/relay/my/bank/payments") return j({ payments: st.links.length ? [
    { id: "a", account: "Current account", date: day(-4), amountPence: 4500, currency: "GBP", description: "BRINDLE AND CO LONDON", merchant: null, shop: "Brindle and Co", receiptId: ID1, match: "sure" },
    { id: "b", account: "Credit card ending 4242", date: day(-2), amountPence: 320, currency: "GBP", description: "COFFEE CORNER", merchant: "Coffee Corner", shop: "Coffee Corner", receiptId: null, match: null, notMine: st.notMine || null }] : [] });
  if (p === "/relay/my/bank/not-mine") { const b = JSON.parse(route.request().postData()); st.notMines.push(b); st.notMine = b.on ? (b.everyFromShop ? "shop" : "payment") : null; return j({ ok: true, matched: 1 }); }
  if (p === "/relay/my/bank/disconnect") { st.disconnects.push(JSON.parse(route.request().postData())); st.links = []; return j({ ok: true }); }
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5 });
  if (p === "/relay/my/receipts") return j({ receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/admin/me") return j({ admin: false, tester: true });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  return j({});
});
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
    if (/[◎✦↻▶⌂◈▤⇄→✓+×✕]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
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
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/bank-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png", fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload();
const view = page.locator("#mePage");
const openProfile = async () => { await page.evaluate(() => window.go("me")); await view.locator(".rl-arow", { hasText: "Inboxes" }).waitFor(); };

// 1. Until Relay can offer it to this account, there's no Bank and cards row.
await openProfile(); await page.waitForTimeout(400);
assert.equal(await view.locator(".rl-arow", { hasText: "Bank and cards" }).isVisible(), false);
console.log("ok - hidden until Relay can offer it");

// 2. Offered: says what it does; Connect goes to the bank's own page.
st.available = true;
await page.reload(); await openProfile(); // what the app already loaded is reused until it opens again
// While Relay can only offer test banks (made-up payments), that is for people testing Relay (CLAUDE.md rule 15): a
// shopper without the testing tools gets no Bank and cards row, and so never reads "Test banks… Mock Bank".
await page.waitForTimeout(600);
assert.equal(await view.locator(".rl-arow", { hasText: "Bank and cards" }).isVisible(), false, "test banks only: nothing for a shopper without the testing tools");
assert.doesNotMatch(await view.innerText(), /Test banks|Mock Bank/);
console.log("ok - test banks only: hidden without the testing tools");
// With the testing tools on, it's offered, with the words for testers.
await page.evaluate(() => localStorage.setItem("relay-testing-tools", "1"));
await page.reload(); await openProfile();
await view.locator(".rl-arow", { hasText: "Bank and cards" }).click();
await view.getByRole("button", { name: "Connect a bank or card" }).waitFor();
await view.getByText("Test banks only for now.", { exact: false }).waitFor();
const words = await view.innerText();
assert.match(words, /You sign in on your bank's own page\. Relay can only read payments: it can't move money\./);
assert.match(words, /Test banks only for now\. Choose Mock Bank, then sign in with john and doe\./);
assert.ok(st.syncs >= 1, "reads the banks again when opened");
await polished("bank page empty", "#mePage");
await view.getByRole("button", { name: "Connect a bank or card" }).click();
await page.waitForURL(/auth\.truelayer-sandbox\.com/);
assert.match(st.went, /response_type=code/);
console.log("ok - says what it does; Connect goes to the bank's own page");
// Testing tools off again for the rest: someone who has a test bank connected still has the row (to see it and to remove
// it), without the words for testers and without a way to connect another.
await page.goto(origin + "/index.html"); await page.evaluate(() => localStorage.removeItem("relay-testing-tools"));

// 3. Back from the bank (#bank=finish&bankcode=…): the app hands the code to Relay, signed in, and Relay finishes the
// connection. A link started on another device is refused, and said plainly. Then Profile opens Bank and cards, says
// it's connected, and shows the card payments and their receipts.
const CODE = "c".repeat(43);
st.finishAnswer = "not_your_link";
await page.goto(origin + "/index.html#bank=finish&bankcode=" + CODE);
await view.getByText("That bank link was started on another device. Start again here.").waitFor();
assert.equal(await page.evaluate(() => location.hash), "", "the code is taken out of the address at once");
assert.deepEqual(st.finishes, [{ code: CODE }], "the code is handed to Relay once");
assert.equal(st.links.length, 0);
st.finishAnswer = null; st.finishes = [];
st.pending = [{ id: "00000000-0000-4000-8000-0000000000aa", bank: "Mock Bank", label: "Mock Bank", connectedAt: new Date().toISOString(), syncedAt: new Date().toISOString(), needsReconnect: false, payments: 2, matched: 1 }];
// (A fresh open, as when the bank sends the shopper back.)
await page.goto(origin + "/index.html"); await page.goto(origin + "/index.html#bank=finish&bankcode=" + CODE);
await view.getByText("Connected. Relay is matching your payments to your receipts.").waitFor();
assert.deepEqual(st.finishes, [{ code: CODE }]);
assert.equal(await page.evaluate(() => location.hash), "", "the address is tidied");
await view.locator(".rl-bk-row").first().waitFor();
assert.doesNotMatch(await view.innerText(), /Test banks only|john and doe/, "no words for testers without the testing tools");
assert.equal(await view.getByRole("button", { name: /Connect a bank or card|Another bank or card/ }).isVisible(), false, "and no way to connect another test bank");
const rows = await view.locator(".rl-bk-row").allInnerTexts();
assert.match(rows[0], /Brindle & Co\s+Matches your receipt\s+£45\.00/, "a matched payment carries its receipt's shop name");
assert.match(rows[1], /Coffee Corner\s+No receipt yet\s+£3\.20/);
assert.match(await view.locator(".rl-arow", { hasText: "Mock Bank" }).innerText(), /Read just now, 1 receipt matched/);
await polished("bank page connected", "#mePage");
console.log("ok - back from the bank: the code finishes it (refused, plainly, when started elsewhere); connected, card payments with the receipt each matches");

// Not mine (a shared card): tap a payment, say it isn't yours (or nothing from that shop is); it says so, and This is mine undoes it.
st.notMines = st.notMines || [];
await page.getByRole("button", { name: /^Coffee Corner, £3\.20/ }).click();
await page.getByRole("button", { name: "Nothing from Coffee Corner is mine" }).waitFor();
await page.getByRole("button", { name: "Not mine", exact: true }).click();
await page.getByRole("button", { name: /^Coffee Corner, £3\.20, .*, not yours$/ }).waitFor();
assert.deepEqual(st.notMines.at(-1), { id: "b", on: true, everyFromShop: false });
await page.getByText("Got it: that one isn't yours.").waitFor();
await page.getByRole("button", { name: /^Coffee Corner, £3\.20, .*, not yours$/ }).click();
await page.getByRole("button", { name: "This is mine" }).click();
await page.getByRole("button", { name: /^Coffee Corner, £3\.20, \d+ \w+$/ }).waitFor();
assert.deepEqual(st.notMines.at(-1), { id: "b", on: false, everyFromShop: false });
await page.getByRole("button", { name: /^Coffee Corner, £3\.20/ }).click();
await page.getByRole("button", { name: "Nothing from Coffee Corner is mine" }).click();
await page.getByText("Got it: nothing from Coffee Corner is yours.").waitFor();
assert.deepEqual(st.notMines.at(-1), { id: "b", on: true, everyFromShop: true });
console.log("ok - Not mine: one payment or a whole shop, said back plainly, undone by This is mine");

// 3b. The receipt says which card paid for it.
await page.evaluate(() => window.go("receipts"));
await page.locator(".rl-rr-main", { hasText: "Brindle & Co" }).first().click().catch(async e => { await page.screenshot({ path: "/tmp/shots/bank-dbg.png" }); throw e; });
await page.locator(".rl-rr-paid", { hasText: /^Paid with Current account on \d{1,2} [A-Z][a-z]{2}$/ }).waitFor();
console.log("ok - a matched receipt says which account paid for it");
// 3c. A try that took too long says so.
await page.goto(origin + "/index.html#bank=expired");
await view.getByText("That took too long, so it didn't connect. Start again and finish within 15 minutes.").waitFor();
await page.evaluate(() => window.go("me"));
await view.locator(".rl-arow", { hasText: "Bank and cards" }).click();
await view.locator(".rl-bk-row").first().waitFor();
// 3d. Real banks (Connor, 17 Nov 2026): the page shows what Relay already has straight away, not after the banks are
// read again (seconds); the usual banks TrueLayer offers are a tap each, less ones connected; a tap opens that bank.
st.live = true; st.choices = ["amex", "santander", "monzo"]; st.syncDelay = 8000;
// Two connections to the same bank are told apart by the cards on each (Relay's label), and one whose last read didn't
// finish says so plainly instead of an old "Read" time passing for up to date.
const realLink = { id: "00000000-0000-4000-8000-0000000000bb", bank: "Santander Personal", label: "Santander Personal, Current account ending 1234", connectedAt: new Date().toISOString(), syncedAt: new Date().toISOString(), needsReconnect: false, payments: 2, matched: 1 };
const realLink2 = { id: "00000000-0000-4000-8000-0000000000cc", bank: "Santander Personal", label: "Santander Personal, Credit card ending 9876", connectedAt: new Date().toISOString(), syncedAt: new Date(Date.now() - 864e5).toISOString(), needsReconnect: false, payments: 0, matched: 0, readProblem: "bank", triedAt: new Date().toISOString() };
st.links = [realLink, realLink2, ...st.links];
await page.goto(origin + "/index.html"); await openProfile();
const opened = Date.now(), syncsBefore = st.syncs;
await view.locator(".rl-arow", { hasText: "Bank and cards" }).click();
await view.locator(".rl-bk-row").first().waitFor();
assert.ok(Date.now() - opened < 4000, "payments show before the banks are read again");
assert.ok(await view.locator(".rl-arow", { hasText: "Santander Personal, Current account ending 1234" }).isVisible());
assert.match(await view.locator(".rl-arow", { hasText: "Credit card ending 9876" }).innerText(), /Couldn't read just now\. Pull down to try again\./);
const bankTiles = view.getByRole("group", { name: "Choose your bank or card" }).getByRole("button");
assert.deepEqual(await bankTiles.evaluateAll(b => b.map(x => x.lastChild.textContent)), ["Amex", "Monzo"], "only banks TrueLayer offers, less the one connected");
assert.ok(await view.getByRole("button", { name: "Another bank or card" }).isVisible());
await polished("bank page with tiles", "#mePage");
assert.equal(st.syncs, syncsBefore + 1, "the banks are still read again, behind");
st.syncDelay = 0;
await bankTiles.filter({ hasText: "Amex" }).dblclick();
await page.waitForURL(/auth\.truelayer-sandbox\.com/);
assert.deepEqual(st.connectBodies.at(-1), { bank: "amex" }); assert.equal(st.connectBodies.filter(b => b && b.bank).length, 1, "once for a double tap");
st.live = false; st.links = st.links.filter(l => l !== realLink && l !== realLink2);
await page.goto(origin + "/index.html"); await openProfile();
await view.locator(".rl-arow", { hasText: "Bank and cards" }).click();
await view.locator(".rl-bk-row").first().waitFor();
console.log("ok - real banks: shown at once while read again behind; the usual banks TrueLayer offers, a tap each, straight to that bank");
// 4. Disconnecting asks first, then deletes.
await view.locator(".rl-arow", { hasText: "Mock Bank" }).click();
await page.getByText("Disconnect Mock Bank? Relay deletes the payments it read from it.").waitFor();
assert.equal(st.disconnects.length, 0, "asks first");
await page.getByRole("button", { name: "Disconnect" }).click();
await view.getByText("Disconnected. The payments read from it are deleted.").waitFor();
assert.deepEqual(st.disconnects, [{ id: "00000000-0000-4000-8000-0000000000aa" }]);
assert.deepEqual(errors, [], "no page errors");
console.log("PASS Bank and cards UI: hidden until offered, clear about read-only, the bank's own page, back with what happened, payments matched to receipts, disconnect asks first (stubbed server)");
await browser.close(); server.close();
