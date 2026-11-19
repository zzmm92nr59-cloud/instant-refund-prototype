// A sixteenth set of made-up emails (see lib.mjs), round 13b (19 Nov 2026): the layouts of receipts in Connor's own inbox
// that blind checks found Relay missing or reading wrong (takeaway apps through a hidden address, a pub's order-and-pay
// app, a restaurant's bill, a card payment page, a test booked through an agency, a scooter ride abroad, a pub's list that
// puts how many above each name), written again with everything in them made up (shops, apps, venues, items, prices,
// people, numbers).
import { order, expected, page, fixture, h } from "./lib.mjs";

// Rows as the real emails had them: each line its own row, " | " between the cells of one row.
const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${l.split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });
// Each cell its own paragraph inside its own little table, as an email builder nests them: no cell edges in the text.
const nested = (cells) => `<table role="presentation" width="100%"><tr>${cells.map((c) => `<td><table width="100%"><tr><td><div><p style="margin:0">${h(c)}</p></div></td></tr></table></td>`).join("")}</tr></table>`;

export default function holdout14b() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };

  // ---- A takeaway app's order sent through a hidden address: "Your order's in the kitchen", account credit off the total --
  {
    const o = order([{ name: "The Big Club", qty: 1, unit: 1095 }, { name: "Rosemary Salt Fries", qty: 1, unit: 395 }], { fees: [["Service fee", 75]], discounts: [["Credit", 300]] });
    add("holdout14b-takeaway-hidden-address", "Dishdrop", "From a hidden-address relay; subject 'Your order's in the kitchen'; '1x' over the name over its price; Credit under the fees", {
      from: "Dishdrop <noreply_at_dishdrop_example_ab12cd34ef_9f8e7d6c@privaterelay.appleid.com>", subject: "Your order’s in the kitchen", date: "Sat, 7 Nov 2026 19:10:00 +0000",
      html: mail("Dishdrop", "dishdrop.example", ["Hillside Grill has your order!", "Great choice", "Hillside Grill", "12 Market Row", "Here's your receipt", "Order ID #5531",
        "1x", "The Big Club", "£10.95", "1x", "Rosemary Salt Fries", "£3.95", "Subtotal", "£14.90", "Delivery fee", "Free", "Service fee", "£0.75", "Credit", "£3.00", "Total", "£12.65",
        "Your Dishdrop order ID is 5531."]) }, o, "Dishdrop", "2026-11-07");
  }
  // ---- A pub's order-and-pay app: "Your bill has been paid: #…", how many, the drink, its price ------------------------------
  {
    const o = order([{ name: "Harbour Spiced Rum", qty: 1, unit: 520 }, { name: "Cola Zero", qty: 1, unit: 170 }, { name: "Juniper Gin", qty: 1, unit: 610 }]);
    add("holdout14b-pub-bill-paid", "Taproom Pay", "subject 'Your bill has been paid: #…'; 'Total paid' first; '1 | Name | £5.20' rows; Subtotal, Total, VAT included", {
      from: "Taproom Pay <no-reply@pepperhq.com>", subject: "Your bill has been paid: #20417733", date: "Sun, 8 Nov 2026 16:05:00 +0000",
      html: mail("Taproom Pay", "taproompay.example", ["Hello Sam,", "Thanks for visiting The Anchor Rooms and using Taproom Pay.", "Total paid: £13.00", "Here is your receipt:",
        "The Anchor Rooms", "1 | Harbour Spiced Rum | £5.20", "1 | Cola Zero | £1.70", "1 | Juniper Gin | £6.10", "Subtotal | £13.00", "Total | £13.00", "Vat included in total | £2.17", "APPLEPAY | £13.00"]) }, o, "Taproom Pay", "2026-11-08");
  }
  // ---- A restaurant's bill paid by phone: "<name> receipt", loose heading lines over the item rows, net total before VAT ----
  {
    const o = order([{ name: "jasmine tea", qty: 1, unit: 0 }, { name: "katsu curry", qty: 1, unit: 1395 }, { name: "miso soup", qty: 1, unit: 450 }]);
    add("holdout14b-restaurant-bill-net-total", "noodlehaus", "subject 'noodlehaus receipt'; 'restaurant', its branch, 'table', '#88' as loose lines; 'name | x1 | £13.95' rows; net total, v.a.t, bill total", {
      from: "noodlehaus <noreply@noodlehaus.example>", subject: "noodlehaus receipt", date: "Tue, 10 Nov 2026 13:30:00 +0000",
      html: page({ brand: "noodlehaus", domain: "noodlehaus.example", rows: ["<h1>your receipt</h1><p>thanks for visiting noodlehaus riverside and paying online</p>",
        "<h2>restaurant</h2><p>riverside</p>", "<h2>table</h2><p>#88</p>", "<h2>items</h2>",
        rows(["jasmine tea", "x1", "£0.00", "katsu curry", "x1", "£13.95", "miso soup", "x1", "£4.50"]), rows(["total items", "x3"]),
        rows(["net total", "£15.38", "v.a.t", "£3.07", "bill total", "£18.45"])] }) }, o, "noodlehaus", "2026-11-10");
  }
  // ---- A card payment page's receipt for a fee: the organisation named only in the subject, "Amount: GBP 60.00" --------------
  {
    const o = order([]);
    o.total = 6000;
    add("holdout14b-payment-page-fee", "Consulate of Examplia", "a card payment page's 'APPROVED: Payment transaction for your order … at <organisation>'; 'Amount: GBP 60.00'", {
      from: "do-not-reply@ipg-online.com", subject: "APPROVED: Payment transaction for your order Q771204 Sam Taylor at Consulate of Examplia", date: "Wed, 11 Nov 2026 10:00:00 +0000",
      html: `<html><body><pre>Dear applicant,\nWe just wanted to let you know about your recent payment status.</pre><p><b>Consulate of Examplia</b><br/>London W1 1AA</p><pre>Order : <b>Q771204 Sam Taylor</b>\nPayment Transaction Result: <b>APPROVED</b>\nDate and Time: 11-Nov-2026 10:00:01\nAmount: GBP <b>60.00</b>\nTotal amount to Cardholder: <b>60.00 GBP</b>\nTransaction type: Sale</pre></body></html>` }, o, "Consulate of Examplia", "2026-11-11");
  }
  // ---- A test booked through the agency that runs the bookings: "<BODY> Confirmation of Payment", amounts with "GBP" beside -----
  {
    const o = order([{ name: "Theory test", qty: 1, unit: 3100 }]);
    add("holdout14b-agency-payment-gbp-cells", "Examtest", "'TLA Confirmation of Payment' from the agency's address with no name; an invoice table with '31.00 |' over 'GBP |'", {
      from: "ExamtestConfirmation@examtest.example", subject: "TLA Confirmation of Payment", date: "Thu, 12 Nov 2026 09:00:00 +0000",
      html: `<html><body><p><b>This is an invoice for your order and should be kept as your receipt.</b></p><table border="1"><tr><th>Quantity</th><th>Description</th><th>Unit Price</th><th colspan="2">Amount</th></tr>
<tr><td>1</td><td>Theory test<br/>Appointment: 3 December 2026 10:30 AM</td><td>31.00</td><td>31.00</td><td>GBP</td></tr>
<tr><td colspan="2">Subtotal</td><td>31.00</td><td>GBP</td></tr><tr><td colspan="2">Tax</td><td>0.00</td><td>GBP</td></tr><tr><td colspan="2">Total</td><td>31.00</td><td>GBP</td></tr></table>
<p>Payment Number: 550012345</p></body></html>` }, o, "TLA", "2026-11-12");
  }
  // ---- A scooter ride abroad, in złoty: the total kept as written, never turned into pounds ---------------------------------
  {
    const o = order([]);
    o.total = 2214;
    add("holdout14b-scooter-ride-zloty", "Zoomr", "'Receipt for your Zoomr ride'; unlock and per-minute fares in zł; 'Total (excl. VAT)' then 'Total (incl. VAT)'", {
      from: "Zoomr <no-reply@zoomr.example>", subject: "Receipt for your Zoomr ride", date: "Fri, 13 Nov 2026 21:00:00 +0000",
      html: mail("Zoomr", "zoomr.example", ["Thanks for riding with Zoomr", "Unlock fee", "3.00 zł", "Per minute fare (24 min)", "19.14 zł", "Total (excl. VAT)", "18.00 zł", "VAT", "4.14 zł", "Total (incl. VAT)", "22.14 zł", "Charged to Visa •••• 4242", "22.14 zł"]) },
      o, "Zoomr", "2026-11-13", { currency: "PLN" });
  }
  // ---- A pub's list with how many above each name: a product's own number in its name, options with no price under it ------
  {
    const o = order([{ name: "6 Crispy Squid Rings", qty: 1, unit: 425, extras: ["Skin-on Fries", "Garden Peas"] }, { name: "Mini Cheeseburger", qty: 1, unit: 425, extras: ["Skin-on Fries"] },
      { name: "Onion Rings", qty: 1, unit: 40 }, { name: "Apple Juice", qty: 2, unit: 145 }, { name: "Pale Ale", qty: 1, unit: 495 }], { discounts: [["Discounts", 120]] });
    add("holdout14b-pub-qty-above-options", "The Crown Taverns", "'1' over '6 Crispy Squid Rings' over '£4.25'; '1' over 'Skin-on Fries' with no price (an option); Discounts", {
      from: "The Crown Taverns <orders@crowntaverns.example>", subject: "Your Crown Taverns order confirmation", date: "Sat, 14 Nov 2026 18:40:00 +0000",
      html: page({ brand: "The Crown Taverns", domain: "crowntaverns.example", rows: ["<p>Thank you for your order</p><p>Order ID: 900112233445566</p><p>Order Date: Saturday, November 14, 2026</p>", "<p>Order Summary</p>",
        nested(["1", "6 Crispy Squid Rings", "£4.25"]), nested(["1", "Skin-on Fries", ""]), nested(["1", "Garden Peas", ""]),
        nested(["1", "Mini Cheeseburger", "£4.25"]), nested(["1", "Skin-on Fries", ""]), nested(["1", "Onion Rings", "£0.40"]),
        nested(["2", "Apple Juice", "£2.90"]), nested(["1", "Pale Ale", "£4.95"]), "<p>Discounts</p><p>-£1.20</p>", "<p>Total</p><p>£15.55</p>"] }) }, o, "The Crown Taverns", "2026-11-14");
  }
  // ---- A burger chain's app receipt: "1" over "9 Chicken Bites Box" over its price ----------------------------------------
  {
    const o = order([{ name: "9 Chicken Bites Box", qty: 1, unit: 399 }, { name: "Small Lemonade", qty: 1, unit: 149 }], { discounts: [["Discount", 80]] });
    add("holdout14b-burger-app-numbered-name", "Bunhouse", "'Qty | Item Detail | Item Cost' heading cells; '1' over '9 Chicken Bites Box' over '£3.99'; a promotion line with no price; Discount", {
      from: "BunhouseApp@bunhouse.example", subject: "Thanks for your order!", date: "Sun, 15 Nov 2026 12:15:00 +0000",
      html: page({ brand: "Bunhouse", domain: "bunhouse.example", rows: ["<p>Here's the receipt for your order, sam</p><p>Order Date: 15/11/26 12:15</p><p>Order Number: 4417</p>",
        nested(["Qty", "Item Detail", "Item Cost"]), nested(["1", "Get 20% Off! Make it a good day.", ""]), nested(["1", "9 Chicken Bites Box", "£3.99"]), nested(["1", "Small Lemonade", "£1.49"]),
        nested(["", "Discount:", "-£0.80"]), nested(["", "Total (including VAT):", "£4.68"])] }) }, o, "Bunhouse", "2026-11-15");
  }
  return out;
}
