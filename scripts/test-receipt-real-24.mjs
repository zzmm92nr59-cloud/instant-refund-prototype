// Round 23 (21 Nov 2026): a check of a real inbox, January to August 2026, after round 22. False information first. Every
// email here is MADE UP (scripts/fixtures/receipt-emails/holdout24.mjs): shops, games, apps, hotels, airlines, items, prices,
// people and numbers.
//  1. The payment company is never the shop: PayPal's receipt for a payment to Appcharge, sent with the game's own receipt,
//     is one card named by the game; alone, it keeps PayPal's transaction ID as its reference. A game's receipt whose text
//     runs its headings together is still the game's, never "Items". A maker's receipt sent by its reseller, "PhotoTidy (via
//     Paddle.com)", is the maker's, with the thing it sold.
//  2. An airline's stated terms, "cancel … and claim a refund without penalty, up to 24 hours from when you made the original
//     booking": that window, in hours, from the booking, and the email's words; never a return window that was not stated.
//  3. A festival's tickets joined with PayPal's receipt of the order: the booking fee, the discount and the tax PayPal states
//     are shown, so the card adds up to what was paid.
//  4. "Shipping: £4.95 via Next Day" is the delivery charge.
//  5. Booking.com's "You don't need to prepay": nothing taken up front, and the hotel is the business.
//  6. A holiday company's own "We've got your payment" is one payment towards its booking; a Spanish receipt ("Gracias por su
//     compra", "$ 150.00 MXN") is read.
//  7. PayPal's "You've authorised £12.40 GBP to UBER PAYMENTS UK LIM..." never becomes a receipt, and is never put on a ride
//     whose money it isn't.
//  8. The new patterns take linear time on a 40,000-character line and a line of 40,000 spaces.
//   node scripts/test-receipt-real-24.mjs
import assert from "node:assert/strict";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { classifyEmail, mergeOrderEmails, attachCancellations } from "../worker/gmail.js";
import { moneyOf } from "../worker/receipt-items.js";
import { gameTitle } from "../worker/receipt-reader.js";
import { rawEmail, fixture } from "./fixtures/receipt-emails/lib.mjs";
import { GAME_PAYPAL, GAME_TEXT, RESELLER, ETICKET, FESTIVAL, SHIPPED_VIA, PAY_AT_HOTEL, INSTALMENT, WIFI, RIDE_AUTH } from "./fixtures/receipt-emails/holdout24.mjs";

const raw = (m, id = "x") => rawEmail(fixture(id, "", "", m, {}));
const read = (m, id) => ({ ...classifyEmail(raw(m, id), { gmailId: id }).details, id, createdAt: 0 });

// 1. The payment company is never the shop.
{
  const p = read(GAME_PAYPAL.paypal, "p1"), s = read(GAME_PAYPAL.shop, "s1");
  assert.equal(p.kind, "receipt");
  assert.equal(p.orderRef, "1AB23456CD7890123", "PayPal's transaction ID is the reference of its receipt alone: " + p.orderRef);
  assert.equal(s.retailer.name, "Puzzle Pals", "the game's own receipt names the game");
  const cards = mergeOrderEmails([structuredClone(s), structuredClone(p)]);
  assert.equal(cards.length, 1, "one purchase, one card");
  assert.equal(cards[0].retailer.name, "Puzzle Pals", "the game is the shop, the payment company only how it was paid: " + cards[0].retailer.name);
  assert.equal(cards[0].totalPence, 649);
  const t = read(GAME_TEXT, "g2");
  assert.equal(t.retailer.name, "Puzzle Pals", "a heading run into the text, 'Items', is never the game: " + t.retailer.name);
  assert.equal(gameTitle("Items\nCoins 1,200", "Your TILE QUEST-BRIGHTPLAY receipt #410-552-903"), "Tile Quest");
  const r = read(RESELLER, "r1");
  assert.equal(r.retailer.name, "PhotoTidy", "the maker, not its reseller: " + JSON.stringify(r.retailer));
  assert.deepEqual(r.items.map((i) => [i.name, i.qty, i.pricePence]), [["PhotoTidy Pro Subscription - 2 devices", 1, 2499]]);
  assert.ok((r.fees || []).some((f) => /vat/i.test(f.label) && f.pence === 500), "the VAT as its own line: " + JSON.stringify(r.fees));
  assert.equal(r.itemsCheck.complete, true);
  // (A name in brackets that isn't the sending address's own is not a reseller's: the sender's name stays as it was read.)
  const odd = read({ ...RESELLER, from: '"PhotoTidy (via Example Store)" <help@paddle.com>' }, "r2");
  assert.notEqual(odd.retailer.name, "PhotoTidy");
  console.log("ok - the game or the maker is the shop, never the payment company or reseller; PayPal's transaction ID kept");
}

// 2. Stated cancellation terms, in hours from the booking.
{
  const d = read(ETICKET, "e1");
  assert.equal(d.kind, "receipt");
  assert.ok(d.returns, "the terms are kept");
  assert.equal(d.returns.windowHours, 24);
  assert.equal(d.returns.windowFrom, "order", "counted from when it was booked");
  assert.equal(d.returns.cancelWithin, true, "a cancellation, never a parcel to send back");
  assert.equal(d.returns.windowDays, null, "no window in days is made up");
  assert.equal(d.returns.deadline, null, "no deadline guessed");
  assert.ok(/24 hours from when you made the original booking/.test(d.returns.instructions[0] || ""), "the email's own words");
  // (Check-in opening 24 hours before a flight is no cancellation window.)
  const other = read({ ...ETICKET, text: ETICKET.text.replace(/Please check[^\n]*\n/, "Online check-in opens 24 hours before your flight departs.\n") }, "e2");
  assert.ok(!other.returns || other.returns.windowHours == null, JSON.stringify(other.returns));
  console.log("ok - 'cancel … for a refund … up to 24 hours from when you made the original booking' is a stated 24-hour window");
}

// 3. A festival's tickets with the money PayPal sets out.
{
  const s = read(FESTIVAL.shop, "f1"), p = read(FESTIVAL.paypal, "f2");
  assert.equal(s.items.length, 4);
  assert.ok((p.fees || []).some((f) => f.label === "Tax" && f.pence === 1740), "PayPal's tax is a line of its own: " + JSON.stringify(p.fees));
  assert.equal(p.itemsCheck.complete, true, "PayPal's own receipt adds up");
  for (const order of [[s, p], [p, s]]) {
    const cards = mergeOrderEmails(order.map((x) => structuredClone(x)));
    assert.equal(cards.length, 1);
    const c = cards[0];
    assert.equal(c.retailer.name, "Riverside Cider Festival");
    assert.equal(c.orderRef, "220411", "the shop's own order number");
    assert.equal(c.totalPence, 10440);
    assert.deepEqual(c.items.map((i) => [i.name, i.pricePence]), Array(4).fill(["Day Ticket General Sale", 2500]), "the shop's names at PayPal's price before tax");
    assert.ok((c.fees || []).some((f) => /booking fee/i.test(f.label) && f.pence === 1200), JSON.stringify(c.fees));
    assert.ok((c.fees || []).some((f) => f.label === "Tax" && f.pence === 1740), JSON.stringify(c.fees));
    assert.ok((c.discounts || []).some((x) => x.pence === 2500), JSON.stringify(c.discounts));
    const sum = c.items.reduce((n, i) => n + i.pricePence, 0) + c.fees.reduce((n, f) => n + f.pence, 0) - c.discounts.reduce((n, x) => n + x.pence, 0);
    assert.equal(sum, c.totalPence, "the card adds up");
    assert.equal(c.itemsCheck.complete, true);
  }
  console.log("ok - a festival's tickets joined with PayPal's receipt show its booking fee, discount and tax, and add up");
}

// 4. Delivery written with how it was sent.
{
  const d = read(SHIPPED_VIA, "w1");
  assert.deepEqual(d.items.map((i) => [i.name, i.pricePence]), [["Rope Slip Lead - Forest Green, 1.5m", 1850]]);
  assert.deepEqual(d.fees, [{ label: "Shipping", pence: 495 }]);
  assert.equal(d.totalPence, 2345);
  assert.equal(moneyOf("Shipping: | £4.95 via Next Day").fees, 495);
  console.log("ok - 'Shipping: £4.95 via Next Day' is the delivery charge");
}

// 5. Booking.com: nothing taken up front; the hotel is the business.
{
  const d = read(PAY_AT_HOTEL, "b1");
  assert.equal(d.kind, "receipt");
  assert.equal(d.payAtProperty, true, "'You don't need to prepay'");
  assert.equal(d.merchant, "Harbour View Hotel & Spa", "the hotel, as the subject names it");
  assert.equal(d.retailer.name, "Booking.com");
  const paid = read({ ...PAY_AT_HOTEL, html: PAY_AT_HOTEL.html.replace("You don't need to prepay. However, the property may take a deposit from the card you booked with.", "You've paid in full.").replace(/You will pay the hotel[^<]*/, "") }, "b2");
  assert.notEqual(paid.payAtProperty, true, "paid up front stays paid");
  console.log("ok - Booking.com's 'You don't need to prepay' is paid at the hotel, and the hotel is named");
}

// 6. A holiday's later payment, from the holiday company; a receipt in Spanish.
{
  const b = read(INSTALMENT.booking, "h1"), u = read(INSTALMENT.payment, "h2");
  assert.equal(b.kind, "receipt");
  assert.equal(u.kind, "order_update", "a payment towards the booking, never a purchase of its own: " + u.kind);
  assert.equal(u.stage, "payment");
  assert.equal(u.amountPence, 31225, "the payment taken the day it was sent");
  assert.equal(u.at, "2026-02-14");
  const cards = mergeOrderEmails([b]);
  attachCancellations(cards, [u]);
  assert.deepEqual(cards[0].payments, [{ at: "2026-02-14", amountPence: 31225, currency: "GBP" }]);
  const w = read(WIFI, "m1");
  assert.equal(w.kind, "receipt");
  assert.equal(w.currency, "MXN");
  assert.equal(w.totalPence, 15000);
  assert.equal(w.orderRef, "AB12345CD");
  assert.deepEqual(w.items.map((i) => i.name), ["Acceso por 2 horas"], "the thing bought, never the currency's code");
  console.log("ok - a holiday company's 'We've got your payment' joins its booking; a Spanish receipt in pesos is read");
}

// 7. An authorisation is never a receipt, and goes only with the ride whose money it is.
{
  const a = read(RIDE_AUTH, "u1");
  assert.notEqual(a.kind, "receipt", "an authorisation is no final charge");
  assert.ok(!parseReceiptEmail(raw(RIDE_AUTH)).ok || parseReceiptEmail(raw(RIDE_AUTH)).kind === "order_update");
  const ride = (id, pence, day) => ({ id, kind: "receipt", createdAt: 0, retailer: { name: "Uber Payments UK Limited", domain: "uber.com" }, orderDate: day, totalPence: pence, currency: "GBP", items: [{ name: "Ride", qty: 1, pricePence: pence }] });
  const pay = { kind: "order_update", stage: "payment", at: "2026-03-13", amountPence: 1240, currency: "GBP", retailer: { name: "UBER PAYMENTS UK LIM", domain: null, via: "paypal.co.uk" } };
  // (The ride of the same money that day: that ride, and no other.)
  const both = [ride("r1", 910, "2026-03-13"), ride("r2", 1240, "2026-03-13")];
  attachCancellations(both, [{ ...pay }]);
  assert.equal(both[0].payments, undefined, "never on a ride whose money it isn't");
  assert.deepEqual(both[1].payments, [{ at: "2026-03-13", amountPence: 1240, currency: "GBP" }]);
  // (Only a ride of other money: on none.)
  const other = [ride("r3", 910, "2026-03-12")];
  attachCancellations(other, [{ ...pay }]);
  assert.equal(other[0].payments, undefined);
  // (Never more than the whole order, whoever it is from.)
  const shop = [{ id: "s1", kind: "receipt", createdAt: 0, retailer: { name: "Example Outdoor Store", domain: "exampleoutdoor.example" }, orderDate: "2026-03-01", totalPence: 500, currency: "GBP", items: [] }];
  attachCancellations(shop, [{ ...pay, amountPence: 4000, retailer: { name: "Example Outdoor Store", domain: null, via: "paypal.co.uk" } }]);
  assert.equal(shop[0].payments, undefined);
  console.log("ok - a PayPal authorisation is never a receipt, and joins only the ride of the same money");
}

// 8. Linear time.
{
  const long = "a".repeat(40000), spaces = " ".repeat(40000);
  for (const body of [long, spaces, "Price: £ 1.00\n" + long, "Shipping: £1.00 via " + long, "you may cancel your booking and claim a refund " + spaces + " up to 24 hours from", "Gracias por su compra\nOrden: " + spaces]) {
    for (const m of [{ from: "Shop <a@shop.example>", subject: "Your order", date: "Mon, 01 Jun 2026 10:00:00 +0000", text: body },
      { from: '"X (via Paddle.com)" <help@paddle.com>', subject: "Your X receipt", date: "Mon, 01 Jun 2026 10:00:00 +0000", text: body },
      { from: "Booking.com <noreply@booking.com>", subject: "Thanks! Your booking is confirmed at " + "b".repeat(5000), date: "Mon, 01 Jun 2026 10:00:00 +0000", text: body },
      { from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to X", date: "Mon, 01 Jun 2026 10:00:00 +0000", text: "You paid £1.00 GBP to X\n" + body + "\nTransaction ID: " + spaces }]) {
      const t0 = Date.now();
      classifyEmail(raw(m));
      assert.ok(Date.now() - t0 < 3000, "took " + (Date.now() - t0) + "ms");
    }
  }
  const t1 = Date.now();
  moneyOf("Shipping: £1.00 via " + long); moneyOf("Shipping: £1.00 via " + spaces); gameTitle(long, "Your " + spaces + " receipt #1"); gameTitle(spaces, "Your " + long + " receipt");
  assert.ok(Date.now() - t1 < 1000);
  console.log("ok - the new patterns take linear time on long lines");
}
console.log("all round 23 reader checks passed");
