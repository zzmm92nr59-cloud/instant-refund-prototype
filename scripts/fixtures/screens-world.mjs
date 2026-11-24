// A made-up shopper with a full, messy account, for scripts/test-screens-ui.mjs: long shop and product names, many receipts
// over many months, refunds, a cancelled order, hotel stays, flights, a takeaway through a delivery app, a supermarket shop,
// in-game coins, an app subscription, a gift card, a gift for someone, a parcel on its way, a return on its way, an order in
// euros, two banks with several cards, two inboxes, watched products and Relay health numbers. Every name, amount and order
// number here is invented.
import { buildWrapped } from "../../worker/wrapped.js";

const DAY = 864e5;
export const NOW = Date.now();
export const day = (n) => new Date(NOW + n * DAY).toISOString().slice(0, 10);
let seq = 0;
const uid = () => { const h = (++seq).toString(16).padStart(8, "0"); return h + "-0000-4000-8000-" + h.padStart(12, "0"); };
const line = (name, pricePence, extra) => ({ name, qty: 1, pricePence, ...extra });
export function receipt(shop, items, ago, extra = {}) {
  const id = uid(), total = extra.totalPence ?? items.reduce((s, i) => s + (i.pricePence || 0) * (i.qty || 1), 0);
  return { id, status: "pending", kind: "receipt", retailer: { name: shop, domain: extra.domain || null }, orderRef: "ZX" + (40000 + seq), orderDate: day(-ago), totalPence: total, currency: "GBP",
    category: "fashion", returnable: true, items, returns: null, gmailId: "m" + id.slice(0, 8), itemsCheck: { complete: true, itemsPence: total, expectedPence: total, missingPence: 0 }, ...extra };
}

export function receipts() {
  seq = 0;
  const list = [
    // Fashion with a very long shop and product name, two days left to return, and the shop's returns page.
    receipt("The Extraordinarily Long-Named Outdoor & Mountaineering Supply Company", [line("Ultralight Waterproof Breathable Three-Layer Mountain Shell Jacket with Detachable Hood, Midnight Navy", 21900, { variant: "Men's Large / Regular Fit", category: "fashion" })], 26,
      { domain: "longnamed.example", returns: { windowDays: 28, deadline: day(2), portalUrl: "https://returns.longnamed.example/start" } }),
    // Several things in one order, 12 days to go.
    receipt("Harlow & Co", [line("Wool Coat", 12000, { variant: "UK 10" }), line("Cashmere Beanie", 3500), line("Leather Gloves", 4500, { variant: "M" })], 6, { returns: { windowDays: 30, deadline: day(24) } }),
    // On its way.
    receipt("Northfold", [line("Flow Flared Pant", 6900, { variant: "UK 8" })], 2, { delivery: { status: "shipped", carrier: "Royal Mail", at: day(-1) }, returnBy: { date: day(14), basis: "uk_law", from: "delivery" } }),
    // A return on its way back, then refunded.
    receipt("Kick Lane", [line("Court Classic Trainers", 8500, { variant: "UK 7" })], 18, { returns: { windowDays: 30, deadline: day(12) },
      returnProgress: { trackingNumber: "QQ000000001GB", carrier: "Royal Mail", trackUrl: null, parcel: { status: "in_transit", at: day(-1) }, receivedAt: null, refundedAt: null, refundPence: null, currency: null } }),
    receipt("Glow Lab", [line("Vitamin C Serum 30ml", 2800, { category: "beauty" }), line("Mini Cleanser Trial Set", 0, { lineTotal: true, free: true })], 34, { category: "beauty",
      returnProgress: { trackingNumber: null, carrier: null, trackUrl: null, parcel: null, receivedAt: day(-6), refundedAt: day(-4), refundPence: 2800, currency: "GBP" } }),
    // Cancelled by the shop.
    receipt("Brindle & Co", [line("Ceramic Pour-Over Coffee Set", 4600, { category: "home" })], 9, { category: "home", cancelled: { partial: false, at: day(-8) } }),
    // A supermarket shop: lots of lines, can't go back.
    receipt("Sainsbury's", ["Semi-Skimmed Milk 2.27L", "Wholemeal Bread 800g", "Free Range Eggs x12", "Bananas Loose", "Cheddar Cheese 400g", "Basmati Rice 1kg", "Greek Yoghurt 500g", "Tinned Tomatoes x4"].map((n, i) => line(n, 120 + i * 45, { category: "food" })), 1,
      { domain: "sainsburys.co.uk", category: "food", returnable: false }),
    // A takeaway through a delivery app: the restaurant is the merchant, its dishes the items.
    receipt("Deliveroo", [line("Chicken Katsu Curry", 1250, { category: "food" }), line("Vegetable Gyoza (6)", 650, { category: "food" }), line("Delivery fee", 299, { category: "food" })], 0,
      { domain: "deliveroo.co.uk", merchant: "Golden Lotus Kitchen", category: "food", returnable: false }),
    // In-game coins and an app subscription: digital, never returned.
    receipt("Pixel Forge", [line("1,200 Gold Coins", 999, { category: "digital" })], 0, { category: "digital", returnable: false }),
    receipt("Apple", [line("Cloud Storage 200GB (Monthly)", 299, { category: "digital" })], 3, { domain: "apple.com", category: "digital", returnable: false, subscriptionEnds: null }),
    // A hotel stay paid at the hotel, and one already paid.
    receipt("Booking.com", [line("Superior Double Room with Harbour View", 24000, { lineTotal: true, variant: "2 nights" })], 4, { merchant: "Harbour View Hotel & Spa", category: "travel", returnable: false, payAtProperty: true }),
    receipt("Booking.com", [line("Twin Room", 31000, { lineTotal: true, variant: "3 nights" })], 70, { merchant: "Quayside Inn", category: "travel", returnable: false }),
    // A flight that can be cancelled within 24 hours of booking.
    receipt("Skyway Air", [line("Flight to Lisbon, return", 18950)], 0, { category: "travel", returnable: false, sentAt: new Date(NOW - 3 * 36e5).toISOString(),
      returns: { windowHours: 24, windowFrom: "order", cancelWithin: true, instructions: ["You may cancel your flight booking and claim a refund without penalty, up to 24 hours from when you made the original booking."] } }),
    receipt("Cloudhop", [line("Flight to Dublin", 9900)], 40, { category: "travel", returnable: false }),
    // A gift card bought, and an order part paid with one.
    receipt("Larkspur Home", [line("Digital Gift Card", 5000, { category: "other" })], 11, { category: "other", returnable: false }),
    receipt("Larkspur Home", [line("Brass Table Lamp with Linen Shade", 6000, { category: "home" })], 15, { category: "home", giftCardPence: 2000, returns: { windowDays: 30, deadline: day(15) } }),
    // A gift for someone.
    receipt("Tidepool Prints", [line("Harbour at Dawn print, A3", 4200, { category: "home" })], 20, { category: "home", gift: { for: "Sam" }, totalPence: 4599, shopTotalPence: 4200, shopTotalPaidVia: "paypal.com",
      itemsCheck: { complete: true, itemsPence: 4200, expectedPence: 4200, missingPence: 0 } }),
    // In euros.
    receipt("Maison Verte Paris", [line("Linen Shirt", 8900)], 25, { currency: "EUR", returns: { windowDays: 14, deadline: day(-11) } }),
    // A pack priced as one.
    receipt("Pixel Forge", [line("Starter Sword", null), line("Oak Shield", null), line("500 Gold", null)], 5, { category: "digital", returnable: false, totalPence: 499,
      itemsCheck: { complete: true, itemsPence: 499, expectedPence: 499, missingPence: 0, pack: true } }),
  ];
  // Plenty of older receipts, over many months.
  const shops = [["Fernway", "home"], ["Bramble Beauty", "beauty"], ["Kestrel Sports", "other"], ["Page Turner Books", "experiences"], ["Volt Electricals", "electronics"], ["Harlow & Co", "fashion"]];
  const things = { home: "Stoneware Mug Set", beauty: "Argan Oil Conditioner 250ml", other: "Football Duffel Bag", experiences: "Theatre Tickets, Stalls", electronics: "USB-C Charging Cable 2m", fashion: "Merino Jumper" };
  for (let i = 0; i < 36; i++) { const [s, c] = shops[i % shops.length]; list.push(receipt(s, [line(things[c] + (i > 5 ? " " + (i + 1) : ""), 1500 + (i * 731) % 9000, { category: c })], 45 + i * 11, { category: c })); }
  return list;
}

export function wrapped(list) {
  const year = new Date(NOW).getFullYear();
  return buildWrapped(list.filter(r => r.orderDate.startsWith(String(year))).map(r => ({ ...r, retailer: { name: r.retailer.name, domain: r.retailer.domain || r.retailer.name.toLowerCase().replace(/[^a-z]+/g, "") + ".example" } })), year);
}

export const BANK_CONN = "00000000-0000-4000-8000-0000000000aa";
export const bank = () => ({ available: true, testBanks: false, choices: ["amex", "monzo", "barclays"], connections: [
  { id: BANK_CONN, bank: "American Express", connectedAt: day(-30) + "T09:00:00Z", syncedAt: new Date(NOW - 36e5).toISOString(), needsReconnect: false, payments: 3, matched: 2,
    cards: [{ ref: "11111111-1111-4111-8111-111111111111", label: "Amex Gold ending 1004", mine: true }, { ref: "22222222-2222-4222-8222-222222222222", label: "Amex Platinum ending 2009", mine: false }] },
  { id: "00000000-0000-4000-8000-0000000000bb", bank: "Monzo", connectedAt: day(-60) + "T09:00:00Z", syncedAt: new Date(NOW - 2 * 36e5).toISOString(), needsReconnect: true, payments: 2, matched: 1,
    cards: [{ ref: "33333333-3333-4333-8333-333333333333", label: "Monzo Current Account ending 7781", mine: true }] }] });
// Newest first, as Relay's server sends them.
export const bankPayments = () => ({ payments: [
  { id: BANK_CONN + ":m3", account: "Monzo Current Account ending 7781", date: day(-1), amountPence: 1834, currency: "GBP", description: "SAINSBURYS S/MKTS", merchant: null, shop: "Sainsbury's", receiptId: null, match: null },
  { id: BANK_CONN + ":m1", account: "Amex Gold ending 1004", date: day(-3), amountPence: 4500, currency: "GBP", description: "BRINDLE AND CO LONDON GB", merchant: null, shop: "Brindle & Co", receiptId: null, match: null },
  { id: BANK_CONN + ":m2", account: "Amex Gold ending 1004", date: day(-6), amountPence: 21900, currency: "GBP", description: "LONGNAMED OUTDOOR SUPPLY CO", merchant: null, shop: "The Extraordinarily Long-Named Outdoor & Mountaineering Supply Company", receiptId: null, match: null }] });

const SHOPS = [["Kestrel Sports", "kestrel.example"], ["Bramble Beauty", "bramble.example"], ["Harlow & Co", "harlow.example"], ["Fernway", "fernway.example"]];
const NAMES = ["Academy Hardcase Football Duffel Bag (Medium, 60L) in Black and Bright White", "Argan Oil Repairing Conditioner for Dry and Damaged Hair, 250ml",
  "Extra-Long Hand-Thrown Stoneware Table Lamp with Linen Drum Shade", "Linen Notebook", "Court Trainers", "Wool Scarf", "Travel Mug", "Desk Lamp", "Merino Socks", "Canvas Tote"];
export const products = () => NAMES.map((n, i) => ({ product: n, variation: i === 4 ? "White / UK 8" : "Default Title", sku: "shopify:shop" + (i % 4) + ":variant:" + (100 + i), priceMinor: 1500 + i * 700, currency: "GBP",
  storeName: SHOPS[i % 4][0], shopDomain: SHOPS[i % 4][1], inStock: true, imageUrl: "https://img.example/" + (i % 3 === 1 ? "tall" : "sq") + "/" + i + ".svg", productType: ["Bags", "Hair care", "Lighting", "Stationery", "Shoes", "Scarves", "Kitchen", "Lighting", "Socks", "Bags"][i] }));
// The bag (worker/bag.js's shape): two shops, one thing with a long name, one bought three at a time, one sold out.
export const bag = () => [
  { sku: "shopify:kestrel.example:variant:gid://shopify/ProductVariant/7001", kind: "shopify", product: NAMES[0], variation: "Black", priceMinor: 6500, imageUrl: "https://img.example/sq/0.svg",
    productUrl: null, shop: "Kestrel Sports", shopKey: "kestrel.example", origin: "https://kestrel.example", variantId: "7001", cart: true, qty: 1, addedAt: NOW - DAY },
  { sku: "shopify:kestrel.example:variant:gid://shopify/ProductVariant/7008", kind: "shopify", product: "Merino Socks", variation: "UK 7-9", priceMinor: 1200, imageUrl: "https://img.example/sq/8.svg",
    productUrl: null, shop: "Kestrel Sports", shopKey: "kestrel.example", origin: "https://kestrel.example", variantId: "7008", cart: true, qty: 3, addedAt: NOW - DAY },
  { sku: "shopify:harlow.example:variant:gid://shopify/ProductVariant/7105", kind: "shopify", product: "Wool Scarf", variation: null, priceMinor: 3800, imageUrl: "https://img.example/tall/5.svg",
    productUrl: null, shop: "Harlow & Co", shopKey: "harlow.example", origin: "https://harlow.example", variantId: "7105", cart: true, qty: 1, addedAt: NOW - 2 * DAY },
  { sku: "shopify:harlow.example:variant:gid://shopify/ProductVariant/7106", kind: "shopify", product: "Canvas Tote", variation: "Natural", priceMinor: 2200, imageUrl: "https://img.example/sq/9.svg",
    productUrl: null, shop: "Harlow & Co", shopKey: "harlow.example", origin: "https://harlow.example", variantId: "7106", cart: true, qty: 1, addedAt: NOW - 2 * DAY, soldOut: true }];
// Pay at a shop, as worker/bag.js answers it: the long-named one now costs more.
export const bagCheck = (items, shop) => ({ shop, cart: true, checkedAt: NOW, items,
  results: items.filter(x => x.shopKey === shop).map((x, i) => ({ sku: x.sku, checked: true, was: x.priceMinor, priceMinor: i === 0 ? x.priceMinor + 500 : x.priceMinor, available: !x.soldOut })) });
export function watches() {
  const w = {};
  products().slice(0, 6).map((p, i) => [p, i]).reverse().forEach(([p, i]) => { w[p.sku] = { name: p.product, variant: p.variation, baseline: p.priceMinor + (i % 2 === 0 ? 1000 : 0), created: new Date(NOW - i * DAY).toISOString() }; });
  return w;
}
export const svgSq = (i) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="hsl(${i * 67 % 360},50%,80%)"/><circle cx="300" cy="300" r="160" fill="hsl(${i * 67 % 360},40%,45%)"/></svg>`;
export const svgTall = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="1200"><rect width="400" height="1200" fill="#e8e1d5"/><circle cx="200" cy="140" r="90" fill="#b9805a"/><rect x="110" y="240" width="180" height="900" fill="#2f4f6f"/></svg>`;

const q = (o) => ({ receipts: 0, high: 0, medium: 0, low: 0, confirmed: 0, dismissed: 0, noTotal: 0, noItems: 0, pasted: 0, ...o });
export const health = () => ({
  generatedAt: new Date(NOW).toISOString(), minShoppersPerShop: 3,
  people: { shoppers: 12, newThisWeek: 3, newThisMonth: 7, signedIn: 9, signedInThisWeek: 6 },
  inboxes: { gmail: 10, outlook: 3, shoppers: 11, checkedToday: 12, notCheckedToday: 1, lastChecked: new Date(NOW - 600e3).toISOString(), newThisWeek: 2,
    scansThisWeek: { done: 14, failed: 2, running: 1 }, scanErrorsThisWeek: [{ error: "gmail_reconnect_needed", count: 1 }] },
  reading: { readerVersion: 26, emailsLookedAt: 4210, notReceipts: 3570, emailsThisWeek: 312, kinds: { receipt: 540, delivery_update: 80, return_update: 20 },
    purchases: q({ receipts: 540, high: 466, medium: 51, low: 23, confirmed: 120, dismissed: 14, noTotal: 19, noItems: 11, pasted: 6 }), purchasesThisWeek: q({ receipts: 46, high: 41, medium: 4, low: 1 }),
    byReader: [{ version: 26, emails: 4100 }, { version: 25, emails: 110 }], waitingToBeRead: 2, shoppersTaught: { groupsChanged: 9, shopsMarkedPromotions: 4, people: 5 }, itemsMarkedReturning: 3,
    days: Array.from({ length: 14 }, (_, i) => ({ day: day(i - 13), kept: (i * 3) % 8, skipped: (i * 5) % 13 })) },
  shops: [{ domain: "brindle.example", people: 4, ...q({ receipts: 22, high: 15, medium: 3, low: 4, dismissed: 2, noTotal: 3 }) }],
  mine: { receipts: 61, personalMail: 2, noShop: 0, shops: [{ domain: "fennel.example", ...q({ receipts: 5, high: 3, low: 2, noTotal: 2, pasted: 1 }) }] },
  returnsAndSwaps: { returns: { requested: 2, refunded: 1 }, swaps: { completed: 3 }, labels: 2, payments: [{ status: "succeeded", test: true, count: 4 }] },
  extras: { gifts: 7, giftGivers: 2, earlierYearsRead: 5, notificationDevices: 4, notificationPeople: 3, priceWatches: 11, watchers: 4 },
  shopsConnected: { shopify: 6, shopifyTest: 6, square: 1 }, security: { wrongCodesToday: 0 }, mail: { ownAddress: false, returnsShopNotEmailedThisWeek: 1 },
  sharedEmails: { kept: 3, waiting: 2, thisWeek: 1, people: 2, keptDays: 30 }
});
