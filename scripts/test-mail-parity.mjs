// Gmail and Outlook must give a shopper the same receipts. The same shop emails go into a fake Gmail mailbox and a fake
// Outlook mailbox, each in the form that service hands an email over: Gmail as the raw email the shop sent; Outlook as
// Exchange writes it out again (CRLF lines, base64 parts, encoded sender names, Microsoft's own headers, a Western European
// character set for one email, and every link wrapped by Safe Links, as a Microsoft 365 mailbox does). Both mailboxes are
// read with Relay's real scan. The receipt cards (shops, logos, items, totals, categories, deliveries and return plans),
// Wrapped, and what is left out (a newsletter; a fake order in Junk, which Gmail would have put in Spam) must be the same.
// Google and Microsoft are FAKED: this proves Relay reads both the same way, not that the real services send these exact bytes.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, saveConnection } from "../worker/gmail.js";

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
  GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test",
  MICROSOFT_CLIENT_ID: "11111111-2222-3333-4444-555555555555", MICROSOFT_CLIENT_SECRET: "ms-secret-test" };

const DAY = 864e5;
const clock = Date.now();
const at = days => clock - days * DAY;
const longDate = ms => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const p = lines => lines.map(l => "<p>" + l + "</p>").join("\n");

// ---- The emails (made-up orders from real-sounding shops). html is what the shop wrote; text is its plain-text part. ----
const mails = [
  { key: "lulu", fromName: "lululemon", from: "orders@e.lululemon.com", subject: "Thank you for your order", days: 20,
    html: `<html><body><a href="https://shop.lululemon.com/"><img src="https://images.lululemon.test/logo.png" alt="lululemon"></a>` + p([
      "Thank you for your order, Sam!", "Order number: 1234567890", "Order date: " + longDate(at(20)),
      "Align High-Rise Pant 25&quot; - Qty 1 - &pound;98.00", "Define Jacket Nulu - Qty 1 - &pound;118.00", "Order total: &pound;216.00",
      "Tracking number: AB123456789GB", "You have 30 days to return unworn items with the tags on.",
      '<a href="https://shop.lululemon.com/returns">Start a return</a> · <a href="https://shop.lululemon.com/account">Your account</a> · <a href="https://shop.lululemon.com/help">Help</a>',
      "© 2026 lululemon athletica"]) + "</body></html>" },
  { key: "lulu-return", fromName: "lululemon", from: "orders@e.lululemon.com", subject: "Thanks for your return request", days: 12,
    text: "Thanks for your return request.\nReturn ID: RT-5551234\nOrder number: 1234567890\nDrop your parcel at any Evri ParcelShop and show the QR code.\n" +
      "Send it back no later than " + longDate(at(-14)) + ".\nEstimated refund: £98.00\n" },
  { key: "royalmail", fromName: "Royal Mail", from: "no-reply@royalmail.com", subject: "Your parcel has been delivered", days: 17,
    text: "Your parcel from lululemon has been delivered today, " + longDate(at(17)) + ".\nTracking number: AB123456789GB\n" },
  { key: "shopify", fromName: "Northwind Trainers", from: "store+12345@t.shopifyemail.com", subject: "Order #1042 confirmed", days: 30,
    html: p(["Thank you for your purchase!", "Order #1042", "Order date: " + longDate(at(30)), "Retro Runner × 1 &pound;85.00", "Subtotal &pound;85.00", "Total &pound;85.00 GBP",
      '<a href="https://northwind-trainers.test/account">View your order</a> · <a href="https://northwind-trainers.test/">Visit our store</a>',
      "Returns accepted within 30 days of delivery.", "Thanks for shopping with Northwind Trainers."]) },
  { key: "stripe", fromName: "Anthropic, PBC", from: "invoice+statements+acct_1abc@stripe.com", subject: "Your receipt from Anthropic, PBC #2734-1234", days: 40,
    html: p(["Receipt from Anthropic, PBC", "Receipt #2734-1234", "Date paid " + longDate(at(40)), "Claude Pro - Qty 1 - &pound;18.00", "Total &pound;18.00", "Amount paid &pound;18.00"]) },
  { key: "hide-my-email", fromName: "ASOS", from: "info_at_asos_com_ab12cd@privaterelay.appleid.com", subject: "Thanks for your order", days: 25,
    text: "Thanks for your order!\nOrder No.: 987654321\nOrder date: " + longDate(at(25)) + "\nOversized T-Shirt - Qty 1 - £14.00\nDelivery £4.50\nTotal: £18.50\nFree returns within 28 days.\n" },
  // Forwarded from another mailbox, by Outlook (rule, From/Sent/To/Subject) and by Gmail (as HTML, with &lt; &gt; round the address).
  { key: "fw-outlook", fromName: "Sam Tester", from: "sam.tester@hotmail.co.uk", subject: "FW: Your Ted Baker order", days: 15,
    text: "Get Outlook for iOS<https://aka.ms/o0ukef>\n________________________________\nFrom: Ted Baker <orders@tedbaker.com<mailto:orders@tedbaker.com>>\n" +
      "Sent: " + longDate(at(16)) + " 10:15\nTo: Sam Tester <sam.tester@hotmail.co.uk>\nSubject: Your Ted Baker order\n\nThank you for your order\nOrder number: TB-55123\n" +
      "Order date: " + longDate(at(16)) + "\nCotton Oxford Shirt - Qty 1 - £89.00\nOrder total: £89.00\nYou can return items within 28 days.\n" },
  { key: "fw-gmail", fromName: "Sam Tester", from: "sam.tester@gmail.com", subject: "Fwd: Your Nike order", days: 8,
    html: '<div dir="ltr"><br><div class="gmail_quote"><div class="gmail_attr">---------- Forwarded message ---------<br>From: <strong class="gmail_sendername" dir="auto">Nike</strong> ' +
      '<span dir="auto">&lt;<a href="mailto:nike@official.nike.com">nike@official.nike.com</a>&gt;</span><br>Date: ' + longDate(at(9)) + '<br>Subject: Your Nike order<br>To: &lt;sam.tester@gmail.com&gt;<br></div><br>' +
      p(["Thanks for your order", "Order number: C01234567890", "Order date: " + longDate(at(9)), "Air Max 90 - Qty 1 - &pound;104.99", "Order total: &pound;104.99", "Returns are free within 30 days."]) + "</div></div>" },
  // A café receipt Outlook hands over in windows-1252 ("£" and "é" are single bytes there).
  { key: "cafe", fromName: "Café Lumière", from: "hello@cafelumiere.test", subject: "Your Café Lumière receipt", days: 5, charset: "windows-1252",
    text: "Your receipt\nOrder number: CL-4411\nOrder date: " + longDate(at(5)) + "\nFlat white - Qty 1 - £3.40\nAlmond croissant - Qty 1 - £2.90\nTotal: £6.30\nMerci, Café Lumière\n" },
  { key: "lner", fromName: "LNER", from: "noreply@lner.co.uk", subject: "Your LNER booking confirmation", days: 50,
    text: "Your booking is confirmed\nBooking reference: ABC12345\nOrder number: LN-778812\nOrder date: " + longDate(at(50)) + "\nLondon Kings Cross to York - Qty 1 - £56.20\nTotal paid: £56.20\n" },
  { key: "newsletter", fromName: "Northwind Trainers", from: "news@northwind-trainers.test", subject: "50% off this weekend", days: 3,
    text: "Trainers from £19.99. Sale ends Sunday.\n" },
];
// In Junk Email (Outlook) / Spam (Gmail never lists it): never a receipt.
const junk = { key: "junk", fromName: "Parcel Team", from: "orders@deliveries-scam.test", subject: "Your order confirmation #SC-1", days: 4,
  text: "Order number: SC-1\nOrder date: " + longDate(at(4)) + "\nGift card - Qty 1 - £50.00\nOrder total: £50.00\n" };

// ---- How each service hands an email over ----
const CRLF = "\r\n";
const b64lines = buf => buf.toString("base64").match(/.{1,76}/g).join(CRLF);
const hex = b => "=" + b.toString(16).toUpperCase().padStart(2, "0");
// Quoted-printable: lines of at most 76 characters, broken with "=" without splitting an "=XX".
const qpLine = l => { let out = "", cur = ""; for (const t of Buffer.from(l, "utf8").reduce((o, b) => o.concat((b >= 33 && b <= 126 && b !== 61) || b === 32 ? String.fromCharCode(b) : hex(b)), [])) {
  if (cur.length + t.length > 73) { out += cur + "=" + CRLF; cur = ""; } cur += t; } return out + cur; };
const qp = s => s.split("\n").map(qpLine).join(CRLF);
const qWord = s => "=?UTF-8?Q?" + Buffer.from(s, "utf8").reduce((o, b) => o + (b === 32 ? "_" : b >= 33 && b <= 126 && ![61, 63, 95].includes(b) ? String.fromCharCode(b) : hex(b)), "") + "?=";
const encWord = s => "=?utf-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=";
const ascii = s => /^[\x20-\x7e]*$/.test(s);
const dateHeader = m => new Date(at(m.days)).toUTCString().replace("GMT", "+0000");
// Gmail: the email exactly as the shop sent it (quoted-printable UTF-8 parts).
function asSent(m) {
  const head = [`From: ${ascii(m.fromName) ? '"' + m.fromName + '"' : qWord(m.fromName)} <${m.from}>`,
    `Subject: ${ascii(m.subject) ? m.subject : qWord(m.subject)}`, `Date: ${dateHeader(m)}`, `Message-ID: <${m.key}@mail.shop.test>`, "MIME-Version: 1.0"];
  const parts = [];
  if (m.text) parts.push(`Content-Type: text/plain; charset="UTF-8"${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}${qp(m.text)}`);
  if (m.html) parts.push(`Content-Type: text/html; charset="UTF-8"${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}${qp(m.html)}`);
  if (parts.length === 1) return head.join(CRLF) + CRLF + parts[0];
  return head.join(CRLF) + CRLF + `Content-Type: multipart/alternative; boundary="b-${m.key}"` + CRLF + CRLF + parts.map(x => `--b-${m.key}${CRLF}${x}${CRLF}`).join("") + `--b-${m.key}--${CRLF}`;
}
// Microsoft 365 Safe Links: every link goes through Microsoft first (the real address is in url=).
const safe = url => "https://eur02.safelinks.protection.outlook.com/?url=" + encodeURIComponent(url) +
  "&data=05%7C02%7C%7C1f2e3d4c5b6a%7C84df9e7fe9f640afb435aaaaaaaaaaaa%7C1%7C0%7C638660000000000000%7CUnknown&sdata=AbCdEfGh%2B1%3D&reserved=0";
// Outlook: the same email as Exchange writes it out (CRLF, base64 parts, the sender's name encoded, Microsoft's headers,
// links wrapped by Safe Links; the café's in windows-1252).
function asExchange(m) {
  const cs = m.charset || "utf-8", enc = s => Buffer.from(s, cs === "windows-1252" ? "latin1" : "utf8");
  const head = ["Received: from AM9PR01MB1234.eurprd01.prod.exchangelabs.com (2603:10a6:20b::12) by DB9PR02MB5678.eurprd02.prod.outlook.com with HTTPS; " + dateHeader(m),
    `From: ${encWord(m.fromName)}${CRLF}\t<${m.from}>`, `To: "Sam Tester" <sam.tester@outlook.com>`, `Subject: ${encWord(m.subject)}`, `Thread-Topic: ${m.subject.replace(/[^\x20-\x7e]/g, "?")}`,
    "Thread-Index: AQHbLx2f3kQyN0ZqRUWm8w0TQxXl6A==", `Date: ${dateHeader(m)}`, `Message-ID: <${m.key}@mail.shop.test>`, "Accept-Language: en-GB, en-US", "Content-Language: en-GB",
    "X-MS-Has-Attach:", "X-MS-TNEF-Correlator:", "X-MS-Exchange-Organization-SCL: 1", "X-Microsoft-Antispam: BCL:0;", "MIME-Version: 1.0"];
  const parts = [];
  if (m.text) parts.push(`Content-Type: text/plain; charset="${cs}"${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${b64lines(enc(m.text.replace(/https:\/\/[^\s<>]+/g, u => safe(u)).replace(/\n/g, CRLF)))}`);
  if (m.html) parts.push(`Content-Type: text/html; charset="${cs}"${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${b64lines(enc(m.html.replace(/href="(https:\/\/[^"]+)"/g, (x, u) => `href="${safe(u).replace(/&/g, "&amp;")}" originalsrc="${u}" shash="xYz123"`)))}`);
  const boundary = `_000_AM9PR01MB1234${m.key.toUpperCase().replace(/[^A-Z0-9]/g, "")}_`;
  return head.join(CRLF) + CRLF + `Content-Type: multipart/alternative;${CRLF}\tboundary="${boundary}"` + CRLF + CRLF +
    parts.map(x => `--${boundary}${CRLF}${x}${CRLF}${CRLF}`).join("") + `--${boundary}--${CRLF}`;
}

// ---- The two fake services ----
const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "/");
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const gmailIds = new Map(mails.map((m, i) => ["pm" + i + "abcdef", m]));
const outlookBox = [...mails, junk].map((m, i) => ({ id: "AQMkADAwATM0MDAAMS1-p" + i, m, folder: m === junk ? "JUNK-FOLDER" : "INBOX-FOLDER" }));
const gmailQueries = [], opened = { gmail: [], outlook: [] };
let emails = [];
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "g-access" });
  if (url === "https://login.microsoftonline.com/consumers/oauth2/v2.0/token") return Response.json({ access_token: "ms-access" });
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
    const q = decodeURIComponent(new URL(url).searchParams.get("q"));
    gmailQueries.push(q);
    const w = /after:(\d{4}\/\d{2}\/\d{2}) before:(\d{4}\/\d{2}\/\d{2})/.exec(q);
    // Newest first, as Gmail lists them.
    return Response.json({ messages: [...gmailIds].filter(([, m]) => ymd(at(m.days)) >= w[1] && ymd(at(m.days)) < w[2]).sort((a, b) => a[1].days - b[1].days).map(([id]) => ({ id })) });
  }
  const g = /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/(\w+)\?format=raw$/.exec(url);
  if (g) { const m = gmailIds.get(g[1]); opened.gmail.push(m.key); return Response.json({ raw: Buffer.from(asSent(m)).toString("base64url") }); }
  if (url.startsWith("https://graph.microsoft.com/")) {
    const u = new URL(url);
    if (u.pathname === "/v1.0/me/mailFolders/junkemail") return Response.json({ id: "JUNK-FOLDER" });
    if (u.pathname === "/v1.0/me/mailFolders/deleteditems") return Response.json({ id: "DELETED-FOLDER" });
    if (u.pathname === "/v1.0/me/messages") {
      const f = /^receivedDateTime ge (\S+) and receivedDateTime lt (\S+)$/.exec(u.searchParams.get("$filter"));
      const lo = Date.parse(f[1]), hi = Date.parse(f[2]);
      return Response.json({ value: outlookBox.filter(x => at(x.m.days) >= lo && at(x.m.days) < hi).sort((a, b) => a.m.days - b.m.days).map(x => ({
        id: x.id, internetMessageId: `<${x.m.key}@mail.shop.test>`, subject: x.m.subject, from: { emailAddress: { name: x.m.fromName, address: x.m.from } },
        receivedDateTime: iso(at(x.m.days)), parentFolderId: x.folder })) });
    }
    const v = /^\/v1\.0\/me\/messages\/([^/]+)\/\$value$/.exec(u.pathname);
    if (v) { const x = outlookBox.find(y => y.id === decodeURIComponent(v[1])); opened.outlook.push(x.m.key); return new Response(asExchange(x.m), { status: 200 }); }
  }
  return new Response("not here", { status: 404 });   // product photos and anything else
};

// ---- Two shoppers: one with Gmail, one with Outlook ----
const call = (path, { method = "GET", body, token } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method,
    headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function shopper(email, provider) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email } });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  const token = (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
  assert.equal((await call("/relay/my/consent", { method: "POST", token, body: { version: CONSENT_VERSION } })).status, 200);
  const id = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id;
  await saveConnection(env, id, provider, email, "refresh-" + email, clock);
  return token;
}
const gina = await shopper("gina@gmail.com", null), otto = await shopper("otto@outlook.com", "microsoft");
async function scanAll(token) {
  let cursor, j, rounds = 0;
  do {
    const r = await call("/relay/my/gmail/scan", { method: "POST", token, body: cursor ? { cursor } : {} });
    assert.equal(r.status, 200);
    j = await r.json(); cursor = j.cursor;
    assert.ok(++rounds < 40, "the scan finishes");
  } while (j.more);
}
await scanAll(gina); await scanAll(otto);

// What each service was asked for and what was opened.
assert.ok(gmailQueries.length && gmailQueries.every(q => q.includes("category:purchases") && q.includes("category:reservations") && q.includes("booking")),
  "Gmail is searched for bookings and Google's Reservations label too, not just purchases");
assert.ok(!opened.outlook.includes("junk"), "Outlook's Junk Email is never opened (Gmail doesn't list Spam)");
assert.ok(!opened.outlook.includes("newsletter"), "an email with no order words isn't opened in Outlook");
console.log("ok - both mailboxes are asked for the same kinds of email; Junk and Spam are left out of both");

// ---- The receipt cards ----
const DROP = new Set(["id", "createdAt", "gmailId", "outlookId", "photoId", "receiptId"]);
const strip = v => Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !DROP.has(k)).map(([k, x]) => [k, strip(x)])) : v;
const cards = async token => {
  const r = await (await call("/relay/my/receipts", { token })).json();
  return r.receipts.map(strip).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
};
const gCards = await cards(gina), oCards = await cards(otto);
const keyOf = c => c.orderRef || c.retailer.name;
const shop = (list, ref) => list.find(c => keyOf(c) === ref);
// Each card is spot-checked on the Gmail side, then the Outlook side must match it field for field.
const lulu = shop(gCards, "1234567890");
assert.equal(lulu.retailer.name, "lululemon");
assert.equal(lulu.totalPence, 21600);
assert.deepEqual(lulu.items.map(i => i.name), ['Align High-Rise Pant 25"', "Define Jacket Nulu"], "&quot; is read as an inch mark");
assert.equal(lulu.delivery && lulu.delivery.status, "delivered", "Royal Mail's email marks the order delivered");
assert.equal(lulu.returnPlan && lulu.returnPlan.returnId, "RT-5551234", "the return email is attached to its order");
assert.equal(shop(gCards, "1042").retailer.name, "Northwind Trainers", "a Shopify shop is named, not Shopify");
assert.equal(shop(gCards, "987654321").retailer.name, "ASOS", "Apple's Hide My Email address isn't the shop");
assert.equal(shop(gCards, "TB-55123").retailer.name, "Ted Baker", "a receipt forwarded by Outlook names the shop");
assert.equal(shop(gCards, "TB-55123").retailer.logoDomain, "tedbaker.com", "and its logo comes from the shop, not from Hotmail");
assert.equal(shop(gCards, "C01234567890").retailer.name, "Nike", "a receipt forwarded by Gmail as HTML names the shop");
assert.equal(shop(gCards, "CL-4411").totalPence, 630);
assert.equal(shop(gCards, "CL-4411").retailer.name, "Café Lumière");
assert.equal(shop(gCards, "LN-778812").retailer.name, "LNER", "a short name in capitals keeps them");
assert.ok(gCards.some(c => c.retailer.name === "Anthropic" && c.totalPence === 1800), "a Stripe receipt names the business (not Stripe, not \"Anthropic, PBC\")");
assert.ok(!gCards.some(c => c.orderRef === "SC-1"), "nothing from Spam/Junk");
assert.equal(gCards.length, 8, "eight orders: the return email and the parcel email join their order; the newsletter is left out");
assert.deepEqual(oCards.map(keyOf).sort(), gCards.map(keyOf).sort(), "the same orders from Outlook");
for (const g of gCards) assert.deepEqual(shop(oCards, keyOf(g)), g, "Outlook's card for " + g.retailer.name + " matches Gmail's exactly");
console.log("ok - the same " + gCards.length + " receipt cards from Gmail and Outlook: shops, logos, items, totals, categories, deliveries and return plans");

// ---- Wrapped ----
const years = [...new Set(mails.map(m => new Date(at(m.days)).getUTCFullYear()))];
for (const y of years) {
  const w = async token => strip(await (await call("/relay/my/wrapped?year=" + y, { token })).json());
  const gw = await w(gina), ow = await w(otto);
  assert.ok(gw.receipts > 0, "Wrapped " + y + " has receipts");
  assert.deepEqual(ow, gw, "Wrapped " + y + " is the same from Outlook");
}
console.log("ok - Wrapped is the same from Gmail and Outlook");
console.log("PASS Gmail and Outlook give the same receipts, cards and Wrapped (FAKE Google and Microsoft)");
