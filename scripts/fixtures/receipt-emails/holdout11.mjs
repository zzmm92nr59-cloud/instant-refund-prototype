// A twelfth set of made-up emails (see lib.mjs), round 10 (19 Nov 2026): the layouts of the receipts in Connor's own inbox
// that Relay read wrong, written again with everything in them made up (restaurants, shops, items, prices, people, addresses,
// order numbers). The senders whose own wording the reader goes by (Uber, Just Eat, Sainsbury's, Apple, Domino's) keep their
// names; every other shop here is invented. Each email is laid out the way the real one was: one table row per line, the
// labels and their amounts in rows of their own.
import { order, expected, page, fixture, gbp, h, SHOPPER } from "./lib.mjs";

// Rows as the real emails had them: each line its own row, " | " between the cells of one row.
const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${l.split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });

export default function holdout11() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  const not = (id, sender, layout, m, notPurchase) => out.push(fixture(id, sender, layout, m, { notPurchase, items: [], shop: null, date: null, currency: null, totalPence: null }));
  const none = order([]);

  // ---- Uber Eats: a receipt that lists no items, with Uber One's saving under the total -----------------------------------
  {
    const lines = ["14 Nov 2026", "19:42", `Thanks for ordering, ${SHOPPER.first}`, "14 Nov 2026 , 19:42", "Here's your receipt for Tandoor Lane (Bow).", "Total | £21.36",
      "To view your full receipt go to Uber Eats, or download this PDF", "£6.40", "Uber One savings and other promotions applied", "Payments", "Visa •••• 4821 | £21.36", "14/11/2026 19:43",
      "Want to switch your payment method? | Switch", "Order details", SHOPPER.address, "Delivered by Alex", "Rate your order", "Order completed | 14 Nov 2026 at 20:21", "Need help?", "Contact Support"];
    add("holdout11-ue-no-item-list", "Uber Eats", "receipt with no item list, 'Uber One savings' amount under the total", { from: "Uber Receipts <noreply@uber.com>", subject: "Your Saturday evening order with Uber Eats", date: "Sat, 14 Nov 2026 19:45:00 +0000",
      html: mail("Uber", "uber.com", lines) }, none, "Uber Eats", "2026-11-14", { totalPence: 2136, merchant: "Tandoor Lane (Bow)", noItemList: true });
  }
  // ---- Uber: a ride with a pet fee and Uber One credits, and a ride with a wait time --------------------------------------
  {
    const lines = ["12 Nov 2026", "18:05", "12 Nov 2026 , 18:05", `Thanks for riding, ${SHOPPER.first}`, "We hope you enjoyed your ride this evening.", "Total | £27.85", "£1.39", "Uber One credits earned", "Trip fare", "£25.62",
      "Uber pet fee | £3.47", "Uber One credits | -£1.24", "Payments", "Visa •••• 4821 | £27.85", "This is not a tax invoice.", "Trip details", "6.10 miles, 31 minutes", "You rode with Alex | 4.91", "Rate or tip", "Report lost item"];
    add("holdout11-uber-pet-ride", "Uber", "ride: trip fare, pet fee, Uber One credits used and earned", { from: "Uber Receipts <noreply@uber.com>", subject: "Your Thursday evening trip with Uber", date: "Thu, 12 Nov 2026 18:50:00 +0000",
      html: mail("Uber", "uber.com", lines) }, order([{ name: "Uber Pet ride", qty: 1, unit: 2785 }]), "Uber", "2026-11-12");
  }
  {
    const lines = ["9 Nov 2026", "07:12", "9 Nov 2026 , 07:12", `Thanks for riding, ${SHOPPER.first}`, "We hope you enjoyed your ride this morning.", "Total | £18.20", "£0.91", "Uber One credits earned", "Trip fare", "£17.84", "Wait Time", "£0.36",
      "Payments", "Visa •••• 4821 | £18.20", "A charge for wait time has been added to your payment.", "Trip details", "4.02 miles, 22 minutes"];
    add("holdout11-uber-ride-wait", "Uber", "ride: trip fare and wait time on rows of their own", { from: "Uber Receipts <noreply@uber.com>", subject: "Your Monday morning trip with Uber", date: "Mon, 09 Nov 2026 07:40:00 +0000",
      html: mail("Uber", "uber.com", lines) }, order([{ name: "Uber ride", qty: 1, unit: 1820 }]), "Uber", "2026-11-09");
  }
  // ---- Uber Eats: a changed total for an earlier order (money back, never a purchase) -------------------------------------
  not("holdout11-ue-adjusted-total", "Uber Eats", "'We adjusted the total for your recent order', previous total, refund, new total", { from: "Uber Receipts <noreply@uber.com>", subject: "Your Saturday evening order with Uber Eats", date: "Mon, 16 Nov 2026 10:00:00 +0000",
    html: mail("Uber", "uber.com", ["14 Nov 2026", "19:42", "Refunded", "Just a quick update, " + SHOPPER.first, "We adjusted the total for your recent order from Tandoor Lane (Bow).", "Total | £15.11", "Your refund has been applied.",
      "Previous total | £21.36", "Refund | -£6.25", "New Total | £15.11", "Payments", "Visa •••• 4821 | £21.36", "Visa •••• 4821", "-£6.25", "16/11/2026 09:58 | Refund"]) }, { kind: "adjusted", refundPence: 625, merchant: "Tandoor Lane (Bow)" });

  // ---- Just Eat: the restaurant's name, a multi-buy discount under an item, a deal's parts, two of a dip at a unit price -----
  {
    const o = order([{ name: "Crispy Chilli Beef", qty: 1, unit: 795 }, { name: "Egg Fried Rice", qty: 1, unit: 395 }, { name: "Vegetable Spring Rolls", qty: 1, unit: 450 }, { name: "Prawn Toast", qty: 1, unit: 420 }],
      { fees: [["Service fee 5% (min £0.75 max £1.49)", 103], ["Delivery", 249]], discounts: [["Multi-buy discount", 420], ["Voucher", 500]] });
    const lines = ["Your order's been received", "Your Golden Lantern order will be with you soon.", "Great news! Golden Lantern has received your order. Do you have questions or comments about your order? Please contact the restaurant by telephone via 020 7946 0000.",
      "Please ensure your profile address is correct.", SHOPPER.address, "Golden Lantern", "1 | Crispy Chilli Beef", "£7.95", "1 | Egg Fried Rice", "£3.95", "1", "Vegetable Spring Rolls", "£4.50", "1 | Prawn Toast", "£4.20",
      "Multi-buy discount: | -£4.20", "Subtotal: | £16.40", "Voucher: | -£5.00", "Service fee 5% (min £0.75 max £1.49): | £1.03", "Delivery: | £2.49", "Total: | £14.92"];
    add("holdout11-je-restaurant-multibuy", "Just Eat", "restaurant named at the top; 'Multi-buy discount: -£4.20' under the last item", { from: "Just Eat <no-reply@order.just-eat.co.uk>", subject: "Sam, order confirmed", date: "Wed, 18 Nov 2026 20:10:00 +0000",
      html: mail("Just Eat", "just-eat.co.uk", lines) }, o, "Just Eat", "2026-11-18", { totalPence: 1492, merchant: "Golden Lantern" });
  }
  {
    const o = order([{ name: "Garlic Bread", qty: 1, unit: 150 }, { name: "Pizza Pair Deal", qty: 1, unit: 2899 + 350, extras: ["Hawaiian Pizza", "Spicy Beef Pizza"] }], { fees: [["Delivery", 199]], discounts: [["Offer discount", 1700]] });
    const lines = ["Your Slice Street order will be with you soon.", "Great news! Slice Street has received your order.", "Slice Street", "1 | Garlic Bread", "£1.50", "1 | Pizza Pair Deal", "£28.99", "Hawaiian Pizza", "+", "Deep Pan",
      "Spicy Beef Pizza", "+ | Cheese Stuffed Crust", "£3.50", "Subtotal: | £33.99", "Offer discount: | -£17.00", "Delivery: | £1.99", "Total:", "£18.98"];
    add("holdout11-je-deal-parts-extra-price", "Just Eat", "a deal's two pizzas under it, the second's extra priced on the last line", { from: "Just Eat <no-reply@order.just-eat.co.uk>", subject: "Sam, order confirmed", date: "Fri, 11 Sep 2026 19:00:00 +0000",
      html: mail("Just Eat", "just-eat.co.uk", lines) }, o, "Just Eat", "2026-09-11", { merchant: "Slice Street" });
  }
  // ---- Apple: an Apple service renewal, its total only on the card line --------------------------------------------------
  {
    const lines = ["Invoice", "16 November 2026", "Sequence:", "2-10051840001", "Order ID:", "MQKY7ABCDE", "Document:", "754220300001", "Apple Account:", SHOPPER.email, "Apple TV", "Apple TV (Monthly)", "Renews 16 December 2026", "£9.99",
      "Inclusive of VAT at 20%£1.67", "Billing and Payment", SHOPPER.name, SHOPPER.address, "United Kingdom", "Subtotal", "£8.32", "VAT charged at 20%", "£1.67", "Visa •••• 4821 (Apple Pay)", "£9.99",
      "You can turn off renewal receipts to stop getting emails for each subscription renewal or payment.", "Manage Subscriptions ›", "Report a Problem ›"];
    add("holdout11-apple-service-renewal", "Apple", "an Apple service over its plan; no 'Total', the amount on the card line; VAT on top of the subtotal", { from: "Apple <no_reply@email.apple.com>", subject: "Your receipt from Apple.", date: "Mon, 16 Nov 2026 08:00:00 +0000",
      html: mail("Apple", "apple.com", lines) }, order([{ name: "Apple TV (Monthly)", qty: 1, unit: 999 }]), "Apple", "2026-11-16");
  }
  // ---- Sainsbury's: the confirmation, then the delivery-day email for the same order -------------------------------------
  {
    const items = [["Sainsbury's Seeded Bloomer 800g", 1, 135, "£1.35/unit"], ["Sainsbury's Wholemeal Wraps x8", 1, 110, "£1.10/unit"], ["Sainsbury's Kitchen Roll x2", 1, 250, "£3.00/unit"],
      ["Sainsbury's Smoked Mackerel Fillets with Cracked Black Peppercorns, Taste the Difference x2 200g", 2, 600, "£3.75/unit"], ["Sainsbury's Frozen Mango Chunks 500g", 1, 0, "£2.40/unit"],
      ["Highland Spring Still Water 6 x 1.5L Multipack", 1, 325, "£3.25/unit"], ["Ecover Non-Bio Laundry Liquid Lavender & Eucalyptus Concentrated 1.43L (41 washes) Limited Edition", 1, 650, "£8.00/unit"]];
    const o = order(items.map(([name, qty, line]) => ({ name, qty, unit: line / qty })), { fees: [["Delivery cost", 150]] });
    const lines = ["Order Confirmation - Sainsbury's", "What you need to know", "We've got your order", "Order number", "1371002456", "Estimated total", gbp(o.total) + "*", "You've saved £4.85", "Save with Your Nectar Prices next time", "£4.85", "with Nectar prices",
      "Your payment details", "Payment card: VISA ending in 4821", "We'll take payment for your order on Sunday, 15 November.", "Address:", SHOPPER.address, "Groceries", "(7 items)", "Items", "Quantity", "Qty", "Price",
      ...items.flatMap(([n, q, p, u]) => [n, String(q), gbp(p), u, "Substitution allowed"]), "Your order summary", "Trolley cost", gbp(o.subtotal), "Delivery cost", "£1.50", "Savings from coupons", "£0.00", "Estimated total", gbp(o.total) + "*"];
    add("holdout11-sainsburys-confirmation", "Sainsbury's", "order number under its label, long names, 'x8' in names, offer prices under unit prices, a Nectar saving line", { from: "Sainsbury's <service@sainsburys.co.uk>", subject: "Thanks for your order - 1371002456",
      date: "Thu, 12 Nov 2026 12:00:00 +0000", html: mail("Sainsbury's", "sainsburys.co.uk", lines) }, o, "Sainsbury's", "2026-11-12");
    const day = add("holdout11-sainsburys-day-of", "Sainsbury's", "delivery-day email: payment received, only a short-life item listed, e-receipt attached", { from: "Sainsbury's <service@sainsburys.co.uk>", subject: "Receipt for your Sainsbury’s order 1371002456",
      date: "Sun, 15 Nov 2026 06:40:00 +0000",
      html: mail("Sainsbury's", "sainsburys.co.uk", ["Today 7:00am to 11:00am", "What you need to know", "Your order is ready for today", "Order number: | 1371002456", "Payment received: | £23.10", "We've picked your items", "Good news, we've got everything you ordered.",
        "Shorter life products (1)", "Items | Quantity | Price", "Sainsbury's Seeded Bloomer 800g | at a quantity of 1 | £1.35", "Your e-receipt", "We've attached your e-receipt to this email."]) },
      none, "Sainsbury's", "2026-11-15", { totalPence: 2310, attachmentOnly: "pdf", orderUpdate: "paid", orderRef: "1371002456" });
    day.attach = [{ type: "application/pdf", name: "e-receipt.pdf" }];
  }
  // ---- A game's web shop: a pack of several things -------------------------------------------------------------------------
  add("holdout11-game-pack", "Appcharge", "Items, then each thing in the pack and how many on rows of their own", { from: "Puzzle Pals <receipts@appcharge.com>", subject: "Purchase Confirmation", date: "Tue, 13 Oct 2026 10:13:00 +0000",
    html: mail("Puzzle Pals", "appcharge.com", ["Purchase Confirmation", "PUZZLE PALS", "Receipt Number", "121-000-846", "Payment Date", "October 13, 2026 10:13 AM UTC", "Items", "Lucky Cat", "1", "Rainbow Sticker", "1", "Hammers", "10",
      "Subtotal | £1.99", "Tax (20%) | £0.40", "Total | £2.39"]) }, order([{ name: "Lucky Cat, Rainbow Sticker, 10 Hammers", qty: 1, unit: 239 }]), "Puzzle Pals", "2026-10-13", { shopAlso: ["Appcharge"] });
  // ---- A software subscription billed by Stripe: legal name, the period on its own line, a credit, VAT on top -------------
  add("holdout11-stripe-plan-credit", "Northlight", "period line over the plan, unused-time credit, VAT added to the subtotal", { from: "Northlight Labs Ireland, Limited <invoice+statements+acct_9@stripe.com>", subject: "Your receipt from Northlight Labs Ireland, Limited #4410-2210", date: "Mon, 26 Oct 2026 09:00:00 +0000",
    html: mail("Northlight Labs Ireland, Limited", "stripe.com", ["Receipt from Northlight Labs Ireland, Limited", "£45.60", "Paid on October 26, 2026 with", "Receipt #4410-2210", "Oct 26–Nov 26, 2026", "Studio plan - Team", "Qty 1", "£48.00",
      "Unused time on Starter plan after 26 Oct 2026", "Qty 1", "-£10.00", "Subtotal", "£38.00", "Total excluding tax", "£38.00", "VAT - United Kingdom (20%)", "£7.60", "Total", "£45.60", "Amount paid", "£45.60"]) },
    order([{ name: "Studio plan - Team", qty: 1, unit: 4800 }]), "Northlight Labs", "2026-10-26", { totalPence: 4560, shopAlso: ["Northlight Labs Ireland", "Northlight"] });
  // ---- A shop's changed order (Shopify): the line taken off at × 0, the size swapped in --------------------------------------
  not("holdout11-shopify-order-edit", "Stride Yard", "an edited order's invoice asking for the balance ('Payment of £12.00 is due', 'Pay now', 'Already paid £84.00'): the purchase is the original order, so this is not a second one", { from: "Stride Yard <store@strideyard.example>", subject: "Invoice #2041", date: "Tue, 10 Nov 2026 12:00:00 +0000",
    html: mail("Stride Yard", "strideyard.example", ["Stride Yard", "Invoice #2041", "Payment of £12.00 is due", "Pay now", "Order summary", "Trail Glide Runners × 0", "UK 8", "Removed 1 of 1", "£0.00", "Trail Glide Runners × 1", "UK 9", "Added 1", "£96.00",
      "Subtotal", "£96.00", "Shipping", "£0.00", "Updated total", "£96.00", "Already paid", "£84.00", "Amount to pay", "£12.00 GBP"]) }, { kind: "balance invoice" });
  // ---- A mobile network's eSIM order: the row named "SIM 1", the plan in a cell, no total named --------------------------------
  add("holdout11-esim-table", "Lumo Mobile", "a table row 'SIM 1 | order id | eSIM | -- | Plan | £5.00', headings stacked one per line, no total", { from: "Lumo Mobile <noreply@lumomobile.example>", subject: "Your Lumo Mobile order", date: "Fri, 25 Sep 2026 14:18:00 +0000",
    html: mail("Lumo Mobile", "lumomobile.example", ["Lumo Mobile", "Order.No", "RD0099000011", "Thank you for ordering your Lumo Mobile eSIM.", "ORDER ID: ORDB1000000000001", "Details", "S.", "No", "Order", "Id", "Sim", "type", "Bundle", "Name", "Amount",
      "SIM 1 | ORDB1000000000001 | eSIM | -- | Talk Plus 10GB | National | £6.00", "Your eSIM with your chosen plan is ready to be installed."]) },
    order([{ name: "Talk Plus 10GB", qty: 1, unit: 600 }]), "Lumo Mobile", "2026-09-25");
  // ---- Domino's: the total before the deal, then the amount after it ----------------------------------------------------------
  {
    const lines = ["Dominos Pizza Order Confirmation", `Hey ${SHOPPER.first},`, "Your details", "Order number: 1028000111", "On: Thu 27/08/26", "Your order", "For full ingredients, nutritional and allergen information, see", "our nutritional page.",
      "Cheesy Garlic Dip - 100g", "£1.99", "Qty: 1", "Vegi Supreme™", "Medium 11.5\" Classic Crust", "£19.99", "Qty: 1", "Pepperoni Passion™", "Medium 11.5\" Italian Style Crust", "£20.99", "Qty: 1",
      "50% OFF PIZZAS WHEN YOU SPEND £30", "£-20.49", "Delivery:", "£2.99", "Total:", "£45.96", "£25.47"];
    add("holdout11-dominos-total-after-deal", "Domino's", "'Total: £45.96' then '£25.47' after the deal; '£-20.49' with the minus after the pound sign", { from: "Domino's Pizza <noreply@dominos.co.uk>", subject: "Dominos Pizza Order Confirmation", date: "Thu, 27 Aug 2026 18:30:00 +0000",
      html: mail("Domino's", "dominos.co.uk", lines) }, order([{ name: "Cheesy Garlic Dip - 100g", qty: 1, unit: 199 }, { name: "Vegi Supreme™", qty: 1, unit: 1999 }, { name: "Pepperoni Passion™", qty: 1, unit: 2099 }]), "Domino's", "2026-08-27", { totalPence: 2547 });
  }
  // ---- A shop owning up that its "order confirmation" was a marketing email ---------------------------------------------------
  not("holdout11-no-order-apology", "Velvetine", "'There was no order. Nothing has been charged'", { from: "Velvetine <team@e.velvetine.example>", subject: "About that \"order confirmation\". There wasn't one. Sorry.", date: "Fri, 28 Aug 2026 16:00:00 +0000",
    html: mail("Velvetine", "velvetine.example", ["About that \"order confirmation\". There wasn't one. Sorry.", "Nothing was ordered, nothing was charged. Just us, owning up.", `Hi ${SHOPPER.first},`,
      "Earlier today we sent you an email with the subject line \"Order #40112 confirmed\".", "There was no order. Nothing has been charged, your details are safe.", "It was a marketing email for our sale, dressed up as something it wasn't."]) }, { kind: "no order" });
  return out;
}
