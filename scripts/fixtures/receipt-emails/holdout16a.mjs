// A seventeenth set of made-up emails (see lib.mjs), round 15 (20 Nov 2026): layouts of Amazon, Apple, Google Play, Appcharge,
// PayPal and travel agents in Connor's own inbox that Relay read wrong, written again with everything in them made up (items,
// prices, people, addresses, order numbers). The senders keep their names and addresses: the reader goes by their layouts.
import { order, expected, fixture, h } from "./lib.mjs";

const cells = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const htmlPage = (title, lines, foot = "") => `<html><head><title>${h(title)}</title></head><body>${cells(lines)}${foot}</body></html>`;
const AMZ_FROM = '"Amazon.co.uk" <auto-confirm@amazon.co.uk>';
const AMZ_FOOT = "Fulfilled By Amazon (usually referred to as FBA) items are generally sold by third-party sellers but stored in an Amazon Fulfilment Centre and sent to you from there.";
const RULE = "=======================================================================================";

// ---- Amazon's "Your return is confirmed": a collection booked, the refund only expected, the order only in the links ------
export const RETURN_PICKUP = fixture("holdout16a-amazon-return-pickup", "Amazon", "'Your return is confirmed', 'Return pickup', 'Total expected refund £449.00', the order only in the links ('orderId=…')",
  { from: '"return@amazon.co.uk" <return@amazon.co.uk>', subject: "Your return of Brightvale 55 Inch Smart TV...", date: "Sat, 23 Dec 2023 17:55:39 +0000",
    html: '<html><body><table><tr><td>Your Return Summary</td></tr><tr><td>Your return is confirmed</td></tr><tr><td>Return pickup :</td><td>Thu, Dec 28, 10:30 am - 07:00 pm</td></tr><tr><td>Refund is issued within 14 days after your return is picked up.</td></tr><tr><td><a href="https://www.amazon.co.uk/gp/r.html?C=X&amp;U=https%3A%2F%2Fwww.amazon.co.uk%2Fspr%2Freturns%2Fprep%3FrmaId%3DAbC123%26orderId%3D206-5556667-7778889%26ingress%3Dprep_email">See full instructions</a></td></tr><tr><td>Total expected refund</td><td>&pound;449.00</td></tr><tr><td>&pound;449.00 will be refunded to your card ending in 1234</td></tr><tr><td>Carrier will bring a label at the time of pickup.</td></tr></table></body></html>' },
  { notPurchase: { kind: "return_started" } });

export default function holdout16a() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  const not = (id, sender, layout, m, kind, extra = {}) => { const f = fixture(id, sender, layout, m, { notPurchase: { kind, ...extra } }); out.push(f); return f; };

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
      "Your order will be sent to:", "Sam", "HEBDEN BRIDGE", "United Kingdom", "Order #", "204-3141529-2653589", "View order details", title, author, "Condition: New", "Sold by:", "Tsubaki Books Ltd",
      "Fulfilled by Amazon", "Gift wrap: No", "Qty: 1", "£28.64", "Order Total:", "£0.00", "Selected Payment Method(s):", "Gift Card (£28.64)", "Visa (£0.00)", "Keep shopping for", "Pocket Kanji Flashcards Set...", "£6.49", AMZ_FOOT]);
    const text = ["Amazon.co.uk Order Confirmation", "    Order #204-3141529-2653589", "", "Hello,", "", "Ordered item(s):" + title + "                    of " + author + " £28.64",
      "Condition: NewSold by: Tsubaki Books LtdFulfilled by AmazonGift wrap: No", "Order Total:              £0.00", "", RULE].join("\n");
    add("holdout16a-amazon-book-gift-wrap", "Amazon", "a gift: the title over the author's row, then 'Condition', 'Sold by', 'Fulfilled by Amazon', 'Gift wrap: No', 'Qty: 1'; 'Order Total: £0.00' with 'Gift Card (£28.64)'",
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
  // ---- Amazon's refunds: "Your return is now complete" naming the order only in its link; a film's refund under a subject
  // that only names the order; a payments team's "Refund on order …" -------------------------------------------------------
  not("holdout16a-amazon-refund-link-only", "Amazon", "'We've issued your refund for the item below', the order only in the link to it ('orderID=…', URL-encoded in the HTML), 'Refund total: £4.49**'",
    { from: '"return@amazon.co.uk" <return@amazon.co.uk>', subject: "Your refund for Brightway E14 Candle Bulb,4W,25W....", date: "Fri, 10 Mar 2023 14:13:43 +0000",
      text: " Hello Sam, \n\n We've issued your refund for the item below. Your return is now complete*. \n\n View return & refund status :\nhttps://www.amazon.co.uk/gp/your-account/order-details?orderID=206-1112223-3334445&ref_=E_CReturnsRefundConfirmation_OrderDetail\n\n\n Item details: \n Brightway E14 Candle Bulb,4W,25W...\n\n Refund total:  £4.49**\n Refund is available now in your Amazon Account. \n\n*  This is an advanced refund. If we don't receive the item listed above, we may charge your original payment method. \n",
      html: '<html><body><table><tr><td><h3> Refund Confirmation </h3></td></tr><tr><td><b> Hello Sam, </b><p> We\'ve issued your refund for the item below. Your return is now complete*. </p></td></tr><tr><td><a href="https://www.amazon.co.uk/gp/r.html?C=X&amp;U=https%3A%2F%2Fwww.amazon.co.uk%2Fgp%2Fyour-account%2Forder-details%3ForderID%3D206-1112223-3334445%26ref_%3Dpe_1&amp;H=Y"><span> View return &amp; refund status </span></a></td></tr><tr><td><span>Brightway E14 Candle Bulb,4W,25W...</span></td></tr><tr><td><p><b><span> Refund total: <span>&pound;4.49** </span></span></b><br /><span> Refund is available now in your Amazon Account. </span></p></td></tr></table></body></html>' },
    "refund", { refundPence: 449, orderRef: "206-1112223-3334445" });
  not("holdout16a-amazon-digital-refund", "Amazon", "subject 'Your Amazon.co.uk Order #D01-…' over 'we have processed your refund for £1.99 for the above-referenced order', 'Item Refund', 'Item Tax Refund', 'Refund Total'",
    { from: '"Amazon.co.uk" <digital-no-reply@amazon.co.uk>', subject: "Your Amazon.co.uk Order #D01-1234567-7654321", date: "Sat, 30 Dec 2023 18:49:43 +0000",
      text: "Greetings Sam,\n\nThank you for shopping with us.\n\nWe're writing to confirm that we have processed your refund for £1.99 for the above-referenced order.\n\nThe following is the breakdown of your refund:\n..........\n\n          Item(s) Returned:\n                Puddle Hoppers - Animated Series, Ep. 4 \"Rain Day\"\n                Prime Video\n                Sold by Amazon Digital UK Limited\n                Original Air Date: March 3, 2022\n                Item Refund:                                   £1.66\n                Item Tax Refund:                               £0.33\n                Refund Total:                                  £1.99\n          Payment Methods Credited:\n                Credit Card:                                   £1.99\n..........\n" },
    "refund", { refundPence: 199, orderRef: "D01-1234567-7654321" });
  not("holdout16a-amazon-payments-refund", "Amazon", "'Refund on order 204-…': 'processing your refund in the amount of £849.00 for your Order …', the item and the reason",
    { from: '"Amazon.co.uk" <payments-messages@amazon.co.uk>', subject: "Refund on order 204-9998887-7776665", date: "Tue, 28 May 2024 11:54:13 +0000",
      text: "Dear Customer,\n\nGreetings from Amazon.co.uk.\n\nWe are writing to confirm that we are processing your refund in the amount of £849.00 for your Order 204-9998887-7776665.\n\nThis refund is for the following item(s):\n\nItem: Lumio 14-inch Laptop, 16GB RAM, 512GB SSD\nQuantity: 1\nReason for refund: Damaged during transit\n\nItem Refund: £707.50\nItem Tax Refund: £141.50\n\nMasterCard Credit Card [expiring on 3/2027]: £849.00\n" },
    "refund", { refundPence: 84900, orderRef: "204-9998887-7776665" });
  // ---- Etsy, 2023: the item's own line says "Returns accepted within 14 days of delivery"; the text part has the seller's
  // policy, "Just contact me within: 7 days of delivery", and what can't be returned, "- Custom or personalized orders" -------
  const etsy = (id, name, variant, unit, ref, layout) => {
    const o = order([{ name, qty: 1, unit }]);
    const money = (p) => `<span class='currency-symbol'>£</span><span class='currency-value'>${(p / 100).toFixed(2)}</span>`;
    const html = `<html><head><title>Your Etsy Purchase</title></head><body><div><h1>Your order is confirmed</h1><p>Order number: ${ref}</p><p>Order date: 17 Apr, 2023</p>` +
      `<dl><div><div><a href="https://www.etsy.com/transaction/3141592653">${h(name)}</a><div>Transaction ID: 3141592653</div><div><span>${h(variant.split(": ")[0])}: </span><span>${h(variant.split(": ")[1])}</span></div>` +
      `<div>Quantity: 1</div><div>Price: <span class="price">${money(unit)}</span> </div><div>Returns accepted within 14 days of delivery</div></div></div></dl>` +
      `<table><tr><td>Order total</td><td>${money(unit)}</td></tr></table></div></body></html>`;
    const p = "£" + (unit / 100).toFixed(2);
    const text = ["Your order is confirmed", "", "Order number: " + ref, "", "Shop: Brindlewick Crafts", "", "--------------------------------------", "", "Transaction ID:     3141592653",
      "Item:               " + name, variant, "Quantity:           1", "Item price:         " + p, "--------------------------------------", "Item total:         " + p, "Order total:        " + p, "",
      "SHOP POLICIES FOR BRINDLEWICK CRAFTS", "", "Returns & Exchanges", "", "I GLADLY ACCEPT RETURNS, EXCHANGES, AND CANCELLATIONS", "Just contact me within: 7 days of delivery",
      "Ship returns back to me within: 30 days of delivery", "Request a cancellation within: 24 hours of purchase", "",
      "THE FOLLOWING ITEMS CAN'T BE RETURNED", "Because of the nature of these items, unless they arrive damaged or defective, I can't accept returns for:",
      "- Custom or personalized orders", "- Perishable products (like food or flowers)", "- Digital downloads", "", "CONDITIONS OF RETURN", "Buyers are responsible for return shipping costs."].join("\n");
    return add(id, "Etsy", layout, { from: '"Etsy Transactions" <transaction@etsy.com>', subject: "Your Etsy Purchase from Brindlewick Crafts (" + ref + ")", date: "Mon, 17 Apr 2023 09:27:57 +0000", html, text },
      o, "Etsy", "2023-04-17", { shopAlso: ["Etsy - Brindlewick Crafts", "Brindlewick Crafts"] });
  };
  etsy("holdout16a-etsy-personalised", "Personalised Name Bookmark - Pressed Flower Gift for Readers", "Colour: Sage", 895, "2718281828", "a personalised item; the seller's policy says personalised orders can't be returned");
  etsy("holdout16a-etsy-seller-days", "Pressed Flower Bookmark Set of 3 - Meadow Mix", "Colour: Meadow", 1250, "1618033988", "the seller's 'contact me within: 7 days of delivery' over the item line's 14 days");
  return out;
}
