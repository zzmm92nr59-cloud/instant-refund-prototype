// What the shopper shops for (worker/interests.js), against a real SQLite engine (sign-in email is faked).
// Checks: only a signed-in shopper can read or change their own; the choices are kept and read back (another device sees
// them); ids not on the list, too many, or the wrong shape are refused and leave the old ones; the field rules refuse
// them before the route; another account can't read them; deleting the account deletes them; the data export has them;
// a shop's category is only what Relay already knows (never guessed).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { INTEREST_IDS, cleanInterests, shopCategory } from "../worker/interests.js";
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
const jessPhone = await signIn("jess@example.com", "3.3.3.4"); // the same account on another device
const sam = await signIn("sam@example.com", "4.4.4.4");
const get = async t => { const r = await call("/relay/my/interests", { token: t }); assert.equal(r.status, 200); return r.json(); };
const put = (t, interests, raw) => call("/relay/my/interests", { method: "PUT", token: t, body: raw === undefined ? { interests } : undefined, raw });

// 1. Signed-in shoppers only; a new account has none; the list it can choose from comes with the answer.
assert.equal((await call("/relay/my/interests")).status, 401, "signed-in shoppers only");
assert.equal((await call("/relay/my/interests", { method: "PUT", body: { interests: ["fashion"] } })).status, 401);
let g = await get(jess);
assert.deepEqual([g.interests, g.updatedAt], [[], null]);
assert.deepEqual(g.choices.map(c => c.id), INTEREST_IDS);
assert.equal(INTEREST_IDS.length, 12);
assert.ok(g.choices.every(c => c.label && c.categories.length), "every interest names the shop categories it matches");
console.log("ok - only a signed-in shopper can ask; a new account has none; the twelve choices come with the answer");

// 2. Kept and read back, on another device too; repeats dropped; an empty list clears them.
let r = await put(jess, ["tech", "fashion", "tech", "daysout"]);
assert.equal(r.status, 200);
assert.deepEqual((await r.json()).interests, ["tech", "fashion", "daysout"]);
assert.deepEqual((await get(jess)).interests, ["tech", "fashion", "daysout"]);
assert.deepEqual((await get(jessPhone)).interests, ["tech", "fashion", "daysout"], "the same account on another device sees them");
assert.equal((await get(jess)).updatedAt, clock);
assert.equal((await put(jess, INTEREST_IDS)).status, 200, "all twelve is fine");
assert.equal((await put(jess, [])).status, 200);
assert.deepEqual((await get(jess)).interests, []);
assert.equal((await put(jess, ["home", "beauty"])).status, 200);
console.log("ok - kept with the account, read back on another device, repeats dropped, an empty list clears them");

// 3. Refused, and the old ones stay: ids not on the list, too many, the wrong shape.
for (const bad of [["shoes"], ["home", "Home"], ["<script>"], [1], [null], Array(13).fill("home"), "home", { home: true }, null]) {
  assert.equal((await put(jess, bad)).status, 400, "refused: " + JSON.stringify(bad).slice(0, 40));
}
assert.equal((await put(jess, undefined, "not json")).status, 400);
assert.equal((await put(jess, undefined, "{}")).status, 400);
assert.equal((await call("/relay/my/interests", { method: "POST", token: jess, body: { interests: ["home"] } })).status, 405, "changed with PUT only");
assert.deepEqual((await get(jess)).interests, ["home", "beauty"], "a refused change leaves the old ones");
assert.equal(cleanInterests(["fashion", "gaming"]).length, 2); assert.equal(cleanInterests(["toys"]), null);
// The field rules (validate.js) refuse them before the route sees them.
const checked = async body => (await checkBody(new Request("https://w.test/relay/my/interests", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), "/relay/my/interests")).response;
assert.equal(await checked({ interests: ["fashion", "tech"] }), undefined, "the field rules let a good list through");
for (const bad of [{ interests: ["shoes"] }, { interests: Array(13).fill("tech") }, { interests: ["tech"], admin: true }, { interests: "tech" }]) {
  const res = await checked(bad); assert.ok(res && res.status === 400, "the field rules refuse " + JSON.stringify(bad).slice(0, 50));
}
console.log("ok - ids not on the list, too many and the wrong shape are refused, by the field rules and by the route, and the old ones stay");

// 4. Another account can't read or change them.
assert.deepEqual((await get(sam)).interests, [], "another account sees only its own (none)");
assert.equal((await put(sam, ["travel"])).status, 200);
assert.deepEqual((await get(jess)).interests, ["home", "beauty"], "another account's change doesn't touch them");
assert.deepEqual((await get(sam)).interests, ["travel"]);
console.log("ok - each account reads and changes only its own");

// 5. The data export has them; deleting the account deletes them.
const exp = await (await call("/relay/my/export", { token: jess })).json();
assert.deepEqual(exp.interests && exp.interests.interests, ["home", "beauty"], "Download my data includes them");
assert.equal((await call("/relay/my/delete", { method: "POST", token: sam })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shopper_interests WHERE interests LIKE '%travel%'").get().n, 0, "deleting the account deletes them");
console.log("ok - the data export has them, and deleting the account deletes them");

// 6. A shop's category is only what Relay already knows: a shop it knows by name, or what its reader makes of the shop's
//    own product names. Otherwise none, so it isn't moved up.
assert.equal(shopCategory({ label: "Zara", domain: "zara-test.myshopify.com" }, []), "fashion", "a shop Relay knows by name");
assert.equal(shopCategory({ label: "Marlow Lane", domain: "marlow-lane.myshopify.com" }, ["Court Trainers", "Waxed Field Jacket", "Merino Crew Jumper"]), "fashion", "from its products");
assert.equal(shopCategory({ label: "Quillon", domain: "quillon.myshopify.com" }, ["USB-C Hub", "Wireless Earbuds", "Laptop Stand"]), "electronics");
assert.equal(shopCategory({ label: "Northfold", domain: "northfold.myshopify.com" }, []), null, "nothing to go on: no category");
assert.equal(shopCategory({ label: "Thing Co", domain: "thingco.myshopify.com" }, ["Sample 1", "Item A"]), null, "products that say nothing: no category");
console.log("ok - a shop's category is what Relay already knows, and none when it can't tell");
console.log("PASS interests: kept with the account, refused when not on the list, private to each account, and shops' categories never guessed");
