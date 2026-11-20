// A twentieth set of made-up emails (see lib.mjs), round 16b (21 Nov 2026): fees read from the wrong place in a real inbox,
// written again with everything made up. A column of money labels over a column of amounts, one label more than the reader
// took ("Subtotal (1 item)", "VAT Included", "Shipping", "Total" over four amounts); a film whose name ends in "Service" in
// the "also bought" block under a digital order; a booking's taxes, more than was paid, on a fare paid with points.
import { order, expected, page, fixture, h, SHOPPER } from "./lib.mjs";

const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });

export default function holdout17b() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };
  // ---- four money labels over four amounts: shipping is £0.00, never the subtotal --------------------------------------------
  add("holdout17b-stacked-labels-vat-shipping", "Strideway", "'Subtotal (1 item)', 'VAT Included', 'Shipping', 'Total' on lines of their own, then '£84.00', '£14.00', '£0.00', '£84.00'", {
    from: "Strideway <orders@strideway.example>", subject: "Thanks for your order SW00412207", date: "Mon, 16 Nov 2026 10:00:00 +0000",
    html: mail("Strideway", "strideway.example", ["Thanks for your order", "Order number: SW00412207", "Trail Glide 3 Running Shoes | £84.00", "Size: UK 9", "Qty: 1", "Order summary",
      "Subtotal (1 item)", "VAT Included", "Shipping", "Total", "£84.00", "£14.00", "£0.00", "£84.00", "Have a question?"]) },
    order([{ name: "Trail Glide 3 Running Shoes", qty: 1, unit: 8400 }]), "Strideway", "2026-11-16", { orderRef: "SW00412207", fees: [] });
  // ---- a film bought, and under it what others bought: "Harbour Lights: The Night Service" is not a fee ---------------------
  add("holdout17b-film-also-bought-service", "Amazon", "a digital order of one film, then 'Customers who bought this also bought' with 'Harbour Lights: The Night Service' '£3.49'", {
    from: "\"Amazon.co.uk\" <digital-no-reply@amazon.co.uk>", subject: "Amazon.co.uk order of Harbour Lights: The Return.", date: "Wed, 18 Nov 2026 20:00:00 +0000",
    html: mail("Amazon.co.uk", "amazon.co.uk", ["Order Confirmation", "Order # D01-1112223-3334445", `Hello ${SHOPPER.first},`, "Order details", "Harbour Lights: The Return", "Sold by Amazon Digital UK Limited.", "£5.99", "Item Subtotal: | £4.99",
      "Total Before VAT: | £4.99", "VAT: | £1.00", "Order Grand Total: | £5.99", "Customers who bought this also bought", "Harbour Lights (4K UHD)", "£3.09", "Harbour Lights: The Night Service", "£3.49"]) },
    order([{ name: "Harbour Lights: The Return", qty: 1, unit: 599 }]), "Amazon", "2026-11-18", { orderRef: "D01-1112223-3334445", fees: [] });
  // ---- a booking paid mostly with points: the taxes it lists come to more than the £3.00 paid -------------------------------
  add("holdout17b-points-taxes-over-paid", "Skyline Rewards", "'Paid with points: 12,000', 'Booking fee | £3.00', then 'Taxes and charges' rows of '£13.10' and '£23.05', 'Total paid | £3.00'", {
    from: "Skyline Rewards <bookings@skylinerewards.example>", subject: "Your booking confirmation SKR40112", date: "Thu, 19 Nov 2026 09:00:00 +0000",
    html: mail("Skyline Rewards", "skylinerewards.example", ["Your booking is confirmed", "Booking reference: SKR40112", "City Break Return | £3.00", "Paid with points: 12,000", "Taxes and charges",
      "Airport service charge | £13.10", "Passenger duty | £23.05", "Total paid | £3.00"]) },
    order([{ name: "City Break Return", qty: 1, unit: 300 }]), "Skyline Rewards", "2026-11-19", { orderRef: "SKR40112", fees: [] });
  return out;
}
