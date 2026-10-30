// Offline tests for Royal Mail return labels (Click & Drop, on the shop's own account).
// Royal Mail, Shopify and the email service are stand-ins; nothing leaves this machine.
// Checks: the shop's key is checked with Royal Mail, stored encrypted and never sent back; a label is shown only when
// Royal Mail returns a tracking number; only the shopper who started the return can download it; nothing is made up
// when Royal Mail, the order address or the shop's set-up is missing.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleRetailerRoute, issueRetailerKey } from "../worker/retailer.js";
import { handleReturnRoute } from "../worker/returns.js";
import { labelDeleteStatements, RM_API } from "../worker/royal-mail.js";
import { emailHash } from "../worker/auth.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
sqlite.exec(`CREATE TABLE IF NOT EXISTS retailer_order_emails (order_id TEXT PRIMARY KEY, email_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS relay_exchanges (id TEXT PRIMARY KEY, shopper_id TEXT, order_id TEXT, line_id TEXT, shop TEXT, from_variant TEXT, from_title TEXT,
    to_variant TEXT, to_title TEXT, quantity INTEGER, status TEXT, detail TEXT, created_at INTEGER);`);
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; }, _exec() { sqlite.prepare(sql).run(...args); } };
}
const db = { prepare: sql => stmt(sql), async batch(list) { list.forEach(s => s._exec()); return []; } };
const SECRET = "unit-test-auth-secret-0123456789";
const env = { RELAY_DB: db, AUTH_SECRET: SECRET, RESEND_API_KEY: "test-resend" };
const SHOP = "kick-lane.myshopify.com";
const KEY = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PDF = btoa("%PDF-1.4 fake royal mail label");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// ---- Stand-in Royal Mail, Shopify and email ----
let rmCalls = [], shopifyCalls = [], emails = [];
let rm = { keyOk: true, services: [{ serviceName: "Tracked Returns 48", serviceCode: "TSS" }, { serviceName: "Tracked Returns 24", serviceCode: "TSN" }],
  returnStatus: 200, returnBody: () => ({ shipment: { trackingNumber: "TT123456789GB", uniqueItemId: "U1" }, qrCode: PNG, label: PDF }) };
let address = { firstName: "Alice", lastName: "Smith", name: "Alice Smith", company: null, address1: "1 High Street", address2: "Flat 2", city: "Leeds", zip: "LS1 1AA", countryCodeV2: "GB" };
const fetchImpl = async (u, init = {}) => {
  u = String(u);
  if (u.startsWith(RM_API)) {
    rmCalls.push({ path: u.slice(RM_API.length), method: init.method, auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : null });
    if (!rm.keyOk) return new Response("", { status: 401 });
    if (u === RM_API + "/returns/services") return Response.json({ services: rm.services });
    if (u === RM_API + "/returns" && init.method === "POST") return rm.returnStatus === 200 ? Response.json(rm.returnBody()) : new Response("{}", { status: rm.returnStatus });
  }
  if (u === "https://" + SHOP + "/admin/api/2026-07/graphql.json") {
    const q = JSON.parse(init.body); shopifyCalls.push(q);
    if (/RelayReturnAddress/.test(q.query)) return Response.json({ data: { order: { shippingAddress: address } } });
    return Response.json({ data: { shop: { name: "Kick Lane", email: "owner@kicklane.example", contactEmail: "returns@kicklane.example" }, order: { name: "#1" + q.variables.id.split("/").pop() } } });
  }
  if (u === "https://api.resend.com/emails") { emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  throw Error("unexpected network call to " + u);
};
const listStores = async () => [{ domain: SHOP, token: "tok", label: "Kick Lane" }];

// ---- The shop's dashboard ----
const shopKey = await issueRetailerKey(env, { provider: "shopify", shopRef: SHOP, storeLabel: "Kick Lane" });
const squareKey = await issueRetailerKey(env, { provider: "square", shopRef: "MZARA1", storeLabel: "Zara" });
const shopCall = async (key, method, path, body) => {
  const url = new URL("https://w.example" + path);
  const res = await handleRetailerRoute(new Request(url, { method, headers: { Authorization: "Bearer " + key }, body: body ? JSON.stringify(body) : undefined }), env, url, {}, { fetchImpl });
  return { status: res.status, body: await res.json() };
};
const addr = { name: "Kick Lane Returns", company: "Kick Lane Ltd", line1: "Unit 4, Mill Yard", line2: "", city: "Manchester", postcode: "m1 2ab" };

let r = await shopCall(shopKey, "GET", "/relay/retailer/royal-mail");
assert.deepEqual(r.body, { connected: false });
assert.equal((await shopCall(squareKey, "GET", "/relay/retailer/royal-mail")).body.error, "shopify_only");
assert.equal((await shopCall(shopKey, "POST", "/relay/retailer/royal-mail", { address: addr })).body.error, "key_needed");
assert.equal((await shopCall(shopKey, "POST", "/relay/retailer/royal-mail", { apiKey: KEY, address: { ...addr, postcode: "12345" } })).body.error, "bad_postcode");
assert.equal((await shopCall(shopKey, "POST", "/relay/retailer/royal-mail", { apiKey: KEY, address: { ...addr, line1: "" } })).body.error, "address_incomplete");
assert.equal((await shopCall(shopKey, "POST", "/relay/retailer/royal-mail", { apiKey: "short", address: addr })).body.error, "bad_key");
assert.equal(rmCalls.length, 0, "nothing goes to Royal Mail until the form is complete");
// Royal Mail refuses the key: nothing saved.
rm.keyOk = false;
r = await shopCall(shopKey, "POST", "/relay/retailer/royal-mail", { apiKey: KEY, address: addr });
assert.equal(r.status, 400); assert.equal(r.body.error, "bad_key");
assert.equal(rmCalls.at(-1).auth, "Bearer " + KEY); assert.equal(rmCalls.at(-1).path, "/returns/services");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM relay_royal_mail").get().n, 0);
rm.keyOk = true;
// A service that isn't on the account is refused, and the real list comes back to choose from.
r = await shopCall(shopKey, "POST", "/relay/retailer/royal-mail", { apiKey: KEY, address: addr, serviceCode: "NOPE" });
assert.equal(r.body.error, "bad_service"); assert.deepEqual(r.body.services.map(s => s.code), ["TSS", "TSN"]);
// Saved: the first service by default, postcode tidied, key never returned and not stored in plain text.
r = await shopCall(shopKey, "POST", "/relay/retailer/royal-mail", { apiKey: KEY, address: addr });
assert.equal(r.status, 200); assert.equal(r.body.connected, true);
assert.equal(r.body.serviceCode, "TSS"); assert.equal(r.body.serviceName, "Tracked Returns 48");
assert.equal(r.body.address.postcode, "M1 2AB");
assert.doesNotMatch(JSON.stringify(r.body), new RegExp(KEY));
assert.doesNotMatch(JSON.stringify((await shopCall(shopKey, "GET", "/relay/retailer/royal-mail")).body), new RegExp(KEY));
assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT * FROM relay_royal_mail").get()), new RegExp(KEY));
// Change the service without re-entering the key: the stored key is used to re-check.
r = await shopCall(shopKey, "POST", "/relay/retailer/royal-mail", { address: addr, serviceCode: "TSN" });
assert.equal(r.status, 200); assert.equal(r.body.serviceCode, "TSN"); assert.equal(rmCalls.at(-1).auth, "Bearer " + KEY);
console.log("PASS shop set-up: key checked with Royal Mail, stored encrypted, never shown again");

// ---- Returns ----
const alice = { id: "alice", emailHash: await emailHash(SECRET, "alice@example.com") };
const bob = { id: "bob", emailHash: await emailHash(SECRET, "bob@example.com") };
const conn = "shopify:" + SHOP;
sqlite.prepare("INSERT OR IGNORE INTO retailer_connections (id, provider, merchant_external_id) VALUES (?,?,?)").run(conn, "shopify", SHOP);
let n = 200;
function order(who = alice) {
  const ext = String(n++), id = conn + ":order:" + ext;
  sqlite.prepare("INSERT INTO retailer_orders (id, connection_id, external_order_id, ordered_at, amount_minor, currency, payment_processor, status, raw_identifier_keys) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, conn, ext, new Date(Date.now() - 864e5).toISOString(), 2000, "GBP", "shopify", "unverified", "[]");
  sqlite.prepare("INSERT INTO retailer_order_emails (order_id, email_hash, created_at) VALUES (?,?,?)").run(id, who.emailHash, 1);
  sqlite.prepare("INSERT INTO order_items (id, order_id, external_line_item_id, product_id, variant_id, title, quantity, price_minor, currency) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id + ":item:1", id, "L1", "P1", "V1", "Logo Sports Cap", 1, 2000, "GBP");
  return id;
}
const shopper = async (who, method, path, body) => {
  const url = new URL("https://w.example" + path);
  const res = await handleReturnRoute(new Request(url, { method, body: body ? JSON.stringify(body) : undefined }), env, url, {}, who, { fetchImpl, listStores });
  return { status: res.status, type: res.headers.get("content-type"), res };
};
const start = async (orderId, who = alice) => { const x = await shopper(who, "POST", "/relay/my/return", { orderId, lineId: "L1", reason: "wrong_size" }); return { status: x.status, body: await x.res.json() }; };

// A label: Royal Mail is asked with the order's address, the shop's return address and Relay's reference.
rmCalls = []; emails = [];
const o1 = order();
r = await start(o1);
assert.equal(r.status, 200);
assert.equal(r.body.labelAvailable, true);
assert.equal(r.body.carrier, "Royal Mail"); assert.equal(r.body.trackingNumber, "TT123456789GB"); assert.equal(r.body.serviceName, "Tracked Returns 24");
assert.equal(r.body.hasPdf, true); assert.equal(r.body.qrImage, "data:image/png;base64," + PNG);
const sent = rmCalls.find(c => c.path === "/returns");
assert.equal(sent.auth, "Bearer " + KEY); assert.equal(sent.method, "POST");
assert.deepEqual(sent.body.service, { serviceCode: "TSN" });
assert.deepEqual(sent.body.shipment.shippingAddress, { firstName: "Alice", lastName: "Smith", addressLine1: "1 High Street", addressLine2: "Flat 2", city: "Leeds", postcode: "LS1 1AA", country: "United Kingdom", countryIsoCode: "GBR" });
assert.deepEqual(sent.body.shipment.returnAddress, { firstName: "Kick Lane", lastName: "Returns", companyName: "Kick Lane Ltd", addressLine1: "Unit 4, Mill Yard", city: "Manchester", postcode: "M1 2AB", country: "United Kingdom", countryIsoCode: "GBR" });
assert.deepEqual(sent.body.shipment.customerReference, { reference: r.body.returnRef });
const saved = sqlite.prepare("SELECT carrier, tracking_number FROM relay_returns WHERE order_id = ?").get(o1);
assert.deepEqual([saved.carrier, saved.tracking_number], ["royal_mail", "TT123456789GB"]);
// The shop's email says a label was made, with the tracking number; the address isn't stored by Relay.
assert.match(emails.at(-1).text, /created a Royal Mail return label \(Tracked Returns 24\).*Tracking number: TT123456789GB/);
assert.doesNotMatch(emails.at(-1).text, /not created a postage label/);
assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT * FROM relay_returns WHERE order_id = ?").get(o1)), /High Street|LS1 1AA/);
// The shopper's list shows the tracking number.
const list = await (await shopper(alice, "GET", "/relay/my/returns")).res.json();
assert.equal(list.returns.find(x => x.orderId === o1).trackingNumber, "TT123456789GB");
// Downloading: Alice gets the PDF and the QR picture; Bob gets nothing.
let d = await shopper(alice, "GET", "/relay/my/return/label?kind=pdf&id=" + r.body.returnId);
assert.equal(d.status, 200); assert.equal(d.type, "application/pdf");
assert.equal(new TextDecoder().decode(await d.res.arrayBuffer()), "%PDF-1.4 fake royal mail label");
d = await shopper(alice, "GET", "/relay/my/return/label?kind=qr&id=" + r.body.returnId);
assert.equal(d.status, 200); assert.equal(d.type, "image/png");
d = await shopper(bob, "GET", "/relay/my/return/label?kind=pdf&id=" + r.body.returnId);
assert.equal(d.status, 404);
// The shop's pilot results show the tracking number.
const results = (await shopCall(shopKey, "GET", "/relay/retailer/results")).body;
assert.equal(results.returns.find(x => x.ref === r.body.returnRef).trackingNumber, "TT123456789GB");
console.log("PASS return with a Royal Mail label: right addresses sent, QR + PDF for the shopper only, shop emailed the tracking number");

// No made-up labels.
const noLabel = (b) => {
  assert.equal(b.labelAvailable, false);
  for (const k of ["carrier", "trackingNumber", "qrImage", "hasPdf"]) assert.equal(k in b, false, "no " + k + " without a real label");
  assert.match(emails.at(-1).text, /not created a postage label/);
};
// Royal Mail errors.
rm.returnStatus = 500; r = await start(order()); noLabel(r.body); rm.returnStatus = 200;
// Royal Mail answers without a tracking number.
rm.returnBody = () => ({ shipment: {}, qrCode: PNG, label: PDF }); r = await start(order()); noLabel(r.body);
// Odd files from Royal Mail: tracking number shown, but no PDF or picture that isn't really one.
rm.returnBody = () => ({ shipment: { trackingNumber: "TT987654321GB" }, qrCode: "<svg onload=alert(1)>", label: "not a pdf" });
r = await start(order()); assert.equal(r.body.labelAvailable, true); assert.equal(r.body.hasPdf, false); assert.equal(r.body.qrImage, null);
assert.equal((await shopper(alice, "GET", "/relay/my/return/label?kind=pdf&id=" + r.body.returnId)).status, 404);
rm.returnBody = () => ({ shipment: { trackingNumber: "TT123456789GB" }, qrCode: PNG, label: PDF });
// An order going abroad, or without an address: Royal Mail isn't asked.
rmCalls = [];
address = { ...address, countryCodeV2: "FR", zip: "75001" }; r = await start(order()); noLabel(r.body);
address = null; r = await start(order()); noLabel(r.body);
assert.equal(rmCalls.filter(c => c.path === "/returns").length, 0);
address = { firstName: "Alice", lastName: "Smith", address1: "1 High Street", city: "Leeds", zip: "LS1 1AA", countryCodeV2: "GB" };
console.log("PASS no label is shown unless Royal Mail returns a real tracking number");

// Shop turns it off: the key is deleted and returns go back to the shop's own process, without asking Shopify for addresses.
r = await shopCall(shopKey, "POST", "/relay/retailer/royal-mail/remove", {});
assert.deepEqual(r.body, { connected: false });
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM relay_royal_mail").get().n, 0);
rmCalls = []; shopifyCalls = [];
r = await start(order()); noLabel(r.body);
assert.equal(rmCalls.length, 0); assert.equal(shopifyCalls.filter(q => /RelayReturnAddress/.test(q.query)).length, 0);
console.log("PASS turning it off deletes the key and stops labels");

// Deleting the shopper's account deletes their labels (and works on a database that never made one).
await db.batch(await labelDeleteStatements(db, "alice"));
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM relay_return_labels WHERE shopper_id = 'alice'").get().n, 0);
const fresh = new DatabaseSync(":memory:");
const freshDb = { prepare: sql => ({ bind: (...a) => ({ async run() { fresh.prepare(sql).run(...a); }, _exec() { fresh.prepare(sql).run(...a); } }), async run() { fresh.prepare(sql).run(); } }) };
for (const s of await labelDeleteStatements(freshDb, "x")) s._exec();
const auth = readFileSync("worker/auth.js", "utf8");
assert.match(auth, /\.\.\.\(await labelDeleteStatements\(env\.RELAY_DB, shopper\.id\)\)/);
console.log("PASS account deletion removes return labels");

// The app only shows the label screen when there's a tracking number from Royal Mail.
const app = readFileSync("account.js", "utf8");
assert.match(app, /if \(result\.labelAvailable && result\.trackingNumber\) return showLabel\(result\);/);
console.log("royal mail labels: all checks passed");
