// Server test (Connor, 18 Nov 2026): Wrapped's journeys. Relay knows where the UK's stations and towns are (Brighouse
// too), matches the names tickets give them in any of their usual spellings, never guesses a place it doesn't know, makes
// one trip of each journey out (the way back isn't replayed), keeps every trip in date order, shows a place gone to again
// and again once (with how many times) when there are more than ten, and only ever names sights from its own list.
import assert from "node:assert/strict";
import { findPlace, placeAt, placeCount, samePlace } from "../worker/uk-places.js";
import { attractionsFor } from "../worker/uk-attractions.js";
import { buildWrapped } from "../worker/wrapped.js";
import { categorise, itemCategories } from "../worker/receipt-category.js";

// 1. Places.
assert.ok(placeCount() >= 600, "hundreds of stations and towns, not a couple of hundred: " + placeCount());
for (const n of ["Brighouse", "BRIGHOUSE", "brighouse", "Brighouse Rail Station", "Brighouse railway station", "Brighouse Stn", "Brighouse (Return)", "BGH"]) {
  const p = findPlace(n);
  assert.ok(p && Math.abs(p.lat - 53.70) < 0.02 && Math.abs(p.lon + 1.785) < 0.02, n + " is Brighouse: " + JSON.stringify(p));
}
for (const n of ["London Kings Cross", "London King's Cross", "London King’s Cross", "Kings Cross", "King's Cross", "KGX", "London Kings Cross (Return)"]) assert.equal(findPlace(n).name, "London Kings Cross", n);
assert.equal(findPlace("Manchester Picc").name, "Manchester Piccadilly", "shortened names");
assert.equal(findPlace("Manchester Piccadilly Rail Station").name, "Manchester Piccadilly");
assert.equal(findPlace("Birmingham Intl").name, "Birmingham International");
assert.equal(findPlace("Liverpool St").name, "London Liverpool Street");
assert.equal(findPlace("Edinburgh Waverley").name, "Edinburgh");
assert.equal(findPlace("Stoke on Trent").name, "Stoke-on-Trent"); assert.equal(findPlace("Newcastle upon Tyne").name, "Newcastle");
assert.equal(findPlace("London Terminals").name, "London"); assert.equal(findPlace("Heathrow Terminal 5").name, "Heathrow Airport");
assert.equal(findPlace("Manchester Oxford Road").town, "Manchester"); assert.equal(findPlace("Glasgow Queen St").town, "Glasgow"); assert.equal(findPlace("Bath Spa").town, "Bath");
assert.equal(findPlace("London Road"), null, "a station named after a road isn't put in that city");
assert.equal(findPlace("Little Snoring Halt"), null, "a place Relay doesn't know is never guessed");
assert.equal(placeAt("Nowhere Parkway"), null);
assert.ok(samePlace("London Euston", "London Kings Cross"), "both London"); assert.ok(!samePlace("York", "Leeds"));
console.log("ok - places: Brighouse and every usual spelling of a station's name; unknown places are not guessed");

// 2. Trips.
const R = (name, domain) => ({ name, domain });
const listed = (c) => { const g = categorise(c), k = itemCategories(c); return { kind: "order", currency: "GBP", ...c, ...g, items: c.items.map((it, i) => ({ qty: 1, ...it, category: k[i] ? k[i].category : g.category, categorySure: Boolean(k[i] && k[i].sure) })) }; };
let n = 0;
const ticket = (date, name) => listed({ id: "t" + (++n), retailer: R("Trainline", "thetrainline.com"), orderDate: date, totalPence: 2000, items: [{ name, pricePence: 2000 }] });
const trips = (cards) => buildWrapped(cards, 2026, Date.UTC(2026, 11, 31)).travel.trips;
{
  const t = trips([
    ticket("2026-01-14", "London King's Cross to Brighouse"), ticket("2026-01-16", "Brighouse to London Kings Cross"),
    ticket("2026-03-14", "London Kings Cross to York (Return)"),
    ticket("2026-04-02", "Leeds to Hull"), ticket("2026-09-20", "Hull to Leeds"),
  ]);
  assert.deepEqual(t.map((x) => x.from + " > " + x.to), ["London King's Cross > Brighouse", "London Kings Cross > York", "Leeds > Hull", "Hull > Leeds"],
    "the single straight back from Brighouse isn't a trip; a return ticket is one trip; Hull to Leeds months later is a trip of its own");
  assert.equal(t[1].return, true);
  assert.ok(t[0].toAt && t[0].fromAt, "both ends of London to Brighouse are on the map");
  assert.deepEqual(t[0].sights, [], "Brighouse has no sights listed: nothing is made up");
  assert.equal(t[0].place, "Brighouse");
  assert.deepEqual(t[1].sights, attractionsFor("York").attractions, "York's sights, from the list");
}
{
  // Home is where most trips start: trips back there aren't replayed.
  const t = trips([
    ticket("2026-02-01", "Leeds to York"), ticket("2026-02-01", "York to Leeds"),
    ticket("2026-05-01", "Leeds to Durham"), ticket("2026-05-09", "Newcastle to Leeds"),
    ticket("2026-08-01", "Leeds to Sheffield"),
  ]);
  assert.deepEqual(t.map((x) => x.to), ["York", "Durham", "Sheffield"], "Newcastle to Leeds goes home");
}
{
  // Every trip, in date order: no cap at six.
  const legs = ["York", "Durham", "Hull", "Sheffield", "Harrogate", "Bradford Interchange", "Halifax", "Huddersfield", "Wakefield Westgate"];
  const t = trips(legs.map((to, i) => ticket("2026-0" + (i + 1) + "-10", "Leeds to " + to + " (Return)")).reverse());
  assert.deepEqual(t.map((x) => x.to), legs, "all nine, oldest first");
}
{
  // Over ten: each place once, with how many times; a place Relay doesn't know is named, not plotted.
  const legs = ["York", "Durham", "York", "Hull", "Sheffield", "York", "Harrogate", "Bradford Interchange", "Halifax", "Huddersfield", "Wakefield Westgate", "Little Snoring Halt"];
  const t = trips(legs.map((to, i) => ticket("2026-" + String(1 + Math.floor(i / 2)).padStart(2, "0") + "-" + (i % 2 ? "20" : "05"), "Leeds to " + to + " (Return)")));
  assert.equal(t.length, 10);
  assert.deepEqual(t.filter((x) => x.times).map((x) => x.to + " " + x.times), ["York 3"]);
  const lsh = t.find((x) => x.to === "Little Snoring Halt");
  assert.equal(lsh.toAt, null); assert.ok(lsh.fromAt); assert.equal(lsh.place, "Little Snoring Halt"); assert.deepEqual(lsh.sights, []);
}
console.log("ok - trips: one per journey out, the way back not replayed, every trip in order, grouped over ten, unknown places named");
console.log("PASS Wrapped journeys (server): places, ways back, all trips, grouping, sights only from the list");
