// Tests for worker/receipt-parser.js using SYNTHETIC emails (invented retailers).
// These prove the parser handles these layouts, not that any real retailer's
// emails parse correctly. Real-world accuracy must be measured on real emails.
import assert from "node:assert/strict";
import { parseReceiptEmail, parseReturnEmail, extractProductImageUrls } from "../worker/receipt-parser.js";

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("ok -", name); };

const plain = `From: "Example Outfitters" <orders@exampleoutfitters.test>
Subject: Your order confirmation #EO-48213
Content-Type: text/plain; charset=utf-8

Thanks for your order!
Order number: EO-48213
Order date: 14 Oct 2026

Wool jumper - Qty 1 - £59.00
2 x Cotton socks £8.00
Delivery £3.95
Order total: £70.95
`;

t("plain text order", () => {
  const r = parseReceiptEmail(plain);
  assert.equal(r.ok, true);
  assert.equal(r.orderRef, "EO-48213");
  assert.equal(r.orderDate, "2026-10-14");
  assert.equal(r.totalPence, 7095);
  assert.equal(r.retailer.name, "Example Outfitters");
  assert.equal(r.retailer.domain, "exampleoutfitters.test");
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items[0], { name: "Wool jumper", qty: 1, pricePence: 5900 });
  assert.equal(r.items[1].qty, 2);
  assert.equal(r.refundEligible, false);
  assert.equal(r.source, "shopper_email");
});

const qpHtml = `From: Sample Home <no-reply@samplehome.test>
Subject: Order confirmation - thank you
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="b1"

--b1
Content-Type: text/html; charset=utf-8
Content-Transfer-Encoding: quoted-printable

<html><body><p>Order no. SH=2D9917</p><p>Placed 03/10/2026</p>
<table><tr><td>Oak side table</td><td>Qty 1</td><td>=C2=A3120.00</td></tr></table>
<p>Total paid: &pound;120.00</p></body></html>
--b1--
`;

t("quoted-printable HTML with table", () => {
  const r = parseReceiptEmail(qpHtml);
  assert.equal(r.ok, true);
  assert.equal(r.orderRef, "SH-9917");
  assert.equal(r.orderDate, "2026-10-03");
  assert.equal(r.totalPence, 12000);
  assert.equal(r.currency, "GBP");
  assert.equal(r.retailer.domain, "samplehome.test");
});

const ld = `From: Demo Shoes <hello@demoshoes.test>
Subject: Your receipt from Demo Shoes
Content-Type: text/html; charset=utf-8

<html><head><script type="application/ld+json">
{"@context":"http://schema.org","@type":"Order","merchant":{"@type":"Organization","name":"Demo Shoes"},
 "seller":{"@type":"Organization","name":"Demo Shoes"},"orderNumber":"DS-5521","priceCurrency":"GBP","price":"89.00",
 "orderDate":"2026-10-12T09:30:00+01:00",
 "acceptedOffer":[{"@type":"Offer","itemOffered":{"@type":"Product","name":"Trail runner"},"price":"89.00","eligibleQuantity":{"@type":"QuantitativeValue","value":1}}]}
</script></head><body>Order number DS-5521. Total £89.00</body></html>`;

t("schema.org JSON-LD preferred when present", () => {
  const r = parseReceiptEmail(ld);
  assert.equal(r.ok, true);
  assert.equal(r.method, "json_ld");
  assert.equal(r.orderRef, "DS-5521");
  assert.equal(r.totalPence, 8900);
  assert.equal(r.orderDate, "2026-10-12");
  assert.equal(r.items[0].name, "Trail runner");
  assert.equal(r.confidence, "high");
  assert.equal(r.needsShopperConfirmation, false);
});

t("base64 body decodes", () => {
  const body = Buffer.from("Order number: B64-1001\nBook - £12.50\nOrder total: £12.50\n").toString("base64");
  const r = parseReceiptEmail(`From: Books <x@books.test>\nSubject: Order confirmation\nContent-Type: text/plain\nContent-Transfer-Encoding: base64\n\n${body}`);
  assert.equal(r.ok, true);
  assert.equal(r.orderRef, "B64-1001");
  assert.equal(r.totalPence, 1250);
});

t("newsletter is rejected, not turned into a purchase", () => {
  const r = parseReceiptEmail(`From: Sale Team <news@shop.test>\nSubject: 50% off everything this weekend!\nContent-Type: text/plain\n\nShop now. Jumpers from £19.99. Total bargains!`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_an_order_confirmation");
});

t("empty and garbage input never throws or invents data", () => {
  for (const input of ["", null, undefined, "not an email at all", "\n\n\n", "Subject: order confirmation\n\nhello"]) {
    const r = parseReceiptEmail(input);
    assert.equal(r.ok, false);
  }
});

t("missing fields stay null and confidence drops", () => {
  const r = parseReceiptEmail(`From: Thin <a@thin.test>\nSubject: Order confirmation\nContent-Type: text/plain\n\nOrder number: TH-77\nOrder total: £5.00`);
  assert.equal(r.ok, true);
  assert.equal(r.orderDate, null);
  assert.deepEqual(r.items, []);
  assert.notEqual(r.confidence, "high");
  assert.equal(r.needsShopperConfirmation, true);
});

t("inconsistent totals lower confidence", () => {
  const r = parseReceiptEmail(`From: Odd <a@odd.test>\nSubject: Order confirmation\nContent-Type: text/plain\n\nOrder number: OD-1\nOrder date: 2026-10-01\nThing - £50.00\nOrder total: £10.00`);
  assert.equal(r.ok, true);
  assert.notEqual(r.confidence, "high");
});

const withReturns = `From: "Example Outfitters" <orders@exampleoutfitters.test>
Subject: Your order confirmation #EO-777
MIME-Version: 1.0
Content-Type: text/html; charset=utf-8

<html><body><p>Order number: EO-777</p><p>Order date: 10 Oct 2026</p>
<p>Wool jumper - Qty 1 - £59.00</p><p>Order total: £59.00</p>
<p>Changed your mind? You can return items within 28 days of delivery for a full refund.</p>
<p>Return address:</p><p>Example Outfitters Returns</p><p>Unit 4, Mill Lane</p><p>Leeds LS1 4AB</p>
<p>Scan the QR code in your returns portal at the drop-off point.</p>
<p><a href="https://returns.exampleoutfitters.test/start?order=EO-777">Start your return</a>
<a href="https://exampleoutfitters.test/unsubscribe">Unsubscribe</a>
<a href="http://insecure.test/returns">Returns (http)</a></p></body></html>`;

t("return details: window, address, link, QR mention", () => {
  const r = parseReceiptEmail(withReturns);
  assert.equal(r.ok, true);
  assert.equal(r.returns.windowDays, 28);
  assert.equal(r.returns.windowFrom, "delivery");
  assert.equal(r.returns.deadline, null, "no deadline guessed when the window runs from delivery");
  assert.match(r.returns.address, /Leeds LS1 4AB/);
  assert.equal(r.returns.portalUrl, "https://returns.exampleoutfitters.test/start?order=EO-777");
  assert.equal(r.returns.qrMentioned, true);
  assert.ok(r.returns.instructions.length >= 1 && r.returns.instructions.length <= 3);
  assert.equal(r.refundEligible, false);
});

t("return deadline worked out only when counted from the order date", () => {
  const r = parseReceiptEmail(`From: Shop <a@shop.test>\nSubject: Order confirmation\nContent-Type: text/plain\n\nOrder number: SH-1\nOrder date: 2026-10-01\nHat £10.00\nOrder total: £10.00\nYou can return this order within 14 days of purchase.`);
  assert.equal(r.returns.windowFrom, "order");
  assert.equal(r.returns.deadline, "2026-10-15");
  const e = parseReceiptEmail(`From: Shop <a@shop.test>\nSubject: Order confirmation\nContent-Type: text/plain\n\nOrder number: SH-2\nOrder total: £10.00\nReturns must be made by 20 November 2026.`);
  assert.equal(e.returns.deadline, "2026-11-20");
});

t("no return info means returns is null; incomplete address is not shown", () => {
  const r = parseReceiptEmail(plain);
  assert.equal(r.returns, null);
  const a = parseReceiptEmail(`From: Shop <a@shop.test>\nSubject: Order confirmation\nContent-Type: text/plain\n\nOrder number: SH-3\nOrder total: £10.00\nReturn address:\nSomewhere Road\n`);
  assert.equal(a.returns && a.returns.address, null);
});

// Layout modelled on a real delivery-app confirmation (invented restaurant and items).
const delivery = `From: Food Courier <no-reply@order.foodcourier.test>
Date: Fri, 9 Oct 2026 20:32:00 +0100
Subject: Sam, order confirmed
Content-Type: text/plain; charset=utf-8

Your order's been received
Great news! Golden Wok has received your order.

Placed on Fri 9 Oct

Your order number is:

966874418

1 Egg Fried Rice

£3.30

1 Sweet and Sour Chicken (Large)

£9.40

2 Spring Rolls

£6.00

+ Extra sauce

£0.50 £0.50

Subtotal: £18.70
Offer discount: -£5.00
Service fee 11%: £1.99
Delivery: £1.49

Total: £17.18
`;

t("delivery-app layout: number on next line, items over two lines, no-year date, discount", () => {
  const r = parseReceiptEmail(delivery);
  assert.equal(r.ok, true);
  assert.equal(r.orderRef, "966874418");
  assert.equal(r.orderDate, "2026-10-09");
  assert.equal(r.totalPence, 1718);
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].name, "Egg Fried Rice");
  assert.equal(r.items[2].qty, 2);
  assert.equal(r.retailer.domain, "order.foodcourier.test");
  assert.notEqual(r.confidence, "low");
  assert.equal(r.refundEligible, false);
});

t("a no-year date is never placed in the future", () => {
  const r = parseReceiptEmail(delivery.replace("Date: Fri, 9 Oct 2026", "Date: Tue, 6 Jan 2027").replace("Fri 9 Oct", "Fri 9 Oct"));
  assert.equal(r.orderDate, "2026-10-09");
});

// Layouts modelled on a real clothing retailer's order and return emails (invented brand and item).
const clothingOrder = `From: Alpine Active <hello@e.alpineactive.test>
Date: Wed, 19 Nov 2025 22:09:00 +0000
Subject: Thanks for your Alpine Active order #AA04002516
Content-Type: text/plain; charset=utf-8

Thanks for your Order, Sam!

Items Purchased

Trail Jacket

Merino

1 x 074897 / Size US 8 (UK 12-14)

158094170

£118.00

Subtotal (1 item)

£98.33

Shipping

Free

VAT

£19.67

Order Total

£118.00

Order Id: #AA04002516

Order Date

November 19, 2025

Returns & Exchanges

Return information will be provided on your shipping confirmation email once your items are on the way.
`;

t("clothing order: Order Id, month-first date, name over two lines, total on the next line", () => {
  const r = parseReceiptEmail(clothingOrder);
  assert.equal(r.ok, true);
  assert.equal(r.orderRef, "AA04002516");
  assert.equal(r.orderDate, "2025-11-19");
  assert.equal(r.totalPence, 11800);
  assert.equal(r.items.length, 1);
  assert.match(r.items[0].name, /Trail Jacket/);
  assert.equal(r.items[0].pricePence, 11800);
  assert.equal(r.retailer.name, "Alpine Active");
  assert.notEqual(r.confidence, "low");
});

const returnMail = `From: Alpine Active <noreply@alpineactive-intl.narvar.test>
Date: Fri, 21 Nov 2025 21:34:00 +0000
Subject: Your Evri QR code for your order AA04002516
MIME-Version: 1.0
Content-Type: text/html; charset=utf-8

<html><body><p>RETURN ID: naa0400251601</p><p>Order Date: Nov. 19, 2025</p>
<p>Thanks for your return request.</p>
<p>Please follow the instructions below to package and send it back no later than Wednesday, December 24.</p>
<p>Once we receive your return, we will process it within 3-5 business days.</p>
<p><a href="https://track.alpineactive.test/r/naa0400251601">TRACK YOUR RETURN</a></p>
<p>Return Instructions</p>
<p>Pack your item(s) in the original packaging and take your return to an Evri ParcelShop.</p>
<p>Use a Print In ParcelShop device to scan your QR code and print the return label.</p>
<p>Affix the return label to the package and then send your return on its way.</p>
<p>Return Details</p><p>Trail Jacket</p><p>Quantity: 1</p><p>Fit too loose</p><p>£118.00</p>
<p>Estimated Refund</p><p>£118.00</p><p>Have Questions?</p></body></html>`;

t("return instructions email: id, order, deadline, carrier, QR, refund, steps, link", () => {
  const r = parseReturnEmail(returnMail);
  assert.equal(r.ok, true);
  assert.equal(r.kind, "return_instructions");
  assert.equal(r.returnId, "naa0400251601");
  assert.equal(r.orderRef, "AA04002516");
  assert.equal(r.orderDate, "2025-11-19");
  assert.equal(r.deadline, "2025-12-24");
  assert.equal(r.carrier, "Evri");
  assert.equal(r.qrMentioned, true);
  assert.equal(r.estimatedRefundPence, 11800);
  assert.equal(r.trackUrl, "https://track.alpineactive.test/r/naa0400251601");
  assert.ok(r.steps.length >= 2 && r.steps.length <= 4);
  assert.equal(r.refundEligible, false);
});

t("a deadline with no year rolls into next year when the month has already passed", () => {
  const r = parseReturnEmail(returnMail.replace("Fri, 21 Nov 2025", "Mon, 22 Dec 2025").replace("December 24", "January 5"));
  assert.equal(r.deadline, "2026-01-05");
});

t("return parser ignores receipts and marketing", () => {
  assert.equal(parseReturnEmail(clothingOrder).ok, false);
  assert.equal(parseReturnEmail("From: A <a@a.test>\nSubject: Free returns on everything\n\nShop now, free returns!").ok, false);
  assert.equal(parseReceiptEmail(returnMail).ok, false, "a return email is not read as a purchase");
});

t("product photo: picks the item photo, skips logos, icons, pixels, http and tiny images", () => {
  const mail = `From: Alpine Active <orders@alpineactive.test>
Subject: Order confirmation
Content-Type: text/html

<html><body>
<img src="https://cdn.alpineactive.test/brand/logo.png" width="200">
<img src="https://cdn.alpineactive.test/social/instagram.png" width="40">
<img src="https://track.alpineactive.test/open?id=1" width="1" height="1">
<img src="http://cdn.alpineactive.test/products/jacket.jpg" width="300">
<img src="https://192.168.0.1/products/jacket.jpg" width="300">
<img src="https://cdn.alpineactive.test/p/define-jacket-black.jpg?w=400&amp;q=80" alt="Define Jacket" width="300">
<img src="https://cdn.alpineactive.test/p/other.jpg" alt="Banner sale" width="300">
<p>Order number: AA-1</p><p>Order date: 14 Oct 2026</p><p>Define Jacket - Qty 1 - £118.00</p><p>Order total: £118.00</p>
</body></html>`;
  const urls = extractProductImageUrls(mail);
  assert.equal(urls[0], "https://cdn.alpineactive.test/p/define-jacket-black.jpg?w=400&q=80");
  assert.ok(urls.every(u => u.startsWith("https://") && !/logo|instagram|192\.168|track/.test(u)), JSON.stringify(urls));
  assert.deepEqual(extractProductImageUrls("From: A <a@a.test>\nSubject: Order\n\nplain text only"), []);
});

// Layout modelled on a real "Thanks for your <brand> order #..." email (no "your order" in the subject).
t("order email titled 'Thanks for your <brand> order #REF' with Items Purchased / Order Id layout", () => {
  const r = parseReceiptEmail(`From: Brand <hello@e.brand.test>\nSubject: Thanks for your brand order #UK04002516\nDate: Wed, 19 Nov 2025 22:09:00 +0000\nContent-Type: text/plain\n\nThanks for your Order, Sam!\n\nItems Purchased\n\nDefine Jacket\n\nNulu\n\n1 x 074897 / Size US 8 (UK 12-14)\n\n158094170\n\n\u00a3118.00\n\nSubtotal (1 item)\n\n\u00a398.33\n\nOrder Total\n\n\u00a3118.00\n\nOrder Id: #UK04002516\n\nOrder Date\n\nNovember 19, 2025\n`);
  assert.equal(r.ok, true); assert.equal(r.orderRef, "UK04002516"); assert.equal(r.totalPence, 11800); assert.equal(r.orderDate, "2025-11-19");
});

console.log(`\n${passed} receipt-parser tests passed (synthetic emails only)`);
