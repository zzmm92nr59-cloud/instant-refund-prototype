// An eleventh set of made-up emails (see lib.mjs), round 8: fifteen more of the same kinds as holdout9 (takeaways, restaurants'
// own apps, supermarkets, Amazon, fashion), written AFTER holdout9 was fixed and scored BEFORE any change for them (first-try
// scores in the round 8 commit). Then three emails whose subject says "invoice" and never "order": one paid (a purchase),
// one overdue and one a business's unpaid invoice (never purchases).
// Every order, person, address, order number and card here is made up.
import { order, expected, page, table, moneyRows, moneyText, fixture, gbp, h, SHOPPER } from "./lib.mjs";

const R = (cells) => cells.map((c) => [c[0], { td: c[1], attrs: 'align="right"' }]);
const money = (o, labels) => table(R(moneyRows(o, labels)));

export default function holdout10() {
  const out = [];
  const add = (id, sender, layout, mail, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, mail, expected(shop, date, o, extra)); out.push(f); return f; };
  {
    const o = order([
      { name: "Chicken Doner Meal", qty: 1, unit: 1150, extras: ["Chips", "Can of Coke", "no salad"] },
      { name: "Chicken Doner Meal", qty: 1, unit: 1150, extras: ["Rice", "Can of Fanta"] },
      { name: "Garlic Bread", qty: 1, unit: 0 },
    ], { fees: [["Delivery fee", 199], ["Service charge", 99], ["Bag fee", 10]], tips: [["Rider tip", 100]] });
    const html = page({ brand: "Just Eat", domain: "just-eat.co.uk", rows: [`<p>Ali's Grill has your order</p>`, `<p>Order number: 1861002231</p><p>Placed on 18 November 2026</p>`,
      table(o.lines.map((i) => [`${i.qty}`, `${h(i.name)}${i.extras ? `<br/><span style="font-size:13px">${i.extras.map(h).join(", ")}</span>` : ""}`, { td: i.line ? gbp(i.line) : "Free", attrs: 'align="right" valign="top"' }])), money(o)] });
    add("holdout10-je-two-meals-free-bread", "Just Eat", "two meals with different choices comma-joined under each, a Free garlic bread", { from: "Just Eat <noreply@t.just-eat.co.uk>", subject: "Thanks for your order", date: "Wed, 18 Nov 2026 20:10:00 +0000", html }, o, "Just Eat", "2026-11-18");
  }
  {
    const o = order([
      { name: "Katsu Chicken Bao (2)", qty: 1, unit: 850 },
      { name: "Kimchi Fried Rice", qty: 2, unit: 750, extras: ["Add fried egg +£1.00"] },
    ], { fees: [["Delivery fee", 0], ["Service fee", 115], ["Small order fee", 200]] });
    const text = ["Deliveroo", "Order from Bao House", "Order number: 7712-0040", "18 November 2026", "", "1x Katsu Chicken Bao (2)  £8.50", "2x Kimchi Fried Rice  £15.00", "  Add fried egg +£1.00", "", moneyText(o, { free: "£0.00 (Deliveroo Plus)" }, "  ")].join("\n");
    add("holdout10-dr-plus-text", "Deliveroo", "text: 'Delivery fee £0.00 (Deliveroo Plus)', small order fee, priced option", { from: "Deliveroo <noreply@t.deliveroo.com>", subject: "Your order from Bao House", date: "Wed, 18 Nov 2026 12:00:00 +0000", text }, o, "Deliveroo", "2026-11-18");
  }
  {
    const o = order([
      { name: "Big Breakfast", qty: 1, unit: 899, extras: ["Brown toast", "Note: eggs well done"] },
      { name: "Flat White", qty: 2, unit: 325, extras: ["Oat milk"] },
    ], { fees: [["Delivery Fee", 149], ["Service Fee", 99]], discounts: [["Promotion: 30% off", 465]], tips: [["Tip", 150]] });
    const html = page({ brand: "Uber Eats", domain: "uber.com", rows: [`<p>Thanks for ordering, ${SHOPPER.first}. Here's your receipt for Rise Cafe.</p>`, `<p>17 November 2026</p>`,
      table(o.lines.map((i) => [`${i.qty}`, `${h(i.name)}`, { td: gbp(i.line), attrs: 'align="right"' }])).replace("Big Breakfast</td>", "Big Breakfast<br/><span>Brown toast</span><br/><span>Note: eggs well done</span></td>").replace("Flat White</td>", "Flat White<br/><span>Oat milk</span></td>"), money(o)] });
    add("holdout10-ue-note-line", "Uber Eats", "'Note: eggs well done' under an item, % promotion", { from: "Uber Eats <noreply@uber.com>", subject: "Your Tuesday morning order with Uber Eats", date: "Tue, 17 Nov 2026 09:30:00 +0000", html }, o, "Uber Eats", "2026-11-17");
  }
  {
    const o = order([
      { name: "Large Create Your Own", qty: 1, unit: 1799, extras: ["Half 1: Pepperoni, Mushrooms", "Half 2: Ham, Pineapple"] },
      { name: "Potato Wedges", qty: 1, unit: 499 },
      { name: "Garlic & Herb Dip", qty: 2, unit: 99 },
    ], { fees: [["Delivery", 199]], discounts: [["Voucher 50% off", 900]] });
    const text = ["Domino's Pizza", "Order Number: 1188", "Order date: 16/11/2026", "", ...o.lines.flatMap((i) => [`${i.qty} x ${i.name} ${gbp(i.line)}`, ...(i.extras || []).map((e) => `    ${e}`)]), "", moneyText(o)].join("\n");
    add("holdout10-dominos-halves-text", "Domino's", "text: 'Half 1: …' and 'Half 2: …' lines, voucher", { from: "Domino's Pizza <orders@dominos.co.uk>", subject: "Your Domino's order", date: "Mon, 16 Nov 2026 19:30:00 +0000", text }, o, "Domino's", "2026-11-16");
  }
  {
    const o = order([
      { name: "Chicken Butterfly", qty: 1, unit: 1095, extras: ["Extra Hot", "Macho Peas", "Garlic Bread"] },
      { name: "Halloumi Sticks & Dip", qty: 1, unit: 525 },
    ], { fees: [["Delivery", 249]] });
    const html = page({ brand: "Nando's", domain: "nandos.co.uk", rows: [`<p>Your Nando's order</p>`, `<p>Order number: N-90021</p><p>15 November 2026</p>`,
      table([["Chicken Butterfly", gbp(1095)], ["Spice: Extra Hot", ""], ["Side: Macho Peas", ""], ["Side: Garlic Bread", ""], ["Halloumi Sticks &amp; Dip", gbp(525)]]), money(o)] });
    add("holdout10-nandos-spice-side-rows", "Nando's", "'Spice:' and 'Side:' rows with empty price cells", { from: "Nando's <noreply@nandos.co.uk>", subject: "Your Nando's order N-90021", date: "Sun, 15 Nov 2026 18:00:00 +0000", html }, o, "Nando's", "2026-11-15");
  }
  {
    const o = order([
      { name: "Iced Caramel Latte", qty: 1, unit: 395, extras: ["Large", "Extra shot +50p"] },
      { name: "Cheese & Ham Croissant", qty: 1, unit: 350, extras: ["Warmed"] },
    ]);
    const text = ["Costa Coffee", "Order C-311190", "14 November 2026", "", "Iced Caramel Latte  £3.95", "  Large", "  Extra shot +50p", "Cheese & Ham Croissant  £3.50", "  Warmed", "", "Total £7.45", "You earned 1 bean"].join("\n");
    add("holdout10-costa-text-beans", "Costa", "text: name  £, options indented, total only", { from: "Costa Coffee <noreply@costa.co.uk>", subject: "Your Costa order receipt", date: "Sat, 14 Nov 2026 10:00:00 +0000", text }, o, "Costa", "2026-11-14");
  }
  {
    const o = order([
      { name: "Tesco Finest Steak Pie 550G", qty: 1, unit: 450 },
      { name: "Tesco Mixed Peppers 3 Pack", qty: 1, unit: 150, substituted: "Tesco Red Peppers 3 Pack" },
      { name: "Gordon's Gin 70Cl", qty: 1, unit: 1800 },
      { name: "Tesco Loose Lemons", qty: 4, unit: 30 },
      { name: "Tesco Greek Yogurt 500G", qty: 1, unit: 175, unavailable: true },
    ], { fees: [["Delivery", 300], ["Bags", 0]], discounts: [["Clubcard Prices", 500]] });
    const html = page({ brand: "Tesco", domain: "tesco.com", rows: [`<p>Thanks for shopping with us</p>`, `<p>Order number: 7701-5501-3302</p><p>Ordered on 13 November 2026</p>`, `<h3>What you got</h3>`,
      table([["1", "Tesco Finest Steak Pie 550G", gbp(450)], ["1", "Tesco Mixed Peppers 3 Pack<br/>Substitute for Tesco Red Peppers 3 Pack", gbp(150)], ["1", "Gordon's Gin 70Cl<br/>Age restricted. Clubcard Price £13.00", gbp(1800)], ["4", "Tesco Loose Lemons", gbp(120)]]),
      `<h3>What we couldn't get</h3>`, table([["1", "Tesco Greek Yogurt 500G", "Not charged"]]), money(o, { free: "£0.00" })] });
    add("holdout10-tesco-got-couldnt", "Tesco", "'What you got' / 'What we couldn't get', substitute and age notes under names", { from: "Tesco.com <tesco@confirmations.tesco.co.uk>", subject: "Your Tesco receipt", date: "Fri, 13 Nov 2026 19:00:00 +0000", html }, o, "Tesco", "2026-11-13");
  }
  {
    const o = order([
      { name: "Sainsbury's Taste the Difference Sourdough", qty: 1, unit: 175 },
      { name: "Sainsbury's Lemons x4", qty: 1, unit: 100 },
      { name: "Sainsbury's Loose Tomatoes", qty: 1, unit: 92 },
    ], { fees: [["Delivery charge", 100]] });
    const html = page({ brand: "Sainsbury's", domain: "sainsburys.co.uk", rows: [`<p>Order summary</p>`, `<p>Order number: 1009999012</p><p>Order date: 12 November 2026</p>`,
      table([["Product", "Quantity", "Price"], ["Sainsbury's Taste the Difference Sourdough", "1", gbp(175)], ["Sainsbury's Lemons x4", "1", gbp(100)], ["Sainsbury's Loose Tomatoes<br/>Weight: 0.46kg", "1", gbp(92)]]), money(o)] });
    add("holdout10-sainsburys-weight-label", "Sainsbury's", "'Weight: 0.46kg' under a name, 'Lemons x4' with a qty column", { from: "Sainsbury's <groceries@sainsburys.co.uk>", subject: "Your Sainsbury's order summary", date: "Thu, 12 Nov 2026 21:00:00 +0000", html }, o, "Sainsbury's", "2026-11-12");
  }
  {
    const o = order([
      { name: "Waitrose Essential Spaghetti 500g", qty: 2, unit: 75 },
      { name: "Waitrose Duchy Organic Free Range Eggs 6", qty: 1, unit: 340 },
      { name: "Waitrose Prosecco 75cl", qty: 1, unit: 900 },
    ], { fees: [["Delivery charge", 0], ["Carrier bags", 0]], discounts: [["Offer: Prosecco 25% off", 225]] });
    const text = ["Waitrose & Partners", "Your order has been confirmed", "Order number: 1022999810", "Order date: 11 November 2026", "", ...o.lines.map((i) => `${i.name}\nQuantity: ${i.qty}  ${gbp(i.line)}${/Prosecco/.test(i.name) ? "\nThis item is age restricted" : ""}`), "", moneyText(o, { free: "Free" })].join("\n");
    add("holdout10-waitrose-qty-price-line-text", "Waitrose", "text: name, then 'Quantity: 2  £1.50', an age-restricted note line", { from: "Waitrose & Partners <customerservice@waitrose.co.uk>", subject: "Your Waitrose order is confirmed", date: "Wed, 11 Nov 2026 08:00:00 +0000", text }, o, "Waitrose", "2026-11-11");
  }
  {
    const o = order([
      { name: "Iceland Southern Fried Chicken Strips 600g", qty: 2, unit: 300 },
      { name: "Iceland Garlic Bread Slices 10 pack", qty: 1, unit: 100 },
      { name: "Kopparberg Mixed Fruit 500ml", qty: 1, unit: 250 },
    ], { fees: [["Delivery", 0], ["Bags", 40]], discounts: [["2 for £5", 100]] });
    const html = page({ brand: "Iceland", domain: "iceland.co.uk", rows: [`<p>Your order is on its way</p>`, `<p>Order No: 400099120</p><p>Order Date: 10/11/2026</p>`,
      table(o.lines.map((i) => [h(i.name) + (/Kopparberg/.test(i.name) ? "<br/>Challenge 25: ID required" : ""), `Qty ${i.qty}`, gbp(i.line)])), money(o)] });
    add("holdout10-iceland-challenge25", "Iceland", "'Challenge 25: ID required' under a name, 'Qty 2' cell", { from: "Iceland <groceries@iceland.co.uk>", subject: "Your Iceland order confirmation", date: "Tue, 10 Nov 2026 12:00:00 +0000", html }, o, "Iceland", "2026-11-10");
  }
  {
    const o = order([
      { name: "Lavazza Qualità Rossa Coffee Beans 1kg", qty: 1, unit: 1450 },
      { name: "Silicone Baking Mats, Set of 2", qty: 1, unit: 999 },
    ], { fees: [["Postage & Packing", 0]], discounts: [["Subscribe & Save", 73], ["Promotional Credit", 500]] });
    const html = page({ brand: "Amazon.co.uk", domain: "amazon.co.uk", rows: [`<p>Order Confirmation</p>`, `<p>Order #207-3344556-7788990</p><p>Order Date: 9 November 2026</p>`,
      table([[`Lavazza Qualità Rossa Coffee Beans 1kg<br/>Subscribe &amp; Save: every 2 months<br/>Sold by: Amazon`, gbp(1450)], [`Silicone Baking Mats, Set of 2<br/>Sold by: HomeBake Direct`, gbp(999)]]),
      table(R([["Item(s) Subtotal:", gbp(o.subtotal)], ["Postage &amp; Packing:", "£0.00"], ["Subscribe &amp; Save:", "-£0.73"], ["Promotional Credit:", "-£5.00"], ["<b>Grand Total:</b>", `<b>${gbp(o.total)}</b>`]]))] });
    add("holdout10-amazon-sns-credit", "Amazon", "'Subscribe & Save: every 2 months' under a name, promotional credit", { from: "Amazon.co.uk <auto-confirm@amazon.co.uk>", subject: "Your Amazon.co.uk order #207-3344556-7788990", date: "Mon, 9 Nov 2026 10:00:00 +0000", html }, o, "Amazon", "2026-11-09");
  }
  {
    const o = order([
      { name: "Oversized Puffer Jacket", qty: 1, unit: 6999, extras: ["Size 10"] },
      { name: "Oversized Puffer Jacket", qty: 1, unit: 6999, extras: ["Size 12"] },
    ], { fees: [["Delivery", 0]] });
    const text = ["H&M", "Order confirmation", "Order number: 61009988776", "Order date: 8 November 2026", "", "Oversized Puffer Jacket | Black | Size 10 | 1 | £69.99", "Oversized Puffer Jacket | Black | Size 12 | 1 | £69.99", "", moneyText(o, { free: "Free" })].join("\n");
    add("holdout10-hm-two-sizes-pipes-text", "H&M", "text: 'Name | Colour | Size 10 | 1 | £', same jacket in two sizes", { from: "H&M <info@email.hm.com>", subject: "Your H&M order confirmation", date: "Sun, 8 Nov 2026 14:00:00 +0000", text }, o, "H&M", "2026-11-08");
  }
  {
    const o = order([
      { name: "Nike Tech Fleece Joggers", qty: 1, unit: 10000, extras: ["S"] },
      { name: "Nike Tech Fleece Joggers", qty: 1, unit: 10000, extras: ["M"] },
      { name: "adidas Socks 3 Pack", qty: 1, unit: 1200 },
    ], { fees: [["Next Day Delivery", 699]] });
    const html = page({ brand: "JD Sports", domain: "jdsports.co.uk", rows: [`<p>Thanks for your order</p>`, `<p>Order number: JD-9940001</p><p>7 November 2026</p>`,
      table([["Product", "Size", "Qty", "Price"], ["Nike Tech Fleece Joggers", "S", "1", gbp(10000)], ["Nike Tech Fleece Joggers", "M", "1", gbp(10000)], ["adidas Socks 3 Pack", "One Size", "1", gbp(1200)]]), money(o)] });
    add("holdout10-jd-size-column", "JD Sports", "Product | Size | Qty | Price columns, one item in two sizes", { from: "JD Sports <orders@jdsports.co.uk>", subject: "Your JD order JD-9940001", date: "Sat, 7 Nov 2026 11:00:00 +0000", html }, o, "JD Sports", "2026-11-07");
  }
  {
    const o = order([
      { name: "Ribbed Knit Midi Dress", qty: 1, unit: 3599, extras: ["XS"] },
      { name: "Faux Leather Biker Jacket", qty: 1, unit: 5999, extras: ["S"] },
    ], { fees: [["Standard delivery", 399]], discounts: [["Student discount", 960]] });
    const html = page({ brand: "Zara", domain: "zara.com", rows: [`<p>THANK YOU FOR YOUR ORDER</p>`, `<p>ORDER NO. 52099001122</p><p>06/11/2026</p>`,
      ...o.lines.map((i) => `<p><b>${h(i.name.toUpperCase())}</b></p><p>${gbp(i.line)}</p><p>${i.extras[0]} | BLACK</p><p>1 UNIT</p>`), money(o)] });
    add("holdout10-zara-blocks-price-under", "Zara", "blocks: NAME, price, 'XS | BLACK', '1 UNIT'", { from: "ZARA <noreply@zara.com>", subject: "Thank you for your order", date: "Fri, 6 Nov 2026 18:00:00 +0000", html }, o, "Zara", "2026-11-06");
    out[out.length - 1].expected.items.forEach((i) => { i.name = i.name.toUpperCase(); });
  }
  {
    const o = order([
      { name: "SHEIN Teddy Fleece Hoodie", qty: 2, unit: 1499, extras: ["L"] },
      { name: "SHEIN Fluffy Slipper Socks 5 Pairs", qty: 1, unit: 599 },
    ], { fees: [["Shipping Fee", 399]], discounts: [["Coupon Saving", 200]] });
    const text = ["SHEIN", "Thanks for shopping with SHEIN!", "Order Number: GSUK99887ABC", "Order Date: 05/11/2026", "", "SHEIN Teddy Fleece Hoodie", "Size: L", "£14.99 x 2", "SHEIN Fluffy Slipper Socks 5 Pairs", "£5.99 x 1", "", `Retail Price: ${gbp(o.subtotal)}`, "Shipping Fee: £3.99", "Coupon Saving: -£2.00", `Order Total: ${gbp(o.total)}`].join("\n");
    add("holdout10-shein-unit-x-qty-text", "SHEIN", "text: name, 'Size: L', '£14.99 x 2' (unit times how many, no line price)", { from: "SHEIN <noreply@shein.com>", subject: "Your SHEIN order GSUK99887ABC", date: "Thu, 5 Nov 2026 20:00:00 +0000", text }, o, "SHEIN", "2026-11-05");
  }

  // ---- Invoices that never say "order" ---------------------------------------------------------------------------------
  {
    // Paid: a purchase.
    const o = order([{ name: "Window cleaning (front and back)", qty: 1, unit: 2500 }, { name: "Conservatory roof clean", qty: 1, unit: 3500 }]);
    const text = ["Brightwave Window Cleaning", `Hi ${SHOPPER.first},`, "Here is your invoice for this month's clean. Thank you for your payment.", "Invoice number: BW-2291", "Invoice date: 4 November 2026", "",
      ...o.lines.map((i) => `${i.name}  ${gbp(i.line)}`), "", `Total ${gbp(o.total)}`, `Amount paid ${gbp(o.total)}`, "Balance due £0.00", "", "Brightwave Window Cleaning"].join("\n");
    add("holdout10-invoice-paid", "Brightwave Window Cleaning", "subject 'Your invoice from …', paid, no 'order' anywhere", { from: "Brightwave Window Cleaning <accounts@brightwavecleaning.co.uk>", subject: "Your invoice from Brightwave Window Cleaning", date: "Wed, 4 Nov 2026 17:00:00 +0000", text }, o, "Brightwave Window Cleaning", "2026-11-04");
  }
  const not = (id, sender, layout, mail, kind) => out.push({ id, sender, layout, headers: { from: mail.from, to: SHOPPER.email, subject: mail.subject, date: mail.date }, html: "", text: mail.text, expected: { notPurchase: { kind } } });
  not("holdout10-invoice-overdue", "Brightwave Window Cleaning", "an overdue invoice: never a purchase", { from: "Brightwave Window Cleaning <accounts@brightwavecleaning.co.uk>", subject: "Invoice BW-2301 is overdue", date: "Thu, 19 Nov 2026 09:00:00 +0000",
    text: ["Brightwave Window Cleaning", "Invoice number: BW-2301", "Invoice date: 1 November 2026", "Window cleaning (front and back)  £25.00", "Total £25.00", "Amount due £25.00", "This invoice is now overdue. Please pay by 26 November 2026."].join("\n") }, "unpaid invoice");
  not("holdout10-invoice-business-unpaid", "Northgate Supplies", "a business's invoice still to pay: never a purchase", { from: "Northgate Supplies Ltd <invoices@northgatesupplies.co.uk>", subject: "Invoice from Northgate Supplies Ltd", date: "Wed, 18 Nov 2026 15:00:00 +0000",
    text: ["Northgate Supplies Ltd", "Invoice number: NS-77120", "Invoice date: 18 November 2026", "Due date: 18 December 2026", "Copier paper A4 (10 reams)  £45.00", "Toner cartridge  £89.00", "Subtotal £134.00", "VAT £26.80", "Total £160.80", "Amount due £160.80", "Payment terms: 30 days. Please pay by bank transfer quoting NS-77120."].join("\n") }, "unpaid invoice");
  return out;
}
