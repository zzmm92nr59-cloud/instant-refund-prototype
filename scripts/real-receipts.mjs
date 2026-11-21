// Real answers for the browser tests (round 7, 19 Nov 2026): emails go through Relay's own scan route (POST
// /relay/my/gmail/scan: worker/gmail.js scan + classify, the real reader and totals check) from a stand-in Gmail into a real
// SQLite database, and what the app would be sent is then read back the way the app asks for it (GET /relay/my/receipts,
// /relay/my/receipts?all=1, /relay/my/wrapped). The pasted-receipt route can be called on the same shopper.
// Everything is made up and stays on this machine: Gmail and Resend are stand-ins, and no AI is set up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, sealToken } from "../worker/gmail.js";

const DAY = 864e5;
export function realInbox({ now = Date.UTC(2026, 10, 19, 12) } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  for (const f of readdirSync("worker/migrations").filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); }
  });
  const db = { prepare: (sql) => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { for (const s of list) s._exec(); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
  const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test" };
  const box = new Map(); let sent = [];
  const ymdOf = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "/");
  const fetchImpl = async (url, init = {}) => {
    url = String(url);
    if (url.startsWith("https://api.resend.com/emails")) { sent.push(JSON.parse(init.body)); return new Response("{}"); }
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "acc-rt1" });
    if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
      const q = decodeURIComponent(url), win = /after:(\d{4}\/\d{2}\/\d{2}) before:(\d{4}\/\d{2}\/\d{2})/.exec(q);
      if (!win) return Response.json({ messages: [] });
      return Response.json({ messages: [...box.entries()].filter(([, e]) => ymdOf(e.at) >= win[1] && ymdOf(e.at) < win[2]).map(([id]) => ({ id })) });
    }
    const one = /messages\/([A-Za-z0-9]+)\?format=raw$/.exec(url);
    if (one) { const e = box.get(one[1]); return e ? Response.json({ raw: Buffer.from(e.raw).toString("base64url") }) : new Response("{}", { status: 404 }); }
    return new Response("{}", { status: 404 });
  };
  let token = null, k = 0;
  const call = async (path, { method = "GET", body } = {}) => {
    const r = await handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now, fetchImpl, busyWaitMs: 0 });
    return { status: r.status, body: await r.json() };
  };
  return {
    now,
    async start(email = "sam.taylor@example.co.uk") {
      sent = [];
      await call("/relay/auth/request", { method: "POST", body: { email } });
      const link = /#signin=([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1];
      token = (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).body.sessionToken;
      const id = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id;
      await call("/relay/my/consent", { method: "POST", body: { version: CONSENT_VERSION } });
      const s = await sealToken(env, "rt1");
      sqlite.prepare("INSERT INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at, provider) VALUES (?,?,?,?,?,?)").run(id, email, s.iv, s.data, now, null);
      return this;
    },
    // One email arriving, as its raw text; at: when it arrived (ms), or its own Date header.
    deliver(raw, at) { const d = at || Date.parse((/^Date: (.*)$/m.exec(raw) || [])[1]) || now - DAY; box.set("rr" + (++k) + "abcdef", { raw, at: d }); },
    async scan() { for (let i = 0; i < 60; i++) { const r = await call("/relay/my/gmail/scan", { method: "POST", body: { full: true } }); if (r.status !== 200) throw new Error("scan " + JSON.stringify(r.body)); if (!r.body.more) return r.body; } throw new Error("scan never finished"); },
    receipts: async (all = true) => (await call("/relay/my/receipts" + (all ? "?all=1" : ""))).body,
    wrapped: async (year = 2026) => (await call("/relay/my/wrapped?year=" + year)).body,
    // What Relay kept for one receipt (its details), as stored.
    details: (id) => { const r = sqlite.prepare("SELECT details FROM captured_receipts WHERE id = ?").get(id); return r ? JSON.parse(r.details) : null; },
    paste: async (email) => call("/relay/my/receipts/add-pasted", { method: "POST", body: { email } }),
    // Every email Relay kept, with what it made of it (round 20).
    stored: () => sqlite.prepare("SELECT id, status, details FROM captured_receipts").all().map((r) => ({ id: r.id, status: r.status, details: JSON.parse(r.details) })),
    call,
  };
}
