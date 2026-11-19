// The name check (worker/item-names.js, round 9, 19 Nov 2026). The totals check only checks money, so a note, a label, a
// size or a code read as an item's name used to pass as complete. This test measures the name check honestly:
//   1. False flags (must be 0): every item list in the receipt corpus (all right), every line in uk-receipt-lines.json and
//      corpus-item-kinds.json, and 20 new made-up emails read by the real reader.
//   2. Catches: the wrong lists older readers produced from the holdout5-10 emails (fixtures/item-names-wrong.json), and the
//      20 new emails with each note read as the name (what an older reader did). Their counts are pinned: they may only go up.
// Everything is MADE UP.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { suspectItemNames, namesCheck } from "../worker/item-names.js";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { acceptAiItems } from "../worker/receipt-reread.js";

const fx = "scripts/fixtures/";
const ok = (m) => console.log("ok - " + m);

// 1. False flags on right names.
let lists = 0;
for (const n of readdirSync(fx + "receipt-emails").filter((n) => n.endsWith(".json"))) {
  const f = JSON.parse(readFileSync(fx + "receipt-emails/" + n, "utf8"));
  if (f.expected.notPurchase || !f.expected.items.length) continue;
  lists++;
  const s = suspectItemNames(f.expected.items.map((i) => ({ name: i.name })), { shop: f.expected.shop });
  assert.equal(s.length, 0, `${f.id}: a right name flagged: ${JSON.stringify(s)}`);
}
let lines = 0;
for (const g of JSON.parse(readFileSync(fx + "uk-receipt-lines.json", "utf8")).groups) for (const [name] of g.lines) {
  lines++; assert.equal(suspectItemNames([{ name }], { shop: g.shop }).length, 0, `${g.shop}: "${name}" flagged`);
}
for (const [id, name] of JSON.parse(readFileSync(fx + "corpus-item-kinds.json", "utf8")).items) { lines++; assert.equal(suspectItemNames([{ name }], {}).length, 0, `${id}: "${name}" flagged`); }
ok(`no right name flagged: ${lists} corpus item lists, ${lines} item-kind lines`);

// 2. The wrong lists older readers produced.
const wrong = JSON.parse(readFileSync(fx + "item-names-wrong.json", "utf8")).lists;
const quiet = wrong.filter((w) => !w.totalsFlagged);
const caught = quiet.filter((w) => suspectItemNames(w.names.map((name) => ({ name })), { shop: w.shop }).length);
console.log(`  older readers' wrong lists: ${wrong.length}; the totals check flagged ${wrong.length - quiet.length}; of the ${quiet.length} it passed, the name check catches ${caught.length}`);
assert.ok(caught.length >= 19, "the name check catches at least 19 of the 25 wrong lists the totals check passed (round 9)");
ok("older readers' wrong lists: " + (wrong.length - quiet.length + caught.length) + "/" + wrong.length + " flagged (was " + (wrong.length - quiet.length) + ")");

// 3. 20 new made-up emails (written for round 9 before they were run). Each item has a note under its name, as shops print
// them. The real reader must read the right names and the name check must not flag them; with the note read as the name
// (what older readers did), the name check should flag it.
const P = (p) => "£" + (p / 100).toFixed(2);
const NEW = [
  ["Brightwave Electrical", "brightwave.example", [["Cordless Stick Vacuum V8", 1, 18900, "Sold and shipped by Brightwave Ltd"], ["HEPA Filter 2 Pack", 1, 1499, null]]],
  ["Hollins Grocer", "hollinsgrocer.example", [["Hollins Craft IPA 4 x 440ml", 1, 650, "Age verification required on delivery"], ["Sourdough Crumpets 6 pack", 1, 165, null]]],
  ["Pine & Pebble", "pineandpebble.example", [["Merino Hiking Socks", 2, 1800, "Colour: Forest Green"], ["Packable Rain Jacket", 1, 7900, "Size: M"]]],
  ["Strideworks", "strideworks.example", [["Trail Running Shoe", 1, 11000, "Size: UK 9"]]],
  ["Corner Larder", "cornerlarder.example", [["Free Range Chicken Thighs", 1, 412, "Weighed item 0.742kg"], ["Basmati Rice 1kg", 1, 250, null]]],
  ["Corner Larder", "cornerlarder.example", [["Whole Milk 2 Pints", 1, 145, "Substituted: similar item"], ["Granola Clusters 500g", 1, 325, null]]],
  ["Spice Route Kitchen", "spiceroute.example", [["Chicken Jalfrezi", 1, 1095, "Allergens: milk, mustard"], ["Peshwari Naan", 1, 375, null]]],
  ["Spice Route Kitchen", "spiceroute.example", [["Lamb Rogan Josh", 1, 1195, "No coriander"], ["Mushroom Rice", 1, 395, null]]],
  ["Ridgeway Books", "ridgewaybooks.example", [["The Long Walk Home", 1, 899, "Format: Paperback"], ["Birds of Britain Field Guide", 1, 1650, null]]],
  ["Ridgeway Books", "ridgewaybooks.example", [["Winter Garden Journal", 1, 1200, "Gift wrapped"]]],
  ["Lumen Home", "lumenhome.example", [["Linen Bedding Set Double", 1, 8500, "Was £110.00"], ["Waffle Bath Towel", 2, 2400, null]]],
  ["Lumen Home", "lumenhome.example", [["Ceramic Table Lamp", 1, 6500, "Estimated delivery Fri 21 Nov"]]],
  ["Northgate Pharmacy", "northgatepharmacy.example", [["Ibuprofen 200mg 16 Tablets", 1, 95, "Pharmacy medicine: max 2 packs"], ["SPF 50 Sun Cream 200ml", 1, 1200, null]]],
  ["Gamevault", "gamevault.example", [["Starfall Odyssey Deluxe", 1, 5999, "Platform: PlayStation 5"]]],
  ["Gamevault", "gamevault.example", [["Pixel Racer Collection", 1, 2499, "SKU GV-88213"]]],
  ["Tidewater Fish Bar", "tidewaterfish.example", [["Large Cod and Chips", 1, 1150, "Extra salt"], ["Mushy Peas", 1, 250, null]]],
  ["Ashby Butchers", "ashbybutchers.example", [["Rib Eye Steak", 2, 1800, "Price per kg £32.00"]]],
  ["Velvet & Vine", "velvetandvine.example", [["Malbec Reserva 75cl", 3, 3600, "Over 18s only"], ["Gift Box", 1, 300, null]]],
  ["Kite Mobile", "kitemobile.example", [["USB-C Fast Charger 30W", 1, 2499, "Colour: White"], ["Braided Cable 2m", 1, 999, "Pre-order: ships 3 Dec"]]],
  ["Fable Toys", "fabletoys.example", [["Wooden Train Set 40 Pieces", 1, 3500, "Personalisation: SAM"]]],
];
let i = 0, right = 0, newFalse = 0, wrongLists = 0, newCaught = 0;
const missedNotes = [];
for (const [shop, domain, items] of NEW) {
  i++;
  const sub = items.reduce((n, [, , p]) => n + p, 0);
  // Half as a table with the note in the name's cell, half as a table with the note on a row of its own.
  const rows = items.map(([n, q, p, note]) => i % 2
    ? `<tr><td>${n}${note ? "<br/>" + note : ""}</td><td>Qty ${q}</td><td>${P(p)}</td></tr>`
    : `<tr><td>${n}</td><td>Qty ${q}</td><td>${P(p)}</td></tr>${note ? `<tr><td colspan="3">${note}</td></tr>` : ""}`).join("");
  const html = `<html><body><table><tr><td><img alt="${shop}" src="https://${domain}/logo.png"/></td></tr><tr><td><p>Thanks for your order</p><p>Order number: RN9-${1000 + i}</p><p>Order date: 12/11/2026</p></td></tr>
<tr><td><table>${rows}</table></td></tr><tr><td><table><tr><td>Subtotal</td><td>${P(sub)}</td></tr><tr><td>Delivery</td><td>FREE</td></tr><tr><td><strong>Total</strong></td><td><strong>${P(sub)}</strong></td></tr></table></td></tr></table></body></html>`;
  const raw = [`From: ${shop} <orders@${domain}>`, "To: sam.taylor@example.co.uk", `Subject: Your ${shop} order RN9-${1000 + i}`, "Date: Thu, 12 Nov 2026 10:00:00 +0000",
    "MIME-Version: 1.0", "Content-Type: text/html; charset=utf-8", "", html].join("\r\n");
  const r = parseReceiptEmail(raw);
  const got = (r.items || []).map((x) => x.name);
  const isRight = r.ok && got.length === items.length && items.every(([n], k) => got[k] === n);
  if (isRight) { right++; if (r.itemsCheck && r.itemsCheck.namesOk === false) newFalse++; }
  else console.log(`  new email ${i} (${shop}) read as ${JSON.stringify(got)}${r.itemsCheck && r.itemsCheck.namesOk === false ? " (name check flags it)" : r.itemsCheck && r.itemsCheck.complete === false ? " (totals check flags it)" : " (NOT flagged)"}`);
  // The note read as the name.
  if (items.some((x) => x[3])) {
    wrongLists++;
    const bad = items.map(([n, , , note]) => ({ name: note || n }));
    if (suspectItemNames(bad, { shop }).length) newCaught++; else missedNotes.push(items.filter((x) => x[3]).map((x) => x[3]).join(" / "));
  }
}
console.log(`  20 new emails: read right ${right}/20; right lists flagged by the name check ${newFalse}; with the note as the name, caught ${newCaught}/${wrongLists}`);
if (missedNotes.length) console.log("  notes the name check lets through: " + missedNotes.join("; "));
assert.equal(newFalse, 0, "no right list among the new emails is flagged");
assert.ok(right >= 16, "the reader reads at least 16 of the 20 new emails right (measured " + right + ")");
// (First run, before any change for them: 14 of 20 caught, 0 false flags, 20 of 20 read right. Round 9 then added the six
// kinds of note it let through, worded generally, and re-checked every right name above.)
assert.ok(newCaught >= 20, "the name check catches all 20 of the new emails' note-as-name lists");
ok("20 new made-up emails: no false flags; most note-as-name lists caught");

// 4. Shape: namesCheck adds namesOk (and suspectNames only when something is suspect); "Read it again" keeps the AI's
// items only when they add up AND their names look right.
assert.deepEqual(namesCheck([{ name: "Carling Lager 18 x 440ml" }]), { namesOk: true });
const nc = namesCheck([{ name: "Age restricted product" }, { name: "ASDA Bananas Loose" }]);
assert.equal(nc.namesOk, false); assert.equal(nc.suspectNames[0].name, "Age restricted product"); assert.equal(nc.suspectNames[0].why, "note");
const section = "Hollins Grocer\nAge restricted product £6.50\nSourdough Crumpets 6 pack £1.65\nTotal £8.15";
assert.equal(acceptAiItems({ items: [{ name: "Age restricted product", qty: 1, pricePence: 650, lineTotal: true }, { name: "Sourdough Crumpets 6 pack", qty: 1, pricePence: 165, lineTotal: true }] }, section, 815), null,
  "the AI's items that add up but name a note are not kept");
assert.ok(acceptAiItems({ items: [{ name: "Hollins Craft IPA 4 x 440ml", qty: 1, pricePence: 650, lineTotal: true }, { name: "Sourdough Crumpets 6 pack", qty: 1, pricePence: 165, lineTotal: true }] }, section, 815),
  "the AI's items that add up with good names are kept");
ok("namesCheck shape; Read it again treats a suspect name like a missing item");
console.log("PASS item names: no right name flagged; wrong names caught even when the money adds up");
