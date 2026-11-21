// A twenty-fifth set of made-up emails (see lib.mjs), round 21b (21 Nov 2026): layouts in a real inbox (January to June 2025)
// that Relay read wrongly after round 21, written again with everything in them made up (shops, events, hotels, items, prices,
// people, numbers). Amazon and PayPal keep their names and addresses: the reader goes by their layouts.
//  - Amazon's "Ordered:" email printing "Total £0.00" for priced items (no gift card, no promotion named), and its "Dispatched:"
//    email stating the order's total;
//  - an Amazon book whose author is written surname first under its title, over "Sold by:" and "Qty: 1";
//  - an event's receipt with each line's name and price on rows of their own (an entry, a booking fee, a discount, "Total
//    £0.00") and its "Payment Reference";
//  - a hotel's cancellation that names the stay by its "Itinerary #";
//  - a fashion shop's order email opening "We've got your order" under a subject that says nothing ("It’s in the bag"), each
//    thing over its code, "Qty: 1", "Size:", "Colour:", "Status:" and its price, and its dispatch email;
//  - PayPal's "You've submitted an order" with its Transaction ID, and PayPal's receipt for coins with the tax under them;
//  - a supermarket's text part, wrapped at a fixed width, giving "within 14 days starting from the day after the date of
//    delivery" after "(e.g. if your goods are not wanted)" and a 30 day goodwill returns policy.
// scripts/test-receipt-real-22.mjs reads these and joins them to their orders.
import { order, expected, fixture, h, SHOPPER } from "./lib.mjs";

const cells = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("\n")}</table>`;
const htmlPage = (title, lines, foot = "") => `<html><head><title>${h(title)}</title></head><body>${cells(lines)}${foot}</body></html>`;
const AMZ = '"Amazon.co.uk" <auto-confirm@amazon.co.uk>';

// ---- Amazon, 2025: "Ordered: 2 items", the items priced, "Total" over "£0.00"; then "Dispatched: 2 items", "Total £15.98" ----
const vit = ["Brightleaf Magnesium Glycinate Capsules - 120 Vegan Capsules - High Strength - Made in the UK", "Brightleaf Omega 3 Fish Oil 1000mg - 180 Softgels - Lemon Flavour"];
const amzLines = (head, total) => [head, "Your Orders", `Thanks for your order, ${SHOPPER.first}!`, "Arriving tomorrow", `${SHOPPER.first} – Leeds`, "Order # 204-1112223-3334445", "View or edit order",
  vit[0].slice(0, 33) + "...", "Sold by Brightleaf Health", "Condition: New", "Quantity: 1", "£", "7", "49", "£ 7 49",
  vit[1].slice(0, 33) + "...", "Sold by Brightleaf Health", "Condition: New", "Quantity: 1", "£", "8", "49", "£ 8 49", "Total", total,
  "Amazon.co.uk is a trading name for Amazon EU Sarl, for Amazon Europe Core Sarl and for Amazon Media EU Sarl."];
const amzText = (total) => [`Thanks for your order, ${SHOPPER.first}!`, "Order #", "204-1112223-3334445", "View or edit order", "", `* ${vit[0]}`, "  Quantity: 1", "  7.49 GBP", "", `* ${vit[1]}`, "  Quantity: 1", "  8.49 GBP", "", "Total", total].join("\n");
// (The product pictures carry the whole titles as their alt text, as Amazon's do.)
const amzAlts = vit.map((n) => `<p><img src="https://m.media-amazon.com/images/I/item.jpg" alt="${h(n)}" width="64" height="64"></p>`).join("");
export const AMAZON = {
  ordered: { from: AMZ, subject: "Ordered: 2 items", date: "Tue, 11 Mar 2025 09:12:00 +0000", html: htmlPage("Amazon.co.uk", amzLines("Ordered: 2 items", "£0.00"), amzAlts), text: amzText("0 GBP") },
  dispatched: { from: '"Amazon.co.uk" <shipment-tracking@amazon.co.uk>', subject: "Dispatched: 2 items", date: "Wed, 12 Mar 2025 16:40:00 +0000",
    html: htmlPage("Amazon.co.uk", amzLines("Dispatched: 2 items", "£15.98"), amzAlts), text: amzText("15.98 GBP") },
};

// ---- A hotel booked through a travel site, to be paid at the property, and its cancellation naming it by "Itinerary #" -------
export const STAY = {
  booking: { kind: "receipt", id: "stay", retailer: { name: "Expedia", domain: "expedia.co.uk" }, orderRef: "73001122334455", orderDate: "2025-01-21", currency: "USD", totalPence: 149900,
    payAtProperty: true, items: [{ name: "The Larkspur Hotel", qty: 1, pricePence: 149900 }] },
  cancellation: { from: '"Expedia.co.uk" <expedia@eg.expedia.com>', subject: "Expedia Hotel Cancellation Confirmation - The Larkspur Hotel, Fri, 8 Aug - Tue, 12 Aug (Itinerary # 73001122334455)",
    date: "Tue, 17 Jun 2025 10:00:00 +0000", html: htmlPage("Expedia", ["Your Expedia hotel cancellation is confirmed", `Hello ${SHOPPER.name}, your reservation was cancelled`, "Itinerary # 73001122334455",
      "Your reservation with The Larkspur Hotel at 12 Example Street, Boston, MA, 02100 United States of America from Fri, 8 Aug to Tue, 12 Aug was cancelled.", "View cancelled reservation", "Refund summary",
      "Based on your cancellation policy, your refund will be issued to the payment method you used at checkout.", "Where to find help", "Itinerary # 73001122334455"]) },
};

// ---- A fashion shop: its order email and its dispatch email, each thing over its code and options ----------------------------
const threads = [["Relaxed Linen Shirt In Sand", "QXA10021-101-34", "L", "Sand", "£18.00", "£9.00"], ["Cropped Cargo Trouser", "QXA10022-102-34", "M", "Olive", "£20.00", "£14.50"], ["Ribbed Tank Top", "QXA10023-103-34", "S", "Black", "£8.00", "£6.00"]];
const threadLines = (top, status) => [...top, "Order Number:\nUK2200113344", "Order Date:\n10/03/2025", "It's coming to...", SHOPPER.address, "You've selected...", "UK Next Day Delivery", "It’s in the bag...",
  ...threads.flatMap(([n, code, size, col, was, now]) => [n, code, "Qty: 1", "Size:\n" + size, "Colour:\n" + col, "Status:\n" + status, now]),
  "Subtotal: £29.50", "Delivery: £0.00", "Total Vat: £4.92", "Discounts Included:", "ONSITE_SPRING_25OFF(- £9.50)", "Order Total :", "£29.50", "Payment Method: PayPal"];
export const THREADLY = {
  order: { from: "Threadly <mail@threadly.example>", subject: "It’s in the bag", date: "Mon, 10 Mar 2025 18:00:00 +0000",
    html: htmlPage("Threadly", threadLines([`Hey ${SHOPPER.name}`, "We've got your order", "Want the deets?"], "In Progress")) },
  dispatched: { from: "Threadly <mail@threadly.example>", subject: "It's on its way", date: "Tue, 11 Mar 2025 08:30:00 +0000",
    html: htmlPage("Threadly", threadLines([`Hey ${SHOPPER.name}`, "Great news. Your parcel's on its way"], "Dispatched")) },
  // PayPal's receipt for the same purchase, sent a minute before the shop's own email, naming no order.
  paypal: { from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to Threadly.com", date: "Mon, 10 Mar 2025 17:59:10 +0000",
    html: htmlPage("PayPal", ["Receipt for your payment to Threadly.com", `${SHOPPER.name}, you've successfully sent a payment.`, "You paid £29.50 GBP to Threadly.com", "Transaction ID", "1AB23456CD7890123", "Transaction date", "10 March 2025 17:59:08 GMT", "Merchant", "Threadly.com", "help@threadly.example",
      ...threads.flatMap(([n, , , , , now]) => [n, "Qty: 1", now]), "Subtotal | £29.50", "Total | £29.50 GBP", "Paid with", "Visa Credit Card"]) },
};

export default function holdout22() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  const not = (id, sender, layout, m, kind, extra = {}) => { const f = fixture(id, sender, layout, m, { notPurchase: { kind, ...extra } }); out.push(f); return f; };

  // ---- Not purchases --------------------------------------------------------------------------------------------------------
  not("holdout22-amazon-dispatched-total", "Amazon", "'Dispatched: 2 items': the order's items and 'Total £15.98' (the order's news, never a second purchase)", AMAZON.dispatched, "dispatch");
  not("holdout22-hotel-cancelled-itinerary", "Expedia", "'Expedia Hotel Cancellation Confirmation … (Itinerary # …)', 'your reservation was cancelled'", STAY.cancellation, "cancellation");
  not("holdout22-shop-dispatched", "Threadly", "'It's on its way' with the order's items under 'Order Number:'", THREADLY.dispatched, "dispatch");

  // ---- Purchases ---------------------------------------------------------------------------------------------------------------
  // Amazon's "Total £0.00" for priced items: what was paid is not known from this email, so no total is made up for it.
  add("holdout22-amazon-ordered-total-zero", "Amazon", "'Ordered:' layout whose 'Total' says £0.00 though both items are priced, with no gift card or promotion named",
    AMAZON.ordered, order([{ name: vit[0], qty: 1, unit: 749 }, { name: vit[1], qty: 1, unit: 849 }]), "Amazon", "2025-03-11", { totalPence: null });
  {
    const title = "Plain Speaking: Revised and Updated Edition: How to Say What You Mean and Mean What You Say";
    const o = order([{ name: title + " of Lane, Robin", qty: 1, unit: 640 }]);
    add("holdout22-amazon-book-surname-first", "Amazon", "a book's title cut short over its author written surname first ('Lane, Robin'), then 'Sold by: Amazon EU S.a.r.L.', 'Qty: 1', its price",
      { from: AMZ, subject: 'Your Amazon.co.uk order of "Plain Speaking: Revised..."', date: "Sat, 18 Jan 2025 12:00:00 +0000",
        html: htmlPage('Your Amazon.co.uk order of "Plain Speaking: Revised..."', ["Your Orders", "Amazon.co.uk", "Order Confirmation", "Hello,", "Thanks for your order. We’ll let you know once your item(s) have dispatched.",
          "Your order will be sent to:", SHOPPER.first, "Leeds", "United Kingdom", "Order #", "204-5556667-7778889", "View order details", title, "Lane, Robin", "Sold by: Amazon EU S.a.r.L.", "Qty: 1", "£6.40",
          "Order Total:", "£6.40", "Selected Payment Method:", "Mastercard"]),
        text: ["Amazon.co.uk Order Confirmation", "Order #204-5556667-7778889", "Ordered item(s):" + title + " of Lane, Robin £6.40", "Sold by: Amazon EU S.a.r.L.", "Order Total: £6.40"].join("\n") },
      o, "Amazon", "2025-01-18", { orderRef: "204-5556667-7778889" });
  }
  {
    const o = order([{ name: "Riverside 10K 2025 — 1x Riverside 10K Charity Entry - Charity", qty: 1, unit: 4500 }], { fees: [["Riverside 10K 2025 — 1x Booking Fee", 325]], discounts: [["Riverside 10K 2025 — 1x Reserved Entry Discount", 4825]] });
    add("holdout22-event-rows-of-their-own", "RaceHub", "an event's receipt, each line's name and price on rows of their own: the entry, 'Booking Fee', a '-£48.25' discount, 'Total £0.00', 'Payment Reference' over its code",
      { from: "RaceHub <noreply@info.racehub.example>", subject: "Your RaceHub receipt", date: "Thu, 20 Mar 2025 14:05:00 +0000",
        html: htmlPage("RaceHub", ["Your receipt", "Each participant in your booking will receive a confirmation email containing important information about their event.",
          "Riverside 10K 2025 — 1x Riverside 10K Charity Entry - Charity", "£45.00", "Riverside 10K 2025 — 1x Booking Fee", "£3.25", "Riverside 10K 2025 — 1x Reserved Entry Discount", "-£48.25", "Total", "£0.00",
          "Payment Reference", "5f1a2b3c4d5e6f7a8b9c0d1e", "Got a question about your payment?"]) },
      o, "RaceHub", "2025-03-20", { orderRef: "5f1a2b3c4d5e6f7a8b9c0d1e", fees: [["Riverside 10K 2025 — 1x Booking Fee", 325]] });
  }
  add("holdout22-shop-got-your-order", "Threadly", "'It’s in the bag' (a subject that says nothing): 'We've got your order', 'Order Number:', each thing over its code, 'Qty: 1', 'Size:', 'Colour:', 'Status:' and its price",
    THREADLY.order, order(threads.map(([n, , , , , now]) => ({ name: n, qty: 1, unit: Math.round(Number(now.slice(1)) * 100) }))), "Threadly", "2025-03-10", { orderRef: "UK2200113344" });
  return out;
}

// ---- PayPal: "You've submitted an order" (charged when the shop processes it), and coins with the tax under them -------------
export const PAYPAL = {
  submitted: { from: "PayPal <service@paypal.co.uk>", subject: "You've submitted an order", date: "Sat, 22 Feb 2025 19:42:00 +0000",
    html: htmlPage("PayPal", ["PayPal", `Hello ${SHOPPER.first},`, "You placed a £32.00 GBP order with Cellarway Wines Limited (help@cellarway.example)", "View or Manage Transaction",
      "You won't be charged until Cellarway Wines Limited processes your order.", "Your money will be transferred when the seller processes your payment.", "Transaction ID", "O-1AB23456CD7890123",
      "Transaction date", "22 February 2025 19:42:00 GMT", "Total | £32.00 GBP"]) },
  coins: { from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to Appcharge ltd", date: "Thu, 22 May 2025 21:15:00 +0000",
    html: htmlPage("PayPal", ["PayPal", `Hello ${SHOPPER.first},`, "You paid £4.99 GBP to Appcharge ltd", "Transaction ID", "9ZY87654XW3210987", "Transaction date", "22 May 2025 21:15:00 BST",
      "Coins_7", "Qty: 1", "Product ID: Coins_7", "£4.16", "Subtotal | £4.16", "Tax | £0.83", "Total | £4.99 GBP", "Paid Appcharge ltd with", "Visa Credit Card"]) },
};

// ---- A supermarket's text part, wrapped at a fixed width: its return rules ----------------------------------------------------
export const GROCER_RETURNS = ["Thank you for shopping with us.", "Your order number is 1100223344", "Estimated total: £42.10", "",
  "The Consumer Contracts (Information, Cancellation and", "Additional Charges) Regulations 2013 gives you the right to return most",
  "goods purchased online without giving a reason (e.g. if your goods are", "not wanted) within 14 days starting from the day after the date of",
  "delivery. It is not possible to return frozen or perishable food and", "drink unless the item(s) are faulty or of poor quality.", "",
  "Greenleaf offers a 30 day goodwill returns policy and", "goods which are not returned at", "the time of delivery should be returned in a new saleable condition at",
  "your expense with your receipt or other proof of purchase to any", "Greenleaf store within 30 days."].join("\n");
