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

function decodeBase64(text) {
  try {
    const bin = atob(text.replace(/\s+/g, ""));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
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

function parseHeaders(block) {
  const headers = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = decodeMimeWords(line.slice(i + 1).trim());
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
  if (enc.includes("base64")) return decodeBase64(body);
  return body;
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
  const decoded = decodeBody(headers, body);
  if (/text\/html/i.test(type)) out.html.push(decoded);
  else if (/text\/plain/i.test(type)) out.text.push(decoded);
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&pound;/gi, "£")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
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

function retailerFromFrom(fromHeader) {
  if (!fromHeader) return null;
  const name = fromHeader.match(/^\s*"?([^"<]+?)"?\s*</);
  const addr = fromHeader.match(/<?([^<>\s]+@[^<>\s]+)>?/);
  const domain = addr ? addr[1].split("@")[1].toLowerCase() : null;
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
        orderDate: order.orderDate ? String(order.orderDate).slice(0, 10) : null,
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

export function parseDate(text, refDate) {
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})\b/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = text.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/); // UK day-first
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  // "Placed on Fri 9 Oct": no year in the text, so take it from the email's own date.
  m = text.match(/\b(?:placed|ordered)\s+on\s+(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})/i);
  if (m && refDate instanceof Date && !Number.isNaN(refDate.getTime())) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) {
      let year = refDate.getUTCFullYear();
      if (new Date(Date.UTC(year, mi, Number(m[1]))) > new Date(refDate.getTime() + 86400000)) year -= 1;
      return `${year}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }
  return null;
}

function fromText(text, refDate) {
  const ref =
    text.match(/\border\s*(?:number|no\.?|id|ref(?:erence)?|#)\s*(?:is\s*)?[:#\s]*([A-Z0-9][A-Z0-9-]{3,24})/i) ||
    text.match(/\border\s*#\s*([A-Z0-9-]{3,24})/i);

  const totalMatch =
    text.match(/\b(?:order\s+)?total(?:\s+paid)?\s*[:|]?\s*£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i) ||
    text.match(/\bamount\s+paid\s*[:|]?\s*£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i);

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
      const nameLines = [rows[i - 2], rows[i - 1]].filter((r) => r.length < 80 && !/^£|items|purchased|order|subtotal|total/i.test(r));
      let price = null;
      for (let j = i + 1; j < Math.min(rows.length, i + 4) && price == null; j++) {
        const pm = rows[j].match(/^£\s*([0-9][0-9,]*\.[0-9]{2})$/);
        if (pm) price = money(pm[1]);
      }
      if (nameLines.length) items.push({ name: nameLines.join(" ").trim(), qty: Number(v[1]), pricePence: price, lineTotal: true });
    }
  }
  const sub = text.match(/\bsubtotal\s*[:|]?\s*£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i);

  return {
    method: "text",
    subtotalPence: sub ? money(sub[1]) : null,
    retailerName: null,
    orderRef: ref ? ref[1] : null,
    orderDate: parseDate(text, refDate),
    currency: /£|GBP/.test(text) ? "GBP" : null,
    totalPence: totalMatch ? money(totalMatch[1]) : null,
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
function looksLikeReceipt(subject, text) {
  const s = `${subject || ""}`.toLowerCase();
  const subjectHit = /(order|receipt|purchase|thank you for your|payment)\b.*(confirm|receipt|received|thank)|confirmation|your receipt|order #|order no|\bthanks?\b.*\b(order|purchase)\b/.test(s);
  const bodyHit = /\border\s*(number|no|id|ref|#)|\btotal\b[\s\S]{0,12}£|£.*\btotal\b/i.test(text);
  return subjectHit && bodyHit;
}

export function parseReceiptEmail(rawEmail) {
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

  if (!looksLikeReceipt(subject, text)) {
    return { ok: false, reason: "not_an_order_confirmation", source: "shopper_email" };
  }

  const ld = html ? fromJsonLd(html) : null;
  const refDate = headers.date ? new Date(headers.date) : null;
  let txt = fromText(text, refDate);
  // Many senders include a skimpy plain-text part next to the full HTML one: use whichever reads richer.
  if (plain && fromHtml) {
    const alt = fromText(fromHtml, refDate);
    const richness = (r) => (r.items.length ? 2 : 0) + (r.orderDate ? 1 : 0) + (r.totalPence != null ? 1 : 0) + (r.orderRef ? 1 : 0);
    if (richness(alt) > richness(txt)) { txt = alt; text = fromHtml; }
  }
  const chosen = ld || txt;

  const result = {
    ok: true,
    source: "shopper_email",
    refundEligible: false, // shopper-supplied evidence never triggers refunds
    method: chosen.method,
    retailer: {
      name: chosen.retailerName || sender?.name || null,
      domain: sender?.domain || null,
    },
    orderRef: chosen.orderRef ?? txt.orderRef,
    orderDate: chosen.orderDate ?? txt.orderDate,
    currency: chosen.currency ?? txt.currency,
    totalPence: chosen.totalPence ?? txt.totalPence,
    items: chosen.items.length ? chosen.items : txt.items,
  };
  result.returns = extractReturns(text, html, result.orderDate);

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
  const ceiling = Math.max(result.totalPence ?? 0, txt.subtotalPence ?? 0);
  const consistent = result.totalPence == null || !result.items.length || itemSum <= ceiling + 1;
  result.confidence = score >= 5 && consistent ? "high" : score >= 3 && consistent ? "medium" : "low";
  result.needsShopperConfirmation = result.confidence !== "high";
  return result;
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
  const text = (parts.text.join("\n") || htmlToText(html)).trim();
  const subject = headers.subject || "";
  const sender = retailerFromFrom(headers.from);
  const refDate = headers.date ? new Date(headers.date) : null;

  const isReturn = /\breturn id\b/i.test(text) || /(?:thanks for your|your) return request/i.test(text);
  if (!isReturn) return { ok: false, reason: "not_a_return_email", source: "shopper_email" };

  const idm = text.match(/return id\s*[:#]?\s*([A-Z0-9-]{5,30})/i);
  const orderFromSubject = subject.match(/\border\s+#?((?=[A-Z0-9-]*\d)[A-Z0-9-]{3,24})/i);
  const orderFromBody = text.match(/\border\s*(?:number|no\.?|id)\s*[:#]?\s*([A-Z0-9-]{4,24})/i);

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
  };
}


// ---- Product photos ---------------------------------------------------------------
// Picks up to two likely product-photo URLs from an order email's HTML. Only https links to
// real hostnames are returned. Logos, social icons, tracking pixels and payment badges are skipped.
const NOT_A_PHOTO = /(pixel|tracking|track\b|beacon|spacer|logo|facebook|instagram|twitter|tiktok|pinterest|youtube|linkedin|social|icon|badge|footer|header|banner|payment|visa|mastercard|paypal|klarna|apple-?pay|google-?play|app-?store|qr|barcode|\.gif(\?|$)|1x1|\/open\b|click\.)/i;
export function extractProductImageUrls(rawEmail) {
  const raw = String(rawEmail || "").slice(0, MAX_INPUT);
  const { headers, body } = splitMessage(raw);
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  if (!html) return [];
  const words = (parseReceiptEmail(rawEmail).items || []).flatMap(i => String(i.name || "").toLowerCase().split(/\W+/)).filter(w => w.length > 3);
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
    if (words.some(x => alt.includes(x) || url.toLowerCase().includes(x))) score += 3;
    if (w >= 150 || h >= 150) score += 1;
    if (/product|item|catalog|media|images?/i.test(url)) score += 1;
    if (!found.some(f => f.url === url)) found.push({ url, score, order: found.length });
  }
  return found.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 2).map(f => f.url);
}
