// Forwarded copies merge into the shop's order, readable shop names, price wording is never an item,
// photos count only when they're of the item, and the style profile reads only what's on the receipts.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mergeOrderEmails } from "../worker/gmail.js";
import { buildWrapped } from "../worker/wrapped.js";
import { shopDisplayName } from "../worker/receipt-category.js";
import { parseReceiptEmail, photoShowsItem } from "../worker/receipt-parser.js";
const require = createRequire(import.meta.url);
const E = require("../relay-recommendation-engine.js");

// 1. The real shape of the £1,870 duplicate: the shop sent 5 emails about order 1806, and the shopper forwarded 6 copies
// from their own Gmail (one of them read with the wrong year). They are all one purchase.
const shop = (d, i) => ({ id: "s" + i, kind: "receipt", retailer: { domain: "beds.test" }, orderRef: "1806", orderDate: d, totalPence: 187000, currency: "GBP", items: [{ name: "Divan Bed", pricePence: 187000 }], status: "confirmed", createdAt: i });
const fwd = (d, i) => ({ id: "f" + i, kind: "receipt", retailer: { name: "Sam Smith", domain: "gmail.com" }, orderRef: "1806", orderDate: d, totalPence: 187000, currency: "GBP", items: [{ name: "Divan Bed", pricePence: 187000 }], status: "confirmed", createdAt: 10 + i });
const emails = [shop("2026-06-26", 1), shop("2026-07-01", 2), shop("2026-07-06", 3), fwd("2026-06-27", 1), fwd("2026-07-03", 2), fwd("2026-07-07", 3), fwd("2025-07-29", 4)];
const merged = mergeOrderEmails(emails);
assert.equal(merged.length, 1, "one purchase, not two");
assert.equal(merged[0].retailer.domain, "beds.test", "the shop's own email leads, never the forwarded copy");
// A forwarded receipt for a different amount, or one the shop never emailed about, stays separate.
assert.equal(mergeOrderEmails([shop("2026-07-01", 1), { ...fwd("2026-07-01", 9), totalPence: 5000 }]).length, 2, "different amount, different purchase");
assert.equal(mergeOrderEmails([fwd("2026-07-01", 1), { ...fwd("2026-07-01", 2), orderRef: "777" }]).length, 2);
// Two different shops using the same order number are never joined through a forwarded copy.
assert.equal(mergeOrderEmails([shop("2026-07-01", 1), { ...shop("2026-07-01", 2), retailer: { domain: "other.test" } }, fwd("2026-07-02", 3)]).length, 3);
// Wrapped counts it once in each year, even the copy dated a year early.
const w26 = buildWrapped(emails, 2026), w25 = buildWrapped(emails, 2025);
assert.equal(w26.spentPence, 187000);
assert.equal(w25.spentPence, 0, "a forwarded copy with the shop's order number is never counted again in another year");
console.log("PASS forwarded copies join the shop's own order (order number + amount), in the list and in Wrapped");

// 2. Shop names a person would say.
const name = d => shopDisplayName({ domain: d });
assert.equal(name("tvbedsnorthwest.co.uk"), "TV Beds North West");
assert.equal(name("order.just-eat.co.uk"), "Just Eat");
assert.equal(name("thebedstore.co.uk"), "The Bed Store");
assert.equal(name("e.kitchenwarehouse.co.uk"), "Kitchen Warehouse");
assert.equal(name("lululemon.com"), "Lululemon", "unknown brand names are left whole");
assert.equal(name("gymshark.com"), "Gymshark");
assert.equal(name("itsu.com"), "Itsu");
assert.equal(shopDisplayName({ name: "Anthropic Ireland, Limited" }), "Anthropic", "a real name on the receipt still wins");
console.log("PASS shop names from web addresses: split into words only when every piece is a known word");

// 3. "Was £2,200" and "You saved £330" are price wording, not things bought.
const promo = `From: Beds <orders@beds.test>\nSubject: Your order confirmation #1806\nContent-Type: text/plain\n\nOrder number: 1806\nSuper King Divan Bed £1,870.00\nWas £2,200.00\nYou saved £330.00\nOrder total: £1,870.00\n`;
assert.deepEqual(parseReceiptEmail(promo).items.map(i => i.name), ["Super King Divan Bed"]);
console.log("PASS price wording is never read as an item");

// 4. A photo counts as the item's only when it is named after the item, not the shop's logo or an advert.
const mail = img => `From: Example Outfitters <orders@exampleoutfitters.test>\nSubject: Your order confirmation #EO-1\nContent-Type: text/html\n\n<html><body>${img}<p>Order number: EO-1</p><p>Wool jumper - Qty 1 - £59.00</p><p>Order total: £59.00</p></body></html>`;
assert.equal(photoShowsItem(mail('<img src="https://cdn.test/p/123.jpg" alt="Wool jumper, oat" width="300">')), true);
assert.equal(photoShowsItem(mail('<img src="https://cdn.test/wool-jumper.jpg" width="300">')), true, "the address can name it too");
assert.equal(photoShowsItem(mail('<img src="https://cdn.test/a.jpg" alt="Example Outfitters" width="300">')), false, "the shop's name is not the item");
assert.equal(photoShowsItem(mail('<img src="https://cdn.test/a.jpg" alt="New arrivals" width="300">')), false, "an advert is not the item");
assert.equal(photoShowsItem(mail("")), false);
console.log("PASS photos are only the item's when they're named after it");

// 5. Wrapped photos come only from checked photos of things (never food, apps or forwarded copies) and name the item.
const cards = [
  { id: "a", kind: "receipt", retailer: { name: "Lululemon", domain: "lululemon.test" }, orderDate: "2026-03-02", totalPence: 9800, category: "fashion", hasImage: true, items: [{ name: "Align Pant", variant: "Black / 8", pricePence: 9800 }] },
  { id: "b", kind: "receipt", retailer: { name: "Just Eat", domain: "just-eat.test" }, orderDate: "2026-03-03", totalPence: 2500, category: "food", hasImage: true, items: [{ name: "Pizza", pricePence: 2500 }] },
  { id: "c", kind: "receipt", retailer: { name: "Kick Lane", domain: "kicklane.test" }, orderDate: "2026-01-04", totalPence: 8500, category: "fashion", hasImage: false, items: [{ name: "Court Classic Trainers", variant: "White / UK 8", pricePence: 8500 }] },
  { id: "d", kind: "receipt", retailer: { name: "Kick Lane", domain: "kicklane.test" }, orderDate: "2026-05-04", totalPence: 6000, category: "fashion", hasImage: false, items: [{ name: "Oversized Hoodie", variant: "Oat / M", pricePence: 6000 }] }];
const w = buildWrapped(cards, 2026);
assert.deepEqual(w.photos.map(p => p.id), ["a"], "only the checked photo of a thing; the takeaway's picture is left out");
assert.equal(w.photos[0].item, "Align Pant");
assert.deepEqual(w.firstBuy, { shop: "Kick Lane", item: "Court Classic Trainers", date: "2026-01-04" });
assert.equal(w.biggest.item, "Align Pant"); assert.equal(w.biggest.photoId, "a");
assert.ok(!w.things.some(t => t.name === "Pizza"), "food isn't used for style");
assert.equal(w.categories.find(c => c.category === "fashion").topShop.name, "Kick Lane");
assert.equal(w.personality.label, "The Style Seeker");
assert.match(w.personality.why, /most of them from Kick Lane/);
console.log("PASS Wrapped: real photos only, first buy, biggest item, go-to shop per kind, a specific style label");

// 6. Style profile: sizes, colours, kinds of thing, typical spend, all counted from what was bought.
assert.deepEqual(E.sizeOf("Black / 8", "Align Pant"), { kind: "clothing", value: "8" });
assert.deepEqual(E.sizeOf("Oat / M", "Hoodie"), { kind: "clothing", value: "M" });
assert.deepEqual(E.sizeOf("White / UK 9", "Court Trainers"), { kind: "footwear", value: "UK 9" });
assert.deepEqual(E.sizeOf("Grey", "Super King Divan Bed"), { kind: "bed", value: "Super King" });
assert.equal(E.sizeOf("Small batch", "Coffee"), null, "words like 'Small' aren't sizes");
const buys = [
  { item: "Align High-Rise Flared Pant", detail: "Black / M", merchant: "Lululemon", price: 98, verified: true },
  { item: "Define Jacket", detail: "Black / M", merchant: "Lululemon", price: 118, verified: true },
  { item: "Oversized Hoodie", detail: "Oat / M", merchant: "Studio North", price: 55, verified: true },
  { item: "Court Classic Trainers", detail: "White / UK 8", merchant: "Kick Lane", price: 85, verified: true }];
const pr = E.profile(buys, []);
assert.equal(pr.sizes.clothing.value, "M"); assert.equal(pr.sizes.footwear.value, "UK 8");
assert.equal(pr.styles[0].key, "sporty"); assert.equal(pr.palette, "neutrals");
assert.equal(pr.shops[0].name, "Lululemon", "shop names keep their capitals");
assert.match(pr.headline, /^You're sporty and relaxed, mostly in neutrals\. Usually a size M, UK 8 in shoes\. A typical buy is about £\d+\.$/);
assert.equal(E.profile([], []).headline, null, "nothing bought, nothing said");
const ranked = E.rank([{ product: "Silk Dress", variation: "Red / 10", priceMinor: 9000 }, { product: "Align Jogger", variation: "Black / M", priceMinor: 9800 }], buys);
assert.equal(ranked[0].product, "Align Jogger");
assert.match(ranked[0]._relayReason, /usual size \(M\)/);
console.log("PASS style profile: sizes, colours, styles and a plain sentence, all from receipts; your size goes first at any shop");

// 7. The Spotify-style parts: top 5 things, biggest buys, shopping time, shop sprint, regulars, badges, and a year's list.
{
  const c = (id, d, shop, cat, items, t) => ({ id, kind: "receipt", retailer: { name: shop, domain: shop.toLowerCase().replace(/\W/g, "") + ".test" }, orderDate: d, totalPence: t, currency: "GBP", category: cat, items });
  const cards = [];
  for (let m = 1; m <= 8; m++) cards.push(c("a" + m, `2026-${String(m).padStart(2, "0")}-0${m % 2 ? 3 : 4}`, "Apple", "digital", [{ name: "Match Masters", pricePence: 499 }], 499));
  cards.push(c("k1", "2026-03-07", "Kick Lane", "fashion", ["Court Trainers", "Socks", "Cap", "Tee", "Bag"].map((n, i) => ({ name: n, pricePence: 1000 * (i + 1) })), 15000));
  cards.push(c("k2", "2026-04-05", "Kick Lane", "fashion", [{ name: "Socks", pricePence: 1000 }], 1000));
  const w = buildWrapped(cards, 2026);
  assert.deepEqual(w.topItems.slice(0, 2).map(x => [x.name, x.times]), [["Match Masters", 8], ["Socks", 2]], "ranked by how many orders, then spend");
  assert.equal(w.yearList.length, 6);
  assert.deepEqual(w.topBuys.map(x => x.totalPence).slice(0, 2), [15000, 1000]);
  assert.equal(w.topBuys[0].items, 5);
  assert.equal(w.shoppingTime.days, 10); assert.equal(w.shoppingTime.longestMonthStreak, 8);
  assert.equal(w.shoppingTime.weekendShare, 50, "5 of the 10 shopping days were a Saturday or Sunday");
  const kl = w.sprint.find(x => x.name === "Kick Lane");
  assert.deepEqual(kl.months.slice(0, 5), [0, 0, 1, 1, 0]);
  assert.deepEqual(w.subscriptions, [{ name: "Apple", months: 8, spentPence: 3992, item: "Match Masters" }], "paid for in 3+ different months");
  const labels = w.badges.map(b => b.label);
  assert.ok(labels.includes("Loyal to Kick Lane") && labels.includes("Never Missed a Month") && labels.includes("Big Basket") && labels.includes("Weekend Shopper"));
  assert.ok(!labels.includes("Returns Pro") && !labels.includes("Subscriber"), "no badge without the receipts to back it");
  assert.equal(buildWrapped([], 2026).badges.length, 0);
  console.log("PASS Spotify-style Wrapped: top 5 things, biggest buys, shopping time, shop sprint, regulars, earned badges, year's list");
}

// 8. Savings lines, credits and labels are never "things you bought", and forwarded copies aren't "biggest buys".
{
  const c = (id, shop, dom, items, t) => ({ id, kind: "receipt", retailer: { name: shop, domain: dom }, orderDate: "2026-05-0" + id.length, totalPence: t, currency: "GBP", category: "food", items });
  const w = buildWrapped([c("a", "Sainsbury's", "sainsburys.test", [{ name: "You've saved", pricePence: 120 }, { name: "Bananas", pricePence: 90 }], 5000),
    c("bb", "Sainsbury's", "sainsburys.test", [{ name: "You've saved", pricePence: 80 }, { name: "Credit:", pricePence: 100 }, { name: "APPLEPAY", pricePence: 100 }, { name: "Bananas", pricePence: 90 }], 4000),
    c("ccc", "Forwarded receipt", "gmail.com", [{ name: "Sofa" }], 90000)], 2026);
  assert.deepEqual(w.yearList.map(x => x.name), ["Bananas", "Sofa"], "a forwarded receipt with no shop copy still counts as something bought");
  assert.ok(!w.topBuys.some(b => b.shop === "Forwarded receipt"), "a forwarded copy isn't a biggest buy");
  assert.equal(w.topBuys[0].item, "Bananas", "the one real item names the order");
  console.log("PASS Wrapped lists only real things: no savings lines, credits or forwarded copies");
}
