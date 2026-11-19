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
import { parseReceiptEmail, parseReturnUpdateEmail, parseReturnEmail, parseReturnParcelEmail, parseCancellationEmail } from "../worker/receipt-parser.js";
import { matchReturnNews } from "../worker/return-tracking.js";
import { storeKey } from "../worker/receipt-category.js";
import { mergeOrderEmails, attachCancellations } from "../worker/gmail.js";
import { rawEmail, forwarded } from "./fixtures/receipt-emails/lib.mjs";

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
    res.flagged = Boolean(r.itemsCheck && r.itemsCheck.complete === false);
    res.shop = [w.shop, ...(w.shopAlso || [])].some((x) => norm(r.retailer && r.retailer.name) === norm(x)) ? null : `shop "${r.retailer && r.retailer.name}" for "${w.shop}"`;
    res.shopName = r.retailer && r.retailer.name;
    res.date = r.orderDate === w.date ? null : `date ${r.orderDate} for ${w.date}`;
    res.count = w.itemCount != null && r.itemCount !== w.itemCount ? `item count ${r.itemCount} for ${w.itemCount}` : null;
    // A receipt that is only in its attachment (a PDF, a photo) says so, and nothing is read from the attachment; no other
    // email says its details are in an attachment (round 4).
    res.attachment = (r.detailsInAttachment || null) === (w.attachmentOnly || null) ? null : `details in attachment: ${r.detailsInAttachment || "not said"} for ${w.attachmentOnly || "none"}`;
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

if (report || silent.length || falseAlarm.length || a.items < a.n || a.total < a.n || b.items < b.n || b.total < b.n) {
  const bySender = new Map();
  for (const r of rows) { const e = bySender.get(r.sender) || []; e.push(r); bySender.set(r.sender, e); }
  console.log("\nPer shop (originals and forwards together): items right / totals right / shop right / date right");
  for (const [s, list] of [...bySender].sort()) { const x = sum(list); console.log(`  ${s.padEnd(18)} ${String(x.items).padStart(3)}/${x.n} items  ${String(x.total).padStart(3)}/${x.n} totals  ${String(x.shop).padStart(3)}/${x.n} shop  ${String(x.date).padStart(3)}/${x.n} date`); }
  const misses = rows.filter((r) => r.items || r.total || r.shop || r.date || r.count || r.attachment);
  if (misses.length) {
    console.log("\nMisses:");
    for (const r of misses) console.log(`  ${r.id.padEnd(34)} ${[r.items, r.total, r.shop, r.date, r.count, r.attachment].filter(Boolean).join("; ")}${r.items ? (r.flagged ? "  [flagged]" : "  [NOT FLAGGED]") : ""}`);
  }
  if (falseAlarm.length) { console.log("\nFlagged although the items are right:"); for (const r of falseAlarm) console.log("  " + r.id, JSON.stringify(r.check)); }
}
console.log(`\nReceipt corpus: ${fixtures.length} emails from ${new Set(fixtures.map((f) => f.sender)).size} senders, each also forwarded from Gmail, Outlook and Apple Mail (${rows.length} reads).`);
console.log(`  As sent:   items right ${a.items}/${a.n} (${pct(a.items, a.n)}), totals right ${a.total}/${a.n} (${pct(a.total, a.n)}), shop ${a.shop}/${a.n}, date ${a.date}/${a.n}`);
console.log(`  Forwarded: items right ${b.items}/${b.n} (${pct(b.items, b.n)}), totals right ${b.total}/${b.n} (${pct(b.total, b.n)}), shop ${b.shop}/${b.n}, date ${b.date}/${b.n}`);
console.log(`  Forwards that read differently from the original: ${sameAsSent.length}`);
console.log(`  Totals check: ${silent.length} silent misses, ${falseAlarm.length} false alarms`);

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

let failed = 0;
const need = (cond, msg) => { if (!cond) { failed++; console.log("FAIL - " + msg); } };
need(cancelWrong.length === 0, "a part-cancelled order marks the item its email names as cancelled, and only that");
need(a.items === a.n && b.items === b.n, "items exactly right on every email, as sent and forwarded");
need(a.total === a.n && b.total === b.n, "totals right on every email");
need(silent.length === 0, "the totals check flags every email whose items are incomplete");
need(falseAlarm.length === 0, "the totals check never flags an email whose items are all there");
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
