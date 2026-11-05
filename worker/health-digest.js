// Relay health by email, for Relay's admins: a summary each morning, and an alert when something breaks.
//
// Rules (do not weaken):
//  * Counts only, exactly as on the Relay health page (health.js): nothing from a single receipt, nothing naming a shopper.
//  * The summary goes once a day, at the first hourly run from 8am UK time. Each kind of alert goes at most once every
//    ALERT_GAP_HOURS, and only while what it's about is still happening.
//  * Only to the addresses in RELAY_ADMIN_EMAILS: nothing is sent while that's empty. HEALTH_EMAILS=off stops both.
//  * "Email me one now" (an admin on the health page) sends the summary to that admin only, at most once in 5 minutes.
import { relayHealth } from "./health.js";
import { isAdmin } from "./resale-admin.js";

export const ALERT_GAP_HOURS = 6;
const HOUR = 36e5, DAY = 864e5, MANUAL_GAP = 5 * 60e3;
const DEFAULT_FROM = "Relay <onboarding@resend.dev>";
const APP_URL = "https://zzmm92nr59-cloud.github.io/instant-refund-prototype/";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const N = (x) => (Number(x) || 0).toLocaleString("en-GB");
const plural = (x, one, more) => N(x) + " " + (Number(x) === 1 ? one : more);
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

export const HEALTH_MAIL_SQL = [`CREATE TABLE IF NOT EXISTS health_mail (kind TEXT PRIMARY KEY, sent_at INTEGER NOT NULL, day TEXT)`];
async function ensureTable(db) { for (const sql of HEALTH_MAIL_SQL) await db.prepare(sql).run(); }
export const adminAddresses = (env) => String(env.RELAY_ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
const ukParts = (t) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { day: p.year + "-" + p.month + "-" + p.day, hour: Number(p.hour) };
};
// Why a scan stopped, in plain words (the same as the health page).
const SCAN_ERR = { gmail_reconnect_needed: "inbox needs connecting again", gmail_not_connected: "inbox was disconnected", gmail_unavailable: "Gmail or Outlook was busy",
  scan_busy: "a check was already running", too_many_requests: "too many checks at once", consent_required: "waiting for the shopper's permission", consent_version_mismatch: "waiting for the shopper's permission" };

// What's wrong right now, from the last hour. Each: { kind, title, text }.
export async function currentAlerts(env, now = Date.now()) {
  const db = env.RELAY_DB, out = [];
  const one = async (sql, ...a) => { try { return (await db.prepare(sql).bind(...a).first()) || {}; } catch { return {}; } };
  const all = async (sql, ...a) => { try { return (await db.prepare(sql).bind(...a).all()).results || []; } catch { return []; } };
  const h1 = now - HOUR;
  const scans = await one("SELECT SUM(state = 'failed') AS failed, SUM(state IN ('done', 'failed')) AS finished FROM mail_scan_jobs WHERE updated_at >= ?", h1);
  const failed = Number(scans.failed) || 0, finished = Number(scans.finished) || 0;
  if (failed >= 3 && failed * 2 >= finished) {
    const why = await all("SELECT error, COUNT(*) AS n FROM mail_scan_jobs WHERE state = 'failed' AND updated_at >= ? GROUP BY error ORDER BY n DESC LIMIT 3", h1);
    const reasons = why.map((r) => (SCAN_ERR[r.error] || "another problem") + " (" + N(r.n) + ")").join(", ");
    out.push({ kind: "scans_failing", title: "Most inbox checks stopped in the last hour",
      text: N(failed) + " of the last hour's " + plural(finished, "check", "checks") + " stopped" + (reasons ? ": " + reasons : "") + ". The server logs in Cloudflare say more." });
  }
  const boxes = await one("SELECT COUNT(*) AS n, MAX(last_scan_at) AS last FROM gmail_connections");
  const last = Number(boxes.last) || 0;
  if (Number(boxes.n) > 0 && (!last || now - last > 3 * HOUR)) {
    out.push({ kind: "checks_stalled", title: "No inbox has been checked for " + (last ? Math.floor((now - last) / HOUR) + " hours" : "a long time"),
      text: "Relay checks inboxes every 15 minutes, so something has stopped it. The automatic check's lines in Cloudflare's server logs say why." });
  }
  const re = await one("SELECT COUNT(*) AS n FROM mail_scan_jobs WHERE error = 'gmail_reconnect_needed' AND updated_at >= ?", h1);
  if (Number(re.n) >= 3) out.push({ kind: "reconnects", title: plural(re.n, "inbox needs", "inboxes need") + " connecting again",
    text: "That many in an hour can mean Google or Microsoft stopped Relay's access. Check the Google Cloud and Microsoft app settings. Each shopper also sees a prompt to connect again." });
  const codes = await one("SELECT COUNT(*) AS n FROM auth_code_failures WHERE created_at >= ?", h1);
  if (Number(codes.n) >= 30) out.push({ kind: "sign_in_codes", title: plural(codes.n, "wrong sign-in code", "wrong sign-in codes") + " in the last hour",
    text: "Someone may be guessing codes. Relay's limits hold them back, so there's nothing to do unless it carries on." });
  return out;
}

// The morning summary: { subject, text, html }.
export function digestMessage(h, alerts) {
  const rd = h.reading, pu = rd.purchases, ib = h.inboxes, y = rd.days[rd.days.length - 2] || { kept: 0, skipped: 0 };
  const week = rd.days.slice(-7).reduce((s, d) => s + d.kept, 0);
  const sure = pu.receipts ? Math.round(pu.high / pu.receipts * 100) : null;
  const look = alerts.map((a) => a.title + ". " + a.text);
  if (ib.notCheckedToday) look.push(plural(ib.notCheckedToday, "inbox hasn't", "inboxes haven't") + " been checked in the last day.");
  const reconnect = (ib.scanErrorsThisWeek || []).filter((e) => e.error === "gmail_reconnect_needed").reduce((s, e) => s + e.count, 0);
  if (reconnect && !alerts.some((a) => a.kind === "reconnects")) look.push(plural(reconnect, "inbox", "inboxes") + " needed connecting again this week (their owners see a prompt in the app).");
  if (rd.waitingToBeRead >= 20) look.push(plural(rd.waitingToBeRead, "email is", "emails are") + " waiting to be read again.");
  // Emails shoppers sent to Relay because they were read wrong (deleted after 30 days, so worth reading soon).
  if (h.marketReports) look.push(plural(h.marketReports, "Swap & resell report is", "Swap & resell reports are") + " waiting for review (Profile, Team, Review reports).");
  if (h.sharedEmails && h.sharedEmails.waiting) look.push(plural(h.sharedEmails.waiting, "email", "emails") + " that shoppers sent to Relay " + (h.sharedEmails.waiting === 1 ? "is" : "are") + " waiting to be read.");
  const fixed = rd.fixedByShoppers || { receipts: 0, thisWeek: 0 };
  const groups = [
    ["Needs a look", look.length ? look : ["Nothing needs a look."]],
    ["Yesterday", [plural(y.kept, "receipt", "receipts") + " found, " + plural(y.skipped, "other email", "other emails") + " skipped."]],
    ["The last 7 days", [
      plural(h.people.shoppers, "shopper", "shoppers") + " (" + N(h.people.newThisWeek) + " new), " + plural(ib.gmail + ib.outlook, "inbox", "inboxes") + ".",
      plural(week, "receipt", "receipts") + " found" + (sure != null ? "; " + sure + "% of all purchases read confidently." : "."),
      plural(fixed.thisWeek || 0, "receipt", "receipts") + " fixed by shoppers; " + plural(pu.pasted, "receipt", "receipts") + " added by hand in all.",
      ...(h.helpChat ? [plural(h.helpChat.messagesThisWeek, "help chat message", "help chat messages") + ", " + plural(h.helpChat.handoffsThisWeek, "hand-off", "hand-offs") + " to a person."] : [])
    ]]
  ];
  // Checked against shops' own records (answer-key.js), once there's anything to check.
  const key = h.checkedByShops;
  if (key && key.orders) groups.push(["Checked against shops' own records", [
    plural(key.found, "order", "orders") + " from connected shops found in shoppers' inboxes in the last " + key.days + " days" +
      (key.found ? "; " + Math.round(key.allRight / key.found * 100) + "% read exactly right." : "."),
    ...(key.notFound ? [plural(key.notFound, "order wasn't", "orders weren't") + " found."] : [])
  ]]);
  const subject = "Relay this morning: " + (look.length ? plural(look.length, "thing needs", "things need") + " a look" : "all well") + ", " + plural(y.kept, "receipt", "receipts") + " yesterday";
  const link = APP_URL + "#open=health";
  const text = "Here's how Relay is doing. Counts only, never anyone's receipts.\n\n" +
    groups.map(([t, lines]) => t + "\n" + lines.map((l) => "- " + l).join("\n")).join("\n\n") +
    "\n\nSee everything on the Relay health page: " + link + "\n\nYou get this because your address is on Relay's admin list.";
  const html = '<p>Here\'s how Relay is doing. Counts only, never anyone\'s receipts.</p>' +
    groups.map(([t, lines]) => '<p style="font-size:16px;font-weight:700;margin:18px 0 6px">' + esc(t) + "</p><ul>" + lines.map((l) => "<li>" + esc(l) + "</li>").join("") + "</ul>").join("") +
    '<p><a href="' + esc(link) + '">Open the Relay health page</a></p><p style="color:#555">You get this because your address is on Relay\'s admin list.</p>';
  return { subject, text, html };
}

async function send(env, to, msg, fetchImpl) {
  if (!env.RESEND_API_KEY || !to.length) return false;
  return fetchImpl("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.RELAY_EMAIL_FROM || DEFAULT_FROM, to, subject: msg.subject, text: msg.text, html: msg.html })
  }).then((r) => r.ok, () => false);
}

// Hourly: the morning summary (once a day, from 8am UK time) and any alerts (each at most once every ALERT_GAP_HOURS).
export async function runHealthEmails(env, now = Date.now(), fetchImpl = fetch) {
  const to = adminAddresses(env);
  if (!env.RELAY_DB || String(env.HEALTH_EMAILS || "").toLowerCase() === "off" || !to.length || !env.RESEND_API_KEY) return { sent: 0, why: "off" };
  await ensureTable(env.RELAY_DB);
  const db = env.RELAY_DB, out = { sent: 0, alerts: [] };
  const alerts = await currentAlerts(env, now);
  for (const a of alerts) {
    const was = await db.prepare("SELECT sent_at FROM health_mail WHERE kind = ?").bind("alert:" + a.kind).first();
    if (was && now - was.sent_at < ALERT_GAP_HOURS * HOUR) continue;
    const msg = { subject: "Relay alert: " + a.title, text: a.text + "\n\nThe Relay health page: " + APP_URL + "#open=health\n\nYou get this because your address is on Relay's admin list.",
      html: "<p><b>" + esc(a.title) + "</b></p><p>" + esc(a.text) + '</p><p><a href="' + esc(APP_URL + "#open=health") + '">Open the Relay health page</a></p>' +
        '<p style="color:#555">You get this because your address is on Relay\'s admin list.</p>' };
    if (await send(env, to, msg, fetchImpl)) {
      await db.prepare("INSERT INTO health_mail (kind, sent_at) VALUES (?, ?) ON CONFLICT (kind) DO UPDATE SET sent_at = excluded.sent_at").bind("alert:" + a.kind, now).run();
      out.sent++; out.alerts.push(a.kind);
    }
  }
  const uk = ukParts(now);
  if (uk.hour >= 8) {
    const was = await db.prepare("SELECT day FROM health_mail WHERE kind = 'digest'").first();
    if (!was || was.day !== uk.day) {
      const msg = digestMessage(await relayHealth(env, { id: "" }, now), alerts);
      if (await send(env, to, msg, fetchImpl)) {
        await db.prepare("INSERT INTO health_mail (kind, sent_at, day) VALUES ('digest', ?, ?) ON CONFLICT (kind) DO UPDATE SET sent_at = excluded.sent_at, day = excluded.day").bind(now, uk.day).run();
        out.sent++; out.digest = true;
      }
    }
  }
  return out;
}

// POST /relay/my/admin/health/email: the summary, now, to the admin asking (to see what it looks like). Null for other paths.
export async function handleHealthEmailRoute(path, method, env, cors, shopper, o) {
  if (path !== "/relay/my/admin/health/email") return null;
  if (!isAdmin(env, shopper) || method !== "POST") return json({ error: "not_found" }, 404, cors);
  const now = (o && o.now) || Date.now(), fetchImpl = (o && o.fetchImpl) || fetch;
  if (!env.RESEND_API_KEY) return json({ error: "email_off" }, 503, cors);
  await ensureTable(env.RELAY_DB);
  const was = await env.RELAY_DB.prepare("SELECT sent_at FROM health_mail WHERE kind = 'manual'").first();
  if (was && now - was.sent_at < MANUAL_GAP) return json({ error: "too_many_requests" }, 429, cors);
  const msg = digestMessage(await relayHealth(env, shopper, now), await currentAlerts(env, now));
  if (!(await send(env, [shopper.email], msg, fetchImpl))) return json({ error: "email_failed" }, 502, cors);
  await env.RELAY_DB.prepare("INSERT INTO health_mail (kind, sent_at) VALUES ('manual', ?) ON CONFLICT (kind) DO UPDATE SET sent_at = excluded.sent_at").bind(now).run();
  return json({ ok: true, to: shopper.email }, 200, cors);
}
