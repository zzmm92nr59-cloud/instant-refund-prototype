// Relay's team searching their OWN connected Outlook inbox (worker/outlook-search.js), offline: Microsoft sign-in and
// Microsoft Graph are FAKED here (a fake Graph that keeps Graph's own rules: $search can't be used with $filter or $orderby,
// paging by @odata.nextLink, 429 with Retry-After); the database is a real SQLite engine. All data is made up.
// Checks: only Relay's team (an admin whose session passed the second step) can use it; each team member only ever reaches
// their own inbox; paging; the "already a receipt" flag; Sent, Drafts, Deleted Items and Outbox left out, Junk marked;
// the message route cleans an email exactly as "View original email" does; Graph's throttling becomes a plain-English
// "try again in N seconds"; no Outlook connected; bad parameters; per-shopper limits; only GET requests ever reach Graph;
// nothing from an email is logged.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, sealToken } from "../worker/gmail.js";
import { buildOriginalOutlook } from "../worker/original.js";
import { LIMITS, PAGE } from "../worker/outlook-search.js";
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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key",
  MICROSOFT_CLIENT_ID: "11111111-2222-3333-4444-555555555555", MICROSOFT_CLIENT_SECRET: "ms-secret-test",
  RELAY_ADMIN_EMAILS: "tess.team.relaytest@outlook.com,owen.team.relaytest@outlook.com" };
const CONSUMERS = "9188040d-6c67-4c5b-b112-36a304b66dad";
const MS = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
let clock = Date.UTC(2026, 10, 20, 12);
const DAY = 864e5;
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const b64url = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = claims => b64url({ alg: "RS256", typ: "JWT" }) + "." + b64url(claims) + ".sig";
const sha = t => createHash("sha256").update(t).digest("hex");

// ---- Made-up mailboxes, one per person, keyed by the access token Graph is given ----
const FOLDERS = { inbox: "FOLDER-inbox-000000001", sentitems: "FOLDER-sent-0000000001", drafts: "FOLDER-drafts-00000001",
  deleteditems: "FOLDER-deleted-0000001", outbox: "FOLDER-outbox-00000001", junkemail: "FOLDER-junk-0000000001" };
const mk = (who, n, at, subject, extra = {}) => ({ id: `AQMkAD-${who}-msg-` + String(n).padStart(4, "0"), mid: `<${who}-${n}@mail.example.test>`,
  fromName: "Kestrel Outdoor", from: "orders@kestrel.example.test", subject, at, folder: FOLDERS.inbox, body: "<p>Thanks for your order</p>", ...extra });
const boxes = { tess: [], owen: [] };
for (let i = 1; i <= 120; i++) boxes.tess.push(mk("tess", i, clock - i * 0.5 * DAY, i % 3 ? "Weekly news " + i : "Your Kestrel order KO-" + i));
boxes.tess.push(mk("tess", 901, clock - 3.2 * DAY, "Your Kestrel order KO-901 (sent copy)", { folder: FOLDERS.sentitems }));
boxes.tess.push(mk("tess", 902, clock - 3.3 * DAY, "Your Kestrel order KO-902 draft", { folder: FOLDERS.drafts }));
boxes.tess.push(mk("tess", 903, clock - 3.4 * DAY, "Your Kestrel order KO-903 deleted", { folder: FOLDERS.deleteditems }));
boxes.tess.push(mk("tess", 904, clock - 3.6 * DAY, "Your Kestrel order KO-904 in junk", { folder: FOLDERS.junkemail }));
const HTML_MAIL = `<html><head><title>x</title><script>steal()</script></head><body onload="x()"><p style="color:red">Order KO-777 total £42.00</p>
<a href="javascript:alert(1)">bad</a> <a href="https://kestrel.example.test/returns">Start a return</a><img src="http://tracker.example.test/p.gif"><iframe src="https://x.test"></iframe></body></html>`;
boxes.tess.push(mk("tess", 777, clock - 9.1 * DAY, "Your Kestrel order KO-777", { body: HTML_MAIL }));
boxes.owen.push(mk("owen", 1, clock - 2 * DAY, "Owen's private order OW-1"));
const SECRET_SUBJECT = "Owen's private order OW-1";
const mime = m => `From: ${m.fromName} <${m.from}>\r\nSubject: ${m.subject}\r\nMessage-ID: ${m.mid}\r\nDate: ${new Date(m.at).toUTCString()}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${m.body}`;
const view = m => ({ id: m.id, internetMessageId: m.mid, subject: m.subject, from: { emailAddress: { name: m.fromName, address: m.from } }, receivedDateTime: iso(m.at), parentFolderId: m.folder });

const graphCalls = [], everyGraphCall = [];
let throttle = null; // { times, retryAfter }: Graph refuses the next `times` requests with 429
let refuseDatesInSearch = false;
// MM/DD/YYYY in a KQL search.
const kqlDate = s => { const [m, d, y] = s.split("/").map(Number); return Date.UTC(y, m - 1, d); };
function graph(url, init) {
  const u = new URL(url), auth = (init.headers || {}).Authorization || "";
  graphCalls.push({ method: init.method || "GET", path: u.pathname, url, auth });
  everyGraphCall.push({ method: init.method || "GET", path: u.pathname });
  if (throttle && throttle.times > 0) { throttle.times--; return new Response('{"error":{"code":"ApplicationThrottled"}}', { status: 429, headers: { "retry-after": String(throttle.retryAfter) } }); }
  const who = /^Bearer access-(tess|owen)$/.exec(auth);
  if (!who) return new Response('{"error":{"code":"InvalidAuthenticationToken"}}', { status: 401 });
  const box = boxes[who[1]];
  const folder = /^\/v1\.0\/me\/mailFolders\/(\w+)$/.exec(u.pathname);
  if (folder) return FOLDERS[folder[1]] ? Response.json({ id: FOLDERS[folder[1]] }) : new Response("{}", { status: 404 });
  if (u.pathname === "/v1.0/me/messages") {
    const search = u.searchParams.get("$search"), filter = u.searchParams.get("$filter"), order = u.searchParams.get("$orderby");
    const top = Number(u.searchParams.get("$top") || 10), skip = Number(u.searchParams.get("$skip") || 0);
    let list = box.slice();
    if (search != null) {
      // Graph's rule: $search can't be combined with $filter or $orderby on messages.
      if (filter != null || order != null) return new Response('{"error":{"code":"ErrorInvalidUrlQuery"}}', { status: 400 });
      const kql = /^"(.*)"$/.exec(search)[1];
      if (refuseDatesInSearch && /received[<>]/.test(kql)) return new Response('{"error":{"code":"ErrorInvalidUrlQuery"}}', { status: 400 });
      const words = /^\((.*?)\)/.exec(kql)[1].toLowerCase();
      const ge = /received>=(\d\d\/\d\d\/\d{4})/.exec(kql), lt = /received<(\d\d\/\d\d\/\d{4})/.exec(kql);
      list = list.filter(m => (m.subject + " " + m.fromName + " " + m.from).toLowerCase().includes(words))
        .filter(m => (!ge || m.at >= kqlDate(ge[1])) && (!lt || m.at < kqlDate(lt[1])));
    } else if (filter) {
      const f = /^receivedDateTime ge (\S+)(?: and receivedDateTime lt (\S+))?$|^receivedDateTime lt (\S+)$/.exec(filter);
      const lo = f[1] ? Date.parse(f[1]) : -Infinity, hi = f[2] || f[3] ? Date.parse(f[2] || f[3]) : Infinity;
      list = list.filter(m => m.at >= lo && m.at < hi);
    }
    list.sort((a, b) => b.at - a.at);
    const page = list.slice(skip, skip + top), next = new URL(url);
    next.searchParams.set("$skip", String(skip + top));
    return Response.json({ value: page.map(view), ...(skip + top < list.length ? { "@odata.nextLink": next.toString() } : {}) });
  }
  const raw = /^\/v1\.0\/me\/messages\/([^/]+)\/\$value$/.exec(u.pathname);
  if (raw) { const m = box.find(x => x.id === decodeURIComponent(raw[1])); return m ? new Response(mime(m)) : new Response('{"error":{"code":"ErrorItemNotFound"}}', { status: 404 }); }
  const one = /^\/v1\.0\/me\/messages\/([^/]+)$/.exec(u.pathname);
  if (one) { const m = box.find(x => x.id === decodeURIComponent(one[1])); return m ? Response.json(view(m)) : new Response('{"error":{"code":"ErrorItemNotFound"}}', { status: 404 }); }
  return new Response("blocked", { status: 500 });
}
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url === MS + "/token") {
    const p = new URLSearchParams(String(init.body));
    if (p.get("grant_type") === "authorization_code") {
      const who = /^signin-(tess|owen|alex)$/.exec(p.get("code"))[1], email = who === "alex" ? "alex.shopper.relaytest@outlook.com" : who + ".team.relaytest@outlook.com";
      return Response.json({ id_token: idToken({ iss: `https://login.microsoftonline.com/${CONSUMERS}/v2.0`, tid: CONSUMERS, aud: env.MICROSOFT_CLIENT_ID,
        exp: Math.floor(clock / 1000) + 3600, email, preferred_username: email }),
        access_token: "first-" + who, refresh_token: "REFRESH-" + who, scope: "openid email profile offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read" });
    }
    const who = /^REFRESH-(\w+)$/.exec(p.get("refresh_token"))[1];
    if (who === "ended") return Response.json({ error: "invalid_grant" }, { status: 400 });
    return Response.json({ access_token: "access-" + who });
  }
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url.startsWith("https://graph.microsoft.com/")) return graph(url, init);
  return new Response("blocked", { status: 500 });
};
let emails = [];
const call = (path, { method = "GET", body, token } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method,
    headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });

// Signed in with Microsoft, Outlook connected in the same step.
async function microsoftSignIn(who) {
  const nonce = (who[0].toUpperCase()).repeat(43);
  const start = await (await call("/relay/auth/microsoft/start", { method: "POST", body: { nonce, consentVersion: CONSENT_VERSION } })).json();
  const state = new URL(start.url).searchParams.get("state");
  const back = await call("/relay/microsoft/callback?code=signin-" + who + "&state=" + state);
  const loc = back.headers.get("location"); if (!/#signin=/.test(String(loc))) throw new Error("sign-in for " + who + " ended at " + loc + " " + back.status);
  const tok = /#signin=([A-Za-z0-9_-]{43})$/.exec(loc)[1];
  const v = await (await call("/relay/auth/verify", { method: "POST", body: { token: tok, nonce } })).json();
  assert.equal(v.outlookConnected, true, who + "'s Outlook connected");
  return v.sessionToken;
}
async function emailSignIn(email) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email } });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const tess = await microsoftSignIn("tess"), owen = await microsoftSignIn("owen"), alex = await microsoftSignIn("alex");
const nobox = await emailSignIn("tara.team@example.test");
env.RELAY_ADMIN_EMAILS += ",tara.team@example.test";
const idOf = email => sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id;
const TESS = idOf("tess.team.relaytest@outlook.com"), OWEN = idOf("owen.team.relaytest@outlook.com");

// Nothing from an email may be logged.
const logged = [];
for (const k of ["log", "error", "warn", "info"]) { const orig = console[k]; console[k] = (...a) => { logged.push(a.map(String).join(" ")); if (k === "log") orig(...a); }; }
const S = "/relay/my/outlook/search", M = "/relay/my/outlook/message/";
const get = async (path, token) => { const r = await call(path, { token }); return { status: r.status, body: await r.json(), headers: r.headers }; };
const resetUses = () => { try { sqlite.exec("DELETE FROM outlook_search_uses"); } catch { /* not made yet */ } };

// 1. Team only.
{
  const before = graphCalls.length;
  for (const [token, who] of [[undefined, "a visitor"], [alex, "a shopper who isn't on the team"]]) {
    for (const path of [S, S + "?q=kestrel", M + encodeURIComponent(boxes.tess[0].id)]) {
      const r = await get(path, token);
      if (!token) assert.equal(r.status, 401, who + " is told to sign in: " + path);
      else assert.deepEqual([r.status, r.body], [404, { error: "not_found" }], who + " is told it doesn't exist: " + path);
    }
  }
  assert.equal((await call(S, { method: "POST", token: tess, body: {} })).status, 404, "GET only");
  // Two-step sign-in required: a team member's session that didn't pass a second step is refused.
  env.SECOND_STEP_REQUIRED = "on";
  sqlite.prepare("UPDATE auth_sessions SET second_step = 0").run();
  for (const path of [S, M + encodeURIComponent(boxes.tess[0].id)]) {
    const r = await get(path, tess);
    assert.ok(r.status === 403 || r.status === 404, "team without a passed second step is refused: " + r.status);
    assert.notEqual(r.status, 200);
  }
  // Their account has a second step (a passkey) but this session didn't pass it: exactly the admin routes' "doesn't exist".
  await call("/relay/my/passkeys", { token: tess }); // makes the passkeys table
  const cols = sqlite.prepare("PRAGMA table_info(auth_passkeys)").all();
  sqlite.prepare(`INSERT INTO auth_passkeys (${cols.map(c => c.name).join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...cols.map(c => c.name === "shopper_id" ? TESS : /INT|REAL/i.test(c.type) ? 1 : "made-up-" + c.name));
  for (const path of [S, M + encodeURIComponent(boxes.tess[0].id)]) assert.deepEqual(await get(path, tess).then(r => [r.status, r.body]), [404, { error: "not_found" }], "second step set up but not passed in this session");
  sqlite.prepare("UPDATE auth_sessions SET second_step = 1").run();
  assert.equal((await get(S, tess)).status, 200, "the same team member, with a session that passed the second step, gets in");
  delete env.SECOND_STEP_REQUIRED;
  assert.equal(graphCalls.filter((c, i) => i >= before && /access-tess/.test(c.auth)).length > 0, true);
  resetUses();
  console.log("ok - team only: visitors 401, shoppers not on the team 404, team without a passed second step refused, GET only");
}

// 2. Paging (no search words: newest first, by date filter), folders left out, Junk marked.
{
  graphCalls.length = 0;
  const seen = [];
  let cursor = null, pages = 0, junkSeen = false;
  do {
    const r = await get(S + (cursor ? "?cursor=" + cursor : ""), tess);
    assert.equal(r.status, 200);
    assert.ok(r.body.results.length <= PAGE, "at most 50 a page");
    for (const x of r.body.results) {
      assert.deepEqual(Object.keys(x).filter(k => !["junk", "receiptId"].includes(k)).sort(), ["from", "id", "readAs", "receipt", "received", "subject"], "id, from, subject, date and the receipt flag only: no body, no preview");
      assert.deepEqual(Object.keys(x.from).sort(), ["address", "name"]);
      if (x.junk) junkSeen = x.subject.includes("KO-904");
      seen.push(x);
    }
    cursor = r.body.cursor; pages++;
    assert.equal(r.body.more, Boolean(cursor));
  } while (cursor && pages < 10);
  assert.equal(pages, 3, "122 emails in 3 pages");
  const subjects = seen.map(x => x.subject);
  assert.equal(new Set(seen.map(x => x.id)).size, seen.length, "no email twice");
  assert.equal(seen.length, 120 + 1 + 1, "every inbox email, the junk one and the HTML one");
  for (const n of ["KO-901", "KO-902", "KO-903"]) assert.ok(!subjects.some(s => s.includes(n)), "Sent, Drafts and Deleted Items left out: " + n);
  assert.ok(junkSeen, "Junk is searched and marked junk: true");
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i - 1].received >= seen[i].received, "newest first");
  // The folder ids were asked once, on the first page; later pages carried them in the cursor.
  assert.equal(graphCalls.filter(c => c.path.startsWith("/v1.0/me/mailFolders/")).length, 5);
  resetUses();
  console.log(`ok - paging: ${seen.length} emails in ${pages} pages of up to ${PAGE}, Sent, Drafts, Deleted Items and Outbox left out, Junk marked`);
}

// 3. Search words with dates: $search never sent with $filter or $orderby; dates applied.
{
  graphCalls.length = 0;
  const after = new Date(clock - 30 * DAY).toISOString().slice(0, 10), before = new Date(clock - 5 * DAY).toISOString().slice(0, 10);
  const r = await get(S + "?q=kestrel%20order&after=" + after + "&before=" + before, tess);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const lo = Date.parse(after + "T00:00:00Z"), hi = Date.parse(before + "T00:00:00Z");
  assert.ok(r.body.results.length > 10);
  for (const x of r.body.results) { assert.ok(/kestrel order/i.test(x.subject)); const t = Date.parse(x.received); assert.ok(t >= lo && t < hi, "inside the dates"); }
  const listCall = graphCalls.find(c => c.path === "/v1.0/me/messages");
  const lu = new URL(listCall.url);
  assert.ok(lu.searchParams.get("$search") && !lu.searchParams.has("$filter") && !lu.searchParams.has("$orderby"), "$search alone");
  // If Outlook won't take the dates inside the search, Relay asks without them and applies them itself.
  refuseDatesInSearch = true;
  const r2 = await get(S + "?q=kestrel%20order&after=" + after + "&before=" + before, tess);
  refuseDatesInSearch = false;
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.body.results.map(x => x.id), r.body.results.map(x => x.id), "same emails either way");
  resetUses();
  console.log(`ok - search words with dates: ${r.body.results.length} found, $search never combined with $filter or $orderby, dates kept`);
}

// 4. "Already a receipt": by the email's Message-ID (message_ref), or by the Outlook id the receipt was read from.
{
  const [byRef, byId, notReceipt, othersOnly] = [3, 6, 9, 12].map(n => boxes.tess.find(m => m.id.endsWith(String(n).padStart(4, "0"))));
  const add = (sid, ref, status, details) => sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), sid, ref, status, JSON.stringify(details), clock);
  add(TESS, sha("outlook:" + byRef.mid), "confirmed", { kind: "receipt" });
  add(TESS, sha("outlook:old-key-" + byId.id), "confirmed", { kind: "receipt", outlookId: byId.id });
  add(TESS, sha("outlook:" + notReceipt.mid), "not_receipt", { kind: "other" });
  add(OWEN, sha("outlook:" + othersOnly.mid), "confirmed", { kind: "receipt", outlookId: othersOnly.id }); // someone else's: never counts
  const r = await get(S + "?q=kestrel", tess);
  const f = id => r.body.results.find(x => x.id === id);
  assert.equal(f(byRef.id).receipt, true); assert.ok(f(byRef.id).receiptId);
  assert.equal(f(byId.id).receipt, true, "found by outlookId too");
  assert.deepEqual([f(notReceipt.id).receipt, f(notReceipt.id).readAs, "receiptId" in f(notReceipt.id)], [false, "not_receipt", false], "read but not a receipt");
  assert.deepEqual([f(othersOnly.id).receipt, f(othersOnly.id).readAs], [false, null], "another shopper's receipt never marks yours");
  resetUses();
  console.log("ok - already a receipt: by Message-ID or by outlookId, \"not a receipt\" told apart, other shoppers' receipts ignored");
}

// 5. Own inbox only.
{
  graphCalls.length = 0;
  const r = await get(S + "?q=private", tess);
  assert.deepEqual(r.body.results, [], "Tess's search never reaches Owen's inbox");
  const o = await get(S + "?q=private", owen);
  assert.equal(o.body.results.length, 1, "Owen finds his own");
  const theirs = await get(M + encodeURIComponent(boxes.owen[0].id), tess);
  assert.equal(theirs.status, 404, "another person's email id opens nothing");
  assert.equal(theirs.body.error, "email_not_found");
  for (const extra of ["email=owen.team.relaytest%40outlook.com", "shopper=" + OWEN, "user=owen", "mailbox=owen"])
    assert.equal((await get(S + "?q=private&" + extra, tess)).status, 400, "nothing can pick another account: " + extra);
  assert.equal((await get(S + "?inbox=2", tess)).body.error, "outlook_not_connected", "inbox is only a number among your own inboxes");
  // A cursor can only ever page through /me/messages, with the caller's own token.
  const evil = Buffer.from(JSON.stringify({ v: 1, u: "/users/owen.team.relaytest@outlook.com/messages?$top=50", i: 1, a: null, b: null, x: [], j: null })).toString("base64url");
  assert.equal((await get(S + "?cursor=" + evil, tess)).status, 400, "a cursor aimed at someone else's mailbox is refused");
  const tessCalls = graphCalls.filter(c => c.auth === "Bearer access-tess"), owenCalls = graphCalls.filter(c => c.auth === "Bearer access-owen");
  assert.ok(tessCalls.length && owenCalls.length);
  assert.ok(graphCalls.every(c => new URL(c.url).pathname.startsWith("/v1.0/me/")), "only ever /me");
  resetUses();
  console.log("ok - own inbox only: no parameter picks another account, another's email id is not found, cursors stay on /me/messages");
}

// 6. One message, cleaned exactly as "View original email" cleans it.
{
  const m = boxes.tess.find(x => x.id.endsWith("0777"));
  const r = await get(M + encodeURIComponent(m.id), tess);
  assert.equal(r.status, 200);
  const expected = await buildOriginalOutlook(fetchImpl, "access-tess", m.id);
  assert.equal(r.body.html, expected.body.html, "the same cleaning as original.js");
  assert.deepEqual(r.body.links, expected.body.links);
  assert.ok(!/<script|onload|javascript:|<iframe|http:\/\/tracker/i.test(r.body.html), "scripts, handlers, javascript: links, frames and http pictures gone");
  assert.ok(/Order KO-777 total £42\.00/.test(r.body.text), "readable text: " + r.body.text);
  assert.ok(!/steal\(\)|<p/.test(r.body.text));
  assert.deepEqual([r.body.subject, r.body.from.address, r.body.received], [m.subject, m.from, iso(m.at)]);
  assert.deepEqual(r.body.links, [{ label: "Start a return", url: "https://kestrel.example.test/returns" }]);
  // Not a receipt at all: still readable.
  const plain = await get(M + encodeURIComponent(boxes.tess[0].id), tess);
  assert.equal(plain.status, 200); assert.ok(/Thanks for your order/.test(plain.body.text));
  assert.equal((await get(M + encodeURIComponent("AQMkAD-tess-msg-gone-0000"), tess)).body.error, "email_not_found");
  resetUses();
  console.log("ok - message route: one email of your own, cleaned exactly as View original email does, with plain text to read");
}

// 7. Outlook busy (429 with Retry-After).
{
  throttle = { times: 1, retryAfter: 0 };
  assert.equal((await get(S + "?q=kestrel", tess)).status, 200, "a short wait is waited for and asked again");
  throttle = { times: 10, retryAfter: 30 };
  const r = await get(S + "?q=kestrel", tess);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "outlook_busy");
  assert.equal(r.body.retryAfterMs, 30000);
  assert.equal(r.headers.get("retry-after"), "30");
  assert.equal(r.body.message, "Outlook is busy just now. Please try again in 30 seconds.");
  throttle = { times: 10, retryAfter: 45 };
  const m = await get(M + encodeURIComponent(boxes.tess[0].id), tess);
  assert.deepEqual([m.status, m.body.error, m.body.retryAfterMs], [503, "outlook_busy", 45000], "the message route too");
  // Busy only while fetching the email itself (after its details came back).
  throttle = null;
  let n = 0;
  const once = async (url, init) => /\/\$value$/.test(new URL(url).pathname) && n++ === 0 ? new Response("", { status: 429, headers: { "retry-after": "20" } }) : fetchImpl(url, init);
  const r3 = await handleAuthRoute(new Request("https://w.test" + M + encodeURIComponent(boxes.tess[0].id), { headers: { authorization: "Bearer " + tess, "cf-connecting-ip": "1.1.1.1" } }),
    env, new URL("https://w.test" + M + encodeURIComponent(boxes.tess[0].id)), {}, { now: clock, fetchImpl: once });
  assert.deepEqual([r3.status, (await r3.json()).error], [503, "outlook_busy"]);
  resetUses();
  console.log("ok - Outlook busy: a short wait is retried; longer ones answer 503 \"try again in N seconds\" with Retry-After");
}

// 8. No Outlook connected, and Outlook access that has ended.
{
  const r = await get(S + "?q=kestrel", nobox);
  assert.deepEqual([r.status, r.body.error], [409, "outlook_not_connected"]);
  assert.match(r.body.message, /No Outlook inbox is connected/);
  assert.equal((await get(M + encodeURIComponent(boxes.tess[0].id), nobox)).body.error, "outlook_not_connected");
  // Owen's access ends (Microsoft refuses the refresh token): connect again.
  const row = sqlite.prepare("SELECT token_iv, token_data FROM gmail_connections WHERE shopper_id = ?").get(OWEN);
  {
    const enc = await sealToken(env, "REFRESH-ended");
    sqlite.prepare("UPDATE gmail_connections SET token_iv = ?, token_data = ? WHERE shopper_id = ?").run(enc.iv, enc.data, OWEN);
    const e = await get(S, owen);
    assert.deepEqual([e.status, e.body.error], [409, "outlook_reconnect_needed"]);
    sqlite.prepare("UPDATE gmail_connections SET token_iv = ?, token_data = ? WHERE shopper_id = ?").run(row.token_iv, row.token_data, OWEN);
  }
  resetUses();
  console.log("ok - no Outlook connected: 409 outlook_not_connected with plain English; ended access: outlook_reconnect_needed");
}

// 9. Bad parameters.
{
  graphCalls.length = 0;
  const bad = [["q=" + "a".repeat(201), "q"], ["q=%22quoted%22", "q"], ["q=back%5Cslash", "q"], ["after=2026-02-30", "after"], ["after=26-01-01", "after"],
    ["before=2026/01/01", "before"], ["after=2026-05-01&before=2026-04-01", "before"], ["after=2026-05-01&before=2026-05-01", "before"],
    ["cursor=***", "cursor"], ["cursor=" + "A".repeat(5000), "cursor"], ["cursor=" + Buffer.from("{not json").toString("base64url"), "cursor"],
    ["cursor=" + Buffer.from(JSON.stringify({ v: 1, u: "/me/messages/AQMk/move?x", i: 1, x: [] })).toString("base64url"), "cursor"],
    ["q=a&q=b", "q"], ["inbox=7", "inbox"], ["top=500", "top"], ["select=body", "select"]];
  for (const [qs, field] of bad) {
    const r = await get(S + "?" + qs, tess);
    assert.deepEqual([r.status, r.body.error, r.body.field], [400, "invalid_request", field], qs);
    assert.ok(r.body.message && !/[{}]/.test(r.body.message), "plain English");
  }
  const m = await get(M + "%3Cscript%3E%22AAAAAAAAAAAAAAAA", tess);
  assert.deepEqual([m.status, m.body.field], [400, "id"]);
  assert.equal((await get(M + encodeURIComponent(boxes.tess[0].id) + "?cursor=x", tess)).status, 400, "the message route takes only inbox");
  assert.equal(graphCalls.length, 0, "nothing asked of Outlook for a bad request");
  resetUses();
  console.log(`ok - bad parameters: ${bad.length + 2} kinds refused with the field named, before anything is asked of Outlook`);
}

// 10. Per-shopper limits, and the mailbox allowance in limits.js.
{
  resetUses();
  for (let i = 0; i < LIMITS.search.perMinute; i++) assert.equal((await get(S, tess)).status, 200);
  const r = await get(S, tess);
  assert.deepEqual([r.status, r.body.error], [429, "too_many_requests"]);
  assert.ok(Number(r.headers.get("retry-after")) > 0 && r.body.message);
  assert.equal((await get(S, owen)).status, 200, "each shopper has their own allowance");
  clock += 61e3;
  assert.equal((await get(S, tess)).status, 200, "a minute later it works again");
  for (let i = 0; i < LIMITS.message.perMinute; i++) assert.equal((await get(M + encodeURIComponent(boxes.tess[0].id), tess)).status, 200);
  assert.equal((await get(M + encodeURIComponent(boxes.tess[0].id), tess)).status, 429);
  // A day's allowance.
  sqlite.prepare("DELETE FROM outlook_search_uses").run();
  const ins = sqlite.prepare("INSERT INTO outlook_search_uses (shopper_id, kind, created_at) VALUES (?, 'search', ?)");
  for (let i = 0; i < LIMITS.search.perDay; i++) ins.run(TESS, clock - 2 * 3600e3);
  assert.equal((await get(S, tess)).status, 429, "a day's searches used up");
  resetUses();
  // limits.js counts both routes against the mailbox allowance (60 a minute per session).
  resetMemoryLimits();
  const lim = (path) => checkRateLimits(new Request("https://w.test" + path, { headers: { authorization: "Bearer " + tess, "cf-connecting-ip": "2.2.2.2" } }), {}, new URL("https://w.test" + path), clock);
  for (const path of [S + "?q=x", M + "AQMkAD-tess-msg-0001"]) {
    resetMemoryLimits();
    let refused = null;
    for (let i = 0; i < 61 && !refused; i++) refused = await lim(path);
    assert.equal(refused && refused.scope, "mail", "counted as reading a mailbox: " + path);
  }
  resetMemoryLimits();
  console.log(`ok - limits: ${LIMITS.search.perMinute} searches and ${LIMITS.message.perMinute} emails a minute per shopper (${LIMITS.search.perDay} and ${LIMITS.message.perDay} a day), and the mailbox allowance`);
}

// 11. Read-only, and nothing from an email in the logs.
{
  assert.ok(everyGraphCall.length > 100);
  const methods = new Set(everyGraphCall.map(c => c.method));
  assert.deepEqual([...methods], ["GET"], "only GET ever reaches Graph");
  assert.ok(everyGraphCall.every(c => /^\/v1\.0\/me\/(messages(\/[^/]+(\/\$value)?)?|mailFolders\/(sentitems|drafts|deleteditems|outbox|junkemail))$/.test(c.path)), "only listing, one email, or a folder's id");
  const all = logged.join("\n");
  for (const t of ["Kestrel", "KO-777", "£42", SECRET_SUBJECT, "orders@kestrel", "Weekly news"]) assert.ok(!all.includes(t), "never logged: " + t);
  // Deleting the account removes the record of searches.
  assert.equal((await get(S, owen)).status, 200);
  const before = sqlite.prepare("SELECT COUNT(*) AS n FROM outlook_search_uses WHERE shopper_id = ?").get(OWEN).n;
  assert.ok(before > 0);
  assert.equal((await call("/relay/my/delete", { method: "POST", token: owen })).status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM outlook_search_uses WHERE shopper_id = ?").get(OWEN).n, 0, "gone with the account");
  console.log("ok - read-only (GET only, to /me/messages and well-known folders), nothing from an email logged, records go with the account");
}
console.log("PASS Outlook search for Relay's team: own inbox only, team only, read-only");
