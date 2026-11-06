// Browser test: Swap & resell without a tab of its own. Stubbed Relay server, made-up members, shops and items (ids shaped like
// the server's, so scripts/test-validation.mjs can check every request the app makes here against the server's rules).
// Checks: Discover, Profile and a receipt past its return date lead to it, and there's no Market tab; greyed outlines while
// it loads, never "Loading…"; drawn icons, never emoji; statuses and dates in plain words; asking, accepting and taking
// down happen once for a double tap (taking down asks first); listing an item uses labelled fields; passes the polish rules
// in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const R1 = "11111111-1111-4111-8111-111111111111";
const receipts = [{ id: R1, status: "confirmed", kind: "receipt", gmailId: "m1abcdef", retailer: { name: "Larkspur Home", domain: "larkspur.example" }, orderRef: "LK-1",
  orderDate: day(-60), totalPence: 4000, currency: "GBP", category: "home", categoryLabel: "Home & garden", returnable: true, returns: { deadline: day(-30) },
  items: [{ name: "Ceramic Vase", qty: 1, pricePence: 4000, category: "home" }] }];
const st = { asks: [], accepts: [], withdraws: [], listings: [], feedCalls: 0 };
const FEED = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001", title: "Merino Wool Scarf", store: "Brindle & Co", size: "M", condition: "like_new", askPence: 2500, currency: "GBP", swapOk: true, handover: "either", area: "SW11", note: "Worn once", hasImage: false, myRequest: null },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002", title: "Linen Shirt", store: "Fennel", size: "L", condition: "good", askPence: null, currency: "GBP", swapOk: false, handover: "post", area: null, hasImage: false, myRequest: { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000009", status: "pending" } }];
const MINE = { listings: [{ id: "cccccccc-cccc-4ccc-8ccc-000000000001", title: "Canvas Tote", status: "active", store: "Fennel", condition: "good", askPence: null, currency: "GBP", swapOk: false, handover: "post", hasImage: false,
  requests: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", who: "Member", kind: "buy", status: "pending", message: "Is it still available?" }] }], myRequests: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000009", title: "Linen Shirt", kind: "buy", status: "pending" }] };
const ITEMS = { items: [
  { receiptId: R1, itemIndex: 0, title: "Ceramic Vase", store: "Larkspur Home", pricePence: 4000, currency: "GBP", orderDate: "2026-09-01", returnWindowOpen: false, returnDeadline: "2026-10-01", alreadyListed: false },
  { receiptId: "22222222-2222-4222-8222-222222222222", itemIndex: 0, title: "Brass Lamp", store: "Larkspur Home", pricePence: 6000, currency: "GBP", orderDate: "2026-10-30", returnWindowOpen: true, returnDeadline: "2026-11-20", alreadyListed: false }] };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/") || /\/image$/.test(p)) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  const slow = () => new Promise(ok => setTimeout(ok, 350));
  if (p === "/relay/my/resale/feed") { st.feedCalls++; await slow(); return j({ listings: FEED.filter(l => !(st.reports || []).some(r => r[0] === l.id)) }); }
  if (p === "/relay/my/resale/mine") { await slow(); return j(MINE); }
  if (p === "/relay/my/resale/items") { await slow(); return j(ITEMS); }
  if (p === "/relay/my/resale/listings" && m === "POST") { st.listings.push(JSON.parse(route.request().postData() || "{}")); await slow(); return j({ ok: true, id: "NEW" }); }
  let x = /^\/relay\/my\/resale\/listings\/([0-9a-f-]{36})\/ask$/.exec(p);
  if (x && m === "POST") { st.asks.push([x[1], JSON.parse(route.request().postData() || "{}")]); await slow(); return j({ ok: true }); }
  x = /^\/relay\/my\/resale\/listings\/([0-9a-f-]{36})\/report$/.exec(p);
  if (x && m === "POST") { (st.reports = st.reports || []).push([x[1], JSON.parse(route.request().postData() || "{}")]); await slow(); return j({ ok: true }); }
  x = /^\/relay\/my\/resale\/requests\/([0-9a-f-]{36})\/accept$/.exec(p);
  if (x && m === "POST") { st.accepts.push(x[1]); await slow(); return j({ ok: true }); }
  x = /^\/relay\/my\/resale\/listings\/([0-9a-f-]{36})\/withdraw$/.exec(p);
  if (x && m === "POST") { st.withdraws.push(x[1]); await slow(); return j({ ok: true }); }
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: Date.now() - 600e3 });
  if (p === "/relay/my/receipts") return j({ receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/admin/me") return j({ admin: false });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  if (p === "/relay/catalog" || p.startsWith("/relay/catalog")) return j({ products: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
// The polish rules within one part of the page. A checkbox is tapped through its label, so the label is what's measured.
const measure = scope => page.evaluate(scope => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const flat = (fg, bg) => { const [r, g, b, a = 1] = fg; return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); };
  const out = { small: [], tiny: [], symbols: [], faint: [], wide: [] };
  for (const el of document.querySelectorAll(scope + " button, " + scope + " a, " + scope + " input, " + scope + " select")) {
    if (!vis(el)) continue;
    const target = el.type === "checkbox" ? el.closest("label") || el : el, r = target.getBoundingClientRect();
    if (r.height < 43.5) out.small.push((el.innerText || el.getAttribute("aria-label") || el.placeholder || el.tagName).trim().slice(0, 30) + " " + Math.round(r.height));
    if (/[◎✦↻▶⌂◈▤⇄→✓+×✕]/u.test(el.innerText || "")) out.symbols.push((el.innerText || "").trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll(scope + " *")) {
    if (!vis(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el), px = parseFloat(s.fontSize);
    const caps = s.textTransform === "uppercase" || (/[A-Z]/.test(el.textContent) && el.textContent === el.textContent.toUpperCase());
    if (px < 13 && !(caps && px >= 12)) out.tiny.push(el.textContent.trim().slice(0, 30) + " " + px);
    if (/\p{Extended_Pictographic}/u.test(el.textContent)) out.symbols.push("emoji: " + el.textContent.trim().slice(0, 30));
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
    await page.screenshot({ path: "/tmp/shots/market-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png", fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
await page.goto(origin + "/index.html");
await page.evaluate(e => { localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })); localStorage.setItem("relay-market-area", "SW11"); }, EMAIL);
await page.reload();
assert.deepEqual((await page.locator("#foot button").allInnerTexts()).map(x => x.trim()), ["Home", "Receipts", "Discover", "Profile"], "no Market tab");

// 1. From Discover: outlines first, then what members are selling, nearest first, in plain words with drawn icons.
await page.locator("#foot").getByRole("button", { name: "Discover" }).click();
await page.locator(".profile-row", { hasText: "Swap & resell" }).click();
const sheet = page.locator(".rl-sheet").filter({ has: page.getByRole("heading", { name: "Swap & resell" }) });
await sheet.locator(".rl-mk-skel").first().waitFor();
assert.equal(await sheet.getByText(/Loading/).count(), 0, "no bare 'Loading…'");
await sheet.getByText("Merino Wool Scarf").waitFor();
assert.equal(await sheet.getByRole("button", { name: "Browse" }).getAttribute("aria-pressed"), "true");
const scarf = sheet.locator(".rl-order", { hasText: "Merino Wool Scarf" });
assert.match(await scarf.innerText(), /Merino Wool Scarf\s+£25\.00\s+Brindle & Co, size M\s+Like new\s+Open to swaps\s+Collect in SW11 or post/);
await scarf.getByText("Near you").waitFor();
assert.equal(await scarf.locator(".rl-mk-near svg").count(), 1, "a drawn pin, not an emoji");
assert.match(await sheet.locator(".rl-order", { hasText: "Linen Shirt" }).innerText(), /Open to offers[\s\S]*You asked about this: waiting for the seller\./);
await polished("browse", ".rl-sheet");
await scarf.getByRole("button", { name: "I'd like this" }).dblclick();
await sheet.getByText("Sent. The seller sees your request from “Member”, not your name.").waitFor();
assert.deepEqual(st.asks, [["aaaaaaaa-aaaa-4aaa-8aaa-000000000001", { kind: "buy" }]], "asked once for a double tap");
console.log("ok - Discover leads to Swap & resell: outlines, then listings nearest first, in plain words with drawn icons; asking happens once");

// Reporting a listing: says what happens, needs what's wrong, sends once, and the listing goes from Browse.
const shirt = sheet.locator(".rl-order", { hasText: "Linen Shirt" });
await shirt.getByRole("button", { name: "Report this listing" }).click();
const dlg = page.getByRole("alertdialog");
await dlg.getByText("What's wrong with this listing?", { exact: false }).waitFor();
assert.match(await dlg.innerText(), /Relay's team will look at it\. The seller won't see who reported it\./);
await dlg.getByRole("button", { name: "Send report" }).click();
await sheet.getByText("Say what's wrong, so Relay's team can check it.").waitFor();
assert.equal((st.reports || []).length, 0, "nothing sent without what's wrong");
await shirt.getByRole("button", { name: "Report this listing" }).click();
await dlg.locator("textarea").fill("It's a counterfeit");
await dlg.getByRole("button", { name: "Send report" }).dblclick();
await sheet.getByText("Reported. Relay's team will look at it, and you won't see this listing again.").waitFor();
await page.waitForTimeout(900);
assert.deepEqual(st.reports, [["aaaaaaaa-aaaa-4aaa-8aaa-000000000002", { reason: "It's a counterfeit" }]], "reported once");
assert.equal(await sheet.locator(".rl-order", { hasText: "Linen Shirt" }).count(), 0, "gone from Browse");
await sheet.locator(".rl-order", { hasText: "Merino Wool Scarf" }).waitFor();
await polished("browse after a report", ".rl-sheet");
console.log("ok - a listing can be reported from Browse: what's wrong needed, sent once, then gone from Browse");

// 2. Yours: a request to accept (once), what you asked about, and taking a listing down (asks first).
await sheet.getByRole("button", { name: "Yours" }).click();
const tote = sheet.locator(".rl-order", { hasText: "Canvas Tote" });
await tote.getByText("Member would like to buy").waitFor();
await tote.getByText("“Is it still available?”").waitFor();
await sheet.getByText("You'd like to buy it. Waiting for the seller.").waitFor();
await polished("yours", ".rl-sheet");
await tote.getByRole("button", { name: "Accept" }).dblclick();
await page.waitForTimeout(900);
assert.deepEqual(st.accepts, ["bbbbbbbb-bbbb-4bbb-8bbb-000000000001"], "accepted once for a double tap");
await sheet.locator(".rl-order", { hasText: "Canvas Tote" }).getByRole("button", { name: "Take this down" }).click();
await page.getByRole("alertdialog").getByText("Take Canvas Tote off Relay? Anyone who asked about it is told it's gone.").waitFor();
await page.getByRole("alertdialog").getByRole("button", { name: "Take it down" }).click();
await sheet.getByText("Taken down.").waitFor();
assert.deepEqual(st.withdraws, ["cccccccc-cccc-4ccc-8ccc-000000000001"]);
console.log("ok - Yours: requests accepted once, statuses in words, taking down asks first");

// 3. Sell: human dates, a heads-up while it can still go back, and a form with labelled fields.
await sheet.getByRole("button", { name: "Sell" }).click();
const vase = sheet.locator(".rl-order", { hasText: "Ceramic Vase" });
await vase.waitFor();
assert.match(await vase.innerText(), /Larkspur Home · Paid £40\.00 · 1 Sept? 2026/);
assert.match(await sheet.locator(".rl-order", { hasText: "Brass Lamp" }).innerText(), /You can still return this to the shop for a refund until 20 Nov 2026\./);
await vase.getByRole("button", { name: "List this" }).click();
await vase.getByLabel("Condition", { exact: true }).selectOption("good");
await vase.getByLabel("Size", { exact: true }).fill("One size");
await vase.getByLabel("Asking price in £", { exact: true }).fill("15");
await vase.getByLabel("Handover", { exact: true }).selectOption("post");
assert.equal(await vase.getByLabel("Postcode area for collection", { exact: true }).isVisible(), false, "no collection area when it's posted");
await vase.getByLabel("I'm open to swaps").check();
await vase.getByLabel(/I agree Relay shows this item's name/).check();
await polished("sell", ".rl-sheet");
await vase.getByRole("button", { name: "Put it on Relay" }).dblclick();
await sheet.getByText("Listed. Other members can now see it.").waitFor();
assert.deepEqual(st.listings, [{ receiptId: R1, itemIndex: 0, condition: "good", size: "One size", askPence: 1500, swapOk: true, note: "", agree: true, handover: "post", area: null }], "listed once, with what was chosen");
await page.keyboard.press("Escape").catch(() => {});
await sheet.getByRole("button", { name: "Back", exact: true }).click();
console.log("ok - Sell: plain dates, a heads-up while it can still go back, labelled fields, listed once");

// 4. Profile leads there too, and so does a receipt past its return date.
await page.locator(".avatar").click();
await page.locator("#mePage .rl-arow", { hasText: "Swap & resell" }).click();
await page.getByRole("heading", { name: "Swap & resell" }).waitFor();
await page.locator("#mePage").getByRole("button", { name: "Back", exact: true }).click();
await page.locator("#foot").getByRole("button", { name: "Receipts" }).click();
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
await page.locator("#view").getByText("Home & garden", { exact: true }).click();
const row = page.locator(".rl-rr").filter({ hasText: "Ceramic Vase" });
await row.locator(".rl-rr-main").click();
await row.getByRole("button", { name: "Sell or swap it instead" }).click();
await page.getByRole("heading", { name: "Swap & resell" }).waitFor();
assert.equal(await page.locator(".rl-mk-tabs").getByRole("button", { name: "Sell", exact: true }).getAttribute("aria-pressed"), "true", "opens on Sell, for that item");
await page.locator(".rl-order", { hasText: "Ceramic Vase" }).first().waitFor();
console.log("ok - Profile and a receipt past its return date lead there too");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS swap & resell without a tab (and reporting a listing): Discover, Profile and old receipts lead to it; outlines, words, drawn icons, once per tap, labelled form, polished");
await browser.close(); server.close();
