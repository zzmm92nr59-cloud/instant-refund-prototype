// A fifth set of made-up emails (see lib.mjs): ten more layouts written AFTER round 2's fixes (19 Nov 2026) and run before
// any change for them, to measure the reader on layouts it was not written for. Every order, person and number is made up.
import { order, expected, page, table, moneyRows, moneyText, fixture, gbp, h } from "./lib.mjs";

const eurComma = (c) => (c / 100).toFixed(2).replace(".", ",") + " €";

export default function holdout4() {
  const out = [];
  const add = (id, sender, layout, mail, o, shop, date, extra) => out.push(fixture(id, sender, layout, mail, expected(shop, date, o, extra)));
  {
    // Plain text with Qty, Price and Total columns, and a multi-buy saving under the items it applies to.
    const o = order([{ name: "Iceland Battered Cod Fillets 4 Pack", qty: 3, unit: 200 }, { name: "McCain Home Chips 1.5kg", qty: 1, unit: 350 }, { name: "Iceland Garden Peas 1kg", qty: 2, unit: 125 }], { discounts: [["Multi-buy 3 for £5.00", 100]], fees: [["Delivery", 0]] });
    add("holdout4-iceland-text-multibuy", "Iceland", "text columns, a multi-buy saving line", { from: "Iceland <orders@iceland.co.uk>", subject: "Your Iceland order confirmation 30019982", date: "Thu, 19 Nov 2026 19:00:00 +0000",
      text: ["Iceland Foods", "Order confirmation", "Order number: 30019982", "Order date: 19/11/2026", "", "Item                                   Qty   Price    Total",
        "Iceland Battered Cod Fillets 4 Pack      3   £2.00    £6.00", "  Multi-buy 3 for £5.00 saving                  -£1.00", "McCain Home Chips 1.5kg                  1   £3.50    £3.50", "Iceland Garden Peas 1kg                  2   £1.25    £2.50", "",
        moneyText(o, { subtotal: "Subtotal", free: "FREE" }, "   ")].join("\n") }, o, "Iceland", "2026-11-19", { shopAlso: ["Iceland Foods"] });
  }
  {
    // Was and Now in one cell with the saving in brackets, the quantity in brackets after the name.
    const o = order([{ name: "Wainwright's Grain Free Adult Dog Food 12kg", qty: 1, unit: 4950 }, { name: "Dentalife Daily Oral Care Large Dog Chews", qty: 2, unit: 450 }], { fees: [["Delivery", 0]] });
    add("holdout4-petsathome-was-now", "Pets at Home", "'(x2)' after the name, was/now with saving", { from: "Pets at Home <noreply@petsathome.com>", subject: "Thanks for your order PAH-44120098", date: "Wed, 18 Nov 2026 12:00:00 +0000",
      html: page({ brand: "Pets at Home", domain: "petsathome.com", rows: [`<p>Order number: PAH-44120098</p>`, `<p>18 November 2026</p>`,
        table([["Wainwright's Grain Free Adult Dog Food 12kg (x1)", "Was £55.00 Now £49.50 (save 10%)"], ["Dentalife Daily Oral Care Large Dog Chews (x2)", "£9.00"]]), table(moneyRows(o, { free: "FREE" }))] }) }, o, "Pets at Home", "2026-11-18");
  }
  {
    // Euros written the continental way: "39,95 €".
    const o = order([{ name: "Pier One Hoodie", qty: 1, unit: 3995 }, { name: "Anna Field Ankle Boots", qty: 1, unit: 5499 }], { fees: [["Shipping", 0]] });
    add("holdout4-zalando-eur-comma", "Zalando", "euros as '39,95 €'", { from: "Zalando <info@service-mail.zalando.de>", subject: "Thank you for your order 10109988776", date: "Tue, 17 Nov 2026 10:30:00 +0000",
      html: page({ brand: "Zalando", domain: "zalando.ie", rows: [`<p>Order number: 10109988776</p>`, `<p>Order date: 17.11.2026</p>`,
        table([["Pier One Hoodie<br />Size: L", "Quantity: 1", eurComma(3995)], ["Anna Field Ankle Boots<br />Size: 41", "Quantity: 1", eurComma(5499)]]),
        table([["Subtotal", eurComma(o.subtotal)], ["Shipping", "0,00 €"], ["<strong>Total</strong>", `<strong>${eurComma(o.total)}</strong>`]])] }) }, o, "Zalando", "2026-11-17", { currency: "EUR" });
  }
  {
    // A product with a fitting service at no charge, each as "1 x".
    const o = order([{ name: "Halfords Advanced Dash Cam HDC400", qty: 1, unit: 8999 }, { name: "Dash Cam Fitting", qty: 1, unit: 0 }, { name: "Halfords Screenwash 5L", qty: 2, unit: 500 }], { fees: [["Collection", 0]] });
    add("holdout4-halfords-free-fitting", "Halfords", "'1 x' lines, free fitting", { from: "Halfords <orders@halfords.com>", subject: "Your Halfords order confirmation", date: "Mon, 16 Nov 2026 14:00:00 +0000",
      text: ["Halfords", "Order number: HAL-8871203", "Order date: 16 November 2026", "Collect from: Halfords Leeds Kirkstall", "", "1 x Halfords Advanced Dash Cam HDC400 - £89.99", "1 x Dash Cam Fitting - FREE", "2 x Halfords Screenwash 5L - £10.00", "", moneyText(o, { free: "FREE" })].join("\n") },
      o, "Halfords", "2026-11-16");
  }
  {
    // A personalised gift: the personalisation on lines under the name, gift wrap as a fee.
    const o = order([{ name: "Personalised Star Map Print", qty: 1, unit: 3500, extras: ["Personalisation: Sam & Alex"] }, { name: "Scented Soy Candle Fig", qty: 1, unit: 1800 }], { fees: [["Gift wrap", 350], ["Delivery", 395]] });
    add("holdout4-noths-personalised", "Not On The High Street", "personalisation lines, gift wrap fee", { from: "notonthehighstreet <orders@notonthehighstreet.com>", subject: "Thanks for your order N1234-5566", date: "Sun, 15 Nov 2026 09:00:00 +0000",
      html: page({ brand: "notonthehighstreet", domain: "notonthehighstreet.com", rows: [`<p>Order N1234-5566</p>`, `<p>15 November 2026</p>`, `<p>From: Little Star Prints</p>`,
        table([["Personalised Star Map Print<br />Personalisation: Sam &amp; Alex<br />Date: 14th February 2020", "Qty: 1", "£35.00"], ["Scented Soy Candle Fig", "Qty: 1", "£18.00"]]), table(moneyRows(o))] }) },
      o, "notonthehighstreet", "2026-11-15", { shopAlso: ["Not On The High Street"] });
  }
  {
    // The unit price times how many ("£29.90 x 2") in a cell, the line's price in the next.
    const o = order([{ name: "Ultra Light Down Jacket", qty: 1, unit: 5990 }, { name: "HEATTECH Crew Neck T-Shirt", qty: 3, unit: 990 }], { fees: [["Delivery", 0]] });
    add("holdout4-uniqlo-unit-times", "Uniqlo", "'£9.90 x 3' then the line's price", { from: "UNIQLO <noreply@uniqlo.eu>", subject: "Order confirmation (Order No. 2611190044)", date: "Sat, 14 Nov 2026 18:00:00 +0000",
      html: page({ brand: "UNIQLO", domain: "uniqlo.com", rows: [`<p>Order No. 2611190044</p>`, `<p>Order date: 14/11/2026</p>`,
        table([["Ultra Light Down Jacket<br />Product number: 455555<br />Colour: 09 Black Size: M", "£59.90 x 1", "£59.90"], ["HEATTECH Crew Neck T-Shirt<br />Product number: 449993<br />Colour: 00 White Size: L", "£9.90 x 3", "£29.70"]]),
        table(moneyRows(o, { free: "Free" }))] }) }, o, "UNIQLO", "2026-11-14", { shopAlso: ["Uniqlo"] });
  }
  {
    // Buy one get one half price: the saving written between the items.
    const o = order([{ name: "LEGO Star Wars X-Wing Starfighter 75355", qty: 1, unit: 4999 }, { name: "LEGO City Fire Station 60320", qty: 1, unit: 3999 }], { discounts: [["Buy one get one half price", 2000]], fees: [["Home delivery", 399]] });
    add("holdout4-smyths-bogohp", "Smyths Toys", "BOGOHP saving between items", { from: "Smyths Toys <orders@smythstoys.com>", subject: "Smyths Toys order confirmation SMY-0099812", date: "Fri, 13 Nov 2026 20:00:00 +0000",
      html: page({ brand: "Smyths Toys", domain: "smythstoys.com", rows: [`<p>Order number: SMY-0099812</p>`, `<p>13/11/2026</p>`,
        table([["Product", "Qty", "Price"], ["LEGO Star Wars X-Wing Starfighter 75355", "1", "£49.99"], ["Buy one get one half price", "", "-£20.00"], ["LEGO City Fire Station 60320", "1", "£39.99"]]),
        table([["Subtotal", "£89.98"], ["Promotions", "-£20.00"], ["Home delivery", "£3.99"], ["<strong>Order total</strong>", `<strong>${gbp(o.total)}</strong>`]])] }) }, o, "Smyths Toys", "2026-11-13");
  }
  {
    // Tickets: "2 x Standing £65.00 each = £130.00", then per-ticket fees.
    const o = order([{ name: "General Admission Standing", qty: 2, unit: 6500 }], { fees: [["Service fee", 1350], ["Order processing fee", 275]] });
    add("holdout4-ticketmaster-each-equals", "Ticketmaster", "'2 x Name £65.00 each = £130.00'", { from: "Ticketmaster UK <customer_support@email.ticketmaster.co.uk>", subject: "You got the tickets! Order 12-34567/LDN", date: "Thu, 12 Nov 2026 10:00:00 +0000",
      text: ["Ticketmaster", "You got the tickets!", "Order number: 12-34567/LDN", "Order date: 12 November 2026", "", "The Example Band - UK Tour 2027", "First Direct Arena, Leeds, Sat 6 Mar 2027", "",
        "2 x General Admission Standing £65.00 each = £130.00", "Service fee: £13.50", "Order processing fee: £2.75", `Total: ${gbp(o.total)}`].join("\n") },
      o, "Ticketmaster", "2026-11-12", { shopAlso: ["Ticketmaster UK"] });
  }
  {
    // A restaurant bill: name, then the quantity, then the price, with a discretionary service charge.
    const o = order([{ name: "American Hot", qty: 1, unit: 1495 }, { name: "Dough Balls", qty: 2, unit: 595 }, { name: "Peroni 330ml", qty: 2, unit: 525 }], { fees: [["Discretionary service charge 12.5%", 466]] });
    add("holdout4-pizzaexpress-name-qty-price", "PizzaExpress", "Item | Qty | Price, service charge", { from: "PizzaExpress <receipts@pizzaexpress.com>", subject: "Your PizzaExpress receipt", date: "Wed, 11 Nov 2026 21:30:00 +0000",
      html: page({ brand: "PizzaExpress", domain: "pizzaexpress.com", rows: [`<p>PizzaExpress Leeds Corn Exchange</p>`, `<p>11/11/2026 21:28</p>`, `<p>Check 4471</p>`,
        table([["Item", "Qty", "Price"], ["American Hot", "1", "£14.95"], ["Dough Balls", "2", "£11.90"], ["Peroni 330ml", "2", "£10.50"]]), table(moneyRows(o))] }) }, o, "PizzaExpress", "2026-11-11");
  }
  {
    // A penny sale: the second item for 1p, on its own line.
    const o = order([{ name: "Holland & Barrett Vitamin D3 25ug 250 Tablets", qty: 1, unit: 999 }, { name: "Holland & Barrett Vitamin D3 25ug 250 Tablets", qty: 1, unit: 1 }, { name: "Nature's Garden Cashews 200g", qty: 1, unit: 449 }], { fees: [["Standard delivery", 399]] });
    add("holdout4-hb-penny-sale", "Holland & Barrett", "second item for 1p", { from: "Holland & Barrett <orders@hollandandbarrett.com>", subject: "Your Holland & Barrett order HB-55102", date: "Tue, 10 Nov 2026 13:00:00 +0000",
      text: ["Holland & Barrett", "Order confirmation", "Order number: HB-55102", "Date: 10 November 2026", "", "Holland & Barrett Vitamin D3 25ug 250 Tablets   Qty 1   £9.99", "Holland & Barrett Vitamin D3 25ug 250 Tablets   Qty 1   £0.01", "Nature's Garden Cashews 200g   Qty 1   £4.49", "", moneyText(o)].join("\n") },
      o, "Holland & Barrett", "2026-11-10");
  }
  return out;
}
