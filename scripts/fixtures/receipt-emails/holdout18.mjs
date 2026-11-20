// A twenty-first set of made-up emails (see lib.mjs), round 17 (20 Nov 2026): layouts of receipts in a real inbox that Relay
// read wrongly after round 16, written again with everything in them made up (shops, stations, items, prices, people,
// numbers). A supermarket's pack sizes beside its quantity column; a rail ticket change whose transaction number sits a cell
// under its label; a film paid by gift certificate in a text-only receipt; a jeweller's "Ordered Items" under its order
// details; a takeaway dish's "8 Pcs"; a payment service's "Description | Unit price | Qty | Amount" table; an older
// marketplace layout with "Fulfilled by" and "Gift wrap: No" over each price; a coach company's "Your reservations".
import { order, expected, page, fixture, h, gbp } from "./lib.mjs";

const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });

export default function holdout18() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };

  // ---- A supermarket's order email: "Pittas x6" is the pack, the quantity is its own column, then the price per unit -----
  {
    const its = [{ name: "Greenleaf Wholemeal Pittas x6", qty: 1, unit: 55 }, { name: "Greenleaf Free Range Eggs Medium x12", qty: 2, unit: 310 },
      { name: "Greenleaf Kitchen Towels x4", qty: 1, unit: 425 }, { name: "Greenleaf Red Onions x3", qty: 3, unit: 89 }];
    const o = order(its, { fees: [["Delivery cost", 150]] });
    const lines = ["Thanks for your order", "Order number: 4410293387", "Delivery slot: Saturday 14 November, 9am - 10am", "Substitution allowed"];
    for (const i of its) lines.push(i.name, String(i.qty), gbp(i.qty * i.unit), gbp(i.unit) + "/unit", "Substitution allowed");
    lines.push("Subtotal", gbp(o.subtotal), "Delivery cost", gbp(150), "Estimated total", gbp(o.total));
    add("holdout18-grocer-pack-size-qty-column", "Greenleaf", "each item's name ending in its pack size ('Pittas x6'), then its quantity on a line of its own, the line price and '£0.55/unit'",
      { from: "Greenleaf <orders@greenleaf-grocer.example>", subject: "Thanks for your order - 4410293387", date: "Wed, 11 Nov 2026 19:40:00 +0000", html: mail("Greenleaf", "greenleaf-grocer.example", lines) },
      o, "Greenleaf", "2026-11-11", { orderRef: "4410293387" });
  }
  // ---- A rail ticket change: "Transaction ID:" then an empty cell, then the number --------------------------------------
  {
    const o = order([{ name: "Oakford Parkway to Marston Central", qty: 1, unit: 245 }, { name: "Admin Fee", qty: 1, unit: 750 }]);
    add("holdout18-rail-change-transaction-cell", "Railwise", "subject 'Your change confirmation'; 'Transaction ID:' over an empty cell over '731204558812'; 'Order Details' 'Pay The Difference' with no price; 'Other costs' 'Admin Fee'",
      { from: "Railwise <auto-confirm@info.railwise.example>", subject: "Your change confirmation", date: "Thu, 12 Nov 2026 07:10:00 +0000",
        html: mail("Railwise", "railwise.example", ["You have successfully changed your journey", "Your trip to Marston Central departing Friday, 13 November 2026 is confirmed",
          "Outbound Friday, 13 November", "08:05 Oakford Parkway", "09:12 Marston Central", "1x Off-Peak Day Single", "1x Adult", "Payment information", "Transaction ID:", "", "731204558812",
          "Transaction Date:", "12 November 2026", "Order Details |", "Pay The Difference: Adult - Off-Peak Day Single - [16-25 Railcard]", "Other costs |", "Admin Fee", "£7.50",
          "Booking Fee", "No booking fee", "Total amount: | £9.95 |", "Need a refund or want to change your ticket?", "Your Transaction ID:", "", "731204558812"]),
        // (Its text part, as the shop sends it with the HTML.)
        text: ["You have successfully changed your journey", "Your trip to Marston Central departing Friday, 13 November 2026 is confirmed", "", "Outbound Friday, 13 November",
          "08:05 Oakford Parkway", "09:12 Marston Central", "1x Off-Peak Day Single", "1x Adult", "", "Payment information", "Transaction ID:", "", "731204558812", "Transaction Date: 12 November 2026", "",
          "Order Details", "Pay The Difference: Adult - Off-Peak Day Single - [16-25 Railcard]", "Other costs", "Admin Fee", "£7.50", "Booking Fee", "No booking fee", "Total amount:", "£9.95"].join("\n") },
      o, "Railwise", "2026-11-12", { orderRef: "731204558812" });
  }
  // ---- A film paid by gift certificate, text only: no "Total:" line, the gift certificate takes all of it ----------------
  {
    const o = order([{ name: "The Harbour at Dusk", qty: 1, unit: 599 }]);
    const text = ["Thanks for your order", "----------Order details", "", "Order #D01-3141592-6535897 Placed on Thursday, September 24, 2026", "", "The Harbour at Dusk", "Sold by :Amazon Digital UK Limited", "",
      "Item Subtotal: £4.99", "Total Before Tax: £4.99", "Tax Collected: £1.00", "Gift Certificate/Card Amount: -£5.99", "Grand Total: £0.00", "",
      "View order details (http://www.amazon.co.uk/gp/digital/your-account/order-summary.html)", "", "Amazon.co.uk is a trading name for Amazon EU Sarl."].join("\n");
    add("holdout18-film-gift-certificate-text", "Amazon", "a text-only digital receipt: 'Item Subtotal', 'Total Before Tax', 'Tax Collected', 'Gift Certificate/Card Amount: -£5.99', 'Grand Total: £0.00'; what it cost is £5.99, paid by the gift certificate",
      { from: '"Amazon.co.uk" <digital-no-reply@amazon.co.uk>', subject: "Amazon.co.uk order of The Harbour at Dusk.", date: "Thu, 24 Sep 2026 21:02:00 +0000", text }, o, "Amazon", "2026-09-24", { giftCardPence: 599 });
  }
  // ---- A jeweller: "Order Date" among the order details, the item under "Ordered Items" -----------------------------------
  {
    const o = order([{ name: "Lumen bracelet, Silver tone", qty: 1, unit: 8900 }], { discounts: [["Voucher", 890]] });
    add("holdout18-jeweller-ordered-items", "Glintwell", "'Order Details' with 'Order No.', 'Order Date', 'Delivery options', '3-4 business days…', 'Payment details', then 'Ordered Items' over the name, '£ 89.00', 'Quantity: 1'",
      { from: "Glintwell Customer Service GB <orders@glintwell.example>", subject: "Your Glintwell order confirmation", date: "Sun, 13 Dec 2026 11:20:00 +0000",
        html: mail("Glintwell", "glintwell.example", ["Thank you for your order", "Order Details", "Order No.", "50GB00009912345", "Order Date", "13 12 2026", "Delivery options", "Standard Delivery",
          "3-4 business days after processing and shipping", "Payment details", "APPLEPAY", "Ordered Items", "Lumen bracelet, Silver tone", "£ 89.00", "Quantity: 1", "Colour: Silver tone",
          "Article No.: 7712345", "Articles (1) | £ 89.00", "Delivery | Free", "Voucher | -£ 8.90", "Total incl. VAT | £ 80.10"]) },
      o, "Glintwell", "2026-12-13");
  }
  // ---- A takeaway order: "1x" before the dish, then "8 Pcs" (its size) under it --------------------------------------------
  {
    const o = order([{ name: "Crispy Wings Box", qty: 1, unit: 1095, extras: ["8 Pcs"] }, { name: "Halloumi Wrap", qty: 1, unit: 750 }], { fees: [["Delivery fee", 199]] });
    add("holdout18-takeaway-pieces", "Dinedash", "'1x' then the dish, '8 Pcs' under it, then its price; the pieces are the dish's size",
      { from: "Dinedash <noreply@dinedash.example>", subject: "Your order's in the kitchen", date: "Sat, 21 Nov 2026 19:05:00 +0000",
        html: mail("Dinedash", "dinedash.example", ["Here's your receipt", "Order ID #5121", "1x", "Crispy Wings Box", "8 Pcs", "£10.95", "1x", "Halloumi Wrap", "£7.50",
          "Subtotal", "£18.45", "Delivery fee", "£1.99", "Total", "£20.44"]) },
      o, "Dinedash", "2026-11-21");
  }
  // ---- A payment service's receipt: "Description | Unit price | Qty | Amount", each cell on a line of its own -----------
  {
    const o = order([{ name: "6 Month Print Subscription (United Kingdom)", qty: 1, unit: 6500 }]);
    add("holdout18-payment-service-description-table", "PayPal", "'Description', 'Unit price', 'Qty', 'Amount' over '6 Month Print Subscription (United Kingdom)', '£65.00 GBP', '1', '£65.00 GBP'",
      { from: "service@paypal.co.uk", subject: "Receipt for your payment to The Westbrook Gazette Ltd", date: "Fri, 02 Oct 2026 10:30:00 +0100",
        html: mail("PayPal", "paypal.co.uk", ["You sent a payment of £65.00 GBP to The Westbrook Gazette Ltd", "Merchant", "The Westbrook Gazette Ltd", "Invoice ID", "WG-44120",
          "Description", "Unit price", "Qty", "Amount", "6 Month Print Subscription (United Kingdom)", "£65.00 GBP", "1", "£65.00 GBP", "Subtotal", "£65.00 GBP", "Total", "£65.00 GBP",
          "Payment sent to accounts@westbrookgazette.example"]) },
      o, "The Westbrook Gazette", "2026-10-02", { shopAlso: ["The Westbrook Gazette Ltd", "Westbrook Gazette"] });
  }
  // ---- An older marketplace layout: seller, "Fulfilled by…", "Gift wrap: No", then each item's price -----------------------
  {
    const its = [{ name: "Hazel & Fig Chocolate Truffle Selection, 150G", qty: 1, unit: 799 }, { name: "Bath Fizzer Gift Set, 8 Pack", qty: 1, unit: 1499 }];
    const o = order(its);
    const html = `<html><body><table><tr><td>Order Confirmation</td></tr><tr><td>Order #</td><td>205-2718281-8284591</td></tr><tr><td>Order Total:</td><td>${h(gbp(o.total))}</td></tr>` +
      its.map((i) => `<tr><td>${h(i.name)}</td></tr><tr><td>Condition: New</td></tr><tr><td>Sold by:</td><td>Maple Lane Gifts</td></tr><tr><td>Fulfilled by Amazon</td></tr><tr><td>Gift wrap: No</td></tr><tr><td>${h(gbp(i.unit))}</td></tr>`).join("") +
      `<tr><td>We hope to see you again soon.</td></tr></table></body></html>`;
    add("holdout18-marketplace-fulfilled-gift-wrap", "Amazon", "title, 'Condition: New', 'Sold by:' and the seller, 'Fulfilled by Amazon', 'Gift wrap: No', then the price; no gift wrap fee",
      { from: '"Amazon.co.uk" <auto-confirm@amazon.co.uk>', subject: `Your Amazon.co.uk order of "${its[0].name.slice(0, 30)}..." and 1 more item.`, date: "Tue, 15 Dec 2026 09:00:00 +0000", html },
      o, "Amazon", "2026-12-15", { fees: [] });
  }
  return out;
}
