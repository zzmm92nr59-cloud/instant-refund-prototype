// Made-up emails that carry a code to show or scan, and ones that look as if they do but must never be shown
// (scripts/test-scan-codes.mjs). Every shop, person, order number, code and web address here is INVENTED: the layouts are
// the kinds real shops send (a return barcode under a shipping email's in-store returns paragraph, a till receipt's own
// barcode, a drop-off QR code from a returns company or a marketplace, a QR code to collect with, tickets), nothing more.
import { page, table, gbp, h, SHOPPER } from "./receipt-emails/lib.mjs";

const mail = (id, from, subject, date, html, extra = {}) => ({ id, sender: id, layout: id, headers: { from, to: SHOPPER.email, subject, date }, html, text: "", ...extra });
const items = (rows, total) => table([...rows.map(([n, q, p]) => [h(n), "Qty " + q, gbp(p)]), ["<strong>Total</strong>", "", "<strong>" + gbp(total) + "</strong>"]]);

// ---- 1. A shop's order, then its shipping email with a barcode for returning in store ------------------------------
export const fellOrder = mail("fell-order", "Fellwear <orders@fellwear.test>", "Thanks for your order", "Tue, 27 Oct 2026 10:00:00 +0000", page({ brand: "Fellwear", domain: "fellwear.test", rows: [
  "<h1>Thanks for your order, Sam</h1>", "<p>Order number: FW20418856</p><p>Order date: 27 October 2026</p>",
  items([["Ridge Running Jacket", 1, 9800], ["Trail Shorts 7in", 1, 4800]], 14600)] }));
export const FELL_IN_STORE = "Bring your item(s) to your nearest store (excluding concessions and outlets) with the barcode below ready to be scanned by our team.";
export const FELL_RULE = "Paypal and Klarna returns cannot be accepted in store.";
export const fellShipping = mail("fell-shipping", "Fellwear <shipping@fellwear.test>", "We're shipping your Fellwear order # FW20418856", "Fri, 30 Oct 2026 08:30:00 +0000", page({ brand: "Fellwear", domain: "fellwear.test", rows: [
  "<h1>Your gear is on its way</h1>", "<p>Hi Sam, your order FW20418856 has left our warehouse.</p>",
  "<p><strong>Ridge Running Jacket</strong><br />Size M</p><p><strong>Trail Shorts 7in</strong><br />Size M</p>",
  "<h2>Returns</h2><p>Online: Start your return from your account and post it back to us free of charge.</p>",
  "<p>In-Store: " + h(FELL_IN_STORE) + " All refunds will be processed to the original method of payment. " + h(FELL_RULE) + " Please retain this email in case you wish to return your item(s).</p>",
  '<p align="center"><img src="http://live.fellmail.test/LiveContent.aspx?qs=5f1a9c0e77b2d4&amp;t=bc" alt="Barcode" width="300"></p>'] }));
// The shop's order confirmation for another order, to check a code never lands on the wrong one.
export const fellOther = mail("fell-other", "Fellwear <orders@fellwear.test>", "Thanks for your order", "Mon, 02 Nov 2026 10:00:00 +0000", page({ brand: "Fellwear", domain: "fellwear.test", rows: [
  "<h1>Thanks for your order, Sam</h1>", "<p>Order number: FW20419999</p><p>Order date: 2 November 2026</p>", items([["Merino Base Layer", 1, 6500]], 6500)] }));

// ---- 2. A till receipt sent by email, with the receipt's own barcode --------------------------------------------------
export const FELL_RECEIPT_WORDS = "Refunds and exchanges are available within 30 days of purchase when the item is accompanied by its original receipt.";
export const fellTill = mail("fell-till", "Fellwear <receipts@fellwear.test>", "Your Fellwear receipt", "Mon, 07 Sep 2026 13:05:00 +0000", page({ brand: "Fellwear", domain: "fellwear.test", rows: [
  "<h1>Thanks for shopping with us</h1>", "<p>Fellwear Dockside, 7 September 2026</p><p>Transaction number: 0042-118-7731</p>",
  items([["Recovery Slides", 1, 4800]], 4800), "<p>Paid by card</p>",
  '<p align="center"><img src="http://live.fellmail.test/LiveContent.aspx?qs=till8842aa01&amp;t=tx" alt="Trans Barcode"></p>',
  "<p>" + h(FELL_RECEIPT_WORDS) + " Sale items can be exchanged only.</p>"] }));

// ---- 3. A drop-off return with no printer: a returns company's QR code, and a marketplace's -------------------------
export const FELL_DROP = "Use a Print In ParcelShop device to scan your QR code and stick the label to your parcel.";
export const fellOrder2 = mail("fell-order2", "Fellwear <orders@fellwear.test>", "Thanks for your order", "Wed, 18 Nov 2025 10:00:00 +0000", page({ brand: "Fellwear", domain: "fellwear.test", rows: [
  "<h1>Thanks for your order, Sam</h1>", "<p>Order number: FW20402516</p><p>Order date: 18 November 2025</p>", items([["Studio Tights 25in", 1, 8800]], 8800)] }));
export const fellDropOff = mail("fell-dropoff", "Fellwear <fellwear@parcelback-mail.test>", "Your Evri QR code for your order FW20402516", "Fri, 21 Nov 2025 09:00:00 +0000", page({ brand: "Fellwear", domain: "fellwear.test", rows: [
  "<h1>Your return is ready to send</h1>", "<p>Pack your items and take your return to an Evri ParcelShop. " + h(FELL_DROP) + "</p>",
  '<p align="center"><img src="https://returns.parcelback.test/returns/fellwear-intl/viewPrinterlessLabel?return_id=77120045&amp;v=2" alt="QR Code" width="160" height="auto"></p>',
  "<p>Please send your return back by Wed 24 Dec 2025.</p>", "<p>Items: Studio Tights 25in</p>"] }));
const marketReturn = (id, date, order, method, by, img, item) => mail(id, "Marlow Market <returns@marlowmarket.test>", "Your return of " + item, date, page({ brand: "Marlow Market", domain: "marlowmarket.test", rows: [
  "<h1>Your return is confirmed</h1>", "<p>Order number: " + order + "</p><p>" + h(item) + "</p>",
  "<p><strong>" + h(method) + "</strong></p><p>Drop off by: " + by + "</p>",
  '<p><a href=""><img src="https://trans-qrcode-images-eu.objectstore.test/' + img + '.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&amp;X-Amz-Expires=604800&amp;X-Amz-Signature=0a1b2c3d" alt="Click here for Return Code" width="168"></a></p>',
  "<p>Take the item to the drop-off location and show the return code. You don't need to print anything.</p>"] }));
export const marketOrderA = mail("market-order-a", "Marlow Market <auto-confirm@marlowmarket.test>", "Your Marlow Market order", "Sat, 02 Aug 2025 10:00:00 +0000", page({ brand: "Marlow Market", domain: "marlowmarket.test", rows: [
  "<h1>Order confirmed</h1>", "<p>Order number: 204-5512087-3340912</p>", items([["Soft Close Toilet Seat", 1, 2899]], 2899)] }));
export const marketOrderB = mail("market-order-b", "Marlow Market <auto-confirm@marlowmarket.test>", "Your Marlow Market order", "Sun, 03 Aug 2025 10:00:00 +0000", page({ brand: "Marlow Market", domain: "marlowmarket.test", rows: [
  "<h1>Order confirmed</h1>", "<p>Order number: 204-7781200-1150437</p>", items([["Folding Clothes Airer", 1, 2450]], 2450)] }));
export const MARKET_EVRI = "Evri Drop Off - No Printer Required", MARKET_RM = "Royal Mail Drop off- No label needed";
// (Its picture's address stops working a week after the email: the test's stand-in host answers "gone" for this one.)
export const marketReturnExpired = marketReturn("market-return-expired", "Sun, 10 Aug 2025 09:00:00 +0000", "204-5512087-3340912", MARKET_EVRI, "Sat, 6 Sept", "100200300400", "Soft Close Toilet Seat");
export const marketReturnLive = marketReturn("market-return-live", "Sat, 09 Aug 2025 09:00:00 +0000", "204-7781200-1150437", MARKET_RM, "Wed, 10 Sept", "100200300499", "Folding Clothes Airer");

// ---- 4. A QR code to collect with -------------------------------------------------------------------------------------
export const RACE_WORDS = "If you don't receive your race pack by Saturday, bring the QR code below and photo ID to one of our information points.";
export const raceOrder = mail("race-order", "Harbour Half <entries@harbourhalf.test>", "Your entry is confirmed - order 4417702", "Mon, 12 May 2025 10:00:00 +0000", page({ brand: "Harbour Half", domain: "harbourhalf.test", rows: [
  "<h1>You're in!</h1>", "<p>Order number: 4417702</p>", items([["Harbour Half Marathon 2025 entry", 1, 6200]], 6200)] }));
export const racePack = mail("race-pack", "Harbour Half <info@harbourhalf.test>", "Race weekend: everything you need to know", "Fri, 05 Sep 2025 07:00:00 +0000", page({ brand: "Harbour Half", domain: "harbourhalf.test", rows: [
  "<h1>Two days to go</h1>", "<p>Your Order ID: 4417702</p>", "<p>Race packs were posted last month. " + h(RACE_WORDS) + "</p>",
  '<p align="center"><img src="https://api.qrmaker.test/v1/create-qr-code/?size=350x350&amp;data=4417702" alt="QR Code" width="232"></p>',
  "<p>The start line opens at 9am on Sunday.</p>"] }));

// ---- 5. Tickets: one email with every ticket's barcode, each sent again later on its own, some forwarded -------------
export const TICKETS = ["100200300401", "100200300402", "100200300403"];
const ticketBlock = (n, k) => "<p><strong>Standard Entry</strong><br />Ticket Number: " + n + "<br />Ticket holder: Guest " + (k + 1) + '</p><p><img src="https://lanternmail.test/im/' + n + '.png" alt="Barcode: ' + n + '" width="150px"></p>';
export const ticketOrder = mail("ticket-order", "Lanternfield Festival <tickets@lanternfield.test>", "Your Lanternfield Festival order #160104", "Sun, 19 Apr 2026 12:00:00 +0000", page({ brand: "Lanternfield Festival", domain: "lanternfield.test", rows: [
  "<h1>Your tickets</h1>", "<p>Order number: 160104</p><p>Event date: Saturday 18 July 2026</p><p>Fernhill Park</p>",
  items([["Standard Entry", 3, 2500]], 7500), "<p>Show each ticket's barcode at the gate to be scanned.</p>", ...TICKETS.map(ticketBlock)] }), { attach: [{ type: "application/pdf", name: "tickets.pdf" }, { type: "text/calendar", name: "event.ics" }] });
export const ticketResends = TICKETS.slice(0, 2).map((n, k) => mail("ticket-resend-" + (k + 1), "Lanternfield Festival <tickets@lanternfield.test>", "Your ticket for Lanternfield Festival (order #160104)", "Mon, 13 Jul 2026 0" + (8 + k) + ":00:00 +0000", page({ brand: "Lanternfield Festival", domain: "lanternfield.test", rows: [
  "<h1>See you on Saturday</h1>", "<p>Order number: 160104</p><p>Event date: Saturday 18 July 2026</p>", "<p>Show your ticket's barcode at the gate to be scanned.</p>", ticketBlock(n, k)] }), { attach: [{ type: "application/pdf", name: n + ".pdf" }] }));

// ---- 6. Emails with something that looks like a code and must never be shown -----------------------------------------
const qr = (host, alt, w = 160) => '<p><img src="https://' + host + '/qr.png" alt="' + alt + '" width="' + w + '"></p>';
export const never = {
  // A hotel booking: a QR code to download the app, and a PIN for changing the booking.
  "app download and booking PIN": mail("never-hotel", "Staywell <noreply@staywell.test>", "Booking confirmation 5512.887.341", "Mon, 06 Jul 2026 10:00:00 +0000", page({ brand: "Staywell", domain: "staywell.test", rows: [
    "<h1>Your booking is confirmed</h1>", "<p>Confirmation number: 5512.887.341</p><p>PIN code: 4471 (confidential)</p><p>Use your PIN to change or cancel this booking.</p>",
    items([["Harbour Hotel, 2 nights", 1, 24000]], 24000), "<p>Get the app: scan this QR code to download the Staywell app and manage your booking.</p>" + qr("img.staywell.test", "QR code", 138)] })),
  // An eSIM: the QR code installs the line (with its PUK), so it is a key, not a code to show.
  "eSIM install code": mail("never-esim", "Tallymobile <orders@tallymobile.test>", "Your Tallymobile eSIM order 88120047", "Fri, 25 Sep 2026 10:00:00 +0000", page({ brand: "Tallymobile", domain: "tallymobile.test", rows: [
    "<h1>Your eSIM is ready</h1>", "<p>Order number: 88120047</p>", items([["30 day eSIM plan", 1, 500]], 500),
    "<p>To install your eSIM, scan the QR code below with your phone camera.</p>" + qr("img.tallymobile.test", "88120047"), "<p>PUK: 55120987 ICCID: 8944000000012345678</p>"] })),
  // A pass into a building for an appointment: not a purchase.
  "building visitor pass": mail("never-pass", "Quay Wharf <visitors@quaywharf.test>", "Your visitor pass for 27 August", "Wed, 26 Aug 2026 10:00:00 +0000", page({ brand: "Quay Wharf", domain: "quaywharf.test", rows: [
    "<h1>You're expected</h1>", "<p>Present this code to gain access to the building. Scan your QR code at the turnstiles.</p>" + qr("img.quaywharf.test", "Code", 222), "<p>Appointment: Thursday 27 August, 10:30</p>"] })),
  // Marketing dressed around an order: a QR code for money off in store.
  "marketing voucher": mail("never-promo", "Fellwear <news@fellwear.test>", "A thank you for your order", "Sat, 31 Oct 2026 10:00:00 +0000", page({ brand: "Fellwear", domain: "fellwear.test", rows: [
    "<h1>20% off your next visit</h1>", "<p>Thanks for your order FW20418856. Show this QR code in store to redeem your discount on anything new.</p>" + qr("img.fellmail.test", "QR code")] })),
  // The code is printed on something else; the picture in the email is only an example.
  "code printed elsewhere": mail("never-bib", "Harbour Half <info@harbourhalf.test>", "One month to go - order 4417702", "Thu, 07 Aug 2025 10:00:00 +0000", page({ brand: "Harbour Half", domain: "harbourhalf.test", rows: [
    "<h1>One month to go</h1>", "<p>Your Order ID: 4417702</p><p>On race day, scan the QR code on your run number to see your finish time and collect your photos.</p>" + qr("img.harbourhalf.test", "QR code on a run number")] })),
  // A shipping email whose only pictures are logos.
  "logos only": mail("never-logos", "Fellwear <shipping@fellwear.test>", "Your Fellwear order FW20419999 has shipped", "Tue, 03 Nov 2026 10:00:00 +0000", page({ brand: "Fellwear", domain: "fellwear.test", rows: [
    "<h1>On its way</h1>", "<p>Order number: FW20419999</p><p>Returns: bring your items to any store with your order number.</p>", '<p><img src="cid:logo1@fellwear" alt="Fellwear" width="120"><img src="https://img.fellmail.test/evri-logo.png" alt="Evri" width="80"></p>'] })),
  // A code with nothing saying what it is for.
  "no stated purpose": mail("never-unsure", "Fellwear <orders@fellwear.test>", "Your Fellwear order FW20419999", "Tue, 03 Nov 2026 11:00:00 +0000", page({ brand: "Fellwear", domain: "fellwear.test", rows: [
    "<h1>Order update</h1>", "<p>Order number: FW20419999</p><p>We're getting your order ready.</p>" + qr("img.fellmail.test", "QR code")] })),
};
// A pass whose code is a picture inside the email itself (cid:), written as the bytes a mailbox gives.
export function cidEmail({ from, subject, date, html, cid, png }) {
  const b = "=_relay_cid";
  return `From: ${from}\r\nTo: ${SHOPPER.email}\r\nSubject: ${subject}\r\nDate: ${date}\r\nMessage-ID: <cid-${cid}@codes.relay.test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${b}"\r\n\r\n--${b}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n--${b}\r\nContent-Type: image/png; name="image-1.png"\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <${cid}>\r\nContent-Disposition: inline; filename="image-1.png"\r\n\r\n${Buffer.from(png).toString("base64").replace(/(.{76})/g, "$1\r\n")}\r\n--${b}--\r\n`;
}
