// Offline test (real SQLite, fake email delivery): deleting an account removes everything that belongs to the shopper.
// It reads every table the worker code can create, gives the shopper a row in each one that names a person, deletes the
// account through the app's own endpoint, and then looks for anything left that still points at them. A table added
// later is swept automatically, so a new feature can't quietly keep people's data after they leave.
// The only rows kept are the ones the privacy policy says are kept: returns, swaps and payments made through Relay
// (the shops involved rely on them), and the swap-and-sell block list (so a blocked member can't rejoin to get round it).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";

const KEPT_ON_PURPOSE = new Set(["relay_exchanges", "relay_returns", "relay_swap_payments", "resale_blocks"]);
const BY_ID = /^(shopper_id|seller_id|buyer_id|owner_id|member_id|sender_id|recipient_id|requester_id|reporter_id|asker_id|user_id)$/;
const BY_EMAIL = /^(email|shopper_email|google_email|customer_email)$/;
const BY_EMAIL_HASH = /^email_hash$/;

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
// Every table the worker code creates (the code creates most of them the first time they're needed).
for (const f of readdirSync("worker").filter(f => f.endsWith(".js"))) {
  const src = readFileSync("worker/" + f, "utf8");
  for (const m of src.matchAll(/CREATE TABLE IF NOT EXISTS\s+\w+\s*\([\s\S]*?\)(?=\s*[`"'])/g)) {
    try { sqlite.exec(m[0].replace(/\$\{[^}]*\}/g, "")); } catch (e) { /* a statement built at run time: created by the code itself below */ }
  }
  for (const m of src.matchAll(/ALTER TABLE (\w+) ADD COLUMN ([^"`'\n]+)/g)) { try { sqlite.exec(`ALTER TABLE ${m[1]} ADD COLUMN ${m[2]}`); } catch { /* already there */ } }
}

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
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  return new Response("{}", { status: 404 });
};
const clock = Date.UTC(2026, 10, 3, 9);
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const leaver = await signIn("leaver@example.com", "5.5.5.5");
const stayer = await signIn("stayer@example.com", "6.6.6.6");
const who = email => sqlite.prepare("SELECT id, email, email_hash AS hash FROM shoppers WHERE email = ?").get(email);
const L = who("leaver@example.com"), S = who("stayer@example.com");

// Give both shoppers a row in every table that names a person.
const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
const personal = [];
let filled = 0;
for (const t of tables) {
  const cols = sqlite.prepare(`PRAGMA table_info(${t})`).all();
  const keys = cols.filter(c => BY_ID.test(c.name) || BY_EMAIL.test(c.name) || BY_EMAIL_HASH.test(c.name));
  if (!keys.length || t === "shoppers") continue;
  personal.push({ t, keys: keys.map(c => c.name) });
  for (const p of [L, S]) {
    const vals = cols.map((c, i) => BY_ID.test(c.name) ? p.id : BY_EMAIL.test(c.name) ? p.email : BY_EMAIL_HASH.test(c.name) ? p.hash
      : /INT|REAL/i.test(c.type) ? (c.pk ? Math.floor(Math.random() * 1e12) : 1) : `${t}-${c.name}-${p.id}-${i}-${Math.random()}`);
    try { sqlite.prepare(`INSERT INTO ${t} (${cols.map(c => c.name).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals); filled++; }
    catch (e) { throw new Error(`could not give ${t} a row for the test: ${e.message}`); }
  }
}
assert.ok(personal.length >= 30, "the sweep found the tables that name a person: " + personal.length);

assert.equal((await call("/relay/my/delete", { method: "POST", token: leaver })).status, 200);
assert.equal((await call("/relay/me", { token: leaver })).status, 401, "signed out everywhere");

const left = [], stayed = [];
for (const { t, keys } of personal) {
  const where = keys.map(k => `${k} = ?`).join(" OR ");
  const args = keys.map(k => BY_ID.test(k) ? L.id : BY_EMAIL.test(k) ? L.email : L.hash);
  const n = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${where}`).get(...args).n;
  if (n && !KEPT_ON_PURPOSE.has(t)) left.push(`${t} (${keys.join(", ")})`);
  const others = keys.map(k => BY_ID.test(k) ? S.id : BY_EMAIL.test(k) ? S.email : S.hash);
  if (!sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${where}`).get(...others).n && !["auth_login_tokens", "auth_code_failures"].includes(t)) stayed.push(t);
}
assert.deepEqual(left, [], "nothing of the deleted shopper is left in: " + left.join("; "));
assert.equal(who("leaver@example.com"), undefined);
// Another shopper's data is untouched.
assert.deepEqual(stayed, [], "another shopper's data was deleted too: " + stayed.join(", "));
assert.equal((await call("/relay/me", { token: stayer })).status, 200);
console.log(`PASS account deletion: ${personal.length} tables that name a person swept, nothing of the shopper left (kept on purpose: ${[...KEPT_ON_PURPOSE].join(", ")}), another shopper untouched`);
