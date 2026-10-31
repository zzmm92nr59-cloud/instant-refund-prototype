// Offline tests (FAKE Google and Gmail, real SQLite) for Gmail scanning within Cloudflare's free-plan limits
// (50 outside calls and 50 database calls per request) and for the automatic every-15-minutes check.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, autoScanGmail } from "../worker/gmail.js";

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

// 1. Every round stays well inside the free plan's limits, however busy the mailbox; the app's loop still gets everything.
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
assert.ok(worstFetch <= 40, "outside calls per round: " + worstFetch);
assert.ok(worstDb <= 40, "database calls per round: " + worstDb);
console.log(`ok - 120 emails in ${rounds} rounds; worst round ${worstFetch} outside calls and ${worstDb} database calls (limit 50 each)`);

// 2. A round that hits a limit answers (so the app can retry) instead of failing without a reply.
failNext = 1;
const busy = await post("/relay/my/gmail/scan", alice, {});
assert.equal(busy.status, 503);
assert.deepEqual(await busy.json(), { error: "scan_busy", retryAfterMs: 3000 });
console.log("ok - a failed round answers 'busy' so the app waits and carries on");

// 3. Automatic check: new mail arrives and is picked up without the app being opened.
clock += 2 * 60 * 60 * 1000;
box.m500 = { raw: mail(500), day: ymd(clock) };
fetchCalls = 0; dbCalls = 0;
const auto = await autoScanGmail(env, clock, fetchImpl);
assert.equal(auto.checked, 1);
assert.equal(count(), 121, "new order found automatically");
assert.ok(fetchCalls <= 45 && dbCalls <= 45, `automatic run within limits (${fetchCalls} outside, ${dbCalls} database)`);
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
