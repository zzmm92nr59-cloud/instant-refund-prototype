// Sorts a captured receipt into a shopping group and says whether it can normally be returned.
// This is a best guess from the store and item names, not a fact: the app shows it as a label the shopper can see,
// and the shopper can move a receipt to another group (which then wins for that shop).
// How the guess is made: every clue adds points to a group (a shop Relay knows 6, each item 3, words in the shop's name
// or web address 2, a shop that sells everything 1.5, weak item words such as colours and flavours 1), and the group
// with the most points wins. Nothing scores: Other. When the receipt prices its items, each item counts by its share of
// what they cost, so a £400 television decides an order more than a pint of milk does.
// Every item also gets its own group (itemCategories), so a supermarket shop's kitchen roll is Home & garden and its
// bananas are Food & drink. Wrapped uses those to count each thing, and the money spent on it, where it belongs.
// What an item is comes from one place, item-kind-core.js, which the app uses too (Connor, 18 Nov 2026: a sharing bag of
// Fruit Pastilles was filed as a bag). This file only weighs that against the shop.
import KindCore from "./item-kind-core.js";
import { cleanShopName, isVia, looksLikePerson, nameFromDomain, domainBase as readerBase, GAME_SHOP } from "./receipt-reader.js";
import { shopKind, spellOut } from "./shop-kind.js";
import { SEED as SEED_LIST } from "./shop-seed.js";
export const CATEGORIES = {
  fashion: "Fashion", electronics: "Electronics", food: "Food & drink", home: "Home & garden",
  beauty: "Beauty & health", travel: "Travel & transport", digital: "Digital & subscriptions", experiences: "Tickets & experiences", other: "Other",
};

// 1. Shops Relay knows, by name or web address (letters and digits only: "H&M" is "hm", "Sainsbury's" is "sainsburys").
// A shop's group is used before its item names, so a Zara "phone case" stays Fashion and a Currys kettle stays Electronics.
const SHOP_LIST = {
  experiences: "eventim ticketmaster seetickets axs dice todaytix londontheatredirect atgtickets lwtheatres nimaxtheatres delfontmackintosh " +
    "eventbrite skiddle fatsoma ticketswap stubhub viagogo gigantic ticketline virginexperiencedays buyagift redletterdays experiencedays " +
    "odeon cineworld myvue vue picturehouses everymancinema curzon showcasecinemas altontowers thorpepark legoland chessington merlinentertainments " +
    "londoneye madametussauds sealife wonderdays tripadvisor getyourguide viator klook headout hollywoodbowl tenpin puttshack flightclub " +
    "boomcricket topgolf clipnclimb gravity trampolinepark escaperoom",
  food: "nespresso lavazza illy pactcoffee pact taylorsofharrogate bettys yorkshiretea twinings whittard teapigs clipperteas " +
    "starbucks costa costacoffee caffenero nero pret pretamanger greggs gails joeandthejuice blankstreet " +
    "tesco sainsburys asda morrisons waitrose ocado lidl aldi iceland coop cooperative spar budgens londis nisa costco amazonfresh " +
    "deliveroo justeat ubereats boltfood wolt gousto hellofresh mindfulchef simplycook abelandcole riverford oddbox milkandmore getir gorillas zapp toogoodtogo " +
    "beer52 virginwines majestic majesticwine laithwaites nakedwines thewhiskyexchange whiskyexchange masterofmalt " +
    "honestburgers dishoom nandos wagamama fiveguys mcdonalds kfc burgerking dominos papajohns pizzahut pizzaexpress francomanca " +
    "pandamami gordonramsayrestaurants gordonramsay hawksmoor flatiron bao padella greeneking stonegate stonegatepubs " +
    "wetherspoon jdwetherspoon wetherspoons leon itsu wasabi yosushi tortilla chipotle krispykreme hotelchocolat thorntons lindt cadbury graze huel myprotein bulk grenade",
  travel: "uber bolt freenow addisonlee gett trainline tfl nationalrail lner avanti avantiwestcoast gwr southeastern southernrailway thameslink " +
    "northernrailway transpennine tpexpress crosscountry scotrail c2c greateranglia chilternrailways lumo grandcentral hulltrains eurostar " +
    "megabus nationalexpress flixbus stagecoach firstbus arriva lime voi tier santandercycles zipcar hertz avis europcar sixt getaround " +
    "ringgo justpark paybyphone paylink paylinkmobile ncp heathrowexpress gatwickexpress stanstedexpress poferries dfds stenaline brittanyferries calmac redfunnel wightlink " +
    "ryanair easyjet britishairways ba jet2 jet2holidays wizzair virginatlantic emirates qatarairways klm airfrance lufthansa tui loganair aerlingus " +
    "vueling iberia norwegian turkishairlines bookingcom booking airbnb expedia hotelscom hotels trivago premierinn travelodge hilton marriott ihg " +
    "holidayinn accor ibis novotel citizenm skyscanner kayak lastminute onthebeach loveholidays haystravel trailfinders sykescottages hoseasons " +
    "centerparcs haven butlins omio holidayextras opodo edreams hostelworld agoda vrbo tripcom kiwicom etihad",
  digital: "itunes icloud applemusic appletv googleplay spotify netflix disney disneyplus primevideo audible kindle youtube youtubepremium " +
    "microsoft365 adobe dropbox openai chatgpt anthropic claude appcharge xsolla steam steampowered playstationstore xbox nintendoeshop epicgames " +
    "roblox ubisoft patreon substack onlyfans twitch discord discordnitro duolingo notion canva github cloudflare googleone googleworkspace " +
    "lycamobile lyca giffgaff voxi smarty lebara tescomobile ee o2 vodafone three virginmedia bt sky nowtv plusnet talktalk hyperoptic " +
    "communityfibre idmobile deezer tidal nytimes thetimes theguardian economist ft medium strava headspace calm tinder hinge bumble linkedin " +
    "grammarly 1password nordaccount elevenlabs nordvpn expressvpn surfshark proton protonmail zoom slack figma paramountplus britbox discoveryplus dazn crunchyroll " +
    "wix squarespace godaddy namecheap clarechampion meta metaquest oculus",
  electronics: "samsung currys ao aocom dell lenovo hp sony bose dyson gopro nintendo playstation oneplus xiaomi huawei anker belkin logitech " +
    "razer corsair scan overclockers ebuyer cex webuy backmarket musicmagpie sonos jbl bangolufsen garmin fitbit ring panasonic lg tcl hisense " +
    "canon nikon fujifilm wexphoto jessops richersounds raspberrypi pimoroni thepihut game googlestore laptopsdirect appliancesdirect novatech cclonline " +
    "argos very",
  beauty: "boots superdrug lookfantastic spacenk sephora cultbeauty thebodyshop bodyshop hollandbarrett hollandandbarrett beautybay feelunique " +
    "charlottetilbury glossier theordinary deciem cerave larocheposay clinique esteelauder maccosmetics benefitcosmetics nyxcosmetics rituals lush " +
    "loccitane jomalone moltonbrown aesop nealsyardremedies elemis kiehls fentybeauty rarebeauty hudabeauty glossybox birchbox beautypie notino " +
    "escentual theperfumeshop perfumeshop fragrancedirect thefragranceshop fragranceshop specsavers visionexpress myvitamins vitabiotics hims numan " +
    "lloydspharmacy wellpharmacy chemist4u pharmacy2u simpleonlinepharmacy oralb gillette harrys kingofshaves ghd cloudnine babyliss gruum nivea " +
    "olaplex kerastase aveda bareminerals nars urbandecay toofaced drunkelephant paulaschoice theinkeylist inkeylist revolutionbeauty makeuprevolution " +
    "elfcosmetics healthspan lumin luminskin thescentreserve scentreserve",
  home: "ikea bq bandq diy wickes screwfix toolstation dunelm johnlewis wayfair made madecom homebase habitat therange bm bmstores homebargains wilko " +
    "robertdyas lakeland lecreuset josephjoseph oliverbonas hmhome zarahome laredoute loaf sofa sofacom dfs sofology furniturevillage oakfurnitureland " +
    "cotswoldco swoon thewhitecompany whitecompany sohohome heals conranshop coxandcox rockettstgeorge grahamandgreen emmasleep simbasleep evesleep otty " +
    "silentnight dreams bensonsforbeds mattressonline bedkingdom crocus thompsonmorgan suttons vanmeuwen primrose gardeningexpress patch " +
    "beardsanddaisies hortology bloomandwild interflora yankeecandle neom petsathome zooplus jollyes tails butternutbox lilyskitchen " +
    "tempur sharkninja ninjakitchen karaca eflorist myeflorist greatbeanbags nkuku denelli homary bowsandwhistles",
  fashion: "rains lululemon zara hm handm asos next uniqlo nike adidas puma newbalance primark boohoo boohooman prettylittlething missguided shein gap " +
    "levi levis ralphlauren thenorthface northface patagonia jdsports sportsdirect schuh office officeshoes riverisland topshop topman mango cos " +
    "cosstores arket otherstories andotherstories weekday monki massimodutti pullandbear pullbear bershka stradivarius reiss allsaints tedbaker " +
    "whistles jigsaw hobbs phaseeight monsoon whitestuff fatface joules seasalt seasaltcornwall boden superdry hollister abercrombie " +
    "abercrombieandfitch urbanoutfitters freepeople anthropologie selfridges harveynichols liberty libertylondon endclothing mrporter netaporter " +
    "matchesfashion farfetch ssense mytheresa drmartens clarks kurtgeiger russellandbromley vans converse birkenstock ugg timberland skechers crocs " +
    "gymshark sweatybetty aloyoga oysho carhartt carharttwip stussy dickies barbour hunter hunterboots mulberry coach michaelkors katespade pandora " +
    "swarovski monicavinader missoma astridandmiyu danielwellington hsamuel ernestjones goldsmiths beaverbrooks rayban matalan newlook quiz " +
    "quizclothing inthestyle nastygal karenmillen coast oasis warehouse sezane ganni acnestudios jacquemus axelarigato veja onrunning hoka asics " +
    "salomon arcteryx rab montane mountainwarehouse cotswoldoutdoor blacks gooutdoors regatta craghoppers berghaus jackwolfskin columbia decathlon " +
    "underarmour reebok fila ellesse lacoste tommyhilfiger calvinklein hugoboss armani gucci prada burberry louisvuitton balenciaga moncler " +
    "canadagoose stoneisland fredperry jackandjones veromoda nobodyschild marksspencer marksandspencer ms " +
    "tiffany ctshirts charlestyrwhitt detalecph",
};
// Names that are also ordinary words ("Next", "Very", "Office", "Boots"): these only count when they are the shop's whole
// name or web address, never one word in a longer name ("Post Office" is not the shoe shop).
const WHOLE_ONLY = new Set(("next very office gap cos mango arket weekday whistles jigsaw hobbs monsoon joules seasalt boden liberty vans ugg " +
  "coach pandora quiz coast oasis warehouse rab blacks columbia hunter boots game scan ring ao hp lg bolt lime tier ba ee o2 three bt sky calm " +
  "ft made sofa dreams patch tails bm bq diy booking hotels hm ms costa nero bulk leon iceland spar tortilla wasabi haven ibis avis steam " +
  "claude kindle notion medium proton discord zoom slack tidal hinge strava office meta gravity").split(" "));
// Shops that sell a bit of everything: what was bought decides, and the shop's usual group is only used when the items don't say.
const MIXED = new Set(("amazon amazonfresh ebay argos very johnlewis tesco asda sainsburys marksspencer marksandspencer ms selfridges harrods tkmaxx " +
  "temu aliexpress etsy notonthehighstreet costco bm bmstores wilko homebargains therange next debenhams houseoffraser qvc groupon wowcher " +
  "vinted depop lidl aldi").split(" "));
// Supermarkets and food delivery: their food is never returnable, whatever the item is called ("paper cups").
const GROCER = new Set("tesco asda sainsburys morrisons waitrose ocado lidl aldi iceland coop cooperative spar budgens londis nisa costco amazonfresh deliveroo justeat ubereats boltfood wolt getir gorillas zapp".split(" "));
// What a supermarket shop is made of: food, household things and toiletries all count as the groceries.
const GROCERIES = new Set(["food", "home", "beauty"]);
// Betting and casinos: never something to return.
const NO_RETURN = /\b(casino|bet365|betfair|paddy ?power|william ?hill|sky ?bet|ladbrokes|betway|betfred|coral|bingo|lottery|lotto|poker|slots?)\b|admiralcasino|nationallottery/i;
const SHOPS = new Map();
for (const [cat, list] of Object.entries(SHOP_LIST)) for (const k of list.split(/\s+/)) if (k && !SHOPS.has(k)) SHOPS.set(k, cat);
for (const k of MIXED) if (!SHOPS.has(k)) SHOPS.set(k, null);

// 2. What the items are: item-kind-core.js reads each line (pack sizes, the thing named last, brands); its answer is put
// in this file's groups.
const { classify: classifyLine, isLasting } = KindCore;
// Generic words in a shop's own name, for shops Relay doesn't know ("The Red Lion Pub", "Northwest Beds").
const NAME_WORDS = [
  ["food", /\b(pub|tavern|inn|restaurant|cafe|café|coffee|roasters?|espresso|bakery|patisserie|takeaway|pizza|pizzeria|burger|sushi|ramen|curry|grill|kitchen|deli|butchers?|grocer|groceries|wine|wines|beer|brewery|brewing|distillery|tea|tearoom|bistro|brasserie|diner|eatery|noodle|dumplings?|bubble tea|juice|food|foods|chocolate|chocolatier|cakes?|sweets)\b/i],
  ["travel", /\b(taxi|taxis|cabs?|cars|airport|airways|airlines?|rail|railway|trains?|hotels?|hostel|inn hotel|parking|car hire|travel|holidays?|cottages?|ferries|coaches|tours?)\b/i],
  ["beauty", /\b(pharmacy|chemist|beauty|cosmetics|skin|skincare|salon|spa|barbers?|opticians?|eyewear|dental|dentist|health|wellness|fragrances?|perfumes?)\b/i],
  ["electronics", /\b(electronics|electricals?|electrical|tech|technology|computers?|phones|mobiles|gadgets|cameras?|audio|hifi|hi-fi|gaming)\b/i],
  ["home", /\b(furniture|beds|bedding|bean ?bags?|sofas?|mattress(es)?|garden|gardens|plants?|flowers|florist|interiors?|homewares?|home|kitchens|bathrooms?|lighting|diy|hardware|carpets?|flooring|tiles|paint|pets?)\b/i],
  ["fashion", /\b(fashion|clothing|clothes|apparel|boutique|shoes|footwear|wear|jewell?ery|jewellers?|denim|knitwear|sportswear|outdoor clothing|tailoring|tailors?)\b/i],
  ["digital", /\b(software|apps?|subscriptions?|streaming|games store|digital edition|newspapers?|magazines?|news)\b/i],
  ["experiences", /\b(tickets?|theatres?|theaters?|cinemas?|concerts?|events?|experiences?|attractions?|escape rooms?|bowling|karting)\b/i],
];
const HARDWARE = /\b(iphone|ipad|macbook|imac|mac mini|mac studio|airpods|apple watch|airtag|apple tv 4k|homepod|apple pencil|magic (mouse|keyboard|trackpad)|charger|cable|case|keyboard|mouse|monitor|laptop|phone|tablet|headphones)\b/i;
// Kitchen things a coffee or food shop also sells: they can usually be returned even though the group is Food & drink.
const APPLIANCE = /\b(machines?|frothers?|aeroccino|grinders?|kettles?|toasters?|blenders?|cafeti[eè]res?|french press|mugs?|cups|glass(es)?|tumblers?|flasks?|carafes?)\b/i;
const EATERY_APPLIANCE = /\b(machines?|frothers?|aeroccino|grinders?|kettles?|toasters?|blenders?|cafeti[eè]res?|french press|mugs?|tumblers?|flasks?)\b/i;
// The order ties are settled in: groups that can usually be returned first, so a return window is never hidden.
const TIE_ORDER = ["electronics", "fashion", "home", "beauty", "food", "digital", "travel", "experiences"];

// A stable key for a store, so what the app learns about "Zara" applies to every Zara email.
// A payment or ordering company's address (Shopify, Stripe, Square…) is shared by many shops, so there the shop's name is used.
export function storeKey(card) {
  const r = card && card.retailer || {};
  const raw = ((isVia(r.domain) || isVia(r.via)) && r.name ? r.name : r.domain || r.name || "").toLowerCase().replace(/^www\./, "").replace(/["']/g, "").replace(/\.(co\.uk|com|uk|net|org|io|eu)$/, "");
  return raw.replace(/[^a-z0-9]+/g, "").slice(0, 60);
}
// The key this store had before payment companies' addresses were handled (kept so what a shopper taught Relay still applies).
export function legacyStoreKey(card) {
  const r = card && card.retailer || {};
  const raw = (r.via || r.domain || r.name || "").toLowerCase().replace(/^www\./, "").replace(/\.(co\.uk|com|uk|net|org|io|eu)$/, "");
  return raw.replace(/[^a-z0-9]+/g, "").slice(0, 60);
}

// Lower case, accents off, apostrophes and dots dropped ("Sainsbury's" → "sainsburys", "Booking.com" → "bookingcom"), then words.
const words = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/['’.]/g, "")
  .split(/[^a-z0-9]+/).filter(Boolean);
const FILLER = new Set(["uk", "gb", "ltd", "limited", "plc", "inc", "llc", "gmbh", "official", "store", "stores", "shop", "online", "london", "europe", "eu", "international", "group", "co", "com", "the"]);
// The shop's web address without its country ending or mail-sending part: "e.rains.com" → "rains", "email.hm.com" → "hm".
function domainBase(domain) { return readerBase(domain).replace(/[^a-z0-9]/g, ""); }
// The shop Relay recognises in a receipt, if any: { key, cat } (cat is null for a shop that sells everything).
export function knownShop(card) {
  const r = card && card.retailer || {};
  const w = words(r.name);
  let core = w.slice();
  while (core.length > 1 && FILLER.has(core[core.length - 1])) core.pop();
  while (core.length > 1 && FILLER.has(core[0])) core.shift();
  const whole = core.join("");
  // The whole name first, then the longest run of words in it, then the web address.
  if (SHOPS.has(whole) || SHOPS.has(w.join(""))) { const k = SHOPS.has(whole) ? whole : w.join(""); return { key: k, cat: SHOPS.get(k) }; }
  for (let n = Math.min(4, w.length); n >= 1; n--) {
    for (let i = 0; i + n <= w.length; i++) {
      const k = w.slice(i, i + n).join("");
      if (SHOPS.has(k) && !WHOLE_ONLY.has(k) && k.length >= 3) return { key: k, cat: SHOPS.get(k) };
    }
  }
  const d = domainBase(r.domain);
  if (d && SHOPS.has(d)) return { key: d, cat: SHOPS.get(d) };
  return null;
}
// What an item's own name says: 3 points when the name says what the thing is (item-kind-core.js is sure), 2 for a shop's
// name inside the item's ("Nespresso Vertuo Pods" bought on Amazon) when the core can't tell, 1 when only a flavour or a pack
// size says so ("Single origin coffee", "Thing 500g"); null when the name doesn't say, or says it is something none of the
// groups is for (stamps, a warranty).
// The same names come up again and again (the weekly shop), so each answer is remembered for a while.
const NAMES_SEEN = new Map();
function namePoints(name) {
  if (NAMES_SEEN.has(name)) return NAMES_SEEN.get(name);
  if (NAMES_SEEN.size >= 4000) NAMES_SEEN.clear();
  const found = (() => {
    const k = classifyLine(name);
    if (k.confidence === "high" || k.confidence === "ai") return { cat: k.group, pts: 3 };
    const w = words(name);
    for (let n = Math.min(3, w.length); n >= 1; n--) for (let i = 0; i + n <= w.length; i++) {
      const key = w.slice(i, i + n).join("");
      if (SHOPS.get(key) && !WHOLE_ONLY.has(key) && !MIXED.has(key) && key.length >= 4) return { cat: SHOPS.get(key), pts: 2 };
    }
    return k.confidence === "medium" ? { cat: k.group, pts: 1 } : null;
  })();
  NAMES_SEEN.set(name, found);
  return found;
}
const nameOf = (it) => (it && typeof it.name === "string" ? it.name : "");
// What one line cost (its price times how many, unless the price is already the line's), or null when it isn't priced.
function lineValue(it) {
  const p = it && it.pricePence;
  if (!Number.isInteger(p)) return null;
  return p < 0 ? 0 : p * (it.lineTotal ? 1 : Number(it.qty) > 1 ? Number(it.qty) : 1);
}
// How much each item counts. When most items are priced, each counts by its share of what they cost (scaled so the
// items still add up to one each overall), and an unpriced one counts as an average one; otherwise one each.
function itemWeights(items) {
  const named = (items || []).map(nameOf);
  const n = named.filter(Boolean).length;
  const vals = (items || []).map((it, i) => (named[i] ? lineValue(it) : null));
  const priced = vals.filter(v => v != null);
  const one = named.map(x => (x ? 1 : 0));
  if (n < 2 || priced.length < n * 2 / 3) return one;
  const avg = priced.reduce((a, b) => a + b, 0) / priced.length;
  const v = vals.map((x, i) => (named[i] ? (x == null ? avg : x) : 0));
  const sum = v.reduce((a, b) => a + b, 0);
  return sum > 0 ? v.map(x => x * n / sum) : one;
}
// "GreatBeanBags" → "Great Bean Bags", so the words in a shop's name can be read.
const spaced = (s) => String(s || "").replace(/([a-z])([A-Z])/g, "$1 $2");
// The shop Relay recognises, and the group the words in its own name point to (for shops it doesn't know).
function shopClues(card) {
  const r = card.retailer || {};
  const shown = shopDisplayName(r);
  const named = shown && shown !== "Forwarded receipt" ? shown : null;
  const shop = knownShop({ retailer: { name: named || r.name, domain: isVia(r.domain) ? null : r.domain } }) || knownShop({ retailer: { name: r.legalName } });
  const nameText = [spaced(named), spaced(r.name), spaced(r.legalName)].filter(Boolean).join(" ");
  const domainText = isVia(r.domain) ? "" : (nameFromDomain(r.domain) || "");
  // For a shop Relay doesn't know: what its name says, read word by word (shop-kind.js: "Tvbedsnorthwest" is TV Beds North
  // West, which sells beds), when that is clear; else a kind-of-shop word anywhere in its name; else what Claude said about
  // the shop's name once (shop-kind-ai.js, `shopKindAi`), unless that was "other".
  let nameGroup = null;
  if (!shop) {
    const k = shopKind(named || r.name || r.legalName, isVia(r.domain) ? null : r.domain);
    nameGroup = k.category || (!named && !r.name ? null : shopKind(null, isVia(r.domain) ? null : r.domain).category);
  }
  if (!nameGroup) for (const [c, re] of NAME_WORDS) if (re.test(nameText) || re.test(domainText)) { nameGroup = c; break; }
  if (!nameGroup && !shop && CATEGORIES[card.shopKindAi] && card.shopKindAi !== "other") nameGroup = card.shopKindAi;
  return { shop, nameGroup };
}

// Every group's points for a receipt.
export function categoryScores(card) {
  card = card || {};
  const score = {};
  const add = (c, n) => { score[c] = (score[c] || 0) + n; };
  const { shop, nameGroup } = shopClues(card);
  if (shop && shop.cat) add(shop.cat, MIXED.has(shop.key) ? 1.5 : 6);
  const w = itemWeights(card.items);
  (card.items || []).forEach((it, i) => { const own = nameOf(it) && namePoints(nameOf(it)); if (own) add(own.cat, own.pts * w[i]); });
  if (nameGroup) add(nameGroup, 2);
  return score;
}

// 3. What each item on a receipt most likely is, on its own, as [{ category, points, sure, ranked }] in the order of
// card.items (null for a line with no name, or one that nothing points anywhere). Each item gets points for every group:
// from its own name (as above: 3, 2 or 1) and from where it was bought. A shop Relay knows lends its group 1.5, so a
// Lush "Honey" soap stays Beauty & health while a phone charger from it would still be Electronics; a supermarket lends
// Food & drink 1, because most of what it sells is food even when the name doesn't say ("Highland Venison Grillsteaks");
// a shop that sells everything lends its usual group 0.5; a shop whose own name says what it sells lends that 1; and a
// group the shopper chose for the shop lends 1.5. The item takes the group with the most points (ties go the TIE_ORDER
// way); `sure` is true when its own name decided it, and `ranked` lists every group it scored for, most likely first.
export function itemCategories(card, learned) {
  card = card || {};
  const { shop, nameGroup } = shopClues(card);
  const lean = learned && CATEGORIES[learned] && learned !== "other" ? { cat: learned, pts: 1.5 }
    : shop && GROCER.has(shop.key) ? { cat: "food", pts: 1 }
    : shop && shop.cat ? { cat: shop.cat, pts: MIXED.has(shop.key) ? 0.5 : 1.5 }
    : nameGroup ? { cat: nameGroup, pts: 1 } : null;
  return (card.items || []).map(it => {
    const name = nameOf(it);
    if (!name) return null;
    const own = namePoints(name), pts = {};
    if (lean) pts[lean.cat] = lean.pts;
    if (own) pts[own.cat] = (pts[own.cat] || 0) + own.pts;
    const ranked = TIE_ORDER.filter(c => pts[c]).sort((a, b) => pts[b] - pts[a] || TIE_ORDER.indexOf(a) - TIE_ORDER.indexOf(b));
    if (!ranked.length) return null;
    return { category: ranked[0], points: pts[ranked[0]], sure: Boolean(own && own.cat === ranked[0]), ranked: ranked.map(c => ({ category: c, points: pts[c] })) };
  });
}
// How a receipt's money splits by what each item is: [{ category, share, items }] (shares add up to 1, biggest first), from
// each item's own group (the one the receipts list gave it, or worked out here) and what it cost. `items` are the
// positions in card.items. Null when that can't be told without guessing: an item isn't priced, the prices don't come
// near the total (a misread price), or everything is one kind of thing. Items nothing points anywhere go with the
// receipt's own group.
export function categoryShares(card) {
  card = card || {};
  const at = (card.items || []).map((it, i) => (nameOf(it) ? i : -1)).filter(i => i >= 0);
  if (at.length < 2 || !Number.isInteger(card.totalPence) || card.totalPence <= 0) return null;
  const vals = at.map(i => lineValue(card.items[i]));
  if (vals.some(v => v == null)) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  if (!sum || sum > card.totalPence * 1.5 || sum < card.totalPence * 0.5) return null;
  const listed = at.every(i => typeof card.items[i].category === "string");
  const worked = listed ? null : itemCategories(card);
  const by = new Map();
  at.forEach((i, j) => {
    const k = (listed ? card.items[i].category : worked[i] && worked[i].category) || (CATEGORIES[card.category] ? card.category : "other");
    const e = by.get(k) || { category: k, share: 0, items: [] };
    e.share += vals[j] / sum; e.items.push(i); by.set(k, e);
  });
  return by.size > 1 ? [...by.values()].sort((a, b) => b.share - a.share) : null;
}

// `learned` is what the app has been taught about this store (a category the shopper chose, or one many shoppers agree on).
// (The seller says what was bought can't go back, a personalised order: not returnable, with the seller's own reason, so no
// return date is worked out for it. Round 15.)
export function categorise(card, learned) {
  const out = categoriseBy(card, learned);
  const said = card && card.returns && card.returns.sellerNoReturn;
  return typeof said === "string" && said ? { ...out, returnable: false, notReturnableReason: said } : out;
}
function categoriseBy(card, learned) {
  card = card || {};
  const items = (card.items || []).map(i => i && i.name).filter(Boolean).join(" ");
  const r = card.retailer || {};
  const store = [r.name, r.legalName, r.domain].filter(Boolean).join(" ");
  const noReturn = NO_RETURN.test(store);
  if (learned && CATEGORIES[learned]) return finish(learned, items, noReturn);
  // A booking the reader found flights in (flight-booking.js) is travel, whoever it was booked with.
  if (Array.isArray(card.flights) && card.flights.length) return finish("travel", items, noReturn);
  // Apple sells both phones and App Store credit: the items decide.
  if (/(^|\b|\.)apple(\b|\.)/i.test(store) && !/applebee/i.test(store) && !isVia(r.domain)) return finish(HARDWARE.test(items) ? "electronics" : "digital", items, noReturn);
  // (Amazon's digital orders, numbered "D01-…" (Prime Video films and rentals, Kindle books, apps), are digital whatever their
  // lines say, so nothing is ever offered back for a film watched. A café, restaurant, pub or takeaway's bill is food and
  // drink, whatever a dish is called ("BBQ" is not a barbecue for the garden). Round 15.)
  if (/(^|\.)amazon\.[a-z.]+$/i.test(String(r.domain || "")) && /^D\d{2}-\d{7}-\d{7}$/i.test(String(card.orderRef || "").trim())) return finish("digital", items, noReturn);
  if (shopHintFor(card) === "eatery") return finish("food", items, noReturn, false, true);
  const score = categoryScores(card);
  let best = null;
  for (const c of TIE_ORDER) if (score[c] && (!best || score[c] > score[best])) best = c;
  const { shop } = shopClues(card);
  // A supermarket shop is groceries, even when kitchen roll, bin bags and shower gel outnumber what the reader can tell
  // is food. Each item is scored on its own (one whose name doesn't say counts as the supermarket's food) and counted by
  // what it cost; food, household and toiletries together are the groceries, and only an order where one other kind of
  // thing outweighs them (a supermarket's clothing or tech range) is filed as that.
  if (shop && GROCER.has(shop.key)) {
    const w = itemWeights(card.items), share = {};
    itemCategories(card).forEach((k, i) => { if (k) share[k.category] = (share[k.category] || 0) + w[i]; });
    const grocery = [...GROCERIES].reduce((n, c) => n + (share[c] || 0), 0);
    let range = null;
    for (const c of TIE_ORDER) if (!GROCERIES.has(c) && share[c] && (!range || share[c] > share[range])) range = c;
    best = range && share[range] > grocery + 1e-9 ? range : "food";
  }
  return finish(best || "other", items, noReturn, best === "food" && Boolean(shop && GROCER.has(shop.key)));
}

// What kind of shop a receipt is from, for reading its lines (item-kind-core.js): "eatery" (a café, restaurant, pub or
// takeaway), "grocer" (a supermarket or food delivery), the group of a shop Relay knows or whose name says what it sells,
// or null.
// Relay's list of real UK shops (shop-seed.js), by the shop's whole name or web address: what each mostly sells, for
// reading its lines. A department store or marketplace gives no hint (its items decide); a pet shop says so, so its
// chicken is the dog's (DIY and trade shops are told by name in item-kind-core.js: a garden centre's café is still food).
const SEED_HINT = { clothing: "fashion", shoes: "fashion", sport: "fashion", jewellery: "fashion", electronics: "electronics", home: "home",
  diy: "home", beauty: "beauty", pets: "pets", supermarket: "grocer" };
const SEED_KIND = new Map();
for (const [kind, list] of Object.entries(SEED_LIST)) for (const entry of list) for (const n of entry.split("|")) {
  const k = String(n).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  if (k.length >= 3 && !SEED_KIND.has(k)) SEED_KIND.set(k, kind);
}
function seedKindOf(card) {
  const r = card.retailer || {};
  const sq = (x) => String(x || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  for (const n of [shopDisplayName(r), r.name]) { const k = sq(n); if (k && SEED_KIND.has(k)) return SEED_KIND.get(k); }
  const d = isVia(r.domain) ? "" : domainBase(r.domain);
  return d && SEED_KIND.has(d) ? SEED_KIND.get(d) : null;
}
export function shopHintFor(card) {
  card = card || {};
  const { shop, nameGroup } = shopClues(card), r = card.retailer || {};
  if (shop && EATERY.has(shop.key)) return "eatery";
  // (A bill paid through a pub or restaurant's own ordering or paying service, "Brewdog" by Pepper, "Kricket" by sunday, is
  // the place's food and drink. Round 15.)
  if (EATERY_VIA.test(String(r.via || "")) || EATERY_VIA.test(String(r.domain || ""))) return "eatery";
  if (shop && GROCER.has(shop.key)) return "grocer";
  // A shop that sells a bit of everything (Argos, Very, John Lewis, M&S): what each item is called decides.
  if (shop && MIXED.has(shop.key)) return null;
  const seed = seedKindOf(card);
  if (seed) return SEED_HINT[seed] || null;
  if (EATERY_NAME.test([spaced(shopDisplayName(r)), spaced(r.name)].filter(Boolean).join(" "))) return "eatery";
  return (shop && shop.cat) || nameGroup || null;
}
// A supermarket or food delivery receipt (Sainsbury's, Tesco, Ocado…): its food, cleaning things and toiletries are the
// groceries. Wrapped counts those as Food & drink, so a supermarket is never anyone's "go-to for the home".
export function isGrocer(card) { const { shop } = shopClues(card || {}); return Boolean(shop && GROCER.has(shop.key)); }
// A thing that lasts (a kettle, a duvet, a lamp, a jumper, headphones) rather than gets used up, by the item's own name
// (item-kind-core.js, sure): bought at a supermarket, it counts as what it is.
export function lastingThing(name) {
  const n = typeof name === "string" ? name : "";
  return Boolean(n) && isLasting(classifyLine(n));
}
// What one thing bought is, from its name alone, when that is clear ("Kitchen Towels" is Home & garden, "Greek Yoghurt"
// is Food & drink); null when the name doesn't say. Used to keep each Wrapped chapter's top items to that kind of thing.
export function itemKind(name) {
  const n = typeof name === "string" ? name : "";
  if (!n) return null;
  const k = classifyLine(n);
  return k.confidence === "low" ? null : k.group;
}
// What each item is in item-kind-core.js's own words, with the shop's kind to help, and the AI's answers for shoppers who
// switched AI on (`ai`: { "<item name, lower case>": { type, sure } }, worker/item-kinds.js). In card.items' order; null
// for a line with no name.
export function itemKinds(card, ai) {
  card = card || {};
  const hint = shopHintFor(card), shop = shopDisplayName(card.retailer || {}) || "";
  return (card.items || []).map(it => (nameOf(it) ? classifyLine(nameOf(it), { shop, shopKind: hint, ai }) : null));
}
// 4. Things in a food or supermarket order that can usually go back on their own (a kettle, a jumper or headphones in the
// weekly shop, a pair of shorts from a sports-nutrition shop) while the food can't. Only items whose own name says what they
// are (`sure`), that last rather than get used up (item-kind-core.js: not kitchen roll, cleaning things, batteries, bulbs,
// ink, bags, candles or plants), that cost £5 or more each when the receipt prices them, and never from a café, restaurant,
// pub or takeaway (whose "chicken strips basket" is a meal). Returns their positions in card.items.
const EATERY = new Set(("starbucks costa costacoffee caffenero nero pret pretamanger greggs gails joeandthejuice blankstreet deliveroo justeat ubereats " +
  "boltfood wolt honestburgers dishoom nandos wagamama fiveguys mcdonalds kfc burgerking dominos papajohns pizzahut pizzaexpress francomanca " +
  "pandamami gordonramsayrestaurants gordonramsay hawksmoor flatiron bao padella greeneking stonegate stonegatepubs wetherspoon jdwetherspoon " +
  "wetherspoons leon itsu wasabi yosushi tortilla chipotle krispykreme").split(" "));
const EATERY_VIA = /(^|\.)(pepperhq\.com|sundayapp\.io|slerp\.com|touchtakeaway\.net|toasttab\.com|flipdish\.com|orderyoyo\.com|mryum\.com|storekit\.com)$/i;
const EATERY_NAME = /\b(pub|tavern|inn|arms|restaurant|cafe|café|coffee house|bakery|patisserie|takeaway|pizza|pizzeria|burgers?|sushi|ramen|curry|grill|deli|bistro|brasserie|diner|eatery|noodles?|dumplings?|bubble tea|kebabs?|chippy|fish (and|&) chips|bar)\b/i;
export function returnableItems(card, kinds) {
  card = card || {};
  if (shopHintFor(card) === "eatery") return [];
  kinds = kinds || itemCategories(card);
  const own = itemKinds(card);
  const out = [];
  (card.items || []).forEach((it, i) => {
    const k = kinds[i], name = nameOf(it);
    if (!k || !k.sure || !name || !isLasting(own[i])) return;
    if (Number.isInteger(it.pricePence)) {
      const each = it.lineTotal && Number(it.qty) > 1 ? it.pricePence / Number(it.qty) : it.pricePence;
      if (each < 500) return;
    }
    out.push(i);
  });
  return out;
}
function finish(category, items, noReturn, grocer, eatery) {
  // A coffee machine or mug from a coffee shop is in Food & drink but can still be returned (not from a supermarket). (From a
  // café, restaurant or pub only a thing that is plainly one, a machine, kettle or mug: never a drink served "(Pint glass)",
  // "a glass of" wine, a carafe or cups of something, which were drunk there. Round 15.)
  const returnable = noReturn ? false : category === "food" ? !grocer && (eatery ? EATERY_APPLIANCE.test(String(items || "").replace(/\([^)]{0,80}\)/g, " ")) : APPLIANCE.test(items || "")) : category !== "digital" && category !== "travel" && category !== "experiences";
  const reason = returnable ? null :
    noReturn ? "Bets and games of chance can't be returned." :
    category === "digital" ? "Digital purchases and subscriptions usually can't be returned. Cancel or ask the provider instead." :
    category === "food" ? "Food and drink usually can't be returned." :
    category === "experiences" ? "Tickets and experiences usually can't be returned. Check the event's own terms." : "Travel and rides usually can't be returned.";
  return { category, categoryLabel: CATEGORIES[category], returnable, notReturnableReason: reason };
}

// A shop name a person would say. Receipts often carry a company's legal name ("Anthropic Ireland, Limited")
// or no name at all, only the sending domain ("appcharge.com"), so this tidies the first and builds one from the second.
const KNOWN_NAMES = { appcharge: "Appcharge", lycamobile: "Lycamobile", shopifyemail: null, stripe: null, paypal: null, squareup: null,
  mcdonalds: "McDonald's", ctshirts: "Charles Tyrwhitt", sharkninja: "Ninja", dominospizza: "Domino's", dominos: "Domino's", nordaccount: "NordVPN",
  admiralcasino: "Admiral Casino", greatbeanbags: "Great Bean Bags", thescentreserve: "The Scent Reserve", myeflorist: "eFlorist", eflorist: "eFlorist" };
const MAIL_SUBDOMAIN = /^(e|em|email|emails|mail|mailer|news|newsletter|info|hello|noreply|no-reply|orders?|shop|store|click|links?|g|t|m|r|reply|notify|notifications?|updates?|service|customerservice|support|accounts?)$/i;
// Personal email services: a receipt "from" one of these is one the shopper (or a friend) forwarded, not a shop.
export const PERSONAL_MAIL = /(^|\.)(gmail\.com|googlemail\.com|outlook\.com|hotmail\.(com|co\.uk)|live\.(com|co\.uk)|msn\.com|icloud\.com|me\.com|mac\.com|yahoo\.(com|co\.uk)|ymail\.com|aol\.com|proton\.me|protonmail\.com|pm\.me|btinternet\.com|sky\.com|virginmedia\.com)$/i;
export function shopDisplayName(retailer) {
  const r = retailer || {};
  // Never show a person's name as a shop.
  if (PERSONAL_MAIL.test(String(r.domain || ""))) return "Forwarded receipt";
  const via = isVia(r.domain);
  const raw = String(r.name || "").trim();
  if (raw) {
    // "Anthropic Ireland, Limited" → "Anthropic"; "Anthropic, PBC" → "Anthropic"; "Acme UK Ltd." → "Acme"
    const short = raw.replace(/,?\s+((ireland|uk|europe|emea|international|holdings|group)\s*,?\s+)?(limited|ltd\.?|llc|l\.l\.c\.|inc\.?|incorporated|plc|pbc|gmbh|b\.?v\.?|s\.?a\.?r\.?l\.?|sas|ag|pty)\s*$/i, "").trim() || raw;
    // "Swarovski Customer Service GB" → "Swarovski"; "Groupon 🎄" → "Groupon".
    let clean = cleanShopName(short);
    // A name written as one run of words, as in a web address ("Tvbedsnorthwest"), is spelt out when every piece is a known
    // word ("TV Beds North West"); a brand Relay can't split ("Lululemon") keeps its own spelling.
    if (clean && /^[A-Za-z][a-z]+$/.test(clean) && clean.length >= 8 && !KNOWN_NAMES[letters(clean)] && (!r.domain || via || letters(clean) === domainBase(r.domain))) clean = spellOut(clean) || clean;
    const known = clean && KNOWN_NAMES[letters(clean)];
    if (known) return known;
    // A person's name from the shop's own address ("Liam Hartley" at clarechampion.ie): the address names the shop instead.
    if (clean && !via && r.domain && looksLikePerson(clean, r.domain)) return nameOfDomain(r.domain) || clean;
    if (clean) return clean;
    if (!via && r.domain) return nameOfDomain(r.domain) || short;
    return short;
  }
  if (via) return null;
  return nameOfDomain(r.domain);
}
const letters = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function nameOfDomain(domain) {
  const base = readerBase(domain).replace(/[^a-z0-9-]/g, "");
  if (!base) return null;
  if (Object.prototype.hasOwnProperty.call(KNOWN_NAMES, base)) return KNOWN_NAMES[base];
  // "just-eat" → "Just Eat"; "tvbedsnorthwest" → "TV Beds North West" (only when every piece is a known word).
  const split = base.split("-").filter(Boolean).map(w => splitWords(w) || null);
  if (split.every(Boolean)) return split.join(" ");
  return nameFromDomain(domain);
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

// One name per shop across all of a shopper's receipts: each receipt from the same web address votes with its tidied
// name, a name that matches the address counts three times, and a person's name hardly counts. Returns domain → name.
export function agreedShopNames(cards) {
  const votes = new Map();
  for (const c of cards || []) {
    const r = (c && c.retailer) || {}, d = String(r.domain || "").toLowerCase().replace(/["'<>]/g, "");
    // (A game web shop sells for many games: each receipt keeps the game it names.)
    if (!d || isVia(d) || PERSONAL_MAIL.test(d) || GAME_SHOP.test(d)) continue;
    const shown = shopDisplayName(r);
    if (!shown) continue;
    const raw = cleanShopName(r.name);
    const w = raw && looksLikePerson(raw, d) ? 0.2 : nameFits(shown, d) ? 3 : 1;
    const m = votes.get(d) || new Map();
    m.set(shown, (m.get(shown) || 0) + w); votes.set(d, m);
  }
  const out = new Map();
  for (const [d, m] of votes) { let best = null, n = -1; for (const [name, v] of m) if (v > n) { best = name; n = v; } out.set(d, best); }
  return out;
}
const nameFits = (name, domain) => { const n = letters(name), b = domainBase(domain); return Boolean(n && b && (n.includes(b) || b.includes(n))); };

// Web addresses of well-known shops that often email through a payment or ordering company, so the email itself doesn't
// carry the shop's own address. Used only to find the shop's logo; anything not listed gets a drawing in the app instead.
const SHOP_DOMAINS = {
  mcdonalds: "mcdonalds.com", tortilla: "tortilla.co.uk", gordonramsayrestaurants: "gordonramsayrestaurants.com", gordonramsay: "gordonramsayrestaurants.com",
  uberboat: "thamesclippers.com", thamesclippers: "thamesclippers.com", coachinginngroup: "coachinginngroup.co.uk",
  // Shops people often pay for with Klarna, Clearpay or PayPal, whose emails then come from the payment company.
  lululemon: "lululemon.com", asos: "asos.com", zara: "zara.com", nike: "nike.com", adidas: "adidas.co.uk", jdsports: "jdsports.co.uk",
  boohoo: "boohoo.com", prettylittlething: "prettylittlething.com", schuh: "schuh.co.uk", footlocker: "footlocker.co.uk", endclothing: "endclothing.com",
  newlook: "newlook.com", riverisland: "riverisland.com", sportsdirect: "sportsdirect.com", gymshark: "gymshark.com", hm: "hm.com", anthropic: "anthropic.com", elevenlabs: "elevenlabs.io", lner: "lner.co.uk",
  tedbaker: "tedbaker.com", pret: "pret.co.uk", pretamanger: "pret.co.uk", leon: "leon.co", wagamama: "wagamama.com", nandos: "nandos.co.uk",
  fiveguys: "fiveguys.co.uk", itsu: "itsu.com", wasabi: "wasabi.uk.com", costa: "costa.co.uk", costacoffee: "costa.co.uk", starbucks: "starbucks.co.uk",
  caffenero: "caffenero.com", greggs: "greggs.co.uk", gails: "gailsbread.co.uk", dishoom: "dishoom.com", honestburgers: "honestburgers.co.uk",
  francomanca: "francomanca.co.uk", pizzaexpress: "pizzaexpress.com", burgerking: "burgerking.co.uk", kfc: "kfc.co.uk", subway: "subway.com",
  dominos: "dominos.co.uk", papajohns: "papajohns.co.uk", pizzahut: "pizzahut.co.uk", uber: "uber.com", ubereats: "ubereats.com", bolt: "bolt.eu",
  deliveroo: "deliveroo.co.uk", justeat: "just-eat.co.uk", greeneking: "greeneking.co.uk", wetherspoon: "jdwetherspoon.com", jdwetherspoon: "jdwetherspoon.com",
  spotify: "spotify.com", netflix: "netflix.com", openai: "openai.com", nordvpn: "nordvpn.com",
};
const nameWords = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’.]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
// The web address to show a shop's logo from: its own address (never a personal mailbox or a payment company), else a
// well-known shop's address found from its name, else none.
export function logoDomainFor(retailer) {
  const r = retailer || {};
  const d = String(r.domain || "").toLowerCase().replace(/[^a-z0-9.-]/g, "");
  // A game web shop's logo is not the game's: the app draws one instead.
  if (d && GAME_SHOP.test(d) && r.name && !/appcharge|xsolla/i.test(r.name)) return null;
  if (d && !isVia(d) && !PERSONAL_MAIL.test(d)) return d;
  // A forwarded receipt carries a person's name, not a shop's: no logo from it.
  if (PERSONAL_MAIL.test(d)) return null;
  for (const name of [r.name, r.legalName]) {
    const w = nameWords(name);
    for (let n = Math.min(3, w.length); n >= 1; n--) for (let i = 0; i + n <= w.length; i++) {
      const k = w.slice(i, i + n).join("");
      if (Object.prototype.hasOwnProperty.call(SHOP_DOMAINS, k)) return SHOP_DOMAINS[k];
    }
  }
  return null;
}
