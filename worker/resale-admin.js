// Review of resale reports, for the Relay operator only.
//
// Who is an admin: a signed-in shopper whose email is listed in the RELAY_ADMIN_EMAILS secret
// (comma separated). With no secret set, nobody is an admin and every admin route answers as if it did not exist.
// What an admin sees: the reported conversation, with the two people shown only as "reporter" and
// "reported member", or for a listing reported from Browse, the listing as members see it. Never an email, name,
// order number or address.
// What an admin can do: dismiss, remove the reported seller's listing, or block the reported member.
// A block is remembered by a hash of the email so deleting and re-creating the account does not undo it.
import { secondStepRequired } from "./second-step.js";

export const ADMIN_TABLE_SQL = [
  `CREATE TABLE IF NOT EXISTS resale_report_reviews (
     report_id TEXT PRIMARY KEY, outcome TEXT NOT NULL, reviewed_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS resale_blocks (
     email_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, report_id TEXT)`
];

// While two-step sign-in is required (second-step.js), an admin's session must also have passed a second step; otherwise
// every admin route answers as if it did not exist, and /relay/my/admin/me says to sign in again.
export function isAdmin(env, shopper) {
  return listedAdmin(env, shopper) && (!secondStepRequired(env) || shopper.secondStep === true);
}
function listedAdmin(env, shopper) {
  const list = String(env.RELAY_ADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  return Boolean(shopper && shopper.email && list.includes(String(shopper.email).toLowerCase()));
}

export async function isBlocked(env, shopper) {
  if (!shopper || !shopper.emailHash) return false;
  const r = await env.RELAY_DB.prepare("SELECT 1 AS x FROM resale_blocks WHERE email_hash = ?").bind(shopper.emailHash).first();
  return Boolean(r);
}

const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
const OUTCOMES = ["dismiss", "remove_listing", "block"];

async function openReports(env) {
  const rows = (await env.RELAY_DB.prepare(
    `SELECT rp.id, rp.request_id, rp.reporter_id, rp.reason, rp.created_at,
            q.asker_id, l.seller_id, l.id AS listing_id, l.title, l.store, l.status AS listing_status
       FROM resale_reports rp
       JOIN resale_requests q ON q.id = rp.request_id
       JOIN resale_listings l ON l.id = q.listing_id
       LEFT JOIN resale_report_reviews v ON v.report_id = rp.id
      WHERE v.report_id IS NULL
      ORDER BY rp.created_at DESC LIMIT 50`).all()).results || [];
  const out = [];
  for (const r of rows) {
    const reporterIsBuyer = r.reporter_id === r.asker_id;
    const reportedId = reporterIsBuyer ? r.seller_id : r.asker_id;
    const msgs = (await env.RELAY_DB.prepare(
      "SELECT sender_id, body, created_at FROM resale_messages WHERE request_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 200").bind(r.request_id).all()).results || [];
    out.push({
      id: r.id, kind: "conversation", createdAt: r.created_at, reason: r.reason || "",
      item: { title: r.title, store: r.store || "", status: r.listing_status },
      reporterRole: reporterIsBuyer ? "buyer" : "seller",
      reportedRole: reporterIsBuyer ? "seller" : "buyer",
      reportsAgainstReported: await reportsAgainst(env, reportedId),
      reportedAlreadyBlocked: await blockedMember(env, reportedId),
      canRemoveListing: reporterIsBuyer, // only when the reported member is the seller (the reporter is the buyer)
      messages: msgs.map(m => ({ from: m.sender_id === r.reporter_id ? "reporter" : "reported member", body: m.body, createdAt: m.created_at }))
    });
  }
  // Listings reported straight from Browse: the listing as members see it.
  const listed = (await env.RELAY_DB.prepare(
    `SELECT rp.id, rp.reason, rp.created_at, l.seller_id, l.title, l.store, l.status AS listing_status, l.size, l.condition, l.note, l.ask_pence, l.currency
       FROM resale_listing_reports rp JOIN resale_listings l ON l.id = rp.listing_id
       LEFT JOIN resale_report_reviews v ON v.report_id = rp.id
      WHERE v.report_id IS NULL ORDER BY rp.created_at DESC LIMIT 50`).all()).results || [];
  for (const r of listed) {
    out.push({
      id: r.id, kind: "listing", createdAt: r.created_at, reason: r.reason || "",
      item: { title: r.title, store: r.store || "", status: r.listing_status, size: r.size || null, condition: r.condition || null, note: r.note || null,
        askPence: r.ask_pence, currency: r.currency || "GBP" },
      reporterRole: "member", reportedRole: "seller",
      reportsAgainstReported: await reportsAgainst(env, r.seller_id),
      reportedAlreadyBlocked: await blockedMember(env, r.seller_id),
      canRemoveListing: true, messages: []
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
}

// How many reports other members have made against this member: about their conversations, and about their listings.
async function reportsAgainst(env, memberId) {
  const talk = await env.RELAY_DB.prepare(
    `SELECT COUNT(*) AS n FROM resale_reports rp JOIN resale_requests q ON q.id = rp.request_id JOIN resale_listings l ON l.id = q.listing_id
      WHERE rp.reporter_id != ? AND (q.asker_id = ? OR l.seller_id = ?)`).bind(memberId, memberId, memberId).first();
  const listings = await env.RELAY_DB.prepare(
    "SELECT COUNT(*) AS n FROM resale_listing_reports rp JOIN resale_listings l ON l.id = rp.listing_id WHERE l.seller_id = ? AND rp.reporter_id != ?").bind(memberId, memberId).first();
  return Math.max(1, Number(talk && talk.n || 0) + Number(listings && listings.n || 0));
}
async function blockedMember(env, memberId) {
  const hash = await env.RELAY_DB.prepare("SELECT email_hash FROM shoppers WHERE id = ?").bind(memberId).first();
  return hash ? Boolean(await env.RELAY_DB.prepare("SELECT 1 AS x FROM resale_blocks WHERE email_hash = ?").bind(hash.email_hash).first()) : false;
}

// Open reports of either kind, for the admin's count (and the morning summary).
export async function openReportCount(env) {
  const n = await env.RELAY_DB.prepare(`SELECT
      (SELECT COUNT(*) FROM resale_reports rp LEFT JOIN resale_report_reviews v ON v.report_id = rp.id WHERE v.report_id IS NULL) +
      (SELECT COUNT(*) FROM resale_listing_reports rp LEFT JOIN resale_report_reviews v ON v.report_id = rp.id WHERE v.report_id IS NULL) AS n`).first();
  return Number(n && n.n || 0);
}

async function review(env, admin, reportId, outcome, now) {
  if (!OUTCOMES.includes(outcome)) return { status: 400, body: { error: "invalid_outcome" } };
  // A conversation report, or a listing reported from Browse (whose reporter is a member looking at it, not a buyer).
  const r = await env.RELAY_DB.prepare(
    `SELECT rp.id, rp.reporter_id, q.asker_id, l.seller_id, l.id AS listing_id
       FROM resale_reports rp JOIN resale_requests q ON q.id = rp.request_id JOIN resale_listings l ON l.id = q.listing_id
      WHERE rp.id = ?`).bind(reportId).first()
    || await env.RELAY_DB.prepare(
    `SELECT rp.id, rp.reporter_id, rp.reporter_id AS asker_id, l.seller_id, l.id AS listing_id
       FROM resale_listing_reports rp JOIN resale_listings l ON l.id = rp.listing_id WHERE rp.id = ?`).bind(reportId).first();
  if (!r) return { status: 404, body: { error: "not_found" } };
  const done = await env.RELAY_DB.prepare("SELECT 1 AS x FROM resale_report_reviews WHERE report_id = ?").bind(reportId).first();
  if (done) return { status: 409, body: { error: "already_reviewed" } };
  // An admin never judges a report they are part of.
  if ([r.asker_id, r.seller_id].includes(admin.id)) return { status: 403, body: { error: "conflict_of_interest" } };
  const reporterIsBuyer = r.reporter_id === r.asker_id;
  const reportedId = reporterIsBuyer ? r.seller_id : r.asker_id;
  const stamp = env.RELAY_DB.prepare("INSERT INTO resale_report_reviews (report_id, outcome, reviewed_at) VALUES (?,?,?)").bind(reportId, outcome, now);
  const stmts = [];
  if (outcome === "remove_listing") {
    if (reporterIsBuyer === false) return { status: 400, body: { error: "no_listing_to_remove" } };
    stmts.push(
      env.RELAY_DB.prepare("UPDATE resale_listings SET status = 'withdrawn' WHERE id = ? AND status IN ('active','matched')").bind(r.listing_id),
      env.RELAY_DB.prepare("UPDATE resale_requests SET status = 'declined' WHERE listing_id = ? AND status = 'pending'").bind(r.listing_id),
      env.RELAY_DB.prepare("UPDATE resale_requests SET status = 'closed' WHERE listing_id = ? AND status = 'accepted'").bind(r.listing_id));
  }
  if (outcome === "block") {
    const who = await env.RELAY_DB.prepare("SELECT email_hash FROM shoppers WHERE id = ?").bind(reportedId).first();
    if (!who) return { status: 404, body: { error: "not_found" } };
    stmts.push(
      env.RELAY_DB.prepare("INSERT OR IGNORE INTO resale_blocks (email_hash, created_at, report_id) VALUES (?,?,?)").bind(who.email_hash, now, reportId),
      // Other members' listings that were matched with the blocked member go back on sale.
      env.RELAY_DB.prepare("UPDATE resale_listings SET status = 'active' WHERE status = 'matched' AND id IN (SELECT listing_id FROM resale_requests WHERE asker_id = ? AND status = 'accepted')").bind(reportedId),
      env.RELAY_DB.prepare("UPDATE resale_listings SET status = 'withdrawn' WHERE seller_id = ? AND status IN ('active','matched')").bind(reportedId),
      env.RELAY_DB.prepare("UPDATE resale_requests SET status = 'declined' WHERE status = 'pending' AND (asker_id = ? OR listing_id IN (SELECT id FROM resale_listings WHERE seller_id = ?))").bind(reportedId, reportedId),
      env.RELAY_DB.prepare("UPDATE resale_requests SET status = 'closed' WHERE status = 'accepted' AND (asker_id = ? OR listing_id IN (SELECT id FROM resale_listings WHERE seller_id = ?))").bind(reportedId, reportedId));
  }
  stmts.push(stamp);
  await env.RELAY_DB.batch(stmts);
  return { status: 200, body: { ok: true } };
}

// Returns a Response, or null when the path is not an admin path.
export async function handleResaleAdminRoute(path, method, request, env, cors, shopper, now) {
  if (!path.startsWith("/relay/my/admin/")) return null;
  if (path === "/relay/my/admin/me" && method === "GET") {
    if (!isAdmin(env, shopper)) return json({ admin: false, ...(listedAdmin(env, shopper) ? { signInAgain: true } : {}) }, 200, cors);
    return json({ admin: true, openReports: await openReportCount(env) }, 200, cors);
  }
  // Anyone else gets the same answer as for a path that does not exist.
  if (!isAdmin(env, shopper)) return json({ error: "not_found" }, 404, cors);
  if (path === "/relay/my/admin/reports" && method === "GET") return json({ reports: await openReports(env) }, 200, cors);
  const m = /^\/relay\/my\/admin\/reports\/([0-9a-f-]{36})\/review$/.exec(path);
  if (m && method === "POST") {
    const text = await request.text();
    let body = null; try { body = text.length < 1000 ? JSON.parse(text) : null; } catch { body = null; }
    const r = await review(env, shopper, m[1], body && body.outcome, now);
    return json(r.body, r.status, cors);
  }
  return json({ error: "not_found" }, 404, cors);
}
