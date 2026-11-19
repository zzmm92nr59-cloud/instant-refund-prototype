// A fourteenth set of made-up emails (see lib.mjs), round 12 (19 Nov 2026): the layouts of receipts and order news in
// Connor's own inbox that Relay read wrong, written again with everything in them made up (shops, items, prices, people,
// addresses, order numbers). Sainsbury's keeps its name (the reader goes by its wording); every other shop is invented.
import { order, expected, fixture, gbp, page, h, SHOPPER } from "./lib.mjs";

const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${l.split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("\n")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });

// A Sainsbury's order (confirmation, two changes, the delivery-day email with a substitution), shared with the join checks.
export const GROCER = {
  ref: "1388004127",
  first: [["Sainsbury's Wholemeal Pittas x6", 1, 65], ["Sainsbury's Free Range Eggs x12", 1, 340], ["Sainsbury's Smoked Back Bacon 300g", 1, 275], ["Sainsbury's 150g Buffalo Mozzarella, Taste the Difference", 1, 250]],
  // The first change takes the bacon off and adds lemons; the second adds two tins of tomatoes.
  second: [["Sainsbury's Wholemeal Pittas x6", 1, 65], ["Sainsbury's Free Range Eggs x12", 1, 340], ["Sainsbury's 150g Buffalo Mozzarella, Taste the Difference", 1, 250], ["Sainsbury's Unwaxed Lemons x4", 1, 120]],
  third: [["Sainsbury's Wholemeal Pittas x6", 1, 65], ["Sainsbury's Free Range Eggs x12", 1, 340], ["Sainsbury's 150g Buffalo Mozzarella, Taste the Difference", 1, 250], ["Sainsbury's Unwaxed Lemons x4", 1, 120], ["Sainsbury's Chopped Tomatoes 400g", 2, 110]],
};

export default function holdout13a() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };

  // ---- A darts shop on Shopify: "Name × 1", then the flights' weight on a line of its own ("25"), then the price ------------
  {
    const o = order([{ name: "Arrowline Pro Board Bundle", qty: 1, unit: 8995 }, { name: "Kestrel Steel Flights 3", qty: 1, unit: 1850 }]);
    add("holdout13a-shopify-weight-line", "Bullseye Supplies", "'Kestrel Steel Flights 3 × 1' over a bare '25' (the weight in grams), then the price", { from: "Bullseye Supplies <store@bullseye-supplies.example>", subject: "Order #1000482219 confirmed",
      date: "Tue, 28 Jul 2026 10:00:00 +0000",
      html: mail("Bullseye Supplies", "bullseye-supplies.example", ["Thank you for your purchase!", "Order #1000482219", "Order summary", "Arrowline Pro Board Bundle × 1", "£89.95", "Kestrel Steel Flights 3 × 1", "25", "£18.50",
        "Subtotal", "£108.45", "Shipping", "£0.00", "Taxes", "£18.08", "Total", "£108.45 GBP"]) }, o, "Bullseye Supplies", "2026-07-28");
  }
  // ---- A supermarket: pack sizes in names ("Pittas x6") over a quantity column --------------------------------------------------
  const list = (items) => items.flatMap(([n, q, p]) => [n, String(q), gbp(p), "Substitution allowed"]);
  const sumOf = (items) => items.reduce((n, [, , p]) => n + p, 0);
  const grocer = (id, layout, subject, date, items, head) => {
    const o = order(items.map(([name, qty, line]) => ({ name, qty, unit: line / qty })), { fees: [["Delivery cost", 100]] });
    const lines = ["Order Confirmation - Sainsbury's", ...head, "Order number", GROCER.ref, "Estimated total", gbp(sumOf(items) + 100) + "*", "Your payment details", "Payment card: VISA ending in 4821", "Address:", SHOPPER.address,
      "Groceries", `(${items.length} items)`, "Items", "Quantity", "Price", ...list(items), "Your order summary", "Trolley cost", gbp(sumOf(items)), "Delivery cost", "£1.00", "Estimated total", gbp(sumOf(items) + 100) + "*"];
    return add(id, "Sainsbury's", layout, { from: "Sainsbury's <service@sainsburys.co.uk>", subject, date, html: mail("Sainsbury's", "sainsburys.co.uk", lines) }, o, "Sainsbury's", new Date(date).toISOString().slice(0, 10), {});
  };
  {
    const c = grocer("holdout13a-grocer-confirmation", "pack sizes in names ('Pittas x6', 'Eggs x12') over a quantity column", "Thanks for your order - " + GROCER.ref, "Wed, 07 Oct 2026 12:00:00 +0000", GROCER.first, ["We've got your order"]);
    const a1 = grocer("holdout13a-grocer-change-1", "'We got your changes': the whole new list", "We got your changes - " + GROCER.ref, "Fri, 09 Oct 2026 16:30:00 +0000", GROCER.second, ["Sam, thanks, we've got your changes! See the details below:", "What you need to know", "You've amended your order", "We've got your changes and your order has been updated."]);
    a1.expected.orderUpdate = "amended"; a1.expected.orderRef = GROCER.ref;
    const a2 = grocer("holdout13a-grocer-change-2", "a second 'We got your changes', sent later", "We got your changes - " + GROCER.ref, "Fri, 09 Oct 2026 17:05:00 +0000", GROCER.third, ["Sam, thanks, we've got your changes! See the details below:", "What you need to know", "You've amended your order", "We've got your changes and your order has been updated."]);
    a2.expected.orderUpdate = "amended"; a2.expected.orderRef = GROCER.ref;
    const none = order([]);
    const day = add("holdout13a-grocer-day-of-substitution", "Sainsbury's", "delivery-day email: payment received, one item 'Substituted with' another at its own price", { from: "Sainsbury's <service@sainsburys.co.uk>", subject: "Receipt for your Sainsbury’s order " + GROCER.ref,
      date: "Sat, 10 Oct 2026 05:00:00 +0000",
      html: mail("Sainsbury's", "sainsburys.co.uk", ["Today 9:00am to 1:00pm", "What you need to know", "Your order is ready for today", "Order number: | " + GROCER.ref, "Payment received: | £9.20", "We've picked your items", "1 substitution, see more details below.",
        "Substitutions (1)", "We’ve tried to pick the best substitute for the unavailable items below.", "Items | Quantity | Price |", "Sainsbury's 150g Buffalo Mozzarella, Taste the Difference | at a quantity of 1 | £2.50 |", "Substituted with", "",
        "Sainsbury's Italian Mozzarella 125g | at a quantity of 1 | £1.85 |", "Our Substitute Promise", "Your e-receipt", "We've attached your e-receipt to this email."]) },
      none, "Sainsbury's", "2026-10-10", { totalPence: 920, attachmentOnly: "pdf", orderUpdate: "paid", orderRef: GROCER.ref });
    day.attach = [{ type: "application/pdf", name: "e-receipt.pdf" }];
  }
  return out;
}
