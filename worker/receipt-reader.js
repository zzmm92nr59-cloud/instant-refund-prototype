// Works out the shop and the items on a receipt by weighing up every clue in it, instead of trusting the first thing
// that looks right. Each clue has a weight (how trustworthy that part of an email usually is); clues that agree add up,
// and the best-scoring answer wins. Used twice: when an email is read, and again when receipts are listed (so receipts
// read by an older version are tidied straight away, without reading the mailbox again).

// ---- Who sent it on the shop's behalf ---------------------------------------------------------------------------------
// Payment, ordering and email companies that send receipts for other businesses. Their name and web address say nothing
// about the shop, so they never count as the shop (the shop's own name in the email does).
export const VIA_SENDER = /(^|\.)(shopifyemail\.com|shopify\.com|klarna\.(com|co\.uk)|giftpro\.co\.uk|mytoggle\.io|ventrata\.com|stripe\.com|squareup\.com|square\.com|squareupmessaging\.com|sumup\.com|dojo\.tech|global-e\.com|paypal\.(com|co\.uk)|social-commerce\.io|privaterelay\.appleid\.com|pepperhq\.com|slerp\.com|sundayapp\.io|email-ticket\.com|touchtakeaway\.net|noreplies\.net|klaviyomail\.com|sendgrid\.net|mailchimpapp\.net|mcsv\.net|zettle\.com|izettle\.com|clover\.com|toasttab\.com|wixemails\.com|squarespace-mail\.com|bigcartel\.com|ecwid\.com|myshopify\.com|lightspeedhq\.com|epos\.now|flipdish\.com|orderyoyo\.com|mryum\.com|storekit\.com)$/i;
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
  if (c.titleName) add(c.titleName, 6, shopDomain);
  if (c.forwardedName) add(c.forwardedName, 7, c.forwardedDomain);
  // A payment company sending under its own name ("Dojo" from dojo.tech) says nothing about the shop.
  // (Nor does a game's web shop sending under its own name, when the receipt names the game.)
  const viaName = c.senderName && (isVia(c.senderDomain) || c.titleName) && nameFitsDomain(cleanShopName(c.senderName) || "", c.senderDomain);
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
    // A pay-later or payment company's email names the shop it paid: "Payment received for lululemon".
    /\bpayment (?:received |made |sent )?(?:for|to) (\p{L}[\w&'’. -]{1,38}?)(?:[.!,\n]|$)/giu,
    /©\s*(?:\d{4}\s*(?:[-–]\s*\d{4}\s*)?)?([A-Z][\w&'’. -]{1,38}?)(?:\s*(?:ltd|limited|plc|llc|inc)\.?)?(?:[.,|\n]|\s+all rights|$)/gi,
  ]) for (const m of body.matchAll(re)) grab(m[1]);
  const s = String(subject || "");
  const sm = s.match(/\b(?:your|an?) ([A-Z][\w&'’.-]{1,25}(?: [A-Z][\w&'’.-]{1,20}){0,2}) (?:order|receipt)\b/) || s.match(/\b(?:order|receipt) (?:from|with|at) ([A-Z][\w&'’. -]{1,38}?)(?:[.!,]|$| #| -)/);
  if (sm) grab(sm[1]);
  return out.filter((n) => !/^(the|your|our|this|us|you|an?|order|receipt|all rights)$/i.test(n) && !/^(your|our|this|an?) /i.test(n) && !/^the (order|payment|amount|total|items?|balance)\b/i.test(n)).slice(0, 6);
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
const MONEY_WORDS = /^(?:left to pay|amount left|still to pay|you(?:'|’)?ve saved|you(?:'|’)?ve save|you saved|you save|savings?|total savings|was|now|rrp|refund|item refund|refunded|refund amount|credit(?=\s*(?:applied|balance|note|used|:|$))|store credit|account credit|vouchers?|gift ?cards?(?: balance)?|e-?gift balance|promos?(?: applied)?|promo(?:tion(?:al)?)? (?:code|discount)|discount(?: code)?|coupon|offers?(?: applied)?|tip|gratuity|service charge|bag charge|carrier bag|bags? for life|delivery(?: charge| fee)?|postage(?: (?:and|&) packing)?|shipping|subtotal|sub total|total|vat|tax|balance|amount(?: due| paid)?|deposit|change|cashback|points|nectar|clubcard)\b/i;
const LABEL_ONLY = /^(?:from|to|card|item|items|product|products|qty|quantity|price|unit price|each|description|summary|order|order summary|order details|details|name|size|colou?r|sku|ref|reference|date|time|status|ordered|dispatched|delivered|sold by|seller|item no|article|style|code)(?:\s*[:#]?\s*\d+)?(?:\s+(?:price|qty|quantity|each|total|item|items))*\s*$/i;
const CARD_DIGITS = /\d{4,}[*•xX]{3,}|[*•]{3,}\s?\d{2,}|\b(?:x{3,}|\*{3,})\d{3,4}\b/;
// Partner offers some shops list with the order ("10% off sitewide at Ninja!", "Free SimplyCook box",
// "Amazon Music Unlimited – Get 3 months free"): not things that were bought.
const OFFER_LINE = /^(?:\d{1,3}\s?% off\b|free\s+(?:[\p{L}'’-]+\s+){1,3}(?:box|trial|months?)\b)|\b(?:get|claim|enjoy)\s+\d+\s+months?\b[^£]*\bfree\b|\bfree for \d+ months?\b/iu;

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
  if (CARD_DIGITS.test(name) || MONEY_WORDS.test(name) || LABEL_ONLY.test(name) || OFFER_LINE.test(name)) return null;
  // "Mastercard", "Paid with Apple Pay": how it was paid. ("Credit card holder" is a thing you can buy.)
  if (PAYMENT.test(name) && !/\b(holders?|cases?|wallets?|covers?|sleeves?|organi[sz]ers?|pouch(es)?|purses?|stands?|mounts?|readers?)\b/i.test(name)) return null;
  if (/^[x×]\s?\d+$|^\d+\s?[x×]$|^[\d\s.,£$€%-]+$/i.test(name)) return null;
  if (/@|https?:|www\./i.test(name)) return null;
  return { ...item, name, qty: qty || 1 };
}
export function cleanItems(items) {
  return (Array.isArray(items) ? items : []).map(cleanItem).filter(Boolean);
}

// ---- Item tables read as cells ----------------------------------------------------------------------------------
// Order-and-pay receipts from pubs and restaurants, takeaway apps, fast food and supermarket orders lay their items out
// as table cells: a quantity, a name and a price, in whichever order the shop's columns go and however the email breaks
// its lines. So the text is read as one stream of cells (a line break and a column edge both end a cell) and an item is
// recognised by its shape: a quantity, then a name, then a price ("1 | Pepsi Max | £1.95"), or a name, then a quantity,
// then a price ("Coconut Water 1L | 2 | £5.00"). Extras under an item ("+ No salad", the parts of a meal deal) belong to
// the item above, and their prices are added to its price. The table ends at its totals (subtotal, VAT, delivery, payment).
const CELL_QTY = /^(?:x\s?)?(\d{1,2})(?:\s?x)?$/i;
const CELL_PRICE = /^([-−–])?\s?£\s?(\d{1,4}(?:,\d{3})*\.\d{2})\s?\*?$/;
// Unit prices and notes that sit inside a row: "£4.00/unit", "£1.20 each", "Substitution allowed".
const CELL_NOTE = /^£\s?\d[\d,]*\.\d{2}\s*(?:\/|per\b|each\b|ea\b)|^(?:substitutions?\b|no substitut|substituted\b|nectar price|clubcard price|was\s£|save\s£|price per\b|view item\b|buy again\b|write a review\b)|^(?:item|sku|style|article|product|ref)\s?(?:#|no\.?|number|code)\s*:?\s*[\w-]{3,24}$/i;
const CELL_END = /^(?:sub-?\s?total|total\b|order total|grand total|basket total|items? total|vat\b|tax\b|delivery\b|shipping\b|postage\b|service (?:fee|charge)|payment\b|discount|offer discount|promotion|you(?:'|’)?ve saved|you saved|savings\b|tip\b|bag (?:charge|levy)|carrier bag|credit\b|voucher|gift card|amount (?:paid|due)|paid\b|balance\b|estimated total|rewards?\b)/i;
const CELL_HEAD = /^(?:qty|quantity|items?|item (?:detail|details|name|cost|price)|description|products?|price|amount|cost|each|unit price|line total)$/i;
const CELL_PLUS = /^[+•]$/;
const CELL_OPTION = /^(?:flavou?r|size|colou?r|style|variant|option|strength|fit|length|width|material|scent|shade|type)\s*:\s*\S/i;
// What comes after a table when it has no totals of its own.
const CELL_AFTER = /^(?:thank(?:s| you)\b|we hope\b|enjoy\b|need (?:help|to)\b|questions?\b|contact\b|track (?:your|my)\b|view (?:your|my|order)\b|download\b|manage (?:your|my)\b|get the app\b)/i;
const pennies = s => Math.round(Number(String(s).replace(/,/g, "")) * 100);

export function itemsFromCells(text) {
  const cells = [];
  for (const line of String(text || "").split(/\r\n|\r|\n/)) {
    for (const raw of line.split("|")) {
      const c = raw.replace(/[\u200b-\u200d\u034f\u00ad\u2060\ufeff]/g, "").replace(/\s+/g, " ").trim();
      // "1 x W Restfeel Slide": the quantity and the name share a cell.
      const qn = /^(\d{1,2})\s?[x×]\s+(\p{L}.{1,118})$/u.exec(c);
      if (qn) cells.push(qn[1], qn[2]);
      else if (c) cells.push(c);
    }
    if (cells.length > 4000) break;
  }
  const qtyAt = i => { const m = CELL_QTY.exec(cells[i] || ""); return m && Number(m[1]) >= 1 ? Number(m[1]) : null; };
  const priceAt = i => { const m = CELL_PRICE.exec(cells[i] || ""); return m ? { pence: pennies(m[2]), negative: Boolean(m[1]) } : null; };
  const nameAt = i => { const c = cells[i]; return Boolean(c) && c.length <= 120 && /\p{L}{2}/u.test(c) && !CELL_HEAD.test(c) && !CELL_END.test(c) && !CELL_AFTER.test(c) && !CELL_NOTE.test(c) && !priceAt(i); };
  // The next cell that counts (unit prices and notes are passed over).
  const next = i => { let j = i + 1; while (j < cells.length && (CELL_NOTE.test(cells[j]) || CELL_HEAD.test(cells[j]))) j++; return j; };
  // A sentence is the end of a table, not a name ("If you require a breakdown of the VAT, please speak to...").
  const sentence = c => c.length > 70 || (c.split(" ").length > 9 && /[.!?]$/.test(c));

  function read(start, mode) {
    const rows = [];
    let cur = null;
    const done = () => { if (cur && cur.name && cur.pence != null) rows.push(cur); cur = null; };
    let j = start;
    for (; j < cells.length && rows.length < 80; j++) {
      const c = cells[j];
      if (CELL_END.test(c) || CELL_AFTER.test(c)) break;
      if (CELL_NOTE.test(c) || CELL_HEAD.test(c) || CELL_PLUS.test(c)) continue;
      const p = priceAt(j);
      if (p) {
        if (!cur || !cur.name) break;          // a price with no item above it: the table is over
        if (p.negative) continue;             // money off is not an item (the totals say what was paid)
        cur.pence = cur.pence == null ? p.pence : cur.pence + p.pence;
        continue;
      }
      const q = qtyAt(j);
      if (q != null) {
        if (mode === "qty") {
          if (!cur || cur.pence != null) { done(); cur = { qty: q, extras: [] }; }
          // (a quantity before the item above has its price is a part of it: "1 x Chicken Big Mac" in a meal deal)
        } else if (cur && cur.qty == null && cur.pence == null) cur.qty = q;
        else break;
        continue;
      }
      if (!nameAt(j)) continue;                // stray cells such as "@"
      if (mode === "qty") {
        if (!cur) break;
        if (!cur.name) { if (sentence(c)) break; cur.name = c; }
        else if (!sentence(c) && c !== cur.name && !cur.extras.includes(c)) cur.extras.push(c);
        else if (sentence(c) && cur.pence != null) break;
      } else if (qtyAt(next(j)) != null && priceAt(next(next(j)))) {
        done();
        // "Nerd Pen - Banana Ice | Flavour: Banana Ice | 2 | £1.98": the option under the product's name is not its name.
        cur = CELL_OPTION.test(c) && j > 0 && nameAt(j - 1) && !CELL_OPTION.test(cells[j - 1]) ? { name: cells[j - 1], extras: [c] } : { name: c, extras: [] };
      }
      // (in a name-first table, any other name is a note under the item)
    }
    done();
    return { end: j, items: rows.filter(r => !(r.pence === 0 && /\b(non[- ]?chargeable|carrier bag|shopper|bag for life|paper bag)\b/i.test(r.name))).map(r => {
      let name = r.name, extras = r.extras;
      // A deal's headline ("£1.99 for a Chicken Big Mac!") is not the thing bought: the part under it is.
      if (/£|!$/.test(name)) { const k = extras.findIndex(e => !/£|!$/.test(e)); if (k >= 0) { name = extras[k]; extras = extras.filter((_, i) => i !== k); } }
      extras = extras.filter(e => !/£|!$/.test(e)).slice(0, 6);
      return { name, qty: r.qty || 1, pricePence: r.pence, lineTotal: true, ...(extras.length ? { variant: extras.join(", ").slice(0, 120) } : {}) };
    }) };
  }

  let best = [];
  for (let i = 0; i < cells.length; i++) {
    let mode = null;
    const firstPrice = k => { const p = priceAt(k) || (nameAt(k) && cells[k].length <= 30 ? priceAt(next(k)) : null); return p && !p.negative; };
    if (qtyAt(i) != null && nameAt(next(i)) && firstPrice(next(next(i)))) mode = "qty";
    else if (nameAt(i) && qtyAt(next(i)) != null && priceAt(next(next(i))) && !priceAt(next(next(i))).negative) mode = "name";
    if (!mode) continue;
    const run = read(i, mode);
    if (run.items.length > best.length) best = run.items;
    i = Math.max(i, run.end - 1);
  }
  return best;
}

// ---- Web shops for mobile games ---------------------------------------------------------------------------------
// Appcharge and Xsolla sell game currency on a game's behalf and send the receipt under their own name ("Purchase
// Confirmation #676-712-348" from no-reply@appcharge.com). The game is the heading at the top ("MATCH MASTERS-CANDIVORE":
// the game, then its studio) and what was bought sits under "Items" ("Coins | 2,200").
export const GAME_SHOP = /(^|\.)(appcharge\.com|xsolla\.com)$/i;
const cellsOf = (text) => String(text || "").split(/\r\n|\r|\n/).flatMap((l) => l.split("|"))
  .map((c) => c.replace(/[\u200b-\u200d\u034f\u00ad\u2060\ufeff]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
export function gameTitle(text) {
  for (const c of cellsOf(text).slice(0, 12)) {
    if (c.length < 3 || c.length > 48 || /\d/.test(c) || !/\p{L}{2}/u.test(c)) continue;
    if (/\b(purchase|confirmation|receipt|order|thank|thanks|hello|hi|dear|payment|invoice|powered|contact|support|help|questions?|assistance|support team)\b/i.test(c)) continue;
    let name = c.replace(/\s*[-–]\s*[A-Z0-9][A-Z0-9 &.]{1,30}$/, "").trim() || c;
    if (name === name.toUpperCase()) name = name.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    return name;
  }
  return null;
}
export function gameItems(text) {
  const cells = cellsOf(text);
  const i = cells.findIndex((c) => /^items?$/i.test(c));
  if (i < 0) return [];
  const name = cells[i + 1] || "", amount = cells[i + 2] || "";
  if (!/^\p{L}[\p{L} ]{1,30}$/u.test(name) || !/^\d{1,3}(?:,\d{3})*$|^\d{1,7}$/.test(amount)) return [];
  return [{ name: amount + " " + name, qty: 1 }];
}
