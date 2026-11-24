// Offline test (real SQLite; Gmail and Anthropic are stand-ins, no real AI call is ever made): AI on for everyone by default
// (worker/ai-choice.js; Connor, 24 Nov 2026). Checks:
//  1. Without the AI key, nothing is on and no notice is due.
//  2. A new member and existing members (one who had switched AI help on before, one with nothing recorded, which can't be
//     told apart from someone who switched it off before) are all on, for AI help and AI for picks, without doing anything.
//  3. The one-time notice: due with the profile, until the member says they've seen it; then never again for that account;
//     never for a member who made a choice of their own; the route takes no fields.
//  4. An explicit off is kept, deletes what the AI made, and stays off through withdrawing permission and connecting again;
//     it's in Download my data; the account going takes the choices with it.
//  5. On for everyone can't pass the spending limits: the hourly reader still takes AI_PER_RUN at most a run and
//     AI_PER_SHOPPER_DAY a shopper a day across a big backlog (a trickle, not a burst), and once the monthly limit is
//     reached nothing is sent and no inbox is even asked.
// People, shops and emails are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, sealToken } from "../worker/gmail.js";
import { runAiReads, AI_PER_RUN, AI_PER_SHOPPER_DAY } from "../worker/ai-runner.js";

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
const MAIL = (ref) => ["From: Brindle & Co <orders@brindle.example>", "To: A Member <member@example.com>", "Subject: Your order " + ref,
  "Content-Type: text/plain; charset=utf-8", "", "Thanks for order " + ref + ".", "Merino Wool Scarf 35.00", "Delivery 10.00", "Total paid 45.00"].join("\r\n");
const ANSWER = { isPurchase: true, shop: "Brindle & Co", orderRef: "#1", orderDate: "2026-10-12", currency: "GBP", totalPence: 4500, items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 3500 }] };
let aiCalls = [], gmailCalls = 0, emails = [];
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "access-gmail" });
  if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response("{}");
  const g = /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([A-Za-z0-9]+)\?format=raw$/.exec(url);
  if (g) { gmailCalls++; return Response.json({ raw: Buffer.from(MAIL("#" + g[1])).toString("base64url") }); }
  if (url === "https://api.anthropic.com/v1/messages") {
    const body = JSON.parse(init.body); aiCalls.push(body);
    let list = null; try { list = JSON.parse(body.messages[0].content); } catch { /* an email */ }
    const text = Array.isArray(list) ? JSON.stringify({ items: list.map((x) => ({ id: x.id, mode: "again", kind: "scarves", look: ["scarf"], type: "clothing", sure: true })) }) : JSON.stringify(ANSWER);
    return Response.json({ content: [{ type: "text", text }], usage: { input_tokens: 1500, output_tokens: 200 } });
  }
  return new Response("{}", { status: 404 });
};
const DAY = 864e5;
let clock = Date.UTC(2026, 10, 25, 9);
// Work a route leaves for after its answer (AI for picks reads names then) is finished before the call returns.
const pending = [];
const call = async (path, o = {}) => { const r = await callNow(path, o); while (pending.length) await pending.shift(); return r; };
const callNow = (path, { method = "GET", body, token, ip = "1.1.1.1", raw } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl, later: (p) => pending.push(p) });
const json = async (p, o) => (await call(p, o)).json();
let ipN = 10;
async function signIn(email) {
  emails = []; const ip = "5.5.5." + (ipN++);
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const idOf = (e) => sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(e).id;
const count = (sql, ...a) => Number(sqlite.prepare(sql).get(...a).n);
let n = 0;
const receipt = (who, details = {}) => {
  const id = "00000000-0000-4000-8000-" + String(++n).padStart(12, "0");
  sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)").run(id, who, "ref" + n, "pending",
    JSON.stringify({ kind: "receipt", gmailId: "m" + n + "abcdef", retailer: { name: "Brindle & Co", domain: "brindle.example" }, currency: "GBP", parserVersion: 26,
      orderRef: "#" + n, orderDate: "2026-10-12", totalPence: null, confidence: "low", items: [{ name: "Merino Wool Scarf " + n, qty: 1, pricePence: 3500 }], ...details }), clock - n * 1000);
  return id;
};
async function member(email) {
  const token = await signIn(email), id = idOf(email);
  assert.equal((await call("/relay/my/consent", { method: "POST", token, body: { version: CONSENT_VERSION } })).status, 200);
  await call("/relay/my/receipts", { token });   // makes the inbox tables, as opening Receipts does
  const s = await sealToken(env, "refresh-" + id);
  sqlite.prepare("INSERT OR REPLACE INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at) VALUES (?,?,?,?,?)").run(id, email, s.iv, s.data, clock);
  return { email, token, id };
}

// Existing members, from before AI was on for everyone: Ada had switched AI help and AI for picks on (the old "on" rows);
// Ben has nothing recorded (never switched it on, or switched it on and off again: what was kept can't tell those apart).
const ada = await member("ada.example@example.com"), ben = await member("ben.example@example.com"), ops = await member("ops@example.com");
sqlite.prepare("INSERT INTO ai_reading (shopper_id, on_since) VALUES (?, ?)").run(ada.id, clock - 30 * DAY);
sqlite.exec("CREATE TABLE IF NOT EXISTS picks_ai (shopper_id TEXT PRIMARY KEY, on_since INTEGER NOT NULL)");
sqlite.prepare("INSERT INTO picks_ai (shopper_id, on_since) VALUES (?, ?)").run(ada.id, clock - 30 * DAY);

// 1. Without the key, nothing is on and no notice is due.
assert.deepEqual(await json("/relay/my/ai-reading", { token: ben.token }), { available: false, on: false, choice: null, since: null });
assert.equal((await json("/relay/my/profile", { token: ben.token })).aiNotice, undefined, "no notice while AI is off for everyone");
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 0, why: "off" });
console.log("ok - without the AI key nothing is on and no notice is due");

// 2. With the key: everyone is on, new and existing, without doing anything.
env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";
const cal = await member("cal.new@example.com");   // a new member, joining after the change
for (const [who, name] of [[cal, "a new member"], [ben, "an existing member with nothing recorded"], [ada, "an existing member who had switched it on"]]) {
  const r = await json("/relay/my/ai-reading", { token: who.token });
  assert.equal(r.available, true); assert.equal(r.on, true, "AI help on for " + name); assert.equal(r.choice, null, "no choice of their own recorded");
  const k = await json("/relay/my/item-kinds", { token: who.token });
  assert.equal(k.on, true, "AI for picks on for " + name);
}
assert.equal((await json("/relay/my/ai-reading", { token: ada.token })).since, new Date(clock - 30 * DAY).toISOString(), "Ada's old 'switched on' date is kept");
console.log("ok - on for a new member and for existing members (whether or not they had switched it on before)");

// 3. The one-time notice.
for (const who of [ben, cal]) assert.equal((await json("/relay/my/profile", { token: who.token })).aiNotice, true, "due with the profile");
assert.equal((await json("/relay/my/profile", { token: ben.token })).aiNotice, true, "still due until it's seen");
assert.equal((await call("/relay/my/ai-notice", { token: ben.token })).status, 404, "seen is a POST");
assert.equal((await call("/relay/my/ai-notice", { method: "POST", token: ben.token, body: { seen: true } })).status, 400, "the route takes no fields");
assert.equal((await call("/relay/my/ai-notice", { method: "POST" })).status, 401, "signed in only");
assert.deepEqual(await json("/relay/my/ai-notice", { method: "POST", token: ben.token }), { ok: true });
assert.deepEqual(await json("/relay/my/ai-notice", { method: "POST", token: ben.token }), { ok: true }, "a second tap changes nothing");
assert.equal(count("SELECT COUNT(*) AS n FROM ai_notice_seen WHERE shopper_id = ?", ben.id), 1);
assert.equal((await json("/relay/my/profile", { token: ben.token })).aiNotice, undefined, "seen: never shown to Ben again");
assert.equal((await json("/relay/my/profile", { token: cal.token })).aiNotice, true, "Cal hasn't seen it yet: his own");
// A member who has made a choice of their own already knows: no notice.
assert.equal((await call("/relay/my/item-kinds", { method: "POST", token: ada.token, body: { on: true } })).status, 200);
assert.equal((await json("/relay/my/profile", { token: ada.token })).aiNotice, undefined, "a member with a choice of their own isn't told");
console.log("ok - the notice is due once per account, gone once seen, never for a member who chose, and the route takes nothing");

// 4. Ben has things the AI made, then switches both off.
const benR = receipt(ben.id);
assert.equal((await runAiReads(env, clock, fetchImpl)).read >= 1, true);
assert.ok(count("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE shopper_id = ?", ben.id) > 0, "Ben's unsure receipt was read, on by default");
await call("/relay/my/item-kinds", { token: ben.token });
assert.ok(count("SELECT COUNT(*) AS n FROM item_kinds WHERE shopper_id = ?", ben.id) > 0, "and his item names");
assert.deepEqual(await json("/relay/my/ai-reading", { method: "POST", token: ben.token, body: { on: false } }), { available: true, on: false, choice: "off", since: null });
assert.deepEqual(await json("/relay/my/item-kinds", { method: "POST", token: ben.token, body: { on: false } }), { available: true, on: false, choice: "off" });
assert.equal(count("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE shopper_id = ?", ben.id), 0, "off deletes what the AI read");
assert.equal(count("SELECT COUNT(*) AS n FROM item_kinds WHERE shopper_id = ?", ben.id), 0, "off deletes what the AI worked out");
assert.deepEqual(sqlite.prepare("SELECT feature, is_on FROM ai_choices WHERE shopper_id = ? ORDER BY feature").all(ben.id).map((r) => ({ ...r })), [{ feature: "picks", is_on: 0 }, { feature: "receipts", is_on: 0 }], "his offs are recorded");
receipt(ben.id); aiCalls = []; gmailCalls = 0;
await runAiReads(env, clock, fetchImpl);
assert.equal(count("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE shopper_id = ?", ben.id), 0, "nothing of his is read while it's off");
aiCalls = [];
await call("/relay/my/item-kinds", { token: ben.token });
assert.equal(aiCalls.length, 0, "nor his item names");
assert.equal(count("SELECT COUNT(*) AS n FROM item_kinds WHERE shopper_id = ?", ben.id), 0);
// Withdrawing permission and connecting again: still off (it's his preference, kept with the account).
assert.equal((await call("/relay/my/consent/withdraw", { method: "POST", token: ben.token, body: {} })).status, 200);
const again = await sealToken(env, "refresh-again");
assert.equal((await call("/relay/my/consent", { method: "POST", token: ben.token, body: { version: CONSENT_VERSION } })).status, 200);
sqlite.prepare("INSERT OR REPLACE INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at) VALUES (?,?,?,?,?)").run(ben.id, ben.email, again.iv, again.data, clock);
assert.equal((await json("/relay/my/ai-reading", { token: ben.token })).on, false, "still off after connecting again");
assert.equal((await json("/relay/my/item-kinds", { token: ben.token })).on, false);
receipt(ben.id); await runAiReads(env, clock, fetchImpl);
assert.equal(count("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE shopper_id = ?", ben.id), 0);
const exp = await json("/relay/my/export", { token: ben.token });
assert.equal(exp.aiHelp.on, false); assert.equal(exp.aiHelp.yourChoice, "switched off"); assert.equal(exp.aiHelp.choiceMadeAt, new Date(clock).toISOString());
assert.equal(exp.aiForPicks.on, false); assert.equal(exp.aiForPicks.yourChoice, "switched off");
assert.equal(exp.aiHelp.noticeSeenAt, new Date(clock).toISOString(), "when he saw the notice");
const calExp = await json("/relay/my/export", { token: cal.token });
assert.equal(calExp.aiHelp.on, true); assert.equal(calExp.aiHelp.yourChoice, "none (on, as for everyone)");
// The account going takes the choices and the notice with it.
assert.equal((await call("/relay/my/delete", { method: "POST", token: ben.token })).status, 200);
assert.equal(count("SELECT COUNT(*) AS n FROM ai_choices WHERE shopper_id = ?", ben.id) + count("SELECT COUNT(*) AS n FROM ai_notice_seen WHERE shopper_id = ?", ben.id), 0);
void benR;
console.log("ok - an explicit off is kept, deletes what the AI made, survives withdrawing permission and connecting again, is in Download my data, goes with the account");

// 5. A big backlog from many members, all on by default: it trickles within the limits, never bursts.
sqlite.exec("DELETE FROM receipt_ai_reads; DELETE FROM ai_spend; DELETE FROM ai_spend_shopper");
const crowd = [];
for (let i = 0; i < 6; i++) { const m = await member("crowd" + i + "@example.com"); crowd.push(m); for (let k = 0; k < 60; k++) receipt(m.id); }
aiCalls = []; gmailCalls = 0;
const first = await runAiReads(env, clock, fetchImpl);
assert.ok(first.read <= AI_PER_RUN && aiCalls.length <= AI_PER_RUN, "one run reads at most " + AI_PER_RUN + " (read " + first.read + ")");
assert.ok(first.read > 0, "and it does read");
// A whole day of hourly runs: each shopper at most AI_PER_SHOPPER_DAY, and the daily spending limit per shopper holds.
for (let h = 1; h < 24; h++) { clock += 36e5; const r = await runAiReads(env, clock, fetchImpl); assert.ok(r.read <= AI_PER_RUN, "hour " + h + ": at most " + AI_PER_RUN); }
for (const m of crowd) assert.ok(count("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE shopper_id = ? AND created_at > ?", m.id, clock - DAY) <= AI_PER_SHOPPER_DAY, "at most " + AI_PER_SHOPPER_DAY + " a shopper a day");
const dayLimit = 10;   // DEFAULT_SHOPPER_DAY_LIMIT_PENCE, unchanged
for (const r of sqlite.prepare("SELECT shopper_id, day, pence FROM ai_spend_shopper").all()) assert.ok(r.pence <= dayLimit, "a shopper's daily AI limit holds: " + r.pence.toFixed(2) + "p");
const total = count("SELECT COUNT(*) AS n FROM receipt_ai_reads");
assert.ok(total <= AI_PER_RUN * 24, "a day is at most " + AI_PER_RUN * 24 + " reads (" + total + ")");
const perShopper = crowd.map((m) => count("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE shopper_id = ?", m.id));
assert.ok(perShopper.every((k) => k > 0), "every member's backlog moves: one member at their daily limit doesn't hold up the rest (" + perShopper.join(", ") + ")");
console.log("  (a day of hourly runs over " + crowd.length * 60 + " unsure receipts: " + total + " read, per member " + perShopper.join(", ") + "; " + Number(sqlite.prepare("SELECT COALESCE(SUM(pence),0) AS p FROM ai_spend").get().p).toFixed(2) + "p estimated)");
// The monthly limit reached: nothing is sent, and no inbox is even asked.
const spent = Number(sqlite.prepare("SELECT COALESCE(SUM(pence), 0) AS p FROM ai_spend").get().p);
env.AI_MONTHLY_LIMIT_PENCE = String(spent + 0.001);
aiCalls = []; gmailCalls = 0; clock += DAY;
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 0, why: "spending_limit" });
await call("/relay/my/item-kinds", { token: cal.token });
const desc = await call("/relay/my/resale/describe", { method: "POST", token: cal.token, body: { receiptId: receipt(cal.id, { confidence: "high", totalPence: 4500 }), itemIndex: 0 } });
assert.ok([200, 400].includes(desc.status));
assert.equal(aiCalls.length, 0, "over the monthly limit: no call to Anthropic from anyone");
assert.equal(gmailCalls, 0, "and no inbox is asked for an email");
delete env.AI_MONTHLY_LIMIT_PENCE;
console.log("ok - " + crowd.length + " members' backlog trickles: at most " + AI_PER_RUN + " a run, " + AI_PER_SHOPPER_DAY + " a shopper a day, daily and monthly spending limits hold");
console.log("PASS AI on by default: new and existing members on, notice once, explicit off kept and deletes outputs, limits unchanged (no real AI calls)");
