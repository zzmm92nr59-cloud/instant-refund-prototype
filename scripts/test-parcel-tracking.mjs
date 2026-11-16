// Offline test (real SQLite; Ship24 is a stand-in): live parcel tracking (worker/parcel-tracking.js). Off until the key is
// set; only the tracking number (and "GB") is sent; only parcels not yet delivered and ordered in the last 30 days; each
// new tracking number counts once, 10 a month for all of Relay and 3 per shopper; looked up again at most every 2 hours
// and never once delivered; Relay says only what the carrier said. Tracking numbers and parcels are made up.
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { readShip24, applyTracked, liveParcel, readTrackedRows } from "../worker/parcel-tracking.js";

const TODAY = "2026-11-16", NOW = Date.parse(TODAY + "T12:00:00Z");
const ev = (m, d) => ({ statusMilestone: m, occurrenceDatetime: d + "T09:30:00", status: "made-up event" });
const body = (milestone, events, eta) => ({ data: { trackings: [{ tracker: { trackerId: "t1" }, shipment: { statusMilestone: milestone, delivery: { estimatedDeliveryDate: eta || null } }, events }] } });

// What the carrier said, in Relay's words.
assert.deepEqual(readShip24(body("delivered", [ev("in_transit", "2026-11-12"), ev("delivered", "2026-11-14")]), TODAY), { status: "delivered", at: "2026-11-14" });
assert.deepEqual(readShip24(body("out_for_delivery", [ev("out_for_delivery", "2026-11-16")]), TODAY), { status: "out_for_delivery", at: "2026-11-16" });
assert.deepEqual(readShip24(body("available_for_pickup", [ev("available_for_pickup", "2026-11-15")]), TODAY), { status: "collect", at: "2026-11-15" });
assert.deepEqual(readShip24(body("failed_attempt", [ev("failed_attempt", "2026-11-15")]), TODAY), { status: "missed", at: "2026-11-15" });
assert.deepEqual(readShip24(body("exception", [ev("exception", "2026-11-13")]), TODAY), { status: "problem", at: "2026-11-13" });
assert.deepEqual(readShip24(body("in_transit", [ev("in_transit", "2026-11-13")], "2026-11-18T00:00:00"), TODAY), { status: "due", at: "2026-11-18" }, "the carrier's own expected date");
assert.deepEqual(readShip24(body("in_transit", [ev("in_transit", "2026-11-13")], "2026-11-10"), TODAY), { status: "in_transit", at: "2026-11-13" }, "an expected date that's passed says nothing");
assert.equal(readShip24(body("pending", []), TODAY), null, "no news: the email's word stands");
assert.equal(readShip24(body("info_received", [ev("info_received", "2026-11-12")]), TODAY), null);
assert.equal(readShip24({ data: { trackings: [] } }, TODAY), null);
assert.equal(readShip24(null, TODAY), null);
console.log("ok - the carrier's milestone and date, in plain statuses; nothing when the carrier has no news");

// The carrier's news replaces the email's; an email that says delivered isn't taken back.
{
  const orders = [{ id: "a", delivery: { status: "shipped", trackingNumber: "AB123456789GB", carrier: "Royal Mail" } },
    { id: "b", delivery: { status: "delivered", at: "2026-11-10", trackingNumber: "CD123456789GB" } }, { id: "c" }];
  applyTracked(orders, [{ tracking_number: "AB123456789GB", status: "out_for_delivery", at: "2026-11-16" }, { tracking_number: "CD123456789GB", status: "in_transit", at: "2026-11-09" }]);
  assert.deepEqual(orders[0].delivery, { status: "out_for_delivery", at: "2026-11-16", trackingNumber: "AB123456789GB", carrier: "Royal Mail", live: true });
  assert.equal(orders[1].delivery.status, "delivered");
  console.log("ok - the receipts list shows the carrier's news");
}

const sqlite = new DatabaseSync(":memory:");
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); } };
}
const db = { prepare: (sql) => stmt(sql), async batch(list) { list.forEach((s) => s._exec()); return []; } };
let calls = [], reply = () => Response.json(body("in_transit", [ev("in_transit", "2026-11-14")], "2026-11-18"));
const fetchImpl = async (url, init = {}) => { calls.push({ url: String(url), init }); return reply(String(url), init); };
const env = { RELAY_DB: db, SHIP24_API_KEY: "ship24-test-key" };
const order = (tn, o = {}) => ({ id: "r-" + tn, orderDate: o.orderDate || "2026-11-10", orderRef: "ORD-1", delivery: { status: o.status || "shipped", trackingNumber: tn, carrier: "Royal Mail" } });

// Off until the key is set.
assert.deepEqual(await liveParcel({ RELAY_DB: db }, "s1", order("AA000000001GB"), { now: NOW, fetchImpl }), { available: false, delivery: null });
assert.equal(calls.length, 0);

// The first look: one new parcel, only the tracking number and "GB" sent, with the key.
let r = await liveParcel(env, "s1", order("aa000000001gb"), { now: NOW, fetchImpl });
assert.deepEqual(r.delivery, { status: "due", at: "2026-11-18", trackingNumber: "aa000000001gb", carrier: "Royal Mail", live: true });
assert.equal(calls.length, 1);
assert.equal(calls[0].url, "https://api.ship24.com/public/v1/trackers/track");
assert.deepEqual(JSON.parse(calls[0].init.body), { trackingNumber: "AA000000001GB", destinationCountryCode: "GB" }, "only the tracking number");
assert.equal(calls[0].init.headers.Authorization, "Bearer ship24-test-key");
assert.equal((await db.prepare("SELECT n FROM parcel_track_uses WHERE month = '2026-11'").first()).n, 1);
console.log("ok - off until the key is set; only the tracking number goes to Ship24");

// Again within 2 hours: no new question. After 2 hours: the results again, which doesn't count as a new parcel.
r = await liveParcel(env, "s1", order("AA000000001GB"), { now: NOW + 36e5, fetchImpl });
assert.equal(calls.length, 1); assert.equal(r.delivery.status, "due");
reply = () => Response.json(body("delivered", [ev("delivered", "2026-11-16")]));
r = await liveParcel(env, "s1", order("AA000000001GB"), { now: NOW + 3 * 36e5, fetchImpl });
assert.equal(calls.length, 2); assert.equal(calls[1].url, "https://api.ship24.com/public/v1/trackers/search/AA000000001GB/results"); assert.equal(calls[1].init.method, "GET");
assert.deepEqual([r.delivery.status, r.delivery.at], ["delivered", "2026-11-16"]);
assert.equal((await db.prepare("SELECT n FROM parcel_track_uses WHERE month = '2026-11'").first()).n, 1, "looking again doesn't use up a parcel");
r = await liveParcel(env, "s1", order("AA000000001GB"), { now: NOW + 9 * 36e5, fetchImpl });
assert.equal(calls.length, 2, "delivered: never asked again");
const rows = await readTrackedRows(db, "s1");
assert.deepEqual(rows.map((x) => [x.tracking_number, x.status]), [["AA000000001GB", "delivered"]]);
assert.deepEqual(await readTrackedRows(db, "someone-else"), [], "each shopper's own");
console.log("ok - looked up again at most every 2 hours, never once delivered; repeat looks don't use the allowance");

// Not asked: delivered already, too old, no tracking number, or a made-up looking number.
for (const o of [order("AA000000002GB", { status: "delivered" }), order("AA000000003GB", { orderDate: "2026-09-01" }), { id: "x", orderDate: "2026-11-10", delivery: { status: "shipped" } }, order("NOT A NUMBER!"), { id: "y", orderDate: "2026-11-10" }]) {
  r = await liveParcel(env, "s1", o, { now: NOW, fetchImpl });
  assert.equal(r.delivery, null); assert.equal(r.reason, "not_tracked");
}
assert.equal(calls.length, 2);
console.log("ok - only parcels not yet delivered, ordered in the last 30 days, with a real-looking tracking number");

// Allowances: 3 new parcels a shopper a month, 10 for all of Relay.
reply = () => Response.json(body("in_transit", [ev("in_transit", "2026-11-14")]));
for (const tn of ["BB000000001GB", "BB000000002GB"]) assert.equal((await liveParcel(env, "s1", order(tn), { now: NOW, fetchImpl })).delivery.status, "in_transit");
r = await liveParcel(env, "s1", order("BB000000003GB"), { now: NOW, fetchImpl });
assert.deepEqual([r.delivery, r.reason], [null, "limit"], "a 4th new parcel for one shopper waits");
for (let i = 0; i < 7; i++) await liveParcel(env, "s" + (i + 10), order("CC00000000" + i + "GB"), { now: NOW, fetchImpl });
assert.equal((await db.prepare("SELECT n FROM parcel_track_uses WHERE month = '2026-11'").first()).n, 10);
const before = calls.length;
r = await liveParcel(env, "s99", order("DD000000001GB"), { now: NOW, fetchImpl });
assert.deepEqual([r.delivery, r.reason, calls.length], [null, "limit", before], "the 11th new parcel this month isn't sent");
r = await liveParcel(env, "s98", order("BB000000001GB"), { now: NOW + 3 * 36e5, fetchImpl });
assert.equal(calls.at(-1).url, "https://api.ship24.com/public/v1/trackers/search/BB000000001GB/results", "a parcel already tracked can still be looked up");
console.log("ok - 3 new parcels a shopper and 10 for all of Relay each month");

// Ship24 down: the last thing it said, or nothing; never an error shown as news.
reply = () => new Response("{}", { status: 500 });
r = await liveParcel(env, "s1", order("BB000000002GB"), { now: NOW + 5 * 36e5, fetchImpl });
assert.equal(r.delivery.status, "in_transit", "the last thing the carrier said");
r = await liveParcel(env, "s50", order("EE000000001GB"), { now: Date.parse("2026-12-01T10:00:00Z"), fetchImpl: async () => new Response("{}", { status: 500 }) });
assert.deepEqual([r.delivery, r.reason], [null, "carrier_unavailable"]);
console.log("ok - when Ship24 can't be reached: the last news, or none");
console.log("parcel tracking: all checks passed");
