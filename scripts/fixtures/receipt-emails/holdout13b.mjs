// A fourteenth set of made-up emails (see lib.mjs), round 12b (19 Nov 2026): the layouts of receipts in Connor's own inbox
// that four blind checks found Relay reading wrong, written again with everything in them made up (shops, apps, games,
// stations, hotels, items, prices, people, numbers). Apple keeps its name and layout (the reader goes by Apple's wording);
// every other shop and site is invented.
import { order, expected, page, fixture, gbp, h, SHOPPER } from "./lib.mjs";

// Rows as the real emails had them: each line its own row, " | " between the cells of one row.
const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${l.split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });

export default function holdout13b() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };

  // ---- Apple: an in-app purchase is named by what was bought, its app as the detail ---------------------------------------
  {
    const o = order([{ name: "Treasure Chest Bundle", qty: 1, unit: 449, extras: ["Gem Garden"] }]);
    add("holdout13b-apple-in-app-product", "Apple", "'Your receipt from Apple.': the app, then what was bought in it, 'In-App Purchase', a device", { from: "Apple <no_reply@email.apple.com>", subject: "Your receipt from Apple.", date: "Tue, 3 Nov 2026 18:20:00 +0000",
      html: mail("Apple", "apple.com", ["Invoice", "APPLE ACCOUNT", SHOPPER.email, "INVOICE DATE", "3 Nov 2026", "ORDER ID", "MQZZ12AB34", "DOCUMENT NO.", "700000000123", "App Store",
        "Gem Garden", "Treasure Chest Bundle", "In-App Purchase", "Sam’s iPhone", "Report a Problem", "£4.49", "Inclusive of VAT at 20%", "£0.75", "Subtotal", "£3.74", "VAT charged at 20%", "£0.75", "TOTAL", "£4.49"]) }, o, "Apple", "2026-11-03");
  }
  // ---- Apple: a subscription's plan is named with its app, the app's store title cut at its first separator ------------------
  {
    const o = order([{ name: "TuneNest Family Plan (Annual)", qty: 1, unit: 4999 }]);
    add("holdout13b-apple-plan-with-app", "Apple", "the app's long store title over its plan in brackets, 'Renews …'", { from: "Apple <no_reply@email.apple.com>", subject: "Your receipt from Apple.", date: "Wed, 4 Nov 2026 08:00:00 +0000",
      html: mail("Apple", "apple.com", ["Invoice", "4 November 2026", "Sequence:", "2-10000000001", "Order ID:", "MQZZ56CD78", "Document:", "700000000456", "Apple Account:", SHOPPER.email,
        "TuneNest・Music Player・Radio", "Family Plan (Annual)", "Renews 4 November 2027", "£49.99", "Inclusive of VAT at 20% £8.33", "Billing and Payment", "Subtotal", "£41.66", "VAT charged at 20%", "£8.33", "Mastercard •••• 1234 (Apple Pay)", "£49.99"]) }, o, "Apple", "2026-11-04");
  }
  // ---- A game's web shop: its heading misspelt, the game's name in capitals, the pack's parts with "x 5" -----------------------
  {
    const o = order([{ name: "1,200 Gems, 5 Spin token", qty: 1, unit: 599 }]);
    add("holdout13b-game-shop-reciept", "Appcharge", "'… Reciept' heading, 'GAME-STUDIO' title, 'Gems | 1,200', 'Spin token | x 5'", { from: "Appcharge inc. <no-reply@appcharge.com>", subject: "Your BUBBLE QUEST-STUDIOX receipt #120-450-781", date: "Sat, 7 Nov 2026 13:05:00 +0000",
      html: mail("BUBBLE QUEST-STUDIOX", "appcharge.com", ["Appcharge Reciept", "Purchase Confirmation", "BUBBLE QUEST-STUDIOX", "Receipt number | 120-450-781", "Payment method | Apple Pay", "Payment date | November 7, 2026 1:05 PM UTC",
        "Order ID | 6a1b2c3d4e5f60718293a4b5", "Items", "Gems | 1,200", "Spin token | x 5", "Subtotal | £4.99", "VAT (20%) | £1.00", "Total | £5.99"]) }, o, "Bubble Quest", "2026-11-07");
  }
  // ---- A rail booking split into two tickets: each ticket, named by its leg, with its price ----------------------------------
  {
    const o = order([{ name: "Hilltown to Midvale", qty: 1, unit: 420 }, { name: "Midvale to Riverside Terminals", qty: 1, unit: 1180 }]);
    add("holdout13b-rail-split-tickets", "RailHop", "subject shortens the station; two 'Adult - … - [Railcard]' lines over their prices; Transaction ID under its label", { from: "RailHop <auto-confirm@railhop.example>", subject: "Your booking confirmation for Hilltown to Riverside (2 December at 10:12)", date: "Wed, 2 Dec 2026 09:30:00 +0000",
      html: mail("RailHop", "railhop.example", ["Your trip to Riverside Quay departing Wednesday, 2 December 2026 is confirmed", "Hilltown", "Riverside Quay", "This is just a booking confirmation.",
        "Outbound Wednesday 2 December", "10:12 Hilltown", "Anytime Day Single", "Hilltown to Midvale", "10:40 Midvale", "10:55 Midvale", "Super Off-Peak Single", "Midvale to Riverside Terminals", "11:50 Riverside Quay",
        "Payment information", "Transaction ID:", "551200987654", "Order details |", "Adult - Anytime Day Single - [16-25 Railcard]", "£4.20", "Adult - Super Off-Peak Single - [16-25 Railcard]", "£11.80",
        "Other costs |", "Booking Fee", "No booking fee", "Total amount: | £16.00 |"]) }, o, "RailHop", "2026-12-02");
  }
  // ---- A hotel booking in euros, offers priced "from £" beside it, a non-refundable rate ---------------------------------------
  {
    const f = add("holdout13b-hotel-euros-offers", "Staylink", "a room over its euro price, VAT and city tax lines, 'Total price', 'from £' offers, non-refundable", { from: "Staylink <noreply@staylink.example>", subject: "Thanks! Your booking is confirmed at Harbour Lights Lisbon", date: "Mon, 9 Nov 2026 07:00:00 +0000",
      html: mail("Staylink", "staylink.example", ["Thanks! Your booking is confirmed at Harbour Lights Lisbon", "Confirmation: 7712340098", "PIN: 1234", "Cancellation policy",
        "This booking is non-refundable. Changing the dates of your stay is not possible.", "Price details", "1 Twin Room - Garden View", "€ 120.00", "VAT", "€ 12.00", "City tax", "€ 4.00", "Total price", "€ 136.00",
        "Keep planning your trip", "Free cancellation available", "One-way ride from £39.20", "1 day from £88.10"]) },
      order([{ name: "Twin Room - Garden View", qty: 1, unit: 12000, extras: ["Harbour Lights Lisbon"] }]), "Staylink", "2026-11-09");
    Object.assign(f.expected, { currency: "EUR", totalPence: 13600, subtotalPence: 12000, feesPence: 400 });
  }
  // ---- A shirt maker: the size, fit and how many on a slashed line under the name and its code ---------------------------------
  {
    const o = order([{ name: "Navy Twill Shirt", qty: 1, unit: 3995 }, { name: "Stone Stretch Chinos", qty: 1, unit: 5495 }]);
    add("holdout13b-shirts-size-fit-line", "Weftwood", "name, code, 'Waist 32\"/81cm 31\" Leg Trouser / Slim fit / Qty 1', 'In Stock', price", { from: "Weftwood <orders@weftwood.example>", subject: "Thank you for your order", date: "Thu, 5 Nov 2026 12:00:00 +0000",
      html: mail("Weftwood", "weftwood.example", ["Order number: WW4401122", "Navy Twill Shirt |", "SHT0042NVY |", "15 1/2 Col 34 Sleeve Single Cuff / Slim fit / Qty 1 |", "In Stock |", "£39.95 |",
        "Stone Stretch Chinos |", "TRS0019STN |", "Waist 32\"/81cm 31\" Leg Trouser / Slim fit / Qty 1 |", "In Stock |", "£54.95 |", "Sub-total | £94.90", "Delivery | £0.00", "Order Total | £94.90"]) }, o, "Weftwood", "2026-11-05");
  }
  // ---- A takeaway: "(incl. VAT)" after names, "Served with:" and its sides as 1 / x / name, "Inc. £0.00 VAT" under prices ----
  {
    const o = order([{ name: "Regular", qty: 1, unit: 1095, extras: ["Halloumi Wrap"] }, { name: "Cola (can)", qty: 1, unit: 180 }]);
    add("holdout13b-takeaway-served-with", "Pitta Point", "'1 x', 'Regular (incl. VAT)', 'Served with:', '1', 'x', 'Halloumi Wrap', price, 'Inc. £0.00 VAT'", { from: "Pitta Point <no-reply@orders.example>", subject: "Pitta Point: Order #7QPLMN accepted", date: "Fri, 6 Nov 2026 12:30:00 +0000",
      html: mail("Pitta Point", "orders.example", ["Your order 7QPLMN has been accepted by Pitta Point and is being prepared.", "Order ID: 7QPLMN", "1 x", "Regular (incl. VAT)", "Served with:", "1", "x", "Halloumi Wrap", "1", "x", "Chips",
        "£10.95", "Inc. £0.00 VAT", "1 x", "Cola (can) (incl. VAT)", "£1.80", "Inc. £0.00 VAT", "Subtotal | £12.75", "Total | £12.75"]) }, { ...o, bought: o.bought.map((i) => i.name === "Regular" ? { ...i, name: "Regular (with Halloumi Wrap and Chips)", extras: [] } : i) }, "Pitta Point", "2026-11-06");
  }
  // ---- A subscription receipt: "Item | Price", the price before tax on a row of its own, "Today's total" ------------------------
  {
    const o = order([{ name: "Arcadia Pass", qty: 1, unit: 599 }]);
    add("holdout13b-item-price-todays-total", "Arcadia Games", "'Item | Price' heading, the name, '| £4.99 |', 'Today's total: £5.99', 'Tax included: £1.00'", { from: "Arcadia Games <receipts@arcadia-games.example>", subject: "Your receipt from Arcadia Games", date: "Sat, 7 Nov 2026 09:00:00 +0000",
      html: mail("Arcadia Games", "arcadia-games.example", ["Thank you", "Date: 7 November 2026", "Receipt number: 8800112233445566", "Item | Price |", "Arcadia Pass", "| £4.99 |", "Today's total: £5.99", "Tax included: £1.00",
        "This subscription began on 7 Nov 2026 and is automatically renewed every month."]) }, o, "Arcadia Games", "2026-11-07");
  }
  // ---- A gift voucher: "Item 1", "Name: …", its kind, a personal message, the price -------------------------------------------
  {
    const o = order([{ name: "Sunday Roast for Two", qty: 1, unit: 4500 }]);
    add("holdout13b-gift-voucher-name-label", "The Old Mill Inns", "'Item 1', 'Name: …', 'Standard', 'Personal message: …' over two lines, the price, delivery by email", { from: "\"The Old Mill Inns\" <no-reply@giftvouchers.example>", subject: "Your gift receipt", date: "Sun, 8 Nov 2026 10:00:00 +0000",
      html: mail("The Old Mill Inns", "giftvouchers.example", ["Thank you for your purchase, this is your digital receipt of purchase.", "Item 1 |", "Name: Sunday Roast for Two |", "Standard |", "Personal message: Happy anniversary!", "Love from us |", "£45.00 |",
        "Delivery: friend@example.co.uk |", "Sub total | £45.00", "Delivery | £0.00", "Total | £45.00", "The Old Mill Inns"]) }, o, "The Old Mill Inns", "2026-11-08");
  }
  // ---- A wine club: the basket total, a voucher, then one name over one price, then a letter --------------------------------------
  {
    const o = order([{ name: "Cellar Club Starter White Case", qty: 1, unit: 11988 }], { discounts: [["£60 Cellar Club Voucher", 6000]] });
    add("holdout13b-wine-basket-name-over-price", "Vineyard Direct", "'Basket Total', a voucher, 'Total', then the one name over its price, then a letter with an exclamation", { from: "Vineyard Direct <orders@vineyard-direct.example>", subject: "Your Vineyard Direct order", date: "Mon, 9 Nov 2026 19:00:00 +0000",
      html: mail("Vineyard Direct", "vineyard-direct.example", ["Your order has been placed", "Basket Total: £119.88", "£60 Cellar Club Voucher: -£60.00", "Total: £59.88", "Paid by Card: £59.88", "Order number:", "#VD7781234",
        "Delivery Method:", "Standard Delivery", "Cellar Club Starter White Case", "£119.88", "Nothing beats a case at your door!", "Thank you for joining the Cellar Club."]) }, o, "Vineyard Direct", "2026-11-09");
  }
  // ---- A membership bought through a billing company for a site it names ---------------------------------------------------------
  {
    const o = order([{ name: "3-day trial StreamVault membership", qty: 1, unit: 149 }]);
    add("holdout13b-biller-membership", "StreamVault", "a billing company's receipt: 'You've just bought … membership.', 'Amount paid', 'Website | streamvault.example', 'Receipt 4401…'", { from: "Paybridge Info <info@paybridge.example>", subject: "Thank you for your purchase", date: "Tue, 10 Nov 2026 21:00:00 +0000",
      html: mail("Paybridge", "paybridge.example", ["Receipt", "Thank you for buying StreamVault trial membership", "Receipt 440112233", "Dear member,", "You've just bought 3-day trial StreamVault membership .", "Find the details of your purchase below.",
        "Amount paid", "£1.49", "Date", "November 10, 2026", "Payment method", "Card", "Website", "streamvault.example", "Thank you for using our service."]) }, o, "StreamVault", "2026-11-10");
  }
  // ---- A bowling alley: the age band's "+" then how many, in plain text ------------------------------------------------------------
  {
    const o = order([{ name: "Junior - aged 6+", qty: 3, unit: 850 }]);
    add("holdout13b-age-band-qty-text", "Strike Lanes", "plain text 'Junior - aged 6+ 3 £25.50'", { from: "Strike Lanes <bookings@strikelanes.example>", subject: "Your booking confirmation", date: "Sun, 15 Nov 2026 15:00:00 +0000",
      text: ["Strike Lanes", "Booking reference: SL-449JQ", "Sunday, 15 November 2026", "16:00 - 17:00", "Junior - aged 6+ 3 £25.50", "Total Price: £25.50"].join("\n") }, { ...o, bought: o.bought.map((i) => ({ ...i, line: 2550 })) }, "Strike Lanes", "2026-11-15");
  }
  return out;
}
