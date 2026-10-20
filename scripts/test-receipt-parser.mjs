// Tests for worker/receipt-parser.js using SYNTHETIC emails (invented retailers).
// These prove the parser handles these layouts, not that any real retailer's
// emails parse correctly. Real-world accuracy must be measured on real emails.
import assert from "node:assert/strict";
import { parseReceiptEmail } from "../worker/receipt-parser.js";

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

console.log(`\n${passed} receipt-parser tests passed (synthetic emails only)`);
