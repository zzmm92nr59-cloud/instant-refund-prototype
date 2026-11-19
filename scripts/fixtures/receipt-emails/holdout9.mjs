// A tenth set of made-up emails (see lib.mjs), round 8: fifty of the UK orders people get most, in layouts not yet in the
// corpus, written BEFORE any change for them and scored first try (scores in the round 8 commit). Takeaway apps (Just Eat,
// Deliveroo, Uber Eats: meal deals with choices, half-and-half pizzas, "Extras:" lines, notes like "no onions", allergy
// notes, the same item twice with different extras, promo and free items, Plus/Just Eat+ fees, small order and bag fees,
// rider tips), restaurants' own apps, supermarket deliveries (substitutions, unavailable, Clubcard prices, multibuys,
// weighed and age-restricted items, bag charges), Amazon UK (several sellers, Subscribe & Save, gift wrap, promotional
// credit) and fashion (the same item in two sizes).
// Every order, person, address, order number and card here is made up.
import { order, expected, page, table, moneyRows, moneyText, fixture, gbp, h, SHOPPER } from "./lib.mjs";

const R = (cells) => cells.map((c) => [c[0], { td: c[1], attrs: 'align="right"' }]);
const money = (o, labels) => table(R(moneyRows(o, labels)));

export default function holdout9() {
  const out = [];
  const add = (id, sender, layout, mail, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, mail, expected(shop, date, o, extra)); out.push(f); return f; };
  const JE = "Just Eat <noreply@t.just-eat.co.uk>", DR = "Deliveroo <noreply@t.deliveroo.com>", UE = "Uber Eats <noreply@uber.com>";

  // ---- Just Eat -------------------------------------------------------------------------------------------------------
  {
    // A meal deal whose choices are listed under it with no prices, and a half-and-half pizza.
    const o = order([
      { name: "Family Meal Deal", qty: 1, unit: 2499, extras: ["Large Pepperoni Pizza", "Large Hawaiian Pizza", "Garlic Bread", "1.5L Pepsi Max"] },
      { name: "Half & Half 12\" Pizza", qty: 1, unit: 1349, extras: ["Left: BBQ Chicken", "Right: Vegetarian Supreme"] },
      { name: "Cookie Dough Ice Cream 500ml", qty: 1, unit: 599 },
    ], { fees: [["Delivery fee", 199], ["Service charge", 99], ["Bag fee", 10]] });
    const html = page({ brand: "Just Eat", domain: "just-eat.co.uk", rows: [`<h1>Order confirmed</h1>`, `<p>Pizza Palace is preparing your order.</p>`, `<p>Order number: 1860021145</p>`, `<p>Placed on 18 November 2026 at 19:02</p>`,
      table(o.lines.flatMap((i) => [[`${i.qty}x <strong>${h(i.name)}</strong>`, { td: gbp(i.line), attrs: 'align="right"' }], ...(i.extras || []).map((e) => [`<span style="color:#666;padding-left:16px">&ndash; ${h(e)}</span>`, ""])])), `<hr/>`, money(o)] });
    add("holdout9-je-mealdeal-dash-choices", "Just Eat", "meal deal choices as '– choice' rows, half and half pizza", { from: JE, subject: "Your order with Pizza Palace is confirmed", date: "Wed, 18 Nov 2026 19:03:00 +0000", html }, o, "Just Eat", "2026-11-18");
  }
  {
    // "Extras: a, b" on one line, a note "no onions", an allergy note for the whole order, Just Eat+ free delivery.
    const o = order([
      { name: "Doner Kebab Large", qty: 1, unit: 1050, extras: ["Garlic Mayo", "Chilli Sauce", "no onions"] },
      { name: "Chicken Shish Wrap", qty: 1, unit: 899, extras: ["Extra Halloumi"] },
      { name: "Cheesy Chips", qty: 2, unit: 450 },
    ], { fees: [["Delivery fee (Just Eat+)", 0], ["Service charge", 99]] });
    const text = ["Thanks for your order!", "Anatolia Grill", "Order number: 1860330218", "Order date: 17/11/2026", "", "Allergy note: Customer has a sesame allergy", "",
      "1 x Doner Kebab Large £10.50", "Extras: Garlic Mayo, Chilli Sauce", "Note: no onions", "1 x Chicken Shish Wrap £8.99", "Extras: Extra Halloumi", "2 x Cheesy Chips £9.00", "",
      "Subtotal £28.49", "Delivery fee (Just Eat+) FREE", "Service charge £0.99", "Total £29.48", "", "Just Eat"].join("\n");
    add("holdout9-je-extras-colon-note-text", "Just Eat", "text only: 'Extras: a, b' line, 'Note: no onions', allergy note, Just Eat+ free delivery", { from: JE, subject: "Thanks for your order", date: "Tue, 17 Nov 2026 20:15:00 +0000", text }, o, "Just Eat", "2026-11-17");
  }
  {
    // The same burger twice with different extras, as two lines; a free item at £0.00 from an offer.
    const o = order([
      { name: "Smash Burger", qty: 1, unit: 899, extras: ["Add Bacon (+£1.00)"] },
      { name: "Smash Burger", qty: 1, unit: 799, extras: ["No Pickles"] },
      { name: "Free Loaded Fries (offer)", qty: 1, unit: 0 },
      { name: "Oreo Milkshake", qty: 1, unit: 450 },
    ], { fees: [["Delivery fee", 249], ["Service charge", 99], ["Small order fee", 0]], tips: [["Courier tip", 100]] });
    const html = page({ brand: "Just Eat", domain: "just-eat.co.uk", rows: [`<h2>Thanks, ${SHOPPER.first}!</h2>`, `<p>Your order from Patty Shack</p>`, `<p>Order #1860442290 &middot; 16 Nov 2026</p>`,
      table([["Qty", "Item", { td: "Price", attrs: 'align="right"' }], ...o.lines.map((i) => [String(i.qty), h(i.name) + (i.extras || []).map((e) => `<br/><small style="font-size:13px;color:#777">${h(e)}</small>`).join(""), { td: i.line ? gbp(i.line) : "£0.00", attrs: 'align="right" valign="top"' }])]), money(o)] });
    add("holdout9-je-same-item-two-extras", "Just Eat", "header row Qty/Item/Price, same burger twice with different extras, free offer item", { from: JE, subject: "Your Just Eat order from Patty Shack", date: "Mon, 16 Nov 2026 21:00:00 +0000", html }, o, "Just Eat", "2026-11-16");
  }
  {
    // A promo item ("2 for £12") with the saving as its own line, an item note in italics.
    const o = order([
      { name: "Chicken Katsu Curry", qty: 2, unit: 795, extras: ["Extra sauce please"] },
      { name: "Chicken Gyoza (5)", qty: 1, unit: 550 },
      { name: "Edamame", qty: 1, unit: 395 },
    ], { fees: [["Delivery fee", 299], ["Service charge", 99], ["Bag fee", 10]], discounts: [["2 for £12 offer", 390]] });
    const html = page({ brand: "Just Eat", domain: "just-eat.co.uk", rows: [`<p>Tokyo Kitchen has your order.</p>`, `<p>Order number: 1860559013<br/>18 Nov 2026</p>`,
      table(o.lines.flatMap((i) => [[`${i.qty} x ${h(i.name)}`, { td: gbp(i.line), attrs: 'align="right"' }], ...(i.extras || []).map((e) => [`<em>&ldquo;${h(e)}&rdquo;</em>`, ""])])), money(o)] });
    add("holdout9-je-promo-note-quoted", "Just Eat", "'2 for £12 offer' saving line, item note in quotes", { from: JE, subject: "Order confirmed: Tokyo Kitchen", date: "Wed, 18 Nov 2026 18:20:00 +0000", html }, o, "Just Eat", "2026-11-18");
  }
  {
    // Name and price in one cell row, then the options in a smaller second row; a voucher and rider tip; total "Order total".
    const o = order([
      { name: "Lamb Biryani", qty: 1, unit: 1195, extras: ["Hot", "Raita"] },
      { name: "Paneer Tikka Starter", qty: 1, unit: 595 },
      { name: "Garlic Naan", qty: 2, unit: 295 },
      { name: "Pilau Rice", qty: 1, unit: 325 },
    ], { fees: [["Delivery", 150], ["Service charge", 99]], discounts: [["Voucher", 300]], tips: [["Rider tip", 200]] });
    const html = page({ brand: "Just Eat", domain: "just-eat.co.uk", rows: [`<p>Order from Royal Spice</p>`, `<p>Order number: 1860661120</p><p>15 November 2026</p>`,
      ...o.lines.map((i) => `<table width="100%"><tr><td><b>${i.qty}</b> ${h(i.name)}</td><td align="right">${gbp(i.line)}</td></tr>${i.extras ? `<tr><td colspan="2" style="font-size:13px;color:#888">${i.extras.map(h).join(", ")}</td></tr>` : ""}</table>`),
      money(o, { total: "Order total" })] });
    add("holdout9-je-item-tables-options-row", "Just Eat", "one table per item, options comma-joined in a colspan row", { from: JE, subject: "We've got your order", date: "Sun, 15 Nov 2026 19:30:00 +0000", html }, o, "Just Eat", "2026-11-15");
  }
  {
    // Text with tab columns: qty TAB name TAB price, options on "  - " lines, and "Small order fee".
    const o = order([
      { name: "Fish & Chips Regular", qty: 1, unit: 850, extras: ["Mushy Peas"] },
      { name: "Battered Sausage", qty: 1, unit: 250 },
    ], { fees: [["Delivery fee", 199], ["Small order fee", 150], ["Service charge", 50]] });
    const text = ["Just Eat", "Order from The Codfather", "Order number: 1860770045", "Order placed: 14 November 2026 18:05", "",
      "Qty\tItem\tPrice", ...o.lines.flatMap((i) => [`${i.qty}\t${i.name}\t${gbp(i.line)}`, ...(i.extras || []).map((e) => `  - ${e}`)]), "", moneyText(o, {}, "\t")].join("\n");
    add("holdout9-je-tabs-text", "Just Eat", "text with tab columns, '  - ' options, small order fee", { from: JE, subject: "Your order is on its way to the restaurant", date: "Sat, 14 Nov 2026 18:06:00 +0000", text }, o, "Just Eat", "2026-11-14");
  }

  // ---- Deliveroo ------------------------------------------------------------------------------------------------------
  {
    // Deliveroo Plus: delivery struck through as free, a meal deal with "Choose your side:" choices.
    const o = order([
      { name: "Burger Meal Deal", qty: 1, unit: 1299, extras: ["Choose your burger: Classic Cheeseburger", "Choose your side: Sweet Potato Fries", "Choose your drink: Diet Coke"] },
      { name: "Onion Rings", qty: 1, unit: 399 },
    ], { fees: [["Delivery fee", 0], ["Service fee", 149]], tips: [["Rider tip", 150]] });
    const html = page({ brand: "Deliveroo", domain: "deliveroo.co.uk", rows: [`<h1>Your order's been placed</h1>`, `<p>Order from Honest Patty &mdash; #1123</p>`, `<p>Order number: 7780-1123</p><p>18 November 2026</p>`,
      table(o.lines.flatMap((i) => [[`${i.qty}x`, `<strong>${h(i.name)}</strong>`, { td: gbp(i.line), attrs: 'align="right"' }], ...(i.extras || []).map((e) => ["", `<span style="font-size:13px">${h(e)}</span>`, ""])])),
      table([["Subtotal", { td: gbp(o.subtotal), attrs: 'align="right"' }], ["Delivery fee", { td: `<s>£2.99</s> £0.00 with Plus`, attrs: 'align="right"' }], ["Service fee", { td: gbp(149), attrs: 'align="right"' }], ["Rider tip", { td: gbp(150), attrs: 'align="right"' }], ["<b>Total</b>", { td: `<b>${gbp(o.total)}</b>`, attrs: 'align="right"' }]])] });
    add("holdout9-dr-plus-struck-delivery", "Deliveroo", "Plus: delivery '£2.99 struck £0.00 with Plus', 'Choose your side:' choices", { from: DR, subject: "Your Deliveroo order from Honest Patty", date: "Wed, 18 Nov 2026 12:40:00 +0000", html }, o, "Deliveroo", "2026-11-18");
  }
  {
    // Text: "Item name x2 £9.00", modifiers in brackets on the next line, small order fee and bag fee.
    const o = order([
      { name: "Pad Thai Chicken", qty: 2, unit: 950, extras: ["Mild", "No peanuts (allergy)"] },
      { name: "Thai Fish Cakes", qty: 1, unit: 650 },
      { name: "Jasmine Rice", qty: 1, unit: 300 },
    ], { fees: [["Delivery fee", 349], ["Service fee", 99], ["Bag fee", 20]] });
    const text = ["deliveroo", "Thanks for your order from Siam Street", "Order 9921-0045", "17 November 2026", "", ...o.lines.flatMap((i) => [`${i.name} x${i.qty}   ${gbp(i.line)}`, ...(i.extras ? [`(${i.extras.join(", ")})`] : [])]), "", moneyText(o, {}, "   ")].join("\n");
    add("holdout9-dr-text-name-x2-brackets", "Deliveroo", "text: 'name x2 £', modifiers in brackets on the next line, bag fee", { from: DR, subject: "Your order from Siam Street", date: "Tue, 17 Nov 2026 19:10:00 +0000", text }, o, "Deliveroo", "2026-11-17");
  }
  {
    // A free item from a promotion shown as "FREE", priced extras with "+£" inside the item's price, credit applied.
    const o = order([
      { name: "Chicken Shawarma Plate", qty: 1, unit: 1295, extras: ["Extra garlic sauce +£0.50", "Add fries +£1.50"] },
      { name: "Hummus & Pitta", qty: 1, unit: 0 },
      { name: "Baklava (3 pieces)", qty: 1, unit: 450 },
    ], { fees: [["Delivery fee", 199], ["Service fee", 135], ["Small order fee", 0]], discounts: [["Deliveroo credit", 400]] });
    const html = page({ brand: "Deliveroo", domain: "deliveroo.co.uk", rows: [`<p>Order #4471 from Beirut Nights</p>`, `<p>Order number: 4471-8820</p><p>16 Nov 2026</p>`,
      table(o.lines.map((i) => [`${i.qty} &times; ${h(i.name)}${(i.extras || []).map((e) => `<div style="font-size:13px;color:#585C5C">${h(e)}</div>`).join("")}`, { td: i.line ? gbp(i.line) : "FREE", attrs: 'align="right" valign="top"' }])), money(o)] });
    add("holdout9-dr-free-item-word", "Deliveroo", "promo item priced 'FREE', priced extras inside, credit", { from: DR, subject: "Order confirmed", date: "Mon, 16 Nov 2026 13:00:00 +0000", html }, o, "Deliveroo", "2026-11-16");
  }
  {
    // Grocery-style Deliveroo (Co-op via Deliveroo): weighed item, age-restricted item note, a bag fee.
    const o = order([
      { name: "Co-op Bananas Loose", qty: 1, unit: 74 },
      { name: "Hovis Soft White Medium 800g", qty: 1, unit: 165 },
      { name: "Stella Artois 4 x 440ml", qty: 1, unit: 600 },
      { name: "Cathedral City Mature Cheddar 350g", qty: 1, unit: 425 },
    ], { fees: [["Delivery fee", 249], ["Service fee", 99], ["Bag fee", 30]] });
    const html = page({ brand: "Deliveroo", domain: "deliveroo.co.uk", rows: [`<p>Your Co-op order</p>`, `<p>Order number: 6620-3301</p><p>15 November 2026</p>`,
      table([[`1x`, `Co-op Bananas Loose<br/><span style="font-size:13px">0.62kg @ £1.19/kg</span>`, gbp(74)], [`1x`, "Hovis Soft White Medium 800g", gbp(165)], [`1x`, `Stella Artois 4 x 440ml<br/><span style="font-size:13px">Age restricted: ID may be checked</span>`, gbp(600)], [`1x`, "Cathedral City Mature Cheddar 350g", gbp(425)]]), money(o)] });
    add("holdout9-dr-grocery-weighed-age", "Deliveroo", "grocery: kg @ price/kg under a name, age-restricted note", { from: DR, subject: "Your order from Co-op", date: "Sun, 15 Nov 2026 17:00:00 +0000", html }, o, "Deliveroo", "2026-11-15");
  }
  {
    // Price column BEFORE the name, multiple of the same item with different extras and a "Rider tip" written "Tip for your rider".
    const o = order([
      { name: "Build Your Own Bowl", qty: 1, unit: 1150, extras: ["Brown rice", "Teriyaki tofu"] },
      { name: "Build Your Own Bowl", qty: 1, unit: 1250, extras: ["Sushi rice", "Salmon"] },
      { name: "Miso Soup", qty: 2, unit: 250 },
    ], { fees: [["Delivery fee", 99], ["Service fee", 175]], tips: [["Tip for your rider", 100]] });
    const html = page({ brand: "Deliveroo", domain: "deliveroo.co.uk", rows: [`<p>Thanks for ordering from Poke Point</p>`, `<p>Order number: 5512-0090</p><p>14 November 2026</p>`,
      table(o.lines.map((i) => [{ td: gbp(i.line), attrs: 'width="70" valign="top"' }, `${i.qty}x ${h(i.name)}${i.extras ? `<br/><span style="font-size:13px">${i.extras.map(h).join(" / ")}</span>` : ""}`])), money(o)] });
    add("holdout9-dr-price-first-cell", "Deliveroo", "price cell before the name, two bowls with different options joined by ' / '", { from: DR, subject: "Your Deliveroo receipt", date: "Sat, 14 Nov 2026 13:20:00 +0000", html }, o, "Deliveroo", "2026-11-14");
  }
  {
    // A <ul> of items with "Qty: 2" and "£" spans, notes after "Special instructions:".
    const o = order([
      { name: "Margherita Pizza 12\"", qty: 1, unit: 1100, extras: ["well done please"] },
      { name: "Nduja Pizza 12\"", qty: 1, unit: 1350 },
      { name: "Tiramisu", qty: 2, unit: 550 },
    ], { fees: [["Delivery fee", 299], ["Service fee", 99]], discounts: [["20% off first order", 590]] });
    const li = o.lines.map((i) => `<li><span>${h(i.name)}</span> <span>Qty: ${i.qty}</span> <span style="float:right">${gbp(i.line)}</span>${i.extras ? `<br/><span style="font-size:13px">Special instructions: ${h(i.extras[0])}</span>` : ""}</li>`).join("");
    const html = page({ brand: "Deliveroo", domain: "deliveroo.co.uk", rows: [`<p>Forno Rosso</p>`, `<p>Order number: 3309-7721</p><p>13 Nov 2026</p>`, `<ul style="list-style:none;padding:0">${li}</ul>`, money(o)] });
    add("holdout9-dr-ul-qty-special", "Deliveroo", "<ul> items 'name Qty: n £', 'Special instructions:' note, % discount", { from: DR, subject: "Your order from Forno Rosso", date: "Fri, 13 Nov 2026 20:00:00 +0000", html }, o, "Deliveroo", "2026-11-13");
  }

  // ---- Uber Eats ------------------------------------------------------------------------------------------------------
  {
    // Uber's receipt: "2   Item   £x" rows, options in grey, "Uber One" delivery saving, CA-style "Taxes" absent, tip.
    const o = order([
      { name: "Spicy Chicken Sandwich", qty: 2, unit: 699, extras: ["Make it a meal", "Medium Fries"] },
      { name: "6 Nuggets", qty: 1, unit: 399 },
      { name: "Vanilla Milkshake", qty: 1, unit: 299 },
    ], { fees: [["Delivery Fee", 0], ["Service Fee", 165]], discounts: [["Uber One savings", 0]], tips: [["Tip", 200]] });
    o.discounts = []; o.discSum = 0; o.total = o.subtotal + o.feeSum + o.tipSum;
    const html = page({ brand: "Uber Eats", domain: "uber.com", rows: [`<h1>${gbp(o.total)}</h1>`, `<p>Thanks for ordering, ${SHOPPER.first}</p>`, `<p>Here's your receipt for Chick Shack.</p>`, `<p>18 November 2026</p>`,
      table(o.lines.map((i) => [String(i.qty), `${h(i.name)}${(i.extras || []).map((e) => `<div style="color:#757575;font-size:13px">${h(e)}</div>`).join("")}`, { td: gbp(i.line), attrs: 'align="right" valign="top"' }])),
      table([["Subtotal", { td: gbp(o.subtotal), attrs: 'align="right"' }], ["Delivery Fee", { td: "£0.00", attrs: 'align="right"' }], ["Service Fee", { td: gbp(165), attrs: 'align="right"' }], ["Tip", { td: gbp(200), attrs: 'align="right"' }], ["<b>Total</b>", { td: `<b>${gbp(o.total)}</b>`, attrs: 'align="right"' }]]),
      `<p>Uber One: you saved £2.49 on delivery</p>`] });
    add("holdout9-ue-total-on-top-uber-one", "Uber Eats", "total as the big heading, Uber One savings sentence, options in grey", { from: UE, subject: "Your Wednesday evening order with Uber Eats", date: "Wed, 18 Nov 2026 20:30:00 +0000", html }, o, "Uber Eats", "2026-11-18");
  }
  {
    // Text: item, options indented under it, a "Promotion" line, small order fee.
    const o = order([
      { name: "Chicken Burrito", qty: 1, unit: 899, extras: ["Black beans", "Hot salsa", "No sour cream"] },
      { name: "Chips & Guacamole", qty: 1, unit: 399 },
    ], { fees: [["Delivery Fee", 199], ["Service Fee", 99], ["Small Order Fee", 150]], discounts: [["Promotion", 300]] });
    const text = ["Uber Eats", "Here's your receipt for Burrito Bros, Sam.", "Order date: 17 November 2026", "", ...o.lines.flatMap((i) => [`${i.qty}  ${i.name}  ${gbp(i.line)}`, ...(i.extras || []).map((e) => `     ${e}`)]), "", moneyText(o, {}, "  ")].join("\n");
    add("holdout9-ue-text-indented-options", "Uber Eats", "text: '1  Name  £', options indented, promotion and small order fee", { from: UE, subject: "Your Tuesday lunch order with Uber Eats", date: "Tue, 17 Nov 2026 13:10:00 +0000", text }, o, "Uber Eats", "2026-11-17");
  }
  {
    // A Uber Eats grocery order: replaced item ("Replaced with"), a refunded unavailable item, a bag fee.
    const o = order([
      { name: "Heinz Baked Beanz 4 x 415g", qty: 1, unit: 450 },
      { name: "Lurpak Slightly Salted 250g", qty: 1, unit: 299, unavailable: true },
      { name: "Flora Original 450g", qty: 1, unit: 249 },
      { name: "Kingsmill 50/50 800g", qty: 2, unit: 155 },
    ], { fees: [["Delivery Fee", 199], ["Service Fee", 125], ["Bag Fee", 10]] });
    const html = page({ brand: "Uber Eats", domain: "uber.com", rows: [`<p>Your Tesco Express order</p>`, `<p>16 November 2026</p>`,
      table([["1", "Heinz Baked Beanz 4 x 415g", gbp(450)], ["1", `<s>Lurpak Slightly Salted 250g</s><br/><span style="font-size:13px">Unavailable &ndash; refunded</span>`, `<s>${gbp(299)}</s>`], ["1", `Flora Original 450g<br/><span style="font-size:13px">Replaced Lurpak Slightly Salted 250g</span>`, gbp(249)], ["2", "Kingsmill 50/50 800g", gbp(310)]]), money(o)] });
    add("holdout9-ue-grocery-struck-unavailable", "Uber Eats", "grocery: unavailable item struck through, 'Replaced X' note", { from: UE, subject: "Your order from Tesco Express", date: "Mon, 16 Nov 2026 11:00:00 +0000", html }, o, "Uber Eats", "2026-11-16");
  }
  {
    // Name cell, qty cell "x1", price cell; a BOGOF item at full price with its free twin as a separate £0.00 line.
    const o = order([
      { name: "Whopper", qty: 1, unit: 649 },
      { name: "Whopper (Buy One Get One Free)", qty: 1, unit: 0 },
      { name: "Large Fries", qty: 1, unit: 299 },
      { name: "Chicken Royale", qty: 1, unit: 599, extras: ["No mayo"] },
    ], { fees: [["Delivery Fee", 249], ["Service Fee", 99]], tips: [["Tip", 100]] });
    const html = page({ brand: "Uber Eats", domain: "uber.com", rows: [`<p>Receipt for Burger King</p>`, `<p>15 Nov 2026</p>`,
      table(o.lines.map((i) => [h(i.name) + (i.extras ? `<br/><span style="font-size:13px">${h(i.extras[0])}</span>` : ""), `x${i.qty}`, { td: gbp(i.line), attrs: 'align="right"' }])), money(o)] });
    add("holdout9-ue-bogof-zero-line", "Uber Eats", "name | x1 | price, a BOGOF free twin at £0.00", { from: UE, subject: "Your Sunday order with Uber Eats", date: "Sun, 15 Nov 2026 19:00:00 +0000", html }, o, "Uber Eats", "2026-11-15");
  }
  {
    // Two of the same pizza with different toppings; half and half written "1/2 ... 1/2 ..."; an allergy note at the end.
    const o = order([
      { name: "Large Pizza", qty: 1, unit: 1499, extras: ["1/2 Pepperoni", "1/2 Mushroom"] },
      { name: "Large Pizza", qty: 1, unit: 1599, extras: ["Meat Feast", "Extra cheese +£1.00"] },
      { name: "Garlic Dough Balls", qty: 1, unit: 450 },
    ], { fees: [["Delivery Fee", 199], ["Service Fee", 99], ["Bag Fee", 10]] });
    const text = ["Uber Eats", "Thanks for ordering from Slice Society", "14 November 2026", "", ...o.lines.flatMap((i) => [`${i.qty} x ${i.name} - ${gbp(i.line)}`, ...(i.extras || []).map((e) => `   ${e}`)]), "", "Allergy info: no nuts please", "", moneyText(o, {}, " - ")].join("\n");
    add("holdout9-ue-two-pizzas-halves-text", "Uber Eats", "text: 'n x Name - £', same pizza twice, halves, allergy line", { from: UE, subject: "Your order from Slice Society", date: "Sat, 14 Nov 2026 21:00:00 +0000", text }, o, "Uber Eats", "2026-11-14");
  }
  {
    // Option groups with headings ("Sauce", "Drink") inside the item's cell; price per unit and line shown "£5.49 each".
    const o = order([
      { name: "Wings Box (10)", qty: 2, unit: 549, extras: ["Sauce: Buffalo", "Dip: Blue Cheese"] },
      { name: "Fountain Drink", qty: 1, unit: 199, extras: ["Drink: Fanta Orange"] },
    ], { fees: [["Delivery Fee", 349], ["Service Fee", 99]], discounts: [["Uber One discount", 100]] });
    const html = page({ brand: "Uber Eats", domain: "uber.com", rows: [`<p>Here's your receipt for Wing It</p>`, `<p>13 November 2026</p>`,
      table(o.lines.map((i) => [`${i.qty}`, `<b>${h(i.name)}</b>${i.extras.map((e) => `<div style="font-size:13px">${h(e)}</div>`).join("")}<div style="font-size:13px">${gbp(i.unit)} each</div>`, { td: gbp(i.line), attrs: 'align="right" valign="top"' }])), money(o)] });
    add("holdout9-ue-option-groups-each", "Uber Eats", "'Sauce: Buffalo' groups and '£5.49 each' under the name", { from: UE, subject: "Your Friday order with Uber Eats", date: "Fri, 13 Nov 2026 19:45:00 +0000", html }, o, "Uber Eats", "2026-11-13");
  }

  // ---- Restaurants' own ordering --------------------------------------------------------------------------------------
  {
    // Domino's: a deal with two pizzas inside it, each with its own crust; deal price on the deal line.
    const o = order([
      { name: "Two Large Pizzas Deal", qty: 1, unit: 2999, extras: ["Large Pepperoni Passion (Classic Crust)", "Large Mighty Meaty (Stuffed Crust)"] },
      { name: "Chicken Strippers", qty: 1, unit: 599 },
      { name: "Cookies (4)", qty: 1, unit: 399 },
    ], { fees: [["Delivery charge", 0]] });
    const html = page({ brand: "Domino's", domain: "dominos.co.uk", rows: [`<p>Thanks for your order</p>`, `<p>Order number: 245</p><p>Order date: 18/11/2026</p>`,
      table(o.lines.flatMap((i) => [[`<b>${h(i.name)}</b>`, `${i.qty}`, { td: gbp(i.line), attrs: 'align="right"' }], ...(i.extras || []).map((e) => [`&nbsp;&nbsp;${h(e)}`, "", ""])])), money(o)] });
    add("holdout9-dominos-deal-pizzas", "Domino's", "deal row then its pizzas as rows with empty qty and price", { from: "Domino's Pizza <orders@dominos.co.uk>", subject: "Domino's order confirmation", date: "Wed, 18 Nov 2026 18:30:00 +0000", html }, o, "Domino's", "2026-11-18");
  }
  {
    // Nando's: "1/2 Chicken" with spice level, "PERi-PERi Chips" regular, the Nando's card points line.
    const o = order([
      { name: "1/2 Chicken", qty: 1, unit: 995, extras: ["Hot", "Spicy Rice", "Corn on the Cob"] },
      { name: "Wing Platter", qty: 1, unit: 1650, extras: ["Lemon & Herb"] },
      { name: "Bottomless Soft Drink", qty: 2, unit: 335 },
    ]);
    const text = ["Nando's", "Thanks for your order!", "Order number: N-88213", "Collection from Nando's Leeds Trinity", "18 November 2026", "",
      ...o.lines.flatMap((i) => [`${i.name} x${i.qty} ${gbp(i.line)}`, ...(i.extras || []).map((e) => `- ${e}`)]), "", `Total ${gbp(o.total)}`, "", "You earned 1 chilli on your Nando's card"].join("\n");
    add("holdout9-nandos-half-chicken", "Nando's", "text: '1/2 Chicken x1 £', '- ' options, total only", { from: "Nando's <noreply@nandos.co.uk>", subject: "Your Nando's order", date: "Wed, 18 Nov 2026 17:45:00 +0000", text }, o, "Nando's", "2026-11-18");
  }
  {
    // wagamama: lowercase, the price before the qty, side "add chilli oil" priced inside.
    const o = order([
      { name: "chicken katsu curry", qty: 1, unit: 1550 },
      { name: "yaki soba", qty: 1, unit: 1395, extras: ["no egg"] },
      { name: "duck gyoza", qty: 1, unit: 750 },
    ], { fees: [["Delivery", 299]] });
    const html = page({ brand: "wagamama", domain: "wagamama.com", rows: [`<p>your wagamama order</p>`, `<p>order no. W-447120</p><p>17 november 2026</p>`,
      table([["item", "price", "qty"], ...o.lines.map((i) => [h(i.name) + (i.extras ? `<br/><span style="font-size:13px">${h(i.extras[0])}</span>` : ""), gbp(i.unit), String(i.qty)])]), money(o, { subtotal: "subtotal", total: "total" })] });
    add("holdout9-wagamama-item-price-qty", "Wagamama", "lowercase columns item | price | qty", { from: "wagamama <receipts@wagamama.com>", subject: "your wagamama order", date: "Tue, 17 Nov 2026 19:00:00 +0000", html }, o, "wagamama", "2026-11-17");
  }
  {
    // Five Guys: toppings listed as many lines, free toppings, "Little" sizes.
    const o = order([
      { name: "Cheeseburger", qty: 1, unit: 1225, extras: ["Lettuce", "Pickles", "Grilled Onions", "Ketchup"] },
      { name: "Little Bacon Burger", qty: 1, unit: 1025, extras: ["Mayo", "Jalapeño Peppers"] },
      { name: "Regular Cajun Fries", qty: 1, unit: 595 },
      { name: "Milkshake", qty: 1, unit: 625, extras: ["Biscoff", "Banana"] },
    ]);
    const html = page({ brand: "Five Guys", domain: "fiveguys.co.uk", rows: [`<p>Thanks for ordering with Five Guys</p>`, `<p>Order #FG-55021</p><p>Pickup at 18:20, 16 November 2026</p>`,
      table(o.lines.flatMap((i) => [[`${i.qty} ${h(i.name)}`, { td: gbp(i.line), attrs: 'align="right"' }], ...(i.extras || []).map((e) => [`<span style="padding-left:12px;font-size:13px">${h(e)}</span>`, { td: "£0.00", attrs: 'align="right"' }])])),
      table([["Subtotal", gbp(o.subtotal)], ["VAT included", gbp(Math.round(o.subtotal / 6))], ["<b>Total</b>", `<b>${gbp(o.total)}</b>`]])] });
    add("holdout9-fiveguys-toppings-zero", "Five Guys", "toppings as their own £0.00 rows under each item, VAT included line", { from: "Five Guys <orders@fiveguys.co.uk>", subject: "Your Five Guys order FG-55021", date: "Mon, 16 Nov 2026 18:00:00 +0000", html }, o, "Five Guys", "2026-11-16");
  }
  {
    // Greggs app: a meal deal with a drink choice, rewards stamp free item "Free reward".
    const o = order([
      { name: "Breakfast Meal Deal", qty: 1, unit: 400, extras: ["Bacon Roll", "Regular Latte"] },
      { name: "Sausage Roll", qty: 2, unit: 125 },
      { name: "Yum Yum (Reward)", qty: 1, unit: 0 },
    ]);
    const text = ["Greggs", "Your order is ready to collect", "Order: GR-77310", "Date: 15/11/2026", "", ...o.lines.flatMap((i) => [`${i.qty} ${i.name} ${i.line ? gbp(i.line) : "Free"}`, ...(i.extras || []).map((e) => `   with ${e}`)]), "", `Total paid ${gbp(o.total)}`].join("\n");
    add("holdout9-greggs-mealdeal-with", "Greggs", "text: '1 Name £', 'with X' choices, a free reward", { from: "Greggs <noreply@greggs.co.uk>", subject: "Your Greggs order GR-77310", date: "Sun, 15 Nov 2026 08:10:00 +0000", text }, o, "Greggs", "2026-11-15");
  }
  {
    // Pret: Club Pret subscription drinks at £0.00, food priced; "Eat in" / "Take away" column.
    const o = order([
      { name: "Oat Flat White", qty: 1, unit: 0, extras: ["Club Pret"] },
      { name: "Iced Latte", qty: 1, unit: 0, extras: ["Club Pret"] },
      { name: "Chicken & Avocado Sandwich", qty: 1, unit: 525 },
      { name: "Almond Croissant", qty: 1, unit: 295 },
    ]);
    const html = page({ brand: "Pret A Manger", domain: "pret.co.uk", rows: [`<p>Thanks for visiting Pret</p>`, `<p>Order 1129-447</p><p>14 Nov 2026</p>`,
      table(o.lines.map((i) => [h(i.name) + (i.extras ? ` <span style="font-size:13px">(${h(i.extras[0])})</span>` : ""), "Take away", gbp(i.line)])), table([["<b>Total</b>", `<b>${gbp(o.total)}</b>`]])] });
    add("holdout9-pret-club-zero", "Pret", "Club Pret drinks at £0.00 with '(Club Pret)', 'Take away' column", { from: "Pret A Manger <receipts@pret.co.uk>", subject: "Your Pret receipt", date: "Sat, 14 Nov 2026 08:40:00 +0000", html }, o, "Pret A Manger", "2026-11-14");
  }
  {
    // Costa app: drink sizes and milk as options, a Costa Club free drink "Redeemed".
    const o = order([
      { name: "Flat White", qty: 1, unit: 375, extras: ["Medio", "Oat milk +45p"] },
      { name: "Cappuccino", qty: 1, unit: 0, extras: ["Primo", "Costa Club reward"] },
      { name: "Ham & Cheese Toastie", qty: 1, unit: 475 },
    ]);
    const html = page({ brand: "Costa", domain: "costa.co.uk", rows: [`<p>Your Costa order</p>`, `<p>Order number: C-310022</p><p>13/11/2026</p>`,
      table(o.lines.map((i) => [`${h(i.name)}${(i.extras || []).map((e) => `<br/><span style="font-size:13px">${h(e)}</span>`).join("")}`, { td: i.line ? gbp(i.line) : "Redeemed", attrs: 'align="right" valign="top"' }])), table([["Total", gbp(o.total)]])] });
    add("holdout9-costa-redeemed", "Costa", "options on lines under each drink, reward drink 'Redeemed'", { from: "Costa Coffee <noreply@costa.co.uk>", subject: "Thanks for your Costa order", date: "Fri, 13 Nov 2026 09:00:00 +0000", html }, o, "Costa", "2026-11-13");
  }
  {
    // Starbucks: "Grande Caramel Macchiato" with "Extra shot", qty 2 shown as "2 @ £4.15".
    const o = order([
      { name: "Grande Caramel Macchiato", qty: 2, unit: 415, extras: ["Extra shot"] },
      { name: "Blueberry Muffin", qty: 1, unit: 295 },
    ]);
    const text = ["Starbucks", "Mobile Order & Pay receipt", "Order: SB-882210", "12 November 2026 08:15", "", "Grande Caramel Macchiato", "  Extra shot", "  2 @ £4.15   £8.30", "Blueberry Muffin", "  1 @ £2.95   £2.95", "", "Total £11.25"].join("\n");
    add("holdout9-starbucks-at-lines", "Starbucks", "text: name, options, '2 @ £4.15   £8.30' line under", { from: "Starbucks <starbucks@e.starbucks.co.uk>", subject: "Your Starbucks receipt", date: "Thu, 12 Nov 2026 08:16:00 +0000", text }, o, "Starbucks", "2026-11-12");
  }

  // ---- Supermarkets ---------------------------------------------------------------------------------------------------
  {
    // Tesco: Clubcard Price shown under the item with the saving, a weighed item, age-restricted wine, carrier bags.
    const o = order([
      { name: "Tesco Loose Brown Onions", qty: 1, unit: 54 },
      { name: "Tesco Finest Chicken Breast Fillets 500G", qty: 1, unit: 500 },
      { name: "Yellow Tail Shiraz 75Cl", qty: 2, unit: 800 },
      { name: "Tesco Whole Milk 2.272L", qty: 1, unit: 165 },
      { name: "Heinz Tomato Ketchup 460G", qty: 1, unit: 300 },
    ], { fees: [["Bags", 50], ["Delivery", 400]], discounts: [["Clubcard Prices", 300]] });
    const html = page({ brand: "Tesco", domain: "tesco.com", rows: [`<p>Your order is confirmed</p>`, `<p>Order number: 7701-3399-2210</p><p>Delivery: Thursday 19 November 2026, 7pm-8pm</p>`, `<p>Ordered on 18 November 2026</p>`,
      table([["Tesco Loose Brown Onions<br/><span style=\"font-size:13px\">0.6kg (estimated)</span>", "1", gbp(54)], ["Tesco Finest Chicken Breast Fillets 500G", "1", gbp(500)],
        ["Yellow Tail Shiraz 75Cl<br/><span style=\"font-size:13px\">Clubcard Price £6.50, save £3.00. Age restricted (18+)</span>", "2", gbp(1600)], ["Tesco Whole Milk 2.272L", "1", gbp(165)], ["Heinz Tomato Ketchup 460G", "1", gbp(300)]]),
      money(o, { total: "Guide price" })] });
    add("holdout9-tesco-clubcard-under-age", "Tesco", "Clubcard Price note under item, weighed estimate, age restricted, bags, 'Guide price' total", { from: "Tesco.com <tesco@confirmations.tesco.co.uk>", subject: "Your Tesco order is confirmed", date: "Wed, 18 Nov 2026 21:00:00 +0000", html }, o, "Tesco", "2026-11-18");
  }
  {
    // Tesco text receipt: substitutes with "Substituted for", unavailable at the end, multibuy "Any 3 for £5".
    const o = order([
      { name: "Tesco Bananas Loose", qty: 6, unit: 14 },
      { name: "Muller Corner Strawberry 124G", qty: 3, unit: 75 },
      { name: "Muller Corner Blueberry 124G", qty: 3, unit: 75 },
      { name: "Hovis Best Of Both 750G", qty: 1, unit: 150, substituted: "Hovis Wholemeal 800G" },
      { name: "Tesco Basmati Rice 1Kg", qty: 1, unit: 240, unavailable: true },
    ], { fees: [["Delivery", 350]], discounts: [["Any 6 for £3.50", 100]] });
    const text = ["Tesco.com", "Your receipt", "Order number: 7701-4410-0087", "Delivered on 17 November 2026", "", "Delivered items",
      "6 Tesco Bananas Loose £0.84", "3 Muller Corner Strawberry 124G £2.25", "3 Muller Corner Blueberry 124G £2.25", "", "Substitutions", "1 Hovis Best Of Both 750G £1.50", "   Substituted for Hovis Wholemeal 800G", "",
      "Unavailable items", "1 Tesco Basmati Rice 1Kg (not charged)", "", "Savings", "Any 6 for £3.50 -£1.00", "", `Subtotal ${gbp(o.subtotal)}`, "Delivery £3.50", `Total ${gbp(o.total)}`].join("\n");
    add("holdout9-tesco-text-receipt-sections", "Tesco", "text receipt: delivered / substitutions / unavailable / savings sections", { from: "Tesco.com <tesco@confirmations.tesco.co.uk>", subject: "Your Tesco receipt", date: "Tue, 17 Nov 2026 20:00:00 +0000", text }, o, "Tesco", "2026-11-17");
  }
  {
    // Sainsbury's: Nectar Price under the item, "x2" after the name, a weighed item "per kg".
    const o = order([
      { name: "Sainsbury's British Pork Sausages x8 454g", qty: 2, unit: 300 },
      { name: "Sainsbury's Loose Courgettes", qty: 1, unit: 71 },
      { name: "Andrex Classic Clean Toilet Tissue x9", qty: 1, unit: 600 },
      { name: "Sainsbury's Free Range Eggs Large x6", qty: 1, unit: 245 },
    ], { fees: [["Delivery charge", 450], ["Carrier bag charge", 0]], discounts: [["Nectar Prices savings", 150]] });
    const html = page({ brand: "Sainsbury's", domain: "sainsburys.co.uk", rows: [`<p>Thanks for your order</p>`, `<p>Order number: 1009822331</p><p>Order date: 16 November 2026</p>`,
      table(o.lines.map((i) => [`${h(i.name)} x${i.qty}${i.name.includes("Courgettes") ? `<br/><span style="font-size:13px">0.38kg at £1.87/kg</span>` : ""}${i.name.includes("Andrex") ? `<br/><span style="font-size:13px">Nectar Price £4.50</span>` : ""}`, { td: gbp(i.line), attrs: 'align="right"' }])), money(o, { free: "£0.00" })] });
    add("holdout9-sainsburys-nectar-xn", "Sainsbury's", "'Name x2' then price, per-kg weight and Nectar Price under", { from: "Sainsbury's <groceries@sainsburys.co.uk>", subject: "Your Sainsbury's order 1009822331", date: "Mon, 16 Nov 2026 14:00:00 +0000", html }, o, "Sainsbury's", "2026-11-16");
  }
  {
    // Sainsbury's delivery update: "We substituted", "We couldn't get" items not charged, amount taken.
    const o = order([
      { name: "Sainsbury's Semi Skimmed Milk 2.27L", qty: 1, unit: 165 },
      { name: "Birds Eye Fish Fingers x10", qty: 1, unit: 300 },
      { name: "Napolina Penne 500g", qty: 2, unit: 100, substituted: "Sainsbury's Penne Pasta 1kg" },
      { name: "Sainsbury's Penne Pasta 1kg", qty: 1, unit: 110, unavailable: true },
    ], { fees: [["Delivery charge", 300]] });
    const text = ["Sainsbury's", "Your groceries have been delivered", "Order number: 1009977001", "Delivered 15 November 2026", "", "Your items",
      "Sainsbury's Semi Skimmed Milk 2.27L  1  £1.65", "Birds Eye Fish Fingers x10  1  £3.00", "", "We substituted", "Napolina Penne 500g  2  £2.00 (instead of Sainsbury's Penne Pasta 1kg)", "",
      "We couldn't get", "Sainsbury's Penne Pasta 1kg  1  (you haven't been charged)", "", "Subtotal £6.65", "Delivery charge £3.00", "Total charged £9.65"].join("\n");
    add("holdout9-sainsburys-text-substituted", "Sainsbury's", "text: 'We substituted' (instead of ...), 'We couldn't get'", { from: "Sainsbury's <groceries@sainsburys.co.uk>", subject: "Your Sainsbury's delivery receipt", date: "Sun, 15 Nov 2026 18:00:00 +0000", text }, o, "Sainsbury's", "2026-11-15");
  }
  {
    // Asda: price then "Rollback" note, multibuy "2 for £3" saving inline, an age-restricted lager.
    const o = order([
      { name: "ASDA Extra Special Steak Pie", qty: 2, unit: 175 },
      { name: "Carling Lager 18 x 440ml", qty: 1, unit: 1500 },
      { name: "ASDA Bananas Loose", qty: 1, unit: 89 },
      { name: "Fairy Original Washing Up Liquid 780ml", qty: 1, unit: 250 },
    ], { fees: [["Delivery", 300]], discounts: [["2 for £3 saving", 50]] });
    const html = page({ brand: "Asda", domain: "asda.com", rows: [`<p>Order confirmation</p>`, `<p>Order number: 300991200045</p><p>Order date: 14/11/2026</p>`,
      table([["Product", "Qty", "Price"], ...o.lines.map((i) => [h(i.name) + (i.name.includes("Carling") ? `<br/><span style="font-size:13px">Age restricted product</span>` : i.name.includes("Fairy") ? `<br/><span style="font-size:13px">Rollback</span>` : ""), String(i.qty), gbp(i.line)])]), money(o)] });
    add("holdout9-asda-product-qty-price", "Asda", "Product | Qty | Price header, 'Rollback' and age notes", { from: "ASDA <noreply@asda.com>", subject: "Thanks for your Asda order", date: "Sat, 14 Nov 2026 10:00:00 +0000", html }, o, "Asda", "2026-11-14");
  }
  {
    // Morrisons: My Morrisons price, items grouped under aisle names, qty written "Qty 2", bag charge.
    const o = order([
      { name: "Morrisons Wonky Carrots 1kg", qty: 1, unit: 59 },
      { name: "Morrisons British Beef Mince 500g", qty: 2, unit: 350 },
      { name: "Yorkshire Tea 80 Bags", qty: 1, unit: 300 },
    ], { fees: [["Delivery", 200], ["Bag charge", 40]], discounts: [["My Morrisons savings", 100]] });
    const html = page({ brand: "Morrisons", domain: "morrisons.com", rows: [`<p>Your order</p>`, `<p>Order number: 88120044</p><p>13 November 2026</p>`,
      `<h3>Fruit &amp; Veg</h3>`, table([["Morrisons Wonky Carrots 1kg", "Qty 1", gbp(59)]]), `<h3>Meat</h3>`, table([["Morrisons British Beef Mince 500g", "Qty 2", gbp(700)]]), `<h3>Drinks</h3>`, table([["Yorkshire Tea 80 Bags<br/><span style=\"font-size:13px\">My Morrisons Price £3.00 (was £4.00)</span>", "Qty 1", gbp(300)]]), money(o)] });
    add("holdout9-morrisons-aisles-qty", "Morrisons", "aisle headings, 'Qty 2' cell, 'My Morrisons Price ... (was ...)' under", { from: "Morrisons <noreply@morrisons.com>", subject: "Your Morrisons order 88120044", date: "Fri, 13 Nov 2026 12:00:00 +0000", html }, o, "Morrisons", "2026-11-13");
  }
  {
    // Ocado: unit price × qty, "Offer: 3 for 2" applied, a reduced-to-clear item, an Ocado Smart Pass free delivery.
    const o = order([
      { name: "Ocado Organic Whole Milk 2L", qty: 2, unit: 180 },
      { name: "Graze Protein Oat Bites 4 pack", qty: 3, unit: 300 },
      { name: "Ocado Salmon Fillets 240g", qty: 1, unit: 450 },
    ], { fees: [["Delivery (Smart Pass)", 0]], discounts: [["Offer: 3 for 2", 300]] });
    const text = ["ocado", "Your order is confirmed", "Order: 99881230", "Placed 12 November 2026", "", ...o.lines.map((i) => `${i.name}\n${i.qty} x ${gbp(i.unit)} = ${gbp(i.line)}`), "", "Offer: 3 for 2 -£3.00", "", `Items ${gbp(o.subtotal)}`, "Delivery (Smart Pass) Free", `Total ${gbp(o.total)}`].join("\n");
    add("holdout9-ocado-unit-equals", "Ocado", "text: name, then '2 x £1.80 = £3.60', 'Items' as subtotal", { from: "Ocado <customerservices@ocado.com>", subject: "Your Ocado order is confirmed", date: "Thu, 12 Nov 2026 22:00:00 +0000", text }, o, "Ocado", "2026-11-12");
  }
  {
    // Waitrose: myWaitrose discount per item in its own column, wine age-restricted, "Picked weight".
    const o = order([
      { name: "Waitrose Duchy Organic Carrots", qty: 1, unit: 120 },
      { name: "Waitrose Loose Vine Tomatoes", qty: 1, unit: 157 },
      { name: "Waitrose Blueprint Sauvignon Blanc 75cl", qty: 1, unit: 899 },
    ], { fees: [["Delivery", 0]], discounts: [["myWaitrose offers", 150]] });
    const html = page({ brand: "Waitrose", domain: "waitrose.com", rows: [`<p>Thank you for shopping with Waitrose</p>`, `<p>Order number: 1022345671</p><p>Order date: 11 November 2026</p>`,
      table([["Item", "Qty", "Price"], ["Waitrose Duchy Organic Carrots", "1", gbp(120)], ["Waitrose Loose Vine Tomatoes<br/><span style=\"font-size:13px\">Picked weight 0.523kg</span>", "1", gbp(157)], ["Waitrose Blueprint Sauvignon Blanc 75cl<br/><span style=\"font-size:13px\">Over 18s only</span>", "1", gbp(899)]]),
      money(o)] });
    add("holdout9-waitrose-picked-weight", "Waitrose", "'Picked weight 0.523kg' and 'Over 18s only' notes", { from: "Waitrose & Partners <customerservice@waitrose.co.uk>", subject: "Your Waitrose order", date: "Wed, 11 Nov 2026 09:00:00 +0000", html }, o, "Waitrose", "2026-11-11");
  }
  {
    // Iceland: "£1 Bonus Card" price, "3 for £10" multibuy, each multibuy item priced at full and the saving at the end.
    const o = order([
      { name: "Iceland 20 Battered Chicken Breast Nuggets 400g", qty: 1, unit: 400 },
      { name: "Iceland Luxury Lasagne 1kg", qty: 1, unit: 400 },
      { name: "Iceland Luxury Fish Pie 1kg", qty: 1, unit: 400 },
      { name: "Warburtons Crumpets 6 pack", qty: 2, unit: 110 },
    ], { fees: [["Delivery", 0], ["Carrier bags", 60]], discounts: [["3 for £10 multibuy", 200]] });
    const text = ["Iceland", "Order Confirmation", "Order No: 400012233", "Date: 10 November 2026", "", "QTY ITEM PRICE", ...o.lines.map((i) => `${i.qty} ${i.name} ${gbp(i.line)}`), "", "Multibuy savings", "3 for £10 multibuy -£2.00", "", `Subtotal ${gbp(o.subtotal)}`, "Delivery FREE", "Carrier bags £0.60", `Order Total ${gbp(o.total)}`].join("\n");
    add("holdout9-iceland-qty-item-price-text", "Iceland", "text: 'QTY ITEM PRICE' header, multibuy savings section", { from: "Iceland <groceries@iceland.co.uk>", subject: "Your Iceland Order Confirmation", date: "Tue, 10 Nov 2026 19:00:00 +0000", text }, o, "Iceland", "2026-11-10");
  }
  {
    // Asda delivery receipt with weighed items whose qty is a weight: "0.45kg" in the qty column.
    const o = order([
      { name: "ASDA Loose Red Apples", qty: 1, unit: 95 },
      { name: "ASDA Chicken Thighs", qty: 1, unit: 340 },
      { name: "ASDA Garlic Bread 2 Pack", qty: 2, unit: 90 },
    ], { fees: [["Delivery", 100]] });
    const html = page({ brand: "Asda", domain: "asda.com", rows: [`<p>Your receipt</p>`, `<p>Order number: 300991300017</p><p>Delivered 9 November 2026</p>`,
      table([["Qty", "Item", "Price"], ["0.45kg", "ASDA Loose Red Apples", gbp(95)], ["1", "ASDA Chicken Thighs", gbp(340)], ["2", "ASDA Garlic Bread 2 Pack", gbp(180)]]), money(o)] });
    add("holdout9-asda-weight-in-qty", "Asda", "weighed item's qty cell is a weight '0.45kg'", { from: "ASDA <noreply@asda.com>", subject: "Your Asda receipt", date: "Mon, 9 Nov 2026 19:00:00 +0000", html }, o, "Asda", "2026-11-09");
  }

  // ---- Amazon UK ------------------------------------------------------------------------------------------------------
  {
    // Several sellers, "Sold by" under each item, gift wrap fee, promotional credit.
    const o = order([
      { name: "Anker USB C Charger 30W", qty: 1, unit: 1999 },
      { name: "Bamboo Chopping Board Set of 3", qty: 1, unit: 2299 },
      { name: "The Thursday Murder Club (Paperback)", qty: 1, unit: 549 },
    ], { fees: [["Postage & Packing", 0], ["Gift wrap", 399]], discounts: [["Promotion applied", 500]] });
    const html = page({ brand: "Amazon.co.uk", domain: "amazon.co.uk", rows: [`<p>Hello ${SHOPPER.first},</p><p>Thank you for your order.</p>`, `<p>Order #205-1234567-7654321</p><p>Placed on 18 November 2026</p>`,
      table(o.lines.map((i, k) => [`<a href="https://www.amazon.co.uk/dp/B0${k}">${h(i.name)}</a><br/><span style="font-size:13px">Sold by: ${["AnkerDirect", "Kitchen Bits UK", "Amazon EU S.a.r.L."][k]}</span><br/><span style="font-size:13px">Quantity: 1</span>`, { td: gbp(i.line), attrs: 'align="right"' }])),
      table(R([["Item(s) Subtotal:", gbp(o.subtotal)], ["Postage &amp; Packing:", "£0.00"], ["Gift wrap:", gbp(399)], ["Promotion applied:", "-£5.00"], ["<b>Order Total:</b>", `<b>${gbp(o.total)}</b>`]]))] });
    add("holdout9-amazon-sellers-giftwrap", "Amazon", "'Sold by' and 'Quantity: 1' under each item, gift wrap, promotion", { from: "Amazon.co.uk <auto-confirm@amazon.co.uk>", subject: "Your Amazon.co.uk order #205-1234567-7654321", date: "Wed, 18 Nov 2026 10:00:00 +0000", html }, o, "Amazon", "2026-11-18");
  }
  {
    // Subscribe & Save delivery: "5% off" per item, qty 2, plain text.
    const o = order([
      { name: "Finish Ultimate All in One Dishwasher Tablets, 80 Tablets", qty: 1, unit: 1999 },
      { name: "Andrex Gentle Clean Toilet Roll, 24 Rolls", qty: 2, unit: 1550 },
    ], { discounts: [["Subscribe & Save discount", 255]] });
    const text = ["Amazon.co.uk", "Your Subscribe & Save delivery", "Order #203-9988776-1122334", "Order date: 17 November 2026", "", ...o.lines.map((i) => `${i.name}\nQuantity: ${i.qty}\n${gbp(i.line)}`), "", `Item(s) Subtotal: ${gbp(o.subtotal)}`, "Subscribe & Save discount: -£2.55", `Grand Total: ${gbp(o.total)}`].join("\n");
    add("holdout9-amazon-sns-text", "Amazon", "text: name, 'Quantity: 2', price on three lines; S&S discount; 'Grand Total'", { from: "\"Amazon Subscribe & Save\" <no-reply@amazon.co.uk>", subject: "Your Subscribe & Save order has been placed", date: "Tue, 17 Nov 2026 06:00:00 +0000", text }, o, "Amazon", "2026-11-17");
  }
  {
    // A long product title with commas and a pipe, "Arriving tomorrow", gift card balance applied.
    const o = order([
      { name: "SanDisk 128GB Ultra microSDXC card + SD adapter, up to 140 MB/s | A1 | Class 10", qty: 1, unit: 1299 },
      { name: "Duracell Plus AA Batteries, Pack of 12", qty: 2, unit: 899 },
    ], { fees: [["Delivery", 0]], discounts: [["Gift Card balance", 1000]] });
    const html = page({ brand: "Amazon.co.uk", domain: "amazon.co.uk", rows: [`<p>Ordered</p><p>Arriving tomorrow</p>`, `<p>Order # 202-5566778-9900112</p><p>16 November 2026</p>`,
      table(o.lines.map((i) => [`<img src="https://m.media-amazon.com/images/I/x.jpg" alt="" width="80"/>`, `${h(i.name)}<br/>Qty: ${i.qty}`, { td: gbp(i.line), attrs: 'align="right"' }])),
      table(R([["Subtotal", gbp(o.subtotal)], ["Delivery", "FREE"], ["Gift Card balance", "-£10.00"], ["<b>Total</b>", `<b>${gbp(o.total)}</b>`]]))] });
    add("holdout9-amazon-long-title-giftcard", "Amazon", "picture | title + 'Qty: 2' | price, gift card balance", { from: "Amazon.co.uk <auto-confirm@amazon.co.uk>", subject: "Ordered: \"SanDisk 128GB Ultra...\" and 1 more item", date: "Mon, 16 Nov 2026 15:00:00 +0000", html }, o, "Amazon", "2026-11-16");
  }
  {
    // Two parcels in one confirmation, each with its own "Dispatches from / Sold by", a Prime free delivery line.
    const o = order([
      { name: "Echo Dot (5th generation) Charcoal", qty: 1, unit: 2999 },
      { name: "Organic Coconut Oil 1L", qty: 1, unit: 1095 },
      { name: "Phone Stand Adjustable Aluminium", qty: 1, unit: 899 },
    ], { fees: [["Postage & Packing", 0]] });
    const blk = (title, items, seller) => `<h3>${title}</h3>` + table(items.map((i) => [`${h(i.name)}<br/><span style="font-size:13px">Dispatches from and sold by ${seller}</span>`, { td: gbp(i.line), attrs: 'align="right"' }]));
    const html = page({ brand: "Amazon.co.uk", domain: "amazon.co.uk", rows: [`<p>Thanks for your order, ${SHOPPER.first}</p>`, `<p>Order #204-1112223-3344556</p><p>Order placed 15 November 2026</p>`,
      blk("Delivery 1 of 2", [o.lines[0]], "Amazon"), blk("Delivery 2 of 2", o.lines.slice(1), "NaturePantry Ltd"),
      table(R([["Item(s) Subtotal:", gbp(o.subtotal)], ["Postage &amp; Packing:", "£0.00"], ["<b>Order Total:</b>", `<b>${gbp(o.total)}</b>`]]))] });
    add("holdout9-amazon-two-deliveries", "Amazon", "'Delivery 1 of 2' blocks, 'Dispatches from and sold by'", { from: "Amazon.co.uk <auto-confirm@amazon.co.uk>", subject: "Your Amazon.co.uk order #204-1112223-3344556", date: "Sun, 15 Nov 2026 12:00:00 +0000", html }, o, "Amazon", "2026-11-15");
  }
  {
    // Text with "Price: £x" lines and condition "Used - Very Good" from a marketplace seller.
    const o = order([
      { name: "Nintendo Switch Joy-Con Pair (Neon Red/Blue)", qty: 1, unit: 4999 },
      { name: "Mario Kart 8 Deluxe (Nintendo Switch)", qty: 1, unit: 3450 },
    ], { fees: [["Postage & Packing", 299]] });
    const text = ["Amazon.co.uk", "Order Confirmation", "Order #206-7788990-0011223", "Placed on 14 November 2026", "", "Nintendo Switch Joy-Con Pair (Neon Red/Blue)", "Sold by: GameZone UK", "Condition: New", "Price: £49.99", "",
      "Mario Kart 8 Deluxe (Nintendo Switch)", "Sold by: RetroPlay", "Condition: Used - Very Good", "Price: £34.50", "", `Item(s) Subtotal: ${gbp(o.subtotal)}`, "Postage & Packing: £2.99", `Order Total: ${gbp(o.total)}`].join("\n");
    add("holdout9-amazon-text-price-label", "Amazon", "text: name, Sold by, Condition, 'Price: £'", { from: "Amazon.co.uk <auto-confirm@amazon.co.uk>", subject: "Your Amazon.co.uk order of \"Nintendo Switch Joy-Con...\"", date: "Sat, 14 Nov 2026 09:00:00 +0000", text }, o, "Amazon", "2026-11-14");
  }

  // ---- Fashion --------------------------------------------------------------------------------------------------------
  {
    // ASOS: the same jeans in two sizes as two lines, "Size: W30 L32", ASOS Premier free delivery.
    const o = order([
      { name: "ASOS DESIGN slim jeans in mid blue", qty: 1, unit: 2800, extras: ["W30 L32"] },
      { name: "ASOS DESIGN slim jeans in mid blue", qty: 1, unit: 2800, extras: ["W32 L32"] },
      { name: "ASOS DESIGN crew neck jumper in navy", qty: 1, unit: 2200, extras: ["M"] },
    ], { fees: [["Premier Delivery", 0]] });
    const html = page({ brand: "ASOS", domain: "asos.com", rows: [`<p>Thanks for your order</p>`, `<p>Order No.: 998877123</p><p>Order date: 18 Nov 2026</p>`,
      table(o.lines.map((i) => [`<img src="https://images.asos-media.com/x.jpg" alt="" width="90"/>`, `${gbp(i.unit)}<br/>${h(i.name)}<br/><span style="font-size:13px">Blue / Size: ${h(i.extras[0])} / Qty: 1</span>`])),
      money(o)] });
    add("holdout9-asos-two-sizes-price-first", "ASOS", "price above name, 'Colour / Size: x / Qty: 1', same jeans in two sizes", { from: "ASOS <order_confirmation@asos.com>", subject: "Thanks for your order!", date: "Wed, 18 Nov 2026 11:00:00 +0000", html }, o, "ASOS", "2026-11-18");
  }
  {
    // Zara: uppercase names, "SIZE M" and colour on lines under, qty "1 unit".
    const o = order([
      { name: "WOOL BLEND COAT", qty: 1, unit: 8999, extras: ["SIZE M"] },
      { name: "RIBBED KNIT TOP", qty: 1, unit: 1799, extras: ["SIZE S"] },
      { name: "RIBBED KNIT TOP", qty: 1, unit: 1799, extras: ["SIZE M"] },
    ], { fees: [["SHIPPING", 395]] });
    const text = ["ZARA", "THANK YOU FOR YOUR PURCHASE", "ORDER NO. 52012345678", "17/11/2026", "", ...o.lines.map((i) => `${i.name}\nBLACK | ${i.extras[0]}\n1 unit\n${gbp(i.line).replace("£", "")} GBP`), "", `SUBTOTAL ${gbp(o.subtotal).replace("£", "")} GBP`, "SHIPPING 3.95 GBP", `TOTAL ${gbp(o.total).replace("£", "")} GBP`].join("\n");
    add("holdout9-zara-gbp-suffix-sizes", "Zara", "text: 'BLACK | SIZE M', '1 unit', '89.99 GBP'", { from: "ZARA <noreply@zara.com>", subject: "Thank you for your purchase", date: "Tue, 17 Nov 2026 16:00:00 +0000", text }, o, "Zara", "2026-11-17");
  }
  {
    // H&M: "Art. no.", size and colour rows, member discount, the same trousers in two sizes with qty 1 each.
    const o = order([
      { name: "Relaxed Fit Trousers", qty: 1, unit: 2499, extras: ["32"] },
      { name: "Relaxed Fit Trousers", qty: 1, unit: 2499, extras: ["34"] },
      { name: "Cotton T-shirt 3-pack", qty: 1, unit: 1599, extras: ["L"] },
    ], { fees: [["Delivery", 399]], discounts: [["Member discount 10%", 660]] });
    const html = page({ brand: "H&M", domain: "hm.com", rows: [`<p>Thank you for your order</p>`, `<p>Order number: 61002233445</p><p>Order date: 16 November 2026</p>`,
      ...o.lines.map((i, k) => table([[`<b>${h(i.name)}</b>`, { td: gbp(i.line), attrs: 'align="right"' }], [`Art. no. 10${k}8812001`, ""], [`Size: ${i.extras[0]}`, ""], ["Colour: Beige", ""], ["Quantity: 1", ""]])), money(o)] });
    add("holdout9-hm-artno-size-rows", "H&M", "table per item: name+price, Art. no., Size, Colour, Quantity rows", { from: "H&M <info@email.hm.com>", subject: "Thank you for your order", date: "Mon, 16 Nov 2026 20:00:00 +0000", html }, o, "H&M", "2026-11-16");
  }
  {
    // Next: item numbers "Item 123-456", "Size 10R", next-day delivery, two sizes.
    const o = order([
      { name: "Black Skinny Jeans", qty: 1, unit: 3000, extras: ["10R"] },
      { name: "Black Skinny Jeans", qty: 1, unit: 3000, extras: ["12R"] },
      { name: "Cream Cable Knit Jumper", qty: 1, unit: 3800, extras: ["M"] },
    ], { fees: [["Delivery charge", 450]] });
    const text = ["NEXT", "Order Confirmation", "Order number: X12345678", "Order date: 15 November 2026", "", "Item | Description | Size | Qty | Price", ...o.lines.map((i, k) => `${["A12-345", "A12-345", "B99-001"][k]} | ${i.name} | ${i.extras[0]} | 1 | ${gbp(i.line)}`), "", `Goods total ${gbp(o.subtotal)}`, "Delivery charge £4.50", `Total ${gbp(o.total)}`].join("\n");
    add("holdout9-next-item-code-cols-text", "Next", "text: Item | Description | Size | Qty | Price with item codes, 'Goods total'", { from: "Next <orders@next.co.uk>", subject: "Your Next order X12345678", date: "Sun, 15 Nov 2026 21:00:00 +0000", text }, o, "Next", "2026-11-15");
  }
  {
    // JD: "Size: 9" under the trainer, two pairs of the same trainer in sizes 7 and 9, JD STATUS discount.
    const o = order([
      { name: "Nike Air Force 1 '07 White", qty: 1, unit: 10999, extras: ["Size: 7"] },
      { name: "Nike Air Force 1 '07 White", qty: 1, unit: 10999, extras: ["Size: 9"] },
      { name: "The North Face Logo Beanie", qty: 1, unit: 2500 },
    ], { fees: [["Standard Delivery", 399]], discounts: [["JD STATUS 10%", 2450]] });
    const html = page({ brand: "JD Sports", domain: "jdsports.co.uk", rows: [`<p>Order confirmed</p>`, `<p>Order number: JD-9933221</p><p>14/11/2026</p>`,
      table(o.lines.map((i) => [`${h(i.name)}${i.extras ? `<br/><span style="font-size:13px">${h(i.extras[0])}</span>` : ""}<br/><span style="font-size:13px">Qty: 1</span>`, { td: gbp(i.line), attrs: 'align="right"' }])), money(o)] });
    add("holdout9-jd-two-sizes", "JD Sports", "two pairs of one trainer in sizes 7 and 9, 'Qty: 1' under", { from: "JD Sports <orders@jdsports.co.uk>", subject: "Your JD order JD-9933221", date: "Sat, 14 Nov 2026 15:00:00 +0000", html }, o, "JD Sports", "2026-11-14");
  }
  {
    // Nike: "Style CW2288-111", "Size UK 8", qty 2 of one size, Nike member free delivery, promo code.
    const o = order([
      { name: "Nike Dri-FIT Running Top", qty: 2, unit: 3000, extras: ["UK M"] },
      { name: "Nike Pegasus 41", qty: 1, unit: 12999, extras: ["UK 8"] },
    ], { fees: [["Delivery", 0]], discounts: [["Promo code NIKE15", 2850]] });
    const html = page({ brand: "Nike", domain: "nike.com", rows: [`<p>Thanks for your order</p>`, `<p>Order number: C01234567890</p><p>Order date: 13 Nov 2026</p>`,
      table(o.lines.map((i) => [`<b>${h(i.name)}</b><br/>Style: CW2288-111<br/>Size ${h(i.extras[0])}<br/>Qty ${i.qty} @ ${gbp(i.unit)}`, { td: gbp(i.line), attrs: 'align="right"' }])), money(o)] });
    add("holdout9-nike-qty-at-unit", "Nike", "'Qty 2 @ £30.00' under name with Style and Size", { from: "Nike <nike@official.nike.com>", subject: "Thanks for your order", date: "Fri, 13 Nov 2026 12:00:00 +0000", html }, o, "Nike", "2026-11-13");
  }
  {
    // SHEIN: many small items, "SKU", sizes, the same dress in two sizes, coupon and points used.
    const o = order([
      { name: "SHEIN Essnce Solid Rib-knit Bodycon Dress", qty: 1, unit: 1099, extras: ["S"] },
      { name: "SHEIN Essnce Solid Rib-knit Bodycon Dress", qty: 1, unit: 1099, extras: ["M"] },
      { name: "SHEIN Hair Claw Clip 4pcs", qty: 1, unit: 349 },
    ], { fees: [["Shipping", 0]], discounts: [["Coupon", 300], ["Points", 50]] });
    const html = page({ brand: "SHEIN", domain: "shein.com", rows: [`<p>Your order has been placed</p>`, `<p>Order Number: GSUK12345ABC</p><p>Order Date: 12/11/2026</p>`,
      table(o.lines.map((i) => [h(i.name) + `<br/><span style="font-size:13px">SKU: sz2310${i.unit}</span>` + (i.extras ? `<br/><span style="font-size:13px">Size: ${h(i.extras[0])}</span>` : ""), "x1", gbp(i.line)])),
      table(R([["Retail Price", gbp(o.subtotal)], ["Shipping", "Free"], ["Coupon", "-£3.00"], ["Points", "-£0.50"], ["<b>Order Total</b>", `<b>${gbp(o.total)}</b>`]]))] });
    add("holdout9-shein-retail-price-x1", "SHEIN", "'Retail Price' as subtotal, SKU and size under name, 'x1' cell", { from: "SHEIN <noreply@shein.com>", subject: "Your SHEIN order has been placed", date: "Thu, 12 Nov 2026 22:00:00 +0000", html }, o, "SHEIN", "2026-11-12");
  }
  {
    // ASOS text-only, "Qty 2" for one size, a "Was £30.00" sale price in the line.
    const o = order([
      { name: "Nike Club fleece hoodie in grey", qty: 2, unit: 4500, extras: ["L"] },
      { name: "adidas Originals Trefoil t-shirt in white", qty: 1, unit: 2000, extras: ["M"] },
    ], { fees: [["Standard Delivery", 450]] });
    const text = ["ASOS", "Order No.: 998800011", "Order date: 11 Nov 2026", "", "Nike Club fleece hoodie in grey", "Grey / L / Qty 2", "£90.00", "", "adidas Originals Trefoil t-shirt in white", "White / M / Qty 1", "Was £30.00 Now £20.00", "", `Subtotal ${gbp(o.subtotal)}`, "Standard Delivery £4.50", `Total ${gbp(o.total)}`].join("\n");
    add("holdout9-asos-text-slash-was-now", "ASOS", "text: 'Colour / Size / Qty 2' line, 'Was £30.00 Now £20.00'", { from: "ASOS <order_confirmation@asos.com>", subject: "Thanks for your order!", date: "Wed, 11 Nov 2026 13:00:00 +0000", text }, o, "ASOS", "2026-11-11");
  }
  {
    // Next HTML: picture, name, then "Size: 8 | Qty: 2 | £24.00"; Next Unlimited delivery included.
    const o = order([
      { name: "Floral Print Midi Dress", qty: 2, unit: 1200, extras: ["8"] },
      { name: "Leather Ankle Boots Tan", qty: 1, unit: 6500, extras: ["5"] },
    ], { fees: [["Delivery (Next Unlimited)", 0]] });
    const html = page({ brand: "Next", domain: "next.co.uk", rows: [`<p>Thank you for your order</p>`, `<p>Order number: Y99887766</p><p>Order date: 10 November 2026</p>`,
      table(o.lines.map((i) => [`<img src="https://xcdn.next.co.uk/x.jpg" alt="${h(i.name)}" width="80"/>`, `${h(i.name)}<br/>Size: ${h(i.extras[0])} | Qty: ${i.qty} | ${gbp(i.line)}`])), money(o)] });
    add("holdout9-next-pipe-size-qty-price", "Next", "picture | name over 'Size: 8 | Qty: 2 | £24.00'", { from: "Next <orders@next.co.uk>", subject: "Your Next order Y99887766", date: "Tue, 10 Nov 2026 20:00:00 +0000", html }, o, "Next", "2026-11-10");
  }
  return out;
}
