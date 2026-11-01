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
console.log("PASS item returns: shopper's choice first, refund amount matched only when there's exactly one answer");
