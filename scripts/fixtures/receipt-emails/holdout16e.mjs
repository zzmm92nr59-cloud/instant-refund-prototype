// A twenty-first set of made-up emails (see lib.mjs), round 15e (20 Nov 2026): layouts of emails in Connor's own inbox that
// blind checks found Relay still reading wrong, written again with everything in them made up (shops, items, prices,
// people, numbers). scripts/test-receipt-corpus.mjs reads them as purchases.
import { order, expected, page, fixture, h } from "./lib.mjs";

// Each line its own row, as these emails' builders set them out; a cell can hold lines of its own ("a<br>b").
const cell = (c) => c.split("\n").map(h).join("<br />");
const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${l.split(" || ").map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`).join("")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });
// (Each line in a table of its own, nested in the page's cell, as some builders nest them.)
const nested = (brand, domain, lines) => page({ brand, domain, rows: [lines.map((l) => `<table role="presentation" width="100%"><tr><td>${cell(l)}</td></tr></table>`).join("")] });

// (Not in the corpus: a shirt shop's order, its despatch email with no items or money ("Despatch Confirmation - Ref: …",
// "Your order number is: …", its parcel's number only as data in the page), and the carrier's "delivered" email that gives
// the parcel's number only in its tracking link. The despatch joins the order by its number, the delivery by the parcel's.)
export const SHIRT_ORDER = fixture("holdout16e-shirt-order", "Collarworks", "an order with its number in the subject", {
  from: "Collarworks <orders@collarworks.example>", subject: "Collarworks Order Confirmation - Ref: cwk55120931", date: "Mon, 16 Nov 2026 11:14:08 +0000",
  html: page({ brand: "Collarworks", domain: "collarworks.example", rows: [`<p>Thank you for your order</p><p>Your order number is: cwk55120931</p><table><tr><td>Oxford shirt</td><td>Qty: 1</td><td>&pound;59.95</td></tr><tr><td>Total</td><td>&pound;59.95</td></tr></table>`] }) },
  { orderRef: "cwk55120931" });
export const SHIRT_DESPATCH = fixture("holdout16e-shirt-despatch", "Collarworks", "subject 'Collarworks Despatch Confirmation - Ref: cwk55120931 (cwk55120931)'; 'Your order number is: cwk55120931'; the parcel's number only in a data block", {
  from: "Collarworks <orders@collarworks.example>", subject: "Collarworks Despatch Confirmation - Ref: cwk55120931 (cwk55120931)", date: "Thu, 19 Nov 2026 06:31:49 +0000",
  html: page({ brand: "Collarworks", domain: "collarworks.example", rows: [`<p>ORDER DESPATCHED</p><p>Dear Mr Taylor, Your order number is: cwk55120931</p><p>We are pleased to advise you that your order has been despatched.</p><div style="display:none">{&quot;orderNumber&quot;:&quot;cwk55120931&quot;,&quot;trackingNumber&quot;:&quot;UK4471100293&quot;,&quot;trackingURL&quot;:&quot;https:\\/\\/track.parcelways.example\\/tracking\\/UK4471100293&quot;}</div>`] }) },
  { notPurchase: { kind: "dispatch" } });
export const SHIRT_DELIVERED = fixture("holdout16e-carrier-delivered-link", "Parcelways", "a carrier's 'Your Collarworks package was delivered' with the parcel's number only in 'Track and manage package (https://track.parcelways.example/tracking/UK4471100293)'", {
  from: "Parcelways <no-reply@shipping.parcelways.example>", subject: "Your Collarworks package was delivered", date: "Fri, 20 Nov 2026 10:04:00 +0000",
  text: "Your Collarworks package was delivered\n\nYour package from Collarworks was delivered. Your package was left with the receptionist Today, 10:04 AM.\n\nTrack and manage package (https://track.parcelways.example/tracking/UK4471100293?ref=email)\n" },
  { notPurchase: { kind: "delivered" } });

// (Not in the corpus as a purchase: a sports nutrition shop's order and its email cancelling one of its things, "We have
// cancelled the following item(s) from your order 771508763", below a long menu, the thing's name with its link over
// "Quantity 1". Only that thing is cancelled.)
export const NUTRITION_ORDER = fixture("holdout16e-nutrition-order", "Musclemart", "an order of three things", {
  from: "Musclemart <orders@musclemart.example>", subject: "Thank you for your order", date: "Sat, 07 Nov 2026 10:00:00 +0000",
  html: page({ brand: "Musclemart", domain: "musclemart.example", rows: [rows(["Order Number: 771508763", "Whey Protein - 1kg - Vanilla || Qty: 1 || £23.38", "Protein Bar - 12 x 45g - Cookie Dough || Qty: 1 || £13.76", "Whey Protein - 1kg - Chocolate || Qty: 1 || £23.38", "Total: || £60.52"])] }) },
  { orderRef: "771508763" });
export const NUTRITION_PART_CANCEL = fixture("holdout16e-nutrition-part-cancel", "Musclemart", "subject 'Order Cancelled'; a long menu; 'We have cancelled the following item(s) from your order 771508763.'; 'Items'; the thing's name with its link, over 'Quantity 1'", {
  from: "Musclemart <orders@t.musclemart.example>", subject: "Order Cancelled", date: "Wed, 11 Nov 2026 09:00:00 +0000",
  text: Array.from({ length: 60 }, (_, k) => `Shop our range ${k + 1} <https://links.musclemart.example/ls/click?upn=${"x".repeat(80)}${k}>`).join("\n") +
    "\n\nHello Sam\n\nThank you for your purchase.\n\nWe have cancelled the following item(s) from your order 771508763. If a charge has been taken, then a refund will be processed.\n\nItems\nProtein Bar - 12 x 45g - Cookie Dough <https://links.musclemart.example/ls/click?upn=abc>\nQuantity 1\n\nKind regards\nMusclemart\n" },
  { notPurchase: { kind: "cancelled" } });

export default function holdout16e() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };

  // ---- A shop's order confirmation: a drawn symbol before the "View Order" button, "Products Ordered (2)", then each
  // product's name, "Qty: N" and "£ 6.49"; the money lines a column of labels beside a column of amounts ------------------
  {
    const o = order([{ name: "Mango Chill Fizz Disposable Kit 20mg", qty: 1, unit: 649 }, { name: "Cola Ice Fizz Prefilled Pods 20mg", qty: 2, unit: 549 }], { fees: [["Shipping", 349]] });
    add("holdout16e-symbol-button-stacked-money", "Puffline", "'\u{1F9FE} View Order' (a button with a drawn symbol) over 'Products Ordered (2)'; each product its name, 'Qty: 1', '£ 6.49', each line in a table of its own; then 'Subtotal' over 'Shipping(Courier Tracked 48 (2-4 Working Days))' in one cell, '£17.47' over '£3.49' in the next", {
      from: "Puffline <orders@puffline.example>", subject: "Order Confirmation: #640213 | Puffline", date: "Tue, 10 Nov 2026 19:12:40 +0000",
      html: nested("Puffline", "puffline.example", ["Thank you for the order!", "Hi Sam Taylor \u{1F44B}\u{1F3FB},", "Your order 640213 has been accepted and is currently being processed by us.",
        "Order Number : 640213", "Order Date : 10 Nov 2026", "\u{1F9FE} View Order", "Products Ordered (2)",
        "Mango Chill Fizz Disposable Kit 20mg", "Qty: 1", "£ 6.49", "Cola Ice Fizz Prefilled Pods 20mg", "Qty: 2", "£ 10.98",
        "Subtotal\nShipping(Courier Tracked 48 (2-4 Working Days))", "£17.47\n£3.49", "Total", "£20.96", "SHIPPING ADDRESS", "Sam Taylor", "12 Example Road"]) },
      o, "Puffline", "2026-11-10", { orderRef: "640213" });
  }
  // ---- An online pharmacy's order: one medicine as a bullet under "Medication Items:", its pack under it, then the total --
  {
    const o = order([{ name: "Loratadine 10mg tablets", qty: 1, unit: 990 }]);
    add("holdout16e-bullet-medicine-over-total", "PillPost", "'Medication Items:' then '- ' and 'Loratadine 10mg tablets' over 'x 30', then 'Total £9.90'; no price of its own; no order number", {
      from: "PillPost <no-reply@pillpost.example>", subject: "Thanks for your order!", date: "Wed, 11 Nov 2026 18:45:25 +0000",
      html: mail("PillPost", "pillpost.example", ["Hello Sam,", "Thanks for choosing PillPost. We've sent your prescription request to your GP and it should be approved within 1-2 working days.",
        "Medication Items:", "- || Loratadine 10mg tablets\nx 30", "Total £9.90", "Delivery Address", "12 Example Road"]) },
      o, "PillPost", "2026-11-11", {});
  }
  // ---- A card shop's order: each item as labels over their values ("Item:" over its name, "Price:" over "£18.0"), the
  // recipient's address between; the total "including Postage & Packaging" with the postage not set out -------------------
  {
    const o = order([{ name: "Peony Letterbox Bouquet", qty: 1, unit: 1800 }, { name: "Best Mum Ever Photo Card", qty: 1, unit: 399 }]);
    add("holdout16e-labels-over-values-postage-in-total", "Cardcove", "per item 'Item:' over its name, 'Recipient Details:' over a name and address, 'Quantity:' over '1', 'Price:' over '£18.0', 'Discount:' over '£0.0'; 'Total (including Postage & Packaging costs):' over '£27.97' (postage not set out)", {
      from: "Cardcove <hello@cardcove.example>", subject: "Hooray! Your order is confirmed!", date: "Thu, 12 Nov 2026 09:30:00 +0000",
      html: mail("Cardcove", "cardcove.example", ["Thanks for your order!", "Order Reference: CCQX7RT2LM", "Order Date: 12-11-2026",
        "Item:", "Peony Letterbox Bouquet", "Recipient Details:", "Alex Morgan", "4 Sample Close", "Leeds", "LS2 7ZZ", "Quantity:", "1", "Price:", "£18.0", "Discount:", "£0.0", "Est Delivery:", "13-11-2026",
        "Item:", "Best Mum Ever Photo Card", "Recipient Details:", "Alex Morgan", "4 Sample Close", "Leeds", "LS2 7ZZ", "Quantity:", "1", "Price:", "£3.99", "Discount:", "£0.0", "Est Delivery:", "13-11-2026",
        "Total (including Postage & Packaging costs):", "£27.97", "View my order"]) },
      { ...o, total: 2797 }, "Cardcove", "2026-11-12", { orderRef: "CCQX7RT2LM", totalPence: 2797, partial: true });
  }
  // ---- A subscription's receipt: "Item" over "Price" as headings, the plan over "£7.49/month", "VAT 20% - £1.50", the total --
  {
    const o = order([{ name: "Premium: 1-month subscription", qty: 1, unit: 749 }]);
    add("holdout16e-stacked-headings-monthly-price", "Safeway VPN", "'Item' over 'Price' (headings on lines of their own), 'Premium: 1-month subscription' over '£7.49/month', 'VAT 20% - £1.50' (a dash between, no minus), 'Total: £8.99/month'", {
      from: "Safeway Account <support@safewayvpn.example>", subject: "Your purchase receipt", date: "Fri, 13 Nov 2026 15:31:14 +0000",
      html: mail("Safeway VPN", "safewayvpn.example", ["Thanks for your purchase!", "Your subscription includes:", "Safeway VPN, Password Vault.", "Item", "Price", "Premium: 1-month subscription", "£7.49/month",
        "VAT 20% - £1.50", "Total: £8.99/month", "Payment method: VISA ****1234", "Order date: Nov 13, 2026 03:31:14 PM UTC"]) },
      { ...o, total: 899 }, "Safeway VPN", "2026-11-13", { totalPence: 899 });
  }
  // ---- A ticket seller's order: "Your Order (#…)" in brackets, "Item" / "Price" / "Fee" headings on lines of their own,
  // the ticket over its price and its fee; the event's date the day after the email -------------------------------------
  {
    const o = order([{ name: "EARLY ENTRY TICKET (WITH AFTER PARTY)", qty: 1, unit: 2800 }], { fees: [["Fee", 280]] });
    add("holdout16e-ticket-order-bracket-fee-column", "Ticketsy", "subject 'Tickets for Dockside | New Years Eve | Saturday 31st December' (no word order); 'Thank you for your order from Dockside'; 'Your Order (#9C41AB77E0D2):'; 'Item' / 'Price' / 'Fee' each on its own line; '1 x EARLY ENTRY TICKET (WITH AFTER PARTY)' over '£28.00' over '£2.80'; 'Order Total' over '£30.80'; the event 'Thu 31st Dec 2026 at 8:00pm' (the day after the email)", {
      from: "Ticketsy <team@ticketsy.example>", subject: "Tickets for Dockside | New Years Eve | Thursday 31st December", date: "Wed, 30 Dec 2026 15:54:03 +0000",
      html: nested("Ticketsy", "ticketsy.example", ["Download the Ticketsy App to get your tickets", "Order Details", "Thank you for your order from Dockside", "Your Details:", "Sam Taylor",
        "Your Order (#9C41AB77E0D2):", "Item", "Price", "Fee", "1 x EARLY ENTRY TICKET (WITH AFTER PARTY)", "£28.00", "£2.80", "Order Total", "£30.80",
        "EVENT DETAILS", "Dockside | New Years Eve | Thursday 31st December", "Thu 31st Dec 2026 at 8:00pm - Fri 1st Jan 2027 at 3:00am", "Dockside Hall in Leeds, United Kingdom"]) },
      o, "Ticketsy", "2026-12-30", { orderRef: "9C41AB77E0D2" });
  }
  // ---- A parking app's receipt sent through Apple's Hide My Email: the shop's address inside the relay's; "Cost: £1.40
  // including 20% VAT and Service Charge" the only amount, under its "Transaction ID" --------------------------------------
  {
    const o = order([]);
    add("holdout16e-parking-hidden-sender-cost", "Parkly", "from 'noreply_at_parkly_example_ab12cd34ef_0a1b2c3d@privaterelay.appleid.com' (Apple's Hide My Email); subject 'Parkly Parking Receipt'; 'Transaction ID: 2071188801'; 'Cost: £1.40 including 20% VAT and Service Charge'; no item list", {
      from: "<noreply_at_parkly_example_ab12cd34ef_0a1b2c3d@privaterelay.appleid.com>", subject: "Parkly Parking Receipt", date: "Sat, 14 Nov 2026 12:25:22 +0000",
      html: "Parkly Parking Receipt<br><br>Transaction ID: 2071188801<br>Location: 401122<br>License: AB12 CDE<br><br>Description: MARKET STREET<br><br>Start Parking: 2026/11/14 12:31PM<br>Stop Parking: 2026/11/14 1:31PM<br>Cost: &pound;1.40 including 20% VAT and Service Charge<br><br>Thank you for using the Parkly parking service." },
      { ...o, total: 140 }, "Parkly", "2026-11-14", { orderRef: "2071188801", totalPence: 140 });
  }
  // ---- An events app's ticket order: subject "Your order for <event>", "Order" over its number ---------------------------
  {
    const o = order([{ name: "Early Group ticket (admits 4)", qty: 1, unit: 4400 }]);
    add("holdout16e-event-order-for-label-over-number", "Gigline", "subject 'Your order for Night Shift: Room Two (live)'; '1 x Early Group ticket (admits 4)'; 'Total' over '£44.00'; 'Order' over 'GL31207733-118'", {
      from: "Gigline Tickets <noreply@gigline.example>", subject: "Your order for Night Shift: Room Two (live)", date: "Mon, 16 Nov 2026 21:45:03 +0000",
      html: nested("Gigline", "gigline.example", ["Sam, you're going to Night Shift: Room Two (live)", "View tickets in app", "Sat, 21 Nov - Sun, 22 Nov 2026", "23:00 - 05:00", "The Warehouse",
        "1 x Early Group ticket (admits 4)", "Total", "£44.00", "View tickets in app", "Order", "GL31207733-118", "Name on order", "Sam Taylor"]) },
      o, "Gigline", "2026-11-16", { orderRef: "GL31207733-118" });
  }
  // ---- A bowling booking: a subject that says nothing, "Your booking at … is confirmed", its "Reservation ID:", who it
  // is for ("2 x Adults", "2 x Games"), "Cost: £27.60" and "Total Order Value:" over the amount ---------------------------
  {
    const o = order([{ name: "Standard Bowling", qty: 1, unit: 2760 }]);
    add("holdout16e-booking-confirmed-who-for-cost", "Strikeworld", "subject 'You're in the game!'; 'Your booking at Strikeworld Leeds is confirmed'; 'Standard Bowling' over 'Reservation ID: 551204' over '2 x Adults' over '2 x Games' over 'Cost: £27.60'; 'Total Order Value:' over '£27.60'; 'Date of booking' over a later day", {
      from: "Strikeworld <bookings@strikeworld.example>", subject: "You're in the game!", date: "Mon, 09 Nov 2026 18:20:00 +0000",
      html: nested("Strikeworld", "strikeworld.example", ["Game on", "You've done it, Sam Taylor,", "Your booking at Strikeworld Leeds is confirmed. Get ready to enjoy yourself.", "Here are the details:", "Customer ID: 448811",
        "Date of booking", "14/11/2026", "Time of booking", "17:50", "Standard Bowling", "Reservation ID: 551204", "2 x Adults", "2 x Games", "Cost: £27.60", "Total Order Value:", "£27.60"]) },
      o, "Strikeworld", "2026-11-09", { orderRef: "551204" });
  }
  // ---- A winter attraction's booking: the number at the end of the subject, its one ticket with "×1" over "£48.00" and
  // no total line ---------------------------------------------------------------------------------------------------------
  {
    const o = order([{ name: "ICE RINK 16:15PM", qty: 1, unit: 4800 }]);
    add("holdout16e-booking-subject-number-no-total", "Frost Fair", "subject 'Your booking with Frost Fair Leeds! - 5520193'; 'Thank you for your booking'; 'ICE RINK 16:15PM' over 'FAMILY TICKET - Max 4 People' over '4 people' over '×1' over '£48.00'; no total line", {
      from: "Frost Fair Leeds <info@frostfair.example>", subject: "Your booking with Frost Fair Leeds! - 5520193", date: "Wed, 11 Nov 2026 10:00:00 +0000",
      html: nested("Frost Fair Leeds", "frostfair.example", ["Hello", "Thank you for your booking. We look forward to welcoming you to Frost Fair Leeds.", "Your booking details:", "ICE RINK 16:15PM",
        "FAMILY TICKET - Max 4 People (2 under 15s & 2 adults)", "4 people", "×1", "£48.00", "Important Information:", "Please have this email ready to show on arrival."]) },
      o, "Frost Fair Leeds", "2026-11-11", { orderRef: "5520193" });
  }
  // ---- A rail booking's change in the older layout: "Pay The Difference:" over its amount with no ticket named, then
  // "Other costs*" (a footnote mark) over "Booking Fee" / "No booking fee" --------------------------------------------------
  {
    const o = order([{ name: "Leeds to York", qty: 1, unit: 45 }]);
    add("holdout16e-rail-change-older-layout", "Railgo", "'You have successfully changed your journey'; '09:30 Leeds' and '10:00 York'; '1x Advance Single'; 'Order Details' then 'Pay The Difference:' over '£0.45', 'Other costs*' over 'Booking Fee' over 'No booking fee'; 'Total amount: | £0.45 |'", {
      from: "Railgo <auto-confirm@info.railgo.example>", subject: "Your booking confirmation", date: "Thu, 05 Nov 2026 10:00:00 +0000",
      html: nested("Railgo", "railgo.example", ["You have successfully changed your journey", "Your trip to York departing Friday, 13 November 2026 is confirmed", "Leeds", "York", "Outbound Friday, 13 November",
        "09:30 Leeds", "Northern", "10:00 York", "1x Advance Single", "Specified train only. No refunds.", "1x Adult", "Payment information", "Transaction ID:", "771122334455",
        "Order Details", "Pay The Difference:", "£0.45", "Other costs*", "Booking Fee", "No booking fee", "Total amount: || £0.45"]) },
      o, "Railgo", "2026-11-05", { orderRef: "771122334455" });
  }
  // ---- A shoe shop's order: "Shipping: £3.95" then "Shipping Discount: £" with its amount left blank, the total showing
  // the delivery was taken off again ---------------------------------------------------------------------------------------
  {
    const o = order([{ name: "574 Classic", qty: 1, unit: 7000 }], { fees: [["Shipping", 395]], discounts: [["Discount", 1050], ["Shipping Discount", 395]] });
    add("holdout16e-blank-shipping-discount", "Stridewell", "'574 Classic' with 'Style #:', 'UK Size: UK 8', 'QUANTITY: 1', 'PRICE: £70.00'; 'Order Subtotal: £70.00', 'Discount: £10.50', 'Shipping: £3.95', 'Shipping Discount: £' (blank), 'Order Total: £59.50'", {
      from: "Stridewell <orders@stridewell.example>", subject: "Your Stridewell order confirmation", date: "Tue, 10 Nov 2026 20:53:21 +0000",
      html: nested("Stridewell", "stridewell.example", ["Order Number: SW04419920", "YOUR ORDER", "574 Classic", "Style #:", "ML574EVG", "UK Size: UK 8", "Grey with White", "QUANTITY: 1", "PRICE: £70.00",
        "Order Subtotal: £70.00", "Discount: £10.50", "Shipping: £3.95", "Shipping Discount: £", "Order Total: £59.50", "Thanks for your order, Sam."]) },
      o, "Stridewell", "2026-11-10", { orderRef: "SW04419920" });
  }
  // ---- An exam board's invoice: its columns one under another and the row's prices written without "£" ------------------
  {
    const o = order([{ name: "Motorcycle", qty: 1, unit: 2300 }]);
    add("holdout16e-stacked-invoice-row", "Examboard", "'INVOICE' over its number; 'Quantity' / 'Item ID' / 'Description' / 'Shipped To' / 'Unit Price' / 'Amount' each on its own line, then '1' / '480012345' / 'Motorcycle' / … / '23.00' / '23.00' / 'GBP'; 'Total' over '23.00 GBP'", {
      from: "Examboard Bookings <noreply@examboard.example>", subject: "Examboard Confirmation of Payment", date: "Mon, 09 Nov 2026 10:04:00 +0000",
      html: nested("Examboard", "examboard.example", ["This is an invoice for your order and should be kept as your receipt.", "INVOICE", "0071-4410-2290", "09 November 2026 10:04",
        "Quantity", "Item ID", "Description", "Shipped To", "Unit Price", "Amount", "1", "480012345", "Motorcycle", "English-UK", "Appointment: 03 December 2026 02:15 PM", "Candidate Name:", "SAM TAYLOR",
        "23.00", "23.00", "GBP", "VAT", "Exempt", "0.00", "GBP", "Total", "23.00 GBP"]) },
      o, "Examboard", "2026-11-09", {});
  }
  // ---- A scooter ride's receipt: each charge's name over its amount ("Riding – £0.19/min" over "£2.09"), then the totals --
  {
    const o = order([{ name: "Starting fee", qty: 1, unit: 100 }, { name: "Riding", qty: 1, unit: 209 }]);
    add("holdout16e-ride-charge-pairs", "Zipscoot", "'Starting fee' over '£1.00'; 'Riding – £0.19/min' over '£2.09'; 'Total (excl. VAT)' over '£2.74'; 'VAT 20.0%' over '£0.55'; 'Total (incl. VAT)' over '£3.09'", {
      from: "Zipscoot Receipts <no-reply@zipscoot.example>", subject: "Receipt for your Zipscoot ride", date: "Sat, 07 Nov 2026 03:09:27 +0000",
      html: nested("Zipscoot", "zipscoot.example", ["Thank you for riding with Zipscoot.", "07 Nov 2026", "1.71mi distance", "3:58 AM - 4:09 AM", "Starting fee", "£1.00", "Riding – £0.19/min", "£2.09",
        "Total (excl. VAT)", "£2.74", "VAT 20.0%", "£0.55", "Total (incl. VAT)", "£3.09", "Apple Pay", "£3.09"]) },
      o, "Zipscoot", "2026-11-07", {});
  }
  // ---- A trainer shop's order: the delivery address straight over "YOUR ORDER SUMMARY", the brand over the product's whole
  // name, "Qty - 1" and "Size - 9" with dashes, empty placeholder rows ("Qty -", "Size -", "£"), "Order Delivery" -----------
  {
    const o = order([{ name: "Kappa Runway Lite", qty: 1, unit: 2850 }], { fees: [["Order Delivery", 399]] });
    const empty = []; for (let k = 0; k < 4; k++) empty.push("Qty -", "Size -", "£");
    add("holdout16e-brand-over-name-dash-labels", "Kickhouse", "address lines straight over 'YOUR ORDER SUMMARY'; 'Kappa' over 'Kappa Runway Lite' over 'Qty - 1' over 'Size - 9' over '£28.50' (shown twice, for phones and computers); empty 'Qty -' / 'Size -' / '£' rows; 'Order Delivery' over '£3.99'; 'Order Total Price' over '£32.49'", {
      from: "Kickhouse <orders@kickhouse.example>", subject: "Your Kickhouse order confirmation", date: "Wed, 18 Nov 2026 19:51:00 +0000",
      html: nested("Kickhouse", "kickhouse.example", ["YOUR ORDER CONFIRMATION", "YOUR ORDER NUMBER: 990123456", "Hey Sam", "Thanks for shopping with us, your order has been confirmed!", "When?", "Standard Delivery", "Ordered: 18 November 2026 19:51 GMT",
        "Delivery Address", "12 Example Road", "Leeds", "LS1 4AB", "Payment Method", "APPLE PAY", "YOUR ORDER SUMMARY", "Kappa", "Kappa Runway Lite", "Qty - 1", "Size - 9", "£28.50",
        "Kappa", "Kappa Runway Lite", "Qty - 1", "Size - 9", "£28.50", ...empty, "Order Delivery", "£3.99", "Order Total Price", "£32.49"]) },
      o, "Kickhouse", "2026-11-18", { orderRef: "990123456" });
  }
  // ---- An online doctor's order: "Item" / "Price" / "Delivery method chosen" headings, then the item, its price and its
  // delivery note, each on its own line; "TOTAL" over the amount -----------------------------------------------------------
  {
    const o = order([{ name: "COVID-19 travel test kit", qty: 1, unit: 1299 }]);
    add("holdout16e-three-columns-delivery-note", "Clinicly", "'Your order number: CL_4410021_1'; 'Item' / 'Price' / 'Delivery method chosen' headings; 'COVID-19 travel test kit' / '£12.99' / 'Delivery within two working days'; 'TOTAL' over '£12.99'", {
      from: "Clinicly Online Doctor <noreply@clinicly.example>", subject: "Your Clinicly Online Doctor order no: CL_4410021_1", date: "Thu, 12 Nov 2026 13:05:02 +0000",
      html: nested("Clinicly Online Doctor", "clinicly.example", ["Your order number: CL_4410021_1", "Item", "Price", "Delivery method chosen", "COVID-19 travel test kit", "£12.99", "Delivery within two working days", "TOTAL", "£12.99",
        "Check below for more information about your order"]) },
      o, "Clinicly Online Doctor", "2026-11-12", { orderRef: "CL_4410021_1" });
  }
  // ---- A scooter trip's receipt with no charges listed: "Trip Details", "Vehicle: Scooter", "Trip duration:", then the
  // receipt's number, "Amount charged: £2.16" and the total -----------------------------------------------------------------
  {
    const o = order([{ name: "Scooter trip", qty: 1, unit: 216 }]);
    add("holdout16e-trip-details-vehicle-no-charges", "Zapride", "'Here's your trip receipt.'; 'Trip Details' with 'Vehicle: Scooter', 'Trip duration: 7min 12sec', 'Trip distance: 1.20km'; 'Receipt number: 99120261112011223'; 'Amount charged: £2.16'; 'Total: £2.16 (inclusive of 20% VAT)'", {
      from: "Zapride <feedback@zapride.example>", subject: "Your Zapride Trip e-Receipt", date: "Thu, 12 Nov 2026 14:15:16 +0000",
      html: nested("Zapride", "zapride.example", ["Hi ,", "Here's your trip receipt.", "Trip Details", "Vehicle: Scooter", "Trip duration: 7min 12sec", "Trip distance: 1.20km",
        "Trip start time: Thursday, 12 Nov 2026, 2:06 PM", "Receipt Summary", "Receipt number: 99120261112011223", "Amount charged: £2.16", "Payment type: Apple Pay", "Total: £2.16 (inclusive of 20% VAT)"]) },
      o, "Zapride", "2026-11-12", { orderRef: "99120261112011223" });
  }
  // ---- A fashion shop's order: each item's row with two empty cells before its name (its picture), its sale price beside
  // the old one, then "Brown / No Size / Qty 1" with slashes --------------------------------------------------------------
  {
    const o = order([{ name: "Square sunglasses in tort with smoke lens", qty: 1, unit: 550 }, { name: "Skinny chino shorts in navy", qty: 1, unit: 1700 }, { name: "Logo t-shirt in mid grey marl", qty: 1, unit: 1400 }],
      { fees: [["Delivery", 495]] });
    const rowsHtml = `<table width="100%"><tr><td><img src="https://www.threadly.example/a.jpg" alt=""></td><td></td><td>Square sunglasses in tort with smoke lens</td></tr><tr><td colspan="3">&pound;5.50 &pound;8.00</td></tr><tr><td colspan="3">Brown / No Size / Qty 1</td></tr>` +
      `<tr><td><img src="https://www.threadly.example/b.jpg" alt=""></td><td></td><td>Skinny chino shorts in navy</td></tr><tr><td colspan="3">&pound;17.00</td></tr><tr><td colspan="3">Navy / W34 / Qty 1</td></tr>` +
      `<tr><td><img src="https://www.threadly.example/c.jpg" alt=""></td><td></td><td>Logo t-shirt in mid grey marl</td></tr><tr><td colspan="3">&pound;14.00 &pound;30.00</td></tr><tr><td colspan="3">Mid grey heather / L / Qty 1</td></tr></table>`;
    add("holdout16e-empty-cells-slash-facts-qty", "Threadly", "each item a row of two empty cells (its picture) then its name; '£5.50 £8.00' (sale, then the old price); 'Brown / No Size / Qty 1'; 'Subtotal', 'Delivery', 'Total'", {
      from: "Threadly <order@threadly.example>", subject: "Thanks for your order!", date: "Fri, 13 Nov 2026 12:00:00 +0000",
      html: page({ brand: "Threadly", domain: "threadly.example", rows: [rows(["Order No.: 648812345", "Delivery method: Next Day Delivery"]), rowsHtml, rows(["Subtotal || £36.50", "Delivery || £4.95", "Total || £41.45"])] }) },
      o, "Threadly", "2026-11-13", { orderRef: "648812345" });
  }
  // ---- A fashion shop's order whose text part sets the number in bold and runs the money lines into one, then its
  // despatch email with the same items and total (not in the corpus as a purchase of its own: it joins the order) -----------
  {
    const o = order([{ name: "Tan suede chelsea boots", qty: 1, unit: 4500 }], { fees: [["Next day delivery", 500]] });
    const body = (head) => ({
      text: `${head}\n\nOrder number: *55120378* Estimated delivery: *Tuesday, 17 Nov*\nDelivery address\nSam Taylor, 12 Example Road, Leeds, LS1 4AB Delivery type Next day\nYour items in this order\nTan suede chelsea boots\nSize: 9 (UK) £45.00\nSubtotal (excl. promo) £45.00 Next day delivery £5.00 Total paid £50.00\nPayment methods ****1234 Visa £50.00\n`,
      html: mail("Rivermode", "rivermode.example", [head, "Order number: 55120378", "Estimated delivery: Tuesday, 17 Nov", "Delivery type", "Next day", "Your items in this order", "Tan suede chelsea boots", "Size: 9 (UK)", "Qty: 1", "£45.00",
        "Subtotal (excl. promo)", "£45.00", "Next day delivery", "£5.00", "Total paid", "£50.00"]) });
    add("holdout16e-bold-number-runon-money", "Rivermode", "text part 'Order number: *55120378*' (bold) and 'Subtotal (excl. promo) £45.00 Next day delivery £5.00 Total paid £50.00' on one line; the HTML part one line each", {
      from: "Rivermode <noreply@rivermode.example>", subject: "Order Confirmation", date: "Mon, 16 Nov 2026 19:00:00 +0000", ...body("Thanks for your order! We'll let you know when it's on its way to you.") },
      o, "Rivermode", "2026-11-16", { orderRef: "55120378" });
    out.push(fixture("holdout16e-bold-number-despatch", "Rivermode", "subject 'Despatch Confirmation'; the order's own layout again with 'your order has been despatched'", {
      from: "Rivermode <noreply@rivermode.example>", subject: "Despatch Confirmation", date: "Tue, 17 Nov 2026 08:00:00 +0000", ...body("Get excited because your order has been despatched.") },
      expected("Rivermode", "2026-11-17", o, { orderRef: "55120378" })));
  }
  // ---- A gift experience shop's order: "Order Summary (#…)", each experience its name, its code in brackets and its price,
  // then a "download your evoucher" button --------------------------------------------------------------------------------
  {
    const o = order([{ name: "One Night Woodland Cabin Break, Peak District", qty: 1, unit: 6200 }, { name: "Jazz Brunch for Two", qty: 1, unit: 3450 }]);
    add("holdout16e-experience-code-voucher-button", "Daysout Gifts", "'Order Summary (#7712093)'; each experience its name, '( WCAB12 )' its code, '£62.00', then 'download your evoucher'; 'Sub Total | £96.50', 'Email Delivery with E-Voucher | £0.00', 'Total | £96.50'", {
      from: "Daysout Gifts <orders@daysoutgifts.example>", subject: "Thanks for your order!", date: "Sun, 15 Nov 2026 10:00:00 +0000",
      html: nested("Daysout Gifts", "daysoutgifts.example", ["Thanks for your order Your Daysout Gifts purchase was a success", "your order!", "Order Summary (#7712093)", "Ordered: 15/11/2026",
        "One Night Woodland Cabin Break, Peak District", "( WCAB12 )", "£62.00", "download your evoucher", "Jazz Brunch for Two", "( PJAZ2 SP1 )", "£34.50", "download your evoucher",
        "Sub Total || £96.50", "Email Delivery with E-Voucher || £0.00", "Total || £96.50"]) },
      o, "Daysout Gifts", "2026-11-15", { orderRef: "7712093" });
  }
  return out;
}
