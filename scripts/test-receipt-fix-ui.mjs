// Browser test: "Fix this receipt". Stubbed Relay server, made-up shops and items.
// Checks: a receipt's details offer "Fix details"; the sheet shows the shop, total, date and items as read; plain-English
// messages for a total that isn't money and for nothing changed; only what changed is sent, once for a double tap; the
// row then shows the shopper's words and says what was corrected; "Go back to what Relay read" undoes it; "Is this
// right?", No, "Some details are wrong" opens the same sheet. The sheet passes the polish rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ID1 = "11111111-1111-4111-8111-111111111111", ID2 = "22222222-2222-4222-8222-222222222222";
const read = {
  [ID1]: { id: ID1, status: "confirmed", kind: "receipt", retailer: { name: "Payments Ltd", domain: "brindle.example" }, orderRef: "BR-1", orderDate: day(-5), totalPence: null, currency: "GBP",
    category: "fashion", categoryLabel: "Fashion", returnable: true, returns: null,
    items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 4500, category: "fashion" }, { name: "Gift wrap service", qty: 1, pricePence: 0, category: "fashion" }] },
  [ID2]: { id: ID2, status: "pending", needsShopperConfirmation: true, kind: "receipt", retailer: { name: "Larkspur Home", domain: "larkspur.example" }, orderRef: "LK-2", orderDate: day(-3),
    totalPence: 6000, currency: "GBP", category: "fashion", categoryLabel: "Fashion", returnable: true, returns: null, items: [{ name: "Linen Shirt", qty: 1, pricePence: 6000, category: "fashion" }] }
};
const fixes = {}, posts = [];
const shown = () => Object.values(read).map(x => {
  const f = fixes[x.id]; if (!f) return x;
  const c = { ...x, fixed: {} };
  if (f.shop) { c.retailer = { ...x.retailer, name: f.shop }; c.fixed.shop = true; }
  if (f.totalPence != null) { c.totalPence = f.totalPence; c.fixed.total = true; }
  if (f.orderDate) { c.orderDate = f.orderDate; c.fixed.date = true; }
  if (f.items) { c.items = f.items.map(i => ({ ...i, category: "fashion" })); c.fixed.items = true; }
  return c;
});
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const asks = [], REPLY = "Relay read the total as £60.00. If that's wrong, tap Fix details on the receipt and change it.";
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  const f = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/fix$/.exec(p);
  if (f && m === "POST") {
    const b = JSON.parse(route.request().postData() || "{}"); posts.push([f[1], b]);
    await new Promise(ok => setTimeout(ok, 350));
    if (b.undo) delete fixes[f[1]]; else fixes[f[1]] = { ...(fixes[f[1]] || {}), ...b };
    return j({ ok: true, fixed: fixes[f[1]] || null });
  }
  // The help chat (Ask the assistant on a receipt).
  if (p === "/relay/my/help/chat" && m === "GET") return j({ available: true, handoff: true });
  if (p === "/relay/my/help/chat" && m === "POST") { asks.push(JSON.parse(route.request().postData() || "{}")); await new Promise(ok => setTimeout(ok, 300)); return j({ reply: REPLY }); }
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL });
  if (p === "/relay/my/receipts") return j({ receipts: shown() });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
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
    await page.screenshot({ path: "/tmp/shots/fix-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload();
await page.evaluate(() => window.go("receipts"));
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
await page.locator("#view").getByText("Fashion", { exact: true }).click();

// 1. The scarf was read wrong: open its details and fix it.
const scarf = page.locator(".rl-rr").filter({ hasText: "Merino Wool Scarf" });
await scarf.locator(".rl-rr-main").click();
await scarf.getByText("Something read wrong?").waitFor();
await scarf.getByRole("button", { name: "Fix details" }).click();
const sheet = page.getByRole("dialog", { name: "Fix this receipt" });
await sheet.waitFor();
assert.equal(await sheet.getByRole("textbox").first().inputValue(), "Payments Ltd", "the shop as Relay read it");
assert.equal(await sheet.getByLabel("Total in pounds").inputValue(), "", "no total was found");
assert.equal(await sheet.getByLabel("Item 1", { exact: true }).inputValue(), "Merino Wool Scarf");
assert.equal(await sheet.getByLabel("Price of item 2").inputValue(), "0.00");
await polished("sheet", ".rl-fix");
await sheet.getByRole("button", { name: "Save" }).click();
await sheet.getByText("Nothing has changed yet.").waitFor();
await sheet.getByLabel("Total in pounds").fill("forty five");
await sheet.getByRole("button", { name: "Save" }).click();
await sheet.getByText("Type the total like 12.99.").waitFor();
assert.equal(posts.length, 0, "nothing sent while what's typed isn't right");
await sheet.getByRole("textbox").first().fill("Brindle & Co");
await sheet.getByLabel("Total in pounds").fill("£45");
await sheet.getByRole("button", { name: "Remove item 2" }).click();
assert.equal(await sheet.getByLabel("Item 2", { exact: true }).count(), 0);
await sheet.getByRole("button", { name: "Save" }).dblclick();
await sheet.waitFor({ state: "detached" });
await page.waitForTimeout(500);
assert.deepEqual(posts, [[ID1, { shop: "Brindle & Co", totalPence: 4500, items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 4500 }] }]], "only what changed, once for a double tap");
const fixedRow = page.locator(".rl-rr").filter({ hasText: "Merino Wool Scarf" });
await fixedRow.getByText("You corrected the shop, total and items.").waitFor();
assert.match(await fixedRow.locator(".rl-rr-main").innerText(), /Brindle & Co[\s\S]*£45\.00/, "the row shows the shopper's words");
console.log("ok - Fix details: what was read, plain-English checks, only the changes sent once, the row shows the fix");

// 2. Undo.
await fixedRow.getByRole("button", { name: "Change" }).click();
await sheet.getByRole("button", { name: "Go back to what Relay read" }).click();
await sheet.waitFor({ state: "detached" });
assert.deepEqual(posts[1], [ID1, { undo: true }]);
await page.locator(".rl-rr").filter({ hasText: "Merino Wool Scarf" }).getByText("Something read wrong?").waitFor();
console.log("ok - 'Go back to what Relay read' undoes it");

// 3. "Is this right?" No, "Some details are wrong" opens the same sheet.
const shirt = page.locator(".rl-rr").filter({ hasText: "Linen Shirt" });
await shirt.locator(".rl-rr-main").click();
await shirt.getByText("Relay may have missed something. Is this right?").waitFor();
await shirt.getByRole("button", { name: "No", exact: true }).click();
await page.getByRole("button", { name: "Some details are wrong" }).click();
await sheet.waitFor();
assert.equal(await sheet.getByRole("textbox").first().inputValue(), "Larkspur Home");
await sheet.getByRole("button", { name: "Cancel" }).click();
await sheet.waitFor({ state: "detached" });
assert.equal(posts.length, 2, "Cancel sends nothing");
// 3. Questions about a receipt: the assistant is shown it only once the shopper says so, then with each question, until
// they stop showing it.
await page.evaluate(() => window.go("receipts"));
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
await page.waitForTimeout(400);
// (The Fashion group may still be open from before.)
if (!(await page.locator(".rl-rr").filter({ hasText: "Linen Shirt" }).count())) await page.locator("#view").getByText("Fashion", { exact: true }).click();
const askShirt = page.locator(".rl-rr").filter({ hasText: "Linen Shirt" });
// (Its details may still be open from before: a tap would close them.)
if (!(await askShirt.locator(".rl-rc-fix").count())) await askShirt.locator(".rl-rr-main").click();
await askShirt.getByText("Questions about it?").waitFor();
await polished("receipt details with Ask the assistant", ".rl-rc-fix");
await askShirt.getByRole("button", { name: "Ask the assistant" }).click();
await page.getByText("Show this receipt to Relay's assistant? It sees what Relay read from it (the shop, date, total, items and return date), not the email itself.").waitFor();
assert.equal(asks.length, 0, "nothing is sent before they say so");
await page.getByRole("button", { name: "Show it" }).click();
const chat = page.locator("#mePage .rl-asub");
await chat.getByText("About your receipt from Larkspur Home", { exact: false }).waitFor();
await chat.getByText("I can see what Relay read from this receipt. What would you like to know?", { exact: false }).waitFor();
await chat.getByText("Your messages, and what Relay read from this receipt, go to Anthropic", { exact: false }).waitFor();
await chat.getByRole("button", { name: "The total is wrong" }).click();
await chat.getByText(REPLY).waitFor();
assert.deepEqual(asks[0], { messages: [{ role: "user", text: "The total is wrong" }], receiptId: ID2 });
await polished("chat about a receipt", "#mePage .rl-asub");
await chat.getByRole("button", { name: "Stop showing it" }).click();
await chat.getByText("The assistant can't see the receipt any more.").waitFor();
assert.equal(await chat.getByText("About your receipt from", { exact: false }).count(), 0);
await chat.getByRole("textbox", { name: "Your question for Relay's assistant" }).fill("Thanks, how do I mark it as a gift?");
await chat.getByRole("button", { name: "Send", exact: true }).click();
await page.waitForFunction(() => document.querySelectorAll(".rl-chat-b.bot").length >= 3);
assert.equal(asks.length, 2); assert.equal(asks[1].receiptId, undefined, "once they stop showing it, it isn't sent");
console.log("ok - Ask the assistant: shown the receipt only after Show it, with each question until Stop showing it");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS fix this receipt UI: from the details or 'Is this right?', checks in plain English, changes only, once, undo (stubbed server)");
await browser.close(); server.close();
