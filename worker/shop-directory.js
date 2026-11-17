// Relay's shop directory: how Relay tells that a card payment was at a shop that sells things, so it likely should have a
// receipt (bank.js likelyNeedsReceipt). Connor, 17 Nov 2026: "How can we ensure Relay knows all shops?" No fixed list can,
// so three sources are used, each only as far as it can be trusted:
//
//  1. The seed list (shop-seed.js): over 600 real UK shops by kind, written by Relay's team. Supermarkets are on it as
//     "supermarket", so they are known but not highlighted.
//  2. TrueLayer's own label on each payment (transaction_classification, e.g. ["Shopping", "Clothing"]), kept with the
//     payment when the bank is read. TrueLayer documents its labels at docs.truelayer.com/docs/transaction-types; Relay
//     reads them by their words, ignoring case, and anything it doesn't recognise counts for nothing (classificationSays).
//  3. Shops Relay has learned send receipts (the shop_directory table): every time a shopper's receipt email is saved, its
//     shop's name or web address is counted there. A shop counts once at least two different shoppers have had a receipt
//     from it, so no single person's mail (or a pasted email) can add a shop.
//
// What shop_directory keeps (it is not personal data): the shop's key (its web address or name, letters and digits only),
// the name to show, its kind, how many receipts and how many different shoppers, and the first and last DAY it was seen.
// Never who, never the order, amount, items or email. To count different shoppers without keeping who they are, Relay
// looks at the shopper's own receipts (already kept for them, and deleted with their account) when a new one is saved:
// if they had none from that shop before, the shop's shopper count goes up by one. Nothing links a count to a person, so
// deleting an account can't take its count back out (the counts may run a little high; they only ever decide a highlight).
// Left out: receipts made from a shopper's photo (no receipt came from the shop), Relay's own test and demo shops, the
// App Review account, shops on payment or mail companies' addresses with no name of their own, personal email addresses
// and names that look like a person's.
import { SEED, PATTERNS } from "./shop-seed.js";
import { domainBase, isVia, looksLikePerson, cleanShopName } from "./receipt-reader.js";
import { categorise, PERSONAL_MAIL as KNOWN_PERSONAL_MAIL } from "./receipt-category.js";
import { isReviewAddress } from "./review-account.js";

export const SHOP_DIRECTORY_SQL = `CREATE TABLE IF NOT EXISTS shop_directory (key TEXT PRIMARY KEY, name TEXT, kind TEXT, source TEXT NOT NULL,
  receipts INTEGER NOT NULL DEFAULT 0, shoppers INTEGER NOT NULL DEFAULT 0, first_seen TEXT, last_seen TEXT)`;
// A learned shop counts from this many different shoppers.
export const LEARNED_MIN_SHOPPERS = 2;
// At most this many learned shops are loaded for one request (the most seen first).
export const LEARNED_MAX_ROWS = 5000;
// Kinds that never need a receipt highlighted: groceries, eating out, travel, apps and subscriptions, tickets.
export const EXCLUDED_KINDS = new Set(["supermarket", "food", "travel", "digital", "experiences"]);

// Text made plain for matching: lower case, no accents or apostrophes, "&" and "+" as "and", everything else a space.
export const plain = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "")
  .replace(/[&+]/g, " and ").replace(/[^a-z0-9?|]+/g, " ").replace(/\s+/g, " ").trim();
const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- 1. The seed list ---------------------------------------------------------------------------------------------------
const SEED_SHOPS = [];
for (const [kind, list] of Object.entries(SEED)) for (const entry of list) {
  const [name, ...also] = entry.split("|");
  const own = PATTERNS[name];
  const phrases = own ? [] : [name, ...also].map((p) => plain(p).replace(/[?|]/g, " ").trim()).filter(Boolean);
  SEED_SHOPS.push({ name, kind, re: own || new RegExp(phrases.map((p) => `(^| )${escape(p)}( |$)`).join("|")),
    joined: own ? [] : phrases.map(squash).filter((s) => s.length >= 7) });
}
export const seedCount = () => SEED_SHOPS.length;
// Every seed shop named in a payment's text (parts: the shop name Relay shows, the bank's merchant, its statement words).
export function seedShops(parts) {
  const text = parts.filter(Boolean).map(plain).filter(Boolean).join(" | ");
  if (!text) return [];
  const together = squash(text);
  return SEED_SHOPS.filter((s) => s.re.test(text) || s.joined.some((j) => together.includes(j)));
}

// ---- 2. TrueLayer's label -------------------------------------------------------------------------------------------------
// TrueLayer's documented labels (top level, then a finer one). "yes": a shop that sells things; "no": not something that
// needs a receipt kept; null: it doesn't say (or Relay doesn't know the label), so the next source decides.
const TL_NO_TOP = /^(food (and )?dining|bills (and )?utilities|auto (and )?transport|travel|fees (and )?charges|investments|taxes|gambling|home|pensions (and )?insurances?|entertainment|personal services|uncategori[sz]ed)$/;
export function classificationSays(value) {
  let list = value;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = list.split(/\s*[>/]\s*/); } }
  if (!Array.isArray(list) || !list.length) return null;
  const top = plain(list[0]), sub = plain(list[1] || "");
  if (!top) return null;
  if (top === "shopping") return /grocer/.test(sub) ? "no" : "yes";
  if (top === "education") return /books/.test(sub) ? "yes" : sub ? "no" : null;
  if (top === "gifts and donations") return /charity|donation/.test(sub) ? "no" : /gift/.test(sub) ? "yes" : null;
  if (top === "business services") return /office supplies/.test(sub) ? "yes" : "no";
  if (top === "health and fitness") return /pharmacy|eye ?care/.test(sub) ? null : sub ? "no" : null;
  if (top === "personal care") return /beauty/.test(sub) ? null : sub ? "no" : null;
  if (TL_NO_TOP.test(top)) return "no";
  return null;
}
// What's kept with a payment: TrueLayer's label as a short list of words (at most 3, each at most 40 letters).
export function classificationToKeep(x) {
  const list = x && Array.isArray(x.transaction_classification) ? x.transaction_classification : null;
  if (!list) return null;
  const kept = list.slice(0, 3).map((w) => (typeof w === "string" ? w.replace(/\s+/g, " ").trim().slice(0, 40) : "")).filter(Boolean);
  return kept.length ? JSON.stringify(kept) : null;
}

// ---- 3. Learned shops -----------------------------------------------------------------------------------------------------
const FILLER = new Set(["uk", "gb", "gbr", "ltd", "limited", "plc", "inc", "llc", "official", "store", "stores", "shop", "online", "london", "the", "co", "com", "www"]);
const PERSONAL_MAIL = /(^|\.)(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|aol|btinternet|sky|virginmedia|talktalk|protonmail|proton|gmx|mail)\.(com|co\.uk|uk|me|net)$/i;
const RELAY_OWN = /\brelay\b.*\b(demo|test)\b|^relay[- ]?(demo|test)|myshopify\.com$/i;
const keyWords = (s, keepAnd) => plain(s).replace(/[?|]/g, " ").split(" ").filter((w) => w && !FILLER.has(w) && (keepAnd || w !== "and"));
const okKey = (k) => k.length >= 4 && k.length <= 60;
// The keys a receipt's shop is counted under: its web address (unless it's a payment or mail company's, or a personal
// mailbox) and its name. Nothing when it's one of Relay's own shops or looks like a person.
export function receiptShopKeys(details, tests) {
  const r = (details && details.retailer) || {};
  const domain = String(r.domain || "").toLowerCase().replace(/^www\./, "");
  const name = cleanShopName(r.name) || null;
  if (RELAY_OWN.test(domain) || RELAY_OWN.test(String(r.name || ""))) return null;
  if (tests && ((domain && tests.domains.has(domain)) || (name && tests.names.has(squash(name))))) return null;
  // A receipt from a personal mailbox is one someone forwarded: its "shop" may be that person, so it isn't counted.
  if (domain && (PERSONAL_MAIL.test(domain) || KNOWN_PERSONAL_MAIL.test(domain))) return null;
  const ownDomain = domain && !isVia(domain) ? domain : null;
  if (name && !ownDomain && looksLikePerson(name, domain)) return null;
  const keys = new Set();
  if (ownDomain) { const k = squash(domainBase(ownDomain)); if (okKey(k)) keys.add(k); }
  // "Quill & Ink" is quillink by its name and quillandink by quillandink.co.uk: then the web address's key alone is kept.
  if (name) { const k = keyWords(name).join(""), k2 = keyWords(name, true).join(""); if (okKey(k) && !keys.has(k2)) keys.add(k); }
  if (tests && [...keys].some((k) => tests.names.has(k))) return null;
  return keys.size ? { keys: [...keys], name: (name || domainBase(ownDomain) || "").slice(0, 80) } : null;
}
// The keys to look a payment up under: runs of one to three words of the shop's name, the bank's merchant and its
// statement words ("BRINDLE CLOTHING CO" → brindle, brindleclothing, clothing, …).
export function paymentShopKeys(parts) {
  const keys = new Set();
  for (const part of parts) {
    for (const keepAnd of [false, true]) {
      const w = keyWords(part, keepAnd).filter((x) => !/^\d+$/.test(x));
      // One word on its own has to be 5 letters or more, so a short everyday word ("home", "gift") doesn't match a shop.
      for (let i = 0; i < w.length; i++) for (let n = 1; n <= 3 && i + n <= w.length; n++) { const k = w.slice(i, i + n).join(""); if (okKey(k) && (n > 1 || k.length >= 5)) keys.add(k); }
    }
  }
  return [...keys];
}

let tableReady = false;
async function ensureTable(db) { if (!tableReady) { await db.prepare(SHOP_DIRECTORY_SQL).run(); tableReady = true; } }

// Learned shops that count (two or more shoppers, a kind that can need a receipt), loaded once per request:
// Map key → kind. Empty when there's no table yet or it can't be read.
export async function loadShopDirectory(db) {
  try {
    const rows = (await db.prepare(`SELECT key, kind FROM shop_directory WHERE shoppers >= ? ORDER BY shoppers DESC, receipts DESC LIMIT ${LEARNED_MAX_ROWS}`)
      .bind(LEARNED_MIN_SHOPPERS).all()).results || [];
    return new Map(rows.filter((r) => !EXCLUDED_KINDS.has(r.kind)).map((r) => [r.key, r.kind || null]));
  } catch { return new Map(); }
}
export const learnedShop = (dir, parts) => Boolean(dir && dir.size) && paymentShopKeys(parts).some((k) => dir.has(k));

// Counts the shops of receipts just saved for one shopper (cards: [{ id, details }]). Never throws: saving a receipt
// mustn't fail because of this.
export async function recordReceiptShops(env, shopperId, cards, now) {
  try {
    const db = env && env.RELAY_DB;
    const wanted = (cards || []).filter((c) => c && c.details && c.details.kind === "receipt" && !c.details.photoReceipt && c.details.source !== "receipt_photo"
      && !c.details.testShop && !c.details.demo);
    if (!db || !wanted.length) return;
    // Relay's own test shops (as the shop tables know them) and the App Review account are left out.
    const tests = { domains: new Set(), names: new Set() };
    try {
      for (const r of (await db.prepare("SELECT domain FROM shopify_shop_plan WHERE test_shop = 1").all()).results || []) {
        const d = String(r.domain || "").toLowerCase(); if (!d) continue;
        tests.domains.add(d); tests.names.add(squash(d.replace(/^www\./, "").split(".")[0]));
      }
      if (tests.domains.size) for (const r of (await db.prepare(`SELECT label FROM shopify_shops WHERE domain IN (${[...tests.domains].map(() => "?").join(",")})`).bind(...tests.domains).all()).results || [])
        if (r.label) tests.names.add(squash(r.label));
    } catch { /* no shop tables: no test shops */ }
    const found = new Map();   // key → { name, kind }
    for (const c of wanted) {
      const got = receiptShopKeys(c.details, tests); if (!got) continue;
      let kind = null; try { kind = categorise(c.details).category; } catch {}
      for (const k of got.keys) { const f = found.get(k); if (f) f.n++; else found.set(k, { name: got.name, kind, n: 1 }); }
    }
    if (!found.size) return;
    const who = await db.prepare("SELECT email FROM shoppers WHERE id = ?").bind(shopperId).first().catch(() => null);
    if (who && await isReviewAddress(env, who.email)) return;
    await ensureTable(db);
    // Which of these shops this shopper already had a receipt from (their own receipts, read for this only).
    const ids = new Set(wanted.map((c) => c.id));
    const had = new Set();
    const before = (await db.prepare(`SELECT id, json_extract(details, '$.retailer') AS retailer FROM captured_receipts WHERE shopper_id = ? AND status != 'not_receipt'
      AND json_extract(details, '$.kind') = 'receipt' AND json_extract(details, '$.photoReceipt') IS NULL ORDER BY created_at DESC LIMIT 3000`).bind(shopperId).all()).results || [];
    for (const r of before) {
      if (ids.has(r.id)) continue;
      let retailer = null; try { retailer = JSON.parse(r.retailer); } catch {}
      const got = receiptShopKeys({ retailer }, null);
      if (got) for (const k of got.keys) had.add(k);
    }
    const day = new Date(now || Date.now()).toISOString().slice(0, 10);
    await db.batch([...found].map(([key, s]) => db.prepare(`INSERT INTO shop_directory (key, name, kind, source, receipts, shoppers, first_seen, last_seen) VALUES (?,?,?,'receipts',?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET receipts = shop_directory.receipts + excluded.receipts, shoppers = shop_directory.shoppers + excluded.shoppers, last_seen = excluded.last_seen,
        kind = COALESCE(excluded.kind, shop_directory.kind)`).bind(key, s.name || null, s.kind || null, s.n, had.has(key) ? 0 : 1, day, day)));
  } catch (e) { console.log("shop directory: not counted", String(e && e.name || "")); }
}
