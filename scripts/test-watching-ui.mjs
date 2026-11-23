// Browser test: Home's Watching list on a phone. Stubbed Relay server, a made-up shopper and invented shops.
// Checks (Connor, 23 Nov 2026: "this page layout is awful. Boxes overlap options etc and it's very laggy"):
//   - one card per watched thing, one tap each: nothing tappable inside a card (no row of buttons, rule 16);
//   - each card's photo is a 140px square, filling it; the name, shop, latest price and a small plain drop line beside it;
//   - no card overlaps another, nothing spills out of its card, and the last card clears the floating tab bar;
//   - the same with bigger phone text (30% larger), with no sideways scroll;
//   - nothing on the list is a stopping point for the page's up-and-down snapping, and no card is clipped to a drawn shape;
//   - nothing under 13px, every card at least 44px tall and pressed visibly;
//   - tapping a card opens its page (a sheet) with the prices, See it in Browse and Stop watching; Stop watching takes it
//     off the list and tells Relay once;
//   - left open, Watching asks Relay for nothing and isn't drawn again.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeReady, waitOutDoubleTap } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".html": "text/html" };
const root = resolve(".");
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
const EMAIL = "wren.watcher@example.com", NOW = Date.now();
const SHOPS = [["Kestrel Sports", "kestrel.example"], ["Bramble Beauty", "bramble.example"], ["Harlow & Co", "harlow.example"], ["Fernway", "fernway.example"]];
const NAMES = ["Academy Hardcase Football Duffel Bag (Medium, 60L) in Black and Bright White", "Argan Oil Repairing Conditioner for Dry and Damaged Hair, 250ml",
  "Extra-Long Hand-Thrown Stoneware Table Lamp with Linen Drum Shade", "Linen Notebook", "Court Trainers", "Wool Scarf", "Travel Mug", "Desk Lamp"];
const products = NAMES.map((n, i) => ({ product: n, variation: i === 4 ? "White / UK 8" : "Default Title", sku: "shopify:shop" + (i % 4) + ":variant:" + (100 + i), priceMinor: 1500 + i * 700, currency: "GBP",
  storeName: SHOPS[i % 4][0], shopDomain: SHOPS[i % 4][1], inStock: true, imageUrl: "https://img.example/" + (i % 3 === 1 ? "tall" : "sq") + "/" + i + ".svg", productType: "Thing" }));
// Half of them have dropped by £10 since watching started. The first one was watched last (shown first).
const watches = {};
products.map((p, i) => [p, i]).reverse().forEach(([p, i]) => { watches[p.sku] = { name: p.product, variant: p.variation, baseline: p.priceMinor + (i % 2 === 0 ? 1000 : 0), created: new Date(NOW - i * 864e5).toISOString() }; });
const svgSq = i => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="hsl(${i * 67 % 360},50%,80%)"/><circle cx="300" cy="300" r="160" fill="hsl(${i * 67 % 360},40%,45%)"/></svg>`;
const svgTall = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="1200"><rect width="400" height="1200" fill="#e8e1d5"/><circle cx="200" cy="140" r="90" fill="#b9805a"/><rect x="110" y="240" width="180" height="900" fill="#2f4f6f"/></svg>`;
const svgLogo = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect x="14" y="44" width="100" height="40" rx="8" fill="#0d6e4f"/></svg>`;
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
await skipInterests(ctx);
await ctx.addInitScript(([email, w]) => { try {
  localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email, expiresAt: Date.now() + 864e5 }));
  if (!localStorage.getItem("relay-radar-v2")) localStorage.setItem("relay-radar-v2", JSON.stringify(w)); localStorage.setItem("relay.mailbox", "gmail");
} catch (e) {} }, [EMAIL, watches]);
const log = [];
await ctx.route("https://**/*", async route => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
  if (u.hostname === "img.example") return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: H, body: p.startsWith("/tall/") ? svgTall : svgSq(Number(p.replace(/\D+/g, "")) || 1) });
  if (!p.startsWith("/relay/")) return route.abort();
  log.push(m + " " + p + (m === "POST" ? " " + (req.postData() || "") : ""));
  const j = b => route.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify(b) }).catch(() => {});
  if (p.startsWith("/relay/my/logo/")) return decodeURIComponent(p.split("/").pop()) === "kestrel.example" ? route.fulfill({ status: 200, contentType: "image/svg+xml", headers: H, body: svgLogo }) : route.fulfill({ status: 404, headers: H, body: "" });
  if (p === "/relay/my/receipts") return j({ receipts: [] });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Wren", photo: null });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, lastScanAt: NOW - 600e3, maxInboxes: 5 });
  if (p === "/relay/my/alerts/status") return j({ devices: 0, stores: [], watches: [] });
  if (p === "/relay/shopify/catalogue") return j({ published: true, products });
  if (p === "/relay/my/admin/me") return j({ admin: false });
  if (p === "/relay/my/2fa") return j({ required: false, enrolled: true, verified: true, methods: ["passkey"] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(origin + "/index.html"); await homeReady(page);
await page.locator("#view .h2-chip", { hasText: "Watching" }).click();
const cards = page.locator("#homePage .wl-card");
await page.waitForFunction(n => document.querySelectorAll("#homePage .wl-card").length === n, products.length, { timeout: 15000 });
await page.waitForFunction(() => [...document.querySelectorAll("#homePage .wl-pic img")].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
assert.ok(await cards.first().innerText().then(t => /Academy Hardcase Football/.test(t)), "newest watch first");

// The layout, at normal and at bigger text.
const layout = () => page.evaluate(() => {
  const list = [...document.querySelectorAll("#homePage .wl-card")], out = { n: list.length, overlaps: [], spills: [], inside: 0, pics: [], small: [], short: [], snap: [], clipped: 0 };
  const rects = list.map(c => c.getBoundingClientRect());
  for (let i = 1; i < rects.length; i++) if (rects[i].top < rects[i - 1].bottom - 0.5) out.overlaps.push(i);
  list.forEach((c, i) => {
    const r = rects[i];
    if (r.height < 44) out.short.push(i);
    out.inside += c.querySelectorAll("button, a, [role=button], input, select").length;
    for (const k of c.querySelectorAll("*")) {
      const q = k.getBoundingClientRect();
      if (q.width && (q.bottom > r.bottom + 0.5 || q.right > r.right + 0.5 || q.left < r.left - 0.5 || q.top < r.top - 0.5)) out.spills.push(i + ":" + k.className);
      if (k.childNodes.length && [...k.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(k).fontSize) < 13) out.small.push(k.className);
    }
    // Text beside the picture never runs under it.
    const pic = c.querySelector(".wl-pic").getBoundingClientRect(), mid = c.querySelector(".wl-mid").getBoundingClientRect();
    if (mid.left < pic.right) out.spills.push(i + ":mid under pic");
    const img = c.querySelector(".wl-pic img"); out.pics.push([Math.round(pic.width), Math.round(pic.height), img ? getComputedStyle(img).objectFit : "drawn"]);
  });
  out.snap = [...document.querySelectorAll("#homePage .h2-feed *")].filter(e => getComputedStyle(e).scrollSnapAlign !== "none").map(e => e.className);
  out.clipped = document.querySelectorAll("#homePage .h2-feed [data-rl-sq]").length;
  out.sideways = document.documentElement.scrollWidth > innerWidth + 1;
  return out;
});
const checkLayout = (l, when) => {
  assert.equal(l.n, products.length, when + ": a card per watched thing");
  assert.deepEqual(l.overlaps, [], when + ": no card overlaps another");
  assert.deepEqual(l.spills, [], when + ": nothing spills out of its card or under the photo");
  assert.equal(l.inside, 0, when + ": no buttons or links inside a card (one tap, rule 16)");
  assert.ok(l.pics.every(([w, h, fit]) => w === 140 && h === 140 && (fit === "cover" || fit === "drawn")), when + ": 140px square photos that fill it: " + JSON.stringify(l.pics));
  assert.deepEqual(l.small, [], when + ": no text under 13px");
  assert.deepEqual(l.short, [], when + ": every card at least 44px tall");
  assert.deepEqual(l.snap, [], when + ": nothing on the list is a snap point");
  assert.equal(l.clipped, 0, when + ": no card or photo is clipped to a drawn shape");
  assert.ok(!l.sideways, when + ": no sideways scroll");
};
checkLayout(await layout(), "normal text");
// What a card says: name, shop, latest price and the plain drop line; no drop line when the price hasn't dropped.
const first = await cards.nth(0).innerText(), second = await cards.nth(1).innerText();
assert.match(first, /Kestrel Sports/); assert.match(first, /£15\.00/); assert.match(first, /Down £10\.00 since you started watching/);
assert.match(second, /£22\.00/); assert.doesNotMatch(second, /since you started watching|Watching the price/, "nothing said when the price hasn't dropped");
assert.doesNotMatch(await page.locator("#homePage .h2-feed").innerText(), /·|sandbox|demo|test/i, "no dots or test wording");
assert.equal(await cards.nth(0).locator(".wl-logo.rl-has-logo img").count(), 1, "the shop's own logo when Relay has one");
assert.equal(await cards.nth(1).locator(".wl-logo").count(), 0, "no logo, and no letter in a circle, when it hasn't");
assert.ok(/transform/.test(await cards.first().evaluate(c => getComputedStyle(c).transition)), "a card reacts when pressed");
// The last card clears the floating tab bar.
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400);
const clear = await page.evaluate(() => { const last = [...document.querySelectorAll("#homePage .wl-card")].pop().getBoundingClientRect(), bar = document.querySelector("#foot").getBoundingClientRect(); return { last: last.bottom, bar: bar.top }; });
assert.ok(clear.last <= clear.bar, "the last card clears the tab bar: " + JSON.stringify(clear));
await page.evaluate(() => window.scrollTo(0, 0));
// Bigger phone text: every piece of text on Home 30% larger.
await page.evaluate(() => { for (const e of document.querySelectorAll("#homePage *")) { const c = getComputedStyle(e); e.style.fontSize = parseFloat(c.fontSize) * 1.3 + "px"; if (c.lineHeight !== "normal") e.style.lineHeight = parseFloat(c.lineHeight) * 1.3 + "px"; } });
await page.waitForTimeout(300);
checkLayout(await layout(), "bigger text");
await page.evaluate(() => { for (const e of document.querySelectorAll("#homePage *")) { e.style.fontSize = ""; e.style.lineHeight = ""; } });
console.log("ok - Watching: one-tap cards with 140px photos, nothing overlapping or spilling, clears the tab bar, survives bigger text");

// Left open: nothing asked of Relay, and the list isn't thrown away and drawn again.
{ const n0 = log.length;
  const redraws = await page.evaluate(() => new Promise(res => { let n = 0; const f = document.querySelector("#homePage .h2-feed"); const mo = new MutationObserver(r => { for (const x of r) if (x.removedNodes.length) n++; }); mo.observe(f, { childList: true }); setTimeout(() => { mo.disconnect(); res(n); }, 3000); }));
  assert.equal(redraws, 0, "not drawn again while left open"); assert.deepEqual(log.slice(n0), [], "nothing asked while left open"); }
console.log("ok - Watching left open asks Relay for nothing and isn't drawn again");

// A card opens its page: the prices, See it in Browse and Stop watching.
await waitOutDoubleTap(page);
await cards.nth(0).click();
const sheet = page.locator(".rl-back .rl-sheet").last(); await sheet.waitFor();
await page.waitForTimeout(400); if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + "/watching-sheet.png" });
const said = await sheet.innerText();
assert.match(said, /Latest price\s*£15\.00/); assert.match(said, /When you started watching\s*£25\.00/); assert.match(said, /Price drop\s*£10\.00/);
await sheet.getByRole("button", { name: "See it in Browse" }).waitFor(); await sheet.getByRole("button", { name: "Stop watching" }).waitFor();
// Stop watching: off the list at once, and Relay told once, even with a double tap.
const n0 = log.length;
await sheet.getByRole("button", { name: "Stop watching" }).dblclick();
await page.locator(".rl-back").waitFor({ state: "detached" });
await page.waitForFunction(n => document.querySelectorAll("#homePage .wl-card").length === n, products.length - 1);
assert.equal(await cards.filter({ hasText: "Academy Hardcase" }).count(), 0, "gone from the list");
assert.equal(await page.evaluate(sku => sku in JSON.parse(localStorage.getItem("relay-radar-v2") || "{}"), products[0].sku), false, "no longer watched on this phone");
await page.waitForTimeout(600);
assert.deepEqual(log.slice(n0).filter(x => /^POST \/relay\/my\/alerts\/watch/.test(x)).map(x => JSON.parse(x.split(" ").slice(2).join(" "))), [{ sku: products[0].sku, on: false }], "Relay told once: " + JSON.stringify(log.slice(n0)));
console.log("ok - a card opens its page with the prices, See it in Browse and Stop watching; stopping takes it off the list once");

// See it in Browse goes to the product's page in Browse.
await waitOutDoubleTap(page);
await cards.nth(0).click(); await sheet.waitFor();
await sheet.getByRole("button", { name: "See it in Browse" }).click();
await page.locator(".rl-back").waitFor({ state: "detached" });
await page.waitForFunction(() => /Argan Oil Repairing Conditioner/.test(document.getElementById("view").innerText) && !document.querySelector("#homePage .wl-card:not([hidden])")?.offsetParent, null, { timeout: 10000 });
console.log("ok - See it in Browse opens the product in Browse");

assert.deepEqual(errors, [], "no page errors");
console.log("PASS watching: one-tap cards, no overlaps, bigger text, quiet, its page with the actions");
await browser.close(); server.close();
