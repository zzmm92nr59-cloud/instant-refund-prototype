// Offline test (real SQLite; Gmail, Outlook and Resend are stand-ins): "Send this email to Relay" (worker/shared-emails.js).
// A shopper sees exactly what would be sent (the email's text with personal details hidden), sends it with a note, and can
// delete it; only their own receipts that came from an inbox; limits; it's kept encrypted for 30 days and goes sooner when the
// receipt is removed, the inbox disconnected, permission withdrawn or the account deleted; it's in Download my data; only
// admins can read it, each opening recorded, never told who sent it; the health page counts what's waiting. People, shops and
// emails are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, sealToken } from "../worker/gmail.js";
import { hideDetails, namesToHide, tidySharedEmails, SHARE_DAYS, SHARES_PER_DAY } from "../worker/shared-emails.js";
import { runHealthEmails } from "../worker/health-digest.js";

// Hiding personal details.
{
  const text = [
    "Hi Jess,", "Thank You For Your Order", "Your order #1001 from Brindle & Co is confirmed.", "Amazon order 202-1234567-1234567",
    "View your order: https://brindle.example/account/orders/1001?token=abcDEF123456ghiJKL789",
    "Questions? Email help@brindle.example or call 0800 123 4567 or +44 20 7946 0958.",
    "Paid with Visa ending 4242. Card 4111 1111 1111 1111.", "Gift card code: ABCD-1234-EFGH-5678 applied. Promo code SUMMER10 saved you £5.00.",
    "Delivery address", "Jess Smith", "12 High Street", "London", "SW1A 1AA", "", "Payment method: Visa",
    "Billing address: 12 High Street, London SW1A 1AA", "Name: Jess Smith", "Merino Wool Scarf x1 £35.00", "Total £45.00",
    "Tracking 1Z999AA10123456784. Thanks Jess! See you soon, Will. We will be in touch.", "Collect from: Brindle, EC1A 1BB"].join("\n");
  const { text: out, hidden } = hideDetails(text, namesToHide("Jess Smith", ["jess.private@example.com"]));
  for (const gone of ["Jess", "Smith", "12 High Street", "SW1A 1AA", "EC1A 1BB", "help@brindle", "0800 123 4567", "7946", "4111", "ABCD-1234", "SUMMER10", "token=", "1Z999AA"])
    assert.ok(!out.includes(gone), "hidden: " + gone + "\n" + out);
  for (const kept of ["Hi [name],", "Thank You For Your Order", "#1001", "Brindle & Co", "202-1234567-1234567", "View your order: [link]", "Visa ending 4242",
    "Delivery address\n[address]", "Payment method: Visa", "Billing address: [address]", "Name: [name]", "Merino Wool Scarf x1 £35.00", "Total £45.00",
    "See you soon, Will. We will be in touch.", "Collect from: [address]"])
    assert.ok(out.includes(kept), "kept: " + kept + "\n" + out);
  assert.deepEqual(hidden, { links: 1, emails: 1, phones: 2, numbers: 1, codes: 3, postcodes: 0, addresses: 3, names: 3 });
  assert.equal(hideDetails("We will dispatch it. Will Jones ordered. WILL", namesToHide("Will Jones")).text, "We will dispatch it. [name] [name] ordered. [name]",
    "a name that's also a word is hidden only as a name");
  console.log("ok - links, email addresses, phone numbers, card numbers, codes, postcodes, addresses and the shopper's name are hidden; the rest stays readable");
}

// Addresses with no heading above them are found by their postcode: in an item row's own cell, under "Billed to" after the
// card line, as lines above a postcode on its own, and inside a sentence. Item names, prices and dates stay.
{
  const rows = hideDetails([
    "| | Qty | Item | Delivery Address", "1 | Cover Plan Monthly KT55 | 4 Sample Road Leeds LS1 4DY |", "| £ 2.49 |",
    "1 | Garden Chair Set GC20 | 4 Sample Road Leeds LS1 4DY | By 09/01/2026 | £ 89.00 |", "| Sub Total | £ 91.49 |"].join("\n")).text;
  for (const gone of ["Sample Road", "LS1 4DY"]) assert.ok(!rows.includes(gone), "hidden: " + gone + "\n" + rows);
  for (const kept of ["1 | Cover Plan Monthly KT55 | [address] |", "1 | Garden Chair Set GC20 | [address] | By 09/01/2026 | £ 89.00 |", "| £ 2.49 |", "| Sub Total | £ 91.49 |"])
    assert.ok(rows.includes(kept), "kept: " + kept + "\n" + rows);

  const billed = hideDetails(["BILLED TO", "Visa •••• 4242", "Sam Sample", "7 Example Lane", "Sampleton", "M1 1AE", "United Kingdom", "",
    "App Store", "Tile Puzzle", "500 Gems", "£1.99"].join("\n")).text;
  for (const gone of ["Sam Sample", "7 Example Lane", "Sampleton", "M1 1AE"]) assert.ok(!billed.includes(gone), "hidden: " + gone + "\n" + billed);
  for (const kept of ["BILLED TO\nVisa •••• 4242\n[address]", "Tile Puzzle", "500 Gems", "£1.99"]) assert.ok(billed.includes(kept), "kept: " + kept + "\n" + billed);

  const lines = hideDetails(["Your order is on its way", "", "Sam Sample", "7 Example Lane", "Sampleton", "M1 1AE", "",
    "We'll deliver to 7 Example Lane, Sampleton M1 1AE on Friday between 7am and 9pm, and send a text before we arrive.",
    "Oak Desk Lamp £24.00", "Size M1 2XL tee £12.00"].join("\n"));
  for (const gone of ["Sam Sample", "Example Lane", "Sampleton", "M1 1AE", "M1 2XL"]) assert.ok(!lines.text.includes(gone), "hidden: " + gone + "\n" + lines.text);
  for (const kept of ["Your order is on its way\n\n[address]\n", "We'll deliver to [address] on Friday between 7am and 9pm", "Oak Desk Lamp £24.00", "Size [postcode] tee £12.00"])
    assert.ok(lines.text.includes(kept), "kept: " + kept + "\n" + lines.text);
  assert.equal(lines.hidden.addresses, 2); assert.equal(lines.hidden.postcodes, 1);
  const town = hideDetails(["Sam Sample", "7 Example Lane", "Sampleton M1 1AE", "", "| Tee Size M1 2XL | £12.00 |", "Thanks for your order", "Tee Size M1 2XL"].join("\n")).text;
  assert.equal(town, ["[address]", "", "| Tee Size [postcode] | £12.00 |", "Thanks for your order", "Tee Size [postcode]"].join("\n"), "a town before the postcode, under a street line, is an address; a size isn't");
  console.log("ok - addresses without a heading (in an item row, after a card line, above a postcode, inside a sentence) are hidden; item names and prices stay");
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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", RELAY_ADMIN_EMAILS: "ops@example.com",
  GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test", MICROSOFT_CLIENT_ID: "ms-client", MICROSOFT_CLIENT_SECRET: "ms-secret" };
const MAIL = (to) => [
  "From: Brindle & Co <orders@brindle.example>", "To: Jess Private <" + to + ">", "Subject: Jess, your Brindle order #1001", "Date: Mon, 12 Oct 2026 10:00:00 +0000",
  "Received: from mail.brindle.example (10.1.2.3)", "Content-Type: multipart/alternative; boundary=\"b1\"", "", "--b1", "Content-Type: text/plain; charset=utf-8", "",
  "Hi Jess, order #1001", "--b1", "Content-Type: text/html; charset=utf-8", "",
  "<html><body><p>Hi Jess,</p><p>Thanks for your order #1001.</p><table><tr><td>Merino Wool Scarf</td><td>£35.00</td></tr><tr><td>Gift Box</td><td>£10.00</td></tr></table>" +
  "<p>Total £45.00</p><p>Delivery address</p><p>Jess Private<br>12 High Street<br>London<br>SW1A 1AA</p><p><a href=\"https://brindle.example/o/1001?k=SECRETTOKEN123456789\">View order</a></p>" +
  "<img src=\"https://brindle.example/track.gif?u=jess\"></body></html>", "--b1--", ""].join("\r\n");
const gmail = { m1abcdef: MAIL("jess.private@example.com"), m2abcdef: MAIL("jess.private@example.com").replace("#1001", "#1002") };
const outlookId = "AAMkAGI2THVSAAA=" + "x".repeat(20);
let gmailUp = true;
let emails = [];
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "access-gmail" });
  if (url === "https://login.microsoftonline.com/consumers/oauth2/v2.0/token") return Response.json({ access_token: "access-outlook" });
  const g = /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([A-Za-z0-9]+)\?format=raw$/.exec(url);
  if (g) {
    if (!gmailUp) return new Response("{}", { status: 503 });
    return gmail[g[1]] ? Response.json({ raw: Buffer.from(gmail[g[1]]).toString("base64url") }) : new Response("{}", { status: 404 });
  }
  if (url === "https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(outlookId) + "/$value") return new Response(MAIL("jess.other@outlook.example").replace("#1001", "#2001"));
  if (url === "https://oauth2.googleapis.com/revoke") return new Response("{}");
  return new Response("{}", { status: 404 });
};
let clock = Date.UTC(2026, 10, 5, 9);
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const jess = await signIn("jess.private@example.com", "5.5.5.1");
const sam = await signIn("sam@example.com", "5.5.5.2");
const ops = await signIn("ops@example.com", "5.5.5.3");
const J = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("jess.private@example.com").id;
const S = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("sam@example.com").id;
for (const t of [jess, sam]) assert.equal((await call("/relay/my/consent", { method: "POST", token: t, body: { version: CONSENT_VERSION } })).status, 200);
await call("/relay/my/receipts", { token: jess }); // makes the receipt and inbox tables
await call("/relay/my/profile", { method: "POST", token: jess, body: { name: "Jess Private" } });
// Jess's Gmail, and her Outlook as a second inbox; Sam's Gmail.
const box = async (id, address, provider) => { const s = await sealToken(env, "refresh-" + id);
  sqlite.prepare("INSERT INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at, provider) VALUES (?,?,?,?,?,?)").run(id, address, s.iv, s.data, clock, provider); };
await box(J, "jess.private@example.com", null); await box(J + "~2", "jess.other@outlook.example", "microsoft"); await box(S, "sam@example.com", null);
const R1 = "11111111-1111-4111-8111-111111111111", R2 = "22222222-2222-4222-8222-222222222222", R3 = "33333333-3333-4333-8333-333333333333",
  R4 = "44444444-4444-4444-8444-444444444444", R5 = "55555555-5555-4555-8555-555555555555";
const receipt = (id, who, ref, details) => sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)")
  .run(id, who, ref, "pending", JSON.stringify({ kind: "receipt", retailer: { name: "Brindle & Co", domain: "brindle.example" }, orderRef: "#1001", orderDate: "2026-10-12",
    totalPence: null, currency: "GBP", confidence: "low", parserVersion: 26, items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 3500 }], ...details }), clock - 864e5);
receipt(R1, J, "r1", { gmailId: "m1abcdef" });
receipt(R2, J, "r2", { pasted: true, orderRef: "#3001" });
receipt(R3, J, "r3", { outlookId, mailbox: 2, orderRef: "#2001" });
receipt(R4, S, "r4", { gmailId: "m1abcdef" });
receipt(R5, J, "r5", { gmailId: "m2abcdef", orderRef: "#1002" });
const share = (id, token, body) => call("/relay/my/receipts/" + id + "/share", body ? { method: "POST", token, body } : { token });

// 1. What would be sent, before anything is.
let r = await share(R1, jess);
assert.equal(r.status, 200);
let p = await r.json();
assert.equal(p.subject, "[name], your Brindle order #1001");
assert.equal(p.from, "Brindle & Co <[email]>");
assert.match(p.text, /Merino Wool Scarf \| £35\.00/); assert.match(p.text, /Total £45\.00/); assert.match(p.text, /Delivery address\n\[address\]/);
for (const gone of ["Jess", "Private", "12 High Street", "SW1A", "SECRETTOKEN", "track.gif", "10.1.2.3", "jess.private", "Received"]) assert.ok(!JSON.stringify(p).includes(gone), "not in the preview: " + gone);
assert.equal(p.sent, null); assert.equal(p.keptDays, SHARE_DAYS);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shared_emails").get().n, 0, "looking first keeps nothing");
console.log("ok - the shopper sees exactly what would be sent first, with their details hidden, and nothing is kept until they send it");

// 2. Sending: what was shown, with their note, encrypted; the receipt says so.
r = await share(R1, jess, { note: "The total was missed" });
assert.equal(r.status, 200);
const sent = (await r.json()).sent;
assert.equal(sent.until, new Date(clock + SHARE_DAYS * 864e5).toISOString());
const row = sqlite.prepare("SELECT * FROM shared_emails WHERE receipt_id = ?").get(R1);
assert.equal(row.shopper_id, J); assert.equal(row.domain, "brindle.example"); assert.equal(row.reader, 26);
for (const plain of ["Merino", "missed", "Brindle & Co", "#1001"]) assert.ok(!row.data.includes(plain), "kept encrypted: " + plain);
const card = (await (await call("/relay/my/receipts?all=1", { token: jess })).json()).receipts.find((c) => c.id === R1);
assert.deepEqual(card.shared, { at: sent.at, until: sent.until, read: false });
assert.deepEqual((await (await share(R1, jess)).json()).sent, { at: sent.at, until: sent.until }, "the preview says it was sent");
// From the second inbox (Outlook): read from that inbox.
r = await share(R3, jess, {});
assert.equal(r.status, 200);
console.log("ok - sending keeps that copy, encrypted, with the note; the receipt shows it was sent; Gmail and Outlook both");

// 3. Only their own receipts, from an inbox, and plain answers when it can't be done.
assert.equal((await share(R1, sam)).status, 404, "Sam can't see Jess's email");
assert.equal((await share(R1, sam, {})).status, 404, "or send it");
assert.equal((await share(R1, null)).status, 401);
assert.equal((await share(R2, jess)).status, 409, "a receipt pasted in has no email to send");
gmailUp = false; assert.equal((await share(R5, jess)).status, 502); gmailUp = true;
delete gmail.m2abcdef; assert.equal((await share(R5, jess)).status, 404, "the email is no longer in the inbox");
assert.equal((await share(R1, jess, { note: "x".repeat(301) })).status, 400, "a note of 300 characters at most");
assert.equal((await share(R1, jess, { to: "someone@example.com" })).status, 400, "nothing else can be sent with it");
console.log("ok - only the shopper's own receipts from an inbox; clear answers when the email can't be read");

// 4. Relay's admins: a list without the text, then one email, recorded; never who sent it.
assert.equal((await call("/relay/my/admin/shared-emails", { token: jess })).status, 404, "shoppers can't list them");
let list = await (await call("/relay/my/admin/shared-emails", { token: ops })).json();
assert.equal(list.emails.length, 2);
const one = list.emails.find((e) => e.note === "The total was missed");
assert.deepEqual([one.shop, one.domain, one.reader, one.lookedAt, one.read.totalPence, one.read.orderRef], ["Brindle & Co", "brindle.example", 26, null, null, "#1001"]);
assert.ok(!("text" in one), "the list has no email text");
for (const who of [J, "jess.private", "Jess"]) assert.ok(!JSON.stringify(list).includes(who), "admins never see who sent it: " + who);
assert.equal((await call("/relay/my/admin/shared-emails/" + one.id, { token: sam })).status, 404, "only admins can read one");
r = await call("/relay/my/admin/shared-emails/" + one.id, { token: ops });
assert.equal(r.status, 200);
const full = await r.json();
assert.match(full.text, /Total £45\.00/); assert.equal(full.subject, "[name], your Brindle order #1001");
assert.ok(!JSON.stringify(full).includes(J), "not who sent it");
const audit = sqlite.prepare("SELECT actor_id, event_type, subject_id FROM audit_events WHERE event_type = 'shared_email_opened'").all();
assert.deepEqual(audit.map((a) => ({ ...a })), [{ actor_id: sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("ops@example.com").id, event_type: "shared_email_opened", subject_id: one.id }], "each opening recorded");
assert.equal((await (await call("/relay/my/receipts?all=1", { token: jess })).json()).receipts.find((c) => c.id === R1).shared.read, true, "the shopper can see it's been read");
console.log("ok - admins only: a list without the text, then one email, each opening recorded, never who sent it");

// 5. The health page counts them, and the morning email says when some are waiting.
let h = await (await call("/relay/my/admin/health", { token: ops })).json();
assert.deepEqual(h.sharedEmails, { kept: 2, waiting: 1, thisWeek: 2, people: 1, keptDays: SHARE_DAYS });
emails = [];
await runHealthEmails(env, clock, fetchImpl);
const morning = emails.find((e) => /this morning/.test(e.subject));
assert.match(morning.text, /- 1 email that shoppers sent to Relay is waiting to be read\./);
assert.ok(!JSON.stringify(morning).includes("Merino") && !JSON.stringify(morning).includes("Brindle"), "counts only");
console.log("ok - the health page counts them, and the morning email says when one is waiting");

// 6. Download my data has it; Jess deletes one; an admin deletes one.
const exp = await (await call("/relay/my/export", { token: jess })).json();
assert.equal(exp.emailsSentToRelay.length, 2);
const mine = exp.emailsSentToRelay.find((e) => e.receiptId === R1);
assert.equal(mine.note, "The total was missed"); assert.match(mine.text, /Total £45\.00/); assert.ok(mine.readByRelay);
assert.equal((await share(R3, jess, { delete: true })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shared_emails WHERE receipt_id = ?").get(R3).n, 0);
assert.equal((await call("/relay/my/admin/shared-emails/" + one.id, { method: "POST", token: ops, body: {} })).status, 400);
assert.equal((await call("/relay/my/admin/shared-emails/" + one.id, { method: "POST", token: ops, body: { delete: true } })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shared_emails").get().n, 0);
console.log("ok - in Download my data; the shopper or an admin can delete it at any time");

// 7. Limits: a few a day, and a few kept at once.
for (let i = 0; i < SHARES_PER_DAY; i++) {
  const id = "66666666-6666-4666-8666-" + String(i).padStart(12, "0");
  receipt(id, J, "x" + i, { gmailId: "m1abcdef" });
  assert.equal((await share(id, jess, {})).status, 200);
}
assert.equal((await share(R1, jess, {})).status, 429, SHARES_PER_DAY + " a day");
clock += 864e5 + 1000;
assert.equal((await share(R1, jess, {})).status, 200, "the next day");
console.log("ok - limits: " + SHARES_PER_DAY + " a day");

// 8. It goes after 30 days, or with the receipt, the inbox, the permission or the account.
const count = () => sqlite.prepare("SELECT COUNT(*) AS n FROM shared_emails WHERE shopper_id = ?").get(J).n;
assert.equal((await call("/relay/my/receipts/" + R1 + "/dismiss", { method: "POST", token: jess, body: {} })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shared_emails WHERE receipt_id = ?").get(R1).n, 0, "removing the receipt removes what was sent");
const before = count();
clock += SHARE_DAYS * 864e5;
assert.equal(await tidySharedEmails(env, clock), before, "after 30 days they're deleted");
assert.equal(count(), 0);
// Disconnecting the inbox an email came from deletes it (the other inbox's stays); withdrawing permission deletes them all.
const send = async (id, ref, details, token = jess, who = J) => { receipt(id, who, ref, details); assert.equal((await share(id, token, {})).status, 200); };
await send("77777777-7777-4777-8777-777777777777", "y1", { gmailId: "m1abcdef" });
await send("78787878-7878-4787-8787-787878787878", "y2", { outlookId, mailbox: 2, orderRef: "#2001" });
assert.equal(count(), 2);
assert.equal((await call("/relay/my/gmail/disconnect", { method: "POST", token: jess, body: { mailbox: 2 } })).status, 200);
assert.deepEqual(sqlite.prepare("SELECT receipt_id FROM shared_emails WHERE shopper_id = ?").all(J).map((x) => x.receipt_id), ["77777777-7777-4777-8777-777777777777"],
  "disconnecting the Outlook inbox deletes only what was sent from it");
assert.equal((await call("/relay/my/consent/withdraw", { method: "POST", token: jess, body: {} })).status, 200);
assert.equal(count(), 0, "withdrawing permission deletes everything sent");
// Deleting the account deletes what was sent.
await send("79797979-7979-4797-8797-797979797979", "z1", { gmailId: "m1abcdef" }, sam, S);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shared_emails WHERE shopper_id = ?").get(S).n, 1);
assert.equal((await call("/relay/my/delete", { method: "POST", token: sam, body: {} })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shared_emails WHERE shopper_id = ?").get(S).n, 0, "deleting the account deletes it");
console.log("ok - deleted after " + SHARE_DAYS + " days, and with the receipt, the inbox, the permission or the account");
console.log("PASS send this email to Relay: preview first, details hidden, encrypted, own receipts only, admins only and recorded, limits, deleted on time");
