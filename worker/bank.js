// Bank and card payments through open banking (TrueLayer's Data API): read-only. A shopper connects a bank or card on
// their bank's own page; Relay reads the payments and matches each one to a receipt, so a purchase with no email receipt
// still shows up, and a receipt shows which card paid for it.
//
// Rules (do not weaken):
//  * Read-only. The scopes ask to read accounts, cards and transactions, never to move money. Relay never pays.
//  * The shopper signs in on their bank's page, never in Relay. Relay never sees bank passwords.
//  * The bank's tokens are kept encrypted (gmail.js sealToken) and only on Relay's server.
//  * Off until TRUELAYER_CLIENT_ID and TRUELAYER_CLIENT_SECRET are set as Cloudflare secrets. With TRUELAYER_ENV other than
//    "live" it uses TrueLayer's test banks. Only Relay's team and testers can use it, on test banks or real ones, until
//    BANK_FOR_EVERYONE is "on" (Connor, 16 Nov 2026: real banks for the team first, to try with his own accounts).
//  * Disconnecting deletes the connection and every payment read from it; so does deleting the account.
//  * Only spending is kept: date, amount, the bank's description and merchant, which account, and the receipt it matches.
//
// Routes: GET /relay/my/bank, POST /relay/my/bank/connect, GET /relay/bank/callback (the bank's page sends the browser back
// here), POST /relay/my/bank/sync, GET /relay/my/bank/payments, POST /relay/my/bank/disconnect { id }.
import { sealToken, openToken, receiptTotals } from "./gmail.js";
import { isAdmin, isTester } from "./resale-admin.js";

const DAY = 864e5;
export const BANK_SCOPES = "info accounts balance cards transactions offline_access";
export const LOOK_BACK_DAYS = 90;
export const SYNC_GAP = 10 * 60e3;
const STATE_LIFE = 15 * 60e3;
const DEFAULT_APP_URL = "https://zzmm92nr59-cloud.github.io/instant-refund-prototype/";
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

export const bankConfigured = (env) => Boolean(env && env.TRUELAYER_CLIENT_ID && env.TRUELAYER_CLIENT_SECRET);
export const bankLive = (env) => String((env && env.TRUELAYER_ENV) || "").toLowerCase() === "live";
const hosts = (env) => bankLive(env) ? { auth: "https://auth.truelayer.com", api: "https://api.truelayer.com" }
  : { auth: "https://auth.truelayer-sandbox.com", api: "https://api.truelayer-sandbox.com" };
const redirectUri = (env, url) => env.TRUELAYER_REDIRECT_URI || `${url.origin}/relay/bank/callback`;

export const BANK_SQL = [
  `CREATE TABLE IF NOT EXISTS bank_link_states (state_hash TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS bank_links (id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, bank TEXT, token_iv TEXT NOT NULL, token_data TEXT NOT NULL,
    connected_at INTEGER NOT NULL, synced_at INTEGER, status TEXT NOT NULL DEFAULT 'ok')`,
  `CREATE TABLE IF NOT EXISTS bank_payments (shopper_id TEXT NOT NULL, payment_id TEXT NOT NULL, connection_id TEXT NOT NULL, account TEXT,
    paid_on TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, description TEXT, merchant TEXT, receipt_id TEXT, match TEXT,
    created_at INTEGER NOT NULL, PRIMARY KEY (shopper_id, payment_id))`
];
export async function ensureBankTables(db) { await db.batch(BANK_SQL.map((s) => db.prepare(s))); }
// For account deletion (auth.js): everything bank-related for one shopper.
export function bankDeleteStatements(db, shopperId) {
  return ["bank_payments", "bank_links", "bank_link_states"].map((t) => db.prepare(`DELETE FROM ${t} WHERE shopper_id = ?`).bind(shopperId));
}

async function sha256Hex(text) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function randomToken() { const b = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

// Who may connect a bank: anyone once it's live; while it uses test banks, only Relay's team and testers.
async function allowed(env, shopper) { return bankConfigured(env) && ((bankLive(env) && env.BANK_FOR_EVERYONE === "on") || isAdmin(env, shopper) || await isTester(env, shopper)); }

// ---- Matching a payment to a receipt ------------------------------------------------------------------------------------
// Words that say nothing about the shop in a bank's description.
const NOISE = new Set(["card", "payment", "purchase", "contactless", "pos", "visa", "debit", "credit", "mastercard", "amex", "online", "www", "com", "co", "uk", "ltd", "limited", "plc", "the", "and", "store", "shop", "london", "gbr", "gb", "pay", "apple", "google", "paypal", "klarna", "via"]);
export const words = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3 && !NOISE.has(w) && !/^\d+$/.test(w));
const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// Does the bank's text name this shop? "SAINSBURYS S/MKTS" names Sainsbury's; "AMZNMKTPLACE" names Amazon.
export function namesShop(text, shop, domain) {
  const t = squash(text); if (!t) return false;
  const s = squash(shop), d = squash(String(domain || "").replace(/^www\./, "").split(".")[0]);
  if (s.length >= 4 && t.includes(s)) return true;
  if (d.length >= 4 && t.includes(d)) return true;
  const short = { amazon: "amzn", sainsburys: "sainsbury", marksandspencer: "marks", johnlewis: "johnlewis" }[s];
  if (short && t.includes(short)) return true;
  const sw = words(shop), tw = new Set(words(text));
  return sw.length > 0 && sw.filter((w) => tw.has(w)).length >= Math.min(2, sw.length);
}
const dayDiff = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / DAY);
// Each payment's best receipt: the same amount, paid from the day before the order to a week after, and the bank's text
// names the shop ("sure"); or, with no name to go on, the only receipt of that amount in that window ("likely"). A receipt
// matches one payment at most. Nothing else is guessed.
export function matchPayments(payments, receipts) {
  const used = new Set(), out = new Map();
  const spend = payments.filter((p) => p.amount_minor > 0).slice().sort((a, b) => a.paid_on < b.paid_on ? -1 : 1);
  for (const pass of ["sure", "likely"]) for (const p of spend) {
    if (out.has(p.payment_id)) continue;
    const fits = receipts.filter((r) => !used.has(r.id) && r.totalPence === p.amount_minor && String(r.currency || "GBP") === String(p.currency || "GBP")
      && dayDiff(p.paid_on, r.date) >= -1 && dayDiff(p.paid_on, r.date) <= 7);
    const named = fits.filter((r) => namesShop((p.merchant || "") + " " + (p.description || ""), r.shop, r.domain));
    const pick = pass === "sure" ? (named.length === 1 ? named[0] : null) : (fits.length === 1 && p.amount_minor >= 500 ? fits[0] : null);
    if (pick) { used.add(pick.id); out.set(p.payment_id, { receiptId: pick.id, match: pass }); }
  }
  return out;
}

// ---- TrueLayer ------------------------------------------------------------------------------------------------------------
async function tokenCall(env, form, f) {
  try {
    const r = await f(hosts(env).auth + "/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.TRUELAYER_CLIENT_ID, client_secret: env.TRUELAYER_CLIENT_SECRET, ...form }), signal: AbortSignal.timeout(20000) });
    const b = await r.json().catch(() => null);
    if (r.ok && b && b.access_token) return b;
    // Why TrueLayer said no, for Relay's logs: its status and short error code only (never the code, token or secret).
    console.log("bank: TrueLayer token refused", form.grant_type, r.status, String((b && b.error) || "").slice(0, 60), String((b && b.error_description) || "").slice(0, 160));
    return null;
  } catch (e) { console.log("bank: TrueLayer token call failed", form.grant_type, String(e && e.name || "")); return null; }
}
async function apiGet(env, token, path, f) {
  try {
    const r = await f(hosts(env).api + path, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(20000) });
    if (r.status === 401 || r.status === 403) return { gone: true };
    const b = r.ok ? await r.json().catch(() => null) : null;
    return b && Array.isArray(b.results) ? { results: b.results } : { failed: true };
  } catch { return { failed: true }; }
}
async function openTokens(env, row) { try { return JSON.parse(await openToken(env, row.token_iv, row.token_data)); } catch { return null; } }
async function saveTokens(env, db, id, t) { const s = await sealToken(env, JSON.stringify(t)); await db.prepare("UPDATE bank_links SET token_iv = ?, token_data = ? WHERE id = ?").bind(s.iv, s.data, id).run(); }
const minor = (n) => Math.round(Math.abs(Number(n) || 0) * 100);
// Not shopping: money moved between accounts or to savings (round-ups like Save the Change), cash, bills by standing order or
// direct debit, bank fees and interest, and betting. Relay keeps only purchases, so these are never stored.
const NOT_SHOPPING_TYPES = new Set(["ATM", "CASH", "TRANSFER", "STANDING_ORDER", "DIRECT_DEBIT", "FEE_CHARGE", "INTEREST", "DIVIDEND", "CORRECTION", "CHEQUE"]);
export const NOT_SHOPPING = /save the change|round ?-?ups?|\btransfer\b|\bto savings\b|\bsavings\b|standing order|direct debit|cash withdrawal|\batm\b|\binterest\b|overdraft|\bfee\b|betfred|bet365|paddy ?power|ladbrokes|william hill|sky ?bet|\bcoral\b|betway|betfair|\bbetting\b|\bcasino\b|national lottery|\blotto\b|securetrade|forex|\bcrypto|coinbase|binance|trading 212|\bisa\b|gaming|betropolis|\bbingo\b|\bslots?\b|\bpoker\b|\brent\b|mortgage|council tax|insurance|\bloan\b|credit ?report|vanquis|capital one|barclaycard|\bamex\b|american express|klarna repayment|\benergy\b|\bedf\b|e\.?on\b|octopus|british gas|ovo\b|\bwater\b|thames water|\bee & t-mobile\b|\bvodafone\b|\bo2\b|virgin media|\bbt\b|tv licen[cs]e|housing|regenda|tesco mobile|giffgaff|talk ?talk|plusnet|\bsky (digital|broadband|uk)\b|\brevolut\b|\bmonzo\b|\bstarling\b|\bhalifax\b|\blloyds\b|\bnatwest\b|\bsantander\b|\bhsbc\b|\bbarclays\b|\bnationwide\b|ulster bank|\bfinance\b|\bwise\b|\bchase\b|tfl travel charge/i;
export function isShopping(x) {
  const cat = String(x.transaction_category || "").toUpperCase();
  if (NOT_SHOPPING_TYPES.has(cat)) return false;
  return !NOT_SHOPPING.test(String(x.description || "") + " " + String(x.merchant_name || ""));
}
// A shop's name as a person would say it, from the bank's text: "ASDA STOES LTD" is Asda, "PAYPAL *EBAY" is eBay,
// "AMZNMKTPLACE" is Amazon. The bank's own words stay with the payment too.
const KNOWN_SHOPS = [[/amzn|amazon/i, "Amazon"], [/\bebay\b/i, "eBay"], [/sainsbury/i, "Sainsbury's"], [/\btesco\b/i, "Tesco"], [/\basda\b/i, "Asda"],
  [/marks ?(and|&) ?spencer|\bm ?& ?s\b/i, "M&S"], [/john ?lewis/i, "John Lewis"], [/waitrose/i, "Waitrose"], [/morrisons/i, "Morrisons"], [/\baldi\b/i, "Aldi"], [/\blidl\b/i, "Lidl"],
  [/\bboots\b/i, "Boots"], [/^next\b|next retail|next plc|next directory/i, "Next"], [/\bnike\b/i, "Nike"], [/jd sports/i, "JD Sports"], [/lululemon/i, "lululemon"], [/\basos\b/i, "ASOS"], [/\bzara\b/i, "Zara"],
  [/primark/i, "Primark"], [/\bargos\b/i, "Argos"], [/\bcurrys\b/i, "Currys"], [/\bapple\b/i, "Apple"], [/uber ?eats/i, "Uber Eats"], [/deliveroo/i, "Deliveroo"], [/\bjust ?eat\b/i, "Just Eat"],
  [/pret a manger|\bpret\b/i, "Pret"], [/mcdonald/i, "McDonald's"], [/greggs/i, "Greggs"], [/\bspar\b/i, "Spar"], [/home bargains/i, "Home Bargains"], [/google play/i, "Google Play"], [/starbucks/i, "Starbucks"], [/costa/i, "Costa"], [/nespresso/i, "Nespresso"], [/\bikea\b/i, "IKEA"]];
const TIDY_DROP = /^(card|payment|purchase|pos|contactless|visa|debit|credit|online|to|at|ltd|limited|plc|stores?|stoes|s\/mkts|supermarkets?|uk|gb|gbr|london|www|com)$/i;
export function shopName(description, merchant) {
  const text = String(merchant || description || "").trim();
  for (const [re, name] of KNOWN_SHOPS) if (re.test(text) || re.test(String(description || ""))) return name;
  // A website stays a website, tidied: WWW.TAILS.COM is Tails.com.
  const site = /^(?:www\.)?([a-z0-9-]{2,30})\.(com|co\.uk|uk|net)$/i.exec(text);
  if (site) return site[1].charAt(0).toUpperCase() + site[1].slice(1).toLowerCase() + "." + site[2].toLowerCase();
  let words = text.replace(/^(paypal|sq|sumup|zettle|sp|pp)\s*\*\s*/i, "").replace(/[*#]/g, " ").split(/\s+/)
    .map((w) => w.replace(/[.,]+$/, "")).filter((w) => w && !/^[-–]+$/.test(w) && !TIDY_DROP.test(w) && !/\d/.test(w));
  // A bank's short codes at the end (LT, CD, LC) and a cut-off last word aren't part of the name.
  while (words.length > 1 && /^[A-Z]{2,3}$/.test(words[words.length - 1]) && !/^(UK|BP|CO)$/.test(words[words.length - 1])) words.pop();
  words = words.slice(0, 4);
  if (!words.length) return null;
  return words.map((w, i) => i > 0 && /^(and|of|the|on|in)$/i.test(w) ? w.toLowerCase() : (w.length <= 2 || w.includes("&")) && /^[A-Z&]+$/.test(w) && !/^co$/i.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
const bankName = (n) => { const s = String(n || "").trim(); if (!s) return null; return /^mock$/i.test(s) ? "Mock Bank" : s.charAt(0).toUpperCase() + s.slice(1); };
const clip = (s, n) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : null) || null;

// Reads a connection's payments for the last 90 days. Returns { ok } or { gone } (the bank's permission has ended).
async function readConnection(env, db, shopperId, row, now, f) {
  let t = await openTokens(env, row); if (!t) return { gone: true };
  if (!t.access || !t.expires || t.expires < now + 60e3) {
    const fresh = t.refresh ? await tokenCall(env, { grant_type: "refresh_token", refresh_token: t.refresh }, f) : null;
    if (!fresh) return { gone: true };
    t = { access: fresh.access_token, refresh: fresh.refresh_token || t.refresh, expires: now + (Number(fresh.expires_in) || 3600) * 1000 };
    await saveTokens(env, db, row.id, t);
  }
  const q = "?from=" + encodeURIComponent(new Date(now - LOOK_BACK_DAYS * DAY).toISOString()) + "&to=" + encodeURIComponent(new Date(now).toISOString());
  const rows = [];
  // What was read and why things were left out, for Relay's logs: counts, the bank's category words and the names of the
  // fields it sends (not their values), never a payment, amount, name or account.
  const seen = { accounts: 0, cards: 0, failedLists: 0, failedTx: 0, tx: 0, debits: 0, keptDebits: 0, credits: 0, leftOutType: {}, leftOutWord: {}, fields: {} };
  for (const [list, kind] of [["/data/v1/accounts", "accounts"], ["/data/v1/cards", "cards"]]) {
    const got = await apiGet(env, t.access, list, f);
    if (got.gone) return { gone: true };
    if (got.failed) { seen.failedLists++; continue; }   // a bank with no cards (or no accounts) answers with an error: skip it
    seen[kind] += got.results.length;
    for (const a of got.results.slice(0, 10)) {
      const id = String(a.account_id || "");
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) continue;
      const name = clip(a.display_name, 60) || (kind === "cards" ? "Card" : "Account");
      const last4 = clip(a.partial_card_number, 4);
      const label = name + (last4 && !name.includes(last4) ? " ending " + last4 : "");
      const tx = await apiGet(env, t.access, `/data/v1/${kind}/${id}/transactions${q}`, f);
      if (tx.gone) return { gone: true };
      if (tx.failed) { seen.failedTx++; continue; }
      seen.tx += tx.results.length;
      for (const x of tx.results.slice(0, 1000)) {
        const pid = String(x.transaction_id || ""), when = String(x.timestamp || "").slice(0, 10);
        if (!pid || pid.length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(when)) continue;
        const debit = String(x.transaction_type || "").toUpperCase() === "DEBIT" || (!x.transaction_type && Number(x.amount) < 0);
        if (debit) seen.debits++; else seen.credits++;
        for (const k of Object.keys(x)) seen.fields[k] = (seen.fields[k] || 0) + 1;
        for (const k of Object.keys((x && x.meta) || {})) seen.fields["meta." + k] = (seen.fields["meta." + k] || 0) + 1;
        if (debit && !isShopping(x)) {
          const cat = String(x.transaction_category || "").toUpperCase();
          if (NOT_SHOPPING_TYPES.has(cat)) seen.leftOutType[cat] = (seen.leftOutType[cat] || 0) + 1;
          else { const w = (NOT_SHOPPING.exec(String(x.description || "") + " " + String(x.merchant_name || "")) || ["?"])[0].toLowerCase().slice(0, 20); seen.leftOutWord[w] = (seen.leftOutWord[w] || 0) + 1; }
          continue;
        }
        if (debit) seen.keptDebits++;
        const amount = minor(x.amount); if (!amount) continue;
        rows.push({ payment_id: row.id + ":" + pid, account: label, paid_on: when, amount_minor: debit ? amount : -amount,
          currency: /^[A-Z]{3}$/.test(String(x.currency || "")) ? x.currency : "GBP", description: clip(x.description, 140), merchant: clip(x.merchant_name, 80) });
      }
    }
  }
  console.log("bank: read", JSON.stringify(seen));
  // A full read of the last 90 days replaces what was read before for those days (so anything Relay no longer keeps goes).
  await db.prepare("DELETE FROM bank_payments WHERE shopper_id = ? AND connection_id = ? AND paid_on >= ?").bind(shopperId, row.id, new Date(now - LOOK_BACK_DAYS * DAY).toISOString().slice(0, 10)).run();
  if (rows.length) await db.batch(rows.map((r) => db.prepare(`INSERT INTO bank_payments (shopper_id, payment_id, connection_id, account, paid_on, amount_minor, currency, description, merchant, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(shopper_id, payment_id) DO UPDATE SET account = excluded.account, description = excluded.description, merchant = excluded.merchant`)
    .bind(shopperId, r.payment_id, row.id, r.account, r.paid_on, r.amount_minor, r.currency, r.description, r.merchant, now)));
  await db.prepare("UPDATE bank_links SET synced_at = ?, status = 'ok' WHERE id = ?").bind(now, row.id).run();
  return { ok: true, read: rows.length };
}

// Reads every connection of a shopper (at most once every 10 minutes unless forced), then matches payments to receipts.
export async function syncBank(env, shopperId, now, f, force) {
  const db = env.RELAY_DB;
  const conns = (await db.prepare("SELECT * FROM bank_links WHERE shopper_id = ?").bind(shopperId).all()).results || [];
  let read = 0, gone = 0;
  for (const c of conns) {
    if (!force && c.synced_at && now - c.synced_at < SYNC_GAP) continue;
    const r = await readConnection(env, db, shopperId, c, now, f);
    if (r.gone) { gone++; await db.prepare("UPDATE bank_links SET status = 'reconnect' WHERE id = ?").bind(c.id).run(); }
    else read += r.read || 0;
  }
  // Payments older than 13 months go.
  await db.prepare("DELETE FROM bank_payments WHERE shopper_id = ? AND paid_on < ?").bind(shopperId, new Date(now - 400 * DAY).toISOString().slice(0, 10)).run();
  const payments = (await db.prepare("SELECT payment_id, paid_on, amount_minor, currency, description, merchant FROM bank_payments WHERE shopper_id = ?").bind(shopperId).all()).results || [];
  const matches = matchPayments(payments, await receiptTotals(env, shopperId));
  await db.batch([db.prepare("UPDATE bank_payments SET receipt_id = NULL, match = NULL WHERE shopper_id = ?").bind(shopperId),
    ...[...matches].map(([pid, m]) => db.prepare("UPDATE bank_payments SET receipt_id = ?, match = ? WHERE shopper_id = ? AND payment_id = ?").bind(m.receiptId, m.match, shopperId, pid))]);
  return { read, gone, matched: matches.size };
}

// The bank's page sends the browser back here with a code. The single-use state ties it to the shopper who started.
export async function handleBankCallback(env, url, o) {
  const appUrl = String(env.RELAY_APP_URL || DEFAULT_APP_URL).split("#")[0];
  const back = (r) => Response.redirect(appUrl + "#bank=" + r, 302);
  if (!bankConfigured(env)) return back("not_configured");
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code") || "", state = url.searchParams.get("state") || "";
  if (!code || code.length > 2000 || !/^[A-Za-z0-9_-]{43}$/.test(state)) return back("failed");
  const db = env.RELAY_DB; await ensureBankTables(db);
  const hash = await sha256Hex(state);
  const claimed = await db.prepare("UPDATE bank_link_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING shopper_id")
    .bind(o.now, hash, o.now).first();
  if (!claimed) {
    // Say why when it's only that it took too long (each try lasts 15 minutes).
    const was = await db.prepare("SELECT expires_at, used_at FROM bank_link_states WHERE state_hash = ?").bind(hash).first();
    return back(was && !was.used_at && was.expires_at <= o.now ? "expired" : "failed");
  }
  const t = await tokenCall(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri(env, url) }, o.fetchImpl);
  if (!t) return back("failed");
  let bank = null;
  try {
    const me = await o.fetchImpl(hosts(env).api + "/data/v1/me", { headers: { Authorization: "Bearer " + t.access_token }, signal: AbortSignal.timeout(15000) });
    const b = me.ok ? await me.json().catch(() => null) : null;
    const p = b && Array.isArray(b.results) && b.results[0] && b.results[0].provider;
    bank = bankName(clip(p && p.display_name, 60));
  } catch {}
  const id = crypto.randomUUID();
  const sealed = await sealToken(env, JSON.stringify({ access: t.access_token, refresh: t.refresh_token || null, expires: o.now + (Number(t.expires_in) || 3600) * 1000 }));
  await db.prepare("INSERT INTO bank_links (id, shopper_id, bank, token_iv, token_data, connected_at) VALUES (?,?,?,?,?,?)")
    .bind(id, claimed.shopper_id, bank, sealed.iv, sealed.data, o.now).run();
  try { await syncBank(env, claimed.shopper_id, o.now, o.fetchImpl, true); } catch {}
  return back("connected");
}

export async function handleBankRoute(path, method, request, env, url, cors, shopper, o) {
  if (!path.startsWith("/relay/my/bank")) return null;
  const db = env.RELAY_DB; await ensureBankTables(db);
  const ok = await allowed(env, shopper);
  if (path === "/relay/my/bank" && method === "GET") {
    if (!ok) return json({ available: false, connections: [] }, 200, cors);
    const conns = (await db.prepare(`SELECT c.id, c.bank, c.connected_at, c.synced_at, c.status, COUNT(p.payment_id) AS payments, SUM(CASE WHEN p.receipt_id IS NOT NULL THEN 1 ELSE 0 END) AS matched
      FROM bank_links c LEFT JOIN bank_payments p ON p.connection_id = c.id AND p.shopper_id = c.shopper_id WHERE c.shopper_id = ? GROUP BY c.id ORDER BY c.connected_at`).bind(shopper.id).all()).results || [];
    return json({ available: true, testBanks: !bankLive(env), connections: conns.map((c) => ({ id: c.id, bank: bankName(c.bank), connectedAt: new Date(c.connected_at).toISOString(),
      syncedAt: c.synced_at ? new Date(c.synced_at).toISOString() : null, needsReconnect: c.status === "reconnect", payments: Number(c.payments) || 0, matched: Number(c.matched) || 0 })) }, 200, cors);
  }
  if (!ok) return json({ error: "not_found" }, 404, cors);
  if (path === "/relay/my/bank/connect" && method === "POST") {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM bank_links WHERE shopper_id = ?").bind(shopper.id).first();
    if (n && n.n >= 5) return json({ error: "too_many_banks", max: 5 }, 409, cors);
    const state = randomToken();
    await db.prepare("DELETE FROM bank_link_states WHERE expires_at < ?").bind(o.now).run();
    await db.prepare("INSERT INTO bank_link_states (state_hash, shopper_id, expires_at) VALUES (?,?,?)").bind(await sha256Hex(state), shopper.id, o.now + STATE_LIFE).run();
    const q = new URLSearchParams({ response_type: "code", client_id: env.TRUELAYER_CLIENT_ID, redirect_uri: redirectUri(env, url), scope: BANK_SCOPES, state,
      providers: bankLive(env) ? "uk-ob-all uk-oauth-all" : "uk-cs-mock uk-ob-all uk-oauth-all" });
    return json({ url: hosts(env).auth + "/?" + q.toString().replace(/\+/g, "%20") }, 200, cors);
  }
  if (path === "/relay/my/bank/sync" && method === "POST") return json(await syncBank(env, shopper.id, o.now, o.fetchImpl, false), 200, cors);
  if (path === "/relay/my/bank/payments" && method === "GET") {
    const rows = (await db.prepare(`SELECT payment_id, account, paid_on, amount_minor, currency, description, merchant, receipt_id, match FROM bank_payments
      WHERE shopper_id = ? AND amount_minor > 0 ORDER BY paid_on DESC, payment_id LIMIT 200`).bind(shopper.id).all()).results || [];
    return json({ payments: rows.map((r) => ({ id: r.payment_id, account: r.account, date: r.paid_on, amountPence: r.amount_minor, currency: r.currency,
      description: r.description, merchant: r.merchant, shop: shopName(r.description, r.merchant), receiptId: r.receipt_id || null, match: r.match || null })) }, 200, cors);
  }
  if (path === "/relay/my/bank/disconnect" && method === "POST") {
    const b = await request.json().catch(() => null);
    if (!b || typeof b.id !== "string" || !/^[0-9a-f-]{36}$/.test(b.id)) return json({ error: "invalid_request" }, 400, cors);
    const own = await db.prepare("SELECT 1 AS x FROM bank_links WHERE id = ? AND shopper_id = ?").bind(b.id, shopper.id).first();
    if (!own) return json({ error: "not_found" }, 404, cors);
    await db.batch([db.prepare("DELETE FROM bank_payments WHERE shopper_id = ? AND connection_id = ?").bind(shopper.id, b.id),
      db.prepare("DELETE FROM bank_links WHERE id = ? AND shopper_id = ?").bind(b.id, shopper.id)]);
    return json({ ok: true }, 200, cors);
  }
  return json({ error: "not_found" }, 404, cors);
}
