// Offline tests for the consent record and Gmail connection, against a real SQLite engine.
// Google and Gmail are FAKED here: this proves Relay's own rules (consent first, state binding,
// encrypted token, no email bodies kept, disconnect/delete) but NOT that real Google accepts our
// settings. Real Gmail needs the Google Cloud setup and a live test with a test user.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION } from "../worker/gmail.js";

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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key",
  GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test" };

const REFRESH = "1//refresh-token-PLAINTEXT-marker";
const b64url = s => Buffer.from(s).toString("base64url");
const receiptMail = (n) => `From: Example Outfitters <orders@exampleoutfitters.test>\nSubject: Your order confirmation #EO-${n}\nContent-Type: text/plain\n\nOrder number: EO-${n}\nOrder date: 14 Oct 2026\nWool jumper - Qty 1 - £59.00\nOrder total: £59.00\nReturns accepted within 30 days of purchase.\nPRIVATE-BODY-MARKER-${n}\n`;
const newsletter = `From: Shop <news@shop.test>\nSubject: 50% off this weekend\nContent-Type: text/plain\n\nJumpers from £19.99 PRIVATE-BODY-MARKER-news`;
const gmailBox = { m1: receiptMail(1), m2: newsletter, m3: receiptMail(3) };
let calls = [];
let refreshOk = true;
let emails = [];
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  calls.push({ url, body: init.body ? String(init.body) : "", auth: init.headers && init.headers.Authorization });
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  if (url === "https://oauth2.googleapis.com/token") {
    const p = new URLSearchParams(String(init.body));
    if (p.get("grant_type") === "authorization_code")
      return p.get("code") === "good-code"
        ? Response.json({ access_token: "access-1", refresh_token: REFRESH, scope: "https://www.googleapis.com/auth/gmail.readonly" })
        : p.get("code") === "narrow-scope"
          ? Response.json({ access_token: "a", refresh_token: REFRESH, scope: "openid" })
          : new Response("{}", { status: 400 });
    return refreshOk ? Response.json({ access_token: "access-2" }) : new Response("{}", { status: 400 });
  }
  if (url === "https://oauth2.googleapis.com/revoke") return new Response("{}", { status: 200 });
  if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") return Response.json({ emailAddress: "alice.gmail@gmail.com" });
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
    assert.ok(decodeURIComponent(url).includes("newer_than:180d"), "search is limited in time");
    return Response.json({ messages: Object.keys(gmailBox).map(id => ({ id: id + "abcdef" })) });
  }
  const one = /messages\/(m\d)abcdef\?format=raw$/.exec(url);
  if (one) return Response.json({ raw: b64url(gmailBox[one[1]]) });
  return new Response("blocked", { status: 500 });
};
let clock = 1_800_000_000_000;
const call = (path, { method = "GET", body, token, ip = "1.1.1.1", e = env } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), e, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const alice = await signIn("alice@example.com", "5.5.5.5");
const bob = await signIn("bob@example.com", "6.6.6.6");
const post = (path, token, body) => call(path, { method: "POST", token, body });
const stateFrom = async token => new URL((await (await post("/relay/my/gmail/connect", token)).json()).url).searchParams.get("state");
const cb = (qs) => call("/relay/gmail/callback?" + qs);

// 1. Consent screen text is served by the server; nothing works before consent.
let r = await call("/relay/my/consent", { token: alice });
const consent = await r.json();
assert.equal(consent.accepted, false);
assert.equal(consent.version, CONSENT_VERSION);
assert.ok(consent.text.join(" ").includes("read-only") && consent.text.join(" ").includes("cannot start an automatic refund"));
assert.equal((await call("/relay/my/consent")).status, 401, "consent needs sign-in");
assert.equal((await post("/relay/my/gmail/connect", alice)).status, 403, "no Gmail connection without consent");
assert.equal((await post("/relay/my/gmail/scan", alice)).status, 403, "no scan without consent");
assert.equal((await post("/relay/my/consent", alice, { version: "old-version" })).status, 400, "only the current wording can be accepted");
assert.equal((await post("/relay/my/consent", alice, { version: CONSENT_VERSION })).status, 200);
assert.equal((await (await call("/relay/my/consent", { token: alice })).json()).accepted, true);
assert.equal((await (await call("/relay/my/consent", { token: bob })).json()).accepted, false, "consent is per shopper");
const rec = sqlite.prepare("SELECT version, text_hash FROM shopper_consents").all();
assert.equal(rec.length, 1);
assert.match(rec[0].text_hash, /^[0-9a-f]{64}$/, "wording hash recorded");

// 2. Not configured is reported honestly.
assert.equal((await call("/relay/my/gmail/connect", { method: "POST", token: alice, e: { ...env, GOOGLE_CLIENT_ID: undefined } })).status, 503);

// 3. Connect URL: read-only scope, offline access, state bound to the shopper.
r = await post("/relay/my/gmail/connect", alice);
assert.equal(r.status, 200);
const authUrl = new URL((await r.json()).url);
assert.equal(authUrl.origin + authUrl.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
assert.equal(authUrl.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.readonly");
assert.equal(authUrl.searchParams.get("access_type"), "offline");
assert.equal(authUrl.searchParams.get("redirect_uri"), "https://w.test/relay/gmail/callback");
const state = authUrl.searchParams.get("state");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gmail_oauth_states WHERE state_hash = ?").get(state).n, 0, "raw state never stored");

// 4. Callback: bad/forged/used/expired states are refused; good one connects Alice only.
const loc = res => res.headers.get("location");
assert.match(loc(await cb("code=good-code&state=" + "x".repeat(43))), /#gmail=failed$/, "unknown state refused");
assert.match(loc(await cb("code=good-code")), /#gmail=failed$/);
assert.match(loc(await cb("error=access_denied&state=" + state)), /#gmail=denied$/);
assert.match(loc(await cb("code=narrow-scope&state=" + state)), /#gmail=failed$/, "must have granted the Gmail read scope");
const s2 = await stateFrom(alice);
assert.match(loc(await cb("code=good-code&state=" + s2)), /#gmail=connected$/);
assert.match(loc(await cb("code=good-code&state=" + s2)), /#gmail=failed$/, "state is single-use");
const s3 = await stateFrom(alice);
clock += 11 * 60 * 1000;
assert.match(loc(await cb("code=good-code&state=" + s3)), /#gmail=failed$/, "state expires after 10 minutes");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gmail_connections").get().n, 1);
assert.equal((await (await call("/relay/my/gmail", { token: alice })).json()).connected, true);
assert.equal((await (await call("/relay/my/gmail", { token: bob })).json()).connected, false, "Bob is not connected");

// 5. Refresh token is encrypted at rest.
const stored = JSON.stringify(sqlite.prepare("SELECT * FROM gmail_connections").all());
assert.ok(!stored.includes("PLAINTEXT-marker") && !stored.includes("refresh-token"), "refresh token never stored in clear");

// 6. Consent is re-checked at the callback (withdrawn mid-flow means no connection).
// (covered below with withdraw)

// 7. Scan: receipts kept as extracted fields only; newsletters ignored; duplicates skipped.
calls = [];
r = await post("/relay/my/gmail/scan", alice);
assert.equal(r.status, 200);
assert.deepEqual(await r.json(), { ok: true, added: 2, updated: 0, alreadyCaptured: 0, notReceipts: 1 });
assert.ok(calls.every(c => !c.url.includes("/send") && !c.url.includes("modify") && !c.url.includes("delete")), "only read calls to Gmail");
assert.ok(calls.filter(c => c.url.includes("gmail.googleapis")).every(c => c.auth === "Bearer access-2"));
const dump = JSON.stringify(sqlite.prepare("SELECT * FROM captured_receipts").all());
assert.ok(!dump.includes("PRIVATE-BODY-MARKER"), "email text is never stored");
assert.ok(dump.includes("EO-1") && dump.includes("5900"));
r = await post("/relay/my/gmail/scan", alice);
assert.deepEqual(await r.json(), { ok: true, added: 0, updated: 0, alreadyCaptured: 2, notReceipts: 1 });
// Return details are stored as extracted fields, and receipts captured before they existed get them added once.
let rows = sqlite.prepare("SELECT details FROM captured_receipts").all().map(x => JSON.parse(x.details));
assert.ok(rows.every(d => d.returns && d.returns.windowDays === 30 && d.returns.deadline === "2026-11-13"), "return window and deadline kept");
sqlite.prepare("UPDATE captured_receipts SET details = json_remove(details, '$.parserVersion'), status = 'pending' WHERE message_ref = (SELECT message_ref FROM captured_receipts LIMIT 1)").run();
r = await post("/relay/my/gmail/scan", alice);
assert.deepEqual(await r.json(), { ok: true, added: 0, updated: 1, alreadyCaptured: 1, notReceipts: 1 }, "old receipt re-read once with the newer reader");
rows = sqlite.prepare("SELECT details FROM captured_receipts").all().map(x => JSON.parse(x.details));
assert.ok(rows.every(d => d.returns && d.returns.windowDays === 30));
assert.ok(!JSON.stringify(rows).includes("PRIVATE-BODY-MARKER"), "email text still never stored");
r = await post("/relay/my/gmail/scan", alice);
assert.deepEqual(await r.json(), { ok: true, added: 0, updated: 0, alreadyCaptured: 2, notReceipts: 1 }, "no repeat re-read");
// (the newsletter is re-read each scan because only receipts are remembered)

// 8. Captured receipts: private to the shopper, never refund-eligible, can be confirmed or dismissed.
const mine = (await (await call("/relay/my/receipts", { token: alice })).json()).receipts;
assert.equal(mine.length, 2);
assert.ok(mine.every(x => x.refundEligible === false && x.source === "shopper_email" && x.status === "pending"));
assert.deepEqual((await (await call("/relay/my/receipts", { token: bob })).json()).receipts, [], "Bob sees nothing of Alice's");
assert.equal((await post(`/relay/my/receipts/${mine[0].id}/confirm`, bob)).status, 404, "cannot touch another shopper's receipt");
assert.equal((await post(`/relay/my/receipts/${mine[0].id}/confirm`, alice)).status, 200);
assert.equal((await post(`/relay/my/receipts/${mine[1].id}/dismiss`, alice)).status, 200);
const after = (await (await call("/relay/my/receipts", { token: alice })).json()).receipts;
assert.deepEqual(after.map(x => x.status), ["confirmed"]);

// 9. Google rejecting the stored connection is reported, not hidden.
refreshOk = false;
assert.equal((await post("/relay/my/gmail/scan", alice)).status, 401);
refreshOk = true;
assert.equal((await post("/relay/my/gmail/scan", bob)).status, 403, "Bob has no consent");
await post("/relay/my/consent", bob, { version: CONSENT_VERSION });
assert.equal((await post("/relay/my/gmail/scan", bob)).status, 409, "Bob consented but has not connected Gmail");

// 10. Disconnect revokes at Google and deletes the token and captured receipts.
calls = [];
r = await post("/relay/my/gmail/disconnect", alice);
const disc = await r.json();
assert.equal(disc.deleted, true);
assert.equal(disc.revokedAtGoogle, true);
assert.ok(calls.some(c => c.url === "https://oauth2.googleapis.com/revoke" && c.body.includes("PLAINTEXT-marker")));
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gmail_connections").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts").get().n, 0);
assert.equal((await (await call("/relay/my/consent", { token: alice })).json()).accepted, true, "disconnect alone keeps consent");

// 11. Withdrawing consent disconnects, deletes, and blocks further access.
const s4 = await stateFrom(alice);
assert.match(loc(await cb("code=good-code&state=" + s4)), /#gmail=connected$/);
await post("/relay/my/gmail/scan", alice);
const s5 = await stateFrom(alice);
await post("/relay/my/consent/withdraw", alice);
assert.match(loc(await cb("code=good-code&state=" + s5)), /#gmail=consent_needed$/, "withdrawn consent blocks a flow already in progress");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts WHERE shopper_id IN (SELECT id FROM shoppers WHERE email='alice@example.com')").get().n, 0);
assert.equal((await (await call("/relay/my/consent", { token: alice })).json()).accepted, false);
assert.equal((await post("/relay/my/gmail/connect", alice)).status, 403);
assert.equal((await post("/relay/my/gmail/scan", alice)).status, 403);

// 12. Deleting the account removes every Gmail-related row.
await post("/relay/my/consent", bob, { version: CONSENT_VERSION });
const s6 = await stateFrom(bob);
await cb("code=good-code&state=" + s6);
await post("/relay/my/gmail/scan", bob);
assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts").get().n > 0);
assert.equal((await post("/relay/my/delete", bob)).status, 200);
for (const t of ["captured_receipts", "gmail_connections", "gmail_oauth_states", "shopper_consents"])
  assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM ${t} WHERE shopper_id NOT IN (SELECT id FROM shoppers)`).get().n, 0, t + " cleaned on account deletion");

console.log("PASS consent record, Gmail connect/callback rules, encrypted token, receipts-only scan, privacy of captured receipts, disconnect, withdrawal and deletion (FAKE Google and Gmail)");
