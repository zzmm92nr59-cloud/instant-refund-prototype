// The mailbox side of the readers' review of 25 Nov 2026 (FAKE Google and Gmail, a real SQLite database, made-up emails;
// nothing leaves this machine). Each part failed against the code as it was, then the code was fixed; the tests stay.
//   1. Two shops with the same order number: a return email, and hiding an order, stay with their own shop (H6).
//   2. One email that Cloudflare keeps ending the 15-minute check on never stalls everyone else's mail (H5), and an inbox
//      that has to be connected again doesn't take the others' places (M11).
//   3. Withdrawing permission deletes the shopper's "same order" choices too (M9).
//   node scripts/test-receipt-review-mailbox.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { realInbox } from "./real-receipts.mjs";
import { CONSENT_VERSION, sealToken, autoScanGmail, PARSER_VERSION, ensureGmailTables } from "../worker/gmail.js";

const DAY = 864e5;
const mail = (from, subject, date, body) => `From: ${from}\r\nTo: Sam Taylor <sam.taylor@example.co.uk>\r\nSubject: ${subject}\r\nDate: ${date}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;

// ---- 1. Two shops, one order number ----------------------------------------------------------------------------------
{
  const box = await realInbox({ now: Date.UTC(2026, 10, 24, 12) }).start();
  const LARK = "Larkspur Candles <orders@larkspurcandles.example>", FERN = "Fernhill Ceramics <orders@fernhillceramics.example>";
  box.deliver(mail(LARK, "Your order #1042 is confirmed", "Mon, 2 Nov 2026 10:00:00 +0000", "Thanks for your order, Sam.\n\nOrder number: 1042\nOrder date: 2 November 2026\n\nFig Leaf Candle - Qty 1 - £24.00\n\nOrder total: £24.00\n"));
  box.deliver(mail(FERN, "Your order #1042 is confirmed", "Thu, 5 Nov 2026 10:00:00 +0000", "Thanks for your order, Sam.\n\nOrder number: 1042\nOrder date: 5 November 2026\n\nStoneware Mug - Qty 2 - £18.00\n\nOrder total: £36.00\n"));
  box.deliver(mail("Fernhill Ceramics <returns@fernhillceramics.example>", "Thanks for your return request", "Fri, 20 Nov 2026 10:00:00 +0000",
    "Thanks for your return request.\n\nReturn ID: FR-55120\nOrder number: 1042\n\nPlease send it back no later than 4 December 2026.\n\nTracking number: KO123456789GB\n"));
  await box.scan();
  const list = await box.receipts();
  const cards = list.receipts || list.cards || list;
  const of = (shop) => cards.find((c) => c.retailer && /^(?:Larkspur|Fernhill)/.exec(c.retailer.name || "") && c.retailer.name.startsWith(shop));
  const lark = of("Larkspur"), fern = of("Fernhill");
  assert.ok(lark && fern, "both orders numbered 1042 are on the list: " + cards.map((c) => c.retailer && c.retailer.name).join(", "));
  assert.equal(lark.returnPlan || null, null, "Fernhill's return email is not put on Larkspur's order 1042");
  assert.equal(lark.returnTracking || null, null, "so Larkspur's order shows no return started");
  assert.ok(fern.returnPlan && fern.returnPlan.deadline === "2026-12-04", "it is on Fernhill's own order, with its deadline");
  assert.equal(fern.returnTracking && fern.returnTracking.state, "started");
  // Hiding Larkspur's order 1042 hides only that one.
  const hid = await box.call("/relay/my/receipts/" + lark.id + "/dismiss", { method: "POST" });
  assert.equal(hid.status, 200);
  const after = await box.receipts();
  const left = (after.receipts || after.cards || after).filter((c) => c.orderRef === "1042");
  assert.deepEqual(left.map((c) => c.retailer.name), ["Fernhill Ceramics"], "hiding one shop's order 1042 leaves the other shop's order 1042 on the list");
  assert.ok(left[0].returnPlan, "with its return");
  console.log("ok - two shops' order 1042: the return email stays with its own shop's order, and hiding one order hides only that order");
}

// ---- 2. A mailbox the 15-minute check keeps being ended on ------------------------------------------------------------
const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
  async first() { return sqlite.prepare(sql).get(...args) ?? null; },
  async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  _exec() { sqlite.prepare(sql).run(...args); }
});
const db = { prepare: (sql) => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { for (const s of list) s._exec(); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test" };
let clock = Date.UTC(2026, 10, 24, 12);
await ensureGmailTables(db);
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "/");
// Five shoppers, each with one Gmail inbox and one order email from yesterday. Shopper "poison" has an email the round is
// ended on every time it is read (Cloudflare ends a Worker that runs too long; nothing after that point runs).
const people = ["poison", "amy", "ben", "cal", "dee"], ended = { count: 0 }, reads = new Map(), revoked = new Set(), tokenAsked = [];
for (const [k, who] of people.entries()) {
  sqlite.prepare("INSERT INTO shopper_consents (shopper_id, version, text_hash, accepted_at) VALUES (?,?,?,?)").run(who, CONSENT_VERSION, "h", clock - 10 * DAY);
  const s = await sealToken(env, "rt-" + who);
  // (Each read before, so the check only looks at recent mail.)
  sqlite.prepare("INSERT INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at, last_scan_at) VALUES (?,?,?,?,?,?)").run(who, who + "@example.co.uk", s.iv, s.data, clock - 10 * DAY, clock - DAY);
}
const inbox = (who) => ({ [who + "1abcdef"]: mail("Kestrel Outdoor <orders@kestreloutdoor.example>", "Your order #KO-" + who + " is confirmed", new Date(clock - DAY).toUTCString(),
  "Order number: KO-" + who.toUpperCase() + "1\nOrder date: 23 November 2026\nTrail Flask - Qty 1 - £12.50\nOrder total: £12.50\n") });
const boxes = Object.fromEntries(people.map((w) => [w, inbox(w)]));
boxes.poison["poison2abcdef"] = mail("Kestrel Outdoor <orders@kestreloutdoor.example>", "Your order #KO-BAD is confirmed", new Date(clock - DAY).toUTCString(), "Order number: KO-BAD1\nTotal £1.00\n");
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url === "https://oauth2.googleapis.com/token") {
    const p = new URLSearchParams(String(init.body)), who = String(p.get("refresh_token")).slice(3);
    tokenAsked.push(who);
    // (Google's answer when the shopper took Relay's access away.)
    if (revoked.has(who)) return Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 });
    return Response.json({ access_token: "acc-" + who });
  }
  const who = String((init.headers && init.headers.Authorization) || "").replace("Bearer acc-", "");
  const mine = boxes[who] || {};
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) return Response.json({ messages: Object.keys(mine).map((id) => ({ id })) });
  const one = /messages\/([A-Za-z0-9]+)\?format=raw$/.exec(url);
  if (one && mine[one[1]]) {
    reads.set(one[1], (reads.get(one[1]) || 0) + 1);
    if (one[1] === "poison2abcdef") { ended.count++; return new Promise(() => {}); }   // the round is ended here, for good
    return Response.json({ raw: Buffer.from(mine[one[1]]).toString("base64url") });
  }
  return new Response("{}", { status: 404 });
};
// Runs one 15-minute check the way Cloudflare does: it either finishes or is ended part-way (it never answers).
async function check() {
  const before = ended.count;
  let done = false;
  autoScanGmail(env, clock, fetchImpl).then(() => { done = true; });
  for (let i = 0; i < 400 && !done && ended.count === before; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 30));
  clock += 15 * 60 * 1000;
  return done ? "finished" : "ended";
}
const keptFor = (who) => sqlite.prepare("SELECT COUNT(*) AS n FROM captured_receipts WHERE shopper_id = ? AND status <> 'not_receipt'").get(who).n;
// (The poisoned inbox is first in the queue: it was connected first and none has been checked yet.)
const runs = [];
for (let i = 0; i < 9; i++) runs.push(await check());
for (const who of people.slice(1)) assert.equal(keptFor(who), 1, `${who}'s new order is read although the check is ended on another shopper's email (runs: ${runs.join(", ")})`);
assert.ok(ended.count <= 2, "the email that ends the check is tried twice at most, the second time on its own (" + ended.count + ")");
assert.equal(keptFor("poison"), 1, "the rest of that shopper's mail is still read");
const parked = sqlite.prepare("SELECT details FROM captured_receipts WHERE shopper_id = 'poison' AND status = 'not_receipt'").all().map((r) => JSON.parse(r.details));
assert.ok(parked.some((d) => d.unread && d.parserVersion === PARSER_VERSION), "and the email that ended it is kept as not read, so it is never tried again with this reader");
console.log(`ok - one email that the 15-minute check is ended on: everyone else's mail is read (${runs.join(", ")}), that email is tried ${ended.count} times then left out`);

// An inbox that has to be connected again is tried once a day, not in every check.
revoked.add("amy");
sqlite.prepare("UPDATE gmail_connections SET auto_at = 0 WHERE shopper_id = 'amy'").run();
const pick = async () => { tokenAsked.length = 0; await autoScanGmail(env, clock, fetchImpl); clock += 15 * 60 * 1000; return tokenAsked.slice(); };
assert.ok((await pick()).includes("amy"), "an inbox whose access has ended is tried");
assert.equal(sqlite.prepare("SELECT mail_problem AS p FROM gmail_connections WHERE shopper_id = 'amy'").get().p, "reconnect", "and marked as needing to be connected again");
for (let i = 0; i < 8; i++) assert.ok(!(await pick()).includes("amy"), "but not again in the next checks of the day (each one asked Google for a token for it)");
clock += DAY;
assert.ok((await pick()).includes("amy"), "a day later it is tried again, in case access is back");
console.log("ok - an inbox that has to be connected again is tried once a day, not in every check");

// ---- 3. Withdrawing permission deletes the "same order" choices ------------------------------------------------------
{
  const box = await realInbox({ now: Date.UTC(2026, 10, 24, 12) }).start();
  box.deliver(mail("Kestrel Outdoor <orders@kestreloutdoor.example>", "Your order #KO-2001 is confirmed", "Mon, 2 Nov 2026 10:00:00 +0000", "Order number: KO-2001\nOrder date: 2 November 2026\nTrail Flask - Qty 1 - £12.50\nOrder total: £12.50\n"));
  box.deliver(mail("Kestrel Outdoor <orders@kestreloutdoor.example>", "Your order #KO-2002 is confirmed", "Tue, 3 Nov 2026 10:00:00 +0000", "Order number: KO-2002\nOrder date: 3 November 2026\nWool Hat - Qty 1 - £15.00\nOrder total: £15.00\n"));
  await box.scan();
  const ids = box.stored().filter((r) => r.details.kind === "receipt").map((r) => r.id);
  const j = await box.call("/relay/my/receipts/" + ids[0] + "/join", { method: "POST", body: { action: "same", with: ids[1] } });
  assert.equal(j.status, 200, "joined: " + JSON.stringify(j.body));
  assert.equal(box.sql("SELECT COUNT(*) AS n FROM receipt_joins")[0].n, 1, "the shopper's 'same order' is kept");
  const w = await box.call("/relay/my/consent/withdraw", { method: "POST" });
  assert.equal(w.status, 200, "withdrawn: " + JSON.stringify(w.body));
  assert.equal(box.stored().length, 0, "the emails' readings are gone");
  assert.equal(box.sql("SELECT COUNT(*) AS n FROM receipt_joins")[0].n, 0, "and the 'same order' choice, which holds the emails' ids and the shop's address");
  console.log("ok - withdrawing permission deletes the shopper's same-order choices too");
}
console.log("PASS readers' review, mailbox side: return emails and hidden orders stay with their own shop, one email can't stall everyone's mail, dead inboxes wait their turn, withdrawing deletes everything");
