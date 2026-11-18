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
console.log("ok - picks follow what a thing is: a Jordan backpack is a bag, heel balm isn't heels, the weekly shop picks nothing");
