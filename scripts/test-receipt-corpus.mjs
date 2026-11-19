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
import { parseReceiptEmail, parseReturnUpdateEmail } from "../worker/receipt-parser.js";
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
  const misses = rows.filter((r) => r.items || r.total || r.shop || r.date || r.count);
  if (misses.length) {
    console.log("\nMisses:");
    for (const r of misses) console.log(`  ${r.id.padEnd(34)} ${[r.items, r.total, r.shop, r.date, r.count].filter(Boolean).join("; ")}${r.items ? (r.flagged ? "  [flagged]" : "  [NOT FLAGGED]") : ""}`);
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
    if (w.kind === "refund") {
      const u = parseReturnUpdateEmail(raw);
      if (!u.ok || u.stage !== "refunded") notRight.push(`${email.id}: refund not read as a refund`);
      else {
        if (u.amountPence !== w.refundPence) notRight.push(`${email.id}: refund ${u.amountPence} for ${w.refundPence}`);
        if (u.orderRef !== w.orderRef) notRight.push(`${email.id}: refund's order ${u.orderRef} for ${w.orderRef}`);
      }
    }
  }
}
if (notPurchases.length) console.log(`  Refunds, cancellations and price adjustments: ${notPurchases.length} emails (${notPurchases.length * 4} reads), ${notRight.length} wrong${notRight.length ? ":\n    " + notRight.join("\n    ") : ""}`);

let failed = 0;
const need = (cond, msg) => { if (!cond) { failed++; console.log("FAIL - " + msg); } };
need(a.items === a.n && b.items === b.n, "items exactly right on every email, as sent and forwarded");
need(a.total === a.n && b.total === b.n, "totals right on every email");
need(silent.length === 0, "the totals check flags every email whose items are incomplete");
need(falseAlarm.length === 0, "the totals check never flags an email whose items are all there");
need(sameAsSent.length === 0, "a forwarded email reads the same as the original (" + sameAsSent.map((r) => r.id).join(", ") + ")");
need(rows.filter((r) => r.count).length === 0, "the number of items an email states is read");
need(notRight.length === 0, "refunds, cancellations and price adjustments are never purchases, and a refund's amount and order are read");
if (failed) process.exit(1);
console.log("ok - receipt corpus");
