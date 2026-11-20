// Browser test: a shopper with thousands of receipts sees them at once every time they open Relay, before Relay's own
// answer comes, and signing out removes them from the phone. Their list is more than the phone's quick storage holds
// (about 5 MB for everything), so the app keeps it in the browser's own database (IndexedDB) instead (account.js
// diskWrite); before, a list that big wiped the whole copy kept on the phone.
// A stubbed Relay server answers with 2,600 made-up receipts from invented shops, slowly (3 seconds) once the copy is kept.
// Run: node scripts/test-receipts-kept-ui.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { skipInterests, homeReady, openProfile } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const root = resolve(".");
const types = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".html": "text/html" };
const server = createServer(async (req, res) => { try { const p = resolve(root, "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); if (!p.startsWith(root + "/")) throw Error();
  res.setHeader("Content-Type", types[extname(p)] || "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;

// ---- A big, made-up account ----
const EMAIL = "pat.years@example.com", NOW = Date.now(), day = n => new Date(NOW + n * 864e5).toISOString().slice(0, 10);
const SHOPS = ["Kick Lane", "Glow Lab", "Harlow & Co", "Northfold", "Fernway", "Larkspur Home", "Tidewater", "Copper Kettle", "Maple Row", "Brightside Tech"];
const CATS = ["fashion", "electronics", "home", "beauty", "food"];
const N = 2600;
const receipts = Array.from({ length: N }, (_, i) => {
  const cat = CATS[i % CATS.length], shop = SHOPS[i % SHOPS.length], ago = 1 + Math.floor(i * 2.2), pence = 1500 + (i * 137) % 9000;
  const id = "b" + String(i).padStart(7, "0") + "-2222-4222-8222-" + String(i).padStart(12, "0");
  return { id, status: "confirmed", gmailId: "m" + String(i).padStart(9, "0"), kind: "receipt", retailer: { name: shop, domain: shop.toLowerCase().replace(/[^a-z]+/g, "") + ".example" },
    orderRef: "Y-" + i, orderDate: day(-ago), totalPence: pence, currency: "GBP", category: cat, returnable: cat !== "food", source: "gmail", hasImage: false,
    // A long list, as years of receipts are: every receipt with a few items and what the reader found.
    items: Array.from({ length: 3 }, (_, k) => ({ name: "Made-up thing " + i + "-" + k + " in a colour and a size", qty: 1, pricePence: Math.round(pence / 3), category: cat, categorySure: true, kind: "thing", kindSure: false, lasting: true })),
    itemsCheck: { complete: true, itemsPence: pence, expectedPence: pence }, confidence: "high", sentTo: "pat.years@example.com", method: "rules", needsShopperConfirmation: false,
    returns: ago < 30 && cat !== "food" ? { windowDays: 30, deadline: day(30 - ago) } : null, notes: "x".repeat(600) };
});
const firstShown = "Made-up thing 0-0";
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" };
let slow = 0, asked = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", isMobile: true, hasTouch: true });
await skipInterests(ctx);
await ctx.addInitScript(([email]) => {
  try { if (!localStorage.getItem("relay.session.v1") && !sessionStorage.getItem("signedOut")) localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email })); localStorage.setItem("relay.mailbox", "gmail"); } catch (e) {}
}, [EMAIL]);
await ctx.route("https://**/*", async route => {
  const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname;
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: H });
  if (!p.startsWith("/relay/")) return route.abort();
  asked.push(p + u.search);
  const j = async (b, wait = 0) => { if (wait) await new Promise(r => setTimeout(r, wait)); return route.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify(b) }).catch(() => {}); };
  if (p.startsWith("/relay/my/logo/")) return route.fulfill({ status: 404, headers: H, body: "" });
  if (p === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [], gmailAvailable: true });
  if (p === "/relay/my/gmail") return j({ connected: true, provider: "google", email: EMAIL, googleEmail: EMAIL, connectedAt: NOW - 864e5, lastScanAt: NOW - 36e5, checkedAt: NOW - 36e5, scan: { state: "done", found: N, finishedAt: NOW - 36e5 }, others: [], maxInboxes: 5 });
  if (p === "/relay/my/gmail/scan") return j({ ok: true, added: 0, updated: 0, more: false, job: { state: "done", found: N, finishedAt: Date.now() } });
  // Home asks for the newest; the Receipts page for all of them. Both are the same list here (what matters is its size).
  if (p === "/relay/my/receipts") return j({ receipts }, slow);
  if (p === "/relay/my/purchases") return j({ purchases: [] });
  if (p === "/relay/my/profile") return j({ email: EMAIL, name: "Pat Years", photo: null });
  if (p === "/relay/auth/logout") return j({ ok: true });
  return j({});
});
const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
const kept = () => page.evaluate(() => new Promise((ok) => {
  try { const q = indexedDB.open("relay.kept.v1"); q.onsuccess = () => { const db = q.result; if (!db.objectStoreNames.contains("kept")) { db.close(); return ok(null); }
    const g = db.transaction("kept").objectStore("kept").get("receipts"); g.onsuccess = () => { db.close(); ok(g.result ? { email: g.result.email, n: g.result.rows.length } : null); }; g.onerror = () => { db.close(); ok(null); }; };
    q.onerror = () => ok(null); } catch (e) { ok(null); }
}));
const disk = () => page.evaluate(() => { const c = JSON.parse(localStorage.getItem("relay.cache.v1") || "null"); return c && { receipts: Array.isArray(c.receipts) ? c.receipts.length : null, kept: Boolean(c.receiptsKept), purchases: Array.isArray(c.purchases) }; });

// 1. The first time: Relay answers quickly, and the list is kept on the phone.
await page.goto(origin + "/index.html");
await homeReady(page);
await page.evaluate(() => window.go("receipts"));
await page.waitForFunction(() => /Receipts/.test(document.body.innerText));
for (let i = 0; i < 60 && !(await kept()); i++) await page.waitForTimeout(100);
const k = await kept(), d = await disk();
assert.ok(JSON.stringify(receipts).length > 2500000, "the made-up list is bigger than the phone's quick storage takes");
assert.deepEqual(k, { email: EMAIL, n: N }, "every receipt is kept in the browser's database");
assert.ok(d && d.kept && d.receipts === null && d.purchases, "the quick storage keeps the rest, and says the receipts are in the database: " + JSON.stringify(d));
console.log("ok - a list of " + N + " receipts is kept on the phone (in the browser's database), with the rest of the copy");

// 2. Opened again with Relay slow to answer: Home and Receipts show the receipts before Relay's answer comes.
slow = 3000;
await page.goto(origin + "/index.html");
const t0 = Date.now();
await page.locator("#homePage .h2-feed > *:not(.rl-skel)").first().waitFor({ timeout: 2500 });
const homeMs = Date.now() - t0;
assert.ok(homeMs < 2500, "Home shows the receipts kept on the phone before Relay answers (" + homeMs + " ms)");
await page.evaluate(() => window.go("receipts"));
const t1 = Date.now();
await page.waitForFunction(() => { const v = document.getElementById("view"); return v && /All receipts|Fashion|Electronics/.test(v.innerText) && !v.querySelector(".rl-skel"); }, null, { timeout: 2500 });
console.log("ok - opened again with Relay slow (3 s): Home drew in " + homeMs + " ms and Receipts in " + (Date.now() - t1) + " ms, from the copy on the phone");
await page.waitForTimeout(3500);
assert.deepEqual(errors, [], "no errors on the page");

// 3. Signing out removes the copy kept on the phone, in the database too.
slow = 0;
await openProfile(page);
await page.locator("#mePage .rl-arow", { hasText: "Settings" }).first().click(); await page.waitForTimeout(450);
await page.evaluate(() => sessionStorage.setItem("signedOut", "1"));
await page.getByRole("button", { name: "Sign out" }).click();
await page.locator(".rl-welcome").getByRole("button", { name: "Get started" }).waitFor();
for (let i = 0; i < 30 && (await kept()); i++) await page.waitForTimeout(100);
assert.equal(await kept(), null, "no receipts left in the browser's database");
assert.equal(await page.evaluate(() => localStorage.getItem("relay.cache.v1")), null, "nothing of the account left in the quick storage");
console.log("ok - signing out removes the receipts kept on the phone, from the database too");

assert.deepEqual(errors, [], "no errors on the page");
await browser.close(); server.close();
console.log("PASS a big list of receipts shows at once from the phone every time, and goes on sign-out");
