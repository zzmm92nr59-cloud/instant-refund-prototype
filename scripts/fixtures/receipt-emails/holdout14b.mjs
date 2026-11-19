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
  // ---- A pub chain's app: each drink's measure in brackets under its name, a promotion taken off --------------------------
  {
    const o = order([{ name: "Harbour Lager (Pint)", qty: 1, unit: 345 }, { name: "Smoky Bean Burrito", qty: 1, unit: 425 }, { name: "Spiced Rum (Double Mixer)", qty: 1, unit: 390 }], { discounts: [["Promotion Applied", 150]] });
    add("holdout14b-pub-app-measures", "The Tankard Group", "'Qty | Description | Amount'; '1 | <b>Harbour Lager</b> (Pint) | £3.45'; 'Promotion Applied | -£1.50'", {
      from: "The Tankard Group <orders@tankardgroup.example>", subject: "The Tankard Group Order Confirmation: 4410", date: "Mon, 16 Nov 2026 19:00:00 +0000",
      html: page({ brand: "The Tankard Group", domain: "tankardgroup.example", rows: ["<p>Thank you for your order...</p><p>Order Id: <b>612004411</b><br/>Order Date: Monday, November 16, 2026<br/>Table Number: 12</p>",
        `<table border="1"><tr><td>Qty</td><td>Description</td><td>Amount</td></tr><tr><td>1</td><td><strong>Harbour Lager</strong>\n(Pint)</td><td align="right">£3.45</td></tr><tr><td>1</td><td><strong>Smoky Bean Burrito</strong></td><td align="right">£4.25</td></tr><tr><td>1</td><td><strong>Promotion Applied</strong></td><td align="right">-£1.50</td></tr><tr><td>1</td><td><strong>Spiced Rum</strong>\n(Double Mixer)</td><td align="right">£3.90</td></tr><tr><td colspan="2">Payment Type</td><td>Apple Pay</td></tr><tr><td colspan="2"><strong>Order Total</strong></td><td><strong>£10.10</strong></td></tr></table>`] }) }, o, "The Tankard Group", "2026-11-16");
  }
  // ---- A rail booking: two tickets of the same type, each named by its own leg, and the booking fee its own line ------------
  {
    const o = order([{ name: "Hilltown to Midvale", qty: 1, unit: 1210 }, { name: "Midvale to Riverside Quay", qty: 1, unit: 640 }, { name: "Booking fee", qty: 1, unit: 150 }]);
    add("holdout14b-rail-same-type-legs-fee", "RailHop", "'Advance Single' over each leg; two 'Adult - Advance Single - [Railcard]' lines; 'Other costs', 'Booking Fee', '£1.50'", {
      from: "RailHop <auto-confirm@railhop.example>", subject: "Your booking confirmation for Hilltown to Riverside Quay (2 December at 08:10)", date: "Mon, 16 Nov 2026 08:00:00 +0000",
      html: mail("RailHop", "railhop.example", ["Your trip to Riverside Quay departing Wednesday 2 December 2026 is confirmed", "Advance Single", "Hilltown to Midvale", "Stay on the same train", "Advance Single", "Midvale to Riverside Quay",
        "2x Advance Single", "Specified train only. No refunds.", "Payment information", "Transaction ID:", "700112233445", "Fare details |", "Adult - Advance Single - [Coach Railcard]", "£12.10", "Adult - Advance Single - [Coach Railcard]", "£6.40",
        "Other costs |", "Booking Fee", "£1.50", "Total amount: | £20.00 |"]) }, o, "RailHop", "2026-11-16");
  }
  // ---- A digital railcard bought from a rail site: the railcard under "Fare details", "No booking fee" --------------------
  {
    const o = order([{ name: "16-25 Railcard", qty: 1, unit: 3500 }]);
    add("holdout14b-digital-railcard", "RailHop", "'Fare details |' over '16-25 Railcard' over '£35.00'; 'Other costs |', 'Booking Fee', 'No booking fee'", {
      from: "RailHop <auto-confirm@railhop.example>", subject: "Your digital railcard purchase is complete. Transaction Id 700998877665", date: "Tue, 17 Nov 2026 08:00:00 +0000",
      html: mail("RailHop", "railhop.example", ["Your digital 16-25 Railcard is ready to use in the app", "Sam Taylor", "Payment information", "Transaction ID:", "700998877665", "Fare details |", "16-25 Railcard", "£35.00",
        "Other costs |", "Booking Fee", "No booking fee", "Total amount: | £35.00 |"]) }, o, "RailHop", "2026-11-17");
  }
  // ---- A sports shop: the product's name over its code, prices written "58.00 GBP", "1 ITEMS" ------------------------------
  {
    const o = order([{ name: "Ridgeline Daypack 28L Navy One Size", qty: 1, unit: 4200 }], { fees: [["Delivery", 399]] });
    add("holdout14b-sports-code-gbp", "Fieldsport Direct", "'Item | Qty | Price'; the name over 'Product Code: 112233/18/000'; '1'; '42.00 GBP'; '1 ITEMS'", {
      from: "Fieldsport Direct <noreply@fieldsportdirect.example>", subject: "Your Fieldsport Direct order confirmation FS4000099887766", date: "Tue, 17 Nov 2026 12:00:00 +0000",
      html: mail("Fieldsport Direct", "fieldsportdirect.example", ["Thank you for your order", "Order number: FS4000099887766", "Item", "Qty", "Price", "Ridgeline Daypack 28L Navy One Size", "Product Code: 112233/18/000", "1", "42.00 GBP",
        "1 ITEMS", "42.00 GBP", "DELIVERY", "(Standard)", "3.99 GBP", "TOTAL", "45.99 GBP", "Prices in £ include VAT"]) }, o, "Fieldsport Direct", "2026-11-17");
  }
  // ---- A takeaway app: options under each item, then "1 |" and the next item of the same name -------------------------------
  {
    const o = order([{ name: "Chilli Sauce Pot", qty: 2, unit: 70 }, { name: "Mixed Grill Wrap", qty: 1, unit: 1150, extras: ["Large", "On Its Own", "Extra Chilli"] }, { name: "Mixed Grill Wrap", qty: 1, unit: 1150, extras: ["Large", "On Its Own"] }]);
    add("holdout14b-takeaway-same-item-twice", "Just Eat", "'1 |' over 'Mixed Grill Wrap |' over '| £9.50 |'; '| Large |', '| £2.00 |'; '| On Its Own |'; '| + | Extra Chilli |'; then the same item again", {
      from: "Just Eat <noreply@t.just-eat.co.uk>", subject: "Your order's been received", date: "Wed, 18 Nov 2026 20:00:00 +0000",
      html: mail("Just Eat", "just-eat.co.uk", ["Great news! Kebab Corner - Riverside has received your order.", "Order number: | 990011223 |", "Kebab Corner - Riverside", "2 | Chilli Sauce Pot", " | £1.40", "1", "Mixed Grill Wrap", " | £9.50", " | Large", " | £2.00", " | On Its Own", " | ", " | + | Extra Chilli",
        "1", "Mixed Grill Wrap", " | £9.50", " | Large", " | £2.00", " | On Its Own", " | ", "Subtotal: | £24.40", "Total: | £24.40"]) }, o, "Just Eat", "2026-11-18", { merchant: "Kebab Corner - Riverside" });
  }
  // ---- A pizza chain: an old price struck through beside the price paid, "Qty: 1" under it, a product's own number -------------
  {
    const o = order([{ name: "16 Chicken Bites", qty: 1, unit: 899 }, { name: "Garlic Dip", qty: 1, unit: 79 }], { fees: [["Delivery", 249]] });
    add("holdout14b-pizza-struck-prices", "Pizzapoint", "'16 Chicken Bites' over '£8.99' and a struck '£14.99', 'Qty: 1'; 'Total:' over a struck '£22.27' and '£12.27'", {
      from: "Pizzapoint <orders@pizzapoint.example>", subject: "Pizzapoint Order Confirmation", date: "Wed, 18 Nov 2026 18:00:00 +0000",
      html: page({ brand: "Pizzapoint", domain: "pizzapoint.example", rows: ["<p>Order number: 2203344556</p>", "<p>16 Chicken Bites</p><p>£8.99</p><p><span style=\"text-decoration: line-through\">£14.99</span></p><p>Qty: 1</p>",
        "<p>Garlic Dip</p><p>£0.79</p><p>Qty: 1</p>", "<p>Delivery:</p><p>£2.49</p>", "<p>Total:</p><p><span style=\"text-decoration: line-through\">£22.27</span></p><p>£12.27</p>"] }) }, o, "Pizzapoint", "2026-11-18");
  }
  // ---- A pizza chain's older layout: what was ordered with no prices, only the total ------------------------------------------
  {
    const o = order([{ name: "Large Smoky Ranch", qty: 1, unit: null, extras: ["Thin Crust"] }, { name: "Potato Wedges", qty: 1, unit: null }]);
    o.total = 2398; for (const i of o.bought) i.line = null;
    add("holdout14b-pizza-unpriced-list", "Pizzapoint", "'1x Large Smoky Ranch', '+ Thin Crust', '1x Potato Wedges', a deal line, 'Delivery: £1.99', '£23.98 (Including VAT)'", {
      from: "Pizzapoint <orders@pizzapoint.example>", subject: "Pizzapoint Order Confirmation", date: "Wed, 18 Nov 2026 19:00:00 +0000",
      html: mail("Pizzapoint", "pizzapoint.example", ["Order number: 2203344557", "Get excited for your", "1x Large Smoky Ranch", "+ Thin Crust", "1x Potato Wedges", "1x 30% off when you spend £30 or more online", "Delivery: £1.99", "£23.98 (Including VAT)"]) }, o, "Pizzapoint", "2026-11-18");
  }
  return out;
}
