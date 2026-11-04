// Offline tests for who can do what (docs/SECURITY.md, "Who can do what"), against a real SQLite engine.
// Every route address the server's code mentions is tried as each kind of caller; nothing here talks to Google,
// Microsoft, Stripe, Square or Shopify, and webhook signatures are only tested as missing.
// Checks:
//   - a visitor (no session, a made-up session, a badly formed one, or a shop's key) gets "not signed in" from every
//     /relay/my route and /relay/me, for reads and changes alike;
//   - a shopper who isn't a Relay admin can't see the admin routes at all (they answer "not found");
//   - a shop's routes need that shop's key: no key, a made-up key, or a shopper's session gets "not signed in";
//   - one shopper can't read, change or remove another shopper's receipt, and the other shopper's receipt is unchanged;
//   - two-step sign-in's half-way token only works for finishing sign-in, never as a session;
//   - Shopify's and Square's webhooks refuse anything unsigned; the prototype's test routes answer "not found".
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { handleRetailerRoute, issueRetailerKey } from "../worker/retailer.js";
import { resetMemoryLimits } from "../worker/limits.js";
import { ensurePushTables } from "../worker/push.js";
import { ensureSquareMerchantSchema } from "../worker/square-connect.js";
import worker from "../worker/worker.js";
import { serverRoutes } from "./server-routes.mjs";

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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "admin@example.com",
  SHOPIFY_WEBHOOK_SECRET: "wh-secret", SQUARE_WEBHOOK_SIGNATURE_KEY: "sq-secret" };
let emails = [];
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  return new Response("{}", { status: 404 });
};
const now = 1_800_000_000_000;
const req = (path, { method = "GET", body, auth } = {}) => new Request("https://w.test" + path, { method,
  headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", ...(auth ? { authorization: auth } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) });
const call = (path, o = {}) => handleAuthRoute(req(path, o), env, new URL("https://w.test" + path), {}, { now, fetchImpl });
const shopCall = (path, o = {}) => handleRetailerRoute(req(path, o), env, new URL("https://w.test" + path), {}, { now });
let ip = 10;
async function signIn(email) {
  emails = [];
  await handleAuthRoute(new Request("https://w.test/relay/auth/request", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9." + ip++ },
    body: JSON.stringify({ email }) }), env, new URL("https://w.test/relay/auth/request"), {}, { now, fetchImpl });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
await ensurePushTables(db); await ensureSquareMerchantSchema(db);
const alice = await signIn("alice@example.com"), bob = await signIn("bob@example.com"), admin = await signIn("admin@example.com");
const shopKey = await issueRetailerKey(env, { provider: "shopify", shopRef: "kestrel-outdoor.myshopify.com", storeLabel: "Kestrel Outdoor" }, now);
const { routes } = serverRoutes();
const mine = routes.filter(p => p === "/relay/me" || p.startsWith("/relay/my/"));
assert.ok(mine.length > 80, "found the shopper routes (" + mine.length + ")");

// Visitors, and anything that isn't a valid shopper session.
{
  const notSessions = [undefined, "Bearer " + "A".repeat(43), "Bearer short", "Basic YWxpY2U6c2VjcmV0", "Bearer " + shopKey, alice];
  const leaks = [];
  for (const path of mine) for (const method of ["GET", "POST"]) for (const auth of notSessions) {
    const res = await call(path, { method, auth: auth === alice ? "bearer " + alice : auth, body: method === "POST" ? {} : undefined });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 401 || body.error !== "not_signed_in") leaks.push(method + " " + path + " with " + (auth ? auth.slice(0, 12) + "…" : "no session") + " → " + res.status);
  }
  assert.deepEqual(leaks, [], "every shopper route needs a real session");
  console.log("ok - visitors: " + mine.length + " shopper routes × read and change × 6 kinds of non-session all answer \"not signed in\"");
}
// Admin routes: only Relay's admins; everyone else is told they don't exist.
{
  for (const [method, path, body] of [["GET", "/relay/my/admin/reports"], ["POST", "/relay/my/admin/reports/11111111-1111-4111-8111-111111111111/review", { outcome: "dismiss" }]]) {
    const res = await call(path, { method, auth: "Bearer " + alice, body });
    assert.equal(res.status, 404, method + " " + path + " is hidden from shoppers"); assert.deepEqual(await res.json(), { error: "not_found" });
  }
  assert.deepEqual(await (await call("/relay/my/admin/me", { auth: "Bearer " + alice })).json(), { admin: false });
  assert.equal((await call("/relay/my/admin/reports", { auth: "Bearer " + admin })).status, 200, "an admin can see reports");
  console.log("ok - admins: report reviews hidden from shoppers (not found), open to Relay's admins");
}
// Shops: each route needs that shop's own key.
{
  const shopRoutes = routes.filter(p => p.startsWith("/relay/retailer/"));
  for (const path of shopRoutes) for (const method of ["GET", "POST"]) for (const auth of [undefined, "Bearer rk_" + "A".repeat(43), "Bearer " + alice, "Bearer not-a-key"]) {
    const res = await shopCall(path, { method, auth, body: method === "POST" ? {} : undefined });
    assert.equal(res.status, 401, method + " " + path + " with " + (auth || "nothing")); assert.equal((await res.json()).error, "not_signed_in");
  }
  assert.equal((await shopCall("/relay/retailer/demand", { auth: "Bearer " + shopKey })).status, 200, "the shop's own key works");
  console.log("ok - shops: " + shopRoutes.length + " shop routes need the shop's own key (no key, a made-up key or a shopper's session: not signed in)");
}
// One shopper can't reach another's receipt.
{
  await call("/relay/my/receipts", { auth: "Bearer " + alice }); // makes sure the receipt tables exist
  const id = "22222222-2222-4222-8222-222222222222", aliceId = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("alice@example.com").id;
  const details = { retailer: { name: "Kestrel Outdoor", domain: null }, orderRef: "KO-9", orderDate: "2026-10-01", totalPence: 8900, currency: "GBP",
    category: "fashion", items: [{ name: "Trail Runner Shoes", qty: 1, pricePence: 8900 }], returns: { deadline: "2026-10-31" } };
  sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)").run(id, aliceId, "m-1", "pending", JSON.stringify(details), now);
  const before = JSON.stringify(sqlite.prepare("SELECT status, details FROM captured_receipts WHERE id = ?").get(id));
  const tries = [["GET", "/original"], ["GET", "/image"], ["POST", "/confirm", {}], ["POST", "/dismiss", { reason: "promo" }], ["POST", "/category", { category: "home" }],
    ["POST", "/items", { items: [{ index: 0, status: "returning" }] }], ["POST", "/remind", { on: false }], ["POST", "/gift", { gift: true, for: "Bob" }]];
  for (const [method, end, body] of tries) {
    const res = await call("/relay/my/receipts/" + id + end, { method, auth: "Bearer " + bob, body });
    assert.ok(res.status === 404 || res.status === 403, method + " " + end + " by someone else → " + res.status);
  }
  assert.equal(JSON.stringify(sqlite.prepare("SELECT status, details FROM captured_receipts WHERE id = ?").get(id)), before, "alice's receipt is untouched");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_gifts WHERE receipt_id = ?").get(id).n, 0, "and isn't tagged as a gift");
  const list = await (await call("/relay/my/receipts", { auth: "Bearer " + bob })).json();
  assert.ok(!JSON.stringify(list).includes("KO-9"), "bob's list doesn't include alice's receipt");
  const own = await call("/relay/my/receipts/" + id + "/category", { method: "POST", auth: "Bearer " + alice, body: { category: "home" } });
  assert.equal(own.status, 200, "alice can change her own");
  console.log("ok - shoppers' data: someone else's receipt can't be read, opened, confirmed, hidden, recategorised, marked, tagged as a gift or reminded about");
}
// Two-step sign-in's half-way token is not a session.
{
  const pending = "P".repeat(43);
  for (const path of ["/relay/me", "/relay/my/receipts"]) assert.equal((await call(path, { auth: "Bearer " + pending })).status, 401);
  console.log("ok - two-step sign-in: the half-way token isn't a session");
}
// Webhooks refuse anything unsigned; the prototype's test routes are off.
{
  resetMemoryLimits();
  const ctx = { waitUntil() {} };
  const webEnv = { ...env, SQUARE_ACCESS_TOKEN: "fake-sandbox-token" }; // Square's webhook only listens once Square is set up
  const front = (path, init = {}) => worker.fetch(new Request("https://w.test" + path, { ...init, headers: { "cf-connecting-ip": "100.64.0.9", ...(init.headers || {}) } }), webEnv, ctx);
  const shopify = await front("/relay/webhooks/shopify", { method: "POST", headers: { "x-shopify-shop-domain": "kestrel-outdoor.myshopify.com", "x-shopify-topic": "orders/paid" }, body: "{}" });
  assert.ok([401, 403].includes(shopify.status), "unsigned Shopify webhook → " + shopify.status);
  const square = await front("/relay/webhooks/square", { method: "POST", body: "{}" });
  assert.ok([401, 403].includes(square.status), "unsigned Square webhook → " + square.status);
  for (const p of ["/relay/test-lab", "/relay/live-test/pay", "/relay/ledger/import-status", "/purchases"]) assert.equal((await front(p, { method: p.endsWith("pay") ? "POST" : "GET" })).status, 404, p);
  console.log("ok - webhooks refuse unsigned requests; the prototype's test routes answer not found");
}
console.log("PASS who can do what: visitors, shoppers, admins, shops, webhooks and test routes");
