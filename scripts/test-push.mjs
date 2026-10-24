// Offline tests for phone price alerts. A pretend phone (a real P-256 key pair) receives what the server sends and decrypts it with an
// independent copy of the RFC 8291 steps. No message ever leaves this machine: the push service is a stand-in function.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { encryptPayload, b64u, unb64u, allowedEndpoint, runPriceAlerts } from "../worker/push.js";

// 1. The published example from RFC 8291 Appendix A comes out byte for byte.
{
  const body = await encryptPayload("When I grow up, I want to be a watermelon", "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", "BTBZMqHH6r4Tts7J_aSIgg",
    { privateKey: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", publicKey: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8", salt: "DGv6ra1nlYgDCS1FRnbzlw" });
  assert.equal(b64u(body.slice(0, 86)), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
  assert.equal(b64u(body.slice(86)), "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ");
}

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; }, _exec() { sqlite.prepare(sql).run(...args); } };
}
const db = { prepare: sql => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { list.forEach(s => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key" };
let emails = [], pushes = [], pushStatus = 201, synced = 0;
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  if (/^https:\/\/(fcm\.googleapis\.com|web\.push\.apple\.com)\//.test(String(url))) { pushes.push({ url: String(url), headers: init.headers, body: init.body }); return new Response("", { status: pushStatus }); }
  throw Error("unexpected network call to " + url);
};
let clock = 1_800_000_000_000;
const call = (path, { method = "GET", body, token } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }),
    env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl, syncCatalogues: async () => { synced++; } });
let ip = 10;
async function signIn(email) {
  emails = [];
  await handleAuthRoute(new Request("https://w.test/relay/auth/request", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9." + ip++ }, body: JSON.stringify({ email }) }), env, new URL("https://w.test/relay/auth/request"), {}, { now: clock, fetchImpl });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const alice = await signIn("alice@example.com"), bob = await signIn("bob@example.com");
const post = (p, token, body) => call(p, { method: "POST", token, body });
const get = (p, token) => call(p, { token });
const idOf = email => sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id;

// A pretend phone.
async function phone() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
  return { kp, pub, auth, keys: { p256dh: b64u(pub), auth: b64u(auth) } };
}
async function read(ph, body) {
  const b = new Uint8Array(body), salt = b.slice(0, 16), idlen = b[20], asPub = b.slice(21, 21 + idlen), cipher = b.slice(21 + idlen);
  const hk = async (s, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []) }, ph.kp.privateKey, 256));
  const T = new TextEncoder(), cat = (...a) => Uint8Array.from(a.flatMap(x => [...x]));
  const prk = await hk(ph.auth, secret, cat(T.encode("WebPush: info\0"), ph.pub, asPub), 32);
  const cek = await hk(salt, prk, T.encode("Content-Encoding: aes128gcm\0"), 16), nonce = await hk(salt, prk, T.encode("Content-Encoding: nonce\0"), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), cipher));
  assert.equal(plain[plain.length - 1], 2, "single-record padding delimiter");
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

// 2. Everything needs sign-in.
for (const [m, p] of [["GET", "/relay/my/push/key"], ["POST", "/relay/my/push/subscribe"], ["POST", "/relay/my/push/test"], ["GET", "/relay/my/alerts/status"], ["POST", "/relay/my/alerts/watch"], ["POST", "/relay/my/alerts/store"], ["POST", "/relay/my/alerts/check"]])
  assert.equal((await call(p, { method: m })).status, 401, p + " needs sign-in");

// 3. Relay's signing key is made by the server, is stable, and is not stored in the clear.
const k1 = (await (await get("/relay/my/push/key", alice)).json()).publicKey, k2 = (await (await get("/relay/my/push/key", bob)).json()).publicKey;
assert.equal(k1, k2); assert.equal(unb64u(k1).length, 65);
const keyRow = sqlite.prepare("SELECT * FROM push_keys").get();
assert.ok(!JSON.stringify(keyRow).includes('"d"') && !keyRow.private_data.includes("kty"), "private key is encrypted at rest");

// 4. Only real push services are accepted; bad keys are refused.
assert.equal(allowedEndpoint("https://fcm.googleapis.com/fcm/send/x"), true);
for (const bad of ["http://fcm.googleapis.com/x", "https://evil.example.com/x", "https://fcm.googleapis.com.evil.com/x", "https://localhost/x", "https://169.254.169.254/x", "https://fcm.googleapis.com:8443/x", "https://u:p@fcm.googleapis.com/x", "nonsense"])
  assert.equal(allowedEndpoint(bad), false, bad);
const pa = await phone(), pb = await phone();
assert.equal((await post("/relay/my/push/subscribe", alice, { endpoint: "https://evil.example.com/x", keys: pa.keys })).status, 400);
assert.equal((await post("/relay/my/push/subscribe", alice, { endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: { p256dh: "AAAA", auth: "BBBB" } })).status, 400);
assert.equal((await post("/relay/my/push/subscribe", alice, { endpoint: "https://fcm.googleapis.com/fcm/send/alice-phone", keys: pa.keys })).status, 200);
assert.equal((await post("/relay/my/push/subscribe", bob, { endpoint: "https://web.push.apple.com/bob-phone", keys: pb.keys })).status, 200);

// 5. The test alert reaches the right device only, is encrypted for it, and is signed by Relay.
let r = await post("/relay/my/push/test", alice, {});
assert.deepEqual(await r.json(), { sent: 1, failed: 0 });
assert.equal(pushes.length, 1); assert.equal(pushes[0].url, "https://fcm.googleapis.com/fcm/send/alice-phone");
assert.equal((await read(pa, pushes[0].body)).title, "Relay test alert");
const auth = pushes[0].headers.Authorization, m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(auth);
assert.ok(m, auth); assert.equal(m[4], k1);
assert.equal(JSON.parse(new TextDecoder().decode(unb64u(m[2]))).aud, "https://fcm.googleapis.com");
{
  const pub = unb64u(k1), key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33)) }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64u(m[3]), new TextEncoder().encode(m[1] + "." + m[2])), "Relay's signature checks out");
}
assert.equal((await post("/relay/my/push/test", alice, {})).status, 429, "test alerts are throttled");
clock += 60000;
assert.equal((await post("/relay/my/push/test", (await signIn("carol@example.com")), {})).status, 400, "a shopper with no device gets a clear answer");

// 6. A watched item: no alert until the price actually falls, then one alert, never a repeat.
const item = (id, sku, price) => { sqlite.prepare("INSERT OR IGNORE INTO retailer_catalog_items (id, provider, external_item_id, title) VALUES (?,?,?,?)").run("i" + id, "square_sandbox", "x" + id, "Item " + id);
  sqlite.prepare("INSERT INTO retailer_catalog_variants (id, item_id, external_variant_id, title, sku, price_minor, currency) VALUES (?,?,?,?,?,?,?)").run("v" + id, "i" + id, "ev" + id, "Cream", sku, price, "GBP"); };
item(1, "DEMO-JACKET", 5000); item(2, "DEMO-BOOT", 8000); item(3, "DEMO-HAT", 1500);
const setPrice = (sku, p) => sqlite.prepare("UPDATE retailer_catalog_variants SET price_minor = ? WHERE sku = ?").run(p, sku);
assert.equal((await post("/relay/my/alerts/watch", alice, { sku: "bad sku!", priceMinor: 100 })).status, 400);
assert.equal((await post("/relay/my/alerts/watch", alice, { sku: "DEMO-JACKET", product: "Field Jacket", variant: "Cream", store: "Test Shop", priceMinor: 5000 })).status, 200);
pushes = []; clock += 60000;
let c = await (await post("/relay/my/alerts/check", alice, {})).json();
assert.equal(c.drops, 0); assert.equal(pushes.length, 0, "no drop, no alert"); assert.equal(synced, 1, "a manual check refreshes the shops first");
assert.equal((await post("/relay/my/alerts/check", alice, {})).status, 429, "checks are throttled");
setPrice("DEMO-JACKET", 3999); clock += 60000;
c = await (await post("/relay/my/alerts/check", alice, {})).json();
assert.equal(c.drops, 1); assert.equal(c.sent, 1);
const note = await read(pa, pushes[0].body);
assert.equal(note.title, "Price drop at Test Shop"); assert.equal(note.body, "Field Jacket · Cream is now £39.99 (was £50.00)");
pushes = []; clock += 60000;
assert.equal((await (await post("/relay/my/alerts/check", alice, {})).json()).drops, 0, "the same drop is never announced twice");
setPrice("DEMO-JACKET", 4500); clock += 60000; await post("/relay/my/alerts/check", alice, {});
assert.equal(pushes.length, 0, "a price rise is not an alert");
setPrice("DEMO-JACKET", 4400); clock += 60000; await post("/relay/my/alerts/check", alice, {});
assert.equal(pushes.length, 1, "a later fall from the new price is");
assert.equal((await post("/relay/my/alerts/watch", alice, { sku: "DEMO-JACKET", on: false })).status, 200);

// 7. Shop-wide alerts: only the shopper who opted in hears about that shop, and unwatching one's own items does not affect them.
pushes = []; clock += 60000;
assert.equal((await post("/relay/my/alerts/store", bob, { store: "Test Shop", items: [{ sku: "DEMO-BOOT", product: "Boot", priceMinor: 8000 }, { sku: "DEMO-HAT", product: "Hat", priceMinor: 1500 }, { sku: "not ok!" }] })).status, 200);
let st = await (await get("/relay/my/alerts/status", bob)).json();
assert.deepEqual(st.stores, ["Test Shop"]); assert.equal(st.storeWatchCount, 2); assert.equal(st.devices, 1);
setPrice("DEMO-BOOT", 6000); clock += 60000;
c = await runPriceAlerts(env, { now: clock, fetchImpl });
assert.equal(c.drops, 1); assert.equal(pushes.length, 1); assert.equal(pushes[0].url, "https://web.push.apple.com/bob-phone", "goes to the shopper who opted in");
assert.equal((await read(pb, pushes[0].body)).body, "Boot is now £60.00 (was £80.00)");
assert.equal((await (await get("/relay/my/alerts/status", alice)).json()).storeWatchCount, 0, "another shopper's shop alerts are private");
assert.equal((await post("/relay/my/alerts/store", bob, { store: "Test Shop", on: false })).status, 200);
assert.equal((await (await get("/relay/my/alerts/status", bob)).json()).stores.length, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM price_watches WHERE shopper_id = ?").get(idOf("bob@example.com")).n, 0);

// 8. Several drops become one message. A phone that has gone away is forgotten.
await post("/relay/my/alerts/watch", alice, { sku: "DEMO-BOOT", product: "Boot", priceMinor: 6000 }); await post("/relay/my/alerts/watch", alice, { sku: "DEMO-HAT", product: "Hat", priceMinor: 1500 });
setPrice("DEMO-BOOT", 5000); setPrice("DEMO-HAT", 1000); pushes = []; pushStatus = 410; clock += 60000;
await runPriceAlerts(env, { now: clock, fetchImpl });
assert.equal(pushes.length, 1, "one message for two drops");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE shopper_id = ?").get(idOf("alice@example.com")).n, 0, "a device the push service says is gone is removed");

// 9. Deleting the account removes everything.
const bobId = idOf("bob@example.com");
await post("/relay/my/push/subscribe", bob, { endpoint: "https://fcm.googleapis.com/fcm/send/bob2", keys: pb.keys });
await post("/relay/my/alerts/watch", bob, { sku: "DEMO-HAT", product: "Hat", priceMinor: 1000 });
await post("/relay/my/alerts/store", bob, { store: "Test Shop", items: [{ sku: "DEMO-BOOT", priceMinor: 5000 }] });
for (const t of ["push_subscriptions", "price_watches", "store_optins"]) assert.ok(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE shopper_id = ?`).get(bobId).n > 0, t + " has rows before deletion");
assert.equal((await post("/relay/my/delete", bob, {})).status, 200);
for (const t of ["push_subscriptions", "price_watches", "store_optins"]) assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE shopper_id = ?`).get(bobId).n, 0, t + " emptied");
console.log("PASS phone alerts: RFC 8291 vector, key safety, device checks, drop detection, privacy between shoppers, cleanup (STAND-IN push service)");
