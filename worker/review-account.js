// The sign-in for app reviewers (Shopify's review team): one made-up address with a 6-digit code that stays the same
// while it's on, so a reviewer can sign in without an emailed code (Shopify App Store requirement 4.5.5).
//
// Rules (do not weaken):
//  * Off unless a Relay admin turns it on in the app. Turning it on makes a new random address at example.com, a domain
//    set aside for examples that nobody can receive email at, so the address can never be a real person's.
//  * The code is worked out from AUTH_SECRET and the address (HMAC), so it is never stored, never sent anywhere and never
//    in the code base. Only a Relay admin can see it (GET /relay/my/admin/review-account).
//  * Signing in still goes through the ordinary code route and its limits, plus a cap of 20 wrong codes a day.
//  * Several people share the account, so nothing personal can be attached to it: no inbox, passkey, phone number,
//    two-step sign-in or card (REVIEW_BLOCKED). Everything else works as for any shopper.
//  * Turning it off deletes the account and everything in it, as "Delete my account" does, which also signs it out
//    everywhere and cancels any code waiting to be used. Turning it on again makes a new address, code and account.
import { isAdmin } from "./resale-admin.js";

export const REVIEW_TABLE_SQL = [
  // One row at most. "address" rather than "email": it's a made-up address, not anyone's personal data.
  `CREATE TABLE IF NOT EXISTS review_account (
     id INTEGER PRIMARY KEY CHECK (id = 1), address TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)`
];
// What the shared account can't do (all POST): connect an inbox, add a passkey, two-step sign-in, a phone number or a card.
export const REVIEW_BLOCKED = new Set([
  "/relay/my/gmail/connect",
  "/relay/my/passkeys/options", "/relay/my/passkeys/register",
  "/relay/my/2fa/setup", "/relay/my/2fa/enable", "/relay/my/2fa/text", "/relay/my/2fa/text/send",
  "/relay/my/phone/start", "/relay/my/phone/confirm",
  "/relay/my/card/setup", "/relay/my/card/confirm"
]);
export const REVIEW_MAX_FAILURES_PER_DAY = 20;
const encoder = new TextEncoder();
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

// The address, or null when the reviewer sign-in is off.
export async function reviewAddress(env) {
  if (!env.RELAY_DB) return null;
  try {
    const row = await env.RELAY_DB.prepare("SELECT address FROM review_account WHERE id = 1").first();
    return row && row.address ? row.address : null;
  } catch { return null; } // no table yet: the sign-in has never been turned on
}
export async function isReviewAddress(env, email) {
  if (!email) return false;
  const address = await reviewAddress(env);
  return Boolean(address && address === email);
}
export function reviewBlocked(path, method) { return method === "POST" && REVIEW_BLOCKED.has(path); }

// The 6-digit code for an address: HMAC-SHA256 with AUTH_SECRET, kept apart from Relay's other uses of the secret by its label.
export async function reviewCode(env, email) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode("relay-review-code:v1:" + email)));
  const n = ((mac[0] << 24) >>> 0) + (mac[1] << 16) + (mac[2] << 8) + mac[3];
  return String(n % 1000000).padStart(6, "0");
}
function newAddress() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789", bytes = crypto.getRandomValues(new Uint8Array(10));
  return "relay-review-" + [...bytes].map(b => alphabet[b % alphabet.length]).join("") + "@example.com";
}
async function state(env) {
  const row = await env.RELAY_DB.prepare("SELECT address, created_at FROM review_account WHERE id = 1").first();
  if (!row) return { on: false };
  return { on: true, email: row.address, code: await reviewCode(env, row.address), since: row.created_at };
}

// GET /relay/my/admin/review-account: whether it's on, and the address and code. POST { on }: turn it on or off.
// Returns null for any other path. Anyone who isn't an admin gets "not found", as for the other admin routes.
// deleteShopper is auth.js's "Delete my account", passed in so both delete exactly the same things.
export async function handleReviewAdminRoute(path, method, request, env, cors, shopper, o, deleteShopper) {
  if (path !== "/relay/my/admin/review-account") return null;
  if (!isAdmin(env, shopper)) return json({ error: "not_found" }, 404, cors);
  if (method === "GET") return json(await state(env), 200, cors);
  if (method !== "POST") return json({ error: "not_found" }, 404, cors);
  let body = null; try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body.on !== "boolean") return json({ error: "bad_request" }, 400, cors);
  if (body.on) {
    await env.RELAY_DB.prepare("INSERT OR IGNORE INTO review_account (id, address, created_at) VALUES (1, ?, ?)").bind(newAddress(), o.now).run();
    return json(await state(env), 200, cors);
  }
  const gone = await env.RELAY_DB.prepare("DELETE FROM review_account WHERE id = 1 RETURNING address").first();
  if (gone) {
    const account = await env.RELAY_DB.prepare("SELECT id, email, email_hash AS emailHash FROM shoppers WHERE email = ?").bind(gone.address).first();
    if (account) await deleteShopper(env, account, o);
    // A code asked for but never used belongs to no account yet.
    await env.RELAY_DB.prepare("DELETE FROM auth_login_tokens WHERE email IN (?, ?)").bind(gone.address, "code:" + gone.address).run();
  }
  return json({ on: false }, 200, cors);
}
