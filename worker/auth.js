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
import { parseReceiptEmail } from "./receipt-parser.js";
import { ensureGmailTables, gmailDeleteStatements, handleGmailRoute, handleGmailCallback } from "./gmail.js";
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

export async function ensureAuthTables(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS shoppers (
       id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, email_hash TEXT NOT NULL UNIQUE,
       created_at INTEGER NOT NULL)`,
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
    `CREATE INDEX IF NOT EXISTS idx_order_emails_hash ON retailer_order_emails(email_hash)`
  ];
  for (const sql of statements) await db.prepare(sql).run();
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
    `SELECT s.id AS id, s.email AS email, s.email_hash AS emailHash, a.session_hash AS sessionHash
     FROM auth_sessions a JOIN shoppers s ON s.id = a.shopper_id
     WHERE a.session_hash = ? AND a.expires_at > ?`).bind(await sha256Hex(match[1]), now).first();
  if (!row) return null;
  // Keep a regularly used session alive so the shopper isn't asked to sign in again.
  await env.RELAY_DB.prepare(
    "UPDATE auth_sessions SET expires_at = ? WHERE session_hash = ? AND expires_at < ?")
    .bind(now + SESSION_TTL_MS, row.sessionHash, now + SESSION_RENEW_WITHIN_MS).run();
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
        from: env.RELAY_EMAIL_FROM || DEFAULT_FROM, to: [email], subject: "Your Relay sign-in link",
        text: "Open this link to sign in to Relay. It works once and expires in 15 minutes.\n\n" + link +
          "\n\nOr type this code into the Relay app: " + code + "\n\nIf you didn't ask for this, you can ignore this email.",
        html: '<p>Open this link to sign in to Relay. It works once and expires in 15 minutes.</p><p><a href="' +
          link + '">Sign in to Relay</a></p><p>Or type this code into the Relay app: <b style="font-size:20px;letter-spacing:3px">' + code + '</b></p><p>If you didn\'t ask for this, you can ignore this email.</p>'
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
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email`)
    .bind(now, await sha256Hex(token), now).first();
  if (!claimed) return json({ error: "invalid_or_expired_link" }, 400, cors);
  return startSession(env, claimed.email, now, cors);
}

async function startSession(env, email, now, cors) {
  const hash = await emailHash(env.AUTH_SECRET, email);
  await env.RELAY_DB.prepare(
    "INSERT OR IGNORE INTO shoppers (id,email,email_hash,created_at) VALUES (?,?,?,?)")
    .bind(crypto.randomUUID(), email, hash, now).run();
  const shopper = await env.RELAY_DB.prepare("SELECT id FROM shoppers WHERE email_hash = ?").bind(hash).first();
  const sessionToken = randomToken();
  await env.RELAY_DB.prepare(
    "INSERT INTO auth_sessions (session_hash,shopper_id,created_at,expires_at) VALUES (?,?,?,?)")
    .bind(await sha256Hex(sessionToken), shopper.id, now, now + SESSION_TTL_MS).run();
  await env.RELAY_DB.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(now).run();
  return json({ sessionToken, expiresAt: now + SESSION_TTL_MS, email }, 200, cors);
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

async function listPurchases(env, shopper, orderId) {
  const where = orderId ? "AND o.id = ?" : "";
  const params = orderId ? [shopper.emailHash, orderId] : [shopper.emailHash];
  const orders = await env.RELAY_DB.prepare(
    `SELECT o.id AS id, o.connection_id AS retailer, o.ordered_at AS orderedAt,
            o.amount_minor AS amountMinor, o.currency AS currency, o.status AS status
     FROM retailer_orders o JOIN retailer_order_emails e ON e.order_id = o.id
     WHERE e.email_hash = ? ${where} ORDER BY o.ordered_at DESC LIMIT 100`).bind(...params).all();
  const result = [];
  for (const order of orders.results || []) {
    const items = await env.RELAY_DB.prepare(
      `SELECT title, quantity, price_minor AS priceMinor, currency FROM order_items WHERE order_id = ?
       ORDER BY title LIMIT 100`).bind(order.id).all();
    result.push({ ...order, ownership: "retailer_email_matched", items: items.results || [] });
  }
  return result;
}

// Returns a Response for auth/"my" routes, or null when the route is not one of ours.
export async function handleAuthRoute(request, env, url, cors = {}, opts = {}) {
  const path = url.pathname;
  const isAuthRoute = path.startsWith("/relay/auth/") || path === "/relay/me" || path.startsWith("/relay/my/") || path === "/relay/gmail/callback";
  if (!isAuthRoute) return null;
  const o = { now: Date.now(), fetchImpl: (...args) => fetch(...args), ...opts }; // arrow wrapper: a bare fetch called as o.fetchImpl() throws "Illegal invocation" on Workers
  try {
    if (path === "/relay/auth/request" && request.method === "POST") return await requestLink(request, env, cors, o);
    if (path === "/relay/auth/verify" && request.method === "POST") return await verifyLink(request, env, cors, o);
    if (path === "/relay/auth/verify-code" && request.method === "POST") return await verifyCode(request, env, cors, o);
    if (!configured(env)) return json({ error: "sign_in_not_configured" }, 503, cors);
    await ensureAuthTables(env.RELAY_DB);
    if (path === "/relay/gmail/callback" && request.method === "GET")
      return await handleGmailCallback(request, env, url, { ...o, appUrl: DEFAULT_APP_URL });
    const shopper = await sessionShopper(request, env, o.now);
    if (!shopper) return json({ error: "not_signed_in" }, 401, cors);
    if (path === "/relay/me" && request.method === "GET") return json({ email: shopper.email }, 200, cors);
    if (path === "/relay/auth/logout" && request.method === "POST") {
      await env.RELAY_DB.prepare("DELETE FROM auth_sessions WHERE session_hash = ?").bind(shopper.sessionHash).run();
      return json({ ok: true }, 200, cors);
    }
    if (path === "/relay/my/delete" && request.method === "POST") {
      await env.RELAY_DB.batch([
        ...gmailDeleteStatements(env.RELAY_DB, shopper.id),
        env.RELAY_DB.prepare("DELETE FROM auth_sessions WHERE shopper_id = ?").bind(shopper.id),
        env.RELAY_DB.prepare("DELETE FROM auth_login_tokens WHERE email IN (?, ?)").bind(shopper.email, "code:" + shopper.email),
        env.RELAY_DB.prepare("DELETE FROM auth_code_failures WHERE email = ?").bind(shopper.email),
        env.RELAY_DB.prepare("DELETE FROM shoppers WHERE id = ?").bind(shopper.id)
      ]);
      return json({ ok: true }, 200, cors);
    }
    const gmailResponse = await handleGmailRoute(request, env, url, cors, shopper, o);
    if (gmailResponse) return gmailResponse;
    if (path === "/relay/my/purchases" && request.method === "GET")
      return json({ purchases: await listPurchases(env, shopper) }, 200, cors);
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
