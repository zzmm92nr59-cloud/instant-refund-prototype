// Tests for worker/receipt-parser.js using SYNTHETIC emails (invented retailers).
// These prove the parser handles these layouts, not that any real retailer's
// emails parse correctly. Real-world accuracy must be measured on real emails.
import assert from "node:assert/strict";
import { parseReceiptEmail, parseReturnEmail, extractProductImageUrls, looksPromotional } from "../worker/receipt-parser.js";

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

// Real emails are MIME: encoded-word subject, quoted-printable / base64 HTML next to a skimpy plain part, UTF-8 "£".
const qpEnc = (str) => Buffer.from(str, "utf8").toString("latin1").replace(/=/g, "=3D").replace(/[^\x20-\x7e\n]/g, (c) => "=" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).split("\n").map((l) => l.replace(/(.{70})/g, "$1=\n")).join("\n");
const mimeHtml = `<html><body><table><tr><td><b>Items Purchased</b></td></tr><tr><td><p>Define Jacket</p><p>Nulu</p><p>1 x 074897 / Size US 8 (UK 12-14)</p></td><td>&pound;118.00</td></tr><tr><td>Subtotal (1 item)</td><td>\u00a398.33</td></tr><tr><td><b>Order Total</b></td><td>\u00a3118.00</td></tr><tr><td>Order Id: #UK04002516</td></tr><tr><td><b>Order Date</b></td></tr><tr><td>November 19, 2025</td></tr></table></body></html>`;
for (const enc of ["quoted-printable", "base64"]) {
  t(`multipart email with encoded-word subject and ${enc} HTML (UTF-8 £)`, () => {
    const body = enc === "base64" ? Buffer.from(mimeHtml).toString("base64").replace(/(.{76})/g, "$1\r\n") : qpEnc(mimeHtml);
    const raw = `From: Brand <hello@e.brand.test>\r\nSubject: =?UTF-8?Q?Thanks_for_your_brand_order_#UK04002516?=\r\nDate: Wed, 19 Nov 2025 22:09:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qpEnc("Thanks for your Order!\nOrder Id: #UK04002516\nOrder Total \u00a3118.00")}\r\n--b1\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: ${enc}\r\n\r\n${body}\r\n--b1--\r\n`;
    const r = parseReceiptEmail(raw);
    assert.equal(r.ok, true); assert.equal(r.orderRef, "UK04002516"); assert.equal(r.totalPence, 11800);
    assert.equal(r.orderDate, "2025-11-19"); assert.equal(r.items[0]?.name, "Define Jacket Nulu");
  });
}
t("base64-encoded-word subject (=?UTF-8?B?...) is decoded", () => {
  const subj = "=?UTF-8?B?" + Buffer.from("Thanks for your order #AB12345").toString("base64") + "?=";
  const r = parseReceiptEmail(`From: S <s@shop.test>\nSubject: ${subj}\nContent-Type: text/plain\n\nOrder number: AB12345\nOrder total \u00a320.00\n`);
  assert.equal(r.ok, true); assert.equal(r.totalPence, 2000);
});

t("return email with 'Order Id: #REF' (colon and hash) is joined to its order", () => {
  const r = parseReturnEmail(`From: Brand <hello@e.brand.test>\nSubject: Thanks for your return request\nDate: Mon, 16 Nov 2026 10:00:00 +0000\nContent-Type: text/plain\n\nReturn ID: #RT-5551234\nOrder Id: #UK04002516\nSend it back no later than December 24.\n`);
  assert.equal(r.ok, true); assert.equal(r.orderRef, "UK04002516"); assert.equal(r.returnId, "RT-5551234");
});
t("lenient mode (shopper picked the email) accepts one signal but still needs real fields", () => {
  const raw = `From: Brand <hello@e.brand.test>\nSubject: Thanks for your brand order\nContent-Type: text/plain\n\nOrder Total\n\u00a3118.00\n`;
  assert.equal(parseReceiptEmail(raw).ok, true);
  const bare = `From: Brand <hello@e.brand.test>\nSubject: Thanks for your brand order\nContent-Type: text/plain\n\nHope you enjoy it.\n`;
  const strict = parseReceiptEmail(bare), len = parseReceiptEmail(bare, { lenient: true });
  assert.equal(strict.ok, false); assert.equal(len.ok, false); assert.equal(len.signals.nothingFound, true);
});

// Apple receipts (synthetic, built to Apple's published receipt layout): the app and what was bought sit on lines above the price.
const appleHtml = (rows) => `From: Apple <no_reply@email.apple.com>\nSubject: Your receipt from Apple.\nDate: Sat, 31 Oct 2026 10:00:00 +0000\nContent-Type: text/html; charset=utf-8\n\n<html><body>${rows.map(r => `<p>${r}</p>`).join("")}</body></html>`;
t("Apple in-app purchase: app and item are read, not the account or order lines", () => {
  const r = parseReceiptEmail(appleHtml(["Receipt", "Apple Account", "someone@example.test", "Invoice Date", "31 Oct 2026", "Order ID", "MQKY4QNLQ6", "Document", "123456789012", "App Store", "Puzzle Kingdom", "5,000 Coins", "Report a Problem", "£1.59", "Subtotal", "£1.33", "VAT charged at 20%", "£0.26", "Total", "£1.59"]));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.orderRef, "MQKY4QNLQ6");
  assert.equal(r.totalPence, 159);
  assert.deepEqual(r.items.map(i => [i.name, i.variant, i.pricePence]), [["Puzzle Kingdom", "5,000 Coins", 159]]);
});
t("Apple receipt with two purchases and a subscription", () => {
  const r = parseReceiptEmail(appleHtml(["Order ID", "MQAB12CD34", "App Store", "Puzzle Kingdom", "Gem Pack", "In-App Purchase", "Report a Problem", "£3.19", "Cloud Notes Pro", "Cloud Notes Pro (Monthly)", "Renews 30 Nov 2026", "Report a Problem", "£4.99", "Subtotal", "£6.82", "Total", "£8.18"]));
  assert.deepEqual(r.items.map(i => [i.name, i.variant || null, i.pricePence]), [["Puzzle Kingdom", "Gem Pack", 319], ["Cloud Notes Pro", "Cloud Notes Pro (Monthly)", 499]]);
});
t("Apple service with only a section name (iCloud+) still gets a name", () => {
  const r = parseReceiptEmail(appleHtml(["Order ID", "MQZZ99YY88", "Apple Services", "iCloud+ with 200 GB storage", "Monthly", "£2.99", "Total", "£2.99"]));
  assert.deepEqual(r.items.map(i => i.name), ["iCloud+ with 200 GB storage"]);
});
t("Apple receipt with the device on its own line and an 'Inclusive of VAT' line", () => {
  const r = parseReceiptEmail(appleHtml(["Order ID", "MQKY4QNLQ6", "App Store", "Puzzle Kingdom", "Stack of Coins", "iPhone", "£1.59", "Inclusive of VAT at 20%", "£0.26", "Total", "£1.59"]));
  assert.deepEqual(r.items.map(i => [i.name, i.variant || null, i.pricePence]), [["Puzzle Kingdom", "Stack of Coins", 159]]);
});
t("the Apple reader never runs for other shops", () => {
  const r = parseReceiptEmail(appleHtml(["Order ID", "AB12345", "Some Shop", "Thing", "£5.00", "Total", "£5.00"]).replace("no_reply@email.apple.com", "orders@someshop.test"));
  assert.deepEqual(r.items, []);
});

console.log(`\n${passed} receipt-parser tests passed (synthetic emails only)`);

// Real-world lesson (lululemon, 2025): a message that says "Return ID: https://..." must not yield the ID "https",
// while a real "RETURN ID: nuk0400251601" still must.
t("return id is never a link scheme or plain word", () => {
  const mk = (line) => `From: Shop <noreply@shop.test>\nSubject: Your return\nContent-Type: text/plain\n\n${line}\nThanks for your return request.\nPlease send it back no later than Wednesday, December 24.\n`;
  assert.equal(parseReturnEmail(mk("Return ID: https://shop.test/r/abc")).returnId, null);
  assert.equal(parseReturnEmail(mk("RETURN ID: nuk0400251601")).returnId, "nuk0400251601");
});

// Real-world lesson (lululemon QR email): empty text/plain part, quoted-printable HTML, ID inside a link.
t("return email with an empty text part falls back to the HTML", () => {
  const html = `<html><head><style>.x{color:red}</style></head><body><div>RETURN ID: <a href=3D"https://returns.shop.test/t"> nuk0400251601</a></div>=
<div>Order Date: Nov. 19, 2025</div><div>Thanks for your return request.</div>=
<div>Please send it back no later than Wednesday, December 24.<br/></div>=
<img alt=3D"QR Code" src=3D"https://returns.shop.test/viewPrinterlessLabel?return_id=3Dabc">=
<ol><li>Pack your items securely and take them to an Evri ParcelShop.</li></ol></body></html>`;
  const raw = `From: Shop <noreply@shop.test>\nSubject: Your Evri QR code for your order UK04002516\nDate: Thu, 20 Nov 2025 10:00:00 +0000\nContent-Type: multipart/alternative; boundary="b"\n\n--b\nContent-Type: text/plain; charset=utf-8\n\n \n\n--b\nContent-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\n${html}\n--b--\n`;
  const r = parseReturnEmail(raw);
  assert.equal(r.ok, true);
  assert.equal(r.returnId, "nuk0400251601");
  assert.equal(r.orderRef, "UK04002516");
  assert.equal(r.deadline, "2025-12-24");
  assert.equal(r.carrier, "Evri");
});

// Promotions that look like receipts must not become receipts; real orders must survive.
t("promo emails are not receipts, order emails still are", () => {
  const promo = `From: Sainsbury's <hello@email.sainsburys.test>\nSubject: You've saved £4.20 with Nectar prices\nContent-Type: text/plain\n\nThanks for shopping. Your total savings £4.20. Order total £31.00 Nectar points earned.\n`;
  assert.equal(parseReceiptEmail(promo).ok, false);
  const mk = (sub) => `From: S <hello@e.s.test>\nSubject: ${sub}\nContent-Type: text/plain\n\nThanks for your purchase. Total £31.00\n1 x Jumper £31.00\n`;
  assert.equal(parseReceiptEmail(mk("Purchase receipt - earn points")).reason, "promotional");
  assert.equal(parseReceiptEmail(mk("Your receipt - you earned 50 points")).ok, true);
  const order = `From: Shop <hello@shop.test>\nSubject: Thanks for your order #AB12345\nContent-Type: text/plain\n\nThanks for your order!\nOrder number: AB12345\nOrder total £31.00\n1 x Blue jumper £31.00\n`;
  assert.equal(parseReceiptEmail(order).ok, true);
  const saleWithRef = `From: Shop <hello@shop.test>\nSubject: Your order AB12345 is confirmed - sale items included\nContent-Type: text/plain\n\nThanks for your order!\nOrder number: AB12345\nOrder total £31.00\n1 x Blue jumper £31.00\n`;
  assert.equal(parseReceiptEmail(saleWithRef).ok, true);
});

// ---- Item tables read as cells (layouts modelled on real order-and-pay, takeaway, fast-food and supermarket emails;
// every pub, shop, item and number here is invented) ----
const htmlMail = (from, subject, date, html) => `From: ${from}\r\nSubject: ${subject}\r\nDate: ${date}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}`.replace(/\r?\n/g, "\r\n");
const cellRow = (...cells) => "<tr>" + cells.map(c => `<td>\r\n${c}\r\n</td>`).join("") + "</tr>";

t("pub order-and-pay: quantity, name and price cells, money off and VAT under them", () => {
  const html = `<table>${cellRow("Order Id: 7700112233")}${cellRow("Order Date: Monday, August 25, 2025")}${cellRow("Table Number: 12")}</table>
<table>${cellRow("Qty", "Description", "Amount")}${cellRow("2", "Example Pale Ale (Pint)", "£9.60")}${cellRow("1", "Cola (Half)", "£1.45")}
${cellRow("1", "Promotion Applied", "-£2.00")}${cellRow("VAT (20%)", "£1.51")}</table>
<table>${cellRow("Payment Type", "Apple Pay")}${cellRow("Order Total", "£9.05")}</table><p>Thank you for your order</p>`;
  const r = parseReceiptEmail(htmlMail("The Example Arms <orders@examplearms.test>", "Thank you for your order", "Mon, 25 Aug 2025 14:46:00 +0100", html));
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.pricePence]), [["Example Pale Ale (Pint)", 2, 960], ["Cola (Half)", 1, 145]]);
  assert.equal(r.totalPence, 905);
  assert.equal(r.orderDate, "2025-08-25");
  assert.notEqual(r.confidence, "low", "the money off explains why the items come to more than the total");
});

t("takeaway app: extras under an item, a meal deal's parts and their extra price", () => {
  const html = `<p>Your order's been received</p><table>
<tr><td>1</td><td>Garlic dip</td></tr><tr><td></td><td>£0.80</td></tr>
<tr><td>1</td><td>Chicken Burger - Regular</td></tr><tr><td>£8.50</td></tr>
<tr><td>+</td><td>No Salad</td></tr><tr><td></td><td>+</td><td>Mayonnaise</td></tr>
<tr><td>1</td><td>Two Pizza Deal</td></tr><tr><td>£25.00</td></tr>
<tr><td></td><td>Veggie Feast Pizza</td></tr><tr><td></td><td>+</td></tr><tr><td>Stuffed Crust</td></tr><tr><td></td><td>£3.00</td></tr>
<tr><td></td><td>Pepperoni Pizza</td></tr><tr><td></td><td>+</td><td>Thin Base</td></tr>
<tr><td>Subtotal:</td><td>£37.30</td></tr><tr><td>Offer discount:</td><td>-£10.00</td></tr><tr><td>Delivery:</td><td>£1.99</td></tr>
<tr><td>Total:</td><td>£29.29</td></tr></table>`;
  const r = parseReceiptEmail(htmlMail("Example Eats <orders@exampleeats.test>", "Your order's been received", "Sat, 01 Nov 2025 19:02:00 +0000", html));
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.pricePence]), [["Garlic dip", 1, 80], ["Chicken Burger - Regular", 1, 850], ["Two Pizza Deal", 1, 2800]]);
  assert.equal(r.items[1].variant, "No Salad, Mayonnaise");
  assert.equal(r.items[2].variant, "Veggie Feast Pizza, Stuffed Crust, Pepperoni Pizza, Thin Base");
  assert.equal(r.totalPence, 2929);
});

t("supermarket order: name, quantity and price, with unit prices and notes in between", () => {
  const rows = [["Example Coconut Water 1L", 2, "£5.00", "£2.50/unit"], ["Kitchen Roll 2 Pack", 1, "£3.25", "£3.25/unit"], ["Sweet Potatoes 1kg", 2, "£2.40", "£1.20/unit"]];
  const html = `<p>Estimated total</p><p>£10.65*</p><p>You've saved £3.10</p><p>Groceries</p><p>(5 items)</p><p>Items</p><p>Quantity</p><p>Qty</p><p>Price</p>`
    + rows.map(([n, q, p, u]) => `<p>${n}</p><p>${q}</p><p>${p}</p><p>${u}</p><p>Substitution allowed</p>`).join("")
    + `<p>Bag charge</p><p>£0.00</p>`;
  const r = parseReceiptEmail(htmlMail("Example Grocer <orders@examplegrocer.test>", "Order confirmation - Example Grocer", "Thu, 22 Oct 2026 09:00:00 +0100", html));
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.pricePence]), [["Example Coconut Water 1L", 2, 500], ["Kitchen Roll 2 Pack", 1, 325], ["Sweet Potatoes 1kg", 2, 240]]);
  assert.equal(r.totalPence, 1065);
});

t("supermarket order: the order summary under the last item is not part of its price", () => {
  const rows = [["Example Semi Skimmed Milk 2L", 1, "£1.65", "£0.83/unit"], ["Kitchen Roll 2 Pack", 2, "£6.50", "£3.25/unit"], ["Example Bananas Loose", 5, "£0.90", "£0.18/unit"]];
  const html = `<p>Thanks for your order</p><p>Items</p><p>Quantity</p><p>Price</p>`
    + rows.map(([n, q, p, u]) => `<p>${n}</p><p>${q}</p><p>${p}</p><p>${u}</p><p>Substitution allowed</p>`).join("")
    + `<p>Our substitution promise</p><p>We are committed to delivering the exact products you order and when</p><p>a substitute is more expensive than your original choice, we issue</p>`
    + `<p>Your order summary</p><p>Trolley cost</p><p>£9.05</p><p>Delivery cost</p><p>£1.50</p><p>Savings from coupons</p><p>£0.00</p>`
    + `<p>Estimated total</p><p>£10.55*</p><p>* Your total is an estimate due to products sold by weight.</p>`;
  const r = parseReceiptEmail(htmlMail("Example Grocer <orders@examplegrocer.test>", "Thanks for your order - 1234567890", "Thu, 22 Oct 2026 09:00:00 +0100", html));
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.pricePence]), [["Example Semi Skimmed Milk 2L", 1, 165], ["Kitchen Roll 2 Pack", 2, 650], ["Example Bananas Loose", 5, 90]],
    "the last item keeps its own price; the trolley cost isn't added to it");
  assert.equal(r.totalPence, 1055);
});

t("shop order: the option under a product's name is not its name", () => {
  const html = `<p>We've received your order #1050999</p><table><tr><td>Product</td><td>Quantity</td><td>Price</td></tr>
<tr><td>Example Pen - Mango Ice<br>Flavour: Mango Ice</td><td>2</td><td>£ 1.98</td></tr>
<tr><td>Example Pen - Cola<br>Flavour: Cola</td><td>1</td><td>£ 0.99</td></tr></table><p>Total: £2.97</p>`;
  const r = parseReceiptEmail(htmlMail("Example Vapes <shop@examplevapes.test>", "Your Example Vapes order has been received!", "Mon, 12 Jun 2023 10:00:00 +0100", html));
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.pricePence, i.variant]), [["Example Pen - Mango Ice", 2, 198, "Flavour: Mango Ice"], ["Example Pen - Cola", 1, 99, "Flavour: Cola"]]);
});

t("fast food: a deal's headline gives way to the item under it; 'Total (including VAT)'; a two-figure year", () => {
  const html = `<p>Here's the receipt for your order</p><table><tr><td>Order Date:</td><td>27/05/24 14:46</td></tr></table>
<table><tr><td>Qty</td><td>Item Detail</td><td>Item Cost</td></tr>
<tr><td>2</td><td>Medium Fries</td><td>£3.40</td></tr>
<tr><td>1</td><td>£1.99 for an Example Burger!</td></tr><tr><td>Make it a Monday! Get an Example Burger for just £1.99!</td></tr>
<tr><td>1</td><td>Example Burger</td><td>£1.99</td></tr>
<tr><td>1</td><td>Free Cookie</td></tr><tr><td>1</td><td>Free Cookie</td><td>£0.00</td></tr>
<tr><td>VAT:</td><td>£0.90</td></tr><tr><td>Total (including VAT):</td><td>£5.39</td></tr></table>`;
  const r = parseReceiptEmail(htmlMail("Example Burgers <receipts@exampleburgers.test>", "Your receipt", "Mon, 27 May 2024 14:50:00 +0100", html));
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.pricePence]), [["Medium Fries", 2, 340], ["Example Burger", 1, 199], ["Free Cookie", 1, 0]]);
  assert.equal(r.totalPence, 539);
  assert.equal(r.orderDate, "2024-05-27");
});

t("a table with no headings: quantity, name and price rows", () => {
  const html = `<p>Here is your receipt:</p><p>Order Placed:</p><p>22/05/2026</p><p>11:45</p>
<p>1</p><p>| Pork Burrito</p><p>| £9.45</p><p>1</p><p>| Large Upgrade</p><p>| £1.00</p><p>1</p><p>| Lime Soda</p><p>| £2.00</p><p>Total</p><p>£12.45</p>`;
  const r = parseReceiptEmail(htmlMail("Example Cantina <hello@examplecantina.test>", "Your Example Cantina receipt", "Fri, 22 May 2026 11:50:00 +0100", html));
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map(i => [i.name, i.pricePence]), [["Pork Burrito", 945], ["Large Upgrade", 100], ["Lime Soda", 200]]);
  assert.equal(r.orderDate, "2026-05-22");
});

t("dates: month-first when it can only be month-first, the reading nearest the email's date when both could be", () => {
  const mk = (when, sent) => `From: Example Beds <orders@examplebeds.test>\nSubject: Your order confirmation\nDate: ${sent}\nContent-Type: text/plain\n\nThanks for your order!\nOrder number: EB-1001\nOrder date: ${when}\nPillow - £59.00\nOrder total: £59.00\n`;
  assert.equal(parseReceiptEmail(mk("07/29/2025", "Tue, 29 Jul 2025 10:00:00 +0000")).orderDate, "2025-07-29", "US order of a date with no 29th month");
  assert.equal(parseReceiptEmail(mk("05/06/2025", "Thu, 05 Jun 2025 10:00:00 +0000")).orderDate, "2025-06-05", "day-first when the email was sent in June");
  assert.equal(parseReceiptEmail(mk("05/06/2025", "Tue, 06 May 2025 10:00:00 +0000")).orderDate, "2025-05-06", "month-first when the email was sent in May");
  assert.equal(parseReceiptEmail(mk("31/31/2025", "Tue, 06 May 2025 10:00:00 +0000")).orderDate, "2025-05-06", "not a real day: the email's own date");
});

t("'Order total (includes tax and delivery)' is the total", () => {
  const r = parseReceiptEmail(`From: Example Marketplace <payments@examplemarket.test>\nSubject: Payment plan created for your order\nContent-Type: text/plain\n\nThank you for your order 123-4567890-1234567.\nOrder # 123-4567890-1234567\nOrder total (includes tax and delivery)\n£68.38\n`);
  assert.equal(r.ok, true);
  assert.equal(r.totalPence, 6838);
  assert.equal(r.orderRef, "123-4567890-1234567");
});

t("a notice that a payment didn't go through is not a receipt", () => {
  const notice = `From: Example Marketplace <payments@examplemarket.test>\nSubject: Important Notice: Your Example Order #D01-1234567-1234567\nContent-Type: text/plain\n\nDue to a problem with the payment method you provided, we couldn't charge your account for your order (#D01-1234567-1234567).\nWe may attempt to reprocess payment for your order in a few days.\nOrder #D01-1234567-1234567\n`;
  assert.equal(parseReceiptEmail(notice).ok, false);
  assert.equal(parseReceiptEmail(notice).reason, "payment_problem");
  // A real order whose email only offers a link to change the payment method stays a receipt.
  const plan = `From: Example Marketplace <payments@examplemarket.test>\nSubject: Your order confirmation\nContent-Type: text/plain\n\nThanks for your order!\nOrder number: EM-555\nKettle - £30.00\nOrder total: £30.00\nUpdate payment method\n`;
  assert.equal(parseReceiptEmail(plan).ok, true);
});
t("shop e-receipt: '1 x Name' with an item number under it, and a free carrier bag left out", () => {
  const html = `<p>Receipt</p><p>Thanks for shopping with us — your receipt is below.</p><p>Order Details</p>
<p>1 x W Example Slide BLK/BLK 7</p><p>Item# 128840211</p><p>£48.00</p><p>1 x NON CHARGEABLE LRG SHOPPER</p><p>Item# 100200300</p><p>£0.00</p>
<p>Subtotal</p><p>£48.00</p><p>20% VAT (Included in price)</p><p>£8.00</p><p>Total</p><p>£48.00</p>`;
  const r = parseReceiptEmail(htmlMail("Example Athletica <receipts@e.exampleathletica.test>", "Your Example Athletica receipt", "Mon, 07 Sep 2026 15:10:00 +0100", html));
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.pricePence]), [["W Example Slide BLK/BLK 7", 1, 4800]]);
  assert.equal(r.totalPence, 4800);
});

t("train booking: the journey in the subject is the item, and 'Total amount' is the total", () => {
  const html = `<p>Your trip to Exampleton departing Sunday, 27 September 2026 is confirmed</p><p>This is just a booking confirmation.</p>
<table><tr><td>12:54 London Bridge</td></tr><tr><td>13:09 Exampleton</td></tr><tr><td>1x Anytime Day Single</td></tr><tr><td>1x Adult</td></tr></table>
<p>Payment information</p><table><tr><td>Transaction ID:</td><td>99887766</td></tr><tr><td>Total amount:</td><td>£6.25</td></tr></table>`;
  const r = parseReceiptEmail(htmlMail("Example Rail <auto-confirm@info.examplerail.test>", "Your booking confirmation for London to Exampleton (27 September at 12:54)", "Sun, 27 Sep 2026 12:30:00 +0100", html));
  assert.equal(r.ok, true);
  assert.equal(r.totalPence, 625);
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.pricePence]), [["London to Exampleton", 1, 625]]);
  const back = parseReceiptEmail(htmlMail("Example Rail <auto-confirm@info.examplerail.test>", "Your booking confirmation for return trip London to Examplecastle (20 August at 05:30)", "Sun, 17 Aug 2026 12:30:00 +0100", html));
  assert.equal(back.items[0].name, "London to Examplecastle (return)");
});

t("game web shop: the game named at the top is the shop, and the game currency is the item", () => {
  const html = `<h1>Purchase Confirmation</h1><h2>EXAMPLE QUEST-EXAMPLE STUDIOS</h2><table><tr><td>Receipt Number</td><td>123-456-789</td></tr>
<tr><td>Payment Date</td><td>October 31, 2026 1:16 PM GMT</td></tr><tr><td>Items</td></tr><tr><td>Coins</td><td>2,200</td></tr>
<tr><td>Subtotal</td><td>£1.33</td></tr><tr><td>Tax (20%)</td><td>£0.26</td></tr><tr><td>Total</td><td>£1.59</td></tr></table><p>Powered by</p>`;
  const r = parseReceiptEmail(htmlMail("no-reply <no-reply@appcharge.com>", "Purchase Confirmation #123-456-789", "Sat, 31 Oct 2026 13:16:00 +0000", html));
  assert.equal(r.ok, true);
  assert.equal(r.retailer.name, "Example Quest");
  assert.equal(r.retailer.domain, "appcharge.com", "the web shop's address stays, so the receipt is still filed as a digital purchase");
  assert.deepEqual(r.items.map(i => [i.name, i.pricePence]), [["2,200 Coins", 159]]);
  assert.equal(r.totalPence, 159);
  // A plain-text part that leads with the web shop's support line and doesn't name the game: the HTML does.
  const both = `From: no-reply <no-reply@appcharge.com>\r\nSubject: Purchase Confirmation #123-456-789\r\nDate: Sat, 31 Oct 2026 13:16:00 +0000\r\nContent-Type: multipart/alternative; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPurchase Confirmation\r\nFor questions or assistance,\r\ncontact Appcharge support\r\nReceipt Number: 123-456-789\r\nOrder ID: 6ae5ea283b95\r\nPayment Date: October 31, 2026\r\nTotal £1.59\r\n--b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n--b--\r\n`;
  const rb = parseReceiptEmail(both);
  assert.equal(rb.retailer.name, "Example Quest");
  assert.deepEqual(rb.items.map(i => i.name), ["2,200 Coins"]);
  // The same when the web shop signs the email with its own name.
  assert.equal(parseReceiptEmail(htmlMail("Appcharge <no-reply@appcharge.com>", "Purchase Confirmation #123-456-789", "Sat, 31 Oct 2026 13:16:00 +0000", html)).retailer.name, "Example Quest");
});
t("takeaway: 'Total:' and its amount on separate lines with column edges between", () => {
  const html = `<table><tr><td>1</td><td>Chicken Wrap</td><td>£7.00</td></tr></table>
<table><tr><td>Subtotal:</td></tr><tr><td>£7.00</td></tr><tr><td>Service fee 11% (min £0.99 max £2.99):</td></tr><tr><td>£0.99</td></tr>
<tr><td>Delivery:</td></tr><tr><td>£0.99</td></tr><tr><td>Total:</td></tr><tr><td>£8.98</td></tr></table>`;
  const r = parseReceiptEmail(htmlMail("Example Eats <orders@exampleeats.test>", "Your order's been received", "Mon, 15 Sep 2025 19:02:00 +0100", html));
  assert.equal(r.totalPence, 898);
  assert.deepEqual(r.items.map(i => [i.name, i.pricePence]), [["Chicken Wrap", 700]]);
});

t("pub order-and-pay: a name split over two cells ('Guinness' then '(Pint)')", () => {
  const html = `<table><tr><td>Qty</td><td>Description</td><td>Amount</td></tr>
<tr><td>1</td><td>Example Stout<br>(Pint)</td><td>£2.99</td></tr><tr><td>1</td><td>Coffee - free refills<br>(Cup)</td><td>£1.25</td></tr>
<tr><td>VAT (20.00%)</td><td>£0.71</td></tr><tr><td>Order Total</td><td>£4.24</td></tr></table>`;
  const r = parseReceiptEmail(htmlMail("The Example Arms <orders@examplearms.test>", "Thank you for your order", "Mon, 04 Mar 2024 14:18:00 +0000", html));
  assert.deepEqual(r.items.map(i => [i.name, i.pricePence, i.variant]), [["Example Stout", 299, "(Pint)"], ["Coffee - free refills", 125, "(Cup)"]]);
});

t("shop order: labels between a row's values ('Quantity', 'Price'); partner offers are not items", () => {
  const html = `<p>Thank you for your order</p><p>Order Details</p>
<p>Example Whey Protein - 1kg - Vanilla</p><p>Quantity</p><p>1</p><p>Price</p><p>£24.99</p>
<p>Example Shaker</p><p>Quantity</p><p>2</p><p>Price</p><p>£6.00</p>
<p>10% off sitewide at Example Kitchen!</p><p>Quantity</p><p>1</p><p>Price</p><p>£1.00</p><p>Free Example Recipe box</p><p>Quantity</p><p>1</p><p>Price</p><p>£10.00</p>
<p>Example Music Unlimited – Get 3 months free</p><p>Quantity</p><p>1</p><p>Price</p><p>£5.00</p><p>Subtotal</p><p>£30.99</p><p>Order Total</p><p>£30.99</p>`;
  const r = parseReceiptEmail(htmlMail("Example Nutrition <orders@examplenutrition.test>", "Your order confirmation", "Mon, 04 Mar 2024 14:18:00 +0000", html));
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.pricePence]), [["Example Whey Protein - 1kg - Vanilla", 1, 2499], ["Example Shaker", 2, 600]]);
});

t("Shopify-style: a product name that starts with a number ('260 - Inspired by ... × 1')", () => {
  const r = parseReceiptEmail(`From: Example Scents <shop@examplescents.test>\nSubject: Order #1042 confirmed\nContent-Type: text/plain\n\nThank you for your purchase!\nOrder summary\n260 - Inspired by Example For Her × 1\n100ml\n£24.85\nSubtotal\n£24.85\nTotal\n£24.85\n`);
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.pricePence, i.variant]), [["260 - Inspired by Example For Her", 1, 2485, "100ml"]]);
});
t("pay-later email: the shop it paid is the shop, and what's left to pay is not an item", () => {
  const html = `<p>Payment received for Example Athletica</p><p>Your payment of £39.33 was successful.</p>
<table><tr><td>Summary</td></tr><tr><td>Example Athletica</td></tr><tr><td>Merchant order reference</td><td>EA05027025</td></tr>
<tr><td>Order placed</td><td>19 November 2025</td></tr><tr><td>Paid</td><td>£39.33</td></tr><tr><td>Left to pay</td><td>£78.67</td></tr>
<tr><td>Order details</td></tr><tr><td>Define Jacket *Example</td><td>£118.00</td></tr><tr><td>Delivery</td><td>£0.00</td></tr><tr><td>Total</td><td>£118.00</td></tr></table>`;
  const r = parseReceiptEmail(htmlMail("Klarna <noreply@klarna.co.uk>", "Payment received for Example Athletica", "Wed, 19 Nov 2025 10:00:00 +0000", html));
  assert.equal(r.ok, true);
  assert.equal(r.retailer.name, "Example Athletica");
  assert.equal(r.retailer.via, "klarna.co.uk");
  assert.deepEqual(r.items.map(i => [i.name, i.pricePence]), [["Define Jacket *Example", 11800]]);
  assert.equal(r.totalPence, 11800);
});
t("'Sub Total' is not the total: 'Total Including Delivery' is, and a sub-total alone is still read", () => {
  const body = ["Order Reference: 300000000001", "| | Qty | Item | Delivery Address", "1 | Garden Chair Set GC20 | 4 Sample Road | By 09/01/2026 | £ 89.00 |",
    "| Sub Total | £ 89.00 |", "| Total Discount | £ 0.00 |", "Delivery | £ 3.99 |", "Total Including Delivery | £ 92.99 |"].join("\n");
  const r = parseReceiptEmail(`From: orders@examplehomestore.test\nSubject: Thank you for your order\nContent-Type: text/plain\n\n${body}\n`);
  assert.equal(r.ok, true); assert.equal(r.totalPence, 9299);
  const onlySub = parseReceiptEmail(`From: orders@examplehomestore.test\nSubject: Thank you for your order\nContent-Type: text/plain\n\nOrder number: EH-1001\nOak Shelf £40.00\nSub Total £40.00\n`);
  assert.equal(onlySub.totalPence, 4000, "with no other total the sub-total is still the best figure");
  const both = parseReceiptEmail(`From: orders@examplehomestore.test\nSubject: Thank you for your order\nContent-Type: text/plain\n\nOrder number: EH-1002\nSub-total: £40.00\nTotal: £43.50\n`);
  assert.equal(both.totalPence, 4350);
});
t("money off the next order, and a promo code or credit earned by an order, are offers, not receipts", () => {
  const mk = (subject, body) => `From: "Example Eats" <offers@exampleeats.test>\nSubject: ${subject}\nContent-Type: text/plain\n\n${body}\n`;
  assert.equal(parseReceiptEmail(mk("Up to £7 off your next order", "Time to re-order\nSave £7 on your next order of £25+\nTotal savings: £12.40\nOrder #: see app")).reason, "promotional");
  assert.equal(looksPromotional("Save £5 on your first shop", {}, false), true);
  assert.equal(looksPromotional("Get £10 off when you spend £50", {}, false), true);
  assert.equal(looksPromotional("Your Example Eats order", {}, false), false);
  const credit = parseReceiptEmail(`From: "Example Market" <no-reply@examplemarket.test>\nSubject: Here's your promotional credit from your recent Example Market order\nContent-Type: text/plain\n\nThank you for purchasing (Order 202-0000000-0000001). Your order entitles you to a promotional code.\nOrder number: 202-0000000-0000001\nYour promotional code: ABCD-EFGH\nOrder total £60.00\n`);
  assert.equal(credit.reason, "promotional", "even though it names the order that earned it");
  const real = parseReceiptEmail(mk("Your order confirmation #EE-2001 - plus £5 off your next order", "Order number: EE-2001\nNoodle Box £8.50\nTotal £8.50"));
  assert.equal(real.ok, true, "an order confirmation that also offers money off is still a receipt"); assert.equal(real.totalPence, 850);
});
t("a receipt sent through an email company (Mandrill, Mailgun…) names the restaurant, never the email company", () => {
  const r = parseReceiptEmail(`From: "Example Noodles - Example Noodles Leeds" <orders@mandrillapp.com>\nSubject: Your order confirmation #01234\nContent-Type: text/plain\n\nThank you for ordering from Example Noodles - Example Noodles Leeds, your order has been placed.\nOrder reference 01234\nLager | x1 | £4.80\nTotal: | £4.80\n`);
  assert.equal(r.ok, true); assert.equal(r.retailer.name, "Example Noodles"); assert.equal(r.retailer.via, "mandrillapp.com");
  assert.notEqual(r.retailer.domain, "mandrillapp.com"); assert.equal(r.totalPence, 480);
});
const multiMail = (from, subject, plainText, html) => [`From: ${from}`, `Subject: ${subject}`, "Date: Thu, 25 Sep 2025 10:00:00 +0000", 'Content-Type: multipart/alternative; boundary="b1"', "", "--b1",
  "Content-Type: text/plain; charset=utf-8", "", plainText, "--b1", "Content-Type: text/html; charset=utf-8", "", html, "--b1--", ""].join("\r\n");
const textMail = (from, subject, body) => `From: ${from}\r\nSubject: ${subject}\r\nDate: Thu, 25 Sep 2025 10:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
t("a marketplace's 'Ordered:' email: invisible direction marks and padding, '5 GBP' prices, a bulleted item", () => {
  const r = parseReceiptEmail(multiMail('"Example Market" <auto-confirm@examplemarket.test>', "Ordered: \u2018Linen Notebook A5...\u2019",
    ["Thanks for your order!", "Arriving tomorrow", "Order #", "301-0000000-0000001", "View or edit order", "* Linen Notebook A5 Ruled", "Quantity: 1", "5 GBP", "Total", "5 GBP",
      "This e-mail is only an acknowledgement of receipt of your order."].join("\n"),
    "<p>Thanks for your order!</p><p>Order # \u202B301-0000000-0000001</p><p>Linen Notebook A5 Ruled</p><p>Quantity: 1</p><p>&pound; 5 <sup>00</sup></p><p>Total</p><p>&pound;5.00</p><p>&zwnj;&#8204;&#847;</p>"));
  assert.equal(r.ok, true); assert.equal(r.orderRef, "301-0000000-0000001"); assert.equal(r.totalPence, 500);
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.pricePence]), [["Linen Notebook A5 Ruled", 1, 500]]);
  const two = parseReceiptEmail(textMail('"Example Market" <auto-confirm@examplemarket.test>', "Ordered: \u2018Tea Towels...\u2019", "Thanks for your order!\nOrder #\n301-0000000-0000002\n* Tea Towels Set\nQuantity: 2\n8 GBP\nTotal\n8 GBP"));
  assert.deepEqual(two.items.map(i => [i.name, i.qty, i.pricePence]), [["Tea Towels Set", 2, null]], "with 2 of them, it isn't said whether the price is each");
  assert.equal(parseReceiptEmail(textMail("orders@example.test", "Your order", "Order number: EX-1\nTotal \u00a30.00 GBP")).totalPence, 0, "'£0.00 GBP' isn't read twice");
});
t("receipts named in other ways: 'Your 25 September receipt for 1 item', 'Example Market order of Film Night.'", () => {
  const shop = parseReceiptEmail(textMail('"Example Fresh" <auto-confirm@examplemarket.test>', "Your 25 September receipt for 1 item",
    "Thank you for shopping with us. Here is the receipt for your recent trip.\nOrder # 302-0000000-0000003 (1 item)\nTotal \u00a39.00"));
  assert.equal(shop.ok, true); assert.equal(shop.retailer.name, "Example Fresh"); assert.equal(shop.totalPence, 900);
  const film = parseReceiptEmail(textMail('"Example Market" <digital-no-reply@examplemarket.test>', "Example Market order of Film Night.",
    "Order details\nOrder #D01-0000000-0000004\nFilm Night\nSold by :Example Digital Ltd\n\u00a35.99\nItem Subtotal: \u00a34.99\nTotal Before Tax: \u00a34.99\nTax Collected: \u00a31.00\nGrand Total: \u00a35.99"));
  assert.equal(film.ok, true); assert.equal(film.orderRef, "D01-0000000-0000004"); assert.equal(film.totalPence, 599, "the grand total, not the total before tax");
  const sent = textMail('"Example Market" <ship@examplemarket.test>', 'Your Example Market order of "Tea Towels" has been dispatched', "Order #D01-0000000-0000005\nGrand Total: \u00a35.99");
  assert.equal(parseReceiptEmail(sent).ok, false, "a dispatch notice named that way isn't a second purchase");
});
t("a total written only as '£33.76 (Including VAT)'; a booking's confirmation number is its reference", () => {
  const pizza = parseReceiptEmail(textMail('"Example Pizza" <orders@examplepizza.test>', "Order confirmation", "Your order number is 600000001\n1x Large Margherita\nDelivery: \u00a32.99\n\u00a333.76 (Including VAT)"));
  assert.equal(pizza.totalPence, 3376);
  const table = parseReceiptEmail(textMail('"Example Tables" <no-reply@exampletables.test>', "Your booking confirmation for Example Bistro",
    "Booking confirmed\nTable for 2 on Monday, 24 July 2023 at 18:30\nConfirmation # : 2100000001\n2 x Tasting Menu\n\u00a392.00\nTotal\n\u00a392.00"));
  assert.equal(table.orderRef, "2100000001", "so a second email about the same booking is matched to it"); assert.equal(table.totalPence, 9200);
});
t("bonus points offers and deposits into an account aren't purchases", () => {
  assert.equal(parseReceiptEmail(textMail('"Example Airways Club" <club@exampleairways.test>', "3,000 bonus points with your summer wine order", "Order before 21 July and earn 3,000 bonus points.\nTotal savings \u00a320")).reason, "promotional");
  const dep = parseReceiptEmail(textMail('"Example Games" <support@examplegames.test>', "Deposit Confirmation",
    "Thank you for making a deposit at Example Games.\nYour deposit of GBP100,00 has now been credited to your account.\nOrder number: 1000000001\nTotal: \u00a3100.00"));
  assert.equal(dep.ok, false); assert.equal(dep.reason, "account_deposit");
  const sofa = parseReceiptEmail(textMail("orders@examplesofas.test", "Your order confirmation #ES-1", "Order number: ES-1\nDeposit paid today: \u00a3100.00\nTotal: \u00a3900.00"));
  assert.equal(sofa.ok, true, "a deposit towards an order is still a purchase");
});
t("a payment platform's receipt is named after the business it paid ('Merchant: …'), with plain-text bold read", () => {
  const r = parseReceiptEmail(textMail('"PayLink Mobile" <receipts@social-commerce.io>', "Thanks for your order to Example Lettings",
    "PayLink Mobile\nThanks for your order to Example Lettings\n## Merchant: Example Lettings\nOrder Number: **270000001**\n| Purchase details | Price |\n| Holding deposit | \u00a3500.00 |\n| **Total** | **\u00a3500.00** |\n\u00a9 2024 PayLink Mobile. All rights reserved."));
  assert.equal(r.retailer.name, "Example Lettings"); assert.equal(r.retailer.via, "social-commerce.io");
  assert.equal(r.totalPence, 50000); assert.equal(r.orderRef, "270000001");
});
console.log(`\n${passed} receipt-parser tests passed in all (synthetic emails only)`);
