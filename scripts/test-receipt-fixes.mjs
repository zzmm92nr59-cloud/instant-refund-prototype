// Offline test (real SQLite): "Fix this receipt". A shopper corrects the shop, total, date or items of a receipt Relay
// read wrong; their words show instead of what was read (in the list and in Wrapped), fixes add up, "Go back to what Relay
// read" undoes them, only their own receipts, only sensible values; the fix is in Download my data and goes with the
// receipt; the Relay health page counts which parts were fixed and where. Shops and items are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { attachFixes, cleanFix } from "../worker/gmail.js";

// The checks on what's typed.
{
  assert.deepEqual(cleanFix({ shop: "  Brindle   & Co ", totalPence: 4599 }, "2026-11-05"), { shop: "Brindle & Co", totalPence: 4599 });
  assert.deepEqual(cleanFix({ items: [{ name: " Wool  Scarf ", pricePence: 2500 }, { name: "Gift box" }] }, "2026-11-05"),
    { items: [{ name: "Wool Scarf", qty: 1, pricePence: 2500 }, { name: "Gift box", qty: 1, pricePence: null }] });
  assert.deepEqual(cleanFix({ items: [] }, "2026-11-05"), { items: [] }, "an order with no items listed");
  for (const bad of [{}, { shop: "" }, { shop: "x".repeat(81) }, { totalPence: -1 }, { totalPence: 12.5 }, { totalPence: 100000001 }, { orderDate: "2026-11-06" },
    { orderDate: "2026-02-30" }, { orderDate: "1999-12-31" }, { orderDate: "4 Nov" }, { items: [{ name: "" }] }, { items: [{ name: "A", qty: 0 }] },
    { items: [{ name: "A", pricePence: -5 }] }, { items: Array.from({ length: 51 }, () => ({ name: "A" })) }, { shop: 7 }])
    assert.equal(cleanFix(bad, "2026-11-05"), null, "refused: " + JSON.stringify(bad).slice(0, 50));
  // The latest fix across an order's emails wins.
  const card = { id: "a", retailer: { name: "Read Wrong Ltd", domain: "brindle.example" }, totalPence: null, items: [{ name: "Thing" }] };
  Object.defineProperty(card, "emailIds", { value: ["a", "b"], enumerable: false });
  attachFixes([card], [{ id: "b", fields: JSON.stringify({ totalPence: 1000 }), at: 1 }, { id: "a", fields: JSON.stringify({ shop: "Brindle", totalPence: 1200 }), at: 2 }]);
  assert.deepEqual([card.retailer.name, card.totalPence, card.fixed], ["Brindle", 1200, { shop: true, total: true }]);
  console.log("ok - only sensible values, and an order's latest fix wins");
}

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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "alice@example.com" };
let emails = [];
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  return new Response("{}", { status: 404 });
};
let clock = Date.UTC(2026, 10, 4, 9);
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const alice = await signIn("alice@example.com", "5.5.5.5");
const bob = await signIn("bob@example.com", "6.6.6.6");
const A = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("alice@example.com").id;
await call("/relay/my/receipts", { token: alice });
const R1 = "11111111-1111-4111-8111-111111111111", R2 = "22222222-2222-4222-8222-222222222222";
const add = (id, ref, details) => sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)")
  .run(id, A, ref, "pending", JSON.stringify({ kind: "receipt", currency: "GBP", confidence: "low", parserVersion: 26, ...details }), 1);
// Read wrong: the payment company's name instead of the shop's, no total, a line that isn't an item.
add(R1, "m-1", { retailer: { name: "Payments Ltd", domain: "brindle.example" }, orderRef: "BR-1", orderDate: "2026-10-12", totalPence: null,
  items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 4500 }, { name: "Gift wrap service", qty: 1, pricePence: 0 }] });
add(R2, "m-2", { retailer: { name: "Larkspur Home", domain: "larkspur.example" }, orderRef: "LK-2", orderDate: "2026-10-20", totalPence: 6000,
  items: [{ name: "Brass Table Lamp", qty: 1, pricePence: 6000 }] });
sqlite.prepare("INSERT INTO receipt_item_marks (shopper_id, receipt_id, item_index, status, updated_at) VALUES (?,?,?,?,?)").run(A, R1, 1, "returning", 1);
const list = async (token = alice) => (await (await call("/relay/my/receipts?all=1", { token })).json()).receipts;
const card = async (id) => (await list()).find(c => c.id === id);
const fix = (id, body, token = alice) => { clock += 1000; return call("/relay/my/receipts/" + id + "/fix", { method: "POST", body, token }); };

// Fix the shop and the total, then the items and the date: fixes add up.
let r = await fix(R1, { shop: "Brindle & Co", totalPence: 4500 });
assert.equal(r.status, 200);
let c = await card(R1);
assert.deepEqual([c.retailer.name, c.retailer.domain, c.totalPence, c.fixed], ["Brindle & Co", "brindle.example", 4500, { shop: true, total: true }]);
r = await fix(R1, { items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 4500 }], orderDate: "2026-10-11" });
assert.equal(r.status, 200);
c = await card(R1);
assert.deepEqual([c.retailer.name, c.totalPence, c.orderDate, c.items.map(i => i.name), c.fixed],
  ["Brindle & Co", 4500, "2026-10-11", ["Merino Wool Scarf"], { shop: true, total: true, date: true, items: true }], "the earlier fixes are kept");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_item_marks WHERE receipt_id = ?").get(R1).n, 0, "new items: the old item marks no longer line up, so they go");
const row = { ...sqlite.prepare("SELECT domain, reader, shop, total, date, items FROM receipt_fixes WHERE receipt_id = ?").get(R1) };
assert.deepEqual(row, { domain: "brindle.example", reader: 26, shop: 1, total: 1, date: 1, items: 1 }, "which parts were wrong, at which shop, by which reader");
const w = await (await call("/relay/my/wrapped?year=2026", { token: alice })).json();
assert.equal(w.spentPence, 4500 + 6000, "Wrapped adds up the fixed total");
assert.ok(w.topShops.some(s => s.name === "Brindle & Co"), "and uses the fixed shop name");
console.log("ok - shop, total, date and items fixed, in the list and in Wrapped; fixes add up");

// Only the shopper's own receipts; only sensible values.
assert.equal((await fix(R2, { totalPence: 1 }, bob)).status, 404, "bob can't fix alice's receipt");
assert.equal((await card(R2)).totalPence, 6000);
assert.equal((await call("/relay/my/receipts/" + R2 + "/fix", { method: "POST", body: { totalPence: 1 } })).status, 401);
for (const bad of [{}, { totalPence: -5 }, { orderDate: "2026-12-25" }, { shop: "" }, { items: [{ name: "x".repeat(121) }] }, { colour: "red" }])
  assert.equal((await fix(R2, bad)).status, 400, "refused: " + JSON.stringify(bad));
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_fixes WHERE receipt_id = ?").get(R2).n, 0, "nothing saved");
console.log("ok - only the shopper's own receipts, and only sensible values");

// The health page counts it.
const h = await (await call("/relay/my/admin/health", { token: alice })).json();
assert.deepEqual([h.reading.fixedByShoppers.receipts, h.reading.fixedByShoppers.total, h.reading.fixedByShoppers.items, h.reading.fixedByShoppers.people], [1, 1, 1, 1]);
assert.equal(h.mine.shops.find(s => s.domain === "brindle.example").fixed, 1, "the admin's own fixes by shop");
assert.equal(h.shops.length, 0, "no shop is named: fewer than 3 people");
console.log("ok - the Relay health page counts which parts were fixed and where");

// Download my data, undo, and removal.
const exp = await (await call("/relay/my/export", { token: alice })).json();
assert.ok(exp.yourChoices.fixes.some(f => f.receiptId === R1 && f.corrected.shop === "Brindle & Co" && f.corrected.totalPence === 4500), "the fix is in the file");
assert.equal((await fix(R1, { undo: true })).status, 200);
c = await card(R1);
assert.deepEqual([c.totalPence, c.fixed, c.items.length], [null, undefined, 2], "back to what Relay read");
assert.equal((await fix(R2, { shop: "Larkspur" })).status, 200);
assert.equal((await call("/relay/my/receipts/" + R2 + "/dismiss", { method: "POST", body: {}, token: alice })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_fixes WHERE receipt_id = ?").get(R2).n, 0, "a receipt removed as not theirs takes its fix with it");
assert.equal((await fix(R2, { shop: "Larkspur" })).status, 404, "and can't be fixed any more");
console.log("ok - in Download my data; undo goes back to what was read; removing the receipt removes the fix");
console.log("PASS fix this receipt: shop, total, date and items, own receipts only, sensible values, Wrapped, health counts, export, undo and removal");
