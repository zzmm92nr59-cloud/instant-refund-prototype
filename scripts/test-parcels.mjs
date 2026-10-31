// Parcels and multi-email orders, using emails shaped like Lululemon UK's and Royal Mail's real ones (made-up person and order details).
import assert from "node:assert/strict";
import { parseReceiptEmail, parseDeliveryEmail, parseReturnEmail, trackingLink } from "../worker/receipt-parser.js";
import { mergeOrderEmails, attachDeliveries } from "../worker/gmail.js";
// Builds test emails shaped like Lululemon UK's and Royal Mail's real ones (made-up person details).
const toHtml = (lines) => "<html><body><table>" + lines.map(l => l === "|" ? "<tr><td></td></tr>" : `<tr><td><div>${l.replace(/£/g, "&pound;")}</div></td></tr>`).join("\n") + "</table></body></html>";
function mime({ from, subject, date, plain, htmlLines }) {
  return [
    `From: ${from}`, `Subject: ${subject}`, `Date: ${date}`, "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="b1"', "", "--b1",
    'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: 8bit", "", plain, "--b1",
    'Content-Type: text/html; charset="utf-8"', "Content-Transfer-Encoding: 8bit", "", toHtml(htmlLines), "--b1--", ""
  ].join("\r\n");
}
const LULU = '"lululemon" <hello-emea@e.lululemon.com>';
const item = (p) => ["lululemon Align™ High-Rise Lettuce-Hem Flared Pant", "1 x 074052 / Size US 4 (UK 8)", "158848120", p + "69.00"];
const luluOrder = mime({
  from: LULU, subject: "Thanks for your lululemon order #UK05000001", date: "Fri, 30 Oct 2026 05:48:16 -0600",
  plain: ["https://example.com/x", " Thanks for your Order, Alex!", " We are currently processing your order. Once it ships, we'll email you the tracking information so you can follow along.",
    " Items Purchased", ...item(" L"), " Subtotal (1 item)", " L57.50", " Shipping", " Free", " VAT", " L11.50", " Order Total", " L69.00", " Payment Method",
    "American Express ***0000", " L69.00", " Order Id: #UK05000001", " Shipping Address", " Alex Test", " 1 Test Street", " Greater London", " UK E1 6AN",
    " Order Total", " L69.00", " Order Date", " October 30, 2026", " Returns & Exchanges", " Return information will be provided on your shipping confirmation email once your items are on the way."].join("\r\n \n"),
  htmlLines: ["Thanks for your Order, Alex!", "Items Purchased", "|", ...item("£"), "|", "Subtotal (1 item)", "£57.50", "Shipping", "Free", "VAT", "£11.50", "Order Total", "£69.00",
    "Payment Method", "American Express ***0000", "£69.00", "Order Id: #UK05000001", "Shipping Address", "Alex Test", "1 Test Street", "Order Total", "£69.00", "Order Date", "October 30, 2026",
    "Returns & Exchanges", "Return information will be provided on your shipping confirmation email once your items are on the way."]
});
const returnsBlock = ["Returns are free and easy!", "By Post: Let us know which item(s) you’re returning by creating a return request .",
  "In-Store: Bring your item(s) to your nearest store (excluding concessions and outlets) with the barcode below ready to be scanned by our team. All refunds will be processed to the original method of payment. Paypal and Klarna returns cannot be accepted in store. Please retain this email in case you wish to returns your item(s).",
  "Learn more about our returns."];
const luluShipped = mime({
  from: LULU, subject: "We're shipping your lululemon order # UK05000001", date: "Fri, 30 Oct 2026 12:03:46 -0600",
  plain: [" Good things are coming your way, Alex.", " Good news! We've packaged up your order and sent it on its way.", " Tracking#: JK000000001GB", "https://example.com/x", "TRACK PACKAGE",
    " Shipping Now", ...item(" L"), " Order Id: #UK05000001", " Shipping Address", " Alex Test", " Order Date", " October 30, 2026", " Shipping", " Free Standard Shipping", ...returnsBlock].join("\r\n \n"),
  htmlLines: ["Good things are coming your way, Alex.", "Good news! We've packaged up your order and sent it on its way.", "|", "Tracking#: JK000000001GB", "TRACK PACKAGE", "|", "Shipping Now", "|",
    ...item("£"), "|", "Order Id: #UK05000001", "Shipping Address", "Alex Test", "Order Date", "October 30, 2026", "|", "Shipping", "Free Standard Shipping", "|", ...returnsBlock]
});
const luluDelivered = mime({
  from: LULU, subject: "Your lululemon order has been delivered", date: "Sat, 31 Oct 2026 05:20:00 -0600",
  plain: "Your lululemon order has been delivered. Time to get active! We hope you enjoy your purchase.\r\nOrder Id: #UK05000001",
  htmlLines: ["Your lululemon order has been delivered.", "Time to get active! We hope you enjoy your purchase.", "Order Id: #UK05000001"]
});
const RM = "Royal Mail <no-reply@royalmail.com>";
const rmDue = mime({
  from: RM, subject: "Your parcel from Lululemon EMEA is due to be delivered today", date: "Sat, 31 Oct 2026 07:01:00 +0000",
  plain: "Hi Alex Test\r\n\r\nYour parcel from Lululemon EMEA is due to be delivered:\r\nToday, Saturday, 31 October 2026\r\n\r\nWant to track your parcel?\r\nJK000000001GB\r\nTrack Parcel",
  htmlLines: ["Hi Alex Test", "Your parcel from Lululemon EMEA is due to be delivered:", "Today, Saturday, 31 October 2026", "Want to", "track your parcel?", "____", "JK000000001GB", "Track Parcel"]
});
const rmDelivered = mime({
  from: RM, subject: "Your parcel from Lululemon EMEA has been delivered. How did we do?", date: "Sat, 31 Oct 2026 11:07:00 +0000",
  plain: "Hi Alex Test\r\n\r\nWe delivered your parcel from Lululemon EMEA today, Saturday, 31 October 2026.\r\n\r\nHow did we do? Tell us about your delivery experience.\r\n\r\nWant to track your parcel?\r\nJK000000001GB\r\nTrack Parcel",
  htmlLines: ["Hi Alex Test", "We delivered your parcel from Lululemon EMEA today, Saturday, 31 October 2026.", "How did we do? Tell us about your delivery experience.", "Keep tabs on your parcel", "with the Royal Mail App", "____",
    "Want to", "track your parcel?", "____", "JK000000001GB", "Track Parcel", "This is an automated message, please don't reply.", "Royal Mail | Parcelforce | Privacy Policy | Terms of Use"]
});

// 1. Each email is read as the right kind.
const asCard = (raw, id, createdAt) => {
  const d = parseDeliveryEmail(raw);
  if (d.ok) return { id, createdAt, ...d };
  assert.equal(parseReturnEmail(raw).ok, false);
  const r = parseReceiptEmail(raw);
  assert.equal(r.ok, true, "order email read");
  return { id, createdAt, kind: "receipt", status: "pending", retailer: r.retailer, orderRef: r.orderRef, orderDate: r.orderDate, currency: r.currency,
    totalPence: r.totalPence, items: r.items, returns: r.returns, shipment: r.shipment };
};
const order = asCard(luluOrder, "a", 1), shipped = asCard(luluShipped, "b", 2), shopDelivered = asCard(luluDelivered, "c", 3);
const rmD = asCard(rmDue, "d", 4), rmDone = asCard(rmDelivered, "e", 5);
assert.equal(order.totalPence, 6900);
assert.deepEqual(order.items, [{ name: "lululemon Align™ High-Rise Lettuce-Hem Flared Pant", qty: 1, pricePence: 6900, lineTotal: true, variant: "Size US 4 (UK 8)" }]);
assert.equal(shipped.items[0].pricePence, 6900, "price read even though the plain-text part writes £ as L");
assert.equal(shipped.items[0].name, "lululemon Align™ High-Rise Lettuce-Hem Flared Pant", "'Shipping Now' heading not glued to the name");
assert.deepEqual(shipped.shipment, { trackingNumber: "JK000000001GB", carrier: "Royal Mail", status: "shipped" });
assert.equal(shopDelivered.kind, "delivery_update"); assert.equal(shopDelivered.status, "delivered"); assert.equal(shopDelivered.orderRef, "UK05000001");
assert.equal(rmD.status, "due", "'due to be delivered today' is not 'delivered'");
assert.equal(rmDone.status, "delivered"); assert.equal(rmDone.at, "2026-10-31"); assert.equal(rmDone.carrier, "Royal Mail");
assert.equal(rmDone.trackingNumber, "JK000000001GB"); assert.equal(rmDone.merchant, "Lululemon EMEA");
console.log("ok - each email is read as the right kind, with price, size and tracking number");

// 2. The confirmation and the shipping email become one card; the parcel updates join it.
const cards = mergeOrderEmails([shipped, order]);
assert.equal(cards.length, 1);
assert.equal(cards[0].id, "a", "the complete email leads");
assert.equal(cards[0].totalPence, 6900);
assert.equal(cards[0].shipment.trackingNumber, "JK000000001GB");
assert.ok(cards[0].returns.instructions.length, "returns wording from the shipping email kept");
attachDeliveries(cards, [rmD, rmDone, shopDelivered]);
assert.deepEqual(cards[0].delivery, { status: "delivered", at: "2026-10-31", carrier: "Royal Mail", trackingNumber: "JK000000001GB",
  trackUrl: "https://www.royalmail.com/track-your-item#/tracking-results/JK000000001GB" });
assert.deepEqual(cards[0].returnBy, { date: "2026-11-14", basis: "uk_law" });
console.log("ok - one card per order, delivered by Royal Mail on 31 Oct, return by at least 14 Nov");

// 3. Before delivery the card shows the furthest step reached, and no return date yet.
const early = mergeOrderEmails([asCard(luluOrder, "a", 1), asCard(luluShipped, "b", 2)]);
attachDeliveries(early, [asCard(rmDue, "d", 4)]);
assert.equal(early[0].delivery.status, "due"); assert.equal(early[0].returnBy, undefined);
console.log("ok - 'due today' shown before delivery, no return date until it arrives");

// 4. A carrier email with no tracking number joins the newest order from that shop only; other shops are untouched.
const other = { id: "z", createdAt: 1, kind: "receipt", retailer: { name: "Nike", domain: "nike.com" }, orderRef: "N1", orderDate: "2026-10-29", items: [] };
const luluOld = { id: "y", createdAt: 1, kind: "receipt", retailer: { name: "lululemon", domain: "e.lululemon.com" }, orderRef: "UK1", orderDate: "2026-10-01", items: [] };
const luluNew = { id: "x", createdAt: 1, kind: "receipt", retailer: { name: "lululemon", domain: "e.lululemon.com" }, orderRef: "UK2", orderDate: "2026-10-29", items: [] };
attachDeliveries([other, luluOld, luluNew], [{ kind: "delivery_update", status: "delivered", at: "2026-10-31", carrier: "Royal Mail", merchant: "Lululemon EMEA", trackingNumber: null }]);
assert.equal(other.delivery, undefined); assert.equal(luluOld.delivery, undefined); assert.equal(luluNew.delivery.status, "delivered");
console.log("ok - a parcel without a tracking number goes to the newest matching order only");

// 5. Tracking links only for known carriers and well-formed numbers.
assert.equal(trackingLink("Royal Mail", "JK000000001GB"), "https://www.royalmail.com/track-your-item#/tracking-results/JK000000001GB");
assert.equal(trackingLink("Royal Mail", "bad number!"), null); assert.equal(trackingLink(null, "JK000000001GB"), null);
console.log("ok - tracking links");
