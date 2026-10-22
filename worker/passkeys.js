// Passkeys ("Face ID" sign-in) using WebAuthn, ES256 (P-256) only.
//
// Design rules (do not weaken):
//  * Every challenge is random, stored hashed, single-use and short-lived; its purpose is checked.
//  * Registration and sign-in both require user verification (the Face ID / fingerprint / PIN step).
//  * The browser's origin and the relying-party hash are checked against the app's own address.
//  * Only the PUBLIC key is stored. The signature is checked against it on every sign-in.
//  * A passkey signs in the shopper it was registered for. No shopper ID is ever taken from the client.
//  * Attestation is "none": we do not claim to know what kind of authenticator it is.
const enc = new TextEncoder();
const HOUR_MS = 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_PASSKEYS_PER_SHOPPER = 5;
const MAX_OPTIONS_PER_CLIENT_PER_HOUR = 40;

export const PASSKEY_TABLE_SQL = [
  `CREATE TABLE IF NOT EXISTS auth_passkeys (
     credential_id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, public_key TEXT NOT NULL,
     sign_count INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_passkeys_shopper ON auth_passkeys(shopper_id)`,
  `CREATE TABLE IF NOT EXISTS auth_webauthn_challenges (
     challenge_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, shopper_id TEXT, client_hash TEXT NOT NULL,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`
];

export function passkeyDeleteStatements(db, shopperId) {
  return [db.prepare("DELETE FROM auth_passkeys WHERE shopper_id = ?").bind(shopperId)];
}

const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function unb64u(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("base64url");
  const t = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), c => c.charCodeAt(0));
}
async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)); }
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---- Minimal CBOR reader (enough for attestation objects and COSE keys) ----
function cborDecode(bytes, start = 0, depth = 0) {
  if (depth > 8) throw new Error("cbor depth");
  let off = start;
  const need = n => { if (off + n > bytes.length) throw new Error("cbor short"); };
  need(1);
  const first = bytes[off++], major = first >> 5, info = first & 31;
  const len = () => {
    if (info < 24) return info;
    if (info === 24) { need(1); return bytes[off++]; }
    if (info === 25) { need(2); const v = (bytes[off] << 8) | bytes[off + 1]; off += 2; return v; }
    if (info === 26) { need(4); const v = bytes[off] * 2 ** 24 + (bytes[off + 1] << 16) + (bytes[off + 2] << 8) + bytes[off + 3]; off += 4; return v; }
    throw new Error("cbor length");
  };
  if (major === 0) return [len(), off];
  if (major === 1) return [-1 - len(), off];
  if (major === 2 || major === 3) {
    const n = len(); need(n);
    const v = bytes.slice(off, off + n); off += n;
    return [major === 3 ? new TextDecoder().decode(v) : v, off];
  }
  if (major === 4) {
    const n = len(); if (n > 64) throw new Error("cbor size");
    const out = [];
    for (let i = 0; i < n; i++) { const [v, o] = cborDecode(bytes, off, depth + 1); out.push(v); off = o; }
    return [out, off];
  }
  if (major === 5) {
    const n = len(); if (n > 64) throw new Error("cbor size");
    const out = new Map();
    for (let i = 0; i < n; i++) {
      const [k, o1] = cborDecode(bytes, off, depth + 1);
      const [v, o2] = cborDecode(bytes, o1, depth + 1);
      out.set(k, v); off = o2;
    }
    return [out, off];
  }
  if (major === 7) { if (info === 20) return [false, off]; if (info === 21) return [true, off]; if (info === 22) return [null, off]; }
  throw new Error("cbor unsupported");
}

function parseAuthData(ad) {
  if (ad.length < 37) throw new Error("authData short");
  return { rpIdHash: ad.slice(0, 32), flags: ad[32], signCount: ad[33] * 2 ** 24 + (ad[34] << 16) + (ad[35] << 8) + ad[36], rest: ad.slice(37) };
}
const FLAG_UP = 0x01, FLAG_UV = 0x04, FLAG_AT = 0x40;

function derToRaw(der) {
  if (der[0] !== 0x30) throw new Error("der");
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const readInt = () => {
    if (der[i++] !== 0x02) throw new Error("der");
    const l = der[i++];
    let v = der.slice(i, i + l); i += l;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error("der");
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
  };
  const r = readInt(), s = readInt();
  return concat(r, s);
}

// Verifies clientDataJSON and returns its challenge's hash record. Throws on any mismatch.
async function checkClientData(env, h, clientDataB64, expectedType, purpose, now) {
  const raw = unb64u(clientDataB64);
  if (raw.length > 4000) throw new Error("clientData size");
  const cd = JSON.parse(new TextDecoder().decode(raw));
  if (!cd || cd.type !== expectedType || cd.crossOrigin === true) throw new Error("clientData type");
  if (typeof cd.origin !== "string" || !h.allowedOrigins(env).has(cd.origin)) throw new Error("origin");
  const host = new URL(cd.origin).hostname;
  if (host !== h.rpId(env) && !host.endsWith("." + h.rpId(env))) throw new Error("rp");
  if (typeof cd.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(cd.challenge)) throw new Error("challenge");
  const claimed = await env.RELAY_DB.prepare(
    "UPDATE auth_webauthn_challenges SET used_at = ? WHERE challenge_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? RETURNING shopper_id")
    .bind(now, await h.sha256Hex("webauthn:" + cd.challenge), purpose, now).first();
  if (!claimed) throw new Error("challenge used or expired");
  return { raw, shopperId: claimed.shopper_id };
}

async function newChallenge(request, env, h, purpose, shopperId, now) {
  const client = await h.sha256Hex("client:" + (request.headers.get("cf-connecting-ip") || "unknown"));
  await env.RELAY_DB.prepare("DELETE FROM auth_webauthn_challenges WHERE expires_at <= ?").bind(now).run();
  const n = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM auth_webauthn_challenges WHERE client_hash = ? AND created_at > ?").bind(client, now - HOUR_MS).first();
  if ((n?.n || 0) >= MAX_OPTIONS_PER_CLIENT_PER_HOUR) return null;
  const challenge = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await env.RELAY_DB.prepare("INSERT INTO auth_webauthn_challenges (challenge_hash,purpose,shopper_id,client_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)")
    .bind(await h.sha256Hex("webauthn:" + challenge), purpose, shopperId, client, now, now + CHALLENGE_TTL_MS).run();
  return challenge;
}

// Not signed in: sign in with a passkey.
export async function handlePasskeyAuthRoute(path, method, request, env, cors, o, h) {
  if (method !== "POST") return null;
  const { now } = o;
  if (path !== "/relay/auth/passkey/options" && path !== "/relay/auth/passkey/verify") return null;
  const origin = request.headers.get("origin");
  if (origin && !h.allowedOrigins(env).has(origin)) return h.json({ error: "origin_not_allowed" }, 403, cors);
  if (path === "/relay/auth/passkey/options") {
    const challenge = await newChallenge(request, env, h, "login", null, now);
    if (!challenge) return h.json({ error: "too_many_requests" }, 429, cors);
    return h.json({ challenge, rpId: h.rpId(env), timeout: 60000, userVerification: "required" }, 200, cors);
  }
  const body = await h.readJson(request, 20000);
  const fail = () => h.json({ error: "passkey_failed" }, 400, cors);
  try {
    const r = body && body.response;
    if (!body || !r || typeof body.id !== "string" || body.id.length > 1400) return fail();
    const cred = await env.RELAY_DB.prepare(
      "SELECT p.credential_id, p.public_key, p.sign_count, s.id AS shopper_id, s.email FROM auth_passkeys p JOIN shoppers s ON s.id = p.shopper_id WHERE p.credential_id = ?")
      .bind(body.id).first();
    // The challenge is spent even when the credential is unknown, so guessing gains nothing.
    const cd = await checkClientData(env, h, r.clientDataJSON, "webauthn.get", "login", now);
    if (!cred) return fail();
    const authData = unb64u(r.authenticatorData);
    if (authData.length < 37 || authData.length > 2000) return fail();
    const ad = parseAuthData(authData);
    if (!same(ad.rpIdHash, await sha256(enc.encode(h.rpId(env))))) return fail();
    if (!(ad.flags & FLAG_UP) || !(ad.flags & FLAG_UV)) return fail();
    if (typeof r.userHandle === "string" && r.userHandle.length) {
      if (new TextDecoder().decode(unb64u(r.userHandle)) !== cred.shopper_id) return fail();
    }
    const key = await crypto.subtle.importKey("raw", unb64u(cred.public_key), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(unb64u(r.signature)), concat(authData, await sha256(cd.raw)));
    if (!ok) return fail();
    // A counter that goes backwards suggests a cloned authenticator. (Many platform passkeys always report 0.)
    if ((ad.signCount !== 0 || cred.sign_count !== 0) && ad.signCount <= cred.sign_count) return fail();
    await env.RELAY_DB.prepare("UPDATE auth_passkeys SET sign_count = ?, last_used_at = ? WHERE credential_id = ?").bind(ad.signCount, now, cred.credential_id).run();
    return await h.startSession(env, cred.email, now, cors, { skipSecondStep: true });
  } catch { return fail(); }
}

// Signed in: add, list and remove this shopper's passkeys.
export async function handlePasskeyShopperRoute(path, method, request, env, cors, o, h, shopper) {
  const { now } = o;
  if (path === "/relay/my/passkeys" && method === "GET") {
    const rows = await env.RELAY_DB.prepare("SELECT credential_id AS id, name, created_at AS createdAt, last_used_at AS lastUsedAt FROM auth_passkeys WHERE shopper_id = ? ORDER BY created_at").bind(shopper.id).all();
    return h.json({ passkeys: rows.results || [], rpId: h.rpId(env) }, 200, cors);
  }
  if (path === "/relay/my/passkeys/options" && method === "POST") {
    const have = await env.RELAY_DB.prepare("SELECT credential_id AS id FROM auth_passkeys WHERE shopper_id = ?").bind(shopper.id).all();
    if ((have.results || []).length >= MAX_PASSKEYS_PER_SHOPPER) return h.json({ error: "too_many_passkeys" }, 400, cors);
    const challenge = await newChallenge(request, env, h, "register", shopper.id, now);
    if (!challenge) return h.json({ error: "too_many_requests" }, 429, cors);
    return h.json({
      challenge, rp: { id: h.rpId(env), name: "Relay" },
      user: { id: b64u(enc.encode(shopper.id)), name: shopper.email, displayName: shopper.email },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      attestation: "none", timeout: 60000,
      excludeCredentials: (have.results || []).map(c => ({ type: "public-key", id: c.id }))
    }, 200, cors);
  }
  if (path === "/relay/my/passkeys/register" && method === "POST") {
    const body = await h.readJson(request, 20000);
    const fail = () => h.json({ error: "passkey_failed" }, 400, cors);
    try {
      const r = body && body.response;
      if (!r) return fail();
      const cd = await checkClientData(env, h, r.clientDataJSON, "webauthn.create", "register", now);
      if (cd.shopperId !== shopper.id) return fail(); // the challenge was issued to someone else
      const att = unb64u(r.attestationObject);
      if (att.length > 8000) return fail();
      const [obj] = cborDecode(att);
      const authData = obj instanceof Map ? obj.get("authData") : null;
      if (!(authData instanceof Uint8Array)) return fail();
      const ad = parseAuthData(authData);
      if (!same(ad.rpIdHash, await sha256(enc.encode(h.rpId(env))))) return fail();
      if (!(ad.flags & FLAG_UP) || !(ad.flags & FLAG_UV) || !(ad.flags & FLAG_AT)) return fail();
      const idLen = (ad.rest[16] << 8) | ad.rest[17];
      if (idLen < 16 || idLen > 1023) return fail();
      const credId = ad.rest.slice(18, 18 + idLen);
      const [cose] = cborDecode(ad.rest, 18 + idLen);
      if (!(cose instanceof Map) || cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1) return fail();
      const x = cose.get(-2), y = cose.get(-3);
      if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) return fail();
      const pub = concat(new Uint8Array([4]), x, y);
      await crypto.subtle.importKey("raw", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]); // must be a real curve point
      const id = b64u(credId);
      if (typeof body.id === "string" && body.id !== id) return fail();
      const n = await env.RELAY_DB.prepare("SELECT COUNT(*) AS n FROM auth_passkeys WHERE shopper_id = ?").bind(shopper.id).first();
      if ((n?.n || 0) >= MAX_PASSKEYS_PER_SHOPPER) return h.json({ error: "too_many_passkeys" }, 400, cors);
      const taken = await env.RELAY_DB.prepare("SELECT credential_id FROM auth_passkeys WHERE credential_id = ?").bind(id).first();
      if (taken) return fail();
      const name = String(body.name || "").replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 40) || "This device";
      await env.RELAY_DB.prepare("INSERT INTO auth_passkeys (credential_id,shopper_id,public_key,sign_count,name,created_at) VALUES (?,?,?,?,?,?)")
        .bind(id, shopper.id, b64u(pub), ad.signCount, name, now).run();
      return h.json({ ok: true, name }, 200, cors);
    } catch { return fail(); }
  }
  if (path === "/relay/my/passkeys/remove" && method === "POST") {
    const body = await h.readJson(request, 4000);
    const id = body && typeof body.id === "string" ? body.id : "";
    const gone = await env.RELAY_DB.prepare("DELETE FROM auth_passkeys WHERE credential_id = ? AND shopper_id = ? RETURNING credential_id").bind(id, shopper.id).first();
    return gone ? h.json({ ok: true }, 200, cors) : h.json({ error: "not_found" }, 404, cors);
  }
  return null;
}
