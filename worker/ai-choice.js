// Whether each member has Relay's AI on: on for everyone unless they switched it off (Connor, 24 Nov 2026: "AI should be
// automatically switched on for everyone"). Both switches stay, in Profile, AI help:
//  * "receipts": AI help with receipts (ai-runner.js reads the emails Relay's own reader isn't sure about) and the AI-written
//    description of a listing (resale.js).
//  * "picks": AI for picks (item-kinds.js): what each thing bought is, for Browse's picks and Wrapped.
//
// Rules (do not weaken):
//  * No choice recorded means on. A member's own choice is kept here, one row a feature (is_on 0 or 1, and when), so an
//    off is always respected: nothing of theirs goes to the AI for that feature until they switch it on again.
//  * Before this, AI was off unless switched on, and switching off deleted the "on" row (ai_reading, picks_ai), so "turned it
//    off" and "never turned it on" can't be told apart from what was kept. Everyone without a choice here is on; offs are
//    recorded from now on.
//  * Turning a feature off still deletes what the AI produced for it (the routes do that). The choice itself is a
//    preference: it stays when an inbox is disconnected or permission withdrawn (so connecting again doesn't switch AI back
//    on behind someone's back), and goes only with the account.
//  * Everything stays inside Relay's AI spending limits (ai-spend.js) and each feature's own daily limits: on for everyone
//    changes who may be read, never how much.
//  * The one-time notice ("AI help is now on", on Home): shown once per account, kept here (ai_notice_seen), never to a
//    member who has made a choice of their own, nor while Relay's AI is off for everyone.
import { ensureOnce } from "./once.js";
import { aiAvailable } from "./ai-reader.js";

export const AI_FEATURES = ["receipts", "picks"];
export const AI_CHOICES_SQL = `CREATE TABLE IF NOT EXISTS ai_choices (shopper_id TEXT NOT NULL, feature TEXT NOT NULL, is_on INTEGER NOT NULL,
  chosen_at INTEGER NOT NULL, PRIMARY KEY (shopper_id, feature))`;
export const AI_NOTICE_SQL = `CREATE TABLE IF NOT EXISTS ai_notice_seen (shopper_id TEXT PRIMARY KEY, seen_at INTEGER NOT NULL)`;

export function ensureAiChoiceTables(db) {
  return ensureOnce(db, "ai-choices", () => db.batch([db.prepare(AI_CHOICES_SQL), db.prepare(AI_NOTICE_SQL)]));
}
// With the account (auth.js deleteShopper), and only then.
export function aiChoiceDeleteStatements(db, shopperId) {
  return [db.prepare("DELETE FROM ai_choices WHERE shopper_id = ?").bind(shopperId), db.prepare("DELETE FROM ai_notice_seen WHERE shopper_id = ?").bind(shopperId)];
}
// SQL for "this shopper hasn't switched <feature> off", for a query whose shopper id column is `col`.
export const notOffSql = (col, feature) =>
  `NOT EXISTS (SELECT 1 FROM ai_choices c WHERE c.shopper_id = ${col} AND c.feature = '${AI_FEATURES.includes(feature) ? feature : "receipts"}' AND c.is_on = 0)`;

// The member's own choice for a feature: { on: true | false, at } when they made one, null when they haven't (so it's on).
export async function aiChoiceOf(db, shopperId, feature) {
  await ensureAiChoiceTables(db);
  const row = await db.prepare("SELECT is_on, chosen_at FROM ai_choices WHERE shopper_id = ? AND feature = ?").bind(shopperId, feature).first();
  return row ? { on: row.is_on === 1, at: row.chosen_at } : null;
}
// Whether the AI may be used for this member and feature now: Relay's AI is on, and they haven't switched it off.
export async function aiOnFor(env, shopperId, feature) {
  if (!aiAvailable(env)) return false;
  const c = await aiChoiceOf(env.RELAY_DB, shopperId, feature);
  return !c || c.on;
}
export function aiChoiceStatement(db, shopperId, feature, on, now) {
  return db.prepare(`INSERT INTO ai_choices (shopper_id, feature, is_on, chosen_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (shopper_id, feature) DO UPDATE SET is_on = excluded.is_on, chosen_at = excluded.chosen_at`).bind(shopperId, feature, on ? 1 : 0, now);
}
// For Download my data: each feature's choice, in plain words.
export async function aiChoicesForExport(db, shopperId) {
  await ensureAiChoiceTables(db);
  const rows = (await db.prepare("SELECT feature, is_on, chosen_at FROM ai_choices WHERE shopper_id = ?").bind(shopperId).all()).results || [];
  const out = {};
  for (const f of AI_FEATURES) {
    const r = rows.find((x) => x.feature === f);
    out[f] = r ? { choice: r.is_on === 1 ? "switched on" : "switched off", at: new Date(Number(r.chosen_at)).toISOString() } : { choice: "none (on, as for everyone)", at: null };
  }
  const seen = await db.prepare("SELECT seen_at FROM ai_notice_seen WHERE shopper_id = ?").bind(shopperId).first();
  out.noticeSeenAt = seen ? new Date(Number(seen.seen_at)).toISOString() : null;
  return out;
}

// Whether Home should show the one-time notice now (with GET /relay/my/profile).
export async function aiNoticeDue(env, shopperId) {
  try {
    if (!env || !env.RELAY_DB || !aiAvailable(env)) return false;
    const db = env.RELAY_DB;
    await ensureAiChoiceTables(db);
    const seen = await db.prepare("SELECT 1 AS x FROM ai_notice_seen WHERE shopper_id = ?").bind(shopperId).first();
    if (seen) return false;
    const chose = await db.prepare("SELECT 1 AS x FROM ai_choices WHERE shopper_id = ? LIMIT 1").bind(shopperId).first();
    return !chose;
  } catch { return false; }
}

const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
// POST /relay/my/ai-notice (no body): the member has seen the notice; it isn't shown to this account again.
export async function handleAiNoticeRoute(path, method, env, cors, shopper, o) {
  if (path !== "/relay/my/ai-notice") return null;
  if (method !== "POST") return json({ error: "not_found" }, 404, cors);
  await ensureAiChoiceTables(env.RELAY_DB);
  await env.RELAY_DB.prepare("INSERT OR IGNORE INTO ai_notice_seen (shopper_id, seen_at) VALUES (?, ?)").bind(shopper.id, (o && o.now) || Date.now()).run();
  return json({ ok: true }, 200, cors);
}
