// Server test (Connor, 18 Nov 2026: "surely I have BA or Skyscanner, Ryanair, easyJet emails in my inbox?"). Airline and
// travel-site booking confirmations are read as receipts, flight by flight (airports, day, flight number, out or back);
// what isn't a purchase (a sale, a check-in reminder, a boarding pass) never is; a train ticket with station codes is never a
// flight. Then Wrapped: the furthest flight and train journey are featured, the rest grouped with the year's totals, and
// every place gone to has its sights asked about (a nearby listed town's when it has none, said as such). Made-up emails.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as MAIL from "./fixtures/flight-emails.mjs";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { flightLegs, flightBooking, legDay } from "../worker/flight-booking.js";
import { airportByCode, airportByName, allAirports, distanceKm } from "../worker/airports.js";
import { worldAttractionsFor, WORLD_ATTRACTION_PLACES } from "../worker/world-attractions.js";
import { buildWrapped, featuredAndRest } from "../worker/wrapped.js";
import { categorise, itemCategories } from "../worker/receipt-category.js";
import { PARSER_VERSION } from "../worker/gmail.js";

// 1. Airports: every code once, real positions, names people use.
{
  const all = allAirports();
  assert.ok(all.length >= 150, "the UK's airports and the usual places from them: " + all.length);
  assert.equal(new Set(all.map((a) => a.code)).size, all.length, "each code once");
  for (const a of all) {
    assert.match(a.code, /^[A-Z]{3}$/); assert.ok(a.lat >= -60 && a.lat <= 72 && a.lon >= -180 && a.lon <= 180, a.code);
    if (a.country === "GB") assert.ok(a.lat > 49.8 && a.lat < 61 && a.lon > -8.5 && a.lon < 2, a.code + " is in the UK");
  }
  assert.equal(airportByCode("LHR").name, "London Heathrow"); assert.equal(airportByCode("bcn").city, "Barcelona");
  assert.equal(airportByName("Malaga Costa del Sol").code, "AGP"); assert.equal(airportByName("Palma de Mallorca").code, "PMI");
  assert.equal(airportByName("London Gatwick (North Terminal)").code, "LGW");
  assert.equal(airportByName("Nowhere International"), null, "an airport not in the table is never guessed");
  assert.equal(airportByCode("ZZZ"), null);
  const km = distanceKm(airportByCode("LHR"), airportByCode("JFK"));
  assert.ok(km > 5500 && km < 5600, "Heathrow to JFK is about 5,540 km: " + km);
  // Every place with world sights is a city an airport here serves.
  const cities = new Set(all.map((a) => a.city.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")));
  for (const k of WORLD_ATTRACTION_PLACES) assert.ok(cities.has(k), k + " is an airport's city");
  assert.deepEqual(worldAttractionsFor("Barcelona").attractions, ["the Sagrada Família", "Park Güell", "La Rambla"]);
  assert.deepEqual(worldAttractionsFor("Paris").attractions.slice(0, 2), ["the Eiffel Tower", "the Louvre"]);
  assert.equal(worldAttractionsFor("Beauvais"), null, "Paris Beauvais is in Beauvais: Paris's sights aren't claimed for it");
  console.log("ok - airports: each code once, real positions, unknown airports never guessed");
}

// 2. Booking confirmations are receipts, flight by flight.
const read = (raw) => parseReceiptEmail(raw);
{
  const ba = read(MAIL.BA);
  assert.equal(ba.ok, true); assert.equal(ba.orderRef, "X7KQPZ"); assert.equal(ba.totalPence, 31240); assert.equal(ba.currency, "GBP");
  assert.deepEqual(ba.flights, [{ from: "LHR", to: "BCN", date: "2026-03-14", flight: "BA0478", leg: "out" }, { from: "BCN", to: "LHR", date: "2026-03-21", flight: "BA0479", leg: "back" }]);
  assert.deepEqual(ba.items.map((i) => i.name), ["Return flights London Heathrow to Barcelona"], "the flights are the one thing bought, not the fare's lines");
  const fr = read(MAIL.RYANAIR);
  assert.equal(fr.ok, true, "\"Ryanair Travel Itinerary\" says neither order nor receipt, and is one"); assert.equal(fr.orderRef, "KQ7ZRB"); assert.equal(fr.totalPence, 8998, "\"Total paid: GBP 89.98\"");
  assert.deepEqual(fr.flights, [{ from: "STN", to: "FAO", date: "2026-05-07", flight: "FR8352", leg: "out" }]);
  assert.deepEqual(fr.items.map((i) => i.name), ["Flight London Stansted to Faro"]);
  const ezy = read(MAIL.EASYJET);
  assert.equal(ezy.ok, true); assert.equal(ezy.orderRef, "EJY4KP2");
  assert.deepEqual(ezy.flights.map((g) => [g.from, g.to, g.date, g.flight, g.leg].join(" ")), ["MAN ALC 2026-07-03 EZY1931 out", "ALC MAN 2026-07-10 EZY1932 back"],
    "airports named without codes, days without a year (the next ones after the email), the way back from the route");
  const jet2 = read(MAIL.JET2);
  assert.equal(jet2.ok, true); assert.equal(jet2.totalPence, 110400);
  assert.deepEqual(jet2.flights.map((g) => [g.from, g.to, g.date, g.flight, g.leg].join(" ")), ["LBA PMI 2026-08-09 LS1203 out", "PMI LBA 2026-08-16 LS1204 back"],
    "arrows written as HTML; Jet2's postcode (LS1 4AB) isn't a flight");
  const exp = read(MAIL.EXPEDIA);
  assert.equal(exp.ok, true); assert.equal(exp.orderRef, "72811043915", "Expedia's itinerary number"); assert.equal(exp.totalPence, 64218);
  assert.deepEqual(exp.flights.map((g) => [g.from, g.to, g.date, g.flight, g.leg].join(" ")), ["LGW DXB 2026-04-12 EK16 out", "DXB LGW 2026-04-19 EK15 back"], "each flight its own day");
  for (const r of [ba, fr, ezy, jet2, exp]) assert.equal(categorise(r).category, "travel", "a flight booking is travel");
  console.log("ok - BA, Ryanair, easyJet, Jet2 and Expedia bookings read as receipts, with each flight");
}

// 3. Never wrong: what isn't a purchase isn't read as one, and a train isn't a flight.
{
  const sale = read(MAIL.SALE);
  assert.equal(sale.ok, false, "\"Sale on flights to Spain from £19.99\" is marketing"); assert.equal(sale.flights, undefined);
  assert.equal(flightBooking({ subject: "Sale on flights to Spain from £19.99", text: "STN - AGP from £19.99", senderDomain: "ryanair.com" }), null);
  const checkIn = read(MAIL.CHECK_IN);
  assert.equal(checkIn.ok, false); assert.equal(checkIn.reason, "travel_notice", "a check-in reminder isn't the purchase: the booking is counted once");
  const pass = read(MAIL.BOARDING);
  assert.equal(pass.ok, false); assert.equal(pass.reason, "travel_notice", "a boarding pass isn't a purchase");
  const train = read(MAIL.TRAIN);
  assert.equal(train.ok, true); assert.equal(train.flights, undefined, "Manchester Piccadilly (MAN) to Bristol Temple Meads (BRI) is a train, whatever the codes");
  assert.deepEqual(train.items.map((i) => i.name), ["Manchester Piccadilly to Bristol Temple Meads"]);
  // A flight email names flights only with airports the table knows, and a postcode is never a flight number.
  assert.deepEqual(flightLegs("Flight BA1 1AA\nBath to Paris"), []);
  assert.deepEqual(flightLegs("Your flight: XYZ to QQQ\nBA0123 3 March 2026"), [], "codes not in the table aren't airports");
  assert.equal(legDay("Fri 3 Jul", new Date("2026-08-01T00:00:00Z")), "2027-07-03", "a day without a year is the next one after the email");
  console.log("ok - a sale, a check-in reminder and a boarding pass aren't purchases; a train with station codes isn't a flight");
}

// 4. The reader's version and the search: flight bookings are asked for, and old emails are read again.
{
  assert.equal(PARSER_VERSION, 39, "the reader's version went up, so emails read before are read again with it");
  const src = readFileSync(new URL("../worker/gmail.js", import.meta.url), "utf8");
  const terms = /const SEARCH_TERMS =([\s\S]*?);\n/.exec(src)[1];
  for (const w of ['"e-ticket"', "eticket", '"travel confirmation"', '"flight confirmation"', "itinerary", "booking", "category:reservations"]) assert.ok(terms.includes(w), "Gmail is asked for " + w);
  for (const w of ["from:(ryanair", "boarding pass", "check-in", "check in"]) assert.ok(!terms.toLowerCase().includes(w), "never asked for an airline's other emails: " + w);
  assert.match(src, /const READER_FULL_REV = 14;/, "every mailbox is read once more in the background with the new reader");
  console.log("ok - the search asks for booking confirmations and e-tickets only; the reader's version moved on");
}

// 5. Wrapped: the furthest flight featured, the rest grouped, the totals; returns not replayed; places with their sights.
const listed = (c) => { const g = categorise(c), k = itemCategories(c); return { kind: "order", currency: "GBP", ...c, ...g, items: c.items.map((it, i) => ({ qty: 1, ...it, category: k[i] ? k[i].category : g.category })) }; };
let n = 0;
const card = (raw) => listed({ id: "f" + (++n), ...read(raw) });
const ticket = (date, name) => listed({ id: "t" + (++n), retailer: { name: "Trainline", domain: "thetrainline.com" }, orderDate: date, totalPence: 2000, items: [{ name, pricePence: 2000 }] });
const NOW = Date.UTC(2026, 10, 18);
{
  const w = buildWrapped([MAIL.BA, MAIL.RYANAIR, MAIL.EASYJET, MAIL.JET2, MAIL.EXPEDIA].map(card), 2026, NOW).travel;
  assert.equal(w.flights, 9, "each flight counted: four return bookings and a single");
  assert.equal(w.air.featured.toCode, "DXB", "Gatwick to Dubai is the furthest");
  assert.equal(w.air.featured.place, "Dubai"); assert.deepEqual(w.air.featured.sights, worldAttractionsFor("Dubai").attractions);
  assert.deepEqual(w.air.others.map((o) => o.toCode), ["BCN", "FAO", "ALC", "PMI"], "the others in date order; no way back among them");
  const expected = [["LHR", "BCN", 2], ["STN", "FAO", 1], ["MAN", "ALC", 2], ["LBA", "PMI", 2], ["LGW", "DXB", 2]].reduce((s, [a, b, k]) => s + k * distanceKm(airportByCode(a), airportByCode(b)), 0);
  assert.equal(w.air.totals.journeys, 9);
  assert.ok(Math.abs(w.air.totals.miles - expected / 1.609344) < 3, "the miles in the air, there and back: " + w.air.totals.miles);
  assert.equal(w.air.totals.atLeast, false);
  assert.equal(w.ground, null, "no trains, no train slides");
  // The same booking emailed twice (an updated itinerary under its own reference) isn't two trips.
  const twice = buildWrapped([card(MAIL.BA), listed({ ...card(MAIL.BA), id: "dup", orderRef: "X7KQPZ-2" })], 2026, NOW).travel;
  assert.equal(twice.flights, 2); assert.equal(twice.air.others.length, 0);
}
{
  // Trains: the furthest featured, the others grouped by place with how many times; the totals say "at least" when a trip
  // can't be measured; the way back counts as a journey and its miles.
  const w = buildWrapped([
    ticket("2026-01-14", "London King's Cross to Brighouse"), ticket("2026-01-16", "Brighouse to London Kings Cross"),
    ticket("2026-03-14", "Leeds to York (Return)"), ticket("2026-05-14", "Leeds to York"), ticket("2026-06-20", "York to Edinburgh Waverley"),
    ticket("2026-09-02", "Manchester Picc to Little Snoring Halt"),
  ], 2026, NOW).travel;
  assert.equal(w.ground.featured.to, "Brighouse");
  assert.deepEqual(w.ground.others.map((o) => o.place + " " + o.times), ["York 2", "Edinburgh 1", "Little Snoring Halt 1"]);
  assert.equal(w.ground.totals.journeys, 7);
  assert.equal(w.ground.totals.atLeast, true);
  const crow = (a, b) => distanceKm(a, b) / 1.609344;
  assert.ok(w.ground.totals.miles > 2 * 160 + 3 * 20, "both ways to Brighouse and to York counted: " + w.ground.totals.miles);
  assert.ok(w.ground.lines.every((l) => l.fromAt && l.toAt), "only routes with both ends known are drawn");
  assert.ok(crow(w.ground.featured.fromAt, w.ground.featured.toAt) > 150);
  // Places you went: Brighouse has no sights of its own, so Halifax's (5 km away), said as such; York its own; Little Snoring
  // Halt is named with nothing made up.
  const d = Object.fromEntries(w.destinations.map((x) => [x.place, x]));
  assert.equal(d.Brighouse.near, "Halifax"); assert.deepEqual(d.Brighouse.sights, ["The Piece Hall", "Shibden Hall", "Eureka! The National Children's Museum"]);
  assert.equal(d.York.near, undefined); assert.equal(d.York.times, 2);
  assert.deepEqual(d["Little Snoring Halt"].sights, []); assert.equal(d["Little Snoring Halt"].near, undefined);
  // A town with no listed place within 15 km borrows nothing.
  const far = buildWrapped([ticket("2026-02-01", "Leeds to Thurso")], 2026, NOW).travel;
  const th = far.destinations[0];
  assert.ok(!th.near && th.sights.length === 0, "nothing near Thurso is listed: nothing borrowed " + JSON.stringify(th));
}
{
  // A featured trip that can't be measured: the first of the year.
  const f = featuredAndRest([{ from: "Little Snoring Halt", to: "Nowhere Parkway", mode: "train", date: "2026-01-01" }, { from: "Somewhere Halt", to: "Elsewhere Halt", mode: "train", date: "2026-02-01" }]);
  assert.equal(f.featured.from, "Little Snoring Halt"); assert.equal(f.others.length, 1); assert.deepEqual(f.lines, []);
}
console.log("ok - Wrapped: the furthest flight and train journey featured, the rest grouped, totals, nearest sights said as such");
console.log("PASS flights: airline and travel-site bookings read as receipts, never a sale or a check-in; Wrapped's flights, groups and places");
