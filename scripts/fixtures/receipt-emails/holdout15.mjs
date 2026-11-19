// A seventeenth set of made-up emails (see lib.mjs), round 14 (19 Nov 2026): the layouts of receipts in Connor's own inbox
// that blind checks found Relay still reading wrong (a restaurant's till list through an ordering platform, a burger app's
// short order number, a pub app's venue, a bill's own number, a table booked but not paid), written again with everything in
// them made up (shops, apps, venues, items, prices, people, numbers).
import { order, expected, page, fixture, h } from "./lib.mjs";

const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${l.split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });

export default function holdout15() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };

  // ---- An ordering platform's "Your order with <restaurant> is paid": a till list in <pre>, prices with no "£" -------------
  {
    const o = order([{ name: "Bean Tostada", qty: 1, unit: 850 }, { name: "Chicken Taco", qty: 1, unit: 1025 }, { name: "Corn Ribs", qty: 1, unit: 575 }, { name: "Corn Ribs", qty: 1, unit: 575 }], { fees: [["Service Charge", 378]] });
    const pre = ["1 Bean Tostada                   8.50    ", "1 Chicken Taco                  10.25    ", "1 Corn Ribs                      5.75    ", "1 Corn Ribs                      5.75    ", "     1 No Salsa                          "].join("\n");
    add("holdout15-platform-till-list", "Cantina Norte", "ordering platform; subject 'Your order with <venue> is paid'; items in <pre> as '1 Name   8.50'; '+ £3.78' service charge; 'Total you’ve paid'; card line '-£…'", {
      from: "Orders <orders@tableorder.example>", subject: "Your order with Cantina Norte Shoreditch is paid", date: "Fri, 13 Nov 2026 20:15:00 +0000",
      html: `<html><body><table><tr><td><b>Order</b> <b><span>#</span><span>55120931</span></b></td><td><b>13 November 2026</b></td></tr>
<tr><td>Thanks for your payment.</td></tr><tr><td><p><b>Table:</b></p><p><b>31</b></p></td></tr>
<tr><td><p><b>Venue</b></p><p>Cantina Norte Shoreditch</p><p><b>Confirmation code</b></p><p>QWPA</p></td></tr></table>
<span style="font-family: monospace;"><pre>${h(pre)}</pre></span>
<table><tr><td><p>Service Charge</p></td><td></td><td>+ &pound;3.78</td></tr></table>
<table><tr><td><b>Total you&rsquo;ve paid</b></td><td><b>&pound;34.03</b></td></tr><tr><td><b>Total check remaining</b></td><td><b>&pound;0.00</b></td></tr></table>
<table><tr><td>visa - 4321</td><td><b>-&pound;34.03</b></td></tr></table>
<table><tr><td><b>External Order</b></td><td><b>#118804/2231</b></td></tr></table></body></html>` }, o, "Cantina Norte Shoreditch", "2026-11-13", { orderRef: "55120931" });
  }
  // ---- A burger chain's app: "Order Number:" over a three-figure number the counter calls ----------------------------------
  {
    const o = order([{ name: "6 Chicken Bites Box", qty: 1, unit: 399 }], { discounts: [["Deal discount", 50]] });
    add("holdout15-burger-app-short-number", "Burger Barn", "'Order Number:' then '|' then '042' on its own row; '1 | 6 Chicken Bites Box | £3.99'; Deal discount", {
      from: "Burger Barn <receipts@burgerbarn.example>", subject: "Thanks for your order!", date: "Sat, 14 Nov 2026 22:10:00 +0000",
      html: mail("Burger Barn", "burgerbarn.example", ["We got your order, here's your receipt.", "Order Date:", "14/11/26 22:10", "Order Number:", "042", "VAT Number:", "123456789",
        "1 | 6 Chicken Bites Box | £3.99", "Deal discount | -£0.50", "Total | £3.49"]) }, o, "Burger Barn", "2026-11-14", { orderRef: "042" });
  }
  // ---- A pub group's order-at-table app: the pub's name over its address and postcode, a table number ---------------------
  {
    const o = order([{ name: "Fish Finger Sandwich", qty: 1, unit: 895 }, { name: "Pale Ale", qty: 1, unit: 525 }]);
    add("holdout15-pub-app-venue", "Oakbarrel Inns", "'Order ID', 'Table Number: 14', then the pub's name over street, town, county and postcode; the group's name as the sender", {
      from: "The Oakbarrel App <yourorder@app.oakbarrel.example>", subject: "Oakbarrel Order confirmation : 99410", date: "Sun, 15 Nov 2026 13:00:00 +0000",
      html: mail("Oakbarrel Inns", "oakbarrel.example", ["Thank you for your order", "Order ID: 99410552", "Order Date: Sunday, November 15, 2026", "Table Number: 14",
        "The Tilted Kettle", "Mill Lane", "Ashby", "Leicestershire", "LE65 9ZZ", "Telephone: 01530 000 000",
        "Fish Finger Sandwich | £8.95", "Pale Ale | £5.25", "Total | £14.20"]) }, o, "Oakbarrel", "2026-11-15", { merchant: "The Tilted Kettle" });
  }
  // ---- A pay-at-table app: "Thanks for visiting <venue> and using <app>", the bill's number only as "Bill ID" ---------------
  {
    const o = order([{ name: "Large Noodle Box", qty: 1, unit: 1049 }]);
    add("holdout15-bill-id", "Wokbox", "'Thanks for visiting <branch> and using the <brand> app'; 'Bill ID: 71200455'; subject 'Your order 71200455'", {
      from: "Wokbox <no-reply@pepperhq.com>", subject: "Your order 71200455", date: "Mon, 16 Nov 2026 12:30:00 +0000",
      html: mail("Wokbox", "wokbox.example", ["Hello , Thanks for visiting Riverside Quay and using the Wokbox app. Total paid: £10.49 Here is your receipt:",
        "Riverside Quay 4, Quay Walk Bristol BS1 0ZZ", "Bill ID: 71200455 Customer: Guest Order Placed: 16/11/2026 12:30",
        "1 | Large Noodle Box | £10.49", "Subtotal | £10.49", "Total | £10.49"]) }, o, "Wokbox", "2026-11-16", { merchant: "Riverside Quay", orderRef: "71200455" });
  }
  // ---- Not purchases: a parcel handed to the courier, and adverts that tell the shopper to order -------------------------
  {
    const np = (id, sender, layout, m, kind) => out.push(fixture(id, sender, layout, m, { notPurchase: { kind } }));
    np("holdout15-parcel-with-courier", "Fitfuel", "a tracking service's 'Your Fitfuel order is with Royal Mail'; 'Our courier Royal Mail has received your order, 7781200.' and the items", {
      from: "Fitfuel <Fitfuel@parcel-progress.example>", subject: "Your Fitfuel order is with Royal Mail", date: "Wed, 18 Nov 2026 07:00:00 +0000",
      html: mail("Fitfuel", "fitfuel.example", ["Hello Sam,", "Our courier Royal Mail has received your order, 7781200.", "We'll let you know when your order is out for delivery.", "Track your delivery",
        "Order number: 7781200", "Whey Blend 1kg | £24.99", "Shaker | £4.99", "Total | £29.98"]) }, "delivery_update");
    np("holdout15-advert-order-now", "Giftcraft", "a newsletter 'Order now for Mother's Day delivery!' with products, prices and an offer code", {
      from: "Giftcraft <news@email.giftcraft.example>", subject: "Order now for Mother's Day delivery!", date: "Thu, 19 Nov 2026 06:00:00 +0000",
      html: mail("Giftcraft", "giftcraft.example", ["With Saturday delivery option", "Order number reference: GC-20417", "Engraved Photo Frame | £19.99", "Total | £19.99", "Shop now"]) }, "advert");
    np("holdout15-advert-win-your-order", "Harbour Knit", "'Shop 25% off today to WIN your order' from newsletter@, with 'Your order number' in the competition terms", {
      from: "Harbour Knit <newsletter@email.harbourknit.example>", subject: "Shop 25% off today to WIN your order", date: "Thu, 19 Nov 2026 06:30:00 +0000",
      html: mail("Harbour Knit", "harbourknit.example", ["One winner every hour", "Your order number: HK-551023 enters you automatically", "Cable Jumper | £60.00", "Total | £45.00"]) }, "advert");
    np("holdout15-advert-pre-order", "Grocer & Co", "'there’s still time to pre-order your Christmas Food to order' from a loyalty scheme's address", {
      from: "Grocer & Co at Points <noreply@emails.grocerpoints.example>", subject: "Sam, there’s still time to pre-order your Grocer & Co Christmas Food to order", date: "Thu, 19 Nov 2026 07:00:00 +0000",
      html: mail("Grocer & Co", "grocerco.example", ["Make hosting hassle free this Christmas", "Order number: 4410293", "Turkey Crown | £30.00", "Total | £30.00"]) }, "advert");
  }
  // ---- An online doctor's order whose number has underscores, "AB_4410321_1": the whole of it, so a forward joins it -----
  {
    const o = order([{ name: "Antihistamine Tablets", qty: 1, unit: 1299 }]);
    add("holdout15-order-number-underscores", "Clinic Direct", "subject 'Your Clinic Direct order no: CD_4410321_1'; 'Your order number: CD_4410321_1'; item and price in a row", {
      from: "Clinic Direct <noreply@clinicdirect.example>", subject: "Your Clinic Direct order no: CD_4410321_1", date: "Wed, 18 Nov 2026 14:05:00 +0000",
      html: mail("Clinic Direct", "clinicdirect.example", ["Your order number: CD_4410321_1", "Item | Price", "Antihistamine Tablets | £12.99", "TOTAL | £12.99", "Check below for more information about your order"]) }, o, "Clinic Direct", "2026-11-18", { orderRef: "CD_4410321_1" });
  }
  // ---- A trainer named by its model number over its style code, its colour and size under it ------------------------------
  {
    const o = order([{ name: "574", qty: 1, unit: 7500 }], { fees: [["Shipping", 450]] });
    add("holdout15-model-over-style-code", "Stridewell", "'574' over 'Style #:' over 'ML574EV2', 'UK Size: UK 9', the colour, 'QUANTITY: 1', 'PRICE: £75.00'", {
      from: "Stridewell <orders@stridewell.example>", subject: "Your Stridewell order NK0441190", date: "Tue, 17 Nov 2026 11:00:00 +0000",
      html: mail("Stridewell", "stridewell.example", ["Thanks for your order", "Order Number: NK0441190", "574", "Style #:", "ML574EV2", "UK Size: UK 9", "Navy with Grey", "QUANTITY: 1", "PRICE: £75.00",
        "Order Subtotal: £75.00", "Shipping: £4.50", "Order Total: £79.50"]) }, o, "Stridewell", "2026-11-17");
  }
  return out;
}

// ---- A table booked through a booking site, with the set menu's price: nothing paid yet, so not a purchase --------------
// (Kept out of the corpus: the reader reads it, with its number and price, and the inbox scan never makes it a purchase.)
export const TABLE_BOOKING = fixture("holdout15-table-booking-not-paid", "Tablefinder", "'Table for 2 on …', 'Confirmation #', 'Experience summary' with a menu's price and 'Total'; no payment", {
      from: "\"Tablefinder | Lantern House Bookings\" <no-reply@tablefinder.example>", subject: "Your booking confirmation for Lantern House", date: "Tue, 17 Nov 2026 18:00:00 +0000",
      html: mail("Tablefinder", "tablefinder.example", ["Booking confirmed", "Thanks for using Tablefinder!", "Lantern House", "Table for 2 on Friday, 27 November 2026 at 19:30", "Confirmation #: 4410098812",
        "Modify", "Cancel", "Experience summary", "2 x Bottomless Dim Sum Brunch | £79.90", "Total | £79.90"]) }, { tableBooking: true });

// ---- A relative writing back about the order from their own mailbox: "Re: Thanks for your order!", no reply headers -------
// (Kept out of the corpus, whose forwards go to Relay's own address, where a reply sent on is read as the shopper meant.)
export const PERSONAL_REPLY = fixture("holdout15-personal-reply", "a person", "'Re: Thanks for your order!' from a personal address, quoting the order with its total", {
    from: "Alex Taylor <alex.taylor.example@hotmail.co.uk>", to: "sam.taylor.example@gmail.com", subject: "Re: Thanks for your order!", date: "Thu, 19 Nov 2026 14:01:00 +0000",
    text: "Done it\n\nFrom: Sam Taylor <sam.taylor@example.co.uk>\nSent: 19 November 2026 13:56\nSubject: Fwd: Thanks for your order!\n\nThanks for your order! Order number: VX-77120\nDriving Experience Voucher £89.00\nTotal £89.00" }, { notPurchase: { kind: "reply" } });

// ---- An airline's e-ticket receipt for a reward flight: points and a small payment, paid two days before the flight -------
// (Checked in the corpus test: the airline's name without "e-ticket", the payment's day, and the points beside the price.)
export const POINTS_FLIGHT = fixture("holdout15-points-flight-eticket", "British Airways", "sender British Airways e-ticket (its real address, as the airline fixtures use; the rest made up); itinerary rows; 'Points debited | 12500'; 'Payment Total | GBP 3.10'; 'Payment Date | 6 Nov 2026'", {
  from: "British Airways e-ticket <BA.e-ticket@email.ba.com>", subject: "Your e-ticket receipt QW7RT2: 8 Nov 2026 18:40", date: "Fri, 6 Nov 2026 09:00:00 +0000",
  html: mail("Skyline Air", "skylineair.example", ["Your e-ticket receipt", "Dear Mr Taylor , | Booking reference: QW7RT2", "Thank you for booking with British Airways.", "Ticket Type: e-ticket",
    "Your Itinerary", "BA0412", "British Airways", "Economy", "Confirmed", "8 Nov 2026", "18:40", "Heathrow (London)", "Terminal 5", "8 Nov 2026", "21:50", "Charles de Gaulle (Paris)", "Terminal 2A",
    "Passenger | MR SAM TAYLOR", "Payment Information", "Ticket Number(s) | 555-0000000001", "Redemption Type | Standard", "Card Type | Visa Debit", "Points debited | 12500",
    "Payment Total | GBP 3.10", "Payment Date | 6 Nov 2026", "Flight tickets issued by | British Airways, UK"]),
  text: "Your e-ticket receipt\nBooking reference: QW7RT2\nThank you for booking with British Airways.\nYour Itinerary\nBA0412: British Airways | Economy | Confirmed\nDepart: 8 Nov 2026 18:40 - Heathrow (London) - Terminal 5\nArrive: 8 Nov 2026 21:50 - Charles de Gaulle (Paris) - Terminal 2A\nPayment Information\nPoints debited: 12500\nPayment Total: GBP 3.10\nPayment Date : 6 Nov 2026\n" }, { shop: "British Airways", date: "2026-11-06" });
