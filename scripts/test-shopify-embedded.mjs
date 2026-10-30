// Offline test: Relay inside Shopify admin. Shopify's ID tokens are made here with the app's secret; Shopify's token
// exchange and Admin API are stand-ins. Nothing leaves this machine.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { handleShopifyEmbedded, verifyIdToken } from "../worker/shopify-embedded.js";
import { handleRetailerRoute } from "../worker/retailer.js";
import { ensurePushTables } from "../worker/push.js";
import { ensureSquareMerchantSchema } from "../worker/square-connect.js";
import { hasAllScopes } from "../worker/shopify-connect.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; }, _exec() { sqlite.prepare(sql).run(...args); } };
}
const db = { prepare: sql => stmt(sql), async batch(list) { list.forEach(s => s._exec()); return []; } };
await ensureSquareMerchantSchema(db); await ensurePushTables(db);

const MAIN = { id: "main-id", secret: "main-secret" }, PILOT = { id: "pilot-id", secret: "pilot-secret" };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", SHOPIFY_CLIENT_ID: MAIN.id, SHOPIFY_CLIENT_SECRET: MAIN.secret,
  SHOPIFY_APP_1_CLIENT_ID: PILOT.id, SHOPIFY_APP_1_CLIENT_SECRET: PILOT.secret, SHOPIFY_APP_1_SHOP: "kick-lane.myshopify.com" };
let now = 1_800_000_000_000;
const t = () => Math.floor(now / 1000);
const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function idToken(shop, app, over = {}, header = { alg: "HS256", typ: "JWT" }) {
  const body = { iss: "https://" + shop + "/admin", dest: "https://" + shop, aud: app.id, sub: "42", exp: t() + 60, nbf: t() - 5, iat: t() - 5, jti: "j", sid: "s", ...over };
  const h = b64u(header), p = b64u(body);
  return h + "." + p + "." + createHmac("sha256", over.__secret || app.secret).update(h + "." + p).digest("base64url");
}

// 1. ID token checks.
assert.equal((await verifyIdToken(env, idToken("oak-thread.myshopify.com", MAIN), now)).shop, "oak-thread.myshopify.com");
assert.equal((await verifyIdToken(env, idToken("kick-lane.myshopify.com", PILOT), now)).app.id, PILOT.id);
for (const [why, tok] of [
  ["signed with someone else's secret", idToken("oak-thread.myshopify.com", MAIN, { __secret: "not-ours" })],
  ["expired", idToken("oak-thread.myshopify.com", MAIN, { exp: t() - 60 })],
  ["not valid yet", idToken("oak-thread.myshopify.com", MAIN, { nbf: t() + 120 })],
  ["issuer and destination disagree", idToken("oak-thread.myshopify.com", MAIN, { iss: "https://evil.myshopify.com/admin" })],
  ["destination isn't a shop", idToken("oak-thread.myshopify.com", MAIN, { dest: "https://evil.example", iss: "https://evil.example/admin" })],
  ["for an app Relay doesn't have", idToken("oak-thread.myshopify.com", { id: "stranger", secret: "s" })],
  ["pilot app used for another shop", idToken("oak-thread.myshopify.com", PILOT)],
  ["unsigned (alg none)", idToken("oak-thread.myshopify.com", MAIN, {}, { alg: "none" })],
  ["garbage", "a.b.c"]]) assert.equal(await verifyIdToken(env, tok, now), null, why);

// 2. Signing in from inside Shopify admin.
let calls = [], currency = {}, exchangeFails = false, granted = "read_products,read_inventory,write_orders,write_order_edits";
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url === "https://dash.test/retailer.html") return new Response(readFileSync("retailer.html", "utf8"));
  const m = /^https:\/\/([a-z0-9-]+\.myshopify\.com)\/admin\/(oauth\/access_token|api\/[0-9-]+\/graphql\.json)$/.exec(url);
  if (!m) throw Error("unexpected call " + url);
  const shop = m[1];
  if (m[2] === "oauth/access_token") {
    const b = Object.fromEntries(new URLSearchParams(init.body)); calls.push({ shop, ...b });
    if (b.grant_type === "refresh_token") return Response.json({ access_token: "fresh-" + shop, expires_in: 86400, refresh_token: "r2", refresh_token_expires_in: 7776000, scope: "read_products" });
    if (exchangeFails) return Response.json({ error: "invalid_subject_token" }, { status: 400 });
    return Response.json({ access_token: "tok-" + shop, scope: granted, expires_in: 86400, refresh_token: "r-" + shop, refresh_token_expires_in: 7776000 });
  }
  const q = JSON.parse(init.body).query;
  calls.push({ shop, graphql: q });
  if (/shop \{ name currencyCode \}/.test(q)) return Response.json({ data: { shop: { name: shop.split(".")[0] === "kick-lane" ? "Kick Lane" : "Oak & Thread", currencyCode: currency[shop] || "GBP" } } });
  if (/webhookSubscriptions\(/.test(q)) return Response.json({ data: { webhookSubscriptions: { nodes: [] } } });
  if (/webhookSubscriptionCreate/.test(q)) return Response.json({ data: { webhookSubscriptionCreate: { webhookSubscription: { id: "x" }, userErrors: [] } } });
  return Response.json({ data: {} });
};
let connected = [];
const o = { fetchImpl, dashboardUrl: "https://dash.test/retailer.html", afterConnect: (s) => connected.push(s) };
const session = async (tok) => {
  const url = new URL("https://w.test/relay/shopify/embedded/session");
  const res = await handleShopifyEmbedded(new Request(url, { method: "POST", headers: tok ? { Authorization: "Bearer " + tok } : {} }), env, url, { ...o, now });
  return { status: res.status, headers: res.headers, body: await res.json() };
};

// First open from Kick Lane's admin: the ID token is swapped for the shop's keys through its own pilot app.
let r = await session(idToken("kick-lane.myshopify.com", PILOT));
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.store, "Kick Lane"); assert.equal(r.body.connectedNow, true); assert.match(r.body.key, /^rk_/);
const ex = calls.find(c => c.grant_type);
assert.deepEqual([ex.shop, ex.client_id, ex.client_secret, ex.grant_type, ex.subject_token_type, ex.requested_token_type, ex.expiring],
  ["kick-lane.myshopify.com", PILOT.id, PILOT.secret, "urn:ietf:params:oauth:grant-type:token-exchange", "urn:ietf:params:oauth:token-type:id_token",
   "urn:shopify:params:oauth:token-type:offline-access-token", "1"]);
assert.equal(sqlite.prepare("SELECT client_id FROM shopify_shops WHERE domain = 'kick-lane.myshopify.com'").get().client_id, PILOT.id);
assert.ok(calls.some(c => c.graphql && /webhookSubscriptionCreate/.test(c.graphql)), "webhooks requested");
assert.deepEqual(connected, ["kick-lane.myshopify.com"]);
// The key it hands out opens that shop's dashboard (and only that shop's).
const dash = async (key) => { const u = new URL("https://w.test/relay/retailer/demand"); const res = await handleRetailerRoute(new Request(u, { headers: { Authorization: "Bearer " + key } }), env, u, {}, { now }); return { status: res.status, body: await res.json() }; };
const d = await dash(r.body.key);
assert.equal(d.status, 200); assert.equal(d.body.store, "Kick Lane"); assert.equal(d.body.platform, "shopify");

// Opening it again: already connected, so no new exchange and no new webhooks.
calls = []; connected = [];
r = await session(idToken("kick-lane.myshopify.com", PILOT));
assert.equal(r.status, 200); assert.equal(r.body.connectedNow, false);
assert.equal(calls.filter(c => c.grant_type).length, 0); assert.deepEqual(connected, []);

// Relay asks for a new permission (as when refunds were added): keys saved before that don't cover it, so the next open
// fetches them again and sets up the notifications Relay doesn't have yet. Then it's back to no exchange.
sqlite.prepare("UPDATE shopify_shops SET scopes = ? WHERE domain = 'kick-lane.myshopify.com'").run("read_products,read_inventory,read_orders,write_order_edits");
calls = []; connected = [];
r = await session(idToken("kick-lane.myshopify.com", PILOT));
assert.equal(r.status, 200); assert.equal(r.body.store, "Kick Lane");
assert.equal(calls.filter(c => c.grant_type).length, 1, "keys fetched again");
assert.ok(calls.some(c => c.graphql && /webhookSubscriptionCreate/.test(c.graphql)), "missing notifications set up");
assert.equal(sqlite.prepare("SELECT scopes FROM shopify_shops WHERE domain = 'kick-lane.myshopify.com'").get().scopes, granted);
calls = [];
r = await session(idToken("kick-lane.myshopify.com", PILOT));
assert.equal(r.body.connectedNow, false); assert.equal(calls.filter(c => c.grant_type).length, 0);
// The shop hasn't approved the new permission yet: Relay still opens with what it has (and asks Shopify again next time).
granted = "read_products,read_inventory,read_orders,write_order_edits";
sqlite.prepare("UPDATE shopify_shops SET scopes = ? WHERE domain = 'kick-lane.myshopify.com'").run(granted);
r = await session(idToken("kick-lane.myshopify.com", PILOT));
assert.equal(r.status, 200); assert.equal(r.body.store, "Kick Lane");
granted = "read_products,read_inventory,write_orders,write_order_edits";
// "write_" covers "read_"; anything less doesn't.
assert.equal(hasAllScopes("read_products,read_inventory,write_orders,write_order_edits"), true);
assert.equal(hasAllScopes("read_products,read_inventory,read_orders,write_orders,write_order_edits"), true);
assert.equal(hasAllScopes("read_products,read_inventory,read_orders,write_order_edits"), false);
assert.equal(hasAllScopes(""), false); assert.equal(hasAllScopes(null), false);

// A shop that sells in dollars is turned away and nothing is stored.
currency["us-shop.myshopify.com"] = "USD";
r = await session(idToken("us-shop.myshopify.com", MAIN));
assert.equal(r.status, 403); assert.equal(r.body.error, "not_gbp"); assert.equal(r.body.currency, "USD");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shopify_shops WHERE domain = 'us-shop.myshopify.com'").get().n, 0);

// Bad or missing token, or Shopify refusing the exchange: 401 with the header that makes App Bridge retry once.
for (const tok of [null, idToken("oak-thread.myshopify.com", MAIN, { exp: t() - 60 })]) {
  r = await session(tok); assert.equal(r.status, 401); assert.equal(r.headers.get("X-Shopify-Retry-Invalid-Session-Request"), "1");
}
exchangeFails = true;
r = await session(idToken("oak-thread.myshopify.com", MAIN));
assert.equal(r.status, 401); assert.equal(r.headers.get("X-Shopify-Retry-Invalid-Session-Request"), "1");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shopify_shops WHERE domain = 'oak-thread.myshopify.com'").get().n, 0);
exchangeFails = false;

// 3. The framed page: the normal dashboard with App Bridge added for the right app, framable only by that shop's admin.
const page = async (shop) => {
  const url = new URL("https://w.test/relay/shopify/app?shop=" + encodeURIComponent(shop) + "&host=abc&embedded=1");
  const res = await handleShopifyEmbedded(new Request(url), env, url, o);
  return { status: res.status, headers: res.headers, text: await res.text() };
};
let p = await page("kick-lane.myshopify.com");
assert.equal(p.status, 200);
assert.equal(p.headers.get("content-security-policy"), "frame-ancestors https://kick-lane.myshopify.com https://admin.shopify.com;");
assert.match(p.text, /<meta name="shopify-api-key" content="pilot-id">/);
assert.ok(p.text.indexOf("cdn.shopify.com/shopifycloud/app-bridge.js") < p.text.indexOf("const API ="), "App Bridge loads before the dashboard script");
assert.match(p.text, /window\.RELAY_EMBEDDED=\{shop:"kick-lane\.myshopify\.com"\}/);
p = await page("oak-thread.myshopify.com");
assert.match(p.text, /<meta name="shopify-api-key" content="main-id">/);
assert.equal((await page("evil.com")).status, 400);
assert.equal((await page("<script>.myshopify.com")).status, 400);

console.log("shopify embedded: all checks passed");
