// An eighteenth set of made-up emails (see lib.mjs), round 15 (20 Nov 2026): layouts of receipts in Connor's own inbox that
// blind checks found Relay still reading wrong (a rail ticket change paid as an admin fee, a railcard, split tickets with
// insurance, a booking's refund by its transaction number, a pub app's promotions, a bill's check number, a vape shop's
// newer order email), written again with everything in them made up (shops, stations, items, prices, people, numbers).
import { order, expected, page, fixture, h } from "./lib.mjs";

const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${l.split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });

export default function holdout16b() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  const not = (id, sender, layout, m, kind, extra = {}) => { const f = fixture(id, sender, layout, m, { notPurchase: { kind, ...extra } }); out.push(f); return f; };
  const rail = "Railwise <auto-confirm@info.railwise.example>";

  // ---- A rail ticket change: the new ticket under "Order Details" with no price, the admin fee under "Other costs" ---------
  {
    const o = order([{ name: "Oakford Parkway to Marston Central", qty: 1, unit: 415 }, { name: "Admin Fee", qty: 1, unit: 700 }]);
    add("holdout16b-rail-change-admin-fee", "Railwise", "subject 'Your change confirmation'; '1x Advance Single' and '1x Adult' in the journey; 'Order Details' then 'Pay The Difference: Adult - Advance Single - [16-25 Railcard]' with no price; 'Other costs' 'Admin Fee' '£7.00'; 'No booking fee'; 'Total amount: | £11.15'", {
      from: rail, subject: "Your change confirmation", date: "Mon, 09 Nov 2026 18:02:00 +0000",
      html: mail("Railwise", "railwise.example", ["You have successfully changed your journey", "Your trip to Marston Central departing Thursday, 12 November 2026 is confirmed",
        "Oakford Parkway", "Marston Central", "Outbound Thursday, 12 November", "01h 12m, 0 changes", "09:41 Oakford Parkway", "Northern Lines Rail", "10:53 Marston Central",
        "1x Advance Single", "Specified train only. No refunds.", "1x Adult", "Payment information", "Transaction ID:", "730118264590", "Card Type:", "Visa Debit",
        "Order Details |", "Pay The Difference: Adult - Advance Single - [16-25 Railcard]", "Other costs |", "Admin Fee", "£7.00", "Booking Fee", "No booking fee", "Total amount: | £11.15 |",
        "Your Transaction ID:", "730118264590"]) }, o, "Railwise", "2026-11-09", { orderRef: "730118264590" });
  }
  // ---- A digital railcard: the card under "Order Details" over its price ---------------------------------------------------
  {
    const o = order([{ name: "16-25 Railcard", qty: 1, unit: 3500 }]);
    add("holdout16b-railcard", "Railwise", "subject 'Your digital railcard purchase is complete. Transaction Id …'; 'Order Details' then '16-25 Railcard' over '£35.00'; 'Other costs' 'Booking Fee' 'No booking fee'", {
      from: rail, subject: "Your digital railcard purchase is complete. Transaction Id 730118299102", date: "Tue, 10 Nov 2026 08:15:00 +0000",
      html: mail("Railwise", "railwise.example", ["Your digital 16-25 Railcard is ready to use in the app", "16-25", "Railcard", "Valid from", "Tue, 10 Nov 2026", "Valid to", "Wed, 10 Nov 2027",
        "Payment information", "Transaction ID:", "730118299102", "Transaction Date:", "10 November 2026", "Payment Type:", "Apple Pay",
        "Order Details |", "16-25 Railcard", "£35.00", "Other costs |", "Booking Fee", "No booking fee", "Total amount: | £35.00 |"]) }, o, "Railwise", "2026-11-10", { orderRef: "730118299102" });
  }
  // ---- Split tickets for one journey plus travel insurance: each ticket and the insurance their own lines -----------------
  {
    const o = order([{ name: "Marston Central to Hollins Junction", qty: 1, unit: 480 }, { name: "Hollins Junction to Oakford Parkway", qty: 1, unit: 1290 }, { name: "Insurance", qty: 1, unit: 110 }]);
    add("holdout16b-rail-split-insurance", "Railwise", "journey in the subject; 'you just have multiple tickets'; '2x Advance Single'; two 'Adult - Advance Single - [16-25 Railcard]' rows each over a price; 'Other costs' 'Insurance' '£1.10'", {
      from: rail, subject: "Your booking confirmation for Marston to Oakford (14 November, 18:20)", date: "Wed, 11 Nov 2026 12:30:00 +0000",
      html: mail("Railwise", "railwise.example", ["There’s no difference to your journey, you just have multiple tickets", "Outbound Saturday, 14 November", "01h 15m, 0 changes",
        "18:20 Marston Central", "Advance Single", "Marston Central to Hollins Junction", "Advance Single", "Hollins Junction to Oakford Parkway", "19:35 Oakford Parkway", "2x Advance Single", "1x Adult", "You’re covered by Insurance",
        "Transaction ID:", "730118301877", "Order Details |", "Adult - Advance Single - [16-25 Railcard]", "£4.80", "Adult - Advance Single - [16-25 Railcard]", "£12.90",
        "Other costs |", "Insurance", "£1.10", "Booking Fee", "No booking fee", "Total amount: | £18.80 |"]) }, o, "Railwise", "2026-11-11", { orderRef: "730118301877" });
  }
  // ---- A booking's refund, subject "Refund request", by its transaction number -------------------------------------------
  not("holdout16b-rail-refund-by-transaction", "Railwise", "subject 'Refund request'; 'We're refunding your booking'; 'Refund processing'; 'Transaction ID:' over the booking's number; 'Total to refund: | £6.40'", {
    from: rail, subject: "Refund request", date: "Fri, 13 Nov 2026 09:00:00 +0000",
    html: mail("Railwise", "railwise.example", ["We're refunding your booking", "Sit back and wait for the money to arrive", "Refund processing", "Oakford Parkway to", "Marston Central", "Outbound Sat, 14 Nov 2026", "1 adult",
      "Your refund is being credited back to the account used to make the purchase. This transfer is normally completed within 5 working days.",
      "Refund information", "Transaction ID:", "730118264590", "Transaction Date:", "9 November 2026", "Oakford Parkway - Marston Central", "£6.40", "Total to refund: | £6.40 |"]) },
    "refund", { refundPence: 640, orderRef: "730118264590" });

  // ---- A pub app's order: a promotion set out as an item row with a minus price ------------------------------------------
  {
    const o = order([{ name: "Spiced Rum (Double)", qty: 1, unit: 455 }, { name: "Cola", qty: 1, unit: 0 }, { name: "Big Breakfast", qty: 1, unit: 925 }], { discounts: [["Promotion Applied", 195]] });
    add("holdout16b-pub-app-promotion", "Tapster Inns", "'Qty | Description | Amount' table; '1 | Promotion Applied | -£1.95' between items; 'VAT (20.00%)'; 'Order Total'", {
      from: "Tapster Inns <orders@tapsterinns.example>", subject: "Tapster Inns Order Confirmation: 3120", date: "Sun, 15 Nov 2026 12:46:00 +0000",
      html: mail("Tapster Inns", "tapsterinns.example", ["Thank you for your order...", "The Weavers Arms", "18 Mill Street", "Hebden", "HX7 1AA", "Order Id: 2207731145", "Order Date: Sunday, November 15, 2026", "Table Number: 21",
        "Qty | Description | Amount", "1 | Spiced Rum (Double) | £4.55", "1 | Cola | £0.00", "1 | Promotion Applied | -£1.95", "1 | Big Breakfast | £9.25", "VAT (20.00%) | £2.14", "Payment Type | Apple Pay", "Order Total | £11.85"]) },
      o, "Tapster Inns", "2026-11-15", { orderRef: "2207731145" });
  }
  // ---- A restaurant's bill paid at the table: "check number" over "#4412" beside "table" over "#18" -----------------------
  {
    const o = order([{ name: "house red (btl)", qty: 1, unit: 2400 }, { name: "chicken katsu", qty: 1, unit: 1350 }, { name: "edamame", qty: 1, unit: 550 }]);
    add("holdout16b-bill-check-number", "Noodle Yard", "lower-case till receipt; 'table' over '#18' and 'check number' over '#4412' as headings; items 'name | x1 | £..'; 'bill total', 'amount paid'", {
      from: "Noodle Yard <noreply@noodleyard.example>", subject: "Noodle Yard receipt", date: "Mon, 16 Nov 2026 20:06:00 +0000",
      html: mail("Noodle Yard", "noodleyard.example", ["your receipt", "thanks for visiting noodle yard soho and paying online", "restaurant", "soho", "table", "#18", "check number", "#4412", "items",
        "house red (btl) | x1 | £24.00", "chicken katsu | x1 | £13.50", "edamame | x1 | £5.50", "total items | x3", "net total | £35.83", "v.a.t | £7.17", "bill total | £43.00", "amount paid | £43.00"]) },
      o, "Noodle Yard", "2026-11-16", { orderRef: "4412" });
  }
  // ---- A shop's order email: number in the subject after "Order Confirmation: #", prices with one figure of pence --------
  const vapeOrder = (id, status, date) => {
    const o = order([{ name: "Cloudpuff Pod - Mango - 10mg", qty: 4, unit: 150 }, { name: "Cloudpuff Pod - Cola - 10mg", qty: 9, unit: 150 }, { name: "Cloudpuff Pod - Lime - 10mg", qty: 1, unit: 150 }]);
    return add(id, "Puff Depot", "'Order Confirmation: #61822 | Puff Depot'; 'Your order (61822) has been received and we are currently " + status + " it.'; 'Product | Quantity | Price' with '£ 6', '£ 13.5', '£ 1.5'; 'Subtotal', 'Total'", {
      from: "Puff Depot <site@puffdepot.example>", subject: "Order Confirmation: #61822 | Puff Depot", date,
      html: mail("Puff Depot", "puffdepot.example", ["Order placed successfully.", "Thank you for choosing us", "Hi Sam Taylor,", "Your order (61822) has been received and", "we are currently " + status + " it.",
        "Customer Information", "Product | Quantity | Price", "Cloudpuff Pod - Mango - 10mg | 4 | £ 6", "Cloudpuff Pod - Cola - 10mg | 9 | £ 13.5", "Cloudpuff Pod - Lime - 10mg | 1 | £ 1.5",
        "Subtotal | £ 21.00", "Royal Mail Tracked 48 Shipping | £ 0.00", "Total | £ 21.00"]) }, o, "Puff Depot", date.includes("12 Nov") ? "2026-11-12" : "2026-11-14", { orderRef: "61822" });
  };
  vapeOrder("holdout16b-shop-order-one-figure-pence", "Processing", "Thu, 12 Nov 2026 15:57:00 +0000");
  vapeOrder("holdout16b-shop-order-completed-resend", "Completed", "Sat, 14 Nov 2026 08:14:00 +0000");
  not("holdout16b-shop-refund-initiated", "Puff Depot", "subject 'Refund Initiated : #61822 | Puff Depot'; 'A refund of £3 has been initiated for your order 61822 .'; plain part only 'Hello Sam Taylor, #'", {
    from: "Puff Depot <site@puffdepot.example>", subject: "Refund Initiated : #61822 | Puff Depot", date: "Mon, 16 Nov 2026 11:33:00 +0000", text: "Hello Sam Taylor, #",
    html: mail("Puff Depot", "puffdepot.example", ["Refund Initiated!", "A refund of £3 has been initiated for your order 61822 .", "Hi Sam Taylor, your refund for Order 61822 has been successfully initiated and is currently being processed. It will take 1-3 business days for the refund to reflect in your account."]) },
    "refund", { refundPence: 300, orderRef: "61822" });
  // ---- A pub app's receipt: the chain's name over the pub's own name, and an address with no street word ---------------
  {
    const o = order([{ name: "Stout (Pint)", qty: 1, unit: 462 }]);
    add("holdout16b-pub-app-chain-then-venue", "Tapster Inns", "the chain's name 'Tapsters' over 'Harbour Station Bar', 'North Concourse', town, postcode, 'Telephone:'", {
      from: "Tapster Inns <orders@tapsterinns.example>", subject: "Tapster Inns Order Confirmation: 7886", date: "Sat, 14 Nov 2026 12:29:00 +0000",
      html: mail("Tapster Inns", "tapsterinns.example", ["Thank you for your order...", "Tapsters", "Harbour Station Bar", "North Concourse", "Portview", "PV1 4DY", "Telephone: 0113 496 0000",
        "Order Id: 2508590001", "Order Date: Saturday, November 14, 2026", "Table Number: 41", "Qty | Description | Amount", "1 | Stout (Pint) | £4.62", "VAT (20%) | £0.77", "Payment Type | Apple Pay", "Order Total | £4.62"]) },
      o, "Tapster Inns", "2026-11-14", { orderRef: "2508590001", merchant: "Harbour Station Bar" });
  }
  return out;
}
