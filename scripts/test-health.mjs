// Offline test (real SQLite): the Relay health page's numbers (worker/health.js). Only Relay admins can see it; it gives
// counts, never anything from a single receipt or about a single shopper; a shop is named only once 3 or more different
// shoppers have receipts from it, and a personal email address (a forwarded receipt) never is; the admin's own receipts
// are broken down by shop with no minimum. Shops, shoppers and items are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { MIN_SHOPPERS_PER_SHOP } from "../worker/health.js";

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    async run() { sqlite.prepare(sql).run(...args); return {}; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    _exec() { sqlite.prepare(sql).run(...args); }
  };
}
const db = { prepare: sql => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { list.forEach(s => s._exec()); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "boss@example.com" };
let emails = [];
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  return new Response("{}", { status: 404 });
};
const now = Date.now();
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const boss = await signIn("boss@example.com", "2.2.2.2");
const ann = await signIn("ann@example.com", "3.3.3.3");
await signIn("ben@example.com", "4.4.4.4");
await signIn("cat@example.com", "5.5.5.5");
const id = email => sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id;
const [B, A, N, C] = ["boss", "ann", "ben", "cat"].map(x => id(x + "@example.com"));

// Who can see it.
assert.equal((await call("/relay/my/admin/health")).status, 401, "signed in only");
assert.equal((await call("/relay/my/admin/health", { token: ann })).status, 404, "a shopper who isn't an admin gets 'not found'");
assert.equal((await call("/relay/my/admin/health", { method: "POST", body: {}, token: boss })).status, 404, "read-only");
const empty = await (await call("/relay/my/admin/health", { token: boss })).json();
assert.equal(empty.people.shoppers, 4);
assert.equal(empty.reading.purchases.receipts, 0, "works before anything has been read (tables made on first use)");
assert.equal(empty.reading.days.length, 14);
console.log("ok - only Relay admins can see the health page, and it works on an empty database");

// Made-up activity.
await call("/relay/my/receipts", { token: boss }); // makes the receipt tables
let k = 0;
const receipt = (shopper, domain, o = {}) => {
  const rid = "00000000-0000-4000-8000-" + String(++k).padStart(12, "0");
  const details = { kind: o.kind || "receipt", retailer: { name: domain.split(".")[0], domain }, orderRef: "ORD-" + k, orderDate: "2026-10-0" + (k % 9 + 1),
    totalPence: o.noTotal ? null : 1000 + k, currency: "GBP", items: o.noItems ? [] : [{ name: "Secret Item " + k, qty: 1, pricePence: 1000 + k }],
    confidence: o.confidence || "high", parserVersion: o.v || 26, ...(o.pasted ? { pasted: true } : {}), ...(o.unread ? { unread: true } : {}) };
  sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)")
    .run(rid, shopper, "m-" + k, o.status || "pending", JSON.stringify(details), o.at || now - 3600e3);
  return rid;
};
// brindle.example: 3 people (named). One removed as not theirs, one with no total, one read with low confidence.
receipt(B, "brindle.example", { status: "confirmed" }); receipt(A, "brindle.example", { status: "dismissed" }); receipt(N, "brindle.example", { noTotal: true, confidence: "low" });
receipt(A, "brindle.example", { confidence: "medium" });
// larkspur.example: only 2 people, so never named.
receipt(A, "larkspur.example", { noItems: true }); receipt(N, "larkspur.example", { pasted: true, at: now - 3 * 864e5 });
// Receipts forwarded from personal addresses, by 3 people: never named either.
receipt(A, "gmail.com"); receipt(N, "gmail.com"); receipt(C, "gmail.com");
// The admin's own: a shop only they use, an older reader, and a receipt added by hand.
receipt(B, "fennel.example", { v: 25, pasted: true }); receipt(B, "fennel.example", { noTotal: true, confidence: "low" });
// Not purchases: a return update, and emails that weren't receipts (kept only as "not a receipt").
receipt(A, "brindle.example", { kind: "return_update" });
receipt(C, "news.example", { kind: "not_receipt", status: "not_receipt" }); receipt(C, "news.example", { kind: "not_receipt", status: "not_receipt", unread: true });
receipt(C, "old.example", { at: now - 40 * 864e5 });
const ins = (sql, ...a) => sqlite.prepare(sql).run(...a);
ins("INSERT INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at, last_scan_at, provider) VALUES (?,?,?,?,?,?,?)", B, "boss@example.com", "iv", "data", now - 2 * 864e5, now - 600e3, null);
ins("INSERT INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at, last_scan_at, provider) VALUES (?,?,?,?,?,?,?)", B + "~2", "boss2@example.com", "iv", "data", now - 20 * 864e5, now - 2 * 864e5, "microsoft");
ins("INSERT INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at, last_scan_at, provider) VALUES (?,?,?,?,?,?,?)", A, "ann@example.com", "iv", "data", now - 30 * 864e5, now - 3600e3, null);
ins("INSERT INTO mail_scan_jobs (shopper_id, job_id, state, started_at, updated_at, error) VALUES (?,?,?,?,?,?)", B, "j1", "done", now - 864e5, now - 864e5, null);
ins("INSERT INTO mail_scan_jobs (shopper_id, job_id, state, started_at, updated_at, error) VALUES (?,?,?,?,?,?)", A, "j2", "failed", now - 864e5, now - 864e5, "gmail_reconnect_needed");
ins("INSERT INTO receipt_learning (shopper_id, store_key, category, promo, updated_at) VALUES (?,?,?,?,?)", A, "brindle", "home", 0, now);
ins("INSERT INTO receipt_learning (shopper_id, store_key, category, promo, updated_at) VALUES (?,?,?,?,?)", N, "news", null, 1, now);
ins("INSERT INTO receipt_gifts (shopper_id, receipt_id, is_gift, recipient, updated_at) VALUES (?,?,?,?,?)", A, "x", 1, "Mum", now);
ins("INSERT INTO receipt_gifts (shopper_id, receipt_id, is_gift, recipient, updated_at) VALUES (?,?,?,?,?)", A, "y", 0, null, now);

const res = await call("/relay/my/admin/health", { token: boss });
assert.equal(res.status, 200);
assert.equal(res.headers.get("cache-control"), "no-store");
const h = await res.json(), text = JSON.stringify(h);
// Counts.
assert.equal(h.reading.purchases.receipts, 12, "purchases only (not the return update or the emails that weren't receipts)");
assert.deepEqual([h.reading.purchases.high, h.reading.purchases.medium, h.reading.purchases.low], [9, 1, 2]);
assert.equal(h.reading.purchases.dismissed, 1); assert.equal(h.reading.purchases.confirmed, 1);
assert.equal(h.reading.purchases.noTotal, 2); assert.equal(h.reading.purchases.noItems, 1); assert.equal(h.reading.purchases.pasted, 2);
assert.equal(h.reading.emailsLookedAt, 15); assert.equal(h.reading.notReceipts, 2); assert.equal(h.reading.waitingToBeRead, 1);
assert.equal(h.reading.kinds.return_update, 1);
assert.deepEqual(h.reading.byReader.map(v => [v.version, v.emails]), [[26, 14], [25, 1]]);
assert.equal(h.reading.readerVersion, 26);
assert.deepEqual(h.reading.shoppersTaught, { groupsChanged: 1, shopsMarkedPromotions: 1, people: 2 });
const today = h.reading.days[13];
assert.equal(today.day, new Date(now).toISOString().slice(0, 10));
assert.deepEqual([h.reading.days.reduce((s, d) => s + d.kept, 0), h.reading.days.reduce((s, d) => s + d.skipped, 0)], [12, 2], "the last 14 days: 12 kept (not the 40-day-old one), 2 skipped");
assert.deepEqual([h.inboxes.gmail, h.inboxes.outlook, h.inboxes.shoppers, h.inboxes.checkedToday, h.inboxes.notCheckedToday], [2, 1, 2, 2, 1]);
assert.deepEqual(h.inboxes.scansThisWeek, { done: 1, failed: 1 });
assert.deepEqual(h.inboxes.scanErrorsThisWeek, [{ error: "gmail_reconnect_needed", count: 1 }]);
assert.equal(h.inboxes.needReconnect, 0);
// Checked counts reads that worked, the automatic check's included (mail_ok_at); an inbox whose access ended is counted.
sqlite.prepare("UPDATE gmail_connections SET mail_ok_at = ? WHERE shopper_id = ?").run(now - 300e3, B + "~2");
sqlite.prepare("UPDATE gmail_connections SET mail_problem = 'reconnect', mail_problem_at = ? WHERE shopper_id = ?").run(now - 300e3, A);
const h2 = await (await call("/relay/my/admin/health", { token: boss })).json();
assert.deepEqual([h2.inboxes.checkedToday, h2.inboxes.notCheckedToday, h2.inboxes.needReconnect], [3, 0, 1]);
assert.ok(!JSON.stringify(h2).includes("ann@example.com"), "counts only");
assert.deepEqual([h.extras.gifts, h.extras.giftGivers], [1, 1], "gifts tagged (not the one untagged)");
assert.equal(h.people.shoppers, 4); assert.equal(h.people.signedIn, 4);
console.log("ok - counts: purchases and how confidently they were read, shoppers' corrections, the last 14 days, inboxes, scans, gifts");
// Shops: named only with 3 or more people, never a personal address.
assert.equal(MIN_SHOPPERS_PER_SHOP, 3);
assert.deepEqual(h.shops.map(s => s.domain), ["brindle.example"], "only the shop 3 people bought from");
const br = h.shops[0];
assert.deepEqual([br.people, br.receipts, br.dismissed, br.noTotal, br.low], [3, 4, 1, 1, 1]);
assert.ok(!text.includes("larkspur") && !text.includes("gmail.com"), "a shop 2 people bought from, and personal addresses, aren't named");
// The admin's own receipts, by shop, with no minimum.
assert.deepEqual(h.mine.shops.map(s => s.domain).sort(), ["brindle.example", "fennel.example"]);
assert.equal(h.mine.shops[0].domain, "fennel.example", "problems first");
assert.equal(h.mine.receipts, 3);
// Nothing from a single receipt, nothing that names a shopper.
for (const secret of ["Secret Item", "ORD-", "ann@", "ben@", "cat@", "boss2@", "Mum", A, N, C, "00000000-0000-4000"]) assert.ok(!text.includes(secret), "not in the health page: " + secret);
console.log("ok - a shop is named only once 3 people bought there, never a personal address; the admin's own receipts by shop; nothing from one receipt or about one person");
console.log("PASS Relay health: admins only, counts only, shops named from 3 people, the admin's own receipts by shop");
