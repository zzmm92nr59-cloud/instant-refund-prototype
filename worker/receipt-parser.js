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
import { cleanItems, rankShop, shopNamesInText, forwardedSender, mainLinkDomain, isVia, itemsFromCells, GAME_SHOP, gameTitle, gameItems } from "./receipt-reader.js";
import { PERSONAL_MAIL } from "./receipt-category.js";

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

// Collects text/plain and text/html parts, walking nested multipart bodies.
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
  const decoded = withoutInvisible(unwrapSafeLinks(decodeBody(headers, body)));
  if (/text\/html/i.test(type)) out.html.push(decoded);
  else if (/text\/plain/i.test(type)) out.text.push(decoded);
}

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
  egrave: "è", ecirc: "ê", aacute: "á", agrave: "à", acirc: "â", iacute: "í", oacute: "ó", ouml: "ö", uuml: "ü", auml: "ä", ccedil: "ç", ntilde: "ñ", szlig: "ß", shy: "", zwnj: "", zwj: "" };
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
function htmlToText(html) {
  return decodeEntities(html
    .replace(/\r\n?/g, "\n")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
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
const F_BEFORE = new RegExp("\\b" + F_LABEL + F_GAP + "(€|EUR|US\\$|USD|CA\\$|CAD|AU?\\$|AUD|\\$)[ \\t]?" + F_NUM, "gi");
const F_AFTER = new RegExp("\\b" + F_LABEL + F_GAP + F_NUM + "[ \\t]?(€|EUR\\b|USD\\b|CAD\\b|AUD\\b)", "gi");
const DOLLARS = [["USD", /\bUSD\b|US\$|\bU\.?S\.? dollars?\b/i], ["CAD", /\bCAD\b|CA\$|\bCanadian dollars?\b/i], ["AUD", /\bAUD\b|(?<![A-Za-z])AU?\$|\bAustralian dollars?\b/i]];
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
  let currency = sign === "€" || sign === "EUR" ? "EUR" : sign === "US$" || sign === "USD" ? "USD" : sign === "CA$" || sign === "CAD" ? "CAD" : /^(AU?\$|AUD)$/.test(sign) ? "AUD" : null;
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

export function parseDate(text, refDate) {
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

function fromText(text, refDate) {
  // Some plain-text parts write the pound sign as "L" ("L69.00" on its own line). Only whole lines that are just an amount are changed.
  text = text.replace(/^([ \t|]*)L\s?([0-9][0-9,]*\.[0-9]{2})[ \t|]*$/gm, "$1£$2");
  // Bold written the plain-text way ("| **Total** | **£500.00** |") reads as the words themselves.
  text = text.replace(/\*\*([^*\n]{1,80})\*\*/g, "$1");
  // Others write the currency after the amount ("5 GBP", "12.99 GBP"): read as "£5.00", "£12.99" (never "£0.00 GBP" twice).
  text = text.replace(/(?<![£\d.,])(?<!£ )(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?[ \t]?GBP\b/g, (m, n, p) => "£" + n + "." + (p || "00"));
  const ref =
    text.match(/\border\s*(?:number|no\.?|id|ref(?:erence)?|#)\s*(?:is\s*)?[:#\s]*([A-Z0-9][A-Z0-9-]{3,24})/i) ||
    text.match(/\border\s*#\s*([A-Z0-9-]{3,24})/i) ||
    // A booking's own number ("Confirmation # : 2110090879", "Booking reference: ABC123"), so its later emails match it.
    text.match(/\b(?:confirmation|booking|reservation)\s*(?:number|no\.?|ref(?:erence)?|code|#)\s*(?:is\s*)?[:#\s]*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,24})\b/i);

  // (A note in brackets and a column edge can sit between the word and the amount: "Total (including VAT): | £10.96".)
  // "Sub Total" is the word "Total" too, so it is passed over while a real total follows, and a total that says it
  // includes delivery ("Total Including Delivery | £315.78") beats a plain one.
  const totals = [...text.matchAll(/\b(?:order\s+|grand\s+)?total(?:\s+(?:including|incl\.?|inc\.?)\s+(?:delivery|postage|shipping|vat|p&p))?(?:\s+(?:paid|amount|charged|cost|price|to pay))?(?:\s*\([^)\n]{1,40}\))?\s*(?:[:|]\s*){0,3}£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/gi)];
  const notSub = totals.filter((m) => !/sub[-\s]?$/i.test(text.slice(Math.max(0, m.index - 4), m.index)));
  const totalMatch =
    notSub.find((m) => /^(?:grand\s+)?total\s+(?:including|incl\.?|inc\.?)\s/i.test(m[0]) || /^grand\s/i.test(m[0])) || notSub[0] || totals[0] ||
    text.match(/\bamount\s+paid\s*(?:[:|]\s*){0,3}£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i) ||
    // No total named: the last line that is only an amount "(Including VAT)" ("£33.76 (Including VAT)" under the delivery charge).
    [...text.matchAll(/^[\s|]*£\s*([0-9][0-9,]*\.[0-9]{2})\s*\((?:including|incl\.?|inc\.?)\s+vat\)[\s|]*$/gim)].pop();

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
    totalPence: totalMatch ? money(totalMatch[1]) : foreign ? foreign.minor : null,
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
function receiptSignals(subject, text) {
  const s = `${subject || ""}`.toLowerCase();
  // ("Your Ted Baker order" and "Your Café Lumière receipt" count too: the shop's name between "your" and "order".)
  const subjectHit = /(order|receipt|purchase|thank you for your|payment)\b.*(confirm|receipt|received|thank)|confirmation|your receipt|order #|order no|\bthanks?\b.*\b(order|purchase)\b|\byour\b[^.!?]{0,40}\b(?:order|e-?receipt|receipt)\s*$/.test(s) ||
    // "Ordered: 'Wall Filler Kit…'", "Your 25 September receipt for 1 item", "Example.co.uk order of Chernobyl."
    /^\s*(?:(?:fwd?|fw)\s*:\s*)?ordered\s*:|\byour\b[^.!?]{0,40}\b(?:e-?receipt|receipt) (?:for|from)\b|^\s*(?:(?:fwd?|fw)\s*:\s*)?(?:your\s+)?(?:[\w.&'’-]{2,30}\s+){1,3}order of\b(?!.*\b(?:dispatched|shipped|on its way|out for delivery|delivered|cancell?ed)\b)/.test(s);
  // (A total in euros counts as a total: the receipt is kept with its amount in euros, never turned into pounds.)
  const bodyHit = /\border\s*(number|no|id|ref|#)|\btotal\b(?:\s*\([^)\n]{1,40}\))?[\s\S]{0,12}[£€]|[£€].*\btotal\b/i.test(text);
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
const PRICE_WORDS = /^(you\s+saved?|you\s+save|saved?|savings?|was|now|rrp|price|item\s+price|unit\s+price|special\s+price|sale\s+price|discount|reduced|deposit|balance|amount|paid)\b[\s:.!]*$/i;
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
      if (APPLE_SECTION.test(r)) { if (!found.length) found.push(r); break; }
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
  const ranked = rankShop({
    dataName: ld?.retailerName || null,
    forwardedName: fw?.name || null, forwardedDomain: fw?.domain || null,
    senderName: sender?.name ? fromName : null, senderDomain: domain, personal,
    bodyNames: shopNamesInText(text, subject),
    // A payment platform's own receipt names the business that was paid ("Merchant: Example Lettings").
    merchantName: domain && isVia(domain) ? ((text.match(/^[\s#*|]*merchant(?: name)?\s*[:|]\s*\**\s*([^\n|*]{2,40}?)\s*\**\s*\|?\s*$/im) || [])[1] || null) : null,
    linkDomain: mainLinkDomain(html),
    // (The game's name is a heading in the HTML; a plain-text part may not carry it at all.)
    titleName: GAME_SHOP.test(domain || "") ? (html && gameTitle(htmlToText(html))) || gameTitle(text) : null,
  });
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
const ACCOUNT_DEPOSIT = /\bthank you for (?:making|your) (?:a )?deposit\b|\bdeposit of [^\n.]{1,30}? has (?:now )?been (?:credited|added) to your (?:account|balance|wallet)\b/i;
const PAYMENT_PROBLEM = /\b(?:(?:couldn(?:'|’)?t|could not|were unable to|we(?:'|’)re unable to|unable to) (?:charge|take (?:the )?payment|process (?:your |the )?payment|authori[sz]e (?:your |the )?payment)|payment (?:was |has been )?declined|payment (?:has )?failed|problem with (?:the|your) payment method)\b/i;

// An email as the reader sees it: its subject, sender and date, its plain-text part, and its HTML part turned into text the
// same way the reader turns it. Used for "Send this email to Relay" (shared-emails.js), so what a person at Relay reads is
// what the reader read. Pictures, attachments and the other headers are left out.
export function emailForReading(rawEmail) {
  const raw = String(rawEmail || "").slice(0, MAX_INPUT);
  const { headers, body } = splitMessage(raw);
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  return { subject: headers.subject || "", from: headers.from || "", date: headers.date || "",
    plain: parts.text.join("\n").trim(), fromHtml: html ? htmlToText(html) : "" };
}

export function parseReceiptEmail(rawEmail, opts = {}) {
  const raw = String(rawEmail || "").slice(0, MAX_INPUT);
  const { headers, body } = splitMessage(raw);
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  const plain = parts.text.join("\n").trim();
  const fromHtml = html ? htmlToText(html) : "";
  let text = (plain || fromHtml).trim();

  const sender = retailerFromFrom(headers.from);
  const subject = headers.subject || null;
  // The sender's display name exactly as written (retailerFromFrom drops generic ones such as "Orders").
  const fromName = ((headers.from || "").match(/^\s*"?([^"<]+?)"?\s*</) || [])[1] || null;

  const sig = receiptSignals(subject, text);
  // When the shopper picked this very email themselves, one signal is enough (the fields are still checked below).
  if (!(opts.lenient ? sig.subjectHit || sig.bodyHit : sig.subjectHit && sig.bodyHit)) {
    return { ok: false, reason: "not_an_order_confirmation", source: "shopper_email", signals: { subject: sig.subjectHit, body: sig.bodyHit, textLength: text.length } };
  }

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
  result.items = cleanItems(result.items.filter((i) => !PRICE_WORDS.test(String(i.name || "").trim())));
  if (!result.items.length && /(^|\.)apple\.com$/i.test(result.retailer.domain || "")) result.items = appleItems(text).length ? appleItems(text) : fromHtml ? appleItems(fromHtml) : [];
  // Game currency bought through a game's web shop ("2,200 Coins"): one item, the whole order.
  if (!result.items.length && GAME_SHOP.test(sender?.domain || "")) result.items = (gameItems(fromHtml).length ? gameItems(fromHtml) : gameItems(text)).map((i) => ({ ...i, pricePence: result.totalPence ?? null }));
  // A travel booking names the journey in its subject and nowhere as an item: the journey is what was bought.
  if (!result.items.length) {
    const j = JOURNEY.exec(subject || "");
    if (j) result.items = [{ name: `${j[2].trim()} to ${j[3].trim()}${j[1] ? " (return)" : ""}`, qty: 1, pricePence: result.totalPence ?? null }];
  }
  if (!opts.lenient && looksPromotional(subject, headers, Boolean(result.orderRef))) {
    return { ok: false, reason: "promotional", source: "shopper_email" };
  }
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
    retailer: fromCarrier ? null : { name: sender?.name || null, domain: sender?.domain || null },
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
  if (!/\brefund|\breturn (?:has been )?(?:received|arrived|processed)|\breceived your return|\byour return (?:has|is)/i.test(subject) ||
      /\breturn request|\breturn label|\bhow to return|\bstart (?:a|your) return/i.test(subject)) return { ok: false, reason: "not_a_return_update" };
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  const text = ((parts.text.join("\n").trim()) || (html ? htmlToText(html) : "")).trim();
  const both = subject + "\n" + text.slice(0, 6000);
  let stage = null;
  if (/\brefund(?:ed)?\b[^.\n]{0,40}\b(?:has been|have been|was|is being|been)?\s*(?:processed|issued|approved|completed|sent|on (?:its|the) way)\b|\bwe(?:'|’)?ve (?:processed|issued|sent|completed) (?:your|a) refund|\bwe(?:'|’)?ve refunded\b|\brefund confirmation\b|\byour refund\b/i.test(both)) stage = "refunded";
  else if (/\b(?:we(?:'|’)?ve|we have) received your return|\byour return (?:has been received|has arrived|is with us)|\breturn (?:received|arrived)\b/i.test(both)) stage = "received";
  if (!stage) return { ok: false, reason: "not_a_return_update" };
  const sender = retailerFromFrom(headers.from);
  const refDate = headers.date ? new Date(headers.date) : null;
  const amt = stage === "refunded" ? (both.match(/refund(?:ed)?[^£\n]{0,60}£\s*([0-9][0-9,]*\.[0-9]{2})/i) || both.match(/£\s*([0-9][0-9,]*\.[0-9]{2})[^.\n]{0,40}\brefund/i)) : null;
  const ref = subject.match(/\border\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})/i) || text.match(/\border\s*(?:number|no\.?|id|#)\s*[:#\s]*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,24})/i);
  const rid = text.match(/return (?:id|number|reference)\s*[:#\s]*((?=[A-Z0-9-]*\d)[A-Z0-9-]{5,30})(?![A-Za-z0-9\/:.])/i);
  return {
    ok: true, kind: "return_update", stage,
    at: refDate && !Number.isNaN(refDate.getTime()) ? isoDate(refDate) : null,
    amountPence: amt ? money(amt[1]) : null, currency: amt ? "GBP" : null,
    orderRef: ref ? ref[1] : null, returnId: rid ? rid[1] : null,
    retailer: { name: sender?.name || null, domain: sender?.domain || null },
  };
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
