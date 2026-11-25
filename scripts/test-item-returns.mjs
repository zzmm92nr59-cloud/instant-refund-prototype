// Which items of an email order are being returned: the shopper's choice, or a unique match to the refund amount.
import assert from "node:assert/strict";
import { itemsForRefund, attachItemReturns } from "../worker/gmail.js";
const items = [{ name: "Align Pant", pricePence: 6900 }, { name: "Tee", pricePence: 3800 }, { name: "Socks", pricePence: 1200 }];
assert.deepEqual(itemsForRefund(items, 6900), [0], "refund equals one item's price");
assert.deepEqual(itemsForRefund(items, 5000), [1, 2], "refund equals two items together");
assert.equal(itemsForRefund(items, 11900), null, "the whole order isn't an item-by-item answer");
assert.equal(itemsForRefund(items, 1234), null, "no match, no guess");
assert.equal(itemsForRefund([{ name: "A", pricePence: 1000 }, { name: "B", pricePence: 1000 }], 1000), null, "two items fit equally: don't guess");
assert.equal(itemsForRefund([{ name: "A", pricePence: 1000 }, { name: "B" }], 1000), null, "an item with no price: don't guess");
assert.equal(itemsForRefund([{ name: "A", pricePence: 1000 }], 1000), null, "single-item orders don't need it");
assert.deepEqual(itemsForRefund([{ name: "A", pricePence: 500, qty: 2 }, { name: "B", pricePence: 700 }], 1000), [0], "quantity counts");
const orders = [
  { id: "r1", items, returnProgress: { refundPence: 3800 } },
  { id: "r2", items, returnProgress: { refundPence: 3800 } },
  { id: "r3", items }];
attachItemReturns(orders, [{ id: "r2", i: 0, status: "returning" }, { id: "r2", i: 1, status: "kept" }]);
assert.deepEqual(orders[0].itemReturns, { 1: "returning" }); assert.equal(orders[0].itemReturnsFrom, "refund");
assert.deepEqual(orders[1].itemReturns, { 0: "returning", 1: "kept" }, "the shopper's own choice beats the refund guess");
assert.equal(orders[1].itemReturnsFrom, undefined);
assert.equal(orders[2].itemReturns, undefined);
// (25 Nov 2026) Which items a refund was for (refundItems): only when the amounts say so, never because an item was marked.
{
  const mk = (id, refundPence, extra = {}) => ({ id, items, returnProgress: { refundPence }, returnTracking: { state: "refunded", steps: [] }, ...extra });
  const two = [{ name: "A", pricePence: 1000 }, { name: "B", pricePence: 1000 }, { name: "C", pricePence: 2500 }];
  const os = [mk("m1", 3800), mk("m2", 6900), mk("m3", 1234), mk("m4", 11900), mk("m5", 1000, { items: two }), mk("m6", 1000, { items: two }), mk("m7", 11900), { id: "m8", items }];
  attachItemReturns(os, [{ id: "m1", i: 1, status: "returning" }, { id: "m2", i: 1, status: "returning" }, { id: "m3", i: 1, status: "returning" }, { id: "m4", i: 1, status: "returning" },
    { id: "m5", i: 0, status: "returning" }, { id: "m8", i: 1, status: "returning" }]);
  assert.deepEqual(os[0].refundItems, [1], "the refund is the price of the item the shopper said went back");
  assert.deepEqual([os[1].itemReturns, os[1].refundItems], [{ 1: "returning" }, [0]], "the refund is another item's price: the shopper's choice stays, and the refund is said for the item it fits");
  assert.equal(os[2].refundItems, undefined, "an amount that fits nothing: not said for any item");
  assert.deepEqual(os[3].refundItems, [0, 1, 2], "the whole order's price: every item");
  assert.deepEqual(os[4].refundItems, [0], "two items cost the same, and the shopper said which one went back");
  assert.deepEqual([os[5].itemReturns, os[5].refundItems], [undefined, undefined], "two items cost the same and nobody said which: no guess");
  assert.deepEqual([os[6].itemReturns, os[6].refundItems], [undefined, [0, 1, 2]], "the whole order refunded, nothing marked");
  assert.equal(os[7].refundItems, undefined, "no refund: nothing");
  // A refund's one clear answer is also put on the return's timeline, said as worked out from the refund.
  const g = mk("g1", 3800); attachItemReturns([g], []);
  assert.deepEqual([g.itemReturnsFrom, g.refundItems, g.returnTracking.items, g.returnTracking.itemsFrom], ["refund", [1], [1], "refund"]);
}
console.log("PASS item returns: refunds said for an item only when the amounts fit; and shopper's choice first, refund amount matched only when there's exactly one answer");
