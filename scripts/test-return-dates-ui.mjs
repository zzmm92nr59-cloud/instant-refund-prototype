// Browser test: return dates for more of what you buy. Stubbed Relay server, made-up account and items.
// Checks: a food order with a kettle in it puts just the kettle in the wallet (and in the strip above the tab bar), and its
// page says the food can't go back but the kettle can; an online order whose email says nothing about returns shows the
// least UK law allows, counted from the order date to be safe, and says so; "30 days to return" with no start date is
// counted from the order date; a worked-out date that has passed isn't shown as "Deadline passed"; a plain food order
// stays out of the wallet. Every new line passes the polish rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const wdDay = d => { const t = new Date(d + "T00:00:00Z"), f = o => t.toLocaleDateString("en-GB", { timeZone: "UTC", ...o }); return f({ weekday: "short" }) + " " + f({ day: "numeric", month: "short" }); };
const est = (date, basis) => ({ date, basis, from: "order", estimate: true });
const receipts = [
  // The weekly shop with a kettle in it: only the kettle can go back.
  { id: "11111111-1111-4111-8111-111111111111", status: "pending", kind: "receipt", retailer: { name: "Tesco", domain: "tesco.com" }, orderRef: "T-1001", orderDate: day(-3),
    totalPence: 2880, currency: "GBP", category: "food", categoryLabel: "Food & drink", returnable: false, notReturnableReason: "Food and drink usually can't be returned.",
    items: [{ name: "Bananas Loose", qty: 1, pricePence: 80, category: "food", categorySure: true }, { name: "Glass Kettle 1.7L", qty: 1, pricePence: 2500, category: "home", categorySure: true, returnable: true },
      { name: "Kitchen Roll 4 Pack", qty: 1, pricePence: 300, category: "home", categorySure: true }],
    returnableItems: [1], returns: null, returnBy: est(day(11), "uk_law") },
  // An online order whose email says nothing about returns.
  { id: "22222222-2222-4222-8222-222222222222", status: "pending", kind: "receipt", retailer: { name: "Kick Lane", domain: "kicklane.example" }, orderRef: "KL-1", orderDate: day(-2),
    totalPence: 8500, currency: "GBP", category: "fashion", categoryLabel: "Fashion", returnable: true, items: [{ name: "Court Classic Trainers", qty: 1, pricePence: 8500, category: "fashion", categorySure: true }],
    returns: null, returnBy: est(day(12), "uk_law") },
  // "30 days to return", without saying from when.
  { id: "33333333-3333-4333-8333-333333333333", status: "pending", kind: "receipt", retailer: { name: "Studio North", domain: "studionorth.example" }, orderRef: "SN-9", orderDate: day(-10),
    totalPence: 4500, currency: "GBP", category: "fashion", categoryLabel: "Fashion", returnable: true, items: [{ name: "Linen Shirt", qty: 1, pricePence: 4500, category: "fashion", categorySure: true }],
    returns: { windowDays: 30, windowFrom: null, deadline: null, instructions: [] }, returnBy: est(day(20), "window") },
  // A worked-out date that has passed (an old copy kept on the phone).
  { id: "44444444-4444-4444-8444-444444444444", status: "pending", kind: "receipt", retailer: { name: "Harlow & Co", domain: "harlow.example" }, orderRef: "H-2", orderDate: day(-30),
    totalPence: 12000, currency: "GBP", category: "fashion", categoryLabel: "Fashion", returnable: true, items: [{ name: "Wool Coat", qty: 1, pricePence: 12000, category: "fashion", categorySure: true }],
    returns: null, returnBy: est(day(-16), "uk_law") },
  // A food order with nothing that goes back.
  { id: "55555555-5555-4555-8555-555555555555", status: "pending", kind: "receipt", retailer: { name: "Tesco", domain: "tesco.com" }, orderRef: "T-1002", orderDate: day(-1),
    totalPence: 260, currency: "GBP", category: "food", categoryLabel: "Food & drink", returnable: false, notReturnableReason: "Food and drink usually can't be returned.",
    items: [{ name: "Semi Skimmed Milk", qty: 1, pricePence: 120, category: "food", categorySure: true }, { name: "Wholemeal Bread", qty: 1, pricePence: 140, category: "food", categorySure: true }], returns: null },
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL });
  if (p === "/relay/my/receipts") return j({ receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
// The polish rules on an open page: nothing tappable under 44px, no text under 13px (12px for capitals), no fixed colours
// that vanish in dark mode (text must stand out from what's behind it).
const measure = () => page.evaluate(() => {
  const vis = n => { const r = n.getBoundingClientRect(), s = getComputedStyle(n); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => (c.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
  const lum = c => { const f = v => (v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); const [r, g, b] = rgb(c); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = n => { for (let e = n; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; const a = rgb(b)[3]; if (b && b !== "transparent" && (a === undefined || a > 0.5)) return b; } return "rgb(255,255,255)"; };
  const out = { small: [], tiny: [], faint: [] };
  for (const n of document.querySelectorAll(".rl-sheet button, .rl-sheet a")) if (vis(n) && n.getBoundingClientRect().height < 43.5) out.small.push((n.innerText || "").trim().slice(0, 30));
  for (const n of document.querySelectorAll(".rl-sheet *")) {
    if (!vis(n) || ![...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim())) continue;
    const s = getComputedStyle(n), px = parseFloat(s.fontSize);
    if (px < 12 || (px < 13 && s.textTransform !== "uppercase")) out.tiny.push(n.textContent.trim().slice(0, 30) + " " + px);
    const a = lum(s.color), b = lum(bgOf(n)), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) * parseFloat(s.opacity || 1);
    if (ratio < 3) out.faint.push(n.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  return out;
});
const polished = async where => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(80);
    assert.deepEqual(await measure(), { small: [], tiny: [], faint: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/return-dates-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload();

// 1. The wallet: the kettle from the weekly shop, the trainers and the shirt; not the food, and not the coat whose date passed.
const wallet = page.locator("#walletPage");
await wallet.getByText("Glass Kettle 1.7L").waitFor();
await page.waitForTimeout(600);
const text = await wallet.innerText();
for (const thing of ["Court Classic Trainers", "Linen Shirt"]) assert.ok(text.includes(thing), thing + " is in the wallet");
for (const thing of ["Bananas", "Kitchen Roll", "Semi Skimmed Milk", "Wool Coat"]) assert.ok(!text.includes(thing), thing + " isn't in the wallet");
assert.match(text, /3 items/);
const kettle = wallet.locator(".rl-po").filter({ hasText: "Glass Kettle 1.7L" });
assert.match(await kettle.innerText(), /1 of 3 in this order/);
assert.match(await kettle.innerText(), /To be safe, return by [\s\S]*11 days left/, "the kettle counts down, and says the date is the safe one: " + await kettle.innerText());
// The strip above the tab bar names the kettle, not the bananas.
const next = page.locator(".rl-next");
await next.waitFor();
assert.match(await next.innerText(), /Glass Kettle 1\.7L[\s\S]*Back to Tesco by/);
console.log("ok - wallet: the kettle from a food order (not the food), the order with no return wording, the '30 days' order; not a passed worked-out date");

// 2. The kettle's page: the food can't go back, the kettle can; the date is counted from the order date, and it says so.
await kettle.getByRole("button", { name: "Details" }).click();
const sheet = page.locator(".rl-sheet");
await sheet.getByText("The food can't go back, but you can usually return the Glass Kettle 1.7L.").waitFor();
assert.equal(await sheet.getByText("Usually can't be returned").count(), 0, "not the blanket 'can't be returned' label");
await sheet.getByText("Return by " + wdDay(day(11)), { exact: true }).waitFor();
await sheet.getByText("To be safe, 14 days from your order. UK law gives at least 14 days from delivery, and Tesco may give longer.").waitFor();
await polished("food order page");
await sheet.getByRole("button", { name: "Close" }).click();

// 3. The trainers: the same safe date, worded the same way.
await wallet.locator(".rl-po").filter({ hasText: "Court Classic Trainers" }).getByRole("button", { name: "Details" }).click();
await sheet.getByText("Return by " + wdDay(day(12)), { exact: true }).waitFor();
await sheet.getByText("To be safe, 14 days from your order. UK law gives at least 14 days from delivery, and Kick Lane may give longer.").waitFor();
await sheet.getByRole("button", { name: "Close" }).click();

// 4. The shirt: "30 days to return", counted from the order date.
await wallet.locator(".rl-po").filter({ hasText: "Linen Shirt" }).getByRole("button", { name: "Details" }).click();
await sheet.getByText("Return by " + wdDay(day(20)), { exact: true }).waitFor();
await sheet.getByText(/^To be safe, 30 days from your order\. .+'s email gives 30 days\.$/).waitFor();
await polished("window order page");
await sheet.getByRole("button", { name: "Close" }).click();
console.log("ok - each page says how its date was worked out: 14 days (UK law) or the email's 30 days, from the order date to be safe");

// 5. Receipts: the coat whose worked-out date passed shows no 'Deadline passed'; the food group shows the kettle order's countdown.
await page.evaluate(() => window.go("receipts"));
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
await page.locator("#view").getByText("Fashion", { exact: true }).click();
const coat = page.locator(".rl-rr").filter({ hasText: "Wool Coat" });
await coat.waitFor();
assert.ok(!/days? left|Deadline passed|Return today/.test(await coat.innerText()), "no countdown for a worked-out date that passed: " + await coat.innerText());
await coat.locator(".rl-rr-main").click();
await page.waitForTimeout(300);
assert.equal(await page.getByText("Deadline passed").count(), 0, "not called passed");
console.log("ok - a worked-out date that has passed isn't shown as 'Deadline passed'");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS return dates: things that go back from food orders, safe dates when the email gives none, said plainly (stubbed server)");
await browser.close(); server.close();
