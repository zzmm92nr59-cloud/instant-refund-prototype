// Offline test (real SQLite): shops as the answer key (worker/answer-key.js). An order a connected Shopify shop confirmed is
// looked for among the receipts of the shopper it belongs to (and nobody else's), by its order number or else the only
// receipt from that shop within two days; what Relay read is checked part by part against the shop's record (shop, total,
// date, order number, items), with the reader's own reading checked, not a shopper's fix. The Relay health page shows the
// counts, names a shop only from 3 shoppers, and lists only the admin's own orders in detail. Shops, people and items are
// made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { ingestShopifyOrder } from "../worker/shopify-webhooks.js";
import { ensureShopifyShopSchema } from "../worker/shopify-connect.js";
import { pairOrders, compareToOrder, sameNumber, sameName, sameItem, ukDay, ANSWER_KEY_DAYS } from "../worker/answer-key.js";
import { cleanOrderRef } from "../worker/order-ref.js";
import { runHealthEmails } from "../worker/health-digest.js";

// The pieces.
{
  assert.equal(ukDay("2026-10-24T23:30:00Z"), "2026-10-25", "half past eleven at night in October (UTC) is the next day in the UK (summer time)");
  assert.equal(ukDay("2026-11-04T23:30:00Z"), "2026-11-04", "and the same day in winter");
  assert.equal(ukDay("not a date"), null);
  assert.ok(sameNumber("Order #1001", { ref: "#1001" }) && sameNumber("1001", { ref: "#1001" }) && !sameNumber("#1002", { ref: "#1001" }) && !sameNumber("#1", { ref: "#1" }));
  assert.ok(sameName("Brindle", "Brindle & Co") && sameName("Bows & Whistles", "Bows and Whistles") && sameName("The Home Store", "home store") && !sameName("Zara", "Brindle"));
  assert.ok(sameItem("Merino Wool Scarf - Grey", "Merino Wool Scarf") && sameItem("Wool scarf, merino", "Merino Wool Scarf") && !sameItem("Gift Box", "Merino Wool Scarf"));
  assert.deepEqual(["#1001", "BR-1001-UK", "", "x".repeat(41), "<b>#1</b>", "none"].map(cleanOrderRef), ["#1001", "BR-1001-UK", null, null, null, null]);
  const order = { id: "o1", ref: "#1001", orderedAt: "2026-10-12T10:00:00Z", amount: 4500, currency: "GBP", label: "Brindle & Co", handle: "brindle co",
    lines: [{ title: "Merino Wool Scarf", quantity: 1 }, { title: "Gift Box", quantity: 1 }] };
  const card = (over) => ({ retailer: { name: "Brindle & Co", domain: "brindle.example" }, orderRef: "#1001", orderDate: "2026-10-12", totalPence: 4500, currency: "GBP",
    items: [{ name: "Merino Wool Scarf", qty: 1 }, { name: "Gift Box", qty: 1 }], ...over });
  assert.equal(compareToOrder(card({}), order).allRight, true);
  assert.equal(compareToOrder(card({ items: [] }), order).parts.items, "none");
  assert.equal(compareToOrder(card({ items: [{ name: "Merino Wool Scarf" }] }), order).parts.items, "missing");
  assert.equal(compareToOrder(card({ items: [{ name: "Merino Wool Scarf" }, { name: "Gift Box" }, { name: "Wool Socks" }] }), order).parts.items, "extra");
  assert.equal(compareToOrder(card({ orderDate: "2026-10-13" }), order).parts.date, "right", "a day out is the time zone, not a misreading");
  assert.equal(compareToOrder(card({ orderDate: "2026-10-15" }), order).parts.date, "wrong");
  assert.equal(compareToOrder(card({ totalPence: null }), order).parts.total, "missing");
  assert.equal(compareToOrder(card({ orderRef: null }), { ...order, ref: null }).parts.number, null, "orders kept before order numbers were kept aren't checked for one");
  // Pairing: by number first; a receipt with another order's number is never taken for this one; two equally good are unsure.
  const o2 = { ...order, id: "o2", ref: "#1002", orderedAt: "2026-10-12T15:00:00Z" };
  const a = card({ orderRef: "#1002" }), b = card({ orderRef: null });
  let r = pairOrders([a, b], [order, o2]);
  assert.deepEqual(r.pairs.map((p) => [p.order.id, p.card === a ? "a" : "b", p.how]).sort(), [["o1", "b", "shop"], ["o2", "a", "number"]]);
  r = pairOrders([card({ orderRef: null }), card({ orderRef: null, totalPence: 100 })], [{ ...order, ref: null }]);
  assert.deepEqual([r.pairs.length, r.unpaired[0].why], [0, "unsure"], "two receipts from the shop that day: unsure, so left out rather than guessed");
  r = pairOrders([card({ orderRef: null, orderDate: "2026-10-16" })], [{ ...order, ref: null }]);
  assert.deepEqual([r.pairs.length, r.unpaired[0].why], [0, "not_found"], "the same shop four days later is another order");
  r = pairOrders([card({ orderDate: "2026-10-20" })], [order]);
  assert.deepEqual([r.pairs[0].how, r.pairs[0].check.parts.date], ["number", "wrong"], "the same number from the same shop: a misread date is caught, not missed");
  r = pairOrders([card({ retailer: { name: "Payments Ltd", domain: "pay.example" }, orderDate: "2026-10-14" })], [order]);
  assert.deepEqual([r.pairs[0].how, r.pairs[0].check.parts.shop], ["number", "wrong"], "the same number within a week: a misread shop is caught");
  r = pairOrders([card({ retailer: { name: "Other Shop", domain: "other.example" }, orderDate: "2026-11-01" })], [order]);
  assert.equal(r.pairs.length, 0, "another shop's order with the same number weeks later isn't taken for this one");
  console.log("ok - order numbers, shop names, items and UK days compared fairly; pairing never guesses");
}

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    async run() { sqlite.prepare(sql).run(...args); return {}; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); }
  };
}
const db = { prepare: (sql) => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { list.forEach((s) => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "alice@example.com" };
let emails = [];
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  return new Response("{}", { status: 404 });
};
const clock = Date.UTC(2026, 10, 5, 9);
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const tokens = {}, ids = {};
for (const [who, ip] of [["alice", "5.5.5.1"], ["bob", "5.5.5.2"], ["carol", "5.5.5.3"], ["dan", "5.5.5.4"], ["eve", "5.5.5.5"]]) {
  tokens[who] = await signIn(who + "@example.com", ip);
  ids[who] = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(who + "@example.com").id;
}
await call("/relay/my/receipts", { token: tokens.alice }); // makes the receipt and inbox tables

// Two shops connected to Relay.
await ensureShopifyShopSchema(db);
for (const [domain, label] of [["brindle-co.myshopify.com", "Brindle & Co"], ["larkspur.myshopify.com", "Larkspur Home"]])
  sqlite.prepare("INSERT INTO shopify_shops (domain, label, access_iv, access_data, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(domain, label, "iv", "data", 1, 1);
// Their orders, through the same code the shops' Shopify notifications use. No order number = an order kept before they were.
let line = 100;
const order = async (shop, id, who, name, at, total, lines) => {
  const r = await ingestShopifyOrder(env, shop + ".myshopify.com", { id, ...(name ? { name } : {}), processed_at: at, created_at: at, currency: "GBP", total_price: total,
    email: who + "@example.com", line_items: lines.map(([title, quantity, price]) => ({ id: line++, title, quantity, price })) }, "test:" + id);
  assert.equal(r.status, 200);
};
await order("brindle-co", 5001, "alice", "#1001", "2026-10-12T10:00:00Z", "45.00", [["Merino Wool Scarf", 1, "35.00"], ["Gift Box", 1, "10.00"]]);
await order("brindle-co", 5002, "alice", "#1002", "2026-10-20T10:00:00Z", "60.00", [["Linen Throw", 2, "30.00"]]);
await order("larkspur", 5003, "alice", null, "2026-10-24T23:30:00Z", "20.00", [["Brass Table Lamp", 1, "20.00"]]);
await order("brindle-co", 5004, "alice", "#1004", "2026-11-01T09:00:00Z", "15.00", [["Wool Socks", 1, "15.00"]]);
await order("brindle-co", 5005, "alice", "#1005", "2026-06-01T10:00:00Z", "99.00", [["Old Coat", 1, "99.00"]]); // over 90 days ago
await order("brindle-co", 5101, "bob", "#1101", "2026-10-15T12:00:00Z", "25.00", [["Merino Beanie", 1, "25.00"]]);
await order("brindle-co", 5201, "carol", "#1201", "2026-10-18T12:00:00Z", "30.00", [["Linen Napkins", 4, "7.50"]]);
await order("larkspur", 5301, "dan", null, "2026-10-28T12:00:00Z", "40.00", [["Ceramic Vase", 1, "40.00"]]);
await order("brindle-co", 5401, "eve", "#1401", "2026-10-22T12:00:00Z", "10.00", [["Tea Towel", 1, "10.00"]]);
await order("brindle-co", 5501, "stranger", "#1501", "2026-10-22T12:00:00Z", "12.00", [["Hat", 1, "12.00"]]); // not a Relay shopper
assert.equal(sqlite.prepare("SELECT order_ref FROM retailer_orders WHERE external_order_id = '5001'").get().order_ref, "#1001");

// Inboxes: everyone but Eve (Carol's is her second inbox).
for (const who of ["alice", "bob", "carol", "dan"])
  sqlite.prepare("INSERT INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at, last_scan_at) VALUES (?,?,?,?,?,?)")
    .run(who === "carol" ? ids.carol + "~2" : ids[who], who + ".inbox@example.com", "iv", "d", clock - 30 * 864e5, clock - 600e3);
// What Relay read from their emails.
let n = 0;
const receipt = (who, details, status = "pending") => {
  const id = "00000000-0000-4000-8000-" + String(++n).padStart(12, "0");
  sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)")
    .run(id, ids[who], "m-" + n, status, JSON.stringify({ kind: "receipt", currency: "GBP", confidence: "high", parserVersion: 26, ...details }), clock - 864e5);
  return id;
};
const brindle = { name: "Brindle & Co", domain: "brindle.co.uk" }, larkspur = { name: "Larkspur Home", domain: "larkspur.example" };
receipt("alice", { retailer: brindle, orderRef: "#1001", orderDate: "2026-10-12", totalPence: 4500, items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 3500 }, { name: "Gift Box", qty: 1, pricePence: 1000 }] });
// Read through Shopify's address: the shop's name missed, the shipping missed from the total, the quantity missed.
const rB = receipt("alice", { retailer: { name: "Shopify", domain: "shopifyemail.com" }, orderRef: "1002", orderDate: "2026-10-20", totalPence: 5000, items: [{ name: "Linen Throw", qty: 1, pricePence: 5000 }] });
receipt("alice", { retailer: larkspur, orderRef: null, orderDate: "2026-10-25", totalPence: 2000, items: [{ name: "Brass Table Lamp", qty: 1, pricePence: 2000 }] });
receipt("alice", { retailer: brindle, orderRef: "#1004", orderDate: "2026-11-01", totalPence: 1500, items: [{ name: "Wool Socks" }] }, "dismissed"); // removed as not hers
receipt("bob", { retailer: brindle, orderRef: "#1101", orderDate: "2026-10-15", totalPence: 2500, items: [{ name: "Merino Beanie", qty: 1 }], parserVersion: 25 });
receipt("bob", { retailer: brindle, orderRef: "#1004", orderDate: "2026-11-01", totalPence: 1500, items: [{ name: "Wool Socks" }] }); // Bob's, with Alice's order's number
receipt("carol", { retailer: brindle, orderRef: "#1201", orderDate: "2026-10-10", totalPence: 3000, items: [{ name: "Linen Napkins", qty: 4 }] });
receipt("dan", { retailer: larkspur, orderRef: null, orderDate: "2026-10-28", totalPence: 4000, items: [{ name: "Ceramic Vase" }] });
receipt("dan", { retailer: larkspur, orderRef: null, orderDate: "2026-10-28", totalPence: 1200, items: [{ name: "Candle" }] });
// Alice fixes the total herself: the reader still read it wrong, and that's what's checked.
assert.equal((await call("/relay/my/receipts/" + rB + "/fix", { method: "POST", body: { totalPence: 6000 }, token: tokens.alice })).status, 200);

const res = await call("/relay/my/admin/health", { token: tokens.alice });
assert.equal(res.status, 200);
const h = await res.json(), k = h.checkedByShops;
assert.equal(k.days, ANSWER_KEY_DAYS);
assert.deepEqual([k.orders, k.shoppers, k.withInbox], [8, 5, 7], "the last 90 days' orders that belong to Relay shoppers; Eve has no inbox to look in");
assert.deepEqual([k.found, k.byNumber, k.notFound, k.unsure, k.allRight], [5, 4, 1, 1, 3]);
assert.deepEqual(k.parts, { shop: { right: 4, wrong: 1, missing: 0 }, total: { right: 4, wrong: 1, missing: 0 }, date: { right: 4, wrong: 1, missing: 0 },
  number: { right: 4, wrong: 0, missing: 0 }, items: { right: 4, none: 0, missing: 0, extra: 0, quantity: 1 } });
assert.deepEqual(k.byReader, [{ version: 26, found: 4, allRight: 2 }, { version: 25, found: 1, allRight: 1 }], "each reader version's record, to see a change help or hurt");
console.log("ok - each order is found by its number or its shop and day, and each part checked against the shop's record (the reader's reading, not a fix)");

assert.deepEqual(k.shops, [{ name: "Brindle & Co", people: 3, orders: 5, found: 4, allRight: 2, totalRight: 3, itemsRight: 3 }], "Larkspur has orders from only 2 checked shoppers, so isn't named");
assert.equal(k.mine.orders, 4); assert.equal(k.mine.withInbox, true);
assert.deepEqual([k.mine.found, k.mine.allRight], [3, 2]);
assert.deepEqual(k.mine.differences, [{ shop: "Brindle & Co", day: "2026-10-20", number: "#1002", readerVersion: 26, how: "number", parts: [
  { part: "shop", read: "Shopify", shop: "Brindle & Co" }, { part: "total", read: 5000, shop: 6000 },
  { part: "items", verdict: "quantity", read: 1, shop: 1, missing: [], extra: [] }] }]);
assert.deepEqual(k.mine.notFound, [{ shop: "Brindle & Co", day: "2026-11-01", number: "#1004", unsure: false }],
  "Alice's order isn't found in Bob's inbox (his receipt has the same number) or in a receipt she removed");
const text = JSON.stringify(h);
for (const theirs of ["Merino Beanie", "Linen Napkins", "Ceramic Vase", "Candle", "#1101", "#1201", "Tea Towel", "#1501", "stranger", "bob@", "carol@"])
  assert.ok(!text.includes(theirs), "nothing from anyone else's order or receipt: " + theirs);
console.log("ok - a shop is named only from 3 checked shoppers; only the admin's own orders in detail; nothing crosses between shoppers");

// The morning summary carries the headline, counts only.
emails = [];
assert.equal((await runHealthEmails(env, clock, fetchImpl)).digest, true);
const morning = emails.find((e) => /this morning/.test(e.subject));
assert.match(morning.text, /Checked against shops' own records\n- 5 orders from connected shops found in shoppers' inboxes in the last 90 days; 60% read exactly right\.\n- 1 order wasn't found\./);
for (const s of ["Brindle", "Larkspur", "#100", "Linen", "Shopify"]) assert.ok(!JSON.stringify(morning).includes(s), "the email has counts only: " + s);
console.log("ok - the morning summary carries the headline, counts only");

assert.equal((await call("/relay/my/admin/health", { token: tokens.bob })).status, 404, "admins only");
// Nothing connected yet: an empty part, not an error.
sqlite.exec("DELETE FROM retailer_order_emails");
const empty = (await (await call("/relay/my/admin/health", { token: tokens.alice })).json()).checkedByShops;
assert.deepEqual([empty.orders, empty.found, empty.shops.length, empty.mine.orders], [0, 0, 0, 0]);
console.log("ok - admins only; with no shop orders to check, the part is simply empty");
console.log("PASS shops as the answer key: found by number or shop and day, checked part by part, the reader not a fix, counts only, own orders in detail");
