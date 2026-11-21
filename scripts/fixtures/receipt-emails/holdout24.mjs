// A twenty-seventh set of made-up emails (see lib.mjs), round 23 (21 Nov 2026): layouts in a real inbox (January to August
// 2026) that Relay read wrongly after round 22, written again with everything in them made up (shops, games, apps, hotels,
// airlines, items, prices, people, numbers). PayPal, Appcharge, Paddle and Booking.com keep their names and addresses: the
// reader goes by their layouts.
//  - PayPal's "Receipt for your payment to Appcharge ltd", paid from PayPal Credit, and the game's own Appcharge receipt sent
//    the same minute; and an Appcharge receipt whose text runs its headings together, "Items" first;
//  - a maker's receipt sent by its reseller, "PhotoTidy (via Paddle.com)", the thing over its price before VAT;
//  - an airline's e-ticket receipt: "you may cancel your flight booking and claim a refund without penalty, up to 24 hours
//    from when you made the original booking";
//  - a festival's six tickets at their price with VAT, and PayPal's receipt of the same order with the tickets before tax, a
//    booking fee, a discount and the tax;
//  - a shop's "Shipping: £4.95 via Next Day";
//  - Booking.com's newer confirmation, "You don't need to prepay", the hotel in its subject;
//  - a holiday company's "We've got your payment" for a booking paid in parts, with its payment history;
//  - an in-flight wifi receipt in Spanish, "$ 150.00 MXN";
//  - PayPal's "You've authorised £12.40 GBP to UBER PAYMENTS UK LIM...", which is no purchase of its own.
// scripts/test-receipt-real-24.mjs reads these.
import { order, expected, fixture, h, SHOPPER } from "./lib.mjs";

const cells = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("\n")}</table>`;
const htmlPage = (title, lines, foot = "") => `<html><head><title>${h(title)}</title></head><body>${cells(lines)}${foot}</body></html>`;
const pp = (lines) => htmlPage("PayPal", lines, "<p>Copyright © 1999-2026 PayPal. All rights reserved. PayPal UK Ltd.</p>");

// ---- A game's web shop through Appcharge, paid with PayPal: PayPal's receipt and the game's own ----------------------------
export const GAME_PAYPAL = {
  paypal: { from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to Appcharge ltd", date: "Tue, 03 Mar 2026 19:02:31 +0000",
    html: pp(["Receipt for your payment to Appcharge ltd", `${SHOPPER.name}, you've successfully sent a payment.`, `Hi ${SHOPPER.name},`, "You paid £6.49 GBP to Appcharge ltd",
      "Merchant", "Appcharge ltd", "help@appcharge.com", "Transaction date", "3 Mar 2026", "Harbour Market Offer", "Qty: 1", "Product ID: home_screen_offer_9", "£5.41",
      "Subtotal", "£5.41", "Tax", "£1.08", "Total", "£6.49 GBP", "Paid Appcharge ltd with", "PayPal Credit", "£6.49 GBP",
      'This charge will appear on your credit card statement as "APPCHARGE".', "Transaction ID: 1AB23456CD7890123", "View payment status"]) },
  shop: { from: "no-reply <no-reply@appcharge.com>", subject: "Your PUZZLE PALS-ACME GAMES receipt #123-456-789", date: "Tue, 03 Mar 2026 19:02:20 +0000",
    html: `<html><head><title>Purchase Confirmation</title></head><body><table><tr><td><p>Purchase Confirmation</p></td></tr>
<tr><td><table><tr><td><img src="https://media.appcharge.com/media/x/logo" alt="game logo" width="40"></td><td><span>PUZZLE PALS-ACME GAMES</span></td></tr></table></td></tr>
<tr><td><table><tr><td>Receipt Number</td><td>123-456-789</td></tr><tr><td>Payment Method</td><td>PayPal</td></tr><tr><td>Payment Date</td><td>March 3, 2026 7:02 PM UTC</td></tr>
<tr><td>Country</td><td>United Kingdom</td></tr><tr><td>Order ID</td><td>6b01c02d03e04f05a06b07c8</td></tr></table></td></tr>
<tr><td><p>Items</p></td></tr><tr><td><table><tr><td><table><tr><td><img src="https://example.cloudfront.net/checkout_items/Coins.png" alt="Coins" width="24"></td><td><span>Coins</span></td></tr></table></td><td>3,100</td></tr>
<tr><td><table><tr><td><img src="https://example.cloudfront.net/checkout_items/Lives.png" alt="Lives" width="24"></td><td><span>Lives</span></td></tr></table></td><td>5</td></tr></table></td></tr>
<tr><td><table><tr><td>Subtotal</td><td>£5.41</td></tr><tr><td>VAT (20%)</td><td>£1.08</td></tr><tr><td>Total</td><td>£6.49</td></tr></table></td></tr>
<tr><td><table><tr><td>Powered by</td><td><img src="https://example.com/appcharge.jpg" alt="appcharge" height="16"></td></tr></table></td></tr>
<tr><td><p>For questions or assistance, contact <a href="https://appchargehelp.example/requests/new">Appcharge support</a></p></td></tr></table></body></html>` },
};
// (Its text alone, the headings run together: the game is still the shop, never "Items".)
export const GAME_TEXT = { from: "no-reply <no-reply@appcharge.com>", subject: "Your PUZZLE PALS-ACME GAMES receipt #987-654-321", date: "Wed, 04 Mar 2026 10:00:00 +0000",
  text: ["     Purchase Confirmation Purchase Confirmation", "", "            PUZZLE PALS-ACME GAMES Receipt Number 987-654-321", "    Payment Method Apple Pay Payment Date March 4, 2026 10:00 AM",
    "UTC Country United Kingdom Order ID 6b11c12d13e14f15a16b17c8", "         Items", "", "                   Coins 1,200 Lives 3", "           Subtotal £1.66 VAT (20%) £0.33 Total",
    "£1.99 Powered by For questions or assistance, contact", "Appcharge support"].join("\n") };

// ---- A maker's software sold by its reseller --------------------------------------------------------------------------------
export const RESELLER = { from: '"PhotoTidy (via Paddle.com)" <help@paddle.com>', subject: "Your PhotoTidy receipt", date: "Mon, 12 Jan 2026 09:15:00 +0000",
  html: htmlPage("Your PhotoTidy receipt", ["Your PhotoTidy subscription receipt", "Receipt # 11223344-55667788", "Amount Paid", "£29.99", "Receipt Date", "12th January 2026", "Payment Method", "",
    "PhotoTidy Pro Subscription - 2 devices", "£24.99", "VAT (20%)", "£5.00", "Amount Paid", "£29.99", "View Receipt",
    "The £29.99 payment will appear on your bank/card statement as:", "PADDLE.NET* PHOTOTIDY", "Your subscription will renew at £29.99 unless you cancel, by 11th January 2027.",
    "Thanks,", "PhotoTidy", "Paddle.com Market Ltd, Judd House, 18-29 Mora Street, London EC1V 8BT", "11223344-55667788"]) };

// ---- An airline's e-ticket receipt that can be cancelled for a refund in its first 24 hours ----------------------------------
export const ETICKET = { from: "Skyline Airways e-ticket <e-ticket@email.skylineair.example>", subject: "Your e-ticket receipt ZK4PQR: 18 Apr 2026 07:10", date: "Thu, 05 Feb 2026 21:00:00 +0000",
  text: ["Skyline Airways booking reference: ZK4PQR", "", "Your e-ticket receipt", "Thank you for booking with Skyline Airways.", "",
    "Please check the details of the items purchased are correct. If you have made a mistake, you may cancel your flight booking and claim a refund without penalty, up to 24 hours from when you made the original booking. Refunds will be made to the card used to pay.", "",
    "SK0331: Skyline Airways | Economy | Confirmed", "Depart: 18 Apr 2026 07:10 - Heathrow (London) - Terminal 5", "Arrive: 18 Apr 2026 09:25 - Charles de Gaulle (Paris) - Terminal 2E", "",
    "Payment Total: GBP 86.40", "Fare Details: GBP 40.00 + Tax/Fee/Charge GBP 46.40 = GBP 86.40"].join("\n") };

// ---- A festival's tickets and PayPal's receipt of the same order ------------------------------------------------------------
export const FESTIVAL = {
  shop: { from: "Riverside Cider Festival <tickets@riversidecider.example>", subject: "Your Riverside Cider Festival Tickets - Order Number [#220411]", date: "Sat, 18 Apr 2026 12:00:10 +0000",
    html: htmlPage("Riverside Cider Festival", ["Thank you for your order", `Hi ${SHOPPER.first},`, "We have received your order #220411.", "Day Ticket General Sale", "Session: Saturday", "Price: £ 30.00",
      "Day Ticket General Sale", "Session: Saturday", "Price: £ 30.00", "Day Ticket General Sale", "Session: Saturday", "Price: £ 30.00", "Day Ticket General Sale", "Session: Saturday", "Price: £ 30.00",
      "See you at the festival!"]) },
  paypal: { from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to Riverside Cider Fes...", date: "Sat, 18 Apr 2026 12:00:40 +0000",
    html: pp(["Receipt for your payment to Riverside Cider Fes...", `${SHOPPER.name}, you've successfully sent a payment.`, "You paid £104.40 GBP to Riverside Cider Fes...",
      "Merchant", "Riverside Cider Fes...", "Transaction date", "18 Apr 2026", "Order ID", "rcf-30112", "Riverside Cider Fes...", "Qty: 4", "£25.00", "Booking Fee", "Qty: 1", "£12.00",
      "Subtotal", "£87.00", "Discount", "-£25.00", "Tax", "£17.40", "Total", "£104.40 GBP", "Paid Riverside Cider Fes... with", "PayPal balance", "£104.40 GBP", "Transaction ID: 2CD34567EF8901234"]) },
};

// ---- A shop's delivery written with how it was sent -------------------------------------------------------------------------
export const SHIPPED_VIA = { from: "Hound & Harness <hello@houndharness.example>", subject: "Your Hound & Harness order has been received!", date: "Sun, 07 Jun 2026 10:00:00 +0000",
  html: `<html><head><title>Hound &amp; Harness</title></head><body><h1>Thank you for your order</h1><p>Just to let you know — we've received your order #77310, and it is now being processed:</p>
<h2>[Order #77310] (7 June 2026)</h2><table><thead><tr><th>Product</th><th>Quantity</th><th>Price</th></tr></thead><tbody><tr><td>Rope Slip Lead - Forest Green, 1.5m</td><td>1</td><td><span>£</span>18.50</td></tr></tbody></table>
<table><tr><th colspan="2">Subtotal: </th><td><span>£</span>18.50</td></tr><tr><th colspan="2">Shipping: </th><td><span>£</span>4.95 <small class="shipped_via">via Next Day</small></td></tr>
<tr><th colspan="2">Payment method: </th><td>Visa ending in 4242</td></tr><tr><th colspan="2">Total: </th><td><span>£</span>23.45 <small class="includes_tax">(includes <span>£</span>3.91 VAT)</small></td></tr></table>
<p>Thanks for using www.houndharness.example!</p></body></html>` };

// ---- Booking.com's newer confirmation: nothing taken up front -----------------------------------------------------------------
export const PAY_AT_HOTEL = { from: "Booking.com <noreply@booking.com>", subject: "Thanks! Your booking is confirmed at Harbour View Hotel & Spa", date: "Fri, 01 May 2026 08:00:00 +0000",
  html: htmlPage("Booking.com", ["Thanks! Your booking is confirmed at Harbour View Hotel & Spa", "Harbour View Hotel & Spa is expecting you on Fri 12 Jun", "Booking number: 4400112233",
    "Reservation details", "Check-in | Friday, 12 June 2026 (from 15:00)", "Check-out | Monday, 15 June 2026 (until 11:00)", "Your reservation | 3 nights , Deluxe Sea View Room", "You booked for | 2 adults",
    "Prepayment", "You don't need to prepay. However, the property may take a deposit from the card you booked with.", "Total price | US$642.00",
    "You will pay the hotel in the hotel’s local currency (EUR) at the exchange rate on day of payment."]) };

// ---- A holiday paid in parts: its booking, and the shop's own receipt for a later part ---------------------------------------
export const INSTALMENT = {
  booking: { from: "Sunwise Holidays <noreply@sunwiseholidays.example>", subject: "Your booking is confirmed", date: "Tue, 14 Oct 2025 18:00:00 +0000",
    html: htmlPage("Sunwise Holidays", ["Your booking is confirmed", "Booking reference: SUN55120934U", `Hi ${SHOPPER.first},`, "Thank you for booking your holiday with Sunwise Holidays.",
      "Hotel Coral Bay, 7 nights, half board", "Deposit paid today | £45.00"]) },
  payment: { from: "Sunwise Holidays <noreply@sunwiseholidays.example>", subject: "We've got your payment", date: "Sat, 14 Feb 2026 05:30:00 +0000",
    text: ["BOOKING REFERENCE: SUN55120934U", "", `Hi ${SHOPPER.first},`, "", "Thank you for booking your trip with Sunwise Holidays. This email is just to confirm",
      "that your recent payment has been successful and your payment history is", "detailed below.", "", "Previous payment history", "", "Date:", "", "Amount:", "",
      "14 Oct 2025", "", "£45", "", "10 Nov 2025", "", "£180.50", "", "14 Feb 2026", "", "£312.25", "", "Sunwise Holidays Ltd, 1 Example Street, London"].join("\n") },
};

// ---- In-flight wifi bought in Mexico, in Spanish ------------------------------------------------------------------------------
export const WIFI = { from: "Skyline Wi-Fi Onboard <info@info.skylinewifi.example>", subject: "Aquí está su ticket de Wi-Fi a bordo. ¡Verifique los datos de su compra! - N.° de pedido :AB12345CD", date: "Fri, 05 Jun 2026 23:10:03 +0000",
  html: htmlPage("Wifi Onboard Purchase Receipt", ["Navegador web", "Gracias por su compra", "Cliente: Traveler", `Correo Electronico: ${SHOPPER.email}`, "Orden: AB12345CD", "Fecha: 05/06/26 20:09:43 GMT-05:00",
    "Informacion de Pago", "Acceso por 2 horas | $ 150.00 MXN", "Tax | $ 0.00 MXN", "Tipo de pago: VISA ***4242", "Total | $ 150.00 MXN", "Para ver su factura, visite: https://facturas.example/wifi"]) };

// ---- PayPal's authorisation for a ride: no purchase of its own ---------------------------------------------------------------
export const RIDE_AUTH = { from: '"service@paypal.co.uk" <service@paypal.co.uk>', subject: "UBER PAYMENTS UK LIM...: £12.40 GBP", date: "Fri, 13 Mar 2026 22:41:00 +0000",
  html: pp(["UBER PAYMENTS UK LIM...: £12.40 GBP", "Authorised with UBER PAYMENTS UK LIM....", `Hello, ${SHOPPER.name}`, "You've authorised £12.40 GBP to UBER PAYMENTS UK LIM...",
    "Merchant", "UBER PAYMENTS UK LIM...", "Transaction date", "13 Mar 2026", "Order ID", "9x8ExampleRideRef7", "Subtotal", "£12.40", "Total", "£12.40 GBP", "Authorised with", "PayPal Credit", "£12.40 GBP",
    "You’ll see this purchase as pending in your payment status until UBER PAYMENTS UK LIM... processes it. We'll send you another receipt if the final amount changes."]) };

export default function holdout24() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  add("holdout24-reseller-maker-is-shop", "Paddle", "'PhotoTidy (via Paddle.com)': the maker is the shop; the thing over its price before VAT, 'VAT (20%)' over its amount, 'Amount Paid' over the total",
    RESELLER, order([{ name: "PhotoTidy Pro Subscription - 2 devices", qty: 1, unit: 2499 }], { fees: [["VAT", 500]] }), "PhotoTidy", "2026-01-12", { orderRef: "11223344-55667788" });
  add("holdout24-shipping-via", "Hound & Harness", "'Shipping: | £4.95 via Next Day': the delivery charge, with how it was sent after it",
    SHIPPED_VIA, order([{ name: "Rope Slip Lead - Forest Green, 1.5m", qty: 1, unit: 1850 }], { fees: [["Shipping", 495]] }), "Hound & Harness", "2026-06-07", { orderRef: "77310" });
  return out;
}
