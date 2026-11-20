// Round 17 (20 Nov 2026): a re-read of a real inbox against its answer keys found readings that had got worse since round 16
// and false or missing details. Each is tested here on MADE-UP emails and receipts in the same layouts (shops, people,
// order numbers and amounts are all made up; see scripts/fixtures/receipt-emails/holdout18.mjs for the full emails).
//   node scripts/test-receipt-real-17.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { cleanItems, cleanItem } from "../worker/receipt-reader.js";
import { classifyEmail, mergeOrderEmails, attachReturnProgress } from "../worker/gmail.js";
import { categorise, agreedShopNames, agreedNameFor, shopDisplayName } from "../worker/receipt-category.js";
import { handleAuthRoute } from "../worker/auth.js";
import { rawEmail } from "./fixtures/receipt-emails/lib.mjs";
import holdout18 from "./fixtures/receipt-emails/holdout18.mjs";

const fx = Object.fromEntries(holdout18().map((f) => [f.id, f]));
const read = (id) => parseReceiptEmail(rawEmail(fx[id]));
const mk = (from, subject, body, { html = false, date = "Wed, 11 Nov 2026 10:00:00 +0000", to = "sam@example.com", extra = "" } = {}) =>
  `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nDate: ${date}\r\n${extra}MIME-Version: 1.0\r\nContent-Type: text/${html ? "html" : "plain"}; charset=utf-8\r\n\r\n${body}`;

// 1a. Pack sizes: "Pittas x6" is the pack, the quantity column is how many. Read right, and never undone by the receipts list.
{
  const r = read("holdout18-grocer-pack-size-qty-column");
  assert.deepEqual(r.items.map((i) => [i.name, i.qty]), [["Greenleaf Wholemeal Pittas x6", 1], ["Greenleaf Free Range Eggs Medium x12", 2], ["Greenleaf Kitchen Towels x4", 1], ["Greenleaf Red Onions x3", 3]]);
  // What was read and saved keeps its name when tidied again for the list (round 16 cut "x6" off and made it the quantity).
  const saved = JSON.parse(JSON.stringify(r.items));
  assert.deepEqual(cleanItems(saved, { stored: true }).map((i) => [i.name, i.qty]), r.items.map((i) => [i.name, i.qty]));
  // (A name read for the first time still gives up a quantity run into it: "Bamboo Socks x2" with no quantity of its own.)
  assert.deepEqual([cleanItem({ name: "Bamboo Socks x2", qty: 1 }).name, cleanItem({ name: "Bamboo Socks x2", qty: 1 }).qty], ["Bamboo Socks", 2]);
  console.log("ok - pack sizes stay in the name; the quantity is the quantity column, as read and as listed");
}

// The receipts list itself (real SQLite): a saved supermarket receipt shows "x6" and "x12" in the names, the quantities saved.
const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
  async all() { return { results: sqlite.prepare(sql).all(...args) }; }, _exec() { sqlite.prepare(sql).run(...args); } });
const env = { RELAY_DB: { prepare: (sql) => stmt(sql), async batch(l) { l.forEach((s) => s._exec()); return []; } }, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key" };
let sent = [];
const fetchImpl = async (url, init = {}) => { if (String(url).includes("resend")) { sent.push(JSON.parse(init.body)); return new Response("{}"); } return new Response("{}", { status: 404 }); };
const call = (path, { method = "GET", body, token } = {}) => handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "7.7.7.7", ...(token ? { authorization: "Bearer " + token } : {}) },
  body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: Date.UTC(2026, 10, 20, 9), fetchImpl });
await call("/relay/auth/request", { method: "POST", body: { email: "sam@example.com" } });
const token = (await (await call("/relay/auth/verify", { method: "POST", body: { token: /#signin=([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1] } })).json()).sessionToken;
const shopper = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("sam@example.com").id;
await call("/relay/my/receipts", { token });
let n = 0;
const save = (details, at = 1) => sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)")
  .run(`00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, shopper, "m-" + n, "pending", JSON.stringify({ kind: "receipt", currency: "GBP", confidence: "medium", ...details }), at);
const listed = async () => (await (await call("/relay/my/receipts?all=1", { token })).json()).receipts;
{
  const r = read("holdout18-grocer-pack-size-qty-column");
  save({ retailer: r.retailer, orderRef: r.orderRef, orderDate: r.orderDate, totalPence: r.totalPence, items: r.items, parserVersion: 52 });
  const c = (await listed()).find((x) => x.orderRef === "4410293387");
  assert.deepEqual(c.items.map((i) => [i.name, i.qty]), [["Greenleaf Wholemeal Pittas x6", 1], ["Greenleaf Free Range Eggs Medium x12", 2], ["Greenleaf Kitchen Towels x4", 1], ["Greenleaf Red Onions x3", 3]]);
  console.log("ok - the receipts list shows the saved pack sizes in the names and the saved quantities");
}

// 1b. A rail ticket change: its transaction number a cell or two under its label is the order's number, with no junk items.
{
  const r = read("holdout18-rail-change-transaction-cell");
  assert.equal(r.orderRef, "731204558812");
  assert.deepEqual(r.items.map((i) => [i.name, i.pricePence]), [["Oakford Parkway to Marston Central", 245], ["Admin Fee", 750]]);
  console.log("ok - a rail ticket change keeps its transaction number");
}

// 1c. A total the email states as £0.00 is £0.00; only a total the email doesn't make known is blank.
{
  const film = read("holdout18-film-gift-certificate-text");
  assert.deepEqual([film.totalPence, film.giftCardPence, film.items.map((i) => [i.name, i.pricePence])], [599, 599, [["The Harbour at Dusk", 599]]], "paid by gift certificate: what it cost, the gift certificate beside it");
  // Paid in full by credit: £0.00, the credit shown.
  const credit = parseReceiptEmail(mk("Dinedash <noreply@dinedash.example>", "Your order's in the kitchen", "Here's your receipt\nOrder ID #6120\n1x Halloumi Wrap - £7.50\nSubtotal £7.50\nCredit -£7.50\nTotal £0.00\n"));
  assert.equal(credit.totalPence, 0, "a takeaway paid by credit is £0.00");
  assert.ok((credit.discounts || []).some((d) => d.pence === 750), "with the credit shown");
  // Amazon's "Total £0.00" under a priced item, with nothing saying what paid for it: unknown, never £0.00.
  const unknown = parseReceiptEmail(mk('"Amazon.co.uk" <auto-confirm@amazon.co.uk>', "Ordered: 'Garden Kneeler Pad'",
    "<html><body><table><tr><td>Order #</td><td>202-1111111-3333333</td></tr><tr><td>Garden Kneeler Pad</td></tr><tr><td>Sold by Kneelwell</td></tr><tr><td>Quantity: 1</td></tr><tr><td>£ 9 59</td></tr><tr><td>Total</td><td>£0.00</td></tr></table></body></html>", { html: true }));
  assert.equal(unknown.totalPence, null, "the email doesn't say what was paid");
  console.log("ok - £0.00 when the email says so (with the credit or gift card); blank only when the email doesn't say");
}

// 1d. An order's day is the day it was placed: a re-sent confirmation that leads never moves it to its own later day.
{
  const shop = { name: "Cloudpuff", domain: "cloudpuff.example" };
  const its = [{ name: "Pen - Mango", qty: 2, pricePence: 600, lineTotal: true }];
  const emails = [
    { id: "a", createdAt: 1, kind: "receipt", retailer: shop, orderRef: "41207", orderDate: "2026-09-01", orderDateFrom: "email", totalPence: 600, items: its },
    { id: "b", createdAt: 2, kind: "receipt", retailer: shop, orderRef: "41207", orderDate: "2026-09-05", orderDateFrom: "email", totalPence: 600, items: its, hasImage: true, status: "confirmed", itemsCheck: { complete: true } }];
  const [card] = mergeOrderEmails(emails);
  assert.equal(card.orderDate, "2026-09-01", "the first email's day");
  // A day the leading email states itself is kept.
  const [kept] = mergeOrderEmails([{ ...emails[0] }, { ...emails[1], orderDate: "2026-08-31", orderDateFrom: null }]);
  assert.equal(kept.orderDate, "2026-08-31");
  console.log("ok - joined order emails keep the day the order was placed");
}

// 1e. A jeweller's "Ordered Items": the item is the thing under it, never "Order Date", and no delivery-time line priced.
{
  const r = read("holdout18-jeweller-ordered-items");
  assert.deepEqual(r.items.map((i) => [i.name, i.pricePence]), [["Lumen bracelet, Silver tone", 8900]]);
  console.log("ok - 'Ordered Items' starts the items");
}

// 2. False information.
{
  // Google Play's text part sent "format=flowed" (a space at each wrapped line's end): the 14-day right of withdrawal, the
  // way to cancel, and never the two-hour rule for apps on a subscription.
  const flowed = ["Thank you.", "Your subscription from Example Commerce Limited on Google Play continues and you've been charged.", "Order number: GPA.0000-1111-2222-33334..2",
    "Monthly Subscription - Next payment automatically charged on 13 Dec 2026", "Total: £4.99/month", "",
    "Under the law, you have an automatic statutory right of withdrawal from  ", "contracts for the purchase of digital services for 14 days after you make  ",
    "the purchase. Use this form to withdraw. After the first 14 days you will  ", "not be eligible for a refund. However, you can cancel your subscription, and  ",
    "the cancellation will be effective from the start of the next payment period.", "After purchasing an app or game on Google Play, you can return it within  ",
    "two hours for a full refund. This does not apply for in-app purchases or in-app subscriptions."].join("\n");
  const gp = parseReceiptEmail(mk("Google Play <googleplay-noreply@google.com>", "Your Google Play Order Receipt from 13-Nov-2026", flowed));
  assert.equal(gp.returns.windowDays, 14); assert.equal(gp.returns.cancelWithin, true);
  assert.ok(!gp.returns.instructions.some((x) => /two hours/i.test(x)), "no two-hour app rule on a subscription");
  // A link written without quotes is still the refund link.
  const link = parseReceiptEmail(mk("Google Play <googleplay-noreply@google.com>", "Your Google Play Order Receipt from 13-Nov-2026",
    "<html><body><p>Order number: GPA.0000-1111-2222-33334..2</p><p>Monthly Subscription</p><p>Total: £4.99/month</p><p>If your purchase doesn't work, you can <a href=https://play.example.com/refund-request>request a refund on the Google Play website.</a></p></body></html>", { html: true }));
  assert.equal(link.returns.portalUrl, "https://play.example.com/refund-request");
  // A rail booking where only one ticket says "No refunds": that ticket is named, the booking isn't marked non-refundable.
  const rail = parseReceiptEmail(mk("Railwise <auto-confirm@info.railwise.example>", "Your booking confirmation for Oakford to Marston (20 November, 18:20)",
    ["Your trip to Marston Central departing Friday, 20 November 2026 is confirmed", "18:20 Oakford Parkway", "19:22 Marston Central", "1x Advance Single", "Specified train only. No refunds.",
      "1x Off-Peak Day Single", "Any off-peak train.", "1x Adult", "Transaction ID: 731299900011", "Total amount: £24.55"].join("\n")));
  assert.notEqual(rail.returns && rail.returns.nonRefundable, true);
  assert.ok(rail.returns.instructions.some((x) => /^Advance Single: Specified train only\. No refunds\.$/.test(x)));
  // A pub group's address sends for its different pubs: each receipt keeps its own pub.
  const pubs = [{ retailer: { name: "The Swan", domain: "info.innsgroup.example" } }, { retailer: { name: "The Swan", domain: "info.innsgroup.example" } }, { retailer: { name: "The Horniman at Hays", domain: "info.innsgroup.example" } }];
  const agreed = agreedShopNames(pubs);
  assert.equal(agreedNameFor(agreed, pubs[2].retailer, "info.innsgroup.example"), "The Horniman at Hays");
  const same = [{ retailer: { name: "Glintwell", domain: "glintwell.example" } }, { retailer: { name: "Glintwell Customer Service GB", domain: "glintwell.example" } }];
  assert.equal(agreedNameFor(agreedShopNames(same), same[1].retailer, "glintwell.example"), "Glintwell", "one shop written two ways still agrees");
  // CeX sends from its web address.
  assert.equal(shopDisplayName({ name: null, domain: "webuy.com" }), "CeX");
  // A membership bought from a ride app is a subscription, not travel.
  assert.equal(categorise({ retailer: { name: "Uber", domain: "uber.com" }, items: [{ name: "Uber One membership", qty: 1, pricePence: 499 }] }).category, "digital");
  // A fee the items already hold is counted once; VAT added on top of prices before it is kept as a line.
  const fees = parseReceiptEmail(mk("Ticketbox <noreply@ticketbox.example>", "Your tickets - order 5512090",
    "<html><body><table><tr><td>Order number: 5512090</td></tr><tr><td>Seats, Full Price Ticket</td><td>2 × £ 30.00</td><td>£ 60.00</td></tr><tr><td>Booking fee</td><td>2 × £ 3.75</td><td>£ 7.50</td></tr><tr><td>Subtotal</td><td>£ 67.50</td></tr><tr><td>Total incl. VAT</td><td>£ 67.50</td></tr></table></body></html>", { html: true }));
  const fee = (fees.fees || []).reduce((a, f) => a + f.pence, 0), itemFees = fees.items.filter((i) => /booking fee/i.test(i.name)).length;
  assert.ok(!(fee && itemFees), "the booking fee is an item line or a fee, never both: " + JSON.stringify([fees.items, fees.fees]));
  const vat = parseReceiptEmail(mk("Lockbox <support@lockbox.example>", "Your payment confirmation and receipt", "Thanks for your purchase!\n\nItem\n\nPrice\n\nPlus: 1-month subscription\n\n£10.99/month\n\n VAT 20% - £2.20\n\nTotal: *£13.19/month*\n\nPayment method: AMEX ****0000\n\nOrder date: Nov 11, 2026 03:31:14 PM UTC\n"));
  assert.deepEqual([vat.totalPence, (vat.fees || []).map((f) => [f.label, f.pence])], [1319, [["VAT", 220]]]);
  // A dish's pieces are its size, not how many were ordered.
  assert.deepEqual(read("holdout18-takeaway-pieces").items.map((i) => [i.name, i.qty]), [["Crispy Wings Box", 1], ["Halloumi Wrap", 1]]);
  console.log("ok - no two-hour app rule on a subscription, a refund link without quotes, which rail ticket can't be refunded, each pub's own name, CeX, a membership, fees once, VAT kept, a dish's pieces");
}

// 3. Missing details.
{
  assert.equal(parseReceiptEmail(mk("Bargainly <orders@r.bargainly.example>", "Purchase Confirmed: Thank you for your purchase!",
    "Order summary:\nThank you for your order (# 1200-111222-333444 ), placed on 12 November 2026.\nDescription Quantity Price\nOak Bedside Table\n1\n£89.99\nSubtotal: £89.99\nTotal: £89.99\n")).orderRef, "1200-111222-333444");
  assert.equal(parseReceiptEmail(mk("Magpress Magazines <noreply@webstore.magpress.example>", "Thank you for your order",
    "Recipient Customer Number: 040000000001\nOrder Reference Number: 70011223\nGardening Monthly Box\n£30.00\nTotal: £30.00\n")).orderRef, "70011223");
  // A booking forwarded from the shopper's own other mailbox (its "name" only the address again) is still theirs.
  const fwd = classifyEmail(mk("Sam Taylor <sam.taylor@hotmail.example>", "Fwd: Booking details | Departure: 14 December 2026 | LHR-WDH",
    ["---------- Forwarded message ---------", "From: Skyline Airways <online@booking.skyline.example>", "Date: Wed, 11 Nov 2026 at 09:12", "Subject: Booking details | Departure: 14 December 2026 | LHR-WDH",
      "To: <sam.taylor@hotmail.example>", "", "Skyline booking code: QWERTZ", "Total Price of your Ticket", "Passenger Type", "Price", "Taxes, fees & surcharges", "Passengers", "Total Price of your Ticket",
      "Adult", "GBP 771.00", "GBP 430.72", "1", "GBP 1201.72", "Total Price for all Passengers", "GBP 1201.72"].join("\n"), { to: '"sam.taylor@gmail.com" <sam.taylor@gmail.com>' })).details;
  assert.equal(fwd.kind, "receipt", "the shopper's own forward is a purchase");
  // A payment service's "Description | Unit price | Qty | Amount" table.
  assert.deepEqual(read("holdout18-payment-service-description-table").items.map((i) => [i.name, i.qty, i.pricePence]), [["6 Month Print Subscription (United Kingdom)", 1, 6500]]);
  // The older marketplace layout: each price under "Fulfilled by…" and "Gift wrap: No", and no gift-wrap fee.
  const mp = read("holdout18-marketplace-fulfilled-gift-wrap");
  assert.deepEqual([mp.items.map((i) => i.pricePence), (mp.fees || []).length], [[799, 1499], 0]);
  // A second refund email with no amount keeps the amount the first gave.
  const order = { orderRef: "731200000099", retailer: { name: "Railwise", domain: "railwise.example" }, totalPence: 1594, orderDate: "2026-05-31", items: [] };
  attachReturnProgress([order], [], [{ stage: "refunded", orderRef: "731200000099", at: "2026-06-06", amountPence: 1535, currency: "GBP", retailer: order.retailer },
    { stage: "refunded", orderRef: "731200000099", at: "2026-06-07", amountPence: null, currency: null, retailer: order.retailer }]);
  assert.deepEqual([order.returnProgress.refundedAt, order.returnProgress.refundPence], ["2026-06-07", 1535]);
  console.log("ok - order numbers in brackets and on labelled lines, an own forward, a payment service's table, prices under seller notes, a refund's amount kept");
}

// Every new pattern stays quick on a 40,000-character line.
{
  const long = (s) => s.repeat(Math.ceil(40000 / s.length)).slice(0, 40000);
  for (const body of [long(" "), long("£1,"), long("x "), long("Transaction ID: \n"), long("Gift Certificate/Card Amount "), long("1x Advance Single "), long("Sold by :"), long("a £1.00 ")]) {
    const t = Date.now();
    parseReceiptEmail(mk("Shop <orders@shop.example>", "Your order", "Order number: 1234567\n" + body + "\nTotal: £5.00\n"));
    cleanItem({ name: body.slice(0, 40000), qty: 1 });
    // (A line of 40,000 spaces takes about two seconds on main already, in older tidying code; a pattern that tried every
    // position against every other would take minutes.)
    assert.ok(Date.now() - t < 10000, "slow on a long line: " + JSON.stringify(body.slice(0, 20)));
  }
  console.log("ok - quick on 40,000-character lines");
}
console.log("PASS round 17: pack sizes, rail transaction numbers, £0.00 totals, joined orders' days, false details and missing details");
