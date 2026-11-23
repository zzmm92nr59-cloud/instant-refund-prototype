// Relay receipt reader: turns a raw order-confirmation email into structured
// purchase details. Pure functions, no network, no storage.
//
// Honesty rules:
//  - Anything not found is null. Nothing is guessed or invented.
//  - Every result is marked source "shopper_email": supplied by the shopper, so
//    it can be used to TRACK a purchase but never to trigger a refund.
//  - Output always carries a confidence level and the method that produced it,
//    so the app can ask the shopper to confirm low-confidence captures.

const MAX_INPUT = 600_000;
import { flightBooking, flightItemName, hasFlightNumber } from "./flight-booking.js";
import { domainBase, cleanItems, isOfferLine, rankShop, shopNamesInText, forwardedSender, mainLinkDomain, isVia, itemsFromCells, GAME_SHOP, gameTitle, gameItems, looksLikePerson, hiddenSenderDomain } from "./receipt-reader.js";
import { PERSONAL_MAIL } from "./receipt-category.js";
import { readItems, moneyOf, settleItems, checkItems, statedItemCount, lineOf, unexplainedGap } from "./receipt-items.js";
import { namesCheck } from "./item-names.js";
import { uberEmail, uberRideMoney, takeawayMerchant, groceryDayOf, gameBundle, grocerySubstitutions, orderAmended, supportRefund, paymentAuthorised, ticketSummary, labelledItems, bookingStay, expediaStay, tillEReceipt, eReceiptPlatform, pcsOrder, subscriptionStarted } from "./receipt-senders.js";

function decodeQuotedPrintable(text, charset = "utf-8") {
  const joined = text.replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < joined.length; i++) {
    const c = joined[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) { bytes.push(parseInt(joined.slice(i + 1, i + 3), 16)); i += 2; }
    else {
      const code = joined.charCodeAt(i);
      if (code < 128) bytes.push(code);
      else for (const b of new TextEncoder().encode(c)) bytes.push(b);
    }
  }
  try { return new TextDecoder(charset, { fatal: false }).decode(Uint8Array.from(bytes)); }
  catch { return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes)); }
}

// A base64 part is decoded in the character set it declares (Outlook often sends parts as base64 in windows-1252, where
// "£" is one byte that would come out garbled if read as UTF-8).
function decodeBase64(text, charset = "utf-8") {
  let bytes;
  // (Filled byte by byte: Uint8Array.from(text, fn) builds a list with an entry per byte first, many times a long part's size.)
  try { const bin = atob(text.replace(/\s+/g, "")); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); } catch { return ""; }
  try { return new TextDecoder(charset, { fatal: false }).decode(bytes); }
  catch { return new TextDecoder("utf-8", { fatal: false }).decode(bytes); }
}

// RFC 2047 "encoded words" in headers, e.g. =?UTF-8?Q?Thanks_for_your_order?= or =?UTF-8?B?...?=
function decodeMimeWords(value) {
  if (!/=\?[^?\s]+\?[BbQq]\?[^?]*\?=/.test(value)) return value;
  return value
    .replace(/(=\?[^?\s]+\?[BbQq]\?[^?]*\?=)\s+(?==\?[^?\s]+\?[BbQq]\?)/g, "$1")
    .replace(/=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g, (m, charset, enc, data) => {
      try {
        let bytes;
        if (enc.toUpperCase() === "B") bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        else {
          const q = data.replace(/_/g, " ");
          const out = [];
          for (let i = 0; i < q.length; i++) {
            if (q[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(q.slice(i + 1, i + 3))) { out.push(parseInt(q.slice(i + 1, i + 3), 16)); i += 2; }
            else out.push(q.charCodeAt(i) & 0xff);
          }
          bytes = Uint8Array.from(out);
        }
        return new TextDecoder(charset.toLowerCase() === "us-ascii" ? "utf-8" : charset, { fatal: false }).decode(bytes);
      } catch { return m; }
    });
}

// Invisible characters senders pad emails with (zero-width spaces and joiners, direction marks, soft hyphens), written
// as characters or as entities. They split words and numbers ("Order # \u202B205-…" reads as no order number at all).
const INVISIBLE = /[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]|&(?:zwnj|zwj|shy|lrm|rlm);|&#(?:x200[b-f]|x202[a-e]|xad|x34f|xfeff|820[3-7]|823[4-8]|173|847|65279);/gi;
export const withoutInvisible = (s) => String(s || "").replace(INVISIBLE, "");

// An email's bytes, as a mailbox gives them (Gmail's "raw", Outlook's "$value"), as text for the reader. Most emails are
// UTF-8 or 7-bit, but a part sent as 8bit in windows-1252 or iso-8859-1 has bytes that aren't UTF-8 ("£" is the single byte
// 0xA3): those bytes are read as windows-1252, and everything that is UTF-8 stays UTF-8 (round 4, 19 Nov 2026: the whole
// email used to be read as UTF-8, so such a "£" was lost and no price could be read).
const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
// A windows-1252 character sent inside UTF-8 as the control character with its number ("Sainsbury\u0092s": the shop's
// system put its "’" byte, 0x92, into UTF-8 as U+0092): read as the character it is, the way browsers show it. Those control
// characters are never text. Round 15.
const C1_CONTROL = /[\u0080-\u009f]/g;
const withoutC1 = (t) => (/[\u0080-\u009f]/.test(t) ? t.replace(C1_CONTROL, (c) => { const r = CP1252_HIGH[c.charCodeAt(0) - 0x80]; return r === c ? "" : r; }) : t);

// "a  |  b" with each "|" and the spaces around it swapped for `to`, the same as .replace(/\s*\|\s*/g, to) but in one
// pass: that pattern starts again at every space of a long blank run and so took seconds on a line of 40,000 spaces.
export function swapPipes(s, to) {
  return String(s).replace(/[\s|]+/g, (run) => { const k = run.split("|").length - 1; return k ? to.repeat(k) : run; });
}

export function mailText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { /* some bytes aren't UTF-8 */ }
  let out = "", i = 0;
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  while (i < b.length) {
    const c = b[i];
    if (c < 0x80) { let j = i; while (j < b.length && b[j] < 0x80 && j - i < 8192) j++; out += String.fromCharCode.apply(null, b.subarray(i, j)); i = j; continue; }
    const n = c >= 0xf0 && c <= 0xf4 ? 4 : c >= 0xe0 && c <= 0xef ? 3 : c >= 0xc2 && c <= 0xdf ? 2 : 0;
    if (n && i + n <= b.length) { try { out += utf8.decode(b.subarray(i, i + n)); i += n; continue; } catch { /* not a UTF-8 character */ } }
    out += c < 0xa0 ? CP1252_HIGH[c - 0x80] : String.fromCharCode(c);
    i++;
  }
  return out;
}

// Mojibake: a shop's own system read its UTF-8 as windows-1252 before sending, so "£" arrives as "Â£" and "’" as "â€™".
// Only when the email has those tell-tale pairs, each run of such characters is put back to what it was meant to be (when
// it is a real UTF-8 character once turned back into bytes).
const MOJIBAKE_SIGN = /Â[£\u00a0©®°±·]|â€[™˜œ“”¦¢\u009d]|â‚¬/;
const MOJIBAKE_RUN = /[\u00c2-\u00df][\u0080-\u00bf€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|[\u00e0-\u00ef][\u0080-\u00bf€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]{2}/g;
export function withoutMojibake(text) {
  const t = String(text || "");
  if (!MOJIBAKE_SIGN.test(t)) return t;
  const back = (ch) => { const k = CP1252_HIGH.indexOf(ch); return k >= 0 ? 0x80 + k : ch.charCodeAt(0); };
  return t.replace(MOJIBAKE_RUN, (m) => { try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from([...m].map(back))); } catch { return m; } });
}

function parseHeaders(block) {
  const headers = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = withoutC1(withoutInvisible(decodeMimeWords(line.slice(i + 1).trim())));
  }
  return headers;
}

function splitMessage(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m) return { headers: {}, body: raw };
  return { headers: parseHeaders(raw.slice(0, m.index)), body: raw.slice(m.index + m[0].length) };
}

function decodeBody(headers, body) {
  const enc = (headers["content-transfer-encoding"] || "").toLowerCase();
  const cs = ((headers["content-type"] || "").match(/charset="?([^";\s]+)"?/i) || [])[1] || "utf-8";
  if (enc.includes("quoted-printable")) return withoutC1(decodeQuotedPrintable(body, cs));
  if (enc.includes("base64")) return withoutC1(decodeBase64(body, cs));
  return withoutC1(body);
}

// Microsoft 365 rewrites every link in a protected mailbox to go through Safe Links
// (https://eur01.safelinks.protection.outlook.com/?url=<the real address>&data=...). The real address is put back, so a
// shop's links read the same from Outlook as from Gmail (its web address, its returns page, its parcel tracking).
const SAFE_LINK = /https?:\/\/[a-z0-9-]+\.safelinks\.protection\.outlook\.com\/?\?url=([^&"'\s<>]+)(?:&(?:amp;)?[^"'\s<>]*)?/gi;
export function unwrapSafeLinks(text) {
  const s = String(text || "");
  if (!/safelinks\.protection\.outlook\.com/i.test(s)) return s;
  return s.replace(SAFE_LINK, (m, url) => {
    try { const real = decodeURIComponent(url); return /^https?:\/\/[^\s"'<>]+$/i.test(real) ? real : m; } catch { return m; }
  });
}

// Collects text/plain and text/html parts, walking nested multipart bodies. Round 4 (19 Nov 2026):
//  * An email attached whole (Outlook's "Forward as attachment", message/rfc822) is read as a forward: its own sender, date
//    and subject written above its text, the way a forward writes them.
//  * Attachments (a PDF, a picture, a file of terms) are never read as the email's text; what was attached is noted
//    (out.attached), so a receipt that is only in its attachment can say so instead of showing nothing.
//  * Only text parts are decoded (an attached PDF is never decoded), each at most MAX_INPUT long, with pictures written
//    into the HTML itself (data: addresses) left out first: they can be far longer than the rest of the email.
function collectParts(headers, body, out, depth = 0) {
  if (depth > 6) return;
  const type = headers["content-type"] || "text/plain";
  const boundary = type.match(/boundary="?([^";]+)"?/i);
  if (/multipart\//i.test(type) && boundary) {
    const marker = "--" + boundary[1];
    for (const chunk of body.split(marker).slice(1)) {
      if (chunk.startsWith("--")) break;
      const part = splitMessage(chunk.replace(/^\r?\n/, ""));
      collectParts(part.headers, part.body, out, depth + 1);
    }
    return;
  }
  if (/^\s*message\/rfc822/i.test(type)) {
    const inner = splitMessage(decodeBody(headers, body).replace(/^\r?\n/, ""));
    const got = { text: [], html: [], attached: out.attached };
    collectParts(inner.headers, inner.body, got, depth + 1);
    const H = inner.headers, esc = (v) => String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const lines = ["---------- Forwarded message ---------", "From: " + (H.from || ""), "Date: " + (H.date || ""), "Subject: " + (H.subject || ""), "To: " + (H.to || "")];
    if (got.text.length) out.text.push(lines.join("\n") + "\n\n" + got.text.join("\n"));
    if (got.html.length) out.html.push("<div>" + lines.map(esc).join("<br>") + "</div><br>" + got.html.join("\n"));
    return;
  }
  const disposition = headers["content-disposition"] || "";
  const textual = /^\s*text\/(?:html|plain)\b/i.test(type) || !headers["content-type"];
  if (/^\s*attachment\b/i.test(disposition) || !textual) {
    if (out.attached) {
      const name = String((/\bfilename\*?="?([^";\r\n]{1,120})"?/i.exec(disposition) || /\bname\*?="?([^";\r\n]{1,120})"?/i.exec(type) || [])[1] || "");
      const kind = /^\s*application\/pdf\b/i.test(type) || /\.pdf$/i.test(name) ? "pdf" : /^\s*image\//i.test(type) || /\.(?:jpe?g|png|gif|webp|heic)$/i.test(name) ? "image" : textual ? "text" : "other";
      // (A picture shown inside the email, a logo with a Content-ID, is not something attached; nor is a part that is
      // another way of showing the email, such as Gmail's AMP copy.)
      const shownInside = kind === "image" && headers["content-id"] && !/^\s*attachment\b/i.test(disposition);
      if (!shownInside && !/^\s*text\//i.test(type)) out.attached.push({ kind, name });
      else if (textual && /^\s*attachment\b/i.test(disposition)) out.attached.push({ kind, name });
    }
    if (!textual) return;
    // (An attached text file is kept apart: read only when the email has no text of its own.)
    if (out.attachedText) out.attachedText.push(withoutInvisible(decodeBody(headers, body.slice(0, MAX_INPUT * 2))).replace(/\r\n?/g, "\n").slice(0, MAX_INPUT));
    return;
  }
  // (Line ends as sent, "\r\n", become "\n": a shop's name at the end of a line would otherwise carry the "\r".)
  let decoded = decodeBody(headers, body);
  // (And any attribute far longer than a person would read, a tracking address or a style written out 300 KB long, is
  // emptied: it says nothing about the order and would push the order out of what is read.)
  if (/text\/html/i.test(type)) decoded = decoded.replace(/\bdata:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{200,}/gi, "data:,").replace(/(\s[a-z][a-z0-9:-]*\s*=\s*)(["'])[^"'<>]{4000,}?\2/gi, '$1""');
  decoded = withoutMojibake(withoutInvisible(unwrapSafeLinks(decoded.slice(0, MAX_INPUT)))).replace(/\r\n?/g, "\n");
  if (/text\/html/i.test(type)) out.html.push(decoded);
  // (A "text" part that is really a web page, Ryanair's itinerary sends its HTML as text/plain: read as the page shows it,
  // never as tags. Round 15.)
  else if (/text\/plain/i.test(type)) out.text.push(PLAIN_IS_HTML.test(decoded.slice(0, 3000)) || (decoded.slice(0, 20000).match(/<\/?(?:td|tr|table|div|span|br|p)\b/gi) || []).length >= 30 ? htmlToText(decoded) : decoded);
}
const PLAIN_IS_HTML = /^\s*(?:<!doctype html\b|<html\b|<head\b|<body\b)/i;
// The longest raw email split into its parts (attachments are skipped without being decoded, so this is cheap).
const MAX_RAW = 12_000_000;

// A raw email split up for showing it as it was sent: its text, its HTML and the pictures inside it (with their
// Content-ID, so the HTML's "cid:" pictures can be put back). Only those parts are decoded; attachments are skipped.
const SHOWN_IMAGE = /^image\/(png|jpe?g|gif|webp)\b/i;
export function mimeParts(raw) {
  const out = { html: [], text: [], images: [] };
  const top = splitMessage(String(raw || "").slice(0, 8_000_000));
  walkShownParts(top.headers, top.body, out, 0);
  return out;
}
function walkShownParts(headers, body, out, depth) {
  if (depth > 8) return;
  const type = headers["content-type"] || "text/plain";
  const boundary = type.match(/boundary="?([^";]+)"?/i);
  if (/multipart\//i.test(type) && boundary) {
    for (const chunk of body.split("--" + boundary[1]).slice(1)) {
      if (chunk.startsWith("--")) break;
      const part = splitMessage(chunk.replace(/^\r?\n/, ""));
      walkShownParts(part.headers, part.body, out, depth + 1);
    }
    return;
  }
  const img = SHOWN_IMAGE.exec(type);
  if (img) {
    const b64 = /base64/i.test(headers["content-transfer-encoding"] || "") ? body.replace(/\s+/g, "") : "";
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) out.images.push({ type: "image/" + img[1].toLowerCase().replace("jpg", "jpeg"), cid: (headers["content-id"] || "").trim().replace(/^<|>$/g, ""), b64 });
    return;
  }
  if (/text\/html/i.test(type)) out.html.push(decodeBody(headers, body));
  else if (/text\/plain/i.test(type) && !/attachment/i.test(headers["content-disposition"] || "")) out.text.push(decodeBody(headers, body));
}

// The characters shops' HTML most often writes as named entities ("Levi&rsquo;s", "25&quot;", "&lt;orders@shop.com&gt;").
const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", pound: "£", euro: "€", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", middot: "·", bull: "•", times: "×", copy: "©", reg: "®", trade: "™", deg: "°", frac12: "½", eacute: "é",
  egrave: "è", ecirc: "ê", aacute: "á", agrave: "à", acirc: "â", iacute: "í", oacute: "ó", ouml: "ö", uuml: "ü", auml: "ä", ccedil: "ç", ntilde: "ñ", szlig: "ß", shy: "", zwnj: "", zwj: "", rarr: "→", larr: "←" };
// A plain-text part that a shop's system filled with bits of its HTML: the item table left in as tags, the pound sign written
// "&#163;" ("Total (inc. VAT): &#163;15.00", a pub chain's order-at-table email). Each table is read as a table and the
// entities as the characters they stand for; the rest of the lines stay as they are (coverage round).
function plainAsWritten(t) {
  if (!/<(?:table|tr|td)\b[^>]*>|&(?:#163|#x[aA]3|pound|amp|nbsp);/.test(t)) return t;
  return decodeEntities(t.replace(/<table\b[\s\S]*?<\/table>/gi, (tbl) => "\n" + htmlToTextAll(tbl) + "\n"));
}
// Pay-later companies, and what their emails about an instalment (not the purchase itself) say.
const PAY_LATER_SENDER = /(^|\.)(klarna\.(?:com|co\.uk)|clearpay\.co\.uk|afterpay\.com|laybuy\.com|payzilch\.com|zilch\.com)$/i;
const INSTALMENT = /\b(?:your next (?:automatic )?payment|next payment of|payment plan|instal?ments?|remaining (?:balance|amount)|scheduled payment|final\b[^\n]{0,40}\bpayment|payment (?:failed|didn(?:'|’)t go through)|pay(?:ment)? overdue)\b/i;
// A plain-text part that writes a link round several lines, "[Coffee Table" … "Qty:1](https://…)" (the whole product block
// is the link): the lines are read as written, without the brackets and the address. Round 11.
const linksOverLines = (t) => String(t).replace(/\[([^\[\]]{1,600}?\n[^\[\]]{0,600}?)\]\((?:https?:|mailto:)[^)\s]{0,2000}\)/g, "$1");
// The full-width pound sign some shops print ("Grand Total:￡123.20", Homary) is the pound sign (coverage round).
const fullWidthPounds = (t) => commaPence(String(t).replace(/\uffe1/g, "£"));
// Pence after a comma, "£ 14,66", "£ 162,97" (a shop from mainland Europe), in an email that never writes pence after a
// point: read as £14.66 (any point in the pounds sets thousands apart, "£ 1.299,00"). Round 11.
function commaPence(t) {
  if (!/£\s?\d{1,3}(?:\.\d{3})*,\d{2}(?![\d,])/.test(t) || /£\s?\d[\d,]*\.\d{2}(?!\d)/.test(t)) return t;
  return t.replace(/£(\s?)(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?![\d,])/g, (m, sp, n, p) => "£" + sp + n.replace(/\./g, "") + "." + p);
}
function decodeEntities(text) {
  // One pass, so "&amp;lt;" becomes "&lt;" (what the shop wrote), not "<".
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,7});/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return n === 160 ? " " : n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : m;
    }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}
// What an email builder's HTML has that no one sees (round 4, 19 Nov 2026), left out before it is read:
//  * Outlook-only copies inside <!--[if mso]> … <![endif]--> (everyone else is shown the copy after it), and comments;
//  * anything hidden with display:none, inline or by a class the email's style sheet hides outside its @media rules: a
//    preheader that names an item and its price, the mobile copy of the item table next to the desktop one.
// When leaving the hidden parts out would leave no price at all, they are kept (an email that shows its items only once
// its style sheet's @media rules apply).
const HIDDEN_STYLE = /\bstyle\s*=\s*(["'])[^"']*?\bdisplay\s*:\s*none\b[^"']*\1/i;
function hiddenClasses(html) {
  const out = new Set();
  for (const [, css] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    let flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
    // (Rules inside @media apply only on some screens: they are left out, with their braces.)
    for (let k = 0; k < 3; k++) flat = flat.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi, "");
    for (const [, sel, body] of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\bdisplay\s*:\s*none\b/i.test(body)) continue;
      for (const one of sel.split(",")) { const m = /^\s*(?:[a-z0-9]+)?\.([a-z0-9_-]+)\s*$/i.exec(one); if (m) out.add(m[1].toLowerCase()); }
    }
  }
  return out;
}
function withoutHidden(html) {
  let t = html.replace(/<!--\[if\s+(?![^\]]*!)[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const classes = hiddenClasses(t);
  const isHidden = (tag) => HIDDEN_STYLE.test(tag) || (classes.size > 0 && [...((/\bclass\s*=\s*["']([^"']*)["']/i.exec(tag) || [])[1] || "").toLowerCase().split(/\s+/)].some((c) => classes.has(c)));
  const OPEN = /<(div|table|span|p|td|tr|tbody|center|section|a|font|ul|li)\b[^>]*>/gi;
  let out = "", from = 0, guard = 0;
  for (let m; (m = OPEN.exec(t)) && guard < 5000; guard++) {
    if (!isHidden(m[0])) continue;
    // The hidden element ends at its own closing tag (the same kind of tag, counted through any nested inside it).
    const name = m[1].toLowerCase(), re = new RegExp("<(/?)" + name + "\\b[^>]*>", "gi");
    re.lastIndex = m.index + m[0].length;
    let depth = 1, end = -1;
    for (let x; (x = re.exec(t)); ) { depth += x[1] ? -1 : 1; if (!depth) { end = x.index + x[0].length; break; } }
    if (end === -1) break;
    out += t.slice(from, m.index) + " ";
    from = end; OPEN.lastIndex = end;
  }
  out += t.slice(from);
  return out;
}
// A price the email shows struck through (an old price, "£19.99" with a line through it beside "£10.99", "£49.55" over the
// "£29.56" paid): left out, so the price paid is read. Round 13.
function struckPrices(html) {
  // (Only beside the price that replaced it, within a few cells: a struck line on its own, an item that couldn't be
  // supplied, is read as the email shows it.)
  const html0 = String(html);
  const MON = /(?:£|&pound;|&#163;|&#xa3;)\s?\d/gi;
  return html0.replace(/(<(?:s|del|strike)\b[^>]{0,400}>|<[a-z][a-z0-9]{0,9}\b[^>]{0,400}?text-decoration\s*:\s*line-through[^>]{0,400}>)((?:\s|<[^>]{0,300}>){0,6})(?:£|&pound;|&#163;|&#xa3;)\s?\d[\d,]{0,9}(?:\.\d{2})?(?=\s{0,20}<\/)/gi, (m, a, b, at) => {
    const before = html0.slice(Math.max(0, at - 700), at), after = html0.slice(at + m.length, at + m.length + 700);
    const other = (before.match(MON) || []).length > 0 && /(?:£|&pound;|&#163;|&#xa3;)\s?\d[\d,]*\.\d{2}\s*<\/[a-z]+>\s*(?:<\/?[a-z][^>]{0,300}>\s*){0,8}$/i.test(before) || /^\s*(?:<\/?[a-z][^>]{0,300}>\s*){0,8}(?:£|&pound;|&#163;|&#xa3;)\s?\d/i.test(after);
    return other ? a + b : m;
  });
}
function htmlToText(html) {
  const shown = struckPrices(withoutHidden(html));
  return htmlToTextAll(/£|&pound;|&#163;|&#xa3;/i.test(shown) || !/£|&pound;|&#163;|&#xa3;/i.test(html) ? shown : html);
}
function htmlToTextAll(html) {
  // (The words the email shows, to tell a picture that is the only place an item is named from one beside its name.)
  let shown = null;
  const shownText = () => shown ?? (shown = decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").toLowerCase());
  return decodeEntities(html
    .replace(/\r\n?/g, "\n")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    // (A "|" the email writes inside a cell, "SanDisk 128GB … | A1 | Class 10", is part of what the cell says, not the edge of
    // a column: it is kept as "│" so the reader never splits a name there. Not when it sets facts apart, "Size: 8 | Qty: 2 |
    // £24.00", "XS | BLACK" (short words first). Round 8.)
    // (Each run of text between tags is taken whole and only one with a "|" is looked at: asking for the "|" in the pattern
    // itself took minutes on a long run with many "|" and no tag after it.)
    .replace(/>([^<>]*)</g, (m, t) => (!t.includes("|") ? m : /£|&pound;|&#163;|\b(?:qty|quantity|size|colou?r|price)\b\s*:/i.test(t) || t.split("|")[0].trim().split(/\s+/).length <= 3 ? m : ">" + t.replace(/\|/g, "\u2502") + "<"))
    // A table cell that is only a picture says what it shows in the picture's alt text: an item shown only as its photo
    // ("Dorma Pure Cotton Duvet Cover Set"). Only a description of three words or more (a logo's alt is the shop's name),
    // and only when the email doesn't write those words anywhere else.
    .replace(/<td\b([^>]*)>\s*(?:<a\b[^>]*>\s*)?<img\b[^>]*?\balt="([^"<>]{3,160})"[^>]*>\s*(?:<\/a>\s*)?<\/td>/gi, (m, a, alt) =>
      alt.trim().split(/\s+/).length >= 3 && !/\b(?:logo|icon|banner|photo of|image of)\b/i.test(alt) && !shownText().includes(decodeEntities(alt).replace(/\s+/g, " ").trim().toLowerCase()) ? `<td${a}>${alt}</td>` : m)
    // (Its name is in the alt text only when it isn't written anywhere else.)
    // (An item's extras in their own <div> or <p> inside the name's cell are lines of their own, not part of its name. A block
    // that opens straight after another closes starts the one new line the closing gave.)
    // (A definition list's terms and descriptions, <dt> and <dd>, are lines of their own too.)
    .replace(/(<\/(?:p|div|tr|li|h[1-6]|table|dt|dd|dl)>)(?:\s*<(?:p|div|li|h[1-6]|dt|dd|dl)\b[^>]*>)+/gi, "$1")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|dt|dd|dl)>/gi, "\n")
    .replace(/<(p|div|li|h[1-6]|dt|dd|dl)\b[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function money(str) {
  if (str == null) return null;
  // (Thousands with their commas, "1,184.36", or written without, "1184.36": never only the first three digits of it. Round 15.)
  const m = String(str).match(/([0-9]{1,3}(?:,[0-9]{3})+(?![0-9])|[0-9]+)(?:\.([0-9]{2}))?/);
  if (!m) return null;
  const pence = Math.round(Number(m[1].replace(/,/g, "") + "." + (m[2] || "00")) * 100);
  return Number.isFinite(pence) ? pence : null;
}

// ---- Totals that aren't in pounds ---------------------------------------------------------------------------------------
// A receipt in euros or dollars has its total read as it is written, in its own currency. Relay never converts it and
// never guesses the currency: "€" and "EUR" are euros; a dollar amount is read only when the email itself says which
// dollars (USD, US$, CAD, CA$, AUD, A$). Nothing that adds up pounds counts these (wrapped.js and the app add up GBP only).
// Only tried when the email has no pound amounts at all.
const F_LABEL = "(?:(?:order\\s+|grand\\s+)?total(?:\\s+(?:including|incl\\.?|inc\\.?)\\s+(?:delivery|postage|shipping|vat|tax|p&p))?(?:\\s+(?:paid|amount|charged|cost|price|to pay|due))?|amount\\s+(?:paid|charged|due)|you\\s+paid)";
const F_NUM = "((?:\\d{1,3}(?:[.,]\\d{3})+|\\d+)(?:[.,]\\d{2})?)(?![\\d.,]*\\d)";
const F_GAP = "(?:\\s*\\([^)\\n]{1,40}\\))?\\s*(?:[:|]\\s*){0,3}";
// (Polish złoty, "34.53 zł", and Mexican pesos, "MX$99.00" or "$99.00 MXN", too: a ride or a flight's wifi abroad. Round 13.)
const F_BEFORE = new RegExp("\\b" + F_LABEL + F_GAP + "(€|EUR|US ?\\$|USD|CA\\$|CAD|AU?\\$|AUD|MX ?\\$|MXN|PLN|\\$)[ \\t]?" + F_NUM, "gi");
const F_AFTER = new RegExp("\\b" + F_LABEL + F_GAP + F_NUM + "[ \\t]?(€|EUR\\b|USD\\b|CAD\\b|AUD\\b|MXN\\b|PLN\\b|zł)", "gi");
const DOLLARS = [["USD", /\bUSD\b|US ?\$|\bU\.?S\.? dollars?\b/i], ["CAD", /\bCAD\b|CA\$|\bCanadian dollars?\b/i], ["AUD", /\bAUD\b|(?<![A-Za-z])AU?\$|\bAustralian dollars?\b/i],
  // (Mexican pesos, "MX$ 30.00" or "150.00 MXN": a game shop's receipt bought in Mexico, a ride paid in Mexico. Round 13.)
  ["MXN", /\bMXN\b|\bMX ?\$|\bMexican pesos?\b/i]];
// "80.00", "80,00", "1,234.56" and "1.234,56" all read; anything else (three decimals, mixed-up separators) doesn't.
export function foreignMinor(raw) {
  const m = /^(\d{1,3}(?:[.,]\d{3})+|\d+)(?:([.,])(\d{2}))?$/.exec(String(raw == null ? "" : raw));
  if (!m) return null;
  const groups = m[1].match(/[.,]/g) || [];
  if (new Set(groups).size > 1 || (m[2] && groups.includes(m[2]))) return null;
  const n = Number(m[1].replace(/[.,]/g, "")) * 100 + Number(m[3] || 0);
  return Number.isSafeInteger(n) ? n : null;
}
function foreignTotal(text, opts = {}) {
  // (Pounds only in brackets, "VAT $10.00 (£7.38)", is the tax shown in pounds for the record: the money is in dollars.
  // Round 11.)
  // (Nor an offer's starting price in pounds, "One-way ride from £47.10", beside a hotel bill in euros. Round 12.)
  // (Nor what a payment service took in pounds to pay a bill in another currency, "MASTER_CARD Debit ••3534 | £4.19 GBP"
  // under "Total | $5.39 USD", when it says it converted the money: "PayPal's conversion rate". Round 13.)
  const converted = /\bconversion rate\b|\bcurrency conversion\b/i.test(text);
  const poundsAside = (converted ? String(text).replace(/£\s?[\d,]+(?:\.\d{2})?(?:\s*GBP)?|\b\d[\d.,]*\s*GBP\b|\bGBP\b/g, "") : String(text)).replace(/\(\s*£\s?[\d,]+(?:\.\d{2})?\s*\)/g, "").replace(/\bfrom\s*\|?\s*£\s?[\d,]+(?:\.\d{2})?/gi, "");
  // (Pounds named only in words, "rates are quoted in British pounds sterling", "Rate quotes in GBP are based on current
  // exchange rates", beside a total in dollars: no money in pounds was given. Round 15.)
  if (/£|\b\d[\d,.]*\s?GBP\b|\bGBP\s?\d/.test(poundsAside)) return null;
  const found = [];
  for (const m of text.matchAll(F_BEFORE)) found.push({ index: m.index, label: m[0], sign: m[1], amount: m[2] });
  for (const m of text.matchAll(F_AFTER)) found.push({ index: m.index, label: m[0], sign: m[2], amount: m[1] });
  found.sort((a, b) => a.index - b.index);
  // Not a "Sub Total", and not a total that says it leaves something out ("Total (excl. VAT)", "Total (before tax)").
  const notSub = found.filter((f) => !/sub[-\s]?$/i.test(text.slice(Math.max(0, f.index - 4), f.index)) && !/\((?:excl|ex\b|excluding|before|net\b|without)/i.test(f.label));
  const pick = notSub.find((f) => /^(?:grand\s+)?total\s+(?:including|incl\.?|inc\.?)\s/i.test(f.label) || /^grand\s/i.test(f.label)) || notSub[0];
  if (!pick) return null;
  const sign = pick.sign.toUpperCase();
  let currency = sign === "€" || sign === "EUR" ? "EUR" : sign === "US$" || sign === "US $" || sign === "USD" ? "USD" : sign === "CA$" || sign === "CAD" ? "CAD" : /^(AU?\$|AUD)$/.test(sign) ? "AUD" : /^(MX ?\$|MXN)$/.test(sign) ? "MXN" : sign === "PLN" || sign === "ZŁ" ? "PLN" : null;
  // A bare "$": only when the email names exactly one kind of dollar.
  if (!currency && sign === "$") { const named = DOLLARS.filter(([, re]) => re.test(text)).map(([c]) => c); if (named.length === 1) currency = named[0];
    // (A software company's card receipt through Stripe that names no kind of dollar, "Receipt from Eleven Labs Inc.",
    // "$60.00": Stripe writes every other dollar with its country, "CA$", "A$", so a bare "$" there is the US dollar. Round 11.)
    else if (!named.length && (opts.stripe || opts.gameDollar)) currency = "USD";
    // (A receipt that says it was bought in the United States, "Country United States, TX", with "$5.39": US dollars. Round 13.)
    else if (!named.length && /\bcountry\b[\s:|]{0,6}(?:united states(?: of america)?|usa)\b/i.test(text)) currency = "USD"; }
  const minor = foreignMinor(pick.amount);
  return currency && minor != null ? { currency, minor } : null;
}

function retailerFromFrom(fromHeader) {
  if (!fromHeader) return null;
  const name = fromHeader.match(/^\s*"?([^"<]+?)"?\s*</);
  const addr = fromHeader.match(/<?([^<>\s"']+@[^<>\s"']+)>?/);
  // (A quote straight after the address, as in `orders@tempur.com"`, is not part of it.)
  let domain = addr ? addr[1].split("@")[1].toLowerCase().replace(/[^a-z0-9.-]+$/, "") : null;
  // (Apple's Hide My Email: the shop's own address is written into the relay's, receipt-reader.js hiddenSenderDomain.)
  if (domain === "privaterelay.appleid.com") domain = hiddenSenderDomain(addr[1]) || domain;
  const generic = /^(orders?|noreply|no-reply|info|hello|customer.?service|team|support|shop|store|sales)\b/i;
  const display = name ? name[1].trim() : null;
  return {
    name: display && !generic.test(display) ? display : null,
    domain,
  };
}

// ---- Method 1: schema.org JSON-LD (Order / ParcelDelivery) -----------------
// Many retailers embed machine-readable order data for Gmail. When present it
// is far more reliable than reading prose.
function fromJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let data;
    try {
      data = JSON.parse(b[1].trim());
    } catch {
      continue;
    }
    const nodes = Array.isArray(data) ? data : [data];
    for (const node of nodes) {
      const order = node && (node["@type"] === "Order" ? node : node.orderNumber ? node : node.partOfOrder);
      if (!order || typeof order !== "object" || !order.orderNumber) continue;
      const items = (Array.isArray(order.acceptedOffer) ? order.acceptedOffer : [order.acceptedOffer])
        .filter(Boolean)
        .map((o) => ({
          name: o.itemOffered?.name ?? null,
          qty: Number(o.eligibleQuantity?.value ?? 1) || 1,
          pricePence: money(o.price),
        }))
        .filter((i) => i.name);
      return {
        method: "json_ld",
        retailerName: order.seller?.name ?? null,
        orderRef: String(order.orderNumber),
        orderDate: order.orderDate ? parseDate(String(order.orderDate).slice(0, 40)) : null,
        currency: order.priceCurrency || order.acceptedOffer?.[0]?.priceCurrency || null,
        totalPence: money(order.price),
        items,
      };
    }
  }
  return null;
}

// ---- Method 2: reading the text -------------------------------------------
const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

// A real calendar day as YYYY-MM-DD, or null ("2025-29-07" is not one).
function ymdOf(y, mo, d) {
  const t = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1990 && y <= 2100 && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
    ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
}
// "05/06/2025" is 5 June in the UK and 6 May in the US; "07/29/2025" can only be 29 July. When both readings are real
// days, the one nearest the email's own date (and not after it) wins, and day-first when that doesn't settle it.
function slashDate(a, b, y, refDate) {
  const uk = ymdOf(y, b, a), us = ymdOf(y, a, b);
  if (!uk || !us || uk === us) return uk || us;
  const ref = refDate instanceof Date && !Number.isNaN(refDate.getTime()) ? refDate.getTime() + 86400000 : null;
  if (ref == null) return uk;
  const gap = (v) => { const t = Date.parse(v + "T00:00:00Z"); return t > ref ? Infinity : ref - t; };
  // (A UK email writes the day first: "05/03/2026" a couple of days after it was sent is 5 March, a delivery day, never
  // 3 May. Month first only when the day-first reading is weeks after the email. Round 16.)
  const ukAfter = Date.parse(uk + "T00:00:00Z") - ref;
  if (ukAfter > 0 && ukAfter <= 21 * 86400000) return uk;
  return gap(us) < gap(uk) ? us : uk;
}

// The order's date. A date labelled as the order's ("Order date: 01/11/2026", "Placed on …") comes first, and a date after
// the email was sent (a pre-order's release date, a concert's day, a renewal's next date) is never the order's: the next
// date in the text is tried instead (round 3, 19 Nov 2026).
// (The date can sit a few table cells under its label, "Order Date" over "|", "|", "28/02/2026". Round 16.)
const ORDER_DATE_LABEL = /\b(?:order(?:ed)?|placed|purchase|booked|booking|transaction|invoice|receipt)[ \t]*(?:(?:date|on|made)?[ \t]*(?:\/\s*[\p{L} ]{2,20})?\s*[:|]|(?:date|made)[ \t]*(?=\n))\s*\|?\s*(?:\|\s*){0,6}([^\n]{6,40})/giu;
export function parseDate(text, refDate) {
  const t = String(text || "");
  const late = (v) => Boolean(v) && refDate instanceof Date && !Number.isNaN(refDate.getTime()) && new Date(v + "T00:00:00Z").getTime() > refDate.getTime() + 2 * 86400000;
  for (const m of t.slice(0, 20000).matchAll(ORDER_DATE_LABEL)) { const v = dateFound(m[1], refDate); if (v && !late(v)) return v; }
  // ("Ordered on 18 November 2026", "Placed on Wed 18 Nov 2026" with no colon: still the order's date, before a delivery
  // day written higher up. Round 8.)
  for (const m of t.slice(0, 20000).matchAll(/\b(?:ordered|placed|order placed)\s+on\s+([^\n|]{6,40})/gi)) { const v = dateFound(m[1], refDate); if (v && !late(v)) return v; }
  // (A date no label calls the order's, on a day after the email was sent, "Sat 31st Dec 2022 at 8:00pm" in a ticket email
  // sent on the 30th, is the event's or the delivery's, never the order's: the email's own day is. Round 15e.)
  const ok = refDate instanceof Date && !Number.isNaN(refDate.getTime());
  const sentDay = ok ? new Date(refDate.getTime() + 3 * 3600e3).toISOString().slice(0, 10) : null;
  const ahead = (v) => late(v) || (Boolean(v) && sentDay != null && v > sentDay);
  const v = dateFound(t, refDate);
  if (!ahead(v)) return v;
  for (const line of t.split("\n")) { const w = dateFound(line, refDate); if (w && !ahead(w)) return w; }
  return null;
}
function dateFound(text, refDate) {
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  if (m && ymdOf(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})\b/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    const v = mi >= 0 ? ymdOf(+m[3], mi + 1, +m[1]) : null;
    if (v) return v;
  }
  m = text.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    const v = mi >= 0 ? ymdOf(+m[3], mi + 1, +m[2]) : null;
    if (v) return v;
  }
  m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) { const v = slashDate(+m[1], +m[2], +m[3], refDate); if (v) return v; }
  // "Order Date: 27/05/24": a two-figure year only straight after a date label (sizes such as "8/10/12" are not dates).
  m = text.match(/\bdate\s*[:|]?\s*\|?\s*(\d{1,2})\/(\d{1,2})\/(\d{2})\b/i);
  if (m) { const v = slashDate(+m[1], +m[2], 2000 + +m[3], refDate); if (v) return v; }
  // "Placed on Fri 9 Oct": no year in the text, so take it from the email's own date.
  m = text.match(/\b(?:placed|ordered)\s+on\s+(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})/i);
  if (m && refDate instanceof Date && !Number.isNaN(refDate.getTime())) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) {
      let year = refDate.getUTCFullYear();
      if (new Date(Date.UTC(year, mi, Number(m[1]))) > new Date(refDate.getTime() + 86400000)) year -= 1;
      const v = ymdOf(year, mi + 1, +m[1]);
      if (v) return v;
    }
  }
  return null;
}

// "Total: £62.75" with "£35.51" on the line under it, and money taken off in the email ("50% OFF PIZZAS … £-27.24") that is
// the difference: the lower amount is what was paid (Domino's prints the total before its deal, then after). Round 10.
function afterDiscount(text, m) {
  if (m.index == null) return null;
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
  const next = /^[\s|]*\n[\s|]*£\s?(\d[\d,]*\.\d{2})[\s|]*(?:\n|$)/.exec(after);
  if (!next) return null;
  const was = money(m[1]), now = money(next[1]);
  if (!(now < was)) return null;
  const off = [...text.matchAll(/(?:[-−–]\s?£|£\s?[-−–])\s?(\d[\d,]*\.\d{2})/g)].map((x) => money(x[1]));
  if (off.some((o) => Math.abs(was - o - now) <= 1) || Math.abs(was - off.reduce((n, o) => n + o, 0) - now) <= 1) return now;
  // (Or the email shows old prices beside new ones elsewhere too, an item's "£8.99" next to its old "£14.99" with nothing
  // between: a copy of an email that struck its old prices through, the line through lost. The lower one is paid. Round 13.)
  const lone = /^[ \t|]*£ ?(\d[\d,]*\.\d{2})[ \t|]*\n(?:[ \t|]*\n){0,2}[ \t|]*£ ?(\d[\d,]*\.\d{2})[ \t|]*$/gm;
  const pairs = [...text.slice(0, m.index).matchAll(lone)].filter((x) => money(x[1]) !== money(x[2]));
  return pairs.length ? now : null;
}
function fromText(text, refDate, ctx = {}) {
  // Some plain-text parts write the pound sign as "L" ("L69.00" on its own line). Only whole lines that are just an amount are changed.
  text = text.replace(/^([ \t|]*)L\s?([0-9][0-9,]*\.[0-9]{2})[ \t|]*$/gm, "$1£$2");
  // Bold written the plain-text way ("| **Total** | **£500.00** |") reads as the words themselves.
  text = text.replace(/\*\*([^*\n]{1,80})\*\*/g, "$1");
  // Others write the currency after the amount ("5 GBP", "12.99 GBP"): read as "£5.00", "£12.99" (never "£0.00 GBP" twice).
  // ("11.2 GBP" too: round 11.)
  text = text.replace(/(?<![£\d.,])(?<!£ )(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?[ \t]?GBP\b/g, (m, n, p) => "£" + n + "." + String(p || "00").padEnd(2, "0"));
  const ref =
    // (Never a word: "Order Details" over a table is not order number "Details". A number has a digit, or is a code in
    // capitals ("QWERTZ"). Round 11.) (The number in the next cell, "Order number: | 851791895 |": round 15.)
    // (Or set in bold in a text part, "Order number: *55120378*". Round 15e.)
    [...text.matchAll(/\border\.?\s*(?:number|no\.?|id|ref(?:erence)?|#)\s*(?:is\s*)?[:#\s]*(?:\|[ \t]*)?\*{0,2}([A-Z0-9](?:[A-Z0-9-]|_(?=[A-Z0-9])){3,24})/gi)].find((m) => (/\d/.test(m[1]) || /^[A-Z]{5,10}$/.test(m[1])) && !(m[0].includes("|") && /[A-Z0-9-]/i.test(text[m.index + m[0].length] || ""))) ||
    // ("Order number |" with the number in the row under it, as an HTML email's table gives it. Round 10.) ("Your order
    // number is: |" over it too. Round 11.)
    text.match(/\border\s*(?:number|no\.?|id)\s*(?:is\s*)?:?[\s|]*\n[\s|]*#?((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,24})[\s|]*$/im) ||
    text.match(/\border\s*#\s*([A-Z0-9-]{3,24})/i) ||
    // ("ORDER: 51207B" on its line, "Order 7730041" alone on its line under the shop's name. Round 16.)
    text.match(/^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*order\s*:\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,24})[\s|]*$/im) ||
    text.match(/^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*order\s+#?(\d{4,12})[\s|]*$/im) ||
    // ("Order: # 202-1234567-7654321", Amazon's dispatch email. Round 16.)
    text.match(/\border\s*:\s*#\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,24})/i) ||
    // ("Order:" alone on its line, the number on the next: Homary. Round 11.)
    text.match(/^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*order\s*:[\s|]*\n[\s|]*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,30})[\s|]*$/im) ||
    // A booking's own number ("Confirmation # : 2110090879", "Booking reference: ABC123"), so its later emails match it.
    // (A booking reference of capitals only, "Your booking reference is: NTEFH", "Reservation summary for order AGQNAOQ". Round 15.)
    text.match(/\b(?:[Bb]ooking|[Rr]eservation) (?:[Rr]eference|[Cc]ode)(?: is)?\s*:?\s*([A-Z]{5,8})\b(?![a-z])/) ||
    text.match(/\b(?:[Ss]ummary|[Cc]onfirmation) for order\s+((?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,12})\b(?![a-z])/) ||
    // (Whole, never cut: "Your booking reference is 20220316-NZ194227806625361" as it is. Round 15.)
    text.match(/\b(?:confirmation|booking|reservation)\s*(?:number|no\.?|ref(?:erence)?|code|#)\s*(?:is\s*)?[:#\s]*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,34})(?![A-Z0-9-])/i) ||
    // ("Confirmation: 6943887618", a hotel booking's number with no word for "number": digits only. Round 12.)
    text.match(/\b(?:confirmation|booking|reservation)\s*:\s*\|?\s*(\d{6,14})\b/i) ||
    // A shop that sends an invoice instead of an order confirmation ("Invoice number: INV-2290"): its number is the order's
    // (round 7), so its later emails (dispatch, refund) can find it. Only with a digit in it ("Invoice No. attached" isn't one).
    // (A receipt's own number, "Receipt #2937-1380-5587" (Stripe's receipts, which name it in the subject too). Round 11.)
    text.match(/\breceipt\s*(?:number|no\.?|#)\s*[:#\s]*#?((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,24})\b/i) ||
    // (Also in the cell after it, "Invoice Number: |" over "0053-1725-3254 |". Round 15.)
    text.match(/\binvoice\s*(?:number|no\.?|ref(?:erence)?|#)\s*(?:is\s*)?[:#\s]*(?:\|[\s|]*)?((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,24})\b/i) ||
    // (A restaurant bill's own number, "check number" over "#7093" (or "Bill No: 7093"): the number its till prints. Round 15.)
    text.match(/\b(?:check|cheque|bill)\s*(?:number|no\.?|#)\s*:?[ \t|]*(?:\n[ \t|]*)?#?(\d{3,12})\b/i) ||
    // ("Ref: 419694" on a line of its own, a pub's order. Round 12.)
    text.match(/^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*ref(?:erence)?\s*:\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,24})[\s|]*$/im);

  // (A note in brackets and a column edge can sit between the word and the amount: "Total (including VAT): | £10.96".)
  // (Square brackets too, "Order total [Incl. VAT] | £247.77", and "Order total – Paid | £104.00". Round 15.)
  // "Sub Total" is the word "Total" too, so it is passed over while a real total follows, and a total that says it
  // includes delivery ("Total Including Delivery | £315.78") beats a plain one.
  const totals = [...text.matchAll(/\b(?:order\s+|grand\s+)?total(?:\s+(?:including|incl\.?|inc\.?)\s+(?:delivery|postage|shipping|vat|p&p))?(?:(?:\s+|\s*[-–]\s*)(?:paid|amount|charged|cost|price|to pay(?: in store)?|due|guide price|you(?:'|’)?ve paid|you paid|order value))?(?:\s+(?:by|with|on|using) (?:card|cash|[a-z]+ card|apple pay|google pay|paypal))?(?:\s*(?:\([^)\n]{1,40}(?:\n[ \t]{0,4})?\)|\[[^\]\n]{1,40}\])[ \t]*:?){0,2}\s*(?:[:|]\s*|[-–]\s+(?=£)){0,6}(?:\*{1,2}(?=£))?£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/gi)];
  // Not the items' own total ("Products total", "Goods total", "Items total"), and, when there is a subtotal, a total after it
  // (an email can print the total at the top too, or a "Total" for each line of its item list).
  const before = (m) => text.slice(Math.max(0, m.index - 14), m.index);
  // (Nor a total before VAT, "Total (exc. VAT): £12.50", when the email also gives the total with it: coverage round.)
  const notSub = totals.filter((m) => !/sub[-\s]?$/i.test(before(m)) && !/\b(?:items?|products?|goods|line|item\(s\)|basket|trolley|cart|bag)[ \t]*$/i.test(before(m)) &&
    // (Nor when the email's own plain total follows it: "Total (Excl. VAT) £50.00", "of which VAT £10.00", "Total £60.00". Round 16.)
    !(/^total\s*\((?:exc|excl|excluding|ex)\b/i.test(m[0]) && totals.some((o) => /^total\s*\((?:inc|incl|including)\b/i.test(o[0]) || (o.index > m.index && /^total\s*(?![\s(\[]*(?:exc|excl|excluding|ex|before|net)\b)[:|\s]*£/i.test(o[0])))) &&
    // (Nor a "net total" before VAT, when the bill's own total follows it: "net total £42.42", "v.a.t £8.48", "bill total
    // £50.90". Round 13.)
    !(/\bnet[ \t]*$/i.test(before(m)) && totals.some((o) => o.index > m.index)));
  const subAt = (/\bsub-?\s?total\b/i.exec(text) || {}).index;
  const afterSub = subAt == null ? [] : notSub.filter((m) => m.index > subAt);
  const pool = afterSub.length ? afterSub : notSub;
  const totalMatch =
    pool.find((m) => /^(?:grand\s+)?total\s+(?:including|incl\.?|inc\.?)\s/i.test(m[0]) || /^grand\s/i.test(m[0])) || pool[0] || totals[0] ||
    text.match(/\bamount\s+paid\s*(?:[:|]\s*){0,3}£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i) ||
    // A supermarket's order before it is picked gives a guide price, not a total ("Guide price | £27.69"). Round 8.
    text.match(/^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*(?:estimated |order )?guide price\s*(?:[:|]\s*){0,3}£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/im) ||
    // No total named: the last line that is only an amount "(Including VAT)" ("£33.76 (Including VAT)" under the delivery charge).
    [...text.matchAll(/^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*£\s*([0-9][0-9,]*\.[0-9]{2})\s*\((?:including|incl\.?|inc\.?)\s+vat\)[\s|]*$/gim)].pop() ||
    // A total written as a sentence: "Your order of 3 items comes to £120.00 including delivery" (round 4).
    text.match(/\b(?:your\s+)?(?:order|basket|total)\b[^.\n£]{0,40}\bcomes?\s+to\s+(?:a\s+total\s+of\s+)?£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i) ||
    // No total named, but what the card was charged after the subtotal and VAT ("Mastercard •••• 1234 (Apple Pay) | £10.99",
    // Apple's renewal receipts). Round 10.
    (/\bsub-?\s?total\b/i.test(text) && text.match(/^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*(?:visa|mastercard|master card|amex|american express|maestro|debit card|credit card|apple pay|google pay|paypal)\b[^\n£]{0,50}?(?:•{2,}|\*{2,}|x{3,}|ending(?: in)?)\s*\d{4}\b[^\n£]{0,30}?[\s|]*\n?[\s|]*£\s*([0-9][0-9,]*\.[0-9]{2})[\s|]*$/im)) ||
    // No total named, but the amount taken beside the card it was taken from ("MasterCard •••• 4242 (Apple Pay) | £10.99",
    // Apple's subscription invoices). Coverage round.
    text.match(/^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*(?:visa|mastercard|master card|amex|american express|maestro)\s*(?:[•·*.]\s?){2,}\s*\d{4}\b[^\n£]{0,30}(?:\n[\s|]*)?£\s*([0-9][0-9,]*\.[0-9]{2})[\s|]*$/im) ||
    // A payment receipt that names only the amount, "Amount: 11.2 GBP" (round 11).
    text.match(/^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*amount\s*:[\s|]*£\s*([0-9][0-9,]*\.[0-9]{2})[\s|]*$/im) ||
    // (Or what it cost, "Cost: £1.20 including 20% VAT and Service Charge", the one amount a parking app's receipt names, and
    // only when no other line names a total. Round 15e.)
    (/\btransaction (?:id|number|no\.?)\b/i.test(text) ? text.match(/^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*(?:cost|total cost|amount charged|charged)\s*:[ \t|]*£\s*([0-9][0-9,]*\.[0-9]{2})(?:[ \t]+(?:including|incl\.?|inc\.?)\b[^\n£]{0,60})?[\s|]*$/im) : null);

  // Line items: "Name ... Qty 1 ... £29.99" on one line or table row.
  const items = [];
  for (const line0 of text.split("\n")) {
    // (A line with no pounds in it can't be an item's; and runs of blank space are shortened first, so a line of 40,000
    // spaces is never searched again and again. Round 15.)
    if (!line0.includes("£")) continue;
    const line = line0.length > 300 ? line0.replace(/[ \t]{200,}/g, " ".repeat(100)) : line0;
    if (/total|subtotal|delivery|shipping|postage|discount|vat|tax|paid|service|fee|tip|offer/i.test(line)) continue;
    const m = line.match(/^\s*(?:(\d+)\s*[x×]\s*)?([A-Za-z][^|£\n]{2,80}?)\s*(?:\||-|–)?\s*(?:(?:qty|quantity)\s*[:x]?\s*(\d+)\s*(?:\||-|–)?\s*)?£\s*([0-9][0-9,]*\.[0-9]{2})\s*\|?\s*$/i);
    if (m) {
      items.push({
        name: m[2].trim().replace(/\s*\|\s*$/, ""),
        qty: Number(m[1] || m[3] || 1),
        pricePence: money(m[4]),
      });
    }
  }

  // A bulleted name, then its quantity, then its price, each on its own line ("* Linen Notebook / Quantity: 1 / £5.00").
  // The price is only kept for a quantity of 1 (it isn't said whether it's each or for all of them).
  if (!items.length) {
    for (const m of text.matchAll(/^[ \t]*[*•][ \t]+([^\n£]{3,120}?)[ \t]*\n[ \t]*(?:qty|quantity)[ \t]*:?[ \t]*(\d{1,3})[ \t]*\n[ \t]*£[ \t]*([0-9][0-9,]*\.[0-9]{2})[ \t]*$/gim)) {
      const qty = Number(m[2]);
      items.push({ name: m[1].trim(), qty, pricePence: qty === 1 ? money(m[3]) : null });
    }
  }

  // Layout used by delivery apps: "1 Item name" on one line, its price on the next.
  if (!items.length) {
    const rows = text.split("\n").map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < rows.length - 1; i++) {
      const head = rows[i].match(/^(\d{1,2})\s*[x×]?\s+(\p{L}[^£]{2,120})$/u);
      const price = rows[i + 1].match(/^£\s*([0-9][0-9,]*\.[0-9]{2})(?:\s*£\s*[0-9.]+)?$/);
      if (head && price && !/^[x×]\s/i.test(head[2]) && !/\s\/\s/.test(head[2]) && !/total|subtotal|delivery|service|discount|fee|tip|vat/i.test(head[2])) {
        // (How many on the line above, "1" over "20 Chicken McNuggets® Sharebox": the number is part of the name. Round 13.)
        const above = /^(\d{1,2})$/.exec(rows[i - 1] || "");
        if (above) { items.push({ name: rows[i].trim(), qty: Number(above[1]), pricePence: money(price[1]), lineTotal: true }); continue; }
        items.push({ name: head[2].trim(), qty: Number(head[1]), pricePence: money(price[1]), lineTotal: true });
      }
    }
  }
  if (!items.length) {
    const rows = text.split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
    for (let i = 2; i < rows.length - 1; i++) {
      const v = rows[i].match(/^(\d{1,2})\s*[x×]\s*\S+\s*\/\s*.{2,60}$/);
      if (!v) continue;
      const nameLines = [rows[i - 2], rows[i - 1]].filter((r) => r.length < 80 && !/^£|items|purchased|order|subtotal|total|^(?:shipping|shipped|dispatched|delivered|on its way|in this (?:shipment|parcel)|track)/i.test(r));
      let price = null;
      for (let j = i + 1; j < Math.min(rows.length, i + 4) && price == null; j++) {
        const pm = rows[j].match(/^£\s*([0-9][0-9,]*\.[0-9]{2})$/);
        if (pm) price = money(pm[1]);
      }
      const vm = rows[i].match(/\/\s*(.{2,60})$/);
      if (nameLines.length) items.push({ name: nameLines.join(" ").trim(), qty: Number(v[1]), pricePence: price, lineTotal: true, ...(vm ? { variant: vm[1].trim() } : {}) });
    }
  }
  // Shopify-style: "Product name × 1" on one line, maybe a size or colour under it, then its price.
  if (!items.length) {
    const rows = text.split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
    for (let i = 0; i < rows.length; i++) {
      const head = rows[i].match(/^([\p{L}\d][^£|]{1,100}?)\s*[×x]\s?(\d{1,2})$/u);
      if (!head || !/\p{L}{2}/u.test(head[1]) || /total|subtotal|delivery|shipping|discount/i.test(head[1])) continue;
      let price = null, variant = null;
      for (let j = i + 1; j < Math.min(rows.length, i + 4) && price == null; j++) {
        const pm = rows[j].match(/^£\s*([0-9][0-9,]*\.[0-9]{2})$/);
        if (pm) price = money(pm[1]);
        else if (!variant && rows[j].length <= 60 && !/[×]|£/.test(rows[j]) && /\//.test(rows[j])) variant = rows[j];
        else if (!variant && rows[j].length <= 40 && /^(size|colou?r|style)\b/i.test(rows[j])) variant = rows[j];
        else if (!variant && /^\d+(?:\.\d+)?\s?(?:ml|cl|l|g|kg|oz)$/i.test(rows[j])) variant = rows[j];   // "100ml"
      }
      if (price != null) items.push({ name: head[1].trim(), qty: Number(head[2]), pricePence: price, lineTotal: true, ...(variant ? { variant } : {}) });
    }
  }
  // (Lines that are only money words, such as "You've saved £30.89", are not items: they don't stop the table being read.)
  if (!cleanItems(items).length) items.splice(0, items.length, ...itemsFromCells(text));
  const sub = text.match(/\bsub-?\s?total(?:\s*\([^)\n]{1,40}\))?\s*(?:[:|]\s*){0,3}£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i);
  // Not in pounds: the total as it's written, in its own currency (never converted).
  const foreign = totalMatch ? null : foreignTotal(text, ctx);

  return {
    method: "text",
    subtotalPence: sub ? money(sub[1]) : null,
    retailerName: null,
    orderRef: ref ? ref[1] : null,
    orderDate: parseDate(text, refDate),
    currency: foreign ? foreign.currency : /£|GBP/.test(text) ? "GBP" : null,
    totalPence: totalMatch ? afterDiscount(text, totalMatch) ?? money(totalMatch[1]) : foreign ? foreign.minor : null,
    items,
  };
}


// ---- Return information ------------------------------------------------------
// Pulled from the same email. Everything stays null/empty when not found, and a
// deadline is only worked out when the email makes it unambiguous.
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

function isoDate(d) { return d.toISOString().slice(0, 10); }

function extractReturns(text, html, orderDate, other = "") {
  const out = {
    windowDays: null, windowFrom: null, deadline: null, address: null,
    portalUrl: null, instructions: [], qrMentioned: false, labelMentioned: false,
  };
  // (A text part sent "format=flowed" ends each wrapped line with a space: gone, so a sentence run back together has one space
  // between its words, "for 14 days after you make the purchase". Round 17.)
  const flat = text.replace(/[ \t]+/g, " ").replace(/ +$/gm, "");

  // Window: "within 28 days of delivery", "30-day returns", "return ... within 14 days".
  // (A text part wrapped at a fixed width, "you can return it within\ntwo hours for a full refund", is read as the sentences
  // it holds: a long line that stops mid-sentence runs on into the next. Round 13.) (Also before a capital, when the line
  // ends on a word no sentence ends with: "Cancellation and" / "Additional Charges) Regulations 2013". Round 15.)
  const unwrapped = flat.split("\n").reduce((acc, line, k, all) => acc + line + (k === all.length - 1 ? "" : line.length >= 50 && !/[.!?:|]\s*$/.test(line) && (/^[ \t]*[\p{Ll}\d(]/u.test(all[k + 1]) || (/\b(?:and|or|the|of|to|an?|with|for|in|on|by|from|your|our|their|at|as)[ \t]*$/i.test(line) && /^[ \t]*\p{L}/u.test(all[k + 1] || ""))) ? " " : "\n"), "");
  // (Not after "e.g." or "i.e." inside a sentence, "without giving a reason (e.g. if your goods are not wanted) within 14 days
  // starting from the day after the date of delivery": the window's sentence stays whole. Round 21.)
  const sentences = unwrapped.split(/(?<=[.!?])(?<!\b(?:e\.g|i\.e)\.)\s+|\n+/i).map((x) => x.trim()).filter(Boolean);
  // (A subscription: an app store's rule for returning an app within two hours is not for it, "This does not apply for
  // in-app purchases or in-app subscriptions".)
  const subscription = /\b(?:your subscription|subscription (?:from|renews|continues)|monthly subscription|yearly subscription|annual subscription)\b|£\s?\d+\.\d{2}\s*\/\s*(?:month|year|week)\b/i.test(flat.slice(0, 4000));
  const appRule = (x) => subscription && /\bwithin (?:two|2) hours\b|\bthis does not apply for in-app\b/i.test(x);
  // (A digital purchase's right to cancel, Apple's "To cancel your purchase within 14 days of receiving this invoice, report a
  // problem or contact us": its window, counted from the invoice, and marked a cancellation, not a parcel to send back. It
  // comes before a refund window for something narrower, "a full refund within 15 days of a monthly subscription upgrade". Round 13.)
  for (const sent of sentences) {
    const withdraw = sent.length <= 500 && /\bright (?:of|to) withdraw(?:al)?\b[^.]{0,100}?\bfor (\d{1,3}) days (?:after|from) (?:you make the purchase|(?:the )?(?:date of )?purchase)/i.exec(sent);
    if (withdraw) {
      out.windowDays = Number(withdraw[1]); out.windowFrom = "order"; out.cancelWithin = true;
      out.instructions.push(sent);
      const next = sentences.find((r) => r.length <= 300 && /\bcan cancel your subscription\b/i.test(r));
      if (next) out.instructions.push(next);
      break;
    }
    const cancelWin = sent.length <= 400 && /\bcancel\b[^.]{0,40}\b(?:purchase|order|subscription|contract)\b[^.]{0,20}\bwithin\s+(\d{1,3})\s+days?\s+(?:of|from|after)\s+(?:receiving\s+)?(?:this|the|your)\s+(invoice|receipt|purchase|order|email)/i.exec(sent);
    if (!cancelWin) continue;
    out.windowDays = Number(cancelWin[1]); out.windowFrom = "order"; out.cancelWithin = true;
    out.instructions.push(sent.replace(/\s+([.,;:!?])/g, "$1").replace(/:$/, "."));
    // (With it, what the email says about money back, "You may contact Apple for a full refund within 15 days of a monthly
    // subscription upgrade", word for word.)
    for (const r of sentences) if (out.instructions.length < 3 && r.length <= 300 && /\brefund\b[^.]{0,40}\bwithin\s+\d{1,3}\s+days?\b/i.test(r)) out.instructions.push(r.replace(/\s+([.,;:!?])/g, "$1"));
    break;
  }
  // (A booking that can be cancelled for a refund in its first hours, an airline's "you may cancel your flight booking and
  // claim a refund without penalty, up to 24 hours from when you made the original booking": that window, in hours, from when
  // it was booked, and the email's words. A cancellation, never a parcel to send back. Round 23.)
  if (!out.cancelWithin) for (const sent of sentences) {
    if (sent.length > 500) continue;
    const h = /\bcancel (?:your |the |this )?(?:flight |hotel |holiday )?(?:booking|order|reservation|purchase)\b[^.]{0,80}?\b(?:refund|without (?:penalty|charge))\b[^.]{0,60}?\b(?:up to|within)\s+(\d{1,3})\s+hours?\s+(?:from|of|after)\s+(?:when\s+)?(?:you\s+)?(?:made|make|placed|place|making|placing)?\s*(?:the|your)?\s*(?:original\s+)?(?:booking|order|purchase|reservation)\b/i.exec(sent);
    if (!h || Number(h[1]) < 1 || Number(h[1]) > 168) continue;
    out.windowHours = Number(h[1]); out.windowFrom = "order"; out.cancelWithin = true;
    out.instructions.push(sent.replace(/\s+([.,;:!?])/g, "$1"));
    break;
  }
  for (const sent of sentences) {
    if (out.cancelWithin) break;
    if (!/return|refund|exchange/i.test(sent) || sent.length > 400) continue;
    // (Not how soon money comes back, "hand it back to us and we'll send you a refund within 5 working days": that is no
    // window for returning anything. And "within 14 days starting from the day after the date of delivery" counts from
    // delivery. "Within 30-Day Of Delivery" too. Round 15.)
    // ("You have 28 days to return any unwanted items to us": the window, from no day it names. Round 22.)
    let m = sent.match(/within\s+(\d{1,3})(?:\s+|-)(?:calendar\s+|working\s+)?days?(?:\s+(?:starting\s+)?(?:of|from|after)\s+(?:the\s+)?(?:day\s+after\s+(?:the\s+)?(?:date\s+of\s+)?)?(delivery|receiv\w*|dispatch\w*|purchase|order\w*|today))?/i) ||
      sent.match(/(\d{1,3})[-\s]days?\s+(?:free\s+)?returns?/i) || sent.match(/\byou have\s+(\d{1,3})\s+days?\s+to\s+return\b/i);
    if (m && m.index != null && /\brefund(?:ed|s)?(?:\s+(?:to\s+)?(?:you|your\s+(?:card|account|original\s+payment(?:\s+method)?)))?\s*$/i.test(sent.slice(Math.max(0, m.index - 60), m.index))) continue;
    if (m) {
      out.windowDays = Number(m[1]);
      const basis = (m[2] || "").toLowerCase();
      out.windowFrom = /^(delivery|receiv|dispatch)/.test(basis) ? "delivery" : /^(purchase|order|today)/.test(basis) ? "order" : null;
      break;
    }
  }
  // (The shop's own statement of the right to cancel, Groupon's "You are legally entitled to cancel your order for any reason
  // within 14 days from the day on which you … acquire physical possession of the goods": that window, from delivery. Round 15.)
  if (!out.windowDays) {
    const law = /\b(?:entitled|right) to cancel (?:your order|the contract|this contract)\b[^.\n]{0,40}?\bwithin (\d{1,3}) days? (?:from|of|after) the day (?:on which )?you\b[^.\n]{0,80}?\b(?:possession|receive|delivered)/i.exec(flat.slice(0, 60000));
    if (law) { out.windowDays = Number(law[1]); out.windowFrom = "delivery"; }
  }
  // (The window's start said apart from it, "30-Day Return" then "Within 30-Day Of Delivery". Round 15.)
  if (out.windowDays && !out.windowFrom && !out.cancelWithin) {
    const b = new RegExp("\\bwithin\\s+" + out.windowDays + "[-\\s]+(?:calendar\\s+|working\\s+)?days?\\s+(?:of|from|after)\\s+(?:the\\s+)?(delivery|receiv\\w*|receipt|dispatch\\w*|purchase|order\\w*)", "i").exec(flat);
    if (b) out.windowFrom = /^(?:delivery|receiv|receipt|dispatch)/i.test(b[1]) ? "delivery" : "order";
  }
  // (The right to cancel an order of goods "within 14 days from receipt of the goods": the window, from delivery. Round 15.)
  if (!out.windowDays) {
    const rc = /\bright to cancel (?:your |the |this )?(?:order|contract|purchase)\s+within\s+(\d{1,3})\s+days?\s+(?:from|of|after)\s+(?:the\s+)?(?:receipt|delivery|receiving)\s+(?:of\s+)?(?:the\s+|your\s+)?(?:goods|items?|order|products?)\b/i.exec(flat.replace(/\s+/g, " "));
    if (rc) { out.windowDays = Number(rc[1]); out.windowFrom = "delivery"; const sent = sentences.find((x) => /\bright to cancel\b/i.test(x) && x.length <= 420); if (sent && !out.instructions.includes(sent)) out.instructions.unshift(sent); }
  }
  // (A seller's own policy, "I gladly accept returns, exchanges, and cancellations" "Just contact me within: 7 days of
  // delivery" "Ship returns back to me within: 30 days of delivery": the days to get in touch are the window that counts, over
  // a marketplace's line under the item, "Returns accepted within 14 days of delivery". Round 15.)
  const both = (flat.slice(0, 60000) + "\n" + String(other || "").slice(0, 60000)).replace(/[ \t\u00a0\u202f]+/g, " ");
  const contact = !out.cancelWithin && /\bcontact (?:me|us)(?: within)?[ \t]*:?[ \t]*(\d{1,3}) days? (?:of|from|after) (delivery|purchase|receiving)/i.exec(both);
  if (contact) {
    out.windowDays = Number(contact[1]); out.windowFrom = /^purchase/i.test(contact[2]) ? "order" : "delivery";
    out.instructions.unshift(("Contact the seller within " + contact[1] + " days of " + contact[2].toLowerCase() + " to return or exchange.").replace("of receiving", "of receiving it"));
    out.sellerPolicy = true;
  }
  // (What the seller says can't go back, "The following items can't be returned" "- Custom or personalized orders": kept, so
  // a personalised thing gets no return window. Round 15.)
  const cant = /\b(?:items?|following)[^.\n]{0,40}\bcan(?:'|’|no)?t be returned\b[\s\S]{0,300}?^[ \t]*[-•*][ \t]*(custom (?:or|and) personali[sz]ed (?:orders|items)|personali[sz]ed (?:orders|items))/im.exec(both);
  if (cant) out.excludes = ["personalised"];
  // Explicit date: "return by 14 November 2026".
  const byDate = flat.match(/return\w*[^.\n]{0,60}?\bby\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
  if (byDate) out.deadline = parseDate(byDate[1]);
  if (!out.deadline && out.windowDays && out.windowFrom === "order" && orderDate) {
    const d = new Date(orderDate + "T00:00:00Z");
    if (!Number.isNaN(d.getTime())) { d.setUTCDate(d.getUTCDate() + out.windowDays); out.deadline = isoDate(d); }
  }

  // Address: the few lines after a "return address" style label, accepted only if
  // they contain a UK postcode (so we never present half an address as complete).
  const lines = flat.split("\n").map((x) => x.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!/(return(?:s)? address|send (?:it |them |your (?:parcel|items?) )?back to|return(?:s)? to:|returns? centre)/i.test(lines[i])) continue;
    const after = lines[i].replace(/^.*?(?:return(?:s)? address|send (?:it |them |your (?:parcel|items?) )?back to|return(?:s)? to:|returns? centre)\s*[:\-–]?\s*/i, "");
    const block = [];
    if (after) block.push(after);
    for (let j = i + 1; j < lines.length && block.length < 6; j++) {
      if (!lines[j] || lines[j].length > 90) break;
      block.push(lines[j]);
    }
    const joined = swapPipes(block.join(", "), " ").replace(/,\s*,/g, ",");
    if (UK_POSTCODE.test(joined)) { out.address = joined.slice(0, 250); break; }
  }

  // Link to start a return: only https links whose text or address mentions returns.
  if (html) {
    // (An address written without quotes, <a href=https://…>, as some shops' emails do, is read too. Round 17.)
    for (const a of html.matchAll(/<a\b[^>]*href=(?:["']([^"']+)["']|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = (a[1] || a[2]).replace(/&amp;/g, "&").trim();
      const label = a[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!/^https:\/\//i.test(href) || href.length > 800) continue;
      if (/unsubscribe|privacy|terms/i.test(href + " " + label)) continue;
      if (/return|refund|exchange/i.test(label) || /\/returns?\b|returns?[-_.]|[?&]return/i.test(href)) { out.portalUrl = href; break; }
    }
    // (A digital purchase's way to cancel, the link in Apple's "To cancel your purchase within 14 days …, report a problem":
    // kept apart from a returns page, as where to ask. Round 21.)
    if (out.cancelWithin) for (const a of html.matchAll(/<a\b[^>]*href=(?:["']([^"']+)["']|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = (a[1] || a[2]).replace(/&amp;/g, "&").trim();
      const label = a[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (/^https:\/\//i.test(href) && href.length <= 800 && /^(?:report a problem|request a refund|cancel (?:your |this |the )?(?:purchase|order|subscription))$/i.test(label)) { out.cancelUrl = href; break; }
    }
  }

  // How-to wording straight from the email (max three short sentences).
  const seen = new Set();
  // (The sentences that give a window for sending things back come first, a longer one too: a supermarket's "the right to
  // return most goods … within 14 days starting from the day after the date of delivery" and its "30 day goodwill returns
  // policy … to any Sainsbury's store within 30 days" were left out for their length, while "You'll be refunded … within 3 to
  // 5 working days" was kept. Round 15.)
  const windowed = (x) => /\b(?:within\s+\d{1,3}\s+(?:calendar\s+)?days?\b(?!\s+of\s+(?:receiving\s+)?(?:your\s+)?refund)|\d{1,3}[-\s]days?\s+(?:\w+\s+){0,2}returns?\b)/i.test(x) && !/\bworking days?\b/i.test(x);
  const order = [...sentences.filter((x) => x.length <= 420 && /\breturn/i.test(x) && windowed(x)), ...sentences];
  for (const sent of order) {
    if (out.instructions.length >= 3) break;
    if (sent.length < 25 || sent.length > (windowed(sent) ? 420 : 220) || !/\breturn/i.test(sent) || appRule(sent)) continue;
    // (A journey's way back, "Return Thursday 20 August", "Return journey: 16:27", is not a return of something bought. Round 15.)
    if (/^\W*return\s+(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b|(?:trip|journey|ticket|leg|train|flight|fare|travel|departure|date)s?\b)/i.test(sent)) continue;
    if (/unsubscribe|view (this )?(email|in browser)/i.test(sent)) continue;
    // (Money given back on its own, a card hold "returned to you in full", is not how to send something back. Round 12.)
    if (/\b(?:amount|money|deposit|hold|funds?)\b[^.]{0,40}\breturned\b|\breturned to (?:you|your (?:card|account))\b/i.test(sent)) continue;
    const key = sent.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.instructions.push(sent); }
  }

  // (The seller's own days to get in touch, never a different window beside them. Round 15.)
  if (out.sellerPolicy) out.instructions = out.instructions.filter((x, k) => k === 0 || !/\bwithin\s+\d{1,3}\s+days?\b/i.test(x));
  // A QR code for a return. Not one to download the shop's app, a ticket's or an eSIM's code, or the letters "qr" inside
  // a tracking link's picture address (round 12: a hotel booking, a train ticket, a phone plan and a gift receipt were all
  // flagged "QR code" for that).
  const NOT_RETURN_QR = /\{[^}]*\bqr\b[^}]*\}|phone(?:'s)? camera|download|\bapp\b|app store|google play|e-?sim|activat|install|ticket|boarding|barcode|check[- ]?in|entry|admission|wallet|sign[- ]?in|log[- ]?in/i;
  const qrLines = String(flat).split(/(?<=[.!?])\s+|\n/).filter((l) => /\bqr\b/i.test(l));
  const qrImg = [...String(html || "").matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /\balt=["'][^"']*\bqr\b|\bsrc=["'][^"']*(?:\bqr[-_]?code|[\/_-]qr[\/_.-])/i.test(t));
  // (The sentence before counts too: "Your eSIM is ready to be installed and activated. To complete the process simply scan
  // the QR code below.")
  const allLines = String(flat).split(/(?<=[.!?])\s+|\n/);
  const qrCtx = allLines.map((l, k) => (/\bqr\b/i.test(l) ? [allLines[k - 1] || "", l].join(" ") : null)).filter(Boolean);
  out.qrMentioned = (qrLines.length && qrCtx.some((l) => !NOT_RETURN_QR.test(l))) || qrImg.some((t) => !NOT_RETURN_QR.test(t));
  out.labelMentioned = /(prepaid|printable|return)\s+label|drop[- ]?off|drop (?:it )?off|collect\+|evri|royal mail|inpost|dpd|ups access point/i.test(flat);
  // A booking that says it can't be refunded ("This booking is non-refundable"): no window or return steps are kept from
  // it, so Relay never offers a return the shop has ruled out. Round 12.
  // (So does a rail booking whose every ticket says "Specified train only. No refunds.": an Advance ticket. Round 15.)
  const fareLines = [...String(text || "").matchAll(/^[ \t|]*\d{1,2}x[ \t]+(?:advance|anytime|off-peak|super off-peak|flexi|standard|first)[^\n]{0,40}$/gim)];
  const allNoRefund = fareLines.length > 0 && fareLines.every((m) => /^(?:[^\n]*\n){0,2}?[^\n]*\bno refunds?\b/i.test(String(text).slice(m.index + m[0].length, m.index + m[0].length + 200)));
  // (And a ticket seller that "does not issue refunds after purchase". Round 15.)
  const ticketsNoRefund = /\b(?:does|do) not (?:issue|give|offer) refunds? after (?:the )?purchase\b/i.test(flat) && /\btickets?\b/i.test(flat);
  // (Only some of its tickets say so, "1x Advance Single" "Specified train only. No refunds." beside "1x Off-Peak Day Single":
  // the booking isn't non-refundable as a whole, but which ticket can't be refunded is said, in the email's words. Round 17.)
  if (fareLines.length > 1 && !allNoRefund) {
    const said = fareLines.map((m) => { const after = String(text).slice(m.index + m[0].length, m.index + m[0].length + 200); const n = /^\s*\n?[ \t|]*([^\n]{0,80}\bno refunds?\b[^\n]{0,40})/i.exec(after); return n ? m[0].replace(/^[ \t|]*\d{1,2}x[ \t]+/, "").trim() + ": " + n[1].replace(/[ \t|]+$/, "").trim() : null; }).filter(Boolean);
    if (said.length) out.instructions = [...said, ...out.instructions].slice(0, 3);
  }
  if (allNoRefund || ticketsNoRefund || (/\b(?:this|your)\s+(?:booking|reservation|rate|stay|room|ticket|order|purchase)\s+(?:is|are)\s+(?:non-?\s?refundable|not refundable)\b/i.test(flat) || /(?:^|[.!|\n]\s*|\b(?:all|your|the|these)\s+|\bnote(?:\s+that)?,?\s+)tickets\s+are\s+(?:non-?\s?refundable|not refundable)\b/i.test(flat))) {
    Object.assign(out, { windowDays: null, windowFrom: null, deadline: null, portalUrl: null, instructions: [], qrMentioned: false, labelMentioned: false, nonRefundable: true });
  }
  // A booking that can be cancelled for free until a day it names ("You can cancel for FREE until 6 June 2025 23:59",
  // "Free cancellation until 12 March 2026"): that day, as the booking says it. Round 13.
  if (!out.nonRefundable) {
    const fc = /\b(?:cancel(?:lation)?\s+(?:is\s+)?(?:for\s+)?free(?:\s+of\s+charge)?|free\s+cancell?ation)\s+(?:until|up to|before|by)\s+(?:\d{1,2}:\d{2}\s+(?:on\s+)?)?(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4})/i.exec(flat);
    const day = fc ? parseDate(fc[1]) : null;
    if (day) out.freeCancellationUntil = day;
  }
  const any = out.windowDays || out.windowHours || out.deadline || out.address || out.portalUrl || out.instructions.length || out.qrMentioned || out.labelMentioned || out.nonRefundable || out.freeCancellationUntil;
  return any ? out : null;
}

// An email that is not an order confirmation must not be turned into a purchase.
// Some of an order's items sent ("2 of your 3 items have shipped", "Part of your order HF-1 has been dispatched"): the items
// in it are the order's, so it is read like its receipt and joins the order's card by its order number (gmail.js
// mergeOrderEmails). Without an order number it would be a second card for the same order, so it is then not read at all.
const CARRIER_WORDS = "royal mail|parcelforce|evri|hermes|dpd|dhl|ups|yodel|inpost|fedex|our courier|the courier|our delivery partner";
const CARRIER_PROGRESS = new RegExp("\\b(?:order|parcel|package|delivery)\\b[^!?\\n]{0,30}\\b(?:is|has been) (?:now )?(?:with|handed (?:over )?to|collected by|received by) (?:" + CARRIER_WORDS + ")\\b|\\b(?:order|parcel|package)\\b[^!?\\n]{0,30}\\b(?:is out for delivery|has been delivered|was delivered)\\b", "i");
const SHIPMENT_SUBJECT = /\b\d{1,3} of (?:your )?\d{1,3} items?\b[^!?]{0,30}\b(?:have |has )?(?:shipped|dispatched|been sent|on (?:their|its) way)\b|\b(?:part|some) of your order\b[^!?]{0,40}\b(?:shipped|dispatched|sent|on its way)\b|\bsome of your items\b[^!?]{0,30}\b(?:shipped|dispatched|on (?:their|its) way)\b/i;
const PROGRESS_SUBJECT = /\b(?:we(?:'|’)?re|we are|we(?:'|’)?ve started|now) (?:working on|preparing|packing|processing|picking)\b[^!?\n]{0,40}\border\b|\b(?:order|tech|items?|parcel|package|purchase)\b[^!?\n]{0,30}\b(?:is|are|has been|have been) (?:being (?:prepared|packed|processed|picked)|(?:now )?ready (?:to|for) (?:collect\w*|pick(?:ing)?[- ]?up)|(?:dispatched|shipped|posted|sent out)|on (?:its|their) way|out for delivery|delivered)\b|\b(?:ready to collect|ready for collection|on (?:its|it(?:'|’)s|their) way|out for delivery|has (?:been )?(?:dispatched|shipped))\b|\breminder\b|\b(?:check[- ]?in (?:is )?(?:now )?open|time to check[- ]?in)\b/i;
// An invoice the email says is paid ("Thank you for your payment", "Amount paid £60.00", "Balance due £0.00"), and nothing in it
// asks for money still to come ("Amount due £160.80", "Please pay by …", "Due date: …"). Round 8.
function paidInvoice(text) {
  const t = String(text || "").slice(0, 8000).replace(/\b(?:balance|amount)\s+(?:due|outstanding|to pay)\s*[:|]?\s*\|?\s*£\s?0(?:\.00)?\b/gi, " ");
  // (An invoice "billed to" a card or wallet, or naming the card it was taken from by its last four digits, was paid when it
  // was sent: Apple's "Your invoice from Apple." puts "BILLED TO Visa .... 1234 (Apple Pay)" over the total, or
  // "MasterCard •••• 1234 (Apple Pay)" under "Billing and Payment", and never says "paid". Coverage round.)
  return (/\b(?:thank you for your payment|payment received|we(?:'|’)?ve received your payment|amount paid|total paid|paid in full|paid with|paid by|paid on)\b/i.test(t) ||
    /\b(?:billed|charged) to\b[\s:|]{0,6}(?:[^\n]{0,40}\n\s*)?(?:visa|mastercard|master card|amex|american express|maestro|debit card|credit card|apple\s?pay|google\s?pay|paypal)\b/i.test(t) ||
    /\b(?:visa|mastercard|master card|amex|american express|maestro)\s*(?:[•·*.]\s?){2,}\s*\d{4}\b/i.test(t)) &&
    !/\b(?:amount due|balance due|total due|payment due|due date|due by|due on|please pay|pay by|pay now|pay online|overdue|outstanding|payment terms|to be paid|awaiting payment)\b/i.test(t);
}
function receiptSignals(subject, text) {
  const s = `${subject || ""}`.toLowerCase();
  // ("Your Ted Baker order" and "Your Café Lumière receipt" count too: the shop's name between "your" and "order".)
  const subjectHit = /(order|receipt|purchase|thank you for your|payment)\b.*(confirm|receipt|received|thank)|confirmation|your receipt|order #|order no|\bthanks?\b.*\b(order|purchase)\b|\byour\b[^!?]{0,40}\b(?:order|e-?receipt|receipt)\s*\.?\s*$/.test(s) ||
    // "Your Friday evening trip with Uber", "Your Deliveroo order from Wagamama", "We're processing your order W123",
    // "Your Etsy Purchase from …", "Your purchase with lululemon", "Receipt for your payment to …", "Your LNER tickets for …".
    /\byour\b[^!?]{0,30}\b(?:trip|ride|order)\b[^!?]{0,20}\bwith\b|\byour\b[^!?]{0,30}\border from\b|\bprocessing your order\b|\byour\b[^!?]{0,30}\bpurchase (?:from|with|at)\b|\breceipt for your payment\b|\byour\b[^!?]{0,20}\btickets? for\b/.test(s) ||
    // "Your Sainsbury's order summary" (round 8).
    /\byour\b[^!?]{0,40}\border summary\b/.test(s) ||
    // (Round 22: a cinema's "Starlight Tickets for (SS) Moon Quest #KD4M2XQ", with its booking's code; "We're pleased to
    // confirm your VOLTA order (VLT…)"; an airline's "Your e-ticket receipt QPLM4R: …"; PayPal's "Receipt from Burger Barn
    // 4410227 for your £8.40 GBP purchase".)
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?[\p{L}][\p{L}&'’ ]{1,30} (?:e-?)?tickets? for\b[^!?\n]{1,80}#\s?(?=[a-z0-9]*\d)[a-z0-9]{5,12}\s*$/u.test(s) ||
    /\b(?:pleased|happy|delighted) to confirm your\b[^!?]{0,40}\b(?:order|booking|purchase)\b/.test(s) ||
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?your e-?ticket receipt\b/.test(s) ||
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?receipt from\b[^!?\n]{2,60}\bfor your\b[^!?\n]{0,30}\bpurchase\s*$/.test(s) ||
    // Stripe's "Your Capricorn Wealth Management Limited receipt [#1890-4978]" (round 15).
    /\byour\b[^!?\n]{0,60}\breceipt\s*\[#[\d-]{4,20}\]\s*$/.test(s) ||
    // "Thank You For Shopping At Tiffany & Co." with the order's details (round 15).
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?thanks?(?: you)? for shopping (?:at|with)\b/.test(s) ||
    // "Your subscription is ready to use" with what was charged for it (the Financial Times, round 15).
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?your subscription is (?:ready|confirmed|active)\b/.test(s) ||
    // "Confirmation of NEW Subscription!" (a creator subscription, round 15).
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?confirmation of (?:new )?subscription\b/.test(s) ||
    // An airline's "Booking details | Departure: 9 March 2022 | LHR-WDH" (Lufthansa, round 15).
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?booking details\s*\|\s*departure\b/.test(s) ||
    // An airline's "Ryanair Travel Itinerary" (its booking's receipt, round 15).
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?\p{L}[\p{L} ]{1,30} travel itinerary\s*$/u.test(s) ||
    // Ticket Tailor's "Order complete: Colour Ball 2025 - …" (round 15).
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?order complete\s*:/.test(s) ||
    // PayPal's "You've submitted an order in the amount of £25.00 GBP to …": an order paid through PayPal (round 15).
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?you(?:'|’)?ve submitted an order\b/.test(s) ||
    // "Your payment #39814759" (a bar's order-and-pay app), "Payment receipt for …" (round 11).
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?your payment\s+(?:no\.?\s*|number\s*)?#\s?\d{4,}\s*$|^\s*(?:(?:fwd?|fw)\s*:\s*)?payment receipt\b/.test(s) ||
    // "Order Info - DET-7vxlt1dlf1s", "NESPRESSO Club: Your order on www.nespresso.com" (round 11).
    /\border\b[^!?]{0,20}?\s[-–:#]\s*(?=[a-z0-9-]*\d)[a-z0-9-]{5,24}\s*$|\byour order (?:on|at|from) (?:www\.)?[a-z0-9-]+(?:\.[a-z]{2,7}){1,2}\s*$/.test(s) ||
    // "Your invoice from Brightwave Window Cleaning", "Invoice from …" that says it has been paid (round 8). Never an invoice
    // that is overdue, a reminder or still to pay: that is a bill, not a purchase (checked against the email below).
    (/^\s*(?:(?:fwd?|fw)\s*:\s*)?(?:your\s+)?(?:[\w&'’.-]+\s+){0,3}invoice\b/.test(s) && !/\b(?:overdue|reminder|due|unpaid|outstanding|final notice|statement|request|pay now|awaiting|proforma|pro-forma|quote|estimate)\b/.test(s) && paidInvoice(text)) ||
    // "Your order is on its way to the restaurant", "Your order has been sent to Golden Dragon" (a takeaway app). Round 8.
    /\byour order\b[^!?]{0,20}\b(?:on its way|been sent|gone|sent) to the (?:restaurant|kitchen|takeaway)\b/.test(s) ||
    // "Ordered: 'Wall Filler Kit…'", "Your 25 September receipt for 1 item", "Example.co.uk order of Chernobyl."
    // "Reservation confirmed for Manchester", "Your booking is confirmed at …", "Your … order PK-338812", "Your order … has been placed".
    /\b(?:reservation|booking|order|purchase)\b[^!?]{0,30}\bconfirmed\b|\byour\b[^!?]{0,40}\border\s+(?:no\.?\s*|number\s*)?#?(?=[a-z0-9-]*\d)[a-z0-9-]{4,24}\s*$|\border\b[^!?]{0,30}\b(?:has been|was|is) placed\b|(?:^|[!.:]\s+)order\s+(?:no\.?\s*|number\s*)?#?(?=[a-z0-9/-]*\d)[a-z0-9/-]{4,24}\s*$/.test(s) ||
    // "Order acknowledgement 30044112", "Your … subscription has renewed", "Receipt for your Notely Pro renewal", a
    // bilingual "Archeb / Order CR-1102" (round 3).
    // "Your Iceland delivery receipt 7711204" (round 3).
    /\b(?:delivery |order |e-?)?receipt\s+(?:no\.?\s*|number\s*)?#?(?=[a-z0-9-]*\d)[a-z0-9-]{4,24}\s*$|\border acknowledge?ment\b|\bsubscription\b[^!?]{0,30}\b(?:has )?renew(?:ed|al)\b|\breceipt for your\b|(?:^|\/\s*)order\s+(?:no\.?\s*|number\s*)?#?(?=[a-z0-9/-]*\d)[a-z0-9/-]{4,24}\s*$/.test(s) || SHIPMENT_SUBJECT.test(s) ||
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?ordered\s*:|\byour\b[^.!?]{0,40}\b(?:e-?receipt|receipt) (?:for|from)\b|^\s*(?:(?:fwd?|fw)\s*:\s*)?(?:your\s+)?(?:[\w.&'’-]{2,30}\s+){1,3}order of\b(?!.*\b(?:dispatched|shipped|on its way|out for delivery|delivered|cancell?ed)\b)/.test(s) ||
    // "Your tickets: The Winter's Tale, booking RT-55101", "Invoice INV-2290 for window cleaning" (round 6): a booking or an
    // invoice named by its number. (The body must still show a total, below.)
    /\btickets?\b[^!?]{0,60}\bbooking\s+(?:ref(?:erence)?\s*|no\.?\s*|number\s*)?#?(?=[a-z0-9-]*\d)[a-z0-9-]{4,24}\b/.test(s) ||
    // (An invoice named by its number is a purchase only when the email isn't asking for the money: a shop's "Invoice #2207"
    // that says "Payment of £15.00 is due" and "Pay now" is a request to pay, not a receipt. Coverage round.)
    (/^\s*(?:(?:fwd?|fw)\s*:\s*)?(?:your\s+)?invoice\s+(?:no\.?\s*|number\s*)?#?(?=[a-z0-9-]*\d)[a-z0-9-]{3,24}\b(?![^!?]*\b(?:overdue|reminder|due|unpaid|outstanding)\b)/.test(s) &&
      !/\b(?:payment of\s+[£€$]\s?[\d,.]+\s+is due|is due (?:on|by)|amount due|balance due|pay now|please pay|awaiting payment)\b/i.test(String(text || "").slice(0, 8000))) ||
    // Coverage round (emails in a real inbox that were never read as purchases): "Thank you for buying Gold membership",
    // "Thank you for joining Ana's fan club membership", "We've received your payment and your order is under processing",
    // "Your digital railcard purchase is complete".
    /\bthank(?:s| you) for (?:buying|purchasing)\b|\bthank(?:s| you) for joining\b[^!?]{0,60}\b(?:membership|subscription)\b|\breceived your payment\b[^!?]{0,40}\byour order\b|\bpurchase\s+(?:is|was|has been)\s+(?:complete|completed|successful)\b/.test(s) ||
    // Round 13: "Los Pollos Bravos has your order!" (a takeaway app's order), "Your bill has been paid: #14541694" (a pub's
    // order-and-pay app), "wagamama receipt" (a shop's name and "receipt"), "APPROVED: Payment transaction for your order
    // M589966 … at Embassy of Nepal" (a card payment page's receipt). The body must still show a total, below.
    // (Round 15: "CeX receipt :19593646", a shop's receipt by its number; "Your reservations have been made", a coach
    // ticket's reservation.)
    /\breceipt\s*[:#]\s*#?\d{4,}\s*$|\breservations? (?:have|has) been (?:made|confirmed)\b/.test(s) ||
    // (Round 15e: "Your order for Warmer People & Chevry Agency: …", a ticket seller's order named by its event.)
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?your order for\b/.test(s) ||
    // (Round 15e: "Your booking with Frost Fair Leeds! - 5520193", a booking named by its number.)
    /\byour booking (?:with|at|for)\b[^?]{0,60}?\s[-–:#]\s*#?\d{5,12}\s*$/.test(s) ||
    // (Round 20: "Your purchase of Game Club Plus has been processed", a shop's till receipt sent on, "Receipt from
    // your recent purchase".)
    /\byour purchase of\b[^!?]{2,80}\bhas been (?:processed|completed|confirmed)\b|^\s*(?:(?:fwd?|fw)\s*:\s*)?(?:your )?receipts? from your (?:recent )?(?:purchase|visit|order)\b/.test(s) ||
    /\bhas (?:got )?your order\b|\byour order(?:'|’)?s (?:in the kitchen|being prepared|being made)\b|\byour bill (?:has been|was|is) paid\b|\bpayment transaction for your order\b|^\s*(?:(?:fwd?|fw)\s*:\s*)?[\w&'’.-]+(?:\s+[\w&'’.-]+){0,2}\s+(?:e-?)?receipt\s*$/.test(s);
  // (A total in euros counts as a total: the receipt is kept with its amount in euros, never turned into pounds.)
  // ("Amount paid | £20.62" with no word "total" counts too: coverage round.)
  // (A total in dollars counts too, "Total | $60.00": round 11.)
  const bodyHit = /\bwe(?:'|’)?ve charged (?:GBP ?|£ ?)\d{1,5}\.\d{2}\b|\btotal payment to seller\b[ \t|:]{0,20}(?:\n[ \t|]{0,20}){0,3}£\s?\d|^[ \t|]*cost\s*:[ \t|]*(?:£ ?\d{1,5}\.\d{2}|\d{1,5}\.\d{2} ?GBP\b)|^[ \t|]*trial charge\s*:[ \t|]*(?:GBP|£)\s?\d|\bsubscribed for (?:US ?\$|\$|£|€)\s?\d{1,4}\.\d{2}\b|\btotal price for all passengers\b[\s|:]{0,20}(?:GBP|EUR|£|€)\s?\d|\btotal paid via\b[^\n]{0,40}(?:\n[^\n]{0,40}){0,10}?\s(?:£\s?\d[\d,]{0,9}\.\d{2}|\d[\d,]{0,9}\.\d{2}\s?(?:GBP|EUR|USD)\b)|\byour payment of £\s?\d[\d,]{0,9}(?:\.\d{2})? has been (?:successfully )?(?:processed|received|taken)\b|\border\s*(number|no|id|ref|#)|\btotal (?:order )?(?:value|amount|cost)\s*:?[\s|]{0,20}£\s?\d|\btotal\b[ \t|:]{0,40}(?:[£€]|US ?\$|\$\s?\d)|\btotal\b(?:\s*\([^)\n]{1,40}(?:\n[ \t]{0,4})?\))?[\s\S]{0,12}(?:[£€]|\$\s?\d)|^[^£€\n\r\u2028\u2029]*[£€].*\btotal\b|\bamount\s+paid\b[\s|:]{0,20}(?:[£€]|\$\s?\d)|^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*(?:amount|total paid)\s*:[\s|]*£\s?\d/im.test(text);
  // (A restaurant's order email whose subject says nothing about it, "We're on it!": the email itself opens with "Thanks for
  // your order" and names the order, "order #500dc2". Round 15.)
  const top = String(text || "").slice(0, 2500);
  // (Or in brackets, "Your Order (#9C41AB77E0D2):", a ticket seller's order under "Thank you for your order from …". Round 15e.)
  const bodyOrder = (/\bthanks? (?:you )?for your order\b/i.test(top) && /\border\s*(?:\(\s*)?#\s?[a-z0-9]{4,12}\b/i.test(top)) ||
    // (Or "We've got your order" over "Order Number:" and its number, under a subject that says nothing, "It’s in the bag".
    // Round 21.)
    (/\bwe(?:'|’)?ve (?:got|received) your order\b|\bwe have (?:got|received) your order\b/i.test(top) && /^[ \t|]*order (?:number|no\.?)[ \t]*:?[ \t|]*(?:\n[ \t|]*){0,3}[A-Z]{0,4}\d{5,16}[ \t|]*$/im.test(top)) ||
    // (Or it says the booking is confirmed and gives its reference, "Your booking at Strikeworld Leeds is confirmed" and
    // "Reservation ID: 551204", under a subject that says nothing, "You're in the game!". Round 15e.)
    (/\byour (?:booking|reservation)\b[^.!?\n]{0,60}\b(?:is|has been) confirmed\b/i.test(top) && /\b(?:reservation|booking|transaction) (?:id|reference|ref\.?|number|no\.?)\s*:/i.test(String(text || "").slice(0, 6000)));
  // (A booking's line "4 x Throw a pot like a pro @ £40.00": what was bought and its price, with no total. Round 15.)
  const atPrice = /^[ \t|]*\d{1,3}\s*x\s+[^\n@£|]{2,80}@\s*£\s?\d/m.test(String(text || "").slice(0, 20000));
  // (A receipt whose one amount is labelled what it cost, "Cost: £1.20 including 20% VAT and Service Charge", a parking
  // app's receipt under its "Transaction ID". Round 15e.)
  const costLine = /^[ \t|]*(?:cost|total cost|amount charged|charged)\s*:[ \t|]*£\s?\d/im.test(String(text || "").slice(0, 20000)) && /\btransaction (?:id|number|no\.?)\b/i.test(String(text || "").slice(0, 20000));
  // (A booking thanked for under a subject that names it by its number, its one price set out with how many, "×1" over
  // "£50.00", and no total line. Round 15e.)
  const bookedPrice = /\bthank(?:s| you) for your booking\b/i.test(top) && /\byour booking\b[^?\n]{0,80}\s[-–:#]\s*#?\d{5,12}\s*$/i.test(String(subject || "")) && /^[ \t|]*[x×]\s?\d{1,2}[ \t|]*\n[\s|]*£\s?\d[\d,]*\.\d{2}[ \t|]*$/m.test(String(text || "").slice(0, 20000));
  // (A purchase confirmed in so many words under a subject that only names it, "Plan Purchase - Terminal 2": "Here's a
  // quick email to confirm your purchase.", "Cost: 4.00 GBP". Round 20.)
  const confirmsPurchase = /\b(?:email|message) to confirm your purchase\b|\bthis (?:email|message) confirms your purchase\b/i.test(top) && /^[ \t|]*cost\s*:[ \t|]*(?:£ ?)?\d{1,5}\.\d{2}\b/im.test(String(text || "").slice(0, 6000));
  // (In Spanish, "Gracias por su compra" over "Orden: AB12345CD" (or "Pedido"), under a subject that asks to check "los
  // datos de su compra" and gives "N.° de pedido": a purchase confirmed, the same as in English. Round 23.)
  const spanish = /\bgracias por su (?:compra|pedido)\b/i.test(top) && /(?:^|[\s|])(?:orden|pedido|n\.?\s?[°º]\s?de pedido|n[úu]mero de pedido)\s*:\s*(?=[A-Z0-9-]*\d)[A-Z0-9-]{5,24}\b/im.test(top + "\n" + String(subject || ""));
  return { subjectHit: subjectHit || bodyOrder || confirmsPurchase || spanish, bodyHit: bodyHit || atPrice || costLine || bookedPrice };
}
function looksLikeReceipt(subject, text) {
  const { subjectHit, bodyHit } = receiptSignals(subject, text);
  return subjectHit && bodyHit;
}

// Marketing and loyalty emails that merely look like receipts ("You've saved £4 with Nectar", "20% off", "rate your order").
// Promotions have their own place in Relay, so these are not receipts. An email that carries an order number is never treated as a promotion.
// ("Grand Theft Auto VI: order now", "you've got until 16th December to place your pre-order": asking for an order. Round 11.)
const ADVERT_TOP = /\b(?:order now|shop now|join now|book now|browse (?:restaurants|shops|stores|deals|a wide selection|the menu)|discover (?:a new favourite|new (?:restaurants|favourites))|new on (?:deliveroo|uber eats|just eat)|come back and\b|order again to\b|fill your (?:cart|basket) with\b|sign up for an?\b[^.]{0,30}\bmembership|schedule another delivery)\b/i;
const PLACED_TOP = /\b(?:thanks? (?:you )?for (?:your |the )?(?:order|purchase|booking)|order (?:number|no\.?|#|id|ref(?:erence)?)\b|your receipt\b|receipt for\b|order (?:is )?confirmed|has been (?:confirmed|placed|dispatched|delivered)|we(?:'|’)ve received your order|you (?:paid|ordered|bought))/i;
const SURVEY_TOP = /\b(?:tell us (?:about|how) (?:your|you found your) (?:last |latest |recent )?(?:order|visit|experience|delivery|stay)|(?:start|take|complete|do) (?:the|our|a|this|a quick|a short|our quick|our short) (?:quick |short )?survey|feedback survey|customer satisfaction survey|rate your (?:last |latest |recent )?(?:order|visit|delivery)|how was your (?:last |latest |recent )?(?:order|visit|delivery)\b)/i;
const PROMO_SUBJECT = /\b(order now|pre-?order|place your (?:pre-?)?order|buy now|book now|shop now|you(?:'|’)?ve saved|you saved|\d{1,3}\s?% off|up to \d{1,3}\s?%|sale\b|offers?\b|deals?\b|win\b|rewards?|earn(?:ed)? (?:\d+ )?points|your points|nectar|clubcard|new in\b|back in stock|just for you|don'?t miss|last chance|exclusive|voucher|refer a friend|rate your|how did we do|leave a review|review your|survey|newsletter|wishlist|abandoned|still thinking)\b/i;
const STRONG_PROMO_SUBJECT = /^\W*order now\b|\bwin your (?:order|basket|purchase)\b|\bstill time to (?:pre-?)?order\b|\b(?:pre-?)?order (?:now|today|yours|in time) (?:for|before|to)\b/i;
const ORDERISH_SUBJECT = /\b(order (?:confirmation|confirmed|received|number|summary)|your order|your receipt|receipt for|thanks? for your (?:order|purchase)|invoice|payment received)\b/i;
// Money off the next order ("Up to £7 off your next order", "Save £5 on your first shop").
const MONEY_OFF_SUBJECT = /(?:^|[\s(])(?:up to |save |get )?£\s?\d{1,4}(?:\.\d{2})?\s+off\b|\boff your (?:next|first)\b|(?:^|\s)save £\s?\d/i;
// A code or credit to spend next time is an offer even when it names the order that earned it
// ("Here's your promotional credit from your recent order").
const PROMO_CREDIT_SUBJECT = /\b(?:promo(?:tional)?|discount) (?:code|credit)s?\b|\bhere(?:'|’)?s your (?:promo|promotional|discount|voucher|reward)\b|\b\d[\d,]*\s+bonus\s+(?:avios|points|miles)\b/i;
export function looksPromotional(subject, headers, hasOrderRef) {
  const sub = String(subject || "");
  // (An advert that tells the shopper to order, "Order now for Father's Day delivery!", "there's still time to pre-order your
  // … Food to order", "Shop 25% off today to WIN your order": never a purchase, whatever order-like words or numbers it has.
  // Round 14.)
  if (STRONG_PROMO_SUBJECT.test(sub)) return true;
  if (ORDERISH_SUBJECT.test(sub)) return false;
  // (Nor a promotion sent from a shop's newsletter address, "news@", "newsletter@", "offers@". Round 14.)
  const fromAddr = ((String((headers && headers.from) || "").match(/<([^>]+)>/) || [])[1] || String((headers && headers.from) || "")).trim();
  if (/^(?:news|newsletters?|marketing|promo(?:tions?)?|offers|deals|specialoffers)@/i.test(fromAddr) && (PROMO_SUBJECT.test(sub) || MONEY_OFF_SUBJECT.test(sub))) return true;
  if (PROMO_CREDIT_SUBJECT.test(sub)) return true;
  if (hasOrderRef) return false;
  if (PROMO_SUBJECT.test(sub) || MONEY_OFF_SUBJECT.test(sub)) return true;
  return /^(bulk|list)$/i.test(String((headers && headers.precedence) || "").trim());
}

// Apple App Store / Apple services receipts put each purchase on separate lines above its price:
// the app ("Royal Match"), then what was bought ("5,000 Coins"), then a link line ("Report a Problem"), then "£1.59".
// Nothing here is guessed from other shops' emails: it only runs for Apple's own receipts.
const APPLE_SECTION = /^(app store|apple services|itunes store|apple books|apple arcade|apple tv|apple music|apple one|icloud)$/i;
const APPLE_NOISE = /report a problem|write a review|in-app purchase|^(iphone|ipad|ipod|ipod touch|mac|apple watch|apple vision pro|apple tv)(\s?\w+)?$|^renews\b|^(monthly|yearly|annual|weekly|1 month|1 year|7 days)\b|^device\b|^family sharing|^purchased by|^cancel|^manage|^subscription|^\(|^free trial/i;
const APPLE_LABEL = /^(order id|document(?: no\.?)?|invoice date|date|apple (?:account|id)|billed to|billing|sequence|payment|paid with|receipt|tax invoice)\b|:\s*$|@|^\d{1,2} [a-z]{3,9} \d{4}$|^[A-Z0-9]{8,14}$/i;
// A money line read as an item ("Invoice total", "Order total", "Amount due"): never something bought (round 4).
// (Round 12: "Today's total", "Your total".)
const MONEY_LABEL = /^(?:(?:invoice|order|grand|basket|bag|payment|final|overall|today(?:'|’)?s|your)\s+total|total\s+(?:paid|due|amount|to pay|charged)|amount\s+(?:due|paid|payable|charged)|balance\s+(?:due|paid))\s*:?$/i;
const PRICE_WORDS = /^(?:(?:gbp|usd|eur|aud|cad|chf|sek|nok|dkk)|(?:promotions?|offers?|discounts?|vouchers?|coupons?|savings?)\s+applied|you\s+saved?|you\s+save|saved?|savings?|was|now|rrp|price|item\s+price|unit\s+price|special\s+price|sale\s+price|discount|reduced|deposit|balance|amount|paid)\b[\s:.!]*$/i;
// Amazon's order emails put each thing bought in its own little boxes, so the usual line reading finds nothing. Two layouts:
//  * things to be delivered: the item's name (Amazon cuts long ones short with "..."), "Sold by …", maybe "Colour: …" and
//    "Size: …", "Condition: New", "Quantity: 2", then the price split into "£", "4" and "99" (pounds big, pence small);
//  * digital (Prime Video, Kindle, music): the title, "Sold by:" (or "Sold by :"), the seller, then "£3.49".
// Read from the HTML split at every tag, so each little box is its own line. Nothing is guessed: a price is kept only when
// Amazon printed one next to the item.
const AMZ_SKIP = /^(sold by\b|fulfill?ed by\b|condition:|gift (?:wrap|message|note|receipt):|quantity:|qty:|colou?r:|size:|style:|pattern:|edition:|format:|view or edit order|order #|placed on|order details|ordered|dispatched|out for delivery|delivered|£|total|item subtotal|\|)/i;
function amazonRows(html) {
  // (Every named character, "v&iacute;voactive" as "vívoactive", Round 15; quotes kept plain as before.)
  const decode = (t) => decodeEntities(t.replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"'));
  return String(html || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").split(/<[^>]+>/)
    .map((t) => decode(t).replace(/[\u034f\u200b-\u200f\u00ad\u2060\ufeff\u202a-\u202e]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
}
export function amazonItems(html, given) {
  const rows = given || amazonRows(html);
  const priceAt = (i) => {   // "£" "4" "99", or "£4.99", starting at row i
    const one = /^£\s?(\d{1,5}(?:,\d{3})*)\.(\d{2})$/.exec(rows[i] || "");
    if (one) return Number(one[1].replace(/,/g, "")) * 100 + Number(one[2]);
    if (rows[i] === "£" && /^\d{1,5}$/.test(rows[i + 1] || "") && /^\d{2}$/.test(rows[i + 2] || "")) return Number(rows[i + 1]) * 100 + Number(rows[i + 2]);
    return null;
  };
  const tidy = (n) => n.replace(/\s*(\.\.\.|…)$/, "").trim();
  // (A title Amazon cut short, "Wireless Earbuds, Bluetooth 5.4 E...": marked, so the whole title can be taken from the
  // email's text part. Round 13.)
  const cut = (n) => /(\.\.\.|…)$/.test(n) ? { cut: true } : {};
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const q = /^(?:Quantity|Qty):\s*(\d{1,3})$/i.exec(rows[i]);
    if (q) {
      let name = null, author = null; const bits = [];
      for (let j = i - 1; j >= Math.max(0, i - 7); j--) {
        const b = /^(colou?r|size|style):\s*(.{1,40})$/i.exec(rows[j]);
        if (b) { bits.unshift(b[2]); continue; }
        if (AMZ_SKIP.test(rows[j]) || /^amazon(\.co\.uk)?$/i.test(rows[j]) || /^Sold by\s*:?$/i.test(rows[j - 1] || "") || (/^:$/.test(rows[j - 1] || "") && /^Sold by$/i.test(rows[j - 2] || "")) || /^[:|]$/.test(rows[j])) continue;   // the seller, under "Sold by:"
        if (rows[j].length >= 3 && rows[j].length <= 220 && !/^£|^\d+$/.test(rows[j])) {
          name = rows[j];
          // (A book's author on the row under its title and over "Condition: New", "Genki 1: An Integrated..." over "Eri
          // Banno": the title is the row above, and the book is named as Amazon's text part names it, "Title of Author". Round 15.)
          const over = rows[j - 1] || "";
          if (j > 0 && over.length >= 20 && over.length <= 220 && !AMZ_SKIP.test(over) && !/^view (?:or edit )?order/i.test(over) && !/^£|^\d+$/.test(over) &&
              name.length <= 40 && !/(?:\.\.\.|…)$/.test(name) &&
              ((/^\p{Lu}[\p{L}.'’-]{0,20}(?: \p{Lu}[\p{L}.'’-]{0,20}){1,3}$/u.test(name) && /^condition\s*:/i.test(rows[j + 1] || "")) ||
               // (Or written surname first, "Lane, Robin", over "Sold by: …": an author, never a thing's name. Round 21.)
               (/^\p{Lu}[\p{L}'’-]{1,24}, \p{Lu}[\p{L}.'’-]{0,20}(?: \p{Lu}[\p{L}.'’-]{0,20}){0,2}$/u.test(name) && /^(?:condition\s*:|sold by\b)/i.test(rows[j + 1] || "")))) { author = name; name = over; }
          break;
        }
      }
      if (!name) continue;
      let price = null;
      for (let k = i + 1; k <= i + 3 && price == null; k++) price = priceAt(k);
      items.push({ name: tidy(name), ...cut(name), ...(author ? { author } : {}), ...(bits.length ? { variant: bits.join(", ") } : {}), qty: Number(q[1]), pricePence: price });
      continue;
    }
    if (/^Sold by\s*:?(?:\s+\S.{0,60})?$/i.test(rows[i]) && !rows.slice(i + 1, i + 8).some((t) => /^(?:Quantity|Qty):/i.test(t))) {   // digital: title, "Sold by:", seller, price
      // (An older layout puts "Condition: New" between the title and "Sold by:": the title is above it. Round 13.)
      let at = i - 1; const bits = [];
      while (at > 0 && at >= i - 4 && /^(condition|colou?r|size|style|pattern|edition|format):\s*\S/i.test(rows[at] || "")) { const b = /^(colou?r|size|style):\s*(.{1,40})$/i.exec(rows[at]); if (b) bits.unshift(b[2]); at--; }
      let name = rows[at];
      if (!name || AMZ_SKIP.test(name) || name.length > 220) continue;
      // (The older layout's "3 x" on the row over the title, or before it on the same row: that many, at the price shown
      // for one, "3 x Face Cream" "Sold by: …" "£2.30" in an order of £6.90. Round 15.)
      let qty = 1;
      const qOn = /^(\d{1,3})\s?[x×]\s+(\S.{2,})$/.exec(name), qOver = at > 0 ? /^(\d{1,3})\s?[x×]$/.exec(rows[at - 1] || "") : null;
      if (qOn) { qty = Number(qOn[1]); name = qOn[2]; } else if (qOver) { qty = Number(qOver[1]); at--; }
      if (!(qty >= 1)) qty = 1;
      let price = null;
      // (A video's "Review this item" and "Original Air Date:" over the day it first aired sit before its price. Round 13.)
      let reach = i + 3;
      for (let k = i + 1; k <= i + 4 && /^(?:review this item|original air date:?|release date:?|\p{L}{3,9}\.? \d{1,2},? \d{4})$/iu.test(rows[k] || ""); k++) reach++;
      // (And the older layout's "Fulfilled by Amazon" and "Gift wrap: No" under the seller, before the price. Round 17.)
      for (let k = i + 1; k <= i + 5; k++) if (/^(?:fulfill?ed by\b|gift (?:wrap|message|note|receipt)\s*:)/i.test(rows[k] || "")) reach++;
      for (let k = i + 1; k <= reach && price == null; k++) price = priceAt(k);
      items.push({ name: tidy(name), ...cut(name), ...(at > 0 && !qOver ? { above: rows[at - 1] } : {}), ...(bits.length ? { variant: bits.join(", ") } : {}), qty, pricePence: price });
    }
  }
  return given ? items : items.map(({ above, cut, author, ...i }) => (author && !i.name.endsWith(" of " + author) ? { ...i, name: i.name + " of " + author } : i));
}

// A marketplace's item block (Etsy's HTML): the thing's name over "Transaction ID: 3521722269", its options ("Colour: Pink"),
// "Quantity: 1" and "Price:" over "£ 7.95" (the price of one). Round 15.
function transactionBlockItems(text) {
  const lines = String(text || "").split("\n").map((l) => l.replace(/\|/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4000);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!/^Transaction ID:\s*\d{5,15}$/i.test(lines[i])) continue;
    const name = lines[i - 1];
    if (!name || name.length < 3 || name.length > 200 || /£|:$/.test(name)) continue;
    const opts = []; let qty = null, price = null;
    for (let k = i + 1; k < Math.min(lines.length, i + 10) && price == null; k++) {
      const q = /^Quantity:\s*(\d{1,3})$/i.exec(lines[k]);
      if (q) { qty = Number(q[1]); continue; }
      const p = /^(?:Item )?Price:\s*(?:£\s?(\d{1,5}(?:,\d{3})*\.\d{2}))?$/i.exec(lines[k]);
      if (p) { const v = p[1] || ((/^£\s?(\d{1,5}(?:,\d{3})*\.\d{2})$/.exec(lines[k + 1] || "") || [])[1]); if (v) price = money(v); continue; }
      const o = /^([\p{L} ]{2,30}):\s*(.{1,60})$/u.exec(lines[k]);
      if (o && qty == null) { opts.push(o[2]); continue; }
      if (/^Transaction ID:/i.test(lines[k])) break;
    }
    if (price == null) continue;
    out.push({ name, qty: qty || 1, pricePence: price, ...(opts.length ? { variant: opts.join(", ") } : {}) });
  }
  return out;
}

// A PayPal receipt lists each thing as its name, "Qty: 2", an optional "Product ID: …" line and its price in the payment's
// currency ("US$5.00", "£3.99", "€4.00", "MX$30.94"), the cells' "|" around them. Round 13.
const PAYPAL_LABEL = /^(?:funding sources? used|paid with|paid using|you paid using|sent (?:to|from)|transaction (?:id|date)|seller|instructions to seller|payment from|payment to)\b/i;
function payPalItems(text) {
  const cells = String(text || "").split("\n").map((l) => l.replace(/\|/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  // (Its HTML gives each label and its value as lines of their own, "Quantity", "1", "Item", "6 Month Digital Subscription",
  // "ID number" with nothing, "Price", "£45.00 GBP": read as the labelled rows they are. Round 19.)
  const ROW = /^(?:Quantity|Item|ID number|Price)$/i, lines = [];
  for (let i = 0; i < cells.length; i++) {
    if (ROW.test(cells[i]) && cells[i + 1] && !/^(?:Quantity|Item|ID number|Price)\b/i.test(cells[i + 1])) { lines.push(cells[i] + " " + cells[i + 1]); i++; } else lines.push(cells[i]);
  }
  const out = [];
  // (PayPal's older receipt sets each thing out as labelled rows: "Quantity | 1", "Item | 3 Month Print Subscription", "Price |
  // €80.00 EUR". Round 15.)
  for (let i = 0; i < lines.length - 2; i++) {
    const q = /^Quantity:? (\d{1,3})$/i.exec(lines[i]), n = /^Item:? (.{2,120})$/i.exec(lines[i + 1] || "");
    if (!q || !n) continue;
    let k = i + 2;
    if (/^ID number\b/i.test(lines[k] || "")) k++;
    const pm = /^Price:? (?:US\$|CA\$|A\$|MX\$|£|€|\$)\s?(\d{1,5}(?:,\d{3})*\.\d{2})(?:\s*[A-Z]{3})?$/.exec(lines[k] || "");
    if (pm) out.push({ name: n[1].replace(/\s*(?:\.\.\.|…)$/, ""), qty: Number(q[1]), pricePence: Math.round(Number(pm[1].replace(/,/g, "")) * 100) });
  }
  if (out.length) return out;
  // (Or a table, "Description | Unit price | Qty | Amount" over each thing's four cells, "3 Month Print Subscription (United
  // Kingdom)" "€80.00 EUR" "1" "€80.00 EUR", down to "Subtotal". Round 17.)
  const money = (x) => { const m = /^(?:US\$|CA\$|A\$|MX\$|£|€|\$)\s?(\d{1,5}(?:,\d{3})*\.\d{2})(?:\s*[A-Z]{3})?$/.exec(x || ""); return m ? Math.round(Number(m[1].replace(/,/g, "")) * 100) : null; };
  for (let i = 0; i + 3 < lines.length; i++) {
    if (!(/^description$/i.test(lines[i]) && /^unit price$/i.test(lines[i + 1]) && /^(?:qty|quantity)$/i.test(lines[i + 2]) && /^amount$/i.test(lines[i + 3]))) continue;
    for (let k = i + 4; k + 3 < lines.length && out.length < 30; k += 4) {
      const name = lines[k], unit = money(lines[k + 1]), q = /^(\d{1,3})$/.exec(lines[k + 2]), amt = money(lines[k + 3]);
      if (/^(?:subtotal|total|shipping|postage|tax)\b/i.test(name) || unit == null || !q || amt == null || name.length > 120) break;
      out.push({ name: name.replace(/\s*(?:\.\.\.|…)$/, ""), qty: Number(q[1]), pricePence: amt, ...(Number(q[1]) > 1 ? { lineTotal: true } : {}) });
    }
    break;
  }
  if (out.length) return out;
  for (let i = 1; i < lines.length; i++) {
    const q = /^Qty:\s*(\d{1,3})$/i.exec(lines[i]);
    if (!q) continue;
    const name = lines[i - 1];
    if (!name || name.length < 2 || name.length > 120 || /^(?:subtotal|total|merchant|transaction|order id|qty)\b|£|\$|€/i.test(name)) continue;
    let k = i + 1;
    if (/^product id\s*:/i.test(lines[k] || "")) k++;
    const pm = /^(?:US\$|CA\$|A\$|MX\$|£|€|\$)\s?(\d{1,5}(?:,\d{3})*\.\d{2})(?:\s*[A-Z]{3})?$/.exec(lines[k] || "");
    if (!pm) continue;
    out.push({ name: name.replace(/\s*(?:\.\.\.|…)$/, ""), qty: Number(q[1]), pricePence: Math.round(Number(pm[1].replace(/,/g, "")) * 100) });
  }
  return out;
}

// Google Play's receipt lists what was bought between "Item Price" and "Total:", one paragraph each (the name can wrap over
// lines), the price at the end of the paragraph, "£5.99" or a plan's "£5.99/month"; "(by Microsoft Corporation)" is the
// developer, not part of the name. Round 13.
function googlePlayItems(text) {
  const t = String(text || "").replace(/\r/g, "");
  const head = /^[ \t|]*item[ \t|]+price[ \t|]*$/im.exec(t);
  if (!head) return [];
  const rest = t.slice(head.index + head[0].length);
  const end = /^[ \t|]*total\s*:/im.exec(rest);
  const body = end ? rest.slice(0, end.index) : rest.slice(0, 2000);
  const out = [];
  // (Paragraphs in the text part; in the HTML's text, one row a line, the cells apart by "|".)
  const paras = body.split(/\n[ \t|]*\n/);
  const pieces = paras.length > 1 ? paras : body.split("\n");
  const flat = (x) => x.replace(/[\s|]+/g, " ").trim(); // (every run of spaces, pipes and line breaks becomes one space, in one pass)
  const row = (x) => /^(.{3,300}?)\s*£\s?(\d{1,5}(?:,\d{3})*\.\d{2})(?:\s*\/\s*(?:month|year|week|day))?$/i.exec(flat(x));
  for (const para of pieces) {
    // (In the HTML's text a row's note sits on the line under it, "Monthly Subscription ‐ Next payment …": the row is its
    // own line, the one that ends in the price.)
    const m = row(para) || (para.includes("\n") ? para.split("\n").map(row).find(Boolean) : null);
    if (!m) continue;
    const name = m[1].replace(/\s*\(by [^()]{2,60}\)\s*$/i, "").trim();
    if (name.length >= 3) out.push({ name, qty: 1, pricePence: money(m[2]) });
  }
  return out;
}

// The same from the text part alone (an email pasted as text, or one with no HTML): "Order #206-…" lines at the top name the
// orders in turn; each order's "Ordered item(s):" lists its things, each name before its price ("2 x BOSS … £29.00" is two at
// £29.00), with "Condition: New", "Sold by: …" and "Fulfilled by Amazon" between them (run together with the next name in
// the newer layout: a seller ends at "Fulfilled by Amazon", at Amazon's own "Amazon EU S.a.r.L." or at the line's end); and
// "Order Total:" closes it. Null when the text isn't laid out this way. Round 13.
export function amazonPlainOrders(plain) {
  const t = String(plain || "").replace(/\r/g, "").replace(/<br\s*\/?>/gi, "");
  if (!/\bOrdered item\(s\):/i.test(t)) return null;
  const refs = [...new Set([...t.slice(0, 600).matchAll(/^\s*Order\s*#\s*((?:\d{3}|D\d{2})-\d{7}-\d{7})\s*$/gim)].map((m) => m[1]))];
  if (!refs.length) return null;
  const lines = t.split("\n");
  const out = [];
  let buf = [], inItems = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const tot = /^\s*Order Total:\s*(?:£\s?([\d,]+\.\d{2}))?\s*$/i.exec(l);
    if (tot) {
      let total = tot[1] ? money(tot[1]) : null;
      if (total == null) { const nx = /^\s*£\s?([\d,]+\.\d{2})\s*$/.exec(lines[i + 1] || ""); if (nx) { total = money(nx[1]); i++; } }
      out.push({ text: buf.join("\n"), totalPence: total }); buf = []; inItems = false; continue;
    }
    const start = /^\s*Ordered item\(s\):\s*(.*)$/i.exec(l);
    if (start) { inItems = true; buf.push(start[1]); continue; }
    if (!inItems) continue;
    const ship = /^(.*?)(?:Shipment \d{1,2} of \d{1,2}\b.*|^\s*Arriving:.*)$/i.exec(l);
    if (ship) { buf.push(ship[1]); inItems = false; continue; }
    buf.push(l);
  }
  if (out.length !== refs.length || out.some((o) => o.totalPence == null)) return null;
  const strip = (s) => {
    for (let k = 0; k < 6; k++) {
      const before = s;
      s = s.replace(/^\s+/, "").replace(/^Condition:\s*[A-Za-z -]*?(?=Sold by:|Fulfill?ed by|\n|$)/i, "").replace(/^\s+/, "");
      if (/^Sold by:/i.test(s)) {
        const amz = /^Sold by:\s*Amazon(?: EU)? S\.?[aà]\.?r\.?l\.?/i.exec(s), ful = /^Sold by:[^\n]*?Fulfill?ed by Amazon/i.exec(s);
        s = amz ? s.slice(amz[0].length) : ful ? s.slice(ful[0].length) : s.replace(/^[^\n]*/, "");
      }
      s = s.replace(/^\s*Fulfill?ed by Amazon/i, "");
      if (s === before) break;
    }
    return s.replace(/\s+/g, " ").trim();
  };
  const read = out.map((o, k) => {
    const items = [];
    let last = 0;
    for (const m of o.text.matchAll(/£\s?(\d{1,5}(?:,\d{3})*\.\d{2})/g)) {
      let name = strip(o.text.slice(last, m.index));
      last = m.index + m[0].length;
      let qty = 1;
      const q = /^(\d{1,3}) x (.{3,})$/.exec(name);
      if (q) { qty = Number(q[1]); name = q[2].trim(); }
      if (name.length < 3 || name.length > 400) return null;
      items.push({ name, qty, pricePence: money(m[1]) });
    }
    if (!items.length || strip(o.text.slice(last)).length > 0 && /£/.test(o.text.slice(last))) return null;
    const itemsPence = items.reduce((n, i) => n + i.pricePence * i.qty, 0);
    const check = { complete: Math.abs(itemsPence - o.totalPence) <= 1, itemsPence, expectedPence: o.totalPence, missingPence: o.totalPence - itemsPence };
    return { orderRef: refs[k], items, totalPence: o.totalPence, currency: "GBP", itemsCheck: { ...check, ...namesCheck(items, {}) } };
  });
  return read.every(Boolean) ? read : null;
}

// One Amazon confirmation can hold several orders ("Your purchase has been divided into 2 orders"): each "Order #" with its
// own items and its own "Order Total:". Read from the HTML, where each order's rows sit under its number (an order sent in
// two parcels has its number over each), with each title Amazon cut short ("Minky 3 Tier Plus Clothes Airer, Sil...") taken
// whole from the text part, and a total paid with a gift card kept as written ("Order Total: £0.00", the gift card paying
// the rest). Every order found, in the order the email lists them; null when the email doesn't show them this way. Round 13.
const AMZ_REF = /^[\u200e\u200f\u202a-\u202e]*((?:\d{3}|D\d{2})-\d{7}-\d{7})$/;
export function amazonOrders(html, plain) {
  const rows = amazonRows(html);
  const heads = [];
  for (let i = 0; i < rows.length; i++) {
    const one = /^Order\s*#\s*:?\s*[\u200e\u200f\u202a-\u202e]*((?:\d{3}|D\d{2})-\d{7}-\d{7})$/i.exec(rows[i]);
    if (one) { heads.push({ i, ref: one[1] }); continue; }
    if (/^Order\s*#\s*:?$/i.test(rows[i])) { const r = AMZ_REF.exec(rows[i + 1] || ""); if (r) heads.push({ i, ref: r[1] }); }
  }
  if (!heads.length) return null;
  // (The newer layout gives each product picture the whole title as its alt text.)
  const alts = [...String(html || "").matchAll(/<img\b[^>]{0,600}?\balt="([^"]{12,400})"/gi)].map((m) => decodeEntities(m[1].replace(/&#39;/g, "'"))).filter((a) => !/(?:\.\.\.|…)$/.test(a));
  const text = String(plain || "").replace(/\r/g, "") + (alts.length ? "\n" + alts.join("\n") : "");
  const flat = text.replace(/[ \t]+/g, " ");
  const whole = (it) => {
    let name = it.name;
    if (it.cut && name.length >= 12) {
      const at = flat.indexOf(name);
      if (at >= 0) {
        const rest = flat.slice(at).split("\n")[0].split(/£\s?\d|\s*(?:Condition|Sold by|Qty|Quantity)\s*:/i)[0].replace(/\s+\d+(?:\.\d{2})?\s*GBP\s*$/i, "").trim();
        if (rest.length > name.length && rest.length <= 400) name = rest;
      }
    }
    // (A book's author on the row under its title: the text part says "Title of Author". Round 13.)
    if (it.above && flat.includes(it.above + " of " + name)) name = it.above + " of " + name;
    const stillCut = Boolean(it.cut && name === it.name);
    // (A book's author, as the text part writes it: "Title of Author".)
    if (it.author && !name.endsWith(" of " + it.author)) name = name + " of " + it.author;
    const { cut, above, author, ...rest } = it;
    // (A title still cut short, when the email has no text part to take it whole from: flagged, never passed off as whole.)
    return { ...rest, name, ...(stillCut ? { stillCut: true } : {}) };
  };
  const orders = new Map();
  heads.forEach((h, k) => {
    const seg = rows.slice(h.i + 2, k + 1 < heads.length ? heads[k + 1].i : rows.length);
    const o = orders.get(h.ref) || { orderRef: h.ref, items: [], totalPence: null, giftCardPence: 0 };
    o.items.push(...amazonItems(null, seg).filter((it) => it.pricePence != null).map(whole));
    // (An order sent in parcels repeats its summary, "Gift Card (£5.99)" with it, over each parcel: the gift card paid once.
    // Amazon gives the gift card's part as one line in each summary. Round 15.)
    let gift = 0;
    for (let j = 0; j < seg.length; j++) {
      // ("Order Total:" over "£28.52"; the newer layout's "Total" over "£" "21" "84".)
      if (o.totalPence == null && /^(?:Order )?Total\s*:?$/i.test(seg[j])) {
        const m = /^£\s?([\d,]+\.\d{2})$/.exec(seg[j + 1] || "");
        if (m) o.totalPence = money(m[1]);
        else if (seg[j + 1] === "£" && /^\d{1,5}$/.test(seg[j + 2] || "") && /^\d{2}$/.test(seg[j + 3] || "")) o.totalPence = Number(seg[j + 2]) * 100 + Number(seg[j + 3]);
      }
      const g = /^Gift Card\s*\(£\s?([\d,]+\.\d{2})\)$/i.exec(seg[j]); if (g) gift = Math.max(gift, money(g[1]));
      // (And what the rest was paid with, the email's own line under "Selected Payment Method(s):", "Visa (£40.75)": the
      // card's part of an order a gift card paid some of. Round 24.)
      const c = !g && /^selected payment method/i.test(seg[j - 1] || seg[j - 2] || "") || (j > 0 && /^Gift Card\s*\(/i.test(seg[j - 1])) ? /^(\p{L}[\p{L} .'’-]{1,30}?)\s?\(£\s?([\d,]+\.\d{2})\)$/u.exec(seg[j]) : null;
      if (c && !/^gift card$/i.test(c[1]) && !o.cardPaid) o.cardPaid = { label: c[1].trim(), pence: money(c[2]) };
    }
    o.giftCardPence = Math.max(o.giftCardPence, gift);
    orders.set(h.ref, o);
  });
  const out = [...orders.values()].filter((o) => o.totalPence != null);
  if (!out.length || out.length !== orders.size) return null;
  return out.map((o) => {
    const itemsPence = o.items.reduce((n, i) => n + i.pricePence * (i.qty || 1), 0);
    const expectedPence = o.totalPence + o.giftCardPence;
    const check = { complete: o.items.length > 0 && Math.abs(itemsPence - expectedPence) <= 1, itemsPence, expectedPence, missingPence: expectedPence - itemsPence, ...(o.giftCardPence ? { giftCardPence: o.giftCardPence } : {}) };
    const { giftCardPence, cardPaid, ...rest } = o;
    // (What the card paid, as the email says, only beside a gift card's part and only when the two come to the order.)
    if (giftCardPence && cardPaid && cardPaid.pence === o.totalPence) rest.cardPaid = cardPaid;
    // (What the order cost is what was bought, the gift card's part with the rest: Amazon's "Order Total" is only what was
    // left for the card, £0.00 when a gift card paid it all. The gift card's part is kept beside it. Round 15.)
    if (giftCardPence) rest.totalPence = o.totalPence + giftCardPence;
    const cutNames = o.items.filter((i) => i.stillCut).map((i) => ({ name: String(i.name).slice(0, 120), why: "cut" }));
    rest.items = o.items.map(({ stillCut, ...i }) => i);
    const names = namesCheck(rest.items, {});
    return { ...rest, currency: "GBP", ...(giftCardPence ? { giftCardPence } : {}), itemsCheck: { ...check, ...names, ...(cutNames.length ? { complete: false, namesCut: true, namesOk: false, suspectNames: [...(names.suspectNames || []), ...cutNames].slice(0, 10) } : {}) } };
  });
}

// A plan row under an app or service: "Individual (Monthly)", "Weekly Unlimited Access (7 days)", "Premium (Annual)".
const APPLE_PLAN = /\((?:monthly|yearly|annual|annually|weekly|quarterly|\d+\s*(?:days?|weeks?|months?|years?))\)\s*$|^(?:weekly|monthly|yearly|annual)\b.{2,60}$/i;
// The phone or computer it was bought on: "Sam's iPhone", "iPad Pro". Never the thing bought.
const APPLE_DEVICE = /^(?:[\p{L}\p{N} .'’-]{1,40}['’]s\s+)?(?:iphone|ipad|ipod|mac(?:book)?|apple watch|apple vision pro|apple tv)(?:\s?[\w ]{0,12})?$/iu;
// An app's store title often runs on after its name ("MobiPDF・PDF Editor・Reader・Sign", "Notes - Write & Plan"): the
// name is the part before the first separator.
const appShort = (s) => String(s).split(/\s*[・·|]\s*|\s+[-–—:]\s+|:\s+/)[0].trim() || String(s);
// Whether a line ends with a price or "free" (after any spaces and column edges). Only such a line can be split into a name
// and its price below; checking first keeps a very long line without one (an email's padding) from taking minutes.
function endsInPrice(x) {
  let e = x.length;
  while (e > 0 && (x[e - 1] === "|" || /\s/.test(x[e - 1]))) e--;
  const pound = e > 0 ? x.lastIndexOf("£", e - 1) : -1;
  return /(?:£\s*[0-9][0-9,]*\.[0-9]{2}|free)$/i.test(x.slice(Math.max(0, Math.min(e - 4, pound < 0 ? e : pound)), e));
}
export function appleItems(text) {
  // ("Report a Problem | £1.59": a price in the cell beside the last row is that purchase's price, on a row of its own.)
  const rows = String(text || "").split("\n").flatMap((x) => (endsInPrice(x) ? x.replace(/^(.+?)(?:\s*\|\s*|\t+|\s{2,})(£\s*[0-9][0-9,]*\.[0-9]{2}|free)\s*\|?\s*$/i, "$1\n$2") : x).split("\n")).map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    if (/^(subtotal|total|vat|tax)\b|\b(inclusive of|includes|incl\.?) vat\b/i.test(rows[i])) break;
    const pm = rows[i].match(/^£\s*([0-9][0-9,]*\.[0-9]{2})$/) || (/^free$/i.test(rows[i]) ? [rows[i], "0.00"] : null);
    if (!pm) continue;
    // The rows above the price, nearest first: the app (or Apple's own service), then what was bought in it or the plan.
    const found = [];
    let plan = null, inApp = false;
    for (let j = i - 1; j >= 0 && j >= i - 7 && found.length < 2; j--) {
      const r = rows[j];
      if (/^£|^free$/i.test(r) || APPLE_LABEL.test(r)) break;
      if (/in-app purchase/i.test(r)) { inApp = true; continue; }
      // (Apple's own service over its plan, "Apple Music" over "Individual (Monthly)". A store's heading, "App Store" over a
      // game, is not. Round 10.)
      // (A service's name right over a free game, "Apple Arcade" under "Monument Valley 3", says where it came from: the game
      // above it is the item.)
      if (APPLE_SECTION.test(r)) {
        if (!found.length && !plan && /^apple arcade$/i.test(r)) continue;
        if (!found.length || (found.length === 1 && /^(apple arcade|apple tv|apple music|apple one|icloud)$/i.test(r))) found.push(r);
        break;
      }
      if (!plan && APPLE_PLAN.test(r) && !/^renews\b|^free trial/i.test(r)) { plan = r; continue; }
      if (APPLE_DEVICE.test(r) || APPLE_NOISE.test(r) || r.length > 90) continue;
      found.push(r);
    }
    if (!found.length && !plan) continue;
    const app = found.length ? found[found.length - 1] : null;
    const what = found.length === 2 ? found[0] : null;
    const pricePence = pm[1] === "0.00" ? 0 : money(pm[1]);
    // Round 12: the item is what was bought, with the app as its detail ("Stack of Coins" in Match Masters); a plan is named
    // with its app ("Apple Music Individual (Monthly)"), unless the plan already says it ("iCloud+ with 200 GB (Monthly)").
    if (what && (inApp || !plan)) { items.push({ name: what, variant: appShort(app), qty: 1, pricePence }); continue; }
    if (plan) {
      const short = app ? appShort(app) : "";
      const name = !short || plan.toLowerCase().includes(short.toLowerCase()) ? plan : `${short} ${plan}`;
      items.push({ name, qty: 1, pricePence });
      continue;
    }
    items.push({ name: app, qty: 1, pricePence });
  }
  return items;
}

// The address the shop sent the order to: what its returns page asks for. Often the inbox Relay reads, but not always (a
// Hide My Email address, an alias, an old address that forwards). It is the shopper's own address, kept only for returns.
function sentToOf(headers, sender) {
  for (const m of String(headers.to || "").slice(0, 2000).matchAll(/([A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+)/g)) {
    const a = m[1].toLowerCase();
    // Not the shop's own address (an email sent "to" the shop with the shopper in Bcc), nor a placeholder. (A Hide My Email
    // or personal sender shares its domain with the shopper's own address, so that rule doesn't apply to them.)
    const shopDomain = sender && sender.domain && !isVia(sender.domain) && !PERSONAL_MAIL.test(sender.domain) ? sender.domain : null;
    if (shopDomain && a.endsWith("@" + shopDomain)) continue;
    if (/^(undisclosed|no-?reply|recipients?)[@.]/.test(a)) continue;
    return a.slice(0, 254);
  }
  return null;
}

// The shop, ranked from every clue in the email (see receipt-reader.js).
function shopOf({ ld, sender, fromName, subject, text, html, otherText }) {
  const domain = sender?.domain || null;
  const personal = PERSONAL_MAIL.test(domain || "");
  const fwOpts = { subject, personal: (d) => PERSONAL_MAIL.test(d) };
  const fw = forwardedSender(text, fwOpts) || (otherText ? forwardedSender(otherText, fwOpts) : null);
  // A shop's email the shopper forwarded from their own mailbox reads as if the shop had sent it: the original sender is
  // weighed as the sender (a payment company's own name still counts for nothing), so it names the same shop as the original.
  const asSent = Boolean(fw && personal);
  const GENERIC = /^(orders?|noreply|no-reply|info|hello|customer.?service|team|support|shop|store|sales)\b/i;
  const sentName = asSent ? (fw.name && !GENERIC.test(fw.name) ? fw.name : null) : sender?.name ? fromName : null;
  const sentDomain = asSent ? fw.domain : domain;
  subject = String(subject || "").replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, "");
  const ranked = rankShop({
    dataName: ld?.retailerName || null,
    forwardedName: asSent ? null : fw?.name || null, forwardedDomain: asSent ? null : fw?.domain || null,
    senderName: sentName, senderDomain: sentDomain, personal: asSent ? false : personal,
    senderInSubject: Boolean(sentName && sentName.length >= 5 && subject.includes(sentName.trim())),
    // (Not the forward's own header lines: its "Subject:" would count the subject twice.)
    bodyNames: shopNamesInText(asSent ? text.replace(/^[ \t>*]*(?:from|subject|date|to|sent|cc)[ \t*]*:.*$/gim, "") : text, subject),
    // A payment platform's own receipt names the business that was paid ("Merchant: Example Lettings").
    // (Or on the line under the label, "Merchant |" over "CLIP MX*BAZAR |": a PayPal Debit Card purchase; or a card payment
    // page's subject, "APPROVED: Payment transaction for your order M589966 … at Embassy of Nepal". Round 13.)
    merchantName: sentDomain && isVia(sentDomain) ? (((text.match(/^[#*|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*merchant(?: name)?\s*[:|]\s*\**\s*([^\n|*]{2,40}?)\s*\**\s*\|?\s*$/im) ||
      text.match(/^[ \t#*|]*merchant(?: name)?[ \t]*[:|]?[ \t|]*\n[ \t|]*([^\n|]{2,40}?)[ \t]*\|?[ \t]*$/im) ||
      text.match(/\byour PayPal Debit Card (?:ending in [•·*.\d ]{2,12} )?at ([^\n|]{2,40}?) on \d{1,2} [A-Za-z]{3,9} \d{4}/i) ||
      // (PayPal's older receipt: "Payment to: The Clare Champion Ltd accounts@…", "purchase details from The Clare Champion Ltd
      // on 25 September 2023". Round 15.)
      text.match(/^[ \t|*]*payment to\s*:\s*([^\n|@]{2,60}?)\s+[^\s@|]+@[^\s|]+/im) ||
      // (PayPal's "You placed a £25.00 GBP order with Virgin Wines Onlined Limited (help@…)", "Seller" over the name. Round 15.)
      text.match(/\byou placed an? [^\n]{0,30}?\border with ([^\n(|]{2,60}?)\s*\(/i) || text.match(/^[ \t|*]*seller[ \t|]*\n[ \t|]*([^\n|@]{2,60}?)[ \t|]*$/im) || text.match(/\bpurchase details from ([^\n|]{2,60}?) on \d{1,2} [A-Za-z]{3,9} \d{4}/i) ||
      /\b[Pp]ayment transaction\b.*\sat\s+(\p{Lu}[\p{L}\d&'’. -]{2,40}?)\s*$/u.exec(subject) ||
      // (PayPal's "Receipt from Burger Barn 4410227 for your £8.40 GBP purchase", "You authorised a payment of £8.40 GBP to
      // Burger Barn 4410227": the shop, without the number of its till. Round 22.)
      /^\s*[Rr]eceipt from\s+(\p{L}[^\n|]{1,58}?)\s+for your\b/u.exec(subject) || text.match(/\byou authori[sz]ed a payment of [^\n|]{1,30}? to ([^\n|]{2,60}?)\s?\.?[ \t]*(?:\n|\||$)/i) || [])[1] || "").replace(/\s+\S+@\S+$/, "").replace(/^(\p{L}[^\n]{1,50}?)\s+\d{5,10}$/u, "$1") || null) : null,
    linkDomain: mainLinkDomain(html),
    // (The game's name is a heading in the HTML; a plain-text part may not carry it at all.)
    titleName: GAME_SHOP.test(sentDomain || "") ? (html && gameTitle(htmlToText(html))) || gameTitle(text, subject) : null,
  });
  // (A payment service cuts a long shop name short, "London Craft Beer Fe...", "ON THAT ASS Internat...": when the email
  // writes it whole somewhere else, its subject "Receipt for your payment to Cellar Club Online Limited", the whole name is
  // the shop's: the cut word finished and the capitalised words after it. Never a guess when it doesn't. Round 15.)
  if (ranked.name && sentDomain && isVia(sentDomain) && ranked.name.length >= 6 && ranked.name.length <= 40) {
    const q = ranked.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hay = String(subject || "") + "\n" + text.slice(0, 20000);
    if (new RegExp(q + "\\s?(?:\\.\\.\\.|…)").test(hay)) {
      const whole = [...hay.matchAll(new RegExp("(?<![\\p{L}\\d])" + q + "[\\p{L}\\d&'’-]{0,20}(?: (?:\\p{Lu}[\\p{L}\\d&'’.-]{0,20}|&|and|of|the|de|B\\.V\\.)){0,4}(?!\\s?(?:\\.\\.\\.|…))", "gu"))]
        .map((m) => m[0].replace(/[\s.,-]+$/, "").replace(/\s+(?:and|of|the|de|&)$/i, "")).filter((n) => n.length > ranked.name.length && !/(?:\.\.\.|…)$/.test(n));
      if (whole.length) ranked.name = whole.sort((a, b) => b.length - a.length)[0];
    }
  }
  // (A reseller that sells a maker's software on its behalf sends the receipt under the maker's name, "Photo Tidy (via
  // Paddle.com)" <help@paddle.com>: the maker is the shop, the reseller only how it was sold. Only when the name in brackets
  // is the sending address's own. Round 23.)
  {
    const vm = /^\s*"?(\p{L}[\p{L}\d&'’. -]{1,40}?)\s+\(via\s+([A-Za-z0-9-]+(?:\.[A-Za-z]{2,10}){0,2})\)"?\s*$/u.exec(String((asSent ? fw.name : sender?.name) || ""));
    if (vm && sentDomain && vm[2].toLowerCase().split(".")[0] === domainBase(sentDomain).replace(/-/g, "") && !/^(?:orders?|no-?reply|support|team|billing|receipts?)$/i.test(vm[1])) ranked.name = vm[1].trim();
  }
  // Uber sends rides and Uber Eats orders from the same address and name: a food order is Uber Eats.
  if (/(^|\.)uber\.com$/i.test(sentDomain || "") && /^uber$/i.test(ranked.name || "") && (/\buber eats\b/i.test(subject) || (/\border\b/i.test(subject) && /\buber eats\b/i.test(text.slice(0, 4000))))) ranked.name = "Uber Eats";
  // (An ordering platform's email, or one whose sender gives no name of its own, names the restaurant it was for: "Your order
  // with Harbour Chippy (Whitby) is confirmed", "Thank you for ordering with Pizza Hut Restaurants!". The restaurant is the
  // shop, never the platform ("Preoday") or a word from its address ("Pizza"). Round 16.)
  {
    const hay = String(subject || "") + "\n" + text.slice(0, 4000);
    const m = /\b[Yy]our order (?:with|from|at) (\p{Lu}[\p{L}\d&'’.() -]{2,60}?) (?:is|has been) (?:confirmed|ready|accepted|being prepared|on its way)\b/u.exec(hay) ||
      /\b(?:[Tt]hank you|[Tt]hanks) for (?:ordering|your order) (?:with|from|at) (\p{Lu}[\p{L}\d&'’.() -]{2,60}?)\s*[!.\n]/u.exec(hay);
    const named = m && m[1].trim();
    const weak = !ranked.name || (sentDomain && isVia(sentDomain)) || !sentName || (named && named.toLowerCase().startsWith(String(ranked.name).toLowerCase() + " "));
    const longer = named && ranked.name && named.toLowerCase().startsWith(String(ranked.name).toLowerCase() + " ");
    if (named && weak && !/^(?:us|you|the|your|our)\b/i.test(named) && (longer || !sameShopName(named, ranked.name))) {
      // (The branch in brackets is where, not who: "Harbour Chippy (Whitby)" is Harbour Chippy.)
      ranked.name = named.replace(/\s*\([^()]{1,40}\)$/, "").replace(/^(\p{Lu}[\p{L}'’]+(?: \p{Lu}[\p{L}'’]+)+) [Rr]estaurants?$/u, "$1");
      if (sentDomain && isVia(sentDomain)) ranked.via = ranked.via || sentDomain;
    }
  }
  // "Tesco.com" as the sender's name, when the email calls the shop "Tesco" again and again (its own products, "Tesco Whole
  // Milk"): the shop is Tesco. (A brand whose name is its address, "Booking.com", writes it that way throughout.) Round 8.
  const dotCom = /^(\p{Lu}[\p{Ll}\d-]{2,30})\.com$/u.exec(ranked.name || "");
  if (dotCom && (String(text).match(new RegExp("\\b" + dotCom[1] + "\\b(?!\\.com)", "g")) || []).length >= 2) ranked.name = dotCom[1];
  // "Costa Coffee" from costa.co.uk, "Domino's Pizza" from dominos.co.uk, "Waitrose & Partners" from waitrose.com: the shop is
  // the name its address gives, so the same shop is one shop in Relay whichever of its emails named it. Round 8.
  const brand = /^(.+?)\s+(?:&\s*partners|coffee|pizza|pizzas|restaurants?|uk|group|stores?|foods?|burgers?|grill|express|online)$/i.exec(ranked.name || "");
  if (brand && sentDomain && brand[1].toLowerCase().replace(/[^a-z0-9]/g, "") === domainBase(sentDomain).replace(/-/g, "")) ranked.name = brand[1];
  // "DVSA Confirmation of Payment" from an agency's address with no name of its own (a test booked through the company that
  // runs the bookings): the subject names who was paid. Round 13.
  const paidTo = !sentName && /^(\p{Lu}[\p{L}\d&'’.-]{1,30}(?:\s+\p{Lu}[\p{L}\d&'’.-]{1,30}){0,2})\s+(?:[Cc]onfirmation of [Pp]ayment|[Pp]ayment [Cc]onfirmation)\s*$/u.exec(subject);
  if (paidTo) { ranked.name = paidTo[1]; ranked.domain = null; }
  // ("British Airways e-ticket", "… Bookings": the sender's name for one kind of its emails; the shop is the name before it.
  // Round 14.)
  if (ranked.name) { const bare = ranked.name.replace(/\s+(?:e-?tickets?|bookings?|booking confirmations?|reservations)$/i, ""); if (bare !== ranked.name && bare.length >= 2) ranked.name = bare; }
  // A receipt forwarded from a personal mailbox keeps that mailbox's address when the original shop isn't found.
  const out = { name: ranked.name || null, domain: ranked.domain || (personal ? domain : null) };
  if (ranked.via) out.via = ranked.via;
  if (!out.name && !out.domain && domain) out.domain = domain;
  return out;
}

// "Your booking confirmation for London to Orpington (27 September at 12:54)", "... for return trip London to Nottingham (20 August ...".
const JOURNEY = /\b(?:booking|reservation|tickets?|trip|journey)\b[^()\n]*?\bfor (return trip )?(?:from )?(\p{Lu}[\p{L}\d .'’&-]{1,40}?) to (\p{Lu}[\p{L}\d .'’&-]{1,40}?)(?=\s*\(|\s*[-–,]|\s*$)/u;
// A rail booking's own list of tickets: "Adult - Anytime Day Single - [26-30 Railcard]" over its price, a line or a cell
// apart. Each is a ticket bought (round 12: two tickets for one trip, a split ticket, are two items, each with its price).
const RAIL_TICKET = /^(?:(\d{1,2})\s*[x×]\s*)?(adults?|child(?:ren)?|seniors?|young persons?|students?)\s*[-–]\s*(.{3,60}?)(?:\s*[-–]\s*\[([^\]]{2,40})\])?\s*(?:\|\s*(£\s?[\d,]+\.\d{2}))?\s*\|?$/i;
// Each way's legs, "London St Pancras International to Nottingham", under its "Outbound Thursday 20 August" or "Return …"
// heading (never the order's own "Outbound |" list), and how many tickets the order lists for each way.
function legsByWay(text) {
  const rows = String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  const out = { outbound: [], return: [], ticketsIn: { outbound: 0, return: 0 } };
  let way = null, inOrder = false, prev = null;
  // (A way with no "A to B" rows under it sets out its train by the times it leaves and arrives, "09:05 Leeds",
  // "11:40 London Kings Cross": that is its leg. Round 16.)
  const timed = { outbound: [], return: [] };
  for (const r of rows) {
    const h = /^(outbound|return)\s+(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i.exec(r);
    if (h) { way = h[1].toLowerCase(); inOrder = false; continue; }
    const o = /^(outbound|return)$/i.exec(r);
    if (o) { way = o[1].toLowerCase(); inOrder = true; continue; }
    if (!way) continue;
    // (A row said twice running, as an email's second copy for phones can make it, is one ticket.)
    if (inOrder) { if (RAIL_TICKET.test(r) && r !== prev) out.ticketsIn[way]++; prev = r; continue; }
    const leg = RAIL_LEG.exec(r);
    if (leg && !/^your\b/i.test(r)) {
      // ("Halton Lea or Halton Bridge to Marsham", "Elmford Castle or Central to Wrayton": the station the
      // train is boarded at, by the times it is set out with or the leg before; else the first.)
      const alt = /^(\p{Lu}[\p{L}\d .'’&-]{1,40}?) or (\p{Lu}[\p{L}\d .'’&-]{1,40}?) to (.+)$/u.exec(r);
      let from = leg[1];
      if (alt) {
        const before = out[way].length ? out[way][out[way].length - 1].split(" to ").pop() : null;
        const stations = [...rows.map((x) => (/^\d{1,2}:\d{2} (\p{Lu}[\p{L}\d .'’&-]{1,40})$/u.exec(x) || [])[1]).filter(Boolean), before].filter(Boolean);
        from = stations.find((st) => st === alt[1] || st === alt[2] || st.endsWith(" " + alt[2])) || alt[1];
      }
      out[way].push(alt ? `${from} to ${alt[3]}` : r);
    }
    const t = /^\d{1,2}:\d{2} (\p{Lu}[\p{L}\d .'’&-]{1,40})$/u.exec(r);
    if (t && !/^view\b/i.test(t[1])) timed[way].push(t[1]);
  }
  for (const w of ["outbound", "return"]) if (!out[w].length && timed[w].length >= 2) out[w].push(`${timed[w][0]} to ${timed[w][timed[w].length - 1]}`);
  return out;
}
// A leg of a rail journey on a row of its own: "Leeds to Halton Lea", or with a choice of stations,
// "Halton Lea or Halton Bridge to Marsham".
const RAIL_LEG = /^(\p{Lu}[\p{L}\d .'’&-]{1,40}?(?: or \p{Lu}[\p{L}\d .'’&-]{1,40}?)?) to (\p{Lu}[\p{L}\d .'’&-]{1,40})$/u;
function railTickets(text) {
  const rows = String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  const out = [];
  let way = null;
  for (let i = 0; i < rows.length; i++) {
    const w = /^(outbound|return)$/i.exec(rows[i]);
    if (w) way = w[1].toLowerCase();
    const m = RAIL_TICKET.exec(rows[i]);
    if (!m) continue;
    const price = m[5] || (/^£\s?[\d,]+\.\d{2}$/.test(rows[i + 1] || "") ? rows[i + 1] : null);
    if (!price) continue;
    out.push({ type: m[3].trim(), passenger: m[2], card: m[4] || null, qty: m[1] ? Number(m[1]) : 1, pricePence: money(price.replace(/^£\s?/, "")), way });
  }
  return out;
}
// Which leg a ticket is for: its type over the leg, "Anytime Day Single" then "Seaford Sussex to Brighton".
function legOf(text, type, nth = 0) {
  const rows = String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  const legs = [];
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i].toLowerCase() !== type.toLowerCase()) continue;
    const leg = /^(\p{Lu}[\p{L}\d .'’&-]{1,40}?) to (\p{Lu}[\p{L}\d .'’&-]{1,40})$/u.exec(rows[i + 1]);
    if (leg) legs.push(rows[i + 1]);
  }
  return legs[nth] || legs[0] || null;
}
// A booking's own list of what was paid for, set out under "Order Details" (each thing over its price) then "Other costs"
// (each fee or extra over its price, or "No booking fee"), down to "Total amount": a rail booking, a railcard, a ticket
// change ("Pay The Difference: Adult - Advance Single" with no price of its own, then "Admin Fee" over "£7.50"). Null when
// the email has no such list. Round 15.
const DETAILS_HEAD = /^order details$/i, COSTS_HEAD = /^other costs\s*\*?$/i, DETAILS_END = /^(?:total(?: amount| paid| price| cost)?)\s*:?(?:\s*£\s?[\d,]+\.\d{2})?$/i;
function detailsList(text) {
  const rows = String(text || "").split("\n").map((x) => x.replace(/[\s|]+/g, " ").trim()).filter(Boolean);
  const start = rows.findIndex((r) => DETAILS_HEAD.test(r));
  if (start < 0) return null;
  const lines = [], costs = [];
  let inCosts = false;
  const priceOf = (r) => { const m = /^£\s?([\d,]{1,7}\.\d{2})$/.exec(r || ""); return m ? money(m[1]) : null; };
  for (let i = start + 1; i < rows.length && i < start + 60; i++) {
    const r = rows[i];
    if (DETAILS_END.test(r)) return lines.length ? { lines, costs } : null;
    if (COSTS_HEAD.test(r)) { inCosts = true; continue; }
    if (priceOf(r) != null || r.length > 90 || !/\p{L}/u.test(r)) { if (priceOf(r) == null) return null; continue; }
    // ("No booking fee": nothing was charged for it.)
    if (/^no\b/i.test(r)) continue;
    if (/^(?:no\b|free$|none$|n\/a$)/i.test(rows[i + 1] || "")) { i++; continue; }
    const p = priceOf(rows[i + 1]);
    (inCosts ? costs : lines).push({ name: r, pricePence: p });
    if (p != null) i++;
  }
  return null;
}
// A rail booking's fees under "Other costs": "Booking Fee" over "£1.39" (never "No booking fee").
function railFees(text) {
  const rows = String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  const out = [];
  for (let i = 0; i < rows.length - 1; i++) {
    if (!/^(?:booking|card|payment|transaction|service|seat reservation) (?:fee|charge)s?$/i.test(rows[i])) continue;
    const m = /^£\s?([\d,]+\.\d{2})$/.exec(rows[i + 1]);
    if (m && money(m[1]) > 0) out.push({ name: rows[i].charAt(0).toUpperCase() + rows[i].slice(1).toLowerCase(), pricePence: money(m[1]) });
  }
  return out;
}
// A station the subject shortens ("London") that the email's own lines name in full ("London Bridge"): the full name,
// when exactly one line starts with it and is a place name a word or two longer.
function fullStation(text, short) {
  const rows = String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  const re = new RegExp("^" + short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?: \\p{Lu}[\\p{L}'’&-]{1,20}){1,2}$", "u");
  // ("London Terminals", "London Underground" are fare zones, not the station.)
  const longer = [...new Set(rows.filter((r) => re.test(r) && !/\b(?:underground|terminals?)$/i.test(r)))];
  return longer.length === 1 ? longer[0] : short;
}
// A message about an order that was already placed is not its receipt: a delay ("Delay in shipping your … order"), a notice
// ("Important information regarding your product order", "An important message regarding your order", "Update on your
// order") or a benefit confirmed for it ("Benefit Confirmation for your Order").
const ORDER_NOTICE_SUBJECT = new RegExp([
  "\\bdelay(?:ed)?\\b[^\\n]{0,24}\\b(?:shipping|dispatch(?:ing)?|deliver(?:y|ing)|sending)\\b",
  "\\b(?:orders?|delivery|deliveries|parcels?|items?)\\b[^\\n]{0,24}\\b(?:is|are|has been|have been|will be) delayed\\b",
  "\\bdelay (?:to|with|on) your\\b",
  "\\b(?:important|urgent)\\s+(?:message|information|notice|update|news)\\s+(?:regarding|about|on|concerning|for)\\b[^\\n]{0,40}\\border\\b",
  "\\b(?:update|message|news)\\s+(?:regarding|about|on|concerning)\\s+your\\b[^\\n]{0,30}\\border\\b",
  "\\bbenefit confirmation\\b",
].join("|"), "i");
const PRICE_ADJUSTMENT = /\bprice (?:adjustment|match(?:ed)?|difference|drop|protection|promise)\b|\brefunded the (?:price )?difference\b|\bmatched a lower price\b|\bprice of an item you bought has (?:dropped|gone down|fallen)\b/i;
const NOT_A_PURCHASE_SUBJECT = /\b(?:refund(?:ed|s)?|cancell?(?:ed|ation)|price (?:adjustment|match(?:ed)?|difference)|credit note)\b/i;
const NOT_A_PURCHASE_TOP = /\b(?:your|the|this) order (?:has been|was|is) cancell?ed\b|\bwe(?:'|’)?ve cancell?ed your order\b|\b(?:some )?items? (?:in|from|of) your order (?:has|have) been cancell?ed\b|\bpart of your order has been cancell?ed\b|\bwe(?:'|’)?ve (?:matched a lower price|refunded the (?:price )?difference)\b/i;
const MONEY_OFF_NOTE = /^(?:[\p{L}'’ -]{0,20}\s)?(?:discount|multi-?buy(?: discount| saving| offer)?|voucher|promo(?:tion)?(?: code)?|saving|you saved?|offer discount)\s*:?\s*(?:[-−–]?\s?£\s?[\d,.]+)?$/iu;
// (Also the marketing email itself, dressed as a confirmation: "Order #58204 confirmed" … "Oops… there's no order here (yet)".)
const NO_ORDER = /\bthere (?:was|is) no order\b|\bthere(?:'|’)s no order here\b|\bnothing (?:was|has been) (?:ordered|charged)\b|\bnothing has been charged\b|\byou (?:haven(?:'|’)t|have not) been charged (?:a penny|anything)\b|\bthere wasn(?:'|’)t one\b[^\n]{0,40}\bsorry\b/i;
const UTILITY_BILL = /\b(?:on behalf of|(?:your )?payment to|thank you for your payment to)\s+(?:[\p{L}&'’.-]+\s){0,3}?(?:water|energy|electricity|gas|power|council|borough council|city council)(?:\s+(?:utilities|services|supply|plc|limited|ltd))*\b(?![\p{L}-])|\bcouncil tax (?:payment|bill)\b|\b(?:water|energy|gas|electricity) bill payment\b/iu;
// (Round 15: a gambling or trading site's "Thanks for depositing with partypoker", money put into an
// account to play or trade with, never a purchase, like a bill or an investment.)
const ACCOUNT_DEPOSIT =/\bthank you for (?:making|your) (?:a )?deposit\b|\bdeposit of [^\n.]{1,30}? has (?:now )?been (?:credited|added) to your (?:account|balance|wallet)\b|\bthanks? (?:you )?for depositing\b/i;
const PAYMENT_PROBLEM = /\b(?:(?:couldn(?:'|’)?t|could not|were unable to|we(?:'|’)re unable to|unable to) (?:charge|take (?:the )?payment|process (?:your |the )?payment|authori[sz]e (?:your |the )?payment)|payment (?:was |has been )?declined|payment (?:has )?failed|problem with (?:the|your) payment method)\b/i;

// An email as the reader sees it: its subject, sender and date, its plain-text part, and its HTML part turned into text the
// same way the reader turns it. Used for "Send this email to Relay" (shared-emails.js), so what a person at Relay reads is
// what the reader read. Pictures, attachments and the other headers are left out.
export function emailForReading(rawEmail) {
  const raw = String(rawEmail || "").slice(0, MAX_RAW);
  const { headers, body } = splitMessage(raw);
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  return { subject: headers.subject || "", from: headers.from || "", date: headers.date || "",
    plain: parts.text.join("\n").trim(), fromHtml: html ? htmlToText(html) : "" };
}

// An email for finding a code to show or scan (scan-codes.js): its headers, its HTML as shown (hidden copies left out) and
// its text. htmlAsText turns a piece of that HTML into lines the way the reader does.
export function emailForCodes(rawEmail) {
  const raw = String(rawEmail || "").slice(0, MAX_RAW);
  const { headers, body } = splitMessage(raw);
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n").slice(0, MAX_INPUT);
  return { headers, html: html ? withoutHidden(html) : "", plain: parts.text.join("\n").trim() };
}
export function htmlAsText(html) { return htmlToTextAll(String(html || "")); }
// The order an email is about, the day it was sent and the shop that sent it (also when the shopper forwarded it), for an
// email that is kept only for its code.
export function orderNewsOf(rawEmail) {
  const u = updateParts(rawEmail);
  return { orderRef: u.orderRef, at: u.at, subject: u.subject, retailer: shopOfUpdate(u.headers, u.text, u.html, u.parts) };
}

// A shop's till receipt that says once that it is in pounds ("GBP" over the price column) and then prints bare amounts
// ("Whole Milk 2 Pints      1.15 A"): the amounts at the end of its lines are pounds. Only for an email with no pound
// sign anywhere, and only amounts in a column (two spaces or more before them), with the VAT letter after them dropped.
const UK_POSTCODE_LINE = /^[ \t|]*(?:[\p{L} .,'’-]{2,40},?[ \t]+)?[A-Z]{1,2}\d[A-Z\d]?[ \t]?\d[A-Z]{2}[ \t|]*$/u;
// ("Wetherspoons" over the pub's own name is the chain's name, as "J D Wetherspoon" is. Round 15.)
function sameShopName(n, shop) {
  const k = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
  const a = k(n), b = k(shop);
  return Boolean(a && b && (a === b || (a.length >= 5 && (b.endsWith(a) || b.startsWith(a))) || (b.length >= 5 && (a.endsWith(b) || a.startsWith(b)))));
}
function venueOf(text, shop) {
  const t = String(text || "").slice(0, 6000);
  // (A fast-food app's receipt that names its restaurant under a label, "Restaurant Name:" over "Edwalton - Landmere Lane".
  // Round 15.)
  const named = /^[ \t|]*(?:restaurant|store|branch) name[ \t]*:[ \t|]*(?:\n[ \t|]*){0,4}(\p{Lu}[^\n|£@]{2,59}?)[ \t|]*$/imu.exec(t);
  if (named && !sameShopName(named[1].trim(), shop) && !/\d{3}/.test(named[1])) return named[1].trim();
  // ("If you have any questions about your bill", an invoice's line, is not a bill paid at a table. Round 15.)
  if (!/\btable (?:number|no\.?)\s*:?|\bthanks?\s+for\s+visiting\b|(?<!questions about )\byour\s+bill\b|\bbill\s+has\s+been\s+paid\b/i.test(t)) return null;
  // (Nor is a label, "BILLED TO", or anything in the payer's own block, "Billing and Payment" over their name and address.)
  const ok = (n) => n && n.length >= 3 && n.length <= 40 && /^\p{Lu}/u.test(n) && !/\d{3}|@|\b(?:order|receipt|bill|billed|billing|table|thank|total|paid|date|time)\b|\b(?:ship(?:ped)?|deliver(?:ed)?|sent|sold)\s+to\b/i.test(n) && !sameShopName(n, shop) ? n : null;
  // (Up to four lines above: "Billing address" over "Flat 12" over "4" over the building's name. Round 16.)
  const payerBlock = (ls, k) => [ls[k - 1], ls[k - 2], ls[k - 3], ls[k - 4]].some((x) => /\b(?:billing|billed to|bill to|payment|deliver(?:y|ed)? (?:to|address)|ship(?:ping)? (?:to|address)|invoice (?:to|address))\b/i.test(String(x || "")));
  const vis = /\bthanks?\s+for\s+visiting\s+(\p{Lu}[^\n|.!,]{1,40}?)\s+and\b/iu.exec(t.replace(/\s*\n\s*/g, " ").replace(/\s/g, " "));
  if (vis && ok(vis[1].trim())) return vis[1].trim();
  // (A name over a street, a town and a postcode: the venue's address block.)
  const ls = t.split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean).slice(0, 120);
  for (let k = 0; k + 2 < ls.length; k++) {
    if (!/^\p{Lu}[\p{L}'’&. -]{2,39}$/u.test(ls[k]) || payerBlock(ls, k)) continue;
    const streety = /\d|\b(?:road|street|st|lane|avenue|way|place|square|row|hill|green|parade|terrace|walk|close|drive|court|yard|wharf)\b/i.test(ls[k + 1]);
    // (Or any address line, "After Security, Stansted Airport", when the block ends in the venue's telephone. Round 15.)
    for (let j = k + 2; j < Math.min(ls.length, k + 6); j++) if (UK_POSTCODE_LINE.test(ls[j]) && (streety || (ls[k + 1].length <= 60 && !/£/.test(ls[k + 1]) && /^tel(?:ephone)?\b/i.test(ls[j + 1] || ""))) && ok(ls[k])) return ok(ls[k]);
  }
  return null;
}
const otherText0 = (text, plain, fromHtml) => (text === fromHtml ? plain : fromHtml) || "";
function tillPounds(t) {
  // (A restaurant's till list in an email that writes pounds elsewhere, "1 Mush Enchilada   11.95" over "1 Steak Burrito
  // 11.95": how many, the dish, and its price without the "£". Only two or more such lines one after another. Round 14.)
  if (t && /£/.test(t)) {
    const TILL = /^([ \t|]*\d{1,2}[ \t]+\p{L}[^\n£|]{1,60}?[ \t]+)(\d{1,4}\.\d{2})([ \t|]*)$/u;
    const ls = t.split("\n");
    for (let k = 0; k < ls.length; k++) {
      if (!TILL.test(ls[k])) continue;
      let e = k; while (e + 1 < ls.length && TILL.test(ls[e + 1])) e++;
      if (e > k) for (let j = k; j <= e; j++) ls[j] = ls[j].replace(TILL, "$1£$2$3");
      k = e;
    }
    t = ls.join("\n");
  }
  // (A line that is only an amount and "GBP", "58.00 GBP", in an email that writes pounds with "£" elsewhere: pounds. Round 13.)
  if (t && /£/.test(t)) t = t.replace(/^([ \t|]*)(\d[\d,]*\.\d{2})[ \t]?GBP([ \t|]*)$/gm, "$1£$2$3");
  // (A price set as three cells, "£" over "16" over "99" (Amazon's newer emails, as text): £16.99. Round 13.)
  if (t && /£[ \t|]*\n/.test(t)) t = t.replace(/£[ \t|]*\n[ \t|]*(\d{1,5})[ \t|]*\n[ \t|]*(\d{2})(?=[ \t|]*(?:\n|$))/g, "£$1.$2");
  // ("GBP 15.00" and "15.00 GBP", written that way throughout an email with no pound sign: pounds.)
  // ("GBR 23.89", a coach company's misspelt code for pounds, read the same. Round 15.)
  if (t && !/£/.test(t) && /\bGB[PR]\s?\d[\d,]*\.\d{2}\b/.test(t)) return t.replace(/\bGB[PR]\s?(\d[\d,]*\.\d{2})\b/g, "£$1").replace(/\b(\d[\d,]*\.\d{2})\s?GBP\b/g, "£$1");
  // ("137.5 GBP", "17 GBP", "0 GBP": a shop that drops the pence it doesn't need, Detale; only in an email that writes an
  // amount with one figure of pence, so that is how it writes money. Round 11.)
  const twoPlaces = (n, p) => n + "." + String(p || "").padEnd(2, "0");
  // (Only when every "GBP" follows an amount: a till receipt's "GBP" over its price column is read below.)
  if (t && !/£/.test(t) && /(?<![\d.,])\d[\d,]*\.\d[ \t]GBP\b/.test(t) && (t.match(/\bGBP\b/g) || []).length === (t.match(/\d[ \t]GBP\b/g) || []).length) return t.replace(/(?<![\d.,])(\d[\d,]*)(?:\.(\d{1,2}))?[ \t]GBP\b/g, (m, n, p) => "£" + twoPlaces(n, p));
  // ("23.00 |" with "GBP |" in the cell beside it, an invoice's table read row by row: pounds. Round 13.)
  if (t && !/£/.test(t) && /(?<![\d.,])\d[\d,]*\.\d{2}[ \t]*\|[ \t]*\n?[ \t|]*GBP[ \t]*\|?[ \t]*$/m.test(t)) t = t.replace(/(?<![\d.,])(\d[\d,]*\.\d{2})[ \t]*\|[ \t]*\n?[ \t|]*GBP[ \t]*(\|?)[ \t]*$/gm, "£$1 $2");
  if (!t || /£/.test(t) || !/(?:^|[\s|])GBP(?:$|[\s|/])/m.test(t)) return t;
  return t.replace(/(\d{1,5}\.\d{2}) ?GBP\b/g, "£$1").replace(/(\S[ \t]{2,})(-?)(\d{1,5}\.\d{2})(?:[ \t]+[A-Z])?[ \t]*$/gm, "$1$2£$3");
}

// Gmail's own note where it cut a long email short, as it shows in a forward or a copy of what it showed.
const CLIPPED = /\[\s*message clipped\s*\]/i;
// A reply quotes what it answers with "> " (and "> > " or ">> " a level deeper). When most of the email is quoted, the marks
// are taken off so its lines read as written ("> Kids Scooter Blue | Qty 1 | £49.99"). Round 4.
function unquoted(t) {
  const s = String(t || "");
  const lines = s.split("\n"), quoted = lines.filter((l) => /^[ \t]*>/.test(l)).length;
  return quoted >= 5 && quoted * 3 >= lines.filter((l) => l.trim()).length ? s.replace(/^[ \t]*(?:>[ \t]?)+/gm, "") : s;
}
// Sections of products the shop recommends ("You might also like", "Customers also bought", "Recommended for you",
// "Complete the look"): from the heading to the next money line (Subtotal, Total, Delivery) or heading of the order's own
// ("Your order", "Order summary"), or to the end. Their prices are never items.
const RECOMMEND_HEAD = /^[\s|]*(?:you (?:might|may) also (?:like|love)|customers (?:also|who bought this also) (?:bought|viewed|liked)|customers who bought [^\n|]{1,80}? also (?:bought|viewed|liked)|(?:people|others) also bought|frequently bought together|recommended (?:for you|products|items)|we (?:think|thought) you(?:'|’)?(?:ll| will| would|d) (?:like|love)|complete the look|shop the look|more (?:you(?:'|’)ll love|to explore|like this)|inspired by your (?:order|purchase|browsing)|trending now|you might be interested in|picked for you|just for you|top picks for you|buy it again|(?:sponsored|similar|related) items?|more (?:items|deals) (?:from|like)|explore more|based on your (?:recent )?(?:views|browsing|purchases))\b[^\n]{0,90}$/i;
const RECOMMEND_END = /^[\s|]*(?:sub-?\s?total|(?:order |grand )?total|delivery|shipping|postage|your order|order (?:summary|details)|items? (?:in your order|ordered)|payment|billing|vat)\b/i;
// A starting price is an offer, never a thing bought: "One-way ride from £47.10", "1 day from £103.57", "Hotels from £59".
const FROM_PRICE = /^[^\n£]{0,60}\bfrom\s*\|?\s*£\s?[\d,]+(?:\.\d{2})?\s*\|?\s*$/i;
// "Inc. £0.00 VAT" under a price is the VAT in it, never a thing.
const VAT_NOTE = /^[\s|]*inc(?:l|luding)?\.?\s*£\s?[\d,]+(?:\.\d{2})?\s*vat[\s|]*$/i;
// "Served with:" then each side as "1", "x", "Rice" on lines of their own: one line of what it came with, so the sides are
// never read as items of their own. Round 12.
function servedWith(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^[\s|]*(?:served with|comes with|with)\s*:[\s|]*$/i.test(lines[i])) { out.push(lines[i]); continue; }
    const sides = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j].replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "");
      if (!l) continue;
      const one = /^(\d{1,2})\s*[x×]\s+(\p{L}.{1,60})$/u.exec(l);
      if (one) { sides.push((one[1] === "1" ? "" : one[1] + " x ") + one[2].trim()); continue; }
      // (Blank lines between the rows say nothing.)
      const next = []; for (let k = j + 1; k < lines.length && next.length < 2; k++) { const v = lines[k].replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, ""); if (v) next.push([k, v]); }
      const n = /^\d{1,2}$/.test(l), x = next[0] && /^[x×]$/i.test(next[0][1]), name = next[1] ? next[1][1] : "";
      if (n && x && /^\p{L}.{1,60}$/u.test(name) && !/£/.test(name)) { sides.push((l === "1" ? "" : l + " x ") + name); j = next[1][0]; continue; }
      break;
    }
    if (!sides.length) { out.push(lines[i]); continue; }
    // (A meal named only by its size, "Large", is named with what it came with: "Large (with Latin Fajita Veg and Rice)".)
    let k = out.length - 1;
    while (k >= 0 && !out[k].replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")) k--;
    const sized = k >= 0 && /^[\s|]*(small|medium|regular|large|extra large|mini|half|full)(\s*\((?:incl?\.?|including)\s*vat\))?([\s|]*)$/i.exec(out[k]);
    const listed = sides.length > 1 ? sides.slice(0, -1).join(", ") + " and " + sides[sides.length - 1] : sides[0];
    if (sized) out[k] = `${sized[1]} (with ${listed})${sized[3] || ""}`;
    else out.push("Served with: " + sides.join(", ") + (/\|\s*$/.test(lines[i]) ? " |" : ""));
    i = j - 1;
  }
  return out;
}
// Under an "Item | Price" heading, a row the email's HTML split in two, its name over "| £6.66 |": one row again. Round 12.
function rowsUnderHeading(lines) {
  const h = lines.findIndex((l) => /^[\s|]*(?:items?|descriptions?|products?)\s*\|\s*(?:price|amount|total|cost)[\s|]*$/i.test(l));
  if (h < 0) return lines;
  const out = lines.slice(0, h + 1);
  for (let i = h + 1; i < lines.length; i++) {
    const name = lines[i].replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "");
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (/^\p{L}[^£|]{1,80}$/u.test(name) && /^\|\s*£\s?[\d,]+\.\d{2}[\s|]*$/.test((lines[j] || "").trim())) { out.push(name + " | " + lines[j].replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")); i = j; continue; }
    out.push(lines[i]);
  }
  return out;
}
// A gift's own message ("Personal message: Happy birthday !", "Hope you enjoy"), up to its price, and an "Item 1" heading
// over a labelled name: never things bought. Round 12.
function withoutGiftNotes(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^[\s|]*item\s+\d{1,2}[\s|]*$/i.test(lines[i])) continue;
    if (/^[\s|]*(?:personal |gift )?message\s*:/i.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && j <= i + 4 && !/£|:\s/.test(lines[j])) j++;
      i = j - 1;
      continue;
    }
    out.push(lines[i]);
  }
  return out;
}
function soleItemOverPrice(text, m, total) {
  const rows = String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  // (Only against a stated basket or subtotal: a name over the bare total may be a heading over it.)
  // (Or the total, under its fare's heading, "Fare details" then "26-30 Railcard" then "£35.00": a railcard. Round 13.)
  const fare = rows.findIndex((r) => /^fare details$/i.test(r));
  const basket = m && m.subtotal != null ? m.subtotal : fare >= 0 && total != null ? total : null;
  if (basket == null) return null;
  const hits = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const pm = /^£\s?([\d,]+\.\d{2})$/.exec(rows[i + 1]);
    if (!pm || money(pm[1]) !== basket) continue;
    if (!(m && m.subtotal != null) && i !== fare + 1) continue;
    const name = rows[i];
    if (!/^[\p{Lu}\d][\p{L}\d '’&+.,()-]{4,80}$/u.test(name) || !/\p{L}{3}/u.test(name) || /[:!?]$|\b(?:total|subtotal|basket|paid|payment|delivery|voucher|discount|vat|tax)\b/i.test(name)) continue;
    hits.push({ name, qty: 1, pricePence: basket });
  }
  return hits.length === 1 ? hits[0] : null;
}
// One thing set out as a bullet under a list's heading with no price of its own, "Medication Items:" then "- Sertraline
// 100mg tablets" and "x 28", straight over the total, "Total £9.90", and no other money line: that thing is what the total
// paid for. Never two or more (which cost what is not said). Round 15e.
function soleBulletOverTotal(text, m, total) {
  if (total == null || !m || m.fees || m.discounts || m.tips || m.subtotal != null) return null;
  const rows = String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  for (let i = 0; i < rows.length; i++) {
    if (!/^[\p{L} ]{0,40}\b(?:items?|products?|medications?|medicines?|tickets?|your order)\s?:$/iu.test(rows[i])) continue;
    const names = []; let k = i + 1, pack = null;
    while (k < rows.length && names.length < 3) {
      const b = /^[-•·*]\s*(.*)$/.exec(rows[k]);
      if (!b) break;
      const rest = b[1].replace(/^[\s|]+/, ""), name = rest || rows[k + 1] || ""; k += rest ? 1 : 2;
      if (!/^[\p{Lu}\d][^£$€:]{2,90}$/u.test(name) || !/\p{L}{3}/u.test(name)) return null;
      const q = /^[x×]\s?(\d{1,4})$/i.exec(rows[k] || "");
      if (q) { pack = rows[k].replace(/\s+/g, " "); k++; }
      names.push(name);
    }
    if (names.length !== 1) return null;
    const t = /^(?:order )?total\s*:?\s*£\s?([\d,]+\.\d{2})$/i.exec(rows[k] || "");
    if (!t || money(t[1]) !== total) return null;
    return { name: names[0], qty: 1, pricePence: total, ...(pack ? { variant: pack } : {}) };
  }
  return null;
}
// Column headings on lines of their own, "Item" over "Price", then each thing's name over its price, a plan's price perhaps
// with its period, "Plus: 1-month subscription" over "£10.99/month", up to the money lines: those things, when they come to
// what the email says (with its VAT on top when it sets that out). Round 15e.
function stackedColumns(text, m, total) {
  if (total == null) return null;
  const rows = String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  const PRICE = /^£\s?([\d,]+\.\d{2})(?:\s*(?:\/|per|a)\s*(?:month|mo|year|yr|annum|week))?$/i;
  for (let i = 0; i + 3 < rows.length; i++) {
    if (!/^(?:items?|products?|description|plan|service)$/i.test(rows[i]) || !/^(?:price|amount|cost)$/i.test(rows[i + 1])) continue;
    const items = [];
    // (A third column of words after the price's, "Delivery method chosen", holds a note for each row: passed over.)
    const third = /^[\p{L} ]{3,30}$/u.test(rows[i + 2] || "") && !/\b(?:total|qty|quantity)\b/i.test(rows[i + 2]) && !PRICE.test(rows[i + 3] || "") && PRICE.test(rows[i + 4] || "") ? 1 : 0;
    let k = i + 2 + third;
    for (; k + 1 < rows.length && items.length < 10; k += 2 + third) {
      const p = PRICE.exec(rows[k + 1]);
      if (!p || !/\p{L}{3}/u.test(rows[k]) || rows[k].length > 100 || /£|\b(?:sub-?total|total|vat|tax|discount|delivery)\b/i.test(rows[k])) break;
      if (third && (!rows[k + 2] || /£|\d\.\d{2}/.test(rows[k + 2]))) break;
      items.push({ name: rows[k], qty: 1, pricePence: money(p[1]) });
    }
    if (!items.length) return null;
    const sum = items.reduce((n, x) => n + x.pricePence, 0);
    const vat = m && m.vat != null ? m.vat : 0;
    if (sum === total || (m && m.subtotal == null && !m.fees && !m.discounts && sum + vat === total)) return items;
    return null;
  }
  return null;
}
// Column headings on lines of their own with a fee column, "Item" / "Price" / "Fee", then each line's name over its price and
// its fee, "1 x PRE 10PM ENTRY" / "£35.00" / "£3.50": the things at their price, and the fees as fees, when together they
// come to the total. Round 15e.
function stackedFeeColumns(text, total) {
  if (total == null) return null;
  const rows = String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  const AMT = /^£\s?([\d,]+\.\d{2})$/;
  for (let i = 0; i + 5 < rows.length; i++) {
    if (!/^(?:items?|tickets?|description|products?)$/i.test(rows[i]) || !/^(?:price|amount|cost)$/i.test(rows[i + 1]) || !/^(?:(?:booking|service|transaction) )?fees?$/i.test(rows[i + 2])) continue;
    const items = []; let fee = 0;
    for (let k = i + 3; k + 2 < rows.length && items.length < 10; k += 3) {
      const p = AMT.exec(rows[k + 1]), f = AMT.exec(rows[k + 2]);
      if (!p || !f || !/\p{L}{3}/u.test(rows[k]) || /£|\btotal\b/i.test(rows[k])) break;
      const q = /^(\d{1,3})\s*[x×]\s+(.{3,100})$/i.exec(rows[k]);
      items.push({ name: q ? q[2] : rows[k], qty: q ? Number(q[1]) : 1, pricePence: money(p[1]), lineTotal: true });
      fee += money(f[1]);
    }
    if (!items.length) return null;
    return items.reduce((n, x) => n + x.pricePence, 0) + fee === total ? { items, fee, label: rows[i + 2] } : null;
  }
  return null;
}
// A booking set out as its name, its reference and who it is for, then what it cost, "Standard Bowling", "Reservation ID:
// 551204", "2 x Adults", "2 x Games", "Cost: £29.80", that cost the whole total: the one thing booked. Round 15e.
const WHO_FOR_LINE = /^\d{1,3}\s*[x×]\s*(?:adults?|child(?:ren)?|kids?|games?|people|persons?|guests?|players?|seniors?|students?|infants?)$/i;
function bookingOverCost(text, total) {
  if (total == null) return null;
  const rows = String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  for (let i = 1; i < rows.length; i++) {
    const c = /^(?:cost|price)\s*:\s*£\s?([\d,]+\.\d{2})$/i.exec(rows[i]);
    if (!c || money(c[1]) !== total) continue;
    const who = []; let k = i - 1;
    for (; k >= 0 && i - k <= 6; k--) {
      if (WHO_FOR_LINE.test(rows[k])) { who.unshift(rows[k]); continue; }
      if (/^(?:reservation|booking) (?:id|reference|ref\.?|number|no\.?)\s*:\s*\S+$/i.test(rows[k])) continue;
      break;
    }
    if (!who.length || k < 0 || !/^\p{Lu}[\p{L}\d '’&+-]{2,60}$/u.test(rows[k]) || /\b(?:total|order|booking|time|date)\b/i.test(rows[k])) return null;
    return { name: rows[k], qty: 1, pricePence: total, variant: who.join(", ") };
  }
  return null;
}
// One thing over its price, then the VAT over its amount, then the total's label over the total, each on a line of its own,
// "Photo Tidy Pro - 1 seat" / "£24.99" / "VAT (20%)" / "£5.00" / "Amount Paid" / "£29.99": the thing at its
// price before VAT, when it and the VAT come to the total. Round 23.
const ONE_AMT = /^£\s?(\d{1,3}(?:,\d{3})*|\d{1,7})\.(\d{2})$/;
function stackedTaxedOne(text, total) {
  if (total == null) return null;
  const rows = String(text || "").slice(0, 60000).split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  const amt = (r) => { const m = ONE_AMT.exec(r || ""); return m ? Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]) : null; };
  for (let i = 0; i + 5 < rows.length; i++) {
    if (!/^(?:vat|tax)(?: \(\d{1,2}(?:\.\d)?%\))?$/i.test(rows[i + 2]) || !/^(?:total|amount paid|total paid|order total|grand total)$/i.test(rows[i + 4])) continue;
    const p = amt(rows[i + 1]), v = amt(rows[i + 3]), t = amt(rows[i + 5]);
    if (p == null || v == null || t !== total || p + v !== total || p <= 0) continue;
    const name = rows[i];
    if (name.length < 3 || name.length > 100 || !/\p{L}{3}/u.test(name) || /£|\b(?:sub-?total|total|amount|vat|tax|discount|delivery|shipping|payment|paid|receipt|date|method)\b/i.test(name)) continue;
    return { name, qty: 1, pricePence: p };
  }
  return null;
}
// An invoice's columns set out one under another, "Quantity" / "Item ID" / "Description" / … / "Unit Price" / "Amount", then
// the row's values the same way with the prices written without "£", "1" / "480012345" / "Car" / … / "23.00" / "23.00" /
// "GBP": the one line, when its amount is the whole total. Round 15e.
function stackedInvoiceRow(text, total) {
  if (total == null) return null;
  const rows = String(text || "").split("\n").map((x) => x.replace(/^[\s|\u200e\u200f]+|[\s|\u200e\u200f]+$/g, "")).filter(Boolean);
  for (let i = 0; i + 4 < rows.length; i++) {
    if (!/^(?:quantity|qty)$/i.test(rows[i])) continue;
    const head = rows.slice(i, i + 8);
    const d = head.findIndex((h) => /^description$/i.test(h)), u = head.findIndex((h) => /^unit price$/i.test(h)), a = head.findIndex((h) => /^(?:amount|total)$/i.test(h));
    if (d < 0 || u < 0 || a < 0 || !(d < u && u < a)) return null;
    let k = i + a + 1;
    if (!/^\d{1,3}$/.test(rows[k] || "")) return null;
    const qty = Number(rows[k]);
    let name = null;
    for (let j = k + 1; j < Math.min(rows.length, k + 4); j++) if (/\p{L}{3}/u.test(rows[j]) && !/^\d+$/.test(rows[j])) { name = rows[j]; k = j; break; }
    if (!name || name.length > 80) return null;
    for (let j = k + 1; j + 1 < Math.min(rows.length, k + 40); j++) {
      const p1 = /^£?\s?(\d[\d,]*\.\d{2})$/.exec(rows[j]), p2 = /^£?\s?(\d[\d,]*\.\d{2})$/.exec(rows[j + 1]);
      if (!p1 || !p2) continue;
      const unit = money(p1[1]), line = money(p2[1]);
      return unit * qty === line && line === total ? { name, qty, pricePence: unit } : null;
    }
    return null;
  }
  return null;
}
// What a ride or a service charged set out as each charge's name over its amount, "Starting fee" / "£0.99", "Riding –
// £0.21/min" / "£2.31" (or "Base fare (3 min)" / "3.48 zł"), straight up to the total's line: those charges are what was
// bought, when they come to the total. Round 15e.
const PAIR_AMOUNT = /^(?:(?:£|€|US\$|\$)\s?(\d{1,6}(?:,\d{3})*)[.,](\d{2})|(\d{1,6}(?:[ .]\d{3})*)[.,](\d{2})\s?(?:zł|zl|pln|€|eur|kr|sek|nok|dkk|chf|kč|czk|ft|huf))$/i;
function chargePairs(text, total) {
  if (total == null) return null;
  const rows = String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  const amt = (r) => { const m = PAIR_AMOUNT.exec(r || ""); return m ? Number(String(m[1] || m[3]).replace(/[ .,]/g, "")) * 100 + Number(m[2] || m[4]) : null; };
  for (let i = 0; i + 3 < rows.length; i++) {
    const out = []; let k = i;
    while (k + 1 < rows.length && out.length < 8) {
      const a = amt(rows[k + 1]);
      if (a == null || amt(rows[k]) != null || !/\p{L}{3}/u.test(rows[k]) || rows[k].length > 60 || /\b(?:total|subtotal|vat|tax|paid|payment|balance|discount|credit)\b/i.test(rows[k])) break;
      // (A rate written after the charge's name, "Riding – £0.21/min", is what it is, not its name.)
      const rate = /^(.{3,40}?)\s*[–—-]\s*((?:£|€|\$)\s?\d[\d.,]*\s?\/\s?\p{L}{1,6}|\d[\d.,]*\s?(?:zł|€|kr)\s?\/\s?\p{L}{1,6})$/u.exec(rows[k]);
      out.push({ name: rate ? rate[1] : rows[k], ...(rate ? { variant: rate[2] } : {}), qty: 1, pricePence: a }); k += 2;
    }
    if (out.length >= 2 && /^total\b/i.test(rows[k] || "")) return out.reduce((n, x) => n + x.pricePence, 0) === total ? out : null;
    if (out.length) i = k - 1;
  }
  return null;
}
// A ride's receipt that lists no charges, only its "Trip Details", "Vehicle: Scooter", "Trip duration: 8min 39sec", "Trip
// distance: 1.53km", and the one amount: the trip itself is what was paid for. Round 15e.
function tripOfVehicle(text, total) {
  if (total == null) return null;
  const v = /^[ \t|]*vehicle(?: type)?\s*:\s*(\p{L}[\p{L} -]{1,20}?)[ \t|]*$/imu.exec(text), d = /^[ \t|]*trip duration\s*:\s*([^\n|]{2,20}?)[ \t|]*$/im.exec(text);
  if (!v || !d || !/\btrip\b/i.test(String(text).slice(0, 3000))) return null;
  const km = /^[ \t|]*trip distance\s*:\s*([\d.,]+\s?(?:km|mi|miles?))[ \t|]*$/im.exec(text);
  return { name: v[1].trim() + " trip", qty: 1, pricePence: total, variant: [d[1].trim(), km ? km[1] : null].filter(Boolean).join(", ") };
}
// A plain-text name wrapped onto two lines ("Duchess Dolby Atmos 5.1.2 Cinematic Surround Sound", then "Ottoman Storage TV
// Bed Frame × 1"): one name again, when it starts after a blank line and its second line ends with how many. Round 12.
function unwrapNames(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i], b = lines[i + 1];
    if (b && (i === 0 || !lines[i - 1].trim()) && /^\p{Lu}[^£|:]{10,90}$/u.test(a.trim()) && /^\p{L}[^£|]{2,80}\s[x×]\s?\d{1,3}$/u.test(b.trim()) && a.length >= 40) { out.push(a.trim() + " " + b.trim()); i++; continue; }
    out.push(a);
  }
  return out;
}
// (A table whose headings and cells each sit on lines of their own, "Qty", "Product", "Unit Price", "Total", "Saved", then
// "1", "Chicken Thigh Fillets 500G", "£4.00", "£3.60", "£0.40" for each row: how many, the name and the line's
// total, never the unit price or what was saved. A section's name between rows ("Fridge", "Freezer") and a row's notes
// ("Substitutions: On", "£2.75 Clubcard Price") are not things. Round 16.)
const SPLIT_HEAD = { qty: /^(?:qty\.?|quantity)$/i, name: /^(?:product|item|description|product name)$/i, unit: /^(?:unit price|price each|price)$/i, line: /^(?:total|line total|item total|amount)$/i, saved: /^(?:saved?|saving|savings|you save|discount)$/i };
function splitColumns(t) {
  const cells = String(t || "").split("\n").flatMap((x) => x.split("|")).map((x) => x.trim()).filter(Boolean).slice(0, 4000);
  const roleOf = (c) => Object.keys(SPLIT_HEAD).find((r) => SPLIT_HEAD[r].test(c)) || null;
  for (let h = 0; h < cells.length; h++) {
    const roles = [];
    for (let k = h; k < cells.length && roles.length < 6; k++) { const r = roleOf(cells[k]); if (!r || roles.includes(r)) break; roles.push(r); }
    if (roles.length < 4 || !roles.includes("name") || !roles.includes("line") || !roles.includes("qty") || !roles.includes("unit")) continue;
    const out = [];
    const MONEYC = /^£\s?(\d{1,4}(?:,\d{3})*\.\d{2})$/;
    for (let k = h + roles.length; k < cells.length && out.length < 80;) {
      const row = cells.slice(k, k + roles.length);
      const ok = row.length === roles.length && roles.every((r, i) => r === "qty" ? /^\d{1,3}$/.test(row[i]) : r === "name" ? /\p{L}/u.test(row[i]) && !MONEYC.test(row[i]) : MONEYC.test(row[i]));
      if (ok) {
        const g = (r) => row[roles.indexOf(r)];
        out.push({ name: g("name"), qty: Number(g("qty")), pricePence: money(MONEYC.exec(g("line"))[1]), lineTotal: true });
        k += roles.length; continue;
      }
      // (Between rows: a section's name, a row's note, a choice: passed over. The list ends at the money under it.)
      if (/^(?:sub-?\s?total|total|order summary|basket|quick summary|delivery|payment)\b/i.test(cells[k]) && out.length) break;
      k++;
      if (out.length && k - h > 4000) break;
    }
    if (out.length >= 2) return out;
  }
  return [];
}
const DATE_ROW = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,? )?(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}|\d{1,2}(?:st|nd|rd|th)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,? \d{4})$/i;
function namePricePairs(t) {
  const rows = String(t || "").split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean).slice(0, 2000);
  let best = [], cur = [];
  for (let k = 0; k < rows.length; k++) {
    const nm = /^\p{L}[^£$€|\n]{1,80}$/u.test(rows[k]) && !/^(?:sub-?\s?total|total|vat|delivery|service|tip|payment|discount|order|date|address)\b/i.test(rows[k]) && !DATE_ROW.test(rows[k]);
    const pr = rows[k + 1] && /^£\s?(\d{1,4}(?:,\d{3})*\.\d{2})$/.exec(rows[k + 1]);
    if (nm && pr) { cur.push({ name: rows[k], qty: 1, pricePence: money(pr[1]), lineTotal: true }); k++; continue; }
    if (cur.length > best.length) best = cur;
    cur = [];
  }
  return cur.length > best.length ? cur : best;
}
function withoutRecommendations(t) {
  const lines = unwrapNames(withoutGiftNotes(rowsUnderHeading(servedWith(String(t || "").split("\n").filter((l) => !FROM_PRICE.test(l) && !VAT_NOTE.test(l))))));
  if (!lines.some((l) => RECOMMEND_HEAD.test(l))) return lines.join("\n");
  const out = [];
  for (let i = 0, skip = false; i < lines.length; i++) {
    if (RECOMMEND_HEAD.test(lines[i])) { skip = true; continue; }
    if (skip && RECOMMEND_END.test(lines[i])) skip = false;
    if (!skip) out.push(lines[i]);
  }
  return out.join("\n");
}

function moreOrders(text, firstRef) {
  const lines = String(text || "").split("\n");
  const heads = [];
  lines.forEach((l, i) => { const m = /^[\s|]*order\s*(?:#|number\s*:?|no\.?\s*:?)\s*([A-Z0-9][A-Z0-9-]{6,30})[\s|]*$/i.exec(l); if (m && /\d{5}/.test(m[1])) heads.push({ i, ref: m[1] }); });
  const refs = [...new Set(heads.map((h) => h.ref.toUpperCase()))];
  if (refs.length < 2 || refs.length > 6 || !firstRef || refs[0] !== String(firstRef).toUpperCase()) return [];
  const firsts = refs.map((r) => heads.find((h) => h.ref.toUpperCase() === r));
  const out = [];
  for (let k = 1; k < firsts.length; k++) {
    const seg = lines.slice(firsts[k].i, k + 1 < firsts.length ? firsts[k + 1].i : lines.length).join("\n");
    const tot = /^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*(?:order )?total\s*:?[\s|]*£\s?([\d,]+\.\d{2})[\s|]*$/im.exec(seg);
    if (!tot) return [];
    const totalPence = money(tot[1]);
    const items = cleanItems(readItems(seg.slice(0, tot.index + tot[0].length)));
    const check = checkItems(items, moneyOf(seg), totalPence);
    // (Only when this order's own items add up to its own total: a second order number elsewhere in an email is not proof.)
    if (!items.length || !check || check.complete !== true) return [];
    out.push({ orderRef: firsts[k].ref, totalPence, currency: "GBP", items, itemsCheck: { ...check, ...namesCheck(items, {}) } });
  }
  return out;
}

// Partner offers listed as gifts with the order, each over its own "Quantity" and "Price £1.00" (see the gifts above): their
// names and worth, in the email's order, never one already read as an item. Round 18.
function offerGifts(body, items) {
  const ls = String(body || "").split("\n").slice(0, 4000).map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  const have = new Set((items || []).map((i) => String(i.name || "").trim().toLowerCase()));
  const out = [];
  for (let k = 0; k < ls.length && out.length < 8; k++) {
    const nm = ls[k];
    if (nm.length > 90 || /£/.test(nm) || !isOfferLine(nm) || have.has(nm.toLowerCase())) continue;
    for (let j = k + 1; j <= k + 6 && j < ls.length; j++) {
      const m = /^£\s?(\d{1,4}\.\d{2})$/.exec(ls[j]);
      if (m) { out.push({ name: nm, pricePence: Math.round(Number(m[1]) * 100) }); break; }
      if (!/^(?:qty|quantity|price|\d{1,2})\s*:?$/i.test(ls[j])) break;
    }
  }
  return out;
}
export function parseReceiptEmail(rawEmail, opts = {}) {
  const raw = String(rawEmail || "").slice(0, MAX_RAW);
  const { headers, body } = splitMessage(raw);
  const parts = { text: [], html: [], attached: [], attachedText: [] };
  collectParts(headers, body, parts);
  if (!parts.text.length && !parts.html.length && parts.attachedText.length) parts.text.push(...parts.attachedText);
  const html = parts.html.join("\n").slice(0, MAX_INPUT);
  // (A sender's template word it never filled in, Apple's "iCloud: @@totalCurrentPaidAndFreeStorageWithUnit@@ Storage
  // Plan": left out, never read as something it isn't. Round 15.)
  // ("iCloud+ with @@…@@ of storage": the words around it go with it, "iCloud+".)
  // (Only where there is one, and with one space before "with", so a long run of spaces is never searched again and again.)
  const unfilled = (t) => { t = String(t || ""); return t.includes("@@") ? t.replace(/(?:[ \t](?:with|for|of))?[ \t]?@@[A-Za-z]{3,80}@@(?:[ \t]of[ \t][A-Za-z][a-z]{2,11})?/g, "") : t; };
  const plain = tillPounds(unquoted(fullWidthPounds(linksOverLines(plainAsWritten(unfilled(parts.text.join("\n").trim()))))));
  const fromHtml = html ? tillPounds(unquoted(fullWidthPounds(htmlToText(unfilled(html))))) : "";
  const sender = retailerFromFrom(headers.from);
  const subject = headers.subject || null;
  // The sender's display name exactly as written (retailerFromFrom drops generic ones such as "Orders").
  const fromName = ((headers.from || "").match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || null;
  // (A text part that only says to look at the HTML one, "This email needs an HTML-capable email client", is not the
  // email: the HTML is read when only it looks like a receipt. Round 4.)
  let text = (plain && !(fromHtml && !receiptSignals(subject, plain).bodyHit && receiptSignals(subject, fromHtml).bodyHit) ? plain : fromHtml || plain).trim();

  const sig = receiptSignals(subject, text);
  // (A total in złoty, pesos or another currency Relay keeps as written, "Total (incl. VAT) | 34.53 zł": the body shows a
  // total. Round 13.)
  if (sig.subjectHit && !sig.bodyHit && foreignTotal(text)) sig.bodyHit = true;
  // (Tickets sent as the order, "Your … Festival Tickets - Order Number [#160104]", each ticket with its number and price:
  // the purchase itself. Round 12.)
  const ticketOrder = /\btickets?\b[^!?\n]{0,30}\border (?:number|no\.?|#)\s*:?\s*\[?#?\s*\d{4,}/i.test(String(subject || "")) && /\bticket (?:number|no\.?|id)\s*:/i.test(text) && /\bprice\s*:\s*£\s?\d/i.test(text);
  if (ticketOrder) { sig.subjectHit = true; sig.bodyHit = true; }
  // (PayPal's "You've authorised a payment to Harbour Hardware Ltd": "You authorised a payment of £64.20 GBP to Harbour
  // Hardware Ltd (orders@…)", "This purchase will appear as a pending transaction until Harbour Hardware Ltd processes your
  // order", with the seller and what was bought. The purchase, from that seller, when the seller sends nothing of its own;
  // the seller's own email for it still leads (gmail.js mergeOrderEmails). Never PayPal's short "You've authorised £12.40 GBP
  // to UBER…", a hold towards something the shop's own email is the purchase of. Round 24.)
  const ppAuthorised = /(^|\.)paypal\.[a-z.]+$/i.test(sender?.domain || "") && /\byou authori[sz]ed a payment of (?:£|€|\$)\s?\d{1,3}(?:,\d{3})*\.\d{2}\b/i.test(text.slice(0, 4000)) &&
    /\bwill appear as a pending transaction until\b/i.test(text.slice(0, 6000));
  if (ppAuthorised) { sig.subjectHit = true; sig.bodyHit = true; }
  // (A booking confirmed with its reference, "Your booking is confirmed" and "Booking reference: LOV1242…", whose price is in
  // the booking document it links to: still the purchase, with no total made up. Round 12.)
  if (/\b(?:booking|reservation|holiday|trip) (?:is |has been )?confirmed\b/i.test(String(subject || "")) && /\bbooking (?:reference|ref\.?|number)\s*:?\s*[A-Z0-9]{6,14}\b/i.test(text.slice(0, 2000))) { sig.subjectHit = true; sig.bodyHit = true; }
  // A receipt that is only in its attachment ("Your receipt is attached", a PDF or a photo of the till receipt): it is
  // still the shop's receipt, read for what the email itself says (the shop, the day, a total if written), and it says
  // that the details are in the attachment. Nothing is read from the attachment, so nothing is made up.
  const attachedDoc = (parts.attached || []).find((a) => a.kind === "pdf" || a.kind === "image");
  const saysAttached = Boolean(attachedDoc) && /\b(?:receipt|invoice|order|bill)\b[^.\n]{0,60}\b(?:is |are )?attached\b|\battached\b[^.\n]{0,40}\b(?:receipt|invoice)s?\b|\b(?:receipt|invoice)\b[^.\n]{0,30}\bas an? (?:pdf|attachment)\b|\battached is an? pdf\b[^.\n]{0,60}\b(?:details|booking|order)\b|\byour documents? (?:are |is )?attached\b|\b(?:all of )?your documents attached\b/i.test(text.slice(0, 4000));
  if (saysAttached) sig.bodyHit = true;
  // A flight booked with an airline or a travel site (flight-booking.js): its confirmation is the receipt even when it
  // doesn't say "order" ("Your booking is confirmed", "Ryanair Travel Itinerary", "Total paid GBP 245.98"). A check-in
  // reminder, a boarding pass or a delay notice about it is not a purchase.
  // (Forwarded by the shopper: the travel site or airline that first sent it. Round 24.)
  const fwdTravel = PERSONAL_MAIL.test(sender?.domain || "") ? forwardedSender(text, { subject, personal: (d) => PERSONAL_MAIL.test(d) }) : null;
  const flightArgs = { subject: fwdTravel && fwdTravel.domain ? String(subject || "").replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, "") : subject, senderDomain: (fwdTravel && fwdTravel.domain) || sender?.domain || null,
    fromName: (fwdTravel && fwdTravel.domain && fwdTravel.name) || fromName, refDate: headers.date ? new Date(headers.date) : null };
  const flight = flightBooking({ ...flightArgs, text: plain || fromHtml }) || (plain && fromHtml ? flightBooking({ ...flightArgs, text: fromHtml }) : null);
  if (flight && flight.kind === "notice" && !opts.lenient) return { ok: false, reason: "travel_notice", source: "shopper_email" };
  // One instalment of something already bought with a pay-later company ("Payment received for lululemon", "Your next
  // payment of £27.77 is due on …"): the purchase is the shop's own order email, so this is never a second one (coverage
  // round: a real inbox had an instalment read as a purchase from "lululemon was successful").
  const payLaterFrom = PAY_LATER_SENDER.test(sender?.domain || "") ||
    PAY_LATER_SENDER.test((forwardedSender(text, { subject, personal: (d) => PERSONAL_MAIL.test(d) }) || {}).domain || "");
  if (!opts.lenient && payLaterFrom && !/\b(?:your purchase|purchase (?:with|at|from)|thanks? (?:you )?for (?:choosing|shopping)|order)\b/i.test(subject || "") &&
    INSTALMENT.test(subject + "\n" + text.slice(0, 3000))) {
    return { ok: false, reason: "instalment", source: "shopper_email" };
  }
  const isFlight = Boolean(flight && flight.kind === "booking");
  // Uber's three kinds of email (receipt-senders.js, round 10): a changed total for an earlier Eats order is money back on
  // that order (parseOrderAdjustmentEmail), never a purchase; an Eats receipt and a ride are receipts.
  // (Forwarded from the shopper's own mailbox, the original sender says it is Uber.)
  const fwdFrom = PERSONAL_MAIL.test(sender?.domain || "") ? forwardedSender(text, { subject, personal: (d) => PERSONAL_MAIL.test(d) }) : null;
  const uber = uberEmail((fwdFrom && fwdFrom.domain) || sender?.domain, String(subject || "").replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, ""), text);
  if (uber && uber.kind === "adjusted") return { ok: false, reason: "order_adjusted", source: "shopper_email" };
  if (uber && uber.undelivered && !opts.lenient) return { ok: false, reason: "order_not_completed", source: "shopper_email" };
  if (uber) { sig.subjectHit = true; sig.bodyHit = sig.bodyHit || /\btotal\b/i.test(text); }
  // (A shop's receipt sent by an e-receipt or ordering platform, Ecrebo, yReceipts, me&u, OrderYOYO, Viva Wallet: the shop's
  // purchase, even when the receipt itself is a picture or behind a link and the email says no amount. Round 20.)
  const ePlat = eReceiptPlatform((fwdFrom && fwdFrom.domain) || sender?.domain, subject, fwdFrom ? fwdFrom.name : fromName, text);
  if (ePlat && ePlat.shop) { sig.subjectHit = true; sig.bodyHit = true; }
  // (A subscription whose first payment is taken the day the email is sent, "Thanks for subscribing to StreamBox Plus", "You'll
  // be charged £7.49/1 month(s) starting on 02/03/2026": bought that day. Round 20.)
  const sentDay = headers.date && !Number.isNaN(new Date(headers.date).getTime()) ? new Date(headers.date).toISOString().slice(0, 10) : null;
  const subStart = subscriptionStarted(subject, text, sentDay);
  if (subStart) { sig.subjectHit = true; sig.bodyHit = true; }
  // (A pre-order thanked for by its name, "Your Harbour Light Lager order", "Thanks for your Harbour Light Lager
  // order.", "We are busy getting your pre-order ready": bought, though the email gives no price. Nothing is made up for
  // it. Round 20.)
  const preName = /^\s*(?:(?:fwd?|fw)\s*:\s*)*your ([\p{L}\d][\p{L}\d '’&.-]{1,58}?) (?:pre-?)?order\s*$/iu.exec(String(subject || ""));
  const preOrder = preName && !/\b(?:next|last|recent|first|latest|new)\s*$/i.test(preName[1]) && text.slice(0, 1500).toLowerCase().includes(("thanks for your " + preName[1] + " ").toLowerCase()) && /\bpre-?orders?\b/i.test(text.slice(0, 3000)) ? preName[1].trim() : null;
  if (preOrder) { sig.subjectHit = true; sig.bodyHit = true; }
  // A supermarket's delivery-day email for an order already confirmed ("Your order is ready for today", "Payment received").
  const dayOf = groceryDayOf(text);
  if (dayOf) { sig.subjectHit = true; sig.bodyHit = true; }
  // (A changed order, "We got your changes - 1350718495", with the whole new list: the order as it now is. Round 12.)
  const amended = !dayOf && orderAmended(subject, text);
  if (amended && sig.bodyHit) sig.subjectHit = true;
  // When the shopper picked this very email themselves, one signal is enough (the fields are still checked below).
  if (!isFlight && !(opts.lenient ? sig.subjectHit || sig.bodyHit : sig.subjectHit && sig.bodyHit)) {
    return { ok: false, reason: "not_an_order_confirmation", source: "shopper_email", signals: { subject: sig.subjectHit, body: sig.bodyHit, textLength: text.length } };
  }

  // A refund, a cancellation or a price adjustment is never a new purchase (a refund is read by parseReturnUpdateEmail, and
  // attaches to the order it belongs to). Said in the subject, or at the top of the email ("Your order has been cancelled").
  if (NOT_A_PURCHASE_SUBJECT.test(String(subject || "").replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, "")) || NOT_A_PURCHASE_TOP.test(text.slice(0, 1200).replace(/\s+/g, " ")) ||
      // (Amazon's "we have processed your refund for £2.49 for the above-referenced order" under a subject naming the order. Round 15.)
      /\bwe (?:have|(?:'|’)ve) processed your refund (?:for|of) £\s?\d/i.test(text.slice(0, 1200).replace(/\s+/g, " ")) ||
      // (Apple's credit note: a sale undone, read as the order's refund. Round 15.)
      appleCreditNote(headers, text)) {
    return { ok: false, reason: "refund_or_cancellation", source: "shopper_email" };
  }
  // (A collection that didn't happen, "Shopname - we were unable to collect your order", "we tried to collect your item(s) from
  // you today but were unable to": news about taking something back, never a purchase. Round 20.)
  if (/\b(?:were|was) unable to collect your (?:order|items?|item\(s\)|parcel|return)\b/i.test(String(subject || "")) ||
      /\bwe tried to collect your (?:order|items?|item\(s\)|parcel|return)\b[^.\n]{0,40}\b(?:were|was) unable to\b/i.test(text.slice(0, 2000).replace(/\s+/g, " "))) {
    return { ok: false, reason: "collection_failed", source: "shopper_email" };
  }
  // (A table booked at a restaurant, "Table for 2 on Friday, 29 July 2022 at 17:30", with the menu it was booked for and its
  // price: nothing is paid until the meal unless the email says it was, "Paid", "Deposit", "Charged", "Prepaid". It is read
  // (its number, its price) and marked, and the inbox scan never makes it a purchase: the bill is. Round 14.)
  const tableBooking = /\btable for \d{1,2}\b|\byour table (?:is|has been) (?:booked|reserved|confirmed)\b/i.test(text.slice(0, 4000)) &&
    !/\b(?:paid|prepaid|pre-paid|deposit|charged|payment (?:received|taken|of)|amount taken|receipt)\b/i.test(String(subject || "") + "\n" + text.slice(0, 12000));
  // (A parcel's progress, "Your Myprotein order is with Royal Mail", "Our courier … has received your order", "… is out for
  // delivery", "… has been delivered": the order's journey, never a purchase of its own. Round 14.)
  if (!opts.lenient && (CARRIER_PROGRESS.test(String(subject || "").replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, "")) || /\bour courier\b[^.\n]{0,40}\bhas (?:received|collected) your (?:order|parcel)\b/i.test(text.slice(0, 1500)))) {
    return { ok: false, reason: "delivery_update", source: "shopper_email" };
  }
  // A shop owning up that an earlier "order confirmation" was a marketing email ("There was no order. Nothing has been
  // charged"): nothing was bought (round 10).
  if (NO_ORDER.test(String(subject || "") + "\n" + text.slice(0, 3000).replace(/\s+/g, " "))) return { ok: false, reason: "no_order", source: "shopper_email" };
  // (A shop's reply to the shopper's own message, "RE: Order #1806 confirmed", "RE: Thank you for your order: …": support
  // writing back, quoting the order. The order's own email is the purchase, never this. Round 11.)
  if (!opts.lenient && /^\s*re\s*:/i.test(String(subject || "")) && (headers["in-reply-to"] || headers.references)) return { ok: false, reason: "reply", source: "shopper_email" };
  // (A person writing back from their own mailbox to another person's, "Re: Thanks for your order!" between two personal
  // addresses, quoting the order: a conversation about a purchase, never the purchase, even with no reply headers. Sent on
  // to Relay's own address it is still read, as the shopper meant. Round 14.)
  const toDomain = ((String(headers.to || "").match(/@([^>\s,;]+)/) || [])[1] || "").toLowerCase();
  if (!opts.lenient && /^\s*re\s*:/i.test(String(subject || "")) && PERSONAL_MAIL.test(sender?.domain || "") && PERSONAL_MAIL.test(toDomain)) return { ok: false, reason: "reply", source: "shopper_email" };
  // (Someone else's purchase they forwarded to the shopper: forwarded from a personal address by a person whose name is not
  // the shopper's, and it was first sent to that person ("To: their address" in what they forwarded). Their booking, not the
  // shopper's. Round 11.)
  if (!opts.lenient && /^\s*(?:fwd?|fw)\s*:/i.test(String(subject || "")) && PERSONAL_MAIL.test(sender?.domain || "")) {
    const addr = (h) => ((String(h || "").match(/<([^>]+)>/) || [])[1] || String(h || "").trim()).toLowerCase();
    const nameOf = (h) => (String(h || "").match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || "";
    // (Gmail's two spellings of one address, "@gmail.com" and "@googlemail.com", are the same person's. Round 15.)
    const same = (a) => a.replace(/@googlemail\.com$/, "@gmail.com");
    // (A "name" that is only the address again, "\"sam@gmail.com\" <sam@gmail.com>", names nobody. Round 17.)
    const realName = (n) => (/@/.test(n) ? "" : n);
    const fromA = same(addr(headers.from)), toName = realName(nameOf(headers.to)), fromName0 = realName(nameOf(headers.from));
    const innerTo = /^[>\s*]*to:\s*(.+)$/im.exec(text.slice(0, 4000));
    const words = (n) => new Set(n.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 3));
    // (Two people of one family share a surname: "Jo Taylor" forwarding to "Sam Taylor" is still someone else. The same
    // first name, or an initial for it, is the same person. Round 16.)
    const firstW = (n) => (String(n || "").trim().split(/\s+/)[0] || "").toLowerCase().replace(/[^\p{L}]/gu, "");
    const f1 = firstW(fromName0), t1 = firstW(toName);
    const shared = f1 && t1 && f1.length > 1 && t1.length > 1 ? f1 === t1 : [...words(fromName0)].some((w) => words(toName).has(w));
    if (fromA && innerTo && same(innerTo[1].toLowerCase()).includes(fromA) && toName && fromName0 && !shared) return { ok: false, reason: "someone_elses_purchase", source: "shopper_email" };
  }
  // (Or the forwarded email greets someone else by name, "Hi Jo," and was first sent to their address, not the shopper's,
  // "To: jo-…@…": their purchase, even when the two share a family name, or the shopper forwarded it from another inbox.
  // Round 16.)
  if (!opts.lenient) {
    const top = text.slice(0, 5000);
    // (Each forward's header block, the shopper's own forward and the one inside it.)
    const fwdBlocks = [...top.matchAll(/^[>\s*]*from:[^\n]{3,200}\n(?:[>\s*]*(?:sent|date):[^\n]{3,120}\n)[>\s*]*to:\s*([^\n]{3,200})$/gim)];
    const toHeader = String(headers.to || ""), toAddr = ((toHeader.match(/<([^>]+)>/) || [])[1] || toHeader).trim().toLowerCase();
    const toFirst = ((toHeader.match(/^\s*"?([^"<@]+?)"?\s*</) || [])[1] || "").trim().split(/\s+/)[0].toLowerCase();
    // (Or no greeting, but the order's own "Name: JO TAYLOR" in its address block.)
    const hi = /^[>\s*]*(?:hi|hello|hey|dear)\s+(\p{Lu}[\p{Ll}'’-]{1,20})\s*[,!]/imu.exec(top) || /^[>\s*|]*(?:name|customer name|full name)\s*:\s*(\p{Lu}[\p{L}'’-]{2,20})\s+\p{Lu}[\p{L}'’-]{1,30}\s*$/imu.exec(text.slice(0, 8000));
    for (const fwdBlock of hi && /@/.test(toAddr) ? fwdBlocks : []) {
      const innerAddr = ((fwdBlock[1].match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i) || [])[0] || "").toLowerCase();
      const g = hi[1].toLowerCase(), local = (a) => String(a || "").split("@")[0].replace(/[^a-z]/g, "");
      const fromH = String(headers.from || ""), fromAddr = ((fromH.match(/<([^>]+)>/) || [])[1] || fromH).trim().toLowerCase();
      const fromFirst = ((fromH.match(/^\s*"?([^"<@]+?)"?\s*</) || [])[1] || "").trim().split(/\s+/)[0].toLowerCase();
      const isThem = (first, addr) => (first.length >= 2 && !/\d/.test(first) ? g === first : local(addr).includes(g.slice(0, 3)));
      if (innerAddr && innerAddr !== toAddr && innerAddr !== fromAddr && !isThem(toFirst, toAddr) && !isThem(fromFirst, fromAddr) && innerAddr.split("@")[0].replace(/[^a-z]/g, "").includes(g.slice(0, 3))) return { ok: false, reason: "someone_elses_purchase", source: "shopper_email" };
    }
  }
  // A notice that the payment didn't go through is not a receipt ("we couldn't charge your account for your order").
  if (PAYMENT_PROBLEM.test(subject || "") || PAYMENT_PROBLEM.test(text.slice(0, 1500))) {
    return { ok: false, reason: "payment_problem", source: "shopper_email" };
  }
  // (Things someone else bought and sent to the shopper, Apple's "Youxian Huang has sent you the following items.", "… has
  // sent you a gift": their purchase, not the shopper's. Round 15.)
  if (/\b\p{Lu}[\p{L}'’-]{1,30}(?: \p{Lu}[\p{L}'’-]{1,30}){0,3} (?:has|have) sent you (?:the following items?|a gift|an? e-?gift|something)\b/u.test(text.slice(0, 3000))) return { ok: false, reason: "gift_received", source: "shopper_email" };
  // (A hotel's "Online Check In Confirmation", "You completed your online check-in service", with the room and what was paid
  // for it: news about a stay booked and paid for elsewhere (the booking's own email is the purchase), never a second one.
  // Round 15.)
  if (!opts.lenient && (/\b(?:online\s+)?check[- ]?in\s+(?:confirmation|confirmed|completed?)\b/i.test(String(subject || "")) ||
    /\byou(?:(?:'|’)ve| have)? (?:successfully )?completed (?:your|the) (?:online )?check[- ]?in\b/i.test(text.slice(0, 3000)))) return { ok: false, reason: "check_in", source: "shopper_email" };
  // (A hold on a card, not a payment: a ballot entry "Total Pre-authorised £67.50" with "Total paid today £0.00". Nothing was
  // bought yet, and may never be. Round 15.)
  if (/\bpre-?authori[sz]ed\b/i.test(text.slice(0, 6000)) && /\btotal paid(?: today)?\s*:?[\s|]*£\s?0(?:\.00)?(?![\d.])/i.test(text.slice(0, 8000))) return { ok: false, reason: "pre_authorised", source: "shopper_email" };
  // Money paid into an account to spend later (a deposit credited to a balance) is not a purchase.
  if (ACCOUNT_DEPOSIT.test(text.slice(0, 3000))) return { ok: false, reason: "account_deposit", source: "shopper_email" };
  // A payment towards a household bill (water, energy, council tax), taken by a card processor "on behalf of Thames Water
  // Utilities Limited": a bill, never a purchase. Round 15.
  if (UTILITY_BILL.test(String(subject || "") + "\n" + text.slice(0, 4000).replace(/\s+/g, " "))) return { ok: false, reason: "bill_payment", source: "shopper_email" };
  const ld = html ? fromJsonLd(html) : null;
  const refDate = headers.date ? new Date(headers.date) : null;
  const stripe = /(^|\.)stripe\.com$/i.test(sender?.domain || "") || (PERSONAL_MAIL.test(sender?.domain || "") && /(^|\.)stripe\.com$/i.test((forwardedSender(text, { subject, personal: (d) => PERSONAL_MAIL.test(d) }) || {}).domain || ""));
  // (A game's web shop through Appcharge or Xsolla writes its other dollars with their country, "MX$", "CA$": a bare "$"
  // there is the US dollar, whatever country it was bought in, "Country Tunisia", "Total $2,00". Round 15.)
  const gameDollar = GAME_SHOP.test(sender?.domain || "") || (PERSONAL_MAIL.test(sender?.domain || "") && GAME_SHOP.test((forwardedSender(text, { subject, personal: (d) => PERSONAL_MAIL.test(d) }) || {}).domain || ""));
  let txt = fromText(text, refDate, { stripe, gameDollar });
  // Many senders include a skimpy plain-text part next to the full HTML one: use whichever reads richer.
  if (plain && fromHtml) {
    const alt = fromText(fromHtml, refDate, { stripe, gameDollar });
    const richness = (r) => (r.items.length ? 2 : 0) + (r.items.some((i) => i.pricePence != null) ? 1 : 0) + (r.items.some((i) => i.variant) ? 1 : 0) + (r.orderDate ? 1 : 0) + (r.totalPence != null ? 1 : 0) + (r.orderRef ? 1 : 0);
    if (richness(alt) > richness(txt)) { txt = alt; text = fromHtml; }
  }
  const chosen = ld || txt;

  const result = {
    ok: true,
    source: "shopper_email",
    refundEligible: false, // shopper-supplied evidence never triggers refunds
    method: chosen.method,
    retailer: shopOf({ ld, sender, fromName, subject, text, html, otherText: text === fromHtml ? plain : fromHtml }),
    orderRef: chosen.orderRef ?? txt.orderRef,
    orderDate: chosen.orderDate ?? txt.orderDate,
    // The currency goes with the amount: whichever reading gave the total says what it is in.
    currency: chosen.totalPence == null && txt.totalPence != null ? txt.currency ?? chosen.currency : chosen.currency ?? txt.currency,
    totalPence: chosen.totalPence ?? txt.totalPence,
    items: chosen.items.length ? chosen.items : txt.items,
  };
  if (ePlat && ePlat.shop) {
    result.retailer = { name: ePlat.shop, domain: null, via: (fwdFrom && fwdFrom.domain) || sender.domain };
    if (ePlat.amountPence != null && result.totalPence == null) { result.totalPence = ePlat.amountPence; result.currency = "GBP"; }
    // (A payment platform's receipt names no things: what was paid is all it says.)
    if (ePlat.amountPence != null) result.items = [];
  }
  if (subStart && result.totalPence == null && !result.items.length) {
    result.totalPence = subStart.pence; result.currency = "GBP";
    result.items = [{ name: subStart.name, qty: 1, pricePence: subStart.pence }];
  }
  if (preOrder && !result.items.length && result.totalPence == null) result.items = [{ name: preOrder, qty: 1, pricePence: null }];
  const ePlatNoList = Boolean(ePlat && ePlat.shop && ePlat.amountPence != null), ePlatPicture = Boolean(ePlat && ePlat.shop && ePlat.picture);
  // (An order number with dots in it, Google Play's "Order number: GPA.3332-1627-7044-99184..6": the whole of it. Round 13.)
  if (!result.orderRef) { const gp = /\border (?:number|no\.?|id)[\s:*]{0,12}([A-Z]{2,5}\.\d{4}-\d{4}-\d{4}-\d{4,6}(?:\.\.\d{1,4})?)(?![\w.-])/i.exec(text) || /\border (?:number|no\.?|id)[\s:*]{0,12}([A-Z]{2,5}\.\d{4}-\d{4}-\d{4}-\d{4,6}(?:\.\.\d{1,4})?)(?![\w.-])/i.exec(text === fromHtml ? plain : fromHtml || ""); if (gp) result.orderRef = gp[1]; }
  // (A short order number on its own row under its label, a restaurant app's "Order Number:" over "074": the number the
  // counter calls. Only three figures, all digits, alone on the line. Round 14.)
  if (!result.orderRef) { const short = /^[ \t|]*order (?:number|no\.?)[ \t]*:?[ \t|]*\n(?:[ \t|]*\n){0,3}[ \t|]*(\d{3})[ \t|]*$/im.exec(fromHtml || text) || /^[ \t|]*order (?:number|no\.?)[ \t]*:?[ \t|]*\n(?:[ \t|]*\n){0,3}[ \t|]*(\d{3})[ \t|]*$/im.exec(plain || ""); if (short) result.orderRef = short[1]; }
  // (A bill's number only in the subject, "Your bill has been paid: #14541694". Round 14.)
  if (!result.orderRef) { const bn = /\bbill\b[^!?\n]{0,30}?[:\s]\s*#\s?(\d{5,14})\s*$/i.exec(String(subject || "")); if (bn) result.orderRef = bn[1]; }
  // (A bill's own number, "Bill ID: 51300828", which the subject calls the order, "Your order 51300828". Round 14.)
  if (!result.orderRef) { const bn = /\bbill (?:id|number|no\.?)\s*[:#]?\s*(\d{5,14})\b/i.exec(text) || /\bbill (?:id|number|no\.?)\s*[:#]?\s*(\d{5,14})\b/i.exec(otherText0(text, plain, fromHtml)); if (bn) result.orderRef = bn[1]; }
  // (The order number only in the subject, "Order Info - DET-7vxlt1dlf1s": Detale. Round 11.)
  if (!result.orderRef) { const sr = /\border\b[^!?\n]{0,20}?\s[-–:#]\s*((?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{5,24})\s*$/i.exec(String(subject || "")); if (sr) result.orderRef = sr[1]; }
  // ("… Tickets - Order Number [#160104]": the number in brackets. Round 12.)
  if (!result.orderRef) { const sr = /\border (?:number|no\.?)\s*:?\s*\[\s*#?\s*([A-Za-z0-9-]*\d[A-Za-z0-9-]*)\s*\]/i.exec(String(subject || "")); if (sr && sr[1].length >= 4) result.orderRef = sr[1]; }
  // ("Order Confirmation: #32297 | Vape and Go", or the body's "Your order (32297) has been received": the order's number,
  // with the shop's name after it in the subject. Round 15.)
  if (!result.orderRef) { const sr = /\border\s+(?:confirmation|confirmed|received|placed|update|status)\s*:?\s*#\s?(\d{3,12})\b/i.exec(String(subject || "")) || /\byour order \(#?(\d{3,12})\) (?:has been|is|was)\b/i.exec(text); if (sr) result.orderRef = sr[1]; }
  // ("Merchant Reference: a82d1340-3ad7-4d8d-9352-1c48ea195b90", a card payment page's receipt: the shop's own number for the
  // payment, whole. Round 15.)
  // (The order's number in brackets as a heading, "Your Order (#9C41AB77E0D2):", a ticket seller's order. Round 15e.)
  if (!result.orderRef) { const br = /\b(?:your order|order summary|order details)\s*\(\s*#\s?((?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,20})\s*\)\s*:?[ \t|]*$/im.exec(text) || /\b(?:your order|order summary|order details)\s*\(\s*#\s?((?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,20})\s*\)\s*:?[ \t|]*$/im.exec(otherText0(text, plain, fromHtml)); if (br) result.orderRef = br[1]; }
  // (A booking named by its number at the end of the subject, "Your booking with Frost Fair Leeds! - 5520193".)
  if (!result.orderRef) { const sb = /\byour booking\b[^?\n]{0,80}?\s[-–:#]\s*#?(\d{5,12})\s*$/i.exec(String(subject || "")); if (sb) result.orderRef = sb[1]; }
  // (A booking's own reference, "Reservation ID: 551204". Round 15e.)
  if (!result.orderRef) { const rv = /\b(?:reservation|booking) (?:id|number|no\.?)\s*:[ \t|]*((?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{3,23})(?![A-Za-z0-9-])/i.exec(text); if (rv) result.orderRef = rv[1]; }
  // (The word "Order" alone on its line over the order's number on the next, "Order" / "GL31207733-118". Round 15e.)
  if (!result.orderRef) { const ol = /^[ \t|]*order[ \t|]*\n(?:[ \t|]*\n){0,3}[ \t|]*((?=[A-Za-z0-9-]*\d{5})[A-Za-z0-9][A-Za-z0-9-]{5,23})[ \t|]*$/im.exec(fromHtml || text) || /^[ \t|]*order[ \t|]*\n(?:[ \t|]*\n){0,3}[ \t|]*((?=[A-Za-z0-9-]*\d{5})[A-Za-z0-9][A-Za-z0-9-]{5,23})[ \t|]*$/im.exec(plain || ""); if (ol) result.orderRef = ol[1]; }
  // (A labelled line of its own, "Order Reference Number: 61393406", under the customer's number. Round 17.)
  if (!result.orderRef) { const orn = /^[ \t|]*order reference (?:number|no\.?)[ \t]*:[ \t|]*((?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{4,23})[ \t|]*$/im.exec(text); if (orn) result.orderRef = orn[1]; }
  if (!result.orderRef) { const mr = /\bmerchant (?:reference|ref\.?)(?: number)?\s*:?[ \t|]*((?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{5,63})(?![A-Za-z0-9-])/i.exec(text); if (mr) result.orderRef = mr[1]; }
  // (A booking site's "Payment Reference" over its code, "5f1a2b3c4d5e6f7a8b9c0d1e", when the email gives no order number. Round 21.)
  if (!result.orderRef) { const PR = /^[ \t|]*payment (?:reference|ref\.?)(?: number)?[ \t]*:?[ \t|]*(?:\n[ \t|]*){0,3}((?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{5,39})[ \t|]*$/im; const pr = PR.exec(text) || PR.exec(otherText0(text, plain, fromHtml)); if (pr) result.orderRef = pr[1]; }
  // ("Order TSR89717 confirmed": a number of letters and digits right after "Order", with what happened to it after. Round 15.)
  if (!result.orderRef) { const sr = /^\s*(?:(?:fwd?|fw)\s*:\s*)*(?:your\s+)?order\s+#?((?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9-]{5,20}|\d{5,14})\s+(?:is\s+|has\s+been\s+)?(?:confirmed|received|placed|shipped|dispatched|despatched|on its way)\b/i.exec(String(subject || "")); if (sr) result.orderRef = sr[1]; }
  // Price wording ("Was £2,200", "You saved £330") sits on its own line in some shops' emails: it is never an item.
  result.items = cleanItems(result.items.filter((i) => !PRICE_WORDS.test(String(i.name || "").trim()) && !MONEY_LABEL.test(String(i.name || "").trim())));
  if (!result.items.length && /(^|\.)amazon\.(co\.uk|com)$/i.test(result.retailer.domain || sender?.domain || "") && html) result.items = amazonItems(html);
  // (An App Store or Apple services receipt: from Apple, or pasted with Apple named and its App Store layout.)
  const appleLayout = /^[\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*(?:\|[\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*)?(?:app store|apple services|itunes store|apple arcade)\s*\|?\s*$|\bin-app purchase\b|\brenews \d/im.test(text);
  const appleDigital = appleLayout && (/(^|\.)apple\.com$/i.test(result.retailer.domain || "") || /^apple$/i.test(result.retailer.name || "") || (!result.retailer.name && /\breport a problem\b/i.test(text)));
  if (!result.items.length && appleDigital) result.items = appleItems(text).length ? appleItems(text) : fromHtml ? appleItems(fromHtml) : [];
  // (Round 12: Apple's own layout names what was bought under its app, "Match Masters" over "Stack of Coins". When a
  // general reading found the same purchases, Apple's reading of them is kept: the item, with its app as the detail.)
  else if (result.items.length && appleDigital) {
    const sum = (xs) => xs.reduce((a, x) => a + (x.pricePence || 0) * (x.lineTotal ? 1 : x.qty || 1), 0);
    const a = [text, fromHtml].map((t) => (t ? appleItems(t) : [])).find((xs) => xs.length === result.items.length && sum(xs) === sum(result.items));
    if (a) result.items = a;
  }
  // Game currency bought through a game's web shop ("2,200 Coins"): one item, the whole order.
  const gameShop = GAME_SHOP.test((fwdFrom && fwdFrom.domain) || sender?.domain || "");
  // (A pack of several things, "Mixy Meow | 1", "Checkerboard | 10", is one purchase named by all of them. Round 10.)
  const bundle = gameShop ? gameBundle(fromHtml) || gameBundle(text) : null;
  if (bundle && bundle.length === 1) result.items = [{ ...bundle[0], pricePence: result.totalPence ?? null, ...(bundle[0].qty > 1 ? { lineTotal: true } : {}) }];
  else if (bundle) result.items = bundle.map((b) => ({ ...b, pricePence: null }));
  // (A game web shop's receipt has a receipt number, which its subject and its support form use, and a long hex "Order ID"
  // for its own system: the receipt number is the one the shopper is asked for. Round 12.)
  // (Its own "Order ID", 24 letters and digits, is the order's number only when the email gives no receipt number: the
  // receipt number, "Receipt Number | 866-123-456", also in the subject "Purchase Confirmation #866-123-456", is the one the
  // shopper sees and quotes. Round 15; the receipt number first since round 24.)
  if (gameShop) {
    const rn = /\breceipt (?:number|no\.?)\s*[:#]?\s*\|?\s*(\d{3}-\d{3}-\d{3,4}|\d{6,12})\b/i.exec(fromHtml || text) || /\breceipt (?:number|no\.?)\s*[:#]?\s*\|?\s*(\d{3}-\d{3}-\d{3,4}|\d{6,12})\b/i.exec(text) ||
      /\b(?:receipt|purchase confirmation) #?(\d{3}-\d{3}-\d{3,4})\b/i.exec(subject || "");
    const oid = rn ? null : /\border id[\s:#|]{0,40}([0-9a-f]{20,32})\b/i.exec(fromHtml || text) || /\border id[\s:#|]{0,40}([0-9a-f]{20,32})\b/i.exec(text);
    if (rn) result.orderRef = rn[1]; else if (oid) result.orderRef = oid[1];
  }
  if (!result.items.length && gameShop) result.items = (gameItems(fromHtml).length ? gameItems(fromHtml) : gameItems(text)).map((i) => ({ ...i, pricePence: result.totalPence ?? null }));
  // An Uber ride is travel: one ride, for what was paid (its fare, fees and credits are not things). An Uber Eats receipt that
  // only links to the full one lists nothing: no items are made up, and the check says the email has no item list. Round 10.
  const ride = Boolean(uber && uber.kind === "ride");
  const noList = Boolean(uber && uber.kind === "eats" && uber.noItemList);
  if (ride) { result.retailer = { ...result.retailer, name: "Uber" }; result.items = [{ name: uber.item, qty: 1, pricePence: result.totalPence ?? null }]; }
  if (uber && uber.kind === "eats") result.retailer = { ...result.retailer, name: "Uber Eats" };
  if (noList) result.items = [];
  // (A receipt sent again after a tip was added, "Thanks for tipping", "Here's your updated Sunday morning trip receipt": the
  // same purchase as the first receipt, now with the tip. It replaces that one (mergeOrderEmails). Round 16.)
  // (A click-and-collect order's two emails, "Your item is ready to collect" then "You've collected your items - … it's your
  // receipt": the same purchase. Which this is, so the two make one card (mergeOrderEmails). Round 16.)
  const topC = text.slice(0, 3000).replace(/\s+/g, " ");
  if (/\byou(?:'|’)ve collected your (?:items?|order)\b|\byou collected (?:this|these|your) items?\b/i.test(topC)) result.collection = "collected";
  else if (/\b(?:your (?:items?|order) (?:is|are) ready (?:to|for) collect(?:ion)?|here are your collection details|ready for collection)\b/i.test(topC)) result.collection = "ready";
  if (/\bthanks for (?:the )?tip(?:ping)?\b|\bhere(?:'|’)s your updated\b[^\n|]{0,40}\breceipt\b/i.test(text.slice(0, 3000))) result.updatedReceipt = true;
  // The delivery-day email of a supermarket order: what was paid, for the order it names. Its few listed lines (substitutions,
  // short-life items) are not the order's items, which are on the confirmation and in the attached receipt.
  if (dayOf) { result.items = []; result.orderUpdate = "paid"; if (dayOf.orderRef) result.orderRef = dayOf.orderRef; result.totalPence = dayOf.paidPence; result.currency = "GBP"; }
  // (What it swapped on the day, "Substituted with": the order's card shows what came instead. Round 12.)
  const subs = dayOf ? (grocerySubstitutions(text).length ? grocerySubstitutions(text) : grocerySubstitutions(text === fromHtml ? plain : fromHtml)) : [];
  if (subs.length) result.substitutions = subs;
  // (A changed order's new list is the order as it now is; when it was sent says which change is the latest. Round 12.)
  if (amended) { result.orderUpdate = "amended"; const d = headers.date ? new Date(headers.date) : null; if (d && !Number.isNaN(d.getTime())) result.amendedAt = d.toISOString(); }
  // A company's legal name as the sender ("Anthropic Ireland, Limited"): the shop is the brand, not the country it bills
  // from ("Anthropic"). Round 10.
  // (Forwarded, the original sender's name says it.)
  const legalName = (fwdFrom && fwdFrom.name) || fromName;
  if (legalName && /,?\s+(?:limited|ltd\.?|plc|inc\.?|llc|pbc|gmbh)\s*$/i.test(legalName) && result.retailer.name) {
    const m = /^(.+?)\s+(?:ireland|uk|europe|emea|international)$/i.exec(result.retailer.name.replace(/,?\s+(?:limited|ltd\.?|plc|inc\.?|llc|pbc|gmbh)\s*$/i, ""));
    if (m && !/\b(?:of|de|bank)$/i.test(m[1]) && legalName.toLowerCase().startsWith(m[1].toLowerCase())) result.retailer = { ...result.retailer, name: m[1] };
  }
  // The restaurant a takeaway app's order came from ("Your East Ocean order will be with you soon"), beside the app's name.
  const merchant = (uber && uber.kind === "eats" && uber.merchant) || takeawayMerchant(result.retailer.name, sender?.domain, subject, text);
  if (merchant) result.merchant = merchant;
  // (A bill paid in a pub or restaurant through its group's app, "Thanks for visiting Oyster Shed and using On Tap", or the
  // venue's name over its address and postcode beside "Table Number: 119": the place it was, beside the shop. Round 14.)
  if (!result.merchant) { const v = venueOf(fromHtml || text, result.retailer.name); if (v) result.merchant = v; }
  // Flights: each one (from, to, day, flight number, out or back), the booking reference, and what was paid. The flights
  // are what was bought, so they are the one item (a fare's lines, "Adult 1", "Hold bag", aren't things).
  if (isFlight) {
    result.flights = flight.legs;
    if (!result.orderRef && flight.ref) result.orderRef = flight.ref;
    if (result.totalPence == null && flight.paid) { result.totalPence = flight.paid.pence; result.currency = flight.paid.currency; }
    result.items = [{ name: flightItemName(flight.legs), qty: 1, pricePence: result.totalPence ?? null }];
    // (The fees set out on a line of their own beside the fare, an airline's "1 adult 40.00 EUR", "Fees 30.00 EUR", "Total: 70.00
    // EUR": the fees are fees, the flights what is left. Round 18.)
    if (Number.isInteger(result.totalPence)) {
      const cur = result.currency || "GBP";
      const feeRe = /^[ \t|]*((?:booking |service |admin(?:istration)? )?fees?|taxes(?:,? (?:fees|charges)(?:,? (?:and|&) surcharges)?| (?:and|&) (?:fees|charges))?|airport (?:taxes|charges))[ \t|:]*([£€$])?[ \t]?(\d{1,4}[.,]\d{2})[ \t]?(GBP|EUR|USD)?[ \t|]*$/i;
      const fees = [], seen = new Set();
      for (const l of String((plain || "") + "\n" + (fromHtml || "")).split("\n").slice(0, 6000)) {
        const m = feeRe.exec(l);
        if (!m || seen.has(m[1].toLowerCase())) continue;
        const c = m[4] ? m[4].toUpperCase() : m[2] === "£" ? "GBP" : m[2] === "€" ? "EUR" : m[2] === "$" ? "USD" : null;
        if (c !== cur) continue;
        seen.add(m[1].toLowerCase());
        fees.push({ label: m[1].replace(/^\w/, (x) => x.toUpperCase()), pence: Math.round(Number(m[3].replace(",", ".")) * 100) });
      }
      const fp = fees.reduce((n, f) => n + f.pence, 0);
      if (fees.length && fees.length <= 3 && fp > 0 && fp < result.totalPence) { result.fees = fees; result.items[0].pricePence = result.totalPence - fp; }
    }
    // (A flight paid for with points, "Avios debited: 10750" over "Payment Total: GBP 2.50": the points said beside it, so the
    // card never passes £2.50 off as the fare. Round 14.)
    const both = (plain || "") + "\n" + (fromHtml || "");
    const pts = /\b(avios|points|miles)\s+(?:debited|redeemed|used|spent)\s*:?[\s|]*([\d,]{2,9})\b/i.exec(both) || /\b([\d,]{2,9})\s+(avios|points|miles)\s+(?:debited|redeemed|used|spent)\b/i.exec(both);
    if (pts) { const [n, unit] = /^\d/.test(pts[1]) ? [pts[1], pts[2]] : [pts[2], pts[1]]; const v = Number(n.replace(/,/g, "")); if (v > 0) result.items[0].variant = `plus ${v.toLocaleString("en-GB")} ${/^avios$/i.test(unit) ? "Avios" : unit.toLowerCase()}`; }
    // (The day it was paid for, "Payment Date : 8 Jul 2026", not the day of the flight. Round 14.)
    const paidOn = /\b(?:payment|purchase|booking|issue) date\s*:?[\s|]*(\d{1,2} [A-Za-z]{3,9},? \d{4})\b/i.exec(both) || /\bdate of (?:issue|payment|purchase)\s*:?[\s|]*(\d{1,2} [A-Za-z]{3,9},? \d{4})\b/i.exec(both);
    const pd = paidOn ? parseDate(paidOn[1], refDate) : null;
    if (pd) result.orderDate = pd;
  }
  // A travel booking names the journey in its subject: the journey is what was bought (its fare lines, "Anytime Day Return",
  // "1 Adult", are not things).
  const journey = !isFlight && !gameShop ? JOURNEY.exec(subject || "") : null;
  if (journey) {
    const body = fromHtml || text;
    const from = fullStation(body, journey[2].trim()), to = fullStation(body, journey[3].trim());
    const trip = `${from} to ${to}${journey[1] ? " (return)" : ""}`;
    const tickets = railTickets(body);
    const sum = tickets.reduce((a, t) => a + t.pricePence * t.qty, 0);
    const detail = (t) => [/^child/i.test(t.passenger || "") ? "Child" : null, t.type, t.card].filter(Boolean).join(", ");
    // Two or more tickets that add up to what was paid: each ticket, named by its leg. One ticket: the trip, with the ticket.
    // (The booking fee is its own line, never part of a ticket's price: "Other costs", "Booking Fee", "£1.39". Round 13.)
    // (Every extra under "Other costs" is its own line, "Insurance" over "£0.90" as much as a booking fee. Round 15.)
    const listed = detailsList(body);
    const fees = listed && listed.costs.length && listed.costs.every((c) => c.pricePence != null) ? listed.costs.map((c) => ({ name: c.name, pricePence: c.pricePence })) : railFees(body);
    const feeSum = fees.reduce((a, f) => a + f.pricePence, 0);
    if (tickets.length && result.totalPence != null && (tickets.length > 1 || fees.length) && sum + feeSum === result.totalPence) {
      // (Two tickets of the same type, "Advance Single" twice: each is named by its own leg, the first by the first leg.)
      const seen = {};
      // (A return booking lists each way's legs under "Outbound …" and "Return …", and its tickets under "Outbound |" and
      // "Return |": each ticket takes the legs of its own way, in order. Round 15.)
      const byWay = legsByWay(body);
      const wayN = {};
      // (Split tickets of one kind set out as one line, "2 × Adult - Advance Single" "£6.20", for a way of two legs: a ticket
      // for each leg, each at its price. Round 16.)
      const tk = tickets.flatMap((t) => { const legs = t.way ? byWay[t.way] : byWay.outbound; return t.qty > 1 && legs && legs.length === t.qty && tickets.filter((x) => x.way === t.way).length === 1 && !/^child/i.test(t.passenger || "") && /^adults?$/i.test(t.passenger || "") && /\b1x adult\b|\b1 adult\b/i.test(body.replace(/\s+/g, " ")) ? Array.from({ length: t.qty }, (_, k) => ({ ...t, qty: 1, leg: legs[k] })) : [t]; });
      result.items = tk.map((t) => {
        if (t.leg) return { name: t.leg, variant: detail(t), qty: 1, pricePence: t.pricePence };
        const k = t.type.toLowerCase(); seen[k] = (seen[k] || 0) + 1;
        const legs = t.way && byWay[t.way]; wayN[t.way] = (wayN[t.way] || 0) + 1;
        const name = legs && legs.length >= wayN[t.way] && byWay.ticketsIn[t.way] === legs.length ? legs[wayN[t.way] - 1] : legOf(body, t.type, seen[k] - 1) || trip;
        return { name, variant: detail(t), qty: t.qty, pricePence: t.pricePence }; })
        .concat(fees.map((f) => ({ name: f.name, qty: 1, pricePence: f.pricePence })));
    } else result.items = [{ name: trip, ...(tickets.length === 1 ? { variant: detail(tickets[0]) } : {}), qty: 1, pricePence: result.totalPence ?? null }];
    // (The booking's number is its "Transaction ID", on the line under its label.)
    const tx = /\btransaction id\s*:?[\s|]{0,12}([A-Z0-9][A-Z0-9-]{5,24})\b/i.exec(body);
    if (!result.orderRef && tx) result.orderRef = tx[1];
  }
  // A booking whose subject names no journey but which lists what was paid for under "Order Details" and "Other costs" (a
  // railcard, a ticket change): those lines are the items, each cost its own line. One line with no price of its own (a
  // change's "Pay The Difference") is what the total leaves once the costs are taken off. A rail ticket is named by its
  // trip, "Newark Northgate to London Kings Cross", with the ticket beside it. Round 15.
  let listedOrder = null;
  if (!journey && !isFlight && !gameShop && result.totalPence != null) {
    const body = fromHtml || text;
    const listed = detailsList(body);
    if (listed && listed.costs.every((c) => c.pricePence != null)) {
      const all = listed.lines.concat(listed.costs);
      const unpriced = all.filter((l) => l.pricePence == null);
      const known = all.reduce((a, l) => a + (l.pricePence || 0), 0);
      if (unpriced.length === 1 && listed.lines.includes(unpriced[0]) && result.totalPence - known >= 0) unpriced[0] = Object.assign(unpriced[0], { pricePence: result.totalPence - known });
      if (all.every((l) => l.pricePence != null) && all.reduce((a, l) => a + l.pricePence, 0) === result.totalPence) {
        const rows = body.split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
        const times = rows.map((r) => /^\d{1,2}:\d{2} (\p{Lu}[\p{L}\d .'’&-]{1,40})$/u.exec(r)).filter(Boolean).map((m) => m[1]);
        const toM = /\byour (?:trip|journey) to (\p{Lu}[\p{L}\d .'’&-]{1,40}?) (?:departing|leaving|on)\b/u.exec(body);
        const trip = times.length >= 2 ? `${times[0]} to ${toM ? toM[1] : times[times.length - 1]}` : null;
        const asItem = (l) => {
          // (A change that names no ticket, "Pay The Difference:" over "£0.05" (the older layout): the trip, as a change.
          // Round 15e.)
          if (trip && /^pay the difference\s*:?$/i.test(l.name.trim())) {
            const tk = rows.map((r) => /^\d{1,2}x ((?:advance|anytime|off-peak|super off-peak|flexible|standard|first class)[\p{L} -]{0,30})$/iu.exec(r)).find(Boolean);
            return { name: trip, variant: ["Ticket change", tk ? tk[1].trim() : null].filter(Boolean).join(", "), qty: 1, pricePence: l.pricePence };
          }
          const m = RAIL_TICKET.exec(l.name.replace(/^pay the difference\s*:\s*/i, ""));
          if (!m || !trip) return { name: l.name, qty: 1, pricePence: l.pricePence };
          const change = /^pay the difference\b/i.test(l.name);
          return { name: trip, variant: [change ? "Ticket change" : null, m[3].trim(), m[4] || null].filter(Boolean).join(", "), qty: 1, pricePence: l.pricePence };
        };
        result.items = all.map(asItem);
        listedOrder = { complete: true, itemsPence: result.totalPence, expectedPence: result.totalPence, missingPence: 0 };
      }
    }
  }
  // (A digital railcard or another booking with no order number but its "Transaction ID:" over the number, the number the
  // shop asks for: the order's number. Round 13. The number can sit a cell or two under its label, "Transaction ID:" then
  // an empty cell then the number, as on a rail ticket change. Round 17.)
  if (!result.orderRef && !isFlight) { const tx = /^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*(?:your )?transaction id[ \t]*:?[ \t|]*(?:\n[ \t|]*){0,4}(\d{8,16})[ \t|]*$/im.exec(text); if (tx) result.orderRef = tx[1]; }
  // (An order number with no label, in a cell of its own beside the order's dates at the top of an invoice, McAfee's
  // "08 October 2027 expires on 07 November 2028 | AB1234567890 |": letters then digits, the only such code in the email,
  // and only with a day just beside it. Round 18.)
  if (!result.orderRef && !isFlight && /\b(?:order|receipt|invoice|purchase)\b/i.test(subject || "")) {
    const ls = String(fromHtml || text).split("\n").map((x) => x.trim()).filter((x) => x && x !== "|").slice(0, 40);
    const CELL = /(?:^|\|)[ \t]*([A-Z]{2,3}\d{8,12})[ \t]*(?:\||$)/;
    const hits = ls.map((l, k) => [k, CELL.exec(l)]).filter((h) => h[1]);
    const all = String(fromHtml || text).match(/\b[A-Z]{2,3}\d{8,12}\b/g) || [];
    if (hits.length === 1 && new Set(all).size === 1) {
      const [k, m] = hits[0], near = ls.slice(Math.max(0, k - 6), k + 1);
      const dated = near.some((l) => /\b\d{1,2}(?:st|nd|rd|th)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i.test(l));
      if (dated && !/\b(?:tel|phone|mobile|vat|account|customer|member|reg(?:istration)?|company|licen[cs]e|serial|tracking)\b/i.test(ls[k]) && !/\b(?:vat|company|reg(?:istration)?|account|customer|member)\b[^\n]{0,20}$/i.test(ls[k - 1] || "")) result.orderRef = m[1];
    }
  }
  // Every way of reading the items is tried on both parts of the email, and the totals check picks: the first reading whose
  // items add up to what the email says they came to, else the one that comes closest. What was picked carries its check.
  const otherPart = text === fromHtml ? plain : fromHtml;
  if (noList || dayOf) {
    result.itemsCheck = { complete: false, itemsPence: 0, expectedPence: dayOf ? null : result.totalPence ?? null, missingPence: null, ...(noList ? { noItemList: true } : { orderUpdate: true }) };
  } else if (listedOrder) {
    result.itemsCheck = listedOrder;
  } else if (!isFlight && !journey && !gameShop && !ride) {
    const cands = [];
    // (A currency's code on its own, "GBP" from "£20.47 GBP", is never a thing. Round 12.)
    // (A meal deal's title with its price before it, "£1.19 6 Chicken McNuggets® or 4 Veggie Dippers", then the choice made
    // with that same price, "6 Chicken McNuggets® | £1.19": one thing, the choice, never both. Round 15.)
    const words = (n) => String(n || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
    const oneDeal = (list) => list.filter((i, k) => { const n = list[k + 1]; if (!n || n.pricePence == null || n.pricePence !== i.pricePence || (n.qty || 1) !== (i.qty || 1) || !/\bor\b/i.test(String(i.name || ""))) return true;
      const mine = new Set(words(i.name)), theirs = words(n.name); return !(theirs.length && theirs.every((w) => mine.has(w))); });
    // (How tickets come, "Venue Dispatch" or "E-Tickets" at £0.00, is not something bought. Round 15.)
    // (Nor a till's own code at £0.00 run into one word, "NoUpsell": a note for the kitchen, not a thing. Round 16.)
    const howSent = (i) => !i.pricePence && /^No(?:\p{Lu}\p{Ll}+){1,3}$/u.test(String(i.name || "").trim()) || !i.pricePence && /^(?:venue dispatch|e-?tickets?|print[- ]at[- ]home|mobile tickets?|ticket ?direct|box office collection|collect(?:ion)? (?:at|from) (?:the )?(?:venue|box office))$/i.test(String(i.name || "").trim());
    // (A meal's title with its price, "£2.49 Extra Value Meal Sandwich and Medium Fries", then its parts each with theirs,
    // "Filet-O-Fish® £2.00", "Medium Fries £0.49", that come to it: the parts are what was bought, never the title too. Round 15e.)
    const dealHead = (list) => list.filter((i, k) => { if (!/\b(?:meal|deal|bundle|combo)\b/i.test(String(i.name || "")) || !(lineOf(i) > 0)) return true;
      for (const n of [2, 3]) { const next = list.slice(k + 1, k + 1 + n); if (next.length === n && next.every((x) => lineOf(x) > 0) && next.reduce((a, x) => a + lineOf(x), 0) === lineOf(i)) return false; }
      return true; });
    const readable = (list) => cleanItems(oneDeal(dealHead(list).filter((i) => !howSent(i) && !PRICE_WORDS.test(String(i.name || "").trim()) && !MONEY_LABEL.test(String(i.name || "").trim()) && !/^(?:gbp|eur|usd|cad|aud|chf|sek|nok|dkk|pln)$/i.test(String(i.name || "").trim()))));
    // (Products the shop recommends, "You might also like", "Customers also bought", are not what was bought: those sections
    // are left out of the item readings. Round 4.)
    const [textR, otherR] = [withoutRecommendations(text), otherPart ? withoutRecommendations(otherPart) : otherPart];
    // (Apple's own reading comes first for an App Store or subscription receipt: it names the app or service, "Apple Music",
    // where the plain reading takes the plan under it, "Individual (Monthly)". Round 10.)
    const isApple = (/(^|\.)apple\.com$/i.test(result.retailer.domain || "") && /\b(?:app store|in-app purchase|renews \d|apple account:?)/i.test(text)) || appleDigital;
    if (isApple) for (const t of [text, otherPart]) if (t) cands.push({ items: appleItems(t), money: moneyOf(t) });
    for (const t of [textR, otherR]) if (t) cands.push({ items: readable(readItems(t)), money: moneyOf(t) });
    for (const t of [textR, otherR]) if (t) cands.push({ items: readable(readItems(t, { extraPrices: true })), money: moneyOf(t) });
    for (const t of [textR, otherR]) if (t) cands.push({ items: readable(readItems(t, { laterPrice: true })), money: moneyOf(t) });
    for (const t of [textR, otherR]) if (t) cands.push({ items: readable(readItems(t, { lowerOfTwo: true })), money: moneyOf(t) });
    cands.push({ items: result.items, money: moneyOf(text) });
    for (const t of [text, otherPart]) if (t && /^[ \t|]*Transaction ID:/im.test(t)) cands.push({ items: readable(transactionBlockItems(t)), money: moneyOf(t) });
    if (html && /(^|\.)amazon\.(co\.uk|com)$/i.test(result.retailer.domain || sender?.domain || "")) cands.push({ items: amazonItems(html), money: moneyOf(fromHtml || text) });
    if (/(^|\.)apple\.com$/i.test(result.retailer.domain || "")) for (const t of [text, otherPart]) if (t) cands.push({ items: appleItems(t), money: moneyOf(t) });
    // Prices printed above their names (round 3): tried after every other reading, so it is taken only when nothing else adds up.
    // (One name straight over one price that is the whole basket, "WineBank Welcome Red Selection" over "£134.88" with
    // "Basket Total: £134.88": that one thing, before a price printed above the next words is tried. Round 12.)
    for (const t of [textR, otherR]) if (t) { const one = soleItemOverPrice(t, moneyOf(t), result.totalPence); if (one) cands.push({ items: [one], money: moneyOf(t) }); }
    for (const t of [textR, otherR]) if (t) cands.push({ items: readable(readItems(t, { priceAbove: true })), money: moneyOf(t) });
    // (A list of names each over its price and nothing else, "miso soup" / "£2.50" / "ginger" / "£0.00" / "salmon roll
    // (4x Pieces)" / "£5.10", under "Order Summary": tried last, so it is taken only when it adds up and nothing else does.
    // Round 16.)
    for (const t of [textR, otherR]) if (t) { const pp = namePricePairs(t); if (pp.length >= 2) cands.push({ items: readable(pp), money: moneyOf(t) }); }
    for (const t of [textR, otherR]) if (t) { const sc = splitColumns(t); if (sc.length >= 2) cands.push({ items: readable(sc), money: moneyOf(t), byHeadings: true }); }
    // "Read it again" (receipt-reread.js) also tries the older readers on both parts.
    if (opts.wide) for (const t of [text, otherPart]) if (t) cands.push({ items: cleanItems(itemsFromCells(t)), money: moneyOf(t) }, { items: cleanItems(fromText(t, refDate).items), money: moneyOf(t) });
    // (The same list twice over, once for phones and once for computers: each reading's first half is also tried, and the
    // totals check says which the email meant. Round 15e.)
    const halves = [];
    for (const c of cands) {
      const n = c.items.length;
      if (n >= 2 && n % 2 === 0 && c.items.slice(0, n / 2).every((x, k) => { const y = c.items[k + n / 2]; return String(x.name) === String(y.name) && (x.qty || 1) === (y.qty || 1) && x.pricePence === y.pricePence; })) halves.push({ items: c.items.slice(0, n / 2), money: c.money });
    }
    cands.push(...halves);
    const settled = cands.map((c) => ({ ...settleItems(c.items, c.money, result.totalPence), money: c.money, byHeadings: Boolean(c.byHeadings) }));
    const gap = (c) => (c.check.missingPence == null ? Infinity : Math.abs(c.check.missingPence));
    // (Of the readings that add up, one whose names all look like things bought comes first: a note or a size read as the
    // name still adds up. Round 9.)
    const shopName = (result.retailer && result.retailer.name) || "";
    // (And of those, one whose items come to what they should with the discounts the email shows: a reading that misses a
    // £5.00 item can add up to the total when the email took £5.00 off. Round 11.)
    const moneyAsName = (c) => c.items.length === 1 && /£\s?\d|\b(?:total|delivery|subtotal)\b[^\n]{0,20}£/i.test(String(c.items[0].name || "")) && !namesCheck(c.items, { shop: shopName }).namesOk;
    const exact = (c) => c.check.expectedPence != null && Math.abs(c.check.itemsPence - c.check.expectedPence) <= 1 && (c.money.discounts || 0) > 0;
    const pick = settled.find((c) => c.items.length && c.check.complete && exact(c) && namesCheck(c.items, { shop: shopName }).namesOk) ||
      settled.find((c) => c.items.length && c.check.complete && namesCheck(c.items, { shop: shopName }).namesOk) ||
      // (Never one line made of the money lines themselves, "£10.00 Delivery: £0.00 Total Cost", that adds up only because it
      // is the total, while another reading lists the things bought by name. Round 15.)
      settled.find((c) => c.items.length && c.check.complete && !moneyAsName(c)) ||
      (settled.some((c) => c.items.length && c.check.complete && moneyAsName(c)) ? settled.filter((c) => c.items.length >= 2 && namesCheck(c.items, { shop: shopName }).namesOk).sort((a, b) => gap(a) - gap(b))[0] : null) ||
      settled.find((c) => c.items.length && c.check.complete) ||
      // (When nothing adds up, a table read by its own headings, row by row, says best what each line is. Round 16.)
      settled.find((c) => c.byHeadings && c.items.length) ||
      settled.filter((c) => c.items.length).sort((a, b) => gap(a) - gap(b))[0] || settled[settled.length - 1 - (settled.length > 3 ? settled.length - 3 : 0)] || settled[0];
    // When the older readings found the very same items, their copy is kept (the same fields as before for everything they
    // already read right).
    const same = (a, b) => a.length === b.length && a.every((x, k) => String(x.name).toLowerCase() === String(b[k].name).toLowerCase() && (x.qty || 1) === (b[k].qty || 1) && lineOf(x) === lineOf(b[k]) && (!b[k].variant || Boolean(x.variant)));
    const older = settled[cands.findIndex((c) => c.items === result.items)];
    const chosen = older && older !== pick && older.check.complete && same(older.items, pick.items) ? older : pick;
    // (For one of something the price is the line's either way, so a new reading doesn't say which.)
    result.items = chosen.items.map(({ extras, ...i }) => { if (chosen !== older && (i.qty || 1) === 1 && i.lineTotal) delete i.lineTotal; return i; });
    // (Money taken off under an item, "Multi-buy discount: -£3.10", is a discount, never what the item is. Round 10.)
    for (const i of result.items) if (i.variant) { const v = String(i.variant).split(", ").filter((p) => !MONEY_OFF_NOTE.test(p.trim())).join(", "); if (v) i.variant = v; else delete i.variant; }
    result.itemsCheck = pick.check;
  } else {
    // (A rail booking's fee read as its own line is checked with the tickets: they and it come to what was paid. Round 13.)
    const feeLines = journey ? result.items.filter((i) => /^(?:booking|card|payment|transaction|service|seat reservation|splitsave|split ?ticket(?:ing)?|insurance|admin(?:istration)?) (?:fee|charge)s?$/i.test(String(i.name || ""))) : [];
    result.itemsCheck = feeLines.length ? checkItems(result.items.filter((i) => !feeLines.includes(i)), moneyOf(text), result.totalPence) : checkItems(result.items, moneyOf(text), result.totalPence);
    if (feeLines.length) result.itemsCheck = { ...result.itemsCheck, itemsPence: result.itemsCheck.itemsPence + feeLines.reduce((a, i) => a + i.pricePence, 0), expectedPence: result.totalPence };
  }
  // (Free gifts priced at what they are worth and taken off again as "3 FREE gifts on all orders - £10.00": the gifts cost
  // nothing, so they are £0.00 and that offer is not money off what was bought. When the email's gift lines weren't read
  // as items, the offer is what they would have come to. Round 15.)
  let zeroedGift = null, zeroedGiftPence = 0;
  if (result.items.length && result.totalPence != null && result.itemsCheck && !result.itemsCheck.foreignItems) {
    const money = moneyOf(text);
    const gifts = (money.found || []).filter((f) => f[0] === "discount" && /\bfree gifts?\b|\bgifts? (?:on|with) (?:all |every |your )?orders?\b/i.test(f[1]));
    const D = gifts.reduce((n, f) => n + f[2], 0);
    if (D > 0 && gifts.length === 1) {
      let giftLines = result.items.filter((i) => /\bfree\b|\bgift\b/i.test(String(i.name || "")) && lineOf(i) > 0);
      // (The gifts themselves are partner offers listed with their worth, "10% off sitewide at Ninja!" over "Quantity 1",
      // "Price £1.00", which are never read as things bought: found again here, and listed free when they and any gift
      // named above come to what the offer took off. Then a gift that is a thing, one item whose price alone makes up the
      // rest, a magazine's digital edition at £4.00, is free too. Round 18.)
      const offers = giftLines.reduce((n, i) => n + lineOf(i), 0) === D ? [] : offerGifts(fromHtml || text, result.items);
      const S = giftLines.reduce((n, i) => n + lineOf(i), 0) + offers.reduce((n, o) => n + o.pricePence, 0);
      if (offers.length && S < D) {
        const rest = result.items.filter((i) => !giftLines.includes(i) && lineOf(i) === D - S);
        if (rest.length === 1) giftLines = [...giftLines, rest[0]];
      }
      if (offers.length && giftLines.reduce((n, i) => n + lineOf(i), 0) + offers.reduce((n, o) => n + o.pricePence, 0) === D) {
        for (const o of offers) { const it = { name: o.name, qty: 1, pricePence: o.pricePence }; result.items.push(it); giftLines.push(it); }
      }
      if (giftLines.length && giftLines.reduce((n, i) => n + lineOf(i), 0) === D) {
        for (const i of giftLines) { i.pricePence = 0; i.lineTotal = true; i.free = true; }
        zeroedGift = gifts[0][1]; zeroedGiftPence = D;
        result.itemsCheck = checkItems(result.items, { ...money, discounts: money.discounts - D, found: money.found.filter((f) => f !== gifts[0]) }, result.totalPence);
      } else if (!result.itemsCheck.complete && checkItems(result.items, { ...money, discounts: money.discounts - D, found: money.found.filter((f) => f !== gifts[0]) }, result.totalPence).complete) {
        result.itemsCheck = { ...result.itemsCheck, complete: true, expectedPence: result.itemsCheck.itemsPence, missingPence: 0, giftsNotListed: true };
        zeroedGift = gifts[0][1]; zeroedGiftPence = D;
      }
    }
  }
  // (Items set out as labelled fields, "Item:", "Quantity:", "Unit Price:", or as "4 x Name @ £40.00": taken when the other
  // readings found nothing whole and these come to what the email says (or there is no total to come to). Round 15.)
  if (!(result.itemsCheck && result.itemsCheck.complete) && !isFlight) {
    const li = labelledItems(plain || text).length ? labelledItems(plain || text) : labelledItems(fromHtml || text);
    if (li.length) {
      const ck = checkItems(li, moneyOf(text), result.totalPence);
      // (Or nothing else was read and the total says it takes in postage the email doesn't set out, "Total (including Postage
      // & Packaging costs): £44.97": the things as listed, the check saying they don't come to the total. Round 15e.)
      const postageIn = !result.items.length && result.totalPence != null && ck.itemsPence < result.totalPence &&
        /\btotal\b[^\n£]{0,12}\b(?:incl\w*|plus|with)\b[^\n£]{0,30}\b(?:postage|delivery|shipping|p\s?&\s?p)\b/i.test(fromHtml || text);
      if (ck.complete || (result.totalPence == null && !result.items.length) || postageIn) { result.items = li; result.itemsCheck = ck; }
    }
  }
  let columnFee = null;
  if (result.totalPence != null && !isFlight) {
    const cf = stackedFeeColumns(fromHtml || text, result.totalPence) || (plain ? stackedFeeColumns(plain, result.totalPence) : null);
    if (cf) { result.items = cf.items; columnFee = cf; result.itemsCheck = { complete: true, itemsPence: cf.items.reduce((n, x) => n + x.pricePence, 0), expectedPence: result.totalPence - cf.fee, missingPence: 0, ...namesCheck(cf.items, {}) }; }
  }
  if (result.totalPence != null && !isFlight && !journey && !(result.itemsCheck && result.itemsCheck.complete)) {
    const ch = chargePairs(fromHtml || text, result.totalPence) || (plain ? chargePairs(plain, result.totalPence) : null);
    if (ch) { result.items = ch; result.itemsCheck = { complete: true, itemsPence: result.totalPence, expectedPence: result.totalPence, missingPence: 0, ...namesCheck(ch, {}) }; }
  }
  if (!result.items.length && result.totalPence != null && !isFlight) {
    const one = soleBulletOverTotal(fromHtml || text, moneyOf(fromHtml || text), result.totalPence) || (plain ? soleBulletOverTotal(plain, moneyOf(plain), result.totalPence) : null) ||
      bookingOverCost(fromHtml || text, result.totalPence) || (plain ? bookingOverCost(plain, result.totalPence) : null) ||
      stackedInvoiceRow(fromHtml || text, result.totalPence) || (plain ? stackedInvoiceRow(plain, result.totalPence) : null) ||
      stackedTaxedOne(fromHtml || text, result.totalPence) || (plain ? stackedTaxedOne(plain, result.totalPence) : null) ||
      tripOfVehicle(fromHtml || text, result.totalPence);
    if (one) { result.items = [one]; result.itemsCheck = checkItems(result.items, moneyOf(fromHtml || text), result.totalPence); }
    else {
      const cols = stackedColumns(fromHtml || text, moneyOf(fromHtml || text), result.totalPence) || (plain ? stackedColumns(plain, moneyOf(plain), result.totalPence) : null);
      if (cols) { result.items = cols; result.itemsCheck = checkItems(cols, moneyOf(fromHtml || text), result.totalPence); }
    }
  }
  // (A code's percentage off with no amount, "ASSENHEIMS20" / "20% discount first order only", the subtotal already after
  // it (the old one struck through): when the items less that percentage come to what the email says, that is the money
  // off, and the receipt shows it. Round 15.)
  let percentOff = null;
  if (result.items.length && result.itemsCheck && !result.itemsCheck.complete && result.itemsCheck.expectedPence != null) {
    const pl = /^[ \t|]*([^\n£|]{0,40}?\b(\d{1,2})\s?%\s?(?:discount|off)\b[^\n£|]{0,40})[ \t|]*$/im.exec(text);
    const ip = result.itemsCheck.itemsPence, want = result.itemsCheck.expectedPence;
    if (pl && ip > want && Math.abs(Math.round(ip * (100 - Number(pl[2])) / 100) - want) <= 1) {
      percentOff = { label: pl[1].trim(), pence: ip - want };
      result.itemsCheck = { ...result.itemsCheck, complete: true, expectedPence: ip, missingPence: 0, discountsPence: ip - want };
    }
  }
  // (A coach ticket's "Ticket Price: £22.89" is the journey the email names, "From: Nottingham, Greyfriars Gate" … "To:
  // London, Victoria Coach Station": "Nottingham to London". Round 15.)
  if (result.items.length === 1 && /^(?:ticket price|ticket|fare|price)$/i.test(String(result.items[0].name || "").trim())) {
    const fr = /^[ \t|]*from\s*:\s*(\p{Lu}[\p{L}' .-]{1,30}?)\s*[,(]/imu.exec(text), to = /^[ \t|]*to\s*:\s*(\p{Lu}[\p{L}' .-]{1,30}?)\s*[,(]/imu.exec(text);
    if (fr && to && fr[1] !== to[1]) { result.items[0] = { ...result.items[0], name: fr[1].trim() + " to " + to[1].trim() }; result.itemsCheck = { ...checkItems(result.items, moneyOf(text), result.totalPence), ...namesCheck(result.items, {}) }; }
  }
  // (A ticket seller's "Payment Summary": the tickets under the event's name, each per-ticket fee and the order's handling fee,
  // as the summary lists them, when they come to the total. Round 15.)
  const tixItems = ticketSummary(fromHtml || text, result.totalPence) || (plain ? ticketSummary(plain, result.totalPence) : null);
  if (tixItems) { result.items = tixItems; result.itemsCheck = { ...checkItems(tixItems, moneyOf(text), result.totalPence), complete: true, itemsPence: result.totalPence, expectedPence: result.totalPence, missingPence: 0 }; }
  // (Google Play's receipt: the thing bought over "Item Price", its name wrapped over lines and its developer after it,
  // "Office 365 personal with trial (…) (by Microsoft Corporation) £5.99/month", a plan's price per month. Round 13.)
  // (Pasted with no sender's address: Google Play's own order number, "GPA.3399-…", says whose receipt it is.)
  if (!result.items.length && (/(^|\.)google\.com$/i.test(result.retailer.domain || sender?.domain || "") || (!sender?.domain && /\bOrder number:?[ \t]*GPA\.\d{4}-/.test(text))) && /\bgoogle play\b/i.test(text.slice(0, 3000))) {
    const gp = googlePlayItems(plain || text);
    if (gp.length) { result.items = gp; result.itemsCheck = checkItems(gp, moneyOf(text), result.totalPence); }
  }
  // (A game shop's pack of several things has one price, the whole receipt's: its lines are all of it. Round 15.)
  if (bundle && bundle.length > 1 && result.totalPence != null && result.items.length === bundle.length && result.items.every((i) => i.pricePence == null))
    result.itemsCheck = { complete: true, itemsPence: result.totalPence, expectedPence: result.totalPence, missingPence: 0, pack: true };
  // (A PayPal receipt's own list: the name, "Qty: 1", sometimes "Product ID: home_screen_offer_3", then the price in the
  // payment's currency, "US$5.00" or "£3.99". The name as PayPal gives it, cut short or not: nothing is added. Round 13.)
  // (Pasted with no sender's address: a receipt that opens as PayPal's and gives PayPal's transaction ID.)
  const viaPayPal = /(^|\.)paypal\.[a-z.]+$/i.test(sender?.domain || "") || /(^|\.)paypal\./i.test(result.retailer.via || "") ||
    (!sender?.domain && /^[\s|]*PayPal\b/.test(text) && /\btransaction ID\b/i.test(text.slice(0, 4000)));
  // (PayPal's own list comes first: a general reading can take a label for the thing bought, "Merchant" over "£25.00".)
  if (viaPayPal) {
    const pp = payPalItems(text);
    let ppTax = 0;
    // (One thing bought, its price before the tax PayPal adds under it, "Special Offer £3.99", "Tax £0.80", "Total £4.79":
    // what that one thing cost is what was paid for it. Round 15.)
    if (pp.length === 1 && (pp[0].qty || 1) === 1 && result.totalPence != null) {
      const m = moneyOf(text);
      // (Not any more: the thing at its price and the tax as its own line, as the email sets them out, "Coins £4.16", "Tax
      // £0.83". Round 21.)
      if (m.vat > 0 && m.subtotal === pp[0].pricePence && Math.abs(m.subtotal + m.vat + (m.fees || 0) - (m.discounts || 0) - result.totalPence) <= 1 && !m.fees && !m.discounts) ppTax = m.vat;
    }
    // (Several lines, the tax added once under a subtotal that is after the discount, "Qty: 6 £12.50", "Booking Fee £2.00",
    // "Subtotal £64.00", "Discount -£13.00", "Tax £12.80", "Total £76.80": the lines less the discount, and the tax, come to
    // what was paid, so the tax is shown as its own line. Round 23.)
    if (!ppTax && pp.length > 1 && result.totalPence != null && pp.every((i) => Number.isInteger(i.pricePence))) {
      const m = moneyOf(text), sum = pp.reduce((n, i) => n + i.pricePence * (i.qty || 1), 0);
      if (m.vat > 0 && !m.fees && m.subtotal != null && m.subtotal === sum - (m.discounts || 0) && m.subtotal + m.vat === result.totalPence) ppTax = m.vat;
    }
    if (pp.length) { result.items = pp; if (ppTax) result.fees = [...(result.fees || []).filter((f) => !/\b(?:vat|tax)\b/i.test(String(f.label || ""))), { label: "Tax", pence: ppTax }]; const sum = pp.reduce((n, i) => n + (i.pricePence ?? 0) * (i.qty || 1), 0); result.itemsCheck = result.currency === "GBP" ? checkItems(pp, moneyOf(text), result.totalPence) : { complete: null, itemsPence: sum, expectedPence: result.totalPence ?? null, missingPence: null, foreignItems: true }; }
  }
  // (The same "Description | Unit price | Qty | Amount" table pasted with no sender to say it was PayPal's: read the same
  // way when nothing else was. Round 17.)
  if (!viaPayPal && !result.items.length && /^[ \t|]*description[ \t|]*\n(?:[ \t|]*\n)?[ \t|]*unit price[ \t|]*$/im.test(text.slice(0, 30000))) {
    const pp = payPalItems(text);
    if (pp.length) { result.items = pp; result.itemsCheck = result.currency === "GBP" ? checkItems(pp, moneyOf(text), result.totalPence) : { complete: null, itemsPence: pp.reduce((n, i) => n + (i.pricePence ?? 0), 0), expectedPence: result.totalPence ?? null, missingPence: null, foreignItems: true }; }
  }
  // (An order number PayPal gives under its label, "Order ID |" over "58d0cf0e-7b50-4c34-a8bd-ebc59dd2d0b8", however long.)
  // (Booking.com: the stay, read from its price details: the room or rooms for the nights booked, at the rooms' price, the
  // taxes and charges apart from it, never its terms as things bought; and whether it is paid at the property. Round 15.)
  const bookingCom = /(^|\.)booking\.com$/i.test((fwdFrom && fwdFrom.domain) || sender?.domain || "") || /^booking\.com$/i.test((result.retailer && (result.retailer.domain || result.retailer.name)) || "");
  const expedia = /(^|\.)expedia\.(?:com|co\.uk)$/i.test((fwdFrom && fwdFrom.domain) || sender?.domain || "");
  const stay = bookingCom ? bookingStay(fromHtml || text) || bookingStay(text) : expedia ? expediaStay(fromHtml || text) || expediaStay(text) : null;
  if (stay && stay.orderRef && !result.orderRef) result.orderRef = stay.orderRef;
  if (stay && stay.rooms) {
    const feesPence = stay.fees.reduce((n, f) => n + f.pence, 0);
    const roomPence = stay.roomPence ?? (result.totalPence != null && !stay.fees.length ? result.totalPence : null);
    const name = stay.roomName || (stay.rooms === 1 ? "Room" : "Rooms");
    const sameRoom = !/ and /.test(name);
    result.items = [{ name, qty: sameRoom ? stay.rooms : 1, pricePence: roomPence, lineTotal: true, ...(stay.nights ? { variant: stay.nights + (stay.nights === 1 ? " night" : " nights") } : {}) }];
    const sum = roomPence == null ? null : roomPence + feesPence;
    result.itemsCheck = { complete: sum != null && result.totalPence != null && Math.abs(sum - result.totalPence) <= 1, itemsPence: roomPence ?? 0, expectedPence: result.totalPence == null ? null : result.totalPence - feesPence,
      missingPence: sum == null || result.totalPence == null ? null : result.totalPence - sum };
    if (stay.payAtProperty) result.payAtProperty = true;
  }
  // (Booking.com's newer layout sets out no price details, only "Prepayment" over "You don't need to prepay", and "You will
  // pay the hotel in the hotel's local currency": nothing was taken up front. And the hotel is the business the stay is
  // with, as the subject names it, "Thanks! Your booking is confirmed at Harbour View Hotel": Booking.com only sold it.
  // Round 23.)
  // (PayPal's authorisation read as the purchase: marked, so a refund of what was finally taken finds it. Round 24.)
  if (ppAuthorised) result.authorised = true;
  // (The shopper's own "Fwd:" of a shop's email, read as the shop's: marked, so it joins the shop's own email of the same
  // purchase instead of making a second card (gmail.js mergeOrderEmails). Round 24.)
  if (PERSONAL_MAIL.test(sender?.domain || "") && /^\s*(?:fwd?|fw)\s*:/i.test(String(subject || "")) && result.retailer && result.retailer.domain && !PERSONAL_MAIL.test(result.retailer.domain)) result.forwardedCopy = true;
  if (bookingCom) {
    const head = text.slice(0, 40000);
    // (Or "Your payment will be handled by Harbour View Hotel": the hotel takes the money, Booking.com took none, and its
    // "You will be charged a prepayment of the total price at any time" is money still to be taken, never paid. Round 24.)
    const said = head.replace(/\bwill be charged a prepayment of\b/gi, "");
    if (!result.payAtProperty && (/\byou don(?:'|’)t need to prepay\b|\bno prepayment (?:is )?(?:needed|required)\b/i.test(head) || /\byou(?:'|’)ll pay (?:when you stay|the property|at the property)\b|\byou will pay the (?:hotel|property)\b/i.test(head) ||
      /\byour payment will be handled by (?!booking\.com\b)\p{L}/iu.test(head)) && !/\byou(?:'|’)ve (?:already )?paid\b|\bprepayment of\b|\bpaid in full\b/i.test(said)) result.payAtProperty = true;
    const at = /\b(?:booking|reservation|stay) (?:is|has been) confirmed at (\p{L}[^\n|]{1,98}?)\s*[.!]?\s*$/iu.exec(String(subject || "").replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, ""));
    if (at && !result.merchant && !/^booking\.com$/i.test(at[1].trim())) result.merchant = at[1].trim();
  }
  // (A ticket seller's order summary with its columns named, "Item Price Fee Quantity Subtotal", then each ticket's row with
  // bare amounts, "Individual Ticket 75.00 0.00 1 75.00" (Ticket Tailor): the ticket, how many, and what the row came to with
  // its fee. Round 15.)
  if (!result.items.length) {
    const hd = /^[ \t|]*item[ \t|]+price[ \t|]+fee[ \t|]+quantity[ \t|]+subtotal[ \t|]*$/im.exec(text);
    if (hd) {
      const rowsAfter = text.slice(hd.index + hd[0].length, hd.index + hd[0].length + 3000).split("\n").map((l) => l.replace(/\|/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
      const got = [];
      for (const r of rowsAfter) {
        const m = /^(\S.{0,100}?) (\d{1,5}\.\d{2}) (\d{1,4}\.\d{2}) (\d{1,3}) (\d{1,6}\.\d{2})$/.exec(r);
        if (!m) break;
        got.push({ name: m[1], qty: Number(m[4]), pricePence: money(m[5]), lineTotal: true });
      }
      if (got.length) { result.items = got; result.itemsCheck = checkItems(got, moneyOf(text), result.totalPence); }
    }
  }
  // (An airline's itinerary, "Receipt:", "Total paid via MasterCard ending in 4156 | 168.98 GBP": what was paid, the amount
  // before its currency's code. Round 15.)
  if (result.totalPence == null) { const tp = /\btotal paid via\b[^\n]{0,40}(?:\n[^\n]{0,40}){0,10}?\s(?:(£)\s?(\d[\d,]{0,9}\.\d{2})|(\d[\d,]{0,9}\.\d{2})\s?(GBP|EUR|USD)\b)/i.exec(text.slice(0, 20000)); if (tp) { result.totalPence = money(tp[2] || tp[3]); result.currency = tp[1] ? "GBP" : tp[4].toUpperCase(); result.itemsCheck = checkItems(result.items, moneyOf(text), result.totalPence); } }
  // (A subscription's first, trial charge, "Trial charge: GBP 1.00" with "Monthly payment: GBP 55.00 per month" after it: the
  // trial charge is what was paid; the monthly price is only what comes next. Round 15.)
  if (result.totalPence == null || /^[ \t|]*trial charge\s*:/im.test(text.slice(0, 6000))) { const tc = /^[ \t|]*trial charge\s*:[ \t|]*(?:GBP ?|£ ?)(\d{1,4}\.\d{2})\b/im.exec(text.slice(0, 6000)); if (tc) { result.totalPence = money(tc[1]); result.currency = "GBP";
    const plan = /\bsigned up to an? ([\p{L}][\p{L} ]{2,40}? subscription)\b/iu.exec(text.slice(0, 4000)); result.items = [{ name: plan ? plan[1] + " (trial)" : "Subscription (trial)", qty: 1, pricePence: result.totalPence }]; result.itemsCheck = { complete: true, itemsPence: result.totalPence, expectedPence: result.totalPence, missingPence: 0 }; } }
  // (A subscription confirmed as "Subscribed for $7.00": that money, in its own currency; the subscription is the thing. Round 15.)
  if (result.totalPence == null) { const sb = /\bsubscribed for (US ?\$|\$|£|€)\s?(\d{1,4}\.\d{2})\b/i.exec(text.slice(0, 6000)); if (sb) { result.totalPence = money(sb[2]); result.currency = sb[1] === "£" ? "GBP" : sb[1] === "€" ? "EUR" : "USD";
    if (!result.items.length) result.items = [{ name: "Subscription", qty: 1, pricePence: result.totalPence }]; result.itemsCheck = { complete: true, itemsPence: result.totalPence, expectedPence: result.totalPence, missingPence: 0 }; } }
  // (An airline's "Total Price for all Passengers | GBP 1184.36", its own code before the amount; "Lufthansa booking code: |
  // VRDZLD". Round 15.)
  if (result.totalPence == null) { const ap = /\btotal price for all passengers\b[\s|:]{0,20}(GBP|EUR|£|€)\s?(\d[\d,]{0,9}\.\d{2})\b/i.exec(text.slice(0, 30000)); if (ap) { result.totalPence = money(ap[2]); result.currency = /GBP|£/.test(ap[1]) ? "GBP" : "EUR"; result.itemsCheck = checkItems(result.items, moneyOf(text), result.totalPence); } }
  if (!result.orderRef) { const bc = /\bbooking code[ \t]*:[ \t|]*(?:\n[ \t|]*){0,3}([A-Z0-9]{6})[ \t|]*$/m.exec(text.slice(0, 8000)); if (bc && /[A-Z]/.test(bc[1])) result.orderRef = bc[1]; }
  if (!result.orderRef) { const rv = /^[ \t|]*[Rr]eservation[ \t]*:[ \t|]*(?:\n[ \t|]*){0,4}([A-Z0-9]{6})[ \t|]*$/m.exec(text.slice(0, 5000)); if (rv && /[A-Z]/.test(rv[1])) result.orderRef = rv[1]; }
  // (A list headed "1 Item" with each thing as its name, its price on its own line ("£ 310"), its details ("Size18.00 inches")
  // and "Qty1" (Tiffany & Co.): the name is the line above the price, never a detail under it. Taken when it adds up. Round 15.)
  {
    const L = text.slice(0, 30000).split("\n").map((l) => l.replace(/\|/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
    const h = L.findIndex((l) => /^\d{1,2} items?$/i.test(l));
    if (h >= 0) {
      const got = [];
      for (let k = h + 1; k < L.length - 1 && got.length < 30; k++) {
        const pr = /^£ ?(\d[\d,]{0,8}(?:\.\d{2})?)$/.exec(L[k + 1]);
        if (!pr || !/^\p{L}/u.test(L[k]) || /^(?:sub-?total|total|items|shipping|delivery)\b/i.test(L[k])) { if (got.length && /^(?:sub-?total|total)\b/i.test(L[k])) break; continue; }
        const det = [];
        let q = 1, j = k + 2;
        for (; j < L.length && j < k + 8; j++) { const qm = /^qty:? ?(\d{1,3})$/i.exec(L[j]); if (qm) { q = Number(qm[1]); break; } if (/^£/.test(L[j + 1] || "")) break; det.push(L[j].replace(/^(size|colou?r|length|metal)(?=\S)/i, "$1 ")); }
        got.push({ name: L[k], qty: q, pricePence: money(pr[1]), ...(det.length ? { variant: det.slice(0, 2).join(", ") } : {}) });
        k = j;
      }
      const sum = got.reduce((n, i) => n + i.pricePence * i.qty, 0);
      const m = moneyOf(text);
      if (got.length && result.items.some((i) => /^(?:size|colou?r|qty)(?![a-z])/i.test(String(i.name || ""))) && (sum === m.subtotal || sum === result.totalPence)) { result.items = got; result.itemsCheck = checkItems(got, m, result.totalPence); }
    }
  }
  // ("Your order reference number is BUY37490811 ." in a sentence; and the thing bought as its name over "Product Code:",
  // "Quantity:" and "Price:" rows (Buyagift), never a "You may also like" offer further down. Round 15.)
  if (!result.orderRef) { const ty = /\bthank you for your order \([ \t]?#?[ \t]?([A-Z0-9][A-Z0-9-]{5,24})[ \t]?\)/i.exec(text.slice(0, 8000)); if (ty && /\d/.test(ty[1])) result.orderRef = ty[1]; }
  if (!result.orderRef) { const sn = /\byour order (?:reference )?(?:number|reference)(?: number)? is ([A-Z]{0,4}\d[A-Z0-9-]{4,20})\b/i.exec(text.slice(0, 8000)); if (sn) result.orderRef = sn[1]; }
  {
    const L = text.slice(0, 30000).split("\n").map((l) => l.replace(/\|/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
    const got = [];
    for (let k = 0; k < L.length - 5 && got.length < 20; k++) {
      if (!/^product code:?$/i.test(L[k])) continue;
      const q = /^quantity:?$/i.test(L[k + 2]) ? /^(\d{1,3})$/.exec(L[k + 3]) : null, p = /^price:?$/i.test(L[k + 4]) ? /^£ ?(\d[\d,]{0,8}\.\d{2})$/.exec(L[k + 5]) : null;
      if (!q || !p) continue;
      let n = null;
      for (let j = k - 1; j >= Math.max(0, k - 6); j--) if (/^\p{L}/u.test(L[j]) && !/\b(?:click|download|print|e-?voucher|keep it safe)\b/i.test(L[j]) && L[j] !== L[j].toUpperCase() && L[j].length <= 100) { n = L[j]; break; }
      if (n) got.push({ name: n, qty: Number(q[1]), pricePence: money(p[1]) });
    }
    if (got.length) { result.items = got; result.itemsCheck = checkItems(got, moneyOf(text), result.totalPence); }
  }
  // (A shop's "Payment received" email, "Your payment of £54.40 has been successfully processed", subject "Payment receipt
  // confirmation 3173033": that money, for that order. Round 15.)
  // ("We've charged GBP 3.00 to your card", "Cost: 4.00 GBP": what was paid. Round 20.)
  if (result.totalPence == null) { const wc = /\bwe(?:'|’)?ve charged (GBP ?|£ ?)(\d{1,5}\.\d{2})\b/i.exec(text.slice(0, 6000)) || /^[ \t|]*cost\s*:[ \t|]*(£ ?)?(\d{1,5}\.\d{2}) ?(?:GBP)?\b/im.exec(text.slice(0, 6000)); if (wc) { result.totalPence = money(wc[2]); result.currency = "GBP"; result.itemsCheck = checkItems(result.items, moneyOf(text), result.totalPence); } }
  if (result.totalPence == null) { const pd = /\byour payment of £\s?(\d[\d,]{0,9}(?:\.\d{2})?) has been (?:successfully )?(?:processed|received|taken)\b/i.exec(text.slice(0, 5000)); if (pd) { result.totalPence = money(pd[1]); result.currency = "GBP"; result.itemsCheck = checkItems(result.items, moneyOf(text), result.totalPence); } }
  if (!result.orderRef) { const sr = /\b(?:payment receipt|payment|receipt|order) confirmation\s*[:#]?\s*(\d{5,12})\s*$/i.exec(String(subject || "")); if (sr) result.orderRef = sr[1]; }
  // (A booking's code in its subject, "Order Receipt for QX7R2M4P": capitals with a digit. Round 22.)
  if (!result.orderRef) { const sr = /^\s*(?:(?:fwd?|fw)\s*:\s*)*(?:order|booking) receipt for\s+((?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,12})\s*$/.exec(String(subject || "").replace(/^\s*(?:order|booking) receipt\b/i, (w) => w.toLowerCase())); if (sr) result.orderRef = sr[1]; }
  // ("Booking reference number: KD4M2XQ", a cinema's booking code, capitals with a digit. Round 22.)
  if (!result.orderRef) { const br = /\b[Bb]ooking [Rr]eference [Nn]umber(?: is)?[ \t]*:?[ \t|]*(?:\n[ \t|]*){0,3}((?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,12})(?![A-Za-z0-9])/.exec(text.slice(0, 20000)); if (br) result.orderRef = br[1]; }
  // (One ticket's own code, "Ticket 1 of 1", "TICKET CODE" over "Ab3dE9x", when the order gives no number of its own: the code
  // the ticket is found by. Only when the email names one code. Round 22.)
  if (!result.orderRef) {
    const codes = [...new Set([...text.slice(0, 30000).matchAll(/^[ \t|]*ticket code[ \t]*:?[ \t|]*(?:\n[ \t|]*){0,2}((?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,16})[ \t|]*$/gim)].map((m) => m[1]))];
    if (codes.length === 1) result.orderRef = codes[0];
  }
  // (PayPal's own labels are never the thing bought: "Funding sources used (total)", "Sent to …", "Seller". Round 15.)
  if ((viaPayPal || /\bpaypal\b/i.test(text.slice(0, 6000))) && result.items.some((i) => PAYPAL_LABEL.test(String(i.name || "")))) {
    result.items = result.items.filter((i) => !PAYPAL_LABEL.test(String(i.name || "")));
    result.itemsCheck = checkItems(result.items, moneyOf(text), result.totalPence);
  }
  // (A PayPal Debit Card purchase in a shop names no order: its PayPal transaction ID, "Transaction ID |" over
  // "0HJ67367JW2999345", is the reference the shopper and PayPal go by. Round 15.)
  // (PayPal's receipt for a payment in a shop, "Total payment to seller" over "£8.40 GBP": what was paid. Round 22.)
  if (result.totalPence == null && viaPayPal) { const tp = /\btotal payment to seller\b[ \t|:]{0,20}(?:\n[ \t|]{0,20}){0,3}£\s?(\d[\d,]{0,9}\.\d{2})(?: GBP)?\b/i.exec(text.slice(0, 20000)); if (tp) { result.totalPence = money(tp[1]); result.currency = "GBP"; result.itemsCheck = checkItems(result.items, moneyOf(text), result.totalPence); } }
  if (!result.orderRef && viaPayPal && /\bPayPal Debit Card\b/i.test(text.slice(0, 3000))) { const tid = /\btransaction id[ \t|:]*(?:\n[ \t|]*){0,3}([A-Z0-9]{17})\b/i.exec(text); if (tid) result.orderRef = tid[1]; }
  if (!result.orderRef && viaPayPal) { const oid = /^[ \t|]*(?:order id|order number|invoice id)[ \t]*[:|]?[ \t|]*\n?[ \t|]*((?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{3,63})[ \t]*\|?[ \t]*$/im.exec(text); if (oid) result.orderRef = oid[1]; }
  // (An order submitted through PayPal to be charged when the shop processes it, "You've submitted an order", "You placed a
  // £32.00 GBP order with …": PayPal's "Transaction ID", "O-4AB12345CD6789012", is the one reference it gives. Kept as the
  // receipt's reference, marked as PayPal's own, so the shop's own email for the purchase still finds it. Round 21.)
  if (!result.orderRef && viaPayPal && (/\bsubmitted an order\b/i.test(String(subject || "")) || /\byou placed an? (?:£|\$|€)\s?[\d,]+(?:\.\d{2})?(?: [A-Z]{3})? order with\b/i.test(text.slice(0, 4000)))) {
    const tid = /\btransaction id[ \t|:]*(?:\n[ \t|]*){0,3}((?:O-)?[A-Z0-9]{17})(?![A-Z0-9-])/i.exec(text) || /\btransaction id[ \t|:]*(?:\n[ \t|]*){0,3}((?:O-)?[A-Z0-9]{17})(?![A-Z0-9-])/i.exec(otherText0(text, plain, fromHtml));
    if (tid) { result.orderRef = tid[1].toUpperCase(); result.refIsPayment = true; }
  }
  // (PayPal's receipt for a payment, "You paid £6.49 GBP to Appcharge ltd", paid from a PayPal balance or PayPal Credit and
  // not only a PayPal Debit Card, names no order of the shop's: its "Transaction ID: 1AB23456CD7890123" is the reference.
  // Marked as PayPal's own, so the shop's own receipt for the same money still joins it and keeps its own number. Never an
  // authorisation, which is not a payment yet. Round 23.)
  // (Only for a merchant PayPal names, never money sent to a person, which is no purchase at all.)
  if (!result.orderRef && viaPayPal && /^[ \t|*]*merchant\b/im.test(text.slice(0, 8000)) && !/\bauthori[sz]ed\b/i.test(String(subject || "")) && /\byou(?:'|’)?ve (?:successfully )?sent a payment\b|\byou paid (?:£|\$|€|[A-Z]{2}\$)\s?[\d,]+\.\d{2}\b/i.test(text.slice(0, 4000))) {
    const tid = /\b[Tt]ransaction (?:ID|id|Id)[ \t|:]*(?:\n[ \t|]*){0,3}([A-Z0-9]{17})(?![A-Z0-9-])/.exec(text.slice(0, 20000));
    if (tid && /\d/.test(tid[1]) && /[A-Z]/.test(tid[1])) { result.orderRef = tid[1]; result.refIsPayment = true; }
  }
  // (Amazon, read from its own layout: each order in the email with its own number, items and total, and every title
  // whole. Taken for this email's order when it adds up, or when the general reading didn't. Round 13.)
  // (Pasted with no address at all: an email that calls itself Amazon's near its top and names an order in Amazon's shape.
  // Round 15.)
  const amazonRefs = new Set([...text.slice(0, 60000).matchAll(/\b((?:\d{3}|D\d{2})-\d{7}-\d{7})\b/g)].map((m) => m[1]));
  const amazonPasted = !(result.retailer.domain || sender?.domain) && (amazonRefs.size > 0 && /\bamazon(?:\.co\.uk)?\b/i.test(text.slice(0, 2000)) || /^[ \t]*Ordered item\(s\):/m.test(text.slice(0, 20000)));
  const isAmazon = /(^|\.)amazon\.(co\.uk|com)$/i.test(result.retailer.domain || sender?.domain || "") || amazonPasted;
  // (From the HTML when it shows the orders; else from the text part alone.)
  const amazonSplit = isAmazon ? (html && amazonOrders(html, plain)) || amazonPlainOrders(plain || text) : null;
  if (amazonSplit) {
    const mine = amazonSplit[0];
    if (!result.orderRef || String(result.orderRef).toUpperCase() === mine.orderRef.toUpperCase()) {
      if (!result.orderRef) result.orderRef = mine.orderRef;
      const before = result.itemsCheck;
      if (mine.items.length && (mine.itemsCheck.complete || !before || before.complete !== true || amazonSplit.length > 1)) {
        result.items = mine.items; result.itemsCheck = mine.itemsCheck;
      } else if (mine.items.length && result.items.length === mine.items.length) {
        // (The general reading added up: only the whole titles are taken from Amazon's own.)
        result.items = result.items.map((it, k) => mine.items[k].name.startsWith(it.name) ? { ...it, name: mine.items[k].name } : it);
      }
      if (amazonSplit.length > 1 || mine.totalPence !== result.totalPence) { result.totalPence = mine.totalPence; result.currency = "GBP"; }
      if (mine.giftCardPence) result.giftCardPence = mine.giftCardPence;
      if (mine.cardPaid) result.cardPaid = mine.cardPaid;
    }
  }
  // (Apple's newer invoice sets the app, its plan and the renewal in one cell, "iCloud iCloud+ with 200 GB (Monthly) Renews
  // 18 September 2025": the plan is what was bought, the renewal day not part of its name. Round 15.)
  if (/(^|\.)apple\.com$/i.test(result.retailer.domain || sender?.domain || "")) for (const i of result.items) {
    let n = String(i.name || "").replace(/\s+Renews\s+\d{1,2}\s+\p{L}{3,9}\.?\s+\d{4}$/u, "");
    const rep = /^(\S{2,30})\s+(\1\S{0,3}\s.{3,})$/u.exec(n);
    if (rep) n = rep[2];
    if (n && n !== i.name) i.name = n;
  }
  // (A marketplace's number for the line run onto the thing's name, "Stoneware Mug - Transaction ID: 5512340987": never part
  // of what it is called. Round 22.)
  for (const i of result.items) { const n = String(i.name || "").replace(/\s[-–]\s{1,3}transaction id:\s?\d{5,15}$/i, ""); if (n && n !== i.name && n.length >= 3) i.name = n; }
  // A row named only by its place in a table ("SIM 1 | ORDA… | eSIM | -- | National Plus | National | £5.00", Lycamobile):
  // the thing bought is the row's name-like cell, the plan, not "SIM 1". Round 10.
  for (const i of result.items) {
    if (!/^(?:sim|line|item|row|s\.?\s?no\.?)\s*\d{1,2}$/i.test(String(i.name || "")) || !i.variant) continue;
    const named = String(i.variant).split(", ").find((p) => /\p{Ll}/u.test(p) && (p.match(/\p{L}/gu) || []).length >= 5 && !/^e-?sim$|^(?:national|international|monthly|weekly|prepaid|pay as you go)$/i.test(p) && !/\d{6,}/.test(p));
    if (named) { const rest = String(i.variant).split(", ").filter((p) => p !== named && !/^[A-Z0-9]{10,}$/.test(p)); i.name = named; if (rest.length) i.variant = rest.join(", "); else delete i.variant; }
  }
  // No total written, one thing bought, and its price the only amount anywhere in the email: that is what was paid.
  // (Or several of it on one line with the line's price, "SKATE SESSION 18:00pm", "×2 |", "£24.00": that line's price, read as
  // the whole line's and not one ticket's, is still the only amount. Round 22.)
  const oneLine = (it) => (it.qty || 1) === 1 || (it.lineTotal === true && !it.ambiguous && it.unitPence == null);
  if (result.totalPence == null && result.items.length === 1 && Number.isInteger(result.items[0].pricePence) && oneLine(result.items[0])) {
    const amounts = [...new Set([...text.matchAll(/£\s?(\d[\d,]*\.\d{2})/g)].map((m) => money(m[1])))];
    // (Not a ticket sent again on its own: its price is that ticket's, not what the order came to. Round 12.)
    if (amounts.length === 1 && amounts[0] === result.items[0].pricePence && !ticketOrder) { result.totalPence = amounts[0]; result.currency = "GBP"; result.totalFrom = "only_amount"; result.itemsCheck = { ...(result.itemsCheck || {}), complete: true, itemsPence: amounts[0], expectedPence: amounts[0], missingPence: 0 }; }
  }
  const stated = statedItemCount(text) ?? (otherPart ? statedItemCount(otherPart) : null) ?? statedItemCount(String(subject || ""));
  if (stated) result.itemCount = stated;
  // The email says how many things were bought, and the items read are not that many (counted as lines or as units):
  // some were missed, or something that isn't an item was read as one, even when the money adds up (a free item).
  if (stated && result.items.length && result.itemsCheck && result.itemsCheck.complete !== false && !isFlight && !journey && !gameShop &&
      stated !== result.items.length && stated !== result.items.reduce((n, i) => n + (i.qty || 1), 0)) {
    result.itemsCheck = { ...result.itemsCheck, complete: false, countStated: stated, countRead: result.items.length };
  }
  // A train ticket read only as its fare ("Advance Single (Standard)", "1 Adult" with "Anytime Day Return") when the email
  // never says where it goes (a pasted body without its subject): the thing bought, the journey, is missing. Round 8.
  const FARE = /\b(?:(?:super )?off-?peak|anytime|advance|open|flexi\w*|saver|standard|first(?: class)?|day)\b[^|]{0,20}\b(?:single|return)\b|\b(?:single|return)\b[^|]{0,6}\((?:standard|first(?: class)?)\)/i;
  if (!isFlight && !journey && result.items.length && result.items.every((i) => FARE.test(String(i.name || "")) || (/^(?:\d+\s+)?(?:adults?|child(?:ren)?|seniors?|passengers?)$/i.test(String(i.name || "")) && FARE.test(String(i.variant || "")))) &&
      !/\b\p{Lu}[\p{L}'’.&-]+(?: [\p{Lu}(][\p{L}'’.&()-]*){0,4} to \p{Lu}[\p{L}'’.&-]+/u.test(text + "\n" + (otherPart || "")) && result.itemsCheck && result.itemsCheck.complete !== false) {
    result.itemsCheck = { ...result.itemsCheck, complete: false, fareOnly: true };
  }
  // No items read is never "complete", even when there is no total to compare with.
  if (!result.items.length && result.itemsCheck && result.itemsCheck.complete !== false) result.itemsCheck = { ...result.itemsCheck, complete: false };
  // (A shop visit's receipt that only links to its itemised receipt, "View itemised receipt", with the money and no list: it
  // lists no items, and says so, rather than taking a money line for one. Round 12.)
  if (!result.items.length && !noList && result.itemsCheck && /\bview (?:your |the )?(?:itemi[sz]ed|full|detailed) receipt\b/i.test(text.slice(0, 3000))) result.itemsCheck = { ...result.itemsCheck, noItemList: true };
  // Gmail cut the email short ("[Message clipped]  View entire message"): what came after the cut isn't in it, so the items
  // can never be called complete, even when what is there adds up.
  if (CLIPPED.test(text) || (otherPart && CLIPPED.test(otherPart))) result.itemsCheck = { ...(result.itemsCheck || {}), complete: false, clipped: true };
  if (saysAttached && !result.items.length) { result.detailsInAttachment = attachedDoc.kind; result.itemsCheck = { ...(result.itemsCheck || {}), complete: false, inAttachment: attachedDoc.kind }; }
  // (A platform's receipt that is only a picture in the email, or names no things at all: said so, never guessed. Round 20.)
  if (ePlatPicture && !result.items.length && result.totalPence == null) { result.detailsInAttachment = "image"; result.itemsCheck = { ...(result.itemsCheck || {}), complete: false, inAttachment: "image" }; }
  if (ePlatNoList && !result.items.length) result.itemsCheck = { ...(result.itemsCheck || {}), complete: false, noItemList: true };
  // (Words around an item that aren't a detail of it: a link, "Review this item", the day a programme first aired,
  // "Original Air Date: September 16, 2019", or the item's own title cut short, "Harry Potter and the Philosopher'". Round 13.)
  for (const i of result.items) if (i.variant) {
    const nm = String(i.name || "").toLowerCase();
    const v = String(i.variant).replace(/\b(?:original air date|release date)\s*:\s*[\p{L}]+\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}|\b(?:original air date|release date)\s*:\s*\d{1,2}(?:st|nd|rd|th)? [\p{L}]+\.?,? \d{4}/giu, "").split(/,\s*/).filter((p) => { const t = p.trim(), l = t.toLowerCase().replace(/(?:\.\.\.|…)$/, "").trim();
      return t && !/^(?:review this (?:item|product)|write a (?:product )?review|buy it again|view (?:your )?item|original air date\b.*|release date\s*:.*)$/i.test(t) && !(l.length >= 8 && l.length < nm.length && nm.startsWith(l)); }).join(", ");
    if (v === String(i.variant).split(/,\s*/).join(", ")) continue;
    if (v) i.variant = v; else delete i.variant;
  }
  // (A name the email itself cut short, "Harbourline Insulated Lunch Bag f...", read without its dots: the list is flagged, so
  // the app never passes a cut name off as whole. Round 13.)
  // (Not a payment service's receipt: PayPal cuts every long name and never gives it whole, so its name is said as given.)
  // (A book's author written surname first, "Lane, Robin", read as the thing bought from the lines of a pasted page: the title
  // on the line above it is, named as Amazon's text part names it, "Title of Lane, Robin". Round 21b.)
  for (const i of result.items) {
    const nm = String(i.name || "");
    if (!/^\p{Lu}[\p{L}'’-]{1,24}, \p{Lu}[\p{L}.'’-]{0,20}(?: \p{Lu}[\p{L}.'’-]{0,20}){0,2}$/u.test(nm)) continue;
    for (const t of [text, otherPart]) {
      const ls = String(t || "").split("\n").map((l) => l.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
      const k = ls.indexOf(nm);
      if (k < 1 || !/^(?:sold by\b|condition\s*:)/i.test(ls[k + 1] || "")) continue;
      const over = ls[k - 1];
      if (over.length < 20 || over.length > 220 || /£|^(?:view|order|placed|qty|quantity)\b|:$/i.test(over)) continue;
      i.name = over.replace(/\s*(?:\.\.\.|…)$/, "") + " of " + nm;
      break;
    }
  }
  // (Or a book's title cut short with its author put after it, "Plain Speaking: Revised of Lane, Robin". Round 21b.)
  const cutForms = (n) => { const s = String(n || ""), k = s.lastIndexOf(" of "); return k >= 8 ? [s, s.slice(0, k)] : [s]; };
  const cutShort = viaPayPal ? [] : result.items.filter((i) => i.name && String(i.name).length >= 8 && [text, otherPart].some((t) => t && cutForms(i.name).some((n) => n.length >= 8 && ["...", "…"].some((dots) => t.includes(n + dots)))));
  if (cutShort.length) result.cutShortNames = true;
  if (cutShort.length && result.itemsCheck) result.itemsCheck = { ...result.itemsCheck, complete: false, namesCut: true, namesOk: false, suspectNames: [...(result.itemsCheck.suspectNames || []), ...cutShort.map((i) => ({ name: String(i.name).slice(0, 120), why: "cut" }))].slice(0, 10) };
  // (A product named by its model above its style code, "608" over "Style #:" over "WX608RG1", then its size and colour: the
  // thing bought is the model, its colour a detail. Only when the email labels the code. Round 14.)
  if (result.items.length) {
    const ls = String(fromHtml || text).split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean).slice(0, 4000);
    for (const it of result.items) {
      const at = ls.indexOf(String(it.name || "").trim());
      if (at < 2) continue;
      for (let j = at - 1; j >= Math.max(1, at - 4); j--) {
        // (Only the item's own lines between: a price or a quantity there belongs to the item before.)
        if (/£|\b(?:qty|quantity|price)\b/i.test(ls[j])) break;
        if (!/^(?:style|style no\.?|model(?: no\.?)?)\s*#?\s*:?(?:\s*[A-Z0-9-]{4,20})?$/i.test(ls[j])) continue;
        const nm = ls[j - 1];
        if (nm && !result.items.some((o) => o !== it && String(o.name || "").trim() === nm) && nm.length >= 3 && nm.length <= 80 && /^[\p{L}\d][\p{L}\d '’&.+/-]*$/u.test(nm) && !/:|£|\b(?:order|qty|quantity|price|total|size)\b/i.test(nm)) {
          // (With the style code and the size between, "AB123CD4", "UK Size: UK 7 - D": details of it too, the size by its
          // value. Round 18.)
          const between = ls.slice(j, at).map((x) => x.replace(/^(?:style|style no\.?|model(?: no\.?)?)\s*#?\s*:?\s*/i, "").replace(/^(?:(?:uk |eu |us )?size)\s*:\s*/i, "").trim())
            .filter((x) => x && x.length <= 40 && !/£|:/.test(x) && x !== it.name && !String(it.variant || "").split(", ").includes(x));
          it.variant = [...between, it.name, it.variant].filter(Boolean).join(", "); it.name = nm; if (!/\p{L}{2}/u.test(nm)) it.namedBy = "model";
        }
        break;
      }
    }
  }
  for (const i of result.items) delete i.unitPence;
  // A drink at £0.00 then its measure with the price ("SAILOR JERRY RUM £0.00", "50ml £10.45"): one drink, that size, that
  // price. Round 12.
  for (let k = 0; k + 1 < result.items.length; k++) {
    const a = result.items[k], b = result.items[k + 1];
    if (a.pricePence === 0 && /^\d+(?:\.\d+)?\s?(?:ml|cl|l|g|kg|oz)$/i.test(String(b.name || "").trim()) && b.pricePence) {
      result.items.splice(k, 2, { ...b, name: `${a.name} ${b.name.trim()}` });
      result.itemsCheck = checkItems(result.items, moneyOf(text), result.totalPence);
    }
  }
  // One thing, priced before tax, with the tax on its own line and the total after it ("Meta Quest+ £6.66", "Tax included:
  // £1.33", "Today's total: £7.99"): what it cost is the total. Round 12.
  if (result.items.length === 1 && result.totalPence != null && result.itemsCheck && result.itemsCheck.complete === false && result.items[0].pricePence != null) {
    const tax = /^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*(?:tax|vat)(?: included| charged| \(\d{1,2}%\))?\s*:?\s*\|?\s*£\s?([\d,]+\.\d{2})/im.exec(text);
    const it = result.items[0];
    if (tax && (it.qty || 1) === 1 && it.pricePence + money(tax[1]) === result.totalPence) {
      it.pricePence = result.totalPence;
      result.itemsCheck = checkItems(result.items, moneyOf(text), result.totalPence);
    }
  }
  // A membership or trial bought through a billing company for a website it names ("You've just bought 2-day trial Example
  // membership", "Website | example.com", "Receipt 291429567"): the membership is the item, the website the shop, the
  // receipt's number the reference. Any biller, any site. Round 12.
  // A list of what was ordered with no prices ("1x Large 13.5" Texas BBQ®", "+ Classic Crust", "1x Strippers Combo"), the
  // prices only in the total: the things bought, each with how many and its extras, and no price made up. Round 13.
  // (Some lines can carry a price, "1x Any Large Pizza £15", "1x Family Box Deal for £24.99", and the rest none: then the
  // reader's own list can be just the last line at the whole total. The whole list is read instead. Round 16.)
  const oneAtTotal = result.items.length === 1 && result.totalPence != null && result.items[0].pricePence === result.totalPence && /^\d{1,2}\s?[x×]\s/m.test(text);
  if ((!result.items.length || oneAtTotal) && !isFlight && !journey) {
    const rows = String(text).split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
    const got = [];
    let inItem = false;
    for (const r of rows.slice(0, 2000)) {
      if (got.length >= 60) break;
      // ("1x 21 Chicken Kickers™": a name can start with a number. A deal set out as a line, "1x 40% off …", is not a thing.)
      // (A deal's name can carry its terms, "Medium Pizza for £9.99 Each When You Buy Any Side": the name, with no
      // price of its own. One that ends "for" before its price, "1x Family Box Deal for £24.99", keeps the price in its
      // name too. Round 16.)
      const m = /^(\d{1,2})\s?[x×]\s+((?:\p{Lu}|\d{1,3}\s\p{Lu})[^£|]{2,80}?)(?:\s+£\s?(\d{1,3}(?:\.\d{2})?))?$/u.exec(r) ||
        /^(\d{1,2})\s?[x×]\s+((?:\p{Lu}|\d{1,3}\s\p{Lu})[^£|]{2,60}? for £\s?\d{1,3}(?:\.\d{2})? (?:[Ee]ach|[Ww]hen|[Ww]ith|[Ii]f)\b[^£|]{2,60})()$/u.exec(r);
      let terms = null;
      if (m && m[3] && / for$/i.test(m[2])) m[2] = m[2].replace(/ for$/i, "");
      else if (m && !m[3] && / for £/.test(m[2])) { const at = m[2].indexOf(" for £"); terms = m[2].slice(at + 1); m[2] = m[2].slice(0, at); }
      if (m && (/%\s*off\b|\bspend\b|\bvoucher\b/i.test(m[2]) || (!m[3] && /\bfree\b|\bdeal\b/i.test(m[2])))) { inItem = false; continue; }
      // (Who a booking was for, "2 x Adults", "2 x Games": not a thing bought. Round 15e.)
      if (m && /^(?:adults?|child(?:ren)?|kids?|games?|people|persons?|guests?|players?|seniors?|students?|infants?)$/i.test(m[2].trim())) { inItem = false; continue; }
      if (m) { got.push({ name: m[2].trim(), qty: Number(m[1]), pricePence: m[3] ? Math.round(Number(m[3]) * 100) : null, ...(m[3] && Number(m[1]) > 1 ? { lineTotal: true } : {}), ...(terms ? { variant: terms } : {}) }); inItem = true; continue; }
      if (got.length && /^\+\s?\p{L}[^£|]{1,60}$/u.test(r)) { const it = got[got.length - 1]; it.variant = [it.variant, r.replace(/^\+\s?/, "").trim()].filter(Boolean).join(", "); continue; }
      // (A choice under an item with no "+", "No Mushrooms", "Pork Meatballs": the item's extra, and the list goes on. Round 15.)
      if (inItem && r.length <= 40 && /^\p{Lu}[\p{L}\p{N}'’"&.,™® -]{1,39}$/u.test(r) && !/\b(?:delivery|total|vat|subtotal|order|paid|payment|collection|address)\b/i.test(r)) {
        const it = got[got.length - 1]; it.variant = [it.variant, r.trim()].filter(Boolean).join(", "); continue;
      }
      inItem = false;
      if (got.length >= 2 || (oneAtTotal && got.length)) break;
    }
    // (The email gives no prices, so nothing can be added up: the check says so, never that something is missing.)
    const fitsOne = !oneAtTotal || got.some((g) => String(result.items[0].name || "").toLowerCase().startsWith(g.name.toLowerCase()));
    // (One thing alone, its line read as the whole total though the email adds delivery to it: what it cost is the total
    // less what was added. A deal's terms in its name go with its details. Round 16.)
    if (oneAtTotal && got.length === 1 && fitsOne && got[0].pricePence == null) {
      const mon1 = moneyOf(text), rest = (mon1.fees || 0) + (mon1.tips || 0) - (mon1.discounts || 0);
      if (rest > 0 && result.totalPence - rest > 0) {
        const it = { ...result.items[0], pricePence: result.totalPence - rest };
        if (got[0].variant && it.name.toLowerCase() !== got[0].name.toLowerCase()) { it.name = got[0].name; it.variant = [got[0].variant, it.variant].filter(Boolean).join(", "); }
        result.items = [it]; result.itemsCheck = checkItems(result.items, mon1, result.totalPence);
      }
    }
    if (got.length >= 2 && fitsOne) {
      result.items = got;
      const priced = got.filter((g) => g.pricePence != null);
      result.itemsCheck = priced.length === got.length ? checkItems(got, moneyOf(text), result.totalPence)
        : { complete: null, itemsPence: priced.reduce((a, g) => a + g.pricePence, 0), expectedPence: result.totalPence ?? null, missingPence: null, noPrices: true };
    }
  }
  // (A restaurant app's order summary that prices each thing without a pound sign, "Lunch Buffet" over "10.50", "Lemonade"
  // over "3.20", the parts of a meal deal on the rows under it with no price ("Kids Chips"), then "Subtotal" and "Total: £27.40":
  // each thing at its price, its parts as its details, when they come to the total. Round 16.)
  if (!result.items.length && !isFlight && !journey && Number.isInteger(result.totalPence)) {
    const rows = String(fromHtml || text).split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean).slice(0, 1500);
    const got = [];
    for (let k = 0; k + 1 < rows.length && got.length < 40; k++) {
      if (/^(?:sub-?\s?total|total)\b/i.test(rows[k])) { if (got.length) break; continue; }
      if (!/\p{L}|\d/u.test(rows[k].replace(/&[a-z]+;/g, ""))) continue;
      const nm = /^\p{L}[^£$€|]{1,60}$/u.test(rows[k]) && !/^(?:order|table|hut|store|order number|your order)\b/i.test(rows[k]);
      const one = /^(\p{L}[^£$€|]{1,60}?)\s*\|\s*(\d{1,4}\.\d{2})$/u.exec(rows[k]);
      if (one && !/^(?:sub-?\s?total|total|vat|tip|service)\b/i.test(one[1])) { got.push({ name: one[1].trim(), qty: 1, pricePence: money(one[2]) }); continue; }
      if (nm && /^\d{1,4}\.\d{2}$/.test(rows[k + 1])) { got.push({ name: rows[k].trim(), qty: 1, pricePence: money(rows[k + 1]) }); k++; continue; }
      if (got.length && nm && rows[k].length <= 40 && !/\d{3}/.test(rows[k])) { const it = got[got.length - 1]; it.variant = [it.variant, rows[k].trim()].filter(Boolean).join(", "); continue; }
      if (got.length) break;
    }
    // (The same thing twice running is two of it.)
    const merged = [];
    for (const g of got) { const last = merged[merged.length - 1]; if (last && last.name === g.name && last.unit === g.pricePence && !g.variant && !last.variant) { last.qty++; last.pricePence += g.pricePence; continue; } merged.push({ ...g, unit: g.pricePence }); }
    const sum = merged.reduce((a, g) => a + g.pricePence, 0);
    if (merged.length && Math.abs(sum - result.totalPence) <= 1) {
      result.items = merged.map(({ unit, ...g }) => (g.qty > 1 ? { ...g, lineTotal: true } : g));
      result.itemsCheck = { complete: true, itemsPence: sum, expectedPence: result.totalPence, missingPence: 0 };
    }
  }
  // (The thing bought set out under labels of its own, "Product" over "Spring Posy", "Price" over "£24.00", then the payment's
  // money: that thing at that price. Round 16.)
  if ((!result.items.some((i) => namesCheck([i], { shop: result.retailer.name || "" }).namesOk) || !result.items.some((i) => i.pricePence > 0)) && !isFlight && !journey) {
    const pr = /^[ \t|]*product(?: name)?[ \t|]*\n[\s|]*(\p{L}[^\n|£]{1,80}?)[ \t|]*\n[\s|]*price[ \t|]*\n[\s|]*£\s?([\d,]+\.\d{2})[ \t|]*$/imu.exec(fromHtml || text);
    if (pr) {
      result.items = [{ name: pr[1].trim(), qty: 1, pricePence: money(pr[2]) }];
      result.itemsCheck = checkItems(result.items, moneyOf(fromHtml || text), result.totalPence);
    }
  }
  // (One thing over its total and the order's and item's numbers, eBay's "Board Game Classic Edition (…) Free UK Post,
  // Good" / "Total : £6.50" / "Order number : 12-…" / "Item number : 3300…": that thing, at that total. Round 16.)
  if (!result.items.length && !isFlight && !journey && Number.isInteger(result.totalPence)) {
    const one = /^[ \t|]*(\p{L}[^\n|£]{7,160}?)[ \t|]*\n[\s|]*total\s*:?\s*£\s?([\d,]+\.\d{2})[ \t|]*\n[\s|]*(?:order|item) (?:number|no\.?)\b/imu.exec(fromHtml || text);
    if (one && money(one[2]) === result.totalPence && !/^(?:sub-?\s?total|delivery|postage|shipping|total|order)\b/i.test(one[1])) {
      result.items = [{ name: one[1].trim(), qty: 1, pricePence: result.totalPence }];
      result.itemsCheck = { complete: true, itemsPence: result.totalPence, expectedPence: result.totalPence, missingPence: 0 };
    }
  }
  let subjectNamed = false;
  // (An order email that lists nothing but names the order in its subject, Amazon's 'Your Amazon.co.uk order of "Garden Hose
  // VS-600 HDMI..."': that is what was bought, its name as the subject cuts it, with no price made up; "and 4 more item(s)"
  // says how many more there are. Round 16.)
  if (!result.items.length && !isFlight && !journey) {
    const so = /\border of\s+["“]([^"”\n]{3,120}?)["”](?:\s+and\s+(\d{1,3})\s+more\s+items?(?:\(s\))?)?\s*$/i.exec(String(subject || "").replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, ""));
    if (so) {
      subjectNamed = true;
      const name = so[1].replace(/\s*(?:\.{3}|…)\s*$/, "…").trim();
      result.items = [{ name, qty: 1, pricePence: null }];
      if (so[2]) result.itemCount = 1 + Number(so[2]);
      // (Its name cut short and no price of its own: the receipt says some details may be missing.)
      result.itemsCheck = { complete: false, itemsPence: 0, expectedPence: result.totalPence ?? null, missingPence: null, nameFromSubject: true };
    }
  }
  if (!result.items.length && result.totalPence != null) {
    const flatT = String(fromHtml || text).replace(/[\s|]+/g, " ");
    const bought = /\byou(?:'|’)?ve just bought (.{3,80}?)\s?\.(?:\s|$)/i.exec(flatT) || /\bthank you for buying (.{3,80}?)(?:\s(?:receipt|dear|hi|hello)\b|[.!])/i.exec(flatT);
    // (Or where the email says it was sent from, "because of your activity on example.com", when its "Website" is only a
    // page's path. Round 21.)
    const site = /\bwebsite\s*:?\s+((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i.exec(flatT) || /\bbecause of your activity on ((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i.exec(flatT);
    if (bought && /\b(?:membership|subscription|trial|plan|pass)\b/i.test(bought[1])) {
      result.items = [{ name: bought[1].trim(), qty: 1, pricePence: result.totalPence }];
      const siteDomain = site ? site[1].toLowerCase() : null;
      // (No website named at all: the billing company is the shop, by its name and not its mailbox's, "Example Info" from
      // info@example.com is "Example". Round 21.)
      const role = /^(.{2,40}?)\s+(?:info|support|billing|team|notifications?|no-?reply)$/i.exec(String(result.retailer.name || ""));
      if (!siteDomain && role && domainBase(String(result.retailer.domain || "")) === role[1].toLowerCase().replace(/[^a-z0-9]/g, "")) result.retailer = { ...result.retailer, name: role[1] };
      if (siteDomain && siteDomain !== String(result.retailer.domain || "").toLowerCase()) {
        const bases = [domainBase(siteDomain), siteDomain.split(".")[0]].map((b) => b.replace(/-/g, ""));
        const named = (bought[1].match(/[\p{L}\d]+/gu) || []).find((w) => bases.includes(w.toLowerCase()));
        const base = named || bases[1];
        result.retailer = { ...result.retailer, name: named || base.charAt(0).toUpperCase() + base.slice(1), domain: siteDomain };
      }
      const rn = /\breceipt\s*(?:number|no\.?|#)?\s*:?\s*(\d{6,14})\b/i.exec(flatT);
      if (!result.orderRef && rn) result.orderRef = rn[1];
      result.itemsCheck = checkItems(result.items, moneyOf(text), result.totalPence);
    }
  }
  // A credit set out like an item under the one thing bought ("Unused time on Claude Pro after 26 Oct 2026", "Qty 1",
  // "-£11.10"): kept as that item's detail, so the card says why less was paid. Round 12.
  // (Written so blank rows between them never make it slow: an email with thousands of them took minutes. Round 14.)
  // A receipt's text part run into one line (Stripe's "Receipt #2343-9135 Oct 26–Nov 26, 2026 Max plan Qty 1 £75.00 Unused
  // time on … Qty 1 -£11.10 Subtotal …"): each "name Qty n £x" after the receipt number is a thing bought; one taken off
  // ("-£11.10") is not. Read only when nothing else was, and only straight on from the receipt number. Round 15.
  if (!result.items.length && !fromHtml) {
    const at = /\bReceipt\s*#\s*[\d-]{4,20}[ \t]+/i.exec(text);
    if (at) {
      let pos = at.index + at[0].length;
      const period = /(?:[A-Z][a-z]{2,8} \d{1,2}(?:, \d{4})?[ \t]*[–-][ \t]*[A-Z][a-z]{2,8} \d{1,2}, \d{4}[ \t]+)?/y; period.lastIndex = pos; if (period.exec(text)) pos = period.lastIndex;
      const seg = /(\p{L}[^£\n]{1,80}?)[ \t]+Qty[ \t]+(\d{1,3})[ \t]+([-−]?)£[ \t]?([\d,]+\.\d{2})[ \t]*/uy;
      const got = [];
      for (let m; got.length < 30 && (seg.lastIndex = pos, m = seg.exec(text)); pos = seg.lastIndex) {
        if (m[3]) continue;
        const qty = +m[2] || 1;
        got.push({ name: m[1].trim(), qty, pricePence: money(m[4]), ...(qty > 1 ? { lineTotal: true } : {}) });
      }
      if (got.length) { result.items = got; result.itemsCheck = checkItems(result.items, moneyOf(text), result.totalPence); }
    }
  }
  if (result.items.length === 1) {
    const cr =/^[ \t|]*(\p{L}[^\n|£]{8,80}?)[ \t|]*\n[\s|]*qty\s*:?\s*1[ \t|]*\n[\s|]*[-−–]\s?£\s?([\d,]+\.\d{2})[\s|]*$/imu.exec(fromHtml || text);
    if (cr && !/\b(?:discount|voucher|promo)/i.test(cr[1])) { const it = result.items[0]; const note = `${cr[1].trim()} −£${cr[2]}`; it.variant = it.variant ? `${it.variant}, ${note}` : note; }
  }
  // A stay booked through a booking site: the room is the item, and the hotel it is at ("Your booking is confirmed at
  // citizenM Paris Charles de Gaulle Airport") is its detail, so the card says where. Round 12.
  const stayAt = /\b(?:booking|reservation|stay) is confirmed at (.{3,80}?)\s*$/i.exec(String(subject || "")) || /\bconfirmed at (.{3,80}?)\s*$/im.exec(String(text).slice(0, 600));
  if (stayAt && result.items.length === 1 && !result.items[0].variant && /\b(?:room|suite|apartment|studio|bed|dorm|villa|cabin|lodge|house)\b/i.test(result.items[0].name)) result.items[0].variant = stayAt[1].replace(/[.!|]+$/, "").trim();
  // The name check (item-names.js, round 9): money that adds up says nothing about the names. A name that looks like a note,
  // a label, a size or a code makes namesOk false (with suspectNames), and the app says some names may not be right.
  if (result.items.length && result.itemsCheck) result.itemsCheck = { ...result.itemsCheck, ...namesCheck(result.items, { shop: (result.retailer && result.retailer.name) || "" }) };
  // (A thing named only by the subject, its name cut short, no price: some of it is missing.)
  if (subjectNamed && result.items.length === 1 && result.items[0].pricePence == null) result.itemsCheck = { ...(result.itemsCheck || {}), complete: false, nameFromSubject: true };
  // (A subscription bought, "Your purchase of Game Club Plus has been processed", "We've charged GBP 9.49", with
  // "Subscription: Game Club Plus" and no list: the subscription is the thing, for what was charged. Round 20.)
  if (!result.items.length && result.totalPence != null) {
    const sn = /^[ \t|]*subscription\s*:[ \t]*(\p{L}[^\n|£]{1,60}?)[ \t|]*$/imu.exec(text.slice(0, 8000));
    if (sn && /\bwe(?:'|’)?ve charged\b|\bthanks? (?:you )?for subscribing\b/i.test(text.slice(0, 4000))) {
      result.items = [{ name: sn[1].trim(), qty: 1, pricePence: result.totalPence }];
      result.itemsCheck = { complete: true, itemsPence: result.totalPence, expectedPence: result.totalPence, missingPence: 0, namesOk: true };
    }
    // (Or a purchase confirmed with what was chosen, "You've chosen: Fast Wi-Fi" over "Cost: 4.00 GBP".)
    const ch = !result.items.length && /^[ \t|]*cost\s*:/im.test(text.slice(0, 6000)) ? /^[ \t|]*you(?:'|’)ve chosen\s*:[ \t]*(\p{L}[^\n|£]{1,60}?)[ \t|]*$/imu.exec(text.slice(0, 6000)) : null;
    if (ch) {
      result.items = [{ name: ch[1].trim(), qty: 1, pricePence: result.totalPence }];
      result.itemsCheck = { complete: true, itemsPence: result.totalPence, expectedPence: result.totalPence, missingPence: 0, namesOk: true };
    }
  }
  // (A pre-order with no price: what was bought, with nothing said of what it cost.)
  if (preOrder && result.totalPence == null && result.items.length === 1 && result.items[0].pricePence == null) result.itemsCheck = { ...(result.itemsCheck || {}), complete: false, itemsPence: 0, expectedPence: null, missingPence: null };
  // (A shop's till receipt sent by email, "E-Receipt", "Item | Price", each line in pounds with no "£" and "TOTAL" with how
  // many things: its own lines, when they come to the total. Round 20.)
  {
    const till = tillEReceipt(fromHtml || text) || (fromHtml && text !== fromHtml ? tillEReceipt(text) : null);
    if (till && (result.totalPence == null || result.totalPence === till.totalPence) && !(result.itemsCheck && result.itemsCheck.complete === true && result.items.length >= till.items.length)) {
      result.items = till.items; result.totalPence = till.totalPence; result.currency = "GBP";
      result.itemsCheck = { ...checkItems(result.items, moneyOf(fromHtml || text), result.totalPence), ...namesCheck(result.items, { shop: (result.retailer && result.retailer.name) || "" }) };
    }
  }
  // (A takeaway's own ordering page's email, "Pcs | Name | Total", each thing over its price and the money added and taken off
  // under the subtotal: its own lines, when they come to the total. Round 20.)
  if (!result.items.length || result.totalPence == null) {
    const po = pcsOrder(fromHtml || text) || (fromHtml && text !== fromHtml ? pcsOrder(text) : null);
    if (po && (result.totalPence == null || result.totalPence === po.totalPence)) {
      result.items = po.items; result.totalPence = po.totalPence; result.currency = "GBP";
      if (po.fees.length) result.fees = po.fees; else delete result.fees;
      if (po.discounts.length) result.discounts = po.discounts; else delete result.discounts;
      // (Checked whole by pcsOrder: the things come to the subtotal, and with what was added and taken off, to the total.)
      const sub = po.items.reduce((a, x) => a + x.pricePence, 0);
      result.itemsCheck = { complete: true, itemsPence: sub, expectedPence: sub, missingPence: 0, ...namesCheck(result.items, { shop: (result.retailer && result.retailer.name) || "" }) };
    }
  }
  // (A phone network's plan order paid by the month, "Total upfront cost £0.00" or "Pay today: £0.00" beside "Total monthly
  // cost £21.00": a contract, not a one-off purchase. A SIM plan alone is not a purchase at all; a device on it, "Tablet
  // 10 | Grey" at "£15.00" "For 24 months", is the thing bought, said once, with what it costs a month and no made-up total.
  // Round 16.)
  if (!opts.lenient) {
    const flatM = text.slice(0, 20000).replace(/[\s|]+/g, " ");
    if (/\b(?:total upfront cost|upfront cost|pay today|(?:total )?(?:cost )?paid today|due today)\s*:?\s*£\s?0(?:\.00)?\b/i.test(flatM) && /\b(?:total |additional )?monthly (?:cost|price|payment)\b|\bcontract (?:length|start date)\b/i.test(flatM)) {
      const PLAN = /\bsim\b|\bplan\b|\bunlimited\b|\b\d{1,2}m\b|^for \d{1,2} months?$|^\(?increases?\b|^(?:monthly )?discounts?\b|^delivery\b|^your (?:current )?(?:phone )?plan\b|^(?:scam guard|no spend cap|add-?ons?|extras?|roam(?:ing)?\b.*|deposit|data gifting|insurance)\b/i;
      const seen = new Set(), devices = [];
      for (const it of result.items) { const n = String(it.name || "").trim(); if (!n || it.pricePence == null || PLAN.test(n) || /^(?:additional items?|your (?:new )?plan|plan (?:name|cost|description))\b/i.test(n) || seen.has(n.toLowerCase())) continue; seen.add(n.toLowerCase()); devices.push({ name: n, qty: 1, pricePence: null }); }
      if (!devices.length) return { ok: false, reason: "contract", source: "shopper_email" };
      const per = /£\s?(\d{1,4}\.\d{2})\s+for (\d{1,2}) months\b/i.exec(flatM);
      if (per && devices.length === 1) devices[0].variant = `£${per[1]} a month for ${per[2]} months`;
      result.items = devices; result.totalPence = null; delete result.fees; delete result.discounts;
      result.itemsCheck = { complete: null, itemsPence: 0, expectedPence: null, missingPence: null, paidMonthly: true };
    }
  }
  // (The day after an order, "Got a minute to tell us about your last order?", "Start the survey": asking about an order, no
  // money in it, nothing priced. Not a purchase. Round 16.)
  if (!opts.lenient && result.totalPence == null && !result.items.some((i) => Number.isInteger(i.pricePence) && i.pricePence > 0) && SURVEY_TOP.test(text.slice(0, 3000).replace(/\s+/g, " "))) {
    return { ok: false, reason: "survey", source: "shopper_email" };
  }
  // (Something free, "Sky Racers (Game) £0.00", "Total: £0.00", with no money anywhere in the email but what a trial will cost
  // later, "Recurring Subscription Fee: £7.99 will be charged on 01/04/2026": nothing was paid, so it is not a purchase. A
  // free film bought with a promotion, "£3.99" then "Promotions: -£3.99", still shows its price, and stays one. Round 16.)
  if (!opts.lenient && result.totalPence === 0 && !result.items.some((i) => Number.isInteger(i.pricePence) && i.pricePence > 0)) {
    const paid = text.slice(0, 30000).split("\n").filter((l) => !/\bwill be (?:charged|taken|billed)\b|\bafter (?:the|your) (?:free )?trial\b|\bthen £|\bper (?:month|year)\b/i.test(l)).some((l) => /£\s?(?!0+(?:\.00)?(?![\d.,]))\d/.test(l));
    // (Only for something digital, a game, an add-on or a trial, which nothing was given for: a free thing posted out, a
    // replacement or a free gift, is still an order to keep track of.)
    if (!paid && /\bdigital content\b|\bin-game\b|\((?:full )?game\)|\(trial\)|\badd-?on\b|\bdlc\b|\bfree trial\b|\bseason pass\b|\bstart downloading\b/i.test(text.slice(0, 20000))) return { ok: false, reason: "free", source: "shopper_email" };
  }
  // (An advert in an order app's own layout, "Fill your cart with great deals" "Order now", "Discover a new favourite...", "Come
  // back and taste the Top Eats" "Browse restaurants": no total, no order number, nothing that says an order was placed, and
  // a call to order or browse. Its offers are not things bought. Round 16.)
  if (!opts.lenient && !isFlight && result.totalPence == null && !result.orderRef) {
    const topA = text.slice(0, 4000).replace(/\s+/g, " ");
    if (ADVERT_TOP.test(topA) && !PLACED_TOP.test(topA)) return { ok: false, reason: "promotional", source: "shopper_email" };
  }
  if (!opts.lenient && !isFlight && looksPromotional(subject, headers, Boolean(result.orderRef))) {
    return { ok: false, reason: "promotional", source: "shopper_email" };
  }
  if (SHIPMENT_SUBJECT.test(String(subject || "")) && !result.orderRef) return { ok: false, reason: "shipment_without_order_number", source: "shopper_email" };
  // A notice about an order placed earlier, with no total of its own, is not a purchase. (One that does give the order's
  // total is kept: it can be the only record of that order.)
  if (!opts.lenient && result.totalPence == null && ORDER_NOTICE_SUBJECT.test(subject || "")) {
    return { ok: false, reason: "order_notice", source: "shopper_email" };
  }
  if (opts.lenient && !result.orderRef && result.totalPence == null && !result.items.length && !(ePlat && ePlat.shop)) {
    return { ok: false, reason: "not_an_order_confirmation", source: "shopper_email", signals: { subject: sig.subjectHit, body: sig.bodyHit, textLength: text.length, nothingFound: true } };
  }
  // (Money sent to a person through PayPal, "You sent a payment of £20.00 GBP to Jane Doe", with no merchant, no order and
  // nothing bought listed: not a purchase from a shop. A seller who is paid this way still names its order or what was
  // bought, "Order ID WC-317" and "FitMind Tracker Qty: 1": that stays a purchase. Round 13.)
  if (!opts.lenient && viaPayPal && !result.orderRef && !result.items.length && !/^[ \t|*]*merchant\b/im.test(text)) {
    const to = /\b(?:payment (?:of [^\n]{1,30} )?to|sent (?:[^\n]{1,30} )?to|you paid [^\n]{1,30} to)\s+([^\n|.]{2,60}?)\s*(?:\||\.|\n|$)/i.exec(String(subject || "") + "\n" + text.slice(0, 3000));
    if (to && looksLikePerson(to[1].trim(), null)) return { ok: false, reason: "payment_to_person", source: "shopper_email" };
  }
  // (A Spanish email's order number, "Orden: AB12345CD", "N.° de pedido :AB12345CD". Round 23.)
  if (!result.orderRef) { const es = /(?:^|[\s|])(?:orden|pedido|n\.?\s?[°º]\s?de pedido|n[úu]mero de pedido)[ \t]*:[ \t]*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,23})(?![A-Za-z0-9-])/im.exec(text.slice(0, 8000)) || /(?:^|\s)(?:n\.?\s?[°º]\s?de pedido|n[úu]mero de pedido)[ \t]*:[ \t]*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,23})(?![A-Za-z0-9-])/i.exec(String(subject || "")); if (es) result.orderRef = es[1]; }
  // (A price written with its currency after it, "$ 150.00 MXN" under "Acceso por 2 horas": the code is never the thing
  // bought. The one line of that price is named by the line over it, when that line is a name. Round 23.)
  // (Nor the detail of a line, "Acceso por 2 horas | $ 150.00 MXN", nor a line of its own beside the real ones, the total's
  // "$ 150.00 MXN" read again.)
  const CUR_CODE = /^(?:MXN|USD|EUR|GBP|CAD|AUD|PLN|CHF|SEK|NOK|DKK|JPY)$/;
  const curPart = (x) => CUR_CODE.test(x) || /^(?:tax|vat|iva)$|^(?:tipo de pago|forma de pago|payment (?:type|method))\b/i.test(x);
  if (result.items.some((i) => CUR_CODE.test(String(i.name || "").trim()) || String(i.variant || "").split(", ").some((x) => CUR_CODE.test(x.trim())))) {
    for (const i of result.items) {
      if (!String(i.variant || "").split(", ").some((x) => CUR_CODE.test(x.trim()))) continue;
      const v = String(i.variant).split(", ").filter((x) => !curPart(x.trim())).join(", ");
      if (v) i.variant = v; else delete i.variant;
    }
    const kept = result.items.filter((i) => !CUR_CODE.test(String(i.name || "").trim()));
    if (kept.length && kept.length < result.items.length) {
      result.items = kept;
      const sum = kept.reduce((n, i) => n + (lineOf(i) ?? NaN), 0);
      if (!Number.isNaN(sum) && result.itemsCheck) result.itemsCheck = { ...result.itemsCheck, itemsPence: sum, complete: result.itemsCheck.expectedPence != null && sum === result.itemsCheck.expectedPence, missingPence: result.itemsCheck.expectedPence != null ? result.itemsCheck.expectedPence - sum : null };
    }
  }
  if (result.items.length === 1 && CUR_CODE.test(String(result.items[0].name || "").trim())) {
    const code = String(result.items[0].name).trim();
    const ls = String(fromHtml || text).slice(0, 40000).split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
    const k = ls.findIndex((x) => new RegExp("^(?:[A-Z]{0,2}\\$|€|£)?\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?\\s?" + code + "$").test(x));
    const nm = k > 0 ? ls[k - 1] : "";
    if (nm && nm.length >= 3 && nm.length <= 80 && /\p{L}{3}/u.test(nm) && !/\d[.,]\d{2}\b|[£€$]|:\s*$|\b(?:total|subtotal|tax|vat|iva|pago|payment|fecha|date|orden|order)\b/i.test(nm)) result.items = [{ ...result.items[0], name: nm }];
    else { result.items = []; result.itemsCheck = { complete: false, itemsPence: 0, expectedPence: result.totalPence ?? null, missingPence: result.totalPence ?? null }; }
  }
  result.returns = extractReturns(text, html, result.orderDate, otherPart);
  // (Every item personalised, and the seller says personalised orders can't be returned: no window, and why. Round 15.)
  if (result.returns && result.returns.excludes && result.items.length && result.items.every((i) => /\b(?:personali[sz]ed|custom(?:i[sz]ed)?|engraved|monogrammed|bespoke|made to order)\b/i.test(String(i.name || "") + " " + String(i.variant || "")))) {
    result.returns = { ...result.returns, windowDays: null, windowFrom: null, deadline: null, instructions: [], portalUrl: null, sellerNoReturn: "The seller says personalised orders can't be returned unless they arrive damaged or faulty." };
  }
  if (result.returns) delete result.returns.excludes;
  result.sentTo = sentToOf(headers, sender);
  result.shipment = shipmentOf(subject, text);

  const itemSum = result.items.reduce((n, i) => n + (i.pricePence ?? 0) * (i.lineTotal ? 1 : i.qty || 1), 0);
  const checks = [
    result.orderRef ? 1 : 0,
    result.totalPence != null ? 1 : 0,
    result.items.length ? 1 : 0,
    result.orderDate ? 1 : 0,
    result.retailer.name || result.retailer.domain ? 1 : 0,
  ];
  const score = checks.reduce((a, b) => a + b, 0);
  // Item prices should not add up to more than the total (delivery/discounts can make them differ).
  // (A discount can take the total below the item prices, so the subtotal also counts.)
  // Money taken off ("Promotion applied -£12.00", "Offer discount -£22.26") also lets the items come to more than was paid.
  const moneyOff = [...text.matchAll(/(?:^|[\s|(:])[-−]£\s?(\d{1,4}(?:,\d{3})*\.\d{2})/g)].reduce((n, m) => n + (money(m[1]) || 0), 0);
  const ceiling = Math.max(result.totalPence ?? 0, txt.subtotalPence ?? 0) + moneyOff;
  const consistent = result.totalPence == null || !result.items.length || itemSum <= ceiling + 1;
  result.confidence = score >= 5 && consistent ? "high" : score >= 3 && consistent ? "medium" : "low";
  result.needsShopperConfirmation = result.confidence !== "high";
  if (result.orderDate && !/^\d{4}-\d{2}-\d{2}$/.test(result.orderDate)) result.orderDate = null;
  // No date in the text: the day the shop sent the email is the best guess (used for sorting and display, never for confidence).
  // (A date more than a year before the email was sent is not this purchase's: "These Terms and Conditions were last updated
  // in 14th Feb 2022" under an invoice sent in 2025. The email's own date is. Round 11.)
  if (result.orderDate && refDate && !Number.isNaN(refDate.getTime()) && Date.parse(result.orderDate) < refDate.getTime() - 400 * 864e5) result.orderDate = null;
  if (!result.orderDate && refDate && !Number.isNaN(refDate.getTime())) { result.orderDate = isoDate(refDate); result.orderDateFrom = "email"; }
  // (One email confirming two orders, "Order # 202-…" then its items and "Total", then "Order # 202-…" again: each order is
  // a purchase of its own. The first is this email's reading; the others go with it as orders of their own, each with its
  // number, its items and its total, and gmail.js mergeOrderEmails makes a card of each. Round 12.)
  // (When the email was sent: gmail.js joins a payment service's receipt to the shop's by it. Round 13.)
  if (refDate && !Number.isNaN(refDate.getTime())) result.sentAt = refDate.toISOString();
  // (An email about how the order is getting on, not the order itself, "We're working on your order", "Your items are
  // ready to collect", "Your order has been dispatched": gmail.js never lets it lead the order's card or give its day. Round 19.)
  if (PROGRESS_SUBJECT.test(String(subject || "").replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, "").slice(0, 300)) || SHIPMENT_SUBJECT.test(String(subject || ""))) result.progressEmail = true;
  if (tableBooking) result.tableBooking = true;
  const others = amazonSplit && amazonSplit.length > 1 && amazonSplit[0].orderRef.toUpperCase() === String(result.orderRef || "").toUpperCase() ? amazonSplit.slice(1) :
    isFlight || dayOf || amended ? [] : moreOrders(text, result.orderRef).length ? moreOrders(text, result.orderRef) : moreOrders(otherPart, result.orderRef);
  if (others.length) result.moreOrders = others;
  // (The total found only late, an invoice's own: its one stacked row read again against it. Round 15e.)
  if (!result.items.length && result.totalPence != null && !isFlight && !dayOf) {
    const row = stackedInvoiceRow(fromHtml || text, result.totalPence) || (plain ? stackedInvoiceRow(plain, result.totalPence) : null);
    if (row) { result.items = [row]; result.itemsCheck = { complete: true, itemsPence: row.pricePence * row.qty, expectedPence: result.totalPence, missingPence: 0, ...namesCheck([row], {}) }; }
  }
  // (A booking that sets out what was booked as "4 x Throw a pot like a pro @ £40.00" and gives no total at all, no
  // "Total", no "Amount paid", no balance or deposit: what was booked is what it cost, the lines added up. Round 19.)
  if (result.totalPence == null && result.items.length && result.items.length <= 10 && !isFlight && !dayOf && result.items.every((i) => Number.isInteger(i.pricePence))) {
    const body = String(plain || fromHtml || text).slice(0, 30000);
    const atLines = body.split("\n").filter((l) => /^[ \t|]*\d{1,3}[ \t]*[x×][ \t]+[^\n@£]{2,120}?[ \t]@[ \t]*£[ \t]?\d{1,5}(?:,\d{3})*\.\d{2}[ \t|]*$/.test(l));
    const noSum = !/\b(?:sub-?\s?total|total|amount|balance|deposit|paid|due|charged|price)\b[^\n]{0,40}£|£[^\n]{0,20}\b(?:total|paid|due|deposit)\b/i.test(body);
    if (atLines.length === result.items.length && noSum) {
      const sum = result.items.reduce((n, i) => n + (i.lineTotal ? i.pricePence : i.pricePence * (i.qty || 1)), 0);
      result.totalPence = sum; result.currency = result.currency || "GBP";
      result.itemsCheck = { ...(result.itemsCheck || {}), complete: true, itemsPence: sum, expectedPence: sum, missingPence: 0 };
    }
  }
  // (A parking app's receipt, "Start Parking: … Stop Parking: …", "Description: MARKET STREET", "Cost: £1.40 including 20% VAT":
  // the parking is the one thing paid for, named by where it was. Round 19.)
  if (!result.items.length && result.totalPence != null && !isFlight && !dayOf) {
    const pk = String(plain && /\bstart parking\b/i.test(plain) ? plain : fromHtml || text).slice(0, 6000);
    if (/^[ \t|]*start parking\s*:/im.test(pk) && /^[ \t|]*stop parking\s*:/im.test(pk)) {
      const cost = /^[ \t|]*(?:cost|amount|total)\s*:\s*£\s?(\d{1,4}\.\d{2})\b/im.exec(pk);
      if (cost && money(cost[1]) === result.totalPence) {
        const where = (/^[ \t|]*(?:description|location name|car park|zone name)\s*:[ \t]*([\p{L}][\p{L}\d '&.,-]{1,50}?)[ \t|]*$/imu.exec(pk) || [])[1];
        const nice = where ? where.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : "";
        const row = { name: nice ? "Parking at " + nice : "Parking", qty: 1, pricePence: result.totalPence };
        result.items = [row]; result.itemsCheck = { complete: true, itemsPence: row.pricePence, expectedPence: result.totalPence, missingPence: 0, ...namesCheck([row], {}) };
      }
    }
  }
  // Money the email took off the order ("Promotion Applied -£1.99", "Discounts -£1.16", "Credit £4.11"), each as it is
  // labelled, so the receipt can say why the items come to more than was paid. Only a pounds receipt with items. Round 13.
  // (Money off a receipt in dollars or euros, Stripe's "Pro Subscription 51% Discount (51% off) | -$11.53": kept as it is
  // labelled, in the receipt's own currency. Round 15.)
  if (result.items.length && result.currency && result.currency !== "GBP" && !result.discounts) {
    const rowsOf = String(fromHtml || text).slice(0, 60000).replace(/\n\n\|\n\n/g, " | ").split("\n");
    const off = [];
    for (const r of rowsOf) {
      const m = /^[ \t|]*(\p{L}[^|\n]{2,80}?)[ \t]*(?:\|[ \t]*){0,6}[-−–][ \t]?(?:US ?\$|CA\$|A\$|MX ?\$|\$|€)[ \t]?(\d[\d,]{0,8}\.\d{2})\b/u.exec(r);
      if (m && /\b(?:discount|off|promo(?:tion)?|coupon|credit|unused time|voucher|saving)\b/i.test(m[1]) && off.length < 8) off.push({ label: m[1].trim().slice(0, 60), pence: money(m[2]) });
    }
    if (off.length) result.discounts = off;
  }
  // (A receipt that lists no items but sets out its sum, Amazon Fresh's store receipt "Subtotal £8.00", "Promotions applied
  // - £1.00", "Total £7.00": the money off is kept as labelled, only when it is exactly what takes the subtotal to the total.
  // Round 18.)
  if (!result.items.length && Number.isInteger(result.totalPence) && (result.currency || "GBP") === "GBP" && !result.discounts && !isFlight) {
    const mon = moneyOf(text);
    const off = (mon.found || []).filter((f) => f[0] === "discount" && f[2] > 0 && /\b(?:discounts?|promo(?:tion)?s?|offers?|vouchers?|coupons?|savings?|deals?|multi-?buy|money off)\b/i.test(String(f[1])) && !/\b(?:card|payment|paid|gift ?card|balance|refund)\b/i.test(String(f[1])));
    const sum = off.reduce((n, f) => n + f[2], 0);
    if (off.length && off.length <= 4 && Number.isInteger(mon.subtotal) && !mon.fees && !mon.tips && mon.subtotal - sum === result.totalPence) result.discounts = off.map((f) => ({ label: String(f[1]).slice(0, 60), pence: f[2] }));
  }
  if (result.items.length && (result.currency || "GBP") === "GBP") {
    // (A text part that runs everything into one line, Stripe's "… Qty 1 -£11.10 Subtotal …", gives no rows to read: the
    // HTML's rows are read instead. Round 15. And one that runs its money lines into one, "Subtotal (excl. promo) £35.00 Next
    // day delivery £5.00 Total paid £40.00", says nothing line by line: the other part's lines are read. Round 15e.)
    let mon = moneyOf(text);
    if (!(mon.found || []).some((f) => f[0] === "discount") && fromHtml && text !== fromHtml) { const alt = moneyOf(fromHtml); if ((alt.found || []).some((f) => f[0] === "discount")) mon = alt; }
    const other0 = text === fromHtml ? plain : fromHtml;
    if (!(mon.found || []).length && other0) mon = moneyOf(other0);
    // (Any amount taken off as a minus, "Happy Hour -£2.00", is money off whatever it is called; a card or payment never is.)
    const off = (mon.found || []).filter((f) => f[0] === "discount" && f[2] > 0 && f[1] !== zeroedGift && (f[3] === true || /\b(?:discounts?|promo(?:tion)?s?|offers?|vouchers?|coupons?|credit|savings?|saved|deals?|rewards?|loyalty|multi-?buy|money off|\d{1,3}% off)\b|\bapplied\b/i.test(String(f[1]))) && !/\b(?:card|payment|paid|pay|gift ?card|balance|refund)\b|(?<!\d)(?!(?:19|20)\d{2}(?!\d))\d{4}|\*{2,}|•/i.test(String(f[1]))).slice(0, 8).map((f) => ({ label: String(f[1]).replace(/[:\s]+$/, "").slice(0, 60), pence: f[2] }));
    if (percentOff && !off.some((d) => d.pence === percentOff.pence)) off.push(percentOff);
    // (A line that only sums up what was saved, "You've Saved £3.00" or "You're Saving £2.00", is not more money off; and when the
    // items as priced already come to what was paid with the fees, the money off is inside their prices, "Black Friday - Save
    // 15 percent" "-£3.00" under the item and "Product Saving -£3.00" under the list: never taken off a second time. Round 16.)
    const itemsP = result.items.reduce((a, i) => a + (Number.isInteger(i.pricePence) ? (i.lineTotal ? i.pricePence : i.pricePence * (i.qty || 1)) : NaN), 0);
    const inPrices = Number.isInteger(result.totalPence) && !Number.isNaN(itemsP) && off.length && Math.abs(itemsP + (mon.fees || 0) + (mon.tips || 0) - result.totalPence) <= 1 && /\b(?:original subtotal|you(?:'|’)?(?:ve| have)? sav(?:ed|ing)|you(?:'|’)re saving|product saving|total savings?)\b/i.test(text);
    for (let k = off.length - 1; k >= 0; k--) if (inPrices || /^(?:\p{L}{2,15}[!,.]\s{1,3})?(?:you(?:'|’)?(?:ve| have)? saved|you(?:'|’)re saving|you saved|total savings?|savings? today)\b/iu.test(off[k].label) && !(mon.found || []).some((f) => f[0] === "discount" && f[1] === off[k].label && f[3] === true)) off.splice(k, 1);
    if (off.length) result.discounts = off;
    // (A credit now shown as money off is not said again as the item's detail. Round 15.)
    for (const it of result.items) if (it.variant && off.some((d) => it.variant.includes(d.label + " −£"))) { const v = it.variant.split(", ").filter((p) => !off.some((d) => p.startsWith(d.label + " −£"))).join(", "); if (v) it.variant = v; else delete it.variant; }
    // (And what it added for delivery, service and the like, "Service fee £0.82", "Delivery £5.00", as each is labelled, so the
    // receipt can show every line of what was paid. Round 15.)
    // (A label run on from the line before it, "Subtotal £39.50 Delivery": only what follows the last amount. Round 15e.)
    const feeLabel = (l) => String(l).replace(/^(?:sub-?\s?total|total|items?)\b[^£€$\n]{0,30}[£€$]\s?\d[\d,]*(?:\.\d{2})?\s+(?=\p{L})/iu, "").replace(/[:\s]+$/, "").slice(0, 60);
    const fees = (mon.found || []).filter((f) => f[0] === "fee" && f[2] > 0 && !result.items.some((i) => String(i.name || "").toLowerCase() === String(f[1]).toLowerCase())).slice(0, 6).map((f) => ({ label: feeLabel(f[1]).replace(/^[#*\s]+/, ""), pence: f[2] }));
    if (columnFee && columnFee.fee > 0 && !fees.length) fees.push({ label: columnFee.label, pence: columnFee.fee });
    // (Never a fee from what the shop recommends, "Customers who bought this also bought" then a film whose name ends in
    // "Service" over "£3.49"; and never fees that come to more than was paid with the money off, a flight's taxes on a fare
    // paid with points: what the email added can't be more than the bill. Round 16b.)
    const recFees = new Set(((withoutRecommendations(text) === text ? mon : moneyOf(withoutRecommendations(text))).found || []).filter((f) => f[0] === "fee").map((f) => f[1] + "=" + f[2]));
    for (let k = fees.length - 1; k >= 0; k--) {
      const f = (mon.found || []).find((x) => x[0] === "fee" && x[2] === fees[k].pence && feeLabel(x[1]).replace(/^[#*\s]+/, "") === fees[k].label);
      if (f && !recFees.has(f[1] + "=" + f[2]) && !(columnFee && fees[k].label === columnFee.label)) fees.splice(k, 1);
    }
    const offP = off.reduce((a, d) => a + d.pence, 0);
    if (Number.isInteger(result.totalPence) && fees.reduce((a, f) => a + f.pence, 0) > result.totalPence + offP) fees.length = 0;
    // (A flight's fare that is already what was paid, with the taxes it lists per passenger inside it, "Air Passenger Duty
    // GBP 216.00" under "Per adult": nothing was added on top. Round 22.)
    if (isFlight && Number.isInteger(result.totalPence) && result.items.reduce((a, i) => a + (Number.isInteger(i.pricePence) ? i.pricePence : 0), 0) - offP === result.totalPence) fees.length = 0;
    if (fees.length) result.fees = fees;
    // The items, less the money off the receipt shows, must come to what was paid (with its fees and tips): a check that only
    // adds up with money off the receipt doesn't show is not complete. Round 15.
    const shownOff = off.reduce((a, d) => a + d.pence, 0);
    const ck = result.itemsCheck;
    if (ck && ck.complete === true && result.totalPence != null && (mon.discounts || 0) - zeroedGiftPence > shownOff && mon.subtotal == null &&
        Math.abs(ck.itemsPence - shownOff + (mon.fees || 0) + (mon.tips || 0) - result.totalPence) > 1 && Math.abs(ck.itemsPence - result.totalPence) > 1)
      result.itemsCheck = { ...ck, complete: false, offNotShown: mon.discounts - shownOff };
    if (shownOff && result.itemsCheck) result.itemsCheck = { ...result.itemsCheck, discountsPence: shownOff };
    // (A delivery charge and its own discount line left blank, "Shipping: £4.50" then "Shipping Discount: £", when the total
    // is the items less the money off with no delivery paid: the delivery was taken off again. Round 15e.)
    const ck2 = result.itemsCheck;
    if (ck2 && ck2.complete === false && result.totalPence != null && (result.fees || []).length === 1 && ck2.missingPence === -result.fees[0].pence) {
      const lbl = String(result.fees[0].label).replace(/[^\p{L} ]/gu, "").trim();
      const blank = lbl && new RegExp("^[ \\t|]*" + lbl.replace(/\s+/g, "\\s+") + "\\s+discount\\s*:?[ \\t]*£?[ \\t|]*$", "im").test(text);
      if (blank) {
        result.discounts = [...(result.discounts || []), { label: lbl + " Discount", pence: result.fees[0].pence }];
        result.itemsCheck = { ...ck2, complete: true, missingPence: 0, expectedPence: ck2.itemsPence, discountsPence: (ck2.discountsPence || 0) + result.fees[0].pence };
      }
    }
  }
  // (Items that come to the subtotal while the subtotal and the fees don't come to the total, with no money off shown: the
  // receipt can't say the lines are all there is. Round 16.)
  if (result.itemsCheck && result.itemsCheck.complete === true && (result.currency || "GBP") === "GBP") {
    const gapP = unexplainedGap(result.itemsCheck, moneyOf(text), result.totalPence);
    if (gapP != null) result.itemsCheck = { ...result.itemsCheck, complete: false, totalGap: gapP };
  }
  // (A fee set out as a line of the item list, "1 x Online booking fee | £1.00 each | £1.00", is what was added, not a thing
  // bought: it sits with the fees, and the things bought and it come to the total. Round 16.)
  if (!journey && !isFlight && !listedOrder && result.items.length >= 2 && Number.isInteger(result.totalPence) && (result.currency || "GBP") === "GBP") {
    // (Also under the event it was for, "Riverside 10K 2026 — 1x Booking Fee". Round 21.)
    const FEE_ITEM = /^(?:[^—–\n]{1,80} [—–] (?:\d{1,2} ?x )?)?(?:online |card |admin(?:istration)? |transaction |handling |service |booking )*(?:booking|admin(?:istration)?|transaction|handling|card|service) (?:fee|charge)s?$/i;
    const feeIt = result.items.filter((i) => FEE_ITEM.test(String(i.name || "").trim()) && Number.isInteger(i.pricePence) && i.pricePence > 0);
    const goods = result.items.filter((i) => !feeIt.includes(i));
    const sum = (l) => l.reduce((a, i) => a + (i.lineTotal ? i.pricePence : i.pricePence * (i.qty || 1)), 0);
    if (feeIt.length && goods.length && goods.every((i) => Number.isInteger(i.pricePence)) && !(result.fees || []).some((f) => feeIt.some((i) => f.label.toLowerCase() === String(i.name).toLowerCase())) &&
        Math.abs(sum(goods) + sum(feeIt) - (result.discounts || []).reduce((a, d) => a + d.pence, 0) + (result.fees || []).reduce((a, f) => a + f.pence, 0) - result.totalPence) <= 1) {
      result.items = goods;
      result.fees = [...(result.fees || []), ...feeIt.map((i) => ({ label: String(i.name).trim(), pence: sum([i]) }))];
      result.itemsCheck = { ...(result.itemsCheck || {}), complete: true, itemsPence: sum(goods), expectedPence: sum(goods), missingPence: 0 };
    }
  }
  // (A thing's own money off set out under it, a web shop's "Linen Cushion Cover Set × 1", "WINTER25", "(-£10.00)", "£40.00",
  // "£30.00": the thing at its price, £40.00, and the money off as its own line labelled as the shop labels it, so the lines
  // come to what was paid. Only when the price less the money off is the price read for it. Round 19.)
  if (result.items.length && result.items.length <= 30 && !(result.discounts || []).length && (result.currency || "GBP") === "GBP" && result.itemsCheck && result.itemsCheck.complete === true) {
    const ls = String(plain || text).slice(0, 60000).split("\n").map((l) => l.replace(/\|/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
    const gbp = (x) => { const m = /^£\s?(\d{1,5}(?:,\d{3})*\.\d{2})$/.exec(x || ""); return m ? money(m[1]) : null; };
    const low = (x) => String(x || "").toLowerCase().replace(/\s*[×x]\s*\d{1,3}$/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const offs = [];
    // (The thing's name may run over two or three lines, and its options, "Vogue Grey / King", may sit between it and the label.)
    const namedAbove = (at, name) => [at, at - 1].some((end) => [1, 2, 3].some((k) => end - k >= 0 && low(ls.slice(end - k, end).join(" ")) === low(name)));
    let seen = 0;
    for (let i = 2; i + 2 < ls.length && offs.length < 10; i++) {
      const m = /^\(\s*[-−–]\s*£\s?(\d{1,5}(?:,\d{3})*\.\d{2})\s*\)$/.exec(ls[i]);
      if (!m) continue;
      seen++;
      const off = money(m[1]), was = gbp(ls[i + 1]), now = gbp(ls[i + 2]), label = ls[i - 1];
      if (off == null || was == null || now == null || Math.abs(was - off - now) > 1 || label.length > 40 || /£/.test(label)) continue;
      const it = result.items.find((x) => !x.__off && (x.lineTotal ? x.pricePence : x.pricePence * (x.qty || 1)) === now && namedAbove(i - 1, x.name));
      if (!it) continue;
      offs.push({ it, was, off, label });
      Object.defineProperty(it, "__off", { value: true, enumerable: false, configurable: true });
    }
    // (A price for several that doesn't split evenly into each one's stays as read.)
    if (offs.length && offs.length === seen && offs.every((o) => o.it.lineTotal || (o.it.qty || 1) === 1 || o.was % (o.it.qty || 1) === 0)) {
      for (const o of offs) {
        o.it.pricePence = o.it.lineTotal || (o.it.qty || 1) === 1 ? o.was : o.was / (o.it.qty || 1);
        if (o.it.variant) { const rest = String(o.it.variant).split(/\s*,\s*/).filter((v) => low(v) !== low(o.label)).join(", "); if (rest) o.it.variant = rest; else delete o.it.variant; }
      }
      const add = offs.reduce((n, o) => n + o.off, 0);
      // (One code taken off several things is one line of money off.)
      const byLabel = new Map();
      for (const o of offs) { const k = o.label.slice(0, 60); byLabel.set(k, (byLabel.get(k) || 0) + o.off); }
      result.discounts = [...byLabel].map(([label, pence]) => ({ label, pence }));
      result.itemsCheck = { ...result.itemsCheck, itemsPence: result.itemsCheck.itemsPence + add, expectedPence: (result.itemsCheck.expectedPence ?? result.itemsCheck.itemsPence) + add, missingPence: 0, discountsPence: add };
    }
  }
  // (A ride is its fare; the fees, tip and credits under it are what was added and taken off, each as Uber labels it, so the
  // ride line never counts them a second time: "Trip fare £20.00", "Uber pet fee £3.00", "Uber One credits -£1.00", total
  // £22.00. Round 16.)
  if (ride && result.items.length === 1 && (uber.cancelled || uber.membership) && Number.isInteger(result.totalPence)) {
    result.items = [{ ...result.items[0], pricePence: result.totalPence }];
    delete result.fees; delete result.discounts;
    result.itemsCheck = { complete: true, itemsPence: result.totalPence, expectedPence: result.totalPence, missingPence: 0, namesOk: true };
  } else if (ride && result.items.length === 1) {
    const rm = uberRideMoney(fromHtml || text, result.totalPence) || (fromHtml && text !== fromHtml ? uberRideMoney(text, result.totalPence) : null);
    if (rm) {
      result.items = [{ ...result.items[0], pricePence: rm.farePence }];
      if (rm.fees.length) result.fees = rm.fees; else delete result.fees;
      if (rm.discounts.length) result.discounts = rm.discounts; else delete result.discounts;
      const feeP = rm.fees.reduce((a, f) => a + f.pence, 0), offP = rm.discounts.reduce((a, f) => a + f.pence, 0);
      result.itemsCheck = { complete: true, itemsPence: rm.farePence, expectedPence: rm.farePence, missingPence: 0, namesOk: true, ...(offP ? { discountsPence: offP } : {}), ...(feeP ? { feesPence: feeP } : {}) };
    }
  }
  // (Amazon's digital receipt, a film paid by gift card: "Total: £1.99" "Gift Card Amount: -£1.99" "Order Grand Total: £0.00".
  // What it cost is the total before the gift card, the gift card's part kept beside it. Round 15.)
  // (Pasted, with no sender's address: Amazon by the name the email gives itself.)
  const amazonFamily = /(^|\.)(?:amazon\.(?:co\.uk|com)|primevideo\.com)$/i.test(result.retailer.domain || sender?.domain || "") || amazonPasted ||
    (!(result.retailer.domain || sender?.domain) && /^amazon(?:\.co\.uk)?(?: prime video)?$/i.test(String(result.retailer.name || "")));
  if (!result.giftCardPence && Number.isInteger(result.totalPence) && amazonFamily) {
    const g = /^[ \t|]*Gift (?:Certificate\/)?Card(?: Amount)?[ \t]*:?[ \t|]*(?:\n[ \t|]*){0,2}[-−]£\s?(\d{1,5}(?:,\d{3})*\.\d{2})/im.exec(text);
    // (The older text receipt has no "Total:" line, only "Total Before Tax: £7.49" and "Tax Collected: £1.50" over
    // "Gift Certificate/Card Amount: -£8.99" and "Grand Total: £0.00": what it cost is those two added up. Round 17.)
    const pre = /^[ \t|]*Total Before (?:Tax|VAT)[ \t]*:[ \t|]*£\s?(\d{1,5}(?:,\d{3})*\.\d{2})[ \t|]*$/im.exec(text), taxed = pre && /^[ \t|]*(?:Tax Collected|VAT)[ \t]*:[ \t|]*£\s?(\d{1,5}(?:,\d{3})*\.\d{2})[ \t|]*$/im.exec(text);
    const before = /^[ \t|]*Total[ \t]*:[ \t|]*(?:\n[ \t|]*){0,2}£\s?(\d{1,5}(?:,\d{3})*\.\d{2})/im.exec(text) ||
      (pre && taxed ? [null, ((money(pre[1]) + money(taxed[1])) / 100).toFixed(2)] : null);
    // (Or the payment methods under "Order Total:", "Gift Card (£28.64)" "Visa (£0.00)", as a pasted page shows them; the
    // summary repeated over each parcel gives the gift card once.)
    let paidBy = 0;
    for (const m of text.slice(0, 60000).matchAll(/^[ \t|]*Gift Card[ \t]*\(£\s?(\d{1,5}(?:,\d{3})*\.\d{2})\)[ \t|]*$/gim)) paidBy = Math.max(paidBy, money(m[1]));
    if (g && before && money(before[1]) - money(g[1]) === result.totalPence) {
      result.giftCardPence = money(g[1]); result.totalPence = money(before[1]);
      // (The text receipt's one title over "Sold by :Amazon Digital UK Limited", with no price beside it: the one thing bought,
      // at what the order cost. Round 17.)
      if (!result.items.length) {
        const titles = [...text.slice(0, 20000).matchAll(/^[ \t]*(\S[^\n]{1,150}?)[ \t]*\n[ \t]*sold by\s*:/gim)].map((m) => m[1].trim()).filter((n) => !/£|^(?:order|placed|item)\b|:$/i.test(n));
        if (titles.length === 1) { result.items = [{ name: titles[0], qty: 1, pricePence: result.totalPence }]; result.itemsCheck = { ...(result.itemsCheck || {}), complete: true, itemsPence: result.totalPence, expectedPence: result.totalPence, missingPence: 0, giftCardPence: result.giftCardPence }; }
      }
      if (result.itemsCheck) { const ip = result.itemsCheck.itemsPence; result.itemsCheck = { ...result.itemsCheck, expectedPence: result.totalPence, ...(Number.isInteger(ip) ? { complete: Math.abs(ip - result.totalPence) <= 1, missingPence: result.totalPence - ip } : {}), giftCardPence: result.giftCardPence }; }
    } else if (!g && paidBy > 0 && amazonRefs.size <= 1) {
      result.giftCardPence = paidBy; result.totalPence += paidBy;
      if (result.itemsCheck) { const ip = result.itemsCheck.itemsPence; result.itemsCheck = { ...result.itemsCheck, expectedPence: result.totalPence, ...(Number.isInteger(ip) ? { complete: Math.abs(ip - result.totalPence) <= 1, missingPence: result.totalPence - ip } : {}), giftCardPence: result.giftCardPence }; }
    }
  }
  // (Amazon's "Order Total: £0.00" over things bought, with nothing in the email saying what paid for them, a text part that
  // leaves out the gift card: what the order cost isn't known from it, and it is never shown as £0.00. Round 15.)
  const boughtSomething = result.items.some((i) => Number.isInteger(i.pricePence) && i.pricePence > 0) || /£\s?(?!0\.00\b)\d/.test(text.slice(0, 20000));
  if (amazonFamily && result.totalPence === 0 && !result.giftCardPence && !(result.discounts && result.discounts.length) && boughtSomething) {
    result.totalPence = null; result.totalFrom = "unknown_gift_card";
    // (Items not read at all are still flagged as missing.)
    result.itemsCheck = { ...(result.itemsCheck || {}), expectedPence: null, missingPence: null, complete: result.items.length && !subjectNamed ? null : false };
  }
  // (A summary written before VAT, "Item Subtotal: £4.16" "Promotions: -£4.16" "Total Before VAT: £0.00" "VAT: £0.00"
  // "Order Grand Total: £0.00", under a film listed at £4.99 with its VAT: the promotion paid for all of it, so what it took
  // off is the item's own price, and the items are complete. Round 15.)
  if (result.totalPence === 0 && result.items.length && result.discounts && result.discounts.length === 1 && /^[ \t|]*Total Before VAT\s*:/im.test(text)) {
    const sub = /^[ \t|]*Item\(?s?\)? Subtotal[ \t]*:?[ \t|]*(?:\n[ \t|]*){0,2}£\s?(\d{1,5}(?:,\d{3})*\.\d{2})/im.exec(text);
    const itemsPence = result.items.reduce((n, i) => n + (Number.isInteger(i.pricePence) ? i.pricePence * (i.lineTotal ? 1 : i.qty || 1) : 0), 0);
    if (sub && money(sub[1]) === result.discounts[0].pence && money(sub[1]) > 0 && itemsPence > 0 && Math.abs(itemsPence - Math.round(money(sub[1]) * 1.2)) <= 1) {
      result.discounts = [{ ...result.discounts[0], pence: itemsPence }];
      result.itemsCheck = { ...(result.itemsCheck || {}), complete: true, itemsPence, expectedPence: itemsPence, missingPence: 0, coveredBy: "promotion" };
    }
  }
  // (A shop's tax line named only by its rate, "Standard Rate £1.14" under "Shipping £5.70" in the order summary, is the VAT,
  // never an item; and a trial set that costs nothing, "Burnout Buster Trio", "×", "1", "Trial Set / Daily", … "Free", over
  // "Subtotal £0.00", is the thing bought, at £0.00. Round 18.)
  if (result.items.length === 1 && /^(?:standard|reduced|zero)[- ]rated?(?: vat)?$/i.test(String(result.items[0].name || "").trim()) && Number.isInteger(result.items[0].pricePence)) {
    const ls = String(fromHtml || text).split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean).slice(0, 3000);
    const at = ls.findIndex((x) => x.toLowerCase() === String(result.items[0].name).trim().toLowerCase());
    const above = at > 0 ? ls.slice(Math.max(0, at - 6), at) : [];
    if (above.some((x) => /^(?:shipping|delivery|postage)\b/i.test(x)) && above.some((x) => /^sub-?\s?total\b/i.test(x))) {
      const vat = result.items[0];
      result.items = [];
      result.fees = [...(result.fees || []), { label: "VAT", pence: vat.pricePence }];
      const sub = ls.slice(0, at).findIndex((x) => /^sub-?\s?total\b/i.test(x));
      const subAmt = sub >= 0 ? (/£\s?(\d+\.\d{2})/.exec(ls[sub]) || /^£\s?(\d+\.\d{2})$/.exec(ls[sub + 1] || "") || [])[1] : null;
      if (subAmt === "0.00") {
        for (let k = 0; k + 2 < sub; k++) {
          if (ls[k + 1] !== "×" && ls[k + 1] !== "x") continue;
          if (!/^\d{1,2}$/.test(ls[k + 2]) || !/\p{L}{3}/u.test(ls[k]) || /£|:/.test(ls[k]) || ls[k].length > 80) continue;
          let free = false;
          for (let j = k + 3; j < Math.min(sub, k + 10); j++) { if (ls[j + 1] === "×") break; if (/^free$/i.test(ls[j])) { free = true; break; } }
          if (!free) continue;
          const v = ls[k + 3] && !/£|\d\.\d{2}|^(?:free|subscription price)$/i.test(ls[k + 3]) && ls[k + 3].length <= 60 ? ls[k + 3] : null;
          result.items.push({ name: ls[k], qty: Number(ls[k + 2]), pricePence: 0, ...(v ? { variant: v } : {}) });
        }
      }
      const fp = result.fees.reduce((n, f) => n + (f.pence || 0), 0);
      result.itemsCheck = result.items.length ? { complete: fp === result.totalPence, itemsPence: 0, expectedPence: Math.max(0, (result.totalPence ?? 0) - fp), missingPence: 0, ...namesCheck(result.items, { shop: result.retailer.name || "" }) }
        : { complete: false, itemsPence: 0, expectedPence: null, missingPence: null };
    }
  }
  // (A flight booking read without its flights, its only line the fare's passenger type, "Adult" £1,184.36, beside flight
  // numbers: the thing bought is not known, so the list is flagged, never passed off as right. Round 18.)
  if (!isFlight && result.items.length === 1 && /^(?:\d{1,2}\s?x?\s)?(?:adults?|child(?:ren)?|infants?|passengers?)$/i.test(String(result.items[0].name || "").trim()) && result.itemsCheck && hasFlightNumber(text) && /\b(?:flights?|airline|airport|boarding|departure|terminal|baggage|passenger)\b/i.test(text))
    result.itemsCheck = { ...result.itemsCheck, complete: false, namesOk: false, suspectNames: [{ name: String(result.items[0].name).slice(0, 120), why: "fare" }] };
  // (Prices before VAT with the VAT added under them, "Plus: 1-month subscription £10.99/month", "VAT 20% - £2.20", "Total:
  // £13.19/month": the VAT is part of what was paid, kept as its own line so the receipt adds up. Round 17.)
  if (result.itemsCheck && result.itemsCheck.complete === true && Number.isInteger(result.totalPence) && Number.isInteger(result.itemsCheck.itemsPence) && !(result.fees || []).some((f) => /\b(?:vat|tax)\b/i.test(String(f.label || "")))) {
    const vat = moneyOf(text).vat, fees = (result.fees || []).reduce((n, f) => n + (f.pence || 0), 0), off = (result.discounts || []).reduce((n, f) => n + (f.pence || 0), 0);
    if (Number.isInteger(vat) && vat > 0 && result.itemsCheck.itemsPence + vat + fees - off === result.totalPence) result.fees = [...(result.fees || []), { label: "VAT", pence: vat }];
  }
  // (A fee the items already hold, Eventim's "Booking fee | 2 × £3.75 | £7.50" read as an item line and again as the fee
  // "Booking fee: 2 x £3.75 = £7.50": counted once, as the item line. Round 17.)
  if (Array.isArray(result.fees) && result.fees.length && result.items.length) {
    const low = (x) => String(x || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const lineP = (i) => (Number.isInteger(i.pricePence) ? (i.lineTotal ? i.pricePence : i.pricePence * (i.qty || 1)) : null);
    const kept = result.fees.filter((f) => { const lab = low(String(f.label || "").split(/[:(]/)[0]); return !(lab && result.items.some((i) => low(i.name) === lab && lineP(i) === f.pence)); });
    if (kept.length !== result.fees.length) { if (kept.length) result.fees = kept; else delete result.fees; }
  }
  // (Names found cut short stay flagged when the email gives no total to check them against, Amazon's "Total £0.00" for
  // priced items. Round 21b.)
  if (result.cutShortNames) { if (result.itemsCheck && result.itemsCheck.namesCut && result.itemsCheck.complete == null) result.itemsCheck = { ...result.itemsCheck, complete: false, namesOk: false }; delete result.cutShortNames; }
  return result;
}

// ---- Parcels -------------------------------------------------------------------------
// A tracking number in an order or shipping email, and which carrier it belongs to.
const ROYAL_MAIL_REF = /\b([A-Z]{2}\d{9}GB)\b/;
const CARRIER_NAMES = [["Royal Mail", /royal ?mail|parcelforce/i], ["Evri", /\bevri\b|\bhermes\b/i], ["DPD", /\bdpd\b/i], ["InPost", /\binpost\b/i],
  ["Yodel", /\byodel\b/i], ["DHL", /\bdhl\b/i], ["UPS", /\bups\b/i], ["FedEx", /\bfedex\b/i]];
function carrierIn(text) { for (const [n, re] of CARRIER_NAMES) if (re.test(text)) return n; return null; }
function trackingIn(text) {
  const rm = text.match(ROYAL_MAIL_REF);
  if (rm) return { trackingNumber: rm[1], carrier: "Royal Mail" };
  const m = text.match(/\btracking\s*(?:number|no\.?|#|id|code)?\s*[:#]\s*([A-Z0-9]{8,30})\b/i) || text.match(/\btracking\s+(?:number|no\.?|id|code)\s+(?:is\s+)?([A-Z0-9]{8,30})\b/i) ||
    // (Round 15e: written as data in the email, "trackingNumber":"UK4471100293", or only in the carrier's tracking link,
    // "https://track.amazon.co.uk/tracking/UK4471100293".)
    text.match(/"tracking_?number"\s*:\s*"([A-Z0-9]{8,30})"/i) || text.match(/\bhttps?:\/\/track(?:ing)?\.[a-z0-9.-]{3,40}\/(?:tracking|track|parcels?)\/([A-Z]{0,4}\d[A-Z0-9]{7,29})(?![A-Z0-9])/i);
  return m && /\d/.test(m[1]) ? { trackingNumber: m[1].toUpperCase(), carrier: null } : null;
}
function shipmentOf(subject, text) {
  const t = trackingIn(text);
  const shipped = /\b(shipped|shipping|dispatched|on its way|on the way|sent)\b/i.test(subject || "");
  if (!t && !shipped) return null;
  return { trackingNumber: t ? t.trackingNumber : null, carrier: (t && t.carrier) || carrierIn(text), status: shipped ? "shipped" : null };
}
const UK_TRACK = { "Royal Mail": (n) => "https://www.royalmail.com/track-your-item#/tracking-results/" + n, "Evri": (n) => "https://www.evri.com/track/parcel/" + n,
  "DPD": (n) => "https://track.dpd.co.uk/parcels/" + n, "InPost": (n) => "https://inpost.co.uk/tracking/?number=" + n };
export function trackingLink(carrier, number) {
  return carrier && UK_TRACK[carrier] && /^[A-Z0-9]{8,30}$/.test(String(number || "")) ? UK_TRACK[carrier](number) : null;
}

// Delivery updates: emails from a carrier ("Your parcel from Lululemon EMEA has been delivered") or from the shop
// ("Your order is out for delivery"). They never make a purchase card; they add "where's my parcel" to one.
const CARRIER_SENDERS = [["Royal Mail", /royalmail\.com|parcelforce\.com/i], ["Evri", /evri\.com|myhermes/i], ["DPD", /dpd\.co\.uk|dpdlocal/i], ["InPost", /inpost\.co\.uk/i], ["Yodel", /yodel\.co\.uk/i]];
// Carriers' own addresses, for return parcels (parseReturnParcelEmail): the seven UK carriers shops send returns with.
// Matched against the sender's domain only (the part after @), so a shop can't pass for a carrier by its display name.
export const RETURN_CARRIER_SENDERS = [["Parcelforce", /(^|\.)parcelforce\.(com|co\.uk)$/i], ["Royal Mail", /(^|\.)royalmail\.(com|co\.uk)$/i], ["Evri", /(^|\.)(evri\.com|myhermes\.co\.uk)$/i],
  ["DPD", /(^|\.)(dpd\.co\.uk|dpdlocal\.co\.uk)$/i], ["InPost", /(^|\.)inpost\.co\.uk$/i], ["Yodel", /(^|\.)yodel\.co\.uk$/i], ["Collect+", /(^|\.)collectplus\.co\.uk$/i]];
export function returnCarrierOf(from) {
  const s = String(from || ""), addr = ((s.match(/<([^<>\s]+@[^<>\s]+)>/) || [])[1] || (s.match(/([^\s<>"]+@[^\s<>"]+)/) || [])[1] || "").toLowerCase();
  const domain = addr.split("@")[1] || "";
  return domain ? (RETURN_CARRIER_SENDERS.find(([, re]) => re.test(domain)) || [])[0] || null : null;
}
export function parseDeliveryEmail(rawEmail) {
  const raw = String(rawEmail || "").slice(0, MAX_INPUT);
  const { headers, body } = splitMessage(raw);
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  const text = shownText(parts, html);
  const subject = headers.subject || "";
  const from = String(headers.from || "");
  const fromCarrier = (CARRIER_SENDERS.find(([, re]) => re.test(from)) || [])[0] || null;
  const both = subject + "\n" + text.slice(0, 4000);
  let status = null;
  // "Due to be delivered today" is checked first so it is never read as "delivered today".
  if (/\bdue to be delivered\b|\barriving today\b|\bexpected (?:today|on)\b/i.test(subject)) status = "due";
  else if (/\b(has been|was|been|we(?:'|’)?ve)\s+delivered\b|\bwe delivered\b/i.test(both)) status = "delivered";
  // "Delivered: 1 item | Order # …", or a heading that just says "Delivered today".
  else if (/^\s*delivered\s*:/i.test(subject) || /^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*delivered today[.!]?[\s|]*$/im.test(text.slice(0, 4000))) status = "delivered";
  else if (/\bout for delivery\b/i.test(both)) status = "out_for_delivery";
  else if (/\bdue to be delivered\b|\barriving today\b/i.test(both)) status = "due";
  else if (fromCarrier && /\b(on its way|dispatched|in transit|we(?:'|’)?ve got your parcel)\b/i.test(both)) status = "in_transit";
  // A shop's own email only counts when the subject says so, so receipts that merely mention delivery are left alone.
  if (!status || (!fromCarrier && !/\bdelivered\b|\bout for delivery\b/i.test(subject))) return { ok: false, reason: "not_a_delivery_email" };
  const sender = retailerFromFrom(from);
  const t = trackingIn(text);
  const merchant = (both.match(/\bparcel from ([A-Z][\w&'’ .-]{1,60}?)(?:\s+(?:is|has|was)\b|[.,:\n])/) || [])[1] || null;
  const refDate = headers.date ? new Date(headers.date) : null;
  const dated = (text.match(/\b(?:today|on),?\s+(?:[A-Za-z]{3,9},?\s+)?(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{4})/i) || [])[1];
  const at = (dated && parseDate(dated, refDate)) || (refDate && !Number.isNaN(refDate.getTime()) ? isoDate(refDate) : null);
  const ref = subject.match(/\border\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})/i) || text.match(/\border\s*(?:number|no\.?|id|#)\s*[:#\s]*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})/i);
  return {
    ok: true, kind: "delivery_update", status, at,
    carrier: fromCarrier || (t && t.carrier) || carrierIn(text) || null,
    trackingNumber: t ? t.trackingNumber : null,
    merchant: merchant ? merchant.trim() : null,
    // A shop's own email the shopper forwarded from their own inbox names the shop, not the shopper's mailbox (round 6).
    retailer: fromCarrier ? null : PERSONAL_MAIL.test(sender?.domain || "") ? shopOfUpdate(headers, text, html, parts) : { name: sender?.name || null, domain: sender?.domain || null },
    orderRef: ref ? ref[1] : null,
  };
}

// ---- Return-instructions emails ("Thanks for your return request ...") -------------
// A different kind of email from a receipt: it carries the return ID, the deadline,
// how to send the parcel back and an estimated refund. Never refund-eligible.
const CARRIERS = /\b(Evri|Royal Mail|DPD|UPS|InPost|Collect\+|Yodel|DHL|Parcelforce|Hermes|Post Office)\b/i;

export function parseReturnEmail(rawEmail) {
  const raw = String(rawEmail || "").slice(0, MAX_INPUT);
  const { headers, body } = splitMessage(raw);
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  // Some senders ship an empty or skimpy text part beside the full HTML one: use whichever actually has the return details.
  const plainText = parts.text.join("\n").trim();
  const htmlText = html ? htmlToText(html).trim() : "";
  // (Or Amazon's "Your return is confirmed" with its pickup or drop-off booked and the refund it expects. Round 15.)
  const hasReturn = (t) => /\breturn id\b/i.test(t) || /(?:thanks for your|your) return request/i.test(t) || /\byour return is confirmed\b/i.test(t);
  // (A text part that lost its pound signs, "for the value of L118.00", while the HTML has them: the HTML is read. Round 12.)
  const lostPounds = Boolean(plainText && htmlText && !/£/.test(plainText) && /\bL\d[\d,]*\.\d{2}\b/.test(plainText) && /£/.test(htmlText));
  const text = plainText && !lostPounds && (hasReturn(plainText) || !hasReturn(htmlText)) ? plainText : htmlText || plainText;
  const subject = headers.subject || "";
  const sender = retailerFromFrom(headers.from);
  const refDate = headers.date ? new Date(headers.date) : null;

  const isReturn = hasReturn(text);
  if (!isReturn) return { ok: false, reason: "not_a_return_email", source: "shopper_email" };

  // A real return ID has at least one digit and ends at a space or line break ("RETURN ID: nuk0400251601"),
  // so words like "https" from a link, or the first word of a sentence, are never taken for one.
  const idm = text.match(/return id\s*[:#\s|]*((?=[A-Z0-9-]*\d)[A-Z0-9-]{5,30})(?![A-Za-z0-9\/:.])/i);
  const orderFromSubject = subject.match(/\border\s+#?((?=[A-Z0-9-]*\d)[A-Z0-9-]{3,24})/i);
  const orderFromBody = text.match(/\border\s*(?:number|no\.?|id)\s*[:#\s]*([A-Z0-9-]{4,24})/i);
  // (Amazon names the order only in its links, "returns/prep?…&orderId=206-…": taken when it is in Amazon's own shape.)
  const orderFromLink = !orderFromSubject && !orderFromBody ? /(?:[?&]|%26|%3F)(?:amp;)?orderId(?:=|%3D|=3D)((?:\d{3}|D\d{2})-\d{7}-\d{7})\b/i.exec(text.slice(0, 20000) + "\n" + html.slice(0, 200000)) : null;

  // Deadline: "send it back no later than Wednesday, December 24". The year, if absent,
  // comes from the email's own date and is never in the past relative to it.
  let deadline = null;
  for (const sent of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (!/back|return|send/i.test(sent)) continue;
    const dm = sent.match(/(?:no later than|by|before|on or before)\s+(?:[A-Za-z]{3,9},?\s+)?([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}(?:,?\s+\d{4})?)/i);
    if (!dm) continue;
    deadline = parseDate(dm[1]);
    if (!deadline) {
      const a = dm[1].match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/) || null;
      const b = dm[1].match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})/) || null;
      const mi = a ? MONTHS.indexOf(a[1].toLowerCase()) : b ? MONTHS.indexOf(b[2].toLowerCase()) : -1;
      const day = a ? Number(a[2]) : b ? Number(b[1]) : 0;
      if (mi >= 0 && day && refDate instanceof Date && !Number.isNaN(refDate.getTime())) {
        let year = refDate.getUTCFullYear();
        if (new Date(Date.UTC(year, mi, day)) < new Date(refDate.getTime() - 86400000)) year += 1;
        deadline = `${year}-${String(mi + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
    if (deadline) break;
  }

  // The "how to" steps: the lines between the instructions heading and the details heading.
  let steps = [];
  const sect = text.match(/instructions\s*\n([\s\S]{20,900}?)(?:\n\s*return details|\n\s*have questions|$)/i);
  const source = sect ? sect[1] : text;
  for (const line of source.split(/\n+/).map((x) => x.trim())) {
    if (steps.length >= 4) break;
    if (line.length >= 25 && line.length <= 220 && /pack|label|send|drop|take|scan|post|courier|collect/i.test(line)) steps.push(line);
  }

  // (Or the return's own total, "TOTAL REFUND" over "£118.00", or "crediting you back … for the value of £118.00". Round 12.)
  const refund = text.match(/(?:estimated|total expected) refund[\s\S]{0,20}?£\s*([0-9][0-9,]*\.[0-9]{2})/i) || text.match(/\btotal refund(?: amount)?\s*:?[\s|]{0,12}£\s*([0-9][0-9,]*\.[0-9]{2})/i) ||
    text.match(/\bcredit(?:ing)? you back\b[^£]{0,60}\bvalue of £\s*([0-9][0-9,]*\.[0-9]{2})/i);
  let trackUrl = null;
  if (html) {
    // (An address written without quotes, <a href=https://…>, as some shops' emails do, is read too. Round 17.)
    for (const a of html.matchAll(/<a\b[^>]*href=(?:["']([^"']+)["']|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = (a[1] || a[2]).replace(/&amp;/g, "&").trim();
      const label = a[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (/^https:\/\//i.test(href) && href.length <= 800 && /track.{0,12}return/i.test(label)) { trackUrl = href; break; }
    }
  }
  const carrier = (text.match(CARRIERS) || [])[1] || null;
  const od = text.match(/order date\s*[:\-]?\s*([^\n]{4,30})/i);

  return {
    ok: true, kind: "return_instructions", source: "shopper_email", refundEligible: false,
    // The day the shop sent it: when the return was started, on the receipt's return timeline.
    at: refDate && !Number.isNaN(refDate.getTime()) ? isoDate(refDate) : null,
    retailer: { name: sender?.name && !/@/.test(sender.name) ? sender.name : null, domain: sender?.domain || null },
    returnId: idm ? idm[1] : null,
    orderRef: orderFromSubject ? orderFromSubject[1] : orderFromBody ? orderFromBody[1] : orderFromLink ? orderFromLink[1] : null,
    orderDate: od ? parseDate(od[1], refDate) : null,
    deadline, carrier, steps,
    qrMentioned: /\bqr\b/i.test(text) || /<img[^>]+(?:alt|src)=["'][^"']*qr/i.test(html || ""),
    estimatedRefundPence: refund ? money(refund[1]) : null,
    currency: /£|GBP/.test(text) ? "GBP" : null,
    trackUrl,
    // The return parcel's own tracking number, so carrier emails about it can show where it is.
    trackingNumber: (trackingIn(text) || {}).trackingNumber || null,
  };
}

// ---- Return progress emails ("We've received your return", "Your refund has been processed") -------------------
// Only emails whose subject is about a received return or a refund count, so a receipt or return-request email that
// merely says "once we've received your return we'll refund you" is never mistaken for one. The refund amount is
// what the shop's email says; Relay cannot confirm it.
// The text of an update email: its plain part, unless that is only a stub ("Hello Sam, #") beside a full HTML part, which
// is then what the email says. Round 15.
function shownText(parts, html) {
  const plain = parts.text.join("\n").trim();
  if (!html) return plain;
  if (!plain) return (htmlToText(html) || "").trim();
  // (A plain part of some length is the email's own words: the HTML is only turned into text for a short one.)
  if (plain.length > 1500) return plain;
  const fromHtml = (htmlToText(html) || "").trim();
  return plain.replace(/\s+/g, " ").length * 2 < fromHtml.replace(/[\s|]+/g, " ").length ? fromHtml : plain;
}
// Apple's credit note, "Credit Note" at the top of an email sent as "Your invoice from Apple.", "ORDER ID MQKS…-1", the
// thing cancelled ("Cancellation Date: …") and its amounts written as minus: the sale undone, its money given back, on the
// order whose number it carries (without the "-1"). Round 15.
const APPLE_CREDIT_TOP = /^[\s|]*(?:apple[ \t]+)?credit note[\s|]*$/im;
function appleCreditNote(headers, text) {
  // (Or forwarded from the shopper's mailbox: the forwarded message's own sender is Apple's, and the title is under it.)
  const fwd = !/(^|\.)apple\.com$/i.test(retailerFromFrom(headers.from)?.domain || "");
  const fwdFrom = fwd ? /^[ \t>*]*(?:from|von|de)[ \t*]*:[^\n]{0,80}@((?:[a-z0-9-]+\.)?apple\.com)\b/im.exec(String(text || "").slice(0, 4000)) : null;
  if (fwd && !fwdFrom) return null;
  const top = String(text || "").slice(0, fwd ? 4000 : 800);
  if (!APPLE_CREDIT_TOP.test(top)) return null;
  const t = String(text || "").slice(0, 20000);
  const ref = /\border id[\s|:]*([A-Z0-9]{8,14})(?:-\d{1,2})?\b/i.exec(t);
  const total = /\btotal\b[\s|:]*[-−]£\s?(\d{1,5}(?:,\d{3})*\.\d{2})/i.exec(t) || /[-−]£\s?(\d{1,5}(?:,\d{3})*\.\d{2})/.exec(t);
  const d = headers.date ? new Date(headers.date) : null;
  return { ok: true, kind: "return_update", stage: "refunded", creditNote: true, at: d && !Number.isNaN(d.getTime()) ? isoDate(d) : null,
    amountPence: total ? money(total[1]) : null, currency: total ? "GBP" : null, orderRef: ref ? ref[1] : null, returnId: null,
    retailer: { name: "Apple", domain: fwdFrom ? fwdFrom[1].toLowerCase() : retailerFromFrom(headers.from)?.domain || "apple.com" } };
}

export function parseReturnUpdateEmail(rawEmail) {
  const raw = String(rawEmail || "").slice(0, MAX_INPUT);
  const { headers, body } = splitMessage(raw);
  const subject = headers.subject || "";
  // A carrier's "we've received your return" means the carrier has it, not the shop: parseReturnParcelEmail reads those.
  if (returnCarrierOf(headers.from)) return { ok: false, reason: "not_a_return_update" };
  if (/\breturn request|\breturn label|\bhow to return|\bstart (?:a|your) return/i.test(subject)) return { ok: false, reason: "not_a_return_update" };
  if (/\bapple\b/i.test(headers.from || "") || /\binvoice from apple\b/i.test(subject)) {
    const cp = { text: [], html: [] }; collectParts(headers, body, cp);
    const credit = appleCreditNote(headers, shownText(cp, cp.html.join("\n")));
    if (credit) return credit;
  }
  const subjectSays = /\brefund|\breturn (?:has been )?(?:received|arrived|processed)|\breceived your return|\byour return (?:has|is)/i.test(subject);
  // (A subject that only names the order, Amazon's "Your Amazon.co.uk Order #D01-…", over "We're writing to confirm that we
  // have processed your refund for £2.49 for the above-referenced order": the email's opening says it. Round 15.)
  if (!subjectSays && !/\border\b/i.test(subject)) return { ok: false, reason: "not_a_return_update" };
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  const text = shownText(parts, html);
  if (!subjectSays && !/\b(?:we(?:'|’)?re writing to confirm that )?we (?:have|(?:'|’)ve) (?:processed|issued) (?:your|a) refund (?:for|of) £\s?\d/i.test(text.slice(0, 1500).replace(/\s+/g, " "))) return { ok: false, reason: "not_a_return_update" };
  const both = (subject + "\n" + text.slice(0, 6000)).replace(/￡/g, "£");
  // Money back for a price drop, or for an order the shop cancelled, is not a return: nothing was sent back, so Relay must
  // not show a return as refunded (round 3, 19 Nov 2026). The order's own card already says what was bought.
  const subj = subject.replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, "");
  const top = text.slice(0, 1500).replace(/\s+/g, " ");
  if (PRICE_ADJUSTMENT.test(subj) || PRICE_ADJUSTMENT.test(top)) return { ok: false, reason: "price_adjustment" };
  // (A takeaway app's changed total is money back on the order, not a return: parseOrderAdjustmentEmail. Round 10.)
  const ub = uberEmail(retailerFromFrom(headers.from)?.domain, subject, text);
  if (ub && ub.kind === "adjusted") return { ok: false, reason: "order_adjusted" };
  if (/\bcancell?(?:ed|ation)\b/i.test(subj) || NOT_A_PURCHASE_TOP.test(top) && !/\breturn(?:ed|s)?\b/i.test(subj)) return { ok: false, reason: "cancellation" };
  // (A request for money back, Apple's "A refund request has been received" and "Decision on refund request" that only says
  // to look at Report a Problem: nothing says money came back, so it is never a refund. Only one that says the request was
  // approved, or the refund issued, is. Round 13.)
  if (/\brefund request\b|\brequest(?:ed)? (?:for )?a refund\b/i.test(subj) && !/\brefund(?: request)? (?:has been|was|is) (?:approved|granted|issued|processed|completed)\b|\bwe(?:'|’)?ve (?:approved|issued|processed) (?:your|a|the) refund\b|\bwe(?:'|’)?re refunding (?:your|the|this)\b|\byour refund is being (?:credited|paid|sent)\b/i.test(both)) return { ok: false, reason: "refund_request" };
  let stage = null;
  if (/\brefund(?:ed)?\b[^.\n]{0,40}\b(?:has been|have been|was|is being|been)?\s*(?:processed|issued|approved|completed|sent|on (?:its|the) way)\b|\bwe(?:'|’)?ve (?:processed|issued|sent|completed) (?:your|a) refund|\bwe(?:'|’)?ve refunded\b|\brefund confirmation\b|\byour refund\b|\b(?:has|have) been (?:successfully )?refunded\b|\bhere comes the refund\b|\bsent you a refund\b|\brefund complete\b|\brefund (?:of £\s?[\d,.]+ )?has been (?:successfully )?initiated\b/i.test(both)) stage = "refunded";
  else if (/\b(?:we(?:'|’)?ve|we have) received your return|\byour return (?:has been received|has arrived|is with us)|\breturn (?:received|arrived)\b/i.test(both)) stage = "received";
  if (!stage) return { ok: false, reason: "not_a_return_update" };
  const sender = retailerFromFrom(headers.from);
  // A refund email the shopper forwarded from their own mailbox is the shop's: the shop is read from the forwarded
  // message, as for a receipt, so it still attaches to the order by its number. The shopper's own address is never the shop.
  // (A name that is only an address, "return@amazon.co.uk" <return@amazon.co.uk>, is never the shop's name. Round 15.)
  const fromName = ((headers.from || "").match(/^\s*"?([^"<@]+?)"?\s*</) || [])[1] || null;
  const shop = shopOf({ ld: null, sender, fromName, subject, text, html, otherText: html && parts.text.length ? htmlToText(html) : "" });
  if (shop.domain && PERSONAL_MAIL.test(shop.domain)) shop.domain = null;
  if (PERSONAL_MAIL.test(sender?.domain || "") && shop.name && !shop.domain && looksLikePerson(shop.name, null)) shop.name = null;
  const refDate = headers.date ? new Date(headers.date) : null;
  // (A labelled amount with the money on the line under its label, "Refunded total: |" over "£6.90", is the refund. Round 12.)
  // (The whole refund first, "Total Amount Refunded: £137.95", over the item's "Refund Value: £135.00" above it. Round 15.)
  const amt = stage === "refunded" ? (both.match(/\btotal (?:amount )?refunded\s*:?[\s|]{0,12}£\s*([0-9][0-9,]*\.[0-9]{2})/i) || both.match(/\b(?:refund(?:ed)? (?:total|amount|value)|total (?:refund(?:ed)?|amount refunded)|amount refunded|refund due)\s*:?[\s|]{0,12}£\s*([0-9][0-9,]*\.[0-9]{2})/i) ||
    both.match(/refund(?:ed)?[^£\n]{0,60}£\s*([0-9][0-9,]*\.[0-9]{2})/i) || both.match(/£\s*([0-9][0-9,]*\.[0-9]{2})[^.\n]{0,40}\brefund/i) ||
    // ("A refund of £3 has been initiated": whole pounds. Round 15.)
    both.match(/\ba refund of £\s*([0-9][0-9,]{0,8})(?![\d.,])/i) ||
    // ("A refund of £7.5 has been initiated": pence written with one figure, £7.50. Round 22.)
    ((m1) => m1 ? [m1[0], m1[1] + "0"] : null)(both.match(/\ba refund of £\s*([0-9][0-9,]{0,8}\.[0-9])(?![\d,])/i))) : null;
  const ref = subject.match(/\border\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})/i) || text.match(/\border\s*(?:number|no\.?|id|#)\s*[:#\s]*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})/i) ||
    // ("Refund Initiated : #32297", "for your order 32297": the order's number. Round 15.)
    subject.match(/\brefund\b[^#\n]{0,30}#\s?(\d{3,12})\b/i) || text.match(/\bfor your order #?(\d{4,12})\b/i);
  // (Amazon's "Your return is now complete" names its order only in the link to it, "order-details?orderID=206-…", in the
  // text part or URL-encoded in the HTML's. Only an order number in Amazon's own shape is taken from a link. Round 15.)
  const linkRef = !ref ? /[?&](?:%26)?orderID(?:=|%3D)((?:\d{3}|D\d{2})-\d{7}-\d{7})\b/i.exec(text.slice(0, 20000) + "\n" + html.slice(0, 200000)) : null;
  // (A payment service's refund names the shop's invoice, "Invoice ID: WB11050983-P001", which is that order's number. Round 12.)
  const inv = !ref ? text.match(/\binvoice\s*(?:id|number|no\.?)\s*[:#\s]*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,30})\b/i) ||
    // (A booking refunded by its "Transaction ID:" over the number, the number its booking email gave. Round 15.)
    /^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*(?:your )?transaction id[ \t]*:?[ \t|]*(?:\n[ \t|]*){0,4}(\d{8,16})[ \t|]*$/im.exec(text) : null;
  // (And what was first paid, to whom and when: "You originally paid UBER PAYMENTS UK LIMITED £4.99 GBP on 5 March 2026".)
  const orig = /\byou originally paid (.{2,60}?) £\s?([\d,]+\.\d{2})(?: GBP)? on (\d{1,2} [A-Za-z]{3,9} \d{4})/i.exec(both.replace(/\s+/g, " "));
  const fwdVia = PERSONAL_MAIL.test(sender?.domain || "") ? forwardedSender(text, { subject, personal: (d) => PERSONAL_MAIL.test(d) }) : null;
  const via = /(^|\.)paypal\./i.test((fwdVia && fwdVia.domain) || sender?.domain || "");
  const viaShop = via ? ((/\brefund of £\s?[\d,]+\.\d{2}(?: GBP)? from ([^\n|]{2,60}?)\s*(?:\n|\||$)/i.exec(both) || [])[1] || (/^[\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*([^\n|]{2,60}?) sent you a refund\b/im.exec(both) || [])[1] || (orig && orig[1]) || null) : null;
  const rid = text.match(/return (?:id|number|reference)\s*[:#\s]*((?=[A-Z0-9-]*\d)[A-Z0-9-]{5,30})(?![A-Za-z0-9\/:.])/i);
  return {
    ok: true, kind: "return_update", stage,
    at: refDate && !Number.isNaN(refDate.getTime()) ? isoDate(refDate) : null,
    amountPence: amt ? money(amt[1]) : null, currency: amt ? "GBP" : null,
    orderRef: ref ? ref[1] : inv ? inv[1] : linkRef ? linkRef[1] : null, returnId: rid ? rid[1] : null,
    ...(orig ? { paidPence: money(orig[2]), paidOn: parseDate(orig[3], refDate) } : {}),
    retailer: viaShop ? { name: viaShop.trim().replace(/\.{2,}$/, ""), domain: null, via: (fwdVia && fwdVia.domain) || sender.domain } : { name: shop.name || null, domain: shop.domain || null },
  };
}

// ---- Return parcels: carriers' and shops' emails about a parcel going back (return-tracking.js) -----------------
// From a carrier (Royal Mail, Parcelforce, Evri, InPost, DPD, Collect+, Yodel, by the sender's own domain): a return label
// or QR code made ("started"), the parcel dropped off or on its way back ("sent"), or delivered to the shop ("received").
// From a shop: only when its subject says the return parcel is on its way ("sent"). It must be about a return: "returned to
// sender" (a delivery that failed) is not one. Relay keeps what the email says and nothing else; which receipt it belongs
// to is worked out later, against that shopper's own receipts only (attachReturnTracking).
export function parseReturnParcelEmail(rawEmail) {
  const no = { ok: false, reason: "not_a_return_parcel" };
  const raw = String(rawEmail || "").slice(0, MAX_INPUT);
  const { headers, body } = splitMessage(raw);
  const subject = headers.subject || "", from = String(headers.from || "");
  const carrierSender = returnCarrierOf(from);
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  const text = shownText(parts, html);
  const lead = text.slice(0, 5000), head = subject + "\n" + lead;
  if (/\breturn(?:ed|ing)? to (?:the )?sender\b/i.test(head)) return no;
  const aboutReturn = /\breturn(?:s|ed|ing)?\b/i.test(subject) ||
    /\b(?:your|the|this) return\b|\breturns? (?:parcel|label|item|package|shipment)\b|\breturning (?:your|an?|the)\b|\bon (?:its|it's|the) way back\b|\bback to the (?:retailer|shop|store|seller)\b/i.test(lead);
  if (!aboutReturn) return no;
  if (!carrierSender && !/\breturn\b[^\n]{0,40}\b(?:on (?:its|it's|the) way|dropped off|in transit|been sent|been posted)\b|\bdropped off\b|\bon (?:its|it's|the) way back\b/i.test(subject)) return no;
  let stage = null;
  if (carrierSender && /\b(?:has been|was|been|we(?:'|’)?ve)\s+delivered\b|\bdelivered to\b/i.test(head) && !/\bout for delivery\b|\bdue to be delivered\b/i.test(head)) stage = "received";
  else if (/\bdropped off\b|\bdrop[- ]off (?:confirmed|confirmation|receipt)\b|\bhanded (?:it |your parcel |your return )?(?:in|over)\b|\b(?:we(?:'|’)?ve|we have) (?:got|received|collected) your (?:return|parcel)\b|\bcollected your (?:return|parcel)\b|\bon (?:its|it's|the) way back\b|\bon (?:its|it's) way to\b|\bin transit\b|\bhas been (?:posted|sent)\b|\baccepted at\b/i.test(head)) stage = "sent";
  else if (carrierSender && /\breturn label\b|\byour label\b|\blabel (?:is )?ready\b|\bprint (?:your|the) label\b|\b(?:qr|barcode) code\b/i.test(head)) stage = "started";
  if (!stage) return no;
  const t = trackingIn(text);
  const other = text.match(/\b(?:tracking|parcel|barcode|consignment)\s*(?:number|no\.?|#|id|code)\s*(?:is\s*)?[:#]?\s*([A-Z0-9]{8,30})\b/i) || text.match(/\b(JJD\d{12,20}|H[0-9A-Z]{15})\b/);
  const trackingNumber = t ? t.trackingNumber : other && /\d/.test(other[1]) ? other[1].toUpperCase() : null;
  const NAME = "([A-Z][\\w&'’ .-]{1,40}?)(?=\\s+(?:is|has|was|on|have|will|today|by|at|from|via|with|using|and)\\b|[.,:;!\\n]|$)";
  const named = (head.match(new RegExp("\\breturn(?:ing)?(?: parcel| item| package)? (?:to|for) " + NAME, "m")) || head.match(new RegExp("\\bback to " + NAME, "m")) || head.match(new RegExp("\\bparcel (?:to|for) " + NAME, "m")) || [])[1];
  const shop = named && !/^(?:the |us\b|our |sender|retailer)/i.test(named.trim()) ? named.trim() : null;
  const refDate = headers.date ? new Date(headers.date) : null;
  const ref = subject.match(/\border\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})/i) || text.match(/\border\s*(?:number|no\.?|id|#)\s*[:#\s]*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})/i) ||
    text.match(/\border\s+#?((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})\b/i);
  const sender = carrierSender ? null : retailerFromFrom(from);
  return {
    ok: true, kind: "return_update", stage, fromCarrier: Boolean(carrierSender),
    at: refDate && !Number.isNaN(refDate.getTime()) ? isoDate(refDate) : null,
    carrier: carrierSender || (t && t.carrier) || carrierIn(text) || null,
    trackingNumber, shop, orderRef: ref ? ref[1] : null,
    retailer: sender ? { name: sender.name || null, domain: sender.domain || null } : null,
  };
}


// ---- A shop's own news about an order already placed (round 6, 19 Nov 2026) ------------------------------------------------
// Both are read only when the email is not a receipt (classify in gmail.js tries the receipt first), and only with an order
// number, so they can only ever join the order they name: they never make a purchase card of their own.
// The shop of a shop's email, also when the shopper forwarded it from their own inbox (as for refunds, above).
function shopOfUpdate(headers, text, html, parts) {
  const sender = retailerFromFrom(headers.from);
  const fromName = ((headers.from || "").match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || null;
  const shop = shopOf({ ld: null, sender, fromName, subject: headers.subject || "", text, html, otherText: html && parts.text.length ? htmlToText(html) : "" });
  if (shop.domain && PERSONAL_MAIL.test(shop.domain)) shop.domain = null;
  if (PERSONAL_MAIL.test(sender?.domain || "") && shop.name && !shop.domain && looksLikePerson(shop.name, null)) shop.name = null;
  return { name: shop.name || null, domain: shop.domain || null };
}
function updateParts(rawEmail) {
  const raw = String(rawEmail || "").slice(0, MAX_INPUT);
  const { headers, body } = splitMessage(raw);
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  const text = shownText(parts, html);
  const subject = String(headers.subject || "").replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, "");
  const refDate = headers.date ? new Date(headers.date) : null;
  const at = refDate && !Number.isNaN(refDate.getTime()) ? isoDate(refDate) : null;
  // The order number, from the subject first ("Your order KO-1001 has been dispatched"), then the body ("Order number: …").
  // (Or a number the subject ends with after saying what happened to the order, "Your order has been cancelled 930952163":
  // digits only, so a word is never taken for it. Round 15.)
  const ref = subject.match(/\border\s*(?:number|no\.?)?\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})\b/i) ||
    subject.match(/\border\b[^\n]{0,40}?[\s#:-](\d{6,16})\s*$/i) || text.match(/\border\s*(?:number|no\.?|id|#)\s*(?:is\s*)?[:#\s]*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})\b/i) ||
    // (Round 15e: "Despatch Confirmation - Ref: cwk55120931", "Your order number is: cwk55120931".)
    subject.match(/\bref(?:erence)?\s*[:#]\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{5,24})\b/i) ||
    text.slice(0, 1500).match(/\byour order\s+#?((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})\b/i) ||
    // (Round 15e: "We have cancelled the following item(s) from your order 771508763", below the shop's menu.)
    text.slice(0, 15000).match(/\bcancell?ed\b[^.\n]{0,60}\bfrom your order\s+#?((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})\b/i);
  // (The order number only in the HTML, "Order Number: SLX4400917" over a text part that leaves it out: read from the HTML.
  // Round 22.)
  let htmlRef = null;
  if (!ref && html && text !== html) {
    const ht = (htmlToText(html) || "").slice(0, 30000);
    htmlRef = ht.match(/\border\s*(?:number|no\.?|id|#)\s*(?:is\s*)?[:#\s]*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})\b/i);
  }
  return { headers, parts, html, text, subject, at, orderRef: ref ? ref[1] : htmlRef ? htmlRef[1] : null };
}
// "Your order KO-1001 has been dispatched": a shop's dispatch email with no items in it. It used to be dropped, and with it the
// parcel's tracking number, so the carrier's later "delivered" email had nothing to join (round 6). Kept as a parcel update.
const DISPATCH_SUBJECT = /\b(?:dispatched|despatched|shipped|has shipped|on (?:its|it's|the) way|been sent|been posted|(?:dispatch|despatch|shipping|shipment) (?:confirmation|notification))\b/i;
const NOT_DISPATCH = /\b(?:return(?:s|ed|ing)?|refund(?:ed|s)?|cancell?(?:ed|ation)|delay(?:ed)?|problem|unable|failed|couldn(?:'|’)?t)\b/i;
export function parseDispatchEmail(rawEmail) {
  const no = { ok: false, reason: "not_a_dispatch_email" };
  const u = updateParts(rawEmail);
  if (!DISPATCH_SUBJECT.test(u.subject) || NOT_DISPATCH.test(u.subject) || !/\border\b/i.test(u.subject + "\n" + u.text.slice(0, 1500))) return no;
  if (CARRIER_SENDERS.some(([, re]) => re.test(String(u.headers.from || ""))) || returnCarrierOf(u.headers.from)) return no;
  if (!u.orderRef) return no;
  const t = trackingIn(u.text) || trackingIn(String(u.html || "").replace(/&quot;/g, '"').replace(/\\\//g, "/"));
  return { ok: true, kind: "delivery_update", status: "shipped", at: u.at, carrier: (t && t.carrier) || carrierIn(u.text) || null,
    trackingNumber: t ? t.trackingNumber : null, merchant: null, retailer: shopOfUpdate(u.headers, u.text, u.html, u.parts), orderRef: u.orderRef };
}
// "Your order LF-6006 has been cancelled", "Part of your order has been cancelled": the shop cancelled all or part of an order.
// Nothing was bought (or that part wasn't), so it is not a purchase and not money spent; the order's card says so. The amount
// is what the email says came back, when it says.
// Which items a part-cancelled order lost, only where the email names them (round 8): under a "Cancelled items" heading, or in
// a sentence ("We've had to cancel the Linen Shirt White from your order"). Never worked out from an amount.
const CANCELLED_HEAD = /^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*(?:cancell?ed items?|items? (?:that )?(?:we(?:'|’)?ve |we have |have been |has been |were |was )?cancell?ed|the following items? (?:has|have) been cancell?ed|what(?:'|’)?s been cancell?ed|item\(s\) cancell?ed)\s*:?[\s|]*$/im;
function cancelledNames(text) {
  const t = String(text || "");
  const out = [];
  const h = CANCELLED_HEAD.exec(t);
  if (h) {
    const after = t.slice(h.index + h[0].length).split("\n");
    // The list under the heading, to the next heading or money line ("Amount to be refunded", "The rest of your order").
    const stop = after.findIndex((l, k) => k > 0 && /^[\s|]*(?:amount|refund|total|sub-?total|the rest|your other items|items? (?:still )?(?:on (?:its|their) way|being sent|to follow)|still coming|we(?:'|’)?ll|you(?:'|’)?ll|if you|questions)/i.test(l));
    const list = after.slice(0, stop > 0 ? stop : 40);
    for (const i of readItems(list.join("\n"))) if (i.name) out.push({ name: i.name, qty: i.qty || 1 });
    // A list with no prices: each name on its own line.
    if (!out.length) for (const l of list.slice(0, 12)) {
      const n = l.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
      if (n && /\p{L}{3}/u.test(n) && n.length <= 90 && !/^(?:size|colou?r|qty|quantity|price)\b|£|:\s*$/i.test(n) && !/[.!?]$/.test(n)) out.push({ name: n, qty: 1 });
      else if (out.length && !n) break;
    }
  }
  const sm = /\bwe(?:'|’)?ve (?:had to )?cancel(?:led)?|\bwe have (?:had to )?cancel(?:led)?|\bwe(?:'|’)?re sorry,? but we(?:'|’)?ve cancelled/i.exec(t.slice(0, 2000));
  if (!out.length && sm) {
    const m = /^\s+(?:the |your )?(?:item\s+)?["“]?([^"”.\n]{3,80}?)["”]?\s+(?:from|in|on) your order\b/i.exec(t.slice(sm.index + sm[0].length, sm.index + sm[0].length + 160));
    if (m && !/^(?:items?|some|part|parts|one|order|it|them|these|those)$/i.test(m[1].split(/\s+/)[0])) out.push({ name: m[1].trim(), qty: 1 });
  }
  return out.slice(0, 20);
}
// The things an order email shows in its product blocks with no heading over them: a name, maybe its colour or size, then
// how many ("X1", "Qty: 1"). The name is the longest name-like line of the two above how many. Round 11.
function namedInOrderBlock(text) {
  const lines = String(text || "").split("\n").map((l) => l.replace(/[|]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const out = [];
  for (let k = 1; k < lines.length && out.length < 20; k++) {
    const q = /^(?:[x×]\s?(\d{1,3})|(?:qty|quantity)\s*:?\s*(\d{1,3}))$/i.exec(lines[k]);
    if (!q) continue;
    const cands = lines.slice(Math.max(0, k - 2), k).filter((n) => (n.match(/\p{L}/gu) || []).length >= 6 && n.length <= 140 && !/£|€|\$|:\s*$|[.!?]$/.test(n) && n.split(" ").length >= 2);
    const name = cands.sort((a, b) => b.length - a.length)[0];
    if (name) out.push({ name, qty: Number(q[1] || q[2]) });
  }
  return out;
}
// The things a cancellation lists as each name over how many, "Lean Protein Bar - 12 x 45g - Chocolate" over "Quantity 1".
// Round 15e.
function namedOverQuantity(text) {
  const rows = String(text || "").slice(0, 40000).split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
  const out = [];
  for (let i = 1; i < rows.length && out.length < 20; i++) {
    const q = /^(?:quantity|qty)\s*:?\s*(\d{1,3})$/i.exec(rows[i]);
    const n = rows[i - 1].replace(/\s*<https?:[^>\s]{1,2000}>/g, "").trim();
    if (q && /\p{L}{3}/u.test(n) && n.length <= 120 && !/£|:\s*$|^(?:items?|products?|size|colou?r)$/i.test(n)) out.push({ name: n, qty: Number(q[1]) });
  }
  return out;
}
export function parseCancellationEmail(rawEmail) {
  const no = { ok: false, reason: "not_a_cancellation" };
  const u = updateParts(rawEmail);
  if (returnCarrierOf(u.headers.from) || CARRIER_SENDERS.some(([, re]) => re.test(String(u.headers.from || "")))) return no;
  const top = u.text.slice(0, 1500).replace(/\s+/g, " ");
  const said = /\bcancell?(?:ed|ation)\b/i.test(u.subject) || NOT_A_PURCHASE_TOP.test(top);
  // (A subscription that will stop, Google Play's "Your Microsoft Word: … subscription will be cancelled" with "will be
  // cancelled on 13 Aug 2019. No refunds will be issued": nothing bought is undone, it just doesn't renew. Kept as news for
  // the subscription's latest payment (gmail.js attachCancellations): the day it ends and that no money comes back. Round 13.)
  const sub = /^\s*(?:(?:fwd?|fw)\s*:\s*)*your (.{2,80}?) subscription (?:will be|has been|is|was) cancell?ed\b/i.exec(u.subject);
  if (sub) {
    const on = /\b(?:will be|has been|was|is) cancell?ed (?:on|from) (\d{1,2}[ -][A-Za-z]{3,9}[ -]\d{4}|[A-Za-z]{3,9} \d{1,2},? \d{4})/i.exec(top);
    // (A day still to come: read without the email's own date, which only allows days before it.)
    const endsOn = on ? parseDate(on[1].replace(/-/g, " ")) : null;
    return { ok: true, kind: "order_update", stage: "cancelled", subscription: true, subscriptionName: sub[1].trim(), endsOn: endsOn || null,
      refund: /\bno refunds? (?:will be|is|are) (?:issued|given|made|due)\b/i.test(top) ? false : null, partial: false, at: u.at, orderRef: u.orderRef || null,
      amountPence: null, currency: null, retailer: shopOfUpdate(u.headers, u.text, u.html, u.parts) };
  }
  // (A stay or a trip booked and then cancelled, Booking.com's "Booking cancelled for Swarn by Hawks", "Your booking has been
  // successfully cancelled for free", "Confirmation number: 6381624292": the booking it names is cancelled, joined to it by
  // that number. Round 15.)
  const stayGone = /\b(?:booking|reservation|stay)\b[^\n]{0,30}\bcancell?ed\b|\bcancell?ed\b[^\n]{0,12}\b(?:booking|reservation)\b/i.test(u.subject) ||
    /\byour (?:booking|reservation) (?:has been|was|is) (?:successfully )?cancell?ed\b/i.test(top);
  if (stayGone && !/\b(?:appointment|table|class|test)\b/i.test(u.subject)) {
    // (Or its "Itinerary # 73001234567890", a travel site's booking number. Round 21.)
    const num = u.orderRef || (/\b(?:confirmation|booking|reservation) (?:number|no\.?|reference|ref\.?)[\s:|]{0,6}([A-Z0-9][A-Z0-9-]{5,15})\b/i.exec(top) || /\bitinerary (?:number|no\.?|#)[\s:|]{0,6}(\d{8,16})\b/i.exec(top) || [])[1] || null;
    if (num && /\d/.test(num)) return { ok: true, kind: "order_update", stage: "cancelled", partial: false, at: u.at, orderRef: num, amountPence: null, currency: null,
      ...(/\bcancell?ed for free\b|\bfree cancellation\b|\bcancellation cost\b[^\n]{0,80}?(?:US\$|€|£|\$)\s?0(?:\.00)?\b/i.test(top + " " + u.text.slice(0, 4000).replace(/\s+/g, " ")) ? { free: true } : {}),
      retailer: shopOfUpdate(u.headers, u.text, u.html, u.parts) };
  }
  // A price adjustment or a subscription ("Your membership has been cancelled") is not a cancelled order.
  if (!said || PRICE_ADJUSTMENT.test(u.subject + " " + top) || /\b(?:subscription|membership|plan|direct debit|account|booking|reservation|appointment|trial)\b/i.test(u.subject)) return no;
  if (!/\border\b/i.test(u.subject + " " + top)) return no;
  // (No order number, but the whole order is said to be cancelled and the email shows what was in it, "1000mm Coffee
  // Table", "Black", "X1" (Homary): kept with those names, so it joins only the one order of that shop with those very
  // items (gmail.js attachCancellations). Round 11.)
  if (!u.orderRef) {
    if (!/\b(?:your|the|this) order (?:was|has been|is) cancell?ed\b/i.test(u.subject + " " + top)) return no;
    const items = namedInOrderBlock(u.text);
    if (!items.length) return no;
    return { ok: true, kind: "order_update", stage: "cancelled", partial: false, at: u.at, orderRef: null, byItems: true, cancelledItems: items,
      amountPence: null, currency: null, retailer: shopOfUpdate(u.headers, u.text, u.html, u.parts) };
  }
  // (Or "We have cancelled the following item(s) from your order", "the following products have been successfully cancelled":
  // only what it lists. Round 15e.)
  const top2 = u.text.slice(0, 15000).replace(/\s+/g, " ");
  // (Never a company's footer, "Silverline is part of Example Jewellery Group Ltd": "part of" the order only. Round 22.)
  const partial = (/\b(?:part of (?:your |the |this )?(?:order|items?|purchase)|some of|one of|an item|some items|items? (?:in|from|of) your order (?:has|have) been|(?:has|have) been cancell?ed from your order)\b/i.test(u.subject + " " + top) ||
    /\bcancell?ed the following (?:items?|products?|item\(s\))\b|\bthe following (?:items?|products?|item\(s\)) (?:has|have) been (?:successfully )?cancell?ed\b/i.test(top2)) &&
    !/(?<!\b(?:part|some|one|items?) (?:of|in|from) )\b(?:your|the|this) (?:whole |entire )?order (?:has been|was|is)(?: now)? cancell?ed\b/i.test(u.subject + " " + top);
  const amt = (top.match(/\brefund(?:ed)?\b[^£€\n]{0,40}([£€])\s*([0-9][0-9,]*\.[0-9]{2})/i) || top.match(/([£€])\s*([0-9][0-9,]*\.[0-9]{2})[^.\n]{0,40}\b(?:refund|back to your|returned to your)/i));
  return { ok: true, kind: "order_update", stage: "cancelled", partial, at: u.at, orderRef: u.orderRef,
    ...(partial ? { cancelledItems: cancelledNames(u.text).length ? cancelledNames(u.text) : namedInOrderBlock(u.text).length ? namedInOrderBlock(u.text) : namedOverQuantity(u.text) } : {}),
    amountPence: amt ? money(amt[2]) : null, currency: amt ? (amt[1] === "€" ? "EUR" : "GBP") : null,
    retailer: shopOfUpdate(u.headers, u.text, u.html, u.parts) };
}

// A takeaway app's "Your order #4400112 was accepted", "Thank you for ordering from Lagoon Grill": no money in it, but it names
// the restaurant that the app's payment receipt (sent minutes later, from the app's own domain) leaves out. Kept as the
// order's news (gmail.js attachAccepted gives that receipt the restaurant's name). Round 22.
export function parseOrderAcceptedEmail(rawEmail) {
  const no = { ok: false, reason: "not_accepted" };
  const u = updateParts(rawEmail);
  const subj = String(u.subject || "").replace(/[ \s]+/g, " ");
  const s = /^your order #?\s?(\d{4,12}) (?:was|has been|is) accepted\b/i.exec(subj);
  if (!s) return no;
  const sender = retailerFromFrom(u.headers.from);
  if (!sender || !sender.domain || PERSONAL_MAIL.test(sender.domain) || /(^|\.)(?:paypal|klarna|clearpay|laybuy|stripe)\./i.test(sender.domain)) return no;
  const flat = String(u.text || "").slice(0, 6000).replace(/[ \s]+/g, " ");
  const m = /\bthank you for ordering from ([\p{L}\d][\p{L}\d&'’ .-]{1,48}?)\s?[.!]/iu.exec(flat);
  if (!m || /^(?:us|our|the app)$/i.test(m[1].trim())) return no;
  const d = u.headers.date ? new Date(u.headers.date) : null;
  return { ok: true, kind: "order_update", stage: "accepted", at: u.at, orderRef: s[1], merchant: m[1].trim(),
    sentAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null, retailer: { name: sender.name || null, domain: sender.domain } };
}

// A takeaway app's changed total for an order it already charged (Uber Eats: "We adjusted the total for your recent order
// from Grill & Do", "Previous total £15.78", "Refund -£8.76", "New Total £7.02"). Money back on that order, never a purchase
// and never a return: kept as the order's news (gmail.js attachAdjustments joins it to the order by its restaurant, its
// previous total and its day). Round 10.
export function parseOrderAdjustmentEmail(rawEmail) {
  const no = { ok: false, reason: "not_an_adjustment" };
  const u = updateParts(rawEmail);
  const sender = retailerFromFrom(u.headers.from);
  // (Forwarded from the shopper's own mailbox, the original sender says it is Uber.)
  const fw = PERSONAL_MAIL.test(sender?.domain || "") ? forwardedSender(u.text, { subject: u.headers.subject, personal: (d) => PERSONAL_MAIL.test(d) }) : null;
  const ub = uberEmail((fw && fw.domain) || sender?.domain, u.subject, u.text);
  // (A shop's support team writing that it refunded part of an order, or put credit on the account, for an order it names:
  // money back on that order, joined by its number (gmail.js attachAdjustments). Never from a payment service or the
  // shopper's own mailbox, whose emails are read as receipts or refunds of their own. Round 12.)
  // (A payment service's "You've authorised £38.00 GBP to …": one payment towards a purchase with that shop, a deposit or an
  // instalment, joined to it by gmail.js attachCancellations. Round 12.)
  if (/(^|\.)paypal\./i.test((fw && fw.domain) || sender?.domain || "")) {
    const pa = paymentAuthorised(u.subject, u.text);
    if (pa && pa.amountPence) return { ok: true, kind: "order_update", stage: "payment", at: parseDate(pa.on || "", u.headers.date ? new Date(u.headers.date) : null) || u.at,
      orderRef: null, paymentRef: pa.orderRef, merchant: null, amountPence: pa.amountPence, previousTotalPence: null, newTotalPence: null, currency: "GBP",
      retailer: { name: pa.merchant, domain: null, via: (fw && fw.domain) || sender.domain } };
  }
  // (A booking paid in parts, the shop's own word that one part was taken, "your recent payment has been successful and your
  // payment history is detailed below", with the booking's reference and each payment's day over its amount: the payment
  // dated the day the email was sent (or the latest one listed) is one payment towards that booking, joined to it like a
  // payment service's. Never from a payment service or the shopper's own mailbox. Round 23.)
  {
    const from0 = (fw && fw.domain) ? fw : sender;
    if (from0 && from0.domain && !PERSONAL_MAIL.test(from0.domain) && !isVia(from0.domain) && !/(^|\.)(?:paypal|klarna|clearpay|laybuy)\./i.test(from0.domain)) {
      const t = String(u.text || "").slice(0, 20000);
      const said = /\b(?:your|the) (?:recent |latest |scheduled |instalment )?payment (?:has been|was) (?:successful|received|taken|processed)\b/i.test(t) && /\bpayment history\b/i.test(t);
      const bref = /\bbooking ref(?:erence)?(?: number)?\s*:?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,23})\b/i.exec(t);
      if (said && bref) {
        const rows = t.split("\n").map((x) => x.replace(/^[\s|]+|(?<![\s|])[\s|]+$/g, "")).filter(Boolean);
        const hist = [];
        const h0 = rows.findIndex((r) => /\bpayment history\b/i.test(r));
        for (let k = h0 + 1; k + 1 < rows.length && k < h0 + 80 && hist.length < 24; k++) {
          const d = /^(\d{1,2} [A-Za-z]{3,9}\.? \d{4})$/.exec(rows[k]);
          const a = /^£\s?(\d{1,3}(?:,\d{3})*|\d{1,7})(?:\.(\d{2}))?$/.exec(rows[k + 1] || "");
          if (d && a) { hist.push({ on: parseDate(d[1]), pence: Number(a[1].replace(/,/g, "")) * 100 + Number(a[2] || 0) }); k++; }
        }
        const pick = hist.find((x) => x.on && x.on === u.at) || hist[hist.length - 1];
        if (pick && pick.pence > 0) return { ok: true, kind: "order_update", stage: "payment", at: pick.on || u.at, orderRef: null, paymentRef: bref[1].toUpperCase(), merchant: null,
          amountPence: pick.pence, previousTotalPence: null, newTotalPence: null, currency: "GBP", retailer: { name: from0.name || null, domain: from0.domain } };
      }
    }
  }
  const from = (fw && fw.domain) ? fw : sender;
  if ((!ub || ub.kind !== "adjusted") && from && from.domain && !PERSONAL_MAIL.test(from.domain) && !/(^|\.)(?:paypal|klarna|clearpay|laybuy)\./i.test(from.domain)) {
    const sr = supportRefund(String(u.subject || "").replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, ""), u.text);
    if (sr && sr.refs.length) return { ok: true, kind: "order_update", stage: "adjusted", at: u.at, orderRef: sr.refs[0], orderRefs: sr.refs, merchant: null,
      amountPence: sr.refundPence || 0, ...(sr.creditPence ? { creditPence: sr.creditPence } : {}), previousTotalPence: null, newTotalPence: null, currency: "GBP", bySupport: true,
      retailer: { name: from.name || null, domain: from.domain } };
  }
  if (!ub || ub.kind !== "adjusted" || ub.refundPence == null) return no;
  return { ok: true, kind: "order_update", stage: "adjusted", at: u.at, orderRef: u.orderRef || null, merchant: ub.merchant || null,
    amountPence: ub.refundPence, previousTotalPence: ub.previousPence, newTotalPence: ub.newPence, currency: "GBP", ...(ub.paidAt ? { paidAt: ub.paidAt } : {}),
    // (A ride's changed fare is the ride's, never an Eats order's. Round 20.)
    retailer: { name: ub.ride ? "Uber" : "Uber Eats", domain: (fw && fw.domain) || sender.domain } };
}

// ---- Product photos ---------------------------------------------------------------
// Picks up to two likely product-photo URLs from an order email's HTML. Only https links to
// real hostnames are returned. Logos, social icons, tracking pixels and payment badges are skipped.
const NOT_A_PHOTO = /(pixel|tracking|track\b|beacon|spacer|logo|facebook|instagram|twitter|tiktok|pinterest|youtube|linkedin|social|icon|badge|footer|header|banner|payment|visa|mastercard|paypal|klarna|apple-?pay|google-?play|app-?store|qr|barcode|\.gif(\?|$)|1x1|\/open\b|click\.)/i;
export function extractProductImageUrls(rawEmail, parsed) {
  const raw = String(rawEmail || "").slice(0, MAX_INPUT);
  const { headers, body } = splitMessage(raw);
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  if (!html) return [];
  return scoredPhotos(html, rawEmail, parsed).slice(0, 2).map(f => f.url);
}
// True when the best photo in the email is named after (or linked as) one of the items bought, so it really shows
// the item. Shop logos, banners and adverts don't match an item name and are never treated as the item's photo.
export function photoShowsItem(rawEmail, parsed) {
  const raw = String(rawEmail || "").slice(0, MAX_INPUT);
  const { headers, body } = splitMessage(raw);
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  if (!html) return false;
  const best = scoredPhotos(html, rawEmail, parsed)[0];
  return Boolean(best && best.matched);
}
const COMMON = new Set(["with", "your", "from", "this", "that", "order", "item", "size", "colour", "color", "black", "white", "pack", "high", "rise"]);
// `parsed` is the receipt already read from this email, when the caller has it, so the email isn't read twice.
function scoredPhotos(html, rawEmail, parsed) {
  parsed = parsed && Array.isArray(parsed.items) ? parsed : parseReceiptEmail(rawEmail);
  const r = parsed.retailer || {};
  // The shop's own name is in its logo's alt text, so it can't show that a photo is of the item.
  const shop = String((r.name || "") + " " + (r.domain || "")).toLowerCase();
  const words = (parsed.items || []).flatMap(i => String(i.name || "").toLowerCase().split(/\W+/)).filter(w => w.length > 3 && !COMMON.has(w) && !shop.includes(w));
  const found = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = (/\bsrc=["']([^"']+)["']/i.exec(tag) || [])[1];
    if (!src) continue;
    const url = src.replace(/&amp;/g, "&").trim();
    if (!/^https:\/\//i.test(url) || url.length > 500) continue;
    let host;
    try { host = new URL(url).hostname; } catch { continue; }
    if (!host.includes(".") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.endsWith(".local") || host === "localhost") continue;
    const alt = ((/\balt=["']([^"']*)["']/i.exec(tag) || [])[1] || "").toLowerCase();
    if (NOT_A_PHOTO.test(url) || NOT_A_PHOTO.test(alt)) continue;
    const w = Number((/\bwidth=["']?(\d+)/i.exec(tag) || [])[1] || 0), h = Number((/\bheight=["']?(\d+)/i.exec(tag) || [])[1] || 0);
    if ((w && w < 80) || (h && h < 80)) continue;
    let score = 0;
    const matched = words.some(x => alt.includes(x) || url.toLowerCase().includes(x));
    if (matched) score += 3;
    if (w >= 150 || h >= 150) score += 1;
    if (/product|item|catalog|media|images?/i.test(url)) score += 1;
    if (!found.some(f => f.url === url)) found.push({ url, score, matched, order: found.length });
  }
  return found.sort((a, b) => b.score - a.score || a.order - b.order);
}
