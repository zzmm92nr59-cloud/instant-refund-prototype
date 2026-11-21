// Round 22 (21 Nov 2026): a check of a real inbox, July to December 2024, after round 21b. False information first. Every email
// here is MADE UP (scripts/fixtures/receipt-emails/holdout23.mjs): shops, games, restaurants, events, airlines, items, prices,
// people and numbers.
//  1. A jeweller's cancellation whose text part leaves out the order number its HTML gives: still the order's cancellation,
//     so the order shows as cancelled, not as money still spent.
//  2. "Congrats! You've saved at least £21.50" at the top of an order is neither a thing bought nor money off; the things
//     under it are read, each by its own name (its brand over it goes with its details).
//  3. A game's coins counted short ("2.5K") stay in the pack; a takeaway app's payment receipt shows the restaurant its
//     "Your order #… was accepted" email names.
//  4. Totals the email states: over three lines ("Total ( 1 item" / ")" / "£16.20"), after two brackets ("Total (incl.
//     GST): (incl. VAT):"), and one line's price, "×2 |" "£24.00", the only amount.
//  5. References: "Order Receipt for QX7R2M4P"; "Booking reference number: KD4M2XQ"; one ticket's "TICKET CODE".
//  6. "A refund of £7.5" is £7.50; "You have 28 days to return any unwanted items to us" is a 28-day window.
//  7. Purchases that were missed: "We're pleased to confirm your … order", an airline's "Your e-ticket receipt …" (its taxes
//     listed per adult are inside the fare, never fees on top), PayPal's "Receipt from … for your £8.40 GBP purchase".
//  8. The new patterns take linear time on a 40,000-character line and a line of 40,000 spaces.
//   node scripts/test-receipt-real-23.mjs
import assert from "node:assert/strict";
import { parseReceiptEmail, parseReturnUpdateEmail } from "../worker/receipt-parser.js";
import { classifyEmail, mergeOrderEmails, attachCancellations, attachAccepted } from "../worker/gmail.js";
import { readItems } from "../worker/receipt-items.js";
import { flightLegs } from "../worker/flight-booking.js";
import { rawEmail, fixture } from "./fixtures/receipt-emails/lib.mjs";
import { JEWELLER, OUTLET, GAME, TAKEAWAY, MARKET, FAIR, BOAT, CINEMA, TICKET, REFUND, RETURNS, VOLTA, AIRLINE, PAYPAL_SHOP } from "./fixtures/receipt-emails/holdout23.mjs";

const raw = (m, id = "x") => rawEmail(fixture(id, "", "", m, {}));
const read = (m, id) => ({ ...classifyEmail(raw(m, id)).details, id, createdAt: 0 });

// 1. The cancellation names the order only in its HTML.
{
  const o = read(JEWELLER.order, "j1"), c = read(JEWELLER.cancelled, "j2");
  assert.equal(o.kind, "receipt");
  assert.equal(c.kind, "order_update", "a cancellation, never 'not a receipt': " + JSON.stringify(c));
  assert.equal(c.stage, "cancelled");
  assert.equal(c.orderRef, "SLX4400917", "the number its HTML gives");
  const cards = mergeOrderEmails([o]);
  attachCancellations(cards, [c]);
  assert.ok(cards[0].cancelled && cards[0].cancelled.partial === false, "the whole order shows as cancelled: " + JSON.stringify(cards[0].cancelled));
  console.log("ok - a cancellation whose order number is only in its HTML cancels that order");
}

// 2. A savings banner is never an item or money off.
{
  const d = read(OUTLET, "o1");
  assert.equal(d.kind, "receipt");
  assert.deepEqual(d.items.map((i) => [i.name, i.qty, i.pricePence]), [["Tan Leather Weekend Holdall", 1, 3499], ["Grey Marl Merino Crew Jumper", 1, 1999]]);
  assert.ok(!d.items.some((i) => /saved/i.test(i.name)), "never the banner as a thing bought");
  assert.ok(!(d.discounts || []).length, "what it would have cost is no money off: " + JSON.stringify(d.discounts));
  assert.equal(d.totalPence, 5897);
  assert.ok(/Harbour & Hide/.test(d.items[0].variant || ""), "the brand goes with its details");
  // (The banner alone, read by the item reader: nothing.)
  assert.deepEqual(readItems("Here are your order details\nCongrats! You've saved at least £21.50\n-45%\nOrder number\n55120934"), []);
  // (A thing named over its price, with no size, keeps its name.)
  const plain = readItems("Order summary\nWool Scarf\nColour: Red\n£12.00\nQty: 1\nSubtotal\n£12.00");
  assert.equal(plain[0] && plain[0].name, "Wool Scarf");
  console.log("ok - 'Congrats! You've saved at least £…' is neither an item nor a discount; the things under it are read");
}

// 3. A game's coins counted short; a takeaway's restaurant from its "accepted" email.
{
  const g = read(GAME, "g1");
  assert.equal(g.retailer.name, "Tile Quest", "the game, not the payment company");
  assert.deepEqual(g.items.map((i) => i.name), ["Rocket Pack", "10 Lives", "2.5K Coins"]);
  assert.equal(g.totalPence, 499);
  const r0 = read(TAKEAWAY.receipt, "t1"), r = structuredClone(r0), a = read(TAKEAWAY.accepted, "t2");
  assert.equal(a.kind, "order_update");
  assert.equal(a.stage, "accepted");
  assert.equal(a.merchant, "Lagoon Grill");
  const cards = mergeOrderEmails([r]);
  attachAccepted(cards, [a]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].merchant, "Lagoon Grill", "the receipt shows the restaurant");
  assert.equal(cards[0].totalPence, 1840);
  // (Never an "accepted" email from another business, or hours away.)
  const other = { ...a, retailer: { name: "Elsewhere", domain: "updates.elsewhere.example" } }, late = { ...a, sentAt: "2024-11-09T09:00:00.000Z" };
  for (const u of [other, late]) { const c2 = mergeOrderEmails([structuredClone(r0)]); attachAccepted(c2, [u]); assert.equal(c2[0].merchant, undefined, JSON.stringify(u.retailer)); }
  // (Its cancellation-like news is never read as a cancellation.)
  const c3 = mergeOrderEmails([structuredClone(r0)]); attachCancellations(c3, []); attachAccepted(c3, [a]); assert.equal(c3[0].cancelled, undefined);
  console.log("ok - '2.5K Coins' stays in the pack; a takeaway's receipt shows the restaurant its 'accepted' email names");
}

// 4. Totals the email states.
{
  const m = read(MARKET, "m1");
  assert.equal(m.kind, "receipt");
  assert.equal(m.totalPence, 1620, "'Total ( 1 item' / ')' / '£16.20'");
  assert.equal(m.items[0].name, "Speckled Stoneware Mug (300ml) Handmade Coffee Cup", "never its transaction number in its name");
  const c = read(CINEMA, "c1");
  assert.equal(c.kind, "receipt");
  assert.equal(c.totalPence, 2990, "'Total (incl. GST): (incl. VAT):' over '£29.90'");
  const f = read(FAIR, "f1");
  assert.equal(f.totalPence, 2400, "the one line's price, the only amount");
  assert.deepEqual(f.items.map((i) => [i.qty, i.pricePence]), [[2, 2400]]);
  // (Not when two prices are written, or one price for one of several.)
  const two = read({ ...FAIR, html: FAIR.html.replace("Important Information:", "Parking: £5.00") }, "f2");
  assert.equal(two.totalPence, null, "two amounts: no total made up");
  console.log("ok - totals over three lines, after two brackets, and one line's only price are read");
}

// 5. References.
{
  assert.equal(read(BOAT, "b1").orderRef, "QX7R2M4P");
  assert.equal(read(CINEMA, "c2").orderRef, "KD4M2XQ");
  assert.equal(read(TICKET, "k1").orderRef, "Ab3dE9x");
  // (Two tickets, two codes: neither is the order's.)
  const two = read({ ...TICKET, html: TICKET.html.replace("Ticket type", "TICKET CODE\nZz9yX8w\nTicket type") }, "k2");
  assert.equal(two.orderRef, null);
  // (A subject in words is no code.)
  const words = parseReceiptEmail(raw({ ...BOAT, subject: "Order Receipt for SATURDAY" }));
  assert.ok(!words.ok || words.orderRef !== "SATURDAY");
  console.log("ok - a code in the subject, a booking reference number and one ticket's code are the order's reference");
}

// 6. A refund in one figure of pence; a return window in "You have 28 days".
{
  const r = parseReturnUpdateEmail(raw(REFUND));
  assert.equal(r.stage, "refunded");
  assert.equal(r.amountPence, 750, "£7.5 is £7.50: " + JSON.stringify(r));
  const w = read(RETURNS, "w1");
  assert.equal(w.returns && w.returns.windowDays, 28);
  assert.equal(w.returns.deadline, null, "no day is made up for it");
  console.log("ok - 'A refund of £7.5' is £7.50; 'You have 28 days to return' is the window");
}

// 7. Purchases that were missed.
{
  const v = read(VOLTA, "v1");
  assert.equal(v.kind, "receipt");
  assert.equal(v.totalPence, 14999);
  assert.equal(v.orderRef, "VLT2290117");
  const a = read(AIRLINE, "a1");
  assert.equal(a.kind, "receipt");
  assert.equal(a.totalPence, 41260);
  assert.equal(a.orderRef, "QPLM4R");
  assert.deepEqual((a.flights || []).map((g) => g.from + "-" + g.to), ["LHR-JFK", "JFK-LHR"]);
  assert.ok(!(a.fees || []).length, "taxes per adult inside the fare are no fees on top: " + JSON.stringify(a.fees));
  assert.ok(!a.items.some((i) => /duty|fee|charge/i.test(i.name)), "never a tax as a thing bought");
  const p = read(PAYPAL_SHOP, "p1");
  assert.equal(p.kind, "receipt");
  assert.equal(p.retailer.name, "Burger Barn", "the shop, without its till's number");
  assert.equal(p.totalPence, 840);
  // (An airline's HTML: the flight number alone on its line, each end's day, time and airport on lines of their own.)
  const legs = flightLegs(["SK0211 |", "Skyline Airways |", "Economy |", "12 Jun 2025 |", "09:40 |", "Heathrow (London) |", "Terminal 2 |", "12 Jun 2025 |", "12:55 |", "John F Kennedy (NY) (New York) |", "Terminal 4 |"].join("\n"), new Date("2024-12-22"));
  assert.deepEqual(legs.map((g) => [g.from, g.to, g.flight, g.date]), [["LHR", "JFK", "SK0211", "2025-06-12"]]);
  console.log("ok - 'pleased to confirm your … order', an airline's e-ticket receipt and PayPal's shop receipt are purchases");
}

// 8. Linear time.
{
  const long = "a".repeat(40000), spaces = " ".repeat(40000);
  for (const filler of [long, spaces]) {
    const t0 = Date.now();
    for (const m of [OUTLET, MARKET, CINEMA, TICKET, PAYPAL_SHOP, AIRLINE, TAKEAWAY.accepted, JEWELLER.cancelled]) {
      const big = { ...m, ...(m.html ? { html: m.html.replace("</body>", `<p>${filler}</p><p>Total (${filler}</p><p>TICKET CODE ${filler}</p><p>You have ${filler}</p></body>`) } : {}),
        ...(m.text ? { text: m.text + "\n" + filler + "\nTotal payment to seller" + filler + "\nCongrats! " + filler } : {}), subject: m.subject + filler.slice(0, 2000) };
      classifyEmail(raw(big));
    }
    readItems("Congrats! You've saved at least" + filler + "£1.00\n" + filler);
    flightLegs("BA0177\n" + filler + "\n13:20\n" + filler, new Date());
    const ms = Date.now() - t0;
    assert.ok(ms < 8000, "took " + ms + "ms");
  }
  console.log("ok - the new patterns take linear time on a 40,000-character line and a line of 40,000 spaces");
}
console.log("all round 22 checks passed");
