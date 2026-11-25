// Offline test, through Relay's real server code run locally (scripts/local-worker.mjs): the public Shopify status says
// nothing about any one shop. No myshopify address, no shop's order counts and no error text; those are on the team's
// health page only, which a visitor and an ordinary shopper can't open.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { startLocalWorker } from "./local-worker.mjs";

const w = await startLocalWorker({ appOrigin: "http://127.0.0.1:1" });
const { sqlite } = w;
const get = async (path, token) => { const r = await fetch(w.origin + path, { headers: token ? { authorization: "Bearer " + token } : {} }); return { status: r.status, text: await r.text() }; };
// Make the tables, then what two shops' connections left behind: one fine, one that failed with a raw error.
await get("/relay/shopify/status");
const SECRET_SHOP = "quiet-pilot-shop.myshopify.com", OTHER = "second-pilot.myshopify.com", RAW = "Shopify said: access token shpat_not_a_real_token rejected for order #1042";
const audit = sqlite.prepare("INSERT INTO audit_events (id,actor_type,actor_id,event_type,subject_type,subject_id,metadata_json) VALUES (?,?,?,?,?,?,?)");
audit.run("a1", "system", null, "shopify_orders_backfill", "shopify_store", SECRET_SHOP, JSON.stringify({ orders: 137, emailLinked: 41, skipped: 3, error: null }));
audit.run("a2", "system", null, "shopify_orders_backfill", "shopify_store", OTHER, JSON.stringify({ orders: 0, emailLinked: 0, skipped: 0, error: RAW }));
audit.run("a3", "system", null, "shopify_webhooks_registered", "shopify_store", SECRET_SHOP, JSON.stringify({ created: 5, alreadyThere: 1, failed: ["orders/paid: " + RAW] }));
audit.run("a4", "system", null, "shopify_catalogue_sync", "shopify_store", SECRET_SHOP, JSON.stringify({ success: false, products: 12, variants: 30, images: 9, error: RAW }));

// 1. Anyone on the internet.
const pub = await get("/relay/shopify/status");
assert.equal(pub.status, 200);
const body = JSON.parse(pub.text);
assert.doesNotMatch(pub.text, /myshopify\.com/, "no shop's address");
assert.doesNotMatch(pub.text, /shpat_|rejected|#1042|Shopify said/, "no error text");
// The last catalogue sync time in the answer (e.g. "2026-11-25 19:41:55") can contain 41 by chance, so they are taken out before looking for the counts.
assert.doesNotMatch(pub.text.replace(/\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?Z?/g, "T"), /\b137\b|\b41\b/, "no shop's order counts");
assert.equal(body.orderCatchUp, undefined); assert.equal(body.webhooks, undefined);
for (const s of body.publishedStores) assert.deepEqual(Object.keys(s), ["name"], "published shops by name only");
// What the app's own status line reads is still there.
for (const k of ["connectedStoreCount", "publishedStoreCount"]) assert.equal(typeof body[k], "number", k);
assert.equal(typeof body.paidOrderWebhookConfigured, "boolean");
assert.ok(Array.isArray(body.publishedStores));
assert.deepEqual(body.lastSync && Object.keys(body.lastSync).sort(), ["at", "images", "products", "success", "variants"], "the last sync: when, whether it worked, totals");
const walk = v => v && typeof v === "object" ? Object.values(v).every(walk) : (typeof v !== "string" || !/\.myshopify\.com|error/i.test(v));
assert.ok(walk({ ...body, note: "" }), "nothing in it names a shop's address");
console.log("ok - the public Shopify status gives counts and yes/no only: no shop address, order counts or error text");

// 2. The detail is for Relay's team: not a visitor, not an ordinary shopper.
const session = (email, checked) => {
  const raw = randomBytes(32).toString("base64url"), id = "s-" + email;
  sqlite.prepare("INSERT OR IGNORE INTO shoppers (id,email,email_hash,created_at) VALUES (?,?,?,?)").run(id, email, "h-" + email, Date.now());
  sqlite.prepare("INSERT INTO auth_sessions (session_hash,shopper_id,created_at,expires_at,second_step) VALUES (?,?,?,?,?)").run(createHash("sha256").update(raw).digest("hex"), id, Date.now(), Date.now() + 864e5, checked ? 1 : 0);
  return raw;
};
await get("/relay/me", "x".repeat(43)); // makes the sign-in tables
assert.equal((await get("/relay/my/admin/health")).status, 401, "a visitor: not signed in");
const shopper = await get("/relay/my/admin/health", session("ordinary.shopper@example.com", true));
assert.equal(shopper.status, 404, "an ordinary shopper: as if it didn't exist");
assert.doesNotMatch(shopper.text, /myshopify/);
const team = await get("/relay/my/admin/health", session("team.admin@example.com", true));
assert.equal(team.status, 200, team.text.slice(0, 200));
const d = JSON.parse(team.text).shopifyDetail;
assert.deepEqual(d.orderCatchUp.find(r => r.shop === SECRET_SHOP), { shop: SECRET_SHOP, at: d.orderCatchUp.find(r => r.shop === SECRET_SHOP).at, orders: 137, emailLinked: 41, skipped: 3, failed: false });
assert.equal(d.orderCatchUp.find(r => r.shop === OTHER).failed, true, "a failure is flagged");
assert.equal(d.webhooks.find(r => r.shop === SECRET_SHOP).failed, 1);
assert.doesNotMatch(team.text, /shpat_|Shopify said/, "even the team's page carries no raw error text: that stays in the logs");
console.log("ok - each shop's catch-up and notice set-up are on the team's health page only, without raw errors");
await w.close();
console.log("PASS public Shopify status: counts only; shop detail for Relay's team");
