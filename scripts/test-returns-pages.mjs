// Offline tests for big shops' own UK returns pages (worker/returns-pages.js), used for Start return when the shop's email
// had no returns link of its own: the list itself, how a shop is matched, and what Relay's real server (worker.js on this
// computer, scripts/local-worker.mjs, on a real SQLite database) puts on receipts. Made-up shoppers, orders and emails.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RETURNS_PAGES, returnsPageFor, wantsReturnsPage } from "../worker/returns-pages.js";
import { RETURN_POLICIES } from "../worker/return-policies.js";
import { classifyEmail } from "../worker/gmail.js";
import { startLocalWorker } from "./local-worker.mjs";
import { _codeAt } from "../worker/totp.js";
const pass = (m) => console.log("ok - " + m);
const MAX_AGE_DAYS = 180;

// 1. The list: each page on the shop's own https address, read recently, and nothing but the address.
const seenNames = new Set(), seenDomains = new Set();
for (const p of RETURNS_PAGES) {
  assert.ok(p.shop && Array.isArray(p.names) && p.names.length && Array.isArray(p.domains) && p.domains.length, p.shop);
  const u = new URL(p.url);
  assert.equal(u.protocol, "https:", p.shop + ": https only");
  assert.ok(p.domains.some((d) => u.hostname === d || u.hostname.endsWith("." + d)), p.shop + ": the page is on the shop's own address (" + u.hostname + ")");
  assert.match(p.checked, /^\d{4}-\d{2}-\d{2}$/);
  const age = (Date.now() - Date.parse(p.checked + "T00:00:00Z")) / 864e5;
  assert.ok(age >= -1 && age <= MAX_AGE_DAYS, p.shop + ": read " + Math.round(age) + " days ago; read it again on the shop's site (or remove it)");
  assert.ok(["read", "search", "linked"].includes(p.source), p.shop + ": how it was checked");
  assert.deepEqual(Object.keys(p).sort(), ["checked", "domains", "names", "shop", "source", "url"], p.shop + ": only the address, never a returns period or policy");
  for (const d of p.domains) { assert.ok(!seenDomains.has(d), "one shop per address: " + d); seenDomains.add(d); }
  for (const n of p.names) { const k = n.toLowerCase(); assert.ok(!seenNames.has(k), "one shop per name: " + n); seenNames.add(k); }
}
pass(`${RETURNS_PAGES.length} shops' returns pages: each on the shop's own https address, read within ${MAX_AGE_DAYS} days, the address only`);

// 2. Matching.
const on = RETURNS_PAGES.find((p) => p.shop === "On"), next = RETURNS_PAGES.find((p) => p.shop === "Next"), nike = RETURNS_PAGES.find((p) => p.shop === "Nike");
assert.equal(on.url, "https://www.on.com/en-gb/returns");
assert.equal(returnsPageFor({ name: "On", domain: "on.com" }, "GBP"), on, "On by its own address");
assert.equal(returnsPageFor({ name: "On", domain: "email.on.com" }, "GBP"), on, "and a sub-address it emails from");
assert.equal(returnsPageFor({ name: "On Running", domain: "on-running.com" }, "GBP"), on, "and its other address");
assert.equal(returnsPageFor({ name: "On", domain: null }, "GBP"), on, "through a payment company (no address of its own): its exact name");
assert.equal(returnsPageFor({ name: "on running", domain: null }, "GBP"), on, "the exact name, whatever the capitals");
for (const [r, why] of [[{ name: "London Drugs", domain: "london.com" }, "London"], [{ name: "Onyx", domain: "onyx.co.uk" }, "Onyx"], [{ name: "Only", domain: "only.com" }, "Only"],
  [{ name: "London", domain: null }, "the name London"], [{ name: "Onyx", domain: null }, "the name Onyx"], [{ name: "Only", domain: null }, "the name Only"],
  [{ name: "On Point Barbers", domain: null }, "a name that starts with On"], [{ name: "Shop On", domain: null }, "a name that ends with On"],
  [{ name: "Moon", domain: "moon.com" }, "an address that ends in on.com"], [{ name: "On", domain: "on.com.example" }, "on.com inside another address"],
  [{ name: "On", domain: "notonrunning.com" }, "an address that contains on-running"]])
  assert.equal(returnsPageFor(r, "GBP"), null, "not On: " + why);
assert.equal(returnsPageFor({ name: "Next", domain: "nextlevel.example" }, "GBP"), null, "a shop called Next on another address is not Next");
assert.equal(returnsPageFor({ name: "Next Day Flowers", domain: null }, "GBP"), null, "part of a name is never enough");
assert.equal(returnsPageFor({ name: "Nike", domain: "official.nike.com" }, "GBP"), nike, "Nike's email address");
assert.equal(returnsPageFor({ name: "Next", domain: "next.co.uk" }, null), next, "a .uk address is a UK order");
assert.equal(returnsPageFor({ name: "On", domain: "on.com" }, "EUR"), null, "an order in euros: a different country's page");
assert.equal(returnsPageFor({ name: "On", domain: "on.com" }, null), null, "no currency and no .uk address: can't tell it's a UK order");
assert.equal(returnsPageFor({ name: "On", domain: null }, "USD"), null);
assert.equal(returnsPageFor({ name: "Kestrel Outdoor", domain: "kestrel-outdoor.example" }, "GBP"), null, "a shop not on the list");
assert.equal(returnsPageFor(null, "GBP"), null);
pass("matched by the shop's own address or, with none, its whole name: On by on.com and on-running.com; London, Onyx, Only and parts of names never");

// 3. Which receipts it's for.
assert.equal(wantsReturnsPage({ kind: "receipt" }), true);
assert.equal(wantsReturnsPage({ kind: "order_update" }), true, "an order known from its shipping email");
assert.equal(wantsReturnsPage({ kind: "receipt", inStore: true }), false, "a till receipt: no online returns page");
assert.equal(wantsReturnsPage({ kind: "receipt", photoReceipt: true, source: "receipt_photo" }), false, "a photo of a paper receipt");
assert.equal(wantsReturnsPage({ kind: "return_instructions" }), false, "a return's own email");
assert.equal(wantsReturnsPage(null), false);
// (Shops with a published policy in return-policies.js that also have a page here use the same address for both.)
for (const p of RETURN_POLICIES) { const q = returnsPageFor({ domain: p.domains[0] }, "GBP"); if (q) assert.ok(q.domains.includes(p.domains[0])); }
pass("only for things bought online: a till receipt, a photo of one and a return's own emails get none");

// 4. Relay's real server: what the receipts list says.
const w = await startLocalWorker({ appOrigin: "http://127.0.0.1:1" });
const call = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(w.origin + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const unb32 = (t) => { const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const o = []; for (const c of t.replace(/\s/g, "")) { v = (v << 5) | B.indexOf(c); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Uint8Array.from(o); };
const email = "pat.pages@example.com";
assert.equal((await call("/relay/auth/request", { method: "POST", body: { email } })).status, 200);
const token = (await call("/relay/auth/verify", { method: "POST", body: { token: /#signin=([A-Za-z0-9_-]{43})/.exec(w.emails[0].text)[1] } })).body.sessionToken;
const s = await call("/relay/my/2fa/setup", { method: "POST", token, body: {} });
assert.equal((await call("/relay/my/2fa/enable", { method: "POST", token, body: { code: await _codeAt(unb32(s.body.secret), Math.floor(Date.now() / 30000)) } })).status, 200);
const shopper = w.sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id;
const longDay = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
let n = 0;
// An email as a scan keeps it (read by the real reader), or a receipt's details as an older version of the reader kept them.
const keep = (details) => { const id = randomUUID(); w.sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)").run(id, shopper, "pages-" + (++n), "pending", JSON.stringify(details), Date.now() - n * 1000); return id; };
const arrives = (from, subject, text) => {
  const { details } = classifyEmail(`From: ${from}\r\nTo: ${email}\r\nSubject: ${subject}\r\nDate: ${new Date(Date.now() - 4 * 864e5).toUTCString()}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${text}`, {});
  return { id: keep(details), details };
};
const order = (ref, item, pence, extra = "") => `<p>Thanks for your order.</p><p>Order number: ${ref}</p><p>Order date: ${longDay(-4)}</p><table><tr><td>${item}</td><td>Qty 1</td><td>£${(pence / 100).toFixed(2)}</td></tr></table><p>Subtotal £${(pence / 100).toFixed(2)}</p><p>Delivery £0.00</p><p>Total £${(pence / 100).toFixed(2)}</p>${extra}`;
const ON = arrives("On <no-reply@on.com>", "Thanks for your order GB40001234", order("GB40001234", "Cloudmonster 2 Running Shoe", 16000));
assert.deepEqual([ON.details.retailer.domain, Boolean(ON.details.returns && ON.details.returns.portalUrl)], ["on.com", false], "On's email has no returns link");
const OWN = "https://www.asos.com/my-account/returns/create?order=AS-55501";
const ASOS = arrives("ASOS <order@asos.com>", "Thanks for your order AS-55501", order("AS-55501", "Oversized Wool Coat", 8500, `<p><a href="${OWN}">Start a return</a></p>`));
assert.equal(ASOS.details.returns.portalUrl, OWN);
// An older reading kept before this list existed: no returns at all, and never read again.
const OLD = keep({ kind: "receipt", source: "shopper_email", retailer: { name: "Zara", domain: "zara.com" }, orderRef: "ZR-70001", orderDate: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10),
  totalPence: 4599, currency: "GBP", items: [{ name: "Wool Blend Blazer", qty: 1, pricePence: 4599 }], returns: null });
// A till receipt emailed by the shop, and a photo of a paper one.
const TILL = keep({ kind: "receipt", source: "shopper_email", inStore: true, retailer: { name: "Nike", domain: "official.nike.com" }, orderRef: "T-88812", orderDate: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10),
  totalPence: 6000, currency: "GBP", items: [{ name: "Club Fleece Hoodie", qty: 1, pricePence: 6000 }], returns: null });
const PHOTO = keep({ kind: "receipt", source: "receipt_photo", photoReceipt: true, retailer: { name: "Boots", domain: null }, orderDate: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10),
  totalPence: 2500, currency: "GBP", items: [{ name: "Electric Toothbrush", qty: 1, pricePence: 2500 }], returns: null });
// A shop that isn't on the list, and one that sounds like On.
const OTHER = arrives("Onyx Studio <orders@onyx-studio.example>", "Your Onyx order OX-1001", order("OX-1001", "Linen Throw", 3900));
const list = (await call("/relay/my/receipts?all=1", { token })).body.receipts;
const get = (id) => list.find((c) => c.id === id);
assert.deepEqual([get(ON.id).returns.portalUrl, get(ON.id).returns.portalFrom], [on.url, "shop_list"], "On with no link in its email: On's own UK returns page");
assert.equal(get(ASOS.id).returns.portalUrl, OWN, "the email's own returns link always wins");
assert.equal(get(ASOS.id).returns.portalFrom, undefined);
assert.equal(get(OLD).returns.portalUrl, RETURNS_PAGES.find((p) => p.shop === "Zara").url, "a receipt read before the list: given it without being read again");
assert.equal((get(TILL).returns || {}).portalUrl, undefined, "a till receipt: no online returns page");
assert.equal((get(PHOTO).returns || {}).portalUrl, undefined, "a photo of a paper receipt: none");
assert.equal((get(OTHER.id).returns || {}).portalUrl, undefined, "Onyx is not On");
assert.equal(JSON.parse(w.sqlite.prepare("SELECT details FROM captured_receipts WHERE id = ?").get(ON.id).details).returns, null, "worked out when listed: nothing written into the stored receipt");
await w.close();
pass("the real server: On's receipt gets On's page, the email's own link wins, an old reading gets it too, a till receipt, a photo and Onyx get none");
console.log("PASS shops' returns pages");
