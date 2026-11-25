// "Connect Gmail" / "Connect Outlook" can only be finished by the very session that started it (security review H1,
// 25 Nov 2026). Before this, the consent link Relay gave one member could be sent to someone else: when they agreed on
// Google's or Microsoft's real page, THEIR inbox was connected to the sender's Relay account.
//
// Through Relay's real server (scripts/local-worker.mjs) with made-up people. Google and Microsoft are FAKED: their token
// and profile answers say whose inbox the code belongs to.
//  1. The attack: an attacker's consent link, finished in the victim's browser, connects nothing. The browser is sent back
//     with a single-use code, which only the attacker's own session could hand in; the victim's session is refused
//     ("not_your_link"), and the waiting token is deleted.
//  2. Another session of the same member (another device) is refused too.
//  3. The member who started it, in the same session: connected, once (the code works once).
//  4. A connection started before this rule (no session kept on it) is refused at the callback.
//  5. Outlook works the same way.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { startLocalWorker } from "./local-worker.mjs";
import { _codeAt } from "../worker/totp.js";
import { CONSENT_VERSION } from "../worker/gmail.js";

const APP = "http://127.0.0.1:9";
const w = await startLocalWorker({ appOrigin: APP });
// (Made up at run time: nothing that looks like a key is written into the code.)
Object.assign(w.env, { GOOGLE_CLIENT_ID: "local-client", GOOGLE_CLIENT_SECRET: randomBytes(16).toString("hex"),
  MICROSOFT_CLIENT_ID: "local-ms-client", MICROSOFT_CLIENT_SECRET: randomBytes(16).toString("hex") });
// Google and Microsoft stand in: the code says whose inbox it is ("code-<address>").
let whose = null;
const inner = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input && input.url ? input.url : input);
  if (url === "https://oauth2.googleapis.com/token") { whose = new URLSearchParams(String(init.body)).get("code").slice(5); return Response.json({ access_token: "a-" + whose, refresh_token: "r-" + whose, scope: "https://www.googleapis.com/auth/gmail.readonly", expires_in: 3600 }); }
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/profile")) return Response.json({ emailAddress: whose });
  if (url.startsWith("https://login.microsoftonline.com/") && url.endsWith("/token")) { whose = new URLSearchParams(String(init.body)).get("code").slice(5); return Response.json({ access_token: "a-" + whose, refresh_token: "r-" + whose, scope: "Mail.Read offline_access", expires_in: 3600 }); }
  if (url.startsWith("https://graph.microsoft.com/v1.0/me?")) return Response.json({ mail: whose });
  return inner(input, init);
};
const call = async (path, { method = "GET", body, token } = {}) => {
  const r = await fetch(w.origin + path, { method, redirect: "manual", headers: { "content-type": "application/json", origin: APP, ...(token ? { authorization: "Bearer " + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, body: j, location: r.headers.get("location") };
};
const unb32 = t => { const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const o = []; for (const c of t.replace(/\s/g, "")) { v = (v << 5) | B.indexOf(c); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(o); };
const step = () => Math.floor(Date.now() / 30000);
// A member: signed in, with an authenticator app as the second step, and the email wording agreed.
async function member(email) {
  await call("/relay/auth/request", { method: "POST", body: { email } });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(w.emails.at(-1).text)[1];
  const token = (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).body.sessionToken;
  const s = await call("/relay/my/2fa/setup", { method: "POST", token, body: {} });
  const secret = unb32(s.body.secret);
  assert.equal((await call("/relay/my/2fa/enable", { method: "POST", token, body: { code: await _codeAt(secret, step()) } })).status, 200);
  assert.equal((await call("/relay/my/consent", { method: "POST", token, body: { version: CONSENT_VERSION } })).status, 200);
  return { email, token, secret };
}
// Another session for the same member: email link, then a code from the app.
async function secondSession(m) {
  await call("/relay/auth/request", { method: "POST", body: { email: m.email } });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(w.emails.at(-1).text)[1];
  const v = await call("/relay/auth/verify", { method: "POST", body: { token: link } });
  assert.equal(v.body.needsSecondStep, true);
  const d = await call("/relay/auth/2fa/verify", { method: "POST", body: { pendingToken: v.body.pendingToken, code: await _codeAt(m.secret, step() + 1) } });
  assert.ok(d.body && d.body.sessionToken, "second session signed in");
  return d.body.sessionToken;
}
const inboxes = () => w.sqlite.prepare("SELECT g.google_email AS inbox, s.email AS owner FROM gmail_connections g JOIN shoppers s ON g.shopper_id = s.id OR g.shopper_id LIKE s.id || '~%' ORDER BY inbox").all().map(r => ({ ...r }));
const finishCode = (loc, kind = "gmail") => { const m = new RegExp("#" + kind + "=finish&mailcode=([A-Za-z0-9_-]{43})$").exec(loc || ""); return m ? m[1] : null; };

const attacker = await member("attacker@example.com");
const victim = await member("victim@example.com");

// 1. The attacker's consent link, finished by the victim in the victim's own browser.
{
  const start = await call("/relay/my/gmail/connect", { method: "POST", token: attacker.token, body: { another: true } });
  const state = new URL(start.body.url).searchParams.get("state");
  const back = await call("/relay/gmail/callback?code=code-victim@gmail.com&state=" + state);
  assert.deepEqual(inboxes(), [], "nothing is connected by the callback itself (it was: " + JSON.stringify(inboxes()) + ")");
  const code = finishCode(back.location);
  assert.ok(code, "the browser goes back to the app with a single-use code: " + back.location);
  // The victim's app, signed in as the victim, hands it in: refused, plainly.
  const r = await call("/relay/my/gmail/finish", { method: "POST", token: victim.token, body: { code } });
  assert.deepEqual([r.status, r.body.error], [403, "not_your_link"]);
  // The waiting token is gone, so the attacker can't use the code afterwards either.
  const again = await call("/relay/my/gmail/finish", { method: "POST", token: attacker.token, body: { code } });
  assert.equal(again.status, 409, "the code worked once, whoever used it");
  assert.deepEqual(inboxes(), []);
  assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM gmail_oauth_states WHERE token_data IS NOT NULL").get().n, 0, "no waiting token kept");
  const mine = await call("/relay/my/gmail", { token: attacker.token });
  assert.equal(mine.body.connected, false, "the attacker's account has no inbox");
}

// 2. The same member on another device can't finish what this one started.
{
  const other = await secondSession(attacker);
  const start = await call("/relay/my/gmail/connect", { method: "POST", token: attacker.token, body: {} });
  const back = await call("/relay/gmail/callback?code=code-attacker@gmail.com&state=" + new URL(start.body.url).searchParams.get("state"));
  const r = await call("/relay/my/gmail/finish", { method: "POST", token: other, body: { code: finishCode(back.location) } });
  assert.deepEqual([r.status, r.body.error], [403, "not_your_link"]);
  assert.deepEqual(inboxes(), []);
}

// 3. The session that started it finishes it: connected, and the code is spent.
{
  const start = await call("/relay/my/gmail/connect", { method: "POST", token: victim.token, body: {} });
  const back = await call("/relay/gmail/callback?code=code-victim@gmail.com&state=" + new URL(start.body.url).searchParams.get("state"));
  const code = finishCode(back.location);
  const r = await call("/relay/my/gmail/finish", { method: "POST", token: victim.token, body: { code } });
  assert.deepEqual([r.status, r.body.result, r.body.provider], [200, "connected", "google"]);
  assert.deepEqual(inboxes(), [{ inbox: "victim@gmail.com", owner: "victim@example.com" }]);
  assert.equal((await call("/relay/my/gmail/finish", { method: "POST", token: victim.token, body: { code } })).status, 409, "once only");
  // A made-up or malformed code: plain refusals, nothing else.
  assert.equal((await call("/relay/my/gmail/finish", { method: "POST", token: victim.token, body: { code: "A".repeat(43) } })).status, 409);
  assert.equal((await call("/relay/my/gmail/finish", { method: "POST", token: victim.token, body: { code: "short" } })).status, 400);
  assert.equal((await call("/relay/my/gmail/finish", { method: "POST", body: { code } })).status, 401, "signed in only");
}

// 4. A connection started before this rule (no session on it) is refused at the callback, and nothing is connected.
{
  const start = await call("/relay/my/gmail/connect", { method: "POST", token: attacker.token, body: {} });
  const state = new URL(start.body.url).searchParams.get("state");
  w.sqlite.prepare("UPDATE gmail_oauth_states SET session_hash = NULL").run();
  const back = await call("/relay/gmail/callback?code=code-someone@gmail.com&state=" + state);
  assert.match(back.location, /#gmail=failed$/);
  assert.deepEqual(inboxes().map(x => x.inbox), ["victim@gmail.com"]);
}

// 5. Outlook: the same.
{
  const start = await call("/relay/my/gmail/connect", { method: "POST", token: attacker.token, body: { provider: "microsoft" } });
  const back = await call("/relay/microsoft/callback?code=code-victim@outlook.com&state=" + new URL(start.body.url).searchParams.get("state"));
  const code = finishCode(back.location, "outlook");
  assert.ok(code, "Outlook goes back with a code too: " + back.location);
  const r = await call("/relay/my/gmail/finish", { method: "POST", token: victim.token, body: { code } });
  assert.deepEqual([r.status, r.body.error], [403, "not_your_link"]);
  assert.deepEqual(inboxes().map(x => x.inbox), ["victim@gmail.com"], "the victim's Outlook isn't in the attacker's account");
  const start2 = await call("/relay/my/gmail/connect", { method: "POST", token: attacker.token, body: { provider: "microsoft" } });
  const back2 = await call("/relay/microsoft/callback?code=code-attacker@outlook.com&state=" + new URL(start2.body.url).searchParams.get("state"));
  const r2 = await call("/relay/my/gmail/finish", { method: "POST", token: attacker.token, body: { code: finishCode(back2.location, "outlook") } });
  assert.deepEqual([r2.status, r2.body.result, r2.body.provider], [200, "connected", "microsoft"]);
  assert.deepEqual(inboxes(), [{ inbox: "attacker@outlook.com", owner: "attacker@example.com" }, { inbox: "victim@gmail.com", owner: "victim@example.com" }]);
}

await w.close();
console.log("mail connect is bound to the session that started it: all checks passed");
