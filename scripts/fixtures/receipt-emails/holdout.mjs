// A second set of made-up emails, written after the reader was built, in layouts it hadn't seen (see lib.mjs). They were
// run before any change was made for them, and that first result is recorded in the commit that added them.
import { order, expected, page, table, moneyRows, moneyText, fixture, gbp, h, SHOPPER } from "./lib.mjs";

export default function holdout() {
  const out = [];
  const add = (id, sender, layout, mail, o, shop, date, extra) => out.push(fixture(id, sender, layout, mail, expected(shop, date, o, extra)));

  {
    // Extras with their own price on their own line, added to the item's ("+ Extra cheese £0.80").
    const o = order([{ name: "12\" Margherita", qty: 1, unit: 1079, extras: ["Extra cheese"] }, { name: "Garlic Bread", qty: 1, unit: 450 }, { name: "Cookie Dough Tub", qty: 1, unit: 599, extras: ["Chocolate sauce"] }],
      { fees: [["Delivery fee", 199], ["Service charge", 99]] });
    const text = ["Thanks for your order, Sam!", "Order number: 1853001122", "Placed on 12 Nov 2026", "", "1 x 12\" Margherita £9.99", "+ Extra cheese £0.80", "1 x Garlic Bread £4.50", "1 x Cookie Dough Tub £5.49", "+ Chocolate sauce £0.50", "",
      moneyText(o), "", "Just Eat"].join("\n");
    add("holdout-just-eat-priced-extras", "Just Eat", "extras priced on their own lines, added to the item", { from: "Just Eat <noreply@t.just-eat.co.uk>", subject: "Thanks for your order, Sam", date: "Thu, 12 Nov 2026 19:10:00 +0000", text },
      o, "Just Eat", "2026-11-12");
  }
  {
    // Product | Price | Qty | Total columns (the unit price before the quantity).
    const o = order([{ name: "Linen Cushion Cover", qty: 2, unit: 1800 }, { name: "Stoneware Vase", qty: 1, unit: 3400 }, { name: "Beeswax Candle Set", qty: 3, unit: 950 }], { fees: [["Shipping", 450]] });
    add("holdout-shop-price-qty-total", "Shop (price before qty)", "Product | Price | Qty | Total", { from: "Marlow Home <hello@marlowhome.test>", subject: "Order confirmation #MH2041", date: "Wed, 11 Nov 2026 10:00:00 +0000",
      html: page({ brand: "Marlow Home", domain: "marlowhome.test", rows: [`<p>Thank you for your order.</p>`, `<p>Order #MH2041</p>`, `<p>11 November 2026</p>`,
        table([["Product", "Price", "Qty", "Total"], ...o.lines.map((i) => [h(i.name), gbp(i.unit), String(i.qty), gbp(i.line)])]), table(moneyRows(o))] }) }, o, "Marlow Home", "2026-11-11");
  }
  {
    // Was / Now prices under each item.
    const o = order([{ name: "ASOS DESIGN wool mix overcoat in camel", qty: 1, unit: 4800 }, { name: "ASOS DESIGN chunky knit jumper", qty: 1, unit: 2200 }], { fees: [["Delivery", 0]] });
    add("holdout-asos-was-now", "ASOS", "Was / Now price lines", { from: "ASOS <order_confirmation@asos.com>", subject: "Thanks for your order!", date: "Tue, 10 Nov 2026 21:00:00 +0000",
      html: page({ brand: "ASOS", domain: "asos.com", rows: [`<p>Order No.: 1074500001</p>`, `<p>Order date: 10 Nov, 2026</p>`,
        `<p><b>ASOS DESIGN wool mix overcoat in camel</b></p><p>Was £80.00</p><p>Now £48.00</p><p>Colour: Camel</p><p>Size: L</p><p>Qty: 1</p><p>£48.00</p>`,
        `<p><b>ASOS DESIGN chunky knit jumper</b></p><p>Was £32.00</p><p>Now £22.00</p><p>Colour: Cream</p><p>Size: L</p><p>Qty: 1</p><p>£22.00</p>`,
        table(moneyRows(o, { free: "Free" }))] }) }, o, "ASOS", "2026-11-10");
  }
  {
    // A money-off line straight under one item (a Sparks offer), in the item list.
    const o = order([{ name: "Collection Luxury Smoked Salmon 200g", qty: 1, unit: 700 }, { name: "Percy Pig Fruit Gums 170g", qty: 2, unit: 125 }, { name: "Our Best Ever Chicken Pie", qty: 1, unit: 900 }],
      { discounts: [["Sparks offer", 200]], fees: [["Delivery", 450]] });
    add("holdout-ms-food-offer", "M&S", "an offer line under an item", { from: "M&S <noreply@marksandspencer.com>", subject: "Thank you for your M&S order", date: "Mon, 09 Nov 2026 19:00:00 +0000",
      text: ["M&S Food", "Order number: 9988776655XYZ", "9 November 2026", "", "1 x Collection Luxury Smoked Salmon 200g £7.00", "Sparks offer -£2.00", "2 x Percy Pig Fruit Gums 170g £2.50", "1 x Our Best Ever Chicken Pie £9.00", "",
        "Subtotal £18.50", "Sparks offer -£2.00", "Delivery £4.50", "Total £21.00"].join("\n") }, o, "M&S", "2026-11-09");
  }
  {
    // Special instructions under an item.
    const o = order([{ name: "Smash Burger", qty: 2, unit: 950, extras: ["No onions"] }, { name: "Loaded Fries", qty: 1, unit: 595 }], { fees: [["Delivery Fee", 149], ["Service Fee", 99]], tips: [["Tip", 150]] });
    add("holdout-uber-eats-instructions", "Uber Eats", "special instructions under an item", { from: "Uber Receipts <noreply@uber.com>", subject: "Your Saturday evening order with Uber Eats", date: "Sat, 07 Nov 2026 20:00:00 +0000",
      html: page({ brand: "Uber Eats", domain: "ubereats.com", rows: [`<p>Thanks for ordering, Sam</p>`, `<p>Here's your receipt for Patty Lab.</p>`, `<p>7 November 2026</p>`,
        table([["2", "Smash Burger", gbp(1900)], ["", "<span>Special instructions: No onions</span>", ""], ["1", "Loaded Fries", gbp(595)]]), table(moneyRows(o))] }) },
      { ...o, lines: o.lines }, "Uber Eats", "2026-11-07", { items: [{ name: "Smash Burger", qty: 2, linePence: 1900 }, { name: "Loaded Fries", qty: 1, linePence: 595 }] });
  }
  {
    // Bullets in a list: "• Name - £5.99", quantity in brackets.
    const o = order([{ name: "Superdrug Hyaluronic Acid Serum 30ml", qty: 1, unit: 599 }, { name: "Garnier Micellar Water 400ml", qty: 2, unit: 550 }], { fees: [["Delivery", 399]] });
    add("holdout-superdrug-bullets", "Superdrug", "bulleted list items", { from: "Superdrug <noreply@superdrug.com>", subject: "Your Superdrug order confirmation", date: "Fri, 06 Nov 2026 19:00:00 +0000",
      html: page({ brand: "Superdrug", domain: "superdrug.com", rows: [`<p>Order number: SD1122339999</p>`, `<p>6 November 2026</p>`, `<ul><li>Superdrug Hyaluronic Acid Serum 30ml (x1) - £5.99</li><li>Garnier Micellar Water 400ml (x2) - £11.00</li></ul>`,
        table(moneyRows(o))] }) }, o, "Superdrug", "2026-11-06");
  }
  {
    // Weighed items and a multibuy note line between items.
    const o = order([{ name: "Loose Carrots 0.52kg", qty: 1, unit: 31 }, { name: "Heinz Tomato Soup 400g", qty: 4, unit: 140 }, { name: "Hovis Soft White Bread 800g", qty: 1, unit: 150 }], { discounts: [["Multibuy savings", 60]], fees: [["Delivery charge", 450]] });
    add("holdout-tesco-weighed", "Tesco", "a weighed item and a multibuy note between items", { from: "Tesco.com <tesco@confirmations.tesco.co.uk>", subject: "Thanks for your Tesco order", date: "Thu, 05 Nov 2026 09:00:00 +0000",
      text: ["Order number: 942-5512-2400", "Order date: 05/11/2026", "", "1 x Loose Carrots 0.52kg £0.31", "4 x Heinz Tomato Soup 400g £5.60", "Any 4 for £5", "1 x Hovis Soft White Bread 800g £1.50", "",
        "Guide price £7.41", "Multibuy savings -£0.60", "Delivery charge £4.50", "Total guide price £11.31"].join("\n") }, o, "Tesco", "2026-11-05");
  }
  {
    // Amazon's plain-text email alone.
    const o = order([{ name: "Echo Dot (5th generation)", qty: 1, unit: 5499 }, { name: "Amazon Basics HDMI Cable 2m", qty: 2, unit: 699 }]);
    add("holdout-amazon-text", "Amazon", "plain-text part only", { from: "\"Amazon.co.uk\" <auto-confirm@amazon.co.uk>", subject: "Your Amazon.co.uk order of \"Echo Dot (5th generation)\" and 1 more item.", date: "Wed, 04 Nov 2026 08:00:00 +0000",
      text: ["Hello Sam,", "Thank you for shopping with us.", "Order #205-5555555-1234567", "Placed on Wednesday, 4 November 2026", "", "Echo Dot (5th generation)", "Sold by Amazon", "Quantity: 1", "£54.99", "",
        "Amazon Basics HDMI Cable 2m", "Sold by Amazon", "Quantity: 2", "£6.99", "", "Item(s) Subtotal: £68.97", "Order Total: £68.97"].join("\n") }, o, "Amazon", "2026-11-04");
  }
  {
    // Item Total per line and a size line.
    const o = order([{ name: "Nike Air Max 90", qty: 1, unit: 13000 }, { name: "Nike Everyday Plus Socks (3 Pairs)", qty: 2, unit: 1600 }], { fees: [["Standard delivery", 399]] });
    add("holdout-jd-item-total", "JD Sports", "Size line and Item Total per line", { from: "JD Sports <orders@jdsports.co.uk>", subject: "Your JD order confirmation", date: "Tue, 03 Nov 2026 19:00:00 +0000",
      text: ["JD", "Order number: 102939000", "3 November 2026", "", "Nike Air Max 90", "Size: 9", "Qty: 1", "Item Total: £130.00", "", "Nike Everyday Plus Socks (3 Pairs)", "Size: L", "Qty: 2", "Item Total: £32.00", "", moneyText(o)].join("\n") },
      o, "JD Sports", "2026-11-03");
  }
  {
    // Price per kg and "each" notes.
    const o = order([{ name: "Waitrose Mature Cheddar 400g", qty: 1, unit: 450 }, { name: "Waitrose Bananas", qty: 6, unit: 20 }, { name: "Essential Waitrose Whole Milk 4 Pints", qty: 2, unit: 155 }], { fees: [["Delivery", 0]] });
    add("holdout-waitrose-unit-notes", "Waitrose", "each and per kg notes", { from: "Waitrose & Partners <customerservice@waitrose.co.uk>", subject: "Your Waitrose order confirmation", date: "Mon, 02 Nov 2026 10:00:00 +0000",
      html: page({ brand: "Waitrose", domain: "waitrose.com", rows: [`<p>Order number: 812004000</p>`, `<p>2 November 2026</p>`,
        table([["Waitrose Mature Cheddar 400g<br /><span>£11.25/kg</span>", "1", "£4.50"], ["Waitrose Bananas<br /><span>£0.20 each</span>", "6", "£1.20"], ["Essential Waitrose Whole Milk 4 Pints<br /><span>£1.55 each</span>", "2", "£3.10"]]),
        table(moneyRows(o, { free: "Free" }))] }) }, o, "Waitrose", "2026-11-02");
  }
  return out;
}
