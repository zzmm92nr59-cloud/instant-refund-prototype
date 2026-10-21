// Offline tests for Relay Resale v1 against a real SQLite engine. No money moves in v1.
// These prove Relay's own rules (ownership, privacy, limits), not real-world demand.
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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key" };
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
const alice = await signIn("alice@example.com"), bob = await signIn("bob@example.com"), carol = await signIn("carol@example.com");
const post = (p, token, body) => call(p, { method: "POST", token, body });
const get = (p, token) => call(p, { token });
const idOf = email => sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id;

// Seed receipts directly (as a Gmail scan would have captured them).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]).toString("base64");
const seed = (who, id, details, image) => {
  sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)").run(id, idOf(who), id, "pending", JSON.stringify(details), clock);
  if (image) sqlite.prepare("INSERT INTO receipt_images (receipt_id, shopper_id, type, data, created_at) VALUES (?,?,?,?,?)").run(id, idOf(who), "image/png", PNG, clock);
};
const A3 = "44444444-4444-4444-4444-444444444444", A1 = "11111111-1111-1111-1111-111111111111", A2 = "22222222-2222-2222-2222-222222222222", B1 = "33333333-3333-3333-3333-333333333333";
seed("alice@example.com", A1, { kind: "receipt", retailer: { name: "lululemon", domain: "e.lululemon.com" }, orderRef: "UK04002516", orderDate: "2025-11-19", currency: "GBP",
  totalPence: 11800, items: [{ name: "Define Jacket Nulu", qty: 1, pricePence: 11800 }],
  returns: { deadline: "2025-12-24" }, hasImage: true, parserVersion: 5 }, true);
seed("alice@example.com", A3, { kind: "receipt", retailer: { name: "lululemon" }, orderRef: "UK2", currency: "GBP", items: [{ name: "Align Pant", qty: 1, pricePence: 9800 }, { name: "Define Jacket Nulu", qty: 1, pricePence: 11800 }], hasImage: true, parserVersion: 5 }, true);
seed("alice@example.com", A2, { kind: "receipt", retailer: { name: "Example Outfitters" }, orderRef: "EO-1", currency: "GBP", items: [{ name: "Wool jumper", qty: 1, pricePence: 5900 }], parserVersion: 5 });
seed("bob@example.com", B1, { kind: "receipt", retailer: { name: "Alpine Active" }, orderRef: "AA-9", currency: "GBP", items: [{ name: "Trail shell", qty: 1, pricePence: 14000 }], parserVersion: 5 });

// Everything needs sign-in.
for (const p of ["/relay/my/resale/feed", "/relay/my/resale/items", "/relay/my/resale/mine"]) assert.equal((await get(p)).status, 401, p + " needs sign-in");

// Items offered for listing are the shopper's own, and say whether the return window is still open.
let items = (await (await get("/relay/my/resale/items", alice)).json()).items;
assert.equal(items.length, 4);
const jacket = items.find(i => i.receiptId === A1);
assert.equal(jacket.returnWindowOpen, false, "an expired return window is reported");
assert.equal(items.find(i => i.title === "Wool jumper").returnWindowOpen, null, "unknown window is reported as unknown");
assert.ok(!JSON.stringify(items).includes("Trail shell"), "never lists another member's items");

// Listing rules.
const list = (token, extra = {}) => post("/relay/my/resale/listings", token, { receiptId: A1, itemIndex: 0, condition: "like_new", size: "US 8 (UK 12)", askPence: 6500, swapOk: true, note: "Worn twice", agree: true, ...extra });
assert.equal((await list(alice, { agree: false })).status, 400, "sharing must be agreed to");
assert.equal((await list(alice, { condition: "mint" })).status, 400);
assert.equal((await list(alice, { askPence: -1 })).status, 400);
assert.equal((await list(alice, { askPence: 99999999 })).status, 400);
assert.equal((await list(alice, { itemIndex: 9 })).status, 404);
assert.equal((await list(bob)).status, 404, "bob cannot list alice's receipt item");
let r = await list(alice, { title: "FAKE TITLE", store: "Gucci" });
assert.equal(r.status, 200);
const L1 = (await r.json()).id;
const row = sqlite.prepare("SELECT * FROM resale_listings WHERE id = ?").get(L1);
assert.equal(row.title, "Define Jacket Nulu"); assert.equal(row.store, "lululemon", "title and store come from the receipt, not the request");
assert.equal((await list(alice)).status, 409, "the same item cannot be listed twice");
await post("/relay/my/resale/listings", alice, { receiptId: A3, itemIndex: 0, condition: "good", agree: true });
assert.equal(sqlite.prepare("SELECT note FROM resale_listings WHERE id = ?").get(L1).note, "Worn twice");
const noisy = await post("/relay/my/resale/listings", alice, { receiptId: A2, itemIndex: 0, condition: "good", agree: true, note: "<img src=x onerror=alert(1)> call me" });
assert.ok(!sqlite.prepare("SELECT note FROM resale_listings WHERE id = ?").get((await noisy.json()).id).note.includes("<"), "markup is stripped from notes");
const L2 = sqlite.prepare("SELECT id FROM resale_listings WHERE receipt_id = ? AND item_index = 0").get(A3).id;

// Feed: others see it without anything identifying the seller.
const feedBob = (await (await get("/relay/my/resale/feed", bob)).json()).listings;
assert.equal(feedBob.length, 3);
const seen = JSON.stringify(feedBob);
for (const secret of ["alice", "UK04002516", "EO-1", A1, idOf("alice@example.com"), "seller", "receipt"]) assert.ok(!seen.toLowerCase().includes(secret.toLowerCase()), "feed leaks nothing: " + secret);
assert.equal((await (await get("/relay/my/resale/feed", alice)).json()).listings.length, 0, "own listings are not in your own feed");

// Photos: any signed-in member sees an active listing's photo; withdrawn ones only the seller.
r = await get(`/relay/my/resale/listings/${L1}/image`, bob);
assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png");
assert.equal((await get(`/relay/my/resale/listings/${L1}/image`)).status, 401);
assert.equal((await get(`/relay/my/resale/listings/${L2}/image`, bob)).status, 404, "a multi-item order's photo is not assumed to be this item's");

// Asking.
const ask = (token, id, body) => post(`/relay/my/resale/listings/${id}/ask`, token, body);
assert.equal((await ask(alice, L1, { kind: "buy" })).status, 400, "cannot ask about your own listing");
assert.equal((await ask(bob, L1, { kind: "gift" })).status, 400);
assert.equal((await ask(bob, L1, { kind: "swap", offeredListingId: L2 })).status, 400, "must offer one of your own listings");
assert.equal((await ask(bob, L1, { kind: "buy", message: "Is it still available?" })).status, 200);
assert.equal((await ask(bob, L1, { kind: "buy" })).status, 409, "one request per listing");
assert.equal((await ask(carol, "00000000-0000-0000-0000-000000000000", { kind: "buy" })).status, 404);
assert.equal((await post("/relay/my/resale/listings", bob, { receiptId: B1, itemIndex: 0, condition: "good", agree: true, swapOk: true })).status, 200);
const BL = sqlite.prepare("SELECT id FROM resale_listings WHERE seller_id = ?").get(idOf("bob@example.com")).id;
assert.equal((await ask(carol, L1, { kind: "swap", offeredListingId: BL })).status, 400, "cannot offer someone else's listing");
assert.equal((await ask(bob, L2, { kind: "swap", offeredListingId: BL })).status, 400, "swap not offered on that listing");
sqlite.prepare("UPDATE resale_listings SET swap_ok = 1 WHERE id = ?").run(L2);
assert.equal((await ask(bob, L2, { kind: "swap", offeredListingId: BL })).status, 200);
assert.equal((await ask(carol, L1, { kind: "buy" })).status, 200);

// Seller view: requests show only as "Member N"; others cannot see them.
const mine = await (await get("/relay/my/resale/mine", alice)).json();
const l1 = mine.listings.find(l => l.id === L1);
assert.deepEqual(l1.requests.map(q => q.who), ["Member 1", "Member 2"]);
assert.ok(!JSON.stringify(mine).includes("bob@") && !JSON.stringify(mine).includes("carol@") && !JSON.stringify(mine).includes(idOf("bob@example.com")), "asker identity never shown");
assert.equal(mine.listings.find(l => l.id === L2).requests[0].offered.title, "Trail shell");
assert.equal((await (await get("/relay/my/resale/mine", bob)).json()).listings.find(l => l.id === L1), undefined, "other members' listings are not in 'mine'");
const reqId = l1.requests[0].id;
assert.equal((await post(`/relay/my/resale/requests/${reqId}/accept`, bob)).status, 404, "only the seller can accept");
assert.equal((await post(`/relay/my/resale/requests/${reqId}/accept`, alice)).status, 200);
assert.equal(sqlite.prepare("SELECT status FROM resale_listings WHERE id = ?").get(L1).status, "matched");
const after = (await (await get("/relay/my/resale/mine", alice)).json()).listings.find(l => l.id === L1);
assert.deepEqual(after.requests.map(q => q.status), ["accepted", "declined"], "other pending requests are declined");
assert.equal((await ask(carol, L1, { kind: "buy" })).status, 404, "a matched listing takes no more requests");
assert.equal((await (await get("/relay/my/resale/feed", bob)).json()).listings.some(l => l.id === L1), false, "matched listings leave the feed");
const bobReqs = (await (await get("/relay/my/resale/mine", bob)).json()).myRequests;
assert.ok(bobReqs.some(q => q.title === "Define Jacket Nulu" && q.status === "accepted"));

// Messages: only the seller and the member whose request was accepted, only while it is accepted.
const msg = (token, id, body) => post(`/relay/my/resale/requests/${id}/messages`, token, { body });
const pendingReq = sqlite.prepare("SELECT id FROM resale_requests WHERE listing_id = ? AND status = 'pending'").get(L2).id;
assert.equal((await msg(bob, pendingReq, "hello")).status, 409, "no messages before the seller accepts");
assert.equal((await get(`/relay/my/resale/requests/${reqId}/messages`, carol)).status, 404, "an outsider cannot read the thread");
assert.equal((await msg(carol, reqId, "hello")).status, 404, "an outsider cannot write to the thread");
assert.equal((await get(`/relay/my/resale/requests/${reqId}/messages`)).status, 401);
assert.equal((await msg(bob, reqId, "Hi, is it still available? Could do Saturday.")).status, 200);
assert.equal((await msg(alice, reqId, "Yes it is. Saturday works.")).status, 200);
const thread = await (await get(`/relay/my/resale/requests/${reqId}/messages`, alice)).json();
assert.deepEqual(thread.messages.map(m => m.mine), [false, true]); assert.equal(thread.with, "Buyer"); assert.equal(thread.open, true);
assert.equal((await (await get(`/relay/my/resale/requests/${reqId}/messages`, bob)).json()).with, "Seller");
assert.ok(!JSON.stringify(thread).includes(idOf("bob@example.com")), "thread never shows who the other person is");
for (const bad of ["email me at bob@example.com", "bob at gmail dot com", "call 07123 456 789", "+44 7123 456789", "see https://example.com/me", "find me on www.insta.test/bob"])
  assert.equal(await (await msg(bob, reqId, bad)).json().then(j => j.error), "no_contact_details", "blocked: " + bad);
assert.equal((await msg(bob, reqId, "   ")).status, 400);
assert.equal((await msg(bob, reqId, "<b>hi</b> there")).status, 200);
assert.ok(!(await (await get(`/relay/my/resale/requests/${reqId}/messages`, alice)).json()).messages.some(m => m.body.includes("<")), "markup is stripped");
let hit; for (let i = 0; i < 25 && !hit; i++) { const x = await msg(bob, reqId, "ping " + i); if (x.status === 429) hit = (await x.json()).error; }
assert.equal(hit, "too_many_messages", "message rate is limited");
// Ending (or reporting) a conversation closes it and puts the listing back on sale.
assert.equal((await post(`/relay/my/resale/requests/${reqId}/report`, carol, { reason: "x" })).status, 404, "outsiders cannot end it");
assert.equal((await post(`/relay/my/resale/requests/${reqId}/report`, bob, { reason: "Asked me to pay outside Relay" })).status, 200);
assert.equal(sqlite.prepare("SELECT status FROM resale_requests WHERE id = ?").get(reqId).status, "closed");
assert.equal(sqlite.prepare("SELECT status FROM resale_listings WHERE id = ?").get(L1).status, "active", "listing is back on sale");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM resale_reports WHERE request_id = ?").get(reqId).n, 1);
assert.equal((await msg(alice, reqId, "still there?")).status, 409, "closed threads take no messages");
assert.equal((await (await get(`/relay/my/resale/requests/${reqId}/messages`, alice)).json()).open, false);

// Withdrawing, and the limits.
assert.equal((await post(`/relay/my/resale/listings/${L2}/withdraw`, bob)).status, 404, "only the seller can withdraw");
assert.equal((await post(`/relay/my/resale/listings/${L2}/withdraw`, alice)).status, 200);
assert.equal((await get(`/relay/my/resale/listings/${L2}/image`, bob)).status, 404);
assert.equal(sqlite.prepare("SELECT status FROM resale_requests WHERE listing_id = ?").get(L2).status, "declined", "pending requests close when a listing is withdrawn");

// Disconnecting Gmail / deleting the account takes listings down.
await post("/relay/my/consent", alice, { version: (await (await get("/relay/my/consent", alice)).json()).version });
await post("/relay/my/gmail/disconnect", alice);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM resale_listings WHERE seller_id = ? AND status IN ('active','matched')").get(idOf("alice@example.com")).n, 0, "listings come down when receipts are deleted");
assert.equal((await post("/relay/my/delete", bob)).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM resale_listings WHERE seller_id = ?").get(idOf("alice@example.com")).n > 0, true);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM resale_requests WHERE asker_id = ?").get(idOf("carol@example.com")).n, 1, "other members' requests stay");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM resale_messages WHERE request_id = ?").get(reqId).n, 0, "deleting an account deletes its conversations");
console.log("PASS resale v1 + messages: ownership, receipt-sourced titles, privacy of sellers and askers, photos, requests, matching, withdrawal, deletion");
