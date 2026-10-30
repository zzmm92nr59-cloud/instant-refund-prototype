// Relay inside Shopify admin ("embedded app").
//
// Shopify opens Relay's App URL (/relay/shopify/app) in a frame inside the shop's admin. That page is the same shop
// dashboard as retailer.html, with Shopify's App Bridge added. App Bridge gives the page a short-lived ID token (a JWT
// signed by Shopify with the app's secret, valid for about a minute) that says which shop is looking.
//
// The page sends that token to /relay/shopify/embedded/session. Relay checks the signature and claims, then:
//   - if the shop isn't connected yet (or its keys have stopped working), swaps the ID token for the shop's own access
//     keys through Shopify's "token exchange" (no extra approval screen: the shop approved Relay when installing it),
//     turns away shops that don't sell in pounds, saves the keys encrypted and asks Shopify for webhooks;
//   - hands the page a dashboard key for that shop, exactly like signing in from the Relay website does.
// The dashboard key never leaves the frame; Shopify's tokens never reach the browser.
//
// The page is only allowed to be framed by the shop's own admin (Content-Security-Policy frame-ancestors).
import { shopifyApps, normaliseShop, ensureShopifyShopSchema, appForShop, shopInfo, saveTokens, tokenRequest,
  registerShopifyWebhooks, recordHooks, listConnectedShopifyStores, hasAllScopes } from "./shopify-connect.js";
import { issueRetailerKey } from "./retailer.js";

const enc = new TextEncoder(), dec = new TextDecoder();
const DASHBOARD_PAGE = "https://zzmm92nr59-cloud.github.io/instant-refund-prototype/retailer.html";
const RETRY = { "X-Shopify-Retry-Invalid-Session-Request": "1" };
const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - String(s).length % 4) % 4)), c => c.charCodeAt(0));
const escAttr = (t) => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Checks a Shopify ID token. Returns { shop, app, sub } or null. Never trusts anything before the signature checks out.
export async function verifyIdToken(env, token, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || token.length > 4000) return null;
  let header, payload;
  try { header = JSON.parse(dec.decode(unb64u(parts[0]))); payload = JSON.parse(dec.decode(unb64u(parts[1]))); } catch { return null; }
  if (!header || header.alg !== "HS256" || !payload || typeof payload !== "object") return null;
  const app = shopifyApps(env).find(a => a.id === payload.aud);
  if (!app) return null;
  const key = await crypto.subtle.importKey("raw", enc.encode(app.secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let sig; try { sig = unb64u(parts[2]); } catch { return null; }
  if (!(await crypto.subtle.verify("HMAC", key, sig, enc.encode(parts[0] + "." + parts[1])))) return null;
  const t = Math.floor(now / 1000), skew = 10;
  if (!(Number(payload.exp) > t - skew) || !(Number(payload.nbf) <= t + skew)) return null;
  let destHost, issHost;
  try { destHost = new URL(payload.dest).hostname; issHost = new URL(payload.iss).hostname; } catch { return null; }
  const shop = normaliseShop(destHost);
  if (!shop || shop !== destHost || issHost !== destHost) return null;
  if (app.shop && app.shop !== shop) return null; // a pilot app only ever works for its own shop
  return { shop, app, sub: payload.sub ? String(payload.sub) : null };
}

// Swaps the ID token for the shop's offline access keys (expiring, as Shopify requires for new apps).
async function exchange(shop, app, idToken, f) {
  return tokenRequest(shop, { client_id: app.id, client_secret: app.secret, grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: idToken, subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token", expiring: "1" }, f);
}

async function startSession(request, env, url, o) {
  const now = o.now || Date.now(), f = o.fetchImpl || ((...a) => fetch(...a));
  const m = /^Bearer ([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)$/.exec(request.headers.get("Authorization") || "");
  const who = m ? await verifyIdToken(env, m[1], now) : null;
  if (!who) return json({ error: "invalid_session" }, 401, RETRY);
  const { shop, app } = who, db = env.RELAY_DB;
  await ensureShopifyShopSchema(db);
  const row = await db.prepare("SELECT label, client_id, scopes FROM shopify_shops WHERE domain = ?").bind(shop).first();
  // Already connected through this app, with keys Relay can still use and that cover every permission Relay now needs:
  // nothing to exchange. Otherwise (first visit, or the shop has just approved a new permission) the keys are fetched again
  // and any Shopify notifications Relay doesn't have yet are set up. A shop connected before Relay recorded the app
  // (client_id empty) came through the main app.
  const sameApp = Boolean(row) && (row.client_id ? row.client_id === app.id : !app.shop);
  const usable = sameApp && hasAllScopes(row.scopes) && (await listConnectedShopifyStores(env, { now, fetchImpl: f }).catch(() => [])).some(s => s.domain === shop);
  let label = row && row.label;
  if (!usable) {
    let j;
    try { j = await exchange(shop, app, m[1], f); }
    catch { return json({ error: "invalid_session" }, 401, RETRY); }
    if (!String(j.scope || "").split(",").map(s => s.trim()).some(s => s === "read_products" || s === "write_products"))
      return json({ error: "missing_permission" }, 403);
    const info = await shopInfo(shop, j.access_token, f);
    if (info.currency && info.currency !== "GBP") return json({ error: "not_gbp", currency: info.currency }, 403);
    label = info.name;
    await saveTokens(env, shop, label, j, now, app.id);
    try { await recordHooks(env, shop, await registerShopifyWebhooks(shop, j.access_token, url.origin, f)); }
    catch (e) { await recordHooks(env, shop, { created: 0, alreadyThere: 0, failed: [String(e && e.message || e).slice(0, 120)] }); }
    if (typeof o.afterConnect === "function") o.afterConnect(shop);
  }
  const key = await issueRetailerKey(env, { provider: "shopify", shopRef: shop, storeLabel: label || shop }, now);
  return json({ key, store: label || shop, connectedNow: !usable });
}

// The page Shopify frames. It is the normal dashboard with App Bridge added and the shop's frame permission set.
async function appPage(env, url, o) {
  const shop = normaliseShop(url.searchParams.get("shop"));
  if (!shop || url.searchParams.get("shop") !== shop) return new Response("Open Relay from the Apps section of your Shopify admin.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  const app = appForShop(env, shop);
  if (!app) return new Response("Relay isn't set up for this shop yet.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  const f = o.fetchImpl || ((...a) => fetch(...a));
  let html;
  try {
    const r = await f(o.dashboardUrl || DASHBOARD_PAGE, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) throw new Error("dashboard " + r.status);
    html = await r.text();
  } catch { return new Response("Relay couldn't load just now. Please try again in a minute.", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } }); }
  // App Bridge must load before the dashboard's own script; the shop address is only a hint (the session check decides).
  const inject = `<meta name="shopify-api-key" content="${escAttr(app.id)}">` +
    `<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>` +
    `<script>window.RELAY_EMBEDDED={shop:${JSON.stringify(shop)}};</script>`;
  html = html.includes("<head>") ? html.replace("<head>", "<head>" + inject) : inject + html;
  return new Response(html, { status: 200, headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
    "content-security-policy": `frame-ancestors https://${shop} https://admin.shopify.com;` } });
}

export async function handleShopifyEmbedded(request, env, url, o = {}) {
  if (url.pathname === "/relay/shopify/app" && request.method === "GET") return appPage(env, url, o);
  if (url.pathname === "/relay/shopify/embedded/session" && request.method === "POST") {
    if (!env.RELAY_DB || !env.AUTH_SECRET || !shopifyApps(env).length) return json({ error: "not_available" }, 503);
    return startSession(request, env, url, o);
  }
  return null;
}
