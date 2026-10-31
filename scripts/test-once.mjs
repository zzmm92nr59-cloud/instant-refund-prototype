// The once-only set-up never makes one request wait on another request's unfinished work (on Cloudflare that work may never
// finish if its request was abandoned, which left purchases hanging).
import assert from "node:assert/strict";
import { ensureOnce } from "../worker/once.js";
const W = { workers: true }, db = {};
// A first request whose set-up never finishes (its request was abandoned).
let calls = 0;
const stuck = ensureOnce(db, "auth-test", () => { calls++; return new Promise(() => {}); }, W);
// A second request doesn't wait for it: it does the set-up itself and carries on.
const second = await Promise.race([ensureOnce(db, "auth-test", async () => { calls++; }, W).then(() => "ran"), new Promise(r => setTimeout(() => r("hung"), 500))]);
assert.equal(second, "ran"); assert.equal(calls, 2);
// Once one has finished, later requests skip it.
await ensureOnce(db, "auth-test", async () => { calls++; }, W);
assert.equal(calls, 2);
// A failed set-up isn't remembered: the next request tries again.
let n = 0;
await assert.rejects(ensureOnce(db, "flaky", async () => { n++; throw new Error("db busy"); }, W));
await ensureOnce(db, "flaky", async () => { n++; }, W);
await ensureOnce(db, "flaky", async () => { n++; }, W);
assert.equal(n, 2);
void stuck;
console.log("once: all checks passed");
// Set-up statements go to the database in one batch where the database offers it.
import { runAll } from "../worker/once.js";
{
  const ran = [];
  await runAll({ prepare: (sql) => ({ sql }), batch: async (list) => { ran.push(list.map(x => x.sql)); } }, ["A", "B", "C"]);
  assert.deepEqual(ran, [["A", "B", "C"]]);
  const one = [];
  await runAll({ prepare: (sql) => ({ run: async () => one.push(sql) }) }, ["A", "B"]);
  assert.deepEqual(one, ["A", "B"]);
  const fell = [];
  await runAll({ prepare: (sql) => ({ run: async () => fell.push(sql) }), batch: async () => { throw new Error("not allowed in a batch"); } }, ["A", "B"]);
  assert.deepEqual(fell, ["A", "B"], "falls back to one at a time");
  console.log("once: batched set-up checks passed");
}
