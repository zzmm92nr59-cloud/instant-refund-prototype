// Browser test: every receipt gets a picture. The item's own photo when Relay checked it, else the shop's logo, else a
// drawing of what was most likely bought (from the item, then the shop's name, then the kind of shop). Stubbed server.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : extname(p) === ".svg" ? "image/svg+xml" : extname(p) === ".ico" ? "image/x-icon" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const PNG = await readFile("icons/icon-192.png");
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let n = 0;
const R = (name, domain, logoDomain, items, category, extra = {}) => ({ id: "00000000-0000-4000-8000-" + String(++n).padStart(12, "0"), status: "confirmed", kind: "receipt", orderRef: "R" + n, orderDate: day(-n), totalPence: 1000 + n, currency: "GBP",
  retailer: { name, domain, logoDomain }, items: items.map(x => ({ name: x, qty: 1 })), category, returnable: !["food", "digital", "travel", "experiences"].includes(category), ...extra });
const receipts = [
  R("Kick Lane", null, null, ["Cloud Runner Trainers"], "fashion", { returns: { deadline: day(12) } }),
  R("Sainsbury's", "sainsburys.co.uk", "sainsburys.co.uk", [], "food"),
  R("J D Wetherspoon", "jdwetherspoon.co.uk", "jdwetherspoon.co.uk", ["Grilled Mix Roll"], "food"),
  R("The Scent Reserve", "thescentreserve.com", "thescentreserve.com", [], "beauty"),
  R("Clare Champion", "clarechampion.ie", "clarechampion.ie", [], "digital"),
  R("TV Beds North West", "tvbedsnorthwest.co.uk", "tvbedsnorthwest.co.uk", [], "home"),
  R("LNER on board service", null, "lner.co.uk", [], "travel"),
  R("Anthropic", null, "anthropic.com", [], "digital"),
  R("Forwarded receipt", "gmail.com", null, ["Define Jacket Nulu"], "fashion"),
  R("Bows and Whistles", "bowsandwhistles.co.uk", "bowsandwhistles.co.uk", [], "other"),
  R("Disney Store", "shopdisney.co.uk", "shopdisney.co.uk", ["Mickey Mouse T-shirt"], "fashion"),
  R("Oak Furniture Land", "oakfurnitureland.co.uk", "oakfurnitureland.co.uk", ["Coffee table"], "home"),
  R("Great Bean Bags", "greatbeanbags.com", "greatbeanbags.com", ["Chocolate Brown"], "home"),
  R("Premier Inn", "premierinn.com", "premierinn.com", [], "travel"),
  R("lululemon", "e.lululemon.com", "e.lululemon.com", ["Align Pant"], "fashion", { hasImage: true }),
];
const expect = { "Kick Lane": "shoe", "Sainsbury's": "basket", "The Scent Reserve": "perfume", "Clare Champion": "newspaper", "TV Beds North West": "bed", "LNER on board service": "train",
  "Anthropic": "cloud", "Forwarded receipt": "jacket", "Bows and Whistles": "shop", "Disney Store": "tshirt", "Oak Furniture Land": "sofa", "Great Bean Bags": "sofa", "Premier Inn": "key" };
const logoAsks = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method(), p = u.pathname;
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!p.startsWith("/relay/")) return route.abort();
  if (p.startsWith("/relay/my/logo/")) { const d = decodeURIComponent(p.slice(15)); logoAsks.push(d); return d === "jdwetherspoon.co.uk" ? route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG }) : route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" }); }
  if (/^\/relay\/my\/receipts\/[0-9a-f-]{36}\/image$/.test(p)) return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: "jess@example.com", lastScanAt: Date.now() });
  if (p === "/relay/my/receipts") return j({ receipts });
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: "jess@example.com", name: "Jess" });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(origin + "/index.html");
await page.evaluate(() => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: "jess@example.com", expiresAt: Date.now() + 864e5 })));
await page.reload();
await page.evaluate(() => window.go("receipts"));
await page.locator(".rl-cats button, .rl-cats [role=button]").first().waitFor();
// Open every group and read each row's picture.
const seen = {};
const groups = await page.locator(".rl-cats").getByRole("button").allInnerTexts();
for (let g = 0; g < groups.length; g++) {
  await page.locator(".rl-cats").getByRole("button").nth(g).click();
  await page.locator(".rl-rr").first().waitFor();
  await page.waitForTimeout(700);
  for (const row of await page.locator(".rl-rr").all()) {
    const shop = (await row.locator(".rl-rr-mid span").innerText()).split(" · ")[0];
    const title = await row.locator(".rl-rr-mid b").innerText();
    const pic = row.locator(".rl-rr-pic");
    const info = { ill: await pic.getAttribute("data-ill"), logo: await pic.locator("img.rl-logo-img").count(), photo: await pic.evaluate(n => n.classList.contains("rl-has-photo")), text: (await pic.innerText()).trim() };
    seen[title] = info; if (!/^Order /.test(shop)) seen[shop] = info;
  }
  await page.getByRole("button", { name: "All groups" }).click();
}
for (const [shop, key] of Object.entries(expect)) assert.equal(seen[shop] && seen[shop].ill, key, shop + " is drawn as " + key + ": " + JSON.stringify(seen[shop]));
assert.equal(seen["J D Wetherspoon"].logo, 1, "a shop with a logo shows its logo"); assert.equal(seen["J D Wetherspoon"].ill, null);
assert.equal(seen["lululemon"].photo, true, "a checked photo of the item wins");
assert.ok(Object.values(seen).every(x => x.text === ""), "no initials anywhere");
assert.ok(!logoAsks.includes("gmail.com"), "a forwarded receipt never asks for Gmail's logo");
assert.ok(logoAsks.includes("lner.co.uk"), "a shop with no address of its own uses its known address for the logo");
console.log("ok - photo, then logo, then a drawing of the item, shop or kind of shop; no initials; no logo asked for a mailbox");
// The drawing draws itself in and moves; with reduced motion it simply appears.
await page.locator(".rl-cats").getByRole("button", { name: /Fashion/ }).click();
const shoe = page.locator('.rl-rr-pic[data-ill="shoe"] svg path').first();
assert.notEqual(await shoe.evaluate(e => getComputedStyle(e).animationName), "none");
await page.emulateMedia({ reducedMotion: "reduce" });
await page.getByRole("button", { name: "All groups" }).click(); await page.locator(".rl-cats").getByRole("button", { name: /Fashion/ }).click();
assert.equal(await page.locator('.rl-rr-pic[data-ill="shoe"] svg path').first().evaluate(e => getComputedStyle(e).animationName), "none", "no movement when the phone asks for less motion");
await page.emulateMedia({ reducedMotion: "no-preference" });
console.log("ok - drawings animate, and stay still for reduced motion");
// Home: the wallet card for the trainers (no logo) gets the drawing too.
await page.evaluate(() => window.go("profile"));
await page.locator("#walletPage .rl-po-img").first().waitFor();
await page.waitForTimeout(600);
assert.equal(await page.locator("#walletPage .rl-po-img").first().getAttribute("data-ill"), "shoe");
console.log("ok - Home's wallet cards use the same pictures");
// A sheet of every drawing, for a look.
const keys = await page.evaluate(() => window.RelayAccount.drawing.keys());
assert.ok(keys.length >= 45, "a drawing for each kind of thing: " + keys.length);
await page.evaluate((keys) => {
  const g = document.createElement("div"); g.id = "sheet"; g.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff;display:grid;grid-template-columns:repeat(7,1fr);gap:8px;padding:12px;align-content:start";
  const cats = ["food", "fashion", "electronics", "home", "beauty", "travel", "digital", "experiences", "other"];
  keys.forEach((k, i) => { const cell = document.createElement("div"); cell.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:4px;font:12px sans-serif";
    const box = document.createElement("span"); box.style.cssText = "width:48px;height:48px;border-radius:14px;display:grid;place-items:center";
    window.RelayAccount.drawing.draw(box, { category: cats[i % cats.length] }, 28, k);
    const t = document.createElement("span"); t.textContent = k; cell.appendChild(box); cell.appendChild(t); g.appendChild(cell); });
  document.body.appendChild(g);
}, keys);
await page.waitForTimeout(2600);
await page.locator("#sheet").screenshot({ path: "/tmp/shots/drawings.png" });
assert.deepEqual(errors, []);
console.log("PASS pictures: every receipt has a photo, a logo or a drawing of what it most likely is");
await browser.close(); server.close();
