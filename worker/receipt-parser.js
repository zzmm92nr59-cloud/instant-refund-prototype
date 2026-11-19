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
import { flightBooking, flightItemName } from "./flight-booking.js";
import { domainBase, cleanItems, rankShop, shopNamesInText, forwardedSender, mainLinkDomain, isVia, itemsFromCells, GAME_SHOP, gameTitle, gameItems, looksLikePerson } from "./receipt-reader.js";
import { PERSONAL_MAIL } from "./receipt-category.js";
import { readItems, moneyOf, settleItems, checkItems, statedItemCount, lineOf } from "./receipt-items.js";
import { namesCheck } from "./item-names.js";
import { uberEmail, takeawayMerchant, groceryDayOf, gameBundle } from "./receipt-senders.js";

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
  try { bytes = Uint8Array.from(atob(text.replace(/\s+/g, "")), (c) => c.charCodeAt(0)); } catch { return ""; }
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
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = withoutInvisible(decodeMimeWords(line.slice(i + 1).trim()));
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
  if (enc.includes("quoted-printable")) return decodeQuotedPrintable(body, cs);
  if (enc.includes("base64")) return decodeBase64(body, cs);
  return body;
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
  else if (/text\/plain/i.test(type)) out.text.push(decoded);
}
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
// The full-width pound sign some shops print ("Grand Total:￡123.20", Homary) is the pound sign (coverage round).
const fullWidthPounds = (t) => String(t).replace(/\uffe1/g, "£");
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
function htmlToText(html) {
  const shown = withoutHidden(html);
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
    .replace(/>([^<>]*\|[^<>]*)</g, (m, t) => (/£|&pound;|&#163;|\b(?:qty|quantity|size|colou?r|price)\b\s*:/i.test(t) || t.split("|")[0].trim().split(/\s+/).length <= 3 ? m : ">" + t.replace(/\|/g, "\u2502") + "<"))
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
  const m = String(str).match(/([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.([0-9]{2}))?/);
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
const F_BEFORE = new RegExp("\\b" + F_LABEL + F_GAP + "(€|EUR|US ?\\$|USD|CA\\$|CAD|AU?\\$|AUD|\\$)[ \\t]?" + F_NUM, "gi");
const F_AFTER = new RegExp("\\b" + F_LABEL + F_GAP + F_NUM + "[ \\t]?(€|EUR\\b|USD\\b|CAD\\b|AUD\\b)", "gi");
const DOLLARS = [["USD", /\bUSD\b|US ?\$|\bU\.?S\.? dollars?\b/i], ["CAD", /\bCAD\b|CA\$|\bCanadian dollars?\b/i], ["AUD", /\bAUD\b|(?<![A-Za-z])AU?\$|\bAustralian dollars?\b/i]];
// "80.00", "80,00", "1,234.56" and "1.234,56" all read; anything else (three decimals, mixed-up separators) doesn't.
export function foreignMinor(raw) {
  const m = /^(\d{1,3}(?:[.,]\d{3})+|\d+)(?:([.,])(\d{2}))?$/.exec(String(raw == null ? "" : raw));
  if (!m) return null;
  const groups = m[1].match(/[.,]/g) || [];
  if (new Set(groups).size > 1 || (m[2] && groups.includes(m[2]))) return null;
  const n = Number(m[1].replace(/[.,]/g, "")) * 100 + Number(m[3] || 0);
  return Number.isSafeInteger(n) ? n : null;
}
function foreignTotal(text) {
  if (/£|\bGBP\b/.test(text)) return null;
  const found = [];
  for (const m of text.matchAll(F_BEFORE)) found.push({ index: m.index, label: m[0], sign: m[1], amount: m[2] });
  for (const m of text.matchAll(F_AFTER)) found.push({ index: m.index, label: m[0], sign: m[2], amount: m[1] });
  found.sort((a, b) => a.index - b.index);
  // Not a "Sub Total", and not a total that says it leaves something out ("Total (excl. VAT)", "Total (before tax)").
  const notSub = found.filter((f) => !/sub[-\s]?$/i.test(text.slice(Math.max(0, f.index - 4), f.index)) && !/\((?:excl|ex\b|excluding|before|net\b|without)/i.test(f.label));
  const pick = notSub.find((f) => /^(?:grand\s+)?total\s+(?:including|incl\.?|inc\.?)\s/i.test(f.label) || /^grand\s/i.test(f.label)) || notSub[0];
  if (!pick) return null;
  const sign = pick.sign.toUpperCase();
  let currency = sign === "€" || sign === "EUR" ? "EUR" : sign === "US$" || sign === "US $" || sign === "USD" ? "USD" : sign === "CA$" || sign === "CAD" ? "CAD" : /^(AU?\$|AUD)$/.test(sign) ? "AUD" : null;
  // A bare "$": only when the email names exactly one kind of dollar.
  if (!currency && sign === "$") { const named = DOLLARS.filter(([, re]) => re.test(text)).map(([c]) => c); if (named.length === 1) currency = named[0]; }
  const minor = foreignMinor(pick.amount);
  return currency && minor != null ? { currency, minor } : null;
}

function retailerFromFrom(fromHeader) {
  if (!fromHeader) return null;
  const name = fromHeader.match(/^\s*"?([^"<]+?)"?\s*</);
  const addr = fromHeader.match(/<?([^<>\s"']+@[^<>\s"']+)>?/);
  // (A quote straight after the address, as in `orders@tempur.com"`, is not part of it.)
  const domain = addr ? addr[1].split("@")[1].toLowerCase().replace(/[^a-z0-9.-]+$/, "") : null;
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
  return gap(us) < gap(uk) ? us : uk;
}

// The order's date. A date labelled as the order's ("Order date: 01/11/2026", "Placed on …") comes first, and a date after
// the email was sent (a pre-order's release date, a concert's day, a renewal's next date) is never the order's: the next
// date in the text is tried instead (round 3, 19 Nov 2026).
const ORDER_DATE_LABEL = /\b(?:order(?:ed)?|placed|purchase|booked|booking|transaction|invoice|receipt)\s*(?:date|on|made)?\s*(?:\/\s*[\p{L} ]{2,20})?\s*[:|]\s*\|?\s*([^\n]{6,40})/giu;
export function parseDate(text, refDate) {
  const t = String(text || "");
  const late = (v) => Boolean(v) && refDate instanceof Date && !Number.isNaN(refDate.getTime()) && new Date(v + "T00:00:00Z").getTime() > refDate.getTime() + 2 * 86400000;
  for (const m of t.slice(0, 20000).matchAll(ORDER_DATE_LABEL)) { const v = dateFound(m[1], refDate); if (v && !late(v)) return v; }
  // ("Ordered on 18 November 2026", "Placed on Wed 18 Nov 2026" with no colon: still the order's date, before a delivery
  // day written higher up. Round 8.)
  for (const m of t.slice(0, 20000).matchAll(/\b(?:ordered|placed|order placed)\s+on\s+([^\n|]{6,40})/gi)) { const v = dateFound(m[1], refDate); if (v && !late(v)) return v; }
  const v = dateFound(t, refDate);
  if (!late(v)) return v;
  for (const line of t.split("\n")) { const w = dateFound(line, refDate); if (w && !late(w)) return w; }
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
  return off.some((o) => Math.abs(was - o - now) <= 1) || Math.abs(was - off.reduce((n, o) => n + o, 0) - now) <= 1 ? now : null;
}
function fromText(text, refDate) {
  // Some plain-text parts write the pound sign as "L" ("L69.00" on its own line). Only whole lines that are just an amount are changed.
  text = text.replace(/^([ \t|]*)L\s?([0-9][0-9,]*\.[0-9]{2})[ \t|]*$/gm, "$1£$2");
  // Bold written the plain-text way ("| **Total** | **£500.00** |") reads as the words themselves.
  text = text.replace(/\*\*([^*\n]{1,80})\*\*/g, "$1");
  // Others write the currency after the amount ("5 GBP", "12.99 GBP"): read as "£5.00", "£12.99" (never "£0.00 GBP" twice).
  text = text.replace(/(?<![£\d.,])(?<!£ )(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?[ \t]?GBP\b/g, (m, n, p) => "£" + n + "." + (p || "00"));
  const ref =
    text.match(/\border\s*(?:number|no\.?|id|ref(?:erence)?|#)\s*(?:is\s*)?[:#\s]*([A-Z0-9][A-Z0-9-]{3,24})/i) ||
    // ("Order number |" with the number in the row under it, as an HTML email's table gives it. Round 10.)
    text.match(/\border\s*(?:number|no\.?)\s*:?[\s|]*\n[\s|]*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,24})[\s|]*$/im) ||
    text.match(/\border\s*#\s*([A-Z0-9-]{3,24})/i) ||
    // A booking's own number ("Confirmation # : 2110090879", "Booking reference: ABC123"), so its later emails match it.
    text.match(/\b(?:confirmation|booking|reservation)\s*(?:number|no\.?|ref(?:erence)?|code|#)\s*(?:is\s*)?[:#\s]*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,24})\b/i) ||
    // A shop that sends an invoice instead of an order confirmation ("Invoice number: INV-2290"): its number is the order's
    // (round 7), so its later emails (dispatch, refund) can find it. Only with a digit in it ("Invoice No. attached" isn't one).
    text.match(/\binvoice\s*(?:number|no\.?|ref(?:erence)?|#)\s*(?:is\s*)?[:#\s]*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,24})\b/i);

  // (A note in brackets and a column edge can sit between the word and the amount: "Total (including VAT): | £10.96".)
  // "Sub Total" is the word "Total" too, so it is passed over while a real total follows, and a total that says it
  // includes delivery ("Total Including Delivery | £315.78") beats a plain one.
  const totals = [...text.matchAll(/\b(?:order\s+|grand\s+)?total(?:\s+(?:including|incl\.?|inc\.?)\s+(?:delivery|postage|shipping|vat|p&p))?(?:\s+(?:paid|amount|charged|cost|price|to pay(?: in store)?|due|guide price))?(?:\s+(?:by|with|on|using) (?:card|cash|[a-z]+ card|apple pay|google pay|paypal))?(?:\s*\([^)\n]{1,40}\))?\s*(?:[:|]\s*|[-–]\s+(?=£)){0,3}£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/gi)];
  // Not the items' own total ("Products total", "Goods total", "Items total"), and, when there is a subtotal, a total after it
  // (an email can print the total at the top too, or a "Total" for each line of its item list).
  const before = (m) => text.slice(Math.max(0, m.index - 14), m.index);
  // (Nor a total before VAT, "Total (exc. VAT): £12.50", when the email also gives the total with it: coverage round.)
  const notSub = totals.filter((m) => !/sub[-\s]?$/i.test(before(m)) && !/\b(?:items?|products?|goods|line|item\(s\))[ \t]*$/i.test(before(m)) &&
    !(/^total\s*\((?:exc|excl|excluding|ex)\b/i.test(m[0]) && totals.some((o) => /^total\s*\((?:inc|incl|including)\b/i.test(o[0]))));
  const subAt = (/\bsub-?\s?total\b/i.exec(text) || {}).index;
  const afterSub = subAt == null ? [] : notSub.filter((m) => m.index > subAt);
  const pool = afterSub.length ? afterSub : notSub;
  const totalMatch =
    pool.find((m) => /^(?:grand\s+)?total\s+(?:including|incl\.?|inc\.?)\s/i.test(m[0]) || /^grand\s/i.test(m[0])) || pool[0] || totals[0] ||
    text.match(/\bamount\s+paid\s*(?:[:|]\s*){0,3}£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i) ||
    // A supermarket's order before it is picked gives a guide price, not a total ("Guide price | £27.69"). Round 8.
    text.match(/^[\s|]*(?:estimated |order )?guide price\s*(?:[:|]\s*){0,3}£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/im) ||
    // No total named: the last line that is only an amount "(Including VAT)" ("£33.76 (Including VAT)" under the delivery charge).
    [...text.matchAll(/^[\s|]*£\s*([0-9][0-9,]*\.[0-9]{2})\s*\((?:including|incl\.?|inc\.?)\s+vat\)[\s|]*$/gim)].pop() ||
    // A total written as a sentence: "Your order of 3 items comes to £120.00 including delivery" (round 4).
    text.match(/\b(?:your\s+)?(?:order|basket|total)\b[^.\n£]{0,40}\bcomes?\s+to\s+(?:a\s+total\s+of\s+)?£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i) ||
    // No total named, but what the card was charged after the subtotal and VAT ("Mastercard •••• 1234 (Apple Pay) | £10.99",
    // Apple's renewal receipts). Round 10.
    (/\bsub-?\s?total\b/i.test(text) && text.match(/^[\s|]*(?:visa|mastercard|master card|amex|american express|maestro|debit card|credit card|apple pay|google pay|paypal)\b[^\n£]{0,50}?(?:•{2,}|\*{2,}|x{3,}|ending(?: in)?)\s*\d{4}\b[^\n£]{0,30}?[\s|]*\n?[\s|]*£\s*([0-9][0-9,]*\.[0-9]{2})[\s|]*$/im)) ||
    // No total named, but the amount taken beside the card it was taken from ("MasterCard •••• 4242 (Apple Pay) | £10.99",
    // Apple's subscription invoices). Coverage round.
    text.match(/^[\s|]*(?:visa|mastercard|master card|amex|american express|maestro)\s*(?:[•·*.]\s?){2,}\s*\d{4}\b[^\n£]{0,30}(?:\n[\s|]*)?£\s*([0-9][0-9,]*\.[0-9]{2})[\s|]*$/im);

  // Line items: "Name ... Qty 1 ... £29.99" on one line or table row.
  const items = [];
  for (const line of text.split("\n")) {
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
        items.push({ name: head[2].trim(), qty: Number(head[1]), pricePence: money(price[1]), lineTotal: true });
      }
    }
  }
  if (!items.length) {
    const rows = text.split("\n").map((x) => x.replace(/^[\s|]+|[\s|]+$/g, "")).filter(Boolean);
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
    const rows = text.split("\n").map((x) => x.replace(/^[\s|]+|[\s|]+$/g, "")).filter(Boolean);
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
  const foreign = totalMatch ? null : foreignTotal(text);

  return {
    method: "text",
    subtotalPence: sub ? money(sub[1]) : null,
    retailerName: null,
    orderRef: ref ? ref[1] : null,
    orderDate: parseDate(text, refDate),
    currency: /£|GBP/.test(text) ? "GBP" : foreign ? foreign.currency : null,
    totalPence: totalMatch ? afterDiscount(text, totalMatch) ?? money(totalMatch[1]) : foreign ? foreign.minor : null,
    items,
  };
}


// ---- Return information ------------------------------------------------------
// Pulled from the same email. Everything stays null/empty when not found, and a
// deadline is only worked out when the email makes it unambiguous.
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

function isoDate(d) { return d.toISOString().slice(0, 10); }

function extractReturns(text, html, orderDate) {
  const out = {
    windowDays: null, windowFrom: null, deadline: null, address: null,
    portalUrl: null, instructions: [], qrMentioned: false, labelMentioned: false,
  };
  const flat = text.replace(/[ \t]+/g, " ");

  // Window: "within 28 days of delivery", "30-day returns", "return ... within 14 days".
  const sentences = flat.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  for (const sent of sentences) {
    if (!/return|refund|exchange/i.test(sent) || sent.length > 400) continue;
    let m = sent.match(/within\s+(\d{1,3})\s+(?:calendar\s+|working\s+)?days?(?:\s+(?:of|from|after)\s+(?:the\s+)?(delivery|receiv\w*|dispatch\w*|purchase|order\w*|today))?/i) ||
      sent.match(/(\d{1,3})[-\s]days?\s+(?:free\s+)?returns?/i);
    if (m) {
      out.windowDays = Number(m[1]);
      const basis = (m[2] || "").toLowerCase();
      out.windowFrom = /^(delivery|receiv|dispatch)/.test(basis) ? "delivery" : /^(purchase|order|today)/.test(basis) ? "order" : null;
      break;
    }
  }
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
    const joined = block.join(", ").replace(/\s*\|\s*/g, " ").replace(/,\s*,/g, ",");
    if (UK_POSTCODE.test(joined)) { out.address = joined.slice(0, 250); break; }
  }

  // Link to start a return: only https links whose text or address mentions returns.
  if (html) {
    for (const a of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = a[1].replace(/&amp;/g, "&").trim();
      const label = a[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!/^https:\/\//i.test(href) || href.length > 800) continue;
      if (/unsubscribe|privacy|terms/i.test(href + " " + label)) continue;
      if (/return|refund|exchange/i.test(label) || /\/returns?\b|returns?[-_.]|[?&]return/i.test(href)) { out.portalUrl = href; break; }
    }
  }

  // How-to wording straight from the email (max three short sentences).
  const seen = new Set();
  for (const sent of sentences) {
    if (out.instructions.length >= 3) break;
    if (sent.length < 25 || sent.length > 220 || !/\breturn/i.test(sent)) continue;
    if (/unsubscribe|view (this )?(email|in browser)/i.test(sent)) continue;
    const key = sent.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.instructions.push(sent); }
  }

  out.qrMentioned = /\bqr\b|\bqr[- ]code/i.test(flat) || /<img[^>]+(?:alt|src)=["'][^"']*qr/i.test(html || "");
  out.labelMentioned = /(prepaid|printable|return)\s+label|drop[- ]?off|drop (?:it )?off|collect\+|evri|royal mail|inpost|dpd|ups access point/i.test(flat);
  const any = out.windowDays || out.deadline || out.address || out.portalUrl || out.instructions.length || out.qrMentioned || out.labelMentioned;
  return any ? out : null;
}

// An email that is not an order confirmation must not be turned into a purchase.
// Some of an order's items sent ("2 of your 3 items have shipped", "Part of your order HF-1 has been dispatched"): the items
// in it are the order's, so it is read like its receipt and joins the order's card by its order number (gmail.js
// mergeOrderEmails). Without an order number it would be a second card for the same order, so it is then not read at all.
const SHIPMENT_SUBJECT = /\b\d{1,3} of (?:your )?\d{1,3} items?\b[^!?]{0,30}\b(?:have |has )?(?:shipped|dispatched|been sent|on (?:their|its) way)\b|\b(?:part|some) of your order\b[^!?]{0,40}\b(?:shipped|dispatched|sent|on its way)\b|\bsome of your items\b[^!?]{0,30}\b(?:shipped|dispatched|on (?:their|its) way)\b/i;
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
  const subjectHit = /(order|receipt|purchase|thank you for your|payment)\b.*(confirm|receipt|received|thank)|confirmation|your receipt|order #|order no|\bthanks?\b.*\b(order|purchase)\b|\byour\b[^!?]{0,40}\b(?:order|e-?receipt|receipt)\s*$/.test(s) ||
    // "Your Friday evening trip with Uber", "Your Deliveroo order from Wagamama", "We're processing your order W123",
    // "Your Etsy Purchase from …", "Your purchase with lululemon", "Receipt for your payment to …", "Your LNER tickets for …".
    /\byour\b[^!?]{0,30}\b(?:trip|ride|order)\b[^!?]{0,20}\bwith\b|\byour\b[^!?]{0,30}\border from\b|\bprocessing your order\b|\byour\b[^!?]{0,30}\bpurchase (?:from|with|at)\b|\breceipt for your payment\b|\byour\b[^!?]{0,20}\btickets? for\b/.test(s) ||
    // "Your Sainsbury's order summary" (round 8).
    /\byour\b[^!?]{0,40}\border summary\b/.test(s) ||
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
    /\bthank(?:s| you) for (?:buying|purchasing)\b|\bthank(?:s| you) for joining\b[^!?]{0,60}\b(?:membership|subscription)\b|\breceived your payment\b[^!?]{0,40}\byour order\b|\bpurchase\s+(?:is|was|has been)\s+(?:complete|completed|successful)\b/.test(s);
  // (A total in euros counts as a total: the receipt is kept with its amount in euros, never turned into pounds.)
  // ("Amount paid | £20.62" with no word "total" counts too: coverage round.)
  const bodyHit = /\border\s*(number|no|id|ref|#)|\btotal\b[ \t|:]{0,40}[£€]|\btotal\b(?:\s*\([^)\n]{1,40}\))?[\s\S]{0,12}[£€]|[£€].*\btotal\b|\bamount\s+paid\b[\s|:]{0,20}[£€]/i.test(text);
  return { subjectHit, bodyHit };
}
function looksLikeReceipt(subject, text) {
  const { subjectHit, bodyHit } = receiptSignals(subject, text);
  return subjectHit && bodyHit;
}

// Marketing and loyalty emails that merely look like receipts ("You've saved £4 with Nectar", "20% off", "rate your order").
// Promotions have their own place in Relay, so these are not receipts. An email that carries an order number is never treated as a promotion.
const PROMO_SUBJECT = /\b(you(?:'|’)?ve saved|you saved|\d{1,3}\s?% off|up to \d{1,3}\s?%|sale\b|offers?\b|deals?\b|win\b|rewards?|earn(?:ed)? (?:\d+ )?points|your points|nectar|clubcard|new in\b|back in stock|just for you|don'?t miss|last chance|exclusive|voucher|refer a friend|rate your|how did we do|leave a review|review your|survey|newsletter|wishlist|abandoned|still thinking)\b/i;
const ORDERISH_SUBJECT = /\b(order (?:confirmation|confirmed|received|number|summary)|your order|your receipt|receipt for|thanks? for your (?:order|purchase)|invoice|payment received)\b/i;
// Money off the next order ("Up to £7 off your next order", "Save £5 on your first shop").
const MONEY_OFF_SUBJECT = /(?:^|[\s(])(?:up to |save |get )?£\s?\d{1,4}(?:\.\d{2})?\s+off\b|\boff your (?:next|first)\b|(?:^|\s)save £\s?\d/i;
// A code or credit to spend next time is an offer even when it names the order that earned it
// ("Here's your promotional credit from your recent order").
const PROMO_CREDIT_SUBJECT = /\b(?:promo(?:tional)?|discount) (?:code|credit)s?\b|\bhere(?:'|’)?s your (?:promo|promotional|discount|voucher|reward)\b|\b\d[\d,]*\s+bonus\s+(?:avios|points|miles)\b/i;
export function looksPromotional(subject, headers, hasOrderRef) {
  const sub = String(subject || "");
  if (ORDERISH_SUBJECT.test(sub)) return false;
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
const MONEY_LABEL = /^(?:(?:invoice|order|grand|basket|bag|payment|final|overall)\s+total|total\s+(?:paid|due|amount|to pay|charged)|amount\s+(?:due|paid|payable|charged)|balance\s+(?:due|paid))\s*:?$/i;
const PRICE_WORDS = /^(you\s+saved?|you\s+save|saved?|savings?|was|now|rrp|price|item\s+price|unit\s+price|special\s+price|sale\s+price|discount|reduced|deposit|balance|amount|paid)\b[\s:.!]*$/i;
// Amazon's order emails put each thing bought in its own little boxes, so the usual line reading finds nothing. Two layouts:
//  * things to be delivered: the item's name (Amazon cuts long ones short with "..."), "Sold by …", maybe "Colour: …" and
//    "Size: …", "Condition: New", "Quantity: 2", then the price split into "£", "4" and "99" (pounds big, pence small);
//  * digital (Prime Video, Kindle, music): the title, "Sold by:" (or "Sold by :"), the seller, then "£3.49".
// Read from the HTML split at every tag, so each little box is its own line. Nothing is guessed: a price is kept only when
// Amazon printed one next to the item.
const AMZ_SKIP = /^(sold by\s*:?|condition:|quantity:|colou?r:|size:|style:|pattern:|edition:|format:|view or edit order|order #|placed on|order details|ordered|dispatched|out for delivery|delivered|£|total|item subtotal|\|)/i;
export function amazonItems(html) {
  const decode = (t) => t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&pound;/g, "£")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)));
  const rows = String(html || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").split(/<[^>]+>/)
    .map((t) => decode(t).replace(/[\u034f\u200b-\u200f\u00ad\u2060\ufeff\u202a-\u202e]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const priceAt = (i) => {   // "£" "4" "99", or "£4.99", starting at row i
    const one = /^£\s?(\d{1,5}(?:,\d{3})*)\.(\d{2})$/.exec(rows[i] || "");
    if (one) return Number(one[1].replace(/,/g, "")) * 100 + Number(one[2]);
    if (rows[i] === "£" && /^\d{1,5}$/.test(rows[i + 1] || "") && /^\d{2}$/.test(rows[i + 2] || "")) return Number(rows[i + 1]) * 100 + Number(rows[i + 2]);
    return null;
  };
  const tidy = (n) => n.replace(/\s*(\.\.\.|…)$/, "").trim();
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const q = /^Quantity:\s*(\d{1,3})$/i.exec(rows[i]);
    if (q) {
      let name = null; const bits = [];
      for (let j = i - 1; j >= Math.max(0, i - 7); j--) {
        const b = /^(colou?r|size|style):\s*(.{1,40})$/i.exec(rows[j]);
        if (b) { bits.unshift(b[2]); continue; }
        if (AMZ_SKIP.test(rows[j]) || /^amazon(\.co\.uk)?$/i.test(rows[j]) || /^Sold by\s*:?$/i.test(rows[j - 1] || "")) continue;   // the seller, under "Sold by:"
        if (rows[j].length >= 3 && rows[j].length <= 220 && !/^£|^\d+$/.test(rows[j])) { name = rows[j]; break; }
      }
      if (!name) continue;
      let price = null;
      for (let k = i + 1; k <= i + 3 && price == null; k++) price = priceAt(k);
      items.push({ name: tidy(name), ...(bits.length ? { variant: bits.join(", ") } : {}), qty: Number(q[1]), pricePence: price });
      continue;
    }
    if (/^Sold by\s*:?$/i.test(rows[i]) && !rows.slice(i + 1, i + 8).some((t) => /^Quantity:/i.test(t))) {   // digital: title, "Sold by:", seller, price
      const name = rows[i - 1];
      if (!name || AMZ_SKIP.test(name) || name.length > 220) continue;
      let price = null;
      for (let k = i + 1; k <= i + 3 && price == null; k++) price = priceAt(k);
      items.push({ name: tidy(name), qty: 1, pricePence: price });
    }
  }
  return items;
}

export function appleItems(text) {
  const rows = String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|[\s|]+$/g, "")).filter(Boolean);
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    if (/^(subtotal|total|vat|tax)\b|\b(inclusive of|includes|incl\.?) vat\b/i.test(rows[i])) break;
    const pm = rows[i].match(/^£\s*([0-9][0-9,]*\.[0-9]{2})$/);
    if (!pm) continue;
    const found = [];
    for (let j = i - 1; j >= 0 && j >= i - 6 && found.length < 2; j--) {
      const r = rows[j];
      if (/^£/.test(r) || APPLE_LABEL.test(r)) break;
      // (Apple's own service over its plan, "Apple Music" over "Individual (Monthly)": the service is what was bought. A store's
      // heading, "App Store" over a game, is not. Round 10.)
      if (APPLE_SECTION.test(r)) { if (!found.length || (found.length === 1 && /^(apple arcade|apple tv|apple music|apple one|icloud)$/i.test(r))) found.push(r); break; }
      if (APPLE_NOISE.test(r) || r.length > 90) continue;
      found.push(r);
    }
    if (!found.length) continue;
    const [app, what] = found.length === 2 ? [found[1], found[0]] : [found[0], null];
    items.push({ name: app, ...(what && what.toLowerCase() !== app.toLowerCase() ? { variant: what } : {}), qty: 1, pricePence: money(pm[1]) });
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
    // (Not the forward's own header lines: its "Subject:" would count the subject twice.)
    bodyNames: shopNamesInText(asSent ? text.replace(/^[ \t>*]*(?:from|subject|date|to|sent|cc)[ \t*]*:.*$/gim, "") : text, subject),
    // A payment platform's own receipt names the business that was paid ("Merchant: Example Lettings").
    merchantName: sentDomain && isVia(sentDomain) ? ((text.match(/^[\s#*|]*merchant(?: name)?\s*[:|]\s*\**\s*([^\n|*]{2,40}?)\s*\**\s*\|?\s*$/im) || [])[1] || null) : null,
    linkDomain: mainLinkDomain(html),
    // (The game's name is a heading in the HTML; a plain-text part may not carry it at all.)
    titleName: GAME_SHOP.test(sentDomain || "") ? (html && gameTitle(htmlToText(html))) || gameTitle(text) : null,
  });
  // Uber sends rides and Uber Eats orders from the same address and name: a food order is Uber Eats.
  if (/(^|\.)uber\.com$/i.test(sentDomain || "") && /^uber$/i.test(ranked.name || "") && (/\buber eats\b/i.test(subject) || (/\border\b/i.test(subject) && /\buber eats\b/i.test(text.slice(0, 4000))))) ranked.name = "Uber Eats";
  // "Tesco.com" as the sender's name, when the email calls the shop "Tesco" again and again (its own products, "Tesco Whole
  // Milk"): the shop is Tesco. (A brand whose name is its address, "Booking.com", writes it that way throughout.) Round 8.
  const dotCom = /^(\p{Lu}[\p{Ll}\d-]{2,30})\.com$/u.exec(ranked.name || "");
  if (dotCom && (String(text).match(new RegExp("\\b" + dotCom[1] + "\\b(?!\\.com)", "g")) || []).length >= 2) ranked.name = dotCom[1];
  // "Costa Coffee" from costa.co.uk, "Domino's Pizza" from dominos.co.uk, "Waitrose & Partners" from waitrose.com: the shop is
  // the name its address gives, so the same shop is one shop in Relay whichever of its emails named it. Round 8.
  const brand = /^(.+?)\s+(?:&\s*partners|coffee|pizza|pizzas|restaurants?|uk|group|stores?|foods?|burgers?|grill|express|online)$/i.exec(ranked.name || "");
  if (brand && sentDomain && brand[1].toLowerCase().replace(/[^a-z0-9]/g, "") === domainBase(sentDomain).replace(/-/g, "")) ranked.name = brand[1];
  // A receipt forwarded from a personal mailbox keeps that mailbox's address when the original shop isn't found.
  const out = { name: ranked.name || null, domain: ranked.domain || (personal ? domain : null) };
  if (ranked.via) out.via = ranked.via;
  if (!out.name && !out.domain && domain) out.domain = domain;
  return out;
}

// "Your booking confirmation for London to Orpington (27 September at 12:54)", "... for return trip London to Nottingham (20 August ...".
const JOURNEY = /\b(?:booking|reservation|tickets?|trip|journey)\b[^()\n]*?\bfor (return trip )?(?:from )?(\p{Lu}[\p{L} .'’&-]{1,40}?) to (\p{Lu}[\p{L} .'’&-]{1,40}?)(?=\s*\(|\s*[-–,]|\s*$)/u;
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
const ACCOUNT_DEPOSIT =/\bthank you for (?:making|your) (?:a )?deposit\b|\bdeposit of [^\n.]{1,30}? has (?:now )?been (?:credited|added) to your (?:account|balance|wallet)\b/i;
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
function tillPounds(t) {
  // ("GBP 15.00" and "15.00 GBP", written that way throughout an email with no pound sign: pounds.)
  if (t && !/£/.test(t) && /\bGBP\s?\d[\d,]*\.\d{2}\b/.test(t)) return t.replace(/\bGBP\s?(\d[\d,]*\.\d{2})\b/g, "£$1").replace(/\b(\d[\d,]*\.\d{2})\s?GBP\b/g, "£$1");
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
const RECOMMEND_HEAD = /^[\s|]*(?:you (?:might|may) also (?:like|love)|customers (?:also|who bought this also) (?:bought|viewed|liked)|(?:people|others) also bought|frequently bought together|recommended (?:for you|products|items)|we (?:think|thought) you(?:'|’)?(?:ll| will| would|d) (?:like|love)|complete the look|shop the look|more (?:you(?:'|’)ll love|to explore|like this)|inspired by your (?:order|purchase|browsing)|trending now|you might be interested in|picked for you|just for you)\b[^\n]{0,40}$/i;
const RECOMMEND_END = /^[\s|]*(?:sub-?\s?total|(?:order |grand )?total|delivery|shipping|postage|your order|order (?:summary|details)|items? (?:in your order|ordered)|payment|billing|vat)\b/i;
function withoutRecommendations(t) {
  const lines = String(t || "").split("\n");
  if (!lines.some((l) => RECOMMEND_HEAD.test(l))) return t;
  const out = [];
  for (let i = 0, skip = false; i < lines.length; i++) {
    if (RECOMMEND_HEAD.test(lines[i])) { skip = true; continue; }
    if (skip && RECOMMEND_END.test(lines[i])) skip = false;
    if (!skip) out.push(lines[i]);
  }
  return out.join("\n");
}

export function parseReceiptEmail(rawEmail, opts = {}) {
  const raw = String(rawEmail || "").slice(0, MAX_RAW);
  const { headers, body } = splitMessage(raw);
  const parts = { text: [], html: [], attached: [], attachedText: [] };
  collectParts(headers, body, parts);
  if (!parts.text.length && !parts.html.length && parts.attachedText.length) parts.text.push(...parts.attachedText);
  const html = parts.html.join("\n").slice(0, MAX_INPUT);
  const plain = tillPounds(unquoted(fullWidthPounds(plainAsWritten(parts.text.join("\n").trim()))));
  const fromHtml = html ? tillPounds(unquoted(fullWidthPounds(htmlToText(html)))) : "";
  const sender = retailerFromFrom(headers.from);
  const subject = headers.subject || null;
  // The sender's display name exactly as written (retailerFromFrom drops generic ones such as "Orders").
  const fromName = ((headers.from || "").match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || null;
  // (A text part that only says to look at the HTML one, "This email needs an HTML-capable email client", is not the
  // email: the HTML is read when only it looks like a receipt. Round 4.)
  let text = (plain && !(fromHtml && !receiptSignals(subject, plain).bodyHit && receiptSignals(subject, fromHtml).bodyHit) ? plain : fromHtml || plain).trim();

  const sig = receiptSignals(subject, text);
  // A receipt that is only in its attachment ("Your receipt is attached", a PDF or a photo of the till receipt): it is
  // still the shop's receipt, read for what the email itself says (the shop, the day, a total if written), and it says
  // that the details are in the attachment. Nothing is read from the attachment, so nothing is made up.
  const attachedDoc = (parts.attached || []).find((a) => a.kind === "pdf" || a.kind === "image");
  const saysAttached = Boolean(attachedDoc) && /\b(?:receipt|invoice|order|bill)\b[^.\n]{0,60}\b(?:is |are )?attached\b|\battached\b[^.\n]{0,40}\b(?:receipt|invoice)\b|\b(?:receipt|invoice)\b[^.\n]{0,30}\bas an? (?:pdf|attachment)\b/i.test(text.slice(0, 4000));
  if (saysAttached) sig.bodyHit = true;
  // A flight booked with an airline or a travel site (flight-booking.js): its confirmation is the receipt even when it
  // doesn't say "order" ("Your booking is confirmed", "Ryanair Travel Itinerary", "Total paid GBP 245.98"). A check-in
  // reminder, a boarding pass or a delay notice about it is not a purchase.
  const flightArgs = { subject, senderDomain: sender?.domain || null, fromName, refDate: headers.date ? new Date(headers.date) : null };
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
  if (uber) { sig.subjectHit = true; sig.bodyHit = sig.bodyHit || /\btotal\b/i.test(text); }
  // A supermarket's delivery-day email for an order already confirmed ("Your order is ready for today", "Payment received").
  const dayOf = groceryDayOf(text);
  if (dayOf) { sig.subjectHit = true; sig.bodyHit = true; }
  // When the shopper picked this very email themselves, one signal is enough (the fields are still checked below).
  if (!isFlight && !(opts.lenient ? sig.subjectHit || sig.bodyHit : sig.subjectHit && sig.bodyHit)) {
    return { ok: false, reason: "not_an_order_confirmation", source: "shopper_email", signals: { subject: sig.subjectHit, body: sig.bodyHit, textLength: text.length } };
  }

  // A refund, a cancellation or a price adjustment is never a new purchase (a refund is read by parseReturnUpdateEmail, and
  // attaches to the order it belongs to). Said in the subject, or at the top of the email ("Your order has been cancelled").
  if (NOT_A_PURCHASE_SUBJECT.test(String(subject || "").replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, "")) || NOT_A_PURCHASE_TOP.test(text.slice(0, 1200).replace(/\s+/g, " "))) {
    return { ok: false, reason: "refund_or_cancellation", source: "shopper_email" };
  }
  // A shop owning up that an earlier "order confirmation" was a marketing email ("There was no order. Nothing has been
  // charged"): nothing was bought (round 10).
  if (NO_ORDER.test(String(subject || "") + "\n" + text.slice(0, 3000).replace(/\s+/g, " "))) return { ok: false, reason: "no_order", source: "shopper_email" };
  // A notice that the payment didn't go through is not a receipt ("we couldn't charge your account for your order").
  if (PAYMENT_PROBLEM.test(subject || "") || PAYMENT_PROBLEM.test(text.slice(0, 1500))) {
    return { ok: false, reason: "payment_problem", source: "shopper_email" };
  }
  // Money paid into an account to spend later (a deposit credited to a balance) is not a purchase.
  if (ACCOUNT_DEPOSIT.test(text.slice(0, 3000))) return { ok: false, reason: "account_deposit", source: "shopper_email" };
  const ld = html ? fromJsonLd(html) : null;
  const refDate = headers.date ? new Date(headers.date) : null;
  let txt = fromText(text, refDate);
  // Many senders include a skimpy plain-text part next to the full HTML one: use whichever reads richer.
  if (plain && fromHtml) {
    const alt = fromText(fromHtml, refDate);
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
  // Price wording ("Was £2,200", "You saved £330") sits on its own line in some shops' emails: it is never an item.
  result.items = cleanItems(result.items.filter((i) => !PRICE_WORDS.test(String(i.name || "").trim()) && !MONEY_LABEL.test(String(i.name || "").trim())));
  if (!result.items.length && /(^|\.)amazon\.(co\.uk|com)$/i.test(sender?.domain || result.retailer.domain || "") && html) result.items = amazonItems(html);
  if (!result.items.length && /(^|\.)apple\.com$/i.test(result.retailer.domain || "")) result.items = appleItems(text).length ? appleItems(text) : fromHtml ? appleItems(fromHtml) : [];
  // Game currency bought through a game's web shop ("2,200 Coins"): one item, the whole order.
  const gameShop = GAME_SHOP.test((fwdFrom && fwdFrom.domain) || sender?.domain || "");
  // (A pack of several things, "Mixy Meow | 1", "Checkerboard | 10", is one purchase named by all of them. Round 10.)
  const bundle = gameShop ? gameBundle(fromHtml) || gameBundle(text) : null;
  if (bundle) result.items = [{ name: bundle, qty: 1, pricePence: result.totalPence ?? null }];
  if (!result.items.length && gameShop) result.items = (gameItems(fromHtml).length ? gameItems(fromHtml) : gameItems(text)).map((i) => ({ ...i, pricePence: result.totalPence ?? null }));
  // An Uber ride is travel: one ride, for what was paid (its fare, fees and credits are not things). An Uber Eats receipt that
  // only links to the full one lists nothing: no items are made up, and the check says the email has no item list. Round 10.
  const ride = Boolean(uber && uber.kind === "ride");
  const noList = Boolean(uber && uber.kind === "eats" && uber.noItemList);
  if (ride) { result.retailer = { ...result.retailer, name: "Uber" }; result.items = [{ name: uber.item, qty: 1, pricePence: result.totalPence ?? null }]; }
  if (uber && uber.kind === "eats") result.retailer = { ...result.retailer, name: "Uber Eats" };
  if (noList) result.items = [];
  // The delivery-day email of a supermarket order: what was paid, for the order it names. Its few listed lines (substitutions,
  // short-life items) are not the order's items, which are on the confirmation and in the attached receipt.
  if (dayOf) { result.items = []; result.orderUpdate = "paid"; if (dayOf.orderRef) result.orderRef = dayOf.orderRef; result.totalPence = dayOf.paidPence; result.currency = "GBP"; }
  // A company's legal name as the sender ("Anthropic Ireland, Limited"): the shop is the brand, not the country it bills
  // from ("Anthropic"). Round 10.
  // (Forwarded, the original sender's name says it.)
  const legalName = (fwdFrom && fwdFrom.name) || fromName;
  if (legalName && /,?\s+(?:limited|ltd\.?|plc|inc\.?|llc|pbc|gmbh)\s*$/i.test(legalName) && result.retailer.name) {
    const m = /^(.+?)\s+(?:ireland|uk|europe|emea|international)$/i.exec(result.retailer.name);
    if (m && !/\b(?:of|de|bank)$/i.test(m[1]) && legalName.toLowerCase().startsWith(m[1].toLowerCase())) result.retailer = { ...result.retailer, name: m[1] };
  }
  // The restaurant a takeaway app's order came from ("Your East Ocean order will be with you soon"), beside the app's name.
  const merchant = (uber && uber.kind === "eats" && uber.merchant) || takeawayMerchant(result.retailer.name, sender?.domain, subject, text);
  if (merchant) result.merchant = merchant;
  // Flights: each one (from, to, day, flight number, out or back), the booking reference, and what was paid. The flights
  // are what was bought, so they are the one item (a fare's lines, "Adult 1", "Hold bag", aren't things).
  if (isFlight) {
    result.flights = flight.legs;
    if (!result.orderRef && flight.ref) result.orderRef = flight.ref;
    if (result.totalPence == null && flight.paid) { result.totalPence = flight.paid.pence; result.currency = flight.paid.currency; }
    result.items = [{ name: flightItemName(flight.legs), qty: 1, pricePence: result.totalPence ?? null }];
  }
  // A travel booking names the journey in its subject: the journey is what was bought (its fare lines, "Anytime Day Return",
  // "1 Adult", are not things).
  const journey = !isFlight && !gameShop ? JOURNEY.exec(subject || "") : null;
  if (journey) result.items = [{ name: `${journey[2].trim()} to ${journey[3].trim()}${journey[1] ? " (return)" : ""}`, qty: 1, pricePence: result.totalPence ?? null }];
  // Every way of reading the items is tried on both parts of the email, and the totals check picks: the first reading whose
  // items add up to what the email says they came to, else the one that comes closest. What was picked carries its check.
  const otherPart = text === fromHtml ? plain : fromHtml;
  if (noList || dayOf) {
    result.itemsCheck = { complete: false, itemsPence: 0, expectedPence: dayOf ? null : result.totalPence ?? null, missingPence: null, ...(noList ? { noItemList: true } : { orderUpdate: true }) };
  } else if (!isFlight && !journey && !gameShop && !ride) {
    const cands = [];
    const readable = (list) => cleanItems(list.filter((i) => !PRICE_WORDS.test(String(i.name || "").trim()) && !MONEY_LABEL.test(String(i.name || "").trim())));
    // (Products the shop recommends, "You might also like", "Customers also bought", are not what was bought: those sections
    // are left out of the item readings. Round 4.)
    const [textR, otherR] = [withoutRecommendations(text), otherPart ? withoutRecommendations(otherPart) : otherPart];
    // (Apple's own reading comes first for an App Store or subscription receipt: it names the app or service, "Apple Music",
    // where the plain reading takes the plan under it, "Individual (Monthly)". Round 10.)
    const isApple = /(^|\.)apple\.com$/i.test(result.retailer.domain || "") && /\b(?:app store|in-app purchase|renews \d|apple account:?)/i.test(text);
    if (isApple) for (const t of [text, otherPart]) if (t) cands.push({ items: appleItems(t), money: moneyOf(t) });
    for (const t of [textR, otherR]) if (t) cands.push({ items: readable(readItems(t)), money: moneyOf(t) });
    for (const t of [textR, otherR]) if (t) cands.push({ items: readable(readItems(t, { extraPrices: true })), money: moneyOf(t) });
    for (const t of [textR, otherR]) if (t) cands.push({ items: readable(readItems(t, { laterPrice: true })), money: moneyOf(t) });
    cands.push({ items: result.items, money: moneyOf(text) });
    if (html && /(^|\.)amazon\.(co\.uk|com)$/i.test(sender?.domain || result.retailer.domain || "")) cands.push({ items: amazonItems(html), money: moneyOf(fromHtml || text) });
    if (/(^|\.)apple\.com$/i.test(result.retailer.domain || "")) for (const t of [text, otherPart]) if (t) cands.push({ items: appleItems(t), money: moneyOf(t) });
    // Prices printed above their names (round 3): tried after every other reading, so it is taken only when nothing else adds up.
    for (const t of [textR, otherR]) if (t) cands.push({ items: readable(readItems(t, { priceAbove: true })), money: moneyOf(t) });
    // "Read it again" (receipt-reread.js) also tries the older readers on both parts.
    if (opts.wide) for (const t of [text, otherPart]) if (t) cands.push({ items: cleanItems(itemsFromCells(t)), money: moneyOf(t) }, { items: cleanItems(fromText(t, refDate).items), money: moneyOf(t) });
    const settled = cands.map((c) => ({ ...settleItems(c.items, c.money, result.totalPence), money: c.money }));
    const gap = (c) => (c.check.missingPence == null ? Infinity : Math.abs(c.check.missingPence));
    // (Of the readings that add up, one whose names all look like things bought comes first: a note or a size read as the
    // name still adds up. Round 9.)
    const shopName = (result.retailer && result.retailer.name) || "";
    const pick = settled.find((c) => c.items.length && c.check.complete && namesCheck(c.items, { shop: shopName }).namesOk) ||
      settled.find((c) => c.items.length && c.check.complete) ||
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
    result.itemsCheck = checkItems(result.items, moneyOf(text), result.totalPence);
  }
  // A row named only by its place in a table ("SIM 1 | ORDA… | eSIM | -- | National Plus | National | £5.00", Lycamobile):
  // the thing bought is the row's name-like cell, the plan, not "SIM 1". Round 10.
  for (const i of result.items) {
    if (!/^(?:sim|line|item|row|s\.?\s?no\.?)\s*\d{1,2}$/i.test(String(i.name || "")) || !i.variant) continue;
    const named = String(i.variant).split(", ").find((p) => /\p{Ll}/u.test(p) && (p.match(/\p{L}/gu) || []).length >= 5 && !/^e-?sim$|^(?:national|international|monthly|weekly|prepaid|pay as you go)$/i.test(p) && !/\d{6,}/.test(p));
    if (named) { const rest = String(i.variant).split(", ").filter((p) => p !== named && !/^[A-Z0-9]{10,}$/.test(p)); i.name = named; if (rest.length) i.variant = rest.join(", "); else delete i.variant; }
  }
  // No total written, one thing bought, and its price the only amount anywhere in the email: that is what was paid.
  if (result.totalPence == null && result.items.length === 1 && Number.isInteger(result.items[0].pricePence) && (result.items[0].qty || 1) === 1) {
    const amounts = [...new Set([...text.matchAll(/£\s?(\d[\d,]*\.\d{2})/g)].map((m) => money(m[1])))];
    if (amounts.length === 1 && amounts[0] === result.items[0].pricePence) { result.totalPence = amounts[0]; result.currency = "GBP"; result.totalFrom = "only_amount"; result.itemsCheck = { ...(result.itemsCheck || {}), complete: true, itemsPence: amounts[0], expectedPence: amounts[0], missingPence: 0 }; }
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
  // Gmail cut the email short ("[Message clipped]  View entire message"): what came after the cut isn't in it, so the items
  // can never be called complete, even when what is there adds up.
  if (CLIPPED.test(text) || (otherPart && CLIPPED.test(otherPart))) result.itemsCheck = { ...(result.itemsCheck || {}), complete: false, clipped: true };
  if (saysAttached && !result.items.length) { result.detailsInAttachment = attachedDoc.kind; result.itemsCheck = { ...(result.itemsCheck || {}), complete: false, inAttachment: attachedDoc.kind }; }
  for (const i of result.items) delete i.unitPence;
  // The name check (item-names.js, round 9): money that adds up says nothing about the names. A name that looks like a note,
  // a label, a size or a code makes namesOk false (with suspectNames), and the app says some names may not be right.
  if (result.items.length && result.itemsCheck) result.itemsCheck = { ...result.itemsCheck, ...namesCheck(result.items, { shop: (result.retailer && result.retailer.name) || "" }) };
  if (!opts.lenient && !isFlight && looksPromotional(subject, headers, Boolean(result.orderRef))) {
    return { ok: false, reason: "promotional", source: "shopper_email" };
  }
  if (SHIPMENT_SUBJECT.test(String(subject || "")) && !result.orderRef) return { ok: false, reason: "shipment_without_order_number", source: "shopper_email" };
  // A notice about an order placed earlier, with no total of its own, is not a purchase. (One that does give the order's
  // total is kept: it can be the only record of that order.)
  if (!opts.lenient && result.totalPence == null && ORDER_NOTICE_SUBJECT.test(subject || "")) {
    return { ok: false, reason: "order_notice", source: "shopper_email" };
  }
  if (opts.lenient && !result.orderRef && result.totalPence == null && !result.items.length) {
    return { ok: false, reason: "not_an_order_confirmation", source: "shopper_email", signals: { subject: sig.subjectHit, body: sig.bodyHit, textLength: text.length, nothingFound: true } };
  }
  result.returns = extractReturns(text, html, result.orderDate);
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
  if (!result.orderDate && refDate && !Number.isNaN(refDate.getTime())) { result.orderDate = isoDate(refDate); result.orderDateFrom = "email"; }
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
  const m = text.match(/\btracking\s*(?:number|no\.?|#|id|code)?\s*[:#]\s*([A-Z0-9]{8,30})\b/i) || text.match(/\btracking\s+(?:number|no\.?|id|code)\s+(?:is\s+)?([A-Z0-9]{8,30})\b/i);
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
  const text = ((parts.text.join("\n").trim()) || (html ? htmlToText(html) : "")).trim();
  const subject = headers.subject || "";
  const from = String(headers.from || "");
  const fromCarrier = (CARRIER_SENDERS.find(([, re]) => re.test(from)) || [])[0] || null;
  const both = subject + "\n" + text.slice(0, 4000);
  let status = null;
  // "Due to be delivered today" is checked first so it is never read as "delivered today".
  if (/\bdue to be delivered\b|\barriving today\b|\bexpected (?:today|on)\b/i.test(subject)) status = "due";
  else if (/\b(has been|was|been|we(?:'|’)?ve)\s+delivered\b|\bwe delivered\b/i.test(both)) status = "delivered";
  // "Delivered: 1 item | Order # …", or a heading that just says "Delivered today".
  else if (/^\s*delivered\s*:/i.test(subject) || /^[\s|]*delivered today[.!]?[\s|]*$/im.test(text.slice(0, 4000))) status = "delivered";
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
  const hasReturn = (t) => /\breturn id\b/i.test(t) || /(?:thanks for your|your) return request/i.test(t);
  const text = plainText && (hasReturn(plainText) || !hasReturn(htmlText)) ? plainText : htmlText || plainText;
  const subject = headers.subject || "";
  const sender = retailerFromFrom(headers.from);
  const refDate = headers.date ? new Date(headers.date) : null;

  const isReturn = /\breturn id\b/i.test(text) || /(?:thanks for your|your) return request/i.test(text);
  if (!isReturn) return { ok: false, reason: "not_a_return_email", source: "shopper_email" };

  // A real return ID has at least one digit and ends at a space or line break ("RETURN ID: nuk0400251601"),
  // so words like "https" from a link, or the first word of a sentence, are never taken for one.
  const idm = text.match(/return id\s*[:#\s]*((?=[A-Z0-9-]*\d)[A-Z0-9-]{5,30})(?![A-Za-z0-9\/:.])/i);
  const orderFromSubject = subject.match(/\border\s+#?((?=[A-Z0-9-]*\d)[A-Z0-9-]{3,24})/i);
  const orderFromBody = text.match(/\border\s*(?:number|no\.?|id)\s*[:#\s]*([A-Z0-9-]{4,24})/i);

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

  const refund = text.match(/estimated refund[\s\S]{0,20}?£\s*([0-9][0-9,]*\.[0-9]{2})/i);
  let trackUrl = null;
  if (html) {
    for (const a of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = a[1].replace(/&amp;/g, "&").trim();
      const label = a[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (/^https:\/\//i.test(href) && href.length <= 800 && /track.{0,12}return/i.test(label)) { trackUrl = href; break; }
    }
  }
  const carrier = (text.match(CARRIERS) || [])[1] || null;
  const od = text.match(/order date\s*[:\-]?\s*([^\n]{4,30})/i);

  return {
    ok: true, kind: "return_instructions", source: "shopper_email", refundEligible: false,
    // The day the shop sent it: when the return was started, on the receipt's return timeline.
    at: refDate && !Number.isNaN(refDate.getTime()) ? isoDate(refDate) : null,
    retailer: { name: sender?.name || null, domain: sender?.domain || null },
    returnId: idm ? idm[1] : null,
    orderRef: orderFromSubject ? orderFromSubject[1] : orderFromBody ? orderFromBody[1] : null,
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
export function parseReturnUpdateEmail(rawEmail) {
  const raw = String(rawEmail || "").slice(0, MAX_INPUT);
  const { headers, body } = splitMessage(raw);
  const subject = headers.subject || "";
  // A carrier's "we've received your return" means the carrier has it, not the shop: parseReturnParcelEmail reads those.
  if (returnCarrierOf(headers.from)) return { ok: false, reason: "not_a_return_update" };
  if (!/\brefund|\breturn (?:has been )?(?:received|arrived|processed)|\breceived your return|\byour return (?:has|is)/i.test(subject) ||
      /\breturn request|\breturn label|\bhow to return|\bstart (?:a|your) return/i.test(subject)) return { ok: false, reason: "not_a_return_update" };
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  const text = ((parts.text.join("\n").trim()) || (html ? htmlToText(html) : "")).trim();
  const both = subject + "\n" + text.slice(0, 6000);
  // Money back for a price drop, or for an order the shop cancelled, is not a return: nothing was sent back, so Relay must
  // not show a return as refunded (round 3, 19 Nov 2026). The order's own card already says what was bought.
  const subj = subject.replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, "");
  const top = text.slice(0, 1500).replace(/\s+/g, " ");
  if (PRICE_ADJUSTMENT.test(subj) || PRICE_ADJUSTMENT.test(top)) return { ok: false, reason: "price_adjustment" };
  // (A takeaway app's changed total is money back on the order, not a return: parseOrderAdjustmentEmail. Round 10.)
  const ub = uberEmail(retailerFromFrom(headers.from)?.domain, subject, text);
  if (ub && ub.kind === "adjusted") return { ok: false, reason: "order_adjusted" };
  if (/\bcancell?(?:ed|ation)\b/i.test(subj) || NOT_A_PURCHASE_TOP.test(top) && !/\breturn(?:ed|s)?\b/i.test(subj)) return { ok: false, reason: "cancellation" };
  let stage = null;
  if (/\brefund(?:ed)?\b[^.\n]{0,40}\b(?:has been|have been|was|is being|been)?\s*(?:processed|issued|approved|completed|sent|on (?:its|the) way)\b|\bwe(?:'|’)?ve (?:processed|issued|sent|completed) (?:your|a) refund|\bwe(?:'|’)?ve refunded\b|\brefund confirmation\b|\byour refund\b/i.test(both)) stage = "refunded";
  else if (/\b(?:we(?:'|’)?ve|we have) received your return|\byour return (?:has been received|has arrived|is with us)|\breturn (?:received|arrived)\b/i.test(both)) stage = "received";
  if (!stage) return { ok: false, reason: "not_a_return_update" };
  const sender = retailerFromFrom(headers.from);
  // A refund email the shopper forwarded from their own mailbox is the shop's: the shop is read from the forwarded
  // message, as for a receipt, so it still attaches to the order by its number. The shopper's own address is never the shop.
  const fromName = ((headers.from || "").match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || null;
  const shop = shopOf({ ld: null, sender, fromName, subject, text, html, otherText: html && parts.text.length ? htmlToText(html) : "" });
  if (shop.domain && PERSONAL_MAIL.test(shop.domain)) shop.domain = null;
  if (PERSONAL_MAIL.test(sender?.domain || "") && shop.name && !shop.domain && looksLikePerson(shop.name, null)) shop.name = null;
  const refDate = headers.date ? new Date(headers.date) : null;
  const amt = stage === "refunded" ? (both.match(/refund(?:ed)?[^£\n]{0,60}£\s*([0-9][0-9,]*\.[0-9]{2})/i) || both.match(/£\s*([0-9][0-9,]*\.[0-9]{2})[^.\n]{0,40}\brefund/i)) : null;
  const ref = subject.match(/\border\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})/i) || text.match(/\border\s*(?:number|no\.?|id|#)\s*[:#\s]*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})/i);
  const rid = text.match(/return (?:id|number|reference)\s*[:#\s]*((?=[A-Z0-9-]*\d)[A-Z0-9-]{5,30})(?![A-Za-z0-9\/:.])/i);
  return {
    ok: true, kind: "return_update", stage,
    at: refDate && !Number.isNaN(refDate.getTime()) ? isoDate(refDate) : null,
    amountPence: amt ? money(amt[1]) : null, currency: amt ? "GBP" : null,
    orderRef: ref ? ref[1] : null, returnId: rid ? rid[1] : null,
    retailer: { name: shop.name || null, domain: shop.domain || null },
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
  const text = ((parts.text.join("\n").trim()) || (html ? htmlToText(html) : "")).trim();
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
  const text = ((parts.text.join("\n").trim()) || (html ? htmlToText(html) : "")).trim();
  const subject = String(headers.subject || "").replace(/^\s*(?:(?:fwd?|fw)\s*:\s*)+/i, "");
  const refDate = headers.date ? new Date(headers.date) : null;
  const at = refDate && !Number.isNaN(refDate.getTime()) ? isoDate(refDate) : null;
  // The order number, from the subject first ("Your order KO-1001 has been dispatched"), then the body ("Order number: …").
  const ref = subject.match(/\border\s*(?:number|no\.?)?\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})\b/i) || text.match(/\border\s*(?:number|no\.?|id|#)\s*[:#\s]*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})\b/i) ||
    text.slice(0, 1500).match(/\byour order\s+#?((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})\b/i);
  return { headers, parts, html, text, subject, at, orderRef: ref ? ref[1] : null };
}
// "Your order KO-1001 has been dispatched": a shop's dispatch email with no items in it. It used to be dropped, and with it the
// parcel's tracking number, so the carrier's later "delivered" email had nothing to join (round 6). Kept as a parcel update.
const DISPATCH_SUBJECT = /\b(?:dispatched|despatched|shipped|has shipped|on (?:its|it's|the) way|been sent|been posted)\b/i;
const NOT_DISPATCH = /\b(?:return(?:s|ed|ing)?|refund(?:ed|s)?|cancell?(?:ed|ation)|delay(?:ed)?|problem|unable|failed|couldn(?:'|’)?t)\b/i;
export function parseDispatchEmail(rawEmail) {
  const no = { ok: false, reason: "not_a_dispatch_email" };
  const u = updateParts(rawEmail);
  if (!DISPATCH_SUBJECT.test(u.subject) || NOT_DISPATCH.test(u.subject) || !/\border\b/i.test(u.subject + "\n" + u.text.slice(0, 1500))) return no;
  if (CARRIER_SENDERS.some(([, re]) => re.test(String(u.headers.from || ""))) || returnCarrierOf(u.headers.from)) return no;
  if (!u.orderRef) return no;
  const t = trackingIn(u.text);
  return { ok: true, kind: "delivery_update", status: "shipped", at: u.at, carrier: (t && t.carrier) || carrierIn(u.text) || null,
    trackingNumber: t ? t.trackingNumber : null, merchant: null, retailer: shopOfUpdate(u.headers, u.text, u.html, u.parts), orderRef: u.orderRef };
}
// "Your order LF-6006 has been cancelled", "Part of your order has been cancelled": the shop cancelled all or part of an order.
// Nothing was bought (or that part wasn't), so it is not a purchase and not money spent; the order's card says so. The amount
// is what the email says came back, when it says.
// Which items a part-cancelled order lost, only where the email names them (round 8): under a "Cancelled items" heading, or in
// a sentence ("We've had to cancel the Linen Shirt White from your order"). Never worked out from an amount.
const CANCELLED_HEAD = /^[\s|]*(?:cancell?ed items?|items? (?:that )?(?:we(?:'|’)?ve |we have |have been |has been |were |was )?cancell?ed|the following items? (?:has|have) been cancell?ed|what(?:'|’)?s been cancell?ed|item\(s\) cancell?ed)\s*:?[\s|]*$/im;
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
export function parseCancellationEmail(rawEmail) {
  const no = { ok: false, reason: "not_a_cancellation" };
  const u = updateParts(rawEmail);
  if (returnCarrierOf(u.headers.from) || CARRIER_SENDERS.some(([, re]) => re.test(String(u.headers.from || "")))) return no;
  const top = u.text.slice(0, 1500).replace(/\s+/g, " ");
  const said = /\bcancell?(?:ed|ation)\b/i.test(u.subject) || NOT_A_PURCHASE_TOP.test(top);
  // A price adjustment or a subscription ("Your membership has been cancelled") is not a cancelled order.
  if (!said || PRICE_ADJUSTMENT.test(u.subject + " " + top) || /\b(?:subscription|membership|plan|direct debit|account|booking|reservation|appointment|trial)\b/i.test(u.subject)) return no;
  if (!/\border\b/i.test(u.subject + " " + top) || !u.orderRef) return no;
  const partial = /\b(?:part of|some of|one of|an item|some items|items? (?:in|from|of) your order (?:has|have) been|(?:has|have) been cancell?ed from your order)\b/i.test(u.subject + " " + top) &&
    !/(?<!\b(?:part|some|one|items?) (?:of|in|from) )\b(?:your|the|this) (?:whole |entire )?order (?:has been|was|is) cancell?ed\b/i.test(u.subject + " " + top);
  const amt = (top.match(/\brefund(?:ed)?\b[^£€\n]{0,40}([£€])\s*([0-9][0-9,]*\.[0-9]{2})/i) || top.match(/([£€])\s*([0-9][0-9,]*\.[0-9]{2})[^.\n]{0,40}\b(?:refund|back to your|returned to your)/i));
  return { ok: true, kind: "order_update", stage: "cancelled", partial, at: u.at, orderRef: u.orderRef,
    ...(partial ? { cancelledItems: cancelledNames(u.text) } : {}),
    amountPence: amt ? money(amt[2]) : null, currency: amt ? (amt[1] === "€" ? "EUR" : "GBP") : null,
    retailer: shopOfUpdate(u.headers, u.text, u.html, u.parts) };
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
  if (!ub || ub.kind !== "adjusted" || ub.refundPence == null) return no;
  return { ok: true, kind: "order_update", stage: "adjusted", at: u.at, orderRef: u.orderRef || null, merchant: ub.merchant || null,
    amountPence: ub.refundPence, previousTotalPence: ub.previousPence, newTotalPence: ub.newPence, currency: "GBP",
    retailer: { name: "Uber Eats", domain: (fw && fw.domain) || sender.domain } };
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
