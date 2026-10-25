// "Connect with Square": any Square seller (Sandbox for now) can approve Relay to read their catalogue, and Relay then reads every connected shop.
// What is stored per shop: the shop's id, its display name and the access/refresh tokens, encrypted with a key derived from AUTH_SECRET.
// Tokens never reach the browser. The only scopes asked for are read-only: items, inventory and the shop's name.
import { ensureOnce } from "./once.js";
import { wrapKey } from "./push.js";
import { issueRetailerKey } from "./retailer.js";
import { squareHost, squareAppId } from "./square-env.js";

const SCOPES = "ITEMS_READ INVENTORY_READ MERCHANT_PROFILE_READ";
const DASHBOARD_BASE = "https://zzmm92nr59-cloud.github.io/instant-refund-prototype/";
const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));

export function ensureSquareMerchantSchema(db) {
  return ensureOnce(db, "square-merchants", async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS square_merchants (merchant_id TEXT PRIMARY KEY, label TEXT NOT NULL, access_iv TEXT NOT NULL, access_data TEXT NOT NULL,
      refresh_iv TEXT, refresh_data TEXT, expires_at INTEGER, created_at INTEGER NOT NULL)`).run();
    const cols = ((await db.prepare("PRAGMA table_info(retailer_catalog_items)").all()).results || []).map(c => c.name);
    if (!cols.includes("store_label")) await db.prepare("ALTER TABLE retailer_catalog_items ADD COLUMN store_label TEXT").run();
    if (!cols.includes("image_url")) await db.prepare("ALTER TABLE retailer_catalog_items ADD COLUMN image_url TEXT").run();
  });
}

async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await wrapKey(env), enc.encode(text)));
  return { iv: b64u(iv), data: b64u(data) };
}
async function open(env, iv, data) {
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await wrapKey(env), unb64u(data)));
}
async function hmac(env, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode("relay-square-state:" + env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text))));
}
// The first letter of the state says where to go afterwards: "d" = the shop's Relay dashboard, "c" = a plain "connected" page.
async function makeState(env, now, purpose = "c") {
  const body = purpose + b64u(crypto.getRandomValues(new Uint8Array(12))) + "." + (now + 15 * 60 * 1000);
  return body + "." + await hmac(env, body);
}
async function goodState(env, state, now) {
  const parts = String(state || "").split(".");
  if (parts.length !== 3) return false;
  const body = parts[0] + "." + parts[1];
  return parts[2] === await hmac(env, body) && Number(parts[1]) > now;
}
const page = (title, text, status = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:16px system-ui;max-width:520px;margin:12vh auto;padding:0 20px;color:#141827"><h1 style="font-size:24px">${title}</h1><p>${text}</p>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function tokenCall(env, body, f) {
  const r = await f(squareHost(env) + "/oauth2/token", { method: "POST", headers: { "content-type": "application/json", "Square-Version": "2026-09-16" },
    body: JSON.stringify({ client_id: squareAppId(env), client_secret: env.SQUARE_APPLICATION_SECRET, ...body }), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("Square token step failed (" + r.status + " " + (j.errors && j.errors[0] && j.errors[0].code || "unknown") + ")");
  return j;
}

// The default shop (the key already stored on the server) plus every connected shop, ready to read.
export async function listSquareAccounts(env, o = {}) {
  const f = o.fetchImpl || ((...a) => fetch(...a)), now = o.now || Date.now();
  const out = [];
  if (env.SQUARE_ACCESS_TOKEN) out.push({ id: "default", label: env.SQUARE_DEFAULT_LABEL || "Relay Demo Store", token: env.SQUARE_ACCESS_TOKEN });
  if (!env.RELAY_DB || !env.AUTH_SECRET) return out;
  await ensureSquareMerchantSchema(env.RELAY_DB);
  let rows = ((await env.RELAY_DB.prepare("SELECT * FROM square_merchants ORDER BY created_at").all()).results || []);
  // If a shop was connected that is really the default shop, read it once (under the default shop's name).
  if (env.SQUARE_ACCESS_TOKEN && rows.length) {
    try {
      const r = await f(squareHost(env) + "/v2/merchants/me", { headers: { Authorization: "Bearer " + env.SQUARE_ACCESS_TOKEN, "Square-Version": "2026-09-16" }, signal: AbortSignal.timeout(15000) });
      const me = (await r.json()).merchant;
      if (me && me.id) rows = rows.filter(m => m.merchant_id !== me.id);
    } catch { /* if the default shop can't be identified, nothing is dropped */ }
  }
  for (const m of rows) {
    try {
      let token = await open(env, m.access_iv, m.access_data);
      if (m.refresh_data && m.expires_at && m.expires_at - now < 5 * 86400000 && env.SQUARE_APPLICATION_SECRET) {
        try {
          const j = await tokenCall(env, { grant_type: "refresh_token", refresh_token: await open(env, m.refresh_iv, m.refresh_data) }, f);
          token = j.access_token;
          const a = await seal(env, j.access_token), r = j.refresh_token ? await seal(env, j.refresh_token) : null;
          await env.RELAY_DB.prepare("UPDATE square_merchants SET access_iv = ?, access_data = ?, refresh_iv = COALESCE(?, refresh_iv), refresh_data = COALESCE(?, refresh_data), expires_at = ? WHERE merchant_id = ?")
            .bind(a.iv, a.data, r && r.iv, r && r.data, j.expires_at ? Date.parse(j.expires_at) : null, m.merchant_id).run();
        } catch { /* keep using the current token until it really stops working */ }
      }
      out.push({ id: m.merchant_id, label: m.label, token });
    } catch { /* an unreadable row is skipped, never fatal for the other shops */ }
  }
  return out;
}

export async function handleSquareConnect(request, env, url, o = {}) {
  const path = url.pathname;
  if (!path.startsWith("/relay/square/")) return null;
  const now = o.now || Date.now(), f = o.fetchImpl || ((...a) => fetch(...a));
  if (!env.RELAY_DB || !env.AUTH_SECRET || String(env.AUTH_SECRET).length < 16) return page("Not available yet", "Relay's server is not fully set up for connecting shops.", 503);
  await ensureSquareMerchantSchema(env.RELAY_DB);
  if (path === "/relay/square/connect" && request.method === "GET") {
    const state = await makeState(env, now, url.searchParams.get("for") === "dashboard" ? "d" : "c");
    if (!squareAppId(env)) return page("Almost there", "Relay is missing its Square app details on the server, so it can't connect Square shops yet.", 503);
    const to = squareHost(env) + "/oauth2/authorize?client_id=" + encodeURIComponent(squareAppId(env)) + "&scope=" + encodeURIComponent(SCOPES).replace(/%20/g, "+") +
      "&session=false&state=" + encodeURIComponent(state);
    return Response.redirect(to, 302);
  }
  if (path === "/relay/square/merchants" && request.method === "GET") {
    const rows = ((await env.RELAY_DB.prepare("SELECT merchant_id, label, created_at FROM square_merchants ORDER BY created_at").all()).results || []);
    return Response.json({ merchants: rows.map(r => ({ id: r.merchant_id.slice(0, 4) + "…", label: r.label, connectedAt: r.created_at })), defaultShop: Boolean(env.SQUARE_ACCESS_TOKEN),
      oauthReady: Boolean(env.SQUARE_APPLICATION_SECRET) }, { headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } });
  }
  if (path === "/relay/square/oauth/callback" && request.method === "GET") {
    if (url.searchParams.get("error")) return page("Not connected", "The shop did not approve access, so nothing was connected.", 400);
    if (!(await goodState(env, url.searchParams.get("state"), now))) return page("That link has expired", "Please start again from the Connect with Square link.", 400);
    const code = url.searchParams.get("code");
    if (!code || code.length > 300) return page("Not connected", "Square did not send an approval code.", 400);
    if (!env.SQUARE_APPLICATION_SECRET) return page("Almost there", "Relay is missing the Square application secret on its server, so it cannot finish connecting yet.", 503);
    try {
      const j = await tokenCall(env, { grant_type: "authorization_code", code }, f);
      const merchantId = String(j.merchant_id || "");
      if (!/^[A-Za-z0-9_-]{5,64}$/.test(merchantId)) throw new Error("Square did not say which shop this is");
      let label = "Square shop", currency = null;
      try {
        const r = await f(squareHost(env) + "/v2/merchants/" + encodeURIComponent(merchantId), { headers: { Authorization: "Bearer " + j.access_token, "Square-Version": "2026-09-16" }, signal: AbortSignal.timeout(15000) });
        const m = (await r.json()).merchant; if (m && m.business_name) label = String(m.business_name).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80) || label;
        if (m && typeof m.currency === "string" && /^[A-Z]{3}$/.test(m.currency)) currency = m.currency;
      } catch { /* the shop keeps a generic name */ }
      // Relay is for UK shops that sell in pounds. A shop in another currency is turned away and nothing is stored.
      if (currency && currency !== "GBP")
        return page("Relay is for UK shops", esc(label) + " sells in " + esc(currency) + ". Relay only works with UK shops that sell in pounds (£), so nothing was connected.", 400);
      const a = await seal(env, j.access_token), r = j.refresh_token ? await seal(env, j.refresh_token) : { iv: null, data: null };
      await env.RELAY_DB.prepare(`INSERT INTO square_merchants (merchant_id, label, access_iv, access_data, refresh_iv, refresh_data, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(merchant_id) DO UPDATE SET label = excluded.label, access_iv = excluded.access_iv, access_data = excluded.access_data, refresh_iv = excluded.refresh_iv, refresh_data = excluded.refresh_data, expires_at = excluded.expires_at`)
        .bind(merchantId, label, a.iv, a.data, r.iv, r.data, j.expires_at ? Date.parse(j.expires_at) : null, now).run();
      if (typeof o.afterConnect === "function") o.afterConnect(merchantId);
      // A fresh key for the shop's own Relay dashboard. It travels in the page address after "#", which browsers never send to any server.
      const key = await issueRetailerKey(env, { provider: "square", shopRef: merchantId, storeLabel: label }, now);
      const dash = (env.RELAY_APP_URL || DASHBOARD_BASE).replace(/\/?$/, "/") + "retailer.html#key=" + encodeURIComponent(key);
      if (String(url.searchParams.get("state") || "").startsWith("d")) return new Response(null, { status: 302, headers: { location: dash, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
      return page("Connected", `${esc(label)} is connected to Relay. Relay can read this shop's products and prices (read-only).</p>
<p><a href="${esc(dash)}" rel="noreferrer" style="display:inline-block;background:#141827;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none">Open your Relay shop dashboard</a></p>
<p style="color:#5b6275;font-size:14px">See which of your items shoppers are watching and send them offers. Keep this link private: anyone with it can see your shop's figures.`);
    } catch (e) {
      return page("Could not connect", esc(String(e && e.message || e).slice(0, 160)), 502);
    }
  }
  return null;
}
