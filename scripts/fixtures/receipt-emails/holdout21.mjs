// A twenty-fourth set of made-up emails (see lib.mjs), round 20 (20 Nov 2026): layouts in a real inbox that Relay read
// wrongly after round 19, written again with everything in them made up (shops, restaurants, items, prices, people,
// numbers, times). A takeaway app's receipt sent again after a refund ("We’ve updated your receipt for …", "Your refund has
// been applied", the refund under the payments as an amount over "Refund"), a ride's changed fare, an order the restaurant
// couldn't deliver at £0.00, a failed collection, a supermarket's refund for a few items of a purchase it names by number:
// none of them a purchase. And purchases Relay missed: a till receipt emailed by an e-receipt platform, a receipt that is
// only a picture, a receipt behind a link, a takeaway's own ordering page, a card platform's "Successful Payment", a
// subscription bought or started that day, a purchase confirmed with what it cost, a pre-order with no price, a shop's till
// receipt sent as an attachment. scripts/test-receipt-real-20.mjs reads these and joins them to their orders.
import { order, expected, page, fixture, h, SHOPPER } from "./lib.mjs";

const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("\n")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });
const UE = "Uber Receipts <noreply@uber.com>";
// (A takeaway app's receipt for an order whose items are only in its PDF, and the same receipt sent again after a refund.)
const eatsLines = (shop, total, day, paid) => [`Total\n${total}\n${day}`, `Thanks for ordering, ${SHOPPER.first}`, `Here's your receipt for ${shop}.`, `Total | ${total}`,
  "To view your full receipt go to Uber Eats, or download this PDF", "Payments", "Apple Pay Visa ••••1111", paid, total, "Visit the order page for more information, including invoices (where available).", `You ordered from ${shop}`];
const updatedLines = (shop, prev, now, refund, day, paid, back) => [`Total\n${now}\n${day}`, `Thanks for ordering, ${SHOPPER.first}`, `We’ve updated your receipt for ${shop}.`, `Total | ${now}`,
  "Your refund has been applied.", `Previous total | ${prev}`, `New Total | ${now}`, "Payments", "Apple Pay Visa ••••1111", paid, prev, "Apple Pay Visa ••••1111", back, `-${refund}`, "Refund",
  "Adjustment: £0.00", "Download PDF >", `You ordered from ${shop}`];

export const EATS = {
  // Two orders of the same total from the same restaurant on one evening, each refunded differently.
  first: { from: UE, subject: "Your Thursday evening order with Uber Eats", date: "Thu, 14 May 2026 18:05:20 +0000", lines: eatsLines("Noodle Yard (Riverside)", "£19.40", "14 May 2026", "14/05/2026 19:05") },
  second: { from: UE, subject: "Your Thursday evening order with Uber Eats", date: "Thu, 14 May 2026 19:41:05 +0000", lines: eatsLines("Noodle Yard (Riverside)", "£19.40", "14 May 2026", "14/05/2026 20:41") },
  firstUpdated: { from: UE, subject: "Your Thursday evening order with Uber Eats", date: "Fri, 15 May 2026 00:12:00 +0000", lines: updatedLines("Noodle Yard (Riverside)", "£19.40", "£13.15", "£6.25", "14 May 2026", "14/05/2026 19:05", "15/05/2026 01:12") },
  secondUpdated: { from: UE, subject: "Your Thursday evening order with Uber Eats", date: "Fri, 15 May 2026 03:30:00 +0000", lines: updatedLines("Noodle Yard (Riverside)", "£19.40", "£0.00", "£19.40", "14 May 2026", "14/05/2026 20:41", "15/05/2026 04:30") },
};

export default function holdout21() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  const not = (id, sender, layout, m, notPurchase) => out.push(fixture(id, sender, layout, m, { notPurchase, items: [], shop: null, date: null, currency: null, totalPence: null }));
  const none = (shop, date, extra = {}) => ({ shop, date, currency: null, items: [], subtotalPence: null, feesPence: 0, discountsPence: 0, tipsPence: 0, totalPence: null, ...extra });

  // ---- Not purchases --------------------------------------------------------------------------------------------------
  not("holdout21-eats-updated-after-refund", "Uber Eats", "the receipt sent again after a refund: 'We’ve updated your receipt for …', 'Your refund has been applied.', 'Previous total', 'New Total', the refund as '-£6.25' over 'Refund'",
    { ...EATS.firstUpdated, html: mail("Uber", "uber.com", EATS.firstUpdated.lines) }, { kind: "adjusted", refundPence: 625, merchant: "Noodle Yard (Riverside)" });
  not("holdout21-ride-fare-adjusted", "Uber", "a ride's changed fare: 'We adjusted the total for your recent ride.', 'fare adjustment', 'Previous total £8.40', 'New Total £0.00', '-£8.40' over 'Refund'",
    { from: UE, subject: "Your Saturday morning trip with Uber", date: "Sat, 16 May 2026 11:20:00 +0000", html: mail("Uber", "uber.com", ["Total\n£0.00\n16 May 2026", `Just a quick update, ${SHOPPER.first}`, "We adjusted the total for your recent ride.", "Total | £0.00", "fare adjustment",
      "Previous total | £8.40", "New Total | £0.00", "Payments", "Visa ••••1111", "16/05/2026 02:10", "£8.40", "Visa ••••1111", "16/05/2026 12:20", "-£8.40", "Refund", "This is not a tax invoice."]) }, { kind: "adjusted", refundPence: 840, merchant: null });
  not("holdout21-eats-not-delivered-zero", "Uber Eats", "an order that could not be delivered, at £0.00: 'Your order from … could not be delivered.', 'Here's your receipt for …', 'Total £0.00'",
    { from: UE, subject: "Your Tuesday evening order with Uber Eats", date: "Tue, 19 May 2026 19:30:00 +0000", html: mail("Uber", "uber.com", ["Total\n£0.00\n19 May 2026", "Your order from Pizza Corner could not be delivered.", "Here's your receipt for Pizza Corner.", "Total | £0.00",
      "Your order from Pizza Corner could not be delivered.", "To view your full receipt go to Uber Eats, or download this PDF", "You ordered from Pizza Corner"]) }, { kind: "cancellation" });
  not("holdout21-collection-failed", "Brightstore", "'Brightstore - we were unable to collect your order': a collection that didn't happen, its item at £0.00 and 'Total: £0.00'",
    { from: "Brightstore <info@brightstore.example>", subject: "Brightstore - we were unable to collect your order", date: "Sun, 06 Dec 2026 13:10:00 +0000",
      html: mail("Brightstore", "brightstore.example", [`${SHOPPER.first},\nJust to let you know we tried to collect your item(s) from you today but were unable to. Please contact us within the next 7 days to rearrange your collection.`,
        "Home delivery items", "Order Number:\n2200334455", "Subtotal", "SMART KETTLE 1.7L BRUSHED STEEL\nQty 1 | £0.00", "Delivery: | £0.00", "Savings: | £0.00", "Total: | £0.00"]) }, { kind: "cancellation" });
  not("holdout21-grocer-item-refund", "Greengrocer", "'Item refund for purchase 1234-5678-90': 'We've arranged a refund for the below amount.', 'Qty | Product | Total', '3 | Yoghurt 150g | 2.70'",
    { from: "Greengrocer <no-reply@mail.greengrocer.example>", subject: "Item refund for purchase 1234-5678-90", date: "Mon, 08 Jun 2026 09:40:00 +0000",
      html: mail("Greengrocer", "greengrocer.example", ["Order Refund", `Hello ${SHOPPER.first},`, "Thanks for letting us know about the problem with your recent purchase.", "We've arranged a refund for the below amount. If you paid using a card, the amount will show in your account in 3–5 working days.",
        "Your items", "Qty | Product | Total", "3 | Example Dairy Strawberry Yoghurt 150g | 2.70", "We're sorry for any inconvenience - and thank you for shopping with Greengrocer"]) }, { kind: "adjusted", refundPence: 270, merchant: null });
  not("holdout21-subscription-trial-later", "StreamBox", "a subscription whose first payment is weeks away (a free trial): 'You'll be charged £7.49/1 month(s) starting on 30/03/2026'",
    { from: "StreamBox <hello@account.streambox.example>", subject: "Welcome to your Plus subscription", date: "Mon, 02 Mar 2026 20:00:00 +0000",
      html: mail("StreamBox", "streambox.example", ["Welcome to your Plus subscription", "Hello,\nThanks for subscribing to StreamBox Plus. Here are some details about your subscription:\n1. Your free trial has started.\n2. You'll be charged £7.49/1 month(s) starting on 30/03/2026.\n3. Your card will be charged on the same date of each month, unless you cancel before that time."]) }, { kind: "trial" });

  // ---- Purchases Relay missed --------------------------------------------------------------------------------------------
  {
    const o = order([{ name: "Steel Mop Bucket", qty: 1, unit: 1800 }, { name: "Linen Napkins Set of 4", qty: 2, unit: 600 }, { name: "Glass Storage Jar 1L", qty: 3, unit: 450 }, { name: "Beeswax Candle Small", qty: 1, unit: 350 }, { name: "Oven Glove Pair", qty: 2, unit: 975 }]);
    add("holdout21-ecrebo-till-ereceipt", "Homewares Co", "an e-receipt platform's till receipt: 'Item | Price', lines in pounds with no '£' ('Steel Mop Bucket | 18.00'), 'Quantity: 2 at £6.00 each' under a name, then 'S/N: | | 12.00', 'TOTAL' over '9 Items | £64.50'",
      { from: "Homewares Co <no-reply@homewares-prod.ecrebo.com>", subject: "Your Digital Receipt", date: "Sat, 21 Nov 2026 14:40:00 +0000",
        html: mail("Homewares Co", "homewares.example", ["E-RECEIPT", "Homewares Co - Home Comforts", "E-Receipt", "Item | Price", "Steel Mop Bucket | 18.00", "Linen Napkins Set of 4\nQuantity: 2 at £6.00 each\nS/N: | | 12.00",
          "Glass Storage Jar 1L\nQuantity: 3 at £4.50 each\nS/N: | | 13.50", "Beeswax Candle Small | 3.50", "Oven Glove Pair\nQuantity: 2 at £9.75 each\nS/N: | | 19.50", "TOTAL\n9 Items | £66.50",
          "Cashier | Till | Transaction No.", "alex | 0002 | 1001", "21/11/26 14:39", "Card Type | Card | £66.50", "Thank you for shopping at Homewares Co", "Powered by Ecrebo"]) },
      o, "Homewares Co", "2026-11-21");
  }
  add("holdout21-yreceipts-picture", "Tailor & Co", "an e-receipt platform's receipt that is only a picture: 'Your receipt from Tailor & Co', the email's words only the shop's name",
    { from: "Tailor & Co Leeds <receipts@yreceipts.com>", subject: "Your receipt from Tailor & Co", date: "Sat, 05 Feb 2022 15:14:00 +0000", html: page({ brand: "Tailor & Co", domain: "tailorandco.example", rows: [`<p>Tailor &amp; Co.</p><img src="https://img.yreceipts.example/r/1.png" alt="">`] }) },
    order([]), "Tailor & Co", "2022-02-05", none("Tailor & Co", "2022-02-05"));
  out[out.length - 1].expected = none("Tailor & Co", "2022-02-05", { attachmentOnly: "image" });
  add("holdout21-meandu-view-receipt", "Wine Bar Riverside", "an order-and-pay platform's 'Your receipt from Wine Bar Riverside', the receipt only behind 'View receipt'",
    { from: "me&u Mail <mail@noreply.meandu.com>", subject: "Your receipt from Wine Bar Riverside", date: "Sat, 31 Oct 2026 17:24:00 +0000",
      html: mail("me&u", "meandu.com", ["Thanks for your order at Wine Bar Riverside!", "View your order & receipt from Wine Bar Riverside by clicking the button below.", "View receipt", "Find out how restaurants use me&u to serve their guests."]) },
    order([]), "Wine Bar Riverside", "2026-10-31");
  out[out.length - 1].expected = none("Wine Bar Riverside", "2026-10-31");
  {
    const o = order([{ name: "Paneer Tikka Masala", qty: 1, unit: 850, extras: ["Paneer"] }, { name: "Vegetable Pakora", qty: 1, unit: 395 }, { name: "Garlic Naan", qty: 2, unit: 345 }, { name: "Mango Lassi", qty: 1, unit: 325 }],
      { fees: [["Delivery", 250], ["Bag fee", 10], ["Service fee", 50]], discounts: [["Discount 10%", 226]] });
    add("holdout21-orderyoyo-pcs-name-total", "Spice House", "a takeaway's own ordering page: 'Spice House | Your order 10203040 is accepted', 'Pcs | Name | Total', each thing as '1' / name / '+ Paneer' / '£ | 8.50', then 'Subtotal', 'Discount 10%', 'Delivery', 'Bag fee', 'Service fee', 'Total (Incl. VAT)'",
      { from: "no-reply@orderyoyo.com", subject: "Spice House | Your order 10203040 is accepted", date: "Mon, 28 Dec 2026 18:30:00 +0000",
        html: mail("Spice House", "spicehouse.example", ["Your order has been accepted", `Hello ${SHOPPER.first},\nThank you for your order.\nWe have received it and will get started on your order.\nOrder No: 10203040`, "Pcs | Name | Total",
          "1", "Paneer Tikka Masala", "+ Paneer", "£ | 8.50", "1", "Vegetable Pakora", "£ | 3.95", "2", "Garlic Naan", "£ | 6.90", "1", "Mango Lassi", "£ | 3.25",
          "Subtotal", "£ | 22.60", "Discount 10%", "£ | -2.26", "Delivery", "£ | 2.50", "Bag fee", "£ | 0.10", "Service fee", "£ | 0.50", "Total (Incl. VAT)", "£ | 23.44", "Bon appetit!", "Powered by\nOrderYOYO"]) },
      o, "Spice House", "2026-12-28", { orderRef: "10203040" });
  }
  add("holdout21-viva-successful-payment", "Cloud Shop", "a card platform's 'Successful Payment': 'Requested by | Example Trading Ltd', 'Description | Cloud Shop', 'Amount | £21.40', no things named",
    { from: "Viva Wallet <no-reply@vivawallet.com>", subject: "Viva Wallet: Successful Payment", date: "Mon, 10 Oct 2022 19:48:00 +0000",
      html: mail("Viva", "vivawallet.com", [`Dear ${SHOPPER.name},`, "Payment Info", "Requested by | Example Trading Ltd", "Description | Cloud Shop", "Payment method | Card", "Amount | £21.40", "Transaction invoice", "Viva Wallet enables Example Trading Ltd to accept card payments."]) },
    order([]), "Cloud Shop", "2022-10-10");
  out[out.length - 1].expected = none("Cloud Shop", "2022-10-10", { currency: "GBP", totalPence: 2140 });
  add("holdout21-subscription-processed", "Gamebox", "'Your purchase of Game Club Plus has been processed', 'We've charged GBP 9.49 to your card', 'Subscription: Game Club Plus'",
    { from: "Gamebox <noreply@gamebox.example>", subject: "Your purchase of Game Club Plus has been processed", date: "Fri, 09 May 2025 20:55:00 +0000",
      html: mail("Gamebox", "gamebox.example", ["Your purchase of Game Club Plus has been processed", "Thanks for subscribing.", "Your purchase of Game Club Plus has been processed\nThanks for subscribing to Game Club Plus.\nWe've charged GBP 9.49 to Visa **1111. For a complete breakdown of charges, see your order details.\nStarting Thursday, June 19, 2025, your payment of GBP 9.49 including taxes will be charged automatically every 1 month.",
        "Subscription Information\nSubscription: Game Club Plus\nOrder Number: 7001002003\nPlan Price: GBP 9.49 including taxes/1 month\nRenewal Date: 19 June 2025"]) },
    order([{ name: "Game Club Plus", qty: 1, unit: 949 }]), "Gamebox", "2025-05-09", { orderRef: "7001002003" });
  add("holdout21-subscription-started-today", "StreamBox", "'Thanks for subscribing to StreamBox Plus', 'You'll be charged £7.49/1 month(s) starting on 02/03/2026', sent that day",
    { from: "StreamBox <hello@account.streambox.example>", subject: "Welcome to your Plus subscription", date: "Mon, 02 Mar 2026 20:00:00 +0000",
      html: mail("StreamBox", "streambox.example", ["Welcome to your Plus subscription", "Hello,\nThanks for subscribing to StreamBox Plus. Here are some details about your subscription:\n1. You've now got access to every box set.\n2. You'll be charged £7.49/1 month(s) starting on 02/03/2026.\n3. Your card will be charged on the same date of each month, unless you cancel before that time."]) },
    order([{ name: "StreamBox Plus", qty: 1, unit: 749 }]), "StreamBox", "2026-03-02");
  add("holdout21-plan-purchase-cost", "Skyport Wi-Fi", "'Plan Purchase - Terminal 2': 'Here's a quick email to confirm your purchase.', 'You've chosen: Fast Wi-Fi 24h', 'Cost: 4.00 GBP'",
    { from: "Skyport Wi-Fi <no-reply@skyport-wifi.example>", subject: "Plan Purchase - Terminal 2", date: "Sat, 03 Oct 2026 05:35:00 +0000",
      html: mail("Skyport Wi-Fi", "skyport-wifi.example", ["Plan Purchase - Fast Wi-Fi", `Hi ${SHOPPER.first},\nThanks for choosing us to get online at Terminal 2.\nHere's a quick email to confirm your purchase.\nYou've chosen: Fast Wi-Fi 24h\nValid for: 24 hours (from date of activation)\nCost: 4.00 GBP\nPlease note that you will receive a receipt for your purchase within the next 24 hours via email.`]) },
    order([{ name: "Fast Wi-Fi 24h", qty: 1, unit: 400 }]), "Skyport Wi-Fi", "2026-10-03");
  add("holdout21-preorder-no-price", "Harbour Brewing", "'Your Harbour Light Lager order', 'Thanks for your Harbour Light Lager order.', 'getting your pre-order ready', no price anywhere",
    { from: "Harbour Brewing <hello@info.harbourbrewing.example>", subject: "Your Harbour Light Lager order", date: "Wed, 04 Nov 2020 16:06:00 +0000",
      html: mail("Harbour Brewing", "harbourbrewing.example", ["Your Harbour Light Lager order", "Thanks for your Harbour Light Lager order.\nWe are busy getting your pre-order ready and will start dispatching orders next week.\nCheers,\nHarbour Brewing"]) },
    order([]), "Harbour Brewing", "2020-11-04");
  out[out.length - 1].expected = none("Harbour Brewing", "2020-11-04", { items: [{ name: "Harbour Light Lager", qty: 1, linePence: null }], partial: true });
  {
    // A shop's till receipt sent as a PDF attachment, the email only saying so.
    const f = fixture("holdout21-store-receipt-attachment", "Peak Outdoor", "'Receipt from your recent purchase': 'Please find attached the receipts from your recent purchase.', the receipt a PDF",
      { from: "PEAK OUTDOOR <no-reply-ereceipt@peakoutdoor.example>", subject: "Receipt from your recent purchase", date: "Sat, 18 Apr 2026 17:12:00 +0000",
        html: page({ brand: "Peak Outdoor", domain: "peakoutdoor.example", rows: ["<p>Peak Outdoor Retail Leeds</p><p>Dear Customer</p><p>Please find attached the receipts from your recent purchase.</p><p>Do Not Reply To This Email.</p>"] }) },
      none("Peak Outdoor", "2026-04-18", { attachmentOnly: "pdf", shopAlso: ["PEAK OUTDOOR", "Peakoutdoor"] }));
    f.attach = [{ type: "application/pdf", name: "receipt.pdf" }];
    out.push(f);
  }
  return out;
}
