// Sorts a captured receipt into a shopping group and says whether it can normally be returned.
// This is a best guess from the store and item names, not a fact: the app shows it as a label the shopper can see.
export const CATEGORIES = {
  fashion: "Fashion", electronics: "Electronics", food: "Food & drink", home: "Home & garden",
  beauty: "Beauty & health", travel: "Travel & transport", digital: "Digital & subscriptions", other: "Other",
};
const RULES = [
  ["digital", /\b(app store|itunes|icloud|apple music|apple tv|google play|spotify|netflix|disney\+?|prime video|subscription|membership|gift card|e-?gift|steam|playstation store|xbox|nintendo eshop|audible|kindle|youtube premium|microsoft 365|adobe|dropbox|openai|chatgpt|anthropic|claude\.ai|appcharge|xsolla|in-app purchase|game credits?|top-?up|lycamobile|lyca|giffgaff|voxi|smarty|lebara|tesco mobile|sim only|patreon|substack|onlyfans|twitch|discord nitro|duolingo|notion|canva|github|cloudflare|google one|google workspace)\b/i],
  ["travel", /\b(uber|bolt|trainline|tfl|ryanair|easyjet|british airways|jet2|booking\.com|airbnb|expedia|hotels?|eurostar|national rail|lner|avanti|flights?|taxi|parking)\b/i],
  ["food", /\b(deliveroo|just eat|uber eats|tesco|sainsbury|asda|morrisons|waitrose|lidl|aldi|ocado|co-?op|greggs|pret|costa|starbucks|nando|mcdonald|kfc|domino|pizza|restaurant|cafe|coffee|pub|tavern|bistro|brasserie|diner|burger|sushi|ramen|curry|wetherspoon|leon|itsu|wagamama|five guys|subway|tortilla|wasabi|honest burgers|dishoom|bubble tea|grocer|groceries|bakery|takeaway|wine|beer)\b/i],
  ["electronics", /\b(apple|iphone|ipad|macbook|airpods|samsung|currys|argos|ao\.com|very|dell|lenovo|hp\b|sony|bose|dyson|gopro|nintendo|playstation|laptop|phone|tablet|headphones|charger|cable|monitor|keyboard|camera|television|tv\b|console|smart ?watch)\b/i],
  ["beauty", /\b(boots|superdrug|lookfantastic|space nk|sephora|cult beauty|the body shop|holland & barrett|beauty|skincare|perfume|fragrance|makeup|cosmetic|shampoo|vitamin|pharmacy|optician|specsavers|gr(ü|u)um|grooming|razors?|shaving|dental|toothbrush)\b/i],
  ["home", /\b(ikea|b&q|wickes|screwfix|dunelm|john lewis|wayfair|made\.com|homebase|garden|furniture|sofa|mattress|bedding|lamp|kitchen|candle|rug|curtain|plant)\b/i],
  ["fashion", /\b(lululemon|zara|h&m|asos|next|uniqlo|nike|adidas|puma|new balance|primark|m&s|marks (&|and) spencer|boohoo|shein|gap|levi|ralph lauren|north face|patagonia|jd sports|sports direct|schuh|office shoes|river island|topshop|mango|cos\b|arket|& other stories|jumper|hoodie|jacket|jeans|trousers|dress|shirt|t-?shirt|leggings|shorts|trainers|shoes?|boots?|coat|socks|bra\b|swimwear|bag|handbag)\b/i],
];
const HARDWARE = /\b(iphone|ipad|macbook|imac|mac mini|airpods|apple watch|airtag|charger|cable|case|keyboard|mouse|monitor|laptop|phone|tablet|headphones)\b/i;

// A stable key for a store, so what the app learns about "Zara" applies to every Zara email.
export function storeKey(card) {
  const r = card && card.retailer || {};
  const raw = (r.domain || r.name || "").toLowerCase().replace(/^www\./, "").replace(/\.(co\.uk|com|uk|net|org|io|eu)$/, "");
  return raw.replace(/[^a-z0-9]+/g, "").slice(0, 60);
}

// `learned` is what the app has been taught about this store (a category the shopper chose, or one many shoppers agree on).
export function categorise(card, learned) {
  if (learned && CATEGORIES[learned]) return finish(learned);
  const store = [card.retailer && card.retailer.name, card.retailer && card.retailer.domain].filter(Boolean).join(" ");
  const items = (card.items || []).map(i => i && i.name).filter(Boolean).join(" ");
  const all = store + " " + items;
  let category = "other";
  // Apple sells both phones and App Store credit: the items decide.
  if (/apple/i.test(store) && !HARDWARE.test(items)) category = "digital";
  else {
    for (const [cat, re] of RULES) { if (re.test(items) || re.test(store)) { category = cat; break; } }
  }
  return finish(category);
}
function finish(category) {
  const returnable = category !== "digital" && category !== "food" && category !== "travel";
  const reason = returnable ? null :
    category === "digital" ? "Digital purchases and subscriptions usually can't be returned. Cancel or ask the provider instead." :
    category === "food" ? "Food and drink usually can't be returned." : "Travel and rides usually can't be returned.";
  return { category, categoryLabel: CATEGORIES[category], returnable, notReturnableReason: reason };
}

// A shop name a person would say. Receipts often carry a company's legal name ("Anthropic Ireland, Limited")
// or no name at all, only the sending domain ("appcharge.com"), so this tidies the first and builds one from the second.
const KNOWN_NAMES = { appcharge: "Appcharge", lycamobile: "Lycamobile", shopifyemail: null, stripe: null, paypal: null, squareup: null };
const MAIL_SUBDOMAIN = /^(e|em|email|emails|mail|mailer|news|newsletter|info|hello|noreply|no-reply|orders?|shop|store|click|links?|g|t|m|r|reply|notify|notifications?|updates?|service|customerservice|support|accounts?)$/i;
// Personal email services: a receipt "from" one of these is one the shopper (or a friend) forwarded, not a shop.
export const PERSONAL_MAIL = /(^|\.)(gmail\.com|googlemail\.com|outlook\.com|hotmail\.(com|co\.uk)|live\.(com|co\.uk)|msn\.com|icloud\.com|me\.com|mac\.com|yahoo\.(com|co\.uk)|ymail\.com|aol\.com|proton\.me|protonmail\.com|pm\.me|btinternet\.com|sky\.com|virginmedia\.com)$/i;
export function shopDisplayName(retailer) {
  const r = retailer || {};
  // Never show a person's name as a shop.
  if (PERSONAL_MAIL.test(String(r.domain || ""))) return "Forwarded receipt";
  let name = String(r.name || "").trim();
  if (name) {
    // "Anthropic Ireland, Limited" → "Anthropic"; "Acme UK Ltd." → "Acme"
    const short = name.replace(/,?\s+((ireland|uk|europe|emea|international|holdings|group)\s*,?\s+)?(limited|ltd\.?|llc|l\.l\.c\.|inc\.?|incorporated|plc|gmbh|b\.?v\.?|s\.?a\.?r\.?l\.?|sas|ag|pty)\s*$/i, "").trim();
    return short || name;
  }
  const parts = String(r.domain || "").toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (!parts.length) return null;
  // Drop the country/generic ending (".com", ".co.uk") and any mail-sending subdomain ("e.", "email.").
  while (parts.length > 1 && /^(com|co|uk|net|org|io|eu|ie|de|fr|us|app|shop|store)$/.test(parts[parts.length - 1])) parts.pop();
  const base = parts.filter(p => !MAIL_SUBDOMAIN.test(p)).pop() || parts.pop();
  if (Object.prototype.hasOwnProperty.call(KNOWN_NAMES, base)) return KNOWN_NAMES[base];
  if (!base) return null;
  // "just-eat" → "Just Eat"; "tvbedsnorthwest" → "TV Beds North West" (only when every piece is a known word).
  return base.split("-").filter(Boolean).map(w => splitWords(w) || cap(w)).join(" ");
}
const cap = (w) => SHORT_CAPS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1);
// Short pieces written in capitals in a shop name.
const SHORT_CAPS = new Set(["tv", "uk", "hd", "pc", "diy", "hp", "jd", "bq", "ao", "gb", "eu", "usa", "nyc", "bbq", "led", "dvd"]);
// Common words in UK shop web addresses. A name is only split when every piece is one of these, so unknown brand
// names ("Lululemon", "Gymshark") are left whole rather than chopped up.
const WORDS = new Set(("tv beds bed bedding sofa sofas north south east west northwest northeast southwest southeast " +
  "the and of my our your shop store stores direct online outlet world house home homes garden gardens furniture " +
  "kitchen kitchens bath bathroom bathrooms tile tiles carpet carpets floor floors flooring light lights lighting " +
  "pet pets vet vets dog dogs cat cats food foods fresh farm farms deli bakery wine wines beer beers coffee tea " +
  "fashion style clothing clothes wear shoe shoes boot boots sport sports outdoor outdoors bike bikes cycle cycles " +
  "golf run running fit fitness gym health beauty hair skin care pharmacy chemist eye eyes glasses lens lenses " +
  "baby kids toy toys game games gift gifts card cards party book books music phone phones mobile mobiles tech " +
  "electric electrical electricals electronics computer computers camera cameras sound audio parts car cars auto " +
  "motor motors tyre tyres wheel wheels travel trip hotel hotels flight flights holiday holidays cottage cottages " +
  "london manchester leeds liverpool bristol glasgow edinburgh cardiff birmingham scotland wales england irish " +
  "british great big little mini super best good top new old blue red green black white gold silver box boxes " +
  "trade depot warehouse factory mill market place hub co company group brand brands club studio lab design " +
  "made hand craft crafts paper print prints art arts frame frames plant plants flower flowers tree trees").split(" "));
function splitWords(w) {
  if (w.length < 6 || WORDS.has(w) || SHORT_CAPS.has(w)) return null;
  // Fewest pieces wins, so "northwest" stays one word when it can.
  const best = new Array(w.length + 1).fill(null); best[0] = [];
  for (let i = 0; i < w.length; i++) {
    if (!best[i]) continue;
    for (let j = i + 2; j <= w.length; j++) {
      const piece = w.slice(i, j);
      if (!WORDS.has(piece) && !SHORT_CAPS.has(piece)) continue;
      const next = best[i].concat(piece);
      if (!best[j] || next.length < best[j].length) best[j] = next;
    }
  }
  const parts = best[w.length];
  if (!parts || parts.length < 2) return null;
  // "northwest"/"southeast" read better as two words in a name.
  return parts.flatMap(p => /^(north|south)(east|west)$/.test(p) ? [p.slice(0, 5), p.slice(5)] : [p]).map(cap).join(" ");
}
