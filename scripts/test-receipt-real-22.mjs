// Round 21b (21 Nov 2026): a check of a real inbox, January to June 2025, after round 21. False information first. Every email
// here is MADE UP (scripts/fixtures/receipt-emails/holdout22.mjs): shops, events, hotels, items, prices, people and numbers.
//  1. Amazon's "Ordered:" email printing "Total £0.00" for priced items: no total is made up for it, and the order's
//     "Dispatched:" email, which states the total, gives the card its total.
//  2. A supermarket order whose first confirmation isn't in the inbox, only its change ("Estimated total") and its
//     delivery-day email ("Payment received"): the card shows what was paid, with the change's delivery fee, never the estimate.
//  3. An Amazon book whose author is written surname first under its title: the title is the thing bought.
//  4. An event's receipt with each name and price on rows of their own: each price stays with its own name; the booking fee is
//     a fee; its "Payment Reference" is the receipt's reference.
//  5. A hotel's cancellation naming the stay by "Itinerary #": joined to the booking, which shows as cancelled.
//  6. A shop's order email that opens "We've got your order" under a subject that says nothing: read, with its order number,
//     and joined with PayPal's receipt for it (one card, the shop's own).
//  7. PayPal's "You've submitted an order" keeps its Transaction ID as the reference; PayPal's receipt for coins keeps the
//     tax as its own line; a supermarket's "(e.g. if your goods are not wanted) within 14 days starting from the day after the
//     date of delivery" is a 14-day window from delivery, with its 30 day goodwill policy kept in its words.
//  8. The new patterns take linear time on a 40,000-character line.
//   node scripts/test-receipt-real-22.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { classifyEmail, mergeOrderEmails, attachDeliveries, attachCancellations } from "../worker/gmail.js";
import { readItems } from "../worker/receipt-items.js";
import { rawEmail, fixture } from "./fixtures/receipt-emails/lib.mjs";
import { AMAZON, STAY, THREADLY, PAYPAL, GROCER_RETURNS } from "./fixtures/receipt-emails/holdout22.mjs";

const fx = (id) => JSON.parse(readFileSync(new URL("./fixtures/receipt-emails/" + id + ".json", import.meta.url), "utf8"));
const read = (m, id) => ({ ...classifyEmail(rawEmail(fixture(id, "", "", m, {}))).details, id, createdAt: 0 });

// 1. Amazon: "Total £0.00" for priced items is no total; the dispatch email's stated total is.
{
  const o = read(AMAZON.ordered, "a1"), d = read(AMAZON.dispatched, "a2");
  assert.equal(o.kind, "receipt");
  assert.equal(o.totalPence, null, "never £0.00 for priced items, and never a total worked out from them");
  assert.deepEqual(o.items.map((i) => i.pricePence), [749, 849]);
  assert.equal(d.kind, "delivery_update");
  assert.equal(d.orderTotalPence, 1598, "the dispatch email's stated total is kept: " + JSON.stringify(d));
  const cards = mergeOrderEmails([o]);
  attachDeliveries(cards, [d]);
  assert.equal(cards[0].totalPence, 1598, "the card takes the total its dispatch email states");
  assert.equal(cards[0].itemsCheck.complete, true);
  // (Never over a total the order's own email gave.)
  const own = { ...o, totalPence: 1500 }, c2 = mergeOrderEmails([own]);
  attachDeliveries(c2, [d]);
  assert.equal(c2[0].totalPence, 1500, "the order's own total stays");
  console.log("ok - Amazon's 'Total £0.00' for priced items gives no total; its dispatch email's stated total fills it in");
}

// 2. A supermarket order: its change and its delivery-day payment, no first confirmation.
{
  const items = [{ name: "Oat Milk 1L", qty: 2, pricePence: 150 }, { name: "Sourdough Loaf", qty: 1, pricePence: 220 }, { name: "Pecan Halves 100g", qty: 1, pricePence: 250 }];
  const changed = { id: "g1", createdAt: 1, kind: "receipt", retailer: { name: "Greenleaf", domain: "greenleaf.example" }, orderRef: "1100223344", orderDate: "2025-05-09", orderDateFrom: "email", currency: "GBP",
    totalPence: 970, items, orderUpdate: "amended", amendedAt: "2025-05-09T19:20:00.000Z", fees: [{ label: "Delivery cost", pence: 200 }], itemsCheck: { complete: true, itemsPence: 770, expectedPence: 770, missingPence: 0 }, itemCount: 4 };
  const paid = { id: "g2", createdAt: 2, kind: "receipt", retailer: { name: "Greenleaf", domain: "greenleaf.example" }, orderRef: "1100223344", orderDate: "2025-05-10", orderDateFrom: "email", currency: "GBP",
    totalPence: 920, items: [], orderUpdate: "paid", substitutions: [{ from: "Pecan Halves 100g", to: { name: "Walnut Pieces 80g", qty: 1, pricePence: 200 } }],
    itemsCheck: { complete: false, itemsPence: 0, expectedPence: null, missingPence: null, orderUpdate: true, inAttachment: "pdf" }, detailsInAttachment: "pdf" };
  for (const order of [[changed, paid], [paid, changed]]) {
    const [c] = mergeOrderEmails(order);
    assert.equal(c.totalPence, 920, "what was paid, never the change's estimate: " + JSON.stringify([c.totalPence, c.estimatedTotalPence]));
    assert.deepEqual(c.fees, [{ label: "Delivery cost", pence: 200 }], "the delivery fee the change listed");
    assert.equal(c.items.length, 3);
    assert.equal(c.items[2].name, "Walnut Pieces 80g", "the substitution");
    assert.equal(c.itemsCheck.complete, true, "the items and the delivery fee come to what was paid: " + JSON.stringify(c.itemsCheck));
    assert.equal(c.orderDate, "2025-05-09");
  }
  console.log("ok - a supermarket's paid receipt wins over its change's estimate when the first confirmation is missing, with the delivery fee");
}

// 3. An Amazon book with its author surname first.
{
  const r = parseReceiptEmail(rawEmail(fx("holdout22-amazon-book-surname-first")));
  assert.deepEqual(r.items.map((i) => [i.name, i.pricePence]), [["Plain Speaking: Revised and Updated Edition: How to Say What You Mean and Mean What You Say of Lane, Robin", 640]]);
  assert.notEqual(r.itemsCheck.namesOk, false, "a title with its author is not a sentence");
  console.log("ok - an Amazon book named by its title, never by its author written surname first");
}

// 4. An event's receipt, names and prices on rows of their own.
{
  const r = parseReceiptEmail(rawEmail(fx("holdout22-event-rows-of-their-own")));
  assert.deepEqual(r.items.map((i) => [i.name, i.pricePence]), [["Riverside 10K 2025 — 1x Riverside 10K Charity Entry - Charity", 4500]], "each price with its own name");
  assert.deepEqual(r.fees, [{ label: "Riverside 10K 2025 — 1x Booking Fee", pence: 325 }], "the booking fee is a fee");
  assert.deepEqual(r.discounts, [{ label: "Riverside 10K 2025 — 1x Reserved Entry Discount", pence: 4825 }]);
  assert.equal(r.totalPence, 0);
  assert.equal(r.orderRef, "5f1a2b3c4d5e6f7a8b9c0d1e", "its Payment Reference");
  console.log("ok - an event's receipt keeps each price with its own name, the booking fee as a fee and its payment reference");
}

// 5. A hotel's cancellation by its itinerary number.
{
  const c = read(STAY.cancellation, "s1");
  assert.equal(c.kind, "order_update");
  assert.equal(c.stage, "cancelled");
  assert.equal(c.orderRef, "73001122334455");
  const cards = [{ ...STAY.booking }];
  attachCancellations(cards, [c]);
  assert.ok(cards[0].cancelled && cards[0].cancelled.partial === false, "the booking shows as cancelled: " + JSON.stringify(cards[0].cancelled));
  console.log("ok - a hotel's cancellation naming the stay by 'Itinerary #' joins the booking");
}

// 6. A shop's "We've got your order", its dispatch email and PayPal's receipt: one card, the shop's.
{
  const o = read(THREADLY.order, "t1"), d = read(THREADLY.dispatched, "t2"), p = read(THREADLY.paypal, "t3");
  assert.equal(o.kind, "receipt", "the shop's own order email is read: " + JSON.stringify(o));
  assert.equal(o.orderRef, "UK2200113344");
  assert.deepEqual(o.items.map((i) => [i.name, i.pricePence]), [["Relaxed Linen Shirt In Sand", 900], ["Cropped Cargo Trouser", 1450], ["Ribbed Tank Top", 600]], "never a heading for a name, never a price moved");
  assert.ok(!o.items.some((i) => /in progress/i.test(i.variant || "")), "the order's status is not what the thing is");
  assert.equal(d.kind, "delivery_update");
  assert.equal(p.kind, "receipt");
  const cards = mergeOrderEmails([p, o]);
  assert.equal(cards.length, 1, "one card: " + JSON.stringify(cards.map((c) => [c.retailer, c.orderRef])));
  assert.equal(cards[0].orderRef, "UK2200113344");
  assert.ok(!cards[0].retailer.via, "the shop's own email leads");
  attachDeliveries(cards, [d]);
  assert.equal(cards[0].delivery && cards[0].delivery.status, "shipped");
  console.log("ok - a shop's 'We've got your order' email is read and joined with its dispatch email and PayPal's receipt");
}

// 7. PayPal's submitted order and coins with tax; a supermarket's return window after "e.g.".
{
  const s = read(PAYPAL.submitted, "p1");
  assert.equal(s.orderRef, "O-1AB23456CD7890123", "PayPal's Transaction ID is the reference: " + JSON.stringify(s.orderRef));
  assert.equal(s.refIsPayment, true);
  // (A shop's own email for the same purchase, minutes away with the same money, still joins it.)
  const shop = { id: "w1", createdAt: 0, kind: "receipt", retailer: { name: "Cellarway Wines", domain: "cellarway.example" }, orderRef: "CW-55120", orderDate: "2025-02-22", currency: "GBP", totalPence: 3200,
    sentAt: "2025-02-22T19:40:30.000Z", items: [{ name: "Mixed Case", qty: 1, pricePence: 3200 }] };
  const joined = mergeOrderEmails([s, shop]);
  assert.equal(joined.length, 1, "the shop's email and PayPal's are one card: " + JSON.stringify(joined.map((c) => c.orderRef)));
  assert.equal(joined[0].orderRef, "CW-55120");
  const c = read(PAYPAL.coins, "p2");
  assert.deepEqual(c.items.map((i) => [i.name, i.pricePence]), [["Coins_7", 416]], "the coins at their price");
  assert.deepEqual(c.fees, [{ label: "Tax", pence: 83 }], "the tax as its own line");
  assert.equal(c.totalPence, 499);
  const g = parseReceiptEmail(rawEmail(fixture("g", "", "", { from: "Greenleaf <orders@greenleaf.example>", subject: "Your Greenleaf order confirmation", date: "Fri, 21 Feb 2025 23:00:00 +0000",
    text: GROCER_RETURNS.replace("Estimated total: £42.10", "Oat Milk 1L | 2 | £3.00\nSourdough Loaf | 1 | £2.20\nTotal: £5.20") }, {})), { lenient: true });
  assert.equal(g.returns && g.returns.windowDays, 14, "the 14-day window: " + JSON.stringify(g.returns));
  assert.equal(g.returns.windowFrom, "delivery");
  assert.ok(g.returns.instructions.some((x) => /30 day goodwill/i.test(x)), "the goodwill policy in its words");
  console.log("ok - PayPal's submitted order keeps its Transaction ID, coins keep their tax line, and a window after 'e.g.' is 14 days from delivery");
}

// 8. Linear time.
{
  const long = "a".repeat(40000), t0 = Date.now();
  parseReceiptEmail(rawEmail(fixture("lin", "", "", { from: "Shop <a@shop.example>", subject: "Your order", date: "Mon, 07 Apr 2025 10:00:00 +0000",
    text: ["We've got your order", "Order Number: " + long, "It’s " + long + "...", "Payment Reference " + long, "Itinerary # " + "1".repeat(40000), long + ", " + long, "Status: " + long, "x — " + long + " Booking Fee", "Total £1.00"].join("\n") }, {})));
  readItems(["£1.00", long + " Booking Fee", "It's" + " a".repeat(20000) + "...", "Status:", long].join("\n"), { priceAbove: true });
  classifyEmail(rawEmail(fixture("lin2", "", "", { from: "Expedia <a@expedia.example>", subject: "Hotel Cancellation Confirmation", date: "Mon, 03 Mar 2025 10:00:00 +0000",
    text: "your reservation was cancelled\nItinerary " + "# ".repeat(20000) + "\nYou placed a £" + "1".repeat(40000) + " order with" }, {})));
  assert.ok(Date.now() - t0 < 3000, "took " + (Date.now() - t0) + "ms");
  console.log("ok - the new patterns take linear time on 40,000-character lines");
}
console.log("PASS round 21b: dispatch totals, paid supermarket orders, book titles, event receipts, cancelled stays, shop order emails, PayPal references and tax, return windows after 'e.g.'");
