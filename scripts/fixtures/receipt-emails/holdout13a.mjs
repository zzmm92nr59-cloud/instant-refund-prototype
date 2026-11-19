// A fourteenth set of made-up emails (see lib.mjs), round 12 (19 Nov 2026): the layouts of receipts and order news in
// Connor's own inbox that Relay read wrong, written again with everything in them made up (shops, items, prices, people,
// addresses, order numbers). Sainsbury's keeps its name (the reader goes by its wording); every other shop is invented.
import { order, expected, fixture, gbp, page, h, SHOPPER } from "./lib.mjs";

const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${l.split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });

// A Sainsbury's order (confirmation, two changes, the delivery-day email with a substitution), shared with the join checks.
export const GROCER = {
  ref: "1388004127",
  first: [["Sainsbury's Wholemeal Pittas x6", 1, 65], ["Sainsbury's Free Range Eggs x12", 1, 340], ["Sainsbury's Smoked Back Bacon 300g", 1, 275], ["Sainsbury's 150g Buffalo Mozzarella, Taste the Difference", 1, 250]],
  // The first change takes the bacon off and adds lemons; the second adds two tins of tomatoes.
  second: [["Sainsbury's Wholemeal Pittas x6", 1, 65], ["Sainsbury's Free Range Eggs x12", 1, 340], ["Sainsbury's 150g Buffalo Mozzarella, Taste the Difference", 1, 250], ["Sainsbury's Unwaxed Lemons x4", 1, 120]],
  third: [["Sainsbury's Wholemeal Pittas x6", 1, 65], ["Sainsbury's Free Range Eggs x12", 1, 340], ["Sainsbury's 150g Buffalo Mozzarella, Taste the Difference", 1, 250], ["Sainsbury's Unwaxed Lemons x4", 1, 120], ["Sainsbury's Chopped Tomatoes 400g", 2, 110]],
};

export default function holdout13a() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };

  // ---- A darts shop on Shopify: "Name × 1", then the flights' weight on a line of its own ("25"), then the price ------------
  {
    const o = order([{ name: "Arrowline Pro Board Bundle", qty: 1, unit: 8995 }, { name: "Kestrel Steel Flights 3", qty: 1, unit: 1850 }]);
    add("holdout13a-shopify-weight-line", "Bullseye Supplies", "'Kestrel Steel Flights 3 × 1' over a bare '25' (the weight in grams), then the price", { from: "Bullseye Supplies <store@bullseye-supplies.example>", subject: "Order #1000482219 confirmed",
      date: "Tue, 28 Jul 2026 10:00:00 +0000",
      html: mail("Bullseye Supplies", "bullseye-supplies.example", ["Thank you for your purchase!", "Order #1000482219", "Order summary", "Arrowline Pro Board Bundle × 1", "£89.95", "Kestrel Steel Flights 3 × 1", "25", "£18.50",
        "Subtotal", "£108.45", "Shipping", "£0.00", "Taxes", "£18.08", "Total", "£108.45 GBP"]) }, o, "Bullseye Supplies", "2026-07-28");
  }
  // ---- A supermarket: pack sizes in names ("Pittas x6") over a quantity column --------------------------------------------------
  const list = (items) => items.flatMap(([n, q, p]) => [n, String(q), gbp(p), "Substitution allowed"]);
  const sumOf = (items) => items.reduce((n, [, , p]) => n + p, 0);
  const grocer = (id, layout, subject, date, items, head) => {
    const o = order(items.map(([name, qty, line]) => ({ name, qty, unit: line / qty })), { fees: [["Delivery cost", 100]] });
    const lines = ["Order Confirmation - Sainsbury's", ...head, "Order number", GROCER.ref, "Estimated total", gbp(sumOf(items) + 100) + "*", "Your payment details", "Payment card: VISA ending in 4821", "Address:", SHOPPER.address,
      "Groceries", `(${items.length} items)`, "Items", "Quantity", "Price", ...list(items), "Your order summary", "Trolley cost", gbp(sumOf(items)), "Delivery cost", "£1.00", "Estimated total", gbp(sumOf(items) + 100) + "*"];
    return add(id, "Sainsbury's", layout, { from: "Sainsbury's <service@sainsburys.co.uk>", subject, date, html: mail("Sainsbury's", "sainsburys.co.uk", lines) }, o, "Sainsbury's", new Date(date).toISOString().slice(0, 10), {});
  };
  {
    const c = grocer("holdout13a-grocer-confirmation", "pack sizes in names ('Pittas x6', 'Eggs x12') over a quantity column", "Thanks for your order - " + GROCER.ref, "Wed, 07 Oct 2026 12:00:00 +0000", GROCER.first, ["We've got your order"]);
    const a1 = grocer("holdout13a-grocer-change-1", "'We got your changes': the whole new list", "We got your changes - " + GROCER.ref, "Fri, 09 Oct 2026 16:30:00 +0000", GROCER.second, ["Sam, thanks, we've got your changes! See the details below:", "What you need to know", "You've amended your order", "We've got your changes and your order has been updated."]);
    a1.expected.orderUpdate = "amended"; a1.expected.orderRef = GROCER.ref;
    const a2 = grocer("holdout13a-grocer-change-2", "a second 'We got your changes', sent later", "We got your changes - " + GROCER.ref, "Fri, 09 Oct 2026 17:05:00 +0000", GROCER.third, ["Sam, thanks, we've got your changes! See the details below:", "What you need to know", "You've amended your order", "We've got your changes and your order has been updated."]);
    a2.expected.orderUpdate = "amended"; a2.expected.orderRef = GROCER.ref;
    const none = order([]);
    const day = add("holdout13a-grocer-day-of-substitution", "Sainsbury's", "delivery-day email: payment received, one item 'Substituted with' another at its own price", { from: "Sainsbury's <service@sainsburys.co.uk>", subject: "Receipt for your Sainsbury’s order " + GROCER.ref,
      date: "Sat, 10 Oct 2026 05:00:00 +0000",
      html: mail("Sainsbury's", "sainsburys.co.uk", ["Today 9:00am to 1:00pm", "What you need to know", "Your order is ready for today", "Order number: | " + GROCER.ref, "Payment received: | £9.20", "We've picked your items", "1 substitution, see more details below.",
        "Substitutions (1)", "We’ve tried to pick the best substitute for the unavailable items below.", "Items | Quantity | Price |", "Sainsbury's 150g Buffalo Mozzarella, Taste the Difference | at a quantity of 1 | £2.50 |", "Substituted with", "",
        "Sainsbury's Italian Mozzarella 125g | at a quantity of 1 | £1.85 |", "Our Substitute Promise", "Your e-receipt", "We've attached your e-receipt to this email."]) },
      none, "Sainsbury's", "2026-10-10", { totalPence: 920, attachmentOnly: "pdf", orderUpdate: "paid", orderRef: GROCER.ref });
    day.attach = [{ type: "application/pdf", name: "e-receipt.pdf" }];
  }
  // ---- A marketplace: one email confirming two orders, each with its own number, items and total ---------------------------
  {
    const o = order([{ name: "Noise Cancelling Earbuds", qty: 1, unit: 1999 }, { name: "Whitening Toothpaste 75ml", qty: 2, unit: 125 }]);
    add("holdout13a-two-orders-one-email", "Parcelhaus", "'Order # …' with its items and '| Total |', then a second 'Order # …' with its own", { from: "Parcelhaus <shipment-tracking@parcelhaus.example>", subject: "Ordered: \"Noise Cancelling Earbuds\" and 2 more items",
      date: "Tue, 07 Oct 2026 08:00:00 +0000",
      html: mail("Parcelhaus", "parcelhaus.example", ["Thanks for your order, Sam!", "Arriving tomorrow", "Sam – Leeds", "Order # 301-5510022-4410001", "View or edit order |", "Noise Cancelling Earbuds", "Sold by Parcelhaus", "Quantity: 1", "£19.99",
        "Whitening Toothpaste 75ml", "Sold by Parcelhaus", "Quantity: 2", "£2.50", "| Total | £22.49 |", "Arriving tomorrow", "Sam – Leeds", "Order # 301-5510022-4410002", "View or edit order |", "Eau de Parfum 50ml", "Sold by Parcelhaus", "Quantity: 1", "£31.00",
        "| Total | £31.00 |"]) }, o, "Parcelhaus", "2026-10-07");
  }
  // ---- A walk-out shop's receipt: no item list, only a link to the itemised receipt, the subtotal, a promotion and the total --
  add("holdout13a-shop-visit-no-items", "Grabngo", "'View itemised receipt' link, 'Subtotal', 'Promotions applied - £0.40', 'Total'; no items in the email", { from: "Grabngo <receipts@grabngo.example>", subject: "Your 16 July receipt for 1 item",
    date: "Thu, 16 Jul 2026 17:11:00 +0000", text: ["Hi Sam,", "", "Thank you for shopping with us. Here is the receipt for your recent trip. View itemised receipt:", "  https://www.grabngo.example/store/order/204-5500321-1100220", "", "Thursday, 16 July, 2026",
      "Order # 204-5500321-1100220 (Items: 1)", "Trip time: 2m 10s", "", "Subtotal                                         £4.15", "Promotions applied                        -  £0.40", "Total                                            £3.75"].join("\n") },
    order([]), "Grabngo", "2026-07-16", { totalPence: 375, noItemList: true });
  // ---- A holiday booked with a deposit: the confirmation gives the reference and links to its document (no price) --------------
  add("holdout13a-holiday-booking-no-price", "Sunward Breaks", "'Your booking is confirmed', 'Booking reference: SWB…', the price only in the linked booking document", { from: "Sunward Breaks <noreply@sunwardbreaks.example>", subject: "Your booking is confirmed",
    date: "Tue, 14 Oct 2026 20:44:00 +0000", html: mail("Sunward Breaks", "sunwardbreaks.example", ["Booking reference: SWB55120931K", `Hi ${SHOPPER.first},`, "Your holiday to Faro is confirmed - let the countdown begin!",
      "You can find everything you need to know about your trip in your booking confirmation document.", "Happy travels,", "Sunward Breaks", "View booking confirmation View ATOL certificate", "Sunward Breaks Ltd, 1 Example Street, Leeds"]) },
    order([]), "Sunward Breaks", "2026-10-14", { totalPence: null, currency: null });
  // ---- Money back: a supermarket's refund with its amount on the line under its label; a furniture shop's refund with a
  // full-width pound sign; a payment service's refund naming the shop's invoice; a takeaway app's support reply -----------
  const not = (id, sender, layout, m, notPurchase) => out.push(fixture(id, sender, layout, m, { notPurchase, items: [], shop: null, date: null, currency: null, totalPence: null }));
  not("holdout13a-grocer-refund-label-over-amount", "Sainsbury's", "'Refunded total: |' with the amount on the row under it, the returned item listed", { from: "Sainsbury's <service@sainsburys.co.uk>", subject: "Refund for your Sainsbury’s order " + GROCER.ref,
    date: "Sun, 11 Oct 2026 17:50:00 +0000", html: mail("Sainsbury's", "sainsburys.co.uk", ["Order cancelled - Sainsbury's", "We’ve processed the refund for your returned items", "Your refund will be credited to your original payment card in 3-5 business days",
      "Order number: |", GROCER.ref + " |", "Refunded total: |", "£1.20", "Payment card: VISA ending in 4821", "Returned item", "(1)", "Items", "Quantity", "Price", "Sainsbury's Unwaxed Lemons x4", "1", "£1.20"]) },
    { kind: "refund", refundPence: 120, orderRef: GROCER.ref });
  not("holdout13a-furniture-refund-fullwidth", "Larkspur Living", "'Here comes the refund about your order#…', 'has been successfully refunded', 'Refund Amount: ￡ 89.50'", { from: "\"Larkspur Living\" <service@larkspur-living.example>", subject: "Here comes the refund about your order",
    date: "Sat, 12 Sep 2026 04:46:00 +0000", html: mail("Larkspur Living", "larkspur-living.example", ["Dear customer,", "Hope this mail finds you well.", "Here comes the refund about your", "order#LKL2608141203998877 .",
      "Your payment has been successfully refunded to your original payment account. For details, please contact your bank to check the billing record.", "Refund Amount: ￡ 89.50"]) },
    { kind: "refund", refundPence: 8950, orderRef: "LKL2608141203998877" });
  not("holdout13a-paypal-refund-invoice", "PayPal", "'Cellar Club Ltd. sent you a refund of £30.00 GBP', the shop's 'Invoice ID: CC22001544-P001'", { from: "\"service@paypal.co.uk\" <service@paypal.co.uk>", subject: "Refund from Cellar Club Ltd.",
    date: "Wed, 22 Jul 2026 11:00:00 +0000", html: mail("PayPal", "paypal.co.uk", ["Cellar Club Ltd. sent you a refund of £30.00 GBP.", "It may take a few moments for this transaction to appear in your account.", "Merchant", "Cellar Club Ltd.", "Refund amount", "£30.00 GBP",
      "Transaction ID", "7HK31122AB4455667 |", "Invoice ID: CC22001544-P001"]) },
    { kind: "refund", refundPence: 3000, orderRef: "CC22001544-P001" });
  not("holdout13a-support-partial-refund", "Just Eat", "a support reply ('Re: Conversation with …') saying it processed a partial refund for an order it names", { from: "Just Eat UK <info@just-eat.co.uk>", subject: "[Just Eat UK] Re: Conversation with " + SHOPPER.email,
    date: "Mon, 12 Oct 2026 10:34:00 +0000", text: ["##- Please type your reply above this line -##", "", "Priya, 12 Oct 2026, 11:34 BST", "", `Hi ${SHOPPER.first},`, "", "I have personally taken ownership of your ticket regarding order #771200341 from Napoli Corner.", "",
      "I have overridden the automated decline and processed a partial refund of £6.25 back to your original payment card. Please allow 5-7 business days for this to reflect in your account.", "", "Kind regards,", "This email is a service from Just Eat UK."].join("\n") },
    { kind: "adjusted", refundPence: 625, merchant: null });
  return out;
}
