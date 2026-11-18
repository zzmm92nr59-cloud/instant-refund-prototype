// High-street and online shops (made-up orders; see lib.mjs).
import { order, expected, page, table, moneyRows, moneyText, fixture, gbp, h, SHOPPER } from "./lib.mjs";

const img = (domain, n) => `<img src="https://images.${domain}/products/${n.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.jpg" alt="${h(n)}" width="120" height="150" />`;
// One product block as fashion shops lay it out: photo, name, then colour / size / qty lines, then the price.
const block = (domain, i, lines, priceHtml) => `<table width="100%" cellpadding="0" cellspacing="0"><tr><td width="130" valign="top">${img(domain, i.name)}</td><td valign="top">` +
  `<p style="font-weight:bold;margin:0">${h(i.name)}</p>${lines.map((l) => `<p style="margin:2px 0" class="muted">${h(l)}</p>`).join("")}<p style="margin:6px 0 0 0">${priceHtml}</p></td></tr></table>`;

export default function retail() {
  const out = [];
  const add = (id, sender, layout, mail, o, shop, date, extra) => out.push(fixture(id, sender, layout, mail, expected(shop, date, o, extra)));

  // ---- Amazon --------------------------------------------------------------------------------------------------------
  // Amazon's boxes: name (cut short with "..."), "Sold by", "Quantity: n", price split as "£" "24" "99".
  const amzPrice = (p) => `<span style="font-size:12px">£</span><span style="font-size:18px">${Math.floor(p / 100)}</span><span style="font-size:12px">${String(p % 100).padStart(2, "0")}</span>`;
  const amzItem = (i, seller = "Amazon") => `<table><tr><td>${img("amazon.co.uk", i.name)}</td><td><a href="https://www.amazon.co.uk/dp/B0EXAMPLE">${h(i.name)}</a><br /><span>Sold by</span>: <span>${seller}</span>${i.colour ? `<br /><span>Colour: ${h(i.colour)}</span>` : ""}<br /><span>Quantity: ${i.qty}</span><br />${amzPrice(i.unit)}</td></tr></table>`;
  const amzMoney = (o) => table([["Item(s) Subtotal:", gbp(o.subtotal)], ...o.fees.map(([l, p]) => [l + ":", gbp(p)]), ...o.discounts.map(([l, p]) => [l + ":", gbp(-p)]), ["<b>Order Total:</b>", `<b>${gbp(o.total)}</b>`]]);
  {
    const o = order([{ name: "Anker USB C Charger 20W, 312 Charger, PowerPort III", qty: 1, unit: 1299 }]);
    add("amazon-1", "Amazon", "one item, price split into pounds and pence", { from: "\"Amazon.co.uk\" <auto-confirm@amazon.co.uk>", subject: "Your Amazon.co.uk order of \"Anker USB C Charger 20W...\"", date: "Wed, 18 Nov 2026 08:12:00 +0000",
      html: page({ brand: "Amazon.co.uk", domain: "amazon.co.uk", rows: [`<h2>Hello ${SHOPPER.first},</h2>`, `<p>Thank you for shopping with us. We'll send a confirmation when your item ships.</p>`, `<p>Order #205-1234567-1234567</p>`, `<p>Placed on Wednesday, 18 November 2026</p>`, amzItem(o.lines[0]), amzMoney(o)] }) },
      o, "Amazon", "2026-11-18");
  }
  {
    const o = order([{ name: "Amazon Basics AA Batteries, 20 Pack", qty: 2, unit: 1149 }, { name: "Stanley Classic Legendary Thermos 1.0L", qty: 1, unit: 3499, colour: "Hammertone Green" },
      { name: "The Thursday Murder Club (Paperback)", qty: 1, unit: 499 }, { name: "Joseph Joseph Nest 9 Plus Food Storage Set", qty: 1, unit: 2450 }], { discounts: [["Promotion applied", 500]] });
    add("amazon-2", "Amazon", "four items, one with colour, promotion", { from: "\"Amazon.co.uk\" <auto-confirm@amazon.co.uk>", subject: "Your Amazon.co.uk order of \"Amazon Basics AA Batteries...\" and 3 more items.", date: "Tue, 17 Nov 2026 21:40:00 +0000",
      html: page({ brand: "Amazon.co.uk", domain: "amazon.co.uk", rows: [`<p>Hello ${SHOPPER.first},</p>`, `<p>Order #205-7654321-7654321</p>`, `<p>Placed on Tuesday, 17 November 2026</p>`, ...o.lines.map((i) => amzItem(i)), amzMoney(o)] }) },
      o, "Amazon", "2026-11-17");
  }
  {
    // Two shipments in one confirmation.
    const o = order([{ name: "Philips Sonicare Electric Toothbrush Heads, 4 Pack", qty: 1, unit: 2999 }, { name: "Lego Creator 3in1 Space Shuttle 31134", qty: 1, unit: 899 },
      { name: "Kindle Paperwhite Leather Cover", qty: 1, unit: 1999, colour: "Black" }], { fees: [["Postage & Packing", 0]] });
    add("amazon-3", "Amazon", "two shipments", { from: "\"Amazon.co.uk\" <auto-confirm@amazon.co.uk>", subject: "Your Amazon.co.uk order has been received", date: "Mon, 16 Nov 2026 17:00:00 +0000",
      html: page({ brand: "Amazon.co.uk", domain: "amazon.co.uk", rows: [`<p>Order #205-1112223-3334445</p>`, `<p>Placed on Monday, 16 November 2026</p>`, `<h3>Shipment 1 of 2: Arriving Wednesday</h3>`, amzItem(o.lines[0]), amzItem(o.lines[1]),
        `<h3>Shipment 2 of 2: Arriving Friday</h3>`, amzItem(o.lines[2], "CaseKing UK"), amzMoney(o)] }) }, o, "Amazon", "2026-11-16");
  }
  {
    // Subscribe & Save: a discount on each delivery.
    const o = order([{ name: "Finish Ultimate All in One Dishwasher Tablets, 80 Tablets", qty: 1, unit: 2200 }, { name: "Pampers Baby Wipes Fragrance Free, 12 x 52", qty: 2, unit: 1500 }], { discounts: [["Subscribe & Save discount", 260]] });
    add("amazon-4", "Amazon", "Subscribe & Save", { from: "\"Amazon Subscribe & Save\" <no-reply@amazon.co.uk>", subject: "Your Amazon.co.uk Subscribe & Save order", date: "Sun, 15 Nov 2026 06:00:00 +0000",
      html: page({ brand: "Amazon.co.uk", domain: "amazon.co.uk", rows: [`<p>Your Subscribe &amp; Save order has been placed.</p>`, `<p>Order #205-9998887-7776665</p>`, `<p>Placed on Sunday, 15 November 2026</p>`, ...o.lines.map((i) => amzItem(i)), amzMoney(o)] }) },
      o, "Amazon", "2026-11-15");
  }

  // ---- Fashion: ASOS, Nike, adidas, JD Sports, Zara, H&M, Next, lululemon, Primark, Very ---------------------------------------------
  {
    const o = order([{ name: "ASOS DESIGN oversized t-shirt in black", qty: 2, unit: 1200, c: "Black", s: "M" }, { name: "Topman slim fit jeans in mid wash", qty: 1, unit: 3500, c: "Mid Blue", s: "W32 L32" },
      { name: "New Balance 530 trainers in white", qty: 1, unit: 9500, c: "White", s: "UK 9" }], { fees: [["Delivery", 0]], discounts: [["Discount code STUDENT10", 1490]] });
    add("asos-1", "ASOS", "product blocks with colour/size/qty and price", { from: "ASOS <order_confirmation@asos.com>", subject: "Thanks for your order!", date: "Sat, 14 Nov 2026 22:00:00 +0000",
      html: page({ brand: "ASOS", domain: "asos.com", rows: [`<h1>Thanks for your order</h1>`, `<p>Order No.: 1074419928</p>`, `<p>Order date: 14 Nov, 2026</p>`,
        ...o.lines.map((i) => block("asos.com", i, [`Colour: ${i.c}`, `Size: ${i.s}`, `Qty: ${i.qty}`], gbp(i.line))), table(moneyRows(o, { subtotal: "Subtotal", free: "Free", total: "Total" }))] }) }, o, "ASOS", "2026-11-14");
  }
  {
    const o = order([{ name: "ASOS DESIGN puffer jacket in khaki", qty: 1, unit: 6000 }, { name: "COLLUSION unisex hoodie", qty: 1, unit: 2800 }], { fees: [["Standard Delivery", 450]] });
    add("asos-2", "ASOS", "plain text", { from: "ASOS <order_confirmation@asos.com>", subject: "Your ASOS order confirmation", date: "Fri, 13 Nov 2026 12:00:00 +0000",
      text: ["ASOS", "Thanks for your order", "Order No.: 1074420017", "Order date: 13 Nov, 2026", "", ...o.lines.map((i) => `${i.name}\nQty: ${i.qty}\n${gbp(i.line)}`), "", moneyText(o)].join("\n") }, o, "ASOS", "2026-11-13");
  }
  {
    const o = order([{ name: "Nike Air Force 1 '07", qty: 1, unit: 10999, s: "UK 8", c: "White/White" }, { name: "Nike Dri-FIT Running Shorts", qty: 2, unit: 2995, s: "M", c: "Black" }], { fees: [["Delivery/Shipping", 0]] });
    add("nike-1", "Nike", "product blocks, Style/Size, Delivery/Shipping free", { from: "Nike <nike@official.nike.com>", subject: "Thank You for Your Order (Order #C01234567890)", date: "Thu, 12 Nov 2026 19:00:00 +0000",
      html: page({ brand: "Nike", domain: "nike.com", rows: [`<h1>Thanks for your order, ${SHOPPER.first}</h1>`, `<p>Order Number: C01234567890</p>`, `<p>Order Date: 12 November 2026</p>`,
        ...o.lines.map((i) => block("nike.com", i, [`Size ${i.s}`, `Colour: ${i.c}`, `Qty ${i.qty}`], gbp(i.line))), table(moneyRows(o, { free: "Free" }))] }) }, o, "Nike", "2026-11-12");
  }
  {
    const o = order([{ name: "Nike Pegasus 41 Men's Road Running Shoes", qty: 1, unit: 12999 }], { fees: [["Shipping", 0]], discounts: [["Promo", 1950]] });
    add("nike-2", "Nike", "text", { from: "Nike <nike@official.nike.com>", subject: "Thanks for your order", date: "Wed, 11 Nov 2026 19:00:00 +0000",
      text: ["NIKE", "Order Number: C01234567999", "Order Date: 11 November 2026", "", ...o.lines.map((i) => `${i.name}\nSize UK 10\nQty ${i.qty}\n${gbp(i.line)}`), "", moneyText(o, { free: "Free" })].join("\n") }, o, "Nike", "2026-11-11");
  }
  {
    const o = order([{ name: "Samba OG Shoes", qty: 1, unit: 10000 }, { name: "Adicolor Classics 3-Stripes Tee", qty: 1, unit: 3000 }, { name: "Trefoil Crew Socks 3 Pairs", qty: 2, unit: 1400 }], { fees: [["Delivery", 0]] });
    add("adidas-1", "adidas", "Article / Size / Quantity table rows", { from: "adidas <adidas@ord.adidas.com>", subject: "Thank you for your order", date: "Tue, 10 Nov 2026 19:00:00 +0000",
      html: page({ brand: "adidas", domain: "adidas.co.uk", rows: [`<p>Order number: AUK12345678</p>`, `<p>Order date: 10.11.2026</p>`, `<p>10 November 2026</p>`,
        table([["Product", "Size", "Quantity", "Price"], ...o.lines.map((i) => [h(i.name), "M", String(i.qty), gbp(i.line)])]), table(moneyRows(o, { free: "Free" }))] }) }, o, "adidas", "2026-11-10");
  }
  {
    const o = order([{ name: "Ultraboost 5 Running Shoes", qty: 1, unit: 16000 }, { name: "Essentials Fleece Hoodie", qty: 1, unit: 5000 }], { fees: [["Delivery", 395]], discounts: [["adiClub discount", 2100]] });
    add("adidas-2", "adidas", "text", { from: "adidas <adidas@ord.adidas.com>", subject: "Your adidas order confirmation", date: "Mon, 09 Nov 2026 19:00:00 +0000",
      text: ["adidas", "Order number: AUK12345700", "9 November 2026", "", ...o.lines.map((i) => `${i.name} x ${i.qty} ${gbp(i.line)}`), "", moneyText(o)].join("\n") }, o, "adidas", "2026-11-09");
  }
  {
    const o = order([{ name: "The North Face Men's Nuptse Jacket", qty: 1, unit: 27000 }, { name: "Nike Club Fleece Joggers", qty: 1, unit: 5000 }, { name: "Nike Everyday Cushioned Socks (3 Pack)", qty: 1, unit: 1400 }], { fees: [["Delivery", 399]] });
    add("jd-sports-1", "JD Sports", "product blocks", { from: "JD Sports <orders@jdsports.co.uk>", subject: "Your JD order confirmation", date: "Sun, 08 Nov 2026 19:00:00 +0000",
      html: page({ brand: "JD Sports", domain: "jdsports.co.uk", rows: [`<p>Thanks for your order, ${SHOPPER.first}!</p>`, `<p>Order number: 102938475</p>`, `<p>8 November 2026</p>`,
        ...o.lines.map((i) => block("jdsports.co.uk", i, ["Size: L", `Quantity: ${i.qty}`], gbp(i.line))), table(moneyRows(o))] }) }, o, "JD Sports", "2026-11-08");
  }
  {
    const o = order([{ name: "adidas Originals Gazelle", qty: 1, unit: 9000 }, { name: "JD Sports Gift Bag", qty: 1, unit: 100 }], { fees: [["Click & Collect", 0]] });
    add("jd-sports-2", "JD Sports", "text with click & collect", { from: "JD Sports <orders@jdsports.co.uk>", subject: "Thanks for your JD order", date: "Sat, 07 Nov 2026 19:00:00 +0000",
      text: ["JD", "Order number: 102938490", "7 November 2026", "", "ITEM QTY PRICE", ...o.lines.map((i) => `${i.name} | ${i.qty} | ${gbp(i.line)}`), "", moneyText(o, { free: "FREE" })].join("\n") }, o, "JD Sports", "2026-11-07");
  }
  {
    const o = order([{ name: "WOOL BLEND COAT", qty: 1, unit: 9999 }, { name: "STRAIGHT FIT JEANS", qty: 1, unit: 2999 }, { name: "RIBBED KNIT SWEATER", qty: 1, unit: 3599 }], { fees: [["Shipping", 395]] });
    add("zara-1", "Zara", "capitals product names, ref and colour lines", { from: "ZARA <noreply@zara.com>", subject: "Thank you for your purchase", date: "Fri, 06 Nov 2026 19:00:00 +0000",
      html: page({ brand: "ZARA", domain: "zara.com", rows: [`<p>ORDER NO. 52419933771</p>`, `<p>6 November 2026</p>`, ...o.lines.map((i) => block("zara.com", i, ["REF. 2753/010/800", "Colour: Black", "Size: M", `Units: ${i.qty}`], gbp(i.line))),
        table(moneyRows(o, { total: "TOTAL", subtotal: "SUBTOTAL" }))] }) }, o, "Zara", "2026-11-06");
  }
  {
    const o = order([{ name: "OVERSIZE HOODIE", qty: 2, unit: 2599 }, { name: "LEATHER EFFECT BELT", qty: 1, unit: 1599 }], { fees: [["Store delivery", 0]] });
    add("zara-2", "Zara", "text, units", { from: "ZARA <noreply@zara.com>", subject: "Your ZARA order", date: "Thu, 05 Nov 2026 19:00:00 +0000",
      text: ["ZARA", "ORDER NO. 52419933790", "5 November 2026", "", ...o.lines.map((i) => `${i.name}\n${i.qty} unit${i.qty > 1 ? "s" : ""}\n${gbp(i.line)}`), "", moneyText(o, { free: "FREE", total: "TOTAL" })].join("\n") }, o, "Zara", "2026-11-05");
  }
  {
    const o = order([{ name: "Relaxed Fit Hoodie", qty: 1, unit: 1999 }, { name: "3-pack Cotton T-shirts", qty: 1, unit: 1499 }, { name: "Slim Jeans", qty: 1, unit: 2499 }], { fees: [["Delivery", 399]], discounts: [["Member offer", 600]] });
    add("hm-1", "H&M", "Art. no. lines, qty and price", { from: "H&M <info@email.hm.com>", subject: "Order confirmation", date: "Wed, 04 Nov 2026 19:00:00 +0000",
      html: page({ brand: "H&M", domain: "hm.com", rows: [`<p>Thank you for your order!</p>`, `<p>Order number: 60012345678</p>`, `<p>Order date: 04/11/2026</p>`,
        ...o.lines.map((i) => block("hm.com", i, ["Art. no. 0970819001", "Size: M", `Quantity: ${i.qty}`], gbp(i.line))), table(moneyRows(o, { subtotal: "Order value" }))] }) }, o, "H&M", "2026-11-04");
  }
  {
    const o = order([{ name: "Puffer Jacket", qty: 1, unit: 4999 }], { fees: [["Delivery", 0]] });
    add("hm-2", "H&M", "text", { from: "H&M <info@email.hm.com>", subject: "Your H&M order confirmation", date: "Tue, 03 Nov 2026 19:00:00 +0000",
      text: ["H&M", "Order number: 60012345690", "Order date: 03/11/2026", "", "Puffer Jacket", "Art. no. 1011234002", "Quantity: 1", "£49.99", "", moneyText(o, { free: "Free", subtotal: "Order value" })].join("\n") }, o, "H&M", "2026-11-03");
  }
  {
    const o = order([{ name: "Navy Crew Neck Jumper", qty: 1, unit: 3000 }, { name: "Stretch Slim Fit Chinos", qty: 2, unit: 2600 }, { name: "Oxford Shirt 2 Pack", qty: 1, unit: 3800 }], { fees: [["Delivery", 499]] });
    add("next-1", "Next", "Item / Qty / Price columns, item numbers", { from: "Next <orders@next.co.uk>", subject: "Your Next order confirmation", date: "Mon, 02 Nov 2026 19:00:00 +0000",
      html: page({ brand: "Next", domain: "next.co.uk", rows: [`<p>Order number: X12345678</p>`, `<p>2 November 2026</p>`, table([["Description", "Size", "Qty", "Price"], ...o.lines.map((i) => [`${h(i.name)}<br /><small>Item No. 123-456</small>`, "M", String(i.qty), gbp(i.line)])]),
        table(moneyRows(o, { subtotal: "Goods total", total: "Order total" }))] }) }, o, "Next", "2026-11-02");
  }
  {
    const o = order([{ name: "Faux Fur Lined Slippers", qty: 1, unit: 2400 }, { name: "Cosy Supersoft Socks 5 Pack", qty: 1, unit: 1400 }], { fees: [["Delivery to store", 0]] });
    add("next-2", "Next", "text", { from: "Next <orders@next.co.uk>", subject: "Thank you for your Next order", date: "Sun, 01 Nov 2026 19:00:00 +0000",
      text: ["NEXT", "Order number: X12345700", "1 November 2026", "", ...o.lines.map((i) => `${i.qty} x ${i.name} @ ${gbp(i.unit)} = ${gbp(i.line)}`), "", moneyText(o, { free: "FREE", subtotal: "Goods total", total: "Order total" })].join("\n") }, o, "Next", "2026-11-01");
  }
  {
    const o = order([{ name: "Align High-Rise Pant 25\"", qty: 1, unit: 9800 }, { name: "Define Jacket Nulu", qty: 1, unit: 11800 }, { name: "Everywhere Belt Bag 1L", qty: 1, unit: 3800 }], { fees: [["Shipping", 0]] });
    add("lululemon-1", "lululemon", "product blocks", { from: "lululemon <orders@e.lululemon.com>", subject: "Thanks for your order", date: "Sat, 31 Oct 2026 19:00:00 +0000",
      html: page({ brand: "lululemon", domain: "lululemon.co.uk", rows: [`<p>Order number: UK1234567890</p>`, `<p>Order date: 31 October 2026</p>`, ...o.lines.map((i) => block("lululemon.co.uk", i, ["Colour: Black", "Size: 8", `Quantity: ${i.qty}`], gbp(i.line))),
        table(moneyRows(o, { free: "Free" }))] }) }, o, "lululemon", "2026-10-31");
  }
  {
    const o = order([{ name: "Swiftly Tech Short-Sleeve Shirt 2.0", qty: 2, unit: 6800 }], { fees: [["Shipping", 0]] });
    add("lululemon-2", "lululemon", "text with qty 2 and unit price", { from: "lululemon <orders@e.lululemon.com>", subject: "Your lululemon order confirmation", date: "Fri, 30 Oct 2026 19:00:00 +0000",
      text: ["lululemon", "Order number: UK1234567901", "30 October 2026", "", "Swiftly Tech Short-Sleeve Shirt 2.0", "Size: M", "Qty: 2", "£68.00 each", "£136.00", "", moneyText(o, { free: "Free" })].join("\n") }, o, "lululemon", "2026-10-30");
  }
  {
    const o = order([{ name: "Fleece Pyjama Set", qty: 1, unit: 1400 }, { name: "Chunky Knit Jumper", qty: 1, unit: 1600 }, { name: "Ankle Socks 5 Pack", qty: 2, unit: 350 }], { fees: [["Click & Collect", 0]] });
    add("primark-1", "Primark", "click & collect reservation", { from: "Primark <noreply@primark.com>", subject: "Your Primark Click & Collect order is confirmed", date: "Thu, 29 Oct 2026 19:00:00 +0000",
      html: page({ brand: "Primark", domain: "primark.com", rows: [`<p>Order number: PK-88123</p>`, `<p>Ordered on 29 October 2026</p>`, `<p>Collect from Primark Leeds Briggate</p>`, table([["Item", "Qty", "Price"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]),
        table(moneyRows(o, { total: "Total to pay in store", free: "Free" }))] }) }, o, "Primark", "2026-10-29");
  }
  {
    const o = order([{ name: "Stitch Hoodie", qty: 1, unit: 1800 }, { name: "Cosy Slippers", qty: 1, unit: 800 }], { fees: [["Click & Collect", 0]] });
    add("primark-2", "Primark", "text", { from: "Primark <noreply@primark.com>", subject: "Thanks for your Primark order", date: "Wed, 28 Oct 2026 19:00:00 +0000",
      text: ["Primark", "Order number: PK-88190", "28 October 2026", "", ...o.lines.map((i) => `${i.name} (x${i.qty}) ${gbp(i.line)}`), "", moneyText(o, { free: "Free" })].join("\n") }, o, "Primark", "2026-10-28");
  }
  {
    const o = order([{ name: "Ninja AF100UK Air Fryer", qty: 1, unit: 9999 }, { name: "Very Home Cotton Rich Towel Bale", qty: 1, unit: 3000 }], { fees: [["Delivery", 399]] });
    add("very-1", "Very", "table", { from: "Very <orders@very.co.uk>", subject: "Your Very order confirmation", date: "Tue, 27 Oct 2026 19:00:00 +0000",
      html: page({ brand: "Very", domain: "very.co.uk", rows: [`<p>Order number: 9988776655</p>`, `<p>27 October 2026</p>`, table([["Item", "Qty", "Price"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]), table(moneyRows(o))] }) }, o, "Very", "2026-10-27");
  }
  {
    const o = order([{ name: "Samsung Galaxy Buds FE", qty: 1, unit: 6900 }], { fees: [["Delivery", 0]] });
    add("very-2", "Very", "text", { from: "Very <orders@very.co.uk>", subject: "Thanks for your order", date: "Mon, 26 Oct 2026 19:00:00 +0000",
      text: ["Very", "Order number: 9988776699", "26 October 2026", "", "Samsung Galaxy Buds FE", "Quantity: 1", "£69.00", "", moneyText(o, { free: "FREE" })].join("\n") }, o, "Very", "2026-10-26");
  }

  // ---- Department stores, health & beauty --------------------------------------------------------------------------------------
  {
    const o = order([{ name: "Pure Cotton Slim Fit Shirt", qty: 1, unit: 2500 }, { name: "Supersoft Fleece Throw", qty: 1, unit: 3500 }, { name: "Percy Pig Fruit Gums 170g", qty: 3, unit: 125 }], { fees: [["Delivery", 450]] });
    add("marks-and-spencer-1", "M&S", "product blocks", { from: "M&S <noreply@marksandspencer.com>", subject: "Thank you for your M&S order", date: "Sun, 25 Oct 2026 19:00:00 +0000",
      html: page({ brand: "M&S", domain: "marksandspencer.com", rows: [`<p>Order number: 1234567890ABC</p>`, `<p>25 October 2026</p>`, ...o.lines.map((i) => block("marksandspencer.com", i, [`Qty: ${i.qty}`], gbp(i.line))), table(moneyRows(o))] }) },
      o, "M&S", "2026-10-25");
  }
  {
    const o = order([{ name: "Autograph Cashmere Jumper", qty: 1, unit: 9900 }], { fees: [["Collect in store", 0]] });
    add("marks-and-spencer-2", "M&S", "text", { from: "M&S <noreply@marksandspencer.com>", subject: "Your M&S order confirmation", date: "Sat, 24 Oct 2026 19:00:00 +0000",
      text: ["M&S", "Order number: 1234567890ABD", "24 October 2026", "", "Autograph Cashmere Jumper", "Colour: Navy Size: M", "Qty: 1", "£99.00", "", moneyText(o, { free: "FREE" })].join("\n") }, o, "M&S", "2026-10-24");
  }
  {
    const o = order([{ name: "John Lewis ANYDAY Duvet, 10.5 Tog, Double", qty: 1, unit: 4000 }, { name: "Le Creuset Signature Cast Iron Round Casserole, 24cm", qty: 1, unit: 27500 }, { name: "John Lewis Egyptian Cotton Towel", qty: 4, unit: 1800 }],
      { fees: [["Delivery", 0]] });
    add("john-lewis-1", "John Lewis", "table with product codes", { from: "John Lewis <noreply@johnlewis.co.uk>", subject: "Thank you for your order", date: "Fri, 23 Oct 2026 19:00:00 +0000",
      html: page({ brand: "John Lewis", domain: "johnlewis.com", rows: [`<p>Order number: 1009988776</p>`, `<p>Order date: 23 October 2026</p>`, table([["Product", "Quantity", "Price"], ...o.lines.map((i) => [`${h(i.name)}<br /><span class="muted">Product code: 81234567</span>`, String(i.qty), gbp(i.line)])]),
        table(moneyRows(o, { free: "Free", total: "Order total" }))] }) }, o, "John Lewis", "2026-10-23");
  }
  {
    const o = order([{ name: "Apple AirPods Pro (2nd generation)", qty: 1, unit: 22900 }, { name: "John Lewis 2 Year Guarantee", qty: 1, unit: 0 }], { fees: [["Click & collect", 0]] });
    add("john-lewis-2", "John Lewis", "text, free guarantee line", { from: "John Lewis <noreply@johnlewis.co.uk>", subject: "Your John Lewis order confirmation", date: "Thu, 22 Oct 2026 19:00:00 +0000",
      text: ["John Lewis & Partners", "Order number: 1009988799", "22 October 2026", "", ...o.lines.map((i) => `${i.name}\nQuantity: ${i.qty}\n${gbp(i.line)}`), "", moneyText(o, { free: "Free" })].join("\n") }, o, "John Lewis", "2026-10-22");
  }
  {
    const o = order([{ name: "CeraVe Moisturising Cream 454g", qty: 1, unit: 1700 }, { name: "No7 Protect & Perfect Intense Advanced Serum 30ml", qty: 1, unit: 3995 }, { name: "Boots Cucumber Facial Wipes 25s", qty: 3, unit: 150 }],
      { fees: [["Standard delivery", 450]], discounts: [["3 for 2 on selected skincare", 150]] });
    add("boots-1", "Boots", "table, 3 for 2 offer", { from: "Boots <noreply@boots.com>", subject: "Thanks for your Boots order", date: "Wed, 21 Oct 2026 19:00:00 +0000",
      html: page({ brand: "Boots", domain: "boots.com", rows: [`<p>Order number: 9876543210</p>`, `<p>21 October 2026</p>`, table([["Item", "Qty", "Total"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]), table(moneyRows(o))] }) },
      o, "Boots", "2026-10-21");
  }
  {
    const o = order([{ name: "Soltan Protect & Moisturise Lotion SPF30 200ml", qty: 2, unit: 600 }], { fees: [["Click & Collect", 0]] });
    add("boots-2", "Boots", "text", { from: "Boots <noreply@boots.com>", subject: "Your Boots order confirmation", date: "Tue, 20 Oct 2026 19:00:00 +0000",
      text: ["Boots", "Order number: 9876543299", "20 October 2026", "", "2 x Soltan Protect & Moisturise Lotion SPF30 200ml £12.00", "", moneyText(o, { free: "Free" })].join("\n") }, o, "Boots", "2026-10-20");
  }
  {
    const o = order([{ name: "The Ordinary Niacinamide 10% + Zinc 1% 30ml", qty: 2, unit: 590 }, { name: "Superdrug Vitamin E Moisture Cream 50ml", qty: 1, unit: 399 }, { name: "Maybelline Lash Sensational Mascara", qty: 1, unit: 1099 }], { fees: [["Delivery", 399]] });
    add("superdrug-1", "Superdrug", "table", { from: "Superdrug <noreply@superdrug.com>", subject: "Your Superdrug order confirmation", date: "Mon, 19 Oct 2026 19:00:00 +0000",
      html: page({ brand: "Superdrug", domain: "superdrug.com", rows: [`<p>Order number: SD1122334455</p>`, `<p>19 October 2026</p>`, table([["Product", "Qty", "Price"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]), table(moneyRows(o))] }) },
      o, "Superdrug", "2026-10-19");
  }
  {
    const o = order([{ name: "Superdrug Vitamin C Serum 30ml", qty: 1, unit: 599 }, { name: "Nivea Men Sensitive Shaving Gel 200ml", qty: 2, unit: 400 }], { fees: [["Delivery", 0]] });
    add("superdrug-2", "Superdrug", "text", { from: "Superdrug <noreply@superdrug.com>", subject: "Thanks for your Superdrug order", date: "Sun, 18 Oct 2026 19:00:00 +0000",
      text: ["Superdrug", "Order number: SD1122334499", "18 October 2026", "", ...o.lines.map((i) => `${i.name} Qty: ${i.qty} ${gbp(i.line)}`), "", moneyText(o, { free: "FREE" })].join("\n") }, o, "Superdrug", "2026-10-18");
  }

  // ---- Electricals and home --------------------------------------------------------------------------------------------------
  {
    const o = order([{ name: "Russell Hobbs 26200 Brushed Steel Kettle", qty: 1, unit: 3500 }, { name: "Tower 4 Slice Toaster - Black", qty: 1, unit: 3000 }, { name: "Duracell Plus AA Batteries - Pack of 12", qty: 1, unit: 900 }],
      { fees: [["Delivery", 395]] });
    add("argos-1", "Argos", "catalogue numbers, Qty | Price", { from: "Argos <orders@argos.co.uk>", subject: "Thanks for your order - Argos", date: "Sat, 17 Oct 2026 19:00:00 +0000",
      html: page({ brand: "Argos", domain: "argos.co.uk", rows: [`<p>Order number: AO12345678</p>`, `<p>17 October 2026</p>`, table([["Product", "Qty", "Price"], ...o.lines.map((i) => [`${h(i.name)}<br />Cat. no. 123/4567`, String(i.qty), gbp(i.line)])]), table(moneyRows(o))] }) },
      o, "Argos", "2026-10-17");
  }
  {
    const o = order([{ name: "Lego Star Wars Millennium Falcon 75375", qty: 1, unit: 7499 }], { fees: [["Fast Track collection", 0]] });
    add("argos-2", "Argos", "text, collection", { from: "Argos <orders@argos.co.uk>", subject: "Your Argos order confirmation", date: "Fri, 16 Oct 2026 19:00:00 +0000",
      text: ["Argos", "Order number: AO12345700", "16 October 2026", "", "Lego Star Wars Millennium Falcon 75375", "Qty: 1", "£74.99", "", moneyText(o, { free: "Free" })].join("\n") }, o, "Argos", "2026-10-16");
  }
  {
    const o = order([{ name: "SAMSUNG UE55DU7100KXXU 55\" Smart 4K Ultra HD HDR LED TV", qty: 1, unit: 39900 }, { name: "Care & Repair - 3 years", qty: 1, unit: 7999 }, { name: "LOGIK LHDMI15 High Speed HDMI Cable - 1.5 m", qty: 1, unit: 999 }],
      { fees: [["Delivery", 0], ["Installation", 2500]] });
    add("currys-1", "Currys", "big ticket with cover plan and installation", { from: "Currys <orders@currys.co.uk>", subject: "Thanks for your order", date: "Thu, 15 Oct 2026 19:00:00 +0000",
      html: page({ brand: "Currys", domain: "currys.co.uk", rows: [`<p>Order number: 4400112233</p>`, `<p>15 October 2026</p>`, table([["Item", "Qty", "Price"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]), table(moneyRows(o, { free: "FREE" }))] }) },
      o, "Currys", "2026-10-15");
  }
  {
    const o = order([{ name: "APPLE iPad 10.9\" (2022) - 64 GB, Blue", qty: 1, unit: 32900 }], { fees: [["Delivery", 0]] });
    add("currys-2", "Currys", "text", { from: "Currys <orders@currys.co.uk>", subject: "Your Currys order confirmation", date: "Wed, 14 Oct 2026 19:00:00 +0000",
      text: ["Currys", "Order number: 4400112299", "14 October 2026", "", "1 x APPLE iPad 10.9\" (2022) - 64 GB, Blue £329.00", "", moneyText(o, { free: "FREE" })].join("\n") }, o, "Currys", "2026-10-14");
  }
  {
    const o = order([{ name: "BILLY Bookcase, white, 80x28x202 cm", qty: 2, unit: 5000 }, { name: "KALLAX Shelving unit, white, 77x147 cm", qty: 1, unit: 6000 }, { name: "FÄRGKLAR Plate, matt dark turquoise, 26 cm", qty: 6, unit: 300 }, { name: "SKURUP Wall lamp, black", qty: 1, unit: 1500 }],
      { fees: [["Delivery", 4500]] });
    add("ikea-1", "IKEA", "article numbers, unit and line price", { from: "IKEA <no-reply@order.ikea.com>", subject: "Your IKEA order confirmation", date: "Tue, 13 Oct 2026 19:00:00 +0000",
      html: page({ brand: "IKEA", domain: "ikea.com", rows: [`<p>Order number: 1234567890</p>`, `<p>Order date: 13/10/2026</p>`, table([["Product", "Quantity", "Unit price", "Price"], ...o.lines.map((i) => [`${h(i.name)}<br />Article number: 002.638.50`, String(i.qty), gbp(i.unit), gbp(i.line)])]),
        table(moneyRows(o, { subtotal: "Products", total: "Total incl. VAT" }))] }) }, o, "IKEA", "2026-10-13");
  }
  {
    const o = order([{ name: "LACK Side table, black-brown, 55x55 cm", qty: 1, unit: 1200 }, { name: "IKEA 365+ Glass, clear glass, 30 cl", qty: 4, unit: 150 }], { fees: [["Click & Collect", 500]] });
    add("ikea-2", "IKEA", "text", { from: "IKEA <no-reply@order.ikea.com>", subject: "Thank you for your IKEA order", date: "Mon, 12 Oct 2026 19:00:00 +0000",
      text: ["IKEA", "Order number: 1234567900", "12 October 2026", "", ...o.lines.map((i) => `${i.name}\n${i.qty} x ${gbp(i.unit)}\n${gbp(i.line)}`), "", moneyText(o)].join("\n") }, o, "IKEA", "2026-10-12");
  }
  {
    const o = order([{ name: "Makita DHP482Z 18V LXT Combi Drill Body Only", qty: 1, unit: 6999 }, { name: "Timco Classic Multi-Purpose Screws 200 Pack", qty: 2, unit: 899 }], { fees: [["Click & Collect", 0]] });
    add("screwfix-1", "Screwfix", "table", { from: "Screwfix <noreply@screwfix.com>", subject: "Screwfix order confirmation", date: "Sun, 11 Oct 2026 19:00:00 +0000",
      html: page({ brand: "Screwfix", domain: "screwfix.com", rows: [`<p>Order number: SF12345678</p>`, `<p>11 October 2026</p>`, table([["Product", "Qty", "Price"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]), table(moneyRows(o, { free: "Free" }))] }) },
      o, "Screwfix", "2026-10-11");
  }
  {
    const o = order([{ name: "Intermezzo by Sally Rooney (Hardback)", qty: 1, unit: 2000 }, { name: "The Very Hungry Caterpillar (Board book)", qty: 2, unit: 699 }], { fees: [["Delivery", 0]] });
    add("waterstones-1", "Waterstones", "text", { from: "Waterstones <orders@waterstones.com>", subject: "Your Waterstones order confirmation", date: "Sat, 10 Oct 2026 19:00:00 +0000",
      text: ["Waterstones", "Order number: W12345678", "10 October 2026", "", ...o.lines.map((i) => `${i.name}  Qty ${i.qty}  ${gbp(i.line)}`), "", moneyText(o, { free: "FREE" })].join("\n") }, o, "Waterstones", "2026-10-10");
  }

  // ---- Nespresso -----------------------------------------------------------------------------------------------------
  {
    // Machine + capsules: capsules sold by the sleeve of 10, price per sleeve and line total.
    const o = order([{ name: "Vertuo Pop Coconut White", qty: 1, unit: 9900 }, { name: "Stormio", qty: 5, unit: 525 }, { name: "Melozio", qty: 5, unit: 525 }, { name: "Ispirazione Roma", qty: 3, unit: 450 }],
      { fees: [["Delivery", 0]] });
    add("nespresso-1", "Nespresso", "machine and capsule sleeves, quantity in sleeves", { from: "Nespresso <noreply@nespresso.com>", subject: "Your Nespresso order confirmation", date: "Fri, 09 Oct 2026 19:00:00 +0000",
      html: page({ brand: "Nespresso", domain: "nespresso.com", rows: [`<p>Dear ${SHOPPER.first},</p><p>Thank you for your order.</p>`, `<p>Order number: 21234567</p>`, `<p>Order date: 09/10/2026</p>`,
        table([["Product", "Quantity", "Unit price", "Total"], ...o.lines.map((i) => [h(i.name), i.name.startsWith("Vertuo") ? String(i.qty) : `${i.qty} sleeves (${i.qty * 10} capsules)`, gbp(i.unit), gbp(i.line)])]),
        table(moneyRows(o, { subtotal: "Sub-total", total: "TOTAL (VAT incl.)", free: "Free" }))] }) }, o, "Nespresso", "2026-10-09");
  }
  {
    // Capsules only, a name and the price split into blocks per product (the kind of layout behind the "no item, no price" case).
    const o = order([{ name: "Double Espresso Chiaro", qty: 10, unit: 530 }, { name: "Altissio", qty: 5, unit: 525 }, { name: "Barista Creations Vanilla Eclair", qty: 5, unit: 565 }], { fees: [["Delivery", 0]] });
    const blk = (i) => `<table width="100%"><tr><td><b>${h(i.name)}</b></td></tr><tr><td>Quantity</td><td align="right">${i.qty}</td></tr><tr><td>Price</td><td align="right">${gbp(i.unit)}</td></tr><tr><td>Total</td><td align="right">${gbp(i.line)}</td></tr></table>`;
    add("nespresso-2", "Nespresso", "one small table per capsule: Quantity / Price / Total rows", { from: "Nespresso <noreply@nespresso.com>", subject: "Thank you for your Nespresso order", date: "Thu, 08 Oct 2026 19:00:00 +0000",
      html: page({ brand: "Nespresso", domain: "nespresso.com", rows: [`<p>Order number: 21234600</p>`, `<p>8 October 2026</p>`, ...o.lines.map(blk), table([["Sub-total", gbp(o.subtotal)], ["Delivery", "Free"], ["TOTAL (VAT incl.)", gbp(o.total)]])] }) },
      o, "Nespresso", "2026-10-08");
  }
  {
    // A summary only: the email names no items, just how many and the total.
    const o = order([{ name: "(not listed)", qty: 3, unit: 2100 }]);
    const exp = { ...expected("Nespresso", "2026-10-07", o), items: [], itemCount: 3 };
    out.push(fixture("nespresso-3", "Nespresso", "summary only: 'Your order of 3 items', no item list", { from: "Nespresso <noreply@nespresso.com>", subject: "We have received your Nespresso order", date: "Wed, 07 Oct 2026 19:00:00 +0000",
      html: page({ brand: "Nespresso", domain: "nespresso.com", rows: [`<p>Dear ${SHOPPER.first},</p><p>We have received your order of 3 items and are preparing it.</p>`, `<p>Order number: 21234655</p>`, `<p>7 October 2026</p>`, table([["Order total", gbp(o.total)]]),
        `<p><a href="https://www.nespresso.com/uk/en/myaccount/orders">View your order details</a></p>`] }) }, exp));
  }

  // ---- Marketplaces ------------------------------------------------------------------------------------------------------
  {
    const o = order([{ name: "Vintage Levi's 501 Jeans W32 L30", qty: 1, unit: 3500 }], { fees: [["Postage", 395]] });
    add("ebay-1", "eBay", "one item, seller, postage", { from: "eBay <ebay@ebay.co.uk>", subject: "Order confirmed: Vintage Levi's 501 Jeans W32 L30", date: "Tue, 06 Oct 2026 19:00:00 +0000",
      html: page({ brand: "eBay", domain: "ebay.co.uk", rows: [`<h1>Order confirmed</h1>`, `<p>Order number: 12-34567-89012</p>`, `<p>6 Oct 2026</p>`, block("ebay.co.uk", o.lines[0], ["Seller: retro_threads_uk", `Quantity: 1`], `Item price: ${gbp(3500)}`),
        table([["Subtotal", gbp(o.subtotal)], ["Postage", gbp(395)], ["Order total", gbp(o.total)]])] }) }, o, "eBay", "2026-10-06");
  }
  {
    const o = order([{ name: "Apple iPhone 13 128GB Midnight - Refurbished", qty: 1, unit: 32999 }, { name: "Tempered Glass Screen Protector x2", qty: 2, unit: 499 }], { fees: [["Postage", 0]] });
    add("ebay-2", "eBay", "text with two items", { from: "eBay <ebay@ebay.co.uk>", subject: "Order confirmed", date: "Mon, 05 Oct 2026 19:00:00 +0000",
      text: ["eBay", "Order confirmed", "Order number: 12-34567-89100", "5 Oct 2026", "", ...o.lines.map((i) => `${i.name}\nQuantity: ${i.qty}\nItem price: ${gbp(i.line)}`), "", moneyText(o, { free: "Free", total: "Order total" })].join("\n") }, o, "eBay", "2026-10-05");
  }
  {
    const o = order([{ name: "Personalised Leather Keyring", qty: 1, unit: 1250 }, { name: "Hand Poured Soy Candle - Fig & Cassis", qty: 2, unit: 1600 }], { fees: [["Delivery", 350]] });
    add("etsy-1", "Etsy", "transaction with shop name", { from: "Etsy Transactions <transaction@etsy.com>", subject: "Your Etsy Purchase from HollowOakCrafts (3012345678)", date: "Sun, 04 Oct 2026 19:00:00 +0000",
      html: page({ brand: "Etsy", domain: "etsy.com", rows: [`<p>Hi ${SHOPPER.first}, thanks for your order from HollowOakCrafts.</p>`, `<p>Order number: 3012345678</p>`, `<p>4 October 2026</p>`,
        ...o.lines.map((i) => block("etsy.com", i, [`Quantity: ${i.qty}`], gbp(i.line))), table(moneyRows(o, { subtotal: "Item total", total: "Order total" }))] }) }, o, "Etsy", "2026-10-04");
  }
  {
    const o = order([{ name: "Custom Pet Portrait Digital Download", qty: 1, unit: 2500 }], { discounts: [["Shop discount", 250]] });
    add("etsy-2", "Etsy", "text", { from: "Etsy Transactions <transaction@etsy.com>", subject: "Your Etsy Purchase from PawPrintStudio (3012345700)", date: "Sat, 03 Oct 2026 19:00:00 +0000",
      text: ["Etsy", "Order number: 3012345700", "3 October 2026", "", "Custom Pet Portrait Digital Download", "Quantity: 1", "Price: £25.00", "", moneyText(o, { subtotal: "Item total", total: "Order total" })].join("\n") }, o, "Etsy", "2026-10-03");
  }
  {
    const o = order([{ name: "Barbour Wax Jacket Size M", qty: 1, unit: 4500 }], { fees: [["Buyer Protection fee", 295], ["Postage", 289]] });
    add("vinted-1", "Vinted", "item, buyer protection, postage", { from: "Vinted <no-reply@vinted.co.uk>", subject: "Your receipt for Barbour Wax Jacket Size M", date: "Fri, 02 Oct 2026 19:00:00 +0000",
      html: page({ brand: "Vinted", domain: "vinted.co.uk", rows: [`<p>Thanks for your purchase!</p>`, `<p>Transaction ID: 9123456789</p>`, `<p>2 Oct 2026</p>`, table([["Barbour Wax Jacket Size M", gbp(4500)], ["Buyer Protection fee", gbp(295)], ["Postage", gbp(289)], ["Total", gbp(o.total)]])] }) },
      o, "Vinted", "2026-10-02");
  }
  {
    const o = order([{ name: "Zara Knitted Cardigan", qty: 1, unit: 1200 }, { name: "Nike Tech Fleece Joggers", qty: 1, unit: 3000 }], { fees: [["Buyer Protection fee", 280], ["Postage", 289]] });
    add("vinted-2", "Vinted", "bundle in text", { from: "Vinted <no-reply@vinted.co.uk>", subject: "Your Vinted receipt", date: "Thu, 01 Oct 2026 19:00:00 +0000",
      text: ["Vinted", "Receipt", "Transaction ID: 9123456800", "1 Oct 2026", "", "Bundle", ...o.lines.map((i) => `${i.name} ${gbp(i.line)}`), "Buyer Protection fee " + gbp(280), "Postage " + gbp(289), "Total " + gbp(o.total)].join("\n") }, o, "Vinted", "2026-10-01");
  }

  // ---- Shopify-made shops (sent through Shopify's email) -----------------------------------------------------------------------------
  const shopify = (id, shop, domain, items, opts, date, rfc) => {
    const o = order(items, opts);
    const rows = [`<h2>${h(shop)}</h2>`, `<p>Order #${1000 + out.length}</p>`, `<h1>Thank you for your purchase!</h1>`, `<p>Hi ${SHOPPER.first}, we're getting your order ready to be shipped.</p>`, `<h3>Order summary</h3>`,
      table(o.lines.map((i) => [img(domain, i.name), `<span>${h(i.name)} &times; ${i.qty}</span>${i.v ? `<br /><span class="muted">${h(i.v)}</span>` : ""}`, { td: `<strong>${gbp(i.line)}</strong>`, attrs: 'align="right"' }])),
      table(moneyRows(o, { subtotal: "Subtotal", free: "Free" }).map(([a, b]) => [a, { td: b, attrs: 'align="right"' }])), `<p>If you have any questions, reply to this email or contact us at hello@${domain}</p>`];
    const text = [shop, `Order #${1000 + out.length}`, "Thank you for your purchase!", "", "Order summary", ...o.lines.map((i) => `${i.name} × ${i.qty}${i.v ? "\n" + i.v : ""}\n${gbp(i.line)}`), "", moneyText(o, { free: "Free" }, "\n")].join("\n");
    out.push(fixture(id, "Shopify store", "Shopify order confirmation: name × qty, variant, price", { from: `${shop} <store+12345678@t.shopifyemail.com>`, subject: `Order #${1000 + out.length} confirmed`, date: rfc,
      html: page({ brand: shop, domain, rows, footer: `${h(shop)}, Unit 4 Example Works, Leeds LS2 7AA` }), text }, expected(shop, date, o)));
  };
  shopify("shopify-1", "Hollow Oak Candles", "hollowoakcandles.test", [{ name: "Fig & Cassis Candle", qty: 2, unit: 2200, v: "Large / 300g" }, { name: "Wick Trimmer", qty: 1, unit: 800 }], { fees: [["Shipping", 395]] }, "2026-09-30", "Wed, 30 Sep 2026 19:00:00 +0000");
  shopify("shopify-2", "Northern Brew Coffee", "northernbrew.test", [{ name: "House Espresso Blend", qty: 1, unit: 1100, v: "Whole bean / 250g" }, { name: "Single Origin Ethiopia Yirgacheffe", qty: 2, unit: 1350, v: "Ground for filter / 250g" }, { name: "Ceramic Pour Over Dripper", qty: 1, unit: 2400 }],
    { fees: [["Shipping", 0]], discounts: [["Discount (WELCOME10)", 520]] }, "2026-09-29", "Tue, 29 Sep 2026 19:00:00 +0000");
  shopify("shopify-3", "Kind Skin Co", "kindskin.test", [{ name: "Gentle Cleansing Balm", qty: 1, unit: 2800, v: "100ml" }, { name: "Hydrating Face Mist", qty: 1, unit: 1600, v: "50ml" }], { fees: [["Shipping", 350]] }, "2026-09-28", "Mon, 28 Sep 2026 19:00:00 +0000");
  return out;
}
