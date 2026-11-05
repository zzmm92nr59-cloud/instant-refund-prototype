// Offline test for two-step sign-in for everyone (worker/second-step.js), against a real SQLite engine.
// Email is faked; a FAKE authenticator app (RFC 6238 codes) and a FAKE passkey device (real P-256 keys) stand in for
// the shopper's. Made-up people. Nothing here proves a real phone or authenticator works.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHmac, generateKeyPairSync, randomBytes, createHash, sign as nodeSign } from "node:crypto";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { lastSecondStep, openWithoutSecondStep, hasSecondStep } from "../worker/second-step.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); } };
}
const db = { prepare: sql => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { list.forEach(s => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "boss@example.com" };
let emails = [];
const fetchImpl = async (url, init) => { emails.push({ url, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); };
let clock = 1_800_000_000_000;
const APP = "https://zzmm92nr59-cloud.github.io", RP = "zzmm92nr59-cloud.github.io";
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, origin: APP,
    ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
const read = async (path, token) => { const r = await call(path, { token }); return { status: r.status, body: await r.json() }; };
const post = async (path, token, body = {}) => { const r = await call(path, { method: "POST", token, body }); return { status: r.status, body: await r.json() }; };
let ip = 10;
// First factor: the email link. Returns the sign-in answer (a session, or "needs a second step").
async function emailSignIn(email) {
  try { sqlite.exec("DELETE FROM auth_login_tokens"); } catch { /* made on first sign-in */ } emails = [];
  assert.equal((await call("/relay/auth/request", { method: "POST", body: { email }, ip: "9.9.9." + ip++ })).status, 200);
  const token = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].body.text)[1];
  return (await post("/relay/auth/verify", undefined, { token })).body;
}
// A session from before this change (no second step recorded), for an account that already exists.
async function oldSession(email) {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  const id = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id;
  sqlite.prepare("INSERT INTO auth_sessions (session_hash, shopper_id, created_at, expires_at) VALUES (?,?,?,?)").run(hash, id, clock, clock + 864e5);
  return raw;
}
// A FAKE authenticator app.
const hotp = (key, step) => { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step)); const h = createHmac("sha1", key).update(m).digest(); const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
const unb32 = t => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const out = []; for (const c of t.replace(/ /g, "")) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const stepNow = () => Math.floor(clock / 30000);
async function turnOnApp(token) {
  const setup = await post("/relay/my/2fa/setup", token);
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  const key = unb32(setup.body.secret);
  const on = await post("/relay/my/2fa/enable", token, { code: hotp(key, stepNow()) });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  return key;
}
// A FAKE passkey device (real P-256 keys and signatures).
const b64u = b => Buffer.from(b).toString("base64url");
const sha = b => createHash("sha256").update(b).digest();
const cbor = v => {
  const head = (major, n) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const t = Buffer.from(v); return Buffer.concat([head(3, t.length), t]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error("cbor");
};
const newDevice = () => { const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" }); const jwk = publicKey.export({ format: "jwk" });
  return { privateKey, x: Buffer.from(jwk.x, "base64url"), y: Buffer.from(jwk.y, "base64url"), id: randomBytes(32), count: 0 }; };
const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin: APP, crossOrigin: false }));
const authData = (flags, count, attested) => {
  const h = Buffer.concat([sha(RP), Buffer.from([flags]), Buffer.from([count >>> 24, (count >> 16) & 255, (count >> 8) & 255, count & 255])]);
  if (!attested) return h;
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, attested.x], [-3, attested.y]]));
  return Buffer.concat([h, Buffer.alloc(16), Buffer.from([attested.id.length >> 8, attested.id.length & 255]), attested.id, cose]);
};
async function addPasskey(token, dev) {
  const o = await post("/relay/my/passkeys/options", token);
  assert.equal(o.status, 200, JSON.stringify(o.body));
  return post("/relay/my/passkeys/register", token, { id: b64u(dev.id), name: "Test phone", response: {
    clientDataJSON: b64u(clientData("webauthn.create", o.body.challenge)),
    attestationObject: b64u(cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData(0x45, 0, dev)]]))) } });
}
async function passkeySignIn(dev) {
  const o = await post("/relay/auth/passkey/options", undefined);
  dev.count++;
  const cd = clientData("webauthn.get", o.body.challenge), ad = authData(0x05, dev.count);
  return post("/relay/auth/passkey/verify", undefined, { id: b64u(dev.id), response: { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(nodeSign("sha256", Buffer.concat([ad, sha(cd)]), dev.privateKey)) } });
}

// 0. The rules on their own.
assert.equal(openWithoutSecondStep("/relay/my/2fa/enable"), true);
assert.equal(openWithoutSecondStep("/relay/my/passkeys/register"), true);
assert.equal(openWithoutSecondStep("/relay/my/receipts"), false);
assert.equal(openWithoutSecondStep("/relay/my/2factor"), false, "only the real two-step routes");
assert.equal(openWithoutSecondStep("/relay/my/admin/health"), false);
assert.equal(lastSecondStep({}, { app: true, text: false, passkeys: 0 }, "app"), false, "off: anything can be turned off");
assert.equal(lastSecondStep({ SECOND_STEP_REQUIRED: "on" }, { app: true, text: false, passkeys: 0 }, "app"), true);
assert.equal(lastSecondStep({ SECOND_STEP_REQUIRED: "on" }, { app: true, text: false, passkeys: 1 }, "app"), false, "a passkey is left");
assert.equal(lastSecondStep({ SECOND_STEP_REQUIRED: "on" }, { app: false, text: false, passkeys: 2 }, "passkey"), false);
assert.equal(lastSecondStep({ SECOND_STEP_REQUIRED: "on" }, { app: false, text: false, passkeys: 1 }, "passkey"), true);
assert.equal(hasSecondStep({ app: false, text: false, passkeys: 0 }), false);
console.log("ok - the rules: what's open without a second step, and the last one can't go");

// 1. Off (as before): no second step needed for anything.
const before = await emailSignIn("old@example.com");
assert.ok(before.sessionToken);
assert.equal((await read("/relay/my/receipts", before.sessionToken)).status, 200);
assert.deepEqual((await read("/relay/my/second-step", before.sessionToken)).body, { required: false, done: false, checked: false, app: false, text: false, passkeys: 0 });
console.log("ok - switched off: sign-in and everything work as before");

env.SECOND_STEP_REQUIRED = "on";

// 2. A new account: only setting up a second step and the basics work until it has one.
const amy = await emailSignIn("amy@example.com");
assert.ok(amy.sessionToken, "no second step yet: signed in");
assert.deepEqual((await read("/relay/my/second-step", amy.sessionToken)).body, { required: true, done: false, checked: false, app: false, text: false, passkeys: 0 });
for (const p of ["/relay/my/receipts", "/relay/my/purchases", "/relay/my/gmail", "/relay/my/export"])
  assert.deepEqual(await read(p, amy.sessionToken), { status: 403, body: { error: "second_step_needed" } }, p);
assert.equal((await post("/relay/my/receipts/parse", amy.sessionToken, { email: "x".repeat(40) })).status, 403);
for (const p of ["/relay/me", "/relay/my/2fa", "/relay/my/passkeys", "/relay/my/profile", "/relay/my/consent", "/relay/my/phone", "/relay/my/admin/me"])
  assert.notEqual((await read(p, amy.sessionToken)).status, 403, p);
console.log("ok - a new account can only set up a second step and see its basics");

// Turning on the authenticator app: the first second step, set up in this session, so the session counts as checked.
const amyKey = await turnOnApp(amy.sessionToken);
assert.deepEqual((await read("/relay/my/second-step", amy.sessionToken)).body, { required: true, done: true, checked: true, app: true, text: false, passkeys: 0 });
assert.equal((await read("/relay/my/receipts", amy.sessionToken)).status, 200);
// The last one can't be turned off.
clock += 60e3;
assert.deepEqual(await post("/relay/my/2fa/disable", amy.sessionToken, { code: hotp(amyKey, stepNow()) }), { status: 409, body: { error: "last_second_step" } });
assert.equal(sqlite.prepare("SELECT enabled FROM auth_totp t JOIN shoppers s ON s.id = t.shopper_id WHERE s.email = ?").get("amy@example.com").enabled, 1);
console.log("ok - setting up the app unlocks the account and checks this session; the last one can't be turned off");

// Signing in again asks for the code, and that session is checked.
clock += 60e3;
const again = await emailSignIn("amy@example.com");
assert.equal(again.needsSecondStep, true); assert.equal(again.sessionToken, undefined); assert.deepEqual(again.methods, ["app"]);
const done = await post("/relay/auth/2fa/verify", undefined, { pendingToken: again.pendingToken, code: hotp(amyKey, stepNow()) });
assert.equal(done.status, 200);
assert.equal((await read("/relay/my/second-step", done.body.sessionToken)).body.checked, true);
console.log("ok - signing in again asks for the code; that session is checked");

// 3. A passkey as the only second step: added in the session (checked), then email sign-in finishes with the passkey.
const pia = await emailSignIn("pia@example.com");
const phone = newDevice();
assert.equal((await addPasskey(pia.sessionToken, phone)).status, 200);
assert.equal((await read("/relay/my/second-step", pia.sessionToken)).body.checked, true);
assert.equal((await read("/relay/my/receipts", pia.sessionToken)).status, 200);
const piaAgain = await emailSignIn("pia@example.com");
assert.deepEqual([piaAgain.needsSecondStep, piaAgain.methods, piaAgain.sessionToken, piaAgain.pendingToken], [true, ["passkey"], undefined, undefined],
  "the email link alone isn't enough: finish with the passkey");
const viaPasskey = await passkeySignIn(phone);
assert.equal(viaPasskey.status, 200);
assert.equal((await read("/relay/my/second-step", viaPasskey.body.sessionToken)).body.checked, true, "a passkey sign-in is checked");
const onlyKey = sqlite.prepare("SELECT credential_id FROM auth_passkeys").get().credential_id;
assert.deepEqual(await post("/relay/my/passkeys/remove", viaPasskey.body.sessionToken, { id: onlyKey }), { status: 409, body: { error: "last_second_step" } });
// With a second passkey, one can go.
const tablet = newDevice();
assert.equal((await addPasskey(viaPasskey.body.sessionToken, tablet)).status, 200);
assert.equal((await post("/relay/my/passkeys/remove", viaPasskey.body.sessionToken, { id: onlyKey })).status, 200);
console.log("ok - a passkey-only account finishes email sign-in with its passkey; its last passkey can't be removed");

// 4. A session from before this change, on an account that has a second step: it carries on, but isn't checked. Adding
// another way from it doesn't check it (only the account's first one does).
const amyOld = await oldSession("amy@example.com");
assert.equal((await read("/relay/my/receipts", amyOld)).status, 200);
assert.equal((await read("/relay/my/second-step", amyOld)).body.checked, false);
assert.equal((await addPasskey(amyOld, newDevice())).status, 200);
assert.equal((await read("/relay/my/second-step", amyOld)).body.checked, false, "adding a second way doesn't check an old session");
// An old session on an account without one: set one up first.
const oldOnly = await oldSession("old@example.com");
assert.deepEqual(await read("/relay/my/receipts", oldOnly), { status: 403, body: { error: "second_step_needed" } });
console.log("ok - older sessions: carry on if the account has a second step, set one up if not; never checked by adding a second way");

// 5. Relay's team: team tools need a checked session; an unchecked one is told to sign in again, and the tools stay hidden.
const boss = await emailSignIn("boss@example.com");
assert.deepEqual((await read("/relay/my/admin/me", boss.sessionToken)).body, { admin: false, signInAgain: true });
assert.equal((await read("/relay/my/admin/health", boss.sessionToken)).status, 403, "not even set up yet: second step needed");
await turnOnApp(boss.sessionToken);
assert.equal((await read("/relay/my/admin/me", boss.sessionToken)).body.admin, true, "checked: team tools open");
assert.equal((await read("/relay/my/admin/health", boss.sessionToken)).status, 200);
const bossOld = await oldSession("boss@example.com");
assert.deepEqual((await read("/relay/my/admin/me", bossOld)).body, { admin: false, signInAgain: true });
assert.equal((await read("/relay/my/admin/health", bossOld)).status, 404, "an unchecked session: team tools answer as if they don't exist");
assert.deepEqual((await read("/relay/my/admin/me", amy.sessionToken)).body, { admin: false }, "not on the team: nothing to say");
console.log("ok - team tools need a checked session; an older one is asked to sign in again");

// 6. The shared app-reviewer account can't attach anything personal, so it needs no second step.
sqlite.prepare("INSERT INTO review_account (id, address, created_at) VALUES (1, ?, ?)").run("reviewer@relay.test", clock);
const reviewer = await emailSignIn("reviewer@relay.test").catch(() => null);
const reviewToken = reviewer && reviewer.sessionToken ? reviewer.sessionToken : await (async () => {
  sqlite.prepare("INSERT OR IGNORE INTO shoppers (id, email, email_hash, created_at) VALUES ('rv', 'reviewer@relay.test', 'rvhash', ?)").run(clock);
  return oldSession("reviewer@relay.test");
})();
assert.equal((await read("/relay/my/receipts", reviewToken)).status, 200, "the reviewer account isn't asked");
assert.equal((await read("/relay/my/second-step", reviewToken)).body.required, false);
console.log("ok - the app-reviewer account needs no second step");

// 7. Switched off again: optional, and anything can be turned off.
delete env.SECOND_STEP_REQUIRED;
clock += 60e3;
assert.equal((await post("/relay/my/2fa/disable", amy.sessionToken, { code: hotp(amyKey, stepNow()) })).status, 200);
console.log("PASS two-step sign-in for everyone: set one up first, the last can't go, passkey-only accounts finish with the passkey, team tools need a checked session, reviewer exempt, off works as before");
