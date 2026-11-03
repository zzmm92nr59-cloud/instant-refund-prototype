// Works out the shop and the items on a receipt by weighing up every clue in it, instead of trusting the first thing
// that looks right. Each clue has a weight (how trustworthy that part of an email usually is); clues that agree add up,
// and the best-scoring answer wins. Used twice: when an email is read, and again when receipts are listed (so receipts
// read by an older version are tidied straight away, without reading the mailbox again).

// ---- Who sent it on the shop's behalf ---------------------------------------------------------------------------------
// Payment, ordering and email companies that send receipts for other businesses. Their name and web address say nothing
// about the shop, so they never count as the shop (the shop's own name in the email does).
export const VIA_SENDER = /(^|\.)(shopifyemail\.com|shopify\.com|stripe\.com|squareup\.com|square\.com|squareupmessaging\.com|sumup\.com|dojo\.tech|global-e\.com|paypal\.(com|co\.uk)|social-commerce\.io|privaterelay\.appleid\.com|pepperhq\.com|slerp\.com|sundayapp\.io|email-ticket\.com|touchtakeaway\.net|noreplies\.net|klaviyomail\.com|sendgrid\.net|mailchimpapp\.net|mcsv\.net|zettle\.com|izettle\.com|clover\.com|toasttab\.com|wixemails\.com|squarespace-mail\.com|bigcartel\.com|ecwid\.com|myshopify\.com|lightspeedhq\.com|epos\.now|flipdish\.com|orderyoyo\.com|mryum\.com|storekit\.com)$/i;
export const isVia = (domain) => VIA_SENDER.test(String(domain || "").toLowerCase());

// ---- Shop names ---------------------------------------------------------------------------------------------------------
// Words senders add after the shop's name: "Swarovski Customer Service GB", "Tempur UK Consumer Support", "The Buyagift Team".
const NAME_TAIL = /\s*(?:[-–|:,]\s*)?(?:(?:uk|gb|eu|ie)\s+)?(?:customer\s+(?:service|services|care|support|team)|consumer\s+(?:support|services?)|client\s+services?|account\s+services?|order\s+(?:confirmations?|team|updates?)|online\s+(?:store|shop)|digital\s+edition|e-?receipts?|receipts?|notifications?|no-?reply|support|team|app|orders?)(?:\s+(?:uk|gb|eu|ie))?\s*$/i;
const COUNTRY_TAIL = /\s+(?:uk|gb|eu|ie|united kingdom)$/i;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍]/gu;
const GENERIC_NAME = /^(orders?|order confirmation|receipts?|your receipt|no-?reply|noreply|do not reply|donotreply|info|hello|hi|team|support|customer service|customer services|sales|shop|store|notifications?|alerts?|updates?|accounts?|billing|payments?|admin|mailer|newsletter)$/i;
const TLD = /\.(co\.uk|org\.uk|com|net|org|uk|ie|io|eu|co|app|shop|store|online|tech|ai)$/i;

const letters = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// A tidy version of a sender's display name, or null when it is not a shop name at all.
export function cleanShopName(raw) {
  let name = String(raw || "").replace(EMOJI, "").replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
  if (!name) return null;
  // "Admiralcasino.co.uk" → "Admiralcasino" (a web address used as a name).
  let fromAddress = false;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(name) && TLD.test(name)) { name = name.replace(TLD, "").replace(/^www\./i, "").split(".").pop(); fromAddress = true; }
  let cut = false;
  for (let i = 0; i < 3; i++) {
    const next = name.replace(NAME_TAIL, "").replace(COUNTRY_TAIL, "").trim();
    if (next === name || !next) break;
    name = next; cut = true;
  }
  if (cut) name = name.replace(/^the\s+/i, "");
  // "Panda Mami - Panda Mami Nottingham" → "Panda Mami".
  const halves = name.split(/\s+[-–|]\s+/);
  if (halves.length === 2 && letters(halves[1]).startsWith(letters(halves[0])) && letters(halves[0]).length >= 3) name = halves[0];
  name = name.replace(/[\s,.:;|-]+$/, "").trim();
  if (!name || GENERIC_NAME.test(name) || letters(name).length < 2) return null;
  // A name written in lower case from a web address gets a capital ("admiralcasino" → "Admiralcasino").
  if (fromAddress) name = name.charAt(0).toUpperCase() + name.slice(1);
  return name;
}

// The part of a web address that names the shop: "e.rains.com" → "rains", "delivery.goldsmiths.co.uk" → "goldsmiths".
const MAIL_PART = /^(e|em|email|emails|mail|mailer|mailing|news|newsletter|info|hello|noreply|no-reply|orders?|order|shop|store|click|links?|g|t|m|r|tx\d*|reply|notify|notifications?|updates?|service|customerservice|clientservices|support|accounts?|account|send|delivery|deliveries|app|my|online|insideapple|marketing|crm|go|hi|txn|transactional|receipts?)$/i;
export function domainBase(domain) {
  const parts = String(domain || "").toLowerCase().replace(/["'<>\s]/g, "").replace(/^www\./, "").split(".").filter(Boolean);
  while (parts.length > 1 && /^(com|co|uk|net|org|io|eu|ie|de|fr|us|app|shop|store|dk|se|nl|tech|online|ai|me|biz|info|london|site|xyz|test)$/.test(parts[parts.length - 1])) parts.pop();
  const kept = parts.filter((p) => !MAIL_PART.test(p));
  return (kept.length ? kept[kept.length - 1] : parts[parts.length - 1] || "").replace(/[^a-z0-9-]/g, "");
}

// Does a name belong to this web address? ("J D Wetherspoon" and jdwetherspoon.co.uk, "Ninja" and sharkninja.com.)
export function nameFitsDomain(name, domain) {
  const n = letters(name), d = domainBase(domain).replace(/-/g, "");
  if (!n || !d) return false;
  if (n.includes(d) || d.includes(n)) return true;
  return String(name).toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 4 && d.includes(w));
}

// "Liam Hartley", "David Hartley": a person's name, not a shop's. Only names that start with a common first name count,
// so shops named after people ("Ted Baker", "Charlotte Tilbury") are safe when the name matches their web address.
const FIRST_NAMES = new Set(("james john robert michael william david richard joseph thomas charles chris christopher daniel matthew anthony mark " +
  "paul steven steve andrew andy kenneth joshua kevin brian george timothy tim ronald edward jason jeffrey ryan jacob gary nicholas nick eric " +
  "jonathan stephen larry justin scott brandon benjamin ben samuel sam gregory alexander alex frank patrick raymond jack dennis jerry tyler aaron " +
  "jose adam nathan henry douglas zachary peter pete kyle noah ethan jeremy walter christian keith roger terry harry oliver liam connor callum " +
  "jake luke lewis owen rhys dylan kieran sean shaun declan aidan conor niall ciaran darren dean lee neil ian craig stuart simon martin graham " +
  "mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret sandra ashley kimberly emily donna michelle " +
  "carol amanda dorothy melissa deborah stephanie rebecca sharon laura cynthia kathleen amy angela shirley anna brenda pamela emma nicole helen " +
  "samantha katherine kate christine debra rachel carolyn janet catherine maria heather diane ruth julie olivia joyce virginia victoria kelly " +
  "lauren christina joan evelyn judith megan andrea cheryl hannah jacqueline martha gloria teresa ann sara madison frances kathryn janice jean " +
  "abigail alice julia judy sophia sophie grace denise amber doris marilyn danielle beverly isabella theresa diana natalie brittany charlotte " +
  "marie kayla alexis lori chloe ella mia amelia jade holly leah lucy zoe jodie gemma kirsty siobhan aoife niamh ciara orla eimear").split(" "));
export function looksLikePerson(name, domain) {
  const s = String(name || "").trim();
  if (!/^[A-Z][a-z'’-]{1,15}(?:\s+[A-Z][a-z'’-]{1,20}){1,2}$/.test(s)) return false;
  if (!FIRST_NAMES.has(s.split(/\s+/)[0].toLowerCase())) return false;
  if (/\b(shop|store|stores|co|company|cafe|café|pizza|pizzeria|restaurant|bar|pub|kitchen|beds|home|house|direct|boutique|studio|gallery|games|sports|garden|books|wines?|coffee|bakery|london|uk|ltd|limited|group|club|hotel|travel|tickets|theatre|cinema|magazines?|press|news)\b/i.test(s)) return false;
  return !nameFitsDomain(s, domain);
}

// A name made from a web address, for when the email gives no better one: "bowsandwhistles" → "Bows and Whistles".
export function nameFromDomain(domain) {
  const base = domainBase(domain);
  if (!base) return null;
  const pieces = base.split("-").filter(Boolean).flatMap((w) => {
    const m = w.match(/^([a-z]{4,})and([a-z]{4,})$/);
    return m ? [m[1], "and", m[2]] : [w];
  });
  return pieces.map((w) => (w === "and" ? "and" : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

// Weighs every clue about the shop and returns the winner: { name, domain, via }.
// Clue weights: the shop's own data block 8, a forwarded email's original sender 7, the sender's name 5 (1 when it looks
// like a person), the email's footer and greeting lines 3, the sender's web address 2 (more when the name agrees with it).
export function rankShop(clues) {
  const tally = new Map();
  const add = (name, weight, domain) => {
    const clean = cleanShopName(name);
    if (!clean || weight <= 0) return;
    const k = letters(clean);
    const e = tally.get(k) || { name: clean, score: 0, domain: null, sources: 0 };
    e.score += weight; e.sources++;
    if (domain && !e.domain) e.domain = domain;
    // The first (most trusted) spelling stays ("lululemon" as the shop writes it), unless it was a long name in capitals
    // ("SWAROVSKI"). Short ones are how the brand is written ("LNER", "ASOS", "H&M"), so they keep their capitals.
    if (/^[^a-z]+$/.test(e.name) && /[a-z]/.test(clean) && letters(e.name).length >= 6) e.name = clean;
    tally.set(k, e);
  };
  const c = clues || {};
  const senderDomain = c.senderDomain && !isVia(c.senderDomain) && !c.personal ? c.senderDomain : null;
  const shopDomain = c.forwardedDomain || senderDomain || c.linkDomain || null;
  if (c.dataName) add(c.dataName, 8, shopDomain);
  if (c.forwardedName) add(c.forwardedName, 7, c.forwardedDomain);
  // A payment company sending under its own name ("Dojo" from dojo.tech) says nothing about the shop.
  const viaName = c.senderName && isVia(c.senderDomain) && nameFitsDomain(cleanShopName(c.senderName) || "", c.senderDomain);
  if (c.senderName && !c.personal && !viaName) add(c.senderName, looksLikePerson(cleanShopName(c.senderName) || "", senderDomain || c.linkDomain) ? 1 : 5, senderDomain);
  for (const n of c.bodyNames || []) add(n, 3, null);
  if (shopDomain) {
    const fromDomain = nameFromDomain(shopDomain);
    // The web address backs up any name that matches it.
    for (const e of tally.values()) if (nameFitsDomain(e.name, shopDomain)) { e.score += 3; e.domain = e.domain || shopDomain; }
    if (fromDomain) add(fromDomain, 2, shopDomain);
  }
  let best = null;
  for (const e of tally.values()) if (!best || e.score > best.score || (e.score === best.score && e.sources > best.sources)) best = e;
  return {
    name: best ? best.name : null,
    domain: (best && best.domain) || shopDomain || null,
    via: c.senderDomain && isVia(c.senderDomain) ? String(c.senderDomain).toLowerCase() : null,
  };
}

// Lines in an email that name the shop: "Thanks for shopping with X", "Your order from X", "© 2025 X Ltd", "Receipt from X".
export function shopNamesInText(text, subject) {
  const out = [];
  const grab = (s) => { const v = String(s || "").replace(/\s+/g, " ").trim().replace(/[.!,]+$/, ""); if (v && v.length <= 40 && !/\d{3,}/.test(v)) out.push(v); };
  const body = String(text || "").slice(0, 20000);
  for (const re of [
    /\bthanks?(?: you)? for (?:shopping|ordering|your (?:order|purchase)) (?:with|from|at) ([A-Z][\w&'’. -]{1,38}?)(?:[.!,\n]|$)/g,
    /\b(?:your|an?) (?:order|receipt|purchase) (?:from|with|at) ([A-Z][\w&'’. -]{1,38}?)(?:[.!,\n]| has| is|$)/g,
    /\breceipt from ([A-Z][\w&'’. -]{1,38}?)(?:[.!,\n]|$)/g,
    /©\s*(?:\d{4}\s*(?:[-–]\s*\d{4}\s*)?)?([A-Z][\w&'’. -]{1,38}?)(?:\s*(?:ltd|limited|plc|llc|inc)\.?)?(?:[.,|\n]|\s+all rights|$)/gi,
  ]) for (const m of body.matchAll(re)) grab(m[1]);
  const s = String(subject || "");
  const sm = s.match(/\b(?:your|an?) ([A-Z][\w&'’.-]{1,25}(?: [A-Z][\w&'’.-]{1,20}){0,2}) (?:order|receipt)\b/) || s.match(/\b(?:order|receipt) (?:from|with|at) ([A-Z][\w&'’. -]{1,38}?)(?:[.!,]|$| #| -)/);
  if (sm) grab(sm[1]);
  return out.filter((n) => !/^(the|your|our|this|us|you|an?|order|receipt|all rights)$/i.test(n)).slice(0, 6);
}

// A forwarded email names the shop that sent the original: "From: lululemon <orders@e.lululemon.com>". Each email app
// writes that header block its own way, and all of them are read the same:
//   Gmail       "---------- Forwarded message ---------", then From:, Date:, Subject:, To:
//   Apple Mail  "Begin forwarded message:"            Yahoo  "----- Forwarded Message -----", then From:, To:, Sent:
//   Outlook     a rule of underscores (or "-----Original Message-----"), then From:, Sent:, To:, Subject:, with the address
//               written <a@b>, <a@b<mailto:a@b>> or [mailto:a@b]
// A forward that arrives as HTML has &lt; &gt; round the address. In a forward of a forward, the person who passed it on
// (a personal mailbox) is skipped, so the shop at the bottom of the chain is the one found.
const FW_MARK = /forwarded message|begin forwarded message|original message|^[ \t>]*_{8,}[ \t]*$/im;
const FW_FROM = /(?:^|\n)[ \t>*]*from[ \t*]*:[ \t*]*"?([^"<>[\]\n@]{0,60}?)"?[ \t]*(?:<[ \t]*(?:mailto:)?|\[mailto:|\()?[ \t]*([^\s<>[\]()"'@]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+))/gi;
export function forwardedSender(text, opts = {}) {
  const t = String(text || "").slice(0, 200000).replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;|&#0*34;/gi, '"');
  const forwardedSubject = /^\s*(?:fwd?|fw)\s*:/i.test(String(opts.subject || ""));
  const personal = typeof opts.personal === "function" ? opts.personal : () => false;
  for (const m of t.matchAll(FW_FROM)) {
    const at = m.index + (m[0].startsWith("\n") ? 1 : 0);
    // It is a header block when a forward line sits just above it, or a Sent:/Date: line follows within a few lines.
    const above = FW_MARK.test(t.slice(Math.max(0, at - 300), at));
    const below = /^[ \t>*]*(?:sent|date)[ \t*]*:/im.test(t.slice(at, at + 400).split("\n").slice(1, 5).join("\n"));
    if (!above && !below && !forwardedSubject) continue;
    const domain = m[3].toLowerCase().replace(/\.+$/, "");
    if (personal(domain)) continue;
    const name = m[1].replace(/\s+/g, " ").trim();
    return { name: name || null, domain };
  }
  return null;
}

// The web address most of the email's links point to, leaving out trackers, social networks and payment companies.
export function mainLinkDomain(html) {
  const count = new Map();
  for (const m of String(html || "").matchAll(/href=["']https?:\/\/([a-z0-9.-]+)/gi)) {
    const d = m[1].toLowerCase().replace(/^www\./, "");
    if (isVia(d) || /(google|facebook|instagram|twitter|x\.com|tiktok|pinterest|youtube|linkedin|apple\.com|play\.google|klaviyo|sendgrid|mailchimp|list-manage|ct\.sendgrid|click|track|trk|links?\.|email\.|e\.|em\.|mail\.|unsubscribe|w3\.org|schema\.org|trustpilot|feefo|paypal|klarna|clearpay|royalmail|evri|dpd|ups|dhl|parcelforce|inpost|yodel)/i.test(d)) continue;
    count.set(d, (count.get(d) || 0) + 1);
  }
  let best = null, n = 0;
  for (const [d, c] of count) if (c > n) { best = d; n = c; }
  return n >= 2 ? best : null;
}

// ---- Items --------------------------------------------------------------------------------------------------------------
// Lines that sit where an item would but are not things that were bought: how it was paid, money saved or refunded,
// labels from the receipt's table, and anything carrying a card number.
const PAYMENT = /\b(visa|mastercard|master card|amex|american express|maestro|debit card|credit card|apple ?pay|google ?pay|samsung pay|paypal|klarna|clearpay|laybuy|afterpay|card ending|card number|card payment|payment method|paid (?:with|by|using)|contactless|chip (?:and|&) pin)\b/i;
const MONEY_WORDS = /^(?:you(?:'|’)?ve saved|you(?:'|’)?ve save|you saved|you save|savings?|total savings|was|now|rrp|refund|item refund|refunded|refund amount|credit(?=\s*(?:applied|balance|note|used|:|$))|store credit|account credit|vouchers?|gift ?cards?(?: balance)?|e-?gift balance|promos?(?: applied)?|promo(?:tion(?:al)?)? (?:code|discount)|discount(?: code)?|coupon|offers?(?: applied)?|tip|gratuity|service charge|bag charge|carrier bag|delivery(?: charge| fee)?|postage(?: (?:and|&) packing)?|shipping|subtotal|sub total|total|vat|tax|balance|amount(?: due| paid)?|deposit|change|cashback|points|nectar|clubcard)\b/i;
const LABEL_ONLY = /^(?:from|to|card|item|items|product|products|qty|quantity|price|unit price|each|description|summary|order|order summary|order details|details|name|size|colou?r|sku|ref|reference|date|time|status|ordered|dispatched|delivered|sold by|seller|item no|article|style|code)(?:\s*[:#]?\s*\d+)?(?:\s+(?:price|qty|quantity|each|total|item|items))*\s*$/i;
const CARD_DIGITS = /\d{4,}[*•xX]{3,}|[*•]{3,}\s?\d{2,}|\b(?:x{3,}|\*{3,})\d{3,4}\b/;

// Returns the item tidied ({ name, qty, ... }) or null when the line isn't an item.
export function cleanItem(item) {
  if (!item || typeof item.name !== "string") return null;
  let name = item.name.replace(/\s+\|\s*$/, "").replace(/[ \t]+/g, " ").trim();
  let qty = item.qty;
  // "Chocolate Brown                1": the quantity column ran into the name.
  const tail = item.name.match(/\s{2,}(\d{1,2})\s*$/) || name.match(/\s+[x×]\s?(\d{1,2})$/i);
  if (tail) { name = name.slice(0, name.length - tail[0].trim().length).trim(); if (!qty || qty === 1) qty = Number(tail[1]) || qty; }
  name = name.replace(/\s*[-–:|]+$/, "").trim();
  if (letters(name).replace(/[0-9]/g, "").length < 2) return null;
  if (/:\s*$/.test(item.name.trim()) || /:$/.test(name)) return null;
  if (CARD_DIGITS.test(name) || MONEY_WORDS.test(name) || LABEL_ONLY.test(name)) return null;
  // "Mastercard", "Paid with Apple Pay": how it was paid. ("Credit card holder" is a thing you can buy.)
  if (PAYMENT.test(name) && !/\b(holders?|cases?|wallets?|covers?|sleeves?|organi[sz]ers?|pouch(es)?|purses?|stands?|mounts?|readers?)\b/i.test(name)) return null;
  if (/^[x×]\s?\d+$|^\d+\s?[x×]$|^[\d\s.,£$€%-]+$/i.test(name)) return null;
  if (/@|https?:|www\./i.test(name)) return null;
  return { ...item, name, qty: qty || 1 };
}
export function cleanItems(items) {
  return (Array.isArray(items) ? items : []).map(cleanItem).filter(Boolean);
}
