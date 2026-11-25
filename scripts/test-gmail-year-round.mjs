// Offline test (FAKE Google and Gmail, real SQLite, made-up emails): a whole year read again for a new reader.
// Connor's mailbox stalled on 19 Nov 2026 while it was being read again for reader 43: half the year rounds the app asked
// for ended with "Failed to fetch" (Cloudflare ending the request, no CORS headers), and the background catch-up stopped
// moving at all. The reader took time that grew with the square of a line's length (a 16,000-character line took a
// minute), and a round saved nothing until the end of a date window, so a round that was ended met the same email again
// on every retry. Here:
//   1. A year of 600 emails, with three emails written as one long line, ~3,000 receipts already kept, read by an older
//      reader, is read again round after round inside a second process with a Worker's memory (128 MB): every round stays
//      well inside a Worker's processing time, and the long-line emails are read (not left out).
//   2. A round that is ended part-way (as Cloudflare ends one) keeps what it had read; the email it was in the middle of is
//      read on its own next time, and an email that ends every round it is in is left out after two, so the year finishes.
//   3. The year round and the background catch-up never read the same mailbox at once: the catch-up leaves it alone while
//      the app is reading a year, the app is told plainly (with CORS headers) to try again in a moment while the catch-up
//      has it, and a catch-up round that was ended part-way doesn't stop the next one moving on.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const { DatabaseSync } = await import("node:sqlite");
const { readFileSync, readdirSync } = await import("node:fs");
const { createHash, randomUUID } = await import("node:crypto");
const { handleAuthRoute } = await import("../worker/auth.js");
const { rawEmail } = await import("./fixtures/receipt-emails/lib.mjs");
const G = await import("../worker/gmail.js");

const part = process.argv[2] || "main";
if (part === "main") {
  const started = Date.now();
  const run = spawnSync(process.execPath, ["--max-old-space-size=128", fileURLToPath(import.meta.url), "year"], { encoding: "utf8", timeout: 240000 });
  process.stdout.write(run.stdout || "");
  process.stderr.write((run.stderr || "").split("\n").filter(l => !/ExperimentalWarning|trace-warnings/.test(l)).slice(0, 30).join("\n"));
  assert.equal(run.error, undefined, "the year is read within four minutes (a long line used to take many minutes on its own): " + (run.error && run.error.message));
  assert.equal(run.status, 0, "the year is read with a Worker's memory (128 MB), every round inside the time allowed (exit " + run.status + ", signal " + run.signal + ")");
  console.log(`ok - part 1 in ${Date.now() - started} ms`);
  // Every way into the reader, on an email of 2 MB of blank table rows and on lines of 40,000 characters, in a second
  // process so one that takes minutes can't hold the test up (several did: patterns that start a match at each line and
  // run over all the blank lines after it).
  const sh = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "shapes"], { encoding: "utf8", timeout: 240000 });
  process.stdout.write(sh.stdout || "");
  process.stderr.write((sh.stderr || "").split("\n").filter(l => !/ExperimentalWarning|trace-warnings/.test(l)).slice(0, 30).join("\n"));
  assert.equal(sh.error, undefined, "the reader gets through blank rows and long lines in seconds, not minutes (stopped after 4 minutes; last one started: " + ((sh.stdout || "").trim().split("\n").pop()) + ")");
  assert.equal(sh.status, 0, "every way into the reader is quick on blank rows and long lines");
}

if (part === "shapes") {
  const P = await import("../worker/receipt-parser.js"), I = await import("../worker/receipt-items.js"), C = await import("../worker/scan-codes.js");
  const R = await import("../worker/receipt-reader.js"), F = await import("../worker/flight-booking.js"), O = await import("../worker/original.js");
  const head = (ct) => `From: Example Jewellers <orders@examplejewellers.test>\r\nSubject: Your order confirmation #EJ-1\r\nDate: Mon, 1 Dec 2025 10:00:00 +0000\r\nContent-Type: ${ct}\r\n\r\n`;
  const fill = (unit, n) => unit.repeat(Math.ceil(n / unit.length));
  const H = (body) => { const html = "<p>Order number: EJ-1</p><table><tr><td>Silver ring</td><td>Qty 1</td><td>&pound;100.00</td></tr>" + body + "</table><p>Total &pound;100.00</p>"; return { raw: head("text/html; charset=utf-8") + html, html, text: html.replace(/<[^>]+>/g, "\n") }; };
  const T = (body) => { const text = "Order number: EJ-1\nSilver ring Qty 1 £100.00\n" + body + "\nTotal £100.00\n"; return { raw: head("text/plain; charset=utf-8") + text, html: "<pre>" + text + "</pre>", text }; };
  const L = 40000;
  const shapes = {
    "2 MB of blank rows": () => H(fill("<tr><td>&nbsp;</td></tr>\n", 2e6)), "2 MB of empty rows": () => H(fill("<tr><td></td></tr>", 2e6)),
    "2 MB of blank cells": () => H(fill("<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>\r\n", 2e6)), "2 MB of line breaks": () => H(fill("<br>&nbsp;\n", 2e6)),
    "2 MB of blank lines": () => T(fill("\n", 2e6)), "2 MB of spaces on lines": () => T(fill("   \n", 2e6)), "2 MB of column edges": () => T(fill("| | |\n", 2e6)),
    "a line of 40,000 spaces": () => T(fill(" ", L)), "a line of 40,000 tabs": () => T(fill("\t", L)), "a line of 40,000 non-breaking spaces": () => T(fill("\u00a0", L)),
    "a line of 40,000 letters": () => T(fill("x", L)), "a line of 40,000 words": () => T(fill("x ", L)), "a line of 40,000 prices": () => T(fill("£1.00 ", L)),
    "a line of 40,000 column edges": () => T(fill("| ", L)), "a cell of 40,000 spaces": () => H("<tr><td>" + fill(" ", L) + "</td></tr>"),
  };
  const ref = new Date(Date.UTC(2025, 11, 1));
  const card = { kind: "receipt", retailer: { name: "Example Jewellers", domain: "examplejewellers.test" }, items: [{ name: "Silver ring", qty: 1, pricePence: 10000 }], totalPence: 10000, orderRef: "EJ-1" };
  const ways = ({ raw, html, text }) => [
    ["classifyEmail", () => G.classifyEmail(raw, { gmailId: "x" })], ["parseReceiptEmail (lenient)", () => P.parseReceiptEmail(raw, { lenient: true })],
    ["parseDeliveryEmail", () => P.parseDeliveryEmail(raw)], ["parseReturnEmail", () => P.parseReturnEmail(raw)], ["parseReturnUpdateEmail", () => P.parseReturnUpdateEmail(raw)],
    ["parseReturnParcelEmail", () => P.parseReturnParcelEmail(raw)], ["parseDispatchEmail", () => P.parseDispatchEmail(raw)], ["parseCancellationEmail", () => P.parseCancellationEmail(raw)],
    ["parseOrderAdjustmentEmail", () => P.parseOrderAdjustmentEmail(raw)], ["emailForReading", () => P.emailForReading(raw)], ["emailForCodes", () => P.emailForCodes(raw)], ["orderNewsOf", () => P.orderNewsOf(raw)],
    ["mimeParts", () => P.mimeParts(raw)], ["extractProductImageUrls", () => P.extractProductImageUrls(raw, card)], ["photoShowsItem", () => P.photoShowsItem(raw, card)],
    ["findCodes", () => C.findCodes(raw, card)], ["codeEmailDetails", () => C.codeEmailDetails(raw)], ["htmlAsText", () => P.htmlAsText(html)], ["amazonOrders", () => P.amazonOrders(html, text)],
    ["appleItems", () => P.appleItems(text)], ["readItems", () => I.readItems(text)], ["moneyOf", () => I.moneyOf(text)], ["statedItemCount", () => I.statedItemCount(text)],
    ["shopNamesInText", () => R.shopNamesInText(text, "Your order")], ["forwardedSender", () => R.forwardedSender(text)], ["itemsFromCells", () => R.itemsFromCells(text)], ["gameItems", () => R.gameItems(text)],
    ["flightBooking", () => F.flightBooking({ subject: "Your booking is confirmed", text, senderDomain: "airline.test", fromName: "Airline", refDate: ref })],
    ["cleanHtml", () => O.cleanHtml(html)], ["a pasted receipt", () => G.classifyEmail(G.pastedWithHtml(text.slice(0, 200000), html), { pasted: true })],
  ];
  // (A computer running tests can be several times slower than Cloudflare's; the slowest here took 0.9 s on a fast one.)
  const LIMIT = 3000;
  const slow = [];
  for (const [name, make] of Object.entries(shapes)) {
    const sh = make();
    for (const [way, f] of ways(sh)) {
      console.log("started: " + way + " on " + name);
      const t0 = performance.now(); try { f(); } catch { /* an email that can't be read is fine; one that takes minutes isn't */ } const ms = performance.now() - t0;
      if (ms > LIMIT) slow.push(`${way} on ${name}: ${Math.round(ms)} ms`);
    }
  }
  assert.deepEqual(slow, [], "every way into the reader takes under " + LIMIT + " ms on blank rows and long lines");
  console.log("ok - " + Object.keys(shapes).length + " shapes of blank rows and long lines, through " + ways(shapes["2 MB of blank rows"]()).length + " ways into the reader, each under " + LIMIT + " ms");
  process.exit(0);
}

// ---- What every part shares: a database, a made-up Google, a signed-in shopper with Gmail connected ----
async function world(mail) {
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
  const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test" };
  const clock = Date.UTC(2026, 10, 19, 12);
  const sent = [], w = { sqlite, env, clock, mail, hang: null, reads: {} };
  w.fetchImpl = async (url, init = {}) => {
    url = String(url);
    if (url.startsWith("https://api.resend.com/emails")) { sent.push(JSON.parse(init.body)); return new Response("{}"); }
    if (url === "https://oauth2.googleapis.com/token") {
      const p = new URLSearchParams(String(init.body));
      return Response.json(p.get("grant_type") === "authorization_code" ? { access_token: "a1", refresh_token: "1//refresh", scope: "https://www.googleapis.com/auth/gmail.readonly" } : { access_token: "a2" });
    }
    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") return Response.json({ emailAddress: "sam.example@gmail.test" });
    if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
      // Gmail refusing for a moment, as it does when a mailbox's requests come too fast.
      if (w.listBusy > 0) { w.listBusy--; return Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Too many requests" } }, { status: 429, headers: { "retry-after": "0" } }); }
      const q = /after:(\S+) before:(\S+)/.exec(decodeURIComponent(url));
      return Response.json({ messages: mail.filter(m => m.day >= q[1] && m.day < q[2]).map(m => ({ id: m.id })) });
    }
    const one = /messages\/(m[0-9a-f]+)\?format=raw$/.exec(url);
    if (one) {
      const m = mail.find(x => x.id === one[1]);
      w.reads[m.id] = (w.reads[m.id] || 0) + 1;
      // The round reading this email is ended here, the way Cloudflare ends one: it never carries on, nothing after runs.
      if (w.hang && w.hang(m)) { w.ended = true; return new Promise(() => {}); }
      if (w.readBusy && w.readBusy(m)) return Response.json({ error: { code: 403, errors: [{ reason: "userRateLimitExceeded" }], message: "User-rate limit exceeded" } }, { status: 403 });
      // (Gmail's answer, made when it is asked for, so the made-up mailbox itself takes no memory.)
      return new Response('{"id":"' + m.id + '","raw":"' + Buffer.from(m.raw()).toString("base64url") + '"}', { headers: { "content-type": "application/json" } });
    }
    return new Response("nope", { status: 404 });
  };
  const CORS = { "Access-Control-Allow-Origin": "*" };
  w.call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
    handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), CORS, { now: clock, fetchImpl: w.fetchImpl });
  await w.call("/relay/auth/request", { method: "POST", body: { email: "sam@example.com" }, ip: "5.5.5.5" });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1];
  const token = (await (await w.call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
  w.post = (path, body) => w.call(path, { method: "POST", token, body });
  w.postAt = (now, path, body) => handleAuthRoute(new Request("https://w.test" + path, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "1.1.1.1", authorization: "Bearer " + token },
    body: JSON.stringify(body) }), env, new URL("https://w.test" + path), CORS, { now, fetchImpl: w.fetchImpl });
  await w.post("/relay/my/consent", { version: G.CONSENT_VERSION });
  const state = new URL((await (await w.post("/relay/my/gmail/connect")).json()).url).searchParams.get("state");
  await w.post("/relay/my/gmail/finish", { code: /mailcode=([A-Za-z0-9_-]{43})/.exec((await w.call("/relay/gmail/callback?code=good&state=" + state)).headers.get("location"))[1] });
  w.shopperId = sqlite.prepare("SELECT shopper_id FROM gmail_connections").get().shopper_id;
  // Everything the shopper already has was read by the reader before this one.
  const ins = sqlite.prepare("INSERT INTO captured_receipts (id,shopper_id,message_ref,status,details,created_at) VALUES (?,?,?,?,?,?)");
  const old = (k) => JSON.stringify({ kind: "receipt", gmailId: k, retailer: { name: "Example Shop", domain: "exampleshop.test" }, orderRef: "OLD-" + k, totalPence: 1234, currency: "GBP",
    items: [{ name: "Made-up thing", qty: 1, pricePence: 1234 }], parserVersion: G.PARSER_VERSION - 1 });
  w.refOf = (m) => createHash("sha256").update("gmail:" + m.id).digest("hex");
  for (const m of mail) ins.run(randomUUID(), w.shopperId, w.refOf(m), "pending", old(m.id), clock - 86400000);
  w.addOther = (n) => { for (let i = 0; i < n; i++) ins.run(randomUUID(), w.shopperId, "other-" + i, "pending", old("o" + i), clock - 86400000); };
  w.rowOf = (m) => { const r = sqlite.prepare("SELECT status, details FROM captured_receipts WHERE message_ref = ?").get(w.refOf(m)); return r && { status: r.status, d: JSON.parse(r.details) }; };
  w.onNewReader = () => mail.filter(m => { const r = w.rowOf(m); return r && r.d.parserVersion === G.PARSER_VERSION; }).length;
  return w;
}

// The made-up emails: the shops' layouts from the receipt corpus (all made up), each dated through the year.
const dir = "scripts/fixtures/receipt-emails/";
const corpus = readdirSync(dir).filter(f => f.endsWith(".json")).map(f => JSON.parse(readFileSync(dir + f, "utf8"))).filter(e => e.headers && e.html && e.html.length < 20000);
function mailbox(n, year, shape, days = 365) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const at = Date.UTC(year + 1, 0, 1) - days * 86400000 + Math.floor((i + 0.5) * (days * 86400000 / n)), d = new Date(at);
    const e = corpus[(i * 7) % corpus.length], kind = shape(i);
    const headers = { ...e.headers, date: d.toUTCString() };
    let raw;
    if (kind === "long") {
      // An email whose text is one long line (40,000 characters): an order email sent as a single line of plain text.
      const words = Array.from({ length: 2600 }, (_, k) => `Item ${k} blue cotton £${(k % 40) + 1}.99`).join(" ");
      raw = () => `From: Example Outfitters <orders@exampleoutfitters.test>\r\nSubject: Your order confirmation #EO-${i}\r\nDate: ${d.toUTCString()}\r\nMessage-ID: <long-${i}@exampleoutfitters.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nOrder number: EO-${i} ${words} Order total: £24.00\r\n`;
    } else if (kind === "attached") {
      // A receipt with a 3 MB attachment (only the start of it is ever downloaded).
      raw = () => rawEmail({ ...e, headers }).replace(/\r?\n\r?\n/, "\r\n\r\n") + "\r\n" + "QUJD".repeat(750000);
    } else {
      const kb = kind === "big" ? 200 : kind === "mid" ? 60 : 20;
      raw = () => rawEmail({ ...e, headers, html: e.html.repeat(Math.max(1, Math.round(kb * 1000 / e.html.length))) });
    }
    out.push({ id: "m" + i.toString(16).padStart(6, "0"), at, day: d.toISOString().slice(0, 10).replace(/-/g, "/"), kind, raw });
  }
  return out.sort((a, b) => b.at - a.at);
}

if (part === "year") {
  // ---- 1. A whole year read again, inside a Worker's memory, every round inside its time ----
  const mail = mailbox(600, 2025, i => (i === 100 || i === 300 || i === 500 ? "long" : i % 50 === 7 ? "attached" : i % 12 === 3 ? "big" : i % 3 === 1 ? "mid" : "small"));
  const w = await world(mail);
  w.addOther(2400);
  const rounds = [];
  let cursor = "", more = true;
  while (more && rounds.length < 80) {
    const c0 = process.cpuUsage(), t0 = Date.now();
    const res = await w.post("/relay/my/gmail/scan", { year: 2025, ...(cursor ? { cursor } : {}) });
    const cpu = process.cpuUsage(c0), cpuMs = Math.round((cpu.user + cpu.system) / 1000);
    assert.equal(res.status, 200, "round " + (rounds.length + 1) + " answers");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const j = await res.json();
    rounds.push({ cpuMs, ms: Date.now() - t0, heapMB: Math.round(process.memoryUsage().heapUsed / 1e6) });
    // Cloudflare allows 30 s of processing a request; a round here must stay far inside it (a slower computer runs tests).
    assert.ok(cpuMs < 12000, `round ${rounds.length} took ${cpuMs} ms of processing (at most 12,000 allowed here; Cloudflare ends a request at 30,000)`);
    more = j.more; cursor = j.cursor;
  }
  assert.equal(more, false, "the year finishes");
  assert.equal(w.onNewReader(), mail.length, "every email of the year is read by the new reader");
  for (const m of mail.filter(x => x.kind === "long")) {
    const r = w.rowOf(m);
    assert.ok(!r.d.unread, "an email written as one long line is read, not left out");
    assert.equal(r.d.kind, "receipt", "and it reads as the order it is");
  }
  const maxCpu = Math.max(...rounds.map(r => r.cpuMs));
  console.log(`ok - 600 emails (three of them one 40,000-character line, ~3,000 receipts kept) read again in ${rounds.length} rounds with 128 MB; the longest round took ${maxCpu} ms of processing`);
  process.exit(0);
}

// ---- 2. A round that is ended part-way keeps its work; an email that ends every round is left out after three ----
{
  // (A busy month: all 60 in one date window, which a round used to save only once it had read all of it.)
  const mail = mailbox(60, 2024, () => "small", 25);
  const w = await world(mail);
  const poison = mail[25];
  // The poison email is the one Cloudflare ends the round on, every time it is read (with others or on its own).
  w.hang = (m) => m.id === poison.id;
  const before = w.onNewReader();
  assert.equal(before, 0);
  // Round 1 is ended while reading the poison email.
  w.ended = false;
  w.post("/relay/my/gmail/scan", { year: 2024 });
  for (let k = 0; k < 400 && !w.ended; k++) await new Promise(r => setTimeout(r, 5));
  assert.ok(w.ended, "the first round reaches the poison email");
  await new Promise(r => setTimeout(r, 50));
  const kept = w.onNewReader();
  assert.ok(kept >= 24, `what the ended round had read before it was ended is kept (${kept} of the 25 emails before the one it was ended on; it used to keep none)`);
  // The app tries again (it asks one round at a time, so the ended round's hold on the mailbox doesn't make it wait),
  // and the poison email is read on its own; once it has ended a round on its own too (two in all), it is left out.
  let cursor = "", more = true, ends = 1, rounds = 0;
  while (more && rounds < 40) {
    w.ended = false;
    const p = w.post("/relay/my/gmail/scan", { year: 2024, ...(cursor ? { cursor } : {}) });
    const res = await Promise.race([p, new Promise(r => setTimeout(() => r(null), 3000))]);
    rounds++;
    if (!res) { assert.ok(w.ended, "a round that doesn't answer was ended on the poison email"); ends++; continue; }
    assert.equal(res.status, 200);
    const j = await res.json(); more = j.more; cursor = j.cursor;
  }
  assert.equal(more, false, "the year finishes even with an email that ends every round it is in");
  assert.equal(ends, 2, "the poison email ended two rounds (one with others, one on its own), no more");
  assert.equal(w.reads[poison.id], 2, "and was asked for twice");
  for (const m of mail) if (m.id !== poison.id) assert.ok(w.reads[m.id] <= 2, "every other email is read at most twice (" + m.id + ": " + w.reads[m.id] + ")");
  assert.equal(w.onNewReader(), mail.length, "every email is done");
  const pr = w.rowOf(poison);
  assert.equal(pr.d.orderRef, "OLD-" + poison.id, "the poison email keeps what the older reader found (nothing is lost)");
  const others = mail.filter(m => m.id !== poison.id).map(m => w.rowOf(m).d);
  assert.ok(others.every(d => !d.unread && d.orderRef !== "OLD-" + d.gmailId), "every other email is read by the new reader");
  console.log(`ok - an ended round kept ${kept} emails it had read; the email that ended rounds was left out after 2, the year finished`);
}

// ---- 3. The year round and the background catch-up take turns ----
{
  const mail = mailbox(40, 2023, () => "small", 25);
  const w = await world(mail);
  const db = w.sqlite;
  // The year was read by the older reader, so the catch-up wants to read it again.
  db.prepare("INSERT INTO gmail_history_years (shopper_id, year, done_at, rev, cursor) VALUES (?, 2023, ?, 1, NULL)").run(w.shopperId, w.clock - 86400000);
  db.prepare("UPDATE gmail_connections SET last_scan_at = ?, full_rev = ? WHERE shopper_id = ?").run(w.clock - 3600000, G.FULL_REV, w.shopperId);
  // (The first scan, started when Gmail was connected, has finished.)
  db.prepare("UPDATE mail_scan_jobs SET state = 'done' WHERE shopper_id = ?").run(w.shopperId);
  // The app is reading a year: the catch-up leaves the mailbox alone.
  assert.equal((await w.postAt(w.clock, "/relay/my/gmail/scan", { year: 2022 })).status, 200);
  let c = await G.catchUpFullReads(w.env, w.clock + 30000, w.fetchImpl);
  assert.equal(c.checked, 0, "the catch-up waits while the app is reading a year");
  assert.equal(w.onNewReader(), 0);
  // Three minutes after the app's last round the catch-up reads the year, and is ended part-way.
  const later = w.clock + 3 * 60000;
  w.ended = false;
  w.hang = (m) => m.id === mail[10].id;
  G.catchUpFullReads(w.env, later, w.fetchImpl);
  for (let k = 0; k < 400 && !w.ended; k++) await new Promise(r => setTimeout(r, 5));
  assert.ok(w.ended, "the catch-up reads the year");
  await new Promise(r => setTimeout(r, 50));
  const kept = w.onNewReader();
  assert.ok(kept >= 6, "what the ended catch-up round had read is kept (" + kept + ")");
  // Meanwhile the app asks for a round of the same year: it is told to try again in a moment, with CORS headers.
  const busy = await w.postAt(later + 1000, "/relay/my/gmail/scan", { year: 2023 });
  assert.equal(busy.status, 503);
  assert.equal(busy.headers.get("access-control-allow-origin"), "*", "the app can read the answer");
  const bj = await busy.json();
  assert.equal(bj.error, "scan_busy");
  assert.ok(bj.retryAfterMs > 0 && bj.retryAfterMs <= 60000, "and is told when to try again");
  // Once the app has stopped asking, the catch-up carries on (the email it was ended on is read on its own) and finishes.
  w.hang = null;
  let t = later + 5 * 60000, runs = 0;
  while (runs < 20) {
    c = await G.catchUpFullReads(w.env, t, w.fetchImpl); runs++; t += 60000;
    if (!c.checked) break;
  }
  assert.equal(w.onNewReader(), mail.length, "the catch-up moves on after a round of it was ended, and reads the whole year");
  assert.ok(w.reads[mail[10].id] === 2, "the email it was ended on was read again once");
  const y = db.prepare("SELECT rev FROM gmail_history_years WHERE shopper_id = ? AND year = 2023").get(w.shopperId);
  assert.equal(y.rev, G.READER_FULL_REV, "the year is marked as read by the new reader");
  console.log(`ok - the catch-up waits for the app, the app is told to wait for the catch-up, and an ended catch-up round kept ${kept} emails and carried on (${runs} more runs)`);
}
// ---- 4. Gmail busy for a moment: the round waits once, then stops and says when to ask again; nothing is left out ----
{
  const mail = mailbox(30, 2021, () => "small", 25);
  const w = await world(mail);
  // At the start of a round, Gmail refuses twice in a row (the round asks once more): the app is told to wait, with CORS.
  w.listBusy = 2;
  let res = await w.post("/relay/my/gmail/scan", { year: 2021 });
  assert.equal(res.status, 503, "a round Gmail is too busy for answers 503");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  let j = await res.json();
  assert.equal(j.error, "gmail_unavailable");
  assert.ok(j.retryAfterMs >= 1000, "and says when to ask again");
  // Refused once only: asked once more and read as usual.
  w.listBusy = 1;
  res = await w.post("/relay/my/gmail/scan", { year: 2021, small: true });
  assert.equal(res.status, 200, "Gmail refusing once is waited out within the round");
  // Some emails refused for a while: they wait for a later round, without counting as a try.
  let refusing = true;
  w.readBusy = (m) => refusing && (m === mail[8] || m === mail[9]);
  let cursor = "", more = true, rounds = 0, hinted = 0;
  while (more && rounds < 30) {
    res = await w.post("/relay/my/gmail/scan", { year: 2021, ...(cursor ? { cursor } : {}) });
    assert.equal(res.status, 200);
    j = await res.json(); more = j.more; cursor = j.cursor; rounds++;
    if (j.retryAfterMs) { hinted++; if (hinted >= 3) refusing = false; }
  }
  assert.equal(more, false);
  assert.ok(hinted >= 3, "a round stopped by Gmail being busy says when to ask again");
  for (const m of mail) {
    const r = w.rowOf(m);
    assert.equal(r.d.parserVersion, G.PARSER_VERSION);
    assert.ok(!r.d.unread && r.d.orderRef !== "OLD-" + m.id, "every email is read once Gmail answers, none left out because Gmail was busy (" + m.id + ")");
  }
  console.log(`ok - Gmail busy: a 503 with when to ask again, one refusal waited out, refused emails read later (${hinted} rounds told to wait), none left out`);
}

// ---- 5. The background catch-up's pace: hundreds of emails a minute, each run inside its time ----
{
  const mail = mailbox(400, 2020, i => (i % 3 === 1 ? "mid" : "small"));
  const w = await world(mail);
  w.addOther(2600);
  const db = w.sqlite;
  db.prepare("INSERT INTO gmail_history_years (shopper_id, year, done_at, rev, cursor) VALUES (?, 2020, ?, 1, NULL)").run(w.shopperId, w.clock - 86400000);
  db.prepare("UPDATE gmail_connections SET last_scan_at = ?, full_rev = ? WHERE shopper_id = ?").run(w.clock - 3600000, G.FULL_REV, w.shopperId);
  db.prepare("UPDATE mail_scan_jobs SET state = 'done' WHERE shopper_id = ?").run(w.shopperId);
  const runs = [];
  let t = w.clock;
  while (runs.length < 30) {
    const before = w.onNewReader(), c0 = process.cpuUsage();
    const c = await G.catchUpFullReads(w.env, t, w.fetchImpl); t += 60000;
    const cpu = process.cpuUsage(c0);
    if (!c.checked) break;
    runs.push({ read: w.onNewReader() - before, cpuMs: Math.round((cpu.user + cpu.system) / 1000) });
  }
  assert.equal(w.onNewReader(), mail.length, "the catch-up reads the whole year");
  const full = runs.slice(0, -1);
  assert.ok(full.every(r => r.read >= 60), "each minute's run reads at least 60 emails (" + runs.map(r => r.read).join(", ") + ")");
  assert.ok(runs.every(r => r.cpuMs < 15000), "each run stays well inside a scheduled run's processing time (" + runs.map(r => r.cpuMs).join(", ") + " ms)");
  console.log(`ok - catch-up: ${mail.length} emails in ${runs.length} one-minute runs (${runs.map(r => r.read).join(", ")}), at most ${Math.max(...runs.map(r => r.cpuMs))} ms of processing a run: about ${Math.round(mail.length / runs.length * 60)} emails an hour`);
}
console.log("PASS year rounds: bounded in time and memory, an ended round keeps its work, no email can stall a year, the app and the catch-up take turns");
