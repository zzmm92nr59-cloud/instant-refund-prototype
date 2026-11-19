// A thirteenth set of made-up emails (see lib.mjs), round 11 (19 Nov 2026): the layouts of the receipts in Connor's own inbox
// that four blind checks found Relay reading wrong, written again with everything in them made up (shops, items, prices,
// people, addresses, order numbers). Just Eat keeps its name (the reader goes by its wording); every other shop is invented.
import { order, expected, page, fixture, gbp, h, SHOPPER } from "./lib.mjs";

// Rows as the real emails had them: each line its own row, " | " between the cells of one row.
const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${l.split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });

export default function holdout12() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  const not = (id, sender, layout, m, notPurchase) => out.push(fixture(id, sender, layout, m, { notPurchase, items: [], shop: null, date: null, currency: null, totalPence: null }));

  // ---- Just Eat: the order number under "Your order number is:", and the cancellation that names it --------------------------
  {
    const o = order([{ name: "Garlic Bread", qty: 1, unit: 250 }, { name: "Large Margherita", qty: 1, unit: 1399 }], { fees: [["Delivery", 199]] });
    add("holdout12-je-order-number-under-label", "Just Eat", "'Your order number is: |' with the number on the row under it", { from: "Just Eat <no-reply@order.just-eat.co.uk>", subject: "Sam, order confirmed", date: "Fri, 11 Sep 2026 20:11:00 +0000",
      html: mail("Just Eat", "just-eat.co.uk", ["Your order's been received", "Great news! Napoli Corner has received your order.", "Track your order", "Your order number is:", "771200341", "Napoli Corner",
        "1 | Garlic Bread", "£2.50", "1 | Large Margherita", "£13.99", "Subtotal: | £16.49", "Delivery: | £1.99", "Total: | £18.48"]) }, o, "Just Eat", "2026-09-11", { merchant: "Napoli Corner" });
    not("holdout12-je-cancelled", "Just Eat", "'Cancelled: order number …', 'You have successfully cancelled order number …'", { from: "Just Eat <no-reply@order.just-eat.co.uk>", subject: "Cancelled: order number 771200341", date: "Fri, 11 Sep 2026 20:12:00 +0000",
      html: mail("Just Eat", "just-eat.co.uk", ["Order cancelled", "You have successfully cancelled order number 771200341 .", "If you have been charged there will be no refund for this order.", "Order now"]) }, { kind: "cancellation" });
  }
  // ---- A furniture shop: "Order:" over its number, a month-first date, addresses with a phone and a postcode, a full-width
  // pound sign, and a plain-text part whose whole product block is one link written over several lines -------------------------
  {
    const o = order([{ name: "1200mm Round Oak Dining Table With Pedestal Base", qty: 1, unit: 54999 }], { discounts: [["Coupon Discount", 4000]] });
    const lines = ["Thanks for your order!", "Dear", `${SHOPPER.name},`, "Your payment has been received.", "Order:", "LWH2609120911554", "Order Date:", "Sep 12, 2026 09:11 am", "Shipping Address:", `${SHOPPER.name} 7700900123`,
      "LS1 4AB, 12 Example Road, Leeds, England, GB,LS1 4AB", "Billing Address", `${SHOPPER.name} 7700900123`, "LS1 4AB, 12 Example Road, Leeds, England, GB,LS1 4AB",
      "1200mm Round Oak Dining Table With Pedestal Base", "￡549.99", "Color:Natural", "Qty:1", "Subtotal: ￡549.99", "Coupon Discount: -￡40.00", "Grand Total: ￡509.99"];
    const text = ["Thanks for your order!", "Order:", "LWH2609120911554", "Order Date:", "Sep 12, 2026 09:11 am", "Shipping Address:", `${SHOPPER.name} 7700900123`, "LS1 4AB, 12 Example Road, Leeds, England, GB,LS1 4AB",
      "[1200mm Round Oak Dining Table With Pedestal Base", "￡549.99", "Color:Natural", "Qty:1](https://www.larkwood-home.example/item/round-oak-table-1200.html?pos=OrderProduct)",
      "Subtotal:￡549.99", "Coupon Discount:-￡40.00", "Grand Total:￡509.99"].join("\n");
    add("holdout12-furniture-order-label", "Larkwood Home", "'Order:' over its number, 'Sep 12, 2026 09:11 am', addresses, ￡, a link over the product block in the text part", { from: "Larkwood Home <service@larkwood-home.example>",
      subject: "We've received your payment and your order is under processing.", date: "Sat, 12 Sep 2026 09:12:00 +0000", html: mail("Larkwood Home", "larkwood-home.example", lines), text }, o, "Larkwood Home", "2026-09-12");
    not("holdout12-furniture-cancelled-no-number", "Larkwood Home", "'Your order was canceled.' with no order number, the product block under it", { from: "Larkwood Home <service@larkwood-home.example>", subject: "Your order was canceled.", date: "Mon, 21 Sep 2026 06:30:00 +0000",
      html: mail("Larkwood Home", "larkwood-home.example", ["Dear ,", "Your order was canceled.", "Any coupons used were returned to your account.", "1200mm Round Oak Dining Table With Pedestal Base", "Natural", "X1", "Yours sincerely"]) }, { kind: "cancellation" });
  }
  // ---- A paint shop from mainland Europe: the order number only in the subject, amounts without the pence they don't need ----
  {
    const o = order([{ name: "LINVA Sea Mist", qty: 1, unit: 8950, extras: ["5L"] }, { name: "LINVA Fern Hollow", qty: 1, unit: 3200, extras: ["2L"] }], { fees: [["Shipping", 1500]] });
    const text = ["[Studio]\tORDER NVP-4kq8m2xt", "", "Thank you for your purchase!", "", "Order summary", "", "LINVA Sea Mist 5L, x 1\t89.5 GBP LINVA Fern Hollow 2L, x 1\t32 GBP",
      "Subtotal incl. VAT\t121.5 GBP Shipping\t15 GBP", "VAT\t0 GBP", "Total\t136.5 GBP"].join("\n");
    add("holdout12-paints-no-pence", "Nordvik Paints", "'Order Info - NVP-…' subject; '89.5 GBP', '32 GBP' (no pence where they're nought)", { from: "Nordvik Paints <web@order.nordvik-paints.example>", subject: "Order Info - NVP-4kq8m2xt", date: "Thu, 30 Jul 2026 10:10:00 +0000",
      html: mail("Nordvik Paints", "nordvik-paints.example", ["ORDER NVP-4kq8m2xt", "Thank you for your purchase!", "We confirm we have received your order.", "Order summary", "LINVA Sea Mist", "5L, x 1", "89.5 GBP", "LINVA Fern Hollow", "2L, x 1", "32 GBP",
        "Subtotal incl. VAT | 121.5 GBP", "Shipping | 15 GBP", "VAT | 0 GBP", "Total | 136.5 GBP"]), text }, o, "Nordvik Paints", "2026-07-30", { totalPence: 13650 });
  }
  // ---- A coffee club: the subject names the shop's website, sections in the plural over their first item ----------------------
  {
    const o = order([{ name: "Toasted Pecan", qty: 10, unit: 79 }, { name: "Dark Cocoa", qty: 10, unit: 79 }, { name: "Morning Lungo", qty: 10, unit: 69 }]);
    add("holdout12-coffee-sections", "Brewhaus", "'Your order on www.brewhaus.example'; 'Capsules' over the first, '10 x £0.79' then the line", { from: "Brewhaus <club@brewhaus.example>", subject: "BREWHAUS Club: Your order on www.brewhaus.example", date: "Wed, 14 Oct 2026 16:51:00 +0000",
      html: mail("Brewhaus", "brewhaus.example", ["Order Confirmation", `Dear ${SHOPPER.name} ,`, "We are pleased to confirm that we've received your order and it is now being processed.", "Delivery address", "Standard Delivery", "Payment method", "Credit Card", "£22.70",
        "Order details", "Capsules", "Toasted Pecan", "10 x £0.79", "£7.90", "Dark Cocoa", "10 x £0.79", "£7.90", "Morning Lungo", "10 x £0.69", "£6.90", "Subtotal", "£22.70", "Total", "£22.70"]) }, o, "Brewhaus", "2026-10-14");
  }
  // ---- A mattress shop: "size:" and "Product code:" on lines of their own over their values --------------------------------------
  {
    const o = order([{ name: "CLOUDREST Firm (Double)", qty: 1, unit: 61900 }, { name: "CLOUDREST Cooling Pillow", qty: 1, unit: 0 }]);
    add("holdout12-mattress-labels", "Slumberline", "'size:' over '135x190 cm [Double]', 'Product code:' over the code, '1 x' over the price", { from: "Slumberline <noreply@slumberline.example>", subject: "Your SLUMBERLINE Order Confirmation", date: "Wed, 29 Jul 2026 11:28:00 +0000",
      html: mail("Slumberline", "slumberline.example", ["Order Summary", "7/29/2026 12:25:46 PM", "Order number: 6620419935", "CLOUDREST Firm (Double)", "IN STOCK DELIVERY 14-28 DAYS", "size:", "135x190 cm [Double]", "Product code:", "SLX83120652", "1 x", "£619.00",
        "CLOUDREST Cooling Pillow", "IN STOCK DELIVERY 3-5 DAYS", "size:", "Standard", "Product code:", "SLX73016374", "1 x", "£0.00", "Order Total", "Subtotal £515.83", "Tax £103.17", "Total Price £619.00"]) }, o, "Slumberline", "2026-07-29", { totalPence: 61900 });
  }
  // ---- A rug shop from Sweden: pence after a comma, "PPU:" for the price each, the code and quantity in a row of their own ------
  {
    const o = order([{ name: "Linen cushion cover 45 x 45 cm", qty: 2, unit: 1350 }, { name: "Jute rug - Dalby (natural) (Size: 120 x 170 cm)", qty: 1, unit: 8999 }]);
    add("holdout12-rugs-comma-pence", "Rugsmith", "'£ 13,50'; 'PPU: £ 13,50'; '| cushion.lin45 | 2 |' row under each item", { from: "Rugsmith <info@rugsmith.example>", subject: "Thank you for your order! | RSM5502714", date: "Thu, 30 Jul 2026 09:52:00 +0000",
      html: mail("Rugsmith", "rugsmith.example", ["Thank you for your order!", "Order Number: RSM5502714", "Order date: 2026-07-30 11:51:08", "Item", "Article no.", "Quantity", "Unit price", "Sub total",
        "Linen cushion cover 45 x 45 cm", "Art no: cushion.lin45", "Quantity: 2", "PPU: £ 13,50", " | cushion.lin45 | 2 | ", "£ 13,50", "£ 27,00 |",
        "Jute rug - Dalby (natural) (Size: 120 x 170 cm)", "Art no: JUTE.DB120.170.NT", "Quantity: 1", "PPU: £ 89,99", " | JUTE.DB120.170.NT | 1 | ", "£ 89,99", "£ 89,99 |", "Sub total", "£ 116,99", "Shipping and handling", "£ 0", "Total", "£ 116,99"]) },
      o, "Rugsmith", "2026-07-30");
  }
  // ---- A software company's receipt through Stripe in dollars, the VAT also shown in pounds in brackets --------------------------
  add("holdout12-stripe-dollars", "Quillbase", "'$60.00', 'VAT - United Kingdom (20%) $10.00 (£7.38)'; no kind of dollar named", { from: "\"Quillbase Inc.\" <invoice+statements+acct_9@stripe.com>", subject: "Your receipt from Quillbase Inc. #4102-2433-0153", date: "Wed, 09 Sep 2026 14:29:00 +0000",
    html: mail("Quillbase Inc.", "stripe.com", ["Receipt from Quillbase Inc.", "$60.00", "Paid September 9, 2026", "Receipt number", "4102-2433-0153", "Receipt #4102-2433-0153", "Sep 9, 2026 – Sep 9, 2027", "Writer plan", "Qty 1", "$50.00", "Subtotal", "$50.00",
      "Total excluding tax", "$50.00", "VAT - United Kingdom (20%)", "$10.00", "(£7.38)", "Total", "$60.00", "Amount paid", "$60.00"]) },
    { bought: [{ name: "Writer plan", qty: 1, line: 5000 }], subtotal: 5000, feeSum: 0, discSum: 0, tipSum: 0, total: 6000 }, "Quillbase", "2026-09-09", { totalPence: 6000, currency: "USD", shopAlso: ["Quillbase Inc"] });
  // ---- A bar's order-and-pay app: "Your payment #…" --------------------------------------------------------------------------------
  {
    const o = order([{ name: "Pint of Copper Pale", qty: 1, unit: 685 }, { name: "Pint of Copper Pale", qty: 1, unit: 685 }]);
    add("holdout12-bar-your-payment", "Copper Tap", "subject 'Your payment #48812207'; 'Total paid: £13.70'; 'Order ID:'", { from: "Copper Tap <no-reply@orderpay.example>", subject: "Your payment #48812207", date: "Wed, 10 Sep 2026 19:30:00 +0000",
      html: mail("Copper Tap", "orderpay.example", ["Hello,", "Thanks for visiting Copper Tap Shoreditch and ordering with us.", "Total paid: £13.70", "Here is your receipt:", "Order ID: 48812207", "Order Placed: 10/09/2026 20:30",
        "1 | Pint of Copper Pale | £6.85", "1 | Pint of Copper Pale | £6.85", "Subtotal | £13.70", "Total | £13.70", "Vat included in total | £2.28"]) }, o, "Copper Tap", "2026-09-10", { shopAlso: ["Orderpay"] });
  }
  // ---- A site's "Payment receipt" naming only the amount, "11.2 GBP" -----------------------------------------------------------
  add("holdout12-payment-receipt-amount", "Hostly", "'Payment receipt for …'; 'Amount: 11.2 GBP' and nothing else", { from: "Hostly <no-reply@hostly.example>", subject: "Payment receipt for samt Reference - 0a1b2c3d", date: "Sat, 01 Aug 2026 01:25:00 +0000",
    text: ["Dear samt", "", "Thank you for your recent purchase at Hostly.example. Below are the details of your transaction.", "", "Date: 08/01/2026 02:24:08", "Amount: 11.2 GBP", "Transaction ID: 0c97-made-up", "", "The Hostly Team"].join("\n") },
    order([]), "Hostly", "2026-08-01", { totalPence: 1120 });
  // ---- A prize draw: a list of name-over-price blocks, one without "x 1", a discount code -------------------------------------------
  {
    const o = order([{ name: "Weekly Draw", qty: 1, unit: 500, extras: ["100 Entries"] }, { name: "Prize Booster", qty: 1, unit: 500 }, { name: "Monthly Mega Draw", qty: 1, unit: 0, extras: ["100 Entries"] }, { name: "Prizefold Subscription", qty: 1, unit: 1500, extras: ["100 Entries"] }],
      { discounts: [["Discount/Bonus", 500]] });
    add("holdout12-draw-list-discount", "Prizefold", "'Prize Booster' over '£5.00' between items that say '100 Entries x 1'; '– £5.00' discount", { from: "Prizefold UK <team@prizefold.example>", subject: "Prizefold House Draw Entry Confirmation", date: "Sun, 05 Oct 2026 20:51:00 +0000",
      html: mail("Prizefold", "prizefold.example", ["Thank you for your order!", "Your Order Summary:", "Weekly Draw", "100 Entries x 1", "£5.00", "Prize Booster", "£5.00", "Monthly Mega Draw", "100 Entries x 1", "£0.00", "Prizefold Subscription", "100 Entries x 1", "£15.00",
        "Discount/Bonus :", "PF1F5T6RXKM3", "– £5.00", "TOTAL :", "£20.00 GBP", "Payment Method : Mastercard"]) }, o, "Prizefold", "2026-10-05");
  }
  // ---- A train's on-board shop: "Order number: |" over "#ab12cd", a deal named by its price ------------------------------------------
  {
    const o = order([{ name: "Any 2 Soft Drinks for £4.00", qty: 1, unit: 400 }]);
    add("holdout12-train-deal-name", "Railside", "'#a7k2qp' under its label; '1 x Any 2 Soft Drinks for £4.00 |' then '£4.00 |'", { from: "Railside on board <onboard@railside.example>", subject: "Your Online-Service order has been Confirmed #a7k2qp", date: "Mon, 06 Oct 2026 16:30:00 +0000",
      html: mail("Railside", "railside.example", ["Thanks for your order #a7k2qp.", "Order number: |", "#a7k2qp |", "Order date: |", "Monday, 06/10/2026 |", "Order Details:", "1 x Any 2 Soft Drinks for £4.00 |", "£4.00 |", "1 x Sparkling Water - 330ml |", "1 x Cola - 330ml |",
        "Order Total: |", "£4.00 |", "Discount: |", "£0.00 |", "Total: |", "£4.00 |"]) }, o, "Railside", "2026-10-06", { shopAlso: ["Railside on board"] });
  }
  // ---- Marketing that asks for an order -----------------------------------------------------------------------------------------------
  not("holdout12-promo-order-now", "Gamestore", "'Starfall Saga: order now'", { from: "Gamestore <news@gamestore.example>", subject: "Starfall Saga: order now", date: "Thu, 19 Nov 2026 11:40:00 +0000",
    html: mail("Gamestore", "gamestore.example", ["Starfall Saga", "Pre-order today", "£69.99", "Order now", "Total experience"]) }, { kind: "promotion" });
  not("holdout12-promo-pre-order", "Greengrocer", "'you've got until 16th December to place your pre-order'", { from: "Greengrocer at Points <noreply@emails.greengrocer.example>", subject: "Sam, stress free Christmas starts here- you've got until 16th December to place your pre-order", date: "Wed, 12 Nov 2025 10:00:00 +0000",
    html: mail("Greengrocer", "greengrocer.example", ["Christmas food to order", "Turkey crown from £24.00", "Order by 16 December", "Total savings with points"]) }, { kind: "promotion" });
  return out;
}
