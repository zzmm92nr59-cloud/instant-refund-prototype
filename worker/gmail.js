// Gmail connection for Relay: consent record, Google sign-in (OAuth), encrypted token,
// and a scan that reads ONLY order-confirmation / receipt emails.
//
// Rules (do not weaken):
//  * No Gmail access without a recorded consent to the CURRENT wording. The wording
//    shown to the shopper is served from here, so what is recorded is what was shown.
//  * Read-only scope. Relay never sends, deletes or changes mail.
//  * The Google refresh token is stored encrypted (AES-GCM, key derived from AUTH_SECRET).
//  * Full emails are never stored. Only the extracted store/order/date/total/items.
//  * The OAuth "state" is single-use, expires in 10 minutes and is bound to the shopper
//    who started the connection, so a callback can never attach Gmail to someone else.
//  * Everything captured is shopper-supplied evidence: refundEligible is always false.
//  * Disconnect revokes the token at Google and deletes the token and captured receipts.
import { parseReceiptEmail, parseReturnEmail, extractProductImageUrls } from "./receipt-parser.js";

export const CONSENT_VERSION = "2026-10-v4";
export const CONSENT_TEXT = [
  "To work, Relay needs to see your online and in-store receipts.",
  "With your permission, Relay reads your Gmail in read-only mode and looks only for order confirmations, receipts and return emails from the past year or so.",
  "From each one it keeps the store, order number, date, total and items, plus return details (deadline, how to return, return ID, any return link), one small product photo from the email if there is one, and a link back to the original email so you can open it yourself. It does not keep the email itself.",
  "If you ask for a return reminder on an item, Relay emails you once, at your sign-in address, a few days before its deadline. It sends nothing otherwise.",
  "Relay never sends email from your Gmail, never deletes or changes anything in your inbox, and never sells or shares what it finds.",
  "You can disconnect Gmail and delete everything Relay has captured at any time, in one tap.",
  "What Relay finds comes from your email, not from the store, so it can track your purchases but cannot start an automatic refund on its own."
];

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const STATE_TTL_MS = 10 * 60 * 1000;
// A Worker invocation can only make so many outside calls, so one scan reads a limited number
// of new emails and says if there are more. The app keeps asking until it is told there are none.
const PAGE_SIZE = 100, MAX_PAGES = 4, MAX_FETCH_PER_SCAN = 12;
// Bump when the receipt reader improves: older captures are re-read once with the new reader.
const PARSER_VERSION = 5;
// The mailbox is read one date window at a time, newest first, so old receipts are reached
// however busy the inbox is. The app passes back the cursor it is given.
const LOOKBACK_DAYS = 500, WINDOW_DAYS = 30, MAX_WINDOWS_PER_CALL = 2, DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_TERMS =
  '(category:purchases OR subject:("order confirmation" OR "order confirmed" OR "your order" OR receipt OR "thank you for your order" OR "thanks for your order" OR return OR "QR code"))';
const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "/");
const fromYmd = t => Date.parse(t.replace(/\//g, "-") + "T00:00:00Z");
const windowQuery = (after, before) => "after:" + after + " before:" + before + " " + SEARCH_TERMS;
const encoder = new TextEncoder();

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function unb64(text) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
function unb64url(text) {
  const s = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s + "=".repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
}
async function tokenKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode("relay-gmail-token:" + env.AUTH_SECRET));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(env), encoder.encode(plain));
  return { iv: b64(iv), data: b64(new Uint8Array(data)) };
}
async function decrypt(env, iv, data) {
  const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await tokenKey(env), unb64(data));
  return new TextDecoder().decode(out);
}

export function gmailConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
function redirectUri(env, url) {
  return env.GOOGLE_REDIRECT_URI || `${url.origin}/relay/gmail/callback`;
}
function json(body, status = 200, cors = {}) {
  return Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
}

export async function ensureGmailTables(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS shopper_consents (
       shopper_id TEXT NOT NULL, version TEXT NOT NULL, text_hash TEXT NOT NULL,
       accepted_at INTEGER NOT NULL, withdrawn_at INTEGER, PRIMARY KEY (shopper_id, version))`,
    `CREATE TABLE IF NOT EXISTS gmail_connections (
       shopper_id TEXT PRIMARY KEY, google_email TEXT, token_iv TEXT NOT NULL, token_data TEXT NOT NULL,
       connected_at INTEGER NOT NULL, last_scan_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS gmail_oauth_states (
       state_hash TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, created_at INTEGER NOT NULL,
       expires_at INTEGER NOT NULL, used_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS captured_receipts (
       id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, message_ref TEXT NOT NULL, status TEXT NOT NULL,
       details TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (shopper_id, message_ref))`,
    `CREATE INDEX IF NOT EXISTS idx_captured_receipts_shopper ON captured_receipts(shopper_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS receipt_images (
       receipt_id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS return_reminders (
       receipt_id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, deadline TEXT NOT NULL, remind_at INTEGER NOT NULL,
       title TEXT NOT NULL, sent_at INTEGER)`
  ];
  for (const sql of statements) await db.prepare(sql).run();
}

// Statements that erase everything Gmail-related for a shopper.
export function gmailDeleteStatements(db, shopperId) {
  return [
    db.prepare("DELETE FROM captured_receipts WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM receipt_images WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM return_reminders WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM gmail_connections WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM gmail_oauth_states WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM shopper_consents WHERE shopper_id = ?").bind(shopperId)
  ];
}

async function hasConsent(db, shopperId) {
  const row = await db.prepare(
    "SELECT 1 AS ok FROM shopper_consents WHERE shopper_id = ? AND version = ? AND withdrawn_at IS NULL")
    .bind(shopperId, CONSENT_VERSION).first();
  return Boolean(row);
}

async function accessToken(env, refreshToken, fetchImpl) {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: "refresh_token"
    })
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body && body.access_token ? body.access_token : null;
}

async function disconnect(env, shopperId, fetchImpl, { withdraw }) {
  const row = await env.RELAY_DB.prepare(
    "SELECT token_iv, token_data FROM gmail_connections WHERE shopper_id = ?").bind(shopperId).first();
  let revoked = false;
  if (row) {
    try {
      const refresh = await decrypt(env, row.token_iv, row.token_data);
      const res = await fetchImpl("https://oauth2.googleapis.com/revoke", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refresh })
      });
      revoked = res.ok;
    } catch { revoked = false; }
  }
  const statements = [
    env.RELAY_DB.prepare("DELETE FROM captured_receipts WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM receipt_images WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM return_reminders WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM gmail_connections WHERE shopper_id = ?").bind(shopperId)
  ];
  if (withdraw) statements.push(env.RELAY_DB.prepare(
    "UPDATE shopper_consents SET withdrawn_at = ? WHERE shopper_id = ? AND withdrawn_at IS NULL").bind(Date.now(), shopperId));
  await env.RELAY_DB.batch(statements);
  return { deleted: true, revokedAtGoogle: revoked };
}

const MAX_IMAGES_PER_SCAN = 4;
const IMAGE_MAX_BYTES = 400000, IMAGE_MIN_BYTES = 2000;
function b64Chunked(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(out);
}
function imageTypeOf(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}
// Downloads one product photo. The file must really be a JPEG, PNG or WebP of a sensible size.
async function fetchProductImage(fetchImpl, urls) {
  for (const u of urls) {
    try {
      const res = await fetchImpl(u, { headers: { Accept: "image/*" }, redirect: "follow" });
      if (!res.ok || (res.url && !String(res.url).startsWith("https://"))) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < IMAGE_MIN_BYTES || bytes.length > IMAGE_MAX_BYTES) continue;
      const type = imageTypeOf(bytes);
      if (type) return { type, data: b64Chunked(bytes) };
    } catch { /* try the next one */ }
  }
  return null;
}

async function scan(env, shopperId, fetchImpl, now, cursorIn) {
  const row = await env.RELAY_DB.prepare(
    "SELECT token_iv, token_data FROM gmail_connections WHERE shopper_id = ?").bind(shopperId).first();
  if (!row) return { status: 409, body: { error: "gmail_not_connected" } };
  const refresh = await decrypt(env, row.token_iv, row.token_data);
  const token = await accessToken(env, refresh, fetchImpl);
  if (!token) return { status: 401, body: { error: "gmail_reconnect_needed" } };
  const auth = { Authorization: "Bearer " + token };
  let added = 0, skipped = 0, ignored = 0, updated = 0, fetched = 0, imagesTried = 0;
  const limitDay = ymd(now - LOOKBACK_DAYS * DAY_MS);
  let before = /^\d{4}\/\d{2}\/\d{2}$/.test(cursorIn || "") && cursorIn <= ymd(now + DAY_MS) ? cursorIn : ymd(now + DAY_MS);
  let incomplete = false, windows = 0;
  while (windows < MAX_WINDOWS_PER_CALL && before > limitDay) {
    const afterD = ymd(fromYmd(before) - WINDOW_DAYS * DAY_MS);
    incomplete = false;
    // Gmail lists newest first, a page at a time. Read several pages so older receipts are reachable.
    const ids = [];
    let pageToken = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const list = await fetchImpl(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=" + PAGE_SIZE + "&q=" + encodeURIComponent(windowQuery(afterD, before)) +
        (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""), { headers: auth });
      if (!list.ok) { if (page === 0) return { status: 502, body: { error: "gmail_unavailable" } }; break; }
      const data = await list.json().catch(() => ({}));
      for (const m of data.messages || []) if (m && typeof m.id === "string" && /^[A-Za-z0-9]{6,40}$/.test(m.id)) ids.push(m.id);
      pageToken = typeof data.nextPageToken === "string" && /^[A-Za-z0-9_=-]{1,300}$/.test(data.nextPageToken) ? data.nextPageToken : "";
      if (!pageToken) break;
    }
    // Lookups are done in groups to stay under the database's per-query limit.
    const refs = await Promise.all(ids.map(id => sha256Hex("gmail:" + id)));
    const known = new Map();
    for (let i = 0; i < refs.length; i += 90) {
      const chunk = refs.slice(i, i + 90);
      const found = await env.RELAY_DB.prepare(
        `SELECT id, message_ref, status, details FROM captured_receipts WHERE shopper_id = ? AND message_ref IN (${chunk.map(() => "?").join(",")})`)
        .bind(shopperId, ...chunk).all();
      for (const r of found.results || []) known.set(r.message_ref, r);
    }
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], ref = refs[i];
      const seen = known.get(ref);
      // Anything read by an older version of the reader is read once more.
      const stale = seen && JSON.parse(seen.details).parserVersion !== PARSER_VERSION;
      if (seen && !stale) { skipped++; continue; }
      if (fetched >= MAX_FETCH_PER_SCAN) { incomplete = true; continue; }
      fetched++;
      const res = await fetchImpl(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=raw`, { headers: auth });
      if (!res.ok) continue;
      const raw = (await res.json().catch(() => ({}))).raw;
      if (typeof raw !== "string") continue;
      const rawText = new TextDecoder().decode(unb64url(raw));
      let details, status = "pending", imageToStore = null;
      const receipt = parseReceiptEmail(rawText);
      if (receipt.ok) {
        // Keep only extracted fields. The email text is dropped here.
        details = {
          kind: "receipt", gmailId: id,
          retailer: receipt.retailer, orderRef: receipt.orderRef, orderDate: receipt.orderDate, currency: receipt.currency,
          totalPence: receipt.totalPence, items: receipt.items, confidence: receipt.confidence,
          needsShopperConfirmation: receipt.needsShopperConfirmation, method: receipt.method, returns: receipt.returns,
          source: "shopper_email", refundEligible: false, parserVersion: PARSER_VERSION
        };
      } else {
        const ret = parseReturnEmail(rawText);
        if (ret.ok) {
          details = {
            kind: "return_instructions", gmailId: id,
            retailer: ret.retailer, orderRef: ret.orderRef, orderDate: ret.orderDate, returnId: ret.returnId,
            deadline: ret.deadline, carrier: ret.carrier, steps: ret.steps, qrMentioned: ret.qrMentioned,
            estimatedRefundPence: ret.estimatedRefundPence, currency: ret.currency, trackUrl: ret.trackUrl,
            source: "shopper_email", refundEligible: false, parserVersion: PARSER_VERSION
          };
        } else {
          // Remember that this email is not one of ours so it is never fetched again.
          details = { kind: "not_receipt", parserVersion: PARSER_VERSION };
          status = "not_receipt";
          ignored++;
        }
      }
      // One small product photo per receipt, fetched at most once.
      const prev = seen ? JSON.parse(seen.details) : {};
      const receiptId = seen ? seen.id : crypto.randomUUID();
      if (details.kind === "receipt") {
        details.hasImage = Boolean(prev.hasImage); details.imageTried = Boolean(prev.imageTried);
        if (!details.imageTried && imagesTried < MAX_IMAGES_PER_SCAN) {
          imagesTried++;
          const urls = extractProductImageUrls(rawText);
          const img = urls.length ? await fetchProductImage(fetchImpl, urls) : null;
          details.imageTried = true;
          if (img) {
            details.hasImage = true;
            imageToStore = { receiptId, ...img };
          }
        }
      }
      if (seen) {
        // The shopper's confirm/dismiss choice lives in the status column and is kept.
        const keep = seen.status !== "not_receipt" && status !== "not_receipt" ? seen.status : status;
        await env.RELAY_DB.prepare("UPDATE captured_receipts SET details = ?, status = ? WHERE shopper_id = ? AND message_ref = ?")
          .bind(JSON.stringify(details), keep, shopperId, ref).run();
        if (imageToStore) await saveImage(env, shopperId, imageToStore, now);
        if (status !== "not_receipt") updated++;
        continue;
      }
      await env.RELAY_DB.prepare(
        "INSERT OR IGNORE INTO captured_receipts (id,shopper_id,message_ref,status,details,created_at) VALUES (?,?,?,?,?,?)")
        .bind(receiptId, shopperId, ref, status, JSON.stringify(details), now).run();
      if (imageToStore) await saveImage(env, shopperId, imageToStore, now);
      if (status !== "not_receipt") added++;
    }
    windows++;
    if (incomplete) break;       // stay on this window until every email in it is read
    before = afterD;
    if (fetched >= MAX_FETCH_PER_SCAN) break;
  }
  const more = incomplete || before > limitDay;
  if (!more) await env.RELAY_DB.prepare("UPDATE gmail_connections SET last_scan_at = ? WHERE shopper_id = ?").bind(now, shopperId).run();
  return { status: 200, body: { ok: true, added, updated, alreadyCaptured: skipped, notReceipts: ignored, more, cursor: more ? before : null, scannedBack: before } };
}

async function saveImage(env, shopperId, img, now) {
  await env.RELAY_DB.prepare(
    "INSERT OR REPLACE INTO receipt_images (receipt_id,shopper_id,type,data,created_at) VALUES (?,?,?,?,?)")
    .bind(img.receiptId, shopperId, img.type, img.data, now).run();
}

async function listReceipts(env, shopperId) {
  const rows = await env.RELAY_DB.prepare(
    "SELECT id, status, details, created_at AS createdAt FROM captured_receipts WHERE shopper_id = ? AND status NOT IN ('dismissed','not_receipt') ORDER BY created_at DESC LIMIT 300")
    .bind(shopperId).all();
  const all = (rows.results || []).map(r => ({ id: r.id, status: r.status, createdAt: r.createdAt, ...JSON.parse(r.details) }));
  const orders = all.filter(x => x.kind !== "return_instructions");
  const plans = all.filter(x => x.kind === "return_instructions");
  const byOrder = new Map(orders.filter(o => o.orderRef).map(o => [o.orderRef, o]));
  const gone = await env.RELAY_DB.prepare(
    "SELECT details FROM captured_receipts WHERE shopper_id = ? AND status = 'dismissed'").bind(shopperId).all();
  const dismissedRefs = new Set((gone.results || []).map(r => JSON.parse(r.details).orderRef).filter(Boolean));
  const loose = [];
  for (const p of plans) {
    if (p.orderRef && dismissedRefs.has(p.orderRef)) continue;
    const o = p.orderRef && byOrder.get(p.orderRef);
    if (o) { o.returnPlan = p; } else loose.push(p);
  }
  const rem = await env.RELAY_DB.prepare(
    "SELECT receipt_id AS id, sent_at AS sentAt FROM return_reminders WHERE shopper_id = ?").bind(shopperId).all();
  const remById = new Map((rem.results || []).map(r => [r.id, r]));
  // A return whose original order email was not found still gets its own card.
  const cards = [...orders, ...loose];
  for (const c of cards) { const r = remById.get(c.id); c.reminder = r ? (r.sentAt ? "sent" : "on") : "off"; }
  return cards.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
}

// Google redirects the browser here. No bearer token is available, so the single-use
// state (bound to the shopper who began the flow) is the only thing that identifies them.
export async function handleGmailCallback(request, env, url, opts) {
  const appUrl = String(env.RELAY_APP_URL || opts.appUrl).split("#")[0];
  const back = result => Response.redirect(appUrl + "#gmail=" + result, 302);
  if (!gmailConfigured(env)) return back("not_configured");
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !/^[A-Za-z0-9_-]{43}$/.test(state)) return back("failed");
  const claimed = await env.RELAY_DB.prepare(
    `UPDATE gmail_oauth_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING shopper_id`)
    .bind(opts.now, await sha256Hex(state), opts.now).first();
  if (!claimed) return back("failed");
  if (!(await hasConsent(env.RELAY_DB, claimed.shopper_id))) return back("consent_needed");
  const res = await opts.fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(env, url), grant_type: "authorization_code"
    })
  });
  const tokens = res.ok ? await res.json().catch(() => null) : null;
  if (!tokens || !tokens.refresh_token) return back("failed");
  if (!String(tokens.scope || "").split(" ").includes(SCOPE)) return back("failed");
  let googleEmail = null;
  try {
    const p = await opts.fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: "Bearer " + tokens.access_token } });
    if (p.ok) googleEmail = (await p.json()).emailAddress || null;
  } catch { googleEmail = null; }
  const enc = await encrypt(env, tokens.refresh_token);
  await env.RELAY_DB.prepare(
    `INSERT INTO gmail_connections (shopper_id,google_email,token_iv,token_data,connected_at) VALUES (?,?,?,?,?)
     ON CONFLICT(shopper_id) DO UPDATE SET google_email=excluded.google_email, token_iv=excluded.token_iv,
       token_data=excluded.token_data, connected_at=excluded.connected_at, last_scan_at=NULL`)
    .bind(claimed.shopper_id, googleEmail, enc.iv, enc.data, opts.now).run();
  return back("connected");
}

// Routes for a signed-in shopper. Returns a Response, or null if the path is not ours.
export async function handleGmailRoute(request, env, url, cors, shopper, opts) {
  const path = url.pathname;
  const m = request.method;
  if (path === "/relay/my/consent" && m === "GET") {
    return json({ version: CONSENT_VERSION, text: CONSENT_TEXT, accepted: await hasConsent(env.RELAY_DB, shopper.id),
      gmailAvailable: gmailConfigured(env) }, 200, cors);
  }
  if (path === "/relay/my/consent" && m === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || body.version !== CONSENT_VERSION) return json({ error: "consent_version_mismatch" }, 400, cors);
    await env.RELAY_DB.prepare(
      `INSERT INTO shopper_consents (shopper_id,version,text_hash,accepted_at) VALUES (?,?,?,?)
       ON CONFLICT(shopper_id,version) DO UPDATE SET accepted_at=excluded.accepted_at, withdrawn_at=NULL, text_hash=excluded.text_hash`)
      .bind(shopper.id, CONSENT_VERSION, await sha256Hex(CONSENT_TEXT.join("\n")), opts.now).run();
    return json({ ok: true }, 200, cors);
  }
  if (path === "/relay/my/consent/withdraw" && m === "POST") {
    return json({ ok: true, ...(await disconnect(env, shopper.id, opts.fetchImpl, { withdraw: true })) }, 200, cors);
  }
  if (path === "/relay/my/gmail/connect" && m === "POST") {
    if (!gmailConfigured(env)) return json({ error: "gmail_not_configured" }, 503, cors);
    if (!(await hasConsent(env.RELAY_DB, shopper.id))) return json({ error: "consent_required" }, 403, cors);
    const state = randomToken();
    await env.RELAY_DB.prepare("DELETE FROM gmail_oauth_states WHERE expires_at <= ?").bind(opts.now).run();
    await env.RELAY_DB.prepare(
      "INSERT INTO gmail_oauth_states (state_hash,shopper_id,created_at,expires_at) VALUES (?,?,?,?)")
      .bind(await sha256Hex(state), shopper.id, opts.now, opts.now + STATE_TTL_MS).run();
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(env, url), response_type: "code", scope: SCOPE,
      access_type: "offline", prompt: "consent", include_granted_scopes: "false", state, login_hint: shopper.email
    });
    return json({ url: "https://accounts.google.com/o/oauth2/v2/auth?" + params }, 200, cors);
  }
  if (path === "/relay/my/gmail" && m === "GET") {
    const c = await env.RELAY_DB.prepare(
      "SELECT google_email AS googleEmail, connected_at AS connectedAt, last_scan_at AS lastScanAt FROM gmail_connections WHERE shopper_id = ?")
      .bind(shopper.id).first();
    return json({ connected: Boolean(c), ...(c || {}) }, 200, cors);
  }
  if (path === "/relay/my/gmail/scan" && m === "POST") {
    if (!(await hasConsent(env.RELAY_DB, shopper.id))) return json({ error: "consent_required" }, 403, cors);
    const sb = await request.json().catch(() => ({}));
    const r = await scan(env, shopper.id, opts.fetchImpl, opts.now, sb && typeof sb.cursor === "string" ? sb.cursor : "");
    return json(r.body, r.status, cors);
  }
  if (path === "/relay/my/gmail/disconnect" && m === "POST") {
    return json({ ok: true, ...(await disconnect(env, shopper.id, opts.fetchImpl, { withdraw: false })) }, 200, cors);
  }
  if (path === "/relay/my/receipts" && m === "GET") {
    return json({ receipts: await listReceipts(env, shopper.id) }, 200, cors);
  }
  const act = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/(confirm|dismiss)$/.exec(path);
  if (act && m === "POST") {
    const res = await env.RELAY_DB.prepare(
      "UPDATE captured_receipts SET status = ? WHERE id = ? AND shopper_id = ? RETURNING id")
      .bind(act[2] === "confirm" ? "confirmed" : "dismissed", act[1], shopper.id).first();
    return res ? json({ ok: true }, 200, cors) : json({ error: "not_found" }, 404, cors);
  }
  const img = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/image$/.exec(path);
  if (img && m === "GET") {
    const row = await env.RELAY_DB.prepare(
      "SELECT type, data FROM receipt_images WHERE receipt_id = ? AND shopper_id = ?").bind(img[1], shopper.id).first();
    if (!row) return json({ error: "not_found" }, 404, cors);
    return new Response(Uint8Array.from(atob(row.data), c => c.charCodeAt(0)), {
      status: 200, headers: { ...cors, "Content-Type": row.type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  }
  const rem = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/remind$/.exec(path);
  if (rem && m === "POST") {
    if (!(await hasConsent(env.RELAY_DB, shopper.id))) return json({ error: "consent_required" }, 403, cors);
    const body = await request.json().catch(() => ({}));
    const r = await setReminder(env, shopper.id, rem[1], body && body.on === false ? false : true, opts.now);
    return json(r.body, r.status, cors);
  }
  return null;
}

// ---- Return reminders ----------------------------------------------------------------
const DAY = 24 * 60 * 60 * 1000;
const REMIND_DAYS_BEFORE = 3;
const todayIso = now => new Date(now).toISOString().slice(0, 10);

async function setReminder(env, shopperId, receiptId, on, now) {
  if (!on) {
    await env.RELAY_DB.prepare("DELETE FROM return_reminders WHERE receipt_id = ? AND shopper_id = ?").bind(receiptId, shopperId).run();
    return { status: 200, body: { ok: true, reminder: "off" } };
  }
  const row = await env.RELAY_DB.prepare(
    "SELECT id, details FROM captured_receipts WHERE id = ? AND shopper_id = ? AND status NOT IN ('dismissed','not_receipt')")
    .bind(receiptId, shopperId).first();
  if (!row) return { status: 404, body: { error: "not_found" } };
  const d = JSON.parse(row.details);
  let deadline = d.kind === "return_instructions" ? d.deadline : null;
  if (!deadline && d.orderRef) {
    // A return email for the same order carries the exact date, so prefer it.
    const others = await env.RELAY_DB.prepare(
      "SELECT details FROM captured_receipts WHERE shopper_id = ? AND status NOT IN ('dismissed','not_receipt')").bind(shopperId).all();
    for (const o of others.results || []) {
      const od = JSON.parse(o.details);
      if (od.kind === "return_instructions" && od.orderRef === d.orderRef && od.deadline) deadline = od.deadline;
    }
  }
  deadline = deadline || (d.returns && d.returns.deadline) || null;
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return { status: 400, body: { error: "no_deadline" } };
  if (deadline < todayIso(now)) return { status: 400, body: { error: "deadline_passed" } };
  // 09:00 UTC, three days ahead of the deadline. If that is already past, send at the next opportunity.
  const remindAt = Math.max(Date.parse(deadline + "T09:00:00Z") - REMIND_DAYS_BEFORE * DAY, now);
  const who = (d.retailer && (d.retailer.name || d.retailer.domain)) || "your order";
  const item = d.items && d.items[0] && d.items[0].name;
  const title = (item ? who + ": " + item : who).slice(0, 120);
  await env.RELAY_DB.prepare(
    "INSERT OR REPLACE INTO return_reminders (receipt_id,shopper_id,deadline,remind_at,title,sent_at) VALUES (?,?,?,?,?,NULL)")
    .bind(receiptId, shopperId, deadline, remindAt, title).run();
  return { status: 200, body: { ok: true, reminder: "on", deadline, remindAt } };
}

// Run by the hourly schedule. Each reminder is claimed first, so it is sent at most once.
export async function sendReturnReminders(env, now = Date.now(), fetchImpl = fetch) {
  if (!env.RELAY_DB || !env.RESEND_API_KEY) return { sent: 0 };
  await ensureGmailTables(env.RELAY_DB);
  const due = await env.RELAY_DB.prepare(
    `SELECT r.receipt_id AS id, r.deadline AS deadline, r.title AS title, s.email AS email
     FROM return_reminders r
     JOIN shoppers s ON s.id = r.shopper_id
     JOIN captured_receipts c ON c.id = r.receipt_id AND c.status NOT IN ('dismissed','not_receipt')
     WHERE r.sent_at IS NULL AND r.remind_at <= ? AND r.deadline >= ?
       AND EXISTS (SELECT 1 FROM shopper_consents k WHERE k.shopper_id = r.shopper_id AND k.version = ? AND k.withdrawn_at IS NULL)
     LIMIT 20`).bind(now, todayIso(now), CONSENT_VERSION).all();
  let sent = 0;
  const appUrl = String(env.RELAY_APP_URL || "https://zzmm92nr59-cloud.github.io/instant-refund-prototype/").split("#")[0];
  for (const r of due.results || []) {
    const claimed = await env.RELAY_DB.prepare(
      "UPDATE return_reminders SET sent_at = ? WHERE receipt_id = ? AND sent_at IS NULL RETURNING receipt_id").bind(now, r.id).first();
    if (!claimed) continue;
    const days = Math.max(0, Math.ceil((Date.parse(r.deadline + "T23:59:59Z") - now) / DAY));
    const when = days <= 1 ? "today or tomorrow" : "in " + days + " days";
    const nice = new Date(r.deadline + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    let ok = false;
    try {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.RELAY_EMAIL_FROM || "Relay <onboarding@resend.dev>", to: [r.email],
          subject: "Return deadline " + when + ": " + r.title,
          text: r.title + " needs to go back by " + nice + " (" + when + ").\n\nOpen Relay to see how to return it and find your QR code: " + appUrl +
            "\n\nYou asked Relay for this reminder. It is the only one it will send for this item.",
          html: "<p><b>" + escapeHtml(r.title) + "</b> needs to go back by <b>" + nice + "</b> (" + when + ").</p><p><a href=\"" + appUrl +
            "\">Open Relay</a> to see how to return it and find your QR code.</p><p style=\"color:#666\">You asked Relay for this reminder. It is the only one it will send for this item.</p>"
        })
      });
      ok = res.ok;
    } catch { ok = false; }
    if (ok) sent++;
    else await env.RELAY_DB.prepare("UPDATE return_reminders SET sent_at = NULL WHERE receipt_id = ?").bind(r.id).run();
  }
  return { sent };
}
function escapeHtml(t) { return String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
