// A twenty-third set of made-up emails (see lib.mjs), round 19 (20 Nov 2026): layouts of receipts in a real inbox that Relay
// still read wrongly after round 18, written again with everything in them made up (shops, events, items, prices, people,
// numbers). A ticket seller whose fees sit in brackets beside each ticket type, "£3.30 (Service Charge Full Price Ticket) x2"
// (each fee is a line of the list, and stays one in the list shown: scripts/test-receipt-real-19.mjs, which also reads
// holdout16c's plain-text ticket order for its "Delivery/transaction costs");
// a payment service's receipt whose HTML gives each label and its value on lines of their own; a web shop's money off set
// out under the thing it was taken off; a home-delivery email whose delivery day sits above the item. (A parking app's
// receipt and a booking with no total are holdout16e's and holdout16c's, whose answers this round changes.)
import { order, expected, page, fixture, h } from "./lib.mjs";

const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });

export default function holdout20() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };

  // ---- A ticket seller's HTML order: each fee in brackets beside the ticket type it is charged on -------------------------
  {
    const o = order([{ name: "Sam Example: Live In Leeds", qty: 2, unit: 3500 }, { name: "Service Charge Full Price Ticket", qty: 2, unit: 330 }, { name: "Facility Charge Full Price Ticket", qty: 2, unit: 150 }, { name: "Handling Fee", qty: 1, unit: 250 }]);
    add("holdout20-tickets-fees-in-brackets", "Ticketpoint", "'Order #41-55555/UK1' over the event's name, 'Payment Summary', '2 Full Price Ticket', '£35.00 x2', '£70.00', 'Per Item Fees', '£3.30 (Service Charge Full Price Ticket) x2', '£1.50 (Facility Charge Full Price Ticket) x2', '£9.60', 'Order Processing Fees', 'Handling Fee (£2.50)', '£2.50', 'Total', '£82.10'",
      { from: "Ticketpoint <customer_support@email.ticketpoint.example>", subject: "Your Ticketpoint order confirmation: Sam Example: Live In Leeds", date: "Mon, 16 Nov 2026 12:05:00 +0000",
        html: mail("Ticketpoint", "ticketpoint.example", ["You got the tickets!", "Order #41-55555/UK1", "Sam Example: Live In Leeds", "Example Arena, Leeds", "Sat 12 Dec 2026 - 20:00",
          "Payment Summary", "2 Full Price Ticket", "£35.00 x2", "£70.00", "Per Item Fees", "£3.30 (Service Charge Full Price Ticket) x2", "£1.50 (Facility Charge Full Price Ticket) x2", "£9.60",
          "Order Processing Fees", "Handling Fee (£2.50)", "£2.50", "Total", "£82.10", "Ticketpoint does not issue refunds after purchase as set out in our Purchase Policy."]) },
      o, "Ticketpoint", "2026-11-16", { orderRef: "41-55555" });
  }
  // ---- A payment service's receipt whose HTML gives each label and its value on lines of their own ------------------------
  {
    const o = order([{ name: "6 Month Digital Subscription (Ireland)", qty: 1, unit: 4500 }]);
    const f = add("holdout20-payment-service-stacked-labels", "PayPal", "HTML only: 'You paid £45.00 GBP to Example Gazette Ltd', 'Quantity', '1', 'Item', '6 Month Digital Subscription (Ireland)', 'ID number', 'Price', '£45.00 GBP', 'Subtotal', '£45.00 GBP', 'Total', '£45.00 GBP'",
      { from: "service@paypal.co.uk", subject: "Your PayPal receipt", date: "Tue, 10 Nov 2026 18:45:00 +0000",
        html: mail("PayPal", "paypal.co.uk", ["Hi Sam Taylor,", "You paid £45.00 GBP to Example Gazette Ltd", "Your purchase details", "Transaction ID: 1AB23456CD789012E", "Purchase date: 10 November 2026",
          "Merchant order ID: EG-10001", "Quantity", "1", "Item", "6 Month Digital Subscription (Ireland)", "ID number", "Price", "£45.00 GBP", "Subtotal", "£45.00 GBP", "Total", "£45.00 GBP", "You paid using: Visa 1234"]) },
      o, "Example Gazette Ltd", "2026-11-10", { orderRef: "EG-10001" });
    f.expected.shopAlso = ["Example Gazette", "PayPal"];
  }
  // ---- A web shop's money off set out under the thing it was taken off ------------------------------------------------------
  {
    const o = order([{ name: "Linen Cushion Cover Set", qty: 1, unit: 4000 }, { name: "Stoneware Mug", qty: 1, unit: 1200 }], { fees: [["Shipping", 395]], discounts: [["WINTER25", 1300]] });
    add("holdout20-shop-line-discount", "Hearth & Field", "plain text: 'Linen Cushion Cover Set × 1', 'Oat / Large', 'WINTER25', '(-£10.00)', '£40.00', '£30.00'; 'Stoneware Mug × 1', 'WINTER25', '(-£3.00)', '£12.00', '£9.00'; 'Subtotal £39.00', 'Shipping £3.95', 'Total £42.95 GBP'",
      { from: "Hearth & Field <shop@hearthandfield.example>", subject: "Order #HF1042 confirmed", date: "Thu, 12 Nov 2026 09:40:00 +0000",
        text: ["Hearth & Field", "ORDER #HF1042", "Thank you for your purchase!", "", "Order summary", "-------------", "", "Linen Cushion Cover Set × 1", "", "Oat / Large", "", "WINTER25", "(-£10.00)", "", "£40.00", "", "£30.00", "",
          "Stoneware Mug × 1", "", "WINTER25", "(-£3.00)", "", "£12.00", "", "£9.00", "", "Subtotal", "", "£39.00", "", "Shipping", "", "£3.95", "", "Total", "", "£42.95 GBP", "", "You saved £13.00"].join("\n") },
      o, "Hearth & Field", "2026-11-12", { orderRef: "HF1042" });
  }
  // ---- A home-delivery email: the delivery day above the item, the item over "Qty 1" and its price ---------------------------
  {
    const o = order([{ name: "SMART DOORBELL CAMERA 3RD GEN BLACK", qty: 1, unit: 8999 }]);
    add("holdout20-delivery-day-above-item", "Shelfmart", "'Order Number:' '7001234567', 'Delivery of 1 items on', 'Thursday 26 November', '10:00 - 13:00', 'Subtotal', 'SMART DOORBELL CAMERA 3RD GEN BLACK', 'Qty 1', '£89.99', 'Delivery:' '£0.00', 'Total:' '£89.99'",
      { from: "Shelfmart <noreply@shelfmart.example>", subject: "Confirmation Email for Home Delivery", date: "Sun, 15 Nov 2026 16:00:00 +0000",
        html: mail("Shelfmart", "shelfmart.example", ["Confirmation Email for Home Delivery", "Sam,", "Thanks for your order. Here are your delivery details.", "Home delivery items", "Order Number:", "7001234567",
          "Delivery of 1 items on", "Thursday 26 November", "10:00 - 13:00", "Subtotal", "SMART DOORBELL CAMERA 3RD GEN BLACK", "Qty 1", "£89.99", "Delivery address:", "12 Example Road", "LEEDS", "LS1 4AB",
          "Delivery:", "£0.00", "Savings:", "£0.00", "Total:", "£89.99"]) },
      o, "Shelfmart", "2026-11-15", { orderRef: "7001234567" });
  }
  return out;
}
