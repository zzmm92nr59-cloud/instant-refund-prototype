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

function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
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

function parseHeaders(block) {
  const headers = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
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
  if (enc.includes("quoted-printable")) return decodeQuotedPrintable(body);
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

function parseDate(text) {
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})\b/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/); // UK day-first
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function fromText(text) {
  const ref =
    text.match(/\border\s*(?:number|no\.?|ref(?:erence)?|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,24})/i) ||
    text.match(/\border\s*#\s*([A-Z0-9-]{3,24})/i);

  const totalMatch =
    text.match(/\b(?:order\s+)?total(?:\s+paid)?\s*[:|]?\s*£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i) ||
    text.match(/\bamount\s+paid\s*[:|]?\s*£\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i);

  // Line items: "Name ... Qty 1 ... £29.99" on one line or table row.
  const items = [];
  for (const line of text.split("\n")) {
    if (/total|subtotal|delivery|shipping|postage|discount|vat|tax|paid/i.test(line)) continue;
    const m = line.match(/^\s*(?:(\d+)\s*[x×]\s*)?([A-Za-z][^|£\n]{2,80}?)\s*(?:\||-|–)?\s*(?:(?:qty|quantity)\s*[:x]?\s*(\d+)\s*(?:\||-|–)?\s*)?£\s*([0-9][0-9,]*\.[0-9]{2})\s*\|?\s*$/i);
    if (m) {
      items.push({
        name: m[2].trim().replace(/\s*\|\s*$/, ""),
        qty: Number(m[1] || m[3] || 1),
        pricePence: money(m[4]),
      });
    }
  }

  return {
    method: "text",
    retailerName: null,
    orderRef: ref ? ref[1] : null,
    orderDate: parseDate(text),
    currency: /£|GBP/.test(text) ? "GBP" : null,
    totalPence: totalMatch ? money(totalMatch[1]) : null,
    items,
  };
}

// An email that is not an order confirmation must not be turned into a purchase.
function looksLikeReceipt(subject, text) {
  const s = `${subject || ""}`.toLowerCase();
  const subjectHit = /(order|receipt|purchase|thank you for your|payment)\b.*(confirm|receipt|received|thank)|confirmation|your receipt|order #|order no/.test(s);
  const bodyHit = /\border\s*(number|no|ref|#)|\btotal\b.*£|£.*\btotal\b/i.test(text);
  return subjectHit && bodyHit;
}

export function parseReceiptEmail(rawEmail) {
  const raw = String(rawEmail || "").slice(0, MAX_INPUT);
  const { headers, body } = splitMessage(raw);
  const parts = { text: [], html: [] };
  collectParts(headers, body, parts);
  const html = parts.html.join("\n");
  const text = (parts.text.join("\n") || htmlToText(html)).trim();

  const sender = retailerFromFrom(headers.from);
  const subject = headers.subject || null;

  if (!looksLikeReceipt(subject, text)) {
    return { ok: false, reason: "not_an_order_confirmation", source: "shopper_email" };
  }

  const ld = html ? fromJsonLd(html) : null;
  const txt = fromText(text);
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

  const itemSum = result.items.reduce((n, i) => n + (i.pricePence ?? 0) * (i.qty || 1), 0);
  const checks = [
    result.orderRef ? 1 : 0,
    result.totalPence != null ? 1 : 0,
    result.items.length ? 1 : 0,
    result.orderDate ? 1 : 0,
    result.retailer.name || result.retailer.domain ? 1 : 0,
  ];
  const score = checks.reduce((a, b) => a + b, 0);
  // Item prices should not add up to more than the total (delivery/discounts can make them differ).
  const consistent = result.totalPence == null || !result.items.length || itemSum <= result.totalPence + 1;
  result.confidence = score >= 5 && consistent ? "high" : score >= 3 && consistent ? "medium" : "low";
  result.needsShopperConfirmation = result.confidence !== "high";
  return result;
}
