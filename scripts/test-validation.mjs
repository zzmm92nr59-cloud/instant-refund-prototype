// Offline tests for the server's input checks (worker/validate.js) and rate limits (worker/limits.js), against a real
// SQLite engine. Nothing here talks to Cloudflare, Google, Microsoft, Stripe or Square: Cloudflare's own rate limiter is
// stood in for, so these tests prove Relay's side of it (what's counted, what's answered), not Cloudflare's counting.
//
// 1. The rules themselves: types, lengths, ranges, unknown fields, prototype keys, size limits, nulls, cleaning.
// 2. Every route: the checks are applied to every POST path the server knows (a probe field is refused on each), whether
//    the route has its own rules or takes nothing.
// 3. The app: every request the app made during the browser tests (recorded by scripts/record-app-requests.mjs into
//    RELAY_REQUEST_LOG) passes the rules, so the checks can't break anything the app does.
// 4. The front door (worker.js): 429s with Retry-After, the address checks, the prototype's test routes switched off,
//    and the plain 404.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { handleRetailerRoute, issueRetailerKey } from "../worker/retailer.js";
import { checkBody, checkUrl, schemaFor, validateBody, listedRoutes } from "../worker/validate.js";
import { checkRateLimits, tooManyRequests, addressOf, LIMITS, resetMemoryLimits } from "../worker/limits.js";
import { isLegacyTestRoute } from "../worker/legacy-routes.js";
import worker from "../worker/worker.js";
import { serverRoutes } from "./server-routes.mjs";

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
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  return new Response("{}", { status: 404 });
};
const now = 1_800_000_000_000;
const req = (path, { method = "POST", body, token, headers = {} } = {}) => new Request("https://w.test" + path, { method,
  headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", ...(token ? { authorization: "Bearer " + token } : {}), ...headers },
  body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const call = (path, o = {}) => handleAuthRoute(req(path, o), env, new URL("https://w.test" + path), {}, { now, fetchImpl });
let ip = 10;
async function signIn(email) {
  emails = [];
  await handleAuthRoute(req("/relay/auth/request", { body: { email }, headers: { "cf-connecting-ip": "9.9.9." + ip++ } }), env, new URL("https://w.test/relay/auth/request"), {}, { now, fetchImpl });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { body: { token: link } })).json()).sessionToken;
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. The rules.
{
  const s = { fields: { a: { type: "string", max: 5 }, n: { type: "integer", min: 0, max: 10 }, b: { type: "boolean" },
    e: { type: "enum", values: ["x", "y"] }, o: { type: "object", fields: { k: { type: "string", max: 3 } } },
    l: { type: "array", max: 2, of: { type: "integer", min: 0, max: 9 } }, t: { type: "string", max: 20, text: true },
    y: { type: "integer", min: 1990, max: 2200, digits: true }, id: { type: "id", max: 10 } } };
  const ok = (b) => { const r = validateBody(s, b); assert.ok(r.ok, "should pass: " + JSON.stringify(b) + " " + JSON.stringify(r)); return r.value; };
  const bad = (b, field) => { const r = validateBody(s, b); assert.equal(r.ok, false, "should fail: " + JSON.stringify(b)); if (field) assert.equal(r.field, field); };
  assert.deepEqual(ok({}), {});
  assert.deepEqual(ok({ a: "hey", n: 3, b: false, e: "y", o: { k: "abc" }, l: [1, 2] }), { a: "hey", n: 3, b: false, e: "y", o: { k: "abc" }, l: [1, 2] });
  assert.deepEqual(ok({ a: null, n: null }), { a: null, n: null }, "null means not given");
  bad({ zzz: 1 }, "zzz"); // unexpected field
  bad({ o: { k: "a", extra: 1 } }, "o.extra"); // unexpected field inside an object
  bad({ a: 5 }, "a"); bad({ a: "toolong" }, "a"); bad({ n: 1.5 }, "n"); bad({ n: 11 }, "n"); bad({ n: -1 }, "n"); bad({ n: "3" }, "n");
  bad({ b: "true" }, "b"); bad({ e: "z" }, "e"); bad({ o: "x" }, "o"); bad({ o: [] }, "o"); bad({ l: [1, 2, 3] }, "l"); bad({ l: [1, "2"] }, "l[1]");
  bad({ l: {} }, "l");
  assert.equal(ok({ y: "2024" }).y, "2024", "a year sent as text stays as sent"); assert.equal(ok({ y: 2024 }).y, 2024); bad({ y: "20x4" }, "y"); bad({ y: 1800 }, "y");
  assert.equal(ok({ id: 12345 }).id, 12345); assert.equal(ok({ id: "ab-1" }).id, "ab-1"); bad({ id: -1 }, "id"); bad({ id: 1.5 }, "id"); bad({ id: true }, "id");
  // Prototype pollution: JSON.parse makes these real keys, so they must be refused wherever they appear.
  for (const k of ["__proto__", "constructor", "prototype"]) { bad(JSON.parse('{"' + k + '":{"x":1}}'), k); bad(JSON.parse('{"o":{"' + k + '":1}}'), "o." + k); }
  // Cleaning: control characters go from every string; text people write for others also loses direction-flipping characters.
  assert.equal(ok({ a: "a\u0000b\u0007c" }).a, "abc");
  assert.equal(ok({ t: "line1\nline2\ttab" }).t, "line1\nline2\ttab", "new lines and tabs stay");
  assert.equal(ok({ t: "pay ‮ecnetsixe‬ now" }).t, "pay ecnetsixe now", "direction overrides removed from text");
  assert.equal(ok({ a: "‮ab" }).a, "‮ab", "only text fields lose them (ids and codes are left alone)");
  console.log("ok - the rules: types, lengths, ranges, unexpected fields, prototype keys, nulls and cleaning");
}
// The request-level wrapper: size limits, JSON shape, UTF-8, and the rebuilt request.
{
  const cors = { "Access-Control-Allow-Origin": "*" };
  const r1 = await checkBody(req("/relay/my/gmail/find", { body: "x".repeat(9000) }), "/relay/my/gmail/find", cors);
  assert.equal(r1.response.status, 413, "bigger than the route takes"); assert.deepEqual(await r1.response.json(), { error: "too_large" });
  assert.equal(r1.response.headers.get("access-control-allow-origin"), "*");
  const r2 = await checkBody(req("/relay/my/profile", { body: JSON.stringify({ photo: "data:image/png;base64," + "A".repeat(320 * 1024) }) }), "/relay/my/profile", cors);
  assert.equal(r2.response.status, 413); assert.deepEqual(await r2.response.json(), { error: "photo_too_big" }, "the profile keeps its own message for a big photo");
  for (const body of ["[1,2]", "\"text\"", "42", "{not json", "null"]) {
    const r = await checkBody(req("/relay/my/gmail/find", { body }), "/relay/my/gmail/find", cors);
    assert.equal(r.response.status, 400, body); assert.equal((await r.response.json()).error, "invalid_request");
  }
  const badUtf8 = new Request("https://w.test/relay/my/gmail/find", { method: "POST", body: new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]) });
  assert.equal((await checkBody(badUtf8, "/relay/my/gmail/find", cors)).response.status, 400, "not UTF-8");
  const fine = await checkBody(req("/relay/my/gmail/find", { body: { query: "boots\u0000" } }), "/relay/my/gmail/find", cors);
  assert.equal(fine.response, undefined); assert.deepEqual(await fine.request.json(), { query: "boots" }, "the route gets the cleaned body");
  assert.equal(fine.request.headers.get("authorization"), null); assert.equal(fine.request.method, "POST");
  const empty = await checkBody(req("/relay/my/push/test", {}), "/relay/my/push/test", cors);
  assert.equal(await empty.request.text(), "", "no body stays no body");
  const huge = new Request("https://w.test/relay/my/gmail/find", { method: "POST", headers: { "content-length": "99999999" }, body: "{}" });
  assert.equal((await checkBody(huge, "/relay/my/gmail/find", cors)).response.status, 413, "refused on its declared size, unread");
  const get = req("/relay/my/receipts", { method: "GET" });
  assert.equal((await checkBody(get, "/relay/my/receipts", cors)).request, get, "reads pass straight through");
  console.log("ok - bodies: size limits (refused unread when declared), one JSON object, UTF-8, cleaned copy for the route");
}
// Address checks.
{
  assert.ok(checkUrl(new URL("https://w.test/relay/my/receipts?year=2025")));
  assert.ok(checkUrl(new URL("https://w.test/relay/microsoft/callback?code=" + "M".repeat(1800) + "&state=abc&session_state=x")), "a long sign-in code is fine");
  assert.equal(checkUrl(new URL("https://w.test/relay/my/x?q=" + "a".repeat(7000))), false, "very long query");
  assert.equal(checkUrl(new URL("https://w.test/relay/my/x?" + Array.from({ length: 61 }, (_, i) => "k" + i + "=1").join("&"))), false, "too many parameters");
  assert.equal(checkUrl(new URL("https://w.test/relay/my/x?q=a%00b")), false, "control character in a value");
  assert.equal(checkUrl(new URL("https://w.test/relay/my/%00")), false, "control character in the path");
  console.log("ok - addresses: long, crowded or control-character queries and paths refused");
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Every route the server handles. Candidate paths come from the server's own code: every "/relay/my/...",
// "/relay/auth/..." and "/relay/retailer/..." it mentions, and a sample for each route pattern it matches.
const { routes: serverPaths, sources } = serverRoutes();
const candidates = new Set(serverPaths);
for (const p of listedRoutes()) if (/^\/relay\/(my|auth|retailer)\//.test(p)) candidates.add(p);
assert.ok(candidates.size > 100, "found the server's routes (" + candidates.size + ")");
// A body that can tell whether anything read it.
function probeRequest(path, token) {
  const state = { read: false };
  const body = new ReadableStream({ pull(c) { state.read = true; c.enqueue(new TextEncoder().encode('{"__relay_probe":1}')); c.close(); } }, { highWaterMark: 0 });
  const request = new Request("https://w.test" + path, { method: "POST", duplex: "half", body,
    headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", authorization: "Bearer " + token } });
  return { request, state };
}
{
  const alice = await signIn("alice@example.com");
  const shopKey = await issueRetailerKey(env, { provider: "shopify", shopRef: "kestrel-outdoor.myshopify.com", storeLabel: "Kestrel Outdoor" }, now);
  const unapplied = [];
  let withRules = 0;
  for (const path of [...candidates].sort()) {
    const retailer = path.startsWith("/relay/retailer/");
    const { request } = probeRequest(path, retailer ? shopKey : alice);
    const res = retailer ? await handleRetailerRoute(request, env, new URL("https://w.test" + path), {}, { now })
      : await handleAuthRoute(request, env, new URL("https://w.test" + path), {}, { now, fetchImpl });
    const status = res ? res.status : 404;
    const body = res ? await res.json().catch(() => ({})) : {};
    if (schemaFor(path)) withRules++;
    // Listed or not, every path must refuse a field it doesn't take: listed routes by their rules, the rest take none.
    if (!(status === 400 && body.error === "invalid_request" && body.field === "__relay_probe")) unapplied.push(path + " → " + status + " " + JSON.stringify(body));
  }
  assert.deepEqual(unapplied, [], "every POST path checks its body before any route reads it");
  // And nothing listed is stale: each listed route is one the server mentions.
  const stale = listedRoutes().filter(p => /^\/relay\/(my|auth|retailer)\//.test(p) && !sources.some(s => s.includes('"' + p + '"')));
  assert.deepEqual(stale, [], "every listed route exists");
  console.log("ok - every route: " + candidates.size + " paths probed, each refuses an unexpected field (" + withRules + " with their own rules, the rest take none)");
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Everything the app sent during the browser tests.
{
  const log = process.env.RELAY_REQUEST_LOG || process.argv[2];
  if (log && existsSync(log)) {
    const lines = readFileSync(log, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    const problems = [], posted = new Set();
    for (const r of lines) {
      if (!checkUrl(new URL("https://w.test" + r.path + (r.search || "")))) problems.push(r.test + ": " + r.method + " " + r.path + " fails the address checks");
      if (r.method !== "POST") continue;
      const s = schemaFor(r.path);
      posted.add(r.path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id"));
      if (!s) { problems.push(r.test + ": the app posts to " + r.path + ", which has no rules"); continue; }
      if (!r.body || !r.body.trim()) continue;
      let parsed; try { parsed = JSON.parse(r.body); } catch { problems.push(r.test + ": " + r.path + " body isn't JSON"); continue; }
      const v = validateBody(s, parsed);
      if (!v.ok) problems.push(r.test + ": " + r.path + " field " + v.field + " refused: " + JSON.stringify(parsed).slice(0, 160));
      else if (Buffer.byteLength(r.body) > (s.limit || 8192)) problems.push(r.test + ": " + r.path + " body bigger than its limit");
    }
    assert.deepEqual([...new Set(problems)], [], "everything the app sent passes the server's rules");
    console.log("ok - the app: " + lines.length + " requests from " + new Set(lines.map(l => l.test)).size + " browser tests, " + posted.size + " different POST routes, all pass");
  } else if (process.env.RELAY_REQUEST_LOG) {
    // The browser tests were meant to record (CI sets RELAY_REQUEST_LOG), so nothing recorded means the recorder didn't run.
    assert.fail("RELAY_REQUEST_LOG is set but nothing was recorded at " + log + ": run the browser tests with --import ./scripts/record-app-requests.mjs");
  } else console.log("skip - the app's own requests: no recording (run the browser tests with scripts/record-app-requests.mjs)");
}
// 3b. The app's code itself, for the requests no browser test makes: every api(...) and textCode(...) call that sends a
// body written out in place has each of its field names checked against the route's rules (values aren't known here).
{
  // Index of the bracket that closes the one at `open`, skipping strings.
  function closing(src, open) {
    const pairs = { "(": ")", "{": "}", "[": "]" }, stack = [];
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++; continue; }
      if (pairs[c]) stack.push(pairs[c]);
      else if (c === ")" || c === "}" || c === "]") { stack.pop(); if (!stack.length) return i; }
    }
    return -1;
  }
  // Splits at a separator that isn't inside brackets or strings.
  function splitTop(src, sep) {
    const parts = []; let depth = 0, last = 0;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++; continue; }
      if ("({[".includes(c)) depth++; else if (")}]".includes(c)) depth--;
      else if (c === sep && depth === 0) { parts.push(src.slice(last, i)); last = i + 1; }
    }
    parts.push(src.slice(last));
    return parts.map(p => p.trim());
  }
  // The paths a path expression can make: string pieces kept, (a ? "x" : "y") gives both, anything else is an id.
  function pathsOf(expr) {
    let outs = [""];
    for (const piece of splitTop(expr, "+")) {
      const lit = /^"([^"]*)"$/.exec(piece), alt = /^\(\s*[^?]+\?\s*"([^"]*)"\s*:\s*"([^"]*)"\s*\)$/.exec(piece);
      const options = lit ? [lit[1]] : alt ? [alt[1], alt[2]] : ["11111111-1111-4111-8111-111111111111"];
      outs = outs.flatMap(o => options.map(x => o + x));
    }
    return outs;
  }
  // Object literals in an expression that aren't inside another object literal, as { key: value text }.
  function objectsIn(expr) {
    const found = [];
    for (let i = 0; i < expr.length; i++) {
      const c = expr[i];
      if (c === '"' || c === "'") { for (i++; i < expr.length && expr[i] !== c; i++) if (expr[i] === "\\") i++; continue; }
      if (c === "{") {
        const end = closing(expr, i), inner = expr.slice(i + 1, end), fields = {};
        for (const part of splitTop(inner, ",").filter(Boolean)) {
          const m = /^([A-Za-z_$][\w$]*|"[^"]+")\s*:\s*([\s\S]*)$/.exec(part);
          if (m) fields[m[1].replace(/"/g, "")] = m[2]; else fields[part] = part;
        }
        found.push(fields);
        i = end;
      }
    }
    return found;
  }
  function checkFields(fields, schema, at, problems) {
    for (const [k, v] of Object.entries(fields)) {
      const f = schema.fields && schema.fields[k];
      if (!f) { problems.push(at + ": sends " + k + ", which the server doesn't take"); continue; }
      if (f.type === "object" && /^\{/.test(v.trim())) for (const o of objectsIn(v)) checkFields(o, f, at + "." + k, problems);
    }
  }
  const problems = [];
  let checked = 0, unknownBody = 0;
  for (const file of ["account.js", "retailer.html", "index.html", "discover.html"]) {
    const src = readFileSync(file, "utf8");
    for (const fn of ["api(", "textCode("]) {
      for (let i = src.indexOf(fn); i !== -1; i = src.indexOf(fn, i + 1)) {
        if (/[\w$.]/.test(src[i - 1] || "") || /function\s*$/.test(src.slice(Math.max(0, i - 12), i))) continue;
        const open = i + fn.length - 1, end = closing(src, open);
        if (end < 0) continue;
        const args = splitTop(src.slice(open + 1, end), ",");
        if (!/^"\/(relay|plaid)\//.test(args[0] || "")) continue;
        let body = null;
        if (fn === "textCode(") body = args[1] || "{}";
        else {
          const opts = args[1] || "";
          if (!/method:\s*"POST"/.test(opts)) continue;
          const o = objectsIn(opts)[0] || {};
          body = o.body === undefined ? "" : o.body;
        }
        for (const path of pathsOf(args[0])) {
          const s = schemaFor(path);
          if (!s) { if (!path.includes("11111111-1111")) problems.push(file + ": posts to " + path + ", which has no rules"); continue; }
          const objs = objectsIn(body.replace(/^JSON\.stringify\(([\s\S]*)\)$/, "$1"));
          if (!objs.length && body.trim() && body.trim() !== "undefined") { unknownBody++; continue; }
          checked++;
          for (const o of objs) checkFields(o, s, file + " " + path, problems);
        }
      }
    }
  }
  assert.deepEqual([...new Set(problems)], [], "every field the app's code sends is one the server takes");
  assert.ok(checked > 50, "found the app's requests (" + checked + ")");
  console.log("ok - the app's code: " + checked + " requests checked field by field (" + unknownBody + " build their body elsewhere and are covered by the browser tests)");
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Rate limits, and the front door.
{
  resetMemoryLimits();
  const r = (path, h = {}, method = "POST") => new Request("https://w.test" + path, { method, headers: { "cf-connecting-ip": "203.0.113.5", ...h } });
  const u = (path) => new URL("https://w.test" + path);
  // Sign-in: 30 a minute from one address, then a 429 that says when to come back.
  for (let i = 0; i < LIMITS.signIn.limit; i++) assert.equal(await checkRateLimits(r("/relay/auth/request"), {}, u("/relay/auth/request"), now), null);
  const hit = await checkRateLimits(r("/relay/auth/request"), {}, u("/relay/auth/request"), now);
  assert.equal(hit.scope, "sign_in"); assert.ok(hit.retryAfterMs > 0 && hit.retryAfterMs <= 60000);
  const res = tooManyRequests(hit, { "Access-Control-Allow-Origin": "*" });
  assert.equal(res.status, 429); assert.equal((await res.json()).error, "too_many_requests");
  assert.ok(Number(res.headers.get("retry-after")) >= 1); assert.equal(res.headers.get("access-control-allow-origin"), "*"); assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(await checkRateLimits(r("/relay/auth/request", { "cf-connecting-ip": "203.0.113.6" }), {}, u("/relay/auth/request"), now), null, "another address has its own allowance");
  assert.equal(await checkRateLimits(r("/relay/auth/request"), {}, u("/relay/auth/request"), now + 61000), null, "a minute later it's fine again");
  // A signed-in shopper: 600 a minute wherever they are; mail searches 60 a minute; pictures don't count towards the 600.
  resetMemoryLimits();
  const A = { authorization: "Bearer " + "a".repeat(43) }, B = { authorization: "Bearer " + "b".repeat(43) };
  for (let i = 0; i < LIMITS.mail.limit; i++) assert.equal(await checkRateLimits(r("/relay/my/gmail/find", { ...A, "cf-connecting-ip": "198.51.100." + (i % 200) }), {}, u("/relay/my/gmail/find"), now), null);
  assert.equal((await checkRateLimits(r("/relay/my/gmail/find", { ...A, "cf-connecting-ip": "198.51.100.250" }), {}, u("/relay/my/gmail/find"), now)).scope, "mail", "counted per shopper, from any address");
  assert.equal(await checkRateLimits(r("/relay/my/gmail/find", { ...B }), {}, u("/relay/my/gmail/find"), now), null, "another shopper isn't affected");
  assert.equal(await checkRateLimits(r("/relay/my/receipts", { ...A, "cf-connecting-ip": "198.51.100.251" }, "GET"), {}, u("/relay/my/receipts"), now), null, "other reads still work");
  resetMemoryLimits();
  for (let i = 0; i < LIMITS.user.limit; i++) await checkRateLimits(r("/relay/my/receipts", { ...A, "cf-connecting-ip": "192.0.2." + (i % 250) }, "GET"), {}, u("/relay/my/receipts"), now);
  assert.equal((await checkRateLimits(r("/relay/my/receipts", { ...A, "cf-connecting-ip": "192.0.2.251" }, "GET"), {}, u("/relay/my/receipts"), now)).scope, "account");
  assert.equal(await checkRateLimits(r("/relay/my/logo/kestrel.example", { ...A, "cf-connecting-ip": "192.0.2.252" }, "GET"), {}, u("/relay/my/logo/kestrel.example"), now), null, "pictures still load");
  // One address: 1200 a minute in all. IPv6 is counted by its /64 block.
  resetMemoryLimits();
  for (let i = 0; i < LIMITS.ip.limit; i++) await checkRateLimits(r("/relay/live-test/products", { "cf-connecting-ip": "2001:db8:1:2::" + (i % 9000).toString(16) }, "GET"), {}, u("/relay/live-test/products"), now);
  assert.equal((await checkRateLimits(r("/relay/live-test/products", { "cf-connecting-ip": "2001:db8:1:2:ffff:1:2:3" }, "GET"), {}, u("/relay/live-test/products"), now)).scope, "address", "a whole /64 counts as one");
  assert.equal(addressOf(r("/", { "cf-connecting-ip": "2001:0db8:0001:0002:0000:0000:0000:0001" })), "2001:db8:1:2::/64");
  assert.equal(addressOf(r("/", { "cf-connecting-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(addressOf(r("/", { "cf-connecting-ip": "::ffff:203.0.113.9" })), "203.0.113.9", "IPv4 written the IPv6 way counts as itself");
  // Webhooks and the browser's preflight aren't counted.
  for (let i = 0; i < 5; i++) assert.equal(await checkRateLimits(r("/relay/webhooks/shopify", { "cf-connecting-ip": "2001:db8:1:2::9" }), {}, u("/relay/webhooks/shopify"), now), null);
  assert.equal(await checkRateLimits(r("/relay/auth/request", { "cf-connecting-ip": "2001:db8:1:2::9" }, "OPTIONS"), {}, u("/relay/auth/request"), now), null);
  // Cloudflare's binding, when it's there, is used instead of memory; if it fails, the request goes ahead.
  const seen = [];
  const binding = (ok) => ({ async limit({ key }) { seen.push(key); return { success: ok }; } });
  assert.equal(await checkRateLimits(r("/relay/auth/request"), { RL_IP: binding(true), RL_SIGNIN: binding(true) }, u("/relay/auth/request"), now), null);
  assert.deepEqual(seen, ["ip:203.0.113.5", "signIn:203.0.113.5"]);
  assert.equal((await checkRateLimits(r("/relay/auth/request"), { RL_IP: binding(true), RL_SIGNIN: binding(false) }, u("/relay/auth/request"), now)).scope, "sign_in");
  const broken = { async limit() { throw new Error("unavailable"); } };
  const quiet = console.error; console.error = () => {};
  assert.equal(await checkRateLimits(r("/relay/auth/request"), { RL_IP: broken, RL_SIGNIN: broken }, u("/relay/auth/request"), now), null, "a broken counter never locks people out");
  console.error = quiet;
  assert.ok(seen.every(k => !k.includes("a".repeat(20))), "credentials are never used as counter names");
  console.log("ok - rate limits: per address, per sign-in address, per shopper, per mailbox search; IPv6 by /64; webhooks exempt; Cloudflare's binding used when there; fails open");
}
{
  resetMemoryLimits();
  const ctx = { waitUntil() {} };
  const front = (path, init = {}, e = env) => worker.fetch(new Request("https://w.test" + path, { ...init, headers: { "cf-connecting-ip": "100.64.0.1", ...(init.headers || {}) } }), e, ctx);
  // Through the real front door: the 31st sign-in attempt in a minute gets a 429 the app can read.
  let last;
  for (let i = 0; i <= LIMITS.signIn.limit; i++) last = await front("/relay/auth/verify-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x@example.com", code: "000000" }) });
  assert.equal(last.status, 429); assert.equal((await last.json()).error, "too_many_requests"); assert.ok(last.headers.get("retry-after"));
  assert.equal(last.headers.get("access-control-allow-origin"), "*", "the app can read it");
  // Bad addresses are refused before any route.
  assert.equal((await front("/relay/my/receipts?q=a%00")).status, 400);
  // The prototype's test routes: off unless switched on.
  for (const p of ["/relay/test-lab", "/relay/test-lab/setup", "/relay/live-test", "/relay/live-test/pay", "/relay/ledger/status", "/relay/demo/inventory", "/purchases", "/order/ABC", "/relay/match-test", "/plaid/sandbox-transaction", "/relay/returns/sandbox-options"]) {
    assert.ok(isLegacyTestRoute(p), p);
    const x = await front(p, { method: p.includes("pay") || p.includes("setup") ? "POST" : "GET" });
    assert.equal(x.status, 404, p); assert.deepEqual(await x.json(), { error: "not_found" });
  }
  for (const p of ["/relay/live-test/products", "/relay/shopify/catalogue", "/relay/shopify/status", "/relay/verified-purchases", "/plaid/connect", "/plaid/exchange", "/relay/my/receipts", "/relay/auth/providers"]) assert.equal(isLegacyTestRoute(p), false, p + " stays on");
  const on = await front("/relay/ledger/status", {}, { ...env, LEGACY_TEST_ROUTES: "on" });
  assert.equal(on.status, 200, "switched back on with LEGACY_TEST_ROUTES"); assert.equal((await on.json()).success, true);
  // An unknown address no longer lists the prototype's routes.
  const nf = await front("/nothing-here");
  assert.equal(nf.status, 404); assert.deepEqual(await nf.json(), { error: "not_found" });
  // The bank-link demo's exchange is checked too.
  const px = await front("/plaid/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ public_token: "x", extra: 1 }) });
  assert.equal(px.status, 400); assert.deepEqual(await px.json(), { error: "invalid_request", field: "extra" });
  console.log("ok - front door: 429 with Retry-After the app can read; bad addresses refused; prototype test routes off (and back on when switched); plain 404");
}
console.log("PASS server input checks and rate limits: rules, every route, the app's own requests, front door");
