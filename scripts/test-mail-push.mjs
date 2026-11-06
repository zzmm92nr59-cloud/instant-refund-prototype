// Offline tests for instant email (worker/mail-push.js), against a real SQLite engine. Google's Pub/Sub, Gmail and
// Microsoft Graph are FAKED here: this proves Relay's own rules (only Google-signed Gmail notices and only notices with the
// subscription's secret are acted on; a notice reads the inbox at once with the usual reader; one read per inbox at a time;
// set-up, renewal, lifecycle notices, disconnecting and permission) but NOT that real Google and Microsoft accept Relay's
// settings. That needs the Google Cloud set-up in docs/MAIL_PUSH_SETUP.md and a live test with a real inbox.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, autoScanGmail } from "../worker/gmail.js";
import { handleMailPushRoute, renewMailPush, runPendingPush, pushRead, parseGmailNotice, resetGoogleKeys, RECHECK_MS, RENEW_WHEN_LEFT, RETRY_AFTER } from "../worker/mail-push.js";
import { checkRateLimits, resetMemoryLimits } from "../worker/limits.js";

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
const SA = "relay-push@relay-test-123.iam.gserviceaccount.com";
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key",
  GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test",
  MICROSOFT_CLIENT_ID: "11111111-2222-3333-4444-555555555555", MICROSOFT_CLIENT_SECRET: "ms-secret-test",
  GMAIL_PUSH_TOPIC: "projects/relay-test-123/topics/relay-gmail", GMAIL_PUSH_SERVICE_ACCOUNT: SA, RELAY_API_ORIGIN: "https://w.test" };
const MS = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DAY = 864e5, MIN = 6e4;
let clock = Date.UTC(2026, 10, 6, 12);
const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "/");
const iso = ms => new Date(ms).toISOString();
const b64url = s => Buffer.from(s).toString("base64url");
const mail = (n) => `From: Example Outfitters <orders@exampleoutfitters.test>\nSubject: Your order confirmation #EO-${n}\nContent-Type: text/plain\n\nOrder number: EO-${n}\nOrder date: 6 Nov 2026\nWool jumper - Qty 1 - £59.00\nOrder total: £59.00\nPRIVATE-BODY-${n}\n`;

// ---- Google's signing keys (the real one, and someone else's) ----
const keyPair = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const google = await keyPair(), stranger = await keyPair();
const googleJwk = { ...(await crypto.subtle.exportKey("jwk", google.publicKey)), kid: "google-key-1", alg: "RS256", use: "sig" };
async function signed(claims, { key = google.privateKey, kid = "google-key-1" } = {}) {
  const head = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })), body = b64url(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + body)));
  return head + "." + body + "." + Buffer.from(sig).toString("base64url");
}
const goodClaims = (over = {}) => ({ iss: "https://accounts.google.com", aud: "https://w.test/relay/webhooks/gmail", azp: "1234", email: SA, email_verified: true,
  sub: "1234", iat: Math.floor(clock / 1000) - 5, exp: Math.floor(clock / 1000) + 3595, ...over });

// ---- The fake Gmail mailbox (Alice) ----
let historyId = 5000;
const gbox = [];   // { id, raw, at, hist, indexed }
function gmailArrives(n, { indexed = true, junkHistory = false } = {}) {
  historyId += 7;
  const m = { id: "msg" + n + "abcdef", raw: mail(n), at: clock, hist: historyId, indexed, added: !junkHistory };
  gbox.push(m);
  return m;
}
const gmailCalls = [], watchBodies = [];
let watchFails = 0, rejectBehaviour = false, stops = 0;
// ---- The fake Outlook mailbox (Bob) and Microsoft Graph ----
const obox = [];
const subs = new Map();   // id -> { body, expires }
let subCount = 0;
const graphCalls = [];
let emails = [];
const ctxPromises = [];
const ctx = { waitUntil: p => ctxPromises.push(p) };
const flush = async () => { while (ctxPromises.length) await ctxPromises.shift(); };
const opts = () => ({ fetchImpl, now: () => clock });
const pushCall = (path, { body = "", headers = {}, query = "" } = {}) => {
  const url = new URL("https://w.test" + path + query);
  return handleMailPushRoute(new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body }), env, url, ctx, opts());
};

const fetchImpl = async (url, init = {}) => {
  url = String(url);
  const method = init.method || "GET", u = new URL(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [googleJwk] }, { headers: { "cache-control": "public, max-age=19000" } });
  if (url === "https://oauth2.googleapis.com/token") {
    const p = new URLSearchParams(String(init.body));
    return Response.json(p.get("grant_type") === "authorization_code"
      ? { access_token: "g-access-1", refresh_token: "1//g-refresh-PLAINTEXT", scope: "https://www.googleapis.com/auth/gmail.readonly" } : { access_token: "g-access-2" });
  }
  if (url === "https://oauth2.googleapis.com/revoke") return new Response("{}");
  if (url.startsWith(GMAIL)) {
    gmailCalls.push({ url, method, body: init.body ? String(init.body) : "" });
    if (u.pathname.endsWith("/profile")) return Response.json({ emailAddress: "alice@gmail.test", historyId: String(historyId) });
    if (u.pathname.endsWith("/watch")) {
      const body = JSON.parse(init.body);
      watchBodies.push(body);
      if (watchFails > 0) { watchFails--; return new Response('{"error":{"code":500}}', { status: 500 }); }
      if (rejectBehaviour && body.labelFilterBehavior) return new Response('{"error":{"code":400}}', { status: 400 });
      return Response.json({ historyId: String(historyId), expiration: String(clock + 7 * DAY) });
    }
    if (u.pathname.endsWith("/stop")) { stops++; return new Response(null, { status: 204 }); }
    if (u.pathname.endsWith("/history")) {
      assert.equal(u.searchParams.get("historyTypes"), "messageAdded");
      assert.equal(u.searchParams.get("labelId"), "INBOX");
      const start = Number(u.searchParams.get("startHistoryId"));
      if (start < 4000) return new Response('{"error":{"code":404}}', { status: 404 });
      const added = gbox.filter(m => m.hist > start && m.added);
      return Response.json({ history: added.map(m => ({ id: String(m.hist), messagesAdded: [{ message: { id: m.id, labelIds: ["INBOX"] } }] })), historyId: String(historyId) });
    }
    if (u.pathname.endsWith("/messages") && u.searchParams.get("q")) {
      const w = /after:(\S+) before:(\S+)/.exec(u.searchParams.get("q"));
      const ids = gbox.filter(m => m.indexed && ymd(m.at) >= w[1] && ymd(m.at) < w[2]).map(m => ({ id: m.id }));
      return Response.json({ messages: ids });
    }
    const one = /\/messages\/([A-Za-z0-9]+)$/.exec(u.pathname);
    if (one) { const m = gbox.find(x => x.id === one[1]); return m ? Response.json({ raw: b64url(m.raw) }) : new Response("{}", { status: 404 }); }
    return new Response("nope", { status: 404 });
  }
  if (url === MS + "/token") {
    const p = new URLSearchParams(String(init.body));
    if (p.get("grant_type") === "authorization_code") return Response.json({ access_token: "ms-access-1", refresh_token: "MSREFRESH-PLAINTEXT", scope: "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read" });
    return Response.json({ access_token: "ms-access-2" });
  }
  if (url.startsWith(GRAPH)) {
    graphCalls.push({ url, method, body: init.body ? String(init.body) : "" });
    if (u.pathname === "/v1.0/me") return Response.json({ mail: null, userPrincipalName: "bob@outlook.test" });
    if (u.pathname === "/v1.0/subscriptions" && method === "POST") {
      const body = JSON.parse(init.body);
      // Microsoft checks both addresses before it makes the subscription: each must send the token straight back.
      for (const target of [body.notificationUrl, body.lifecycleNotificationUrl]) {
        const t = new URL(target);
        const res = await pushCall(t.pathname, { query: "?validationToken=" + encodeURIComponent("Validation: Testing client application reachability for subscription Request-Id: 1a2b") });
        assert.equal(res.status, 200);
        assert.match(res.headers.get("content-type"), /^text\/plain/);
        assert.equal(await res.text(), "Validation: Testing client application reachability for subscription Request-Id: 1a2b");
      }
      const id = "5f9c0e1a-0000-4000-8000-" + String(++subCount).padStart(12, "0");
      subs.set(id, { body, expires: Date.parse(body.expirationDateTime) });
      return Response.json({ id, expirationDateTime: body.expirationDateTime, resource: body.resource }, { status: 201 });
    }
    const sub = /^\/v1\.0\/subscriptions\/([A-Za-z0-9-]+)$/.exec(u.pathname);
    if (sub && method === "PATCH") {
      if (!subs.has(sub[1])) return new Response('{"error":{"code":"ResourceNotFound"}}', { status: 404 });
      const body = JSON.parse(init.body);
      subs.get(sub[1]).expires = Date.parse(body.expirationDateTime);
      return Response.json({ id: sub[1], expirationDateTime: body.expirationDateTime });
    }
    if (sub && method === "DELETE") { subs.delete(sub[1]); return new Response(null, { status: 204 }); }
    if (u.pathname === "/v1.0/me/mailFolders/junkemail") return Response.json({ id: "JUNK" });
    if (u.pathname === "/v1.0/me/mailFolders/deleteditems") return Response.json({ id: "BIN" });
    if (u.pathname === "/v1.0/me/messages") {
      const f = /^receivedDateTime ge (\S+) and receivedDateTime lt (\S+)$/.exec(u.searchParams.get("$filter") || "");
      const lo = Date.parse(f[1]), hi = Date.parse(f[2]);
      return Response.json({ value: obox.filter(m => m.at >= lo && m.at < hi).map(m => ({ id: m.id, internetMessageId: m.mid, subject: "Your order confirmation #" + m.n,
        from: { emailAddress: { name: "Example Outfitters", address: "orders@exampleoutfitters.test" } }, receivedDateTime: iso(m.at), parentFolderId: "INBOX" })) });
    }
    const raw = /^\/v1\.0\/me\/messages\/([^/]+)\/\$value$/.exec(u.pathname);
    if (raw) { const m = obox.find(x => x.id === decodeURIComponent(raw[1])); return m ? new Response(m.raw) : new Response("{}", { status: 404 }); }
    return new Response("blocked", { status: 500 });
  }
  return new Response("blocked", { status: 500 });
};
function outlookArrives(n) {
  const m = { id: "AQMkADAwATM0-order" + n, mid: "<eo-" + n + "@mail.exampleoutfitters.test>", n, at: clock,
    raw: `From: Example Outfitters <orders@exampleoutfitters.test>\r\nSubject: Your order confirmation #EO-${n}\r\nMessage-ID: <eo-${n}@mail.exampleoutfitters.test>\r\nDate: ${new Date(clock).toUTCString()}\r\nContent-Type: text/plain\r\n\r\n` +
      `Order number: EO-${n}\nOrder date: 6 Nov 2026\nWool jumper - Qty 1 - £59.00\nOrder total: £59.00\nPRIVATE-BODY-${n}\n` };
  obox.push(m);
  return m;
}

// ---- Two shoppers: Alice reads Gmail in Relay, Bob reads Outlook ----
const call = (path, { method = "GET", body, token } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "5.5.5.5", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
const post = (path, token, body) => call(path, { method: "POST", token, body });
async function signIn(email) {
  emails = [];
  await post("/relay/auth/request", null, { email });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await post("/relay/auth/verify", null, { token: link })).json()).sessionToken;
}
const alice = await signIn("alice@example.com"), bob = await signIn("bob@example.com");
for (const t of [alice, bob]) assert.equal((await post("/relay/my/consent", t, { version: CONSENT_VERSION })).status, 200);
const gstate = new URL((await (await post("/relay/my/gmail/connect", alice)).json()).url).searchParams.get("state");
assert.match((await call("/relay/gmail/callback?code=good&state=" + gstate)).headers.get("location"), /#gmail=connected$/);
const mstate = new URL((await (await post("/relay/my/gmail/connect", bob, { provider: "microsoft" })).json()).url).searchParams.get("state");
assert.match((await call("/relay/microsoft/callback?code=mail-good&state=" + mstate)).headers.get("location"), /#outlook=connected$/);
// (Each connection starts its first full read; that's tested elsewhere. Here it has finished.)
sqlite.prepare("UPDATE mail_scan_jobs SET state = 'done'").run();
const aliceBox = sqlite.prepare("SELECT shopper_id FROM gmail_connections WHERE provider IS NULL").get().shopper_id;
const bobBox = sqlite.prepare("SELECT shopper_id FROM gmail_connections WHERE provider = 'microsoft'").get().shopper_id;
const row = id => sqlite.prepare("SELECT * FROM gmail_connections WHERE shopper_id = ?").get(id);
const receipts = id => sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts WHERE shopper_id = ? AND status != 'not_receipt'").get(id).n;
const notice = (over = {}) => JSON.stringify({ message: { data: Buffer.from(JSON.stringify({ emailAddress: "alice@gmail.test", historyId: historyId, ...over })).toString("base64"),
  messageId: "1234567890", message_id: "1234567890", publishTime: iso(clock), publish_time: iso(clock), attributes: {} }, subscription: "projects/relay-test-123/subscriptions/relay-gmail-push" });
const gmailPost = async (body, token) => pushCall("/relay/webhooks/gmail", { body, headers: token === null ? {} : { authorization: "Bearer " + (token || await signed(goodClaims())) } });

// ---- 1. Off until set up ----
{
  const off = { ...env, GMAIL_PUSH_TOPIC: undefined };
  assert.deepEqual(await renewMailPush({ ...env, MAIL_PUSH: "off" }, { fetchImpl, now: clock }), { renewed: 0, failed: 0 }, "MAIL_PUSH=off stops both");
  const url = new URL("https://w.test/relay/webhooks/gmail");
  assert.equal((await handleMailPushRoute(new Request(url, { method: "POST", body: notice() }), off, url, ctx, opts())).status, 404, "no Gmail notices without the topic set");
  assert.equal(watchBodies.length, 0);
  assert.equal((await handleMailPushRoute(new Request(url, { method: "GET" }), env, url, ctx, opts())).status, 405);
  assert.equal(await handleMailPushRoute(new Request("https://w.test/relay/webhooks/other", { method: "POST" }), env, new URL("https://w.test/relay/webhooks/other"), ctx, opts()), null);
  const g = await (await call("/relay/my/gmail", { token: alice })).json();
  assert.equal(g.instant, false, "the app keeps saying 'every 15 minutes' until notices are set up");
  console.log("ok - off until set up: no watch, no subscription, notices refused, the app isn't told it's instant");
}

// ---- 2. Set-up: a Gmail watch for Alice, an Outlook subscription for Bob ----
{
  const r = await renewMailPush(env, { fetchImpl, now: clock });
  assert.deepEqual(r, { renewed: 2, failed: 0 });
  assert.equal(watchBodies.length, 1);
  assert.deepEqual(watchBodies[0], { topicName: "projects/relay-test-123/topics/relay-gmail", labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" });
  assert.equal(row(aliceBox).push_expires_at, clock + 7 * DAY);
  assert.equal(row(aliceBox).push_history, String(historyId), "Gmail's history number at the start");
  assert.equal(subs.size, 1);
  const [subId, sub] = [...subs][0];
  assert.equal(sub.body.changeType, "created");
  assert.equal(sub.body.resource, "me/messages");
  assert.equal(sub.body.notificationUrl, "https://w.test/relay/webhooks/outlook");
  assert.equal(sub.body.lifecycleNotificationUrl, "https://w.test/relay/webhooks/outlook/lifecycle");
  assert.ok(sub.expires - clock < 7 * DAY && sub.expires - clock > 6.5 * DAY, "just under Microsoft's 7-day limit");
  assert.ok(sub.body.clientState.length >= 40, "a long random secret");
  const b = row(bobBox);
  assert.equal(b.push_ref, subId);
  assert.notEqual(b.push_secret, sub.body.clientState, "only a hash of the secret is kept");
  assert.equal(b.push_secret.length, 64);
  assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM gmail_connections").all()).includes(sub.body.clientState), "the secret itself is nowhere in the database");
  assert.equal((await (await call("/relay/my/gmail", { token: alice })).json()).instant, true);
  assert.equal((await (await call("/relay/my/gmail", { token: bob })).json()).instant, true);
  // Nothing is set up twice.
  assert.deepEqual(await renewMailPush(env, { fetchImpl, now: clock + MIN }), { renewed: 0, failed: 0 });
  console.log("ok - set-up: Gmail watches the inbox for Relay's topic, Outlook subscribes to new mail after checking Relay's addresses; only a hash of the secret is kept");
}

// ---- 3. A new Gmail email is read the moment Google's notice comes ----
{
  clock += 10 * MIN;
  const before = receipts(aliceBox);
  gmailArrives(1);
  gmailCalls.length = 0;
  const res = await gmailPost(notice());
  assert.equal(res.status, 204, "acknowledged at once");
  await flush();
  assert.equal(receipts(aliceBox), before + 1, "the receipt is in Relay straight after the notice");
  assert.equal(row(aliceBox).push_history, String(historyId), "read up to Gmail's newest history number");
  assert.equal(row(aliceBox).auto_at, clock, "counts as a check ('Last checked')");
  const listed = gmailCalls.filter(c => c.url.includes("/messages?"));
  assert.equal(listed.length, 1, "one search");
  const q = decodeURIComponent(new URL(listed[0].url).searchParams.get("q"));
  assert.match(q, new RegExp("after:" + ymd(clock - 2 * DAY) + " before:" + ymd(clock + DAY)), "the newest few days only, with the usual receipts search: " + q);
  assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM captured_receipts").all()).includes("PRIVATE-BODY"), "no email text kept");
  console.log("ok - a Gmail notice signed by Google reads the inbox's newest mail at once, with the usual receipts search");
}

// ---- 4. Notices that add nothing are cheap ----
{
  clock += MIN;
  historyId += 3;     // an email was read or starred: Gmail sends a notice, but nothing was added to the inbox
  gmailCalls.length = 0;
  assert.equal((await gmailPost(notice())).status, 204);
  await flush();
  assert.equal(gmailCalls.filter(c => c.url.includes("/messages?")).length, 0, "no search when nothing was added");
  assert.equal(gmailCalls.filter(c => c.url.includes("/history?")).length, 1);
  // The same notice again (Pub/Sub can deliver twice): nothing at all.
  gmailCalls.length = 0;
  assert.equal((await gmailPost(notice())).status, 204);
  await flush();
  assert.equal(gmailCalls.length, 0, "a notice no newer than what was read is ignored");
  console.log("ok - a notice for an email being read adds no search; a repeated notice does nothing");
}

// ---- 5. Only Google's own notices count ----
{
  clock += MIN;
  gmailArrives(2);
  const before = receipts(aliceBox);
  gmailCalls.length = 0;
  const forged = [
    ["no token", null],
    ["someone else's key", await signed(goodClaims(), { key: stranger.privateKey })],
    ["an unknown key", await signed(goodClaims(), { key: stranger.privateKey, kid: "made-up" })],
    ["for another address", await signed(goodClaims({ aud: "https://evil.test/relay/webhooks/gmail" }))],
    ["another service account", await signed(goodClaims({ email: "attacker@evil-project.iam.gserviceaccount.com" }))],
    ["unverified account", await signed(goodClaims({ email_verified: false }))],
    ["expired", await signed(goodClaims({ exp: Math.floor(clock / 1000) - 3600 }))],
    ["not from Google", await signed(goodClaims({ iss: "https://evil.test" }))],
    ["garbage", "not.a.token"],
  ];
  for (const [what, token] of forged) assert.equal((await gmailPost(notice(), token)).status, 401, what);
  const alg = b64url(JSON.stringify({ alg: "none", kid: "google-key-1" })) + "." + b64url(JSON.stringify(goodClaims())) + "." + "A".repeat(43);
  assert.equal((await gmailPost(notice(), alg)).status, 401, "an unsigned token");
  await flush();
  assert.equal(receipts(aliceBox), before, "nothing read for a forged notice");
  assert.equal(gmailCalls.length, 0, "Gmail not even asked");
  // Signed by Google but unusable: acknowledged (or Pub/Sub would keep sending it) and nothing happens.
  for (const body of ["{", JSON.stringify({ message: {} }), JSON.stringify({ message: { data: "!!!" } }), notice({ emailAddress: "not an address" }), notice({ historyId: "12abc" }), "x".repeat(70000)]) {
    assert.equal((await gmailPost(body)).status, 204);
  }
  // A mailbox Relay doesn't read.
  assert.equal((await gmailPost(notice({ emailAddress: "stranger@gmail.test" }))).status, 204);
  await flush();
  assert.equal(gmailCalls.length, 0);
  assert.equal(parseGmailNotice(notice()).email, "alice@gmail.test");
  // And the real one still works.
  assert.equal((await gmailPost(notice())).status, 204);
  await flush();
  assert.equal(receipts(aliceBox), before + 1);
  console.log("ok - only notices signed by Google for Relay's subscription are acted on: forged, expired, re-addressed or unsigned ones are refused");
}

// ---- 6. Gmail's search can lag a moment behind a new email: one second look ----
{
  clock += MIN;
  const before = receipts(aliceBox);
  const m = gmailArrives(3, { indexed: false });
  assert.equal((await gmailPost(notice())).status, 204);
  await flush();
  assert.equal(receipts(aliceBox), before, "not in Gmail's search yet");
  const due = row(aliceBox).push_recheck_at;
  assert.equal(due, clock + RECHECK_MS, "a second look is planned");
  m.indexed = true;
  clock += 20 * 1000;
  assert.equal((await runPendingPush(env, { fetchImpl, now: clock })).checked, 0, "not before it's due");
  clock += 30 * 1000;
  const p = await runPendingPush(env, { fetchImpl, now: clock });
  assert.equal(p.read, 1);
  assert.equal(receipts(aliceBox), before + 1, "found on the second look");
  assert.equal(row(aliceBox).push_recheck_at, null, "only one second look");
  assert.equal((await runPendingPush(env, { fetchImpl, now: clock + MIN })).checked, 0);
  console.log("ok - when Gmail's search hasn't caught up with a new email, Relay looks once more 45 seconds later");
}

// ---- 7. One read per inbox at a time; a notice during a read is read straight after ----
{
  clock += MIN;
  const before = receipts(aliceBox);
  gmailArrives(4);
  // A second email arrives while the first read is going (its notice lands mid-read).
  let injected = false;
  const slowFetch = async (url, init) => {
    const res = await fetchImpl(url, init);
    if (!injected && String(url).includes("/messages?")) {
      injected = true;
      clock += 2000;
      gmailArrives(5);
      const r2 = await handleMailPushRoute(new Request("https://w.test/relay/webhooks/gmail", { method: "POST", headers: { authorization: "Bearer " + await signed(goodClaims()) }, body: notice() }),
        env, new URL("https://w.test/relay/webhooks/gmail"), ctx, { fetchImpl, now: () => clock });
      assert.equal(r2.status, 204);
    }
    return res;
  };
  const out = await pushRead(env, aliceBox, { fetchImpl: slowFetch, now: () => clock });
  await flush();
  assert.equal(out.reads, 2, "read again straight after, for the notice that came during the read");
  assert.equal(receipts(aliceBox), before + 2);
  assert.equal(row(aliceBox).push_lease, null, "let go afterwards");
  // A read already going: another one waits (and the minute's run catches anything left).
  sqlite.prepare("UPDATE gmail_connections SET push_lease = ? WHERE shopper_id = ?").run(clock + 60000, aliceBox);
  assert.equal((await pushRead(env, aliceBox, { fetchImpl, now: clock })).busy, true);
  // The 15-minute check keeps out of its way too.
  const auto = await autoScanGmail(env, clock, fetchImpl);
  assert.ok(!auto.results.length || auto.checked <= 1, "only Bob's inbox, if any, is checked");
  sqlite.prepare("UPDATE gmail_connections SET push_lease = NULL WHERE shopper_id = ?").run(aliceBox);
  console.log("ok - one read per inbox at a time; a notice during a read is read straight after; the 15-minute check keeps out of the way");
}

// ---- 8. While the shopper's own scan is going, a notice waits for it to finish ----
{
  clock += MIN;
  const before = receipts(aliceBox);
  sqlite.prepare("UPDATE mail_scan_jobs SET state = 'running' WHERE shopper_id = ?").run(aliceBox);
  if (!sqlite.prepare("SELECT 1 FROM mail_scan_jobs WHERE shopper_id = ?").get(aliceBox))
    sqlite.prepare("INSERT INTO mail_scan_jobs (shopper_id, job_id, state, started_at, updated_at) VALUES (?, 'j1', 'running', ?, ?)").run(aliceBox, clock, clock);
  gmailArrives(6);
  assert.equal((await gmailPost(notice())).status, 204);
  await flush();
  assert.equal(receipts(aliceBox), before, "not read during the shopper's own scan");
  assert.equal((await runPendingPush(env, { fetchImpl, now: clock + 10000 })).checked, 0, "still waiting");
  sqlite.prepare("UPDATE mail_scan_jobs SET state = 'done' WHERE shopper_id = ?").run(aliceBox);
  clock += MIN;
  assert.equal((await runPendingPush(env, { fetchImpl, now: clock })).read, 1);
  assert.equal(receipts(aliceBox), before + 1, "read once the shopper's scan finished");
  console.log("ok - a notice during the shopper's own scan is read by the next minute's run after it finishes");
}

// ---- 9. Outlook: Microsoft's notice with the subscription's secret ----
{
  clock += MIN;
  const [subId, sub] = [...subs][0];
  const before = receipts(bobBox);
  outlookArrives(50);
  const n = (over = {}) => JSON.stringify({ value: [{ subscriptionId: subId, clientState: sub.body.clientState, changeType: "created", resource: "Users/abc/Messages/AQMk", tenantId: "9188040d",
    subscriptionExpirationDateTime: iso(sub.expires), resourceData: { "@odata.type": "#Microsoft.Graph.Message", "@odata.id": "Users/abc/Messages/AQMk", id: "AQMk" }, ...over }] });
  // Without the secret, or for someone else's subscription: ignored.
  for (const body of [n({ clientState: "guessed" }), n({ clientState: undefined }), n({ subscriptionId: "5f9c0e1a-0000-4000-8000-999999999999" }), "{", JSON.stringify({ value: "x" })]) {
    assert.equal((await pushCall("/relay/webhooks/outlook", { body })).status, 202);
  }
  await flush();
  assert.equal(receipts(bobBox), before, "nothing read for a notice without the right secret");
  assert.equal((await pushCall("/relay/webhooks/outlook", { body: n() })).status, 202);
  await flush();
  assert.equal(receipts(bobBox), before + 1, "Bob's new order is in Relay straight after Microsoft's notice");
  assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM captured_receipts").all()).includes("PRIVATE-BODY"), "no email text kept");
  // A burst of notices for the same mailbox is one read.
  graphCalls.length = 0;
  outlookArrives(51);
  const burst = JSON.stringify({ value: Array.from({ length: 80 }, () => JSON.parse(n()).value[0]) });
  assert.equal((await pushCall("/relay/webhooks/outlook", { body: burst })).status, 202);
  await flush();
  assert.equal(graphCalls.filter(c => c.url.includes("/me/messages?")).length, 1, "80 notices, one read");
  assert.equal(receipts(bobBox), before + 2);
  console.log("ok - Outlook: only notices carrying the subscription's secret are acted on; a burst is one read");
}

// ---- 10. Microsoft's lifecycle notices ----
{
  clock += MIN;
  const [subId, sub] = [...subs][0];
  const life = (event) => JSON.stringify({ value: [{ subscriptionId: subId, clientState: sub.body.clientState, lifecycleEvent: event, tenantId: "9188040d", subscriptionExpirationDateTime: iso(sub.expires) }] });
  graphCalls.length = 0;
  assert.equal((await pushCall("/relay/webhooks/outlook/lifecycle", { body: life("reauthorizationRequired") })).status, 202);
  await flush();
  assert.equal(graphCalls.filter(c => c.method === "PATCH").length, 1, "renewed when Microsoft asks");
  // "missed": Microsoft couldn't deliver some notices, so the inbox is read.
  outlookArrives(52);
  const before = receipts(bobBox);
  assert.equal((await pushCall("/relay/webhooks/outlook/lifecycle", { body: life("missed") })).status, 202);
  await flush();
  assert.equal(receipts(bobBox), before + 1);
  // A forged lifecycle notice does nothing.
  assert.equal((await pushCall("/relay/webhooks/outlook/lifecycle", { body: JSON.stringify({ value: [{ subscriptionId: subId, clientState: "x", lifecycleEvent: "subscriptionRemoved" }] }) })).status, 202);
  assert.equal(row(bobBox).push_ref, subId);
  // "subscriptionRemoved": a new one is made by the next minute's run.
  assert.equal((await pushCall("/relay/webhooks/outlook/lifecycle", { body: life("subscriptionRemoved") })).status, 202);
  assert.equal(row(bobBox).push_ref, null);
  subs.delete(subId);
  const r = await renewMailPush(env, { fetchImpl, now: clock });
  assert.equal(r.renewed, 1);
  assert.notEqual(row(bobBox).push_ref, subId, "a new subscription");
  assert.equal(subs.size, 1);
  console.log("ok - lifecycle notices: renewed when Microsoft asks, read after missed notices, remade after removal; forged ones ignored");
}

// ---- 11. Renewing about once a day, and trying again later after a failure ----
{
  clock += 1.2 * DAY;
  watchBodies.length = 0;
  graphCalls.length = 0;
  const r = await renewMailPush(env, { fetchImpl, now: clock });
  assert.deepEqual(r, { renewed: 2, failed: 0 }, "both renewed with under 6 days left");
  assert.equal(watchBodies.length, 1);
  assert.equal(graphCalls.filter(c => c.method === "PATCH").length, 1, "Outlook renewed in place");
  assert.equal(row(aliceBox).push_expires_at, clock + 7 * DAY);
  // A failure is tried again 2 hours later, not every minute.
  clock += 1.2 * DAY;
  watchFails = 1;
  assert.deepEqual(await renewMailPush(env, { fetchImpl, now: clock }), { renewed: 1, failed: 1 });
  assert.equal(row(aliceBox).push_error, "gmail_500");
  watchBodies.length = 0;
  assert.equal((await renewMailPush(env, { fetchImpl, now: clock + 30 * MIN })).renewed, 0);
  assert.equal(watchBodies.length, 0, "not hammered");
  assert.equal((await renewMailPush(env, { fetchImpl, now: clock + RETRY_AFTER + MIN })).renewed, 1);
  assert.equal(row(aliceBox).push_error, null);
  // Gmail not taking the newer filter field: the INBOX list alone.
  clock += 1.5 * DAY;
  rejectBehaviour = true;
  watchBodies.length = 0;
  assert.equal((await renewMailPush(env, { fetchImpl, now: clock })).failed, 0);
  assert.deepEqual(watchBodies.map(b => Object.keys(b).sort().join(",")), ["labelFilterBehavior,labelIds,topicName", "labelIds,topicName"]);
  rejectBehaviour = false;
  // An Outlook subscription Microsoft no longer has: a new one.
  clock += 1.5 * DAY;
  const old = row(bobBox).push_ref;
  subs.delete(old);
  graphCalls.length = 0;
  assert.equal((await renewMailPush(env, { fetchImpl, now: clock })).renewed, 2);
  assert.deepEqual(graphCalls.filter(c => c.url.includes("/subscriptions")).map(c => c.method), ["PATCH", "POST"], "renewal tried first, then a new one");
  assert.notEqual(row(bobBox).push_ref, old);
  assert.equal(subs.size, 1);
  assert.ok(RENEW_WHEN_LEFT === 6 * DAY);
  console.log("ok - renewed about once a day; a failure is tried again 2 hours later; older Gmail filter and lost Outlook subscriptions handled");
}

// ---- 12. History too old: Relay reads the newest mail and starts again from Gmail's current number ----
{
  clock += MIN;
  sqlite.prepare("UPDATE gmail_connections SET push_history = '100' WHERE shopper_id = ?").run(aliceBox);
  const before = receipts(aliceBox);
  gmailArrives(7);
  assert.equal((await gmailPost(notice())).status, 204);
  await flush();
  assert.equal(receipts(aliceBox), before + 1);
  assert.equal(row(aliceBox).push_history, String(historyId), "back on Gmail's current history number");
  console.log("ok - an out-of-date history number falls back to reading the newest mail");
}

// ---- 13. Withdrawing permission, disconnecting, and a different mailbox ----
{
  clock += MIN;
  // Without permission: nothing is read and nothing renewed.
  sqlite.prepare("UPDATE shopper_consents SET withdrawn_at = ? WHERE shopper_id = (SELECT id FROM shoppers WHERE email = 'bob@example.com')").run(clock);
  const before = receipts(bobBox);
  outlookArrives(60);
  const subId = row(bobBox).push_ref, sub = subs.get(subId);
  const bobNotice = () => JSON.stringify({ value: [{ subscriptionId: subId, clientState: sub.body.clientState, changeType: "created" }] });
  assert.equal((await pushCall("/relay/webhooks/outlook", { body: bobNotice() })).status, 202);
  await flush();
  assert.equal(receipts(bobBox), before, "no reading without permission");
  sqlite.prepare("UPDATE shopper_consents SET withdrawn_at = NULL").run();
  // With permission again, the same notice reads it (so the check above wasn't passing for some other reason).
  assert.equal((await pushCall("/relay/webhooks/outlook", { body: bobNotice() })).status, 202);
  await flush();
  assert.equal(receipts(bobBox), before + 1);
  // And nothing is renewed without permission.
  sqlite.prepare("UPDATE shopper_consents SET withdrawn_at = ? WHERE shopper_id = (SELECT id FROM shoppers WHERE email = 'bob@example.com')").run(clock);
  clock += 7 * DAY;
  graphCalls.length = 0;
  const rr = await renewMailPush(env, { fetchImpl, now: clock });
  assert.equal(graphCalls.filter(c => c.url.includes("/subscriptions")).length, 0, "Bob's subscription isn't renewed without permission");
  assert.equal(rr.renewed, 1, "Alice's watch is");
  sqlite.prepare("UPDATE shopper_consents SET withdrawn_at = NULL").run();
  // Disconnecting ends the watch and the subscription first.
  const stopsBefore = stops;
  assert.equal((await post("/relay/my/gmail/disconnect", alice)).status, 200);
  assert.equal(stops, stopsBefore + 1, "Gmail told to stop watching");
  assert.equal((await post("/relay/my/gmail/disconnect", bob)).status, 200);
  assert.equal(subs.size, 0, "Outlook subscription deleted");
  gmailArrives(8);
  gmailCalls.length = 0;
  assert.equal((await gmailPost(notice())).status, 204);
  await flush();
  assert.equal(gmailCalls.length, 0, "a late notice for a disconnected inbox does nothing");
  // Connected again with a different Gmail: its own watch, not the old mailbox's.
  const s2 = new URL((await (await post("/relay/my/gmail/connect", alice)).json()).url).searchParams.get("state");
  assert.match((await call("/relay/gmail/callback?code=good&state=" + s2)).headers.get("location"), /#gmail=connected$/);
  sqlite.prepare("UPDATE mail_scan_jobs SET state = 'done'").run();
  assert.equal(row(aliceBox).push_expires_at, null, "no watch carried over");
  watchBodies.length = 0;
  assert.equal((await renewMailPush(env, { fetchImpl, now: clock })).renewed, 1);
  assert.equal(watchBodies.length, 1);
  console.log("ok - no reading without permission; disconnecting ends the watch and subscription; a new mailbox gets its own");
}

// ---- 14. Notices aren't rate-limited like the app (they come in bursts from Google's and Microsoft's own addresses) ----
{
  resetMemoryLimits();
  const req = (path) => new Request("https://w.test" + path, { method: "POST", headers: { "cf-connecting-ip": "64.233.170.9" } });
  for (const path of ["/relay/webhooks/gmail", "/relay/webhooks/outlook", "/relay/webhooks/outlook/lifecycle"]) {
    for (let i = 0; i < 1300; i++) assert.equal(await checkRateLimits(req(path), {}, new URL("https://w.test" + path), clock), null, path);
  }
  console.log("ok - notices skip the per-address limits (each is checked by Google's signature or the subscription's secret)");
}

resetGoogleKeys();
console.log("PASS instant email: Gmail notices signed by Google and Outlook notices with their secret read the inbox at once");
