// The NAME check (round 9, 19 Nov 2026). The totals check (receipt-items.js checkItems) only checks money: when Relay
// takes a note, a label or a code under a product as the product's name ("Age restricted product" for "Carling Lager",
// "Pack size: 30 tablets", "Platform: Steam", "XS | BLACK", "Picked weight 0.523kg"), the money still adds up and the
// receipt looked complete. Round 8's first try: 20 of 23 wrong item lists were not flagged for exactly that reason.
//
// suspectItemNames(items, { shop }) → the names that don't look like a thing someone bought, each with why:
//   note       a note or label a shop prints under an item (age checks, substitutions, offers, picked weights, who it is
//              sold by, allergy and delivery notes, "you saved")
//   label      "Size: M", "Platform: Steam", "SKU 12345": a field of the item, not its name
//   only_attrs nothing but a size, colour, format, quantity, price or code ("Navy", "XS | BLACK", "eBook", "12345678")
//   heading    the table's own heading ("Item", "Description", "Qty")
//   short      under two letters, or only punctuation
//   cut        ends in a separator ("Oatmeal ·", "Bamboo Whisk —"): a line cut where another field began
//   price      a price inside the name ("Galvanised Bucket 10L £12.95", "Oat milk +45p")
//   modifier   "No mayo", "Extra cheese": a change to an item, not an item
//   garbled    the wrong character set (â€™ for ’)
//   shop       the shop's own name
//   sentence   reads like a sentence and item-kind-core.js recognises nothing in it
//   leading_qty "1 Cheeseburger": a count glued to the name (only when two or more items start with one, one of them "1")
// The weak signals (shop, sentence) are not raised for a name item-kind-core.js is sure of.
//
// Never accuse: the app says "Some item names on this receipt may not be right" with the email and "Read it again".
// A correct receipt must never be flagged: scripts/test-item-names.mjs checks every name in the corpus, the item-kind lines
// and the pasted receipts (none flagged), and the wrong lists older readers produced (most caught).
import KindCore from "./item-kind-core.js";

const NOTE = [
  /\bage[\s-]?restrict/i, /\bover\s?1[68]s?\b(?:\s+only)?/i, /\bchallenge\s?2[15]\b/i, /\b(?:proof of age|id required|id needed|i\.?d\.? check)\b/i,
  // (Round 9, after the 20 new emails' first run: age verification, weighed items, "Gift wrapped", estimated delivery,
  // pharmacy limits.)
  /\bage (?:verification|check)\b/i, /\bweighed (?:item|at|weight)\b/i, /^gift[- ]wrapped$/i, /\b(?:estimated|expected) (?:delivery|dispatch|arrival)\b/i,
  /\bpharmacy (?:medicine|only)\b/i, /\bmax(?:imum)?\.? \d+ (?:packs?|per (?:customer|order|person))\b/i,
  /\b(?:substitut(?:e|ed|ion|es)|replaced with|swapped for|unavailable|out of stock|not available|couldn'?t get|could not get)\b/i,
  /\b(?:clubcard|nectar|my morrisons|asda) price\b/i, /\brollback\b/i, /\bprice ?match\b/i, /\b(?:promo(?:tion)?|offer) (?:applied|price|saving)\b/i,
  /\b(?:you saved|you save|saving of|saved £)\b/i, /^(?:was|now|save|saving)\b[\s:£]/i,
  /\b(?:picked|estimated|approx\.?|final) weight\b/i, /^weight\b/i,
  /\b(?:dispatch(?:es|ed)? (?:from|by)|sold by|fulfilled by|shipped by|ships from|delivered by)\b/i,
  /\b(?:special instructions?|delivery (?:note|instructions?)|leave (?:it )?(?:at|with|in|by|behind|on)|ring the bell|knock on)\b/i,
  /\ballerg(?:y|ies|en|ens)\b\s*(?::|info|information|advice|warning|note)|\b(?:contains nuts|may contain)\b|^allerg/i,
  /^click (?:&|and) collect\b/i, /^collect(?:ion)? (?:from|at|point|slot|time|date)\b/i, /^(?:delivery|delivered|shipping|postage) (?:to|on|by|date|slot|address)\b/i,
  /^(?:royal mail|evri|hermes|dpd|dhl|ups|yodel|parcelforce|inpost)\b.*\b(?:class|tracked|signed for|delivery|shipping|next day|standard|express|24|48)$/i,
  /\bgift (?:message|note|receipt)\b/i, /^(?:note|notes|comment|instructions?)\s*:/i, /^please\b/i,
  /\b(?:reward|points?) (?:earned|redeemed|applied|used)\b/i, /^(?:pack(?:ed)? in|bagged|bag \d)/i,
];
// "Field: value": a field of the item, not its name.
const LABEL = /^(?:size|sizes|colou?r|shade|pack size|pack|platform|format|edition|style(?: no\.?| number)?|fit|length|leg|width|waist|ref(?:erence)?|sku|ean|upc|mpn|isbn|asin|code|product code|item code|item no\.?|item number|barcode|article(?: no\.?)?|art\.? ?no\.?|cat(?:alogue)?\.? ?no\.?|qty|quantity|price|unit price|each|weight|seller|condition|option|options|variant|choice|type|model(?: no\.?)?|serial(?: no\.?)?|delivery|dispatch|status|personali[sz]ation|engraving|monogram|initials|message|gift message|note)\s*[:#=]/i;
const CODE_LABEL = /^(?:sku|ean|upc|mpn|isbn|asin|product code|item code|item no\.?|style no\.?|cat(?:alogue)?\.? ?no\.?|art\.? ?no\.?|ref(?:erence)?)\b\s*[:.#]?\s*[\w-]*\d/i;
const HEADING_WORD = "(?:item|items|description|product|products|product name|item name|name|qty|quantity|price|unit price|each|total|line total|amount|details|article|size|colour|color|order|your order|order summary|summary|order details|subtotal|cost|tickets?|goods)";
const HEADING = new RegExp(`^${HEADING_WORD}(?:\\s*[/|&,]?\\s*${HEADING_WORD})*\\s*:?$`, "i");
const COLOURS = "black|white|grey|gray|navy|blue|red|green|pink|purple|yellow|orange|brown|beige|cream|ecru|ivory|khaki|olive|tan|camel|stone|sand|charcoal|silver|gold|rust|burgundy|maroon|teal|mint|lilac|oatmeal|nude|multi|multicolou?r|denim|indigo|mustard|coral|sage|light|dark|pale|bright|washed|mid";
const SIZES = "xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|small|medium|large|regular|petite|tall|short|long|one size|onesize|os|uk|eu|us|w\\d{2}|l\\d{2}|size|colou?r|fit";
const FORMATS = "ebook|e-book|kindle edition|paperback|hardback|hardcover|audiobook|audio cd|download|digital(?: code| download)?|physical|dvd|blu-?ray|vinyl|cd";
const ATTR_ONLY = new RegExp(`^(?:(?:${COLOURS}|${SIZES}|${FORMATS}|qty|x|each|ea|per|pack|pcs|units?|[£€$]?\\d[\\d.,]*(?:p|cm|mm|m|ml|l|cl|g|kg|oz|in|")?|[a-z]{0,3}\\d[\\w-]{3,}|[^\\p{L}\\p{N}]+)(?:\\s+|$|(?=[^\\p{L}\\p{N}\\s])))+$`, "iu");
const MODIFIER = /^(?:no|extra|add|without|with|less|light|hold(?: the)?|sub|swap)\s+[\p{L}-]+$/iu;
const CUT = /[·•—–|\/:,;]\s*$|\s[-]\s*$/;
const PRICE_IN = /(?:^|\s)[+-]?[£€$]\s?\d[\d,]*(?:\.\d{1,2})?\b|(?:^|\s)\+\s?\d+p\b|\((?:\+\s?)?(?:[£€$]\d+(?:\.\d\d)?|\d+p)\)$/i;
// (A gift card, voucher or top-up is named by its value: "Gift Card £25".)
const VALUE_NAMED = /\b(?:gift ?cards?|e-?gift|gift ?voucher|vouchers?|wallet|top[- ]?up|credit|cover|gift)\b/i;
const GARBLED = /â€|Ã[\u0080-¿]|Â[£€ ]|�|&(?:amp|nbsp|quot|#\d+);/;
const FUNCTION_WORDS = /\b(?:the|your|you|we|our|us|is|are|was|were|will|has|have|been|be|this|that|it|if|of the|to be|please|thank|thanks|can|cannot|can't|don't|won't|may|should)\b/gi;

const words = (s) => (String(s || "").match(/[\p{L}\p{N}]+/gu) || []);
const norm = (s) => String(s || "").toLowerCase().replace(/\b(?:ltd|limited|plc|uk|co|com|the)\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function why(name, opts, all) {
  const n = String(name || "").replace(/\s+/g, " ").trim();
  const letters = (n.match(/\p{L}/gu) || []).length;
  if (letters < 2) return "short";
  if (GARBLED.test(n)) return "garbled";
  if (LABEL.test(n) || CODE_LABEL.test(n)) return "label";
  if (NOTE.some((re) => re.test(n))) return "note";
  if (MODIFIER.test(n) && !/^no\.\s?\d/i.test(n)) return "modifier";
  if (CUT.test(n)) return "cut";
  // (A deal named by its price, "Any 2 Pre Mixed Cans for £8.00", "3 for £10": the price is the deal's name. Round 11.)
  if (PRICE_IN.test(n) && !VALUE_NAMED.test(n) && !/\b(?:any\s+)?\d{1,2}\b[^£]{0,40}\bfor\s+£\s?\d[\d.,]*$/i.test(n)) return "price";
  // A count glued to the name ("1 Cheeseburger", "2 Garlic Naan"): only when every item on the list starts with one, so a
  // product called "6 Nuggets" or "3 meals for 2 people" on its own is never flagged.
  const counted = all.filter((x) => /^\d{1,2}\s*x?\s+\p{L}/iu.test(String(x.name).trim()));
  if (counted.length >= 2 && counted.some((x) => /^1\s+\p{L}/u.test(String(x.name).trim())) && /^\d{1,2}\s*x?\s+\p{L}/iu.test(n)) return "leading_qty";
  if (ATTR_ONLY.test(n)) return "only_attrs";
  if (HEADING.test(n)) return "heading";
  const kind = KindCore.classify(n, { shop: opts.shop || "" });
  const sure = kind && kind.confidence === "high";
  if (sure) return null;
  const shop = norm(opts.shop);
  if (shop && norm(n) === shop && all.length > 1) return "shop";
  const w = words(n);
  const fn = (n.match(FUNCTION_WORDS) || []).length;
  if (kind.confidence === "low" && w.length >= 5 && (fn >= 2 || /[.!?]$/.test(n))) return "sentence";
  return null;
}

export function suspectItemNames(items, opts = {}) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && typeof i.name === "string");
  const out = [];
  list.forEach((i, k) => { const w = why(i.name, opts, list); if (w) out.push({ index: k, name: i.name, why: w }); });
  return out;
}

// What goes on itemsCheck: namesOk (false when any name looks wrong) and suspectNames (up to 10 of them).
export function namesCheck(items, opts = {}) {
  const s = suspectItemNames(items, opts);
  return s.length ? { namesOk: false, suspectNames: s.slice(0, 10).map((x) => ({ name: String(x.name).slice(0, 120), why: x.why })) } : { namesOk: true };
}
