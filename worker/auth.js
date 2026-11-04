// Shopper sign-in by emailed one-time link, plus "my purchases" ownership.
//
// Design rules (do not weaken):
//  * No passwords. A shopper proves they own an email address by opening a single-use link.
//  * Link tokens and session tokens are random; only their SHA-256 hash is stored.
//  * A purchase belongs to a shopper only when the retailer's order email, hashed with
//    AUTH_SECRET, equals the shopper's verified email hash. Nothing else grants access.
//  * No endpoint accepts a shopper ID from the client. Every "my" query is keyed by the
//    session's own shopper. Someone else's order looks exactly like a missing one (404).
//  * The sign-in link is only ever emailed. It is never returned by the API.
import { labelDeleteStatements } from "./royal-mail.js";
import { checkBody } from "./validate.js";
import { parseReceiptEmail } from "./receipt-parser.js";
import { ensureOnce, runAll } from "./once.js";
import { handlePushRoute, pushDeleteStatements, ensurePushTables } from "./push.js";
import { handleExchangeRoute, enrichPurchases } from "./exchange.js";
import { handleReturnRoute } from "./returns.js";
import { handleSquareTestRoute, enrichSquarePurchases, squareOrderDeleteStatements } from "./square-orders.js";
import { handleInstoreRoute, instoreDeleteStatements } from "./square-instore.js";
import { handleExportRoute } from "./export.js";
import { handleCardRoute, forgetCard } from "./payments.js";
import { handleResaleRoute, resaleDeleteStatements } from "./resale.js";
import { handleProfileRoute, profileDeleteStatements, ensureProfileTable, cleanName } from "./profile.js";
import { TOTP_TABLE_SQL, totpDeleteStatements, secondStepFor, twoStepOn, handleTotpAuthRoute, handleTotpShopperRoute } from "./totp.js";
import { PHONE_TABLE_SQL, phoneDeleteStatements, handlePhoneRoute } from "./phone.js";
import { PASSKEY_TABLE_SQL, passkeyDeleteStatements, handlePasskeyAuthRoute, handlePasskeyShopperRoute } from "./passkeys.js";
import { ensureGmailTables, gmailDeleteStatements, revokeAllMailboxes, handleGmailRoute, handleGmailCallback, handleOutlookCallback, outlookConfigured, microsoftRedirect, MS_AUTH,
  CONSENT_VERSION, CONSENT_TEXT, OUTLOOK_SCOPE, GMAIL_SCOPE, saveConnection, recordConsent, sealToken, openToken } from "./gmail.js";
import { tellShopper } from "./security-mail.js";
const LINK_TTL_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 90 * DAY_MS;
// A session in regular use is pushed forward, but at most about once a month.
const SESSION_RENEW_WITHIN_MS = 60 * DAY_MS;
const MAX_CODE_FAILURES = 5;
const HOUR_MS = 60 * 60 * 1000;
const MAX_LINKS_PER_EMAIL_PER_HOUR = 5;
const MAX_LINKS_PER_CLIENT_PER_HOUR = 20;
const DEFAULT_APP_URL = "https://zzmm92nr59-cloud.github.io/instant-refund-prototype/";
const DEFAULT_FROM = "Relay <onboarding@resend.dev>";
const encoder = new TextEncoder();

export function normaliseEmail(raw) {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (!/^[^\s@,;<>()\[\]"\\]{1,64}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(email)) return null;
  return email;
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}
// Keyed hash so a leaked database cannot be checked against a list of known email addresses.
export async function emailHash(secret, email) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode("relay-email:" + email)));
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function ensureAuthTables(db) { return ensureOnce(db, "auth", () => ensureAuthTablesRun(db)); }
async function ensureAuthTablesRun(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS shoppers (
       id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, email_hash TEXT NOT NULL UNIQUE,
       created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS auth_google_states (
       state_hash TEXT PRIMARY KEY, client_hash TEXT NOT NULL, nonce_hash TEXT NOT NULL,
       created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS auth_microsoft_states (
       state_hash TEXT PRIMARY KEY, client_hash TEXT NOT NULL, nonce_hash TEXT NOT NULL,
       created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS auth_login_tokens (
       token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, client_hash TEXT NOT NULL,
       created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS auth_code_failures (email TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_auth_login_email ON auth_login_tokens(email, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_auth_login_client ON auth_login_tokens(client_hash, created_at)`,
    `CREATE TABLE IF NOT EXISTS auth_sessions (
       session_hash TEXT PRIMARY KEY, shopper_id TEXT NOT NULL,
       created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS retailer_order_emails (
       order_id TEXT PRIMARY KEY, email_hash TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_order_emails_hash ON retailer_order_emails(email_hash)`,
    // An Outlook connection waiting for the browser that started a "sign in and connect" to finish signing in.
    `CREATE TABLE IF NOT EXISTS auth_pending_mailbox (
       token_hash TEXT PRIMARY KEY, address TEXT, token_iv TEXT NOT NULL, token_data TEXT NOT NULL,
       created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
    ...PASSKEY_TABLE_SQL,
    ...TOTP_TABLE_SQL,
    ...PHONE_TABLE_SQL
  ];
  await runAll(db, statements);
  // Whether a Microsoft sign-in also asked to connect Outlook (the wording version the shopper agreed to on the sign-in screen).
  try { await db.prepare("ALTER TABLE auth_microsoft_states ADD COLUMN mail_consent TEXT").run(); } catch { /* already there */ }
  // Google can now connect Gmail in the same step as signing in, as Microsoft does for Outlook.
  try { await db.prepare("ALTER TABLE auth_google_states ADD COLUMN mail_consent TEXT").run(); } catch { /* already there */ }
  try { await db.prepare("ALTER TABLE auth_pending_mailbox ADD COLUMN provider TEXT").run(); } catch { /* already there */ }
  // The wording version agreed to on the sign-in screen, so a change while away at Google or Microsoft isn't counted as agreed.
  try { await db.prepare("ALTER TABLE auth_pending_mailbox ADD COLUMN consent_version TEXT").run(); } catch { /* already there */ }
  // The name Google or Microsoft gave, offered (never saved without asking) on the "What should we call you?" step.
  try { await db.prepare("ALTER TABLE auth_login_tokens ADD COLUMN suggested_name TEXT").run(); } catch { /* already there */ }
  await ensureGmailTables(db);
}

function json(body, status = 200, cors = {}) {
  return Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
}
function allowedOrigins(env) {
  const configured = String(env.RELAY_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  return new Set(configured.length ? configured : [new URL(env.RELAY_APP_URL || DEFAULT_APP_URL).origin]);
}
function configured(env) {
  return Boolean(env.RELAY_DB && env.AUTH_SECRET && String(env.AUTH_SECRET).length >= 16 && env.RESEND_API_KEY);
}
async function readJson(request, limit = 2048) {
  const text = await request.text();
  if (text.length > limit) return null;
  try { const body = JSON.parse(text); return body && typeof body === "object" ? body : null; }
  catch { return null; }
}

export async function sessionShopper(request, env, now = Date.now()) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
  if (!match || !env.RELAY_DB) return null;
  const row = await env.RELAY_DB.prepare(
    `SELECT s.id AS id, s.email AS email, s.email_hash AS emailHash, a.session_hash AS sessionHash, a.expires_at AS expiresAt
     FROM auth_sessions a JOIN shoppers s ON s.id = a.shopper_id
     WHERE a.session_hash = ? AND a.expires_at > ?`).bind(await sha256Hex(match[1]), now).first();
  if (!row) return null;
  // Keep a regularly used session alive so the shopper isn't asked to sign in again. Only when it's due (about once a
  // month), so an ordinary request makes one trip to the database, not two.
  if (row.expiresAt < now + SESSION_RENEW_WITHIN_MS)
    await env.RELAY_DB.prepare("UPDATE auth_sessions SET expires_at = ? WHERE session_hash = ? AND expires_at < ?")
      .bind(now + SESSION_TTL_MS, row.sessionHash, now + SESSION_RENEW_WITHIN_MS).run();
  delete row.expiresAt;
  return row;
}

async function requestLink(request, env, cors, opts) {
  const { now, fetchImpl } = opts;
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins(env).has(origin)) return json({ error: "origin_not_allowed" }, 403, cors);
  if (!configured(env)) return json({ error: "sign_in_not_configured" }, 503, cors);
  const body = await readJson(request);
  const email = normaliseEmail(body && body.email);
  if (!email) return json({ error: "invalid_email" }, 400, cors);
  await ensureAuthTables(env.RELAY_DB);
  const client = await sha256Hex("client:" + (request.headers.get("cf-connecting-ip") || "unknown"));
  const since = now - HOUR_MS;
  const perEmail = await env.RELAY_DB.prepare(
    "SELECT COUNT(*) AS n FROM auth_login_tokens WHERE email = ? AND created_at > ?").bind(email, since).first();
  const perClient = await env.RELAY_DB.prepare(
    "SELECT COUNT(*) AS n FROM auth_login_tokens WHERE client_hash = ? AND created_at > ?").bind(client, since).first();
  if ((perEmail?.n || 0) >= MAX_LINKS_PER_EMAIL_PER_HOUR || (perClient?.n || 0) >= MAX_LINKS_PER_CLIENT_PER_HOUR)
    return json({ error: "too_many_requests" }, 429, cors);
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  await env.RELAY_DB.prepare(
    "INSERT INTO auth_login_tokens (token_hash,email,client_hash,created_at,expires_at) VALUES (?,?,?,?,?)")
    .bind(tokenHash, email, client, now, now + LINK_TTL_MS).run();
  // A 6-digit code for the same sign-in, for people whose app and email link open in different places.
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const codeHash = await sha256Hex("code:" + email + ":" + code);
  await env.RELAY_DB.prepare(
    "INSERT INTO auth_login_tokens (token_hash,email,client_hash,created_at,expires_at) VALUES (?,?,?,?,?)")
    .bind(codeHash, "code:" + email, client, now, now + LINK_TTL_MS).run();
  const appUrl = String(env.RELAY_APP_URL || DEFAULT_APP_URL).split("#")[0];
  const link = appUrl + "#signin=" + token; // fragment: never sent to a server or written to logs
  let sent = false;
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.RELAY_EMAIL_FROM || DEFAULT_FROM, to: [email], subject: code + " is your Relay sign-in code",
        text: "Your Relay code is " + code + "\n\nOpen this link to sign in to Relay. It works once and expires in 15 minutes.\n\n" + link +
          "\n\nIf you didn't ask for this, you can ignore this email.",
        html: '<p style="font-size:16px">Your Relay code is <b style="font-size:24px;letter-spacing:3px">' + code + '</b></p><p>Open this link to sign in to Relay. It works once and expires in 15 minutes.</p><p><a href="' +
          link + '">Sign in to Relay</a></p><p>If you didn\'t ask for this, you can ignore this email.</p>'
      })
    });
    sent = res.ok;
  } catch { sent = false; }
  if (!sent) {
    await env.RELAY_DB.prepare("DELETE FROM auth_login_tokens WHERE token_hash IN (?, ?)").bind(tokenHash, codeHash).run();
    return json({ error: "email_send_failed" }, 502, cors);
  }
  return json({ ok: true }, 200, cors);
}

async function verifyLink(request, env, cors, opts) {
  const { now } = opts;
  if (!configured(env)) return json({ error: "sign_in_not_configured" }, 503, cors);
  const body = await readJson(request);
  const token = body && typeof body.token === "string" ? body.token : "";
  if (!TOKEN_SHAPE.test(token)) return json({ error: "invalid_or_expired_link" }, 400, cors);
  await ensureAuthTables(env.RELAY_DB);
  // Single atomic claim: only one request can ever turn a link into a session.
  const claimed = await env.RELAY_DB.prepare(
    `UPDATE auth_login_tokens SET used_at = ?
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email, client_hash, suggested_name`)
    .bind(now, await sha256Hex(token), now).first();
  if (!claimed) return json({ error: "invalid_or_expired_link" }, 400, cors);
  const named = claimed.suggested_name ? { suggestedName: claimed.suggested_name } : {};
  // Google sign-ins are tied to the browser that started them, so a link someone else triggers is useless.
  if (String(claimed.client_hash).startsWith("gnonce:")) {
    const nonce = body && typeof body.nonce === "string" && TOKEN_SHAPE.test(body.nonce) ? body.nonce : "";
    if (!nonce || claimed.client_hash !== "gnonce:" + (await sha256Hex("gnonce:" + nonce))) return json({ error: "invalid_or_expired_link" }, 400, cors);
    // "Sign in and connect your email": the shopper agreed to the wording on the sign-in screen of this same browser,
    // so the agreement is recorded and Gmail or Outlook connected now, in one step. Connecting starts the first scan.
    const pending = await env.RELAY_DB.prepare(
      "DELETE FROM auth_pending_mailbox WHERE token_hash = ? AND expires_at > ? RETURNING address, token_iv, token_data, provider, consent_version").bind(await sha256Hex(token), now).first();
    if (pending) {
      const provider = pending.provider === "google" ? "google" : "microsoft";
      const shopperId = await ensureShopper(env, claimed.email, now);
      // Nothing is agreed or connected yet when 2-step sign-in still has to be passed (connecting waits for the app's own
      // step after sign-in), or when the wording changed since it was shown.
      const twoStep = await twoStepOn(env, shopperId);
      const sameWording = (pending.consent_version || CONSENT_VERSION) === CONSENT_VERSION;
      // An inbox already connected (a different one) is never swapped silently: the shopper keeps it.
      const current = await env.RELAY_DB.prepare("SELECT provider, google_email FROM gmail_connections WHERE shopper_id = ?").bind(shopperId).first();
      const other = current && !(((current.provider === "microsoft") === (provider === "microsoft")) && current.google_email === pending.address);
      if (!twoStep && sameWording && !other) {
        await recordConsent(env, shopperId, now);
        // Gmail connections are stored the way "Connect Gmail" stores them, so the same mailbox keeps its place.
        await saveConnection(env, shopperId, provider === "google" ? null : "microsoft", pending.address, await openToken(env, pending.token_iv, pending.token_data), now);
        return startSession(env, claimed.email, now, cors, { extra: { ...named, mailConnected: provider, ...(provider === "microsoft" ? { outlookConnected: true } : {}) } });
      }
      return startSession(env, claimed.email, now, cors, { extra: { ...named, ...(other ? { mailKept: true } : {}) } });
    }
  }
  return startSession(env, claimed.email, now, cors, { extra: named });
}

async function ensureShopper(env, email, now) {
  const hash = await emailHash(env.AUTH_SECRET, email);
  await env.RELAY_DB.prepare(
    "INSERT OR IGNORE INTO shoppers (id,email,email_hash,created_at) VALUES (?,?,?,?)")
    .bind(crypto.randomUUID(), email, hash, now).run();
  return (await env.RELAY_DB.prepare("SELECT id FROM shoppers WHERE email_hash = ?").bind(hash).first()).id;
}

async function startSession(env, email, now, cors, opts = {}) {
  const shopper = { id: await ensureShopper(env, email, now) };
  const extra = opts.extra || {};
  // Authenticator-app 2-step: a first factor (email link, code, Google) is not enough when the shopper switched it on.
  if (!opts.skipSecondStep) {
    const second = await secondStepFor(env, shopper.id, now);
    if (second && second.tooMany) return json({ error: "too_many_requests" }, 429, cors);
    if (second) return json({ needsSecondStep: true, pendingToken: second.pendingToken, methods: second.methods,
      ...(second.phoneEnding ? { phoneEnding: second.phoneEnding } : {}), email, ...extra }, 200, cors);
  }
  const sessionToken = randomToken();
  await env.RELAY_DB.prepare(
    "INSERT INTO auth_sessions (session_hash,shopper_id,created_at,expires_at) VALUES (?,?,?,?)")
    .bind(await sha256Hex(sessionToken), shopper.id, now, now + SESSION_TTL_MS).run();
  await env.RELAY_DB.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(now).run();
  // Old sign-in links and codes: the hourly limits only look back an hour, so a day later they're no longer needed.
  await env.RELAY_DB.prepare("DELETE FROM auth_login_tokens WHERE created_at <= ?").bind(now - 24 * HOUR_MS).run();
  return json({ sessionToken, expiresAt: now + SESSION_TTL_MS, email, ...extra }, 200, cors);
}

async function verifyCode(request, env, cors, opts) {
  const { now } = opts;
  if (!configured(env)) return json({ error: "sign_in_not_configured" }, 503, cors);
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins(env).has(origin)) return json({ error: "origin_not_allowed" }, 403, cors);
  const body = await readJson(request);
  const email = normaliseEmail(body && body.email);
  const code = body && typeof body.code === "string" ? body.code.replace(/\s/g, "") : "";
  if (!email || !/^\d{6}$/.test(code)) return json({ error: "invalid_or_expired_code" }, 400, cors);
  await ensureAuthTables(env.RELAY_DB);
  // Only a few wrong guesses are allowed per email, then every outstanding code is cancelled.
  const fails = await env.RELAY_DB.prepare(
    "SELECT COUNT(*) AS n FROM auth_code_failures WHERE email = ? AND created_at > ?").bind(email, now - LINK_TTL_MS).first();
  if ((fails?.n || 0) >= MAX_CODE_FAILURES) {
    await env.RELAY_DB.prepare("UPDATE auth_login_tokens SET used_at = ? WHERE email = ? AND used_at IS NULL").bind(now, "code:" + email).run();
    return json({ error: "too_many_requests" }, 429, cors);
  }
  const claimed = await env.RELAY_DB.prepare(
    `UPDATE auth_login_tokens SET used_at = ?
     WHERE token_hash = ? AND email = ? AND used_at IS NULL AND expires_at > ? RETURNING email`)
    .bind(now, await sha256Hex("code:" + email + ":" + code), "code:" + email, now).first();
  if (!claimed) {
    await env.RELAY_DB.prepare("INSERT INTO auth_code_failures (email, created_at) VALUES (?,?)").bind(email, now).run();
    return json({ error: "invalid_or_expired_code" }, 400, cors);
  }
  await env.RELAY_DB.prepare("DELETE FROM auth_code_failures WHERE email = ?").bind(email).run();
  return startSession(env, email, now, cors);
}

function rpId(env) { return new URL(env.RELAY_APP_URL || DEFAULT_APP_URL).hostname; }
const passkeyHelpers = { json, readJson, allowedOrigins, startSession: (...a) => startSession(...a), sha256Hex, rpId };

// ---- Sign in with Google (identity only: openid + email; no Gmail access) ----
const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_GOOGLE_STARTS_PER_CLIENT_PER_HOUR = 30;
function googleRedirect(env, url) { return env.GOOGLE_REDIRECT_URI || `${url.origin}/relay/gmail/callback`; }
function googleConfigured(env) { return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET); }

async function googleStart(request, env, url, cors, opts) {
  const { now } = opts;
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins(env).has(origin)) return json({ error: "origin_not_allowed" }, 403, cors);
  if (!googleConfigured(env)) return json({ error: "google_sign_in_not_configured" }, 503, cors);
  const body = await readJson(request);
  const nonce = body && typeof body.nonce === "string" ? body.nonce : "";
  if (!TOKEN_SHAPE.test(nonce)) return json({ error: "invalid_request" }, 400, cors);
  // "Agree and continue with Google": the shopper read Relay's wording on the sign-in screen and agreed, so Google is also
  // asked for read-only Gmail access, and signing in and Connect Gmail happen in one visit to Google.
  if (body.consentVersion !== undefined && body.consentVersion !== CONSENT_VERSION) return json({ error: "consent_version_mismatch" }, 400, cors);
  const withMail = body.consentVersion === CONSENT_VERSION;
  const client = await sha256Hex("client:" + (request.headers.get("cf-connecting-ip") || "unknown"));
  await env.RELAY_DB.prepare("DELETE FROM auth_google_states WHERE expires_at <= ?").bind(now).run();
  await env.RELAY_DB.prepare("DELETE FROM auth_pending_mailbox WHERE expires_at <= ?").bind(now).run();
  const n = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM auth_google_states WHERE client_hash = ? AND created_at > ?").bind(client, now - HOUR_MS).first();
  if ((n?.n || 0) >= MAX_GOOGLE_STARTS_PER_CLIENT_PER_HOUR) return json({ error: "too_many_requests" }, 429, cors);
  const state = randomToken();
  await env.RELAY_DB.prepare("INSERT INTO auth_google_states (state_hash,client_hash,nonce_hash,created_at,expires_at,mail_consent) VALUES (?,?,?,?,?,?)")
    .bind(await sha256Hex(state), client, await sha256Hex("gnonce:" + nonce), now, now + GOOGLE_STATE_TTL_MS, withMail ? CONSENT_VERSION : null).run();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: googleRedirect(env, url), response_type: "code",
    scope: withMail ? "openid email profile " + GMAIL_SCOPE : "openid email profile", state, include_granted_scopes: "false",
    // Google only hands over a lasting key for Gmail when it shows its own permission screen, so that is asked for too.
    ...(withMail ? { access_type: "offline", prompt: "consent select_account" } : { prompt: "select_account" })
  });
  return json({ url: "https://accounts.google.com/o/oauth2/v2/auth?" + params }, 200, cors);
}

// Called from the shared Google redirect when the state belongs to a sign-in. Returns null if it does not.
async function googleCallback(request, env, url, opts) {
  const state = url.searchParams.get("state") || "";
  if (!TOKEN_SHAPE.test(state)) return null;
  const stateHash = await sha256Hex(state);
  const known = await env.RELAY_DB.prepare("SELECT state_hash FROM auth_google_states WHERE state_hash = ?").bind(stateHash).first();
  if (!known) return null;
  const { now } = opts;
  const appUrl = String(env.RELAY_APP_URL || DEFAULT_APP_URL).split("#")[0];
  const back = result => Response.redirect(appUrl + "#gsignin=" + result, 302);
  const claimed = await env.RELAY_DB.prepare(
    "UPDATE auth_google_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING nonce_hash, mail_consent")
    .bind(now, stateHash, now).first();
  if (!claimed) return back("failed");
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code") || "";
  if (!code) return back("failed");
  const withMail = claimed.mail_consent === CONSENT_VERSION;
  let email = null, mailbox = null, name = null;
  try {
    const res = await opts.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirect(env, url), grant_type: "authorization_code" })
    });
    const tokens = res.ok ? await res.json().catch(() => null) : null;
    // The ID token comes straight from Google's token endpoint over TLS, so its claims are read and checked here.
    const part = tokens && typeof tokens.id_token === "string" ? tokens.id_token.split(".")[1] : "";
    if (part) {
      const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))));
      const issOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
      if (issOk && claims.aud === env.GOOGLE_CLIENT_ID && Number(claims.exp) * 1000 > now && claims.email_verified === true) {
        email = normaliseEmail(claims.email);
        name = providerName(claims);
      }
    }
    // Read-only Gmail granted as well (Google lets people untick it): kept, encrypted, until this browser finishes signing in.
    const granted = String((tokens && tokens.scope) || "").split(/\s+/);
    if (withMail && tokens && typeof tokens.refresh_token === "string" && granted.includes(GMAIL_SCOPE)) mailbox = tokens.refresh_token;
  } catch { email = null; }
  if (!email) return back("failed");
  const token = randomToken(), tokenHash = await sha256Hex(token);
  await env.RELAY_DB.prepare("INSERT INTO auth_login_tokens (token_hash,email,client_hash,created_at,expires_at,suggested_name) VALUES (?,?,?,?,?,?)")
    .bind(tokenHash, email, "gnonce:" + claimed.nonce_hash, now, now + LINK_TTL_MS, name).run();
  if (mailbox) {
    const sealed = await sealToken(env, mailbox);
    await env.RELAY_DB.prepare("INSERT INTO auth_pending_mailbox (token_hash,address,token_iv,token_data,created_at,expires_at,provider,consent_version) VALUES (?,?,?,?,?,?,?,?)")
      .bind(tokenHash, email, sealed.iv, sealed.data, now, now + LINK_TTL_MS, "google", claimed.mail_consent).run();
  }
  return Response.redirect(appUrl + "#signin=" + token, 302);
}

// ---- Sign in with Microsoft (identity only: openid + email; no Outlook access) ----
// Personal Microsoft accounts only. Purchases are matched to a shopper by email address, so Relay must be sure the
// address really is theirs: only addresses Microsoft itself hosts (Outlook, Hotmail, Live, MSN) are accepted this way.
// Anyone else signs in with the emailed link or code, which proves the address directly.
const MS_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const MICROSOFT_MAIL = /@(?:(?:outlook|hotmail|live)\.(?:com|co\.uk|com\.au|co\.jp|co\.nz|co\.za|co\.il|co\.th|co\.kr|com\.ar|com\.br|com\.gr|com\.mx|com\.my|com\.sg|com\.tr|com\.vn|fr|de|it|es|nl|be|ie|ca|at|ch|dk|se|no|fi|pt|jp|cz|hu|in|kr|lv|ph|sa|sk|cl|gr|ru)|msn\.com|passport\.com|windowslive\.com)$/;
const MS_SIGNIN_SCOPE = "openid email profile";
// The person's name as Google or Microsoft holds it, tidied to what the profile accepts. Only offered, never saved without asking.
function providerName(claims) {
  const raw = String((claims && (claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(" "))) || "");
  return cleanName(raw) || null;
}
function decodeClaims(idToken) {
  const part = typeof idToken === "string" ? idToken.split(".")[1] : "";
  if (!part) return null;
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))));
}

async function microsoftStart(request, env, url, cors, opts) {
  const { now } = opts;
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins(env).has(origin)) return json({ error: "origin_not_allowed" }, 403, cors);
  if (!outlookConfigured(env)) return json({ error: "microsoft_sign_in_not_configured" }, 503, cors);
  const body = await readJson(request);
  const nonce = body && typeof body.nonce === "string" ? body.nonce : "";
  if (!TOKEN_SHAPE.test(nonce)) return json({ error: "invalid_request" }, 400, cors);
  // "Agree and continue with Microsoft": the shopper read Relay's wording (shown on the sign-in screen, from /relay/auth/providers)
  // and agreed, so Microsoft is also asked for read-only Outlook access and sign-in and Connect Outlook happen in one go.
  if (body.consentVersion !== undefined && body.consentVersion !== CONSENT_VERSION) return json({ error: "consent_version_mismatch" }, 400, cors);
  const withMail = body.consentVersion === CONSENT_VERSION;
  const client = await sha256Hex("client:" + (request.headers.get("cf-connecting-ip") || "unknown"));
  await env.RELAY_DB.prepare("DELETE FROM auth_microsoft_states WHERE expires_at <= ?").bind(now).run();
  await env.RELAY_DB.prepare("DELETE FROM auth_pending_mailbox WHERE expires_at <= ?").bind(now).run();
  const n = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM auth_microsoft_states WHERE client_hash = ? AND created_at > ?").bind(client, now - HOUR_MS).first();
  if ((n?.n || 0) >= MAX_GOOGLE_STARTS_PER_CLIENT_PER_HOUR) return json({ error: "too_many_requests" }, 429, cors);
  const state = randomToken();
  await env.RELAY_DB.prepare("INSERT INTO auth_microsoft_states (state_hash,client_hash,nonce_hash,created_at,expires_at,mail_consent) VALUES (?,?,?,?,?,?)")
    .bind(await sha256Hex(state), client, await sha256Hex("gnonce:" + nonce), now, now + GOOGLE_STATE_TTL_MS, withMail ? CONSENT_VERSION : null).run();
  const params = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID, response_type: "code", redirect_uri: microsoftRedirect(env, url), response_mode: "query",
    scope: withMail ? MS_SIGNIN_SCOPE + " " + OUTLOOK_SCOPE : MS_SIGNIN_SCOPE, state, prompt: "select_account"
  });
  return json({ url: MS_AUTH + "/authorize?" + params }, 200, cors);
}

// Called from the shared Microsoft redirect when the state belongs to a sign-in. Returns null if it does not
// (then it is a "Connect Outlook", handled in gmail.js).
async function microsoftCallback(request, env, url, opts) {
  const state = url.searchParams.get("state") || "";
  if (!TOKEN_SHAPE.test(state)) return null;
  const stateHash = await sha256Hex(state);
  const known = await env.RELAY_DB.prepare("SELECT state_hash FROM auth_microsoft_states WHERE state_hash = ?").bind(stateHash).first();
  if (!known) return null;
  const { now } = opts;
  const appUrl = String(env.RELAY_APP_URL || DEFAULT_APP_URL).split("#")[0];
  const back = result => Response.redirect(appUrl + "#msignin=" + result, 302);
  const claimed = await env.RELAY_DB.prepare(
    "UPDATE auth_microsoft_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING nonce_hash, mail_consent")
    .bind(now, stateHash, now).first();
  if (!claimed) return back("failed");
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code") || "";
  if (!code || !outlookConfigured(env)) return back("failed");
  const withMail = claimed.mail_consent === CONSENT_VERSION;
  let email = null, otherAddress = false, mailbox = null, name = null;
  try {
    const res = await opts.fetchImpl(MS_AUTH + "/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET,
        redirect_uri: microsoftRedirect(env, url), grant_type: "authorization_code", scope: withMail ? MS_SIGNIN_SCOPE + " " + OUTLOOK_SCOPE : MS_SIGNIN_SCOPE })
    });
    const tokens = res.ok ? await res.json().catch(() => null) : null;
    // Read-only mail access granted as well: kept (encrypted) until this browser finishes signing in.
    if (withMail && tokens && typeof tokens.refresh_token === "string" && /(^|[\s/])Mail\.Read(\s|$)/i.test(String(tokens.scope || ""))) mailbox = tokens.refresh_token;
    // The ID token comes straight from Microsoft's token endpoint over TLS, so its claims are read and checked here.
    const claims = tokens ? decodeClaims(tokens.id_token) : null;
    if (claims && claims.iss === "https://login.microsoftonline.com/" + MS_CONSUMER_TENANT + "/v2.0" && claims.tid === MS_CONSUMER_TENANT &&
        claims.aud === env.MICROSOFT_CLIENT_ID && Number(claims.exp) * 1000 > now) {
      const address = normaliseEmail(claims.email || claims.preferred_username);
      if (address && MICROSOFT_MAIL.test(address)) { email = address; name = providerName(claims); }
      else otherAddress = Boolean(address);
    }
  } catch { email = null; }
  if (!email) return back(otherAddress ? "other_address" : "failed");
  const token = randomToken(), tokenHash = await sha256Hex(token);
  await env.RELAY_DB.prepare("INSERT INTO auth_login_tokens (token_hash,email,client_hash,created_at,expires_at,suggested_name) VALUES (?,?,?,?,?,?)")
    .bind(tokenHash, email, "gnonce:" + claimed.nonce_hash, now, now + LINK_TTL_MS, name).run();
  if (mailbox) {
    const sealed = await sealToken(env, mailbox);
    await env.RELAY_DB.prepare("INSERT INTO auth_pending_mailbox (token_hash,address,token_iv,token_data,created_at,expires_at,provider,consent_version) VALUES (?,?,?,?,?,?,?,?)")
      .bind(tokenHash, email, sealed.iv, sealed.data, now, now + LINK_TTL_MS, "microsoft", claimed.mail_consent).run();
  }
  return Response.redirect(appUrl + "#signin=" + token, 302);
}

async function listPurchases(env, shopper, orderId) {
  const where = orderId ? "AND o.id = ?" : "";
  const params = orderId ? [shopper.emailHash, orderId] : [shopper.emailHash];
  const orders = await env.RELAY_DB.prepare(
    `SELECT o.id AS id, o.connection_id AS retailer, o.ordered_at AS orderedAt,
            o.amount_minor AS amountMinor, o.currency AS currency, o.status AS status
     FROM retailer_orders o JOIN retailer_order_emails e ON e.order_id = o.id
     WHERE e.email_hash = ? ${where} ORDER BY o.ordered_at DESC LIMIT 100`).bind(...params).all();
  // Order lines and shop names for all the orders at once (asking once per order was slow).
  const list = orders.results || [];
  const lines = new Map(), labels = new Map();
  for (let i = 0; i < list.length; i += 90) {
    const ids = list.slice(i, i + 90).map(o => o.id);
    const rows = (await env.RELAY_DB.prepare(`SELECT order_id AS orderId, external_line_item_id AS lineId, product_id AS productId, variant_id AS variantId, title, quantity,
        price_minor AS priceMinor, currency FROM order_items WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY title`).bind(...ids).all()).results || [];
    for (const r of rows) { const { orderId, ...line } = r; if (!lines.has(orderId)) lines.set(orderId, []); if (lines.get(orderId).length < 100) lines.get(orderId).push(line); }
  }
  const domains = [...new Set(list.map(o => (/^shopify:([a-z0-9-]+\.myshopify\.com)$/.exec(String(o.retailer || "")) || [])[1]).filter(Boolean))];
  if (domains.length) {
    try {
      for (const r of (await env.RELAY_DB.prepare(`SELECT domain, label FROM shopify_shops WHERE domain IN (${domains.map(() => "?").join(",")})`).bind(...domains).all()).results || [])
        labels.set(r.domain, r.label);
    } catch { /* no connected shops table yet: shop addresses are used */ }
  }
  const result = [];
  for (const order of list) {
    // The shop's name for orders from Shopify shops that connected themselves (their address otherwise).
    const m = /^shopify:([a-z0-9-]+\.myshopify\.com)$/.exec(String(order.retailer || ""));
    const store = m ? (labels.get(m[1]) || m[1].replace(/\.myshopify\.com$/, "")) : null;
    result.push({ ...order, store, ownership: "retailer_email_matched", items: lines.get(order.id) || [] });
  }
  return result;
}

// Returns a Response for auth/"my" routes, or null when the route is not one of ours.
export async function handleAuthRoute(request, env, url, cors = {}, opts = {}) {
  const path = url.pathname;
  const isAuthRoute = path.startsWith("/relay/auth/") || path === "/relay/me" || path.startsWith("/relay/my/") || path === "/relay/gmail/callback" || path === "/relay/microsoft/callback";
  if (!isAuthRoute) return null;
  const o = { now: Date.now(), fetchImpl: (...args) => fetch(...args), ...opts }; // arrow wrapper: a bare fetch called as o.fetchImpl() throws "Illegal invocation" on Workers
  // Strict checks on what's sent (validate.js). Sign-in routes are checked straight away; signed-in routes once the
  // session is known, so a request without a valid one is answered "not signed in" before its body is even read.
  const signedInRoute = path.startsWith("/relay/my/") || path === "/relay/auth/logout";
  try {
    if (!signedInRoute) { const v = await checkBody(request, path, cors); if (v.response) return v.response; request = v.request; }
    if (path === "/relay/auth/request" && request.method === "POST") return await requestLink(request, env, cors, o);
    if (path === "/relay/auth/verify" && request.method === "POST") return await verifyLink(request, env, cors, o);
    if (path === "/relay/auth/verify-code" && request.method === "POST") return await verifyCode(request, env, cors, o);
    if (path === "/relay/auth/google/start" && request.method === "POST" && configured(env)) { await ensureAuthTables(env.RELAY_DB); return await googleStart(request, env, url, cors, o); }
    if (path === "/relay/auth/microsoft/start" && request.method === "POST" && configured(env)) { await ensureAuthTables(env.RELAY_DB); return await microsoftStart(request, env, url, cors, o); }
    // Which sign-in buttons the app should show. Says nothing about any shopper.
    if (path === "/relay/auth/providers" && request.method === "GET") {
      const microsoft = configured(env) && outlookConfigured(env), google = configured(env) && googleConfigured(env);
      // The wording a Google or Microsoft sign-in agrees to (it also connects Gmail or Outlook), shown before going there.
      return json({ email: configured(env), google, microsoft,
        ...(microsoft || google ? { consent: { version: CONSENT_VERSION, text: CONSENT_TEXT } } : {}) }, 200, cors);
    }
    if (path.startsWith("/relay/auth/passkey/") && configured(env)) {
      await ensureAuthTables(env.RELAY_DB);
      const pk = await handlePasskeyAuthRoute(path, request.method, request, env, cors, o, passkeyHelpers);
      if (pk) return pk;
    }
    if ((path === "/relay/auth/2fa/verify" || path === "/relay/auth/2fa/text") && configured(env)) {
      await ensureAuthTables(env.RELAY_DB);
      const t = await handleTotpAuthRoute(path, request.method, request, env, cors, o, passkeyHelpers);
      if (t) return t;
    }
    if (!configured(env)) return json({ error: "sign_in_not_configured" }, 503, cors);
    await ensureAuthTables(env.RELAY_DB);
    if (path === "/relay/gmail/callback" && request.method === "GET") {
      const g = await googleCallback(request, env, url, o);
      if (g) return g;
    }
    if (path === "/relay/gmail/callback" && request.method === "GET")
      return await handleGmailCallback(request, env, url, { ...o, appUrl: DEFAULT_APP_URL });
    if (path === "/relay/microsoft/callback" && request.method === "GET") {
      const ms = await microsoftCallback(request, env, url, o);
      if (ms) return ms;
      return await handleOutlookCallback(request, env, url, { ...o, appUrl: DEFAULT_APP_URL });
    }
    const shopper = await sessionShopper(request, env, o.now);
    if (!shopper) return json({ error: "not_signed_in" }, 401, cors);
    if (signedInRoute) { const v = await checkBody(request, path, cors); if (v.response) return v.response; request = v.request; }
    if (path === "/relay/me" && request.method === "GET") return json({ email: shopper.email }, 200, cors);
    if (path === "/relay/auth/logout" && request.method === "POST") {
      await env.RELAY_DB.prepare("DELETE FROM auth_sessions WHERE session_hash = ?").bind(shopper.sessionHash).run();
      return json({ ok: true }, 200, cors);
    }
    // Signs Relay out everywhere else (a lost phone, a shared computer, someone who shouldn't be in); this device stays signed in.
    if (path === "/relay/my/devices/sign-out-others" && request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && !allowedOrigins(env).has(origin)) return json({ error: "origin_not_allowed" }, 403, cors);
      const gone = await env.RELAY_DB.prepare("DELETE FROM auth_sessions WHERE shopper_id = ? AND session_hash != ? RETURNING session_hash").bind(shopper.id, shopper.sessionHash).all();
      const count = (gone.results || []).length;
      if (count) await tellShopper(env, o, shopper.email, "others_out", { count });
      return json({ ok: true, count }, 200, cors);
    }
    if (path === "/relay/my/delete" && request.method === "POST") {
      await ensurePushTables(env.RELAY_DB);
      await ensureProfileTable(env.RELAY_DB);
      await forgetCard(env, shopper.id, o).catch(() => {});
      // Cancel Relay's Gmail access at Google too, not just the copy of the key Relay holds.
      await ensureGmailTables(env.RELAY_DB).then(() => revokeAllMailboxes(env, shopper.id, o.fetchImpl)).catch(() => {});
      await env.RELAY_DB.batch([
        ...resaleDeleteStatements(env.RELAY_DB, shopper.id),
        ...profileDeleteStatements(env.RELAY_DB, shopper.id),
        ...gmailDeleteStatements(env.RELAY_DB, shopper.id),
        ...passkeyDeleteStatements(env.RELAY_DB, shopper.id),
        ...(await labelDeleteStatements(env.RELAY_DB, shopper.id)),
        ...totpDeleteStatements(env.RELAY_DB, shopper.id),
        ...phoneDeleteStatements(env.RELAY_DB, shopper.id),
        ...pushDeleteStatements(env.RELAY_DB, shopper.id),
        ...(await instoreDeleteStatements(env.RELAY_DB, shopper.emailHash, shopper.id)),
        ...(await squareOrderDeleteStatements(env.RELAY_DB, shopper.id)),
        // Which orders at shops connected to Relay were placed with this email address (the orders themselves stay with the shop).
        env.RELAY_DB.prepare("DELETE FROM retailer_order_emails WHERE email_hash = ?").bind(shopper.emailHash),
        env.RELAY_DB.prepare("DELETE FROM auth_sessions WHERE shopper_id = ?").bind(shopper.id),
        env.RELAY_DB.prepare("DELETE FROM auth_login_tokens WHERE email IN (?, ?)").bind(shopper.email, "code:" + shopper.email),
        env.RELAY_DB.prepare("DELETE FROM auth_code_failures WHERE email = ?").bind(shopper.email),
        env.RELAY_DB.prepare("DELETE FROM shoppers WHERE id = ?").bind(shopper.id)
      ]);
      return json({ ok: true }, 200, cors);
    }
    // "Download my data": a copy of everything Relay keeps about the shopper.
    const exportResponse = await handleExportRoute(request, env, url, cors, shopper, o);
    if (exportResponse) return exportResponse;
    const profileResponse = await handleProfileRoute(request, env, url, cors, shopper, o);
    if (profileResponse) return profileResponse;
    const gmailResponse = await handleGmailRoute(request, env, url, cors, shopper, o);
    if (gmailResponse) return gmailResponse;
    const resaleResponse = await handleResaleRoute(request, env, url, cors, shopper, o);
    if (resaleResponse) return resaleResponse;
    const pushResponse = await handlePushRoute(request, env, url, cors, shopper, o);
    if (pushResponse) return pushResponse;
    const passkeyResponse = await handlePasskeyShopperRoute(path, request.method, request, env, cors, o, passkeyHelpers, shopper);
    if (passkeyResponse) return passkeyResponse;
    const totpResponse = await handleTotpShopperRoute(path, request.method, request, env, cors, o, passkeyHelpers, shopper);
    if (totpResponse) return totpResponse;
    const phoneResponse = await handlePhoneRoute(path, request.method, request, env, cors, o, passkeyHelpers, shopper);
    if (phoneResponse) return phoneResponse;
    const exchangeResponse = await handleExchangeRoute(request, env, url, cors, shopper, o);
    if (exchangeResponse) return exchangeResponse;
    const cardResponse = await handleCardRoute(request, env, url, cors, shopper, o);
    if (cardResponse) return cardResponse;
    const returnResponse = await handleReturnRoute(request, env, url, cors, shopper, o);
    if (returnResponse) return returnResponse;
    const instoreResponse = await handleInstoreRoute(request, env, url, cors, shopper, o);
    if (instoreResponse) return instoreResponse;
    const squareTestResponse = await handleSquareTestRoute(request, env, url, cors, shopper, o);
    if (squareTestResponse) return squareTestResponse;
    if (path === "/relay/my/purchases" && request.method === "GET")
      return json({ purchases: await enrichSquarePurchases(env, await enrichPurchases(env, await listPurchases(env, shopper)), o) }, 200, cors);
    if (path === "/relay/my/receipts/parse" && request.method === "POST") {
      // Reads a pasted order-confirmation email. Nothing is stored. The result is
      // shopper-supplied evidence (refundEligible is always false).
      const body = await readJson(request, 250_000);
      if (!body || typeof body.email !== "string" || body.email.length < 20)
        return json({ error: "invalid_receipt" }, 400, cors);
      return json({ receipt: parseReceiptEmail(body.email) }, 200, cors);
    }
    const one = /^\/relay\/my\/purchases\/([A-Za-z0-9:._-]{1,200})$/.exec(path);
    if (one && request.method === "GET") {
      const found = await listPurchases(env, shopper, one[1]);
      return found.length ? json({ purchase: found[0] }, 200, cors) : json({ error: "not_found" }, 404, cors);
    }
    return json({ error: "not_found" }, 404, cors);
  } catch (error) {
    console.error("auth route failed", String(error && error.message || error));
    return json({ error: "auth_unavailable" }, 503, cors);
  }
}
