// Round 24 (23 Nov 2026), reader version 61: a blind check of a real inbox (2023, and September to November 2026) after
// round 23. Every email here is MADE UP (scripts/fixtures/receipt-emails/holdout25.mjs): shops, hotels, airlines, flights,
// items, prices, people and numbers.
//  1. PayPal's "You authorised a payment of £64.20 GBP to Harbour Hardware Ltd" with no email from the shop is that purchase,
//     from the shop; PayPal's later refund of what was finally taken joins it; with the shop's own email, one card.
//  2. A travel site's flight booking is the purchase; each airline's own email for one of its flights is part of it, never
//     more money spent in euros.
//  3. Booking.com's "Your payment will be handled by <hotel>" is paid at the hotel.
//  4. An Amazon order paid partly with a gift card: the whole order is the total, with the gift card's part and the card's
//     part as the email gives them.
//  5. A dispatch email with the whole order and its total is the purchase when the order's own email isn't there; never a
//     second card when it is.
//  6. The shopper's own forward of a receipt joins it; a receipt only in its PDF says so.
//  7. Appcharge's receipt number is the reference; an order's day is the day of its first email about it; Shopify's
//     "Invoice #N" for an edited order changes that order.
//  8. The new patterns take linear time on a 40,000-character line and a line of 40,000 spaces.
//   node scripts/test-receipt-real-61.mjs
import assert from "node:assert/strict";
import { classifyEmail, mergeOrderEmails, attachReturnProgress, ordersFromDispatch, attachEdits, PARSER_VERSION } from "../worker/gmail.js";
import { flightLegs } from "../worker/flight-booking.js";
import { rawEmail, fixture, forwarded } from "./fixtures/receipt-emails/lib.mjs";
import { AUTHORISED, AGENT_FLIGHTS, HOTEL_TAKES_PAYMENT, AMAZON_GIFT_CARD, DISPATCH_WHOLE, ORDER_OF_DISPATCH, PDF_ONLY, GAME_RECEIPT_NUMBER, ELECTRICALS, SHOPIFY_EDIT } from "./fixtures/receipt-emails/holdout25.mjs";

const raw = (m, id = "x", attach) => rawEmail({ ...fixture(id, "", "", m, {}), ...(attach ? { attach } : {}) });
let n = 0;
const read = (m, id, attach) => ({ ...classifyEmail(raw(m, id, attach), { gmailId: id }).details, id, createdAt: ++n });
assert.equal(PARSER_VERSION, 61);

// 1. PayPal's authorisation.
{
  const p = read(AUTHORISED.paypal, "pp1");
  assert.equal(p.kind, "receipt", "PayPal's authorisation for a shop is the purchase: " + p.kind);
  assert.equal(p.retailer.name, "Harbour Hardware Ltd");
  assert.equal(p.totalPence, 6420);
  assert.equal(p.authorised, true);
  const r = read(AUTHORISED.refund, "pp2");
  assert.equal(r.kind, "return_update");
  const cards = mergeOrderEmails([structuredClone(p)]);
  attachReturnProgress(cards, [], [r]);
  assert.equal(cards[0].returnProgress && cards[0].returnProgress.refundPence, 6200, "the refund of what was finally taken joins it: " + JSON.stringify(cards[0].returnProgress));
  // (With the shop's own email: one purchase, the shop's.)
  const s = read(AUTHORISED.shop, "pp3");
  for (const order of [[p, s], [s, p]]) {
    const both = mergeOrderEmails(order.map((x) => structuredClone(x)));
    assert.equal(both.length, 1, "one purchase, one card");
    assert.equal(both[0].retailer.name, "Harbour Hardware");
    assert.equal(both[0].totalPence, 6420);
  }
  // (A refund of more than was authorised, or for another shop, is never put on it.)
  const other = mergeOrderEmails([structuredClone(p)]);
  attachReturnProgress(other, [], [{ ...r, paidPence: 7000, amountPence: 7000 }, { ...r, retailer: { name: "Quayside Tools Ltd", domain: null, via: "paypal.co.uk" } }]);
  assert.equal(other[0].returnProgress, undefined, JSON.stringify(other[0].returnProgress));
  // (PayPal's short "You've authorised £12.40 GBP to …", a hold, stays no purchase.)
  const hold = read({ from: '"service@paypal.co.uk" <service@paypal.co.uk>', subject: "You've authorised a payment to Sunward Breaks Lim...", date: "Tue, 14 Oct 2026 20:43:00 +0000",
    text: "Hello, Sam Taylor\nYou've authorised £40.00 GBP to Sunward Breaks Lim...\nMerchant\nSunward Breaks Lim...\nTransaction date\n14 Oct 2026\nOrder ID\n2610GBPAB12CD\n" }, "pp4");
  assert.equal(hold.kind, "order_update");
  console.log("ok - PayPal's 'You authorised a payment of …' is the purchase from the shop; its refund joins it; the shop's own email makes one card");
}

// 2. A travel site's flights and the airlines' own emails.
{
  const a = read(AGENT_FLIGHTS.agent, "f1"), o = read(AGENT_FLIGHTS.out, "f2"), b = read(AGENT_FLIGHTS.back, "f3");
  assert.equal(a.kind, "receipt", "Booking.com's flight confirmation is the purchase");
  assert.equal(a.totalPence, 18940); assert.equal(a.currency, "GBP"); assert.equal(a.orderRef, "40-111222333");
  assert.deepEqual(a.flights.map((g) => [g.from, g.to, g.date].join(" ")), ["LTN LIS 2026-06-12", "LIS LTN 2026-06-16"]);
  assert.equal(o.kind, "receipt"); assert.equal(o.currency, "EUR");
  assert.equal(b.kind, "receipt");
  for (const list of [[a, o, b], [b, o, a], [o, a, b]]) {
    const cards = mergeOrderEmails(list.map((x) => structuredClone(x)));
    assert.equal(cards.length, 1, "the airlines' emails are part of the travel site's booking: " + cards.map((c) => c.retailer.name + " " + c.totalPence + " " + c.currency).join(", "));
    assert.equal(cards[0].retailer.name, "Booking.com"); assert.equal(cards[0].totalPence, 18940); assert.equal(cards[0].currency, "GBP");
    assert.deepEqual(cards[0].emailIds.slice().sort(), ["f1", "f2", "f3"]);
    assert.deepEqual(cards[0].flownBy.map((x) => x.orderRef).sort(), ["EJY7QW2", "QX7TRP"]);
  }
  // (Another trip with the same airline, other days: its own purchase.)
  const elsewhere = read({ ...AGENT_FLIGHTS.out, text: AGENT_FLIGHTS.out.text.replace("Fri 12 Jun 2026", "Fri 19 Jun 2026") }, "f4");
  assert.equal(mergeOrderEmails([structuredClone(a), elsewhere]).length, 2);
  // (Booked months apart: its own.)
  const later = { ...structuredClone(o), id: "f5", orderDate: "2026-05-20" };
  assert.equal(mergeOrderEmails([structuredClone(a), later]).length, 2);
  console.log("ok - a travel site's flight booking is the purchase, and each airline's own email of its flights joins it");
}

// 3. The hotel handles the payment.
{
  const d = read(HOTEL_TAKES_PAYMENT, "h1");
  assert.equal(d.kind, "receipt");
  assert.equal(d.payAtProperty, true, "'Your payment will be handled by Quayside Lodge'");
  const paid = read({ ...HOTEL_TAKES_PAYMENT, html: HOTEL_TAKES_PAYMENT.html.replace("You will be charged a prepayment of the total price at any time.", "You've paid in full.") }, "h2");
  assert.notEqual(paid.payAtProperty, true, "paid stays paid");
  const bc = read({ ...HOTEL_TAKES_PAYMENT, html: HOTEL_TAKES_PAYMENT.html.replace("handled by Quayside Lodge", "handled by Booking.com") }, "h3");
  assert.notEqual(bc.payAtProperty, true, "Booking.com taking the money is no stay paid at the hotel");
  console.log("ok - 'Your payment will be handled by <hotel>' is paid at the hotel");
}

// 4. Amazon and a gift card.
{
  const d = read(AMAZON_GIFT_CARD, "a1");
  assert.equal(d.totalPence, 4700, "the whole order");
  assert.equal(d.giftCardPence, 625);
  assert.deepEqual(d.cardPaid, { label: "Visa", pence: 4075 }, "the card's part, as the email gives it");
  const none = read({ ...AMAZON_GIFT_CARD, html: AMAZON_GIFT_CARD.html.replace("<tr><td>Gift Card (&pound;6.25)</td></tr>", "").replace(/&pound;40\.75/g, "&pound;47.00") }, "a2");
  assert.equal(none.totalPence, 4700); assert.equal(none.giftCardPence, undefined); assert.equal(none.cardPaid, undefined, "no gift card, no parts");
  console.log("ok - an Amazon order paid partly by gift card: the whole order, the gift card's part and the card's");
}

// 5. A dispatch email with the whole order.
{
  const d = read(DISPATCH_WHOLE, "d1");
  assert.equal(d.kind, "delivery_update");
  assert.ok(d.orderCopy, "the order it sets out is kept");
  const made = ordersFromDispatch([d], []);
  assert.equal(made.length, 1, "the purchase, from its dispatch email");
  const cards = mergeOrderEmails(made);
  assert.equal(cards[0].orderRef, "LL55501234"); assert.equal(cards[0].totalPence, 1799);
  assert.deepEqual(cards[0].items.map((i) => [i.name, i.pricePence]), [["Ribbed Knit Beanie", 1400]]);
  const c = read(ORDER_OF_DISPATCH, "d2");
  assert.equal(c.kind, "receipt");
  assert.equal(ordersFromDispatch([d], [c]).length, 0, "never a second card beside the order's own email");
  assert.equal(ordersFromDispatch([d, { ...structuredClone(d), id: "d3" }], []).length, 1, "the same dispatch sent twice: one");
  console.log("ok - a dispatch email with the whole order is the purchase only when the order's own email isn't there");
}

// 6. The shopper's own forward; a receipt only in its PDF.
{
  const pdf = [{ type: "application/pdf", name: "Sales Order 000111.pdf" }];
  const o = read(PDF_ONLY, "c1", pdf);
  assert.equal(o.kind, "receipt"); assert.equal(o.detailsInAttachment, "pdf"); assert.equal(o.totalPence, null);
  const fw = forwarded(fixture("c2", "", "", PDF_ONLY, {}), "gmail");
  const f = { ...classifyEmail(rawEmail({ ...fw, attach: pdf }), { gmailId: "c2" }).details, id: "c2", createdAt: ++n };
  assert.equal(f.kind, "receipt");
  assert.equal(f.forwardedCopy, true);
  for (const list of [[o, f], [f, o]]) {
    const cards = mergeOrderEmails(list.map((x) => structuredClone(x)));
    assert.equal(cards.length, 1, "the forward joins the receipt");
    assert.deepEqual(cards[0].emailIds.slice().sort(), ["c1", "c2"]);
  }
  // (A forward of another receipt of the shop, another day: its own.)
  assert.equal(mergeOrderEmails([structuredClone(o), { ...structuredClone(f), orderDate: "2023-06-01" }]).length, 2);
  console.log("ok - the shopper's own forward of a receipt joins it");
}

// 7. Appcharge's receipt number; an order's first day; Shopify's edited order.
{
  const g = read(GAME_RECEIPT_NUMBER, "g1");
  assert.equal(g.orderRef, "123-456-789", "the receipt number, never the shop's internal Order ID");
  const w = read(ELECTRICALS.working, "e1"), r = read(ELECTRICALS.receipt, "e2");
  const cards = mergeOrderEmails([w, r]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].orderDate, "2026-09-21", "the day of the first email about the order");
  const o = read(SHOPIFY_EDIT.order, "s1"), i = read(SHOPIFY_EDIT.invoice, "s2");
  assert.equal(o.kind, "receipt"); assert.equal(o.totalPence, 10000);
  assert.equal(i.kind, "order_update", "the invoice is never a second purchase"); assert.equal(i.stage, "edited");
  assert.equal(i.newTotalPence, 12000); assert.equal(i.previousTotalPence, 10000); assert.equal(i.amountDuePence, 2000);
  const c = mergeOrderEmails([structuredClone(o)]);
  attachEdits(c, [i]);
  assert.equal(c[0].orderRef, "2004"); assert.equal(c[0].totalPence, 12000, "its updated total");
  assert.deepEqual(c[0].items.map((x) => [x.name, x.variant, x.pricePence]), [["Trail Runner Shoes", "UK 7", 12000]]);
  assert.equal(c[0].amended.changes, 1); assert.equal(c[0].amended.amountDuePence, 2000);
  // (Another shop's order #2004, or an order whose total wasn't what had been paid: unchanged.)
  const other = [{ ...structuredClone(o), retailer: { name: "Lakeside Boots", domain: null, via: "g.shopifyemail.com" } }, { ...structuredClone(o), id: "s3", totalPence: 4000 }];
  attachEdits(other, [i]);
  assert.deepEqual(other.map((x) => x.totalPence), [10000, 4000]);
  console.log("ok - Appcharge's receipt number; the order's first day; Shopify's 'Invoice #N' changes the order");
}

// 8. Linear time.
{
  const long = "a".repeat(40000), spaces = " ".repeat(40000);
  for (const body of [long, spaces, "London Luton Apt → " + long, "1 passenger · £" + spaces, "Customer reference" + "\n".repeat(20000) + spaces, "You authorised a payment of £1.00 GBP to " + spaces,
    "Your payment will be handled by " + spaces, "Selected Payment Method(s):\nGift Card (£1.00)\nVisa " + spaces + "(£1.00)", "Updated total " + spaces + " Already paid", "Receipt Number " + spaces + "|"]) {
    for (const m of [{ from: "Shop <a@shop.example>", subject: "Your order", date: "Mon, 01 Jun 2026 10:00:00 +0000", text: body },
      { from: "Booking.com <noreply@booking.com>", subject: "Lisbon flight confirmation", date: "Mon, 01 Jun 2026 10:00:00 +0000", text: body },
      { from: '"service@paypal.co.uk" <service@paypal.co.uk>', subject: "You've authorised a payment to X", date: "Mon, 01 Jun 2026 10:00:00 +0000", text: "This purchase will appear as a pending transaction until X\n" + body },
      { from: '"Amazon.co.uk" <auto-confirm@amazon.co.uk>', subject: "Your Amazon.co.uk order", date: "Mon, 01 Jun 2026 10:00:00 +0000", text: "Order #204-1112223-3344455\n" + body },
      { from: "no-reply <no-reply@appcharge.com>", subject: "Purchase Confirmation #1", date: "Mon, 01 Jun 2026 10:00:00 +0000", text: body },
      { from: "X <store+1@g.shopifyemail.com>", subject: "Invoice #1001", date: "Mon, 01 Jun 2026 10:00:00 +0000", text: body }]) {
      const t0 = Date.now();
      classifyEmail(raw(m));
      assert.ok(Date.now() - t0 < 3000, "took " + (Date.now() - t0) + "ms");
    }
  }
  const t1 = Date.now();
  flightLegs("London Luton Apt → Lisbon Apt\n" + spaces + "\n" + long, new Date("2026-01-01")); flightLegs(("X Apt → Y Apt\n|\n").repeat(4000), new Date("2026-01-01"));
  assert.ok(Date.now() - t1 < 2000, "took " + (Date.now() - t1) + "ms");
  console.log("ok - the new patterns take linear time on long lines");
}
console.log("all round 24 reader checks passed");
