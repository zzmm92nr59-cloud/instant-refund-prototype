// "Connect with Shopify": a Shopify shop owner approves Relay from inside their own Shopify admin.
// Only someone who can run that shop can approve, so finishing the approval also signs them in to their Relay shop dashboard.
// What is stored per shop: its myshopify address, its name and its access/refresh tokens, encrypted with a key derived from AUTH_SECRET.
// Tokens never reach the browser. Relay reads products, stock and orders, and can edit an order only to carry out an exchange
// the shopper who owns that order asked for (same price, in stock; see exchange.js). Orders are used for one thing:
// showing a shopper their own purchases, matched by the email they verified with Relay (only a hash of the order email is kept).
// Approving is also the shop's consent for Relay to show its products and prices to Relay shoppers (the page says so).
// Relay is for UK shops that sell in pounds: a shop whose Shopify currency isn't GBP is turned away (nothing is stored).
// After approval Relay asks Shopify to tell it straight away when the shop's products change or the app is removed (webhooks).
import { ensureOnce } from "./once.js";
import { wrapKey } from "./push.js";
import { issueRetailerKey } from "./retailer.js";
import { ensureSquareMerchantSchema } from "./square-connect.js";
import { getShopifyStores, syncShopifyCatalogues } from "./shopify.js";

const SCOPES = "read_products,read_inventory,read_orders,write_order_edits";
const API_VERSION = "2026-07";
const DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const DASHBOARD_BASE = "https://zzmm92nr59-cloud.github.io/instant-refund-prototype/";
const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - String(s).length % 4) % 4)), c => c.charCodeAt(0));
const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

// Relay can run several Shopify apps at once: the main app (SHOPIFY_CLIENT_ID/_SECRET, later the public one) plus
// one "custom distribution" app per pilot shop (SHOPIFY_APP_1.._20 _CLIENT_ID, _CLIENT_SECRET and optional _SHOP),
// because Shopify only lets a custom app be installed on the one shop it was made for.
// A request is matched to the app whose secret signed it; each connected shop remembers which app it came through.
export function shopifyApps(env) {
  const out = [], seen = new Set();
  const add = (id, secret, shop) => {
    id = String(id || "").trim(); secret = String(secret || "").trim();
    if (!id || !secret || seen.has(id)) return;
    seen.add(id); out.push({ id, secret, shop: normaliseShop(shop) || null });
  };
  add(env.SHOPIFY_CLIENT_ID, env.SHOPIFY_CLIENT_SECRET, null);
  for (let n = 1; n <= 20; n++) add(env["SHOPIFY_APP_" + n + "_CLIENT_ID"], env["SHOPIFY_APP_" + n + "_CLIENT_SECRET"], env["SHOPIFY_APP_" + n + "_SHOP"]);
  return out;
}
// The app to ask a shop's approval through: the pilot app made for that shop if there is one, otherwise the main app.
function appForShop(env, shop) {
  const apps = shopifyApps(env);
  return apps.find(a => a.shop && a.shop === shop) || apps.find(a => !a.shop) || null;
}
function appById(env, id) { return shopifyApps(env).find(a => a.id === id) || null; }
// Which of Relay's apps signed this query string (null if none did).
async function signingApp(env, params) {
  for (const a of shopifyApps(env)) if (await shopifySigned(params, a.secret)) return a;
  return null;
}

// Accepts what a shop owner is likely to type: "my-shop", "my-shop.myshopify.com", "https://my-shop.myshopify.com/admin"
// or the newer admin address "admin.shopify.com/store/my-shop". Anything else is refused.
export function normaliseShop(raw) {
  let s = String(raw || "").trim().toLowerCase();
  if (!s || s.length > 200) return null;
  const admin = /(?:^|\/\/)admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/.exec(s);
  if (admin) s = admin[1];
  s = s.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  if (/^[a-z0-9][a-z0-9-]*$/.test(s)) s += ".myshopify.com";
  return DOMAIN.test(s) && s.length <= 120 ? s : null;
}

export function ensureShopifyShopSchema(db) {
  return ensureOnce(db, "shopify-shops", async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS shopify_shops (domain TEXT PRIMARY KEY, label TEXT NOT NULL, access_iv TEXT NOT NULL, access_data TEXT NOT NULL,
      refresh_iv TEXT, refresh_data TEXT, expires_at INTEGER, refresh_expires_at INTEGER, scopes TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`).run();
  }).then(() => ensureOnce(db, "shopify-shops-app", async () => {
    // Which Relay app the shop approved (empty = the main app). Added later, so older databases get the column here.
    try { await db.prepare("ALTER TABLE shopify_shops ADD COLUMN client_id TEXT").run(); } catch { /* already there */ }
  }));
}

async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await wrapKey(env), enc.encode(text)));
  return { iv: b64u(iv), data: b64u(data) };
}
async function open(env, iv, data) {
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await wrapKey(env), unb64u(data)));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
function sameText(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length || !a.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// Shopify signs the query string it sends us: every parameter except hmac, sorted by name, as name=value joined by "&".
export async function shopifySigned(params, secret) {
  const given = String(params.get("hmac") || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given) || !secret) return false;
  const message = [...params.entries()].filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => k + "=" + v).join("&");
  const mine = hex(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(message)));
  return sameText(mine, given);
}
// Our own "state": which shop the approval is for, where to go afterwards, and when it stops being valid. Signed so it can't be altered.
async function makeState(env, now, purpose, shop, appId) {
  const body = b64u(enc.encode(JSON.stringify({ p: purpose === "d" ? "d" : "c", s: shop, a: appId, e: now + 15 * 60 * 1000, n: b64u(crypto.getRandomValues(new Uint8Array(9))) })));
  return body + "." + b64u(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey("relay-shopify-state:" + env.AUTH_SECRET), enc.encode(body))));
}
async function readState(env, state, now) {
  const [body, sig, extra] = String(state || "").split(".");
  if (!body || !sig || extra !== undefined || body.length > 500) return null;
  const want = b64u(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey("relay-shopify-state:" + env.AUTH_SECRET), enc.encode(body))));
  if (!sameText(want, sig)) return null;
  try { const s = JSON.parse(dec.decode(unb64u(body))); return s && s.e > now && DOMAIN.test(s.s) ? s : null; } catch { return null; }
}

const page = (title, html, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title>
<body style="font:16px system-ui;max-width:520px;margin:12vh auto;padding:0 20px;color:#141827;line-height:1.5"><h1 style="font-size:24px">${esc(title)}</h1>${html}`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
const askForShop = (note, purpose) => page("Connect your Shopify shop", `${note ? `<p style="color:#9c3328">${esc(note)}</p>` : ""}
<p>Enter your shop's Shopify address. You'll approve Relay inside your own Shopify admin. Relay reads your products, prices, stock and paid orders (so shoppers can see their own purchases). The only change it ever makes is swapping an item on an order for another size or colour at the same price, when the customer who placed that order asks for it in Relay.</p>
<form method="get" action="/relay/shopify/connect"><input name="shop" placeholder="your-shop.myshopify.com" required autocomplete="off" style="font:inherit;padding:12px;border:1px solid #ccc;border-radius:10px;width:100%;box-sizing:border-box">
${purpose === "d" ? '<input type="hidden" name="for" value="dashboard">' : ""}<button style="margin-top:10px;font:inherit;font-weight:700;background:#141827;color:#fff;border:0;border-radius:10px;padding:12px 18px">Continue to Shopify</button></form>`, note ? 400 : 200);

async function authorizeRedirect(env, url, shop, purpose, now, app) {
  const state = await makeState(env, now, purpose, shop, app.id);
  const to = "https://" + shop + "/admin/oauth/authorize?client_id=" + encodeURIComponent(app.id) + "&scope=" + encodeURIComponent(SCOPES) +
    "&redirect_uri=" + encodeURIComponent(url.origin + "/relay/shopify/oauth/callback") + "&state=" + encodeURIComponent(state);
  return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });
}
async function tokenRequest(shop, fields, f) {
  const r = await f("https://" + shop + "/admin/oauth/access_token", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("Shopify token step failed (" + r.status + ")");
  return j;
}
// The shop's name and the currency it sells in. If Shopify can't be asked, the name falls back to the address and the currency is unknown.
async function shopInfo(shop, token, f) {
  let name = "", currency = null;
  try {
    const r = await f("https://" + shop + "/admin/api/" + API_VERSION + "/graphql.json", { method: "POST",
      headers: { "X-Shopify-Access-Token": token, "content-type": "application/json" }, body: JSON.stringify({ query: "{ shop { name currencyCode } }" }), signal: AbortSignal.timeout(15000) });
    const s = (await r.json())?.data?.shop || {};
    if (typeof s.name === "string" && s.name.trim()) name = s.name.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80);
    if (typeof s.currencyCode === "string" && /^[A-Z]{3}$/.test(s.currencyCode)) currency = s.currencyCode;
  } catch { /* fall back to the address */ }
  return { name: name || shop.replace(/\.myshopify\.com$/, "").replace(/-/g, " "), currency };
}

// Webhooks: Shopify tells Relay at once when a product is added, changed or removed, and when the shop removes the app.
// Each is signed by Shopify with the app's secret and checked in shopify-webhooks.js. Asking twice never makes duplicates.
export const WEBHOOK_TOPICS = ["APP_UNINSTALLED", "PRODUCTS_CREATE", "PRODUCTS_UPDATE", "PRODUCTS_DELETE", "ORDERS_PAID", "INVENTORY_LEVELS_UPDATE"];
export async function registerShopifyWebhooks(shop, token, origin, f) {
  const uri = origin.replace(/\/$/, "") + "/relay/webhooks/shopify";
  const gql = async (query, variables) => {
    const r = await f("https://" + shop + "/admin/api/" + API_VERSION + "/graphql.json", { method: "POST",
      headers: { "X-Shopify-Access-Token": token, "content-type": "application/json" }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j.errors && j.errors.length)) throw new Error("Shopify said " + r.status + " " + String((j.errors && j.errors[0] && j.errors[0].message) || "").slice(0, 100));
    return j.data || {};
  };
  const have = await gql("query RelayHooks { webhookSubscriptions(first: 100) { nodes { id topic uri } } }");
  const already = new Set(((have.webhookSubscriptions && have.webhookSubscriptions.nodes) || []).filter(n => n && n.uri === uri).map(n => n.topic));
  const out = { created: 0, alreadyThere: 0, failed: [] };
  for (const topic of WEBHOOK_TOPICS) {
    if (already.has(topic)) { out.alreadyThere++; continue; }
    try {
      const d = await gql(`mutation RelayHook($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id } userErrors { field message } } }`, { topic, sub: { uri, format: "JSON" } });
      const res = d.webhookSubscriptionCreate || {};
      if (res.webhookSubscription && res.webhookSubscription.id) out.created++;
      else out.failed.push(topic + ": " + String((res.userErrors && res.userErrors[0] && res.userErrors[0].message) || "no reason given").slice(0, 100));
    } catch (e) { out.failed.push(topic + ": " + String(e && e.message || e).slice(0, 100)); }
  }
  return out;
}
async function recordHooks(env, shop, outcome) {
  try {
    await env.RELAY_DB.prepare(`INSERT INTO audit_events(id,actor_type,actor_id,event_type,subject_type,subject_id,metadata_json) VALUES (?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), "system", null, "shopify_webhooks_registered", "shopify_store", shop, JSON.stringify(outcome)).run();
  } catch { /* the record is a nice-to-have */ }
}

// A shop removed the app (or Shopify asked Relay to erase it): its tokens, dashboard keys and products are deleted, so it
// disappears from Relay straight away. With everything: true (Shopify's shop/redact, 48 hours later) its offer history goes too.
export async function forgetShopifyShop(env, domain, o = {}) {
  const db = env.RELAY_DB, conn = "shopify:" + domain;
  await ensureShopifyShopSchema(db);
  await db.prepare("DELETE FROM shopify_shops WHERE domain = ?").bind(domain).run();
  try { await db.prepare("DELETE FROM retailer_keys WHERE provider = 'shopify' AND shop_ref = ?").bind(domain).run(); } catch { /* no keys table yet */ }
  await removeShopifyItems(db, conn, null);
  if (o.everything) { try { await db.prepare("DELETE FROM retailer_offers WHERE provider = 'shopify' AND shop_ref = ?").bind(domain).run(); } catch { /* no offers yet */ } }
}
// Removes a shop's products (all of them, or one product when productGid is given), with their sizes, stock and pictures.
export async function removeShopifyItems(db, conn, productGid) {
  const items = ((await db.prepare("SELECT id FROM retailer_catalog_items WHERE provider = ?" + (productGid ? " AND external_item_id = ?" : ""))
    .bind(...(productGid ? [conn, productGid] : [conn])).all()).results || []).map(r => r.id);
  for (const id of items) {
    await db.prepare("DELETE FROM retailer_inventory_snapshots WHERE variant_id IN (SELECT id FROM retailer_catalog_variants WHERE item_id = ?)").bind(id).run();
    await db.prepare("DELETE FROM retailer_catalog_variants WHERE item_id = ?").bind(id).run();
    try { await db.prepare("DELETE FROM retailer_item_images WHERE item_id = ?").bind(id).run(); } catch { /* no pictures table */ }
    await db.prepare("DELETE FROM retailer_catalog_items WHERE id = ?").bind(id).run();
  }
  return items.length;
}
async function saveTokens(env, shop, label, j, now, appId) {
  const a = await seal(env, j.access_token), r = j.refresh_token ? await seal(env, j.refresh_token) : { iv: null, data: null };
  const exp = Number(j.expires_in) > 0 ? now + Number(j.expires_in) * 1000 : null;
  const rexp = Number(j.refresh_token_expires_in) > 0 ? now + Number(j.refresh_token_expires_in) * 1000 : null;
  await env.RELAY_DB.prepare(`INSERT INTO shopify_shops (domain, label, access_iv, access_data, refresh_iv, refresh_data, expires_at, refresh_expires_at, scopes, created_at, updated_at, client_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(domain) DO UPDATE SET label = excluded.label, access_iv = excluded.access_iv, access_data = excluded.access_data,
    refresh_iv = excluded.refresh_iv, refresh_data = excluded.refresh_data, expires_at = excluded.expires_at, refresh_expires_at = excluded.refresh_expires_at,
    scopes = excluded.scopes, updated_at = excluded.updated_at, client_id = excluded.client_id`)
    .bind(shop, label, a.iv, a.data, r.iv, r.data, exp, rexp, String(j.scope || "").slice(0, 300), now, now, appId || null).run();
}

export async function handleShopifyConnect(request, env, url, o = {}) {
  const path = url.pathname;
  if (!["/relay/shopify/connect", "/relay/shopify/launch", "/relay/shopify/oauth/callback"].includes(path) || request.method !== "GET") return null;
  const now = o.now || Date.now(), f = o.fetchImpl || ((...a) => fetch(...a));
  if (!env.RELAY_DB || !env.AUTH_SECRET || String(env.AUTH_SECRET).length < 16)
    return page("Not available yet", "<p>Relay's server is not fully set up for connecting shops.</p>", 503);
  if (!shopifyApps(env).length)
    return page("Almost there", "<p>Relay is missing its Shopify app details on the server, so it can't connect Shopify shops yet.</p>", 503);
  await ensureShopifyShopSchema(env.RELAY_DB);
  const q = url.searchParams;

  if (path === "/relay/shopify/connect") {
    const purpose = q.get("for") === "dashboard" ? "d" : "c";
    if (!q.has("shop")) return askForShop("", purpose);
    const shop = normaliseShop(q.get("shop"));
    if (!shop) return askForShop("That doesn't look like a Shopify shop address. It ends in .myshopify.com (you can see it in your Shopify admin under Settings → Domains).", purpose);
    const app = appForShop(env, shop);
    if (!app) return askForShop("Relay isn't set up for this shop yet. Please use the install link Relay sent you.", purpose);
    return authorizeRedirect(env, url, shop, purpose, now, app);
  }

  if (path === "/relay/shopify/launch") {
    // Opened from the shop's own Shopify admin: Shopify signs this link. A link older than ten minutes is refused so it can't be reused.
    const shop = normaliseShop(q.get("shop")), ts = Number(q.get("timestamp"));
    const app = shop && q.get("shop") === shop && Number.isFinite(ts) && Math.abs(now / 1000 - ts) <= 600 ? await signingApp(env, q) : null;
    if (!app || (app.shop && app.shop !== shop))
      return page("Please open Relay again", "<p>Open Relay from the Apps section of your Shopify admin, or sign in from the Relay shop dashboard.</p>", 400);
    return authorizeRedirect(env, url, shop, "d", now, app);
  }

  // /relay/shopify/oauth/callback
  if (q.get("error")) return page("Not connected", "<p>The shop did not approve Relay, so nothing was connected.</p>", 400);
  const shop = normaliseShop(q.get("shop"));
  const app = shop && q.get("shop") === shop ? await signingApp(env, q) : null;
  if (!app || (app.shop && app.shop !== shop))
    return page("Not connected", "<p>Relay couldn't confirm this approval came from Shopify, so nothing was connected. Please start again.</p>", 400);
  const state = await readState(env, q.get("state"), now);
  if (!state || state.s !== shop || (state.a && state.a !== app.id)) return page("That link has expired", "<p>Please start again from Connect with Shopify.</p>", 400);
  const code = q.get("code");
  if (!code || code.length > 300) return page("Not connected", "<p>Shopify did not send an approval code.</p>", 400);
  try {
    const j = await tokenRequest(shop, { client_id: app.id, client_secret: app.secret, code, expiring: "1" }, f);
    if (!String(j.scope || "").split(",").map(s => s.trim()).some(s => s === "read_products" || s === "write_products"))
      return page("Not connected", "<p>Relay needs permission to read your products. Please approve again and keep that permission switched on.</p>", 400);
    const info = await shopInfo(shop, j.access_token, f), label = info.name;
    if (info.currency && info.currency !== "GBP")
      return page("Relay is for UK shops", `<p>${esc(label)} sells in ${esc(info.currency)}. Relay only works with UK shops that sell in pounds (£), so nothing was connected.</p>
<p>If this shop should sell in pounds, change its currency in Shopify (Settings → Store details → Store currency), then connect again.</p>`, 400);
    await saveTokens(env, shop, label, j, now, app.id);
    // Ask Shopify to tell Relay about changes straight away. If it can't, hourly reading still keeps the shop up to date.
    try { await recordHooks(env, shop, await registerShopifyWebhooks(shop, j.access_token, url.origin, f)); }
    catch (e) { await recordHooks(env, shop, { created: 0, alreadyThere: 0, failed: [String(e && e.message || e).slice(0, 120)] }); }
    if (typeof o.afterConnect === "function") o.afterConnect(shop);
    const key = await issueRetailerKey(env, { provider: "shopify", shopRef: shop, storeLabel: label }, now);
    const dash = (env.RELAY_APP_URL || DASHBOARD_BASE).replace(/\/?$/, "/") + "retailer.html#key=" + encodeURIComponent(key);
    if (state.p === "d") return new Response(null, { status: 302, headers: { location: dash, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
    return page("Connected", `<p>${esc(label)} is connected to Relay. Relay can read this shop's products, prices, stock and paid orders. Products are shown to Relay shoppers; an order is only ever shown to the shopper whose verified email it was placed with, and only that shopper can ask to swap an item for another size or colour at the same price.</p>
<p><a href="${esc(dash)}" rel="noreferrer" style="display:inline-block;background:#141827;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none">Open your Relay shop dashboard</a></p>
<p style="color:#5b6275;font-size:14px">See which of your items shoppers are watching and send them offers. Keep this link private: anyone with it can see your shop's figures.</p>`);
  } catch (e) {
    return page("Could not connect", `<p>${esc(String(e && e.message || e).slice(0, 160))}</p>`, 502);
  }
}

// Every shop that connected itself, with a usable access token (refreshed shortly before it runs out). A shop that can't be read is skipped.
export async function listConnectedShopifyStores(env, o = {}) {
  if (!env.RELAY_DB || !env.AUTH_SECRET) return [];
  const now = o.now || Date.now(), f = o.fetchImpl || ((...a) => fetch(...a));
  await ensureShopifyShopSchema(env.RELAY_DB);
  const rows = ((await env.RELAY_DB.prepare("SELECT * FROM shopify_shops ORDER BY created_at").all()).results || []);
  const out = [];
  for (const m of rows) {
    try {
      let token = await open(env, m.access_iv, m.access_data);
      const expiring = m.expires_at && m.expires_at - now < 5 * 60 * 1000;
      const app = (m.client_id && appById(env, m.client_id)) || (!m.client_id && appForShop(env, m.domain)) || null;
      if (expiring && m.refresh_data && (!m.refresh_expires_at || m.refresh_expires_at > now) && app) {
        try {
          const oldRefresh = await open(env, m.refresh_iv, m.refresh_data);
          const j = await tokenRequest(m.domain, { client_id: app.id, client_secret: app.secret, grant_type: "refresh_token", refresh_token: oldRefresh }, f);
          // Shopify normally hands back a new refresh token; if it doesn't, the old one stays in use until it runs out.
          if (!j.refresh_token) {
            j.refresh_token = oldRefresh;
            j.refresh_token_expires_in = m.refresh_expires_at ? (m.refresh_expires_at - now) / 1000 : 0;
          }
          if (!j.scope) j.scope = m.scopes;
          await saveTokens(env, m.domain, m.label, j, now, m.client_id || null);
          token = j.access_token;
        } catch {
          if (m.expires_at <= now) continue; // expired and couldn't be renewed: skip this shop for now
        }
      } else if (m.expires_at && m.expires_at <= now) continue;
      out.push({ domain: m.domain, token, label: m.label, canAuth: true, published: true, connected: true, clientId: "", clientSecret: "", webhookSecret: (app && app.secret) || env.SHOPIFY_CLIENT_SECRET || "" });
    } catch { /* an unreadable row never stops the other shops */ }
  }
  return out;
}

// Reads every Shopify shop: the ones that connected themselves plus any set up in the server settings. opts.only reads just one shop.
export async function syncAllShopify(env, opts = {}) {
  if (env.RELAY_DB) await ensureSquareMerchantSchema(env.RELAY_DB); // adds the shop-name and picture columns if missing
  const connected = await listConnectedShopifyStores(env, opts).catch(() => []);
  if (!connected.length && !getShopifyStores(env).some(s => s.canAuth)) return null;
  return syncShopifyCatalogues(env, connected, { only: opts.only });
}

// Shops whose products Relay may show: shops that connected themselves, plus server-configured shops marked public. No tokens.
export async function shopifyShopsForDisplay(env) {
  const byDomain = new Map();
  for (const s of getShopifyStores(env)) if (s.published) byDomain.set(s.domain, { domain: s.domain, label: s.label });
  if (env.RELAY_DB) {
    try {
      await ensureShopifyShopSchema(env.RELAY_DB);
      for (const r of ((await env.RELAY_DB.prepare("SELECT domain, label FROM shopify_shops ORDER BY created_at").all()).results || []))
        byDomain.set(r.domain, { domain: r.domain, label: r.label, connected: true });
    } catch { /* table not reachable: show configured shops only */ }
  }
  return [...byDomain.values()];
}

// Used by shopify-embedded.js (Relay inside Shopify admin).
export { appForShop, shopInfo, saveTokens, tokenRequest, recordHooks };
