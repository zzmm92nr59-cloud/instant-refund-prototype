// Phone numbers and text-message codes. A shopper confirms a mobile number with a texted code, and can then have a code
// texted as the second step of signing in by email, Google or Microsoft (two-step sign-in lives in totp.js; this file is
// the number and the texts). Passkey (Face ID) sign-in never needs it.
//
// Rules (do not weaken):
//  * The number is stored encrypted (AES-GCM, key derived from AUTH_SECRET). The app shows it only as its last three
//    digits; "Download my data" gives the account holder the whole number.
//  * Codes are random, 6 digits, work once, expire after 10 minutes and are stored only as keyed hashes bound to what they
//    were sent for (confirming this shopper's number, one half-finished sign-in, or changing two-step settings), so a code
//    sent for one thing is useless for anything else. Only the newest code for each thing works, and five wrong tries
//    (counted before the code is compared, so tries sent all at once can't slip past) and it's dead.
//  * UK mobile numbers only (07…; not 070 personal numbers or 076 pagers): no premium-rate or international texts.
//  * Texts are capped per shopper, per number, per device address and across all of Relay each day, so nobody can run up a
//    bill or flood someone's phone. Each text is checked against every cap and recorded in one database step, so requests
//    sent all at once can't slip past. Codes to confirm a new number (which anyone with an account can ask for, to any
//    number) have caps of their own, so a stranger can't use them up and stop someone's sign-in codes. The caps survive
//    account deletion: the log keeps only scrambled accounts, numbers and addresses.
//  * Each text ends with "@<app host> #<code>", the standard line that lets iPhones and Android phones offer the code
//    straight from the notification (and only on Relay's own site).
//  * Texts go through Twilio only when its secrets are set. Without them nothing pretends to send: the routes say texts
//    aren't available and the app doesn't offer them.
const enc = new TextEncoder();
const DEFAULT_APP_URL = "https://zzmm92nr59-cloud.github.io/instant-refund-prototype/";
const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_AFTER_MS = 30 * 1000;
const MAX_CODE_TRIES = 5;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Per account (every kind of text); per number, separately for "confirm a new number" and the account's own texts (sign-in
// and changing two-step); per device address for "confirm" texts only (many phones share one address on mobile data).
const LIMITS = { shopperHour: 5, shopperDay: 10, confirmNumberHour: 3, confirmNumberDay: 5, accountNumberHour: 5, accountNumberDay: 10, confirmClientHour: 10 };
// Across Relay each day: SMS_DAILY_LIMIT for "confirm" texts, SMS_ACCOUNT_DAILY_LIMIT for the rest.
const DEFAULT_CONFIRM_DAILY = 200, DEFAULT_ACCOUNT_DAILY = 1000;

export const PHONE_TABLE_SQL = [
  `CREATE TABLE IF NOT EXISTS auth_phone (
     shopper_id TEXT PRIMARY KEY, phone_enc TEXT NOT NULL, phone_end TEXT NOT NULL,
     confirmed_at INTEGER NOT NULL, two_step INTEGER NOT NULL DEFAULT 0, two_step_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS auth_sms_codes (
     code_hash TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, purpose TEXT NOT NULL, ref TEXT NOT NULL,
     phone_enc TEXT NOT NULL, phone_end TEXT NOT NULL, phone_hash TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_sms_codes_ref ON auth_sms_codes(ref, purpose, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sms_codes_shopper ON auth_sms_codes(shopper_id, created_at)`,
  // Every text asked for, for the caps only: scrambled account, number, device address and what it was for, and when.
  `CREATE TABLE IF NOT EXISTS auth_sms_log (who_hash TEXT NOT NULL, phone_hash TEXT NOT NULL, client_hash TEXT NOT NULL,
     ref_hash TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_sms_log_who ON auth_sms_log(who_hash, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sms_log_phone ON auth_sms_log(phone_hash, kind, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sms_log_client ON auth_sms_log(client_hash, kind, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sms_log_ref ON auth_sms_log(ref_hash, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sms_log_kind ON auth_sms_log(kind, created_at)`
];

export function phoneDeleteStatements(db, shopperId) {
  return [
    db.prepare("DELETE FROM auth_phone WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM auth_sms_codes WHERE shopper_id = ?").bind(shopperId)
  ];
}

export function textConfigured(env) {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID) &&
    env.AUTH_SECRET && String(env.AUTH_SECRET).length >= 16);
}

// "07700 900123", "+44 (0)7700 900123", "00447700900123" → "+447700900123". Anything that isn't a UK mobile → null.
export function normaliseUkMobile(raw) {
  if (typeof raw !== "string" || raw.length > 32) return null;
  let t = raw.trim().replace(/\(0\)/g, "").replace(/[\s().\-]/g, "");
  if (/^00/.test(t)) t = "+" + t.slice(2);
  else if (/^44/.test(t)) t = "+" + t;
  else if (/^0/.test(t)) t = "+44" + t.slice(1);
  return /^\+447(?:[1-57-9]\d{8}|624\d{6})$/.test(t) ? t : null;
}

const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = t => { t = String(t).replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; return Uint8Array.from(atob(t), c => c.charCodeAt(0)); };
async function sha256Hex(text) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(text))); }
async function keyed(env, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}
async function aesKey(env) {
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode("relay-phone-v1:" + env.AUTH_SECRET)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function sealPhone(env, phone) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return b64u(iv) + "." + b64u(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(phone)));
}
export async function openPhone(env, sealed) {
  const [iv, ct] = String(sealed).split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await aesKey(env), unb64u(ct)));
}
export const clientHashOf = request => sha256Hex("client:" + (request.headers.get("cf-connecting-ip") || "unknown"));
const codeHash = (env, purpose, ref, code) => keyed(env, "relay-sms:" + purpose + ":" + ref + ":" + code);
function newCode() {
  // Rejection sampling, so every 6-digit code is equally likely.
  for (;;) { const n = crypto.getRandomValues(new Uint32Array(1))[0]; if (n < 4294000000) return String(n % 1000000).padStart(6, "0"); }
}

// What each text says. The code comes first so it shows in the notification; the last line is the standard one that
// lets the phone offer the code on Relay's site only. Plain characters only, so it stays one text.
function textFor(env, purpose, code) {
  const host = new URL(env.RELAY_APP_URL || DEFAULT_APP_URL).hostname;
  const what = purpose === "signin" ? "sign-in code" : purpose === "confirm" ? "code to confirm this number" : "code to change your sign-in settings";
  return code + " is your Relay " + what + ". It expires in 10 minutes. Don't share it with anyone.\n\n@" + host + " #" + code;
}

async function sendText(env, fetchImpl, to, body) {
  const form = new URLSearchParams({ To: to, Body: body });
  if (env.TWILIO_MESSAGING_SERVICE_SID) form.set("MessagingServiceSid", env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set("From", env.TWILIO_FROM);
  try {
    const res = await fetchImpl("https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(env.TWILIO_ACCOUNT_SID) + "/Messages.json", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(env.TWILIO_ACCOUNT_SID + ":" + env.TWILIO_AUTH_TOKEN), "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });
    // The status only: never the number, the code or Twilio's own wording.
    if (!res.ok) console.error("text message not sent", res.status);
    return res.ok;
  } catch { return false; }
}

// Sends a code for one purpose. Returns { ok, ending, resendIn } or { error, status, retryAfter? }.
export async function issueTextCode(env, o, { shopperId, purpose, ref, phone, clientHash }) {
  const db = env.RELAY_DB, now = o.now;
  if (!textConfigured(env)) return { error: "sms_not_configured", status: 503 };
  const kind = purpose === "confirm" ? "confirm" : "account";
  const who = await keyed(env, "relay-shopper:" + shopperId), phoneHash = await keyed(env, "relay-phone:" + phone);
  const refHash = await keyed(env, "relay-ref:" + purpose + ":" + ref);
  const confirm = kind === "confirm";
  const daily = Number(confirm ? env.SMS_DAILY_LIMIT : env.SMS_ACCOUNT_DAILY_LIMIT) > 0 ? Number(confirm ? env.SMS_DAILY_LIMIT : env.SMS_ACCOUNT_DAILY_LIMIT)
    : confirm ? DEFAULT_CONFIRM_DAILY : DEFAULT_ACCOUNT_DAILY;
  // One step: checked against every cap (and the short wait between texts for the same thing) and recorded together.
  const booked = await db.prepare(
    `INSERT INTO auth_sms_log (who_hash, phone_hash, client_hash, ref_hash, kind, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6
     WHERE NOT EXISTS (SELECT 1 FROM auth_sms_log WHERE ref_hash = ?4 AND created_at > ?6 - ?7)
       AND (SELECT COUNT(*) FROM auth_sms_log WHERE who_hash = ?1 AND created_at > ?6 - ?8) < ?10
       AND (SELECT COUNT(*) FROM auth_sms_log WHERE who_hash = ?1 AND created_at > ?6 - ?9) < ?11
       AND (SELECT COUNT(*) FROM auth_sms_log WHERE phone_hash = ?2 AND kind = ?5 AND created_at > ?6 - ?8) < ?12
       AND (SELECT COUNT(*) FROM auth_sms_log WHERE phone_hash = ?2 AND kind = ?5 AND created_at > ?6 - ?9) < ?13
       AND (?5 <> 'confirm' OR (SELECT COUNT(*) FROM auth_sms_log WHERE client_hash = ?3 AND kind = 'confirm' AND created_at > ?6 - ?8) < ?14)
       AND (SELECT COUNT(*) FROM auth_sms_log WHERE kind = ?5 AND created_at > ?6 - ?9) < ?15
     RETURNING created_at`)
    .bind(who, phoneHash, clientHash, refHash, kind, now, RESEND_AFTER_MS, HOUR_MS, DAY_MS, LIMITS.shopperHour, LIMITS.shopperDay,
      confirm ? LIMITS.confirmNumberHour : LIMITS.accountNumberHour, confirm ? LIMITS.confirmNumberDay : LIMITS.accountNumberDay, LIMITS.confirmClientHour, daily).first();
  if (!booked) {
    const last = await db.prepare("SELECT MAX(created_at) AS t FROM auth_sms_log WHERE ref_hash = ?").bind(refHash).first();
    if (last && last.t && now - last.t < RESEND_AFTER_MS) return { error: "wait", status: 429, retryAfter: Math.max(1, Math.ceil((RESEND_AFTER_MS - (now - last.t)) / 1000)) };
    return { error: "too_many_requests", status: 429 };
  }
  // Only the newest code for each thing works (and only the newest number asked for can be confirmed).
  await db.prepare("UPDATE auth_sms_codes SET used_at = ? WHERE purpose = ? AND ref = ? AND used_at IS NULL").bind(now, purpose, ref).run();
  const code = newCode(), hash = await codeHash(env, purpose, ref, code), ending = phone.slice(-3);
  await db.prepare(
    `INSERT INTO auth_sms_codes (code_hash, shopper_id, purpose, ref, phone_enc, phone_end, phone_hash, created_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?)`).bind(hash, shopperId, purpose, ref, await sealPhone(env, phone), ending, phoneHash, now, now + CODE_TTL_MS).run();
  // A text Twilio turns down still counts towards the caps (it was booked above), but leaves no code behind.
  if (!(await sendText(env, o.fetchImpl, phone, textFor(env, purpose, code)))) {
    await db.prepare("DELETE FROM auth_sms_codes WHERE code_hash = ?").bind(hash).run();
    return { error: "sms_send_failed", status: 502 };
  }
  await tidyTexts(env, now);
  return { ok: true, ending, resendIn: RESEND_AFTER_MS / 1000 };
}

// Codes and the send log go after two days. Also run on Relay's hourly schedule, so nothing outlives that when no texts go.
export async function tidyTexts(env, now = Date.now()) {
  if (!env.RELAY_DB) return;
  try {
    await env.RELAY_DB.batch([
      env.RELAY_DB.prepare("DELETE FROM auth_sms_log WHERE created_at <= ?").bind(now - 2 * DAY_MS),
      env.RELAY_DB.prepare("DELETE FROM auth_sms_codes WHERE created_at <= ?").bind(now - 2 * DAY_MS)
    ]);
  } catch (e) { if (!/no such table/i.test(String(e && e.message))) throw e; }
}

// Uses up a texted code. Returns the row it matched ({ phone_enc, phone_end }) or null.
// The try is counted first, in the same step that finds the live code, so tries sent all at once each use one of the five.
export async function useTextCode(env, shopperId, purpose, ref, code, now) {
  const digits = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const db = env.RELAY_DB;
  const live = (await db.prepare(
    `UPDATE auth_sms_codes SET attempts = attempts + 1
     WHERE shopper_id = ? AND purpose = ? AND ref = ? AND used_at IS NULL AND expires_at > ? AND attempts < ? RETURNING code_hash`)
    .bind(shopperId, purpose, ref, now, MAX_CODE_TRIES).all()).results || [];
  const hash = await codeHash(env, purpose, ref, digits);
  if (!live.some(r => r.code_hash === hash)) return null;
  return await db.prepare("UPDATE auth_sms_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL RETURNING phone_enc, phone_end").bind(now, hash).first();
}

// The shopper's confirmed number ({ phone, ending, twoStep }) or null.
export async function confirmedPhone(env, shopperId) {
  const row = await env.RELAY_DB.prepare("SELECT phone_enc, phone_end, two_step FROM auth_phone WHERE shopper_id = ?").bind(shopperId).first();
  if (!row) return null;
  return { phone: await openPhone(env, row.phone_enc), ending: row.phone_end, twoStep: Boolean(row.two_step) };
}

// A code texted to confirm a new number: if it's right, that number becomes the shopper's number.
export async function confirmNumberWithCode(env, shopperId, code, now, opts = {}) {
  const used = await useTextCode(env, shopperId, "confirm", "confirm:" + shopperId, code, now);
  if (!used) return null;
  await env.RELAY_DB.prepare(
    `INSERT INTO auth_phone (shopper_id, phone_enc, phone_end, confirmed_at, two_step, two_step_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(shopper_id) DO UPDATE SET phone_enc = excluded.phone_enc, phone_end = excluded.phone_end, confirmed_at = excluded.confirmed_at,
       two_step = excluded.two_step, two_step_at = excluded.two_step_at`)
    .bind(shopperId, used.phone_enc, used.phone_end, now, opts.twoStep ? 1 : 0, opts.twoStep ? now : null).run();
  return { ending: used.phone_end };
}

export function textResponse(r, h, cors) {
  if (r.ok) return h.json({ ok: true, ending: r.ending, resendIn: r.resendIn }, 200, cors);
  return h.json({ error: r.error, ...(r.retryAfter ? { retryAfter: r.retryAfter } : {}) }, r.status, cors);
}

// Signed in: the number on the account.
export async function handlePhoneRoute(path, method, request, env, cors, o, h, shopper) {
  if (path !== "/relay/my/phone" && !path.startsWith("/relay/my/phone/")) return null;
  const { now } = o, db = env.RELAY_DB;
  const origin = request.headers.get("origin");
  if (method === "POST" && origin && !h.allowedOrigins(env).has(origin)) return h.json({ error: "origin_not_allowed" }, 403, cors);
  const row = await db.prepare("SELECT phone_end, confirmed_at, two_step FROM auth_phone WHERE shopper_id = ?").bind(shopper.id).first();
  if (path === "/relay/my/phone" && method === "GET")
    return h.json({ available: textConfigured(env), ending: row ? row.phone_end : null, confirmedAt: row ? row.confirmed_at : null, twoStep: Boolean(row && row.two_step) }, 200, cors);
  if (method !== "POST") return null;
  const body = await h.readJson(request, 1024);
  // While codes for signing in go to this number, it can't be swapped or removed here: two-step sign-in comes off first
  // (which needs a code), so someone holding a stolen session can't move the second step to their own phone.
  if (path === "/relay/my/phone/start") {
    if (row && row.two_step) return h.json({ error: "two_step_on" }, 409, cors);
    const phone = normaliseUkMobile(body && body.phone);
    if (!phone) return h.json({ error: "phone_invalid" }, 400, cors);
    return textResponse(await issueTextCode(env, o, { shopperId: shopper.id, purpose: "confirm", ref: "confirm:" + shopper.id, phone, clientHash: await clientHashOf(request) }), h, cors);
  }
  if (path === "/relay/my/phone/confirm") {
    if (row && row.two_step) return h.json({ error: "two_step_on" }, 409, cors);
    const done = await confirmNumberWithCode(env, shopper.id, body && body.code, now);
    if (!done) return h.json({ error: "invalid_or_expired_code" }, 400, cors);
    return h.json({ ok: true, ending: done.ending }, 200, cors);
  }
  if (path === "/relay/my/phone/remove") {
    if (row && row.two_step) return h.json({ error: "two_step_on" }, 409, cors);
    await db.batch(phoneDeleteStatements(db, shopper.id));
    return h.json({ ok: true }, 200, cors);
  }
  return null;
}

// For "Download my data".
export async function exportPhone(env, shopperId) {
  try {
    const row = await env.RELAY_DB.prepare("SELECT phone_enc, confirmed_at, two_step, two_step_at FROM auth_phone WHERE shopper_id = ?").bind(shopperId).first();
    if (!row) return null;
    const iso = ms => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);
    let number = null;
    try { number = await openPhone(env, row.phone_enc); } catch { /* unreadable (the key changed): say so rather than fail the whole file */ }
    return { number, confirmedAt: iso(row.confirmed_at), signInCodesByText: Boolean(row.two_step), since: iso(row.two_step_at) };
  } catch (e) { if (/no such table/i.test(String(e && e.message))) return null; throw e; }
}
