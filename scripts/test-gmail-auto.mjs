// Offline tests (FAKE Google and Gmail, real SQLite) for Gmail scanning within Cloudflare's free-plan limits
// (50 outside calls and 50 database calls per request) and for the automatic every-15-minutes check.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, autoScanGmail, catchUpFullReads } from "../worker/gmail.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
let dbCalls = 0;
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    async run() { dbCalls++; sqlite.prepare(sql).run(...args); return {}; },
    async first() { dbCalls++; return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { dbCalls++; return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); }
  };
}
const db = { prepare: sql => stmt(sql), async batch(list) { dbCalls++; sqlite.exec("BEGIN"); try { list.forEach(s => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key",
  GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test" };

const DAY = 86400000;
let clock = Date.UTC(2026, 9, 31, 12);
const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "/");
const b64url = s => Buffer.from(s).toString("base64url");
const mail = (n) => `From: Example Outfitters <orders@exampleoutfitters.test>\nSubject: Your order confirmation #EO-${n}\nContent-Type: text/plain\n\nOrder number: EO-${n}\nOrder date: 14 Oct 2026\nWool jumper - Qty 1 - £59.00\nOrder total: £59.00\n`;
// A busy mailbox: 120 order emails spread over the last 60 days.
const box = {};
for (let i = 0; i < 120; i++) box["m" + i] = { raw: mail(i), day: ymd(clock - Math.floor(i / 2) * DAY) };
let fetchCalls = 0, failNext = 0, emails = [];
const fetchImpl = async (url, init = {}) => {
  url = String(url); fetchCalls++;
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url === "https://oauth2.googleapis.com/token") {
    const p = new URLSearchParams(String(init.body));
    return Response.json(p.get("grant_type") === "authorization_code"
      ? { access_token: "a1", refresh_token: "1//refresh", scope: "https://www.googleapis.com/auth/gmail.readonly" } : { access_token: "a2" });
  }
  if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") return Response.json({ emailAddress: "alice@gmail.test" });
  if (failNext > 0 && url.includes("gmail.googleapis")) { failNext--; throw new Error("Too many subrequests"); }
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
    const q = decodeURIComponent(url), w = /after:(\S+) before:(\S+)/.exec(q);
    const ids = Object.keys(box).filter(k => box[k].day >= w[1] && box[k].day < w[2]);
    const page = Number((/pageToken=p(\d+)/.exec(url) || [])[1] || 0);
    const slice = ids.slice(page * 100, page * 100 + 100);
    return Response.json({ messages: slice.map(id => ({ id: id + "abcdef" })), ...(ids.length > page * 100 + 100 ? { nextPageToken: "p" + (page + 1) } : {}) });
  }
  const one = /messages\/(m\d+)abcdef\?format=raw$/.exec(url);
  if (one) return Response.json({ raw: b64url(box[one[1]].raw) });
  return new Response("nope", { status: 404 });
};
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
const post = (path, token, body) => call(path, { method: "POST", token, body });
await post("/relay/my/consent", alice, { version: CONSENT_VERSION });
const state = new URL((await (await post("/relay/my/gmail/connect", alice)).json()).url).searchParams.get("state");
await call("/relay/gmail/callback?code=good&state=" + state);
assert.equal((await (await call("/relay/my/gmail", { token: alice })).json()).connected, true);
const count = () => sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts").get().n;

// 1. Every round stays well inside the plan's limits (Workers Paid: 1,000 outside calls and 1,000 database calls a request),
//    however busy the mailbox; the app's loop still gets everything.
let cursor = "", rounds = 0, worstFetch = 0, worstDb = 0, more = true;
while (more) {
  fetchCalls = 0; dbCalls = 0;
  const r = await post("/relay/my/gmail/scan", alice, cursor ? { cursor } : {});
  assert.equal(r.status, 200);
  const j = await r.json();
  worstFetch = Math.max(worstFetch, fetchCalls); worstDb = Math.max(worstDb, dbCalls);
  more = j.more; cursor = j.cursor; rounds++;
  assert.ok(rounds < 60, "scan finishes");
}
assert.equal(count(), 120, "every order email captured");
assert.ok(worstFetch <= 130, "outside calls per round: " + worstFetch);
assert.ok(worstDb <= 130, "database calls per round: " + worstDb);
console.log(`ok - 120 emails in ${rounds} rounds; worst round ${worstFetch} outside calls and ${worstDb} database calls (paid plan limit 1,000 each)`);

// 2. A round that hits a limit answers (so the app can retry) instead of failing without a reply.
failNext = 1;
const busy = await post("/relay/my/gmail/scan", alice, {});
assert.equal(busy.status, 503);
assert.deepEqual(await busy.json(), { error: "scan_busy", retryAfterMs: 3000 });
// The scan the app asked for is still waiting to be finished (by the app's next try, or by Relay if the app has gone).
let again = { more: true }, tries = 0;
while (again.more && tries++ < 10) again = await (await post("/relay/my/gmail/scan", alice, {})).json();
assert.equal(again.more, false); assert.equal(again.job.state, "done");
console.log("ok - a failed round answers 'busy' so the app waits and carries on");

// 3. Automatic check: new mail arrives and is picked up without the app being opened.
clock += 2 * 60 * 60 * 1000;
box.m500 = { raw: mail(500), day: ymd(clock) };
fetchCalls = 0; dbCalls = 0;
const auto = await autoScanGmail(env, clock, fetchImpl);
assert.equal(auto.checked, 1);
assert.equal(count(), 121, "new order found automatically");
assert.ok(fetchCalls <= 150 && dbCalls <= 150, `automatic run within limits (${fetchCalls} outside, ${dbCalls} database)`);
const st = await (await call("/relay/my/gmail", { token: alice })).json();
assert.equal(st.autoAt, clock, "the app can say when Relay last checked");
assert.ok(!("token_data" in st) && !JSON.stringify(st).includes("refresh"), "no token in the status answer");
console.log("ok - automatic check finds new mail and records when it ran");

// 4. Someone who withdrew Gmail permission is never checked automatically.
sqlite.prepare("UPDATE shopper_consents SET withdrawn_at = ? WHERE withdrawn_at IS NULL").run(clock);
box.m501 = { raw: mail(501), day: ymd(clock) };
const after = await autoScanGmail(env, clock + 1000, fetchImpl);
assert.equal(after.checked, 0); assert.equal(count() <= 121, true);
console.log("ok - no automatic checking without permission");

// 5. A first-time reader: the automatic check also carries the full read further back each run, a little at a time.
sqlite.prepare("UPDATE shopper_consents SET withdrawn_at = NULL").run();
sqlite.prepare("DELETE FROM captured_receipts").run();
sqlite.prepare("UPDATE gmail_connections SET last_scan_at = NULL, auto_at = NULL, auto_cursor = NULL").run();
let runs = 0;
while (count() < 122 && runs < 80) { clock += 15 * 60 * 1000; await autoScanGmail(env, clock, fetchImpl); runs++; }
assert.equal(count(), 122, "the whole mailbox is read by the automatic checks alone");
console.log(`ok - automatic checks alone read the whole mailbox (${runs} runs)`);

// 6. A retry after a round ran out of time asks for a small round: at most 2 emails are read.
sqlite.prepare("DELETE FROM captured_receipts").run();
const small = await (await post("/relay/my/gmail/scan", alice, { small: true })).json();
assert.ok(small.added <= 2 && small.more === true, "small round reads at most 2 emails: " + small.added);
console.log("ok - a retry asks for a small round (at most 2 emails)");

async function scanAllOnce() { let c = "", more = true, n = 0; sqlite.prepare("DELETE FROM captured_receipts").run(); sqlite.prepare("UPDATE mail_scan_jobs SET state = 'done'").run();
  while (more && n++ < 40) { const j = await (await post("/relay/my/gmail/scan", alice, c ? { cursor: c } : {})).json(); more = j.more; c = j.cursor; } }
// 7. A mailbox read by an older reader is read again in the background, a round a minute, without any message to the
//    shopper (the 15-minute check alone would take days for a busy mailbox). Gmail and Outlook use the same code.
await scanAllOnce();
sqlite.prepare("UPDATE mail_scan_jobs SET state = 'done'").run();
sqlite.prepare("UPDATE captured_receipts SET details = json_set(details, '$.parserVersion', 1)").run();
sqlite.prepare("UPDATE gmail_connections SET full_rev = 1, auto_cursor = NULL, last_scan_at = ?").run(clock);
const stale = () => sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts WHERE json_extract(details, '$.parserVersion') = 1").get().n;
assert.equal(stale(), 122);
emails = [];
let minutes = 0;
while (stale() > 0 && minutes < 30) { clock += 60 * 1000; await catchUpFullReads(env, clock, fetchImpl); minutes++; }
assert.equal(stale(), 0, "every email is read again with the new reader");
assert.ok(minutes <= 5, "a busy mailbox catches up within minutes, not days: " + minutes + " minutes");
for (let i = 0; i < 3; i++) { clock += 60 * 1000; await catchUpFullReads(env, clock, fetchImpl); }
assert.ok(sqlite.prepare("SELECT full_rev AS f FROM gmail_connections").get().f >= 3, "the mailbox is marked as read with this reader");
assert.equal((await catchUpFullReads(env, clock + 60000, fetchImpl)).checked, 0, "and then left alone");
assert.equal(emails.length, 0, "no email or message is sent for a re-read");
assert.equal(count(), 122, "nothing is added twice");
// Not while a scan the shopper started is running (it reads everything itself), and never without permission.
sqlite.prepare("UPDATE gmail_connections SET full_rev = 1").run();
sqlite.prepare("UPDATE mail_scan_jobs SET state = 'running'").run();
assert.equal((await catchUpFullReads(env, clock + 120000, fetchImpl)).checked, 0, "a running scan is left to finish");
sqlite.prepare("UPDATE mail_scan_jobs SET state = 'done'").run();
sqlite.prepare("UPDATE shopper_consents SET withdrawn_at = ?").run(clock);
assert.equal((await catchUpFullReads(env, clock + 180000, fetchImpl)).checked, 0, "no reading after permission is withdrawn");
console.log(`ok - a mailbox read by an older reader catches up in ${minutes} minutes, quietly, and only with permission`);

// 8. A newer reader that arrives part-way through a re-read starts again from the newest mail. (It used to carry on from
//    where the older re-read had got to, mark the mailbox as done at the end, and leave the newest mail with the older reader.)
sqlite.prepare("UPDATE shopper_consents SET withdrawn_at = NULL").run();
sqlite.prepare("UPDATE captured_receipts SET details = json_set(details, '$.parserVersion', 1)").run();
// Where the older re-read had got to, saved the way the previous version saved it (just the day).
sqlite.prepare("UPDATE gmail_connections SET full_rev = 1, auto_cursor = ?").run(ymd(clock - 20 * DAY));
const listedBefore = [];
const watching = async (url, init) => { const w = /before:(\d{4}\/\d{2}\/\d{2})/.exec(decodeURIComponent(String(url))); if (w && String(url).includes("/messages?")) listedBefore.push(w[1]); return fetchImpl(url, init); };
minutes = 0;
while (stale() > 0 && minutes < 30) { clock += 60 * 1000; await catchUpFullReads(env, clock, watching); minutes++; }
assert.equal(stale(), 0, "the newest mail is read again too, not only what was older than the old place");
assert.equal(listedBefore[0], ymd(clock + DAY - (minutes - 1) * 60 * 1000), "the re-read starts from the newest mail");
// Part-way through, the place is saved with the read it belongs to, and the next minute carries on from it.
sqlite.prepare("UPDATE captured_receipts SET details = json_set(details, '$.parserVersion', 1)").run();
sqlite.prepare("UPDATE gmail_connections SET full_rev = 1, auto_cursor = NULL").run();
listedBefore.length = 0;
clock += 60 * 1000; await catchUpFullReads(env, clock, watching);
const saved = sqlite.prepare("SELECT auto_cursor AS c FROM gmail_connections").get().c;
assert.match(saved, /^\d+@\d{4}\/\d{2}\/\d{2}$/, "the saved place says which read it belongs to: " + saved);
const firstRound = listedBefore.length;
clock += 60 * 1000; await catchUpFullReads(env, clock, watching);
assert.equal(listedBefore[firstRound], saved.split("@")[1], "the next minute carries on from the saved place");
while (stale() > 0 && minutes < 60) { clock += 60 * 1000; await catchUpFullReads(env, clock, watching); minutes++; }
assert.equal(stale(), 0);
console.log("ok - a newer reader arriving part-way through a re-read starts again from the newest mail; within one read, each minute carries on");

// 9. Earlier years the shopper added for Wrapped are read again too, once the look-back period is done, newest year first.
for (let i = 0; i < 30; i++) box["m" + (2400 + i)] = { raw: mail(2400 + i), day: "2024/" + String(1 + (i % 12)).padStart(2, "0") + "/1" + (i % 9) };
for (let i = 0; i < 12; i++) box["m" + (2300 + i)] = { raw: mail(2300 + i), day: "2023/" + String(1 + i).padStart(2, "0") + "/05" };
// The shopper adds 2024 and 2023 in Wrapped (the app reads each year a round at a time).
for (const year of [2024, 2023]) { let c = "", more = true, n = 0; while (more && n++ < 40) { const j = await (await post("/relay/my/gmail/scan", alice, { year, ...(c ? { cursor: c } : {}) })).json(); more = j.more; c = j.cursor; } }
const yearRows = () => sqlite.prepare("SELECT year, done_at AS d, rev, cursor FROM gmail_history_years ORDER BY year").all();
assert.deepEqual(yearRows().map(y => [y.year, Boolean(y.d), y.rev]), [[2023, true, 5], [2024, true, 5]], "a finished year records the reader it was read with");
const inYear = y => `json_extract(details, '$.orderRef') LIKE 'EO-${y}__'`;
const staleIn = y => sqlite.prepare(`SELECT COUNT(*) n FROM captured_receipts WHERE ${inYear(y)} AND json_extract(details, '$.parserVersion') = 1`).get().n;
// Then a better reader arrives: the recent mail and both years were read by the older one.
sqlite.prepare("UPDATE captured_receipts SET details = json_set(details, '$.parserVersion', 1)").run();
sqlite.prepare("UPDATE gmail_history_years SET rev = 4").run();
sqlite.prepare("UPDATE gmail_connections SET full_rev = 4, auto_cursor = NULL").run();
assert.equal(staleIn(24), 30); assert.equal(staleIn(23), 12);
const order = [];
for (let m = 0; m < 60 && (stale() > 0); m++) {
  clock += 60 * 1000;
  const r = await catchUpFullReads(env, clock, watching);
  for (const x of r.results) order.push(x.year || "recent");
}
assert.equal(stale(), 0, "every email is read with the new reader, earlier years included");
assert.equal(order.indexOf(2024) > order.lastIndexOf("recent"), true, "the look-back period first, then the earlier years");
assert.equal(order.indexOf(2023) > order.lastIndexOf(2024), true, "newest year first");
assert.deepEqual(yearRows().map(y => [y.year, y.rev, y.cursor]), [[2023, 5, null], [2024, 5, null]], "each year is marked as read with this reader");
assert.equal((await catchUpFullReads(env, clock + 60000, fetchImpl)).checked, 0, "and then left alone");
assert.equal(emails.length, 0, "no email or message is sent for a re-read");
console.log("ok - earlier years added for Wrapped are read again by a newer reader once the recent mail is done, newest first");
