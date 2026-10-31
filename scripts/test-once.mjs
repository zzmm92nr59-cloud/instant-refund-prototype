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
