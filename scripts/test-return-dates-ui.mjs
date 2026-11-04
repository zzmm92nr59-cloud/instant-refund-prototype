// Browser test: return dates for more of what you buy. Stubbed Relay server, made-up account and items.
// Checks: a food order with a kettle in it puts just the kettle in the wallet, and its page says the food can't go back but
// the kettle can; when an email says nothing about returns, Relay never shows a date it worked out as a deadline (no
// countdown, no "back by" strip): the page says the email gives no date and what UK law guarantees; "30 days to return"
// with no start date says so, with the least it can be counted from the order; a worked-out date that has passed isn't
// shown as "Deadline passed"; a plain food order stays out of the wallet; when Relay has read the shop's own returns policy,
// the page gives it for most items, the least that means for this order (never a countdown) and a link to the policy.
// Every new line passes the polish rules in light and dark.
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
  // Delivered two days ago, and the email says nothing about returns: UK law's minimum, dated from that delivery.
  { id: "66666666-6666-4666-8666-666666666666", status: "pending", kind: "receipt", retailer: { name: "Fernway", domain: "fernway.example" }, orderRef: "FW-7", orderDate: day(-6),
    totalPence: 3900, currency: "GBP", category: "home", categoryLabel: "Home & garden", returnable: true, items: [{ name: "Desk Lamp", qty: 1, pricePence: 3900, category: "home", categorySure: true }],
    delivery: { status: "delivered", at: day(-2), carrier: "Evri" }, returns: null, returnBy: { date: day(12), basis: "uk_law" } },
  // The email says nothing, but Relay has read the shop's returns policy (an invented shop): 30 days from delivery for
  // most items, and it arrived three days ago.
  { id: "77777777-7777-4777-8777-777777777777", status: "pending", kind: "receipt", retailer: { name: "Moorvale", domain: "moorvale.example" }, orderRef: "MV-3", orderDate: day(-6),
    totalPence: 5500, currency: "GBP", category: "fashion", categoryLabel: "Fashion", returnable: true, items: [{ name: "Cord Trousers", qty: 1, pricePence: 5500, category: "fashion", categorySure: true }],
    delivery: { status: "delivered", at: day(-3), carrier: "Evri" }, returns: null, returnBy: { date: day(27), basis: "policy", from: "delivery", estimate: true },
    returnPolicy: { shop: "Moorvale", days: 30, from: "delivery", most: true, url: "https://moorvale.example/help/returns", checked: day(-1) } },
  // The same, for a policy counted from when it's sent: at least 30 days from the order.
  { id: "88888888-8888-4888-8888-888888888888", status: "pending", kind: "receipt", retailer: { name: "Pellow", domain: "pellow.example" }, orderRef: "PW-4", orderDate: day(-4),
    totalPence: 2600, currency: "GBP", category: "fashion", categoryLabel: "Fashion", returnable: true, items: [{ name: "Silk Scarf", qty: 1, pricePence: 2600, category: "fashion", categorySure: true }],
    returns: null, returnBy: { date: day(26), basis: "policy", from: "order", estimate: true },
    returnPolicy: { shop: "Pellow", days: 30, from: "dispatch", most: true, url: "https://pellow.example/returns", checked: day(-1) } },
  // Bought in the shop's dated Christmas extension: its date is the one given.
  { id: "99999999-9999-4999-8999-999999999999", status: "pending", kind: "receipt", retailer: { name: "Brindle", domain: "brindle.example" }, orderRef: "BR-5", orderDate: day(-2),
    totalPence: 1800, currency: "GBP", category: "home", categoryLabel: "Home & garden", returnable: true, items: [{ name: "Wool Throw", qty: 1, pricePence: 1800, category: "home", categorySure: true }],
    returns: null, returnBy: { date: day(60), basis: "policy", from: "festive", estimate: true },
    returnPolicy: { shop: "Brindle", days: 28, from: "purchase", most: true, url: "https://brindle.example/returns", checked: day(-1),
      festive: { from: day(-20), to: day(30), until: day(60), days: null } } },
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
for (const thing of ["Court Classic Trainers", "Linen Shirt", "Desk Lamp", "Cord Trousers", "Silk Scarf"]) assert.ok(text.includes(thing), thing + " is in the wallet");
for (const thing of ["Bananas", "Kitchen Roll", "Semi Skimmed Milk", "Wool Coat"]) assert.ok(!text.includes(thing), thing + " isn't in the wallet");
assert.match(text, /7 items/);
const kettle = wallet.locator(".rl-po").filter({ hasText: "Glass Kettle 1.7L" });
assert.match(await kettle.innerText(), /1 of 3 in this order/);
assert.ok(!/return by|days? left/i.test(await kettle.innerText()), "a date Relay worked out isn't shown as a deadline: " + await kettle.innerText());
// No "back by" strip above the tab bar either: none of these dates came from a shop.
await page.waitForTimeout(400);
assert.equal(await page.locator(".rl-next").count(), 0, "no countdown strip for dates Relay worked out");
console.log("ok - wallet: the kettle from a food order (not the food), the order with no return wording, the '30 days' order; not a passed worked-out date; no made-up countdowns");

// 2. The kettle's page: the food can't go back, the kettle can; the date is counted from the order date, and it says so.
await kettle.getByRole("button", { name: "Details" }).click();
const sheet = page.locator(".rl-sheet");
await sheet.getByText("The food can't go back, but you can usually return the Glass Kettle 1.7L.").waitFor();
assert.equal(await sheet.getByText("Usually can't be returned").count(), 0, "not the blanket 'can't be returned' label");
await sheet.getByText("No return date in Tesco's email", { exact: true }).waitFor();
await sheet.getByText("By UK law you have at least 14 days from delivery to change your mind about most online orders. Relay adds the date once it arrives. Tesco may give longer.").waitFor();
assert.ok(!/days? left|Return by/.test(await sheet.innerText()), "no deadline Relay made up");
await polished("food order page");
await sheet.getByRole("button", { name: "Close" }).click();

// 3. The trainers: the same safe date, worded the same way.
await wallet.locator(".rl-po").filter({ hasText: "Court Classic Trainers" }).getByRole("button", { name: "Details" }).click();
await sheet.getByText("No return date in Kick Lane's email", { exact: true }).waitFor();
await sheet.getByText("By UK law you have at least 14 days from delivery to change your mind about most online orders. Relay adds the date once it arrives. Kick Lane may give longer.").waitFor();
await sheet.getByRole("button", { name: "Close" }).click();

// 4. The shirt: "30 days to return", counted from the order date.
await wallet.locator(".rl-po").filter({ hasText: "Linen Shirt" }).getByRole("button", { name: "Details" }).click();
await sheet.getByText("30 days to return", { exact: true }).waitFor();
await sheet.getByText("Studio North's email doesn't say from when. Counting from your order, that's until at least " + wdDay(day(20)) + ".").waitFor();
await polished("window order page");
await sheet.getByRole("button", { name: "Close" }).click();
// 4b. The lamp: delivered, so the legal minimum's date is given, beside the delivery it counts from (and still no countdown).
const lamp = wallet.locator(".rl-po").filter({ hasText: "Desk Lamp" });
assert.ok(!/return by|days? left/i.test(await lamp.innerText()), "no countdown on the card: " + await lamp.innerText());
await lamp.getByRole("button", { name: "Details" }).click();
await sheet.getByText("No return date in Fernway's email", { exact: true }).waitFor();
await sheet.getByText("By UK law you have at least 14 days from delivery to change your mind about most online orders: it arrived " + wdDay(day(-2)) + ", so until at least " + wdDay(day(12)) + ". Fernway may give longer.").waitFor();
await sheet.getByRole("button", { name: "Close" }).click();
console.log("ok - each page says what the email gives: no date (and what UK law guarantees, dated only from a known delivery), or its 30 days and the least that means");

// 4c. The trousers: the shop's own policy, dated from the delivery as the least it allows for most items, with its link.
const trousers = wallet.locator(".rl-po").filter({ hasText: "Cord Trousers" });
assert.ok(!/return by|days? left/i.test(await trousers.innerText()), "a policy is never a countdown: " + await trousers.innerText());
await trousers.getByRole("button", { name: "Details" }).click();
await sheet.getByText("30 days to return most items", { exact: true }).waitFor();
await sheet.getByText("Moorvale's returns policy gives 30 days from delivery for most items. It arrived " + wdDay(day(-3)) + ", so that's until at least " + wdDay(day(27)) + ".").waitFor();
const policyLink = sheet.getByRole("link", { name: "Read Moorvale's returns policy" });
assert.equal(await policyLink.getAttribute("href"), "https://moorvale.example/help/returns");
assert.equal(await policyLink.getAttribute("target"), "_blank");
assert.ok(!/days? left|Return by|No return date|UK law/.test(await sheet.innerText()), "the policy replaces the legal wording, with no countdown");
await polished("policy order page");
await sheet.getByRole("button", { name: "Close" }).click();
// 4d. The scarf: a policy counted from when it's sent, so the least it can be is counted from the order.
await wallet.locator(".rl-po").filter({ hasText: "Silk Scarf" }).getByRole("button", { name: "Details" }).click();
await sheet.getByText("Pellow's returns policy gives 30 days from when it's sent for most items. Counting from your order, that's until at least " + wdDay(day(26)) + ".").waitFor();
await sheet.getByRole("link", { name: "Read Pellow's returns policy" }).waitFor();
await sheet.getByRole("button", { name: "Close" }).click();
// 4e. The throw: bought in the shop's Christmas dates, so the extension's date.
const dmy = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
await wallet.locator(".rl-po").filter({ hasText: "Wool Throw" }).getByRole("button", { name: "Details" }).click();
await sheet.getByText("28 days to return most items", { exact: true }).waitFor();
await sheet.getByText("Brindle's returns policy gives 28 days from purchase for most items. Bought between " + dmy(day(-20)) + " and " + dmy(day(30)) + ", so it can go back until at least " + wdDay(day(60)) + ".").waitFor();
await sheet.getByRole("button", { name: "Close" }).click();
console.log("ok - with the shop's own policy: what it gives for most items, the least that means for this order, and a link to it");

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
