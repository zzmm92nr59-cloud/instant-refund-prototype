// A twenty-first set of made-up emails (see lib.mjs), round 15e (20 Nov 2026): layouts of emails in Connor's own inbox that
// blind checks found Relay still reading wrong, written again with everything in them made up (shops, items, prices,
// people, numbers). scripts/test-receipt-corpus.mjs reads them as purchases.
import { order, expected, page, fixture, h } from "./lib.mjs";

// Each line its own row, as these emails' builders set them out; a cell can hold lines of its own ("a<br>b").
const cell = (c) => c.split("\n").map(h).join("<br />");
const rows = (lines) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lines.map((l) => `<tr>${l.split(" || ").map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`).join("")}</table>`;
const mail = (brand, domain, lines) => page({ brand, domain, rows: [rows(lines)] });
// (Each line in a table of its own, nested in the page's cell, as some builders nest them.)
const nested = (brand, domain, lines) => page({ brand, domain, rows: [lines.map((l) => `<table role="presentation" width="100%"><tr><td>${cell(l)}</td></tr></table>`).join("")] });

export default function holdout16e() {
  const out = [];
  const add = (id, sender, layout, m, o, shop, date, extra = {}) => { const f = fixture(id, sender, layout, m, expected(shop, date, o, extra)); out.push(f); return f; };

  // ---- A shop's order confirmation: a drawn symbol before the "View Order" button, "Products Ordered (2)", then each
  // product's name, "Qty: N" and "£ 6.49"; the money lines a column of labels beside a column of amounts ------------------
  {
    const o = order([{ name: "Mango Chill Fizz Disposable Kit 20mg", qty: 1, unit: 649 }, { name: "Cola Ice Fizz Prefilled Pods 20mg", qty: 2, unit: 549 }], { fees: [["Shipping", 349]] });
    add("holdout16e-symbol-button-stacked-money", "Puffline", "'\u{1F9FE} View Order' (a button with a drawn symbol) over 'Products Ordered (2)'; each product its name, 'Qty: 1', '£ 6.49', each line in a table of its own; then 'Subtotal' over 'Shipping(Courier Tracked 48 (2-4 Working Days))' in one cell, '£17.47' over '£3.49' in the next", {
      from: "Puffline <orders@puffline.example>", subject: "Order Confirmation: #640213 | Puffline", date: "Tue, 10 Nov 2026 19:12:40 +0000",
      html: nested("Puffline", "puffline.example", ["Thank you for the order!", "Hi Sam Taylor \u{1F44B}\u{1F3FB},", "Your order 640213 has been accepted and is currently being processed by us.",
        "Order Number : 640213", "Order Date : 10 Nov 2026", "\u{1F9FE} View Order", "Products Ordered (2)",
        "Mango Chill Fizz Disposable Kit 20mg", "Qty: 1", "£ 6.49", "Cola Ice Fizz Prefilled Pods 20mg", "Qty: 2", "£ 10.98",
        "Subtotal\nShipping(Courier Tracked 48 (2-4 Working Days))", "£17.47\n£3.49", "Total", "£20.96", "SHIPPING ADDRESS", "Sam Taylor", "12 Example Road"]) },
      o, "Puffline", "2026-11-10", { orderRef: "640213" });
  }
  // ---- An online pharmacy's order: one medicine as a bullet under "Medication Items:", its pack under it, then the total --
  {
    const o = order([{ name: "Loratadine 10mg tablets", qty: 1, unit: 990 }]);
    add("holdout16e-bullet-medicine-over-total", "PillPost", "'Medication Items:' then '- ' and 'Loratadine 10mg tablets' over 'x 30', then 'Total £9.90'; no price of its own; no order number", {
      from: "PillPost <no-reply@pillpost.example>", subject: "Thanks for your order!", date: "Wed, 11 Nov 2026 18:45:25 +0000",
      html: mail("PillPost", "pillpost.example", ["Hello Sam,", "Thanks for choosing PillPost. We've sent your prescription request to your GP and it should be approved within 1-2 working days.",
        "Medication Items:", "- || Loratadine 10mg tablets\nx 30", "Total £9.90", "Delivery Address", "12 Example Road"]) },
      o, "PillPost", "2026-11-11", {});
  }
  // ---- A card shop's order: each item as labels over their values ("Item:" over its name, "Price:" over "£18.0"), the
  // recipient's address between; the total "including Postage & Packaging" with the postage not set out -------------------
  {
    const o = order([{ name: "Peony Letterbox Bouquet", qty: 1, unit: 1800 }, { name: "Best Mum Ever Photo Card", qty: 1, unit: 399 }]);
    add("holdout16e-labels-over-values-postage-in-total", "Cardcove", "per item 'Item:' over its name, 'Recipient Details:' over a name and address, 'Quantity:' over '1', 'Price:' over '£18.0', 'Discount:' over '£0.0'; 'Total (including Postage & Packaging costs):' over '£27.97' (postage not set out)", {
      from: "Cardcove <hello@cardcove.example>", subject: "Hooray! Your order is confirmed!", date: "Thu, 12 Nov 2026 09:30:00 +0000",
      html: mail("Cardcove", "cardcove.example", ["Thanks for your order!", "Order Reference: CCQX7RT2LM", "Order Date: 12-11-2026",
        "Item:", "Peony Letterbox Bouquet", "Recipient Details:", "Alex Morgan", "4 Sample Close", "Leeds", "LS2 7ZZ", "Quantity:", "1", "Price:", "£18.0", "Discount:", "£0.0", "Est Delivery:", "13-11-2026",
        "Item:", "Best Mum Ever Photo Card", "Recipient Details:", "Alex Morgan", "4 Sample Close", "Leeds", "LS2 7ZZ", "Quantity:", "1", "Price:", "£3.99", "Discount:", "£0.0", "Est Delivery:", "13-11-2026",
        "Total (including Postage & Packaging costs):", "£27.97", "View my order"]) },
      { ...o, total: 2797 }, "Cardcove", "2026-11-12", { orderRef: "CCQX7RT2LM", totalPence: 2797, partial: true });
  }
  // ---- A subscription's receipt: "Item" over "Price" as headings, the plan over "£7.49/month", "VAT 20% - £1.50", the total --
  {
    const o = order([{ name: "Premium: 1-month subscription", qty: 1, unit: 749 }]);
    add("holdout16e-stacked-headings-monthly-price", "Safeway VPN", "'Item' over 'Price' (headings on lines of their own), 'Premium: 1-month subscription' over '£7.49/month', 'VAT 20% - £1.50' (a dash between, no minus), 'Total: £8.99/month'", {
      from: "Safeway Account <support@safewayvpn.example>", subject: "Your purchase receipt", date: "Fri, 13 Nov 2026 15:31:14 +0000",
      html: mail("Safeway VPN", "safewayvpn.example", ["Thanks for your purchase!", "Your subscription includes:", "Safeway VPN, Password Vault.", "Item", "Price", "Premium: 1-month subscription", "£7.49/month",
        "VAT 20% - £1.50", "Total: £8.99/month", "Payment method: VISA ****1234", "Order date: Nov 13, 2026 03:31:14 PM UTC"]) },
      { ...o, total: 899 }, "Safeway Account", "2026-11-13", { totalPence: 899 });
  }
  return out;
}
