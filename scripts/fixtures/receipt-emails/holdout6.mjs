// A seventh set of made-up emails (see lib.mjs): fifteen layouts written for round 3 of the item reader (19 Nov 2026), after
// holdout5 was fixed, unlike anything already in the corpus, and run BEFORE any change for them (their first-try scores are
// in the round 3 commit). Definition lists, list items with dashes, tab-separated text, a marketplace with a seller block
// each, a restaurant's discretionary service charge, amounts written "GBP 12.00", a bowl with options two levels deep, a
// supermarket's "Ordered / You received" substitutions, struck-through old prices, a per-item multibuy saving, an appliance
// with fitting and removal charges, cinema tickets, a size column, a meal deal whose parts cost £0.00 and a hotel stay.
// Every shop order, person, address and number here is made up.
import { order, expected, page, table, moneyRows, moneyText, fixture, gbp, h } from "./lib.mjs";

export default function holdout6() {
  const out = [];
  const add = (id, sender, layout, mail, o, shop, date, extra) => out.push(fixture(id, sender, layout, mail, expected(shop, date, o, extra)));

  {
    // A definition list: each item's name a <dt>, its price a <dd>, its quantity a second <dd>.
    const o = order([{ name: "Personalised Leather Keyring", qty: 1, unit: 1800 }, { name: "Botanical Print A3", qty: 2, unit: 2200 }], { fees: [["Delivery", 395]] });
    const dl = `<dl>${o.lines.map((i) => `<dt>${h(i.name)}</dt><dd>Quantity: ${i.qty}</dd><dd>${gbp(i.line)}</dd>`).join("")}</dl>`;
    add("holdout6-papier-dl", "Papier", "<dl>: name <dt>, quantity and price <dd>", { from: "Papier <hello@papier.com>", subject: "Your Papier order PA-220913", date: "Tue, 17 Nov 2026 10:00:00 +0000",
      html: page({ brand: "Papier", domain: "papier.com", rows: [`<p>Order number: PA-220913</p>`, `<p>Order date: 17 November 2026</p>`, dl, table(moneyRows(o))] }) }, o, "Papier", "2026-11-17");
  }
  {
    // List items: "Name — £12.00 (x2)", the line's price before how many.
    const o = order([{ name: "Matcha Ceremonial Grade 30g", qty: 1, unit: 2400 }, { name: "Bamboo Whisk", qty: 2, unit: 900 }], { fees: [["Royal Mail 2nd Class", 299]] });
    add("holdout6-teapigs-li-dash", "Leaf & Whisk", "<li>: 'Name — £18.00 (x2)'", { from: "Leaf & Whisk <orders@leafandwhisk.co.uk>", subject: "Order #LW-5521 confirmed", date: "Mon, 16 Nov 2026 12:00:00 +0000",
      html: page({ brand: "Leaf & Whisk", domain: "leafandwhisk.co.uk", rows: [`<p>Order #LW-5521</p>`, `<p>Placed on 16 November 2026</p>`,
        `<ul>${o.lines.map((i) => `<li>${h(i.name)} — ${gbp(i.line)} (x${i.qty})</li>`).join("")}</ul>`, table(moneyRows(o))] }) }, o, "Leaf & Whisk", "2026-11-16");
  }
  {
    // Plain text columns separated by tabs, with a heading row: Qty, Item, Price (the line's).
    const o = order([{ name: "Sourdough Starter Kit", qty: 1, unit: 1450 }, { name: "Banneton Proving Basket 25cm", qty: 2, unit: 1200 }, { name: "Bread Lame with 5 Blades", qty: 1, unit: 650 }], { fees: [["Shipping", 450]] });
    add("holdout6-bakerybits-tabs", "Bread Kit Co", "text: tab-separated Qty, Item, Price", { from: "Bread Kit Co <orders@breadkitco.co.uk>", subject: "Order confirmation BK-77310", date: "Sun, 15 Nov 2026 09:00:00 +0000",
      text: ["Bread Kit Co", "Order number: BK-77310", "Order date: 15/11/2026", "", "Qty\tItem\tPrice", ...o.lines.map((i) => `${i.qty}\t${i.name}\t${gbp(i.line)}`), "", moneyText(o, {}, "\t")].join("\n") }, o, "Bread Kit Co", "2026-11-15");
  }
  {
    // A marketplace: one block per seller, each with "Sold by", its items, its own delivery and its own dispatch date.
    const o = order([{ name: "Hand Stamped Silver Necklace", qty: 1, unit: 3500 }, { name: "Gift Box", qty: 1, unit: 300 }, { name: "Personalised Wooden Chopping Board", qty: 1, unit: 4200 }], { fees: [["Delivery (Silver & Stone)", 350], ["Delivery (Grain Studio)", 495]] });
    const block = (seller, items, del, when) => [`<p><strong>Sold by ${seller}</strong></p>`, `<p>Estimated dispatch: ${when}</p>`, table([...items.map((i) => [h(i.name), `Qty ${i.qty}`, gbp(i.line)]), ["Delivery", gbp(del)]])];
    add("holdout6-noths-seller-blocks", "Notonthehighstreet", "a block per seller with its own delivery and dispatch", { from: "notonthehighstreet <orders@notonthehighstreet.com>", subject: "Thanks for your order N-88120034", date: "Sat, 14 Nov 2026 19:00:00 +0000",
      html: page({ brand: "notonthehighstreet", domain: "notonthehighstreet.com", rows: [`<p>Order number: N-88120034</p>`, `<p>Order date: 14 November 2026</p>`,
        ...block("Silver & Stone", o.lines.slice(0, 2), 350, "18 November 2026"), ...block("Grain Studio", o.lines.slice(2), 495, "24 November 2026"),
        table([["Items", gbp(o.subtotal)], ["Delivery", gbp(845)], ["<strong>Total</strong>", `<strong>${gbp(o.total)}</strong>`]])] }) }, o, "notonthehighstreet", "2026-11-14", { shopAlso: ["Notonthehighstreet"] });
  }
  {
    // A restaurant bill: covers, a discretionary service charge as a percentage, and the card's tip on top.
    const o = order([{ name: "Burrata", qty: 1, unit: 1100 }, { name: "Cacio e Pepe", qty: 2, unit: 1600 }, { name: "Tiramisu", qty: 1, unit: 800 }, { name: "House Red 500ml", qty: 1, unit: 2400 }], { fees: [["Discretionary service (12.5%)", 938]] });
    add("holdout6-trattoria-service-pct", "Trattoria Lina", "covers, 'Discretionary service (12.5%)'", { from: "Trattoria Lina <receipts@trattorialina.co.uk>", subject: "Your receipt from Trattoria Lina", date: "Fri, 13 Nov 2026 22:30:00 +0000",
      text: ["Trattoria Lina", "Table 7  Covers 2", "13/11/2026 22:14", "Check 3310", "", ...o.lines.map((i) => `${i.qty} ${i.name}    ${gbp(i.line)}`), "", moneyText(o, {}, "    "), "Paid Visa ****"].join("\n") }, o, "Trattoria Lina", "2026-11-13");
  }
  {
    // Amounts written "GBP 12.00" with no pound sign anywhere, in an HTML table.
    const o = order([{ name: "Running Socks 3 Pack", qty: 1, unit: 1500 }, { name: "Reflective Arm Band", qty: 2, unit: 700 }], { fees: [["Shipping", 395]] });
    const g = (p) => "GBP " + (p / 100).toFixed(2);
    add("holdout6-stridestore-gbp-word", "Stride Store", "'GBP 15.00' amounts, no £", { from: "Stride Store <shop@stridestore.co.uk>", subject: "Order SS-40112 confirmed", date: "Thu, 12 Nov 2026 08:00:00 +0000",
      html: page({ brand: "Stride Store", domain: "stridestore.co.uk", rows: [`<p>Order SS-40112</p>`, `<p>Order date: 12 November 2026</p>`,
        table([["Item", "Qty", "Total"], ...o.lines.map((i) => [h(i.name), String(i.qty), g(i.line)])]), table([["Subtotal", g(o.subtotal)], ["Shipping", g(395)], ["Total", g(o.total)]])] }) }, o, "Stride Store", "2026-11-12");
  }
  {
    // A bowl built from options two levels deep, an option's own price in brackets "(+£1.50)", included in the bowl's price.
    const o = order([{ name: "Build Your Own Bowl", qty: 1, unit: 1250, extras: ["Brown Rice", "Teriyaki Chicken"] }, { name: "Miso Soup", qty: 1, unit: 350 }], { fees: [["Delivery fee", 199], ["Service fee", 99]] });
    add("holdout6-pokebar-two-levels", "Poke Bar", "options two levels deep, '(+£1.50)'", { from: "Poke Bar <orders@pokebar.co.uk>", subject: "Your Poke Bar order #PB2231", date: "Wed, 11 Nov 2026 13:10:00 +0000",
      text: ["Poke Bar", "Order #PB2231", "11 November 2026 13:02", "", "1 x Build Your Own Bowl   £12.50", "   Base", "      Brown Rice", "   Protein", "      Teriyaki Chicken (+£1.50)", "   Toppings", "      Edamame", "      Pickled Ginger",
        "1 x Miso Soup   £3.50", "", moneyText(o, {}, "   ")].join("\n") }, o, "Poke Bar", "2026-11-11");
  }
  {
    // A supermarket's substitutions: "Ordered: …" then "You received: …" with the price of what came.
    const o = order([{ name: "Heinz Baked Beans 415g", qty: 4, unit: 140 }, { name: "Cathedral City Mature 350g", qty: 1, unit: 425 }, { name: "Hovis Seed Sensations 800g", qty: 1, unit: 175 }], { fees: [["Delivery", 300]] });
    add("holdout6-iceland-ordered-received", "Iceland", "'Ordered: X' then 'You received: Y'", { from: "Iceland <groceries@iceland.co.uk>", subject: "Your Iceland delivery receipt 7711204", date: "Tue, 10 Nov 2026 18:00:00 +0000",
      text: ["Iceland", "Order number: 7711204", "Delivered 10 November 2026", "", "Heinz Baked Beans 415g", "Qty 4   £5.60", "", "Substitutions", "Ordered: Pilgrims Choice Mature 350g", "You received: Cathedral City Mature 350g", "Qty 1   £4.25", "",
        "Hovis Seed Sensations 800g", "Qty 1   £1.75", "", moneyText(o, {}, "   ")].join("\n") }, o, "Iceland", "2026-11-10");
  }
  {
    // The old price struck through in the same cell as the price paid: "<s>£40.00</s> £28.00".
    const o = order([{ name: "Quilted Gilet Navy", qty: 1, unit: 2800 }, { name: "Fleece Lined Leggings", qty: 2, unit: 1500 }], { fees: [["Standard delivery", 399]] });
    add("holdout6-mountainpeak-strike-cell", "Mountain Peak", "'<s>£40.00</s> £28.00' in one cell", { from: "Mountain Peak <orders@mountainpeak.co.uk>", subject: "Mountain Peak order confirmation MP-661204", date: "Mon, 9 Nov 2026 07:30:00 +0000",
      html: page({ brand: "Mountain Peak", domain: "mountainpeak.co.uk", rows: [`<p>Order number: MP-661204</p>`, `<p>Order date: 09/11/2026</p>`,
        table([["Item", "Qty", "Price"], [h(o.lines[0].name), "1", `<s>${gbp(4000)}</s> ${gbp(2800)}`], [h(o.lines[1].name), "2", `<s>${gbp(4000)}</s> ${gbp(3000)}`]]), table(moneyRows(o))] }) }, o, "Mountain Peak", "2026-11-09");
  }
  {
    // A multibuy saving on a line of its own under the item it belongs to; the subtotal is before the saving.
    const o = order([{ name: "Pantene Shampoo 400ml", qty: 3, unit: 450 }, { name: "Colgate Total Toothpaste 125ml", qty: 1, unit: 350 }], { discounts: [["Multibuy saving", 450]], fees: [["Delivery", 0]] });
    add("holdout6-savers-multibuy-under", "Savers", "'Multibuy saving -£4.50' under the item", { from: "Savers <orders@savers.co.uk>", subject: "Your Savers order SV-1188", date: "Sun, 8 Nov 2026 16:00:00 +0000",
      html: page({ brand: "Savers", domain: "savers.co.uk", rows: [`<p>Order number: SV-1188</p>`, `<p>Order date: 8 November 2026</p>`,
        table([[h(o.lines[0].name), "Qty 3", gbp(1350)], ["", "3 for 2 multibuy saving", gbp(-450)], [h(o.lines[1].name), "Qty 1", gbp(350)]]), table(moneyRows(o, { free: "FREE" }))] }) }, o, "Savers", "2026-11-08");
  }
  {
    // An appliance with fitting and taking the old one away, each charged on its own line under the money.
    const o = order([{ name: "Bosch Serie 4 Washing Machine 9kg", qty: 1, unit: 49900 }], { fees: [["Delivery", 0], ["Installation", 3000], ["Removal of old appliance", 2000]] });
    add("holdout6-ao-install-removal", "AO", "installation and removal of old appliance charges", { from: "AO.com <orders@ao.com>", subject: "Your AO order is confirmed AO-55123390", date: "Sat, 7 Nov 2026 11:00:00 +0000",
      html: page({ brand: "AO.com", domain: "ao.com", rows: [`<p>Order number: AO-55123390</p>`, `<p>Order date: 7 November 2026</p>`,
        table([[h(o.lines[0].name), "Qty: 1", gbp(49900)]]), table(moneyRows(o, { free: "Free" }))] }) }, o, "AO.com", "2026-11-07", { shopAlso: ["AO"] });
  }
  {
    // Cinema tickets: "Adult x 2" with the line's price, a booking fee, a snack bundle.
    const o = order([{ name: "Adult", qty: 2, unit: 1250 }, { name: "Child", qty: 1, unit: 850 }, { name: "Large Popcorn Combo", qty: 1, unit: 950 }], { fees: [["Booking fee", 195]] });
    add("holdout6-picturehouse-tickets", "Riverside Cinema", "'Adult x 2  £25.00', a booking fee", { from: "Riverside Cinema <tickets@riversidecinema.co.uk>", subject: "Your tickets for Paddington in Peru - booking RC-90021", date: "Fri, 6 Nov 2026 17:00:00 +0000",
      text: ["Riverside Cinema", "Booking reference: RC-90021", "Booked on 6 November 2026", "", "Paddington in Peru (PG)", "Sunday 8 November 2026, 14:30, Screen 2", "Seats E7, E8, E9", "",
        "Adult x 2   £25.00", "Child x 1   £8.50", "Large Popcorn Combo   £9.50", "", moneyText(o, {}, "   ")].join("\n") }, o, "Riverside Cinema", "2026-11-06");
  }
  {
    // Item, Size, Qty and Price columns, with sizes such as "M" and "UK 9" in their own column.
    const o = order([{ name: "Merino Base Layer Top", qty: 1, unit: 5500 }, { name: "Trail Running Shoes", qty: 1, unit: 11000 }, { name: "Running Cap", qty: 2, unit: 1800 }], { fees: [["Delivery", 0]] });
    add("holdout6-trailhead-size-col", "Trailhead", "Item | Size | Qty | Price", { from: "Trailhead <orders@trailhead.co.uk>", subject: "Trailhead order TH-30091 confirmed", date: "Thu, 5 Nov 2026 14:00:00 +0000",
      html: page({ brand: "Trailhead", domain: "trailhead.co.uk", rows: [`<p>Order number: TH-30091</p>`, `<p>Order date: 5 November 2026</p>`,
        table([["Item", "Size", "Qty", "Price"], [h(o.lines[0].name), "M", "1", gbp(5500)], [h(o.lines[1].name), "UK 9", "1", gbp(11000)], [h(o.lines[2].name), "One Size", "2", gbp(3600)]]), table(moneyRows(o, { free: "FREE" }))] }) }, o, "Trailhead", "2026-11-05");
  }
  {
    // A meal deal whose parts are listed under it at £0.00 each: the parts are the deal's, not items.
    const o = order([{ name: "Meal Deal", qty: 1, unit: 550, extras: ["Chicken Club Sandwich"] }, { name: "Flat White", qty: 1, unit: 320 }]);
    add("holdout6-cornershop-mealdeal-zero", "Daily Bread", "meal deal parts at £0.00 under it", { from: "Daily Bread <receipts@dailybread.co.uk>", subject: "Your receipt from Daily Bread", date: "Wed, 4 Nov 2026 12:40:00 +0000",
      text: ["Daily Bread Kings Cross", "Receipt 4410-221", "04/11/2026 12:38", "", "Meal Deal   £5.50", "  Chicken Club Sandwich   £0.00", "  Sea Salt Crisps   £0.00", "  Still Water 500ml   £0.00", "Flat White   £3.20", "", "Total   £8.70", "Card   £8.70"].join("\n") }, o, "Daily Bread", "2026-11-04");
  }
  {
    // A hotel stay: the room as "3 nights x £95.00", breakfast as its own line, and a city tax.
    const o = order([{ name: "Superior King Room", qty: 1, unit: 28500 }, { name: "Breakfast for 2", qty: 1, unit: 3000 }], { fees: [["City visitor levy", 600]] });
    add("holdout6-harbourinn-nights", "Harbour Inn", "'3 nights x £95.00' room line", { from: "Harbour Inn <stay@harbourinn.co.uk>", subject: "Your booking is confirmed at Harbour Inn", date: "Tue, 3 Nov 2026 20:00:00 +0000",
      html: page({ brand: "Harbour Inn", domain: "harbourinn.co.uk", rows: [`<p>Booking reference: HI-77102</p>`, `<p>Booked on 3 November 2026</p>`, `<p>Check-in: Fri 20 Nov 2026, Check-out: Mon 23 Nov 2026</p>`,
        table([["Superior King Room", "3 nights x £95.00", gbp(28500)], ["Breakfast for 2", "", gbp(3000)], ["City visitor levy", "", gbp(600)], ["<strong>Total</strong>", "", `<strong>${gbp(o.total)}</strong>`]])] }) }, o, "Harbour Inn", "2026-11-03");
  }
  return out;
}
