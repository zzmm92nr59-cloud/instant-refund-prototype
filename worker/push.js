// Phone alerts for Relay: price-drop notifications sent as standard Web Push messages.
//  * The shopper opts in on their own phone/browser (the browser asks permission; nothing is sent without it).
//  * Messages are encrypted for that device (RFC 8291) and signed with Relay's own key (VAPID, RFC 8292), so the push service can't read them.
//  * Relay's signing key is created by the server the first time it is needed and kept encrypted in the database; nobody pastes a key anywhere.
import { ensureOnce } from "./once.js";

const enc = new TextEncoder();
const PUSH_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com", "web.push.apple.com"];
const MAX_SUBS = 5, MAX_WATCHES = 400;

export function b64u(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
export function unb64u(text) {
  const s = String(text).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s + "=".repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
}
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
function jwkFromRaw(pub, d) { return { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ...(d ? { d: b64u(d) } : {}), ext: true }; }

// Encrypts a message for one subscribed device (aes128gcm, RFC 8291). `fixed` exists so the published test vector can be checked.
export async function encryptPayload(payload, uaPublicB64u, authB64u, fixed = {}) {
  const ua = unb64u(uaPublicB64u), auth = unb64u(authB64u);
  if (ua.length !== 65 || ua[0] !== 4 || auth.length !== 16) throw Error("bad_subscription_keys");
  let asPub, asPriv;
  if (fixed.privateKey) {
    asPub = unb64u(fixed.publicKey);
    asPriv = await crypto.subtle.importKey("jwk", jwkFromRaw(asPub, unb64u(fixed.privateKey)), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)); asPriv = kp.privateKey;
  }
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPriv, 256));
  const salt = fixed.salt ? unb64u(fixed.salt) : crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdf(auth, secret, cat(enc.encode("WebPush: info\0"), ua, asPub), 32);
  const cek = await hkdf(salt, prk, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const body = typeof payload === "string" ? enc.encode(payload) : payload;
  if (body.length > 3900) throw Error("payload_too_large");
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(body, new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPub.length]), asPub, cipher);
}

// ---- Relay's own signing key (VAPID) ----
export async function wrapKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("relay-push-key:" + env.AUTH_SECRET));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export function ensurePushTables(db) { return ensureOnce(db, "push", () => ensurePushTablesRun(db)); }
async function ensurePushTablesRun(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS push_keys (id INTEGER PRIMARY KEY CHECK (id = 1), public_key TEXT NOT NULL, private_iv TEXT NOT NULL, private_data TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL, last_test_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_push_subs_shopper ON push_subscriptions(shopper_id)`,
    `CREATE TABLE IF NOT EXISTS price_watches (shopper_id TEXT NOT NULL, sku TEXT NOT NULL, product TEXT NOT NULL, variant TEXT, store TEXT, via TEXT NOT NULL DEFAULT 'item', baseline_minor INTEGER, last_seen_minor INTEGER, last_alert_at INTEGER, created_at INTEGER NOT NULL, PRIMARY KEY (shopper_id, sku))`,
    `CREATE TABLE IF NOT EXISTS store_optins (shopper_id TEXT NOT NULL, store TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (shopper_id, store))`
  ];
  for (const s of statements) await db.prepare(s).run();
}
export function pushDeleteStatements(db, shopperId) {
  return ["push_subscriptions", "price_watches", "store_optins"].map(t => db.prepare(`DELETE FROM ${t} WHERE shopper_id = ?`).bind(shopperId));
}
export async function getVapid(env) {
  const db = env.RELAY_DB;
  let row = await db.prepare("SELECT public_key, private_iv, private_data FROM push_keys WHERE id = 1").first();
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const pub = b64u(cat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y)));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await wrapKey(env), enc.encode(JSON.stringify(jwk))));
    await db.prepare("INSERT OR IGNORE INTO push_keys (id, public_key, private_iv, private_data, created_at) VALUES (1,?,?,?,?)").bind(pub, b64u(iv), b64u(data), Date.now()).run();
    row = await db.prepare("SELECT public_key, private_iv, private_data FROM push_keys WHERE id = 1").first();
  }
  const jwk = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(row.private_iv) }, await wrapKey(env), unb64u(row.private_data))));
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return { publicKey: row.public_key, key };
}
async function vapidAuth(env, endpoint, now) {
  const { publicKey, key } = await getVapid(env);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.PUSH_CONTACT || "https://zzmm92nr59-cloud.github.io/instant-refund-prototype/" })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + claims)));
  return "vapid t=" + head + "." + claims + "." + b64u(sig) + ", k=" + publicKey;
}

export function allowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
    return PUSH_HOSTS.some(h => u.hostname === h || u.hostname.endsWith("." + h));
  } catch { return false; }
}

// Sends one message. A device that has gone away (404/410) is forgotten.
export async function sendPush(env, sub, message, o = {}) {
  const now = o.now || Date.now(), f = o.fetchImpl || ((...a) => fetch(...a));
  const body = await encryptPayload(JSON.stringify(message), sub.p256dh, sub.auth);
  const res = await f(sub.endpoint, { method: "POST", headers: { Authorization: await vapidAuth(env, sub.endpoint, now), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "normal" }, body });
  if (res.status === 404 || res.status === 410) await env.RELAY_DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
  let reason = "";
  if (!(res.status >= 200 && res.status < 300)) { try { reason = String(await res.text()).replace(/[^\w ,.:{}"\-]/g, "").slice(0, 120); } catch { /* ignore */ } }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, reason };
}
export async function subsOf(db, shopperId) {
  return ((await db.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE shopper_id = ?").bind(shopperId).all()).results || []);
}
const pounds = (m) => "£" + (m / 100).toFixed(2);
// A price in the shop's own currency: £ for GBP (as before), otherwise e.g. "US$12.00". Never shows another currency as pounds.
export function priceText(minor, currency) {
  const c = /^[A-Z]{3}$/.test(String(currency || "")) ? String(currency) : "GBP";
  if (c === "GBP") return pounds(minor);
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: c }).format(minor / 100); } catch { return c + " " + (minor / 100).toFixed(2); }
}

// Looks at every watched item (UK shops selling in pounds only). A price lower than the last one Relay saw is a drop; the first look only records the price.
export async function runPriceAlerts(env, o = {}) {
  const db = env.RELAY_DB; if (!db) return { checked: 0, drops: 0, sent: 0 };
  await ensurePushTables(db);
  const now = o.now || Date.now();
  const rows = ((o.shopperId
    ? await db.prepare("SELECT * FROM price_watches WHERE shopper_id = ? LIMIT 1000").bind(o.shopperId).all()
    : await db.prepare("SELECT * FROM price_watches LIMIT 20000").all()).results || []);
  const byShopper = new Map();
  let checked = 0, drops = 0, sent = 0;
  for (const w of rows) {
    const cur = await db.prepare("SELECT price_minor AS p, currency AS c FROM retailer_catalog_variants WHERE (sku = ? OR id = ?) AND price_minor IS NOT NULL AND currency = 'GBP' ORDER BY updated_at DESC, id LIMIT 1").bind(w.sku, w.sku).first();
    if (!cur || !Number.isFinite(cur.p)) continue;
    checked++;
    if (w.last_seen_minor != null && cur.p < w.last_seen_minor) {
      drops++;
      const l = byShopper.get(w.shopper_id) || []; l.push({ w, was: w.last_seen_minor, now: cur.p, currency: cur.c }); byShopper.set(w.shopper_id, l);
      await db.prepare("UPDATE price_watches SET last_seen_minor = ?, last_alert_at = ? WHERE shopper_id = ? AND sku = ?").bind(cur.p, now, w.shopper_id, w.sku).run();
    } else if (w.last_seen_minor !== cur.p) {
      await db.prepare("UPDATE price_watches SET last_seen_minor = ? WHERE shopper_id = ? AND sku = ?").bind(cur.p, w.shopper_id, w.sku).run();
    }
  }
  // One alert per product, so each shows its own shop, product and prices.
  // A very large catalogue update is capped at 10 alerts plus one summary so a phone is never flooded.
  for (const [shopperId, list] of byShopper) {
    const subs = await subsOf(db, shopperId);
    const messages = list.slice(0, 10).map(x => ({
      title: "Price drop" + (x.w.store ? " at " + x.w.store : ""),
      body: x.w.product + (x.w.variant ? " · " + x.w.variant : "") + " is now " + priceText(x.now, x.currency) + " (was " + priceText(x.was, x.currency) + ")",
      url: "./"
    }));
    if (list.length > 10) messages.push({ title: (list.length - 10) + " more price drops", body: "Open Relay to see everything you watch.", url: "./" });
    for (const message of messages) {
      for (const s of subs) { try { const r = await sendPush(env, s, message, o); if (r.ok) sent++; } catch {} }
    }
  }
  return { checked, drops, sent };
}

const json = (body, status = 200, cors = {}) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
// Item keys: shop SKUs, or for Shopify the shop-scoped variant id (which contains "/").
const SKU = /^[A-Za-z0-9:_.\-\/]{1,200}$/;
const clean = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) : "");
const minor = (v) => (Number.isInteger(v) && v >= 0 && v < 100000000 ? v : null);

export async function handlePushRoute(request, env, url, cors, shopper, o) {
  const path = url.pathname, m = request.method;
  if (!(path.startsWith("/relay/my/push/") || path.startsWith("/relay/my/alerts/"))) return null;
  const db = env.RELAY_DB;
  await ensurePushTables(db);
  const body = m === "POST" ? await request.json().catch(() => null) : null;
  if (path === "/relay/my/push/key" && m === "GET") return json({ publicKey: (await getVapid(env)).publicKey }, 200, cors);
  if (path === "/relay/my/push/subscribe" && m === "POST") {
    const ep = body && body.endpoint, k = body && body.keys || {};
    if (!allowedEndpoint(ep) || typeof k.p256dh !== "string" || typeof k.auth !== "string") return json({ error: "bad_subscription" }, 400, cors);
    try { await encryptPayload("x", k.p256dh, k.auth); } catch { return json({ error: "bad_subscription" }, 400, cors); }
    const count = (await db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE shopper_id = ? AND endpoint <> ?").bind(shopper.id, ep).first()).n;
    if (count >= MAX_SUBS) return json({ error: "too_many_devices" }, 400, cors);
    await db.prepare(`INSERT INTO push_subscriptions (id, shopper_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET shopper_id = excluded.shopper_id, p256dh = excluded.p256dh, auth = excluded.auth`).bind(crypto.randomUUID(), shopper.id, ep, k.p256dh, k.auth, o.now).run();
    return json({ ok: true }, 200, cors);
  }
  if (path === "/relay/my/push/unsubscribe" && m === "POST") {
    if (body && typeof body.endpoint === "string") await db.prepare("DELETE FROM push_subscriptions WHERE shopper_id = ? AND endpoint = ?").bind(shopper.id, body.endpoint).run();
    return json({ ok: true }, 200, cors);
  }
  if (path === "/relay/my/alerts/status" && m === "GET") {
    const subs = (await db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE shopper_id = ?").bind(shopper.id).first()).n;
    const watches = ((await db.prepare("SELECT sku, product, variant, store, via, last_seen_minor AS lastSeenMinor FROM price_watches WHERE shopper_id = ? ORDER BY created_at DESC LIMIT 500").bind(shopper.id).all()).results || []);
    const stores = ((await db.prepare("SELECT store FROM store_optins WHERE shopper_id = ?").bind(shopper.id).all()).results || []).map(r => r.store);
    return json({ devices: subs, watches: watches.filter(w => w.via === "item"), storeWatchCount: watches.filter(w => w.via === "store").length, stores }, 200, cors);
  }
  if (path === "/relay/my/push/test" && m === "POST") {
    const subs = await subsOf(db, shopper.id);
    if (!subs.length) return json({ error: "no_device" }, 400, cors);
    const last = (await db.prepare("SELECT MAX(last_test_at) AS t FROM push_subscriptions WHERE shopper_id = ?").bind(shopper.id).first()).t || 0;
    if (o.now - last < 15000) return json({ error: "slow_down" }, 429, cors);
    await db.prepare("UPDATE push_subscriptions SET last_test_at = ? WHERE shopper_id = ?").bind(o.now, shopper.id).run();
    let sent = 0, failed = 0, why = "";
    for (const s of subs) { try { const r = await sendPush(env, s, { title: "Relay test alert", body: "If you can read this, price alerts will reach this device.", url: "./" }, o); if (r.ok) sent++; else { failed++; why = why || ("push service said " + r.status + (r.reason ? " " + r.reason : "")); } } catch (e) { failed++; why = why || ("could not send: " + String(e && e.message || e).slice(0, 80)); } }
    return json({ sent, failed, why }, 200, cors);
  }
  if (path === "/relay/my/alerts/watch" && m === "POST") {
    const sku = body && body.sku;
    if (typeof sku !== "string" || !SKU.test(sku)) return json({ error: "bad_item" }, 400, cors);
    if (body.on === false) {
      await db.prepare("DELETE FROM price_watches WHERE shopper_id = ? AND sku = ? AND via = 'item'").bind(shopper.id, sku).run();
      return json({ ok: true }, 200, cors);
    }
    const n = (await db.prepare("SELECT COUNT(*) AS n FROM price_watches WHERE shopper_id = ?").bind(shopper.id).first()).n;
    if (n >= MAX_WATCHES) return json({ error: "too_many_watches" }, 400, cors);
    const price = minor(body.priceMinor);
    await db.prepare(`INSERT INTO price_watches (shopper_id, sku, product, variant, store, via, baseline_minor, last_seen_minor, created_at) VALUES (?,?,?,?,?, 'item', ?,?,?)
      ON CONFLICT(shopper_id, sku) DO UPDATE SET via = 'item', baseline_minor = excluded.baseline_minor, last_seen_minor = excluded.last_seen_minor`)
      .bind(shopper.id, sku, clean(body.product, 120) || "Item", clean(body.variant, 120) || null, clean(body.store, 80) || null, price, price, o.now).run();
    return json({ ok: true }, 200, cors);
  }
  if (path === "/relay/my/alerts/store" && m === "POST") {
    const store = clean(body && body.store, 80);
    if (!store) return json({ error: "bad_store" }, 400, cors);
    if (body.on === false) {
      await db.prepare("DELETE FROM store_optins WHERE shopper_id = ? AND store = ?").bind(shopper.id, store).run();
      await db.prepare("DELETE FROM price_watches WHERE shopper_id = ? AND store = ? AND via = 'store'").bind(shopper.id, store).run();
      return json({ ok: true }, 200, cors);
    }
    const items = (Array.isArray(body.items) ? body.items : []).filter(i => i && typeof i.sku === "string" && SKU.test(i.sku)).slice(0, 250);
    const n = (await db.prepare("SELECT COUNT(*) AS n FROM price_watches WHERE shopper_id = ? AND via = 'item'").bind(shopper.id).first()).n;
    const have = (await db.prepare("SELECT COUNT(*) AS n FROM price_watches WHERE shopper_id = ? AND store = ? AND via = 'store'").bind(shopper.id, store).first()).n;
    if (n + items.length - have > 1500) return json({ error: "too_many_watches" }, 400, cors);
    await db.prepare("INSERT OR IGNORE INTO store_optins (shopper_id, store, created_at) VALUES (?,?,?)").bind(shopper.id, store, o.now).run();
    const st = [];
    for (const i of items) {
      const price = minor(i.priceMinor);
      // Items watched on their own keep their own baseline; shop-wide watches never overwrite them.
      st.push(db.prepare(`INSERT OR IGNORE INTO price_watches (shopper_id, sku, product, variant, store, via, baseline_minor, last_seen_minor, created_at) VALUES (?,?,?,?,?, 'store', ?,?,?)`)
        .bind(shopper.id, i.sku, clean(i.product, 120) || "Item", clean(i.variant, 120) || null, store, price, price, o.now));
    }
    if (st.length) await db.batch(st);
    return json({ ok: true, watching: items.length }, 200, cors);
  }
  if (path === "/relay/my/alerts/offers" && m === "GET") {
    // Live offers shops have sent for items this shopper watches (on their own or by following the shop). Nothing about other shoppers.
    let offers = [];
    try {
      offers = ((await db.prepare(`SELECT o.id, o.store_label AS store, o.sku, o.product, o.variant, o.offer_minor AS offerMinor, o.was_minor AS wasMinor, o.note, o.ends_at AS endsAt,
          (SELECT i.image_url FROM retailer_catalog_variants v JOIN retailer_catalog_items i ON i.id = v.item_id WHERE v.sku = o.sku OR v.id = o.sku LIMIT 1) AS imageUrl
        FROM retailer_offers o WHERE o.ends_at > ? AND EXISTS (SELECT 1 FROM price_watches w WHERE w.shopper_id = ? AND w.sku = o.sku AND w.store = o.store_label)
        ORDER BY o.ends_at LIMIT 50`).bind(o.now, shopper.id).all()).results || []);
    } catch { offers = []; /* no shop has sent an offer yet */ }
    return json({ offers: offers.map(x => ({ ...x, currency: "GBP" })) }, 200, cors);
  }
  if (path === "/relay/my/alerts/check" && m === "POST") {
    const last = (checkedAt.get(shopper.id) || 0);
    if (o.now - last < 20000) return json({ error: "slow_down" }, 429, cors);
    checkedAt.set(shopper.id, o.now);
    let synced = false, syncError = "";
    if (typeof o.syncCatalogues === "function") { try { await o.syncCatalogues(); synced = true; } catch (e) { syncError = String(e && e.message || e).slice(0, 120); } }
    return json({ synced, syncError, ...(await runPriceAlerts(env, { ...o, shopperId: shopper.id })) }, 200, cors);
  }
  return null;
}
const checkedAt = new Map();
