// Signing in on a computer (or another phone) by approving it from a phone that's already signed in, the way a
// messaging app links a computer. Nobody types a password, an email code or anything secret on the new device.
//
// 1. The new device asks for a request (POST /relay/auth/phone/start). It gets a short code to show on its screen and a
//    long secret of its own (the poll token) that only it holds. Both last 5 minutes; Relay keeps only their hashes.
// 2. On the signed-in phone, the shopper types that code (Profile → Settings → Sign in on another device).
//    Relay says which kind of device asked and when (POST /relay/my/devices/look), and the shopper taps Approve
//    (POST /relay/my/devices/approve). The code only ever finds a request: typing it never signs anyone in by itself.
// 3. The new device, while it shows the code, asks every few seconds whether it was approved (POST /relay/auth/phone/check
//    with its poll token). Once it was, it gets a session for the account that approved it, once.
//
// Codes are 8 characters from an alphabet without look-alikes (32^8, about a trillion), so guessing one while it's
// live is out of reach, and the phone side allows a few wrong codes per shopper before it stops. A new device signed in
// this way gets the same email as any other change to how someone signs in (security-mail.js).
// It passes the second step only when the phone that approved it had passed one.

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0 or 1
const CODE_LENGTH = 8;
const REQUEST_TTL_MS = 5 * 60 * 1000;
const MAX_WRONG_CODES = 8;          // per shopper, per 15 minutes
const WRONG_WINDOW_MS = 15 * 60 * 1000;
const MAX_LIVE_PER_ADDRESS = 5;     // live requests started from one network address at once

export const PHONE_SIGNIN_TABLE_SQL = [
  `CREATE TABLE IF NOT EXISTS auth_phone_requests (
     poll_hash TEXT PRIMARY KEY, code_hash TEXT NOT NULL, address_hash TEXT NOT NULL, device TEXT NOT NULL,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
     shopper_id TEXT, second_step INTEGER NOT NULL DEFAULT 0, approved_at INTEGER, used_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_phone_requests_code ON auth_phone_requests(code_hash)`,
  `CREATE TABLE IF NOT EXISTS auth_phone_code_failures (shopper_id TEXT NOT NULL, created_at INTEGER NOT NULL)`
];

const POLL_SHAPE = /^[A-Za-z0-9_-]{43}$/;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  // 256 is a multiple of 32, so every letter is equally likely.
  return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
// What the shopper typed, tidied: spaces, dashes and lower case don't matter.
export function tidyCode(raw) {
  const t = String(raw || "").toUpperCase().replace(/[\s-]/g, "");
  return new RegExp("^[" + CODE_ALPHABET + "]{" + CODE_LENGTH + "}$").test(t) ? t : "";
}
// "Chrome on a Mac": enough for the shopper to recognise the device in front of them, nothing more.
export function deviceName(ua) {
  const s = String(ua || "");
  const browser = /Edg\//.test(s) ? "Edge" : /Firefox\//.test(s) ? "Firefox" : /OPR\//.test(s) ? "Opera"
    : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "A browser";
  const system = /iPhone/.test(s) ? "an iPhone" : /iPad/.test(s) ? "an iPad" : /Android/.test(s) ? "an Android phone"
    : /Macintosh|Mac OS X/.test(s) ? "a Mac" : /Windows/.test(s) ? "a Windows computer" : /CrOS/.test(s) ? "a Chromebook"
    : /Linux/.test(s) ? "a Linux computer" : "";
  return system ? browser + " on " + system : browser;
}

// Routes before sign-in: starting a request and the new device asking whether it was approved.
export async function handlePhoneSigninStart(path, request, env, cors, o, h) {
  if (path === "/relay/auth/phone/start" && request.method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && !h.allowedOrigins(env).has(origin)) return h.json({ error: "origin_not_allowed" }, 403, cors);
    const address = await h.sha256Hex("phone-addr:" + h.addressOf(request));
    const live = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM auth_phone_requests WHERE address_hash = ? AND expires_at > ? AND used_at IS NULL")
      .bind(address, o.now).first();
    if ((live?.n || 0) >= MAX_LIVE_PER_ADDRESS) return h.json({ error: "too_many_requests" }, 429, cors);
    await env.RELAY_DB.prepare("DELETE FROM auth_phone_requests WHERE expires_at <= ?").bind(o.now - 60 * 60 * 1000).run();
    const pollToken = h.randomToken(), code = newCode();
    await env.RELAY_DB.prepare(
      "INSERT INTO auth_phone_requests (poll_hash, code_hash, address_hash, device, created_at, expires_at) VALUES (?,?,?,?,?,?)")
      .bind(await h.sha256Hex("phone-poll:" + pollToken), await h.sha256Hex("phone-code:" + code), address,
        deviceName(request.headers.get("user-agent")), o.now, o.now + REQUEST_TTL_MS).run();
    return h.json({ pollToken, code, expiresAt: o.now + REQUEST_TTL_MS }, 200, cors);
  }
  if (path === "/relay/auth/phone/check" && request.method === "POST") {
    const body = await h.readJson(request);
    const poll = body && typeof body.pollToken === "string" && POLL_SHAPE.test(body.pollToken) ? body.pollToken : "";
    if (!poll) return h.json({ error: "invalid_request" }, 400, cors);
    const pollHash = await h.sha256Hex("phone-poll:" + poll);
    // Taken once: the first check after approval marks it used and gets the session.
    const done = await env.RELAY_DB.prepare(
      `UPDATE auth_phone_requests SET used_at = ? WHERE poll_hash = ? AND approved_at IS NOT NULL AND used_at IS NULL AND expires_at > ?
       RETURNING shopper_id, second_step`).bind(o.now, pollHash, o.now).first();
    if (done) {
      const shopper = await env.RELAY_DB.prepare("SELECT email FROM shoppers WHERE id = ?").bind(done.shopper_id).first();
      if (!shopper) return h.json({ error: "expired" }, 410, cors);
      return h.startSession(env, shopper.email, o.now, cors, Number(done.second_step) === 1 ? { skipSecondStep: true } : {});
    }
    const row = await env.RELAY_DB.prepare("SELECT expires_at, used_at FROM auth_phone_requests WHERE poll_hash = ?").bind(pollHash).first();
    if (!row || row.used_at || row.expires_at <= o.now) return h.json({ error: "expired" }, 410, cors);
    return h.json({ waiting: true }, 200, cors);
  }
  return null;
}

// Routes on the phone that's already signed in: finding a request by its code, then approving it.
export async function handlePhoneSigninApprove(path, request, env, cors, o, shopper, h) {
  if (path !== "/relay/my/devices/look" && path !== "/relay/my/devices/approve") return null;
  if (request.method !== "POST") return null;
  const origin = request.headers.get("origin");
  if (origin && !h.allowedOrigins(env).has(origin)) return h.json({ error: "origin_not_allowed" }, 403, cors);
  const wrong = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM auth_phone_code_failures WHERE shopper_id = ? AND created_at > ?")
    .bind(shopper.id, o.now - WRONG_WINDOW_MS).first();
  if ((wrong?.n || 0) >= MAX_WRONG_CODES) return h.json({ error: "too_many_requests" }, 429, cors);
  const body = await h.readJson(request);
  const code = tidyCode(body && body.code);
  const codeHash = code ? await h.sha256Hex("phone-code:" + code) : "";
  const row = code ? await env.RELAY_DB.prepare(
    "SELECT poll_hash, device, created_at FROM auth_phone_requests WHERE code_hash = ? AND approved_at IS NULL AND used_at IS NULL AND expires_at > ?")
    .bind(codeHash, o.now).first() : null;
  if (!row) {
    await env.RELAY_DB.prepare("INSERT INTO auth_phone_code_failures (shopper_id, created_at) VALUES (?,?)").bind(shopper.id, o.now).run();
    await env.RELAY_DB.prepare("DELETE FROM auth_phone_code_failures WHERE created_at <= ?").bind(o.now - WRONG_WINDOW_MS).run();
    return h.json({ error: "code_not_found" }, 404, cors);
  }
  if (path === "/relay/my/devices/look") return h.json({ device: row.device, startedAt: row.created_at }, 200, cors);
  const approved = await env.RELAY_DB.prepare(
    "UPDATE auth_phone_requests SET shopper_id = ?, second_step = ?, approved_at = ? WHERE poll_hash = ? AND approved_at IS NULL AND used_at IS NULL AND expires_at > ? RETURNING device")
    .bind(shopper.id, shopper.secondStep ? 1 : 0, o.now, row.poll_hash, o.now).first();
  if (!approved) return h.json({ error: "code_not_found" }, 404, cors);
  await env.RELAY_DB.prepare("DELETE FROM auth_phone_code_failures WHERE shopper_id = ?").bind(shopper.id).run();
  await h.tellShopper(env, o, shopper.email, "device_approved", { device: approved.device });
  return h.json({ ok: true, device: approved.device }, 200, cors);
}
