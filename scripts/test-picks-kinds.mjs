// Picks follow what a thing is, not a brand word or a look-alike word (Connor, 18 Nov 2026: "What shoes have I bought from
// Sainsbury's? Why are trainers suggesting a bag all because the colour is black?").
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../relay-recommendation-engine.js");
const kind = n => { const k = E.kindOf(n); return k ? (k.mode === "none" ? "none" : k.key) : null; };

// A brand or model name says "trainers" only when nothing else says what the thing is.
assert.equal(kind("Jordan Mini Air Patrol Backpack"), "bag");
assert.equal(kind("Jordan Essentials Hoodie"), "hoodie");
assert.equal(kind("Nike Air Force 1 '07"), "trainers");
assert.equal(kind("adidas Originals Samba OG"), "trainers");
assert.equal(kind("Air Max Plus Socks 3-Pack"), "socks");
// Food, drink and things for skin are never clothes or shoes.
for (const n of ["Scholl Heel Balm 60ml", "Moscow Mule 4 x 250ml", "Chicken Drumsticks 1kg", "Spring Water 4x2L", "Cracked Heel Cream", "Gel Insoles"])
  assert.notEqual(["shoes", "trainers", "boots", "bag", "hat"].includes(kind(n)), true, n + " is not clothing");
assert.equal(kind("Ottilie Bow Strappy Heels - Black"), "shoes");
assert.equal(kind("Tu Black Ankle Boots"), "boots");

const stock = [
  { key: "bp", product: "Jordan Mini Air Patrol Backpack", store: "JD Sports", min: 3000, options: ["Black"] },
  { key: "am", product: "Nike Air Max 90 Black", store: "JD Sports", min: 12000, options: [] },
  { key: "hl", product: "Ottilie Bow Strappy Heels - Black", store: "Lounge", min: 10800, options: [] },
  { key: "mg", product: "Stoneware Mug", store: "Kiln Road", min: 1800, options: [] }];
// Black trainers bought: black trainers picked, never a black backpack.
let out = E.picks([{ item: "Cloud Runner Trainers", merchant: "Prime Luxe Wear", detail: "Black", price: 110, verified: true }], stock);
assert.deepEqual(out.map(x => x.g.key), ["am"], "only trainers for trainers");
assert.deepEqual(out[0].why, ["Like the trainers you bought at Prime Luxe Wear", "In black, like yours"]);
// A supermarket shop picks nothing from its weekly-shop lines: no "shoes you bought at Sainsbury's", no coffee cups.
out = E.picks([
  { item: "Scholl Heel Balm", merchant: "Sainsbury's", price: 6, verified: true },
  { item: "Moscow Mule 4 x 250ml", merchant: "Sainsbury's", price: 5, verified: true },
  { item: "Taste the Difference Coffee Beans 227g", merchant: "Sainsbury's", price: 4.5, verified: true }], stock);
assert.equal(out.length, 0, "nothing from a weekly shop: " + JSON.stringify(out.map(x => x.why)));
// Clothes that last from a supermarket still count.
out = E.picks([{ item: "Tu Black Strappy Heels", merchant: "Sainsbury's", price: 22, verified: true }], stock);
assert.deepEqual(out.map(x => x.g.key), ["hl"]);
assert.equal(out[0].why[0], "Like the shoes you bought at Sainsbury's");

// Round 5 (Connor, 19 Nov 2026): the kind comes from what the thing is, never a word or a colour it shares.
// A supermarket's lines are only shoes when they really are footwear.
for (const n of ["Boots Meal Deal", "Sainsbury's Home Shoe Rack 3 Tier", "Wellington Boot Cake Topper", "Tesco Boot Socks 2pk", "JS Shoe Polish Black"])
  assert.notEqual(["shoes", "trainers", "boots"].includes(E.kindOf(n, "Sainsbury's") && E.kindOf(n, "Sainsbury's").key), true, n + " is not footwear");
assert.equal(E.kindOf("Tesco Boot Socks 2pk", "Tesco").key, "socks");
assert.equal(E.kindOf("Next Slipper Socks Grey").key, "socks");
assert.equal(E.kindOf("TU MENS BLACK TRAINERS", "Sainsbury's").key, "trainers");
assert.equal(E.kindOf("F&F KIDS WELLIES", "Tesco") === null || E.kindOf("F&F KIDS WELLIES", "Tesco").key !== "bag", true);
// What the thing is, for ranking Browse: a Jordan backpack is a bag, not footwear; a bag is never "like" black trainers.
assert.equal(E.category("Jordan Mini Air Patrol Backpack"), "bags");
assert.equal(E.category("Boots Meal Deal"), "other");
assert.equal(E.category("Nike Air Max 90 Black"), "footwear");
const black = [
  { key: "bag", product: "Black Leather Tote Bag", store: "Hide & Stitch", min: 6000, options: ["Black"] },
  { key: "sh", product: "Black Shoe Rack 3 Tier", store: "Marlow Home", min: 2500, options: ["Black"] },
  { key: "tr", product: "Black Running Trainers", store: "JD Sports", min: 9000, options: ["Black"] }];
out = E.picks([{ item: "Nike Air Max 90", merchant: "JD Sports", detail: "Black", price: 120, verified: true }], black);
assert.deepEqual(out.map(x => x.g.key), ["tr"], "black trainers pick black trainers, never a black bag or a shoe rack");
// The weekly shop with supermarket clothing in it: only the things that are what they say.
out = E.picks([
  { item: "TESCO SPRING WTR 6X500ML", merchant: "Tesco", price: 3, verified: true },
  { item: "M&S PERCY PIG & PALS 170G", merchant: "Marks & Spencer", price: 2.5, verified: true },
  { item: "SAINSBURYS HOME SHOE RACK", merchant: "Sainsbury's", price: 15, verified: true }], black);
assert.equal(out.length, 0, "water, sweets and a shoe rack pick nothing: " + JSON.stringify(out.map(x => x.why)));
console.log("ok - picks follow what a thing is: a Jordan backpack is a bag, heel balm isn't heels, the weekly shop picks nothing");
