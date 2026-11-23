// Round 25 (23 Nov 2026), reader version 62: fixes from the blind checks of a real inbox. Every email here is MADE UP:
// shops, games, apps, venues, items, prices, people and numbers.
//  1. A payment through PayPal to a company that sells for a game or app (Appcharge, Paddle…) with no receipt from it: the
//     shop is the game or app, when the payment names it or every receipt that company sent the shopper names one game.
//  2. A shop on Relay's list keeps its own spelling: "TK Maxx", never "Tkmaxx" from its web address or "TK MAXX".
//  3. A booking fee said only in a sentence under the total is its own fee line.
//  4. A refund that matches a paid item's price on an order with a free £0 gift is that item.
//  5. A refund with no order number and no amount finds its booking, and says refunded with no amount made up.
//  6. A meal deal's part "1 6 Chicken Bites" is one "6 Chicken Bites"; a counter's three-figure order number only joins
//     emails of the same day.
//  7. The new patterns take linear time on a 40,000-character line and a line of 40,000 spaces.
//   node scripts/test-receipt-real-62.mjs
import assert from "node:assert/strict";
import * as G from "../worker/gmail.js";
import { shopDisplayName } from "../worker/receipt-category.js";
import { realInbox } from "./real-receipts.mjs";
import { rawEmail, fixture, page, h } from "./fixtures/receipt-emails/lib.mjs";
import { GAME_RECEIPT_NUMBER } from "./fixtures/receipt-emails/holdout25.mjs";

const { classifyEmail, mergeOrderEmails, attachReturnProgress, itemsForRefund, PARSER_VERSION } = G;
const raw = (m, id = "x") => rawEmail({ ...fixture(id, "", "", m, {}) });
let n = 0;
const read = (m, id) => ({ ...classifyEmail(raw(m, id), { gmailId: id }).details, id, createdAt: ++n });
const rows = (lines) => `<table>${lines.map((l) => `<tr>${l.split(" | ").map((c) => `<td>${h(c)}</td>`).join("")}</tr>`).join("")}</table>`;
assert.equal(PARSER_VERSION, 62);

const paypal = (to, item, pid, price, date, tid) => ({ from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to " + to, date,
  html: page({ brand: "PayPal", domain: "paypal.co.uk", rows: [rows(["Receipt for your payment to " + to, "Sam Taylor, you've successfully sent a payment.", "You paid £" + price + " GBP to " + to,
    "Merchant", to, "help@" + to.toLowerCase().split(/[ .]/)[0] + ".example", "Transaction date", "2 Oct 2026"]) +
    `<table><tr><td><span>${h(item)}</span><br>Qty: 1<br>Product ID: ${h(pid)}</td><td>&pound;${price}</td></tr></table>` +
    rows(["Subtotal | £" + price, "Total | £" + price + " GBP", "Paid " + to + " with", "Visa Debit ••0000", "Transaction ID: " + tid])] }) });

// 1 and 2. Through Relay's own scan and receipts list, as the app gets them.
{
  const box = realInbox({ now: Date.UTC(2027, 0, 10, 12) });
  await box.start("sam.taylor@example.co.uk");
  // The game's own receipt from its web shop, at another time and for other money, and two payments through PayPal alone.
  box.deliver(raw(GAME_RECEIPT_NUMBER, "g1"));
  box.deliver(raw(paypal("Appcharge ltd", "Tile Market Offer", "home_offer_3", "2.39", "Mon, 12 Oct 2026 18:00:00 +0000", "1AB23456CD7890123"), "pp1"));
  // (A payment to a software reseller whose item names the app: "[CLIPWISE] 1x Clipwise".)
  box.deliver(raw(paypal("Paddle.com Market Ltd", "[CLIPWISE] 1x Clipwise", "pro_monthly", "9.99", "Tue, 13 Oct 2026 09:00:00 +0000", "2CD34567EF8901234"), "pp2"));
  // A shop on Relay's list that writes its name in capitals and sends from a mailing address.
  box.deliver(raw({ from: "TK MAXX <donotreply@tr.tkmaxx.com>", subject: "Order confirmation", date: "Wed, 14 Oct 2026 10:00:00 +0000",
    html: page({ brand: "TK MAXX", domain: "tkmaxx.com", rows: [rows(["Thanks for your order", "Order number: 55510001", "Grey Wool Scarf | 1 | £12.99", "Delivery | £3.99", "Total | £16.98"])] }) }, "tk1"));
  // And one known only by its web address.
  box.deliver(raw({ from: "Orders <orders@newlook.com>", subject: "Your order is confirmed", date: "Thu, 15 Oct 2026 10:00:00 +0000",
    text: "Thanks for your order\nOrder number: NL55510002\n1 x Black Jeans £25.99\nTotal £25.99\n" }, "nl1"));
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const r = await box.call("/relay/my/gmail/scan", { method: "POST", body: { year: 2026, ...(cursor ? { cursor } : {}) } });
    if (r.status === 503) continue;
    assert.equal(r.status, 200, JSON.stringify(r.body));
    if (!r.body.more) break; cursor = r.body.cursor;
  }
  const list = (await box.receipts(true)).receipts;
  const shops = list.map((r) => r.retailer.name);
  const game = list.filter((r) => r.totalPence === 239);
  assert.equal(game.length, 1, JSON.stringify(shops));
  assert.equal(game[0].retailer.name, "Tile Quest", "the payment to the game's web shop is the game's, as its own receipts say: " + game[0].retailer.name);
  const app = list.find((r) => r.totalPence === 999);
  assert.ok(app, JSON.stringify(shops));
  assert.equal(app.retailer.name, "Clipwise", "the app the payment's item names: " + app.retailer.name);
  const tk = list.find((r) => r.orderRef === "55510001");
  assert.equal(tk && tk.retailer.name, "TK Maxx", "the shop's own spelling: " + (tk && tk.retailer.name));
  const nl = list.find((r) => r.orderRef === "NL55510002");
  assert.equal(nl && nl.retailer.name, "New Look", "the shop's own spelling: " + (nl && nl.retailer.name));
  assert.ok(!shops.some((s) => /^(?:appcharge|paddle|tkmaxx|newlook|tk maxx$)/.test(String(s).toLowerCase()) && s !== "TK Maxx"), JSON.stringify(shops));
  console.log("ok - a payment through PayPal to a game's or app's seller is the game's or app's; listed shops keep their own spelling");
}
{
  // (When the game web shop's receipts name two games, or none, the payment can't say which: it keeps the company's name.)
  const p = read(paypal("Appcharge ltd", "Gem Offer", "offer_1", "1.99", "Mon, 12 Oct 2026 18:00:00 +0000", "3EF45678GH9012345"), "pp3");
  const two = G.gamesByShop([{ retailer: { name: "Tile Quest", domain: "appcharge.com" } }, { retailer: { name: "Farm Friends", domain: "appcharge.com" } }]);
  assert.equal(G.resellerSeller(p, two), null);
  assert.equal(G.resellerSeller(p, G.gamesByShop([])), null);
  // (Nor is a shop's own name ever changed: only a payment to a reseller.)
  assert.equal(G.resellerSeller({ retailer: { name: "Harbour Hardware Ltd", via: "paypal.co.uk" }, items: [{ name: "[TILES] Floor tiles" }] }, two), null);
  for (const [name, domain, want] of [["Tkmaxx", "tr.tkmaxx.com", "TK Maxx"], [null, "tkmaxx.com", "TK Maxx"], ["TK MAXX", "tkmaxx.com", "TK Maxx"], ["Riverisland", "riverisland.com", "River Island"],
    [null, "johnlewis.com", "John Lewis"], [null, "thebodyshop.com", "The Body Shop"], [null, "hm.com", "H&M"], ["ASOS", "asos.com", "ASOS"], ["Harbour Hardware", "harbourhardware.example", "Harbour Hardware"]])
    assert.equal(shopDisplayName({ name, domain }), want, name + " " + domain);
  console.log("ok - with two games or none, the payment keeps its own name; a shop not on the list keeps its name");
}

// 3. A booking fee in a sentence.
{
  const m = (fee, total) => ({ from: "Starlight Cinemas <tickets@starlighttickets.example>", subject: "Starlight Tickets for Space Pups #QX7RT2B", date: "Sat, 21 Nov 2026 12:00:00 +0000",
    html: page({ brand: "Starlight Cinemas", domain: "starlighttickets.example", rows: [rows(["Sam, thanks for your booking!", "Your booking reference number is:", "QX7RT2B", "Tickets", "2 X Adult | £9.50",
      "Sub-total", "£19.00", "Total (incl. VAT):", "£" + total, "This total includes a non-refundable booking fee of £" + fee + ". Some promotional tickets exclude booking fees."])] }) });
  const r = read(m("2.10", "21.10"), "c1");
  assert.equal(r.totalPence, 2110);
  assert.deepEqual(r.fees, [{ label: "Booking fee", pence: 210 }], JSON.stringify(r.fees));
  assert.deepEqual(r.items.map((i) => [i.name, i.qty, i.pricePence]), [["Adult", 2, 950]]);
  // (A fee that doesn't make the tickets come to the total is not taken.)
  const odd = read(m("3.00", "21.10"), "c2");
  assert.ok(!(odd.fees || []).some((f) => f.pence === 300), JSON.stringify(odd.fees));
  console.log("ok - 'This total includes a booking fee of £…' is its own fee line");
}

// 4. A refund and a free gift.
{
  const items = [{ name: "Trail Shoes", pricePence: 6500 }, { name: "Running Socks", pricePence: 1200 }, { name: "Free Water Bottle", pricePence: 0 }];
  assert.deepEqual(itemsForRefund(items, 6500), [0], "the shoes, not 'shoes or shoes and the gift'");
  assert.deepEqual(itemsForRefund(items, 1200), [1]);
  assert.deepEqual(itemsForRefund([{ name: "Trail Shoes", pricePence: 6500 }, { name: "Free Tote", pricePence: 0 }], 6500), [0], "the one paid item, the gift kept");
  assert.deepEqual(itemsForRefund(items, 7700), [0, 1], "every paid item: those items, the free gift kept");
  assert.equal(itemsForRefund(items.slice(0, 2), 7700), null, "with no gift, every item is the whole order: not an item-by-item answer");
  assert.equal(itemsForRefund([{ name: "A", pricePence: 1000 }, { name: "B", pricePence: 1000 }, { name: "Gift", pricePence: 0 }], 1000), null, "two items still fit equally: don't guess");
  console.log("ok - a free £0 gift never makes a refund's item unclear");
}

// 5. A refund with no number and no amount.
{
  const booking = (venue, domain, date, ref, operator) => ({ from: venue + " <info@" + domain + ">", subject: "Your booking with " + venue + "! - " + ref, date,
    text: "Hello\nThank you for your booking. We look forward to welcoming you to\n" + venue + ".\nYour booking details:\nICE RINK 16:15PM\nFAMILY TICKET - Max 4 People\n4 people\n×1\n£40.00\n" +
      "Important Information:\nPlease ensure you have this email confirmation and the attached QR code ready to show on arrival.\n" + (operator ? "[" + operator + "]\n" : "") + venue + ", Market Square\n",
    html: `<html><body><p>Thank you for your booking.</p><p>Your booking details:</p><p>ICE RINK 16:15PM</p><table><tr><td>FAMILY TICKET - Max 4 People</td><td>4 people</td><td>×1</td><td>&pound;40.00</td></tr></table>` +
      (operator ? `<p><img src="https://img.example/logo.png" width="50" alt="${h(operator)}"></p>` : "") + `<p>${h(venue)}, Market Square</p></body></html>` });
  const refund = { from: "Pat Example <p.example@northgateleisuregroup.example>", subject: "Refund Processed.", date: "Sun, 24 Nov 2026 11:00:00 +0000",
    text: "Hi Sam,\nYour refund has been processed.\nIt can take 5 working days for you to receive your money.\nKind Regards,\nPat\nCustomer Service Assistant\n" };
  const o = read(booking("Riverside Ice Rink", "riversideicerink.example", "Mon, 11 Nov 2026 13:00:00 +0000", "7700123", "Northgate Leisure Group"), "b1");
  assert.equal(o.kind, "receipt"); assert.equal(o.totalPence, 4000);
  const u = read(refund, "u1");
  assert.equal(u.kind, "return_update"); assert.equal(u.stage, "refunded"); assert.equal(u.amountPence, null);
  const other = read(booking("Lakeside Lanes", "lakesidelanes.example", "Tue, 12 Nov 2026 13:00:00 +0000", "8800456", null), "b2");
  const cards = mergeOrderEmails([structuredClone(o), structuredClone(other)]);
  attachReturnProgress(cards, [], [u]);
  const rink = cards.find((c) => c.orderRef === "7700123"), lanes = cards.find((c) => c.orderRef === "8800456");
  assert.ok(rink.returnProgress && rink.returnProgress.refundedAt, "the refund finds the booking whose email named the company: " + JSON.stringify(rink.returnProgress));
  assert.equal(rink.returnProgress.refundPence, null, "no amount made up");
  assert.equal(lanes.returnProgress, undefined);
  // (Two bookings that both name the company: Relay can't tell which, so neither is marked.)
  const both = mergeOrderEmails([structuredClone(o), read(booking("Riverside Ice Rink", "riversideicerink.example", "Wed, 13 Nov 2026 13:00:00 +0000", "7700999", "Northgate Leisure Group"), "b3")]);
  attachReturnProgress(both, [], [u]);
  assert.ok(both.every((c) => !c.returnProgress), JSON.stringify(both.map((c) => c.returnProgress)));
  // (A refund sent before the booking, or long after it, is not its refund.)
  const early = mergeOrderEmails([structuredClone(o)]);
  attachReturnProgress(early, [], [{ ...u, at: "2026-11-01" }, { ...u, at: "2027-08-01" }]);
  assert.equal(early[0].returnProgress, undefined);
  console.log("ok - a refund with no number and no amount finds its one booking and says refunded with no amount");
}

// 6. A meal deal's part, and a counter's short order number.
{
  const m = (when, od, item, price) => ({ from: "Burger Barn <receipts@burgerbarn.example>", subject: "Thanks for your order!", date: when,
    html: page({ brand: "Burger Barn", domain: "burgerbarn.example", rows: [rows(["We got your order, here's your receipt.", "Order Date:", od, "Order Number:", "042",
      "Qty | Item Detail | Item Cost", "1 | " + item + " | £" + price, "1 | £1.19 6 Chicken Bites or 4 Veggie Bites When ordering on the app | ", " | 1 6 Chicken Bites | £1.19", " | 1 Hot Sauce | ",
      "Total (including VAT): | £" + (Number(price) + 1.19).toFixed(2)])] }) });
  const a = read(m("Sat, 14 Nov 2026 22:10:00 +0000", "14/11/26 22:10", "Cheese Burger", "3.99"), "m1");
  assert.ok(a.items.some((i) => i.name === "6 Chicken Bites" && i.qty === 1), JSON.stringify(a.items));
  assert.ok(!a.items.some((i) => /^1 6\b/.test(i.name)), JSON.stringify(a.items));
  const b = read(m("Sat, 21 Nov 2026 12:10:00 +0000", "21/11/26 12:10", "Fish Burger", "4.49"), "m2");
  assert.equal(a.orderRef, "042"); assert.equal(b.orderRef, "042");
  const cards = mergeOrderEmails([structuredClone(a), structuredClone(b)]);
  assert.equal(cards.length, 2, "two orders a week apart with the counter's same number are two purchases");
  // (The same order's email sent twice on its day is still one.)
  assert.equal(mergeOrderEmails([structuredClone(a), { ...structuredClone(a), id: "m1b", createdAt: ++n }]).length, 1);
  console.log("ok - a meal deal's part keeps how many apart; a counter's number joins only on its own day");
}

// 7. Linear time.
{
  const long = "a".repeat(40000), spaces = " ".repeat(40000);
  for (const body of [long, spaces, "This total includes a non-refundable booking fee of £" + spaces, "The total includes a " + spaces + "booking fee of £1.00", "1 6 " + long, "1 " + spaces + "6 Chicken",
    "[" + long + "] 1x App", "[" + spaces + "]", "Your refund has been processed." + spaces]) {
    for (const m of [{ from: "Shop <a@shop.example>", subject: "Your order", date: "Mon, 01 Jun 2026 10:00:00 +0000", text: body },
      { from: "Shop <a@shop.example>", subject: "Your order", date: "Mon, 01 Jun 2026 10:00:00 +0000", html: `<html><body><p>${h(body)}</p><img alt="${h(body.slice(0, 30000))}"><img ${spaces} alt="A Group"></body></html>` },
      { from: "PayPal <service@paypal.co.uk>", subject: "Receipt for your payment to Appcharge ltd", date: "Mon, 01 Jun 2026 10:00:00 +0000", text: "You paid £1.00 GBP to Appcharge ltd\n" + body },
      { from: "Pat <p@group.example>", subject: "Refund Processed.", date: "Mon, 01 Jun 2026 10:00:00 +0000", text: body }]) {
      const t0 = Date.now();
      const d = classifyEmail(raw(m)).details;
      if (d) G.resellerSeller({ ...d, retailer: { name: "Paddle.com", via: "paypal.co.uk" }, items: [{ name: body }] }, new Map());
      assert.ok(Date.now() - t0 < 3000, "took " + (Date.now() - t0) + "ms");
    }
  }
  console.log("ok - the new patterns take linear time on long lines");
}
console.log("all round 25 reader checks passed");
