// Codes to show or scan: the barcode or QR code some emails carry ("bring your items to a store with the barcode below",
// "scan your QR code at a ParcelShop", "bring the QR code below to collect", a ticket's barcode). Relay keeps the code
// with the receipt it belongs to and shows it when it's needed.
//
// Rules (do not weaken):
//  * Only when the email clearly says what the code is for: a return in store, a return dropped off, a collection, or a
//    ticket. When unsure, nothing is kept.
//  * Never: an app-download QR code, a PIN or anything confidential, an eSIM's install code, a building pass or an
//    appointment, a code in a marketing email, or a code the email says is printed somewhere else.
//  * The shop's own words are quoted exactly. Nothing is worked out from them (never how something was paid).
//  * A deadline is only a date the email itself states.
//  * The picture is fetched once, when the email is read, with nothing of the shopper's sent (no cookies, no keys): only
//    an https address of a real host, a PNG, GIF, JPEG or WebP by its bytes (never SVG), 300 KB at most, a few seconds at
//    most. The picture's address is never kept. If it can't be fetched, the words and the deadline are kept without it.
//  * A code is served only to the shopper whose email it came from, and deleted wherever their mail data is deleted.
import { emailForCodes, htmlAsText, mimeParts, orderNewsOf } from "./receipt-parser.js";
import { domainBase, isVia } from "./receipt-reader.js";
import { PERSONAL_MAIL } from "./receipt-category.js";

export const RECEIPT_CODES_SQL = [
  // receipt_id: the email the code was read from (its captured_receipts row). type and data: the kept picture, or NULL
  // when it couldn't be fetched. words: the shop's own sentences about it (a JSON list). code_key: what makes it the same
  // code in another email (its number, or a fingerprint of its picture's address; never the address itself).
  `CREATE TABLE IF NOT EXISTS receipt_codes (
     shopper_id TEXT NOT NULL, receipt_id TEXT NOT NULL, idx INTEGER NOT NULL, purpose TEXT NOT NULL, kind TEXT,
     type TEXT, data TEXT, value TEXT, words TEXT, deadline TEXT, day TEXT, code_key TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY (shopper_id, receipt_id, idx))`,
  `CREATE INDEX IF NOT EXISTS idx_receipt_codes_receipt ON receipt_codes(receipt_id)`
];

export const CODE_PURPOSES = ["in_store_return", "drop_off_return", "collection", "ticket"];
export const MAX_CODES_PER_EMAIL = 10;
export const CODE_MAX_BYTES = 300 * 1024, CODE_MIN_BYTES = 60, CODE_MIN_PX = 40, CODE_WAIT_MS = 6000;

// ---- Finding codes in an email --------------------------------------------------------------------------------------
const MARK = (k) => "\u0001" + k + "\u0001";
const attr = (tag, name) => { const m = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i").exec(tag); return m ? (m[1] ?? m[2] ?? m[3] ?? "") : ""; };
const unamp = (s) => String(s || "").replace(/&amp;/gi, "&").replace(/&#0*38;/g, "&").replace(/&quot;/gi, '"').replace(/&#0*39;/g, "'").trim();
const CODE_ALT = /\b(?:bar\s?codes?|qr(?:\s?codes?)?|return code|ticket code|scan code)\b/i;
const CODE_SRC = /qr[-_ ]?code|barcode|bar[-_]code|create-qr|[/?&=_-]qr(?:[/?&=_.-]|$)|printerlesslabel|printerless|cht=qr|code128|pdf417|datamatrix/i;
const NOT_CODE_ALT = /\b(?:logo|app store|google play|download|wallet|facebook|instagram|twitter|tiktok)\b/i;
// What a code must never be.
const APP_DOWNLOAD = /\b(?:download|get|install|try)\b[^.\n]{0,40}\bapp\b|\bapp\b[^.\n]{0,30}\bdownload\b|\bapp store\b|\bgoogle play\b|\bscan (?:to|and) (?:download|install)\b|\bin (?:the|our) app\b/i;
const CREDENTIAL = /\be-?sims?\b|\bPUK\b|\bICCID\b|\bSM-DP\+|\bLPA:|\bactivation code\b/i;
const SECRET_NEAR = /\bPIN\b|\bpass(?:word|code)\b|\bconfidential\b|\bdo not share\b|\bdon(?:'|’)t share\b|\bsecurity code\b|\bverification code\b|\bone[- ]time\b/i;
const ACCESS_PASS = /\bvisitor\b|\bturnstiles?\b|\b(?:access|entry) to the building\b|\bgain access\b|\bappointment\b|\bconcierge\b|\bfront desk\b|\bmeeting\b|\byour host\b/i;
const PROMO_NEAR = /\b\d{1,3}\s?% off\b|£\s?\d+(?:\.\d\d)? off\b|\bdiscounts?\b|\bvouchers?\b|\bcoupons?\b|\bpromo(?:tion|tional)? ?codes?\b|\brewards?\b|\bloyalty\b|\b(?:reward|bonus|club) points\b|\bpoints (?:balance|earned)\b|\bspecial offer\b|\bredeem\b|\bfree (?:gift|drink|coffee|delivery)\b|\bsurvey\b|\bfeedback\b|\brefer a friend\b/i;
const PRINTED_ELSEWHERE = /\b(?:qr|bar) ?code (?:printed )?on (?:your|the) (?!phone|screen|mobile|device)[^.\n]{0,40}\b(?:number|bib|label|parcel|package|box|wristband|card|letter|envelope|bag|tag|receipt you)\b|\bon your (?:run|race|bib) number\b/i;
const CODE_WORD = /\bbar\s?codes?\b|\bqr\b|\bcode (?:below|above)\b|\breturn code\b/i;
// What it is for, as the email says.
const RETURN_WORD = /\breturn(?:s|ed|ing)?\b|\brefund(?:s|ed)?\b|\bexchange(?:s|d)?\b|\bsend (?:it|them|your items?) back\b/i;
const DROP_OFF = /\bdrop[- ]?(?:off|it off|them off)\b|\bparcel ?shops?\b|\bpost office\b|\blockers?\b|\bno printer\b|\bno label\b|\bprinter(?:-| )?less\b|\bprint in[- ]?(?:store|shop|parcel ?shop)\b|\blabel[- ]free\b|\bdrop[- ]?off point\b|\bcollection point\b|\bcourier\b/i;
const IN_STORE = /\bin[- ]?store\b|\b(?:to|at|into|in) (?:your|a|any|our|one of our|the) (?:nearest |local |participating )?(?:stores?|shops?|branch(?:es)?)\b/i;
const RECEIPT_BARCODE_ALT = /\btrans(?:action)?\.? ?bar\s?code\b|\breceipt bar\s?code\b/i;
const NEEDS_RECEIPT = /\b(?:original|this|your|e-?|proof of)\s*(?:receipt|purchase)\b/i;
const COLLECT = /\bcollect(?:s|ed|ing|ion)?\b|\bpick(?:ing)?[- ]?up\b|\binformation points?\b|\bcollection desk\b|\bclick (?:&|and) collect\b/i;
const SHOW_IT = /\b(?:bring|show|present|scan|have)\b/i;
const TICKET = /\btickets?\b|\be-?tickets?\b|\badmission\b|\bentry\b/i;
const RESTRICTION = /\bcannot\b|\bcan(?:'|’)?t\b|\bcan not\b|\bnot (?:be )?accepted\b|\bexcluding\b|\bexcept\b|\bonly\b|\bmust\b|\bphoto id\b|\brequired\b|\bneed(?:s|ed)? to\b|\bwithin \d{1,3} days\b|\baccompanied\b/i;

const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_DM = new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+" + MON + "\\.?(?:,?\\s+(\\d{4}))?\\b", "i");
const DATE_MD = new RegExp("\\b" + MON + "\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b", "i");
// A date written in words ("Sat, 6 Sept", "Wed 24 Dec 2025", "December 24"). Without a year it is the next such day on
// or after the day the email was sent, never one before it.
export function statedDate(text, sentAt) {
  const t = String(text || "");
  const a = DATE_DM.exec(t), b = a ? null : DATE_MD.exec(t);
  if (!a && !b) return null;
  const day = Number(a ? a[1] : b[2]), mon = MONTH[(a ? a[2] : b[1]).toLowerCase().slice(0, 4)] || MONTH[(a ? a[2] : b[1]).toLowerCase().slice(0, 3)];
  let year = Number(a ? a[3] : b[3]) || 0;
  if (!mon || day < 1 || day > 31) return null;
  const ok = (y) => { const d = new Date(Date.UTC(y, mon - 1, day)); return d.getUTCMonth() === mon - 1 && d.getUTCDate() === day ? d : null; };
  if (!year) {
    const ref = sentAt instanceof Date && !Number.isNaN(sentAt.getTime()) ? sentAt : null;
    if (!ref) return null;
    year = ref.getUTCFullYear();
    const d = ok(year);
    if (!d || d.getTime() < ref.getTime() - 864e5) year += 1;
  }
  if (year < 2000 || year > 2100) return null;
  const d = ok(year);
  return d ? d.toISOString().slice(0, 10) : null;
}
const BY_DATE = /\b(?:by|before|until|no later than|on or before)\b\s*:?\s*([^.\n]{3,40})/gi;
function deadlineIn(text, sentAt) {
  for (const s of String(text || "").split(/(?<=[.!?])\s+|\n+/)) {
    if (!/\breturn|\bdrop|\bsend|\bpost|\bcollect|\bback\b|\bpick|\bvalid\b|\bexpire/i.test(s)) continue;
    for (const m of s.matchAll(BY_DATE)) { const d = statedDate(m[1], sentAt); if (d) return d; }
    const e = /\b(?:valid until|expires?(?: on)?)\s*:?\s*([^.\n]{3,40})/i.exec(s); const d = e && statedDate(e[1], sentAt); if (d) return d;
  }
  return null;
}
const EVENT_DAY = /^[\s|]*(?:event date|date of (?:the )?event|event starts?|event day)\s*[:|]\s*([^\n|]{4,60})/im;

// A short fingerprint of some text (FNV-1a, twice over), only for telling two codes apart: never a secret.
function fingerprint(text) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0; }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
const sentences = (line) => String(line || "").split(/(?<=[.!?])\s+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
const tidyWords = (s) => s.replace(/[\u0001|]/g, " ").replace(/\s+/g, " ").replace(/^(?:in[- ]?store|in store|online|by post|drop[- ]?off|returns?)\s*:\s*/i, "").trim();
const goodWords = (s) => s.length >= 12 && s.length <= 260 && /\p{L}{3}/u.test(s) && !/https?:\/\/|@/.test(s);

// The address a code's picture can be fetched from: https (an http one is asked for as https), a real host's name, no
// sign-in in it. Anything else is not fetched.
export function codeImageUrl(src) {
  let u;
  try { u = new URL(unamp(src).replace(/^http:\/\//i, "https://")); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || u.href.length > 2500) return null;
  const h = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) || /^[0-9.]+$/.test(h) || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(h)) return null;
  return u.href;
}

// The codes in one email. `details` is what the email was read as (its kind decides a receipt's own barcode).
// Returns [{ purpose, kind, value, words, deadline, day, key, image }] where image is { url } to fetch, { type, data }
// for a picture inside the email itself, or null. Nothing here goes anywhere: the caller keeps what it needs.
export function findCodes(rawEmail, details = {}) {
  let mail;
  try { mail = emailForCodes(rawEmail); } catch { return []; }
  const html = mail.html;
  if (!html || !/<img\b/i.test(html) || !/qr|bar\s?code|return code/i.test(html)) return [];
  const imgs = [];
  const marked = html.replace(/<img\b[^>]*>/gi, (tag) => { imgs.push(tag); return " " + MARK(imgs.length - 1) + " "; });
  const cands = [];
  imgs.forEach((tag, k) => {
    const src = unamp(attr(tag, "src")), alt = unamp(attr(tag, "alt")), title = unamp(attr(tag, "title"));
    const w = Number((/^\d+/.exec(attr(tag, "width")) || [])[0] || 0), h = Number((/^\d+/.exec(attr(tag, "height")) || [])[0] || 0);
    if (!src || (w && w < 50) || (h && h < 30) || NOT_CODE_ALT.test(alt)) return;
    const named = alt + " " + title;
    if (!CODE_ALT.test(named) && !CODE_SRC.test(src.slice(0, 400))) return;
    cands.push({ k, src, alt, named });
  });
  if (!cands.length) return [];
  const text = htmlAsText(marked);
  const subject = String(mail.headers.subject || "").replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, "");
  const all = subject + "\n" + text.replace(/\u0001\d+\u0001/g, " ");
  // An eSIM's install code is a key to a phone line, wherever it sits in the email.
  if (CREDENTIAL.test(all)) return [];
  const sentAt = mail.headers.date ? new Date(mail.headers.date) : null;
  const isReceipt = (details.kind || "") === "receipt";
  const out = [], seen = new Set();
  for (const c of cands) {
    const at = text.indexOf(MARK(c.k));
    if (at < 0) continue;
    const clean = (s) => s.replace(/\u0001\d+\u0001/g, " ");
    const before = clean(text.slice(Math.max(0, at - 900), at)), after = clean(text.slice(at + MARK(c.k).length, at + 500));
    const tight = before.slice(-320) + "\n" + c.named + "\n" + after.slice(0, 220);
    if (APP_DOWNLOAD.test(tight) || SECRET_NEAR.test(tight) || ACCESS_PASS.test(before.slice(-500) + "\n" + after.slice(0, 300) + "\n" + subject) || PROMO_NEAR.test(tight) || PRINTED_ELSEWHERE.test(tight)) continue;
    // The lines that talk about this code: the nearest ones that name it, else the few around the picture.
    const bl = before.split("\n").map((l) => l.trim()).filter(Boolean), al = after.split("\n").map((l) => l.trim()).filter(Boolean);
    const nearB = bl.slice(-6), nearA = al.slice(0, 3);
    let focus = null;
    for (let i = nearB.length - 1; i >= 0 && !focus; i--) if (CODE_WORD.test(nearB[i])) focus = nearB[i];
    for (let i = 0; i < nearA.length && !focus; i++) if (CODE_WORD.test(nearA[i])) focus = nearA[i];
    const around = nearB.slice(-4).join("\n") + "\n" + c.named + "\n" + nearA.slice(0, 2).join("\n");
    const say = (focus || "") + "\n" + c.named;
    const wide = say + "\n" + around + "\n" + subject;
    let purpose = null;
    const ticketAlt = /^\s*(?:ticket\s+)?bar\s?code\s*[:#]\s*[A-Z0-9-]{6,}/i.test(c.alt);
    const pick = (t) => {
      const ret = RETURN_WORD.test(t);
      if (ret && DROP_OFF.test(t)) return "drop_off_return";
      if (ret && IN_STORE.test(t)) return "in_store_return";
      if (!ret && COLLECT.test(t) && SHOW_IT.test(t)) return "collection";
      if (!ret && TICKET.test(t) && (SHOW_IT.test(t) || /\bticket (?:number|no\.?|id|#)/i.test(t))) return "ticket";
      return null;
    };
    if (ticketAlt && TICKET.test(all) && !RETURN_WORD.test(say)) purpose = "ticket";
    purpose = purpose || pick(say) || pick(wide);
    // A shop receipt's own barcode, where the receipt says returns need the receipt.
    let receiptSays = null;
    if (!purpose && isReceipt && (RECEIPT_BARCODE_ALT.test(c.named) || /\breceipt\b/i.test(subject))) {
      receiptSays = all.split("\n").flatMap(sentences).find((s) => NEEDS_RECEIPT.test(s) && RETURN_WORD.test(s) && goodWords(tidyWords(s))) || null;
      if (receiptSays) purpose = "in_store_return";
    }
    if (!purpose) continue;
    // The shop's own words: the sentence about the code, then one that says what isn't allowed or is needed.
    const words = [];
    const add = (s) => { const t = tidyWords(s); if (goodWords(t) && !words.includes(t) && words.length < 2) words.push(t); };
    if (receiptSays) add(receiptSays);
    const focusS = focus ? sentences(focus) : [];
    const lead = focusS.find((s) => CODE_WORD.test(s));
    if (lead) add(lead);
    // (A short line that names how it goes back, "Evri Drop Off - No Printer Required", comes first.)
    const label = (l) => /:\s*[A-Z0-9-]{4,}\s*$/i.test(l) || (l.length <= 60 && /^[^:.]{0,24}:\s/.test(l));
    if (purpose === "drop_off_return") { const how = nearB.slice(-5).reverse().find((l) => l.length <= 80 && !/[.!?]$/.test(l) && !label(l) && DROP_OFF.test(l)); if (how) { words.length = 0; add(how); if (lead) add(lead); } }
    if (!words.length) { const line = [...nearB.slice(-4).reverse(), ...nearA.slice(0, 2)].flatMap(sentences).find((l) => !label(l) && pick(l + "\n" + c.named) === purpose && goodWords(tidyWords(l))); if (line) add(line); }
    if (!words.length) { const line = all.split("\n").flatMap(sentences).find((l) => !label(l) && CODE_WORD.test(l) && pick(l) === purpose && goodWords(tidyWords(l))); if (line) add(line); }
    const pool = [...focusS, ...nearA.slice(0, 2).flatMap(sentences), ...nearB.slice(-2).flatMap(sentences)];
    const rule = pool.find((s) => s !== lead && !/\bneed to print\b/i.test(s) && RESTRICTION.test(s) && goodWords(tidyWords(s)) && !words.includes(tidyWords(s)));
    if (rule) add(rule);
    // Its number, when the email gives it: in the picture's description, in the address that draws it, or labelled beside it.
    let value = (/\bbar\s?code\s*[:#]\s*([A-Z0-9-]{6,40})\b/i.exec(c.alt) || [])[1] || null;
    if (!value && /qr/i.test(c.src.slice(0, 300))) {
      try { const d = new URL(c.src.replace(/^http:/i, "https:")).searchParams.get("data"); if (d && /^[A-Za-z0-9 _.-]{4,64}$/.test(d.trim()) && /\d/.test(d)) value = d.trim(); } catch { /* not an address */ }
    }
    if (!value && purpose === "ticket") value = (/\bticket (?:number|no\.?|id|#)\s*[:#]?\s*([A-Z0-9-]{6,40})\b/i.exec(nearA.slice(0, 3).join("\n")) || /\bticket (?:number|no\.?|id|#)\s*[:#]?\s*([A-Z0-9-]{6,40})\b/i.exec(nearB.slice(-3).join("\n")) || [])[1] || null;
    if (value && !/\d/.test(value)) value = null;
    const returning = purpose === "in_store_return" || purpose === "drop_off_return";
    const deadline = purpose === "ticket" ? null : deadlineIn(clean(text.slice(Math.max(0, at - 700), at + 500)) + (returning ? "\n" + subject : ""), sentAt);
    const dayM = purpose === "ticket" ? EVENT_DAY.exec(all) : null;
    const day = dayM ? statedDate(dayM[1], sentAt) : null;
    const kind = /qr/i.test(c.named) || (/qr/i.test(c.src.slice(0, 300)) && !/bar\s?code/i.test(c.named)) ? "qr" : /bar\s?code/i.test(c.named + " " + c.src.slice(0, 300)) ? "barcode" : null;
    // The picture: one inside the email itself, or an address to fetch it from once.
    let image = null, srcKey = c.src;
    const cid = /^cid:(.+)$/i.exec(c.src);
    if (cid) {
      let part = null;
      try { part = mimeParts(rawEmail).images.find((p) => p.cid && p.cid === cid[1].trim()); } catch { part = null; }
      if (part) { image = { type: part.type, data: part.b64 }; srcKey = "cid:" + fingerprint(part.b64); }
    } else { const url = codeImageUrl(c.src); if (url) { image = { url }; srcKey = url; } }
    const key = value ? "v:" + value.toLowerCase() : "s:" + fingerprint(srcKey);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ purpose, kind, value, words, deadline, day, key, image });
    if (out.length >= MAX_CODES_PER_EMAIL) break;
  }
  return out;
}
// The shop a returns company's email is for, when the picture's address names it (".../returns/<shop>/...").
export function shopHintOf(rawEmail) {
  try { const m = /\/returns\/([a-z0-9][a-z0-9-]{2,40})\//i.exec(emailForCodes(rawEmail).html); return m ? m[1].toLowerCase() : null; } catch { return null; }
}
// An email that is nothing else to Relay but carries a code for an order it names: what is kept of it.
export function codeEmailDetails(rawEmail) {
  const n = orderNewsOf(rawEmail);
  let ref = n.orderRef;
  // (An order number written the way Amazon writes them is one wherever it sits.)
  if (!ref) { try { const e = emailForCodes(rawEmail); ref = (/\b(\d{3}-\d{7}-\d{7})\b/.exec(e.headers.subject + "\n" + htmlAsText(e.html).slice(0, 6000)) || [])[1] || null; } catch { ref = null; } }
  if (!ref) return null;
  const hint = shopHintOf(rawEmail);
  return { kind: "order_codes", at: n.at, orderRef: ref, retailer: n.retailer || null, ...(hint ? { shopHint: hint } : {}) };
}

// ---- The picture ------------------------------------------------------------------------------------------------------
export function codeImageType(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
// The picture's smaller side in pixels where its first bytes say (PNG, GIF), so a one-pixel tracker is never kept.
function smallSide(b) {
  if (b.length > 24 && b[0] === 0x89) return Math.min((b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0);
  if (b.length > 10 && b[0] === 0x47) return Math.min(b[6] | b[7] << 8, b[8] | b[9] << 8);
  return null;
}
function b64Of(bytes) { let out = ""; for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(out); }
export function checkedCodeImage(bytes) {
  if (!bytes || bytes.length < CODE_MIN_BYTES || bytes.length > CODE_MAX_BYTES) return null;
  const type = codeImageType(bytes);
  if (!type) return null;
  const px = smallSide(bytes);
  if (px != null && px < CODE_MIN_PX) return null;
  return { type, data: b64Of(bytes) };
}
// Fetches one code's picture, once. Nothing of the shopper's goes with the request.
export async function fetchCodeImage(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { headers: { Accept: "image/png,image/gif,image/jpeg,image/webp" }, redirect: "follow", signal: AbortSignal.timeout(CODE_WAIT_MS) });
    if (!res.ok || (res.url && !String(res.url).startsWith("https://"))) return null;
    const len = Number(res.headers && res.headers.get && res.headers.get("content-length"));
    if (Number.isFinite(len) && len > CODE_MAX_BYTES) return null;
    return checkedCodeImage(new Uint8Array(await res.arrayBuffer()));
  } catch { return null; }
}
function fromB64(data) { try { return Uint8Array.from(atob(data), (c) => c.charCodeAt(0)); } catch { return null; } }

// How many pictures keeping these codes would fetch (for the scan's allowance of outside calls).
export const codeFetchCount = (codes) => (codes || []).filter((c) => c.image && c.image.url).length;

// The database statements that keep one email's codes (and take away any it no longer has). A picture already kept for
// the same code stays (its address may have stopped working since); one that was never kept is tried once more.
// Codes of an order the shopper removed from Relay aren't kept.
export async function codeStatements(env, fetchImpl, shopperId, receiptId, codes, o = {}) {
  const db = env.RELAY_DB, now = o.now || Date.now();
  if (!(codes && codes.length) && !o.had) return [];
  const old = ((await db.prepare("SELECT code_key AS k, type, data, created_at AS at FROM receipt_codes WHERE shopper_id = ? AND receipt_id = ?").bind(shopperId, receiptId).all()).results) || [];
  const wipe = db.prepare("DELETE FROM receipt_codes WHERE shopper_id = ? AND receipt_id = ?").bind(shopperId, receiptId);
  if (!(codes && codes.length)) return old.length ? [wipe] : [];
  if (o.orderRef && o.sameOrderRef) {
    const gone = ((await db.prepare("SELECT json_extract(details, '$.orderRef') AS ref FROM captured_receipts WHERE shopper_id = ? AND status = 'dismissed'").bind(shopperId).all()).results) || [];
    if (gone.some((g) => g.ref && o.sameOrderRef(g.ref, o.orderRef))) return old.length ? [wipe] : [];
  }
  const kept = new Map(old.map((r) => [r.k, r]));
  const out = [wipe];
  for (let i = 0; i < codes.length && i < MAX_CODES_PER_EMAIL; i++) {
    const c = codes[i], was = kept.get(c.key);
    let pic = was && was.data ? { type: was.type, data: was.data } : null;
    if (!pic && c.image && c.image.data) { const b = fromB64(c.image.data); pic = b ? checkedCodeImage(b) : null; }
    else if (!pic && c.image && c.image.url && (!o.canFetch || o.canFetch())) pic = await fetchCodeImage(fetchImpl, c.image.url);
    out.push(db.prepare("INSERT INTO receipt_codes (shopper_id, receipt_id, idx, purpose, kind, type, data, value, words, deadline, day, code_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(shopperId, receiptId, i, c.purpose, c.kind || null, pic ? pic.type : null, pic ? pic.data : null, c.value || null, JSON.stringify(c.words || []), c.deadline || null, c.day || null, c.key, was ? was.at : now));
  }
  return out;
}

// ---- Which receipt each code belongs on -------------------------------------------------------------------------------
const letters = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const RETURNS_COMPANY = /(^|\.)(narvar\.com|happyreturns\.com|loopreturns\.com|zigzag\.global|reboundreturns\.com|returnsportal\.co\.uk|doddle\.com|sorted\.com)$/i;
const shopOf = (x) => {
  const r = (x && x.retailer) || {}, d = String(r.domain || "").toLowerCase();
  const own = d && !isVia(d) && !PERSONAL_MAIL.test(d) && !RETURNS_COMPANY.test(d);
  return { base: own ? domainBase(d).replace(/-/g, "") : "", name: letters(r.name), hint: letters(x && x.shopHint), known: Boolean(own || r.name || (x && x.shopHint)) };
};
function sameShop(a, b) {
  const fits = (x, y) => Boolean(x && y) && (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))));
  return fits(a.base, b.base) || fits(a.name, b.name) || fits(a.name, b.base) || fits(a.base, b.name) || fits(a.hint, b.base) || fits(a.hint, b.name);
}
// Puts each code on its receipt: `codes` on a card is [{ n, purpose, kind, words, deadline, day?, hasImage, value?, emailId? }].
//  * A code in one of the card's own emails is the card's.
//  * A code in another email about an order (the shop's shipping email, a return email, a ticket sent again) joins the
//    card with that order number from that shop: exactly one card, or none. An email whose shop can't be told (the shopper
//    forwarded it) joins only when one card alone has that order number.
//  * The same code in two emails (sent again, forwarded) shows once.
// n is the code's place among the card's codes in the order Relay first kept them, so it stays the same as more arrive.
export function attachCodes(cards, emails, codeRows, sameOrderRef) {
  if (!codeRows || !codeRows.length) return;
  const byEmail = new Map();
  for (const r of codeRows) { const a = byEmail.get(r.receipt_id) || []; a.push(r); byEmail.set(r.receipt_id, a); }
  const emailById = new Map(emails.map((e) => [e.id, e]));
  const cardOfEmail = new Map();
  for (const c of cards) for (const id of c.emailIds || [c.id]) cardOfEmail.set(id, c);
  const onCard = new Map();
  for (const [id, rows] of byEmail) {
    const e = emailById.get(id);
    if (!e) continue;
    let card = cardOfEmail.get(id) || null;
    if (!card && e.orderRef) {
      const same = cards.filter((c) => c.orderRef && sameOrderRef(c.orderRef, e.orderRef));
      const es = shopOf(e);
      const fits = es.known ? same.filter((c) => sameShop(es, shopOf(c))) : same;
      if (fits.length === 1) card = fits[0];
    }
    if (!card) continue;
    const list = onCard.get(card) || [];
    for (const r of rows) list.push({ r, e });
    onCard.set(card, list);
  }
  for (const [card, list] of onCard) {
    list.sort((a, b) => (a.r.created_at - b.r.created_at) || (a.e.createdAt - b.e.createdAt) || String(a.e.id).localeCompare(String(b.e.id)) || a.r.idx - b.r.idx);
    const seen = new Map(), out = [];
    for (const x of list) {
      const was = seen.get(x.r.code_key);
      // (The same code twice: the first one kept stays, unless only the later one has its picture.)
      if (was) { if (!was.x.r.has_image && x.r.has_image) { was.x = x; } continue; }
      const slot = { x }; seen.set(x.r.code_key, slot); out.push(slot);
    }
    const codes = out.map(({ x }, i) => {
      let words = []; try { words = JSON.parse(x.r.words || "[]"); } catch { words = []; }
      const code = { n: i + 1, purpose: x.r.purpose, kind: x.r.kind || null, words: Array.isArray(words) ? words.filter((w) => typeof w === "string").slice(0, 2) : [],
        deadline: x.r.deadline || null, ...(x.r.day ? { day: x.r.day } : {}), hasImage: Boolean(x.r.has_image), ...(x.r.value ? { value: x.r.value } : {}),
        ...(x.e.gmailId || x.e.outlookId ? { emailId: x.e.id } : {}) };
      // Where its picture is kept (never sent to the app).
      Object.defineProperty(code, "kept", { value: { receiptId: x.r.receipt_id, idx: x.r.idx }, enumerable: false });
      return code;
    });
    if (codes.length) card.codes = codes;
  }
}
export async function readCodeRows(db, shopperId) {
  try {
    return ((await db.prepare("SELECT receipt_id, idx, purpose, kind, value, words, deadline, day, code_key, created_at, (data IS NOT NULL) AS has_image FROM receipt_codes WHERE shopper_id = ? ORDER BY created_at, receipt_id, idx").bind(shopperId).all()).results) || [];
  } catch { return []; }
}
