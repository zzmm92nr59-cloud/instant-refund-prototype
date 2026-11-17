// Offline test (real SQLite): Relay's shop directory (worker/shop-directory.js, worker/shop-seed.js), the three sources
// that decide which bank payments likely need a receipt (worker/bank.js whyNeedsReceipt).
// Checks: the seed list's size and kinds; TrueLayer's label (Shopping → highlighted for a shop Relay doesn't know,
// Groceries and eating out → not) kept with the payment when the bank is read; a supermarket on the seed list isn't
// highlighted but a photo of its receipt can still be added; a shop learned from receipts counts only once two different
// shoppers have had one (two receipts from one shopper aren't enough); the directory keeps nothing about anyone (its
// columns and values); Relay's test shops, its demo shop, the App Review account, forwarded emails, photo receipts and
// personal names are never counted; deleting an account leaves the directory as it was (nothing in it is theirs).
// People, shops and payments are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION } from "../worker/gmail.js";
import { whyNeedsReceipt } from "../worker/bank.js";
import { SEED, SHOP_KINDS } from "../worker/shop-seed.js";
import { classificationSays, seedShops, recordReceiptShops, LEARNED_MIN_SHOPPERS } from "../worker/shop-directory.js";

const none = { payments: new Set(), shops: new Set(), noReceipt: new Set() };
const pay = (description, extra = {}) => ({ payment_id: "x", description, merchant: null, amount_minor: 3000, receipt_id: null, ...extra });

// 1. The seed list: 400+ shops that sell things, each with a kind; supermarkets known but kept apart.
{
  const counts = Object.fromEntries(Object.entries(SEED).map(([k, l]) => [k, l.length]));
  assert.ok(Object.keys(counts).every((k) => SHOP_KINDS.includes(k)), "every kind is a known kind");
  const selling = Object.entries(counts).filter(([k]) => k !== "supermarket").reduce((n, [, c]) => n + c, 0);
  assert.ok(selling >= 400, "at least 400 shops that sell things: " + selling);
  const names = Object.values(SEED).flat().map((e) => e.split("|")[0]);
  assert.equal(new Set(names).size, names.length, "no shop listed twice");
  for (const s of ["Tesco", "Sainsbury's", "Asda", "Morrisons", "Aldi", "Lidl", "Waitrose", "Co-op", "M&S Food", "Iceland", "Ocado"]) assert.ok(SEED.supermarket.some((e) => e.split("|")[0] === s), s + " is a supermarket");
  assert.deepEqual(seedShops(["NEXT LEVEL BARBERS"]).map((s) => s.name), [], "an everyday word isn't taken for a shop");
  assert.deepEqual(seedShops(["RIVERISLAND 0412"]).map((s) => s.name), ["River Island"], "a long name written together");
  console.log("ok - seed list: " + selling + " shops that sell things and " + counts.supermarket + " supermarkets, " + JSON.stringify(counts));
}

// 2. TrueLayer's label, read by its documented words (any case); what it doesn't say counts for nothing.
{
  assert.equal(classificationSays(["Shopping", "Clothing"]), "yes");
  assert.equal(classificationSays('["shopping","electronics & software"]'), "yes", "stored as kept, any case");
  assert.equal(classificationSays(["Shopping", "Groceries"]), "no");
  assert.equal(classificationSays(["Food & Dining", "Restaurants"]), "no");
  assert.equal(classificationSays(["Bills and Utilities", "Mobile Phone"]), "no");
  assert.equal(classificationSays(["Auto & Transport", "Taxi"]), "no");
  assert.equal(classificationSays(["Entertainment", "Movies & DVDs"]), "no");
  assert.equal(classificationSays(["Home", "Rent"]), "no", "Home at the top is rent and mortgages");
  assert.equal(classificationSays(["Gifts & Donations", "Charity"]), "no");
  assert.equal(classificationSays(["Gifts & Donations", "Gift"]), "yes");
  assert.equal(classificationSays(["Education", "Books & Supplies"]), "yes");
  for (const odd of [null, "", [], ["Something New"], ["Health & Fitness", "Pharmacy"], "not json", 42]) assert.equal(classificationSays(odd), null, "nothing said: " + JSON.stringify(odd));
  const acme = (c) => whyNeedsReceipt(pay("SQ *ACME HOUSE 12", { classification: JSON.stringify(c) }), none);
  assert.equal(acme(["Shopping", "Clothing"]), "truelayer", "a shop Relay doesn't know, labelled Shopping: highlighted");
  assert.equal(acme(["Shopping", "Groceries"]), null, "Groceries: not");
  assert.equal(acme(["Food & Dining", "Restaurants"]), null, "eating out: not");
  assert.equal(whyNeedsReceipt(pay("SQ *ACME HOUSE 12"), none), null, "no label, not known: left alone");
  assert.equal(whyNeedsReceipt(pay("ZARA UK LTD", { classification: '["Food & Dining","Restaurants"]' }), none), "seed", "the seed list comes before the label");
  assert.equal(whyNeedsReceipt(pay("TESCO STORES 3012", { classification: '["Shopping","General"]' }), none), null, "a supermarket isn't highlighted whatever the label");
  assert.equal(whyNeedsReceipt(pay("COSTCUTTER 0412", { classification: '["Shopping","General"]' }), none), null, "a supermarket only on the seed list");
  assert.equal(whyNeedsReceipt(pay("SQ *ACME HOUSE 12", { classification: '["Shopping","Clothing"]' }), { ...none, noReceipt: new Set(["x"]) }), null, "the shopper's word comes first");
  console.log("ok - TrueLayer's label: Shopping highlighted for an unknown shop; Groceries, eating out, bills not; seed list first; supermarkets never");
}

// The app, against a real database.
const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); }
  };
}
const db = { prepare: (sql) => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { list.forEach((s) => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "ada.private@example.com",
  SECOND_STEP: "off", TRUELAYER_CLIENT_ID: "relay-test-id", TRUELAYER_CLIENT_SECRET: "tl-secret-test" };
let emails = [];
const tl = { accounts: [], tx: [] };
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url.endsWith("/data/v1/accounts")) return Response.json({ results: [{ account_id: "acc1", display_name: "Current account" }] });
  if (url.endsWith("/data/v1/cards")) return new Response("{}", { status: 501 });
  if (/\/data\/v1\/accounts\/acc1\/transactions/.test(url)) return Response.json({ results: tl.tx });
  return new Response("{}", { status: 404 });
};
let now = Date.UTC(2026, 10, 17, 9);
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  const t = (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
  assert.equal((await call("/relay/my/consent", { method: "POST", token: t, body: { version: CONSENT_VERSION } })).status, 200);
  return t;
}
const ada = await signIn("ada.private@example.com", "5.5.5.1"), ben = await signIn("ben.private@example.com", "5.5.5.2"),
  cal = await signIn("cal.private@example.com", "5.5.5.3"), rev = await signIn("review-team@example.com", "5.5.5.4");
const A = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("ada.private@example.com").id;
const order = (shop, from, ref, item, pence) => `From: ${shop} <${from}>\nSubject: Your order confirmation #${ref}\nContent-Type: text/plain\n\nOrder number: ${ref}\nOrder date: 10 Nov 2026\n${item} - Qty 1 - £${(pence / 100).toFixed(2)}\nOrder total: £${(pence / 100).toFixed(2)}\nReturns accepted within 30 days of purchase.\nPRIVATE-BODY-${ref}\n`;
const paste = async (token, text) => { const r = await (await call("/relay/my/receipts/add-pasted", { method: "POST", token, body: { email: text } })).json(); assert.ok(r.ok && r.kind === "receipt", JSON.stringify(r)); return r; };
const directory = () => sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'shop_directory'").get() ? sqlite.prepare("SELECT * FROM shop_directory ORDER BY key").all().map((r) => ({ ...r })) : [];

// 3. TrueLayer's label is kept with each payment when the bank is read, and used for the highlight.
await call("/relay/my/bank", { token: ada });   // makes the bank tables
const CONN = "00000000-0000-4000-8000-0000000000bb";
const { sealToken } = await import("../worker/gmail.js");
const sealed = await sealToken(env, JSON.stringify({ access: "tl-access", refresh: "tl-refresh", expires: now + 36e5 }));
sqlite.prepare("INSERT INTO bank_links (id, shopper_id, bank, token_iv, token_data, connected_at) VALUES (?,?,?,?,?,?)").run(CONN, A, "Mock", sealed.iv, sealed.data, now);
const tx = (id, day, amount, description, classification, merchant) => ({ transaction_id: id, timestamp: day + "T10:00:00Z", description, amount: -amount, currency: "GBP",
  transaction_type: "DEBIT", transaction_category: "PURCHASE", ...(classification ? { transaction_classification: classification } : {}), ...(merchant ? { merchant_name: merchant } : {}) });
tl.tx = [tx("t1", "2026-11-12", 42.5, "SQ *ACME HOUSE 12", ["Shopping", "Home"]), tx("t2", "2026-11-11", 18.2, "SQ *HILLTOP FARM SHOP", ["Shopping", "Groceries"]),
  tx("t3", "2026-11-10", 31, "SUMUP *THE COPPER POT", ["Food & Dining", "Restaurants"]), tx("t4", "2026-11-09", 64.3, "TESCO STORES 3012", ["Shopping", "Groceries"]),
  tx("t5", "2026-11-08", 55, "BRINDLE & FOX 0412"), tx("t6", "2026-11-07", 29, "PEBBLE GOODS"), tx("t7", "2026-11-06", 12, "MARLOW LANE CO", ["Shopping", "Clothing"], "Marlow Lane")];
assert.equal((await call("/relay/my/bank/sync", { method: "POST", token: ada })).status, 200);
const kept = Object.fromEntries(sqlite.prepare("SELECT payment_id, classification, merchant FROM bank_payments WHERE shopper_id = ?").all(A).map((r) => [r.payment_id.split(":")[1], r]));
assert.equal(kept.t1.classification, '["Shopping","Home"]', "kept as TrueLayer gave it");
assert.equal(kept.t5.classification, null, "nothing when TrueLayer says nothing");
assert.equal(kept.t7.merchant, "Marlow Lane", "TrueLayer's merchant_name kept too");
const flagged = async (token = ada) => (await (await call("/relay/my/bank/payments", { token })).json()).payments.filter((p) => p.needsReceipt).map((p) => p.shop).sort();
assert.deepEqual(await flagged(), ["Acme House", "Marlow Lane"], "Shopping: yes; Groceries, eating out, a supermarket and unknown shops with no label: no");
console.log("ok - TrueLayer's label kept with each payment when the bank is read, and used for the highlight");

// 4. A supermarket isn't highlighted, but a photo of its receipt can still be added.
const TESCO = CONN + ":t4";
const jpeg = Buffer.alloc(600, 1); jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[2] = 0xff; jpeg[3] = 0xe0;
let r = await call("/relay/my/bank/receipt-photo", { method: "POST", token: ada, body: { id: TESCO, image: "data:image/jpeg;base64," + jpeg.toString("base64") } });
assert.equal(r.status, 200, "a photo of a supermarket receipt is accepted");
assert.equal((await r.json()).receipt.shop, "Tesco");
assert.equal(directory().length, 0, "a receipt from a photo isn't a receipt the shop sent: not counted");
console.log("ok - a supermarket payment isn't highlighted, and a photo of its receipt can still be added (not counted as the shop sending receipts)");

// 5. A shop learned from receipts counts only once two different shoppers have had one.
await paste(ada, order("Brindle & Fox", "orders@brindlefox.test", "BF-1001", "Linen shirt", 5500));
await paste(ada, order("Brindle & Fox", "orders@brindlefox.test", "BF-1002", "Wool scarf", 3000));
let row = directory().find((d) => d.key === "brindlefox");
assert.deepEqual([row.receipts, row.shoppers], [2, 1], "two receipts from one shopper: one shopper");
assert.ok(!(await flagged()).includes("Brindle & Fox"), "one shopper isn't enough");
await paste(ben, order("Brindle & Fox", "orders@brindlefox.test", "BF-2001", "Canvas tote", 2500));
row = directory().find((d) => d.key === "brindlefox");
assert.deepEqual([row.receipts, row.shoppers, row.name, row.kind, row.source], [3, LEARNED_MIN_SHOPPERS, "Brindle & Fox", "fashion", "receipts"]);
assert.ok((await flagged()).includes("Brindle & Fox"), "two different shoppers: it gives receipts");
assert.equal(whyNeedsReceipt(sqlite.prepare("SELECT * FROM bank_payments WHERE payment_id = ?").get(CONN + ":t5"), none, new Map([["brindlefox", "fashion"]])), "learned");
assert.deepEqual((await (await call("/relay/my/receipts", { token: ada })).json()).needReceipt.map((p) => p.shop).sort(), ["Acme House", "Brindle & Fox", "Marlow Lane"], "Home's list too");
console.log("ok - learned shop: highlighted only after receipts from two different shoppers (two from one aren't enough)");

// 6. Never counted: Relay's test shops, its demo shop, the App Review account, forwarded emails, names that look like a person.
sqlite.exec("CREATE TABLE IF NOT EXISTS shopify_shop_plan (domain TEXT PRIMARY KEY, test_shop INTEGER NOT NULL, plan TEXT, checked_at INTEGER NOT NULL)");
sqlite.prepare("INSERT INTO shopify_shop_plan (domain, test_shop, plan, checked_at) VALUES (?,?,?,?)").run("pebble-goods.myshopify.com", 1, "partner_test", now);
for (const t of [ada, ben]) {
  await paste(t, order("Pebble Goods", "orders@pebble-goods.test", "PG-" + t.slice(0, 4), "Mug", 2900));
  await paste(t, order("Relay Demo Store", "store@relay-demo.myshopify.com", "RD-" + t.slice(0, 4), "Hoodie", 4000));
  await paste(t, order("Sam Patel", "sam.patel@gmail.com", "SP-" + t.slice(0, 4), "Old camera", 6000));
}
sqlite.prepare("INSERT INTO review_account (id, address, created_at) VALUES (1, ?, ?)").run("review-team@example.com", now);
await paste(rev, order("Quill & Ink", "hello@quillandink.test", "QI-1", "Fountain pen", 3500));
await paste(cal, order("Quill & Ink", "hello@quillandink.test", "QI-2", "Ink bottle", 900));
assert.deepEqual(directory().map((d) => d.key), ["brindlefox", "quillandink"], "no test shop, demo shop or forwarded email");
assert.deepEqual([directory()[1].shoppers, directory()[1].receipts], [1, 1], "the App Review account's receipt isn't counted");
assert.ok(!(await flagged()).includes("Pebble Goods"), "a test shop is never learned");
// Direct: a photo receipt and a person's name with no web address aren't counted either.
await recordReceiptShops(env, A, [{ id: "made-up-1", details: { kind: "receipt", photoReceipt: true, source: "receipt_photo", retailer: { name: "Brindle & Fox" } } },
  { id: "made-up-2", details: { kind: "receipt", retailer: { name: "Emma Wilson", domain: null } } }], now);
assert.deepEqual(directory().map((d) => [d.key, d.receipts]), [["brindlefox", 3], ["quillandink", 1]]);
console.log("ok - never counted: Relay's test shops, its demo shop, the App Review account, forwarded emails, photo receipts, people's names");

// 7. The directory keeps nothing about anyone: only the shop, its kind, counts and days.
const cols = sqlite.prepare("PRAGMA table_info(shop_directory)").all().map((c) => c.name);
assert.deepEqual(cols, ["key", "name", "kind", "source", "receipts", "shoppers", "first_seen", "last_seen"]);
const all = JSON.stringify(directory());
const ids = sqlite.prepare("SELECT id FROM shoppers").all().map((s) => s.id);
for (const bad of [...ids, "example.com", "ada", "ben", "BF-1001", "5500", "55.00", "Linen shirt", "PRIVATE-BODY", "orders@", CONN])
  assert.ok(!all.toLowerCase().includes(String(bad).toLowerCase()), "nothing about anyone: " + bad);
assert.ok(directory().every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.first_seen) && /^\d{4}-\d{2}-\d{2}$/.test(d.last_seen)), "days, not times (a time could be matched to a receipt)");
console.log("ok - the directory keeps only the shop's name, kind, counts and the days it was seen: never who, what, how much or the email");

// 8. Download my data has the label; deleting an account deletes its payments and leaves the directory as it was.
const mine = await (await call("/relay/my/export", { token: ada })).json();
const exported = JSON.stringify(mine);
assert.ok(exported.includes('[\\"Shopping\\",\\"Home\\"]') || exported.includes('["Shopping","Home"]'), "TrueLayer's label is in Download my data");
assert.ok(!exported.includes("shop_directory") && !exported.includes("quillandink"), "the directory isn't anyone's data");
const before = all;
assert.equal((await call("/relay/my/delete", { method: "POST", token: ada })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_payments WHERE shopper_id = ?").get(A).n, 0);
assert.equal(JSON.stringify(directory()), before, "the directory is unchanged: nothing in it was Ada's");
console.log("ok - Download my data has the bank's label; deleting the account deletes the payments, the directory holds nothing of theirs");
console.log("PASS shop directory: seed list, TrueLayer's labels, learned shops from two shoppers, nothing personal kept, test shops left out");
