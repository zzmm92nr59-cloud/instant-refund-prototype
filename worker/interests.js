// What the shopper says they shop for, chosen from a fixed list. It helps Browse put shops they'll like first for a new
// shopper with few or no receipts; once there are receipts, what they bought stays the stronger signal (the app decides).
// Kept with the account, so it survives updates and follows the shopper to other devices. Only the shopper sees it.
import { ensureOnce } from "./once.js";
import { knownShop, categorise } from "./receipt-category.js";

import { INTERESTS, INTEREST_IDS, MAX_INTERESTS } from "./interest-list.js";
export { INTERESTS, INTEREST_IDS, MAX_INTERESTS };

export function ensureInterestsTable(db) {
  return ensureOnce(db, "interests", () => db.prepare(
    `CREATE TABLE IF NOT EXISTS shopper_interests (
       shopper_id TEXT PRIMARY KEY, interests TEXT NOT NULL, updated_at INTEGER NOT NULL)`).run());
}
// Deleting the account deletes them with it.
export function interestsDeleteStatements(db, shopperId) {
  return [db.prepare("DELETE FROM shopper_interests WHERE shopper_id = ?").bind(shopperId)];
}

export async function readInterests(env, shopperId) {
  try {
    const row = await env.RELAY_DB.prepare("SELECT interests, updated_at FROM shopper_interests WHERE shopper_id = ?").bind(shopperId).first();
    let list = [];
    try { list = JSON.parse(row && row.interests || "[]"); } catch { list = []; }
    return { interests: (Array.isArray(list) ? list : []).filter((x) => INTEREST_IDS.includes(x)), updatedAt: row && row.updated_at || null };
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return { interests: [], updatedAt: null };
    throw e;
  }
}

// A list the shopper sent: every id from the list, none twice, at most twelve. null when it can't be used.
export function cleanInterests(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_INTERESTS) return null;
  const out = [];
  for (const x of raw) {
    if (typeof x !== "string" || !INTEREST_IDS.includes(x)) return null;
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

// The category Relay already gives a shop: a shop it knows by name or web address, else what Relay's receipt reader
// makes of the shop's own product names. null when neither says ("other" counts as saying nothing). Never guessed.
export function shopCategory(shop, productTitles) {
  const retailer = { name: (shop && shop.label) || "", domain: (shop && shop.domain) || "" };
  const known = knownShop({ retailer });
  if (known && known.cat) return known.cat;
  const items = (productTitles || []).filter((t) => typeof t === "string" && t.trim()).slice(0, 60).map((name) => ({ name }));
  if (!items.length) return null;
  const c = categorise({ retailer, items }), cat = c && c.category;
  return cat && cat !== "other" ? cat : null;
}

const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

// GET /relay/my/interests: { interests: [ids], updatedAt, choices: [{ id, label, categories }] }.
// PUT /relay/my/interests { interests: [ids] }: replaces them (an empty list clears them).
export async function handleInterestsRoute(request, env, url, cors, shopper, o) {
  if (url.pathname !== "/relay/my/interests") return null;
  await ensureInterestsTable(env.RELAY_DB);
  const choices = INTEREST_IDS.map((id) => ({ id, label: INTERESTS[id].label, categories: INTERESTS[id].categories }));
  if (request.method === "GET") return json({ ...(await readInterests(env, shopper.id)), choices }, 200, cors);
  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405, cors);
  let body;
  try { body = JSON.parse(await request.text()); } catch { body = null; }
  const list = body && typeof body === "object" ? cleanInterests(body.interests) : null;
  if (!list) return json({ error: "bad_interests" }, 400, cors);
  const now = (o && o.now) || Date.now();
  if (!list.length) await env.RELAY_DB.prepare("DELETE FROM shopper_interests WHERE shopper_id = ?").bind(shopper.id).run();
  else await env.RELAY_DB.prepare(
    `INSERT INTO shopper_interests (shopper_id, interests, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(shopper_id) DO UPDATE SET interests = excluded.interests, updated_at = excluded.updated_at`).bind(shopper.id, JSON.stringify(list), now).run();
  return json({ interests: list, updatedAt: list.length ? now : null, choices }, 200, cors);
}
