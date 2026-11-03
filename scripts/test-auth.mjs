// Offline tests for shopper sign-in and purchase ownership, against a real SQLite engine.
// Email delivery is faked: nothing here proves a real email arrives.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { receiveShopifyWebhook } from "../worker/shopify-webhooks.js";

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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key",
  SHOPIFY_SHOP_DOMAIN: "relay-demo.myshopify.com", SHOPIFY_WEBHOOK_SECRET: "wh-secret" };

let emails = [];
let failEmail = false;
// FAKE Twilio: texts are captured here. Nothing in these tests proves a real text arrives.
let texts = [], failText = false;
const fetchImpl = async (url, init) => {
  if (String(url).startsWith("https://api.twilio.com/")) {
    if (failText) return new Response('{"code":21211,"message":"The To number is not a valid phone number."}', { status: 400 });
    texts.push({ url: String(url), auth: init.headers.Authorization, ...Object.fromEntries(new URLSearchParams(init.body)) });
    return new Response("{}", { status: 201 });
  }
  if (failEmail) return new Response("no", { status: 500 });
  emails.push({ url, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 });
};
let clock = 1_800_000_000_000;
const call = (path, { method = "GET", body, token, origin, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip,
      ...(token ? { authorization: "Bearer " + token } : {}), ...(origin ? { origin } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
const tokenFromEmail = e => /#signin=([A-Za-z0-9_-]{43})/.exec(e.body.text)[1];

async function ordersPaid(id, email, shop = "relay-demo.myshopify.com") {
  const data = JSON.stringify({ id, created_at: "2026-10-14T12:30:00+00:00", currency: "GBP", total_price: "50.00",
    email, line_items: [{ id: id * 10, title: "Trainers " + id, quantity: 1, price: "50.00" }] });
  const sig = createHmac("sha256", env.SHOPIFY_WEBHOOK_SECRET).update(data).digest("base64");
  return receiveShopifyWebhook(new Request("https://w.test/relay/webhooks/shopify", { method: "POST",
    headers: { "x-shopify-shop-domain": shop, "x-shopify-topic": "orders/paid", "x-shopify-hmac-sha256": sig,
      "x-shopify-webhook-id": "wh-" + id }, body: data }), env);
}
async function signIn(email, ip) {
  emails = [];
  assert.equal((await call("/relay/auth/request", { method: "POST", body: { email }, ip })).status, 200);
  const r = await call("/relay/auth/verify", { method: "POST", body: { token: tokenFromEmail(emails[0]) } });
  assert.equal(r.status, 200);
  return (await r.json()).sessionToken;
}

// 1. Not configured -> clear 503, nothing sent.
const bare = { RELAY_DB: db };
let r = await handleAuthRoute(new Request("https://w.test/relay/auth/request", { method: "POST", body: "{}" }), bare, new URL("https://w.test/relay/auth/request"), {}, {});
assert.equal(r.status, 503);

// 2. Validation + origin.
assert.equal((await call("/relay/auth/request", { method: "POST", body: { email: "nope" } })).status, 400);
assert.equal((await call("/relay/auth/request", { method: "POST", body: { email: "a@b.co" }, origin: "https://evil.example" })).status, 403);
assert.equal(emails.length, 0);

// 3. Sign-in flow: link is emailed only, never returned; single use; expiry.
emails = [];
r = await call("/relay/auth/request", { method: "POST", body: { email: "Alice@Example.com " }, origin: "https://zzmm92nr59-cloud.github.io" });
assert.equal(r.status, 200);
assert.deepEqual(await r.json(), { ok: true });
assert.equal(emails.length, 1);
assert.deepEqual(emails[0].body.to, ["alice@example.com"]);
const t1 = tokenFromEmail(emails[0]);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_login_tokens WHERE token_hash = ?").get(t1).n, 0, "raw token is never stored");
r = await call("/relay/auth/verify", { method: "POST", body: { token: t1 } });
assert.equal(r.status, 200);
const aliceSession = (await r.json()).sessionToken;
assert.equal((await call("/relay/auth/verify", { method: "POST", body: { token: t1 } })).status, 400, "link is single-use");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_sessions WHERE session_hash = ?").get(aliceSession).n, 0, "raw session never stored");
emails = [];
await call("/relay/auth/request", { method: "POST", body: { email: "alice@example.com" }, ip: "2.2.2.2" });
const old = tokenFromEmail(emails[0]);
clock += 16 * 60 * 1000;
assert.equal((await call("/relay/auth/verify", { method: "POST", body: { token: old } })).status, 400, "expired link refused");
assert.equal((await call("/relay/auth/verify", { method: "POST", body: { token: "x".repeat(43) } })).status, 400);

// 3b. Six-digit code sign-in: same email, single use, expires, limited guesses, never stored in clear.
const codeOf = e => /Your Relay code is (\d{6})/.exec(e.body.text)[1];
emails = [];
await call("/relay/auth/request", { method: "POST", body: { email: "dana@example.com" }, ip: "7.7.7.7" });
assert.match(emails[0].body.subject, /^\d{6} is your Relay sign-in code$/, "the code leads the subject so phones can offer it to type in");
const dcode = codeOf(emails[0]);
assert.match(emails[0].body.html, new RegExp(dcode));
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_login_tokens WHERE token_hash = ?").get(dcode).n, 0, "raw code never stored");
const wrong = dcode === "000000" ? "111111" : "000000";
assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: "dana@example.com", code: wrong } })).status, 400, "wrong code refused");
assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: "eve@example.com", code: dcode } })).status, 400, "code only works for its own email");
assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: "dana@example.com", code: "12ab56" } })).status, 400);
r = await call("/relay/auth/verify-code", { method: "POST", body: { email: " Dana@Example.com", code: dcode } });
assert.equal(r.status, 200);
const danaSession = (await r.json()).sessionToken;
assert.equal((await call("/relay/me", { token: danaSession })).status, 200, "code gives a working session");
assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: "dana@example.com", code: dcode } })).status, 400, "code is single-use");
// Guessing: after 5 wrong tries even the right code stops working.
emails = [];
await call("/relay/auth/request", { method: "POST", body: { email: "gus@example.com" }, ip: "8.8.8.8" });
const gcode = codeOf(emails[0]);
const bad = gcode === "000000" ? "111111" : "000000";
for (let i = 0; i < 5; i++) assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: "gus@example.com", code: bad } })).status, 400);
assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: "gus@example.com", code: gcode } })).status, 429, "locked after 5 wrong codes");
clock += 16 * 60 * 1000;
emails = [];
await call("/relay/auth/request", { method: "POST", body: { email: "hal@example.com" }, ip: "9.9.9.9" });
const hcode = codeOf(emails[0]);
clock += 16 * 60 * 1000;
assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: "hal@example.com", code: hcode } })).status, 400, "expired code refused");

// 4. Email failure leaves no usable token and reports honestly.
failEmail = true;
assert.equal((await call("/relay/auth/request", { method: "POST", body: { email: "fail@example.com" }, ip: "3.3.3.3" })).status, 502);
failEmail = false;
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_login_tokens WHERE email='fail@example.com'").get().n, 0);

// 5. Rate limit per email.
for (let i = 0; i < 5; i++) await call("/relay/auth/request", { method: "POST", body: { email: "spam@example.com" }, ip: "4.4." + i + ".1" });
assert.equal((await call("/relay/auth/request", { method: "POST", body: { email: "spam@example.com" }, ip: "4.4.9.9" })).status, 429);

// 6. Ownership: each shopper sees only orders whose retailer email matches theirs.
assert.equal((await ordersPaid(1, "alice@example.com")).status, 200);
assert.equal((await ordersPaid(2, "BOB@example.com")).status, 200);
assert.equal((await ordersPaid(3, null)).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM retailer_order_emails").get().n, 2);
assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM retailer_order_emails").all()).includes("example.com"), "no plaintext email in order table");
const alice = await signIn("alice@example.com", "5.5.5.5");
const bob = await signIn("bob@example.com", "6.6.6.6");
const carol = await signIn("carol@example.com", "7.7.7.7");
let list = await (await call("/relay/my/purchases", { token: alice })).json();
assert.deepEqual(list.purchases.map(p => p.id), ["shopify:relay-demo.myshopify.com:order:1"]);
assert.equal(list.purchases[0].items[0].title, "Trainers 1");
assert.ok(!JSON.stringify(list).includes("example.com"));
list = await (await call("/relay/my/purchases", { token: bob })).json();
assert.deepEqual(list.purchases.map(p => p.id), ["shopify:relay-demo.myshopify.com:order:2"]);
list = await (await call("/relay/my/purchases", { token: carol })).json();
assert.deepEqual(list.purchases, []);
// Another shopper's order by ID looks identical to a missing one.
const bobsId = "/relay/my/purchases/shopify:relay-demo.myshopify.com:order:2";
assert.equal((await call(bobsId, { token: alice })).status, 404);
assert.equal((await call("/relay/my/purchases/does-not-exist", { token: alice })).status, 404);
assert.equal((await call(bobsId, { token: bob })).status, 200);
// No session / bad session / shopper ID in the URL are all useless.
assert.equal((await call("/relay/my/purchases")).status, 401);
assert.equal((await call("/relay/my/purchases", { token: "A".repeat(43) })).status, 401);
assert.equal((await call("/relay/my/purchases?shopper=" + "x", { token: carol })).status, 200);

// 6b. Pasted receipts: sign-in required, parsed, never stored, never refund-eligible.
const sample = "From: Example Outfitters <orders@exampleoutfitters.test>\nSubject: Your order confirmation #EO-1\nContent-Type: text/plain\n\nOrder number: EO-1\nOrder date: 14 Oct 2026\nWool jumper - Qty 1 - £59.00\nOrder total: £59.00\n";
assert.equal((await call("/relay/my/receipts/parse", { method: "POST", body: { email: sample } })).status, 401, "receipt reading needs sign-in");
const before = sqlite.prepare("SELECT (SELECT COUNT(*) FROM retailer_orders) o, (SELECT COUNT(*) FROM order_items) i").get();
let rr = await call("/relay/my/receipts/parse", { method: "POST", token: bob, body: { email: sample } });
assert.equal(rr.status, 200);
const parsed = (await rr.json()).receipt;
assert.equal(parsed.ok, true);
assert.equal(parsed.orderRef, "EO-1");
assert.equal(parsed.totalPence, 5900);
assert.equal(parsed.refundEligible, false);
assert.deepEqual(sqlite.prepare("SELECT (SELECT COUNT(*) FROM retailer_orders) o, (SELECT COUNT(*) FROM order_items) i").get(), before, "parsing stores nothing");
assert.equal((await call("/relay/my/receipts/parse", { method: "POST", token: bob, body: { email: 123 } })).status, 400);
assert.equal((await call("/relay/my/receipts/parse", { method: "POST", token: bob, body: { email: "x".repeat(300000) } })).status, 400, "oversized input refused");
assert.equal((await (await call("/relay/my/receipts/parse", { method: "POST", token: bob, body: { email: "Subject: 50% off sale\n\nShop jumpers from £19.99 today only, big savings" } })).json()).receipt.ok, false);

// 7. Sessions expire, logout works, delete removes the account.
assert.equal((await call("/relay/me", { token: alice })).status, 200);
assert.equal((await call("/relay/auth/logout", { method: "POST", token: alice })).status, 200);
assert.equal((await call("/relay/me", { token: alice })).status, 401);
assert.equal((await call("/relay/my/delete", { method: "POST", token: carol })).status, 200);
assert.equal((await call("/relay/me", { token: carol })).status, 401);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM shoppers WHERE email='carol@example.com'").get().n, 0);
const DAY = 24 * 60 * 60 * 1000;
clock += 31 * DAY;
assert.equal((await call("/relay/me", { token: bob })).status, 200, "session lasts well past 30 days");
clock += 80 * DAY;
assert.equal((await call("/relay/me", { token: bob })).status, 200, "a session in regular use is kept alive");
clock += 91 * DAY;
assert.equal((await call("/relay/me", { token: bob })).status, 401, "an unused session expires after 90 days");
// Old sign-in links and codes (and the scrambled IP kept with them) go a day after they were made.
assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM auth_login_tokens WHERE created_at <= ?").get(clock - DAY).n > 0, "old sign-in links are still there before the next sign-in");
await signIn("tidy@example.com", "203.0.113.77");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_login_tokens WHERE created_at <= ?").get(clock - DAY).n, 0, "a sign-in clears links and codes older than a day");
assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM auth_login_tokens WHERE email = 'tidy@example.com'").get().n > 0, "today's are kept for the hourly limits");

// 8. Non-auth routes untouched.
assert.equal(await handleAuthRoute(new Request("https://w.test/relay/shopify/status"), env, new URL("https://w.test/relay/shopify/status"), {}, {}), null);

// Sign in with Google (identity only). FAKE Google: nothing here proves real Google accepts the redirect address.
{
  const genv = { ...env, GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test" };
  const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const nonceOf = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  let claims = {}, grant = {};
  const gfetch = async (url, init) => {
    if (String(url) === "https://oauth2.googleapis.com/token") {
      const p = new URLSearchParams(String(init.body));
      if (p.get("code") !== "good-code" || p.get("client_secret") !== "client-secret-test") return new Response("{}", { status: 400 });
      return Response.json({ access_token: "a", ...grant, id_token: "h." + b64u({ iss: "https://accounts.google.com", aud: "client-id.apps.test", exp: Math.floor(clock / 1000) + 3600, email: "alice@example.com", email_verified: true, ...claims }) + ".s" });
    }
    return new Response("blocked", { status: 500 });
  };
  const gcall = (path, { method = "GET", body, token } = {}) =>
    handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined }), genv, new URL("https://w.test" + path), {}, { now: clock, fetchImpl: gfetch });
  async function flow(code = "good-code", extra = "", startBody = {}) {
    const nonce = nonceOf();
    const st = await (await gcall("/relay/auth/google/start", { method: "POST", body: { nonce, ...startBody } })).json();
    const u = new URL(st.url);
    const cb = await gcall(`/relay/gmail/callback?code=${code}&state=${u.searchParams.get("state")}${extra}`);
    return { nonce, u, cb, loc: cb.headers.get("location") || "" };
  }
  assert.equal((await gcall("/relay/auth/google/start", { method: "POST", body: {} })).status, 400, "start needs a browser secret");
  assert.equal((await handleAuthRoute(new Request("https://w.test/relay/auth/google/start", { method: "POST", body: JSON.stringify({ nonce: nonceOf() }) }), env, new URL("https://w.test/relay/auth/google/start"), {}, { now: clock, fetchImpl: gfetch })).status, 503, "off until Google is configured");
  assert.equal((await gcall("/relay/auth/google/start", { method: "POST", body: { nonce: "x" } })).status, 400);
  const a = await flow();
  assert.equal(a.u.origin + a.u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(a.u.searchParams.get("scope"), "openid email profile", "identity only (with the name to offer): no Gmail access requested");
  assert.equal(a.u.searchParams.get("access_type"), null, "and no lasting key asked for");
  assert.equal(a.u.searchParams.get("redirect_uri"), "https://w.test/relay/gmail/callback", "reuses the already-registered redirect address");
  const tok = /#signin=([A-Za-z0-9_-]{43})$/.exec(a.loc);
  assert.ok(tok, a.loc);
  // the browser that did not start the flow cannot use the link
  assert.equal((await gcall("/relay/auth/verify", { method: "POST", body: { token: tok[1] } })).status, 400, "no browser secret");
  const b = await flow();
  const tokB = /#signin=([A-Za-z0-9_-]{43})$/.exec(b.loc)[1];
  assert.equal((await gcall("/relay/auth/verify", { method: "POST", body: { token: tokB, nonce: nonceOf() } })).status, 400, "someone else's secret");
  assert.equal((await gcall("/relay/auth/verify", { method: "POST", body: { token: tokB, nonce: b.nonce } })).status, 400, "link is single-use even then");
  const c = await flow();
  const tokC = /#signin=([A-Za-z0-9_-]{43})$/.exec(c.loc)[1];
  const ok = await gcall("/relay/auth/verify", { method: "POST", body: { token: tokC, nonce: c.nonce } });
  assert.equal(ok.status, 200);
  const sess = await ok.json();
  assert.equal(sess.email, "alice@example.com");
  assert.equal((await (await gcall("/relay/me", { token: sess.sessionToken })).json()).email, "alice@example.com");
  // refusals
  claims = { email_verified: false }; assert.match((await flow()).loc, /#gsignin=failed$/, "unverified Google email refused");
  claims = { aud: "someone-elses-app" }; assert.match((await flow()).loc, /#gsignin=failed$/, "token meant for another app refused");
  claims = { exp: 1 }; assert.match((await flow()).loc, /#gsignin=failed$/, "expired token refused");
  claims = { iss: "https://evil.test" }; assert.match((await flow()).loc, /#gsignin=failed$/, "wrong issuer refused");
  claims = {};
  assert.match((await flow("bad-code")).loc, /#gsignin=failed$/, "bad code refused");
  assert.match((await flow("good-code", "&error=access_denied")).loc, /#gsignin=denied$/, "denied by the shopper");
  const d = await flow();
  const again = await gcall(`/relay/gmail/callback?code=good-code&state=${d.u.searchParams.get("state")}`);
  assert.match(again.headers.get("location"), /#gsignin=failed$/, "state cannot be replayed");
  assert.match((await gcall(`/relay/gmail/callback?code=good-code&state=${"A".repeat(43)}`)).headers.get("location"), /#gmail=failed$/, "unknown state still goes to the Gmail handler");
  assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM auth_google_states").all()).includes("good-code"), false, "no code stored");

  // One step: "Agree and continue with Google" signs in AND connects Gmail (read-only), and the first scan starts.
  const { CONSENT_VERSION } = await import("../worker/gmail.js");
  const GM = "https://www.googleapis.com/auth/gmail.readonly";
  assert.equal((await gcall("/relay/auth/google/start", { method: "POST", body: { nonce: nonceOf(), consentVersion: "2026-01-old" } })).status, 400, "only the wording shown now can be agreed to");
  claims = { name: "Alice Example" };
  grant = { refresh_token: "GOOGLE-REFRESH-ONESTEP-PLAINTEXT", scope: "openid email profile " + GM };
  const o1 = await flow("good-code", "", { consentVersion: CONSENT_VERSION });
  assert.equal(o1.u.searchParams.get("scope"), "openid email profile " + GM, "sign-in and read-only Gmail on one Google screen");
  assert.equal(o1.u.searchParams.get("access_type"), "offline");
  assert.match(o1.u.searchParams.get("prompt"), /consent/);
  const t1 = /#signin=([A-Za-z0-9_-]{43})$/.exec(o1.loc)[1];
  assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM auth_pending_mailbox").all()).includes("PLAINTEXT"), "the Gmail key waits encrypted");
  // Another browser can't finish it: nothing is connected or agreed.
  assert.equal((await gcall("/relay/auth/verify", { method: "POST", body: { token: t1, nonce: nonceOf() } })).status, 400);
  const o2 = await flow("good-code", "", { consentVersion: CONSENT_VERSION });
  const v2 = await (await gcall("/relay/auth/verify", { method: "POST", body: { token: /#signin=([A-Za-z0-9_-]{43})$/.exec(o2.loc)[1], nonce: o2.nonce } })).json();
  assert.equal(v2.mailConnected, "google", "Gmail connected in the same step");
  assert.equal(v2.suggestedName, "Alice Example", "the name Google holds is offered");
  assert.equal(v2.outlookConnected, undefined);
  const aliceId = sqlite.prepare("SELECT id FROM shoppers WHERE email = 'alice@example.com'").get().id;
  assert.equal(sqlite.prepare("SELECT google_email FROM gmail_connections WHERE shopper_id = ?").get(aliceId).google_email, "alice@example.com", "Gmail connected for the account that signed in");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM shopper_consents WHERE shopper_id = ? AND version = ? AND withdrawn_at IS NULL").get(aliceId, CONSENT_VERSION).n, 1, "agreement recorded");
  assert.equal(sqlite.prepare("SELECT state FROM mail_scan_jobs WHERE shopper_id = ?").get(aliceId).state, "running", "the first scan starts straight away");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM shopper_profiles WHERE shopper_id = ?").get(aliceId)?.n || 0, 0, "the name is only offered, not saved without asking");
  assert.equal(sqlite.prepare("SELECT provider FROM gmail_connections WHERE shopper_id = ?").get(aliceId).provider, null, "stored as Connect Gmail stores it, so the same mailbox keeps its place");
  const verifyOneStep = async () => {
    const o = await flow("good-code", "", { consentVersion: CONSENT_VERSION });
    const t = /#signin=([A-Za-z0-9_-]{43})$/.exec(o.loc)[1];
    return (await gcall("/relay/auth/verify", { method: "POST", body: { token: t, nonce: o.nonce } })).json();
  };
  // An inbox already connected (here, Outlook) is never swapped silently.
  sqlite.prepare("UPDATE gmail_connections SET provider = 'microsoft', google_email = 'alice@outlook.com' WHERE shopper_id = ?").run(aliceId);
  const kept = await verifyOneStep();
  assert.equal(kept.mailConnected, undefined); assert.equal(kept.mailKept, true);
  assert.deepEqual({ ...sqlite.prepare("SELECT provider, google_email FROM gmail_connections WHERE shopper_id = ?").get(aliceId) }, { provider: "microsoft", google_email: "alice@outlook.com" }, "the Outlook connection is kept");
  sqlite.prepare("DELETE FROM gmail_connections WHERE shopper_id = ?").run(aliceId);
  // With 2-step sign-in on, nothing is agreed or connected before the code is given.
  sqlite.prepare("DELETE FROM shopper_consents WHERE shopper_id = ?").run(aliceId);
  sqlite.prepare("INSERT INTO auth_totp (shopper_id, secret_enc, enabled, created_at) VALUES (?, 'x', 1, ?)").run(aliceId, clock);
  const two = await verifyOneStep();
  assert.equal(two.needsSecondStep, true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gmail_connections WHERE shopper_id = ?").get(aliceId).n, 0, "no inbox connected before 2-step is passed");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM shopper_consents WHERE shopper_id = ?").get(aliceId).n, 0, "and nothing agreed");
  sqlite.prepare("DELETE FROM auth_totp WHERE shopper_id = ?").run(aliceId);
  // The wording changed while away at Google: not counted as agreed, nothing connected.
  const o5 = await flow("good-code", "", { consentVersion: CONSENT_VERSION });
  sqlite.prepare("UPDATE auth_pending_mailbox SET consent_version = '2026-01-old'").run();
  const v5 = await (await gcall("/relay/auth/verify", { method: "POST", body: { token: /#signin=([A-Za-z0-9_-]{43})$/.exec(o5.loc)[1], nonce: o5.nonce } })).json();
  assert.ok(v5.sessionToken && !v5.mailConnected);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM shopper_consents WHERE shopper_id = ?").get(aliceId).n, 0, "wording not shown is never recorded as agreed");
  // Gmail unticked on Google's screen: signed in, nothing connected.
  sqlite.prepare("DELETE FROM gmail_connections").run();
  grant = { refresh_token: "R", scope: "openid email profile" };
  const o3 = await flow("good-code", "", { consentVersion: CONSENT_VERSION });
  const v3 = await (await gcall("/relay/auth/verify", { method: "POST", body: { token: /#signin=([A-Za-z0-9_-]{43})$/.exec(o3.loc)[1], nonce: o3.nonce } })).json();
  assert.ok(v3.sessionToken && !v3.mailConnected);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gmail_connections").get().n, 0);
  // A name that isn't a name is not offered.
  claims = { name: "<script>alert(1)</script>" }; grant = {};
  const o4 = await flow();
  const v4 = await (await gcall("/relay/auth/verify", { method: "POST", body: { token: /#signin=([A-Za-z0-9_-]{43})$/.exec(o4.loc)[1], nonce: o4.nonce } })).json();
  assert.equal(v4.suggestedName, undefined);
  claims = {}; grant = {};
  const pv = await (await gcall("/relay/auth/providers")).json();
  assert.equal(pv.consent.version, CONSENT_VERSION, "the wording is served for Google sign-in too");
  console.log("ok - one step: Agree and continue with Google signs in, connects Gmail and starts the first scan");
}


// Passkeys (Face ID). A FAKE authenticator makes real P-256 keys and signatures; nothing here proves a real iPhone works.
{
  const { generateKeyPairSync, randomBytes, createHash, sign: nodeSign } = await import("node:crypto");
  const APP = "https://zzmm92nr59-cloud.github.io", RP = "zzmm92nr59-cloud.github.io";
  const b64u = b => Buffer.from(b).toString("base64url");
  const sha = b => createHash("sha256").update(b).digest();
  const cbor = v => {
    const head = (major, n) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
    if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
    if (typeof v === "string") { const t = Buffer.from(v); return Buffer.concat([head(3, t.length), t]); }
    if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
    if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
    throw new Error("cbor");
  };
  const newDevice = () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    return { privateKey, x: Buffer.from(jwk.x, "base64url"), y: Buffer.from(jwk.y, "base64url"), id: randomBytes(32), count: 0 };
  };
  const clientData = (type, challenge, origin = APP) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const authData = (flags, count, rp = RP, attested) => {
    const h = Buffer.concat([sha(rp), Buffer.from([flags]), Buffer.from([count >>> 24, (count >> 16) & 255, (count >> 8) & 255, count & 255])]);
    if (!attested) return h;
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, attested.x], [-3, attested.y]]));
    return Buffer.concat([h, Buffer.alloc(16), Buffer.from([attested.id.length >> 8, attested.id.length & 255]), attested.id, cose]);
  };
  const create = (dev, challenge, o = {}) => ({
    id: b64u(dev.id), response: {
      clientDataJSON: b64u(clientData("webauthn.create", challenge, o.origin)),
      attestationObject: b64u(cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData(o.flags ?? 0x45, 0, o.rp, dev)]])))
    }
  });
  const get = (dev, challenge, o = {}) => {
    dev.count = o.count ?? dev.count + 1;
    const cd = clientData("webauthn.get", challenge, o.origin), ad = authData(o.flags ?? 0x05, dev.count, o.rp);
    const sig = nodeSign("sha256", Buffer.concat([ad, sha(cd)]), o.key || dev.privateKey);
    return { id: b64u(dev.id), response: { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(sig), userHandle: o.userHandle } };
  };
  const orig = { origin: APP };
  async function link(email, ip) {
    emails = [];
    await call("/relay/auth/request", { method: "POST", body: { email }, ip });
    const t = tokenFromEmail(emails[0]);
    return (await (await call("/relay/auth/verify", { method: "POST", body: { token: t } })).json()).sessionToken;
  }
  const sess = await link("pk@example.com", "7.7.7.7");
  const other = await link("other@example.com", "7.7.7.8");
  const opts = async token => (await call("/relay/my/passkeys/options", { method: "POST", token, ...orig })).json();
  const reg = (token, body) => call("/relay/my/passkeys/register", { method: "POST", token, body, ...orig });
  const loginOpts = async () => (await call("/relay/auth/passkey/options", { method: "POST", ...orig })).json();
  const login = body => call("/relay/auth/passkey/verify", { method: "POST", body, ...orig });

  assert.equal((await call("/relay/my/passkeys/options", { method: "POST" })).status, 401, "adding a passkey needs sign-in");
  const dev = newDevice();
  const o1 = await opts(sess);
  assert.equal(o1.rp.id, RP); assert.equal(o1.authenticatorSelection.userVerification, "required"); assert.deepEqual(o1.pubKeyCredParams, [{ type: "public-key", alg: -7 }]);
  // refusals at registration
  assert.equal((await reg(sess, create(dev, o1.challenge, { flags: 0x41 }))).status, 400, "no user verification refused");
  const o2 = await opts(sess);
  assert.equal((await reg(sess, create(dev, o2.challenge, { origin: "https://evil.test" }))).status, 400, "wrong origin refused");
  const o3 = await opts(sess);
  assert.equal((await reg(sess, create(dev, o3.challenge, { rp: "evil.test" }))).status, 400, "wrong relying party refused");
  const o4 = await opts(other);
  assert.equal((await reg(sess, create(dev, o4.challenge))).status, 400, "someone else's challenge refused");
  assert.equal((await reg(sess, create(dev, "A".repeat(43)))).status, 400, "unknown challenge refused");
  // success, and the challenge cannot be reused
  const o5 = await opts(sess);
  const okReg = await reg(sess, { ...create(dev, o5.challenge), name: "My <b>iPhone</b>" });
  assert.equal(okReg.status, 200); assert.equal((await okReg.json()).name, "My biPhoneb iPhone".slice(0, 0) + "My biPhoneb");
  assert.equal((await reg(sess, create(newDevice(), o5.challenge))).status, 400, "challenge is single-use");
  const listed = await (await call("/relay/my/passkeys", { token: sess })).json();
  assert.equal(listed.passkeys.length, 1); assert.ok(!JSON.stringify(listed).includes("public"), "public key never sent back");
  assert.equal((await (await call("/relay/my/passkeys", { token: other })).json()).passkeys.length, 0, "private to the shopper");
  const dup = await opts(other);
  assert.equal((await reg(other, create(dev, dup.challenge))).status, 400, "same credential cannot be added to another shopper");

  // sign in
  const l1 = await loginOpts();
  const good = get(dev, l1.challenge, { userHandle: b64u(Buffer.from(sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("pk@example.com").id)) });
  const res = await login(good);
  assert.equal(res.status, 200);
  const sj = await res.json();
  assert.equal(sj.email, "pk@example.com");
  assert.equal((await (await call("/relay/me", { token: sj.sessionToken })).json()).email, "pk@example.com", "real session issued");
  assert.equal((await login(good)).status, 400, "the same sign-in cannot be replayed");
  const l2 = await loginOpts();
  assert.equal((await login(get(dev, l2.challenge, { flags: 0x01 }))).status, 400, "needs user verification");
  const l3 = await loginOpts();
  assert.equal((await login(get(dev, l3.challenge, { key: newDevice().privateKey }))).status, 400, "signature from a different key refused");
  const l4 = await loginOpts();
  assert.equal((await login(get(dev, l4.challenge, { origin: "https://evil.test" }))).status, 400, "wrong origin refused");
  const l5 = await loginOpts();
  assert.equal((await login(get(dev, l5.challenge, { rp: "evil.test" }))).status, 400, "wrong relying party refused");
  const l6 = await loginOpts();
  assert.equal((await login(get(dev, l6.challenge, { count: 1 }))).status, 400, "counter going backwards refused");
  const l7 = await loginOpts();
  assert.equal((await login(get(newDevice(), l7.challenge))).status, 400, "unknown passkey refused");
  const l8 = await loginOpts();
  assert.equal((await login(get(dev, l8.challenge, { userHandle: b64u(Buffer.from("someone-else")) }))).status, 400, "wrong user handle refused");
  const l9 = await loginOpts();
  assert.equal((await login(get(dev, l9.challenge))).status, 200, "still works after the refusals");
  // removal and limits
  assert.equal((await call("/relay/my/passkeys/remove", { method: "POST", token: other, body: { id: b64u(dev.id) }, ...orig })).status, 404, "cannot remove someone else's");
  for (let i = 0; i < 4; i++) { const d = newDevice(); const oo = await opts(sess); assert.equal((await reg(sess, create(d, oo.challenge))).status, 200); }
  assert.equal((await call("/relay/my/passkeys/options", { method: "POST", token: sess, ...orig })).status, 400, "at most five passkeys");
  assert.equal((await call("/relay/my/passkeys/remove", { method: "POST", token: sess, body: { id: b64u(dev.id) }, ...orig })).status, 200);
  const lx = await loginOpts();
  assert.equal((await login(get(dev, lx.challenge))).status, 400, "a removed passkey no longer signs in");
  assert.equal((await call("/relay/my/delete", { method: "POST", token: sess })).status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_passkeys").get().n, 0, "account deletion removes passkeys");
  assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM auth_webauthn_challenges").all()).includes(l1.challenge), false, "challenges stored only hashed");

  // ---- Authenticator-app 2-step (TOTP) ----
  const { _codeAt } = await import("../worker/totp.js");
  assert.equal(await _codeAt(new TextEncoder().encode("12345678901234567890"), 1), "287082", "matches the official RFC 6238 test vector");
  const hotp = (key, step) => { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step)); const h = createHmac("sha1", key).update(m).digest(); const o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
  const unb32 = t => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const out = []; for (const c of t.replace(/ /g, "")) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
  const stepNow = () => Math.floor(clock / 30000);
  const post = (path, token, body) => call(path, { method: "POST", token, body, ...orig });
  const firstFactor = async (email, ip) => { sqlite.exec("DELETE FROM auth_login_tokens"); emails = []; await call("/relay/auth/request", { method: "POST", body: { email }, ip }); return (await call("/relay/auth/verify", { method: "POST", body: { token: tokenFromEmail(emails[0]) } })).json(); };
  const second = (pendingToken, code) => post("/relay/auth/2fa/verify", undefined, { pendingToken, code });

  assert.equal((await call("/relay/my/2fa")).status, 401, "2-step settings need sign-in");
  const first = await firstFactor("tf@example.com", "7.7.9.1");
  const tfSession = first.sessionToken;
  assert.ok(tfSession, "no 2-step yet: normal sign-in");
  assert.deepEqual(await (await call("/relay/my/2fa", { token: tfSession })).json(), { enabled: false, app: false, text: false, phoneEnding: null, textAvailable: false, recoveryCodesLeft: 0 });
  assert.equal((await post("/relay/my/2fa/enable", tfSession, { code: "123456" })).status, 400, "cannot switch on before setup");
  // a passkey registered now must keep working without the second step later
  emails = [];
  const pkDev = newDevice(); const po = await opts(tfSession); assert.equal((await reg(tfSession, create(pkDev, po.challenge))).status, 200);
  assert.deepEqual(emails.map(e => [e.body.subject, e.body.to[0]]), [["Relay: A passkey was added", "tf@example.com"]], "adding a passkey is emailed to the shopper");
  const setup = await (await post("/relay/my/2fa/setup", tfSession, {})).json();
  assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\/Relay%3Atf%40example\.com\?secret=[A-Z2-7]{32}&issuer=Relay/);
  const key = unb32(setup.secret);
  assert.equal(key.length, 20);
  assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM auth_totp").all()).includes(setup.secret.replace(/ /g, "")), "secret is stored encrypted, not readable");
  assert.equal((await post("/relay/my/2fa/enable", tfSession, { code: "000000" })).status, 400, "wrong code does not switch it on");
  assert.equal((await post("/relay/my/2fa/enable", tfSession, { code: hotp(key, stepNow() + 2) })).status, 400, "a code from the future is refused");
  assert.equal((await first && (await call("/relay/my/2fa", { token: tfSession })).status), 200);
  const en = await post("/relay/my/2fa/enable", tfSession, { code: hotp(key, stepNow()) });
  assert.equal(en.status, 200);
  const recovery = (await en.json()).recoveryCodes;
  assert.equal(recovery.length, 8); recovery.forEach(c => assert.match(c, /^[a-z2-9]{5}-[a-z2-9]{5}$/));
  assert.equal(new Set(recovery).size, 8);
  assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM auth_totp_recovery").all()).includes(recovery[0]), "recovery codes stored only as hashes");
  assert.deepEqual(await (await call("/relay/my/2fa", { token: tfSession })).json(), { enabled: true, app: true, text: false, phoneEnding: null, textAvailable: false, recoveryCodesLeft: 8 });
  assert.equal((await post("/relay/my/2fa/setup", tfSession, {})).status, 400, "cannot overwrite a live secret");

  // sign-in now needs the second step
  const p1 = await firstFactor("tf@example.com", "7.7.9.2");
  assert.equal(p1.needsSecondStep, true); assert.equal(p1.sessionToken, undefined, "no session from the first step alone");
  assert.deepEqual(p1.methods, ["app"], "the app is the only second step"); assert.equal(p1.phoneEnding, undefined);
  assert.equal((await call("/relay/me", { token: p1.pendingToken })).status, 401, "pending token is not a session");
  assert.equal((await second(p1.pendingToken, "000000")).status, 400, "wrong code refused");
  assert.equal((await second(p1.pendingToken, hotp(key, stepNow()))).status, 400, "the code already used to switch it on cannot be replayed");
  clock += 30000;
  const done = await second(p1.pendingToken, hotp(key, stepNow()));
  assert.equal(done.status, 200); const dj = await done.json();
  assert.equal((await (await call("/relay/me", { token: dj.sessionToken })).json()).email, "tf@example.com");
  assert.equal((await second(p1.pendingToken, hotp(key, stepNow() + 1))).status, 400, "a finished sign-in cannot be reused");
  // a code only works once, even for a different sign-in
  const p2 = await firstFactor("tf@example.com", "7.7.9.3");
  assert.equal((await second(p2.pendingToken, hotp(key, stepNow()))).status, 400, "same code twice refused");
  // recovery code works once
  const rc = await second(p2.pendingToken, recovery[0].toUpperCase().replace("-", " "));
  assert.equal(rc.status, 200, "recovery code accepted (any case, dash optional)");
  const p3 = await firstFactor("tf@example.com", "7.7.9.4");
  assert.equal((await second(p3.pendingToken, recovery[0])).status, 400, "recovery code is single-use");
  assert.equal((await second(p3.pendingToken, recovery[1])).status, 200);
  assert.equal((await (await call("/relay/my/2fa", { token: dj.sessionToken })).json()).recoveryCodesLeft, 6);
  // someone else's code or pending sign-in is useless
  const otherPending = await firstFactor("other@example.com", "7.7.9.5");
  assert.ok(otherPending.sessionToken, "other shopper without 2-step signs in normally");
  const p4 = await firstFactor("tf@example.com", "7.7.9.6");
  assert.equal((await second(p4.pendingToken, "abc")).status, 400); assert.equal((await second("A".repeat(43), "123456")).status, 400, "unknown pending token refused");
  // limits: 5 wrong tries kill that sign-in, even if the right code follows (clock moved on so the account-wide limit is clear)
  clock += 16 * 60 * 1000;
  const p4b = await firstFactor("tf@example.com", "7.7.9.8");
  for (let i = 0; i < 4; i++) assert.equal((await second(p4b.pendingToken, "111111")).status, 400);
  assert.equal((await second(p4b.pendingToken, "222222")).status, 400);
  assert.equal((await second(p4b.pendingToken, hotp(key, stepNow()))).status, 400, "sign-in is cancelled after five wrong tries");
  // expiry
  const p5 = await firstFactor("tf@example.com", "7.7.9.7");
  clock += 11 * 60 * 1000;
  assert.equal((await second(p5.pendingToken, hotp(key, stepNow()))).status, 400, "half-finished sign-in expires");
  // account-wide limit on wrong codes
  clock += 20 * 60 * 1000;
  let limited = false;
  for (let i = 0; i < 4 && !limited; i++) { const px = await firstFactor("tf@example.com", "7.7.10." + i); if (px.error) { limited = px.error === "too_many_requests"; break; } for (let k = 0; k < 4; k++) { const r = await second(px.pendingToken, "333333"); if (r.status === 429) { limited = true; break; } } }
  assert.ok(limited, "too many wrong codes locks the account for a while");
  const locked = await firstFactor("tf@example.com", "7.7.11.1");
  if (locked.pendingToken) assert.equal((await second(locked.pendingToken, hotp(key, stepNow()))).status, 429, "correct code also paused during the lock");
  clock += 16 * 60 * 1000;
  // Face ID skips the second step (it already needs your face or fingerprint)
  const lp = await loginOpts();
  const pkLogin = await login(get(pkDev, lp.challenge, { userHandle: b64u(Buffer.from(sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("tf@example.com").id)) }));
  assert.equal(pkLogin.status, 200); assert.ok((await pkLogin.json()).sessionToken, "passkey sign-in gives a session directly");
  // switching off needs a valid code
  const live = (await (await call("/relay/auth/request", { method: "POST", body: { email: "tf@example.com" }, ip: "7.7.12.1" })).status, (await firstFactor("tf@example.com", "7.7.12.2")));
  const live2 = await second(live.pendingToken, recovery[2]); assert.equal(live2.status, 200);
  const liveToken = (await live2.json()).sessionToken;
  assert.equal((await post("/relay/my/2fa/disable", liveToken, { code: "000000" })).status, 400, "cannot switch off with a wrong code");
  assert.equal((await post("/relay/my/2fa/disable", other, { code: hotp(key, stepNow()) })).status, 400, "another shopper cannot switch it off");
  assert.equal((await post("/relay/my/2fa/disable", liveToken, { code: recovery[3] })).status, 200);
  assert.deepEqual(await (await call("/relay/my/2fa", { token: liveToken })).json(), { enabled: false, app: false, text: false, phoneEnding: null, textAvailable: false, recoveryCodesLeft: 0 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_totp_recovery").get().n, 0, "recovery codes removed when switched off");
  assert.ok((await firstFactor("tf@example.com", "7.7.12.3")).sessionToken, "after switching off, sign-in is normal again");
  // deletion removes everything
  const s2 = await post("/relay/my/2fa/setup", liveToken, {}); assert.equal(s2.status, 200);
  assert.equal((await post("/relay/my/delete", liveToken, {})).status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_totp").get().n, 0, "account deletion removes 2-step data");
}

// Phone numbers, and sign-in codes by text. FAKE Twilio (texts are captured above); made-up numbers from Ofcom's range
// for TV and film (07700 900xxx). Nothing here proves a real text arrives.
{
  const { normaliseUkMobile } = await import("../worker/phone.js");
  const { twoStepOn } = await import("../worker/totp.js");
  const O = { origin: "https://zzmm92nr59-cloud.github.io" };
  const post = (path, token, body, ip = "8.8.1.1") => call(path, { method: "POST", token, body, ip, ...O });
  const get = (path, token) => call(path, { token });
  const codeOf = t => /^(\d{6}) is your Relay /.exec(t.Body)[1];
  const notIt = c => (c === "000000" ? "111111" : "000000");
  const firstFactor = async (email, ip) => { sqlite.exec("DELETE FROM auth_login_tokens"); emails = []; await call("/relay/auth/request", { method: "POST", body: { email }, ip }); return (await call("/relay/auth/verify", { method: "POST", body: { token: tokenFromEmail(emails[0]) } })).json(); };
  const hotp = (key, step) => { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step)); const h = createHmac("sha1", key).update(m).digest(); const o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
  const unb32 = t => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const out = []; for (const c of t.replace(/ /g, "")) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
  const stepNow = () => Math.floor(clock / 30000);
  const HOUR = 60 * 60 * 1000;

  // UK mobile numbers, written any of the usual ways. Not landlines, 070 personal numbers, pagers or other countries.
  for (const ok of ["07700 900123", "07700-900-123", "+44 7700 900123", "+44 (0)7700 900123", "00447700900123", "447700900123", "07624 123456"]) assert.ok(normaliseUkMobile(ok), ok);
  assert.equal(normaliseUkMobile(" 07700 900123 "), "+447700900123");
  for (const bad of ["020 7946 0000", "07000 123456", "07600 123456", "+1 415 555 0100", "0770090012", "077009001234", "07700 9OO123", "", null, "0".repeat(40)])
    assert.equal(normaliseUkMobile(bad), null, String(bad));

  const s1 = (await firstFactor("phone@example.com", "8.8.0.1")).sessionToken;
  assert.ok(s1);
  // Without Twilio's secrets nothing pretends to send.
  assert.deepEqual(await (await get("/relay/my/phone", s1)).json(), { available: false, ending: null, confirmedAt: null, twoStep: false });
  r = await post("/relay/my/phone/start", s1, { phone: "07700 900123" });
  assert.equal(r.status, 503); assert.equal((await r.json()).error, "sms_not_configured"); assert.equal(texts.length, 0);

  Object.assign(env, { TWILIO_ACCOUNT_SID: "AC_fake_account", TWILIO_AUTH_TOKEN: "fake-twilio-token", TWILIO_FROM: "Relay" });
  assert.equal((await get("/relay/my/phone")).status, 401, "needs sign-in");
  assert.equal((await post("/relay/my/phone/start", s1, { phone: "020 7946 0000" })).status, 400, "a landline is refused");
  assert.equal((await call("/relay/my/phone/start", { method: "POST", token: s1, body: { phone: "07700 900123" }, origin: "https://evil.example" })).status, 403);
  assert.equal(texts.length, 0);
  r = await post("/relay/my/phone/start", s1, { phone: "07700 900123" });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, ending: "123", resendIn: 30 });
  assert.equal(texts.length, 1);
  const t1 = texts[0], c1 = codeOf(t1);
  assert.equal(t1.url, "https://api.twilio.com/2010-04-01/Accounts/AC_fake_account/Messages.json");
  assert.equal(t1.auth, "Basic " + Buffer.from("AC_fake_account:fake-twilio-token").toString("base64"));
  assert.equal(t1.To, "+447700900123"); assert.equal(t1.From, "Relay");
  assert.match(t1.Body, /^\d{6} is your Relay code to confirm this number\. It expires in 10 minutes\. Don't share it with anyone\.\n\n@zzmm92nr59-cloud\.github\.io #\d{6}$/,
    "the code first (it shows in the notification), and the last line lets the phone offer it on Relay's own site");
  assert.equal(t1.Body.split(" #")[1], c1);
  assert.ok(t1.Body.length <= 160 && /^[\x20-\x7e\n]*$/.test(t1.Body), "one plain text message");
  const dump = () => JSON.stringify([sqlite.prepare("SELECT * FROM auth_sms_codes").all(), sqlite.prepare("SELECT * FROM auth_phone").all(), sqlite.prepare("SELECT * FROM auth_sms_log").all()]);
  assert.ok(!dump().includes("7700900123"), "the number is never stored readable");
  assert.ok(!sqlite.prepare("SELECT * FROM auth_sms_codes").all().some(row => Object.values(row).includes(c1)), "nor the code");
  // A second tap doesn't send a second text.
  r = await post("/relay/my/phone/start", s1, { phone: "07700 900123" });
  assert.equal(r.status, 429); const w = await r.json(); assert.equal(w.error, "wait"); assert.ok(w.retryAfter > 0 && w.retryAfter <= 30);
  assert.equal(texts.length, 1);
  // Wrong code, someone else's account, then the right code (spaces are fine), once.
  assert.equal((await post("/relay/my/phone/confirm", s1, { code: notIt(c1) })).status, 400);
  const s2 = (await firstFactor("someone@example.com", "8.8.0.2")).sessionToken;
  assert.equal((await post("/relay/my/phone/confirm", s2, { code: c1 })).status, 400, "a code only works for the account it was sent for");
  r = await post("/relay/my/phone/confirm", s1, { code: c1.slice(0, 3) + " " + c1.slice(3) });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, ending: "123" });
  assert.equal((await post("/relay/my/phone/confirm", s1, { code: c1 })).status, 400, "single-use");
  let st = await (await get("/relay/my/phone", s1)).json();
  assert.equal(st.available, true); assert.equal(st.ending, "123"); assert.equal(st.twoStep, false); assert.ok(st.confirmedAt);
  assert.deepEqual(await (await get("/relay/my/phone", s2)).json(), { available: true, ending: null, confirmedAt: null, twoStep: false }, "another shopper sees nothing of it");
  assert.ok((await firstFactor("phone@example.com", "8.8.0.3")).sessionToken, "a confirmed number alone doesn't change signing in");
  // Codes expire after 10 minutes; five wrong tries and a code is dead; only the newest number asked for can be confirmed.
  clock += 31000; texts = [];
  assert.equal((await post("/relay/my/phone/start", s2, { phone: "07700 900456" })).status, 200);
  const c2 = codeOf(texts[0]);
  clock += 10 * 60 * 1000 + 1;
  assert.equal((await post("/relay/my/phone/confirm", s2, { code: c2 })).status, 400, "expired");
  texts = []; assert.equal((await post("/relay/my/phone/start", s2, { phone: "07700 900456" })).status, 200);
  const c3 = codeOf(texts[0]);
  for (let i = 0; i < 5; i++) assert.equal((await post("/relay/my/phone/confirm", s2, { code: notIt(c3) })).status, 400);
  assert.equal((await post("/relay/my/phone/confirm", s2, { code: c3 })).status, 400, "five wrong tries and that code is dead");
  clock += 31000; texts = []; await post("/relay/my/phone/start", s2, { phone: "07700 900456" }); const older = codeOf(texts[0]);
  clock += 31000; texts = []; await post("/relay/my/phone/start", s2, { phone: "07700 900789" }); const newer = codeOf(texts[0]);
  assert.equal((await post("/relay/my/phone/confirm", s2, { code: older })).status, 400, "only the newest number asked for can be confirmed");
  assert.equal((await post("/relay/my/phone/confirm", s2, { code: newer })).status, 200);
  assert.equal((await (await get("/relay/my/phone", s2)).json()).ending, "789");
  assert.equal((await post("/relay/my/phone/remove", s2, {})).status, 200);
  assert.equal((await (await get("/relay/my/phone", s2)).json()).ending, null, "removed");
  console.log("ok - phone number: UK mobiles only, confirmed by a texted code that works once, for its own account, for 10 minutes; stored scrambled");

  // Codes by text when signing in. Switching it on needs a code texted now.
  clock += HOUR;
  assert.deepEqual(await (await get("/relay/my/2fa", s1)).json(), { enabled: false, app: false, text: false, phoneEnding: "123", textAvailable: true, recoveryCodesLeft: 0 });
  assert.equal((await post("/relay/my/2fa/text", s1, { on: true, code: "123456" })).status, 400, "not without a fresh code");
  texts = []; r = await post("/relay/my/2fa/text/send", s1, {}, "8.8.2.1"); assert.equal(r.status, 200);
  assert.match(texts[0].Body, /^\d{6} is your Relay code to change your sign-in settings\./); assert.equal(texts[0].To, "+447700900123");
  const m1 = codeOf(texts[0]);
  assert.equal((await post("/relay/my/2fa/text/send", s2, {}, "8.8.2.2")).status, 400, "no number, nothing to text");
  assert.equal((await post("/relay/my/2fa/text", s2, { on: true, code: m1 })).status, 400, "someone else's code is useless");
  r = await post("/relay/my/2fa/text", s1, { on: true, code: m1 });
  assert.equal(r.status, 200);
  const rec = (await r.json()).recoveryCodes;
  assert.equal(rec.length, 8, "the first two-step method comes with recovery codes, shown once");
  assert.deepEqual(await (await get("/relay/my/2fa", s1)).json(), { enabled: true, app: false, text: true, phoneEnding: "123", textAvailable: true, recoveryCodesLeft: 8 });
  assert.equal(await twoStepOn(env, sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("phone@example.com").id), true,
    "\"sign in and connect your email\" waits for the second step too");
  // The number can't be swapped or removed while sign-in codes go to it.
  assert.equal((await post("/relay/my/phone/start", s1, { phone: "07700 900999" })).status, 409);
  assert.equal((await post("/relay/my/phone/remove", s1, {})).status, 409);
  // Signing in: the first step alone gives no session; the app asks for the text, and the texted code finishes it.
  const p = await firstFactor("phone@example.com", "8.8.0.4");
  assert.equal(p.needsSecondStep, true); assert.equal(p.sessionToken, undefined);
  assert.deepEqual(p.methods, ["text"]); assert.equal(p.phoneEnding, "123");
  texts = []; r = await post("/relay/auth/2fa/text", undefined, { pendingToken: p.pendingToken }, "8.8.3.1");
  assert.equal(r.status, 200); assert.equal((await r.json()).ending, "123");
  assert.match(texts[0].Body, /^\d{6} is your Relay sign-in code\. It expires in 10 minutes\. Don't share it with anyone\.\n\n@zzmm92nr59-cloud\.github\.io #\d{6}$/);
  assert.equal(texts[0].To, "+447700900123");
  const sc = codeOf(texts[0]);
  assert.equal((await post("/relay/auth/2fa/text", undefined, { pendingToken: p.pendingToken }, "8.8.3.1")).status, 429, "no second text straight away");
  assert.equal((await post("/relay/auth/2fa/text", undefined, { pendingToken: "A".repeat(43) })).status, 400, "unknown sign-in");
  assert.equal((await call("/relay/auth/2fa/text", { method: "POST", body: { pendingToken: p.pendingToken }, origin: "https://evil.example" })).status, 403);
  const pOther = await firstFactor("phone@example.com", "8.8.0.5");
  assert.equal((await post("/relay/auth/2fa/verify", undefined, { pendingToken: pOther.pendingToken, code: sc })).status, 400, "a code for one sign-in can't finish another");
  r = await post("/relay/auth/2fa/verify", undefined, { pendingToken: p.pendingToken, code: sc });
  assert.equal(r.status, 200); const done = await r.json();
  assert.equal((await (await call("/relay/me", { token: done.sessionToken })).json()).email, "phone@example.com");
  assert.equal((await post("/relay/auth/2fa/verify", undefined, { pendingToken: p.pendingToken, code: sc })).status, 400, "finished");
  const p2 = await firstFactor("phone@example.com", "8.8.0.6");
  assert.equal((await post("/relay/auth/2fa/verify", undefined, { pendingToken: p2.pendingToken, code: rec[0] })).status, 200, "a recovery code works when the phone is lost");
  // Twilio refusing a text is reported plainly (never Twilio's own wording) and leaves no code behind.
  failText = true;
  const p3 = await firstFactor("phone@example.com", "8.8.0.7");
  r = await post("/relay/auth/2fa/text", undefined, { pendingToken: p3.pendingToken }, "8.8.3.2");
  assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: "sms_send_failed" });
  failText = false;
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_sms_codes WHERE purpose = 'signin'").get().n, 1, "only the sign-in text that went has a code: none for the one Twilio refused");
  // The download includes the number.
  const mine = await (await get("/relay/my/export", done.sessionToken)).json();
  assert.deepEqual({ ...mine.signIn.phone, confirmedAt: Boolean(mine.signIn.phone.confirmedAt), since: Boolean(mine.signIn.phone.since) },
    { number: "+447700900123", confirmedAt: true, signInCodesByText: true, since: true });
  console.log("ok - codes by text at sign-in: switched on with a fresh code, recovery codes once, texted per sign-in, works once, for that sign-in only");

  // Limits: per shopper, per number (even across accounts, and after an account is deleted), and across Relay each day.
  clock += 2 * HOUR;
  const busy = (await firstFactor("busy@example.com", "8.8.0.20")).sessionToken;
  texts = []; await post("/relay/my/phone/start", busy, { phone: "07700 900321" }, "8.8.4.1"); await post("/relay/my/phone/confirm", busy, { code: codeOf(texts[0]) });
  for (let i = 0; i < 4; i++) { clock += 31000; assert.equal((await post("/relay/my/2fa/text/send", busy, {}, "8.8.4.1")).status, 200, "send " + (i + 2)); }
  clock += 31000;
  r = await post("/relay/my/2fa/text/send", busy, {}, "8.8.4.1");
  assert.equal(r.status, 429); assert.equal((await r.json()).error, "too_many_requests", "five texts an hour per shopper");
  assert.equal((await post("/relay/my/phone/remove", busy, {})).status, 200);
  clock += 31000;
  assert.equal((await post("/relay/my/phone/start", busy, { phone: "07700 900322" }, "8.8.4.2")).status, 429, "removing the number doesn't reset the shopper's count");
  // Codes to confirm a number: three an hour to one number, whoever asks, even after deleting an account. A stranger using
  // those up doesn't stop the number's owner getting their own codes.
  const owner = (await firstFactor("owner@example.com", "8.8.0.24")).sessionToken;
  clock += 31000; texts = []; assert.equal((await post("/relay/my/phone/start", owner, { phone: "07700 900555" }, "8.8.6.2")).status, 200);
  assert.equal((await post("/relay/my/phone/confirm", owner, { code: codeOf(texts[0]) })).status, 200);
  const a1 = (await firstFactor("pest1@example.com", "8.8.0.21")).sessionToken;
  for (let i = 0; i < 2; i++) { clock += 31000; assert.equal((await post("/relay/my/phone/start", a1, { phone: "07700 900555" }, "8.8.5." + i)).status, 200); }
  assert.equal((await post("/relay/my/delete", a1, {})).status, 200);
  const a2 = (await firstFactor("pest2@example.com", "8.8.0.22")).sessionToken;
  clock += 31000;
  assert.equal((await post("/relay/my/phone/start", a2, { phone: "07700 900555" }, "8.8.6.1")).status, 429, "three 'confirm' texts an hour per number");
  texts = [];
  assert.equal((await post("/relay/my/2fa/text/send", owner, {}, "8.8.6.2")).status, 200, "the account's own texts have their own allowance");
  assert.equal(texts[0].To, "+447700900555");
  // Requests sent all at once can't slip past: forty taps send one text.
  const burst = (await firstFactor("burst@example.com", "8.8.0.25")).sessionToken;
  texts = []; clock += 31000;
  const many = await Promise.all(Array.from({ length: 40 }, () => post("/relay/my/phone/start", burst, { phone: "07700 900777" }, "8.8.9.1")));
  assert.equal(many.filter(x => x.status === 200).length, 1); assert.equal(texts.length, 1, "forty taps at once send one text");
  // Guesses sent all at once still get five tries between them, and only the newest code works.
  const right = codeOf(texts[0]);
  const guesses = await Promise.all([...Array.from({ length: 30 }, (_, i) => post("/relay/my/phone/confirm", burst, { code: String(100000 + i) === right ? "999999" : String(100000 + i) })), post("/relay/my/phone/confirm", burst, { code: right })]);
  assert.ok(guesses.filter(x => x.status === 200).length <= 1);
  assert.ok(sqlite.prepare("SELECT MAX(attempts) m FROM auth_sms_codes WHERE purpose = 'confirm' AND ref = ?").get("confirm:" + sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("burst@example.com").id).m <= 5, "never more than five tries on a code");
  clock += 31000; texts = []; await post("/relay/my/phone/start", burst, { phone: "07700 900778" }, "8.8.9.1"); const c778a = codeOf(texts[0]);
  clock += 31000; texts = []; await post("/relay/my/phone/start", burst, { phone: "07700 900778" }, "8.8.9.1"); const c778b = codeOf(texts[0]);
  if (c778a !== c778b) assert.equal((await post("/relay/my/phone/confirm", burst, { code: c778a })).status, 400, "a newer code replaces the last one");
  assert.equal((await post("/relay/my/phone/confirm", burst, { code: c778b })).status, 200);
  // The daily cap for 'confirm' texts across Relay (sign-in texts have a cap of their own).
  const sent = sqlite.prepare("SELECT COUNT(*) n FROM auth_sms_log WHERE kind = 'confirm' AND created_at > ?").get(clock - 24 * HOUR).n;
  env.SMS_DAILY_LIMIT = String(sent + 1);
  const a3 = (await firstFactor("fine@example.com", "8.8.0.23")).sessionToken;
  assert.equal((await post("/relay/my/phone/start", a3, { phone: "07700 900666" }, "8.8.7.1")).status, 200);
  clock += 31000;
  assert.equal((await post("/relay/my/phone/start", a3, { phone: "07700 900667" }, "8.8.7.2")).status, 429, "the daily cap across Relay");
  clock += 31000;
  assert.equal((await post("/relay/my/2fa/text/send", owner, {}, "8.8.6.3")).status, 200, "sign-in and settings texts aren't stopped by it");
  delete env.SMS_DAILY_LIMIT;
  assert.ok(sqlite.prepare("SELECT * FROM auth_sms_log").all().every(row => Object.keys(row).join() === "who_hash,phone_hash,client_hash,ref_hash,kind,created_at"
    && /^[0-9a-f]{64}$/.test(row.who_hash) && /^[0-9a-f]{64}$/.test(row.phone_hash)), "the send log keeps only scrambled accounts, numbers and addresses");
  console.log("ok - text limits: one step, so taps or guesses sent all at once can't slip past; 'confirm' texts can't use up anyone's sign-in texts; removing or deleting resets nothing");

  // Switching it off needs a code: texted now or a recovery code. Nothing else.
  clock += 2 * HOUR;
  const sb = done.sessionToken;
  assert.equal((await post("/relay/my/2fa/text", sb, { on: false, code: "000000" })).status, 400);
  assert.equal((await post("/relay/my/2fa/text", s2, { on: false, code: rec[1] })).status, 400, "another shopper can't switch it off");
  // One way at a time: with texts on, an app can't be added (so a stolen session can't add its own and switch texts off).
  assert.equal((await post("/relay/my/2fa/setup", sb, {})).status, 409, "no app while texts are on");
  texts = []; assert.equal((await post("/relay/my/2fa/text/send", sb, {}, "8.8.8.1")).status, 200);
  assert.equal((await post("/relay/my/2fa/text", sb, { on: false, code: codeOf(texts[0]) })).status, 200);
  assert.deepEqual(await (await get("/relay/my/2fa", sb)).json(), { enabled: false, app: false, text: false, phoneEnding: "123", textAvailable: true, recoveryCodesLeft: 0 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_totp_recovery").get().n, 0, "recovery codes go when nothing needs them");
  assert.ok((await firstFactor("phone@example.com", "8.8.0.8")).sessionToken, "signing in is back to one step");
  // ...and with the app on, texts can't be added, even with a code texted to a new number.
  const setup = await (await post("/relay/my/2fa/setup", sb, {})).json();
  const key = unb32(setup.secret);
  assert.equal((await post("/relay/my/2fa/enable", sb, { code: hotp(key, stepNow()) })).status, 200);
  clock += 31000; texts = []; await post("/relay/my/2fa/text/send", sb, {}, "8.8.8.2");
  assert.equal((await post("/relay/my/2fa/text", sb, { on: true, code: codeOf(texts[0]) })).status, 409, "no texts while the app is on");
  clock += 31000; texts = []; await post("/relay/my/phone/start", sb, { phone: "07700 900888" }, "8.8.8.3");
  assert.equal((await post("/relay/my/2fa/text", sb, { on: true, code: codeOf(texts[0]) })).status, 409, "not even with a new number");
  assert.deepEqual((await firstFactor("phone@example.com", "8.8.0.9")).methods, ["app"]);
  clock += 30000;
  assert.equal((await post("/relay/my/2fa/disable", sb, { code: hotp(key, stepNow()) })).status, 200);
  assert.equal((await (await get("/relay/my/2fa", sb)).json()).enabled, false);
  // Deleting the account removes the number and every code.
  assert.equal((await post("/relay/my/delete", sb, {})).status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_phone WHERE shopper_id NOT IN (SELECT id FROM shoppers)").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_sms_codes WHERE shopper_id NOT IN (SELECT id FROM shoppers)").get().n, 0);
  // The send log and old codes go after two days, also on the hourly schedule when no texts are being sent.
  const { tidyTexts } = await import("../worker/phone.js");
  assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM auth_sms_log").get().n > 0);
  await tidyTexts(env, clock + 2 * 24 * HOUR + 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_sms_log").get().n + sqlite.prepare("SELECT COUNT(*) n FROM auth_sms_codes").get().n, 0, "nothing kept past two days");
  for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"]) delete env[k];
  console.log("ok - switching codes by text off needs a code; one way at a time (texts or an app); deletion removes the number and its codes; nothing kept past two days");
}

console.log("PASS shopper sign-in, single-use links, expiry, rate limits, ownership isolation, logout and deletion, phone numbers and codes by text (fake email and text delivery)");
