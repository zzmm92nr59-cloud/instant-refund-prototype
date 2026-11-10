// Offline test for returns through Relay. Nothing leaves this machine.
// Checks: only the order's owner can return; the shop's own returns period (or Relay's own 30-day limit when the shop
// hasn't set one, never shown as a date); a return can be started all through its last day; one return per item; and
// that Relay never presents a fake postage label (no Royal Mail-style tracking number, no QR data, no carrier).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleReturnRoute, generateReturnRef } from "../worker/returns.js";
import { emailHash } from "../worker/auth.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
sqlite.exec(`CREATE TABLE IF NOT EXISTS retailer_order_emails (order_id TEXT PRIMARY KEY, email_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS relay_exchanges (id TEXT PRIMARY KEY, shopper_id TEXT, order_id TEXT, line_id TEXT, shop TEXT, from_variant TEXT, from_title TEXT,
    to_variant TEXT, to_title TEXT, quantity INTEGER, status TEXT, detail TEXT, created_at INTEGER);`);
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
}
const env = { RELAY_DB: { prepare: sql => stmt(sql) } };
const SECRET = "unit-test-auth-secret-0123456789";
const alice = { id: "alice", emailHash: await emailHash(SECRET, "alice@example.com") };
const bob = { id: "bob", emailHash: await emailHash(SECRET, "bob@example.com") };
const conn = "shopify:kick-lane.myshopify.com";
function order(ext, who, orderedAt) {
  const id = conn + ":order:" + ext;
  sqlite.prepare("INSERT OR IGNORE INTO retailer_connections (id, provider, merchant_external_id) VALUES (?,?,?)").run(conn, "shopify", "kick-lane.myshopify.com");
  sqlite.prepare("INSERT INTO retailer_orders (id, connection_id, external_order_id, ordered_at, amount_minor, currency, payment_processor, status, raw_identifier_keys) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, conn, String(ext), orderedAt, 2000, "GBP", "shopify", "unverified", "[]");
  sqlite.prepare("INSERT INTO retailer_order_emails (order_id, email_hash, created_at) VALUES (?,?,?)").run(id, who.emailHash, 1);
  sqlite.prepare("INSERT INTO order_items (id, order_id, external_line_item_id, product_id, variant_id, title, quantity, price_minor, currency) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id + ":item:1", id, "L1", "P1", "V1", "Logo Sports Cap", 1, 2000, "GBP");
  return id;
}
const recent = order(100, alice, new Date(Date.now() - 2 * 864e5).toISOString());
const old = order(101, alice, new Date(Date.now() - 40 * 864e5).toISOString());
const middle = order(150, alice, new Date(Date.now() - 20 * 864e5).toISOString());

const call = async (shopper, method, path, body) => {
  const url = new URL("https://w.example" + path);
  const req = new Request(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const res = await handleReturnRoute(req, env, url, {}, shopper);
  return { status: res.status, body: await res.json() };
};

// Reference is clearly Relay's, never a Royal Mail-shaped tracking number.
for (let i = 0; i < 200; i++) {
  const ref = generateReturnRef();
  assert.match(ref, /^RLY-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.doesNotMatch(ref, /^[A-Z]{2}\d{9}GB$/);
}

// Someone else can't return Alice's order.
let r = await call(bob, "POST", "/relay/my/return", { orderId: recent, lineId: "L1", reason: "wrong_size" });
assert.equal(r.status, 404);

// The shop hasn't set a returns period, so Relay's own limit applies (30 days after ordering), said as Relay's.
r = await call(alice, "POST", "/relay/my/return", { orderId: old, lineId: "L1" });
assert.equal(r.status, 409); assert.deepEqual(r.body, { error: "outside_return_window", basis: "relay", days: 30 });
r = await call(alice, "GET", `/relay/my/return/eligibility?orderId=${encodeURIComponent(middle)}&lineId=L1`);
assert.equal(r.body.eligible, true); assert.equal(r.body.returnBy, null, "no date is made up when the shop hasn't given its period"); assert.equal(r.body.basis, "relay");

// The shop's own returns period (set in Relay for shops): 14 days after ordering. A 20-day-old order is past it, and the
// answer says it is the shop's period; a 2-day-old one gets the shop's own "return by" date and its instructions.
{
  const { saveShopReturns, shopReturns, returnWindow } = await import("../worker/shop-returns.js");
  assert.deepEqual((await saveShopReturns(env, "kick-lane.myshopify.com", { days: 0 }))[1], { error: "invalid_days" });
  assert.deepEqual((await saveShopReturns(env, "kick-lane.myshopify.com", { days: 14.5 }))[1], { error: "invalid_days" });
  assert.deepEqual((await saveShopReturns(env, "kick-lane.myshopify.com", { how: "x".repeat(601) }))[1], { error: "how_too_long" });
  const HOW = "Post it to Kick Lane Returns, Unit 4, Sample Park, Leeds.\n\n\nInclude your order number.";
  assert.deepEqual(await saveShopReturns(env, "kick-lane.myshopify.com", { days: 14, how: HOW }),
    [200, { days: 14, how: "Post it to Kick Lane Returns, Unit 4, Sample Park, Leeds.\n\nInclude your order number.", relayLimitDays: 30 }]);
  r = await call(alice, "POST", "/relay/my/return", { orderId: middle, lineId: "L1" });
  assert.equal(r.status, 409); assert.deepEqual(r.body, { error: "outside_return_window", basis: "shop", days: 14 });
  r = await call(alice, "GET", `/relay/my/return/eligibility?orderId=${encodeURIComponent(recent)}&lineId=L1`);
  const by = new Date(Date.now() - 2 * 864e5 + 14 * 864e5).toISOString().slice(0, 10);
  assert.deepEqual([r.body.eligible, r.body.returnBy, r.body.basis, r.body.label, r.body.inStore], [true, by, "shop", false, false]);
  assert.match(r.body.how, /^Post it to Kick Lane Returns/);
  // Only the period is cleared; the instructions stay. Then both are cleared for the checks below.
  assert.deepEqual((await saveShopReturns(env, "kick-lane.myshopify.com", { days: null }))[1].days, null);
  assert.match((await shopReturns(env, "kick-lane.myshopify.com")).how, /Include your order number/);
  await saveShopReturns(env, "kick-lane.myshopify.com", { how: "" });
  assert.deepEqual(await shopReturns(env, "kick-lane.myshopify.com"), { days: null, how: null });
  assert.equal(returnWindow("not a date", null, Date.now()).open, false);
  // The date a shopper is shown is one they can act on: a return can be started all through that day, and not after it.
  const placed = "2026-10-01T15:00:00Z", at = t => Date.parse(t);
  assert.deepEqual(returnWindow(placed, { days: 28 }, at("2026-10-29T14:00:00Z")), { open: true, basis: "shop", days: 28, by: "2026-10-29", daysSince: 27 });
  assert.equal(returnWindow(placed, { days: 28 }, at("2026-10-29T23:59:00Z")).open, true, "still open late on the last day, past the hour it was ordered at");
  assert.equal(returnWindow(placed, { days: 28 }, at("2026-10-30T00:00:01Z")).open, false, "closed once the last day is over");
  assert.deepEqual(returnWindow(placed, null, at("2026-10-31T20:00:00Z")), { open: true, basis: "relay", days: 30, by: "2026-10-31", daysSince: 30 });
  assert.equal(returnWindow(placed, { days: null }, at("2026-11-01T00:00:01Z")).open, false, "Relay's own limit ends the same way");
  console.log("ok - the shop's own returns period and instructions; Relay's own limit when it hasn't set one, never shown as a date");
}

// Eligible: request is saved, and the response is honest that there is no label and the shop wasn't told.
r = await call(alice, "GET", `/relay/my/return/eligibility?orderId=${encodeURIComponent(recent)}&lineId=L1`);
assert.equal(r.body.eligible, true);
r = await call(alice, "POST", "/relay/my/return", { orderId: recent, lineId: "L1", reason: "wrong_size" });
assert.equal(r.status, 200);
assert.equal(r.body.status, "requested");
assert.equal(r.body.labelAvailable, false);
assert.equal(r.body.shopNotified, false);
for (const k of ["qrData", "carrier", "instructions", "dropOffBy"]) assert.equal(k in r.body, false, `response must not include ${k}`);
const row = sqlite.prepare("SELECT status, carrier, return_ref FROM relay_returns").get();
assert.deepEqual([row.status, row.carrier], ["requested", null]);

// Can't return the same item twice; Alice sees her request, Bob sees nothing.
r = await call(alice, "POST", "/relay/my/return", { orderId: recent, lineId: "L1" });
assert.equal(r.status, 409); assert.equal(r.body.error, "already_returned");
assert.equal((await call(alice, "GET", "/relay/my/returns")).body.returns.length, 1);
assert.equal((await call(bob, "GET", "/relay/my/returns")).body.returns.length, 0);

// Telling the shop. Shopify and the email service are stand-ins; nothing is sent.
const recent2 = order(102, alice, new Date(Date.now() - 1 * 864e5).toISOString());
const recent3 = order(103, alice, new Date(Date.now() - 1 * 864e5).toISOString());
const recent4 = order(104, alice, new Date(Date.now() - 1 * 864e5).toISOString());
let emails = [], shopifyCalls = [], emailOk = true, contact = "returns@kicklane.example";
const fakeFetch = async (u, init = {}) => {
  u = String(u);
  if (u === "https://kick-lane.myshopify.com/admin/api/2026-07/graphql.json") {
    shopifyCalls.push(JSON.parse(init.body));
    assert.equal(init.headers["X-Shopify-Access-Token"], "tok");
    return Response.json({ data: { shop: { name: "Kick Lane", email: "owner@kicklane.example", contactEmail: contact }, order: { name: "#1102" } } });
  }
  if (u === "https://api.resend.com/emails") { emails.push(JSON.parse(init.body)); return new Response("{}", { status: emailOk ? 200 : 500 }); }
  throw Error("unexpected call " + u);
};
const listStores = async () => [{ domain: "kick-lane.myshopify.com", token: "tok", label: "Kick Lane" }];
const envMail = { RELAY_DB: env.RELAY_DB, RESEND_API_KEY: "test-key" };
const callWith = async (e, o, body) => {
  const url = new URL("https://w.example/relay/my/return");
  const res = await handleReturnRoute(new Request(url, { method: "POST", body: JSON.stringify(body) }), e, url, {}, alice, o);
  return { status: res.status, body: await res.json() };
};
// Email accepted: the shop gets order number, item, reason and reference; the shopper's email is not in it.
r = await callWith(envMail, { fetchImpl: fakeFetch, listStores }, { orderId: recent2, lineId: "L1", reason: "wrong_size" });
assert.equal(r.status, 200); assert.equal(r.body.shopNotified, true);
assert.equal(shopifyCalls.at(-1).variables.id, "gid://shopify/Order/102");
assert.equal(emails.length, 1);
const m = emails[0];
assert.deepEqual(m.to, ["returns@kicklane.example"]);
assert.match(m.subject, /^Return request RLY-[A-Z2-9]{4}-[A-Z2-9]{4} for order #1102$/);
assert.match(m.text, /Logo Sports Cap, £20\.00/); assert.match(m.text, /Reason: Wrong size or fit/); assert.match(m.text, new RegExp(r.body.returnRef));
assert.match(m.text, /not created a postage label and has not issued a refund/);
assert.doesNotMatch(m.text + m.html, /alice@example\.com/);
assert.ok(sqlite.prepare("SELECT shop_notified_at FROM relay_returns WHERE order_id = ?").get(recent2).shop_notified_at > 0);
// No customer-facing contact address: falls back to the shop owner's address.
contact = "";
r = await callWith(envMail, { fetchImpl: fakeFetch, listStores }, { orderId: recent3, lineId: "L1" });
assert.equal(r.body.shopNotified, true); assert.deepEqual(emails.at(-1).to, ["owner@kicklane.example"]);
assert.match(emails.at(-1).text, /Reason: Not given/);
// Email service refuses: the request is still saved, but the shopper is told the shop was NOT notified.
emailOk = false; contact = "returns@kicklane.example";
r = await callWith(envMail, { fetchImpl: fakeFetch, listStores }, { orderId: recent4, lineId: "L1" });
assert.equal(r.status, 200); assert.equal(r.body.shopNotified, false);
assert.equal(sqlite.prepare("SELECT shop_notified_at FROM relay_returns WHERE order_id = ?").get(recent4).shop_notified_at, null);
// Shop no longer connected, or no email service: nothing is sent and nothing is claimed.
const { notifyShopOfReturn } = await import("../worker/returns.js");
emails = []; emailOk = true;
assert.equal(await notifyShopOfReturn(envMail, { shop: "kick-lane.myshopify.com", externalOrderId: "1", returnRef: "RLY-AAAA-BBBB" }, { fetchImpl: fakeFetch, listStores: async () => [] }), false);
assert.equal(await notifyShopOfReturn({ RELAY_DB: env.RELAY_DB }, { shop: "kick-lane.myshopify.com", externalOrderId: "1", returnRef: "RLY-AAAA-BBBB" }, { fetchImpl: fakeFetch, listStores }), false);
assert.equal(emails.length, 0);
// The app only says the shop was emailed when it was.
const sheetText = readFileSync("account.js", "utf8");
assert.match(sheetText, /result\.shopNotified \? "We've emailed "/);

// The app screen no longer shows a fake QR / Post Office instructions.
const ui = readFileSync("account.js", "utf8");
assert.doesNotMatch(ui, /Show at Post Office|Show this QR code at any Post Office|Get my return label/);

console.log("test-returns-offline: all checks passed");
