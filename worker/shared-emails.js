// "Send this email to Relay". A shopper whose receipt Relay read wrong can choose to send that one email to Relay, so a
// person at Relay can see why and make the reader better for everyone's emails like it.
//
// Rules (do not weaken):
//  * Only when the shopper asks, one email at a time, after they have seen exactly what will be sent: the preview and the
//    copy that's kept are made the same way from the same email. (Google lets a person read someone's email only with their
//    agreement to that specific email.)
//  * Before it's shown or kept, personal details are hidden (hideDetails): web links, which can carry sign-in tokens; email
//    addresses; phone numbers; card numbers, gift card codes and other long numbers and codes; postcodes; address blocks;
//    and the shopper's name. Only the email's text is kept, with its subject, its sender and what Relay read from it: no
//    pictures, attachments or other headers.
//  * Kept encrypted, for SHARE_DAYS days at most, and deleted sooner when the shopper deletes it, removes the receipt,
//    disconnects that inbox, withdraws their permission or deletes their account (gmail.js).
//  * Only Relay's admins can read one, and each time one is opened it's recorded (audit_events). Admins never see who sent it.
import { emailForReading } from "./receipt-parser.js";
import { PERSONAL_MAIL } from "./receipt-category.js";
import { isAdmin } from "./resale-admin.js";

export const SHARE_DAYS = 30;
export const SHARES_PER_DAY = 10;
export const SHARES_KEPT = 30;
const MAX_TEXT = 40_000;
const DAY = 864e5;
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

// Made with the other receipt tables (gmail.js ensureGmailTables), so the ways a receipt is deleted can always reach it.
export const SHARED_EMAILS_SQL = `CREATE TABLE IF NOT EXISTS shared_emails (
  id TEXT PRIMARY KEY, shopper_id TEXT NOT NULL, receipt_id TEXT NOT NULL, domain TEXT, reader INTEGER,
  data_iv TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, looked_at INTEGER,
  UNIQUE (shopper_id, receipt_id))`;

// ---- Hiding personal details ---------------------------------------------------------------------------------------------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LINK = /(?:\bhttps?:\/\/|\bwww\.)[^\s<>"'()[\]{}|]+/gi;
const EMAIL = /[A-Z0-9._%+'-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
// UK numbers: +44 or 0, then 9 or 10 more digits, spaced or not.
const PHONE = /(?:(?:\+|\b00)44[\s-]?(?:\(0\)[\s-]?)?|\b0)(?:\d[\s-]?){8,9}\d\b/g;
// Card numbers: 13 to 19 digits in a row, or in groups of four. (An order number such as 202-1234567-1234567 is left.)
const CARD = /\b(?:\d{13,19}|\d{4}(?:[ -]\d{4}){2,3}(?:[ -]\d{1,4})?)\b/g;
// A code after words that say it's one (gift cards, vouchers, PINs, claim and redemption codes): capitals and digits, in
// groups or not, with at least one digit ("ABCD-1234-EFGH", "X7K29PQ4").
const CODE_KEY = /\b(?:gift\s?card|e-?gift|voucher|promo(?:tion)?|discount|redemption|redeem|claim|activation|security|access|pin)\s*(?:code|number|no\.?|pin|#)?\s*[:#-]?\s*/gi;
const CODE_ITSELF = /^(?=[A-Z0-9 -]*\d)[A-Z0-9]{4,}(?:[ -][A-Z0-9]{3,}){0,5}\b/;
// Long mixed letter-and-number strings (tokens, codes): at least 16 characters with both letters and digits.
const LONG_CODE = /\b(?=[A-Za-z0-9_-]{16,}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]+\b/g;
const POSTCODE = /\b(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/gi;
// A line that starts an address: "Delivery address", "Billing details", "Address:", "Ship to", "Delivering to:".
const ADDRESS_HEAD = /^(\s*(?:[|*•-]\s*)?(?:(?:your\s+)?(?:delivery|shipping|billing|postal|home|collection|invoice|customer|registered)\s+(?:address|details)|address|deliver(?:ing|ed)?\s+to|ship(?:ping|ped)?\s+to|bill(?:ing|ed)?\s+to|dispatch(?:ed|ing)?\s+to)\b\s*:?)(.*)$/i;
// After one, the lines that carry on the address: short, no prices or quantities, not a sentence, not another label.
const NOT_ADDRESS = /^\s*(?:payment|paid|order|items?|qty|quantity|price|total|sub-?total|delivery (?:method|option|date)|shipping (?:method|option)|summary|vat|thank|track|return|card|visa|mastercard|amex|paypal|klarna|apple pay|google pay)\b/i;
const MONEY_OR_QTY = /[£$€]|\b\d+\.\d{2}\b|\bx\s?\d+\b|\bqty\b|\bquantity\b/i;
// How the shopper paid, written between "Billed to" and the address on some receipts ("Visa •••• 4242").
const PAY_LINE = /^\s*(?:[|*•-]\s*)?(?:card|visa|mastercard|master card|amex|american express|maestro|debit card|credit card|paypal|klarna|apple pay|google pay)\b/i;
// A postcode as addresses write it (capitals), for finding an address that has no heading.
const POSTCODE_CAPS = /\b(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/g;
const addressGoesOn = (line) => {
  const l = line.trim();
  return l.length > 0 && l.length <= 60 && !NOT_ADDRESS.test(l) && !MONEY_OR_QTY.test(l) && !ADDRESS_HEAD.test(l) &&
    !/[.!?:]$/.test(l) && !/:\s/.test(l) && l.split(/\s+/).length <= 7;
};

// An address with no heading above it, found by its postcode: in a table cell of its own ("1 | Wool Scarf | 12 High Street
// London SW1A 1AA | £35.00 |"), on a line of its own under the lines that carry it ("Jess Smith / 12 High Street / London /
// SW1A 1AA"), or inside a longer line ("We'll deliver to 12 High Street, London SW1A 1AA on Friday"). The rest of the row or
// line (item names, prices, dates) stays. A postcode-like code with no address round it ("Size M1 2XL") is hidden on its own.
const STREET = /^(?:flat|apartment|apt|unit|suite|floor)\b|^\d+[a-z]?\b|\b(?:street|st|road|rd|avenue|ave|lane|ln|close|drive|dr|way|court|ct|place|pl|crescent|grove|gardens|terrace|square|sq|hill|park|mews|row|walk|green|rise|view|parade|house|cottage|farm|lodge|estate|centre|center|building|wharf|quay|yard|boulevard)\b/i;
const NAME_OR_TOWN = /^\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){0,2},?$/u;
const strip = (l) => l.replace(/^[\s|]+|[\s|]+$/g, "");
const BUILDING_WORDS = ["street", "road", "avenue", "lane", "close", "drive", "way", "court", "place", "crescent", "grove", "gardens", "terrace", "square",
  "hill", "mews", "row", "walk", "rise", "parade", "tower", "house", "mansions", "building", "wharf", "quay", "yard", "boulevard"];
// (Name words start with a capital, so no "any case" flag: with it, a capital would match any letter.)
const STREET_IN_TEXT = new RegExp("\\b(?:(?:[Ff]lat|FLAT|[Aa]partment|APARTMENT)\\s+\\d{1,4}[a-zA-Z]?,?\\s+)?\\d{1,5}[a-zA-Z]?,?\\s+(?:\\p{Lu}[\\p{L}'’-]+\\s+){1,3}(?:" +
  BUILDING_WORDS.flatMap((w) => [w[0].toUpperCase() + w.slice(1), w.toUpperCase()]).join("|") + ")\\b", "gu");
function hidePostcodeAddresses(lines, hidden) {
  const one = new RegExp(POSTCODE_CAPS.source);
  for (let i = 0; i < lines.length; i++) {
    if (!one.test(lines[i])) continue;
    const whole = strip(lines[i]), pm = one.exec(whole);
    // A postcode on a line (or in a cell) of its own, or after a town ("London SW1A 1AA"): the rest of the address is above.
    const lone = whole.replace(one, "").trim() === "";
    const town = !lone && pm.index > 0 && !whole.slice(pm.index + pm[0].length).trim() && NAME_OR_TOWN.test(whole.slice(0, pm.index).trim());
    let startsLine = lone || town;
    if (startsLine) {
      // (decided below, once the lines above have been looked at)
    } else if (lines[i].includes("|")) {
      const cells = lines[i].split("|");
      for (let c = 0; c < cells.length; c++) {
        const cell = cells[c].trim();
        if (!one.test(cell)) continue;
        // The cell keeps whatever isn't the address (a price, an item name round a postcode-like size).
        cells[c] = " " + hideInLine(cell, hidden) + " ";
        if (/^ \[address\]/.test(cells[c]) && cells.slice(0, c).every((x) => !x.trim())) startsLine = true;
      }
      lines[i] = cells.join("|").trim();
    } else {
      lines[i] = hideInLine(lines[i], hidden);
      startsLine = /^\s*\[address\]/.test(lines[i]);
    }
    if (!startsLine) continue;
    // The lines just above that carry the address's start: back to its street line (and the name just above that), or,
    // when there's no street line, a town or a name or two.
    const above = [];
    for (let k = i - 1; k >= 0 && above.length < 4; k--) {
      const l = strip(lines[k]);
      if (!l || /\[address\]/.test(l) || PAY_LINE.test(l) || !addressGoesOn(l)) break;
      above.push(l);
    }
    let take = 0, street = false;
    for (let d = above.length; d >= 1; d--) if (STREET.test(above[d - 1])) { take = d; street = true; break; }
    if (take) { if (above[take] && NAME_OR_TOWN.test(above[take])) take++; }
    else if (!town) while (take < Math.min(2, above.length) && NAME_OR_TOWN.test(above[take])) take++;
    if (lone || town) {
      // A town before the postcode needs a street line above to be sure it's an address ("Size M1 2XL" isn't).
      if (take && (lone || street)) { lines[i] = lines[i].replace(whole, "[address]"); hidden.addresses++; }
      else { take = 0; lines[i] = lines[i].replace(one, "[postcode]"); hidden.postcodes++; }
    }
    if (take) { lines.splice(i - take, take); i -= take; }
  }
}
// The postcode and the address words just before it, back to a column edge, a colon, the end of a sentence, or "to"/"at".
function hideInLine(line, hidden) {
  let s = line;
  for (const m of [...s.matchAll(POSTCODE_CAPS)].reverse()) {
    const from = Math.max(0, m.index - 80);
    const before = s.slice(from, m.index);
    let cut = 0;
    for (const re of [/[|:;]/g, /[.!?](?:\s|$)/g, /\b(?:to|at)\s/gi]) for (const x of before.matchAll(re)) cut = Math.max(cut, x.index + x[0].length);
    let at = from + cut;
    // Never start the hidden part in the middle of a word.
    if (!cut && from > 0) { const sp = before.search(/\s/); at = sp === -1 ? m.index : from + sp + 1; }
    const words = s.slice(at, m.index);
    const isAddress = words.trim() && (/\d|,/.test(words) || STREET.test(words.trim()));
    if (!isAddress) at = m.index;
    const head = s.slice(0, at);
    s = head + (head && !/\s$/.test(head) ? " " : "") + (isAddress ? "[address]" : "[postcode]") + s.slice(m.index + m[0].length);
    if (isAddress) hidden.addresses++; else hidden.postcodes++;
  }
  return s;
}

// "Hi Jess,", "Dear Mr Smith", "Thanks Sam!": the name after a greeting. (Spelt out in both cases: a name starts with a
// capital, and with the "any case" flag a capital would match any letter. "Thank You For Your Order" is not a name.)
const GREETING = /^(\s*(?:[Hh]i|HI|[Hh]ello|HELLO|[Hh]ey|HEY|[Dd]ear|DEAR|[Tt]hanks|THANKS|[Tt]hank you|THANK YOU|[Gg]ood (?:morning|afternoon|evening))[ ,]+)((?:(?:Mr|Mrs|Ms|Miss|Dr|Mx)\.?\s+)?\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)?)(?=[\s,!.]|$)/gmu;
const NOT_NAMES = new Set(["for", "your", "you", "from", "the", "a", "an", "to", "we", "our", "this", "again", "so", "very", "much", "all", "there", "everyone", "and", "in", "on"]);
// "Name: Jess Smith", "Customer: …", "Recipient: …".
const NAME_LINE = /^(\s*(?:name|full name|customer(?: name)?|recipient|account holder|card ?holder|billing name|ordered by|placed by)\s*:\s*)(.+)$/gim;

// The shopper's own names: each word of their profile name as written with a capital ("Will", "WILL", never "will"), and the
// part before the @ of their email addresses in any case. Whole words only.
export function namesToHide(profileName, addresses = []) {
  const out = [];
  for (const w of String(profileName || "").split(/[^\p{L}'’-]+/u).filter((w) => w.length >= 2)) {
    const cap = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    out.push({ text: cap, anyCase: false }, { text: w.toUpperCase(), anyCase: false });
  }
  for (const a of addresses) { const l = String(a || "").split("@")[0]; if (l.length >= 3) out.push({ text: l, anyCase: true }); }
  const seen = new Set();
  return out.filter((n) => { const k = n.text + "|" + n.anyCase; return !seen.has(k) && seen.add(k); });
}

// Returns the text with personal details replaced by [link], [email], [phone], [number], [code], [postcode], [address] and
// [name], and how many of each were hidden.
export function hideDetails(input, names = []) {
  const hidden = { links: 0, emails: 0, phones: 0, numbers: 0, codes: 0, postcodes: 0, addresses: 0, names: 0 };
  const swap = (re, label, key, keep) => (s) => s.replace(re, (...m) => { hidden[key]++; return (keep ? m[1] : "") + label; });
  let t = String(input || "").replace(/\r\n?/g, "\n");
  // Address blocks first, while the lines are still as they were: the heading stays, up to 6 lines after it go.
  const out = [], lines = t.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = ADDRESS_HEAD.exec(lines[i]);
    if (!m) { out.push(lines[i]); continue; }
    // "Delivery address | Billing address" (a table's two headings) is a heading, not an address.
    const rest = m[2].replace(/^[\s|:-]+/, "");
    const inline = Boolean(rest) && !/^(?:(?:delivery|shipping|billing|postal)\s+)?(?:address|details)\b/i.test(rest);
    out.push(m[1] + (inline ? " [address]" : rest ? " " + rest : ""));
    // The lines that carry it on (up to 6; blank lines before it starts are skipped). A card line between the heading and
    // the address ("Billed to / Visa •••• 4242 / Jess Smith / …") stays, and the address after it still goes.
    let taken = 0, j = i + 1;
    const kept = [];
    for (; j < lines.length && j <= i + 6 + kept.length; j++) {
      if (!lines[j].trim()) { if (taken || inline) break; continue; }
      if (!taken && !inline && !kept.length && PAY_LINE.test(lines[j])) { kept.push(lines[j]); continue; }
      if (!addressGoesOn(lines[j])) break;
      taken++;
    }
    out.push(...kept);
    if (taken || inline) hidden.addresses++;
    if (taken && !inline) out.push("[address]");
    i = j - 1;
  }
  hidePostcodeAddresses(out, hidden);
  t = out.join("\n");
  // A house or flat number before a street or building name, with no postcode near it ("3003 Example Tower",
  // "12 High Street"): at least one name word between them, so "1 House Salad" stays.
  t = t.replace(STREET_IN_TEXT, () => { hidden.addresses++; return "[address]"; });
  // A code after the words that say it's one.
  const codes = (s) => s.replace(CODE_KEY, (key, at, all) => {
    const m = CODE_ITSELF.exec(all.slice(at + key.length));
    if (!m) return key;
    hidden.codes++; codesAt.push([at + key.length, m[0].length]); return key;
  });
  const codesAt = [];
  codes(t);
  for (const [at, len] of codesAt.reverse()) t = t.slice(0, at) + "[code]" + t.slice(at + len);
  for (const step of [swap(LINK, "[link]", "links"), swap(EMAIL, "[email]", "emails"),
    swap(CARD, "[number]", "numbers"), swap(PHONE, "[phone]", "phones"), swap(LONG_CODE, "[code]", "codes"), swap(POSTCODE, "[postcode]", "postcodes"),
    swap(NAME_LINE, "[name]", "names", true)]) t = step(t);
  t = t.replace(GREETING, (m, greet, name) => {
    if (NOT_NAMES.has(name.split(/\s+/)[0].replace(/\.$/, "").toLowerCase())) return m;
    hidden.names++; return greet + "[name]";
  });
  for (const n of names) {
    const word = typeof n === "string" ? { text: n, anyCase: true } : n;
    if (!word || !word.text) continue;
    const re = new RegExp("(^|[^\\p{L}\\p{N}])" + esc(word.text) + "(?=$|[^\\p{L}\\p{N}])", word.anyCase ? "giu" : "gu");
    t = t.replace(re, (m, before) => { hidden.names++; return before + "[name]"; });
  }
  return { text: t.replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n"), hidden };
}

// What Relay read from the email, beside it, so the person reading can see what went wrong.
export function readSummary(d) {
  const r = d.retailer || {};
  return { kind: d.kind || "receipt", shop: r.name || null, domain: r.domain || null, orderRef: d.orderRef || null, orderDate: d.orderDate || null,
    totalPence: d.totalPence == null ? null : d.totalPence, currency: d.currency || null, confidence: d.confidence || null, reader: Number(d.parserVersion) || 0,
    items: (Array.isArray(d.items) ? d.items : []).slice(0, 30).map((i) => ({ name: String((i && i.name) || "").slice(0, 160), qty: i && i.qty, pricePence: i && i.pricePence != null ? i.pricePence : null })) };
}

// The copy of one email as it's shown to the shopper first and then kept: subject, sender, text, with details hidden.
export function sharedCopy(rawEmail, names = []) {
  const e = emailForReading(rawEmail);
  const sender = String(e.from || "");
  const address = (/<?([^<>\s"']+@([^<>\s"']+))>?\s*$/.exec(sender) || [])[2] || "";
  const forwarded = PERSONAL_MAIL.test(address.toLowerCase());
  const hide = (s) => hideDetails(s, names);
  // One version of the text: the fuller of the email's two (HTML turned into text, or its plain part), as the reader prefers.
  const whole = e.fromHtml.replace(/\s+/g, " ").length >= e.plain.replace(/\s+/g, " ").length ? e.fromHtml : e.plain;
  const subject = hide(String(e.subject).slice(0, 300)), main = hide(whole.slice(0, MAX_TEXT));
  const from = forwarded ? "A personal email address (forwarded)" : hide(sender.slice(0, 200)).text;
  const hidden = {};
  for (const part of [subject, main]) for (const [k, v] of Object.entries(part.hidden)) hidden[k] = (hidden[k] || 0) + v;
  return { subject: subject.text, from, date: e.date ? String(e.date).slice(0, 60) : null, text: main.text,
    hidden, cut: whole.length > MAX_TEXT, domain: forwarded ? null : address.toLowerCase().replace(/[^a-z0-9.-]/g, "") || null };
}

// ---- Keeping it encrypted --------------------------------------------------------------------------------------------------
const enc = new TextEncoder();
const b64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function key(env) {
  if (!env.AUTH_SECRET || String(env.AUTH_SECRET).length < 16) throw new Error("no key");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("relay-shared-email:" + env.AUTH_SECRET));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function sealShared(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(env), enc.encode(JSON.stringify(value))));
  return { iv: b64(iv), data: b64(data) };
}
export async function openShared(env, iv, data) {
  const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(env), unb64(data));
  return JSON.parse(new TextDecoder().decode(out));
}

// ---- What the shopper's app and export see ---------------------------------------------------------------------------------
// Sent emails still kept, by receipt (for the receipts list).
export async function sharedByReceipt(db, shopperId, now) {
  try {
    const rows = (await db.prepare("SELECT receipt_id AS id, created_at AS at, expires_at AS until, looked_at AS looked FROM shared_emails WHERE shopper_id = ? AND expires_at > ?")
      .bind(shopperId, now).all()).results || [];
    return new Map(rows.map((r) => [r.id, { at: new Date(Number(r.at)).toISOString(), until: new Date(Number(r.until)).toISOString(), read: Boolean(r.looked) }]));
  } catch (e) { if (/no such table/i.test(String(e && e.message))) return new Map(); throw e; }
}
// The receipts list: an order card is marked when any of its emails was sent.
export function attachShared(cards, sent) {
  if (!sent || !sent.size) return;
  for (const c of cards) {
    const ids = [c.id, ...(Array.isArray(c.emailIds) ? c.emailIds : [])];
    const hit = ids.map((id) => sent.get(id)).filter(Boolean).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (hit) { c.shared = hit; c.sharedId = ids.find((id) => sent.get(id) === hit); }
  }
}
// "Download my data": every email the shopper sent, as kept.
export async function sharedForExport(env, shopperId, now) {
  try {
    const rows = (await env.RELAY_DB.prepare("SELECT receipt_id, data_iv, data, created_at, expires_at, looked_at FROM shared_emails WHERE shopper_id = ? AND expires_at > ? ORDER BY created_at DESC")
      .bind(shopperId, now).all()).results || [];
    const out = [];
    for (const r of rows) {
      const v = await openShared(env, r.data_iv, r.data).catch(() => null);
      out.push({ receiptId: r.receipt_id, sentAt: new Date(Number(r.created_at)).toISOString(), deletedBy: new Date(Number(r.expires_at)).toISOString(),
        readByRelay: r.looked_at ? new Date(Number(r.looked_at)).toISOString() : null, note: v ? v.note || null : null,
        subject: v ? v.subject : null, from: v ? v.from : null, text: v ? v.text : null });
    }
    return out;
  } catch (e) { if (/no such table/i.test(String(e && e.message))) return []; throw e; }
}

// Deletes what's past its SHARE_DAYS. Runs every hour (worker.js).
export async function tidySharedEmails(env, now = Date.now()) {
  if (!env.RELAY_DB) return 0;
  try {
    const r = await env.RELAY_DB.prepare("DELETE FROM shared_emails WHERE expires_at <= ?").bind(now).run();
    return Number(r && r.meta && r.meta.changes) || 0;
  } catch (e) { if (/no such table/i.test(String(e && e.message))) return 0; throw e; }
}

// ---- Relay's admins ------------------------------------------------------------------------------------------------------
// GET /relay/my/admin/shared-emails: the list (no email text). GET …/<id>: one email, and the opening is recorded.
// POST …/<id> { delete: true }: deleted now. Anyone who isn't an admin gets "not found". Returns null for other paths.
export async function handleSharedEmailAdminRoute(path, method, request, env, cors, shopper, o) {
  const m = /^\/relay\/my\/admin\/shared-emails\/([0-9a-f-]{36})$/.exec(path);
  if (!m && path !== "/relay/my/admin/shared-emails") return null;
  if (!isAdmin(env, shopper)) return json({ error: "not_found" }, 404, cors);
  const db = env.RELAY_DB, now = (o && o.now) || Date.now(), id = m ? m[1] : null;
  const summary = (r, v) => ({ id: r.id, sentAt: new Date(Number(r.created_at)).toISOString(), deletedBy: new Date(Number(r.expires_at)).toISOString(),
    lookedAt: r.looked_at ? new Date(Number(r.looked_at)).toISOString() : null, reader: Number(r.reader) || 0, domain: r.domain || null,
    shop: v && v.read ? v.read.shop || v.read.domain || null : null, note: v ? v.note || null : null, read: v ? v.read : null, fixed: v ? v.fixed || null : null });
  try {
    if (!id) {
      if (method !== "GET") return json({ error: "not_found" }, 404, cors);
      const rows = (await db.prepare("SELECT id, domain, reader, data_iv, data, created_at, expires_at, looked_at FROM shared_emails WHERE expires_at > ? ORDER BY created_at DESC LIMIT 200")
        .bind(now).all()).results || [];
      const emails = [];
      for (const r of rows) emails.push(summary(r, await openShared(env, r.data_iv, r.data).catch(() => null)));
      return json({ emails, keptDays: SHARE_DAYS }, 200, cors);
    }
    const r = await db.prepare("SELECT id, domain, reader, data_iv, data, created_at, expires_at, looked_at FROM shared_emails WHERE id = ? AND expires_at > ?").bind(id, now).first();
    if (!r) return json({ error: "not_found" }, 404, cors);
    if (method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body || body.delete !== true) return json({ error: "invalid_request" }, 400, cors);
      await db.prepare("DELETE FROM shared_emails WHERE id = ?").bind(id).run();
      await record(db, shopper.id, "shared_email_deleted", id);
      return json({ ok: true }, 200, cors);
    }
    if (method !== "GET") return json({ error: "not_found" }, 404, cors);
    const v = await openShared(env, r.data_iv, r.data).catch(() => null);
    if (!v) return json({ error: "unreadable" }, 500, cors);
    // Every opening is recorded, by whom and when.
    await record(db, shopper.id, "shared_email_opened", id);
    if (!r.looked_at) await db.prepare("UPDATE shared_emails SET looked_at = ? WHERE id = ?").bind(now, id).run();
    return json({ ...summary({ ...r, looked_at: r.looked_at || now }, v), subject: v.subject, from: v.from, date: v.date || null, text: v.text,
      hidden: v.hidden || {}, cut: Boolean(v.cut) }, 200, cors);
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return id ? json({ error: "not_found" }, 404, cors) : json({ emails: [], keptDays: SHARE_DAYS }, 200, cors);
    throw e;
  }
}
async function record(db, adminId, what, id) {
  await db.prepare("INSERT INTO audit_events (id, actor_type, actor_id, event_type, subject_type, subject_id, metadata_json) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), "admin", adminId, what, "shared_email", id, "{}").run();
}
