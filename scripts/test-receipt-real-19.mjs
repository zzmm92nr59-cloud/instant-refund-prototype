// Round 19 (20 Nov 2026): a second re-score of a real inbox against its answer keys left a joined order dated by an email
// that wasn't the order (a "we're working on it" email sent the evening before the receipt; the booking's confirmation sent
// again the day before the flight, which then led the card with one merged line), ticket fees left out of the list shown,
// a payment service's receipt with its labels and values on lines of their own read with no item, a parking receipt with no
// item, a web shop's money off under the thing it was taken off left out, a booking with no total shown blank, a delivery
// day read as the item's name, and an older ride receipt's fare parts and wait time read as one line. Each is tested here on
// MADE-UP emails in the same layouts (shops, people, codes and amounts are all made up; see
// scripts/fixtures/receipt-emails/holdout20.mjs for the full emails).
//   node scripts/test-receipt-real-19.mjs
import assert from "node:assert/strict";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { cleanItems } from "../worker/receipt-reader.js";
import { classifyEmail, mergeOrderEmails } from "../worker/gmail.js";
import { rawEmail } from "./fixtures/receipt-emails/lib.mjs";
import holdout20 from "./fixtures/receipt-emails/holdout20.mjs";
import holdout16c from "./fixtures/receipt-emails/holdout16c.mjs";
import holdout16e from "./fixtures/receipt-emails/holdout16e.mjs";
import holdout16d from "./fixtures/receipt-emails/holdout16d.mjs";

const fx = Object.fromEntries([...holdout20(), ...holdout16c(), ...holdout16d(), ...holdout16e()].map((f) => [f.id, f]));
const read = (id) => parseReceiptEmail(rawEmail(fx[id]));
const listed = (items) => cleanItems(JSON.parse(JSON.stringify(items)), { stored: true });
const mk = (from, subject, date, body, html = false) =>
  `From: ${from}\r\nTo: sam@example.com\r\nSubject: ${subject}\r\nDate: ${date}\r\nMIME-Version: 1.0\r\nContent-Type: text/${html ? "html" : "plain"}; charset=utf-8\r\n\r\n${body}`;
// One order's emails as the list keeps them: each email's reading, with the id and the time Relay stored it. Relay reads a
// mailbox newest first, so a later email is usually stored first.
let n = 0;
const stored = (raw, createdAt) => { const c = classifyEmail(raw); assert.ok(c.details && c.details.kind === "receipt", "read as a receipt: " + JSON.stringify(c.details).slice(0, 200)); return { ...c.details, id: "e" + ++n, createdAt }; };

// 1. A shop's "we're working on your order" email the evening before its receipt: the receipt leads and gives the day.
{
  const working = mk("Brightbox <no-reply@brightbox.example>", "We’re working on your tech order", "Sat, 03 Oct 2026 19:40:00 +0000",
    "Your tech's almost ready.\nOrder number: BBX1234567890\n\nYour order\nSonic 40\" Smart TV\nQty: 1\n£249.00\n\nTotal: £249.00\n");
  const receipt = mk("Brightbox <no_reply@brightbox.example>", "Thanks for your order! Here’s your receipt.", "Sun, 04 Oct 2026 08:12:00 +0000",
    "Thanks for shopping with us.\nOrder number: BBX1234567890\n\nYour order\nSonic 40\" Smart TV\nQty: 1\n£249.00\n\nSubtotal: £249.00\nTotal: £249.00\n");
  const a = stored(working, 2000), b = stored(receipt, 1000);
  assert.equal(a.progressEmail, true, "the working-on-it email is about the order's progress");
  assert.ok(!b.progressEmail, "the receipt is the order's own email");
  const [card, ...more] = mergeOrderEmails([a, b]);
  assert.equal(more.length, 0, "one card");
  // (Round 24: the order was placed by the evening its "We're working on your order" email was sent, so that is its day; the
  // receipt still leads. It used to be the receipt's day, the morning after.)
  assert.equal(card.orderDate, "2026-10-03", "dated by the first email about the order");
  assert.deepEqual(card.items.map((i) => [i.name, i.pricePence]), [["Sonic 40\" Smart TV", 24900]]);
  assert.equal(card.emailIds.length, 2);
  // (Whichever was stored first.)
  assert.equal(mergeOrderEmails([{ ...b, createdAt: 2000 }, { ...a, createdAt: 1000 }])[0].orderDate, "2026-10-03");
  assert.equal(mergeOrderEmails([{ ...b, createdAt: 2000 }, { ...a, createdAt: 1000 }])[0].id, b.id, "the receipt leads");
  console.log("ok - a progress email joined to its order never leads it; the order is dated by its first email");
}
// 2. An airline's booking confirmation sent again the day before the flight, giving the payment's day and one merged line.
{
  const booking = mk("Skyhop <no-reply@skyhop.example>", "Your booking confirmation - QPXRTZ STN-AGP 10 May", "Thu, 05 Mar 2026 09:30:00 +0000",
    "Hi Sam, booking confirmed.\nBooking code: QPXRTZ\n\nFlight London Stansted to Malaga\nDeparture 10/05/2026 STN 07:15 AGP 11:05\n\nPrice breakdown\nFlight London Stansted to Malaga €40.10\nFees €29.90\nTotal €70.00\n");
  const again = mk("Skyhop <no-reply@comms.skyhop.example>", "Your booking confirmation QPXRTZ - STN-AGP 10 may", "Sat, 09 May 2026 17:00:00 +0000",
    "Hi Sam, booking confirmed.\nBooking code: QPXRTZ\nCheck in now and get your boarding passes.\n\nFlight London Stansted to Malaga\nDeparture 10/05/2026 STN 07:15 AGP 11:05\n\nPayment details\nPayment 1\n04/03/2026\nType of payment\nVisa\nTotal €70.00\n");
  const a = stored(booking, 1000), b = stored(again, 500);
  const [card, ...more] = mergeOrderEmails([b, a]);
  assert.equal(more.length, 0, "one card");
  assert.equal(card.id, a.id, "the booking's own email leads, not the copy sent the day before the flight");
  assert.equal(card.orderDate, "2026-03-05", "the booking's day, never the copy's or the payment line's");
  assert.equal(card.totalPence, 7000);
  assert.deepEqual(card.items.map((i) => [i.name, i.pricePence]), [["Flight London Stansted to Malaga", 4010], ["Fees", 2990]], "the booking's own lines, the fees apart");
  console.log("ok - a confirmation sent again later never leads the booking's card or gives its day");
}
// 3. Ticket fees are the lines the email sets out, and stay in the list shown.
{
  for (const id of ["holdout16c-tickets-order-details-text", "holdout20-tickets-fees-in-brackets"]) {
    const r = read(id);
    assert.deepEqual(listed(r.items).map((i) => [i.name, i.qty, i.pricePence]), r.items.map((i) => [i.name, i.qty, i.pricePence]), id + ": every line kept when listed");
    assert.equal(r.items.reduce((s, i) => s + i.pricePence * i.qty, 0), r.totalPence);
  }
  assert.ok(read("holdout16c-tickets-order-details-text").items.some((i) => i.name === "Delivery/transaction costs"));
  assert.ok(read("holdout20-tickets-fees-in-brackets").items.some((i) => i.name === "Service Charge Full Price Ticket"));
  // (A line named only by money words that no ticket list set out is still left out.)
  assert.equal(listed([{ name: "Service charge", qty: 1, pricePence: 200 }]).length, 0);
  console.log("ok - a ticket seller's fees are kept as the lines the email sets out");
}
// 4. A payment service's receipt with each label and its value on lines of their own; the older row layout still reads.
{
  const r = read("holdout20-payment-service-stacked-labels");
  assert.deepEqual(r.items.map((i) => [i.name, i.qty, i.pricePence]), [["6 Month Digital Subscription (Ireland)", 1, 4500]]);
  assert.ok(r.itemsCheck.complete);
  assert.deepEqual(read("holdout16d-paypal-older-receipt").items.map((i) => i.name), ["3 Month Print Subscription (United Kingdom)"]);
  console.log("ok - a payment service's labels and values on lines of their own make its item");
}
// 5. A parking app's receipt: the parking, named by where it was.
{
  const r = read("holdout16e-parking-hidden-sender-cost");
  assert.deepEqual(r.items.map((i) => [i.name, i.pricePence]), [["Parking at Market Street", 140]]);
  assert.equal(r.totalPence, 140);
  console.log("ok - a parking receipt's parking is its item");
}
// 6. A web shop's money off under each thing: the thing at its price, the money off a line of its own.
{
  const r = read("holdout20-shop-line-discount");
  assert.deepEqual(r.items.map((i) => [i.name, i.pricePence, i.variant || ""]), [["Linen Cushion Cover Set", 4000, "Oat / Large"], ["Stoneware Mug", 1200, ""]]);
  assert.deepEqual(r.discounts, [{ label: "WINTER25", pence: 1300 }]);
  assert.equal(4000 + 1200 + 395 - 1300, r.totalPence);
  console.log("ok - money off set out under a thing is a line of its own, the thing at its price");
}
// 7. A booking with no total at all: what was booked is what it cost.
{
  const r = read("holdout16c-booking-at-price-no-total");
  assert.equal(r.totalPence, 16000);
  assert.ok(r.itemsCheck.complete);
  // (Not when the email gives any amount paid or due.)
  const due = parseReceiptEmail(mk("Studio <mail@bookings.example>", "Booking confirmation. Ref: KQWZT", "Sat, 14 Nov 2026 09:00:00 +0000",
    "Your booking reference is: KQWZT\n\nBooking details:\n\nADULT CLASS - Throw a pot\n    4 x Throw a pot @ £40.00\nDeposit paid: £40.00\n"));
  assert.notEqual(due.totalPence, 16000);
  console.log("ok - a booking that gives no total is what was booked");
}
// 8. A delivery day above the item is never its name.
{
  const r = read("holdout20-delivery-day-above-item");
  assert.deepEqual(r.items.map((i) => [i.name, i.pricePence]), [["SMART DOORBELL CAMERA 3RD GEN BLACK", 8999]]);
  assert.ok(r.itemsCheck.namesOk);
  console.log("ok - a delivery day is never an item's name");
}
// 9. An older ride receipt: the fare's parts come to its subtotal, the wait time is a fee.
{
  const ride = (cur, rows, total) => parseReceiptEmail(mk("Uber Receipts <noreply@uber.com>", "Your Monday morning trip with Uber", "Mon, 28 Sep 2026 08:30:00 +0000",
    `<html><body><table>${["Total", total, "28 September 2026", "Thanks for riding, Sam", "We hope you enjoyed your ride this morning.", "Total", total, ...rows, "Payments", "Visa ••••1234", total]
      .map((c) => `<tr><td>${c}</td></tr>`).join("")}</table></body></html>`, true));
  const r = ride("€", ["Base fare", "€2.50", "Time", "€6.00", "Distance", "€20.10", "Subtotal", "€28.60", "Wait Time", "€0.40"], "€29.00");
  assert.deepEqual([r.items.map((i) => [i.name, i.pricePence]), r.fees, r.totalPence, r.currency], [[["Uber ride", 2860]], [{ label: "Wait Time", pence: 40 }], 2900, "EUR"]);
  // (Parts that don't come to the subtotal: the ride stays one line for what was paid.)
  const odd = ride("£", ["Base fare", "£2.50", "Time", "£6.00", "Distance", "£9.10", "Subtotal", "£18.60", "Wait Time", "£0.40"], "£19.00");
  assert.deepEqual([odd.items.map((i) => i.pricePence), odd.fees || []], [[1900], []]);
  console.log("ok - an older ride receipt's wait time is a fee of its own");
}
// 10. The new patterns take time in proportion to a line's length (a 40,000-character line).
{
  const long = (s) => s.repeat(Math.ceil(40000 / s.length)).slice(0, 40000);
  for (const s of ["We're working on ", "Sunday 10 ", "(-£1.00)\n", "4 x a @ ", "Quantity\n", "Base fare\n£1.00\n", "Start Parking: ", "on its way "]) {
    const t = Date.now();
    parseReceiptEmail(mk("Shop <orders@shop.example>", long(s), "Wed, 11 Nov 2026 10:00:00 +0000", "Order number: 1234567\n" + long(s) + "\nTotal: £5.00\n"));
    parseReceiptEmail(mk("Uber <noreply@uber.com>", "Your trip with Uber", "Wed, 11 Nov 2026 10:00:00 +0000", "Thanks for riding\nTotal\n£5.00\nBase fare\n£1.00\n" + long(s) + "\nSubtotal\n£5.00\n"));
    assert.ok(Date.now() - t < 3000, JSON.stringify(s) + " took " + (Date.now() - t) + " ms");
  }
  console.log("ok - the new patterns stay quick on a 40,000-character line");
}
console.log("All round 19 checks passed.");
