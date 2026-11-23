// A twenty-eighth set of made-up emails (see lib.mjs), round 24 (23 Nov 2026): layouts in a real inbox (2023 and September to
// November 2026) that Relay read wrongly after round 23, written again with everything in them made up (shops, hotels,
// airlines, flights, items, prices, people, numbers). PayPal, Booking.com, Amazon, Appcharge and Shopify keep their names and
// addresses: the reader goes by their layouts.
//  - PayPal's "You've authorised a payment to Harbour Hardware Ltd" (the seller, what was bought, "This purchase will appear
//    as a pending transaction until …"), the shop's own email for the same order, and PayPal's refund of what was finally taken;
//  - Booking.com's "Lisbon flight confirmation" ("1 passenger · £189.40", "Customer reference" over "40-111222333"), and each
//    airline's own confirmation of one of its flights, in euros;
//  - Booking.com's "Your payment will be handled by Quayside Lodge", "You will be charged a prepayment of the total price at
//    any time";
//  - Amazon's order paid partly with a gift card, "Gift Card (£6.25)", "Visa (£40.75)";
//  - a shop's "It's on its way" with the whole order and its total, and no confirmation;
//  - a receipt that is only its PDF, and the shopper's own forward of it;
//  - Appcharge's "Purchase Confirmation #123-456-789" with its own long Order ID; an electricals shop's "We're working on your
//    order" the evening before its receipt; Shopify's "Invoice #2004" for an order the shop edited.
// scripts/test-receipt-real-61.mjs reads these.
import { order, expected, fixture, h, SHOPPER } from "./lib.mjs";

const cells = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("\n")}</table>`;
const htmlPage = (title, lines, foot = "") => `<html><head><title>${h(title)}</title></head><body>${cells(lines)}${foot}</body></html>`;
// (Lines in blocks of their own, no table cells: how some shops' builders lay a whole email out.)
const paras = (title, lines) => `<html><head><title>${h(title)}</title></head><body>${lines.map((l) => `<div>${h(l)}</div>`).join("\n")}</body></html>`;
const pp = (lines) => htmlPage("PayPal", lines, "<p>Copyright © 1999-2026 PayPal. All rights reserved.</p>");

// ---- PayPal's authorisation for a shop that may send nothing of its own, the shop's own email, and PayPal's refund ----------
export const AUTHORISED = {
  paypal: { from: '"service@paypal.co.uk" <service@paypal.co.uk>', subject: "You've authorised a payment to Harbour Hardware Ltd", date: "Wed, 04 Mar 2026 09:12:40 +0000",
    html: pp([`${SHOPPER.name}, thanks for using PayPal.`, `Hi ${SHOPPER.name},`, "You authorised a payment of £64.20 GBP to Harbour Hardware Ltd (orders@harbourhardware.example)",
      "View or Manage Transaction", "This purchase will appear as a pending transaction until Harbour Hardware Ltd processes your order. To see the full transaction details, log in to your PayPal account.",
      "Transaction ID", "4AB12345CD678901E", "Transaction date", "4 March 2026 09:12:31 GMT", "Seller", "Harbour Hardware Ltd", "orders@harbourhardware.example",
      "Invoice ID", "7700112233", "Description | Unit price | Qty | Amount", "Harbour Hardware Online Order | £64.20 GBP | 1 | £64.20 GBP", "Subtotal", "£64.20 GBP", "Total", "£64.20 GBP",
      "The amount shown above may not be the final payment amount. If the seller completes the transaction and the final amount is greater than the above, we'll send you an additional receipt that shows the final payment amount. Otherwise, this will be your final receipt.",
      "Funding sources used (total)", "Visa-0000", "£64.20 GBP"]) },
  shop: { from: "Harbour Hardware <orders@harbourhardware.example>", subject: "Thank you for your order 7700112233", date: "Wed, 04 Mar 2026 09:14:02 +0000",
    html: htmlPage("Harbour Hardware", ["Thank you for your order", "Order number: 7700112233", "Cordless Drill 18V | Qty 1 | £64.20", "Subtotal | £64.20", "Delivery | £0.00", "Order total | £64.20"]) },
  refund: { from: '"service@paypal.co.uk" <service@paypal.co.uk>', subject: "Your refund from Harbour Hardware Ltd is on the way", date: "Thu, 02 Apr 2026 08:00:00 +0000",
    text: ["£62.00 GBP will be refunded by 2 April 2026. Track it now.", `${SHOPPER.name}, welcome to PayPal.`, "Your refund of £62.00 GBP from Harbour Hardware Ltd",
      "Your refund is on the way! Available in your card by 2 April 2026.", "Refund to", "VISA ••0000", "£62.00 GBP", "Summary",
      "You originally paid Harbour Hardware Ltd £62.00 GBP on 4 March 2026. View receipt", "Refund total", "£62.00 GBP", "Refund from", "Harbour Hardware Ltd"].join("\n") },
};

// ---- Booking.com's flights and each airline's own email for one of them --------------------------------------------------------
export const AGENT_FLIGHTS = {
  agent: { from: '"Booking.com" <noreply@booking.com>', subject: "Lisbon flight confirmation", date: "Tue, 03 Mar 2026 20:15:00 +0100",
    html: htmlPage("Lisbon flight confirmation", ["Lisbon flight confirmation", `${SHOPPER.first}, you're flying to Lisbon`, `Hi ${SHOPPER.first},`,
      "It’s all confirmed, thanks for booking! You’ll get your check-in details in a separate email from us.", "Your flight details",
      "London Luton Apt → Lisbon Apt", "12 Jun · 06:40 - 12 Jun · 09:25", "Direct · 2h 45m", "Lisbon Apt → London Luton Apt", "16 Jun · 18:10 - 16 Jun · 20:55", "Direct · 2h 45m",
      "1 passenger · £189.40", "View and manage booking", "Looking for help?", "Visit the Flights help centre, and please have your customer reference and PIN code handy",
      "Customer reference", "40-111222333", "PIN code", "1234", "Have a good flight!"]) },
  out: { from: '"Ryanair" <itinerary@ryanair.com>', subject: "Ryanair Travel Itinerary", date: "Tue, 03 Mar 2026 19:20:00 +0000",
    text: ["Your booking is confirmed", "Reservation number: QX7TRP", "", "Flight details", "LTN → LIS Fri 12 Jun 2026 FR1881", "Departs 06:40 London Luton", "Arrives 09:25 Lisbon", "",
      "Passengers: 1 Adult", "Total paid: EUR 118.30"].join("\n") },
  back: { from: '"easyJet" <donotreply@easyjet.com>', subject: "Your easyJet booking EJY7QW2", date: "Wed, 04 Mar 2026 07:05:00 +0000",
    text: ["Thanks for booking with easyJet", "Booking reference: EJY7QW2", "", "Flight 1", "Lisbon to London Luton", "EZY2304", "Tue 16 Jun", "Dep 18:10 Arr 20:55", "", "Total €101.90"].join("\n") },
};

// ---- Booking.com: the hotel handles the payment ------------------------------------------------------------------------------
export const HOTEL_TAKES_PAYMENT = { from: "Booking.com <noreply@booking.com>", subject: "Your booking in Porto is confirmed", date: "Sat, 02 May 2026 10:00:00 +0000",
  html: htmlPage("Booking.com", ["Booking number: 5500112233", "PIN: 0000", "(Confidential)", `Thanks ${SHOPPER.first}!`, "Your booking in Porto is confirmed.", "Quayside Lodge is expecting you on 10 July",
    "Your payment will be handled by Quayside Lodge. The ' Payment ' section below has more details", "Your reservation | 3 nights, 1 room", "You booked for | 2 adults",
    "Prepayment", "You will be charged a prepayment of the total price at any time.", "Total price | €480.00"]) };

// ---- Amazon, paid partly with a gift card ---------------------------------------------------------------------------------------
const AMZ_FOOT = "Fulfilled By Amazon (usually referred to as FBA) items are generally sold by third-party sellers but stored in an Amazon Fulfilment Centre and sent to you from there.";
export const AMAZON_GIFT_CARD = { from: '"Amazon.co.uk" <auto-confirm@amazon.co.uk>', subject: 'Your Amazon.co.uk order of "Ashdown Ceramic Teapot, 1.2 Litre" and 1 more item', date: "Sun, 10 May 2026 18:40:00 +0100",
  html: htmlPage("Amazon.co.uk", ["Amazon.co.uk", "Order Confirmation", "Order #", "204-1112223-3344455", "Hello,", "Thanks for your order.", "Arriving:", "Thursday, May 14",
    "Your order will be sent to:", "Sam", "LEEDS", "United Kingdom", "Order Total:", "£40.75", "Selected Payment Method(s):", "Gift Card (£6.25)", "Visa (£40.75)",
    "Ashdown Ceramic Teapot, 1.2 Litre", "Sold by: Amazon EU S.a.r.L.", "£22.00", "Fernhill Loose Leaf Breakfast Tea, 250g", "Sold by: Fernhill Tea Co", "£25.00", AMZ_FOOT]) };

// ---- A shop's dispatch email with the whole order, and no confirmation ----------------------------------------------------------
export const DISPATCH_WHOLE = { from: "Lumen Lane <mail@lumenlane.example>", subject: "It's on its way", date: "Fri, 13 Feb 2026 16:30:00 +0000",
  html: paras("Lumen Lane", ["NEW IN | WOMENS | MENS | SALE", `Hey ${SHOPPER.name}`, "Great news. Your parcel's on its way", "Order Number:", "LL55501234", "It's coming to...", "12 Example Road",
    "You've selected...", "Standard Delivery", "Wanna track it?", "TRACK ORDER", "It's in the bag...", "Ribbed Knit Beanie", "LLB0042-001-10", "Qty: 1", "Size:", "One Size", "Colour:", "Sage",
    "Status:", "Dispatched", "£14.00", "Subtotal: £14.00", "Delivery: £3.99", "Order Total :", "£17.99", "Payment Method: Card", "Returns are easy!", "Return via Portal"]) };
export const ORDER_OF_DISPATCH = { from: "Lumen Lane <mail@lumenlane.example>", subject: "Thanks for your order", date: "Thu, 12 Feb 2026 10:00:00 +0000",
  html: htmlPage("Lumen Lane", ["Thanks for your order", "Order Number: LL55501234", "Ribbed Knit Beanie | Qty: 1 | £14.00", "Subtotal: | £14.00", "Delivery: | £3.99", "Order Total: | £17.99"]) };

// ---- A receipt that is only its PDF -----------------------------------------------------------------------------------------------
export const PDF_ONLY = { from: '"Northbridge Institute (Do Not Reply)" <noreply@northbridge-institute.example>', subject: "Receipt for your payment to Northbridge Institute", date: "Wed, 10 May 2023 14:05:00 +0000",
  html: htmlPage("Northbridge Institute", [`${SHOPPER.name}:`, "Thank you for your payment. Your detailed receipt is attached.", "Sincerely,", "Northbridge Institute", "Contact Us | Manage Account"]) };

// ---- Appcharge with its own long Order ID; an electricals shop's two emails; Shopify's invoice for an edited order -----------
export const GAME_RECEIPT_NUMBER = { from: "no-reply <no-reply@appcharge.com>", subject: "Purchase Confirmation #123-456-789", date: "Fri, 02 Oct 2026 16:20:00 +0000",
  text: ["Purchase Confirmation", "TILE QUEST-BRIGHTPLAY", "| Receipt Number | 123-456-789 |", "| Payment Method | Apple |", "| Payment Date | October 2, 2026 4:20 PM UTC |",
    "| Country | United Kingdom |", "| Order ID | 0a1b2c3d4e5f60718293a4b5 |", "Items", "| Coins | 900 |", "| Subtotal | £3.99 |", "| Tax (20%) | £0.80 |", "| Total | £4.79 |", "Powered by Appcharge"].join("\n") };
export const ELECTRICALS = {
  working: { from: "Brightwire <no-reply@brightwire.example>", subject: "We’re working on your tech order", date: "Mon, 21 Sep 2026 19:10:00 +0000",
    html: htmlPage("Brightwire", ["Your tech's almost ready.", "Order number: BW2600011122", `Hi ${SHOPPER.first},`, "We've got your order, and it's being processed. We'll send you another email when it's ready to collect.",
      "Ordered item(s):", "1 x", "Vantage 40\" Smart Full HD LED TV", "Product code: 10000001", "£249.00", "Payment breakdown", "Payment method - Credit Card", "£249.00", "Delivery cost", "Free", "VAT (included)", "£41.50", "Total", "£249.00"]) },
  receipt: { from: "Brightwire <no_reply@brightwire.example>", subject: "Thanks for your order! Here’s your receipt.", date: "Tue, 22 Sep 2026 08:30:00 +0000",
    html: htmlPage("Brightwire", ["Thanks for shopping with us.", "Order number:", "BW2600011122", `Hi ${SHOPPER.first},`, "We're processing your items for collection, and they'll be ready to collect shortly.",
      "Ordered item(s):", "1x", "Vantage 40\" Smart Full HD LED TV", "Product code 350000", "£249.00", "Payment breakdown", "Paid today: card ending in 0000", "£249.00", "Delivery cost", "Free", "VAT (included)", "£41.50", "Total", "£249.00"]) },
};
export const SHOPIFY_EDIT = {
  order: { from: "Fieldstep <store+11112222333@g.shopifyemail.com>", subject: "Order #2004 confirmed", date: "Sat, 07 Nov 2026 10:15:00 +0000",
    html: htmlPage("Fieldstep", ["Thank you for your order!", "Fieldstep", "Order #2004", "Thank you for your order!", "We're getting your order ready to be shipped.", "Order summary",
      "Trail Runner Shoes × 1", "UK 8", "£100.00", "Subtotal", "£100.00", "Shipping", "£0.00", "Total", "£100.00 GBP"]) },
  invoice: { from: "Fieldstep <store+11112222333@g.shopifyemail.com>", subject: "Invoice #2004", date: "Sat, 07 Nov 2026 11:40:00 +0000",
    html: htmlPage("Fieldstep", ["Fieldstep", "Invoice #2004", "Payment of £20.00 is due", "Pay now", "Order summary", "Trail Runner Shoes × 0", "UK 8", "Removed 1 of 1", "£0.00",
      "Trail Runner Shoes × 1", "UK 7", "Added 1", "£120.00", "Subtotal", "£120.00", "Shipping", "£0.00", "Estimated taxes", "£0.00", "Updated total", "£120.00", "Already paid", "£100.00",
      "Amount to pay", "£20.00 GBP"]) },
};

export default function holdout25() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  add("holdout25-booking-flights", "Booking.com", "'<city> flight confirmation': 'London Luton Apt → Lisbon Apt' over '12 Jun · 06:40 - 12 Jun · 09:25', no flight numbers; '1 passenger · £189.40'; 'Customer reference' over '40-111222333'",
    AGENT_FLIGHTS.agent, order([{ name: "Return flights London Luton to Lisbon", qty: 1, unit: 18940 }]), "Booking.com", "2026-03-03", { orderRef: "40-111222333" });
  return out;
}
