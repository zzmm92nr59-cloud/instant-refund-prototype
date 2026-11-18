// Offline test (real SQLite; Anthropic is a stand-in): AI for picks (worker/item-kinds.js). Off until the AI key is set, and only
// for shoppers who switch it on; only item names and shops' names go to the AI (never the email, address, order number or
// price), with anything personal hidden; each name once; the AI's answer is checked; limits; turning it off deletes what it
// said; and it goes with the account. People, shops and receipts are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION } from "../worker/gmail.js";
import { cleanKinds, KINDS_PER_ASK } from "../worker/item-kinds.js";

{
  const ids = new Set(["1", "2", "3", "4"]);
  const got = cleanKinds('```json\n{"items":[{"id":"1","mode":"again","kind":"Leggings","look":["leggings","yoga pants","<b>x</b>"]},' +
    '{"id":"2","mode":"with","kind":"coffee","look":["espresso cup"]},{"id":"3","mode":"once","kind":"tvs","look":["tv"]},{"id":"4","mode":"buy everything","kind":"x","look":[]},{"id":"9","mode":"again","kind":"socks","look":["socks"]}]}\n```', ids);
  assert.deepEqual(Object.fromEntries(got), { 1: { mode: "again", kind: "leggings", look: ["leggings", "yoga pants"] }, 2: { mode: "with", kind: "coffee", look: ["espresso cup"] },
    3: { mode: "once" }, 4: { mode: "skip" } }, "only the four modes, plain words, and ids that were asked about");
  assert.equal(cleanKinds("Sorry, I can't help with that.", ids), null);
  console.log("ok - the AI's answer is checked: four modes, short plain words, nothing it wasn't asked about");
}

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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "ops@example.com",
  GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test" };
const MAIL = (ref) => ["From: Brindle & Co <orders@brindle.example>", "To: Jess Private <jess.private@example.com>", "Subject: Jess, your order " + ref,
  "Content-Type: text/plain; charset=utf-8", "", "Hi Jess,", "Thanks for order " + ref + ".", "Merino Wool Scarf 35.00", "Delivery 10.00", "Total paid 45.00",
  "Delivery address", "Jess Private", "12 High Street", "London", "SW1A 1AA", "", "Questions? Call 0800 123 4567 or email help@brindle.example"].join("\r\n");
let aiCalls = [], ai = "answer";
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url === "https://api.anthropic.com/v1/messages") {
    const body = JSON.parse(init.body); aiCalls.push(body);
    if (ai === "busy") return new Response("{}", { status: 529 });
    const asked = JSON.parse(body.messages[0].content);
    const answer = asked.map((x) => /legging|pant/i.test(x.name) ? { id: x.id, type: "clothing", sure: true, mode: "again", kind: "leggings", look: ["leggings", "yoga pants"] }
      : /capsule|roma/i.test(x.name) ? { id: x.id, mode: "with", kind: "coffee", look: ["espresso cup"] }
      : /tv/i.test(x.name) ? { id: x.id, type: "electronics", sure: true, mode: "once" } : /banana/i.test(x.name) ? { id: x.id, type: "food_drink", sure: true, mode: "skip" }
      : /jumper/i.test(x.name) ? { id: x.id, type: "clothing", sure: true, mode: "again", kind: "jumpers", look: ["jumper"] } : { id: x.id, mode: "skip" });
    return Response.json({ content: [{ type: "text", text: JSON.stringify({ items: answer }) }] });
  }
  return new Response("{}", { status: 404 });
};
let emails = [];
const clock = Date.UTC(2026, 10, 15, 9);
let now = clock;
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const jess = await signIn("jess.private@example.com", "5.5.5.1"), sam = await signIn("sam@example.com", "5.5.5.2");
const J = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("jess.private@example.com").id, S = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("sam@example.com").id;
for (const t of [jess, sam]) assert.equal((await call("/relay/my/consent", { method: "POST", token: t, body: { version: CONSENT_VERSION } })).status, 200);
await call("/relay/my/profile", { method: "POST", token: jess, body: { name: "Jess Private" } });
let n = 0;
const receipt = (who, shop, category, items) => {
  const id = "00000000-0000-4000-8000-" + String(++n).padStart(12, "0");
  sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)").run(id, who, "m" + n, "confirmed",
    JSON.stringify({ kind: "receipt", retailer: { name: shop, domain: shop.toLowerCase().replace(/[^a-z]/g, "") + ".example" }, currency: "GBP", orderRef: "#77" + n, orderDate: "2026-10-1" + n,
      totalPence: 9900, category, items, parserVersion: 26 }), clock - n * 1000);
};
receipt(J, "Studio North", "fashion", [{ name: "Align High-Rise Pant 25", variant: "Black / 8", qty: 1, pricePence: 8800 }, { name: "Gift note for Jess Private, 12 High Street", qty: 1 }]);
receipt(J, "Nespresso", "food", [{ name: "Ispirazione Roma", qty: 50, pricePence: 2500 }]);
receipt(J, "Corner Grocer", "food", [{ name: "Bananas", qty: 1, pricePence: 120 }]);
receipt(J, "Screen Barn", "electronics", [{ name: "55 inch QLED TV", qty: 1, pricePence: 20000 }]);
receipt(S, "Studio North", "fashion", [{ name: "Sam's Secret Jumper", qty: 1, pricePence: 5000 }]);

// 1. Off until the key is set.
let r = await (await call("/relay/my/item-kinds", { token: jess })).json();
assert.deepEqual(r, { available: false, on: false, kinds: {} });
assert.equal((await call("/relay/my/item-kinds", { method: "POST", token: jess, body: { on: true } })).status, 503);
env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";
r = await (await call("/relay/my/item-kinds", { token: jess })).json();
assert.deepEqual(r, { available: true, on: false, kinds: {} }, "available, but off until she switches it on");
assert.equal(aiCalls.length, 0);
assert.equal((await call("/relay/my/item-kinds", { method: "POST", token: jess, body: { on: "yes" } })).status, 400);
assert.equal((await call("/relay/my/item-kinds", { token: null })).status, 401);
console.log("ok - off until the AI key is set, and then only for shoppers who switch it on");

// 2. Jess switches it on: her item names are read once, with the shop's name and nothing else.
assert.deepEqual(await (await call("/relay/my/item-kinds", { method: "POST", token: jess, body: { on: true } })).json(), { available: true, on: true });
r = await (await call("/relay/my/item-kinds", { token: jess })).json();
assert.equal(aiCalls.length, 1);
const sent = JSON.parse(aiCalls[0].messages[0].content);
// Every line's name is asked about now (18 Nov 2026), so each thing is counted as what it is, not only the ones picks follow.
assert.deepEqual(sent.map((x) => x.shop).sort(), ["Corner Grocer", "Nespresso", "Screen Barn", "Studio North", "Studio North"], "her shops only");
const words = JSON.stringify(aiCalls[0]);
for (const never of ["#77", "9900", "8800", "jess.private", "12 High Street", "Jess Private", "Black / 8", "Sam's Secret"]) assert.ok(!words.includes(never), "never sent: " + never);
assert.ok(sent.some((x) => x.name === "Align High-Rise Pant 25"));
assert.deepEqual(r.kinds, { "align high-rise pant 25": { mode: "again", kind: "leggings", look: ["leggings", "yoga pants"] }, "ispirazione roma": { mode: "with", kind: "coffee", look: ["espresso cup"] },
  "55 inch qled tv": { mode: "once" } }, "what to pick from, what not to; skipped names aren't sent back");
await call("/relay/my/item-kinds", { token: jess });
assert.equal(aiCalls.length, 1, "each name is read once");
assert.deepEqual(await (await call("/relay/my/item-kinds", { token: sam })).json(), { available: true, on: false, kinds: {} }, "Sam's are his: off, and nothing of Jess's");
// The AI's type from the fixed list goes with her receipts (with whether it was sure), for Wrapped and the receipts list.
{
  const typed = sqlite.prepare("SELECT data FROM item_kinds WHERE shopper_id = ? AND name_key = ?").get(J, "55 inch qled tv");
  assert.deepEqual(JSON.parse(typed.data), { mode: "once", type: "electronics", sure: true });
  assert.deepEqual(cleanKinds('{"items":[{"id":"1","type":"spaceship","sure":true,"mode":"once"},{"id":"2","type":"other","sure":true,"mode":"skip"}]}', new Set(["1", "2"])).get("2"), { mode: "skip", type: "other", sure: false }, "\"other\" is never sure");
  assert.deepEqual(cleanKinds('{"items":[{"id":"1","type":"spaceship","sure":true,"mode":"once"}]}', new Set(["1"])).get("1"), { mode: "once" }, "a type that isn't on the list is dropped");
  // A name with nothing personal in it is kept once for everyone, with no shopper; one with something hidden never is.
  const shared = sqlite.prepare("SELECT name_key FROM item_kind_cache ORDER BY name_key").all().map((r) => r.name_key);
  assert.ok(shared.includes("55 inch qled tv") && shared.includes("bananas"));
  assert.ok(!shared.some((k) => /gift note|jess|high street/.test(k)), "nothing personal in the shared copy");
  assert.deepEqual(Object.keys(sqlite.prepare("SELECT * FROM item_kind_cache LIMIT 1").get()).sort(), ["created_at", "data", "name_key"], "no shopper, shop, price or date in it");
  // Sam switches it on: the TV he also bought isn't asked about again; his own jumper (his name in it) is, and isn't shared.
  receipt(S, "Screen Barn", "electronics", [{ name: "55 inch QLED TV", qty: 1, pricePence: 20000 }]);
  await call("/relay/my/item-kinds", { method: "POST", token: sam, body: { on: true } });
  aiCalls = [];
  await call("/relay/my/item-kinds", { token: sam });
  const samSent = aiCalls.flatMap((c) => JSON.parse(c.messages[0].content).map((x) => x.name));
  assert.ok(!samSent.includes("55 inch QLED TV"), "already known: not sent again");
  assert.ok(samSent.some((n) => /Secret Jumper/.test(n)) && !samSent.some((n) => /Sam/.test(n)), "his name hidden");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM item_kind_cache WHERE name_key LIKE '%secret jumper%'").get().n, 0);
  assert.equal(JSON.parse(sqlite.prepare("SELECT data FROM item_kinds WHERE shopper_id = ? AND name_key = ?").get(S, "55 inch qled tv").data).type, "electronics", "his copy, from the shared one");
  // Her receipts carry what each thing is: the AI's sure answer for a name the rules can't place, the rules' otherwise.
  const list = await (await call("/relay/my/receipts", { token: jess })).json();
  const items = (list.receipts || list.cards || list).flatMap ? (list.receipts || list.cards || list).flatMap((c) => c.items || []) : [];
  const tv = items.find((i) => i.name === "55 inch QLED TV"), banana = items.find((i) => i.name === "Bananas");
  assert.equal(tv.kind, "electronics"); assert.equal(tv.kindSure, true); assert.equal(tv.lasting, true);
  assert.equal(banana.kind, "food_drink"); assert.equal(banana.lasting, false);
  // Sam, with it off again, gets Relay's rules only: nothing the AI said is used for him.
  await call("/relay/my/item-kinds", { method: "POST", token: sam, body: { on: false } });
  const samList = await (await call("/relay/my/receipts", { token: sam })).json();
  assert.ok(!(samList.receipts || samList.cards || []).flatMap((c) => c.items || []).some((i) => i.kindAi), "AI answers only while it's on");
  aiCalls = [];
}
console.log("ok - only item names and shops' names are sent (never prices, order numbers, addresses or variants), personal bits hidden, each name once, each shopper's own");

// 3. Limits: 40 names a request, 120 a day; a busy AI sends nothing back and is asked again later.
receipt(J, "Big Shop", "fashion", Array.from({ length: 20 }, (_, i) => ({ name: "Pleated Skirt " + i, qty: 1 })));
for (let k = 0; k < 8; k++) receipt(J, "Big Shop " + k, "fashion", Array.from({ length: 20 }, (_, i) => ({ name: "Knit " + k + "-" + i, qty: 1 })));
ai = "busy"; aiCalls = [];
r = await (await call("/relay/my/item-kinds", { token: jess })).json();
assert.equal(aiCalls.length, 1); assert.equal(Object.keys(r.kinds).length, 3, "a busy AI changes nothing");
ai = "answer"; aiCalls = [];
for (let k = 0; k < 5; k++) await call("/relay/my/item-kinds", { token: jess });
assert.ok(aiCalls.every((c) => JSON.parse(c.messages[0].content).length <= KINDS_PER_ASK), "at most 40 a request");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM item_kinds WHERE shopper_id = ? AND created_at = ?").get(J, clock).n, 120, "120 a day");
now = clock + 864e5 + 1; aiCalls = [];
await call("/relay/my/item-kinds", { token: jess });
assert.equal(aiCalls.length, 1, "more the next day");
console.log("ok - limits: 40 names a request and 120 a day; a busy AI is asked again later");

// 4. Off deletes what the AI said; the account going takes it too.
assert.deepEqual(await (await call("/relay/my/item-kinds", { method: "POST", token: jess, body: { on: false } })).json(), { available: true, on: false });
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM item_kinds WHERE shopper_id = ?").get(J).n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM picks_ai WHERE shopper_id = ?").get(J).n, 0);
await call("/relay/my/item-kinds", { method: "POST", token: jess, body: { on: true } }); await call("/relay/my/item-kinds", { token: jess });
assert.ok(sqlite.prepare("SELECT COUNT(*) AS n FROM item_kinds WHERE shopper_id = ?").get(J).n > 0);
const exported = await (await call("/relay/my/export", { token: jess })).json();
assert.equal(exported.aiForPicks && exported.aiForPicks.on, true, "in Download my data");
assert.ok(exported.aiForPicks.items.length > 0 && exported.aiForPicks.items.every((x) => x.item && x.read && x.at));
assert.equal((await call("/relay/my/consent/withdraw", { method: "POST", token: jess })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM item_kinds WHERE shopper_id = ?").get(J).n, 0, "withdrawing permission deletes it");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM picks_ai WHERE shopper_id = ?").get(J).n, 0);
console.log("ok - switching it off deletes what the AI said, and so does withdrawing permission; it's in Download my data");
console.log("PASS AI for picks: opt-in, item names and shops only, checked answers, limits, deleted when switched off");
