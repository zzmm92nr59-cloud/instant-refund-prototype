// Optional authenticator-app 2-step sign-in (TOTP, RFC 6238: 6 digits, 30 seconds, SHA-1).
// The secret is stored encrypted (AES-GCM, key derived from AUTH_SECRET). Recovery codes are stored only as hashes.
// Passkey (Face ID) sign-in already proves the person, so it never asks for this second step.
const enc = new TextEncoder();
const STEP_SECONDS = 30;
const PENDING_TTL_MS = 10 * 60 * 1000;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;           // wrong codes per shopper per window, across every route here
const MAX_PENDING_TRIES = 5;   // wrong codes per half-finished sign-in
const RECOVERY_COUNT = 8;
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export const TOTP_TABLE_SQL = [
  `CREATE TABLE IF NOT EXISTS auth_totp (
     shopper_id TEXT PRIMARY KEY, secret_enc TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
     last_step INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, enabled_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS auth_totp_recovery (
     code_hash TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, used_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS auth_2fa_pending (
     token_hash TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS auth_2fa_failures (shopper_id TEXT NOT NULL, created_at INTEGER NOT NULL)`
];

export function totpDeleteStatements(db, shopperId) {
  return [
    db.prepare("DELETE FROM auth_totp WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM auth_totp_recovery WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM auth_2fa_pending WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM auth_2fa_failures WHERE shopper_id = ?").bind(shopperId)
  ];
}

const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = t => { t = String(t).replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; return Uint8Array.from(atob(t), c => c.charCodeAt(0)); };
async function sha256Hex(text) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)))].map(b => b.toString(16).padStart(2, "0")).join("");
}
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(text) {
  let bits = 0, value = 0; const out = [];
  for (const ch of text) { const i = B32.indexOf(ch); if (i < 0) continue; value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Uint8Array.from(out);
}

async function aesKey(env) {
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode("relay-totp-v1:" + env.AUTH_SECRET)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(env, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return b64u(iv) + "." + b64u(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), bytes));
}
async function unseal(env, text) {
  const [iv, ct] = String(text).split(".");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await aesKey(env), unb64u(ct)));
}

async function codeAt(secret, step) {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8); new DataView(msg.buffer).setUint32(4, step >>> 0); new DataView(msg.buffer).setUint32(0, Math.floor(step / 2 ** 32));
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}
// Exported for tests: the matching step (or null). Allows one step of clock drift either way.
export async function matchingStep(secret, code, now) {
  const cur = Math.floor(now / 1000 / STEP_SECONDS);
  for (const s of [cur, cur - 1, cur + 1]) if (await codeAt(secret, s) === code) return s;
  return null;
}
export { codeAt as _codeAt, base32 as _base32 };

function newRecoveryCode() {
  const r = crypto.getRandomValues(new Uint8Array(10));
  const s = [...r].map(b => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
  return s.slice(0, 5) + "-" + s.slice(5);
}
const normaliseRecovery = t => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const recoveryHash = (shopperId, code) => sha256Hex("rc:" + shopperId + ":" + normaliseRecovery(code));

async function tooManyFails(env, shopperId, now) {
  const r = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM auth_2fa_failures WHERE shopper_id = ? AND created_at > ?").bind(shopperId, now - FAIL_WINDOW_MS).first();
  return (r?.n || 0) >= MAX_FAILS;
}
async function recordFail(env, shopperId, now) {
  await env.RELAY_DB.prepare("INSERT INTO auth_2fa_failures (shopper_id, created_at) VALUES (?,?)").bind(shopperId, now).run();
  await env.RELAY_DB.prepare("DELETE FROM auth_2fa_failures WHERE created_at <= ?").bind(now - FAIL_WINDOW_MS).run();
}

// Checks a 6-digit app code or a recovery code. Each accepted app code (and each recovery code) works once.
async function checkCode(env, shopperId, input, now) {
  const text = String(input || "").trim();
  const row = await env.RELAY_DB.prepare("SELECT secret_enc, last_step FROM auth_totp WHERE shopper_id = ? AND enabled = 1").bind(shopperId).first();
  if (!row) return false;
  const digits = text.replace(/\s/g, "");
  if (/^\d{6}$/.test(digits)) {
    const step = await matchingStep(await unseal(env, row.secret_enc), digits, now);
    if (step == null) return false;
    // Atomic: a code that was already used (or an older one) cannot win a second time.
    const won = await env.RELAY_DB.prepare("UPDATE auth_totp SET last_step = ? WHERE shopper_id = ? AND last_step < ? RETURNING shopper_id").bind(step, shopperId, step).first();
    return Boolean(won);
  }
  if (normaliseRecovery(text).length === 10) {
    const used = await env.RELAY_DB.prepare("UPDATE auth_totp_recovery SET used_at = ? WHERE code_hash = ? AND shopper_id = ? AND used_at IS NULL RETURNING code_hash")
      .bind(now, await recoveryHash(shopperId, text), shopperId).first();
    return Boolean(used);
  }
  return false;
}

// Called by sign-in. Returns null when no second step is needed.
export async function secondStepFor(env, shopperId, now) {
  const row = await env.RELAY_DB.prepare("SELECT enabled FROM auth_totp WHERE shopper_id = ? AND enabled = 1").bind(shopperId).first();
  if (!row) return null;
  const recent = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM auth_2fa_pending WHERE shopper_id = ? AND created_at > ?").bind(shopperId, now - FAIL_WINDOW_MS).first();
  if ((recent?.n || 0) >= 10) return { tooMany: true };
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = b64u(bytes);
  await env.RELAY_DB.prepare("INSERT INTO auth_2fa_pending (token_hash, shopper_id, created_at, expires_at) VALUES (?,?,?,?)")
    .bind(await sha256Hex(token), shopperId, now, now + PENDING_TTL_MS).run();
  await env.RELAY_DB.prepare("DELETE FROM auth_2fa_pending WHERE expires_at <= ?").bind(now - FAIL_WINDOW_MS).run();
  return { pendingToken: token };
}

// Not signed in yet: finish a half-complete sign-in with the authenticator (or recovery) code.
export async function handleTotpAuthRoute(path, method, request, env, cors, o, h) {
  if (path !== "/relay/auth/2fa/verify" || method !== "POST") return null;
  const { now } = o;
  const origin = request.headers.get("origin");
  if (origin && !h.allowedOrigins(env).has(origin)) return h.json({ error: "origin_not_allowed" }, 403, cors);
  const body = await h.readJson(request, 2048);
  const fail = () => h.json({ error: "invalid_code" }, 400, cors);
  const token = body && typeof body.pendingToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(body.pendingToken) ? body.pendingToken : "";
  if (!token || typeof body.code !== "string" || body.code.length > 40) return fail();
  const pending = await env.RELAY_DB.prepare(
    `UPDATE auth_2fa_pending SET attempts = attempts + 1
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND attempts < ? RETURNING shopper_id`)
    .bind(await sha256Hex(token), now, MAX_PENDING_TRIES).first();
  if (!pending) return h.json({ error: "sign_in_expired" }, 400, cors);
  if (await tooManyFails(env, pending.shopper_id, now)) return h.json({ error: "too_many_requests" }, 429, cors);
  if (!(await checkCode(env, pending.shopper_id, body.code, now))) { await recordFail(env, pending.shopper_id, now); return fail(); }
  const claimed = await env.RELAY_DB.prepare("UPDATE auth_2fa_pending SET used_at = ? WHERE token_hash = ? AND used_at IS NULL RETURNING shopper_id").bind(now, await sha256Hex(token)).first();
  if (!claimed) return h.json({ error: "sign_in_expired" }, 400, cors);
  const s = await env.RELAY_DB.prepare("SELECT email FROM shoppers WHERE id = ?").bind(pending.shopper_id).first();
  if (!s) return fail();
  return h.startSession(env, s.email, now, cors, { skipSecondStep: true });
}

// Signed in: status, set up, switch on, switch off.
export async function handleTotpShopperRoute(path, method, request, env, cors, o, h, shopper) {
  if (!path.startsWith("/relay/my/2fa")) return null;
  const { now } = o;
  const origin = request.headers.get("origin");
  if (method === "POST" && origin && !h.allowedOrigins(env).has(origin)) return h.json({ error: "origin_not_allowed" }, 403, cors);
  const row = await env.RELAY_DB.prepare("SELECT secret_enc, enabled FROM auth_totp WHERE shopper_id = ?").bind(shopper.id).first();

  if (path === "/relay/my/2fa" && method === "GET") {
    const left = row && row.enabled ? (await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM auth_totp_recovery WHERE shopper_id = ? AND used_at IS NULL").bind(shopper.id).first())?.n || 0 : 0;
    return h.json({ enabled: Boolean(row && row.enabled), recoveryCodesLeft: left }, 200, cors);
  }
  if (method !== "POST") return null;

  if (path === "/relay/my/2fa/setup") {
    if (row && row.enabled) return h.json({ error: "already_enabled" }, 400, cors);
    const secret = crypto.getRandomValues(new Uint8Array(20));
    await env.RELAY_DB.prepare(
      "INSERT INTO auth_totp (shopper_id, secret_enc, enabled, last_step, created_at) VALUES (?,?,0,0,?) ON CONFLICT(shopper_id) DO UPDATE SET secret_enc = excluded.secret_enc, enabled = 0, last_step = 0, created_at = excluded.created_at")
      .bind(shopper.id, await seal(env, secret), now).run();
    const key = base32(secret);
    const url = `otpauth://totp/${encodeURIComponent("Relay:" + shopper.email)}?secret=${key}&issuer=Relay&algorithm=SHA1&digits=6&period=30`;
    return h.json({ secret: key.match(/.{1,4}/g).join(" "), otpauthUrl: url }, 200, cors);
  }

  const body = await h.readJson(request, 2048);
  const code = body && typeof body.code === "string" && body.code.length <= 40 ? body.code : "";

  if (path === "/relay/my/2fa/enable") {
    if (!row || row.enabled) return h.json({ error: row ? "already_enabled" : "setup_first" }, 400, cors);
    if (await tooManyFails(env, shopper.id, now)) return h.json({ error: "too_many_requests" }, 429, cors);
    const digits = code.replace(/\s/g, "");
    const step = /^\d{6}$/.test(digits) ? await matchingStep(await unseal(env, row.secret_enc), digits, now) : null;
    if (step == null) { await recordFail(env, shopper.id, now); return h.json({ error: "invalid_code" }, 400, cors); }
    const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
    const hashes = await Promise.all(codes.map(c => recoveryHash(shopper.id, c)));
    await env.RELAY_DB.batch([
      env.RELAY_DB.prepare("DELETE FROM auth_totp_recovery WHERE shopper_id = ?").bind(shopper.id),
      ...hashes.map(x => env.RELAY_DB.prepare("INSERT INTO auth_totp_recovery (code_hash, shopper_id) VALUES (?,?)").bind(x, shopper.id)),
      env.RELAY_DB.prepare("UPDATE auth_totp SET enabled = 1, enabled_at = ?, last_step = ? WHERE shopper_id = ?").bind(now, step, shopper.id)
    ]);
    return h.json({ ok: true, recoveryCodes: codes }, 200, cors); // shown once; only hashes are kept
  }

  if (path === "/relay/my/2fa/disable") {
    if (!row || !row.enabled) return h.json({ error: "not_enabled" }, 400, cors);
    if (await tooManyFails(env, shopper.id, now)) return h.json({ error: "too_many_requests" }, 429, cors);
    if (!(await checkCode(env, shopper.id, code, now))) { await recordFail(env, shopper.id, now); return h.json({ error: "invalid_code" }, 400, cors); }
    await env.RELAY_DB.batch(totpDeleteStatements(env.RELAY_DB, shopper.id));
    return h.json({ ok: true }, 200, cors);
  }
  return null;
}
