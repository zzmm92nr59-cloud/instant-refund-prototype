// Outlook receipts that went missing. Outlook lets an app have only 4 requests open at once on a mailbox and refuses the
// rest ("429 Too Many Requests"). Relay used to read 6 emails at a time and skip any email it was refused, for good.
// This fake Outlook enforces the same limit (Microsoft Graph and sign-in are FAKED; the database is a real SQLite engine)
// and checks that: no more than 3 reads are ever open at once; a refused or failing email is read again later instead of
// skipped; an email that never reads doesn't stop the scan; mailboxes read before this fix are read once more in full
// (only emails Relay never read are fetched); and payment, trip and collection emails are read too.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, OUTLOOK_SCOPE, looksLikeShopping, autoScanGmail } from "../worker/gmail.js";

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
  MICROSOFT_CLIENT_ID: "11111111-2222-3333-4444-555555555555", MICROSOFT_CLIENT_SECRET: "ms-secret-test" };
const CONSUMERS = "9188040d-6c67-4c5b-b112-36a304b66dad";
const MS = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
let clock = 1_800_000_000_000;
const DAY = 864e5;
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const b64url = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = claims => b64url({ alg: "RS256", typ: "JWT" }) + "." + b64url(claims) + ".sig";

const receipt = (n) => `Order number: RA-${n}\nOrder date: 14 Oct 2026\nRain Jacket - Qty 1 - £95.00\nOrder total: £95.00\nReturns accepted within 30 days of purchase.\n`;
const mail = (n, at, subject, extra = {}) => ({ id: "AQMkADAwATM0MDAAMS1-rains" + String(n).padStart(4, "0"), mid: `<ra-${n}@e.rains.test>`, fromName: "RAINS", from: "hello@e.rains.test", subject, at, body: receipt(n), ...extra });
// 30 order emails in one month (enough to read many at once), and a few awkward ones.
let box = [];
for (let i = 1; i <= 30; i++) box.push(mail(i, clock - (2 + i * 0.5) * DAY, "Your RAINS order confirmation #RA-" + i));
box.push(mail(101, clock - 20 * DAY, "Your payment to RAINS"));                        // payment wording: read now
box.push(mail(102, clock - 21 * DAY, "Your Monday evening trip with Uber", { body: "Thanks for riding, Jess\nTotal £12.40\n" }));
box.push(mail(103, clock - 22 * DAY, "Your order is ready to collect", { body: receipt(103) }));
box.push(mail(201, clock - 23 * DAY, "Your RAINS order confirmation #RA-201"));         // Outlook refuses it twice, then gives it
box.push(mail(202, clock - 24 * DAY, "Your RAINS order confirmation #RA-202"));         // never readable: must not stop the scan
const mime = m => `From: ${m.fromName} <${m.from}>\r\nSubject: ${m.subject}\r\nMessage-ID: ${m.mid}\r\nDate: ${new Date(m.at).toUTCString()}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${m.body}`;

let inFlight = 0, maxInFlight = 0, refused = 0;
const tries = new Map(), listed = [], reads = [];
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url === MS + "/token") {
    const p = new URLSearchParams(String(init.body));
    if (p.get("grant_type") === "authorization_code") {
      assert.equal(p.get("scope"), "openid email profile " + OUTLOOK_SCOPE);
      return Response.json({ id_token: idToken({ iss: `https://login.microsoftonline.com/${CONSUMERS}/v2.0`, tid: CONSUMERS, aud: env.MICROSOFT_CLIENT_ID,
        exp: Math.floor(clock / 1000) + 3600, email: "jess.rains@outlook.com", preferred_username: "jess.rains@outlook.com" }),
        access_token: "a1", refresh_token: "MSREFRESH-PLAINTEXT", scope: "openid email profile offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read" });
    }
    return Response.json({ access_token: "ms-access" });
  }
  if (url.startsWith("https://graph.microsoft.com/")) {
    const u = new URL(url);
    if (u.pathname === "/v1.0/me/messages") {
      const f = /^receivedDateTime ge (\S+) and receivedDateTime lt (\S+)$/.exec(u.searchParams.get("$filter") || "");
      const lo = Date.parse(f[1]), hi = Date.parse(f[2]); listed.push([lo, hi]);
      const inWin = box.filter(m => m.at >= lo && m.at < hi).sort((a, b) => b.at - a.at);
      return Response.json({ value: inWin.map(m => ({ id: m.id, internetMessageId: m.mid, subject: m.subject, from: { emailAddress: { name: m.fromName, address: m.from } }, receivedDateTime: iso(m.at) })) });
    }
    const raw = /^\/v1\.0\/me\/messages\/([^/]+)\/\$value$/.exec(u.pathname);
    if (raw) {
      const m = box.find(x => x.id === decodeURIComponent(raw[1]));
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        // Outlook's rule: more than 4 open requests on one mailbox are refused.
        if (inFlight > 4) { refused++; return new Response('{"error":{"code":"ApplicationThrottled"}}', { status: 429, headers: { "retry-after": "0" } }); }
        await new Promise(r => setTimeout(r, 3));
        if (!m) return new Response('{"error":{"code":"ErrorItemNotFound"}}', { status: 404 });
        const n = (tries.get(m.id) || 0) + 1; tries.set(m.id, n);
        if (m.id.endsWith("0201") && n <= 4) return new Response("busy", { status: 503, headers: { "retry-after": "0" } });
        if (m.id.endsWith("0202")) return new Response("server error", { status: 500 });
        reads.push(m.id);
        return new Response(mime(m), { status: 200 });
      } finally { inFlight--; }
    }
    return new Response("blocked", { status: 500 });
  }
  return new Response("blocked", { status: 500 });
};
const call = (path, { method = "GET", body, token } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method,
    headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
const NONCE = "N".repeat(43);

// Signed in and Outlook connected in one step.
const start = await (await call("/relay/auth/microsoft/start", { method: "POST", body: { nonce: NONCE, consentVersion: CONSENT_VERSION } })).json();
const state = new URL(start.url).searchParams.get("state");
const back = await call("/relay/microsoft/callback?code=signinmail-1&state=" + state);
const tok = /#signin=([A-Za-z0-9_-]{43})$/.exec(back.headers.get("location"))[1];
const v = await (await call("/relay/auth/verify", { method: "POST", body: { token: tok, nonce: NONCE } })).json();
assert.equal(v.outlookConnected, true);
const session = v.sessionToken;
const shopperId = sqlite.prepare("SELECT shopper_id AS id FROM gmail_connections").get().id;

async function scanAll(full = false) {
  let cursor = "", rounds = 0, body;
  do {
    const r = await call("/relay/my/gmail/scan", { method: "POST", token: session, body: { ...(cursor ? { cursor } : {}), ...(full ? { full: true } : {}) } });
    assert.equal(r.status, 200, "a busy Outlook never fails the round");
    body = await r.json(); cursor = body.cursor || ""; rounds++;
  } while (body.more && rounds < 40);
  assert.equal(body.more, false, "the scan finishes");
  return rounds;
}
const captured = () => sqlite.prepare("SELECT details FROM captured_receipts WHERE shopper_id = ?").all(shopperId).map(r => JSON.parse(r.details));
const receiptRefs = () => new Set(captured().filter(d => d.kind === "receipt").map(d => d.orderRef));

// 1. Busy Outlook: nothing is lost.
const rounds = await scanAll();
assert.ok(maxInFlight <= 3, "never more than 3 Outlook reads open at once (Outlook allows 4): " + maxInFlight);
assert.equal(refused, 0, "so Outlook never had to refuse one");
const refs = receiptRefs();
for (let i = 1; i <= 30; i++) assert.ok(refs.has("RA-" + i), "order RA-" + i + " captured");
assert.ok(refs.has("RA-201"), "an email Outlook was too busy to give is read in a later round, not skipped");
for (const id of ["0101", "0102", "0103"]) assert.ok(reads.some(x => x.endsWith(id)), "payment, trip and ready-to-collect emails are read: " + id);
const stuck = captured().find(d => d.unread);
assert.ok(stuck && stuck.readTries === 3, "an email that never reads is tried 3 times, then left out");
assert.equal(sqlite.prepare("SELECT full_rev AS f FROM gmail_connections").get().f, 8, "the whole look-back period was read with the fix");
console.log(`ok - busy Outlook: ${refs.size} orders captured in ${rounds} rounds, at most ${maxInFlight} reads open at once, a failing email retried then left out`);

// 2. Even if Outlook refuses some reads (another device is busy with the same mailbox), they are asked again, not lost.
const busyBox = [];
for (let i = 301; i <= 306; i++) busyBox.push(mail(i, clock - (40 + i % 10) * DAY, "Your RAINS order confirmation #RA-" + i));
box.push(...busyBox);
inFlight = 2;   // two requests already open elsewhere: Outlook will refuse some of ours
sqlite.prepare("UPDATE gmail_connections SET last_scan_at = NULL").run();
await scanAll();
inFlight = 0;
for (let i = 301; i <= 306; i++) assert.ok(receiptRefs().has("RA-" + i), "RA-" + i + " captured although Outlook refused some reads");
console.log(`ok - reads Outlook refused (${refused} of them) were waited for and asked again`);

// 3. A mailbox read before the fix is read once more in full; only the emails Relay never read are fetched.
const missed = mail(401, clock - 200 * DAY, "Thank you for your order #RA-401");
box.push(missed);
sqlite.prepare("UPDATE gmail_connections SET last_scan_at = ?, full_rev = NULL").run(clock - DAY);
reads.length = 0; listed.length = 0;
await scanAll();
assert.ok(receiptRefs().has("RA-401"), "an older email missed before the fix is found");
assert.deepEqual(reads, [missed.id], "only the email never read before is fetched");
assert.ok(Math.min(...listed.map(w => w[0])) <= clock - 499 * DAY, "the whole look-back period was listed again");
assert.equal(sqlite.prepare("SELECT full_rev AS f FROM gmail_connections").get().f, 8);
listed.length = 0;
await scanAll();
assert.ok(Math.min(...listed.map(w => w[0])) >= clock - 40 * DAY, "after that, scans are back to recent mail only");
console.log("ok - mailboxes read before the fix are read once more in full, fetching only what was never read");

// 4. The automatic scan does the same full read again for an Outlook mailbox read before the fix.
const missed2 = mail(402, clock - 300 * DAY, "Your order #RA-402 is confirmed");
box.push(missed2);
sqlite.prepare("UPDATE gmail_connections SET last_scan_at = ?, full_rev = NULL, auto_at = NULL, auto_cursor = NULL").run(clock - DAY);
for (let i = 0; i < 12 && !receiptRefs().has("RA-402"); i++) { clock += 15 * 60 * 1000; await autoScanGmail(env, clock, fetchImpl); }
assert.ok(receiptRefs().has("RA-402"), "the automatic scan finds it without the app being open");
for (let i = 0; i < 12 && sqlite.prepare("SELECT full_rev AS f FROM gmail_connections").get().f !== 8; i++) { clock += 15 * 60 * 1000; await autoScanGmail(env, clock, fetchImpl); }
assert.equal(sqlite.prepare("SELECT full_rev AS f FROM gmail_connections").get().f, 8, "and records the full read once done");
console.log("ok - the automatic scan reads older Outlook mail again too");

// 5. Which Outlook emails are worth reading (subject and sender only).
assert.ok(looksLikeShopping("Your payment to RAINS", "service@paypal.co.uk"));
assert.ok(looksLikeShopping("Receipt for your payment", "x@y.test"));
assert.ok(looksLikeShopping("Your Monday evening trip with Uber", "noreply@uber.com"));
assert.ok(looksLikeShopping("Your parcel has been despatched", "x@y.test"));
assert.ok(looksLikeShopping("Hello", "billing@shop.test"), "a billing@ sender");
assert.ok(!looksLikeShopping("50% off this weekend", "news@shop.test"));
assert.ok(!looksLikeShopping("Dinner on Friday?", "sam@outlook.com"));
console.log("ok - payment, trip, despatch and collection emails are read; newsletters and friends are not");
