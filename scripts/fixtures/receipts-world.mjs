// A worker env on real SQLite (in memory) with one signed-in made-up shopper holding a made-up dataset
// (receipts-dataset.mjs), for scripts/test-receipts-list-speed.mjs. Pass `worker` to load the worker from another folder
// (an earlier version of it, to compare the list it builds).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { makeShopper } from "./receipts-dataset.mjs";

export async function world(n, { worker = new URL("../../worker/", import.meta.url).href, seed = 7, now = Date.UTC(2026, 10, 18, 9) } = {}) {
  const { handleAuthRoute } = await import(worker + "auth.js");
  const sqlite = new DatabaseSync(":memory:");
  const mig = new URL("migrations/", worker);
  for (const f of readdirSync(mig).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(f, mig), "utf8"));
  let queries = 0;
  function stmt(sql, args = []) {
    return {
      bind: (...a) => stmt(sql, a),
      async run() { queries++; sqlite.prepare(sql).run(...args); return { meta: { changes: 1 } }; },
      async first() { queries++; return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { queries++; return { results: sqlite.prepare(sql).all(...args) }; },
      _exec() { sqlite.prepare(sql).run(...args); }
    };
  }
  const db = { prepare: sql => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { list.forEach(s => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return list.map(() => ({ meta: { changes: 1 } })); } };
  const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "boss@example.com" };
  let emails = [];
  const later = [];
  const fetchImpl = async (url, init = {}) => {
    if (String(url).startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
    return new Response("{}", { status: 404 });
  };
  const w = { sqlite, env, now };
  w.call = (path, { method = "GET", body, token = w.token, ip = "1.1.1.1", headers = {} } = {}) =>
    handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...headers, ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: w.now, fetchImpl, later: (p) => later.push(p) });
  w.settle = async () => { while (later.length) await later.shift(); };
  w.queries = () => queries;
  async function signIn(email, ip) {
    emails = [];
    await w.call("/relay/auth/request", { method: "POST", body: { email }, ip, token: null });
    const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
    return (await (await w.call("/relay/auth/verify", { method: "POST", body: { token: link }, token: null })).json()).sessionToken;
  }
  w.token = await signIn("boss@example.com", "5.5.5.5");
  w.id = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("boss@example.com").id;
  // Makes the receipt tables (and the shopper's consent, so their own receipts routes answer).
  await w.call("/relay/my/receipts");
  try { sqlite.prepare("INSERT INTO gmail_consents (shopper_id, version, agreed_at) VALUES (?,?,?)").run(w.id, "test", now); } catch { /* table differs */ }
  const data = makeShopper(w.id, n, { seed });
  w.data = data;
  const ins = (table, rows) => {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const s = sqlite.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
    sqlite.exec("BEGIN"); for (const r of rows) s.run(...cols.map((c) => r[c] ?? null)); sqlite.exec("COMMIT");
  };
  // The tables the list reads that may not exist yet are made by the routes that write them; make sure they exist.
  const ensure = async (path) => { try { await w.call(path); } catch { /* fine */ } };
  await ensure("/relay/my/receipts/00000000-0000-4000-8000-000000000000/join");
  ins("captured_receipts", data.rows);
  for (const [t, rows] of [["receipt_joins", data.joins], ["receipt_fixes", data.fixes], ["receipt_gifts", data.gifts], ["receipt_item_marks", data.marks], ["return_reminders", data.reminders], ["receipt_learning", data.learning]]) {
    try { ins(t, rows); } catch (e) { w.missing = (w.missing || []).concat(t + ": " + e.message); }
  }
  return w;
}
