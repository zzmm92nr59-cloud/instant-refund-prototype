// Offline test (real SQLite, stand-in Resend): Relay health by email (worker/health-digest.js). The admins' summary goes
// once a day from 8am UK time, counts only; alerts go when something breaks (most inbox checks stopping, no inbox checked
// for hours, many inboxes needing connecting again, a run of wrong sign-in codes), each at most once in 6 hours and only
// while it's still happening; nothing goes without an admin list, and HEALTH_EMAILS=off stops it; an admin can email
// themselves one now. Shoppers and shops are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { runHealthEmails, ALERT_GAP_HOURS } from "../worker/health-digest.js";

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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "" };
let emails = [];
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  return new Response("{}", { status: 404 });
};
const H = 36e5;
let clock = Date.UTC(2026, 10, 5, 7, 30); // 7:30am in London (GMT in November)
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const shopper = await signIn("jess.private@example.com", "5.5.5.5");
const ops = await signIn("ops@example.com", "6.6.6.6");
const J = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("jess.private@example.com").id;
await call("/relay/my/receipts", { token: shopper }); // makes the receipt and inbox tables
sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)")
  .run("11111111-1111-4111-8111-111111111111", J, "m-1", "confirmed", JSON.stringify({ kind: "receipt", retailer: { name: "Brindle", domain: "brindle.example" }, orderRef: "BR-SECRET", totalPence: 4500, confidence: "high", items: [{ name: "Secret Scarf" }] }), clock - 20 * H);
sqlite.prepare("INSERT INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at, last_scan_at) VALUES (?,?,?,?,?,?)").run(J, "jess.inbox@example.com", "iv", "d", clock - 48 * H, clock - 600e3);
// The inbox was checked 10 minutes ago, unless a check below says otherwise.
let stalled = false;
const run = () => { if (!stalled) sqlite.prepare("UPDATE gmail_connections SET last_scan_at = ?").run(clock - 600e3); return runHealthEmails(env, clock, fetchImpl); };

// Nobody to send to: nothing goes.
emails = [];
assert.deepEqual(await run(), { sent: 0, why: "off" });
env.RELAY_ADMIN_EMAILS = "ops@example.com, Boss@Example.com";
env.HEALTH_EMAILS = "off"; assert.equal((await run()).sent, 0, "HEALTH_EMAILS=off stops it"); delete env.HEALTH_EMAILS;
assert.equal(emails.length, 0);
console.log("ok - nothing is sent without an admin list, or with HEALTH_EMAILS=off");

// The morning summary: not before 8am, once a day, to every admin, counts only.
assert.equal((await run()).sent, 0, "7:30am: too early");
clock = Date.UTC(2026, 10, 5, 8, 0);
let r = await run();
assert.equal(r.digest, true); assert.equal(emails.length, 1);
const m = emails[0];
assert.deepEqual(m.to, ["ops@example.com", "boss@example.com"]);
assert.equal(m.subject, "Relay this morning: all well, 1 receipt yesterday");
assert.match(m.text, /Needs a look\n- Nothing needs a look\./);
assert.match(m.text, /Yesterday\n- 1 receipt found, 0 other emails skipped\./);
assert.match(m.text, /2 shoppers \(2 new\), 1 inbox\./); assert.match(m.text, /100% of all purchases read confidently/);
assert.match(m.text, /#open=health/);
for (const secret of ["Secret Scarf", "BR-SECRET", "Brindle", "jess.private", "jess.inbox", J]) assert.ok(!JSON.stringify(m).includes(secret), "counts only: " + secret);
clock += H; assert.equal((await run()).sent, 0, "once a day");
clock = Date.UTC(2026, 10, 6, 8, 0); assert.equal((await run()).digest, true, "the next morning");
console.log("ok - the summary goes once a day from 8am UK time, to every admin, with counts only");

// Alerts: most checks stopping, inboxes needing connecting again.
emails = [];
clock = Date.UTC(2026, 10, 6, 13, 0);
const job = (id, state, error) => sqlite.prepare("INSERT OR REPLACE INTO mail_scan_jobs (shopper_id, job_id, state, started_at, updated_at, error) VALUES (?,?,?,?,?,?)").run(id, "j-" + id, state, clock - 1800e3, clock - 600e3, error);
["a", "b", "c", "d"].forEach(id => job(id, "failed", "gmail_reconnect_needed")); job("e", "done", null);
r = await run();
assert.deepEqual(r.alerts.sort(), ["reconnects", "scans_failing"]);
const fail = emails.find(e => /Most inbox checks stopped/.test(e.subject));
assert.equal(fail.subject, "Relay alert: Most inbox checks stopped in the last hour");
assert.match(fail.text, /^4 of the last hour's 5 checks stopped: inbox needs connecting again \(4\)\./);
assert.ok(!JSON.stringify(emails).includes("gmail_reconnect_needed"), "plain words, never an error code");
assert.ok(emails.some(e => e.subject === "Relay alert: 4 inboxes need connecting again"));
clock += 2 * H; job("f", "failed", "gmail_unavailable");
sqlite.prepare("UPDATE mail_scan_jobs SET updated_at = ?").run(clock - 600e3);
emails = []; assert.equal((await run()).sent, 0, "not again within " + ALERT_GAP_HOURS + " hours");
clock += ALERT_GAP_HOURS * H; sqlite.prepare("UPDATE mail_scan_jobs SET updated_at = ?").run(clock - 600e3);
assert.ok((await run()).alerts.includes("scans_failing"), "again after " + ALERT_GAP_HOURS + " hours while it's still happening");
clock += ALERT_GAP_HOURS * H;
emails = []; assert.equal((await run()).sent, 0, "over: the checks are an hour old, so nothing is sent");
console.log("ok - alerts: most checks stopping and inboxes needing connecting again, in plain words, at most every " + ALERT_GAP_HOURS + " hours, only while it's happening");

// Alerts: no inbox checked for hours, and a run of wrong sign-in codes. The morning summary leads with them.
stalled = true; sqlite.prepare("UPDATE gmail_connections SET last_scan_at = ?").run(clock - 5 * H);
for (let i = 0; i < 30; i++) sqlite.prepare("INSERT INTO auth_code_failures (email, created_at) VALUES (?, ?)").run("someone" + i + "@example.com", clock - 60e3);
r = await run();
assert.deepEqual(r.alerts.sort(), ["checks_stalled", "sign_in_codes"]);
assert.ok(emails.some(e => e.subject === "Relay alert: No inbox has been checked for 5 hours"));
assert.ok(emails.some(e => e.subject === "Relay alert: 30 wrong sign-in codes in the last hour"));
assert.ok(!JSON.stringify(emails).includes("someone1@"), "no addresses");
clock = Date.UTC(2026, 10, 8, 8, 0) ; sqlite.prepare("UPDATE auth_code_failures SET created_at = ?").run(clock - 60e3);
emails = []; r = await run();
const digest = emails.find(e => /this morning/.test(e.subject));
assert.match(digest.subject, /^Relay this morning: 4 things need a look/);
assert.match(digest.text, /- 4 inboxes needed connecting again this week \(their owners see a prompt in the app\)\./);
assert.match(digest.text, /Needs a look\n- No inbox has been checked for \d+ hours\./);
assert.match(digest.text, /- 1 inbox hasn't been checked in the last day\./);
console.log("ok - alerts: no inbox checked for hours, a run of wrong codes; the morning summary leads with what needs a look");

// "Email me one now": admins only, to that admin only, once in 5 minutes.
assert.equal((await call("/relay/my/admin/health/email", { method: "POST", body: {}, token: shopper })).status, 404);
emails = [];
const res = await call("/relay/my/admin/health/email", { method: "POST", body: {}, token: ops });
assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true, to: "ops@example.com" });
assert.deepEqual(emails[0].to, ["ops@example.com"]);
assert.equal((await call("/relay/my/admin/health/email", { method: "POST", body: {}, token: ops })).status, 429);
assert.equal((await call("/relay/my/admin/health/email", { method: "POST", body: { to: "x@example.com" }, token: ops })).status, 400, "takes nothing: the address can't be chosen");
console.log("ok - an admin can email themselves the summary now (and nobody else can)");
console.log("PASS health emails: morning summary from 8am, counts only, alerts in plain words at most every " + ALERT_GAP_HOURS + " hours, admins only");
