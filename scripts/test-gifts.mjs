// Offline test (real SQLite): tagging receipts as gifts. A shopper can say a receipt was a present (and who for), change
// their mind, and only ever for their own receipts. Gifts show in the receipts list and in Wrapped, where they count in
// the year's spending but not in "your biggest treat" or the things your style is worked out from. The latest choice for
// an order wins, whichever of its emails it was made on. Who a gift was for is in "Download my data", and goes when the
// receipt is removed as not theirs. Shops and items are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { attachGifts, mergeOrderEmails } from "../worker/gmail.js";

// attachGifts on its own: the newest choice across an order's emails wins; on the same moment, the card's own.
{
  const merged = mergeOrderEmails([
    { id: "a", orderRef: "LK-1", retailer: { name: "Larkspur Home", domain: "larkspur.example" }, status: "confirmed", totalPence: 4000, items: [{ name: "Vase", pricePence: 4000 }], createdAt: 2 },
    { id: "b", orderRef: "LK-1", retailer: { name: "Larkspur Home", domain: "larkspur.example" }, status: "pending", totalPence: null, items: [], createdAt: 1 },
    { id: "c", orderRef: "LK-2", retailer: { name: "Larkspur Home", domain: "larkspur.example" }, totalPence: 900, items: [{ name: "Candle", pricePence: 900 }], createdAt: 3 }]);
  assert.equal(merged.length, 2, "two orders");
  const lk1 = merged.find(o => o.orderRef === "LK-1"), lk2 = merged.find(o => o.orderRef === "LK-2");
  assert.equal(lk1.id, "a", "the fuller email is the one shown");
  assert.deepEqual(lk1.emailIds, ["a", "b"], "the card knows which emails it was made from");
  assert.ok(!Object.keys(lk1).includes("emailIds") && !JSON.stringify(lk1).includes("emailIds"), "...without sending that to the app");
  const run = (rows) => { const os = merged.map(o => { const c = Object.assign(Object.create(null), o); Object.defineProperty(c, "emailIds", { value: o.emailIds, enumerable: false }); return c; }); attachGifts(os, rows); return os; };
  let os = run([{ id: "b", g: 1, who: "Nan", at: 10 }]);
  assert.deepEqual(os[0].gift, { for: "Nan" }, "a choice made on another email of the order counts");
  os = run([{ id: "b", g: 1, who: "Nan", at: 10 }, { id: "a", g: 0, who: null, at: 11 }]);
  assert.equal(os[0].gift, undefined, "a later 'not a gift' on the card wins");
  os = run([{ id: "b", g: 1, who: "Nan", at: 12 }, { id: "a", g: 0, who: null, at: 11 }]);
  assert.deepEqual(os[0].gift, { for: "Nan" }, "a later 'gift' on the other email wins");
  os = run([{ id: "b", g: 1, who: "Nan", at: 11 }, { id: "a", g: 0, who: null, at: 11 }]);
  assert.equal(os[0].gift, undefined, "at the same moment, the card's own choice wins");
  os = run([{ id: "c", g: 1, who: "", at: 5 }]);
  assert.deepEqual(os[1].gift, { for: null }, "a gift for nobody in particular");
  assert.equal(os[0].gift, undefined);
  console.log("ok - gifts follow the order: the latest choice on any of its emails wins");
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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key" };
let emails = [];
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  return new Response("{}", { status: 404 });
};
let clock = Date.UTC(2026, 10, 4, 9);
const call = (path, { method = "GET", body, token, ip = "1.1.1.1", raw } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: raw != null ? raw : body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const alice = await signIn("alice@example.com", "5.5.5.5");
const bob = await signIn("bob@example.com", "6.6.6.6");
const idOf = email => sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id;
const A = idOf("alice@example.com");
assert.equal((await call("/relay/my/receipts", { token: alice })).status, 200); // makes the receipt tables

// Alice's year: a scarf and a vase she gave away, a coat for herself, a food shop, and an order that came as two emails.
const R = {
  scarf: "11111111-1111-4111-8111-111111111111", vase: "22222222-2222-4222-8222-222222222222", coat: "33333333-3333-4333-8333-333333333333",
  food: "44444444-4444-4444-8444-444444444444", lampA: "55555555-5555-4555-8555-555555555555", lampB: "66666666-6666-4666-8666-666666666666",
  mug: "77777777-7777-4777-8777-777777777777"
};
const add = (id, ref, status, details, at) => sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)")
  .run(id, A, ref, status, JSON.stringify({ kind: "purchase", currency: "GBP", ...details }), at);
add(R.scarf, "m-scarf", "confirmed", { retailer: { name: "Brindle & Co", domain: "brindle.example" }, orderRef: "BR-100", orderDate: "2026-03-14", totalPence: 4500,
  items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 4500, variant: "Forest Green" }] }, 1);
add(R.vase, "m-vase", "confirmed", { retailer: { name: "Larkspur Home", domain: "larkspur.example" }, orderRef: "LK-200", orderDate: "2026-10-20", totalPence: 32000,
  items: [{ name: "Hand-thrown Ceramic Vase", qty: 1, pricePence: 32000 }] }, 2);
add(R.coat, "m-coat", "confirmed", { retailer: { name: "Brindle & Co", domain: "brindle.example" }, orderRef: "BR-101", orderDate: "2026-09-02", totalPence: 18000,
  items: [{ name: "Waxed Cotton Jacket", qty: 1, pricePence: 18000, variant: "Navy" }] }, 3);
add(R.food, "m-food", "confirmed", { retailer: { name: "Fennel Kitchen", domain: "fennel.example" }, orderRef: "FK-9", orderDate: "2026-06-05", totalPence: 2350,
  items: [{ name: "Sourdough loaf", qty: 1, pricePence: 450 }, { name: "Oat milk", qty: 2, pricePence: 950 }, { name: "Free range eggs", qty: 1, pricePence: 950 }] }, 4);
add(R.lampA, "m-lamp-a", "confirmed", { retailer: { name: "Larkspur Home", domain: "larkspur.example" }, orderRef: "LK-300", orderDate: "2026-10-25", totalPence: 6000,
  items: [{ name: "Brass Table Lamp", qty: 1, pricePence: 6000 }] }, 5);
add(R.lampB, "m-lamp-b", "pending", { retailer: { name: "Larkspur Home", domain: "larkspur.example" }, orderRef: "LK-300", orderDate: "2026-10-25", totalPence: null, items: [] }, 6);
add(R.mug, "m-mug", "confirmed", { retailer: { name: "Larkspur Home", domain: "larkspur.example" }, orderRef: "LK-400", orderDate: "2026-10-28", totalPence: 1200,
  items: [{ name: "Stoneware Mug", qty: 1, pricePence: 1200 }] }, 7);

const list = async (token = alice) => (await (await call("/relay/my/receipts?all=1", { token })).json()).receipts;
const card = (cards, id) => cards.find(c => c.id === id);
const gift = (id, body, token = alice) => { clock += 1000; return call("/relay/my/receipts/" + id + "/gift", { method: "POST", body, token }); };

// Tagging, naming, changing the name, untagging.
let res = await gift(R.scarf, { gift: true, for: "  Mum  " });
assert.equal(res.status, 200); assert.deepEqual((await res.json()).gift, { for: "Mum" }, "the name is tidied");
assert.deepEqual(card(await list(), R.scarf).gift, { for: "Mum" }, "the list shows it's a gift for Mum");
assert.equal(card(await list(), R.coat).gift, undefined, "other receipts aren't gifts");
assert.equal((await gift(R.vase, { gift: true, for: "Sam" })).status, 200);
assert.equal((await gift(R.vase, { gift: true, for: "Sam and Priya" })).status, 200);
assert.deepEqual(card(await list(), R.vase).gift, { for: "Sam and Priya" }, "the name can change");
assert.equal((await gift(R.mug, { gift: true })).status, 200);
assert.deepEqual(card(await list(), R.mug).gift, { for: null }, "a gift doesn't have to say who for");
assert.equal((await gift(R.mug, { gift: false })).status, 200);
assert.equal(card(await list(), R.mug).gift, undefined, "not a gift any more");
assert.deepEqual({ ...sqlite.prepare("SELECT is_gift AS g, recipient FROM receipt_gifts WHERE receipt_id = ?").get(R.mug) }, { g: 0, recipient: null }, "'not a gift' keeps no name");
assert.equal((await gift(R.mug, { gift: false, for: "Ignored" })).status, 200);
assert.equal(sqlite.prepare("SELECT recipient FROM receipt_gifts WHERE receipt_id = ?").get(R.mug).recipient, null, "a name sent with 'not a gift' isn't kept");
console.log("ok - a receipt can be tagged as a gift, for someone or no one in particular, renamed and untagged");

// An order that came as two emails: the choice follows the order, whichever email it was made on.
assert.equal(card(await list(), R.lampA).gift, undefined);
assert.equal((await gift(R.lampB, { gift: true, for: "Dad" })).status, 200, "the other email of the order is Alice's too");
let cards = await list();
assert.equal(card(cards, R.lampB), undefined, "the order is one card");
assert.deepEqual(card(cards, R.lampA).gift, { for: "Dad" }, "tagged on its other email, the order is a gift");
assert.equal((await gift(R.lampA, { gift: false })).status, 200);
assert.equal(card(await list(), R.lampA).gift, undefined, "untagging the card wins over the older choice");
assert.equal((await gift(R.lampA, { gift: true, for: "Dad" })).status, 200);
assert.deepEqual(card(await list(), R.lampA).gift, { for: "Dad" });
console.log("ok - an order's latest choice wins, whichever of its emails it was made on");

// Only for the shopper's own receipts, and only what the route takes.
assert.equal((await gift(R.coat, { gift: true, for: "Bob" }, bob)).status, 404, "bob can't tag alice's receipt");
assert.equal(card(await list(), R.coat).gift, undefined, "...and it isn't tagged");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_gifts WHERE receipt_id = ? OR shopper_id = ?").get(R.coat, idOf("bob@example.com")).n, 0, "nothing was saved for anyone");
assert.ok(!JSON.stringify(await list(bob)).includes("Mum"), "bob's list shows none of alice's gifts");
assert.equal((await gift("99999999-9999-4999-8999-999999999999", { gift: true })).status, 404, "a receipt that doesn't exist");
assert.equal((await call("/relay/my/receipts/" + R.coat + "/gift", { method: "POST", body: { gift: true } })).status, 401, "signed in only");
for (const bad of [{ gift: "yes" }, {}, { gift: true, for: 7 }, { gift: true, for: "x".repeat(41) }, { gift: true, extra: 1 }]) {
  const r = await gift(R.coat, bad);
  assert.equal(r.status, 400, "refused: " + JSON.stringify(bad).slice(0, 60));
}
assert.equal((await gift(R.coat, { gift: true, for: "Mu‮m" })).status, 200);
assert.deepEqual(card(await list(), R.coat).gift, { for: "Mum" }, "characters that flip text direction are taken out of the name");
assert.equal((await gift(R.coat, { gift: false })).status, 200);
console.log("ok - only the shopper's own receipts, only a yes/no and a name of up to 40 characters");

// Wrapped: gifts on their own, counted in the year's spending, but not as your treat or your style.
const w = await (await call("/relay/my/wrapped?year=2026", { token: alice })).json();
assert.ok(w.gifts, "Wrapped has a gifts part");
assert.equal(w.gifts.count, 3, "the scarf, the vase and the lamp");
assert.equal(w.gifts.spentPence, 4500 + 32000 + 6000);
assert.equal(w.gifts.withTotal, 3);
assert.equal(w.gifts.named, 3, "all three say who they were for");
assert.deepEqual(w.gifts.people.map(p => p.name).sort(), ["Dad", "Mum", "Sam and Priya"]);
assert.equal(w.gifts.busiestMonth, "Oct", "two of them in October");
assert.equal(w.gifts.share, Math.round(42500 / w.spentPence * 100), "their share of the year");
assert.equal(w.gifts.list[0].item, "Hand-thrown Ceramic Vase", "biggest gift first");
assert.equal(w.gifts.list[0].for, "Sam and Priya");
assert.equal(w.gifts.list[0].totalPence, 32000);
assert.ok(w.spentPence >= 4500 + 32000 + 6000 + 18000 + 2350 + 1200, "gifts still count in the year's spending");
assert.ok(w.biggest && w.biggest.totalPence === 18000 && /Jacket/.test(w.biggest.item || ""), "your biggest treat is the jacket, not the vase you gave away: " + JSON.stringify(w.biggest));
const things = (w.things || []).map(t => t.name).join("|");
assert.ok(/Jacket/.test(things), "your own things shape your style");
assert.ok(!/Scarf|Vase|Lamp/.test(things), "gifts don't: " + things);
assert.ok((w.badges || []).some(b => b.label === "The Gift Giver" && /3 of your orders/.test(b.why)), "three gifts earn the badge");
const w25 = await (await call("/relay/my/wrapped?year=2025", { token: alice })).json();
assert.equal(w25.gifts, null, "a year with no gifts has no gifts part");
console.log("ok - Wrapped: 3 gifts, " + w.gifts.people.length + " people, their share of the year, a badge; not the biggest treat, not the style");

// A gift for someone else, and "not a gift" choices, are in Download my data; removing a receipt as not theirs takes its gift too.
const exp = await (await call("/relay/my/export", { token: alice })).json();
const g = exp.yourChoices.gifts;
assert.ok(g.some(x => x.receiptId === R.scarf && x.gift === true && x.for === "Mum" && /^2026-11-04T/.test(x.changedAt)), "the scarf for Mum is in the file");
assert.ok(g.some(x => x.receiptId === R.mug && x.gift === false && x.for === null), "so is the choice that the mug wasn't a gift");
assert.equal((await call("/relay/my/receipts/" + R.scarf + "/dismiss", { method: "POST", body: {}, token: alice })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_gifts WHERE receipt_id = ?").get(R.scarf).n, 0, "a receipt that isn't theirs takes who it was for with it");
assert.equal((await gift(R.scarf, { gift: true, for: "Mum" })).status, 404, "a removed receipt can't be tagged");
console.log("ok - gifts are in Download my data, and go when the receipt is removed");
console.log("PASS gifts: tag, name, untag, own receipts only, the order's latest choice, Wrapped, export and removal");
