import assert from "node:assert/strict";
import { categorise, storeKey, shopDisplayName, agreedShopNames, logoDomainFor } from "../worker/receipt-category.js";
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
console.log(`\n${n} category tests passed`);
