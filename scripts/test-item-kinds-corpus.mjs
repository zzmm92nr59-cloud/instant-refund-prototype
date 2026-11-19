// What each item in the receipt corpus is (round 5, Connor, 19 Nov 2026: "Relay should be right about every word on every
// receipt"). Every email in scripts/fixtures/receipt-emails is read with Relay's own reader, and each of its items is read by
// worker/item-kind-core.js with that email's shop, as the receipts list does (receipt-category.js itemKinds). The answers are
// in scripts/fixtures/corpus-item-kinds.json, written by hand (all made up). Bars:
//  * at least 98% right;
//  * nothing used up (food, drink, household, beauty) is read as a lasting thing (clothes, shoes, a bag, tech, a home thing),
//    and nothing lasting as used up: unknown ("other") is a miss, but never one of these.
// It also checks the shops: supermarkets are read as supermarkets (their lines by what each item is), shops that sell
// everything lend no kind to their lines, and DIY and pet shops are what they are.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { itemKinds, itemCategories, shopHintFor, categorise } from "../worker/receipt-category.js";
import { buildWrapped } from "../worker/wrapped.js";
import { rawEmail } from "./fixtures/receipt-emails/lib.mjs";
const require = createRequire(import.meta.url);
const Core = require("../worker/item-kind-core.js");
const truth = JSON.parse(readFileSync(new URL("./fixtures/corpus-item-kinds.json", import.meta.url), "utf8"));
const dir = new URL("./fixtures/receipt-emails/", import.meta.url);

const USED_UP = new Set(["food_drink", "household", "beauty_health"]);
const KEPT = new Set(["clothing", "footwear", "accessories", "electronics", "home"]);
const read = new Map();
let right = 0;
const misses = [], never = [];
for (const [id, name, want] of truth.items) {
  assert.ok(Core.KIND_LIST[want], "answer " + want + " is one of the kinds");
  if (!read.has(id)) {
    const f = JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8"));
    const r = parseReceiptEmail(rawEmail(f));
    assert.ok(r.ok, id + " is read as a receipt");
    read.set(id, r);
  }
  const card = read.get(id);
  const at = (card.items || []).findIndex((it) => it && it.name === name);
  assert.ok(at >= 0, `${id}: "${name}" is one of its items`);
  const got = itemKinds(card)[at];
  if (got.kind === want) { right++; continue; }
  const m = `${want.padEnd(14)} read as ${got.kind.padEnd(14)} ${card.retailer && card.retailer.name}: ${name}  [${got.reasons.join(", ")}]`;
  misses.push(m);
  if ((USED_UP.has(want) && KEPT.has(got.kind)) || (KEPT.has(want) && USED_UP.has(got.kind))) never.push(m);
}
const total = truth.items.length, pct = Math.round(right / total * 1000) / 10;
console.log(`Corpus items: ${right} of ${total} right (${pct}%).`);
if (misses.length) console.log("Misses:\n  " + misses.join("\n  "));
assert.ok(total >= 700, "at least 700 corpus items");
assert.deepEqual(never, [], "nothing used up read as a lasting thing, nothing lasting as used up");
assert.ok(right / total >= 0.98, `at least 98% right (got ${pct}%)`);

// Shops.
const hint = (name, domain) => shopHintFor({ retailer: { name, domain } });
for (const [n, d] of [["Tesco", "tesco.com"], ["Sainsbury's", "sainsburys.co.uk"], ["Asda", "asda.com"], ["Morrisons", "morrisons.com"], ["Aldi", "aldi.co.uk"], ["Lidl", "lidl.co.uk"]])
  assert.equal(hint(n, d), "grocer", n + " is a supermarket");
for (const n of ["Argos", "Very", "John Lewis", "Marks & Spencer", "Next", "Home Bargains", "B&M"]) assert.equal(hint(n), null, n + " sells everything: its items decide");
assert.equal(hint("Pets at Home", "petsathome.com"), "pets");
assert.equal(hint("Bathroom Takeaway"), "home", "a bathroom shop, not a takeaway");
// A supermarket shop that is mostly cleaning things and toiletries is still the groceries, never Home & garden; its
// clothes are clothes and its food is food.
const weekly = { retailer: { name: "Sainsbury's", domain: "sainsburys.co.uk" }, totalPence: 3150, currency: "GBP", items: [
  { name: "JS Kitchen Roll 4 Pack", qty: 1, pricePence: 450 }, { name: "Fairy Original Washing Up Liquid 820ml", qty: 1, pricePence: 250 },
  { name: "JS Toilet Tissue 9 Roll", qty: 1, pricePence: 500 }, { name: "Persil Bio Washing Liquid 38 Washes", qty: 1, pricePence: 900 },
  { name: "TU Mens Black Trainers", qty: 1, pricePence: 800 }, { name: "JS BTRNT SQSH", qty: 1, pricePence: 100 }, { name: "Bag for Life", qty: 1, pricePence: 150 }] };
assert.equal(categorise(weekly).category, "food", "Sainsbury's is groceries");
const k = itemKinds(weekly).map((x) => x.kind);
assert.deepEqual(k, ["household", "household", "household", "household", "footwear", "food_drink", "household"]);
// "What shoes have I bought from Sainsbury's?": only the things that are footwear.
const shoes = weekly.items.filter((it, i) => itemKinds(weekly)[i].kind === "footwear").map((it) => it.name);
assert.deepEqual(shoes, ["TU Mens Black Trainers"]);
for (const n of ["Boots Meal Deal", "Wellington Boot Cake", "Boot Socks 2pk", "Shoe Rack 3 Tier", "Potato Wedges", "Sweets Sharing Bag 150g"])
  assert.notEqual(Core.classify(n, { shop: "Sainsbury's", shopKind: "grocer" }).kind, "footwear", n + " is not footwear");
// TV Beds North West's joined-up and short till words are furniture.
for (const n of ["TVBED KING GREY PLUSH", "OTTOMANBED DBL CHARCOAL", "SOFABED 3STR CHENILLE", "HEADBRD WINGBACK 5FT", "DIVANBASE 2DRW DOUBLE"])
  assert.equal(Core.classify(n, { shop: "TV Beds North West", shopKind: hint("TV Beds North West", "tvbedsnorthwest.co.uk") }).kind, "home", n);
// Wrapped opens on something kept, by what it is: never water, sweets, filler or plaster, wherever they were bought.
const listed = (c) => { const g = categorise(c), k = itemCategories(c); return { kind: "order", currency: "GBP", ...c, ...g, items: c.items.map((it, i) => ({ qty: 1, ...it, category: k[i] ? k[i].category : g.category, categorySure: Boolean(k[i] && k[i].sure) })) }; };
const R = (name, domain) => ({ name, domain });
const year = [
  listed({ id: "y1", retailer: R("Brew Bar", "brewbar.example"), orderDate: "2026-01-03", totalPence: 300, items: [{ name: "Sparkling Water 6 x 500ml", pricePence: 300 }] }),
  listed({ id: "y2", retailer: R("Sweet Tooth", "sweettooth.example"), orderDate: "2026-01-04", totalPence: 250, items: [{ name: "Percy Pig & Pals 170g", pricePence: 250 }] }),
  listed({ id: "y3", retailer: R("Wickes", "wickes.co.uk"), orderDate: "2026-01-05", totalPence: 2400, items: [{ name: "Wickes Bonding Coat 25kg", pricePence: 1200 }, { name: "Wickes Multi Finish Plaster 25kg", pricePence: 1200 }] }),
  listed({ id: "y4", retailer: R("Papa John's", "papajohns.co.uk"), orderDate: "2026-01-06", totalPence: 500, items: [{ name: "Garlic Parmesan Wedges", pricePence: 500 }] }),
  listed({ id: "y5", retailer: R("TV Beds North West", "tvbedsnorthwest.co.uk"), orderDate: "2026-02-01", totalPence: 49900, items: [{ name: "TVBED KING GREY PLUSH", pricePence: 49900 }] })];
const w = buildWrapped(year, 2026);
assert.equal(w.firstBuy && w.firstBuy.item, "TVBED KING GREY PLUSH", "the bed opens it: " + JSON.stringify(w.firstBuy));
assert.equal(w.firstBuy.thing, "home");
assert.ok(!w.chapters.some((c) => c.category === "fashion"), "no fashion from wedges or a bonding coat");
console.log("ok - corpus items read for what they are; supermarkets are groceries first, their things are what they are; Wrapped opens on a kept thing");
