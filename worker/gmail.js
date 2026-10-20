// Gmail connection for Relay: consent record, Google sign-in (OAuth), encrypted token,
// and a scan that reads ONLY order-confirmation / receipt emails.
//
// Rules (do not weaken):
//  * No Gmail access without a recorded consent to the CURRENT wording. The wording
//    shown to the shopper is served from here, so what is recorded is what was shown.
//  * Read-only scope. Relay never sends, deletes or changes mail.
//  * The Google refresh token is stored encrypted (AES-GCM, key derived from AUTH_SECRET).
//  * Full emails are never stored. Only the extracted store/order/date/total/items.
//  * The OAuth "state" is single-use, expires in 10 minutes and is bound to the shopper
//    who started the connection, so a callback can never attach Gmail to someone else.
//  * Everything captured is shopper-supplied evidence: refundEligible is always false.
//  * Disconnect revokes the token at Google and deletes the token and captured receipts.
import { parseReceiptEmail } from "./receipt-parser.js";

export const CONSENT_VERSION = "2026-10-v2";
export const CONSENT_TEXT = [
  "To work, Relay needs to see your online and in-store receipts.",
  "With your permission, Relay reads your Gmail in read-only mode and looks only for order confirmations and receipts.",
  "From each one it keeps the store, order number, date, total and items, plus any return details it contains (return deadline, return address, how to return and any return link). It does not keep the email itself.",
  "Relay never sends email, never deletes or changes anything in your inbox, and never sells or shares what it finds.",
  "You can disconnect Gmail and delete everything Relay has captured at any time, in one tap.",
  "What Relay finds comes from your email, not from the store, so it can track your purchases but cannot start an automatic refund on its own."
];

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_MESSAGES_PER_SCAN = 25;
const SEARCH =
  'newer_than:180d (category:purchases OR subject:("order confirmation" OR "your order" OR receipt OR "thank you for your order"))';
const encoder = new TextEncoder();

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function unb64(text) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
function unb64url(text) {
  const s = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s + "=".repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
}
async function tokenKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode("relay-gmail-token:" + env.AUTH_SECRET));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(env), encoder.encode(plain));
  return { iv: b64(iv), data: b64(new Uint8Array(data)) };
}
async function decrypt(env, iv, data) {
  const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await tokenKey(env), unb64(data));
  return new TextDecoder().decode(out);
}

export function gmailConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
function redirectUri(env, url) {
  return env.GOOGLE_REDIRECT_URI || `${url.origin}/relay/gmail/callback`;
}
function json(body, status = 200, cors = {}) {
  return Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
}

export async function ensureGmailTables(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS shopper_consents (
       shopper_id TEXT NOT NULL, version TEXT NOT NULL, text_hash TEXT NOT NULL,
       accepted_at INTEGER NOT NULL, withdrawn_at INTEGER, PRIMARY KEY (shopper_id, version))`,
    `CREATE TABLE IF NOT EXISTS gmail_connections (
       shopper_id TEXT PRIMARY KEY, google_email TEXT, token_iv TEXT NOT NULL, token_data TEXT NOT NULL,
       connected_at INTEGER NOT NULL, last_scan_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS gmail_oauth_states (
       state_hash TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, created_at INTEGER NOT NULL,
       expires_at INTEGER NOT NULL, used_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS captured_receipts (
       id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, message_ref TEXT NOT NULL, status TEXT NOT NULL,
       details TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (shopper_id, message_ref))`,
    `CREATE INDEX IF NOT EXISTS idx_captured_receipts_shopper ON captured_receipts(shopper_id, created_at)`
  ];
  for (const sql of statements) await db.prepare(sql).run();
}

// Statements that erase everything Gmail-related for a shopper.
export function gmailDeleteStatements(db, shopperId) {
  return [
    db.prepare("DELETE FROM captured_receipts WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM gmail_connections WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM gmail_oauth_states WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM shopper_consents WHERE shopper_id = ?").bind(shopperId)
  ];
}

async function hasConsent(db, shopperId) {
  const row = await db.prepare(
    "SELECT 1 AS ok FROM shopper_consents WHERE shopper_id = ? AND version = ? AND withdrawn_at IS NULL")
    .bind(shopperId, CONSENT_VERSION).first();
  return Boolean(row);
}

async function accessToken(env, refreshToken, fetchImpl) {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: "refresh_token"
    })
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body && body.access_token ? body.access_token : null;
}

async function disconnect(env, shopperId, fetchImpl, { withdraw }) {
  const row = await env.RELAY_DB.prepare(
    "SELECT token_iv, token_data FROM gmail_connections WHERE shopper_id = ?").bind(shopperId).first();
  let revoked = false;
  if (row) {
    try {
      const refresh = await decrypt(env, row.token_iv, row.token_data);
      const res = await fetchImpl("https://oauth2.googleapis.com/revoke", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refresh })
      });
      revoked = res.ok;
    } catch { revoked = false; }
  }
  const statements = [
    env.RELAY_DB.prepare("DELETE FROM captured_receipts WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM gmail_connections WHERE shopper_id = ?").bind(shopperId)
  ];
  if (withdraw) statements.push(env.RELAY_DB.prepare(
    "UPDATE shopper_consents SET withdrawn_at = ? WHERE shopper_id = ? AND withdrawn_at IS NULL").bind(Date.now(), shopperId));
  await env.RELAY_DB.batch(statements);
  return { deleted: true, revokedAtGoogle: revoked };
}

async function scan(env, shopperId, fetchImpl, now) {
  const row = await env.RELAY_DB.prepare(
    "SELECT token_iv, token_data FROM gmail_connections WHERE shopper_id = ?").bind(shopperId).first();
  if (!row) return { status: 409, body: { error: "gmail_not_connected" } };
  const refresh = await decrypt(env, row.token_iv, row.token_data);
  const token = await accessToken(env, refresh, fetchImpl);
  if (!token) return { status: 401, body: { error: "gmail_reconnect_needed" } };
  const auth = { Authorization: "Bearer " + token };
  const list = await fetchImpl(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=" + MAX_MESSAGES_PER_SCAN + "&q=" + encodeURIComponent(SEARCH),
    { headers: auth });
  if (!list.ok) return { status: 502, body: { error: "gmail_unavailable" } };
  const messages = ((await list.json().catch(() => ({}))).messages || []).slice(0, MAX_MESSAGES_PER_SCAN);
  let added = 0, skipped = 0, ignored = 0, updated = 0;
  for (const m of messages) {
    if (typeof m.id !== "string" || !/^[A-Za-z0-9]{6,40}$/.test(m.id)) continue;
    const ref = await sha256Hex("gmail:" + m.id);
    const seen = await env.RELAY_DB.prepare(
      "SELECT details FROM captured_receipts WHERE shopper_id = ? AND message_ref = ?").bind(shopperId, ref).first();
    // Receipts captured before return details existed are re-read once to add them.
    const needsReturns = seen && !Object.prototype.hasOwnProperty.call(JSON.parse(seen.details), "returns");
    if (seen && !needsReturns) { skipped++; continue; }
    const res = await fetchImpl(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=raw`, { headers: auth });
    if (!res.ok) continue;
    const raw = (await res.json().catch(() => ({}))).raw;
    if (typeof raw !== "string") continue;
    const parsed = parseReceiptEmail(new TextDecoder().decode(unb64url(raw)));
    if (!parsed.ok) { ignored++; continue; }
    // Keep only extracted fields. The email text is dropped here.
    const details = {
      retailer: parsed.retailer, orderRef: parsed.orderRef, orderDate: parsed.orderDate, currency: parsed.currency,
      totalPence: parsed.totalPence, items: parsed.items, confidence: parsed.confidence,
      needsShopperConfirmation: parsed.needsShopperConfirmation, method: parsed.method, returns: parsed.returns,
      source: "shopper_email", refundEligible: false
    };
    if (needsReturns) {
      // Keep what the shopper may already have confirmed; only add the new return details.
      const prev = JSON.parse(seen.details);
      await env.RELAY_DB.prepare("UPDATE captured_receipts SET details = ? WHERE shopper_id = ? AND message_ref = ?")
        .bind(JSON.stringify({ ...prev, returns: parsed.returns }), shopperId, ref).run();
      updated++;
      continue;
    }
    await env.RELAY_DB.prepare(
      "INSERT OR IGNORE INTO captured_receipts (id,shopper_id,message_ref,status,details,created_at) VALUES (?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), shopperId, ref, "pending", JSON.stringify(details), now).run();
    added++;
  }
  await env.RELAY_DB.prepare("UPDATE gmail_connections SET last_scan_at = ? WHERE shopper_id = ?").bind(now, shopperId).run();
  return { status: 200, body: { ok: true, added, updated, alreadyCaptured: skipped, notReceipts: ignored } };
}

async function listReceipts(env, shopperId) {
  const rows = await env.RELAY_DB.prepare(
    "SELECT id, status, details, created_at AS createdAt FROM captured_receipts WHERE shopper_id = ? AND status != 'dismissed' ORDER BY created_at DESC LIMIT 100")
    .bind(shopperId).all();
  return (rows.results || []).map(r => ({ id: r.id, status: r.status, createdAt: r.createdAt, ...JSON.parse(r.details) }));
}

// Google redirects the browser here. No bearer token is available, so the single-use
// state (bound to the shopper who began the flow) is the only thing that identifies them.
export async function handleGmailCallback(request, env, url, opts) {
  const appUrl = String(env.RELAY_APP_URL || opts.appUrl).split("#")[0];
  const back = result => Response.redirect(appUrl + "#gmail=" + result, 302);
  if (!gmailConfigured(env)) return back("not_configured");
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !/^[A-Za-z0-9_-]{43}$/.test(state)) return back("failed");
  const claimed = await env.RELAY_DB.prepare(
    `UPDATE gmail_oauth_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING shopper_id`)
    .bind(opts.now, await sha256Hex(state), opts.now).first();
  if (!claimed) return back("failed");
  if (!(await hasConsent(env.RELAY_DB, claimed.shopper_id))) return back("consent_needed");
  const res = await opts.fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(env, url), grant_type: "authorization_code"
    })
  });
  const tokens = res.ok ? await res.json().catch(() => null) : null;
  if (!tokens || !tokens.refresh_token) return back("failed");
  if (!String(tokens.scope || "").split(" ").includes(SCOPE)) return back("failed");
  let googleEmail = null;
  try {
    const p = await opts.fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: "Bearer " + tokens.access_token } });
    if (p.ok) googleEmail = (await p.json()).emailAddress || null;
  } catch { googleEmail = null; }
  const enc = await encrypt(env, tokens.refresh_token);
  await env.RELAY_DB.prepare(
    `INSERT INTO gmail_connections (shopper_id,google_email,token_iv,token_data,connected_at) VALUES (?,?,?,?,?)
     ON CONFLICT(shopper_id) DO UPDATE SET google_email=excluded.google_email, token_iv=excluded.token_iv,
       token_data=excluded.token_data, connected_at=excluded.connected_at, last_scan_at=NULL`)
    .bind(claimed.shopper_id, googleEmail, enc.iv, enc.data, opts.now).run();
  return back("connected");
}

// Routes for a signed-in shopper. Returns a Response, or null if the path is not ours.
export async function handleGmailRoute(request, env, url, cors, shopper, opts) {
  const path = url.pathname;
  const m = request.method;
  if (path === "/relay/my/consent" && m === "GET") {
    return json({ version: CONSENT_VERSION, text: CONSENT_TEXT, accepted: await hasConsent(env.RELAY_DB, shopper.id),
      gmailAvailable: gmailConfigured(env) }, 200, cors);
  }
  if (path === "/relay/my/consent" && m === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || body.version !== CONSENT_VERSION) return json({ error: "consent_version_mismatch" }, 400, cors);
    await env.RELAY_DB.prepare(
      `INSERT INTO shopper_consents (shopper_id,version,text_hash,accepted_at) VALUES (?,?,?,?)
       ON CONFLICT(shopper_id,version) DO UPDATE SET accepted_at=excluded.accepted_at, withdrawn_at=NULL, text_hash=excluded.text_hash`)
      .bind(shopper.id, CONSENT_VERSION, await sha256Hex(CONSENT_TEXT.join("\n")), opts.now).run();
    return json({ ok: true }, 200, cors);
  }
  if (path === "/relay/my/consent/withdraw" && m === "POST") {
    return json({ ok: true, ...(await disconnect(env, shopper.id, opts.fetchImpl, { withdraw: true })) }, 200, cors);
  }
  if (path === "/relay/my/gmail/connect" && m === "POST") {
    if (!gmailConfigured(env)) return json({ error: "gmail_not_configured" }, 503, cors);
    if (!(await hasConsent(env.RELAY_DB, shopper.id))) return json({ error: "consent_required" }, 403, cors);
    const state = randomToken();
    await env.RELAY_DB.prepare("DELETE FROM gmail_oauth_states WHERE expires_at <= ?").bind(opts.now).run();
    await env.RELAY_DB.prepare(
      "INSERT INTO gmail_oauth_states (state_hash,shopper_id,created_at,expires_at) VALUES (?,?,?,?)")
      .bind(await sha256Hex(state), shopper.id, opts.now, opts.now + STATE_TTL_MS).run();
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(env, url), response_type: "code", scope: SCOPE,
      access_type: "offline", prompt: "consent", include_granted_scopes: "false", state, login_hint: shopper.email
    });
    return json({ url: "https://accounts.google.com/o/oauth2/v2/auth?" + params }, 200, cors);
  }
  if (path === "/relay/my/gmail" && m === "GET") {
    const c = await env.RELAY_DB.prepare(
      "SELECT google_email AS googleEmail, connected_at AS connectedAt, last_scan_at AS lastScanAt FROM gmail_connections WHERE shopper_id = ?")
      .bind(shopper.id).first();
    return json({ connected: Boolean(c), ...(c || {}) }, 200, cors);
  }
  if (path === "/relay/my/gmail/scan" && m === "POST") {
    if (!(await hasConsent(env.RELAY_DB, shopper.id))) return json({ error: "consent_required" }, 403, cors);
    const r = await scan(env, shopper.id, opts.fetchImpl, opts.now);
    return json(r.body, r.status, cors);
  }
  if (path === "/relay/my/gmail/disconnect" && m === "POST") {
    return json({ ok: true, ...(await disconnect(env, shopper.id, opts.fetchImpl, { withdraw: false })) }, 200, cors);
  }
  if (path === "/relay/my/receipts" && m === "GET") {
    return json({ receipts: await listReceipts(env, shopper.id) }, 200, cors);
  }
  const act = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/(confirm|dismiss)$/.exec(path);
  if (act && m === "POST") {
    const res = await env.RELAY_DB.prepare(
      "UPDATE captured_receipts SET status = ? WHERE id = ? AND shopper_id = ? RETURNING id")
      .bind(act[2] === "confirm" ? "confirmed" : "dismissed", act[1], shopper.id).first();
    return res ? json({ ok: true }, 200, cors) : json({ error: "not_found" }, 404, cors);
  }
  return null;
}
