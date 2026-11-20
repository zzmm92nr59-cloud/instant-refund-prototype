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
//
// Round 2 (19 Nov 2026), from 44 layouts written before the fixes for them (scripts/fixtures/receipt-emails/holdout3.mjs,
// holdout4.mjs): amounts in euros and dollars read like pounds; whole-pound prices ("£165"); "Price: Free" and "- FREE";
// "Qty 2 @ £15.00" and "£65.00 each = £130.00"; a unit price before the line's price in plain-text columns; "Was … Now …"
// in one cell; "Plan: …" names; colours on a line of their own; "(replaced …)" left out of names; parts listed under a
// one-row item (a deal's pizzas, a drink's options) are its extras; fees named as fees ("Cleaning fee", "City tax") and
// money rows ("Box price") are never items. The check also says "may have missed some" when an item's unit price times
// how many isn't its line's price, when a money line was read as an item, and (receipt-parser.js) when the email says how
// many items it has and the reading has a different number.
//
// Round 3 (19 Nov 2026), from 59 more layouts written before the fixes for them (holdout5.mjs, holdout6.mjs): tables read by
// their column headings in any order (byColumns); prices printed above their names tried as another reading (priceAbove);
// weighed and metered lines ("0.92 kg @ £0.84/kg"); barcodes, part numbers, release dates and formats ("eBook", "Platform:
// Steam") as details; "Oatmeal · Qty 1"; "2 @ £1.55  £3.10"; "(6 @ £0.40)"; the price before the name; "— £18.00 (x2)";
// Welsh and English labels; "You received: …"; a deal's parts at £0.00; levies, carriers and removal charges as fees. When
// the email gives a subtotal, the items must come to it (or the total less fees plus discounts), never to the bare total.

const MONEY = "£\\s?(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{2})|\\s(\\d{2}))";
// (A cell that is only an amount can be in whole pounds, "£165", as some shops print them.)
const MONEY_WHOLE = "£\\s?(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{2})|\\s(\\d{2}))?";
const pence = (pounds, p1, p2) => Number(String(pounds).replace(/,/g, "")) * 100 + Number(p1 || p2 || 0);
// A cell that is only an amount: "£6.99", "-£3.00", "£ 12 99" (Amazon prints pounds and pence apart), "Item price: £35.00".
const PRICE_CELL = new RegExp("^(?:(?:item\\s+)?price\\s*:?\\s*|amount\\s*:?\\s*)?([-−–])?\\s?" + MONEY_WHOLE + "\\s*\\*?$", "i");
const LABEL_PRICE = /^(?:item\s+)?price\s*:/i;
const FREE_CELL = /^(?:(?:item\s+)?price\s*:?\s*)?(?:free|£0(?:\.00)?|redeemed|reward redeemed)$/i;
// Colours on a line of their own under an item's name ("Black", "Navy / White") are what it looks like, not an item.
// A charge named as one ("Cleaning fee", "Airbnb service fee", "City tax"), never a thing bought.
const FEE_NAME = /^(?:[\p{L}'’&. -]{0,30}\s)?(?:fees?|surcharge|levy)\s*:?$|^(?:city|tourist|local|resort|accommodation) tax\s*:?$/iu;
// A stay's or a booking's price worked out ("£85.00 x 3 nights") is a detail of what was booked, not its name.
const PER_NIGHT = /^£\s?[\d,]+(?:\.\d{2})?\s*[x×]\s*\d{1,3}\s+(?:nights?|days?|weeks?|months?|guests?|people|persons?|adults?|children|rooms?)$/i;
// (Round 3: the colours clothes and homeware shops print on a line of their own, "Rust", "Ecru", "Oatmeal", "Sage".)
const COLOUR = "(?:black|white|grey|gray|navy|blue|red|green|pink|beige|brown|cream|ivory|khaki|silver|gold|purple|yellow|orange|charcoal|olive|burgundy|camel|multi(?:colou?r)?|light grey|dark grey|light blue|dark blue|rust|ecru|oatmeal|sage|terracotta|mustard|teal|coral|mint|lilac|taupe|stone|sand|natural|indigo|denim|plum|wine|rose|blush|nude|tan|mocha|chocolate|slate|ochre|forest green|emerald|bottle green|aqua|turquoise|lavender|peach|mauve|champagne|bronze|copper|clear|transparent|oat|off white|off-white)";
// What a product is sold as, on a line of its own beside its price: a format, a platform, a kind of ticket (round 3).
const FORMAT_LINE = /^(?:e-?book|audiobook|audio book|paperback|hardback|hardcover|kindle edition|digital(?: download| code| edition| key)?|download|dvd|blu-?ray|4k ultra hd|cd|vinyl|lp|steam|pc|mac|ps[45]|playstation [45]|xbox(?: series [xs]| one)?|nintendo switch(?: 2)?|e-?ticket|mobile ticket|print at home)$/i;
// A weighed or measured line ("0.92 kg @ £0.84/kg", "38.42 L @ 142.9p/L"): how much, at what rate. A detail, never a name.
const MEASURE = "\\d+(?:\\.\\d+)?\\s?(?:kg|g|l|ltr|litres?|m)\\s*@\\s*(?:£\\s?\\d+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?p)\\s*\\/\\s*(?:kg|g|l|ltr|litre|m)";
// An English label after its Welsh (or other) twin, "Nifer / Qty: 1", "Cyfanswm / Total £115.50": read as the English one.
const BILINGUAL = /(^|\|\s*)[\p{L}'’-]{2,20}(?:[ -][\p{L}'’-]{2,20}){0,2}\s?\/\s?(?=(?:qty|quantity|sub-?\s?total|total|postage|delivery|shipping|price|order(?: number| date)?|date|vat|discount|item|product)\b)/gimu;
// ("£ 13.5", a shop's price written with one figure of pence: £13.50. Round 15.)
// ("No Choice" over "1" with no price under it: a till's empty choice for the item above, not a thing bought. Round 15.)
const EMPTY_CHOICE = /^[ \t|]*(?:no choice|no selection|no thanks|none selected|no extras?|no options?)[ \t|]*\n(?:[ \t|]*\n){0,3}[ \t|]*\d{1,2}[ \t|]*$/gim;
export const prepText = (text) => inPoundSigns(text).replace(EMPTY_CHOICE, "").replace(BILINGUAL, "$1").replace(/£([ \t]?)(\d{1,6})\.(\d)(?=[ \t]*(?:\||$))/gm, "£$1$2.$30");
const COLOUR_LINE = new RegExp("^" + COLOUR + "(?:\\s?[/&,]\\s?" + COLOUR + ")*$", "i");
// Receipts in euros or dollars read the same way: their amounts are read as they are written (never converted; the
// receipt's currency comes from its total, receipt-parser.js). Only for an email with no pound amounts at all.
export function inPoundSigns(text) {
  let t = String(text || "");
  // (Pounds only in brackets beside dollars, "VAT $10.00 (£7.38)", are left out: the receipt is in dollars. Round 11.)
  if (/£/.test(t) && !/£/.test(t.replace(/\(\s*£\s?[\d,]+(?:\.\d{2})?\s*\)/g, "")) && /\$\s?\d/.test(t)) t = t.replace(/\(\s*£\s?[\d,]+(?:\.\d{2})?\s*\)/g, "");
  if (/£/.test(t)) return t;
  return t.replace(/(?:US\s?\$|CA\$|AU?\$|€|\$)\s?(?=\d)/g, "£").replace(/(?<![\d.,])(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\s?(?:€|EUR\b)/g, "£$1.$2")
    // ("39,95 €", "1.299,00 €": the comma is the decimal point.)
    .replace(/(?<![\d.,])(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s?(?:€|EUR\b)/g, (m, a, b) => "£" + a.replace(/\./g, "") + "." + b);
}
// Words in brackets that say what a substitute replaced ("Branston Beans (replaced Heinz Beans 415g)") are not its name.
const REPLACED = /\s*\((?:replaced|replacing|replaces|instead of|substitut\w*(?: for)?|swapped for|in place of)\b[^)]{0,120}\)/gi;
const NOT_CHARGED = /\bnot charged\b|\bno charge\b|\bunavailable\b|\bout of stock\b/i;
// Quantities on their own: "2", "x2", "2 x", "Qty: 2", "Quantity 2", "Units: 2", "2 units", "5 sleeves (50 capsules)".
const QTY_CELL = /^(?:(?:qty|quantity|units?|x|×)\s*[:.]?\s*(\d{1,3})|(\d{1,3})\s*(?:x|×)?|(\d{1,3})\s+(?:units?|sleeves?|pcs|pieces|packs?)\b[^£]{0,30})$/i;
// A unit price, with or without how many: "£68.00 each", "1 x £1.65", "2 × £50.00", "@ £24.00", "Unit price: £5.30".
// ("PPU: £ 14.66", price per unit, round 11.)
const UNIT_CELL = new RegExp("^(?:(\\d{1,3})\\s?[x×]\\s?" + MONEY + "|" + MONEY + "\\s*(?:each|ea\\.?|per item|/\\s?unit)|@\\s?" + MONEY + "|(?:unit\\s+price|ppu|price per unit)\\s*:?\\s*" + MONEY + ")$", "i");
// "£14.99 x 2": what each cost, then how many, and no line price (round 8).
const UNIT_TIMES = new RegExp("^" + MONEY + "\\s?[x×]\\s?(\\d{1,3})$", "i");
// Labels that name the value in the next cell.
const QTY_LABEL = /^(?:qty|quantity|units?)\s*:?$/i, PRICE_LABEL = /^(?:price|unit price|item price|each)\s*:?$/i, TOTAL_LABEL = /^(?:total|line total|item total)\s*:?$/i;
const NAME_LABEL = /^(?:plan|product|item|description|subscription)\s*:?$/i;

// Where the item list ends: subtotals, fees, discounts, tips, payment. (Only once an item has been read: some emails put
// their total at the top.)
const END = /^(?:retail price\b|sub-?\s?total|subtotal|order sub-?\s?total|items? sub-?\s?total|item\(s\) total|(?:order |grand |basket |estimated |trolley |items? |products? |goods |today(?:'|’)?s |your |net |bill |check )?total\b|trolley cost\b|total of items|item\(s\) subtotal|guide price|order value|items|products|(?:(?:order|standard|express|home|next[- ]day|premium|tracked) )?delivery\b|delivery\/shipping|shipping\b|postage\b|p\s?&\s?p\b|service\b|bag\b|bag (?:fee|charge|levy)|carrier bags?\b|small order|basket charge|minimum basket|booking fee|vat\b|tax\b|discount|voucher|promo|promotion|offers?\b|offer savings|multi-?buy|savings?\b|you(?:'|’)?ve saved|you saved|credit\b|credit applied|(?:rider |driver |courier )?tip\b|gratuity|payment\b|payments\b|paid\b|amount (?:paid|due)|total paid|nectar|clubcard|more card|mywaitrose|rollback|member offer|adiclub|subscribe\s?&\s?save|3 for 2|deal\b|buyer protection|click\s?&\s?collect|fast track|installation|collect in store|store delivery|delivery to store|standard delivery|express delivery|airport surcharge|shop discount|includes vat|including vat|incl\.? vat|tickets?\s*:?(?=\s*(?:£|$))|royal mail\b|parcelforce\b|evri\b|(?:1st|2nd|first|second) class\b|tracked (?:24|48)\b|removal of\b|(?:city|visitor|tourist) (?:levy|tax)\b)/i;
// Lines that are never part of an item: greetings, sentences, order details, dates, column and section headings.
const LABELLED = /^(?:from|to|sent|subject|cc)\s*:|^(?:order|date|placed|ordered|booking|booked|transaction|receipt|invoice|deliver(?:y|ing)? (?:to|address|on|by)|delivering|collect(?:ion)? (?:from|on)|payment method|paid (?:with|by|using)|billed|apple (?:account|id)|account|document|reference|confirmation|merchant|seller|tracking|reservation|your (?:order|basket) (?:number|no))\b[^|]{0,60}?[:#]|^(?:order|booking|transaction|receipt) (?:no\.?|number|id|ref(?:erence)?)\b|^order #|^#\d|^(?:order|transaction|receipt|invoice|booking|ref(?:erence)?)\s+(?:no\.?\s*|number\s*)?#?\d[\d -]{2,}$/i;
const HEADING = /^(?:shipping now|now shipping|on its way|shipped|items? shipped|in your parcel|track (?:package|parcel|order|delivery|your (?:order|parcel|package))|view (?:order|details|item|your order)|(?:download|view|print|redeem|activate|get) (?:your |my )?(?:e-?vouchers?|e-?tickets?|tickets?|vouchers?|gift ?cards?|receipt|invoice)|view or edit (?:your )?order|shop now|manage (?:your )?order|start a return|leave a review|buy again|your order|your items|(?:your )?order summary|order details|(?:items?|products?) ordered|items? in (?:your|this) order|delivered items|substitutions?|substituted items|(?:shipment|delivery|parcel|package) \d+ of \d+[^|]*|in this (?:shipment|parcel|delivery)|summary|basket|bundle|app store|apple services|itunes store|apple books|apple arcade|description|items?|products?|qty|quantity|price|unit price|amount|each|cost|total|line total|item details?|item cost|order|receipt|other costs|fare details|restaurant|table|venue|check number|\d{1,3} items?|product details|size|colou?r|style|sku|article|options?|variant|total price|item price|qty\.?|units?|(?:shipping|billing|delivery|invoice|postal) (?:address|details)|deliver(?:ed|ing)? to|ship(?:ped|ping)? to)$/i;
const SKIP_START = /^(?:unavailable(?: items)?|missing items?|items? (?:not available|unavailable|we couldn(?:'|’)?t (?:find|deliver))|out of stock|sorry,? we couldn(?:'|’)?t|not (?:available|delivered))\b/i;
const SKIP_END = /^(?:substitutions?|substituted items|delivered items|your items|items delivered|shipment \d+)\b/i;
// Details under an item that are not extras: codes, sellers, delivery notes, links, a substitution's note.
// ("When ordering on the McDonald's app" under a deal's name is the deal's condition. Round 15.)
// (Round 3: barcodes and part numbers, "EAN: 4977961000000", "MPN: …"; a pre-order's release date; stock notes.)
const DETAIL = /^(?:when ordering (?:on|via|through|in|with) (?:the )?[^|£\n]{2,30}? app\b|ticket (?:number|no\.?|holder|id)\s*:|(?:monthly|yearly|annual(?:ly)?|weekly|daily|one-off|lifetime)$|(?:ean|upc|gtin|isbn(?:-1[03])?|mpn|barcode|part (?:no\.?|number)|model (?:no\.?|number)|item code|code)\s*[:#]|\d{8,14}$|release(?:s|d)?\b|releasing\b|available (?:from|on)\b|pre-?order\b|in stock\b|back in stock\b|out on\b|expected (?:dispatch|delivery|on|by)\b|ships? (?:on|by|from|in)\b|art\.?\s?no\b\.?|article(?: no\.?| number)?\b|item no\b\.?|item number\b|cat\.?\s?no\b\.?|catalogue number\b|product code\b|sku\b|style (?:no\.?|code)\b|style\s*#|ref\.|ref:|seller\s*:|sold by|condition\s*:|edition\s*:|format\s*:|dispatch(?:es|ed)?\b|delivered\b|arriving\b|arrives\b|estimated\b|in-app purchase|report a problem|write a review|buy again|view item|renews\b|auto-renew|instead of\b|(?:no )?substitutions? (?:allowed|not allowed)\b|substitute|\(substitut|\(substitute\)|was £|save £|you save|price per\b|(?:clubcard|nectar|my morrisons|mywaitrose|member|rollback|lower)\s+price\b|rollback$|age[- ]restricted\b|over 18s?\b|(?:id|proof of age) (?:may|will|might) be (?:checked|required|asked for)|picked weight\b|estimated weight\b|replac(?:ed|es|ing)\b(?!\s*(?:with|by)\b)|£[\d.,]+\s*\/\s*(?:kg|100g|100ml|l|each|unit))/i;
// (Or the size, the fit and how many set apart by slashes, "Waist 36"/91.5cm 30" Leg Trouser / Slim fit / Qty 1",
// "16 1/2 Col 35 Sleeve Single Cuff / Slim fit / Qty 1": a size line, never the item's name. Round 12.)
const VARIANT = /^[^|£]{2,70}\s\/\s[^|£/]{0,30}\bfit\s*(?:\/\s*(?:(?:qty|quantity)\s*:?\s*\d{1,3}\s*)?)?$|^(?:colou?r|(?:pack |uk |eu |us )?size|style|fit|length|width|waist|leg|flavou?r|scent|shade|strength|option|edition|storage|capacity|platform|format|pack|dosage|region|language|dimensions|finish|material|frame|lens(?:es)?|ticket type|seat(?:ing)?|block|row|area|section)\s*:\s*\S/i;
const WHO_FOR = /^\d{1,3}\s*[x×]\s*(?:adults?|child(?:ren)?|kids?|games?|people|persons?|guests?|players?|seniors?|students?|infants?)$/i;
// (Month first too, "Jul 30, 2025 10:36 pm": an order's date, never an item's name. Round 11.)
const DATE_LINE = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?\d{1,2}(?:st|nd|rd|th)?[\s/.-]+(?:\d{1,2}|[a-z]{3,9})[\s/.,-]+\d{2,4}\b[^|]{0,20}$|^\d{4}-\d{2}-\d{2}$|^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b[^|]{0,20}$/i;
const GREETING = /^(?:for (?:full|more) (?:ingredients|information|details|nutritional)|hi|hello|hey|dear|thanks|thank you|thank-you|here is|here are|we(?:'|’)re|we have|we(?:'|’)ve|your (?:order|delivery|basket|tickets?|booking) (?:is|has|was|will)|here(?:'|’)s|enjoy|if you|you (?:sent|paid|can|will|have)|questions)\b/i;
// A subscription's period on a line of its own ("Oct 26–Nov 26, 2026", "26 Oct – 26 Nov 2026"): when, never what. Round 10.
const DATE_RANGE = /^(?:[a-z]{3,9}\.? \d{1,2}|\d{1,2} [a-z]{3,9})(?:,? \d{4})?\s*[–—-]\s*(?:[a-z]{3,9}\.? \d{1,2}|\d{1,2} [a-z]{3,9}),? \d{4}$/i;
const FULL_DATE = /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i;
const HARD_END = /^(?:retail price\b|sub-?\s?total|subtotal|items? sub-?\s?total|item\(s\) total|(?:order |grand |basket |estimated |trolley |items? |products? |goods |net |bill |check )?total\b|trolley cost\b|total of items|item\(s\) subtotal|guide price|order value|items$|products$|payment|payments|paid\b|amount (?:paid|due)|total paid|includes vat|including vat|incl\.? vat|vat\b|v\.a\.t\b|tax\b)/i;
// (A supermarket's own long product names, "Glade Twinkling Apple & Cinnamon Festive Bathroom Air Freshener Gel, Limited
// Edition 180g", run past 80 letters without being sentences: only a long line that reads as one, or one far longer, is.
// Round 10.)
const sentence = (c) => c.length > 130 || (c.length > 80 && (/[.!?]$/.test(c) || /\b(?:you|your|we|our|please|will|can|is|are)\b/i.test(c))) || (c.split(/\s+/).length > 8 && /[.!?]$/.test(c)) || GREETING.test(c);

const letters = (c) => (String(c).match(/\p{L}/gu) || []).length;
// (" (incl. VAT)" after a name says its price includes VAT: not part of the name. Round 12.)
const cleanName = (s) => String(s).replace(/\s*\((?:incl?\.?|including|inc\.?)\s*vat\)\s*$/i, "").replace(/\s*\u2502\s*/g, " | ").replace(/\s*\.{3,}\s*$/, "").replace(/\s+/g, " ").replace(/^[•·*–-]\s+/, "").replace(/[\s|:–-]+$/, "").trim();

// One cell's text split into what it carries: "1 x Name ...... £6.99" -> qty 1, name, price.
function splitCell(raw) {
  let c = raw.replace(/\s*\((?:substitute|substitution|substituted)\)\s*$/i, "").replace(REPLACED, "").trim();
  const out = { qty: null, prices: [], unit: null, unitQty: null };
  // "1 x Faux Fur Lined Slippers @ £24.00 = £24.00"
  // ("Bamboo Whisk — £18.00 (x2)": how many after the price.)
  let m = new RegExp("^(.*\\S)\\s*\\(\\s*[x×]\\s?(\\d{1,3})\\s*\\)$", "i").exec(c);
  if (m && new RegExp(MONEY + "$").test(m[1])) { out.qty = Number(m[2]); out.head = true; c = m[1]; }
  m = new RegExp("^(.*?\\S)\\s*(?:@\\s*" + MONEY + "|" + MONEY + "\\s*each)\\s*=\\s*" + MONEY + "$", "i").exec(c);
  if (m) { out.unit = m[2] != null ? pence(m[2], m[3], m[4]) : pence(m[5], m[6], m[7]); out.prices.push(pence(m[8], m[9], m[10])); c = m[1]; }
  else {
    // A price at the end of a name ("Prawn Crackers  £1.80", "Large Margherita ........ £11.99", "Wool jumper - Qty 1 - £59.00").
    m = new RegExp("^([^\\p{L}\\n\\r\\u2028\\u2029]*\\p{L}.*?)(?:\\s*(?:\\.{2,}|[-–—:])\\s*|\\s+)([-−–])?" + MONEY + "$", "u").exec(c);
    // (Not a deal's own name that ends with its price, "Any 2 Pre Mixed Cans for £8.00": the price is part of the name.
    // Round 11.)
    if (m && !/[(+]\s*$/.test(m[1]) && !/\b(?:for|of|at|from|only|just|under|over)$/i.test(m[1].trim())) {
      // ("Sparks offer -£2.00": the dash against the pound sign is money off, even where a dash could also separate.)
      const neg = Boolean(m[2]) || /[-−–]\s?£\s?[\d,.\s]+$/.test(c) && !/\s[-–]\s+£/.test(c);
      if (!neg) out.prices.push(pence(m[3], m[4], m[5])); else out.negative = true; c = m[1];
      // How many at what each before the line's price ("2 x £45.00   £90.00"), or only how many ("Qty: 1   £79.99").
      const qa = !neg && new RegExp("^(\\d{1,3})\\s*[@x×]\\s*" + MONEY + "(?:\\s*each)?$", "i").exec(c);
      if (qa) { out.qty = Number(qa[1]); out.unit = pence(qa[2], qa[3], qa[4]); c = ""; }
      const qo = !neg && /^(?:qty|quantity|units?)\s*[:.]?\s*(\d{1,3})$/i.exec(c);
      if (qo) { out.qty = Number(qo[1]); c = ""; }
      // A unit price before the line's price in the same column of text ("Timber 2.4m    £4.25    £12.75").
      const u = !neg && new RegExp("^([^\\p{L}\\n\\r\\u2028\\u2029]*\\p{L}.*?)\\s+" + MONEY + "(?:\\s*(?:each|ea\\.?))?$", "u").exec(c);
      if (u && /\p{L}{2}/u.test(u[1])) { out.unit = pence(u[2], u[3], u[4]); c = u[1]; }
    }
  }
  // The price first, then the name ("£7.50   Oat Bars Chocolate Chip x3").
  if (!out.prices.length && !out.negative && (m = new RegExp("^" + MONEY + "\\s+(?!(?:off|each|per|x|for|with|saved?|saving|discount|now|was|ea)\\b)(\\S.*\\p{L}.*)$", "iu").exec(c))) {
    out.prices.push(pence(m[1], m[2], m[3])); c = m[4];
  }
  // How many at what each in brackets in the name: "Braeburn Apples (6 @ £0.40)", "Carrots (2 x £1.35 each)".
  m = new RegExp("^(.*?\\S)\\s*\\((\\d{1,3})\\s*[@x×]\\s*" + MONEY + "(?:\\s*each)?\\)\\s*(.*)$", "i").exec(c);
  if (m) { out.qty = Number(m[2]); out.unit = pence(m[3], m[4], m[5]); c = (m[1] + " " + m[6]).trim(); out.head = true; }
  // A weighed or measured amount after the name, or on its own: a detail ("Unleaded  38.42 L @ 142.9p/L").
  m = new RegExp("^(?:([^\\p{L}\\n\\r\\u2028\\u2029]*\\p{L}.*?)\\s+)?(" + MEASURE + ")$", "iu").exec(c);
  if (m) { out.measure = m[2]; c = m[1] || ""; }
  // "Dash Cam Fitting - FREE": an item at no charge.
  if (!out.prices.length && !out.negative && (m = /^([^\p{L}\n\r\u2028\u2029]*\p{L}.*?)(?:\s*[-–:]\s*|\s{2,})(?:free|no charge|£0\.00)$/iu.exec(c)) && !END.test(m[1])) { out.free = true; c = m[1]; }
  // "1 Yum Yum (Reward) Free": how many, the name, and that it cost nothing, on a line that starts with how many (round 8).
  // ("1 Diet Coke Sugar Free" is a name: what it is free of comes before the word.)
  if (!out.prices.length && !out.negative && !out.free && (m = /^(\d{1,2})\s+(?:[x×]\s+)?(\p{Lu}[^\p{L}\n\r\u2028\u2029]*\p{L}.*?)\s+free$/iu.exec(c)) &&
      !/\b(?:gluten|sugar|dairy|fat|caffeine|alcohol|lactose|nut|meat|wheat|egg|soy|soya|salt|fragrance|cruelty|plastic|duty|tax|vat|interest|hands|milk|grain|palm oil|paraben|sulphate|bpa|scent|allergen|stress|hassle|risk|commission|range|rent|tax-?)\s*-?$/i.test(m[2]) && !END.test(m[2])) {
    out.free = true; out.qty = Number(m[1]); out.head = true; c = m[2];
  }
  // An option's own price after it, "Oat milk +£0.45" (not one in brackets, which the item's price already includes).
  m = new RegExp("^([^\\p{L}\\n\\r\\u2028\\u2029]*\\p{L}.*?)\\s*\\+\\s?" + MONEY + "$", "u").exec(c);
  // (The option keeps its price in what it says, "Extra cheese +£1.00", as the email shows it. Round 8.)
  if (m && !out.prices.length) { out.addPrice = pence(m[2], m[3], m[4]); out.addText = c.replace(/\s+/g, " ").trim(); c = m[1]; }
  // (A shop's "× 1" after the name is how many, and a product that is itself a set, "3 x 100ml Perfume Bottles × 1", keeps
  // its "3 x" in its name. Round 15.)
  const setOf = /^\d{1,3}\s?x\s+\S.*?\S\s*×\s?(\d{1,3})$/i.exec(c);
  if (setOf) { out.qty = Number(setOf[1]); c = c.replace(/\s*×\s?\d{1,3}$/, ""); out.head = true; out.tail = true; out.keepName = true; }
  // Quantity at the start: "1 x Name", "2x Name", "2 × Name"; a bare "1 Big Mac Meal" only on a line with its price.
  m = setOf ? null : /^(\d{1,3})\s?[x×]\s+(\S.*)$/i.exec(c) || /^(\d{1,3})[x×](\p{L}.*)$/iu.exec(c);
  if (m) { out.qty = Number(m[1]); c = m[2]; out.head = true; }
  else if (out.prices.length && (m = /^(\d{1,2})\s+(\p{Lu}.*)$/u.exec(c)) && !/^(?:adults?|child(?:ren)?|items?|for|pack|people|nights?|days?|months?)\b/i.test(m[2])) { out.qty = Number(m[1]); c = m[2]; }
  // Quantity at the end: "Name x2", "Name × 1", "Name (x1)", "Name Qty: 2", "Name  2" (a column).
  m = /^(.*?\S)\s*\(\s?[x×]\s?(\d{1,3})\)$/i.exec(c) || /^(.*?\S)\s+[x×]\s?(\d{1,3})$/i.exec(c) || /^(.*?\S)\s*[-–|]?\s*(?:qty|quantity)\s*:?\s*(\d{1,3})\s*[-–]?$/i.exec(c) ||
    /^(.*?\S)\s{2,}(\d{1,3})$/.exec(c) ||
    // ("Adult - aged 16+ 2": a number after an age band's "+" is how many. Round 12.)
    /^(.*?\d{1,2}\+)\s(\d{1,2})$/.exec(c);
  if (m && out.qty == null) { out.untailed = cleanName(c); out.qty = Number(m[2]); c = m[1]; out.head = true; out.tail = true; }
  // ("Sea Mist 5L, x 1": the size before how many, set apart by a comma, is the item's size. Round 11.)
  if (out.tail && (m = /^(.*\p{L}.*?)\s+(\d+(?:[.,]\d+)?\s?(?:ml|cl|l|ltr|g|kg|oz))\s*,$/iu.exec(c))) { out.measure = m[2]; c = m[1]; out.untailed = null; }
  out.text = cleanName(c);
  return out;
}

// Each line of the text, as cells, read for what it is.
function readLine(raw) {
  const line = { indent: /^[ \t]{2,}\S/.test(raw), cells: [], names: [], extras: [], prices: [], qty: null, unit: null, notCharged: false, plus: false, end: false, noise: false, skipStart: false, skipEnd: false, variant: [], negative: false };
  const parts = raw.split("|").map((x) => x.replace(/\t/g, "  ").replace(/ {3,}/g, "  ").replace(/[\u00a0\r]/g, " ").trim()
    // "Qty 2 @ \u00a315.00" is how many at what each: "2 x \u00a315.00".
    .replace(new RegExp("^(?:qty|quantity)\\s*:?\\s*(\\d{1,3})\\s*(?:@|x|\u00d7)\\s*(?=" + MONEY + "$)", "i"), "$1 x "));
  line.lead = parts.length > 1 && parts[0] === "" && parts.slice(1).some(Boolean);
  // ("Oatmeal · Qty 1": facts set apart by a middle dot are cells of their own.)
  const cells = parts.flatMap((x) => x.split(/\s+[·•]\s+|\s+[·•]$/))
    // ("Blue / Size: W30 L32 / Qty: 1": facts set apart by slashes, one of them a labelled size or quantity. Round 8.)
    .flatMap((x) => { const bits = x.split(/\s+\/\s+/); return bits.length >= 2 && bits.some((b) => /^(?:qty|quantity|size)\s*:\s*\S/i.test(b)) && !/£/.test(x) ? bits : [x]; })
    .map((x) => x.trim()).filter(Boolean);
  line.cells = cells;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i], next = cells[i + 1];
    if (QTY_LABEL.test(c) && next && /^\d{1,3}$/.test(next)) { line.qty = Number(next); i++; continue; }
    // ("2 x Adults", "2 x Games" on a line of their own under a booking: who it was for, never a thing bought. Round 15e.)
    if (cells.length === 1 && WHO_FOR.test(c.trim())) { line.variant.push(c.trim()); continue; }
    // ("9L, x 1": the size and how many, under the name. Round 11.)
    const sq = /^(\d+(?:[.,]\d+)?\s?(?:ml|cl|l|ltr|litres?|g|kg|oz|m|cm|mm))\s*,\s*[x×]\s?(\d{1,3})$/i.exec(c);
    if (sq) { line.variant.push(sq[1]); line.qty = Number(sq[2]); continue; }
    if (PRICE_LABEL.test(c) && next && PRICE_CELL.test(next)) { const m = PRICE_CELL.exec(next); line.unitLabelled = pence(m[2], m[3], m[4]); i++; continue; }
    if (TOTAL_LABEL.test(c) && next && PRICE_CELL.test(next)) { const m = PRICE_CELL.exec(next); line.labelledTotal = pence(m[2], m[3], m[4]); line.endWord = true; i++; continue; }
    if (NAME_LABEL.test(c) && next && letters(next) >= 3 && !PRICE_CELL.test(next) && !HEADING.test(next)) { line.names.push(cleanName(next)); line.namedByLabel = true; i++; continue; }
    // The same label and name in one cell ("Plan: 3 meals for 2 people").
    const got = /^(?:you received|received|you got|delivered|substituted (?:with|by)|replaced (?:with|by)|sent instead)\s*:\s*(\S.*)$/i.exec(c);
    if (got && letters(got[1]) >= 3 && !/£/.test(got[1])) { line.names.push(cleanName(got[1])); continue; }
    // ("Name: Afternoon Tea for Two": a voucher's name, labelled. Round 12.)
    const nl = /^(?:plan|product|item|description|subscription|box|name|product name|item name|ticket type)\s*:\s*(\S.*)$/i.exec(c);
    if (nl && letters(nl[1]) >= 3 && !/£/.test(nl[1]) && !HEADING.test(nl[1])) { line.names.push(cleanName(nl[1])); line.namedByLabel = true; continue; }
    if (FREE_CELL.test(c) && LABEL_PRICE.test(c)) { line.free = true; line.priceLabelled = true; continue; }
    if (COLOUR_LINE.test(c) && (i === 0 || cells.slice(0, i).every((x) => /^(?:x{0,3}s|m|x{0,3}l|\d{1,2}(?:\.\d)?|uk \d{1,2}|one size)$/i.test(x)))) { line.variant.push(c); continue; }
    // (A size before such a colour, "XS | BLACK", is what it is too. Round 8.)
    if (i === 0 && cells.length > 1 && /^(?:x{0,3}s|m|x{0,3}l)$/i.test(c) && cells.slice(1).every((x) => COLOUR_LINE.test(x))) { line.variant.push(c); continue; }
    if (FORMAT_LINE.test(c)) { line.variant.push(c); continue; }
    // "2 @ £1.55   £3.10", "2 x £45.00   £90.00": how many, at what each, and the line's price.
    const qup = new RegExp("^(\\d{1,3})\\s*[@x×]\\s*" + MONEY + "(?:\\s*each)?\\s+" + MONEY + "$", "i").exec(c);
    if (qup) { line.qty = Number(qup[1]); line.unit = pence(qup[2], qup[3], qup[4]); line.prices.push(pence(qup[5], qup[6], qup[7])); continue; }
    if (PER_NIGHT.test(c)) { line.variant.push(c); continue; }
    if (/^(?:£\s?\d[\d,]*\.\d{2}\s+){1,3}£\s?\d[\d,]*\.\d{2}$/.test(c)) { for (const p of c.match(/£\s?\d[\d,]*\.\d{2}/g)) line.prices.push(pence(p.replace(/[£\s]/g, "").split(".")[0], p.split(".")[1])); continue; }
    if (FREE_CELL.test(c) && i > 0) { line.free = true; continue; }
    let m = PRICE_CELL.exec(c);
    if (m) { if (m[1]) line.negative = true; else { line.prices.push(pence(m[2], m[3], m[4])); if (LABEL_PRICE.test(c)) line.priceLabelled = true; } continue; }
    if ((m = UNIT_TIMES.exec(c))) { line.unit = pence(m[1], m[2], m[3]); line.qty = line.qty ?? Number(m[4]); continue; }
    if ((m = UNIT_CELL.exec(c))) {
      if (m[1]) { line.qty = line.qty ?? Number(m[1]); line.unit = pence(m[2], m[3], m[4]); }
      else line.unit = m[5] != null ? pence(m[5], m[6], m[7]) : m[8] != null ? pence(m[8], m[9], m[10]) : pence(m[11], m[12], m[13]);
      continue;
    }
    if ((m = QTY_CELL.exec(c))) {
      // ("Sainsbury's Lemons x4 | Qty: 1": how many is in its own cell, so the name's "x4" is part of the name. Round 8.)
      if (line.nameTail && line.names[0] === line.nameTail.name) { line.names[0] = line.nameTail.raw; line.nameRaw = null; line.keepName = true; }
      line.nameTail = null; line.qty = Number(m[1] || m[2] || m[3]); continue;
    }
    if (FREE_CELL.test(c) && line.names.length) { line.free = true; continue; }
    if (NOT_CHARGED.test(c) && line.names.length) { line.notCharged = true; continue; }
    // "Was £55.00 Now £49.50 (save 10%)": the price now is what was paid.
    const wn = new RegExp("^(?:(?:was|rrp)\\s*:?\\s*£[\\d.,]+\\s*)?now\\s*:?\\s*" + MONEY + "(?:\\s*\\([^)]{0,30}\\))?$", "i").exec(c);
    if (wn) { line.prices.push(pence(wn[1], wn[2], wn[3])); continue; }
    if (/^(?:was|now|rrp|save|you save|saving|price was|originally)\b\s*:?\s*£/i.test(c)) { line.details = true; continue; }
    const lt = new RegExp("^(?:item|line|product)\\s+total\\s*:?\\s*" + MONEY + "$", "i").exec(c);
    if (lt) { line.lineTotal = pence(lt[1], lt[2], lt[3]); continue; }
    // A money line ("Guide price | £112.99", "Delivery fee £2.49", "Subtotal" over its amount) ends the list. A thing whose
    // name starts with such a word ("Bag for Life | 1 | £0.50") doesn't: it has more than an amount beside it.
    // ("Nectar Price £4.50 | £6.00" under an item's name is that item's offer price, not the money under the list. Round 8.)
    if (i === 0 && (END.test(c) || FEE_NAME.test(c)) && !/^(?:clubcard|nectar|my ?morrisons|my ?waitrose|member|rollback|lower)\s+prices?\s*:?\s*£/i.test(c) && !/^(?:delivery|parcel|package|shipment)\s+\d+\s+of\s+\d+$/i.test(c) && cells.slice(1).every((x) => PRICE_CELL.test(x) || FREE_CELL.test(x) || /^[-−–]\s?£/.test(x))) {
      const s = splitCell(c);
      if (cells.length > 1 || s.prices.length || s.negative || (END.test(s.text) || FEE_NAME.test(s.text)) && s.text.length <= 40) { line.endWord = true; line.endLabel = s.text || c; continue; }
    }
    if (i === 0 && SKIP_START.test(c)) line.skipStart = true;
    if (i === 0 && SKIP_END.test(c)) line.skipEnd = true;
    const s = splitCell(c);
    if (s.negative) line.negative = true;
    if (s.free) line.free = true;
    if (s.unit != null) line.unit = s.unit;
    if (s.measure) line.variant.push(s.measure);
    if (s.addPrice != null) line.addPrice = s.addPrice;
    const t0 = s.text, keepAdd = s.addText && t0 && !DETAIL.test(t0) && !VARIANT.test(t0) && !HEADING.test(t0) ? s.addText : null;
    if (s.qty != null && line.qty == null) line.qty = s.qty;
    if (s.head) line.head = true;
    line.prices.push(...s.prices);
    const t = s.text;
    if (!t) continue;
    if (/\s-\s(?:not charged|unavailable|out of stock)$/i.test(t) || /^not charged$/i.test(t)) { line.notCharged = true; continue; }
    if (DETAIL.test(t)) { line.details = true; continue; }
    if (VARIANT.test(t) || (/^[\p{L}\d][\p{L}\d .'’-]{0,20}\s\/\s[\p{L}\d][\p{L}\d .'’()-]{0,20}$/u.test(t) && !/\b(?:and|or|with)\b/i.test(t))) { line.variant.push(t); continue; }
    if (/^[+＋]$/.test(t)) { line.plus = true; continue; }
    if (/^[+＋]\s*/.test(t)) { line.plus = true; line.extras.push((keepAdd || t).replace(/^[+＋]\s*/, "")); continue; }
    // (A shoe size on its own line, "UK 9", is what the item is: two of one shoe in two sizes can be told apart. Round 10.)
    if (/^(?:uk|eu|us)\s?\d{1,2}(?:\.5)?$/i.test(t)) { line.variant.push(t.toUpperCase()); continue; }
    // (A changed order, Shopify's "Removed 1 of 1" under a line "× 0": that line was taken off, never bought. "Added 1" says
    // the line under it was put on. Round 10.)
    if (/^removed(?:\s+\d+\s+of\s+\d+)?$/i.test(t)) { line.removed = true; continue; }
    if (/^added(?:\s+\d+)?$/i.test(t)) { line.details = true; continue; }
    // (A product code in brackets on its own line under the name, "( PPODQ1 )", "( PCOMN2 SP1 )". Round 15e.)
    if (cells.length === 1 && /^\(\s*(?=[A-Z0-9 -]*\d)[A-Z0-9][A-Z0-9 -]{2,20}\s*\)$/.test(t)) { line.details = true; continue; }
    if (letters(t) < 3) continue;           // a size column ("M", "UK 9"), a stray symbol
    // (A product code in a cell of its own, "cusion.col272", "FREDEL.SK11337.801.DT75266.101": one word with points between
    // letters and digits. Round 11.)
    if (/^(?=[\w.-]*\d)[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(t) && t.length >= 7 && !/^\d+(?:\.\d+)?$/.test(t)) { line.details = true; continue; }
    if (/@|https?:|www\./i.test(t)) { line.noise = true; continue; }
    if (i === 0 && (LABELLED.test(t) || DATE_LINE.test(t) || sentence(t) || /:\s*$/.test(c) || /^(?:placed|ordered|order placed|booked)\s+on\b/i.test(t))) { line.noise = true; continue; }
    if (i === 0 && FULL_DATE.test(t) && t.length <= 60) { line.noise = true; continue; }
    // (An address under "Shipping Address" or "Billing Address": a name and a phone number, or a line with a postcode set
    // apart by commas. Never what was bought. Round 11.)
    if (i === 0 && cells.length === 1 && (/^\p{Lu}[\p{L}'’-]+(?: \p{Lu}[\p{L}'’-]+){0,3} \+?\d[\d ]{8,14}$/u.test(t) || (/,/.test(t) && /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/.test(t) && !/£/.test(t)))) { line.noise = true; continue; }
    if (i === 0 && DATE_RANGE.test(t)) { line.noise = true; continue; }
    // (The end of a sentence carried onto its own line, "our nutritional page.": small letter first, a full stop last.)
    if (i === 0 && cells.length === 1 && /^\p{Ll}/u.test(t) && /\.$/.test(t) && t.split(/\s+/).length <= 6) { line.noise = true; continue; }
    // (A heading or a button's words after a drawn symbol, "🧾 View Order", or with how many after them, "Product Ordered (3)",
    // are still that heading, never an item's name. Round 15e.)
    if (HEADING.test(t) || HEADING.test(t.replace(/^[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F\u200D\s]+(?=\p{L})/u, "").replace(/\s*\(\d{1,3}\)$/, ""))) { line.heading = true; continue; }
    if (!line.names.length && s.tail) { line.nameRaw = s.untailed; line.nameTail = { name: keepAdd || t, raw: s.untailed }; }
    line.names.push(keepAdd || t);
  }
  // "1 Lamb Biryani | £11.95": a number before the name, with the price in the next cell, is how many (round 8).
  if (line.qty == null && line.names.length && line.prices.length && cells.length > 1) {
    const q = /^(\d{1,2})\s+(\p{Lu}.*)$/u.exec(line.names[0]);
    if (q && !/^(?:adults?|child(?:ren)?|items?|for|pack|people|nights?|days?|months?)\b/i.test(q[2])) { line.qty = Number(q[1]); line.names[0] = q[2]; line.head = true; }
  }
  // "Unavailable – refunded | £2.99": a note that this line wasn't charged, not the start of a list of missing items.
  if (line.skipStart && (line.prices.length || line.free) && cells.length > 1) { line.skipStart = false; line.notCharged = true; line.names = []; }
  // A quantity in its own cell before the name ("1 | Medium Mighty Meaty®" with its extras and price on the next line).
  if (line.qty != null && line.names.length && !line.prices.length) line.head = true;
  return line;
}

const finish = (b, opts = {}) => {
  // (A brand on its own line over the product's whole name, "Fila" over "Fila Teratach": the product is the whole name,
  // never the brand with its name as a detail. Round 15e.)
  if (b.name && b.extras.length && b.name.length <= 30 && String(b.extras[0]).toLowerCase().startsWith(String(b.name).toLowerCase() + " ") && b.extras[0].length <= 120) {
    b = { ...b, name: b.extras[0], extras: b.extras.slice(1) };
  }
  const name = b.name;
  // ("Cloud Runner Trainers × 0": none of it, a line taken off a changed order. Round 10.)
  if (!name || b.dropped || b.qty === 0) return null;
  const qty = b.qty || 1;
  const prices = b.prices.slice();
  let pricePence = null, lineTotal = true, ambiguous = false;
  if (b.lineFromLabel != null) pricePence = b.lineFromLabel;
  // (Read again with the lower of one thing's two prices, "£5.50 £8.00": a sale price beside the old one, struck through in
  // the email. The totals check says which reading the email meant. Round 15e.)
  else if (opts.lowerOfTwo && prices.length === 2 && qty === 1 && prices[0] !== prices[1]) pricePence = Math.min(prices[0], prices[1]);
  else if (prices.length >= 2) pricePence = prices[prices.length - 1];
  else if (prices.length === 1) { pricePence = prices[0]; if (qty > 1 && b.unit == null) ambiguous = true; }
  else if (b.unit != null) pricePence = b.unit * qty;
  else if (b.free) pricePence = 0;
  if (pricePence == null) return null;
  // (An option's own label is not what it is: "Option: Brown, No Size" is "Brown, No Size". Round 15e.)
  // (Nor a picture's placeholder, "[divider]".)
  const variant = [...b.variant.map((v) => String(v).replace(/^option\s*:\s*/i, "")), ...b.extras].filter((x, i, a) => x && a.indexOf(x) === i && !/^\[[^\]]{1,30}\]$/.test(String(x).trim())).join(", ").slice(0, 160);
  // (The unit price, when the email gave one beside the line's price, is kept for the totals check: how many times the
  // unit price must come to the line's price. receipt-parser.js takes it off again.)
  const unitPence = b.unit != null && b.lineFromLabel == null && prices.length ? b.unit : null;
  // ("Birds Eye Fish Fingers x10 | 1 | £3.00": how many was given apart from the name, so its "x10" is part of the name, a
  // pack of ten. Round 8.)
  const keepName = b.keepName || (b.qty != null && /\s[x×]\s?\d{1,3}$/i.test(name));
  return { name, qty, pricePence, lineTotal, ...(unitPence != null ? { unitPence } : {}), ...(keepName ? { keepName: true } : {}), ...(ambiguous ? { ambiguous: true } : {}), ...(variant ? { variant } : {}), ...(b.extras.length ? { extras: b.extras.slice(0, 8) } : {}) };
};

// The item list in a receipt's text (an HTML part turned into text: table cells end with " | ", rows with a new line).
// opts.extraPrices: a price on its own line under an item's extras is that extra's own price, added to the item's (a meal
// deal's "+ Stuffed Crust £3.00"). Without it such a price is passed over. Both readings are tried; the totals check picks.
export function readItems(text, opts = {}) {
  const items = [];
  let pend = null, last = null, skip = false, wantExtra = false, qtyBefore = null, paused = false, cur = 0;
  const emit = () => {
    // A name on one line and a price on another is only an item when something says so: how many, a size or colour, its
    // code, a labelled price, or a "+" extra. ("Some Shop" over "£5.00" is a heading and a total, not a purchase.)
    // (Or it comes straight after an item read the same way, a name over its price, that said how many: the next one of
    // the list, "Prize Booster" over "£5.00" under "Weekly Draw", "100 Entries x 1", "£5.00". Round 11.)
    const listed = pend && pend.prev && pend.prev.mode === "block" && pend.prev.counted && pend.prev.at >= pend.startAt - 1 && pend.prev.at <= pend.startAt && pend.lines === 1 && !pend.extras.length;
    const sure = pend && (!paused || pend.head || pend.qty != null || pend.cell) && (pend.head || pend.cell || pend.qty != null || pend.unit != null || pend.lineFromLabel != null || pend.variant.length || pend.detail || pend.labelled || pend.plus || listed);
    if (pend && sure && pend.prices.length + (pend.unit != null ? 1 : 0) + (pend.lineFromLabel != null ? 1 : 0) + (pend.free ? 1 : 0) > 0 && !pend.dropped) {
      // (A deal's parts straight under it, with an extra and the extra's price, "2's Special £29.99" then "BBQ Chicken Pizza",
      // "+ Deep Pan", "Pepperoni Hot Pizza", "+ Stuffed Edge", "£3.99": in a list whose items each say how many, a name that
      // doesn't is part of the item above, and that price is its extra's (added in the extra-price reading). Round 10.)
      const prev = pend.prev;
      if (prev && prev.counted && prev.at === pend.startAt && pend.qty == null && !pend.head && pend.unit == null && (pend.plus || pend.extras.length) && !pend.cell) {
        addExtras(prev.item, [pend.name, ...pend.extras]);
        if (opts.extraPrices && pend.prices.length) prev.item.pricePence += pend.prices[pend.prices.length - 1];
        last = prev; pend = null; return;
      }
      const it = finish(pend, opts);
      if (it) { items.push(it); last = { item: it, mode: "block", at: cur, qtyFree: pend.qty == null && !pend.head, counted: pend.qty != null || Boolean(pend.head), qtyAbove: Boolean(pend.qtyAbove) }; }
    }
    pend = null;
  };
  // Names with no price of their own straight under an item read from one row, and before the next item or the end of
  // the list, are that item's parts (a meal deal's pizzas, a drink's options, a box's recipes).
  const foldPend = () => {
    if (pend && pend.afterRow && !pend.prices.length && !pend.free && pend.qty == null && !pend.head && pend.unit == null && pend.unitLabelled == null && !pend.variant.length && !pend.detail && !pend.labelled && !pend.plus)
      addExtras(pend.afterRow.item, [pend.name, ...pend.extras]);
  };
  const newBlock = (l, name) => { const q = qtyBefore; qtyBefore = null; const b = block(l, name); if (q != null && b.qty == null) { b.qty = q; b.head = true; b.qtyAbove = true; } return b; };
  // (An item's name never carries an option's price: "Add bacon +£1.00" as a name is "Add bacon".)
  const block = (l, name) => ({ lines: 1, keepName: Boolean(l.keepName), labelled: Boolean(l.namedByLabel), name: String(name).replace(/\s*\+\s?£\s?[\d,]+(?:\.\d{2})?$/, ""), nameRaw: l.nameRaw || null, qty: l.qty, unit: l.unit, prices: [], extras: [...l.extras, ...l.names.slice(1)], variant: [...l.variant], head: Boolean(l.head) });
  // (Round 8: which lines come straight after a table row ended, so the first line of a cell that runs over several lines,
  // "Carling Lager 18 x 440ml" over "Age restricted product | 1 | £15.00 |", can be told from an extra of the row above.)
  const afterRow = [];
  let raw = [];
  for (let k = 0, rowEnded = false, all = prepText(text).replace(/\r\n?/g, "\n")
      // (Two items run into one line of a text part, "Sea Mist 5L, x 1<tab>£89.50 Fern Hollow 2L, x 1<tab>£32.00": each on its own.
      // Round 11.)
      .replace(/(\t£\s?\d[\d,]*\.\d{2}) (?=\p{Lu}[^£\t\n]{2,80}\t£)/gu, "$1\n")
      // (A label on its own line over its value in a cell of its own, "Quantity" / "1 |", "Price" / "£2.80 |", under each
      // item's name: read as the label's cell and the value's. Round 15.)
      .replace(/^([ \t]*)(quantity|qty|price)[ \t|]*\n(?=[ \t]*(?:\d{1,3}|£ ?\d[\d,]*\.\d{2})(?:[ \t]*\|)+[ \t]*$)/gim, "$1$2 | ")
      // (Empty cells before a line's one cell, "| | ASOS DESIGN skinny chino shorts in navy |" (an image's cell): just that
      // cell. Round 15e.)
      .replace(/^[ \t]*(?:\|[ \t]*){2,4}(?=[^|\s][^|\n]*\|?[ \t]*$)/gm, "")
      // (The colour and size set apart by slashes before how many, "Brown / No Size / Qty 1", under an item's price: what it
      // is and how many, never a name. Round 15e.)
      .replace(/^([ \t|]*)((?:[^|£/\n]{1,30}[ \t]\/[ \t]){1,3})(?:qty|quantity)[ \t]*:?[ \t]*(\d{1,3})([ \t|]*)$/gim, (m, a, facts, q, b) => `${a}Option: ${facts.split(/[ \t]\/[ \t]/).map((f) => f.trim()).filter(Boolean).join(", ")}${b}\n${a}Qty: ${q}${b}`)
      // (A label and its value set apart by a dash, "Qty - 1", "Size - 12": read as "Qty: 1", "Size: 12". Round 15e.)
      .replace(/^([ \t|]*)(qty|quantity|size|colou?r)[ \t]+[-–][ \t]+(?=[\p{L}\d])/gimu, "$1$2: ").split("\n"); k < all.length && raw.length < 6000; k++) {
    // (Text copied from a page a browser showed sets its cells apart with tabs: read as cells, as an email's table is. Only a
    // row that ends with its price is a row that ended.)
    // (A "|" inside such a cell is part of what it says, "… 140 MB/s | A1 | Class 10", unless it sets facts apart.)
    const x = /\t/.test(all[k]) && all[k].trim() && (!/\|/.test(all[k]) || /\t\S|\S\t/.test(all[k]))
      ? all[k].replace(/\s+$/, "").split("\t").map((c) => (/£|\b(?:qty|quantity|size|colou?r|price)\b\s*:/i.test(c) ? c : c.replace(/\|/g, "\u2502")).trim()).join(" | ") + " |" : all[k];
    const tabbed = x !== all[k];
    if (!x.trim()) { rowEnded = rowEnded || raw.length > 0; continue; }
    if (/^[\s|]+$/.test(x)) { rowEnded = true; continue; }
    // (A row copied with tabs ended when its last cell is its price or is empty: "1 <tab> Big Breakfast" goes on below.)
    afterRow.push(rowEnded); raw.push(x); rowEnded = tabbed ? /\t\s*$|(?:£\s?[\d,]+(?:\.\d{2})?|free)\s*$/i.test(all[k]) : /\|\s*$/.test(x);
  }
  // (A label on its line and its value on the next, "size:" over "150x200 cm [King]", "Product code:" over "UKI83120652": one
  // line, so the value is the item's size or code, never a name. Round 11.)
  for (let k = raw.length - 2; k >= 0; k--) {
    if ((/^[\s|]*(?:size|colou?r|style|fit|length|width|product code|item code|sku|code|style\s*(?:#|no\.?|code)|model(?: no\.?)?|ref(?:erence)?|article(?: no\.?)?|art\. ?no\.?)\s*:[\s|]*$/i.test(raw[k]) || /^[\s|]*(?:order|transaction|payment|invoice|receipt)\s+(?:id|number|no\.?)\s*:?[\s|]*$/i.test(raw[k])) && !/£|:\s*$/.test(raw[k + 1]) && raw[k + 1].trim().length <= 60) {
      raw.splice(k, 2, raw[k].replace(/[\s|]+$/, "") + " " + raw[k + 1].replace(/^[\s|]+/, ""));
      afterRow.splice(k + 1, 1);
    }
  }
  const asWritten = raw;
  raw = byColumns(raw);
  if (opts.priceAbove) raw = priceAbove(raw);
  const read = raw.map(readLine);
  // (A choice on the line after a lone "+", "Mustard" (a topping, not a colour): a name, so it is the item's extra. Round 15e.)
  for (let k = 1; k < read.length; k++) {
    const a = read[k - 1], b = read[k];
    if (a.plus && !a.names.length && !a.prices.length && !a.extras.length && !b.names.length && !b.prices.length && b.variant.length === 1 && b.cells.length === 1) { b.names = [b.variant[0]]; b.variant = []; }
  }
  // A cell over several lines: its first line (a name, no price, not ending a cell) after a row that ended, and the rest of
  // the cell ending its row with the price. What follows the name in that cell is its note or its extras, never an item.
  if (!opts.priceAbove) for (let k = 0; k + 1 < read.length; k++) {
    const a = read[k];
    if (!afterRow[k] || /\|\s*$/.test(raw[k]) || columnsOf(raw[k]).every((c) => COLUMN.some(([, re]) => re.test(c.replace(/[:*]+$/, "")))) || !a.names.length || a.prices.length || a.free || a.noise || a.heading || a.endWord || a.skipStart) continue;
    for (let j = k + 1; j < Math.min(read.length, k + 6); j++) {
      const b = read[j];
      if (afterRow[j] || b.endWord || b.heading || b.noise) break;
      if (!/\|\s*$/.test(raw[j])) { if (b.prices.length || b.free || /\|/.test(raw[j])) break; continue; }
      // (Not when that row starts with how many, "2 | Tesco Semi Skimmed Milk | £3.30": it is an item of its own, under an
      // aisle's heading.)
      if (!b.lead && !b.head && (b.prices.length || b.free) && !/^\s*(?:\d{1,3}\s?[x×]?|[x×]\s?\d{1,3})\s*\|/i.test(asWritten[j] || "")) a.cellStart = true;
      break;
    }
  }
  const priceOnly = (x) => x && !x.names.length && x.prices.length > 0 && !x.endWord && !x.negative;
  for (let n = 0; n < read.length && items.length < 200; n++) {
    const l = read[n];
    cur = n;
    if (l.removed && !l.names.length) { if (pend) pend.dropped = true; else if (last && last.at >= n - 3) { const k = items.indexOf(last.item); if (k >= 0) items.splice(k, 1); last = null; } continue; }
    // "1 Egg Fried Rice" with its price on the next line: the number is how many.
    // (Not when how many was the line above, "1" over "20 Chicken McNuggets® Sharebox" over "£4.49": the number is the
    // product's own, part of its name. Round 13.)
    if (l.names.length === 1 && !l.prices.length && l.qty == null && qtyBefore == null && priceOnly(read[n + 1])) {
      const above = n > 0 ? read[n - 1] : null;
      if (above && above.qty != null && !above.names.length && !above.prices.length && above.cells.length === 1 && /^\d{1,2}\s+\p{Lu}/u.test(l.names[0])) {
        // (The number above is how many; the product's own number stays in its name.)
        l.qty = above.qty; l.head = true; if (pend && !pend.prices.length) { pend.qty = null; pend = null; }
      } else if (!(read[n + 2] && read[n + 2].qty != null && !read[n + 2].names.length && !read[n + 2].prices.length)) {
      // (Unless how many is written under the price, "21 Chicken Kickers™" / "£10.99" / "Qty: 1": then the number is the
      // product's own. Round 13.)
      const q = /^(\d{1,2})\s+(\p{Lu}.*)$/u.exec(l.names[0]);
      if (q && !/^(?:adults?|child(?:ren)?|items?|for|pack|people|nights?|days?|months?)\b/i.test(q[2])) { l.qty = Number(q[1]); l.names[0] = q[2]; l.head = true; }
      }
    }
    const hasName = l.names.length > 0;
    // A price straight after an item's price, or its labelled line total ("Total | £53.00" under "Price | £5.30").
    if (pend && pend.prices.length && !hasName && !l.endWord && (l.prices.length || l.unit != null) && !l.negative) { pend.prices.push(...l.prices); if (l.unit != null) pend.unit = l.unit; continue; }
    if (pend && l.labelledTotal != null && !hasName && (pend.unit != null || pend.unitLabelled != null)) {
      const u = pend.unit ?? pend.unitLabelled;
      if ((pend.qty || 1) * u === l.labelledTotal) { pend.lineFromLabel = l.labelledTotal; pend.unit = u; emit(); continue; }
    }
    if (l.lineTotal != null && !hasName && pend && pend.name) { pend.prices.push(l.lineTotal); pend.labelled = true; emit(); continue; }
    // How many on the line under the price ("Bosch Cordless Drill 18V", "£99.00", "Qty: 1").
    if (pend && pend.name && pend.prices.length && pend.qty == null && !pend.head && !hasName && l.qty != null && !l.prices.length && l.unit == null && !l.endWord) { pend.qty = l.qty; emit(); continue; }
    // (A size or colour on the line under an item's price, "£35.99" then "XS | BLACK", is still that item's. Round 8.)
    if (pend && pend.name && pend.prices.length && !hasName && !l.prices.length && !l.endWord && !l.negative && l.variant.length && !l.extras.length && l.unit == null) { pend.variant.push(...l.variant); if (l.qty != null && pend.qty == null) pend.qty = l.qty; continue; }
    if (pend && (pend.prices.length || pend.free)) emit();
    if (pend && pend.unitLabelled != null && !(l.labelledTotal != null)) { pend.prices.push(pend.unitLabelled); pend.unit = null; emit(); }
    // The list ends at its subtotal or total. A fee or a discount line only pauses it: some emails list an order per seller,
    // each with its own postage. After one, only an item that says how many counts.
    if (l.endWord && !hasName && (items.length || last)) {
      foldPend();
      if (HARD_END.test(String(l.endLabel || l.cells[0] || "")) || l.labelledTotal != null) break;
      paused = true; pend = null; last = null; continue;
    }
    if (l.endWord && hasName && /^(?:sub-?\s?total|total|order total|delivery|shipping|postage|service|vat)\b/i.test(l.names[0]) && items.length) { foldPend(); break; }
    // A row named as a price or total whose amount is what the items so far came to is their subtotal ("Box price | £44.00").
    if (hasName && items.length && !l.qty && !l.head && l.prices.length === 1 && l.names.length === 1 && /\b(?:price|total|amount|cost)\b/i.test(l.names[0]) &&
        [items.reduce((t, i) => t + (lineOf(i) || 0), 0), items.reduce((t, i) => t + (i.ambiguous ? i.pricePence * i.qty : lineOf(i) || 0), 0)].includes(l.prices[0])) { foldPend(); break; }
    if (l.skipStart) { pend = null; skip = true; last = null; continue; }
    if (l.skipEnd) { skip = false; pend = null; last = null; continue; }
    if (skip) continue;
    if (l.noise && !hasName && !l.prices.length) { pend = null; last = null; continue; }
    // ("Apple Arcade" under a game's name is what it came with, not a new section.)
    if (l.heading && !hasName && !l.prices.length && pend && pend.name && /^(?:apple arcade|apple music|apple tv\+?|apple one|icloud\+?)$/i.test(l.cells[0] || "")) { pend.detail = true; continue; }
    if (l.heading && !hasName && !l.prices.length) { pend = null; continue; }
    if (l.notCharged) { pend = null; continue; }
    const priced = l.prices.length > 0 || (l.free && (hasName || pend));
    if (hasName && priced) {
      // Parts listed under an item at no charge of their own ("  Sea Salt Crisps   £0.00" set in under "Meal Deal   £5.50"):
      // the deal's parts, never items.
      if ((l.indent || l.lead) && !pend && last && l.prices.length && l.prices.every((p) => p === 0) && l.qty == null && !l.head) { addExtras(last.item, l.names); last.extraAt = n; continue; }
      // (Round 8: the same with nothing setting it in, when the items each say how many and these rows don't: a burger's
      // toppings at £0.00 under "1 Cheeseburger | £12.25". A free item of its own says it is one: "Free …", "(Reward)".)
      if (!pend && last && last.mode === "row" && last.counted && (last.at === n - 1 || last.extraAt === n - 1) && (l.prices.length ? l.prices.every((p) => p === 0) : l.free) && l.qty == null && !l.head &&
          !l.names.some((x) => /\b(?:free|reward|gift|offer|bogof|promo\w*|complimentary|sample)\b/i.test(x))) { addExtras(last.item, l.names); last.extraAt = n; continue; }
      // An extra with the item's price on its line, under a name that gave its quantity ("1 x | Salt and Pepper Chips" then
      // "+ Large | £4.20"; "Fig & Cassis Candle × 2" then "Large / 300g | £44.00").
      if (pend && pend.cell && !pend.prices.length) {
        pend.extras.push(...l.names); pend.prices.push(...l.prices); if (l.free) pend.free = true; if (l.qty != null) pend.qty = l.qty; if (l.unit != null) pend.unit = l.unit; pend.variant.push(...l.variant);
        continue;
      }
      if (pend && pend.head && !pend.prices.length && l.qty == null && !l.head) {
        pend.extras.push(...l.names); pend.prices.push(...l.prices); if (l.unit != null) pend.unit = l.unit; pend.variant.push(...l.variant);
        continue;
      }
      foldPend();
      pend = null;
      if (paused && l.qty == null && !l.head) continue;
      const b = newBlock(l, l.names[0]);
      b.prices = l.prices.slice(); if (l.free) b.free = true;
      if (!l.negative) { const it = finish(b); if (it) { items.push(it); last = { item: it, mode: "row", at: n, counted: l.qty != null || Boolean(l.head) }; } }
      continue;
    }
    if (!hasName && priced && !pend && last && last.extraAt === n - 1 && opts.extraPrices && l.qty == null) { last.item.pricePence += l.prices[l.prices.length - 1]; continue; }
    if (!hasName && priced && !pend && last && last.mode === "row" && last.at === n - 1 && opts.laterPrice && l.qty == null && l.prices.length === 1) { last.item.pricePence = l.prices[0]; continue; }
    // "+ Extra cheese £0.80" under an item: an extra of it, with its own price (added only in the extra-price reading).
    if (!hasName && priced && !pend && last && l.extras.length && l.plus && l.qty == null) { addExtras(last.item, l.extras); if (opts.extraPrices) last.item.pricePence += l.prices[l.prices.length - 1]; continue; }
    if (!hasName && priced) {
      if (pend && pend.name) { pend.prices.push(...l.prices); if (l.free) pend.free = true; pend.variant.push(...l.variant); if (l.qty != null) pend.qty = l.qty; if (l.unit != null) pend.unit = l.unit; pend.extras.push(...l.extras); if (l.details) pend.detail = true; if (l.priceLabelled) pend.labelled = true; if (l.plus) pend.plus = true; continue; }
      continue;
    }
    if (!hasName && l.unitLabelled != null) { if (pend && pend.name) pend.unitLabelled = l.unitLabelled; continue; }
    if (!hasName && (l.qty != null || l.unit != null)) {
      // (A bare number under a name that already said how many with a times sign, Shopify's "Swift Flights 3 × 1" over "25":
      // the item's size or weight, never how many. A pack size glued to the name, "Toilet Rolls x9" over "1", is the pack,
      // and the number under it is how many. Round 12.)
      if (pend && pend.name && pend.nameRaw && /\s×\s\d{1,3}$/.test(pend.nameRaw) && pend.qty != null && l.unit == null && l.cells.length === 1 && /^\d{1,3}$/.test(l.cells[0])) continue;
      // (In a list that puts how many above each name, "1" / "3 Omega-3 Fish Fingers" / "£3.49", a bare number after an item's
      // price is how many of the next line, never a new count for that item. Round 13.)
      if (l.unit == null && l.cells.length === 1 && /^\d{1,2}$/.test(String(l.cells[0]).trim()) && !l.extras.length &&
        (pend ? pend.name && pend.qtyAbove && pend.prices.length : last && last.qtyAbove && last.at >= n - 4)) { qtyBefore = l.qty; continue; }
      if (pend && pend.name) {
        // "Tempered Glass Screen Protector x2" over "Quantity: 2": the name's "x2" is part of its name (a 2-pack).
        if (l.qty != null && pend.nameRaw) { pend.name = pend.nameRaw; pend.nameRaw = null; pend.keepName = true; }
        if (l.qty != null) pend.qty = l.qty; if (l.unit != null) pend.unit = l.unit; pend.extras.push(...l.extras); pend.variant.push(...l.variant);
      }
      // (Or how many of the item read just before, from a name and a price that said nothing of how many: "£3.49" over "x3".)
      else if (last && (last.mode === "row" || (last.qtyFree && last.at === n)) && l.qty != null && !last.qtySet && !l.extras.length) { last.item.qty = l.qty; last.qtySet = true; if (last.item.qty > 1) last.item.ambiguous = true; if (l.variant.length && (last.at === n - 1 || last.extraAt === n - 1)) { addVariant(last.item, l.variant); last.extraAt = n; } }
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
      // (A size, colour or code on the lines straight under an item read from one row: "Relaxed Fit Trousers | £24.99", then
      // "Art. no. …", "Size: 32", "Colour: Beige". What it is, so two of one thing in two sizes can be told apart. Round 8.)
      else if (!pend && last && last.mode === "row" && (last.at === n - 1 || last.extraAt === n - 1) && (l.variant.length || l.details) && !l.extras.length) { if (l.variant.length) addVariant(last.item, l.variant); last.extraAt = n; }
      continue;
    }
    // A line with a name and no price.
    // "1 x 074897 / Size US 8 (UK 12-14)" under "Trail Jacket": how many, and the code and size, of the item above.
    if (l.head && pend && pend.name && !pend.prices.length && pend.qty == null && /^\d{3,}\b|\bsize\b|^[^/]{1,30}\s\/\s/i.test(l.names[0])) { pend.qty = l.qty; pend.variant.push(l.names[0]); continue; }
    // (In that list, a name with how many above it and no price of its own under it, "1" / "PC Chips" / "1" / "Veg Sticks",
    // is an option chosen for the item above, "3 Omega-3 Fish Fingers" / "£3.49": never an item. Round 13.)
    if (qtyBefore != null && (pend ? pend.qtyAbove && pend.prices.length : last && last.qtyAbove) && l.names.length === 1 && !l.prices.length && !l.head && !priceOnly(read[n + 1]) && !(read[n + 1] && read[n + 1].names.length && priceOnly(read[n + 2]))) {
      if (pend) pend.extras.push(l.names[0]); else { addExtras(last.item, [l.names[0]]); last.extraAt = n; last.at = n; }
      qtyBefore = null; continue;
    }
    if (l.head) { pend = newBlock(l, l.names[0]); continue; }
    // A line set in from the item above (an empty first cell, spaces, a "+") is part of it: its extras, or a meal deal's
    // parts. Unless it starts an item of its own: a quantity, size or code follows it before any price (Amazon's rows start
    // with the photo's cell).
    if ((l.lead || l.indent || l.plus || wantExtra) && !pend && last && qtyBefore == null && (last.mode === "row" || l.plus || wantExtra || !startsItem(n))) {
      addExtras(last.item, l.names); last.extraAt = n; wantExtra = false;
      if (l.addPrice != null && opts.extraPrices) last.item.pricePence += l.addPrice;
      continue;
    }
    wantExtra = false;
    if (l.cellStart) { foldPend(); pend = newBlock(l, l.names[0]); pend.cell = true; last = null; continue; }
    // A name over two lines ("Define Jacket", then its fabric "Nulu"): one capitalised word straight under a name that gave
    // no quantity and has nothing else under it yet.
    // (Not under a labelled name, "Name: Afternoon Tea for Two" then "Standard": the label gave the whole name. Round 12.)
    if (pend && !pend.cell && !pend.labelled && !pend.prices.length && !pend.head && pend.qty == null && !pend.extras.length && !pend.variant.length && pend.lines === 1 &&
        l.names.length === 1 && /^\p{Lu}[\p{Ll}]{2,15}$/u.test(l.names[0]) && !l.plus && !l.lead && !l.indent) { pend.name += " " + l.names[0]; pend.lines++; continue; }
    if (pend && !pend.prices.length && pend.unit != null && !l.lead && !l.indent && !l.plus) { emit(); pend = newBlock(l, l.names[0]); last = null; continue; }
    // (A row's name cell, "green tea |" over "x1 |" and "£0.00 |", under loose lines that are no row at all, a bill's
    // "restaurant", "canary wharf", "table", "#1221": the row is the first item, never an extra of those lines. Round 13.)
    if (pend && !pend.prices.length && pend.qty == null && !pend.head && !pend.cell && pend.startAt != null && /\|\s*$/.test(raw[n]) && !/\|\s*$/.test(raw[pend.startAt] || "|") &&
        !l.lead && !l.indent && !l.plus && startsItem(n)) { const prev = last; pend = newBlock(l, l.names[0]); pend.startAt = n; pend.prev = prev; last = null; continue; }
    if (pend && !pend.prices.length) { pend.extras.push(...l.names); pend.variant.push(...l.variant); if (l.qty != null) pend.qty = l.qty; if (l.details) pend.detail = true; if (l.plus) pend.plus = true; pend.lines++; continue; }
    const afterRow = last && last.mode === "row" && last.at === n - 1 ? last : null;
    const prev = last;
    pend = newBlock(l, l.names[0]);
    pend.afterRow = afterRow; pend.prev = prev; pend.startAt = n;
    last = null;
  }
  if (pend && !pend.prices.length && !pend.free) foldPend();
  emit();
  // (A section's heading over its first item, "Capsules" then "Roasted Hazelnut", "10 x £0.77": the heading, one word in
  // the plural, was read as the name and the item's own name as its extra. The item is the name under it. Round 11.)
  for (const it of items) {
    if (Array.isArray(it.extras) && it.extras.length === 1 && /^\p{Lu}\p{Ll}{3,}s$/u.test(it.name) && /\p{L}{3}.*\s\S|\p{L}{6}/u.test(it.extras[0]) && !/£|\d{3}/.test(it.extras[0])) {
      const n = it.extras[0];
      it.name = n; delete it.extras;
      const rest = String(it.variant || "").split(", ").filter((v) => v && v !== n);
      if (rest.length) it.variant = rest.join(", "); else delete it.variant;
    }
  }
  // A free carrier bag on a shop's till receipt ("NON CHARGEABLE LRG SHOPPER £0.00") is not a thing bought.
  return items.filter((i) => !(i.pricePence === 0 && /\b(?:non[- ]?chargeable|carrier bag|shopper|bag for life|paper bag)\b/i.test(i.name)));
  // Does the line at n begin an item of its own? A quantity, a size or colour, or a product code comes before any price.
  function startsItem(n) {
    for (let k = n + 1; k < Math.min(read.length, n + 8); k++) {
      const x = read[k];
      if (x.endWord || x.noise || x.head || (x.names.length && x.prices.length)) return false;
      // (A bare "1 |" over a name of its own is how many of that next item, not of this line: "| On Its Own |", "| |", "1 |",
      // "OG Kebab |". Round 13.)
      if (x.qty != null && !x.names.length && !x.prices.length && x.cells.length === 1 && read[k + 1] && read[k + 1].names.length && !read[k + 1].lead && !read[k + 1].indent && !read[k + 1].plus) return false;
      if (x.qty != null || x.unit != null || x.variant.length || x.details) return true;
      if (x.prices.length) return false;
    }
    return false;
  }
}
// ---- Tables read by their column headings (round 3) ------------------------------------------------------------------------
// A row of column headings ("Qty | Description | Total | Unit price", or plain text "Item   Unit cost   Quantity   Amount")
// says what each column holds, in whatever order the shop puts them. The rows under it are rewritten in the one order the
// reader reads (name, details, "Qty: n", "£x each", the line's price), so a unit price is never taken for the line's price
// and a code column is never taken for a name. A row that doesn't fit the headings is left as it is.
const COLUMN = [
  ["name", /^(?:items?|descriptions?|products?|articles?|item description|product name|product description|title|details|goods)$/i],
  ["qty", /^(?:qty\.?|quantity|units?|no\.?|count|pcs|number)$/i],
  ["unit", /^(?:unit price|unit cost|price each|cost each|each|per item|unit|rate|price per unit|item price)$/i],
  ["line", /^(?:total|line total|item total|amount|sub-?\s?total|line price|total price|value|line value|cost)$/i],
  ["price", /^price$/i],
  ["code", /^(?:code|sku|ean|item code|product code|item no\.?|ref\.?|part no\.?|cat\.? no\.?|article no\.?|barcode)$/i],
  ["detail", /^(?:size|colou?r|options?|variant|style)$/i],
];
const columnsOf = (line) => (/\|/.test(line) ? line.split("|").map((x) => x.trim()).filter(Boolean) : line.trim().split(/\s{2,}|\t+/).map((x) => x.trim()).filter(Boolean));
const MONEY_ONLY = new RegExp("^" + MONEY_WHOLE + "$");
function byColumns(lines) {
  let cols = null, left = 0, heads = [];
  return lines.map((line) => {
    const cells = columnsOf(line);
    const roles = cells.map((c) => (COLUMN.find(([, re]) => re.test(c.replace(/[:*]+$/, ""))) || [null])[0]);
    // ("Item | Description | Size | Qty | Price": beside a description, the item column holds its code. Round 8.)
    if (roles.filter((r) => r === "name").length === 2) { const k = cells.findIndex((c) => /^items?\s*(?:no\.?|#|code)?[:*]*$/i.test(c)); if (k >= 0) roles[k] = "code"; }
    if (cells.length >= 2 && roles.every(Boolean) && roles.includes("name") && roles.some((r) => r === "line" || r === "price" || r === "unit") && new Set(roles).size === roles.length) {
      // ("Price" is each item's price when there is also a total column, else the line's.)
      cols = roles.map((r) => (r === "price" ? (roles.includes("line") ? "unit" : "line") : r)); left = 60; heads = cells.map((c) => c.replace(/[:*]+$/, ""));
      return line;
    }
    if (!cols || left-- <= 0) return line;
    if (cells.length !== cols.length) return line;
    const at = (r) => cells[cols.indexOf(r)];
    const name = at("name"), qty = at("qty"), unit = at("unit"), ln = at("line");
    if (!name || !/\p{L}/u.test(name) || (qty != null && !/^\d{1,3}$/.test(qty)) || (unit != null && !MONEY_ONLY.test(unit)) || (ln != null && !MONEY_ONLY.test(ln))) return line;
    const out = [name];
    // (A size or colour column's value keeps its heading, "Size: 10R", so it reads as what the item is. Round 8.)
    for (let k = 0; k < cols.length; k++) if (cols[k] === "detail") out.push(/^(?:size|colou?r)$/i.test(heads[k] || "") && !/:/.test(cells[k]) ? heads[k] + ": " + cells[k] : cells[k]);
    if (qty != null) out.push("Qty: " + qty);
    if (unit != null && ln != null) out.push(unit + " each");
    out.push(ln ?? unit);
    return out.join(" | ") + " |";
  });
}

// ---- Prices printed above their names (round 3) -----------------------------------------------------------------------------
// Some receipts print each price on the line above its item ("£3.60" over "Oat Flat White"). Read as a second way: the price
// goes with the name under it. The totals check says which way the email meant.
function priceAbove(lines) {
  const out = [];
  for (let k = 0; k < lines.length; k++) {
    const a = readLine(lines[k]), b = lines[k + 1] != null ? readLine(lines[k + 1]) : null;
    // (Never the total's own amount, "Order Total" over "£310.00" over "The Tiffany Blue Box®": what is under a total is not
    // what it paid for. Round 14.)
    const afterTotal = k > 0 && /\b(?:order|grand|basket|bag|invoice|final)?\s*total\b|\b(?:amount|balance)\s+(?:paid|due)\b/i.test(String(lines[k - 1] || "")) && !/\bsub-?\s?total\b/i.test(String(lines[k - 1] || ""));
    if (b && !afterTotal && !a.names.length && a.prices.length === 1 && a.cells.length === 1 && !a.endWord && !a.negative && a.qty == null &&
        b.names.length && !b.prices.length && !b.noise && !b.heading && !b.endWord && b.unit == null &&
        // (Never a money line's label: "£1.59" over "Inclusive of VAT at 20%" is a total and its VAT, not an item.)
        !END.test(b.cells[0] || "") && !FEE_NAME.test(b.cells[0] || "") && !/\b(?:vat|tax|total|subtotal|paid|balance|payment)\b/i.test(b.cells[0] || "")) {
      out.push(lines[k + 1].replace(/[\s|]+$/, "") + " | " + a.cells[0] + " |"); k++; continue;
    }
    out.push(lines[k]);
  }
  return out;
}

function addVariant(item, variant) {
  item.variant = [item.variant, ...variant].filter((x, i, a) => x && a.indexOf(x) === i).join(", ").slice(0, 160);
}
function addExtras(item, extras) {
  extras = extras.filter((x) => !/^\[[^\]]{1,30}\]$/.test(String(x || "").trim()));
  item.extras = [...(item.extras || []), ...extras].slice(0, 8);
  item.variant = [item.variant, ...extras].filter(Boolean).join(", ").slice(0, 160);
}

// ---- What the email says the items came to ---------------------------------------------------------------------------------
const SUBTOTAL_LABEL = /^(?:sub-?\s?total|items? (?:sub-?)?total|item\(s\) subtotal|items?|products?(?: total)?|goods total|total of items|order value|basket total|trolley (?:cost|total)|merchandise(?: total)?|guide price|item total|tickets?)(?:\s*\([^)]{0,30}\))?\s*:?\s*$/i;
const FEE_LABEL = /\bfees?\b|^(?:city|tourist|local|resort|accommodation|visitor) tax\b|\b(?:levy|royal mail|parcelforce|evri|hermes|dpd|dhl|ups|yodel|inpost|courier|(?:1st|2nd|first|second) class|tracked(?: 24| 48)?|next[- ]day|named day|removal|disposal|recycling|delivery|shipping|postage|p\s?&\s?p|service|bag|carrier bags?|booking|small order|basket charge|minimum basket|packaging|installation|surcharge|buyer protection|click\s?&\s?collect|collection|gift ?wrap\w*|card fee|admin fee|fast track)\b/i;
const TIP_LABEL = /\btip\b|\bgratuity\b/i;
const DISCOUNT_LABEL = /\b(?:discount|voucher|promo\w*|offers?|savings?|saved|credit|coupon|deal|3 for 2|multi-?buy|rollback|clubcard|nectar|subscribe\s?&\s?save|member|adiclub|reward)\b/i;
const NOT_MONEY_LINE = /\b(?:vat|tax|paid today|next payment|instal+ment|pay in \d|due\b|was\b|rrp)\b/i;
// (Money lines set out as a column of labels beside a column of amounts, "Subtotal" / "Shipping(Royal Mail Tracked 48)" then
// "£17.97" / "£2.99": each label with its amount, in order. Only when every label is a money line's own (a subtotal, a fee,
// money off) and the amounts are as many as the labels. Round 15e.)
const STACK_MONEY = /^-?(?:£|€|\$)\s?\d[\d,]*(?:\.\d{2})?$|^free$/i;
function stackedMoney(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let n = 0;
    while (n < 4 && i + n < lines.length) {
      const c = lines[i + n].replace(/\|/g, "").trim(), l = c.replace(/\s*\(.*$/, "").replace(/[:*]+$/, "").trim();
      if (!c || c.length > 80 || !/\p{L}/u.test(l) || /\d\.\d{2}/.test(l) || !(SUBTOTAL_LABEL.test(l) || FEE_LABEL.test(l) || DISCOUNT_LABEL.test(l) || /^(?:order |grand )?total$/i.test(l))) break;
      n++;
    }
    if (n >= 2 && i + 2 * n <= lines.length && lines.slice(i + n, i + 2 * n).every((x) => STACK_MONEY.test(x.replace(/\|/g, "").trim()))) {
      for (let k = 0; k < n; k++) out.push(lines[i + k].replace(/\|/g, "").trim().replace(/\s*\(.*$/, "") + " | " + lines[i + n + k].replace(/\|/g, "").trim());
      i += 2 * n - 1; continue;
    }
    out.push(lines[i]);
  }
  return out;
}
export function moneyOf(text) {
  const out = { subtotal: null, fees: 0, tips: 0, discounts: 0, vat: null, found: [], offAboveSubtotal: 0 };
  // (Blank lines between an HTML email's rows say nothing: "Subtotal" and its amount can have one between them. Round 10.)
  const lines = stackedMoney(prepText(text).replace(/\r\n?/g, "\n").split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x && !/^[|\s]+$/.test(x)));
  // ("£-27.24": Domino's writes the minus after the pound sign. Round 10.)
  const amountOf = (s) => { const m = new RegExp("^([-−–])?\\s?" + MONEY + "\\s*\\*?$", "i").exec(s.trim().replace(/^£\s?[-−–]\s?(?=\d)/, "-£").replace(/^\+\s?(?=£)/, "")); return m ? { p: pence(m[2], m[3], m[4]), neg: Boolean(m[1]) } : /^(?:free|£0\.00)$/i.test(s.trim()) ? { p: 0, neg: false } : null; };
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split("|").map((x) => x.trim()).filter(Boolean);
    let label = null, amt = null, itemRow = false;
    if (cells.length === 2 && !amountOf(cells[0])) { label = cells[0]; amt = amountOf(cells[1]); }
    // ("1 | Promotion Applied | -£1.99": money off set out as a row of the item list, with how many first. Round 13.)
    else if (cells.length === 3 && /^\d{1,2}$/.test(cells[0]) && !amountOf(cells[1]) && /\p{L}/u.test(cells[1]) && amountOf(cells[2]) && amountOf(cells[2]).neg) { label = cells[1]; amt = amountOf(cells[2]); itemRow = true; }
    else if (cells.length === 1) {
      const m = new RegExp("^([^\\p{L}\\n\\r\\u2028\\u2029]*\\p{L}.*?)[\\s:]+((?:[-−–]\\s?)?" + MONEY + "|free)$", "iu").exec(cells[0]);
      if (m) { label = m[1]; amt = amountOf(m[2]); }
      else if (/\p{L}/u.test(cells[0]) && (cells[0].length <= 40 || (cells[0].length <= 90 && (amountOf((lines[i + 1] || "").replace(/\|/g, "").trim()) || {}).neg)) && lines[i + 1] && amountOf(lines[i + 1].replace(/\|/g, "").trim())) { label = cells[0]; amt = amountOf(lines[i + 1].replace(/\|/g, "").trim()); }
      // ("DELIVERY" over "(Standard)" over "£4.99": the label, a note in brackets, then the amount. Round 13.)
      else if (/\p{L}/u.test(cells[0]) && cells[0].length <= 40 && /^\([^()]{1,30}\)$/.test((lines[i + 1] || "").replace(/\|/g, "").trim()) && lines[i + 2] && amountOf(lines[i + 2].replace(/\|/g, "").trim())) { label = cells[0]; amt = amountOf(lines[i + 2].replace(/\|/g, "").trim()); }
      // (A credit set out like an item, "Unused time on Claude Pro after 26 Oct 2026" / "Qty 1" / "-£11.10": money off. Round 10.)
      // (Or with a bare count between, "Vouchers" / "1" / "£-100.00", a ticket seller's voucher row. Round 15.)
      else if (/\p{L}/u.test(cells[0]) && cells[0].length <= 80 && /^(?:qty\s*:?\s*)?\d{1,3}$/i.test((lines[i + 1] || "").replace(/\|/g, "").trim()) && lines[i + 2]) {
        const a = amountOf(lines[i + 2].replace(/\|/g, "").trim());
        if (a && a.neg) { label = cells[0]; amt = a; }
      }
    }
    if (!label || !amt) continue;
    label = label.replace(/[:*]+$/, "").trim();
    // (A subtotal over two amounts, the old one struck through and the new, "Subtotal | £14.95 / £11.96", under a code's
    // "20% discount first order only": the items come to the first, and the difference is that discount. Round 15.)
    if (SUBTOTAL_LABEL.test(label) && out.subtotal == null && !amt.neg) {
      const after = amountOf((lines[i + 2] || "").replace(/\|/g, "").trim()), nearOff = lines.slice(Math.max(0, i - 3), i).reverse().find((x) => /\b\d{1,3}\s?%\s?(?:discount|off)\b/i.test(x));
      if (cells.length === 1 && after && !after.neg && after.p < amt.p && nearOff) {
        out.subtotal = amt.p; out.offAboveSubtotal = out.discounts; out.discounts += amt.p - after.p;
        out.found.push(["discount", nearOff.replace(/\|/g, " ").replace(/\s+/g, " ").trim().slice(0, 80), amt.p - after.p, false]);
        i += 1; continue;
      }
    }
    if (/^(?:qty|quantity)\b/i.test(label)) continue;
    // (An item's own line in a text part, "1x    The C.L.T  - £11.95": the dash sets the price apart, it is no minus, and an
    // item is never money off. Round 15.)
    if (cells.length === 1 && /^\d{1,3}\s?x\s+\S/i.test(label) && !DISCOUNT_LABEL.test(label)) continue;
    // The VAT added on top of a subtotal ("VAT charged at 20% | £1.83", "VAT - United Kingdom (20%) | £12.78"): kept apart, so
    // the check can tell prices that include it (Apple) from prices that don't (a software invoice). Round 10.
    // (A dash set apart by spaces between the VAT and its amount, "VAT 20% - £2.20", is no minus. Round 15e.)
    if (amt.neg && cells.length === 1 && /^(?:vat|tax)\b/i.test(label) && /\s[-–]\s+£/.test(cells[0])) amt = { ...amt, neg: false };
    if (/^(?:vat|tax)\b(?!\s*(?:no|number|id|reg))[^|]{0,40}$/i.test(label) && !/\b(?:included|inclusive|incl)\b/i.test(label) && !amt.neg) { if (out.vat == null) out.vat = amt.p; continue; }
    // (An offer's name can be long, "Up to 80% off almost everything, plus FREE delivery!" over "- £3.48": money off. Round 15.)
    if ((NOT_MONEY_LINE.test(label) && !/^(?:city|tourist|local|resort|accommodation) tax\b/i.test(label)) || label.length > (amt.neg ? 90 : 50)) continue;
    // (The same money off twice in an item list, "1 | Promotion Applied | -£1.00" under two items, is taken off twice. Round 15.)
    const key = label.toLowerCase() + "=" + amt.p + (itemRow ? "@" + i : "");
    if (seen.has(key)) continue;
    seen.add(key);
    if (/\btotal\b/i.test(label) && !SUBTOTAL_LABEL.test(label)) continue;
    if (SUBTOTAL_LABEL.test(label)) { if (out.subtotal == null) { out.subtotal = amt.p; out.offAboveSubtotal = out.discounts; } continue; }
    if (TIP_LABEL.test(label)) { out.tips += amt.p; out.found.push(["tip", label, amt.p]); continue; }
    // (The card the bill was paid with, "mastercard - 7613 | -£57.09": the payment, never money off. Round 14.)
    if (amt.neg && /^(?:visa|master ?card|maestro|amex|american express|debit card|credit card|card)\b[^|]{0,24}?\d{4}$/i.test(label)) continue;
    if (amt.neg || DISCOUNT_LABEL.test(label)) { out.discounts += amt.p; out.found.push(["discount", label, amt.p, amt.neg]); continue; }
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
  // (Never the subtotal plus or minus the discounts: a discount read as an item would then look complete.)
  if (S != null) targets.push(S);
  // (Money off set out above the subtotal, "Multi-buy discount: -£3.10" then "Subtotal: £33.65": the subtotal is after it,
  // so the items come to the subtotal plus it. Round 15.)
  const above = S != null && (m.offAboveSubtotal || 0) > 0 ? m.offAboveSubtotal : 0;
  if (above) targets.push(S + above);
  // (When the email gives its items' subtotal, the items must come to it, or to the total less what was added and plus what
  // was taken off: never to the bare total, which a fee read as an item can make up. Round 3, 19 Nov 2026.)
  if (T != null) targets.push(...(S != null ? [T - (m.fees || 0) - (m.tips || 0) + (m.discounts || 0)] : [T - (m.fees || 0) - (m.tips || 0) + (m.discounts || 0), T - (m.fees || 0) - (m.tips || 0), T]));
  // A subtotal before VAT, with the VAT making up the total ("Subtotal £9.16", "VAT £1.83", "Total £10.99"): prices that
  // include VAT come to the total; prices before VAT come to it less the VAT (and plus any credit taken off). Round 10.
  const vatOnTop = S != null && T != null && m.vat != null && Math.abs(S + m.vat - T) <= 1;
  if (vatOnTop) targets.push(T - (m.fees || 0) - (m.tips || 0), T - m.vat - (m.fees || 0) - (m.tips || 0) + (m.discounts || 0));
  // (No subtotal, the VAT on its own line under prices before it, and the total after both: a hotel's "1 King Room € 97.27",
  // "VAT € 9.73", "City tax € 8.13", "Total price € 115.13". Round 12.)
  const vatAdded = S == null && T != null && m.vat != null && m.vat > 0;
  if (vatAdded) targets.push(T - m.vat - (m.fees || 0) - (m.tips || 0) + (m.discounts || 0));
  // (An offer that made delivery free, "… plus FREE delivery!" over "- £3.99", when the delivery line says "£0.00": the
  // delivery it took off was never added, so the items come to the total with that one offer left out. Round 15.)
  const freeDelivery = (m.found || []).some((f) => f[0] === "fee" && f[2] === 0 && /\b(?:delivery|shipping|postage)\b/i.test(f[1]));
  const waived = [];
  if (freeDelivery && T != null && S == null) for (const f of (m.found || [])) if (f[0] === "discount" && /\bfree\b[^|]{0,20}\b(?:delivery|shipping|postage)\b/i.test(f[1])) waived.push(T - (m.fees || 0) - (m.tips || 0) + (m.discounts || 0) - f[2]);
  targets.push(...waived);
  const expectedPence = vatOnTop ? null : S != null ? S + above : (T != null ? T - (m.fees || 0) - (m.tips || 0) + (m.discounts || 0) : null);
  const unpriced = list.some((i) => i.pricePence == null);
  // A money line read as an item ("Retail price", "Item Subtotal") can make the items look complete: they aren't.
  const moneyNamed = list.some((i) => SUBTOTAL_LABEL.test(String(i.name || "")) || /^(?:[\p{L}()]+\s){0,2}(?:sub-?\s?total|total|price)\s*:?$/iu.test(String(i.name || "")) || FEE_NAME.test(String(i.name || "")));
  // An item whose unit price was printed beside its line price, and the two don't agree on how many (2 at £15.00 is not
  // £45.00): its quantity or its price was misread.
  // (A line that costs less than its unit price times how many, in an email that says money was saved, is an offer price:
  // Sainsbury's prints "£2.25" then "£3.00/unit" for a Nectar price. Round 10.)
  const offerPrice = (i) => (m.discounts || 0) > 0 && i.unitPence * (i.qty || 1) > i.pricePence;
  const mismatched = list.some((i) => i.unitPence != null && i.lineTotal !== false && i.unitPence * (i.qty || 1) !== i.pricePence && !offerPrice(i));
  const itemsPence = list.reduce((n, i) => n + (lineOf(i) || 0), 0);
  if (!targets.length) return { complete: null, itemsPence, expectedPence: null, missingPence: null };
  if (!list.length) return { complete: false, itemsPence: 0, expectedPence, missingPence: expectedPence };
  const hit = !unpriced && !mismatched && !moneyNamed && targets.some((t) => Math.abs(t - itemsPence) <= 1);
  // (With VAT on top, what the items should come to depends on whether their prices include it: the nearer of the two.)
  const want = expectedPence ?? (vatOnTop ? targets.slice(-2).sort((a, b) => Math.abs(a - itemsPence) - Math.abs(b - itemsPence))[0] : null);
  return { complete: hit, itemsPence, expectedPence: hit && (vatOnTop || waived.some((t) => Math.abs(t - itemsPence) <= 1)) ? itemsPence : want, missingPence: hit ? 0 : want == null ? null : want - itemsPence };
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
  const m = t.match(/\b(?:order|basket|bag|parcel|purchase|delivery)\s+(?:of|contains|with|has)\s+(\d{1,3})\s+items?\b/i) || t.match(/\((\d{1,3})\s+items?\)/i) || t.match(/^[|\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]*(\d{1,3})\s+items?[\s|]*$/im);
  const n = m ? Number(m[1]) : null;
  return n && n > 0 && n < 500 ? n : null;
}
