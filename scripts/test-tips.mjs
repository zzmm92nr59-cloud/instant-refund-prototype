// Which first-run tips a shopper has seen (worker/tips.js), against a real SQLite engine (sign-in email is faked).
// Checks: only a signed-in shopper can read or change their own; kept and read back (another device sees them); ids not on
// the list or the wrong shape are refused by the field rules and the route, and leave the old ones; an empty list is
// "show the tips again"; another account can't see them; the data export has them; deleting the account deletes them.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { TIP_IDS, cleanTips } from "../worker/tips.js";
import { checkBody } from "../worker/validate.js";

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
const jess = await signIn("jess@example.com", "3.3.3.3");
const jessPhone = await signIn("jess@example.com", "3.3.3.4");
const sam = await signIn("sam@example.com", "4.4.4.4");
const get = async t => { const r = await call("/relay/my/tips", { token: t }); assert.equal(r.status, 200); return r.json(); };
const put = (t, seen, raw) => call("/relay/my/tips", { method: "PUT", token: t, body: raw === undefined ? { seen } : undefined, raw });

assert.equal((await call("/relay/my/tips")).status, 401, "signed-in shoppers only");
assert.equal((await call("/relay/my/tips", { method: "PUT", body: { seen: ["home"] } })).status, 401);
assert.deepEqual(await get(jess), { seen: [], updatedAt: null });
assert.deepEqual(TIP_IDS, ["home", "ask", "browse", "receipts"]);
console.log("ok - only a signed-in shopper can ask; a new account has seen none");

let r = await put(jess, ["home", "ask", "home"]);
assert.equal(r.status, 200);
assert.deepEqual((await r.json()).seen, ["home", "ask"]);
assert.deepEqual((await get(jessPhone)).seen, ["home", "ask"], "another device of the same account sees them");
assert.equal((await put(jess, TIP_IDS)).status, 200);
assert.equal((await put(jess, [])).status, 200, "an empty list is 'show the tips again'");
assert.deepEqual((await get(jess)).seen, []);
assert.equal((await put(jess, ["home", "browse"])).status, 200);
console.log("ok - kept with the account, read back on another device, repeats dropped, an empty list shows them again");

for (const bad of [["profile"], ["Home"], [1], [null], Array(5).fill("home"), "home", { home: true }, null]) {
  assert.equal((await put(jess, bad)).status, 400, "refused: " + JSON.stringify(bad));
}
assert.equal((await put(jess, undefined, "not json")).status, 400);
assert.equal((await call("/relay/my/tips", { method: "POST", token: jess, body: { seen: ["ask"] } })).status, 405, "changed with PUT only");
assert.deepEqual((await get(jess)).seen, ["home", "browse"], "a refused change leaves the old ones");
assert.equal(cleanTips(["wallet"]), null);
const checked = async body => (await checkBody(new Request("https://w.test/relay/my/tips", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), "/relay/my/tips")).response;
assert.equal(await checked({ seen: ["home", "ask"] }), undefined, "the field rules let a good list through");
for (const bad of [{ seen: ["wallet"] }, { seen: Array(5).fill("ask") }, { seen: ["ask"], admin: true }, { seen: "ask" }]) {
  const res = await checked(bad); assert.ok(res && res.status === 400, "the field rules refuse " + JSON.stringify(bad));
}
console.log("ok - ids not on the list and the wrong shape are refused, by the field rules and by the route, and the old ones stay");

assert.deepEqual((await get(sam)).seen, [], "another account sees only its own");
assert.equal((await put(sam, ["receipts"])).status, 200);
assert.deepEqual((await get(jess)).seen, ["home", "browse"]);
const exp = await (await call("/relay/my/export", { token: jess })).json();
assert.deepEqual(exp.tips && exp.tips.seen, ["home", "browse"], "Download my data includes them");
assert.equal((await call("/relay/my/delete", { method: "POST", token: sam })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shopper_tips WHERE seen LIKE '%receipts%'").get().n, 0, "deleting the account deletes them");
console.log("ok - private to each account, in the data export, deleted with the account");
console.log("PASS first-run tips seen: kept with the account, checked, private, exported and deleted with it");
