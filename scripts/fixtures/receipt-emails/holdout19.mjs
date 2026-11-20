// A twenty-second set of made-up emails (see lib.mjs), round 18 (20 Nov 2026): layouts of receipts in a real inbox that Relay
// still read wrongly after round 17, written again with everything in them made up (shops, airports' flights, items, prices,
// people, numbers). An airline itinerary whose reservation code and amount paid sit on lines below their labels; an airline
// that sets each airport on a line of its own with its time; an airline's fare, seat and fees lines; free partner gifts
// listed with their worth; a store receipt with no items but its money off; a trainer named by its model number over its
// style code (in scripts/test-receipt-real-18.mjs: its all-figure name is right only with the code under it); an invoice whose order number has no label; a trial set at £0.00 with a tax line named by its rate.
import { order, expected, page, fixture, h, gbp } from "./lib.mjs";

const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });

export default function holdout19() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };

  // ---- An airline itinerary: "Reservation:" over its code, "Total paid via" over the card, then the amount ---------------
  {
    const o = order([{ name: "Return flights London Stansted to Krakow", qty: 1, unit: 12450 }]);
    add("holdout19-airline-itinerary-labels-above", "Skylark", "'Reservation:' over 'K7QXPD'; each flight 'To Krakow LS1234', the airports '(STN) -' over '(KRK)'; 'Total paid via' 'Visa' 'ending in' '1234' over '124.50 GBP'",
      { from: "itinerary@skylark-air.example", subject: "Skylark Travel Itinerary", date: "Mon, 09 Nov 2026 18:10:00 +0000",
        html: mail("Skylark", "skylark-air.example", ["Destination::", "Krakow", "Reservation:", "K7QXPD", "Your flight information",
          "To Krakow LS1234", "London (Stansted) -", "Krakow", "Thu, 03 Dec 26", "Departure time - 13:15", "Arrival time - 16:30", "(STN) -", "(KRK)",
          "To London (Stansted) LS1235", "Krakow -", "London (Stansted)", "Mon, 07 Dec 26", "Departure time - 06:25", "Arrival time - 07:45", "(KRK) -", "(STN)",
          "Passenger(s):", "Ms SAM TAYLOR", "Flight out: | LS1234 | 25D", "Flight back: | LS1235 | 27D", "Receipt:", "Total paid via", "Visa", "ending in", "1234", "124.50 GBP",
          "VAT is not applicable on international flights."]) },
      o, "Skylark", "2026-11-09", { orderRef: "K7QXPD" });
  }
  // ---- An airline that puts each airport on a line of its own with its time, the trip summed up in the subject ------------
  {
    const o = order([{ name: "Return flights London Heathrow to Windhoek", qty: 1, unit: 145020 }]);
    const leg = (day, t1, a, t2, b, no) => [day, t1 + " h", a, "Terminal 2", t2 + " h", b, "Terminal 1", no, "operated by:", "Brightwing", "Status: confirmed"];
    add("holdout19-airline-airports-own-lines", "Brightwing", "subject 'Booking details | Departure: 6 March 2027 | LHR-WDH'; 'Brightwing booking code:' over 'PQRSTV'; each leg as 'Sat. 6 March 2027: London – Frankfurt', '15:30 h', 'London London Heathrow (LHR)', 'Terminal 2', '18:05 h', 'Frankfurt Frankfurt (FRA)', 'LH 1901'; 'Total Price for all Passengers' over 'GBP 1450.20'",
      { from: "Brightwing <online@booking.brightwing-air.example>", subject: "Booking details | Departure: 6 March 2027 | LHR-WDH", date: "Tue, 10 Nov 2026 13:02:00 +0000",
        html: mail("Brightwing", "brightwing-air.example", ["Brightwing booking code:", "PQRSTV", "Your itinerary",
          ...leg("Sat. 6 March 2027: London – Frankfurt", "15:30", "London London Heathrow (LHR)", "18:05", "Frankfurt Frankfurt (FRA)", "LH 1901"),
          ...leg("Sat. 6 March 2027: Frankfurt – Windhoek", "21:40", "Frankfurt Frankfurt (FRA)", "09:05", "Windhoek Windhoek Intl Apt (WDH)", "LH 1902"),
          ...leg("Sat. 20 March 2027: Windhoek – Frankfurt", "20:00", "Windhoek Windhoek Intl Apt (WDH)", "05:20", "Frankfurt Frankfurt (FRA)", "LH 1903"),
          ...leg("Sun. 21 March 2027: Frankfurt – London", "07:25", "Frankfurt Frankfurt (FRA)", "08:05", "London London Heathrow (LHR)", "LH 1904"),
          "Total Price of your Ticket", "Passenger Type | Price | Taxes, fees & surcharges | Passengers | Total Price of your Ticket", "Adult | GBP 1000.00 | GBP 450.20 | 1 | GBP 1450.20",
          "Total Price for all Passengers", "GBP 1450.20"]) },
      o, "Brightwing", "2026-11-10", { orderRef: "PQRSTV" });
  }
  // ---- An airline's fare, seat and fees lines in euros: the fees are fees, the flight what is left ---------------------
  {
    const o = order([{ name: "Flight London Gatwick to Barcelona", qty: 1, unit: 4010 }], { fees: [["Fees", 2990]] });
    const f = add("holdout19-airline-fare-and-fees", "Flyvia", "'Booking code ZXCVBN'; '| LGW | BCN |'; '1 adult | 40.10 EUR', '1 rear seat | 0.00 EUR', 'Fees | 29.90 EUR', 'Total: 70.00 EUR'",
      { from: "Flyvia Airlines <no-reply@flyvia.example>", subject: "Your booking confirmation - ZXCVBN LGW-BCN 19 December", date: "Wed, 11 Nov 2026 09:00:00 +0000",
        text: "| Booking code ZXCVBN |\n| Outbound | |\n| Saturday, 19 December 2026 |\n| London (Gatwick) (TS) | Barcelona (T1) |\n| LGW | BCN |\n| 07:20h | 10:35h |\n| VY6014 |\n| Passengers and services |\n| 1 adult | 40.10 EUR |\n| 1 rear seat | 0.00 EUR |\n| Fees | 29.90 EUR |\n| Total: 70.00 EUR |\n| Status: | | Confirmed |\n" },
      o, "Flyvia Airlines", "2026-11-11", { orderRef: "ZXCVBN" });
    f.expected.currency = "EUR";
  }
  // ---- A sports-nutrition shop: partner offers listed as free gifts with their worth, then taken off again ---------------
  {
    const its = [{ name: "Whey Isolate - 1kg - Vanilla", qty: 1, unit: 2499 }, { name: "Oat Bar - 12 x 60g - Toffee", qty: 1, unit: 1450 },
      { name: "10% off sitewide at Kettle!", qty: 1, unit: 0 }, { name: "Free MealKit box", qty: 1, unit: 0 }];
    const o = order(its, { discounts: [["Spring savings", 250]] });
    const lines = ["Thank you for your order"];
    const shown = { "10% off sitewide at Kettle!": 150, "Free MealKit box": 1200 };
    for (const i of its) lines.push(i.name, "Quantity", "1", "Price", gbp(shown[i.name] ?? i.unit));
    lines.push("Order Summary", "Order Number:", "662019384", "Order Date:", "2026-11-08 10:12 UTC", "Offers Used:", "Spring savings", "- " + gbp(250), "2 FREE gifts on all orders", "- " + gbp(1350), "Delivery:", gbp(0), "Total Cost:", gbp(o.total));
    add("holdout19-free-partner-gifts", "Proteo", "each line 'Name', 'Quantity', '1', 'Price', '£…'; two partner offers ('10% off sitewide at Kettle!' at £1.50, 'Free MealKit box' at £12.00) taken off again as '2 FREE gifts on all orders - £13.50'",
      { from: "Proteo <service@t.proteo-nutrition.example>", subject: "Thank you for your order", date: "Sun, 08 Nov 2026 10:13:00 +0000", html: mail("Proteo", "proteo-nutrition.example", lines) },
      o, "Proteo", "2026-11-08", { orderRef: "662019384" });
  }
  // ---- A till-free store's receipt: no items in the email, only its sum and the promotion -------------------------------
  {
    const f = fixture("holdout19-store-receipt-promotion-no-items", "Pantry Go", "'Your 6 November receipt for 2 items'; 'Trip time: 1m 40s'; 'Subtotal £8.00', 'Promotions applied - £1.00', 'Total £7.00'; no item lines",
      { from: "Pantry Go <auto-confirm@pantrygo.example>", subject: "Your 6 November receipt for 2 items", date: "Fri, 06 Nov 2026 17:00:00 +0000",
        text: "Thanks for shopping at Pantry Go\nOrder # 204-1111111-2222222\nTrip time: 1m 40s\nSubtotal £8.00\nPromotions applied - £1.00\nTotal £7.00\nFor further information about Pantry Go, please visit our home page.\n" },
      { shop: "Pantry Go", date: "2026-11-06", currency: "GBP", items: [], subtotalPence: 800, feesPence: 0, discountsPence: 100, tipsPence: 0, totalPence: 700, orderRef: "204-1111111-2222222" });
    out.push(f);
  }
  // ---- A software invoice: its order number in a cell of its own beside the subscription's dates, with no label -----------
  {
    const o = order([{ name: "Shieldly Total - 1 Device", qty: 1, unit: 4999 }]);
    add("holdout19-invoice-unlabelled-number", "Shieldly", "'Invoice receipt | £49.99'; '08 October 2026 expires on 07 November 2027 | CS1234567890 |'; 'Package', 'Shieldly Total - 1 Device | £49.99', 'Total Due | £49.99'",
      { from: "Shieldly <info@notification.shieldly.example>", subject: "Your Shieldly order confirmation", date: "Thu, 08 Oct 2026 09:30:00 +0000",
        html: mail("Shieldly", "shieldly.example", ["Thank you for being a loyal customer!", "Invoice receipt | £49.99", "08 October 2026 expires on 07 November 2027 | CS1234567890", "PACKAGE",
          "Shieldly Total - 1 Device | £49.99", "VAT / TAX | -", "Total Due | £49.99", "VISA", "Auto-renew: ON"]) },
      o, "Shieldly", "2026-10-08", { orderRef: "CS1234567890" });
  }
  // ---- A skincare trial: the set at £0.00 ("Free"), shipping, then a tax line named only by its rate --------------------
  {
    const o = order([{ name: "Calm Skin Duo", qty: 1, unit: 0, extras: ["Trial Set / Daily"] }], { fees: [["Shipping", 495], ["VAT", 99]] });
    add("holdout19-trial-set-rate-tax", "Dewbank", "'Order summary', 'Calm Skin Duo', '×', '1', 'Trial Set / Daily', 'SUBSCRIPTION PRICE', '(-£39.00)', '£39.00', 'Free'; 'Subtotal £0.00', 'Shipping £4.95', 'Standard Rate £0.99', 'Total £5.94 GBP'",
      { from: "Dewbank <support@dewbank.example>", subject: "Order #D7012345 confirmed", date: "Sat, 07 Nov 2026 15:25:00 +0000",
        html: mail("Dewbank", "dewbank.example", ["Thank you for your purchase!", "Order", "#D7012345", "Subscription Information", "Once your trial period has expired, you will be automatically enrolled into a subscription.",
          "Order summary", "Calm Skin Duo", "×", "1", "Trial Set / Daily", "SUBSCRIPTION PRICE", "(-£39.00)", "£39.00", "Free", "Subtotal", "£0.00", "Shipping", "£4.95", "Standard Rate", "£0.99", "Total", "£5.94 GBP"]) },
      o, "Dewbank", "2026-11-07", { orderRef: "D7012345" });
  }
  return out;
}

// The trainer's email, read in scripts/test-receipt-real-18.mjs (not in the corpus: "574" alone is no name, only over its
// labelled style code).
export const TRAINER = {
  id: "holdout19-trainer-model-number", sender: "Stridewell", layout: "",
  headers: { from: "Stridewell UK <stridewell@mail.stridewell.example>", subject: "Thank You for Your Order", date: "Thu, 05 Nov 2026 12:53:00 +0000", to: "sam.taylor@example.co.uk" }, text: "",
  html: mail("Stridewell", "stridewell.example", ["ORDER NUMBER: SW04040404", "SHIPPING METHOD", "Standard", "YOUR ORDER", "574", "Style #:", "ML574EV2", "UK Size: UK 8 - D", "Navy with Grey", "QUANTITY: 1", "PRICE: £75.00",
    "Order Subtotal: £75.00", "Discount: £7.50", "Shipping: £4.50", "Shipping Discount: £", "Order Total: £67.50"]),
};
