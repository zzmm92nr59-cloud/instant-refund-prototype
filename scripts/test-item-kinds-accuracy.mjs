// How often Relay's own rules (no AI) say rightly what a receipt line is, over hundreds of made-up but realistic UK receipt
// lines (scripts/fixtures/uk-receipt-lines.json). Connor, 18 Nov 2026: Wrapped opened with a sharing bag of Fruit Pastilles
// drawn as a T-shirt. Two bars:
//  * at least 97% of all lines right;
//  * none of the lines that must never be wrong: food, drink and other things that get used up are never clothes, shoes,
//    a bag, electronics or a home thing, and those are never food, drink, household or beauty.
// A line the rules aren't sure of comes back as "other", which counts as a miss but never as one of the never-wrong ones.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { shopHintFor } from "../worker/receipt-category.js";
const require = createRequire(import.meta.url);
const Core = require("../worker/item-kind-core.js");
const fixture = JSON.parse(readFileSync(new URL("./fixtures/uk-receipt-lines.json", import.meta.url), "utf8"));

const USED_UP = new Set(["food_drink", "household", "beauty_health"]);
const KEPT = new Set(["clothing", "footwear", "accessories", "electronics", "home"]);
let total = 0, right = 0;
const misses = [], never = [], byKind = {};
for (const g of fixture.groups) {
  const hint = shopHintFor({ retailer: { name: g.shop, domain: g.domain } });
  for (const [line, want] of g.lines) {
    assert.ok(Core.KIND_LIST[want], "fixture kind " + want + " is one of the list");
    const got = Core.classifyRules(line, { shop: g.shop, shopKind: hint });
    total++;
    const k = byKind[want] || (byKind[want] = { n: 0, ok: 0 }); k.n++;
    if (got.kind === want) { right++; k.ok++; continue; }
    misses.push({ shop: g.shop, line, want, got: got.kind, confidence: got.confidence, why: got.reasons.join(", ") });
    if ((USED_UP.has(want) && KEPT.has(got.kind)) || (KEPT.has(want) && USED_UP.has(got.kind))) never.push(misses[misses.length - 1]);
  }
}
const pct = (a, b) => Math.round(a / b * 1000) / 10;
console.log(`Rules only: ${right} of ${total} lines right (${pct(right, total)}%).`);
for (const [kind, k] of Object.entries(byKind).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${kind.padEnd(14)} ${k.ok}/${k.n}`);
if (misses.length) {
  console.log(`\nMisses (${misses.length}):`);
  for (const m of misses) console.log(`  ${m.want.padEnd(14)} read as ${m.got.padEnd(14)} ${m.confidence.padEnd(6)} ${m.shop}: ${m.line}${m.why ? "  [" + m.why + "]" : ""}`);
}
const neverTotal = fixture.groups.reduce((n, g) => n + g.lines.filter(([, w]) => USED_UP.has(w) || KEPT.has(w)).length, 0);
console.log(`\nNever-wrong set: ${neverTotal - never.length} of ${neverTotal} right.`);
assert.ok(total >= 600, "at least 600 lines");
assert.deepEqual(never.map((m) => m.line), [], "nothing used up is read as a lasting thing, and nothing lasting as used up");
assert.ok(right / total >= 0.97, `at least 97% right (got ${pct(right, total)}%)`);

// Connor's line, and the tricky ones, by name.
const kindOf = (line, shop, domain) => Core.classifyRules(line, { shop, shopKind: shopHintFor({ retailer: { name: shop, domain } }) });
const pastilles = kindOf("Rowntree's 130g Fruit Pastilles Sweets Sharing Bag Lollies", "Sainsbury's", "sainsburys.co.uk");
assert.equal(pastilles.kind, "food_drink"); assert.equal(pastilles.group, "food"); assert.equal(pastilles.lasting, false);
assert.equal(Core.isLasting(pastilles), false, "never a thing to open Wrapped with");
assert.equal(kindOf("Bag for Life", "Tesco", "tesco.com").kind, "household");
assert.equal(kindOf("Jordan Mini Air Patrol Backpack", "JD Sports", "jdsports.co.uk").kind, "accessories");
assert.equal(kindOf("Air Max Plus Socks 3-Pack", "JD Sports", "jdsports.co.uk").kind, "clothing");
assert.equal(kindOf("Moscow Mule 4 x 250ml", "Sainsbury's", "sainsburys.co.uk").kind, "food_drink");
assert.equal(kindOf("Scholl Heel Balm 60ml", "Boots", "boots.com").kind, "beauty_health");
assert.equal(kindOf("Chesterfield TV Bed King Size", "Unknown Beds", null).kind, "home");
assert.equal(Core.isLasting(kindOf("Nike Air Max 90", "JD Sports", "jdsports.co.uk")), true);
// What the AI says wins only when it is sure, and only with a kind from the list.
const ai = { "mystery thing": { type: "electronics", sure: true }, "unsure thing": { type: "clothing", sure: false }, "made up": { type: "spaceship", sure: true } };
assert.equal(Core.classify("Mystery Thing", { ai }).kind, "electronics"); assert.equal(Core.classify("Mystery Thing", { ai }).confidence, "ai");
assert.equal(Core.classify("Unsure Thing", { ai }).kind, "other"); assert.equal(Core.classify("Made Up", { ai }).kind, "other");
console.log("\nItem kinds accuracy checks passed.");
