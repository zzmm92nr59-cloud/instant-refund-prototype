// End to end, at phone size: an order from a big shop whose email had no returns link (On, as on Connor's phone, 25 Nov
// 2026) still offers Start return, from Relay's checked list of shops' own UK returns pages (worker/returns-pages.js).
// Relay's real server (worker.js on this computer, scripts/local-worker.mjs, real SQLite) and the real app in a browser.
// The email is MADE UP and read by Relay's real reader; nothing leaves this computer (On's page is answered here).
// Screenshots go to RELAY_RETPAGES_SHOTS (or /tmp/shots).
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { startLocalWorker } from "./local-worker.mjs";
import { _codeAt } from "../worker/totp.js";
import { classifyEmail } from "../worker/gmail.js";
import { skipInterests, bigCards, homeCard } from "./relay-places.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const SHOTS = process.env.RELAY_RETPAGES_SHOTS || "/tmp/shots"; await mkdir(SHOTS, { recursive: true });
const LIVE_API = "https://relay-square-api2.9pts72cy5j.workers.dev", ON_PAGE = "https://www.on.com/en-gb/returns";

const TYPES = { ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const app = createServer(async (req, res) => {
  try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", TYPES[extname(p)] || "text/html"); res.end(await readFile(p)); }
  catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => app.listen(0, "127.0.0.1", r));
const APP = "http://127.0.0.1:" + app.address().port;
const w = await startLocalWorker({ appOrigin: APP });
const call = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(w.origin + path, { method, headers: { "content-type": "application/json", origin: APP, ...(token ? { authorization: "Bearer " + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const unb32 = t => { const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const o = []; for (const c of t.replace(/\s/g, "")) { v = (v << 5) | B.indexOf(c); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Uint8Array.from(o); };
const EMAIL = "robin.runner@example.com";
assert.equal((await call("/relay/auth/request", { method: "POST", body: { email: EMAIL } })).status, 200);
const token = (await call("/relay/auth/verify", { method: "POST", body: { token: /#signin=([A-Za-z0-9_-]{43})/.exec(w.emails[0].text)[1] } })).body.sessionToken;
const s = await call("/relay/my/2fa/setup", { method: "POST", token, body: {} });
assert.equal((await call("/relay/my/2fa/enable", { method: "POST", token, body: { code: await _codeAt(unb32(s.body.secret), Math.floor(Date.now() / 30000)) } })).status, 200);
await call("/relay/my/profile", { method: "POST", token, body: { name: "Robin Runner" } });
const shopper = w.sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(EMAIL).id;

// On's order confirmation, made up, with no returns link in it, read by the real reader and kept as a scan keeps it.
const d = new Date(Date.now() - 5 * 864e5), REF = "GB40007788";
const longDay = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const raw = `From: On <no-reply@on.com>\r\nTo: ${EMAIL}\r\nSubject: Thanks for your order ${REF}\r\nDate: ${d.toUTCString()}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n` +
  `<p>Hi Robin, thanks for your order.</p><p>Order number: ${REF}</p><p>Order date: ${longDay}</p><table><tr><td>Cloudmonster 2</td><td>Qty 1</td><td>£160.00</td></tr></table><p>Subtotal £160.00</p><p>Shipping £0.00</p><p>Total £160.00</p><p>We'll email you when it ships.</p>`;
const { details } = classifyEmail(raw, {});
assert.ok(!(details.returns && details.returns.portalUrl), "the email itself has no returns link");
w.sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), shopper, "on-1", "pending", JSON.stringify(details), Date.now());
const listed = (await call("/relay/my/receipts?all=1", { token })).body.receipts.find(c => c.orderRef === REF);
assert.equal(listed.returns.portalUrl, ON_PAGE, "the server gives it On's own UK returns page");
console.log("ok - On's email with no returns link: the server gives the receipt On's own UK returns page");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: "block", hasTouch: true });
await skipInterests(ctx); await bigCards(ctx);
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
await ctx.route(/^https?:\/\//, async route => {
  const req = route.request(), url = req.url();
  if (url.startsWith(APP)) return route.continue();
  if (url.startsWith(ON_PAGE)) return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Returns</h1>" });
  if (!url.startsWith(LIVE_API)) return route.abort();
  const headers = { ...req.headers() }; delete headers.host;
  const r = await fetch(w.origin + url.slice(LIVE_API.length), { method: req.method(), headers, body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postDataBuffer() });
  const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
  return route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) });
});
const page = await ctx.newPage(), errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(APP + "/index.html");
await page.evaluate(t => localStorage.setItem("relay.session.v1", JSON.stringify({ token: t.token, email: t.email, expiresAt: Date.now() + 864e5 })), { token, email: EMAIL });
await page.reload();
const card = homeCard(page, "Cloudmonster 2");
await card.waitFor();
await card.click();
const sheet = page.locator(".rl-sheet").last();
const start = sheet.getByRole("button", { name: "Start return" });
await start.waitFor();
assert.ok((await start.boundingBox()).height >= 44, "Start return is a full-size button");
await page.waitForTimeout(400);
await page.screenshot({ path: SHOTS + "/on-receipt-start-return.png" });
console.log("ok - the On order's page offers Start return");

await start.click();
await sheet.getByRole("heading", { name: "Return to On" }).waitFor();
const copy = sheet.getByRole("button", { name: "Copy your order number, " + REF });
await copy.waitFor();
await sheet.getByRole("button", { name: "Copy your email address, " + EMAIL }).waitFor();
await copy.click();
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), REF, "the order number is copied");
const link = sheet.getByRole("link", { name: "Copy order number and open On" });
assert.equal(await link.getAttribute("href"), ON_PAGE, "it opens On's own UK returns page");
// Said as it is: the page is On's own, and it didn't come from the email (never "the returns link from On's own email").
await sheet.getByText("This is On's own returns page for UK orders. Your order's email didn't include a returns link.").waitFor();
assert.equal(await sheet.getByText(/returns link from On's own email/).count(), 0);
for (const b of await sheet.locator("button, a").all()) { const box = await b.boundingBox(); if (box && box.width) assert.ok(box.height >= 44, "tap targets at least 44px: " + (await b.innerText())); }
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "nothing wider than the phone");
await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + "/on-return-guide.png" });
await page.evaluate(() => navigator.clipboard.writeText("something else"));
const [tab] = await Promise.all([ctx.waitForEvent("page"), link.click()]);
await tab.waitForLoadState();
assert.equal(tab.url(), ON_PAGE);
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), REF, "opened with the order number copied");
await tab.close();
assert.deepEqual(errors, [], "no page errors");
console.log("ok - Start return shows On's order number and email to copy, and opens On's returns page with the order number copied");
await browser.close(); await w.close(); app.close();
console.log("PASS a big shop's returns page without a link in its email (real server and app; made-up order)");
