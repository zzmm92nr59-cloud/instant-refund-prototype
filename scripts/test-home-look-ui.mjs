// Browser test: the sign-in page and Home. Stubbed Relay server, made-up person and invented shops.
// Checks: the sign-in page is Relay's navy in light and dark mode (as the welcome story is), with Relay's name, a small
// wallet picture (hidden from screen readers), a white headline, three equal white buttons and Face ID in lime with its
// icon, all readable; it rises in, except where the phone asks for less motion; the next step (email) is back in the app's
// own colours, and Back from it returns to "Welcome back" when that's where it started. Home: each wallet card counts down
// to its return date with a bar (green, amber in the last week, red in the last three days) and opens its own page, with
// Start return (when the shop has a returns page) and "I'm sending this back"; under the wallet, four colourful tiles (Receipts, Returns &
// swaps, Price alerts with how many things are watched, and Wrapped) each open their page. Every screen passes the polish
// rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const shortDay = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const receipt = (id, shop, item, pence, ago, extra) => ({ id, status: "pending", kind: "receipt", retailer: { name: shop, domain: null }, orderRef: "R-" + id.slice(0, 4), orderDate: day(-ago), totalPence: pence, currency: "GBP",
  category: "fashion", returnable: true, items: [{ name: item, qty: 1, pricePence: pence, category: "fashion" }], returns: null, ...extra });
const receipts = [
  // The shop's own date, 12 days away: plenty of time (green).
  receipt("11111111-1111-4111-8111-111111111111", "Kick Lane", "Court Classic Trainers", 8500, 2, { returns: { deadline: day(12) } }),
  // The shop's own date, 2 days away: urgent.
  receipt("22222222-2222-4222-8222-222222222222", "Glow Lab", "Vitamin C Serum", 2400, 26, { returns: { windowDays: 28, deadline: day(2) } }),
  // Six days left, and the shop has a returns page: Start return is the main button.
  receipt("33333333-3333-4333-8333-333333333333", "Harlow & Co", "Wool Coat", 12000, 24, { returns: { windowDays: 30, deadline: day(6), portalUrl: "https://returns.harlow.example/start" } }),
  // With the item's photo, on its way: the card is headed with the shop's name; the item's name is in Details.
  receipt("44444444-4444-4444-8444-444444444444", "Northfold", "Flow Flared Pant", 6900, 5, { hasImage: true, items: [{ name: "Flow Flared Pant", variant: "UK 8", qty: 1, pricePence: 6900, category: "fashion" }],
    delivery: { status: "shipped", carrier: "Royal Mail", at: day(-3) }, returnBy: { date: day(10), basis: "uk_law", from: "delivery" } }),
];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  if (/^\/relay\/my\/receipts\/[0-9a-f-]{36}\/image$/.test(p)) return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG });
  if (p === "/relay/auth/providers") return j({ google: true, microsoft: true, consent: { version: "v5", text: ["To work, Relay needs to see your receipts."] } });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 6e5 });
  if (p === "/relay/my/receipts") return j({ receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [{ sku: "shopify:fernway.example:101", product: "Linen Notebook", variant: "A5", lastSeenMinor: 1800 }, { sku: "shopify:fernway.example:102", product: "Desk Lamp", variant: "", lastSeenMinor: 4500 }] });
  if (p === "/relay/my/wrapped") return j({ year: new Date().getFullYear(), receipts: 0, years: [], coverage: {} });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
// The polish rules, and readable colours, on whatever is showing in the given part of the page.
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0.5; };
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a")) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
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
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(120);
    assert.deepEqual(await measure(scope), { small: [], tiny: [], symbols: [], faint: [], wide: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/home-look-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
const bgIs = sel => page.locator(sel).first().evaluate(n => getComputedStyle(n).backgroundColor);
const NAVY = "rgb(16, 24, 40)";

// 1. The sign-in page: Relay's navy whatever the phone's setting, the name, a small wallet picture, and the ways in.
await page.emulateMedia({ reducedMotion: "no-preference" });
await page.goto(origin + "/index.html");
await page.locator(".rl-welcome").waitFor();
await page.getByRole("button", { name: "I already have an account" }).click();
const sheet = page.locator(".rl-sheet");
await sheet.getByRole("heading", { name: "Welcome back" }).waitFor();
await page.waitForTimeout(1200); // the page has finished rising in
for (const scheme of ["light", "dark"]) {
  await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(80);
  assert.equal(await bgIs(".rl-sheet"), NAVY, "Relay's navy in " + scheme + " mode, as the welcome story");
  assert.equal(await sheet.getByRole("heading", { name: "Welcome back" }).evaluate(n => getComputedStyle(n).color), "rgb(255, 255, 255)");
}
await page.emulateMedia({ colorScheme: "light" });
assert.equal(await sheet.locator(".rl-wbrand").innerText(), "Relay");
assert.equal(await sheet.locator(".rl-sart").getAttribute("aria-hidden"), "true", "the picture is decoration, hidden from screen readers");
assert.match(await sheet.locator(".rl-sfront").innerText(), /Court Classic Trainers[\s\S]*Kick Lane[\s\S]*12 days left/);
for (const name of ["Continue with Google", "Continue with Microsoft", "Continue with email"]) {
  const b = sheet.getByRole("button", { name }); await b.waitFor();
  assert.deepEqual(await b.evaluate(n => [getComputedStyle(n).backgroundColor, getComputedStyle(n).color]), ["rgb(255, 255, 255)", NAVY], name + ": white, navy words");
}
const face = sheet.getByRole("button", { name: "Sign in with Face ID or a passkey" });
await face.waitFor();
assert.equal(await face.locator("svg").count(), 1, "Face ID has its drawn icon");
assert.equal(await face.evaluate(n => getComputedStyle(n).color), "rgb(199, 245, 103)", "in lime");
assert.equal(await sheet.locator(".rl-jh").evaluate(n => getComputedStyle(n).animationName), "rlup", "the page rises in");
await polished("sign-in page", ".rl-sheet");
// Less motion: nothing moves.
await page.emulateMedia({ reducedMotion: "reduce" });
assert.equal(await sheet.locator(".rl-jh").evaluate(n => getComputedStyle(n).animationName), "none", "no animation where the phone asks for less motion");
// The next step is in the app's own colours; Back returns to the same page ("Welcome back", not "Create your account").
await sheet.getByRole("button", { name: "Continue with email" }).click();
await sheet.getByRole("heading", { name: "Continue with email" }).waitFor();
assert.equal(await sheet.evaluate(n => n.classList.contains("rl-signin")), false);
assert.equal(await bgIs(".rl-sheet"), "rgb(255, 255, 255)", "the email step is the app's own white in light mode");
await sheet.getByRole("button", { name: "Back" }).click();
await sheet.getByRole("heading", { name: "Welcome back" }).waitFor();
assert.equal(await bgIs(".rl-sheet"), NAVY);
await page.waitForTimeout(450); // (a second tap on the same button within 400ms counts as a double tap)
await sheet.getByRole("button", { name: "Back" }).click();
await page.getByRole("button", { name: "Get started" }).click();
await sheet.getByRole("heading", { name: "Create your account" }).waitFor();
await page.waitForTimeout(300);
await polished("sign-in page, new", ".rl-sheet");
console.log("ok - the sign-in page: Relay's navy in light and dark, a wallet picture, white buttons, Face ID in lime, readable; the next step is the app's own colours");

// 2. Home: the wallet's cards count down to each return date.
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: 9e12 })), EMAIL);
await page.goto(origin + "/index.html");
const wallet = page.locator("#walletPage");
await wallet.getByText("Court Classic Trainers").waitFor();
await page.waitForTimeout(500);
const card = name => wallet.locator(".rl-po", { hasText: name });
const due = name => card(name).locator(".rl-due");
assert.match(await due("Court Classic Trainers").innerText(), new RegExp("^Return by " + shortDay(day(12)) + "\\s+12 days left$"));
assert.equal(await due("Court Classic Trainers").getAttribute("class"), "rl-due ok");
const width = name => due(name).locator(".rl-due-bar i").evaluate(n => n.style.width);
assert.equal(await width("Court Classic Trainers"), "14%", "2 days of 14 gone");
assert.match(await due("Vitamin C Serum").innerText(), new RegExp("^Return by " + shortDay(day(2)) + "\\s+2 days left$"));
assert.equal(await due("Vitamin C Serum").getAttribute("class"), "rl-due urgent", "red in the last three days");
assert.equal(await width("Vitamin C Serum"), "93%");
assert.equal(await due("Wool Coat").getAttribute("class"), "rl-due soon", "amber in the last week");
// No buttons on a card: the whole card opens its page, which has what you can do (Start return first when the shop has a
// returns page, then I'm sending this back).
assert.equal(await card("Court Classic Trainers").locator("button").count(), 0, "no buttons on the card itself");
assert.equal(await card("Court Classic Trainers").getAttribute("role"), "button", "the card is the button");
assert.match(await card("Court Classic Trainers").getAttribute("aria-label"), new RegExp("^Court Classic Trainers, Kick Lane, £85\\.00, return by "));
assert.equal(await card("Court Classic Trainers").locator(".rl-po-brand").evaluate(n => getComputedStyle(n).textTransform), "none");
assert.equal(await card("Court Classic Trainers").locator(".rl-po-brand").innerText(), "Court Classic Trainers", "the card leads with what was bought");
assert.equal(await card("Court Classic Trainers").locator(".rl-po-meta").innerText(), "Kick Lane", "with the shop under it");
const dsheet = page.locator(".rl-sheet");
await card("Court Classic Trainers").click();
assert.deepEqual(await dsheet.locator(".rl-dt-acts button").allInnerTexts(), ["I'm sending this back"]);
await dsheet.getByRole("button", { name: "Close" }).click();
await card("Wool Coat").click();
assert.deepEqual(await dsheet.locator(".rl-dt-acts button").allInnerTexts(), ["Start return", "I'm sending this back"]);
assert.equal(await dsheet.getByRole("link", { name: /Start a return with/ }).count(), 0, "one way to start the return, not two");
await dsheet.getByRole("button", { name: "Close" }).click();
// A card with the item's photo: what it is, the shop, the price, and the parcel's news in a plain line.
const nf = card("Northfold");
await nf.locator(".rl-po-img.rl-has-photo img").waitFor();
assert.equal(await nf.locator(".rl-po-brand").innerText(), "Flow Flared Pant");
assert.equal(await nf.locator(".rl-po-meta").innerText(), "Northfold");
assert.equal(await nf.locator(".rl-po-ship").innerText(), "On its way with Royal Mail");
assert.equal(await nf.locator(".rl-po-ship svg").count(), 1, "with a drawn parcel, not a symbol");
assert.equal(await nf.locator(".rl-due").count(), 0, "a date Relay worked out (UK law's minimum) is never shown as a countdown");
await nf.click();
assert.equal(await dsheet.locator(".rl-dt-head h2").innerText(), "Flow Flared Pant", "its page names what was bought");
assert.equal(await dsheet.locator(".rl-dt-sub").innerText(), "Northfold");
assert.match(await dsheet.locator(".rl-dt-facts").innerText(), /Price\s+£69\.00\s+Size or colour\s+UK 8\s+Ordered\s+\d+ \w+ \d{4}\s+Order number\s+R-4444/);
await dsheet.getByText("No return date in Northfold's email", { exact: true }).waitFor();
// (Still on its way, so no date even though the server counted one from a delivery: the screen never contradicts itself.)
await dsheet.getByText("By UK law you have at least 14 days from delivery to change your mind about most online orders. Relay adds the date once it arrives. Northfold may give longer.").waitFor();
assert.ok(!/days? left/.test(await dsheet.innerText()), "no countdown on its page either");
await dsheet.getByRole("button", { name: "Close" }).click();
console.log("ok - wallet cards count down with a bar (green, amber, red), lead with what was bought, and open a page with Start return and I'm sending this back");

// 3. Under the wallet: four colourful tiles, each opening its page; Price alerts says how many things are watched.
const tiles = page.locator(".home-tiles .htile");
await page.locator(".htile", { hasText: "2 watched" }).waitFor();
assert.deepEqual(await tiles.evaluateAll(ns => ns.map(n => n.getAttribute("aria-label") || n.innerText.replace(/\s+/g, " ").trim())),
  ["Receipts", "Returns & swaps", "Price alerts 2 watched", "Your " + new Date().getFullYear() + " Wrapped"]);
assert.deepEqual(await tiles.evaluateAll(ns => ns.map(n => getComputedStyle(n).backgroundColor)),
  [NAVY, "rgb(224, 68, 110)", "rgb(79, 114, 224)", "rgb(199, 245, 103)"], "the welcome story's navy, pink and blue, and Wrapped's lime");
assert.equal(await page.getByRole("button", { name: "All receipts" }).count(), 0, "the tiles replace the old buttons");
assert.equal(await page.locator("#view .profile-row").count(), 0, "and the old Price alerts row");
await polished("home", "#view");
await page.locator(".htile", { hasText: "Receipts" }).click();
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
await page.evaluate(() => window.go("profile")); await page.locator(".htile").first().waitFor();
await page.locator(".htile", { hasText: "Returns & swaps" }).click();
await page.getByRole("heading", { name: "Returns & swaps", exact: true }).waitFor();
await page.evaluate(() => window.go("profile")); await page.locator(".htile").first().waitFor();
await page.locator(".htile", { hasText: "Price alerts" }).click();
await page.getByRole("heading", { name: "Price alerts", exact: true }).waitFor();
await page.evaluate(() => window.go("profile")); await page.locator(".htile").first().waitFor();
await page.getByRole("button", { name: "Your " + new Date().getFullYear() + " Wrapped" }).click();
await page.getByRole("heading", { name: "Profile", exact: true }).waitFor();
assert.equal(await page.evaluate(() => window.page), "me", "Wrapped lives in Profile");
console.log("ok - Home's tiles: Receipts, Returns & swaps, Price alerts (2 watched) and Wrapped, each opening its page");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS the sign-in page and Home: Relay's navy, a wallet picture, return countdowns and colourful tiles (stubbed server)");
await browser.close(); server.close();
