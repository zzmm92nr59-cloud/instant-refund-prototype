// Relay's team only: search the signed-in team member's OWN connected Outlook inbox, and read one of its emails, to find
// purchases the reader missed. (For Gmail the team has a separate search; Outlook has none for personal accounts.)
// Used from the browser console; there is no screen for it.
//
// Rules (do not weaken):
//  * Team only: exactly the check every admin route uses (isAdmin: listed in RELAY_ADMIN_EMAILS and, while two-step sign-in
//    is required, a session that passed a second step). Anyone else is told the route doesn't exist (404).
//  * Own inbox only. The inbox is always one of the signed-in shopper's own connections (gmail_connections rows under their
//    own id); nothing in the request names an account, an email address or another shopper. `inbox` is only a number (1-5)
//    choosing between the caller's own Outlook inboxes.
//  * Read-only: Microsoft Graph is only ever asked with GET (listing messages, a folder's id, one message as sent). Nothing
//    is sent, moved, marked read or deleted. Reading a message through Graph doesn't mark it read.
//  * The search answers with an email's id, sender, subject and date only: no body, no preview.
//  * Nothing from an email is stored or logged. Only when each search or read happened is kept (outlook_search_uses, 2 days)
//    for the daily limits, and it goes with the account.
import { isAdmin } from "./resale-admin.js";
import { inboxesOf, accessTokenFor, slotOf, ensureHealthColumns, ensureGmailTables } from "./gmail.js";
import { buildOriginalOutlook } from "./original.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
// The same hash gmail.js keeps each email under (captured_receipts.message_ref).
async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const SEARCH_PATH = "/relay/my/outlook/search";
const MESSAGE_RE = /^\/relay\/my\/outlook\/message\/([A-Za-z0-9_=+%.-]{16,1600})$/;
// The same shape gmail.js accepts for an Outlook message id.
const OUTLOOK_ID = /^[A-Za-z0-9_=+\/-]{16,512}$/;
export const PAGE = 50;
// Per shopper, on top of the mailbox allowance in limits.js (60 a minute per session).
export const LIMITS = { search: { perMinute: 20, perDay: 400 }, message: { perMinute: 30, perDay: 600 } };
const KEEP_MS = 2 * 864e5;
// Outlook's own folders left out of the search: what the shopper sent or hasn't sent, and what they deleted. Junk Email is
// searched (a missed order may be there) and each email from it says so (junk: true).
const LEFT_OUT = ["sentitems", "drafts", "deleteditems", "outbox"];
const JUNK = "junkemail";
// A wait Graph asks for that is short enough to wait here; anything longer is passed back as "try again in…".
const MAX_WAIT_MS = 2000;

export const OUTLOOK_SEARCH_SQL = "CREATE TABLE IF NOT EXISTS outlook_search_uses (shopper_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL)";

const json = (body, status, cors, extra = {}) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store", ...extra } });
// Every refusal carries a code (for code) and plain English with what to do next (for a person).
const MESSAGES = {
  invalid_request: "That search wasn't quite right. Check the search words, the dates (YYYY-MM-DD) and the cursor, then try again.",
  outlook_not_connected: "No Outlook inbox is connected to your Relay account. Connect one in Profile, then try again.",
  outlook_reconnect_needed: "Relay can no longer open your Outlook inbox. Connect it again in Profile, then try again.",
  outlook_busy: "Outlook is busy just now. Please wait a moment and try again.",
  outlook_unavailable: "Couldn't reach Outlook just now. Please try again in a minute.",
  email_not_found: "That email isn't in your Outlook inbox any more (it may have been moved or deleted). Search again to get its new id.",
  too_many_requests: "That's a lot of searching for now. Please wait a little and try again."
};
const refuse = (error, status, cors, more = {}, headers = {}) => json({ error, message: MESSAGES[error], ...more }, status, cors, headers);
const busy = (cors, retryAfterMs) => {
  const ms = Math.max(1000, Math.min(Number(retryAfterMs) || 5000, 10 * 60 * 1000));
  return refuse("outlook_busy", 503, cors, { retryAfterMs: ms, message: `Outlook is busy just now. Please try again in ${Math.ceil(ms / 1000)} seconds.` }, { "Retry-After": String(Math.ceil(ms / 1000)) });
};

// One GET to Microsoft Graph. A refusal for being busy (429, 503, 504) is asked once more after the wait Graph asks for, when
// that's short; otherwise { busy, retryAfterMs }. Only GET, only Graph: this module never asks for anything else.
async function graphGet(fetchImpl, url, token) {
  if (!String(url).startsWith(GRAPH + "/me/")) throw new Error("graph_only");
  const ask = () => fetchImpl(url, { method: "GET", headers: { Authorization: "Bearer " + token } });
  const waitOf = (r) => {
    const s = Number(r.headers && typeof r.headers.get === "function" ? r.headers.get("retry-after") : NaN);
    return Number.isFinite(s) && s >= 0 ? s * 1000 : 5000;
  };
  const isBusy = (r) => r.status === 429 || r.status === 503 || r.status === 504;
  let r = await ask();
  if (!isBusy(r)) return { res: r };
  const wait = waitOf(r);
  if (wait > MAX_WAIT_MS) return { busy: true, retryAfterMs: wait };
  await new Promise((res) => setTimeout(res, wait));
  r = await ask();
  return isBusy(r) ? { busy: true, retryAfterMs: waitOf(r) } : { res: r };
}

// The caller's own Outlook inbox (the first one, or `inbox` 1-5 among their own): { boxId, slot } or { error }.
async function ownOutlook(env, shopper, inboxParam) {
  await ensureGmailTables(env.RELAY_DB);
  const mine = (await inboxesOf(env.RELAY_DB, shopper.id)).filter((x) => x.provider === "microsoft");
  if (!mine.length) return { error: "outlook_not_connected" };
  if (inboxParam == null) return { boxId: mine[0].shopper_id, slot: slotOf(mine[0].shopper_id) || 1 };
  const pick = mine.find((x) => (slotOf(x.shopper_id) || 1) === inboxParam);
  return pick ? { boxId: pick.shopper_id, slot: inboxParam } : { error: "outlook_not_connected" };
}
// An access token for that inbox, or why not (connect again, or Microsoft busy just now).
async function tokenOf(env, boxId, fetchImpl) {
  const t = await accessTokenFor(env, boxId, fetchImpl).catch(() => null);
  if (t && t.token && t.provider === "microsoft") return { token: t.token };
  await ensureHealthColumns(env.RELAY_DB).catch(() => {});
  const row = await env.RELAY_DB.prepare("SELECT mail_problem AS p FROM gmail_connections WHERE shopper_id = ?").bind(boxId).first().catch(() => null);
  return { error: row && row.p === "reconnect" ? "outlook_reconnect_needed" : "outlook_unavailable" };
}

// Per-shopper allowance: { ok } or { retryAfterMs }.
async function useOne(env, shopperId, kind, now) {
  const db = env.RELAY_DB, rule = LIMITS[kind];
  await db.prepare(OUTLOOK_SEARCH_SQL).run();
  await db.prepare("DELETE FROM outlook_search_uses WHERE created_at < ?").bind(now - KEEP_MS).run();
  const r = await db.prepare("SELECT SUM(created_at > ?) AS m, COUNT(*) AS d FROM outlook_search_uses WHERE shopper_id = ? AND kind = ? AND created_at > ?")
    .bind(now - 60e3, shopperId, kind, now - 864e5).first();
  if (r && Number(r.d) >= rule.perDay) return { retryAfterMs: 60 * 60 * 1000 };
  if (r && Number(r.m) >= rule.perMinute) return { retryAfterMs: 60 * 1000 };
  await db.prepare("INSERT INTO outlook_search_uses (shopper_id, kind, created_at) VALUES (?, ?, ?)").bind(shopperId, kind, now).run();
  return { ok: true };
}
const tooMany = (cors, ms) => refuse("too_many_requests", 429, cors, { retryAfterMs: ms }, { "Retry-After": String(Math.ceil(ms / 1000)) });

// "Delete my account": when they searched (nothing else is kept).
export async function outlookSearchDeleteStatements(db, shopperId) {
  await db.prepare(OUTLOOK_SEARCH_SQL).run();
  return [db.prepare("DELETE FROM outlook_search_uses WHERE shopper_id = ?").bind(shopperId)];
}

// ---- The search's address: q, after, before, cursor, inbox ----
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function day(v) {
  const m = DATE.exec(v);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 1990 && +m[1] <= 2100 ? v : null;
}
const ALLOWED = new Set(["q", "after", "before", "cursor", "inbox"]);
// Returns { q, after, before, cursor, inbox } or { field } naming what's wrong.
export function readSearchParams(searchParams) {
  const seen = new Set();
  for (const [k] of searchParams) {
    if (!ALLOWED.has(k) || seen.has(k)) return { field: k.slice(0, 40) };
    seen.add(k);
  }
  const out = { q: "", after: null, before: null, cursor: null, inbox: null };
  if (searchParams.has("q")) {
    // Outlook's search words (KQL: from:, subject:, OR and the like work). Quotes and backslashes would end Relay's own
    // quoting of the search, so they're refused rather than guessed at.
    const q = String(searchParams.get("q")).replace(/\s+/g, " ").trim();
    if (q.length > 200 || /["\\\u0000-\u001F\u007F]/.test(q)) return { field: "q" };
    out.q = q;
  }
  for (const k of ["after", "before"]) if (searchParams.has(k)) { const v = day(String(searchParams.get(k))); if (!v) return { field: k }; out[k] = v; }
  if (out.after && out.before && out.after >= out.before) return { field: "before" };
  if (searchParams.has("inbox")) { const v = String(searchParams.get("inbox")); if (!/^[1-5]$/.test(v)) return { field: "inbox" }; out.inbox = Number(v); }
  if (searchParams.has("cursor")) {
    const c = readCursor(String(searchParams.get("cursor")));
    if (!c) return { field: "cursor" };
    out.cursor = c;
  }
  return out;
}

// The cursor: where the next page is, as Graph said (its nextLink, always under /me/messages), with the search's dates and
// inbox and the ids of the folders left out, so the next page asks Graph nothing else. Opaque to the caller.
const writeCursor = (c) => btoa(unescape(encodeURIComponent(JSON.stringify(c)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function readCursor(s) {
  if (!/^[A-Za-z0-9_-]{8,4000}$/.test(s)) return null;
  let c;
  try { c = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))); } catch { return null; }
  if (!c || typeof c !== "object" || c.v !== 1 || typeof c.u !== "string") return null;
  if (!c.u.startsWith("/me/messages?") || c.u.length > 2900 || /[#\s\\]/.test(c.u)) return null;
  if (!Number.isInteger(c.i) || c.i < 1 || c.i > 5) return null;
  for (const k of ["a", "b"]) if (c[k] != null && !day(String(c[k]))) return null;
  if (!Array.isArray(c.x) || c.x.length > LEFT_OUT.length || !c.x.every((x) => typeof x === "string" && OUTLOOK_ID.test(x))) return null;
  if (c.j != null && !(typeof c.j === "string" && OUTLOOK_ID.test(c.j))) return null;
  return { u: c.u, i: c.i, a: c.a || null, b: c.b || null, x: c.x, j: c.j || null };
}

// The ids of the folders the search leaves out, and Junk's. Folders Outlook won't name are left in.
async function folderIds(fetchImpl, token) {
  const names = [...LEFT_OUT, JUNK], ids = {};
  // Outlook allows 4 requests open at once on a mailbox: asked 3 at a time.
  for (let i = 0; i < names.length; i += 3) {
    const got = await Promise.all(names.slice(i, i + 3).map((n) => graphGet(fetchImpl, GRAPH + "/me/mailFolders/" + n + "?$select=id", token)));
    for (let k = 0; k < got.length; k++) {
      const g = got[k];
      if (g.busy) return { busy: true, retryAfterMs: g.retryAfterMs };
      const id = g.res.ok ? (await g.res.json().catch(() => ({}))).id : null;
      if (typeof id === "string" && OUTLOOK_ID.test(id)) ids[names[i + k]] = id;
    }
  }
  return { left: LEFT_OUT.map((n) => ids[n]).filter(Boolean), junk: ids[JUNK] || null };
}

const SELECT = "id,internetMessageId,subject,from,receivedDateTime,parentFolderId";
// MM/DD/YYYY, the form Graph's own examples use for dates in a search.
const kqlDay = (d) => d.slice(5, 7) + "/" + d.slice(8, 10) + "/" + d.slice(0, 4);
function firstUrl(p, withDates = true) {
  if (p.q) {
    // $search can't be used with $filter or $orderby on messages; Graph sorts what it finds newest first by itself and finds
    // at most 1,000. The dates go into the search itself, and are checked again here (below) whatever Graph does with them.
    const terms = ["(" + p.q + ")"];
    if (withDates && p.after) terms.push("received>=" + kqlDay(p.after));
    if (withDates && p.before) terms.push("received<" + kqlDay(p.before));
    return "/me/messages?$search=" + encodeURIComponent('"' + terms.join(" AND ") + '"') + "&$top=" + PAGE + "&$select=" + SELECT;
  }
  const f = [];
  if (p.after) f.push("receivedDateTime ge " + p.after + "T00:00:00Z");
  if (p.before) f.push("receivedDateTime lt " + p.before + "T00:00:00Z");
  return "/me/messages?" + (f.length ? "$filter=" + encodeURIComponent(f.join(" and ")) + "&" : "") +
    "$orderby=" + encodeURIComponent("receivedDateTime desc") + "&$top=" + PAGE + "&$select=" + SELECT;
}

async function handleSearch(env, shopper, url, cors, o) {
  const p = readSearchParams(url.searchParams);
  if (p.field) return refuse("invalid_request", 400, cors, { field: p.field });
  const fetchImpl = o.fetchImpl || fetch, now = o.now || Date.now();
  const own = await ownOutlook(env, shopper, p.cursor ? p.cursor.i : p.inbox);
  if (own.error) return refuse(own.error, 409, cors);
  const lim = await useOne(env, shopper.id, "search", now);
  if (!lim.ok) return tooMany(cors, lim.retryAfterMs);
  const t = await tokenOf(env, own.boxId, fetchImpl);
  if (t.error) return refuse(t.error, t.error === "outlook_reconnect_needed" ? 409 : 502, cors);

  let left, junk, after, before, path;
  if (p.cursor) ({ x: left, j: junk, a: after, b: before, u: path } = p.cursor);
  else {
    const f = await folderIds(fetchImpl, t.token);
    if (f.busy) return busy(cors, f.retryAfterMs);
    ({ left, junk } = f); after = p.after; before = p.before; path = firstUrl(p);
  }
  let g = await graphGet(fetchImpl, GRAPH + path, t.token);
  // If Outlook won't take the dates inside the search, the search is asked without them; the dates are still applied here.
  if (!g.busy && g.res.status === 400 && !p.cursor && p.q && (p.after || p.before)) { path = firstUrl(p, false); g = await graphGet(fetchImpl, GRAPH + path, t.token); }
  if (g.busy) return busy(cors, g.retryAfterMs);
  if (g.res.status === 401) return refuse("outlook_reconnect_needed", 409, cors);
  if (!g.res.ok) { console.error("outlook_search_failed", g.res.status); return refuse("outlook_unavailable", 502, cors); }
  const data = await g.res.json().catch(() => ({}));
  const skip = new Set(left);
  const lo = after ? Date.parse(after + "T00:00:00Z") : -Infinity, hi = before ? Date.parse(before + "T00:00:00Z") : Infinity;
  const found = (Array.isArray(data.value) ? data.value : []).filter((m) => m && typeof m.id === "string" && OUTLOOK_ID.test(m.id) && !skip.has(m.parentFolderId))
    .filter((m) => { const at = Date.parse(m.receivedDateTime); return !Number.isFinite(at) ? !(after || before) : at >= lo && at < hi; });

  // Whether Relay already made a receipt from each one: by the email's own Message-ID (how Relay remembers Outlook emails,
  // since Outlook's ids change when an email is moved), or by the Outlook id the receipt was read from.
  const refOf = async (m) => { const mid = typeof m.internetMessageId === "string" ? m.internetMessageId.trim() : ""; return sha256Hex("outlook:" + (mid && mid.length <= 400 ? mid : m.id)); };
  const refs = await Promise.all(found.map(refOf));
  const byRef = new Map(), byId = new Map();
  if (found.length) {
    const marks = (n) => Array(n).fill("?").join(",");
    const a = await env.RELAY_DB.prepare(`SELECT id, status, message_ref AS ref FROM captured_receipts WHERE shopper_id = ? AND message_ref IN (${marks(refs.length)})`).bind(shopper.id, ...refs).all();
    for (const r of a.results || []) byRef.set(r.ref, r);
    const b = await env.RELAY_DB.prepare(`SELECT id, status, json_extract(details, '$.outlookId') AS oid FROM captured_receipts WHERE shopper_id = ? AND json_extract(details, '$.outlookId') IN (${marks(found.length)})`)
      .bind(shopper.id, ...found.map((m) => m.id)).all();
    for (const r of b.results || []) if (!byId.has(r.oid)) byId.set(r.oid, r);
  }
  const results = found.map((m, k) => {
    const have = byRef.get(refs[k]) || byId.get(m.id) || null;
    const who = (m.from && m.from.emailAddress) || {};
    const receipt = Boolean(have && !["not_receipt", "dismissed"].includes(have.status));
    return {
      id: m.id,
      from: { name: String(who.name || "").slice(0, 120), address: String(who.address || "").slice(0, 200) },
      subject: String(m.subject || "").slice(0, 300),
      received: typeof m.receivedDateTime === "string" ? m.receivedDateTime : null,
      ...(junk && m.parentFolderId === junk ? { junk: true } : {}),
      receipt,
      ...(receipt ? { receiptId: have.id } : {}),
      // What Relay made of it when it read it, even when that wasn't a receipt ("not_receipt", "dismissed"); null if never read.
      readAs: have ? have.status : null
    };
  });
  const link = data["@odata.nextLink"];
  let cursor = null;
  if (typeof link === "string" && link.startsWith(GRAPH + "/me/messages?")) {
    const c = { v: 1, u: link.slice(GRAPH.length), i: own.slot, a: after || null, b: before || null, x: left, j: junk || null };
    if (c.u.length <= 2900 && !/[#\s\\]/.test(c.u)) cursor = writeCursor(c);
  }
  return json({ inbox: own.slot, results, cursor, more: Boolean(cursor), ...(p.q ? { searchLimit: 1000 } : {}) }, 200, cors);
}

// Plain text of the cleaned HTML, for reading in the console.
function textOf(html) {
  return String(html)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/div|\/tr|\/h[1-6]|\/li|\/table)\b[^>]*>/gi, "\n").replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 100_000);
}

async function handleMessage(env, shopper, rawId, url, cors, o) {
  let id;
  try { id = decodeURIComponent(rawId); } catch { id = ""; }
  if (!OUTLOOK_ID.test(id)) return refuse("invalid_request", 400, cors, { field: "id" });
  let inbox = null;
  for (const [k, v] of url.searchParams) {
    if (k !== "inbox" || inbox !== null || !/^[1-5]$/.test(v)) return refuse("invalid_request", 400, cors, { field: k.slice(0, 40) });
    inbox = Number(v);
  }
  const fetchImpl = o.fetchImpl || fetch, now = o.now || Date.now();
  const own = await ownOutlook(env, shopper, inbox);
  if (own.error) return refuse(own.error, 409, cors);
  const lim = await useOne(env, shopper.id, "message", now);
  if (!lim.ok) return tooMany(cors, lim.retryAfterMs);
  const t = await tokenOf(env, own.boxId, fetchImpl);
  if (t.error) return refuse(t.error, t.error === "outlook_reconnect_needed" ? 409 : 502, cors);
  // Who sent it, its subject and date; then the email as sent, cleaned exactly as "View original email" cleans it.
  const meta = await graphGet(fetchImpl, GRAPH + "/me/messages/" + encodeURIComponent(id) + "?$select=subject,from,receivedDateTime", t.token);
  if (meta.busy) return busy(cors, meta.retryAfterMs);
  if (meta.res.status === 404 || meta.res.status === 400) return refuse("email_not_found", 404, cors);
  if (meta.res.status === 401) return refuse("outlook_reconnect_needed", 409, cors);
  if (!meta.res.ok) { console.error("outlook_message_failed", meta.res.status); return refuse("outlook_unavailable", 502, cors); }
  const m = await meta.res.json().catch(() => ({}));
  let wasBusy = null;
  const getOnly = async (u) => {
    const g = await graphGet(fetchImpl, String(u), t.token);
    if (g.busy) { wasBusy = g; return new Response(null, { status: 503 }); }
    return g.res;
  };
  const shown = await buildOriginalOutlook(getOnly, t.token, id);
  if (wasBusy) return busy(cors, wasBusy.retryAfterMs);
  if (shown.status === 404) return refuse("email_not_found", 404, cors);
  if (shown.status !== 200) return refuse("outlook_unavailable", 502, cors);
  const who = (m.from && m.from.emailAddress) || {};
  return json({
    inbox: own.slot, id,
    from: { name: String(who.name || "").slice(0, 120), address: String(who.address || "").slice(0, 200) },
    subject: String(m.subject || "").slice(0, 300),
    received: typeof m.receivedDateTime === "string" ? m.receivedDateTime : null,
    text: textOf(shown.body.html), html: shown.body.html, links: shown.body.links, extraImages: shown.body.extraImages
  }, 200, cors);
}

// GET /relay/my/outlook/search and GET /relay/my/outlook/message/<id>. Returns null for any other path.
export async function handleOutlookSearchRoute(path, method, env, url, cors, shopper, o = {}) {
  const msg = MESSAGE_RE.exec(path);
  if (path !== SEARCH_PATH && !msg) return null;
  if (!isAdmin(env, shopper) || method !== "GET") return json({ error: "not_found" }, 404, cors);
  return msg ? handleMessage(env, shopper, msg[1], url, cors, o) : handleSearch(env, shopper, url, cors, o);
}
