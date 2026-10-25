// Offline test for "Connect with Shopify". Shopify itself is a stand-in (fake fetch); nothing leaves this machine.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { handleShopifyConnect, listConnectedShopifyStores, syncAllShopify, shopifyShopsForDisplay, normaliseShop, shopifySigned } from "../worker/shopify-connect.js";
import { handleRetailerRoute } from "../worker/retailer.js";
import { receiveShopifyWebhook } from "../worker/shopify-webhooks.js";
import { ensurePushTables, priceText } from "../worker/push.js";
import { ensureSquareMerchantSchema } from "../worker/square-connect.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; }, _exec() { sqlite.prepare(sql).run(...args); } };
}
const db = { prepare: sql => stmt(sql), async batch(list) { list.forEach(s => s._exec()); return []; } };
const SECRET = "shopify-app-secret";
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", SHOPIFY_CLIENT_ID: "client-id-1", SHOPIFY_CLIENT_SECRET: SECRET,
  // A shop already set up the old way (server settings). Once it connects itself, it must not be read twice.
  SHOPIFY_SHOP_DOMAIN: "oak-thread.myshopify.com", SHOPIFY_ADMIN_ACCESS_TOKEN: "old-static-token" };
await ensureSquareMerchantSchema(db); await ensurePushTables(db);

let now = 1_800_000_000_000;
const sign = (params) => {
  const msg = [...params.entries()].filter(([k]) => k !== "hmac").sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => k + "=" + v).join("&");
  params.set("hmac", createHmac("sha256", SECRET).update(msg).digest("hex")); return params;
};
const shops = {
  "oak-thread.myshopify.com": { name: "Oak & Thread", products: [
    { id: "gid://shopify/Product/1", title: "Linen Cushion", img: "https://cdn.shopify.com/s/files/cushion.png", variants: [{ id: "gid://shopify/ProductVariant/11", title: "Sage", sku: "CUSH-SAGE", price: "24.00", qty: 6 }] },
    { id: "gid://shopify/Product/2", title: "Stoneware Mug", img: null, variants: [{ id: "gid://shopify/ProductVariant/21", title: "Default Title", sku: "", price: "12.50", qty: 30 }] }] },
  "volt-tech.myshopify.com": { name: "Volt Tech", products: [
    { id: "gid://shopify/Product/1", title: "USB-C Charger", img: "https://cdn.shopify.com/s/files/charger.png", variants: [{ id: "gid://shopify/ProductVariant/11", title: "65W", sku: "CUSH-SAGE", price: "39.99", qty: 3 }] }] }
};
let currencies = { "volt-tech.myshopify.com": "USD" }, hooks = {}, lastProductQuery = "";
let tokenCalls = [], apiCalls = [], codeToShop = { "code-oak": "oak-thread.myshopify.com", "code-volt": "volt-tech.myshopify.com" }, grantScope = "read_products,read_inventory";
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
  const m = /^https:\/\/([a-z0-9-]+\.myshopify\.com)\/admin\/(oauth\/access_token|api\/[0-9-]+\/graphql\.json)$/.exec(url);
  if (!m) throw Error("unexpected call " + url);
  const shop = m[1];
  if (m[2] === "oauth/access_token") {
    const b = Object.fromEntries(new URLSearchParams(init.body));
    tokenCalls.push({ shop, ...b });
    assert.equal(b.client_secret, SECRET); assert.equal(b.client_id, "client-id-1");
    if (b.grant_type === "refresh_token") return b.refresh_token === "refresh-" + shop ? json({ access_token: "fresh-" + shop, expires_in: 3600, refresh_token: "refresh-" + shop, refresh_token_expires_in: 7776000, scope: grantScope }) : json({ error: "invalid" }, 400);
    if (codeToShop[b.code] !== shop) return json({ error: "invalid_request" }, 400);
    assert.equal(b.expiring, "1");
    return json({ access_token: "token-" + shop, scope: grantScope, expires_in: 3600, refresh_token: "refresh-" + shop, refresh_token_expires_in: 7776000 });
  }
  const token = init.headers["X-Shopify-Access-Token"];
  apiCalls.push({ shop, token });
  if (!/^(token|fresh)-/.test(token) && token !== "old-static-token") return json({ errors: "unauthorised" }, 401);
  const { query: q, variables } = JSON.parse(init.body);
  if (/shop \{ name currencyCode \}/.test(q)) return json({ data: { shop: { name: shops[shop].name, currencyCode: currencies[shop] || "GBP" } } });
  if (/webhookSubscriptions\(/.test(q)) return json({ data: { webhookSubscriptions: { nodes: (hooks[shop] || []).map((h, i) => ({ id: "gid://shopify/WebhookSubscription/" + i, ...h })) } } });
  if (/webhookSubscriptionCreate/.test(q)) {
    (hooks[shop] = hooks[shop] || []).push({ topic: variables.topic, uri: variables.sub.uri });
    return json({ data: { webhookSubscriptionCreate: { webhookSubscription: { id: "gid://shopify/WebhookSubscription/x" }, userErrors: [] } } });
  }
  lastProductQuery = q;
  return json({ data: { shop: { currencyCode: currencies[shop] || "GBP" }, products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: shops[shop].products.map(p => ({
    id: p.id, title: p.title, description: "", featuredMedia: p.img ? { preview: { image: { url: p.img } } } : null,
    variants: { nodes: p.variants.map(v => ({ id: v.id, title: v.title, sku: v.sku, price: v.price, inventoryQuantity: v.qty })) } })) } } });
};
const go = (path, o = {}) => handleShopifyConnect(new Request("https://w.test" + path), env, new URL("https://w.test" + path), { now, ...o });

// 1. Shop addresses: what a person types is tidied up; anything else is refused.
assert.equal(normaliseShop("Oak-Thread"), "oak-thread.myshopify.com");
assert.equal(normaliseShop("https://oak-thread.myshopify.com/admin/products"), "oak-thread.myshopify.com");
assert.equal(normaliseShop("admin.shopify.com/store/oak-thread"), "oak-thread.myshopify.com");
for (const bad of ["", "oak-thread.com", "evil.com/oak-thread.myshopify.com", "oak_thread.myshopify.com", "oak-thread.myshopify.com.evil.com"]) assert.equal(normaliseShop(bad), null, bad);
assert.equal((await go("/relay/shopify/connect")).status, 200, "no shop yet: friendly form");
assert.equal((await go("/relay/shopify/connect?shop=not%20a%20shop")).status, 400);

// 2. Connect sends the owner to their own Shopify admin, read-only, with a signed state.
const r1 = await go("/relay/shopify/connect?shop=oak-thread");
assert.equal(r1.status, 302);
const to = new URL(r1.headers.get("location"));
assert.equal(to.origin + to.pathname, "https://oak-thread.myshopify.com/admin/oauth/authorize");
assert.equal(to.searchParams.get("client_id"), "client-id-1");
assert.equal(to.searchParams.get("scope"), "read_products,read_inventory");
assert.equal(to.searchParams.get("redirect_uri"), "https://w.test/relay/shopify/oauth/callback");
const state = to.searchParams.get("state");
const cb = (params) => go("/relay/shopify/oauth/callback?" + params.toString());
const good = () => sign(new URLSearchParams({ code: "code-oak", host: "b2FrLXRocmVhZA", shop: "oak-thread.myshopify.com", state, timestamp: String(now / 1000) }));

// 3. Anything not signed by Shopify, an altered state, a state for another shop, or a refusal connects nothing.
const unsigned = good(); unsigned.set("hmac", "0".repeat(64));
const tampered = good(); tampered.set("code", "code-volt");                       // changed after Shopify signed it
const wrongShop = sign(new URLSearchParams({ code: "code-volt", shop: "volt-tech.myshopify.com", state, timestamp: String(now / 1000) }));
const badState = sign(new URLSearchParams({ code: "code-oak", shop: "oak-thread.myshopify.com", state: state.slice(0, -3) + "abc", timestamp: String(now / 1000) }));
for (const p of [unsigned, tampered, wrongShop, badState, new URLSearchParams({ error: "access_denied" })]) assert.equal((await cb(p)).status, 400, p.toString());
const late = await go("/relay/shopify/oauth/callback?" + good().toString(), { now: now + 3600_000 });
assert.equal(late.status, 400, "an old approval link is refused");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM shopify_shops").get().n, 0);
assert.equal(tokenCalls.length, 0, "nothing is exchanged with Shopify before the checks pass");
assert.equal(await shopifySigned(new URLSearchParams({ shop: "x.myshopify.com", hmac: "zz" }), SECRET), false);

// 4. A good approval stores the shop (tokens encrypted), reads only that shop, and hands back a private dashboard link.
let synced = null;
const ok = await cb(good());
assert.equal(ok.status, 200);
const okPage = await ok.text();
assert.match(okPage, /Oak &amp; Thread is connected to Relay/);
const key = /retailer\.html#key=(rk_[A-Za-z0-9_-]{43})/.exec(okPage)[1];
// Shopify is asked to send change notices (products added, changed, removed; app removed) to Relay, once each.
assert.deepEqual(hooks["oak-thread.myshopify.com"].map(h => h.topic).sort(), ["APP_UNINSTALLED", "PRODUCTS_CREATE", "PRODUCTS_DELETE", "PRODUCTS_UPDATE"]);
assert.ok(hooks["oak-thread.myshopify.com"].every(h => h.uri === "https://w.test/relay/webhooks/shopify"));
const row = sqlite.prepare("SELECT * FROM shopify_shops").get();
assert.equal(row.domain, "oak-thread.myshopify.com"); assert.equal(row.label, "Oak & Thread");
assert.ok(!JSON.stringify(row).includes("token-oak") && !JSON.stringify(row).includes("refresh-oak"), "tokens are never stored readable");
assert.equal(sqlite.prepare("SELECT provider, shop_ref, store_label FROM retailer_keys").get().provider, "shopify");

// 5. Sync: the connected shop's own token is used (not the old server setting), each item carries the shop name and picture.
apiCalls = [];
const res = await syncAllShopify(env, { now });
assert.equal(res.configuredStores, 1, "the same shop is never read twice");
assert.ok(apiCalls.every(c => c.token === "token-oak-thread.myshopify.com"));
assert.match(lastProductQuery, /status:active/, "only products the shop has set to Active are read");
const items = sqlite.prepare("SELECT title, store_label, image_url FROM retailer_catalog_items WHERE provider LIKE 'shopify:%' ORDER BY title").all();
assert.deepEqual(items.map(i => [i.title, i.store_label, i.image_url]), [["Linen Cushion", "Oak & Thread", "https://cdn.shopify.com/s/files/cushion.png"], ["Stoneware Mug", "Oak & Thread", null]]);
assert.deepEqual((await shopifyShopsForDisplay(env)).map(s => [s.domain, s.label]), [["oak-thread.myshopify.com", "Oak & Thread"]]);

// 6. A second shop, started from its own Shopify admin (Shopify signs the link), goes straight to its dashboard.
const launch = sign(new URLSearchParams({ embedded: "0", host: "dm9sdA", shop: "volt-tech.myshopify.com", timestamp: String(now / 1000) }));
const l1 = await go("/relay/shopify/launch?" + launch.toString());
assert.equal(l1.status, 302);
const voltState = new URL(l1.headers.get("location")).searchParams.get("state");
const stale = sign(new URLSearchParams({ shop: "volt-tech.myshopify.com", timestamp: String(now / 1000 - 3600) }));
assert.equal((await go("/relay/shopify/launch?" + stale.toString())).status, 400, "an old admin link is refused");
const forged = new URLSearchParams(launch); forged.set("shop", "oak-thread.myshopify.com");
assert.equal((await go("/relay/shopify/launch?" + forged.toString())).status, 400, "changing the shop breaks Shopify's signature");
// Volt Tech sells in dollars: Relay is for UK shops selling in pounds, so it is turned away and nothing is kept.
const usd = await cb(sign(new URLSearchParams({ code: "code-volt", shop: "volt-tech.myshopify.com", state: voltState, timestamp: String(now / 1000) })));
assert.equal(usd.status, 400);
assert.match(await usd.text(), /UK shops that sell in pounds/);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM shopify_shops WHERE domain = 'volt-tech.myshopify.com'").get().n, 0);
assert.equal(hooks["volt-tech.myshopify.com"], undefined, "no change notices are set up for a shop that wasn't connected");
// Once it switches to pounds it can connect.
currencies["volt-tech.myshopify.com"] = "GBP";
const l2 = await go("/relay/shopify/launch?" + sign(new URLSearchParams({ embedded: "0", host: "dm9sdA", shop: "volt-tech.myshopify.com", timestamp: String(now / 1000) })).toString());
const voltState2 = new URL(l2.headers.get("location")).searchParams.get("state");
const v = await cb(sign(new URLSearchParams({ code: "code-volt", shop: "volt-tech.myshopify.com", state: voltState2, timestamp: String(now / 1000) })));
assert.equal(v.status, 302);
assert.match(v.headers.get("location"), /\/retailer\.html#key=rk_/);
await syncAllShopify(env, { now });
// Identical Shopify ids and SKUs in two shops never collide.
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM retailer_catalog_variants WHERE id LIKE 'shopify:%'").get().n, 3);

// 7. Tokens are renewed shortly before they run out; a shop whose renewal fails and whose token has expired is skipped, not fatal.
tokenCalls = [];
const later = now + 3600_000 - 60_000;
const stores = await listConnectedShopifyStores(env, { now: later });
assert.deepEqual(stores.map(s => s.token), ["fresh-oak-thread.myshopify.com", "fresh-volt-tech.myshopify.com"]);
assert.equal(tokenCalls.filter(c => c.grant_type === "refresh_token").length, 2);
sqlite.prepare("UPDATE shopify_shops SET refresh_data = (SELECT access_data FROM shopify_shops WHERE domain = 'oak-thread.myshopify.com') WHERE domain = 'volt-tech.myshopify.com'").run();
const muchLater = later + 3600_000 + 60_000;
const after = await listConnectedShopifyStores(env, { now: muchLater });
assert.deepEqual(after.map(s => s.domain), ["oak-thread.myshopify.com"], "volt's renewal fails (wrong refresh token) and its token has expired");

// 8. The shop dashboard: watchers of Shopify items (keyed by Relay's variant id) and offers.
const variantId = sqlite.prepare("SELECT v.id FROM retailer_catalog_variants v JOIN retailer_catalog_items i ON i.id = v.item_id WHERE i.title = 'Linen Cushion'").get().id;
assert.match(variantId, /^shopify:oak-thread\.myshopify\.com:variant:gid:\/\/shopify\/ProductVariant\/11$/);
sqlite.prepare("INSERT INTO price_watches (shopper_id, sku, product, variant, store, via, baseline_minor, last_seen_minor, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
  .run("alice-id", variantId, "Linen Cushion", "Sage", "Oak & Thread", "item", 2400, 2400, now);
const call = (path, method = "GET", body) => handleRetailerRoute(new Request("https://w.test" + path, { method, headers: { authorization: "Bearer " + key, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }),
  env, new URL("https://w.test" + path), {}, { now, fetchImpl: async () => new Response("", { status: 201 }) });
const d = await (await call("/relay/retailer/demand")).json();
assert.equal(d.store, "Oak & Thread"); assert.equal(d.platform, "shopify");
assert.deepEqual(d.watchedItems.map(i => [i.sku, i.retailerSku, i.watchers, i.watchersText, i.imageUrl]), [[variantId, "CUSH-SAGE", null, "Fewer than 3", "https://cdn.shopify.com/s/files/cushion.png"]]);
assert.ok(!JSON.stringify(d).includes("alice"));
assert.equal((await call("/relay/retailer/offers", "POST", { sku: variantId, offerMinor: 1999, hours: 24 })).status, 200, "offer on its own Shopify item");
const voltVariant = sqlite.prepare("SELECT v.id FROM retailer_catalog_variants v WHERE v.id LIKE 'shopify:volt-tech%'").get().id;
assert.equal((await call("/relay/retailer/offers", "POST", { sku: voltVariant, offerMinor: 100 })).status, 404, "never on another shop's item");

// 8b. Prices are written in pounds; anything else is never shown as pounds.
assert.equal(priceText(1299, "GBP"), "£12.99");
assert.equal(priceText(1299, "USD"), "US$12.99");
assert.equal(priceText(1299, null), "£12.99");
assert.equal(d.currency, "GBP");

// 8c. Change notices from Shopify, each checked against Shopify's signature.
const hook = async (shop, topic, payload, secret = SECRET, o = {}) => {
  const body = JSON.stringify(payload);
  return receiveShopifyWebhook(new Request("https://w.test/relay/webhooks/shopify", { method: "POST", body, headers: { "x-shopify-shop-domain": shop, "x-shopify-topic": topic,
    "x-shopify-webhook-id": "wh-" + Math.random(), "x-shopify-hmac-sha256": createHmac("sha256", secret).update(body).digest("base64") } }), env, o);
};
let changed = [];
assert.equal((await hook("oak-thread.myshopify.com", "products/update", { id: 1 }, "wrong-secret", { onCatalogueChange: s => changed.push(s) })).status, 401, "a notice not signed by Shopify is refused");
assert.equal(changed.length, 0);
assert.equal((await hook("oak-thread.myshopify.com", "products/update", { id: 1 }, SECRET, { onCatalogueChange: s => changed.push(s) })).status, 200);
assert.deepEqual(changed, ["oak-thread.myshopify.com"], "a product change makes Relay read that shop again straight away");
// A deleted product disappears at once.
assert.equal((await (await hook("oak-thread.myshopify.com", "products/delete", { id: 2 })).json()).removed, 1);
assert.deepEqual(sqlite.prepare("SELECT title FROM retailer_catalog_items WHERE provider = 'shopify:oak-thread.myshopify.com' ORDER BY title").all().map(r => r.title), ["Linen Cushion"]);
// Privacy requests are answered.
for (const t of ["customers/data_request", "customers/redact"]) assert.equal((await hook("oak-thread.myshopify.com", t, { customer: { id: 5 } })).status, 200, t);
// Removing the app: Volt's tokens, dashboard keys and products are deleted and it no longer shows to shoppers.
assert.equal((await hook("volt-tech.myshopify.com", "app/uninstalled", { id: 9 })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM shopify_shops WHERE domain = 'volt-tech.myshopify.com'").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM retailer_keys WHERE shop_ref = 'volt-tech.myshopify.com'").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM retailer_catalog_items WHERE provider = 'shopify:volt-tech.myshopify.com'").get().n, 0);
assert.ok(!(await shopifyShopsForDisplay(env)).some(x => x.domain === "volt-tech.myshopify.com"));
assert.equal((await hook("volt-tech.myshopify.com", "shop/redact", { shop_id: 9 })).status, 200);
// A product the shop deleted while Relay wasn't told is still removed at the next full read.
shops["oak-thread.myshopify.com"].products = shops["oak-thread.myshopify.com"].products.filter(p => p.title !== "Linen Cushion" && p.title !== "Stoneware Mug").concat([{ id: "gid://shopify/Product/3", title: "Wool Throw", img: null, variants: [{ id: "gid://shopify/ProductVariant/31", title: "Oat", sku: "THR", price: "45.00", qty: 2 }] }]);
await syncAllShopify(env, { now });
assert.deepEqual(sqlite.prepare("SELECT title FROM retailer_catalog_items WHERE provider = 'shopify:oak-thread.myshopify.com' ORDER BY title").all().map(r => r.title), ["Wool Throw"]);

// 9. Without the app's details on the server, nothing can connect, and says so.
const bare = { ...env, SHOPIFY_CLIENT_SECRET: undefined };
assert.equal((await handleShopifyConnect(new Request("https://w.test/x"), bare, new URL("https://w.test/relay/shopify/connect?shop=oak-thread"), { now })).status, 503);
console.log("shopify-connect: all checks passed");
