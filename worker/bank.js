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
//  * Only spending is kept: date, amount, the bank's description and merchant, TrueLayer's label for it (e.g. Shopping,
//    Clothing), which account, and the receipt it matches.
//  * Money that came in on those cards and accounts is kept the same way (it always was), and is used for one thing only:
//    to show a refund arriving on a return Relay already knows of (refundCredits below, return-tracking.js). It is never
//    listed as a payment, matched to a receipt as a purchase, or counted as spending.
//
// Routes: GET /relay/my/bank, POST /relay/my/bank/connect, GET /relay/bank/callback (the bank's page sends the browser back
// here), POST /relay/my/bank/sync, GET /relay/my/bank/payments, POST /relay/my/bank/disconnect { id },
// POST /relay/my/bank/not-mine { id, on, everyFromShop, reason }, POST /relay/my/bank/receipt-photo { id, image },
// POST /relay/my/bank/cards { id, cards: [{ ref, mine }] } (which of a connection's cards and accounts are the shopper's).
//
// Which cards are yours (Connor, 23 Nov 2026: he and his girlfriend share an Amex account with a card each, and both have
// Relay accounts, so connecting it can list both cards, and each would see the other's spending):
//  * A connection that lists more than one card or account asks "Which of these are yours?" before any payment is read.
//    One card or account alone is taken as the shopper's, with no question.
//  * A card that isn't theirs is never read, kept, shown, matched or counted; ticking it off deletes what was read from it.
//  * The answer is kept per connection per card (bank_cards), and carried to a new connection of the same shopper for the
//    same card (TrueLayer's account id, or the same bank and last four digits). Never to or from anyone else.
//  * Some card companies send every card on one account under the main card. TrueLayer's card transactions can say which
//    card each was: "meta ... changes based on provider. For example, when returning transactions for an American Express
//    card, meta also contains a supplementary_card_id", and its examples show a masked meta.cardNumber ("1234********5678")
//    (docs.truelayer.com/docs/card-data-requests, read 23 Nov 2026; the card object's own last four is
//    partial_card_number). When a card's payments carry either, they're split into one choice a card (txCardMark). When
//    they carry neither, Relay can't tell whose a payment is and doesn't guess: for an Amex card it says so (unsplit).
import { sealToken, openToken, receiptTotals, ensureGmailTables } from "./gmail.js";
import { isAdmin, isTester } from "./resale-admin.js";
import { decodePhoto, MAX_RECEIPT_PHOTO_BYTES } from "./photos.js";
import { readReceiptPhoto } from "./receipt-photo.js";
import { checkItems } from "./receipt-items.js";
import { namesCheck } from "./item-names.js";
import { aiAvailable } from "./ai-reader.js";
import { seedShops, classificationSays, classificationToKeep, loadShopDirectory, learnedShop, EXCLUDED_KINDS } from "./shop-directory.js";

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
    connected_at INTEGER NOT NULL, synced_at INTEGER, status TEXT NOT NULL DEFAULT 'ok', unsplit INTEGER)`,
  `CREATE TABLE IF NOT EXISTS bank_payments (shopper_id TEXT NOT NULL, payment_id TEXT NOT NULL, connection_id TEXT NOT NULL, account TEXT,
    paid_on TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, description TEXT, merchant TEXT, receipt_id TEXT, match TEXT,
    created_at INTEGER NOT NULL, classification TEXT, card_ref TEXT, PRIMARY KEY (shopper_id, payment_id))`,
  // "Not mine" (a shared card: Connor, 17 Nov 2026): one payment (kind 'payment', key = its id), or everything from a shop
  // (kind 'shop', key = the shop's name, lower case). Not matched to receipts, shown apart. Kind 'no_receipt' (key = the
  // payment's id): "This wasn't a shop purchase", so Relay stops asking for its receipt; it's still matched as usual.
  `CREATE TABLE IF NOT EXISTS bank_not_mine (shopper_id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (shopper_id, kind, key))`,
  // Which of a connection's cards and accounts are the shopper's. card_key: "a:<TrueLayer account id>" or "c:<card id>";
  // a card split by its payments (one account, several cards) has a row a card: "<parent key>|self" (the card itself) and
  // "<parent key>|n:<last four>" or "|s:<supplementary card id>"; the parent then only says whether to read it at all.
  // mine: 1 yes, 0 no, null not answered yet (nothing read). auto: 1 when it was the only one, so not asked. ref: the id
  // the app uses for it.
  `CREATE TABLE IF NOT EXISTS bank_cards (shopper_id TEXT NOT NULL, connection_id TEXT NOT NULL, card_key TEXT NOT NULL, ref TEXT NOT NULL,
    parent_key TEXT, provider_id TEXT, bank TEXT, name TEXT, last4 TEXT, mine INTEGER, auto INTEGER NOT NULL DEFAULT 0, seen_at INTEGER NOT NULL,
    PRIMARY KEY (shopper_id, connection_id, card_key))`
];
// Columns added after the tables were first made (tried once per copy of the Worker; "already there" is fine).
// classification: TrueLayer's own label for the payment, as a short JSON list of words (17 Nov 2026, shop-directory.js).
// The shop's name TrueLayer gives (merchant_name) was already kept, in merchant.
let bankColumnsReady = false;
export async function ensureBankColumns(db) {
  if (bankColumnsReady) return;
  try { await db.prepare("ALTER TABLE bank_payments ADD COLUMN classification TEXT").run(); } catch { /* already there, or no table yet (it's made with it) */ }
  // card_ref: which of the connection's cards (bank_cards.ref) the payment was on (23 Nov 2026). unsplit: 1 when an Amex
  // card's payments came with nothing saying which card each was on, so the app can say Relay can't tell them apart.
  try { await db.prepare("ALTER TABLE bank_payments ADD COLUMN card_ref TEXT").run(); } catch { /* already there */ }
  try { await db.prepare("ALTER TABLE bank_links ADD COLUMN unsplit INTEGER").run(); } catch { /* already there */ }
  // bank_cards is read with every payment (visibleSql), including by receiptsToAdd, which doesn't make the tables.
  try { await db.prepare(BANK_SQL[BANK_SQL.length - 1]).run(); } catch { /* no database binding: nothing to read anyway */ }
  bankColumnsReady = true;
}
export async function ensureBankTables(db) { await db.batch(BANK_SQL.map((s) => db.prepare(s))); await ensureBankColumns(db); }
// For account deletion (auth.js): everything bank-related for one shopper.
export function bankDeleteStatements(db, shopperId) {
  return ["bank_payments", "bank_links", "bank_link_states", "bank_not_mine", "bank_cards"].map((t) => db.prepare(`DELETE FROM ${t} WHERE shopper_id = ?`).bind(shopperId));
}

async function sha256Hex(text) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function randomToken() { const b = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

// Who may connect a bank: anyone once it's live; while it uses test banks, only Relay's team and testers.
// Banks offered to every new account (said before sign-in, so getting started can count its steps). Nothing about anyone.
export const bankForEveryone = (env) => bankConfigured(env) && bankLive(env) && env.BANK_FOR_EVERYONE === "on";
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
    const named = fits.filter((r) => namesShop((p.merchant || "") + " " + statementShop(p.description), r.shop, r.domain));
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
// The shop's name as the bank gives it: TrueLayer's merchant_name, or the card company's own (Amex sends it in
// meta.provider_merchant_name on nearly every payment, 17 Nov 2026), before falling back to the statement text.
// A bank's statement line without what isn't the shop: how it was paid ("(VIA APPLE PAY)", which made Santander payments
// all look like Apple: Connor, 17 Nov 2026), "CARD PAYMENT TO", the date ("ON 14-11-2026") and a foreign-currency tail
// (",5.00 USD, RATE 0.79…").
export function statementShop(text) {
  return String(text || "")
    .replace(/\(?\s*via (apple|google|samsung) pay\s*\)?/ig, " ")
    .replace(/^\s*(card payment|contactless payment|debit card payment|purchase)( to)?\s+/i, "")
    .replace(/,?\s+on \d{1,2}[-/]\d{1,2}[-/]\d{2,4}.*$/i, "")
    .replace(/,?\s*\d+(\.\d+)?\s*(usd|eur|chf|aud|cad|jpy|sek|nok|dkk|pln)\b.*$/i, "")
    .replace(/\s*,\s*$/, "").replace(/\s+/g, " ").trim();
}
export const merchantOf = (x) => (x && (x.merchant_name || (x.meta && x.meta.provider_merchant_name))) || null;
export const NOT_SHOPPING = /save the change|round ?-?ups?|\btransfer\b|\bto savings\b|\bsavings\b|standing order|direct debit|cash withdrawal|\batm\b|\binterest\b|overdraft|\bfee\b|betfred|bet365|paddy ?power|ladbrokes|william hill|sky ?bet|\bcoral\b|betway|betfair|\bbetting\b|\bcasino\b|national lottery|\blotto\b|securetrade|forex|\bcrypto|coinbase|binance|trading 212|\bisa\b|gaming|betropolis|\bbingo\b|\bslots?\b|\bpoker\b|\brent\b|mortgage|council tax|insurance|\bloan\b|credit ?report|vanquis|capital one|barclaycard|\bamex\b|american express|klarna repayment|\benergy\b|\bedf\b|e\.?on\b|octopus|british gas|ovo\b|\bwater\b|thames water|\bee & t-mobile\b|\bvodafone\b|\bo2\b|virgin media|\bbt\b|tv licen[cs]e|housing|regenda|tesco mobile|giffgaff|talk ?talk|plusnet|\bsky (digital|broadband|uk)\b|\brevolut\b|\bmonzo\b|\bstarling\b|\bhalifax\b|\blloyds\b|\bnatwest\b|\bsantander\b|\bhsbc\b|\bbarclays\b|\bnationwide\b|ulster bank|\bfinance\b|\bwise\b|\bchase\b|tfl travel charge|novuna|personal financ|ee device payment/i;
export function isShopping(x) {
  const cat = String(x.transaction_category || "").toUpperCase();
  if (NOT_SHOPPING_TYPES.has(cat)) return false;
  return !NOT_SHOPPING.test(statementShop(x.description) + " " + String(merchantOf(x) || ""));
}
// A shop's name as a person would say it, from the bank's text: "ASDA STOES LTD" is Asda, "PAYPAL *EBAY" is eBay,
// "AMZNMKTPLACE" is Amazon. The bank's own words stay with the payment too.
const KNOWN_SHOPS = [[/amzn|amazon/i, "Amazon"], [/\bebay\b/i, "eBay"], [/sainsbury/i, "Sainsbury's"], [/\btesco\b/i, "Tesco"], [/\basda\b/i, "Asda"],
  [/marks ?(and|&) ?spencer|\bm ?& ?s\b/i, "M&S"], [/john ?lewis/i, "John Lewis"], [/waitrose/i, "Waitrose"], [/morrisons/i, "Morrisons"], [/\baldi\b/i, "Aldi"], [/\blidl\b/i, "Lidl"],
  [/\bboots\b/i, "Boots"], [/^next(\s+\d|\s*$)|next retail|next plc|next directory/i, "Next"], [/\bnike\b/i, "Nike"], [/jd sports/i, "JD Sports"], [/lululemon/i, "lululemon"], [/\basos\b/i, "ASOS"], [/\bzara\b/i, "Zara"],
  [/primark/i, "Primark"], [/\bargos\b/i, "Argos"], [/\bcurrys\b/i, "Currys"], [/\bapple\b/i, "Apple"], [/uber ?eats/i, "Uber Eats"], [/deliveroo/i, "Deliveroo"], [/\bjust ?eat\b/i, "Just Eat"],
  [/pret a manger|\bpret\b/i, "Pret"], [/mcdonald/i, "McDonald's"], [/greggs/i, "Greggs"], [/\bspar\b/i, "Spar"], [/home bargains/i, "Home Bargains"], [/google play/i, "Google Play"], [/starbucks/i, "Starbucks"], [/costa/i, "Costa"], [/nespresso/i, "Nespresso"], [/\bikea\b/i, "IKEA"]];
const TIDY_DROP = /^(card|payment|purchase|pos|contactless|visa|debit|credit|online|to|at|ltd|limited|plc|stores?|stoes|s\/mkts|supermarkets?|uk|gb|gbr|london|www|com)$/i;
export function shopName(description, merchant) {
  const said = statementShop(description), text = String(merchant || said || "").trim();
  for (const [re, name] of KNOWN_SHOPS) if (re.test(text) || re.test(said)) return name;
  // A website stays a website, tidied: WWW.TAILS.COM is Tails.com.
  const site = /^(?:www\.)?([a-z0-9-]{2,30})\.(com|co\.uk|uk|net)$/i.exec(text);
  if (site) return site[1].charAt(0).toUpperCase() + site[1].slice(1).toLowerCase() + "." + site[2].toLowerCase();
  let words = text.replace(/^(paypal|sq|sumup|zettle|sp|pp)\s*\*\s*/i, "").replace(/[*#]/g, " ").split(/\s+/)
    .map((w) => w.replace(/[.,]+$/, "")).filter((w) => w && !/^[-–]+$/.test(w) && !TIDY_DROP.test(w) && !/\d/.test(w));
  // A bank's short codes at the end (LT, CD, LC) and a cut-off last word aren't part of the name.
  // A word after "&" is part of the name ("BRINDLE & FOX" is Brindle & Fox, not "Brindle &").
  while (words.length > 1 && /^[A-Z]{2,3}$/.test(words[words.length - 1]) && !/^(UK|BP|CO)$/.test(words[words.length - 1]) && !/^(&|and)$/i.test(words[words.length - 2])) words.pop();
  words = words.slice(0, 4);
  if (!words.length) return null;
  return words.map((w, i) => i > 0 && /^(and|of|the|on|in)$/i.test(w) ? w.toLowerCase() : (w.length <= 2 || w.includes("&")) && /^[A-Z&]+$/.test(w) && !/^co$/i.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
const bankName = (n) => { const s = String(n || "").trim(); if (!s) return null; return /^mock$/i.test(s) ? "Mock Bank" : s.charAt(0).toUpperCase() + s.slice(1); };
const clip = (s, n) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : null) || null;

// ---- Which cards are yours ------------------------------------------------------------------------------------------------
// What a card payment says about which card it was on (TrueLayer's documentation is quoted at the top of this file): the last
// four digits of a masked meta.cardNumber, or else meta.supplementary_card_id. null when it says neither: then Relay
// can't tell, and doesn't guess.
export function txCardMark(x) {
  const m = x && x.meta && typeof x.meta === "object" ? x.meta : {};
  const num = typeof m.cardNumber === "string" ? /(\d{4})\s*$/.exec(m.cardNumber) : null;
  if (num) return "n:" + num[1];
  const sup = m.supplementary_card_id;
  if ((typeof sup === "string" || typeof sup === "number") && /^[A-Za-z0-9_-]{1,64}$/.test(String(sup))) return "s:" + String(sup);
  return null;
}
export const cardLabel = (name, last4) => String(name || "Card") + (last4 && !String(name || "").includes(last4) ? " ending " + last4 : "");
const isAmex = (bank) => /american express|\bamex\b/i.test(String(bank || ""));
async function cardRows(db, shopperId, connId) {
  return (await db.prepare("SELECT * FROM bank_cards WHERE shopper_id = ? AND connection_id = ? ORDER BY rowid").bind(shopperId, connId).all()).results || [];
}
// The shopper's own answer for the same card on another of their connections (when they connect it again): the same
// TrueLayer id, or else the same bank, kind and last four digits. Only ever this shopper's.
async function earlierAnswer(db, shopperId, connId, bank, c) {
  const byId = await db.prepare("SELECT mine, auto FROM bank_cards WHERE shopper_id = ? AND connection_id != ? AND card_key = ? AND mine IS NOT NULL ORDER BY seen_at DESC LIMIT 1")
    .bind(shopperId, connId, c.card_key).first();
  if (byId || !c.last4) return byId;
  return db.prepare(`SELECT mine, auto FROM bank_cards WHERE shopper_id = ? AND connection_id != ? AND last4 = ? AND IFNULL(bank, '') = ? AND substr(card_key, 1, 2) = ?
    AND mine IS NOT NULL ORDER BY seen_at DESC LIMIT 1`).bind(shopperId, connId, c.last4, bank || "", c.card_key.slice(0, 2)).first();
}
// Makes sure a card has its row (have: this connection's rows by card_key), carrying an earlier answer over; start: the
// answer a new row starts with when there's none (null: ask).
async function ensureCard(db, shopperId, row, have, c, now, start) {
  const was = have.get(c.card_key);
  if (was) {
    if (was.name !== c.name || was.last4 !== c.last4 || now - was.seen_at > 36e5) {
      await db.prepare("UPDATE bank_cards SET name = ?, last4 = ?, seen_at = ? WHERE shopper_id = ? AND connection_id = ? AND card_key = ?").bind(c.name, c.last4, now, shopperId, row.id, c.card_key).run();
      Object.assign(was, { name: c.name, last4: c.last4, seen_at: now });
    }
    return was;
  }
  const before = await earlierAnswer(db, shopperId, row.id, row.bank, c);
  const fresh = { shopper_id: shopperId, connection_id: row.id, card_key: c.card_key, ref: crypto.randomUUID(), parent_key: c.parent_key || null, provider_id: c.provider_id || null,
    bank: row.bank || null, name: c.name, last4: c.last4 || null, mine: before ? before.mine : start == null ? null : start, auto: before ? before.auto || 0 : 0, seen_at: now };
  await db.prepare(`INSERT OR IGNORE INTO bank_cards (shopper_id, connection_id, card_key, ref, parent_key, provider_id, bank, name, last4, mine, auto, seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(shopperId, row.id, fresh.card_key, fresh.ref, fresh.parent_key, fresh.provider_id, fresh.bank, fresh.name, fresh.last4, fresh.mine, fresh.auto, now).run();
  have.set(c.card_key, fresh);
  return fresh;
}
// What the app is told about a connection's cards: one choice a card (a card split by its payments shows its cards, not
// itself). Only when there's more than one to choose from.
function cardsView(rows) {
  const parents = new Set(rows.filter((r) => r.parent_key).map((r) => r.parent_key));
  const leaves = rows.filter((r) => !parents.has(r.card_key));
  if (leaves.length < 2) return {};
  return { cards: leaves.map((r) => ({ ref: r.ref, label: cardLabel(r.name, r.last4), mine: r.mine === 1 ? true : r.mine === 0 ? false : null })),
    ...(leaves.some((r) => r.mine == null) ? { needsChoice: true } : {}) };
}

// Only payments on a card the shopper said is theirs (or from a connection with nothing to choose): a payment whose card
// isn't theirs, isn't answered yet, or can't be told (no card_ref on a connection that has cards) is never shown, matched,
// counted or exported. t: the table's name or alias in the query.
export const visibleSql = (t) => `(${t}.card_ref IN (SELECT k.ref FROM bank_cards k WHERE k.shopper_id = ${t}.shopper_id AND k.connection_id = ${t}.connection_id AND k.mine = 1)
  OR (${t}.card_ref IS NULL AND NOT EXISTS (SELECT 1 FROM bank_cards k WHERE k.shopper_id = ${t}.shopper_id AND k.connection_id = ${t}.connection_id)))`;

// Reads a connection's payments for the last 90 days, from the cards and accounts that are the shopper's. Returns { ok }
// or { gone } (the bank's permission has ended).
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
  const seen = { accounts: 0, cards: 0, failedLists: 0, failedTx: 0, tx: 0, debits: 0, keptDebits: 0, credits: 0, notChosen: 0, otherCard: 0, marked: 0, leftOutType: {}, leftOutWord: {}, fields: {} };
  // 1. What the connection lists, and which of it is the shopper's (asked when there's more than one).
  const listed = [];
  for (const [list, kind] of [["/data/v1/accounts", "accounts"], ["/data/v1/cards", "cards"]]) {
    const got = await apiGet(env, t.access, list, f);
    if (got.gone) return { gone: true };
    if (got.failed) { seen.failedLists++; continue; }   // a bank with no cards (or no accounts) answers with an error: skip it
    seen[kind] += got.results.length;
    for (const a of got.results.slice(0, 10)) {
      const id = String(a.account_id || "");
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) continue;
      listed.push({ kind, id, card_key: (kind === "cards" ? "c:" : "a:") + id, provider_id: id, name: clip(a.display_name, 60) || (kind === "cards" ? "Card" : "Account"), last4: clip(a.partial_card_number, 4) });
    }
  }
  const have = new Map((await cardRows(db, shopperId, row.id)).map((r) => [r.card_key, r]));
  for (const c of listed) await ensureCard(db, shopperId, row, have, c, now, null);
  const top = [...have.values()].filter((r) => !r.parent_key);
  // One card or account alone is the shopper's, without asking.
  if (listed.length === 1 && top.length === 1 && top[0].mine == null) {
    await db.prepare("UPDATE bank_cards SET mine = 1, auto = 1 WHERE shopper_id = ? AND connection_id = ? AND card_key = ?").bind(shopperId, row.id, top[0].card_key).run();
    top[0].mine = 1; top[0].auto = 1;
  }
  // 2. The payments of each that is theirs. Not theirs, or not answered yet: not read at all.
  let marksSeen = false, amexCardRead = false;
  for (const c of listed) {
    const card = have.get(c.card_key);
    if (card.mine !== 1) { seen.notChosen++; continue; }
    const tx = await apiGet(env, t.access, `/data/v1/${c.kind}/${c.id}/transactions${q}`, f);
    if (tx.gone) return { gone: true };
    if (tx.failed) { seen.failedTx++; continue; }
    seen.tx += tx.results.length;
    if (c.kind === "cards" && isAmex(row.bank)) amexCardRead = true;
    // Which card each payment was on, when the card company says (one account, several cards). A payment that names no
    // card, or names this card's own last four, is this card's.
    const list = tx.results.slice(0, 1000);
    const marks = list.map((x) => { const m = c.kind === "cards" ? txCardMark(x) : null; return m && m !== "n:" + c.last4 ? m : null; });
    if (list.some((x) => c.kind === "cards" && txCardMark(x))) marksSeen = true;
    const children = () => [...have.values()].filter((r) => r.parent_key === c.card_key);
    const split = marks.some(Boolean) || children().length > 0;
    const bucket = new Map();   // mark ("self" for the card itself) -> its row
    if (split) {
      // The card itself starts ticked only if the shopper chose it (not if it was simply the only one): asked again.
      bucket.set("self", await ensureCard(db, shopperId, row, have, { card_key: c.card_key + "|self", parent_key: c.card_key, provider_id: c.provider_id, name: c.name, last4: c.last4 }, now, card.auto ? null : 1));
      for (const m of new Set(marks.filter(Boolean))) {
        const key = c.card_key + "|" + m;
        const others = children().filter((r) => r.card_key.startsWith(c.card_key + "|s:")).length;
        const name = m.startsWith("n:") ? c.name : "Another card on " + c.name + (others && !have.has(key) ? " (" + (others + 1) + ")" : "");
        const was = have.get(key);
        bucket.set(m, await ensureCard(db, shopperId, row, have, { card_key: key, parent_key: c.card_key, provider_id: c.provider_id, name: was ? was.name : name, last4: m.startsWith("n:") ? m.slice(2) : null }, now, null));
      }
    }
    list.forEach((x, i) => {
      const pid = String(x.transaction_id || ""), when = String(x.timestamp || "").slice(0, 10);
      if (!pid || pid.length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(when)) return;
      const on = split ? bucket.get(marks[i] || "self") : card;
      if (on.mine !== 1) { seen.otherCard++; return; }   // another card's payment, not the shopper's (or not answered): not kept
      if (marks[i]) seen.marked++;
      const debit = String(x.transaction_type || "").toUpperCase() === "DEBIT" || (!x.transaction_type && Number(x.amount) < 0);
      if (debit) seen.debits++; else seen.credits++;
      for (const k of Object.keys(x)) seen.fields[k] = (seen.fields[k] || 0) + 1;
      for (const k of Object.keys((x && x.meta) || {})) seen.fields["meta." + k] = (seen.fields["meta." + k] || 0) + 1;
      if (debit && !isShopping(x)) {
        const cat = String(x.transaction_category || "").toUpperCase();
        if (NOT_SHOPPING_TYPES.has(cat)) seen.leftOutType[cat] = (seen.leftOutType[cat] || 0) + 1;
        else { const w = (NOT_SHOPPING.exec(String(x.description || "") + " " + String(merchantOf(x) || "")) || ["?"])[0].toLowerCase().slice(0, 20); seen.leftOutWord[w] = (seen.leftOutWord[w] || 0) + 1; }
        return;
      }
      if (debit) seen.keptDebits++;
      const amount = minor(x.amount); if (!amount) return;
      rows.push({ payment_id: row.id + ":" + pid, account: cardLabel(on.name, on.last4), card_ref: on.ref, paid_on: when, amount_minor: debit ? amount : -amount,
        currency: /^[A-Z]{3}$/.test(String(x.currency || "")) ? x.currency : "GBP", description: clip(x.description, 140), merchant: clip(merchantOf(x), 80),
        classification: classificationToKeep(x) });
    });
  }
  console.log("bank: read", JSON.stringify(seen));
  // A card ticked off while this was reading stays off: only cards still the shopper's are kept.
  const nowRows = await cardRows(db, shopperId, row.id);
  const still = new Set(nowRows.filter((r) => r.mine === 1).map((r) => r.ref));
  const keep = rows.filter((r) => still.has(r.card_ref));
  // Payments read before cards were told apart (no card_ref; older than this read's 90 days) are given the card they were
  // saved under, by its name; a card that isn't theirs loses them. One saved under a card split by its payments was on
  // either card: Relay can't tell whose, so it goes. Any left without a card are never shown (visibleSql).
  const kidsOf = new Set(nowRows.filter((r) => r.parent_key).map((r) => r.parent_key));
  const legacy = [];
  for (const r of nowRows.filter((x) => !x.parent_key)) {
    const args = [shopperId, row.id, cardLabel(r.name, r.last4)];
    legacy.push(kidsOf.has(r.card_key) || r.mine === 0
      ? db.prepare("DELETE FROM bank_payments WHERE shopper_id = ? AND connection_id = ? AND card_ref IS NULL AND account = ?").bind(...args)
      : db.prepare("UPDATE bank_payments SET card_ref = ? WHERE shopper_id = ? AND connection_id = ? AND card_ref IS NULL AND account = ?").bind(r.ref, ...args));
  }
  if (legacy.length) await db.batch(legacy);
  // A full read of the last 90 days replaces what was read before for those days (so anything Relay no longer keeps goes).
  await db.prepare("DELETE FROM bank_payments WHERE shopper_id = ? AND connection_id = ? AND paid_on >= ?").bind(shopperId, row.id, new Date(now - LOOK_BACK_DAYS * DAY).toISOString().slice(0, 10)).run();
  if (keep.length) await db.batch(keep.map((r) => db.prepare(`INSERT INTO bank_payments (shopper_id, payment_id, connection_id, account, paid_on, amount_minor, currency, description, merchant, classification, card_ref, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(shopper_id, payment_id) DO UPDATE SET account = excluded.account, description = excluded.description, merchant = excluded.merchant,
      classification = excluded.classification, card_ref = excluded.card_ref`)
    .bind(shopperId, r.payment_id, row.id, r.account, r.paid_on, r.amount_minor, r.currency, r.description, r.merchant, r.classification, r.card_ref, now)));
  // An Amex card whose payments said nothing about which card each was on: the app says Relay can't tell them apart.
  await db.prepare("UPDATE bank_links SET synced_at = ?, status = 'ok', unsplit = ? WHERE id = ?").bind(now, amexCardRead && !marksSeen ? 1 : 0, row.id).run();
  return { ok: true, read: keep.length };
}

// Reads every connection of a shopper (at most once every 10 minutes unless forced), then matches payments to receipts.
export async function syncBank(env, shopperId, now, f, force, matchOnly) {
  const db = env.RELAY_DB;
  now = now || Date.now();
  // matchOnly: no reading from the banks, just matching again (after "Not mine").
  const conns = matchOnly ? [] : (await db.prepare("SELECT * FROM bank_links WHERE shopper_id = ?").bind(shopperId).all()).results || [];
  let read = 0, gone = 0;
  for (const c of conns) {
    if (!force && c.synced_at && now - c.synced_at < SYNC_GAP) continue;
    const r = await readConnection(env, db, shopperId, c, now, f);
    if (r.gone) { gone++; await db.prepare("UPDATE bank_links SET status = 'reconnect' WHERE id = ?").bind(c.id).run(); }
    else read += r.read || 0;
  }
  // Payments older than 13 months go.
  await db.prepare("DELETE FROM bank_payments WHERE shopper_id = ? AND paid_on < ?").bind(shopperId, new Date(now - 400 * DAY).toISOString().slice(0, 10)).run();
  const not = await notMineOf(db, shopperId);
  const payments = ((await db.prepare("SELECT payment_id, paid_on, amount_minor, currency, description, merchant FROM bank_payments WHERE shopper_id = ? AND " + visibleSql("bank_payments")).bind(shopperId).all()).results || [])
    .filter((p) => !isNotMine(not, p.payment_id, shopName(p.description, p.merchant)));
  // A receipt made from the shopper's own photo belongs to the payment it was added for, whatever the amounts say.
  const receipts = await receiptTotals(env, shopperId);
  const photoLinks = new Map(receipts.filter((r) => r.bankPaymentId).map((r) => [r.bankPaymentId, r.id]));
  const matches = matchPayments(payments.filter((p) => !photoLinks.has(p.payment_id)), receipts.filter((r) => !r.bankPaymentId));
  for (const p of payments) if (photoLinks.has(p.payment_id)) matches.set(p.payment_id, { receiptId: photoLinks.get(p.payment_id), match: "photo" });
  await db.batch([db.prepare("UPDATE bank_payments SET receipt_id = NULL, match = NULL WHERE shopper_id = ?").bind(shopperId),
    ...[...matches].map(([pid, m]) => db.prepare("UPDATE bank_payments SET receipt_id = ?, match = ? WHERE shopper_id = ? AND payment_id = ?").bind(m.receiptId, m.match, shopperId, pid))]);
  return { read, gone, matched: matches.size };
}

// What the shopper said isn't theirs: { payments: Set, shops: Set }, and which payments weren't a shop purchase (noReceipt).
async function notMineOf(db, shopperId) {
  const rows = (await db.prepare("SELECT kind, key FROM bank_not_mine WHERE shopper_id = ?").bind(shopperId).all().catch(() => ({ results: [] }))).results || [];
  const of = (k) => new Set(rows.filter((r) => r.kind === k).map((r) => r.key));
  return { payments: of("payment"), shops: of("shop"), noReceipt: of("no_receipt") };
}
const shopKey = (name) => String(name || "").toLowerCase().trim().slice(0, 80);
export const isNotMine = (not, paymentId, shop) => not.payments.has(String(paymentId)) || (Boolean(shop) && not.shops.has(shopKey(shop)));

// ---- Payments that likely should have a receipt ---------------------------------------------------------------------------
// Connor (17 Nov 2026): "When we find a transaction from banks that don't have receipts, but likely should (eg H&M purchase)
// the app should highlight this", and "How can we ensure Relay knows all shops?" (shop-directory.js). The rule, all of it:
//   a card payment out (not money coming in) of at least £5 (RECEIPT_MIN_PENCE), with no receipt matched to it; then
//   the first of these that has something to say decides:
//   1. The shopper's own word: not theirs (one payment, or every one from that shop), or "This wasn't a shop purchase": no.
//   2. Things that never need a receipt kept: bills, transfers, cash, rent (NOT_SHOPPING; never kept anyway), food and
//      drink, groceries, food delivery, transport, fuel, apps, subscriptions, donations (NO_RECEIPT), and a shop on the
//      seed list of one of those kinds (supermarkets: EXCLUDED_KINDS): no.
//   3. A shop on the seed list (shop-seed.js: 600+ real UK shops that sell things): yes.
//   4. TrueLayer's own label for the payment (classificationSays): Shopping (not Groceries), Books & Supplies, Gift,
//      Office Supplies: yes. Food & Dining, Bills, Transport, Travel, Entertainment, Home (rent, mortgage), Groceries…: no.
//   5. A shop Relay has seen send receipts to at least two different shoppers (shop_directory, loaded once per request): yes.
//   6. Its name says it's a shop (RETAIL_WORDS: "clothing", "boutique", "furniture" and so on): yes.
//   Otherwise no: a shop Relay doesn't know is left alone rather than guessed at.
// A supermarket payment isn't highlighted, but like any payment without a receipt the shopper can still add a photo of it.
export const RECEIPT_MIN_PENCE = 500;
const RETAIL_WORDS = /\b(clothing|clothes|fashion|boutique|apparel|outfitters?|footwear|shoes?|jewell?e?ry|jewellers?|cosmetics|perfumery|electricals?|electronics|furniture|homewares?|interiors|department store|bookshop|toys?)\b/i;
const NO_RECEIPT = /prime video|amazon prime|prime member|\baudible\b|\bkindle\b|amazon music|amazon digital|apple\.com\/bill|\bitunes\b|app ?store|google play|netflix|spotify|disney|youtube|\buber\b|\bbolt\b|trainline|\btfl\b|national rail|\brail\b|parking|ringgo|paybyphone|\bfuel\b|petrol|\besso\b|texaco|deliveroo|just ?eat|food|\bcaf(e|é)\b|coffee|restaurant|takeaway|pizza|burger|\bbar\b|\bpub\b|tesco|sainsbury|\basda\b|morrisons|\baldi\b|\blidl\b|waitrose|co-?op\b|iceland|ocado|greggs|\bpret\b|costa|starbucks|mcdonald|\bkfc\b|subway|nando|charity|donation|patreon/i;
// Which source decided: "seed", "truelayer", "learned" or "words"; null when the payment isn't highlighted.
// dir: the learned shops (shop-directory.js loadShopDirectory), loaded once for all of a request's payments.
export function whyNeedsReceipt(p, not, dir) {
  if (!p || p.receipt_id || !(Number(p.amount_minor) >= RECEIPT_MIN_PENCE)) return null;
  const shop = shopName(p.description, p.merchant);
  if (not && (isNotMine(not, p.payment_id, shop) || (not.noReceipt && not.noReceipt.has(String(p.payment_id))))) return null;
  const parts = [shop, p.merchant, statementShop(p.description)].filter(Boolean);
  const text = parts.join(" | ");
  if (!text || NOT_SHOPPING.test(text) || NO_RECEIPT.test(text)) return null;
  const seed = seedShops(parts);
  if (seed.some((s) => EXCLUDED_KINDS.has(s.kind))) return null;
  if (seed.length) return "seed";
  const said = classificationSays(p.classification);
  if (said) return said === "yes" ? "truelayer" : null;
  if (learnedShop(dir, parts)) return "learned";
  return RETAIL_WORDS.test(text) ? "words" : null;
}
export const likelyNeedsReceipt = (p, not, dir) => whyNeedsReceipt(p, not, dir) !== null;
const paymentForApp = (r) => ({ id: r.payment_id, account: r.account, date: r.paid_on, amountPence: r.amount_minor, currency: r.currency, shop: shopName(r.description, r.merchant) });
// For Home (gmail.js adds these to /relay/my/receipts, which Home already asks for, so it costs no extra request): the
// newest payments of the last 30 days that likely should have a receipt and don't. Nothing when no bank is connected.
export async function receiptsToAdd(env, shopperId, now) {
  try {
    const since = new Date((now || Date.now()) - 30 * DAY).toISOString().slice(0, 10);
    await ensureBankColumns(env.RELAY_DB);
    const rows = (await env.RELAY_DB.prepare(`SELECT payment_id, account, paid_on, amount_minor, currency, description, merchant, classification, receipt_id FROM bank_payments
      WHERE shopper_id = ? AND receipt_id IS NULL AND amount_minor >= ? AND paid_on >= ? AND ${visibleSql("bank_payments")} ORDER BY paid_on DESC, payment_id LIMIT 200`).bind(shopperId, RECEIPT_MIN_PENCE, since).all()).results || [];
    if (!rows.length) return [];
    const not = await notMineOf(env.RELAY_DB, shopperId), dir = await loadShopDirectory(env.RELAY_DB);
    // photoRead: whether Relay can read a photo of the receipt (the AI reader is on), so the app says what will happen.
    return rows.filter((r) => likelyNeedsReceipt(r, not, dir)).slice(0, 5).map((r) => ({ ...paymentForApp(r), photoRead: aiAvailable(env) }));
  } catch { return []; }   // no bank tables yet: nothing to say
}

// Money back, for a return's "Refund received" (return-tracking.js, 24 Nov 2026): money that came in on the shopper's own
// cards and accounts (never one that isn't theirs, or a payment or shop they said isn't theirs), newest first. Only the
// day, the amount, the bank's own text for it and which card or account; which return it belongs to, if any, is worked
// out there against that shopper's own receipts. Nothing when no bank is connected. Read with the receipts list, which the
// app already asks for, so it costs no extra request.
export async function refundCredits(env, shopperId) {
  try {
    await ensureBankColumns(env.RELAY_DB);
    const rows = (await env.RELAY_DB.prepare(`SELECT payment_id, account, paid_on, amount_minor, currency, description, merchant FROM bank_payments
      WHERE shopper_id = ? AND amount_minor < 0 AND ${visibleSql("bank_payments")} ORDER BY paid_on DESC, payment_id LIMIT 300`).bind(shopperId).all()).results || [];
    if (!rows.length) return [];
    const not = await notMineOf(env.RELAY_DB, shopperId);
    return rows.filter((r) => !isNotMine(not, r.payment_id, shopName(r.description, r.merchant)))
      .map((r) => ({ id: r.payment_id, on: r.paid_on, pence: -r.amount_minor, currency: r.currency || "GBP", account: r.account || null,
        text: ((r.merchant || "") + " " + statementShop(r.description)).trim() }));
  } catch { return []; }   // no bank tables yet: no bank connected
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

// The banks offered as one tap in getting started (Connor, 17 Nov 2026), so TrueLayer can skip its own list of banks.
// Relay doesn't keep TrueLayer's ids itself: it reads TrueLayer's public list of banks for this app and takes the one
// whose name matches (open banking, personal), so a tap goes straight to that bank. If the list can't be read or nothing
// matches, TrueLayer shows its own list as before. Nothing about the shopper is sent to read the list.
export const BANK_CHOICES = {
  amex: /^american express\b/i, barclays: /^barclays( uk| bank)?$/i, chase: /^chase\b/i, firstdirect: /^first ?direct\b/i,
  halifax: /^halifax\b/i, hsbc: /^hsbc( uk)?$/i, lloyds: /^lloyds( bank)?$/i, monzo: /^monzo\b/i, nationwide: /^nationwide\b/i,
  natwest: /^natwest\b/i, revolut: /^revolut\b/i, santander: /^santander( uk)?\b/i, starling: /^starling\b/i, tsb: /^tsb\b/i,
};
const NOT_PERSONAL = /business|corporate|commercial|bankline|kinetic|private|wealth|premier|international|isle of man|jersey|guernsey|gibraltar/i;
let providerList = null;   // { at, list } for an hour in this copy of the Worker
export function pickProvider(list, choice) {
  const want = BANK_CHOICES[choice];
  if (!want || !Array.isArray(list)) return null;
  const hits = list.map((p) => ({ id: String((p && (p.provider_id || p.id)) || ""), name: String((p && p.display_name) || "").trim(), country: String((p && p.country) || "").toLowerCase() }))
    .filter((p) => /^[a-z0-9-]{3,60}$/.test(p.id) && want.test(p.name) && !NOT_PERSONAL.test(p.name) && (!p.country || p.country === "uk" || p.country === "gb"));
  hits.sort((a, b) => (b.id.startsWith("ob-") - a.id.startsWith("ob-")) || a.name.length - b.name.length);
  return hits[0] ? hits[0].id : null;
}
async function providerFor(env, choice, now, fetchImpl) {
  if (!BANK_CHOICES[choice] || !bankLive(env)) return null;
  const list = await providers(env, now, fetchImpl);
  return list ? pickProvider(list, choice) : null;
}
// Which of the listed banks TrueLayer can connect for Relay's app (Connor, 17 Nov 2026: Chase and Halifax aren't on its
// list, so their tiles went to TrueLayer's list instead, and Chase can't be connected at all). null when it can't be told.
async function choicesOffered(env, now, fetchImpl) {
  if (!bankLive(env)) return null;
  const list = await providers(env, now, fetchImpl);
  return list ? Object.keys(BANK_CHOICES).filter((k) => pickProvider(list, k)) : null;
}
async function providers(env, now, fetchImpl) {
  if (!providerList || now - providerList.at > 36e5) {
    try {
      const r = await (fetchImpl || fetch)(hosts(env).auth + "/api/providers?clientId=" + encodeURIComponent(env.TRUELAYER_CLIENT_ID), { signal: AbortSignal.timeout(5000) });
      const list = r.ok ? await r.json() : null;
      if (Array.isArray(list)) providerList = { at: now, list };
    } catch {}   // not answering: the last list, if there is one
  }
  return providerList ? providerList.list : null;
}

// One connection as the app sees it: its bank, when it was read, what was found, and which of its cards are the shopper's.
async function connectionView(db, shopperId, c) {
  return { id: c.id, bank: bankName(c.bank), connectedAt: new Date(c.connected_at).toISOString(), syncedAt: c.synced_at ? new Date(c.synced_at).toISOString() : null,
    needsReconnect: c.status === "reconnect", payments: Number(c.payments) || 0, matched: Number(c.matched) || 0,
    ...cardsView(await cardRows(db, shopperId, c.id)), ...(c.unsplit === 1 ? { unsplit: true } : {}) };
}

export async function handleBankRoute(path, method, request, env, url, cors, shopper, o) {
  if (!path.startsWith("/relay/my/bank")) return null;
  const db = env.RELAY_DB; await ensureBankTables(db);
  const ok = await allowed(env, shopper);
  if (path === "/relay/my/bank" && method === "GET") {
    if (!ok) return json({ available: false, connections: [] }, 200, cors);
    const conns = (await db.prepare(`SELECT c.id, c.bank, c.connected_at, c.synced_at, c.status, c.unsplit, COUNT(p.payment_id) AS payments, SUM(CASE WHEN p.receipt_id IS NOT NULL THEN 1 ELSE 0 END) AS matched
      FROM bank_links c LEFT JOIN bank_payments p ON p.connection_id = c.id AND p.shopper_id = c.shopper_id AND ${visibleSql("p")} WHERE c.shopper_id = ? GROUP BY c.id ORDER BY c.connected_at`).bind(shopper.id).all()).results || [];
    const choices = await choicesOffered(env, o.now, o.fetchImpl);
    const views = [];
    for (const c of conns) views.push(await connectionView(db, shopper.id, c));
    return json({ available: true, testBanks: !bankLive(env), ...(choices ? { choices } : {}), connections: views }, 200, cors);
  }
  if (!ok) return json({ error: "not_found" }, 404, cors);
  if (path === "/relay/my/bank/connect" && method === "POST") {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM bank_links WHERE shopper_id = ?").bind(shopper.id).first();
    if (n && n.n >= 5) return json({ error: "too_many_banks", max: 5 }, 409, cors);
    const state = randomToken();
    await db.prepare("DELETE FROM bank_link_states WHERE expires_at < ?").bind(o.now).run();
    await db.prepare("INSERT INTO bank_link_states (state_hash, shopper_id, expires_at) VALUES (?,?,?)").bind(await sha256Hex(state), shopper.id, o.now + STATE_LIFE).run();
    const b = await request.json().catch(() => null);
    const choice = b && typeof b.bank === "string" ? b.bank : null;
    const q = new URLSearchParams({ response_type: "code", client_id: env.TRUELAYER_CLIENT_ID, redirect_uri: redirectUri(env, url), scope: BANK_SCOPES, state,
      providers: bankLive(env) ? "uk-ob-all uk-oauth-all" : "uk-cs-mock uk-ob-all uk-oauth-all" });
    const providerId = choice ? await providerFor(env, choice, o.now, o.fetchImpl) : null;
    if (providerId) q.set("provider_id", providerId);
    return json({ url: hosts(env).auth + "/?" + q.toString().replace(/\+/g, "%20") }, 200, cors);
  }
  if (path === "/relay/my/bank/sync" && method === "POST") return json(await syncBank(env, shopper.id, o.now, o.fetchImpl, false), 200, cors);
  if (path === "/relay/my/bank/payments" && method === "GET") {
    const rows = (await db.prepare(`SELECT payment_id, account, paid_on, amount_minor, currency, description, merchant, classification, receipt_id, match FROM bank_payments
      WHERE shopper_id = ? AND amount_minor > 0 AND ${visibleSql("bank_payments")} ORDER BY paid_on DESC, payment_id LIMIT 200`).bind(shopper.id).all()).results || [];
    const not = await notMineOf(db, shopper.id), dir = rows.length ? await loadShopDirectory(db) : null;
    return json({ photoRead: aiAvailable(env), payments: rows.map((r) => { const shop = shopName(r.description, r.merchant); return { id: r.payment_id, account: r.account, date: r.paid_on, amountPence: r.amount_minor, currency: r.currency,
      description: r.description, merchant: r.merchant, shop, receiptId: r.receipt_id || null, match: r.match || null,
      notMine: isNotMine(not, r.payment_id, shop) ? (not.payments.has(String(r.payment_id)) ? "payment" : "shop") : null,
      ...(not.noReceipt.has(String(r.payment_id)) ? { noReceipt: true } : {}), ...(likelyNeedsReceipt(r, not, dir) ? { needsReceipt: true } : {}) }; }) }, 200, cors);
  }
  // POST { id, on, everyFromShop }: a payment isn't theirs (someone else's card on a shared account), or is after all.
  // With everyFromShop, every payment from that shop too. Then matching runs again without them.
  // With reason "no_receipt": the payment wasn't a shop purchase, so Relay stops asking for its receipt (or, off, asks again).
  if (path === "/relay/my/bank/not-mine" && method === "POST") {
    const b = await request.json().catch(() => null);
    if (!b || typeof b.id !== "string" || !b.id || b.id.length > 200 || typeof b.on !== "boolean" || (b.reason != null && b.reason !== "no_receipt")) return json({ error: "invalid_request" }, 400, cors);
    const p = await db.prepare("SELECT payment_id, description, merchant FROM bank_payments WHERE shopper_id = ? AND payment_id = ? AND " + visibleSql("bank_payments")).bind(shopper.id, b.id).first();
    if (!p) return json({ error: "not_found" }, 404, cors);
    if (b.reason === "no_receipt") {
      await (b.on ? db.prepare("INSERT OR IGNORE INTO bank_not_mine (shopper_id, kind, key, created_at) VALUES (?, 'no_receipt', ?, ?)").bind(shopper.id, p.payment_id, o.now || Date.now())
        : db.prepare("DELETE FROM bank_not_mine WHERE shopper_id = ? AND kind = 'no_receipt' AND key = ?").bind(shopper.id, p.payment_id)).run();
      return json({ ok: true }, 200, cors);
    }
    const key = shopKey(shopName(p.description, p.merchant)), now = o.now || Date.now();
    const st = b.on
      ? [db.prepare("INSERT OR IGNORE INTO bank_not_mine (shopper_id, kind, key, created_at) VALUES (?, 'payment', ?, ?)").bind(shopper.id, p.payment_id, now),
        ...(b.everyFromShop === true && key ? [db.prepare("INSERT OR IGNORE INTO bank_not_mine (shopper_id, kind, key, created_at) VALUES (?, 'shop', ?, ?)").bind(shopper.id, key, now)] : [])]
      : [db.prepare("DELETE FROM bank_not_mine WHERE shopper_id = ? AND kind = 'payment' AND key = ?").bind(shopper.id, p.payment_id),
        ...(key ? [db.prepare("DELETE FROM bank_not_mine WHERE shopper_id = ? AND kind = 'shop' AND key = ?").bind(shopper.id, key)] : [])];
    await db.batch(st);
    const r = await syncBank(env, shopper.id, o.now, o.fetchImpl, false, true);
    return json({ ok: true, matched: r.matched }, 200, cors);
  }
  if (path === "/relay/my/bank/receipt-photo" && method === "POST") return addReceiptPhoto(env, request, cors, shopper, o);
  // POST { id, cards: [{ ref, mine }] }: which of one of their own connection's cards and accounts are theirs. A card ticked
  // off: its payments are deleted (and what was said about them) and it's never read again; one ticked on is read now.
  if (path === "/relay/my/bank/cards" && method === "POST") {
    const b = await request.json().catch(() => null);
    const uuid = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);
    if (!b || !uuid(b.id) || !Array.isArray(b.cards) || !b.cards.length || b.cards.length > 40
      || !b.cards.every((c) => c && uuid(c.ref) && typeof c.mine === "boolean")) return json({ error: "invalid_request" }, 400, cors);
    const conn = await db.prepare("SELECT * FROM bank_links WHERE id = ? AND shopper_id = ?").bind(b.id, shopper.id).first();
    if (!conn) return json({ error: "not_found" }, 404, cors);
    const rows = await cardRows(db, shopper.id, conn.id), byRef = new Map(rows.map((r) => [r.ref, r]));
    const parents = new Set(rows.filter((r) => r.parent_key).map((r) => r.parent_key));
    if (!b.cards.every((c) => byRef.has(c.ref) && !parents.has(byRef.get(c.ref).card_key))) return json({ error: "not_found" }, 404, cors);
    const st = [], on = [];
    for (const c of b.cards) {
      const r = byRef.get(c.ref);
      if (c.mine && r.mine !== 1) on.push(r);
      st.push(db.prepare("UPDATE bank_cards SET mine = ?, auto = 0 WHERE shopper_id = ? AND connection_id = ? AND ref = ?").bind(c.mine ? 1 : 0, shopper.id, conn.id, r.ref));
      r.mine = c.mine ? 1 : 0;
      if (!c.mine) {
        // Its payments go, and what the shopper said about them. (Payments read before cards were told apart have no
        // card_ref: they're found by the card's name, as they were saved.)
        const which = "shopper_id = ? AND connection_id = ? AND (card_ref = ? OR (card_ref IS NULL AND account = ?))";
        const args = [shopper.id, conn.id, r.ref, cardLabel(r.name, r.last4)];
        st.push(db.prepare(`DELETE FROM bank_not_mine WHERE shopper_id = ? AND kind IN ('payment', 'no_receipt') AND key IN (SELECT payment_id FROM bank_payments WHERE ${which})`).bind(shopper.id, ...args));
        st.push(db.prepare(`DELETE FROM bank_payments WHERE ${which}`).bind(...args));
      }
    }
    // A card split into its cards is read while any of them is (or may be) the shopper's.
    for (const pk of parents) {
      const kids = rows.filter((r) => r.parent_key === pk);
      st.push(db.prepare("UPDATE bank_cards SET mine = ? WHERE shopper_id = ? AND connection_id = ? AND card_key = ?").bind(kids.some((k) => k.mine !== 0) ? 1 : 0, shopper.id, conn.id, pk));
    }
    await db.batch(st);
    if (on.length) {
      const r = await readConnection(env, db, shopper.id, conn, o.now || Date.now(), o.fetchImpl);
      if (r.gone) await db.prepare("UPDATE bank_links SET status = 'reconnect' WHERE id = ?").bind(conn.id).run();
    }
    await syncBank(env, shopper.id, o.now, o.fetchImpl, false, true);
    const view = await db.prepare(`SELECT c.id, c.bank, c.connected_at, c.synced_at, c.status, c.unsplit, COUNT(p.payment_id) AS payments, SUM(CASE WHEN p.receipt_id IS NOT NULL THEN 1 ELSE 0 END) AS matched
      FROM bank_links c LEFT JOIN bank_payments p ON p.connection_id = c.id AND p.shopper_id = c.shopper_id AND ${visibleSql("p")} WHERE c.id = ? AND c.shopper_id = ? GROUP BY c.id`).bind(conn.id, shopper.id).first();
    return json({ ok: true, connection: await connectionView(db, shopper.id, view) }, 200, cors);
  }
  if (path === "/relay/my/bank/disconnect" && method === "POST") {
    const b = await request.json().catch(() => null);
    if (!b || typeof b.id !== "string" || !/^[0-9a-f-]{36}$/.test(b.id)) return json({ error: "invalid_request" }, 400, cors);
    const own = await db.prepare("SELECT 1 AS x FROM bank_links WHERE id = ? AND shopper_id = ?").bind(b.id, shopper.id).first();
    if (!own) return json({ error: "not_found" }, 404, cors);
    await db.batch([db.prepare("DELETE FROM bank_payments WHERE shopper_id = ? AND connection_id = ?").bind(shopper.id, b.id),
      db.prepare("DELETE FROM bank_cards WHERE shopper_id = ? AND connection_id = ?").bind(shopper.id, b.id),
      db.prepare("DELETE FROM bank_links WHERE id = ? AND shopper_id = ?").bind(b.id, shopper.id)]);
    return json({ ok: true }, 200, cors);
  }
  return json({ error: "not_found" }, 404, cors);
}

// ---- "Add a photo of the receipt" -------------------------------------------------------------------------------------------
// POST /relay/my/bank/receipt-photo { id, image }: the shopper's photo of the paper receipt for one of their own payments
// (made smaller on their phone first: a JPEG, PNG or WebP of at most 1.1 MB, checked by its bytes). Relay keeps the photo
// and makes a receipt from it, linked to that payment, marked everywhere as "Receipt from your photo", never as the shop's
// own. With the AI reader on (receipt-photo.js), what Claude read from the photo; otherwise, or when it can't read it, only
// what the bank says (shop, amount, date) and no items. A total on the photo that isn't what the bank paid is kept as it is,
// and the app shows both. 20 photos a shopper a day; 1,000 read by AI a day across Relay (after that, kept without reading).
export const RECEIPT_PHOTOS_PER_DAY = 20;
export const RECEIPT_PHOTO_AI_ALL_DAY = 1000;
// The items a photo's reading keeps (round 7). Only from a reading the AI was reasonably sure of: from a "low" one (most of it
// hard to read) none are kept, so none are invented, and the receipt says Relay couldn't read them. Kept items go through
// the same totals check as an email's (receipt-items.js checkItems): when they don't add up to the photo's own total, the
// receipt says Relay may have missed some. No reading at all (AI off, busy, not a receipt): no items and no check.
export function photoItemsOf(read, confidence, photoTotal) {
  if (!read) return { items: [], itemsCheck: null };
  const unsure = confidence !== "high" && confidence !== "medium";
  const items = !unsure && Array.isArray(read.items) ? read.items : [];
  return { items, itemsCheck: { ...checkItems(items, {}, photoTotal), ...(items.length ? namesCheck(items) : {}), ...(unsure ? { unsure: true } : {}) } };
}
async function addReceiptPhoto(env, request, cors, shopper, o) {
  const db = env.RELAY_DB, now = o.now || Date.now();
  const b = await request.json().catch(() => null);
  if (!b || typeof b.id !== "string" || !b.id || b.id.length > 200 || typeof b.image !== "string") return json({ error: "invalid_request" }, 400, cors);
  const photo = decodePhoto(b.image, MAX_RECEIPT_PHOTO_BYTES);
  if (photo && photo.error) return json({ error: "photo_too_big" }, 413, cors);
  if (!photo) return json({ error: "bad_photo" }, 400, cors);
  const p = await db.prepare("SELECT payment_id, account, paid_on, amount_minor, currency, description, merchant, receipt_id FROM bank_payments WHERE shopper_id = ? AND payment_id = ? AND " + visibleSql("bank_payments"))
    .bind(shopper.id, b.id).first();
  if (!p || !(p.amount_minor > 0)) return json({ error: "not_found" }, 404, cors);
  await ensureGmailTables(db);
  if (p.receipt_id) {
    const has = await db.prepare("SELECT 1 AS x FROM captured_receipts WHERE id = ? AND shopper_id = ? AND status NOT IN ('dismissed','not_receipt')").bind(p.receipt_id, shopper.id).first();
    if (has) return json({ error: "has_receipt", receiptId: p.receipt_id }, 409, cors);
  }
  const mine = await db.prepare("SELECT COUNT(*) AS n FROM receipt_photos WHERE shopper_id = ? AND created_at > ?").bind(shopper.id, now - DAY).first();
  if (Number((mine && mine.n) || 0) >= RECEIPT_PHOTOS_PER_DAY) return json({ error: "too_many_requests" }, 429, cors);
  const all = await db.prepare("SELECT COUNT(*) AS n FROM receipt_photos WHERE ai = 1 AND created_at > ?").bind(now - DAY).first();
  const full = Number((all && all.n) || 0) >= RECEIPT_PHOTO_AI_ALL_DAY;
  const got = full ? { error: "ai_busy" } : await readReceiptPhoto(env, photo, new Date(now + DAY).toISOString().slice(0, 10), o.fetchImpl || fetch, { shopperId: shopper.id, now });
  const asked = !full && got.error !== "ai_off";   // (over the spending limit counts as off: nothing was asked)   // a read was asked of Anthropic (counted for the limit across Relay)
  const read = got.reading && got.reading.isPurchase ? got.reading : null;
  const bankCurrency = p.currency || "GBP";
  const bankPaid = { amountPence: p.amount_minor, currency: bankCurrency, date: p.paid_on, account: p.account || null };
  const photoTotal = read && read.totalPence != null ? read.totalPence : null;
  const photoCurrency = photoTotal != null ? (read.currency || bankCurrency) : null;
  const { items: photoItems, itemsCheck } = photoItemsOf(read, got.confidence, photoTotal);
  const details = {
    kind: "receipt", source: "receipt_photo", photoReceipt: true, bankPaymentId: p.payment_id,
    retailer: { name: (read && read.shop) || shopName(p.description, p.merchant) || "Shop", domain: null },
    orderDate: (read && read.orderDate) || p.paid_on, orderDateFrom: read && read.orderDate ? "photo" : "bank",
    // The total is what the photo says when it says one, otherwise what the bank paid: never one forced to fit the other.
    totalPence: photoTotal != null ? photoTotal : p.amount_minor, currency: photoTotal != null ? photoCurrency : bankCurrency,
    totalFrom: photoTotal != null ? "photo" : "bank",
    items: photoItems, ...(itemsCheck ? { itemsCheck } : {}),
    receiptNumber: read && read.orderRef ? read.orderRef : null,
    readBy: read ? "ai" : null, confidence: read ? got.confidence : null,
    // Why nothing was read from the photo: "off" (no AI reader), "unclear" (no receipt could be read in it), "busy".
    ...(read ? {} : { photoNotRead: got.error === "ai_off" ? "off" : got.reading || got.error === "unreadable" ? "unclear" : "busy" }),
    bankPaid,
    ...(photoTotal != null && (photoTotal !== p.amount_minor || photoCurrency !== bankCurrency) ? { totalMismatch: true } : {}),
    needsShopperConfirmation: Boolean(read), refundEligible: false
  };
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO captured_receipts (id,shopper_id,message_ref,status,details,created_at) VALUES (?,?,?,?,?,?)")
      .bind(id, shopper.id, "photo:" + p.payment_id + ":" + now, "pending", JSON.stringify(details), now),
    db.prepare("INSERT INTO receipt_photos (receipt_id, shopper_id, type, data, ai, created_at) VALUES (?,?,?,?,?,?)").bind(id, shopper.id, photo.type, photo.data, asked ? 1 : 0, now),
    db.prepare("UPDATE bank_payments SET receipt_id = ?, match = 'photo' WHERE shopper_id = ? AND payment_id = ?").bind(id, shopper.id, p.payment_id)]);
  return json({ ok: true, receipt: { id, shop: details.retailer.name, date: details.orderDate, dateFrom: details.orderDateFrom, items: details.items,
    totalPence: details.totalPence, currency: details.currency, totalFrom: details.totalFrom, readBy: details.readBy, confidence: details.confidence,
    photoNotRead: details.photoNotRead || null, totalMismatch: Boolean(details.totalMismatch), bankPaid, receiptNumber: details.receiptNumber } }, 200, cors);
}
