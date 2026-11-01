// Your name and profile photo, against a real SQLite engine (sign-in email is faked).
// Checks: only the signed-in shopper can see or change their own; names are tidied and odd ones refused; only real, small
// JPEG/PNG/WebP pictures are kept; parts not sent are left alone; deleting the account deletes the name and photo.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { cleanName, cleanPhoto } from "../worker/profile.js";

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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key" };
let emails = [];
const fetchImpl = async (url, init) => { if (String(url).startsWith("https://api.resend.com/")) emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); };
const clock = 1_800_000_000_000;
const call = (path, { method = "GET", body, raw, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  assert.equal((await call("/relay/auth/request", { method: "POST", body: { email }, ip })).status, 200);
  const token = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  const r = await call("/relay/auth/verify", { method: "POST", body: { token } });
  assert.equal(r.status, 200);
  return (await r.json()).sessionToken;
}
const jpeg = (n = 400) => "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]).toString("base64");
const png = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)]).toString("base64");
const webp = "data:image/webp;base64," + Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4, 0), Buffer.from("WEBP"), Buffer.alloc(300, 2)]).toString("base64");

const jess = await signIn("jess@example.com", "3.3.3.3");
const sam = await signIn("sam@example.com", "4.4.4.4");
const get = async t => (await call("/relay/my/profile", { token: t })).json();
const set = (t, body) => call("/relay/my/profile", { method: "POST", token: t, body });

// 1. Nothing set yet: the app shows the first letter of the email.
assert.deepEqual(await get(jess), { email: "jess@example.com", name: null, photo: null, updatedAt: null });
assert.equal((await call("/relay/my/profile")).status, 401, "signed-in shoppers only");
console.log("ok - a new account has no name or photo, and only a signed-in shopper can ask");

// 2. Name: tidied, any language, and nonsense refused.
let r = await set(jess, { name: "  Jessica   O’Neill-Smith " });
assert.equal(r.status, 200);
assert.equal((await r.json()).name, "Jessica O’Neill-Smith");
assert.equal(cleanName("Zoë"), "Zoë"); assert.equal(cleanName("李小龍"), "李小龍"); assert.equal(cleanName("Dr. Amy Brown"), "Dr. Amy Brown");
for (const bad of ["<script>alert(1)</script>", "x".repeat(41), "😀😀", "-Jess", 42, { a: 1 }]) {
  assert.equal((await set(jess, { name: bad })).status, 400, "refused: " + JSON.stringify(bad).slice(0, 30));
}
assert.equal((await get(jess)).name, "Jessica O’Neill-Smith", "a refused name leaves the old one");
console.log("ok - names are tidied, any language works, and odd ones are refused");

// 3. Photo: real small pictures only; the name is left alone when only the photo is sent.
for (const good of [jpeg(), png, webp]) {
  r = await set(jess, { photo: good });
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(p.photo, good); assert.equal(p.name, "Jessica O’Neill-Smith");
}
const fakeJpeg = "data:image/jpeg;base64," + Buffer.from("<svg onload=alert(1)>" + "x".repeat(200)).toString("base64");
for (const bad of [fakeJpeg, "data:image/svg+xml;base64,PHN2Zz4=", "https://evil.example/me.jpg", jpeg(160_000), "data:image/jpeg;base64,/9j/", "not a photo"]) {
  assert.equal((await set(jess, { photo: bad })).status, 400, "refused: " + bad.slice(0, 40));
}
assert.equal((await call("/relay/my/profile", { method: "POST", token: jess, raw: JSON.stringify({ photo: "data:image/jpeg;base64," + "A".repeat(300_000) }) })).status, 413, "too big to read");
assert.equal(cleanPhoto(jpeg()).type, "image/jpeg");
console.log("ok - only real JPEG, PNG or WebP pictures under 150 KB are kept; a picture's bytes must match its type");

// 4. Each shopper sees and changes only their own.
assert.deepEqual(await get(sam), { email: "sam@example.com", name: null, photo: null, updatedAt: null }, "Sam never sees Jess's name or photo");
await set(sam, { name: "Sam" });
assert.equal((await get(jess)).name, "Jessica O’Neill-Smith", "Sam's change never touches Jess");
console.log("ok - each shopper only sees and changes their own");

// 5. Removing: the photo alone, then the name (an empty profile is not kept at all).
r = await set(jess, { photo: null });
assert.equal((await r.json()).photo, null);
assert.equal((await get(jess)).name, "Jessica O’Neill-Smith");
await set(jess, { name: "   " });
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM shopper_profiles WHERE name IS NULL AND photo_data IS NULL").get().n, 0, "nothing kept once both are removed");
console.log("ok - the photo or the name can be removed on its own");

// 6. Deleting the account deletes the name and photo.
await set(sam, { photo: jpeg() });
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM shopper_profiles").get().n, 1);
assert.equal((await call("/relay/my/delete", { method: "POST", token: sam })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM shopper_profiles").get().n, 0, "Sam's name and photo are gone with the account");
// On a database that has never had a profile table, deleting an account still works (the table is made first).
const fresh = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) fresh.exec(readFileSync("worker/migrations/" + f, "utf8"));
const fstmt = (sql, args = []) => ({ bind: (...a) => fstmt(sql, a), async run() { fresh.prepare(sql).run(...args); return {}; }, async first() { return fresh.prepare(sql).get(...args) ?? null; },
  async all() { return { results: fresh.prepare(sql).all(...args) }; }, _exec() { fresh.prepare(sql).run(...args); } });
const env2 = { ...env, RELAY_DB: { prepare: sql => fstmt(sql), async batch(list) { fresh.exec("BEGIN"); try { list.forEach(s => s._exec()); fresh.exec("COMMIT"); } catch (e) { fresh.exec("ROLLBACK"); throw e; } return []; } } };
const call2 = (path, body, token) => handleAuthRoute(new Request("https://w.test" + path, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "5.5.5.5", ...(token ? { authorization: "Bearer " + token } : {}) },
  body: JSON.stringify(body || {}) }), env2, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
emails = [];
await call2("/relay/auth/request", { email: "ola@example.com" });
const ola = (await (await call2("/relay/auth/verify", { token: /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1] })).json()).sessionToken;
assert.equal(fresh.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'shopper_profiles'").get().n, 0, "no profile table yet");
assert.equal((await call2("/relay/my/delete", {}, ola)).status, 200, "deleting works");
assert.equal(fresh.prepare("SELECT COUNT(*) n FROM shoppers").get().n, 0);
console.log("ok - deleting the account deletes the name and photo (and works before anyone has set one)");
