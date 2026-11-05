// Browser test: AI help with receipts (Profile, Email connection). Stubbed Relay server, made-up shops and people.
// Checks: hidden until Relay can offer it (the AI key is set); off to start; the switch says what it means, turns on and off
// once for a double tap, and says plainly what happened (off deletes what the AI read); a receipt the AI filled in says
// which parts were read by AI, for the shopper to check. Passes the polish rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ID1 = "11111111-1111-4111-8111-111111111111";
const st = { available: false, on: false, posts: [] };
const receipts = [{ id: ID1, status: "pending", needsShopperConfirmation: true, kind: "receipt", gmailId: "m1abcdef", retailer: { name: "Brindle & Co", domain: "brindle.example" },
  orderRef: "BR-1", orderDate: day(-5), totalPence: 4500, currency: "GBP", category: "fashion", categoryLabel: "Fashion", returnable: true, returns: null,
  items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 3500, category: "fashion" }], aiFilled: ["total", "items"] }];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  if (p === "/relay/my/ai-reading" && m === "GET") return j({ available: st.available, on: st.available && st.on, since: st.on ? new Date().toISOString() : null });
  if (p === "/relay/my/ai-reading" && m === "POST") {
    const b = JSON.parse(route.request().postData() || "{}"); st.posts.push(b);
    await new Promise(ok => setTimeout(ok, 300));
    st.on = b.on; return j({ available: true, on: st.on, since: st.on ? new Date().toISOString() : null });
  }
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3, maxInboxes: 5 });
  if (p === "/relay/my/receipts") return j({ receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/admin/me") return j({ admin: false });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  if (p === "/relay/my/2fa") return j({ app: false, text: false });
  if (p === "/relay/my/phone") return j({ available: true, ending: null });
  if (p === "/relay/my/card") return j({ enabled: true, testMode: false, card: null });
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
    await page.screenshot({ path: "/tmp/shots/ai-help-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png", fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload();
const view = page.locator("#mePage");
const openMail = async () => {
  await page.evaluate(() => window.go("me"));
  await view.locator(".rl-arow", { hasText: "Email connection" }).click();
  await view.getByText("Relay is reading your", { exact: false }).waitFor();
  await page.waitForTimeout(400);
};

// 1. Until Relay can offer it, it isn't shown.
await openMail();
assert.equal(await view.getByText("AI help with receipts").isVisible(), false, "not shown until the AI key is set");
await view.getByRole("button", { name: /Back to/ }).click();
console.log("ok - hidden until Relay can offer it");

// 2. Once it can: off to start, says what it means, on and off once each, in plain words.
st.available = true;
await openMail();
const sw = view.getByRole("switch", { name: "AI help with receipts" });
await sw.waitFor();
assert.equal(await sw.getAttribute("aria-checked"), "false", "off to start");
const what = await view.locator(".rl-aih").innerText();
for (const s of ["Claude, an AI made by Anthropic", "your name, addresses, links, phone numbers and card numbers hidden", "Anthropic can't train its AI on it", "marked for you to check"])
  assert.ok(what.includes(s), "says: " + s);
await polished("mail", "#mePage .rl-asub");
await sw.dblclick();
await view.getByText("On. Relay will ask the AI about receipts it isn't sure of, a few at a time.").waitFor();
assert.deepEqual(st.posts, [{ on: true }], "on once for a double tap");
assert.equal(await sw.getAttribute("aria-checked"), "true");
await page.waitForTimeout(500);
await sw.click();
await view.getByText("Off. What the AI read has been deleted.").waitFor();
assert.deepEqual(st.posts, [{ on: true }, { on: false }]);
assert.equal(await sw.getAttribute("aria-checked"), "false");
console.log("ok - off to start; says what it means; on and off once each, in plain words");

// 3. A receipt the AI filled in says so, for the shopper to check.
await page.evaluate(() => window.go("receipts"));
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
await page.locator("#view").getByText("Fashion", { exact: true }).click();
const scarf = page.locator(".rl-rr").filter({ hasText: "Merino Wool Scarf" });
await scarf.locator(".rl-rr-main").click();
await scarf.getByText("The total and items were read by AI. Check they're right, and use Fix details if not.").waitFor();
await scarf.getByText("Relay may have missed something. Is this right?").waitFor();
console.log("ok - a receipt the AI filled in says which parts, for the shopper to check");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS AI help UI: hidden until available, off to start, clear about what it means, on and off once, AI-filled parts marked (stubbed server)");
await browser.close(); server.close();
