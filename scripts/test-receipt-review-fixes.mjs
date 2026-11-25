// The email readers after the code review of 25 Nov 2026 (made-up emails only, read by Relay's own readers, nothing sent
// anywhere). Each part first failed against the code as it was, then the code was fixed; the tests stay.
//   1. A refusal, a promise or a refund still under way is never read as done (refunded, delivered, on its way).
//   2. An email built to be slow (tags, comments or style sheets that never close) is read in well under a second.
//   3. Prices with one figure of pence, a pasted email's UK date, a return deadline from the right sentence.
// The parts that need a database (which shop a return email belongs to, a mailbox that keeps failing) are in
// scripts/test-receipt-review-mailbox.mjs.
//   node scripts/test-receipt-review-fixes.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseReturnUpdateEmail, parseDeliveryEmail, parseReturnParcelEmail, parseReturnEmail, parseReceiptEmail, parseDispatchEmail } from "../worker/receipt-parser.js";
import { classifyEmail, pastedAsEmail, estimateReturnBy } from "../worker/gmail.js";
import { hideDetails } from "../worker/shared-emails.js";
import { attachReturnTracking } from "../worker/return-tracking.js";

const mail = (from, subject, body, o = {}) => `From: ${from}\r\nTo: Sam Taylor <sam.taylor@example.co.uk>\r\nSubject: ${subject}\r\nDate: ${o.date || "Mon, 23 Nov 2026 10:00:00 +0000"}\r\nContent-Type: ${o.html ? "text/html" : "text/plain"}; charset=utf-8\r\n\r\n${body}`;
const SHOP = "Kestrel Outdoor <help@kestreloutdoor.example>";

if (process.argv[2] === "slow") {
  // Run in a second process (below) so a reader that takes minutes can be stopped. Each shape is 540,000 characters.
  const fill = (u, n = 540000) => u.repeat(Math.ceil(n / u.length));
  const shapes = ["<style x>", "<!-- a ", "<!--[if mso]> a ", "<!--[if a ", "<", "<div ", "<script>", "<td ", "<a href=", "<table ", "<img alt=", '<a href="https://x.example/returns">', "<table>", "<td>",
    '<div style="display:none">', "<span class=h>", "<s>£1.00", "<!--[if mso]> -->", "<style>a{</style>", "<style>.h{display:none}</style>", "<style>/* a </style>", "<style>@media x{a{b:c}}</style>"];
  const heads = [["an order", SHOP, "Your order confirmation #KO-1001"], ["a refund", SHOP, "Your refund for order #KO-1001"], ["a return", SHOP, "Your return request: Return ID R12345"],
    ["a carrier's return email", "Evri <noreply@evri.com>", "Your return has been dropped off"], ["a carrier's delivery email", "Royal Mail <no-reply@royalmail.com>", "Your parcel has been delivered"]];
  const out = {};
  for (const unit of shapes) for (const [what, from, subject] of heads) {
    const raw = mail(from, subject, "<p>Order number: KO-1001</p><p>Silver ring £100.00</p><p>Total £100.00</p>" + fill(unit), { html: true });
    const t = Date.now();
    classifyEmail(raw, {}, false);
    const ms = Date.now() - t;
    if (!out[unit] || ms > out[unit].ms) out[unit] = { ms, what };
    console.log("read " + JSON.stringify(unit) + " as " + what + " in " + ms + " ms");
  }
  console.log("RESULT " + JSON.stringify(out));
  process.exit(0);
}

// ---- 1a. Refunds (H1): only a refund the shop says it HAS made --------------------------------------------------------
{
  const upd = (subject, body) => parseReturnUpdateEmail(mail(SHOP, subject, "Hi Sam,\n\n" + body + "\n\nOrder number: KO-1001\n\nKestrel Outdoor"));
  const notRefunded = [
    ["Your refund", "Unfortunately your refund has been declined because the item was worn."],
    ["Your refund", "Unfortunately we are unable to process your refund."],
    ["Your refund", "Your refund of £20.00 is pending while we inspect your return."],
    ["Your refund", "Your refund request has been sent to our returns team."],
    ["Your refund", "We could not refund your order because the return window has closed."],
    ["Your refund", "Your refund has not been processed yet."],
    ["Your refund", "Details of the refund for the items you sent back are below. Estimated refund: £20.00."],
    ["Refund confirmation", "We have declined your refund. The item was returned outside the 28 days."],
    ["About your refund", "Your refund is processed within 5 working days of your return reaching us."],
    ["Your refund for order KO-1001", "Your refund has been rejected. Your refund has been processed by our team and turned down."],
  ];
  for (const [subject, body] of notRefunded) {
    const r = upd(subject, body);
    assert.notEqual(r.stage, "refunded", `"${body}" is not a refund made (read as ${JSON.stringify({ ok: r.ok, stage: r.stage })})`);
    assert.notEqual(r.stage, "received", `"${body}" does not say the shop has the return`);
  }
  // Received, with a refund still to come: the return is received, the refund is not made.
  let r = upd("We've received your return", "We've received your return. Your refund is being processed and should be with you in 5 days.");
  assert.deepEqual([r.ok, r.stage, r.amountPence], [true, "received", null], "received, and no refund yet");
  r = upd("Your return has been registered", "We have received your return request and emailed you a label.");
  assert.notEqual(r.stage, "received", "a return request received is not the parcel received");
  // A refund under way: kept, but as "refunding", which is never a refund made.
  r = upd("Your refund for order KO-1001", "We are writing to confirm that we are processing your refund in the amount of £84.00 for your order KO-1001.");
  assert.deepEqual([r.ok, r.stage], [true, "refunding"], "a refund being processed is under way, not made");
  r = upd("We're refunding your booking", "Your refund is being credited back to the account used to make the purchase. This is normally completed within 5 working days.");
  assert.deepEqual([r.ok, r.stage], [true, "refunding"]);
  r = upd("Your refund", "We're refunding your order, but unfortunately we are unable to process your refund to the original card.");
  assert.notEqual(r.stage, "refunded"); assert.notEqual(r.stage, "refunding", "a refund the shop says it can't make is not under way either");
  // Refunds the shop says it has made still read.
  for (const [subject, body, pence] of [
    ["Your refund has been processed", "Your refund of £20.00 has been processed.", 2000],
    ["Your refund", "We've refunded £20.00 to your original payment method.", 2000],
    ["Your refund for order KO-1001", "We have issued your refund. Amount refunded: £20.00", 2000],
    ["Refund processed", "Your refund of £35.50 to your Visa ending 4242 has been issued.", 3550],
    ["Your refund is on its way", "Your refund of £12.00 is on its way.", 1200],
    ["Your return has been processed", "Good news. Your order has been refunded. Total refunded: £8.99", 899],
  ]) {
    r = upd(subject, body);
    assert.deepEqual([r.ok, r.stage, r.amountPence], [true, "refunded", pence], `"${body}" is a refund made`);
  }
  console.log("ok - a refund declined, refused, pending, requested or still being processed is never read as refunded; one under way is kept apart; refunds made still read");
}

// ---- 1b. Deliveries (H2): only a parcel the email says HAS been delivered; a carrier only by its address -------------
{
  const del = (from, subject, body) => parseDeliveryEmail(mail(from, subject, body));
  let d = del("Evri <noreply@evri.com>", "Your parcel is on its way", "Your Kestrel Outdoor parcel is on its way.\n\nWe'll email you again when it's been delivered.\n\nTracking number: H01HYA0012345678");
  assert.deepEqual([d.ok, d.status], [true, "in_transit"], "a promise to say when it's delivered is not a delivery");
  d = del("DPD <noreply@dpd.co.uk>", "Your parcel is on its way", "Your parcel is on its way.\n\nWe'll send you a photo once your parcel has been delivered.");
  assert.notEqual(d.status, "delivered");
  d = del("Royal Mail <no-reply@royalmail.com>", "An update on your parcel", "Sorry, your parcel has not been delivered. We'll try again tomorrow.");
  assert.notEqual(d.status, "delivered", "not delivered is not delivered");
  d = del("Evri <noreply@evri.com>", "Your parcel has been delivered", "Your parcel from Kestrel Outdoor has been delivered.\n\nTracking number: H01HYA0012345678");
  assert.deepEqual([d.status, d.carrier, d.trackingNumber], ["delivered", "Evri", "H01HYA0012345678"], "a delivery said to have happened still reads");
  d = del("Royal Mail <no-reply@royalmail.com>", "Delivered: your parcel", "We delivered your parcel today.");
  assert.equal(d.status, "delivered");
  // A display name is not a carrier's address (H4).
  d = del('"royalmail.com tracking" <news@elsewhere.example>', "Your parcel", "Your parcel is on its way.\n\nTracking number: KO123456789GB");
  assert.equal(d.ok, false, "an email that only calls itself royalmail.com in its name is not from Royal Mail");
  d = del('"Royal Mail" <tracking@royalmail.com.elsewhere.example>', "Your parcel", "Your parcel is on its way.");
  assert.equal(d.ok, false, "nor one from an address that only starts like Royal Mail's");
  d = del("Royal Mail <tracking@mail.royalmail.com>", "Your parcel", "Your parcel is on its way.");
  assert.deepEqual([d.ok, d.status, d.carrier], [true, "in_transit", "Royal Mail"], "Royal Mail's own address, also under a sub-name");
  console.log("ok - 'when it's been delivered' and 'has not been delivered' are not deliveries; a carrier is known by its address, never a display name");
}

// ---- 1c. Return parcels (H3, M2): a label sent or a replacement on its way is not the return on its way ---------------
{
  const par = (from, subject, body) => parseReturnParcelEmail(mail(from, subject, body));
  for (const [subject, body] of [
    ["Your return label has been sent", "We've emailed your returns label for order KO-1001. Print it and attach it to your parcel."],
    ["Your return: a replacement is on its way", "Thanks for returning your jacket. Your replacement is on its way to you."],
    ["Your return QR code has been sent", "Show this code at the Post Office."],
    ["Your returned item is on its way back to you", "We couldn't accept your return, so we have posted it back."],
    ["Your return: your refund is on its way", "We've started your refund for order KO-1001."],
    ["Once your return is on its way we'll email you", "Here is how to send it back."],
  ]) {
    const r = par(SHOP, subject, body);
    assert.equal(r.ok, false, `a shop's "${subject}" does not say the return parcel is on its way (read as ${r.stage})`);
  }
  let r = par(SHOP, "Your return is on its way to us", "Thanks, we can see your return for order KO-1001 is on its way back to us.");
  assert.deepEqual([r.ok, r.stage, r.fromCarrier, r.orderRef], [true, "sent", false, "KO-1001"], "a shop saying the return is on its way still reads");
  r = par(SHOP, "Your return has been dropped off", "Your return for order KO-1001 has been dropped off.");
  assert.deepEqual([r.ok, r.stage], [true, "sent"]);
  // A carrier's delivery TO the shopper, with a line about returns at the bottom, is not a return (M2).
  const evri = "Evri <noreply@evri.com>";
  r = par(evri, "We've delivered your parcel", "We've delivered your Kestrel Outdoor parcel.\n\nTracking number: H01HYA0012345678\n\nReturning an item? Book your return online.");
  assert.equal(r.ok, false, "a delivery with a returns footer is not a return parcel (read as " + r.stage + ")");
  let c = classifyEmail(mail(evri, "We've delivered your parcel", "We've delivered your Kestrel Outdoor parcel.\n\nTracking number: H01HYA0012345678\n\nReturning an item? Book your return online."), {}, false).details;
  assert.deepEqual([c.kind, c.status], ["delivery_update", "delivered"], "it is the purchase's delivery");
  r = par(evri, "Your parcel is on its way", "Your parcel from Kestrel Outdoor is on its way to you.\n\nNeed to send something back? Start your return here.");
  assert.equal(r.ok, false);
  r = par(evri, "Your parcel has been delivered", "Your parcel has been delivered to your safe place.\n\nYour return options: book your return online.");
  assert.equal(r.ok, false);
  r = par(evri, "Your return label is ready", "Your label has been sent to your email. Once you've dropped off your parcel we'll email you.");
  assert.deepEqual([r.ok, r.stage], [true, "started"], "a label is a return started, never sent");
  // A carrier's own return emails still read.
  r = par(evri, "Thanks for dropping off your return", "Thanks for dropping off your parcel. Your return to Kestrel Outdoor is on its way.\n\nTracking number: H01HYA0012345678");
  assert.deepEqual([r.ok, r.stage, r.fromCarrier, r.shop, r.trackingNumber], [true, "sent", true, "Kestrel Outdoor", "H01HYA0012345678"]);
  r = par("Royal Mail <no-reply@royalmail.com>", "Your return has been delivered", "Your return to Kestrel Outdoor has been delivered.\n\nTracking number: KO123456789GB");
  assert.deepEqual([r.ok, r.stage, r.fromCarrier], [true, "received", true]);
  r = par("Royal Mail <no-reply@royalmail.com>", "An update on your parcel", "Your parcel has been delivered to the retailer.\n\nThis is your return parcel KO123456789GB.");
  assert.deepEqual([r.ok, r.stage], [true, "received"], "delivered to the retailer, in an email about the return");
  console.log("ok - a label sent, a replacement or a refund on its way, and a delivery with a returns footer are never the return parcel on its way or received");
}

// ---- 1d. A tracking number the shopper typed (H4): only news that fits a parcel going back after they sent it --------
{
  const TODAY = "2026-11-25", ago = (n) => new Date(Date.parse(TODAY) - n * 864e5).toISOString().slice(0, 10);
  const kestrel = { name: "Kestrel Outdoor", domain: "kestreloutdoor.example" };
  const order = () => ({ id: "a", retailer: kestrel, orderRef: "KO-1001", orderDate: ago(20), totalPence: 8900, currency: "GBP", items: [{ name: "Thing", qty: 1, pricePence: 8900 }] });
  const typed = [{ receipt_id: "a", tracking_number: "KO123456789GB", carrier: "Royal Mail", sent_on: ago(3) }];
  const run = (extra) => { const a = order(); attachReturnTracking([a], { today: TODAY, typed, ...extra }); return a; };
  const none = (a, why) => assert.deepEqual([a.returnReceived, a.returnInTransit, a.returnTracking.onItsWay], [false, false, null], why);
  // The number of a parcel that was coming TO the shopper: the carrier's ordinary delivery email.
  none(run({ deliveries: [{ kind: "delivery_update", status: "delivered", carrier: "Royal Mail", trackingNumber: "KO123456789GB", merchant: "Larkspur Candles", at: ago(1) }] }), "a parcel from a shop delivered to the shopper is not their return received");
  none(run({ deliveries: [{ kind: "delivery_update", status: "delivered", carrier: "Royal Mail", trackingNumber: "KO123456789GB", at: ago(1) }] }), "nor a carrier's delivery email that doesn't say where the parcel was going");
  none(run({ deliveries: [{ kind: "delivery_update", status: "in_transit", carrier: "Royal Mail", trackingNumber: "KO123456789GB", at: ago(1) }] }), "nor its 'on its way'");
  // Carrier tracking: only a first scan on or after the day they said they sent it.
  none(run({ tracked: [{ tracking_number: "KO123456789GB", status: "delivered", at: ago(5), first_scan: ago(8) + "T09:00:00" }] }), "a parcel scanned before the shopper said they sent it is not this return");
  none(run({ tracked: [{ tracking_number: "KO123456789GB", status: "in_transit", at: ago(1) }] }), "tracking with no first scan to check by confirms nothing for a typed number");
  let a = run({ tracked: [{ tracking_number: "KO123456789GB", status: "in_transit", at: ago(1), first_scan: ago(3) + "T15:20:00" }] });
  assert.deepEqual([a.returnInTransit, a.returnTracking.onItsWay && a.returnTracking.onItsWay.via], [true, "tracking"], "scanned on the day they sent it: on its way, on the carrier's tracking");
  // The carrier's own RETURN emails for that number.
  none(run({ updates: [{ kind: "return_update", stage: "received", fromCarrier: true, carrier: "Royal Mail", trackingNumber: "KO123456789GB", at: ago(6) }] }), "a carrier's return news dated before the shopper sent it is someone else's parcel");
  none(run({ updates: [{ kind: "return_update", stage: "received", fromCarrier: true, carrier: "Royal Mail", trackingNumber: "KO123456789GB", shopNamed: "Larkspur Candles", at: ago(1) }] }), "nor one going back to another shop");
  a = run({ updates: [{ kind: "return_update", stage: "received", fromCarrier: true, carrier: "Royal Mail", trackingNumber: "KO123456789GB", shopNamed: "Kestrel Outdoor", at: ago(1) }] });
  assert.deepEqual([a.returnReceived, a.returnTracking.steps[2].from.by], [true, "carrier"], "a carrier's own 'your return to Kestrel Outdoor has been delivered' after it was sent still counts");
  console.log("ok - a tracking number the shopper typed: a parcel coming to them, news from before they sent it, or a return to another shop never confirms their return");
}

// ---- 3a. The return deadline comes from the sentence about sending it back (M1) ---------------------------------------
{
  const ret = (body) => parseReturnEmail(mail(SHOP, "Thanks for your return request", "Thanks for your return request.\n\nReturn ID: KR-778812\nOrder number: KO-1001\n\n" + body));
  assert.equal(ret("We'll send you a label by 5 December 2026. Please send it back no later than 20 December 2026.").deadline, "2026-12-20", "the shop's promise of a label is not the deadline");
  assert.equal(ret("We'll send you a label by 5 December 2026. Please send it back by 20 December 2026.").deadline, "2026-12-20");
  assert.equal(ret("Your refund will be with you by 28 December 2026 once we have your return. Send your parcel back by 12 December 2026.").deadline, "2026-12-12");
  assert.equal(ret("Our courier will collect your return by 3 December 2026.").deadline, null, "a collection day the shop promises is not a deadline");
  assert.equal(ret("Please send it back no later than Wednesday, December 24.").deadline, "2026-12-24", "as before");
  assert.equal(ret("Send it back by 20 December 2026. Returns must reach us on or before 18 December 2026.").deadline, "2026-12-18", "the firmer wording leads");
  console.log("ok - the return deadline is read from the sentence about sending it back, never from the shop's promise of a label, a collection or a refund");
}

// ---- 3b. Pence written with one figure (M3) --------------------------------------------------------------------------
{
  const ld = (price, item) => `<script type="application/ld+json">${JSON.stringify({ "@context": "http://schema.org", "@type": "Order", merchant: { "@type": "Organization", name: "Kestrel Outdoor" }, seller: { "@type": "Organization", name: "Kestrel Outdoor" }, orderNumber: "KO-1001", priceCurrency: "GBP", price,
    orderDate: "2026-11-23", acceptedOffer: [{ "@type": "Offer", itemOffered: { "@type": "Product", name: "Trail Flask" }, price: item, priceCurrency: "GBP", eligibleQuantity: { "@type": "QuantitativeValue", value: 1 } }] })}</script>`;
  const read = (price, item) => parseReceiptEmail(mail("Kestrel Outdoor <orders@kestreloutdoor.example>", "Your order KO-1001 is confirmed", `<html><head>${ld(price, item)}</head><body><p>Thanks for your order, Sam.</p><p>Order number: KO-1001</p><table><tr><td>Trail Flask</td><td>Qty 1</td></tr></table><p>Paid by card. We'll email you when it ships.</p></body></html>`, { html: true }));
  let r = read(12.5, 12.5);
  assert.deepEqual([r.ok, r.totalPence, r.items[0].pricePence], [true, 1250, 1250], "12.5 as a number is £12.50, not £12.00");
  r = read("19.9", "19.9");
  assert.deepEqual([r.totalPence, r.items[0].pricePence], [1990, 1990], "\"19.9\" is £19.90");
  r = read(1234.5, 1234.5);
  assert.equal(r.totalPence, 123450);
  r = read("1,184.36", "24.00");
  assert.deepEqual([r.totalPence, r.items[0].pricePence], [118436, 2400], "as before");
  console.log("ok - a price with one figure of pence keeps its pence");
}

// ---- 3c. A pasted email's date is read day first (M4) ----------------------------------------------------------------
{
  const dateOf = (text, now) => new Date((/^Date:\s*(.+)$/im.exec(pastedAsEmail(text, Date.parse(now))) || [, "none"])[1]);
  const body = "\n\nThanks for your order KO-1001.\n\nTrail Flask  £12.50\nTotal  £12.50\n";
  // Copied from a mail app: the subject, then the sender and when it was sent.
  let d = dateOf("Your order KO-1001\nFrom: Kestrel Outdoor <orders@kestreloutdoor.example>\nSent: 03/04/2026 10:15\nTo: Sam Taylor" + body, "2026-04-20T12:00:00Z");
  assert.equal(Number.isNaN(d.getTime()) ? "no date" : d.toISOString().slice(0, 10), "2026-04-03", "\"Sent: 03/04/2026\" in a UK paste is 3 April, not 4 March");
  d = dateOf("Your order KO-1002\nFrom: Kestrel Outdoor <orders@kestreloutdoor.example>\nSent: 25/12/2025 09:00\nTo: Sam Taylor" + body, "2026-01-20T12:00:00Z");
  assert.equal(Number.isNaN(d.getTime()) ? "no date" : d.toISOString().slice(0, 10), "2025-12-25", "a day past the 12th is read too (it used to give no date at all)");
  d = dateOf("Your order KO-1003\nKestrel Outdoor <orders@kestreloutdoor.example>\n03/04/2026, 10:15" + body, "2026-04-20T12:00:00Z");
  assert.equal(Number.isNaN(d.getTime()) ? "no date" : d.toISOString().slice(0, 10), "2026-04-03", "the same under the sender's line");
  d = dateOf("From: Kestrel Outdoor <orders@kestreloutdoor.example>\nSent: 03/04/2026 10:15\nTo: Sam Taylor\nSubject: Your order KO-1004" + body, "2026-04-20T12:00:00Z");
  assert.equal(Number.isNaN(d.getTime()) ? "no date" : d.toISOString().slice(0, 10), "2026-04-03", "and when the copy starts with From:");
  d = dateOf("Your order KO-1005\nFrom: Kestrel Outdoor <orders@kestreloutdoor.example>\nSent: 04/25/2026 10:15" + body, "2026-05-20T12:00:00Z");
  assert.equal(Number.isNaN(d.getTime()) ? "no date" : d.toISOString().slice(0, 10), "2026-04-25", "month first only when it can't be a day");
  d = dateOf("Your order KO-1006\nFrom: Kestrel Outdoor <orders@kestreloutdoor.example>\nSent: Monday, 23 November 2026 10:00" + body, "2026-11-24T12:00:00Z");
  assert.equal(Number.isNaN(d.getTime()) ? "no date" : d.toISOString().slice(0, 10), "2026-11-23", "a date written out reads as before");
  d = dateOf("Your order KO-1007\nFrom: Kestrel Outdoor <orders@kestreloutdoor.example>\nSent: 31/02/2026 10:00" + body, "2026-11-24T12:00:00Z");
  assert.ok(Number.isNaN(d.getTime()), "a day that doesn't exist gives no date, never a guess");
  console.log("ok - a pasted email's 03/04/2026 is 3 April");
}

// ---- 3d. A table's label is never an item's name (On, seen on the owner's phone 25 Nov 2026) ------------------------
// An On order of three things showed "In this return: ORDER DATE (Black, Size: 10.5, Cloudsurfer Trail 2 Waterproof)": the
// order's facts sit in a table of labels and values ("ORDER NUMBER | ON-…", "ORDER DATE | 23 Nov 2026") straight above the
// first item, and "ORDER DATE" was read as that item's name, with its real name pushed into its details. Made-up email in
// that shape (every name, number and price made up).
{
  const item = (n, col, size, p) => `<tr><td width="120"><img src="https://images.on-shop.example/${encodeURIComponent(n)}.jpg" alt="" width="110"></td><td><p style="font-weight:bold">${n}</p><p>${col}</p><p>Size: ${size}</p><p>Qty: 1</p></td><td align="right">&pound;${p}</td></tr>`;
  const items = item("Cloudsurfer Trail 2 Waterproof", "Black", "10.5", "160.00") + item("Cloudboom Max", "Black", "10.5", "190.00") + item("Performance Run Sock", "White", "M", "20.00");
  const heads = {
    "a table of labels beside their values": `<table><tr><td>ORDER NUMBER</td><td>ON-77120394</td></tr><tr><td>ORDER DATE</td><td>23 Nov 2026</td></tr></table>`,
    "a label over its value": `<table><tr><td>ORDER DATE</td></tr><tr><td>23.11.2026</td></tr></table>`,
    "a label alone": `<p>ORDER NUMBER</p><p>ON-77120394</p><p>ORDER DATE</p>`,
    "money labels over the list": `<table><tr><td>SUBTOTAL</td><td>DELIVERY</td></tr></table>`,
  };
  for (const [what, head] of Object.entries(heads)) {
    const html = `<html><body><h1>Thanks for your order, Sam</h1><p>We're getting your order ready.</p>${head}<table>${items}</table><table><tr><td>Subtotal</td><td>&pound;370.00</td></tr><tr><td>Delivery</td><td>&pound;0.00</td></tr><tr><td>Total</td><td>&pound;370.00</td></tr></table></body></html>`;
    const d = classifyEmail(mail("On <noreply@on-shop.example>", "Thanks for your order ON-77120394", html, { html: true }), {}, false).details;
    assert.equal(d.kind, "receipt", what);
    assert.deepEqual(d.items.map((i) => [i.name, i.variant, i.pricePence]), [["Cloudsurfer Trail 2 Waterproof", "Black, Size: 10.5", 16000], ["Cloudboom Max", "Black, Size: 10.5", 19000], ["Performance Run Sock", "White, Size: M", 2000]],
      `${what}: each item under its own name, never "ORDER DATE", "ORDER NUMBER", "SUBTOTAL" or "DELIVERY", and no label in its details`);
    assert.equal(d.totalPence, 37000);
  }
  console.log("ok - an On-style order: ORDER DATE, ORDER NUMBER, SUBTOTAL and DELIVERY are never an item's name or details; each item keeps its own name");
}

// ---- 3e. "Send this email to Relay" and the AI hide more, and quickly (M10) ------------------------------------------
{
  const r = hideDetails("Your order for Jess Smith is on its way.\nIt will be delivered to Sam Taylor on Friday.\nCall us on +1 415 555 2671 or +33 1 42 68 53 00.\nTrack it at kestrel.example/track?t=abc123\nOrder KO-1001: Trail Flask £12.50\nVisit Kestrel.example for more.");
  assert.ok(!/Jess|Smith|Sam|Taylor/.test(r.text), "a name mid-line after 'order for' or 'delivered to' is hidden: " + r.text);
  assert.ok(!/415|42 68/.test(r.text), "phone numbers outside the UK are hidden: " + r.text);
  assert.ok(!/track\?t=abc123/.test(r.text), "a web address with no http or www is hidden: " + r.text);
  assert.ok(/Order KO-1001: Trail Flask £12\.50/.test(r.text) && /Kestrel\.example/.test(r.text), "the order itself, and a shop's name with a dot, stay: " + r.text);
  for (const [what, s] of [["40,000 characters of a.a.a.", "a.".repeat(20000)], ["40,000 blank lines", "\n".repeat(40000)], ["40,000 spaces", " ".repeat(40000)]]) {
    const t = Date.now(); hideDetails(s); const ms = Date.now() - t;
    assert.ok(ms < 300, `${what} are gone through in a moment (${ms} ms; it was about a second each)`);
  }
  console.log("ok - names mid-line, phone numbers abroad and bare web addresses are hidden before an email is shared or read by the AI, and quickly");
}

// ---- 3f. UK law's 14 days are never worked out for a purchase made in a shop (M5) ------------------------------------
{
  const till = classifyEmail(mail("Kestrel Outdoor <receipts@kestreloutdoor.example>", "Your receipt from Kestrel Outdoor", "Thank you for shopping at our store.\n\nReceipt number: 4471-0093\nDate: 20 November 2026\nServed by: Priya\nTill 4\n\nTrail Flask  £12.50\nWool Hat  £15.00\n\nTotal  £27.50\nPaid by card\n"), {}, false).details;
  assert.deepEqual([till.kind, till.inStore], ["receipt", true], "a till receipt is marked as bought in a shop");
  assert.equal(estimateReturnBy(till, "2026-11-25"), null, "so no 'return by' from UK law's 14 days (they cover buying online)");
  const online = classifyEmail(mail("Kestrel Outdoor <orders@kestreloutdoor.example>", "Your order KO-1001 is confirmed", "Thanks for your order.\n\nOrder number: KO-1001\nOrder date: 20 November 2026\n\nTrail Flask - Qty 1 - £12.50\n\nOrder total: £12.50\n"), {}, false).details;
  assert.equal(online.inStore, undefined);
  assert.equal((estimateReturnBy(online, "2026-11-25") || {}).basis, "uk_law", "an online order still gets the law's 14 days, marked as an estimate");
  console.log("ok - a purchase made in a shop never gets UK law's 14 days; an online order still does");
}

// ---- 2. Emails built to be slow are read quickly (H5) ----------------------------------------------------------------
{
  const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "slow"], { encoding: "utf8", timeout: 240000 });
  const last = (run.stdout || "").trim().split("\n").filter((l) => !l.startsWith("RESULT")).pop();
  assert.equal(run.error, undefined, "every shape is read within four minutes in all (540 KB of unclosed <style> used to take over a minute on its own); last one finished: " + last);
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(((run.stdout || "").split("\n").find((l) => l.startsWith("RESULT ")) || "RESULT {}").slice(7));
  assert.ok(Object.keys(result).length >= 20, "every shape was read");
  // Well under a second on the review's machine was 14.5 s; the bar is 2.5 s so a slow test machine never fails by chance.
  for (const [unit, r] of Object.entries(result)) assert.ok(r.ms < 2500, `540 KB of ${JSON.stringify(unit)} is read in well under a second on an ordinary machine (${r.ms} ms as ${r.what})`);
  const worst = Object.entries(result).sort((a, b) => b[1].ms - a[1].ms)[0];
  console.log(`ok - ${Object.keys(result).length} shapes of 540 KB that never close their tags, each read as five kinds of email: the slowest took ${worst[1].ms} ms (${JSON.stringify(worst[0])})`);
}

console.log("PASS reader review: nothing refused, promised or under way is read as done; emails built to be slow are read quickly; pence, pasted dates and return deadlines read right");
