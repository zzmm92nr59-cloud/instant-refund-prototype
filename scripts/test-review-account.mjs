// Offline tests for the sign-in for app reviewers (worker/review-account.js), against a real SQLite engine.
// Email delivery is faked: the tests check no email is even attempted for the reviewer's address.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { receiveShopifyWebhook } from "../worker/shopify-webhooks.js";
import { reviewCode } from "../worker/review-account.js";

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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "admin@relay.test",
  SHOPIFY_SHOP_DOMAIN: "relay-demo.myshopify.com", SHOPIFY_WEBHOOK_SECRET: "wh-secret" };

let emails = [];
const fetchImpl = async (url, init) => { emails.push({ url: String(url), body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); };
let clock = 1_800_000_000_000;
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
const tokenFromEmail = e => /#signin=([A-Za-z0-9_-]{43})/.exec(e.body.text)[1];
async function signIn(email, ip) {
  emails = [];
  assert.equal((await call("/relay/auth/request", { method: "POST", body: { email }, ip })).status, 200);
  const r = await call("/relay/auth/verify", { method: "POST", body: { token: tokenFromEmail(emails[0]) } });
  assert.equal(r.status, 200);
  return (await r.json()).sessionToken;
}
async function codeSignIn(email, code, ip = "2.2.2.2") {
  const asked = await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const r = await call("/relay/auth/verify-code", { method: "POST", body: { email, code }, ip });
  return { asked, r, body: await r.json() };
}
const pass = name => console.log("ok - " + name);

// --- Off until an admin turns it on, and only an admin can ---
const admin = await signIn("admin@relay.test");
const shopper = await signIn("someone@relay.test");
for (const [m, body] of [["GET"], ["POST", { on: true }]]) {
  for (const token of [shopper, undefined]) {
    const r = await call("/relay/my/admin/review-account", { method: m, body, token });
    assert.equal(r.status, token ? 404 : 401, "a shopper gets not found, a visitor not signed in");
  }
}
let st = await (await call("/relay/my/admin/review-account", { token: admin })).json();
assert.deepEqual(st, { on: false });
emails = [];
assert.equal((await call("/relay/auth/request", { method: "POST", body: { email: "relay-review-abc@example.com" } })).status, 200);
assert.equal(emails.length, 1, "with it off, an example.com address is an ordinary address");
pass("off until an admin turns it on; shoppers and visitors can't see or change it");

// --- Turning it on: a random example.com address and a 6-digit code worked out from AUTH_SECRET ---
assert.equal((await call("/relay/my/admin/review-account", { method: "POST", body: { on: "yes" }, token: admin })).status, 400, "on must be true or false");
st = await (await call("/relay/my/admin/review-account", { method: "POST", body: { on: true }, token: admin })).json();
assert.equal(st.on, true);
assert.match(st.email, /^relay-review-[a-z2-9]{10}@example\.com$/);
assert.match(st.code, /^\d{6}$/);
assert.equal(st.code, await reviewCode(env, st.email));
assert.notEqual(st.code, await reviewCode({ AUTH_SECRET: "a-different-secret-0123456789abc" }, st.email), "the code depends on the secret");
const again = await (await call("/relay/my/admin/review-account", { method: "POST", body: { on: true }, token: admin })).json();
assert.deepEqual(again, st, "turning it on again keeps the same address and code");
assert.deepEqual(await (await call("/relay/my/admin/review-account", { token: admin })).json(), st);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM review_account").get().n, 1);
assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM review_account").all()).includes(st.code), false, "the code isn't stored");
pass("turning it on makes a random example.com address and a 6-digit code that isn't stored");

// --- Signing in: no email is sent, the same code works each time it's asked for ---
const R = st.email, CODE = st.code;
emails = [];
let s1 = await codeSignIn(R, CODE);
assert.equal(s1.asked.status, 200);
assert.deepEqual(await s1.asked.json(), { ok: true, review: true });
assert.equal(emails.length, 0, "nothing is emailed to the reviewer's address");
assert.equal(s1.r.status, 200);
assert.ok(s1.body.sessionToken);
assert.equal(s1.body.reviewAccount, true, "the app is told it's the reviewer account");
const review = s1.body.sessionToken;
assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: R, code: CODE }, ip: "2.2.2.2" })).status, 400, "used once, the code needs asking for again");
const s2 = await codeSignIn(R, CODE, "3.3.3.3");
assert.equal(s2.r.status, 200, "asking again makes the same code usable again");
assert.equal(emails.length, 0);
emails = [];
assert.equal((await call("/relay/auth/request", { method: "POST", body: { email: "other@relay.test" } })).status, 200);
assert.equal(emails.length, 1, "other addresses still get their email");
const otherIn = await (await call("/relay/auth/verify", { method: "POST", body: { token: tokenFromEmail(emails[0]) } })).json();
assert.ok(otherIn.sessionToken);
assert.equal(otherIn.reviewAccount, undefined, "only the reviewer account is marked");
const other = otherIn.sessionToken;
pass("the reviewer signs in with the fixed code; nothing is emailed; other addresses are unchanged");

// --- Wrong codes: 5 per 15 minutes as for anyone, and 20 a day ---
const wrong = CODE === "111111" ? "222222" : "111111";
await call("/relay/auth/request", { method: "POST", body: { email: R }, ip: "4.4.4.4" });
for (let i = 0; i < 5; i++) assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: R, code: wrong }, ip: "4.4.4.4" })).status, 400);
assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: R, code: CODE }, ip: "4.4.4.4" })).status, 429, "five wrong codes stop even the right one");
// Three more rounds an hour apart, each asking for the code again and getting 5 wrong.
for (let round = 0; round < 3; round++) {
  clock += 61 * 60 * 1000;
  assert.equal((await call("/relay/auth/request", { method: "POST", body: { email: R }, ip: "4.4.4." + (10 + round) })).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: R, code: wrong }, ip: "4.4.4.4" })).status, 400);
}
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auth_code_failures WHERE email = ?").get(R).n, 20);
const lastWrong = clock;
clock += 61 * 60 * 1000;
assert.equal((await call("/relay/auth/request", { method: "POST", body: { email: R }, ip: "4.4.4.20" })).status, 200);
assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: R, code: CODE }, ip: "4.4.4.4" })).status, 429, "20 wrong codes in a day stop the reviewer sign-in for the day");
clock = lastWrong + 24 * 60 * 60 * 1000 + 60 * 1000;
const s3 = await codeSignIn(R, CODE, "5.5.5.5");
assert.equal(s3.asked.status, 200);
assert.equal(s3.r.status, 200, "a day after the last wrong code it works again");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auth_code_failures WHERE email = ?").get(R).n, 0, "signing in clears the count");
pass("wrong codes: 5 per 15 minutes as for anyone, then 20 a day for the reviewer's address");

// --- Nothing personal can be attached; everything else works ---
const blocked = [["/relay/my/gmail/connect", {}], ["/relay/my/gmail/connect", { provider: "microsoft", another: true }], ["/relay/my/passkeys/options"], ["/relay/my/passkeys/register", { id: "x", response: { clientDataJSON: "x", attestationObject: "x" } }],
  ["/relay/my/2fa/setup"], ["/relay/my/2fa/enable", { code: "123456" }], ["/relay/my/2fa/text", { on: true }], ["/relay/my/2fa/text/send"],
  ["/relay/my/phone/start", { phone: "07700900123" }], ["/relay/my/phone/confirm", { code: "123456" }], ["/relay/my/card/setup"], ["/relay/my/card/confirm", { setupIntentId: "seti_x" }]];
for (const [path, body] of blocked) {
  const r = await call(path, { method: "POST", body, token: review });
  assert.equal(r.status, 403, path);
  assert.deepEqual(await r.json(), { error: "not_for_review_account" }, path);
  const o = await call(path, { method: "POST", body, token: other });
  assert.notEqual((await o.json()).error, "not_for_review_account", "an ordinary shopper isn't blocked: " + path);
}
for (const path of ["/relay/my/purchases", "/relay/my/profile", "/relay/my/gmail", "/relay/my/2fa", "/relay/my/phone", "/relay/my/passkeys"])
  assert.equal((await call(path, { token: review })).status, 200, path);
assert.equal((await call("/relay/my/profile", { method: "POST", body: { name: "App Review" }, token: review })).status, 200);
pass("the reviewer account can't connect an inbox or add a passkey, two-step sign-in, phone or card; reading works");

// --- A test order placed with the reviewer's address shows up for the reviewer, and only for them ---
const data = JSON.stringify({ id: 9101, created_at: "2026-11-04T12:30:00+00:00", currency: "GBP", total_price: "20.00", email: R.toUpperCase(),
  line_items: [{ id: 91010, title: "Test T-shirt", variant_title: "S", quantity: 1, price: "20.00" }] });
const sig = createHmac("sha256", env.SHOPIFY_WEBHOOK_SECRET).update(data).digest("base64");
const hook = await receiveShopifyWebhook(new Request("https://w.test/relay/webhooks/shopify", { method: "POST",
  headers: { "x-shopify-shop-domain": "relay-demo.myshopify.com", "x-shopify-topic": "orders/paid", "x-shopify-hmac-sha256": sig, "x-shopify-webhook-id": "wh-9101" }, body: data }), env);
assert.equal(hook.status, 200);
const mine = (await (await call("/relay/my/purchases", { token: review })).json()).purchases;
assert.deepEqual(mine.map(p => p.amountMinor), [2000]);
assert.equal((await (await call("/relay/my/purchases", { token: other })).json()).purchases.length, 0);
pass("a test order placed with the reviewer's address is the reviewer account's, and nobody else's");

// --- Turning it off deletes the account and signs it out everywhere ---
await call("/relay/auth/request", { method: "POST", body: { email: R }, ip: "6.6.6.6" }); // a code left waiting
assert.deepEqual(await (await call("/relay/my/admin/review-account", { method: "POST", body: { on: false }, token: admin })).json(), { on: false });
for (const t of [review, s2.body.sessionToken, s3.body.sessionToken]) assert.equal((await call("/relay/my/purchases", { token: t })).status, 401);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shoppers WHERE email = ?").get(R).n, 0, "the account is deleted");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM retailer_order_emails WHERE email_hash = (SELECT email_hash FROM shoppers WHERE email = ?)").get(R).n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auth_login_tokens WHERE email IN (?, ?)").get(R, "code:" + R).n, 0, "no code is left waiting");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shopper_profiles").get().n, 0);
assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: R, code: CODE } })).status, 400);
emails = [];
const after = await call("/relay/auth/request", { method: "POST", body: { email: R }, ip: "7.7.7.7" });
assert.deepEqual(await after.json(), { ok: true });
assert.equal(emails.length, 1, "once off, the old address is an ordinary address again");
assert.equal((await call("/relay/auth/verify-code", { method: "POST", body: { email: R, code: CODE }, ip: "7.7.7.7" })).status, 400, "the old code no longer works");
assert.equal((await call("/relay/my/purchases", { token: other })).status, 200, "other accounts are untouched");
assert.equal((await call("/relay/my/purchases", { token: admin })).status, 200);
const next = await (await call("/relay/my/admin/review-account", { method: "POST", body: { on: true }, token: admin })).json();
assert.notEqual(next.email, R, "turning it on again makes a new address");
pass("turning it off deletes the account, signs it out everywhere and cancels its code; on again is a new address");

console.log("PASS reviewer sign-in");
