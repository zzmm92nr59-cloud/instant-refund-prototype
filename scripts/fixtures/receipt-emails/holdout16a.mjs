// A seventeenth set of made-up emails (see lib.mjs), round 15 (20 Nov 2026): layouts of Amazon, Apple, Google Play, Appcharge,
// PayPal and travel agents in Connor's own inbox that Relay read wrong, written again with everything in them made up (items,
// prices, people, addresses, order numbers). The senders keep their names and addresses: the reader goes by their layouts.
import { order, expected, fixture, h } from "./lib.mjs";

const cells = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const htmlPage = (title, lines, foot = "") => `<html><head><title>${h(title)}</title></head><body>${cells(lines)}${foot}</body></html>`;
const AMZ_FROM = '"Amazon.co.uk" <auto-confirm@amazon.co.uk>';
const AMZ_FOOT = "Fulfilled By Amazon (usually referred to as FBA) items are generally sold by third-party sellers but stored in an Amazon Fulfilment Centre and sent to you from there.";
const RULE = "=======================================================================================";

export default function holdout16a() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };

  // ---- Amazon, 2023: "3 x" on its own row over the title, "Sold by:" under it and the price of one ---------------------------
  {
    const a = "Ridgeback Protein Shaker Bottle - 700ml", b = "Meadowsoft Gentle Hydrating Day Cream for Sensitive Skin, 100 ml (Pack of 1)";
    const o = order([{ name: a, qty: 1, unit: 349 }, { name: b, qty: 3, unit: 215 }]);
    const html = htmlPage(`Your Amazon.co.uk order of "${a}" and 1 more item.`, ["Amazon.co.uk", "Order Confirmation", "Order #", "205-1029384-7564738", "Hello,",
      "Thanks for your order. We’ll let you know once your item(s) have dispatched.", "Your order will be sent to:", "Sam", "YORK", "United Kingdom",
      "Order Total:", "£9.94", "Selected Payment Method:", "Mastercard", a, "Sold by: Amazon EU S.a.r.L.", "£3.49", "3 x", b, "Sold by: Amazon EU S.a.r.L.", "£2.15", AMZ_FOOT]);
    const text = ["Amazon.co.uk Order Confirmation", "    Order #205-1029384-7564738", "", "Hello,", "Thanks for your order.", "", "Ordered item(s):",
      "     " + a, "     £3.49", "     Sold by: Amazon EU S.a.r.L.", "", "     3 x " + b + "   ", "     £2.15", "     Sold by: Amazon EU S.a.r.L.", "", "",
      "     Order Total:                      £9.94", RULE].join("\n");
    add("holdout16a-amazon-n-x-row", "Amazon", "'3 x' on the row over the title in the HTML ('3 x Title' in the text part), the price of one under 'Sold by:'",
      { from: AMZ_FROM, subject: `Your Amazon.co.uk order of "${a}" and 1 more item.`, date: "Sat, 7 Jan 2023 10:05:00 +0000", html, text }, o, "Amazon", "2023-01-07");
  }
  // ---- Amazon, 2023: one order sent in three parcels, its summary (and "Gift Card (£4.00)") over each ---------------------------
  {
    const its = [{ name: "Northgate Microfibre Fitted Sheet, Double, Slate", qty: 1, unit: 1250 }, { name: "Calderbrook Bluetooth Mini Speaker with Carry Strap, Teal", qty: 1, unit: 2700 }, { name: "Willowmere Cotton Duvet Cover Set, Double, Oat", qty: 1, unit: 1599 }];
    const o = order(its);
    const head = (n) => ["Arriving:", "Thursday, April " + (26 + n), "Your order will be sent to:", "Sam", "LEEDS", "United Kingdom", "Order Total:", "£51.49", "Selected Payment Method(s):", "Gift Card (£4.00)", "Visa (£51.49)"];
    const html = htmlPage(`Your Amazon.co.uk order of "${its[0].name}" and 2 more items`, ["Amazon.co.uk", "Order Confirmation", "Order #", "204-5566778-1122334", "Hello,", "Thanks for your order.",
      ...head(0), its[0].name, "Sold by: Amazon EU S.a.r.L.", "£12.50", ...head(1), its[1].name, "Sold by: Amazon EU S.a.r.L.", "£27.00", ...head(2), its[2].name, "Sold by: Willowmere Home", "£15.99", AMZ_FOOT]);
    add("holdout16a-amazon-gift-card-parcels", "Amazon", "one order in three parcels, the summary with 'Gift Card (£4.00)' and 'Visa (£51.49)' repeated over each; the total is what was bought",
      { from: AMZ_FROM, subject: `Your Amazon.co.uk order of "${its[0].name}" and 2 more items`, date: "Sun, 23 Apr 2023 18:40:00 +0100", html }, o, "Amazon", "2023-04-23", { giftCardPence: 400 });
  }
  // ---- Amazon, 2024: a book marked as a gift, its title cut over its author's row, "Gift wrap: No", paid by gift card --------
  {
    const title = "Kanji in Context: A Workbook for Beginners in Elementary Japanese, Second Edition", author = "Hana Morita";
    const o = order([{ name: title + " of " + author, qty: 1, unit: 2864 }]);
    const html = htmlPage(`Your Amazon.co.uk order of "${title.slice(0, 28)}..."`, ["Your Orders", "Order Confirmation", "Arriving:", "Tuesday, December 17", "This order contains one or more items that you've marked as a gift.",
      "Your order will be sent to:", "Sam", "HEBDEN BRIDGE", "United Kingdom", "Order #", "204-3141529-2653589", "View order details", title.slice(0, 36) + "...", author, "Condition: New", "Sold by:", "Tsubaki Books Ltd",
      "Fulfilled by Amazon", "Gift wrap: No", "Qty: 1", "£28.64", "Order Total:", "£0.00", "Selected Payment Method(s):", "Gift Card (£28.64)", "Visa (£0.00)", "Keep shopping for", "Pocket Kanji Flashcards Set...", "£6.49", AMZ_FOOT]);
    const text = ["Amazon.co.uk Order Confirmation", "    Order #204-3141529-2653589", "", "Hello,", "", "Ordered item(s):" + title + "                    of " + author + " £28.64",
      "Condition: NewSold by: Tsubaki Books LtdFulfilled by AmazonGift wrap: No", "Order Total:              £0.00", "", RULE].join("\n");
    add("holdout16a-amazon-book-gift-wrap", "Amazon", "a gift: the title cut over the author's row, then 'Condition', 'Sold by', 'Fulfilled by Amazon', 'Gift wrap: No', 'Qty: 1'; 'Order Total: £0.00' with 'Gift Card (£28.64)'",
      { from: AMZ_FROM, subject: `Your Amazon.co.uk order of "${title.slice(0, 28)}..."`, date: "Mon, 16 Dec 2024 08:15:00 +0000", html, text }, o, "Amazon", "2024-12-16", { giftCardPence: 2864 });
  }
  // ---- Prime Video, 2024: a film bought with a gift card, "Gift Card Amount: -£2.49", "Order Grand Total: £0.00" ---------------
  {
    const o = order([{ name: "The Lighthouse Keepers", qty: 1, unit: 249 }]);
    const html = htmlPage("Amazon.co.uk order confirmation", ["Thank you for your order", "Order #", "D01-2718281-8284590", "Placed on Friday, September 6, 2024", "The Lighthouse Keepers", "Sold by Amazon Digital UK Limited.",
      "Review this item", "£2.49", "Item Subtotal:", "£2.08", "Total Before VAT:", "£2.08", "VAT:", "£0.41", "Total:", "£2.49", "Gift Card Amount:", "-£2.49", "Order Grand Total:", "£0.00"]);
    add("holdout16a-prime-video-gift-card", "Amazon Prime Video", "a film paid by gift card: 'Total: £2.49', 'Gift Card Amount: -£2.49', 'Order Grand Total: £0.00'; the total is what it cost",
      { from: "Amazon Prime Video <no-reply@primevideo.com>", subject: "Amazon.co.uk order of The Lighthouse Keepers", date: "Fri, 6 Sep 2024 20:31:00 +0100", html }, o, "Amazon Prime Video", "2024-09-06", { giftCardPence: 249, shopAlso: ["Amazon"] });
  }
  // ---- Amazon, 2023: a free film, the summary before VAT, "Promotions: -£3.33" taking all of it -------------------------------
  {
    const o = order([{ name: "Midsummer on Hollow Lane", qty: 1, unit: 399 }], { discounts: [["Promotions", 399]] });
    const html = htmlPage("Amazon.co.uk order confirmation", ["Thank you for your order", "Order #", "D01-1414213-5623730", "Placed on Sunday, June 4, 2023", "Midsummer on Hollow Lane", "Sold by Amazon Digital UK Limited.",
      "Review this item", "£3.99", "Item Subtotal:", "£3.33", "Promotions:", "-£3.33", "Total Before VAT:", "£0.00", "VAT:", "£0.00", "Order Grand Total:", "£0.00"]);
    add("holdout16a-amazon-free-film", "Amazon", "a film listed at £3.99 with VAT, the summary before VAT: 'Item Subtotal: £3.33', 'Promotions: -£3.33', 'Order Grand Total: £0.00'",
      { from: '"Amazon.co.uk" <digital-no-reply@amazon.co.uk>', subject: "Amazon.co.uk order of Midsummer on Hollow Lane", date: "Sun, 4 Jun 2023 21:02:00 +0100", html }, o, "Amazon", "2023-06-04", { totalPence: 0 });
  }
  return out;
}
