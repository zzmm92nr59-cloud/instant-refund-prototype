import assert from "node:assert/strict";
import { categorise, storeKey, shopDisplayName, agreedShopNames, logoDomainFor, itemKind, itemCategories, categoryShares } from "../worker/receipt-category.js";
import { squareShopName } from "../worker/square-env.js";
const c = (name, domain, items = []) => categorise({ retailer: { name, domain }, items: items.map(n => ({ name: n })) });
let n = 0; const t = (m, f) => { f(); n++; console.log("ok -", m); };
t("lululemon is fashion and returnable", () => { const r = c("lululemon", "lululemon.com", ["Align Leggings"]); assert.equal(r.category, "fashion"); assert.equal(r.returnable, true); });
t("Apple App Store receipt is digital and not returnable", () => { const r = c("Apple", "apple.com", ["iCloud+ 200GB"]); assert.equal(r.category, "digital"); assert.equal(r.returnable, false); assert.ok(r.notReturnableReason); });
t("Apple hardware is electronics and returnable", () => { const r = c("Apple", "apple.com", ["AirPods Pro"]); assert.equal(r.category, "electronics"); assert.equal(r.returnable, true); });
t("food delivery and supermarkets are food, not returnable", () => { assert.equal(c("Deliveroo", "deliveroo.co.uk").category, "food"); assert.equal(c("Tesco", "tesco.com").returnable, false); });
t("Currys is electronics", () => assert.equal(c("Currys", "currys.co.uk", ["Kettle"]).category, "electronics"));
t("IKEA is home", () => assert.equal(c("IKEA", "ikea.com", ["Lamp"]).category, "home"));
t("unknown store is other and returnable", () => { const r = c("Tiny Shop", "tiny.test", ["Thing"]); assert.equal(r.category, "other"); assert.equal(r.returnable, true); });
t("pubs and restaurants are food", () => { assert.equal(c("The Red Lion Pub", "redlion.test").category, "food"); assert.equal(c("Dishoom", "dishoom.com").category, "food"); });
t("a kitchen item is not food", () => assert.equal(c("Dunelm", "dunelm.com", ["Kitchen towel set"]).category, "home"));
t("a learned category beats the keyword guess", () => { const r = categorise({ retailer: { name: "Zara", domain: "zara.com" }, items: [] }, "home"); assert.equal(r.category, "home"); assert.equal(r.returnable, true); });
t("store keys ignore www and endings", () => { assert.equal(storeKey({ retailer: { domain: "www.Zara.co.uk" } }), storeKey({ retailer: { domain: "zara.com" } })); });
t("game top-ups, phone top-ups and AI subscriptions are digital", () => { assert.equal(c(null, "appcharge.com").category, "digital"); assert.equal(c(null, "lycamobile.co.uk").category, "digital"); assert.equal(c("Anthropic Ireland, Limited", "stripe.com").category, "digital"); });
t("grooming brands are beauty & health", () => assert.equal(c("grüum", "e.gruum.com").category, "beauty"));
t("shop names drop legal endings", () => { assert.equal(shopDisplayName({ name: "Anthropic Ireland, Limited" }), "Anthropic"); assert.equal(shopDisplayName({ name: "Marks and Spencer plc" }), "Marks and Spencer"); assert.equal(shopDisplayName({ name: "Ltd" }), "Ltd"); });
t("a shop with no name gets one from its email domain", () => { assert.equal(shopDisplayName({ domain: "appcharge.com" }), "Appcharge"); assert.equal(shopDisplayName({ domain: "email.zara.co.uk" }), "Zara"); assert.equal(shopDisplayName({ domain: "g.shopifyemail.com" }), null); assert.equal(shopDisplayName({}), null); });
t("a receipt from a personal mailbox shows as forwarded, not a person's name", () => { assert.equal(shopDisplayName({ name: "Sam Smith", domain: "gmail.com" }), "Forwarded receipt"); assert.equal(shopDisplayName({ name: "Sam", domain: "icloud.com" }), "Forwarded receipt"); assert.equal(shopDisplayName({ name: "Gail's", domain: "gails.co.uk" }), "Gail's"); });
t("Square's test-account placeholder name is replaced by Relay's shop label", () => { assert.equal(squareShopName({}, "Default Test Account"), "Relay Demo Store"); assert.equal(squareShopName({ SQUARE_DEFAULT_LABEL: "Kick Lane" }, ""), "Kick Lane"); assert.equal(squareShopName({}, "Bean & Leaf Café"), "Bean & Leaf Café"); });
// Shops Relay knows by name or web address, before anything else.
t("Nespresso is Food & drink (it was in Other)", () => {
  assert.equal(c("Nespresso", "nespresso.com", ["Ispirazione Firenze Arpeggio", "Melozio"]).category, "food");
  assert.equal(c(null, "news.nespresso.com").category, "food", "from the web address alone");
  assert.equal(c("Nestlé Nespresso SA", "email.nespresso.co.uk").category, "food", "from a word in the legal name");
  assert.equal(c("Nespresso", "nespresso.com", ["Vertuo Pods x10"]).returnable, false);
});
t("a coffee machine or mug from a coffee shop stays in Food & drink but can still be returned", () => {
  const r = c("Nespresso", "nespresso.com", ["Vertuo Next Machine", "Barista Creations Pods"]);
  assert.equal(r.category, "food"); assert.equal(r.returnable, true); assert.equal(r.notReturnableReason, null);
});
t("Rains is Fashion, by name or address", () => {
  assert.equal(c("RAINS", "rains.com", ["Long Jacket"]).category, "fashion");
  assert.equal(c(null, "e.rains.com").category, "fashion");
});
t("short shop names only count as the whole name", () => {
  assert.equal(c("Post Office", "postoffice.co.uk", ["Stamps"]).category, "other", "not Office the shoe shop");
  assert.equal(c("Next", "next.co.uk", []).category, "fashion");
  assert.equal(c(null, "email.hm.com", ["Linen shirt"]).category, "fashion");
  assert.equal(c("Boots UK", "boots.com", []).category, "beauty");
  assert.equal(c("Very Good Coffee Co", "verygoodcoffee.test").category, "food", "not Very the catalogue shop");
});
t("Uber rides are travel and Uber Eats is food", () => {
  assert.equal(c("Uber", "uber.com").category, "travel");
  assert.equal(c("Uber Eats", "uber.com").category, "food");
  assert.equal(c("Bolt", "bolt.eu").category, "travel");
});
t("shops that sell everything are sorted by what was bought", () => {
  assert.equal(c("Amazon.co.uk", "amazon.co.uk", ["Nespresso Vertuo Pods, Mixed Pack"]).category, "food");
  assert.equal(c("Amazon.co.uk", "amazon.co.uk", ["Anker USB-C Charger 20W"]).category, "electronics");
  assert.equal(c("Amazon.co.uk", "amazon.co.uk", ["Thing"]).category, "other");
  assert.equal(c("John Lewis", "johnlewis.com", ["Apple iPad Air"]).category, "electronics");
  assert.equal(c("John Lewis", "johnlewis.com", []).category, "home", "the shop's usual group when the items don't say");
  assert.equal(c("Marks & Spencer", "marksandspencer.com", ["Percy Pig sweets", "Chicken sandwich"]).category, "food");
  assert.equal(c("Marks & Spencer", "marksandspencer.com", ["Cotton jumper"]).category, "fashion");
  assert.equal(c("Sainsbury's", "sainsburys.co.uk").category, "food");
});
t("item words: colours and flavours don't make clothes into food", () => {
  assert.equal(c("Tiny Shop", "tiny.test", ["Long Jacket Chocolate"]).category, "fashion");
  assert.equal(c("Tiny Shop", "tiny.test", ["Cable knit jumper"]).category, "fashion");
  assert.equal(c("Tiny Shop", "tiny.test", ["Tea towels, set of 3"]).category, "home");
  assert.equal(c("Tiny Shop", "tiny.test", ["Single origin coffee"]).category, "food");
  assert.equal(c("Tiny Shop", "tiny.test", ["Mickey Mouse T-shirt"]).category, "fashion");
});
t("a shop's own name says what it is when Relay doesn't know it", () => {
  assert.equal(c("Ozone Coffee Roasters", "ozonecoffee.test").category, "food");
  assert.equal(c("Northwest Beds", "beds.test").category, "home");
  assert.equal(c("Smith's Pharmacy", "smithspharmacy.test").category, "beauty");
});
t("shops that used to land in Other", () => {
  assert.equal(c("Homary", "homary.com").category, "home");
  assert.equal(c("Hollywood Bowl London at The O2", "hollywoodbowl.co.uk").category, "experiences");
  assert.equal(c("Panda Mami", null).category, "food");
  assert.equal(c("Clare Champion", "clarechampion.ie").category, "digital");
  assert.equal(c("Meta", "email.meta.com").category, "digital");
  // "Meta" counts only as the whole name, not as one word in another company's.
  assert.equal(c("Meta Materials Ltd", "metamaterials.test").category, "other");
  assert.equal(c("Greene King", "app.greeneking.co.uk").category, "food");
  assert.equal(c("Bows and Whistles", "bowsandwhistles.co.uk").category, "home");
  assert.equal(c("PayLink Mobile", "paylinkmobile.test").category, "travel");
});
t("game web shops: each receipt keeps the game it names, with no web-shop logo", () => {
  const cards = [{ retailer: { name: "Example Quest", domain: "appcharge.com" } }, { retailer: { name: "Example Quest", domain: "appcharge.com" } },
    { retailer: { name: "Other Game", domain: "appcharge.com" } }, { retailer: { name: "Appcharge", domain: "appcharge.com" } }];
  assert.equal(agreedShopNames(cards).has("appcharge.com"), false, "no one name for every game sold through it");
  assert.equal(logoDomainFor({ name: "Example Quest", domain: "appcharge.com" }), null);
  assert.equal(logoDomainFor({ name: "Appcharge", domain: "appcharge.com" }), "appcharge.com");
  assert.equal(c("Example Quest", "appcharge.com", ["2,200 Coins"]).category, "digital");
});
t("shops behind voucher and ticket platforms get their own logo, not the platform's", () => {
  assert.equal(logoDomainFor({ name: "Gordon Ramsay Restaurants", domain: null, via: "giftpro.co.uk" }), "gordonramsayrestaurants.com");
  assert.equal(logoDomainFor({ name: "Uber Boat by Thames Clippers", domain: null, via: "ventrata.com" }), "thamesclippers.com");
  assert.equal(logoDomainFor({ name: "lululemon", domain: null, via: "klarna.co.uk" }), "lululemon.com");
});
t("a supermarket basket stays Food & drink, however much kitchen roll is in it", () => {
  const basket = ["Refuse Sacks", "Super Absorbent Kitchen Towels", "Antibacterial Kitchen Spray", "Antiperspirant Extra Fresh", "Broccoli Florets 900g", "Bottled Spring Water 4x2L"];
  assert.equal(c("Sainsbury's", "sainsburys.co.uk", basket).category, "food");
  assert.equal(c("Sainsbury's", "sainsburys.co.uk", basket).returnable, false);
  // A supermarket's clothing range is still clothes.
  assert.equal(c("Tesco", "tesco.com", ["F&F Denim Jacket", "F&F Slim Jeans"]).category, "fashion");
  assert.equal(itemKind("Super Absorbent Kitchen Towels"), "home");
  assert.equal(itemKind("Greek Yoghurt 950g"), "food");
  assert.equal(itemKind("Highland Venison Grillsteaks"), null, "a name that doesn't say");
});
// Each item on a receipt is scored on its own, and the receipt's group is built from those scores.
const priced = (shop, domain, rows, total) => ({ retailer: { name: shop, domain }, items: rows.map(([name, pricePence, qty]) => ({ name, pricePence, qty: qty || 1 })), totalPence: total });
const weekly = priced("Sainsbury's", "sainsburys.co.uk", [["Semi Skimmed Milk 2.27L", 165], ["Soft White Medium Bread 800g", 140], ["Classic Clean Toilet Tissue x9", 650],
  ["Super Absorbent Kitchen Towels x2", 300], ["Total Toothpaste 75ml", 250], ["Bananas Loose", 90], ["Baked Beanz 4x415g", 400], ["Highland Venison Grillsteaks", 500],
  ["Platinum Dishwasher Tablets x40", 900], ["AA Batteries x4", 500], ["Mature Cheddar 350g", 375], ["Fabric Conditioner 1.16L", 350], ["Closed Cup Mushrooms 300g", 95],
  ["Spreadable Butter 500g", 450], ["Cat Food Pouches 12x100g", 500], ["Strawberries 400g", 250]], 6900);
t("each item on a supermarket receipt gets its own group, with how sure it is", () => {
  const k = itemCategories(weekly), by = name => k[weekly.items.findIndex(i => i.name === name)];
  assert.deepEqual(by("Super Absorbent Kitchen Towels x2"), { category: "home", points: 3, sure: true, ranked: [{ category: "home", points: 3 }, { category: "food", points: 1 }] },
    "kitchen roll is Home & garden; the supermarket's lean towards food comes second");
  assert.equal(by("Bananas Loose").category, "food"); assert.equal(by("Bananas Loose").sure, true);
  assert.equal(by("Total Toothpaste 75ml").category, "beauty");
  assert.equal(by("AA Batteries x4").category, "electronics");
  assert.equal(by("Classic Clean Toilet Tissue x9").category, "home");
  assert.equal(by("Fabric Conditioner 1.16L").category, "home", "fabric conditioner, not hair conditioner");
  assert.equal(by("Cat Food Pouches 12x100g").category, "home", "pet food goes with the pets, not the shopper's food");
  assert.deepEqual(by("Highland Venison Grillsteaks"), { category: "food", points: 1, sure: false, ranked: [{ category: "food", points: 1 }] }, "a name that doesn't say: the supermarket's food");
  assert.equal(categorise(weekly).category, "food", "the receipt is still the week's groceries");
  assert.equal(itemCategories({ retailer: { name: "Tiny Shop" }, items: [{ name: "Thing" }, { name: "" }] }).every(x => x === null), true, "nothing points anywhere: no guess");
});
t("a shop Relay knows lends its group to its items, but an item's own clear name wins", () => {
  const lush = itemCategories({ retailer: { name: "Lush", domain: "lush.com" }, items: [{ name: "Honey I Washed The Kids Soap" }, { name: "Honey Lip Scrub" }] });
  assert.equal(lush[0].category, "beauty"); assert.equal(lush[1].category, "beauty", "\"honey\" is a flavour there, not food");
  const currys = itemCategories({ retailer: { name: "Currys", domain: "currys.co.uk" }, items: [{ name: "Kettle" }, { name: "Extended warranty" }] });
  assert.equal(currys[0].category, "home"); assert.equal(currys[1].category, "electronics"); assert.equal(currys[1].sure, false);
  assert.equal(itemCategories({ retailer: { name: "Marks & Spencer", domain: "marksandspencer.com" }, items: [{ name: "Percy Pig sweets" }] })[0].category, "food",
    "a shop that sells everything only leans a little");
  assert.equal(itemCategories({ retailer: { name: "Zara" }, items: [{ name: "Chicken sandwich" }] }, "home")[0].category, "food", "a group the shopper chose leans, but doesn't rename things");
  assert.equal(itemCategories({ retailer: { name: "Zara" }, items: [{ name: "Gift wrap" }] }, "home")[0].category, "home");
});
t("items count by what they cost, when the receipt says", () => {
  assert.equal(c("Amazon.co.uk", "amazon.co.uk", ["Nespresso Vertuo Pods, Mixed Pack", "Anker USB-C Charger 20W"]).category, "electronics", "no prices: one each, and a tie goes to the returnable kind");
  assert.equal(categorise(priced("Amazon.co.uk", "amazon.co.uk", [["Nespresso Vertuo Pods, Mixed Pack", 3000], ["Anker USB-C Charger 20W", 1500]], 4500)).category, "food");
  assert.equal(categorise(priced("Amazon.co.uk", "amazon.co.uk", [["Nespresso Vertuo Pods, Mixed Pack", 900], ["Anker USB-C Charger 20W", 1500]], 2400)).category, "electronics");
  // A supermarket: one jacket in a big food shop is groceries; a jacket and a pint of milk is clothes.
  const big = [["F&F Denim Jacket", 1500], ["Finest Sourdough", 150], ["Whole Milk 4 Pints", 145], ["Chicken Breast Fillets 650g", 450], ["Crumpets 6 Pack", 120],
    ["Free Range Eggs x12", 300], ["Mature Cheddar 350g", 375], ["Lasagne Sheets", 120], ["Bolognese Sauce", 180], ["Lean Beef Mince 500g", 450], ["Garden Peas 1kg", 160]];
  assert.equal(categorise(priced("Tesco", "tesco.com", big, 3950)).category, "food");
  assert.equal(categorise(priced("Tesco", "tesco.com", [["F&F Denim Jacket", 4500], ["Whole Milk 4 Pints", 145]], 4645)).category, "fashion");
  assert.equal(categorise(priced("Tesco", "tesco.com", [["F&F Denim Jacket", 4500], ["Whole Milk 4 Pints", 145]], 4645)).returnable, true, "so its return window shows");
});
t("a receipt's money splits by what each item is, only when every item is priced", () => {
  const s = categoryShares({ ...weekly, category: "food" });
  assert.deepEqual(s.map(x => x.category), ["home", "food", "electronics", "beauty"], "biggest share first");
  const sum = weekly.items.reduce((n, i) => n + i.pricePence, 0), cost = names => names.reduce((n, x) => n + weekly.items.find(i => i.name === x).pricePence, 0);
  assert.ok(Math.abs(s.find(x => x.category === "home").share - cost(["Classic Clean Toilet Tissue x9", "Super Absorbent Kitchen Towels x2", "Platinum Dishwasher Tablets x40", "Fabric Conditioner 1.16L", "Cat Food Pouches 12x100g"]) / sum) < 1e-9,
    "Home & garden's share is what the household things cost");
  assert.ok(Math.abs(s.reduce((n, x) => n + x.share, 0) - 1) < 1e-9, "the shares add up to the whole receipt");
  assert.deepEqual(s.find(x => x.category === "beauty").items, [4], "and say which items are in each");
  assert.equal(categoryShares({ ...weekly, items: weekly.items.map((i, n) => (n === 3 ? { name: i.name } : i)) }), null, "an item without a price: no split");
  assert.equal(categoryShares({ ...weekly, totalPence: 600 }), null, "prices nowhere near the total (a misread price): no split");
  assert.equal(categoryShares(priced("Zara", "zara.com", [["Coat", 5990], ["Scarf", 1990]], 7980)), null, "one kind of thing: nothing to split");
  assert.equal(categoryShares({ ...weekly, totalPence: null }), null);
});
console.log(`\n${n} category tests passed`);
