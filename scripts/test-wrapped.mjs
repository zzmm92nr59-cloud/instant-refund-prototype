import assert from "node:assert/strict";
import { buildWrapped } from "../worker/wrapped.js";
const R = (name, domain) => ({ name, domain });
const cards = [
  { id: "1", kind: "order", retailer: R("Zara", "zara.com"), orderDate: "2026-03-10", totalPence: 5990, currency: "GBP", category: "fashion", categoryLabel: "Fashion", items: [{ name: "Coat", qty: 1 }], orderRef: "A1", createdAt: Date.parse("2026-03-11") },
  { id: "2", kind: "order", retailer: R("Zara", "zara.com"), orderDate: "2026-03-10", totalPence: 5990, currency: "GBP", category: "fashion", categoryLabel: "Fashion", items: [{ name: "Coat", qty: 1 }], orderRef: "A1", createdAt: Date.parse("2026-03-12") }, // same order, dispatch email
  { id: "3", kind: "order", retailer: R("Tesco", "tesco.com"), orderDate: "2026-03-20", totalPence: 4210, currency: "GBP", category: "food", categoryLabel: "Food & drink", items: [{ name: "Shop", qty: 2 }, { name: "Milk" }], createdAt: Date.parse("2026-03-20") },
  { id: "4", kind: "order", retailer: R("Apple", "apple.com"), orderDate: "2026-06-01", totalPence: null, currency: null, category: "digital", categoryLabel: "Digital", items: [], createdAt: Date.parse("2026-06-01") },
  { id: "5", kind: "order", retailer: R("Amazon", "amazon.com"), orderDate: "2026-07-01", totalPence: 1000, currency: "USD", category: "other", categoryLabel: "Other", items: [{ name: "Thing", qty: 1 }], createdAt: Date.parse("2026-07-01") },
  { id: "6", kind: "order", retailer: R("Old Shop", "old.com"), orderDate: "2025-12-31", totalPence: 9999, currency: "GBP", category: "other", categoryLabel: "Other", items: [], createdAt: Date.parse("2025-12-31") },
  { id: "7", kind: "return_instructions", retailer: R("Zara", "zara.com"), orderDate: "2026-03-10", createdAt: Date.parse("2026-03-30") },
  { id: "8", kind: "order", retailer: R("Zara", "zara.com"), orderDate: "2026-03-25", totalPence: 2000, currency: "GBP", category: "fashion", categoryLabel: "Fashion", items: [{ name: "Top", qty: 1 }], returnPlan: { orderRef: "B2" }, orderRef: "B2", createdAt: Date.parse("2026-03-25") },
];
const w = buildWrapped(cards, 2026);
assert.equal(w.receipts, 5, "duplicate order, other-year and return emails are left out");
assert.equal(w.spentPence, 5990 + 4210 + 2000, "only readable £ totals are added up");
assert.deepEqual(w.coverage, { withTotal: 3, noTotal: 1, otherCurrency: 1 }, "left-out receipts are counted, not hidden");
assert.equal(w.shops, 4);
assert.equal(w.topShops[0].name, "Zara");
assert.equal(w.topShops[0].spentPence, 7990);
assert.equal(w.categories[0].category, "fashion");
assert.equal(w.busiestMonth, "Mar");
assert.equal(w.biggest.shop, "Zara");
assert.equal(w.returnsStarted, 1);
assert.equal(w.items, 1 + 3 + 0 + 1 + 1, "items add up quantities; a line with no quantity counts as one");
assert.equal(w.byMonth.length, 12);
assert.ok(/in-store/i.test(w.note));
const empty = buildWrapped([], 2026);
assert.equal(empty.receipts, 0); assert.equal(empty.personality, null); assert.equal(empty.biggest, null); assert.equal(empty.busiestMonth, null);
// Story facts.
assert.deepEqual(w.years, [{ year: 2026, receipts: 6 }, { year: 2025, receipts: 1 }], "years with receipts, newest first (return emails left out)");
assert.equal(w.topItem, null, "the same order arriving as two emails is not a repeat purchase");
const rep = buildWrapped([1, 2, 3].map(i => ({ kind: "order", retailer: R("Game", "g.com"), orderDate: "2026-04-0" + i, orderRef: "G" + i, totalPence: 159, currency: "GBP", items: [{ name: "Coins" }] })), 2026);
assert.deepEqual(rep.topItem, { name: "Coins", times: 3, shop: "Game" }, "bought on three separate orders");
assert.equal(w.topShopShare, Math.round(7990 / (5990 + 4210 + 2000) * 100));
assert.equal(w.activeMonths, 3);
assert.equal(w.refundedPence, 0);
const once = buildWrapped([{ kind: "order", retailer: R("A", "a.com"), orderDate: "2026-01-01", totalPence: 100, currency: "GBP", items: [{ name: "One" }] }], 2026);
assert.equal(once.topItem, null, "something bought once is not 'on repeat'");
const refunds = buildWrapped([{ kind: "order", retailer: R("A", "a.com"), orderDate: "2026-02-01", totalPence: 5000, currency: "GBP", items: [], returnProgress: { refundPence: 2500 } }], 2026);
assert.equal(refunds.refundedPence, 2500); assert.equal(refunds.refundsMatched, 1);
// A receipt forwarded from a personal mailbox is the same purchase as the shop's email: counted once, never shown as a shop.
const fw = buildWrapped([
  { kind: "order", retailer: R("Beds Ltd", "beds.test"), orderDate: "2026-07-06", totalPence: 187000, currency: "GBP", items: [] },
  { kind: "order", retailer: R("Sam Smith", "gmail.com"), orderDate: "2026-07-07", totalPence: 187000, currency: "GBP", items: [] },
  { kind: "order", retailer: R("Sam Smith", "gmail.com"), orderDate: "2026-08-01", totalPence: 2500, currency: "GBP", items: [] }], 2026);
assert.equal(fw.spentPence, 187000 + 2500, "the forwarded copy isn't added twice");
assert.equal(fw.receipts, 2);
assert.ok(!fw.topShops.some(s => /Sam Smith|Forwarded/.test(s.name)), "a person's name is never a top shop");
// One Wrapped per kind of shopping: a top 5 never mixes a coat with a coffee.
assert.deepEqual(w.industries.map(k => [k.category, k.receipts, k.spentPence]), [["fashion", 2, 7990], ["food", 1, 4210], ["digital", 1, 0], ["other", 1, 0]], "each kind of shopping this year, biggest spend first");
assert.equal(w.industry, null);
const mix = [
  { kind: "order", retailer: R("Zara", "zara.com"), orderDate: "2026-03-10", orderRef: "Z1", totalPence: 5990, currency: "GBP", category: "fashion", items: [{ name: "Coat" }] },
  { kind: "order", retailer: R("Zara", "zara.com"), orderDate: "2026-04-10", orderRef: "Z2", totalPence: 2990, currency: "GBP", category: "fashion", items: [{ name: "Coat" }, { name: "Scarf" }] },
  { kind: "order", retailer: R("Nespresso", "nespresso.com"), orderDate: "2026-04-12", orderRef: "N1", totalPence: 4200, currency: "GBP", category: "food", items: [{ name: "Vertuo pods" }] },
  { kind: "order", retailer: R("Nespresso", "nespresso.com"), orderDate: "2026-05-12", orderRef: "N2", totalPence: 4200, currency: "GBP", category: "food", items: [{ name: "Vertuo pods" }] },
  { kind: "order", retailer: R("Nespresso", "nespresso.com"), orderDate: "2026-06-12", orderRef: "N3", totalPence: 4200, currency: "GBP", category: "food", items: [{ name: "Vertuo pods" }] }];
const fashion = buildWrapped(mix, 2026, Date.now(), { industry: "fashion" });
assert.equal(fashion.industry, "fashion"); assert.equal(fashion.industryLabel, "Fashion");
assert.equal(fashion.receipts, 2); assert.equal(fashion.spentPence, 5990 + 2990);
assert.deepEqual(fashion.topItems.map(x => x.name), ["Coat", "Scarf"], "only fashion things in the fashion top 5");
assert.deepEqual(fashion.topBuys.map(x => x.shop), ["Zara", "Zara"]);
assert.deepEqual(fashion.topShops.map(x => x.name), ["Zara"]);
assert.equal(fashion.personality, null, "no 'what kind of shopper' label inside one kind of shopping");
assert.match(fashion.badges[0].why, /of your spending on fashion went there/);
assert.deepEqual(fashion.industries.map(k => k.category), ["food", "fashion"], "the list of kinds still covers the whole year");
const food = buildWrapped(mix, 2026, Date.now(), { industry: "food" });
assert.deepEqual(food.topItem, { name: "Vertuo pods", times: 3, shop: "Nespresso" });
assert.deepEqual(food.topItems.map(x => x.name), ["Vertuo pods"]);
assert.equal(buildWrapped(mix, 2026, Date.now(), { industry: "<script>" }).industry, null, "an unknown kind is ignored");
assert.equal(buildWrapped(mix, 2026, Date.now(), { industry: "<script>" }).receipts, 5);
// One story a year: a chapter per kind of shopping, biggest spend first, each counted only from its own receipts.
const ch = w.chapters;
assert.deepEqual(ch.map(c => c.category), ["fashion", "food", "digital"], "biggest spend first, and no chapter for Other");
assert.equal(ch[0].spentPence, 7990); assert.equal(ch[0].share, Math.round(7990 / (5990 + 4210 + 2000) * 100));
assert.equal(ch[0].topShop.name, "Zara"); assert.equal(ch[0].receipts, 2);
assert.equal(ch[1].spentPence, 4210); assert.equal(ch[1].topShop.name, "Tesco");
assert.equal(ch[2].withTotal, 0, "Apple's receipt had no amount, so its chapter shows no spend");
assert.deepEqual(ch[0].fact, { kind: "perPiece", pence: Math.round(7990 / 2), pieces: 2 }, "fashion: pieces and the average price per piece");
assert.equal(buildWrapped(cards, 2026, Date.now(), { industry: "fashion" }).chapters, undefined, "a one-kind Wrapped has no chapters of its own");
assert.deepEqual(empty.chapters, []);
const foodYear = buildWrapped([1, 2, 3, 4, 5].map(i => ({ kind: "order", retailer: R("Greggs", "greggs.co.uk"), orderDate: "2026-02-0" + i, totalPence: 700, currency: "GBP", category: "food", items: [{ name: "Sausage roll" }] })), 2026, Date.UTC(2026, 11, 31));
assert.deepEqual(foodYear.chapters[0].fact, { kind: "perWeek", pence: Math.round(3500 / 52), orders: 5 });
assert.deepEqual(foodYear.chapters[0].topItem, { name: "Sausage roll", times: 5 });
// A supermarket's food chapter: kitchen roll in every basket is not its top item; the yoghurt in three of them is.
const shop = [1, 2, 3, 4].map(i => ({ kind: "order", retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-03-0" + i, totalPence: 4000 + i, currency: "GBP", category: "food",
  items: [{ name: "Super Absorbent Kitchen Towels" }, { name: "Antiperspirant Extra Fresh" }, ...(i < 4 ? [{ name: "Greek Yoghurt 950g" }] : [])] }));
const groceries = buildWrapped(shop, 2026, Date.UTC(2026, 11, 31));
assert.deepEqual(groceries.chapters.find(c => c.category === "food").topItem, { name: "Greek Yoghurt 950g", times: 3 });
assert.equal(groceries.topItem.name, "Super Absorbent Kitchen Towels", "the whole year's list still counts everything bought");
console.log("PASS wrapped: totals, duplicates, other years, unreadable amounts and returns are handled honestly; one Wrapped per kind of shopping");
