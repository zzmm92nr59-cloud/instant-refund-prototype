// Sorts a captured receipt into a shopping group and says whether it can normally be returned.
// This is a best guess from the store and item names, not a fact: the app shows it as a label the shopper can see,
// and the shopper can move a receipt to another group (which then wins for that shop).
// How the guess is made: every clue adds points to a group (a shop Relay knows 6, each item 3, words in the shop's name
// or web address 2, a shop that sells everything 1.5, weak item words such as colours and flavours 1), and the group
// with the most points wins. Nothing scores: Other. When the receipt prices its items, each item counts by its share of
// what they cost, so a £400 television decides an order more than a pint of milk does.
// Every item also gets its own group (itemCategories), so a supermarket shop's kitchen roll is Home & garden and its
// bananas are Food & drink. Wrapped uses those to count each thing, and the money spent on it, where it belongs.
import { cleanShopName, isVia, looksLikePerson, nameFromDomain, domainBase as readerBase, GAME_SHOP } from "./receipt-reader.js";
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
    "centerparcs haven butlins omio holidayextras opodo edreams hostelworld agoda vrbo",
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

// 2. What the items are. Each item takes the first group whose words it matches, in this order; the group with the most
// items wins. Kitchen things named after food come first ("tea towel" is Home, not Food), and words that are also
// colours or flavours ("chocolate", "coffee", "wine") only count when nothing else fits ("Long Jacket Chocolate" is Fashion).
const ITEM_RULES = [
  ["home", /\b(tea ?towels?|wine ?glass(es)?|champagne flutes?|coffee tables?|coffee machines?|espresso machines?|bean to cup|milk frothers?|aeroccino|frothers?|coffee grinders?|grinders?|kettles?|toasters?|blenders?|cheese ?boards?|bread ?bins?|bread makers?|cake tins?|ice cream makers?|cafeti[eè]res?|french press|travel mugs?|mugs?|espresso cups?|tumblers?|flasks?|water filters?|lunch ?box(es)?|pasta makers?|dishwasher (tablets?|capsules?|pods?)|laundry (capsules?|pods?)|washing (capsules?|pods?)|toilet (rolls?|tissue|paper)|kitchen (rolls?|foil)|(tin|baking|aluminium) foil|cling ?film|baking (paper|parchment)|(sandwich|freezer|food) bags|refuse sacks?|bin liners|bleach|fabric (conditioner|softener)|laundry (liquid|detergent|powder|gel)|washing (liquid|powder)|(surface|kitchen|bathroom|toilet|antibacterial|multi-?surface) (spray|wipes|cleaner)|(washing up|kitchen|cleaning|scrub) sponges?|scourers?|dish ?cloths?|air fresheners?|(reusable|insulated|sports|stainless steel|thermal|kids) (water )?bottles?|(vertuo|nespresso|tassimo|dolce gusto|lattissima|essenza|citiz|pixie|inissia|creatista)[a-z ]{0,20}machines?|(dog|cat|puppy|kitten|pet) (food|biscuits|treats|pouches|chews))\b/i],
  ["food", /\b(espresso|ristretto|lungo|decaf(feinated)?|cappuccino|latte macchiato|(coffee|espresso|nespresso|vertuo|tassimo|dolce gusto) (capsules?|pods?)|coffee beans|ground coffee|instant coffee|tea ?bags|loose leaf|matcha|groceries|grocery|bananas|avocados?|vegetables|veg box|fruit box|meal kit|recipe box|pizzas?|burgers?|fries|chips and|nuggets|chicken wings|onion rings|kebab|sushi|ramen|noodles|curry|biryani|dumplings|burrito|tacos?|sandwich(es)?|salads?|soup|pasta|risotto|bagels?|croissants?|pastr(y|ies)|doughnuts?|donuts?|muffins?|brownies|cookies|biscuits|crisps|snacks?|cereal|granola|porridge|protein (powder|bars?|shake)|whey|beers?|lagers?|ales|ciders?|gin|vodka|rum|whisk(e)?y|tequila|prosecco|champagne|red wine|white wine|ros[eé] wine|wines|spirits|cocktails|soft drinks?|cola|lemonade|smoothies?|juices?|milkshakes?|bubble tea|kombucha|takeaway|delivery fee|meal deal|breakfast|lunch|dinner|(still|sparkling|spring|mineral|bottled) water|semi[- ]?skimmed|skimmed milk|whole milk|oat milk|cheddar|mozzarella|parmesan|halloumi|feta|yoghurts?|yogurts?|fromage frais|free range|chicken (breasts?|thighs|fillets|drumsticks)|mince|sausages?|bacon|prawns|haddock|baked beans|beanz|chopped tomatoes|passata|stock cubes|ketchup|mayonnaise|peanut butter|marmalade|crumpets|baguettes?|pitta|naan|fish fingers|oven chips|broccoli|cauliflower|carrots?|onions?|lettuce|spinach|courgettes?|sweetcorn|chickpeas|lentils|tortilla wraps|lasagne|lasagna|nori|filo|tortellini|ravioli|gnocchi|penne|fusilli|linguine|tagliatelle|macaroni|couscous|quinoa|noodle|garden peas|jacket potato(es)?|plant[- ]based|(chia|sunflower|pumpkin|sesame|flax|poppy) seeds|linseeds?|pineapple rings)\b/i],
  ["digital", /\b(subscriptions?|membership|premium plan|monthly plan|annual plan|gift ?cards?|e-?gift|e-?vouchers?|in-app purchase|game credits?|v-?bucks|robux|top-?up|sim only|airtime|data (plan|bundle|add-?on)|e-?books?|kindle edition|audiobooks?|digital (download|edition|copy)|downloads?|licen[cs]e key|software licen[cs]e|cloud storage|icloud\+?)\b/i],
  ["travel", /\b(flights?|airfare|boarding pass|baggage|hotel|hostel|room night|nights? stay|accommodation|train tickets?|rail(card| tickets?)|railcard|off-?peak|anytime return|single ticket|season ticket|oyster|bus (ticket|pass)|coach ticket|ferry|taxi|trip fare|car hire|car rental|parking|congestion charge|toll|e-?scooter|bike hire)\b/i],
  ["beauty", /\b(skin ?care|moisturi[sz]er|serum|cleanser|sunscreen|spf ?\d*|sun cream|lipstick|lip (balm|gloss|liner)|mascara|eyeliner|eyeshadow|foundation|concealer|bronzer|nail (polish|varnish)|perfume|fragrance|eau de (toilette|parfum)|aftershave|cologne|body (wash|lotion|butter|spray)|shower gel|shampoo|conditioner|hair (oil|mask|dryer|dye|colour|color)|straighteners?|curling wand|deodorant|antiperspirant|razors?|shaving|beard oil|toothbrush|toothpaste|electric toothbrush|floss|mouthwash|vitamins?|supplements?|multivitamin|probiotics?|collagen|paracetamol|ibuprofen|plasters|prescription|contact lenses|makeup|make-up|cosmetics?|grooming|hand ?wash|hand (cream|soap|sanitiser|sanitizer|gel)|soaps?|bath (soak|salts|bombs?|foam)|bubble bath|face (wash|mask|cream|scrub)|(day|night|eye) cream|cotton (pads|buds|wool)|tampons|sanitary|panty ?liners|period pants|baby wipes|wet wipes|tissues|toothbrush heads?|cold sore|hay ?fever|antihistamines?|cough (syrup|sweets|mixture)|lozenges|painkillers?|aspirin|cold (and|&) flu|nappies)\b/i],
  ["electronics", /\b(laptops?|macbook|chromebook|iphone|ipad|smartphones?|mobile phones?|phones?|tablets?|headphones|earphones|earbuds|airpods|chargers?|charging (cable|case|pad)|(usb|usb-c|hdmi|lightning|charging|power|ethernet|audio|aux|phone) cables?|usb|hdmi|monitors?|keyboards?|(computer|wireless|gaming|magic|bluetooth) mouse|webcam|cameras?|tripod|televisions?|tvs?|soundbar|speakers?|routers?|printers?|ink cartridges?|ssd|hard drive|memory card|sd card|power banks?|adapters?|batter(y|ies)|smart ?watch|apple watch|fitness tracker|consoles?|controllers?|nintendo switch|ps5|playstation 5|xbox series|e-?reader|kindle paperwhite|drones?|projectors?|graphics card|processor|motherboard)\b/i],
  ["home", /\b(sofas?|armchairs?|chairs?|tables?|desks?|beds?|bed frames?|mattress(es)?|bedding|duvets?|pillows?|cushions?|throws?|blankets?|sheets|duvet covers?|towels?|bath mats?|curtains?|blinds|rugs?|lamps?|light bulbs?|lighting|candles?|diffusers?|vases?|mirrors?|frames?|wall art|shelv(es|ing)|storage|baskets?|wardrobes?|drawers|cookware|frying pans?|saucepans?|pans|pots|knives|cutlery|crockery|plates|bowls|kitchen|bakeware|utensils?|plants?|seeds|compost|soil|planters?|garden|hose|lawn|mower|bbq|barbecue|paint|primer paint|drill|screws|tools?|toolbox|wallpaper|tiles|vacuum|hoover|steam iron|clothes iron|ironing board|dehumidifier|heater|(desk|ceiling|electric|tower|pedestal) fan|air fryer|microwave|fridge|freezer|washing machine|dishwasher|bin bags|pedal bin|kitchen bin|cleaning|detergent|washing up|dog (food|bed|lead|toy|treats)|cat (food|litter|bed|toy|tree)|pet (food|bed|toy|carrier)|cat litter)\b/i],
  ["fashion", /\b(jumpers?|sweaters?|hoodies?|sweatshirts?|cardigans?|jackets?|coats?|raincoats?|rain ?wear|parkas?|puffer|anorak|gilets?|blazers?|suits?|jeans|trousers|chinos|joggers|leggings|shorts|skirts?|dress(es)?|shirts?|t-?shirts?|tees?|blouses?|vests?|bodysuits?|jumpsuits?|playsuits?|knitwear|denim|trainers|sneakers|shoes|boots|sandals|heels|loafers|slippers|socks|tights|underwear|bras?|briefs|boxers|lingerie|swimwear|swimsuits?|swim shorts|bikinis?|pyjamas|nightwear|robe|handbags?|bags?|backpacks?|rucksacks?|totes?|tote bag|wallets?|purses?|belts?|scarf|scarves|hats?|bucket hat|caps?|beanies?|gloves|mittens|sunglasses|watch|jewell?ery|necklaces?|bracelets?|earrings|rings|pendant|waterproof)\b/i],
  ["food", /\b(coffee|tea|chocolate|wine|honey|caramel|vanilla|mocha|cocoa|cheese|bread|milk|eggs|butter|yoghurt|yogurt|chicken|beef|pork|salmon|fish|rice|sauce|spices?|olive oil|jam|nuts|sweets|candy|ice cream|cake|food|drinks?|apples?|oranges?|lemons?|limes?|grapes|berries|strawberr(y|ies)|raspberr(y|ies)|blueberr(y|ies)|cherr(y|ies)|peach(es)?|pears?|plums?|melons?|mango(es)?|pineapples?|coconut|tomato(es)?|potato(es)?|mushrooms?|cucumbers?|peppers?|garlic|ginger|mint|olives?|peas|beans|lamb|turkey|ham|tuna|cream|flour|sugar|oats|water|squash)\b/i],
];
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
// What an item's own name says: 3 points for a clear match (the first matching rule), 2 for a brand named in the item
// ("Nespresso Vertuo Pods" bought on Amazon), 1 for weak words that are also colours or flavours ("chocolate", "coffee",
// "wine"); null when the name doesn't say.
const WEAK_FOOD = ITEM_RULES[ITEM_RULES.length - 1][1];
// The same names come up again and again (the weekly shop), so each answer is remembered for a while.
const NAMES_SEEN = new Map();
function namePoints(name) {
  if (NAMES_SEEN.has(name)) return NAMES_SEEN.get(name);
  if (NAMES_SEEN.size >= 4000) NAMES_SEEN.clear();
  const found = (() => {
    for (const [c, re] of ITEM_RULES) if (re !== WEAK_FOOD && re.test(name)) return { cat: c, pts: 3 };
    const w = words(name);
    for (let n = Math.min(3, w.length); n >= 1; n--) for (let i = 0; i + n <= w.length; i++) {
      const k = w.slice(i, i + n).join("");
      if (SHOPS.get(k) && !WHOLE_ONLY.has(k) && !MIXED.has(k) && k.length >= 4) return { cat: SHOPS.get(k), pts: 2 };
    }
    return WEAK_FOOD.test(name) ? { cat: "food", pts: 1 } : null;
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
  let nameGroup = null;
  for (const [c, re] of NAME_WORDS) if (re.test(nameText) || re.test(domainText)) { nameGroup = c; break; }
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
export function categorise(card, learned) {
  card = card || {};
  const items = (card.items || []).map(i => i && i.name).filter(Boolean).join(" ");
  const r = card.retailer || {};
  const store = [r.name, r.legalName, r.domain].filter(Boolean).join(" ");
  const noReturn = NO_RETURN.test(store);
  if (learned && CATEGORIES[learned]) return finish(learned, items, noReturn);
  // Apple sells both phones and App Store credit: the items decide.
  if (/(^|\b|\.)apple(\b|\.)/i.test(store) && !/applebee/i.test(store) && !isVia(r.domain)) return finish(HARDWARE.test(items) ? "electronics" : "digital", items, noReturn);
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

// What one thing bought is, from its name alone, when that is clear ("Kitchen Towels" is Home & garden, "Greek Yoghurt"
// is Food & drink); null when the name doesn't say. Used to keep each Wrapped chapter's top items to that kind of thing.
export function itemKind(name) {
  const n = typeof name === "string" ? name : "";
  if (!n) return null;
  for (const [c, re] of ITEM_RULES) if (re.test(n)) return c;
  return null;
}
// 4. Things in a food or supermarket order that can usually go back on their own (a kettle, a jumper or headphones in the
// weekly shop, a pair of shorts from a sports-nutrition shop) while the food can't. Only items whose own name says what they
// are (`sure`), that last rather than get used up (not kitchen roll, cleaning things, batteries, bulbs, ink, bags or plants),
// that cost £5 or more each when the receipt prices them, and never from a café, restaurant, pub or takeaway (whose
// "chicken strips basket" is a meal). Returns their positions in card.items.
const EATERY = new Set(("starbucks costa costacoffee caffenero nero pret pretamanger greggs gails joeandthejuice blankstreet deliveroo justeat ubereats " +
  "boltfood wolt honestburgers dishoom nandos wagamama fiveguys mcdonalds kfc burgerking dominos papajohns pizzahut pizzaexpress francomanca " +
  "pandamami gordonramsayrestaurants gordonramsay hawksmoor flatiron bao padella greeneking stonegate stonegatepubs wetherspoon jdwetherspoon " +
  "wetherspoons leon itsu wasabi yosushi tortilla chipotle krispykreme").split(" "));
const EATERY_NAME = /\b(pub|tavern|inn|arms|restaurant|cafe|café|coffee house|bakery|patisserie|takeaway|pizza|pizzeria|burgers?|sushi|ramen|curry|grill|deli|bistro|brasserie|diner|eatery|noodles?|dumplings?|bubble tea|kebabs?|chippy|fish (and|&) chips|bar)\b/i;
const USED_UP = /\b(kitchen (rolls?|towels?|paper)|paper towels?|toilet (rolls?|tissue|paper)|tissues?|napkins?|serviettes?|wipes|foil|cling ?film|baking (paper|parchment)|greaseproof|(sandwich|freezer|food|bin|refuse|rubbish) (bags|liners|sacks)|bin liners|bin bags|bags? for life|carrier bags?|plastic bags?|paper bags?|bag charge|dishwasher|laundry|washing (up|liquid|powder|capsules?|pods?|gel)|fabric (conditioner|softener)|detergent|bleach|cleaners?|cleaning|disinfectant|(surface|kitchen|bathroom|toilet|antibacterial|multi-?surface) (spray|gel)|sponges?|scourers?|dish ?cloths?|cloths|air fresheners?|polish|batter(y|ies)|light ?bulbs?|bulbs?|ink|toner|cartridges?|candles?|matches|charcoal|lighters?|(dog|cat|puppy|kitten|pet|bird) (food|biscuits|treats|pouches|chews)|litter|seeds|compost|soil|plants?|flowers?|bouquets?|refills?|pods?|capsules?)\b/i;
const LASTS = /\b(kettles?|toasters?|blenders?|mixers?|food processors?|coffee (machines?|makers?|grinders?)|espresso machines?|grinders?|frothers?|microwaves?|air fryers?|slow cookers?|pressure cookers?|rice cookers?|irons?|ironing boards?|vacuums?|hoovers?|fans?|heaters?|dehumidifiers?|lamps?|mugs?|cups|glass(es)?|tumblers?|flasks?|carafes?|cafeti[eè]res?|french press|teapots?|jugs?|plates?|bowls?|dinner sets?|cutlery|knives|knife|pans?|saucepans?|woks?|casserole dish(es)?|cookware|bakeware|baking (trays?|tins?|dish(es)?)|(cake|roasting|loaf) tins?|chopping boards?|utensils?|whisks?|graters?|colanders?|sieves?|storage (boxes|box|containers?|jars?|sets?)|lunch ?box(es)?|bread bins?|duvets?|duvet covers?|pillows?|pillowcases?|cushions?|throws?|blankets?|bedding|bed ?sheets?|towels?|bath mats?|tea ?towels?|oven gloves?|aprons?|curtains?|rugs?|mirrors?|(photo |picture )?frames?|vases?|clocks?|baskets?|hangers?|airers?|drying racks?|pedal bins?|chairs?|tables?|desks?|stools?|shelv(es|ing)|wardrobes?|beds?|mattress(es)?|sofas?|tool ?(kits?|sets?|box(es)?)|drills?|toys?)\b/i;
const KITCHEN_KIT = ITEM_RULES[0][1], STRONG_FOOD = ITEM_RULES[1][1];
export function returnableItems(card, kinds) {
  card = card || {};
  const { shop } = shopClues(card), r = card.retailer || {};
  if ((shop && EATERY.has(shop.key)) || EATERY_NAME.test([spaced(shopDisplayName(r)), spaced(r.name)].filter(Boolean).join(" "))) return [];
  kinds = kinds || itemCategories(card);
  const out = [];
  (card.items || []).forEach((it, i) => {
    const k = kinds[i], name = nameOf(it);
    if (!k || !k.sure || !name || USED_UP.test(name)) return;
    if (k.category === "home" ? !LASTS.test(name) : k.category !== "fashion" && k.category !== "electronics") return;
    // A dish named like a thing ("onion rings", "chicken strips basket") is food. Kitchen kit named after food ("coffee
    // grinder", "bread bin", "cake tin") still counts.
    if (STRONG_FOOD.test(name) || (k.category === "home" && !KITCHEN_KIT.test(name) && WEAK_FOOD.test(name))) return;
    if (Number.isInteger(it.pricePence)) {
      const each = it.lineTotal && Number(it.qty) > 1 ? it.pricePence / Number(it.qty) : it.pricePence;
      if (each < 500) return;
    }
    out.push(i);
  });
  return out;
}
function finish(category, items, noReturn, grocer) {
  // A coffee machine or mug from a coffee shop is in Food & drink but can still be returned (not from a supermarket).
  const returnable = noReturn ? false : category === "food" ? !grocer && APPLIANCE.test(items || "") : category !== "digital" && category !== "travel" && category !== "experiences";
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
    const clean = cleanShopName(short);
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
