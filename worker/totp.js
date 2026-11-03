// Optional two-step sign-in: a code from an authenticator app (TOTP, RFC 6238: 6 digits, 30 seconds, SHA-1) and/or a code
// texted to the shopper's confirmed phone (the number and the texts live in phone.js).
// The app secret is stored encrypted (AES-GCM, key derived from AUTH_SECRET). Recovery codes are stored only as hashes and
// work whichever way the codes arrive. Passkey (Face ID) sign-in already proves the person, so it never asks for this step.
import { textConfigured, issueTextCode, useTextCode, confirmedPhone, confirmNumberWithCode, textResponse, clientHashOf } from "./phone.js";
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

// Checks a 6-digit code (texted for `texted` = [purpose, ref], or from the app) or a recovery code. Each works once.
async function checkCode(env, shopperId, input, now, texted) {
  const text = String(input || "").trim();
  const digits = text.replace(/\s/g, "");
  if (/^\d{6}$/.test(digits)) {
    if (texted && await useTextCode(env, shopperId, texted[0], texted[1], digits, now)) return true;
    const row = await env.RELAY_DB.prepare("SELECT secret_enc, last_step FROM auth_totp WHERE shopper_id = ? AND enabled = 1").bind(shopperId).first();
    if (!row) return false;
    const step = await matchingStep(await unseal(env, row.secret_enc), digits, now);
    if (step == null) return false;
    // Atomic: a code that was already used (or an older one) cannot win a second time.
    const won = await env.RELAY_DB.prepare("UPDATE auth_totp SET last_step = ? WHERE shopper_id = ? AND last_step < ? RETURNING shopper_id").bind(step, shopperId, step).first();
    return Boolean(won);
  }
  if (normaliseRecovery(text).length === 10) {
    if (!(await twoStepOn(env, shopperId))) return false;
    const used = await env.RELAY_DB.prepare("UPDATE auth_totp_recovery SET used_at = ? WHERE code_hash = ? AND shopper_id = ? AND used_at IS NULL RETURNING code_hash")
      .bind(now, await recoveryHash(shopperId, text), shopperId).first();
    return Boolean(used);
  }
  return false;
}

// Which second steps are on: { app, text (the phone's last digits, or null) }.
async function methodsOn(env, shopperId) {
  const app = await env.RELAY_DB.prepare("SELECT 1 AS on1 FROM auth_totp WHERE shopper_id = ? AND enabled = 1").bind(shopperId).first();
  const text = await env.RELAY_DB.prepare("SELECT phone_end FROM auth_phone WHERE shopper_id = ? AND two_step = 1").bind(shopperId).first();
  return { app: Boolean(app), text: text ? text.phone_end : null };
}
export async function twoStepOn(env, shopperId) { const m = await methodsOn(env, shopperId); return m.app || Boolean(m.text); }

// Called by sign-in. Returns null when no second step is needed.
export async function secondStepFor(env, shopperId, now) {
  const on = await methodsOn(env, shopperId);
  if (!on.app && !on.text) return null;
  const recent = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM auth_2fa_pending WHERE shopper_id = ? AND created_at > ?").bind(shopperId, now - FAIL_WINDOW_MS).first();
  if ((recent?.n || 0) >= 10) return { tooMany: true };
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = b64u(bytes);
  await env.RELAY_DB.prepare("INSERT INTO auth_2fa_pending (token_hash, shopper_id, created_at, expires_at) VALUES (?,?,?,?)")
    .bind(await sha256Hex(token), shopperId, now, now + PENDING_TTL_MS).run();
  await env.RELAY_DB.prepare("DELETE FROM auth_2fa_pending WHERE expires_at <= ?").bind(now - FAIL_WINDOW_MS).run();
  // Texts first: the code arrives by itself, so it's the quickest way through.
  return { pendingToken: token, methods: [...(on.text ? ["text"] : []), ...(on.app ? ["app"] : [])], ...(on.text ? { phoneEnding: on.text } : {}) };
}

// Not signed in yet: text the code for a half-finished sign-in, or finish it with a texted, app or recovery code.
export async function handleTotpAuthRoute(path, method, request, env, cors, o, h) {
  if ((path !== "/relay/auth/2fa/verify" && path !== "/relay/auth/2fa/text") || method !== "POST") return null;
  const { now } = o;
  const origin = request.headers.get("origin");
  if (origin && !h.allowedOrigins(env).has(origin)) return h.json({ error: "origin_not_allowed" }, 403, cors);
  const body = await h.readJson(request, 2048);
  const fail = () => h.json({ error: "invalid_code" }, 400, cors);
  const token = body && typeof body.pendingToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(body.pendingToken) ? body.pendingToken : "";
  if (path === "/relay/auth/2fa/text") {
    if (!token) return h.json({ error: "sign_in_expired" }, 400, cors);
    const tokenHash = await sha256Hex(token);
    const open = await env.RELAY_DB.prepare("SELECT shopper_id FROM auth_2fa_pending WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND attempts < ?")
      .bind(tokenHash, now, MAX_PENDING_TRIES).first();
    if (!open) return h.json({ error: "sign_in_expired" }, 400, cors);
    const phone = await confirmedPhone(env, open.shopper_id);
    if (!phone || !phone.twoStep) return h.json({ error: "no_phone" }, 400, cors);
    return textResponse(await issueTextCode(env, o, { shopperId: open.shopper_id, purpose: "signin", ref: tokenHash, phone: phone.phone, clientHash: await clientHashOf(request) }), h, cors);
  }
  if (!token || typeof body.code !== "string" || body.code.length > 40) return fail();
  const pending = await env.RELAY_DB.prepare(
    `UPDATE auth_2fa_pending SET attempts = attempts + 1
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND attempts < ? RETURNING shopper_id`)
    .bind(await sha256Hex(token), now, MAX_PENDING_TRIES).first();
  if (!pending) return h.json({ error: "sign_in_expired" }, 400, cors);
  if (await tooManyFails(env, pending.shopper_id, now)) return h.json({ error: "too_many_requests" }, 429, cors);
  if (!(await checkCode(env, pending.shopper_id, body.code, now, ["signin", await sha256Hex(token)]))) { await recordFail(env, pending.shopper_id, now); return fail(); }
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

  const on = await methodsOn(env, shopper.id);
  const recoveryLeft = async () => (await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM auth_totp_recovery WHERE shopper_id = ? AND used_at IS NULL").bind(shopper.id).first())?.n || 0;
  // Fresh recovery codes, shown once (only hashes are kept). Replaces any earlier set.
  const newRecoveryCodes = async () => {
    const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
    const hashes = await Promise.all(codes.map(c => recoveryHash(shopper.id, c)));
    return { codes, statements: [env.RELAY_DB.prepare("DELETE FROM auth_totp_recovery WHERE shopper_id = ?").bind(shopper.id),
      ...hashes.map(x => env.RELAY_DB.prepare("INSERT INTO auth_totp_recovery (code_hash, shopper_id) VALUES (?,?)").bind(x, shopper.id))] };
  };

  if (path === "/relay/my/2fa" && method === "GET") {
    const phone = on.text ? null : await env.RELAY_DB.prepare("SELECT phone_end FROM auth_phone WHERE shopper_id = ?").bind(shopper.id).first();
    return h.json({ enabled: on.app || Boolean(on.text), app: on.app, text: Boolean(on.text), phoneEnding: on.text || (phone ? phone.phone_end : null),
      textAvailable: textConfigured(env), recoveryCodesLeft: on.app || on.text ? await recoveryLeft() : 0 }, 200, cors);
  }
  if (method !== "POST") return null;

  // One way at a time: texts or an app. Otherwise someone holding a stolen session could add their own way (no code from
  // the shopper's needed) and then use it to switch the shopper's off. Switching ways means turning the first one off,
  // which takes a code from it or a recovery code.
  // Codes by text. Turning it on proves the phone is in hand now: a code texted to the number being added, or (for a number
  // already on the account) one texted by /text/send. Turning it off needs a texted code or a recovery code.
  if (path === "/relay/my/2fa/text/send") {
    const phone = await confirmedPhone(env, shopper.id);
    if (!phone) return h.json({ error: "no_phone" }, 400, cors);
    return textResponse(await issueTextCode(env, o, { shopperId: shopper.id, purpose: "manage", ref: "manage:" + shopper.id, phone: phone.phone, clientHash: await clientHashOf(request) }), h, cors);
  }
  if (path === "/relay/my/2fa/text") {
    const b = await h.readJson(request, 2048);
    const code = b && typeof b.code === "string" && b.code.length <= 40 ? b.code : "";
    if (await tooManyFails(env, shopper.id, now)) return h.json({ error: "too_many_requests" }, 429, cors);
    if (b && b.on === true) {
      if (on.text) return h.json({ error: "already_enabled" }, 400, cors);
      if (on.app) return h.json({ error: "app_on" }, 409, cors);
      const managed = await useTextCode(env, shopper.id, "manage", "manage:" + shopper.id, code, now);
      if (managed) {
        const set = await env.RELAY_DB.prepare("UPDATE auth_phone SET two_step = 1, two_step_at = ? WHERE shopper_id = ? RETURNING shopper_id").bind(now, shopper.id).first();
        if (!set) return h.json({ error: "no_phone" }, 400, cors);
      } else if (!(await confirmNumberWithCode(env, shopper.id, code, now, { twoStep: true }))) { await recordFail(env, shopper.id, now); return h.json({ error: "invalid_code" }, 400, cors); }
      // The first way on comes with recovery codes, shown once.
      const fresh = await newRecoveryCodes();
      await env.RELAY_DB.batch(fresh.statements);
      return h.json({ ok: true, recoveryCodes: fresh.codes }, 200, cors);
    }
    if (b && b.on === false) {
      if (!on.text) return h.json({ error: "not_enabled" }, 400, cors);
      if (!(await checkCode(env, shopper.id, code, now, ["manage", "manage:" + shopper.id]))) { await recordFail(env, shopper.id, now); return h.json({ error: "invalid_code" }, 400, cors); }
      await env.RELAY_DB.batch([
        env.RELAY_DB.prepare("UPDATE auth_phone SET two_step = 0, two_step_at = NULL WHERE shopper_id = ?").bind(shopper.id),
        env.RELAY_DB.prepare("DELETE FROM auth_totp_recovery WHERE shopper_id = ?").bind(shopper.id)
      ]);
      return h.json({ ok: true }, 200, cors);
    }
    return h.json({ error: "invalid_request" }, 400, cors);
  }

  if (path === "/relay/my/2fa/setup") {
    if (row && row.enabled) return h.json({ error: "already_enabled" }, 400, cors);
    if (on.text) return h.json({ error: "text_on" }, 409, cors);
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
    if (on.text) return h.json({ error: "text_on" }, 409, cors);
    if (await tooManyFails(env, shopper.id, now)) return h.json({ error: "too_many_requests" }, 429, cors);
    const digits = code.replace(/\s/g, "");
    const step = /^\d{6}$/.test(digits) ? await matchingStep(await unseal(env, row.secret_enc), digits, now) : null;
    if (step == null) { await recordFail(env, shopper.id, now); return h.json({ error: "invalid_code" }, 400, cors); }
    const fresh = await newRecoveryCodes();
    await env.RELAY_DB.batch([...fresh.statements,
      env.RELAY_DB.prepare("UPDATE auth_totp SET enabled = 1, enabled_at = ?, last_step = ? WHERE shopper_id = ?").bind(now, step, shopper.id)]);
    return h.json({ ok: true, recoveryCodes: fresh.codes }, 200, cors); // shown once; only hashes are kept
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
