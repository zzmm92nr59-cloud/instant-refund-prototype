// Offline tests for the consent record and Gmail connection, against a real SQLite engine.
// Google and Gmail are FAKED here: this proves Relay's own rules (consent first, state binding,
// encrypted token, no email bodies kept, disconnect/delete) but NOT that real Google accepts our
// settings. Real Gmail needs the Google Cloud setup and a live test with a test user.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, sendReturnReminders } from "../worker/gmail.js";

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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key",
  GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test" };

const REFRESH = "1//refresh-token-PLAINTEXT-marker";
const b64url = s => Buffer.from(s).toString("base64url");
const receiptMail = (n) => `From: Example Outfitters <orders@exampleoutfitters.test>\nSubject: Your order confirmation #EO-${n}\nContent-Type: text/plain\n\nOrder number: EO-${n}\nOrder date: 14 Oct 2026\nWool jumper - Qty 1 - £59.00\nOrder total: £59.00\nReturns accepted within 30 days of purchase.\nPRIVATE-BODY-MARKER-${n}\n`;
const newsletter = `From: Shop <news@shop.test>\nSubject: 50% off this weekend\nContent-Type: text/plain\n\nJumpers from £19.99 PRIVATE-BODY-MARKER-news`;
const gmailBox = { m1: receiptMail(1), m2: newsletter, m3: receiptMail(3) };
let calls = [];
let refreshOk = true;
let paging = false;
const listQueries = [];
const boxDates = {};
const ymdOf = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "/");
const imageCalls = [];
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3000, 7)]);
let emails = [];
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  calls.push({ url, body: init.body ? String(init.body) : "", auth: init.headers && init.headers.Authorization });
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  if (url === "https://oauth2.googleapis.com/token") {
    const p = new URLSearchParams(String(init.body));
    if (p.get("grant_type") === "authorization_code")
      return p.get("code") === "good-code"
        ? Response.json({ access_token: "access-1", refresh_token: REFRESH, scope: "https://www.googleapis.com/auth/gmail.readonly" })
        : p.get("code") === "narrow-scope"
          ? Response.json({ access_token: "a", refresh_token: REFRESH, scope: "openid" })
          : new Response("{}", { status: 400 });
    return refreshOk ? Response.json({ access_token: "access-2" }) : new Response("{}", { status: 400 });
  }
  if (url.startsWith("https://cdn.exampleoutfitters.test/") || url.startsWith("http://insecure.test/")) {
    imageCalls.push(url);
    if (url.endsWith("wool-jumper.png")) return new Response(PNG, { headers: { "content-type": "image/png" } });
    if (url.endsWith("fake.png")) return new Response("<svg onload=alert(1)>" .repeat(200), { headers: { "content-type": "image/png" } });
    return new Response("nope", { status: 404 });
  }
  if (url === "https://oauth2.googleapis.com/revoke") return new Response("{}", { status: 200 });
  if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") return Response.json({ emailAddress: "alice.gmail@gmail.com" });
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
        const q = decodeURIComponent(url);
    const win = /after:(\d{4}\/\d{2}\/\d{2}) before:(\d{4}\/\d{2}\/\d{2})/.exec(q);
    assert.ok(win, "scan asks Gmail for one date window at a time");
    listQueries.push(win[1] + ".." + win[2]);
    const inWin = id => { const d = boxDates[id] || ymdOf(clock - 60000); return d >= win[1] && d < win[2]; };
    if (url.includes("pageToken=page2")) return Response.json({ messages: [{ id: "m99abcdef" }].filter(m => inWin(m.id.replace("abcdef", ""))) });
    const ids = Object.keys(gmailBox).filter(inWin);
    if (paging) return Response.json({ messages: ids.filter(k => k !== "m99").map(id => ({ id: id + "abcdef" })), nextPageToken: "page2" });
    return Response.json({ messages: ids.map(id => ({ id: id + "abcdef" })) });
  }
  const one = /messages\/(m\d+)abcdef\?format=raw$/.exec(url);
  if (one) return Response.json({ raw: b64url(gmailBox[one[1]]) });
  return new Response("blocked", { status: 500 });
};
let clock = 1_800_000_000_000;
const call = (path, { method = "GET", body, token, ip = "1.1.1.1", e = env } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), e, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const alice = await signIn("alice@example.com", "5.5.5.5");
const bob = await signIn("bob@example.com", "6.6.6.6");
const post = (path, token, body) => call(path, { method: "POST", token, body });
const stateFrom = async token => new URL((await (await post("/relay/my/gmail/connect", token)).json()).url).searchParams.get("state");
const cb = (qs) => call("/relay/gmail/callback?" + qs);

// 1. Consent screen text is served by the server; nothing works before consent.
let r = await call("/relay/my/consent", { token: alice });
const consent = await r.json();
assert.equal(consent.accepted, false);
assert.equal(consent.version, CONSENT_VERSION);
assert.ok(consent.text.join(" ").includes("read-only") && consent.text.join(" ").includes("cannot start an automatic refund"));
assert.equal((await call("/relay/my/consent")).status, 401, "consent needs sign-in");
assert.equal((await post("/relay/my/gmail/connect", alice)).status, 403, "no Gmail connection without consent");
assert.equal((await post("/relay/my/gmail/scan", alice)).status, 403, "no scan without consent");
assert.equal((await post("/relay/my/consent", alice, { version: "old-version" })).status, 400, "only the current wording can be accepted");
assert.equal((await post("/relay/my/consent", alice, { version: CONSENT_VERSION })).status, 200);
assert.equal((await (await call("/relay/my/consent", { token: alice })).json()).accepted, true);
assert.equal((await (await call("/relay/my/consent", { token: bob })).json()).accepted, false, "consent is per shopper");
const rec = sqlite.prepare("SELECT version, text_hash FROM shopper_consents").all();
assert.equal(rec.length, 1);
assert.match(rec[0].text_hash, /^[0-9a-f]{64}$/, "wording hash recorded");

// 2. Not configured is reported honestly.
assert.equal((await call("/relay/my/gmail/connect", { method: "POST", token: alice, e: { ...env, GOOGLE_CLIENT_ID: undefined } })).status, 503);

// 3. Connect URL: read-only scope, offline access, state bound to the shopper.
r = await post("/relay/my/gmail/connect", alice);
assert.equal(r.status, 200);
const authUrl = new URL((await r.json()).url);
assert.equal(authUrl.origin + authUrl.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
assert.equal(authUrl.searchParams.get("scope"), "https://www.googleapis.com/auth/gmail.readonly");
assert.equal(authUrl.searchParams.get("access_type"), "offline");
assert.equal(authUrl.searchParams.get("redirect_uri"), "https://w.test/relay/gmail/callback");
const state = authUrl.searchParams.get("state");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gmail_oauth_states WHERE state_hash = ?").get(state).n, 0, "raw state never stored");

// 4. Callback: bad/forged/used/expired states are refused; good one connects Alice only.
const loc = res => res.headers.get("location");
assert.match(loc(await cb("code=good-code&state=" + "x".repeat(43))), /#gmail=failed$/, "unknown state refused");
assert.match(loc(await cb("code=good-code")), /#gmail=failed$/);
assert.match(loc(await cb("error=access_denied&state=" + state)), /#gmail=denied$/);
assert.match(loc(await cb("code=narrow-scope&state=" + state)), /#gmail=failed$/, "must have granted the Gmail read scope");
const s2 = await stateFrom(alice);
assert.match(loc(await cb("code=good-code&state=" + s2)), /#gmail=connected$/);
assert.match(loc(await cb("code=good-code&state=" + s2)), /#gmail=failed$/, "state is single-use");
const s3 = await stateFrom(alice);
clock += 11 * 60 * 1000;
assert.match(loc(await cb("code=good-code&state=" + s3)), /#gmail=failed$/, "state expires after 10 minutes");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gmail_connections").get().n, 1);
assert.equal((await (await call("/relay/my/gmail", { token: alice })).json()).connected, true);
assert.equal((await (await call("/relay/my/gmail", { token: bob })).json()).connected, false, "Bob is not connected");

// 5. Refresh token is encrypted at rest.
const stored = JSON.stringify(sqlite.prepare("SELECT * FROM gmail_connections").all());
assert.ok(!stored.includes("PLAINTEXT-marker") && !stored.includes("refresh-token"), "refresh token never stored in clear");

// 6. Consent is re-checked at the callback (withdrawn mid-flow means no connection).
// (covered below with withdraw)

// Follows the scan cursor the way the app does; returns the summed counts.
const scanAll = async (token = alice, max = 60) => {
  const tot = { added: 0, updated: 0, alreadyCaptured: 0, notReceipts: 0, calls: 0 };
  let cursor, res;
  do {
    res = await post("/relay/my/gmail/scan", token, cursor ? { cursor } : undefined);
    assert.equal(res.status, 200);
    const j = await res.json();
    for (const k of ["added", "updated", "alreadyCaptured", "notReceipts"]) tot[k] += j[k];
    tot.calls++; cursor = j.cursor; tot.more = j.more;
    assert.ok(tot.calls < max, "scan finishes");
  } while (tot.more);
  return tot;
};

// 7. Scan: receipts kept as extracted fields only; newsletters ignored; duplicates skipped.
calls = [];
const first = await scanAll();
assert.deepEqual({ ...first, calls: 0 }, { added: 2, updated: 0, alreadyCaptured: 0, notReceipts: 1, calls: 0, more: false });
assert.ok(first.calls >= 5, "the whole look-back period is covered, a few months per call");
assert.ok(calls.every(c => !c.url.includes("/send") && !c.url.includes("modify") && !c.url.includes("delete")), "only read calls to Gmail");
assert.ok(calls.filter(c => c.url.includes("gmail.googleapis")).every(c => c.auth === "Bearer access-2"));
const dump = JSON.stringify(sqlite.prepare("SELECT * FROM captured_receipts").all());
assert.ok(!dump.includes("PRIVATE-BODY-MARKER"), "email text is never stored");
assert.ok(dump.includes("EO-1") && dump.includes("5900"));
assert.deepEqual({ ...(await scanAll()), calls: 0 }, { added: 0, updated: 0, alreadyCaptured: 3, notReceipts: 0, calls: 0, more: false }, "newsletters are remembered and not fetched again");
// Return details are stored as extracted fields, and receipts captured before they existed get them added once.
let rows = sqlite.prepare("SELECT details FROM captured_receipts WHERE status != 'not_receipt'").all().map(x => JSON.parse(x.details));
assert.ok(rows.every(d => d.returns && d.returns.windowDays === 30 && d.returns.deadline === "2026-11-13"), "return window and deadline kept");
sqlite.prepare("UPDATE captured_receipts SET details = json_remove(details, '$.parserVersion'), status = 'pending' WHERE message_ref = (SELECT message_ref FROM captured_receipts WHERE status != 'not_receipt' LIMIT 1)").run();
assert.deepEqual({ ...(await scanAll()), calls: 0 }, { added: 0, updated: 1, alreadyCaptured: 2, notReceipts: 0, calls: 0, more: false }, "old receipt re-read once with the newer reader");
rows = sqlite.prepare("SELECT details FROM captured_receipts WHERE status != 'not_receipt'").all().map(x => JSON.parse(x.details));
assert.ok(rows.every(d => d.returns && d.returns.windowDays === 30));
assert.ok(!JSON.stringify(rows).includes("PRIVATE-BODY-MARKER"), "email text still never stored");
assert.deepEqual({ ...(await scanAll()), calls: 0 }, { added: 0, updated: 0, alreadyCaptured: 3, notReceipts: 0, calls: 0, more: false }, "no repeat re-read");

// 7b. Return emails join their order; a long mailbox is read in steps.
gmailBox.m4 = `From: Example Outfitters <returns@exampleoutfitters.test>\nSubject: Your return QR code for order EO-1\nDate: Mon, 16 Nov 2026 10:00:00 +0000\nContent-Type: text/plain\n\nReturn ID: RT-778812\nReturn by Friday 27 November 2026\nReturn Instructions\nTake your parcel to any Evri ParcelShop.\nShow the QR code to the shop.\nEstimated refund: £59.00\n`;
for (let i = 10; i < 40; i++) gmailBox["m" + i] = newsletter + i;
let last;
const big = await scanAll();
assert.ok(big.calls >= 8, "a busy window takes several calls, then the older windows follow");
const merged = (await (await call("/relay/my/receipts", { token: alice })).json()).receipts;
assert.equal(merged.length, 2, "return email is not a separate card when its order exists");
const eo1 = merged.find(x => x.orderRef === "EO-1");
assert.ok(eo1 && eo1.returnPlan && eo1.returnPlan.returnId === "RT-778812" && eo1.returnPlan.deadline === "2026-11-27" && eo1.returnPlan.carrier === "Evri", JSON.stringify(eo1 && eo1.returnPlan));
assert.match(eo1.returnPlan.gmailId, /^m4abcdef$/);
// 7c. Older receipts on later Gmail result pages are reached.
gmailBox.m99 = receiptMail(99).replace("14 Oct 2026", "19 Nov 2025");
paging = true;
await scanAll();
paging = false;
assert.ok(JSON.stringify(sqlite.prepare("SELECT details FROM captured_receipts").all()).includes("EO-99"), "receipt from page two captured");
sqlite.prepare("DELETE FROM captured_receipts WHERE details LIKE '%EO-99%'").run();
delete gmailBox.m99;

// 7c2. Receipts from many months ago are reached; ones beyond the look-back are not.
gmailBox.m7 = receiptMail(7).replace("14 Oct 2026", "19 Nov 2025"); boxDates.m7 = ymdOf(clock - 300 * 86400000);
gmailBox.m8 = receiptMail(8); boxDates.m8 = ymdOf(clock - 700 * 86400000);
listQueries.length = 0;
await scanAll();
const dumpOld = JSON.stringify(sqlite.prepare("SELECT details FROM captured_receipts").all());
assert.ok(dumpOld.includes("EO-7"), "a receipt from 300 days ago is found");
assert.ok(!dumpOld.includes("EO-8"), "nothing beyond the look-back period is read");
assert.ok(listQueries.length >= 16 && listQueries.every(q => q.length === 22), "month by month windows: " + listQueries.length);
sqlite.prepare("DELETE FROM captured_receipts WHERE details LIKE '%EO-7%'").run();
delete gmailBox.m7; delete gmailBox.m8;

// 7d. Product photo: the likely product image is stored (never logos, http links or fake images), served only to its owner.
gmailBox.m5 = `From: Example Outfitters <orders@exampleoutfitters.test>\nSubject: Your order confirmation #EO-5\nContent-Type: text/html\n\n<html><body><img src="https://cdn.exampleoutfitters.test/logo.png" width="120"><img src="http://insecure.test/p.png" width="300"><img src="https://cdn.exampleoutfitters.test/products/wool-jumper.png" alt="Wool jumper" width="300"><p>Order number: EO-5</p><p>Order date: 14 Oct 2026</p><p>Wool jumper - Qty 1 - £59.00</p><p>Order total: £59.00</p></body></html>`;
gmailBox.m6 = gmailBox.m5.replace("EO-5", "EO-6").replace("EO-5", "EO-6").replace("wool-jumper.png", "fake.png");
await scanAll();
assert.ok(!imageCalls.some(u => u.includes("logo") || u.startsWith("http://")), "logos and non-https images are never fetched");
const withPhoto = sqlite.prepare("SELECT id, details FROM captured_receipts WHERE details LIKE '%EO-5%'").get();
assert.equal(JSON.parse(withPhoto.details).hasImage, true);
assert.ok(!withPhoto.details.includes("wool-jumper.png") && !withPhoto.details.includes("cdn.exampleoutfitters"), "image address is not kept");
const noPhoto = sqlite.prepare("SELECT id, details FROM captured_receipts WHERE details LIKE '%EO-6%'").get();
assert.equal(JSON.parse(noPhoto.details).hasImage, false, "an image that is not really an image is refused");
r = await call(`/relay/my/receipts/${withPhoto.id}/image`, { token: alice });
assert.equal(r.status, 200);
assert.equal(r.headers.get("content-type"), "image/png");
assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
assert.equal((await call(`/relay/my/receipts/${withPhoto.id}/image`, { token: bob })).status, 404, "another shopper cannot see the photo");
assert.equal((await call(`/relay/my/receipts/${noPhoto.id}/image`, { token: alice })).status, 404);
const photoCalls = imageCalls.length;
await scanAll();
assert.equal(imageCalls.length, photoCalls, "photos are fetched only once per receipt");

// 7e. Return reminders: opt-in per item, sent once, only before the deadline, only if still wanted.
const keepClock = clock;
const eoOne = (await (await call("/relay/my/receipts", { token: alice })).json()).receipts.find(x => x.orderRef === "EO-1");
assert.equal(eoOne.reminder, "off");
clock = Date.parse("2026-11-22T08:00:00Z");
assert.equal((await post(`/relay/my/receipts/${eoOne.id}/remind`, bob, { on: true })).status, 403, "a shopper without consent cannot set reminders");
r = await post(`/relay/my/receipts/${eoOne.id}/remind`, alice, { on: true });
assert.equal(r.status, 200);
const rj = await r.json();
assert.equal(rj.deadline, "2026-11-27", "uses the exact date from the return email");
assert.equal(new Date(rj.remindAt).toISOString(), "2026-11-24T09:00:00.000Z", "three days before the deadline");
emails = [];
assert.equal((await sendReturnReminders(env, clock, fetchImpl)).sent, 0, "not due yet");
clock = Date.parse("2026-11-24T10:00:00Z");
assert.equal((await sendReturnReminders(env, clock, fetchImpl)).sent, 1);
assert.deepEqual(emails[0].to, ["alice@example.com"]);
assert.match(emails[0].subject, /^Return deadline in 4 days: Example Outfitters/);
assert.equal((await sendReturnReminders(env, clock, fetchImpl)).sent, 0, "only ever sent once");
assert.equal((await (await call("/relay/my/receipts", { token: alice })).json()).receipts.find(x => x.orderRef === "EO-1").reminder, "sent");
// A dismissed item gets no reminder.
clock = Date.parse("2026-11-22T08:00:00Z");
await post(`/relay/my/receipts/${eoOne.id}/remind`, alice, { on: true });
sqlite.prepare("UPDATE captured_receipts SET status = 'dismissed' WHERE id = ?").run(eoOne.id);
clock = Date.parse("2026-11-24T10:00:00Z");
emails = [];
assert.equal((await sendReturnReminders(env, clock, fetchImpl)).sent, 0, "dismissed item gets no reminder");
sqlite.prepare("UPDATE captured_receipts SET status = 'pending' WHERE id = ?").run(eoOne.id);
// Too late to remind, and an email failure retries rather than losing the reminder.
clock = Date.parse("2026-12-01T08:00:00Z");
assert.equal((await post(`/relay/my/receipts/${eoOne.id}/remind`, alice, { on: true })).status, 400, "deadline already passed");
clock = Date.parse("2026-11-26T08:00:00Z");
assert.equal((await post(`/relay/my/receipts/${eoOne.id}/remind`, alice, { on: true })).status, 200);
const failingFetch = async () => new Response("{}", { status: 500 });
assert.equal((await sendReturnReminders(env, clock, failingFetch)).sent, 0);
assert.equal((await sendReturnReminders(env, clock, fetchImpl)).sent, 1, "retried after a failed send");
assert.equal((await post(`/relay/my/receipts/${eoOne.id}/remind`, alice, { on: false })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM return_reminders").get().n, 0, "turning it off removes it");
clock = keepClock;
// Remove the test photo receipts so later counts are unchanged.
sqlite.prepare("DELETE FROM captured_receipts WHERE details LIKE '%EO-5%' OR details LIKE '%EO-6%'").run();
sqlite.prepare("DELETE FROM receipt_images").run();
delete gmailBox.m5; delete gmailBox.m6;
await post(`/relay/my/receipts/${eoOne.id}/remind`, alice, { on: false });
clock = Date.parse("2026-11-22T08:00:00Z"); await post(`/relay/my/receipts/${eoOne.id}/remind`, alice, { on: true }); clock = keepClock;

// 8. Captured receipts: private to the shopper, never refund-eligible, can be confirmed or dismissed.
const mine = (await (await call("/relay/my/receipts", { token: alice })).json()).receipts;
assert.equal(mine.length, 2);
assert.ok(mine.every(x => x.refundEligible === false && x.source === "shopper_email" && x.status === "pending"));
assert.deepEqual((await (await call("/relay/my/receipts", { token: bob })).json()).receipts, [], "Bob sees nothing of Alice's");
assert.equal((await post(`/relay/my/receipts/${mine[0].id}/confirm`, bob)).status, 404, "cannot touch another shopper's receipt");
assert.equal((await post(`/relay/my/receipts/${mine[0].id}/confirm`, alice)).status, 200);
assert.equal((await post(`/relay/my/receipts/${mine[1].id}/dismiss`, alice)).status, 200);
const after = (await (await call("/relay/my/receipts", { token: alice })).json()).receipts;
assert.deepEqual(after.map(x => x.status), ["confirmed"]);

// 9. Google rejecting the stored connection is reported, not hidden.
refreshOk = false;
assert.equal((await post("/relay/my/gmail/scan", alice)).status, 401);
refreshOk = true;
assert.equal((await post("/relay/my/gmail/scan", bob)).status, 403, "Bob has no consent");
await post("/relay/my/consent", bob, { version: CONSENT_VERSION });
assert.equal((await post("/relay/my/gmail/scan", bob)).status, 409, "Bob consented but has not connected Gmail");

// 10. Disconnect revokes at Google and deletes the token and captured receipts.
calls = [];
r = await post("/relay/my/gmail/disconnect", alice);
const disc = await r.json();
assert.equal(disc.deleted, true);
assert.equal(disc.revokedAtGoogle, true);
assert.ok(calls.some(c => c.url === "https://oauth2.googleapis.com/revoke" && c.body.includes("PLAINTEXT-marker")));
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gmail_connections").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM return_reminders").get().n, 0, "reminders deleted on disconnect");
assert.equal((await (await call("/relay/my/consent", { token: alice })).json()).accepted, true, "disconnect alone keeps consent");

// 11. Withdrawing consent disconnects, deletes, and blocks further access.
const s4 = await stateFrom(alice);
assert.match(loc(await cb("code=good-code&state=" + s4)), /#gmail=connected$/);
await post("/relay/my/gmail/scan", alice);
const s5 = await stateFrom(alice);
await post("/relay/my/consent/withdraw", alice);
assert.match(loc(await cb("code=good-code&state=" + s5)), /#gmail=consent_needed$/, "withdrawn consent blocks a flow already in progress");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts WHERE shopper_id IN (SELECT id FROM shoppers WHERE email='alice@example.com')").get().n, 0);
assert.equal((await (await call("/relay/my/consent", { token: alice })).json()).accepted, false);
assert.equal((await post("/relay/my/gmail/connect", alice)).status, 403);
assert.equal((await post("/relay/my/gmail/scan", alice)).status, 403);

// 12. Deleting the account removes every Gmail-related row.
await post("/relay/my/consent", bob, { version: CONSENT_VERSION });
const s6 = await stateFrom(bob);
await cb("code=good-code&state=" + s6);
await post("/relay/my/gmail/scan", bob);
assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts").get().n > 0);
assert.equal((await post("/relay/my/delete", bob)).status, 200);
for (const t of ["captured_receipts", "gmail_connections", "gmail_oauth_states", "shopper_consents"])
  assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM ${t} WHERE shopper_id NOT IN (SELECT id FROM shoppers)`).get().n, 0, t + " cleaned on account deletion");

console.log("PASS consent record, Gmail connect/callback rules, encrypted token, receipts-only scan, privacy of captured receipts, disconnect, withdrawal and deletion (FAKE Google and Gmail)");
