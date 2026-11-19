// Takeaway and fast-food order emails (made-up orders; see lib.mjs).
import { order, expected, page, table, moneyRows, moneyText, fixture, gbp, h, SHOPPER } from "./lib.mjs";

const nameCell = (i, style = "+ ") => h(i.name) + (i.extras || []).map((e) => `<br /><span class="muted" style="font-size:13px">${h(style + e)}</span>`).join("");

export default function food() {
  const out = [];

  // ---- Just Eat ------------------------------------------------------------------------------------------------------
  {
    // 1. The layout behind the bug Connor saw: qty "1 x" in its own cell, the item's extras under its name (<br>), price on the right.
    // The plain-text part puts each extra on its own line under the item.
    const o = order([
      { name: "Sweet and Sour Chicken Hong Kong Style", qty: 1, unit: 699 },
      { name: "Salt and Pepper Chips", qty: 1, unit: 420, extras: ["Large"] },
      { name: "Vegetable Spring Rolls (4)", qty: 2, unit: 350 },
      { name: "Chicken Chow Mein", qty: 1, unit: 750, extras: ["Egg Fried Rice", "Extra chilli"] },
      { name: "Prawn Crackers", qty: 1, unit: 180 },
    ], { fees: [["Delivery fee", 249], ["Service charge", 99], ["Bag fee", 10]] });
    const rows = [
      `<h1 style="font-size:24px">Thanks for your order, ${SHOPPER.first}!</h1>`,
      `<p><strong>Golden Dragon</strong> has received your order and will start preparing it soon.</p>`,
      `<p>Order number: <strong>1849203376</strong><br />Placed on Wed 18 Nov 2026, 19:41</p>`,
      `<h2 style="font-size:18px">Your order</h2>`,
      table(o.lines.map((i) => [{ td: `${i.qty} x`, attrs: 'width="40" valign="top"' }, { td: nameCell(i), attrs: 'valign="top"' }, { td: gbp(i.line), attrs: 'align="right" valign="top"' }])),
      `<hr />`, table(moneyRows(o).map(([a, b]) => [a, { td: b, attrs: 'align="right"' }])),
      `<p>Paid with Visa ending 1234</p>`,
      `<p>Delivering to: ${h(SHOPPER.address)}</p>`,
    ];
    const text = [`Thanks for your order, ${SHOPPER.first}!`, "", "Golden Dragon has received your order and will start preparing it soon.", "", "Order number: 1849203376", "Placed on Wed 18 Nov 2026, 19:41", "", "Your order", "",
      ...o.lines.flatMap((i) => [`${i.qty} x ${i.name}  ${gbp(i.line)}`, ...(i.extras || []).map((e) => `+ ${e}`)]), "", moneyText(o, {}, "  "), "", "Paid with Visa ending 1234", "", "Delivering to: " + SHOPPER.address, "", "Just Eat"].join("\n");
    out.push(fixture("just-eat-1", "Just Eat", "qty cell, extras under the name, text part with + lines",
      { from: "Just Eat <noreply@t.just-eat.co.uk>", subject: "Thanks for your order, Sam", date: "Wed, 18 Nov 2026 19:42:10 +0000",
        html: page({ brand: "Just Eat", domain: "just-eat.co.uk", rows }), text }, expected("Just Eat", "2026-11-18", o)));
  }
  {
    // 2. Quantity as a bare number, each extra as its own table row with no price, a voucher and a rider tip.
    const o = order([
      { name: "Chicken Tikka Masala", qty: 1, unit: 895, extras: ["Pilau Rice"] },
      { name: "Lamb Rogan Josh", qty: 1, unit: 995, extras: ["Medium", "Plain Naan"] },
      { name: "Onion Bhaji", qty: 2, unit: 375 },
      { name: "Mango Lassi", qty: 1, unit: 350 },
      { name: "Poppadoms with Chutney", qty: 1, unit: 250 },
    ], { fees: [["Delivery fee", 199], ["Service charge", 99]], discounts: [["Voucher (JE5OFF)", 500]], tips: [["Rider tip", 150]] });
    const itemRows = o.lines.flatMap((i) => [[{ td: String(i.qty), attrs: 'width="24"' }, `<strong>${h(i.name)}</strong>`, { td: gbp(i.line), attrs: 'align="right"' }],
      ...(i.extras || []).map((e) => ["", `<span class="muted">${h(e)}</span>`, ""])]);
    const rows = [`<h1>Order confirmed</h1>`, `<p>Hi ${SHOPPER.first}, Spice of Bengal is preparing your order.</p>`, `<p>Order no. 1850117742</p>`, `<p>18 November 2026</p>`,
      table(itemRows), table(moneyRows(o, { total: "Total paid" }).map(([a, b]) => [a, { td: b, attrs: 'align="right"' }]))];
    out.push(fixture("just-eat-2", "Just Eat", "bare qty cell, extras as their own rows, voucher and rider tip (html only)",
      { from: "Just Eat <noreply@t.just-eat.co.uk>", subject: "Your order is confirmed", date: "Wed, 18 Nov 2026 18:05:44 +0000",
        html: page({ brand: "Just Eat", domain: "just-eat.co.uk", rows }) }, expected("Just Eat", "2026-11-18", o)));
  }
  {
    // 3. Plain text only, "2x" with no space, the price after dots, extras indented with "+".
    const o = order([
      { name: "Large Margherita", qty: 1, unit: 1199, extras: ["Stuffed crust"] },
      { name: "Garlic Bread with Cheese", qty: 2, unit: 450 },
      { name: "Chicken Wings (8)", qty: 1, unit: 699, extras: ["BBQ sauce"] },
      { name: "Coca-Cola 1.25L", qty: 1, unit: 299 },
    ], { fees: [["Delivery fee", 0], ["Service charge", 99], ["Small order fee", 0]] });
    const text = [`Hi ${SHOPPER.first},`, "", "Thanks for ordering from Napoli Express on Just Eat.", "Order number: 1851009933", "Order placed: 17/11/2026 20:12", "", "YOUR ORDER", "------------------------------",
      ...o.lines.flatMap((i) => [`${i.qty}x ${i.name} ........ ${gbp(i.line)}`, ...(i.extras || []).map((e) => `   + ${e}`)]), "------------------------------", moneyText(o, { free: "Free" }, ": "), "", "Payment: Apple Pay", "", "Enjoy your meal!", "The Just Eat team"].join("\n");
    out.push(fixture("just-eat-3", "Just Eat", "plain text only, 2x prices after dots, indented + extras",
      { from: "Just Eat <noreply@t.just-eat.co.uk>", subject: "Thanks for your order with Napoli Express", date: "Tue, 17 Nov 2026 20:13:02 +0000", text }, expected("Just Eat", "2026-11-17", o)));
  }
  {
    // 4. Item and extras in one cell, the extras priced in brackets and already in the item's price.
    const o = order([
      { name: "Sweet and Sour Chicken Balls", qty: 1, unit: 699, extras: ["Sweet and sour sauce"] },
      { name: "Special Fried Rice", qty: 1, unit: 520 },
      { name: "Crispy Chilli Beef", qty: 1, unit: 780, extras: ["Extra spicy (+£0.50)"] },
      { name: "Salt and Pepper Ribs", qty: 1, unit: 650 },
      { name: "Egg Fried Rice", qty: 2, unit: 350 },
      { name: "Prawn Toast", qty: 1, unit: 420 },
    ], { fees: [["Delivery fee", 299], ["Service fee", 79], ["Bag charge", 10]], tips: [["Driver tip", 100]] });
    const rows = [`<p>Thanks, ${SHOPPER.first}. Your order from Lucky Star has been placed.</p>`, `<p>Order #1852334410 &middot; 16 Nov 2026</p>`,
      table(o.lines.map((i) => [`<span style="font-weight:bold">${i.qty}x</span>&nbsp;${h(i.name)}${(i.extras || []).map((e) => `<div style="color:#666;font-size:13px">${h(e)}</div>`).join("")}`, { td: gbp(i.line), attrs: 'align="right" valign="top"' }])),
      table(moneyRows(o).map(([a, b]) => [a, { td: b, attrs: 'align="right"' }]))];
    out.push(fixture("just-eat-4", "Just Eat", "qty and name in one cell, extras in divs (some priced), driver tip",
      { from: "\"Just Eat\" <orders@just-eat.co.uk>", subject: "Your Just Eat order", date: "Mon, 16 Nov 2026 19:01:17 +0000",
        html: page({ brand: "Just Eat", domain: "just-eat.co.uk", rows }) }, expected("Just Eat", "2026-11-16", o)));
  }

  // ---- Deliveroo -----------------------------------------------------------------------------------------------------
  {
    const o = order([
      { name: "Katsu Chicken Curry", qty: 1, unit: 1150, extras: ["Add extra sauce"] },
      { name: "Yasai Gyoza", qty: 2, unit: 595 },
      { name: "Chicken Ramen", qty: 1, unit: 1395, extras: ["No egg"] },
      { name: "Edamame", qty: 1, unit: 495, extras: ["Chilli salt"] },
    ], { fees: [["Delivery fee", 299], ["Service fee", 149]], tips: [["Rider tip", 100]] });
    const rows = [`<h1>Your order's in!</h1>`, `<p>Wagamama Leeds is getting it ready.</p>`, `<p>Order number #1047</p>`, `<p>15 November 2026</p>`,
      table(o.lines.map((i) => [`${i.qty}x`, nameCell(i, ""), { td: gbp(i.line), attrs: 'align="right"' }])),
      table(moneyRows(o).map(([a, b]) => [a, { td: b, attrs: 'align="right"' }]))];
    const text = ["Your order's in!", "Wagamama Leeds is getting it ready.", "Order number #1047", "15 November 2026", "",
      ...o.lines.flatMap((i) => [`${i.qty}x ${i.name}`, ...(i.extras || []).map((e) => `  ${e}`), gbp(i.line)]), "", moneyText(o, {}, "\n"), "", "Deliveroo"].join("\n");
    out.push(fixture("deliveroo-1", "Deliveroo", "html 1x cells; text with name, extras and price on separate lines",
      { from: "Deliveroo <noreply@t.deliveroo.com>", subject: "Your Deliveroo order from Wagamama", date: "Sun, 15 Nov 2026 18:33:00 +0000",
        html: page({ brand: "Deliveroo", domain: "deliveroo.co.uk", rows }), text }, expected("Deliveroo", "2026-11-15", o)));
  }
  {
    const o = order([
      { name: "Halloumi Wrap", qty: 1, unit: 895, extras: ["Add halloumi fries"] },
      { name: "Falafel Bowl", qty: 1, unit: 1050 },
      { name: "Sweet Potato Fries", qty: 2, unit: 395 },
      { name: "Lemonade", qty: 1, unit: 295 },
    ], { fees: [["Delivery fee", 199], ["Service fee", 99], ["Small order fee", 0]], discounts: [["Credit applied", 500]] });
    const rows = [`<p>Hi ${SHOPPER.first}, thanks for your order from Mezze House.</p>`, `<p>Order #8812 placed 14 Nov 2026</p>`,
      table(o.lines.map((i) => [`${h(i.name)} x${i.qty}${(i.extras || []).map((e) => `<br /><small>${h(e)}</small>`).join("")}`, { td: gbp(i.line), attrs: 'align="right"' }])),
      table(moneyRows(o, { total: "Total charged" }).map(([a, b]) => [a, b]))];
    out.push(fixture("deliveroo-2", "Deliveroo", "name x qty cells, extras under, credit applied",
      { from: "Deliveroo <noreply@t.deliveroo.com>", subject: "Order confirmation: Mezze House", date: "Sat, 14 Nov 2026 13:20:00 +0000",
        html: page({ brand: "Deliveroo", domain: "deliveroo.co.uk", rows }) }, expected("Deliveroo", "2026-11-14", o)));
  }
  {
    // Deliveroo grocery (Co-op via Deliveroo): a basket.
    const o = order([
      { name: "Co-op Semi Skimmed Milk 2 Pints", qty: 2, unit: 145 }, { name: "Warburtons Toastie White Bread 800g", qty: 1, unit: 175 },
      { name: "Lurpak Spreadable Butter 500g", qty: 1, unit: 525 }, { name: "Heinz Baked Beans 415g", qty: 4, unit: 140 },
      { name: "Co-op British Free Range Eggs 6 Pack", qty: 1, unit: 230 }, { name: "Walkers Ready Salted Crisps 6x25g", qty: 1, unit: 225 },
    ], { fees: [["Delivery fee", 349], ["Service fee", 99], ["Bag fee", 10]] });
    const text = ["Thanks for your order!", "Co-op - Headingley", "Order #22918", "Ordered 13 November 2026", "", ...o.lines.map((i) => `${i.qty} x ${i.name} ${gbp(i.line)}`), "", moneyText(o), "", "Deliveroo"].join("\n");
    out.push(fixture("deliveroo-3", "Deliveroo", "grocery basket, plain text", { from: "Deliveroo <noreply@t.deliveroo.com>", subject: "Your Deliveroo order receipt", date: "Fri, 13 Nov 2026 11:02:00 +0000", text },
      expected("Deliveroo", "2026-11-13", o)));
  }

  // ---- Uber Eats -----------------------------------------------------------------------------------------------------
  {
    const o = order([
      { name: "Big Tasty with Bacon Meal", qty: 1, unit: 899, extras: ["Large Fries", "Diet Coke"] },
      { name: "9 Chicken McNuggets", qty: 1, unit: 529, extras: ["Sweet Curry Dip"] },
      { name: "McFlurry Oreo", qty: 2, unit: 199 },
    ], { fees: [["Delivery Fee", 199], ["Service Fee", 149]], discounts: [["Promotion", 300]], tips: [["Tip", 100]] });
    const rows = [`<h1>Thanks for ordering, ${SHOPPER.first}</h1>`, `<p>Here's your receipt for McDonald's® (Leeds Briggate).</p>`, `<p>12 November 2026</p>`, `<p style="font-size:28px">Total ${gbp(o.total)}</p>`,
      table(o.lines.flatMap((i) => [[String(i.qty), h(i.name), { td: gbp(i.line), attrs: 'align="right"' }], ...(i.extras || []).map((e) => ["", `<span class="muted">${h(e)}</span>`, ""])])),
      table(moneyRows(o).map(([a, b]) => [a, { td: b, attrs: 'align="right"' }])), `<p>Payments: Mastercard ••••1234 ${gbp(o.total)}</p>`];
    out.push(fixture("uber-eats-1", "Uber Eats", "qty | name | price, extras rows, promotion and tip; total at top too",
      { from: "Uber Receipts <noreply@uber.com>", subject: "Your Wednesday evening order with Uber Eats", date: "Thu, 12 Nov 2026 19:22:00 +0000",
        html: page({ brand: "Uber Eats", domain: "ubereats.com", rows }) }, expected("Uber Eats", "2026-11-12", o)));
  }
  {
    const o = order([
      { name: "Pad Thai Chicken", qty: 1, unit: 1095 }, { name: "Green Curry Tofu", qty: 1, unit: 1050, extras: ["Jasmine rice"] },
      { name: "Chicken Satay Skewers", qty: 2, unit: 650 }, { name: "Thai Iced Tea", qty: 2, unit: 375 },
    ], { fees: [["Delivery Fee", 0], ["Service Fee", 199]], tips: [["Tip", 200]] });
    const text = [`Thanks for ordering, ${SHOPPER.first}`, "Here's your receipt for Thai Orchid.", "11 November 2026", "", `Total ${gbp(o.total)}`, "",
      ...o.lines.flatMap((i) => [`${i.qty} × ${i.name}`, ...(i.extras || []).map((e) => `    ${e}`), `    ${gbp(i.line)}`]), "", moneyText(o, { free: "£0.00" }, "    "), "", "Uber Eats"].join("\n");
    out.push(fixture("uber-eats-2", "Uber Eats", "plain text, qty × name, price line under", { from: "Uber Receipts <noreply@uber.com>", subject: "Your Tuesday order from Uber Eats", date: "Wed, 11 Nov 2026 20:15:00 +0000", text },
      expected("Uber Eats", "2026-11-11", o)));
  }

  // ---- Domino's ------------------------------------------------------------------------------------------------------
  {
    const o = order([
      { name: "Large Pepperoni Passion® (Classic Crust)", qty: 1, unit: 2199 },
      { name: "Medium Mighty Meaty® (Italian Style Crust)", qty: 1, unit: 1899, extras: ["Extra cheese"] },
      { name: "Garlic & Herb Dip", qty: 2, unit: 99 },
      { name: "Chicken Strippers®", qty: 1, unit: 699 },
    ], { discounts: [["Deal: 50% off pizza", 2049]], fees: [["Delivery", 0]] });
    const rows = [`<h2>Thanks for your order, ${SHOPPER.first}!</h2>`, `<p>Domino's Leeds Headingley</p>`, `<p>Order number: 411-2290</p>`, `<p>Order date: 10/11/2026</p>`,
      table([["<b>Qty</b>", "<b>Item</b>", "<b>Price</b>"], ...o.lines.map((i) => [String(i.qty), nameCell(i, ""), gbp(i.line)])]), table(moneyRows(o, { total: "Order Total" }))];
    out.push(fixture("dominos-1", "Domino's", "Qty | Item | Price table, deal discount", { from: "Domino's Pizza <orders@dominos.co.uk>", subject: "Your Domino's order confirmation", date: "Tue, 10 Nov 2026 18:40:00 +0000",
      html: page({ brand: "Domino's", domain: "dominos.co.uk", rows }) }, expected("Domino's", "2026-11-10", o)));
  }
  {
    const o = order([{ name: "Medium Vegi Supreme (Classic Crust)", qty: 1, unit: 1799 }, { name: "Potato Wedges", qty: 1, unit: 549 }, { name: "Coca-Cola Zero Sugar 1.25L", qty: 1, unit: 299 }],
      { fees: [["Delivery charge", 199]] });
    const text = ["Domino's Pizza", "", "Order confirmation", "Order number: 412-0087", "Placed: 9 November 2026 at 19:05", "", ...o.lines.map((i) => `${i.qty} x ${i.name} - ${gbp(i.line)}`), "", moneyText(o, { total: "Total to pay" }), "", "Paid online by card"].join("\n");
    out.push(fixture("dominos-2", "Domino's", "plain text", { from: "Domino's Pizza <orders@dominos.co.uk>", subject: "Thanks for your Domino's order", date: "Mon, 09 Nov 2026 19:06:00 +0000", text }, expected("Domino's", "2026-11-09", o)));
  }

  // ---- Pizza Hut -----------------------------------------------------------------------------------------------------
  {
    const o = order([{ name: "Large Texas BBQ Pan Pizza", qty: 1, unit: 2149 }, { name: "Garlic Bread", qty: 1, unit: 499 }, { name: "Cookie Dough", qty: 1, unit: 599 }, { name: "Pepsi Max 1.5L", qty: 2, unit: 349 }],
      { fees: [["Delivery fee", 299]], discounts: [["Voucher", 500]] });
    const rows = [`<p>Hi ${SHOPPER.first}, your order is confirmed.</p>`, `<p>Order ID: PH-5521873</p>`, `<p>Date: 08 Nov 2026</p>`,
      table(o.lines.map((i) => [h(i.name), `Qty: ${i.qty}`, gbp(i.line)])), table(moneyRows(o))];
    out.push(fixture("pizza-hut-1", "Pizza Hut", "name | Qty: n | price", { from: "Pizza Hut Delivery <noreply@pizzahut.co.uk>", subject: "Order confirmation - Pizza Hut Delivery", date: "Sun, 08 Nov 2026 18:00:00 +0000",
      html: page({ brand: "Pizza Hut", domain: "pizzahut.co.uk", rows }) }, expected("Pizza Hut", "2026-11-08", o, { shopAlso: ["Pizza Hut Delivery"] })));
  }
  {
    const o = order([{ name: "Medium Pepperoni Feast", qty: 2, unit: 1699 }, { name: "Chicken Wings", qty: 1, unit: 649 }], { fees: [["Delivery fee", 0]] });
    const text = ["Pizza Hut Delivery", "Thank you for your order!", "Order ID: PH-5530011", "Ordered on 7 November 2026", "",
      ...o.lines.map((i) => `${i.name}\nQuantity: ${i.qty}\n${gbp(i.line)}`), "", moneyText(o)].join("\n");
    out.push(fixture("pizza-hut-2", "Pizza Hut", "name / Quantity / price on separate lines", { from: "Pizza Hut Delivery <noreply@pizzahut.co.uk>", subject: "Thank you for your order", date: "Sat, 07 Nov 2026 20:30:00 +0000", text },
      expected("Pizza Hut", "2026-11-07", o, { shopAlso: ["Pizza Hut Delivery"] })));
  }

  // ---- McDonald's app --------------------------------------------------------------------------------------------------
  {
    const o = order([
      { name: "Big Mac Meal", qty: 1, unit: 749, extras: ["Medium Fries", "Medium Coca-Cola Zero"] },
      { name: "Cheeseburger", qty: 2, unit: 159 },
      { name: "Mozzarella Dippers (3)", qty: 1, unit: 229, extras: ["Tomato Dip"] },
    ]);
    const rows = [`<h1>Thanks for your order</h1>`, `<p>McDonald's Leeds Kirkstall Road</p>`, `<p>Order number 178</p>`, `<p>06/11/2026 12:41</p>`,
      table(o.lines.flatMap((i) => [[String(i.qty), h(i.name), gbp(i.line)], ...(i.extras || []).map((e) => ["", `&nbsp;&nbsp;${h(e)}`, ""])])),
      table([["Total (incl. VAT)", gbp(o.total)], ["Paid with", "Apple Pay"]])];
    out.push(fixture("mcdonalds-1", "McDonald's", "app order, meal parts as rows, total incl. VAT", { from: "McDonald's <noreply@mcdonalds.co.uk>", subject: "Your McDonald's receipt", date: "Fri, 06 Nov 2026 12:42:00 +0000",
      html: page({ brand: "McDonald's", domain: "mcdonalds.com", rows }) }, expected("McDonald's", "2026-11-06", o)));
  }
  {
    const o = order([{ name: "McCrispy Meal", qty: 1, unit: 799, extras: ["Large Fries", "Fanta Orange"] }, { name: "Hash Brown", qty: 2, unit: 119 }, { name: "Latte", qty: 1, unit: 199 }]);
    const text = ["McDonald's", "Order receipt", "Order 042", "Date: 05/11/2026", "", ...o.lines.flatMap((i) => [`${i.qty} ${i.name} ${gbp(i.line)}`, ...(i.extras || []).map((e) => `  ${e}`)]), "", `Total ${gbp(o.total)}`, "Includes VAT"].join("\n");
    out.push(fixture("mcdonalds-2", "McDonald's", "plain text, qty name price", { from: "McDonald's <noreply@mcdonalds.co.uk>", subject: "Your McDonald's order receipt", date: "Thu, 05 Nov 2026 08:15:00 +0000", text },
      expected("McDonald's", "2026-11-05", o)));
  }

  // ---- Greggs --------------------------------------------------------------------------------------------------------
  {
    const o = order([{ name: "Sausage Roll", qty: 2, unit: 135 }, { name: "Vegan Sausage Roll", qty: 1, unit: 140 }, { name: "Steak Bake", qty: 1, unit: 220 }, { name: "Regular Latte", qty: 1, unit: 245 }, { name: "Yum Yum", qty: 3, unit: 105 }]);
    const rows = [`<p>Thanks for your order, ${SHOPPER.first}!</p>`, `<p>Collect from Greggs Leeds Station</p>`, `<p>Order number: GR-77120</p>`, `<p>4 November 2026</p>`,
      table([["Item", "Qty", "Price"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]), table([["Total", gbp(o.total)]])];
    out.push(fixture("greggs-1", "Greggs", "Item | Qty | Price", { from: "Greggs <noreply@greggs.co.uk>", subject: "Your Greggs order confirmation", date: "Wed, 04 Nov 2026 08:01:00 +0000",
      html: page({ brand: "Greggs", domain: "greggs.co.uk", rows }) }, expected("Greggs", "2026-11-04", o)));
  }
  {
    const o = order([{ name: "Chicken Bake", qty: 1, unit: 220 }, { name: "Sausage, Bean & Cheese Melt", qty: 1, unit: 210 }, { name: "Regular Americano", qty: 2, unit: 195 }]);
    const text = ["Greggs", "Order receipt", "Order number: GR-77441", "3 November 2026", "", ...o.lines.map((i) => `${i.name} x${i.qty} ${gbp(i.line)}`), "", `Total ${gbp(o.total)}`].join("\n");
    out.push(fixture("greggs-2", "Greggs", "plain text, name xN price", { from: "Greggs <noreply@greggs.co.uk>", subject: "Your Greggs receipt", date: "Tue, 03 Nov 2026 12:10:00 +0000", text }, expected("Greggs", "2026-11-03", o)));
  }
  return out;
}
