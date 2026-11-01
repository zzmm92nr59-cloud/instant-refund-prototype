// The shopper's own name and profile photo. Only the shopper sees them: Relay never shows them to other members
// (the Market keeps sellers anonymous), shops or anyone else.
// The photo is cut to a square and shrunk on the shopper's own device before it is sent (which also leaves the camera's
// location details behind). Here it is only checked to be a real, small JPEG, PNG or WebP picture.
import { ensureOnce } from "./once.js";

const MAX_NAME = 40, MAX_PHOTO_BYTES = 150_000, MAX_BODY = 260_000;

export function ensureProfileTable(db) {
  return ensureOnce(db, "profiles", () => db.prepare(
    `CREATE TABLE IF NOT EXISTS shopper_profiles (
       shopper_id TEXT PRIMARY KEY, name TEXT, photo_type TEXT, photo_data TEXT, updated_at INTEGER NOT NULL)`).run());
}
// Deleting the account deletes the name and photo with it.
export function profileDeleteStatements(db, shopperId) {
  return [db.prepare("DELETE FROM shopper_profiles WHERE shopper_id = ?").bind(shopperId)];
}

// A name as people write their own: letters in any language, spaces, hyphens, apostrophes and full stops. null clears it;
// undefined means it can't be used.
export function cleanName(raw) {
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const s = raw.normalize("NFC").replace(/[\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if ([...s].length > MAX_NAME) return undefined;
  return /^[\p{L}\p{M}][\p{L}\p{M}\p{N} .'’-]*$/u.test(s) ? s : undefined;
}

// A photo as a data address ("data:image/jpeg;base64,…") whose bytes really are that kind of picture. null if not.
export function cleanPhoto(raw) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(typeof raw === "string" ? raw : "");
  if (!m) return null;
  let bytes;
  try { bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); } catch { return null; }
  if (bytes.length < 100 || bytes.length > MAX_PHOTO_BYTES) return null;
  const at = (i, list) => list.every((b, k) => bytes[i + k] === b);
  const real = m[1] === "image/jpeg" ? at(0, [0xff, 0xd8, 0xff])
    : m[1] === "image/png" ? at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]);
  return real ? { type: m[1], data: m[2] } : null;
}

function json(body, status, cors) {
  return Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
}
async function readProfile(env, shopperId) {
  const row = await env.RELAY_DB.prepare("SELECT name, photo_type, photo_data, updated_at FROM shopper_profiles WHERE shopper_id = ?").bind(shopperId).first();
  return { name: row && row.name || null, photo: row && row.photo_data ? `data:${row.photo_type};base64,${row.photo_data}` : null, updatedAt: row && row.updated_at || null };
}

export async function handleProfileRoute(request, env, url, cors, shopper, o) {
  if (url.pathname !== "/relay/my/profile") return null;
  await ensureProfileTable(env.RELAY_DB);
  if (request.method === "GET") return json({ email: shopper.email, ...(await readProfile(env, shopper.id)) }, 200, cors);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: "photo_too_big" }, 413, cors);
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!body || typeof body !== "object") return json({ error: "bad_request" }, 400, cors);
  const now = (o && o.now) || Date.now();
  const current = await readProfile(env, shopper.id);
  let name = current.name, photo = current.photo ? cleanPhoto(current.photo) : null;
  // Only the parts sent are changed: { name } alone keeps the photo, { photo: null } removes just the photo.
  if ("name" in body) {
    const n = cleanName(body.name);
    if (n === undefined) return json({ error: "bad_name" }, 400, cors);
    name = n;
  }
  if ("photo" in body) {
    if (body.photo === null) photo = null;
    else {
      photo = cleanPhoto(body.photo);
      if (!photo) return json({ error: "bad_photo" }, 400, cors);
    }
  }
  if (!name && !photo) await env.RELAY_DB.prepare("DELETE FROM shopper_profiles WHERE shopper_id = ?").bind(shopper.id).run();
  else await env.RELAY_DB.prepare(
    `INSERT INTO shopper_profiles (shopper_id,name,photo_type,photo_data,updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(shopper_id) DO UPDATE SET name=excluded.name, photo_type=excluded.photo_type, photo_data=excluded.photo_data, updated_at=excluded.updated_at`)
    .bind(shopper.id, name, photo ? photo.type : null, photo ? photo.data : null, now).run();
  return json({ email: shopper.email, ...(await readProfile(env, shopper.id)) }, 200, cors);
}
