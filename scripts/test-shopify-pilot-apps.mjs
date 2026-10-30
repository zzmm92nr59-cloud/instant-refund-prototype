// Offline test: several Shopify apps at once (the main app plus one "custom distribution" app per pilot shop).
// Shopify is a stand-in (fake fetch); nothing leaves this machine.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { handleShopifyConnect, listConnectedShopifyStores, shopifyApps } from "../worker/shopify-connect.js";
import { receiveShopifyWebhook } from "../worker/shopify-webhooks.js";
import { ensurePushTables } from "../worker/push.js";
import { ensureSquareMerchantSchema } from "../worker/square-connect.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; }, _exec() { sqlite.prepare(sql).run(...args); } };
}
const db = { prepare: sql => stmt(sql), async batch(list) { list.forEach(s => s._exec()); return []; } };
await ensureSquareMerchantSchema(db); await ensurePushTables(db);

const MAIN = { id: "main-id", secret: "main-secret" }, PILOT = { id: "pilot-id", secret: "pilot-secret" }, PILOT_SHOP = "kick-lane.myshopify.com";
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789",
  SHOPIFY_CLIENT_ID: MAIN.id, SHOPIFY_CLIENT_SECRET: MAIN.secret,
  SHOPIFY_APP_1_CLIENT_ID: PILOT.id, SHOPIFY_APP_1_CLIENT_SECRET: PILOT.secret, SHOPIFY_APP_1_SHOP: "Kick-Lane",
  SHOPIFY_APP_2_CLIENT_ID: "half-set-up" /* no secret: ignored */ };
let now = 1_800_000_000_000;
const sign = (params, secret) => {
  const msg = [...params.entries()].filter(([k]) => k !== "hmac").sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => k + "=" + v).join("&");
  params.set("hmac", createHmac("sha256", secret).update(msg).digest("hex")); return params;
};
let tokenCalls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
  const m = /^https:\/\/([a-z0-9-]+\.myshopify\.com)\/admin\/(oauth\/access_token|api\/[0-9-]+\/graphql\.json)$/.exec(url);
  if (!m) throw Error("unexpected call " + url);
  const shop = m[1];
  if (m[2] === "oauth/access_token") {
    const b = Object.fromEntries(new URLSearchParams(init.body)); tokenCalls.push({ shop, ...b });
    const ok = (b.client_id === MAIN.id && b.client_secret === MAIN.secret) || (b.client_id === PILOT.id && b.client_secret === PILOT.secret);
    if (!ok) return json({ error: "invalid_client" }, 401);
    if (b.grant_type === "refresh_token") return json({ access_token: "fresh-" + shop, expires_in: 3600, refresh_token: "r2-" + shop, refresh_token_expires_in: 7776000, scope: "read_products" });
    return json({ access_token: "token-" + shop, scope: "read_products,read_inventory,read_orders,write_order_edits", expires_in: 3600, refresh_token: "r-" + shop, refresh_token_expires_in: 7776000 });
  }
  const { query: q } = JSON.parse(init.body);
  if (/shop \{ name currencyCode \}/.test(q)) return json({ data: { shop: { name: shop.split(".")[0], currencyCode: "GBP" } } });
  if (/webhookSubscriptions\(/.test(q)) return json({ data: { webhookSubscriptions: { nodes: [] } } });
  if (/webhookSubscriptionCreate/.test(q)) return json({ data: { webhookSubscriptionCreate: { webhookSubscription: { id: "x" }, userErrors: [] } } });
  return json({ data: {} });
};
const go = (path, e = env) => handleShopifyConnect(new Request("https://w.test" + path), e, new URL("https://w.test" + path), { now });
const stateOf = (res) => new URL(res.headers.get("location")).searchParams.get("state");
const clientOf = (res) => new URL(res.headers.get("location")).searchParams.get("client_id");

// 1. The app list: main app first, the pilot app with its shop tidied up, half-set-up apps left out.
assert.deepEqual(shopifyApps(env).map(a => [a.id, a.shop]), [[MAIN.id, null], [PILOT.id, PILOT_SHOP]]);

// 2. Typing a shop address: the pilot shop is sent to its own app; any other shop to the main app.
let r = await go("/relay/shopify/connect?shop=kick-lane");
assert.equal(r.status, 302); assert.equal(clientOf(r), PILOT.id);
r = await go("/relay/shopify/connect?shop=other-shop");
assert.equal(r.status, 302); assert.equal(clientOf(r), MAIN.id);
// With only pilot apps set up, a shop that has none is told to use its install link, not sent to someone else's app.
const pilotOnly = { ...env, SHOPIFY_CLIENT_ID: "", SHOPIFY_CLIENT_SECRET: "" };
r = await go("/relay/shopify/connect?shop=other-shop", pilotOnly);
assert.equal(r.status, 400); assert.match(await r.text(), /install link/);

// 3. Opening Relay from Shopify admin: the link is accepted when signed by the shop's own app...
const launch = (shop, secret) => go("/relay/shopify/launch?" + sign(new URLSearchParams({ shop, timestamp: String(now / 1000) }), secret));
r = await launch(PILOT_SHOP, PILOT.secret);
assert.equal(r.status, 302); assert.equal(clientOf(r), PILOT.id);
// ...but a pilot app's signature for a different shop, or a stranger's signature, is refused.
assert.equal((await launch("other-shop.myshopify.com", PILOT.secret)).status, 400);
assert.equal((await launch(PILOT_SHOP, "not-ours")).status, 400);

// 4. Approval comes back: the token is asked for with the pilot app's details, and the shop remembers its app.
const callback = (shop, state, secret, code = "c1") => go("/relay/shopify/oauth/callback?" + sign(new URLSearchParams({ shop, code, state, timestamp: String(now / 1000) }), secret));
const pilotState = stateOf(await go("/relay/shopify/connect?shop=kick-lane"));
// A callback signed by the main app can't use a state that was issued for the pilot app.
assert.equal((await callback(PILOT_SHOP, pilotState, MAIN.secret)).status, 400);
assert.equal(tokenCalls.length, 0);
r = await callback(PILOT_SHOP, pilotState, PILOT.secret);
assert.equal(r.status, 200, await r.clone().text());
assert.equal(tokenCalls.at(-1).client_id, PILOT.id);
assert.equal(sqlite.prepare("SELECT client_id FROM shopify_shops WHERE domain = ?").get(PILOT_SHOP).client_id, PILOT.id);
// An ordinary shop goes through the main app.
r = await callback("other-shop.myshopify.com", stateOf(await go("/relay/shopify/connect?shop=other-shop")), MAIN.secret);
assert.equal(r.status, 200);
assert.equal(sqlite.prepare("SELECT client_id FROM shopify_shops WHERE domain = ?").get("other-shop.myshopify.com").client_id, MAIN.id);

// 5. Tokens are renewed with the app each shop approved, and each shop's webhook secret is its app's secret.
now += 3600 * 1000; tokenCalls = [];
const stores = await listConnectedShopifyStores(env, { now });
assert.deepEqual(tokenCalls.map(c => [c.shop, c.client_id, c.grant_type]).sort(),
  [["kick-lane.myshopify.com", PILOT.id, "refresh_token"], ["other-shop.myshopify.com", MAIN.id, "refresh_token"]]);
assert.equal(stores.find(s => s.domain === PILOT_SHOP).webhookSecret, PILOT.secret);
assert.equal(stores.find(s => s.domain === PILOT_SHOP).token, "fresh-" + PILOT_SHOP);
// A shop connected before this change (no app recorded) keeps renewing through the main app.
sqlite.prepare("UPDATE shopify_shops SET client_id = NULL, expires_at = ? WHERE domain = 'other-shop.myshopify.com'").run(now);
tokenCalls = [];
await listConnectedShopifyStores(env, { now });
assert.equal(tokenCalls.find(c => c.shop === "other-shop.myshopify.com").client_id, MAIN.id);

// 6. Webhooks: signed by the pilot app → accepted; signed by anyone else → refused.
const hook = (secret, id) => {
  const body = JSON.stringify({ id: 1 });
  const h = createHmac("sha256", secret).update(body).digest("base64");
  return receiveShopifyWebhook(new Request("https://w.test/relay/webhooks/shopify", { method: "POST", body,
    headers: { "x-shopify-shop-domain": PILOT_SHOP, "x-shopify-topic": "customers/data_request", "x-shopify-webhook-id": id, "x-shopify-hmac-sha256": h } }), env);
};
assert.equal((await hook(PILOT.secret, "d1")).status, 200);
assert.equal((await hook("not-ours", "d2")).status, 401);

console.log("shopify pilot apps: all checks passed");
