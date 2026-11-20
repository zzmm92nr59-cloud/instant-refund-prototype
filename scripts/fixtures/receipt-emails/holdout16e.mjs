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
  return out;
}
