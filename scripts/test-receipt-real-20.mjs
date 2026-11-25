// Round 20 (20 Nov 2026): a full search of a real Outlook inbox found refunds Relay didn't show and purchases it missed. A
// takeaway app's receipt sent again after a refund ("We’ve updated your receipt for …") and a ride's changed fare were read as
// "not a receipt", so the order kept its full total; two orders of the same total from one restaurant on one evening could
// not be told apart; a supermarket's refund for a few items of a purchase it named by number was never joined; an order that
// couldn't be delivered, and a failed collection, showed as £0.00 purchases; and till receipts sent by e-receipt platforms,
// a card platform's payment, subscriptions bought that day, a purchase confirmed with its cost, a pre-order and a receipt
// sent as an attachment were missed. Every email here is MADE UP (scripts/fixtures/receipt-emails/holdout21.mjs): shops,
// restaurants, items, prices, people, numbers and times.
//
// Above all: an email Relay keeps as money back on an order always shows on that order in the receipts list (GET
// /relay/my/receipts?all=1, read through Relay's own scan from a stand-in inbox), with the refund and the new total, never the
// order's full total alone, and never as a purchase of its own.
//   node scripts/test-receipt-real-20.mjs
import assert from "node:assert/strict";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { classifyEmail, ukLocalMs } from "../worker/gmail.js";
import { uberEmail, tillEReceipt, pcsOrder, eReceiptPlatform, subscriptionStarted, supportRefund } from "../worker/receipt-senders.js";
import { rawEmail, page, h } from "./fixtures/receipt-emails/lib.mjs";
import holdout21, { EATS } from "./fixtures/receipt-emails/holdout21.mjs";
import holdout16b from "./fixtures/receipt-emails/holdout16b.mjs";
import { realInbox } from "./real-receipts.mjs";

const fx = Object.fromEntries([...holdout21(), ...holdout16b()].map((f) => [f.id, f]));
const raw = (id) => rawEmail(fx[id]);
const rowsHtml = (lines) => page({ brand: "Uber", domain: "uber.com", rows: [`<table>${lines.map((l) => `<tr>${String(l).split(" | ").map((c) => `<td>${h(c).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("\n")}</table>`] });
const mk = (from, subject, date, body, html = false) => `From: ${from}\r\nTo: sam.taylor@example.co.uk\r\nSubject: ${subject}\r\nDate: ${date}\r\nMIME-Version: 1.0\r\nContent-Type: text/${html ? "html" : "plain"}; charset=utf-8\r\n\r\n${body}`;
const eats = (e) => mk(e.from, e.subject, e.date, rowsHtml(e.lines), true);

// 1. Money back on an order is never a purchase, and is read as money back.
{
  const upd = classifyEmail(raw("holdout21-eats-updated-after-refund")).details;
  assert.equal(upd.kind, "order_update"); assert.equal(upd.stage, "adjusted");
  assert.deepEqual([upd.merchant, upd.amountPence, upd.previousTotalPence, upd.newTotalPence, upd.paidAt], ["Noodle Yard (Riverside)", 625, 1940, 1315, "2026-05-14T19:05"]);
  const ride = classifyEmail(raw("holdout21-ride-fare-adjusted")).details;
  assert.deepEqual([ride.kind, ride.stage, ride.retailer.name, ride.amountPence, ride.newTotalPence], ["order_update", "adjusted", "Uber", 840, 0], "a ride's changed fare is the ride's");
  const grocer = classifyEmail(raw("holdout21-grocer-item-refund")).details;
  assert.deepEqual([grocer.kind, grocer.stage, grocer.amountPence, grocer.orderRef, grocer.bySupport], ["order_update", "adjusted", 270, "1234-5678-90", true], "the refunded items' amount, for the purchase the subject names");
  for (const id of ["holdout21-eats-not-delivered-zero", "holdout21-collection-failed", "holdout21-subscription-trial-later"]) {
    const c = classifyEmail(raw(id));
    assert.equal(c.status, "not_receipt", id + " is not a purchase");
  }
  // (An Eats order that couldn't be delivered but was still charged is still the order.)
  const charged = eats({ ...EATS.first, lines: EATS.first.lines.map((l) => (l === "Thanks for ordering, Sam" ? "Your order from Noodle Yard (Riverside) could not be delivered." : l)) });
  assert.equal(classifyEmail(charged).details.totalPence, 1940, "an undelivered order that was charged stays a purchase");
  console.log("ok - a receipt sent again after a refund, a ride's changed fare and an item refund are money back; an undelivered £0 order, a failed collection and a trial are not purchases");
}

// 2. Purchases that were missed.
{
  const want = {
    "holdout21-ecrebo-till-ereceipt": ["Homewares Co", 6650, 5],
    "holdout21-yreceipts-picture": ["Tailor & Co", null, 0],
    "holdout21-meandu-view-receipt": ["Wine Bar Riverside", null, 0],
    "holdout21-orderyoyo-pcs-name-total": ["Spice House", 2344, 4],
    "holdout21-viva-successful-payment": ["Cloud Shop", 2140, 0],
    "holdout21-subscription-processed": ["Gamebox", 949, 1],
    "holdout21-subscription-started-today": ["StreamBox", 749, 1],
    "holdout21-plan-purchase-cost": ["Skyport Wi-Fi", 400, 1],
    "holdout21-preorder-no-price": ["Harbour Brewing", null, 1],
    "holdout21-store-receipt-attachment": [null, null, 0],
  };
  for (const [id, [shop, total, n]] of Object.entries(want)) {
    const c = classifyEmail(raw(id));
    assert.equal(c.details.kind, "receipt", id + " is a purchase");
    if (shop) assert.equal(c.details.retailer.name, shop, id);
    assert.equal(c.details.totalPence, total, id + " total");
    assert.equal(c.details.items.length, n, id + " items");
    // (Nothing made up: no total and no price where the email gives none, and the list is never said to be complete.)
    if (total == null) assert.notEqual(c.details.itemsCheck && c.details.itemsCheck.complete, true, id + " is not said to be complete");
  }
  const till = classifyEmail(raw("holdout21-ecrebo-till-ereceipt")).details;
  assert.deepEqual(till.items.map((i) => [i.name, i.qty, i.pricePence, Boolean(i.lineTotal)]).slice(0, 2), [["Steel Mop Bucket", 1, 1800, false], ["Linen Napkins Set of 4", 2, 1200, true]]);
  assert.equal(till.retailer.via, "homewares-prod.ecrebo.com", "the platform that sent it");
  const yoyo = classifyEmail(raw("holdout21-orderyoyo-pcs-name-total")).details;
  assert.deepEqual(yoyo.items[0], { name: "Paneer Tikka Masala", qty: 1, pricePence: 850, variant: "Paneer" });
  assert.deepEqual([yoyo.fees.map((f) => f.pence), yoyo.discounts.map((d) => d.pence), yoyo.itemsCheck.complete], [[250, 10, 50], [226], true]);
  assert.equal(classifyEmail(raw("holdout21-yreceipts-picture")).details.detailsInAttachment, "image", "a receipt that is a picture says so");
  assert.equal(classifyEmail(raw("holdout21-store-receipt-attachment")).details.detailsInAttachment, "pdf");
  assert.equal(classifyEmail(raw("holdout21-viva-successful-payment")).details.itemsCheck.noItemList, true, "a card platform's payment names no things, and says so");
  // (A payment request from the same platform, "Payment Notification", is not a payment.)
  const request = mk("Viva Wallet <no-reply@vivawallet.com>", "Payment Notification from: Example Trading Ltd", "Mon, 10 Oct 2022 19:40:00 +0000",
    "Payment Info\nRequested by | Example Trading Ltd\nDescription | Cloud Shop\nExpires on | 10/10/2022 23:00:00\nAmount | £21.40\nPay\n");
  assert.equal(classifyEmail(request).status, "not_receipt", "a request to pay is not a payment");
  console.log("ok - platform e-receipts, a takeaway's own ordering page, a card platform's payment, subscriptions, a purchase with its cost, a pre-order and an attached till receipt are purchases, with nothing made up");
}

// 3. Every refund Relay keeps shows on its order in the receipts list (through Relay's own scan and list).
{
  const inbox = await realInbox({ now: Date.UTC(2026, 5, 20, 12) }).start();
  const railBooking = mk("Railwise <auto-confirm@info.railwise.example>", "Your booking confirmation", "Thu, 12 Nov 2026 18:00:00 +0000",
    "Thanks for booking with Railwise.\nTransaction ID: 730118264590\nLeeds to York\nAdvance Single\n1 Adult\nTicket price £6.40\nTotal paid £6.40\n");
  const ride = mk("Uber Receipts <noreply@uber.com>", "Your Saturday morning trip with Uber", "Sat, 16 May 2026 01:15:00 +0000",
    rowsHtml(["Total\n£8.40\n16 May 2026", "Thanks for riding, Sam", "We hope you enjoyed your Uber trip this morning.", "Total | £8.40", "Trip fare | £8.40", "Subtotal | £8.40", "Payments", "Visa ••••1111", "16/05/2026 02:10", "£8.40"]), true);
  const groceries = mk("Greengrocer <no-reply@mail.greengrocer.example>", "Your Greengrocer order 1234-5678-90", "Sun, 07 Jun 2026 08:00:00 +0000",
    "Thanks for your order.\nOrder number: 1234-5678-90\n\n3 x Example Dairy Strawberry Yoghurt 150g £2.70\n1 x Sourdough Loaf £2.50\n\nTotal £5.20\n");
  const mails = [eats(EATS.first), eats(EATS.second), eats(EATS.firstUpdated), eats(EATS.secondUpdated), ride, raw("holdout21-ride-fare-adjusted"), groceries, raw("holdout21-grocer-item-refund")];
  for (const m of mails) inbox.deliver(m);
  await inbox.scan();
  // (The railway's refund belongs to a booking stored in another round of the scan: delivered after.)
  const inbox2 = await realInbox({ now: Date.UTC(2026, 10, 19, 12) }).start();
  inbox2.deliver(railBooking); inbox2.deliver(raw("holdout16b-rail-refund-by-transaction"));
  await inbox2.scan();
  for (const box of [inbox, inbox2]) {
    const cards = (await box.receipts()).receipts;
    const ids = new Set(cards.map((c) => c.id));
    const shown = (c) => (c.adjusted && c.adjusted.refundPence > 0) || (c.returnProgress && c.returnProgress.refundPence > 0) || (c.returnTracking && c.returnTracking.state === "refunded");
    const money = box.stored().filter((r) => r.status !== "not_receipt" && r.status !== "dismissed" && ((r.details.kind === "order_update" && r.details.stage === "adjusted") || (r.details.kind === "return_update" && r.details.stage === "refunded")));
    // (Review, 25 Nov 2026: the railway's "Your refund is being credited back … normally completed within 5 working days" is now
    // a refund under way ("refunding"), not one made, so inbox2 has no money-back email that says it was paid; it must still
    // never be a card of its own, and its order must not show it as refunded.)
    const underWay = box.stored().filter((r) => r.details.kind === "return_update" && r.details.stage === "refunding");
    for (const r of underWay) {
      assert.ok(!ids.has(r.id), "a refund under way is never a card of its own");
      assert.ok(!cards.some((c) => c.orderRef && String(c.orderRef).toUpperCase() === String(r.details.orderRef || "").toUpperCase() && shown(c)), "and its order does not show it as refunded");
    }
    assert.ok(money.length >= 1 || (box === inbox2 && underWay.length === 1));
    for (const r of money) {
      assert.ok(!ids.has(r.id), "money back is never a card of its own: " + JSON.stringify(r.details).slice(0, 160));
      // (The order it is for shows it.)
      const d = r.details;
      const mine = cards.filter((c) => shown(c) && ((d.orderRef && c.orderRef && String(c.orderRef).toUpperCase() === String(d.orderRef).toUpperCase()) || (d.previousTotalPence != null && c.totalPence === d.previousTotalPence)));
      assert.ok(mine.length >= 1, "the order shows the refund: " + JSON.stringify(d).slice(0, 200));
    }
    // (And no card that has a refund email keeps its full total as if nothing came back.)
    for (const c of cards) if (c.adjusted) assert.ok(Number.isInteger(c.adjusted.refundPence));
  }
  const cards = (await inbox.receipts()).receipts;
  const noodle = cards.filter((c) => c.merchant === "Noodle Yard (Riverside)").sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  assert.equal(noodle.length, 2, "two orders, two cards");
  assert.deepEqual(noodle.map((c) => [c.totalPence, c.adjusted && c.adjusted.refundPence, c.adjusted && c.adjusted.newTotalPence]), [[1940, 625, 1315], [1940, 1940, 0]],
    "each refund joins the order it was for, told apart by when each was paid");
  const rideCard = cards.find((c) => c.retailer.name === "Uber" && c.totalPence === 840);
  assert.deepEqual([rideCard.adjusted.refundPence, rideCard.adjusted.newTotalPence], [840, 0], "the ride shows its fare refunded");
  const groc = cards.find((c) => c.orderRef === "1234-5678-90");
  assert.equal(groc.adjusted.refundPence, 270, "the supermarket order shows the items refunded");
  const rail = (await inbox2.receipts()).receipts.find((c) => c.orderRef === "730118264590");
  // (Review, 25 Nov 2026: this used to assert the train booking shows a £6.40 refund. The railway's email says the refund
  // "is being credited back … normally completed within 5 working days": under way, not made, so the booking must not show
  // it as refunded. Money in at the bank for it can still be matched to the booking.)
  assert.ok(rail && !(rail.returnProgress && rail.returnProgress.refundedAt) && !(rail.returnTracking && rail.returnTracking.state === "refunded"), "the train booking does not show a refund still being credited as refunded");
  console.log("ok - every refund Relay keeps shows on its order in the receipts list, never as a purchase, and two same-total orders each get their own refund");
}

// 4. Joined to the purchase they are about: a card platform's payment and the shop's own receipt sent with it; a receipt that
// is only its attachment and the email that confirmed the purchase with its cost.
{
  const inbox = await realInbox({ now: Date.UTC(2026, 10, 19, 12) }).start();
  inbox.deliver(mk("Viva Wallet <no-reply@vivawallet.com>", "Viva Wallet: Successful Payment", "Mon, 09 Nov 2026 19:48:10 +0000", "Payment Info\nRequested by | Example Trading Ltd\nDescription | Cloud Shop\nPayment method | Card\nAmount | £21.40\n"));
  inbox.deliver(mk("Cloud Shop <orders@cloudshop.example>", "Order Confirmation: #55501 | Cloud Shop", "Mon, 09 Nov 2026 19:48:05 +0000", "Thanks for your order.\nOrder number: 55501\n1 x Mint E-liquid 10ml £21.40\nTotal £21.40\n"));
  const plan = fx["holdout21-plan-purchase-cost"];
  inbox.deliver(rawEmail({ ...plan, headers: { ...plan.headers, date: "Tue, 10 Nov 2026 05:35:00 +0000" } }));
  const att = fx["holdout21-store-receipt-attachment"];
  inbox.deliver(rawEmail({ ...att, headers: { ...att.headers, from: "Skyport Wi-Fi <no-reply@skyport-wifi.example>", subject: "Purchase Receipt", date: "Tue, 10 Nov 2026 06:03:00 +0000" },
    html: page({ brand: "Skyport Wi-Fi", domain: "skyport-wifi.example", rows: ["<p>Hi Sam,</p><p>You recently purchased Fast Wi-Fi at Terminal 2.</p><p>Please find your receipt attached to this email.</p>"] }) }));
  await inbox.scan();
  const cards = (await inbox.receipts()).receipts;
  assert.equal(cards.filter((c) => /cloud shop/i.test(c.retailer.name)).length, 1, "the platform's payment and the shop's receipt are one purchase");
  const wifi = cards.filter((c) => /skyport/i.test(c.retailer.name));
  assert.equal(wifi.length, 1, "the attached receipt joins the purchase it is for");
  assert.deepEqual([wifi[0].totalPence, wifi[0].items.map((i) => i.name)], [400, ["Fast Wi-Fi 24h"]]);
  console.log("ok - a card platform's payment joins the shop's receipt; an attachment-only receipt joins the purchase it confirms");
}

// 5. The new rules take time in step with the email, however it is written (a 40,000-character line).
{
  const long = (s) => s.repeat(Math.ceil(40000 / s.length)).slice(0, 40000);
  const lines = [long("a"), long("£ | 1"), long("We’ve updated your receipt for "), long("Quantity: 2 at £"), long("1 | x | 2.00 "), long("Requested by | "), long("Thanks for subscribing to x "), long("receipt from ")];
  for (const l of lines) {
    const t0 = Date.now();
    uberEmail("uber.com", "Your order", "Previous total\nNew Total\n" + l); tillEReceipt("Item | Price\n" + l); pcsOrder("Pcs | Name | Total\n1\n" + l); eReceiptPlatform("vivawallet.com", "Successful Payment", "x", l);
    eReceiptPlatform("yreceipts.com", "Your receipt from " + l, "x", l); eReceiptPlatform(null, null, null, l); subscriptionStarted("x", l, "2026-01-01"); supportRefund("Item refund for purchase " + l, "We've arranged a refund for the below amount.\nQty | Product | Total\n" + l);
    parseReceiptEmail(mk("Shop <a@shop.example>", "Your purchase of " + l.slice(0, 300) + " has been processed", "Mon, 02 Mar 2026 20:00:00 +0000", "We tried to collect your order\n" + l + "\nCost: 1.00 GBP\n"));
    assert.ok(Date.now() - t0 < 1500, "linear time on a 40,000-character line (" + l.slice(0, 20) + "…): " + (Date.now() - t0) + " ms");
  }
  assert.equal(ukLocalMs("2026-05-14T19:05"), Date.UTC(2026, 4, 14, 18, 5), "summer time");
  assert.equal(ukLocalMs("2026-01-14T19:05"), Date.UTC(2026, 0, 14, 19, 5), "winter time");
  console.log("ok - the new rules read a 40,000-character line in linear time");
}
console.log("PASS round 20: refunds show on their orders, no failed order is a purchase, missed purchases are read");
