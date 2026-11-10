// Email connection for Relay (Gmail, or Outlook for Microsoft personal accounts): consent record, sign-in to the
// mailbox (OAuth), encrypted token, and a scan that reads ONLY order-confirmation / receipt emails.
// The tables keep their first names (gmail_connections and so on) and hold either kind of mailbox: a "provider" column says which.
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
//  * Disconnect revokes the token at Google and deletes the token and captured receipts. (Microsoft has no
//    revoke call for personal accounts: the token is deleted, and the shopper can remove Relay at account.live.com.)
import { parseReceiptEmail, parseReturnEmail, parseReturnUpdateEmail, parseDeliveryEmail, trackingLink, extractProductImageUrls, photoShowsItem } from "./receipt-parser.js";
import { ensureOnce, runAll } from "./once.js";
import { buildWrapped } from "./wrapped.js";
import { policyFor, policyForApp, policyReturnBy } from "./return-policies.js";
import { buildOriginal, buildOriginalOutlook } from "./original.js";
import { SHARED_EMAILS_SQL, sharedByReceipt, attachShared, sharedCopy, readSummary, namesToHide, sealShared, SHARE_DAYS, SHARES_PER_DAY, SHARES_KEPT } from "./shared-emails.js";
import { AI_READS_SQL, AI_SETTING_SQL, attachAiReads } from "./ai-reader.js";
import { categorise, itemCategories, returnableItems, storeKey, legacyStoreKey, agreedShopNames, logoDomainFor, CATEGORIES, shopDisplayName, PERSONAL_MAIL } from "./receipt-category.js";
import { cleanItems, isVia } from "./receipt-reader.js";
// Instant email: Gmail and Outlook say when new mail arrives (mail-push.js), so it's read at once rather than on the next round.
import { stopMailPush, gmailPushOn, outlookPushOn } from "./mail-push.js";
const CATEGORY_KEYS = Object.keys(CATEGORIES);;
import { ensureResaleTables } from "./resale.js";
import { ensurePushTables, subsOf, sendPush } from "./push.js";

// v5: the same permission, worded for Outlook as well as Gmail.
export const CONSENT_VERSION = "2026-11-v5";
export const CONSENT_TEXT = [
  "To work, Relay needs to see your online and in-store receipts.",
  "With your permission, Relay reads your email (Gmail or Outlook) in read-only mode and looks only for order confirmations, receipts and return emails from the past year or so.",
  "From each one it keeps the store, order number, date, total and items, plus return details (deadline, how to return, return ID, any return link), one small product photo from the email if there is one, and a link back to the original email so you can open it yourself. It does not keep the email itself.",
  "If you ask for a return reminder on an item, Relay emails you once, at your sign-in address, a few days before its deadline. It sends nothing otherwise.",
  "Relay never sends email from your account, never deletes or changes anything in your inbox, and never sells or shares what it finds.",
  "You can disconnect your email and delete everything Relay has captured at any time, in one tap.",
  "What Relay finds comes from your email, not from the store, so it can track your purchases but cannot start an automatic refund on its own."
];

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SCOPE = SCOPE;
// Outlook: Microsoft personal accounts (Outlook.com, Hotmail, Live). Read-only mail access, plus the address of the mailbox.
export const MS_AUTH = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
export const OUTLOOK_SCOPE = "offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read";
// Outlook message ids are long and may change if an email is moved, so emails are remembered by their own Message-ID instead.
const OUTLOOK_ID = /^[A-Za-z0-9_=+\/-]{16,512}$/;
const GMAIL_ID = /^[A-Za-z0-9]{6,40}$/;
const STATE_TTL_MS = 10 * 60 * 1000;
// More than one inbox: the first is kept under the shopper's own id, each other one under "<id>~<n>" (n from 2 to
// MAX_INBOXES) in the same tables, so the first inbox works exactly as before. Receipts from every inbox are kept under the
// shopper, with the inbox's number in details.mailbox (none for the first inbox and for receipts pasted in by hand).
export const MAX_INBOXES = 5;
export const ownerOf = (boxId) => String(boxId).split("~")[0];
export const slotOf = (boxId) => { const m = /~(\d{1,2})$/.exec(String(boxId)); return m ? Number(m[1]) : null; };
export const boxIdOf = (shopperId, slot) => (Number.isInteger(slot) && slot > 1 && slot <= MAX_INBOXES ? shopperId + "~" + slot : shopperId);
// SQL for the shopper an inbox row belongs to (its own id for the first inbox).
const OWNER_SQL = (col) => `(CASE WHEN instr(${col}, '~') > 0 THEN substr(${col}, 1, instr(${col}, '~') - 1) ELSE ${col} END)`;
// The rows of every inbox a shopper has connected, the first one first.
export async function inboxesOf(db, shopperId) {
  const r = await db.prepare("SELECT * FROM gmail_connections WHERE shopper_id = ? OR shopper_id LIKE ? ORDER BY CASE WHEN shopper_id = ? THEN 0 ELSE 1 END, shopper_id")
    .bind(shopperId, shopperId + "~%", shopperId).all();
  return (r.results || []).filter(x => x.shopper_id === shopperId || (String(x.shopper_id).startsWith(shopperId + "~") && slotOf(x.shopper_id)));
}
// A Worker invocation can only make so many outside calls, so one scan reads a limited number
// of new emails and says if there are more. The app keeps asking until it is told there are none.
// Cloudflare's Workers Paid plan allows 1,000 outside calls and 1,000 database calls per request, so a round reads up to
// 40 emails, saves each date window in one database batch, and stops early (saying there is more) long before either limit.
// (On the free plan it was 10 emails a round, to fit 50 calls and 10 ms of processing.) A Worker keeps at most 6 connections
// open at once, so Gmail emails are fetched 6 at a time.
const PAGE_SIZE = 100, MAX_PAGES = 4, MAX_FETCH_PER_SCAN = 40, FETCH_PARALLEL = 6, CALL_BUDGET = 120;
// Outlook lets an app have only 4 requests open at once on one mailbox and refuses the rest ("429 Too Many Requests").
// Reading 6 at a time made Outlook refuse some emails, and those were skipped for good. So Outlook emails are read 3 at a
// time (leaving room for anything else open, like an original receipt), and a refused one is waited for and asked again.
const OUTLOOK_PARALLEL = 3;
// An email that couldn't be read is tried again in later rounds; after this many tries it is left out so a scan never gets stuck.
const MAX_READ_TRIES = 3;
// Bump to have every Outlook mailbox's whole look-back period listed again once (only emails never read are read).
// 1: emails Outlook refused during earlier scans were never captured.
const OUTLOOK_FULL_REV = 1;
// Raised when the receipt reader improves enough that every mailbox should be read once more in the background
// (only emails read by an older reader are opened again). 2: shop, item and group ranking. 3: forwarded receipts from
// every email app (Outlook's, Apple Mail's, Yahoo's as well as Gmail's), Microsoft's Safe Links, and text in other character sets.
// 4: the address each order was sent to, for starting returns. 5: items laid out as table cells (pubs, takeaways,
// fast food, supermarkets), totals with a note in brackets, month-first dates, payment notices that aren't receipts.
// 6: "1 x Name" rows, "Total amount", the journey of a travel booking, the game behind a game web shop's receipt.
// 7: totals a line below their word, names over two cells, labels between a row's values, names starting with a number.
// 8: the game named in a game web shop's HTML even when its plain-text part leads with the shop's support line.
// 9: the shop behind a pay-later, voucher or ticket platform's email (Klarna, GiftPro, Toggle, Ventrata).
// 10: a supermarket's order summary under its last item ("Trolley cost") is no longer added to that item's price.
// 11: "Sub Total" passed over for the real total, money-off, promo-credit and bonus-points emails left out, "Delivered:"
// notices read as deliveries, receipts sent through email companies (Mandrill, Mailgun) named after the shop, "Ordered:",
// "receipt for" and "order of" subjects, invisible padding and direction marks, "5 GBP" prices, totals "(Including VAT)",
// booking confirmation numbers, deposits into an account left out, and a payment platform's "Merchant:".
// 12: notices about an order already placed left out (a delay, "important information regarding your order", a benefit
// confirmed for it), and totals that aren't in pounds read in their own currency, never converted.
const READER_FULL_REV = 12;
const FULL_REV = Math.max(OUTLOOK_FULL_REV, READER_FULL_REV);
// Orders this recent are always listed, however many newer emails there are (long enough for any usual return window).
const RECENT_ORDER_DAYS = 120;
const sleep = ms => new Promise(res => setTimeout(res, ms));
// A request Outlook refused for being too busy is asked once more after the wait it asks for (at most 2 seconds here;
// anything longer is left for the next round).
async function graphGet(fetchImpl, url, headers) {
  let r = await fetchImpl(url, { headers });
  if (r.status === 429 || r.status === 503 || r.status === 504) {
    const secs = Number(r.headers && typeof r.headers.get === "function" ? r.headers.get("retry-after") : NaN);
    await sleep(Number.isFinite(secs) && secs >= 0 ? Math.min(2000, secs * 1000) : 1000);
    r = await fetchImpl(url, { headers });
  }
  return r;
}
// What a mailbox says about an email that has gone since it was listed (deleted or moved): nothing to read, nothing to retry.
const GONE = Symbol("gone");
// Bump when the receipt reader improves: older captures are re-read once with the new reader.
export const PARSER_VERSION = 28;
// The mailbox is read one date window at a time, newest first, so old receipts are reached
// however busy the inbox is. The app passes back the cursor it is given.
const HISTORY_YEARS = 10; // how far back a shopper can ask Relay to read, for Wrapped
const LOOKBACK_DAYS = 500, WINDOW_DAYS = 30, MAX_WINDOWS_PER_CALL = 6, DAY_MS = 24 * 60 * 60 * 1000;
// Gmail's own Purchases and Reservations labels, and the same kinds of subject Outlook mailboxes are read for (see
// SHOPPING_SUBJECT): bookings, tickets, trips and invoices as well as orders and receipts.
const SEARCH_TERMS =
  '(category:purchases OR category:reservations OR subject:(order OR "order confirmation" OR "order confirmed" OR "your order" OR receipt OR "thank you for your order" OR "thanks for your order" OR purchase OR "thanks for shopping" OR return OR refund OR "QR code"' +
  ' OR booking OR reservation OR itinerary OR tickets OR "e-ticket" OR "your trip" OR "your ride" OR invoice OR "payment to" OR "payment received" OR "ready to collect" OR "ready for collection"))' +
  // Parcel updates, so a purchase can show "delivered" (only the carrier, tracking number and date are kept).
  ' OR from:(royalmail.com OR parcelforce.com OR evri.com OR dpd.co.uk OR inpost.co.uk OR yodel.co.uk) OR subject:(delivered OR "out for delivery" OR dispatched OR shipped)';
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
export function outlookConfigured(env) {
  return Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
}
// One address at Microsoft for both "Continue with Microsoft" and "Connect Outlook" (registered once with Microsoft).
export function microsoftRedirect(env, url) {
  return env.MICROSOFT_REDIRECT_URI || `${url.origin}/relay/microsoft/callback`;
}
function redirectUri(env, url) {
  return env.GOOGLE_REDIRECT_URI || `${url.origin}/relay/gmail/callback`;
}
function json(body, status = 200, cors = {}) {
  return Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
}

export function ensureGmailTables(db) { return ensureOnce(db, "gmail", () => ensureGmailTablesRun(db)); }
async function ensureGmailTablesRun(db) {
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
       title TEXT NOT NULL, sent_at INTEGER)`,
    // What the app has been taught: the shopper's own corrections, per store. Holds no email text, only a store key and a choice.
    `CREATE TABLE IF NOT EXISTS receipt_learning (
       shopper_id TEXT NOT NULL, store_key TEXT NOT NULL, category TEXT, promo INTEGER NOT NULL DEFAULT 0,
       updated_at INTEGER NOT NULL, PRIMARY KEY (shopper_id, store_key))`,
    // Public store logos, fetched from the store's own website and shared by everyone. Holds no personal data.
    `CREATE TABLE IF NOT EXISTS retailer_logos (
       domain TEXT PRIMARY KEY, type TEXT, data TEXT, found INTEGER NOT NULL, fetched_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_receipt_learning_store ON receipt_learning(store_key, category)`,
    // Past years the shopper asked Relay to read (for Wrapped), and when each was finished.
    `CREATE TABLE IF NOT EXISTS gmail_history_years (
       shopper_id TEXT NOT NULL, year INTEGER NOT NULL, done_at INTEGER, PRIMARY KEY (shopper_id, year))`,
    // Which items of an email order the shopper is sending back (an email receipt covers the whole order).
    `CREATE TABLE IF NOT EXISTS receipt_item_marks (
       shopper_id TEXT NOT NULL, receipt_id TEXT NOT NULL, item_index INTEGER NOT NULL, status TEXT NOT NULL,
       updated_at INTEGER NOT NULL, PRIMARY KEY (shopper_id, receipt_id, item_index))`,
    // Receipts the shopper said were a present for someone else, and who for (only if they said). is_gift 0 is "not a gift
    // after all": an order's latest choice wins, whichever of its emails it was made on (see attachGifts).
    `CREATE TABLE IF NOT EXISTS receipt_gifts (
       shopper_id TEXT NOT NULL, receipt_id TEXT NOT NULL, is_gift INTEGER NOT NULL, recipient TEXT, updated_at INTEGER NOT NULL,
       PRIMARY KEY (shopper_id, receipt_id))`,
    // What the shopper corrected on a receipt Relay read wrong (shop, total, date or items): shown instead of what was read,
    // and counted (by which part, which shop and which reader) so the reader can be made better. No email text is kept.
    `CREATE TABLE IF NOT EXISTS receipt_fixes (
       shopper_id TEXT NOT NULL, receipt_id TEXT NOT NULL, fields TEXT NOT NULL, domain TEXT, reader INTEGER,
       shop INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, date INTEGER NOT NULL DEFAULT 0, items INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (shopper_id, receipt_id))`,
    // "Send this email to Relay": the one email a shopper chose to send, details hidden, encrypted, kept 30 days at most.
    SHARED_EMAILS_SQL,
    // "AI help" (ai-reader.js): who switched it on, and what the AI read from emails the rules weren't sure about.
    AI_SETTING_SQL, AI_READS_SQL,
    // A scan the shopper started: where it has got to and how much it found, so it carries on after they leave the app.
    `CREATE TABLE IF NOT EXISTS mail_scan_jobs (
       shopper_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, state TEXT NOT NULL, full_read INTEGER NOT NULL DEFAULT 0, cursor TEXT,
       added INTEGER NOT NULL DEFAULT 0, scanned_back TEXT, rounds INTEGER NOT NULL DEFAULT 0, background INTEGER NOT NULL DEFAULT 0,
       started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, app_at INTEGER, finished_at INTEGER, lease_until INTEGER, lease_id TEXT, error TEXT)`
  ];
  await runAll(db, statements);
  // Which kind of mailbox a connection (or a connection being started) is: NULL for Gmail, 'microsoft' for Outlook.
  // full_rev: which complete read of the look-back period the mailbox has had (see OUTLOOK_FULL_REV).
  for (const sql of ["ALTER TABLE gmail_connections ADD COLUMN provider TEXT", "ALTER TABLE gmail_oauth_states ADD COLUMN provider TEXT",
    "ALTER TABLE gmail_connections ADD COLUMN full_rev INTEGER",
    // An earlier year's reader (see READER_FULL_REV) and where a background re-read of it has got to.
    "ALTER TABLE gmail_history_years ADD COLUMN rev INTEGER", "ALTER TABLE gmail_history_years ADD COLUMN cursor TEXT"]) {
    try { await db.prepare(sql).run(); } catch { /* already there */ }
  }
  await ensureResaleTables(db);
}

// Statements that erase everything Gmail-related for a shopper.
export function gmailDeleteStatements(db, shopperId) {
  return [
    // Listings are made from captured receipts, so they come down with them.
    db.prepare("UPDATE resale_requests SET status = 'closed' WHERE status = 'accepted' AND listing_id IN (SELECT id FROM resale_listings WHERE seller_id = ?)").bind(shopperId),
    db.prepare("UPDATE resale_listings SET status = 'withdrawn' WHERE seller_id = ? AND status IN ('active','matched')").bind(shopperId),
    db.prepare("DELETE FROM captured_receipts WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM receipt_images WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM return_reminders WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM receipt_learning WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM gmail_history_years WHERE shopper_id = ? OR shopper_id LIKE ?").bind(shopperId, shopperId + "~%"),
    db.prepare("DELETE FROM receipt_item_marks WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM receipt_gifts WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM receipt_fixes WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM shared_emails WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM receipt_ai_reads WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM ai_reading WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM gmail_connections WHERE shopper_id = ? OR shopper_id LIKE ?").bind(shopperId, shopperId + "~%"),
    db.prepare("DELETE FROM mail_scan_jobs WHERE shopper_id = ? OR shopper_id LIKE ?").bind(shopperId, shopperId + "~%"),
    db.prepare("DELETE FROM gmail_oauth_states WHERE shopper_id = ? OR shopper_id LIKE ?").bind(shopperId, shopperId + "~%"),
    db.prepare("DELETE FROM shopper_consents WHERE shopper_id = ?").bind(shopperId)
  ];
}

// Automatic checking: each run looks at new mail for the shopper checked longest ago, then carries on reading older
// mail if their first full read isn't finished. Runs on its own schedule, so it has the request's limits to itself.
// Only shoppers who agreed to Gmail reading (and haven't withdrawn) are included.
// Each run does a few passes of up to 15 emails (the paid plan allows 30 seconds of processing per run).
const AUTO_PASSES_PER_RUN = 3, AUTO_RECENT_DAYS = 3, AUTO_MAX_BACK_DAYS = 30, AUTO_MAX_FETCH = 15;
function ensureAutoColumns(db) {
  return ensureOnce(db, "gmail-auto", async () => {
    for (const sql of ["ALTER TABLE gmail_connections ADD COLUMN auto_at INTEGER", "ALTER TABLE gmail_connections ADD COLUMN auto_cursor TEXT"]) {
      try { await db.prepare(sql).run(); } catch { /* already there */ }
    }
  });
}
// Whether reading an inbox is actually working, so nothing says "checked" when it wasn't (auto_at is only when the
// 15-minute check last had a go, whatever happened):
//  * mail_ok_at: the last time Relay read the inbox's newest mail without a problem (what the app shows as "Checked").
//    (Mail that came while checks were failing is still read once they work again: each check reads the last 30 days.)
//  * mail_problem ("reconnect") and mail_problem_at: Google or Microsoft said Relay's access to this inbox has ended (it
//    expired, or the shopper took it back), so it has to be connected again. Cleared as soon as access works again.
export function ensureHealthColumns(db) {
  return ensureOnce(db, "inbox-health", async () => {
    for (const col of ["mail_ok_at INTEGER", "mail_problem TEXT", "mail_problem_at INTEGER"]) {
      try { await db.prepare("ALTER TABLE gmail_connections ADD COLUMN " + col).run(); } catch { /* already there */ }
    }
  });
}
// Instant email (mail-push.js), kept with each inbox so it moves with it: when its Gmail watch or Outlook subscription
// lapses (push_expires_at), Outlook's subscription id and a hash of its secret (push_ref, push_secret), how far Gmail's
// history has been read (push_history), when a notice last came (push_at) and when it was last read for one (push_scan_at),
// a second look Gmail sometimes needs (push_recheck_at), the one read allowed at a time (push_lease), and the last set-up try.
export function ensurePushColumns(db) {
  return ensureOnce(db, "mail-push", async () => {
    for (const col of ["push_expires_at INTEGER", "push_ref TEXT", "push_secret TEXT", "push_history TEXT", "push_at INTEGER", "push_scan_at INTEGER",
      "push_recheck_at INTEGER", "push_lease INTEGER", "push_tried_at INTEGER", "push_error TEXT"]) {
      try { await db.prepare("ALTER TABLE gmail_connections ADD COLUMN " + col).run(); } catch { /* already there */ }
    }
    // Each notice finds its inbox by address (Gmail) or subscription (Outlook) without reading every connection.
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_gmail_connections_address ON gmail_connections(lower(google_email))").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_gmail_connections_push_ref ON gmail_connections(push_ref)").run();
  });
}
export async function autoScanGmail(env, now = Date.now(), fetchImpl = (...a) => fetch(...a)) {
  if (!env.RELAY_DB) return { checked: 0 };
  await ensureGmailTables(env.RELAY_DB);
  await ensureAutoColumns(env.RELAY_DB);
  await ensurePushColumns(env.RELAY_DB);
  await ensureHealthColumns(env.RELAY_DB);
  // An inbox being read for a new-mail notice right now (mail-push.js) waits for the next round.
  const rows = ((await env.RELAY_DB.prepare(
    `SELECT g.shopper_id AS id, g.auto_at AS autoAt, g.last_scan_at AS lastScanAt, g.auto_cursor AS cursor, g.provider AS provider, g.full_rev AS fullRev FROM gmail_connections g
     WHERE EXISTS (SELECT 1 FROM shopper_consents c WHERE c.shopper_id = ${OWNER_SQL("g.shopper_id")} AND c.version = ? AND c.withdrawn_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM mail_scan_jobs j WHERE j.shopper_id = g.shopper_id AND j.state = 'running')
       AND (g.push_lease IS NULL OR g.push_lease < ?)
     ORDER BY COALESCE(g.auto_at, 0) LIMIT 3`).bind(CONSENT_VERSION, now).all()).results || []);
  let passes = 0, calls = 0;
  const out = [];
  for (const r of rows) {
    if (passes >= AUTO_PASSES_PER_RUN || calls > CALL_BUDGET - 12) break;
    // 1. New mail since this shopper was last checked (a couple of days' overlap; never more than a month).
    const since = Math.max(now - AUTO_MAX_BACK_DAYS * DAY_MS, (r.autoAt || r.lastScanAt || now - AUTO_RECENT_DAYS * DAY_MS) - 2 * DAY_MS);
    let recent;
    try { recent = await scan(env, r.id, fetchImpl, now, "", false, { recent: true, sinceMs: since, budget: CALL_BUDGET - calls, maxFetch: AUTO_MAX_FETCH }); }
    catch (e) { recent = { status: 500, body: { error: String(e && e.message || e).slice(0, 80) } }; }
    passes++; calls += recent.calls || 3;
    let cursor = cursorFor(r.cursor);
    // 2. The first full read (or a full read again, see OUTLOOK_FULL_REV), a little more each run, until it reaches the start of the look-back period.
    if (needsFullRead(r.lastScanAt, r.provider, r.fullRev) && recent.status === 200 && !recent.body.more && passes < AUTO_PASSES_PER_RUN && calls < CALL_BUDGET - 12) {
      let back;
      try { back = await scan(env, r.id, fetchImpl, now, cursor || ymd(since), false, { budget: CALL_BUDGET - calls, maxFetch: AUTO_MAX_FETCH }); }
      catch (e) { back = { status: 500, body: {} }; }
      passes++; calls += back.calls || 3;
      if (back.status === 200) cursor = back.body.more ? back.body.cursor : null;
    }
    // Moved to the back of the queue whatever happened, so one shopper's problem never blocks the rest. (Whether the check
    // worked is kept apart from this, in mail_ok_at and mail_problem: see ensureHealthColumns.)
    await env.RELAY_DB.prepare("UPDATE gmail_connections SET auto_at = ?, auto_cursor = ? WHERE shopper_id = ?").bind(now, savedCursor(cursor), r.id).run();
    out.push({ status: recent.status, added: recent.body && recent.body.added || 0, updated: recent.body && recent.body.updated || 0, more: Boolean(recent.body && recent.body.more) });
  }
  return { checked: out.length, results: out };
}

// A mailbox being read again with a better reader (see READER_FULL_REV), or never read to the end, catches up every minute,
// one round at a time, with no message to the shopper: the 15-minute check alone reads only a few dozen emails an hour, so a
// busy mailbox would take days. Gmail and Outlook alike. Not while a scan the shopper started is running (that reads
// everything itself), and the scheduler leaves out the minutes the 15-minute check runs, so a mailbox is never read twice at once.
// Once the look-back period is done, the earlier years the shopper added for Wrapped are read again too, newest first
// (most of a long-time shopper's receipts are in those years, and otherwise they would keep the older reader's mistakes).
const CATCH_UP_MAILBOXES = 2;
// A catch-up round reads twice what a round the app waits for does (that one has to answer quickly): a long-time shopper's
// look-back period and earlier years come to several thousand emails, and nobody is waiting on this round's reply.
const CATCH_UP_FETCH = 80, CATCH_UP_BUDGET = 240;
export async function catchUpFullReads(env, now = Date.now(), fetchImpl = (...a) => fetch(...a)) {
  if (!env.RELAY_DB) return { checked: 0 };
  await ensureGmailTables(env.RELAY_DB);
  await ensureAutoColumns(env.RELAY_DB);
  const staleYear = `SELECT h.year FROM gmail_history_years h WHERE h.shopper_id = g.shopper_id AND h.done_at IS NOT NULL AND COALESCE(h.rev, 0) < ? ORDER BY h.year DESC LIMIT 1`;
  const rows = ((await env.RELAY_DB.prepare(
    `SELECT g.shopper_id AS id, g.last_scan_at AS lastScanAt, g.auto_cursor AS cursor, g.provider AS provider, g.full_rev AS fullRev,
       (${staleYear}) AS staleYear FROM gmail_connections g
     WHERE (COALESCE(g.full_rev, 0) < ? OR (${staleYear}) IS NOT NULL)
       AND EXISTS (SELECT 1 FROM shopper_consents c WHERE c.shopper_id = ${OWNER_SQL("g.shopper_id")} AND c.version = ? AND c.withdrawn_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM mail_scan_jobs j WHERE j.shopper_id = g.shopper_id AND j.state = 'running')
     ORDER BY COALESCE(g.auto_at, 0) LIMIT ?`).bind(READER_FULL_REV, FULL_REV, READER_FULL_REV, CONSENT_VERSION, CATCH_UP_MAILBOXES).all()).results || []);
  let calls = 0;
  const out = [];
  for (const r of rows) {
    if (calls > CATCH_UP_BUDGET - 12) continue;
    const recent = needsFullRead(r.lastScanAt, r.provider, r.fullRev);
    if (!recent && !r.staleYear) continue;
    let back, year = null;
    try {
      if (recent) back = await scan(env, r.id, fetchImpl, now, cursorFor(r.cursor) || "", false, { budget: CATCH_UP_BUDGET - calls, maxFetch: CATCH_UP_FETCH });
      else {
        year = r.staleYear;
        const h = await env.RELAY_DB.prepare("SELECT cursor FROM gmail_history_years WHERE shopper_id = ? AND year = ?").bind(r.id, year).first();
        back = await scan(env, r.id, fetchImpl, now, cursorFor(h && h.cursor) || "", false, { budget: CATCH_UP_BUDGET - calls, maxFetch: CATCH_UP_FETCH, year });
      }
    } catch (e) { back = { status: 500, body: {} }; }
    calls += back.calls || 3;
    // Where to carry on from next minute (the 15-minute check uses the same place, so the two never go over the same ground).
    // A finished year is marked with its reader by scan() itself.
    if (back.status === 200 && !year) await env.RELAY_DB.prepare("UPDATE gmail_connections SET auto_cursor = ? WHERE shopper_id = ?").bind(savedCursor(back.body.more ? back.body.cursor : null), r.id).run();
    if (back.status === 200 && year && back.body.more) await env.RELAY_DB.prepare("UPDATE gmail_history_years SET cursor = ? WHERE shopper_id = ? AND year = ?").bind(savedCursor(back.body.cursor), r.id, year).run();
    out.push({ status: back.status, ...(year ? { year } : {}), read: back.body && (back.body.added || 0) + (back.body.updated || 0), more: Boolean(back.body && back.body.more) });
  }
  return { checked: out.length, results: out };
}

// The place a background read of the whole look-back period has got to is saved with the read it belongs to ("5@2025/07/20").
// A place saved during an older read is not used: a new reader always starts again from the newest mail, otherwise the
// mail between the newest and that place would be left as the older reader saw it.
function cursorFor(saved) {
  const m = /^(\d+)@(\d{4}\/\d{2}\/\d{2})$/.exec(saved || "");
  return m && Number(m[1]) === FULL_REV ? m[2] : null;
}
function savedCursor(cursor) { return cursor ? FULL_REV + "@" + cursor : null; }

// Whether the mailbox still needs its whole look-back period read: never finished, or an Outlook mailbox read before
// the fix in OUTLOOK_FULL_REV.
export function needsFullRead(lastScanAt, provider, fullRev) {
  return !lastScanAt || (fullRev || 0) < (provider === "microsoft" ? FULL_REV : READER_FULL_REV);
}

async function hasConsent(db, shopperId) {
  const row = await db.prepare(
    "SELECT 1 AS ok FROM shopper_consents WHERE shopper_id = ? AND version = ? AND withdrawn_at IS NULL")
    .bind(shopperId, CONSENT_VERSION).first();
  return Boolean(row);
}

// Google's and Microsoft's answer when the sign-in Relay holds for an inbox has ended (it expired, the password changed, or
// the shopper took Relay's access back): only connecting the inbox again helps. Any other refusal (their side down or busy,
// or a problem with Relay's own app settings) isn't the shopper's to fix, so it's never shown to them as one.
const ACCESS_ENDED = new Set(["invalid_grant", "interaction_required"]);
const refused = async (res) => {
  const body = await res.json().catch(() => null);
  return { ended: res.status === 400 && ACCESS_ENDED.has(String((body && body.error) || "")) };
};
async function accessToken(env, refreshToken, fetchImpl) {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: "refresh_token"
    })
  });
  if (!res.ok) return refused(res);
  const body = await res.json().catch(() => null);
  return body && body.access_token ? { access: body.access_token } : { ended: false };
}

// Microsoft may hand back a new refresh token each time; the newest is kept so the connection doesn't lapse.
async function msAccessToken(env, refreshToken, fetchImpl) {
  const res = await fetchImpl(MS_AUTH + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: "refresh_token", scope: OUTLOOK_SCOPE
    })
  });
  if (!res.ok) return refused(res);
  const body = await res.json().catch(() => null);
  return body && body.access_token ? { access: body.access_token, refresh: typeof body.refresh_token === "string" ? body.refresh_token : null } : { ended: false };
}
// Records whether Relay's access to an inbox works (see ensureHealthColumns): "reconnect" when it has ended, cleared when it
// works. A busy or unreachable Google or Microsoft changes nothing.
async function noteAccess(env, boxId, works) {
  try {
    await ensureHealthColumns(env.RELAY_DB);
    if (works) await env.RELAY_DB.prepare("UPDATE gmail_connections SET mail_problem = NULL, mail_problem_at = NULL WHERE shopper_id = ? AND mail_problem IS NOT NULL").bind(boxId).run();
    else await env.RELAY_DB.prepare("UPDATE gmail_connections SET mail_problem = 'reconnect', mail_problem_at = COALESCE(mail_problem_at, ?) WHERE shopper_id = ?").bind(Date.now(), boxId).run();
  } catch { /* the reading itself carries on either way */ }
}
// Access to whichever mailbox the shopper connected (row from gmail_connections): { token }, or { ended: true } when it has to
// be connected again, or { busy: true } when Google or Microsoft couldn't give it just now (tried again later).
async function mailAccess(env, shopperId, row, fetchImpl) {
  if (row.provider === "microsoft" && !outlookConfigured(env)) return { busy: true };
  let refresh, t;
  try {
    refresh = await decrypt(env, row.token_iv, row.token_data);
    t = row.provider === "microsoft" ? await msAccessToken(env, refresh, fetchImpl) : await accessToken(env, refresh, fetchImpl);
  } catch { return { busy: true }; }
  if (!t.access) {
    if (!t.ended) return { busy: true };
    await noteAccess(env, shopperId, false);
    return { ended: true };
  }
  await noteAccess(env, shopperId, true);
  if (t.refresh && t.refresh !== refresh) {
    const enc = await encrypt(env, t.refresh);
    await env.RELAY_DB.prepare("UPDATE gmail_connections SET token_iv = ?, token_data = ? WHERE shopper_id = ?").bind(enc.iv, enc.data, shopperId).run();
  }
  return { token: t.access };
}
// What each kind of read answers when there's no access: connect again, or try again in a moment.
const noAccess = (a) => a.ended ? { status: 401, error: "gmail_reconnect_needed" } : { status: 502, error: "gmail_unavailable" };
async function mailToken(env, shopperId, row, fetchImpl) {
  const a = await mailAccess(env, shopperId, row, fetchImpl);
  return a.token || null;
}
// For instant email (mail-push.js): an access token for one inbox, or null when it has to be connected again.
export async function accessTokenFor(env, boxId, fetchImpl) {
  const row = await env.RELAY_DB.prepare("SELECT token_iv, token_data, provider FROM gmail_connections WHERE shopper_id = ?").bind(boxId).first();
  if (!row) return null;
  const token = await mailToken(env, boxId, row, fetchImpl).catch(() => null);
  return token ? { token, provider: row.provider === "microsoft" ? "microsoft" : "google" } : null;
}
// A notice said this inbox has new mail: its newest few days are read at once, by the same reader, with the same rules and
// the same search as every other read (so nothing beyond receipts, orders, returns and parcel emails is opened).
export function scanNewMail(env, boxId, fetchImpl, now) {
  return scan(env, boxId, fetchImpl, now, "", false, { recent: true, sinceMs: now - 2 * DAY_MS, span: 3, budget: 60, maxFetch: 15 });
}

// Tells Google to cancel Relay's access to the shopper's Gmail. Microsoft has no equivalent call: the shopper removes
// Relay from their Microsoft account's app list, and the stored token is deleted either way.
// Before that, the inbox's instant-email watch (Gmail) or subscription (Outlook) is ended while Relay can still ask.
export async function revokeMailbox(env, shopperId, fetchImpl) {
  try { await stopMailPush(env, shopperId, fetchImpl); } catch { /* it lapses on its own within 7 days */ }
  const row = await env.RELAY_DB.prepare(
    "SELECT token_iv, token_data, provider FROM gmail_connections WHERE shopper_id = ?").bind(shopperId).first();
  let revoked = false;
  if (row && row.provider !== "microsoft") {
    try {
      const refresh = await decrypt(env, row.token_iv, row.token_data);
      const res = await fetchImpl("https://oauth2.googleapis.com/revoke", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refresh })
      });
      revoked = res.ok;
    } catch { revoked = false; }
  }
  return { row, revoked };
}

// Cancels Relay's access to each of the shopper's other inboxes too (account deletion and withdrawing permission).
export async function revokeAllMailboxes(env, shopperId, fetchImpl) {
  const first = await revokeMailbox(env, shopperId, fetchImpl);
  for (const x of (await inboxesOf(env.RELAY_DB, shopperId)).filter(x => x.shopper_id !== shopperId)) await revokeMailbox(env, x.shopper_id, fetchImpl).catch(() => null);
  return first;
}
// The receipts read from one inbox (slot null: the first inbox), and what hangs off them: photos, reminders, which items
// are going back, and any listing made from them. Receipts pasted in by hand belong to no inbox and are kept.
function inboxReceiptDeletes(db, shopperId, slot) {
  const pick = slot ? "json_extract(details, '$.mailbox') = ?" : "json_extract(details, '$.mailbox') IS NULL AND json_extract(details, '$.pasted') IS NULL";
  const args = slot ? [shopperId, slot] : [shopperId];
  const ids = `SELECT id FROM captured_receipts WHERE shopper_id = ? AND ${pick}`;
  return [
    db.prepare(`UPDATE resale_requests SET status = 'declined' WHERE status = 'pending' AND listing_id IN (SELECT id FROM resale_listings WHERE seller_id = ? AND receipt_id IN (${ids}))`).bind(shopperId, ...args),
    db.prepare(`UPDATE resale_requests SET status = 'closed' WHERE status = 'accepted' AND listing_id IN (SELECT id FROM resale_listings WHERE seller_id = ? AND receipt_id IN (${ids}))`).bind(shopperId, ...args),
    db.prepare(`UPDATE resale_listings SET status = 'withdrawn' WHERE seller_id = ? AND status IN ('active','matched') AND receipt_id IN (${ids})`).bind(shopperId, ...args),
    db.prepare(`DELETE FROM receipt_images WHERE shopper_id = ? AND receipt_id IN (${ids})`).bind(shopperId, ...args),
    db.prepare(`DELETE FROM return_reminders WHERE shopper_id = ? AND receipt_id IN (${ids})`).bind(shopperId, ...args),
    db.prepare(`DELETE FROM receipt_item_marks WHERE shopper_id = ? AND receipt_id IN (${ids})`).bind(shopperId, ...args),
    db.prepare(`DELETE FROM receipt_gifts WHERE shopper_id = ? AND receipt_id IN (${ids})`).bind(shopperId, ...args),
    db.prepare(`DELETE FROM receipt_fixes WHERE shopper_id = ? AND receipt_id IN (${ids})`).bind(shopperId, ...args),
    db.prepare(`DELETE FROM shared_emails WHERE shopper_id = ? AND receipt_id IN (${ids})`).bind(shopperId, ...args),
    db.prepare(`DELETE FROM receipt_ai_reads WHERE shopper_id = ? AND receipt_id IN (${ids})`).bind(shopperId, ...args),
    db.prepare(`DELETE FROM captured_receipts WHERE shopper_id = ? AND ${pick}`).bind(...args)];
}
// Disconnects one of the other inboxes: Relay's access is cancelled at Google (Microsoft has no such call) and its key
// deleted, and the receipts read from that inbox go. The shopper's other inboxes and receipts stay as they are.
async function disconnectInbox(env, shopperId, slot, fetchImpl) {
  const boxId = boxIdOf(shopperId, slot);
  const { row, revoked } = await revokeMailbox(env, boxId, fetchImpl);
  if (!row) return { deleted: false };
  const db = env.RELAY_DB;
  await db.batch([...inboxReceiptDeletes(db, shopperId, slot),
    db.prepare("DELETE FROM gmail_connections WHERE shopper_id = ?").bind(boxId),
    db.prepare("DELETE FROM mail_scan_jobs WHERE shopper_id = ?").bind(boxId),
    db.prepare("DELETE FROM gmail_history_years WHERE shopper_id = ?").bind(boxId),
    db.prepare("DELETE FROM gmail_oauth_states WHERE shopper_id = ?").bind(boxId)]);
  return { deleted: true, revokedAtGoogle: revoked, provider: row.provider === "microsoft" ? "microsoft" : "google" };
}
async function disconnect(env, shopperId, fetchImpl, { withdraw }) {
  const db = env.RELAY_DB, others = (await inboxesOf(db, shopperId)).filter(x => x.shopper_id !== shopperId);
  if (!withdraw) {
    // The first inbox goes and the others stay: the next one takes its place, with its receipts and how far it has read.
    const { row, revoked } = await revokeMailbox(env, shopperId, fetchImpl);
    const next = others[0], moves = next ? [
      db.prepare("UPDATE gmail_connections SET shopper_id = ? WHERE shopper_id = ?").bind(shopperId, next.shopper_id),
      db.prepare("UPDATE mail_scan_jobs SET shopper_id = ? WHERE shopper_id = ?").bind(shopperId, next.shopper_id),
      db.prepare("UPDATE gmail_history_years SET shopper_id = ? WHERE shopper_id = ?").bind(shopperId, next.shopper_id),
      db.prepare("UPDATE captured_receipts SET details = json_remove(details, '$.mailbox') WHERE shopper_id = ? AND json_extract(details, '$.mailbox') = ?").bind(shopperId, slotOf(next.shopper_id))] : [];
    await db.batch([...inboxReceiptDeletes(db, shopperId, null),
      db.prepare("DELETE FROM gmail_connections WHERE shopper_id = ?").bind(shopperId),
      db.prepare("DELETE FROM mail_scan_jobs WHERE shopper_id = ?").bind(shopperId),
      db.prepare("DELETE FROM gmail_history_years WHERE shopper_id = ?").bind(shopperId), ...moves]);
    return { deleted: true, revokedAtGoogle: revoked, provider: row && row.provider === "microsoft" ? "microsoft" : "google", ...(next ? { nowFirst: next.google_email || null } : {}) };
  }
  // Withdrawing permission: every inbox, and everything read from them.
  for (const x of others) await revokeMailbox(env, x.shopper_id, fetchImpl).catch(() => null);
  const { row, revoked } = await revokeMailbox(env, shopperId, fetchImpl);
  const statements = [
    // Listings are made from captured receipts, so they come down with them.
    env.RELAY_DB.prepare("UPDATE resale_requests SET status = 'declined' WHERE status = 'pending' AND listing_id IN (SELECT id FROM resale_listings WHERE seller_id = ?)").bind(shopperId),
    env.RELAY_DB.prepare("UPDATE resale_requests SET status = 'closed' WHERE status = 'accepted' AND listing_id IN (SELECT id FROM resale_listings WHERE seller_id = ?)").bind(shopperId),
    env.RELAY_DB.prepare("UPDATE resale_listings SET status = 'withdrawn' WHERE seller_id = ? AND status IN ('active','matched')").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM captured_receipts WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM receipt_images WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM return_reminders WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM gmail_history_years WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM receipt_item_marks WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM receipt_gifts WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM receipt_fixes WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM shared_emails WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM receipt_ai_reads WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM ai_reading WHERE shopper_id = ?").bind(shopperId),
    env.RELAY_DB.prepare("DELETE FROM gmail_connections WHERE shopper_id = ? OR shopper_id LIKE ?").bind(shopperId, shopperId + "~%"),
    env.RELAY_DB.prepare("DELETE FROM mail_scan_jobs WHERE shopper_id = ? OR shopper_id LIKE ?").bind(shopperId, shopperId + "~%"),
    env.RELAY_DB.prepare("DELETE FROM gmail_history_years WHERE shopper_id LIKE ?").bind(shopperId + "~%")
  ];
  if (withdraw) statements.push(env.RELAY_DB.prepare(
    "UPDATE shopper_consents SET withdrawn_at = ? WHERE shopper_id = ? AND withdrawn_at IS NULL").bind(Date.now(), shopperId));
  await env.RELAY_DB.batch(statements);
  return { deleted: true, revokedAtGoogle: revoked, provider: row && row.provider === "microsoft" ? "microsoft" : "google" };
}

const MAX_IMAGES_PER_SCAN = 3;
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

// ---- Store logos ----
// The sender's address is often a mail subdomain (e.mail.sainsburys.co.uk): the logo lives on the main site.
const TWO_PART_TLDS = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "co.nz", "co.jp", "com.br", "co.za", "co.in"]);
export function logoDomain(host) {
  const h = String(host || "").toLowerCase().trim();
  if (h.length > 80 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) || /^[0-9.]+$/.test(h) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(h)) return null;
  const parts = h.split(".");
  const n = TWO_PART_TLDS.has(parts.slice(-2).join(".")) ? 3 : 2;
  return parts.slice(-n).join(".");
}
function logoTypeOf(bytes) {
  const t = imageTypeOf(bytes);
  if (t) return t;
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return "image/x-icon";
  return null;
}
const LOGO_MAX_BYTES = 150000, LOGO_MIN_BYTES = 200, LOGO_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
// Shops with no logo found before this moment are looked up again (the list of places to look grew: see logoSources).
// It is the moment the new list went live everywhere, so "no logo" answers the old list gave are never kept.
const LOGO_SOURCES_SINCE = Date.UTC(2026, 10, 2, 23, 30);
// A shop's website that hangs instead of answering is given up on quickly, so the app can draw a picture instead.
const LOGO_WAIT_MS = 4000;
// The size of a picture in pixels (the larger side), when it can be read from its first bytes: PNG, GIF and icon files.
export function imagePx(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return Math.max((b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0);
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return Math.max(b[6] | b[7] << 8, b[8] | b[9] << 8);
  if (b.length > 6 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) {
    let best = 0; const n = b[4] | b[5] << 8;
    for (let i = 0; i < n && 6 + i * 16 + 1 < b.length; i++) best = Math.max(best, b[6 + i * 16] || 256);
    return best;
  }
  return null;
}
// Where a shop's logo can come from, best first: the shop's own app icon; then Google's copy of the shop's icon (many big
// shops block requests from servers, Google's copy doesn't), which must be at least 32 pixels because Google answers
// unknown shops with a tiny globe; then the shop's own favicon. Only the shop's web address is sent, never who's asking.
function logoSources(domain) {
  return [
    { url: `https://${domain}/apple-touch-icon.png` }, { url: `https://www.${domain}/apple-touch-icon.png` },
    { url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, minPx: 32 },
    { url: `https://${domain}/favicon.ico` }, { url: `https://www.${domain}/favicon.ico` },
  ];
}
async function fetchLogo(fetchImpl, domain) {
  for (const src of logoSources(domain)) {
    try {
      const res = await fetchImpl(src.url, { headers: { Accept: "image/*" }, redirect: "follow", signal: AbortSignal.timeout(LOGO_WAIT_MS) });
      if (!res.ok || (res.url && !String(res.url).startsWith("https://"))) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < LOGO_MIN_BYTES || bytes.length > LOGO_MAX_BYTES) continue;
      const type = logoTypeOf(bytes);
      if (!type) continue;
      if (src.minPx) { const px = imagePx(bytes); if (px == null || px < src.minPx) continue; }
      return { type, data: b64Chunked(bytes) };
    } catch { /* try the next address */ }
  }
  return null;
}
async function logoFor(env, fetchImpl, domain, now) {
  const row = await env.RELAY_DB.prepare("SELECT type, data, found, fetched_at FROM retailer_logos WHERE domain = ?").bind(domain).first();
  if (row && (row.found || (now - row.fetched_at < LOGO_RETRY_MS && row.fetched_at >= LOGO_SOURCES_SINCE))) return row.found ? row : null;
  const img = await fetchLogo(fetchImpl, domain);
  await env.RELAY_DB.prepare("INSERT OR REPLACE INTO retailer_logos (domain,type,data,found,fetched_at) VALUES (?,?,?,?,?)")
    .bind(domain, img ? img.type : null, img ? img.data : null, img ? 1 : 0, now).run();
  return img ? { type: img.type, data: img.data } : null;
}

// Reads one email and decides what it is. Only extracted fields are kept; the email text is dropped.
// "ref" says where the email lives so it can be opened again: { gmailId } or { outlookId }.
// What a mail app copies (Select All, then Copy) has the subject, the sender and the date as plain lines at the top rather
// than as headers. They are made headers again, so a pasted email is read like one from the inbox (the shop comes from the
// sender). A forwarded email keeps its text; the date the shop sent it is used when the email itself gives none, as the
// scan does with an email's own date. The email's source (it starts with its headers) is read as it is.
const MAIL_APP_LABELS = /^(inbox|primary|updates|promotions|social|important|starred|sent|all mail|archive|focused|other|to me)$/i;
const HEADER_LINE = /^(from|subject|date|to|cc|received|delivered-to|return-path|message-id|mime-version|content-type|reply-to|dkim-signature|arc-[a-z-]+|x-[a-z0-9-]+)\s*:/i;
function mailDate(s, now) {
  const t = String(s || "").replace(/\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b,?/gi, " ").replace(/\bat\b/gi, " ").replace(/\s+/g, " ").trim();
  if (t.length < 6 || t.length > 60 || !/\d{4}/.test(t)) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) || d.getTime() > now + 86400000 || d.getUTCFullYear() < 2000 ? null : d;
}
export function pastedAsEmail(text, now = Date.now()) {
  const t = String(text || "").replace(/\r\n?/g, "\n").replace(/^\s+/, "");
  const lines = t.split("\n"), top = lines.slice(0, 12);
  if (HEADER_LINE.test(lines[0])) return t;
  if (top.some(l => /^\s*(from|subject)\s*:/i.test(l))) {
    const m = top.map(l => /^\s*(?:date|sent)\s*:\s*(.+?)\s*$/i.exec(l)).find(Boolean), d = m && mailDate(m[1], now);
    return d ? "Date: " + d.toUTCString() + "\n\n" + t : t;
  }
  const i = top.findIndex(l => /^\s*[^<>@\n]{0,80}<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>\s*$/.test(l));
  if (i === -1) return t;
  const subject = lines.slice(0, i).map(l => l.trim()).filter(l => l && !MAIL_APP_LABELS.test(l))[0] || "";
  const d = lines.slice(i + 1, i + 4).map(l => mailDate(l, now)).find(Boolean);
  return "From: " + lines[i].trim() + "\n" + (subject ? "Subject: " + subject.slice(0, 200) + "\n" : "") + (d ? "Date: " + d.toUTCString() + "\n" : "") + "\n" + lines.slice(i + 1).join("\n");
}

function classify(rawText, ref, lenient = false) {
  let details, status = "pending";
  // Return emails are recognised by specific wording ("Return ID", "your return request"), so they are checked first:
  // otherwise a return email that also mentions the order and an amount could be mistaken for the order itself.
  const upd = parseReturnUpdateEmail(rawText);
  const ret = upd.ok ? { ok: false } : parseReturnEmail(rawText);
  const del = upd.ok || ret.ok ? { ok: false } : parseDeliveryEmail(rawText);
  const receipt = upd.ok || ret.ok || del.ok ? { ok: false } : parseReceiptEmail(rawText, { lenient });
  if (upd.ok) {
    details = {
      kind: "return_update", ...ref, stage: upd.stage, at: upd.at, amountPence: upd.amountPence, currency: upd.currency,
      orderRef: upd.orderRef, returnId: upd.returnId, retailer: upd.retailer, source: "shopper_email", refundEligible: false, parserVersion: PARSER_VERSION
    };
  } else if (del.ok) {
    details = {
      kind: "delivery_update", ...ref, status: del.status, at: del.at, carrier: del.carrier, trackingNumber: del.trackingNumber,
      merchant: del.merchant, retailer: del.retailer, orderRef: del.orderRef, source: "shopper_email", refundEligible: false, parserVersion: PARSER_VERSION
    };
  } else if (ret.ok) {
    details = {
      kind: "return_instructions", ...ref,
      retailer: ret.retailer, orderRef: ret.orderRef, orderDate: ret.orderDate, returnId: ret.returnId,
      deadline: ret.deadline, carrier: ret.carrier, steps: ret.steps, qrMentioned: ret.qrMentioned,
      estimatedRefundPence: ret.estimatedRefundPence, currency: ret.currency, trackUrl: ret.trackUrl, trackingNumber: ret.trackingNumber || null,
      source: "shopper_email", refundEligible: false, parserVersion: PARSER_VERSION
    };
  } else if (receipt.ok) {
    // Keep only extracted fields. The email text is dropped here.
    details = {
      kind: "receipt", ...ref,
      retailer: receipt.retailer, orderRef: receipt.orderRef, orderDate: receipt.orderDate, orderDateFrom: receipt.orderDateFrom || null, currency: receipt.currency,
      totalPence: receipt.totalPence, items: receipt.items, confidence: receipt.confidence, sentTo: receipt.sentTo || null,
      needsShopperConfirmation: receipt.needsShopperConfirmation, method: receipt.method, returns: receipt.returns, shipment: receipt.shipment || null,
      source: "shopper_email", refundEligible: false, parserVersion: PARSER_VERSION
    };
  } else {
    // Remember that this email is not one of ours so it is never fetched again.
    details = { kind: "not_receipt", parserVersion: PARSER_VERSION };
    status = "not_receipt";
  }
  return { details, status };
}

// ---- The two kinds of mailbox. Each lists one date window of likely emails and reads one email as it was sent. ----
function gmailMailbox(fetchImpl, token) {
  const auth = { Authorization: "Bearer " + token };
  return {
    prefix: "gmail:",
    // Gmail lists newest first, a page at a time. Several pages are read so older receipts are reachable.
    async list(afterD, before, canPage) {
      const entries = [];
      let pageToken = "", incomplete = false;
      for (let page = 0; page < MAX_PAGES; page++) {
        if (page > 0 && !canPage()) { incomplete = true; break; }
        const list = await fetchImpl(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=" + PAGE_SIZE + "&q=" + encodeURIComponent(windowQuery(afterD, before)) +
          (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""), { headers: auth });
        if (!list.ok) { if (page === 0) return { failed: true }; break; }
        const data = await list.json().catch(() => ({}));
        for (const m of data.messages || []) if (m && typeof m.id === "string" && GMAIL_ID.test(m.id)) entries.push({ id: m.id, key: m.id });
        pageToken = typeof data.nextPageToken === "string" && /^[A-Za-z0-9_=-]{1,300}$/.test(data.nextPageToken) ? data.nextPageToken : "";
        if (!pageToken) break;
      }
      // More emails in this window than one listing takes (4 pages of 100): the window is read again in shorter pieces.
      return { entries, incomplete, overflow: Boolean(pageToken) && !incomplete };
    },
    // The email as text; GONE if it no longer exists; null if Gmail couldn't give it just now (tried again later).
    async read(id) {
      const r = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=raw`, { headers: auth });
      if (r.status === 404) return GONE;
      const raw = r.ok ? (await r.json().catch(() => ({}))).raw : null;
      return typeof raw === "string" ? new TextDecoder().decode(unb64url(raw)) : null;
    },
    parallel: FETCH_PARALLEL,
    ref: e => ({ gmailId: e.id })
  };
}

// Outlook can't be searched the way Gmail is (there is no "purchases" category), so each date window is listed by
// subject and sender only, and just the emails that look like orders, receipts, returns or parcel updates are read in full.
// Payments, tickets, rides and collections are included too ("Your payment to Rains", "Your Monday trip with Uber",
// "Ready to collect"), and senders whose address says what they send (orders@, billing@, PayPal's service@).
const SHOPPING_SUBJECT = /\b(orders?|ordered|receipts?|e-?receipts?|purchases?|purchased|bought|thanks? (you )?for (shopping|your)|returns?|returned|refunds?|refunded|qr code|delivered|delivery|deliveries|dispatched|despatched|dispatch|despatch|shipped|shipping|shipment|on (its|it's|the) way|invoice|booking|booked|reservation|itinerary|confirmation|confirmed|payments?|paid|tickets?|e-?tickets?|trip|rides?|collection|ready (to|for) collect(ion)?|subscriptions?|renewal|renewed|membership|your (items?|parcel|package|purchase|delivery|booking|tickets?|trip|ride|bill))\b/i;
const SHOPPING_SENDER = /(^|[.@])(royalmail\.com|parcelforce\.com|evri\.com|dpd\.co\.uk|inpost\.co\.uk|yodel\.co\.uk)$|^(orders?|order-?confirm(ation)?|order-?updates?|orderstatus|receipts?|returns?|shipping|ship-confirm|auto-confirm|confirm|confirmation|transactional|transactions?|billing|invoices?|payments?|purchases?|sales|bookings?|tickets?|delivery|dispatch|service|customerservice|customer-service)(\+[^@\s]*)?@/i;
export function looksLikeShopping(subject, from) {
  return SHOPPING_SUBJECT.test(String(subject || "")) || SHOPPING_SENDER.test(String(from || "").trim());
}
const OUTLOOK_PAGE = 200;
// Gmail leaves Spam and Bin out of every search. Outlook's list of messages includes Junk Email and Deleted Items, so those
// two folders are left out here the same way (a fake "order" sitting in Junk never becomes a receipt). If Outlook won't say
// which folders they are, nothing is left out.
async function outlookSkippedFolders(fetchImpl, auth) {
  const ids = new Set();
  await Promise.all(["junkemail", "deleteditems"].map(async (name) => {
    try {
      const r = await graphGet(fetchImpl, GRAPH + "/me/mailFolders/" + name + "?$select=id", auth);
      const id = r.ok ? (await r.json().catch(() => ({}))).id : null;
      if (typeof id === "string" && id) ids.add(id);
    } catch (e) { /* left in rather than lost */ }
  }));
  return ids;
}
const OUTLOOK_SELECT = "id,internetMessageId,subject,from,receivedDateTime,parentFolderId";
function outlookMailbox(fetchImpl, token) {
  const auth = { Authorization: "Bearer " + token };
  const at = d => d.replace(/\//g, "-") + "T00:00:00Z";
  let skipped = null;
  return {
    prefix: "outlook:",
    async list(afterD, before, canPage) {
      const entries = [];
      if (!skipped) skipped = await outlookSkippedFolders(fetchImpl, auth);
      let next = GRAPH + "/me/messages?$filter=" + encodeURIComponent("receivedDateTime ge " + at(afterD) + " and receivedDateTime lt " + at(before)) +
        "&$orderby=" + encodeURIComponent("receivedDateTime desc") + "&$select=" + OUTLOOK_SELECT + "&$top=" + OUTLOOK_PAGE;
      let incomplete = false, oldest = null;
      for (let page = 0; page < MAX_PAGES && next; page++) {
        if (page > 0 && !canPage()) { incomplete = true; break; }
        const res = await graphGet(fetchImpl, next, auth);
        if (!res.ok) { if (page === 0) return { failed: true }; incomplete = true; break; }
        const data = await res.json().catch(() => ({}));
        for (const m of Array.isArray(data.value) ? data.value : []) {
          if (!m || typeof m.id !== "string" || !OUTLOOK_ID.test(m.id)) continue;
          if (typeof m.receivedDateTime === "string" && /^\d{4}-\d{2}-\d{2}T/.test(m.receivedDateTime)) oldest = m.receivedDateTime;
          if (skipped.has(m.parentFolderId)) continue;
          if (!looksLikeShopping(m.subject, m.from && m.from.emailAddress && m.from.emailAddress.address)) continue;
          const mid = typeof m.internetMessageId === "string" ? m.internetMessageId.trim() : "";
          entries.push({ id: m.id, key: mid && mid.length <= 400 ? mid : m.id });
        }
        const link = data["@odata.nextLink"];
        next = typeof link === "string" && link.startsWith(GRAPH + "/me/messages?") ? link : "";
      }
      // A very busy inbox has more in one window than a round can list: the next round starts from the oldest email listed.
      return { entries, incomplete, moreBefore: next && oldest ? oldest.slice(0, 10).replace(/-/g, "/") : null };
    },
    async read(id) {
      const r = await graphGet(fetchImpl, GRAPH + "/me/messages/" + encodeURIComponent(id) + "/$value", auth);
      if (r.status === 404) return GONE;
      return r.ok ? r.text() : null;
    },
    parallel: OUTLOOK_PARALLEL,
    ref: e => ({ outlookId: e.id })
  };
}
// The Message-ID an email carries, which stays the same wherever it is filed (Outlook's own ids do not).
function messageIdOf(rawText) {
  const m = /^message-id:[ \t]*(<[^>\r\n]{1,398}>)/im.exec(String(rawText).slice(0, 60000));
  return m ? m[1].trim() : null;
}

async function scan(env, boxId, fetchImplIn, now, cursorIn, full, o = {}) {
  // boxId is the inbox (the shopper's id for their first one); what it finds is kept under the shopper.
  const shopperId = ownerOf(boxId), slot = slotOf(boxId), mark = slot ? { mailbox: slot } : {};
  // Every outside call is counted so a round never runs past the plan's per-request limit.
  let calls = 0;
  const fetchImpl = (...a) => { calls++; return fetchImplIn(...a); };
  const budget = o.budget || CALL_BUDGET, maxFetch = o.maxFetch || MAX_FETCH_PER_SCAN;
  const row = await env.RELAY_DB.prepare(
    "SELECT token_iv, token_data, last_scan_at, provider, full_rev FROM gmail_connections WHERE shopper_id = ?").bind(boxId).first();
  if (!row) return { status: 409, body: { error: "gmail_not_connected" } };
  const access = await mailAccess(env, boxId, row, fetchImpl);
  if (!access.token) { const n = noAccess(access); return { status: n.status, body: { error: n.error } }; }
  const token = access.token;
  const box = row.provider === "microsoft" ? outlookMailbox(fetchImpl, token) : gmailMailbox(fetchImpl, token);
  let added = 0, skipped = 0, ignored = 0, updated = 0, fetched = 0, imagesTried = 0;
  // After one complete scan, later scans only look at recent mail (with a few days of overlap), so opening the app never re-reads the whole mailbox.
  const fullLimit = now - LOOKBACK_DAYS * DAY_MS;
  const sinceLast = o.sinceMs ? Math.max(fullLimit, o.sinceMs) : !full && !needsFullRead(row.last_scan_at, row.provider, row.full_rev) ? Math.max(fullLimit, row.last_scan_at - 3 * DAY_MS) : fullLimit;
  // A past year the shopper asked for (Wrapped history) is read on its own, from 31 Dec back to 1 Jan, whatever the usual look-back.
  const yr = o.year;
  const limitDay = yr ? yr + "/01/01" : ymd(sinceLast);
  const top = yr ? (yr + 1) + "/01/01" : ymd(now + DAY_MS);
  let before = /^\d{4}\/\d{2}\/\d{2}$/.test(cursorIn || "") && cursorIn <= top && cursorIn > limitDay ? cursorIn : top;
  // A read that starts at today's mail is a check of the inbox (once its first stretch is read, see mail_ok_at below).
  const fromTop = !yr && before === top;
  // A read for a new-mail notice lists only the last few days (o.span) rather than a whole month.
  let incomplete = false, windows = 0, outOfBudget = false, span = o.span || WINDOW_DAYS;
  while (windows < MAX_WINDOWS_PER_CALL && before > limitDay) {
    if (calls + 4 > budget) { outOfBudget = true; break; }
    const afterD = ymd(fromYmd(before) - span * DAY_MS);
    incomplete = false;
    const listed = await box.list(afterD, before, () => calls + 4 <= budget);
    if (listed.failed) { if (windows === 0) return { status: 502, body: { error: "gmail_unavailable" } }; incomplete = true; break; }
    // A busy month has more emails than one listing takes: the oldest of them used to be skipped. The same stretch is
    // listed again in half the days until it fits (a single day is read as far as it goes).
    if (listed.overflow && span > 1) { span = Math.max(1, Math.floor(span / 2)); continue; }
    if (listed.incomplete) incomplete = true;
    const ids = listed.entries.map(e => e.id);
    // Lookups are done in groups to stay under the database's per-query limit.
    const refs = await Promise.all(listed.entries.map(e => sha256Hex(box.prefix + e.key)));
    const known = new Map();
    for (let i = 0; i < refs.length; i += 90) {
      const chunk = refs.slice(i, i + 90);
      const found = await env.RELAY_DB.prepare(
        `SELECT id, message_ref, status, details FROM captured_receipts WHERE shopper_id = ? AND message_ref IN (${chunk.map(() => "?").join(",")})`)
        .bind(shopperId, ...chunk).all();
      for (const r of found.results || []) known.set(r.message_ref, r);
    }
    // Read the emails that need reading several at a time instead of one by one (this is most of the scan's waiting time).
    const toRead = [];
    for (let i = 0; i < ids.length && fetched + toRead.length < maxFetch && calls + toRead.length + 2 < budget; i++) {
      const sn = known.get(refs[i]);
      if (!sn || JSON.parse(sn.details).parserVersion !== PARSER_VERSION) toRead.push(ids[i]);
    }
    const rawById = new Map(), writes = [], par = box.parallel || FETCH_PARALLEL;
    for (let i = 0; i < toRead.length; i += par) {
      await Promise.all(toRead.slice(i, i + par).map(async (mid) => {
        try { rawById.set(mid, await box.read(mid)); } catch (e) { rawById.set(mid, null); }
      }));
    }
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], ref = refs[i];
      const seen = known.get(ref);
      // Anything read by an older version of the reader is read once more.
      const stale = seen && JSON.parse(seen.details).parserVersion !== PARSER_VERSION;
      if (seen && !stale) { skipped++; continue; }
      if (!rawById.has(id)) { incomplete = true; continue; }   // left for the next round
      fetched++;
      const rawText = rawById.get(id);
      if (rawText === GONE) continue;   // deleted or moved since it was listed
      if (typeof rawText !== "string") {
        // The mailbox couldn't give this email just now. It used to be skipped for good (that is how Outlook receipts went
        // missing); now it is remembered and read again in a later round, up to MAX_READ_TRIES times.
        const prevDetails = seen ? JSON.parse(seen.details) : null;
        const tries = ((prevDetails && prevDetails.readTries) || 0) + 1, giveUp = tries >= MAX_READ_TRIES;
        if (prevDetails && prevDetails.kind !== "not_receipt") {
          // A receipt already read by an older reader keeps what it has; it is only re-read once the email can be fetched.
          writes.push(env.RELAY_DB.prepare("UPDATE captured_receipts SET details = ? WHERE shopper_id = ? AND message_ref = ?")
            .bind(JSON.stringify({ ...prevDetails, readTries: tries, ...(giveUp ? { parserVersion: PARSER_VERSION } : {}) }), shopperId, ref));
        } else {
          const placeholder = JSON.stringify({ kind: "not_receipt", unread: true, readTries: tries, parserVersion: giveUp ? PARSER_VERSION : 0, ...mark });
          writes.push(seen
            ? env.RELAY_DB.prepare("UPDATE captured_receipts SET details = ? WHERE shopper_id = ? AND message_ref = ?").bind(placeholder, shopperId, ref)
            : env.RELAY_DB.prepare("INSERT OR IGNORE INTO captured_receipts (id,shopper_id,message_ref,status,details,created_at) VALUES (?,?,?,?,?,?)")
              .bind(crypto.randomUUID(), shopperId, ref, "not_receipt", placeholder, now));
        }
        if (!giveUp) incomplete = true;   // this window is read again next round
        continue;
      }
      const cls = classify(rawText, box.ref(listed.entries[i]));
      const details = slot ? { ...cls.details, mailbox: slot } : cls.details, status = cls.status;
      let imageToStore = null;
      if (status === "not_receipt") ignored++;
      // One small product photo per receipt, fetched at most once.
      const prev = seen ? JSON.parse(seen.details) : {};
      const receiptId = seen ? seen.id : crypto.randomUUID();
      if (details.kind === "receipt") {
        // A photo that failed once is tried again whenever the reader version changes (a transient failure should not be permanent).
        details.hasImage = Boolean(prev.hasImage); details.imageTried = Boolean(prev.imageTried) && (prev.hasImage || !stale);
        if (!details.imageTried && imagesTried < MAX_IMAGES_PER_SCAN && calls + 2 < budget) {
          imagesTried++;
          const urls = extractProductImageUrls(rawText, details);
          const img = urls.length ? await fetchProductImage(fetchImpl, urls) : null;
          details.imageTried = true;
          if (img) {
            details.hasImage = true;
            imageToStore = { receiptId, ...img };
          }
        }
        // Only an email that has a photo needs checking that the photo is of the item (reading it again costs time).
        if (details.hasImage) details.photoIsItem = photoShowsItem(rawText, details);
      }
      if (seen) {
        // The shopper's confirm/dismiss choice lives in the status column and is kept.
        const keep = seen.status !== "not_receipt" && status !== "not_receipt" ? seen.status : status;
        writes.push(env.RELAY_DB.prepare("UPDATE captured_receipts SET details = ?, status = ? WHERE shopper_id = ? AND message_ref = ?")
          .bind(JSON.stringify(details), keep, shopperId, ref));
        if (imageToStore) writes.push(imageStatement(env, shopperId, imageToStore, now));
        if (status !== "not_receipt") updated++;
        continue;
      }
      writes.push(env.RELAY_DB.prepare(
        "INSERT OR IGNORE INTO captured_receipts (id,shopper_id,message_ref,status,details,created_at) VALUES (?,?,?,?,?,?)")
        .bind(receiptId, shopperId, ref, status, JSON.stringify(details), now));
      if (imageToStore) writes.push(imageStatement(env, shopperId, imageToStore, now));
      if (status !== "not_receipt") added++;
    }
    // Everything read in this window is saved in one database call.
    if (writes.length) await env.RELAY_DB.batch(writes.splice(0));
    windows++;
    if (incomplete) break;       // stay on this window until every email in it is read
    // An Outlook window with more emails than one round lists carries on from the day of the oldest one listed
    // (that day is listed again, and what was already read is skipped). Otherwise the next window is the 30 days before.
    if (listed.moreBefore) {
      const next = ymd(fromYmd(listed.moreBefore) + DAY_MS);
      before = next < before ? next : listed.moreBefore < before ? listed.moreBefore : afterD;
    } else before = afterD;
    // A quieter stretch goes back to longer windows.
    if (span < WINDOW_DAYS && listed.entries.length < 150) span = Math.min(WINDOW_DAYS, span * 2);
    if (fetched >= maxFetch) break;
  }
  const more = incomplete || outOfBudget || before > limitDay;
  if (yr) {
    if (!more) await env.RELAY_DB.prepare("INSERT INTO gmail_history_years (shopper_id, year, done_at, rev, cursor) VALUES (?,?,?,?,NULL) ON CONFLICT(shopper_id, year) DO UPDATE SET done_at = excluded.done_at, rev = excluded.rev, cursor = NULL").bind(boxId, yr, now, READER_FULL_REV).run();
  } else if (!more && !o.recent) {
    // A finished read of the whole look-back period also records which full read it was (see OUTLOOK_FULL_REV).
    if (sinceLast === fullLimit) await env.RELAY_DB.prepare("UPDATE gmail_connections SET last_scan_at = ?, full_rev = ? WHERE shopper_id = ?").bind(now, FULL_REV, boxId).run();
    else await env.RELAY_DB.prepare("UPDATE gmail_connections SET last_scan_at = ? WHERE shopper_id = ?").bind(now, boxId).run();
  }
  // Today's mail was read without a problem: that's what the app shows as "Checked" (a read that stopped part-way through
  // its first stretch, or one of older mail only, isn't a check of what's new).
  if (fromTop && (windows > 1 || (windows === 1 && !incomplete))) {
    await ensureHealthColumns(env.RELAY_DB);
    await env.RELAY_DB.prepare("UPDATE gmail_connections SET mail_ok_at = ? WHERE shopper_id = ?").bind(now, boxId).run();
  }
  return { status: 200, calls, body: { ok: true, added, updated, alreadyCaptured: skipped, notReceipts: ignored, more, cursor: more ? before : null, scannedBack: before } };
}

// A past year (for Wrapped) is read in every connected inbox, one after the other, the first inbox first. The cursor says
// which inbox it has got to: the first inbox's is just the date ("2025/03/01", as it always was), another's starts with its
// number ("b2|2025/03/01", or "b2|" before it starts). An inbox that has already read the year is passed over, unless every
// inbox has (then asking again reads them all again). An inbox that needs connecting again is passed over too, and the
// answer says so (skipped), so the others are still read.
async function yearRound(env, shopperId, fetchImpl, now, year, cursorIn, small) {
  const o = { ...(small ? { maxFetch: 2 } : {}), year };
  const boxes = await inboxesOf(env.RELAY_DB, shopperId);
  if (boxes.length <= 1) return scan(env, shopperId, fetchImpl, now, cursorIn, false, o);
  const ids = boxes.map(b => b.shopper_id);
  const done = new Set(((await env.RELAY_DB.prepare("SELECT shopper_id FROM gmail_history_years WHERE (shopper_id = ? OR shopper_id LIKE ?) AND year = ? AND done_at IS NOT NULL")
    .bind(shopperId, shopperId + "~%", year).all()).results || []).map(x => x.shopper_id));
  let todo = ids.filter(id => !done.has(id));
  if (!todo.length) todo = ids;
  const tagged = /^b(\d{1,2})\|(.*)$/.exec(cursorIn || "");
  const wanted = tagged ? boxIdOf(shopperId, Number(tagged[1])) : cursorIn ? shopperId : todo[0];
  const boxId = ids.includes(wanted) ? wanted : todo[0];
  const dateCursor = tagged && boxId === wanted ? tagged[2] : !tagged && boxId === wanted ? cursorIn : "";
  const tag = (id, c) => (id === shopperId ? c || "" : "b" + slotOf(id) + "|" + (c || ""));
  const next = todo.find(id => ids.indexOf(id) > ids.indexOf(boxId));
  const inboxOf = (id) => { const b = boxes.find(x => x.shopper_id === id); return { mailbox: slotOf(id), provider: b && b.provider === "microsoft" ? "microsoft" : "google" }; };
  const inbox = inboxOf(boxId);
  const r = await scan(env, boxId, fetchImpl, now, dateCursor, false, o);
  if (r.status !== 200) {
    if (boxId === shopperId || r.status >= 500) return r;
    const skipped = { ...inbox, error: r.body && r.body.error };
    return { status: 200, body: { ok: true, added: 0, updated: 0, alreadyCaptured: 0, notReceipts: 0, more: Boolean(next), cursor: next ? tag(next, "") : null, scannedBack: null, inbox, skipped, ...(next ? { reading: inboxOf(next) } : {}) } };
  }
  if (r.body.more) return { ...r, body: { ...r.body, cursor: tag(boxId, r.body.cursor), inbox, reading: inbox } };
  return { ...r, body: { ...r.body, more: Boolean(next), cursor: next ? tag(next, "") : null, inbox, ...(next ? { reading: inboxOf(next) } : {}) } };
}

// ---- Scans that carry on after the shopper leaves the app ----
// A scan the shopper starts is kept as a job: where it has got to and how much it has found. While the app is open it asks
// for the rounds itself (quick, with progress on screen). Once the app is closed (or the phone locks), the scheduled worker
// carries on every minute until the job is done, and sends a phone notification if the shopper turned them on.
// A short lease means only one of them reads a mailbox at a time.
const JOB_LEASE_MS = 90 * 1000;        // how long a runner may hold a mailbox before someone else can take over
const JOB_APP_MS = 30 * 1000;          // the app counts as driving a scan if it asked within this time
const JOB_ROUNDS_PER_RUN = 5;          // rounds per scheduled run (each round stays well inside the per-request limits)
const JOB_RUN_MS = 40 * 1000;          // a scheduled run stops starting new rounds after this long
async function jobOf(env, shopperId) {
  return env.RELAY_DB.prepare("SELECT * FROM mail_scan_jobs WHERE shopper_id = ?").bind(shopperId).first();
}
export function jobView(j) {
  return j ? { state: j.state, full: Boolean(j.full_read), found: j.added || 0, scannedBack: j.scanned_back ? String(j.scanned_back).replace(/\//g, "-") : null,
    startedAt: j.started_at, updatedAt: j.updated_at, finishedAt: j.finished_at || null, error: j.error || null } : null;
}
// Starts a scan, or carries on the one already running: asking again never restarts it, except to widen it to a full
// re-read or when a mailbox has just been (re)connected.
export async function startScanJob(env, shopperId, now, { full = false, restart = false } = {}) {
  const cur = await jobOf(env, shopperId);
  if (!restart && cur && cur.state === "running" && (cur.full_read || !full)) return cur;
  await env.RELAY_DB.prepare(
    `INSERT INTO mail_scan_jobs (shopper_id,job_id,state,full_read,cursor,added,scanned_back,rounds,background,started_at,updated_at,app_at,finished_at,lease_until,error)
     VALUES (?, ?, 'running', ?, NULL, 0, NULL, 0, 0, ?, ?, NULL, NULL, NULL, NULL)
     ON CONFLICT(shopper_id) DO UPDATE SET job_id = excluded.job_id, state = 'running', full_read = excluded.full_read, cursor = NULL, added = 0,
       scanned_back = NULL, rounds = 0, background = 0, started_at = excluded.started_at, updated_at = excluded.updated_at, finished_at = NULL, error = NULL`)
    .bind(shopperId, randomToken(), full ? 1 : 0, now, now).run();
  return jobOf(env, shopperId);
}
// Takes the mailbox for one runner. Null if someone else has it (or there is nothing running).
async function claimScanJob(env, shopperId, now) {
  return env.RELAY_DB.prepare(
    "UPDATE mail_scan_jobs SET lease_until = ?, lease_id = ? WHERE shopper_id = ? AND state = 'running' AND (lease_until IS NULL OR lease_until < ?) RETURNING *")
    .bind(now + JOB_LEASE_MS, randomToken(), shopperId, now).first();
}
// Gives the mailbox back, only if this runner still holds it.
const releaseLease = (env, job) => env.RELAY_DB.prepare("UPDATE mail_scan_jobs SET lease_until = NULL, lease_id = NULL WHERE shopper_id = ? AND lease_id = ?").bind(job.shopper_id, job.lease_id);
// One round of a job, from where it had got to. Progress is only saved onto the same job (a scan restarted meanwhile is left alone).
async function runScanJobRound(env, job, fetchImpl, now, o = {}) {
  const db = env.RELAY_DB, same = [job.shopper_id, job.job_id];
  let r;
  try { r = await scan(env, job.shopper_id, fetchImpl, now, job.cursor || "", Boolean(job.full_read), o.small ? { maxFetch: 2 } : {}); }
  catch (e) { await releaseLease(env, job).run(); throw e; }
  if (r.status !== 200) {
    // A mailbox that needs connecting again (or was disconnected) ends the job; a busy mailbox is simply tried again later.
    const stop = r.status === 401 || r.status === 409;
    await db.batch([db.prepare(`UPDATE mail_scan_jobs SET updated_at = ?, error = ?, state = CASE WHEN ? THEN 'failed' ELSE state END,
        finished_at = CASE WHEN ? THEN ? ELSE finished_at END WHERE shopper_id = ? AND job_id = ?`)
      .bind(now, (r.body && r.body.error) || "failed", stop ? 1 : 0, stop ? 1 : 0, now, ...same), releaseLease(env, job)]);
    return r;
  }
  const b = r.body;
  await db.batch([db.prepare(`UPDATE mail_scan_jobs SET cursor = ?, added = added + ?, rounds = rounds + 1, scanned_back = ?, state = ?, updated_at = ?,
      finished_at = ?, error = NULL, background = background + ? WHERE shopper_id = ? AND job_id = ?`)
    .bind(b.more ? b.cursor : null, (b.added || 0) + (b.updated || 0), b.scannedBack || null, b.more ? "running" : "done", now,
      b.more ? null : now, o.background ? 1 : 0, ...same), releaseLease(env, job)]);
  return r;
}
// A round asked for by the app. If the scheduled worker is reading this mailbox right now, the app is told so (with the
// progress so far) and asks again a moment later.
async function appScanRound(env, shopperId, fetchImpl, now, { full = false, small = false, busyWaitMs = 3000 } = {}) {
  await startScanJob(env, shopperId, now, { full });
  await env.RELAY_DB.prepare("UPDATE mail_scan_jobs SET app_at = ? WHERE shopper_id = ?").bind(now, shopperId).run();
  const job = await claimScanJob(env, shopperId, now);
  if (!job) {
    const j = await jobOf(env, shopperId);
    if (!j || j.state !== "running") return { status: 200, body: { ok: true, added: 0, updated: 0, more: false, cursor: null, job: jobView(j) } };
    // Older copies of the app ask again straight away, so the answer waits a little.
    if (busyWaitMs) await sleep(busyWaitMs);
    return { status: 200, body: { ok: true, busy: true, added: 0, updated: 0, more: true, cursor: j.cursor, scannedBack: j.scanned_back, retryAfterMs: 4000, job: jobView(j) } };
  }
  const r = await runScanJobRound(env, job, fetchImpl, now, { small });
  return { status: r.status, body: { ...r.body, job: jobView(await jobOf(env, shopperId)) } };
}
// When the shopper checks for new receipts, their other inboxes are checked as well, as jobs Relay carries on by itself
// (each one at most every few minutes, however often the app asks).
async function checkOtherInboxes(env, shopperId, now, full) {
  for (const x of (await inboxesOf(env.RELAY_DB, shopperId)).filter(x => x.shopper_id !== shopperId)) {
    const j = await jobOf(env, x.shopper_id);
    if (j && (j.state === "running" || now - (j.finished_at || j.updated_at || 0) < 5 * 60 * 1000)) continue;
    await startScanJob(env, x.shopper_id, now, { full });
  }
}
// The scheduled worker's part: jobs the app isn't driving are carried on, a few rounds a run, until they are done.
export async function runScanJobs(env, now = Date.now(), fetchImpl = (...a) => fetch(...a), o = {}) {
  if (!env.RELAY_DB) return { jobs: 0, rounds: 0 };
  await ensureGmailTables(env.RELAY_DB);
  const clock = o.clock || (() => Date.now());
  const began = clock(), maxRounds = o.rounds || JOB_ROUNDS_PER_RUN, runMs = o.runMs || JOB_RUN_MS;
  const rows = ((await env.RELAY_DB.prepare(
    `SELECT j.shopper_id AS id FROM mail_scan_jobs j
     WHERE j.state = 'running' AND (j.lease_until IS NULL OR j.lease_until < ?) AND (j.app_at IS NULL OR j.app_at < ?)
       AND EXISTS (SELECT 1 FROM shopper_consents c WHERE c.shopper_id = ${OWNER_SQL("j.shopper_id")} AND c.version = ? AND c.withdrawn_at IS NULL)
     ORDER BY j.updated_at LIMIT 5`).bind(now, now - JOB_APP_MS, CONSENT_VERSION).all()).results || []);
  let rounds = 0, finished = 0, notified = 0;
  for (const row of rows) {
    if (rounds >= maxRounds || clock() - began > runMs) break;
    let job = await claimScanJob(env, row.id, now);
    while (job && job.state === "running" && rounds < maxRounds && clock() - began <= runMs) {
      let r;
      try { r = await runScanJobRound(env, job, fetchImpl, now, { background: true }); }
      catch (e) { console.error("background scan round failed", String(e && e.message || e).slice(0, 120)); break; }
      rounds++;
      const next = await jobOf(env, row.id);
      // Stop when the round failed, the job ended, or the app came back and is asking for the rounds itself.
      if (r.status !== 200 || !next || next.state !== "running" || (next.app_at && next.app_at >= now)) { job = next; break; }
      job = await claimScanJob(env, row.id, now);
    }
    const done = await jobOf(env, row.id);
    if (done && done.state === "done" && done.finished_at === now && done.background > 0) {
      finished++;
      if (done.added > 0) notified += await tellScanDone(env, ownerOf(row.id), done.added, { now, fetchImpl: o.pushFetch });
    }
  }
  return { jobs: rows.length, rounds, finished, notified };
}
// "Your receipts are ready" on the shopper's phone, only for scans that finished while they were away. No shop names.
async function tellScanDone(env, shopperId, found, o) {
  let sent = 0;
  try {
    await ensurePushTables(env.RELAY_DB);
    for (const sub of await subsOf(env.RELAY_DB, shopperId)) {
      try { if ((await sendPush(env, sub, { title: "Your receipts are ready", body: "Relay finished checking your email and found " + found + (found === 1 ? " purchase email." : " purchase emails."), url: "./#open=receipts" }, o)).ok) sent++; }
      catch { /* one device failing never stops the rest */ }
    }
  } catch { /* no notifications set up: nothing to send */ }
  return sent;
}


// One receipt's email, read again from its inbox, with the shopper's personal details hidden (shared-emails.js), their own
// names too (from their profile, and the part before the @ of their addresses). For "Send this email to Relay" and the AI
// second reader. Returns { copy } or { status, error }.
export async function hiddenCopyOf(env, shopper, d, fetchImpl) {
  const got = await readReceiptEmail(env, shopper.id, d, fetchImpl);
  if (!got.raw) return got;
  const db = env.RELAY_DB;
  const prof = await db.prepare("SELECT name FROM shopper_profiles WHERE shopper_id = ?").bind(shopper.id).first().catch(() => null);
  const boxes = (await db.prepare("SELECT google_email AS e FROM gmail_connections WHERE shopper_id = ? OR shopper_id LIKE ?").bind(shopper.id, shopper.id + "~%").all()).results || [];
  return { copy: sharedCopy(got.raw, namesToHide(prof && prof.name, [shopper.email, ...boxes.map((x) => x.e)])) };
}
// One email, read again from the inbox it came from, as it was sent. Nothing is stored here.
async function readReceiptEmail(env, shopperId, d, fetchImpl) {
  const fromBox = boxIdOf(shopperId, Number(d.mailbox));
  const conn = await env.RELAY_DB.prepare("SELECT token_iv, token_data, provider FROM gmail_connections WHERE shopper_id = ?").bind(fromBox).first();
  if (!conn) return { status: 409, error: "gmail_not_connected" };
  const outlook = conn.provider === "microsoft", mid = outlook ? d.outlookId : d.gmailId;
  if (typeof mid !== "string" || !(outlook ? OUTLOOK_ID : GMAIL_ID).test(mid)) return { status: 404, error: "email_not_found" };
  const access = await mailAccess(env, fromBox, conn, fetchImpl);
  if (!access.token) return noAccess(access);
  const token = access.token;
  const raw = await (outlook ? outlookMailbox(fetchImpl, token) : gmailMailbox(fetchImpl, token)).read(mid);
  if (raw === GONE) return { status: 404, error: "email_not_found" };
  return typeof raw === "string" ? { raw } : { status: 502, error: "gmail_unavailable" };
}

// ---- Find a missing receipt: search the mailbox live by store name, then add one chosen email ----
async function tokenFor(env, shopperId, fetchImpl) {
  const row = await env.RELAY_DB.prepare(
    "SELECT token_iv, token_data, provider FROM gmail_connections WHERE shopper_id = ?").bind(shopperId).first();
  if (!row) return { status: 409, body: { error: "gmail_not_connected" } };
  const access = await mailAccess(env, shopperId, row, fetchImpl);
  if (!access.token) { const n = noAccess(access); return { status: n.status, body: { error: n.error } }; }
  return { token: access.token, provider: row.provider === "microsoft" ? "microsoft" : "google" };
}

// Nothing here is stored: the list is for the shopper to choose from.
async function findEmails(env, boxId, fetchImpl, rawQuery, max = 15) {
  const shopperId = ownerOf(boxId), mark = slotOf(boxId) ? { mailbox: slotOf(boxId) } : {};
  const q = String(rawQuery || "").replace(/[^\p{L}\p{N} .'&-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  if (q.length < 2) return { status: 400, body: { error: "query_too_short" } };
  const t = await tokenFor(env, boxId, fetchImpl);
  if (!t.token) return t;
  const auth = { Authorization: "Bearer " + t.token };
  if (t.provider === "microsoft") return findOutlook(env, shopperId, fetchImpl, auth, q, max, mark);
  // Order, shipping and return emails first (a shop's marketing and payment-plan emails otherwise bury them), then anything else.
  const listIds = async query => {
    const l = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=" + encodeURIComponent(query), { headers: auth });
    if (!l.ok) return null;
    return ((await l.json().catch(() => ({}))).messages || []).map(m => m && m.id).filter(id => typeof id === "string" && GMAIL_ID.test(id));
  };
  // Both lists and every email's subject line are asked for side by side: the app searches as the shopper types.
  const [first, rest] = await Promise.all([
    listIds(q + ' subject:(order OR receipt OR confirmation OR "thanks for your" OR return OR "QR code" OR shipping OR delivered OR invoice) -category:promotions'),
    listIds(q)]);
  if (first === null && rest === null) return { status: 502, body: { error: "gmail_unavailable" } };
  const ids = [...new Set([...(first || []), ...(rest || [])])].slice(0, max);
  const results = (await Promise.all(ids.map(async (id) => {
    const r = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, { headers: auth });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    const h = n => ((j.payload && j.payload.headers || []).find(x => String(x.name).toLowerCase() === n) || {}).value || "";
    const from = h("from").replace(/<[^>]*>/g, "").replace(/["']/g, "").trim() || (/@([\w.-]+)/.exec(h("from")) || [])[1] || "";
    const ref = await sha256Hex("gmail:" + id);
    const have = await env.RELAY_DB.prepare("SELECT status FROM captured_receipts WHERE shopper_id = ? AND message_ref = ?").bind(shopperId, ref).first();
    return { id, subject: h("subject").slice(0, 120), from: from.slice(0, 60),
      date: j.internalDate ? new Date(Number(j.internalDate)).toISOString().slice(0, 10) : null,
      added: Boolean(have && !["not_receipt", "dismissed"].includes(have.status)), ...mark };
  }))).filter(Boolean);
  return { status: 200, body: { results } };
}

// Outlook's own search, newest first; order-type emails are put at the top of the list.
async function findOutlook(env, shopperId, fetchImpl, auth, q, max = 15, mark = {}) {
  const [l, skipped] = await Promise.all([
    fetchImpl(GRAPH + "/me/messages?$search=" + encodeURIComponent('"' + q + '"') + "&$top=25&$select=" + OUTLOOK_SELECT, { headers: auth }),
    outlookSkippedFolders(fetchImpl, auth)]);
  if (!l.ok) return { status: 502, body: { error: "gmail_unavailable" } };
  // Junk and Deleted Items are left out, as Gmail's search leaves out Spam and Bin.
  const found = ((await l.json().catch(() => ({}))).value || []).filter(m => m && typeof m.id === "string" && OUTLOOK_ID.test(m.id) && !skipped.has(m.parentFolderId));
  const looks = m => looksLikeShopping(m.subject, m.from && m.from.emailAddress && m.from.emailAddress.address);
  const ordered = [...found.filter(looks), ...found.filter(m => !looks(m))].slice(0, max);
  const results = await Promise.all(ordered.map(async (m) => {
    const mid = typeof m.internetMessageId === "string" ? m.internetMessageId.trim() : "";
    const ref = await sha256Hex("outlook:" + (mid && mid.length <= 400 ? mid : m.id));
    const have = await env.RELAY_DB.prepare("SELECT status FROM captured_receipts WHERE shopper_id = ? AND message_ref = ?").bind(shopperId, ref).first();
    const who = m.from && m.from.emailAddress || {};
    return { id: m.id, subject: String(m.subject || "").slice(0, 120), from: String(who.name || who.address || "").replace(/["']/g, "").trim().slice(0, 60),
      date: typeof m.receivedDateTime === "string" ? m.receivedDateTime.slice(0, 10) : null,
      added: Boolean(have && !["not_receipt", "dismissed"].includes(have.status)), ...mark };
  }));
  return { status: 200, body: { results } };
}

async function addEmail(env, boxId, fetchImpl, now, messageId) {
  const shopperId = ownerOf(boxId), mark = slotOf(boxId) ? { mailbox: slotOf(boxId) } : {};
  if (typeof messageId !== "string" || !(GMAIL_ID.test(messageId) || OUTLOOK_ID.test(messageId))) return { status: 400, body: { error: "invalid_message" } };
  const t = await tokenFor(env, boxId, fetchImpl);
  if (!t.token) return t;
  const outlook = t.provider === "microsoft";
  if (outlook ? !OUTLOOK_ID.test(messageId) : !GMAIL_ID.test(messageId)) return { status: 400, body: { error: "invalid_message" } };
  const res = outlook
    ? await fetchImpl(GRAPH + "/me/messages/" + encodeURIComponent(messageId) + "/$value", { headers: { Authorization: "Bearer " + t.token } })
    : await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=raw`, { headers: { Authorization: "Bearer " + t.token } });
  if (res.status === 404) return { status: 404, body: { error: "email_not_found" } };
  if (!res.ok) return { status: 502, body: { error: "gmail_unavailable" } };
  let rawText;
  if (outlook) rawText = await res.text();
  else {
    const raw = (await res.json().catch(() => ({}))).raw;
    if (typeof raw !== "string") return { status: 502, body: { error: "gmail_unavailable" } };
    rawText = new TextDecoder().decode(unb64url(raw));
  }
  const { details, status } = classify(rawText, outlook ? { outlookId: messageId, ...mark } : { gmailId: messageId, ...mark }, true);
  if (status === "not_receipt") {
    // Say which checks failed (no email content), so a missed layout can be fixed.
    const why = parseReceiptEmail(rawText, { lenient: true }).signals || null;
    return { status: 200, body: { ok: false, reason: "not_recognised", signals: why } };
  }
  // The same key the scan uses, so an email added by hand is never added a second time by a scan.
  const ref = await sha256Hex(outlook ? "outlook:" + (messageIdOf(rawText) || messageId) : "gmail:" + messageId);
  const seen = await env.RELAY_DB.prepare("SELECT id, details FROM captured_receipts WHERE shopper_id = ? AND message_ref = ?").bind(shopperId, ref).first();
  const prev = seen ? JSON.parse(seen.details) : {};
  const receiptId = seen ? seen.id : crypto.randomUUID();
  let image = null;
  if (details.kind === "receipt") {
    details.hasImage = Boolean(prev.hasImage); details.imageTried = Boolean(prev.imageTried) && Boolean(prev.hasImage);
    if (!details.imageTried) {
      const urls = extractProductImageUrls(rawText, details);
      image = urls.length ? await fetchProductImage(fetchImpl, urls) : null;
      details.imageTried = true;
      if (image) details.hasImage = true;
    }
    if (details.hasImage) details.photoIsItem = photoShowsItem(rawText, details);
  }
  if (seen) {
    await env.RELAY_DB.prepare("UPDATE captured_receipts SET details = ?, status = 'pending' WHERE id = ? AND shopper_id = ?").bind(JSON.stringify(details), seen.id, shopperId).run();
  } else {
    await env.RELAY_DB.prepare("INSERT INTO captured_receipts (id,shopper_id,message_ref,status,details,created_at) VALUES (?,?,?,?,?,?)")
      .bind(receiptId, shopperId, ref, "pending", JSON.stringify(details), now).run();
  }
  if (image) await saveImage(env, shopperId, { receiptId, ...image }, now);
  return { status: 200, body: { ok: true, kind: details.kind, store: (details.retailer && (details.retailer.name || details.retailer.domain)) || null, orderRef: details.orderRef || null } };
}

function imageStatement(env, shopperId, img, now) {
  return env.RELAY_DB.prepare("INSERT OR REPLACE INTO receipt_images (receipt_id,shopper_id,type,data,created_at) VALUES (?,?,?,?,?)")
    .bind(img.receiptId, shopperId, img.type, img.data, now);
}
async function saveImage(env, shopperId, img, now) {
  await env.RELAY_DB.prepare(
    "INSERT OR REPLACE INTO receipt_images (receipt_id,shopper_id,type,data,created_at) VALUES (?,?,?,?,?)")
    .bind(img.receiptId, shopperId, img.type, img.data, now).run();
}

// Newest purchase first by the date on the order, not by when Relay happened to read the email
// (reading older mail later must never push this week's orders out of the list).
const whenOf = (c) => c.orderDate || new Date(c.createdAt || 0).toISOString().slice(0, 10);

// One order often arrives as several emails (confirmation, "we're shipping it", ...). They become one card:
// the most complete email leads and the others fill in what it lacks (price, size, tracking, returns link).
// A receipt the shopper forwarded from their own mailbox (gmail.com...) has the shop's order number but not the shop's
// address, so it joins the shop's own emails for that order when the order number matches and the amounts agree.
const isForwarded = (o) => PERSONAL_MAIL.test(String((o.retailer && o.retailer.domain) || ""));
export function mergeOrderEmails(orders) {
  const out = [], groups = new Map();
  const shopFor = new Map(); // order number -> the shop it belongs to, when exactly one shop used it
  for (const o of orders) {
    if (!o.orderRef || isForwarded(o)) continue;
    const ref = String(o.orderRef).toUpperCase(), e = shopFor.get(ref) || { keys: new Set(), totals: new Set() };
    e.keys.add(storeKey(o)); if (o.totalPence != null) e.totals.add(o.totalPence); shopFor.set(ref, e);
  }
  const keyOf = (o) => {
    if (!o.orderRef) return null;
    const ref = String(o.orderRef).toUpperCase();
    if (isForwarded(o)) {
      const e = shopFor.get(ref);
      if (e && e.keys.size === 1 && (o.totalPence == null || !e.totals.size || e.totals.has(o.totalPence))) return [...e.keys][0] + "|" + ref;
    }
    return storeKey(o) + "|" + ref;
  };
  for (const o of orders) {
    const k = keyOf(o);
    if (!k) { out.push(o); continue; }
    if (!groups.has(k)) { groups.set(k, []); out.push(groups.get(k)); }
    groups.get(k).push(o);
  }
  const score = (o) => (isForwarded(o) ? 0 : 32) + (o.status === "confirmed" ? 8 : 0) + (o.totalPence != null ? 4 : 0) + (o.items || []).filter(i => i.pricePence != null).length * 2 + (o.hasImage ? 1 : 0);
  return out.map(g => {
    if (!Array.isArray(g)) return g;
    if (g.length === 1) return g[0];
    const [lead, ...rest] = g.slice().sort((a, b) => score(b) - score(a) || a.createdAt - b.createdAt);
    const c = { ...lead, items: (lead.items || []).map(i => ({ ...i })), returns: lead.returns ? { ...lead.returns } : null };
    for (const o of rest) {
      // The currency goes with the amount: a total taken from another email of the order is in that email's currency.
      if (c.totalPence == null && o.totalPence != null) { c.totalPence = o.totalPence; c.currency = o.currency || c.currency; }
      if (!c.orderDate && o.orderDate) c.orderDate = o.orderDate;
      if (!c.items.length && (o.items || []).length) c.items = o.items.map(i => ({ ...i }));
      for (const it of c.items) {
        const twin = (o.items || []).find(x => x.name === it.name);
        if (!twin) continue;
        if (it.pricePence == null && twin.pricePence != null) it.pricePence = twin.pricePence;
        if (!it.variant && twin.variant) it.variant = twin.variant;
      }
      if (o.shipment && o.shipment.trackingNumber && !(c.shipment && c.shipment.trackingNumber)) c.shipment = o.shipment;
      if (o.returns) {
        const r = c.returns || (c.returns = {});
        for (const f of ["windowDays", "windowFrom", "deadline", "address", "portalUrl"]) if (r[f] == null && o.returns[f] != null) r[f] = o.returns[f];
        if (!(r.instructions || []).length && (o.returns.instructions || []).length) r.instructions = o.returns.instructions;
        r.qrMentioned = Boolean(r.qrMentioned || o.returns.qrMentioned); r.labelMentioned = Boolean(r.labelMentioned || o.returns.labelMentioned);
      }
    }
    // Which emails the card was made from, for choices the shopper made on an email that isn't the one shown (attachGifts).
    // Not enumerable, so it never goes to the app.
    Object.defineProperty(c, "emailIds", { value: g.map(o => o.id), enumerable: false });
    return c;
  });
}

// A shopper's corrections, checked: a shop name, a total in pence (up to £1m), a date that has happened (by `latest`), and
// up to 50 items. Only the parts given come back; null when none was given or one given isn't right.
export function cleanFix(b, latest) {
  if (!b || typeof b !== "object") return null;
  const out = {}, words = (v, max) => { const t = String(v).replace(/\s+/g, " ").trim(); return t && t.length <= max ? t : null; };
  const pence = (v) => Number.isInteger(v) && v >= 0 && v <= 100000000;
  if (b.shop != null) { const t = typeof b.shop === "string" ? words(b.shop, 80) : null; if (!t) return null; out.shop = t; }
  if (b.totalPence != null) { if (!pence(b.totalPence)) return null; out.totalPence = b.totalPence; }
  if (b.orderDate != null) {
    const ok = typeof b.orderDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.orderDate) && !Number.isNaN(Date.parse(b.orderDate + "T00:00:00Z"))
      && new Date(b.orderDate + "T00:00:00Z").toISOString().slice(0, 10) === b.orderDate && b.orderDate >= "2000-01-01" && b.orderDate <= latest;
    if (!ok) return null;
    out.orderDate = b.orderDate;
  }
  if (b.items != null) {
    if (!Array.isArray(b.items) || b.items.length > 50) return null;
    const items = [];
    for (const i of b.items) {
      const name = i && typeof i.name === "string" ? words(i.name, 120) : null;
      if (!name || (i.qty != null && (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 999)) || (i.pricePence != null && !pence(i.pricePence))) return null;
      items.push({ name, qty: i.qty || 1, pricePence: i.pricePence == null ? null : i.pricePence });
    }
    out.items = items;
  }
  return Object.keys(out).length ? out : null;
}

// Fixes: what the shopper corrected replaces what was read (the latest fix on any of the order's emails, as for gifts).
// `fixed` says which parts are the shopper's own words.
export function attachFixes(orders, fixes) {
  const byId = new Map(fixes.map(f => [f.id, f]));
  for (const o of orders) {
    let pick = null;
    for (const id of o.emailIds || [o.id]) {
      const f = byId.get(id);
      if (f && (!pick || f.at > pick.at || (f.at === pick.at && id === o.id))) pick = f;
    }
    if (!pick) continue;
    let v = null; try { v = JSON.parse(pick.fields); } catch { v = null; }
    if (!v || typeof v !== "object") continue;
    const fixed = {};
    if (typeof v.shop === "string" && v.shop.trim()) { o.retailer = { ...(o.retailer || {}), name: v.shop.trim() }; fixed.shop = true; }
    if (Number.isInteger(v.totalPence) && v.totalPence >= 0) { o.totalPence = v.totalPence; o.currency = o.currency || "GBP"; o.totalFrom = "shopper"; fixed.total = true; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v.orderDate || "")) { o.orderDate = v.orderDate; fixed.date = true; }
    if (Array.isArray(v.items)) {
      o.items = v.items.filter(i => i && typeof i.name === "string" && i.name.trim())
        .map(i => ({ name: i.name.trim(), qty: Number.isInteger(i.qty) && i.qty > 0 ? i.qty : 1, pricePence: Number.isInteger(i.pricePence) ? i.pricePence : null }));
      fixed.items = true;
    }
    if (Object.keys(fixed).length) o.fixed = fixed;
  }
}

// Gifts: an order is a gift when the shopper's latest choice about any of its emails says so (a later email about the
// same order can become the one shown, so a choice made before then still counts). On the same moment, the card's own wins.
export function attachGifts(orders, gifts) {
  const byId = new Map(gifts.map(g => [g.id, g]));
  for (const o of orders) {
    let pick = null;
    for (const id of o.emailIds || [o.id]) {
      const g = byId.get(id);
      if (g && (!pick || g.at > pick.at || (g.at === pick.at && id === o.id))) pick = g;
    }
    if (pick && pick.g) o.gift = { for: typeof pick.who === "string" && pick.who ? pick.who : null };
  }
}

// Parcel updates join the purchase they belong to: by tracking number, then order number, then (for a carrier's
// "your parcel from <shop>") the most recent order from that shop placed in the month before. The furthest-along update wins.
const STAGE = { shipped: 1, in_transit: 2, due: 3, out_for_delivery: 4, delivered: 5 };
const letters = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
// UK law's 14 days is only ever Relay's estimate for an order paid in pounds (or with no amount read). An order in euros or
// dollars may not have been sold under UK law at all, so no date is worked out for it from the law: only one its own
// email gives.
const paidInPounds = (o) => !o || !o.currency || o.currency === "GBP";
export function attachDeliveries(orders, deliveries) {
  for (const o of orders) {
    const t = o.shipment && o.shipment.trackingNumber;
    let best = o.shipment ? { status: o.shipment.status || "shipped", at: null, carrier: o.shipment.carrier || null, trackingNumber: t || null } : null;
    for (const d of deliveries) {
      let hit = (t && d.trackingNumber && d.trackingNumber === t) || (d.orderRef && o.orderRef && String(d.orderRef).toUpperCase() === String(o.orderRef).toUpperCase() && (!d.retailer || storeKey(d) === storeKey(o)));
      if (!hit && !d.trackingNumber && d.merchant && o.orderDate && d.at) {
        const word = letters(d.merchant.split(/\s+/)[0]);
        const days = (Date.parse(d.at) - Date.parse(o.orderDate)) / 86400000;
        hit = word.length >= 3 && (letters(o.retailer && o.retailer.name).includes(word) || storeKey(o).includes(word)) && days >= 0 && days <= 31 &&
          !orders.some(p => p !== o && storeKey(p) === storeKey(o) && p.orderDate > o.orderDate && p.orderDate <= d.at);
      }
      if (!hit) continue;
      if (!best || (STAGE[d.status] || 0) > (STAGE[best.status] || 0) || ((STAGE[d.status] || 0) === (STAGE[best.status] || 0) && (d.at || "") > (best.at || ""))) {
        best = { status: d.status, at: d.at || null, carrier: d.carrier || (best && best.carrier) || null, trackingNumber: d.trackingNumber || (best && best.trackingNumber) || null };
      } else if (best && !best.carrier && d.carrier) best.carrier = d.carrier;
    }
    if (!best) continue;
    best.trackUrl = trackingLink(best.carrier, best.trackingNumber);
    o.delivery = best;
    // When the email gives no return deadline, show the least UK law allows for online orders: 14 days after delivery to tell the shop.
    // When it gives a window that starts at delivery ("within 28 days of delivery"), count it from the day it arrived.
    const r = o.returns || {};
    if (best.status === "delivered" && best.at && !r.deadline && !r.windowDays && paidInPounds(o)) {
      const d = new Date(Date.parse(best.at) + 14 * 86400000);
      if (!Number.isNaN(d.getTime())) o.returnBy = { date: d.toISOString().slice(0, 10), basis: "uk_law" };
    } else if (best.status === "delivered" && best.at && !r.deadline && r.windowFrom === "delivery" && Number.isInteger(r.windowDays) && r.windowDays > 0 && r.windowDays <= 365) {
      const d = new Date(Date.parse(best.at) + r.windowDays * 86400000);
      if (!Number.isNaN(d.getTime())) o.returnBy = { date: d.toISOString().slice(0, 10), basis: "window", from: "delivery" };
    }
  }
}

// When the emails give no return date, the earliest one that is safe to go by, counted from the order date (the parcel can
// only arrive after it): the window the email gives ("30 days to return", without saying from when), or, for an online
// order (one with an order number) that Relay has no parcel news for, the least UK law allows: 14 days. Marked `estimate`
// so the app says how it was worked out. Only a date still to come is given: one that's passed says nothing for sure.
export function estimateReturnBy(o, today) {
  const r = (o && o.returns) || {};
  if (!o || o.returnBy || r.deadline || !/^\d{4}-\d{2}-\d{2}$/.test(o.orderDate || "") || o.orderDate > today) return null;
  const windowDays = Number.isInteger(r.windowDays) && r.windowDays > 0 && r.windowDays <= 365 ? r.windowDays : null;
  const days = windowDays || (o.orderRef && !o.delivery && paidInPounds(o) ? 14 : null);
  if (!days) return null;
  const d = new Date(o.orderDate + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  const date = d.toISOString().slice(0, 10);
  return date >= today ? { date, basis: windowDays ? "window" : "uk_law", from: "order", estimate: true } : null;
}

// Where a return has got to: the return parcel (carrier emails about its tracking number) and the shop's own
// "we've received your return" / "your refund has been processed" emails, matched by order number.
export function attachReturnProgress(orders, deliveries, updates) {
  for (const o of orders) {
    const plan = o.returnPlan || null;
    const t = plan && plan.trackingNumber;
    const ref = o.orderRef ? String(o.orderRef).toUpperCase() : null;
    let parcel = null;
    if (t) for (const d of deliveries) {
      if (d.trackingNumber !== t) continue;
      if (!parcel || (STAGE[d.status] || 0) > (STAGE[parcel.status] || 0)) parcel = { status: d.status, at: d.at || null, carrier: d.carrier || (plan && plan.carrier) || null };
    }
    const mine = ref ? updates.filter(u => u.orderRef && String(u.orderRef).toUpperCase() === ref && (!u.retailer || !u.retailer.domain || storeKey(u) === storeKey(o))) : [];
    const received = mine.filter(u => u.stage === "received").sort((a, b) => (a.at || "").localeCompare(b.at || ""))[0] || null;
    const refunded = mine.filter(u => u.stage === "refunded").sort((a, b) => (b.at || "").localeCompare(a.at || ""))[0] || null;
    if (!parcel && !received && !refunded && !t) continue;
    o.returnProgress = {
      trackingNumber: t || null, carrier: (parcel && parcel.carrier) || (plan && plan.carrier) || null,
      trackUrl: t ? trackingLink((parcel && parcel.carrier) || (plan && plan.carrier) || null, t) : null,
      parcel, receivedAt: received ? received.at : null,
      refundedAt: refunded ? refunded.at : null, refundPence: refunded ? refunded.amountPence : null, currency: refunded ? refunded.currency : null
    };
  }
}

// Which items of an email order are being sent back. The shopper's own choice wins; otherwise, when a refund email
// gives an amount that matches exactly one set of the order's item prices, those items are shown as returned.
export function itemsForRefund(items, refundPence) {
  const priced = (items || []).map((it, i) => ({ i, p: it && Number.isInteger(it.pricePence) ? it.pricePence * (Number(it.qty) > 0 && !it.lineTotal ? Number(it.qty) : 1) : null }));
  if (!Number.isInteger(refundPence) || refundPence <= 0 || priced.length < 2 || priced.length > 12 || priced.some(x => x.p == null)) return null;
  let found = null;
  for (let mask = 1; mask < (1 << priced.length); mask++) {
    let sum = 0; const pick = [];
    for (let k = 0; k < priced.length; k++) if (mask & (1 << k)) { sum += priced[k].p; pick.push(priced[k].i); }
    if (sum === refundPence) { if (found) return null; found = pick; }   // two different sets fit: don't guess
  }
  return found && found.length < priced.length ? found : null;           // the whole order isn't a per-item answer
}
export function attachItemReturns(orders, marks) {
  const byId = new Map();
  for (const m of marks) { const e = byId.get(m.id) || {}; e[m.i] = m.status; byId.set(m.id, e); }
  for (const o of orders) {
    const mine = byId.get(o.id);
    if (mine) { o.itemReturns = mine; continue; }
    const rp = o.returnProgress, guess = rp && rp.refundPence != null ? itemsForRefund(o.items, rp.refundPence) : null;
    if (guess) { o.itemReturns = Object.fromEntries(guess.map(i => [i, "returning"])); o.itemReturnsFrom = "refund"; }
  }
}

// An email Relay itself sent (from its own sending address), which the receipt reader can mistake for a purchase.
function isRelayEmail(c, env) {
  const r = c.retailer || {}, domain = String(r.domain || "").toLowerCase();
  const own = (String(env.RELAY_EMAIL_FROM || "").match(/@([a-z0-9.-]+)/i) || [])[1];
  return domain === "resend.dev" || Boolean(own && domain === own.toLowerCase()) || /^relay$/i.test(String(r.name || "").trim()) && !c.orderRef;
}
async function listReceipts(env, shopperId, timing, opts = {}) {
  const maxRows = opts.rows || 500, maxCards = opts.cards || 100;
  const T0 = Date.now(), lap = (n) => { if (timing) timing[n] = Date.now() - T0; };
  const rows = await env.RELAY_DB.prepare(
    "SELECT id, status, details, created_at AS createdAt FROM captured_receipts WHERE shopper_id = ? AND status NOT IN ('dismissed','not_receipt') ORDER BY created_at DESC LIMIT " + maxRows)
    .bind(shopperId).all();
  // Recent orders always come too, even when lots of newer emails were read after them (otherwise an order still inside
  // its return window could miss the wallet just because many receipts arrived since).
  let recentRows = [];
  if (!opts.rows || opts.rows < 3000) {
    const since = new Date(Date.now() - RECENT_ORDER_DAYS * DAY_MS).toISOString().slice(0, 10);
    recentRows = (await env.RELAY_DB.prepare(
      "SELECT id, status, details, created_at AS createdAt FROM captured_receipts WHERE shopper_id = ? AND status NOT IN ('dismissed','not_receipt') AND json_extract(details, '$.orderDate') >= ? ORDER BY created_at DESC LIMIT 1000")
      .bind(shopperId, since).all()).results || [];
  }
  const seenRow = new Set();
  const rowList = [...(rows.results || []), ...recentRows].filter(r => !seenRow.has(r.id) && seenRow.add(r.id));
  lap("rowsMs"); if (timing) timing.rowCount = rowList.length;
  const all = rowList.map(r => ({ id: r.id, status: r.status, createdAt: r.createdAt, ...JSON.parse(r.details) }));
  lap("parseMs");
  const plans = all.filter(x => x.kind === "return_instructions");
  const deliveries = all.filter(x => x.kind === "delivery_update");
  const updates = all.filter(x => x.kind === "return_update");
  const orders = mergeOrderEmails(all.filter(x => x.kind !== "return_instructions" && x.kind !== "delivery_update" && x.kind !== "return_update"));
  const byOrder = new Map(orders.filter(o => o.orderRef).map(o => [o.orderRef, o]));
  // The remaining lookups do not depend on each other, so they run together instead of one after another.
  const keys = [...new Set(orders.flatMap(o => [storeKey(o), legacyStoreKey(o)]).filter(Boolean))];
  const lookups = [];
  for (let i = 0; i < keys.length; i += 40) {
    const chunk = keys.slice(i, i + 40), qs = chunk.map(() => "?").join(",");
    lookups.push(env.RELAY_DB.prepare(`SELECT store_key AS k, category, promo FROM receipt_learning WHERE shopper_id = ? AND store_key IN (${qs})`).bind(shopperId, ...chunk).all());
    lookups.push(env.RELAY_DB.prepare(`SELECT store_key AS k, category, COUNT(*) AS n FROM receipt_learning WHERE category IS NOT NULL AND store_key IN (${qs}) GROUP BY store_key, category`).bind(...chunk).all());
  }
  const [gone, rem, marks, gifts, fixes, sent, aiReads, ...learned] = await Promise.all([
    env.RELAY_DB.prepare("SELECT details FROM captured_receipts WHERE shopper_id = ? AND status = 'dismissed'").bind(shopperId).all(),
    env.RELAY_DB.prepare("SELECT receipt_id AS id, sent_at AS sentAt FROM return_reminders WHERE shopper_id = ?").bind(shopperId).all(),
    env.RELAY_DB.prepare("SELECT receipt_id AS id, item_index AS i, status FROM receipt_item_marks WHERE shopper_id = ?").bind(shopperId).all(),
    env.RELAY_DB.prepare("SELECT receipt_id AS id, is_gift AS g, recipient AS who, updated_at AS at FROM receipt_gifts WHERE shopper_id = ?").bind(shopperId).all(),
    env.RELAY_DB.prepare("SELECT receipt_id AS id, fields, updated_at AS at FROM receipt_fixes WHERE shopper_id = ?").bind(shopperId).all(),
    sharedByReceipt(env.RELAY_DB, shopperId, Date.now()),
    env.RELAY_DB.prepare("SELECT receipt_id AS id, fields, created_at AS at FROM receipt_ai_reads WHERE shopper_id = ? AND fields IS NOT NULL").bind(shopperId).all(),
    ...lookups
  ]);
  lap("lookupsMs"); if (timing) timing.dismissedCount = (gone.results || []).length;
  const dismissedRefs = new Set((gone.results || []).map(r => JSON.parse(r.details).orderRef).filter(Boolean));
  attachDeliveries(orders, deliveries);
  for (const p of plans) {
    if (p.orderRef && dismissedRefs.has(p.orderRef)) continue;
    const o = p.orderRef && byOrder.get(p.orderRef);
    // Only purchase emails get a card. A return email just adds its return details to the purchase it belongs to.
    if (o) o.returnPlan = p;
  }
  attachReturnProgress(orders, deliveries, updates);
  attachItemReturns(orders, (marks && marks.results) || []);
  attachGifts(orders, (gifts && gifts.results) || []);
  // What the AI read fills only what the rules missed, and the shopper's own fixes still win (so they come after).
  attachAiReads(orders, (aiReads && aiReads.results) || []);
  attachFixes(orders, (fixes && fixes.results) || []);
  attachShared(orders, sent);
  const remById = new Map((rem.results || []).map(r => [r.id, r]));
  // An order the shopper dismissed stays hidden even when the shop sent other emails about it.
  const cards = orders.filter(o => !(o.orderRef && dismissedRefs.has(o.orderRef)));
  for (const c of cards) { const r = remById.get(c.id); c.reminder = r ? (r.sentAt ? "sent" : "on") : "off"; }
  // What the app has been taught. A shopper's own choice always wins. Otherwise a category is used only when at least two
  // different shoppers chose it for the same store and it clearly leads, so one person's mistake never changes anyone else's list.
  const mine = new Map(), crowd = new Map();
  for (let i = 0; i < learned.length; i += 2) {
    for (const r of learned[i].results || []) mine.set(r.k, r);
    for (const r of learned[i + 1].results || []) { const a = crowd.get(r.k) || []; a.push(r); crowd.set(r.k, a); }
  }
  const crowdPick = (k) => {
    const a = (crowd.get(k) || []).slice().sort((x, y) => y.n - x.n);
    return a.length && a[0].n >= 2 && (a.length === 1 || a[0].n > a[1].n) ? a[0].category : null;
  };
  lap("prepMs");
  const recentDay = new Date(Date.now() - RECENT_ORDER_DAYS * DAY_MS).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  // One name per shop across all receipts from the same address (see agreedShopNames).
  const agreed = agreedShopNames(cards);
  return cards.filter(c => {
    // A store the shopper said "this is just promotions" about only hides emails that carry no order number.
    const l = mine.get(storeKey(c)) || mine.get(legacyStoreKey(c));
    if (l && l.promo && !c.orderRef && c.kind !== "return_instructions") return false;
    // Relay's own emails (return labels, swap confirmations) are not purchases.
    return !isRelayEmail(c, env);
  }).sort((a, b) => whenOf(b).localeCompare(whenOf(a)) || b.createdAt - a.createdAt)
    .filter((c, i) => i < maxCards || String(c.orderDate || "") >= recentDay).map(c => {
    const k = storeKey(c), old = legacyStoreKey(c), l = mine.get(k) || mine.get(old);
    const learned = (l && l.category) || crowdPick(k) || (old !== k ? crowdPick(old) : null) || null;
    // Apple receipts list every charge as an item, so when the total line wasn't found the items add up to it.
    if (c.totalPence == null && /(^|\.)apple\.com$/i.test((c.retailer && c.retailer.domain) || "") && (c.items || []).length && c.items.every(i => Number.isInteger(i.pricePence)))
      c = { ...c, totalPence: c.items.reduce((n, i) => n + i.pricePence, 0), totalFrom: "items" };
    // Receipts read by an older version are tidied here too: lines that aren't items go, the shop gets one clean name, and a
    // payment company's address (Shopify, Stripe…) is never shown as the shop's.
    const r0 = c.retailer || {};
    const domain = r0.domain ? String(r0.domain).toLowerCase().replace(/[^a-z0-9.-]/g, "") : null;
    // A shop name the shopper typed in is theirs, and isn't tidied away.
    const shown = (c.fixed && c.fixed.shop && r0.name) || (domain && agreed.get(domain)) || shopDisplayName({ ...r0, domain });
    const via = r0.via || (isVia(domain) ? domain : null);
    const retailer = { ...r0, domain: isVia(domain) ? null : domain, name: shown || r0.name || null, ...(shown && r0.name && shown !== r0.name ? { legalName: r0.name } : {}), ...(via ? { via } : {}) };
    // Where the app gets the shop's logo from (null: no logo to look for, so the app draws one from what was bought).
    retailer.logoDomain = logoDomainFor(retailer);
    c = { ...c, retailer, items: cleanItems(c.items) };
    const group = categorise(c, learned);
    // Each item's own group too (a supermarket shop's kitchen roll is Home & garden, its bananas Food & drink), with
    // `categorySure` when the item's own name said so rather than only the shop. Wrapped counts each item where it belongs.
    const kinds = itemCategories(c, learned);
    // A food order can still hold things that go back on their own (a kettle in the weekly shop): those items are marked.
    const keep = group.returnable === false && group.category === "food" ? returnableItems(c, kinds) : [];
    const items = (c.items || []).map((it, i) => (it && typeof it.name === "string" && it.name
      ? { ...it, category: kinds[i] ? kinds[i].category : group.category, categorySure: Boolean(kinds[i] && kinds[i].sure), ...(keep.includes(i) ? { returnable: true } : {}) } : it));
    // A return date Relay can safely go by when the emails don't give one (only for what can go back).
    // When the emails give no return date or window at all: the shop's own published returns policy, if Relay has read it
    // (return-policies.js). It gives the least the shopper can count on for most items, and replaces UK law's 14 days.
    const said = c.returns && (c.returns.deadline || c.returns.windowDays);
    const policy = (group.returnable || keep.length) && !said ? policyFor(retailer, c.currency) : null;
    const byPolicy = policy ? policyReturnBy(c, policy, today) : null;
    const guess = byPolicy || (group.returnable || keep.length ? estimateReturnBy(c, today) : null);
    // A photo is only shown when it is of the item bought (not the shop's logo or an advert in the email).
    return { ...c, items, hasImage: Boolean(c.hasImage && c.photoIsItem === true), ...group, categoryLearned: Boolean(learned), storeKey: k,
      ...(keep.length ? { returnableItems: keep } : {}), ...(guess ? { returnBy: guess } : {}), ...(policy ? { returnPolicy: policyForApp(policy) } : {}) };
  });
}

// One receipt as the help chat may see it (worker/support-chat.js), only when the shopper chooses to show it: what Relay
// read and shows on the card, never the email itself, and nothing that identifies the shopper or the order (no order
// number, address, tracking number, links or who a gift is for). Their own receipts only.
const HELP_BASIS = { uk_law: "Relay's estimate from UK law's 14 days", window: "from the return window in the shop's email", policy: "from the shop's published returns policy" };
export async function receiptForHelp(env, shopperId, receiptId) {
  if (!/^[0-9a-f-]{36}$/.test(String(receiptId || ""))) return null;
  const list = await listReceipts(env, shopperId, null, { rows: 3000, cards: 3000 });
  const c = list.find((r) => r.id === receiptId);
  if (!c) return null;
  const clip = (v, n) => String(v || "").replace(/https?:\/\/\S+/gi, "").replace(/[<>{}\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
  const all = Array.isArray(c.items) ? c.items : [];
  const items = all.slice(0, 12).map((i) => ({ name: clip(i.name, 80), qty: Number(i.qty) || 1, pricePence: Number.isFinite(i.pricePence) ? i.pricePence : null }));
  const said = c.returns && c.returns.deadline ? { date: c.returns.deadline, basis: "the shop's email gives this date" } : null;
  const guess = c.returnBy && c.returnBy.date ? { date: c.returnBy.date, basis: HELP_BASIS[c.returnBy.basis] || "Relay's estimate" } : null;
  return {
    shop: clip(c.retailer && c.retailer.name, 60) || null,
    date: c.orderDate || null, dateFromEmail: c.orderDateFrom === "email",
    totalPence: Number.isFinite(c.totalPence) ? c.totalPence : null, currency: c.currency || "GBP",
    items, moreItems: Math.max(0, all.length - items.length),
    group: c.category || null,
    returnBy: said || guess,
    delivery: c.delivery && c.delivery.status ? { status: String(c.delivery.status).replace(/_/g, " "), at: c.delivery.at || null } : null,
    checked: c.status === "confirmed" ? "they confirmed it's right" : c.needsShopperConfirmation ? "Relay wasn't sure and asked them to check it" : null,
    fixed: c.fixed ? ["shop", "total", "date", "items"].filter((k) => c.fixed[k]) : [],
    aiFilled: Array.isArray(c.aiFilled) ? c.aiFilled.slice(0, 6).map(String) : [],
  };
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
    `UPDATE gmail_oauth_states SET used_at = ? WHERE state_hash = ? AND provider IS NULL AND used_at IS NULL AND expires_at > ? RETURNING shopper_id`)
    .bind(opts.now, await sha256Hex(state), opts.now).first();
  if (!claimed) return back("failed");
  if (!(await hasConsent(env.RELAY_DB, ownerOf(claimed.shopper_id)))) return back("consent_needed");
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
  if (await inboxTaken(env, claimed.shopper_id, null, googleEmail)) return back("already_connected");
  const again = await connectedAgain(env, claimed.shopper_id, null, googleEmail);
  await saveConnection(env, claimed.shopper_id, null, googleEmail, tokens.refresh_token, opts.now);
  return back(again ? "reconnected" : slotOf(claimed.shopper_id) ? "added" : "connected");
}
// The same inbox was already in this place: it has been connected again (Relay's access had ended), not added.
async function connectedAgain(env, boxId, provider, address) {
  if (!address) return false;
  const was = await env.RELAY_DB.prepare("SELECT provider, google_email FROM gmail_connections WHERE shopper_id = ?").bind(boxId).first();
  return Boolean(was && (was.provider === "microsoft") === (provider === "microsoft") && String(was.google_email || "").toLowerCase() === String(address).toLowerCase());
}
// Whether this address is already another of the shopper's inboxes (an inbox is only ever read once).
async function inboxTaken(env, boxId, provider, address) {
  if (!address) return false;
  const want = String(address).toLowerCase(), outlook = provider === "microsoft";
  return (await inboxesOf(env.RELAY_DB, ownerOf(boxId))).some(x => x.shopper_id !== boxId && String(x.google_email || "").toLowerCase() === want && (x.provider === "microsoft") === outlook);
}

// One mailbox per place (boxId: the shopper's first inbox, or one of their others): connecting a different account in the
// same place replaces it (receipts already captured stay until the shopper disconnects). A different mailbox is read from
// the start; the same mailbox connected again (a new sign-in) carries on where it was.
export async function saveConnection(env, shopperId, provider, address, refreshToken, now) {
  const enc = await encrypt(env, refreshToken);
  await ensureGmailTables(env.RELAY_DB);
  await ensureAutoColumns(env.RELAY_DB);
  await ensurePushColumns(env.RELAY_DB);
  await ensureHealthColumns(env.RELAY_DB);
  const same = "gmail_connections.provider IS excluded.provider AND gmail_connections.google_email IS excluded.google_email";
  // A different mailbox in this place gets its own instant-email watch or subscription (mail-push.js sets one up within a
  // minute); the old one's notices no longer match anything and it lapses on its own. The same mailbox keeps its own.
  await env.RELAY_DB.prepare(
    `INSERT INTO gmail_connections (shopper_id,google_email,token_iv,token_data,connected_at,provider) VALUES (?,?,?,?,?,?)
     ON CONFLICT(shopper_id) DO UPDATE SET google_email=excluded.google_email, token_iv=excluded.token_iv,
       token_data=excluded.token_data, connected_at=excluded.connected_at, provider=excluded.provider,
       last_scan_at=CASE WHEN ${same} THEN gmail_connections.last_scan_at END,
       auto_cursor=CASE WHEN ${same} THEN gmail_connections.auto_cursor END,
       full_rev=CASE WHEN ${same} THEN gmail_connections.full_rev END,
       push_expires_at=CASE WHEN ${same} THEN gmail_connections.push_expires_at END,
       push_ref=CASE WHEN ${same} THEN gmail_connections.push_ref END,
       push_secret=CASE WHEN ${same} THEN gmail_connections.push_secret END,
       push_history=CASE WHEN ${same} THEN gmail_connections.push_history END,
       mail_ok_at=CASE WHEN ${same} THEN gmail_connections.mail_ok_at END,
       push_tried_at=NULL, push_error=NULL, mail_problem=NULL, mail_problem_at=NULL`)
    .bind(shopperId, address, enc.iv, enc.data, now, provider).run();
  // The first read starts straight away on Relay's side, so it happens even if the shopper closes the app at once.
  await startScanJob(env, shopperId, now, { restart: true });
}
// The same agreement the consent screen records, for a sign-in that showed the wording before going to Microsoft.
export async function recordConsent(env, shopperId, now) {
  await env.RELAY_DB.prepare(
    `INSERT INTO shopper_consents (shopper_id,version,text_hash,accepted_at) VALUES (?,?,?,?)
     ON CONFLICT(shopper_id,version) DO UPDATE SET accepted_at=excluded.accepted_at, withdrawn_at=NULL, text_hash=excluded.text_hash`)
    .bind(shopperId, CONSENT_VERSION, await sha256Hex(CONSENT_TEXT.join("\n")), now).run();
}
// A mailbox token held for a moment between Microsoft's reply and the shopper's browser finishing the sign-in.
export async function sealToken(env, plain) { return encrypt(env, plain); }
export async function openToken(env, iv, data) { return decrypt(env, iv, data); }

// Microsoft sends the browser back here after "Connect Outlook" (sign-in states are handled first, in auth.js).
// As with Gmail, the single-use state bound to the shopper who started is the only thing that identifies them.
export async function handleOutlookCallback(request, env, url, opts) {
  const appUrl = String(env.RELAY_APP_URL || opts.appUrl).split("#")[0];
  const back = result => Response.redirect(appUrl + "#outlook=" + result, 302);
  if (!outlookConfigured(env)) return back("not_configured");
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !/^[A-Za-z0-9_-]{43}$/.test(state)) return back("failed");
  const claimed = await env.RELAY_DB.prepare(
    `UPDATE gmail_oauth_states SET used_at = ? WHERE state_hash = ? AND provider = 'microsoft' AND used_at IS NULL AND expires_at > ? RETURNING shopper_id`)
    .bind(opts.now, await sha256Hex(state), opts.now).first();
  if (!claimed) return back("failed");
  if (!(await hasConsent(env.RELAY_DB, ownerOf(claimed.shopper_id)))) return back("consent_needed");
  let tokens = null;
  try {
    const res = await opts.fetchImpl(MS_AUTH + "/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET,
        redirect_uri: microsoftRedirect(env, url), grant_type: "authorization_code", scope: OUTLOOK_SCOPE
      })
    });
    tokens = res.ok ? await res.json().catch(() => null) : null;
  } catch { tokens = null; }
  if (!tokens || !tokens.refresh_token || !tokens.access_token) return back("failed");
  // Read access to mail must actually have been granted (not just sign-in).
  if (!/(^|[\s/])Mail\.Read(\s|$)/i.test(String(tokens.scope || ""))) return back("failed");
  let address = null;
  try {
    const p = await opts.fetchImpl(GRAPH + "/me?$select=mail,userPrincipalName", { headers: { Authorization: "Bearer " + tokens.access_token } });
    if (p.ok) { const me = await p.json(); address = (typeof me.mail === "string" && me.mail) || (typeof me.userPrincipalName === "string" && me.userPrincipalName) || null; }
  } catch { address = null; }
  if (await inboxTaken(env, claimed.shopper_id, "microsoft", address)) return back("already_connected");
  const again = await connectedAgain(env, claimed.shopper_id, "microsoft", address ? address.slice(0, 254) : null);
  await saveConnection(env, claimed.shopper_id, "microsoft", address ? address.slice(0, 254) : null, tokens.refresh_token, opts.now);
  return back(again ? "reconnected" : slotOf(claimed.shopper_id) ? "added" : "connected");
}

// Routes for a signed-in shopper. Returns a Response, or null if the path is not ours.
export async function handleGmailRoute(request, env, url, cors, shopper, opts) {
  const path = url.pathname;
  const m = request.method;
  if (path === "/relay/my/consent" && m === "GET") {
    const accepted = await hasConsent(env.RELAY_DB, shopper.id);
    // Someone who agreed to an earlier wording is told what changed, rather than being shown it as if for the first time.
    const earlier = accepted ? null : await env.RELAY_DB.prepare(
      "SELECT 1 AS ok FROM shopper_consents WHERE shopper_id = ? AND version <> ? AND withdrawn_at IS NULL").bind(shopper.id, CONSENT_VERSION).first();
    return json({ version: CONSENT_VERSION, text: CONSENT_TEXT, accepted, acceptedEarlier: Boolean(earlier),
      gmailAvailable: gmailConfigured(env), outlookAvailable: outlookConfigured(env) }, 200, cors);
  }
  if (path === "/relay/my/consent" && m === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || body.version !== CONSENT_VERSION) return json({ error: "consent_version_mismatch" }, 400, cors);
    await recordConsent(env, shopper.id, opts.now);
    return json({ ok: true }, 200, cors);
  }
  if (path === "/relay/my/consent/withdraw" && m === "POST") {
    return json({ ok: true, ...(await disconnect(env, shopper.id, opts.fetchImpl, { withdraw: true })) }, 200, cors);
  }
  if (path === "/relay/my/gmail/connect" && m === "POST") {
    const cb = await request.json().catch(() => ({}));
    // "Connect again" (again: the inbox's number, 1 for the first): the same inbox through Google's or Microsoft's own sign-in
    // once more, when Relay's access to it has ended. It keeps its place and its receipts, and its own address is suggested.
    const againSlot = cb && Number.isInteger(cb.again) && cb.again >= 1 && cb.again <= MAX_INBOXES ? cb.again : null;
    const againRow = againSlot ? await env.RELAY_DB.prepare("SELECT provider, google_email FROM gmail_connections WHERE shopper_id = ?")
      .bind(boxIdOf(shopper.id, againSlot)).first() : null;
    if (againSlot && !againRow) return json({ error: "gmail_not_connected" }, 409, cors);
    const outlook = againRow ? againRow.provider === "microsoft" : Boolean(cb && cb.provider === "microsoft");
    if (outlook ? !outlookConfigured(env) : !gmailConfigured(env)) return json({ error: "gmail_not_configured" }, 503, cors);
    if (!(await hasConsent(env.RELAY_DB, shopper.id))) return json({ error: "consent_required" }, 403, cors);
    let boxId = againRow ? boxIdOf(shopper.id, againSlot) : shopper.id;
    const another = !againRow && Boolean(cb && cb.another === true);
    // Which account Google's or Microsoft's page suggests: the inbox being connected again, or the shopper's own address.
    const hint = againRow ? againRow.google_email : another ? null : shopper.email;
    if (another) {
      const have = await inboxesOf(env.RELAY_DB, shopper.id);
      if (!have.some(x => x.shopper_id === shopper.id)) boxId = shopper.id;   // no first inbox yet: this one is the first
      else {
        const taken = new Set(have.map(x => slotOf(x.shopper_id)).filter(Boolean));
        let slot = 2; while (taken.has(slot) && slot <= MAX_INBOXES) slot++;
        if (slot > MAX_INBOXES) return json({ error: "too_many_inboxes", max: MAX_INBOXES }, 409, cors);
        boxId = boxIdOf(shopper.id, slot);
      }
    }
    const state = randomToken();
    await env.RELAY_DB.prepare("DELETE FROM gmail_oauth_states WHERE expires_at <= ?").bind(opts.now).run();
    await env.RELAY_DB.prepare(
      "INSERT INTO gmail_oauth_states (state_hash,shopper_id,created_at,expires_at,provider) VALUES (?,?,?,?,?)")
      .bind(await sha256Hex(state), boxId, opts.now, opts.now + STATE_TTL_MS, outlook ? "microsoft" : null).run();
    if (outlook) {
      const ms = new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID, response_type: "code", redirect_uri: microsoftRedirect(env, url), response_mode: "query",
        scope: OUTLOOK_SCOPE, state, prompt: "select_account", ...(hint ? { login_hint: hint } : {})
      });
      return json({ url: MS_AUTH + "/authorize?" + ms }, 200, cors);
    }
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(env, url), response_type: "code", scope: SCOPE,
      access_type: "offline", prompt: another ? "consent select_account" : "consent", include_granted_scopes: "false", state, ...(hint ? { login_hint: hint } : {})
    });
    return json({ url: "https://accounts.google.com/o/oauth2/v2/auth?" + params }, 200, cors);
  }
  if (path === "/relay/my/gmail" && m === "GET") {
    // instant: Gmail or Outlook tells Relay the moment this inbox gets new mail (mail-push.js), so the app doesn't say "every
    // 15 minutes". Only while the watch or subscription is in force and Relay is set up to hear it.
    const now = (opts && opts.now) || Date.now();
    const instant = x => Boolean(!x.mail_problem && x.push_expires_at && x.push_expires_at > now && (x.provider === "microsoft" ? outlookPushOn(env) : gmailPushOn(env)));
    // How each inbox is doing, from reads that worked only (see ensureHealthColumns): checkedAt is when Relay last read its
    // mail without a problem, and needsReconnect says Google or Microsoft ended Relay's access, so the app can say so and
    // offer to connect it again. (autoAt keeps its name for copies of the app from before, which show the later of it and
    // lastScanAt as "Checked": it used to be when the 15-minute check last had a go, even one that failed.)
    const health = x => ({ autoAt: x.mail_ok_at || null, checkedAt: Math.max(x.mail_ok_at || 0, x.last_scan_at || 0) || null,
      needsReconnect: x.mail_problem === "reconnect" });
    const c = await env.RELAY_DB.prepare(
      "SELECT * FROM gmail_connections WHERE shopper_id = ?").bind(shopper.id).first()
      .then(x => x && { provider: x.provider === "microsoft" ? "microsoft" : "google", googleEmail: x.google_email, email: x.google_email,
        connectedAt: x.connected_at, lastScanAt: x.last_scan_at, ...health(x), instant: instant(x) });
    // A scan in progress (or just finished), so the app can show it carrying on after the shopper comes back.
    const scanJob = c ? jobView(await jobOf(env, shopper.id)) : null;
    // Other inboxes, each with how its reading is going.
    const others = c ? await Promise.all((await inboxesOf(env.RELAY_DB, shopper.id)).filter(x => x.shopper_id !== shopper.id).map(async x => {
      const j = jobView(await jobOf(env, x.shopper_id));
      return { mailbox: slotOf(x.shopper_id), provider: x.provider === "microsoft" ? "microsoft" : "google", email: x.google_email,
        connectedAt: x.connected_at, lastScanAt: x.last_scan_at, ...health(x), instant: instant(x), ...(j ? { scan: j } : {}) };
    })) : [];
    return json({ connected: Boolean(c), ...(c || {}), ...(scanJob ? { scan: scanJob } : {}), others, maxInboxes: MAX_INBOXES }, 200, cors);
  }
  if (path === "/relay/my/gmail/scan" && m === "POST") {
    if (!(await hasConsent(env.RELAY_DB, shopper.id))) return json({ error: "consent_required" }, 403, cors);
    const sb = await request.json().catch(() => ({}));
    try {
      // A retry after a round that ran out of time asks for a small round (2 emails), so the same heavy emails get through.
      const thisYear = new Date(opts.now).getUTCFullYear(), want = Number(sb && sb.year);
      if (sb && sb.year !== undefined && !(Number.isInteger(want) && want >= thisYear - HISTORY_YEARS && want < thisYear))
        return json({ error: "bad_year", earliest: thisYear - HISTORY_YEARS }, 400, cors);
      // A past year for Wrapped is read on its own; every other scan is a job that carries on if the shopper leaves the app.
      const r = want
        ? await yearRound(env, shopper.id, opts.fetchImpl, opts.now, want, sb && typeof sb.cursor === "string" ? sb.cursor : "", Boolean(sb && sb.small === true))
        : await appScanRound(env, shopper.id, opts.fetchImpl, opts.now, { full: Boolean(sb && sb.full === true), small: Boolean(sb && sb.small === true), busyWaitMs: opts.busyWaitMs ?? 3000 });
      if (!want) await checkOtherInboxes(env, shopper.id, opts.now, Boolean(sb && sb.full === true));
      return json(r.body, r.status, cors);
    } catch (e) {
      // A round that hits a limit still answers, so the app can wait a moment and carry on from where it was.
      console.error("gmail scan round failed", String(e && e.message || e).slice(0, 160));
      return json({ error: "scan_busy", retryAfterMs: 3000 }, 503, cors);
    }
  }
  if (path === "/relay/my/gmail/history" && m === "GET") {
    // A year counts as read once every connected inbox has read it (an inbox added later still needs it).
    const boxes = (await inboxesOf(env.RELAY_DB, shopper.id)).map(b => b.shopper_id);
    const ids = boxes.length ? boxes : [shopper.id];
    const r = await env.RELAY_DB.prepare("SELECT shopper_id AS box, year, done_at AS doneAt FROM gmail_history_years WHERE (shopper_id = ? OR shopper_id LIKE ?) AND done_at IS NOT NULL ORDER BY year DESC")
      .bind(shopper.id, shopper.id + "~%").all();
    const byYear = new Map();
    for (const x of r.results || []) { if (!byYear.has(x.year)) byYear.set(x.year, new Map()); byYear.get(x.year).set(x.box, x.doneAt); }
    const years = [...byYear].filter(([, done]) => ids.every(id => done.has(id))).map(([year, done]) => ({ year, doneAt: Math.max(...ids.map(id => done.get(id))) }));
    const thisYear = new Date(opts.now).getUTCFullYear();
    return json({ years, earliest: thisYear - HISTORY_YEARS, recentFrom: ymd(opts.now - LOOKBACK_DAYS * DAY_MS).replace(/\//g, "-") }, 200, cors);
  }
  if (path === "/relay/my/gmail/find" && m === "POST") {
    if (!(await hasConsent(env.RELAY_DB, shopper.id))) return json({ error: "consent_required" }, 403, cors);
    const fb = await request.json().catch(() => ({}));
    const boxes = await inboxesOf(env.RELAY_DB, shopper.id);
    if (boxes.length <= 1) {
      const r = await findEmails(env, shopper.id, opts.fetchImpl, fb && fb.query);
      return json(r.body, r.status, { ...cors, "Cache-Control": "no-store" });
    }
    const each = await Promise.all(boxes.map(b => findEmails(env, b.shopper_id, opts.fetchImpl, fb && fb.query, 10).then(r => ({ r, b }), () => ({ r: { status: 502, body: { error: "gmail_unavailable" } }, b }))));
    const good = each.filter(x => x.r.status === 200);
    if (!good.length) return json(each[0].r.body, each[0].r.status, { ...cors, "Cache-Control": "no-store" });
    const lists = good.map(x => (x.r.body.results || []).map(res => ({ ...res, inbox: x.b.google_email || null })));
    const results = [];
    for (let i = 0; lists.some(l => i < l.length); i++) lists.forEach(l => { if (i < l.length) results.push(l[i]); });
    const problems = each.filter(x => x.r.status !== 200).map(x => ({ mailbox: slotOf(x.b.shopper_id), inbox: x.b.google_email || null, error: (x.r.body && x.r.body.error) || "gmail_unavailable" }));
    return json({ results, ...(problems.length ? { problems } : {}) }, 200, { ...cors, "Cache-Control": "no-store" });
  }
  if (path === "/relay/my/gmail/add" && m === "POST") {
    if (!(await hasConsent(env.RELAY_DB, shopper.id))) return json({ error: "consent_required" }, 403, cors);
    const ab = await request.json().catch(() => ({}));
    const r = await addEmail(env, boxIdOf(shopper.id, ab && Number(ab.mailbox)), opts.fetchImpl, opts.now, ab && ab.messageId);
    return json(r.body, r.status, cors);
  }
  if (path === "/relay/my/gmail/disconnect" && m === "POST") {
    const db = await request.json().catch(() => ({}));
    const slot = db && Number(db.mailbox);
    if (Number.isInteger(slot) && slot > 1) {
      if (slot > MAX_INBOXES) return json({ error: "not_found" }, 404, cors);
      return json({ ok: true, ...(await disconnectInbox(env, shopper.id, slot, opts.fetchImpl)) }, 200, cors);
    }
    return json({ ok: true, ...(await disconnect(env, shopper.id, opts.fetchImpl, { withdraw: false })) }, 200, cors);
  }
  if (path === "/relay/my/wrapped" && m === "GET") {
    const cards = await listReceipts(env, shopper.id, null, { rows: 3000, cards: 3000 });
    return json(buildWrapped(cards, url.searchParams.get("year"), opts.now, { industry: url.searchParams.get("industry") }), 200, cors);
  }
  // Everything the shopper bought that their style can be learned from: physical things only (no food, travel or apps),
  // across all their receipts rather than just the newest. The app works the style out on the device from this list.
  if (path === "/relay/my/style" && m === "GET") {
    const cards = await listReceipts(env, shopper.id, null, { rows: 3000, cards: 3000 });
    const things = [];
    // Each item by what it is: a jacket from a supermarket counts, the bread in the same order doesn't.
    const NOT_THINGS = ["food", "travel", "digital"];
    for (const c of cards) {
      if (c.kind === "return_instructions") continue;
      if (PERSONAL_MAIL.test(String((c.retailer && c.retailer.domain) || ""))) continue;
      const items = (c.items || []).filter(i => i && typeof i.name === "string" && i.name.trim() && !NOT_THINGS.includes(typeof i.category === "string" ? i.category : c.category)).slice(0, 20)
        .map(i => ({ name: i.name.slice(0, 120), variant: typeof i.variant === "string" ? i.variant.slice(0, 80) : null, pricePence: Number.isInteger(i.pricePence) ? i.pricePence : null, qty: i.qty || 1 }));
      if (!items.length) continue;
      things.push({ id: c.id, retailer: { name: (c.retailer && (c.retailer.name || c.retailer.domain)) || null }, orderDate: c.orderDate || null, category: c.category, hasImage: Boolean(c.hasImage), items });
      if (things.length >= 400) break;
    }
    return json({ receipts: things }, 200, cors);
  }
  if (path === "/relay/my/receipts" && m === "GET") {
    // The Receipts page asks for everything (?all=1); Home and the wallet only need the newest, so they stay quick.
    const all = url.searchParams.get("all") === "1";
    const timing = {}, t0 = Date.now(), list = await listReceipts(env, shopper.id, timing, all ? { rows: 3000, cards: 3000 } : {});
    timing.totalMs = Date.now() - t0;
    return json({ receipts: list, timing }, 200, cors);
  }
  const orig = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/original$/.exec(path);
  if (orig && m === "GET") {
    if (!(await hasConsent(env.RELAY_DB, shopper.id))) return json({ error: "consent_required" }, 403, cors);
    const rec = await env.RELAY_DB.prepare(
      "SELECT details FROM captured_receipts WHERE id = ? AND shopper_id = ?").bind(orig[1], shopper.id).first();
    if (!rec) return json({ error: "not_found" }, 404, cors);
    const d = JSON.parse(rec.details);
    const fromBox = boxIdOf(shopper.id, Number(d.mailbox));
    const conn = await env.RELAY_DB.prepare(
      "SELECT token_iv, token_data, provider FROM gmail_connections WHERE shopper_id = ?").bind(fromBox).first();
    if (!conn) return json({ error: "gmail_not_connected" }, 409, cors);
    // An email can only be opened from the mailbox it came from.
    const outlook = conn.provider === "microsoft";
    const mid = outlook ? d.outlookId : d.gmailId;
    if (typeof mid !== "string" || !(outlook ? OUTLOOK_ID : GMAIL_ID).test(mid)) return json({ error: "email_not_found" }, 404, cors);
    const access = await mailAccess(env, fromBox, conn, opts.fetchImpl);
    if (!access.token) { const n = noAccess(access); return json({ error: n.error }, n.status, cors); }
    const token = access.token;
    const r = outlook ? await buildOriginalOutlook(opts.fetchImpl, token, mid) : await buildOriginal(opts.fetchImpl, token, mid);
    return json(r.body, r.status, { ...cors, "Cache-Control": "no-store" });
  }
  // "Send this email to Relay" (shared-emails.js). GET: the copy that would be sent, for the shopper to check first. POST:
  // sends that copy ({ note }), or deletes what was sent ({ delete: true }). Their own receipts only; one copy per receipt.
  const shr = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/share$/.exec(path);
  if (shr && (m === "GET" || m === "POST")) {
    const now = opts.now || Date.now(), db = env.RELAY_DB, iso = (t) => new Date(Number(t)).toISOString();
    await ensureGmailTables(db);
    const body = m === "POST" ? await request.json().catch(() => ({})) : {};
    if (m === "POST" && body && body.delete === true) {
      // Deleting needs nothing else: not the inbox, and not even the receipt.
      await db.prepare("DELETE FROM shared_emails WHERE shopper_id = ? AND receipt_id = ?").bind(shopper.id, shr[1]).run();
      return json({ ok: true, deleted: true }, 200, cors);
    }
    if (!(await hasConsent(db, shopper.id))) return json({ error: "consent_required" }, 403, cors);
    const rec = await db.prepare("SELECT id, details FROM captured_receipts WHERE id = ? AND shopper_id = ? AND status NOT IN ('dismissed','not_receipt')")
      .bind(shr[1], shopper.id).first();
    if (!rec) return json({ error: "not_found" }, 404, cors);
    const d = JSON.parse(rec.details);
    // A receipt pasted in has no email in an inbox to send.
    if (!d.gmailId && !d.outlookId) return json({ error: "no_email" }, 409, cors);
    if (m === "POST") {
      const c = await db.prepare("SELECT SUM(created_at > ?) AS today, SUM(receipt_id <> ?) AS others FROM shared_emails WHERE shopper_id = ? AND expires_at > ?")
        .bind(now - DAY_MS, shr[1], shopper.id, now).first();
      if (Number(c && c.today) >= SHARES_PER_DAY || Number(c && c.others) >= SHARES_KEPT) return json({ error: "too_many_requests" }, 429, cors);
    }
    const got = await hiddenCopyOf(env, shopper, d, opts.fetchImpl);
    if (!got.copy) return json({ error: got.error }, got.status, cors);
    const copy = got.copy;
    if (m === "GET") {
      const kept = await db.prepare("SELECT created_at AS at, expires_at AS until FROM shared_emails WHERE shopper_id = ? AND receipt_id = ? AND expires_at > ?")
        .bind(shopper.id, shr[1], now).first();
      return json({ subject: copy.subject, from: copy.from, text: copy.text, cut: copy.cut, hidden: copy.hidden, keptDays: SHARE_DAYS,
        sent: kept ? { at: iso(kept.at), until: iso(kept.until) } : null }, 200, cors);
    }
    const fix = await db.prepare("SELECT fields FROM receipt_fixes WHERE shopper_id = ? AND receipt_id = ?").bind(shopper.id, shr[1]).first();
    const note = typeof body.note === "string" ? body.note.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    const sealed = await sealShared(env, { ...copy, note: note || null, read: readSummary(d), fixed: fix ? JSON.parse(fix.fields) : null });
    const until = now + SHARE_DAYS * DAY_MS;
    await db.prepare(`INSERT INTO shared_emails (id, shopper_id, receipt_id, domain, reader, data_iv, data, created_at, expires_at, looked_at) VALUES (?,?,?,?,?,?,?,?,?,NULL)
      ON CONFLICT (shopper_id, receipt_id) DO UPDATE SET domain = excluded.domain, reader = excluded.reader, data_iv = excluded.data_iv, data = excluded.data,
        created_at = excluded.created_at, expires_at = excluded.expires_at, looked_at = NULL`)
      .bind(crypto.randomUUID(), shopper.id, shr[1], copy.domain || (d.retailer && d.retailer.domain) || null, Number(d.parserVersion) || 0, sealed.iv, sealed.data, now, until).run();
    return json({ ok: true, sent: { at: iso(now), until: iso(until) } }, 200, cors);
  }
  // A receipt the shopper pasted in (an order email from any inbox): read like a scanned one and kept in Receipts. Only the
  // details read from it are kept, never the email itself. The same email pasted twice is kept once.
  if (path === "/relay/my/receipts/add-pasted" && m === "POST") {
    const raw = await request.text().catch(() => "");
    let body = null;
    if (raw.length <= 300000) { try { body = JSON.parse(raw); } catch { body = null; } }
    const text = body && typeof body.email === "string" ? body.email : "";
    if (text.trim().length < 40 || text.length > 250000) return json({ error: "invalid_receipt" }, 400, cors);
    await ensureGmailTables(env.RELAY_DB);
    const recent = await env.RELAY_DB.prepare(
      "SELECT COUNT(*) AS n FROM captured_receipts WHERE shopper_id = ? AND created_at > ? AND json_extract(details, '$.pasted') = 1").bind(shopper.id, opts.now - 3600000).first();
    if ((recent?.n || 0) >= 30) return json({ error: "too_many_requests" }, 429, cors);
    const { details, status } = classify(pastedAsEmail(text, opts.now), { pasted: true }, true);
    if (status === "not_receipt" || !details || details.kind === "not_receipt") return json({ ok: false, reason: "not_recognised" }, 200, cors);
    const ref = await sha256Hex("pasted:" + text.replace(/\s+/g, " ").trim());
    const seen = await env.RELAY_DB.prepare("SELECT id, status FROM captured_receipts WHERE shopper_id = ? AND message_ref = ?").bind(shopper.id, ref).first();
    let id = seen ? seen.id : crypto.randomUUID();
    if (seen) await env.RELAY_DB.prepare("UPDATE captured_receipts SET details = ?, status = 'pending' WHERE id = ? AND shopper_id = ?").bind(JSON.stringify(details), seen.id, shopper.id).run();
    else await env.RELAY_DB.prepare("INSERT INTO captured_receipts (id,shopper_id,message_ref,status,details,created_at) VALUES (?,?,?,?,?,?)")
      .bind(id, shopper.id, ref, "pending", JSON.stringify(details), opts.now).run();
    const r = details.retailer || {};
    return json({ ok: true, id, again: Boolean(seen && seen.status !== "dismissed"), kind: details.kind, store: r.name || r.domain || null, orderRef: details.orderRef || null,
      orderDate: details.orderDate || null, totalPence: details.totalPence == null ? null : details.totalPence, currency: details.currency || null,
      items: (details.items || []).slice(0, 10).map(i => ({ name: i.name, qty: i.qty, pricePence: i.pricePence == null ? null : i.pricePence })) }, 200, cors);
  }
  const act = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/(confirm|dismiss)$/.exec(path);
  if (act && m === "POST") {
    const res = await env.RELAY_DB.prepare(
      "UPDATE captured_receipts SET status = ? WHERE id = ? AND shopper_id = ? RETURNING id, details")
      .bind(act[2] === "confirm" ? "confirmed" : "dismissed", act[1], shopper.id).first();
    if (!res) return json({ error: "not_found" }, 404, cors);
    // Not theirs (or not a purchase), so not a gift of theirs either: who it was for goes too, and any copy sent to Relay.
    if (act[2] === "dismiss") await env.RELAY_DB.batch([
      env.RELAY_DB.prepare("DELETE FROM receipt_gifts WHERE shopper_id = ? AND receipt_id = ?").bind(shopper.id, act[1]),
      env.RELAY_DB.prepare("DELETE FROM receipt_fixes WHERE shopper_id = ? AND receipt_id = ?").bind(shopper.id, act[1]),
      env.RELAY_DB.prepare("DELETE FROM shared_emails WHERE shopper_id = ? AND receipt_id = ?").bind(shopper.id, act[1]),
      env.RELAY_DB.prepare("DELETE FROM receipt_ai_reads WHERE shopper_id = ? AND receipt_id = ?").bind(shopper.id, act[1])]);
    // "This is just promotions" teaches the app to hide that store's order-less emails for this shopper.
    const b = await request.json().catch(() => ({}));
    if (act[2] === "dismiss" && b && b.reason === "promo") {
      const k = storeKey(JSON.parse(res.details));
      if (k) await env.RELAY_DB.prepare(
        "INSERT INTO receipt_learning (shopper_id, store_key, category, promo, updated_at) VALUES (?,?,NULL,1,?) ON CONFLICT (shopper_id, store_key) DO UPDATE SET promo = 1, updated_at = excluded.updated_at")
        .bind(shopper.id, k, Date.now()).run();
    }
    return json({ ok: true }, 200, cors);
  }
  const lg = /^\/relay\/my\/logo\/([A-Za-z0-9.-]{3,80})$/.exec(path);
  if (lg && m === "GET") {
    const d = logoDomain(lg[1]);
    // A personal mailbox (a forwarded receipt) or a payment company is never shown as the shop.
    const asked = lg[1].toLowerCase();
    if (!d || PERSONAL_MAIL.test(d) || isVia(d) || PERSONAL_MAIL.test(asked) || isVia(asked)) return json({ error: "not_found" }, 404, cors);
    const row = await logoFor(env, opts.fetchImpl, d, opts.now || Date.now());
    if (!row) return json({ error: "not_found" }, 404, cors);
    return new Response(Uint8Array.from(atob(row.data), c => c.charCodeAt(0)), {
      status: 200, headers: { ...cors, "Content-Type": row.type, "Cache-Control": "private, max-age=604800", "X-Content-Type-Options": "nosniff" } });
  }
  const cat = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/category$/.exec(path);
  if (cat && m === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!b || typeof b.category !== "string" || !CATEGORY_KEYS.includes(b.category)) return json({ error: "bad_category" }, 400, cors);
    const row = await env.RELAY_DB.prepare("SELECT details FROM captured_receipts WHERE id = ? AND shopper_id = ?").bind(cat[1], shopper.id).first();
    const k = row && storeKey(JSON.parse(row.details));
    if (!k) return json({ error: "not_found" }, 404, cors);
    await env.RELAY_DB.prepare(
      "INSERT INTO receipt_learning (shopper_id, store_key, category, promo, updated_at) VALUES (?,?,?,0,?) ON CONFLICT (shopper_id, store_key) DO UPDATE SET category = excluded.category, updated_at = excluded.updated_at")
      .bind(shopper.id, k, b.category, Date.now()).run();
    return json({ ok: true }, 200, cors);
  }
  // The shopper says which items of an email order they're sending back (or not any more).
  const itm = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/items$/.exec(path);
  if (itm && m === "POST") {
    const b = await request.json().catch(() => ({}));
    const list = b && Array.isArray(b.items) ? b.items.slice(0, 50) : null;
    if (!list || !list.every(x => x && Number.isInteger(x.index) && x.index >= 0 && (x.status === "returning" || x.status === null)))
      return json({ error: "bad_items" }, 400, cors);
    const row = await env.RELAY_DB.prepare("SELECT details FROM captured_receipts WHERE id = ? AND shopper_id = ?").bind(itm[1], shopper.id).first();
    if (!row) return json({ error: "not_found" }, 404, cors);
    const count = Math.max(1, (JSON.parse(row.details).items || []).length); // an order with no item names is one thing
    if (list.some(x => x.index >= count)) return json({ error: "bad_items" }, 400, cors);
    const now = Date.now();
    await env.RELAY_DB.batch(list.map(x => x.status
      ? env.RELAY_DB.prepare("INSERT INTO receipt_item_marks (shopper_id, receipt_id, item_index, status, updated_at) VALUES (?,?,?,?,?) ON CONFLICT (shopper_id, receipt_id, item_index) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at").bind(shopper.id, itm[1], x.index, x.status, now)
      : env.RELAY_DB.prepare("INSERT INTO receipt_item_marks (shopper_id, receipt_id, item_index, status, updated_at) VALUES (?,?,?,'kept',?) ON CONFLICT (shopper_id, receipt_id, item_index) DO UPDATE SET status = 'kept', updated_at = excluded.updated_at").bind(shopper.id, itm[1], x.index, now)));
    return json({ ok: true }, 200, cors);
  }
  // The shopper says a receipt was a present for someone else (and, if they like, who for), or that it wasn't after all.
  // "Not a gift" is kept as a choice, with no name, so it wins over an earlier choice made on another email of the order.
  const gft = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/gift$/.exec(path);
  if (gft && m === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!b || typeof b.gift !== "boolean" || (b.for != null && typeof b.for !== "string")) return json({ error: "bad_gift" }, 400, cors);
    const who = b.gift && b.for ? b.for.replace(/\s+/g, " ").trim().slice(0, 40) : "";
    const row = await env.RELAY_DB.prepare("SELECT id FROM captured_receipts WHERE id = ? AND shopper_id = ? AND status NOT IN ('dismissed','not_receipt')")
      .bind(gft[1], shopper.id).first();
    if (!row) return json({ error: "not_found" }, 404, cors);
    await env.RELAY_DB.prepare(
      "INSERT INTO receipt_gifts (shopper_id, receipt_id, is_gift, recipient, updated_at) VALUES (?,?,?,?,?) ON CONFLICT (shopper_id, receipt_id) DO UPDATE SET is_gift = excluded.is_gift, recipient = excluded.recipient, updated_at = excluded.updated_at")
      .bind(shopper.id, gft[1], b.gift ? 1 : 0, who || null, opts.now || Date.now()).run();
    return json({ ok: true, gift: b.gift ? { for: who || null } : null }, 200, cors);
  }
  // "Fix this receipt": the shopper corrects what Relay read wrong (the shop, total, date or items), or undoes that. Their
  // words replace what was read for them straight away, and which parts were wrong is counted for the Relay health page.
  const fx = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/fix$/.exec(path);
  if (fx && m === "POST") {
    const b = await request.json().catch(() => ({}));
    const row = await env.RELAY_DB.prepare("SELECT details FROM captured_receipts WHERE id = ? AND shopper_id = ? AND status NOT IN ('dismissed','not_receipt')")
      .bind(fx[1], shopper.id).first();
    if (!row) return json({ error: "not_found" }, 404, cors);
    if (b && b.undo === true) {
      await env.RELAY_DB.prepare("DELETE FROM receipt_fixes WHERE shopper_id = ? AND receipt_id = ?").bind(shopper.id, fx[1]).run();
      return json({ ok: true, fixed: null }, 200, cors);
    }
    const now = opts.now || Date.now();
    const fix = cleanFix(b, new Date(now + DAY_MS).toISOString().slice(0, 10));
    if (!fix) return json({ error: "bad_fix" }, 400, cors);
    let d = {}; try { d = JSON.parse(row.details) || {}; } catch { d = {}; }
    const old = await env.RELAY_DB.prepare("SELECT fields, shop, total, date, items FROM receipt_fixes WHERE shopper_id = ? AND receipt_id = ?").bind(shopper.id, fx[1]).first();
    let prev = {}; try { prev = old ? JSON.parse(old.fields) || {} : {}; } catch { prev = {}; }
    const fields = { ...prev, ...fix }, had = (k) => Boolean(old && old[k]);
    const domain = String((d.retailer && d.retailer.domain) || "").toLowerCase().replace(/[^a-z0-9.-]/g, "") || null;
    await env.RELAY_DB.batch([
      env.RELAY_DB.prepare(`INSERT INTO receipt_fixes (shopper_id, receipt_id, fields, domain, reader, shop, total, date, items, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (shopper_id, receipt_id) DO UPDATE SET fields = excluded.fields, shop = excluded.shop, total = excluded.total, date = excluded.date, items = excluded.items, updated_at = excluded.updated_at`)
        .bind(shopper.id, fx[1], JSON.stringify(fields), domain, Number.isInteger(d.parserVersion) ? d.parserVersion : null,
          fix.shop !== undefined || had("shop") ? 1 : 0, fix.totalPence !== undefined || had("total") ? 1 : 0,
          fix.orderDate !== undefined || had("date") ? 1 : 0, fix.items !== undefined || had("items") ? 1 : 0, now, now),
      // New items mean the old "which items are going back" no longer lines up.
      ...(fix.items ? [env.RELAY_DB.prepare("DELETE FROM receipt_item_marks WHERE shopper_id = ? AND receipt_id = ?").bind(shopper.id, fx[1])] : [])]);
    return json({ ok: true, fixed: fields }, 200, cors);
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
