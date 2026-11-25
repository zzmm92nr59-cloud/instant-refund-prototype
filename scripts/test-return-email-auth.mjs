// Offline test: a return "fact" from an email counts only when the email checks out for its own sender (security review M4,
// 25 Nov 2026). The shopper owns the inbox Relay reads, so a carrier's "your return was delivered to the shop" or a shop's
// "we've received your return" could be planted there. Where the receiving mail service wrote down how the email checked
// out (Authentication-Results), the email must pass DMARC, or DKIM or SPF aligned with the From domain; one that fails is
// never a carrier's or shop's word (it makes no returnInTransit, returnReceived or onItsWay). And any fact from an email is
// marked as not enough to pay on (returnFacts payable: false): only the carrier's own tracking scan is.
// Made-up shops, people and tracking numbers.
import assert from "node:assert/strict";
import { senderCheckOf, orgDomain } from "../worker/mail-auth.js";
import { classifyEmail } from "../worker/gmail.js";
import { attachReturnTracking, returnFacts } from "../worker/return-tracking.js";

const DAY = 864e5, NOW = Date.now(), TODAY = new Date(NOW).toISOString().slice(0, 10);
const ago = (n) => new Date(NOW - n * DAY).toISOString().slice(0, 10);
const mail = (from, subject, body, auth) => (auth ? "Authentication-Results: " + auth + "\r\n" : "") +
  `From: ${from}\r\nTo: sam@example.com\r\nSubject: ${subject}\r\nDate: ${new Date(NOW - DAY).toUTCString()}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;

// 1. Reading the header.
{
  const rm = "Royal Mail <no-reply@royalmail.com>";
  assert.equal(orgDomain("notifications.evri.com"), "evri.com");
  assert.equal(orgDomain("mail.kestrel.co.uk"), "kestrel.co.uk");
  assert.equal(senderCheckOf(mail(rm, "x", "y")), null, "no header: can't tell");
  assert.equal(senderCheckOf(mail(rm, "x", "y", "mx.google.com; dkim=pass header.i=@royalmail.com header.s=s1; spf=pass smtp.mailfrom=bounce.royalmail.com; dmarc=pass (p=REJECT) header.from=royalmail.com")), "pass");
  assert.equal(senderCheckOf(mail(rm, "x", "y", "mx.google.com; dkim=pass header.i=@mailer.royalmail.com; spf=softfail smtp.mailfrom=x@elsewhere.example")), "pass", "DKIM aligned with the From domain");
  assert.equal(senderCheckOf(mail(rm, "x", "y", "spf=pass (sender IP is 192.0.2.1) smtp.mailfrom=royalmail.com; dkim=none (message not signed) header.d=none;dmarc=pass action=none header.from=royalmail.com")), "pass", "Outlook's way of writing it");
  assert.equal(senderCheckOf(mail(rm, "x", "y", "mx.google.com; dkim=pass header.i=@sender.example; spf=pass smtp.mailfrom=me@sender.example; dmarc=fail (p=REJECT) header.from=royalmail.com")), "fail",
    "signed and sent by someone else: not Royal Mail");
  assert.equal(senderCheckOf(mail(rm, "x", "y", "mx.google.com; spf=neutral smtp.mailfrom=royalmail.com; dmarc=none header.from=royalmail.com")), "fail");
  // Only the topmost header counts: one the email arrived with, under the receiving service's own, says nothing.
  const two = "Authentication-Results: mx.google.com; dmarc=fail header.from=royalmail.com\r\n" + mail(rm, "x", "y", "mx.google.com; dmarc=pass header.from=royalmail.com");
  assert.equal(senderCheckOf(two), "fail");
  console.log("ok - the receiving service's Authentication-Results: pass only for the From domain, fail otherwise, nothing said when absent");
}

// 2. The reader keeps the answer on a carrier's or shop's return email.
const delivered = (auth) => mail("Royal Mail <no-reply@royalmail.com>", "Your return has been delivered",
  "Your return to Kestrel Outdoor has been delivered to Kestrel Outdoor.\nTracking number: KO123456789GB", auth);
const shopGot = (auth) => mail("Kestrel Outdoor <returns@kestrel-outdoor.example>", "We've received your return",
  "Hi Sam, we've received your return.\nOrder number: KO-1001\nWe'll let you know once your refund is processed.", auth);
const FAIL = "mx.google.com; dkim=pass header.i=@sender.example; spf=pass smtp.mailfrom=me@sender.example; dmarc=fail header.from=royalmail.com";
const FAIL_SHOP = "mx.google.com; dkim=pass header.i=@sender.example; spf=pass smtp.mailfrom=me@sender.example; dmarc=fail header.from=kestrel-outdoor.example";
const PASS = "mx.google.com; dkim=pass header.i=@royalmail.com; dmarc=pass header.from=royalmail.com";
{
  const d = (raw) => classifyEmail(raw, { gmailId: "m1" }).details;
  assert.equal(d(delivered(FAIL)).senderCheck, "fail");
  assert.equal(d(delivered(PASS)).senderCheck, "pass");
  assert.equal(d(delivered()).senderCheck, undefined, "nothing said: nothing kept");
  assert.equal(d(shopGot(FAIL_SHOP)).senderCheck, "fail");
  console.log("ok - the reader keeps whether a return email checked out for its sender");
}

// 3. A planted email makes no fact; one that checks out does, but only the carrier's scan is enough to pay on.
{
  const kestrel = { name: "Kestrel Outdoor", domain: "kestrel-outdoor.example" };
  const order = () => ({ id: "a", retailer: kestrel, orderRef: "KO-1001", orderDate: ago(20), totalPence: 8900, items: [{ name: "Jacket", qty: 1, pricePence: 8900 }] });
  const typed = [{ receipt_id: "a", tracking_number: "KO123456789GB", carrier: "Royal Mail", sent_on: ago(4) }];
  const asUpdate = (raw) => ({ ...classifyEmail(raw, { gmailId: "m1" }).details, at: ago(1) });
  // The carrier's email, failing its check.
  let a = order();
  attachReturnTracking([a], { today: TODAY, typed, updates: [asUpdate(mail("Royal Mail <no-reply@royalmail.com>", "Your return is on its way",
    "Your return to Kestrel Outdoor is on its way back.\nTracking number: KO123456789GB", FAIL))] });
  assert.deepEqual([a.returnInTransit, a.returnReceived, a.returnTracking.onItsWay], [false, false, null], "an email that fails its check is nobody's word");
  assert.deepEqual(a.returnTracking.steps[1].from, { by: "you", name: null, via: "app" }, "the step shows only what the shopper said");
  // The shop's "we've received your return", failing its check.
  a = order();
  attachReturnTracking([a], { today: TODAY, updates: [asUpdate(shopGot(FAIL_SHOP))] });
  assert.deepEqual([Boolean(a.returnReceived), a.returnTracking && a.returnTracking.onItsWay], [false, undefined], "a planted 'we've received your return' makes nothing true");
  assert.equal(a.returnTracking, undefined, "and isn't shown as the shop's word");
  // The same email checking out: the shop's word, as before, but not enough to pay on.
  a = order();
  attachReturnTracking([a], { today: TODAY, updates: [asUpdate(shopGot("mx.google.com; dmarc=pass header.from=kestrel-outdoor.example"))] });
  assert.equal(a.returnReceived, true);
  let f = returnFacts(a);
  assert.deepEqual([f.onItsWay.via, f.payable], ["email", false], "from an email: marked so a payout refuses it");
  // No header at all (Outlook, or an email read before this): still the shop's word, still not payable.
  a = order();
  attachReturnTracking([a], { today: TODAY, updates: [asUpdate(shopGot())] });
  assert.deepEqual([a.returnReceived, returnFacts(a).payable], [true, false]);
  // The carrier's own tracking scan: payable.
  a = order();
  attachReturnTracking([a], { today: TODAY, typed, tracked: [{ tracking_number: "KO123456789GB", status: "in_transit", at: ago(2), first_scan: ago(3) + "T09:14:00" }] });
  f = returnFacts(a);
  assert.deepEqual([f.onItsWay && f.onItsWay.via, f.payable], ["tracking", true], "the carrier's own scan");
  console.log("ok - a return email that fails its sender check makes no fact; any fact from an email is marked not payable");
}
console.log("PASS return emails: checked for their own sender; planted ones make no fact; only the carrier's scan is payable");
