// Offline test (real SQLite): "Same order as another receipt" and "These are different orders" (worker/order-joins.js), and
// the Relay health page's "Likely reading problems" (worker/health.js). A shopper can join two of their own cards into one
// (the fuller email leads) or split a card the reader joined, undo either, and the choice survives every re-read; only for
// their own receipts; bodies are checked. The health counts are by shop, counts only, for Relay's team only. Shops, items,
// prices and numbers are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { joinPlan, sameOrderCandidates } from "../worker/order-joins.js";
import { mergeOrderEmails, PARSER_VERSION } from "../worker/gmail.js";

// The plan on its own: one join, one split, and a split then joined back.
{
  const shop = (d) => ({ name: d, domain: d + ".example" });
  const rows = [
    { id: "e1", retailer: shop("tansy"), orderRef: null, totalPence: 1000, items: [{ name: "Jar", pricePence: 1000 }], createdAt: 1 },
    { id: "e2", retailer: shop("tansy"), orderRef: null, totalPence: 1000, items: [], createdAt: 2 },
    { id: "e3", retailer: shop("ombra"), orderRef: "OM-1", totalPence: 500, items: [{ name: "Cup", pricePence: 500 }], createdAt: 3 },
    { id: "e4", retailer: shop("ombra"), orderRef: "OM-1", totalPence: 500, items: [], createdAt: 4 }];
  const once = mergeOrderEmails(rows);
  assert.equal(once.length, 3, "the reader: e1, e2 apart (no number), e3+e4 one order");
  assert.equal(joinPlan(once, []), null, "no choices, nothing to do");
  let plan = joinPlan(once, [{ a: "e1", b: "e2", kind: "same" }]);
  let again = mergeOrderEmails(rows, { keyFor: (o) => plan.keys.get(o.id) });
  assert.equal(again.length, 2, "joined"); assert.equal(again.find((c) => c.emailIds && c.emailIds.includes("e2")).id, "e1", "the fuller email leads");
  plan = joinPlan(once, [{ a: "e3", b: "e4", kind: "apart" }]);
  again = mergeOrderEmails(rows, { keyFor: (o) => plan.keys.get(o.id) });
  assert.equal(again.length, 4, "split");
  plan = joinPlan(once, [{ a: "e3", b: "e4", kind: "apart" }, { a: "e1", b: "e3", kind: "same" }]);
  again = mergeOrderEmails(rows, { keyFor: (o) => plan.keys.get(o.id) });
  assert.equal(again.length, 3, "e1 with e3, e4 on its own, e2 on its own");
  assert.ok(again.some((c) => c.emailIds && c.emailIds.includes("e1") && c.emailIds.includes("e3") && !c.emailIds.includes("e4")));
  assert.deepEqual(joinPlan(once, [{ a: "zz", b: "e1", kind: "same" }]), null, "a choice about an email that's gone does nothing");
  console.log("ok - the plan: joins two cards, splits one, and a split can be joined to something else");
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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "boss@example.com" };
let emails = [];
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  return new Response("{}", { status: 404 });
};
let clock = Date.UTC(2026, 10, 18, 9);
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
const cara = await signIn("cara@example.com", "7.7.7.7");
const boss = await signIn("boss@example.com", "8.8.8.8");
const idOf = email => sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id;
const [A, B, C, BOSS] = ["alice", "bob", "cara", "boss"].map((x) => idOf(x + "@example.com"));
assert.equal((await call("/relay/my/receipts", { token: alice })).status, 200); // makes the receipt tables

const U = (n) => (String(n).repeat(8) + "-" + String(n).repeat(4) + "-4" + String(n).repeat(3) + "-8" + String(n).repeat(3) + "-" + String(n).repeat(12)).slice(0, 36);
const R = { potA: U(1), potB: U(2), bookA: U(3), bookB: U(4), mug: U(5), far: U(6), bobs: U(7), payA: U(8), shopA: U(9) };
const add = (id, who, ref, details, at, status = "pending") => sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)")
  .run(id, who, ref, status, JSON.stringify({ kind: "receipt", currency: "GBP", parserVersion: PARSER_VERSION, ...details }), at);
const POT = { name: "Fernhill Pottery", domain: "fernhill.example" }, BOOKS = { name: "Quillbrook Books", domain: "quillbrook.example" };
// Two emails of one pottery order, neither with an order number: the reader leaves them as two cards.
add(R.potA, A, "m-pot-a", { retailer: POT, orderRef: null, orderDate: "2026-11-10", totalPence: 2400, items: [{ name: "Speckled Bowl", qty: 2, pricePence: 1200 }],
  itemsCheck: { complete: true, itemsPence: 2400 } }, 1);
add(R.potB, A, "m-pot-b", { retailer: POT, orderRef: null, orderDate: "2026-11-10", totalPence: 2400, items: [] }, 2);
// Two different book orders the reader joined (the shop used the same number twice).
add(R.bookA, A, "m-book-a", { retailer: BOOKS, orderRef: "QB-7781", orderDate: "2026-11-02", totalPence: 1599, items: [{ name: "The Salt Road", qty: 1, pricePence: 1599 }] }, 3);
add(R.bookB, A, "m-book-b", { retailer: BOOKS, orderRef: "QB-7781", orderDate: "2026-11-12", totalPence: 899, items: [{ name: "Night Garden Atlas", qty: 1, pricePence: 899 }] }, 4);
add(R.mug, A, "m-mug", { retailer: POT, orderRef: "FP-2", orderDate: "2026-11-11", totalPence: 1800, items: [{ name: "Tall Mug", qty: 1, pricePence: 1800 }] }, 5);
add(R.far, A, "m-far", { retailer: POT, orderRef: "FP-1", orderDate: "2026-03-01", totalPence: 2400, items: [{ name: "Planter", qty: 1, pricePence: 2400 }] }, 6);
add(R.bobs, B, "m-bob", { retailer: POT, orderRef: null, orderDate: "2026-11-10", totalPence: 2400, items: [{ name: "Speckled Bowl", qty: 2, pricePence: 1200 }] }, 7);

const list = async (token = alice) => (await (await call("/relay/my/receipts?all=1", { token })).json()).receipts;
const cardWith = (cards, id) => cards.find((c) => c.id === id || (c.alsoEmails || []).some((e) => e.id === id));
const join = (id, body, token = alice) => { clock += 1000; return call("/relay/my/receipts/" + id + "/join", { method: body ? "POST" : "GET", body, token }); };

let cards = await list();
assert.equal(cards.length, 5, "five cards: two for the pottery order, one for both book orders, the mug, the planter");
assert.ok(cardWith(cards, R.bookA).alsoEmails.some((e) => e.id === R.bookB), "the book card says it's made of two emails");

// The short list of likely others: the same shop, close days, the same money. Never itself, never the far-off planter.
let res = await join(R.potA);
assert.equal(res.status, 200);
const cands = (await res.json()).candidates;
assert.equal(cands[0].id, R.potB, "the other pottery email comes first");
assert.ok(!cands.some((c) => c.id === R.potA), "never itself"); assert.ok(!cands.some((c) => c.id === R.far), "never one months away");
assert.ok(!cands.some((c) => c.id === R.bookA), "never another shop with nothing in common");
assert.ok(!JSON.stringify(cands).includes("orderRef") && !JSON.stringify(cands).includes("bob"), "only what the list needs");
assert.deepEqual(sameOrderCandidates({ id: "x", retailer: POT, orderDate: "2026-11-10", totalPence: 1 }, []), []);
console.log("ok - the short list: the other email of the order first, never itself, another shop or a far-off day");

// Same order: one card, the fuller email leading, the other part of it.
res = await join(R.potB, { action: "same", with: R.potA });
assert.equal(res.status, 200);
cards = await list();
assert.equal(cards.length, 4, "the two pottery cards are one");
let pot = cardWith(cards, R.potB);
assert.equal(pot.id, R.potA, "the fuller receipt leads"); assert.equal(pot.totalPence, 2400); assert.equal(pot.items.length, 1);
assert.equal(pot.joinedByYou, true); assert.deepEqual(pot.alsoEmails.map((e) => e.id), [R.potB], "the other email is part of it");
const row = sqlite.prepare("SELECT * FROM receipt_joins WHERE shopper_id = ?").get(A);
assert.equal(row.kind, "same"); assert.equal(row.domain, "fernhill.example"); assert.equal(row.reader, PARSER_VERSION);
assert.ok(!Object.values(row).some((v) => /Speckled|2400|Bowl/.test(String(v))), "the choice keeps nothing from the email");
// A double tap does nothing twice.
assert.equal((await join(R.potB, { action: "same", with: R.potA })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_joins WHERE shopper_id = ?").get(A).n, 1, "one choice, not two");
assert.equal((await join(R.potA, { action: "same", with: R.potB })).status, 200, "already one card: fine, nothing more");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_joins WHERE shopper_id = ?").get(A).n, 1, "still one choice");
console.log("ok - same order: two cards become one, the fuller leads, the other's email is part of it, kept once");

// Every email read again by a new reader (it re-reads all of them when its version changes), now reading the second email
// more fully: still one card.
sqlite.prepare("UPDATE captured_receipts SET details = json_set(details, '$.parserVersion', 999, '$.items', json('[{\"name\":\"Speckled Bowl\",\"qty\":2,\"pricePence\":1200},{\"name\":\"Gift Wrap\",\"qty\":1,\"pricePence\":0}]'), '$.itemsCheck', json('{\"complete\":true,\"itemsPence\":2400}')) WHERE id = ?").run(R.potB);
sqlite.prepare("UPDATE captured_receipts SET details = json_set(details, '$.parserVersion', 999) WHERE shopper_id = ?").run(A);
cards = await list();
assert.equal(cards.length, 4, "still one card after every email is read again");
pot = cardWith(cards, R.potA);
assert.ok(pot && pot.emailIds === undefined && pot.joinedByYou, "the choice is still applied");
assert.equal(pot.id, R.potB, "the fuller email (now the second) leads");
console.log("ok - the choice survives every email being read again, even when another email becomes the fuller one");

// Different orders: the joined book card splits; undo puts it back.
res = await join(R.bookA, { action: "apart" });
assert.equal(res.status, 200);
cards = await list();
assert.equal(cards.length, 5, "the book card is two");
assert.ok(cards.find((c) => c.id === R.bookA).splitByYou && cards.find((c) => c.id === R.bookB).splitByYou, "both say they were kept apart");
assert.equal(cards.find((c) => c.id === R.bookA).alsoEmails, undefined, "each is its own email");
assert.equal((await join(R.bookA, { action: "apart" })).status, 409, "a card of one email can't be split");
sqlite.prepare("UPDATE captured_receipts SET details = json_set(details, '$.parserVersion', 1000) WHERE shopper_id = ?").run(A);
assert.equal((await list()).length, 5, "and stays apart after a re-read, though the reader would join them");
assert.equal((await join(R.bookB, { action: "undo", kind: "apart" })).status, 200);
cards = await list();
assert.equal(cards.length, 4, "undone: the reader's card again"); assert.ok(!cardWith(cards, R.bookA).splitByYou);
// Undo "same order".
assert.equal((await join(R.potA, { action: "undo", kind: "same" })).status, 200);
cards = await list();
assert.equal(cards.length, 5, "undone: the two pottery cards again"); assert.ok(!cards.some((c) => c.joinedByYou));
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_joins WHERE shopper_id = ?").get(A).n, 0, "nothing left");
console.log("ok - different orders: a joined card splits, stays split after a re-read, and both choices can be undone");

// Only the shopper's own receipts, only what the route takes.
assert.equal((await join(R.potA, { action: "same", with: R.bobs })).status, 404, "alice can't join bob's receipt to hers");
assert.equal((await join(R.bobs, { action: "same", with: R.potA }, alice)).status, 404, "or start from it");
assert.equal((await join(R.potA, { action: "same", with: R.bobs }, bob)).status, 404, "bob can't join alice's to his");
assert.equal((await join(R.bookA, { action: "apart" }, bob)).status, 404, "or split hers");
assert.equal((await join(R.potA, undefined, bob)).status, 404, "or see her short list");
assert.equal((await join(R.potA, undefined, null)).status, 401, "signed in only");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_joins").get().n, 0, "nothing was saved");
assert.equal((await list()).length, 5, "alice's list is as it was");
assert.ok(!JSON.stringify(await list(bob)).includes("Quillbrook"), "bob's list shows none of hers");
for (const bad of [{ action: "merge" }, { action: "same" }, { action: "same", with: "not-an-id" }, { action: "same", with: R.potB, extra: 1 }, { action: "undo" }, { action: "undo", kind: "both" }, { action: 1 }]) {
  const r = await join(R.potA, bad);
  assert.equal(r.status, 400, "refused: " + JSON.stringify(bad));
}
assert.equal((await join(R.potA, { action: "same", with: "99999999-9999-4999-8999-999999999999" })).status, 404, "a receipt that doesn't exist");
console.log("ok - only the shopper's own receipts (anyone else's is 'not found'), and only the fields the route takes");

// The health page's likely reading problems: by shop, counts only, team only.
// Fernhill: alice's two same-day £24 receipts with no number (and a PayPal receipt beside a shop receipt), bob's and cara's.
add(R.payA, A, "m-pay-a", { retailer: { name: "Fernhill Pottery", domain: null, via: "paypal.example" }, orderRef: null, orderDate: "2026-11-14", totalPence: 3150, sentAt: "2026-11-14T10:00:00.000Z", items: [] }, 8);
add(R.shopA, A, "m-shop-a", { retailer: POT, orderRef: null, orderDate: "2026-11-14", totalPence: 3150, sentAt: "2026-11-14T10:04:00.000Z", items: [{ name: "Jug", qty: 1, pricePence: 2900 }],
  itemsCheck: { complete: false, itemsPence: 2900 } }, 9);
add(U("a"), C, "m-cara", { retailer: POT, orderRef: "FP-9", orderDate: "2026-11-01", totalPence: null, items: [] }, 10);
add(U("b"), C, "m-cara-2", { retailer: BOOKS, orderRef: "QB-1", orderDate: "2026-11-01", totalPence: 500, items: [] }, 11);
add(U("c"), BOSS, "m-boss", { retailer: { name: "Wrenfold Tea", domain: "wrenfold.example" }, orderRef: null, orderDate: "2026-11-05", totalPence: 700, items: [] }, 12);
assert.equal((await join(R.potA, { action: "same", with: R.potB })).status, 200);
assert.equal((await join(R.bobs, { action: "apart" }, bob)).status, 409, "bob's single card can't be split (and nothing is counted)");
assert.equal((await call("/relay/my/admin/health", { token: alice })).status, 404, "a shopper who isn't on the team gets 'not found'");
const h = await (await call("/relay/my/admin/health", { token: boss })).json();
const rp = h.readingProblems;
assert.ok(rp, "the part is there");
const fern = rp.shops.find((s) => s.domain === "fernhill.example");
assert.ok(fern, "Fernhill is named: three shoppers have receipts from it");
assert.equal(fern.people, 3);
assert.equal(fern.receipts, 7, "alice 5, bob 1, cara 1");
assert.equal(fern.sameTotalNoNumber, 2, "alice's two same-day £24.00 with no order number (bob's is another shopper's, so not hers twice)");
assert.equal(fern.paymentBeside, 1, "the shop receipt with the PayPal receipt for the same money four minutes apart");
assert.equal(fern.duplicates, 3);
assert.equal(fern.notAddingUp, 1); assert.equal(fern.noTotal, 1); assert.equal(fern.noNumber, 4);
assert.equal(fern.saidSame, 1, "one shopper said 'same order'"); assert.equal(fern.saidApart, 0);
assert.ok(!rp.shops.some((s) => s.domain === "quillbrook.example"), "Quillbrook isn't named: only two shoppers");
assert.equal(rp.others.shops >= 1, true); assert.ok(rp.others.receipts >= 3, "its counts go in with the other shops");
assert.ok(rp.mine.some((s) => s.domain === "wrenfold.example" && s.noNumber === 1), "the admin's own receipts, by shop, with no minimum");
const text = JSON.stringify(rp);
for (const secret of ["alice", "bob@", "cara", A, B, C, "QB-7781", "FP-9", "Speckled", "Jug", "2400", "3150"]) assert.ok(!text.includes(secret), "nothing personal: " + secret);
console.log("ok - likely reading problems by shop: duplicates both ways, items not adding up, no number, no total, shoppers' choices; counts only, team only");

// Quick with thousands of receipts in an account: 3,500 of cara's, a choice of hers, the list and the health page.
{
  const ins = sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)");
  sqlite.exec("BEGIN");
  for (let i = 0; i < 3500; i++) {
    const shop = ["fernhill", "quillbrook", "wrenfold", "tansy", "ombra"][i % 5];
    const d = new Date(Date.UTC(2023, 0, 1) + (i % 1000) * 864e5).toISOString().slice(0, 10);
    ins.run("f" + String(i).padStart(7, "0") + "-0000-4000-8000-000000000000", C, "m-bulk-" + i, "pending", JSON.stringify({ kind: "receipt", currency: "GBP", parserVersion: PARSER_VERSION,
      retailer: { name: shop, domain: shop + ".example" }, orderRef: i % 3 ? "B-" + (i % 700) : null, orderDate: d, totalPence: 500 + (i % 40) * 25, sentAt: d + "T10:00:00.000Z",
      items: [{ name: "Thing " + (i % 50), qty: 1, pricePence: 500 }], itemsCheck: { complete: i % 7 !== 0, itemsPence: 500 } }), i);
  }
  sqlite.exec("COMMIT");
  const all = await list(cara);
  const two = all.filter((c) => c.id.startsWith("f")).slice(0, 2);
  assert.equal((await join(two[0].id, { action: "same", with: two[1].id }, cara)).status, 200);
  let t = Date.now();
  const after = await list(cara);
  const listMs = Date.now() - t;
  assert.equal(after.length, all.length - 1, "one card fewer");
  t = Date.now();
  const hh = await (await call("/relay/my/admin/health", { token: boss })).json();
  const healthMs = Date.now() - t;
  assert.ok(hh.readingProblems && hh.readingProblems.shops.length >= 1);
  assert.ok(listMs < 6000 && healthMs < 6000, "quick enough: list " + listMs + "ms, health " + healthMs + "ms");
  console.log("ok - 3,500 receipts in one account: the list with a choice in " + listMs + "ms, the health page in " + healthMs + "ms");
}

// Gone with the account.
assert.equal((await call("/relay/my/delete", { method: "POST", body: {}, token: alice })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_joins WHERE shopper_id = ?").get(A).n, 0, "deleted with the account");
console.log("ok - the choices are deleted with the account");
