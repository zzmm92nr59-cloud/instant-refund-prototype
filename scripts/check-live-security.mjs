// Checks the security measures on the live Relay server, from outside, the way anyone on the internet would meet them.
// Runs after every deploy (.github/workflows/live-security-check.yml). It never signs in, sends no email or text, and
// stores nothing: every request is one Relay refuses before doing any work.
//   node scripts/check-live-security.mjs [https://relay-square-api2.9pts72cy5j.workers.dev]
// Checks: an unknown address says only "not found"; the prototype's test routes are off; signed-in routes need a session;
// bodies with fields a route doesn't take are refused (sign-in and the bank-link demo); too many sign-in attempts from one
// address get a 429 with Retry-After that the app can read (Cloudflare's rate limiter counts approximately, so this keeps
// going until it answers, up to a limit).
import assert from "node:assert/strict";

const API = (process.argv[2] || "https://relay-square-api2.9pts72cy5j.workers.dev").replace(/\/$/, "");
const ORIGIN = "https://zzmm92nr59-cloud.github.io";
const ask = (path, init = {}) => fetch(API + path, { ...init, headers: { origin: ORIGIN, ...(init.headers || {}) } });
const post = (path, body) => ask(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const results = [];
async function check(name, fn) {
  try { await fn(); results.push("ok - " + name); }
  catch (e) { results.push("FAIL - " + name + ": " + String(e && e.message || e).split("\n")[0]); }
}

await check("an unknown address says only \"not found\"", async () => {
  const r = await ask("/nothing-here-" + Date.now());
  assert.equal(r.status, 404); assert.deepEqual(await r.json(), { error: "not_found" });
});
await check("the prototype's test routes are off", async () => {
  for (const p of ["/relay/test-lab", "/relay/ledger/status", "/relay/demo/inventory", "/purchases"]) {
    const r = await ask(p);
    assert.equal(r.status, 404, p); assert.deepEqual(await r.json(), { error: "not_found" }, p);
  }
});
await check("signed-in routes need a session", async () => {
  for (const p of ["/relay/my/receipts", "/relay/me", "/relay/my/profile"]) {
    const r = await ask(p);
    assert.equal(r.status, 401, p); assert.equal((await r.json()).error, "not_signed_in", p);
  }
  const r = await ask("/relay/my/receipts", { headers: { authorization: "Bearer " + "A".repeat(43) } });
  assert.equal(r.status, 401, "a made-up session");
});
await check("fields a route doesn't take are refused", async () => {
  let r = await post("/relay/auth/request", { email: "nobody@example.invalid", admin: true });
  assert.equal(r.status, 400); assert.deepEqual(await r.json(), { error: "invalid_request", field: "admin" });
  r = await post("/plaid/exchange", { public_token: "x", extra: 1 });
  assert.equal(r.status, 400); assert.deepEqual(await r.json(), { error: "invalid_request", field: "extra" });
  r = await ask("/relay/auth/request", { method: "POST", headers: { "content-type": "application/json" }, body: '{"__proto__":{"x":1}}' });
  assert.equal(r.status, 400, "prototype key");
});
await check("an over-long address is refused", async () => {
  const r = await ask("/relay/auth/providers?q=" + "a".repeat(7000));
  assert.ok(r.status === 400 || r.status === 414, "got " + r.status);
});
await check("too many sign-in attempts from one address get a 429 the app can read", async () => {
  // Each attempt is refused for its body before any work is done; only the counting matters.
  let hit = null, sent = 0;
  for (; sent < 150 && !hit; sent++) {
    const r = await post("/relay/auth/verify-code", { probe: sent });
    if (r.status === 429) hit = r;
    else assert.equal(r.status, 400, "attempt " + sent);
  }
  assert.ok(hit, "no 429 after " + sent + " attempts");
  assert.equal((await hit.json()).error, "too_many_requests");
  assert.ok(Number(hit.headers.get("retry-after")) >= 1, "Retry-After");
  assert.equal(hit.headers.get("access-control-allow-origin"), "*", "the app can read it");
  results.push("   (429 after " + sent + " attempts; the limit is 30 a minute, counted approximately)");
});

console.log(results.join("\n"));
if (results.some(r => r.startsWith("FAIL"))) process.exit(1);
console.log("PASS the live server's security measures, checked from outside");
