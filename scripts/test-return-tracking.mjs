// Offline test (real SQLite; Ship24 is a stand-in): return tracking (worker/return-tracking.js).
//  1. Carriers' and shops' return emails are read for what they say: a label made, the parcel dropped off or on its way
//     back, delivered to the shop; refunds and "we've received your return" still come from the shop's own emails.
//  2. Each email goes on the right receipt: the return's tracking number, else the same shop and order number, else the
//     same shop, amount and a date window, else the shop and window when exactly one of its orders has a return started.
//     Never on another shopper's receipt, and never a guess between two.
//  3. The shopper's "I've sent it back", with a tracking number if they have it; the carrier only from a format that's sure.
//  4. The states in order (started, sent, received, refunded), each with its day and who said so; nothing made up.
//  5. "Refund not seen yet" only 14 days after Relay really saw the shop receive it, and never once a refund is seen.
//  6. returnInTransit / returnReceived only on a carrier's or the shop's word, never the shopper's alone.
//  7. Ship24 for the return parcel: off until the key is set; only the tracking number; shares the 10-a-month allowance
//     and the 3-per-shopper limit with deliveries.
//  8. Own receipts only (404), the input rules (400), Download my data, and account deletion.
//  9. (24 Nov 2026) Only what an email says has happened counts: a label email's "once you've dropped it off", a reminder,
//     "we'll let you know when it's delivered" and "we'll process your refund" are not a drop-off, an arrival or a refund.
//     A shop's own return-label email with the parcel's tracking number starts the return on the order it names.
// 10. A step nobody told Relay about is never ticked, even when a later one is.
// 11. A refund seen in the shopper's own bank payments: only on a return already known, only when the bank's text names
//     the shop and the amount fits, never a guess between two, never enough to make returnReceived true.
// 12. onItsWay, the one fact a future instant refund asks for: who confirmed the parcel left the shopper, how, and the
//     carrier's first scan time; never the carrier's expected day, a label made, or the shopper's word.
// Shops, people, order and tracking numbers are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { parseReturnParcelEmail, parseReturnUpdateEmail, parseDeliveryEmail, returnCarrierOf } from "../worker/receipt-parser.js";
import { attachReturnTracking, guessCarrier, cleanTrackingNumber, cleanReturnSent, returnFacts, STEPS } from "../worker/return-tracking.js";
import { firstScan } from "../worker/parcel-tracking.js";
import { namesShop, ensureBankTables } from "../worker/bank.js";
import { classifyEmail } from "../worker/gmail.js";
import { liveParcel } from "../worker/parcel-tracking.js";
import { returnFactsFor } from "../worker/gmail.js";

const DAY = 864e5, NOW = Date.now(), TODAY = new Date(NOW).toISOString().slice(0, 10);
const ago = (n) => new Date(NOW - n * DAY).toISOString().slice(0, 10);
const rfc = (d) => new Date(d + "T10:00:00Z").toUTCString();
const mail = (from, subject, body, d = TODAY) => `From: ${from}\r\nTo: sam@example.com\r\nSubject: ${subject}\r\nDate: ${rfc(d)}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;

// ---- 1. Reading the emails ----
{
  assert.equal(returnCarrierOf("Royal Mail <no-reply@royalmail.com>"), "Royal Mail");
  assert.equal(returnCarrierOf("Evri <noreply@notifications.evri.com>"), "Evri");
  assert.equal(returnCarrierOf("\"Royal Mail\" <returns@kestrel-outdoor.example>"), null, "a shop can't pass for a carrier by its display name");
  const dropped = [
    ["Royal Mail <no-reply@royalmail.com>", "Royal Mail", "Thanks for dropping off your return", "You dropped off your return to Kestrel Outdoor at the Post Office.\nTracking number: KO123456789GB"],
    ["Parcelforce Worldwide <noreply@parcelforce.com>", "Parcelforce", "Your return is on its way", "Your return to Kestrel Outdoor is on its way back.\nParcel number: PF12345678"],
    ["Evri <noreply@evri.com>", "Evri", "Your return parcel has been dropped off", "Your return to Kestrel Outdoor has been dropped off at a ParcelShop.\nTracking number: H01HYA0012345678"],
    ["InPost <no-reply@inpost.co.uk>", "InPost", "Return dropped off at the locker", "Your return parcel has been dropped off. Tracking number: 600123456789012345678901"],
    ["DPD <noreply@dpd.co.uk>", "DPD", "We've got your return", "We've got your return parcel and it's on its way back to the retailer. Parcel number: 15501234567890"],
    ["Collect+ <hello@collectplus.co.uk>", "Collect+", "Your return has been dropped off", "Thanks, your return to Kestrel Outdoor has been dropped off. Tracking number: CP00112233445"],
    ["Yodel <notifications@yodel.co.uk>", "Yodel", "Your return is on its way", "Your return to Kestrel Outdoor is on its way back. Tracking number: JJD0002249999999999"]];
  for (const [from, carrier, subject, body] of dropped) {
    const r = parseReturnParcelEmail(mail(from, subject, body));
    assert.equal(r.ok, true, carrier + ": read");
    assert.deepEqual([r.stage, r.carrier, r.fromCarrier], ["sent", carrier, true], carrier + ": dropped off / on its way back");
    assert.ok(r.trackingNumber && /\d/.test(r.trackingNumber), carrier + ": the tracking number");
    assert.equal(parseReturnUpdateEmail(mail(from, subject, body)).ok, false, carrier + ": a carrier's email is never the shop's own word");
  }
  const rm = parseReturnParcelEmail(mail(dropped[0][0], dropped[0][2], dropped[0][3]));
  assert.deepEqual([rm.trackingNumber, rm.shop, rm.at], ["KO123456789GB", "Kestrel Outdoor", TODAY]);
  const label = parseReturnParcelEmail(mail("Evri <noreply@evri.com>", "Your return label is ready", "Here's your return label for Kestrel Outdoor. Show the QR code at a ParcelShop.\nTracking number: H01HYA0087654321"));
  assert.deepEqual([label.stage, label.trackingNumber], ["started", "H01HYA0087654321"], "a label made: the return started");
  const arrived = parseReturnParcelEmail(mail("Royal Mail <no-reply@royalmail.com>", "Your return has been delivered", "Your return to Kestrel Outdoor has been delivered.\nTracking number: KO123456789GB"));
  assert.equal(arrived.stage, "received", "the carrier delivered it to the shop");
  const shopSaid = parseReturnParcelEmail(mail("Kestrel Outdoor <returns@kestrel-outdoor.example>", "Your return is on its way to us", "Thanks, your return for order KO-1001 is on its way back to us."));
  assert.deepEqual([shopSaid.ok, shopSaid.stage, shopSaid.fromCarrier, shopSaid.orderRef, shopSaid.retailer.domain], [true, "sent", false, "KO-1001", "kestrel-outdoor.example"]);
  // Not return parcels.
  assert.equal(parseReturnParcelEmail(mail("Royal Mail <no-reply@royalmail.com>", "Your parcel has been delivered", "Your parcel from Kestrel Outdoor has been delivered.\nTracking number: AB123456789GB")).ok, false, "an ordinary delivery");
  assert.equal(parseDeliveryEmail(mail("Royal Mail <no-reply@royalmail.com>", "Your parcel has been delivered", "Your parcel from Kestrel Outdoor has been delivered.\nTracking number: AB123456789GB")).ok, true, "which is still a delivery");
  assert.equal(parseReturnParcelEmail(mail("Evri <noreply@evri.com>", "We couldn't deliver your parcel", "Your parcel is being returned to sender.")).ok, false, "returned to sender is a failed delivery");
  assert.equal(parseReturnParcelEmail(mail("Kestrel Outdoor <orders@kestrel-outdoor.example>", "Your order is on its way", "Once we've received your return we'll refund you. Returns: drop off at any Post Office.")).ok, false, "a shop's order email that mentions returns");
  assert.equal(parseReturnParcelEmail(mail("Kestrel Outdoor <returns@kestrel-outdoor.example>", "How to return your order", "Drop off your return at any Post Office.")).ok, false, "instructions aren't a parcel on its way");
  // The shop's own word on arrival and refunds still comes from its own emails.
  assert.equal(parseReturnUpdateEmail(mail("Kestrel Outdoor <returns@kestrel-outdoor.example>", "We've received your return", "We've received your return for order KO-1001.")).stage, "received");
  console.log("ok - carriers' (all seven) and shops' return emails: label, dropped off or on its way back, delivered to the shop; ordinary deliveries and failed ones aren't returns");

  // 9. Only what the email says has happened. Each of these used to be read as dropped off, delivered or refunded.
  const RM = "Royal Mail <no-reply@royalmail.com>", EV = "Evri <noreply@evri.com>", IP = "InPost <no-reply@inpost.co.uk>", SHOP = "Kestrel Outdoor <returns@kestrel-outdoor.example>";
  const parcel = (from, subject, body) => parseReturnParcelEmail(mail(from, subject, body));
  const labels = [
    [RM, "Your return label is ready", "Here's your return label for Kestrel Outdoor.\nOnce you've dropped off your parcel at a Post Office we'll email you.\nTracking number: KO123456789GB"],
    [EV, "Your Evri return QR code", "Show this QR code at a ParcelShop. You can track your return once it is in transit.\nTracking number: H01HYA0087654321"],
    [IP, "Your return QR code for Kestrel Outdoor", "Take your return parcel to any InPost locker. When your parcel has been dropped off we will let the retailer know."],
    [RM, "Your return label expires soon", "You have not yet dropped off your return to Kestrel Outdoor. Your label is still valid.\nTracking number: KO123456789GB"],
    [EV, "Your return label", "Has your return been dropped off? If it has been dropped off, you can ignore this email. Print your label again here.\nTracking number: H01HYA0087654321"],
    [RM, "Your return label is ready", "After you've dropped off your return at a Post Office it's on its way back to Kestrel Outdoor.\nTracking number: KO123456789GB"]];
  for (const [from, subject, body] of labels) assert.equal(parcel(from, subject, body).stage, "started", "a label, not a drop-off: " + subject + " / " + body.slice(0, 50));
  assert.equal(parcel(EV, "Don't forget to drop off your return", "Your return to Kestrel Outdoor hasn't been dropped off yet. Tracking number: H01HYA0087654321").ok, false, "a reminder says nothing happened");
  const thanks = parcel(RM, "Thanks for dropping off your return", "We'll let you know when your return has been delivered to Kestrel Outdoor.\nTracking number: KO123456789GB");
  assert.deepEqual([thanks.stage, thanks.trackingNumber], ["sent", "KO123456789GB"], "dropped off; 'when it has been delivered' is not delivered");
  const onWay = parcel(EV, "Your return is on its way", "Your return to Kestrel Outdoor will be delivered to the retailer in 2-3 days.\nTracking number: H01HYA0087654321");
  assert.deepEqual([onWay.stage, onWay.shop], ["sent", "Kestrel Outdoor"], "on its way; 'will be delivered' is not delivered");
  assert.equal(parcel(RM, "Your return has been delivered", "Your return to Kestrel Outdoor has been delivered and will be processed by the retailer.\nTracking number: KO123456789GB").stage, "received", "said plainly, it still counts");
  const update = (subject, body) => parseReturnUpdateEmail(mail(SHOP, subject, body));
  for (const body of ["We've received your return for order KO-1001. We'll process your refund within 5 working days.", "We've received your return for order KO-1001. Your refund will be issued once we've checked the items.",
    "We have received your return for order KO-1001.\nOnce your return has been inspected, we will send you a refund confirmation.", "We've received your return for order KO-1001. If you have any questions about your refund, reply to this email.",
    "We've received your return for order KO-1001. Your refund can take up to 10 days.", "We've received your return for order KO-1001. Your refund has not been processed yet."])
    assert.equal(update("We've received your return", body).stage, "received", "received, and a refund only promised: " + body.slice(40));
  assert.equal(update("Your return has been registered", "Your return for order KO-1001 is registered. When we have received your return, a refund of £30.00 will be issued.").ok, false, "registered: neither received nor refunded");
  for (const [subject, body] of [["Your refund is on its way", "We've refunded £30.00 for order KO-1001."], ["We've received your return", "We've received your return for order KO-1001 and we have processed your refund of £30.00. It will reach your account within 5 days."],
    ["Your refund", "We can confirm your refund of £30.00 for order KO-1001 has been issued and will show on your statement shortly."], ["Refund for your Kestrel Outdoor order KO-1001", "We've processed the refund for your returned items. Refund total £30.00"]]) {
    const r = update(subject, body);
    assert.deepEqual([r.stage, r.amountPence], ["refunded", 3000], "a refund the shop says it has made: " + subject);
  }
  const shopSent = classifyEmail(mail(SHOP, "Your return is on its way to us", "Thanks, your return for order KO-1001 is on its way back to us. Once we receive it, your refund will be processed.")).details;
  assert.deepEqual([shopSent.kind, shopSent.stage, shopSent.fromCarrier], ["return_update", "sent", false], "the shop says it's on its way; the refund is only promised");
  // A shop's own return-label email: the return started, with the parcel's tracking number, on the order it names.
  const shopLabel = classifyEmail(mail(SHOP, "Your return label for order KO-1001", "Your Royal Mail return label is attached. Tracking number: KO123456789GB. Drop it off at any Post Office. Once it has been dropped off, it is on its way back to us.")).details;
  assert.deepEqual([shopLabel.kind, shopLabel.orderRef, shopLabel.trackingNumber], ["return_instructions", "KO-1001", "KO123456789GB"]);
  assert.notEqual(classifyEmail(mail(SHOP, "Your return label", "Print the attached label and drop your parcel off at any Post Office.")).details.kind, "return_instructions", "no tracking number or order number: not read as one");
  assert.notEqual(classifyEmail(mail(SHOP, "Free returns label with every order", "Order number: KO-1001. Shop the sale now.")).details.kind, "return_instructions", "an advert isn't a return");
  console.log("ok - only what an email says has happened: labels, reminders, 'when it's delivered' and 'we'll process your refund' are not drop-offs, arrivals or refunds; a shop's label email starts the return with its tracking number");
}

// ---- 2 and 4. Matching and the states ----
{
  assert.equal(guessCarrier("KO123456789GB"), "Royal Mail"); assert.equal(guessCarrier("JJD0002249999999999"), "Yodel"); assert.equal(guessCarrier("H01HYA0012345678"), "Evri");
  for (const unsure of ["15501234567890", "600123456789012345678901", "PF12345678", "1Z999AA10123456784"]) assert.equal(guessCarrier(unsure), null, "not sure: asked (" + unsure + ")");
  assert.equal(cleanTrackingNumber(" ko 1234-56789 gb "), "KO123456789GB", "spaces, dashes and small letters tidied");
  for (const bad of ["", "SHORT1", "ABCDEFGHIJ", "KO123 456<script>", "x".repeat(41) + "1", 42]) assert.equal(cleanTrackingNumber(bad), undefined, "not a tracking number: " + bad);
  assert.equal(cleanReturnSent({ sentOn: ago(-1) }, TODAY).error, "bad_date", "not in the future");
  assert.equal(cleanReturnSent({ sentOn: "2026-02-30" }, TODAY).error, "bad_date");
  assert.equal(cleanReturnSent({ sentOn: ago(5) }, TODAY, ago(2)).error, "bad_date", "not before the order");
  assert.equal(cleanReturnSent({ carrier: "Hermes Express" }, TODAY).error, "bad_carrier");
  assert.deepEqual(cleanReturnSent({ trackingNumber: "15501234567890" }, TODAY).value, { trackingNumber: "15501234567890", carrier: null, sentOn: TODAY, guessed: false, needsCarrier: true });
  assert.deepEqual(cleanReturnSent({ trackingNumber: "ko123456789gb" }, TODAY).value, { trackingNumber: "KO123456789GB", carrier: "Royal Mail", sentOn: TODAY, guessed: true, needsCarrier: false });
  assert.deepEqual(cleanReturnSent({ trackingNumber: "ko123456789gb", carrier: "Parcelforce" }, TODAY).value.carrier, "Parcelforce", "the shopper's choice wins");
  console.log("ok - typed numbers tidied and checked; the carrier guessed only from Royal Mail's, Yodel's and Evri's own formats");

  const R = (name, domain) => ({ name, domain });
  const order = (id, shop, ref, date, total, items, extra = {}) => ({ id, retailer: shop, orderRef: ref, orderDate: date, totalPence: total, items: items || [{ name: "Thing", qty: 1, pricePence: total }], ...extra });
  const kestrel = R("Kestrel Outdoor", "kestrel-outdoor.example"), larks = R("Larkspur Home", "larkspur.example");
  const upd = (o) => ({ kind: "return_update", source: "shopper_email", ...o });
  // By order number (and the same shop).
  {
    const a = order("a", kestrel, "KO-1001", ago(20), 8900), b = order("b", kestrel, "KO-1002", ago(18), 8900), c = order("c", larks, "KO-1001", ago(20), 8900);
    attachReturnTracking([a, b, c], { today: TODAY, updates: [upd({ stage: "received", at: ago(3), orderRef: "KO-1001", retailer: kestrel })] });
    assert.equal(a.returnTracking.state, "received"); assert.equal(b.returnTracking, undefined); assert.equal(c.returnTracking, undefined, "another shop's order with the same number");
    assert.deepEqual(a.returnTracking.steps.map((s) => [s.step, s.done, s.at, s.from && s.from.by]), [["started", false, null, null], ["sent", false, null, null], ["received", true, ago(3), "shop"], ["refunded", false, null, null]],
      "the steps in order; the earlier ones not ticked, since nobody told Relay about them (24 Nov 2026: it used to tick them)");
    assert.deepEqual(a.returnTracking.steps.map((s) => Boolean(s.missed)), [true, true, false, false], "marked as steps Relay wasn't told about; the refund is just still to come");
    assert.deepEqual(a.returnTracking.onItsWay, { by: "shop", name: "Kestrel Outdoor", at: ago(3), via: "email", atTime: null, arrived: true }, "the shop has it, so it left the shopper, though nobody said when");
    assert.equal(a.returnReceived, true); assert.equal(a.returnInTransit, false);
  }
  // By the return's tracking number: a carrier email that names no order.
  {
    const a = order("a", kestrel, "KO-1001", ago(20), 8900);
    attachReturnTracking([a], { today: TODAY, typed: [{ receipt_id: "a", tracking_number: "KO123456789GB", carrier: "Royal Mail", sent_on: ago(4) }],
      updates: [upd({ stage: "sent", fromCarrier: true, carrier: "Royal Mail", trackingNumber: "KO123456789GB", at: ago(3) })],
      deliveries: [{ kind: "delivery_update", status: "delivered", carrier: "Royal Mail", trackingNumber: "KO123456789GB", at: ago(1) }] });
    const t = a.returnTracking;
    assert.deepEqual(t.steps.map((s) => [s.step, s.at, s.from && s.from.by, s.from && s.from.name]),
      [["started", null, null, null], ["sent", ago(3), "carrier", "Royal Mail"], ["received", ago(1), "carrier", "Royal Mail"], ["refunded", null, null, null]], "the carrier's word over the shopper's");
    assert.deepEqual([t.trackingNumber, t.carrier, t.trackUrl], ["KO123456789GB", "Royal Mail", "https://www.royalmail.com/track-your-item#/tracking-results/KO123456789GB"]);
    assert.deepEqual(returnFacts({ id: "a", returnTracking: t }), { receiptId: "a", returnInTransit: false, returnReceived: true, confirmedBy: { by: "carrier", name: "Royal Mail", at: ago(1), via: "email", atTime: null },
      onItsWay: { by: "carrier", name: "Royal Mail", at: ago(3), via: "email", atTime: null }, statement: "On its way: confirmed by Royal Mail's email on " + ago(3), trackingNumber: "KO123456789GB", state: "received" });
  }
  // A carrier email whose number Relay learns from the shop's email (matched by order number) the first time round.
  {
    const a = order("a", kestrel, "KO-1001", ago(20), 8900);
    attachReturnTracking([a], { today: TODAY, updates: [upd({ stage: "sent", fromCarrier: true, carrier: "Evri", trackingNumber: "H01HYA0012345678", at: ago(2) }),
      upd({ stage: "started", fromCarrier: true, carrier: "Evri", trackingNumber: "H01HYA0012345678", orderRef: "KO-1001", shopNamed: "Kestrel Outdoor", at: ago(5) })] });
    assert.deepEqual(a.returnTracking.steps.slice(0, 2).map((s) => [s.at, s.from.name]), [[ago(5), "Evri"], [ago(2), "Evri"]]);
    assert.equal(a.returnInTransit, true, "on its way, on the carrier's word");
  }
  // By shop, amount and date window: the refund email gives no order number.
  {
    const a = order("a", kestrel, "KO-1001", ago(30), 12000, [{ name: "Jacket", qty: 1, pricePence: 9000 }, { name: "Hat", qty: 1, pricePence: 3000 }]);
    const b = order("b", kestrel, "KO-1002", ago(10), 4500), old = order("old", kestrel, "KO-0900", ago(400), 3000);
    attachReturnTracking([a, b, old], { today: TODAY, updates: [upd({ stage: "refunded", at: ago(2), amountPence: 3000, currency: "GBP", retailer: kestrel })] });
    assert.equal(a.returnTracking.state, "refunded", "£30 is the hat on order a; order 'old' is outside the window");
    assert.deepEqual([a.returnTracking.steps[3].amountPence, a.returnTracking.steps[3].from], [3000, { by: "shop", name: "Kestrel Outdoor", via: "email" }]);
    assert.equal(b.returnTracking, undefined); assert.equal(old.returnTracking, undefined);
    assert.equal(a.returnProgress.refundPence, 3000, "the older shape the app and Wrapped read is filled in too");
    const c = order("c", kestrel, "KO-1003", ago(12), 3000), d = order("d", kestrel, "KO-1004", ago(11), 3000);
    attachReturnTracking([c, d], { today: TODAY, updates: [upd({ stage: "refunded", at: ago(2), amountPence: 3000, retailer: kestrel })] });
    assert.equal(c.returnTracking || d.returnTracking, undefined, "two orders fit: no guess");
    const e = order("e", kestrel, "KO-1005", ago(12), 3000);
    attachReturnTracking([e], { today: TODAY, updates: [upd({ stage: "refunded", at: ago(2), amountPence: 2999, retailer: kestrel })] });
    assert.equal(e.returnTracking, undefined, "an amount that fits nothing on the order");
  }
  // By shop and window only when exactly one of that shop's orders has a return started.
  {
    const a = order("a", kestrel, "KO-1001", ago(20), 8900), b = order("b", kestrel, "KO-1002", ago(15), 4500);
    attachReturnTracking([a, b], { today: TODAY, marks: [{ id: "b", i: 0, status: "returning", at: NOW - 5 * DAY }],
      updates: [upd({ stage: "sent", fromCarrier: true, carrier: "InPost", trackingNumber: "600123456789012345678901", shopNamed: "Kestrel Outdoor", at: ago(4) }),
        upd({ stage: "received", at: ago(1), retailer: kestrel })] });
    assert.equal(a.returnTracking, undefined);
    assert.deepEqual(b.returnTracking.steps.map((s) => s.from && s.from.by), ["you", "carrier", "shop", null], "started (you said), sent (InPost), received (the shop)");
    const c = order("c", kestrel, "KO-1003", ago(20), 8900);
    attachReturnTracking([c], { today: TODAY, updates: [upd({ stage: "sent", fromCarrier: true, carrier: "InPost", shopNamed: "Kestrel Outdoor", at: ago(4) })] });
    assert.equal(c.returnTracking, undefined, "no return started there: a carrier's word alone isn't enough to pick the order");
    const d = order("d", kestrel, "KO-1004", ago(20), 8900, undefined, { returnPlan: { kind: "return_instructions", at: ago(6), carrier: "Royal Mail" } });
    attachReturnTracking([d], { today: TODAY, updates: [upd({ stage: "sent", fromCarrier: true, carrier: "Royal Mail", trackingNumber: "KO999999999GB", shopNamed: "Kestrel", at: ago(4) })] });
    assert.deepEqual(d.returnTracking.steps.slice(0, 2).map((s) => [s.at, s.from.by]), [[ago(6), "shop"], [ago(4), "carrier"]], "the shop's return email started it");
  }
  // The shopper's word alone: shown, but never a confirmed fact.
  {
    const a = order("a", kestrel, "KO-1001", ago(20), 8900);
    attachReturnTracking([a], { today: TODAY, typed: [{ receipt_id: "a", tracking_number: null, carrier: null, sent_on: ago(1) }] });
    assert.deepEqual([a.returnTracking.state, a.returnTracking.steps[1].from, a.returnInTransit, a.returnReceived], ["sent", { by: "you", name: null, via: "app" }, false, false]);
    const none = order("n", kestrel, "KO-1009", ago(20), 8900);
    attachReturnTracking([none], { today: TODAY });
    assert.equal(none.returnTracking, undefined, "no news: no return");
    assert.deepEqual(STEPS, ["started", "sent", "received", "refunded"]);
  }
  console.log("ok - matched by tracking number, else shop and order number, else shop, amount and window, else shop and window with one return open; never a guess; the states in order with their day and who said so");

  // ---- 5. Refund not seen yet ----
  const nudge = (receivedDaysAgo, extra = {}) => {
    const a = order("a", kestrel, "KO-1001", ago(40), 8900);
    attachReturnTracking([a], { today: TODAY, updates: [upd({ stage: "received", at: ago(receivedDaysAgo), orderRef: "KO-1001", retailer: kestrel }), ...(extra.updates || [])], typed: extra.typed || [] });
    return a.returnTracking.refundNotSeen;
  };
  assert.equal(nudge(13), null, "13 days: not yet");
  assert.deepEqual(nudge(14), { since: ago(14), days: 14 }, "14 days after the shop said it had it");
  assert.equal(nudge(20, { updates: [upd({ stage: "refunded", at: ago(2), orderRef: "KO-1001", retailer: kestrel })] }), null, "a refund seen: no nudge");
  {
    const a = order("a", kestrel, "KO-1001", ago(40), 8900);
    attachReturnTracking([a], { today: TODAY, typed: [{ receipt_id: "a", tracking_number: null, carrier: null, sent_on: ago(30) }] });
    assert.equal(a.returnTracking.refundNotSeen, null, "only sent (by the shopper's word): Relay never saw it arrive, so no nudge");
  }
  console.log("ok - Refund not seen yet: only 14 days after Relay saw the shop receive it, and never once refunded");
}

// ---- 11. A refund seen in the shopper's own bank payments ----
{
  const R = (name, domain) => ({ name, domain });
  const kestrel = R("Kestrel Outdoor", "kestrel-outdoor.example");
  const order = (id, ref, date, total, items) => ({ id, retailer: kestrel, orderRef: ref, orderDate: date, totalPence: total, currency: "GBP", items: items || [{ name: "Thing", qty: 1, pricePence: total }] });
  const upd = (o) => ({ kind: "return_update", source: "shopper_email", retailer: kestrel, ...o });
  const credit = (pence, on, text = "KESTREL OUTDOOR LTD", o = {}) => ({ id: "c-" + pence + on, on, pence, currency: "GBP", account: "Everyday Account ending 4321", text, ...o });
  const run = (orders, o) => { attachReturnTracking(orders, { today: TODAY, names: namesShop, ...o }); return orders; };
  // The shop said it has the return; the money then shows in the bank: "Refund received", from the bank.
  {
    const [a] = run([order("a", "KO-1001", ago(20), 8900)], { updates: [upd({ stage: "received", at: ago(6), orderRef: "KO-1001" })], credits: [credit(8900, ago(2))] });
    const t = a.returnTracking;
    assert.deepEqual([t.state, t.steps[3]], ["refunded", { step: "refunded", done: true, at: ago(2), from: { by: "bank", name: "Everyday Account ending 4321", via: "bank" }, amountPence: 8900, currency: "GBP" }]);
    assert.equal(t.refundNotSeen, null, "the refund was seen");
    assert.deepEqual([a.returnReceived, t.confirmedBy.by, t.confirmedBy.at], [true, "shop", ago(6)], "received on the shop's word, as before");
    assert.equal(a.returnProgress.refundedAt, null, "the older shape (Wrapped's refunds) only takes a shop's own word");
  }
  // The shop's refund email and the bank both: the shop's word is the step, the bank's is shown beside it.
  {
    const [a] = run([order("a", "KO-1001", ago(20), 8900, [{ name: "Hat", qty: 1, pricePence: 3000 }, { name: "Coat", qty: 1, pricePence: 5900 }])],
      { updates: [upd({ stage: "refunded", at: ago(4), orderRef: "KO-1001", amountPence: 3000, currency: "GBP" })], credits: [credit(5900, ago(3)), credit(3000, ago(2))] });
    const s = a.returnTracking.steps[3];
    assert.deepEqual([s.from.by, s.at, s.amountPence, s.seenInBank], ["shop", ago(4), 3000, { at: ago(2), account: "Everyday Account ending 4321" }], "only the credit of the amount the shop said (£30), not the £59 one");
  }
  // On the shopper's word alone, a credit shows the refund but confirms nothing.
  {
    const [a] = run([order("a", "KO-1001", ago(20), 8900)], { typed: [{ receipt_id: "a", tracking_number: null, carrier: null, sent_on: ago(8) }], credits: [credit(8900, ago(1))] });
    assert.deepEqual([a.returnTracking.state, a.returnTracking.steps[3].from.by, a.returnReceived, a.returnInTransit, a.returnTracking.onItsWay], ["refunded", "bank", false, false, null],
      "a bank payment that looks like the refund never says the shop has the parcel, or that it was sent");
    assert.deepEqual(a.returnTracking.steps.map((s) => [s.done, Boolean(s.missed)]), [[false, true], [true, false], [false, true], [true, false]]);
  }
  // Left out, each for its own reason.
  const none = (why, orders, o) => { run(orders, o); for (const x of orders) assert.ok(!x.returnTracking || x.returnTracking.steps[3].done === false, "no refund shown: " + why); };
  const started = (id) => ({ id, i: 0, status: "returning", at: NOW - 9 * DAY });
  none("no return known on the receipt", [order("a", "KO-1001", ago(20), 8900)], { credits: [credit(8900, ago(2))] });
  none("the bank's text doesn't name the shop", [order("a", "KO-1001", ago(20), 8900)], { marks: [started("a")], credits: [credit(8900, ago(2), "FASTER PAYMENT FROM A FRIEND")] });
  none("an amount that fits nothing on the order", [order("a", "KO-1001", ago(20), 8900)], { marks: [started("a")], credits: [credit(8899, ago(2))] });
  none("money that came in before the return started", [order("a", "KO-1001", ago(20), 8900)], { marks: [started("a")], credits: [credit(8900, ago(12))] });
  none("another currency", [order("a", "KO-1001", ago(20), 8900)], { marks: [started("a")], credits: [credit(8900, ago(2), "KESTREL OUTDOOR LTD", { currency: "EUR" })] });
  none("two receipts it could be", [order("a", "KO-1001", ago(20), 8900), order("b", "KO-1002", ago(19), 8900)], { marks: [started("a"), started("b")], credits: [credit(8900, ago(2))] });
  none("two credits that both fit", [order("a", "KO-1001", ago(20), 8900)], { marks: [started("a")], credits: [credit(8900, ago(2)), credit(8900, ago(1))] });
  none("long after the order", [order("a", "KO-1001", ago(200), 8900)], { typed: [{ receipt_id: "a", tracking_number: null, carrier: null, sent_on: ago(190) }], credits: [credit(8900, ago(2))] });
  none("no way to check the name (names not given)", [order("a", "KO-1001", ago(20), 8900)], { marks: [started("a")], credits: [credit(8900, ago(2))], names: null });
  console.log("ok - a refund seen in the bank: only on a known return, the shop named, the amount fitting, after the return started; never a guess; it never confirms the parcel was sent or received");
}

// ---- 12. The carrier's first scan, and the one fact to pay on ----
{
  const kestrel = { name: "Kestrel Outdoor", domain: "kestrel-outdoor.example" };
  const order = () => ({ id: "a", retailer: kestrel, orderRef: "KO-1001", orderDate: ago(20), totalPence: 8900, currency: "GBP", items: [{ name: "Thing", qty: 1, pricePence: 8900 }] });
  const ev = (m, when) => ({ statusMilestone: m, occurrenceDatetime: when });
  const body = (events) => ({ data: { trackings: [{ shipment: {}, events }] } });
  assert.equal(firstScan(body([ev("info_received", ago(5) + "T08:00:00"), ev("in_transit", ago(3) + "T14:05:00"), ev("in_transit", ago(4) + "T09:14:00"), ev("delivered", ago(1) + "T11:00:00")])), ago(4) + "T09:14:00", "the earliest real scan");
  assert.equal(firstScan(body([ev("pending", ago(5) + "T08:00:00"), ev("info_received", ago(5) + "T08:01:00")])), null, "a label made is not a scan");
  assert.equal(firstScan(body([ev("exception", ago(2) + "T08:00:00")])), null, "a problem report is not a scan");
  assert.equal(firstScan(body([ev("in_transit", "yesterday"), ev("in_transit", "2026-13-45T99:00:00")])), null, "a time that isn't one is never kept");
  assert.equal(firstScan(body([ev("in_transit", ago(4) + "T09:14:00+00:00")])), ago(4) + "T09:14:00+00:00");
  assert.equal(firstScan(null), null);
  const typed = [{ receipt_id: "a", tracking_number: "KO123456789GB", carrier: "Royal Mail", sent_on: ago(5) }];
  const track = (row) => { const a = order(); attachReturnTracking([a], { today: TODAY, typed, tracked: [{ tracking_number: "KO123456789GB", ...row }] }); return a; };
  // Scanned: on its way, with the scan's own time. The carrier's expected day (a day still to come) is never the day it was sent.
  let a = track({ status: "due", at: ago(-2), first_scan: ago(4) + "T09:14:00" });
  assert.deepEqual(a.returnTracking.steps[1], { step: "sent", done: true, at: ago(4), from: { by: "carrier", name: "Royal Mail", via: "tracking" }, atTime: ago(4) + "T09:14:00" });
  assert.deepEqual(returnFacts(a), { receiptId: "a", returnInTransit: true, returnReceived: false, confirmedBy: { by: "carrier", name: "Royal Mail", at: ago(4), via: "tracking", atTime: ago(4) + "T09:14:00" },
    onItsWay: { by: "carrier", name: "Royal Mail", at: ago(4), via: "tracking", atTime: ago(4) + "T09:14:00" }, statement: "On its way: confirmed by Royal Mail's tracking, first scan " + ago(4) + "T09:14:00", trackingNumber: "KO123456789GB", state: "sent" });
  // A parcel looked up before the scan time was kept: on its way, but Relay doesn't put the expected day in its place.
  a = track({ status: "due", at: ago(-2) });
  assert.deepEqual([a.returnTracking.steps[1].at, a.returnTracking.steps[1].done, a.returnInTransit, a.returnTracking.onItsWay.at, a.returnTracking.onItsWay.atTime], [null, true, true, null, null]);
  a = track({ status: "in_transit", at: ago(2) });
  assert.deepEqual([a.returnTracking.steps[1].at, a.returnTracking.onItsWay.at], [ago(2), ago(2)], "the day of the carrier's latest news");
  // Delivered to the shop: both steps, each with its own day.
  a = track({ status: "delivered", at: ago(1), first_scan: ago(4) + "T09:14:00" });
  assert.deepEqual(a.returnTracking.steps.slice(1, 3).map((s) => [s.done, s.at, s.from.via]), [[true, ago(4), "tracking"], [true, ago(1), "tracking"]]);
  assert.deepEqual([a.returnReceived, a.returnInTransit, a.returnTracking.onItsWay.atTime, a.returnTracking.onItsWay.arrived], [true, false, ago(4) + "T09:14:00", undefined]);
  // The carrier's tracking is believed before its email, and its email before the shop's.
  a = order(); attachReturnTracking([a], { today: TODAY, typed, tracked: [{ tracking_number: "KO123456789GB", status: "in_transit", at: ago(2), first_scan: ago(3) + "T18:40:00" }],
    updates: [{ kind: "return_update", stage: "sent", fromCarrier: true, carrier: "Royal Mail", trackingNumber: "KO123456789GB", at: ago(4) }, { kind: "return_update", stage: "sent", orderRef: "KO-1001", retailer: kestrel, at: ago(5) }] });
  assert.deepEqual([a.returnTracking.steps[1].from, a.returnTracking.steps[1].at], [{ by: "carrier", name: "Royal Mail", via: "tracking" }, ago(3)]);
  // A problem with no scan: the carrier never had it, so it isn't on its way.
  a = track({ status: "problem", at: ago(1) });
  assert.deepEqual([a.returnTracking.steps[1].from.by, a.returnInTransit, a.returnTracking.onItsWay, Boolean(a.returnTracking.problem)], ["you", false, null, true]);
  a = track({ status: "problem", at: ago(1), first_scan: ago(4) + "T09:14:00" });
  assert.deepEqual([a.returnTracking.steps[1].at, a.returnTracking.problem.at, a.returnTracking.onItsWay.by], [ago(4), ago(1), "carrier"], "scanned, then a problem: sent on the scan's day, the problem on its own");
  // The shopper's word alone, with a tracking number and nothing from the carrier: not on its way.
  a = order(); attachReturnTracking([a], { today: TODAY, typed });
  assert.deepEqual([returnFacts(a).onItsWay, returnFacts(a).statement], [null, "Not confirmed on its way"]);
  assert.equal(returnFacts(null).onItsWay, null); assert.equal(returnFacts({ id: "x" }).statement, "Not confirmed on its way");
  console.log("ok - onItsWay: the carrier's first scan with its own time, never its expected day, a label, a problem with no scan or the shopper's word; tracking believed before emails");
}

// ---- The server: own receipts, the input rules, Ship24, export and deletion ----
const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); }
  };
}
const db = { prepare: sql => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { list.forEach(s => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key" };
let emails = [], ship = [], reply = () => Response.json({ data: { trackings: [{ shipment: { statusMilestone: "in_transit", delivery: {} }, events: [{ statusMilestone: "in_transit", occurrenceDatetime: ago(1) + "T09:00:00" }] }] } });
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (String(url).startsWith("https://api.ship24.com/")) { ship.push({ url: String(url), init }); return reply(); }
  return new Response("{}", { status: 404 });
};
const call = (path, { method = "GET", body, token, raw } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: NOW, fetchImpl });
async function signIn(email) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email } });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const alice = await signIn("alice@example.com"), bob = await signIn("bob@example.com");
const idOf = (e) => sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(e).id;
const A = idOf("alice@example.com"), B = idOf("bob@example.com");
await call("/relay/my/receipts", { token: alice });
let n = 0;
const add = (shopper, id, details) => sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)")
  .run(id, shopper, "m-" + (++n), "pending", JSON.stringify({ currency: "GBP", parserVersion: 30, source: "shopper_email", ...details }), NOW - n * 1000);
const kestrel = { name: "Kestrel Outdoor", domain: "kestrel-outdoor.example" };
const RA = "11111111-1111-4111-8111-111111111111", RB = "22222222-2222-4222-8222-222222222222", RC = "33333333-3333-4333-8333-333333333333";
add(A, RA, { kind: "receipt", retailer: kestrel, orderRef: "KO-1001", orderDate: ago(12), totalPence: 8900, items: [{ name: "Trail Runner Shoes", qty: 1, pricePence: 8900 }],
  shipment: { trackingNumber: "AB123456789GB", carrier: "Royal Mail", status: "shipped" } });
add(A, RC, { kind: "receipt", retailer: { name: "Larkspur Home", domain: "larkspur.example" }, orderRef: "LK-2", orderDate: ago(6), totalPence: 6000, items: [{ name: "Brass Table Lamp", qty: 1, pricePence: 6000 }] });
// Bob bought from the same shop with the same order number; his return emails are his.
add(B, RB, { kind: "receipt", retailer: kestrel, orderRef: "KO-1001", orderDate: ago(30), totalPence: 8900, items: [{ name: "Trail Runner Shoes", qty: 1, pricePence: 8900 }] });
add(B, "44444444-4444-4444-8444-444444444444", { kind: "return_update", stage: "received", at: ago(16), orderRef: "KO-1001", retailer: kestrel });
add(B, "55555555-5555-4555-8555-555555555555", { kind: "return_update", stage: "sent", fromCarrier: true, carrier: "Royal Mail", trackingNumber: "BB111111111GB", shopNamed: "Kestrel Outdoor", orderRef: "KO-1001", at: ago(20) });
const list = async (token) => (await (await call("/relay/my/receipts?all=1", { token })).json()).receipts;
const card = async (token, id) => (await list(token)).find(c => c.id === id);
{
  const a = await card(alice, RA), b = await card(bob, RB);
  assert.equal(a.returnTracking, undefined, "bob's return emails never land on alice's receipt, though shop and order number are the same");
  assert.equal(b.returnTracking.state, "received"); assert.equal(b.returnReceived, true);
  assert.deepEqual(b.returnTracking.refundNotSeen, { since: ago(16), days: 16 }, "bob's refund not seen: 16 days since the shop had it");
  console.log("ok - another shopper's emails, with the same shop and order number, never reach this shopper's receipt");
}
const sent = (id, body, token = alice) => call("/relay/my/receipts/" + id + "/return-sent", { method: "POST", body, token });
// Own receipts only; the input rules.
{
  for (const [method, end, body] of [["POST", "/return-sent", { trackingNumber: "KO123456789GB" }], ["GET", "/return-parcel"]]) {
    const r = await call("/relay/my/receipts/" + RA + end, { method, body, token: bob });
    assert.equal(r.status, 404, method + " " + end + ": someone else's receipt is not found");
    assert.equal((await call("/relay/my/receipts/" + RA + end, { method, body })).status, 401, "signed out");
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM return_tracks").get().n, 0, "nothing saved");
  const refused = [[{ trackingNumber: "KO123456789GB", shop: "x" }, "an unknown field"], [{ trackingNumber: "K".repeat(61) }, "too long"], [{ undo: "yes" }, "the wrong type"],
    [{ trackingNumber: "not a number!" }, "not a tracking number"], [{ carrier: "Hermes Express" }, "not a carrier on the list"], [{ sentOn: ago(-2) }, "a day still to come"],
    [{ sentOn: ago(20) }, "before the order"]];
  for (const [body, why] of refused) assert.equal((await sent(RA, body)).status, 400, "refused: " + why);
  assert.equal((await call("/relay/my/receipts/" + RA + "/return-sent", { method: "POST", raw: "[1]", token: alice })).status, 400, "not one JSON object");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM return_tracks").get().n, 0, "still nothing saved");
  console.log("ok - own receipts only (404 for anyone else's, 401 signed out), and only sensible input (400)");
}
// "I've sent it back": without a number, with one Relay can't place, and with one it can.
{
  let r = await sent(RA, {});
  assert.equal(r.status, 200);
  let j = await r.json();
  assert.deepEqual([j.returnTracking.state, j.returnTracking.steps[1].from.by, j.returnTracking.steps[1].at, j.returnTracking.trackingNumber], ["sent", "you", TODAY, null]);
  assert.deepEqual([j.returnInTransit, j.returnReceived], [false, false], "the shopper's word alone confirms nothing");
  r = await sent(RA, { trackingNumber: "15501234567890", sentOn: ago(1) }); j = await r.json();
  assert.deepEqual([j.needsCarrier, j.carrierGuessed, j.returnTracking.carrier, j.returnTracking.steps[1].at], [true, false, null, ago(1)], "a number whose carrier isn't sure: the app asks");
  r = await sent(RA, { trackingNumber: "15501234567890", carrier: "DPD", sentOn: ago(1) }); j = await r.json();
  assert.deepEqual([j.needsCarrier, j.returnTracking.carrier, j.returnTracking.trackUrl], [false, "DPD", "https://track.dpd.co.uk/parcels/15501234567890"]);
  r = await sent(RA, { trackingNumber: "ko 123456789 gb", sentOn: ago(1) }); j = await r.json();
  assert.deepEqual([j.carrierGuessed, j.returnTracking.carrier, j.returnTracking.trackingNumber], [true, "Royal Mail", "KO123456789GB"], "Royal Mail's format: guessed");
  const c = await card(alice, RA);
  assert.equal(c.returnTracking.state, "sent", "it's on the receipt in the list too");
  assert.ok(c.returnProgress, "and in the older shape Home reads");
  assert.deepEqual(await returnFactsFor(env, A, RA), { receiptId: RA, returnInTransit: false, returnReceived: false, confirmedBy: null, onItsWay: null, statement: "Not confirmed on its way", trackingNumber: "KO123456789GB", state: "sent" });
  assert.equal(await returnFactsFor(env, B, RA), null, "not bob's");
  console.log("ok - I've sent it back: on its own, with a number and the carrier asked, or with the carrier guessed from Royal Mail's format");
}
// Ship24 for the return parcel.
{
  // Off until the key is set: nothing asked, and the app is told plainly.
  let j = await (await call("/relay/my/receipts/" + RA + "/return-parcel", { token: alice })).json();
  assert.deepEqual([j.available, ship.length], [false, 0]);
  env.SHIP24_API_KEY = "ship24-test-key";
  j = await (await call("/relay/my/receipts/" + RC + "/return-parcel", { token: alice })).json();
  assert.deepEqual([j.available, j.reason, ship.length], [true, "no_tracking_number", 0], "no return on it: nothing to ask");
  j = await (await call("/relay/my/receipts/" + RA + "/return-parcel", { token: alice })).json();
  assert.equal(ship.length, 1, "asked once, when the receipt is opened");
  assert.deepEqual(JSON.parse(ship[0].init.body), { trackingNumber: "KO123456789GB", destinationCountryCode: "GB", courierCode: ["gb-post"] }, "only the tracking number goes to Ship24");
  assert.ok(!JSON.stringify(ship[0]).includes("alice") && !JSON.stringify(ship[0]).includes("KO-1001"), "nothing about the shopper or the order");
  assert.deepEqual([j.returnTracking.steps[1].from, j.returnTracking.steps[1].at, j.returnInTransit], [{ by: "carrier", name: "Royal Mail", via: "tracking" }, ago(1), true], "the carrier's own word: on its way");
  assert.deepEqual(j.onItsWay, { by: "carrier", name: "Royal Mail", at: ago(1), via: "tracking", atTime: ago(1) + "T09:00:00" }, "with the time of the carrier's first scan, in the route's answer");
  assert.deepEqual((await returnFactsFor(env, A, RA)).onItsWay, j.onItsWay, "and on the server, for a future instant refund");
  assert.equal((await returnFactsFor(env, A, RA)).statement, "On its way: confirmed by Royal Mail's tracking, first scan " + ago(1) + "T09:00:00");
  assert.equal(sqlite.prepare("SELECT first_scan FROM parcel_tracks WHERE shopper_id = ? AND tracking_number = 'KO123456789GB'").get(A).first_scan, ago(1) + "T09:00:00", "kept with what the carrier said");
  await call("/relay/my/receipts/" + RA + "/return-parcel", { token: alice });
  assert.equal(ship.length, 1, "opened again soon after: not asked again (2 hours)");
  // The allowance is shared with deliveries: the return took this month's 1st; with 2 in the month, a delivery gets the last.
  const month = TODAY.slice(0, 7);
  assert.equal(sqlite.prepare("SELECT n FROM parcel_track_uses WHERE month = ?").get(month).n, 1, "the return counted in the month's allowance");
  env.PARCEL_TRACKS_PER_MONTH = "2";
  const delivery = { id: RA, orderDate: ago(12), delivery: { status: "shipped", trackingNumber: "AB123456789GB", carrier: "Royal Mail" } };
  let d = await liveParcel(env, A, delivery, { now: NOW, fetchImpl });
  assert.equal(ship.length, 2, "the delivery took the 2nd");
  d = await liveParcel(env, A, { ...delivery, delivery: { ...delivery.delivery, trackingNumber: "AC123456789GB" } }, { now: NOW, fetchImpl });
  assert.deepEqual([d.reason, ship.length], ["limit", 2], "the month's allowance is used up for returns and deliveries together");
  // A return can't jump the limit either.
  await sent(RA, { trackingNumber: "KO222222222GB", sentOn: ago(1) });
  j = await (await call("/relay/my/receipts/" + RA + "/return-parcel", { token: alice })).json();
  assert.deepEqual([j.reason, ship.length], ["limit", 2], "said plainly: limit");
  // Per shopper: 3 new parcels a month, returns and deliveries together.
  env.PARCEL_TRACKS_PER_MONTH = "100";
  await liveParcel(env, A, { ...delivery, delivery: { ...delivery.delivery, trackingNumber: "AD123456789GB" } }, { now: NOW, fetchImpl });
  assert.equal(ship.length, 3, "alice's 3rd new parcel");
  j = await (await call("/relay/my/receipts/" + RA + "/return-parcel", { token: alice })).json();
  assert.deepEqual([j.reason, ship.length], ["limit", 3], "her 4th, a return, waits");
  delete env.PARCEL_TRACKS_PER_MONTH;
  console.log("ok - Ship24 for the return parcel: off until the key is set, only the tracking number, asked when the receipt is opened, the 10-a-month and 3-a-shopper limits shared with deliveries");
}
// A refund seen in the bank, through the receipts list: bob's own payments only.
{
  await ensureBankTables(db);
  const pay = (shopper, id, on, minor, description) => sqlite.prepare("INSERT INTO bank_payments (shopper_id, payment_id, connection_id, account, paid_on, amount_minor, currency, description, merchant, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(shopper, id, "conn-" + shopper, "Everyday Account ending 4321", on, minor, "GBP", description, null, NOW);
  pay(B, "p1", ago(3), -8900, "KESTREL OUTDOOR LTD REFUND");
  pay(B, "p2", ago(28), 8900, "KESTREL OUTDOOR LTD");          // what he paid: money out is never a refund
  pay(B, "p3", ago(2), -8900, "TRANSFER FROM SAVINGS");        // money in that isn't from the shop
  const b = await card(bob, RB), a = await card(alice, RA);
  assert.deepEqual(b.returnTracking.steps[3], { step: "refunded", done: true, at: ago(3), from: { by: "bank", name: "Everyday Account ending 4321", via: "bank" }, amountPence: 8900, currency: "GBP" });
  assert.equal(b.returnTracking.refundNotSeen, null, "so the refund is no longer 'not seen'");
  assert.ok(!a.returnTracking.steps[3].done, "bob's bank payments never reach alice's receipt, though shop, order number and price are the same");
  sqlite.prepare("INSERT INTO bank_not_mine (shopper_id, kind, key, created_at) VALUES (?,?,?,?)").run(B, "payment", "p1", NOW);
  assert.ok(!(await card(bob, RB)).returnTracking.steps[3].done, "a payment he said isn't his is never used");
  console.log("ok - a refund seen in the shopper's own bank payments shows on their receipt, never anyone else's, never a payment marked not theirs");
}
// Undo, Download my data and deletion.
{
  await sent(RA, { trackingNumber: "KO123456789GB", sentOn: ago(1) });
  const exp = await (await call("/relay/my/export", { token: alice })).json();
  assert.deepEqual(exp.returnsSentBack.map((r) => [r.receiptId, r.trackingNumber, r.carrier, r.sentOn]), [[RA, "KO123456789GB", "Royal Mail", ago(1)]], "in Download my data");
  assert.equal(JSON.stringify((await (await call("/relay/my/export", { token: bob })).json()).returnsSentBack), "[]", "bob's file has none of alice's");
  let j = await (await sent(RA, { undo: true })).json();
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM return_tracks WHERE shopper_id = ?").get(A).n, 0, "undo removes it");
  await sent(RA, { trackingNumber: "KO123456789GB" });
  assert.equal((await call("/relay/my/delete", { method: "POST", token: alice })).status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM return_tracks WHERE shopper_id = ?").get(A).n, 0, "deleted with the account");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM parcel_tracks WHERE shopper_id = ?").get(A).n, 0, "and what the carrier said");
  console.log("ok - undo, Download my data, and deleting the account removes it");
}
console.log("PASS return tracking: only what emails say has happened, steps nobody told Relay about never ticked, a refund seen in the bank, the carrier's first scan and the on-its-way fact, emails read and matched to the shopper's own receipt, typed numbers, carrier guessed only when sure, states in order, refund-not-seen at 14 days, Ship24 off until set and sharing the allowance, own receipts only, input rules, export and deletion");
