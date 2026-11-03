// Offline tests: the shopper is emailed whenever how they sign in changes, and can sign their other devices out.
// Real SQLite engine; email (Resend) and texts (Twilio) are FAKE and captured here, so nothing proves a real email arrives.
// Checks: authenticator app on and off, a sign-in with a recovery code (and how many are left), a phone number added and
// removed, codes by text on and off, a passkey removed; each email goes to the sign-in address only, names no code,
// full number or sign-in link, and is sent after the response when the Worker allows; a failed email never undoes or
// blocks the change; "Sign out other devices" ends every other session, keeps this one, and says so.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { securityNoticeMessage } from "../worker/security-mail.js";

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
  TWILIO_ACCOUNT_SID: "AC_fake_account", TWILIO_AUTH_TOKEN: "fake-twilio-token", TWILIO_FROM: "Relay" };
let emails = [], texts = [], failEmail = false, later = null;
const fetchImpl = async (url, init) => {
  if (String(url).startsWith("https://api.twilio.com/")) { texts.push(Object.fromEntries(new URLSearchParams(init.body))); return new Response("{}", { status: 201 }); }
  if (failEmail) return new Response("no", { status: 500 });
  emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 });
};
let clock = 1_800_000_000_000;
const APP = "https://zzmm92nr59-cloud.github.io";
const call = (path, { method = "GET", body, token, ip = "9.9.9.9" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, origin: APP, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl, ...(later ? { later } : {}) });
const post = (path, token, body) => call(path, { method: "POST", token, body: body || {} });
const signIn = async (email) => {
  try { sqlite.exec("DELETE FROM auth_login_tokens"); } catch { /* made on the first request */ } emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email } });
  const token = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1]; emails = [];
  return (await call("/relay/auth/verify", { method: "POST", body: { token } })).json();
};
const hotp = (key, step) => { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step)); const h = createHmac("sha1", key).update(m).digest(); const o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
const unb32 = t => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const out = []; for (const c of t.replace(/ /g, "")) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const stepNow = () => Math.floor(clock / 30000);
const codeOf = t => /^(\d{6}) is your Relay /.exec(t.Body)[1];
// Every notice: to the sign-in address only, with nothing in it that signs anyone in.
const noticeTo = (who, subject) => {
  const e = emails.filter(m => m.subject === "Relay: " + subject);
  assert.equal(e.length, 1, "one email: " + subject + " (got " + emails.map(m => m.subject).join(", ") + ")");
  assert.deepEqual(e[0].to, [who]);
  assert.ok(!/#signin=|\b\d{6}\b|7700/.test(e[0].text + e[0].html), "no sign-in link, code or full number: " + e[0].text);
  return e[0];
};

// 1. The words.
const m = securityNoticeMessage("passkey_added", { name: "Jess's <iPhone>" }, Date.UTC(2026, 10, 3, 16, 30));
assert.equal(m.subject, "Relay: A passkey was added");
assert.match(m.text, /A passkey called “Jess's <iPhone>” was added to your Relay account\./);
assert.ok(m.html.includes("Jess&#39;s &lt;iPhone&gt;") && !m.html.includes("<iPhone>"), "names are escaped in the HTML");
assert.match(m.text, /When: 3 November 2026 at 16:30/);
assert.match(m.text, /If this wasn't you, sign in to Relay with your email, open Profile, choose Devices and sign out your other devices\./);
assert.equal(securityNoticeMessage("nonsense"), null);
assert.match(securityNoticeMessage("recovery_used", { left: 1 }).text, /1 is left\./);
console.log("ok - the notices say what changed and when, and what to do if it wasn't you");

// 2. Authenticator app on, a sign-in with a recovery code, app off (with a recovery code).
const jess = (await signIn("jess@example.com")).sessionToken;
const setup = await (await post("/relay/my/2fa/setup", jess)).json();
const key = unb32(setup.secret);
emails = [];
const en = await post("/relay/my/2fa/enable", jess, { code: hotp(key, stepNow()) });
assert.equal(en.status, 200);
const recovery = (await en.json()).recoveryCodes;
noticeTo("jess@example.com", "Two-step sign-in is on");
const pending = await signIn("jess@example.com");
assert.equal(pending.needsSecondStep, true);
assert.equal(emails.length, 0, "an ordinary sign-in sends no notice");
const viaRecovery = await post("/relay/auth/2fa/verify", undefined, { pendingToken: pending.pendingToken, code: recovery[0] });
assert.equal(viaRecovery.status, 200);
assert.match(noticeTo("jess@example.com", "A recovery code was used").text, /7 are left\./);
clock += 30000;
const viaApp = await signIn("jess@example.com");
assert.equal((await post("/relay/auth/2fa/verify", undefined, { pendingToken: viaApp.pendingToken, code: hotp(key, stepNow()) })).status, 200);
assert.equal(emails.length, 0, "a sign-in with the app's code sends no notice");
assert.equal((await post("/relay/my/2fa/disable", jess, { code: recovery[1] })).status, 200);
noticeTo("jess@example.com", "Two-step sign-in is off");
console.log("ok - authenticator app on and off, and a sign-in with a recovery code (with how many are left), each emailed");

// 3. A phone number added, codes by text on and off, the number removed.
const sam = (await signIn("sam@example.com")).sessionToken;
emails = []; texts = [];
assert.equal((await post("/relay/my/phone/start", sam, { phone: "07700 900123" })).status, 200);
assert.equal((await post("/relay/my/phone/confirm", sam, { code: codeOf(texts[0]) })).status, 200);
assert.match(noticeTo("sam@example.com", "A phone number was added").text, /The number ending 123 was added/);
emails = []; clock += 31000;
assert.equal((await post("/relay/my/2fa/text/send", sam)).status, 200);
assert.equal((await post("/relay/my/2fa/text", sam, { on: true, code: codeOf(texts[texts.length - 1]) })).status, 200);
assert.match(noticeTo("sam@example.com", "Sign-in codes by text are on").text, /ending 123/);
emails = []; clock += 31000;
assert.equal((await post("/relay/my/2fa/text/send", sam)).status, 200);
assert.equal((await post("/relay/my/2fa/text", sam, { on: false, code: codeOf(texts[texts.length - 1]) })).status, 200);
noticeTo("sam@example.com", "Sign-in codes by text are off");
emails = [];
assert.equal((await post("/relay/my/phone/remove", sam)).status, 200);
assert.match(noticeTo("sam@example.com", "A phone number was removed").text, /The number ending 123 was removed/);
emails = [];
assert.equal((await post("/relay/my/phone/remove", sam)).status, 200);
assert.equal(emails.length, 0, "removing when there's no number says nothing");
console.log("ok - a phone number added and removed, codes by text on and off, each emailed (with the last 3 digits only)");

// 4. A passkey removed (adding one is checked in test-auth, which can make real passkeys; here the row is put in directly).
const samId = sqlite.prepare("SELECT id FROM shoppers WHERE email = 'sam@example.com'").get().id;
sqlite.prepare("INSERT INTO auth_passkeys (credential_id, shopper_id, public_key, sign_count, name, created_at) VALUES ('cred-1', ?, 'pk', 0, 'Sam''s iPhone', ?)").run(samId, clock);
emails = [];
assert.equal((await post("/relay/my/passkeys/remove", sam, { id: "cred-1" })).status, 200);
assert.match(noticeTo("sam@example.com", "A passkey was removed").text, /called “Sam's iPhone” was removed/);
emails = [];
assert.equal((await post("/relay/my/passkeys/remove", sam, { id: "cred-1" })).status, 404);
assert.equal(emails.length, 0, "nothing removed, nothing said");
console.log("ok - a passkey removed is emailed, with its name");

// 5. Sent after the response when the Worker allows; a failed email never blocks or undoes the change.
// (Without an email service there is no sign-in at all, so "no email service" can't happen here.)
const queued = []; later = p => queued.push(p);
const kim = (await signIn("kim@example.com")).sessionToken;
emails = [];
const kimSetup = await (await post("/relay/my/2fa/setup", kim)).json();
assert.equal((await post("/relay/my/2fa/enable", kim, { code: hotp(unb32(kimSetup.secret), stepNow()) })).status, 200);
assert.equal(queued.length, 1, "the email was handed to the Worker to send after the response");
await Promise.all(queued); noticeTo("kim@example.com", "Two-step sign-in is on");
later = null;
failEmail = true; emails = [];
const kimRow = () => sqlite.prepare("SELECT enabled FROM auth_totp WHERE shopper_id = (SELECT id FROM shoppers WHERE email = 'kim@example.com')").get();
clock += 30000;
assert.equal((await post("/relay/my/2fa/disable", kim, { code: hotp(unb32(kimSetup.secret), stepNow()) })).status, 200, "the email service failing doesn't fail the change");
assert.equal(kimRow(), undefined, "and the change stuck");
failEmail = false;
console.log("ok - sent after the response when possible; a failed email never blocks or undoes a change");

// 6. Sign out other devices: every other session ends, this one stays, and the shopper is told how many.
const lee1 = (await signIn("lee@example.com")).sessionToken, lee2 = (await signIn("lee@example.com")).sessionToken, lee3 = (await signIn("lee@example.com")).sessionToken;
const other = (await signIn("other@example.com")).sessionToken;
emails = [];
assert.equal((await post("/relay/my/devices/sign-out-others")).status, 401, "needs sign-in");
const out = await post("/relay/my/devices/sign-out-others", lee2);
assert.equal(out.status, 200); assert.deepEqual(await out.json(), { ok: true, count: 2 });
assert.equal((await call("/relay/me", { token: lee2 })).status, 200, "this device stays signed in");
assert.equal((await call("/relay/me", { token: lee1 })).status, 401); assert.equal((await call("/relay/me", { token: lee3 })).status, 401);
assert.equal((await call("/relay/me", { token: other })).status, 200, "nobody else's sessions are touched");
assert.match(noticeTo("lee@example.com", "Your other devices were signed out").text, /signed out on 2 other devices/);
emails = [];
assert.deepEqual(await (await post("/relay/my/devices/sign-out-others", lee2)).json(), { ok: true, count: 0 });
assert.equal(emails.length, 0, "nothing signed out, nothing said");
const evil = await handleAuthRoute(new Request("https://w.test/relay/my/devices/sign-out-others", { method: "POST", headers: { authorization: "Bearer " + lee2, origin: "https://evil.example" } }),
  env, new URL("https://w.test/relay/my/devices/sign-out-others"), {}, { now: clock, fetchImpl });
assert.equal(evil.status, 403, "only from Relay's own pages");
console.log("ok - sign out other devices: the others end, this one stays, other shoppers untouched, and it's emailed");
console.log("PASS security emails and devices (FAKE email and text delivery)");
