// Sorts a captured receipt into a shopping group and says whether it can normally be returned.
// This is a best guess from the store and item names, not a fact: the app shows it as a label the shopper can see.
export const CATEGORIES = {
  fashion: "Fashion", electronics: "Electronics", food: "Food & drink", home: "Home & garden",
  beauty: "Beauty & health", travel: "Travel & transport", digital: "Digital & subscriptions", other: "Other",
};
const RULES = [
  ["digital", /\b(app store|itunes|icloud|apple music|apple tv|google play|spotify|netflix|disney\+?|prime video|subscription|membership|gift card|e-?gift|steam|playstation store|xbox|nintendo eshop|audible|kindle|youtube premium|microsoft 365|adobe|dropbox|openai|chatgpt)\b/i],
  ["travel", /\b(uber|bolt|trainline|tfl|ryanair|easyjet|british airways|jet2|booking\.com|airbnb|expedia|hotels?|eurostar|national rail|lner|avanti|flights?|taxi|parking)\b/i],
  ["food", /\b(deliveroo|just eat|uber eats|tesco|sainsbury|asda|morrisons|waitrose|lidl|aldi|ocado|co-?op|greggs|pret|costa|starbucks|nando|mcdonald|kfc|domino|pizza|restaurant|cafe|coffee|grocer|groceries|bakery|takeaway|wine|beer)\b/i],
  ["electronics", /\b(apple|iphone|ipad|macbook|airpods|samsung|currys|argos|ao\.com|very|dell|lenovo|hp\b|sony|bose|dyson|gopro|nintendo|playstation|laptop|phone|tablet|headphones|charger|cable|monitor|keyboard|camera|television|tv\b|console|smart ?watch)\b/i],
  ["beauty", /\b(boots|superdrug|lookfantastic|space nk|sephora|cult beauty|the body shop|holland & barrett|beauty|skincare|perfume|fragrance|makeup|cosmetic|shampoo|vitamin|pharmacy|optician|specsavers)\b/i],
  ["home", /\b(ikea|b&q|wickes|screwfix|dunelm|john lewis|wayfair|made\.com|homebase|garden|furniture|sofa|mattress|bedding|lamp|kitchen|candle|rug|curtain|plant)\b/i],
  ["fashion", /\b(lululemon|zara|h&m|asos|next|uniqlo|nike|adidas|puma|new balance|primark|m&s|marks (&|and) spencer|boohoo|shein|gap|levi|ralph lauren|north face|patagonia|jd sports|sports direct|schuh|office shoes|river island|topshop|mango|cos\b|arket|& other stories|jumper|hoodie|jacket|jeans|trousers|dress|shirt|t-?shirt|leggings|shorts|trainers|shoes?|boots?|coat|socks|bra\b|swimwear|bag|handbag)\b/i],
];
const HARDWARE = /\b(iphone|ipad|macbook|imac|mac mini|airpods|apple watch|airtag|charger|cable|case|keyboard|mouse|monitor|laptop|phone|tablet|headphones)\b/i;

export function categorise(card) {
  const store = [card.retailer && card.retailer.name, card.retailer && card.retailer.domain].filter(Boolean).join(" ");
  const items = (card.items || []).map(i => i && i.name).filter(Boolean).join(" ");
  const all = store + " " + items;
  let category = "other";
  // Apple sells both phones and App Store credit: the items decide.
  if (/apple/i.test(store) && !HARDWARE.test(items)) category = "digital";
  else {
    for (const [cat, re] of RULES) { if (re.test(items) || re.test(store)) { category = cat; break; } }
  }
  const returnable = category !== "digital" && category !== "food" && category !== "travel";
  const reason = returnable ? null :
    category === "digital" ? "Digital purchases and subscriptions usually can't be returned. Cancel or ask the provider instead." :
    category === "food" ? "Food and drink usually can't be returned." : "Travel and rides usually can't be returned.";
  return { category, categoryLabel: CATEGORIES[category], returnable, notReturnableReason: reason };
}
