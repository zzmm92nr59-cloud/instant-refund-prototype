// Delivery details, and buying from a shop's own website with them filled in.
//
// A shopper can keep one UK delivery address with their account: their name, the address and postcode, and a phone number
// for the courier. When they buy something from a shop's own website through Relay (Discover's preview of shops' websites),
// Relay asks that shop's Shopify checkout to start an order for the item with their email and that address (Shopify's
// Universal Commerce Protocol: the shop's /api/ucp/mcp, tool create_checkout), then sends them to that checkout to choose
// delivery and pay. Relay never sees or takes payment, and nothing is bought until the shopper pays at the shop.
// The details go only to the shop they're buying from, only when they tap to buy there, and each time is noted (what they
// can see in "Download my data"). Deleting the account deletes the details and the notes.
//
// Finding the address from a postcode uses Ideal Postcodes (lookupPostcode below), only once Relay's key is set.
//
// Relay tells shops who it is with its agent profile (GET /.well-known/ucp below): it takes part in checkout, with delivery
// details (fulfillment). It doesn't sign its requests yet (Shopify's "anonymous" level, which can start checkouts but not
// finish them); finishing a purchase without the shop's own page needs Shopify's permission, which Relay doesn't have.

import { ensureOnce } from "./once.js";
import { cleanName } from "./profile.js";
import { WEB_SHOPS, USER_AGENT, ensureWebShopTables } from "./web-shops.js";

export const UCP_VERSION = "2026-08-25";
const DAY = 864e5;
// Checkouts one shopper can start in a day (each one asks a shop's server).
export const CHECKOUTS_PER_DAY = 40;

const json = (body, status, cors, cache) => Response.json(body, { status, headers: { ...cors, "Cache-Control": cache || "no-store" } });

export const DELIVERY_SQL = [
  "CREATE TABLE IF NOT EXISTS delivery_details (shopper_id TEXT PRIMARY KEY, details TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS web_checkouts (id INTEGER PRIMARY KEY AUTOINCREMENT, shopper_id TEXT NOT NULL, domain TEXT NOT NULL, shop TEXT NOT NULL, product TEXT, at INTEGER NOT NULL, address INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS web_checkouts_shopper ON web_checkouts (shopper_id, at)",
  // Postcode lookups (for the daily limits only: no postcode or address is kept).
  "CREATE TABLE IF NOT EXISTS address_lookups (shopper_id TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS address_lookups_at ON address_lookups (at)"
];
export function ensureDeliveryTables(db) {
  return ensureOnce(db, "delivery", () => db.batch(DELIVERY_SQL.map(s => db.prepare(s))));
}
// Deleting the account deletes the address and the record of which shops it went to.
export function deliveryDeleteStatements(db, shopperId) {
  return [db.prepare("DELETE FROM delivery_details WHERE shopper_id = ?").bind(shopperId), db.prepare("DELETE FROM web_checkouts WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM address_lookups WHERE shopper_id = ?").bind(shopperId)];
}

// ---- Finding an address from a postcode ----
// Royal Mail's address list (PAF) is licensed, so Relay asks Ideal Postcodes (api.ideal-postcodes.co.uk), which sells
// lookups in it: about 4.5p for each postcode it finds addresses for; a postcode it doesn't know costs nothing. Off until
// Relay's key is set as the Cloudflare secret IDEAL_POSTCODES_KEY. Only the postcode is sent: nothing about the shopper.
// Signed-in shoppers only, LOOKUPS_PER_DAY each and LOOKUPS_PER_DAY_ALL across everyone, so the bill can't run away.
export const LOOKUPS_PER_DAY = 20, LOOKUPS_PER_DAY_ALL = 400;
const SMALL_WORDS = new Set(["upon", "on", "in", "under", "the", "by", "with", "le", "de", "en", "and", "of", "next", "super", "sub"]);
// Royal Mail writes towns in capitals: "NEWCASTLE UPON TYNE" → "Newcastle upon Tyne", "STOKE-ON-TRENT" → "Stoke-on-Trent".
export function townCase(t) {
  return String(t || "").toLowerCase().split(" ").map((w, i) => w.split("-").map((p, j) => (i + j > 0 && SMALL_WORDS.has(p)) ? p : p.charAt(0).toUpperCase() + p.slice(1)).join("-")).join(" ");
}
// A flat or unit on its own first line goes second, so "Address" is the street (as shops' checkouts expect).
const SUB_PREMISE = /^(flat|apartment|apt|unit|studio|maisonette|room|suite|floor|basement|ground floor|first floor|second floor|third floor|top floor)\b/i;
export function addressFrom(r) {
  const lines = [r.line_1, r.line_2, r.line_3].map(x => oneLine(x)).filter(Boolean);
  if (!lines.length) return null;
  let line1 = lines[0], line2 = lines.slice(1).join(", ");
  if (lines.length > 1 && SUB_PREMISE.test(lines[0])) { line1 = lines.slice(1).join(", "); line2 = lines[0]; }
  const postcode = cleanPostcode(String(r.postcode || ""));
  const town = townCase(oneLine(r.post_town));
  if (!postcode || !town) return null;
  return { label: lines.join(", "), line1: line1.slice(0, 200), line2: line2 ? line2.slice(0, 200) : null, town: town.slice(0, 120), county: oneLine(r.county).slice(0, 120) || null, postcode };
}
export async function lookupPostcode(env, shopper, raw, o = {}) {
  const db = env.RELAY_DB, now = o.now || Date.now(), f = o.fetchImpl || ((...a) => fetch(...a));
  if (!env.IDEAL_POSTCODES_KEY) return { status: 503, body: { error: "lookup_off" } };
  const postcode = cleanPostcode(String(raw || ""));
  if (!postcode) return { status: 400, body: { error: "bad_postcode" } };
  await ensureDeliveryTables(db);
  const mine = await db.prepare("SELECT COUNT(*) AS n FROM address_lookups WHERE shopper_id = ? AND at > ?").bind(shopper.id, now - DAY).first();
  if (Number(mine && mine.n) >= LOOKUPS_PER_DAY) return { status: 429, body: { error: "too_many_lookups" } };
  const all = await db.prepare("SELECT COUNT(*) AS n FROM address_lookups WHERE at > ?").bind(now - DAY).first();
  if (Number(all && all.n) >= LOOKUPS_PER_DAY_ALL) return { status: 429, body: { error: "lookups_busy" } };
  await db.prepare("INSERT INTO address_lookups (shopper_id, at) VALUES (?, ?)").bind(shopper.id, now).run();
  await db.prepare("DELETE FROM address_lookups WHERE at < ?").bind(now - 2 * DAY).run();
  let r, j = null;
  try {
    r = await f("https://api.ideal-postcodes.co.uk/v1/postcodes/" + encodeURIComponent(postcode.replace(" ", "")) + "?api_key=" + encodeURIComponent(env.IDEAL_POSTCODES_KEY),
      { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10000) });
    j = await r.json().catch(() => null);
  } catch { return { status: 503, body: { error: "lookup_unavailable" } }; }
  if (r.status === 404 || (j && j.code === 4040)) {
    const suggestions = ((j && j.suggestions) || []).map(x => cleanPostcode(String(x))).filter(Boolean).slice(0, 3);
    return { status: 404, body: { error: "postcode_not_found", suggestions } };
  }
  if (!r.ok || !j || !Array.isArray(j.result)) {
    // A key that's wrong or out of lookups is Relay's to fix: logged, and the shopper types their address.
    console.error("address_lookup_failed", r.status, String((j && j.code) || "").slice(0, 10));
    return { status: 503, body: { error: "lookup_unavailable" } };
  }
  const addresses = j.result.map(addressFrom).filter(Boolean).slice(0, 150);
  return addresses.length ? { status: 200, body: { postcode, addresses } } : { status: 404, body: { error: "postcode_not_found", suggestions: [] } };
}

// ---- The details ----
const oneLine = (t) => String(t == null ? "" : t).normalize("NFC").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim();
// An address line as people write them: letters in any language, numbers, spaces and the usual punctuation.
const ADDRESS_CHARS = /^[\p{L}\p{M}\p{N} .,'’/&()#-]+$/u;
function line(raw, max, required) {
  if (raw == null || raw === "") return required ? undefined : null;
  if (typeof raw !== "string") return undefined;
  const s = oneLine(raw);
  if (!s) return required ? undefined : null;
  if ([...s].length > max || !ADDRESS_CHARS.test(s)) return undefined;
  return s;
}
// A UK postcode, written the usual way ("sw111aa" → "SW11 1AA"). British Forces (BFPO) and overseas territories aren't
// delivered to by most shops, so only the mainland and islands' postcodes are taken.
export function cleanPostcode(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/.exec(s);
  return m ? m[1] + " " + m[2] : null;
}
// A UK phone number for the courier, mobile or landline: "07700 900123", "+44 (0)20 7946 0018", "0044 …" → "+44…".
export function cleanUkPhone(raw) {
  if (typeof raw !== "string") return null;
  let t = raw.replace(/\(0\)/g, "").replace(/[\s().-]/g, "");
  if (/^0044/.test(t)) t = "+" + t.slice(2);
  else if (/^44\d{9,10}$/.test(t)) t = "+" + t;
  else if (/^0\d/.test(t)) t = "+44" + t.slice(1);
  return /^\+44(?:[1-3]\d{8,9}|7\d{9}|8\d{8,9})$/.test(t) ? t : null;
}
// What the shopper sent, checked and tidied; or which field is wrong (the app says what to fix).
export function cleanDelivery(body) {
  const b = body && typeof body === "object" ? body : {};
  const firstName = cleanName(typeof b.firstName === "string" ? b.firstName : undefined);
  if (!firstName) return { error: "firstName" };
  const lastName = cleanName(typeof b.lastName === "string" ? b.lastName : undefined);
  if (!lastName) return { error: "lastName" };
  const line1 = line(b.line1, 100, true); if (!line1) return { error: "line1" };
  const line2 = line(b.line2, 100, false); if (line2 === undefined) return { error: "line2" };
  const town = line(b.town, 60, true); if (!town) return { error: "town" };
  const county = line(b.county, 60, false); if (county === undefined) return { error: "county" };
  const postcode = cleanPostcode(b.postcode); if (!postcode) return { error: "postcode" };
  let phone = null;
  if (b.phone != null && String(b.phone).trim() !== "") { phone = cleanUkPhone(String(b.phone)); if (!phone) return { error: "phone" }; }
  return { value: { firstName, lastName, line1, line2, town, county, postcode, phone } };
}
export async function readDelivery(env, shopperId) {
  await ensureDeliveryTables(env.RELAY_DB);
  const row = await env.RELAY_DB.prepare("SELECT details, updated_at FROM delivery_details WHERE shopper_id = ?").bind(shopperId).first();
  if (!row) return null;
  try { return { ...JSON.parse(row.details), updatedAt: new Date(row.updated_at).toISOString() }; } catch { return null; }
}

// ---- Relay's agent profile for shops' checkouts (Universal Commerce Protocol) ----
// What Relay takes part in: checkout, and delivery details (fulfillment, which extends checkout). A shop uses only what
// both sides declare. Relay doesn't sign requests yet, so there are no keys here.
export function ucpProfile() {
  return { ucp: {
    version: UCP_VERSION,
    services: { "dev.ucp.shopping": [{ version: UCP_VERSION, spec: "https://ucp.dev/" + UCP_VERSION + "/specification/overview", transport: "mcp",
      schema: "https://ucp.dev/" + UCP_VERSION + "/services/shopping/mcp.openrpc.json" }] },
    capabilities: {
      "dev.ucp.shopping.checkout": [{ version: UCP_VERSION }],
      "dev.ucp.shopping.fulfillment": [{ version: UCP_VERSION, extends: "dev.ucp.shopping.checkout" }]
    },
    payment_handlers: {}
  } };
}
export function handleUcpProfileRoute(request, url, cors = {}) {
  if (url.pathname !== "/.well-known/ucp") return null;
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method_not_allowed" }, 405, cors);
  return Response.json(ucpProfile(), { status: 200, headers: { ...cors, "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } });
}

// ---- A checkout at a shop's own website, with the shopper's details filled in ----
// "web:finisterre.com:58572635603328" → the shop and the size or colour (Shopify's variant).
export function parseWebSku(sku) {
  const m = /^web:([a-z0-9.-]{3,100}):(\d{1,20})$/.exec(typeof sku === "string" ? sku : "");
  return m ? { domain: m[1], variant: m[2] } : null;
}
const sameSite = (host, domain) => { const bare = domain.replace(/^www\./, ""); return host === bare || host.endsWith("." + bare); };
// Where the shop's checkout page may be: its own website, or its Shopify address (which sends people to its own website).
export function checkoutUrlOk(raw, domain) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && (sameSite(u.hostname, domain) || /^[a-z0-9-]+\.myshopify\.com$/.test(u.hostname));
  } catch { return false; }
}
// What create_checkout is sent: the item, the shopper's email, and (when they've added them) their name, address and phone.
export function checkoutRequest(o) {
  const d = o.delivery, phone = o.withPhone !== false && d && d.phone ? d.phone : null;
  const checkout = {
    line_items: [{ quantity: 1, item: { id: "gid://shopify/ProductVariant/" + o.variant } }],
    buyer: { email: o.email, ...(phone ? { phone_number: phone } : {}) },
    context: { address_country: "GB", currency: "GBP", ...(d ? { postal_code: d.postcode } : {}) },
    attribution: { utm_source: "relay", utm_medium: "app" }
  };
  if (d) checkout.fulfillment = { methods: [{ type: "shipping", selected_destination_id: "home", destinations: [{ id: "home",
    first_name: d.firstName, last_name: d.lastName, ...(phone ? { phone_number: phone } : {}), street_address: d.line1, ...(d.line2 ? { extended_address: d.line2 } : {}),
    address_locality: d.town, ...(d.county ? { address_region: d.county } : {}), postal_code: d.postcode, address_country: "GB" }] }] };
  return { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_checkout",
    arguments: { meta: { "ucp-agent": { profile: o.profile }, "idempotency-key": o.key }, checkout } } };
}
// The checkout from a shop's answer (the structured part, or the same as text), with its messages; null if none.
export function checkoutFrom(answer) {
  const r = answer && answer.result;
  if (!r) return null;
  let c = r.structuredContent;
  if (!c && Array.isArray(r.content)) { try { c = JSON.parse((r.content.find(x => x && x.type === "text") || {}).text); } catch { c = null; } }
  return c && typeof c === "object" ? { checkout: c, isError: Boolean(r.isError) } : null;
}
const codes = (c) => (Array.isArray(c && c.messages) ? c.messages : []).map(m => String((m && m.code) || ""));

async function askShop(f, origin, body) {
  let r;
  try {
    r = await f(origin + "/api/ucp/mcp", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT }, body: JSON.stringify(body) });
  } catch { return { status: "unreachable" }; }
  if (r.status === 429) { await r.text().catch(() => ""); return { status: "busy" }; }
  if (!r.ok) { await r.text().catch(() => ""); return { status: "unavailable" }; }
  const text = await r.text().catch(() => "");
  if (text.length > 2_000_000) return { status: "unavailable" };
  try { return { status: "ok", answer: JSON.parse(text) }; } catch { return { status: "unavailable" }; }
}

// Starts the checkout. Answers { url, addressFilled, emailFilled } or { error } (the app then opens the shop's basket link,
// without anything filled in, and says so).
export async function startWebCheckout(env, shopper, sku, o = {}) {
  const ref = parseWebSku(sku);
  // Only the shops in Relay's list (web-shops.js): never an address someone sends.
  const shop = ref && WEB_SHOPS.find(s => s.domain === ref.domain);
  if (!shop) return { status: 400, body: { error: "not_a_web_shop" } };
  const db = env.RELAY_DB, now = o.now || Date.now(), f = o.fetchImpl || ((...a) => fetch(...a));
  await ensureWebShopTables(db);
  await ensureDeliveryTables(db);
  const item = await db.prepare("SELECT i.product, i.variation, i.available, s.origin, s.label FROM web_shop_items i JOIN web_shops s ON s.domain = i.domain WHERE i.id = ?").bind(sku).first();
  if (!item) return { status: 404, body: { error: "not_found" } };
  if (item.available === 0) return { status: 409, body: { error: "sold_out" } };
  const used = await db.prepare("SELECT COUNT(*) AS n FROM web_checkouts WHERE shopper_id = ? AND at > ?").bind(shopper.id, now - DAY).first();
  if (used && used.n >= CHECKOUTS_PER_DAY) return { status: 429, body: { error: "too_many_checkouts" } };
  let origin = "https://" + shop.domain;
  try { const u = new URL(item.origin || origin); if (u.protocol === "https:" && sameSite(u.hostname, shop.domain)) origin = u.origin; } catch { /* the shop's own address */ }
  const delivery = await readDelivery(env, shopper.id);
  const base = { variant: ref.variant, email: shopper.email, delivery, profile: o.profile, key: o.key || crypto.randomUUID() };
  let asked = await askShop(f, origin, checkoutRequest(base));
  let got = asked.status === "ok" ? checkoutFrom(asked.answer) : null;
  // Shops check phone numbers against the numbering plan and refuse the whole checkout over one they don't accept: try
  // once more without it (the shop's own page asks for a number if it needs one).
  if (got && got.isError && delivery && delivery.phone && codes(got.checkout).some(c => /phone/i.test(c))) {
    asked = await askShop(f, origin, checkoutRequest({ ...base, withPhone: false, key: crypto.randomUUID() }));
    got = asked.status === "ok" ? checkoutFrom(asked.answer) : null;
  }
  if (asked.status === "busy") return { status: 503, body: { error: "shop_busy" } };
  const url = got && !got.isError && got.checkout.continue_url;
  if (!url || !checkoutUrlOk(url, shop.domain)) return { status: 502, body: { error: "shop_checkout_failed" } };
  // Whether the shop took the address: it says so when it still needs one.
  const c = codes(got.checkout);
  const addressFilled = Boolean(delivery) && !c.includes("delivery_address_required");
  await db.prepare("INSERT INTO web_checkouts (shopper_id, domain, shop, product, at, address) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(shopper.id, shop.domain, item.label || shop.label, item.product, now, addressFilled ? 1 : 0).run();
  return { status: 200, body: { url, shop: item.label || shop.label, emailFilled: true, addressFilled } };
}

// ---- Routes ----
// GET /relay/my/delivery, POST /relay/my/delivery (save), POST /relay/my/delivery/remove,
// POST /relay/my/web-checkout { sku }: start a checkout at the shop with the details filled in.
export async function handleDeliveryRoute(request, env, url, cors, shopper, o = {}) {
  const path = url.pathname;
  if (path !== "/relay/my/delivery" && path !== "/relay/my/delivery/remove" && path !== "/relay/my/web-checkout" && path !== "/relay/my/address-lookup") return null;
  await ensureDeliveryTables(env.RELAY_DB);
  const now = o.now || Date.now();
  // lookup: whether "Find address" can be offered (Relay's postcode lookup key is set).
  if (path === "/relay/my/delivery" && request.method === "GET") return json({ delivery: await readDelivery(env, shopper.id), lookup: Boolean(env.IDEAL_POSTCODES_KEY) }, 200, cors);
  if (path === "/relay/my/address-lookup" && request.method === "GET") {
    const r = await lookupPostcode(env, shopper, url.searchParams.get("postcode"), { ...o, now });
    return json(r.body, r.status, cors);
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
  let body = {};
  try { const t = await request.text(); body = t ? JSON.parse(t) : {}; } catch { return json({ error: "bad_request" }, 400, cors); }
  if (path === "/relay/my/delivery/remove") {
    await env.RELAY_DB.prepare("DELETE FROM delivery_details WHERE shopper_id = ?").bind(shopper.id).run();
    return json({ delivery: null }, 200, cors);
  }
  if (path === "/relay/my/delivery") {
    const c = cleanDelivery(body);
    if (c.error) return json({ error: "bad_field", field: c.error }, 400, cors);
    await env.RELAY_DB.prepare(`INSERT INTO delivery_details (shopper_id, details, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(shopper_id) DO UPDATE SET details = excluded.details, updated_at = excluded.updated_at`).bind(shopper.id, JSON.stringify(c.value), now).run();
    return json({ delivery: { ...c.value, updatedAt: new Date(now).toISOString() } }, 200, cors);
  }
  const profile = o.profile || new URL("/.well-known/ucp", url.origin).href;
  const r = await startWebCheckout(env, shopper, body && body.sku, { ...o, now, profile });
  return json(r.body, r.status, cors);
}

// For "Download my data": the address, and which shops it was sent to and when.
export async function deliveryForExport(env, shopperId) {
  const db = env.RELAY_DB;
  const rows = async (sql, ...a) => { try { return (await db.prepare(sql).bind(...a).all()).results || []; } catch (e) { if (/no such table/i.test(String(e && e.message))) return []; throw e; } };
  const saved = (await rows("SELECT details, updated_at AS updatedAt FROM delivery_details WHERE shopper_id = ?", shopperId))[0];
  let details = null;
  if (saved) { try { details = { ...JSON.parse(saved.details), updatedAt: new Date(saved.updatedAt).toISOString() }; } catch { details = null; } }
  const sent = await rows("SELECT shop, product, at, address FROM web_checkouts WHERE shopper_id = ? ORDER BY at", shopperId);
  return { details, checkoutsStartedAtShops: sent.map(s => ({ shop: s.shop, product: s.product, at: new Date(s.at).toISOString(), addressSent: Boolean(s.address) })) };
}
