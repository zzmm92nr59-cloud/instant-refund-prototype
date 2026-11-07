// Offline tests for Outlook: "Continue with Microsoft" sign-in and "Connect Outlook" receipt reading, against a real
// SQLite engine. Microsoft's sign-in and the Outlook mailbox (Microsoft Graph) are FAKED here: this proves Relay's own
// rules (consent first, state binding, verified Microsoft addresses only, encrypted and rotated tokens, receipts-only
// reading, no email bodies kept, disconnect/delete) but NOT that real Microsoft accepts our settings. That needs the
// app registered with Microsoft and a live test with a real Outlook.com account.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, CONSENT_TEXT, OUTLOOK_SCOPE, looksLikeShopping, autoScanGmail } from "../worker/gmail.js";
import { mimeParts } from "../worker/receipt-parser.js";

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
const CONSUMERS = "9188040d-6c67-4c5b-b112-36a304b66dad";
const MS = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";

let clock = 1_800_000_000_000; // 15 Jan 2027
const DAY = 864e5;
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const b64url = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = claims => b64url({ alg: "RS256", typ: "JWT" }) + "." + b64url(claims) + ".sig";
const claimsFor = (over = {}) => ({ iss: `https://login.microsoftonline.com/${CONSUMERS}/v2.0`, tid: CONSUMERS, aud: env.MICROSOFT_CLIENT_ID,
  exp: Math.floor(clock / 1000) + 3600, email: "Jess.Tester@Outlook.com", preferred_username: "jess.tester@outlook.com", ...over });

// The fake Outlook mailbox. Each email has a Graph id (which changes if it is moved) and its own Message-ID.
const receipt = (n, extra = "") => `Order number: OL-${n}\nOrder date: 14 Oct 2026\nWool jumper - Qty 1 - £59.00\nOrder total: £59.00\nReturns accepted within 30 days of purchase.\nPRIVATE-BODY-MARKER-${n}\n${extra}`;
const mime = (m) => `From: ${m.fromName} <${m.from}>\r\nSubject: ${m.subject}\r\nMessage-ID: ${m.mid}\r\nDate: ${new Date(m.at).toUTCString()}\r\n` +
  (m.html ? m.html : `Content-Type: text/plain; charset=utf-8\r\n\r\n${m.body}`);
const QR_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2500, 3)]).toString("base64");
const htmlReceipt = `Content-Type: multipart/related; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n` +
  `<html><body onload="steal()"><script>alert(1)</script><p>Order OL-4</p><img src="cid:qr1" alt="QR"><a href="https://shop.test/returns">Start a return</a><p>Order number: OL-4</p><p>Order date: 14 Oct 2026</p><p>Wool jumper - Qty 1 - £59.00</p><p>Order total: £59.00</p><p>PRIVATE-BODY-MARKER-4</p></body></html>\r\n` +
  `--b1\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <qr1>\r\n\r\n${QR_PNG.match(/.{1,76}/g).join("\r\n")}\r\n--b1--\r\n`;
let box = [
  { id: "AQMkADAwATM0MDAAMS1-receipt1", mid: "<ol-1@mail.exampleoutfitters.test>", fromName: "Example Outfitters", from: "hello@exampleoutfitters.test", subject: "Your order confirmation #OL-1", at: clock - 2 * DAY, body: receipt(1) },
  { id: "AQMkADAwATM0MDAAMS1-newsletter", mid: "<news-1@shop.test>", fromName: "Shop", from: "news@shop.test", subject: "50% off this weekend", at: clock - 3 * DAY, body: "Jumpers from £19.99 PRIVATE-BODY-MARKER-news" },
  // No order words in the subject, but sent from an orders@ address: read.
  { id: "AQMkADAwATM0MDAAMS1-receipt2", mid: "<ol-2@mail.exampleoutfitters.test>", fromName: "Example Outfitters", from: "orders@exampleoutfitters.test", subject: "We've got it, Jess!", at: clock - 40 * DAY, body: receipt(2) },
  { id: "AQMkADAwATM0MDAAMS1-friend", mid: "<friend@outlook.com>", fromName: "Sam", from: "sam@outlook.com", subject: "Dinner on Friday?", at: clock - 41 * DAY, body: "See you there PRIVATE-BODY-MARKER-friend" },
  { id: "AQMkADAwATM0MDAAMS1-receipt4==", mid: "<ol-4@mail.exampleoutfitters.test>", fromName: "Example Outfitters", from: "hello@exampleoutfitters.test", subject: "Thanks for your order", at: clock - 100 * DAY, html: htmlReceipt },
  // A fake "order" in Junk Email and a receipt the shopper deleted: Gmail never lists Spam or Bin, so neither is Outlook's.
  { id: "AQMkADAwATM0MDAAMS1-junk", mid: "<junk-1@scam.test>", fromName: "Parcel Team", from: "orders@scam.test", subject: "Your order confirmation #SC-1", at: clock - 5 * DAY, body: receipt(91), folder: "JUNK-FOLDER" },
  { id: "AQMkADAwATM0MDAAMS1-deleted", mid: "<ol-9@mail.exampleoutfitters.test>", fromName: "Example Outfitters", from: "hello@exampleoutfitters.test", subject: "Your order confirmation #OL-9", at: clock - 6 * DAY, body: receipt(9), folder: "DELETED-FOLDER" },
];
const graphCalls = [], tokenCalls = [];
let msRefreshOk = true, refreshIssued = 0;
let emails = [];
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  const method = init.method || "GET";
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  if (url === MS + "/token") {
    const p = new URLSearchParams(String(init.body));
    tokenCalls.push(Object.fromEntries(p));
    assert.equal(p.get("client_secret"), env.MICROSOFT_CLIENT_SECRET);
    if (p.get("grant_type") === "authorization_code") {
      assert.equal(p.get("redirect_uri"), "https://w.test/relay/microsoft/callback");
      const code = p.get("code");
      if (code.startsWith("signinmail-")) {
        assert.equal(p.get("scope"), "openid email profile " + OUTLOOK_SCOPE, "one step: sign-in and read-only mail asked together");
        const who = { email: "Amy.OneStep@outlook.com", preferred_username: "amy.onestep@outlook.com" };
        if (code === "signinmail-good") return Response.json({ id_token: idToken(claimsFor(who)), access_token: "a1", refresh_token: "MSREFRESH-ONESTEP-PLAINTEXT",
          scope: "openid email profile offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read" });
        if (code === "signinmail-noread") return Response.json({ id_token: idToken(claimsFor(who)), access_token: "a1", refresh_token: "MSREFRESH-NOREAD-PLAINTEXT", scope: "openid email profile" });
        return new Response('{"error":"invalid_grant"}', { status: 400 });
      }
      if (code.startsWith("signin-")) {
        assert.equal(p.get("scope"), "openid email profile", "sign-in asks only who you are");
        const over = { "signin-good": {}, "signin-gmail": { email: "jess@gmail.com", preferred_username: "jess@gmail.com" }, "signin-aud": { aud: "someone-else" },
          "signin-work": { tid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", iss: "https://login.microsoftonline.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0" },
          "signin-expired": { exp: Math.floor(clock / 1000) - 10 }, "signin-noemail": { email: undefined, preferred_username: "jess.phone@hotmail.co.uk" } }[code];
        if (!over) return new Response('{"error":"invalid_grant"}', { status: 400 });
        return Response.json({ id_token: idToken(claimsFor(over)), access_token: "signin-access", token_type: "Bearer" });
      }
      assert.equal(p.get("scope"), OUTLOOK_SCOPE);
      if (code === "mail-good") return Response.json({ access_token: "ms-access-1", refresh_token: "MSREFRESH-1-PLAINTEXT", scope: "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read" });
      if (code === "mail-narrow") return Response.json({ access_token: "a", refresh_token: "MSREFRESH-X-PLAINTEXT", scope: "https://graph.microsoft.com/User.Read" });
      return new Response('{"error":"invalid_grant"}', { status: 400 });
    }
    if (!msRefreshOk) return new Response('{"error":"invalid_grant"}', { status: 400 });
    refreshIssued++;
    // Microsoft hands back a new refresh token now and then; Relay must keep the newest.
    return Response.json(refreshIssued === 1 ? { access_token: "ms-access-2", refresh_token: "MSREFRESH-2-PLAINTEXT" } : { access_token: "ms-access-" + (refreshIssued + 1) });
  }
  if (url.startsWith("https://graph.microsoft.com/")) {
    graphCalls.push({ url, method, auth: init.headers && init.headers.Authorization });
    const u = new URL(url);
    if (u.pathname === "/v1.0/me") return Response.json({ mail: null, userPrincipalName: "jess.tester@outlook.com" });
    if (u.pathname === "/v1.0/me/messages" && u.searchParams.get("$search")) {
      const q = u.searchParams.get("$search").replace(/^"|"$/g, "").toLowerCase();
      const hits = [...box, ...hiddenBox].filter(m => (m.subject + " " + m.fromName + " " + m.from).toLowerCase().includes(q)).sort((a, b) => b.at - a.at);
      return Response.json({ value: hits.map(m => ({ id: m.id, internetMessageId: m.mid, subject: m.subject, from: { emailAddress: { name: m.fromName, address: m.from } }, receivedDateTime: iso(m.at), parentFolderId: m.folder || "INBOX-FOLDER" })) });
    }
    if (u.pathname === "/v1.0/me/messages") {
      const f = /^receivedDateTime ge (\S+) and receivedDateTime lt (\S+)$/.exec(u.searchParams.get("$filter") || "");
      assert.ok(f, "Outlook is listed one date window at a time");
      assert.equal(u.searchParams.get("$orderby"), "receivedDateTime desc");
      assert.equal(u.searchParams.get("$select"), "id,internetMessageId,subject,from,receivedDateTime,parentFolderId", "only subject, sender and folder are listed, never the body");
      const lo = Date.parse(f[1]), hi = Date.parse(f[2]), top = Number(u.searchParams.get("$top")), skip = Number(u.searchParams.get("$skip") || 0);
      const inWin = box.filter(m => m.at >= lo && m.at < hi).sort((a, b) => b.at - a.at);
      const page = inWin.slice(skip, skip + top);
      const next = skip + top < inWin.length ? (() => { const n = new URL(url); n.searchParams.set("$skip", String(skip + top)); return n.toString(); })() : undefined;
      return Response.json({ value: page.map(m => ({ id: m.id, internetMessageId: m.mid, subject: m.subject, from: { emailAddress: { name: m.fromName, address: m.from } }, receivedDateTime: iso(m.at), parentFolderId: m.folder || "INBOX-FOLDER" })), ...(next ? { "@odata.nextLink": next } : {}) });
    }
    // Which folders are Junk Email and Deleted Items (Relay leaves those out, as Gmail leaves out Spam and Bin).
    if (u.pathname === "/v1.0/me/mailFolders/junkemail") return Response.json({ id: "JUNK-FOLDER" });
    if (u.pathname === "/v1.0/me/mailFolders/deleteditems") return Response.json({ id: "DELETED-FOLDER" });
    const raw = /^\/v1\.0\/me\/messages\/([^/]+)\/\$value$/.exec(u.pathname);
    if (raw) {
      const m = [...box, ...hiddenBox].find(x => x.id === decodeURIComponent(raw[1]));
      return m ? new Response(mime(m), { status: 200, headers: { "content-type": "message/rfc822" } }) : new Response('{"error":{"code":"ErrorItemNotFound"}}', { status: 404 });
    }
    return new Response("blocked", { status: 500 });
  }
  if (url.startsWith("https://oauth2.googleapis.com/")) throw new Error("Google must not be called for an Outlook shopper: " + url);
  return new Response("blocked", { status: 500 });
};
const hiddenBox = [
  { id: "AQMkADAwATM0MDAAMS1-lulu77", mid: "<lulu-77@e.lululemon.test>", fromName: "lululemon", from: "hello@e.lululemon.test", subject: "Thanks for your lululemon order", at: clock - 420 * DAY,
    body: "Thanks for your Order, Jess!\nItems Purchased\nDefine Jacket\nNulu\n1 x 074897 / Size US 8\n£118.00\nOrder Total\n£118.00\nOrder Id: #UK04002516\nOrder Date\nNovember 19, 2025\nPRIVATE-BODY-MARKER-77\n" },
  { id: "AQMkADAwATM0MDAAMS1-lulu78", mid: "<lulu-78@e.lululemon.test>", fromName: "lululemon", from: "news@e.lululemon.test", subject: "New arrivals at lululemon", at: clock - 410 * DAY, body: "New jackets this week." },
  // Newer than the real one, but in Junk Email: Find leaves it out.
  { id: "AQMkADAwATM0MDAAMS1-lulujunk", mid: "<lulu-junk@scam.test>", fromName: "lululemon", from: "orders@lululemon-outlet.test", subject: "Your lululemon order is waiting", at: clock - 30 * DAY, body: receipt(92), folder: "JUNK-FOLDER" }
];

const call = (path, { method = "GET", body, token, ip = "1.1.1.1", e = env } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), e, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
const post = (path, token, body) => call(path, { method: "POST", token, body });
const loc = res => res.headers.get("location");
const NONCE = "N".repeat(43);

// ---- 1. Which sign-in buttons to show ----
let r = await call("/relay/auth/providers");
const pv = await r.json();
assert.deepEqual({ email: pv.email, google: pv.google, microsoft: pv.microsoft }, { email: true, google: true, microsoft: true });
assert.equal(pv.consent.version, CONSENT_VERSION, "the wording a one-step Microsoft sign-in agrees to is served with the buttons");
assert.deepEqual(pv.consent.text, CONSENT_TEXT);
const off = await (await call("/relay/auth/providers", { e: { ...env, MICROSOFT_CLIENT_ID: undefined } })).json();
assert.equal(off.microsoft, false, "no Microsoft button until it is set up");
assert.equal(off.consent.version, CONSENT_VERSION, "Google sign-in is still on, and it connects Gmail with the same wording");
const none = await (await call("/relay/auth/providers", { e: { ...env, MICROSOFT_CLIENT_ID: undefined, GOOGLE_CLIENT_ID: undefined } })).json();
assert.equal(none.consent, undefined, "no wording when neither one-step sign-in is on");
console.log("ok - the app is told whether Microsoft sign-in is switched on");

// ---- 2. Continue with Microsoft ----
async function msStart(nonce = NONCE, e = env) {
  const res = await call("/relay/auth/microsoft/start", { method: "POST", body: { nonce }, e });
  if (res.status !== 200) return { status: res.status };
  return { status: 200, url: new URL((await res.json()).url) };
}
const st = await msStart();
assert.equal(st.url.origin + st.url.pathname, MS + "/authorize", "personal Microsoft accounts (consumers)");
assert.equal(st.url.searchParams.get("scope"), "openid email profile", "sign-in gets no mail access");
assert.equal(st.url.searchParams.get("redirect_uri"), "https://w.test/relay/microsoft/callback");
assert.equal(st.url.searchParams.get("client_id"), env.MICROSOFT_CLIENT_ID);
assert.equal(st.url.searchParams.get("response_mode"), "query");
assert.equal((await msStart("short")).status, 400, "a browser nonce is required");
assert.equal((await msStart(NONCE, { ...env, MICROSOFT_CLIENT_SECRET: undefined })).status, 503, "not set up is reported honestly");
const mscb = qs => call("/relay/microsoft/callback?" + qs);
const signinToken = res => (/#signin=([A-Za-z0-9_-]{43})$/.exec(loc(res) || "") || [])[1];

let res = await mscb("code=signin-good&state=" + st.url.searchParams.get("state"));
assert.equal(res.status, 302);
const tokA = signinToken(res);
assert.ok(tokA, "Microsoft sends the browser back with a one-time sign-in token");
assert.match(loc(await mscb("code=signin-good&state=" + st.url.searchParams.get("state"))), /#msignin=failed$/, "state is single-use");
// The sign-in only works in the browser that started it.
let v = await call("/relay/auth/verify", { method: "POST", body: { token: tokA, nonce: "M".repeat(43) } });
assert.equal(v.status, 400, "another browser's nonce is refused");
const st2 = await msStart();
const tokB = signinToken(await mscb("code=signin-good&state=" + st2.url.searchParams.get("state")));
v = await call("/relay/auth/verify", { method: "POST", body: { token: tokB, nonce: NONCE } });
assert.equal(v.status, 200);
const jess = await v.json();
assert.equal(jess.email, "jess.tester@outlook.com", "the Outlook address, lower-cased");
const jessToken = jess.sessionToken;
assert.equal((await (await call("/relay/me", { token: jessToken })).json()).email, "jess.tester@outlook.com");
// Only addresses Microsoft itself hosts are trusted this way; anything else signs in by email link or code.
for (const [code, want] of [["signin-gmail", "other_address"], ["signin-aud", "failed"], ["signin-work", "failed"], ["signin-expired", "failed"], ["signin-bad", "failed"]]) {
  const s = await msStart();
  assert.match(loc(await mscb("code=" + code + "&state=" + s.url.searchParams.get("state"))), new RegExp("#msignin=" + want + "$"), code);
}
const sNo = await msStart();
const tokC = signinToken(await mscb("code=signin-noemail&state=" + sNo.url.searchParams.get("state")));
assert.equal((await (await call("/relay/auth/verify", { method: "POST", body: { token: tokC, nonce: NONCE } })).json()).email, "jess.phone@hotmail.co.uk", "the sign-in name is used when there is no email claim");
const sDeny = await msStart();
assert.match(loc(await mscb("error=access_denied&state=" + sDeny.url.searchParams.get("state"))), /#msignin=denied$/);
assert.match(loc(await mscb("code=signin-good&state=" + "x".repeat(43))), /#outlook=failed$/, "an unknown state is never a sign-in");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM shoppers WHERE email LIKE '%gmail.com'").get().n, 0, "no account was made for the unverified address");
console.log("ok - Continue with Microsoft: personal accounts, Outlook/Hotmail/Live addresses only, single-use, tied to the browser that started it");

// ---- 3. Connect Outlook: consent first, state bound to the shopper ----
assert.equal((await post("/relay/my/gmail/connect", jessToken, { provider: "microsoft" })).status, 403, "no mailbox without consent");
let consent = await (await call("/relay/my/consent", { token: jessToken })).json();
assert.equal(consent.outlookAvailable, true);
assert.equal(consent.acceptedEarlier, false);
assert.ok(consent.text.join(" ").includes("Gmail or Outlook"), "the wording names Outlook");
assert.deepEqual(consent.text, CONSENT_TEXT);
assert.equal((await post("/relay/my/consent", jessToken, { version: CONSENT_VERSION })).status, 200);
assert.equal((await post("/relay/my/gmail/connect", jessToken, { provider: "microsoft" }).then(x => x.status)), 200);
assert.equal((await call("/relay/my/gmail/connect", { method: "POST", token: jessToken, body: { provider: "microsoft" }, e: { ...env, MICROSOFT_CLIENT_ID: undefined } })).status, 503);
const connectUrl = async () => new URL((await (await post("/relay/my/gmail/connect", jessToken, { provider: "microsoft" })).json()).url);
const cu = await connectUrl();
assert.equal(cu.origin + cu.pathname, MS + "/authorize");
assert.equal(cu.searchParams.get("scope"), OUTLOOK_SCOPE);
assert.equal(OUTLOOK_SCOPE, "offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read", "read-only mail");
assert.equal(cu.searchParams.get("login_hint"), "jess.tester@outlook.com");
assert.equal(cu.searchParams.get("redirect_uri"), "https://w.test/relay/microsoft/callback");
const mstate = cu.searchParams.get("state");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gmail_oauth_states WHERE state_hash = ?").get(mstate).n, 0, "raw state never stored");
assert.match(loc(await mscb("error=access_denied&state=" + mstate)), /#outlook=denied$/);
assert.match(loc(await mscb("code=mail-narrow&state=" + mstate)), /#outlook=failed$/, "mail read access must have been granted");
// A Google state can't finish an Outlook connection, nor an Outlook state a Gmail one.
const gstate = new URL((await (await post("/relay/my/gmail/connect", jessToken)).json()).url).searchParams.get("state");
assert.match(loc(await mscb("code=mail-good&state=" + gstate)), /#outlook=failed$/);
const cu2 = await connectUrl();
assert.match(loc(await call("/relay/gmail/callback?code=good-code&state=" + cu2.searchParams.get("state"))), /#gmail=failed$/);
const cu3 = await connectUrl();
assert.match(loc(await mscb("code=mail-good&state=" + cu3.searchParams.get("state"))), /#outlook=connected$/);
assert.match(loc(await mscb("code=mail-good&state=" + cu3.searchParams.get("state"))), /#outlook=failed$/, "single-use");
let g = await (await call("/relay/my/gmail", { token: jessToken })).json();
assert.equal(g.connected, true);
assert.equal(g.provider, "microsoft");
assert.equal(g.email, "jess.tester@outlook.com");
assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM gmail_connections").all()).includes("PLAINTEXT"), "refresh token never stored in clear");
console.log("ok - Connect Outlook: consent first, read-only scope, state single-use and bound to the shopper and to Microsoft");

// ---- 4. Reading: only likely receipts are opened; only extracted details are kept ----
assert.equal(looksLikeShopping("Your order confirmation #12", "x@y.test"), true);
assert.equal(looksLikeShopping("Dinner on Friday?", "sam@outlook.com"), false);
assert.equal(looksLikeShopping("Something for you", "no-reply@royalmail.com"), true, "carriers' parcel emails");
assert.equal(looksLikeShopping("Hi", "orders@shop.test"), true);
const scanAll = async (max = 80, full = false) => {
  const tot = { added: 0, updated: 0, alreadyCaptured: 0, notReceipts: 0, rounds: 0 };
  let cursor, j;
  do {
    const sr = await post("/relay/my/gmail/scan", jessToken, { ...(cursor ? { cursor } : {}), ...(full ? { full: true } : {}) });
    assert.equal(sr.status, 200, "scan round answers");
    j = await sr.json();
    for (const k of ["added", "updated", "alreadyCaptured", "notReceipts"]) tot[k] += j[k];
    tot.rounds++; cursor = j.cursor;
    assert.ok(tot.rounds < max, "scan finishes");
  } while (j.more);
  return tot;
};
graphCalls.length = 0;
let t = await scanAll();
assert.equal(t.added, 2, "two receipts found");
assert.equal(t.notReceipts, 1, "the orders@ email was opened, but without order words in its subject the reader doesn't call it a receipt (same rule as Gmail)");
const opened = graphCalls.filter(c => c.url.endsWith("/$value")).map(c => decodeURIComponent(c.url.split("/messages/")[1].replace("/$value", ""))).sort();
assert.deepEqual(opened, ["AQMkADAwATM0MDAAMS1-receipt1", "AQMkADAwATM0MDAAMS1-receipt2", "AQMkADAwATM0MDAAMS1-receipt4=="], "the newsletter and the friend's email were never opened");
assert.ok(graphCalls.every(c => c.method === "GET"), "only reads: Relay never sends, moves or deletes Outlook mail");
assert.ok(graphCalls.every(c => /^Bearer ms-access-\d$/.test(c.auth)));
assert.ok(tokenCalls.some(c => c.grant_type === "refresh_token" && c.refresh_token === "MSREFRESH-1-PLAINTEXT"));
let dump = JSON.stringify(sqlite.prepare("SELECT * FROM captured_receipts").all());
assert.ok(!dump.includes("PRIVATE-BODY-MARKER"), "email text is never stored");
assert.ok(dump.includes("OL-1") && dump.includes("OL-4") && !dump.includes("OL-2"));
assert.ok(dump.includes("outlookId") && !dump.includes("gmailId"), "each receipt remembers where it lives in Outlook");
// Microsoft rotated the refresh token: the new one is the one used next time.
tokenCalls.length = 0;
t = await scanAll();
assert.equal(t.added, 0);
assert.ok(tokenCalls.length && tokenCalls.every(c => c.refresh_token === "MSREFRESH-2-PLAINTEXT"), "the newest refresh token is kept");
// An email moved to another folder gets a new Outlook id but keeps its Message-ID: not counted twice.
box[0] = { ...box[0], id: "AQMkADAwATM0MDAAMS1-receipt1-moved" };
t = await scanAll(80, true);
assert.equal(t.added, 0, "a moved email is the same email");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts WHERE status <> 'not_receipt'").get().n, 2);
console.log("ok - Outlook scan: only likely receipts opened, only details kept, newest token kept, moved emails not doubled");

// ---- 5. A very busy inbox: more than a round can list in one window, the receipt at the far end is still found ----
// All inside one 30-day reading window: 1,100 newsletters over five days, and a receipt the day before them.
const T0 = Date.parse(new Date(clock + DAY).toISOString().slice(0, 10) + "T00:00:00Z"), winTop = T0 - 180 * DAY;
for (let i = 0; i < 1100; i++) box.push({ id: "AQMkADAwATM0MDAAMS1-busy" + i, mid: `<busy-${i}@news.test>`, fromName: "News", from: "news@news.test", subject: "Weekly news " + i, at: winTop - 2 * DAY - i * 6.5 * 60 * 1000, body: "news" });
box.push({ id: "AQMkADAwATM0MDAAMS1-receipt5", mid: "<ol-5@mail.exampleoutfitters.test>", fromName: "Example Outfitters", from: "hello@exampleoutfitters.test", subject: "Your order confirmation #OL-5", at: winTop - 8 * DAY, body: receipt(5) });
t = await scanAll(120, true);
assert.equal(t.added, 1, "the receipt behind 1,100 newsletters in the same month is found");
assert.ok(JSON.stringify(sqlite.prepare("SELECT details FROM captured_receipts").all()).includes("OL-5"));
console.log("ok - a busy Outlook inbox is read all the way through, a little at a time");

// ---- 6. The original email, shown from Outlook ----
const list = (await (await call("/relay/my/receipts", { token: jessToken })).json()).receipts;
const r4 = list.find(x => x.orderRef === "OL-4");
assert.ok(r4 && r4.outlookId, "receipt card carries its Outlook id");
const orig = await call("/relay/my/receipts/" + r4.id + "/original", { token: jessToken });
assert.equal(orig.status, 200);
const ob = await orig.json();
assert.ok(ob.html.includes("Order OL-4"));
assert.ok(!/<script|onload=/i.test(ob.html), "scripts and handlers removed");
assert.ok(ob.html.includes('src="data:image/png;base64,'), "the QR code inside the email is shown in place");
assert.deepEqual(ob.links, [{ label: "Start a return", url: "https://shop.test/returns" }]);
assert.equal((await call("/relay/my/receipts/" + r4.id + "/original", { token: (jess.sessionToken[0] === "Z" ? "Y" : "Z") + jess.sessionToken.slice(1) })).status, 401);
const parts = mimeParts(mime(box.find(m => m.id.endsWith("receipt4=="))));
assert.equal(parts.images.length, 1); assert.equal(parts.images[0].cid, "qr1"); assert.equal(parts.html.length, 1);
console.log("ok - View original receipt works for Outlook emails, cleaned and with their own pictures");

// ---- 7. Find a missing receipt in Outlook, add it by hand; it is never added twice ----
let f = await (await post("/relay/my/gmail/find", jessToken, { query: "lululemon" })).json();
assert.equal(f.results[0].subject, "Thanks for your lululemon order", "order emails first");
assert.ok(!f.results.some(x => x.id.endsWith("lulujunk")), "Find leaves out Junk Email, as Gmail's search leaves out Spam");
assert.equal(f.results[0].added, false);
let a = await (await post("/relay/my/gmail/add", jessToken, { messageId: f.results[0].id })).json();
assert.equal(a.ok, true); assert.equal(a.orderRef, "UK04002516");
f = await (await post("/relay/my/gmail/find", jessToken, { query: "lululemon" })).json();
assert.equal(f.results[0].added, true, "shown as added");
assert.equal((await post("/relay/my/gmail/add", jessToken, { messageId: "m77abcdef" })).status, 400, "a Gmail id is not an Outlook email");
assert.equal((await post("/relay/my/gmail/add", jessToken, { messageId: "AQMkADAwATM0MDAAMS1-missing" })).status, 404);
assert.ok(!JSON.stringify(sqlite.prepare("SELECT details FROM captured_receipts").all()).includes("PRIVATE-BODY-MARKER-77"));
console.log("ok - Find a missing receipt searches Outlook and adds the chosen email once");

// ---- 8. Automatic checking works for Outlook too ----
box.push({ id: "AQMkADAwATM0MDAAMS1-receipt6", mid: "<ol-6@mail.exampleoutfitters.test>", fromName: "Example Outfitters", from: "hello@exampleoutfitters.test", subject: "Your order confirmation #OL-6", at: clock - 3600e3, body: receipt(6) });
const auto = await autoScanGmail(env, clock, fetchImpl);
assert.equal(auto.checked, 1);
assert.ok(JSON.stringify(sqlite.prepare("SELECT details FROM captured_receipts").all()).includes("OL-6"), "new Outlook mail found automatically");
console.log("ok - automatic checks read Outlook");

// ---- 9. Microsoft stops accepting the token: the shopper is asked to reconnect, nothing breaks ----
msRefreshOk = false;
const busy = await post("/relay/my/gmail/scan", jessToken, {});
assert.equal(busy.status, 401);
assert.equal((await busy.json()).error, "gmail_reconnect_needed");
const olState = async () => (await call("/relay/my/gmail", { token: jessToken })).json();
assert.equal((await olState()).needsReconnect, true, "the app is told Outlook needs connecting again");
// Connect again: Microsoft's own page for that same inbox; it comes back connected again, receipts kept.
const olKept = sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts WHERE status <> 'not_receipt'").get().n;
const againMs = new URL((await (await post("/relay/my/gmail/connect", jessToken, { again: 1 })).json()).url);
assert.equal(againMs.origin, "https://login.microsoftonline.com");
assert.equal(againMs.searchParams.get("login_hint"), "jess.tester@outlook.com", "Microsoft suggests that same inbox");
msRefreshOk = true;
assert.match(loc(await mscb("code=mail-good&state=" + againMs.searchParams.get("state"))), /#outlook=reconnected$/);
assert.equal((await olState()).needsReconnect, false);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts WHERE status <> 'not_receipt'").get().n, olKept, "receipts kept");
console.log("ok - Outlook whose access ended says so, and Connect again brings it back with its receipts");

// ---- 10. Disconnect deletes the token and everything captured (no Google call is made) ----
const d = await (await post("/relay/my/gmail/disconnect", jessToken)).json();
assert.equal(d.ok, true); assert.equal(d.provider, "microsoft"); assert.equal(d.revokedAtGoogle, false);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gmail_connections").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts").get().n, 0);
assert.equal((await (await call("/relay/my/gmail", { token: jessToken })).json()).connected, false);
console.log("ok - Disconnect Outlook deletes the token and every captured receipt");

// ---- 11. Someone who agreed to the earlier (Gmail-only) wording is asked again, and told why ----
const bobRow = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("jess.phone@hotmail.co.uk");
sqlite.prepare("INSERT INTO shopper_consents (shopper_id, version, text_hash, accepted_at) VALUES (?,?,?,?)").run(bobRow.id, "2026-10-v4", "x".repeat(64), clock - 9 * DAY);
const s4 = await msStart();
const tokD = signinToken(await mscb("code=signin-noemail&state=" + s4.url.searchParams.get("state")));
const bob = (await (await call("/relay/auth/verify", { method: "POST", body: { token: tokD, nonce: NONCE } })).json()).sessionToken;
consent = await (await call("/relay/my/consent", { token: bob })).json();
assert.equal(consent.accepted, false, "the new wording must be agreed to");
assert.equal(consent.acceptedEarlier, true);
assert.equal((await post("/relay/my/gmail/scan", bob, {})).status, 403, "no reading on the old agreement");
console.log("ok - a changed wording is agreed to again before any more reading");

// ---- 12. One step: "Agree and continue with Microsoft" signs in AND connects Outlook ----
const oneStep = async (body = { nonce: NONCE, consentVersion: CONSENT_VERSION }) => {
  const res = await call("/relay/auth/microsoft/start", { method: "POST", body });
  return res.status === 200 ? new URL((await res.json()).url) : res.status;
};
assert.equal(await oneStep({ nonce: NONCE, consentVersion: "2026-10-v4" }), 400, "only the wording being shown now can be agreed to");
const u1 = await oneStep();
assert.equal(u1.searchParams.get("scope"), "openid email profile " + OUTLOOK_SCOPE, "sign-in and read-only mail in one Microsoft screen");
const tokE = signinToken(await mscb("code=signinmail-good&state=" + u1.searchParams.get("state")));
assert.ok(tokE);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_pending_mailbox").get().n, 1, "the mailbox waits for the browser to finish signing in");
assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM auth_pending_mailbox").all()).includes("PLAINTEXT"), "and is held encrypted");
// Finished in a different browser: refused, and nothing is connected or agreed for anyone.
assert.equal((await call("/relay/auth/verify", { method: "POST", body: { token: tokE, nonce: "M".repeat(43) } })).status, 400);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gmail_connections").get().n, 0, "nothing connected by a sign-in finished elsewhere");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM shoppers WHERE email = 'amy.onestep@outlook.com'").get().n, 0);
// Finished in the browser that showed the wording: signed in, agreement recorded and Outlook connected together.
const u2 = await oneStep();
const tokF = signinToken(await mscb("code=signinmail-good&state=" + u2.searchParams.get("state")));
const vr = await (await call("/relay/auth/verify", { method: "POST", body: { token: tokF, nonce: NONCE } })).json();
assert.equal(vr.outlookConnected, true); assert.equal(vr.email, "amy.onestep@outlook.com");
const amy = vr.sessionToken;
assert.equal((await (await call("/relay/my/consent", { token: amy })).json()).accepted, true, "agreement recorded against the wording shown at sign-in");
g = await (await call("/relay/my/gmail", { token: amy })).json();
assert.deepEqual([g.connected, g.provider, g.email], [true, "microsoft", "amy.onestep@outlook.com"], "Outlook connected, no second step");
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_pending_mailbox").get().n, 1, "the used one is gone (only the abandoned attempt is left, until it expires)");
tokenCalls.length = 0;
assert.equal((await post("/relay/my/gmail/scan", amy, {})).status, 200, "reading starts straight away");
assert.ok(tokenCalls.some(c => c.refresh_token === "MSREFRESH-ONESTEP-PLAINTEXT"), "with the token from the sign-in");
// Signing in the same way again keeps the mailbox's place (no full re-read).
sqlite.prepare("UPDATE gmail_connections SET last_scan_at = ? WHERE google_email = 'amy.onestep@outlook.com'").run(clock - 3600e3);
const u3 = await oneStep();
const tokG = signinToken(await mscb("code=signinmail-good&state=" + u3.searchParams.get("state")));
assert.equal((await (await call("/relay/auth/verify", { method: "POST", body: { token: tokG, nonce: NONCE } })).json()).outlookConnected, true);
assert.equal(sqlite.prepare("SELECT last_scan_at t FROM gmail_connections WHERE google_email = 'amy.onestep@outlook.com'").get().t, clock - 3600e3, "same mailbox carries on");
// If Microsoft didn't grant mail access, the shopper is still signed in, just without Outlook connected.
sqlite.prepare("DELETE FROM gmail_connections").run();
const u4 = await oneStep();
const tokH = signinToken(await mscb("code=signinmail-noread&state=" + u4.searchParams.get("state")));
const vn = await (await call("/relay/auth/verify", { method: "POST", body: { token: tokH, nonce: NONCE } })).json();
assert.ok(vn.sessionToken && !vn.outlookConnected);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM gmail_connections").get().n, 0);
// Abandoned attempts are cleared once they expire.
clock += 16 * 60 * 1000;
await oneStep();
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM auth_pending_mailbox").get().n, 0, "expired waiting mailboxes are deleted");
console.log("ok - one step: Agree and continue with Microsoft signs in and connects Outlook, only in the browser that showed the wording");
console.log("PASS Outlook: Microsoft sign-in and Outlook receipt reading (FAKE Microsoft and Outlook)");
