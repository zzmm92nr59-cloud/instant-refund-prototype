// Apps, subscriptions, travel and payment companies' receipts (made-up; see lib.mjs).
import { order, expected, page, table, moneyRows, moneyText, fixture, gbp, h, SHOPPER } from "./lib.mjs";

export default function digital() {
  const out = [];
  const add = (id, sender, layout, mail, o, shop, date, extra) => out.push(fixture(id, sender, layout, mail, expected(shop, date, o, extra)));

  // ---- Apple: App Store and Apple Store -------------------------------------------------------------------------------
  {
    const o = order([{ name: "5,000 Coins", qty: 1, unit: 159 }, { name: "Super Duolingo (Monthly)", qty: 1, unit: 1299 }]);
    const rows = [`<h1>Receipt</h1>`, table([["APPLE ACCOUNT", SHOPPER.email], ["DATE", "15 Nov 2026"], ["ORDER ID", "MX12AB34CD"], ["DOCUMENT NO.", "123456789012"]]),
      `<p><b>App Store</b></p>`, table([["Royal Match<br />5,000 Coins<br />In-App Purchase<br />Report a Problem", "£1.59"], ["Duolingo<br />Super Duolingo (Monthly)<br />Renews 15 Dec 2026<br />Report a Problem", "£12.99"]]),
      table([["Subtotal", gbp(o.subtotal)], ["VAT charged at 20%", "£2.43"], ["<b>TOTAL</b>", `<b>${gbp(o.total)}</b>`]]), `<p>Billed to Visa .... 1234</p>`];
    add("apple-app-store-1", "Apple App Store", "two purchases, app then what was bought", { from: "Apple <no_reply@email.apple.com>", subject: "Your receipt from Apple.", date: "Sun, 15 Nov 2026 10:00:00 +0000",
      html: page({ brand: "Apple", domain: "apple.com", rows }) }, o, "Apple", "2026-11-15");
  }
  {
    const o = order([{ name: "iCloud+ with 200 GB (Monthly)", qty: 1, unit: 299 }]);
    const text = ["Receipt", "", "APPLE ACCOUNT", SHOPPER.email, "DATE", "14 Nov 2026", "ORDER ID", "MX12AB35EF", "", "Apple Services", "iCloud+", "iCloud+ with 200 GB (Monthly)", "Renews 14 Dec 2026", "Report a Problem", "£2.99", "", "Subtotal", "£2.49", "VAT charged at 20%", "£0.50", "TOTAL", "£2.99"].join("\n");
    add("apple-app-store-2", "Apple App Store", "plain text, one subscription", { from: "Apple <no_reply@email.apple.com>", subject: "Your receipt from Apple.", date: "Sat, 14 Nov 2026 10:00:00 +0000", text }, { ...o, subtotal: o.subtotal }, "Apple", "2026-11-14", { subtotalPence: 249, feesPence: 50 });
  }
  {
    const o = order([{ name: "iPhone 17 256GB Black", qty: 1, unit: 89900 }, { name: "iPhone 17 Clear Case with MagSafe", qty: 1, unit: 4900 }, { name: "AppleCare+ for iPhone 17", qty: 1, unit: 12900 }], { fees: [["Delivery", 0]] });
    add("apple-store-1", "Apple Store", "online store order: product blocks with qty", { from: "Apple Store <order_acknowledgment@orders.apple.com>", subject: "We're processing your order W1234567890", date: "Fri, 13 Nov 2026 19:00:00 +0000",
      html: page({ brand: "Apple Store", domain: "apple.com", rows: [`<h1>Thanks for your order.</h1>`, `<p>Order Number: W1234567890</p>`, `<p>Ordered on: 13 Nov 2026</p>`,
        table(o.lines.map((i) => [h(i.name), `Qty ${i.qty}`, gbp(i.line)])), table(moneyRows(o, { free: "FREE", total: "Total" }))] }) }, o, "Apple Store", "2026-11-13", { shopAlso: ["Apple"] });
  }
  {
    const o = order([{ name: "AirPods 4", qty: 1, unit: 12900 }, { name: "USB-C to Lightning Cable (1 m)", qty: 2, unit: 1900 }]);
    add("apple-store-2", "Apple Store", "in-store receipt by email", { from: "Apple Store <noreply@email.apple.com>", subject: "Your receipt from Apple Leeds", date: "Thu, 12 Nov 2026 19:00:00 +0000",
      text: ["Apple Leeds", "Trinity Leeds", "12 Nov 2026", "Receipt number: R123-456789", "", ...o.lines.map((i) => `${i.name}\nQty ${i.qty}\n${gbp(i.line)}`), "", `Total ${gbp(o.total)}`, "Includes VAT of £29.50", "Visa .... 1234"].join("\n") }, o, "Apple Store", "2026-11-12", { shopAlso: ["Apple"] });
  }

  // ---- Trains --------------------------------------------------------------------------------------------------------
  {
    const o = order([{ name: "Leeds to London Kings Cross", qty: 1, unit: 8640 }], { fees: [["Booking fee", 150]] });
    out.push(fixture("trainline-1", "Trainline", "journey in the subject, tickets and booking fee", { from: "Trainline <auto-confirm@info.thetrainline.com>", subject: "Your booking confirmation for Leeds to London Kings Cross (20 November at 07:45)", date: "Tue, 10 Nov 2026 19:00:00 +0000",
      html: page({ brand: "Trainline", domain: "thetrainline.com", rows: [`<p>Booking reference: TL7XQ2PL</p>`, `<p>Booked on 10 November 2026</p>`, table([["1 Adult", "Anytime Day Return", gbp(8640)], ["Booking fee", gbp(150)], ["Total paid", gbp(o.total)]])] }) },
      { ...expected("Trainline", "2026-11-10", o), items: [{ name: "Leeds to London Kings Cross", qty: 1, linePence: o.total }] }));
  }
  {
    const o = order([{ name: "York to Edinburgh", qty: 1, unit: 4510 }]);
    out.push(fixture("trainline-2", "Trainline", "return trip in the subject, text", { from: "Trainline <auto-confirm@info.thetrainline.com>", subject: "Your booking confirmation for return trip York to Edinburgh (5 December at 09:10)", date: "Mon, 09 Nov 2026 19:00:00 +0000",
      text: ["Trainline", "Booking reference: TL7XQ3AB", "9 November 2026", "", "2 Adults", "Advance Single x 2", "Total paid £45.10"].join("\n") },
      { ...expected("Trainline", "2026-11-09", o), items: [{ name: "York to Edinburgh (return)", qty: 1, linePence: 4510 }] }));
  }
  {
    const o = order([{ name: "London Kings Cross to Newcastle", qty: 1, unit: 6200 }]);
    out.push(fixture("lner-1", "LNER", "ticket booking with journey in subject", { from: "LNER <tickets@lner.co.uk>", subject: "Your LNER tickets for London Kings Cross to Newcastle", date: "Sun, 08 Nov 2026 19:00:00 +0000",
      html: page({ brand: "LNER", domain: "lner.co.uk", rows: [`<p>Booking reference: LN4K9QZ</p>`, `<p>8 November 2026</p>`, table([["Advance Single (Standard)", "1 Adult", gbp(6200)], ["Total", gbp(6200)]])] }) },
      { ...expected("LNER", "2026-11-08", o), items: [{ name: "London Kings Cross to Newcastle", qty: 1, linePence: 6200 }] }));
  }
  {
    const o = order([{ name: "Seat reservation upgrade to First", qty: 1, unit: 2500 }, { name: "Seat reservation", qty: 1, unit: 0 }]);
    add("lner-2", "LNER", "upgrade receipt with item lines", { from: "LNER <tickets@lner.co.uk>", subject: "Your LNER receipt", date: "Sat, 07 Nov 2026 19:00:00 +0000",
      text: ["LNER", "Receipt", "Booking reference: LN4K9RA", "7 November 2026", "", ...o.lines.map((i) => `${i.name} ${gbp(i.line)}`), "", `Total ${gbp(o.total)}`].join("\n") }, o, "LNER", "2026-11-07");
  }

  // ---- Uber rides ----------------------------------------------------------------------------------------------------
  // (Round 10: a ride is one thing bought, the ride; its fees and tip are not things. Connor, 19 Nov. Round 16: the ride is
  // its fare, and the fees, tip and promotions sit beside it as what was added and taken off, so none is counted twice.)
  {
    const o = order([{ name: "Trip fare", qty: 1, unit: 1240 }], { fees: [["Booking fee", 175]], tips: [["Tip", 100]] });
    add("uber-1", "Uber", "ride receipt, fare + booking fee + tip", { from: "Uber Receipts <noreply@uber.com>", subject: "Your Friday evening trip with Uber", date: "Fri, 06 Nov 2026 22:00:00 +0000",
      html: page({ brand: "Uber", domain: "uber.com", rows: [`<p>Thanks for riding, ${SHOPPER.first}</p>`, `<p>6 November 2026</p>`, `<p style="font-size:28px">Total ${gbp(o.total)}</p>`, table([["Trip fare", gbp(1240)], ["Booking fee", gbp(175)], ["Tip", gbp(100)]]),
        `<p>Payments: Visa ••••1234</p>`] }) }, order([{ name: "Uber ride", qty: 1, unit: 1240 }], { fees: [["Booking fee", 175]], tips: [["Tip", 100]] }), "Uber", "2026-11-06");
  }
  {
    const o = order([{ name: "Trip fare", qty: 1, unit: 2210 }], { fees: [["Booking fee", 175], ["Airport surcharge", 600]], discounts: [["Promotion", 500]] });
    add("uber-2", "Uber", "text, airport surcharge, promotion", { from: "Uber Receipts <noreply@uber.com>", subject: "Your Thursday morning trip with Uber", date: "Thu, 05 Nov 2026 08:00:00 +0000",
      text: ["Uber", "Thanks for riding, Sam", "5 November 2026", `Total ${gbp(o.total)}`, "", "Trip fare " + gbp(2210), "Booking fee " + gbp(175), "Airport surcharge " + gbp(600), "Promotion -" + gbp(500).slice(0), "", "Payments", "Visa ••••1234 " + gbp(o.total)].join("\n") },
      order([{ name: "Uber ride", qty: 1, unit: 2210 }], { fees: [["Booking fee", 175], ["Airport surcharge", 600]], discounts: [["Promotion", 500]] }), "Uber", "2026-11-05");
  }

  // ---- Subscriptions -------------------------------------------------------------------------------------------------
  {
    const o = order([{ name: "Standard with adverts", qty: 1, unit: 599 }]);
    add("netflix-1", "Netflix", "monthly payment receipt", { from: "Netflix <info@account.netflix.com>", subject: "Your Netflix receipt", date: "Wed, 04 Nov 2026 06:00:00 +0000",
      html: page({ brand: "Netflix", domain: "netflix.com", rows: [`<p>Hi ${SHOPPER.first},</p><p>Thanks for your payment. Here's your receipt.</p>`, `<p>4 November 2026</p>`, table([["Plan", "Standard with adverts"], ["Amount", gbp(599)], ["Total", gbp(599)]]),
        `<p>Payment method: Visa ending 1234</p>`] }) }, { ...o }, "Netflix", "2026-11-04");
  }
  {
    const o = order([{ name: "Spotify Premium Family", qty: 1, unit: 2099 }]);
    add("spotify-1", "Spotify", "receipt text", { from: "Spotify <no-reply@spotify.com>", subject: "Your Spotify Premium receipt", date: "Tue, 03 Nov 2026 06:00:00 +0000",
      text: ["Spotify", "Receipt", "Order ID: 12345678901", "Date: 03/11/2026", "", "Spotify Premium Family  £20.99", "", "Total £20.99", "(includes VAT of £3.50)", "Paid with Visa ending 1234"].join("\n") }, o, "Spotify", "2026-11-03");
  }

  // ---- Pay later and payment companies --------------------------------------------------------------------------------
  {
    const o = order([{ name: "Align High-Rise Pant 25\"", qty: 1, unit: 9800 }]);
    add("klarna-1", "Klarna", "Pay in 3: purchase confirmation naming the shop and the item", { from: "Klarna <noreply@klarna.co.uk>", subject: "Your purchase with lululemon", date: "Mon, 02 Nov 2026 19:00:00 +0000",
      html: page({ brand: "Klarna", domain: "klarna.com", rows: [`<p>Payment received for lululemon</p>`, `<p>Order number: KL123-456-789</p>`, `<p>2 November 2026</p>`, table([["Align High-Rise Pant 25\"", "1", gbp(9800)]]),
        table([["Total", gbp(9800)], ["Paid today", gbp(3267)], ["Next payment 2 Dec 2026", gbp(3267)]])] }) }, o, "lululemon", "2026-11-02");
  }
  {
    const o = order([{ name: "(not listed)", qty: 1, unit: 15000 }]);
    out.push(fixture("klarna-2", "Klarna", "pay later summary with no item list", { from: "Klarna <noreply@klarna.co.uk>", subject: "Your purchase with John Lewis", date: "Sun, 01 Nov 2026 19:00:00 +0000",
      text: ["Klarna", "Payment received for John Lewis", "Order number: KL123-456-800", "1 November 2026", "", `Total ${gbp(15000)}`, "Pay in 30 days: due 1 December 2026"].join("\n") }, { ...expected("John Lewis", "2026-11-01", o), items: [] }));
  }
  {
    const o = order([{ name: "Fig & Cassis Candle", qty: 2, unit: 2200 }, { name: "Gift wrapping", qty: 1, unit: 300 }], { fees: [["Postage", 395]] });
    add("paypal-1", "PayPal", "You paid … to a shop, Description | Unit price | Qty | Amount", { from: "service@paypal.co.uk", subject: "Receipt for your payment to Hollow Oak Candles", date: "Sat, 31 Oct 2026 19:00:00 +0000",
      html: page({ brand: "PayPal", domain: "paypal.com", rows: [`<p>You sent a payment of ${gbp(o.total)} GBP to Hollow Oak Candles</p>`, `<p>Merchant: Hollow Oak Candles</p>`, `<p>Transaction ID: 1AB23456CD789012E</p>`, `<p>31 October 2026</p>`,
        table([["Description", "Unit price", "Qty", "Amount"], ...o.lines.map((i) => [h(i.name), gbp(i.unit), String(i.qty), gbp(i.line)])]), table([["Subtotal", gbp(o.subtotal)], ["Postage", gbp(395)], ["Total", gbp(o.total)]])] }) },
      o, "Hollow Oak Candles", "2026-10-31");
  }
  {
    const o = order([{ name: "Monthly Membership", qty: 1, unit: 3500 }]);
    add("paypal-2", "PayPal", "text receipt to a gym", { from: "service@paypal.co.uk", subject: "Receipt for your payment to Example Fitness Leeds", date: "Fri, 30 Oct 2026 19:00:00 +0000",
      text: ["PayPal", "You sent a payment of £35.00 GBP to Example Fitness Leeds", "Merchant: Example Fitness Leeds", "Transaction ID: 1AB23456CD789099F", "30 October 2026", "", "Monthly Membership £35.00", "", "Total £35.00"].join("\n") },
      o, "Example Fitness Leeds", "2026-10-30");
  }
  return out;
}
