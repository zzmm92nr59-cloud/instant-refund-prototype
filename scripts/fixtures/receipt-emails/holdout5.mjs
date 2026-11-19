// A sixth set of made-up emails (see lib.mjs): forty-four layouts written for round 3 of the item reader (19 Nov 2026), unlike
// anything already in the corpus, and run BEFORE any change for them (their first-try scores are in the round 3 commit).
// Table structures (nested tables, div grids, flexbox rows, inline spans, <br>-separated cells), prices before the name and
// on the line above, item codes, colour and size on lines of their own, column headings in different orders, a Welsh and
// English receipt, marketplaces with several sellers, split shipments, a pre-order, renewals, digital goods, tickets,
// restaurant bills with a service charge, a pharmacy, an optician, a petrol station, a parking app and takeaways with
// options several levels deep. Every shop order, person, address and number here is made up.
import { order, expected, page, table, moneyRows, moneyText, fixture, gbp, h } from "./lib.mjs";

const dd = (s) => `<div>${s}</div>`;

export default function holdout5() {
  const out = [];
  const add = (id, sender, layout, mail, o, shop, date, extra) => out.push(fixture(id, sender, layout, mail, expected(shop, date, o, extra)));
  const not = (id, sender, layout, mail, notPurchase) => out.push(fixture(id, sender, layout, mail, { notPurchase, items: [], shop: null, date: null, currency: null, totalPence: null }));

  {
    // Each item in a table of its own inside the item list's cell: a name table and a price table side by side.
    const o = order([{ name: "Wilton Ultimate Cake Decorating Kit", qty: 1, unit: 3200 }, { name: "Cricut Joy Starter Bundle", qty: 1, unit: 17900 }, { name: "Papermania Kraft Card A4 50 Sheets", qty: 2, unit: 650 }], { fees: [["Standard delivery", 395]] });
    const row = (i) => `<table width="100%" cellpadding="0" cellspacing="0"><tr><td width="70%"><table cellpadding="0" cellspacing="0"><tr><td><strong>${h(i.name)}</strong></td></tr><tr><td class="muted">Quantity: ${i.qty}</td></tr></table></td><td align="right"><table cellpadding="0" cellspacing="0"><tr><td>${gbp(i.line)}</td></tr></table></td></tr></table>`;
    add("holdout5-hobbycraft-nested-tables", "Hobbycraft", "an item table inside each item's cell", { from: "Hobbycraft <orders@hobbycraft.co.uk>", subject: "Thank you for your Hobbycraft order HC10098812", date: "Wed, 18 Nov 2026 10:00:00 +0000",
      html: page({ brand: "Hobbycraft", domain: "hobbycraft.co.uk", rows: [`<p>Order number: HC10098812</p>`, `<p>Order date: 18 November 2026</p>`, ...o.lines.map(row), table(moneyRows(o))] }) }, o, "Hobbycraft", "2026-11-18");
  }
  {
    // A CSS grid of divs: name, quantity and price each in a div of their own, one after another.
    const o = order([{ name: "Oak Effect Bedside Table", qty: 1, unit: 8900 }, { name: "Velvet Scatter Cushion Sage", qty: 3, unit: 1500 }, { name: "Linen Blend Curtains 168x183cm", qty: 1, unit: 6500 }], { fees: [["Delivery", 495]] });
    const grid = `<div style="display:grid;grid-template-columns:3fr 1fr 1fr">${["Item", "Qty", "Price"].map(dd).join("")}${o.lines.map((i) => dd(h(i.name)) + dd(String(i.qty)) + dd(gbp(i.line))).join("")}</div>`;
    add("holdout5-dunelm-div-grid", "Dunelm", "a div grid: name, qty, price divs", { from: "Dunelm <orders@dunelm.com>", subject: "Your Dunelm order confirmation DN55120087", date: "Tue, 17 Nov 2026 19:00:00 +0000",
      html: page({ brand: "Dunelm", domain: "dunelm.com", rows: [`<p>Order number: DN55120087</p>`, `<p>17 November 2026</p>`, grid, table(moneyRows(o))] }) }, o, "Dunelm", "2026-11-17");
  }
  {
    // Flexbox rows: the name and price in spans, the options in a small span under the name.
    const o = order([{ name: "Merino Crew Jumper", qty: 1, unit: 7900, extras: ["Oatmeal"] }, { name: "Organic Cotton Tee", qty: 2, unit: 2500, extras: ["White"] }], { fees: [["Delivery", 0]] });
    const row = (i) => `<div style="display:flex;justify-content:space-between"><div><span style="font-weight:600">${h(i.name)}</span><br><span style="font-size:13px;color:#666">${i.extras[0]} · Qty ${i.qty}</span></div><span>${gbp(i.line)}</span></div>`;
    add("holdout5-arket-flex", "Arket", "flexbox rows, 'Colour · Qty 2' under the name", { from: "ARKET <info@email.arket.com>", subject: "Order confirmation 70011229988", date: "Mon, 16 Nov 2026 09:30:00 +0000",
      html: page({ brand: "ARKET", domain: "arket.com", rows: [`<p>Order number: 70011229988</p>`, `<p>Order date: 16/11/2026</p>`, ...o.lines.map(row), table(moneyRows(o, { free: "Free" }))] }) }, o, "ARKET", "2026-11-16", { shopAlso: ["Arket"] });
  }
  {
    // Inline-styled spans only, every field on its own line with <br>.
    const o = order([{ name: "Hydrating Hyaluronic Serum 30ml", qty: 1, unit: 1850 }, { name: "Daily SPF 50 Moisturiser 50ml", qty: 2, unit: 1600 }], { fees: [["Royal Mail Tracked 48", 350]] });
    const row = (i) => `<span style="font-weight:bold">${h(i.name)}</span><br><span style="color:#555">Qty: ${i.qty}</span><br><span>${gbp(i.line)}</span><br><br>`;
    add("holdout5-glowlab-spans-br", "Glow Lab", "spans and <br>: name, Qty, price", { from: "Glow Lab Skincare <hello@glowlabskin.co.uk>", subject: "Order #GL-20441 confirmed", date: "Sun, 15 Nov 2026 14:00:00 +0000",
      html: page({ brand: "Glow Lab", domain: "glowlabskin.co.uk", rows: [`<p>Order #GL-20441</p>`, `<p>Placed on 15 November 2026</p>`, `<p>${o.lines.map(row).join("")}</p>`, table(moneyRows(o))] }) }, o, "Glow Lab Skincare", "2026-11-15", { shopAlso: ["Glow Lab"] });
  }
  {
    // One cell per item with <br> between its parts: the price before the quantity.
    const o = order([{ name: "Bosch Cordless Drill 18V", qty: 1, unit: 9900 }, { name: "Stanley FatMax Tape Measure 8m", qty: 2, unit: 1450 }], { fees: [["Click & Collect", 0]] });
    add("holdout5-screwfix-br-cell", "Screwfix", "one <br> cell: name, line price, qty", { from: "Screwfix <orders@screwfix.com>", subject: "Screwfix order confirmation SFX88112", date: "Sat, 14 Nov 2026 08:10:00 +0000",
      html: page({ brand: "Screwfix", domain: "screwfix.com", rows: [`<p>Order number: SFX88112</p>`, `<p>Order date: 14/11/2026</p>`,
        table(o.lines.map((i) => [`${h(i.name)}<br>${gbp(i.line)}<br>Qty: ${i.qty}`])), table(moneyRows(o))] }) }, o, "Screwfix", "2026-11-14");
  }
  {
    // The price in the first column, then the name, then how many.
    const o = order([{ name: "Kindle Paperwhite Cover", qty: 1, unit: 2499 }, { name: "USB-C Charging Cable 2m", qty: 3, unit: 799 }], { fees: [["Postage", 299]] });
    add("holdout5-gadgetbox-price-first", "Gadget Box", "price column before the name", { from: "Gadget Box <sales@gadgetbox.co.uk>", subject: "Your order GB-77120 is confirmed", date: "Fri, 13 Nov 2026 12:00:00 +0000",
      html: page({ brand: "Gadget Box", domain: "gadgetbox.co.uk", rows: [`<p>Order GB-77120</p>`, `<p>Order date: 13 November 2026</p>`,
        table([["Price", "Item", "Qty"], ...o.lines.map((i) => [gbp(i.line), h(i.name), String(i.qty)])]), table(moneyRows(o))] }) }, o, "Gadget Box", "2026-11-13");
  }
  {
    // Plain text with each price on the line above its item's name.
    const o = order([{ name: "Oat Flat White", qty: 1, unit: 360 }, { name: "Almond Croissant", qty: 2, unit: 325 }, { name: "Sparkling Water", qty: 1, unit: 180 }]);
    add("holdout5-brewbar-price-above", "Brew Bar", "price on the line above the name", { from: "Brew Bar <receipts@brewbar.co.uk>", subject: "Your receipt from Brew Bar", date: "Thu, 12 Nov 2026 08:45:00 +0000",
      text: ["Brew Bar Leeds", "Receipt #4471", "12 November 2026 08:44", "", "£3.60", "Oat Flat White", "£6.50", "2 x Almond Croissant", "£1.80", "Sparkling Water", "", "Total £11.90", "Paid by card"].join("\n") }, o, "Brew Bar", "2026-11-12");
  }
  {
    // A product code and an EAN on their own lines under each name.
    const o = order([{ name: "Brother P-Touch Label Printer", qty: 1, unit: 3499 }, { name: "Brother TZe 12mm Tape Black on White", qty: 4, unit: 1199 }], { fees: [["Next day delivery", 0]] });
    add("holdout5-viking-ean", "Viking", "product code and EAN lines under the name", { from: "Viking <orders@viking-direct.co.uk>", subject: "Order acknowledgement 30044112", date: "Wed, 11 Nov 2026 16:00:00 +0000",
      html: page({ brand: "Viking", domain: "viking-direct.co.uk", rows: [`<p>Order number: 30044112</p>`, `<p>Order date: 11/11/2026</p>`,
        table([["Product", "Qty", "Total"], ...o.lines.map((i, k) => [`${h(i.name)}<br>Product code: ${4400120 + k}<br>EAN: 497796${String(1000000 + k)}`, String(i.qty), gbp(i.line)])]), table(moneyRows(o, { free: "FREE" }))] }) }, o, "Viking", "2026-11-11");
  }
  {
    // Colour and size each on a line of their own with no label, then the quantity and the price.
    const o = order([{ name: "Wide Leg Cord Trousers", qty: 1, unit: 4600, extras: ["Rust"] }, { name: "Chunky Knit Cardigan", qty: 1, unit: 5500, extras: ["Ecru"] }], { fees: [["Delivery", 495]] });
    add("holdout5-whitestuff-bare-lines", "White Stuff", "colour and size lines with no labels", { from: "White Stuff <orders@whitestuff.com>", subject: "Thanks for your order WS1188273", date: "Tue, 10 Nov 2026 20:00:00 +0000",
      text: ["White Stuff", "Order number: WS1188273", "Order date: 10 November 2026", "", "Wide Leg Cord Trousers", "Rust", "UK 12 Regular", "Qty 1", "£46.00", "", "Chunky Knit Cardigan", "Ecru", "M", "Qty 1", "£55.00", "", moneyText(o)].join("\n") }, o, "White Stuff", "2026-11-10");
  }
  {
    // Column headings in an unusual order: Qty, Description, Total, then the unit price last.
    const o = order([{ name: "A4 Copier Paper 80gsm Box of 5 Reams", qty: 2, unit: 2399 }, { name: "Pilot G2 Gel Pens Black Pack of 12", qty: 3, unit: 899 }, { name: "Leitz Lever Arch File A4", qty: 1, unit: 450 }], { fees: [["Delivery", 0]] });
    add("holdout5-officeplus-qty-desc-total-price", "Office Plus", "Qty | Description | Total | Unit price", { from: "Office Plus <orders@officeplus.co.uk>", subject: "Order confirmation OP-551208", date: "Mon, 9 Nov 2026 11:00:00 +0000",
      html: page({ brand: "Office Plus", domain: "officeplus.co.uk", rows: [`<p>Order number: OP-551208</p>`, `<p>Order date: 09/11/2026</p>`,
        table([["Qty", "Description", "Total", "Unit price"], ...o.lines.map((i) => [String(i.qty), h(i.name), gbp(i.line), gbp(i.unit)])]), table(moneyRows(o, { free: "Free" }))] }) }, o, "Office Plus", "2026-11-09");
  }
  {
    // Description, Price, Qty and Total, with the unit price before the quantity.
    const o = order([{ name: "Hand-thrown Stoneware Mug", qty: 4, unit: 1800 }, { name: "Speckled Serving Bowl", qty: 1, unit: 3800 }], { fees: [["Shipping", 650]] });
    add("holdout5-potteryshed-desc-price-qty-total", "The Pottery Shed", "Description | Price | Qty | Total", { from: "The Pottery Shed <hello@thepotteryshed.co.uk>", subject: "Your order #1042 from The Pottery Shed", date: "Sun, 8 Nov 2026 17:30:00 +0000",
      html: page({ brand: "The Pottery Shed", domain: "thepotteryshed.co.uk", rows: [`<p>Order #1042</p>`, `<p>8 November 2026</p>`,
        table([["Description", "Price", "Qty", "Total"], ...o.lines.map((i) => [h(i.name), gbp(i.unit), String(i.qty), gbp(i.line)])]), table(moneyRows(o))] }) }, o, "The Pottery Shed", "2026-11-08");
  }
  {
    // Item, Unit cost, Quantity, Amount, in plain text columns.
    const o = order([{ name: "Galvanised Garden Bucket 10L", qty: 2, unit: 1295 }, { name: "Wooden Plant Labels Pack of 50", qty: 1, unit: 450 }], { fees: [["P&P", 395]] });
    add("holdout5-greenhouse-text-unitcost", "Greenhouse Supplies", "text: Item, Unit cost, Quantity, Amount", { from: "Greenhouse Supplies <orders@greenhousesupplies.co.uk>", subject: "Order confirmation GS/2026/11/0456", date: "Sat, 7 Nov 2026 10:00:00 +0000",
      text: ["Greenhouse Supplies Ltd", "Order confirmation", "Order: GS/2026/11/0456", "Date: 07/11/2026", "", "Item                            Unit cost   Quantity   Amount",
        "Galvanised Garden Bucket 10L       £12.95          2   £25.90", "Wooden Plant Labels Pack of 50      £4.50          1    £4.50", "", moneyText(o, {}, "   ")].join("\n") }, o, "Greenhouse Supplies", "2026-11-07", { shopAlso: ["Greenhouse Supplies Ltd"] });
  }
  {
    // A Welsh and English receipt: every label in both languages.
    const o = order([{ name: "Welsh Cakes Box of 12", qty: 2, unit: 900 }, { name: "Bara Brith Loaf", qty: 1, unit: 650 }, { name: "Penderyn Madeira Finish 70cl", qty: 1, unit: 4500 }], { fees: [["Cludo / Delivery", 495]] });
    add("holdout5-siopcymru-bilingual", "Siop Cymru", "Welsh / English labels", { from: "Siop Cymru <archebion@siopcymru.co.uk>", subject: "Diolch am eich archeb / Thank you for your order SC-3302", date: "Fri, 6 Nov 2026 13:00:00 +0000",
      html: page({ brand: "Siop Cymru", domain: "siopcymru.co.uk", rows: [`<p>Rhif archeb / Order number: SC-3302</p>`, `<p>Dyddiad / Date: 6 November 2026</p>`,
        table([["Cynnyrch / Product", "Nifer / Qty", "Pris / Price"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]),
        table([["Is-gyfanswm / Subtotal", gbp(o.subtotal)], ["Cludo / Delivery", gbp(495)], ["<strong>Cyfanswm / Total</strong>", `<strong>${gbp(o.total)}</strong>`]])] }) }, o, "Siop Cymru", "2026-11-06");
  }
  {
    // A marketplace order from two sellers, each with its own items and postage.
    const o = order([{ name: "Vintage Brass Candle Holders Pair", qty: 1, unit: 2400 }, { name: "Hand Poured Soy Candle Amber", qty: 2, unit: 1200 }, { name: "Macrame Plant Hanger", qty: 1, unit: 1500 }], { fees: [["Postage from Old Mill Finds", 350], ["Postage from Knot & Loop", 295]] });
    add("holdout5-etsy-two-sellers", "Etsy", "two sellers, each with its own postage", { from: "Etsy Transactions <transaction@etsy.com>", subject: "Your Etsy purchase from Old Mill Finds and 1 other shop", date: "Thu, 5 Nov 2026 21:00:00 +0000",
      html: page({ brand: "Etsy", domain: "etsy.com", rows: [`<p>Order number: 3311029988</p>`, `<p>Order date: 5 November 2026</p>`,
        `<p><strong>Old Mill Finds</strong></p>`, table([[h(o.lines[0].name), "Quantity: 1", gbp(2400)], [h(o.lines[1].name), "Quantity: 2", gbp(2400)], ["Postage", gbp(350)]]),
        `<p><strong>Knot &amp; Loop</strong></p>`, table([[h(o.lines[2].name), "Quantity: 1", gbp(1500)], ["Postage", gbp(295)]]),
        table([["Item total", gbp(o.subtotal)], ["Postage", gbp(645)], ["<strong>Order total</strong>", `<strong>${gbp(o.total)}</strong>`]])] }) }, o, "Etsy", "2026-11-05");
  }
  {
    // A marketplace with three sellers, each with a seller subtotal under its items.
    const o = order([{ name: "Logitech M185 Wireless Mouse", qty: 1, unit: 1299 }, { name: "Anker USB-C Hub 7-in-1", qty: 1, unit: 2999 }, { name: "Rechargeable AA Batteries 8 Pack", qty: 2, unit: 999 }], { fees: [["Delivery", 0]] });
    const seller = (n, rows, sub) => [`<p>Sold by ${n}</p>`, table([...rows, ["Seller subtotal", gbp(sub)]])];
    add("holdout5-onbuy-three-sellers", "OnBuy", "three sellers with a subtotal each", { from: "OnBuy <orders@onbuy.com>", subject: "OnBuy order confirmation OB-99120334", date: "Wed, 4 Nov 2026 15:00:00 +0000",
      html: page({ brand: "OnBuy", domain: "onbuy.com", rows: [`<p>Order number: OB-99120334</p>`, `<p>Order date: 04/11/2026</p>`,
        ...seller("TechWorld UK", [[h(o.lines[0].name), "x1", gbp(1299)]], 1299), ...seller("PortHub Direct", [[h(o.lines[1].name), "x1", gbp(2999)]], 2999), ...seller("PowerCell Store", [[h(o.lines[2].name), "x2", gbp(1998)]], 1998),
        table(moneyRows(o, { subtotal: "Items total", free: "Free" }))] }) }, o, "OnBuy", "2026-11-04");
  }
  {
    // A split shipment: what is in this parcel, then what is still to come, then the whole order's money.
    const o = order([{ name: "Le Creuset Signature Casserole 24cm", qty: 1, unit: 27500 }, { name: "Joseph Joseph Nest 9 Plus", qty: 1, unit: 6000 }, { name: "Robert Welch Signature Knife Block Set", qty: 1, unit: 22500 }], { fees: [["Delivery", 0]] });
    add("holdout5-lakeland-split-shipment", "Lakeland", "'2 of your 3 items have shipped', then 'still to come'", { from: "Lakeland <orders@lakeland.co.uk>", subject: "2 of your 3 items have shipped", date: "Tue, 3 Nov 2026 09:00:00 +0000",
      html: page({ brand: "Lakeland", domain: "lakeland.co.uk", rows: [`<p>Good news: 2 of your 3 items are on their way.</p>`, `<p>Order number: LK-7712098</p>`, `<p>Order date: 1 November 2026</p>`, `<p>Tracking number: JD014600003927812345 (DPD)</p>`,
        `<p><strong>In this parcel</strong></p>`, table([[h(o.lines[0].name), "Qty: 1", gbp(27500)], [h(o.lines[1].name), "Qty: 1", gbp(6000)]]),
        `<p><strong>Still to come</strong></p>`, table([[h(o.lines[2].name), "Qty: 1", gbp(22500)]]), table(moneyRows(o, { free: "FREE" }))] }) }, o, "Lakeland", "2026-11-01");
  }
  {
    // A shipment email that lists only the items in this parcel, with the whole order's total: incomplete by nature.
    const shipped = order([{ name: "Barbour Beadnell Wax Jacket", qty: 1, unit: 25900 }, { name: "Barbour Lambswool Scarf", qty: 1, unit: 4500 }]);
    add("holdout5-houseoffraser-shipped-part", "House of Fraser", "only the shipped items, the whole order's total", { from: "House of Fraser <noreply@houseoffraser.co.uk>", subject: "Part of your order HF-44120998 has been dispatched", date: "Mon, 2 Nov 2026 14:00:00 +0000",
      html: page({ brand: "House of Fraser", domain: "houseoffraser.co.uk", rows: [`<p>Some of your items have been dispatched. The rest will follow separately.</p>`, `<p>Order number: HF-44120998</p>`, `<p>Order date: 30 October 2026</p>`,
        `<p>Items in this delivery</p>`, table(shipped.lines.map((i) => [h(i.name), "Qty 1", gbp(i.line)])), table([["Order total", gbp(39300)]])] }) },
      { ...shipped, total: 39300 }, "House of Fraser", "2026-10-30", { totalPence: 39300, partial: true });
  }
  {
    // A pre-order: the release date under the item and payment taken when it ships.
    const o = order([{ name: "Hollow Knight: Silksong Collector's Edition (Nintendo Switch 2)", qty: 1, unit: 7999, extras: [] }, { name: "Pro Controller Charging Dock", qty: 1, unit: 2499 }], { fees: [["Delivery", 0]] });
    add("holdout5-game-preorder", "GAME", "pre-order: release date line, pay on dispatch", { from: "GAME <orders@game.co.uk>", subject: "Your pre-order is confirmed G-77120044", date: "Sun, 1 Nov 2026 18:00:00 +0000",
      text: ["GAME", "Pre-order confirmation", "Order number: G-77120044", "Order date: 01/11/2026", "", "Hollow Knight: Silksong Collector's Edition (Nintendo Switch 2)", "Release date: 12 March 2027", "Qty: 1   £79.99", "", "Pro Controller Charging Dock", "In stock - dispatches today", "Qty: 1   £24.99", "", "You won't be charged for pre-order items until they are dispatched.", "", moneyText(o, { free: "FREE" })].join("\n") },
      o, "GAME", "2026-11-01");
  }
  {
    // A subscription renewal: the plan, the period it covers and the VAT included.
    const o = order([{ name: "Premium Family", qty: 1, unit: 1999 }]);
    add("holdout5-streamly-renewal", "Streamly", "renewal: plan and billing period", { from: "Streamly <billing@streamly.tv>", subject: "Your Streamly subscription has renewed", date: "Sat, 31 Oct 2026 06:00:00 +0000",
      html: page({ brand: "Streamly", domain: "streamly.tv", rows: [`<p>Hi Sam, your subscription has renewed.</p>`, `<p>Invoice number: STR-2026-10-998812</p>`, `<p>Date: 31 October 2026</p>`,
        table([["Plan", "Premium Family"], ["Billing period", "31 Oct 2026 – 30 Nov 2026"], ["Amount", gbp(1999)]]), table([["Total charged", gbp(1999)], ["Includes VAT at 20%", gbp(333)]])] }) }, o, "Streamly", "2026-10-31");
  }
  {
    // Digital goods: e-books with their author and format under the title.
    const o = order([{ name: "The Thursday Murder Club", qty: 1, unit: 499 }, { name: "Atomic Habits", qty: 1, unit: 799 }]);
    add("holdout5-kobo-ebooks", "Kobo", "e-books: 'by Author' and format lines", { from: "Rakuten Kobo <noreply@kobo.com>", subject: "Your Kobo order receipt", date: "Fri, 30 Oct 2026 22:00:00 +0000",
      html: page({ brand: "Rakuten Kobo", domain: "kobo.com", rows: [`<p>Order number: KB-55410098</p>`, `<p>Order date: October 30, 2026</p>`,
        table([["The Thursday Murder Club<br>by Richard Osman<br>eBook", gbp(499)], ["Atomic Habits<br>by James Clear<br>eBook", gbp(799)]]), table([["Subtotal", gbp(1298)], ["<strong>Total</strong>", `<strong>${gbp(1298)}</strong>`]])] }) }, o, "Rakuten Kobo", "2026-10-30", { shopAlso: ["Kobo"] });
  }
  {
    // Concert tickets: two price bands, each "2 x £45.00", their seats under them, and the fees.
    const o = order([{ name: "Standing General Admission", qty: 2, unit: 4500 }, { name: "Seated Tier 2", qty: 1, unit: 6250, extras: ["Block 204"] }], { fees: [["Service fee", 1080], ["Order processing fee", 275]] });
    add("holdout5-ticketline-bands", "Ticketline", "tickets: '2 x £45.00', seats, fees", { from: "Ticketline <tickets@ticketline.co.uk>", subject: "Your tickets for The Lumineers - order TL-8812309", date: "Thu, 29 Oct 2026 12:00:00 +0000",
      text: ["Ticketline", "Order confirmation", "Order number: TL-8812309", "Booked: 29 October 2026", "", "The Lumineers", "First Direct Arena, Leeds", "Saturday 13 March 2027, doors 6:30pm", "",
        "Standing General Admission", "2 x £45.00   £90.00", "", "Seated Tier 2", "Block 204, Row K, Seat 18", "1 x £62.50   £62.50", "", moneyText(o, { subtotal: "Tickets" })].join("\n") }, o, "Ticketline", "2026-10-29");
  }
  {
    // A restaurant bill: quantity first, a discretionary service charge and a tip.
    const o = order([{ name: "Sourdough & Butter", qty: 1, unit: 450 }, { name: "Burrata", qty: 1, unit: 1100 }, { name: "Lamb Rump", qty: 2, unit: 2400 }, { name: "Peroni 330ml", qty: 3, unit: 550 }], { fees: [["Discretionary service 12.5%", 1000]], tips: [["Tip", 500]] });
    add("holdout5-thelarder-service", "The Larder", "restaurant: '2 Lamb Rump £48.00', service charge, tip", { from: "The Larder <bills@paytab.app>", subject: "Your receipt from The Larder", date: "Wed, 28 Oct 2026 22:30:00 +0000",
      text: ["The Larder", "14 Example Street, Leeds", "Table 12 - 28/10/2026 22:14", "", "1 Sourdough & Butter      £4.50", "1 Burrata                 £11.00", "2 Lamb Rump               £48.00", "3 Peroni 330ml            £16.50", "",
        "Subtotal                  £80.00", "Discretionary service 12.5%   £10.00", "Tip                       £5.00", "Total                     £95.00", "", "Paid by Visa ending 1234"].join("\n") }, o, "The Larder", "2026-10-28");
  }
  {
    // An online pharmacy: pack sizes on their own lines and a free consultation.
    const o = order([{ name: "Cetirizine Hayfever Tablets 10mg", qty: 2, unit: 299, extras: [] }, { name: "Vitamin D3 1000IU", qty: 1, unit: 649 }], { fees: [["Online consultation", 0], ["Tracked delivery", 299]] });
    add("holdout5-chemistdirect-pharmacy", "Chemist Direct", "pharmacy: pack size lines, a free consultation", { from: "Chemist Direct <orders@chemistdirect.co.uk>", subject: "Your Chemist Direct order CD-4410093", date: "Tue, 27 Oct 2026 10:00:00 +0000",
      html: page({ brand: "Chemist Direct", domain: "chemistdirect.co.uk", rows: [`<p>Order number: CD-4410093</p>`, `<p>Order date: 27 October 2026</p>`,
        table([["Cetirizine Hayfever Tablets 10mg<br>Pack size: 30 tablets", "Qty: 2", gbp(598)], ["Vitamin D3 1000IU<br>Pack size: 120 tablets", "Qty: 1", gbp(649)]]),
        table([["Subtotal", gbp(o.subtotal)], ["Online consultation", "FREE"], ["Tracked delivery", gbp(299)], ["<strong>Total</strong>", `<strong>${gbp(o.total)}</strong>`]])] }) }, o, "Chemist Direct", "2026-10-27");
  }
  {
    // An optician: frames, lenses and a coating as lines, the eye test free, and an NHS voucher off.
    const o = order([{ name: "Frames: Ray-Ban RB5154 Clubmaster", qty: 1, unit: 13900 }, { name: "Single vision lenses", qty: 1, unit: 6500 }, { name: "Anti-reflection coating", qty: 1, unit: 3000 }, { name: "Eye examination", qty: 1, unit: 0 }], { discounts: [["NHS optical voucher", 4410]] });
    add("holdout5-visionplus-optician", "Vision Plus", "optician: lines, a free eye test, NHS voucher", { from: "Vision Plus Opticians <receipts@visionplus.co.uk>", subject: "Your Vision Plus receipt", date: "Mon, 26 Oct 2026 16:00:00 +0000",
      html: page({ brand: "Vision Plus", domain: "visionplus.co.uk", rows: [`<p>Receipt number: VP-0099812</p>`, `<p>26 October 2026</p>`,
        table([["Frames: Ray-Ban RB5154 Clubmaster", gbp(13900)], ["Single vision lenses", gbp(6500)], ["Anti-reflection coating", gbp(3000)], ["Eye examination", "FREE"]]),
        table([["Subtotal", gbp(o.subtotal)], ["NHS optical voucher", gbp(-4410)], ["<strong>Total paid</strong>", `<strong>${gbp(o.total)}</strong>`]])] }) }, o, "Vision Plus Opticians", "2026-10-26", { shopAlso: ["Vision Plus"] });
  }
  {
    // A petrol station e-receipt: litres at a price a litre, and a shop item.
    const o = order([{ name: "Unleaded", qty: 1, unit: 5490 }, { name: "Lucozade Energy 500ml", qty: 1, unit: 185 }]);
    add("holdout5-fuelstop-petrol", "FuelStop", "petrol: litres @ pence a litre, a shop item", { from: "FuelStop <ereceipts@fuelstop.co.uk>", subject: "Your FuelStop e-receipt", date: "Sun, 25 Oct 2026 07:40:00 +0000",
      text: ["FuelStop Leeds Ring Road", "Receipt 0044 1923", "25/10/2026 07:38", "", "Pump 4", "Unleaded   38.42 L @ 142.9p/L   £54.90", "Lucozade Energy 500ml   £1.85", "", "Total   £56.75", "Visa contactless   £56.75", "VAT included   £9.46"].join("\n") }, o, "FuelStop", "2026-10-25");
  }
  {
    // A parking app: one session, its place and time, and a convenience fee.
    const o = order([{ name: "Parking session", qty: 1, unit: 900 }], { fees: [["Convenience fee", 30]] });
    add("holdout5-parkeasy-parking", "ParkEasy", "parking: one session, convenience fee", { from: "ParkEasy <receipts@parkeasy.app>", subject: "Your ParkEasy receipt", date: "Sat, 24 Oct 2026 17:10:00 +0000",
      html: page({ brand: "ParkEasy", domain: "parkeasy.app", rows: [`<p>Receipt PE-2210993</p>`, `<p>24 October 2026</p>`,
        table([["Location", "Leeds Station Car Park (code 4471)"], ["Vehicle", "AB12 CDE"], ["Start", "24 Oct 2026 14:05"], ["End", "24 Oct 2026 17:05"]]),
        table([["Parking session", gbp(900)], ["Convenience fee", gbp(30)], ["<strong>Total</strong>", `<strong>${gbp(930)}</strong>`]])] }) }, o, "ParkEasy", "2026-10-24");
  }
  {
    // A takeaway app: options three levels deep under each item, the item's price including them.
    const o = order([{ name: "Build Your Own Burrito", qty: 1, unit: 1100, extras: ["Chicken", "Guacamole"] }, { name: "Loaded Nachos", qty: 1, unit: 650, extras: ["Jalapeños"] }, { name: "Horchata", qty: 2, unit: 350 }], { fees: [["Delivery fee", 199], ["Service fee", 99]], tips: [["Rider tip", 100]] });
    add("holdout5-burritobox-nested", "Burrito Box", "takeaway: options nested three deep", { from: "Burrito Box <orders@burritobox.co.uk>", subject: "Order confirmed #BB-30091", date: "Fri, 23 Oct 2026 19:30:00 +0000",
      text: ["Burrito Box", "Order #BB-30091", "23 October 2026", "", "1x Build Your Own Burrito   £11.00", "    Filling", "        Chicken", "            Add guacamole: Guacamole (+£1.50)", "    Salsa", "        Hot", "1x Loaded Nachos   £6.50", "    Toppings", "        Jalapeños", "2x Horchata   £7.00", "", moneyText(o)].join("\n") }, o, "Burrito Box", "2026-10-23");
  }
  {
    // A takeaway meal deal: its parts and each part's options as lines under it, as divs.
    const o = order([{ name: "Pizza Meal Deal for 2", qty: 1, unit: 2799, extras: ["Margherita", "Pepperoni"] }, { name: "Cookie Dough", qty: 1, unit: 599 }], { fees: [["Delivery", 249]] });
    add("holdout5-pizzahut-deal-divs", "Pizza Hut", "meal deal parts and their options in divs", { from: "Pizza Hut Delivery <orders@pizzahut.co.uk>", subject: "Your Pizza Hut order PH-6612099", date: "Thu, 22 Oct 2026 18:45:00 +0000",
      html: page({ brand: "Pizza Hut", domain: "pizzahut.co.uk", rows: [`<p>Order number: PH-6612099</p>`, `<p>22/10/2026</p>`,
        `<div><div style="display:flex"><span>1 x Pizza Meal Deal for 2</span><span>£27.99</span></div><div style="padding-left:12px">Margherita</div><div style="padding-left:24px">Large, Stuffed Crust</div><div style="padding-left:12px">Pepperoni</div><div style="padding-left:24px">Large, Pan</div><div style="padding-left:12px">Garlic Bread</div></div>`,
        `<div style="display:flex"><span>1 x Cookie Dough</span><span>£5.99</span></div>`, table(moneyRows(o))] }) }, o, "Pizza Hut", "2026-10-22");
  }
  {
    // HTML where each item's price sits above its name, the quantity below.
    const o = order([{ name: "Linen Cushion Cover Terracotta", qty: 1, unit: 1800 }, { name: "Jute Round Rug 120cm", qty: 1, unit: 6500 }], { fees: [["Delivery", 0]] });
    add("holdout5-habitat-price-above-html", "Habitat", "price div above the name div", { from: "Habitat <orders@habitat.co.uk>", subject: "Thanks for your Habitat order 118822", date: "Wed, 21 Oct 2026 10:00:00 +0000",
      html: page({ brand: "Habitat", domain: "habitat.co.uk", rows: [`<p>Order number: 118822</p>`, `<p>Order date: 21 October 2026</p>`,
        ...o.lines.map((i) => `<div><div style="font-weight:bold">${gbp(i.line)}</div><div>${h(i.name)}</div><div>Qty ${i.qty}</div></div>`), table(moneyRows(o, { free: "Free" }))] }) }, o, "Habitat", "2026-10-21");
  }
  {
    // A code column, Each and Line total, with th headings.
    const o = order([{ name: "Copper Pipe 15mm x 3m", qty: 4, unit: 1675 }, { name: "Compression Elbow 15mm", qty: 10, unit: 185 }, { name: "PTFE Tape 12mm x 12m", qty: 2, unit: 99 }], { fees: [["Delivery", 600]] });
    add("holdout5-plumbcentre-code-col", "Plumb Centre", "<th> headings: Code, Description, Qty, Each, Line total", { from: "Plumb Centre <orders@plumbcentre.co.uk>", subject: "Order confirmation PC/882210", date: "Tue, 20 Oct 2026 07:30:00 +0000",
      html: page({ brand: "Plumb Centre", domain: "plumbcentre.co.uk", rows: [`<p>Order number: PC/882210</p>`, `<p>Order date: 20/10/2026</p>`,
        `<table width="100%"><tr><th>Code</th><th>Description</th><th>Qty</th><th>Each</th><th>Line total</th></tr>${o.lines.map((i, k) => `<tr><td>${880100 + k}</td><td>${h(i.name)}</td><td>${i.qty}</td><td>${gbp(i.unit)}</td><td>${gbp(i.line)}</td></tr>`).join("")}</table>`,
        table(moneyRows(o))] }) }, o, "Plumb Centre", "2026-10-20");
  }
  {
    // The old price struck through beside the price paid, in one cell, and the name a link with a small code under it.
    const o = order([{ name: "Teddy Fleece Duvet Set Double", qty: 1, unit: 2400 }, { name: "Blackout Eyelet Curtains 66x72", qty: 1, unit: 3200 }], { fees: [["Delivery", 399]] });
    add("holdout5-matalan-strike", "Matalan", "struck-through old price, link name, small code", { from: "Matalan <orders@matalan.co.uk>", subject: "Your Matalan order MAT-5512099", date: "Mon, 19 Oct 2026 20:00:00 +0000",
      html: page({ brand: "Matalan", domain: "matalan.co.uk", rows: [`<p>Order number: MAT-5512099</p>`, `<p>19 October 2026</p>`,
        table([[`<a href="https://www.matalan.co.uk/p/1">Teddy Fleece Duvet Set Double</a><br><small>Product code 4412009</small>`, "1", `<s>£30.00</s> £24.00`], [`<a href="https://www.matalan.co.uk/p/2">Blackout Eyelet Curtains 66x72</a><br><small>Product code 4413371</small>`, "1", `<s>£40.00</s> £32.00`]]),
        table(moneyRows(o))] }) }, o, "Matalan", "2026-10-19");
  }
  {
    // A greengrocer box: how many at what each written in brackets after the name.
    const o = order([{ name: "Braeburn Apples", qty: 6, unit: 40 }, { name: "Vine Tomatoes", qty: 1, unit: 220 }, { name: "Organic Carrots 1kg", qty: 2, unit: 135 }], { fees: [["Delivery", 150]] });
    add("holdout5-fieldfresh-bracket-at", "Field Fresh", "'Apples (6 @ £0.40)  £2.40'", { from: "Field Fresh <orders@fieldfresh.co.uk>", subject: "Your Field Fresh order 20041", date: "Sun, 18 Oct 2026 08:00:00 +0000",
      text: ["Field Fresh", "Order 20041", "18 October 2026", "", "Braeburn Apples (6 @ £0.40)   £2.40", "Vine Tomatoes   £2.20", "Organic Carrots 1kg (2 @ £1.35)   £2.70", "", moneyText(o)].join("\n") }, o, "Field Fresh", "2026-10-18");
  }
  {
    // Weighed produce on a supermarket's e-receipt: weight at a price a kilo, then the price.
    const o = order([{ name: "Bananas Loose", qty: 1, unit: 77 }, { name: "Semi Skimmed Milk 4 Pints", qty: 2, unit: 155 }, { name: "Mature Cheddar 400g", qty: 1, unit: 375 }]);
    add("holdout5-coop-weighed", "Co-op", "weighed item: '0.92 kg @ £0.84/kg', '2 @ £1.55'", { from: "Co-op <ereceipts@coop.co.uk>", subject: "Your Co-op e-receipt", date: "Sat, 17 Oct 2026 12:30:00 +0000",
      text: ["Co-op Food Headingley", "17/10/2026 12:28", "Transaction 3301", "", "Bananas Loose", "  0.92 kg @ £0.84/kg   £0.77", "Semi Skimmed Milk 4 Pints", "  2 @ £1.55   £3.10", "Mature Cheddar 400g   £3.75", "", "Total   £7.62", "Card   £7.62"].join("\n") }, o, "Co-op", "2026-10-17");
  }
  {
    // Plain text with the line's price at the start of each line and how many at the end.
    const o = order([{ name: "Oat Bars Chocolate Chip", qty: 3, unit: 250 }, { name: "Protein Shake Vanilla 330ml", qty: 2, unit: 299 }], { fees: [["Delivery", 0]] });
    add("holdout5-fuelbox-price-first-text", "Fuel Box", "text: '£7.50  Oat Bars x3'", { from: "Fuel Box <orders@fuelbox.co.uk>", subject: "Order FB-30012 confirmed", date: "Fri, 16 Oct 2026 07:00:00 +0000",
      text: ["Fuel Box", "Order FB-30012", "Order date: 16 October 2026", "", "£7.50   Oat Bars Chocolate Chip x3", "£5.98   Protein Shake Vanilla 330ml x2", "", moneyText(o, { free: "Free" })].join("\n") }, o, "Fuel Box", "2026-10-16");
  }
  {
    // A Welsh and English plain-text receipt, the item lines with "Nifer / Qty".
    const o = order([{ name: "Slate Coasters Set of 4", qty: 1, unit: 2200 }, { name: "Welsh Blanket Throw", qty: 1, unit: 8900 }], { fees: [["Postio / Postage", 450]] });
    add("holdout5-crefft-bilingual-text", "Crefft", "text: 'Nifer / Qty: 1' lines", { from: "Crefft <helo@crefft.cymru>", subject: "Archeb / Order CR-1102", date: "Thu, 15 Oct 2026 11:00:00 +0000",
      text: ["Crefft", "Rhif archeb / Order number: CR-1102", "Dyddiad / Date: 15/10/2026", "", "Slate Coasters Set of 4", "Nifer / Qty: 1", "£22.00", "", "Welsh Blanket Throw", "Nifer / Qty: 1", "£89.00", "",
        "Is-gyfanswm / Subtotal £111.00", "Postio / Postage £4.50", "Cyfanswm / Total £115.50"].join("\n") }, o, "Crefft", "2026-10-15");
  }
  {
    // Festival tickets as cards: each field a label on one line and its value on the next.
    const o = order([{ name: "Weekend Camping Ticket", qty: 2, unit: 23500 }, { name: "Car Park Pass", qty: 1, unit: 3500 }], { fees: [["Booking fee", 2400]] });
    add("holdout5-fieldfest-label-lines", "Field Fest", "tickets: 'Ticket type' over the name, 'Quantity' over 2", { from: "Field Fest <tickets@fieldfest.co.uk>", subject: "Your Field Fest 2027 tickets, order FF-221093", date: "Wed, 14 Oct 2026 19:00:00 +0000",
      html: page({ brand: "Field Fest", domain: "fieldfest.co.uk", rows: [`<p>Order number: FF-221093</p>`, `<p>Ordered on 14 October 2026</p>`,
        ...o.lines.map((i) => `<div>${dd("Ticket type")}${dd(h(i.name))}${dd("Quantity")}${dd(String(i.qty))}${dd("Price")}${dd(gbp(i.line))}</div>`), table(moneyRows(o))] }) }, o, "Field Fest", "2026-10-14");
  }
  {
    // An annual software plan, its VAT broken out under it.
    const o = order([{ name: "Pro Plan (annual)", qty: 1, unit: 9600 }]);
    add("holdout5-notely-annual-vat", "Notely", "annual plan, net and VAT lines", { from: "Notely <billing@notely.io>", subject: "Receipt for your Notely Pro renewal", date: "Tue, 13 Oct 2026 03:00:00 +0000",
      text: ["Notely", "Receipt #NTL-88120", "Date paid: October 13, 2026", "", "Pro Plan (annual)   £96.00", "Oct 13, 2026 – Oct 12, 2027", "", "Subtotal   £80.00", "VAT (20%)   £16.00", "Total   £96.00", "Amount paid   £96.00"].join("\n") }, o, "Notely", "2026-10-13");
  }
  {
    // A game key shop: the platform under each game, and a payment fee.
    const o = order([{ name: "Baldur's Gate 3", qty: 1, unit: 3499 }, { name: "Stardew Valley", qty: 1, unit: 899 }], { fees: [["Payment fee", 49]] });
    add("holdout5-keyhouse-digital", "Key House", "game keys: platform line, payment fee", { from: "Key House <orders@keyhouse.co.uk>", subject: "Your Key House order KH-901223", date: "Mon, 12 Oct 2026 21:00:00 +0000",
      html: page({ brand: "Key House", domain: "keyhouse.co.uk", rows: [`<p>Order KH-901223</p>`, `<p>12/10/2026</p>`,
        table([["Product", "Price"], ["Baldur's Gate 3<br>Platform: Steam", gbp(3499)], ["Stardew Valley<br>Platform: Steam", gbp(899)]]), table([["Subtotal", gbp(4398)], ["Payment fee", gbp(49)], ["<strong>Total</strong>", `<strong>${gbp(o.total)}</strong>`]])] }) }, o, "Key House", "2026-10-12");
  }
  {
    // A pay-at-table app: quantity at the end in its own column, service charge added.
    const o = order([{ name: "Margherita", qty: 2, unit: 1150 }, { name: "Nduja & Honey", qty: 1, unit: 1450 }, { name: "Tiramisu", qty: 2, unit: 650 }], { fees: [["Service charge", 525]] });
    add("holdout5-dough-paytable", "Dough", "pay at table: name, qty, line price columns", { from: "Dough Pizzeria <receipt@tabpay.co.uk>", subject: "Your receipt from Dough Pizzeria", date: "Sun, 11 Oct 2026 21:30:00 +0000",
      html: page({ brand: "Dough Pizzeria", domain: "tabpay.co.uk", rows: [`<p>Dough Pizzeria, Leeds</p>`, `<p>Table 7, 11 October 2026</p>`,
        table([["Margherita", "2", gbp(2300)], ["Nduja &amp; Honey", "1", gbp(1450)], ["Tiramisu", "2", gbp(1300)]]), table([["Subtotal", gbp(5050)], ["Service charge (optional)", gbp(525)], ["<strong>Total paid</strong>", `<strong>${gbp(5575)}</strong>`]])] }) }, o, "Dough Pizzeria", "2026-10-11", { shopAlso: ["Dough"] });
  }
  {
    // Furniture: each item's size on a line between its name and price, delivery and assembly as a service charge.
    const o = order([{ name: "Hamar Oak Dining Table", qty: 1, unit: 59900 }, { name: "Hamar Dining Chair", qty: 4, unit: 12900 }], { fees: [["Delivery and assembly", 4900]] });
    add("holdout5-oakhouse-dimensions", "Oak House", "dimension lines between name and price", { from: "Oak House Furniture <orders@oakhouse.co.uk>", subject: "Order confirmation OH-33091", date: "Sat, 10 Oct 2026 15:00:00 +0000",
      text: ["Oak House Furniture", "Order number: OH-33091", "Order date: 10 October 2026", "", "Hamar Oak Dining Table", "W 180 x D 90 x H 76 cm", "Quantity: 1", "£599.00", "", "Hamar Dining Chair", "W 45 x D 52 x H 88 cm", "Quantity: 4", "£516.00", "", moneyText(o)].join("\n") },
      o, "Oak House Furniture", "2026-10-10", { shopAlso: ["Oak House"] });
  }
  {
    // A clothing return-and-rebuy shop's order: "Description | Size | Colour | Qty | Price" with each on its own column.
    const o = order([{ name: "Slim Fit Oxford Shirt", qty: 2, unit: 3500 }, { name: "Chino Shorts", qty: 1, unit: 3000 }], { fees: [["Delivery", 450]] });
    add("holdout5-charlesbrook-five-cols", "Charles Brook", "Description | Size | Colour | Qty | Price", { from: "Charles Brook <orders@charlesbrook.co.uk>", subject: "Your Charles Brook order CB10022", date: "Fri, 9 Oct 2026 10:00:00 +0000",
      html: page({ brand: "Charles Brook", domain: "charlesbrook.co.uk", rows: [`<p>Order number: CB10022</p>`, `<p>9 October 2026</p>`,
        table([["Description", "Size", "Colour", "Qty", "Price"], ["Slim Fit Oxford Shirt", "15.5", "Sky Blue", "2", gbp(7000)], ["Chino Shorts", "32", "Stone", "1", gbp(3000)]]), table(moneyRows(o))] }) }, o, "Charles Brook", "2026-10-09");
  }
  {
    // A supermarket delivery where each line gives its quantity and price as "2 × £1.10" under the name, a unit price.
    const o = order([{ name: "Warburtons Toastie White 800g", qty: 2, unit: 140 }, { name: "Yeo Valley Natural Yogurt 500g", qty: 1, unit: 210 }, { name: "Free Range Eggs Large 12", qty: 1, unit: 375 }], { fees: [["Delivery charge", 400]] });
    add("holdout5-ocado-unit-under", "Ocado", "'2 × £1.40' under the name, line total right", { from: "Ocado <customerservices@ocado.com>", subject: "Your Ocado receipt", date: "Thu, 8 Oct 2026 09:00:00 +0000",
      html: page({ brand: "Ocado", domain: "ocado.com", rows: [`<p>Order number: 902211334</p>`, `<p>Delivered 8 October 2026</p>`,
        table(o.lines.map((i) => [`${h(i.name)}<br>${i.qty} × ${gbp(i.unit)}`, gbp(i.line)])), table(moneyRows(o, { subtotal: "Items" }))] }) }, o, "Ocado", "2026-10-08");
  }

  // Not purchases: a price adjustment whose subject says "refund", a cancellation that says it will be refunded, and a
  // refund the shopper forwarded from their own inbox.
  not("holdout5-argos-price-refund", "Argos", "price adjustment, 'refund' in the subject", { from: "Argos <noreply@argos.co.uk>", subject: "We've refunded the price difference on order 1100223344", date: "Thu, 19 Nov 2026 09:00:00 +0000",
    html: page({ brand: "Argos", domain: "argos.co.uk", rows: [`<p>Hi Sam,</p>`, `<p>The price of an item you bought has dropped, so we've refunded the difference of £10.00.</p>`, `<p>Order number: 1100223344</p>`,
      table([["Ninja Air Fryer AF100UK", "Was £99.99", "Now £89.99"]]), table([["Price difference refunded", "£10.00"]])] }) }, { kind: "price_adjustment" });
  not("holdout5-boden-cancel-refund", "Boden", "cancelled, 'refund' in the subject", { from: "Boden <orders@boden.co.uk>", subject: "Your order has been cancelled and refunded", date: "Thu, 19 Nov 2026 10:00:00 +0000",
    text: ["Boden", "We're sorry: we've cancelled your order because the item is out of stock.", "Order number: BD-5512093", "", "Wool Blend Coat  £180.00", "", "Your refund of £180.00 will reach your card in 3-5 working days."].join("\n") }, { kind: "cancellation" });
  return out;
}
