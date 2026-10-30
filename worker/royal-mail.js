// Royal Mail return labels through Click & Drop, on the SHOP's own Royal Mail account.
//
// How it works:
//  * A Shopify shop opens Relay for shops and adds its Click & Drop API key (Click & Drop > Settings > Integrations),
//    the address returns should go to, and which Royal Mail returns service to use. Relay checks the key by asking
//    Royal Mail for the shop's returns services before saving anything. The key is stored encrypted and is never
//    sent back to any browser.
//  * When a shopper starts a return for that shop, Relay reads the delivery address from the Shopify order and asks
//    Royal Mail (POST /returns) for a return label. Only if Royal Mail answers with a tracking number does Relay show
//    the shopper a label: the QR code (for a Post Office counter) and/or the printable label, exactly as Royal Mail
//    sent them. Anything else (no key, Royal Mail refuses, no UK address on the order) means no label, never a
//    made-up one, and the shopper is told to use the shop's own returns process as before.
//  * Postage is charged by Royal Mail to the shop's account, the same as a label made in Click & Drop itself.
//  * The shopper's address goes only to Royal Mail; Relay doesn't keep it. The label Royal Mail returns is kept so the
//    shopper can download it again, and is deleted with the shopper's account.
//
// Royal Mail API reference: https://api.parcel.royalmail.com/ (Returns: GET /returns/services, POST /returns).

import { ensureOnce } from "./once.js";

export const RM_API = "https://api.parcel.royalmail.com/api/v1";
const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(s + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0)); };
const clean = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "");
// UK postcodes, including BFPO-free special cases like GIR 0AA.
const UK_POSTCODE = /^(GIR ?0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/i;
const KEY_SHAPE = /^[A-Za-z0-9-]{20,100}$/;

export function ensureRoyalMailTables(db) {
  return ensureOnce(db, "royal-mail", async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS relay_royal_mail (
      shop TEXT PRIMARY KEY, key_iv TEXT NOT NULL, key_data TEXT NOT NULL, service_code TEXT NOT NULL, service_name TEXT,
      services TEXT, name TEXT NOT NULL, company TEXT, line1 TEXT NOT NULL, line2 TEXT, city TEXT NOT NULL, postcode TEXT NOT NULL,
      connected_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS relay_return_labels (
      return_id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, label TEXT, qr TEXT, created_at INTEGER NOT NULL)`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_relay_return_labels_shopper ON relay_return_labels(shopper_id)").run();
  });
}

async function wrapKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("relay-royal-mail-key:" + env.AUTH_SECRET));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv: b64u(iv), data: b64u(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await wrapKey(env), enc.encode(text)))) };
}
async function unseal(env, iv, data) {
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await wrapKey(env), unb64u(data)));
}

function rmFetch(key, path, init = {}, o = {}) {
  const f = o.fetchImpl || ((...a) => fetch(...a));
  return f(RM_API + path, { ...init, headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "application/json" },
    signal: AbortSignal.timeout(15000) });
}

// The returns services on this Click & Drop account. Throws "bad_key" if Royal Mail doesn't accept the key.
export async function returnServices(key, o = {}) {
  const res = await rmFetch(key, "/returns/services", { method: "GET" }, o);
  if (res.status === 401 || res.status === 403) throw Error("bad_key");
  if (!res.ok) throw Error("royal_mail_unavailable");
  const j = await res.json().catch(() => ({}));
  return (Array.isArray(j.services) ? j.services : [])
    .map(s => ({ code: clean(s && s.serviceCode, 20), name: clean(s && s.serviceName, 80) }))
    .filter(s => /^[A-Za-z0-9-]{1,20}$/.test(s.code));
}

async function rowFor(env, shop) {
  await ensureRoyalMailTables(env.RELAY_DB);
  return env.RELAY_DB.prepare("SELECT * FROM relay_royal_mail WHERE shop = ?").bind(shop).first();
}

// What the shop's dashboard shows. Never includes the key.
export async function royalMailSettings(env, shop) {
  const r = await rowFor(env, shop);
  if (!r) return { connected: false };
  let services = []; try { services = JSON.parse(r.services || "[]"); } catch { services = []; }
  return { connected: true, serviceCode: r.service_code, serviceName: r.service_name || r.service_code, services,
    address: { name: r.name, company: r.company || "", line1: r.line1, line2: r.line2 || "", city: r.city, postcode: r.postcode }, connectedAt: r.connected_at };
}

// Saves (or updates) a shop's Royal Mail set-up. A new key is checked with Royal Mail first; an existing key can be kept.
export async function saveRoyalMail(env, shop, body, o = {}) {
  const now = o.now || Date.now();
  const b = body && typeof body === "object" ? body : {};
  const a = b.address && typeof b.address === "object" ? b.address : {};
  const addr = { name: clean(a.name, 150), company: clean(a.company, 250), line1: clean(a.line1, 250), line2: clean(a.line2, 250), city: clean(a.city, 100),
    postcode: clean(a.postcode, 10).toUpperCase() };
  if (!addr.name || !addr.line1 || !addr.city) return [400, { error: "address_incomplete" }];
  if (!UK_POSTCODE.test(addr.postcode)) return [400, { error: "bad_postcode" }];
  const existing = await rowFor(env, shop);
  const newKey = typeof b.apiKey === "string" ? b.apiKey.trim() : "";
  if (!newKey && !existing) return [400, { error: "key_needed" }];
  if (newKey && !KEY_SHAPE.test(newKey)) return [400, { error: "bad_key" }];
  const key = newKey || await unseal(env, existing.key_iv, existing.key_data);
  let services;
  try { services = await returnServices(key, o); }
  catch (e) { return e.message === "bad_key" ? [400, { error: "bad_key" }] : [502, { error: "royal_mail_unavailable" }]; }
  if (!services.length) return [400, { error: "no_return_services" }];
  const wanted = clean(b.serviceCode, 20) || (existing && existing.service_code) || services[0].code;
  const svc = services.find(s => s.code === wanted);
  if (!svc) return [400, { error: "bad_service", services }];
  const sealed = newKey ? await seal(env, newKey) : { iv: existing.key_iv, data: existing.key_data };
  await env.RELAY_DB.prepare(`INSERT INTO relay_royal_mail (shop, key_iv, key_data, service_code, service_name, services, name, company, line1, line2, city, postcode, connected_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(shop) DO UPDATE SET key_iv = excluded.key_iv, key_data = excluded.key_data, service_code = excluded.service_code,
    service_name = excluded.service_name, services = excluded.services, name = excluded.name, company = excluded.company, line1 = excluded.line1, line2 = excluded.line2,
    city = excluded.city, postcode = excluded.postcode, updated_at = excluded.updated_at`)
    .bind(shop, sealed.iv, sealed.data, svc.code, svc.name || svc.code, JSON.stringify(services), addr.name, addr.company || null, addr.line1, addr.line2 || null,
      addr.city, addr.postcode, now, now).run();
  return [200, await royalMailSettings(env, shop)];
}

export async function removeRoyalMail(env, shop) {
  await ensureRoyalMailTables(env.RELAY_DB);
  await env.RELAY_DB.prepare("DELETE FROM relay_royal_mail WHERE shop = ?").bind(shop).run();
  return [200, { connected: false }];
}

// Whether Relay can make Royal Mail labels for this shop right now.
export async function shopMakesLabels(env, shop) {
  if (!env.RELAY_DB || !env.AUTH_SECRET) return false;
  return Boolean(await rowFor(env, shop).catch(() => null));
}

const nameParts = (first, last, fallback) => {
  first = clean(first, 150); last = clean(last, 150);
  if (first && last) return [first, last];
  const words = (first || last || fallback || "").split(" ").filter(Boolean);
  return words.length > 1 ? [words.slice(0, -1).join(" "), words.at(-1)] : [words[0] || "", words[0] || ""];
};
// What Royal Mail sent back, only if it's really a PDF / PNG / JPEG.
const pdfOrNull = (s) => (typeof s === "string" && /^JVBER[A-Za-z0-9+/=\s]+$/.test(s) && s.length < 1_500_000 ? s.replace(/\s/g, "") : null);
const imageOrNull = (s) => {
  if (typeof s !== "string") return null;
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(s.trim());
  const body = m ? m[2] : s.replace(/\s/g, "");
  if (body.length > 400_000) return null;
  if (/^iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(body)) return { type: "image/png", data: body };
  if (/^\/9j\/[A-Za-z0-9+/=]+$/.test(body)) return { type: "image/jpeg", data: body };
  return null;
};

// Asks Royal Mail for a return label from the shopper's address to the shop. Returns null unless Royal Mail gave a tracking number.
// from: { firstName, lastName, company, address1, address2, city, zip, countryCode } as on the Shopify order.
export async function createReturnLabel(env, shop, from, reference, o = {}) {
  const r = await rowFor(env, shop).catch(() => null);
  if (!r || !from) return null;
  if (String(from.countryCode || "").toUpperCase() !== "GB") return null;
  const postcode = clean(from.zip, 10).toUpperCase();
  if (!UK_POSTCODE.test(postcode) || !clean(from.address1, 250) || !clean(from.city, 100)) return null;
  const [firstName, lastName] = nameParts(from.firstName, from.lastName, from.name);
  if (!firstName) return null;
  const [shopFirst, shopLast] = nameParts("", "", r.name);
  const body = {
    service: { serviceCode: r.service_code },
    shipment: {
      shippingAddress: { firstName, lastName, companyName: clean(from.company, 250) || undefined, addressLine1: clean(from.address1, 250),
        addressLine2: clean(from.address2, 250) || undefined, city: clean(from.city, 100), postcode, country: "United Kingdom", countryIsoCode: "GBR" },
      returnAddress: { firstName: shopFirst, lastName: shopLast, companyName: r.company || undefined, addressLine1: r.line1, addressLine2: r.line2 || undefined,
        city: r.city, postcode: r.postcode, country: "United Kingdom", countryIsoCode: "GBR" },
      customerReference: { reference: clean(reference, 50) }
    }
  };
  try {
    const key = await unseal(env, r.key_iv, r.key_data);
    const res = await rmFetch(key, "/returns", { method: "POST", body: JSON.stringify(body) }, o);
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const tracking = clean(j && j.shipment && j.shipment.trackingNumber, 40);
    if (!/^[A-Z0-9]{8,40}$/i.test(tracking)) return null;
    return { trackingNumber: tracking.toUpperCase(), serviceName: r.service_name || r.service_code, label: pdfOrNull(j.label), qr: imageOrNull(j.qrCode) };
  } catch { return null; }
}

// The delivery address on the Shopify order, read at the moment the label is made and not stored by Relay.
export async function orderAddress(store, externalOrderId, o = {}) {
  const f = o.fetchImpl || ((...a) => fetch(...a));
  const ext = String(externalOrderId || "");
  const gid = /^\d{1,20}$/.test(ext) ? "gid://shopify/Order/" + ext : (/^gid:\/\/shopify\/Order\/\d{1,20}$/.test(ext) ? ext : null);
  if (!gid || !store || !store.token) return null;
  try {
    const res = await f("https://" + store.domain + "/admin/api/2026-07/graphql.json", { method: "POST",
      headers: { "X-Shopify-Access-Token": store.token, "content-type": "application/json" },
      body: JSON.stringify({ query: "query RelayReturnAddress($id: ID!) { order(id: $id) { shippingAddress { firstName lastName name company address1 address2 city zip countryCodeV2 } } }", variables: { id: gid } }),
      signal: AbortSignal.timeout(10000) });
    const a = (((await res.json().catch(() => ({}))).data || {}).order || {}).shippingAddress;
    return a ? { ...a, countryCode: a.countryCodeV2 } : null;
  } catch { return null; }
}

export async function saveLabel(env, returnId, shopperId, made, now = Date.now()) {
  await ensureRoyalMailTables(env.RELAY_DB);
  await env.RELAY_DB.prepare("INSERT OR REPLACE INTO relay_return_labels (return_id, shopper_id, label, qr, created_at) VALUES (?,?,?,?,?)")
    .bind(returnId, shopperId, made.label || null, made.qr ? JSON.stringify(made.qr) : null, now).run();
}

// GET /relay/my/return/label?id=…&kind=pdf|qr — only the shopper who started the return can fetch it.
export async function labelResponse(env, shopper, url, cors = {}) {
  await ensureRoyalMailTables(env.RELAY_DB);
  const row = await env.RELAY_DB.prepare("SELECT label, qr FROM relay_return_labels WHERE return_id = ? AND shopper_id = ?")
    .bind(String(url.searchParams.get("id") || ""), shopper.id).first();
  const kind = url.searchParams.get("kind");
  const headers = { ...cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (row && kind === "pdf" && row.label)
    return new Response(Uint8Array.from(atob(row.label), c => c.charCodeAt(0)), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=\"royal-mail-return-label.pdf\"" } });
  if (row && kind === "qr" && row.qr) {
    const q = JSON.parse(row.qr);
    return new Response(Uint8Array.from(atob(q.data), c => c.charCodeAt(0)), { headers: { ...headers, "Content-Type": q.type } });
  }
  return Response.json({ error: "not_found" }, { status: 404, headers });
}

// Makes sure the table exists first, so deleting an account never fails on a database that has never made a label.
export async function labelDeleteStatements(db, shopperId) {
  await ensureRoyalMailTables(db);
  return [db.prepare("DELETE FROM relay_return_labels WHERE shopper_id = ?").bind(shopperId)];
}
