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
  assert.deepEqual(await (await call("/relay/my/2fa", { token: tfSession })).json(), { enabled: false, recoveryCodesLeft: 0 });
  assert.equal((await post("/relay/my/2fa/enable", tfSession, { code: "123456" })).status, 400, "cannot switch on before setup");
  // a passkey registered now must keep working without the second step later
  const pkDev = newDevice(); const po = await opts(tfSession); assert.equal((await reg(tfSession, create(pkDev, po.challenge))).status, 200);
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
  assert.deepEqual(await (await call("/relay/my/2fa", { token: tfSession })).json(), { enabled: true, recoveryCodesLeft: 8 });
  assert.equal((await post("/relay/my/2fa/setup", tfSession, {})).status, 400, "cannot overwrite a live secret");

  // sign-in now needs the second step
  const p1 = await firstFactor("tf@example.com", "7.7.9.2");
  assert.equal(p1.needsSecondStep, true); assert.equal(p1.sessionToken, undefined, "no session from the first step alone");
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
  assert.deepEqual(await (await call("/relay/my/2fa", { token: liveToken })).json(), { enabled: false, recoveryCodesLeft: 0 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_totp_recovery").get().n, 0, "recovery codes removed when switched off");
  assert.ok((await firstFactor("tf@example.com", "7.7.12.3")).sessionToken, "after switching off, sign-in is normal again");
  // deletion removes everything
  const s2 = await post("/relay/my/2fa/setup", liveToken, {}); assert.equal(s2.status, 200);
  assert.equal((await post("/relay/my/delete", liveToken, {})).status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_totp").get().n, 0, "account deletion removes 2-step data");
}

console.log("PASS shopper sign-in, single-use links, expiry, rate limits, ownership isolation, logout and deletion (fake email delivery)");
