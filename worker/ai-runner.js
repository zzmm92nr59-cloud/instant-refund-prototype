// The AI second reader at work (ai-reader.js has its rules). Every hour, a few receipts the rules weren't sure about, from
// shoppers who switched on AI help, are read by Claude; and the switch itself: GET/POST /relay/my/ai-reading.
import { AI_SYSTEM, AI_READ_VERSION, cleanAiReading, compareReadings, aiAvailable } from "./ai-reader.js";
import { ensureGmailTables, hiddenCopyOf } from "./gmail.js";

export const AI_PER_RUN = 20;
export const AI_PER_SHOPPER_DAY = 40;
export const AI_ALL_DAY = 1500;
const DAY = 864e5;
const MAX_TEXT = 12000;
export const aiModel = (env) => env.AI_READER_MODEL || "claude-haiku-5-5";
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
const iso = (t) => (t ? new Date(Number(t)).toISOString() : null);

// Asks Claude to read one email, whose personal details are already hidden. Returns { reading }, or { error } (and stop:
// true when there's no point asking about more emails this run: the AI is busy, unreachable or refusing the key).
export async function askClaude(env, copy, latestDay, fetchImpl) {
  const content = "Subject: " + (copy.subject || "") + "\nFrom: " + (copy.from || "") + (copy.date ? "\nDate: " + copy.date : "") + "\n\n" + String(copy.text || "").slice(0, MAX_TEXT);
  let r;
  try {
    r = await fetchImpl("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: aiModel(env), max_tokens: 1200, system: AI_SYSTEM, messages: [{ role: "user", content }] }) });
  } catch { return { error: "ai_unreachable", stop: true }; }
  if (r.status === 429 || r.status >= 500) return { error: "ai_busy", stop: true };
  if (!r.ok) return { error: "ai_refused", stop: true };
  const body = await r.json().catch(() => null);
  const out = body && Array.isArray(body.content) ? body.content.filter((c) => c && c.type === "text").map((c) => c.text).join("") : "";
  const reading = cleanAiReading(out, latestDay);
  return reading ? { reading } : { error: "unreadable" };
}

async function save(env, row, d, reading, failed, now) {
  // An email the AI thinks isn't a purchase is only counted as that: none of its parts are compared.
  const p = reading && reading.isPurchase ? compareReadings(d, reading) : {};
  await env.RELAY_DB.prepare(`INSERT OR REPLACE INTO receipt_ai_reads (shopper_id, receipt_id, fields, failed, not_purchase, shop, total, date, number, items, reader, model, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(row.shopper, row.id, reading ? JSON.stringify({ ...reading, v: AI_READ_VERSION }) : null, failed,
    reading && !reading.isPurchase ? 1 : 0, p.shop || 0, p.total || 0, p.date || 0, p.number || 0, p.items || 0, Number(d.parserVersion) || 0, aiModel(env), now).run();
}

// Every hour (worker.js): up to AI_PER_RUN receipts, newest first, that the rules read with less than high confidence or
// without a total or items, from shoppers with AI help on, not yet read by the AI and not fixed by the shopper. At most
// AI_PER_SHOPPER_DAY a shopper and AI_ALL_DAY in all, in any 24 hours.
export async function runAiReads(env, now = Date.now(), fetchImpl = fetch) {
  if (!env.RELAY_DB || !aiAvailable(env)) return { read: 0, why: "off" };
  const db = env.RELAY_DB, since = now - DAY;
  await ensureGmailTables(db);
  const all = await db.prepare("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE created_at > ?").bind(since).first();
  let room = Math.min(AI_PER_RUN, AI_ALL_DAY - Number((all && all.n) || 0));
  if (room <= 0) return { read: 0, why: "limit" };
  const rows = (await db.prepare(`SELECT r.id AS id, r.shopper_id AS shopper, r.details AS details, s.email AS email FROM captured_receipts r
      JOIN ai_reading a ON a.shopper_id = r.shopper_id JOIN shoppers s ON s.id = r.shopper_id
      WHERE r.status NOT IN ('dismissed','not_receipt') AND COALESCE(json_extract(r.details, '$.kind'), 'receipt') = 'receipt'
        AND (json_extract(r.details, '$.gmailId') IS NOT NULL OR json_extract(r.details, '$.outlookId') IS NOT NULL)
        AND (COALESCE(json_extract(r.details, '$.confidence'), 'low') <> 'high' OR json_extract(r.details, '$.totalPence') IS NULL
          OR COALESCE(json_array_length(json_extract(r.details, '$.items')), 0) = 0)
        AND NOT EXISTS (SELECT 1 FROM receipt_ai_reads x WHERE x.shopper_id = r.shopper_id AND x.receipt_id = r.id)
        AND NOT EXISTS (SELECT 1 FROM receipt_fixes f WHERE f.shopper_id = r.shopper_id AND f.receipt_id = r.id)
      ORDER BY r.created_at DESC LIMIT ?`).bind(room * 3).all()).results || [];
  // An email can carry tomorrow's date by the UK clock, so tomorrow is the latest date accepted.
  const latestDay = new Date(now + DAY).toISOString().slice(0, 10);
  const perShopper = new Map();
  const usedBy = async (who) => {
    if (!perShopper.has(who)) perShopper.set(who, Number(((await db.prepare("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE shopper_id = ? AND created_at > ?").bind(who, since).first()) || {}).n || 0));
    return perShopper.get(who);
  };
  let read = 0, failed = 0, stopped = null;
  for (const row of rows) {
    if (room <= 0 || stopped) break;
    if ((await usedBy(row.shopper)) >= AI_PER_SHOPPER_DAY) continue;
    let d; try { d = JSON.parse(row.details); } catch { continue; }
    const got = await hiddenCopyOf(env, { id: row.shopper, email: row.email }, d, fetchImpl);
    if (!got.copy) {
      // An email that's gone is remembered, so it isn't asked for again; anything else is tried another time.
      if (got.error === "email_not_found") await save(env, row, d, null, "email_not_found", now);
      continue;
    }
    const ans = await askClaude(env, got.copy, latestDay, fetchImpl);
    if (ans.stop) { stopped = ans.error; break; }
    room--; perShopper.set(row.shopper, perShopper.get(row.shopper) + 1);
    if (ans.reading) { read++; await save(env, row, d, ans.reading, null, now); }
    else { failed++; await save(env, row, d, null, ans.error, now); }
  }
  return { read, failed, ...(stopped ? { stopped } : {}) };
}

// GET /relay/my/ai-reading: whether AI help can be switched on, and whether it is. POST { on }: switches it; off deletes what
// the AI read. Returns null for any other path.
export async function handleAiReadingRoute(path, method, request, env, cors, shopper, o) {
  if (path !== "/relay/my/ai-reading") return null;
  const db = env.RELAY_DB, now = (o && o.now) || Date.now();
  await ensureGmailTables(db);
  const state = async () => {
    const row = await db.prepare("SELECT on_since FROM ai_reading WHERE shopper_id = ?").bind(shopper.id).first();
    return { available: aiAvailable(env), on: Boolean(row) && aiAvailable(env), since: row ? iso(row.on_since) : null };
  };
  if (method === "GET") return json(await state(), 200, cors);
  if (method !== "POST") return json({ error: "not_found" }, 404, cors);
  const b = await request.json().catch(() => null);
  if (!b || typeof b.on !== "boolean") return json({ error: "invalid_request" }, 400, cors);
  if (b.on) {
    if (!aiAvailable(env)) return json({ error: "ai_off" }, 503, cors);
    await db.prepare("INSERT OR IGNORE INTO ai_reading (shopper_id, on_since) VALUES (?, ?)").bind(shopper.id, now).run();
  } else {
    await db.batch([db.prepare("DELETE FROM ai_reading WHERE shopper_id = ?").bind(shopper.id),
      db.prepare("DELETE FROM receipt_ai_reads WHERE shopper_id = ?").bind(shopper.id)]);
  }
  return json(await state(), 200, cors);
}
