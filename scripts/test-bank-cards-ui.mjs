// Browser test: "Which of these are yours?" on Bank and cards (Profile). Stubbed Relay server; bank, cards and shops made up.
// Checks: a bank that lists more than one card asks right on the page, before any payment shows, with each card by its name
// and last four digits, none ticked; Save sends exactly the ticks (once for a double tap) and the page then shows the
// payments; nothing ticked says "None of these are mine"; a refused save says so plainly; it can be changed later from the
// bank's row (its own page, whose Back returns to Bank and cards); Amex payments sent together say so. Passes the polish
// rules at phone size, and in big text. Screenshots: RELAY_SHOTS (or /tmp/shots).
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const SHOTS = process.env.RELAY_SHOTS || "/tmp/shots"; await mkdir(SHOTS, { recursive: true });
const EMAIL = "ava.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const CONN = "00000000-0000-4000-8000-0000000000aa";
const REF1 = "11111111-1111-4111-8111-111111111111", REF2 = "22222222-2222-4222-8222-222222222222";
const st = { mine: { [REF1]: null, [REF2]: null }, posts: [], refuse: false, unsplit: false };
const conn = () => {
  const cards = [{ ref: REF1, label: "Amex Gold ending 1004", mine: st.mine[REF1] }, { ref: REF2, label: "Amex Gold ending 2009", mine: st.mine[REF2] }];
  return { id: CONN, bank: "American Express", connectedAt: new Date().toISOString(), syncedAt: new Date().toISOString(), needsReconnect: false,
    payments: st.mine[REF1] ? 1 : 0, matched: 0, cards, ...(cards.some(c => c.mine == null) ? { needsChoice: true } : {}), ...(st.unsplit ? { unsplit: true } : {}) };
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  if (p === "/relay/my/bank") return j({ available: true, testBanks: false, choices: ["amex", "monzo"], connections: [conn()] });
  if (p === "/relay/my/bank/sync") return j({ read: 0, gone: 0, matched: 0 });
  if (p === "/relay/my/bank/cards") {
    const b = JSON.parse(route.request().postData()); st.posts.push(b);
    await new Promise(r => setTimeout(r, 300));
    if (st.refuse) return j({ error: "invalid_request" }, 400);
    for (const c of b.cards) st.mine[c.ref] = c.mine;
    return j({ ok: true, connection: conn() });
  }
  // Payments only from a card that's hers (the server's rule); none before she says.
  if (p === "/relay/my/bank/payments") return j({ payments: st.mine[REF1] ? [{ id: CONN + ":m1", account: "Amex Gold ending 1004", date: day(-3), amountPence: 4500, currency: "GBP", description: "BRINDLE AND CO LONDON", merchant: null, shop: "Brindle and Co", receiptId: null, match: null }] : [] });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5 });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Ava Tester", photo: null });
  if (p === "/relay/my/admin/me") return j({ admin: false, tester: true });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
// The same polish checks as the bank page's own test: 44px targets, no tiny text, no symbol icons, readable, no sideways scroll.
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; };
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
  await page.waitForTimeout(150);
  assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, where);
  await page.screenshot({ path: SHOTS + "/cards-" + where.replace(/\W+/g, "-") + ".png" });
};
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload();
const view = page.locator("#mePage");
const openBank = async () => {
  await page.evaluate(() => window.go("me"));
  const row = view.locator(".rl-arow", { hasText: "Bank and cards" }); await row.waitFor();
  await page.waitForFunction(() => /Choose which cards are yours|American Express/.test(document.querySelector("#mePage").innerText));
  return row;
};

// 1. Two cards: asked right on the page, none ticked, no payments shown yet. Profile's row says so too.
let row = await openBank();
assert.match(await row.innerText(), /Choose which cards are yours/);
await row.click();
const pick = view.locator(".rl-bk-pick");
await pick.getByText("Which of these are yours?").waitFor();
const boxes = pick.getByRole("checkbox");
assert.deepEqual(await boxes.allInnerTexts(), ["Amex Gold ending 1004", "Amex Gold ending 2009"]);
assert.deepEqual(await boxes.evaluateAll(b => b.map(x => x.getAttribute("aria-checked"))), ["false", "false"], "none ticked");
assert.equal(await view.locator(".rl-bk-row").count(), 0, "no payments before she says");
assert.match(await view.locator(".rl-arow", { hasText: "American Express" }).innerText(), /Choose which cards are yours/);
assert.ok(await pick.getByRole("button", { name: "None of these are mine" }).isVisible(), "nothing ticked: says so");
await polished("asked", "#mePage");

// 2. A refused save says so plainly, and nothing is lost.
await boxes.first().click();
assert.equal(await boxes.first().getAttribute("aria-checked"), "true");
st.refuse = true;
await pick.getByRole("button", { name: "Save" }).click();
await pick.getByText("Couldn't save that. Try again in a moment.").waitFor();
assert.equal(await boxes.first().getAttribute("aria-checked"), "true", "ticks kept");
await polished("save failed", "#mePage");
st.refuse = false;

// 3. Save (a double tap sends once): exactly her ticks; the question goes and her card's payments show.
st.posts = [];
await pick.getByRole("button", { name: "Save" }).dblclick();
await view.getByText("Saved. Relay reads payments only from your cards.").waitFor();
assert.equal(st.posts.length, 1, "once for a double tap");
assert.deepEqual(st.posts[0], { id: CONN, cards: [{ ref: REF1, mine: true }, { ref: REF2, mine: false }] });
await view.locator(".rl-bk-row", { hasText: "Brindle and Co" }).waitFor();
assert.equal(await view.locator(".rl-bk-pick").count(), 0, "not asked again");
assert.match(await view.locator(".rl-arow", { hasText: "American Express" }).innerText(), /1 card is yours/);
await polished("saved", "#mePage");

// 4. Changed later from the bank's row: its own page, ticks as she left them; Back returns to Bank and cards.
await view.locator(".rl-arow", { hasText: "American Express" }).click();
await page.getByRole("button", { name: "Choose your cards" }).click();
await view.locator(".rl-abar-t", { hasText: "Your cards" }).waitFor();
const boxes2 = view.getByRole("checkbox");
assert.deepEqual(await boxes2.evaluateAll(b => b.map(x => x.getAttribute("aria-checked"))), ["true", "false"]);
assert.ok(await view.locator("[data-back]", { hasText: "Bank and cards" }).isVisible(), "Back names Bank and cards");
await polished("change later", "#mePage");
await boxes2.nth(1).click();
await view.getByRole("button", { name: "Save" }).click();
await view.locator(".rl-abar-t", { hasText: "Bank and cards" }).waitFor();
await page.waitForFunction(() => /2 cards are yours/.test(document.querySelector("#mePage").innerText));
assert.deepEqual(st.posts.at(-1).cards.map(c => c.mine), [true, true]);
assert.match(await view.locator(".rl-arow", { hasText: "American Express" }).innerText(), /2 cards are yours/);
// And Back from the page without saving returns to Bank and cards too.
await view.locator(".rl-arow", { hasText: "American Express" }).click();
await page.getByRole("button", { name: "Choose your cards" }).click();
await view.locator("[data-back]", { hasText: "Bank and cards" }).click();
await view.locator(".rl-arow", { hasText: "American Express" }).waitFor();

// 5. Amex sends every card's payments together: said once, plainly.
st.unsplit = true;
row = await openBank(); await row.click();
await view.getByText("American Express sends the payments of every card on your account together", { exact: false }).waitFor();

// 6. Bigger phone text: still fits, nothing cut off sideways.
st.mine = { [REF1]: null, [REF2]: null }; st.unsplit = false;
await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; document.body.style.zoom = "1.3"; });
row = await openBank(); await row.click();
await view.locator(".rl-bk-pick").waitFor();
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no sideways scroll in big text");
await page.screenshot({ path: SHOTS + "/cards-big-text.png" });
assert.deepEqual(errors, [], "no page errors");
console.log("PASS which cards are yours (app): asked on the page before payments, exact ticks saved once, plain errors, changed later on its own page, Amex said plainly (stubbed server)");
await browser.close(); server.close();
