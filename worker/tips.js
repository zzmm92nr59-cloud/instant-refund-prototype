// The first-run tips (one for each tab: Home, Ask, Browse, Receipts): which ones this shopper has already seen, kept with
// the account so a tip isn't shown again on their other phones or after an update. Only the shopper reads or changes it.
import { ensureOnce } from "./once.js";

export const TIP_IDS = ["home", "ask", "browse", "receipts"];

export function ensureTipsTable(db) {
  return ensureOnce(db, "tips", () => db.prepare(
    `CREATE TABLE IF NOT EXISTS shopper_tips (
       shopper_id TEXT PRIMARY KEY, seen TEXT NOT NULL, updated_at INTEGER NOT NULL)`).run());
}
// Deleting the account deletes them with it.
export function tipsDeleteStatements(db, shopperId) {
  return [db.prepare("DELETE FROM shopper_tips WHERE shopper_id = ?").bind(shopperId)];
}

export async function readTips(env, shopperId) {
  try {
    const row = await env.RELAY_DB.prepare("SELECT seen, updated_at FROM shopper_tips WHERE shopper_id = ?").bind(shopperId).first();
    let list = [];
    try { list = JSON.parse((row && row.seen) || "[]"); } catch { list = []; }
    return { seen: (Array.isArray(list) ? list : []).filter((x) => TIP_IDS.includes(x)), updatedAt: (row && row.updated_at) || null };
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return { seen: [], updatedAt: null };
    throw e;
  }
}

// A list the app sent: ids from the list only, none twice. null when it can't be used.
export function cleanTips(raw) {
  if (!Array.isArray(raw) || raw.length > TIP_IDS.length) return null;
  const out = [];
  for (const x of raw) {
    if (typeof x !== "string" || !TIP_IDS.includes(x)) return null;
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

// GET /relay/my/tips: { seen: [ids], updatedAt }.
// PUT /relay/my/tips { seen: [ids] }: replaces them (an empty list is "show the tips again").
export async function handleTipsRoute(request, env, url, cors, shopper, o) {
  if (url.pathname !== "/relay/my/tips") return null;
  await ensureTipsTable(env.RELAY_DB);
  if (request.method === "GET") return json(await readTips(env, shopper.id), 200, cors);
  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405, cors);
  let body;
  try { body = JSON.parse(await request.text()); } catch { body = null; }
  const list = body && typeof body === "object" ? cleanTips(body.seen) : null;
  if (!list) return json({ error: "bad_tips" }, 400, cors);
  const now = (o && o.now) || Date.now();
  if (!list.length) await env.RELAY_DB.prepare("DELETE FROM shopper_tips WHERE shopper_id = ?").bind(shopper.id).run();
  else await env.RELAY_DB.prepare(
    `INSERT INTO shopper_tips (shopper_id, seen, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(shopper_id) DO UPDATE SET seen = excluded.seen, updated_at = excluded.updated_at`).bind(shopper.id, JSON.stringify(list), now).run();
  return json({ seen: list, updatedAt: list.length ? now : null }, 200, cors);
}
