// Offline test: every request to the Worker runs in one D1 session (reads can come from the nearest copy of the database
// once read replication is on), starting from the bookmark the app sends back, and the answer carries the new bookmark,
// readable by the app. A FAKE D1 binding stands in for Cloudflare's: nothing here proves replicas are switched on.
import assert from "node:assert/strict";
const worker = (await import("../worker/worker.js")).default;
const opened = [];
const fakeDb = {
  withSession(start) {
    opened.push(start);
    return {
      prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }), first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }),
      batch: async () => [],
      getBookmark: () => "0000005a-00000003-00004f6b-8d1c2a7e5c6b4e1f"
    };
  },
  prepare() { throw new Error("queries must go through the session"); },
  batch() { throw new Error("queries must go through the session"); }
};
const env = { RELAY_DB: fakeDb, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const ask = (path, headers = {}, method = "GET") => worker.fetch(new Request("https://w.test" + path, { method, headers: { origin: "https://zzmm92nr59-cloud.github.io", ...headers } }), env, ctx);

let r = await ask("/relay/auth/providers");
assert.equal(r.status, 200);
assert.deepEqual(opened, ["first-unconstrained"], "a first visit may read from any copy");
assert.equal(r.headers.get("x-d1-bookmark"), "0000005a-00000003-00004f6b-8d1c2a7e5c6b4e1f", "the answer carries the bookmark");
assert.match(r.headers.get("access-control-expose-headers") || "", /x-d1-bookmark/i, "and the app may read it");

r = await ask("/relay/auth/providers", { "x-d1-bookmark": "0000005b-00000001-00000000-0123456789abcdef" });
assert.equal(opened[1], "0000005b-00000001-00000000-0123456789abcdef", "the app's bookmark starts the session, so nothing older shows");
r = await ask("/relay/auth/providers", { "x-d1-bookmark": "not a bookmark; drop table" });
assert.equal(opened[2], "first-unconstrained", "anything that isn't a bookmark is ignored");

const pre = await ask("/relay/my/receipts", { "access-control-request-method": "GET", "access-control-request-headers": "authorization, x-d1-bookmark" }, "OPTIONS");
assert.match(pre.headers.get("access-control-allow-headers") || "", /X-D1-Bookmark/i, "the browser is allowed to send the bookmark");
assert.equal(pre.headers.get("access-control-max-age"), "86400", "and remembers that for a while");
assert.equal(opened.length, 3, "the browser's 'may I?' check opens no database session");
console.log("PASS D1 sessions: one session per request, started from the app's bookmark, answered with the new one (FAKE D1 binding)");
