// A fourth set of made-up emails (see lib.mjs), written for round 2 of the item reader (19 Nov 2026) in layouts the corpus
// had not seen, and run BEFORE any change for them: their first-try score is the honest measure of how well the reader
// copes with a layout it was not written for. Senders new to the corpus, and the formats that trip readers up: "2 x Item",
// "Item x2", "Qty: 3", unit prices beside line totals, multi-buys, meal deals and bundles with their parts, free items,
// substitutions and unavailable items, gift cards paid with, fees, tips, euros and dollars, rows split over two table
// rows, items that are only pictures with alt text, plain-text-only emails, a 42-line order, and refunds, cancellations
// and a price adjustment (never purchases). Every order, person, address and number here is made up.
import { order, expected, page, table, moneyRows, moneyText, fixture, gbp, h } from "./lib.mjs";

const money = (sym) => (p) => (p < 0 ? "-" : "") + sym + (Math.abs(p) / 100).toFixed(2);
const eur = money("€"), usd = money("US $");

export default function holdout3() {
  const out = [];
  const add = (id, sender, layout, mail, o, shop, date, extra) => out.push(fixture(id, sender, layout, mail, expected(shop, date, o, extra)));
  const not = (id, sender, layout, mail, notPurchase) => out.push(fixture(id, sender, layout, mail, { notPurchase, items: [], shop: null, date: null, currency: null, totalPence: null }));

  {
    // A 3 for 2 written in the item table under the items it applies to, and again in the summary.
    const o = order([{ name: "Superdrug Vitamin E Moisturising Cream 100ml", qty: 1, unit: 499 }, { name: "Superdrug Vitamin E Night Cream 50ml", qty: 1, unit: 499 }, { name: "B. Clean Micellar Water 400ml", qty: 1, unit: 549 }],
      { discounts: [["3 for 2 on skincare", 499]], fees: [["Standard delivery", 399]] });
    add("holdout3-superdrug-3for2-row", "Superdrug", "3 for 2 row inside the item table", { from: "Superdrug <orders@superdrug.com>", subject: "Thank you for your order 50012288", date: "Thu, 19 Nov 2026 08:30:00 +0000",
      html: page({ brand: "Superdrug", domain: "superdrug.com", rows: [`<p>Order number: 50012288</p>`, `<p>Order date: 19/11/2026</p>`,
        table([["Product", "Qty", "Price"], ["Superdrug Vitamin E Moisturising Cream 100ml", "1", "£4.99"], ["Superdrug Vitamin E Night Cream 50ml", "1", "£4.99"], ["B. Clean Micellar Water 400ml", "1", "£5.49"], ["3 for 2 on skincare", "", "-£4.99"]]),
        table(moneyRows(o, { subtotal: "Basket subtotal" }))] }) }, o, "Superdrug", "2026-11-19");
  }
  {
    // A product table with Qty, Unit price and Total columns, and a care plan on its own row.
    const o = order([{ name: "Samsung 55\" Crystal UHD 4K Smart TV UE55DU7100", qty: 1, unit: 47900 }, { name: "Care & Repair 3 years", qty: 1, unit: 9900 }, { name: "Logik 2m HDMI Cable", qty: 2, unit: 999 }], { fees: [["Delivery & installation", 2000]] });
    add("holdout3-currys-unit-and-total", "Currys", "Qty, Unit price and Total columns", { from: "Currys <orders@currys.co.uk>", subject: "Order confirmation - 6012-3344-98", date: "Wed, 18 Nov 2026 13:05:00 +0000",
      html: page({ brand: "Currys", domain: "currys.co.uk", rows: [`<p>Thanks for your order, Sam</p>`, `<p>Order number: 6012-3344-98</p>`, `<p>Order date: 18 November 2026</p>`,
        table([["Product", "Qty", "Unit price", "Total"], [h(o.lines[0].name), "1", "£479.00", "£479.00"], ["Care &amp; Repair 3 years", "1", "£99.00", "£99.00"], ["Logik 2m HDMI Cable", "2", "£9.99", "£19.98"]]),
        table(moneyRows(o, { subtotal: "Items" }))] }) }, o, "Currys", "2026-11-18");
  }
  {
    // "Name x2" in the name, its size under it, the price for the line.
    const o = order([{ name: "Nike Club Fleece Joggers", qty: 2, unit: 4500, extras: ["Size: M"] }, { name: "Nike Everyday Cushioned Socks 3 Pack", qty: 1, unit: 1600, extras: ["Size: L"] }], { fees: [["Delivery", 499]] });
    add("holdout3-jd-name-x2", "JD Sports", "'Name x2' then size, line price", { from: "JD Sports <noreply@jdsports.co.uk>", subject: "Your JD order JD7781-2290 is confirmed", date: "Tue, 17 Nov 2026 18:40:00 +0000",
      html: page({ brand: "JD Sports", domain: "jdsports.co.uk", rows: [`<p>Order JD7781-2290</p>`, `<p>17 November 2026</p>`,
        table([["Nike Club Fleece Joggers x2<br />Size: M", "£90.00"], ["Nike Everyday Cushioned Socks 3 Pack x1<br />Size: L", "£16.00"]]), table(moneyRows(o))] }) }, o, "JD Sports", "2026-11-17");
  }
  {
    // A free gift with the order at £0.00, and was/now prices.
    const o = order([{ name: "Karrimor Run Jacket Mens", qty: 1, unit: 2499 }, { name: "Everlast Training Gloves", qty: 1, unit: 1500 }, { name: "Free Sports Direct Mug", qty: 1, unit: 0 }], { fees: [["Home delivery", 499]] });
    add("holdout3-sportsdirect-free-gift", "Sports Direct", "free gift at £0.00, was/now", { from: "Sports Direct <noreply@sportsdirect.com>", subject: "Thanks for your order SD-55120987", date: "Mon, 16 Nov 2026 20:15:00 +0000",
      html: page({ brand: "Sports Direct", domain: "sportsdirect.com", rows: [`<p>Order number: SD-55120987</p>`, `<p>Order date: 16/11/2026</p>`,
        table([["Karrimor Run Jacket Mens<br />Colour: Black<br />Size: L", "Qty: 1", "Was £50.00<br />£24.99"], ["Everlast Training Gloves<br />Size: 12oz", "Qty: 1", "£15.00"], ["Free Sports Direct Mug", "Qty: 1", "£0.00"]]),
        table(moneyRows(o))] }) }, o, "Sports Direct", "2026-11-16");
  }
  {
    // Plain text only: "2 x Item £8.00", click and collect free.
    const o = order([{ name: "Fleece Pyjama Set", qty: 2, unit: 1200 }, { name: "Stitch Fluffy Socks 3 Pack", qty: 1, unit: 600 }, { name: "Ribbed Beanie Hat", qty: 3, unit: 350 }], { fees: [["Click & Collect", 0]] });
    add("holdout3-primark-text-2x", "Primark", "plain text, '2 x Item £24.00'", { from: "Primark <noreply@primark.com>", subject: "Your Primark Click & Collect order PK-338812", date: "Sun, 15 Nov 2026 11:00:00 +0000",
      text: ["PRIMARK", "", "Thanks for your Click & Collect order!", "Order number: PK-338812", "Order date: 15 November 2026", "Collect from: Primark Leeds Briggate", "", "2 x Fleece Pyjama Set £24.00", "1 x Stitch Fluffy Socks 3 Pack £6.00", "3 x Ribbed Beanie Hat £10.50", "", moneyText(o), "", "We'll email you when it's ready to collect."].join("\n") },
      o, "Primark", "2026-11-15");
  }
  {
    // Whole pounds with no pence ("£165"), as luxury shops write them.
    const o = order([{ name: "Le Labo Santal 33 Eau de Parfum 50ml", qty: 1, unit: 16500 }, { name: "Acne Studios Canada Wool Scarf", qty: 1, unit: 15000 }], { fees: [["Standard delivery", 0]] });
    add("holdout3-selfridges-whole-pounds", "Selfridges", "prices in whole pounds", { from: "Selfridges <orders@selfridges.com>", subject: "Your Selfridges order confirmation", date: "Sat, 14 Nov 2026 16:20:00 +0000",
      html: page({ brand: "Selfridges", domain: "selfridges.com", rows: [`<p>Order number: R4410098812</p>`, `<p>Date: 14 November 2026</p>`,
        table([["Le Labo Santal 33 Eau de Parfum 50ml<br />Quantity: 1", "£165"], ["Acne Studios Canada Wool Scarf<br />Colour: Grey<br />Quantity: 1", "£150"]]),
        table([["Subtotal", "£315"], ["Standard delivery", "Free"], ["<strong>Total</strong>", "<strong>£315</strong>"]])] }) }, o, "Selfridges", "2026-11-14");
  }
  {
    // A gift card paid with, "Qty 2 @ £15.00" beside a line total, product codes.
    const o = order([{ name: "John Lewis ANYDAY Cotton Bath Towel", qty: 2, unit: 1500 }, { name: "Le Creuset Stoneware Mug 350ml", qty: 1, unit: 2200 }], { discounts: [["Gift card", 2500]], fees: [["Delivery", 0]] });
    add("holdout3-johnlewis-giftcard", "John Lewis", "gift card paid with, 'Qty 2 @ £15.00'", { from: "John Lewis <orders@johnlewis.co.uk>", subject: "Thank you for your order 87001234", date: "Fri, 13 Nov 2026 19:30:00 +0000",
      html: page({ brand: "John Lewis", domain: "johnlewis.co.uk", rows: [`<p>Order number: 87001234</p>`, `<p>Order date: 13 November 2026</p>`,
        table([["John Lewis ANYDAY Cotton Bath Towel<br />Product code: 23004411", "Qty 2 @ £15.00", "£30.00"], ["Le Creuset Stoneware Mug 350ml<br />Product code: 23009982", "Qty 1 @ £22.00", "£22.00"]]),
        table([["Items", "£52.00"], ["Delivery", "Free"], ["Gift card", "-£25.00"], ["<strong>Total paid by card</strong>", `<strong>${gbp(o.total)}</strong>`]])] }) }, o, "John Lewis", "2026-11-13");
  }
  {
    // Each item over several lines: name, then size, "Quantity 1", "Price £35.00".
    const o = order([{ name: "Glamorous Satin Midi Dress", qty: 1, unit: 3500 }, { name: "V by Very Ankle Boots", qty: 1, unit: 4000 }], { fees: [["Next day delivery", 599]] });
    add("holdout3-very-stacked", "Very", "name, size, quantity, price on lines of their own", { from: "Very <orders@very.co.uk>", subject: "Thanks for your order", date: "Thu, 12 Nov 2026 21:10:00 +0000",
      text: ["very", "Thanks for your order, Sam", "Order number: V99812234", "Order date: 12/11/2026", "", "Glamorous Satin Midi Dress", "Size 12", "Quantity 1", "Price £35.00", "", "V by Very Ankle Boots", "Size 6", "Quantity 1", "Price £40.00", "", moneyText(o, { subtotal: "Goods total" })].join("\n") },
      o, "Very", "2026-11-12");
  }
  {
    // An appliance with services each on lines of their own ("Quantity:", "Price:"), one free.
    const o = order([{ name: "Bosch Series 4 WGG04409GB 9kg Washing Machine", qty: 1, unit: 42900 }, { name: "Remove and recycle your old appliance", qty: 1, unit: 2000 }, { name: "Connection", qty: 1, unit: 0 }], { fees: [["Delivery", 0]] });
    add("holdout3-ao-services", "AO.com", "appliance and services, a free one", { from: "AO.com <orders@ao.com>", subject: "Your AO order confirmation AO-4410098", date: "Wed, 11 Nov 2026 09:45:00 +0000",
      text: ["AO.com", "Order confirmation", "Order number: AO-4410098", "Order date: 11 November 2026", "", "Bosch Series 4 WGG04409GB 9kg Washing Machine", "Quantity: 1", "Price: £429.00", "", "Remove and recycle your old appliance", "Quantity: 1", "Price: £20.00", "", "Connection", "Quantity: 1", "Price: Free", "", "Delivery: Free", `Order total: ${gbp(o.total)}`].join("\n") },
      o, "AO.com", "2026-11-11", { shopAlso: ["AO"] });
  }
  {
    // A long DIY order (42 lines) in plain text columns: qty, description, unit price, line price.
    const names = ["Wickes Treated Sawn Timber 22x47mm 2.4m", "Wickes Treated Sawn Timber 38x63mm 2.4m", "Wickes General Purpose Screws 4x40mm 200pk", "Wickes Wood Screws 5x70mm 100pk", "Wickes Plasterboard 12.5mm 2.4m x 1.2m",
      "Wickes Multi Finish Plaster 25kg", "Wickes Bonding Coat 25kg", "Wickes PVA 5L", "Wickes Decorators Caulk 380ml", "Wickes Frame Sealant White 310ml", "Wickes Masking Tape 25mm x 50m", "Wickes Dust Sheet 12x9ft",
      "Wickes Vinyl Matt Emulsion Brilliant White 10L", "Wickes Trade Silk Magnolia 10L", "Wickes Paint Roller Set 9in", "Wickes Synthetic Paint Brush 2in", "Wickes Synthetic Paint Brush 1in", "Wickes Filler 1kg",
      "Wickes Sandpaper Assorted 10pk", "Wickes Sanding Block", "Wickes Stanley Knife Blades 10pk", "Wickes Spirit Level 600mm", "Wickes Tape Measure 5m", "Wickes Claw Hammer 16oz", "Wickes Plastering Trowel 11in",
      "Wickes Bucket 14L", "Wickes Mixing Paddle", "Wickes Plasterboard Screws 3.5x32mm 1000pk", "Wickes Angle Bead 2.4m", "Wickes Stop Bead 2.4m", "Wickes Scrim Tape 100mm x 90m", "Wickes Corner Trowel",
      "Wickes Skirting Board Torus 119mm x 2.4m", "Wickes Architrave Ogee 69mm x 2.1m", "Wickes Panel Pins 25mm 500g", "Wickes Wood Glue 1L", "Wickes Mitre Box and Saw", "Wickes Grab Adhesive 310ml",
      "Wickes Caulking Gun", "Wickes Knee Pads", "Wickes Safety Glasses", "Wickes Work Gloves Large"];
    const items = names.map((name, k) => ({ name, qty: 1 + (k % 4), unit: 150 + ((k * 137) % 2400) }));
    const o = order(items, { fees: [["Delivery", 1500]] });
    add("holdout3-wickes-42-lines", "Wickes", "42 lines, qty/description/each/total columns in plain text", { from: "Wickes <orders@wickes.co.uk>", subject: "Your Wickes order WK10098812 is confirmed", date: "Tue, 10 Nov 2026 07:55:00 +0000",
      text: ["Wickes", "Order confirmation", "Order number: WK10098812", "Order date: 10/11/2026", "", "Qty  Description                                            Each       Total",
        ...o.lines.map((l) => `${String(l.qty).padEnd(4)} ${l.name.padEnd(54)} ${gbp(l.unit).padStart(8)}   ${gbp(l.line).padStart(8)}`), "", moneyText(o, {}, "   ")].join("\n") },
      o, "Wickes", "2026-11-10");
  }
  {
    // Item, Quantity, Unit price, Line total as table columns, quantities of ten.
    const o = order([{ name: "Diall Wood Screws 4.0x40mm Pack of 200", qty: 2, unit: 598 }, { name: "Metsä Wood Planed Timber 18x44mm 2.4m", qty: 10, unit: 350 }, { name: "GoodHome Wood Glue 250ml", qty: 1, unit: 450 }], { fees: [["Click & Collect", 0]] });
    add("holdout3-bq-columns", "B&Q", "Item, Quantity, Unit price, Line total", { from: "B&Q <noreply@diy.com>", subject: "Your B&Q order is confirmed (BQ-2210987)", date: "Mon, 09 Nov 2026 12:30:00 +0000",
      html: page({ brand: "B&Q", domain: "diy.com", rows: [`<p>Order number: BQ-2210987</p>`, `<p>Placed on 9 November 2026</p>`,
        table([["Item", "Quantity", "Unit price", "Line total"], ...o.lines.map((l) => [h(l.name), String(l.qty), gbp(l.unit), gbp(l.line)])]), table(moneyRows(o))] }) }, o, "B&Q", "2026-11-09");
  }
  {
    // Items shown only as product pictures: the name is the picture's alt text.
    const o = order([{ name: "Dorma Pure Cotton Duvet Cover Set Double White", qty: 1, unit: 4500 }, { name: "Hotel 800 Thread Count Pillowcase Pair", qty: 2, unit: 1800 }], { fees: [["Delivery", 495]] });
    const img = (alt, k) => `<img src="https://www.dunelm.com/images/products/${3000 + k}.jpg" alt="${h(alt)}" width="120" height="120" border="0" />`;
    add("holdout3-dunelm-alt-only", "Dunelm", "item names only in image alt text", { from: "Dunelm <orders@dunelm.com>", subject: "Thanks for your Dunelm order D-77120", date: "Sun, 08 Nov 2026 10:05:00 +0000",
      html: page({ brand: "Dunelm", domain: "dunelm.com", rows: [`<p>Order number: D-77120</p>`, `<p>Order date: 8 November 2026</p>`,
        table(o.lines.map((l, k) => [img(l.name, k), `Qty: ${l.qty}`, gbp(l.line)])), table(moneyRows(o))] }) }, o, "Dunelm", "2026-11-08");
  }
  {
    // A supermarket e-receipt with no pound signs: amounts in a column with a VAT letter after, a weighed item, a multi-buy.
    const o = order([{ name: "Bananas Loose", qty: 1, unit: 65 }, { name: "Whole Milk 2 Pints", qty: 1, unit: 115 }, { name: "Sourdough Bloomer", qty: 1, unit: 149 }, { name: "Free Range Eggs 6", qty: 2, unit: 89 }], { discounts: [["Lidl Plus discount", 30]] });
    add("holdout3-lidl-plus-no-pound", "Lidl", "till receipt, no £ signs, VAT letters", { from: "Lidl Plus <noreply@lidlplus.co.uk>", subject: "Your Lidl Plus receipt", date: "Sat, 07 Nov 2026 17:22:00 +0000",
      text: ["Lidl GB", "Leeds Kirkstall", "Receipt 7731 07.11.26 17:21", "", "                              GBP", "Bananas Loose                0.65 A", "  0.540 kg x 1.20 GBP/kg", "Whole Milk 2 Pints           1.15 A", "Sourdough Bloomer            1.49 A",
        "Free Range Eggs 6            1.78 A", "  2 x 0.89", "Lidl Plus discount          -0.30", "------------------------------", `TOTAL                        ${(o.total / 100).toFixed(2)}`, `Card                         ${(o.total / 100).toFixed(2)}`, "", "Date: 07/11/2026"].join("\n") },
      o, "Lidl", "2026-11-07", { shopAlso: ["Lidl Plus", "Lidl GB"] });
  }
  {
    // A name in one table row and its quantity and price in the next.
    const o = order([{ name: "Specialbuys Crofton Cast Iron Casserole 5L", qty: 1, unit: 2499 }, { name: "Specialbuys Ambiano Hand Blender", qty: 1, unit: 1299 }], { fees: [["Delivery", 495]] });
    add("holdout3-aldi-split-rows", "Aldi", "name row, then qty and price row", { from: "Aldi UK <noreply@aldi.co.uk>", subject: "Your Aldi order confirmation", date: "Fri, 06 Nov 2026 08:00:00 +0000",
      html: page({ brand: "Aldi", domain: "aldi.co.uk", rows: [`<p>Order number: ALD-0049812</p>`, `<p>Order date: 06/11/2026</p>`,
        table([["Specialbuys Crofton Cast Iron Casserole 5L"], ["Qty 1", "£24.99"], ["Specialbuys Ambiano Hand Blender"], ["Qty 1", "£12.99"]]), table(moneyRows(o))] }) }, o, "Aldi", "2026-11-06", { shopAlso: ["Aldi UK"] });
  }
  {
    // Grocery delivery: delivered items, a substitution with what it replaced, an unavailable item, a bag charge.
    const o = order([{ name: "Co-op British Semi Skimmed Milk 2 Pints", qty: 2, unit: 145 }, { name: "Co-op Sourdough", qty: 1, unit: 175 }, { name: "Warburtons Toastie White 800g", qty: 1, unit: 165 }, { name: "Co-op Free Range Eggs 12", qty: 1, unit: 325, unavailable: true }],
      { fees: [["Delivery fee", 300], ["Bag charge", 10]] });
    add("holdout3-coop-subs", "Co-op", "substitution and unavailable sections", { from: "Co-op <orders@coop.co.uk>", subject: "Your Co-op delivery receipt", date: "Thu, 05 Nov 2026 18:00:00 +0000",
      text: ["Co-op", "Your Co-op order has been delivered", "Order number: COOP-778812", "Delivered: 5 November 2026", "", "Delivered items", "2 x Co-op British Semi Skimmed Milk 2 Pints  £2.90", "1 x Co-op Sourdough  £1.75", "",
        "Substitutions", "1 x Warburtons Toastie White 800g  £1.65", "   instead of Hovis Soft White Medium 800g", "", "Unavailable items", "1 x Co-op Free Range Eggs 12  £3.25", "", moneyText(o)].join("\n") },
      o, "Co-op", "2026-11-05");
  }
  {
    // "Item x2 £2.70" and a meal deal with its parts under it.
    const o = order([{ name: "Sausage Roll", qty: 2, unit: 135 }, { name: "Breakfast Deal", qty: 1, unit: 395, extras: ["Bacon Breakfast Roll", "Regular Latte"] }, { name: "Yum Yum", qty: 1, unit: 110 }]);
    add("holdout3-greggs-app", "Greggs", "'Item x2 £2.70', a deal with its parts", { from: "Greggs <noreply@greggs.co.uk>", subject: "Your Greggs order receipt", date: "Wed, 04 Nov 2026 08:12:00 +0000",
      text: ["Greggs", "Order #G-551209", "4 November 2026 08:11", "Collect from Leeds Station", "", "Sausage Roll x2  £2.70", "Breakfast Deal  £3.95", "  - Bacon Breakfast Roll", "  - Regular Latte", "Yum Yum  £1.10", "", `Total ${gbp(o.total)}`, "Paid with Visa ending 1234"].join("\n") },
      o, "Greggs", "2026-11-04");
  }
  {
    // A coffee app: size and extras as indented lines with their own prices, quantities as "x2" after.
    const o = order([{ name: "Medium Flat White", qty: 2, unit: 365 }, { name: "Large Cortado", qty: 1, unit: 395, extras: ["Oat Milk", "Extra Shot"] }, { name: "Ham & Cheese Toastie", qty: 1, unit: 450 }]);
    add("holdout3-costa-app", "Costa", "indented options, 'x2' after", { from: "Costa Coffee <noreply@costa.co.uk>", subject: "Your Costa Club receipt", date: "Tue, 03 Nov 2026 07:45:00 +0000",
      html: page({ brand: "Costa Coffee", domain: "costa.co.uk", rows: [`<p>Order #CC-881023</p>`, `<p>3 November 2026</p>`,
        table([["Medium Flat White", "x2", "£7.30"], ["Large Cortado", "x1", "£3.95"], ["&nbsp;&nbsp;Oat Milk", "", ""], ["&nbsp;&nbsp;Extra Shot", "", ""], ["Ham &amp; Cheese Toastie", "x1", "£4.50"]]),
        table([["<strong>Total</strong>", `<strong>${gbp(o.total)}</strong>`]])] }) }, o, "Costa", "2026-11-03", { shopAlso: ["Costa Coffee"] });
  }
  {
    // A restaurant bill with a fraction in a dish's name, a tip, and the quantity first.
    const o = order([{ name: "1/2 Chicken", qty: 1, unit: 1095 }, { name: "Peri Chips", qty: 2, unit: 395 }, { name: "Bottomless Soft Drink", qty: 2, unit: 375 }], { tips: [["Tip", 300]] });
    add("holdout3-nandos-fraction-tip", "Nando's", "a fraction in a name, a tip", { from: "Nando's <noreply@nandos.co.uk>", subject: "Your Nando's receipt", date: "Mon, 02 Nov 2026 20:30:00 +0000",
      html: page({ brand: "Nando's", domain: "nandos.co.uk", rows: [`<p>Receipt no: 4410-2287</p>`, `<p>2 November 2026</p>`,
        table([["1", "1/2 Chicken", "£10.95"], ["", "Spice: Medium", ""], ["2", "Peri Chips", "£7.90"], ["2", "Bottomless Soft Drink", "£7.50"]]),
        table(moneyRows(o))] }) }, o, "Nando's", "2026-11-02");
  }
  {
    // A service charge and a tip on top.
    const o = order([{ name: "Chicken Katsu Curry", qty: 2, unit: 1550 }, { name: "Yasai Gyoza", qty: 1, unit: 750 }, { name: "Raw Juice Clean Green", qty: 1, unit: 525 }], { fees: [["Service charge 12.5%", 600]], tips: [["Tip", 200]] });
    add("holdout3-wagamama-service", "Wagamama", "service charge and tip", { from: "wagamama <receipts@wagamama.com>", subject: "Your wagamama receipt", date: "Sun, 01 Nov 2026 19:50:00 +0000",
      text: ["wagamama", "Leeds Trinity", "1 November 2026", "Bill 2290", "", "Chicken Katsu Curry x2 ... £31.00", "Yasai Gyoza ... £7.50", "Raw Juice Clean Green ... £5.25", "", moneyText(o)].join("\n") },
      o, "wagamama", "2026-11-01", { shopAlso: ["Wagamama"] });
  }
  {
    // A deal with the pizzas inside it on lines under it, and a voucher code.
    const o = order([{ name: "Any 2 Large Pizzas Deal", qty: 1, unit: 3198, extras: ["Large Pepperoni", "Large The Works"] }, { name: "Garlic Parmesan Wedges", qty: 1, unit: 599 }], { discounts: [["Voucher PJ5OFF", 500]], fees: [["Delivery", 299]] });
    add("holdout3-papajohns-deal", "Papa John's", "a deal with its pizzas, a voucher", { from: "Papa John's <orders@papajohns.co.uk>", subject: "Thanks for your order from Papa John's", date: "Sat, 31 Oct 2026 19:10:00 +0000",
      html: page({ brand: "Papa John's", domain: "papajohns.co.uk", rows: [`<p>Order number: PJ-77812</p>`, `<p>31/10/2026</p>`,
        table([["1 x Any 2 Large Pizzas Deal", "£31.98"], ["&nbsp;&nbsp;&nbsp;Large Pepperoni", ""], ["&nbsp;&nbsp;&nbsp;Large The Works", ""], ["1 x Garlic Parmesan Wedges", "£5.99"]]),
        table(moneyRows(o))] }) }, o, "Papa John's", "2026-10-31");
  }
  {
    // The quantity in the first column, a meal's parts in the rows under it with empty cells.
    const o = order([{ name: "Zinger Tower Burger Meal", qty: 2, unit: 999, extras: ["Regular Fries", "Pepsi Max"] }, { name: "Popcorn Chicken Large", qty: 1, unit: 449 }], { fees: [["Delivery fee", 199], ["Service fee", 89]] });
    add("holdout3-kfc-meal-rows", "KFC", "qty column, meal parts in empty-cell rows", { from: "KFC <noreply@kfc.co.uk>", subject: "Your KFC order confirmation", date: "Fri, 30 Oct 2026 18:30:00 +0000",
      html: page({ brand: "KFC", domain: "kfc.co.uk", rows: [`<p>Order number: KFC-220981</p>`, `<p>30 October 2026</p>`,
        table([["Qty", "Item", "Price"], ["2", "Zinger Tower Burger Meal", "£19.98"], ["", "Regular Fries", ""], ["", "Pepsi Max", ""], ["1", "Popcorn Chicken Large", "£4.49"]]), table(moneyRows(o))] }) }, o, "KFC", "2026-10-30");
  }
  {
    // A recipe box: the box is the item, its recipes listed under it, a first-box discount.
    const o = order([{ name: "4 recipes for 2 people", qty: 1, unit: 4400, extras: ["Chicken Katsu with Sticky Rice"] }], { discounts: [["First box discount", 2200]], fees: [["Delivery", 0]] });
    add("holdout3-gousto-box", "Gousto", "a box with its recipes, first-box discount", { from: "Gousto <hello@gousto.co.uk>", subject: "Your Gousto order is confirmed", date: "Thu, 29 Oct 2026 12:00:00 +0000",
      html: page({ brand: "Gousto", domain: "gousto.co.uk", rows: [`<p>Order number: 1199-0087</p>`, `<p>Order date: 29 October 2026</p>`, `<p>Delivery: Tuesday 3 November</p>`,
        table([["4 recipes for 2 people", "£44.00"], ["Chicken Katsu with Sticky Rice", ""], ["Beef Ragu Rigatoni", ""], ["Thai Red Prawn Curry", ""], ["Halloumi Traybake", ""]]), table(moneyRows(o, { subtotal: "Box price" }))] }) }, o, "Gousto", "2026-10-29");
  }
  {
    // Plain text: "Plan:" then the plan, its price on its own labelled line.
    const o = order([{ name: "3 meals for 2 people", qty: 1, unit: 4299 }], { discounts: [["Discount code", 1500]], fees: [["Shipping", 499]] });
    add("holdout3-hellofresh-plan", "HelloFresh", "'Plan:' with a labelled price", { from: "HelloFresh <hello@hellofresh.co.uk>", subject: "Your HelloFresh order confirmation", date: "Wed, 28 Oct 2026 09:30:00 +0000",
      text: ["HelloFresh", "Order confirmation", "Order number: HF-98120034", "Order date: 28 October 2026", "", "Plan: 3 meals for 2 people", "Price: £42.99", "", "Discount code: -£15.00", "Shipping: £4.99", `Total: ${gbp(o.total)}`].join("\n") },
      o, "HelloFresh", "2026-10-28");
  }
  {
    // A unit price, then "x3" for how many (the line's cost isn't printed).
    const o = order([{ name: "Car Phone Holder Magnetic", qty: 3, unit: 349 }, { name: "LED Strip Lights 5m", qty: 1, unit: 599 }, { name: "Silicone Kitchen Utensil Set 12pcs", qty: 2, unit: 899 }], { fees: [["Shipping", 0]] });
    add("holdout3-temu-unit-then-x", "Temu", "unit price then 'x3'", { from: "Temu <orders@order.temu.com>", subject: "Your Temu order confirmation PO-211-0098", date: "Tue, 27 Oct 2026 22:00:00 +0000",
      html: page({ brand: "Temu", domain: "temu.com", rows: [`<p>Order ID: PO-211-0098</p>`, `<p>Order time: 27 Oct 2026</p>`,
        table(o.lines.map((l) => [h(l.name) + "<br />Black", gbp(l.unit) + "<br />x" + l.qty])), table([["Item(s) total", gbp(o.subtotal)], ["Shipping", "FREE"], ["<strong>Order total</strong>", `<strong>${gbp(o.total)}</strong>`]])] }) }, o, "Temu", "2026-10-27");
  }
  {
    // "Qty: 2" with a unit price and no line total.
    const o = order([{ name: "SHEIN Ribbed Knit Cardigan", qty: 2, unit: 1299 }, { name: "SHEIN Faux Leather Crossbody Bag", qty: 1, unit: 899 }], { fees: [["Shipping", 399]] });
    add("holdout3-shein-qty-unit", "SHEIN", "'Qty: 2' with the unit price", { from: "SHEIN <noreply@shein.com>", subject: "Your SHEIN order GSHNW44A1100 has been placed", date: "Mon, 26 Oct 2026 21:00:00 +0000",
      html: page({ brand: "SHEIN", domain: "shein.co.uk", rows: [`<p>Order number: GSHNW44A1100</p>`, `<p>Order date: 26/10/2026</p>`,
        table([["SHEIN Ribbed Knit Cardigan<br />Colour: Beige<br />Size: M", "£12.99", "Qty: 2"], ["SHEIN Faux Leather Crossbody Bag<br />Colour: Black", "£8.99", "Qty: 1"]]), table(moneyRows(o, { subtotal: "Retail price" }))] }) }, o, "SHEIN", "2026-10-26");
  }
  {
    // In US dollars, paid with a UK card.
    const o = order([{ name: "USB-C Hub 7-in-1", qty: 1, unit: 1899 }, { name: "Mechanical Keyboard Keycaps PBT", qty: 2, unit: 1250 }], { fees: [["Shipping", 0]] });
    const T = o.total;
    add("holdout3-aliexpress-usd", "AliExpress", "in US dollars", { from: "AliExpress <transaction@notice.aliexpress.com>", subject: "Order confirmed: 8190044221", date: "Sun, 25 Oct 2026 14:00:00 +0000",
      html: page({ brand: "AliExpress", domain: "aliexpress.com", rows: [`<p>Order number: 8190044221</p>`, `<p>Order date: 25 Oct 2026</p>`,
        table([["USB-C Hub 7-in-1", "x1", usd(1899)], ["Mechanical Keyboard Keycaps PBT", "x2", usd(2500)]]), table([["Subtotal", usd(o.subtotal)], ["Shipping", "Free"], ["<strong>Total</strong>", `<strong>${usd(T)}</strong>`]])] }) },
      o, "AliExpress", "2026-10-25", { currency: "USD" });
  }
  {
    // A hotel in euros: the room is the item, a city tax beside it.
    const o = order([{ name: "Deluxe Double Room", qty: 1, unit: 24000 }], { fees: [["City tax", 1200]] });
    add("holdout3-booking-eur", "Booking.com", "a room in euros, city tax", { from: "Booking.com <noreply@booking.com>", subject: "Your booking is confirmed at Hotel Prinsengracht", date: "Sat, 24 Oct 2026 10:00:00 +0000",
      html: page({ brand: "Booking.com", domain: "booking.com", rows: [`<p>Booking confirmation</p>`, `<p>Confirmation number: 4410982231</p>`, `<p>Booked on 24 October 2026</p>`, `<p>Hotel Prinsengracht, Amsterdam</p>`, `<p>Check-in: Fri 4 Dec 2026, Check-out: Sun 6 Dec 2026</p>`,
        table([["Deluxe Double Room", "2 nights", eur(24000)], ["City tax", "", eur(1200)], ["<strong>Total price</strong>", "", `<strong>${eur(o.total)}</strong>`]])] }) },
      o, "Booking.com", "2026-10-24", { currency: "EUR" });
  }
  {
    // "£85.00 x 3 nights" under the stay's name, then cleaning and service fees.
    const o = order([{ name: "Bright loft apartment in Ancoats", qty: 1, unit: 25500 }], { fees: [["Cleaning fee", 3500], ["Airbnb service fee", 4100]] });
    add("holdout3-airbnb-nights", "Airbnb", "'£85.00 x 3 nights' price breakdown", { from: "Airbnb <automated@airbnb.com>", subject: "Reservation confirmed for Manchester", date: "Fri, 23 Oct 2026 17:00:00 +0000",
      html: page({ brand: "Airbnb", domain: "airbnb.co.uk", rows: [`<p>Your reservation is confirmed</p>`, `<p>Confirmation code: HMX4412ZQ</p>`, `<p>Booked 23 October 2026</p>`, `<p>Bright loft apartment in Ancoats</p>`,
        table([["£85.00 x 3 nights", "£255.00"], ["Cleaning fee", "£35.00"], ["Airbnb service fee", "£41.00"], ["<strong>Total (GBP)</strong>", `<strong>${gbp(o.total)}</strong>`]])] }) },
      o, "Airbnb", "2026-10-23");
  }
  {
    // A second-hand sale: item price, postage and a buyer fee, each labelled.
    const o = order([{ name: "Vintage Levi's 501 Jeans W32 L30", qty: 1, unit: 2200 }], { fees: [["Shipping", 399], ["Buyer protection fee", 130]] });
    add("holdout3-depop-labelled", "Depop", "one item, labelled money lines", { from: "Depop <noreply@depop.com>", subject: "Your Depop receipt", date: "Thu, 22 Oct 2026 15:00:00 +0000",
      text: ["Depop", "Thanks for your purchase!", "Order number: DP-0091822", "Date: 22 October 2026", "Seller: @vintage_finds_leeds", "", "Vintage Levi's 501 Jeans W32 L30", "Item price: £22.00", "Shipping: £3.99", "Buyer protection fee: £1.30", `Total: ${gbp(o.total)}`].join("\n") },
      o, "Depop", "2026-10-22");
  }
  {
    // A quick-commerce order: "2 × Item" with a rider tip.
    const o = order([{ name: "Ben & Jerry's Cookie Dough 465ml", qty: 2, unit: 550 }, { name: "Doritos Cool Original 180g", qty: 1, unit: 250 }, { name: "Coca-Cola Zero 6 x 330ml", qty: 1, unit: 525 }], { fees: [["Delivery fee", 199], ["Service fee", 99]], tips: [["Rider tip", 100]] });
    add("holdout3-zapp-times", "Zapp", "'2 × Item' with a rider tip", { from: "Zapp <hello@zapp.co.uk>", subject: "Your Zapp order receipt #Z44912", date: "Wed, 21 Oct 2026 23:10:00 +0000",
      text: ["Zapp", "Order #Z44912", "21 October 2026, 23:08", "", "2 × Ben & Jerry's Cookie Dough 465ml   £11.00", "1 × Doritos Cool Original 180g   £2.50", "1 × Coca-Cola Zero 6 x 330ml   £5.25", "", moneyText(o, { subtotal: "Basket" })].join("\n") },
      o, "Zapp", "2026-10-21");
  }
  {
    // Grocery delivery through a delivery app: a replaced item says what it replaced, on the same line.
    const o = order([{ name: "Heinz Baked Beans 415g", qty: 4, unit: 140 }, { name: "Branston Baked Beans 410g", qty: 1, unit: 120 }, { name: "Hovis Best of Both 750g", qty: 1, unit: 175 }], { fees: [["Delivery fee", 199], ["Service fee", 150], ["Bag fee", 20]] });
    add("holdout3-ubereats-grocery-replaced", "Uber Eats", "grocery, a replacement on the same line", { from: "Uber Eats <noreply@uber.com>", subject: "Your Uber Eats order from Sainsbury's Local", date: "Tue, 20 Oct 2026 12:40:00 +0000",
      text: ["Uber Eats", "Thanks for ordering, Sam", "Sainsbury's Local", "Order #4410-UE", "20 October 2026", "", "4 Heinz Baked Beans 415g £5.60", "1 Branston Baked Beans 410g (replaced Heinz Baked Beans 415g) £1.20", "1 Hovis Best of Both 750g £1.75", "", moneyText(o)].join("\n") },
      o, "Uber Eats", "2026-10-20");
  }
  {
    // Plain-text Amazon with each line's quantity and price labelled.
    const o = order([{ name: "Anker USB C Charger 20W", qty: 2, unit: 1299 }, { name: "Duracell Plus AA Batteries 12 Pack", qty: 1, unit: 849 }]);
    add("holdout3-amazon-text-labels", "Amazon", "plain text 'Quantity: 2' and 'Item subtotal'", { from: "Amazon.co.uk <auto-confirm@amazon.co.uk>", subject: "Your Amazon.co.uk order of 2 items", date: "Mon, 19 Oct 2026 10:00:00 +0000",
      text: ["Amazon.co.uk", "Order Confirmation", "Order #204-5512298-1120934", "Placed on 19 October 2026", "", "Anker USB C Charger 20W", "Sold by: Anker Direct", "Quantity: 2", "£25.98", "", "Duracell Plus AA Batteries 12 Pack", "Sold by: Amazon EU S.a.r.L.", "Quantity: 1", "£8.49", "", "Item Subtotal: £34.47", "Postage & Packing: £0.00", `Order Total: ${gbp(o.total)}`].join("\n") },
      o, "Amazon", "2026-10-19", { shopAlso: ["Amazon.co.uk"], itemCount: 2 });
  }
  {
    // Train tickets bought from an operator: a line per ticket type with "2 x".
    const o = order([{ name: "Off-Peak Return Adult", qty: 2, unit: 2860 }, { name: "Off-Peak Return Child", qty: 1, unit: 1430 }], { fees: [["Booking fee", 0]] });
    add("holdout3-northern-tickets", "Northern", "ticket types with '2 x'", { from: "Northern <tickets@northernrailway.co.uk>", subject: "Your Northern ticket purchase receipt", date: "Sun, 18 Oct 2026 09:00:00 +0000",
      text: ["Northern", "Ticket receipt", "Transaction reference: NT-88120034", "Purchased: 18 October 2026", "", "Leeds to York, out Sat 24 Oct", "", "2 x Off-Peak Return Adult  £57.20", "1 x Off-Peak Return Child  £14.30", "Booking fee  FREE", "", `Total paid  ${gbp(o.total)}`].join("\n") },
      o, "Northern", "2026-10-18");
  }
  {
    // Starbucks app: a drink with add-ons on rows beginning "+" with their own prices.
    const o = order([{ name: "Grande Caffè Latte", qty: 1, unit: 445, extras: ["Oat Milk", "Vanilla Syrup"] }, { name: "Blueberry Muffin", qty: 1, unit: 295 }]);
    add("holdout3-starbucks-addons", "Starbucks", "'+ add-on £0.45' rows that add to the drink", { from: "Starbucks <starbucks@e.starbucks.co.uk>", subject: "Your Starbucks receipt", date: "Sat, 17 Oct 2026 08:20:00 +0000",
      text: ["Starbucks", "Leeds Albion Street", "17/10/2026 08:19", "Order 7712", "", "Grande Caffè Latte  £3.65", "  + Oat Milk  £0.45", "  + Vanilla Syrup  £0.35", "Blueberry Muffin  £2.95", "", `Total  ${gbp(o.total)}`, "Stars earned: 14"].join("\n") },
      o, "Starbucks", "2026-10-17");
  }

  // ---- Not purchases: refunds, cancellations, a price adjustment --------------------------------------------------------
  not("holdout3-boots-partial-refund", "Boots", "partial refund for one item", { from: "Boots <noreply@boots.com>", subject: "Your refund for order 9876541122", date: "Fri, 20 Nov 2026 10:00:00 +0000",
    html: page({ brand: "Boots", domain: "boots.com", rows: [`<p>Hi Sam,</p>`, `<p>We've processed a refund of £4.99 for 1 item from your order.</p>`, `<p>Order number: 9876541122</p>`,
      table([["Item refunded", "Qty", "Refund"], ["Boots Tea Tree & Witch Hazel Face Wash 150ml", "1", "£4.99"]]), table([["Refund total", "£4.99"]]), `<p>It can take 3-5 working days to reach your card.</p>`] }) },
    { kind: "refund", refundPence: 499, orderRef: "9876541122" });
  not("holdout3-currys-cancelled", "Currys", "whole order cancelled", { from: "Currys <orders@currys.co.uk>", subject: "Your order has been cancelled - 6012-3344-77", date: "Thu, 19 Nov 2026 15:00:00 +0000",
    html: page({ brand: "Currys", domain: "currys.co.uk", rows: [`<p>Your order has been cancelled</p>`, `<p>Order number: 6012-3344-77</p>`, `<p>Order date: 17 November 2026</p>`,
      table([["Product", "Qty", "Price"], ["Apple AirPods Pro (2nd generation)", "1", "£229.00"]]), table([["Subtotal", "£229.00"], ["Total", "£229.00"]]), `<p>We'll refund £229.00 to your original payment method.</p>`] }) },
    { kind: "cancellation" });
  not("holdout3-very-part-cancelled", "Very", "some items cancelled", { from: "Very <orders@very.co.uk>", subject: "Part of your order V99812234 has been cancelled", date: "Fri, 13 Nov 2026 09:00:00 +0000",
    text: ["very", "Some items in your order have been cancelled", "Order number: V99812234", "", "Cancelled items", "V by Very Ankle Boots", "Size 6", "Quantity 1", "Price £40.00", "", "Amount to be refunded: £40.00", "The rest of your order is on its way."].join("\n") },
    { kind: "cancellation" });
  not("holdout3-johnlewis-price-adjust", "John Lewis", "a price adjustment, money back", { from: "John Lewis <orders@johnlewis.co.uk>", subject: "Price adjustment confirmation for your order 87001234", date: "Sun, 15 Nov 2026 12:00:00 +0000",
    html: page({ brand: "John Lewis", domain: "johnlewis.co.uk", rows: [`<p>Good news, Sam</p>`, `<p>We've matched a lower price on an item you bought, and refunded the difference.</p>`, `<p>Order number: 87001234</p>`,
      table([["Le Creuset Stoneware Mug 350ml", "Was £22.00", "Now £18.00"]]), table([["Price adjustment", "£4.00"], ["Total refunded", "£4.00"]])] }) },
    { kind: "price_adjustment" });
  not("holdout3-asos-full-refund", "ASOS", "a refund for the whole return", { from: "ASOS <noreply@asos.com>", subject: "Your refund is on its way", date: "Wed, 18 Nov 2026 11:00:00 +0000",
    text: ["ASOS", "Hi Sam, we've processed your refund.", "Order number: 1122998877", "", "ASOS DESIGN oversized hoodie in black  £32.00", "ASOS DESIGN relaxed joggers  £25.00", "", "Refund total: £57.00", "It should reach your account within 10 working days."].join("\n") },
    { kind: "refund", refundPence: 5700, orderRef: "1122998877" });
  return out;
}
