// Browser test: tagging receipts as gifts. Stubbed Relay server, made-up account and shops; the Wrapped it serves is built
// by the real worker/wrapped.js from the same receipts, so the story shows what the server would really send.
// Checks: a receipt's details have a "Bought as a gift" switch (a double tap saves once), then an optional "who's it for";
// the row says who it's for and gets a small present on its picture; Gifts in Receipts' filter (a drawn present) gathers them on a lime page, with
// a filter for each person and a search that finds them by name; untagging works; Wrapped's cover counts gifts and the
// story has a gifts slide (and the biggest treat isn't a gift). Every new part passes the polish rules in light and dark.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, openReceiptKind } from "./relay-places.mjs";
// Receipts' filter sheet: the Gifts row, with how many.
const giftsRow = async (page, count) => {
  await page.locator("#view .rl-calm-filter").first().click();
  const row = page.locator(".rl-sheet[aria-label='Filter receipts'] .rl-arow").filter({ has: page.getByText("Gifts", { exact: true }) }).first();
  await row.getByText(count, { exact: true }).waitFor();
  return row;
};
import { buildWrapped } from "../worker/wrapped.js";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@example.com", today = new Date().toISOString().slice(0, 10), Y = today.slice(0, 4);
const r = (id, shop, domain, ref, cat, label, total, items, extra = {}) => ({ id, status: "confirmed", kind: "receipt", retailer: { name: shop, domain }, orderRef: ref, orderDate: today,
  totalPence: total, currency: "GBP", category: cat, categoryLabel: label, returnable: cat !== "food", items: items.map(([name, p]) => ({ name, qty: 1, pricePence: p, category: cat, categorySure: true })), returns: null, ...extra });
const ID = { scarf: "11111111-1111-4111-8111-111111111111", vase: "22222222-2222-4222-8222-222222222222", lamp: "33333333-3333-4333-8333-333333333333",
  coat: "44444444-4444-4444-8444-444444444444", food: "55555555-5555-4555-8555-555555555555" };
const receipts = [
  r(ID.scarf, "Brindle & Co", "brindle.example", "BR-100", "fashion", "Fashion", 4500, [["Merino Wool Scarf", 4500]]),
  r(ID.vase, "Larkspur Home", "larkspur.example", "LK-200", "home", "Home & garden", 32000, [["Hand-thrown Ceramic Vase", 32000]]),
  r(ID.lamp, "Larkspur Home", "larkspur.example", "LK-300", "home", "Home & garden", 6000, [["Brass Table Lamp", 6000]]),
  r(ID.coat, "Brindle & Co", "brindle.example", "BR-101", "fashion", "Fashion", 18000, [["Waxed Cotton Jacket", 18000]]),
  r(ID.food, "Fennel Kitchen", "fennel.example", "FK-9", "food", "Food & drink", 2350, [["Sourdough loaf", 450], ["Oat milk", 1900]], { notReturnableReason: "Food and drink usually can't be returned." })
];
const gifts = { [ID.scarf]: { for: "Mum" }, [ID.lamp]: { for: "Dad" } }, posts = [];
const withGifts = () => receipts.map(x => gifts[x.id] ? { ...x, gift: gifts[x.id] } : x);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await skipInterests(ctx);
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
  const g = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/gift$/.exec(p);
  if (g && m === "POST") {
    const b = JSON.parse(route.request().postData() || "{}"); posts.push([g[1], b]);
    await new Promise(ok => setTimeout(ok, 350)); // long enough for a second tap to land while it's saving
    if (b.gift) gifts[g[1]] = { for: b.for || null }; else delete gifts[g[1]];
    return j({ ok: true, gift: b.gift ? { for: b.for || null } : null });
  }
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL });
  if (p === "/relay/my/receipts") return j({ receipts: withGifts() });
  if (p === "/relay/my/wrapped") return j(buildWrapped(withGifts(), u.searchParams.get("year"), Date.now()));
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Jess Tester", photo: null });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, watches: [], stores: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
// The polish rules inside one part of the page: nothing tappable under 44px, no text under 13px (12px for capitals), and
// text that stands out from what's behind it (so nothing vanishes in dark mode).
const measure = (root) => page.evaluate((root) => {
  const vis = n => { const r = n.getBoundingClientRect(), s = getComputedStyle(n); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const rgb = c => (c.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
  const lum = c => { const f = v => (v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); const [r, g, b] = rgb(c); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = n => { for (let e = n; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; const a = rgb(b)[3]; if (b && b !== "transparent" && (a === undefined || a > 0.5)) return b; } return getComputedStyle(document.body).backgroundColor || "rgb(255,255,255)"; };
  const out = { small: [], tiny: [], faint: [] };
  for (const n of document.querySelectorAll(root + " button, " + root + " a, " + root + " input")) if (vis(n) && n.getBoundingClientRect().height < 43.5) out.small.push((n.innerText || n.placeholder || n.className || "").trim().slice(0, 30));
  for (const n of document.querySelectorAll(root + ", " + root + " *")) {
    if (!vis(n) || ![...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim())) continue;
    const s = getComputedStyle(n), px = parseFloat(s.fontSize);
    if (px < 12 || (px < 13 && s.textTransform !== "uppercase" && n.textContent.trim() !== n.textContent.trim().toUpperCase())) out.tiny.push(n.textContent.trim().slice(0, 30) + " " + px);
    const a = lum(s.color), b = lum(bgOf(n)), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) * parseFloat(s.opacity || 1);
    if (ratio < 3) out.faint.push(n.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
  }
  return out;
}, root);
const polished = async (root, where) => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(120);
    assert.deepEqual(await measure(root), { small: [], tiny: [], faint: [] }, where + " (" + scheme + ")");
    await page.screenshot({ path: "/tmp/shots/gifts-" + where.replace(/\W+/g, "-") + "-" + scheme + ".png" });
  }
  await page.emulateMedia({ colorScheme: "light" });
};
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload();

// 1. Receipts: Gifts in the filter, for the two already tagged, with a drawn present in navy.
await page.evaluate(() => window.go("receipts"));
await page.getByRole("heading", { name: "Receipts", exact: true }).waitFor();
const giftsTile = await giftsRow(page, "2 gifts");
assert.equal(await giftsTile.locator(".rl-cat-ico svg").count(), 1, "a drawn present, not a symbol");
assert.equal(await giftsTile.locator(".rl-cat-ico").evaluate(n => getComputedStyle(n).color), "rgb(16, 24, 40)", "in Relay's navy");
await polished(".rl-sheet[aria-label='Filter receipts']", "filter");
await page.mouse.click(200, 40); await page.locator(".rl-back").waitFor({ state: "detached" });
console.log("ok - Gifts in Receipts' filter gathers the receipts already tagged, in Relay's own colours");

// 2. Tag the vase as a gift: one save for a double tap, then who it's for.
await openReceiptKind(page, "Home & garden");
const vase = page.locator(".rl-rr").filter({ hasText: "Hand-thrown Ceramic Vase" });
await vase.locator(".rl-rr-main").click();
const sw = vase.getByRole("switch", { name: "Bought as a gift" });
assert.equal(await sw.getAttribute("aria-checked"), "false");
await sw.dblclick();
await vase.getByText("Marked as a gift. Add who it's for if you like.").waitFor();
await page.waitForTimeout(500);
assert.deepEqual(posts, [[ID.vase, { gift: true }]], "a double tap saves once");
assert.equal(await sw.getAttribute("aria-checked"), "true");
const who = vase.getByRole("textbox", { name: "Who it's for" });
assert.equal(await who.getAttribute("placeholder"), "Who's it for? (optional)");
const save = vase.getByRole("button", { name: "Save" });
assert.equal(await save.isDisabled(), true, "nothing to save yet");
await who.fill("Sam");
assert.equal(await save.isDisabled(), false);
await polished(".rl-rr.open", "gift details");
await who.press("Enter");
await vase.getByText("Saved. It's a gift for Sam.").waitFor();
assert.deepEqual(posts[1], [ID.vase, { gift: true, for: "Sam" }]);
assert.equal(await save.isDisabled(), true, "saved, so nothing new to save");
assert.match(await vase.locator(".rl-rr-mid").innerText(), /Larkspur Home, Gift for Sam/, "the row says who it's for");
assert.equal(await vase.locator(".rl-rr-gift").count(), 1, "and has a small present on its picture");
assert.equal(await page.locator(".rl-rr").filter({ hasText: "Brass Table Lamp" }).locator(".rl-rr-gift").count(), 1, "the lamp (for Dad) has one too");
console.log("ok - 'Bought as a gift' saves once for a double tap, then who it's for; the row shows it straight away");

// 3. The Gifts page: all three, a filter for each person, a search that finds a gift by who it's for.
await page.locator("#view .rl-cat-back").click();
await (await giftsRow(page, "3 gifts")).click();
await page.getByRole("heading", { name: "Gifts", exact: true }).waitFor();
const hero = page.locator(".rl-cat-hero");
assert.match(await hero.innerText(), /£425\.00 across 3 gifts since /);
assert.equal(await hero.evaluate(n => getComputedStyle(n).color), "rgb(16, 24, 40)", "navy on the lime page header");
const chips = page.locator(".rl-cat-chips button");
assert.deepEqual(await chips.allInnerTexts(), ["All", "Dad", "Mum", "Sam"], "a filter for each person");
await polished("#view .rl-cat-hero", "gifts header");
await chips.filter({ hasText: "Sam" }).click();
await page.waitForTimeout(150);
assert.equal(await page.locator(".rl-cat-list .rl-rr").count(), 1);
assert.match(await page.locator(".rl-cat-list").innerText(), /Hand-thrown Ceramic Vase/);
await chips.filter({ hasText: "All" }).click();
await page.locator(".rl-cat-search").fill("mum");
await page.waitForTimeout(150);
assert.equal(await page.locator(".rl-cat-list .rl-rr").count(), 1, "searching for who it's for");
assert.match(await page.locator(".rl-cat-list").innerText(), /Merino Wool Scarf/);
await page.locator(".rl-cat-search").fill("");
console.log("ok - the Gifts page: everything given, a filter per person, and search by who it was for");

// 4. Changed your mind: the scarf wasn't a gift after all.
const scarf = page.locator(".rl-rr").filter({ hasText: "Merino Wool Scarf" });
await scarf.locator(".rl-rr-main").click();
await scarf.getByRole("switch", { name: "Bought as a gift" }).click();
await scarf.getByText("Not a gift any more.").waitFor();
assert.deepEqual(posts[2], [ID.scarf, { gift: false }]);
assert.equal(await scarf.getByRole("textbox", { name: "Who it's for" }).count(), 0, "no name to give once it isn't a gift");
assert.equal(await scarf.locator(".rl-rr-gift").count(), 0);
assert.ok(!/Gift for/.test(await scarf.locator(".rl-rr-mid").innerText()));
console.log("ok - untagging takes the gift off straight away");

// 5. Wrapped: the cover counts gifts, the story has a gifts slide, and the biggest treat isn't a gift.
await page.evaluate(() => window.go("wrapped"));
await page.getByRole("heading", { name: "Your " + Y + " in purchases." }).waitFor();
assert.match(await page.locator(".rl-wr-cover p").first().innerText(), / · 2 gifts$/, "the cover counts gifts");
await page.getByRole("button", { name: "Play your " + Y + " story" }).click();
const texts = [];
for (let k = 0; k < 25; k++) {
  await page.waitForTimeout(1500); // let count-up numbers land
  texts.push(await page.locator(".rl-story-body").innerText());
  if (/FOR EVERYONE ELSE/.test(texts[texts.length - 1])) {
    for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); await page.screenshot({ path: "/tmp/shots/gifts-story-" + scheme + ".png" }); }
    await page.emulateMedia({ colorScheme: "light" });
  }
  if (await page.getByRole("button", { name: "Watch again" }).count()) break;
  await page.keyboard.press("ArrowRight");
}
const slide = texts.find(t => /FOR EVERYONE ELSE/.test(t));
assert.ok(slide, "a gifts slide: " + texts.map(t => t.split("\n")[0]).join(" | "));
assert.match(slide, /£380\.00/, "the vase and the lamp");
assert.match(slide, /on 2 gifts · for 2 people · \d+% of your spending/);
assert.match(slide, /Biggest gift\s+Hand-thrown Ceramic Vase for Sam · £320\.00/);
assert.match(slide, /Most giving month\s+\w+/);
const treat = texts.find(t => /Your biggest treat/.test(t));
assert.ok(treat && /£180\.00/.test(treat) && /Waxed Cotton Jacket/.test(treat) && !/Vase/.test(treat), "your biggest treat is the jacket you kept: " + treat);
const bg = await page.locator(".rl-story-frame").evaluate(n => n.style.background || getComputedStyle(n).backgroundColor);
assert.ok(bg, "story frame drawn");
await page.keyboard.press("Escape");
console.log("ok - Wrapped: the cover counts gifts; the story has a gifts slide with what was given and to how many people");
assert.deepEqual(errors, [], "no page errors");
console.log("PASS gifts UI: tag (once per double tap), who for, Gifts tile and page, untag, Wrapped (stubbed server, real Wrapped builder)");
await browser.close(); server.close();
