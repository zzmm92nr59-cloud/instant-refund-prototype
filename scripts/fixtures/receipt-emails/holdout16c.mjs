// A nineteenth set of made-up emails (see lib.mjs), round 15c (20 Nov 2026): layouts of emails in Connor's own inbox that
// blind checks found Relay still reading wrong, written again with everything in them made up (shops, items, prices,
// people, numbers). scripts/test-receipt-corpus.mjs reads them as purchases, and joins the later emails to their orders.
import { order, expected, page, fixture, h } from "./lib.mjs";

const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${l.split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });

// (Not in the corpus: an email with an order's number and no money, from the company that runs the tests for the board,
// which joins the board's invoice for that number.)
export const EXAM_APPOINTMENT = fixture("holdout16c-exam-appointment-only-number", "Examhall", "subject 'Theory Test - Order Confirmation Email'; 'Appointment Details'; 'Order Number: | 0071-4410-2290 |'; no money anywhere", {
    from: "Examhall <confirmation@examhall.example>", subject: "Theory Test - Order Confirmation Email", date: "Mon, 09 Nov 2026 10:04:30 +0000",
    text: "Theory Test - Appointment Confirmation\nPlease get to the test centre 15 minutes before your appointment time.\n| Appointment Details |\n| Order Number: | 0071-4410-2290 |\n| Person Taking Test: | SAM TAYLOR |\n| Test Booked: | Car |\n| Date: | 03 December 2026 |\n| Start Time: | 02:15 PM |\n" },
    { orderRef: "0071-4410-2290" });

export default function holdout16c() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  const not = (id, sender, layout, m, kind, extra = {}) => { const f = fixture(id, sender, layout, m, { notPurchase: { kind, ...extra } }); out.push(f); return f; };
  const grocer = "Hartley's Grocers <service@hartleysgrocers.example>";

  // ---- A grocer's order confirmation: the number in the cell after "Order number:", an estimated total -------------------
  {
    const o = order([{ name: "Hartley's Greek Feta 200g", qty: 2, unit: 290 }, { name: "Hartley's Black Beans 400g", qty: 3, unit: 49 }, { name: "Hartley's Free Range Eggs x12", qty: 1, unit: 315 }]);
    add("holdout16c-grocer-thanks-number-cell", "Hartley's Grocers", "subject 'Thanks for your order 772104518' (no dash); 'Order number: | 772104518 |'; 'Estimated total: | £10.42* |'; each item a row of name, quantity and price cells over 'Substitution allowed'; 'Right to return goods' under it: 'we'll send you a refund within 5 working days', 'within 14 days starting from the day after the date of delivery', a '30 day goodwill returns policy'", {
      from: grocer, subject: "Thanks for your order 772104518", date: "Fri, 13 Nov 2026 20:23:18 +0000",
      html: mail("Hartley's Grocers", "hartleysgrocers.example", ["Here's your order confirmation, Sam", "We've got your order", "Order number: | 772104518 |", "Estimated total: | £10.42* |",
        "*Your total is an estimate due to products sold by weight and the possibility of substituted items.", "Slot date: Sunday 15th November, 1:00pm to 5:00pm",
        "Your items (3 items)", "Items | Quantity | Price |", "Hartley's Greek Feta 200g | 2 | £5.80", "Substitution allowed",
        "Hartley's Black Beans 400g | 3 | £1.47", "Substitution allowed", "Hartley's Free Range Eggs x12 | 1 | £3.15", "Substitution allowed",
        "Your order summary", "Estimated total | £10.42", "Right to return goods",
        "If you aren't happy with any of your items, hand it back to us and we'll send you a refund within 5 working days.",
        "The Consumer Contracts Regulations 2013 give you the right to return most goods bought online without giving a reason within 14 days starting from the day after the date of delivery.",
        "Hartley's offers a 30 day goodwill returns policy and goods which are not returned at the time of delivery should be returned in a new saleable condition with your receipt to any Hartley's store within 30 days."]) },
      o, "Hartley's Grocers", "2026-11-13", { orderRef: "772104518" });
  }
  // ---- The grocer's final receipt for the same order: its number in the subject, the items only in a PDF ------------------
  {
    const o = order([{ name: "Hartley's Greek Feta 200g", qty: 2, unit: 290 }, { name: "Hartley's Black Beans 400g", qty: 3, unit: 49 }, { name: "Hartley's Free Range Eggs x12", qty: 1, unit: 315 }], { fees: [["Delivery", 100]] });
    add("holdout16c-grocer-final-receipt", "Hartley's Grocers", "subject 'Receipt for your Hartley’s order 772104518'; 'Your order is ready for today'; 'Payment received: | £11.42 |'; no item list (the receipt is attached)", {
      from: grocer, subject: "Receipt for your Hartley’s order 772104518", date: "Sun, 15 Nov 2026 08:00:20 +0000",
      html: mail("Hartley's Grocers", "hartleysgrocers.example", ["Your order is ready for today", "Order number: 772104518", "Payment received: | £11.42 |", "Your receipt is attached to this email."]) },
      { ...o, bought: [] }, "Hartley's Grocers", "2026-11-15", { orderRef: "772104518", partial: true });
  }
  // ---- The grocer's cancellation: the order's number only at the end of the subject ---------------------------------------
  not("holdout16c-grocer-cancelled-subject-number", "Hartley's Grocers", "subject 'Your order has been cancelled 772104518'; 'Your order has been cancelled and you won't be charged'; no number in the body", {
    from: grocer, subject: "Your order has been cancelled 772104518", date: "Sat, 14 Nov 2026 11:11:22 +0000",
    text: "Hartley's Grocers\n\nYour order has been cancelled, Sam\n\nWHAT YOU NEED TO KNOW\n\nYOUR ORDER HAS BEEN CANCELLED AND YOU WON'T BE CHARGED\n\nIf we've already taken payment for this order, we'll refund\nit within 3 to 5 working days. You don't need to do anything\nelse at this time.\n" }, "cancelled", { orderRef: "772104518" });
  // ---- An item name with the shop's windows-1252 apostrophe sent inside UTF-8 as U+0092 -----------------------------------
  {
    const o = order([{ name: "By Hartley’s Ripe Avocado", qty: 2, unit: 65 }, { name: "Hartley's Chicken Mince 500g", qty: 1, unit: 300 }]);
    const f = add("holdout16c-grocer-c1-apostrophe", "Hartley's Grocers", "an item 'By Hartley\\u0092s Ripe Avocado' (the shop's 0x92 apostrophe sent in UTF-8 as the control character U+0092)", {
      from: grocer, subject: "Thanks for your order - 772555301", date: "Mon, 16 Nov 2026 19:00:00 +0000",
      html: mail("Hartley's Grocers", "hartleysgrocers.example", ["Order number: | 772555301 |", "Items | Quantity | Price |", "By Hartley\u0092s Ripe Avocado | 2 | £1.30", "Hartley's Chicken Mince 500g | 1 | £3.00", "Estimated total: | £4.30 |"]) },
      o, "Hartley's Grocers", "2026-11-16", { orderRef: "772555301" });
    f.html = f.html.replace(/By Hartley(?:&rsquo;|’)s/, "By Hartley\u0092s");
  }
  // ---- An exam board's invoice: its number in the cell after "Invoice Number:"; the appointment email has only the number --
  {
    const o = order([{ name: "Theory Test Car", qty: 1, unit: 2300 }]);
    add("holdout16c-exam-invoice-number-cell", "Testwise", "subject 'Driving Test Board Confirmation of Payment'; 'This is an invoice for your order'; 'Invoice Number: |' over '0071-4410-2290 |'; the item 'Theory Test Car | £23.00'; 'Total | £23.00'", {
      from: "Testwise <confirmation@testwise.example>", subject: "Driving Test Board Confirmation of Payment", date: "Mon, 09 Nov 2026 10:04:00 +0000",
      html: mail("Testwise", "testwise.example", ["This is an invoice for your order and should be kept as your receipt.", "INVOICE", "Invoice Number: |", "\u200e0071-4410-2290\u200e |",
        "Transaction Date: | 09 November 2026 10:04", "Description | Amount", "Theory Test Car | £23.00", "Total | £23.00"]) },
      o, "Testwise", "2026-11-09", { orderRef: "0071-4410-2290" });
  }
  // ---- An airline's booking: the airports' codes alone in a row of cells under their names, a booking code of letters -----
  {
    // (Round 18: its "Fees | 26.40 EUR" line is the fees, the flight what is left, as the email sets them out.)
    const o = order([{ name: "Flight London Gatwick to Barcelona", qty: 1, unit: 3810 }], { fees: [["Fees", 2640]] });
    const f = add("holdout16c-airline-codes-in-cells", "Flyvia", "subject 'Your booking confirmation - QWMZRT LGW-BCN 12 December'; 'Booking code QWMZRT'; 'London (Gatwick) | Barcelona (T1)' over '| LGW | BCN |'; '1 adult | 38.10 EUR', '1 rear seat | 0.00 EUR', 'Fees | 26.40 EUR', 'Total: 64.50 EUR'", {
      from: "Flyvia Airlines <no-reply@flyvia.example>", subject: "Your booking confirmation - QWMZRT LGW-BCN 12 December", date: "Tue, 10 Nov 2026 09:00:00 +0000",
      text: "| Booking code QWMZRT |\n| Outbound | |\n| Saturday, 12 December 2026 |\n| London (Gatwick) (TS) | Barcelona (T1) |\n| LGW | BCN |\n| 07:20h | 10:35h |\n| VY6012 |\n| Passengers and services |\n| 1 adult | 38.10 EUR |\n| 1 rear seat | 0.00 EUR |\n| Fees | 26.40 EUR |\n| Total: 64.50 EUR |\n| Status: | | Confirmed |\n" },
      o, "Flyvia Airlines", "2026-11-10", { orderRef: "QWMZRT" });
    f.expected.currency = "EUR";
  }
  // ---- A hotel's online check-in: the room and what was paid, for a stay booked elsewhere --------------------------------
  not("holdout16c-hotel-online-check-in", "Harbour Hotels", "subject 'Online Check In Confirmation - Quayside Hotel'; 'You did it! You completed your online check-in service.'; 'Double Room | £189.00', 'Total | £189.00', 'Paid Already | £189.00'", {
    from: "Harbour Hotels <noreply@harbourhotels.example>", subject: "Online Check In Confirmation - Quayside Hotel", date: "Fri, 06 Nov 2026 19:02:20 +0000",
    text: "| Check-In Sat 07 Nov 2pm |\n| Check-Out Sun 08 Nov 11am |\n| Confirmation No. 400118273 |\n| Hello Sam Taylor, |\n| You did it! You completed your online check-in service. Safe travels! |\n| Double Room | Checked-In |\n| Double Room | £189.00 |\n| Total | £189.00 |\n| Paid Already | £189.00 |\n| Balance Due | £0.00 |\n" }, "check_in");
  // ---- A race ballot: everything pre-authorised, nothing paid ------------------------------------------------------------
  not("holdout16c-ballot-pre-authorised", "Racedays", "subject 'Your Payment Receipt'; '1x Ballot Entry (Pre-authorised) £40.00', '1x Booking Fee (Pre-authorised) £2.00', 'Total Pre-authorised £42.00', 'Total paid today £0.00'", {
    from: "Racedays <hello@info.racedays.example>", subject: "Your Payment Receipt", date: "Thu, 05 Nov 2026 21:03:39 +0000",
    text: "Your\nreceipt\n\n1x Ballot Entry - November Ballot Entry (Pre-authorised)\n£40.00\n\n1x Booking Fee (Pre-authorised)\n£2.00\n\nTotal Pre-authorised\n£42.00\n\nCity Half Marathon 2027 Ballot - 1x Training Plan Free Trial\n£0.00\n\nTotal paid today\n£0.00\n\nPayment\nReference 6a7ee826c31fc5c2239742aa\n" }, "pre_authorised");
  // ---- A ticket seller's payment summary: tickets, per-ticket fees "£4.40 (Service Charge …) x2", a handling fee ---------
  {
    const o = order([{ name: "Comedy Night: The Big Tour", qty: 2, unit: 3500 }, { name: "Service Charge Full Price Ticket", qty: 2, unit: 410 }, { name: "Facility Charge Full Price Ticket", qty: 2, unit: 200 }, { name: "Handling Fee", qty: 1, unit: 275 }]);
    add("holdout16c-tickets-payment-summary", "Ticketline", "'Order #44-10293/UK1' over the event's name; '2x' 'Print-at-Home' 'View Tickets'; 'Payment Summary', '2 Full Price Ticket' over '£35.00 x2', '£70.00', 'Per Item Fees', '£4.10 (Service Charge Full Price Ticket) x2', '£2.00 (Facility Charge Full Price Ticket) x2', 'Order Processing Fees', 'Handling Fee (£2.75)', 'Total | £84.95'; 'does not issue refunds after purchase'", {
      from: "Ticketline <customer_support@email.ticketline.example>", subject: "You're in! Your Ticketline Order Confirmation", date: "Mon, 02 Nov 2026 18:00:00 +0000",
      html: mail("Ticketline", "ticketline.example", ["Sam, You're In!", "Order #44-10293/UK1", "Comedy Night: The Big Tour", "City Arena, Leeds", "Fri 8 Jan 2027 @ 8:00 pm", "Your Order", "2x", "Print-at-Home", "View Tickets", "Full Price Ticket",
        "Payment Summary", "2 Full Price Ticket", "£35.00 x2", "£70.00", "Per Item Fees", "£4.10 (Service Charge Full Price Ticket) x2", "£2.00 (Facility Charge Full Price Ticket) x2", "£12.20", "Order Processing Fees", "Handling Fee (£2.75)", "£2.75", "Total", "£84.95",
        "Ticketline does not issue refunds after purchase as set out in our Purchase Policy."]) },
      o, "Ticketline", "2026-11-02", { orderRef: "44-10293" });
  }
  // ---- A ticket seller's plain text: "ORDER DETAILS", the event, "Seats, Full Price Ticket: 2 x £ 30.00 = £ 60.00" --------
  {
    const o = order([{ name: "Brass Night: Live", qty: 2, unit: 2800 }, { name: "Booking fee", qty: 2, unit: 350 }, { name: "Venue Levy", qty: 2, unit: 100 }, { name: "Processing fee", qty: 1, unit: 150 }, { name: "Delivery/transaction costs", qty: 1, unit: 250 }]);
    add("holdout16c-tickets-order-details-text", "Eventix", "plain text only: 'ORDER DETAILS', the event's name, 'Date:', 'Venue:', 'Seats, Full Price Ticket: 2 x £ 28.00 = £ 56.00', 'Booking fee: 2 x £ 3.50 = £ 7.00', 'Venue Levy: 2 x £ 1.00 = £ 2.00', 'Subtotal: £ 65.00', 'Processing fee: £ 1.50', 'Delivery/transaction costs: £ 2.50', 'Total incl. VAT: £ 69.00'", {
      from: "Eventix <noreply@eventix.example>", subject: "Your order 1061999123", date: "Sat, 07 Nov 2026 10:00:00 +0000",
      text: "Thank you for your order\nOrder number: 1061999123\nOrder total: £ 69.00\nORDER DETAILS\nBrass Night: Live\nDate: Thu., 04/03/2027, 19:30\nVenue: Town Hall, Leeds\nSeats, Full Price Ticket: 2 x £ 28.00 = £ 56.00\nEntrance STALLS, Row J, Seat 33\nBooking fee: 2 x £ 3.50 = £ 7.00\nVenue Levy: 2 x £ 1.00 = £ 2.00\n------------------\nSubtotal: £ 65.00\n==================\nTOTAL\nProcessing fee: £ 1.50\nDelivery/transaction costs: £ 2.50\n------------------\nTotal incl. VAT: £ 69.00\n" },
      o, "Eventix", "2026-11-07", { orderRef: "1061999123" });
  }
  // ---- A shop's set of three sold as one, "3 x 100ml Travel Bottles × 1", and "Order ABC12345 confirmed" -------------------
  {
    const o = order([{ name: "3 x 100ml Travel Bottles", qty: 1, unit: 1995 }], { fees: [["Shipping", 299]] });
    add("holdout16c-shop-set-of-three", "Atomise", "subject 'Order ATM40112 confirmed'; 'Order summary'; '3 x 100ml Travel Bottles × 1' then '£19.95'; 'Shipping | £2.99'; 'Total | £22.94 GBP'", {
      from: "Atomise <store@atomise.example>", subject: "Order ATM40112 confirmed", date: "Wed, 04 Nov 2026 12:00:00 +0000",
      html: mail("Atomise", "atomise.example", ["Thank you for your purchase!", "Order ATM40112", "Order summary", "3 x 100ml Travel Bottles × 1 | £19.95", "Subtotal | £19.95", "Shipping | £2.99", "Total | £22.94 GBP"]) },
      o, "Atomise", "2026-11-04", { orderRef: "ATM40112" });
  }
  // ---- A burger app's receipt: a meal deal's title with its price first, the choice under it; the restaurant by label -----
  {
    const o = order([{ name: "Crispy Chicken Wrap", qty: 1, unit: 199 }, { name: "Small Fries", qty: 1, unit: 129 }, { name: "9 Chicken Bites", qty: 1, unit: 149 }]);
    add("holdout16c-burger-app-deal-title", "Burgerworks", "'Order Number:' over '034'; 'Restaurant Name:' over 'Riverside - Mill Lane'; 'Qty | Item Detail | Item Cost'; '1 | £1.49 9 Chicken Bites or 4 Veggie Bites' over 'When ordering on the Burgerworks app' with no price, then '1 | 9 Chicken Bites | £1.49' and '1 | Dip Pot' with none; 'Total (including VAT): | £4.77'", {
      from: "Burgerworks App <noreply@burgerworks.example>", subject: "Thanks for your order!", date: "Sun, 08 Nov 2026 14:32:00 +0000",
      html: mail("Burgerworks", "burgerworks.example", ["Here's the receipt for your order, Sam", "Order Date:", "08/11/26 14:32", "Order Number:", "034", "Restaurant Name:", "Riverside - Mill Lane",
        "Qty | Item Detail | Item Cost", "1 | Crispy Chicken Wrap | £1.99", "1 | Small Fries | £1.29", "1 | £1.49 9 Chicken Bites or 4 Veggie Bites", "When ordering on the Burgerworks app", "1 | 9 Chicken Bites | £1.49", "1 | Dip Pot |",
        "VAT: | £0.80", "Total (including VAT): | £4.77"]) },
      o, "Burgerworks", "2026-11-08", { orderRef: "034", merchant: "Riverside - Mill Lane" });
  }
  // ---- A shirtmaker's order: "Sub-total", "Delivery charge", "VAT", then "Order total [Incl. VAT]" in square brackets -----
  {
    const o = order([{ name: "Navy Leather Trainer", qty: 1, unit: 7995 }, { name: "Slim Fit Stone Chinos", qty: 1, unit: 6396 }], { fees: [["Delivery charge", 495]] });
    add("holdout16c-total-square-brackets", "Hartwell Shirts", "'Order Total' heading; 'Sub-total | £143.91'; 'Delivery charge | £4.95'; 'VAT | £24.81'; 'Order total [Incl. VAT] | £148.86'", {
      from: "Hartwell Shirts <orders@hartwellshirts.example>", subject: "Thank you for your order", date: "Thu, 05 Nov 2026 09:00:00 +0000",
      html: mail("Hartwell Shirts", "hartwellshirts.example", ["Order number: WUK20044123", "Navy Leather Trainer | In Stock | £79.95", "Slim Fit Stone Chinos | In Stock | £63.96", "Order Total", "Sub-total | £143.91", "Delivery charge | £4.95", "VAT | £24.81", "Order total [Incl. VAT] | £148.86"]) },
      o, "Hartwell Shirts", "2026-11-05", { orderRef: "WUK20044123" });
  }
  // ---- A theatre ticket site: "Order total – Paid", a voucher row "Vouchers | 1 | £-50.00", "Venue Dispatch" at £0.00 ------
  {
    const o = order([{ name: "The Starlight Express Revival", qty: 2, unit: 4500 }], { discounts: [["Vouchers", 5000]] });
    add("holdout16c-theatre-total-paid-dash", "Stagedoor Tickets", "'Tickets are non-refundable per our terms and conditions.'; 'Order summary', 'Item | Quantity | Total', the show over 'Seats in Stalls', '2 |', '£90.00 |'; 'Vouchers |' '1 |' '£-50.00 |'; 'Venue Dispatch' '£0.00'; 'Order total – Paid |' '£40.00'", {
      from: "Stagedoor Tickets <noreply@stagedoortickets.example>", subject: "Booking confirmation - Order KLM48211", date: "Tue, 03 Nov 2026 20:00:00 +0000",
      html: mail("Stagedoor Tickets", "stagedoortickets.example", ["Booking reference KLM48211", "IMPORTANT INFORMATION", "Tickets are non-refundable per our terms and conditions.", "Order summary", "Item | Quantity | Total",
        "The Starlight Express Revival", "Seats in Stalls", "2", "£90.00", "Vouchers", "1", "£-50.00", "Venue Dispatch", "£0.00", "Order total – Paid", "£40.00"]) },
      o, "Stagedoor Tickets", "2026-11-03", { orderRef: "KLM48211" });
  }
  // ---- A sports-nutrition shop: "Quantity" over "1", "Price" over "£20.00" under each name; free gifts priced and taken off --
  {
    // (Round 18: the gift the email lists as a line of the order is listed, free, at £0.00: what the offer took off is its worth.)
    const o = order([{ name: "Whey Isolate - 1kg - Vanilla", qty: 1, unit: 2000 }, { name: "Protein Bar - 12 x 60g - Salted Caramel", qty: 1, unit: 1500 }, { name: "Free Recipe Box", qty: 1, unit: 0 }], { discounts: [["You've saved up to 60%", 200]] });
    add("holdout16c-gifts-priced-and-taken-off", "Liftwell", "each item's name over 'Quantity' / '1' and 'Price' / '£20.00'; 'Free Recipe Box' priced '£5.00' (a gift, listed free); 'Offers Used:' 'You've saved up to 60%' '- £2.00', 'Up to 60% off almost everything, plus FREE delivery!' '- £3.99', '3 FREE gifts on all orders' '- £5.00'; 'Delivery:' '£0.00'; 'Total Cost:' '£33.00'", {
      from: "Liftwell <orders@liftwell.example>", subject: "Your Liftwell order confirmation", date: "Sat, 31 Oct 2026 07:40:00 +0000",
      html: mail("Liftwell", "liftwell.example", ["Thanks for your order", "Order number: 491223376", "Whey Isolate - 1kg - Vanilla", "Quantity", "1", "Price", "£20.00", "Protein Bar - 12 x 60g - Salted Caramel", "Quantity", "1", "Price", "£15.00",
        "Free Recipe Box", "Quantity", "1", "Price", "£5.00", "Offers Used:", "You've saved up to 60%", "- £2.00", "Up to 60% off almost everything, plus FREE delivery!", "- £3.99", "3 FREE gifts on all orders", "- £5.00", "Delivery:", "£0.00", "Total Cost:", "£33.00"]) },
      o, "Liftwell", "2026-10-31", { orderRef: "491223376" });
  }
  // ---- A second-hand shop's plain-text emails: "Item:", "Quantity:", "Unit Price:"; a receipt by "receipt :N"; its refund ----
  {
    const o = order([{ name: "Games Console, 1TB, Black, Unboxed", qty: 1, unit: 12000 }], { fees: [["Item Delivery Charge", 295]] });
    add("holdout16c-labelled-fields-order", "SwapShop", "plain text only: 'Your Order Number is: 20440312'; 'Item: Games Console, 1TB, Black, Unboxed', 'Category:', 'Quantity: 1', 'Unit Price: £120.00', 'Item Delivery Charge: £2.95'; 'Order Total £122.95(1)'", {
      from: "SwapShop <no_reply@swapshop.example>", subject: "SwapShop order confirmation: 20440312", date: "Fri, 06 Nov 2026 15:55:27 +0000",
      text: "Thank you for purchasing from SwapShop.\n\nDetails of your order are listed below:\n\n=========================================\nYour Order Number is: 20440312\n=========================================\n\nItem: Games Console, 1TB, Black, Unboxed\nCategory: Consoles\nQuantity: 1\nUnit Price: £120.00\nItem Delivery Charge: £2.95\n\n-----------------------------------------\nTotal Shipping Cost: £2.95\n-----------------------------------------\nPayment Details:\nApple Pay: £122.95\n\n=========================================\nOrder Total £122.95(1)\n=========================================\n" },
      o, "SwapShop", "2026-11-06", { orderRef: "20440312" });
  }
  {
    const o = order([{ name: "Handheld Console, 64GB, Grey, Boxed", qty: 1, unit: 9500 }]);
    add("holdout16c-receipt-colon-number", "SwapShop", "subject 'SwapShop receipt :20440999'; 'Your order has now been collected'; '| Item: | Handheld Console … |', '| Quantity: | 1 |', '| Unit Price: | £95 |'; 'Order Total: £95 (1)'", {
      from: "SwapShop <no_reply@swapshop.example>", subject: "SwapShop receipt :20440999", date: "Sat, 07 Nov 2026 12:00:00 +0000",
      text: " Your order has now been collected, thank you for purchasing from SwapShop.\nDetails of your collected order are listed below:\n=========================================\nYour Order Number is: 20440999\n=========================================\n| Item: | Handheld Console, 64GB, Grey, Boxed |\n| Category: | Handheld Consoles |\n| Quantity: | 1 |\n| Unit Price: | £95 |\n-----------------------------------------\nPayment Details:\nApple Pay\n£95.00\n=========================================\nOrder Total: £95 (1)\n" },
      o, "SwapShop", "2026-11-07", { orderRef: "20440999" });
  }
  not("holdout16c-refund-total-amount-refunded", "SwapShop", "subject 'Refund for your SwapShop order 20440312'; 'We have now sent you a refund for item(s)'; 'Your refund order number is: 20440312'; 'Refund Value: £120.00', 'Item Delivery Charge Refund Amount:£2.95', 'Total Amount Refunded: £122.95'", {
    from: "SwapShop <no_reply@swapshop.example>", subject: "Refund for your SwapShop order 20440312", date: "Sun, 08 Nov 2026 10:00:00 +0000",
    text: "Hi Sam Taylor\nWe have now sent you a refund for item(s) you had ordered from us.\n=========================================\nYour refund order number is: 20440312\nRefund payment method: Apple Pay\n============== Item(s) Refunded =============\nItem Name: Games Console, 1TB, Black, Unboxed\nRefund Value: £120.00\nItem Delivery Charge Refund Amount:£2.95\n\nTotal Amount Refunded: £122.95\nThe refund will be returned to your original payment method.\n" }, "refund", { refundPence: 12295, orderRef: "20440312" });
  // ---- A restaurant's order email with a subject that says nothing ("We're on it!") ---------------------------------------
  {
    const o = order([{ name: "1/4 Chicken", qty: 1, unit: 990 }, { name: "Spicy Rice", qty: 1, unit: 395 }]);
    add("holdout16c-restaurant-subject-silent", "Peri House", "subject 'We’re on it!'; 'Peri House Riverside - Table 12'; 'Thanks for your order, we’re just prepping it now.'; 'Here’s what we’re cooking up for order #7a1c09'; '1 | 1/4 Chicken | £9.90', '1 | Spicy Rice | £3.95'; 'Total | £13.85'", {
      from: "Peri House <noreply@perihouse.example>", subject: "We’re on it!", date: "Wed, 04 Nov 2026 12:43:00 +0000",
      html: mail("Peri House", "perihouse.example", ["Peri House Riverside - Table 12", "Thanks for your order, we’re just prepping it now.", "Here’s what we’re cooking up for order #7a1c09", "04th Nov 2026 | Ordered at 12:43pm", "1 | 1/4 Chicken | £9.90", "1 | Spicy Rice | £3.95", "Total | £13.85"]) },
      o, "Peri House", "2026-11-04", { orderRef: "7a1c09" });
  }
  // ---- A class booking: "Your booking reference is: KQWZT", "4 x Throw a pot @ £40.00", no total ---------------------------
  {
    const o = order([{ name: "Throw a pot like a pro", qty: 4, unit: 4000 }]);
    const f = add("holdout16c-booking-at-price-no-total", "Clayworks Studio", "plain text: 'Your booking reference is: KQWZT'; 'Booking details:'; '4 x Throw a pot like a pro @ £40.00' and four names; no total", {
      from: "Clayworks Studio <mail@bookings.example>", subject: "Booking confirmation. Ref: KQWZT", date: "Sat, 14 Nov 2026 09:00:00 +0000",
      text: "Your booking reference is: KQWZT\n\nYou can access your booking using the link below.\n\nBooking details:\n\nADULT CLASS - Throw a pot like a pro\nClayworks, Mill Lane, Leeds, LS1 4AB\n  Sat 21 Nov, 10:00am - 1:00pm\n    4 x Throw a pot like a pro @ £40.00\n    sam taylor\n    alex taylor\n    jo taylor\n    kim taylor\n" },
      o, "Clayworks Studio", "2026-11-14", { orderRef: "KQWZT" });
    // (Round 19: with no total, no "Amount paid" and no deposit anywhere, what was booked is what it cost: £160.00. It was
    // null before.)
  }
  // ---- A coach company: "GBR 22.89", "Reservation summary for order QWZRTYP", the journey "From:" and "To:" -----------------
  {
    const o = order([{ name: "Leeds to London", qty: 1, unit: 1899 }], { fees: [["Booking Fee", 100]] });
    add("holdout16c-coach-gbr-amounts", "Coachline", "plain text: 'Reservation summary for order QWZRTYP'; 'Reservation Number' over '43-6840-031223-M22N-1335-LDS-LON-1'; 'From: Leeds, Bus Station (1:35 PM)', 'To: London, Victoria Coach Station (5:00 PM)'; 'Ticket Price: GBR 18.99', 'Booking Fee: GBR 1.00', 'Total Paid: GBR 19.99'", {
      from: "Coachline <support@coachline.example>", subject: "From Coachline Ltd: Your reservations have been made", date: "Mon, 09 Nov 2026 09:00:00 +0000",
      text: "Valued Coachline Customer,\nThank you for making a reservation with Coachline. This email confirms your purchase.\nReservation summary for order QWZRTYP\nReservation Number\n 43-6840-031223-M22N-1335-LDS-LON-1\nDate:December 3, 2026\nFrom: Leeds, Bus Station (1:35 PM)\nTo: London, Victoria Coach Station (5:00 PM)\nPassengers: 1 Standard\nCost and Payment Summary\nTicket Price: GBR 18.99\nBooking Fee: GBR 1.00\nTotal Paid: GBR 19.99\n" },
      o, "Coachline", "2026-11-09", { orderRef: "QWZRTYP" });
  }
  // ---- A delivery app's plain text: "1x    Name  - £11.95" (a dash before each price), a credit, a service fee ---------------
  {
    const o = order([{ name: "The Club Wrap", qty: 1, unit: 1095 }, { name: "Truffle Fries", qty: 1, unit: 450 }], { fees: [["Service fee", 82]], discounts: [["Credit", 400]] });
    add("holdout16c-delivery-dash-prices", "Rooride", "plain text only: 'Order #5821'; '1x    The Club Wrap  - £10.95', '1x    Truffle Fries  - £4.50'; 'Subtotal £15.45', 'Delivery fee Free', 'Service fee £0.82', 'Credit -£4.00', 'Total £12.27'", {
      from: "Rooride <noreply@rooride.example>", subject: "Your order's in the kitchen", date: "Thu, 12 Nov 2026 19:00:00 +0000",
      text: "Here's your receipt\nOrder #5821\n  ---------------------\n\n  1x    The Club Wrap  - £10.95\n  1x    Truffle Fries  - £4.50\n\n  Subtotal               £15.45\n  Delivery fee           Free\n  Service fee            £0.82\n  Credit                 -£4.00\n  Total                  £12.27\n" },
      o, "Rooride", "2026-11-12", { orderRef: "5821" });
  }
  // ---- A takeaway's code: "PIZZA20" / "20% discount first order only", the subtotal already after it --------------------------
  {
    const o = order([{ name: "Large Margherita", qty: 1, unit: 1295 }, { name: "Cola (can)", qty: 1, unit: 200 }], { discounts: [["20% discount first order only", 299]] });
    add("holdout16c-percent-code-no-amount", "Slice Street", "'1 x | Large Margherita | £12.95'; '1 x | Cola (can) | £2.00'; 'PIZZA20' over '20% discount first order only' with no amount; 'Subtotal | £11.96' (the old subtotal struck through, gone from the text); 'Total | £11.96'", {
      from: "Slice Street <orders@slicestreet.example>", subject: "Slice Street: Order #7QKAQK accepted", date: "Fri, 13 Nov 2026 18:30:00 +0000",
      html: mail("Slice Street", "slicestreet.example", ["Your order 7QKAQK has been accepted by Slice Street and is being prepared.", "1 x | Large Margherita | £12.95", "1 x | Cola (can) | £2.00", "PIZZA20", "20% discount first order only", "Subtotal | £11.96", "Total | £11.96"]) },
      o, "Slice Street", "2026-11-13", { orderRef: "7QKAQK" });
  }
  // ---- A mattress maker: "you also have the right to cancel your order within 14 days from receipt of the goods" -------------
  {
    const o = order([{ name: "Cloudrest Medium Mattress (King Size)", qty: 1, unit: 69900 }]);
    add("holdout16c-right-to-cancel-from-receipt", "Restwell", "'Order number: 5180999123'; 'Cloudrest Medium Mattress (King Size) | 1 | £699.00'; 'Total | £699.00'; 'Where this does not apply, you also have the right to cancel your order within 14 days from receipt of the goods.'", {
      from: "Restwell <orders@restwell.example>", subject: "Your Restwell order confirmation", date: "Tue, 10 Nov 2026 10:00:00 +0000",
      html: mail("Restwell", "restwell.example", ["Order number: 5180999123", "Cloudrest Medium Mattress (King Size) | 1 | £699.00", "Total | £699.00", "Selected items may include an extended home trial period. Where this does not apply, you also have the right to cancel your order within 14 days from receipt of the goods."]) },
      o, "Restwell", "2026-11-10", { orderRef: "5180999123" });
  }
  // ---- A homeware shop: "30-Day Return" over "Within 30-Day Of Delivery"; a card page's "Merchant Reference:" ----------------
  {
    const o = order([{ name: "Arched Floor Mirror", qty: 1, unit: 8999 }]);
    add("holdout16c-window-start-apart", "Homeloft", "'Order: UKB2507301203130001'; '30-Day Return' over 'Within 30-Day Of Delivery'; 'Arched Floor Mirror | 1 | £89.99'; 'Total | £89.99'", {
      from: "Homeloft <service@homeloft.example>", subject: "Thanks for your order", date: "Wed, 11 Nov 2026 10:00:00 +0000",
      html: mail("Homeloft", "homeloft.example", ["Order number: UKB2507301203130001", "30-Day Return", "Within 30-Day Of Delivery", "Arched Floor Mirror | 1 | £89.99", "Total | £89.99"]) },
      o, "Homeloft", "2026-11-11", { orderRef: "UKB2507301203130001" });
  }
  {
    const o = order([{ name: "Credits", qty: 1, unit: 1120 }]);
    add("holdout16c-merchant-reference", "Payzone Pages", "subject 'Payment Confirmation'; 'Merchant Reference: 9f2d1340-3ad7-4d8d-9352-1c48ea195b11'; 'Credits | £11.20'; 'Total | £11.20'", {
      from: "Payzone Pages <receipts@payzonepages.example>", subject: "Payment Confirmation", date: "Thu, 12 Nov 2026 10:00:00 +0000",
      html: mail("Payzone Pages", "payzonepages.example", ["Thank you for your payment", "Merchant Reference: 9f2d1340-3ad7-4d8d-9352-1c48ea195b11", "Credits | £11.20", "Total | £11.20"]) },
      o, "Payzone Pages", "2026-11-12", { orderRef: "9f2d1340-3ad7-4d8d-9352-1c48ea195b11" });
  }
  return out;
}
