// An eighteenth set of made-up emails (see lib.mjs), round 15d (20 Nov 2026): layouts of Google Play, Appcharge, PayPal,
// travel agents, Stripe and others in Connor's own inbox that Relay read wrong, written again with everything in them made
// up (items, prices, people, addresses, order numbers). The senders keep their names and addresses: the reader goes by their
// layouts.
import { order, expected, fixture, h, SHOPPER } from "./lib.mjs";

const cells = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const htmlPage = (title, lines, foot = "") => `<html><head><title>${h(title)}</title></head><body>${cells(lines)}${foot}</body></html>`;

// A game's web shop sold through Appcharge (the layout of its receipts in 2025–26): the game's title, the receipt number and
// payment details, the shop's own 24-character "Order ID", then "Items" with each thing in the pack on a row of its own.
export const gameReceipt = (receipt, orderId, country, lines, money, total, date, when, pay = "Apple Pay") => ({
  from: "no-reply <no-reply@appcharge.com>", subject: "Your HARBOUR HEROES-TIDEWORKS receipt #" + receipt, date,
  html: htmlPage("Appcharge Reciept", ["Purchase Confirmation", "HARBOUR HEROES-TIDEWORKS", "Receipt number | " + receipt, "Payment method | " + pay, "Payment date | " + when,
    "Country | " + country, "Order ID | " + orderId, "Items", ...lines, ...money, "Total | " + total],
    `<p>For questions or assistance, contact <a href="https://appchargehelp.zendesk.com/hc/en-us/requests/new?tf_1=${orderId}">Appcharge support</a></p>`) });
// PayPal's receipt for the same purchase, sent seconds after the game shop's.
export const payPalToAppcharge = (offer, pre, tax, total, date, txn) => ({
  from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to Appcharge ltd", date,
  html: htmlPage("PayPal", ["Receipt for your payment to Appcharge ltd", `${SHOPPER.name}, you've successfully sent a payment.`, `Hi ${SHOPPER.name},`, `You paid ${total} GBP to Appcharge ltd`,
    "Merchant | Appcharge ltd help@appcharge.com", "Transaction date | " + new Date(date).toUTCString().slice(5, 16), offer, "Qty: 1", "Product ID: home_screen_offer_9", pre,
    "Subtotal | " + pre, "Tax | " + tax, "Total | " + total + " GBP", "Paid Appcharge ltd with", "PayPal Credit | " + total + " GBP", "Transaction ID: " + txn],
    "<p>Copyright © 1999-2026 PayPal. All rights reserved.</p>") });

// PayPal's receipt for a payment to a shop, its long name cut short as PayPal cuts it, with PayPal's own order number.
export const payPalTo = ({ cut, full = cut, email, orderId, lines, money, total, date, txn }) => ({
  from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to " + (full === cut ? cut + "..." : full), date,
  html: htmlPage("PayPal", ["Receipt for your payment to " + cut + "...", `${SHOPPER.name}, you've successfully sent a payment.`, `Hi ${SHOPPER.name},`, `You paid ${total} GBP to ${cut}...`,
    "Merchant | " + cut + "... " + email, "Transaction date | " + new Date(date).toUTCString().slice(5, 16), ...(orderId ? ["Order ID | " + orderId] : []), ...lines, ...money, "Total | " + total + " GBP",
    "Paid " + cut + "... with", "VISA Debit ••4242 | " + total + " GBP", "Transaction ID: " + txn], "<p>Copyright © 1999-2026 PayPal. All rights reserved.</p>") });
// A beer festival's ticket email (its own order number in the subject, a ticket per person, each priced, no total).
export const festivalTickets = (orderNo, n, date) => ({
  from: '"Hopfield Beer Festival" <info@hopfieldbeerfestival.co.uk>', subject: `Your Hopfield Beer Festival Tickets - Order Number [#${orderNo}]`, date,
  html: htmlPage("Tickets", Array.from({ length: n }, (_, k) => ["Standard Entry Ticket", "Hopfield Beer Festival 2026 - Saturday Night", "Saturday 18 July 2026, 17:30 - 22:30",
    "Ticket Number: 2001" + String(k).padStart(8, "0"), "Ticket Holder: " + SHOPPER.name, "Ticket Type: Standard Entry", "Price: £ 48.00"]).flat()) });
// A shop's own order confirmation for an order also paid through PayPal.
export const shopOrder = (orderNo, date, item, pre) => ({
  from: '"Trailpoint" <team@trailpoint.co.uk>', subject: "Your Trailpoint order " + orderNo, date,
  html: htmlPage("Trailpoint", ["Thanks for your order!", "Order number: " + orderNo, "Item | Qty | Price", `${item} | 1 | ${pre}`, "Order total (ex. VAT) | " + pre]) });

export default function holdout16d() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  const not = (id, sender, layout, m, kind, extra = {}) => { const f = fixture(id, sender, layout, m, { notPurchase: { kind, ...extra } }); out.push(f); return f; };
  const own = (id, sender, layout, m, exp) => { const f = fixture(id, sender, layout, m, exp); out.push(f); return f; };

  // ---- Appcharge: a pack of three things, each its own line; the shop's own Order ID is the order's number -----------------
  own("holdout16d-game-pack-lines", "Appcharge", "'Items', then 'Lantern Cat | 1', 'Arcade Tokens | x 20', 'Coins | 1,000' on rows of their own; one price for the pack; 'Order ID' under the receipt number",
    gameReceipt("308-512-774", "6a9f01c2b3d4e5f60718293a", "United Kingdom", ["Lantern Cat | 1", "Arcade Tokens | x 20", "Coins | 1,000"], ["Subtotal | £3.99", "VAT (20%) | £0.80"], "£4.79",
      "Sat, 25 Apr 2026 19:20:11 +0000", "April 25, 2026 7:20 PM UTC"),
    { shop: "Harbour Heroes", date: "2026-04-25", currency: "GBP", totalPence: 479, orderRef: "6a9f01c2b3d4e5f60718293a",
      items: [{ name: "Lantern Cat", qty: 1, linePence: null }, { name: "Arcade Tokens", qty: 20, linePence: null }, { name: "1,000 Coins", qty: 1, linePence: null }] });
  // ---- Appcharge: one thing, two of it ("Big box | x 2"): two at the pack's price ------------------------------------------------
  add("holdout16d-game-two-boxes", "Appcharge", "one line 'Golden SE box | x 2': two of one thing",
    gameReceipt("411-090-215", "6a9f01c2b3d4e5f6071829aa", "United Kingdom", ["Golden SE box | x 2"], ["Subtotal | £1.66", "VAT (20%) | £0.33"], "£1.99",
      "Sun, 10 May 2026 09:02:40 +0000", "May 10, 2026 9:02 AM UTC"),
    { ...order([{ name: "Golden SE box", qty: 2, unit: 0 }]), bought: [{ name: "Golden SE box", qty: 2, line: 199 }], subtotal: 199, total: 199 }, "Harbour Heroes", "2026-05-10", { orderRef: "6a9f01c2b3d4e5f6071829aa" });
  // ---- Appcharge bought abroad: dollars with a decimal comma, "$1,68", "$2,00 USD" --------------------------------------------
  add("holdout16d-game-comma-dollars", "Appcharge", "bought in Tunisia: 'Subtotal | $1,68', 'Tax (19%) | $0,32', 'Total | $2,00' (a decimal comma, no currency code)",
    gameReceipt("774-930-120", "69a873747398ede69c05b5ff", "Tunisia", ["Powerup Tokens | 1,000"], ["Subtotal | $1,68", "Tax (19%) | $0,32"], "$2,00",
      "Wed, 4 Mar 2026 18:01:30 +0000", "March 04, 2026 6:01 PM UTC"),
    { ...order([{ name: "1,000 Powerup Tokens", qty: 1, unit: 200 }]) }, "Harbour Heroes", "2026-03-04", { currency: "USD", orderRef: "69a873747398ede69c05b5ff" });

  // ---- PayPal's receipt for a game shop: one thing, its price before the tax PayPal adds: the thing cost what was paid --------
  add("holdout16d-paypal-offer-taxed", "PayPal", "'Special Offer', 'Qty: 1', '£2.66', 'Subtotal £2.66', 'Tax £0.53', 'Total £3.19 GBP'",
    payPalToAppcharge("Special Offer", "£2.66", "£0.53", "£3.19", "Thu, 30 Apr 2026 02:21:20 +0000", "8XY11111AB2223334"),
    order([{ name: "Special Offer", qty: 1, unit: 319 }]), "Appcharge ltd", "2026-04-30", { shopAlso: ["Appcharge"] });
  // ---- PayPal's older receipt (guest checkout, 2023): "Payment to: <shop> <email>", the thing on labelled rows ----------------
  add("holdout16d-paypal-older-receipt", "PayPal", "'Your PayPal receipt', 'Payment to: The Riverside Herald Ltd accounts@…', 'Quantity | 1', 'Item | …', 'Price | €80.00 EUR', 'Invoice ID: WC-31002'",
    { from: "service@paypal.co.uk", subject: "Your PayPal receipt", date: "Mon, 25 Sep 2023 10:12:00 +0000",
      html: htmlPage("PayPal", ["Take a look at your purchase details from The Riverside Herald Ltd on 25 September 2023.", `Hi ${SHOPPER.name},`, "You paid €80.00 EUR to The Riverside Herald Ltd",
        "Your purchase details", "Your transaction ID: 11111111AA111111A | Seller transaction ID: 22222222BB222222B", "Purchase date: 25 September 2023",
        "Payment to: The Riverside Herald Ltd accounts@riversideherald.example | Payment from: " + SHOPPER.name, "Invoice ID: WC-31002", "Delivery address", SHOPPER.name + " " + SHOPPER.address,
        "Quantity | 1", "Item | 3 Month Print Subscription (United Kingdom)", "ID number |", "Price | €80.00 EUR", "Subtotal | €80.00 EUR", "Total | €80.00 EUR", "You paid using: Apple Pay - AmEx 1004"]) },
    order([{ name: "3 Month Print Subscription (United Kingdom)", qty: 1, unit: 8000 }]), "The Riverside Herald Ltd", "2023-09-25", { currency: "EUR", shopAlso: ["The Riverside Herald", "Riverside Herald"] });
  return out;
}
