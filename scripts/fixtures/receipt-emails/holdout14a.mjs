// A fifteenth set of made-up emails (see lib.mjs), round 13 (19 Nov 2026): the layouts of Amazon, Apple, Google Play, a game
// shop sold through Appcharge, and PayPal's receipts in Connor's own inbox that Relay read wrong, written again with everything
// in them made up (items, prices, people, addresses, order numbers, games). Amazon, Apple, Google Play, Appcharge and PayPal
// keep their names and addresses: the reader goes by their layouts.
import { order, expected, fixture, gbp, h, SHOPPER } from "./lib.mjs";

// Each line its own cell, the way these senders' HTML splits into rows ("A | B" puts two cells on one row).
const cells = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const htmlPage = (title, lines, foot = "") => `<html><head><title>${h(title)}</title></head><body>${cells(lines)}${foot}</body></html>`;
const AMZ_FOOT = "Fulfilled By Amazon (usually referred to as FBA) items are generally sold by third-party sellers but stored in an Amazon Fulfilment Centre and sent to you from there.";

// The second order inside the email that holds two (each its own card): checked by test-receipt-corpus.mjs.
export const TWO_ORDERS = {
  "holdout14a-amazon-divided-2023": { orderRef: "206-5550123-7781204", totalPence: 1249, items: [["The Allotment Year: A Grower's Diary of Seasons of Hartley, Rowan", 1, 1249]] },
  "holdout14a-amazon-qty-2024": { orderRef: "204-7714420-3310986", totalPence: 0, giftCardPence: 6145, items: [["Brightline 3 Pack Microfibre Kitchen Cloths, Lint Free and Quick Drying, Grey", 2, 650], ["Oakmoor Stoneware Pasta Bowls Set of 4, Speckled Sand, Dishwasher Safe", 1, 2899], ["Pebblefield Bamboo Utensil Holder with Drainage, Natural", 1, 1946]] },
};

export default function holdout14a() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  const not = (id, sender, layout, m, kind, extra = {}) => { const f = fixture(id, sender, layout, m, { notPurchase: { kind, ...extra } }); out.push(f); return f; };

  // ---- Amazon, 2021: "Your Amazon.co.uk order." (a full stop after "order"), the title over "Condition: New" and "Sold by:" ----
  {
    const name = "Kestrelwood 2 Pack Silicone Baking Mats, Non Stick Reusable Oven Liners for Cookies and Pastry, 42 x 29.5 cm";
    const o = order([{ name, qty: 1, unit: 1199 }]);
    add("holdout14a-amazon-plain-subject", "Amazon", "subject 'Your Amazon.co.uk order.' with a full stop; title, 'Condition: New', 'Sold by:', seller, 'Fulfilled by Amazon', price",
      { from: '"Amazon.co.uk" <auto-confirm@amazon.co.uk>', subject: "Your Amazon.co.uk order.", date: "Fri, 3 Dec 2021 09:26:24 +0000",
        html: htmlPage('Your Amazon.co.uk order of "Kestrelwood 2 Pack Silicone..."', ["Your Orders", "Your Account", "Amazon.co.uk", "Order Confirmation", "Order # 206-3141592-6535897", "Hello,",
          "Thanks for your order. We’ll let you know once your item(s) have dispatched.", "Arriving:", "Friday, December 10", "Your order will be sent to:", "Sam", "LEEDS", "United Kingdom",
          "Order Total:", "£11.99", "Selected Payment Method:", "Visa", name, "Condition: New", "Sold by:", "Hearth & Home Supplies", "Fulfilled by Amazon", "£11.99",
          "We hope to see you again soon.", "Amazon.co.uk", AMZ_FOOT]) }, o, "Amazon", "2021-12-03");
  }
  // ---- Amazon, 2023: "Your purchase has been divided into 2 orders", each with its number, items and "Order Total:" ---------
  // (The second order's book has its author on the row under the title; the text part says "Title of Author".)
  {
    const first = "Willowmere Set of 12 Beeswax Tealight Candles, Unscented, 4 Hour Burn Time, Natural Honey Colour";
    const book = "The Allotment Year: A Grower's Diary of Seasons";
    const o = order([{ name: first, qty: 1, unit: 649 }]);
    const html = htmlPage('Your Amazon.co.uk order of "The Allotment Year..." and 1 more item(s)', ["Amazon.co.uk", "Order Confirmation", "Order #", "206-5550122-1100457", "Order #", "206-5550123-7781204",
      "Hello,", "Your Orders", "on Amazon.co.uk.", "Your purchase has been divided into 2 orders.", "Order summary",
      "Order #", "206-5550122-1100457", "Placed on February 06, 2023", "Your order will be sent to:", "Sam", "LEEDS", "United Kingdom", "Order Total:", "£6.49", "Selected Payment Method:", "Mastercard",
      first, "Condition: New", "Sold by:", "Glowfield Crafts", "Fulfilled by Amazon", "£6.49",
      "Order #", "206-5550123-7781204", "Placed on February 06, 2023", "Your order will be sent to:", "Sam", "LEEDS", "United Kingdom", "Order Total:", "£12.49", "Selected Payment Method:", "Mastercard",
      book, "Hartley, Rowan", "Sold by: Amazon EU S.a.r.L.", "£12.49", "We hope to see you again soon.", AMZ_FOOT]);
    const text = ["Amazon.co.uk Order Confirmation", "Order #206-5550122-1100457", "Order #206-5550123-7781204", "Hello,", "Your purchase has been divided into 2 orders.",
      "Arriving:", "Tuesday, February 7", "Ordered item(s):", first, "£6.49", "Condition: New", "Sold by: Glowfield Crafts", "Fulfilled by Amazon", "Order Total:                      £6.49",
      "=======================================================================================", "Arriving:", "Wednesday, February 8", "Ordered item(s):", book + " of Hartley, Rowan", "£12.49",
      "Sold by: Amazon EU S.a.r.L.", "Order Total:                      £12.49", "=======================================================================================", "We hope to see you again soon."].join("\n");
    add("holdout14a-amazon-divided-2023", "Amazon", "two orders in one email, each 'Order #' over its address, 'Order Total:' and items; a book's author on its own row",
      { from: '"Amazon.co.uk" <auto-confirm@amazon.co.uk>', subject: 'Your Amazon.co.uk order of "The Allotment Year..." and 1 more item(s)', date: "Mon, 6 Feb 2023 22:44:34 +0000", html, text }, o, "Amazon", "2023-02-06");
  }
  // ---- Amazon, late 2024: "Qty: 2", titles cut short in the HTML ("…Sil..."), whole in the text part (glued to the price), and
  // orders paid by gift card, "Order Total: £0.00" over "Gift Card (£61.45)" ------------------------------------------------------
  {
    const a = "Fernhill Ceramic Hand Soap Dispenser, 400ml Refillable Pump Bottle for Kitchen and Bathroom, Matte Sage";
    const b = ["Brightline 3 Pack Microfibre Kitchen Cloths, Lint Free and Quick Drying, Grey", "Oakmoor Stoneware Pasta Bowls Set of 4, Speckled Sand, Dishwasher Safe", "Pebblefield Bamboo Utensil Holder with Drainage, Natural"];
    const cut = (n) => n.slice(0, 36) + "...";
    const o = order([{ name: a, qty: 1, unit: 1475 }]);
    const html = htmlPage('Your Amazon.co.uk order of "Fernhill Ceramic Hand Soap..." and 3 more item(s)', ["Hello,", "Your Orders", "on Amazon.co.uk.", "Your purchase has been divided into 2 orders.",
      "Order Confirmation", "Arriving:", "Thursday, December 19", "United Kingdom", "Your delivery option:", "Standard Delivery", "Order #", "204-7714419-0021375", "View order details",
      cut(a), "Condition: New", "Sold by:", "Fernhill Home", "Qty: 1", "£14.75", "Order Total:", "£0.00", "Selected Payment Method(s):", "Gift Card (£14.75)", "Visa (£0.00)",
      "Order Confirmation", "Arriving:", "Friday, December 20", "Your delivery option:", "Premium Delivery", "Order #", "204-7714420-3310986", "View order details",
      cut(b[0]), "Sold by: Amazon EU S.a.r.L.", "Qty: 2", "£6.50", cut(b[1]), "Sold by: Amazon EU S.a.r.L.", "Qty: 1", "£28.99",
      cut(b[2]), "Condition: New", "Sold by:", "Pebblefield Ltd", "Fulfilled by Amazon", "Qty: 1", "£19.46", "Order Total:", "£0.00", "Selected Payment Method(s):", "Gift Card (£61.45)", "Visa (£0.00)",
      "If you use a mobile device, you can receive notifications about the delivery of your package."]);
    const text = ["Amazon.co.uk Order Confirmation", "Order #204-7714419-0021375", "Order #204-7714420-3310986", "Hello,", "Your purchase has been divided into 2 orders.",
      "Ordered item(s):" + a + "£14.75", "Condition: NewSold by: Fernhill Home", "Order Total:              £0.00", "=======================================================================================",
      "Ordered item(s):" + b[0] + "£6.50", "Sold by: Amazon EU S.a.r.L." + b[1] + "£28.99", "Sold by: Amazon EU S.a.r.L." + b[2] + "£19.46", "Condition: NewSold by: Pebblefield LtdFulfilled by Amazon",
      "Order Total:              £0.00", "======================================================================================="].join("\n");
    add("holdout14a-amazon-qty-2024", "Amazon", "'Qty: 2' rows, titles cut with '...' in the HTML and whole in the text part, two orders each paid by gift card ('Order Total: £0.00')",
      { from: '"Amazon.co.uk" <auto-confirm@amazon.co.uk>', subject: 'Your Amazon.co.uk order of "Fernhill Ceramic Hand Soap..." and 3 more item(s)', date: "Mon, 16 Dec 2024 10:12:00 +0000", html, text },
      o, "Amazon", "2024-12-16", { totalPence: 0 });
  }
  // ---- Amazon, 2025: "Ordered: 'Wireless…'", the title cut in the HTML, "Quantity: 1", "Total" over "£" "21" "84"; the text
  // part has the whole title after "* " ---------------------------------------------------------------------------------------------
  {
    const name = "Harbourline Insulated Lunch Bag for Men and Women, Leakproof Cooler Tote with Front Pocket, 9L, Navy Blue";
    const o = order([{ name, qty: 1, unit: 1699 }]);
    const html = htmlPage("Amazon.co.uk", ["Ordered: ‘Harbourline Insulated Lunch...’", "Your Orders", "Thanks for your order, Sam!", "Arriving Thursday", "Sam – Leeds", "Order #", "‫202-9988776-5544332",
      "View or edit order", name.slice(0, 33) + "...", "Sold by Harbourline Goods", "Condition: New", "Quantity: 1", "£", "16", "99", "Total", "£", "16", "99"]);
    const text = ["Thanks for your order, Sam!", "Order #", "202-9988776-5544332", "View or edit order", "https://www.amazon.co.uk/gp/css/order-details?orderID=202-9988776-5544332",
      "* " + name, "Quantity: 1", "16.99 GBP", "Total", "16.99 GBP"].join("\n");
    add("holdout14a-amazon-ordered-2025", "Amazon", "'Ordered:' layout: the title cut in the HTML, whole after '* ' in the text part, 'Total' over a price in three cells",
      { from: '"Amazon.co.uk" <auto-confirm@amazon.co.uk>', subject: "Ordered: ‘Harbourline Insulated Lunch...’", date: "Wed, 2 Jul 2025 08:00:00 +0000", html, text }, o, "Amazon", "2025-07-02");
  }
  // ---- Amazon Video: "Review this item" and "Original Air Date:" under the episode are not details of it --------------------------
  {
    const name = "Puddle Lane Rangers: Season 3, Ep. 4 \"The Muddy Bridge\"";
    const o = order([{ name, qty: 1, unit: 159 }]);
    add("holdout14a-amazon-video", "Amazon", "a video bought: 'Sold by Amazon Digital UK Limited.', 'Review this item', 'Original Air Date:' over the day it first aired",
      { from: '"Amazon.co.uk" <digital-no-reply@amazon.co.uk>', subject: "Amazon.co.uk order of Puddle Lane Rangers: Season 3, Ep. 4.", date: "Mon, 1 Jan 2024 09:00:00 +0000",
        html: htmlPage("Amazon.co.uk", ["Amazon.co.uk", "Order Confirmation", "Order #", "D01-1234567-7654321", "Hello Sam,", "Thank you for shopping with us.", "Order details", "Order #", "D01-1234567-7654321",
          "Placed on Monday, January 1, 2024", name, "Sold by Amazon Digital UK Limited.", "Review this item", "Original Air Date:", "March 3, 2018", "£1.59", "Item Subtotal:", "£1.33",
          "Total Before VAT:", "£1.33", "VAT:", "£0.26", "Order Grand Total:", "£1.59"]) }, o, "Amazon", "2024-01-01");
  }
  // ---- Apple, HTML only: the app over the thing bought, "In-App Purchase", the phone it was bought on; "To cancel your purchase
  // within 14 days of receiving this invoice" -----------------------------------------------------------------------------------------
  {
    const o = order([{ name: "Treasure Chest Bundle", qty: 1, unit: 299, extras: ["Lantern Isles"] }]);
    const html = `<html><body><table><tr><td>Invoice</td></tr><tr><td><span>APPLE ACCOUNT</span><br>${h(SHOPPER.email)}</td><td><span>BILLED TO</span><br>Visa .... 4242 (Apple Pay)<br>${h(SHOPPER.name)}<br>GBR</td></tr>
<tr><td><span>INVOICE DATE</span><br><span dir="auto">14 Mar 2026</span></td><td><span>SEQUENCE NO.</span><br>2-1122334455</td></tr><tr><td><span>ORDER ID</span><br><a href="https://support.apple.com/kb/HT204088">MQTESTAB12</a></td><td><span>DOCUMENT NO.</span><br>700011122233</td></tr></table>
<table><tr class="section-header"><td colspan="3"><span>App Store</span></td></tr><tr><td class="artwork-cell"><img src="https://is1-ssl.mzstatic.com/image/thumb/app.png" alt=""></td><td class="item-cell">
<span class="title" dir="auto">
Lantern Isles
</span><br><span class="artist">Treasure Chest Bundle</span><br><span class="type">
In-App Purchase        </span><br><span class="device">Sam’s iPhone</span><br><a href="https://reportaproblem.apple.com/">Report a Problem</a></td>
<td class="price-cell"><table><tr><td colspan="3"><span>£2.99</span></td></tr><tr><td><span>Inclusive of VAT at <b>20%</b></span></td><td> </td><td><span>£0.50</span></td></tr></table></td></tr></table>
<table><tr><td>Subtotal</td><td> </td><td>£2.49</td></tr><tr><td>VAT charged at 20%</td><td> </td><td>£0.50</td></tr><tr><td>TOTAL</td><td></td><td>£2.99</td></tr></table>
<p>Get help with subscriptions and purchases. <a href="https://support.apple.com/billing">Visit Apple Support</a>.<br><br>To cancel your purchase within 14 days of receiving this invoice, <a href="https://reportaproblem.apple.com/">report a problem</a> or <a href="https://www.apple.com/uk/support/">contact us</a>.<br><a href="https://www.apple.com/legal/">Learn more about your right of withdrawal</a></p></body></html>`;
    add("holdout14a-apple-cancel-within", "Apple", "HTML only: app, thing bought, 'In-App Purchase', the phone it was bought on; 'To cancel your purchase within 14 days of receiving this invoice'",
      { from: "Apple <no_reply@email.apple.com>", subject: "Your invoice from Apple.", date: "Sat, 14 Mar 2026 20:41:50 +0000", html }, o, "Apple", "2026-03-14");
  }
  // ---- Apple: a refund asked for, and Apple's "Decision on refund request" that only says to look: neither is money back -------
  not("holdout14a-apple-refund-request", "Apple", "'A refund request has been received': decisions take 24-48 hours",
    { from: "Apple <no_reply@email.apple.com>", subject: "A refund request has been received", date: "Fri, 13 Mar 2026 13:17:05 +0000",
      text: `Dear ${SHOPPER.first},\n\nThis confirms a refund request for one or more items. Refund decisions take 24–48 hours to complete. Once a decision has been made on your refund request, you will get a follow-up email.\n\nApple Support` }, "refund_request");
  not("holdout14a-apple-refund-decision", "Apple", "'Decision on refund request' that names no outcome: 'To review, please visit Report a Problem'",
    { from: "Apple <no_reply@email.apple.com>", subject: "Decision on refund request", date: "Sat, 14 Mar 2026 11:36:17 +0000",
      text: `Dear ${SHOPPER.first},\n\nThere has been an update on the refund request for one or more items through Report a Problem. To review, please visit Report a Problem. After signing in, click “Check Status of Claims”.\n\nApple Support` }, "refund_request");
  // ---- Google Play: a subscription renewed, its text part wrapped at 75 characters, "Order number: GPA.…..3", the plan's price per
  // month, and the 14-day withdrawal right (the 2-hour rule for apps is not for subscriptions) --------------------------------------
  {
    const o = order([{ name: "Sketchbook Pro yearly with trial (Inkwell: Draw, Sketch & Paint Anywhere)", qty: 1, unit: 899 }]);
    const text = `Google Play

Thank you.

Your subscription from Google Commerce Limited on Google Play continues and
you've been charged.

Order number: GPA.3399-1234-5678-90123..3
Order date: 13-Apr-2019 14:17:42 BST

Item Price

Sketchbook Pro yearly with trial (Inkwell: Draw, Sketch & Paint Anywhere) (by
Inkwell Studio Ltd) £8.99/month

Monthly Subscription ‐ Next payment automatically charged on 13 May 2019

Total: £8.99/month

(Includes VAT of £1.50)

Payment method:

Visa-4242

By subscribing, you authorise us to charge you the subscription cost (as
described above) automatically, charged monthly to the payment method
provided. You can cancel at any time (learn more).

Under the law, you have an automatic statutory right of withdrawal from
contracts for the purchase of digital services for 14 days after you make
the purchase. Use this form to withdraw. After the first 14 days you will
not be eligible for a refund (or any alternative remedy) unless the
services are defective, unavailable or don't perform as stated. However,
you can cancel your subscription, and the cancellation will be effective
from the start of the next payment period.
After purchasing an app or game on Google Play, you can return it within
two hours for a full refund. This does not apply for in-app purchases or
in-app subscriptions.

© 2019 Google | All Rights Reserved.`;
    const html = htmlPage("", ["Thank you.", "Your subscription from Google Commerce Limited on Google Play continues and you've been charged.", "Order number: GPA.3399-1234-5678-90123..3",
      "Order date: 13-Apr-2019 14:17:42 BST", "Item | Price", "Sketchbook Pro yearly with trial (Inkwell: Draw, Sketch & Paint Anywhere) (by Inkwell Studio Ltd) | £8.99/month",
      "Monthly Subscription ‐ Next payment automatically charged on 13 May 2019", "Total: £8.99/month", "(Includes VAT of £1.50)", "Payment method: | Visa-4242", "© 2019 Google | All Rights Reserved."]);
    add("holdout14a-google-play-subscription", "Google Play", "a subscription renewal: 'Item Price', the name wrapped onto a second line with '(by developer)' and '£8.99/month', GPA order number",
      { from: "Google Play <googleplay-noreply@google.com>", subject: "Your Google Play Order Receipt from 13-Apr-2019", date: "Sat, 13 Apr 2019 13:17:45 +0000", html, text }, o, "Google Play", "2019-04-13");
  }
  not("holdout14a-google-play-sub-ending", "Google Play", "'Your … subscription will be cancelled': it ends on a day, no refund",
    { from: "Google Play <googleplay-noreply@google.com>", subject: "Your Inkwell: Draw, Sketch & Paint Anywhere subscription will be cancelled", date: "Mon, 15 Jul 2019 11:17:31 +0000",
      text: "Google Play\n\nYour Inkwell: Draw, Sketch & Paint Anywhere subscription from Google Commerce Limited on Google Play will be cancelled on 13 Aug 2019. No refunds will be issued (Refund Policy).\n" }, "subscription_ending");
  // ---- A game shop sold through Appcharge, bought in Mexico ("MX$ 30.00") and in the United States (a bare "$5.39") --------------
  const game = (id, layout, receipt, country, lines, money, total, date, when) => {
    const html = htmlPage("Purchase Confirmation", ["Purchase Confirmation", "LANTERN ISLES-BRIGHTFOX", "Receipt Number | " + receipt, "Payment Method | PayPal", "Payment Date | " + when,
      "Country | " + country, "Order ID | 6b0c1d2e3f405162738495a6", "Items", ...lines, ...money, "Total | " + total],
      `<p>Powered by <img alt="Appcharge" src="https://cdn.appcharge.com/logo.png"> For questions or assistance, contact <a href="https://appchargehelp.zendesk.com/hc/en-us/requests/new">Appcharge support</a></p>`);
    return { from: "no-reply <no-reply@appcharge.com>", subject: "Your LANTERN ISLES-BRIGHTFOX receipt #" + receipt, date, html };
  };
  {
    const o = order([{ name: "1,800 Pearls, 10 Compass Tokens", qty: 1, unit: 4500 }]);
    add("holdout14a-game-shop-mxn", "Lantern Isles", "a game shop's receipt in Mexican pesos: 'Subtotal MX$ 38.79', 'Tax (16%) MX$ 6.21', 'Total MX$ 45.00'",
      game("holdout14a-game-shop-mxn", "", "481-516-342", "Mexico", ["Pearls | 1,800", "Compass Tokens | 10"], ["Subtotal | MX$ 38.79", "Tax (16%) | MX$ 6.21"], "MX$ 45.00", "Sat, 30 May 2026 22:39:50 +0000", "May 30, 2026 10:39 PM UTC"),
      o, "Lantern Isles", "2026-05-30", { currency: "MXN" });
  }
  {
    const o = order([{ name: "Storm Lantern, 600 Pearls", qty: 1, unit: 647 }]);
    add("holdout14a-game-shop-usd", "Lantern Isles", "a game shop's receipt bought in the United States: a bare '$', 'Country United States, TX'",
      game("holdout14a-game-shop-usd", "", "612-904-337", "United States, TX", ["Storm Lantern | 1", "Pearls | 600"], ["Subtotal | $5.99", "Sales Tax (8%) | $0.48"], "$6.47", "Tue, 2 Jun 2026 15:30:58 +0000", "June 02, 2026 3:30 PM UTC"),
      o, "Lantern Isles", "2026-06-02", { currency: "USD" });
  }
  // ---- PayPal ----------------------------------------------------------------------------------------------------------------------
  const pp = (lines) => htmlPage("PayPal", lines, "<p>Copyright © 1999-2026 PayPal. All rights reserved.</p>");
  // A PayPal Debit Card purchase: the shop is the merchant PayPal names, never PayPal.
  {
    const o = order([]);
    const f = fixture("holdout14a-paypal-debit-card", "PayPal", "a PayPal Debit Card purchase: 'Merchant' over 'TAQUERIA*EL FARO', 'Total amount' over '£12.30 GBP'",
      { from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your PayPal Debit Card purchase", date: "Mon, 1 Jun 2026 20:00:00 +0000",
        html: pp(["Receipt for your PayPal Debit Card purchase", `${SHOPPER.name}, Receipt for your purchase at TAQUERIA*EL FARO.`, "Here's your receipt for your PayPal Debit Card purchase",
          "You used your PayPal Debit Card ending in ••••1234 at TAQUERIA*EL FARO on 1 June 2026.", "Transaction details", "Transaction ID", "4AB12345CD6789012", "Transaction date", "1 June 2026",
          "Merchant", "TAQUERIA*EL FARO", "Total amount", "£12.30 GBP", "Paid with PayPal balance", "£12.30 GBP"]) },
      { ...expected("TAQUERIA*EL FARO", "2026-06-01", o), items: [], totalPence: 1230 });
    out.push(f);
  }
  // A PayPal payment to the game shop's seller, in dollars, paid in pounds (PayPal's conversion): the dollars are the purchase.
  {
    const o = order([{ name: "Harbour Market Offer", qty: 1, unit: 599 }], { fees: [["Tax", 48]] });
    add("holdout14a-paypal-to-game-shop", "PayPal", "'You paid $6.47 USD to Appcharge', the item with 'Qty: 1' and 'Product ID', 'Total $6.47 USD', paid '£5.03 GBP' at PayPal's conversion rate",
      { from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to Appcharge", date: "Tue, 2 Jun 2026 15:31:50 +0000",
        html: pp(["Receipt for your payment to Appcharge", `${SHOPPER.name}, you've successfully sent a payment.`, `Hi ${SHOPPER.name},`, "You paid $6.47 USD to Appcharge",
          "Merchant | Appcharge help@appcharge.com", "Transaction date | 2 Jun 2026", "Harbour Market Offer", "Qty: 1", "Product ID: harbour_offer_2", "US$5.99", "Subtotal | US$5.99", "Tax | US$0.48", "Total | $6.47 USD",
          "Paid Appcharge with", "VISA Debit ••4242 | £5.03 GBP", "PayPal’s conversion rate: 1.0000 GBP = 1.2863 USD", "Currency conversion is performed by PayPal.", "Transaction ID: 7KL12345MN6789012"]) },
      o, "Appcharge", "2026-06-02", { currency: "USD" });
  }
  // Money sent to a person through PayPal (no merchant, no order, nothing listed): not a purchase.
  not("holdout14a-paypal-to-person", "PayPal", "'You sent a payment of £20.00 GBP to Sarah Jones': money to a person",
    { from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to Sarah Jones", date: "Mon, 2 Jun 2025 10:00:00 +0000",
      text: "You sent a payment of £20.00 GBP to Sarah Jones\nTransaction ID: 1AB23456CD789012E\nTransaction date 2 Jun 2025\nTotal £20.00 GBP\nPaid with PayPal balance\n" }, "payment_to_person");
  // A shop paid through PayPal whose names PayPal cuts short ("Cellar Club Online L...", "Wine Plan recurring p..."): said as given,
  // the label "Merchant" never read as the thing bought, the shop's long order number kept.
  {
    const o = order([{ name: "Wine Plan recurring p", qty: 1, unit: 2500 }]);
    add("holdout14a-paypal-cut-names", "PayPal", "'Merchant' over 'Cellar Club Online L...', 'Invoice ID' over the order number, the item cut short over 'Qty: 1' and '£25.00'",
      { from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to Cellar Club Online Limited", date: "Mon, 14 Apr 2025 08:00:00 +0000",
        html: pp(["Receipt for your payment to Cellar Club Online Limited", `${SHOPPER.name}, you've successfully sent a payment.`, "You paid £25.00 GBP to Cellar Club Online Limited",
          "Transaction date", "14 Apr 2025", "Merchant", "Cellar Club Online L...", "Invoice ID", "CC10807999-P001", "Wine Plan recurring p...", "Qty: 1", "£25.00",
          "Subtotal | £25.00", "Total | £25.00 GBP", "Paid Cellar Club Online L... with", "Mastercard ••4242 | £25.00 GBP"]) },
      o, "Cellar Club Online L", "2025-04-14", { shopAlso: ["Cellar Club Online Limited"] });
  }
  return out;
}
