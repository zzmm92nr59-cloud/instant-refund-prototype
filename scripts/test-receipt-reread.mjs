// Offline test (real SQLite; Gmail and Anthropic are stand-ins): the totals check on receipts and "Read it again"
// (worker/receipt-reread.js, POST /relay/my/receipts/<id>/reread). People, shops, orders and emails are made up.
//  * A receipt read from an inbox carries its totals check (itemsCheck) to the app.
//  * "Read it again" reads that one email again: the rules first; then, only when they still don't add up and the AI is set
//    up, Claude reads the order section with personal details hidden. The AI's items are kept only when they add up.
//  * Their own receipts only (404 for anyone else's, and theirs is untouched); a pasted receipt has no email to read (409);
//    20 a day; the AI 10 a day; only counts are kept, and they go with the account.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, sealToken, gmailDeleteStatements } from "../worker/gmail.js";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { orderSection, cleanRereadAnswer, acceptAiItems, REREADS_PER_DAY } from "../worker/receipt-reread.js";
import { checkItems, moneyOf } from "../worker/receipt-items.js";
import { rawEmail } from "./fixtures/receipt-emails/lib.mjs";

// ---- The pure parts -------------------------------------------------------------------------------------------------
{
  // The check: complete when the items come to the subtotal, or to the total less fees and tips plus discounts.
  const m = moneyOf("Subtotal | £10.00 |\nDelivery fee | £2.00 |\nRider tip | £1.00 |\nVoucher | -£3.00 |\nTotal | £10.00 |");
  assert.deepEqual([m.subtotal, m.fees, m.tips, m.discounts], [1000, 200, 100, 300]);
  assert.equal(checkItems([{ name: "A", qty: 1, pricePence: 600 }, { name: "B", qty: 2, pricePence: 400, lineTotal: true }], m, 1000).complete, true);
  const short = checkItems([{ name: "A", qty: 1, pricePence: 600 }], m, 1000);
  assert.deepEqual([short.complete, short.missingPence], [false, 400], "one item missing: £4.00 not accounted for");
  assert.equal(checkItems([], m, 1000).complete, false, "no items read is never complete");
  assert.equal(checkItems([{ name: "A", qty: 1, pricePence: null }], { subtotal: 1000 }, 1000).complete, false, "an item with no price can't be checked");
  assert.equal(checkItems([{ name: "A", qty: 1, pricePence: 600 }], {}, null).complete, null, "nothing to compare with: unknown, not complete");
  // The AI's answer is checked like anything typed, and kept only when it adds up.
  const ans = cleanRereadAnswer('Here: {"items":[{"name":"Katsu Curry","qty":1,"pricePence":1150},{"name":"[name]\'s Gyoza","qty":1,"pricePence":595},{"name":"Gyoza","qty":"2","pricePence":595},{"name":"Edamame","qty":1,"pricePence":-1}],"totalPence":1745}');
  assert.deepEqual(ans.items.map((i) => [i.name, i.qty, i.pricePence]), [["Katsu Curry", 1, 1150], ["Gyoza", 1, 595]], "markers, bad numbers and negative prices are dropped");
  assert.ok(acceptAiItems(ans, "Subtotal £17.45\nTotal £17.45", 1745), "adds up: kept");
  assert.equal(acceptAiItems(ans, "Subtotal £19.45\nTotal £19.45", 1945), null, "doesn't add up: not kept");
  assert.equal(acceptAiItems({ items: ans.items, totalPence: 1745, subtotalPence: 1745 }, "Total £20.00", 2000), null, "the AI's own totals never stand in for the email's");
  // The order section: from just above the first amount to the total, nothing after it.
  const sec = orderSection(["Hi [name],", "Thanks for your order.", "Order 123", "1 x Katsu Curry", "£11.50", "Subtotal £11.50", "Total £11.50", "Delivering to [address]", "Unsubscribe"].join("\n"));
  assert.ok(sec.includes("Katsu Curry") && sec.includes("Total £11.50") && !sec.includes("Delivering") && !sec.includes("Unsubscribe"), sec);
  console.log("ok - the totals check; the AI's answer is cleaned and kept only when it adds up; only the order section is sent");
}

// ---- The route --------------------------------------------------------------------------------------------------------
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
const db = { prepare: (sql) => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { for (const s of list) s._exec(); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test" };

// Jess's Just Eat order (the corpus's layout behind the bug), and an order whose items the rules can't read: every name in
// one row and every price in the next.
const justEat = rawEmail(JSON.parse(readFileSync("scripts/fixtures/receipt-emails/just-eat-4.json", "utf8")));
const odd = ["From: Kitchen Nine <orders@kitchennine.example>", "To: Jess Private <jess.private@example.com>", "Subject: Your Kitchen Nine order", "Date: Mon, 16 Nov 2026 19:00:00 +0000",
  "Content-Type: text/html; charset=utf-8", "", "<html><body><p>Hi Jess,</p><p>Thanks for your order. Questions? Email jess.private@example.com or call 07700 900123.</p>",
  "<table><tr><td>Katsu Curry</td><td>Gyoza</td></tr><tr><td>&pound;11.50</td><td>&pound;5.95</td></tr></table>",
  "<p>Subtotal &pound;17.45</p><p>Total &pound;17.45</p><p>Delivering to: Jess Private, 12 High Street, London SW1A 1AA</p><p>Paid with Visa 4111 1111 1111 1111</p><p>Unsubscribe</p></body></html>"].join("\r\n");
const gmail = { je1abcdef: justEat, odd1abcdef: odd, odd2abcdef: odd.replace("Kitchen Nine order", "Kitchen Nine order again") };
let sentToAi = [], aiAnswer = null, emails = [];
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "access-gmail" });
  if (url === "https://api.anthropic.com/v1/messages") { sentToAi.push(JSON.parse(init.body)); return Response.json({ content: [{ type: "text", text: JSON.stringify(aiAnswer) }] }); }
  const g = /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([A-Za-z0-9]+)\?format=raw$/.exec(url);
  if (g) return gmail[g[1]] ? Response.json({ raw: Buffer.from(gmail[g[1]]).toString("base64url") }) : new Response("{}", { status: 404 });
  return new Response("{}", { status: 404 });
};
let clock = Date.UTC(2026, 10, 18, 22);
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const jess = await signIn("jess.private@example.com", "5.5.5.1"), sam = await signIn("sam@example.com", "5.5.5.2");
const J = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("jess.private@example.com").id;
for (const t of [jess, sam]) assert.equal((await call("/relay/my/consent", { method: "POST", token: t, body: { version: CONSENT_VERSION } })).status, 200);
await call("/relay/my/receipts", { token: jess });
await call("/relay/my/profile", { method: "POST", token: jess, body: { name: "Jess Private" } });
const s = await sealToken(env, "refresh-jess");
sqlite.prepare("INSERT INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at, provider) VALUES (?,?,?,?,?,?)").run(J, "jess.private@example.com", s.iv, s.data, clock, null);

// Receipts as an older reader left them: the Just Eat order with one item of six (as Connor saw), the odd one with none.
const R1 = "11111111-1111-4111-8111-111111111111", R2 = "22222222-2222-4222-8222-222222222222", R3 = "33333333-3333-4333-8333-333333333333", R4 = "44444444-4444-4444-8444-444444444444";
const put = (id, details) => sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)")
  .run(id, J, "m-" + id.slice(0, 4), "pending", JSON.stringify({ kind: "receipt", currency: "GBP", confidence: "medium", parserVersion: 31, ...details }), clock - 3600e3);
put(R1, { gmailId: "je1abcdef", retailer: { name: "Just Eat", domain: "just-eat.co.uk" }, totalPence: 4257, items: [{ name: "Special Fried Rice", qty: 1, pricePence: 520 }],
  itemsCheck: { complete: false, itemsPence: 520, expectedPence: 3769, missingPence: 3249 } });
put(R2, { gmailId: "odd1abcdef", retailer: { name: "Kitchen Nine", domain: "kitchennine.example" }, totalPence: 1745, items: [], itemsCheck: { complete: false, itemsPence: 0, expectedPence: 1745, missingPence: 1745 } });
put(R3, { pasted: true, retailer: { name: "Kitchen Nine" }, totalPence: 1745, items: [], itemsCheck: { complete: false, itemsPence: 0, expectedPence: 1745, missingPence: 1745 } });
put(R4, { gmailId: "odd2abcdef", retailer: { name: "Kitchen Nine", domain: "kitchennine.example" }, totalPence: 1745, items: [], itemsCheck: { complete: false, itemsPence: 0, expectedPence: 1745, missingPence: 1745 } });
const reread = (id, token) => call("/relay/my/receipts/" + id + "/reread", { method: "POST", token, body: {} });
const card = async (id) => (await (await call("/relay/my/receipts?all=1", { token: jess })).json()).receipts.find((c) => c.id === id);

// 1. The receipts list carries the check, so the app can say so.
assert.deepEqual((await card(R1)).itemsCheck, { complete: false, itemsPence: 520, expectedPence: 3769, missingPence: 3249 });
// And a fresh read of the Just Eat email reads every item and says they add up.
const fresh = parseReceiptEmail(justEat);
assert.equal(fresh.items.length, 6); assert.equal(fresh.itemsCheck.complete, true);
console.log("ok - receipts carry their totals check; the Just Eat email now reads all six items");

// 2. Someone else's receipt: 404, and Jess's is untouched. A pasted receipt has no email to read again.
const before = sqlite.prepare("SELECT details FROM captured_receipts WHERE id = ?").get(R1).details;
assert.equal((await reread(R1, sam)).status, 404, "Sam can't read Jess's email again");
assert.equal((await reread("99999999-9999-4999-8999-999999999999", jess)).status, 404);
assert.equal((await reread(R1, null)).status, 401);
assert.equal(sqlite.prepare("SELECT details FROM captured_receipts WHERE id = ?").get(R1).details, before, "untouched");
assert.equal((await reread(R3, jess)).status, 409, "a pasted receipt has no email to read again");
console.log("ok - only their own receipts (404 for anyone else's); a pasted receipt can't be read again");

// 3. The rules read it right this time: saved, and no AI asked.
let r = await reread(R1, jess);
assert.equal(r.status, 200);
let p = await r.json();
assert.equal(p.complete, true); assert.equal(p.via, "rules"); assert.equal(p.items.length, 6);
assert.equal(p.items.find((i) => /Chicken Balls/.test(i.name)).variant, "Sweet and sour sauce", "an extra stays with its item");
const saved = await card(R1);
assert.equal(saved.items.length, 6); assert.equal(saved.itemsCheck.complete, true); assert.equal(saved.itemsFrom, "rules");
assert.equal(sentToAi.length, 0);
console.log("ok - read again with the rules: all six items, saved, the check now complete, no AI asked");

// 4. Without the AI set up, an email the rules can't read stays as it was, and says so.
r = await reread(R2, jess); p = await r.json();
assert.equal(r.status, 200); assert.equal(p.complete, false); assert.equal(p.reason, "not_sure"); assert.equal(sentToAi.length, 0);
assert.deepEqual((await card(R2)).items, [], "nothing invented");
console.log("ok - without the AI key: nothing guessed, the receipt still says items may be missing");

// 5. With the AI set up: the order section only, personal details hidden; items kept only when they add up.
env.ANTHROPIC_API_KEY = "test-key";
aiAnswer = { items: [{ name: "Katsu Curry", qty: 1, pricePence: 1150 }, { name: "Gyoza", qty: 1, pricePence: 595 }, { name: "Miso Soup", qty: 1, pricePence: 300 }], totalPence: 2045 };
r = await reread(R2, jess); p = await r.json();
assert.equal(p.complete, false, "an item the email doesn't add up to: nothing kept"); assert.deepEqual((await card(R2)).items, []);
assert.equal(sentToAi.length, 1);
const asked = sentToAi[0].messages[0].content;
assert.match(asked, /Katsu Curry/); assert.match(asked, /Total £17\.45/);
for (const gone of ["Jess", "Private", "jess.private", "07700", "12 High Street", "SW1A", "4111", "Unsubscribe", "kitchennine.example"]) assert.ok(!asked.includes(gone), "not sent to the AI: " + gone + "\n" + asked);
aiAnswer = { items: [{ name: "Katsu Curry", qty: 1, pricePence: 1150 }, { name: "Gyoza", qty: 1, pricePence: 595 }], totalPence: 1745 };
r = await reread(R2, jess); p = await r.json();
assert.equal(p.complete, true); assert.equal(p.via, "ai");
const fixed = await card(R2);
assert.deepEqual(fixed.items.map((i) => [i.name, i.pricePence]), [["Katsu Curry", 1150], ["Gyoza", 595]]); assert.equal(fixed.itemsFrom, "ai"); assert.equal(fixed.itemsCheck.complete, true);
console.log("ok - with the AI: only the order section with details hidden; an answer that doesn't add up is thrown away; one that does is kept");

// 6. Limits: the AI at most 10 times a day for a shopper, and 20 re-reads a day in all.
aiAnswer = { items: [], totalPence: null };
for (let i = 0; i < 8; i++) await reread(R4, jess);
const aiCalls = sentToAi.length;
assert.equal(aiCalls, 10, "the AI was asked 10 times today");
await reread(R4, jess);
assert.equal(sentToAi.length, aiCalls, "no 11th AI read today");
let last;
for (let i = 0; i < REREADS_PER_DAY; i++) last = await reread(R4, jess);
assert.equal(last.status, 429, "20 re-reads a day");
const kept = sqlite.prepare("SELECT * FROM receipt_rereads WHERE shopper_id = ?").all(J);
assert.ok(kept.length >= 10 && Object.keys(kept[0]).sort().join() === "ai,created_at,outcome,receipt_id,shopper_id", "only counts are kept");
clock += 864e5 + 1000;
assert.equal((await reread(R4, jess)).status, 200, "a new day, new allowance");
for (const st of gmailDeleteStatements(db, J)) await st.run();
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_rereads WHERE shopper_id = ?").get(J).n, 0, "deleted with the account's emails");
console.log("ok - limits: 10 AI reads and 20 re-reads a shopper a day; only counts kept, deleted with the account");
