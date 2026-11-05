// Two-step sign-in for everyone (SECOND_STEP_REQUIRED = "on" in wrangler.toml).
//
// Every account needs a second step: an authenticator app, codes by text, or a passkey (Face ID, Touch ID or the phone's
// screen lock). The shared app-reviewer account is the one exception: nothing personal can be attached to it.
//  * Signing in with an email link or code, Google or Microsoft then always asks for the second step: a code (totp.js),
//    or, for an account whose only second step is a passkey, the passkey itself (a complete sign-in on its own).
//  * Until an account has one, a signed-in shopper can only set one up, change their name, agree to the email wording,
//    sign out or delete the account: everything else answers "second_step_needed" (403) and the app asks them to set one up.
//  * Relay's team tools need a session that passed a second step ("checked"): passkey sign-in, a code at sign-in, or
//    setting up the account's first second step in that session. Older sessions sign in again for them.
//  * The last second step can't be turned off or removed while it's required: add another first.
// Off (anything but "on"), sign-in works as before: the second step is optional.
export const secondStepRequired = (env) => String(env && env.SECOND_STEP_REQUIRED || "").toLowerCase() === "on";

// Which second steps an account has, in one database call.
export async function secondSteps(env, shopperId) {
  const r = await env.RELAY_DB.prepare(`SELECT
      (SELECT COUNT(*) FROM auth_totp WHERE shopper_id = ? AND enabled = 1) AS app,
      (SELECT COUNT(*) FROM auth_phone WHERE shopper_id = ? AND two_step = 1) AS text,
      (SELECT COUNT(*) FROM auth_passkeys WHERE shopper_id = ?) AS passkeys`).bind(shopperId, shopperId, shopperId).first();
  return { app: Number(r && r.app) > 0, text: Number(r && r.text) > 0, passkeys: Number(r && r.passkeys) || 0 };
}
export const hasSecondStep = (s) => Boolean(s && (s.app || s.text || s.passkeys > 0));

// What a signed-in shopper can still do before setting one up.
const OPEN_ROUTES = [/^\/relay\/me$/, /^\/relay\/auth\/logout$/, /^\/relay\/my\/second-step$/, /^\/relay\/my\/2fa(\/|$)/, /^\/relay\/my\/passkeys(\/|$)/,
  /^\/relay\/my\/phone(\/|$)/, /^\/relay\/my\/profile$/, /^\/relay\/my\/consent$/, /^\/relay\/my\/delete$/, /^\/relay\/my\/devices\/sign-out-others$/,
  /^\/relay\/my\/admin\/me$/];
export const openWithoutSecondStep = (path) => OPEN_ROUTES.some(re => re.test(path));

// This session passed a second step.
export async function markSessionChecked(env, sessionHash) {
  if (sessionHash) await env.RELAY_DB.prepare("UPDATE auth_sessions SET second_step = 1 WHERE session_hash = ?").bind(sessionHash).run();
}

// Turning off or removing one way: refused while it's required and it's the account's last.
export function lastSecondStep(env, before, removing) {
  if (!secondStepRequired(env)) return false;
  const left = { ...before };
  if (removing === "app") left.app = false;
  if (removing === "text") left.text = false;
  if (removing === "passkey") left.passkeys = Math.max(0, left.passkeys - 1);
  return !hasSecondStep(left);
}
