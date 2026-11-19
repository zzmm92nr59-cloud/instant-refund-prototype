// Reads every email in the receipt corpus (scripts/fixtures/receipt-emails/*.json) with Relay's real email reader, as it
// arrives from an inbox and as the shopper forwarded it from Gmail, Outlook and Apple Mail, and compares what was read with
// the answer key. It must get:
//   * the items exactly right (name, quantity, what the line cost, each extra attached to its item) on every email;
//   * the total right on every email;
//   * the totals check (worker/receipt-check.js) saying "items complete" only when they are, and "may have missed some"
//     whenever they aren't: no silent misses.
// The corpus is MADE UP (no real customer's data) and its layouts are written by Relay to look like each sender's; real
// emails can differ. That is what the totals check is for. A table of every miss is printed.
//   node scripts/test-receipt-corpus.mjs            (CI)
//   node scripts/test-receipt-corpus.mjs --report   (prints the per-shop table even when everything passes)
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReceiptEmail, parseReturnUpdateEmail, parseReturnEmail, parseReturnParcelEmail, parseCancellationEmail, parseOrderAdjustmentEmail } from "../worker/receipt-parser.js";
import { matchReturnNews } from "../worker/return-tracking.js";
import { storeKey } from "../worker/receipt-category.js";
import { mergeOrderEmails, attachCancellations, attachAdjustments, attachReturnProgress, classifyEmail } from "../worker/gmail.js";
import { rawEmail, forwarded, SHOPPER } from "./fixtures/receipt-emails/lib.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "receipt-emails");
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const everything = readdirSync(dir).filter((n) => n.endsWith(".json") && (!only || n.startsWith(only))).sort().map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")));
// Refunds, cancellations and price adjustments (expected.notPurchase) are read separately below: never a purchase.
const fixtures = everything.filter((f) => !f.expected.notPurchase);
const notPurchases = everything.filter((f) => f.expected.notPurchase);
const report = process.argv.includes("--report");
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const lineOf = (i) => (i.pricePence == null ? null : i.lineTotal ? i.pricePence : i.pricePence * (i.qty || 1));

function itemsRight(got, want) {
  if (got.length !== want.length) return `${got.length} items read, ${want.length} on the email`;
  for (let k = 0; k < want.length; k++) {
    const g = got[k], w = want[k];
    if (norm(g.name) !== norm(w.name)) return `item ${k + 1}: "${g.name}" for "${w.name}"`;
    if ((g.qty || 1) !== w.qty) return `item ${k + 1} (${w.name}): qty ${g.qty} for ${w.qty}`;
    if (lineOf(g) !== w.linePence) return `item ${k + 1} (${w.name}): line ${lineOf(g)} for ${w.linePence}`;
    for (const e of w.extras || []) if (!norm(g.variant).includes(norm(e))) return `item ${k + 1} (${w.name}): extra "${e}" not attached (variant: ${g.variant || "none"})`;
  }
  return null;
}

const rows = [];
for (const f of fixtures) {
  for (const app of [null, "gmail", "outlook", "apple"]) {
    const email = app ? forwarded(f, app) : f;
    const r = parseReceiptEmail(rawEmail(email));
    const w = f.expected;
    const res = { id: email.id, sender: f.sender, fwd: app, ok: r.ok };
    if (!r.ok) { rows.push({ ...res, items: "not read as a receipt (" + r.reason + ")", total: "not read", flagged: false, shop: false, date: false }); continue; }
    res.items = itemsRight(r.items || [], w.items);
    res.total = r.totalPence === w.totalPence && r.currency === w.currency ? null : `total ${r.totalPence} ${r.currency} for ${w.totalPence} ${w.currency}`;
    res.check = r.itemsCheck || null;
    // (Round 9: the name check, itemsCheck.namesOk, flags too. A right list must pass both.)
    res.flagged = Boolean(r.itemsCheck && (r.itemsCheck.complete === false || r.itemsCheck.namesOk === false));
    res.namesFlagged = Boolean(r.itemsCheck && r.itemsCheck.namesOk === false);
    res.shop = [w.shop, ...(w.shopAlso || [])].some((x) => norm(r.retailer && r.retailer.name) === norm(x)) ? null : `shop "${r.retailer && r.retailer.name}" for "${w.shop}"`;
    res.shopName = r.retailer && r.retailer.name;
    res.date = r.orderDate === w.date ? null : `date ${r.orderDate} for ${w.date}`;
    res.count = w.itemCount != null && r.itemCount !== w.itemCount ? `item count ${r.itemCount} for ${w.itemCount}` : null;
    // A receipt that is only in its attachment (a PDF, a photo) says so, and nothing is read from the attachment; no other
    // email says its details are in an attachment (round 4).
    res.attachment = (r.detailsInAttachment || null) === (w.attachmentOnly || null) ? null : `details in attachment: ${r.detailsInAttachment || "not said"} for ${w.attachmentOnly || "none"}`;
    // Round 10 (Connor's real inbox): the restaurant on a takeaway app's order; an Uber Eats receipt that lists no items says
    // so (never a saving read as an item); a supermarket's delivery-day email is the order's payment, joined by its number.
    res.more = [w.merchant !== undefined && norm(r.merchant) !== norm(w.merchant) ? `merchant "${r.merchant || ""}" for "${w.merchant}"` : null,
      w.noItemList && !(r.itemsCheck && r.itemsCheck.noItemList) ? "no 'lists no items' state" : null,
      w.orderUpdate && (r.orderUpdate !== w.orderUpdate || r.orderRef !== w.orderRef) ? `order update ${r.orderUpdate} ${r.orderRef} for ${w.orderUpdate} ${w.orderRef}` : null].filter(Boolean).join("; ") || null;
    rows.push(res);
  }
}

// A forwarded email must read the same as the original: the same shop, date, total and items.
const sameAsSent = rows.filter((r) => r.fwd).filter((r) => { const o = rows.find((x) => !x.fwd && x.id === r.id.split("~")[0]); return !o || o.shopName !== r.shopName || Boolean(o.items) !== Boolean(r.items) || Boolean(o.total) !== Boolean(r.total) || Boolean(o.date) !== Boolean(r.date); });
// An email with no item list in it ("Your order of 3 items") is incomplete by nature: the check must say so.
// So is a shipment email that lists only the items in its parcel under the whole order's total (expected.partial).
const wantsFlag = (row) => { const f = fixtures.find((x) => row.id.split("~")[0] === x.id); return f.expected.items.length === 0 || Boolean(f.expected.partial); };
const silent = rows.filter((r) => r.ok && (r.items || wantsFlag(r)) && !r.flagged);
const falseAlarm = rows.filter((r) => r.ok && !r.items && !wantsFlag(r) && r.flagged);
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : 100) + "%";
const originals = rows.filter((r) => !r.fwd), fwds = rows.filter((r) => r.fwd);
const sum = (list) => ({ n: list.length, items: list.filter((r) => !r.items).length, total: list.filter((r) => !r.total).length, shop: list.filter((r) => !r.shop).length, date: list.filter((r) => !r.date).length });
const a = sum(originals), b = sum(fwds);

const moreWrong = rows.filter((r) => r.more);
if (report || moreWrong.length || silent.length || falseAlarm.length || a.items < a.n || a.total < a.n || b.items < b.n || b.total < b.n) {
  const bySender = new Map();
  for (const r of rows) { const e = bySender.get(r.sender) || []; e.push(r); bySender.set(r.sender, e); }
  console.log("\nPer shop (originals and forwards together): items right / totals right / shop right / date right");
  for (const [s, list] of [...bySender].sort()) { const x = sum(list); console.log(`  ${s.padEnd(18)} ${String(x.items).padStart(3)}/${x.n} items  ${String(x.total).padStart(3)}/${x.n} totals  ${String(x.shop).padStart(3)}/${x.n} shop  ${String(x.date).padStart(3)}/${x.n} date`); }
  const misses = rows.filter((r) => r.items || r.total || r.shop || r.date || r.count || r.attachment || r.more);
  if (misses.length) {
    console.log("\nMisses:");
    for (const r of misses) console.log(`  ${r.id.padEnd(34)} ${[r.items, r.total, r.shop, r.date, r.count, r.attachment, r.more].filter(Boolean).join("; ")}${r.items ? (r.flagged ? "  [flagged]" : "  [NOT FLAGGED]") : ""}`);
  }
  if (falseAlarm.length) { console.log("\nFlagged although the items are right:"); for (const r of falseAlarm) console.log("  " + r.id, JSON.stringify(r.check)); }
}
console.log(`\nReceipt corpus: ${fixtures.length} emails from ${new Set(fixtures.map((f) => f.sender)).size} senders, each also forwarded from Gmail, Outlook and Apple Mail (${rows.length} reads).`);
console.log(`  As sent:   items right ${a.items}/${a.n} (${pct(a.items, a.n)}), totals right ${a.total}/${a.n} (${pct(a.total, a.n)}), shop ${a.shop}/${a.n}, date ${a.date}/${a.n}`);
console.log(`  Forwarded: items right ${b.items}/${b.n} (${pct(b.items, b.n)}), totals right ${b.total}/${b.n} (${pct(b.total, b.n)}), shop ${b.shop}/${b.n}, date ${b.date}/${b.n}`);
console.log(`  Forwards that read differently from the original: ${sameAsSent.length}`);
console.log(`  Totals check: ${silent.length} silent misses, ${falseAlarm.length} false alarms`);
const namesFalse = rows.filter((r) => r.ok && !r.items && r.namesFlagged);
console.log(`  Name check: ${namesFalse.length} right item lists flagged (of ${rows.filter((r) => r.ok && !r.items).length})`);
for (const r of namesFalse) console.log("    " + r.id, JSON.stringify(r.check && r.check.suspectNames));

// A refund, a cancellation or a price adjustment is never read as a new purchase, as sent or forwarded. A refund's amount and
// order number are read (parseReturnUpdateEmail), so it can attach to the order it belongs to (return-tracking.js).
const notRight = [];
for (const f of notPurchases) {
  for (const app of [null, "gmail", "outlook", "apple"]) {
    const email = app ? forwarded(f, app) : f;
    const raw = rawEmail(email), w = f.expected.notPurchase;
    if (parseReceiptEmail(raw).ok) notRight.push(`${email.id}: read as a purchase (${w.kind})`);
    // A price drop or a cancellation is never a return either: nothing was sent back, so no return may show as refunded.
    if (w.kind !== "refund") {
      if (parseReturnUpdateEmail(raw).ok) notRight.push(`${email.id}: read as a return's news (${w.kind})`);
      if (parseReturnEmail(raw).ok) notRight.push(`${email.id}: read as return instructions (${w.kind})`);
      if (parseReturnParcelEmail(raw).ok) notRight.push(`${email.id}: read as a return parcel (${w.kind})`);
    }
    // A takeaway app's changed total: money back on the order, with the refund and the restaurant read (round 10).
    if (w.kind === "adjusted") {
      const a = parseOrderAdjustmentEmail(raw);
      if (!a.ok || a.amountPence !== w.refundPence || norm(a.merchant) !== norm(w.merchant)) notRight.push(`${email.id}: adjustment read as ${JSON.stringify(a.ok ? { refund: a.amountPence, merchant: a.merchant } : a.reason)}`);
    }
    if (w.kind === "refund") {
      const u = parseReturnUpdateEmail(raw);
      if (!u.ok || u.stage !== "refunded") notRight.push(`${email.id}: refund not read as a refund`);
      else {
        if (u.amountPence !== w.refundPence) notRight.push(`${email.id}: refund ${u.amountPence} for ${w.refundPence}`);
        if (u.orderRef !== w.orderRef) notRight.push(`${email.id}: refund's order ${u.orderRef} for ${w.orderRef}`);
        // It attaches to the order it is for, by the order's number, even when the shopper forwarded it from their own
        // mailbox (two orders from the same shop, so only the number can say which).
        const sent = parseReturnUpdateEmail(rawEmail(f));
        const orders = [{ id: "a", orderRef: w.orderRef, orderDate: "2026-09-01", retailer: sent.retailer, totalPence: 99999 },
          { id: "b", orderRef: "OTHER-0001", orderDate: "2026-09-01", retailer: sent.retailer, totalPence: 99999 }];
        const news = [{ stage: "refunded", at: u.at, by: "shop", via: "email", ref: u.orderRef ? String(u.orderRef).toUpperCase() : null,
          shopKey: u.retailer && (u.retailer.domain || u.retailer.name) ? storeKey(u) : null }];
        const m = matchReturnNews(orders, news, new Map(), new Set());
        if (!(m.get(orders[0]) || []).length) notRight.push(`${email.id}: refund not attached to its order by number`);
        if (app && (u.retailer.name !== sent.retailer.name || u.retailer.domain !== sent.retailer.domain)) notRight.push(`${email.id}: forwarded refund names shop ${u.retailer.name || u.retailer.domain} for ${sent.retailer.name || sent.retailer.domain}`);
      }
    }
  }
}
if (notPurchases.length) console.log(`  Refunds, cancellations and price adjustments: ${notPurchases.length} emails (${notPurchases.length * 4} reads), ${notRight.length} wrong${notRight.length ? ":\n    " + notRight.join("\n    ") : ""}`);

// The item count the email states catches a real miss that the money can't: a free gift written as a sentence, with no price,
// is not read as an item, and the two priced items still add up to the subtotal. Only "Your order of 3 items" shows that
// something is missing. (Made-up email; the same email without that line reads as complete, so the count is what caught it.)
const countMail = (withCount) => rawEmail({ id: "count-check", headers: { from: "Example Shop <orders@exampleshop.co.uk>", to: "sam.taylor@example.co.uk",
  subject: "Your Example Shop order ES-10021", date: "Mon, 16 Nov 2026 10:00:00 +0000" }, html: "", text: [
  "Example Shop", "Order number: ES-10021", "Order date: 16 November 2026", ...(withCount ? ["Your order of 3 items"] : []),
  "Linen Shirt White", "Qty: 1", "£35.00", "Canvas Belt Tan", "Qty: 1", "£15.00",
  "Free with your order: a Mini Canvas Tote, while stocks last, sent in the same parcel as the rest of your items.",
  "Subtotal £50.00", "Delivery FREE", "Total £50.00"].join("\n") });
const counted = parseReceiptEmail(countMail(true)), uncounted = parseReceiptEmail(countMail(false));
const countCaught = counted.ok && counted.items.length === 2 && counted.itemsCheck && counted.itemsCheck.complete === false && counted.itemsCheck.countStated === 3 &&
  uncounted.ok && uncounted.items.length === 2 && uncounted.itemsCheck && uncounted.itemsCheck.complete === true;
console.log(`  Stated item count: a missed free item ${countCaught ? "is" : "is NOT"} flagged by "Your order of 3 items" (money alone says complete)`);

// A split shipment: each parcel's email lists only what is in it, under the whole order's total. Its emails make one card for
// the order (never one card per parcel), with every item once, and the card says the items are complete only when they are.
// (Made-up emails: two House of Fraser-style parcel emails, then the same two with the order's confirmation.)
const parcelMail = (id, subject, date, lines) => rawEmail({ id, headers: { from: "Example Shop <orders@exampleshop.co.uk>", to: "sam.taylor@example.co.uk", subject, date }, html: "",
  text: ["Example Shop", "Some of your items have been dispatched.", "Order number: ES-55012", "Order date: 30 October 2026", "Items in this delivery", ...lines, "Order total £393.00"].join("\n") });
const confirmMail = rawEmail({ id: "split-confirm", headers: { from: "Example Shop <orders@exampleshop.co.uk>", to: "sam.taylor@example.co.uk", subject: "Your Example Shop order ES-55012", date: "Fri, 30 Oct 2026 09:00:00 +0000" }, html: "",
  text: ["Example Shop", "Order number: ES-55012", "Order date: 30 October 2026", "Wax Jacket Olive | Qty 1 | £259.00", "Lambswool Scarf | Qty 1 | £45.00", "Tartan Umbrella | Qty 1 | £89.00", "Subtotal £393.00", "Delivery FREE", "Total £393.00"].join("\n") });
const asCard = (raw, id, createdAt) => { const r = parseReceiptEmail(raw); return r.ok ? { id, createdAt, status: "pending", ...r } : null; };
const p1 = asCard(parcelMail("split-1", "Part of your order ES-55012 has been dispatched", "Mon, 2 Nov 2026 14:00:00 +0000", ["Wax Jacket Olive | Qty 1 | £259.00", "Lambswool Scarf | Qty 1 | £45.00"]), "p1", 2);
const p2 = asCard(parcelMail("split-2", "Part of your order ES-55012 has been dispatched", "Wed, 4 Nov 2026 14:00:00 +0000", ["Tartan Umbrella | Qty 1 | £89.00"]), "p2", 3);
const conf = asCard(confirmMail, "c", 1);
const splitWrong = [];
if (!p1 || !p2 || !conf) splitWrong.push("a parcel email or the confirmation was not read");
else {
  if (p1.itemsCheck.complete !== false || p2.itemsCheck.complete !== false) splitWrong.push("a parcel email on its own was not flagged as only part of the order");
  for (const [label, list] of [["two parcels", [p1, p2]], ["two parcels and the confirmation", [p1, p2, conf]], ["the confirmation and two parcels", [conf, p2, p1]]]) {
    const cards = mergeOrderEmails(list.map((o) => ({ ...o, items: o.items.map((i) => ({ ...i })) })));
    const names = cards.length === 1 ? cards[0].items.map((i) => i.name).sort().join(", ") : "";
    if (cards.length !== 1) splitWrong.push(`${label}: ${cards.length} cards for one order`);
    else if (names !== "Lambswool Scarf, Tartan Umbrella, Wax Jacket Olive") splitWrong.push(`${label}: items ${names}`);
    else if (!cards[0].itemsCheck || cards[0].itemsCheck.complete !== true) splitWrong.push(`${label}: the whole order's items not marked complete`);
  }
  const one = mergeOrderEmails([{ ...p1, items: p1.items.map((i) => ({ ...i })) }]);
  if (one[0].itemsCheck.complete !== false) splitWrong.push("one parcel alone: marked complete");
}
console.log(`  Split shipments: ${splitWrong.length ? splitWrong.join("; ") : "one card per order, every item once, complete only when it is"}`);

// Round 4: an email whose HTML is mostly one enormous attribute (a 300 KB tracking address and style) is still read, and
// quickly: the order after it is not pushed out of what is read. (Made-up email.)
const longAttr = "x".repeat(300000);
const bulky = `From: Example Shop <orders@exampleshop.co.uk>\r\nSubject: Your Example Shop order ES-30001\r\nDate: Mon, 16 Nov 2026 10:00:00 +0000\r\nContent-Type: text/html; charset=utf-8\r\n\r\n` +
  `<html><body><a href="https://t.example.com/?u=${longAttr}">View in browser</a><p>Order number: ES-30001</p><table style="${"color:#222;".repeat(30000)}"><tr><td>Linen Shirt White</td><td>Qty 1</td><td>£35.00</td></tr></table><p>Subtotal £35.00</p><p>Total £35.00</p></body></html>`;
const bulkyAt = Date.now(), bulkyRead = parseReceiptEmail(bulky), bulkyMs = Date.now() - bulkyAt;
const bulkyOk = bulkyRead.ok && bulkyRead.totalPence === 3500 && bulkyRead.items.length === 1 && bulkyRead.itemsCheck.complete === true && bulkyMs < 2000;
console.log(`  A 600 KB email that is mostly one attribute: ${bulkyOk ? "read" : "NOT read"} in ${bulkyMs} ms`);

// Round 8: on an order the shop cancelled part of, the item its email names as cancelled is marked on the receipt; nothing
// is marked when the email names no item, whatever the amount (it is never guessed from the money). Made-up emails.
const cancelMail = (subject, lines) => `From: Example Shop <orders@exampleshop.co.uk>\r\nSubject: ${subject}\r\nDate: Fri, 13 Nov 2026 09:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n` + lines.join("\n");
const cancelOrder = () => ({ orderRef: "ES-77001", retailer: { name: "Example Shop", domain: "exampleshop.co.uk" }, totalPence: 9000, currency: "GBP",
  items: [{ name: "Linen Shirt White", qty: 1, pricePence: 3500 }, { name: "Canvas Belt Tan", qty: 1, pricePence: 1500 }, { name: "Chino Trousers Navy", qty: 1, pricePence: 4000 }] });
const cancelCases = [
  ["a 'Cancelled items' list", cancelMail("Part of your order ES-77001 has been cancelled", ["Some items in your order have been cancelled", "Order number: ES-77001", "", "Cancelled items", "Canvas Belt Tan", "Quantity 1", "Price £15.00", "", "Amount to be refunded: £15.00"]), ["Canvas Belt Tan"]],
  ["a sentence", cancelMail("An item in your order ES-77001 has been cancelled", ["Order number: ES-77001", "Sorry, we've had to cancel the Linen Shirt White from your order as it is out of stock. You'll get £35.00 back."]), ["Linen Shirt White"]],
  ["only an amount (£40.00 is the trousers' price)", cancelMail("Part of your order ES-77001 has been cancelled", ["Order number: ES-77001", "Part of your order has been cancelled. £40.00 will be refunded to your card."]), []],
  ["a name that is no item's", cancelMail("Part of your order ES-77001 has been cancelled", ["Order number: ES-77001", "", "Cancelled items", "Wool Scarf Grey", "Price £20.00"]), []],
];
const cancelWrong = [];
for (const [label, raw, want] of cancelCases) {
  const c = parseCancellationEmail(raw);
  if (!c.ok || !c.partial) { cancelWrong.push(label + ": not read as part of the order cancelled"); continue; }
  const o = cancelOrder();
  attachCancellations([o], [c]);
  const got = o.items.filter((i) => i.cancelled === true).map((i) => i.name);
  if (!o.cancelled || !o.cancelled.partial) cancelWrong.push(label + ": the order not marked part cancelled");
  if (got.join(", ") !== want.join(", ")) cancelWrong.push(`${label}: marked ${got.join(", ") || "nothing"} for ${want.join(", ") || "nothing"}`);
}
console.log(`  Part-cancelled orders: ${cancelWrong.length ? cancelWrong.join("; ") : "the item the email names is marked cancelled; nothing when it names none or only an amount"}`);

// Round 10 (Connor's real inbox): a supermarket's delivery-day email joins its order's confirmation by the order number, and
// its "Payment received" becomes the order's total; the items, which came to the estimated total, are then said to be maybe
// incomplete (the full receipt is the shop's attachment). A takeaway app's changed total joins the order it changed.
const joinWrong = [];
{
  const card = (id, n) => ({ id: "r" + n, createdAt: n, kind: "receipt", status: "pending", ...parseReceiptEmail(rawEmail(JSON.parse(readFileSync(join(dir, id + ".json"), "utf8")))) });
  const merged = mergeOrderEmails([card("holdout11-sainsburys-confirmation", 1), card("holdout11-sainsburys-day-of", 2)]);
  const o = merged[0];
  if (merged.length !== 1) joinWrong.push(`delivery-day email made ${merged.length} cards`);
  else {
    if (o.totalPence !== 2310 || o.estimatedTotalPence !== 2220) joinWrong.push(`total ${o.totalPence} (estimated ${o.estimatedTotalPence}) for 2310 (2220)`);
    if ((o.items || []).length !== 7) joinWrong.push(`${(o.items || []).length} items for 7`);
    if (!(o.itemsCheck && o.itemsCheck.complete === false && o.itemsCheck.paidDiffers)) joinWrong.push("not said that items may be missing");
  }
  const meal = { id: "m1", kind: "receipt", ...parseReceiptEmail(rawEmail(JSON.parse(readFileSync(join(dir, "holdout11-ue-no-item-list.json"), "utf8")))) };
  const other = { ...meal, id: "m2", merchant: "Somewhere Else" };
  const adj = parseOrderAdjustmentEmail(rawEmail(JSON.parse(readFileSync(join(dir, "holdout11-ue-adjusted-total.json"), "utf8"))));
  attachAdjustments([meal, other], [{ kind: "order_update", stage: "adjusted", ...adj }]);
  if (!(meal.adjusted && meal.adjusted.refundPence === 625 && meal.adjusted.newTotalPence === 1511)) joinWrong.push("adjustment not joined to its order: " + JSON.stringify(meal.adjusted));
  if (other.adjusted) joinWrong.push("adjustment joined to another restaurant's order");
}
// Round 11 (Connor's real inbox, four blind checks): emails of one order that must end as one card, or none.
{
  const fx = (id) => JSON.parse(readFileSync(join(dir, id + ".json"), "utf8"));
  const card = (id, n) => ({ id: "c" + n, createdAt: n, kind: "receipt", status: "pending", ...parseReceiptEmail(rawEmail(fx(id))) });
  const cancel = (id) => ({ kind: "order_update", stage: "cancelled", ...parseCancellationEmail(rawEmail(fx(id))) });
  // A takeaway order and its cancellation, by the number under "Your order number is:".
  const je = mergeOrderEmails([card("holdout12-je-order-number-under-label", 1)]);
  attachCancellations(je, [cancel("holdout12-je-cancelled")]);
  if (!(je[0].cancelled && je[0].cancelled.partial === false)) joinWrong.push("takeaway cancellation not joined by its number");
  // A cancellation with no number that shows the item joins the one order of that shop with that item, and no other.
  const tableOrder = card("holdout12-furniture-order-label", 2);
  const other = { ...card("holdout12-furniture-order-label", 3), orderRef: "LWH-OTHER-1", items: [{ name: "Velvet Accent Chair", qty: 1, pricePence: 19999 }] };
  const furn = mergeOrderEmails([tableOrder, other]);
  const c = cancel("holdout12-furniture-cancelled-no-number");
  if (!c.ok || c.orderRef !== null || !c.byItems) joinWrong.push("item-named cancellation not read: " + JSON.stringify(c.reason || c.orderRef));
  attachCancellations(furn, [c]);
  if (!(furn[0].cancelled && !furn[0].cancelled.partial) || furn[1].cancelled) joinWrong.push("item-named cancellation joined the wrong order");
  const twice = mergeOrderEmails([card("holdout12-furniture-order-label", 4), { ...card("holdout12-furniture-order-label", 5), orderRef: "LWH-OTHER-2" }]);
  attachCancellations(twice, [c]);
  if (twice.some((o) => o.cancelled)) joinWrong.push("item-named cancellation guessed between two orders with the same item");
  // A payment service's receipt for the shop's order (same number but the shop's letters, same money, same day): one card,
  // led by the shop's own email.
  const shop = card("holdout12-rugs-comma-pence", 6);
  const paypal = { id: "p1", createdAt: 7, kind: "receipt", retailer: { name: "Rugsmith AB", domain: null, via: "paypal.co.uk" }, orderRef: "5502714", orderDate: shop.orderDate, totalPence: shop.totalPence, currency: "GBP",
    items: [{ name: "Linen cushion cover 4...", qty: 2, pricePence: 1350 }], itemsCheck: { complete: false } };
  const one = mergeOrderEmails([shop, paypal]);
  if (one.length !== 1 || one[0].retailer.name !== "Rugsmith") joinWrong.push(`a PayPal receipt and the shop's order made ${one.length} cards`);
  if (mergeOrderEmails([shop, { ...paypal, totalPence: shop.totalPence + 500 }]).length !== 2) joinWrong.push("a PayPal receipt for other money joined the order");
  // A PDF-only invoice of the shop days after its itemised order email is that order's; a parcel "-1" of an order joins it.
  const coffee = card("holdout12-coffee-sections", 8);
  const inv = { id: "i1", createdAt: 9, kind: "receipt", retailer: { name: "Brewhaus", domain: "brewhaus.example" }, orderRef: "88120044", orderDate: coffee.orderDate, totalPence: null, items: [], detailsInAttachment: "pdf" };
  const c1 = mergeOrderEmails([coffee, inv]);
  if (c1.length !== 1 || c1[0].orderRef !== "88120044") joinWrong.push(`a PDF-only invoice made ${c1.length} cards`);
  const paints = card("holdout12-paints-no-pence", 10);
  const parcel = { id: "s1", createdAt: 11, kind: "receipt", retailer: { name: "Nordvik Paints", domain: "nordvik-paints.example" }, orderRef: paints.orderRef + "-1", orderDate: paints.orderDate, totalPence: null, items: [] };
  if (mergeOrderEmails([paints, parcel]).length !== 1) joinWrong.push("a parcel numbered '-1' of an order made a card of its own");
  // A shop's reply quoting the order, and a booking someone else forwarded to the shopper, are never purchases.
  const reply = ["From: Bedcraft <hello@bedcraft.example>", "To: Sam Taylor <sam.taylor@example.co.uk>", "Subject: RE: Order #1806 confirmed", "Date: Mon, 6 Jul 2026 10:30:55 +0000", "In-Reply-To: <abc@mail.example>",
    "Content-Type: text/plain; charset=utf-8", "", "Hi Sam, thanks for your message. Your delivery is booked.", "", "Order #1806 confirmed", "Ottoman Bed Frame | £899.00", "Total | £899.00"].join("\r\n");
  if (parseReceiptEmail(reply).ok) joinWrong.push("a shop's reply read as a purchase");
  const fwd = ["From: Alex Morgan <alex.morgan@outlook.com>", "To: Sam Taylor <sam.taylor@example.co.uk>", "Subject: Fw: Flight Booking Confirmed: London - Faro", "Date: Thu, 5 Feb 2026 18:13:21 +0000", "Content-Type: text/plain; charset=utf-8", "",
    "________________________________", "From: SkyTrips <flights@skytrips.example>", "Sent: 4 February 2026 20:00", "To: alex.morgan@outlook.com <alex.morgan@outlook.com>", "Subject: Flight Booking Confirmed: London - Faro", "",
    "Dear ALEX MORGAN,", "Your booking is confirmed. Booking number 5531877201", "Total | £412.30"].join("\r\n");
  if (parseReceiptEmail(fwd).ok) joinWrong.push("someone else's forwarded booking read as the shopper's purchase");
  const mine = fwd.replace("From: Alex Morgan <alex.morgan@outlook.com>", "From: Sam Taylor <sam.taylor@outlook.com>").replace(/alex\.morgan@outlook\.com/g, "sam.taylor@outlook.com").replace("ALEX MORGAN", "SAM TAYLOR");
  if (!parseReceiptEmail(mine).ok) joinWrong.push("the shopper's own forwarded booking not read");
}
// Round 12 (Connor's real inbox): a changed order's emails ("We got your changes", each with the whole new list) make one card
// with the latest list and no taken-off item; the delivery-day email's substitution shows what came instead, at its price.
{
  const card = (id, n) => ({ id: "g" + n, createdAt: n, kind: "receipt", status: "pending", ...parseReceiptEmail(rawEmail(JSON.parse(readFileSync(join(dir, id + ".json"), "utf8")))) });
  // (In any order the emails were read: the change sent last is the order as it now is.)
  for (const order of [[1, 2, 3, 4], [4, 3, 2, 1], [3, 1, 4, 2]]) {
    const ids = ["holdout13a-grocer-confirmation", "holdout13a-grocer-change-1", "holdout13a-grocer-change-2", "holdout13a-grocer-day-of-substitution"];
    const cards = mergeOrderEmails(order.map((k, n) => card(ids[k - 1], n + 1)));
    if (cards.length !== 1) { joinWrong.push(`a changed order made ${cards.length} cards`); continue; }
    const o = cards[0], names = (o.items || []).map((i) => i.name);
    if (o.orderDate !== "2026-10-07") joinWrong.push(`changed order dated ${o.orderDate} for its confirmation's 2026-10-07`);
    if (names.length !== 5 || names.some((n) => /Bacon/.test(n)) || !names.some((n) => /Chopped Tomatoes/.test(n))) joinWrong.push("changed order's items not the latest list: " + names.join(", "));
    const sub = (o.items || []).find((i) => /Italian Mozzarella/.test(i.name));
    if (!sub || sub.pricePence !== 185 || !/Buffalo Mozzarella/.test(sub.substitutedFor || "") || names.some((n) => /Buffalo/.test(n))) joinWrong.push("substitution not shown: " + JSON.stringify(sub || null));
    if (o.totalPence !== 920) joinWrong.push(`changed order's total ${o.totalPence} for the paid 920`);
  }
}
// Round 12: money back joins the order it is for. A support reply's refund and account credit by the order number it names
// (the first number that is one of the shop's orders); a payment service's refund naming no order by what was first paid, to
// whom and when, and only when one order fits; a refund naming the shop's invoice by that number.
{
  const mail = (from, subject, date, body) => `From: ${from}\r\nTo: ${SHOPPER.email}\r\nSubject: ${subject}\r\nDate: ${date}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
  const je = (n, ref, total) => ({ id: "je" + n, createdAt: n, kind: "receipt", retailer: { name: "Just Eat", domain: "just-eat.co.uk" }, orderRef: ref, orderDate: "2025-08-31", totalPence: total, currency: "GBP", items: [] });
  const orders = [je(1, "664851790", 2397), je(2, "771200999", 1500)];
  const reply = (body) => classifyEmail(mail("Just Eat UK <info@just-eat.co.uk>", "[Just Eat UK] Re: Just Eat Order 664851790", "Sun, 07 Sep 2025 10:50:00 +0000", body)).details;
  const a1 = reply("Thank you for reaching out about your recent order 552658111.\n\nI can see that we refunded you £4**.99** on 31/08/25.");
  const a2 = reply("We are sorry items were missing from your recent order 664851790.\n\nWe've added a £3.99 credit to your Just Eat account, which covers the value of the affected items.");
  const no = reply("We're sorry, but we are unable to offer a refund of £5.00 for order 664851790.");
  if (no.kind === "order_update") joinWrong.push("a refused refund read as money back");
  attachAdjustments(orders, [a1, a2].filter((x) => x.kind === "order_update"));
  const adj = orders[0].adjusted;
  if (!(adj && adj.refundPence === 499 && adj.creditPence === 399) || orders[1].adjusted) joinWrong.push("support refund and credit not joined to the order they name: " + JSON.stringify(adj || null));
  const ride = (n, total, day) => ({ id: "u" + n, createdAt: n, kind: "receipt", retailer: { name: "Uber", domain: "uber.com" }, orderRef: null, orderDate: day, totalPence: total, currency: "GBP", items: [] });
  const pp = classifyEmail(mail("\"service@paypal.co.uk\" <service@paypal.co.uk>", "You've got a refund from UBER PAYMENTS UK LIMITED", "Wed, 18 Mar 2026 09:00:00 +0000",
    "You've got a refund from UBER PAYMENTS UK LIMITED\nYour refund of £3.06 GBP from UBER PAYMENTS UK LIMITED\nRefund complete! Available now in your balance.\nYou originally paid UBER PAYMENTS UK LIMITED £4.99 GBP on 5 March 2026. View receipt\nRefund total\n£3.06 GBP")).details;
  const rides = [ride(1, 499, "2026-03-05"), ride(2, 499, "2026-03-09"), ride(3, 720, "2026-03-05")];
  attachReturnProgress(rides, [], [pp]);
  if (!(rides[0].returnProgress && rides[0].returnProgress.refundPence === 306) || rides[1].returnProgress || rides[2].returnProgress) joinWrong.push("payment service's refund not joined by what was first paid: " + JSON.stringify(pp.paidPence) + " " + JSON.stringify(rides.map((r) => r.returnProgress && r.returnProgress.refundPence)));
  const twice = [ride(4, 499, "2026-03-05"), ride(5, 499, "2026-03-05")];
  attachReturnProgress(twice, [], [pp]);
  if (twice.some((r) => r.returnProgress)) joinWrong.push("payment service's refund guessed between two rides for the same money");
  // One email confirming two orders: a card for each, each with its own number, total and items.
  const two = mergeOrderEmails([{ id: "t1", createdAt: 1, kind: "receipt", ...parseReceiptEmail(rawEmail(JSON.parse(readFileSync(join(dir, "holdout13a-two-orders-one-email.json"), "utf8")))) }]);
  if (two.length !== 2 || two[1].orderRef !== "301-5510022-4410002" || two[1].totalPence !== 3100 || (two[1].items || []).map((i) => i.name).join() !== "Eau de Parfum 50ml" || two[0].totalPence !== 2249)
    joinWrong.push("an email with two orders made " + JSON.stringify(two.map((o) => [o.orderRef, o.totalPence, (o.items || []).length])));
  const inv = parseReturnUpdateEmail(rawEmail(JSON.parse(readFileSync(join(dir, "holdout13a-paypal-refund-invoice.json"), "utf8"))));
  const wine = [{ id: "w1", createdAt: 1, kind: "receipt", retailer: { name: "Cellar Club Ltd", domain: null, via: "paypal.co.uk" }, orderRef: "CC22001544-P001", orderDate: "2026-06-13", totalPence: 3000, items: [] },
    { id: "w2", createdAt: 2, kind: "receipt", retailer: { name: "Cellar Club Ltd", domain: null, via: "paypal.co.uk" }, orderRef: "CC22170130-P001", orderDate: "2026-07-14", totalPence: 3000, items: [] }];
  attachReturnProgress(wine, [], [{ kind: "return_update", ...inv }]);
  if (!(wine[0].returnProgress && wine[0].returnProgress.refundPence === 3000) || wine[1].returnProgress) joinWrong.push("refund naming the shop's invoice not joined to that order");
}
console.log(`  Orders joined by later emails: ${joinWrong.length ? joinWrong.join("; ") : "a delivery-day payment and an Uber Eats adjustment join their orders; round 11: cancellations by number or by the items named, a PayPal receipt, a PDF-only invoice and a numbered parcel join their order; replies and someone else's forwarded booking are not purchases; round 12: a changed order shows its latest list and the day's substitutions, and money back joins its order"}`);

let failed = 0;
const need = (cond, msg) => { if (!cond) { failed++; console.log("FAIL - " + msg); } };
need(joinWrong.length === 0, "a delivery-day payment and a changed total join the order they belong to (round 10)");
need(!moreWrong.length, "the restaurant, the 'lists no items' state and a delivery-day payment read right (round 10)");
need(cancelWrong.length === 0, "a part-cancelled order marks the item its email names as cancelled, and only that");
need(a.items === a.n && b.items === b.n, "items exactly right on every email, as sent and forwarded");
need(a.total === a.n && b.total === b.n, "totals right on every email");
need(silent.length === 0, "the totals check flags every email whose items are incomplete");
need(falseAlarm.length === 0, "the totals check never flags an email whose items are all there");
need(namesFalse.length === 0, "the name check never flags an email whose items are all right (round 9)");
need(sameAsSent.length === 0, "a forwarded email reads the same as the original (" + sameAsSent.map((r) => r.id).join(", ") + ")");
need(rows.filter((r) => r.count).length === 0, "the number of items an email states is read");
need(rows.filter((r) => r.ok && r.attachment).length === 0, "a receipt only in its attachment says so, and no other receipt does");
need(splitWrong.length === 0, "a split shipment's emails make one card with every item once");
need(bulkyOk, "an email that is mostly one enormous attribute is still read, quickly");
need(countCaught, "the item count an email states flags a miss the money can't see");
need(a.shop === a.n && b.shop === b.n, "the shop is named right on every email, as sent and forwarded");
need(a.date === a.n && b.date === b.n, "the order's date is read right on every email, as sent and forwarded");
need(notRight.length === 0, "refunds, cancellations and price adjustments are never purchases, and a refund's amount and order are read");
if (failed) process.exit(1);
console.log("ok - receipt corpus");
