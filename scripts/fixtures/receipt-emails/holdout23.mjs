// A twenty-sixth set of made-up emails (see lib.mjs), round 22 (21 Nov 2026): layouts in a real inbox (July to December 2024)
// that Relay read wrongly after round 21b, written again with everything in them made up (shops, games, restaurants, events,
// airlines, items, prices, people, numbers). PayPal keeps its name and address: the reader goes by its layout.
//  - a jeweller's order and its cancellation, whose text part leaves out the order number that its HTML gives;
//  - an outlet's order opening "Congrats! You've saved at least £21.50", each thing's brand over its name, "Size:", its price,
//    "✕ 1", "RRP" and "Save" (what it would have cost, not money taken off);
//  - a game's web shop receipt whose coins are counted short, "Coins | 2.5K";
//  - a takeaway app's payment receipt that names no restaurant, and its "Your order #… was accepted" that does;
//  - a marketplace's purchase whose total is split over lines, "Total ( 1 item" / ")" / "£16.20", and whose item runs on
//    into "- Transaction ID: …";
//  - a winter fair's booking with one line, "×2 |", its price the only amount;
//  - a boat's "Order Receipt for QX7R2M4P"; a cinema's "Booking reference number:"; one ticket's "TICKET CODE";
//  - a shop's "A refund of £7.5 has been initiated"; "You have 28 days to return any unwanted items to us.";
//  - "We're pleased to confirm your VOLTA order (…)"; an airline's "Your e-ticket receipt …" with taxes listed per adult
//    inside the fare; PayPal's "Receipt from Burger Barn 4410227 for your £8.40 GBP purchase".
// scripts/test-receipt-real-23.mjs reads these.
import { order, expected, fixture, h, SHOPPER } from "./lib.mjs";

const cells = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("\n")}</table>`;
const htmlPage = (title, lines, foot = "") => `<html><head><title>${h(title)}</title></head><body>${cells(lines)}${foot}</body></html>`;

// ---- A jeweller: the order, then its cancellation (the number only in the HTML) ------------------------------------------
const JW = "Silverline <info@delivery.silverline.example>";
export const JEWELLER = {
  order: { from: JW, subject: "Thank you for your order - Silverline", date: "Mon, 09 Dec 2024 10:05:00 +0000",
    html: htmlPage("Silverline", ["ORDER CONFIRMATION", "Order Number: SLX4400917", `Hello ${SHOPPER.name},`, "Thank you for your order.", "Item | Quantity | Price",
      "Twisted Rope Silver Bangle | 1 | £240.00", "Subtotal | £240.00", "Delivery | Free", "Promos Applied [WINTER40] | -£40.00", "Order Total (Inc VAT) | £200.00"]) },
  cancelled: { from: JW, subject: "Order Cancellation - Silverline", date: "Thu, 12 Dec 2024 09:12:00 +0000",
    text: [`Hello ${SHOPPER.name},`, "", "We’re emailing you to confirm that your order is now cancelled.", "", "Any payments made will be returned within 5 working days.", "",
      "ITEM(S) CANCELLED", "", "Twisted Rope Silver Bangle", "Quantity: 1", "GBP240.00", "", "Order Total (Inc VAT) £200.00", "",
      "Silverline is part of Example Jewellery Group Ltd. Registered Number: 000000."].join("\n"),
    html: htmlPage("Silverline", ["ORDER CANCELLATION", "Order Number: SLX4400917", `Hello ${SHOPPER.name},`, "We’re emailing you to confirm that your order is now cancelled.",
      "Any payments made will be returned within 5 working days.", "ITEM(S) CANCELLED", "Item | Quantity | Price", "Twisted Rope Silver Bangle | Quantity: | 1", "GBP240.00"]) },
};

// ---- An outlet: a savings banner at the top, each thing's brand over its name ----------------------------------------------
export const OUTLET = { from: "Bargain Barn <donotreply@tr.bargainbarn.example>", subject: "Order confirmation", date: "Tue, 03 Dec 2024 19:30:00 +0000",
  html: htmlPage("Bargain Barn", [`Here are your order details, ${SHOPPER.first}`, "Congrats! You've saved at least £21.50", "-45%", "Order number", "55120934", "Expected delivery", "Standard Delivery",
    "Order summary", "Harbour & Hide", "Tan Leather Weekend Holdall", "Size: One Size", "£34.99", "✕ 1", "RRP £56.49", "Save £21.50", "-38%",
    "Northfield", "Grey Marl Merino Crew Jumper", "Size: M", "£19.99", "✕ 1", "Payment Method", "Visa", "£58.97", "Subtotal", "£54.98", "Standard Delivery", "£3.99",
    "Total Paid", "£58.97", "You saved at least", "£21.50"]) };

// ---- A game's web shop through Appcharge ----------------------------------------------------------------------------------
export const GAME = { from: '"Appcharge inc." <receipt@appcharge.com>', subject: "Your TILE QUEST-BRIGHTPLAY receipt #410-552-903", date: "Tue, 05 Nov 2024 18:40:00 +0000",
  html: `<html><head><title>Appcharge Reciept</title></head><body><table><tr><td>Purchase Confirmation</td></tr><tr><td><img src="https://media.appcharge.com/media/x/brightplay.png" alt="game logo" height="24"><span>TILE QUEST-BRIGHTPLAY</span></td></tr></table>
<table><tr><td>Receipt number</td><td>410-552-903</td></tr><tr><td>Payment method</td><td>Apple Pay</td></tr><tr><td>Order ID</td><td>6a11b22c33d44e55f66a77b8</td></tr></table>
<table><tr><td>Items</td></tr><tr><td>Rocket Pack</td><td>1</td></tr><tr><td>Lives</td><td>10</td></tr><tr><td>Coins</td><td>2.5K</td></tr></table>
<table><tr><td>Subtotal</td><td>£4.16</td></tr></table><table><tr><td>VAT (20%)</td><td>£0.83</td></tr></table><table><tr><td>Total</td><td>£4.99</td></tr></table>
<table><tr><td>For questions or assistance, contact <a href="mailto:support@appcharge.com">Appcharge support</a></td></tr></table></body></html>` };

// ---- A takeaway app: its payment receipt (no restaurant) and its "accepted" email (the restaurant) ------------------------
export const TAKEAWAY = {
  receipt: { from: "Dinedash ltd <receipts@dinedash.example>", subject: "Your Dinedash ltd receipt [#3301-7720]", date: "Fri, 08 Nov 2024 19:41:07 +0000",
    html: htmlPage("Your Dinedash ltd receipt [#3301-7720]", ["Receipt from Dinedash ltd", "Receipt #3301-7720", "Amount paid", "£18.40", "Date paid", "Nov 8, 2024, 7:38:30 PM", "Payment method", "- 4242",
      "Summary", "Total Amount × 1 | £18.40", "Amount charged | £18.40", "You're receiving this email because you made a purchase at Dinedash ltd, which partners with Stripe to provide invoicing and payment processing."]) },
  accepted: { from: "Dinedash - NoReply <hello@updates.dinedash.example>", subject: "Your order #4400112 was accepted", date: "Fri, 08 Nov 2024 19:38:52 +0000",
    html: htmlPage("", ["Order No. | #4400112", `Hi ${SHOPPER.name} , your order was accepted !`, "Thank you for ordering from Lagoon Grill. This email is to let you know that we have accepted your order.",
      "Your order number: 4400112", "Estimated time is: 2024-11-08 20:25", "Want to make last minute changes to your order?"]) },
};

// ---- A marketplace: the total over three lines, the item's transaction number run onto its name ---------------------------
export const MARKET = { from: "Craftly Transactions <transaction@craftly.example>", subject: "Your Craftly Purchase from ClayHouseStudio (4100223344)", date: "Wed, 20 Nov 2024 17:20:00 +0000",
  html: `<html><head><title>Craftly</title></head><body><table><tr><td>Yay! Your order is confirmed.</td></tr><tr><td>Order details</td></tr><tr><td>Confirmation number:</td></tr><tr><td>4100223344</td></tr>
<tr><td>Speckled Stoneware Mug (300ml) Handmade Coffee Cup - Transaction ID: 5512340987</td></tr><tr><td>Colour: Sea Foam</td></tr><tr><td>Quantity: 1</td></tr><tr><td>&pound; 16.20</td></tr>
<tr><td>Subtotal:</td></tr><tr><td>&pound;16.20</td></tr><tr><td>Delivery</td></tr><tr><td>&pound;0.00</td></tr><tr><td>Total ( 1 item<br>)</td></tr><tr><td>&pound;16.20</td></tr></table></body></html>` };

// ---- A winter fair: one line, how many, its price the only amount ----------------------------------------------------------
export const FAIR = { from: "Frostgate Winter Fair <info@frostgatefair.example>", subject: "Your booking with Frostgate Winter Fair! - 5530218", date: "Sat, 16 Nov 2024 12:00:00 +0000",
  html: htmlPage("Frostgate Winter Fair", ["Frostgate Winter Fair", "Hello", "Thank you for your booking. We look forward to welcoming you to Frostgate Winter Fair.", "Your booking details:",
    "SKATE SESSION 18:00pm", "ADULT |", "1 person |", "×2 |", "£24.00", "Important Information:", "Please bring this email confirmation with you."]) };

// ---- References: a boat's code in its subject, a cinema's booking reference, one ticket's code ------------------------------
export const BOAT = { from: "River Hopper <bookings@mailer.ventrata.com>", subject: "Order Receipt for QX7R2M4P", date: "Sat, 14 Dec 2024 11:00:00 +0000",
  html: htmlPage("River Hopper", ["Thank you for your order", "Order Summary", "Single Westpier → Eastdock Adult | 2 | £19.40", "Total | £19.40"]) };
export const CINEMA = { from: "Starlight <tickets@starlighttickets.example>", subject: "Starlight Tickets for (SS) Moon Quest #KD4M2XQ", date: "Sun, 15 Dec 2024 10:00:00 +0000",
  html: htmlPage("Starlight", ["Your Ticket[s]", `${SHOPPER.first}, thanks for your booking!`, "Your booking reference\nnumber is:", "KD4M2XQ", "Tickets", "2 X Adult Superscreen | £13.25", "Sub-total", "£26.50",
    "Total (incl. GST): (incl. VAT):", "£29.90", "This total includes a non-refundable booking fee of £3.40.", "You are going to see: (SS) Moon Quest", "Booking reference number: KD4M2XQ", "Screen: 4"]) };
export const TICKET = { from: '"Hillwalk Trust" <hillwalktrust@buytickets.at>', subject: "Order complete: Three Ridges Walk with #TeamHill", date: "Mon, 12 Aug 2024 09:00:00 +0000",
  html: htmlPage("Hillwalk Trust", [`Dear ${SHOPPER.name}`, "Thank you for signing up to Three Ridges Walk with #TeamHill.", "Your tickets", "Ticket 1 of 1", "QR code: Ab3dE9x", "TICKET CODE\nAb3dE9x",
    "Ticket type\n#TeamHill Three Ridges Ticket", "Order summary", "Item | Price | Fee | Quantity | Subtotal", "#TeamHill Three Ridges Ticket | 20.00 | 0.00 | 1 | 20.00", "Total", "GBP 20.00", "Total paid", "GBP 20.00",
    "Sell tickets online with Ticket Tailor."]) };

// ---- A refund written "£7.5"; a return window as "You have 28 days to return" ----------------------------------------------
export const REFUND = { from: "Cloud Corner <Site@cloudcorner.example>", subject: "Refund Initiated : #551200 | Cloud Corner", date: "Wed, 13 Nov 2024 11:02:40 +0000",
  html: htmlPage("Refund Initiated | Cloud Corner", ["Refund Initiated!", "A refund of £7.5 has been initiated for your order 551200 .", `Hi ${SHOPPER.name}, your refund for Order 551200 has been successfully initiated and is currently being processed.`,
    "Product | Quantity | Price", "Mint Fresh Refill Pods (4 pack) | 3 | £ 7.5"]) };
export const RETURNS = { from: "Hartwell <orders@hartwell.example>", subject: "Thank you for your order", date: "Mon, 25 Nov 2024 14:00:00 +0000",
  html: htmlPage("Hartwell", ["Thank you for your order", "Order number: HW77120034", "Walnut Serving Board | 1 | £28.00", "Delivery | £4.50", "Total | £32.50", "Returning an order:",
    "You have 28 days to return any unwanted items to us. They must be in perfect condition and in the original packaging. This does not affect your statutory rights."]) };

// ---- "We're pleased to confirm your … order"; an airline's e-ticket receipt; PayPal's receipt for a payment in a shop ---------
export const VOLTA = { from: "Volta <no_reply@volta.example>", subject: "We're pleased to confirm your VOLTA order (VLT2290117)", date: "Sun, 17 Nov 2024 11:46:00 +0000",
  html: htmlPage("Volta", ["Thanks for your order! Here's your receipt", `Hi ${SHOPPER.first} - Thanks for shopping with us.`, "Order information", "Order number:\nVLT2290117", "Ordered item(s)", "1x",
    "BREEZEPRO - Cordless Stick Vacuum Cleaner - Slate |", "Product code 771204", "£149.99", "Standard delivery", "Free", "Payment breakdown", "Paid Today:", "£149.99", "Total package", "£149.99"]) };
export const AIRLINE = { from: "Skyline Airways e-ticket <e-ticket@email.skylineair.example>", subject: "Your e-ticket receipt QPLM4R: 12 Jun 2025 09:40", date: "Sun, 22 Dec 2024 18:00:00 +0000",
  text: ["Skyline Airways booking reference: QPLM4R", "", "Your e-ticket receipt", "Thank you for booking with Skyline Airways.", "",
    "SK0211: Skyline Airways | Economy | Confirmed", "Depart: 12 Jun 2025 09:40 - Heathrow (London) - Terminal 2", "Arrive: 12 Jun 2025 12:55 - John F Kennedy (NY) (New York) - Terminal 4", "",
    "SK0212: Skyline Airways | Economy | Confirmed", "Depart: 19 Jun 2025 18:30 - John F Kennedy (NY) (New York) - Terminal 4", "Arrive: 20 Jun 2025 06:35 - Heathrow (London) - Terminal 2", "",
    "Payment Total: GBP 412.60", "Fare Details: GBP 300.00 + Tax/Fee/Charge GBP 112.60 = GBP 412.60", "",
    "Government, authority and airport charges | Per adult", "Air Passenger Duty - United Kingdom | GBP 88.00", "Immigration User Fee - USA | GBP 5.60", "Passenger Service Charge - United Kingdom | GBP 19.00"].join("\n") };
export const PAYPAL_SHOP = { from: '"service@paypal.co.uk" <service@paypal.co.uk>', subject: "Receipt from Burger Barn 4410227 for your £8.40 GBP purchase", date: "Sat, 30 Nov 2024 12:07:15 +0000",
  html: htmlPage("PayPal", ["Receipt from Burger Barn 4410227 for your £8.40 GBP purchase", `${SHOPPER.name}, here's your receipt for your purchase on 30 November 2024.`,
    "You authorised a payment of £8.40 GBP to Burger Barn 4410227 .", "Thanks for using PayPal.", "Transaction details", "Transaction ID", "1AB23456CD789012E", "Subtotal", "£8.40 GBP",
    "Total payment to seller", "£8.40 GBP", "Funding source:", "Visa x-4242", "£8.40 GBP", "Payment to", "Burger Barn 4410227"]) };

export default function holdout23() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  const not = (id, sender, layout, m, kind, extra = {}) => { const f = fixture(id, sender, layout, m, { notPurchase: { kind, ...extra } }); out.push(f); return f; };
  not("holdout23-jeweller-cancelled-number-in-html", "Silverline", "'Order Cancellation': 'your order is now cancelled', the order number only in the HTML", JEWELLER.cancelled, "cancellation");
  not("holdout23-takeaway-accepted", "Dinedash", "'Your order #… was accepted': 'Thank you for ordering from Lagoon Grill.' (no money: the order's news)", TAKEAWAY.accepted, "order_update");
  add("holdout23-outlet-savings-banner", "Bargain Barn", "'Congrats! You've saved at least £21.50' at the top, each thing's brand over its name, 'Size:', its price, '✕ 1', 'RRP' and 'Save'",
    OUTLET, order([{ name: "Tan Leather Weekend Holdall", qty: 1, unit: 3499 }, { name: "Grey Marl Merino Crew Jumper", qty: 1, unit: 1999 }], { fees: [["Standard Delivery", 399]] }), "Bargain Barn", "2024-12-03", { orderRef: "55120934" });
  add("holdout23-market-total-over-lines", "Craftly", "'Total ( 1 item' over ')' over '£16.20'; the item's name runs on into '- Transaction ID: …'",
    MARKET, order([{ name: "Speckled Stoneware Mug (300ml) Handmade Coffee Cup", qty: 1, unit: 1620 }]), "Craftly", "2024-11-20", { orderRef: "4100223344" });
  return out;
}
