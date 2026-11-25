// Offline test (real SQLite; Anthropic is a stand-in): bank payments with no receipt that likely should have one, and
// "Add a photo of the receipt" (worker/bank.js, worker/receipt-photo.js).
// Checks: the rule (a shop that sells things, £5 or more, no receipt, not "not mine"; never transfers, bills, food, transport,
// apps); the flag on the payments the Bank page loads, and the list Home gets with /relay/my/receipts (no extra request);
// "This wasn't a shop purchase"; only your own payment (someone else's is 404); bad or oversized photos refused (400/413);
// without the AI reader the receipt is made from the bank's facts with no items; with it, exactly what was read, and a total
// that differs from the bank's is kept and flagged, never forced to fit; the photo kept, viewable only by its owner, and
// deleted with the receipt and the account; the link to the payment survives matching again; 20 photos a day.
// People, shops and payments are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION } from "../worker/gmail.js";
import { likelyNeedsReceipt, RECEIPT_PHOTOS_PER_DAY } from "../worker/bank.js";
import { resetMemoryLimits } from "../worker/limits.js";

// 1. The rule.
{
  const p = (description, amount_minor, extra = {}) => ({ payment_id: "x", description, merchant: null, amount_minor, receipt_id: null, ...extra });
  const none = { payments: new Set(), shops: new Set(), noReceipt: new Set() };
  const yes = [p("H&M", 3499), p("H & M HENNES", 2000), p("ZARA UK LTD", 4999), p("AMZNMKTPLACE AMAZON.CO.UK", 1299), p("JOHN LEWIS PLC", 8900),
    p("CARD PAYMENT TO CURRYS ON 03-11-2026", 19900), p("BRINDLE CLOTHING CO", 4500), p("PAYPAL *EBAY", 2500), p("CRD 1234", 3000, { merchant: "Uniqlo" })];
  const no = [p("H&M", 300), p("TRANSFER TO J SMITH", 5000), p("EDF ENERGY", 8000), p("RENT", 90000), p("NETFLIX.COM", 1099), p("COFFEE CORNER", 320),
    p("TESCO STORES 3012", 4200), p("UBER *TRIP", 1800), p("DELIVEROO", 2400), p("PRIME VIDEO", 899), p("APPLE.COM/BILL", 299), p("M&S SIMPLY FOOD", 1200),
    p("TFL TRAVEL CHARGE", 680), p("BLUE DOOR LTD", 5000), p("SHELL FUEL", 6000), p("H&M", 3499, { receipt_id: "r1" })];
  assert.deepEqual(yes.map((x) => likelyNeedsReceipt(x, none)), yes.map(() => true), "shops that sell things");
  assert.deepEqual(no.map((x) => likelyNeedsReceipt(x, none)), no.map(() => false), "small, transfers, bills, rent, apps, food, transport, unknown shops, matched ones");
  assert.equal(likelyNeedsReceipt(p("H&M", 3499), { ...none, payments: new Set(["x"]) }), false, "not mine");
  assert.equal(likelyNeedsReceipt(p("H&M", 3499), { ...none, shops: new Set(["h&m"]) }), false, "nothing from that shop is mine");
  assert.equal(likelyNeedsReceipt(p("H&M", 3499), { ...none, noReceipt: new Set(["x"]) }), false, "wasn't a shop purchase");
  console.log("ok - the rule: shops that sell things, £5 or more, no receipt, yours; never transfers, bills, food, transport or apps");
}

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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "jess.private@example.com,sam@example.com",
  SECOND_STEP: "off", TRUELAYER_CLIENT_ID: "relay-test-id", TRUELAYER_CLIENT_SECRET: "tl-secret-test" };
let emails = [], ai = [], aiAnswer = null, aiStatus = 200;
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url === "https://api.anthropic.com/v1/messages") { ai.push({ headers: init.headers, body: JSON.parse(init.body) }); return aiStatus !== 200 ? new Response("{}", { status: aiStatus }) : Response.json({ content: [{ type: "text", text: JSON.stringify(aiAnswer) }] }); }
  return new Response("{}", { status: 404 });
};
let now = Date.UTC(2026, 10, 17, 9);
const call = (path, { method = "GET", body, raw, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const jess = await signIn("jess.private@example.com", "5.5.5.1"), sam = await signIn("sam@example.com", "5.5.5.2");
const J = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("jess.private@example.com").id;
for (const t of [jess, sam]) assert.equal((await call("/relay/my/consent", { method: "POST", token: t, body: { version: CONSENT_VERSION } })).status, 200);
await call("/relay/my/bank", { token: jess });   // makes the bank tables
const CONN = "00000000-0000-4000-8000-0000000000aa";
const pay = (id, day, pence, description) => sqlite.prepare(`INSERT INTO bank_payments (shopper_id, payment_id, connection_id, account, paid_on, amount_minor, currency, description, merchant, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?)`).run(J, CONN + ":" + id, CONN, "Current account", day, pence, "GBP", description, null, now);
pay("hm", "2026-11-12", 3499, "H&M"); pay("zara", "2026-11-10", 4999, "ZARA UK LTD"); pay("move", "2026-11-11", 5000, "TRANSFER TO J SMITH");
pay("edf", "2026-11-09", 8000, "EDF ENERGY"); pay("cos", "2026-11-08", 6500, "COS REGENT ST"); pay("cafe", "2026-11-08", 320, "COFFEE CORNER");
pay("argos", "2026-11-07", 2500, "ARGOS LTD"); pay("john", "2026-11-06", 8900, "JOHN LEWIS PLC");
const HM = CONN + ":hm", ZARA = CONN + ":zara", COS = CONN + ":cos", ARGOS = CONN + ":argos", JOHN = CONN + ":john";
const pays = async () => (await (await call("/relay/my/bank/payments", { token: jess })).json()).payments;
const flagged = async () => (await pays()).filter((p) => p.needsReceipt).map((p) => p.shop);

// 2. The flag on what the Bank page loads; Home's list comes with the receipts it already asks for.
await call("/relay/my/bank/not-mine", { method: "POST", token: jess, body: { id: COS, on: true } });
assert.deepEqual(await flagged(), ["H&M", "Zara", "Argos", "John Lewis"], "shops: yes; transfer, bill, small café and the one marked not mine: no");
let rec = await (await call("/relay/my/receipts", { token: jess })).json();
assert.deepEqual(rec.needReceipt.map((p) => [p.shop, p.amountPence, p.date, p.account]), [["H&M", 3499, "2026-11-12", "Current account"], ["Zara", 4999, "2026-11-10", "Current account"],
  ["Argos", 2500, "2026-11-07", "Current account"], ["John Lewis", 8900, "2026-11-06", "Current account"]]);
assert.ok(!JSON.stringify(rec.needReceipt).includes("description"), "only what Home shows");
assert.ok(rec.needReceipt.every((p) => p.photoRead === false), "and that a photo won't be read without the AI reader");
assert.equal((await (await call("/relay/my/bank/payments", { token: jess })).json()).photoRead, false);
assert.equal((await (await call("/relay/my/receipts", { token: sam })).json()).needReceipt, undefined, "nothing for someone with no bank");
console.log("ok - flagged on the payments the Bank page loads, and listed for Home with the receipts it already loads");

// 3. "This wasn't a shop purchase": the flag goes (and comes back when undone).
assert.equal((await call("/relay/my/bank/not-mine", { method: "POST", token: jess, body: { id: JOHN, on: true, reason: "other" } })).status, 400);
assert.equal((await call("/relay/my/bank/not-mine", { method: "POST", token: sam, body: { id: JOHN, on: true, reason: "no_receipt" } })).status, 404, "not someone else's");
assert.equal((await call("/relay/my/bank/not-mine", { method: "POST", token: jess, body: { id: JOHN, on: true, reason: "no_receipt" } })).status, 200);
let john = (await pays()).find((p) => p.id === JOHN);
assert.deepEqual([john.needsReceipt, john.noReceipt, john.notMine], [undefined, true, null], "not asked for any more, and still yours");
await call("/relay/my/bank/not-mine", { method: "POST", token: jess, body: { id: JOHN, on: false, reason: "no_receipt" } });
assert.equal((await pays()).find((p) => p.id === JOHN).needsReceipt, true);
await call("/relay/my/bank/not-mine", { method: "POST", token: jess, body: { id: JOHN, on: true, reason: "no_receipt" } });
console.log("ok - This wasn't a shop purchase: not asked about again, until undone");

// 4. Only your own payment; bad or oversized photos are refused.
const jpeg = (n = 600, seed = 1) => { const b = Buffer.alloc(n, seed); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; return b; };
const IMG = "data:image/jpeg;base64," + jpeg().toString("base64");
const up = (token, body) => call("/relay/my/bank/receipt-photo", { method: "POST", token, body });
assert.equal((await up(sam, { id: HM, image: IMG })).status, 404, "someone else's payment looks like one that doesn't exist");
assert.equal((await up(jess, { id: CONN + ":nope", image: IMG })).status, 404);
assert.equal((await up(jess, { id: HM, image: IMG, total: 100 })).status, 400, "unexpected field");
assert.equal((await up(jess, { id: HM })).status, 400, "no photo");
assert.deepEqual(await (await up(jess, { id: HM, image: "hello" })).json(), { error: "bad_photo" });
assert.deepEqual(await (await up(jess, { id: HM, image: "data:image/png;base64," + Buffer.alloc(300, 65).toString("base64") })).json(), { error: "bad_photo" }, "says PNG, isn't a picture");
let r = await up(jess, { id: HM, image: "data:image/jpeg;base64," + jpeg(1150 * 1024).toString("base64") });
assert.deepEqual([r.status, await r.json()], [413, { error: "photo_too_big" }], "over 1.1 MB once decoded");
// (25 Nov 2026) A photo between the old cap on the photo field (1,600,000 characters) and the body's limit (1650 KB) was
// refused as a plain "invalid_request", which the app can only answer with "Couldn't add the photo just now". It's too big,
// and says so.
{ const mid = "data:image/jpeg;base64," + jpeg(1210 * 1024).toString("base64");
  assert.ok(mid.length > 1600000 && JSON.stringify({ id: HM, image: mid }).length < 1650 * 1024, "between the two limits");
  r = await up(jess, { id: HM, image: mid });
  assert.deepEqual([r.status, await r.json()], [413, { error: "photo_too_big" }], "between the photo's old cap and the body's limit: still too big, said plainly"); }
r = await call("/relay/my/bank/receipt-photo", { method: "POST", token: jess, raw: JSON.stringify({ id: HM, image: "data:image/jpeg;base64," + "A".repeat(1700 * 1024) }) });
assert.deepEqual([r.status, await r.json()], [413, { error: "photo_too_big" }], "a body over the limit isn't read");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM captured_receipts").get().n, 0, "nothing made from any of those");
console.log("ok - only your own payment (someone else's is 404); bad photos 400, too big 413");

// 5. Without the AI reader: the receipt is made from what the bank says, with no items, and the photo is kept.
assert.equal(env.ANTHROPIC_API_KEY, undefined);
r = await up(jess, { id: HM, image: IMG });
assert.equal(r.status, 200);
let out = (await r.json()).receipt;
assert.deepEqual([out.shop, out.date, out.dateFrom, out.totalPence, out.totalFrom, out.items, out.readBy, out.photoNotRead, out.totalMismatch],
  ["H&M", "2026-11-12", "bank", 3499, "bank", [], null, "off", false], "the bank's facts, no items invented");
assert.equal(ai.length, 0, "nothing sent to Anthropic");
const hmId = out.id;
let row = JSON.parse(sqlite.prepare("SELECT details FROM captured_receipts WHERE id = ?").get(hmId).details);
assert.deepEqual([row.source, row.photoReceipt, row.bankPaymentId, row.orderRef, row.retailer.domain], ["receipt_photo", true, HM, undefined, null], "marked as from a photo, no order number, no shop website");
let hm = (await pays()).find((p) => p.id === HM);
assert.deepEqual([hm.receiptId, hm.match, hm.needsReceipt], [hmId, "photo", undefined], "linked to the payment, no longer flagged");
rec = await (await call("/relay/my/receipts", { token: jess })).json();
const card = rec.receipts.find((c) => c.id === hmId);
assert.deepEqual([card.photoReceipt, card.retailer.name, card.totalPence, card.items.length, card.bankPaid.amountPence], [true, "H&M", 3499, 0, 3499]);
assert.ok(!rec.needReceipt.some((p) => p.id === HM), "and not on Home's list");
r = await call("/relay/my/receipts/" + hmId + "/receipt-photo", { token: jess });
assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/jpeg");
assert.ok(Buffer.from(await r.arrayBuffer()).equals(jpeg()), "the photo, as it was sent");
assert.equal((await call("/relay/my/receipts/" + hmId + "/receipt-photo", { token: sam })).status, 404, "only its owner can see it");
r = await up(jess, { id: HM, image: IMG });
assert.deepEqual([r.status, (await r.json()).error], [409, "has_receipt"], "once per payment");
console.log("ok - without the AI reader: made from the bank's shop, amount and date, no items invented; photo kept, owner only");

// 6. With the AI reader: exactly what was read; a total that isn't what the bank paid is kept and flagged, not changed.
env.ANTHROPIC_API_KEY = "test-anthropic-key";
assert.equal((await (await call("/relay/my/bank/payments", { token: jess })).json()).photoRead, true, "the app can say the photo will be read");
aiAnswer = { isPurchase: true, shop: "Zara", orderRef: "T-4471", orderDate: "2026-11-10", currency: "GBP", totalPence: 4599, confidence: "high",
  items: [{ name: "Linen shirt", qty: 1, pricePence: 2999 }, { name: "Leather belt", qty: 1, pricePence: 1600 }] };
r = await up(jess, { id: ZARA, image: IMG });
out = (await r.json()).receipt;
assert.deepEqual([out.shop, out.date, out.dateFrom, out.totalPence, out.totalFrom, out.readBy, out.confidence, out.totalMismatch, out.bankPaid.amountPence, out.receiptNumber],
  ["Zara", "2026-11-10", "photo", 4599, "photo", "ai", "high", true, 4999, "T-4471"]);
assert.deepEqual(out.items, [{ name: "Linen shirt", qty: 1, pricePence: 2999 }, { name: "Leather belt", qty: 1, pricePence: 1600 }], "items exactly as read");
assert.equal(sqlite.prepare("SELECT amount_minor FROM bank_payments WHERE payment_id = ?").get(ZARA).amount_minor, 4999, "the bank's amount untouched");
assert.equal(ai.length, 1);
const sent = ai[0].body, said = JSON.stringify(sent);
assert.equal(ai[0].headers["x-api-key"], "test-anthropic-key");
assert.deepEqual(sent.messages[0].content.map((c) => c.type), ["image", "text"]);
assert.equal(sent.messages[0].content[0].source.media_type, "image/jpeg");
assert.ok(!/4999|49\.99|jess|example\.com|ZARA UK|Current account/i.test(said.replace(sent.messages[0].content[0].source.data, "")), "only the photo: not the bank's amount, shop text or anything about the shopper");
assert.match(sent.system, /Never guess, work out or invent anything/);
const zaraCard = (await (await call("/relay/my/receipts", { token: jess })).json()).receipts.find((c) => c.id === out.id);
assert.deepEqual([zaraCard.totalPence, zaraCard.totalMismatch, zaraCard.bankPaid.amountPence, zaraCard.needsShopperConfirmation, zaraCard.orderRef], [4599, true, 4999, true, undefined],
  "both totals shown; read by AI so the shopper is asked to check it; no order number (so no online-order return date is guessed)");
assert.equal(zaraCard.itemsCheck && zaraCard.itemsCheck.complete, true, "items that add up to the photo's own total pass the same totals check as an email's");
console.log("ok - with the AI reader: exactly what it read; a different total kept and flagged beside what the bank paid");

// 6a. (Round 7) Items only from a reading the AI was sure of, and through the totals check: a "low" reading keeps no items
// (none invented) and says so; items that don't add up to the photo's total are flagged; no reading, no items and no check.
{
  const { photoItemsOf } = await import("../worker/bank.js");
  const two = [{ name: "Linen shirt", qty: 1, pricePence: 2999 }, { name: "Leather belt", qty: 1, pricePence: 1600 }];
  let k = photoItemsOf({ items: two }, "low", 4599);
  assert.deepEqual([k.items, k.itemsCheck.complete, k.itemsCheck.unsure], [[], false, true], "unsure: no items kept, and the receipt says it couldn't read them");
  k = photoItemsOf({ items: two }, null, 4599);
  assert.deepEqual([k.items, k.itemsCheck.complete], [[], false], "no confidence given counts as unsure");
  k = photoItemsOf({ items: two }, "medium", 5999);
  assert.deepEqual([k.items.length, k.itemsCheck.complete, k.itemsCheck.missingPence], [2, false, 1400], "items £14.00 short of the photo's total: flagged");
  k = photoItemsOf({ items: two }, "high", 4599);
  assert.deepEqual([k.items.length, k.itemsCheck.complete], [2, true]);
  assert.deepEqual(photoItemsOf(null, "high", 4599), { items: [], itemsCheck: null }, "nothing read: nothing kept, nothing checked");
}
console.log("ok - photo items only from a sure reading, and through the totals check");

// 6b. A photo the AI can't read as a receipt, or the AI busy: the bank's facts, no items, and it says why.
aiAnswer = { isPurchase: false, shop: null, orderDate: null, totalPence: null, items: [] };
out = (await (await up(jess, { id: ARGOS, image: IMG })).json()).receipt;
assert.deepEqual([out.shop, out.totalPence, out.items, out.readBy, out.photoNotRead], ["Argos", 2500, [], null, "unclear"]);
console.log("ok - a photo that isn't readable as a receipt: the bank's facts, said plainly");

// 7. Matching again (after Not mine on another payment) keeps each photo's receipt with its payment.
await call("/relay/my/bank/not-mine", { method: "POST", token: jess, body: { id: CONN + ":edf", on: true } });
const links = Object.fromEntries((await pays()).filter((p) => p.match === "photo").map((p) => [p.shop, p.receiptId]));
assert.deepEqual(Object.keys(links).sort(), ["Argos", "H&M", "Zara"]);
assert.equal(links["H&M"], hmId);
console.log("ok - matching again keeps each photo's receipt with its payment, even when the totals differ");

// 8. Removing the receipt ("Not mine" on the receipt) deletes its photo; the payment is asked about again.
await call("/relay/my/receipts/" + hmId + "/dismiss", { method: "POST", token: jess });
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_photos WHERE receipt_id = ?").get(hmId).n, 0);
await call("/relay/my/bank/not-mine", { method: "POST", token: jess, body: { id: CONN + ":edf", on: false } });
assert.ok((await flagged()).includes("H&M"), "asked about again");
console.log("ok - a removed receipt takes its photo with it");

// 9. 20 photos a day.
for (let i = sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_photos WHERE shopper_id = ?").get(J).n; i < RECEIPT_PHOTOS_PER_DAY; i++)
  sqlite.prepare("INSERT INTO receipt_photos (receipt_id, shopper_id, type, data, ai, created_at) VALUES (?,?,?,?,0,?)").run("fill-" + i, J, "image/jpeg", "AA==", now);
r = await up(jess, { id: HM, image: IMG });
assert.deepEqual([r.status, (await r.json()).error], [429, "too_many_requests"]);
now += 25 * 3600e3;
assert.equal((await up(jess, { id: HM, image: IMG })).status, 200, "a day later");
resetMemoryLimits();
console.log("ok - 20 photos a day each");

// 9b. Download my data has the shopper's own receipt photos (review X-1), and only theirs.
{
  const kept = sqlite.prepare("SELECT receipt_id, type, data FROM receipt_photos WHERE shopper_id = ? ORDER BY created_at DESC").all(J);
  const file = await (await call("/relay/my/export", { token: jess })).json();
  assert.ok(kept.length > 0);
  assert.equal(file.receiptPhotos.length + (file.receiptPhotosNotInThisFile || 0), kept.length, "every photo is in the file, or counted as left out");
  assert.equal(file.receiptPhotos[0].receiptId, kept[0].receipt_id);
  assert.equal(file.receiptPhotos[0].picture, "data:" + kept[0].type + ";base64," + kept[0].data, "the photo itself");
  assert.deepEqual((await (await call("/relay/my/export", { token: sam })).json()).receiptPhotos, [], "nobody else's");
  console.log("ok - Download my data has the shopper's own receipt photos");
}

// 10. Deleting the account deletes the photos.
assert.equal((await call("/relay/my/delete", { method: "POST", token: jess })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_photos WHERE shopper_id = ?").get(J).n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM captured_receipts WHERE shopper_id = ?").get(J).n, 0);
console.log("ok - deleting the account deletes the photos");
console.log("PASS receipt photos: likely-needs-a-receipt rule and flag, own payments only, checked uploads, no invented items, mismatches shown, photo kept and deleted");
