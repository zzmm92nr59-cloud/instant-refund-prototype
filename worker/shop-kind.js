// What kind of shop a name points to, for shops Relay doesn't know by name. Shop names and web addresses are often words
// run together or cut short ("tvbedsnorthwest", "jdsports", "smithsfurn"), so the name is read letter by letter: it is split
// into the fewest known words (an unknown stretch costs more than a known word), short forms are written out ("furn" is
// furniture, "elec" electrical), and each word that says what is sold adds points to its kind of shopping.
//
// The word that says what is sold usually comes last in an English shop name, and the words before it describe it:
// "TV Beds" sells beds (Home & garden), "TV World" and "The TV Shop" sell televisions, "Bed Linen Outlet" sells linen. So
// the last such word counts double. Places ("North West", "London"), company words ("Ltd", "Direct", "World") and plain
// describing words ("Great", "Best") count for nothing.
//
// The answer is ranked, with how sure it is. Only a clear answer ("high") is used to file receipts; anything less is left
// to the items on the receipt, to what the shopper taught Relay, or (when the AI is on) to one question to Claude about
// the shop's name (shop-kind-ai.js). Nothing here is ever shown as a fact about the shop.

// Words that say what is sold, and the kind of shopping each points to. Relay has no separate sport kind: sportswear and
// trainers are Fashion, as for the sports shops Relay knows.
const SELLS = {
  home: "bed beds bedding bedroom bedrooms mattress mattresses sofa sofas settee settees couch furniture furnishings divan divans ottoman ottomans headboard headboards " +
    "home homes house homeware homewares interior interiors decor kitchen kitchens bath baths bathroom bathrooms tile tiles carpet carpets " +
    "floor floors flooring rug rugs curtain curtains blind blinds light lights lighting lamp lamps garden gardens gardening plant plants " +
    "flower flowers florist florists nursery diy hardware tool tools paint paints pet pets dog dogs cat cats linen linens candle candles cushion cushions " +
    "wallpaper oak pine timber chair chairs table tables desk desks wardrobe wardrobes door doors window windows glazing cookware " +
    "storage shed sheds fencing patio bbq barbecue barbecues mower mowers",
  electronics: "tv tvs television televisions tech technology electronic electronics electrical electricals computer computers pc pcs laptop laptops " +
    "phone phones mobile mobiles gadget gadgets camera cameras audio hifi speaker speakers gaming console consoles printer printers " +
    "appliance appliances cable cables drone drones",
  fashion: "fashion fashions clothing clothes apparel wear boot boots menswear womenswear sportswear boutique shoe shoes footwear trainer trainers sneaker sneakers " +
    "jewellery jewelry jeweller jewellers denim knitwear sport sports style dress dresses handbag handbags bag bags watch watches tailor tailors " +
    "lingerie swimwear outfitters outfitter kit",
  food: "food foods coffee tea teas bakery bakeries baker bakers deli wine wines beer beers brewery brewing distillery pizza pizzeria burger burgers " +
    "sushi cafe restaurant restaurants grill butcher butchers grocer grocers grocery groceries cake cakes chocolate chocolates sweets " +
    "takeaway kebab curry noodle noodles bistro brasserie diner eatery pub tavern juice",
  beauty: "beauty pharmacy pharmacies chemist chemists skin skincare hair salon spa cosmetic cosmetics health wellness fragrance fragrances " +
    "perfume perfumes optician opticians eyewear glasses lens lenses dental vitamin vitamins barber barbers nails",
  travel: "travel trip trips hotel hotels flight flights holiday holidays cottage cottages rail railway railways train trains taxi taxis " +
    "cab cabs coach coaches ferry ferries airways airline airlines parking tour tours hostel",
  digital: "software app apps subscription subscriptions streaming digital broadband vpn hosting",
  experiences: "ticket tickets theatre theatres cinema cinemas event events experience experiences concert concerts bowling karting " +
    "escape attraction attractions",
};
// Words that carry no kind: places, company words, describing words, joining words.
const PLACES = ("north south east west northwest northeast southwest southeast northern southern eastern western central " +
  "uk gb britain british england english scotland scottish wales welsh ireland irish london manchester leeds liverpool bristol glasgow " +
  "edinburgh cardiff birmingham newcastle sheffield nottingham leicester york yorkshire lancashire cheshire kent essex surrey sussex " +
  "devon cornwall midlands highland highlands city town county village").split(" ");
const COMPANY = ("the and of at my our your a an in on by for to n shop shops store stores direct online outlet outlets world centre center " +
  "warehouse depot emporium market mart place hub co company ltd limited plc group brand brands official express plus trade trading " +
  "supplies supply superstore megastore factory mill club studio studios lab labs house works zone land land gallery " +
  "collection collections uk com net org").split(" ");
const DESCRIBE = ("great big little mini super best good top new old blue red green black white gold silver golden royal premier " +
  "quality value cheap discount budget luxury fine prime smart simple pure true first one star bright happy").split(" ");
// Short forms written out before scoring.
const SHORT = { furn: "furniture", furns: "furniture", furni: "furniture", elec: "electrical", elecs: "electricals", electr: "electrical",
  hw: "hardware", appl: "appliances", apps: "apps", tvs: "tvs", hifi: "hifi", diy: "diy", bbq: "bbq", pc: "pc", pcs: "pcs", cosm: "cosmetics",
  pharm: "pharmacy", phar: "pharmacy", jewel: "jewellery", jewels: "jewellery", accs: "accessories", acc: "accessories", intl: "international",
  bros: "brothers", mkt: "market", ctr: "centre", ctre: "centre" };
// Short pieces that are real words in shop names (the split otherwise avoids pieces of two letters).
const TWO = new Set(["tv", "pc", "uk", "gb", "jd", "hp", "ao", "co", "hw", "my", "of", "at", "an", "on", "by", "to", "go"]);
// Short pieces written in capitals when a joined name is spelt out.
const CAPS = new Set(["tv", "tvs", "uk", "gb", "pc", "pcs", "jd", "hp", "ao", "diy", "bbq", "hifi", "led", "dvd", "vpn"]);

// Two words that together name one thing of another kind than either word alone.
const PAIRS = { "bean bag": "home", "bean bags": "home", "tv stand": "home", "tv stands": "home", "tv unit": "home", "tv units": "home",
  "phone case": "electronics", "phone cases": "electronics", "tea room": "food", "tea rooms": "food", "bed linen": "home", "hot tub": "home",
  "hot tubs": "home", "sun bed": "home", "sun beds": "home", "pet food": "home", "travel bags": "fashion", "golf shoes": "fashion" };
const KIND = new Map();
for (const [cat, list] of Object.entries(SELLS)) for (const w of list.split(/\s+/)) if (w && !KIND.has(w)) KIND.set(w, cat);
for (const [w, cat] of Object.entries(PAIRS)) KIND.set(w, cat);
const NEUTRAL = new Set([...PLACES, ...COMPANY, ...DESCRIBE, "accessories", "international", "brothers", "sons", "son", "and", "kids", "baby",
  "toy", "toys", "book", "books", "gift", "gifts", "card", "cards", "party", "music", "art", "arts", "craft", "crafts", "print", "prints", "frame",
  "frames", "car", "cars", "auto", "motor", "motors", "tyre", "tyres", "parts", "bike", "bikes", "cycle", "cycles", "golf", "fit", "fitness", "gym",
  "run", "running", "care", "eye", "eyes", "box", "boxes", "fresh", "farm", "farms", "hand", "made", "design", "designs", "living", "life", "love",
  "jd"]);
// Every word the split knows.
const KNOWN = new Set([...KIND.keys(), ...NEUTRAL, ...Object.keys(SHORT)]);

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’.]/g, "").replace(/&/g, " and ");

// Splits one run of letters into words: the fewest known words wins, and a stretch that isn't a known word costs more the
// longer it is, so "tvbedsnorthwest" is "tv beds northwest" and "jdsports" is "jd sports". Returns [{ w, known }].
export function segment(token) {
  const t = String(token || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!t) return [];
  if (KNOWN.has(t)) return [{ w: t, known: true }];
  const n = t.length, best = new Array(n + 1).fill(null);
  best[0] = { cost: 0, parts: [] };
  for (let i = 0; i < n; i++) {
    if (!best[i]) continue;
    for (let j = i + 1; j <= Math.min(n, i + 24); j++) {
      const piece = t.slice(i, j);
      const known = KNOWN.has(piece) && (piece.length > 2 || TWO.has(piece)) && !(piece.length === 1);
      // A known word costs 1; an unknown stretch 1.5 plus half a point a letter (digits are free: "4u", "365").
      // A single loose letter costs most, so "currys" stays one name rather than "curry" and an "s".
      const cost = known ? 1 : piece.length === 1 ? 4 : 1.5 + 0.5 * piece.replace(/[0-9]/g, "").length;
      const c = best[i].cost + cost;
      if (!best[j] || c < best[j].cost - 1e-9) {
        // Neighbouring unknown stretches join up.
        const prev = best[i].parts[best[i].parts.length - 1];
        const parts = !known && prev && !prev.known ? best[i].parts.slice(0, -1).concat({ w: prev.w + piece, known: false }) : best[i].parts.concat({ w: piece, known });
        best[j] = { cost: c, parts };
      }
    }
  }
  return best[n].parts;
}

// A shop's name (and web address, when there is no name) as words: spaces, capitals inside a name ("GreatBeanBags") and
// joined words are all split, short forms written out.
export function shopWords(name, domain) {
  let text = String(name || "").trim();
  if (!text && domain) text = String(domain).toLowerCase().replace(/^www\./, "").replace(/\.(co\.uk|org\.uk|com|uk|net|org|io|eu|shop|store)$/, "").split(".").pop();
  text = text.replace(/([a-z])([A-Z])/g, "$1 $2");
  let out = [];
  for (const tok of norm(text).split(/[^a-z0-9]+/).filter(Boolean)) {
    // `whole`: every piece of this run of letters is a known word (a word found inside an unknown name, the "cat" in
    // "cathkidston", is no clue at all).
    const parts = segment(tok), whole = parts.every((p) => p.known);
    for (const p of parts) out.push({ w: SHORT[p.w] || p.w, known: p.known, from: p.w, whole });
  }
  // Two words that name one thing ("bean bags" are furniture, not bags) become one.
  for (let i = 0; i + 1 < out.length; i++) {
    const two = out[i].w + " " + out[i + 1].w;
    if (PAIRS[two]) out = out.slice(0, i).concat({ w: two, known: true, from: out[i].from + out[i + 1].from, whole: true }, out.slice(i + 2));
  }
  return out;
}

// The kinds of shopping a shop's name points to: { ranked: [{ category, score }], category, confidence, coverage, words }.
// `category` is set only when the name says so clearly (confidence "high"); "low" means a hint only, "none" nothing at all.
export function shopKind(name, domain) {
  const words = shopWords(name, domain);
  const letters = words.reduce((n, x) => n + x.from.length, 0);
  const knownLetters = words.filter((x) => x.known).reduce((n, x) => n + x.from.length, 0);
  const coverage = letters ? knownLetters / letters : 0;
  const sells = words.map((x, i) => ({ i, cat: KIND.get(x.w), whole: x.whole })).filter((x) => x.cat);
  const score = {};
  sells.forEach((x, k) => { score[x.cat] = (score[x.cat] || 0) + (k === sells.length - 1 ? 2 : 1); });
  const ranked = Object.keys(score).map((c) => ({ category: c, score: score[c] })).sort((a, b) => b.score - a.score);
  const [a, b] = ranked;
  // Sure only when the last word that says what's sold stands on its own (not found inside an unknown name), points the
  // same way as the winner, and nothing else comes close.
  const head = sells[sells.length - 1];
  const confidence = !a ? "none" : a.score >= 2 && (!b || a.score >= b.score * 1.5) && head.whole && head.cat === a.category ? "high" : "low";
  return { ranked, category: confidence === "high" ? a.category : null, confidence, coverage: Math.round(coverage * 100) / 100, words: words.map((x) => x.w) };
}

// A run-together name written out, but only when every piece is a known word ("Tvbedsnorthwest" is "TV Beds North West");
// otherwise null, so a brand Relay doesn't know ("Lululemon") keeps its own spelling.
export function spellOut(token) {
  const t = String(token || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t.length < 6) return null;
  const parts = segment(t);
  if (parts.length < 2 || parts.some((p) => !p.known)) return null;
  return parts.flatMap((p) => (/^(north|south)(east|west)$/.test(p.w) ? [p.w.slice(0, 5), p.w.slice(5)] : [p.w]))
    .map((w) => (CAPS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}
