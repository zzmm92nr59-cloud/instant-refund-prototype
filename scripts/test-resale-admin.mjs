// Offline tests for the resale report review tool against a real SQLite engine (fake email delivery).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";

// Ids are made to sort AGAINST insertion order, so any query that relies on id order for items created in the same instant fails here.
{ let n = 0xffffffffffff; Object.defineProperty(globalThis.crypto, "randomUUID", { value: () => "aaaaaaaa-aaaa-4aaa-8aaa-" + (n--).toString(16).padStart(12, "0") }); }
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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: " Admin@Example.com , other-admin@example.com" };
let emails = [];
const fetchImpl = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  return new Response("{}", { status: 404 });
};
let clock = 1_800_000_000_000;
const call = (path, { method = "GET", body, token } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method,
    headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
let ip = 10;
async function signIn(email) {
  emails = [];
  await handleAuthRoute(new Request("https://w.test/relay/auth/request", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "9.9.9." + ip++ }, body: JSON.stringify({ email }) }), env, new URL("https://w.test/relay/auth/request"), {}, { now: clock, fetchImpl });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const alice = await signIn("alice@example.com"), bob = await signIn("bob@example.com"), carol = await signIn("carol@example.com"), dave = await signIn("dave@example.com"), admin = await signIn("admin@example.com");
const post = (p, token, body) => call(p, { method: "POST", token, body });
const get = (p, token) => call(p, { token });
const idOf = email => sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id;


const seed = (who, id, name) => sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)").run(id, idOf(who), id, "pending",
  JSON.stringify({ kind: "receipt", retailer: { name: "Store" }, orderRef: "R-" + id.slice(0, 4), currency: "GBP", items: [{ name, qty: 1, pricePence: 5000 }], parserVersion: 5 }), clock);
const R = n => String(n).repeat(8) + "-" + String(n).repeat(4) + "-" + String(n).repeat(4) + "-" + String(n).repeat(4) + "-" + String(n).repeat(12);
seed("alice@example.com", R(1), "Wool jumper"); seed("alice@example.com", R(2), "Rain jacket"); seed("bob@example.com", R(3), "Trail shell"); seed("admin@example.com", R(4), "Admin scarf");
const list = async (token, receiptId) => { const r = await post("/relay/my/resale/listings", token, { receiptId, itemIndex: 0, condition: "good", agree: true }); assert.equal(r.status, 200); return (await r.json()).id; };
const ask = async (token, listingId) => { assert.equal((await post(`/relay/my/resale/listings/${listingId}/ask`, token, { kind: "buy" })).status, 200); return sqlite.prepare("SELECT id FROM resale_requests WHERE listing_id = ? AND asker_id = ?").get(listingId, idOf(emailOf(token))).id; };
const emails_ = new Map([[alice, "alice@example.com"], [bob, "bob@example.com"], [carol, "carol@example.com"], [dave, "dave@example.com"], [admin, "admin@example.com"]]);
const emailOf = t => emails_.get(t);
async function conversation(sellerToken, buyerToken, receiptId, reporterToken, reason) {
  const L = await list(sellerToken, receiptId); const q = await ask(buyerToken, L);
  assert.equal((await post(`/relay/my/resale/requests/${q}/accept`, sellerToken)).status, 200);
  assert.equal((await post(`/relay/my/resale/requests/${q}/messages`, buyerToken, { body: "Can we do it off the app?" })).status, 200);
  assert.equal((await post(`/relay/my/resale/requests/${q}/messages`, sellerToken, { body: "No, keep it here." })).status, 200);
  assert.equal((await post(`/relay/my/resale/requests/${q}/report`, reporterToken, { reason })).status, 200);
  return { L, q };
}
const admin_ = p => get("/relay/my/admin" + p, admin);
const review = (id, outcome, token = admin) => post(`/relay/my/admin/reports/${id}/review`, token, { outcome });

// Who is an admin.
assert.equal((await get("/relay/my/admin/me")).status, 401, "sign-in needed");
assert.deepEqual(await (await get("/relay/my/admin/me", alice)).json(), { admin: false });
assert.deepEqual(await (await get("/relay/my/admin/me", admin)).json(), { admin: true, openReports: 0 }, "listed email is an admin, any letter case, spaces ignored");
assert.equal((await get("/relay/my/admin/reports", alice)).status, 404, "ordinary members get a plain not-found");
assert.equal((await review("11111111-1111-1111-1111-111111111111", "dismiss", alice)).status, 404);
const saved = env.RELAY_ADMIN_EMAILS; delete env.RELAY_ADMIN_EMAILS;
assert.deepEqual(await (await get("/relay/my/admin/me", admin)).json(), { admin: false }, "with nothing configured nobody is an admin");
assert.equal((await get("/relay/my/admin/reports", admin)).status, 404);
env.RELAY_ADMIN_EMAILS = saved;

// Report 1: bob (buyer) reports alice (seller). The admin removes her listing.
const c1 = await conversation(alice, bob, R(1), bob, "Asked me to pay outside Relay");
assert.equal((await (await get("/relay/my/admin/me", admin)).json()).openReports, 1);
let rs = (await (await admin_("/reports")).json()).reports;
assert.equal(rs.length, 1);
const r1 = rs[0];
assert.equal(r1.reason, "Asked me to pay outside Relay"); assert.equal(r1.reporterRole, "buyer"); assert.equal(r1.reportedRole, "seller");
assert.equal(r1.canRemoveListing, true); assert.equal(r1.item.title, "Wool jumper"); assert.equal(r1.reportsAgainstReported, 1); assert.equal(r1.reportedAlreadyBlocked, false);
assert.deepEqual(r1.messages.map(m => [m.from, m.body]), [["reporter", "Can we do it off the app?"], ["reported member", "No, keep it here."]]);
const everything = JSON.stringify(rs);
for (const who of ["alice", "bob", "carol", "dave", "admin"]) assert.ok(!everything.includes(who + "@") && !everything.includes(idOf(who + "@example.com")), "admin never sees who " + who + " is");
assert.equal((await review(r1.id, "ban")).status, 400, "unknown action refused");
assert.equal((await review("99999999-9999-9999-9999-999999999999", "dismiss")).status, 404);
assert.equal((await review(r1.id, "remove_listing", bob)).status, 404, "members cannot review");
assert.equal((await review(r1.id, "remove_listing")).status, 200);
assert.equal(sqlite.prepare("SELECT status FROM resale_listings WHERE id = ?").get(c1.L).status, "withdrawn", "listing taken down");
assert.equal((await review(r1.id, "dismiss")).status, 409, "a report is reviewed once");
assert.equal((await (await admin_("/reports")).json()).reports.length, 0);
assert.equal((await post("/relay/my/resale/listings", alice, { receiptId: R(2), itemIndex: 0, condition: "good", agree: true })).status, 200, "removing one listing does not block the seller");
assert.equal((await post(`/relay/my/resale/listings/${sqlite.prepare("SELECT id FROM resale_listings WHERE receipt_id = ?").get(R(2)).id}/withdraw`, alice)).status, 200);

// Report 2: alice (seller) reports carol (buyer). Nothing to remove; the admin blocks carol.
const c2 = await conversation(alice, carol, R(2), alice, "Harassing messages");
const r2 = (await (await admin_("/reports")).json()).reports[0];
assert.equal(r2.reporterRole, "seller"); assert.equal(r2.canRemoveListing, false);
assert.equal((await review(r2.id, "remove_listing")).status, 400, "a buyer has no listing to remove");
assert.equal((await review(r2.id, "block")).status, 200);
assert.equal(sqlite.prepare("SELECT status FROM resale_listings WHERE id = ?").get(c2.L).status, "active", "the seller's item goes back on sale");
assert.equal(sqlite.prepare("SELECT status FROM resale_requests WHERE id = ?").get(c2.q).status, "closed");
const L3 = await list(bob, R(3));
assert.equal((await post(`/relay/my/resale/listings/${L3}/ask`, carol, { kind: "buy" })).status, 403, "blocked member cannot ask");
assert.equal((await post("/relay/my/resale/listings", carol, { receiptId: R(3), itemIndex: 0, condition: "good", agree: true })).status, 403, "blocked member cannot list");
assert.equal((await post(`/relay/my/resale/requests/${c2.q}/messages`, carol, { body: "hello" })).status, 403, "blocked member cannot message");
assert.equal((await get("/relay/my/resale/feed", carol)).status, 200, "blocked member can still look");
assert.equal((await post(`/relay/my/resale/listings/${L3}/ask`, dave, { kind: "buy" })).status, 200, "everyone else is unaffected");
// Deleting the account and signing up again with the same email does not undo a block.
assert.equal((await post("/relay/my/delete", carol)).status, 200);
const carol2 = await signIn("carol@example.com");
assert.equal((await post(`/relay/my/resale/listings/${L3}/ask`, carol2, { kind: "buy" })).status, 403, "block survives delete and re-signup");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM resale_blocks").get().n, 1);

// Report 3: dave (buyer) reports bob (seller). Blocking a seller takes all his listings and open requests down.
sqlite.prepare("UPDATE resale_listings SET status = 'active' WHERE id = ?").run(L3);
const dReq = sqlite.prepare("SELECT id FROM resale_requests WHERE listing_id = ? AND asker_id = ?").get(L3, idOf("dave@example.com")).id;
assert.equal((await post(`/relay/my/resale/requests/${dReq}/accept`, bob)).status, 200);
assert.equal((await post(`/relay/my/resale/requests/${dReq}/report`, dave, { reason: "Never replied" })).status, 200);
const r3 = (await (await admin_("/reports")).json()).reports[0];
assert.equal((await review(r3.id, "block")).status, 200);
assert.equal(sqlite.prepare("SELECT status FROM resale_listings WHERE id = ?").get(L3).status, "withdrawn", "blocked seller's listing comes down");
assert.equal((await post("/relay/my/resale/listings", bob, { receiptId: R(3), itemIndex: 0, condition: "good", agree: true })).status, 403);

// An admin never judges a report they are part of; dismissing is recorded.
const c4 = await conversation(admin, alice, R(4), alice, "Rude");
const r4 = (await (await admin_("/reports")).json()).reports[0];
assert.equal((await review(r4.id, "dismiss")).status, 403, "conflict of interest");
const second = await signIn("other-admin@example.com");
assert.equal((await review(r4.id, "dismiss", second)).status, 200, "another admin can");
assert.equal(sqlite.prepare("SELECT outcome FROM resale_report_reviews WHERE report_id = ?").get(r4.id).outcome, "dismiss");
assert.equal(sqlite.prepare("SELECT status FROM resale_listings WHERE id = ?").get(c4.L).status, "active", "dismiss changes nothing (the report itself had already put the item back on sale)");
console.log("PASS resale report review: admin-only, pseudonymous, dismiss / remove listing / block, blocks survive re-signup, no self-review");
