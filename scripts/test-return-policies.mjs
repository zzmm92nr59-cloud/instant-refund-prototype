// Offline tests for shops' published returns policies (worker/return-policies.js), with a real SQLite engine for the
// receipts list. The policies themselves were read on the shops' own pages; this checks how Relay uses them, and that
// every entry is complete and recent enough. Made-up people and orders.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { RETURN_POLICIES, policyFor, policyForApp, policyReturnBy } from "../worker/return-policies.js";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION } from "../worker/gmail.js";

const pass = name => console.log("ok - " + name);
const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
const plus = (d, n) => iso(Date.parse(d + "T00:00:00Z") + n * DAY);

// --- 1. Every entry is complete: the shop's own https page, the words it says, and when it was read ---
const MAX_AGE_DAYS = 180;
const seen = new Set();
for (const p of RETURN_POLICIES) {
  assert.ok(p.shop && Array.isArray(p.domains) && p.domains.length, p.shop);
  for (const d of p.domains) { assert.match(d, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, p.shop + " " + d); assert.ok(!seen.has(d), "one policy per address: " + d); seen.add(d); }
  assert.ok(Number.isInteger(p.days) && p.days >= 14 && p.days <= 365, p.shop + ": days");
  assert.ok([null, "delivery", "dispatch", "purchase"].includes(p.from), p.shop + ": from");
  const host = new URL(p.url).hostname;
  assert.equal(new URL(p.url).protocol, "https:", p.shop);
  assert.ok(p.domains.some(d => host === d || host.endsWith("." + d)), p.shop + ": the page is on the shop's own address (" + host + ")");
  assert.ok(typeof p.quote === "string" && p.quote.includes(String(p.days)), p.shop + ": the quoted words give the number of days");
  assert.match(p.checked, /^\d{4}-\d{2}-\d{2}$/, p.shop + ": checked");
  const age = (Date.now() - Date.parse(p.checked + "T00:00:00Z")) / DAY;
  assert.ok(age >= -1 && age <= MAX_AGE_DAYS, `${p.shop}'s policy was read on ${p.checked}: read it again on the shop's page (and update or remove it) before relying on it`);
  if (p.festive) {
    assert.match(p.festive.bought[0], /^\d{4}-\d{2}-\d{2}$/); assert.match(p.festive.bought[1], /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(p.festive.until ? /^\d{4}-\d{2}-\d{2}$/.test(p.festive.until) : Number.isInteger(p.festive.days), p.shop + ": festive");
    assert.ok(typeof p.festive.quote === "string" && p.festive.quote.length > 20, p.shop + ": the festive dates are quoted");
  }
}
pass(`${RETURN_POLICIES.length} policies: each on the shop's own https page, quoted, read within ${MAX_AGE_DAYS} days`);

// --- 2. Matching a receipt to a policy: the shop's address and its sub-addresses, orders in pounds or a .uk address ---
const hm = RETURN_POLICIES.find(p => p.shop === "H&M"), next = RETURN_POLICIES.find(p => p.shop === "Next");
assert.equal(policyFor({ domain: "hm.com" }, "GBP"), hm);
assert.equal(policyFor({ domain: "email.hm.com" }, "GBP"), hm, "a sub-address of the shop");
assert.equal(policyFor({ domain: "www2.hm.com" }, "GBP"), hm);
assert.equal(policyFor({ logoDomain: "hm.com", domain: null }, "GBP"), hm, "the shop's address worked out from its name");
assert.equal(policyFor({ domain: "ohm.com" }, "GBP"), null, "not just the same ending");
assert.equal(policyFor({ domain: "hm.com.example" }, "GBP"), null);
assert.equal(policyFor({ domain: "hm.com" }, "EUR"), null, "an order in euros is a different country's policy");
assert.equal(policyFor({ domain: "hm.com" }, null), null, "no currency, no .uk address: can't tell it's a UK order");
assert.equal(policyFor({ domain: "next.co.uk" }, null), next, "a .uk address is a UK order");
assert.equal(policyFor({ domain: "kestrel-outdoor.test" }, "GBP"), null);
assert.equal(policyFor(null, "GBP"), null);
pass("a receipt matches its shop's policy by address, only for UK orders");

// --- 3. The least the shopper can count on, for most items; never a countdown ---
const today = "2026-11-04";
const pol = (o) => ({ shop: "Test", domains: ["test.example"], days: 30, from: "delivery", most: true, url: "https://test.example/returns", quote: "30 days", checked: today, ...o });
assert.deepEqual(policyReturnBy({ orderDate: "2026-10-30", delivery: { status: "delivered", at: "2026-11-02" } }, pol(), today),
  { date: "2026-12-02", basis: "policy", from: "delivery", estimate: true }, "from the day it arrived");
assert.deepEqual(policyReturnBy({ orderDate: "2026-10-30", delivery: { status: "out_for_delivery", at: "2026-11-03" } }, pol(), today),
  { date: "2026-11-29", basis: "policy", from: "order", estimate: true }, "not arrived yet: at least 30 days from the order");
assert.deepEqual(policyReturnBy({ orderDate: "2026-10-30" }, pol({ from: "dispatch" }), today), { date: "2026-11-29", basis: "policy", from: "order", estimate: true });
assert.deepEqual(policyReturnBy({ orderDate: "2026-10-30", delivery: { status: "delivered", at: "2026-11-02" } }, pol({ from: null }), today),
  { date: "2026-11-29", basis: "policy", from: "order", estimate: true }, "a policy that doesn't say from when counts from the order");
assert.deepEqual(policyReturnBy({ orderDate: "2026-10-30" }, pol({ from: "purchase", days: 28 }), today), { date: "2026-11-27", basis: "policy", from: "order", estimate: true });
assert.equal(policyReturnBy({ orderDate: "2026-09-01" }, pol(), today), null, "a date that's passed says nothing for sure");
assert.equal(policyReturnBy({ orderDate: "2026-12-01" }, pol(), today), null, "an order date in the future is a misread");
assert.equal(policyReturnBy({ orderDate: null }, pol(), today), null);
const xmas = pol({ festive: { bought: ["2026-11-01", "2026-12-31"], until: "2027-01-31", quote: "Bought 1 November to 31 December 2026? Return it by 31 January 2027." } });
assert.deepEqual(policyReturnBy({ orderDate: "2026-11-02", delivery: { status: "delivered", at: "2026-11-03" } }, xmas, today),
  { date: "2027-01-31", basis: "policy", from: "festive", estimate: true }, "bought in the Christmas dates: the later date");
assert.equal(policyReturnBy({ orderDate: "2026-10-25", delivery: { status: "delivered", at: "2026-10-27" } }, xmas, today).from, "delivery", "bought before them: the usual window");
const sixty = pol({ festive: { bought: ["2026-11-01", "2026-12-31"], days: 60, from: "delivery", quote: "Purchases made 1 November to 31 December 2026 get 60 days." } });
assert.deepEqual(policyReturnBy({ orderDate: "2026-11-02", delivery: { status: "delivered", at: "2026-11-03" } }, sixty, today), { date: "2027-01-02", basis: "policy", from: "festive", estimate: true });
for (const p of RETURN_POLICIES) {
  const by = policyReturnBy({ orderDate: today, delivery: { status: "delivered", at: today } }, p, today);
  assert.ok(by && by.estimate === true && by.basis === "policy" && by.date > today, p.shop);
}
assert.deepEqual(Object.keys(policyForApp(hm)).sort(), ["checked", "days", "from", "most", "shop", "url"], "the app gets what it shows, not the quotes");
pass("the least the shopper can count on: from delivery when known, else from the order; Christmas dates only when dated; always marked as worked out");

// --- 4. The receipts list: the policy fills in only when the emails give no date or window ---
const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    async run() { sqlite.prepare(sql).run(...args); return {}; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); }
  };
}
const db = { prepare: sql => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { list.forEach(s => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key" };
let emails = [];
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  return new Response("not here", { status: 404 });
};
const call = (path, { method = "GET", body, token } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "7.7.7.7", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: Date.now(), fetchImpl });
await call("/relay/auth/request", { method: "POST", body: { email: "sam.shopper@relay.test" } });
const token = (await (await call("/relay/auth/verify", { method: "POST", body: { token: /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1] } })).json()).sessionToken;
assert.equal((await call("/relay/my/consent", { method: "POST", token, body: { version: CONSENT_VERSION } })).status, 200);
await call("/relay/my/receipts", { token }); // makes the tables
const shopperId = sqlite.prepare("SELECT id FROM shoppers").get().id;
const now = Date.now(), day = n => iso(now + n * DAY);
let n = 0;
const add = (details, status = "pending") => sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)")
  .run(crypto.randomUUID(), shopperId, "m" + (++n), status, JSON.stringify(details), now - n * 1000);
const order = (ref, shop, domain, o = {}) => ({ kind: "receipt", retailer: { name: shop, domain }, orderRef: ref, orderDate: day(-5), currency: "GBP", totalPence: 2999,
  items: [{ name: "Ribbed Knit Jumper", qty: 1, pricePence: 2999, variant: "M" }], returns: null, ...o });
add(order("HM-100", "H&M", "email.hm.com"));
add({ kind: "delivery_update", status: "delivered", at: day(-2), orderRef: "HM-100", retailer: { name: "H&M", domain: "email.hm.com" } });
add(order("ZA-200", "Zara", "zara.com"));
add(order("HM-300", "H&M", "hm.com", { currency: "EUR" }));
add(order("HM-400", "H&M", "hm.com", { returns: { windowDays: 60, windowFrom: "delivery" } }));
add(order("HM-500", "H&M", "hm.com", { returns: { deadline: day(20) } }));
add(order("KO-600", "Kestrel Outdoor", "kestrel-outdoor.test"));
add(order("NX-700", "Next", "next.co.uk", { orderDate: day(-60), currency: null }));
const list = (await (await call("/relay/my/receipts", { token })).json()).receipts;
const card = ref => list.find(c => c.orderRef === ref);
assert.deepEqual(card("HM-100").returnPolicy, policyForApp(hm));
assert.deepEqual(card("HM-100").returnBy, { date: plus(day(-2), 30), basis: "policy", from: "delivery", estimate: true }, "delivered: 30 days from the day it arrived, instead of UK law's 14");
assert.equal(card("ZA-200").returnPolicy.shop, "Zara");
assert.deepEqual(card("ZA-200").returnBy, { date: plus(day(-5), 30), basis: "policy", from: "order", estimate: true }, "from when it's sent: at least 30 days from the order");
assert.equal(card("HM-300").returnPolicy, undefined, "an order in euros gets no UK policy");
assert.equal(card("HM-300").returnBy.basis, "uk_law");
assert.equal(card("HM-400").returnPolicy, undefined, "the email's own window wins");
assert.equal(card("HM-400").returnBy.basis, "window");
assert.equal(card("HM-500").returnPolicy, undefined, "the email's own date wins");
assert.equal(card("KO-600").returnPolicy, undefined, "a shop Relay hasn't read the policy of");
assert.equal(card("KO-600").returnBy.basis, "uk_law");
assert.equal(card("NX-700").returnPolicy.shop, "Next", "the policy is shown even when its date has passed");
assert.equal(card("NX-700").returnBy, undefined, "but a passed date says nothing for sure");
pass("the receipts list uses a shop's policy only when its emails give no date or window, for UK orders");

console.log("PASS shops' returns policies: complete and recent, matched safely, the least the shopper can count on, emails first");
