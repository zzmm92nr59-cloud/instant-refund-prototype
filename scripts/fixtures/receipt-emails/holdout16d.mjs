// An eighteenth set of made-up emails (see lib.mjs), round 15d (20 Nov 2026): layouts of Google Play, Appcharge, PayPal,
// travel agents, Stripe and others in Connor's own inbox that Relay read wrong, written again with everything in them made
// up (items, prices, people, addresses, order numbers). The senders keep their names and addresses: the reader goes by their
// layouts.
import { order, expected, fixture, h, SHOPPER } from "./lib.mjs";

const cells = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const htmlPage = (title, lines, foot = "") => `<html><head><title>${h(title)}</title></head><body>${cells(lines)}${foot}</body></html>`;

// A game's web shop sold through Appcharge (the layout of its receipts in 2025–26): the game's title, the receipt number and
// payment details, the shop's own 24-character "Order ID", then "Items" with each thing in the pack on a row of its own.
export const gameReceipt = (receipt, orderId, country, lines, money, total, date, when, pay = "Apple Pay") => ({
  from: "no-reply <no-reply@appcharge.com>", subject: "Your HARBOUR HEROES-TIDEWORKS receipt #" + receipt, date,
  html: htmlPage("Appcharge Reciept", ["Purchase Confirmation", "HARBOUR HEROES-TIDEWORKS", "Receipt number | " + receipt, "Payment method | " + pay, "Payment date | " + when,
    "Country | " + country, "Order ID | " + orderId, "Items", ...lines, ...money, "Total | " + total],
    `<p>For questions or assistance, contact <a href="https://appchargehelp.zendesk.com/hc/en-us/requests/new?tf_1=${orderId}">Appcharge support</a></p>`) });
// PayPal's receipt for the same purchase, sent seconds after the game shop's.
export const payPalToAppcharge = (offer, pre, tax, total, date, txn) => ({
  from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to Appcharge ltd", date,
  html: htmlPage("PayPal", ["Receipt for your payment to Appcharge ltd", `${SHOPPER.name}, you've successfully sent a payment.`, `Hi ${SHOPPER.name},`, `You paid ${total} GBP to Appcharge ltd`,
    "Merchant | Appcharge ltd help@appcharge.com", "Transaction date | " + new Date(date).toUTCString().slice(5, 16), offer, "Qty: 1", "Product ID: home_screen_offer_9", pre,
    "Subtotal | " + pre, "Tax | " + tax, "Total | " + total + " GBP", "Paid Appcharge ltd with", "PayPal Credit | " + total + " GBP", "Transaction ID: " + txn],
    "<p>Copyright © 1999-2026 PayPal. All rights reserved.</p>") });

// PayPal's receipt for a payment to a shop, its long name cut short as PayPal cuts it, with PayPal's own order number.
export const payPalTo = ({ cut, full = cut, email, orderId, lines, money, total, date, txn }) => ({
  from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to " + (full === cut ? cut + "..." : full), date,
  html: htmlPage("PayPal", ["Receipt for your payment to " + cut + "...", `${SHOPPER.name}, you've successfully sent a payment.`, `Hi ${SHOPPER.name},`, `You paid ${total} GBP to ${cut}...`,
    "Merchant | " + cut + "... " + email, "Transaction date | " + new Date(date).toUTCString().slice(5, 16), ...(orderId ? ["Order ID | " + orderId] : []), ...lines, ...money, "Total | " + total + " GBP",
    "Paid " + cut + "... with", "VISA Debit ••4242 | " + total + " GBP", "Transaction ID: " + txn], "<p>Copyright © 1999-2026 PayPal. All rights reserved.</p>") });
// A beer festival's ticket email (its own order number in the subject, a ticket per person, each priced, no total).
export const festivalTickets = (orderNo, n, date) => ({
  from: '"Hopfield Beer Festival" <info@hopfieldbeerfestival.co.uk>', subject: `Your Hopfield Beer Festival Tickets - Order Number [#${orderNo}]`, date,
  html: htmlPage("Tickets", Array.from({ length: n }, (_, k) => ["Standard Entry Ticket", "Hopfield Beer Festival 2026 - Saturday Night", "Saturday 18 July 2026, 17:30 - 22:30",
    "Ticket Number: 2001" + String(k).padStart(8, "0"), "Ticket Holder: " + SHOPPER.name, "Ticket Type: Standard Entry", "Price: £ 48.00"]).flat()) });
// A shop's own order confirmation for an order also paid through PayPal.
export const shopOrder = (orderNo, date, item, pre) => ({
  from: '"Trailpoint" <team@trailpoint.co.uk>', subject: "Your Trailpoint order " + orderNo, date,
  html: htmlPage("Trailpoint", ["Thanks for your order!", "Order number: " + orderNo, "Item | Qty | Price", `${item} | 1 | ${pre}`, "Order total (ex. VAT) | " + pre]) });

export default function holdout16d() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  const not = (id, sender, layout, m, kind, extra = {}) => { const f = fixture(id, sender, layout, m, { notPurchase: { kind, ...extra } }); out.push(f); return f; };
  const own = (id, sender, layout, m, exp) => { const f = fixture(id, sender, layout, m, exp); out.push(f); return f; };

  // ---- Appcharge: a pack of three things, each its own line; the shop's own Order ID is the order's number -----------------
  own("holdout16d-game-pack-lines", "Appcharge", "'Items', then 'Lantern Cat | 1', 'Arcade Tokens | x 20', 'Coins | 1,000' on rows of their own; one price for the pack; 'Order ID' under the receipt number",
    gameReceipt("308-512-774", "6a9f01c2b3d4e5f60718293a", "United Kingdom", ["Lantern Cat | 1", "Arcade Tokens | x 20", "Coins | 1,000"], ["Subtotal | £3.99", "VAT (20%) | £0.80"], "£4.79",
      "Sat, 25 Apr 2026 19:20:11 +0000", "April 25, 2026 7:20 PM UTC"),
    { shop: "Harbour Heroes", date: "2026-04-25", currency: "GBP", totalPence: 479, orderRef: "6a9f01c2b3d4e5f60718293a",
      items: [{ name: "Lantern Cat", qty: 1, linePence: null }, { name: "Arcade Tokens", qty: 20, linePence: null }, { name: "1,000 Coins", qty: 1, linePence: null }] });
  // ---- Appcharge: one thing, two of it ("Big box | x 2"): two at the pack's price ------------------------------------------------
  add("holdout16d-game-two-boxes", "Appcharge", "one line 'Golden SE box | x 2': two of one thing",
    gameReceipt("411-090-215", "6a9f01c2b3d4e5f6071829aa", "United Kingdom", ["Golden SE box | x 2"], ["Subtotal | £1.66", "VAT (20%) | £0.33"], "£1.99",
      "Sun, 10 May 2026 09:02:40 +0000", "May 10, 2026 9:02 AM UTC"),
    { ...order([{ name: "Golden SE box", qty: 2, unit: 0 }]), bought: [{ name: "Golden SE box", qty: 2, line: 199 }], subtotal: 199, total: 199 }, "Harbour Heroes", "2026-05-10", { orderRef: "6a9f01c2b3d4e5f6071829aa" });
  // ---- Appcharge bought abroad: dollars with a decimal comma, "$1,68", "$2,00 USD" --------------------------------------------
  add("holdout16d-game-comma-dollars", "Appcharge", "bought in Tunisia: 'Subtotal | $1,68', 'Tax (19%) | $0,32', 'Total | $2,00' (a decimal comma, no currency code)",
    gameReceipt("774-930-120", "69a873747398ede69c05b5ff", "Tunisia", ["Powerup Tokens | 1,000"], ["Subtotal | $1,68", "Tax (19%) | $0,32"], "$2,00",
      "Wed, 4 Mar 2026 18:01:30 +0000", "March 04, 2026 6:01 PM UTC"),
    { ...order([{ name: "1,000 Powerup Tokens", qty: 1, unit: 200 }]) }, "Harbour Heroes", "2026-03-04", { currency: "USD", orderRef: "69a873747398ede69c05b5ff" });

  // ---- PayPal's receipt for a game shop: one thing, its price before the tax PayPal adds: the thing cost what was paid --------
  add("holdout16d-paypal-offer-taxed", "PayPal", "'Special Offer', 'Qty: 1', '£2.66', 'Subtotal £2.66', 'Tax £0.53', 'Total £3.19 GBP'",
    payPalToAppcharge("Special Offer", "£2.66", "£0.53", "£3.19", "Thu, 30 Apr 2026 02:21:20 +0000", "8XY11111AB2223334"),
    // (Round 21b: the offer at its price and the tax as its own line, as PayPal sets them out; it used to be the offer at £3.19.)
    order([{ name: "Special Offer", qty: 1, unit: 266 }], { fees: [["Tax", 53]] }), "Appcharge ltd", "2026-04-30", { shopAlso: ["Appcharge"], fees: [["Tax", 53]] });
  // ---- PayPal's older receipt (guest checkout, 2023): "Payment to: <shop> <email>", the thing on labelled rows ----------------
  add("holdout16d-paypal-older-receipt", "PayPal", "'Your PayPal receipt', 'Payment to: The Riverside Herald Ltd accounts@…', 'Quantity | 1', 'Item | …', 'Price | €80.00 EUR', 'Invoice ID: WC-31002'",
    { from: "service@paypal.co.uk", subject: "Your PayPal receipt", date: "Mon, 25 Sep 2023 10:12:00 +0000",
      html: htmlPage("PayPal", ["Take a look at your purchase details from The Riverside Herald Ltd on 25 September 2023.", `Hi ${SHOPPER.name},`, "You paid €80.00 EUR to The Riverside Herald Ltd",
        "Your purchase details", "Your transaction ID: 11111111AA111111A | Seller transaction ID: 22222222BB222222B", "Purchase date: 25 September 2023",
        "Payment to: The Riverside Herald Ltd accounts@riversideherald.example | Payment from: " + SHOPPER.name, "Invoice ID: WC-31002", "Delivery address", SHOPPER.name + " " + SHOPPER.address,
        "Quantity | 1", "Item | 3 Month Print Subscription (United Kingdom)", "ID number |", "Price | €80.00 EUR", "Subtotal | €80.00 EUR", "Total | €80.00 EUR", "You paid using: Apple Pay - AmEx 1004"]) },
    order([{ name: "3 Month Print Subscription (United Kingdom)", qty: 1, unit: 8000 }]), "The Riverside Herald Ltd", "2023-09-25", { currency: "EUR", shopAlso: ["The Riverside Herald", "Riverside Herald"] });
  // ---- PayPal's "You've submitted an order": an order paid through PayPal, the seller named, the thing not described -------------
  {
    const f = fixture("holdout16d-paypal-submitted-order", "PayPal", "'You've submitted an order in the amount of £25.00 GBP to …', 'You placed a £25.00 GBP order with … (help@…)', 'Seller' over the name, an empty Description",
      { from: '"service@paypal.co.uk" <service@paypal.co.uk>', subject: "You've submitted an order in the amount of £25.00 GBP to Cellar Club Onlined Limited", date: "Fri, 14 Feb 2025 01:06:10 +0000",
        html: htmlPage("PayPal", ["You've submitted an order in the amount of £25.00 GBP to Cellar Club Onlined Limited", `${SHOPPER.name}, thanks for using PayPal.`, `Hi ${SHOPPER.name},`,
          "You placed a £25.00 GBP order with Cellar Club Onlined Limited (help@cellarclub.example)", "You won't be charged until Cellar Club Onlined Limited processes your order.",
          "Transaction ID", "O-1AB23456C78901234", "Transaction date", "14 February 2025 01:06:04 GMT", "Seller", "Cellar Club Onlined Limited", "help@cellarclub.example",
          "Description | Unit price | Qty | Amount", " | £25.00 GBP | 1 | £25.00 GBP", "Subtotal | £25.00 GBP", "Total | £25.00 GBP", "Funding sources used (total) | Mastercard-1234 | £25.00 GBP"]) },
      { ...expected("Cellar Club Onlined Limited", "2025-02-14", order([])), items: [], totalPence: 2500 });
    out.push(f);
  }
  // ---- Booking.com: the stay from its price details; paid at the property; its terms never things bought -----------------------
  own("holdout16d-booking-pay-at-stay", "Booking.com", "'You'll pay when you stay at …', 'Price details', '2 rooms | US$900', taxes and a service charge on rows of their own, 'Total price US$1,140.00', 'Room 1:' over the room",
    { from: "Booking.com <noreply@booking.com>", subject: "Your booking is confirmed at Palm Reef Lodge", date: "Fri, 1 Aug 2025 09:00:00 +0000",
      html: htmlPage("Booking.com", ["Thanks! Your booking is confirmed at Palm Reef Lodge", "Palm Reef Lodge is expecting you on Sat 14 Mar", "You'll pay when you stay at Palm Reef Lodge",
        "Check-in | Saturday, 14 March 2026 (from 14:00)", "Check-out | Sunday, 22 March 2026 (until 12:00)", "Your reservation | 8 nights, 2 rooms", "Confirmation number: 5550001111", "PIN code: | 1234",
        "Price details", "2 rooms | US$900", "Goods & services tax | US$150.00", "Property service charge | US$90.00", "Total price | US$1,140.00",
        "Payment information", "You’ve guaranteed your booking by credit card", "•••• 4242", "Some charges will be collected by the property:", "Environment fee | US$96", "Room", "1:", "Garden Villa with Pool", "Copyright © 1996–2025 Booking.com. All rights reserved."]) },
    { shop: "Booking.com", date: "2025-08-01", currency: "USD", totalPence: 114000, items: [{ name: "Garden Villa with Pool", qty: 2, linePence: 90000, extras: ["8 nights"] }] });
  own("holdout16d-booking-terms-not-items", "Booking.com", "older layout: 'Price details', '1' over the room's name, 'VAT is included.', '€ 4.90 City tax per person per night is included.', 'Total price € 614.48', a non-refundable booking",
    { from: "Booking.com <noreply@booking.com>", subject: "Your booking is confirmed at Hotel Mirador", date: "Mon, 21 Aug 2023 20:14:00 +0000",
      html: htmlPage("Booking.com", ["Thanks! Your booking is confirmed at Hotel Mirador", "Check-in | Thursday 7 September 2023", "Check-out | Monday 11 September 2023", "Your reservation | 4 nights, 1 room",
        "Confirmation number: 5550002222", "This booking is non-refundable. Changing the dates of your stay is not possible.", "Price details", "1", "Double or Twin Room", "10 % VAT is included.",
        "€ 4.90 City tax per person per night is included.", "Total price | € 614.48", "Double or Twin Room", "This twin/double room comes with 2 single beds.", "Copyright © 1996–2023 Booking.com. All rights reserved."]) },
    { shop: "Booking.com", date: "2023-08-21", currency: "EUR", totalPence: 61448, items: [{ name: "Double or Twin Room", qty: 1, linePence: 61448, extras: ["4 nights"] }] });
  not("holdout16d-booking-cancelled", "Booking.com", "'Booking cancelled for Palm Reef Lodge', 'Your booking has been successfully cancelled for free', 'Confirmation number: 5550001111'",
    { from: "Booking.com <noreply@booking.com>", subject: "Booking cancelled for Palm Reef Lodge", date: "Sat, 20 Sep 2025 10:00:00 +0000",
      html: htmlPage("Booking.com", ["Booking cancelled for Palm Reef Lodge", "Confirmation number: 5550001111", "PIN code: 1234", "Your booking has been successfully cancelled for free",
        "We can confirm that your reservation at Palm Reef Lodge has been cancelled.", "Booking number | 5550001111", "Cancellation cost | US$ 0"]) }, "cancelled", { orderRef: "5550001111" });
  // ---- Expedia: a hotel priced in dollars, "Rate quotes in GBP" only in words, the total "(£…)" only as a guide, paid there -----
  own("holdout16d-expedia-dollars-at-property", "Expedia", "'Itinerary # …', 'You booked 1 room.' over the room, 'Price summary' (name over amount), 'Total' over 'US$1,560.00 (£1,240.00)', 'Collected at the property', 'Rate quotes in GBP …'",
    { from: '"Expedia.co.uk" <expedia@eg.expedia.com>', subject: "Expedia travel confirmation - Sun, 20 Jul - (Itinerary # 73000000000001)", date: "Sun, 12 Jan 2025 18:00:00 +0000",
      html: htmlPage("Expedia", ["Thank you, Sam! Your booking is confirmed.", "Itinerary # 73000000000001", "View full itinerary", "Traveller details", "Adults, 2", "The Linden Hotel", "Check-in", "Check-out", "Sun, 20 Jul", "Sun, 27 Jul",
        "Free cancellation until 19 Jul 2025 at 15:00 (property local time)", "Accommodation details", "You booked 1 room .", "Deluxe Room, 1 King Bed", "Price summary", "Accommodation 1", "US$1,400.00",
        "Nights: 7 (avg./night)", "US$180.00", "Taxes", "US$140.00", "Locally collected mandatory fees/taxes*", "US$160.00", "Total", "US$1,560.00 (£1,240.00)", "Collected at the property",
        "Unless specified otherwise, rates are quoted in British pounds sterling.", "Rate quotes in GBP are based on current exchange rates, which may vary at time of travel. Final payment will be settled in local currency directly with the property.",
        "© 2025 Expedia, Inc., an Expedia Group company. All rights reserved."]) },
    { shop: "Expedia", date: "2025-01-12", currency: "USD", totalPence: 156000, items: [{ name: "Deluxe Room, 1 King Bed", qty: 1, linePence: 140000, extras: ["7 nights"] }] });
  // ---- Purchases Relay missed (made-up copies of their layouts) ---------------------------------------------------------------
  // An airline's itinerary whose "text" part is really its web page; "Reservation:" over the code; "Total paid via … | 168.98 GBP".
  {
    const page = `<html><body><table><tr><td>myRyanair</td></tr><tr><td>Destination::</td></tr><tr><td>Faro</td></tr><tr><td>Reservation:</td></tr><tr><td>Q7WXYZ</td></tr>
<tr><td>Your flight information</td></tr><tr><td>To Faro FR1234</td></tr><tr><td>Thu, 02 Jun 22</td></tr><tr><td>Passenger(s):</td></tr><tr><td>Mr SAM TAYLOR</td></tr>
<tr><td>Receipt:</td></tr><tr><td><div>Total paid via<br>MasterCard<br>ending in<br>4242</div></td><td><strong>168.98 GBP</strong></td></tr>
<tr><td>VAT is not applicable on international flights.</td></tr>${Array.from({ length: 12 }, () => "<tr><td><div><span>Add now</span></div></td></tr>").join("")}</table></body></html>`;
    const f = fixture("holdout16d-airline-itinerary-html-as-text", "Ryanair", "the text part is the HTML page itself; 'Reservation:' over the code; 'Total paid via MasterCard ending in 4242 | 168.98 GBP'",
      { from: "Itinerary@ryanair.com", subject: "Ryanair Travel Itinerary", date: "Thu, 5 May 2022 10:00:00 +0000", text: page, html: page },
      { ...expected("Ryanair", "2022-05-05", order([])), items: [], totalPence: 16898 });
    out.push(f);
  }
  // An airline's booking details with the total after its currency's code, "Total Price for all Passengers | GBP 1184.36".
  {
    const f = fixture("holdout16d-airline-total-code-first", "Lufthansa", "'Booking details | Departure: …' subject, 'booking code: | ABCDEF', 'Total Price for all Passengers | GBP 1184.36' (no thousands comma)",
      { from: "lufthansa.com <online@booking.lufthansa.com>", subject: "Booking details | Departure: 9 March 2022 | LHR-WDH", date: "Mon, 7 Feb 2022 11:20:05 +0000",
        html: htmlPage("Lufthansa", ["Ticket details & travel information", "Lufthansa booking code: | ABCDEF", "Passenger information", "TAYLOR/SAM MR", "Wed. 9 March 2022: London – Frankfurt", "LH 909",
          "Total Price of your Ticket", "Passenger Type | Price | Taxes, fees & surcharges | Passengers | Total Price of your Ticket", "Adult | GBP 760.00 | GBP 424.36 | 1 | GBP 1184.36", "Total Price for all Passengers | GBP 1184.36"]) },
      { ...expected("Lufthansa", "2022-02-07", order([])), items: [{ name: "Flight London Heathrow to Windhoek", qty: 1, linePence: 118436 }], totalPence: 118436, shopAlso: ["lufthansa.com"] });
    // (Round 18: the flights are what was bought, never the fare's passenger type "Adult"; the airports here are only in the
    // subject, so the trip as it names it.)
    out.push(f);
  }
  // Ticket Tailor: "Order complete: …", an order summary with its columns named and bare amounts.
  add("holdout16d-ticket-order-summary", "Ticket Tailor", "'Order complete: …' subject; 'Item Price Fee Quantity Subtotal' then 'Individual Ticket 75.00 0.00 1 75.00'; 'Total paid GBP 75.00'",
    { from: "Riverside Trust <riversidetrust@buytickets.at>", subject: "Order complete: Spring Ball 2025 - Riverside Trust", date: "Mon, 3 Feb 2025 12:00:00 +0000",
      text: "Thank you for your order\n\nDear Sam Taylor\nWe can't wait to see you at the Spring Ball\n\nOrder summary\n\n Item Price Fee Quantity Subtotal\nIndividual Ticket 75.00 0.00 1 75.00\n\nTotal\nGBP 75.00\nTotal paid\nGBP 75.00\n" },
    order([{ name: "Individual Ticket", qty: 1, unit: 7500 }]), "Riverside Trust", "2025-02-03");
  // A "Payment received" email: "Your payment of £54.40 has been successfully processed", the order's number in the subject.
  {
    const f = fixture("holdout16d-payment-received", "Dr Fox", "'Payment receipt confirmation 3170000' subject; 'Your payment of £54.40 has been successfully processed'",
      { from: "Dr Fox <noreply@doctorfox.co.uk>", subject: "Payment receipt confirmation 3170000", date: "Thu, 11 Dec 2025 09:00:00 +0000",
        html: htmlPage("Payment received", ["Payment received", "Your payment of £54.40 has been successfully processed - payment will show as 'INDEXMED' on your bank statement. You will be notified by email once your order has been processed."]) },
      { ...expected("Dr Fox", "2025-12-11", order([])), items: [], totalPence: 5440 });
    out.push(f);
  }
  // Stripe's receipt for an invoice paid ("Your … Limited receipt [#1890-4978]"), the line under a list dash.
  add("holdout16d-stripe-invoice-paid", "Stripe", "'Your Northgate Advisers Limited receipt [#1800-1234]'; '- - Payment for invoice(s) 250001 : £250.00'",
    { from: "Northgate Advisers Limited <receipts+acct_1AB@stripe.com>", subject: "Your Northgate Advisers Limited receipt [#1800-1234]", date: "Wed, 19 Feb 2025 10:28:00 +0000",
      text: "Receipt from Northgate Advisers Limited Receipt #1800-1234\nAmount paid\n£250.00\nDate paid\nFeb 19, 2025, 10:27:54 AM\nPayment method\n- - Apple Pay\nSummary\n- - Payment for invoice(s) 250001 : £250.00\n- Amount paid : £250.00\nYou're receiving this email because you made a purchase at Northgate Advisers Limited, which partners with Stripe to provide invoicing and payment processing.\n" },
    order([{ name: "Payment for invoice(s) 250001", qty: 1, unit: 25000 }]), "Northgate Advisers Limited", "2025-02-19", { shopAlso: ["Northgate Advisers"] });
  // A creator subscription: "Confirmation of NEW Subscription!", "Subscribed for $7.00".
  add("holdout16d-creator-subscription", "OnlyFans", "'Confirmation of NEW Subscription!', 'You have successfully subscribed to …', 'Subscribed for $7.00'",
    { from: "OnlyFans <no-reply@onlyfans.com>", subject: "Confirmation of NEW Subscription!", date: "Wed, 15 Jan 2025 16:18:08 +0000",
      html: htmlPage("OnlyFans", ["Congratulations!", "You have successfully subscribed to A Creator.", "A Creator", "Subscribed for $7.00", "If you did not make this purchase, please click here immediately", "©2025 OnlyFans"]) },
    order([{ name: "Subscription", qty: 1, unit: 700 }]), "OnlyFans", "2025-01-15", { currency: "USD" });
  // A jeweller's second email two seconds after its order confirmation: "Thank You For Shopping At …", "1 Item", the name over
  // "£ 310", "Size18.00 inches", "Qty1".
  add("holdout16d-jeweller-details", "Tiffany & Co.", "'Thank You For Shopping At …' subject; 'Order Number' over the number; '1 Item', the name, '£ 310', 'Size18.00 inches', 'Qty1', 'Subtotal £310.00'",
    { from: "Tiffany & Co. <no-reply@clientservices.tiffany.com>", subject: "Thank You For Shopping At Tiffany & Co.", date: "Fri, 5 Dec 2025 17:00:02 +0000",
      html: htmlPage("Tiffany", ["Thank you for shopping at Tiffany & Co.", "Dear Sam Taylor,", "We’re carefully preparing your Tiffany & Co. order and will let you know as soon as it’s on its way.", "Order Details", "Order Number", "00300001", "Order Date", "05/12/2025",
        "1 Item", "Knot Pendant", "£ 310", "Size18.00 inches", "Qty1", "Packaging", "Type", "Classic", "Subtotal", "£310.00", "Shipping - Standard £0.00", "Total", "£310.00"]) },
    { ...order([{ name: "Knot Pendant", qty: 1, unit: 31000 }]) }, "Tiffany & Co", "2025-12-05", { shopAlso: ["Tiffany & Co.", "Tiffany"] });
  // A gift experience shop: the order number in a sentence, the thing over "Product Code / Quantity / Price" rows, the money
  // summary's labels and amounts several cells apart, "You may also like" offers under it.
  add("holdout16d-gift-experience-order", "Buyagift", "'Your order reference number is BUY10000001 .', name over 'Product Code:' 'Quantity:' 'Price:', 'Discount Code Applied: | £36.00', 'Total: |' cells apart from '£143.99', offers after",
    { from: "Buyagift <noreply@buyagift.co.uk>", subject: "Your Buyagift Order Confirmation", date: "Tue, 10 Feb 2026 20:00:00 +0000",
      html: htmlPage("Buyagift", ["Thank you for ordering from Buyagift!", "Your Order Confirmation", "Hello Sam ,", "Your order reference number is BUY10000001 . Please use this reference number if you need to talk to us about your order.",
        "Two Night Hotel Break for Two", "Please click on the link below to download your E-voucher.", "DOWNLOAD YOUR E-VOUCHER", "Product Code:", "10900001", "Quantity:", "1", "Price:", "£179.99", "Gift Box Price:", "£0",
        "Order Confirmation Summary", "Subtotal:", "£179.99", "Promotion Discount:", "£0.00", "Discount Code Applied:", "£36.00", "Delivery Charges:", "£0.00", "Total: | | |", "£143.99",
        "WE THINK YOU MAY ALSO LIKE", "Afternoon Tea for Two | £49.00", "Spa Day for Two | £99.00"]) },
    order([{ name: "Two Night Hotel Break for Two", qty: 1, unit: 17999 }], { discounts: [["Discount Code Applied", 3600]] }), "Buyagift", "2026-02-10");
  // A deals site's order: "Thank you for your order (#1200-…)", the legal right to cancel "within 14 days from the day on which
  // you … acquire physical possession of the goods".
  add("holdout16d-deals-order-cancel-right", "Groupon", "'Thank you for your order (#1200-000001-000001), placed on …'; the right to cancel within 14 days of having the goods",
    { from: "Groupon <orders@r.grouponmail.co.uk>", subject: "Purchase Confirmed: Thank you for your purchase!", date: "Tue, 12 Dec 2023 20:00:00 +0000",
      html: htmlPage("Groupon", ["Your Groupon purchase was successful!", "Order summary:", "Thank you for your order (#1200-000001-000001), placed on 12 December 2023.", "Description | Quantity | Price",
        "Oak Bedside Table Set | 1 | £89.99", "Total | £89.99",
        "This email confirms that Groupon Goods Global GmbH has accepted your order. You are legally entitled to cancel your order for any reason within 14 days from the day on which you (or a third party nominated by you) acquire physical possession of the goods. To exercise your cancellation rights, please return the item back to us."]) },
    order([{ name: "Oak Bedside Table Set", qty: 1, unit: 8999 }]), "Groupon", "2023-12-12");
  // A home shop's "30-Day Return" heading over "Within 30-Day Of Delivery".
  add("holdout16d-home-window-heading", "Homary", "'30-Day Return' heading over 'Within 30-Day Of Delivery'",
    { from: '"Homary.com" <service@homary.com>', subject: "We've received your payment and your order is under processing.", date: "Wed, 30 Jul 2025 12:03:00 +0000",
      html: htmlPage("Homary", ["Free Shipping", "On All Orders", "30-Day Return", "Within 30-Day Of Delivery", "Order No.: UKA2507300000000000001", "Rattan Floor Lamp | 1 | £79.99", "Subtotal | £79.99", "Total | £79.99"]) },
    order([{ name: "Rattan Floor Lamp", qty: 1, unit: 7999 }]), "Homary.com", "2025-07-30", { shopAlso: ["Homary"] });
  // Stripe receipts: a credit for unused time ("−£11.10", a true minus sign; its label has a date with a year in it), and a
  // discount on a dollar receipt ("Pro Subscription 51% Discount (51% off) | -$11.53"); the text part runs all into one line.
  add("holdout16d-stripe-unused-time", "Anthropic", "'Unused time on … after 26 Oct 2026', 'Qty 1', '−£10.00' under the plan; VAT on top; text part one long line",
    { from: "Northlight Labs Ireland, Limited <invoice+statements+acct_9@stripe.com>", subject: "Your receipt from Northlight Labs Ireland, Limited #2300-0001", date: "Mon, 26 Oct 2026 09:00:00 +0000",
      text: "Receipt from Northlight Labs Ireland, Limited £45.60 Paid on October 26, 2026 Receipt #2300-0001 Oct 26–Nov 26, 2026 Studio plan Qty 1 £48.00 Unused time on Starter plan after 26 Oct 2026 Qty 1 −£10.00 Subtotal £38.00 VAT - United Kingdom (20%) £7.60 Total £45.60 Amount paid £45.60",
      html: htmlPage("Stripe", ["Receipt from Northlight Labs Ireland, Limited", "£45.60", "Paid on October 26, 2026", "Receipt #2300-0001", "Oct 26–Nov 26, 2026", "Studio plan", "Qty 1", "£48.00",
        "Unused time on Starter plan after 26 Oct 2026", "Qty 1", "−£10.00", "Subtotal", "£38.00", "Total excluding tax", "£38.00", "VAT - United Kingdom (20%)", "£7.60", "Total", "£45.60", "Amount paid", "£45.60"]) },
    order([{ name: "Studio plan", qty: 1, unit: 4800 }]), "Northlight Labs", "2026-10-26", { totalPence: 4560, shopAlso: ["Northlight Labs Ireland", "Northlight"] });
  add("holdout16d-stripe-dollar-discount", "Stripe", "'Paladin Pro Subscription | Qty 1 | $22.61', 'Pro Subscription 51% Discount (51% off) | -$11.53', 'Total | $11.08'",
    { from: "Brainwave, Inc. <invoice+statements+acct_2@stripe.com>", subject: "Your receipt from Brainwave, Inc. #2700-0001", date: "Sun, 1 Mar 2026 10:00:00 +0000",
      html: htmlPage("Stripe", ["Receipt from Brainwave, Inc.", "$11.08", "Paid March 1, 2026", "Receipt number 2700-0001", "Receipt #2700-0001", "Mar 1–Apr 2, 2026", "Thinker Pro Subscription", "Qty 1 | $22.61", "Subtotal | $22.61",
        "Pro Subscription 51% Discount (51% off) | -$11.53", "Total | $11.08", "Amount paid | $11.08"]) },
    order([{ name: "Thinker Pro Subscription", qty: 1, unit: 2261 }], { discounts: [["Pro Subscription 51% Discount (51% off)", 1153]] }), "Brainwave, Inc", "2026-03-01", { currency: "USD", shopAlso: ["Brainwave", "Brainwave, Inc."] });
  // A news site's subscription started on a trial: "Trial charge: GBP 1.00" is what was paid, not the monthly price after it.
  add("holdout16d-subscription-trial-charge", "Financial Times", "'Your subscription is ready to use'; 'signed up to a Premium Digital subscription'; 'Trial charge: GBP 1.00', 'Monthly payment: GBP 55.00 per month'",
    { from: "Financial Times <service@mail.ft.com>", subject: "Your subscription is ready to use", date: "Sat, 2 Dec 2023 10:00:00 +0000",
      html: htmlPage("FT", ["Welcome to the Financial Times", "Hello Sam,", "You have signed up to a Premium Digital subscription with a trial price of GBP 1.00 for your first four weeks.", "Billing details",
        "Trial charge: GBP 1.00", "Trial end date: 29 December 2023", "Monthly payment: GBP 55.00 per month", "Renewal date: 30 December 2023", "Payment method: Credit Card"]) },
    order([{ name: "Premium Digital subscription (trial)", qty: 1, unit: 100 }]), "Financial Times", "2023-12-02");
  // A holiday booked, its details only in the PDF it attaches: a purchase with its reference, nothing made up.
  {
    const f = fixture("holdout16d-holiday-documents-attached", "loveholidays", "'Booking Confirmation', 'Your Booking Reference: LOV1000001A', 'Please find all of your documents attached to this email', a PDF attached",
      { from: "loveholidays <noreply@loveholidays.com>", subject: "Your loveholidays Booking Confirmation and Vouchers", date: "Mon, 29 May 2023 09:00:00 +0000",
        html: htmlPage("loveholidays", ["Booking Confirmation", "Your Booking Reference: LOV1000001A", "Please find all of your documents attached to this email", "Hi Sam,", "Thank you for choosing loveholidays.",
          "Your booking is now confirmed and your holiday countdown can now begin!", "Also attached is a PDF which contains the full details of your booking."]) },
      { shop: "loveholidays", date: "2023-05-29", currency: null, totalPence: null, items: [], attachmentOnly: "pdf" });
    f.attach = [{ type: "application/pdf", name: "booking.pdf" }];
    out.push(f);
  }
  // Apple's invoice as it is sent: the same invoice twice, a desktop copy and a hidden phone copy; the app over the thing bought;
  // "To cancel your purchase within 14 days of receiving this invoice". One item, the app as its detail, the 14 days kept.
  {
    const copy = `<table><tr><td>Invoice</td></tr><tr><td><span>APPLE ACCOUNT</span><br>${h(SHOPPER.email)}</td><td><span>BILLED TO</span><br>Amex .... 1234 (Apple Pay)<br>${h(SHOPPER.name)}<br>GBR</td></tr>
<tr><td><span>INVOICE DATE</span><br><span dir="auto">23 Feb 2025</span></td><td><span>SEQUENCE NO.</span><br>2-6600000001</td></tr><tr><td><span>ORDER ID</span><br><a href="https://support.apple.com/kb/HT204088">MQZZTEST01</a></td><td><span>DOCUMENT NO.</span><br>211900000001</td></tr></table>
<table><tr class="section-header"><td colspan="3"><span>App Store</span></td></tr><tr><td class="item-cell"><span class="title" dir="auto">
Puzzle Garden
</span><br><span class="artist">Stack of Coins</span><br><span class="type">In-App Purchase</span><br><span class="device">Sam’s iPhone</span><br><a href="https://buy.itunes.apple.com/reportAProblem">Report a Problem</a></td>
<td class="price-cell"><table><tr><td colspan="3"><span>£1.59</span></td></tr><tr><td><span>Inclusive of VAT at <b>20%</b></span></td><td> </td><td><span>£0.26</span></td></tr></table></td></tr></table>
<table><tr><td>Subtotal</td><td> </td><td>£1.33</td></tr><tr><td>VAT charged at 20%</td><td> </td><td>£0.26</td></tr><tr><td>TOTAL</td><td></td><td>£1.59</td></tr></table>
<p>To cancel your purchase within 14 days of receiving this invoice, <a href="https://buy.itunes.apple.com/reportAProblem">report a problem</a> or <a href="http://www.apple.com/uk/support/itunes/contact/">contact us</a>.<br><a href="http://www.apple.com/legal/">Learn more about your right of withdrawal</a></p>`;
    add("holdout16d-apple-two-copies", "Apple", "desktop and hidden phone copies of one invoice; app 'Puzzle Garden' over 'Stack of Coins', 'In-App Purchase'; cancel within 14 days",
      { from: "Apple <no_reply@email.apple.com>", subject: "Your invoice from Apple.", date: "Sun, 23 Feb 2025 23:21:31 +0000",
        html: `<html><body><div class="aapl-desktop-div" style="display:block;">${copy}</div><div class="aapl-mobile-div" style="display:none;height:0;max-height:0;overflow:hidden;">${copy}</div></body></html>` },
      { ...order([{ name: "Stack of Coins", qty: 1, unit: 159 }]), bought: [{ name: "Stack of Coins", qty: 1, line: 159, extras: ["Puzzle Garden"] }] }, "Apple", "2025-02-23");
  }
  // Google Play's subscription receipt with its links: the refund link is the one on "request a refund on the Google Play
  // website", never the withdrawal form or "learn more"; the two-hour rule for apps is not for subscriptions.
  {
    const L = (t, k) => `<a href="https://www.google.com/appserve/mkt/p/AFnwnK${k}">${t}</a>`;
    add("holdout16d-google-play-links", "Google Play", "subscription renewal with Google's links: 'learn more', 'form' (withdraw), 'request a refund on the Google Play website.', 'Refund Policy'",
      { from: "Google Play <googleplay-noreply@google.com>", subject: "Your Google Play Order Receipt from 13-Jun-2019", date: "Thu, 13 Jun 2019 13:17:52 +0000",
        text: "Google Play\n\n\nThank you.\n\n\nYour subscription from Google Commerce Limited on Google Play continues and you've been charged.\n\n\n\nOrder number: GPA.3399-0000-0000-00000..5\nOrder date: 13-Jun-2019 14:17:49 BST\n\n\nItem Price\n\n\nSketchbook Pro yearly with trial (Inkwell: Draw, Sketch & Paint Anywhere) (by Inkwell Studio Ltd) £8.99/month\n\n\nMonthly Subscription ‐ Next payment automatically charged on 13 Jul 2019\n\n\n\nTotal: £8.99/month\n\n(Includes VAT of £1.50)\n\n\nUnder the law, you have an automatic statutory right of withdrawal from contracts for the purchase of digital services for 14 days after you make the purchase. Use this form to withdraw. However, you can cancel your subscription, and the cancellation will be effective from the start of the next payment period.\nAfter purchasing an app or game on Google Play, you can return it within two hours for a full refund. This does not apply for in-app purchases or in-app subscriptions.\n\nIf the return period has passed and your purchase doesn't work properly or doesn't match its description on Google Play, you can request a refund on the Google Play website.\n",
        html: `<html><body><div>Thank you.</div><div>Your subscription from Google Commerce Limited on Google Play continues and you've been charged.</div><div><b>Order number: </b> GPA.3399-0000-0000-00000..5<br><b>Order date: </b> 13-Jun-2019 14:17:49 BST</div>
<table><tr><td>Item</td><td>Price</td></tr></table><table><tr><td><span>Sketchbook Pro yearly with trial (Inkwell: Draw, Sketch &amp; Paint Anywhere)</span> (by Inkwell Studio Ltd)</td><td>£8.99/month</td></tr><tr><td>Monthly Subscription ‐ Next payment automatically charged on 13 Jul 2019</td><td></td></tr></table>
<table><tr><td><span>Total</span>: <span>£8.99/month</span></td></tr><tr><td>(Includes VAT of £1.50)</td></tr></table>
<div>You can cancel at any time (${L("learn more", "a1")}).</div>
Under the law, you have an automatic statutory right of withdrawal from contracts for the purchase of digital services for 14 days after you make the purchase. Use this ${L("form", "b2")} to withdraw. After the first 14 days you will not be eligible for a refund. However, you can cancel your subscription, and the cancellation will be effective from the start of the next payment period.<p>After purchasing an app or game on Google Play, you can return it within two hours for a full refund. This does not apply for in-app purchases or in-app subscriptions.</p><p>If the return period has passed and your purchase doesn’t work properly or doesn’t match its description on Google Play, you can ${L("request a refund on the Google Play website.", "c3")}</p>
<div>See your Google Play ${L("Order History", "d4")}. View the Google Play ${L("Refund Policy", "e5")} and the ${L("Terms of Service", "f6")}.</div></body></html>` },
      order([{ name: "Sketchbook Pro yearly with trial (Inkwell: Draw, Sketch & Paint Anywhere)", qty: 1, unit: 899 }]), "Google Play", "2019-06-13");
  }
  return out;
}
