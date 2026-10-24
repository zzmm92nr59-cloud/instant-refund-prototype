// Offline test for "Connect with Square". Square itself is a stand-in (fake fetch); nothing leaves this machine.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleSquareConnect, listSquareAccounts } from "../worker/square-connect.js";
import { syncSquareCatalogue } from "../worker/square-catalogue.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; } };
}
const db = { prepare: sql => stmt(sql) };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", SQUARE_ACCESS_TOKEN: "default-token", SQUARE_APPLICATION_SECRET: "app-secret" };
const shops = {
  "default-token": { loc: "LDEF", items: [{ id: "ITD", name: "Demo Tee", var: "VD1", sku: "DEMO-TEE", price: 2500 }] },
  "northco-token": { loc: "LNORTH", items: [{ id: "ITN", name: "Oversized Shirt", var: "VN1", sku: "OVER-NAV-M", price: 12999 }] },
  "broken-token": null,
};
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url); calls.push(url);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
  if (url.endsWith("/oauth2/token")) {
    const b = JSON.parse(init.body);
    assert.equal(b.client_secret, "app-secret");
    if (b.code === "good") return json({ access_token: "northco-token", refresh_token: "r1", merchant_id: "MNORTH123", expires_at: "2030-01-01T00:00:00Z" });
    return json({ errors: [{ code: "INVALID_REQUEST_ERROR" }] }, 400);
  }
  if (url.endsWith("/v2/merchants/me")) return json({ merchant: { id: globalThis.__defaultMerchant || "MDEFAULT1" } });
  if (url.includes("/v2/merchants/")) return json({ merchant: { business_name: "North & Co." } });
  const token = String(init.headers?.Authorization || "").replace("Bearer ", ""), shop = shops[token];
  if (shop === null) return json({ errors: [{ code: "UNAUTHORIZED" }] }, 401);
  if (!shop) throw Error("unexpected token " + token);
  if (url.endsWith("/v2/locations")) return json({ locations: [{ id: shop.loc, status: "ACTIVE", name: "Main" }] });
  if (url.includes("/v2/catalog/list")) return json({ objects: shop.items.map(i => ({ type: "ITEM", id: i.id, item_data: { name: i.name, variations: [{ id: i.var, item_variation_data: { name: "Reg", sku: i.sku, price_money: { amount: i.price, currency: "GBP" } } }] } })) });
  if (url.endsWith("/inventory/counts/batch-retrieve")) return json({ counts: JSON.parse(init.body).catalog_object_ids.map(id => ({ catalog_object_id: id, location_id: shop.loc, quantity: "4", state: "IN_STOCK" })) });
  throw Error("unexpected call " + url);
};
const now = 1_800_000_000_000;
const go = (path) => handleSquareConnect(new Request("https://w.test" + path), env, new URL("https://w.test" + path), { now });

// 1. Connect sends the shop to Square with read-only permissions and a signed state.
const r1 = await go("/relay/square/connect");
assert.equal(r1.status, 302);
const to = new URL(r1.headers.get("location"));
assert.equal(to.hostname, "connect.squareupsandbox.com");
assert.equal(to.searchParams.get("scope"), "ITEMS_READ INVENTORY_READ MERCHANT_PROFILE_READ");
const state = to.searchParams.get("state");

// 2. Bad or tampered state, or a missing approval, connects nothing.
for (const q of ["code=good&state=nope", "code=good&state=" + state.slice(0, -2) + "xx", "state=" + state, "error=access_denied&state=" + state]) {
  assert.ok((await go("/relay/square/oauth/callback?" + q)).status >= 400, q);
}
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM square_merchants").get().n, 0);
// An expired state is refused.
const late = await handleSquareConnect(new Request("https://w.test/x"), env, new URL("https://w.test/relay/square/oauth/callback?code=good&state=" + state), { now: now + 3600_000 });
assert.equal(late.status, 400);

// 3. A good approval stores the shop, with the token encrypted.
const ok = await go("/relay/square/oauth/callback?code=good&state=" + state);
assert.equal(ok.status, 200);
assert.match(await ok.text(), /North &amp; Co\./);
const row = sqlite.prepare("SELECT * FROM square_merchants").get();
assert.equal(row.label, "North & Co.");
assert.ok(!JSON.stringify(row).includes("northco-token") && !JSON.stringify(row).includes("r1\""));
assert.deepEqual((await listSquareAccounts(env, { now })).map(a => [a.id, a.token]), [["default", "default-token"], ["MNORTH123", "northco-token"]]);
// Wrong approval code fails cleanly.
assert.equal((await go("/relay/square/oauth/callback?code=bad&state=" + state)).status, 502);
// The public list never shows tokens.
const list = await (await go("/relay/square/merchants")).text();
assert.ok(!list.includes("northco-token") && list.includes("North & Co."));

// 3b. If the "connected" shop is really the default shop, it is read only once.
globalThis.__defaultMerchant = "MNORTH123";
assert.deepEqual((await listSquareAccounts(env, { now })).map(a => a.id), ["default"]);
globalThis.__defaultMerchant = "MDEFAULT1";

// 4. One sync reads both shops, each product labelled with its own shop.
const res = await syncSquareCatalogue(env);
assert.equal(res.shops, 2); assert.equal(res.products, 2);
const rows = sqlite.prepare("SELECT i.title, i.store_label, v.sku, v.price_minor FROM retailer_catalog_items i JOIN retailer_catalog_variants v ON v.item_id=i.id WHERE i.provider='square_sandbox' ORDER BY i.title").all();
assert.deepEqual(rows.map(r => [r.title, r.store_label, r.sku, r.price_minor]), [["Demo Tee", "Relay Demo Store", "DEMO-TEE", 2500], ["Oversized Shirt", "North & Co.", "OVER-NAV-M", 12999]]);

// 5. A price change in one shop is picked up on the next sync, and the other shop is untouched.
shops["northco-token"].items[0].price = 9999;
await syncSquareCatalogue(env);
assert.equal(sqlite.prepare("SELECT price_minor p FROM retailer_catalog_variants WHERE sku='OVER-NAV-M'").get().p, 9999);
assert.equal(sqlite.prepare("SELECT price_minor p FROM retailer_catalog_variants WHERE sku='DEMO-TEE'").get().p, 2500);

// 6. A broken shop never stops the others.
env.SQUARE_ACCESS_TOKEN = "broken-token";
const partial = await syncSquareCatalogue(env);
assert.equal(partial.shops, 1); assert.equal(partial.shopErrors.length, 1);
// If every shop is broken, the sync says so.
shops["northco-token"] = null;
await assert.rejects(() => syncSquareCatalogue(env), /Square HTTP 401/);

// 7. Without the application secret the approval can't finish, and says so.
const env2 = { ...env, SQUARE_APPLICATION_SECRET: undefined };
const noSecret = await handleSquareConnect(new Request("https://w.test/x"), env2, new URL("https://w.test/relay/square/oauth/callback?code=good&state=" + state), { now });
assert.equal(noSecret.status, 503);
console.log("square-connect: all checks passed");
