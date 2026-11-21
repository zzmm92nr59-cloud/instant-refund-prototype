// The AI second reader at work (ai-reader.js has its rules). Every hour, a few receipts the rules weren't sure about, from
// shoppers who switched on AI help, are read by Claude; and the switch itself: GET/POST /relay/my/ai-reading.
import { AI_SYSTEM, AI_READ_VERSION, cleanAiReading, compareReadings, aiAvailable } from "./ai-reader.js";
import { ensureGmailTables, hiddenCopyOf } from "./gmail.js";
import { DEFAULT_MODEL, claudeFetch, isCapped, noThinking, overLimit, mostItCouldCost } from "./ai-spend.js";

export const AI_PER_RUN = 20;
export const AI_PER_SHOPPER_DAY = 40;
export const AI_ALL_DAY = 1500;
const DAY = 864e5;
const MAX_TEXT = 12000;
export const aiModel = (env) => env.AI_READER_MODEL || DEFAULT_MODEL;
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
const iso = (t) => (t ? new Date(Number(t)).toISOString() : null);

const MAX_OUT = 1200;
// Asks Claude to read one email, whose personal details are already hidden. Returns { reading }, or { error } (and stop:
// true when there's no point asking about more emails this run: the AI is busy, unreachable or refusing the key, or
// Relay's monthly AI limit is reached; capped: "shopper_day" when only this shopper's daily limit is).
export async function askClaude(env, copy, latestDay, fetchImpl, o = {}) {
  const content = "Subject: " + (copy.subject || "") + "\nFrom: " + (copy.from || "") + (copy.date ? "\nDate: " + copy.date : "") + "\n\n" + String(copy.text || "").slice(0, MAX_TEXT);
  let r;
  try {
    r = await claudeFetch(env, "reader", fetchImpl, { method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: aiModel(env), max_tokens: MAX_OUT, ...noThinking(env), system: AI_SYSTEM, messages: [{ role: "user", content }] }) }, o);
  } catch { return { error: "ai_unreachable", stop: true }; }
  if (isCapped(r)) return r.capped === "shopper_day" ? { error: "ai_limit", capped: "shopper_day" } : { error: "ai_limit", stop: true };
  if (r.status === 429 || r.status >= 500) return { error: "ai_busy", stop: true };
  if (!r.ok) return { error: "ai_refused", stop: true };
  const body = await r.json().catch(() => null);
  const out = body && Array.isArray(body.content) ? body.content.filter((c) => c && c.type === "text").map((c) => c.text).join("") : "";
  const reading = cleanAiReading(out, latestDay);
  return reading ? { reading } : { error: "unreadable" };
}

// Which email a receipt was read from: a reading is reused for as long as the receipt is the same email.
export const emailKeyOf = (d) => (d && d.gmailId ? "g:" + d.gmailId : d && d.outlookId ? "o:" + d.outlookId : null);
async function save(env, row, d, reading, failed, now) {
  // An email the AI thinks isn't a purchase is only counted as that: none of its parts are compared.
  const p = reading && reading.isPurchase ? compareReadings(d, reading) : {};
  await env.RELAY_DB.prepare(`INSERT OR REPLACE INTO receipt_ai_reads (shopper_id, receipt_id, fields, failed, not_purchase, shop, total, date, number, items, reader, model, created_at, ai_version, email_key)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(row.shopper, row.id, reading ? JSON.stringify({ ...reading, v: AI_READ_VERSION }) : null, failed,
    reading && !reading.isPurchase ? 1 : 0, p.shop || 0, p.total || 0, p.date || 0, p.number || 0, p.items || 0, Number(d.parserVersion) || 0, aiModel(env), now,
    AI_READ_VERSION, emailKeyOf(d)).run();
}
// Two columns added after the table was first made (round 24): the AI reader version and the email a reading is of.
const addedColumns = new WeakSet();
export async function ensureAiReadColumns(db) {
  if (addedColumns.has(db)) return;
  for (const sql of ["ALTER TABLE receipt_ai_reads ADD COLUMN ai_version INTEGER", "ALTER TABLE receipt_ai_reads ADD COLUMN email_key TEXT"]) {
    try { await db.prepare(sql).run(); } catch { /* already there */ }
  }
  addedColumns.add(db);
}
// When Relay's own reader reads emails again (each reader version reads every email again), the AI's reading of an email
// is kept and only compared again with the new rules' reading: the email isn't sent to Anthropic again. Up to
// RECOMPARE_PER_RUN a run.
const RECOMPARE_PER_RUN = 200;
async function recompare(env, now) {
  const db = env.RELAY_DB;
  const rows = (await db.prepare(`SELECT x.shopper_id AS shopper, x.receipt_id AS id, x.fields AS fields, r.details AS details FROM receipt_ai_reads x
      JOIN captured_receipts r ON r.id = x.receipt_id AND r.shopper_id = x.shopper_id
      WHERE x.fields IS NOT NULL AND COALESCE(x.reader, 0) <> COALESCE(json_extract(r.details, '$.parserVersion'), 0) LIMIT ?`).bind(RECOMPARE_PER_RUN).all()).results || [];
  const st = [];
  for (const row of rows) {
    let d, f; try { d = JSON.parse(row.details); f = JSON.parse(row.fields); } catch { continue; }
    const p = f && f.isPurchase ? compareReadings(d, f) : {};
    st.push(db.prepare("UPDATE receipt_ai_reads SET shop = ?, total = ?, date = ?, number = ?, items = ?, reader = ? WHERE shopper_id = ? AND receipt_id = ?")
      .bind(p.shop || 0, p.total || 0, p.date || 0, p.number || 0, p.items || 0, Number(d.parserVersion) || 0, row.shopper, row.id));
  }
  if (st.length) await db.batch(st);
  return st.length;
}

// Every hour (worker.js): up to AI_PER_RUN receipts, newest first, that the rules weren't sure about (read with less than
// high confidence, no total, no items, items that don't add up, a name that doesn't look like a thing bought, or no shop
// name), from shoppers with AI help on, not fixed by the shopper, and not yet read by the AI: an email already read at
// this AI_READ_VERSION is never sent again, whatever Relay's own reader version. At most AI_PER_SHOPPER_DAY a shopper and
// AI_ALL_DAY in all, in any 24 hours, and within the spending limits (ai-spend.js).
export async function runAiReads(env, now = Date.now(), fetchImpl = fetch) {
  if (!env.RELAY_DB || !aiAvailable(env)) return { read: 0, why: "off" };
  const db = env.RELAY_DB, since = now - DAY;
  await ensureGmailTables(db);
  await ensureAiReadColumns(db);
  await recompare(env, now).catch((e) => console.error("AI recompare failed", String(e && e.message || e).slice(0, 120)));
  // The monthly limit reached: nothing is fetched from anyone's inbox for the AI, and nothing is sent.
  const oneCall = mostItCouldCost(env, { model: aiModel(env), max_tokens: MAX_OUT, system: AI_SYSTEM, messages: [{ role: "user", content: "x".repeat(MAX_TEXT + 400) }] });
  if (await overLimit(env, { feature: "reader", reserve: oneCall, now })) return { read: 0, why: "spending_limit" };
  const all = await db.prepare("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE created_at > ?").bind(since).first();
  let room = Math.min(AI_PER_RUN, AI_ALL_DAY - Number((all && all.n) || 0));
  if (room <= 0) return { read: 0, why: "limit" };
  const rows = (await db.prepare(`SELECT r.id AS id, r.shopper_id AS shopper, r.details AS details, s.email AS email FROM captured_receipts r
      JOIN ai_reading a ON a.shopper_id = r.shopper_id JOIN shoppers s ON s.id = r.shopper_id
      WHERE r.status NOT IN ('dismissed','not_receipt') AND COALESCE(json_extract(r.details, '$.kind'), 'receipt') = 'receipt'
        AND (json_extract(r.details, '$.gmailId') IS NOT NULL OR json_extract(r.details, '$.outlookId') IS NOT NULL)
        AND (COALESCE(json_extract(r.details, '$.confidence'), 'low') <> 'high' OR json_extract(r.details, '$.totalPence') IS NULL
          OR COALESCE(json_array_length(json_extract(r.details, '$.items')), 0) = 0
          OR json_extract(r.details, '$.itemsCheck.complete') = 0 OR json_extract(r.details, '$.itemsCheck.namesOk') = 0
          OR json_extract(r.details, '$.itemsCheck.namesDoubtful') = 1 OR COALESCE(TRIM(json_extract(r.details, '$.retailer.name')), '') = '')
        AND NOT EXISTS (SELECT 1 FROM receipt_ai_reads x WHERE x.shopper_id = r.shopper_id AND x.receipt_id = r.id
          AND COALESCE(x.ai_version, 1) = ? AND (x.email_key IS NULL
            OR x.email_key = COALESCE('g:' || json_extract(r.details, '$.gmailId'), 'o:' || json_extract(r.details, '$.outlookId'))))
        AND NOT EXISTS (SELECT 1 FROM receipt_fixes f WHERE f.shopper_id = r.shopper_id AND f.receipt_id = r.id)
      ORDER BY r.created_at DESC LIMIT ?`).bind(AI_READ_VERSION, room * 3).all()).results || [];
  // An email can carry tomorrow's date by the UK clock, so tomorrow is the latest date accepted.
  const latestDay = new Date(now + DAY).toISOString().slice(0, 10);
  const perShopper = new Map(), overToday = new Set();
  const usedBy = async (who) => {
    if (!perShopper.has(who)) perShopper.set(who, Number(((await db.prepare("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE shopper_id = ? AND created_at > ?").bind(who, since).first()) || {}).n || 0));
    return perShopper.get(who);
  };
  let read = 0, failed = 0, stopped = null;
  for (const row of rows) {
    if (room <= 0 || stopped) break;
    if (overToday.has(row.shopper) || (await usedBy(row.shopper)) >= AI_PER_SHOPPER_DAY) continue;
    // This shopper's daily spending limit: their inbox isn't asked for the email either.
    if (await overLimit(env, { feature: "reader", shopperId: row.shopper, reserve: oneCall, now })) { overToday.add(row.shopper); continue; }
    let d; try { d = JSON.parse(row.details); } catch { continue; }
    const got = await hiddenCopyOf(env, { id: row.shopper, email: row.email }, d, fetchImpl);
    if (!got.copy) {
      // An email that's gone is remembered, so it isn't asked for again; anything else is tried another time.
      if (got.error === "email_not_found") await save(env, row, d, null, "email_not_found", now);
      continue;
    }
    const ans = await askClaude(env, got.copy, latestDay, fetchImpl, { shopperId: row.shopper, now });
    if (ans.stop) { stopped = ans.error; break; }
    if (ans.capped) { overToday.add(row.shopper); continue; }
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
