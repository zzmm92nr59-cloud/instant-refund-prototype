// A third set of made-up emails (see lib.mjs), written after the second set's fixes and run before any change for them.
import { order, expected, page, table, moneyRows, moneyText, fixture, gbp, h, SHOPPER } from "./lib.mjs";

export default function holdout2() {
  const out = [];
  const add = (id, sender, layout, mail, o, shop, date, extra) => out.push(fixture(id, sender, layout, mail, expected(shop, date, o, extra)));
  {
    // A coffee app: an option with its own price written "+£0.45" after it, on the line under the drink.
    const o = order([{ name: "Flat White", qty: 1, unit: 390, extras: ["Oat milk"] }, { name: "Almond Croissant", qty: 1, unit: 325 }, { name: "Americano", qty: 2, unit: 295 }]);
    add("holdout2-coffee-app", "Pret", "option price written +£0.45", { from: "Pret A Manger <receipts@pret.co.uk>", subject: "Your Pret receipt", date: "Wed, 18 Nov 2026 08:10:00 +0000",
      text: ["Pret A Manger", "King's Cross", "18/11/2026 08:09", "Receipt 4471", "", "1x Flat White £3.45", "   Oat milk +£0.45", "1x Almond Croissant £3.25", "2x Americano £5.90", "", `Total ${gbp(o.total)}`, "Paid by Apple Pay"].join("\n") },
      o, "Pret A Manger", "2026-11-18", { shopAlso: ["Pret"] });
  }
  {
    // Each item's own saving under it ("Save £1.00").
    const o = order([{ name: "Ocado Greek Style Yogurt 500g", qty: 2, unit: 150 }, { name: "Lindt Excellence 70% Cocoa 100g", qty: 1, unit: 250 }, { name: "Yorkshire Tea 160 Bags", qty: 1, unit: 550 }], { discounts: [["Savings", 200]], fees: [["Delivery", 299]] });
    add("holdout2-ocado-saves", "Ocado", "a saving line under items", { from: "Ocado <customerservices@ocado.com>", subject: "Your Ocado order confirmation", date: "Tue, 17 Nov 2026 21:00:00 +0000",
      html: page({ brand: "Ocado", domain: "ocado.com", rows: [`<p>Order number: 1004-2219-9001</p>`, `<p>Order placed: 17 November 2026</p>`,
        table([["Ocado Greek Style Yogurt 500g", "2", "£3.00"], ["", "Save £1.00", ""], ["Lindt Excellence 70% Cocoa 100g", "1", "£2.50"], ["", "Save £1.00", ""], ["Yorkshire Tea 160 Bags", "1", "£5.50"]]),
        table(moneyRows(o, { subtotal: "Total of items" }))] }) }, o, "Ocado", "2026-11-17");
  }
  {
    // Was and now prices in one cell.
    const o = order([{ name: "Vital Seamless Leggings", qty: 1, unit: 3600 }, { name: "Training Oversized T-Shirt", qty: 2, unit: 1800 }], { fees: [["Delivery", 0]] });
    add("holdout2-gymshark-was-now-cell", "Gymshark", "£45.00 £36.00 in one cell", { from: "Gymshark <hello@gymshark.com>", subject: "Thanks for your order #GS1009", date: "Mon, 16 Nov 2026 19:00:00 +0000",
      html: page({ brand: "Gymshark", domain: "gymshark.com", rows: [`<p>Order #GS1009</p>`, `<p>16 November 2026</p>`, table([["Item", "Qty", "Price"], ["Vital Seamless Leggings<br />Black / M", "1", "<s>£45.00</s> £36.00"], ["Training Oversized T-Shirt<br />White / L", "2", "£36.00"]]),
        table(moneyRows(o, { free: "Free" }))] }) }, o, "Gymshark", "2026-11-16");
  }
  {
    // A money-off row inside the item table.
    const o = order([{ name: "Boots Ingrown Hair Serum 30ml", qty: 1, unit: 800 }, { name: "Olay Regenerist Night Cream 50ml", qty: 1, unit: 3299 }], { discounts: [["Item discount", 150]], fees: [["Delivery", 0]] });
    add("holdout2-boots-item-discount-row", "Boots", "a discount row in the item table", { from: "Boots <noreply@boots.com>", subject: "Thanks for your Boots order", date: "Sun, 15 Nov 2026 19:00:00 +0000",
      html: page({ brand: "Boots", domain: "boots.com", rows: [`<p>Order number: 9876549999</p>`, `<p>15 November 2026</p>`,
        table([["Item", "Qty", "Total"], ["Boots Ingrown Hair Serum 30ml", "1", "£8.00"], ["Item discount", "", "-£1.50"], ["Olay Regenerist Night Cream 50ml", "1", "£32.99"]]), table(moneyRows(o, { free: "Free" }))] }) },
      o, "Boots", "2026-11-15");
  }
  {
    // Cinema tickets and a booking fee.
    const o = order([{ name: "Adult Standard", qty: 2, unit: 1200 }, { name: "Large Popcorn", qty: 1, unit: 650 }], { fees: [["Booking fee", 150]] });
    add("holdout2-odeon", "ODEON", "tickets and a booking fee", { from: "ODEON <noreply@odeon.co.uk>", subject: "Your ODEON booking confirmation", date: "Sat, 14 Nov 2026 12:00:00 +0000",
      text: ["ODEON Leeds Thorpe Park", "Booking reference: OD7XK2", "Booked on 14 November 2026", "", "Wicked: For Good", "Sat 21 Nov 19:30, Screen 5", "", "2 x Adult Standard £24.00", "1 x Large Popcorn £6.50", "Booking fee £1.50", "", `Total paid ${gbp(o.total)}`].join("\n") },
      o, "ODEON", "2026-11-14");
  }
  {
    // Tabs between columns in a plain-text receipt.
    const o = order([{ name: "Sourdough Loaf", qty: 1, unit: 450 }, { name: "Cinnamon Bun", qty: 3, unit: 325 }, { name: "Oat Latte", qty: 1, unit: 380 }]);
    add("holdout2-bakery-tabs", "Bakery (tabs)", "tab-separated columns", { from: "Field & Flour <orders@fieldandflour.test>", subject: "Your Field & Flour receipt", date: "Fri, 13 Nov 2026 09:00:00 +0000",
      text: ["Field & Flour", "Order 2219", "13/11/2026", "", "Qty\tItem\tPrice", "1\tSourdough Loaf\t£4.50", "3\tCinnamon Bun\t£9.75", "1\tOat Latte\t£3.80", "", `Total\t${gbp(o.total)}`].join("\n") },
      o, "Field & Flour", "2026-11-13");
  }
  {
    // Two sellers, each with its own postage.
    const o = order([{ name: "Vintage Pyrex Bowl Set", qty: 1, unit: 2400 }, { name: "Retro Enamel Mug", qty: 2, unit: 650 }], { fees: [["Postage", 320], ["Postage", 285]] });
    add("holdout2-ebay-two-sellers", "eBay", "two sellers, postage each", { from: "eBay <ebay@ebay.co.uk>", subject: "Order confirmed", date: "Thu, 12 Nov 2026 19:00:00 +0000",
      text: ["eBay", "Order confirmed", "12 Nov 2026", "", "Seller: kitchen_finds_uk", "Order number: 12-34567-90001", "Vintage Pyrex Bowl Set", "Quantity: 1", "Item price: £24.00", "Postage: £3.20", "",
        "Seller: mugshot_vintage", "Order number: 12-34567-90002", "Retro Enamel Mug", "Quantity: 2", "Item price: £13.00", "Postage: £2.85", "", `Order total ${gbp(o.total)}`].join("\n") },
      o, "eBay", "2026-11-12");
  }
  {
    // Three App Store purchases, one of them free.
    const o = order([{ name: "Monument Valley 3", qty: 1, unit: 0 }, { name: "Procreate Pocket", qty: 1, unit: 599 }, { name: "Gold Bars", qty: 1, unit: 399 }]);
    add("holdout2-apple-free", "Apple App Store", "three purchases, one free", { from: "Apple <no_reply@email.apple.com>", subject: "Your receipt from Apple.", date: "Wed, 11 Nov 2026 10:00:00 +0000",
      html: page({ brand: "Apple", domain: "apple.com", rows: [`<p>Receipt</p>`, `<p>ORDER ID</p><p>MX99ZZ11AA</p>`, `<p>11 Nov 2026</p>`, `<p>App Store</p>`,
        table([["Monument Valley 3<br />Apple Arcade<br />Report a Problem", "Free"], ["Procreate Pocket<br />iPhone<br />Report a Problem", "£5.99"], ["Candy Crush Saga<br />Gold Bars<br />In-App Purchase<br />Report a Problem", "£3.99"]]),
        table([["Subtotal", "£8.31"], ["VAT charged at 20%", "£1.67"], ["TOTAL", gbp(o.total)]])] }) }, o, "Apple", "2026-11-11");
  }
  {
    // A Shopify shop with compare-at prices struck through beside each price.
    const o = order([{ name: "Merino Crew Socks", qty: 3, unit: 1200 }, { name: "Waxed Cotton Cap", qty: 1, unit: 2800 }], { fees: [["Shipping", 395]] });
    add("holdout2-shopify-compare-at", "Shopify store", "compare-at price beside each price", { from: "Fellside Goods <store+87654321@t.shopifyemail.com>", subject: "Order #1203 confirmed", date: "Tue, 10 Nov 2026 19:00:00 +0000",
      html: page({ brand: "Fellside Goods", domain: "fellsidegoods.test", rows: [`<p>Order #1203</p>`, `<p>Thank you for your purchase!</p>`,
        table([["Merino Crew Socks × 3<br />Grey / M", "<del>£45.00</del><br />£36.00"], ["Waxed Cotton Cap × 1", "<del>£35.00</del><br />£28.00"]]), table(moneyRows(o))] }) }, o, "Fellside Goods", "2026-11-10");
  }
  {
    // Deliveroo: the quantity and price on one line under the name ("1 × £8.95").
    const o = order([{ name: "Chicken Shawarma Wrap", qty: 1, unit: 895 }, { name: "Hummus & Pitta", qty: 2, unit: 450, extras: ["Extra pitta"] }], { fees: [["Delivery fee", 249], ["Service fee", 99]] });
    add("holdout2-deliveroo-qty-price-line", "Deliveroo", "name, then '1 × £8.95'", { from: "Deliveroo <noreply@t.deliveroo.com>", subject: "Your Deliveroo order from Levant Kitchen", date: "Mon, 09 Nov 2026 19:00:00 +0000",
      text: ["Your order's in!", "Levant Kitchen", "Order #3301", "9 November 2026", "", "Chicken Shawarma Wrap", "1 × £8.95", "Hummus & Pitta", "+ Extra pitta", "2 × £4.50", "", moneyText(o)].join("\n") },
      o, "Deliveroo", "2026-11-09");
  }
  return out;
}
