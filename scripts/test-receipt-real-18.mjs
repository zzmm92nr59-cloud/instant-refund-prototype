// Round 18 (20 Nov 2026): a re-read of a real inbox against its answer keys left flights read as "Adult" or not at all, an
// airline's fees inside the fare, free gifts left out, a store receipt's money off left out, a model-number name dropped
// from the list, an invoice's unlabelled order number, a tax line read as the item, and a subscription's cancellation never
// fetched. Each is tested here on MADE-UP emails in the same layouts (shops, people, codes and amounts are all made up; see
// scripts/fixtures/receipt-emails/holdout19.mjs for the full emails).
//   node scripts/test-receipt-real-18.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { cleanItems } from "../worker/receipt-reader.js";
import { classifyEmail, attachCancellations } from "../worker/gmail.js";
import { flightBooking } from "../worker/flight-booking.js";
import { rawEmail } from "./fixtures/receipt-emails/lib.mjs";
import holdout19, { TRAINER } from "./fixtures/receipt-emails/holdout19.mjs";

const fx = Object.fromEntries(holdout19().map((f) => [f.id, f]));
const read = (id) => parseReceiptEmail(rawEmail(fx[id]));
const listed = (r) => cleanItems(JSON.parse(JSON.stringify(r.items)), { stored: true });
const mk = (from, subject, body, { html = false, date = "Wed, 11 Nov 2026 10:00:00 +0000" } = {}) =>
  `From: ${from}\r\nTo: sam@example.com\r\nSubject: ${subject}\r\nDate: ${date}\r\nMIME-Version: 1.0\r\nContent-Type: text/${html ? "html" : "plain"}; charset=utf-8\r\n\r\n${body}`;

// 1. Flights are the item: the reservation code and the amount paid on lines below their labels; each flight's day.
{
  const r = read("holdout19-airline-itinerary-labels-above");
  assert.equal(r.orderRef, "K7QXPD");
  assert.deepEqual(r.items.map((i) => [i.name, i.pricePence]), [["Return flights London Stansted to Krakow", 12450]]);
  assert.deepEqual(r.flights.map((g) => [g.from, g.to, g.date, g.leg]), [["STN", "KRK", "2026-12-03", "out"], ["KRK", "STN", "2026-12-07", "back"]]);
  assert.ok(r.itemsCheck.complete);
  // (A card's last four digits between the label and the amount are never the amount.)
  const b = flightBooking({ subject: "Skylark Travel Itinerary", senderDomain: "skylark-air.example", text: "Reservation:\nK7QXPD\nTo Krakow LS1234\n(STN) -\n(KRK)\nTotal paid via\nVisa\nending in\n1234\n" });
  assert.ok(!b || !b.paid, "no amount when none is given: " + JSON.stringify(b && b.paid));
  console.log("ok - an airline itinerary's flights are its item, with the code and amount from the lines below their labels");
}
// 2. Airports on lines of their own with their times; the subject's summary "LHR-WDH" is not a flight; "GBP 1450.20" whole.
{
  const r = read("holdout19-airline-airports-own-lines");
  assert.deepEqual(r.flights.map((g) => [g.from, g.to, g.flight, g.date, g.leg]), [
    ["LHR", "FRA", "LH1901", "2027-03-06", "out"], ["FRA", "WDH", "LH1902", "2027-03-06", "out"], ["WDH", "FRA", "LH1903", "2027-03-20", "back"], ["FRA", "LHR", "LH1904", "2027-03-21", "back"]]);
  assert.deepEqual(r.items.map((i) => [i.name, i.pricePence]), [["Return flights London Heathrow to Windhoek", 145020]]);
  assert.ok(!r.items.some((i) => /^adult$/i.test(i.name)));
  console.log("ok - airports on lines of their own make the flights; the trip's summary in the subject is not one; amounts over £999 read whole");
}
// 3. A fare, a seat and a fees line: the fees are fees.
{
  const r = read("holdout19-airline-fare-and-fees");
  assert.deepEqual([r.items[0].name, r.items[0].pricePence, r.currency, r.totalPence], ["Flight London Gatwick to Barcelona", 4010, "EUR", 7000]);
  assert.deepEqual(r.fees, [{ label: "Fees", pence: 2990 }]);
  console.log("ok - an airline's fees line is a fee, the flight what is left");
}
// 4. Free partner gifts listed with their worth: listed free, kept when the list is shown, never flagged as odd names.
{
  const r = read("holdout19-free-partner-gifts");
  assert.deepEqual(r.items.map((i) => [i.name, i.pricePence, Boolean(i.free)]), [["Whey Isolate - 1kg - Vanilla", 2499, false], ["Oat Bar - 12 x 60g - Toffee", 1450, false],
    ["10% off sitewide at Kettle!", 0, true], ["Free MealKit box", 0, true]]);
  assert.deepEqual(listed(r).map((i) => i.name), r.items.map((i) => i.name));
  assert.ok(r.itemsCheck.complete && r.itemsCheck.namesOk);
  assert.ok(!(r.discounts || []).some((d) => /gift/i.test(d.label)), "the gifts' offer is not money off what was bought");
  // (An offer line that was never a gift of the order is still no item.)
  assert.equal(cleanItems([{ name: "10% off sitewide at Kettle!", qty: 1, pricePence: 150 }], { stored: true }).length, 0);
  console.log("ok - free gifts the email lists with their worth are listed at £0.00 and stay listed");
}
// 5. A store receipt with no items: its money off is kept when it is exactly what takes the subtotal to the total.
{
  const r = read("holdout19-store-receipt-promotion-no-items");
  assert.deepEqual(r.discounts, [{ label: "Promotions applied", pence: 100 }]);
  const odd = parseReceiptEmail(mk("Pantry Go <auto-confirm@pantrygo.example>", "Your 6 November receipt for 2 items", "Order # 204-1111111-2222223\nSubtotal £8.00\nPromotions applied - £1.50\nTotal £7.00\n"));
  assert.ok(!odd.discounts, "money off that doesn't add up is not kept: " + JSON.stringify(odd.discounts));
  console.log("ok - a store receipt's promotion is kept, only when the sum adds up");
}
// 6. A trainer named by its model number: its code, size and colour are details, and the list keeps it.
{
  const r = parseReceiptEmail(rawEmail(TRAINER));
  assert.equal(r.totalPence, 6750);
  assert.deepEqual([r.items[0].name, r.items[0].variant], ["574", "ML574EV2, UK 8 - D, Navy with Grey"]);
  assert.deepEqual(listed(r).map((i) => [i.name, i.pricePence]), [["574", 7500]]);
  assert.equal(cleanItems([{ name: "574", qty: 1, pricePence: 7500 }], { stored: true }).length, 0, "a bare number with nothing to say it is a model is still no item");
  console.log("ok - a model number's name keeps its code and size, and the list keeps it");
}
// 7. An invoice's unlabelled order number: beside the order's dates, the only code of its shape; never otherwise.
{
  assert.equal(read("holdout19-invoice-unlabelled-number").orderRef, "CS1234567890");
  const body = (row, more = "") => `<table><tr><td>Invoice receipt</td><td>£49.99</td></tr>${row}<tr><td>Shieldly Total - 1 Device</td><td>£49.99</td></tr>${more}<tr><td>Total Due</td><td>£49.99</td></tr></table>`;
  const sh = (b) => parseReceiptEmail(mk("Shieldly <info@notification.shieldly.example>", "Your Shieldly order confirmation", b, { html: true }));
  assert.equal(sh(body("<tr><td>Thank you</td><td>CS1234567890</td></tr>")).orderRef ?? null, null, "no day beside it");
  assert.equal(sh(body("<tr><td>08 October 2026</td><td>CS1234567890</td></tr>", "<tr><td>Licence</td><td>KX9876543210</td></tr>")).orderRef ?? null, null, "two such codes");
  console.log("ok - an unlabelled order number is read only beside the order's dates and when it is the only one");
}
// 8. A trial set at £0.00 with a tax line named by its rate: the set is the item, the rate line the VAT.
{
  const r = read("holdout19-trial-set-rate-tax");
  assert.deepEqual(r.items.map((i) => [i.name, i.qty, i.pricePence, i.variant]), [["Calm Skin Duo", 1, 0, "Trial Set / Daily"]]);
  assert.deepEqual(r.fees, [{ label: "Shipping", pence: 495 }, { label: "VAT", pence: 99 }]);
  assert.ok(r.itemsCheck.complete);
  console.log("ok - a tax line named by its rate is the VAT; the free trial set is the item");
}
// 9. A subscription that won't renew: Gmail is asked for it, and it joins the subscription's last payment.
{
  const src = readFileSync(new URL("../worker/gmail.js", import.meta.url), "utf8");
  const terms = /const SEARCH_TERMS =([\s\S]*?);\n/.exec(src)[1];
  for (const w of ["subscription", "cancelled", "canceled"]) assert.ok(new RegExp("\\bOR " + w + "\\b").test(terms), "Gmail is asked for " + w);
  const can = classifyEmail(mk("Google Play <googleplay-noreply@google.com>", "Your Notepad Pro: Write and sketch subscription will be cancelled",
    "Your Notepad Pro: Write and sketch subscription from Example Apps Ltd on Google Play will be cancelled on 13 Dec 2026. No refunds will be issued ( Refund Policy ).\nOrder number: GPA.3300-0000-1111-22222\nOrder date: 14-Dec-2025 13:17:58 GMT\n")).details;
  assert.equal(can.kind, "order_update");
  assert.equal(can.endsOn, "2026-12-13");
  const pay = { id: "p1", kind: "receipt", retailer: { name: "Google Play", domain: "google.com" }, orderRef: "GPA.3300-0000-1111-22222..10", orderDate: "2026-11-10", totalPence: 599, items: [{ name: "Notepad Pro: Write and sketch", qty: 1, pricePence: 599 }] };
  attachCancellations([pay], [can]);
  assert.deepEqual(pay.subscriptionEnds, { on: "2026-12-13", at: can.at, refund: false });
  console.log("ok - subscription cancellations are asked for, and say when the subscription ends");
}
// 10. Every new reading stays quick on a 40,000-character line.
{
  const long = (s) => s.repeat(Math.ceil(40000 / s.length)).slice(0, 40000);
  for (const s of ["Total paid via\n", "(LHR)\n", "15:30 h ", "Reservation:\n", "Fees 1", "Standard Rate\n", "| CS1234567890 |", "×\n1\n", "Quantity\n1\nPrice\n", "Subtotal £1.00\nPromotions applied - £", "AB1"]) {
    const t = Date.now();
    parseReceiptEmail(mk("Skylark <itinerary@skylark-air.example>", "Your order receipt", "Order number: 123456\nLS1234\n" + long(s) + "\nTotal £5.00\n"));
    parseReceiptEmail(mk("Skylark <itinerary@skylark-air.example>", "Your order receipt", "<table><tr><td>" + long(s).replace(/\n/g, "</td></tr><tr><td>") + "</td></tr></table>", { html: true }));
    assert.ok(Date.now() - t < 3000, JSON.stringify(s) + " took " + (Date.now() - t) + " ms");
  }
  console.log("ok - the new readings stay quick on very long lines");
}
