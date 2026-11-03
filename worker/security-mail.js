// Emails the shopper whenever how they sign in changes, so a change they didn't make doesn't go unnoticed: someone holding
// a stolen session can't quietly add their own way in, point the codes at their own phone or switch two-step sign-in off.
// Sent to the sign-in address. It never holds up or undoes the change, and it carries no codes, full phone numbers or
// sign-in links (nothing in it lets anyone in).
const DEFAULT_FROM = "Relay <onboarding@resend.dev>";
const NOTES = {
  app_on: ["Two-step sign-in is on", () => "You turned on two-step sign-in with an authenticator app. Relay will now ask for a code from the app when you sign in."],
  app_off: ["Two-step sign-in is off", () => "Two-step sign-in with an authenticator app was turned off for your Relay account."],
  text_on: ["Sign-in codes by text are on", d => "Relay will now text a code to your number ending " + d.ending + " when you sign in."],
  text_off: ["Sign-in codes by text are off", () => "Relay no longer texts you a code when you sign in."],
  phone_added: ["A phone number was added", d => "The number ending " + d.ending + " was added to your Relay account."],
  phone_removed: ["A phone number was removed", d => "The number ending " + d.ending + " was removed from your Relay account."],
  passkey_added: ["A passkey was added", d => "A passkey" + (d.name ? " called “" + d.name + "”" : "") + " was added to your Relay account. It can now be used to sign in with Face ID, Touch ID or a screen lock."],
  passkey_removed: ["A passkey was removed", d => "A passkey" + (d.name ? " called “" + d.name + "”" : "") + " was removed from your Relay account."],
  recovery_used: ["A recovery code was used", d => "Someone signed in to your Relay account with one of your recovery codes. " + (d.left === 1 ? "1 is" : d.left + " are") + " left."],
  others_out: ["Your other devices were signed out", d => "Relay was signed out on " + (d.count === 1 ? "1 other device" : d.count + " other devices") + ". The device you did this on stays signed in."],
};
const IF_NOT_YOU = "If this wasn't you, sign in to Relay with your email, open Profile, choose Devices and sign out your other devices. Then check Two-step sign-in.";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function whenText(now) {
  try { return new Date(now).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return new Date(now).toISOString().slice(0, 16).replace("T", " ") + " UTC"; }
}

// The words of one notice (exported for tests): { subject, text, html }, or null for a kind Relay doesn't send.
export function securityNoticeMessage(kind, details = {}, now = Date.now()) {
  const note = NOTES[kind];
  if (!note) return null;
  const line = note[1](details || {}), when = whenText(now);
  const last = kind === "others_out" ? "If this wasn't you, sign in to Relay with your email and check Two-step sign-in." : IF_NOT_YOU;
  return {
    subject: "Relay: " + note[0],
    text: line + "\n\nWhen: " + when + "\n\n" + last + "\n\nRelay sends this email whenever how you sign in changes.",
    html: '<p style="font-size:16px;font-weight:700">' + esc(note[0]) + "</p><p>" + esc(line) + '</p><p style="color:#555">When: ' + esc(when) + "</p><p>" + esc(last) +
      '</p><p style="color:#777;font-size:13px">Relay sends this email whenever how you sign in changes.</p>',
  };
}

// Sends one notice. Resolves true when the email service took it; false otherwise (never throws).
export async function securityNotice(env, email, kind, details, fetchImpl, now = Date.now()) {
  const msg = securityNoticeMessage(kind, details, now);
  if (!msg || !email || !env || !env.RESEND_API_KEY) return false;
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.RELAY_EMAIL_FROM || DEFAULT_FROM, to: [email], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    return Boolean(res && res.ok);
  } catch { return false; }
}

// For the route handlers: sends after the response when the Worker can (o.later), otherwise straight away.
export function tellShopper(env, o, email, kind, details) {
  const p = securityNotice(env, email, kind, details, o.fetchImpl, o.now).catch(() => false);
  if (typeof o.later === "function") { o.later(p); return Promise.resolve(); }
  return p;
}
