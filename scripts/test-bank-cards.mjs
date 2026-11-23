// Offline test (real SQLite; TrueLayer is a stand-in): "Which of these are yours?" for a bank connection (worker/bank.js).
// Two people (made up) share one card account, a card each. Checks:
//   - a connection that lists two cards asks before any payment is read (none ticked); one card alone isn't asked;
//   - a card that isn't yours is never read from the bank, never kept, shown, matched or counted; ticking one off later
//     deletes its payments and what was said about them; ticking it on reads it;
//   - the answer survives reading again, and connecting again (the same card id, or the same bank and last four digits);
//   - one card account whose payments name their card (meta.cardNumber, Amex's meta.supplementary_card_id) is split into
//     a choice a card; one whose payments don't is said to be one Relay can't tell apart (Amex), and nothing is guessed;
//   - only your own connection: someone else's, or a card ref from another connection, answers 404; answers are never
//     carried to someone else's connection.
// People, cards, shops and payments are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION } from "../worker/gmail.js";
import { txCardMark, cardLabel, bankDeleteStatements } from "../worker/bank.js";
import { checkBody } from "../worker/validate.js";

// What a card payment says about its card (TrueLayer: masked meta.cardNumber; Amex: meta.supplementary_card_id).
assert.equal(txCardMark({ meta: { cardNumber: "1234********5678" } }), "n:5678");
assert.equal(txCardMark({ meta: { supplementary_card_id: "SUPP-77" } }), "s:SUPP-77");
assert.equal(txCardMark({ meta: { cardNumber: "1234********5678", supplementary_card_id: "SUPP-77" } }), "n:5678", "the card number first");
assert.equal(txCardMark({ meta: { provider_merchant_name: "Made-up Cafe" } }), null, "nothing about the card: no guess");
assert.equal(txCardMark({ meta: { supplementary_card_id: "<b>" } }), null); assert.equal(txCardMark({}), null); assert.equal(txCardMark(null), null);
assert.equal(cardLabel("Amex Gold", "1004"), "Amex Gold ending 1004"); assert.equal(cardLabel("Current account", null), "Current account");
console.log("ok - a payment's card is read only from what the card company says (masked card number or supplementary card id)");

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); }
  };
}
const db = { prepare: (sql) => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { list.forEach((s) => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "ava@example.com,ben@example.com,cal@example.com",
  SECOND_STEP: "off", TRUELAYER_CLIENT_ID: "relay-test-id", TRUELAYER_CLIENT_SECRET: "tl-secret-test" };

// TrueLayer's stand-in. Each sign-in code is one "bank" with its cards and their payments; its token reads only that bank.
const tx = (id, day, desc, amount, meta) => ({ transaction_id: id, timestamp: `2026-11-${String(day).padStart(2, "0")}T10:00:00Z`, description: desc, amount: -amount, currency: "GBP",
  transaction_type: "DEBIT", ...(meta ? { meta } : {}) });
const AMEX_TWO = { me: "American Express", cards: [
  { account_id: "amexmain01", display_name: "Amex Gold", partial_card_number: "1004" }, { account_id: "amexsupp02", display_name: "Amex Gold", partial_card_number: "2009" }],
  tx: { amexmain01: [tx("m1", 3, "BRINDLE AND CO LONDON", 45), tx("m2", 5, "FERN ROW BOOKS", 12.5)],
    amexsupp02: [tx("s1", 4, "OAK BARN HOMEWARES", 60), tx("s2", 6, "TINY TEAPOT CAFE", 8)] } };
const banks = {
  "ava-1": AMEX_TWO, "ava-2": AMEX_TWO, "ben-1": AMEX_TWO,
  // Connected again, and TrueLayer gave the cards new ids: matched by bank and last four digits.
  "ava-3": { ...AMEX_TWO, cards: AMEX_TWO.cards.map((c) => ({ ...c, account_id: c.account_id + "x" })), tx: { amexmain01x: AMEX_TWO.tx.amexmain01, amexsupp02x: AMEX_TWO.tx.amexsupp02 } },
  // One card alone: no question.
  "cal-1": { me: "Made-up Bank", cards: [{ account_id: "solo01", display_name: "Everyday card", partial_card_number: "3141" }], tx: { solo01: [tx("o1", 7, "BRINDLE AND CO LONDON", 30)] } },
  // One Amex card whose payments say which card each was on (supplementary card id, or the masked card number).
  "cal-2": { me: "American Express", cards: [{ account_id: "amexone01", display_name: "Amex Green", partial_card_number: "5005" }], tx: { amexone01: [
    tx("x1", 3, "BRINDLE AND CO LONDON", 21), tx("x2", 4, "OAK BARN HOMEWARES", 33, { supplementary_card_id: "SUPP0001" }), tx("x3", 5, "FERN ROW BOOKS", 9, { cardNumber: "3700********5005" })] } },
  "cal-3": { me: "Made-up Card Co", cards: [{ account_id: "mixed01", display_name: "Shared card", partial_card_number: "6006" }], tx: { mixed01: [
    tx("y1", 3, "BRINDLE AND CO LONDON", 22, { cardNumber: "4111********6006" }), tx("y2", 4, "OAK BARN HOMEWARES", 44, { cardNumber: "4111********7007" })] } },
  // One Amex card whose payments say nothing about which card: Relay says it can't tell them apart.
  "cal-4": { me: "American Express", cards: [{ account_id: "amexplain1", display_name: "Amex Blue", partial_card_number: "8008" }], tx: { amexplain1: [tx("z1", 3, "BRINDLE AND CO LONDON", 23)] } },
};
let calls = [], emails = [];
const fetchImpl = async (url, init = {}) => {
  url = String(url); calls.push(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url === "https://auth.truelayer-sandbox.com/connect/token") {
    const f = new URLSearchParams(init.body);
    if (f.get("grant_type") === "authorization_code" && banks[f.get("code")]) return Response.json({ access_token: "tok-" + f.get("code"), refresh_token: "ref-" + f.get("code"), expires_in: 3600 });
    if (f.get("grant_type") === "refresh_token" && /^ref-/.test(f.get("refresh_token"))) return Response.json({ access_token: "tok-" + f.get("refresh_token").slice(4), refresh_token: f.get("refresh_token"), expires_in: 3600 });
    return new Response("{}", { status: 400 });
  }
  if (url.startsWith("https://api.truelayer-sandbox.com/")) {
    const code = String((init.headers || {}).Authorization || "").replace(/^Bearer tok-/, ""), b = banks[code];
    if (!b) return new Response("{}", { status: 401 });
    const p = new URL(url).pathname;
    if (p === "/data/v1/me") return Response.json({ results: [{ provider: { display_name: b.me } }] });
    if (p === "/data/v1/accounts") return new Response("{}", { status: 501 });   // a card company has no accounts
    if (p === "/data/v1/cards") return Response.json({ results: b.cards });
    const m = /^\/data\/v1\/cards\/([^/]+)\/transactions$/.exec(p);
    if (m && b.tx[m[1]]) return Response.json({ results: b.tx[m[1]] });
    return new Response("{}", { status: 404 });
  }
  return new Response("{}", { status: 404 });
};
let now = Date.UTC(2026, 10, 15, 9);
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now, fetchImpl });
const get = async (path, token) => (await call(path, { token })).json();
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  const t = (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
  assert.equal((await call("/relay/my/consent", { method: "POST", token: t, body: { version: CONSENT_VERSION } })).status, 200);
  return t;
}
async function connect(token, code) {
  const had = new Set((await get("/relay/my/bank", token)).connections.map((c) => c.id));
  now += 60e3;
  const state = new URL((await (await call("/relay/my/bank/connect", { method: "POST", token })).json()).url).searchParams.get("state");
  assert.match((await call("/relay/bank/callback?code=" + code + "&state=" + state)).headers.get("location"), /#bank=connected$/);
  const added = (await get("/relay/my/bank", token)).connections.filter((c) => !had.has(c.id));
  assert.equal(added.length, 1);
  return added[0];
}
const choose = (token, conn, ticks) => call("/relay/my/bank/cards", { method: "POST", token, body: { id: conn.id, cards: conn.cards.map((c) => ({ ref: c.ref, mine: ticks[c.label] })) } });
const shops = async (token) => (await get("/relay/my/bank/payments", token)).payments.map((p) => p.shop).sort();
const txAsked = (id) => calls.filter((u) => u.includes("/cards/" + id + "/transactions")).length;

const ava = await signIn("ava@example.com", "5.5.5.1"), ben = await signIn("ben@example.com", "5.5.5.2"), cal = await signIn("cal@example.com", "5.5.5.3");
const A = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("ava@example.com").id;
// Ava has a receipt for £60 at Oak Barn: the payment on Ben's card is that amount and shop, and must never be matched to it.
sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)").run("00000000-0000-4000-8000-0000000000c1", A, "m-oak", "confirmed",
  JSON.stringify({ kind: "receipt", retailer: { name: "Oak Barn Homewares", domain: "oakbarn.example" }, currency: "GBP", orderRef: "#OB1", orderDate: "2026-11-04", totalPence: 6000, category: "home", items: [{ name: "Lamp", qty: 1 }], parserVersion: 26 }), now);

// 1. Two cards on one Amex account: asked first, none ticked, nothing read from the bank.
let c1 = await connect(ava, "ava-1");
assert.equal(c1.needsChoice, true);
assert.deepEqual(c1.cards.map((c) => [c.label, c.mine]), [["Amex Gold ending 1004", null], ["Amex Gold ending 2009", null]]);
assert.equal(c1.payments, 0); assert.deepEqual(await shops(ava), []);
assert.equal(txAsked("amexmain01") + txAsked("amexsupp02"), 0, "no payments asked of the bank before Ava says");
console.log("ok - two cards: \"Which of these are yours?\" before any payment is read, none ticked");

// 2. Ava's card only: Ben's card is never read, kept, shown, matched or counted.
let r = await (await choose(ava, c1, { "Amex Gold ending 1004": true, "Amex Gold ending 2009": false })).json();
assert.deepEqual(r.connection.cards.map((c) => c.mine), [true, false]); assert.equal(r.connection.needsChoice, undefined);
assert.deepEqual(await shops(ava), ["Brindle and Co", "Fern Row Books"]);
assert.equal(txAsked("amexsupp02"), 0, "Ben's card is never read");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_payments WHERE description IN ('OAK BARN HOMEWARES', 'TINY TEAPOT CAFE')").get().n, 0, "never kept");
assert.equal(r.connection.payments, 2, "never counted");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_payments WHERE receipt_id IS NOT NULL").get().n, 0, "Ava's Oak Barn receipt isn't matched to Ben's payment");
assert.ok(!(await get("/relay/my/receipts", ava)).needReceipt?.some((p) => /oak|teapot/i.test(p.shop || "")), "and Home never asks for its receipt");
console.log("ok - a card that isn't yours is never read, kept, shown, matched or counted");

// 3. She changes her mind: ticked on, it's read; ticked off again, its payments go, and what she said about them.
r = await (await choose(ava, r.connection, { "Amex Gold ending 1004": true, "Amex Gold ending 2009": true })).json();
assert.deepEqual(await shops(ava), ["Brindle and Co", "Fern Row Books", "Oak Barn Homewares", "Tiny Teapot Cafe"]);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_payments WHERE receipt_id IS NOT NULL").get().n, 1, "on her card list, it matches as usual");
const teapot = (await get("/relay/my/bank/payments", ava)).payments.find((p) => p.shop === "Tiny Teapot Cafe");
assert.equal((await call("/relay/my/bank/not-mine", { method: "POST", token: ava, body: { id: teapot.id, on: true } })).status, 200);
r = await (await choose(ava, r.connection, { "Amex Gold ending 1004": true, "Amex Gold ending 2009": false })).json();
assert.deepEqual(await shops(ava), ["Brindle and Co", "Fern Row Books"], "ticked off: deleted");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_payments WHERE shopper_id = ? AND description IN ('OAK BARN HOMEWARES', 'TINY TEAPOT CAFE')").get(A).n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_not_mine WHERE shopper_id = ?").get(A).n, 0, "and what she said about them");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_payments WHERE receipt_id IS NOT NULL").get().n, 0, "and the match goes");
console.log("ok - ticking a card on reads it; ticking it off deletes its payments, their matches and what was said about them");

// 4. Reading again keeps the answer, and still never reads Ben's card.
const before = txAsked("amexsupp02");
now += 2 * 3600e3;
await call("/relay/my/bank/sync", { method: "POST", token: ava });
c1 = (await get("/relay/my/bank", ava)).connections[0];
assert.deepEqual(c1.cards.map((c) => c.mine), [true, false]); assert.equal(c1.needsChoice, undefined);
assert.equal(txAsked("amexsupp02"), before); assert.ok(txAsked("amexmain01") >= 3, "her own card is read again");
assert.deepEqual(await shops(ava), ["Brindle and Co", "Fern Row Books"]);
console.log("ok - the answer survives reading again");

// 5. Connecting the same Amex again: the answer is carried over, by card id, or by bank and last four when the ids change.
let c2 = await connect(ava, "ava-2");
assert.equal(c2.needsChoice, undefined, "not asked again"); assert.deepEqual(c2.cards.map((c) => c.mine), [true, false]);
let c3 = await connect(ava, "ava-3");
assert.equal(c3.needsChoice, undefined); assert.deepEqual(c3.cards.map((c) => [c.label, c.mine]), [["Amex Gold ending 1004", true], ["Amex Gold ending 2009", false]]);
assert.equal(txAsked("amexsupp02x"), 0);
for (const c of [c2, c3]) assert.equal((await call("/relay/my/bank/disconnect", { method: "POST", token: ava, body: { id: c.id } })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_cards WHERE connection_id IN (?, ?)").get(c2.id, c3.id).n, 0, "disconnecting deletes its answers");
console.log("ok - connected again: the answer carries over (same card id, or same bank and last four digits)");

// 6. Ben connects the same account: his own question; Ava's answers aren't his, and neither can touch the other's.
const b1 = await connect(ben, "ben-1");
assert.equal(b1.needsChoice, true, "Ava's answers aren't carried to Ben"); assert.deepEqual(b1.cards.map((c) => c.mine), [null, null]);
assert.deepEqual((await get("/relay/my/bank", ben)).connections.map((c) => c.id), [b1.id], "Ben sees only his own connection");
assert.equal((await choose(ben, c1, { "Amex Gold ending 1004": false, "Amex Gold ending 2009": true })).status, 404, "Ben can't answer for Ava's connection");
assert.equal((await call("/relay/my/bank/cards", { method: "POST", token: ben, body: { id: b1.id, cards: [{ ref: c1.cards[0].ref, mine: true }] } })).status, 404, "nor with her card's ref");
assert.equal((await call("/relay/my/bank/cards", { method: "POST", token: ava, body: { id: c1.id, cards: [{ ref: b1.cards[0].ref, mine: true }] } })).status, 404, "nor Ava with his");
assert.equal((await call("/relay/my/bank/cards", { method: "POST", body: { id: c1.id, cards: [{ ref: c1.cards[0].ref, mine: true }] } })).status, 401, "signed out");
for (const bad of [{ id: c1.id }, { id: c1.id, cards: [] }, { id: c1.id, cards: [{ ref: c1.cards[0].ref, mine: "yes" }] }, { id: "x", cards: [{ ref: c1.cards[0].ref, mine: true }] }])
  assert.equal((await call("/relay/my/bank/cards", { method: "POST", token: ava, body: bad })).status, 400);
assert.deepEqual((await get("/relay/my/bank", ava)).connections[0].cards.map((c) => c.mine), [true, false], "Ava's answers unchanged");
r = await (await choose(ben, b1, { "Amex Gold ending 1004": false, "Amex Gold ending 2009": true })).json();
assert.deepEqual(await shops(ben), ["Oak Barn Homewares", "Tiny Teapot Cafe"]); assert.deepEqual(await shops(ava), ["Brindle and Co", "Fern Row Books"]);
// The server's input checks take exactly these fields.
const vr = await checkBody(new Request("https://w.test/relay/my/bank/cards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: c1.id, cards: [{ ref: c1.cards[0].ref, mine: true, owner: "x" }] }) }), "/relay/my/bank/cards", {});
assert.ok(vr.response && vr.response.status === 400, "an unexpected field is refused");
console.log("ok - only your own connection: each person answers for themselves; someone else's connection or card answers 404");

// 7. One card alone: no question, read straight away.
const k1 = await connect(cal, "cal-1");
assert.equal(k1.needsChoice, undefined); assert.equal(k1.cards, undefined, "nothing to choose"); assert.equal(k1.payments, 1); assert.equal(k1.unsplit, undefined);
console.log("ok - one card alone: no question");

// 8. One Amex card whose payments say which card each was on: a choice a card, and nothing kept until answered.
const k2 = await connect(cal, "cal-2");
assert.equal(k2.needsChoice, true);
assert.deepEqual(k2.cards.map((c) => [c.label, c.mine]), [["Amex Green ending 5005", null], ["Another card on Amex Green", null]]);
assert.equal(k2.payments, 0, "nothing kept until answered");
r = await (await choose(cal, k2, { "Amex Green ending 5005": true, "Another card on Amex Green": false })).json();
let ps = (await get("/relay/my/bank/payments", cal)).payments.filter((p) => p.id.startsWith(k2.id));
assert.deepEqual(ps.map((p) => [p.shop, p.account]).sort(), [["Brindle and Co", "Amex Green ending 5005"], ["Fern Row Books", "Amex Green ending 5005"]], "the supplementary card's payment isn't kept");
const k3 = await connect(cal, "cal-3");
assert.deepEqual(k3.cards.map((c) => c.label), ["Shared card ending 6006", "Shared card ending 7007"], "split by the masked card number");
r = await (await choose(cal, k3, { "Shared card ending 6006": false, "Shared card ending 7007": true })).json();
ps = (await get("/relay/my/bank/payments", cal)).payments.filter((p) => p.id.startsWith(k3.id));
assert.deepEqual(ps.map((p) => [p.shop, p.account]), [["Oak Barn Homewares", "Shared card ending 7007"]]);
assert.equal(r.connection.unsplit, undefined);
console.log("ok - one card account whose payments name their card: split into a choice a card");

// 9. One Amex card whose payments don't say which card: read (it's the only one), and Relay says it can't tell them apart.
const k4 = await connect(cal, "cal-4");
assert.equal(k4.needsChoice, undefined); assert.equal(k4.unsplit, true); assert.equal(k4.payments, 1);
assert.equal(k1.unsplit, undefined, "only said for a card company that sends cards together");
console.log("ok - payments that don't say their card: nothing guessed, and Relay says it can't tell them apart");

// 9b. Payments read before cards were told apart (older than the 90 days read again, no card): given the card they were
// saved under; one from the card that isn't hers is deleted; one Relay can't place is never shown, matched or exported.
const old = (pid, account, desc) => sqlite.prepare(`INSERT INTO bank_payments (shopper_id, payment_id, connection_id, account, paid_on, amount_minor, currency, description, created_at)
  VALUES (?,?,?,?,?,?,?,?,?)`).run(A, c1.id + ":" + pid, c1.id, account, "2026-07-01", 1500, "GBP", desc, now);
old("old1", "Amex Gold ending 1004", "MAPLE LANE GIFTS"); old("old2", "Amex Gold ending 2009", "PEBBLE STREET SHOES"); old("old3", "Amex Gold", "QUILL AND INK");
assert.ok(!(await shops(ava)).some((s) => /pebble|quill/i.test(s)), "not shown even before Relay reads the bank again");
now += 2 * 3600e3;
await call("/relay/my/bank/sync", { method: "POST", token: ava });
assert.deepEqual(await shops(ava), ["Brindle and Co", "Fern Row Books", "Maple Lane Gifts"], "her old payment kept; the others never shown");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_payments WHERE description = 'PEBBLE STREET SHOES'").get().n, 0, "the other card's old payment is deleted");
assert.equal((await call("/relay/my/bank/not-mine", { method: "POST", token: ava, body: { id: c1.id + ":old3", on: true } })).status, 404, "one Relay can't place can't be acted on");
assert.ok(!(await get("/relay/my/export", ava)).banks.payments.some((p) => /QUILL|PEBBLE/.test(p.description || "")), "nor exported");
console.log("ok - payments read before cards were told apart: kept for her card, deleted for the other, never shown when Relay can't tell");

// 10. In Download my data; deleted with the account.
const ex = await get("/relay/my/export", ava);
assert.deepEqual(ex.banks.cards.map((c) => [c.name, c.last4, c.yours]), [["Amex Gold", "1004", true], ["Amex Gold", "2009", false]]);
await db.batch(bankDeleteStatements(db, A));
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_cards WHERE shopper_id = ?").get(A).n, 0);
assert.ok(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_cards").get().n > 0, "only Ava's");
console.log("PASS which cards are yours: asked before reading, unticked cards never read or kept, answers kept and carried over, split when the bank says, own connections only");
