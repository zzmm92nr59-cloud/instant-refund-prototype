// Scans that carry on after the shopper leaves the app. Gmail, Google sign-in and the phone's push service are FAKED;
// the database is a real SQLite engine. Checks: connecting starts the first read on Relay's side; with the app closed the
// every-minute job finishes it and sends one "receipts are ready" notification (no shop names); while the app is open
// and asking, the scheduled job stays out of the way; when the app leaves mid-scan the job takes over; only one of them
// reads a mailbox at a time; restarting a scan is never undone by an older round; and a mailbox needing a fresh
// connection, withdrawn permission, disconnecting or deleting the account all stop or remove the job.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, runScanJobs } from "../worker/gmail.js";

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

const DAY = 86400000;
let clock = Date.UTC(2026, 9, 31, 12);
const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "/");
const b64url = s => Buffer.from(s).toString("base64url");
const b64u = bytes => Buffer.from(bytes).toString("base64url");
const mail = (n) => `From: Example Outfitters <orders@exampleoutfitters.test>\nSubject: Your order confirmation #EO-${n}\nContent-Type: text/plain\n\nOrder number: EO-${n}\nOrder date: 14 Oct 2026\nWool jumper - Qty 1 - £59.00\nOrder total: £59.00\n`;
// 120 order emails over the last 60 days: more than one round can read.
const box = {};
for (let i = 0; i < 120; i++) box["m" + i] = { raw: mail(i), day: ymd(clock - Math.floor(i / 2) * DAY) };
let gmailReads = 0, refreshOk = true, emails = [], pushes = [], duringRead = null;
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url.startsWith("https://fcm.googleapis.com/")) { pushes.push({ url, body: init.body }); return new Response("", { status: 201 }); }
  if (url === "https://oauth2.googleapis.com/token") {
    const p = new URLSearchParams(String(init.body));
    if (p.get("grant_type") === "authorization_code") return Response.json({ access_token: "a1", refresh_token: "1//refresh", scope: "https://www.googleapis.com/auth/gmail.readonly" });
    return refreshOk ? Response.json({ access_token: "a2" }) : new Response('{"error":"invalid_grant"}', { status: 400 });
  }
  if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") return Response.json({ emailAddress: "alice@gmail.test" });
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
    const q = decodeURIComponent(url), w = /after:(\S+) before:(\S+)/.exec(q);
    const ids = Object.keys(box).filter(k => box[k].day >= w[1] && box[k].day < w[2]);
    const page = Number((/pageToken=p(\d+)/.exec(url) || [])[1] || 0);
    const slice = ids.slice(page * 100, page * 100 + 100);
    return Response.json({ messages: slice.map(id => ({ id: id + "abcdef" })), ...(ids.length > page * 100 + 100 ? { nextPageToken: "p" + (page + 1) } : {}) });
  }
  const one = /messages\/(m\d+)abcdef\?format=raw$/.exec(url);
  if (one) { gmailReads++; if (duringRead) { const f = duringRead; duringRead = null; await f(); } return Response.json({ raw: b64url(box[one[1]].raw) }); }
  return new Response("nope", { status: 404 });
};
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl, busyWaitMs: 0 });
const post = (path, token, body) => call(path, { method: "POST", token, body });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
// A pretend phone that can read the notification Relay sends it.
async function phone() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
  return { kp, pub, auth, keys: { p256dh: b64u(pub), auth: b64u(auth) } };
}
async function read(ph, body) {
  const b = new Uint8Array(body), salt = b.slice(0, 16), idlen = b[20], asPub = b.slice(21, 21 + idlen), cipher = b.slice(21 + idlen);
  const hk = async (s, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []) }, ph.kp.privateKey, 256));
  const T = new TextEncoder(), cat = (...a) => Uint8Array.from(a.flatMap(x => [...x]));
  const prk = await hk(ph.auth, secret, cat(T.encode("WebPush: info\0"), ph.pub, asPub), 32);
  const cek = await hk(salt, prk, T.encode("Content-Encoding: aes128gcm\0"), 16), nonce = await hk(salt, prk, T.encode("Content-Encoding: nonce\0"), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), cipher));
  let end = plain.length - 1; while (end > 0 && plain[end] === 0) end--;
  return JSON.parse(new TextDecoder().decode(plain.slice(0, end)));
}

const alice = await signIn("alice@example.com", "5.5.5.5");
await post("/relay/my/consent", alice, { version: CONSENT_VERSION });
const ph = await phone();
assert.equal((await post("/relay/my/push/subscribe", alice, { endpoint: "https://fcm.googleapis.com/fcm/send/alice-phone", keys: ph.keys })).status, 200);
const job = () => sqlite.prepare("SELECT * FROM mail_scan_jobs").get();
const count = () => sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts WHERE status != 'not_receipt'").get().n;
const minute = async (n = 1) => { let last; for (let i = 0; i < n; i++) { clock += 60 * 1000; last = await runScanJobs(env, clock, fetchImpl, { pushFetch: fetchImpl }); } return last; };

// 1. Connecting starts the first read on Relay's side straight away.
const state = new URL((await (await post("/relay/my/gmail/connect", alice)).json()).url).searchParams.get("state");
await call("/relay/gmail/callback?code=good&state=" + state);
assert.equal(job().state, "running", "the first read is waiting to run as soon as the mailbox is connected");
console.log("ok - connecting the mailbox starts its first read on Relay's side");

// 2. The shopper closes the app straight away: the every-minute job reads everything and tells their phone once.
let runs = 0;
while (job().state === "running" && runs < 20) { await minute(); runs++; }
assert.equal(job().state, "done");
assert.equal(count(), 120, "every order email captured with the app closed");
assert.equal(pushes.length, 1, "one notification when it's finished");
const note = await read(ph, pushes[0].body);
assert.equal(note.title, "Your receipts are ready");
assert.match(note.body, /found 120 purchase emails/);
assert.ok(!/outfitters|jumper|EO-/i.test(JSON.stringify(note)), "no shop names, items or order numbers on the lock screen");
const st = await (await call("/relay/my/gmail", { token: alice })).json();
assert.deepEqual([st.scan.state, st.scan.found], ["done", 120], "the app can show what happened while it was closed");
console.log(`ok - with the app closed, the scan finished in ${runs} minutes and the phone was told once`);

// 3. While the app is open and asking for rounds, the scheduled job stays out of the way.
let r = await (await post("/relay/my/gmail/scan", alice, { full: true })).json();
assert.equal(r.job.state, "running"); assert.equal(r.job.full, true);
const readsBefore = gmailReads;
const idle = await runScanJobs(env, clock + 5000, fetchImpl);
assert.equal(idle.rounds, 0, "nothing read by the scheduled job while the app is driving the scan");
assert.equal(gmailReads, readsBefore);
console.log("ok - the scheduled job leaves a scan alone while the app is open");

// 4. The app is closed half-way: the scheduled job takes over from where the app got to and finishes, without duplicates.
pushes = [];
clock += 31 * 1000;
runs = 0;
while (job().state === "running" && runs < 20) { await minute(); runs++; }
assert.equal(job().state, "done"); assert.equal(job().full_read, 1);
assert.equal(count(), 120, "no receipt captured twice");
assert.equal(pushes.length, 0, "nothing new found, so no notification");
console.log("ok - when the app is closed mid-scan, Relay carries on and finishes it");

// 5. Only one reader at a time: while the scheduled job holds the mailbox, the app is told to wait (with the progress so far).
box.m900 = { raw: mail(900), day: ymd(clock) };
await post("/relay/my/gmail/scan", alice, {});   // a new scan, started by the app
sqlite.prepare("UPDATE mail_scan_jobs SET state = 'running', lease_until = ?, lease_id = 'scheduled-job'").run(clock + 60000);
const before = gmailReads;
r = await (await post("/relay/my/gmail/scan", alice, {})).json();
assert.equal(r.busy, true); assert.equal(r.more, true); assert.ok(r.retryAfterMs >= 1000);
assert.ok(r.job && typeof r.job.found === "number", "the app still gets the progress so far");
assert.equal(gmailReads, before, "the app didn't read the mailbox at the same time");
sqlite.prepare("UPDATE mail_scan_jobs SET lease_until = NULL, lease_id = NULL").run();
console.log("ok - the app waits while Relay is reading the same mailbox");

// 6. A scan restarted while an older round is still reading is never overwritten by that older round.
sqlite.prepare("UPDATE mail_scan_jobs SET state = 'running', full_read = 0, cursor = NULL, app_at = NULL").run();
clock += 60 * 1000;
const oldJob = job().job_id;
duringRead = async () => { await post("/relay/my/gmail/scan", alice, { full: true }); };   // the shopper taps "Re-scan all" mid-round
sqlite.prepare("DELETE FROM captured_receipts WHERE details LIKE '%EO-1%'").run();
await runScanJobs(env, clock, fetchImpl);
const j6 = job();
assert.notEqual(j6.job_id, oldJob, "the restarted scan is the one kept");
assert.equal(j6.full_read, 1); assert.equal(j6.rounds, 0, "the older round's progress was not written onto the new scan");
assert.equal(j6.lease_id, null, "and the older round still gave the mailbox back");
console.log("ok - restarting a scan is never undone by a round that was already running");

// 7. A mailbox that needs connecting again ends the scan (the app says so) instead of being retried every minute.
refreshOk = false;
clock += 2 * 60 * 1000;
await minute();
assert.equal(job().state, "failed"); assert.equal(job().error, "gmail_reconnect_needed");
const again = await minute();
assert.equal(again.jobs, 0, "not picked up again");
refreshOk = true;
console.log("ok - a mailbox that needs reconnecting stops the scan");

// 8. Withdrawn permission: never read in the background.
await post("/relay/my/gmail/scan", alice, {});
sqlite.prepare("UPDATE mail_scan_jobs SET app_at = NULL, lease_until = NULL").run();
sqlite.prepare("UPDATE shopper_consents SET withdrawn_at = ?").run(clock);
assert.equal((await minute()).jobs, 0);
sqlite.prepare("UPDATE shopper_consents SET withdrawn_at = NULL").run();
console.log("ok - no background reading without permission");

// 9. Disconnecting the mailbox, or deleting the account, removes the scan too.
await post("/relay/my/gmail/disconnect", alice, {});
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM mail_scan_jobs").get().n, 0, "disconnect removes it");
const st2 = new URL((await (await post("/relay/my/gmail/connect", alice)).json()).url).searchParams.get("state");
await call("/relay/gmail/callback?code=good&state=" + st2);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM mail_scan_jobs").get().n, 1);
assert.equal((await post("/relay/my/delete", alice, {})).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM mail_scan_jobs").get().n, 0, "deleting the account removes it");
console.log("ok - disconnecting or deleting the account removes the scan");
