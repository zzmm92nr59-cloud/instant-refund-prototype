// Offline test for signing in on a new device by approving it from a phone that's already signed in (worker/phone-signin.js),
// against a real SQLite engine. Email is faked. Made-up people. Nothing here proves a real phone or computer works.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { deviceName, tidyCode } from "../worker/phone-signin.js";
import { securityNoticeMessage } from "../worker/security-mail.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); } };
}
const db = { prepare: sql => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { list.forEach(s => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key" };
let emails = [];
const fetchImpl = async (url, init) => { emails.push({ url, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); };
let clock = 1_800_000_000_000;
const APP = "https://zzmm92nr59-cloud.github.io";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const call = (path, { method = "GET", body, token, ip = "1.1.1.1", origin = APP, ua = MAC_CHROME } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, "user-agent": ua,
    ...(origin ? { origin } : {}), ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }),
    env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
const post = async (path, token, body = {}, extra = {}) => { const r = await call(path, { method: "POST", token, body, ...extra }); return { status: r.status, body: await r.json() }; };
let ipN = 10;
async function emailSignIn(email) {
  try { sqlite.exec("DELETE FROM auth_login_tokens"); } catch { /* made on first sign-in */ } emails = [];
  assert.equal((await call("/relay/auth/request", { method: "POST", body: { email }, ip: "9.9.9." + ipN++ })).status, 200);
  const token = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].body.text)[1];
  const b = (await post("/relay/auth/verify", undefined, { token })).body;
  assert.ok(b.sessionToken, JSON.stringify(b));
  return b.sessionToken;
}
const start = (ip = "2.2.2.2") => post("/relay/auth/phone/start", undefined, {}, { ip });
const check = (pollToken) => post("/relay/auth/phone/check", undefined, { pollToken });
const sessionRow = (raw) => sqlite.prepare("SELECT * FROM auth_sessions WHERE session_hash = ?").get(createHash("sha256").update(raw).digest("hex"));
let passed = 0; const ok = (m) => { passed++; console.log("ok - " + m); };

// Small pieces.
assert.equal(deviceName(MAC_CHROME), "Chrome on a Mac");
assert.equal(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "Safari on an iPhone");
assert.equal(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"), "Edge on a Windows computer");
assert.equal(deviceName(""), "A browser");
assert.equal(tidyCode("abcd-efgh"), "ABCDEFGH");
assert.equal(tidyCode(" AB CD EF GH "), "ABCDEFGH");
assert.equal(tidyCode("ABCDEFG"), "", "too short");
assert.equal(tidyCode("ABCDEFG0"), "", "0 is never in a code");
assert.ok(securityNoticeMessage("device_approved", { device: "Chrome on a Mac" }).text.includes("Chrome on a Mac was signed in"));
ok("device names, typed codes and the email wording");

const phone = await emailSignIn("connor.test@example.com");
const other = await emailSignIn("someone.else@example.com");

// The whole journey.
{
  const s = await start();
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.match(s.body.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  assert.match(s.body.pollToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(s.body.expiresAt, clock + 5 * 60 * 1000);
  const stored = JSON.stringify(sqlite.prepare("SELECT * FROM auth_phone_requests").all());
  assert.ok(!stored.includes(s.body.code) && !stored.includes(s.body.pollToken), "only hashes are kept");
  assert.deepEqual((await check(s.body.pollToken)).body, { waiting: true });
  ok("a new device gets a code and a poll token, and waits");

  const look = await post("/relay/my/devices/look", phone, { code: s.body.code.toLowerCase().slice(0, 4) + "-" + s.body.code.slice(4).toLowerCase() });
  assert.equal(look.status, 200, JSON.stringify(look.body));
  assert.equal(look.body.device, "Chrome on a Mac");
  assert.equal(look.body.startedAt, clock);
  assert.deepEqual((await check(s.body.pollToken)).body, { waiting: true }, "looking is not approving");
  ok("the phone finds the request by its code (any case, with a dash) and sees which device it is");

  emails = [];
  clock += 20_000;
  const yes = await post("/relay/my/devices/approve", phone, { code: s.body.code });
  assert.equal(yes.status, 200, JSON.stringify(yes.body));
  assert.equal(yes.body.device, "Chrome on a Mac");
  assert.equal(emails.length, 1);
  assert.equal(emails[0].body.to[0], "connor.test@example.com");
  assert.equal(emails[0].body.subject, "Relay: A new device was signed in from your phone");
  ok("approving emails the shopper");

  const got = await check(s.body.pollToken);
  assert.equal(got.status, 200, JSON.stringify(got.body));
  assert.ok(got.body.sessionToken && got.body.email === "connor.test@example.com");
  const me = await call("/relay/me", { token: got.body.sessionToken });
  assert.equal((await me.json()).email, "connor.test@example.com");
  assert.equal(sessionRow(got.body.sessionToken).second_step, 0, "the phone hadn't passed a second step, so neither has the new device");
  ok("the new device is signed in to the account that approved it");

  assert.equal((await check(s.body.pollToken)).status, 410, "a second check gets nothing");
  assert.equal((await post("/relay/my/devices/approve", other, { code: s.body.code })).status, 404, "a used code can't be approved again");
  ok("it works once");
}

// A code nobody started, an expired one, and checks that don't hold a real poll token.
{
  assert.equal((await post("/relay/my/devices/look", other, { code: "ABCDEFGH" })).body.error, "code_not_found");
  assert.equal((await post("/relay/my/devices/approve", other, { code: "not a code" })).status, 404);
  const s = await start("3.3.3.3");
  clock += 5 * 60 * 1000 + 1;
  assert.equal((await post("/relay/my/devices/approve", other, { code: s.body.code })).status, 404, "expired");
  assert.equal((await check(s.body.pollToken)).status, 410);
  assert.equal((await check("x".repeat(43))).status, 410, "unknown poll token");
  assert.equal((await post("/relay/auth/phone/check", undefined, { pollToken: "short" })).status, 400);
  assert.equal((await post("/relay/auth/phone/check", undefined, { pollToken: "a".repeat(43), extra: 1 })).status, 400, "unlisted fields are refused");
  ok("unknown, expired and malformed codes and tokens get nothing");
}

// Not signed in, or from another website.
{
  const s = await start("4.4.4.4");
  assert.equal((await post("/relay/my/devices/approve", undefined, { code: s.body.code })).status, 401);
  assert.equal((await post("/relay/my/devices/approve", other, { code: s.body.code }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post("/relay/auth/phone/start", undefined, {}, { origin: "https://evil.example", ip: "4.4.4.5" })).status, 403);
  assert.deepEqual((await check(s.body.pollToken)).body, { waiting: true });
  ok("approving needs a session on Relay's own app");
}

// Too many wrong codes on one account stops it for a while; too many live requests from one address too.
{
  clock += 15 * 60 * 1000 + 1; // the wrong codes above no longer count
  for (let i = 0; i < 8; i++) assert.equal((await post("/relay/my/devices/look", other, { code: "ZZZZZZZ" + "23456789"[i] })).status, 404);
  const s = await start("5.5.5.5");
  assert.equal((await post("/relay/my/devices/approve", other, { code: s.body.code })).status, 429, "even the right code, once over the limit");
  clock += 15 * 60 * 1000 + 1;
  const s2 = await start("5.5.5.6");
  assert.equal((await post("/relay/my/devices/approve", other, { code: s2.body.code })).status, 200, "allowed again later");
  for (let i = 0; i < 5; i++) assert.equal((await start("6.6.6.6")).status, 200);
  assert.equal((await start("6.6.6.6")).status, 429);
  ok("guessing is capped per account, and starting is capped per address");
}

// A phone that passed a second step passes it on; deleting the account removes its requests.
{
  sqlite.prepare("UPDATE auth_sessions SET second_step = 1 WHERE session_hash = ?").run(createHash("sha256").update(phone).digest("hex"));
  const s = await start("7.7.7.7");
  assert.equal((await post("/relay/my/devices/approve", phone, { code: s.body.code })).status, 200);
  const got = await check(s.body.pollToken);
  assert.equal(sessionRow(got.body.sessionToken).second_step, 1);
  ok("a second step passed on the phone carries over");
  const before = sqlite.prepare("SELECT COUNT(*) AS n FROM auth_phone_requests WHERE shopper_id IS NOT NULL").get().n;
  assert.ok(before > 0);
  assert.equal((await post("/relay/my/delete", other, {})).status, 200);
  const otherId = sqlite.prepare("SELECT COUNT(*) AS n FROM shoppers WHERE email = 'someone.else@example.com'").get().n;
  assert.equal(otherId, 0);
  ok("deleting an account removes what it approved");
}

console.log(`\n${passed} checks passed`);
