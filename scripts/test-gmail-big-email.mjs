// Offline test (FAKE Google and Gmail, real SQLite, made-up emails): a year with very big emails in it.
// Connor's 2020 could not be read at all (19 Nov 2026). That year has emails with 7 MB and 30 MB of attachments whose
// subjects match Relay's search. Each was downloaded whole and copied several times over, which is more memory than a
// Worker has, so Cloudflare ended every round with its own error page: no CORS headers, "Failed to fetch" in the app, and
// the same emails again on every retry.
// Here the same shape is read the way the app reads a year (round after round with the cursor it is given), inside a
// second process that has the memory of a Worker (128 MB) and a time limit:
//   - no more than the start of a big email is ever downloaded;
//   - a receipt in a big email's own text is read the same as in a small copy of that email;
//   - the receipts behind the big emails are reached and the year finishes;
//   - a round that fails still answers with CORS headers and a plain "try again".
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

if (process.argv[2] !== "inside") {
  const started = Date.now();
  const run = spawnSync(process.execPath, ["--max-old-space-size=128", fileURLToPath(import.meta.url), "inside"], { encoding: "utf8", timeout: 60000 });
  process.stdout.write(run.stdout || "");
  process.stderr.write((run.stderr || "").split("\n").slice(0, 30).join("\n"));
  assert.equal(run.error, undefined, "the year is read within a minute: " + (run.error && run.error.message));
  assert.equal(run.status, 0, "the year is read with the memory a Worker has (128 MB), without the process being ended (exit " + run.status + ", signal " + run.signal + ")");
  console.log(`ok - a year with 7 MB and 30 MB emails is read in ${Date.now() - started} ms with a Worker's memory`);
  process.exit(0);
}

const { DatabaseSync } = await import("node:sqlite");
const { readFileSync, readdirSync } = await import("node:fs");
const { handleAuthRoute } = await import("../worker/auth.js");
const { CONSENT_VERSION, MAX_EMAIL_BYTES, classifyEmail } = await import("../worker/gmail.js");

const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("worker/migrations").filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync("worker/migrations/" + f, "utf8"));
let dbDown = null;   // a pattern of SQL that fails, for the last check
function stmt(sql, args = []) {
  if (dbDown && dbDown.test(sql)) throw new Error("D1_ERROR: the database is not answering");
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
const clock = Date.UTC(2026, 10, 19, 12);

// ---- The made-up mailbox: 2020 ----
// A small email is its text. A big one is a head (headers, the email's own text, the start of an attachment) and then
// the attachment: the same base64 line `lines` times, never held in memory whole (Gmail's answer is made as it is read).
const LINE = "TWFkZS11cCBhdHRhY2htZW50IGJ5dGVzIGZvciBSZWxheSdzIHRlc3RzLCBub3QgYSByZWFsIGZpbGUu".padEnd(76, "A").slice(0, 76) + "\r\n";   // 78 bytes
const forwarded = (subject, text, file, type, from = '"Sam Example (PGT)" <s.example@university.example>') => {
  let head = [
    "From: " + from, "To: sam.example@gmail.test", "Subject: " + subject,
    "Date: Tue, 25 Feb 2020 19:18:18 +0000", "Message-ID: <" + file + "@university.example>", "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="made-up-boundary-1"', "",
    "--made-up-boundary-1", "Content-Type: text/plain; charset=utf-8", "", text, "",
    "--made-up-boundary-1", `Content-Type: ${type}; name="${file}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${file}"`, "", ""
  ].join("\r\n");
  // (The head is made a whole number of 3 bytes, so its base64 and the attachment's can simply follow one another.)
  while (Buffer.byteLength(head) % 3) head = head.replace("\r\n\r\n--made-up-boundary-1\r\nContent-Type: application", " \r\n\r\n--made-up-boundary-1\r\nContent-Type: application").replace("\r\n\r\n--made-up-boundary-1\r\nContent-Type: image", " \r\n\r\n--made-up-boundary-1\r\nContent-Type: image");
  return head;
};
const TAIL = "\r\n--made-up-boundary-1--\r\n";
const hotelText = "Thank you for your booking with Example Harbour Hotel.\r\n\r\nOrder number: EHH-20455\r\nOrder date: 24 Feb 2020\r\nHarbour view double room, 2 nights - Qty 1 - £184.00\r\nOrder total: £184.00\r\n\r\nYour invoice is attached.";
const linesFor = mb => Math.ceil(mb * 1e6 / 78);
const box = {
  // December: an ordinary receipt (the first window of the year).
  dec: { day: "2020/12/14", at: Date.UTC(2020, 11, 14), raw: "From: Example Outfitters <orders@exampleoutfitters.test>\nSubject: Your order confirmation #EO-2020\nContent-Type: text/plain\n\nOrder number: EO-2020\nOrder date: 14 Dec 2020\nWool scarf - Qty 1 - £24.00\nOrder total: £24.00\n" },
  // Early March and late February: the big ones, newest first as Gmail lists them. Four are someone forwarding files to
  // themselves (not purchases); one is a hotel's confirmation sent with a very large brochure.
  big1: { day: "2020/03/04", at: Date.UTC(2020, 2, 4, 18, 42), head: forwarded("FW: Tickets and booking", "Photos from the weekend attached, and the tickets.", "photos-1.jpg", "image/jpeg"), lines: linesFor(6.7) },
  big2: { day: "2020/03/04", at: Date.UTC(2020, 2, 4, 18, 35), head: forwarded("Your order confirmation #EHH-20455", hotelText, "invoice-and-brochure.pdf", "application/pdf", "Example Harbour Hotel <orders@exampleharbour.test>"), lines: linesFor(6.7) },
  big3: { day: "2020/02/25", at: Date.UTC(2020, 1, 25, 19, 35), head: forwarded("FW: Tickets and booking", "More photos attached.", "photos-2.jpg", "image/jpeg"), lines: linesFor(6.7) },
  big4: { day: "2020/02/25", at: Date.UTC(2020, 1, 25, 19, 32), head: forwarded("FW: Tickets and booking", "And the rest.", "photos-3.jpg", "image/jpeg"), lines: linesFor(6.7) },
  huge: { day: "2020/02/25", at: Date.UTC(2020, 1, 25, 19, 18), head: forwarded("FW: Tickets and booking", "The whole album, sorry for the size.", "album.pdf", "application/pdf"), lines: linesFor(29.9) },
  // Behind them, in the same window and in January: receipts that were never reached.
  feb: { day: "2020/02/20", at: Date.UTC(2020, 1, 20), raw: "From: Example Cycles <orders@examplecycles.test>\nSubject: Your order confirmation #EC-311\nContent-Type: text/plain\n\nOrder number: EC-311\nOrder date: 20 Feb 2020\nBike lights set - Qty 1 - £32.50\nOrder total: £32.50\n" },
  jan: { day: "2020/01/09", at: Date.UTC(2020, 0, 9), raw: "From: Example Books <orders@examplebooks.test>\nSubject: Your order confirmation #EB-88\nContent-Type: text/plain\n\nOrder number: EB-88\nOrder date: 9 Jan 2020\nPaperback novel - Qty 1 - £8.99\nOrder total: £8.99\n" }
};
const sizeOf = e => e.raw ? Buffer.byteLength(e.raw) : Buffer.byteLength(e.head) + e.lines * 78 + TAIL.length;
// Gmail's answer for one email, sent a piece at a time like a real download; how much of each was taken is counted.
const taken = {};
function gmailAnswer(key) {
  const e = box[key];
  taken[key] = taken[key] || 0;
  const enc = new TextEncoder();
  const pieces = (function* () {
    yield `{"id":"${idOf(key)}","threadId":"${idOf(key)}","labelIds":["INBOX"],"snippet":"Made up for the test","sizeEstimate":${sizeOf(e)},"raw":"`;
    if (e.raw) yield Buffer.from(e.raw).toString("base64url");
    else {
      yield Buffer.from(e.head).toString("base64url");
      const block = Buffer.from(LINE.repeat(600)).toString("base64url");   // 600 lines: 62,400 characters
      for (let left = e.lines; left > 0; left -= 600) yield left >= 600 ? block : Buffer.from(LINE.repeat(left)).toString("base64url");
      yield Buffer.from(TAIL.padEnd(Math.ceil(TAIL.length / 3) * 3, "\n")).toString("base64url");
    }
    yield `","historyId":"1","internalDate":"${e.at}"}`;
  })();
  return new Response(new ReadableStream({
    pull(c) { const n = pieces.next(); if (n.done) return c.close(); const b = enc.encode(n.value); taken[key] += b.length; c.enqueue(b); }
  }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } });
}
let emails = [], listFails = false;
const idOf = k => "a" + Buffer.from(k).toString("hex") + "0";
const keyOf = id => Buffer.from(id.slice(1, -1), "hex").toString();
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url === "https://oauth2.googleapis.com/token") {
    const p = new URLSearchParams(String(init.body));
    return Response.json(p.get("grant_type") === "authorization_code"
      ? { access_token: "a1", refresh_token: "1//refresh", scope: "https://www.googleapis.com/auth/gmail.readonly" } : { access_token: "a2" });
  }
  if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") return Response.json({ emailAddress: "sam.example@gmail.test" });
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
    if (listFails) throw new Error("network connection lost");
    const w = /after:(\S+) before:(\S+)/.exec(decodeURIComponent(url));
    const ids = Object.keys(box).filter(k => box[k].day >= w[1] && box[k].day < w[2]).sort((a, b) => box[b].at - box[a].at);
    return Response.json({ messages: ids.map(k => ({ id: idOf(k) })) });
  }
  const one = /messages\/(a[0-9a-f]+0)\?format=raw$/.exec(url);
  if (one) return gmailAnswer(keyOf(one[1]));
  return new Response("nope", { status: 404 });
};
const CORS = { "Access-Control-Allow-Origin": "*" };
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), CORS, { now: clock, fetchImpl });
await call("/relay/auth/request", { method: "POST", body: { email: "sam@example.com" }, ip: "5.5.5.5" });
const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
const sam = (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
const post = (path, body) => call(path, { method: "POST", token: sam, body });
await post("/relay/my/consent", { version: CONSENT_VERSION });
const state = new URL((await (await post("/relay/my/gmail/connect")).json()).url).searchParams.get("state");
await post("/relay/my/gmail/finish", { code: /mailcode=([A-Za-z0-9_-]{43})/.exec((await call("/relay/gmail/callback?code=good&state=" + state)).headers.get("location"))[1] });

// ---- The year, read the way the app reads it: the cursor it is given, round after round ----
const started = Date.now();
let cursor = "", more = true, rounds = 0;
while (more && rounds < 40) {
  const res = await post("/relay/my/gmail/scan", { year: 2020, ...(cursor ? { cursor } : {}) });
  assert.equal(res.status, 200, "round " + (rounds + 1) + " answers");
  assert.equal(res.headers.get("access-control-allow-origin"), "*", "every answer can be read by the app");
  const j = await res.json(); more = j.more; cursor = j.cursor; rounds++;
}
const took = Date.now() - started;
assert.equal(more, false, "2020 finishes (it used to stop at the big emails for good)");
assert.ok(took < 20000, "the whole year takes seconds, not minutes: " + took + " ms");

// No more than the start of any email was downloaded: the limit, as base64 inside Gmail's answer, and a little over.
const limit = Math.ceil(MAX_EMAIL_BYTES / 3) * 4 + 200000;
for (const k of Object.keys(box)) assert.ok(taken[k] > 0 && taken[k] <= limit, `${k} (${sizeOf(box[k])} bytes): ${taken[k]} bytes of Gmail's answer were downloaded, at most ${limit} allowed`);
assert.ok(sizeOf(box.huge) > 29e6 && sizeOf(box.big2) > 6.5e6, "the made-up emails are as big as the real ones were");

const rows = sqlite.prepare("SELECT status, details FROM captured_receipts").all().map(r => ({ status: r.status, d: JSON.parse(r.details) }));
assert.equal(rows.length, Object.keys(box).length, "every email of the year was looked at, the big ones too");
assert.equal(rows.filter(r => r.d.unread).length, 0, "none is left as not read");
const receipts = rows.filter(r => r.d.kind === "receipt");
for (const ref of ["EO-2020", "EC-311", "EB-88"]) assert.ok(receipts.some(r => r.d.orderRef === ref), "the receipt " + ref + " is found (EC-311 and EB-88 are behind the big emails)");

// The booking in a 6.7 MB email's own text is read exactly as in a small copy of the same email (one line of attachment).
const small = classifyEmail(box.big2.head + LINE + TAIL, {}).details;
const got = receipts.find(r => r.d.orderRef === "EHH-20455");
assert.ok(got, "the booking sent with a 6.7 MB attachment is read as a receipt");
assert.equal(small.kind, "receipt");
for (const f of ["retailer", "orderRef", "orderDate", "totalPence", "currency", "items", "itemsCheck", "detailsInAttachment", "confidence", "method"])
  assert.deepEqual(got.d[f], small[f], "the big email's " + f + " reads the same as the small copy's");
assert.equal(got.d.totalPence, 18400);

const hist = await (await call("/relay/my/gmail/history", { token: sam })).json();
assert.ok((hist.years || []).some(y => y.year === 2020), "2020 is marked as read");

// ---- A round that fails still answers the app: CORS headers and a plain "try again" ----
listFails = true;
let res = await post("/relay/my/gmail/scan", { year: 2019 });
listFails = false;
assert.equal(res.status, 503);
assert.equal(res.headers.get("access-control-allow-origin"), "*", "a failed round can still be read by the app");
assert.deepEqual(await res.json(), { error: "scan_busy", retryAfterMs: 3000 });
// (The database not answering at the very start of the round used to leave the handler as a bare error.)
dbDown = /shopper_consents/;
try { res = await post("/relay/my/gmail/scan", { year: 2019 }); } finally { dbDown = null; }
assert.equal(res.status, 503);
assert.equal(res.headers.get("access-control-allow-origin"), "*");
assert.equal((await res.json()).error, "scan_busy");

console.log(`ok - 2020 with five emails of 6.7 MB to 30 MB: ${rounds} rounds, ${took} ms, at most ${Math.max(...Object.values(taken))} bytes of any one downloaded; the booking inside one and the receipts behind them found`);
