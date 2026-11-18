// Reading the items on an order email, and checking them against the email's own totals.
//
// Why this exists (18 Nov 2026): a Just Eat order showed one item when five were bought. The old reader took the first
// layout that found anything, one line at a time, so an item whose extras ("+ Egg Fried Rice") sat between its name and its
// price was skipped without a word, and nothing noticed that the items came to less than the subtotal.
//
// Two parts, both pure (no network, no storage):
//  * readItems(text): reads the item list the way a person does, line by line, whatever the layout: an item is a name with
//    a price, with its quantity, its extras and its details (colour, size) wherever the shop puts them: on the same line,
//    in the cells of a table row, or on the lines between the name and the price. Extras belong to the item above, never
//    items of their own; fees, discounts, tips and totals are never items; items marked unavailable or "not charged" are
//    left out.
//  * checkItems(items, money): adds up the items and compares them with what the email says they came to (its subtotal, or
//    its total less fees and tips plus discounts). The answer is kept on the receipt (itemsCheck) so the app can say plainly
//    when Relay may have missed some items, instead of showing a partial list as if it were complete.
// Nothing is guessed: an amount that can't be read is left out, and a check that has nothing to compare with says so (null).

const MONEY = "£\\s?(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{2})|\\s(\\d{2}))";
const pence = (pounds, p1, p2) => Number(String(pounds).replace(/,/g, "")) * 100 + Number(p1 || p2 || 0);
// A cell that is only an amount: "£6.99", "-£3.00", "£ 12 99" (Amazon prints pounds and pence apart), "Item price: £35.00".
const PRICE_CELL = new RegExp("^(?:(?:item\\s+)?price\\s*:?\\s*|amount\\s*:?\\s*)?([-−–])?\\s?" + MONEY + "\\s*\\*?$", "i");
const LABEL_PRICE = /^(?:item\s+)?price\s*:/i;
const FREE_CELL = /^(?:free|£0(?:\.00)?)$/i;
const NOT_CHARGED = /\bnot charged\b|\bno charge\b|\bunavailable\b|\bout of stock\b/i;
// Quantities on their own: "2", "x2", "2 x", "Qty: 2", "Quantity 2", "Units: 2", "2 units", "5 sleeves (50 capsules)".
const QTY_CELL = /^(?:(?:qty|quantity|units?|x|×)\s*[:.]?\s*(\d{1,3})|(\d{1,3})\s*(?:x|×)?|(\d{1,3})\s+(?:units?|sleeves?|pcs|pieces|packs?)\b[^£]{0,30})$/i;
// A unit price, with or without how many: "£68.00 each", "1 x £1.65", "2 × £50.00", "@ £24.00", "Unit price: £5.30".
const UNIT_CELL = new RegExp("^(?:(\\d{1,3})\\s?[x×]\\s?" + MONEY + "|" + MONEY + "\\s*(?:each|ea\\.?|per item|/\\s?unit)|@\\s?" + MONEY + "|unit\\s+price\\s*:?\\s*" + MONEY + ")$", "i");
// Labels that name the value in the next cell.
const QTY_LABEL = /^(?:qty|quantity|units?)\s*:?$/i, PRICE_LABEL = /^(?:price|unit price|item price|each)\s*:?$/i, TOTAL_LABEL = /^(?:total|line total|item total)\s*:?$/i;
const NAME_LABEL = /^(?:plan|product|item|description|subscription)\s*:?$/i;

// Where the item list ends: subtotals, fees, discounts, tips, payment. (Only once an item has been read: some emails put
// their total at the top.)
const END = /^(?:sub-?\s?total|subtotal|(?:order |grand |basket |estimated |trolley |items? |products? |goods )?total\b|total of items|item\(s\) subtotal|guide price|order value|items|products|delivery\b|delivery\/shipping|shipping\b|postage\b|p\s?&\s?p\b|service\b|bag\b|bag (?:fee|charge|levy)|carrier bags?\b|small order|basket charge|minimum basket|booking fee|vat\b|tax\b|discount|voucher|promo|promotion|offers?\b|offer savings|multi-?buy|savings?\b|you(?:'|’)?ve saved|you saved|credit\b|credit applied|(?:rider |driver |courier )?tip\b|gratuity|payment\b|payments\b|paid\b|amount (?:paid|due)|total paid|nectar|clubcard|more card|mywaitrose|rollback|member offer|adiclub|subscribe\s?&\s?save|3 for 2|deal\b|buyer protection|click\s?&\s?collect|fast track|installation|collect in store|store delivery|delivery to store|standard delivery|express delivery|airport surcharge|shop discount|includes vat|including vat|incl\.? vat)/i;
// Lines that are never part of an item: greetings, sentences, order details, dates, column and section headings.
const LABELLED = /^(?:order|date|placed|ordered|booking|booked|transaction|receipt|invoice|deliver(?:y|ing)? (?:to|address|on|by)|delivering|collect(?:ion)? (?:from|on)|payment method|paid (?:with|by|using)|billed|apple (?:account|id)|account|document|reference|confirmation|merchant|seller|tracking|reservation|your (?:order|basket) (?:number|no))\b[^|]{0,60}?[:#]|^(?:order|booking|transaction|receipt) (?:no\.?|number|id|ref(?:erence)?)\b|^order #|^#\d/i;
const HEADING = /^(?:shipping now|now shipping|on its way|shipped|items? shipped|in your parcel|track (?:package|parcel|order|delivery|your (?:order|parcel|package))|view (?:order|details|item|your order)|shop now|manage (?:your )?order|start a return|leave a review|buy again|your order|your items|order summary|order details|items? ordered|items? in (?:your|this) order|delivered items|substitutions?|substituted items|shipment \d+ of \d+[^|]*|in this (?:shipment|parcel|delivery)|summary|basket|bundle|app store|apple services|itunes store|apple books|apple arcade|description|items?|products?|qty|quantity|price|unit price|amount|each|cost|total|line total|item details|order|receipt|product details|size|colou?r|style|sku|article|options?|variant|total price|item price|qty\.?|units?)$/i;
const SKIP_START = /^(?:unavailable(?: items)?|missing items?|items? (?:not available|unavailable|we couldn(?:'|’)?t (?:find|deliver))|out of stock|sorry,? we couldn(?:'|’)?t|not (?:available|delivered))\b/i;
const SKIP_END = /^(?:substitutions?|substituted items|delivered items|your items|items delivered|shipment \d+)\b/i;
// Details under an item that are not extras: codes, sellers, delivery notes, links, a substitution's note.
const DETAIL = /^(?:(?:monthly|yearly|annual(?:ly)?|weekly|daily|one-off|lifetime)$|art\.?\s?no\b\.?|article(?: no\.?| number)?\b|item no\b\.?|item number\b|cat\.?\s?no\b\.?|catalogue number\b|product code\b|sku\b|style (?:no\.?|code)\b|ref\.|ref:|seller\s*:|sold by|condition\s*:|edition\s*:|format\s*:|dispatch(?:es|ed)?\b|delivered\b|arriving\b|arrives\b|estimated\b|in-app purchase|report a problem|write a review|buy again|view item|renews\b|auto-renew|instead of\b|substitute|\(substitut|\(substitute\)|was £|save £|you save|price per\b|£[\d.,]+\s*\/\s*(?:kg|100g|100ml|l|each|unit))/i;
const VARIANT = /^(?:colou?r|size|style|fit|length|width|waist|leg|flavou?r|scent|shade|strength|option|edition|storage|capacity)\s*:\s*\S/i;
const DATE_LINE = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?\d{1,2}(?:st|nd|rd|th)?[\s/.-]+(?:\d{1,2}|[a-z]{3,9})[\s/.,-]+\d{2,4}\b[^|]{0,20}$|^\d{4}-\d{2}-\d{2}$/i;
const GREETING = /^(?:hi|hello|hey|dear|thanks|thank you|thank-you|here is|here are|we(?:'|’)re|we have|we(?:'|’)ve|your (?:order|delivery|basket|tickets?|booking) (?:is|has|was|will)|here(?:'|’)s|enjoy|if you|you (?:sent|paid|can|will|have)|questions)\b/i;
const FULL_DATE = /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i;
const sentence = (c) => c.length > 80 || (c.split(/\s+/).length > 8 && /[.!?]$/.test(c)) || GREETING.test(c);

const letters = (c) => (String(c).match(/\p{L}/gu) || []).length;
const cleanName = (s) => String(s).replace(/\s*\.{3,}\s*$/, "").replace(/\s+/g, " ").replace(/^[•·*–-]\s+/, "").replace(/[\s|:–-]+$/, "").trim();

// One cell's text split into what it carries: "1 x Name ...... £6.99" -> qty 1, name, price.
function splitCell(raw) {
  let c = raw.replace(/\s*\((?:substitute|substitution|substituted)\)\s*$/i, "").trim();
  const out = { qty: null, prices: [], unit: null, unitQty: null };
  // "1 x Faux Fur Lined Slippers @ £24.00 = £24.00"
  let m = new RegExp("^(.*?\\S)\\s*@\\s*" + MONEY + "\\s*=\\s*" + MONEY + "$").exec(c);
  if (m) { out.unit = pence(m[2], m[3], m[4]); out.prices.push(pence(m[5], m[6], m[7])); c = m[1]; }
  else {
    // A price at the end of a name ("Prawn Crackers  £1.80", "Large Margherita ........ £11.99", "Wool jumper - Qty 1 - £59.00").
    m = new RegExp("^(.*?\\p{L}.*?)(?:\\s*(?:\\.{2,}|[-–:])\\s*|\\s+)([-−–])?" + MONEY + "$", "u").exec(c);
    if (m && !/[(+]\s*$/.test(m[1])) { if (!m[2]) out.prices.push(pence(m[3], m[4], m[5])); else out.negative = true; c = m[1]; }
  }
  // Quantity at the start: "1 x Name", "2x Name", "2 × Name"; a bare "1 Big Mac Meal" only on a line with its price.
  m = /^(\d{1,3})\s?[x×]\s+(\S.*)$/i.exec(c) || /^(\d{1,3})[x×](\p{L}.*)$/iu.exec(c);
  if (m) { out.qty = Number(m[1]); c = m[2]; out.head = true; }
  else if (out.prices.length && (m = /^(\d{1,2})\s+(\p{Lu}.*)$/u.exec(c)) && !/^(?:adults?|child(?:ren)?|items?|for|pack|people|nights?|days?|months?)\b/i.test(m[2])) { out.qty = Number(m[1]); c = m[2]; }
  // Quantity at the end: "Name x2", "Name × 1", "Name (x1)", "Name Qty: 2", "Name  2" (a column).
  m = /^(.*?\S)\s*\(\s?[x×]\s?(\d{1,3})\)$/i.exec(c) || /^(.*?\S)\s+[x×]\s?(\d{1,3})$/i.exec(c) || /^(.*?\S)\s*[-–|]?\s*(?:qty|quantity)\s*:?\s*(\d{1,3})\s*[-–]?$/i.exec(c) ||
    /^(.*?\S)\s{2,}(\d{1,3})$/.exec(c);
  if (m && out.qty == null) { out.untailed = cleanName(c); out.qty = Number(m[2]); c = m[1]; out.head = true; out.tail = true; }
  out.text = cleanName(c);
  return out;
}

// Each line of the text, as cells, read for what it is.
function readLine(raw) {
  const line = { indent: /^[ \t]{2,}\S/.test(raw), cells: [], names: [], extras: [], prices: [], qty: null, unit: null, notCharged: false, plus: false, end: false, noise: false, skipStart: false, skipEnd: false, variant: [], negative: false };
  const parts = raw.split("|").map((x) => x.replace(/\t/g, "  ").replace(/ {3,}/g, "  ").replace(/[\u00a0\r]/g, " ").trim());
  line.lead = parts.length > 1 && parts[0] === "" && parts.slice(1).some(Boolean);
  const cells = parts.filter(Boolean);
  line.cells = cells;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i], next = cells[i + 1];
    if (QTY_LABEL.test(c) && next && /^\d{1,3}$/.test(next)) { line.qty = Number(next); i++; continue; }
    if (PRICE_LABEL.test(c) && next && PRICE_CELL.test(next)) { const m = PRICE_CELL.exec(next); line.unitLabelled = pence(m[2], m[3], m[4]); i++; continue; }
    if (TOTAL_LABEL.test(c) && next && PRICE_CELL.test(next)) { const m = PRICE_CELL.exec(next); line.labelledTotal = pence(m[2], m[3], m[4]); line.endWord = true; i++; continue; }
    if (NAME_LABEL.test(c) && next && letters(next) >= 3 && !PRICE_CELL.test(next) && !HEADING.test(next)) { line.names.push(cleanName(next)); line.namedByLabel = true; i++; continue; }
    let m = PRICE_CELL.exec(c);
    if (m) { if (m[1]) line.negative = true; else { line.prices.push(pence(m[2], m[3], m[4])); if (LABEL_PRICE.test(c)) line.priceLabelled = true; } continue; }
    if ((m = UNIT_CELL.exec(c))) {
      if (m[1]) { line.qty = line.qty ?? Number(m[1]); line.unit = pence(m[2], m[3], m[4]); }
      else line.unit = m[5] != null ? pence(m[5], m[6], m[7]) : m[8] != null ? pence(m[8], m[9], m[10]) : pence(m[11], m[12], m[13]);
      continue;
    }
    if ((m = QTY_CELL.exec(c))) { line.qty = Number(m[1] || m[2] || m[3]); continue; }
    if (FREE_CELL.test(c) && line.names.length) { line.free = true; continue; }
    if (NOT_CHARGED.test(c) && line.names.length) { line.notCharged = true; continue; }
    // A money line ("Guide price | £112.99", "Delivery fee £2.49", "Subtotal" over its amount) ends the list. A thing whose
    // name starts with such a word ("Bag for Life | 1 | £0.50") doesn't: it has more than an amount beside it.
    if (i === 0 && END.test(c) && cells.slice(1).every((x) => PRICE_CELL.test(x) || FREE_CELL.test(x) || /^[-−–]\s?£/.test(x))) {
      const s = splitCell(c);
      if (cells.length > 1 || s.prices.length || s.negative || END.test(s.text) && s.text.length <= 40) { line.endWord = true; continue; }
    }
    if (i === 0 && SKIP_START.test(c)) line.skipStart = true;
    if (i === 0 && SKIP_END.test(c)) line.skipEnd = true;
    const s = splitCell(c);
    if (s.negative) line.negative = true;
    if (s.unit != null) line.unit = s.unit;
    if (s.qty != null && line.qty == null) line.qty = s.qty;
    if (s.head) line.head = true;
    line.prices.push(...s.prices);
    const t = s.text;
    if (!t) continue;
    if (/\s-\s(?:not charged|unavailable|out of stock)$/i.test(t) || /^not charged$/i.test(t)) { line.notCharged = true; continue; }
    if (DETAIL.test(t)) { line.details = true; continue; }
    if (VARIANT.test(t)) { line.variant.push(t); continue; }
    if (/^[+＋]$/.test(t)) { line.plus = true; continue; }
    if (/^[+＋]\s*/.test(t)) { line.plus = true; line.extras.push(t.replace(/^[+＋]\s*/, "")); continue; }
    if (letters(t) < 3) continue;           // a size column ("M", "UK 9"), a stray symbol
    if (/@|https?:|www\./i.test(t)) { line.noise = true; continue; }
    if (i === 0 && (LABELLED.test(t) || DATE_LINE.test(t) || sentence(t) || /:\s*$/.test(c) || /^(?:placed|ordered|order placed|booked)\s+on\b/i.test(t))) { line.noise = true; continue; }
    if (i === 0 && FULL_DATE.test(t) && t.length <= 60) { line.noise = true; continue; }
    if (HEADING.test(t)) { line.heading = true; continue; }
    if (!line.names.length && s.tail) line.nameRaw = s.untailed;
    line.names.push(t);
  }
  // A quantity in its own cell before the name ("1 | Medium Mighty Meaty®" with its extras and price on the next line).
  if (line.qty != null && line.names.length && !line.prices.length) line.head = true;
  return line;
}

const finish = (b) => {
  const name = b.name;
  if (!name || b.dropped) return null;
  const qty = b.qty || 1;
  const prices = b.prices.slice();
  let pricePence = null, lineTotal = true, ambiguous = false;
  if (b.lineFromLabel != null) pricePence = b.lineFromLabel;
  else if (prices.length >= 2) pricePence = prices[prices.length - 1];
  else if (prices.length === 1) { pricePence = prices[0]; if (qty > 1 && b.unit == null) ambiguous = true; }
  else if (b.unit != null) pricePence = b.unit * qty;
  else if (b.free) pricePence = 0;
  if (pricePence == null) return null;
  const variant = [...b.variant, ...b.extras].filter((x, i, a) => x && a.indexOf(x) === i).join(", ").slice(0, 160);
  return { name, qty, pricePence, lineTotal, ...(b.keepName ? { keepName: true } : {}), ...(ambiguous ? { ambiguous: true } : {}), ...(variant ? { variant } : {}), ...(b.extras.length ? { extras: b.extras.slice(0, 8) } : {}) };
};

// The item list in a receipt's text (an HTML part turned into text: table cells end with " | ", rows with a new line).
// opts.extraPrices: a price on its own line under an item's extras is that extra's own price, added to the item's (a meal
// deal's "+ Stuffed Crust £3.00"). Without it such a price is passed over. Both readings are tried; the totals check picks.
export function readItems(text, opts = {}) {
  const items = [];
  let pend = null, last = null, skip = false, wantExtra = false, qtyBefore = null;
  const emit = () => {
    // A name on one line and a price on another is only an item when something says so: how many, a size or colour, its
    // code, a labelled price, or a "+" extra. ("Some Shop" over "£5.00" is a heading and a total, not a purchase.)
    const sure = pend && (pend.head || pend.qty != null || pend.unit != null || pend.lineFromLabel != null || pend.variant.length || pend.detail || pend.labelled || pend.plus);
    if (pend && sure && pend.prices.length + (pend.unit != null ? 1 : 0) + (pend.lineFromLabel != null ? 1 : 0) > 0 && !pend.dropped) {
      const it = finish(pend);
      if (it) { items.push(it); last = { item: it, mode: "block" }; }
    }
    pend = null;
  };
  const newBlock = (l, name) => { const q = qtyBefore; qtyBefore = null; const b = block(l, name); if (q != null && b.qty == null) { b.qty = q; b.head = true; } return b; };
  const block = (l, name) => ({ lines: 1, labelled: Boolean(l.namedByLabel), name, nameRaw: l.nameRaw || null, qty: l.qty, unit: l.unit, prices: [], extras: [...l.extras, ...l.names.slice(1)], variant: [...l.variant], head: Boolean(l.head) });
  const raw = String(text || "").replace(/\r\n?/g, "\n").split("\n").filter((x) => x.trim() && !/^[\s|]+$/.test(x)).slice(0, 6000);
  const read = raw.map(readLine);
  const priceOnly = (x) => x && !x.names.length && x.prices.length > 0 && !x.endWord && !x.negative;
  for (let n = 0; n < read.length && items.length < 200; n++) {
    const l = read[n];
    // "1 Egg Fried Rice" with its price on the next line: the number is how many.
    if (l.names.length === 1 && !l.prices.length && l.qty == null && priceOnly(read[n + 1])) {
      const q = /^(\d{1,2})\s+(\p{Lu}.*)$/u.exec(l.names[0]);
      if (q && !/^(?:adults?|child(?:ren)?|items?|for|pack|people|nights?|days?|months?)\b/i.test(q[2])) { l.qty = Number(q[1]); l.names[0] = q[2]; l.head = true; }
    }
    const hasName = l.names.length > 0;
    // A price straight after an item's price, or its labelled line total ("Total | £53.00" under "Price | £5.30").
    if (pend && pend.prices.length && !hasName && !l.endWord && (l.prices.length || l.unit != null) && !l.negative) { pend.prices.push(...l.prices); if (l.unit != null) pend.unit = l.unit; continue; }
    if (pend && l.labelledTotal != null && !hasName && (pend.unit != null || pend.unitLabelled != null)) {
      const u = pend.unit ?? pend.unitLabelled;
      if ((pend.qty || 1) * u === l.labelledTotal) { pend.lineFromLabel = l.labelledTotal; pend.unit = u; emit(); continue; }
    }
    if (pend && pend.prices.length) emit();
    if (pend && pend.unitLabelled != null && !(l.labelledTotal != null)) { pend.prices.push(pend.unitLabelled); pend.unit = null; emit(); }
    if (l.endWord && !hasName && (items.length || last)) break;
    if (l.endWord && hasName && /^(?:sub-?\s?total|total|order total|delivery|shipping|postage|service|vat)\b/i.test(l.names[0]) && items.length) break;
    if (l.skipStart) { pend = null; skip = true; last = null; continue; }
    if (l.skipEnd) { skip = false; pend = null; last = null; continue; }
    if (skip) continue;
    if (l.noise && !hasName && !l.prices.length) { pend = null; last = null; continue; }
    if (l.heading && !hasName && !l.prices.length) { pend = null; continue; }
    if (l.notCharged) { pend = null; continue; }
    const priced = l.prices.length > 0 || (l.free && hasName);
    if (hasName && priced) {
      // An extra with the item's price on its line, under a name that gave its quantity ("1 x | Salt and Pepper Chips" then
      // "+ Large | £4.20"; "Fig & Cassis Candle × 2" then "Large / 300g | £44.00").
      if (pend && pend.head && !pend.prices.length && l.qty == null && !l.head) {
        pend.extras.push(...l.names); pend.prices.push(...l.prices); if (l.unit != null) pend.unit = l.unit; pend.variant.push(...l.variant);
        continue;
      }
      pend = null;
      const b = newBlock(l, l.names[0]);
      b.prices = l.prices.slice(); if (l.free) b.free = true;
      if (!l.negative) { const it = finish(b); if (it) { items.push(it); last = { item: it, mode: "row" }; } }
      continue;
    }
    if (!hasName && priced && !pend && last && last.extraAt === n - 1 && opts.extraPrices && l.qty == null) { last.item.pricePence += l.prices[l.prices.length - 1]; continue; }
    if (!hasName && priced) {
      if (pend && pend.name) { pend.prices.push(...l.prices); if (l.qty != null) pend.qty = l.qty; if (l.unit != null) pend.unit = l.unit; pend.extras.push(...l.extras); if (l.details) pend.detail = true; if (l.priceLabelled) pend.labelled = true; if (l.plus) pend.plus = true; continue; }
      continue;
    }
    if (!hasName && l.unitLabelled != null) { if (pend && pend.name) pend.unitLabelled = l.unitLabelled; continue; }
    if (!hasName && (l.qty != null || l.unit != null)) {
      if (pend && pend.name) {
        // "Tempered Glass Screen Protector x2" over "Quantity: 2": the name's "x2" is part of its name (a 2-pack).
        if (l.qty != null && pend.nameRaw) { pend.name = pend.nameRaw; pend.nameRaw = null; pend.keepName = true; }
        if (l.qty != null) pend.qty = l.qty; if (l.unit != null) pend.unit = l.unit; pend.extras.push(...l.extras); pend.variant.push(...l.variant);
      }
      else if (last && last.mode === "row" && l.qty != null && !last.qtySet && !l.extras.length) { last.item.qty = l.qty; last.qtySet = true; if (last.item.qty > 1) last.item.ambiguous = true; }
      // A quantity on a line of its own before the name ("1", then "| Pork Burrito", then "| £9.45").
      else if (l.qty != null && l.unit == null && l.cells.length === 1) { qtyBefore = l.qty; continue; }
      continue;
    }
    if (!hasName) {
      // Only extras, details or a variant on this line (or a lone "+": the next line is an extra).
      if (l.plus && !l.extras.length) { wantExtra = true; if (last && !pend) last.extraAt = n; continue; }
      if (l.details && pend) pend.detail = true;
      if (l.extras.length) { if (pend) { pend.extras.push(...l.extras); if (l.plus) pend.plus = true; } else if (last) { addExtras(last.item, l.extras); last.extraAt = n; } }
      if (l.variant.length && pend) pend.variant.push(...l.variant);
      continue;
    }
    // A line with a name and no price.
    // "1 x 074897 / Size US 8 (UK 12-14)" under "Trail Jacket": how many, and the code and size, of the item above.
    if (l.head && pend && pend.name && !pend.prices.length && pend.qty == null && /^\d{3,}\b|\bsize\b|^[^/]{1,30}\s\/\s/i.test(l.names[0])) { pend.qty = l.qty; pend.variant.push(l.names[0]); continue; }
    if (l.head) { pend = newBlock(l, l.names[0]); continue; }
    // A line set in from the item above (an empty first cell, spaces, a "+") is part of it: its extras, or a meal deal's
    // parts. Unless it starts an item of its own: a quantity, size or code follows it before any price (Amazon's rows start
    // with the photo's cell).
    if ((l.lead || l.indent || l.plus || wantExtra) && !pend && last && qtyBefore == null && (last.mode === "row" || l.plus || wantExtra || !startsItem(n))) { addExtras(last.item, l.names); last.extraAt = n; wantExtra = false; continue; }
    wantExtra = false;
    // A name over two lines ("Define Jacket", then its fabric "Nulu"): one capitalised word straight under a name that gave
    // no quantity and has nothing else under it yet.
    if (pend && !pend.prices.length && !pend.head && pend.qty == null && !pend.extras.length && !pend.variant.length && pend.lines === 1 &&
        l.names.length === 1 && /^\p{Lu}[\p{Ll}]{2,15}$/u.test(l.names[0]) && !l.plus && !l.lead && !l.indent) { pend.name += " " + l.names[0]; pend.lines++; continue; }
    if (pend && !pend.prices.length) { pend.extras.push(...l.names); pend.variant.push(...l.variant); if (l.qty != null) pend.qty = l.qty; if (l.details) pend.detail = true; if (l.plus) pend.plus = true; pend.lines++; continue; }
    pend = newBlock(l, l.names[0]);
    last = null;
  }
  emit();
  // A free carrier bag on a shop's till receipt ("NON CHARGEABLE LRG SHOPPER £0.00") is not a thing bought.
  return items.filter((i) => !(i.pricePence === 0 && /\b(?:non[- ]?chargeable|carrier bag|shopper|bag for life|paper bag)\b/i.test(i.name)));
  // Does the line at n begin an item of its own? A quantity, a size or colour, or a product code comes before any price.
  function startsItem(n) {
    for (let k = n + 1; k < Math.min(read.length, n + 8); k++) {
      const x = read[k];
      if (x.endWord || x.noise || x.head || (x.names.length && x.prices.length)) return false;
      if (x.qty != null || x.unit != null || x.variant.length || x.details) return true;
      if (x.prices.length) return false;
    }
    return false;
  }
}
function addExtras(item, extras) {
  item.extras = [...(item.extras || []), ...extras].slice(0, 8);
  item.variant = [item.variant, ...extras].filter(Boolean).join(", ").slice(0, 160);
}

// ---- What the email says the items came to ---------------------------------------------------------------------------------
const SUBTOTAL_LABEL = /^(?:sub-?\s?total|items? (?:sub-?)?total|item\(s\) subtotal|items?|products?(?: total)?|goods total|total of items|order value|basket total|merchandise(?: total)?|guide price|item total)\b/i;
const FEE_LABEL = /\b(?:delivery|shipping|postage|p\s?&\s?p|service|bag|carrier bags?|booking|small order|basket charge|minimum basket|packaging|installation|surcharge|buyer protection|click\s?&\s?collect|collection|gift ?wrap\w*|card fee|admin fee|fast track)\b/i;
const TIP_LABEL = /\btip\b|\bgratuity\b/i;
const DISCOUNT_LABEL = /\b(?:discount|voucher|promo\w*|offers?|savings?|saved|credit|coupon|deal|3 for 2|multi-?buy|rollback|clubcard|nectar|subscribe\s?&\s?save|member|adiclub|reward)\b/i;
const NOT_MONEY_LINE = /\b(?:vat|tax|paid today|next payment|instal+ment|pay in \d|due\b|was\b|rrp)\b/i;
export function moneyOf(text) {
  const out = { subtotal: null, fees: 0, tips: 0, discounts: 0, found: [] };
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").map((x) => x.replace(/\s+/g, " ").trim());
  const amountOf = (s) => { const m = new RegExp("^([-−–])?\\s?" + MONEY + "\\s*\\*?$", "i").exec(s.trim()); return m ? { p: pence(m[2], m[3], m[4]), neg: Boolean(m[1]) } : /^(?:free|£0\.00)$/i.test(s.trim()) ? { p: 0, neg: false } : null; };
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split("|").map((x) => x.trim()).filter(Boolean);
    let label = null, amt = null;
    if (cells.length === 2 && !amountOf(cells[0])) { label = cells[0]; amt = amountOf(cells[1]); }
    else if (cells.length === 1) {
      const m = new RegExp("^(.*?\\p{L}.*?)[\\s:]+((?:[-−–]\\s?)?" + MONEY + "|free)$", "iu").exec(cells[0]);
      if (m) { label = m[1]; amt = amountOf(m[2]); }
      else if (/\p{L}/u.test(cells[0]) && cells[0].length <= 40 && lines[i + 1] && amountOf(lines[i + 1].replace(/\|/g, "").trim())) { label = cells[0]; amt = amountOf(lines[i + 1].replace(/\|/g, "").trim()); }
    }
    if (!label || !amt) continue;
    label = label.replace(/[:*]+$/, "").trim();
    if (NOT_MONEY_LINE.test(label) || label.length > 50) continue;
    const key = label.toLowerCase() + "=" + amt.p;
    if (seen.has(key)) continue;
    seen.add(key);
    if (/\btotal\b/i.test(label) && !SUBTOTAL_LABEL.test(label)) continue;
    if (SUBTOTAL_LABEL.test(label)) { if (out.subtotal == null) out.subtotal = amt.p; continue; }
    if (TIP_LABEL.test(label)) { out.tips += amt.p; out.found.push(["tip", label, amt.p]); continue; }
    if (amt.neg || DISCOUNT_LABEL.test(label)) { out.discounts += amt.p; out.found.push(["discount", label, amt.p]); continue; }
    if (FEE_LABEL.test(label)) { out.fees += amt.p; out.found.push(["fee", label, amt.p]); continue; }
  }
  return out;
}

// What a line cost: the price for the line, or the unit price times how many.
export const lineOf = (i) => (i.pricePence == null ? null : i.lineTotal ? i.pricePence : i.pricePence * (i.qty || 1));

// The totals check. { complete: true|false|null, itemsPence, expectedPence, missingPence }. complete is null when the email
// gives nothing to compare with; false when no items were read, when an item has no price, or when they don't add up.
export function checkItems(items, money, totalPence) {
  const list = Array.isArray(items) ? items : [];
  const m = money || {};
  const S = m.subtotal ?? null, T = totalPence ?? null;
  const targets = [];
  if (S != null) targets.push(S, S + (m.discounts || 0), S - (m.discounts || 0));
  if (T != null) targets.push(T - (m.fees || 0) - (m.tips || 0) + (m.discounts || 0), T - (m.fees || 0) - (m.tips || 0), T);
  const expectedPence = S ?? (T != null ? T - (m.fees || 0) - (m.tips || 0) + (m.discounts || 0) : null);
  const unpriced = list.some((i) => i.pricePence == null);
  const itemsPence = list.reduce((n, i) => n + (lineOf(i) || 0), 0);
  if (!targets.length) return { complete: null, itemsPence, expectedPence: null, missingPence: null };
  if (!list.length) return { complete: false, itemsPence: 0, expectedPence, missingPence: expectedPence };
  const hit = !unpriced && targets.some((t) => Math.abs(t - itemsPence) <= 1);
  return { complete: hit, itemsPence, expectedPence, missingPence: hit ? 0 : expectedPence == null ? null : expectedPence - itemsPence };
}

// An item with a quantity over one and a single price could be priced for the line or for one: whichever reading makes
// the items add up is taken (all such items read the same way); the line reading when neither does.
export function settleItems(items, money, totalPence) {
  const amb = items.some((i) => i.ambiguous);
  const strip = (i) => { const { ambiguous, ...rest } = i; return rest; };
  const asLine = items.map(strip);
  if (!amb) return { items: asLine, check: checkItems(asLine, money, totalPence) };
  const asUnit = items.map((i) => (i.ambiguous ? { ...strip(i), lineTotal: false } : strip(i)));
  const a = checkItems(asLine, money, totalPence), b = checkItems(asUnit, money, totalPence);
  return b.complete && !a.complete ? { items: asUnit, check: b } : { items: asLine, check: a };
}

// How many items the email says the order has ("Your order of 3 items", "(5 items)"), when it says.
export function statedItemCount(text) {
  const t = String(text || "").slice(0, 20000);
  const m = t.match(/\b(?:order|basket|bag|parcel|purchase|delivery)\s+(?:of|contains|with|has)\s+(\d{1,3})\s+items?\b/i) || t.match(/\((\d{1,3})\s+items?\)/i) || t.match(/^[\s|]*(\d{1,3})\s+items?[\s|]*$/im);
  const n = m ? Number(m[1]) : null;
  return n && n > 0 && n < 500 ? n : null;
}
