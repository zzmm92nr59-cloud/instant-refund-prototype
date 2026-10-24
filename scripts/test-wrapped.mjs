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
console.log("PASS wrapped: totals, duplicates, other years, unreadable amounts and returns are handled honestly");
