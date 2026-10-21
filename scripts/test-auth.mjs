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
const fetchImpl = async (url, init) => {
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
const codeOf = e => /code into the Relay app: (\d{6})/.exec(e.body.text)[1];
emails = [];
await call("/relay/auth/request", { method: "POST", body: { email: "dana@example.com" }, ip: "7.7.7.7" });
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

// 8. Non-auth routes untouched.
assert.equal(await handleAuthRoute(new Request("https://w.test/relay/shopify/status"), env, new URL("https://w.test/relay/shopify/status"), {}, {}), null);

// Sign in with Google (identity only). FAKE Google: nothing here proves real Google accepts the redirect address.
{
  const genv = { ...env, GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test" };
  const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const nonceOf = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  let claims = {};
  const gfetch = async (url, init) => {
    if (String(url) === "https://oauth2.googleapis.com/token") {
      const p = new URLSearchParams(String(init.body));
      if (p.get("code") !== "good-code" || p.get("client_secret") !== "client-secret-test") return new Response("{}", { status: 400 });
      return Response.json({ access_token: "a", id_token: "h." + b64u({ iss: "https://accounts.google.com", aud: "client-id.apps.test", exp: Math.floor(clock / 1000) + 3600, email: "alice@example.com", email_verified: true, ...claims }) + ".s" });
    }
    return new Response("blocked", { status: 500 });
  };
  const gcall = (path, { method = "GET", body, token } = {}) =>
    handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9.9", ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined }), genv, new URL("https://w.test" + path), {}, { now: clock, fetchImpl: gfetch });
  async function flow(code = "good-code", extra = "") {
    const nonce = nonceOf();
    const st = await (await gcall("/relay/auth/google/start", { method: "POST", body: { nonce } })).json();
    const u = new URL(st.url);
    const cb = await gcall(`/relay/gmail/callback?code=${code}&state=${u.searchParams.get("state")}${extra}`);
    return { nonce, u, cb, loc: cb.headers.get("location") || "" };
  }
  assert.equal((await gcall("/relay/auth/google/start", { method: "POST", body: {} })).status, 400, "start needs a browser secret");
  assert.equal((await handleAuthRoute(new Request("https://w.test/relay/auth/google/start", { method: "POST", body: JSON.stringify({ nonce: nonceOf() }) }), env, new URL("https://w.test/relay/auth/google/start"), {}, { now: clock, fetchImpl: gfetch })).status, 503, "off until Google is configured");
  assert.equal((await gcall("/relay/auth/google/start", { method: "POST", body: { nonce: "x" } })).status, 400);
  const a = await flow();
  assert.equal(a.u.origin + a.u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(a.u.searchParams.get("scope"), "openid email", "identity only: no Gmail access requested");
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
}

console.log("PASS shopper sign-in, single-use links, expiry, rate limits, ownership isolation, logout and deletion (fake email delivery)");
