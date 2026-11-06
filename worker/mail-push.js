// Instant email: Gmail and Outlook tell Relay the moment a connected inbox gets new mail, so a receipt shows within seconds
// instead of waiting for the 15-minute check. That check reads only 3 inboxes a round, so on its own it gets slower as Relay
// grows; notices take the same few seconds for 10 shoppers or 100,000.
//
// Gmail (developers.google.com/gmail/api/guides/push): Relay asks Gmail to watch each connected inbox's INBOX (users.watch).
// Gmail publishes a notice to a Google Cloud Pub/Sub topic in Relay's own Google Cloud project, and a push subscription posts
// it to /relay/webhooks/gmail with a token Google signs for the subscription's service account. Anything without that token
// is refused. A notice says only which mailbox changed (its address and a history number), never anything about an email.
// A watch lapses after 7 days, so Relay renews each one about once a day.
//
// Outlook (learn.microsoft.com/graph/outlook-change-notifications-overview): Relay subscribes to new messages in each
// connected mailbox. Microsoft posts a notice to /relay/webhooks/outlook carrying the subscription's id and the secret Relay
// chose for it (clientState), and a notice without the right secret is ignored. It says nothing about the email either.
// Subscriptions last under 7 days; Relay renews each one about once a day and acts on Microsoft's lifecycle notices.
//
// A notice makes Relay read that inbox's newest mail at once, with the same reader, rules and search as every other read
// (scanNewMail in gmail.js), so nothing beyond receipts, orders, returns and parcel emails is opened. One read runs per
// inbox at a time; notices that arrive during a read are read straight after, or by the next minute's run.
// The 15-minute check stays as a safety net: Google says notices can be late or dropped.
//
// Off until set up: Gmail needs GMAIL_PUSH_TOPIC ("projects/<project>/topics/<topic>") and GMAIL_PUSH_SERVICE_ACCOUNT (the
// push subscription's service account), see docs/MAIL_PUSH_SETUP.md. Outlook needs nothing new. MAIL_PUSH = "off" stops both.
import { CONSENT_VERSION, outlookConfigured, ensureGmailTables, ensurePushColumns, accessTokenFor, scanNewMail } from "./gmail.js";

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const DEFAULT_API = "https://relay-square-api2.9pts72cy5j.workers.dev";
export const GMAIL_PATH = "/relay/webhooks/gmail";
export const OUTLOOK_PATH = "/relay/webhooks/outlook";
export const OUTLOOK_LIFECYCLE_PATH = "/relay/webhooks/outlook/lifecycle";
export const PUSH_PATHS = [GMAIL_PATH, OUTLOOK_PATH, OUTLOOK_LIFECYCLE_PATH];
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const GRAPH = "https://graph.microsoft.com/v1.0";
const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";

export const RENEW_WHEN_LEFT = 6 * DAY;       // a watch or subscription is renewed once it has less than this left: about daily
export const OUTLOOK_LIFETIME = 6.9 * DAY;    // Microsoft allows just under 7 days (10,080 minutes) for mail
export const RETRY_AFTER = 2 * HOUR;          // after a failed set-up or renewal, that inbox is tried again this much later
export const RECHECK_MS = 45 * 1000;          // Gmail's search can take a moment to include a brand-new email: one second look
const RENEW_PER_RUN = 60, PENDING_PER_RUN = 12, AT_ONCE = 6;
const LEASE_MS = 90 * 1000;                   // one read of an inbox at a time; a read that died lets go after this
const MAX_BODY = 64 * 1024, MAX_NOTICES = 50;
const HISTORY_ID = /^\d{1,30}$/;
const GMAIL_MSG_ID = /^[A-Za-z0-9]{6,40}$/;
const SUBSCRIPTION_ID = /^[A-Za-z0-9-]{8,100}$/;
const OWNER = "(CASE WHEN instr(g.shopper_id, '~') > 0 THEN substr(g.shopper_id, 1, instr(g.shopper_id, '~') - 1) ELSE g.shopper_id END)";
const CONSENTED = `EXISTS (SELECT 1 FROM shopper_consents c WHERE c.shopper_id = ${OWNER} AND c.version = ? AND c.withdrawn_at IS NULL)`;
const NO_JOB = "NOT EXISTS (SELECT 1 FROM mail_scan_jobs j WHERE j.shopper_id = g.shopper_id AND j.state = 'running')";

export const mailPushOff = (env) => String((env && env.MAIL_PUSH) || "").toLowerCase() === "off";
export const gmailPushOn = (env) => Boolean(env) && !mailPushOff(env) &&
  /^projects\/[a-z][a-z0-9-]{4,61}[a-z0-9]\/topics\/[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/.test(String(env.GMAIL_PUSH_TOPIC || "")) &&
  /^[^@\s]{1,100}@[^@\s]{1,200}$/.test(String(env.GMAIL_PUSH_SERVICE_ACCOUNT || ""));
export const outlookPushOn = (env) => Boolean(env) && !mailPushOff(env) && outlookConfigured(env);
const apiOrigin = (env) => String(env.RELAY_API_ORIGIN || DEFAULT_API).replace(/\/+$/, "");
const fetcher = (o) => o.fetchImpl || ((...a) => fetch(...a));
const clockOf = (o) => (typeof o.now === "function" ? o.now : () => o.now || Date.now());
const later = (ctx, p) => { const q = Promise.resolve(p).catch(e => console.error("instant email", String(e && e.message || e).slice(0, 120))); try { if (ctx && ctx.waitUntil) ctx.waitUntil(q); } catch { /* not in a Worker: it simply runs */ } return q; };

function b64Bytes(s) {
  const t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "===".slice((t.length + 3) % 4)), c => c.charCodeAt(0));
}
async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text))));
  return Array.from(d, b => b.toString(16).padStart(2, "0")).join("");
}
function randomSecret() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// A notice's body, read only up to a size no real notice comes near; anything bigger is turned away unread.
async function readCapped(request, limit) {
  const len = Number(request.headers.get("content-length"));
  if (Number.isFinite(len) && len > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader(), parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { try { await reader.cancel(); } catch { /* gone */ } return null; }
    parts.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(all); } catch { return null; }
}

// ---- Is this really Google? ----
// Pub/Sub signs each push with a short-lived token (an OpenID Connect ID token) for the subscription's service account.
// Relay checks Google's signature with Google's published keys, then that the token was made for Relay's address and for
// that service account, and is in date.
let certs = { keys: new Map(), until: 0, fetchedAt: 0 };
export function resetGoogleKeys() { certs = { keys: new Map(), until: 0, fetchedAt: 0 }; }
async function googleKey(kid, f, now) {
  const stale = certs.until < now, missing = !certs.keys.has(kid);
  // A key Relay hasn't seen means Google may have started using a new one: its list is read again, at most once a minute.
  if (stale || (missing && certs.fetchedAt < now - MIN)) {
    const r = await f(GOOGLE_CERTS, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const j = await r.json().catch(() => null);
      const keys = new Map();
      for (const k of (j && Array.isArray(j.keys) ? j.keys : [])) {
        if (k && k.kty === "RSA" && typeof k.kid === "string" && typeof k.n === "string" && typeof k.e === "string") keys.set(k.kid, k);
      }
      const age = Number((/max-age=(\d+)/.exec(r.headers.get("cache-control") || "") || [])[1] || 3600);
      certs = { keys, until: now + Math.min(Math.max(age, 60), 6 * 3600) * 1000, fetchedAt: now };
    } else certs.fetchedAt = now;
  }
  const jwk = certs.keys.get(kid);
  if (!jwk) return null;
  return crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}
export async function verifyPubSubToken(env, header, f, now) {
  const m = /^Bearer ([A-Za-z0-9_-]{10,2000})\.([A-Za-z0-9_-]{10,6000})\.([A-Za-z0-9_-]{40,1200})$/.exec(String(header || ""));
  if (!m) return false;
  let head, claims;
  try {
    head = JSON.parse(new TextDecoder().decode(b64Bytes(m[1])));
    claims = JSON.parse(new TextDecoder().decode(b64Bytes(m[2])));
  } catch { return false; }
  if (!head || head.alg !== "RS256" || typeof head.kid !== "string" || head.kid.length > 200 || !claims || typeof claims !== "object") return false;
  const key = await googleKey(head.kid, f, now).catch(() => null);
  if (!key) return false;
  const signed = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64Bytes(m[3]), new TextEncoder().encode(m[1] + "." + m[2])).catch(() => false);
  if (!signed) return false;
  const sec = now / 1000;
  const issuer = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  const audience = String(env.GMAIL_PUSH_AUDIENCE || apiOrigin(env) + GMAIL_PATH);
  return issuer && claims.aud === audience && claims.email === String(env.GMAIL_PUSH_SERVICE_ACCOUNT) && claims.email_verified === true &&
    Number(claims.exp) + 60 > sec && Number(claims.iat) < sec + 300;
}

// The two things a Gmail notice says: which mailbox, and its history number.
export function parseGmailNotice(raw) {
  let body;
  try { body = JSON.parse(raw); } catch { return null; }
  const data = body && body.message && typeof body.message.data === "string" && body.message.data.length <= 4000 ? body.message.data : null;
  if (!data) return null;
  let n;
  try { n = JSON.parse(new TextDecoder().decode(b64Bytes(data))); } catch { return null; }
  const email = String((n && n.emailAddress) || "").trim().toLowerCase(), historyId = String((n && n.historyId) || "");
  if (email.length > 320 || !/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email) || !HISTORY_ID.test(historyId)) return null;
  return { email, historyId };
}

// ---- Receiving notices ----
export async function handleMailPushRoute(request, env, url, ctx, o = {}) {
  if (!PUSH_PATHS.includes(url.pathname)) return null;
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
  if (url.pathname === GMAIL_PATH) return gmailNotice(request, env, ctx, o);
  return outlookNotice(request, env, url, ctx, o, url.pathname === OUTLOOK_LIFECYCLE_PATH);
}

async function gmailNotice(request, env, ctx, o) {
  if (!gmailPushOn(env) || !env.RELAY_DB) return new Response(null, { status: 404 });
  const f = fetcher(o), now = clockOf(o)();
  if (!(await verifyPubSubToken(env, request.headers.get("authorization"), f, now))) return new Response(null, { status: 401 });
  const raw = await readCapped(request, MAX_BODY);
  const notice = raw === null ? null : parseGmailNotice(raw);
  // Signed by Google but not something Relay can use: accepted anyway, or Pub/Sub would only send it again and again.
  if (!notice) return new Response(null, { status: 204 });
  const db = env.RELAY_DB;
  await ensureGmailTables(db);
  await ensurePushColumns(db);
  const rows = (await db.prepare(`SELECT g.shopper_id AS id, g.push_history AS history FROM gmail_connections g
      WHERE g.provider IS NULL AND lower(g.google_email) = ? AND ${CONSENTED}`).bind(notice.email, CONSENT_VERSION).all()).results || [];
  for (const r of rows) {
    // Gmail's history numbers only go up: a notice no newer than what Relay has already read adds nothing.
    if (r.history && HISTORY_ID.test(r.history) && BigInt(notice.historyId) <= BigInt(r.history)) continue;
    await db.prepare("UPDATE gmail_connections SET push_at = ? WHERE shopper_id = ?").bind(now, r.id).run();
    later(ctx, pushRead(env, r.id, o));
  }
  return new Response(null, { status: 204 });
}

async function outlookNotice(request, env, url, ctx, o, lifecycle) {
  if (!outlookPushOn(env) || !env.RELAY_DB) return new Response(null, { status: 404 });
  // When a subscription is made, Microsoft checks the address by sending a token it must get straight back, as plain text.
  const check = url.searchParams.get("validationToken");
  if (check !== null) {
    return new Response(check.slice(0, 2048), { status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }
  const raw = await readCapped(request, MAX_BODY);
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  const items = body && Array.isArray(body.value) ? body.value.slice(0, MAX_NOTICES) : [];
  const db = env.RELAY_DB, now = clockOf(o)();
  await ensureGmailTables(db);
  await ensurePushColumns(db);
  const toRead = new Set(), toRenew = new Set(), rows = new Map();
  for (const n of items) {
    if (!n || typeof n !== "object" || !SUBSCRIPTION_ID.test(String(n.subscriptionId || "")) || typeof n.clientState !== "string" || n.clientState.length > 255) continue;
    // Microsoft often sends several notices for one mailbox together: it's looked up once.
    if (!rows.has(n.subscriptionId)) rows.set(n.subscriptionId, await db.prepare(`SELECT g.shopper_id AS id, g.push_secret AS secret FROM gmail_connections g
        WHERE g.provider = 'microsoft' AND g.push_ref = ? AND ${CONSENTED}`).bind(n.subscriptionId, CONSENT_VERSION).first());
    const row = rows.get(n.subscriptionId);
    // Not one of Relay's subscriptions, or without the secret only Microsoft and Relay know: ignored.
    if (!row || !row.secret || row.secret !== await sha256Hex(n.clientState)) continue;
    if (!lifecycle) { toRead.add(row.id); continue; }
    const event = String(n.lifecycleEvent || "");
    if (event === "reauthorizationRequired") toRenew.add(row.id);
    else if (event === "subscriptionRemoved") {
      // Microsoft ended it: a new one is made by the next minute's run.
      await db.prepare("UPDATE gmail_connections SET push_ref = NULL, push_secret = NULL, push_expires_at = NULL, push_tried_at = NULL WHERE shopper_id = ?").bind(row.id).run();
    } else if (event === "missed") toRead.add(row.id);
  }
  for (const id of toRead) {
    await db.prepare("UPDATE gmail_connections SET push_at = ? WHERE shopper_id = ?").bind(now, id).run();
    later(ctx, pushRead(env, id, o));
  }
  for (const id of toRenew) later(ctx, renewOne(env, id, o));
  return new Response(null, { status: 202 });
}

// ---- Reading an inbox for its notices ----
// What's new in a Gmail inbox since a history number: the ids of messages added to its INBOX, and the newest history number.
// (A notice also comes when an email is read, starred or moved; those add nothing and need no read.)
async function gmailAdded(f, token, startHistoryId) {
  const ids = [];
  let page = "", latest = null;
  for (let i = 0; i < 3; i++) {
    const r = await f(GMAIL_API + "/history?startHistoryId=" + startHistoryId + "&historyTypes=messageAdded&labelId=INBOX&maxResults=100" +
      (page ? "&pageToken=" + encodeURIComponent(page) : ""), { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(10000) });
    // Gmail keeps about a week of history: from an older starting point, Relay simply reads the newest mail.
    if (r.status === 404) return { stale: true };
    if (!r.ok) return { failed: true };
    const j = await r.json().catch(() => ({}));
    for (const h of Array.isArray(j.history) ? j.history : []) {
      for (const a of Array.isArray(h && h.messagesAdded) ? h.messagesAdded : []) if (a && a.message && GMAIL_MSG_ID.test(String(a.message.id || ""))) ids.push(a.message.id);
    }
    if (HISTORY_ID.test(String(j.historyId || ""))) latest = String(j.historyId);
    page = typeof j.nextPageToken === "string" && /^[A-Za-z0-9_-]{1,300}$/.test(j.nextPageToken) ? j.nextPageToken : "";
    if (!page) break;
  }
  return { ids, latest, more: Boolean(page) };
}
async function gmailCurrentHistory(f, token) {
  const r = await f(GMAIL_API + "/profile", { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(10000) }).catch(() => null);
  const j = r && r.ok ? await r.json().catch(() => ({})) : {};
  return HISTORY_ID.test(String(j.historyId || "")) ? String(j.historyId) : null;
}

// Reads one inbox for its notices. A short lease means one read at a time per inbox (the 15-minute check and the shopper's
// own scans keep out of its way too). Notices that came while it was reading are read in another round straight after.
export async function pushRead(env, boxId, o = {}) {
  const db = env.RELAY_DB, f = fetcher(o), clock = clockOf(o);
  await ensurePushColumns(db);
  const owner = String(boxId).split("~")[0], out = { reads: 0, added: 0, skipped: 0 };
  for (let round = 0; round < 3; round++) {
    const started = clock();
    const got = await db.prepare(`UPDATE gmail_connections SET push_lease = ? WHERE shopper_id = ? AND (push_lease IS NULL OR push_lease < ?)
        AND EXISTS (SELECT 1 FROM shopper_consents c WHERE c.shopper_id = ? AND c.version = ? AND c.withdrawn_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM mail_scan_jobs j WHERE j.shopper_id = gmail_connections.shopper_id AND j.state = 'running')
        RETURNING provider, push_history AS history, push_recheck_at AS recheckAt, push_at AS pushAt, push_scan_at AS scanAt`)
      .bind(started + LEASE_MS, boxId, started, owner, CONSENT_VERSION).first();
    // Being read already (that read carries on with this notice), or a scan the shopper started is going: the minute's run
    // picks it up afterwards.
    if (!got) { if (round === 0) out.busy = true; return out; }
    let history = HISTORY_ID.test(String(got.history || "")) ? String(got.history) : null, recheckAt = null, error = null;
    // A second look is just a read; but with a new notice waiting, the round is an ordinary one (and plans its own second look).
    const recheck = Boolean(got.recheckAt && got.recheckAt <= started) && !(got.pushAt > (got.scanAt || 0));
    try {
      let read = true;
      if (got.provider !== "microsoft" && !recheck) {
        const t = await accessTokenFor(env, boxId, f);
        if (!t) { read = false; error = "reconnect_needed"; }
        else if (history) {
          const added = await gmailAdded(f, t.token, history);
          if (added.ids) {
            if (added.latest) history = added.latest;
            if (!added.ids.length && !added.more) read = false;
            else recheckAt = started + RECHECK_MS;
          } else {
            if (added.stale) history = await gmailCurrentHistory(f, t.token) || history;
            recheckAt = started + RECHECK_MS;
          }
        } else {
          history = await gmailCurrentHistory(f, t.token);
          recheckAt = started + RECHECK_MS;
        }
      }
      if (read) {
        const r = await scanNewMail(env, boxId, f, started);
        out.reads++;
        if (r.status === 200) out.added += (r.body && r.body.added) || 0;
        else error = String((r.body && r.body.error) || r.status).slice(0, 60);
      } else out.skipped++;
    } catch (e) { error = String(e && e.message || e).slice(0, 60); }
    // A read counts as a check (the app's "Last checked", and the 15-minute check goes to inboxes that need it more).
    await db.prepare(`UPDATE gmail_connections SET push_lease = NULL, push_scan_at = ?, push_history = ?, push_error = ?,
        auto_at = CASE WHEN ? = 1 THEN ? ELSE auto_at END,
        push_recheck_at = CASE WHEN ? IS NOT NULL THEN ? WHEN ? = 1 THEN NULL ELSE push_recheck_at END WHERE shopper_id = ?`)
      .bind(started, history, error, out.reads ? 1 : 0, started, recheckAt, recheckAt, recheck ? 1 : 0, boxId).run();
    const after = await db.prepare("SELECT push_at FROM gmail_connections WHERE shopper_id = ?").bind(boxId).first();
    if (!after || !(after.push_at > started)) break;
  }
  return out;
}

// Every minute: inboxes with a notice not yet read (it came during another read, or during a scan the shopper started), and
// Gmail's second looks that are due.
export async function runPendingPush(env, o = {}) {
  const db = env.RELAY_DB;
  if (!db || (!gmailPushOn(env) && !outlookPushOn(env))) return { read: 0 };
  const now = clockOf(o)();
  await ensureGmailTables(db);
  await ensurePushColumns(db);
  const rows = (await db.prepare(`SELECT g.shopper_id AS id FROM gmail_connections g
      WHERE (g.push_at > COALESCE(g.push_scan_at, 0) OR g.push_recheck_at <= ?) AND (g.push_lease IS NULL OR g.push_lease < ?)
        AND ${NO_JOB} AND ${CONSENTED}
      ORDER BY COALESCE(g.push_at, g.push_recheck_at) LIMIT ?`).bind(now, now, CONSENT_VERSION, PENDING_PER_RUN).all()).results || [];
  let read = 0;
  for (let i = 0; i < rows.length; i += AT_ONCE) {
    const done = await Promise.all(rows.slice(i, i + AT_ONCE).map(r => pushRead(env, r.id, o).catch(() => ({ reads: 0 }))));
    read += done.reduce((n, d) => n + (d.reads || 0), 0);
  }
  return { checked: rows.length, read };
}

// ---- Setting up and renewing ----
async function watchGmail(env, boxId, f, now) {
  const t = await accessTokenFor(env, boxId, f);
  if (!t) return { ok: false, error: "reconnect_needed" };
  const ask = (body) => f(GMAIL_API + "/watch", { method: "POST", headers: { Authorization: "Bearer " + t.token, "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  let r = await ask({ topicName: env.GMAIL_PUSH_TOPIC, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" });
  // labelFilterBehavior is Gmail's newer name for "only these labels"; if it isn't taken, the INBOX list alone does the same.
  if (r.status === 400) r = await ask({ topicName: env.GMAIL_PUSH_TOPIC, labelIds: ["INBOX"] });
  if (!r.ok) return { ok: false, error: "gmail_" + r.status };
  const j = await r.json().catch(() => ({}));
  const exp = Number(j.expiration);
  if (!Number.isFinite(exp) || exp <= now) return { ok: false, error: "gmail_reply" };
  const history = HISTORY_ID.test(String(j.historyId || "")) ? String(j.historyId) : null;
  await env.RELAY_DB.prepare("UPDATE gmail_connections SET push_expires_at = ?, push_tried_at = ?, push_error = NULL, push_history = COALESCE(push_history, ?) WHERE shopper_id = ?")
    .bind(exp, now, history, boxId).run();
  return { ok: true };
}
async function subscribeOutlook(env, boxId, ref, f, now) {
  const t = await accessTokenFor(env, boxId, f);
  if (!t) return { ok: false, error: "reconnect_needed" };
  const headers = { Authorization: "Bearer " + t.token, "content-type": "application/json" };
  const expires = new Date(now + OUTLOOK_LIFETIME).toISOString();
  const expiry = (j) => { const e = Date.parse(j && j.expirationDateTime); return Number.isFinite(e) && e > now ? e : now + OUTLOOK_LIFETIME; };
  if (ref && SUBSCRIPTION_ID.test(ref)) {
    const r = await f(GRAPH + "/subscriptions/" + encodeURIComponent(ref), { method: "PATCH", headers, body: JSON.stringify({ expirationDateTime: expires }), signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      await env.RELAY_DB.prepare("UPDATE gmail_connections SET push_expires_at = ?, push_tried_at = ?, push_error = NULL WHERE shopper_id = ?")
        .bind(expiry(await r.json().catch(() => ({}))), now, boxId).run();
      return { ok: true, renewed: true };
    }
    // Gone at Microsoft's end: a new one is made below. Anything else is tried again later.
    if (r.status !== 404) return { ok: false, error: "outlook_" + r.status };
  }
  const api = apiOrigin(env), secret = randomSecret();
  const r = await f(GRAPH + "/subscriptions", { method: "POST", headers, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ changeType: "created", notificationUrl: api + OUTLOOK_PATH, lifecycleNotificationUrl: api + OUTLOOK_LIFECYCLE_PATH,
      resource: "me/messages", expirationDateTime: expires, clientState: secret }) });
  if (!r.ok) return { ok: false, error: "outlook_" + r.status };
  const j = await r.json().catch(() => ({}));
  if (!SUBSCRIPTION_ID.test(String(j.id || ""))) return { ok: false, error: "outlook_reply" };
  // Only a hash of the secret is kept: enough to recognise it on a notice, useless to anyone who reads the database.
  await env.RELAY_DB.prepare("UPDATE gmail_connections SET push_ref = ?, push_secret = ?, push_expires_at = ?, push_tried_at = ?, push_error = NULL WHERE shopper_id = ?")
    .bind(j.id, await sha256Hex(secret), expiry(j), now, boxId).run();
  return { ok: true, created: true };
}
async function renewOne(env, boxId, o = {}) {
  const db = env.RELAY_DB, f = fetcher(o), now = clockOf(o)();
  const row = await db.prepare("SELECT provider, push_ref AS ref FROM gmail_connections WHERE shopper_id = ?").bind(boxId).first();
  if (!row) return { ok: false, error: "gone" };
  const res = await (row.provider === "microsoft" ? (outlookPushOn(env) ? subscribeOutlook(env, boxId, row.ref, f, now) : { ok: false, error: "off" })
    : (gmailPushOn(env) ? watchGmail(env, boxId, f, now) : { ok: false, error: "off" }))
    .catch(e => ({ ok: false, error: String(e && e.message || e).slice(0, 60) }));
  if (!res.ok) await db.prepare("UPDATE gmail_connections SET push_tried_at = ?, push_error = ? WHERE shopper_id = ?").bind(now, String(res.error).slice(0, 60), boxId).run();
  return res;
}

// Every minute: new inboxes get a watch or subscription, and ones with under 6 days left are renewed (about once a day each).
export async function renewMailPush(env, o = {}) {
  const db = env.RELAY_DB;
  const gmail = gmailPushOn(env), outlook = outlookPushOn(env);
  if (!db || (!gmail && !outlook)) return { renewed: 0, failed: 0 };
  const now = clockOf(o)();
  await ensureGmailTables(db);
  await ensurePushColumns(db);
  const rows = (await db.prepare(`SELECT g.shopper_id AS id FROM gmail_connections g
      WHERE ((g.provider IS NULL AND ? = 1) OR (g.provider = 'microsoft' AND ? = 1))
        AND (g.push_expires_at IS NULL OR g.push_expires_at < ?) AND (g.push_tried_at IS NULL OR g.push_tried_at < ?) AND ${CONSENTED}
      ORDER BY COALESCE(g.push_expires_at, 0), g.connected_at LIMIT ?`)
    .bind(gmail ? 1 : 0, outlook ? 1 : 0, now + RENEW_WHEN_LEFT, now - RETRY_AFTER, CONSENT_VERSION, RENEW_PER_RUN).all()).results || [];
  let renewed = 0, failed = 0;
  for (let i = 0; i < rows.length; i += AT_ONCE) {
    const done = await Promise.all(rows.slice(i, i + AT_ONCE).map(r => renewOne(env, r.id, { ...o, now })));
    for (const d of done) if (d.ok) renewed++; else failed++;
  }
  return { renewed, failed };
}

// Disconnecting an inbox (or deleting the account): its watch or subscription is ended first, while Relay still can.
export async function stopMailPush(env, boxId, fetchImpl) {
  const db = env.RELAY_DB;
  if (!db) return;
  await ensurePushColumns(db);
  const row = await db.prepare("SELECT provider, push_ref AS ref, push_expires_at AS exp FROM gmail_connections WHERE shopper_id = ?").bind(boxId).first();
  if (!row || !row.exp) return;
  const f = fetchImpl || ((...a) => fetch(...a));
  const t = await accessTokenFor(env, boxId, f);
  if (t) {
    if (row.provider === "microsoft") {
      if (row.ref && SUBSCRIPTION_ID.test(row.ref)) await f(GRAPH + "/subscriptions/" + encodeURIComponent(row.ref), { method: "DELETE", headers: { Authorization: "Bearer " + t.token }, signal: AbortSignal.timeout(5000) });
    } else await f(GMAIL_API + "/stop", { method: "POST", headers: { Authorization: "Bearer " + t.token }, signal: AbortSignal.timeout(5000) });
  }
  await db.prepare("UPDATE gmail_connections SET push_expires_at = NULL, push_ref = NULL, push_secret = NULL WHERE shopper_id = ?").bind(boxId).run();
}
