// Coverage: which emails become receipts at all, and of what kind (Connor, 19 Nov 2026: "find 100% of my purchases").
// Each fixture in scripts/fixtures/receipt-coverage copies the layout of a kind of email found in a real inbox that Relay
// had never turned into a receipt (or had turned into the wrong thing). Every shop name, person, address, amount and
// order number in them is MADE UP. Each is read exactly as a scan reads it (gmail.js classifyEmail), as it arrives and as
// the shopper forwarded it, and must come out as the kind it is: a purchase as a receipt (with its total, day and shop when
// the fixture says), a refund as a refund, and anything that isn't a purchase never as one.
//   node scripts/test-receipt-coverage.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyEmail } from "../worker/gmail.js";
import { rawEmail, forwarded } from "./fixtures/receipt-emails/lib.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "receipt-coverage");
const fixtures = readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")));
assert.ok(fixtures.length >= 12, "the coverage fixtures are there: " + fixtures.length);

const kindOf = (d) => d.kind === "return_update" ? (d.stage === "refunded" ? "refund" : "return_update") : d.kind;
const problems = [];
for (const f of fixtures) {
  const w = f.expected;
  for (const app of [null, "gmail"]) {
    // (A forwarded email is read for the original inside it; not-purchases must stay not-purchases when forwarded too.)
    const email = app ? forwarded(f, app) : f;
    const { details: d } = classifyEmail(rawEmail(email), {}, false);
    const where = f.id + (app ? " (forwarded from " + app + ")" : "");
    if (kindOf(d) !== w.kind) { problems.push(`${where}: read as ${kindOf(d)}, is ${w.kind}`); continue; }
    if (w.kind !== "receipt") continue;
    if (w.totalPence !== undefined && d.totalPence !== w.totalPence) problems.push(`${where}: total ${d.totalPence} for ${w.totalPence}`);
    if (w.currency && d.currency !== w.currency) problems.push(`${where}: currency ${d.currency} for ${w.currency}`);
    if (w.date && d.orderDate !== w.date) problems.push(`${where}: date ${d.orderDate} for ${w.date}`);
    if (w.shop && !app && (!d.retailer || d.retailer.name !== w.shop)) problems.push(`${where}: shop ${d.retailer && d.retailer.name} for ${w.shop}`);
    for (const fl of w.flights || []) {
      if (!(d.flights || []).some((g) => g.from === fl.from && g.to === fl.to && (!fl.date || g.date === fl.date))) problems.push(`${where}: flight ${fl.from}-${fl.to} not read`);
    }
  }
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
const n = (k) => fixtures.filter((f) => f.expected.kind === k).length;
console.log(`PASS receipt coverage: ${fixtures.length} layouts from a real inbox (made up) read as what they are: ${n("receipt")} purchases, ${n("refund")} refunds, ${n("not_receipt")} not purchases; as sent and forwarded`);
