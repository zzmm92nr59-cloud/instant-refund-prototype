// Offline tests: a Google or Microsoft sign-in can only be finished by the person who went through Google's or Microsoft's
// screen, against a real SQLite engine. Google and Microsoft are FAKED here: nothing proves they accept Relay's settings.
//
// The attack this stops: someone starts a sign-in with a secret of their own, sends the genuine Google (or Microsoft) link
// to somebody else, and, once that person has signed in there, asks Relay for the session with the secret
// (/relay/auth/claim). It must get nothing, and the other person's inbox must not be connected.
//
// What still has to work: the same browser finishing (it holds the secret), and the iPhone home-screen app, whose Google
// page comes back in a separate browser: finished by the app once that browser either holds the secret as well, or the
// person there confirmed it on a page that shows the same short code as the app.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, OUTLOOK_SCOPE } from "../worker/gmail.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    async run() { sqlite.prepare(sql).run(...args); return {}; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); }
  };
}
const db = { prepare: sql => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { list.forEach(s => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const APP = "https://app.relay.test";
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_APP_URL: APP + "/index.html",
  GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test",
  MICROSOFT_CLIENT_ID: "11111111-2222-3333-4444-555555555555", MICROSOFT_CLIENT_SECRET: "ms-secret-test" };
const CONSUMERS = "9188040d-6c67-4c5b-b112-36a304b66dad";
const GM = "https://www.googleapis.com/auth/gmail.readonly";
const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const nonceOf = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
let clock = 1_800_000_000_000;
const MIN = 60_000;
let who = "victim@example.com";
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url === "https://oauth2.googleapis.com/token")
    return Response.json({ access_token: "a", refresh_token: "GOOGLE-REFRESH-PLAINTEXT", scope: "openid email profile " + GM,
      id_token: "h." + b64u({ iss: "https://accounts.google.com", aud: env.GOOGLE_CLIENT_ID, exp: Math.floor(clock / 1000) + 3600, email: who, email_verified: true }) + ".s" });
  if (url === "https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
    return Response.json({ access_token: "a", refresh_token: "MS-REFRESH-PLAINTEXT", scope: "openid email profile offline_access https://graph.microsoft.com/Mail.Read",
      id_token: "h." + b64u({ iss: `https://login.microsoftonline.com/${CONSUMERS}/v2.0`, tid: CONSUMERS, aud: env.MICROSOFT_CLIENT_ID, exp: Math.floor(clock / 1000) + 3600, email: who }) + ".s" });
  return new Response("{}", { status: 200 }); // security emails, the first scan's calls
};
// origin: null leaves the header out, as a script (not a browser) can.
const call = (path, { method = "GET", body, token, origin = APP, ip = "9.9.9.9" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip,
    ...(token ? { authorization: "Bearer " + token } : {}), ...(origin ? { origin } : {}) }, body: body ? JSON.stringify(body) : undefined }),
    env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
const post = (path, body, more = {}) => call(path, { method: "POST", body, ...more });
const count = (sql, ...a) => sqlite.prepare(sql).get(...a).n;

const PROVIDERS = [
  { name: "Google", start: "/relay/auth/google/start", callback: "/relay/gmail/callback", victim: "victim@example.com", legit: "sam@example.com" },
  { name: "Microsoft", start: "/relay/auth/microsoft/start", callback: "/relay/microsoft/callback", victim: "victim@outlook.com", legit: "sam@outlook.com" }
];
assert.ok(OUTLOOK_SCOPE);

for (const P of PROVIDERS) {
  // Someone starts a sign-in, and a person goes through Google's or Microsoft's screen with it. Returns what each side holds:
  // the starter its secret (nonce) and the code its screen shows; the browser that came back, the one-time token.
  async function begin(email, { consent = true, nonce = nonceOf() } = {}) {
    who = email;
    const st = await post(P.start, { nonce, ...(consent ? { consentVersion: CONSENT_VERSION } : {}) });
    assert.equal(st.status, 200);
    const started = await st.json();
    const cb = await call(P.callback + "?code=good-code&state=" + new URL(started.url).searchParams.get("state"));
    const token = (/#signin=([A-Za-z0-9_-]{43})$/.exec(cb.headers.get("location") || "") || [])[1];
    assert.ok(token, P.name + " sends the browser back with a one-time token");
    return { nonce, token, code: started.code };
  }
  const idOf = email => (sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email) || {}).id;
  const mailboxes = email => idOf(email) ? count("SELECT COUNT(*) n FROM gmail_connections WHERE shopper_id = ?", idOf(email)) : 0;
  const consents = email => idOf(email) ? count("SELECT COUNT(*) n FROM shopper_consents WHERE shopper_id = ?", idOf(email)) : 0;
  const sessions = email => idOf(email) ? count("SELECT COUNT(*) n FROM auth_sessions WHERE shopper_id = ?", idOf(email)) : 0;

  // ---- 1. The attack: the attacker starts, the victim completes, the attacker claims ----
  {
    const a = await begin(P.victim);
    // The victim's browser lands on Relay with the token and no secret: it can't finish, and is told to confirm.
    const landed = await post("/relay/auth/verify", { token: a.token });
    assert.equal(landed.status, 400, "the victim's browser doesn't hold the attacker's secret");
    assert.equal((await landed.json()).error, "confirm_needed");
    // The attacker asks for the session with the secret it chose, from a script and from a browser, again and again.
    for (const origin of [APP, null, "https://evil.test"]) {
      const c = await post("/relay/auth/claim", { nonce: a.nonce }, { origin });
      assert.notEqual(c.status, 200, "the attacker's claim is refused");
      assert.equal((await c.clone().json()).sessionToken, undefined);
    }
    assert.equal(sessions(P.victim), 0, "nobody was signed in as the victim");
    assert.equal(mailboxes(P.victim), 0, "the victim's inbox was not connected");
    assert.equal(consents(P.victim), 0, "and nothing was recorded as agreed by them");
    // The attacker can't confirm it either: that needs the token, which only the victim's browser was given.
    assert.equal((await post("/relay/auth/confirm", { token: nonceOf(), nonce: a.nonce })).status, 400, "a made-up token confirms nothing");
    assert.notEqual((await post("/relay/auth/claim", { nonce: a.nonce })).status, 200);
    // The victim taps "This wasn't me": the sign-in is cancelled for good.
    assert.equal((await post("/relay/auth/confirm", { token: a.token, deny: true })).status, 200);
    assert.equal((await post("/relay/auth/confirm", { token: a.token, agree: true })).status, 400, "cancelled: it can't be confirmed afterwards");
    assert.notEqual((await post("/relay/auth/claim", { nonce: a.nonce })).status, 200);
    assert.equal(count("SELECT COUNT(*) n FROM auth_pending_mailbox"), 0, "the inbox key that was waiting is deleted");
    // Left alone, it simply runs out.
    const b = await begin(P.victim);
    clock += 16 * MIN;
    assert.notEqual((await post("/relay/auth/claim", { nonce: b.nonce })).status, 200);
    assert.equal(sessions(P.victim), 0);
    assert.equal(mailboxes(P.victim), 0);
    console.log("ok - " + P.name + ": a sign-in started by someone else can't be claimed with their secret, and connects no inbox");
  }

  // ---- 2. Even if the victim is talked into confirming, their inbox is never connected for the attacker ----
  {
    const a = await begin(P.victim);
    const need = await (await post("/relay/auth/verify", { token: a.token })).json();
    assert.equal(need.error, "confirm_needed");
    assert.match(need.code, /^[A-HJ-NP-Z2-9]{6}$/, "the page shows a short code");
    assert.equal(need.code, a.code, "the same code the screen that started it shows");
    assert.equal((await post("/relay/auth/confirm", { token: a.token })).status, 400, "nothing happens without the person saying so");
    assert.notEqual((await post("/relay/auth/claim", { nonce: a.nonce })).status, 200);
    assert.equal((await post("/relay/auth/confirm", { token: a.token, agree: true })).status, 200);
    assert.equal(count("SELECT COUNT(*) n FROM auth_pending_mailbox"), 0, "confirming drops the inbox key: it was agreed to on someone else's screen");
    const c = await post("/relay/auth/claim", { nonce: a.nonce });
    assert.equal(c.status, 200);
    const got = await c.json();
    assert.equal(got.mailConnected, undefined); assert.equal(got.outlookConnected, undefined);
    assert.equal(mailboxes(P.victim), 0, "no inbox connected on a sign-in confirmed by hand");
    assert.equal(consents(P.victim), 0, "and no agreement recorded");
    sqlite.prepare("DELETE FROM auth_sessions").run();
    console.log("ok - " + P.name + ": a sign-in confirmed by hand never connects an inbox or records an agreement");
  }

  // ---- 3. The same browser: it holds the secret, so it finishes as before, inbox and all ----
  {
    const s = await begin(P.legit);
    assert.equal((await post("/relay/auth/claim", { nonce: s.nonce })).status, 404, "not claimable by the secret alone, even by the one who started");
    const v = await post("/relay/auth/verify", { token: s.token, nonce: s.nonce });
    assert.equal(v.status, 200);
    const got = await v.json();
    assert.ok(got.sessionToken); assert.equal(got.email, P.legit);
    assert.equal(got.mailConnected, P.name === "Google" ? "google" : "microsoft", "the inbox is connected in the same step");
    assert.equal(mailboxes(P.legit), 1); assert.equal(consents(P.legit), 1);
    assert.equal((await post("/relay/auth/verify", { token: s.token, nonce: s.nonce })).status, 400, "once");
    assert.equal((await post("/relay/auth/claim", { nonce: s.nonce })).status, 404, "and nothing is left to claim");
    sqlite.prepare("DELETE FROM gmail_connections").run(); sqlite.prepare("DELETE FROM shopper_consents").run();
    console.log("ok - " + P.name + ": the browser that started the sign-in finishes it, and its inbox is connected");
  }

  // ---- 4. The installed app, whose Google page comes back in a browser that shares its storage (it holds the secret) ----
  {
    const s = await begin(P.legit);
    // That browser proves it's the one that started (token and secret together); the app then claims with the secret.
    assert.equal((await post("/relay/auth/confirm", { token: s.token, nonce: nonceOf() })).status, 400, "a wrong secret proves nothing");
    assert.equal((await post("/relay/auth/claim", { nonce: s.nonce })).status, 404);
    assert.equal((await post("/relay/auth/confirm", { token: s.token, nonce: s.nonce })).status, 200);
    assert.equal(count("SELECT COUNT(*) n FROM auth_pending_mailbox"), 1, "the inbox key still waits: the person who agreed is the one who signed in");
    assert.equal((await post("/relay/auth/claim", { nonce: nonceOf() })).status, 404, "someone else's secret: nothing");
    assert.equal((await post("/relay/auth/claim", { nonce: s.nonce }, { origin: null })).status, 403, "only from Relay's own app");
    assert.equal((await post("/relay/auth/claim", { nonce: s.nonce }, { origin: "https://evil.test" })).status, 403);
    const c = await post("/relay/auth/claim", { nonce: s.nonce });
    assert.equal(c.status, 200, "the app claims it");
    const got = await c.json();
    assert.ok(got.sessionToken); assert.equal(got.email, P.legit);
    assert.equal(got.mailConnected, P.name === "Google" ? "google" : "microsoft");
    assert.equal(mailboxes(P.legit), 1); assert.equal(consents(P.legit), 1);
    assert.equal((await post("/relay/auth/claim", { nonce: s.nonce })).status, 404, "once");
    assert.equal((await post("/relay/auth/verify", { token: s.token, nonce: s.nonce })).status, 400, "and the token is used up");
    sqlite.prepare("DELETE FROM gmail_connections").run(); sqlite.prepare("DELETE FROM shopper_consents").run();
    console.log("ok - " + P.name + ": the installed app finishes a sign-in its own browser window proved it started");
  }

  // ---- 5. The installed app, whose Google page comes back in a browser without the secret: confirmed by the matching code ----
  {
    const s = await begin(P.legit, { consent: false });
    const need = await (await post("/relay/auth/verify", { token: s.token })).json();
    assert.equal(need.code, s.code, "both screens show the same code");
    assert.equal((await post("/relay/auth/confirm", { token: s.token, agree: true }, { origin: null })).status, 403, "confirming only from Relay's own page");
    assert.equal((await post("/relay/auth/confirm", { token: s.token, agree: true })).status, 200);
    const c = await post("/relay/auth/claim", { nonce: s.nonce });
    assert.equal(c.status, 200);
    assert.equal((await c.json()).email, P.legit);
    // The app has about two minutes to come back for it.
    const late = await begin(P.legit, { consent: false });
    assert.equal((await post("/relay/auth/confirm", { token: late.token, agree: true })).status, 200);
    clock += 2 * MIN + 1000;
    assert.equal((await post("/relay/auth/claim", { nonce: late.nonce })).status, 404, "a confirmed sign-in can be claimed for two minutes, no longer");
    // And the page has to be confirmed within a few minutes of coming back.
    const slow = await begin(P.legit, { consent: false });
    clock += 6 * MIN;
    assert.equal((await post("/relay/auth/confirm", { token: slow.token, agree: true })).status, 400, "too late to confirm");
    assert.equal((await post("/relay/auth/verify", { token: slow.token, nonce: slow.nonce })).status, 400, "or to finish");
    console.log("ok - " + P.name + ": a sign-in that came back elsewhere is finished only after it's confirmed there, within two minutes");
  }

  // ---- 6. Starting needs Relay's own app too ----
  assert.equal((await post(P.start, { nonce: nonceOf() }, { origin: null })).status, 403, "no Origin: refused");
  assert.equal((await post(P.start, { nonce: nonceOf() }, { origin: "https://evil.test" })).status, 403);
  sqlite.prepare("DELETE FROM auth_sessions").run();
}
console.log("\nAll sign-in claim tests passed.");
