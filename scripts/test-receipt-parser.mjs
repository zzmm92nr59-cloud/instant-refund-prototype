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
console.log(`\n${passed} receipt-parser tests passed in all (synthetic emails only)`);
