// Relay's real server (worker/worker.js, the same code Cloudflare runs) on this computer, for end-to-end tests.
//
// What is real: every route, every check and every SQL statement in worker/, run by worker.js's own fetch() against a real
// SQLite database built from worker/migrations (D1 is SQLite). Two-step sign-in is required, as it is live.
// What stands in, because it lives outside Relay: Cloudflare's D1 binding (a thin wrapper over node:sqlite with D1's
// prepare / bind / first / all / run / batch), the rate-limit bindings (left out, so limits.js counts in memory, as it does
// without them) and every outside service. Nothing leaves this computer: Resend's email API is answered here and the
// emails are kept for the test to read (sign-in links); any other outside address (Stripe, Google, Shopify, Square…)
// answers 503, and is written down in `outside` so a test can see what was tried.
//
// Never points at Relay's live worker or database: the database is a new file (or memory) each run, with made-up people.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// D1's binding, over node:sqlite. D1 turns true/false into 1/0 and refuses undefined; so does this.
function d1(sqlite) {
  const args = a => a.map(v => { if (v === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported"); return typeof v === "boolean" ? (v ? 1 : 0) : v; });
  const stmt = (sql, a = []) => ({
    bind: (...b) => stmt(sql, args(b)),
    async first(col) { const row = sqlite.prepare(sql).get(...a) ?? null; return col ? (row ? row[col] ?? null : null) : row; },
    async all() { return { success: true, results: sqlite.prepare(sql).all(...a), meta: {} }; },
    async raw() { return sqlite.prepare(sql).all(...a).map(r => Object.values(r)); },
    async run() { const s = sqlite.prepare(sql); const r = /\bRETURNING\b/i.test(sql) ? (s.all(...a), { changes: 0 }) : s.run(...a); return { success: true, results: [], meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } }; },
    _exec() { const s = sqlite.prepare(sql); return /^\s*(SELECT|WITH)\b|\bRETURNING\b/i.test(sql) ? { success: true, results: s.all(...a) } : (s.run(...a), { success: true, results: [] }); }
  });
  return {
    prepare: sql => stmt(sql),
    async batch(list) { sqlite.exec("BEGIN"); try { const out = list.map(s => s._exec()); sqlite.exec("COMMIT"); return out; } catch (e) { sqlite.exec("ROLLBACK"); throw e; } },
    async exec(sql) { sqlite.exec(sql); return { count: 1 }; }
  };
}

export async function startLocalWorker({ appOrigin, file = ":memory:", port = 0 } = {}) {
  const sqlite = new DatabaseSync(file);
  for (const f of readdirSync(join(root, "worker/migrations")).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(join(root, "worker/migrations", f), "utf8"));
  const emails = [], outside = [];
  // Outside services: only Resend's email API is answered (and kept); everything else is refused.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    if (/^http:\/\/127\.0\.0\.1:/.test(url)) return realFetch(input, init);
    if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body || (input.text ? await input.text() : "{}"))); return new Response(JSON.stringify({ id: "local-" + emails.length }), { status: 200 }); }
    outside.push(url);
    return new Response(JSON.stringify({ error: "outside_service_not_available_in_local_test" }), { status: 503, headers: { "content-type": "application/json" } });
  };
  const worker = (await import("../worker/worker.js")).default;
  const env = {
    RELAY_DB: d1(sqlite), AUTH_SECRET: "local-e2e-auth-secret-" + "0123456789abcdef", RESEND_API_KEY: "local-not-a-key",
    RELAY_APP_URL: appOrigin + "/index.html", RELAY_ALLOWED_ORIGINS: appOrigin, RELAY_ADMIN_EMAILS: "team.admin@example.com",
    SECOND_STEP_REQUIRED: "on", LEGACY_TEST_ROUTES: "off", SHOPIFY_SHOP_DOMAIN: "made-up-local.myshopify.com"
  };
  const pending = new Set();
  const ctx = () => ({ waitUntil(p) { const q = Promise.resolve(p).catch(() => {}).finally(() => pending.delete(q)); pending.add(q); }, passThroughOnException() {} });
  const requests = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", "203.0.113.7");
      const url = "https://relay-local.test" + req.url;
      requests.push({ method: req.method, path: req.url.split("?")[0], at: Date.now() });
      const r = await worker.fetch(new Request(url, { method: req.method, headers, body: chunks.length && !["GET", "HEAD"].includes(req.method) ? Buffer.concat(chunks) : undefined }), env, ctx());
      const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
      res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify({ error: "local_worker_crashed", detail: String(e && e.stack || e) })); }
  });
  await new Promise(r => server.listen(port, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  return { origin, sqlite, env, emails, outside, requests, settled: () => Promise.all([...pending]),
    async close() { await Promise.all([...pending]); await new Promise(r => server.close(r)); globalThis.fetch = realFetch; sqlite.close(); } };
}

// Run on its own: `node scripts/local-worker.mjs` serves Relay's server on http://127.0.0.1:8787 with an empty database.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const w = await startLocalWorker({ appOrigin: process.env.RELAY_APP_ORIGIN || "http://127.0.0.1:8080", port: Number(process.env.PORT || 8787) });
  console.log("Relay's server (local, made-up data only) on " + w.origin);
}
