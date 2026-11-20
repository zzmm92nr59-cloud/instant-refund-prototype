// A nineteenth set of made-up emails (see lib.mjs), round 16 (20 Nov 2026): the layouts of the receipts in a real Outlook
// inbox that Relay read wrong, written again with everything in them made up (restaurants, shops, items, prices, people,
// addresses, order numbers). The senders whose own wording the reader goes by (Uber, Amazon, eBay) keep their names; every
// other shop here is invented. Each email is laid out the way the real one was: one table row per line, " | " between cells.
import { order, expected, page, fixture, h, SHOPPER } from "./lib.mjs";

const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });
const UBER = "Uber Receipts <noreply@uber.com>";
const rideTail = ["Trip details", "UberX", "5.10 miles, 24 minutes", "You rode with Alex", "Rate or tip", "Report lost item"];

export default function holdout17() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  const not = (id, sender, layout, m, kind) => { const f = fixture(id, sender, layout, m, { notPurchase: { kind }, items: [], shop: null, date: null, currency: null, totalPence: null }); out.push(f); return f; };
  const unpriced = (f, names) => { f.expected.items = f.expected.items.map((i) => (names.includes(i.name) ? { ...i, linePence: null } : i)); return f; };

  // ---- Uber rides: the fare is the ride; each fee, tip and credit is beside it, never counted in it as well ----------------
  add("holdout17-uber-ride-fees", "Uber", "'Trip fare', 'Central London Fee', 'Wait Time', 'UberX Priority' and 'Uber One credits -£' on rows of their own",
    { from: UBER, subject: "Your Tuesday evening trip with Uber", date: "Tue, 10 Nov 2026 21:10:00 +0000",
      html: mail("Uber", "uber.com", ["Total | £24.10", "10 November 2026", `Thanks for riding, ${SHOPPER.first}`, "We hope you enjoyed your ride this evening.", "Total", "£24.10", "£1.10", "Uber One credits earned",
        "Trip fare", "£19.40", "Central London Fee", "£1.50", "Wait Time", "£0.85", "UberX Priority", "£2.95", "Uber One credits", "-£0.60", "Payments", "Visa ••••4821", "£24.10", "10/11/2026 21:08", ...rideTail]) },
    order([{ name: "Uber ride", qty: 1, unit: 1940 }], { fees: [["Central London Fee", 150], ["Wait Time", 85], ["UberX Priority", 295]], discounts: [["Uber One credits", 60]] }), "Uber", "2026-11-10");
  // ---- the receipt sent again after a tip: one ride, its tip a line of its own (and the first receipt, for the join) --------
  const tipLines = (tip) => [`Total | £${tip ? "17.20" : "15.20"}`, "8 November 2026", tip ? `Thanks for tipping, ${SHOPPER.first}` : `Thanks for riding, ${SHOPPER.first}`,
    tip ? "Here's your updated Sunday morning trip receipt." : "We hope you enjoyed your ride this morning.", "Total", `£${tip ? "17.20" : "15.20"}`,
    "Trip fare", "£14.30", "Subtotal", "£14.30", "Wait Time", "£0.90", ...(tip ? ["Tip", "£2.00"] : []), "Payments", "Mastercard ••••5150", "08/11/2026 10:02", "£15.20", ...(tip ? ["Mastercard ••••5150", "08/11/2026 10:30", "£2.00"] : []), ...rideTail];
  add("holdout17-uber-ride-first", "Uber", "the first receipt of a ride, before a tip", { from: UBER, subject: "Your Sunday morning trip with Uber", date: "Sun, 08 Nov 2026 10:03:00 +0000", html: mail("Uber", "uber.com", tipLines(false)) },
    order([{ name: "Uber ride", qty: 1, unit: 1430 }], { fees: [["Wait Time", 90]] }), "Uber", "2026-11-08");
  add("holdout17-uber-ride-tip-updated", "Uber", "'Thanks for tipping', 'Here's your updated … trip receipt', a 'Tip' row and two payments", { from: UBER, subject: "[Personal] Your updated Uber receipt", date: "Sun, 08 Nov 2026 10:31:00 +0000", html: mail("Uber", "uber.com", tipLines(true)) },
    order([{ name: "Uber ride", qty: 1, unit: 1430 }], { fees: [["Wait Time", 90]], tips: [["Tip", 200]] }), "Uber", "2026-11-08");
  // ---- a ride in euros, its fees in euros ------------------------------------------------------------------------------------
  add("holdout17-uber-ride-euros", "Uber", "a ride abroad paid in euros: 'Trip fare €9.10', 'Wait Time €0.40', total '€9.50'",
    { from: UBER, subject: "Your Friday afternoon trip with Uber", date: "Fri, 06 Nov 2026 15:20:00 +0000",
      html: mail("Uber", "uber.com", ["Total | €9.50", "6 November 2026", `Thanks for riding, ${SHOPPER.first}`, "We hope you enjoyed your ride this afternoon.", "Total", "€9.50", "Trip fare", "€9.10", "Subtotal", "€9.10", "Wait Time", "€0.40", "Payments", "Visa ••••4821", "€9.50", ...rideTail]) },
    order([{ name: "Uber ride", qty: 1, unit: 910 }], { fees: [["Wait Time", 40]] }), "Uber", "2026-11-06", { currency: "EUR" });
  // ---- a ride abroad paid in pounds: the fare in pounds is "Fare total", the conversion fee beside it -------------------------
  add("holdout17-uber-ride-abroad-pounds", "Uber", "fare lines in euros, total in pounds, 'Currency conversion fee £0.30' and 'Fare total £15.00' under the payments",
    { from: UBER, subject: "Your Thursday night trip with Uber", date: "Thu, 05 Nov 2026 23:40:00 +0000",
      html: mail("Uber", "uber.com", ["5 Nov 2026", "23:30", `Thanks for riding, ${SHOPPER.first}`, "We hope you enjoyed your ride tonight.", "Total", "£15.30", "Conversion 17.70 EUR = 15.30 GBP", "Trip fare", "€17.40", "Uber Fx fee", "€0.30",
        "Payments", "Currency conversion fee", "£0.30", "Fare total", "£15.00", "Visa ••••4821", "£15.30", "05/11/2026 23:35", "17.70 EUR ~ 15.30 GBP", ...rideTail]) },
    order([{ name: "Uber ride", qty: 1, unit: 1500 }], { fees: [["Currency conversion fee", 30]] }), "Uber", "2026-11-05");
  // ---- a cancelled trip's fee, and Uber One's own payment -----------------------------------------------------------------------
  add("holdout17-uber-cancel-fee", "Uber", "'Here's the receipt for your canceled trip', 'Cancellation fee £5.00' and nothing else",
    { from: UBER, subject: "Your Monday morning trip with Uber", date: "Mon, 02 Nov 2026 08:15:00 +0000",
      html: mail("Uber", "uber.com", ["2 Nov 2026", "08:10", "Cancelled", `We'll connect another time, ${SHOPPER.first}`, "Here's the receipt for your canceled trip.", "Total", "£5.00",
        "A fee is charged if there is a cancellation after the grace period, once the driver has accepted your trip.", "Cancellation fee", "£5.00", "Payments", "Visa ••••4821", "£5.00", "Trip details"]) },
    order([{ name: "Cancellation fee", qty: 1, unit: 500 }]), "Uber", "2026-11-02");
  add("holdout17-uber-one-payment", "Uber", "'Your Uber One payment was successful', 'Total charged £5.99'",
    { from: "Uber <noreply@uber.com>", subject: "Your Uber One payment", date: "Sun, 01 Nov 2026 12:00:00 +0000",
      html: mail("Uber", "uber.com", ["Your Uber One payment was successful", "Get ready to save on the best of Uber with Uber One membership.", "Total charged", "£5.99", "Payment method", "Visa ••••4821", "Valid until", "1 Dec 2026 at 12:00"]) },
    order([{ name: "Uber One membership", qty: 1, unit: 599 }]), "Uber", "2026-11-01");

  // ---- not purchases: an order app's adverts, a survey the day after, someone else's forwarded order, a free game, a SIM plan --
  not("holdout17-eats-deals-advert", "Uber Eats", "'Fill your cart with great deals', offers with prices, 'Order now', no total, no order number",
    { from: "Uber Eats <uber@uber.com>", subject: "Weekend deals near you", date: "Sat, 07 Nov 2026 09:00:00 +0000",
      html: mail("Uber Eats", "uber.com", ["Browse a wide selection of deals.", "Fill your cart with great deals", "Get great deals with the convenience of delivery.", "Corner Mart Local", "£0 Delivery Fee", "Order now", "Oat Crunch Cereal 500g → £2.50", "Strawberry Jam 340g → £1.80", "Order now"]) }, "advert");
  not("holdout17-delivery-new-restaurants", "Deliveroo", "'Discover a new favourite...', 'New on Deliveroo', nothing else", { from: "Deliveroo <noreply@t.deliveroo.co.uk>", subject: "Something new for tonight?", date: "Wed, 04 Nov 2026 17:00:00 +0000",
    html: mail("Deliveroo", "deliveroo.co.uk", ["deliveroo", "Discover a new favourite...", "Near you | Grocery | New on Deliveroo", "Lantern Noodle Bar", "Fern & Fig Kitchen"]) }, "advert");
  not("holdout17-takeaway-survey", "Crust Club", "'Got a minute to tell us about your last order?', 'Start The Survey', no money", { from: "Crust Club <noreply@crustclub.example>", subject: "Thanks for your order", date: "Thu, 05 Nov 2026 12:00:00 +0000",
    html: mail("Crust Club", "crustclub.example", ["Thanks for your order", "Got a minute to tell us about your last order?", "We love hearing about your experiences.", "It's a super quick survey, so won't take long.", "Start The Survey", "SURVEY OPT-OUT"]) }, "survey");
  not("holdout17-forwarded-someone-else", "Northgate Arena", "forwarded from the shopper's own other inbox: 'From:', 'Sent:', 'To: jo-…' then 'Hi Jo,'", {
    from: `${SHOPPER.name} <sam.taylor.88@outlook.com>`, to: `${SHOPPER.name} <${SHOPPER.email}>`, subject: "FW: Purchase confirmation - Northgate Arena", date: "Mon, 09 Nov 2026 20:00:00 +0000",
    text: ["Get Outlook for Android", "From: confirmation@northgatearena.example <confirmation@northgatearena.example>", "Sent: Tuesday, October 20, 2026 12:05:37 PM", "To: jo-taylor90@hotmail.co.uk <jo-taylor90@hotmail.co.uk>",
      "Subject: Purchase confirmation - Northgate Arena", "", "ALL BOOKED!", "Hi Jo,", "ORDER NUMBER 201020,1144", "Darts Night", "Section B12 Row P Seat 4", "£40.00", "Total £80.00"].join("\n") }, "someone else's");
  not("holdout17-game-store-free", "Game store", "a free game: '(Game) £0.00', 'Total: £0.00', a trial's later fee the only other money", { from: "Arcadia Store <noreply@arcadiastore.example>", subject: "Thank you for your purchase", date: "Sat, 07 Nov 2026 18:00:00 +0000",
    html: mail("Arcadia Store", "arcadiastore.example", ["Thank you for your purchase from Arcadia Store.", "Order Number: 300412009911", "Details", "Sky Racers (Game)", "£0.00", "Arcadia Plus: 14 Day Trial (Trial)", "Recurring Subscription Fee: £7.99 will be charged on 21/11/2026", "£0.00", "Total: £0.00",
      "If you start downloading or streaming the content you will lose this cancellation right."]) }, "free");
  not("holdout17-sim-plan-order", "Phone network", "a SIM plan: 'Contract length 12m', 'Plan cost £20.00', 'Total cost paid today £0.00'", { from: "Brightwave Mobile <orders@brightwave.example>", subject: "Your order", date: "Fri, 06 Nov 2026 11:00:00 +0000",
    html: mail("Brightwave Mobile", "brightwave.example", ["Here's all you need to know about your order", `Hi ${SHOPPER.first},`, "We have received your order for your new SIM only plan.", "Order number: 0077120044", "Your new plan", "Contract length", "12m", "Plan name", "SIM 12m £20",
      "Plan cost (inc VAT)", "£20.00", "Discounts", "£2.00", "Additional items", "Roam in EU", "£0.00", "Total cost paid today", "£0.00"]) }, "contract");

  // ---- a total before VAT, then the plain total ----------------------------------------------------------------------------
  add("holdout17-total-excl-vat-then-total", "Trailpeak", "'Subtotal', 'Delivery', 'Total (Excl. VAT)', 'of which VAT', then 'Total'", { from: "Trailpeak <orders@trailpeak.example>", subject: "Your Trailpeak order #300112", date: "Mon, 09 Nov 2026 09:00:00 +0000",
    html: mail("Trailpeak", "trailpeak.example", ["Thank You", "Order Number: #300112", "Item(s) in our warehouse:", "Ridge Runner Trail Shoes (Grey)", "Shoe Size: UK 9", "Qty:1", "£64.99", "Subtotal", "£64.99", "Delivery", "£4.99", "Total (Excl. VAT)", "£58.32", "of which VAT", "£11.66", "Total", "£69.98"]) },
    order([{ name: "Ridge Runner Trail Shoes (Grey)", qty: 1, unit: 6499 }], { fees: [["Delivery", 499]] }), "Trailpeak", "2026-11-09", { orderRef: "300112" });
  // ---- a takeaway list, one line priced and the rest not ----------------------------------------------------------------------
  unpriced(add("holdout17-pizza-some-priced", "Crust Club", "'1x Any Large Pizza £15' over its choices, '1x Garlic Dip', '1x Cookies', 'Delivery: £2.99', '£20.98 (Including VAT)'", {
    from: "Crust Club <orders@crustclub.example>", subject: "Your Crust Club order 701223344 is confirmed", date: "Tue, 10 Nov 2026 19:00:00 +0000",
    html: mail("Crust Club", "crustclub.example", ["Your order number is 701223344", "Get excited for your |", "1x Any Large Pizza £15", "Large 13.5\" Pepper Feast", "+ Classic Crust", "1x Garlic Dip - 100g", "1x Choc Cookies", "Delivery: £2.99", "£20.98 (Including VAT)", "Your order will be delivered to |"]) },
    order([{ name: "Any Large Pizza", qty: 1, unit: 1500 }, { name: "Garlic Dip - 100g", qty: 1, unit: 0 }, { name: "Choc Cookies", qty: 1, unit: 0 }], { fees: [["Delivery", 299]] }), "Crust Club", "2026-11-10", { orderRef: "701223344", totalPence: 2098 }), ["Garlic Dip - 100g", "Choc Cookies"]);
  // ---- an Amazon order email that names the order only in its subject, with recommendations under it ---------------------------
  add("holdout17-amazon-subject-only-picks", "Amazon", "no item list, the subject 'order of \"Garden Hose…\"', then 'Top picks for you' with prices", {
    from: "\"Amazon.co.uk\" <auto-confirm@amazon.co.uk>", subject: "Your Amazon.co.uk order of \"Garden Hose Reel 30m...\"", date: "Wed, 11 Nov 2026 08:00:00 +0000",
    html: mail("Amazon.co.uk", "amazon.co.uk", ["Order Confirmation", "Order # 202-4455667-1122334", "Hello,", "Thanks for your order. We'll let you know once your item(s) have dispatched.", "Arriving:", "Friday, November 13", "Order Total:", "£24.99",
      "Top picks for you", "Watering Can 10L", "£8.99", "Hose Nozzle Set", "£6.49"]) },
    { ...order([]), bought: [] }, "Amazon", "2026-11-11");
  out[out.length - 1].expected.items = [{ name: "Garden Hose Reel 30m…", qty: 1, linePence: null }]; out[out.length - 1].expected.totalPence = 2499; out[out.length - 1].expected.partial = true;
  // ---- an ordering platform's email names the restaurant; a restaurant's own summary without pound signs ----------------------
  add("holdout17-platform-restaurant", "Ordering platform", "sent by the platform: 'Your order with Harbour Chippy (Whitby) is confirmed', 'Please collect from:'", {
    from: "Preoday <noreply@preoday.com>", subject: "Your order with Harbour Chippy (Whitby) is confirmed", date: "Fri, 13 Nov 2026 18:30:00 +0000",
    html: mail("Harbour Chippy", "preoday.com", ["Your order with Harbour Chippy (Whitby) is confirmed", "Order | # 40112233", "13 November 2026", `Thanks for your order , ${SHOPPER.first}`, "Please collect from:", "Harbour Chippy (Whitby)",
      "Cod & Chips | £9.50", "Mushy Peas | £1.20", "Subtotal | £10.70", "Total | £10.70"]) },
    order([{ name: "Cod & Chips", qty: 1, unit: 950 }, { name: "Mushy Peas", qty: 1, unit: 120 }]), "Harbour Chippy", "2026-11-13", { orderRef: "40112233" });
  add("holdout17-restaurant-bare-prices", "Restaurant app", "'Thank you for ordering with Pasta Palace Restaurants!', 'Order Summary', each thing over a price with no pound sign, two of one twice",
    { from: "<orders@ordernow.example>", subject: "Your order confirmation", date: "Sat, 14 Nov 2026 13:00:00 +0000",
      html: mail("Pasta Palace", "ordernow.example", ["Pasta Palace Restaurants", "Thank you for ordering.", `Hi ${SHOPPER.first}`, "Thank you for ordering with Pasta Palace Restaurants!", "Order Number: 551203", "Table Number: 7", "Order Summary",
        "Lunch Buffet | 10.50", "Lunch Buffet | 10.50", "Lemonade | 3.20", "Subtotal (VAT @20% included) | 24.20", "Total: | £24.20"]) },
    order([{ name: "Lunch Buffet", qty: 2, unit: 1050 }, { name: "Lemonade", qty: 1, unit: 320 }]), "Pasta Palace", "2026-11-14", { orderRef: "551203" });
  // ---- a delivery day after the email in day-first form; no order date: the email's own day -----------------------------------
  add("holdout17-delivery-day-first", "Hearthside", "'Delivery date:' over '05/12/2026', the email sent on 3 December", { from: "Hearthside <orders@hearthside.example>", subject: "Your Hearthside order 77120043", date: "Thu, 03 Dec 2026 10:00:00 +0000",
    html: mail("Hearthside", "hearthside.example", ["Thanks for your order", "Order number : 77120043", "Delivery date :", "05/12/2026", "Quantity | Subtotal", "Linen Cushion Cover 45cm | 1 | £18.00", "Delivery charge | £0.00", "Total | £18.00"]) },
    order([{ name: "Linen Cushion Cover 45cm", qty: 1, unit: 1800 }]), "Hearthside", "2026-12-03", { orderRef: "77120043" });
  // ---- a line total said again under the line's price; a booking fee in the item list ---------------------------------------
  add("holdout17-line-total-repeated", "Meadow Farm", "'£12.00 each' / '£12.00' / 'Line Total:' / '£12.00'; '1 x Online booking fee' as a line; 'Payment (Card)' over its date over '- £'; 'Outstanding Balance -£'", {
    from: "Meadow Farm Park <bookings@meadowfarm.example>", subject: "Your Meadow Farm Park booking confirmation", date: "Mon, 16 Nov 2026 10:00:00 +0000",
    html: mail("Meadow Farm Park", "meadowfarm.example", ["Booking reference: MF7Q2XK", "Day Admission (2 Adults)", "£24.00 each", "£24.00", "Line Total:", "£24.00", "2 x Animal Feed", "£1.50 each", "£3.00", "Line Total:", "£3.00",
      "1 x Online booking fee", "£1.00 each", "£1.00", "Line Total:", "£1.00", "Total", "£28.00", "Payment (Card)", "16 Nov 2026 - 09:58", "- £28.00", "Outstanding Balance", "-£28.00"]) },
    order([{ name: "Day Admission (2 Adults)", qty: 1, unit: 2400 }, { name: "Animal Feed", qty: 2, unit: 150 }], { fees: [["Online booking fee", 100]] }), "Meadow Farm Park", "2026-11-16");
  // ---- a table whose headings and cells each sit on lines of their own -------------------------------------------------------
  add("holdout17-split-column-table", "Grocer", "'Qty', 'Product', 'Unit Price', 'Total', 'Saved' on lines of their own, a section's name between rows", {
    from: "Greenleaf Grocer <orders@greenleaf.example>", subject: "Your Greenleaf order 4410-2203", date: "Tue, 17 Nov 2026 08:00:00 +0000",
    html: mail("Greenleaf Grocer", "greenleaf.example", ["Order 4410-2203", "Your items", "Qty", "Product", "Unit Price", "Total", "Saved", "Fridge", "1", "Chicken Thigh Fillets 500G", "£4.00", "£3.60", "£0.40", "Substitutions:", "On",
      "2", "Whole Milk 2L", "£1.60", "£3.20", "£0.00", "Cupboard", "1", "Porridge Oats 1KG", "£1.50", "£1.50", "£0.00", "Order summary", "Pick, pack and deliver", "£2.50", "Total", "£10.80"]) },
    order([{ name: "Chicken Thigh Fillets 500G", qty: 1, unit: 360 }, { name: "Whole Milk 2L", qty: 2, unit: 160 }, { name: "Porridge Oats 1KG", qty: 1, unit: 150 }], { fees: [["Pick, pack and deliver", 250]] }), "Greenleaf Grocer", "2026-11-17");
  // ---- eBay: one thing over its total, sponsored things under it -------------------------------------------------------------
  add("holdout17-ebay-one-over-total", "eBay", "the thing over 'Total : £6.50' and 'Order number :', then 'Sponsored items' each with 'Free postage'", {
    from: "eBay <ebay@ebay.com>", subject: "Order confirmed: Board Game Classic Edition", date: "Wed, 18 Nov 2026 12:00:00 +0000",
    html: mail("eBay", "ebay.co.uk", [`Thanks for making your purchase ${SHOPPER.first}! Your order is confirmed.`, "Board Game Classic Edition (Complete) Free UK Post, Good", "Total : £6.50", "Order number : 12-34567-89012", "Item number : 330011223344",
      "Sponsored items to complement your purchase", "Card Sleeves 100 Pack", "£2.80", "Free postage", "Dice Set of 6", "£4.49", "Free postage"]) },
    order([{ name: "Board Game Classic Edition (Complete) Free UK Post, Good", qty: 1, unit: 650 }]), "eBay", "2026-11-18", { orderRef: "12-34567-89012" });
  // ---- how many alone on its line, the name under it; a payment method and a person's name above ---------------------------
  add("holdout17-qty-alone-name-under", "Tickets", "'Offline payment', the buyer's name, '1 x' alone, then the pass's name, its price", { from: "Eventbrite <orders@eventbrite.com>", subject: "Your tickets for City Museum Annual Pass", date: "Thu, 19 Nov 2026 10:00:00 +0000",
    html: mail("Eventbrite", "eventbrite.com", ["Order #7700112233", "Offline payment", SHOPPER.name, "1 x", "Annual Pass Adult", "£25.00", "£25.00", "View and manage your order online"]) },
    order([{ name: "Annual Pass Adult", qty: 1, unit: 2500 }]), "Eventbrite", "2026-11-19");
  // ---- a restaurant's list of names each over its price, the table's number above it ---------------------------------------
  add("holdout17-name-price-pairs-table", "Sushi bar", "'4' over 'Table', '095' over 'Order number', then each dish over its price under 'Order Summary'", { from: "Kaiten Sushi <orders@kaitensushi.example>", subject: "Your receipt from Kaiten Sushi", date: "Fri, 20 Nov 2026 13:10:00 +0000",
    html: mail("Kaiten Sushi", "kaitensushi.example", ["Thanks for ordering with Kaiten Sushi", "6", "Table", "|", "071", "Order number", "Order Summary", "miso soup", "£2.50", "ginger", "£0.00", "salmon roll (4x Pieces)", "£5.10", "Eat In", "Total", "£7.60", "VAT", "£1.27"]) },
    order([{ name: "miso soup", qty: 1, unit: 250 }, { name: "ginger", qty: 1, unit: 0 }, { name: "salmon roll (4x Pieces)", qty: 1, unit: 510 }]), "Kaiten Sushi", "2026-11-20");
  // ---- a pharmacy's saving summary and its original subtotal ------------------------------------------------------------------
  add("holdout17-saving-summary", "Pharmacy", "the item's saving under it, 'Original subtotal', 'You've Saved £3.00', 'Product Saving -£3.00', 'Total'", { from: "Wellmart <orders@wellmart.example>", subject: "Your Wellmart order 600112233", date: "Sat, 21 Nov 2026 09:00:00 +0000",
    html: mail("Wellmart", "wellmart.example", ["Order number : 600112233", "Quantity", "Saving", "Subtotal", "Vitamin D 1000IU 90 tablets", "10246099", "Winter offer - Save 20 percent on vitamins", "1", "-£3.00", "£12.00", "Original subtotal", "£15.00", "You've Saved", "£3.00",
      "Product Saving", "-£3.00", "Delivery charge", "£0.00", "Total", "£12.00"]) },
    order([{ name: "Vitamin D 1000IU 90 tablets", qty: 1, unit: 1200 }]), "Wellmart", "2026-11-21", { orderRef: "600112233" });
  // ---- rail split tickets of one kind as one line, "2 × Adult - Advance Single" ----------------------------------------------
  add("holdout17-rail-split-same-type", "Trainline", "'2 × Adult - Advance Single' '£6.20' for a way of two legs, each leg named 'A or B to C'", {
    from: "Trainline <auto-confirm@info.thetrainline.com>", subject: "Your booking confirmation for Elmford Central to Wrayton", date: "Sun, 22 Nov 2026 09:00:00 +0000",
    html: mail("Trainline", "thetrainline.com", ["Your trip to Wrayton departing Monday, 23 November 2026 is confirmed", "Outbound Monday, 23 November", "31m, 0 changes", "16:30 Elmford Central", "Northern Rail", "Advance Single", "Elmford Castle or Central to Marsham",
      "Stay on the same train", "Advance Single", "Marsham to Wrayton", "17:01 Wrayton", "2x Advance Single", "1x Adult", "Payment information", "Transaction ID:", "866400112233", "Transaction Date:", "22 Nov 2026", "Order Details", "2 × Adult - Advance Single", "£6.20", "Other costs*", "Booking Fee", "£0.35", "Total amount:", "£12.75"]) },
    order([{ name: "Elmford Central to Marsham", qty: 1, unit: 620 }, { name: "Marsham to Wrayton", qty: 1, unit: 620 }, { name: "Booking Fee", qty: 1, unit: 35 }]), "Trainline", "2026-11-22", { orderRef: "866400112233" });
  // ---- click and collect: "ready to collect" (numbered by its collection reference) and "You've collected your items" --------
  const airer = ["4 Fold Indoor Clothes Airer", "Quantity", "1", "£22.00", "Subtotal:", "£22.00"];
  add("holdout17-collect-ready", "Argos", "'Your item is ready to collect', 'Order number' the collection reference, 'Collection code'", { from: "Argos <noreply@argos.co.uk>", subject: "Order confirmed — Here are your collection details", date: "Mon, 16 Nov 2026 19:00:00 +0000",
    html: mail("Argos", "argos.co.uk", ["Order confirmed — Here are your collection details", `Hi ${SHOPPER.first} — thanks for shopping with us…`, "Your item is ready to collect", "Pop in by…", "8:00pm on Mon 23 November", "Order number", "QX402117", "Collection code", "5521", ...airer, "Total paid:", "£22.00"]) },
    order([{ name: "4 Fold Indoor Clothes Airer", qty: 1, unit: 2200 }]), "Argos", "2026-11-16", { orderRef: "QX402117" });
  add("holdout17-collect-collected", "Argos", "'You've collected your items - Keep this email handy as it's your receipt', the order's own number under its details", { from: "Argos <noreply@argos.co.uk>", subject: "Your Argos receipt", date: "Tue, 17 Nov 2026 12:00:00 +0000",
    html: mail("Argos", "argos.co.uk", ["You've collected your items - Keep this email handy as it's your receipt", "You collected this item on Tue 17 November", ...airer, "Total:", "£22.00", "Your order details", "Order number", "8812203345", "Order date", "Mon 16 November 2026"]) },
    order([{ name: "4 Fold Indoor Clothes Airer", qty: 1, unit: 2200 }]), "Argos", "2026-11-16", { orderRef: "8812203345" });
  // ---- Amazon's dispatch email, "Order: # …", for an order confirmed the day before ---------------------------------------------
  add("holdout17-amazon-dispatch-order-colon", "Amazon", "'Dispatch Confirmation', 'Order: # 202-…', 'Order Total:', 'Top picks for you' under it", {
    from: "\"Amazon.co.uk\" <ship-confirm@amazon.co.uk>", subject: "Your Amazon.co.uk order of \"Garden Hose Reel 30m...\"", date: "Thu, 12 Nov 2026 08:00:00 +0000",
    html: mail("Amazon.co.uk", "amazon.co.uk", ["Dispatch Confirmation", "Order: # 202-4455667-1122334", "Hello, We thought you'd like to know that we've dispatched your item(s).", "Arriving:", "Friday, November 13", "Order Total:", "£24.99", "Paid by Visa:", "£24.99",
      "Your item(s) is (are) being sent by Amazon Logistics. Your tracking number is QB0099887766. Depending on the delivery method you chose, it's possible that the tracking information might not be visible immediately.", "Top picks for you", "Watering Can 10L", "£8.99"]) },
    { ...order([]), bought: [] }, "Amazon", "2026-11-12", { orderRef: "202-4455667-1122334" });
  out[out.length - 1].expected.items = [{ name: "Garden Hose Reel 30m…", qty: 1, linePence: null }]; out[out.length - 1].expected.totalPence = 2499; out[out.length - 1].expected.partial = true;
  return out;
}
