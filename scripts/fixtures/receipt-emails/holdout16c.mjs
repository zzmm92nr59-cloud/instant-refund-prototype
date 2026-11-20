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
    const o = order([{ name: "Flight London Gatwick to Barcelona", qty: 1, unit: 6450 }]);
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
  return out;
}
