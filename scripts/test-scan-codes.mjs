// Codes to show or scan (worker/scan-codes.js), offline: a real SQLite engine, a stand-in Gmail, and stand-in picture hosts
// (nothing here talks to Google or to any real shop). Every email is made up (scripts/fixtures/scan-codes.mjs).
// Checks:
//   1. the reader: each layout (a return barcode in a shipping email, a till receipt's own barcode, drop-off QR codes, a
//      QR code to collect with, tickets, a picture inside the email) is found as sent and as forwarded from Gmail, Outlook
//      and Apple Mail, with the shop's words quoted exactly and only a deadline the email states; every "must never be
//      shown" email gives nothing;
//   2. the picture: fetched once over https with nothing of the shopper's, only PNG, GIF, JPEG or WebP by its bytes, capped;
//   3. the server: codes kept when the inbox is read, joined to the right receipt by order number, tickets never doubled,
//      a picture that has gone handled, served to the owner only, kept through a re-read, and deleted with the receipt,
//      the inbox, the permission and the account.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, sealToken, classifyEmail, PARSER_VERSION } from "../worker/gmail.js";
import { findCodes, fetchCodeImage, checkedCodeImage, codeImageUrl, statedDate, CODE_MAX_BYTES } from "../worker/scan-codes.js";
import { rawEmail, forwarded } from "./fixtures/receipt-emails/lib.mjs";
import * as F from "./fixtures/scan-codes.mjs";

// ---- Pictures: a PNG, GIF and so on of a given size in pixels (only the first bytes matter to Relay) ------------------
const png = (w, h = w, pad = 600) => { const b = Buffer.alloc(24 + pad, 3); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write("IHDR", 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const gif = (w, h = w, pad = 300) => { const b = Buffer.alloc(10 + pad, 5); b.write("GIF89a", 0); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; };
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 9)]);
const webp = (() => { const b = Buffer.alloc(400, 2); b.write("RIFF", 0); b.write("WEBP", 8); return b; })();
const b64 = (b) => Buffer.from(b).toString("base64");

// ---- 1. The reader -------------------------------------------------------------------------------------------------------
const read = (f, app, kind) => { const raw = rawEmail(app ? forwarded(f, app) : f); const c = classifyEmail(raw, { gmailId: "abcdef12" }); return { ...c, raw }; };
const APPS = [null, "gmail", "outlook", "apple"];
const each = (f, check) => { for (const app of APPS) check(read(f, app), (app ? "forwarded from " + app : "as sent") + ": " + f.id); };
// A return barcode in a later shipping email: joins the order it names, with the shop's words exactly.
each(F.fellShipping, (r, w) => {
  assert.equal(r.codes.length, 1, w);
  const c = r.codes[0];
  assert.deepEqual([c.purpose, c.kind, c.value, c.deadline], ["in_store_return", "barcode", null, null], w);
  assert.deepEqual(c.words, [F.FELL_IN_STORE, F.FELL_RULE], w + ": the shop's own words, exactly");
  assert.equal(c.image.url, "https://live.fellmail.test/LiveContent.aspx?qs=5f1a9c0e77b2d4&t=bc", w + ": written as http, asked for as https");
  assert.ok(r.status !== "not_receipt" && /^FW20418856$/.test(r.details.orderRef) && r.details.codeCount === 1, w + ": kept for its order");
  assert.ok(!JSON.stringify(r.details).includes("LiveContent"), w + ": the picture's address is never kept");
});
assert.equal(read(F.fellShipping).details.kind, "order_codes", "an email that is only a code for an order is kept for that");
each(F.fellOrder, (r, w) => assert.equal(r.codes.length, 0, w + ": the order's confirmation has no code"));
// A till receipt's own barcode.
each(F.fellTill, (r, w) => {
  assert.equal(r.details.kind, "receipt", w); assert.equal(r.codes.length, 1, w);
  assert.deepEqual([r.codes[0].purpose, r.codes[0].kind, r.codes[0].deadline], ["in_store_return", "barcode", null], w + ": '30 days' is not turned into a date");
  assert.equal(r.codes[0].words[0], F.FELL_RECEIPT_WORDS, w);
});
// Drop-off QR codes: a returns company's and a marketplace's, each with the date the email states.
each(F.fellDropOff, (r, w) => {
  assert.equal(r.codes.length, 1, w);
  assert.deepEqual([r.codes[0].purpose, r.codes[0].kind, r.codes[0].deadline, r.details.orderRef], ["drop_off_return", "qr", "2025-12-24", "FW20402516"], w);
  assert.deepEqual(r.codes[0].words, [F.FELL_DROP], w);
});
each(F.marketReturnExpired, (r, w) => {
  assert.deepEqual([r.codes.length, r.codes[0].purpose, r.codes[0].deadline, r.details.orderRef], [1, "drop_off_return", "2025-09-06", "204-5512087-3340912"], w + ": 'Sat, 6 Sept' is the 6th after the email was sent");
  assert.equal(r.codes[0].words[0], F.MARKET_EVRI, w);
});
each(F.marketReturnLive, (r, w) => { assert.equal(r.codes[0].deadline, "2025-09-10", w); assert.equal(r.codes[0].words[0], F.MARKET_RM, w); });
// A QR code to collect with: its number comes from the address that draws it.
each(F.racePack, (r, w) => {
  assert.deepEqual([r.codes.length, r.codes[0].purpose, r.codes[0].kind, r.codes[0].value, r.codes[0].deadline], [1, "collection", "qr", "4417702", null], w + ": 'by Saturday' is not a date");
  assert.deepEqual(r.codes[0].words, [F.RACE_WORDS], w);
  assert.equal(r.details.orderRef, "4417702", w);
});
// Tickets: each barcode with its own number.
each(F.ticketOrder, (r, w) => {
  assert.deepEqual(r.codes.map((c) => [c.purpose, c.value, c.day]), F.TICKETS.map((n) => ["ticket", n, "2026-07-18"]), w);
  assert.ok(r.codes.every((c) => c.deadline === null && c.image.url === "https://lanternmail.test/im/" + c.value + ".png"), w);
});
F.ticketResends.forEach((f, k) => each(f, (r, w) => assert.deepEqual(r.codes.map((c) => [c.purpose, c.value]), [["ticket", F.TICKETS[k]]], w)));
// A code that is a picture inside the email (cid:): its bytes come from the email itself.
const collectHtml = (cid) => `<html><body><h1>Your order is ready</h1><p>Order number: PB-55102</p><p>Bring this QR code to our collection desk to collect your order.</p><p><img src="cid:${cid}" alt="QR code" width="200"></p></body></html>`;
const collectRaw = F.cidEmail({ from: "Pagebound Books <orders@pagebound.test>", subject: "Your order PB-55102 is ready to collect", date: "Mon, 16 Nov 2026 10:00:00 +0000", html: collectHtml("qr-55102@pagebound"), cid: "qr-55102@pagebound", png: png(220) });
{
  const r = classifyEmail(collectRaw, { gmailId: "abcdef13" });
  assert.deepEqual([r.codes.length, r.codes[0].purpose, r.details.orderRef], [1, "collection", "PB-55102"]);
  assert.deepEqual([r.codes[0].image.type, r.codes[0].image.data], ["image/png", b64(png(220))], "the picture is the one inside the email");
}
// What must never be shown.
for (const [what, f] of Object.entries(F.never)) each(f, (r, w) => { assert.equal(r.codes.length, 0, "never shown, " + what + " (" + w + ")"); assert.equal(r.details.codeCount, undefined, what); });
{
  const pass = F.cidEmail({ from: "Quay Wharf <visitors@quaywharf.test>", subject: "Your visitor pass", date: "Wed, 26 Aug 2026 10:00:00 +0000", cid: "image-1.png@localhost", png: png(222),
    html: '<html><body><p>Present this code to gain access to the building.</p><img alt="Code" src="cid:image-1.png@localhost" width="222"><p>Scan your QR code at the turnstiles.</p></body></html>' });
  assert.equal(classifyEmail(pass, { gmailId: "abcdef14" }).codes.length, 0, "a building pass inside the email is never shown");
  assert.equal(classifyEmail(rawEmail(F.fellShipping), { pasted: true }).codes.length, 0, "a pasted email has no inbox behind it: nothing is fetched for it");
}
// Dates: only ones the email writes out.
assert.equal(statedDate("Sat, 6 Sept", new Date("2025-08-10T09:00:00Z")), "2025-09-06");
assert.equal(statedDate("Wed 24 Dec 2025", null), "2025-12-24");
assert.equal(statedDate("3 January", new Date("2025-12-20T09:00:00Z")), "2026-01-03", "never a day before the email was sent");
assert.equal(statedDate("Saturday", new Date("2025-12-20T09:00:00Z")), null);
assert.equal(statedDate("31 February 2026", null), null);
console.log("ok - the reader: 9 layouts found as sent and forwarded (words exact, stated dates only), " + Object.keys(F.never).length + " kinds of look-alike never shown");

// ---- 2. The picture --------------------------------------------------------------------------------------------------------
{
  assert.equal(codeImageUrl("http://cl.mail.example.com/LiveContent.aspx?qs=1&amp;b=2"), "https://cl.mail.example.com/LiveContent.aspx?qs=1&b=2");
  for (const bad of ["https://localhost/a.png", "https://10.0.0.8/a.png", "https://printer.local/a.png", "https://user:pw@shop.test/a.png", "https://shop.test:8443/a.png", "ftp://shop.test/a.png", "data:image/png;base64,AAAA", "cid:x", "/relative.png", "https://intranet/a.png"])
    assert.equal(codeImageUrl(bad), null, "never fetched: " + bad);
  assert.equal(checkedCodeImage(png(300)).type, "image/png"); assert.equal(checkedCodeImage(gif(160)).type, "image/gif");
  assert.equal(checkedCodeImage(jpeg).type, "image/jpeg"); assert.equal(checkedCodeImage(webp).type, "image/webp");
  assert.equal(checkedCodeImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'>" + "x".repeat(300) + "</svg>")), null, "never SVG");
  assert.equal(checkedCodeImage(gif(1)), null, "a one-pixel tracker is not a code");
  assert.equal(checkedCodeImage(png(300, 300, CODE_MAX_BYTES)), null, "nothing over 300 KB");
  assert.equal(checkedCodeImage(Buffer.from("not a picture at all, just words, however many of them there are in this text")), null);
  const seen = [];
  const f = async (url, init) => { seen.push({ url, init }); return url.includes("slow") ? new Promise((_, no) => init.signal.addEventListener("abort", () => no(new Error("aborted")))) : url.includes("http-end") ? Object.assign(new Response(png(200)), {}) : new Response(png(200), { headers: { "content-type": "image/svg+xml" } }); };
  assert.equal((await fetchCodeImage(f, "https://codes.test/a")).type, "image/png", "its type is what its bytes say, not what the host says");
  assert.deepEqual(Object.keys(seen[0].init.headers), ["Accept"], "nothing of the shopper's goes with the request");
  assert.ok(seen[0].init.signal, "and it is given up on after a few seconds");
  const moved = async () => { const r = new Response(png(200)); Object.defineProperty(r, "url", { value: "http://codes.test/a" }); return r; };
  assert.equal(await fetchCodeImage(moved, "https://codes.test/a"), null, "a picture that ends up on plain http is not kept");
  assert.equal(await fetchCodeImage(async () => new Response("gone", { status: 403 }), "https://codes.test/a"), null);
  assert.equal(await fetchCodeImage(async () => { throw new Error("network"); }, "https://codes.test/a"), null);
  console.log("ok - the picture: https and real hosts only, PNG/GIF/JPEG/WebP by its bytes (never SVG), 300 KB at most, a time limit, nothing of the shopper's sent");
}

// ---- 3. The server --------------------------------------------------------------------------------------------------------
const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; }, async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; }, _exec() { sqlite.prepare(sql).run(...args); } };
}
const db = { prepare: (sql) => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { for (const s of list) s._exec(); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test" };
const DAY = 864e5;
let clock = Date.UTC(2026, 10, 19, 12);
const boxes = new Map();
let emails = [];
const pictureCalls = [];
let liveDown = false;
const ymdOf = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "/");
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "acc-" + (new URLSearchParams(String(init.body || "")).get("refresh_token") || "") });
  if (url === "https://oauth2.googleapis.com/revoke") return new Response("{}");
  const auth = String((init.headers && (init.headers.Authorization || init.headers.authorization)) || "").replace(/^Bearer /, "");
  const box = boxes.get(auth);
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
    const win = /after:(\d{4}\/\d{2}\/\d{2}) before:(\d{4}\/\d{2}\/\d{2})/.exec(decodeURIComponent(url));
    if (!box || !win) return Response.json({ messages: [] });
    return Response.json({ messages: [...box.entries()].filter(([, e]) => ymdOf(e.at) >= win[1] && ymdOf(e.at) < win[2]).map(([id]) => ({ id })) });
  }
  const one = /messages\/([A-Za-z0-9]+)\?format=raw$/.exec(url);
  if (one) { const e = box && box.get(one[1]); return e ? Response.json({ raw: Buffer.from(e.raw).toString("base64url") }) : new Response("{}", { status: 404 }); }
  // The stand-in picture hosts. Anything asked of them is written down, with what was sent.
  const host = new URL(url).hostname;
  if (/\.test$/.test(host)) {
    pictureCalls.push({ url, headers: init.headers || {}, auth });
    if (host === "live.fellmail.test") return liveDown ? new Response("gone", { status: 404 }) : new Response(png(300, 90));
    if (host === "returns.parcelback.test") return new Response(gif(160));
    if (host === "trans-qrcode-images-eu.objectstore.test") return url.includes("100200300499") ? new Response(png(168)) : new Response("<Error>Request has expired</Error>", { status: 403 });
    if (host === "api.qrmaker.test") return new Response(png(350));
    if (host === "lanternmail.test") return new Response(png(150, 60));
  }
  return new Response("{}", { status: 404 });
};
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl, busyWaitMs: 0 });
let shopperN = 0, mailN = 0;
async function newShopper() {
  const n = ++shopperN, email = "codes.shopper" + n + "@example.com";
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip: "9.9.9." + n });
  const token = (await (await call("/relay/auth/verify", { method: "POST", body: { token: /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1] } })).json()).sessionToken;
  const id = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id;
  assert.equal((await call("/relay/my/consent", { method: "POST", token, body: { version: CONSENT_VERSION } })).status, 200);
  const connect = async (boxId, rt) => { const s = await sealToken(env, rt); sqlite.prepare("INSERT INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at, provider) VALUES (?,?,?,?,?,?)").run(boxId, rt + "@gmail.com", s.iv, s.data, clock, null); const box = new Map(); boxes.set("acc-" + rt, box); return box; };
  const box = await connect(id, "rt" + n);
  const deliver = (to, list) => list.map((m) => { const mid = "c" + n + "m" + (++mailN) + "abcdef"; to.set(mid, { raw: typeof m.raw === "string" ? m.raw : rawEmail(m.f || m), at: clock - (m.daysAgo ?? 3) * DAY }); return mid; });
  const scan = async () => { let cursor, j, k = 0; do { const r = await call("/relay/my/gmail/scan", { method: "POST", token, body: cursor ? { cursor } : {} }); assert.equal(r.status, 200); j = await r.json(); cursor = j.cursor; assert.ok(++k < 80, "the scan finishes"); } while (j.more); };
  const receipts = async () => (await (await call("/relay/my/receipts?all=1", { token })).json()).receipts;
  return { token, id, box, connect, deliver: (list, to) => deliver(to || box, list), scan, receipts };
}
const codeRows = (id) => sqlite.prepare("SELECT receipt_id, idx, purpose, kind, type, value, words, deadline, day, code_key, (data IS NOT NULL) AS pic FROM receipt_codes WHERE shopper_id = ? ORDER BY created_at, receipt_id, idx").all(id);
const byRef = (list, ref) => list.find((r) => r.orderRef === ref);

const alice = await newShopper(), bob = await newShopper();
alice.deliver([{ f: F.fellOrder, daysAgo: 23 }, { f: F.fellShipping, daysAgo: 20 }, { f: F.fellOther, daysAgo: 17 }, { f: F.fellTill, daysAgo: 73 },
  { f: F.fellOrder2, daysAgo: 366 }, { f: F.fellDropOff, daysAgo: 363 }, { f: F.marketOrderA, daysAgo: 400 }, { f: F.marketOrderB, daysAgo: 399 },
  { f: F.marketReturnExpired, daysAgo: 395 }, { f: F.marketReturnLive, daysAgo: 396 }, { f: F.raceOrder, daysAgo: 300 }, { f: F.racePack, daysAgo: 200 },
  { raw: collectRaw, daysAgo: 3 }, ...Object.values(F.never).map((f) => ({ f, daysAgo: 10 }))]);
// Bob has an order with the same number as Alice's from the same shop, and no code of his own.
bob.deliver([{ f: F.fellOrder, daysAgo: 23 }]);
await alice.scan(); await bob.scan();
let list = await alice.receipts();
{
  // The return barcode from the shipping email is on the order's receipt, and only there.
  const order = byRef(list, "FW20418856");
  assert.deepEqual(order.codes, [{ n: 1, purpose: "in_store_return", kind: "barcode", words: [F.FELL_IN_STORE, F.FELL_RULE], deadline: null, hasImage: true, emailId: order.codes[0].emailId }]);
  assert.notEqual(order.codes[0].emailId, order.id, "it says which email it came from, so that email can be opened");
  assert.equal(byRef(list, "FW20419999").codes, undefined, "another order from the same shop has none");
  assert.ok(!list.some((r) => r.kind === "order_codes"), "an email kept only for its code is never a receipt of its own");
  // The till receipt's own barcode.
  const till = list.find((r) => (r.items || []).some((i) => /Recovery Slides/.test(i.name)));
  assert.deepEqual([till.codes.length, till.codes[0].purpose, till.codes[0].hasImage, till.codes[0].emailId], [1, "in_store_return", true, till.id]);
  // The returns company's QR code joins the shop's order (the company's address is not the shop's).
  const dropped = byRef(list, "FW20402516");
  assert.deepEqual([dropped.codes.length, dropped.codes[0].purpose, dropped.codes[0].deadline, dropped.codes[0].hasImage, dropped.codes[0].kind], [1, "drop_off_return", "2025-12-24", true, "qr"]);
  // A picture whose address had stopped working: the words and the date are kept, with no picture.
  const expired = byRef(list, "204-5512087-3340912"), live = byRef(list, "204-7781200-1150437");
  assert.deepEqual([expired.codes.length, expired.codes[0].hasImage, expired.codes[0].deadline, expired.codes[0].words[0]], [1, false, "2025-09-06", F.MARKET_EVRI]);
  assert.deepEqual([live.codes.length, live.codes[0].hasImage, live.codes[0].deadline], [1, true, "2025-09-10"]);
  assert.equal((await call("/relay/my/receipts/" + expired.id + "/codes/1", { token: alice.token })).status, 404, "no picture to give");
  // The collection codes, one fetched and one from inside its email.
  const race = byRef(list, "4417702");
  assert.deepEqual([race.codes.length, race.codes[0].purpose, race.codes[0].value, race.codes[0].hasImage], [1, "collection", "4417702", true]);
  // (The collection email with no receipt for its order shows nowhere: nothing is guessed.)
  assert.equal(list.filter((r) => r.codes).length, 6, "six receipts carry a code");
  assert.equal(JSON.stringify(list).includes("LiveContent") || JSON.stringify(list).includes("X-Amz"), false, "no picture's address reaches the app");
  const rows = codeRows(alice.id);
  assert.equal(rows.length, 7, "seven codes kept (the collection code without a receipt is kept with its own email)");
  assert.equal(JSON.stringify(sqlite.prepare("SELECT * FROM receipt_codes").all().map((r) => ({ ...r, data: null }))).match(/https?:\/\//), null, "no web address is kept with a code");
  assert.equal(JSON.stringify(sqlite.prepare("SELECT details FROM captured_receipts").all()).match(/LiveContent|X-Amz|viewPrinterlessLabel|qrmaker/), null, "nor with the email's details");
  assert.equal(codeRows(bob.id).length, 0, "Bob's order has no code: Alice's shipping email is hers alone");
  assert.equal(byRef(await bob.receipts(), "FW20418856").codes, undefined);
  // Each picture was fetched once, over https, with nothing of Alice's.
  assert.equal(pictureCalls.length, 6, "one fetch per picture: " + pictureCalls.map((c) => c.url).join(" "));
  assert.ok(pictureCalls.every((c) => c.url.startsWith("https://") && !c.auth && Object.keys(c.headers).join() === "Accept"), "no inbox key, no cookie, nothing but what kind of picture is wanted");
  console.log("ok - codes kept when the inbox is read: joined to the right receipt by order number, a picture that had gone handled, no addresses kept");
}
// Served to the owner only.
{
  const order = byRef(list, "FW20418856"), path = "/relay/my/receipts/" + order.id + "/codes/1";
  const res = await call(path, { token: alice.token });
  assert.equal(res.status, 200);
  assert.deepEqual([res.headers.get("content-type"), res.headers.get("x-content-type-options"), res.headers.get("cache-control")], ["image/png", "nosniff", "private, max-age=86400"]);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), png(300, 90), "the picture as it was fetched");
  const dropped = byRef(list, "FW20402516");
  assert.equal((await call("/relay/my/receipts/" + dropped.id + "/codes/1", { token: alice.token })).headers.get("content-type"), "image/gif", "a GIF is served as one");
  assert.equal((await call(path)).status, 401, "not without signing in");
  const others = await call(path, { token: bob.token });
  assert.equal(others.status, 404, "another shopper's receipt answers as if it didn't exist"); assert.deepEqual(await others.json(), { error: "not_found" });
  const bobOrder = byRef(await bob.receipts(), "FW20418856");
  assert.equal((await call("/relay/my/receipts/" + bobOrder.id + "/codes/1", { token: bob.token })).status, 404, "nor through his own receipt with the same order number");
  for (const p of [path.replace(/1$/, "2"), path.replace(/1$/, "0"), "/relay/my/receipts/" + byRef(list, "FW20419999").id + "/codes/1", "/relay/my/receipts/11111111-1111-4111-8111-111111111111/codes/1"])
    assert.equal((await call(p, { token: alice.token })).status, 404, p);
  assert.equal((await call(path, { method: "POST", token: alice.token, body: {} })).status !== 200, true, "reading only");
  console.log("ok - served to its owner only: the stored type, nosniff, private; anyone else's receipt answers 404");
}
// Reading the inbox again (a newer reader) keeps the pictures it has, without fetching them again, even ones that have gone since.
{
  const before = pictureCalls.length;
  liveDown = true;
  sqlite.prepare("UPDATE captured_receipts SET details = json_set(details, '$.parserVersion', ?) WHERE shopper_id = ?").run(PARSER_VERSION - 1, alice.id);
  const r = await call("/relay/my/gmail/scan", { method: "POST", token: alice.token, body: { full: true } }); assert.equal(r.status, 200); await alice.scan();
  const again = await alice.receipts();
  assert.deepEqual(byRef(again, "FW20418856").codes.map((c) => c.hasImage), [true], "the barcode kept when the email was first read is still there");
  assert.equal(codeRows(alice.id).length, 7);
  assert.deepEqual(pictureCalls.slice(before).map((c) => new URL(c.url).hostname), ["trans-qrcode-images-eu.objectstore.test"], "only the picture never kept is tried once more");
  liveDown = false;
  console.log("ok - a re-read keeps each code's picture and tries again only for one it never had");
}
// Tickets: one receipt, each ticket once, however many times it was sent again or forwarded.
{
  const carol = await newShopper();
  // The tickets sent again in July arrive in the inbox before Relay reaches April's order email (it reads newest first).
  carol.deliver([{ f: F.ticketOrder, daysAgo: 214 }, { f: F.ticketResends[0], daysAgo: 129 }, { f: F.ticketResends[1], daysAgo: 129 },
    { f: forwarded(F.ticketResends[0], "gmail"), daysAgo: 128 }, { f: forwarded(F.ticketOrder, "apple"), daysAgo: 213 }, { f: forwarded(F.ticketResends[1], "outlook"), daysAgo: 127 }]);
  await carol.scan();
  const mine = await carol.receipts(), order = mine.filter((r) => r.orderRef === "160104");
  assert.equal(order.length, 1, "one receipt for the order");
  assert.deepEqual(order[0].codes.map((c) => c.value).sort(), F.TICKETS, "each ticket once");
  assert.deepEqual(order[0].codes.map((c) => c.n), [1, 2, 3]);
  assert.ok(order[0].codes.every((c) => c.purpose === "ticket" && c.hasImage && c.day === "2026-07-18" && c.deadline === null));
  for (const c of order[0].codes) assert.equal((await call("/relay/my/receipts/" + order[0].id + "/codes/" + c.n, { token: carol.token })).status, 200);
  // More mail about the same order doesn't move the codes already there.
  const was = JSON.stringify(order[0].codes);
  const late = { ...F.ticketResends[0], id: "ticket-resend-late", headers: { ...F.ticketResends[0].headers, date: "Fri, 17 Jul 2026 08:00:00 +0000" } };
  carol.deliver([{ f: late, daysAgo: 1 }]); await carol.scan();
  assert.equal(JSON.stringify((await carol.receipts()).find((r) => r.orderRef === "160104").codes), was, "sent again once more: still three, in the same places");
  // Disconnecting the inbox takes its codes away.
  assert.ok(codeRows(carol.id).length >= 3);
  assert.equal((await call("/relay/my/gmail/disconnect", { method: "POST", token: carol.token, body: {} })).status, 200);
  assert.equal(codeRows(carol.id).length, 0, "disconnecting the inbox deletes its codes");
  console.log("ok - tickets: one receipt, each ticket's barcode once (sent again and forwarded copies don't double it), deleted with the inbox");
}
// A second inbox: only its own codes go when it is disconnected.
{
  const dan = await newShopper();
  dan.deliver([{ f: F.fellOrder, daysAgo: 23 }, { f: F.fellShipping, daysAgo: 20 }]);
  const second = await dan.connect(dan.id + "~2", "rt-dan-two");
  dan.deliver([{ f: F.raceOrder, daysAgo: 300 }, { f: F.racePack, daysAgo: 200 }], second);
  await dan.scan();
  for (let k = 0; k < 40 && codeRows(dan.id).length < 2; k++) await (await import("../worker/gmail.js")).runScanJobs(env, clock, fetchImpl, { busyWaitMs: 0 });
  assert.deepEqual(codeRows(dan.id).map((r) => r.purpose).sort(), ["collection", "in_store_return"]);
  assert.equal((await call("/relay/my/gmail/disconnect", { method: "POST", token: dan.token, body: { mailbox: 2 } })).status, 200);
  assert.deepEqual(codeRows(dan.id).map((r) => r.purpose), ["in_store_return"], "the other inbox's code stays");
  // Withdrawing permission deletes the rest.
  assert.equal((await call("/relay/my/consent/withdraw", { method: "POST", token: dan.token, body: {} })).status, 200);
  assert.equal(codeRows(dan.id).length, 0, "withdrawing permission deletes every code");
  console.log("ok - one inbox disconnected: only its codes go; permission withdrawn: all of them");
}
// Removing a receipt takes its codes with it, and they don't come back when the inbox is read again.
{
  list = await alice.receipts();
  const order = byRef(list, "FW20418856"), dropped = byRef(list, "FW20402516");
  const n = codeRows(alice.id).length;
  assert.equal((await call("/relay/my/receipts/" + order.id + "/dismiss", { method: "POST", token: alice.token, body: {} })).status, 200);
  assert.equal(codeRows(alice.id).length, n - 1, "the code its shipping email carried is deleted with the receipt");
  assert.equal((await call("/relay/my/receipts/" + order.id + "/codes/1", { token: alice.token })).status, 404);
  sqlite.prepare("UPDATE captured_receipts SET details = json_set(details, '$.parserVersion', ?) WHERE shopper_id = ? AND status != 'dismissed'").run(PARSER_VERSION - 1, alice.id);
  await call("/relay/my/gmail/scan", { method: "POST", token: alice.token, body: { full: true } }); await alice.scan();
  assert.equal(codeRows(alice.id).length, n - 1, "and is not kept again for an order the shopper removed");
  assert.equal(byRef(await alice.receipts(), "FW20402516").codes.length, 1, "other receipts keep theirs");
}
// Deleting the account deletes its codes.
{
  assert.ok(codeRows(alice.id).length > 0);
  assert.equal((await call("/relay/my/delete", { method: "POST", token: alice.token, body: {} })).status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_codes WHERE shopper_id = ?").get(alice.id).n, 0, "deleting the account deletes its codes");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_codes").get().n, 0, "nothing of anyone's is left");
  console.log("ok - a removed receipt's codes are deleted and not kept again; the account's codes go with the account");
}
console.log("PASS codes to show or scan: found only where the email says what they're for, the picture kept once, joined by order number, shown to the owner only, deleted with the mail data");
