// Supermarket online orders (made-up baskets; see lib.mjs): 30+ lines, substitutions, multibuy savings, unavailable items.
import { order, expected, page, table, moneyRows, moneyText, fixture, gbp, h, SHOPPER } from "./lib.mjs";

const BASKET = [
  ["Tesco British Semi Skimmed Milk 2.272L, 4 Pints", 2, 165], ["Warburtons Medium Sliced White Bread 800G", 1, 160], ["Tesco Finest Sourdough Bloomer 800G", 1, 220],
  ["Tesco British Free Range Large Eggs 12 Pack", 1, 389], ["Anchor Spreadable Butter 500G", 1, 450], ["Cathedral City Mature Cheddar 550G", 1, 575],
  ["Tesco Bananas Loose", 6, 18], ["Tesco Braeburn Apple Minimum 5 Pack", 1, 159], ["Tesco Carrots 1Kg", 1, 59], ["Tesco Broccoli 335G", 2, 69],
  ["Tesco Baby Potatoes 1Kg", 1, 105], ["Tesco Brown Onions 3 Pack", 1, 89], ["Tesco Cherry Tomatoes 330G", 1, 99], ["Tesco Iceberg Lettuce Each", 1, 65],
  ["Tesco British Chicken Breast Portions 650G", 1, 499], ["Tesco 12 Pork Sausages 681G", 1, 300], ["Tesco Beef Mince 5% Fat 500G", 1, 425], ["Tesco Smoked Back Bacon 300G", 1, 249],
  ["Heinz Baked Beans In Tomato Sauce 4X415g", 1, 450], ["Napolina Chopped Tomatoes 400G", 3, 85], ["Tesco Fusilli Pasta Twists 1Kg", 1, 115], ["Tilda Basmati Rice 1Kg", 1, 375],
  ["Kellogg's Corn Flakes Cereal 670G", 1, 290], ["Quaker Oat So Simple Original 12X27g", 1, 325], ["PG Tips 240 Pyramid Tea Bags 696G", 1, 650], ["Nescafe Gold Blend Instant Coffee 200G", 1, 700],
  ["Walkers Ready Salted Crisps 6X25g", 2, 225], ["McVitie's Chocolate Digestives 433G", 1, 225], ["Coca-Cola Zero Sugar 8X330ml", 1, 525], ["Tropicana Smooth Orange Juice 1.4L", 1, 395],
  ["Andrex Classic Clean Toilet Tissue 9 Rolls", 1, 600], ["Fairy Original Washing Up Liquid 820Ml", 1, 250], ["Persil Bio Washing Liquid 38 Washes", 1, 1000], ["Tesco Sea Salt Dishwasher Tablets 30 Pack", 1, 400],
];
const swapNames = (from, to) => (n) => n.replace(from, to);
const basket = (brand, rename = (n) => n, take = BASKET.length) => BASKET.slice(0, take).map(([n, q, u]) => ({ name: rename(n), qty: q, unit: u }));

export default function grocery() {
  const out = [];
  // ---- Tesco ---------------------------------------------------------------------------------------------------------
  {
    // Order confirmation: Qty | Product | Price table under aisle headings, multibuy and Clubcard savings, basket charge.
    const items = basket("Tesco");
    const o = order(items, { fees: [["Delivery charge", 450], ["Basket charge", 0], ["Bag charge", 0]], discounts: [["Multibuy savings", 225], ["Clubcard savings", 350]] });
    const groups = [["Fresh food", 0, 18], ["Food cupboard", 18, 30], ["Household", 30, 34]];
    const rows = [`<h1>Thanks for your order, ${SHOPPER.first}</h1>`, `<p>Your Tesco delivery is booked for Saturday 21 November between 9am - 10am.</p>`,
      `<p>Order number: <b>942-5512-2201</b><br />Order date: 18/11/2026</p>`,
      table([["<b>Qty</b>", "<b>Product</b>", "<b>Price</b>"], ...groups.flatMap(([g, a, b]) => [[{ td: `<b>${g}</b>`, attrs: 'colspan="3"' }], ...o.lines.slice(a, b).map((i) => [String(i.qty), h(i.name), gbp(i.line)])])]),
      table(moneyRows(o, { subtotal: "Guide price", total: "Total guide price", free: "£0.00" }))];
    out.push(fixture("tesco-1", "Tesco", "order confirmation, aisle headings, 34 lines, multibuy + Clubcard savings", { from: "Tesco.com <tesco@confirmations.tesco.co.uk>", subject: "Thanks for your Tesco order", date: "Wed, 18 Nov 2026 10:12:00 +0000",
      html: page({ brand: "Tesco", domain: "tesco.com", rows }) }, expected("Tesco", "2026-11-18", o)));
  }
  {
    // Delivery receipt: what was delivered, then substitutions (original -> substitute), then unavailable items (not charged).
    const items = basket("Tesco", undefined, 31).map((i) => ({ ...i }));
    items[4] = { name: "Lurpak Spreadable Butter 500G", qty: 1, unit: 525, substituted: "Anchor Spreadable Butter 500G" };
    items[16] = { name: "Tesco Beef Mince 5% Fat 500G", qty: 1, unit: 425, unavailable: true };
    items[26] = { name: "Walkers Ready Salted Crisps 6X25g", qty: 2, unit: 225, unavailable: true };
    items.push({ name: "Tesco Finest Beef Mince 5% Fat 500G", qty: 1, unit: 475, substituted: "Tesco Beef Mince 5% Fat 750G" });
    items.sort((a, b) => (a.substituted ? 1 : 0) - (b.substituted ? 1 : 0));   // the email lists substitutes after what was delivered
    const o = order(items, { fees: [["Delivery charge", 450]], discounts: [["Multibuy savings", 170]] });
    const delivered = o.lines.filter((i) => !i.unavailable && !i.substituted), subs = o.lines.filter((i) => i.substituted), gone = o.lines.filter((i) => i.unavailable);
    const rows = [`<h1>Your order has been delivered</h1>`, `<p>Here's your receipt, ${SHOPPER.first}.</p>`, `<p>Order number: 942-5512-2209</p>`, `<p>Delivered on 17 November 2026</p>`,
      `<h2>Delivered items</h2>`, table([["Qty", "Product", "Price"], ...delivered.map((i) => [String(i.qty), h(i.name), gbp(i.line)])]),
      `<h2>Substitutions</h2>`, table(subs.map((i) => [String(i.qty), `${h(i.name)}<br /><span class="muted">Instead of ${h(i.substituted)}</span>`, gbp(i.line)])),
      `<h2>Unavailable items</h2><p>Sorry, these items weren't available. You haven't been charged for them.</p>`, table(gone.map((i) => [String(i.qty), h(i.name), "Not charged"])),
      table(moneyRows(o, { total: "Total paid" }))];
    out.push(fixture("tesco-2", "Tesco", "delivery receipt with substitutions and unavailable items", { from: "Tesco.com <tesco@confirmations.tesco.co.uk>", subject: "Your Tesco order receipt", date: "Tue, 17 Nov 2026 18:40:00 +0000",
      html: page({ brand: "Tesco", domain: "tesco.com", rows }) }, expected("Tesco", "2026-11-17", o)));
  }
  {
    // Plain text confirmation (Tesco's text part): "Qty x Name  £x".
    const o = order(basket("Tesco", undefined, 32), { fees: [["Delivery charge", 399]], discounts: [["Clubcard Prices savings", 410]] });
    const text = [`Hello ${SHOPPER.first},`, "Thanks for shopping with Tesco.", "Order number: 942-5512-2310", "Order date: 16 November 2026", "", "Your order", ...o.lines.map((i) => `${i.qty} x ${i.name}   ${gbp(i.line)}`), "",
      moneyText(o, { subtotal: "Guide price", total: "Total guide price" }, "   ")].join("\n");
    out.push(fixture("tesco-3", "Tesco", "plain text confirmation, 32 lines", { from: "Tesco.com <tesco@confirmations.tesco.co.uk>", subject: "Thanks for your Tesco order", date: "Mon, 16 Nov 2026 09:00:00 +0000", text },
      expected("Tesco", "2026-11-16", o)));
  }
  // ---- Sainsbury's ---------------------------------------------------------------------------------------------------
  const sb = (n) => n.replace(/^Tesco Finest /, "Taste the Difference ").replace(/^Tesco /, "Sainsbury's ");
  {
    const o = order(basket("s", sb), { fees: [["Delivery", 400]], discounts: [["Nectar Prices savings", 300], ["Multi-buy savings", 125]] });
    const rows = [`<p>Hi ${SHOPPER.first}, thanks for your order.</p>`, `<p>Order number: 1029384756</p>`, `<p>Ordered on 15 November 2026</p>`,
      table([["Product", "Quantity", "Total"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]), table(moneyRows(o, { subtotal: "Products total", total: "Estimated total" }))];
    out.push(fixture("sainsburys-1", "Sainsbury's", "Product | Quantity | Total, Nectar and multi-buy savings", { from: "Sainsbury's <groceries@sainsburys.co.uk>", subject: "Your Sainsbury's order confirmation", date: "Sun, 15 Nov 2026 09:30:00 +0000",
      html: page({ brand: "Sainsbury's", domain: "sainsburys.co.uk", rows }) }, expected("Sainsbury's", "2026-11-15", o)));
  }
  {
    const items = basket("s", sb, 30); items[3] = { ...items[3], unavailable: true };
    const o = order(items, { fees: [["Delivery", 0]], discounts: [["Nectar Prices savings", 180]] });
    const text = ["Sainsbury's", "Your groceries receipt", "Order number: 1029384799", "Delivered 14 November 2026", "",
      ...o.lines.filter((i) => !i.unavailable).map((i) => `${i.name}\n${i.qty} x ${gbp(i.unit)}   ${gbp(i.line)}`), "", "Unavailable", ...o.lines.filter((i) => i.unavailable).map((i) => `${i.name} - not charged`), "",
      moneyText(o, { total: "Total charged", free: "£0.00" })].join("\n");
    out.push(fixture("sainsburys-2", "Sainsbury's", "text receipt: name line, qty x unit and line total under it", { from: "Sainsbury's <groceries@sainsburys.co.uk>", subject: "Your Sainsbury's receipt", date: "Sat, 14 Nov 2026 19:00:00 +0000", text },
      expected("Sainsbury's", "2026-11-14", o)));
  }
  // ---- Asda ----------------------------------------------------------------------------------------------------------
  const asda = (n) => n.replace(/^Tesco Finest /, "ASDA Extra Special ").replace(/^Tesco /, "ASDA ");
  {
    const o = order(basket("a", asda), { fees: [["Delivery charge", 300], ["Minimum basket charge", 0]], discounts: [["Rollback savings", 95]] });
    const rows = [`<p>Thanks for shopping with Asda, ${SHOPPER.first}!</p>`, `<p>Order no: 300982114455</p>`, `<p>Order date: 13/11/2026</p>`,
      table([["Item", "Qty", "Price"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]), table(moneyRows(o, { subtotal: "Items subtotal", free: "£0.00" }))];
    out.push(fixture("asda-1", "Asda", "Item | Qty | Price", { from: "ASDA <noreply@asda.com>", subject: "Your Asda order is confirmed", date: "Fri, 13 Nov 2026 08:00:00 +0000",
      html: page({ brand: "Asda", domain: "asda.com", rows }) }, expected("Asda", "2026-11-13", o)));
  }
  {
    const items = basket("a", asda, 31); items.push({ name: "ASDA Large Free Range Eggs 6 Pack", qty: 1, unit: 175, substituted: "ASDA Free Range Eggs 12 Pack" });
    const o = order(items, { fees: [["Delivery charge", 150]] });
    const text = ["ASDA", "Your receipt", "Order no: 300982114471", "Delivered: 12 November 2026", "", ...o.lines.map((i) => `${i.qty}x ${i.name} ${gbp(i.line)}${i.substituted ? `\n   (Substitute for ${i.substituted})` : ""}`), "", moneyText(o)].join("\n");
    out.push(fixture("asda-2", "Asda", "text receipt with a substitute note", { from: "ASDA <noreply@asda.com>", subject: "Your Asda receipt", date: "Thu, 12 Nov 2026 20:00:00 +0000", text }, expected("Asda", "2026-11-12", o)));
  }
  // ---- Morrisons -----------------------------------------------------------------------------------------------------
  const mor = (n) => n.replace(/^Tesco Finest /, "Morrisons The Best ").replace(/^Tesco /, "Morrisons ");
  {
    const o = order(basket("m", mor), { fees: [["Delivery", 350]], discounts: [["Offers", 260], ["More Card savings", 115]] });
    const rows = [`<p>Order confirmed</p>`, `<p>Order number: 7731188</p>`, `<p>11 November 2026</p>`, table([["Description", "Qty", "Cost"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]),
      table(moneyRows(o, { subtotal: "Sub Total", total: "Order Total" }))];
    out.push(fixture("morrisons-1", "Morrisons", "Description | Qty | Cost", { from: "Morrisons <noreply@morrisons.com>", subject: "Your Morrisons order confirmation", date: "Wed, 11 Nov 2026 07:30:00 +0000",
      html: page({ brand: "Morrisons", domain: "morrisons.com", rows }) }, expected("Morrisons", "2026-11-11", o)));
  }
  {
    const o = order(basket("m", mor, 30), { fees: [["Delivery", 0]] });
    const rows = [`<p>Thanks for your order.</p>`, `<p>Order number: 7731201</p>`, `<p>10 November 2026</p>`,
      ...o.lines.map((i) => `<table width="100%"><tr><td>${h(i.name)}</td><td align="right">${gbp(i.line)}</td></tr><tr><td class="muted">Qty ${i.qty}</td><td></td></tr></table>`), table(moneyRows(o, { free: "Free" }))];
    out.push(fixture("morrisons-2", "Morrisons", "a small table per item: name and price, Qty under", { from: "Morrisons <noreply@morrisons.com>", subject: "Thanks for your Morrisons order", date: "Tue, 10 Nov 2026 07:30:00 +0000",
      html: page({ brand: "Morrisons", domain: "morrisons.com", rows }) }, expected("Morrisons", "2026-11-10", o)));
  }
  // ---- Ocado ---------------------------------------------------------------------------------------------------------
  const oc = (n) => n.replace(/^Tesco Finest /, "M&S ").replace(/^Tesco /, "Ocado ");
  {
    const o = order(basket("o", oc), { fees: [["Delivery", 199], ["Carrier bags", 0]], discounts: [["Offer savings", 340]] });
    const rows = [`<p>Dear ${SHOPPER.first},</p><p>Thank you for your order. It will be delivered on Thursday 12 November, 7:00-8:00.</p>`, `<p>Order number: 1004-2219-8831</p>`, `<p>Order placed: 9 November 2026</p>`,
      table([["Item", "Quantity", "Price"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]), table(moneyRows(o, { subtotal: "Total of items", total: "Total (estimated)", free: "£0.00" }))];
    out.push(fixture("ocado-1", "Ocado", "Item | Quantity | Price, offer savings", { from: "Ocado <customerservices@ocado.com>", subject: "Your Ocado order confirmation", date: "Mon, 09 Nov 2026 21:00:00 +0000",
      html: page({ brand: "Ocado", domain: "ocado.com", rows }) }, expected("Ocado", "2026-11-09", o)));
  }
  {
    const items = basket("o", oc, 30); items[10] = { ...items[10], unavailable: true }; items.push({ name: "Ocado Organic Baby Potatoes 750g", qty: 1, unit: 150, substituted: "Ocado Baby Potatoes 1Kg" });
    const o = order(items, { fees: [["Delivery", 199]] });
    const text = ["Ocado", "Your receipt for your delivery on 8 November 2026", "Order number: 1004-2219-8890", "",
      ...o.lines.filter((i) => !i.unavailable).map((i) => `${i.name}  ${i.qty}  ${gbp(i.line)}${i.substituted ? "  (substitute)" : ""}`), "", "Missing items (you have not been charged)", ...o.lines.filter((i) => i.unavailable).map((i) => `${i.name}  ${i.qty}`), "", moneyText(o, {}, "  ")].join("\n");
    out.push(fixture("ocado-2", "Ocado", "text receipt: name, qty, price columns; missing items; a substitute", { from: "Ocado <customerservices@ocado.com>", subject: "Your Ocado receipt", date: "Sun, 08 Nov 2026 20:00:00 +0000", text },
      expected("Ocado", "2026-11-08", o)));
  }
  // ---- Waitrose ------------------------------------------------------------------------------------------------------
  const wr = (n) => n.replace(/^Tesco Finest /, "No.1 ").replace(/^Tesco /, "Waitrose ");
  {
    const o = order(basket("w", wr), { fees: [["Delivery", 0]], discounts: [["myWaitrose offers", 230], ["Multibuy savings", 150]] });
    const rows = [`<p>Thank you for your order, ${SHOPPER.first}.</p>`, `<p>Order number: 812003344</p>`, `<p>7 November 2026</p>`,
      table([["Product", "Qty", "Price"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]), table(moneyRows(o, { subtotal: "Items", total: "Estimated total", free: "Free" }))];
    out.push(fixture("waitrose-1", "Waitrose", "Product | Qty | Price, 'Items' subtotal", { from: "Waitrose & Partners <customerservice@waitrose.co.uk>", subject: "Your Waitrose order confirmation", date: "Sat, 07 Nov 2026 10:00:00 +0000",
      html: page({ brand: "Waitrose", domain: "waitrose.com", rows }) }, expected("Waitrose", "2026-11-07", o)));
  }
  {
    const o = order(basket("w", wr, 31), { fees: [["Delivery charge", 500]], discounts: [["Offer savings", 120]] });
    const rows = [`<p>Here is your receipt.</p>`, `<p>Order number: 812003391</p>`, `<p>6 November 2026</p>`,
      table(o.lines.map((i) => [`${h(i.name)}<br /><span class="muted">${i.qty} x ${gbp(i.unit)}</span>`, gbp(i.line)])), table(moneyRows(o, { total: "Total paid" }))];
    out.push(fixture("waitrose-2", "Waitrose", "name with 'n x £unit' under it, line price right", { from: "Waitrose & Partners <customerservice@waitrose.co.uk>", subject: "Your Waitrose receipt", date: "Fri, 06 Nov 2026 19:00:00 +0000",
      html: page({ brand: "Waitrose", domain: "waitrose.com", rows }) }, expected("Waitrose", "2026-11-06", o)));
  }
  return out;
}
