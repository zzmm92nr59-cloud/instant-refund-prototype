// Offline tests for more than one inbox per shopper, against a real SQLite engine. Google is FAKED here, with separate
// accounts (each with its own key and its own emails): this proves Relay's own rules, not that real Google behaves so.
// Checks: a second inbox is connected through Google's account picker (no address filled in) and kept apart from the
// first; the same inbox can't be connected twice; at most five; every inbox is read (in the background, and by the regular
// check) with its receipts kept under the shopper, marked with the inbox they came from; the search looks in every inbox at
// once and Add and "open the original" use the inbox the email is in; disconnecting one inbox removes only its receipts
// (receipts pasted in by hand stay); disconnecting the first moves the next one into its place; withdrawing permission and
// deleting the account remove every inbox; Download my data lists them; nobody can touch another shopper's inboxes.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { runScanJobs, autoScanGmail, MAX_INBOXES } from "../worker/gmail.js";

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
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test",
  MICROSOFT_CLIENT_ID: "11111111-2222-3333-4444-555555555555", MICROSOFT_CLIENT_SECRET: "ms-secret-test" };

let clock = 1_800_000_000_000;
const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "/");
const order = (shop, domain, ref, item, pence) => `From: ${shop} <orders@${domain}>\nSubject: Your order confirmation #${ref}\nContent-Type: text/plain\n\nOrder number: ${ref}\nOrder date: 14 Oct 2026\n${item} - Qty 1 - £${(pence / 100).toFixed(2)}\nOrder total: £${(pence / 100).toFixed(2)}\nReturns accepted within 30 days of purchase.\nPRIVATE-BODY-${ref}\n`;
const newsletter = `From: Kestrel Outdoor <news@kestreloutdoor.test>\nSubject: New season: the trail range is back\nContent-Type: text/plain\n\nTake a look at the new range.`;
// Each Google account: the code its sign-in returns, its keys, its address and its emails (made-up shops).
const ACCOUNTS = {
  A: { email: "alice.main@gmail.com", box: { a1aaaaaa: order("Kestrel Outdoor", "kestreloutdoor.test", "KO-1001", "Trail Runner Shoes", 8900), a2aaaaaa: newsletter } },
  B: { email: "alice.work@gmail.com", box: { b1bbbbbb: order("Harlow and Co", "harlowandco.test", "HC-2001", "Wool Coat", 12000), b2bbbbbb: order("Fernway Books", "fernwaybooks.test", "FB-3001", "Linen Notebook", 1800) } },
  C: { email: "alice.c@gmail.com", box: {} }, D: { email: "alice.d@gmail.com", box: {} }, E: { email: "alice.e@gmail.com", box: {} }, F: { email: "alice.f@gmail.com", box: {} },
  Z: { email: "bob@gmail.com", box: {} },
};
const byAccess = token => Object.entries(ACCOUNTS).find(([k]) => token === "Bearer access-" + k);
// An Outlook.com inbox (Microsoft Graph, FAKED): its emails by Graph id, each with its own Message-ID.
const OUTLOOK = { email: "alice.home@outlook.com", box: {
  AAMkOutlookMsg0001: { mid: "<sn-88@studionorth.test>", from: "orders@studionorth.test", name: "Studio North", subject: "Your order confirmation #SN-4001", body: "Order number: SN-4001\nOrder date: 14 Oct 2026\nLinen Shirt - Qty 1 - £45.00\nOrder total: £45.00\nReturns accepted within 30 days of purchase.\n" } } };
const GRAPH = "https://graph.microsoft.com/v1.0";
const revoked = [], emails = [], ended = new Set();
const b64url = s => Buffer.from(s).toString("base64url");
const header = (raw, k) => (new RegExp("^" + k + ": (.*)$", "m").exec(raw) || [])[1] || "";
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  const auth = init.headers && (init.headers.Authorization || init.headers.authorization);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  if (url === "https://oauth2.googleapis.com/token") {
    const p = new URLSearchParams(String(init.body));
    if (p.get("grant_type") === "authorization_code") {
      const k = (/^code-([A-Z])$/.exec(p.get("code") || "") || [])[1];
      return k ? Response.json({ access_token: "access-" + k, refresh_token: "refresh-" + k, scope: "https://www.googleapis.com/auth/gmail.readonly" }) : new Response("{}", { status: 400 });
    }
    const k = (/^refresh-([A-Z])$/.exec(p.get("refresh_token") || "") || [])[1];
    // An account whose sign-in Google has ended (it expired, or was taken back): Google's own answer.
    if (k && ended.has(k)) return Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 });
    return k ? Response.json({ access_token: "access-" + k }) : new Response("{}", { status: 400 });
  }
  if (url === "https://oauth2.googleapis.com/revoke") { revoked.push(new URLSearchParams(String(init.body)).get("token")); return new Response("{}", { status: 200 }); }
  if (url === "https://login.microsoftonline.com/consumers/oauth2/v2.0/token") {
    const p = new URLSearchParams(String(init.body));
    const ok = p.get("grant_type") === "authorization_code" ? p.get("code") === "code-M" : p.get("refresh_token") === "refresh-M";
    return ok ? Response.json({ access_token: "access-M", refresh_token: "refresh-M", scope: "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read offline_access" }) : new Response("{}", { status: 400 });
  }
  if (url.startsWith(GRAPH)) {
    if (auth !== "Bearer access-M") return new Response("{}", { status: 401 });
    if (url.startsWith(GRAPH + "/me?")) return Response.json({ mail: OUTLOOK.email });
    if (url.startsWith(GRAPH + "/me/mailFolders/")) return Response.json({ id: url.includes("junkemail") ? "JUNK" : "BIN" });
    const one = /\/me\/messages\/([A-Za-z0-9]+)\/\$value$/.exec(url);
    if (one) { const m = OUTLOOK.box[one[1]]; return m ? new Response(`From: ${m.name} <${m.from}>\r\nSubject: ${m.subject}\r\nMessage-ID: ${m.mid}\r\nDate: ${new Date(clock - 2 * 864e5).toUTCString()}\r\nContent-Type: text/plain\r\n\r\n${m.body}`) : new Response("{}", { status: 404 }); }
    if (url.startsWith(GRAPH + "/me/messages?")) {
      const search = new URL(url).searchParams.get("$search");
      const ids = Object.keys(OUTLOOK.box).filter(id => !search || JSON.stringify(OUTLOOK.box[id]).toLowerCase().includes(search.replace(/"/g, "").toLowerCase()));
      return Response.json({ value: ids.map(id => ({ id, internetMessageId: OUTLOOK.box[id].mid, subject: OUTLOOK.box[id].subject, parentFolderId: "INBOX",
        from: { emailAddress: { name: OUTLOOK.box[id].name, address: OUTLOOK.box[id].from } }, receivedDateTime: new Date(clock - 2 * 864e5).toISOString() })) });
    }
    return new Response("{}", { status: 404 });
  }
  const acct = byAccess(auth);
  if (!url.startsWith("https://gmail.googleapis.com/")) return new Response("blocked", { status: 500 });
  if (!acct) return new Response("{}", { status: 401 });
  const box = acct[1].box;
  if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") return Response.json({ emailAddress: acct[1].email });
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
    const q = decodeURIComponent(new URL(url).searchParams.get("q") || "");
    const win = /after:(\d{4}\/\d{2}\/\d{2}) before:(\d{4}\/\d{2}\/\d{2})/.exec(q);
    if (win) { const d = ymd(clock - 2 * 864e5); return Response.json({ messages: d >= win[1] && d < win[2] ? Object.keys(box).map(id => ({ id })) : [] }); }
    const word = q.split(/\s+/)[0].toLowerCase();
    return Response.json({ messages: Object.keys(box).filter(id => box[id].toLowerCase().includes(word)).map(id => ({ id })) });
  }
  const m = /messages\/([a-z0-9]+)\?format=(raw|metadata|full)/.exec(url);
  if (m) {
    const raw = box[m[1]];
    if (!raw) return new Response("{}", { status: 404 });
    if (m[2] === "raw") return Response.json({ raw: b64url(raw) });
    if (m[2] === "metadata") return Response.json({ internalDate: String(clock - 2 * 864e5), payload: { headers: [{ name: "Subject", value: header(raw, "Subject") }, { name: "From", value: header(raw, "From") }] } });
    return Response.json({ payload: { mimeType: "text/html", body: { data: b64url("<p>" + header(raw, "Subject") + "</p>") } } });
  }
  return new Response("blocked", { status: 500 });
};
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
const post = (path, token, body) => call(path, { method: "POST", token, body });
const get = async (path, token) => (await call(path, { token })).json();
async function signIn(email, ip) {
  emails.length = 0;
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const alice = await signIn("alice@example.com", "5.5.5.5"), bob = await signIn("bob@example.com", "6.6.6.6");
const aliceId = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("alice@example.com").id;
const { CONSENT_VERSION } = await import("../worker/gmail.js");
for (const t of [alice, bob]) assert.equal((await post("/relay/my/consent", t, { version: CONSENT_VERSION })).status, 200);
const loc = res => res.headers.get("location");
// Starts a connection and comes back from (fake) Google signed in as the given account.
const connect = async (token, account, another) => {
  const r = await post("/relay/my/gmail/connect", token, another ? { another: true } : {});
  if (r.status !== 200) return { status: r.status, body: await r.json() };
  const u = new URL((await r.json()).url);
  return { url: u, back: loc(await call("/relay/gmail/callback?code=code-" + account + "&state=" + u.searchParams.get("state"))) };
};
const receiptsOf = async token => (await get("/relay/my/receipts?all=1", token)).receipts;
const refsOf = rows => rows.map(r => r.orderRef).filter(Boolean).sort();
const runJobs = async () => { for (let i = 0; i < 6; i++) await runScanJobs(env, clock, fetchImpl, { clock: () => clock }); };

// 1. The first inbox, then a second through Google's account picker (no address filled in).
assert.match((await connect(alice, "A")).back, /#gmail=connected$/);
const second = await connect(alice, "B", true);
assert.equal(second.url.searchParams.get("prompt"), "consent select_account", "Google shows its account picker");
assert.equal(second.url.searchParams.get("login_hint"), null, "with no address filled in");
assert.match(second.back, /#gmail=added$/);
let st = await get("/relay/my/gmail", alice);
assert.equal(st.email, "alice.main@gmail.com");
assert.deepEqual(st.others.map(o => [o.mailbox, o.email, o.provider]), [[2, "alice.work@gmail.com", "google"]]);
assert.equal(st.maxInboxes, MAX_INBOXES);
assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM gmail_connections").all()).includes("refresh-B"), "the second inbox's key is kept encrypted too");
// The same inbox can't be connected twice (as another inbox, or by connecting it as the first again).
assert.match((await connect(alice, "B", true)).back, /#gmail=already_connected$/);
assert.match((await connect(alice, "A", true)).back, /#gmail=already_connected$/);
assert.match((await connect(alice, "B")).back, /#gmail=already_connected$/);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM gmail_connections WHERE shopper_id = ? OR shopper_id LIKE ?").get(aliceId, aliceId + "~%").n, 2);
assert.deepEqual((await get("/relay/my/gmail", bob)).others, [], "Bob sees none of Alice's inboxes");
console.log("ok - a second inbox is added through Google's account picker; the same inbox can't be added twice");

// 2. Both inboxes are read: the first by the app, the second in the background; receipts kept under Alice, marked by inbox.
let res, cursor;
do { res = await (await post("/relay/my/gmail/scan", alice, cursor ? { cursor } : {})).json(); cursor = res.cursor; } while (res.more);
await runJobs();
let rows = await receiptsOf(alice);
assert.deepEqual(refsOf(rows), ["FB-3001", "HC-2001", "KO-1001"], "receipts from both inboxes");
const fromB = rows.find(r => r.orderRef === "HC-2001"), fromA = rows.find(r => r.orderRef === "KO-1001");
assert.equal(fromB.mailbox, 2, "marked with the inbox it came from"); assert.equal(fromA.mailbox, undefined, "the first inbox's receipts are as before");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM captured_receipts WHERE shopper_id LIKE '%~%'").get().n, 0, "nothing is kept under an inbox's own id");
assert.ok(!JSON.stringify(sqlite.prepare("SELECT details FROM captured_receipts").all()).includes("PRIVATE-BODY"), "the emails' text isn't kept");
assert.deepEqual(await receiptsOf(bob), [], "and none of it is Bob's");
console.log("ok - both inboxes are read (the second in the background), receipts kept under the shopper and marked by inbox");

// 3. The regular check covers every inbox; a new email in the second inbox arrives by itself.
ACCOUNTS.B.box.b3bbbbbb = order("Harlow and Co", "harlowandco.test", "HC-2002", "Silk Scarf", 4500);
clock += 15 * 60 * 1000;
for (let i = 0; i < 3; i++) await autoScanGmail(env, clock, fetchImpl);
assert.ok(refsOf(await receiptsOf(alice)).includes("HC-2002"), "picked up by the regular check");
// Checking now from the app checks the other inboxes too (in the background, not more than every few minutes).
ACCOUNTS.B.box.b4bbbbbb = order("Fernway Books", "fernwaybooks.test", "FB-3002", "Fountain Pen", 3200);
clock += 6 * 60 * 1000;
do { res = await (await post("/relay/my/gmail/scan", alice, {})).json(); } while (res.more);
await runJobs();
assert.ok(refsOf(await receiptsOf(alice)).includes("FB-3002"), "Check now reached the second inbox");
console.log("ok - the regular check and Check now cover every inbox");

// 4. Search looks in every inbox at once, taking turns; Add and the original email use the inbox the email is in.
const found = await (await post("/relay/my/gmail/find", alice, { query: "order" })).json();
assert.deepEqual(found.results.map(x => [x.id, x.mailbox || 1, x.inbox]).slice(0, 2), [["a1aaaaaa", 1, "alice.main@gmail.com"], ["b1bbbbbb", 2, "alice.work@gmail.com"]], "each inbox's best match near the top");
assert.ok(found.results.every(x => x.added), "already added, wherever they are");
ACCOUNTS.B.box.b5bbbbbb = order("Kestrel Outdoor", "kestreloutdoor.test", "KO-1002", "Rain Jacket", 9900).replace("Your order confirmation", "Thanks for your purchase");
const k = (await (await post("/relay/my/gmail/find", alice, { query: "jacket" })).json()).results;
assert.deepEqual(k.map(x => [x.id, x.mailbox]), [["b5bbbbbb", 2]]);
const added = await (await post("/relay/my/gmail/add", alice, { messageId: "b5bbbbbb", mailbox: 2 })).json();
assert.ok(added.ok && added.orderRef === "KO-1002", JSON.stringify(added));
assert.equal((await receiptsOf(alice)).find(r => r.orderRef === "KO-1002").mailbox, 2);
assert.equal((await post("/relay/my/gmail/add", alice, { messageId: "b5bbbbbb" })).status, 404, "not in the first inbox");
const orig = await call(`/relay/my/receipts/${fromB.id}/original`, { token: alice });
assert.equal(orig.status, 200, "the original opens from the second inbox");
assert.equal((await call(`/relay/my/receipts/${fromB.id}/original`, { token: bob })).status, 404, "never for another shopper");
assert.equal((await post("/relay/my/gmail/find", bob, { query: "order" })).status, 409, "Bob has no inbox, so nothing to search");
console.log("ok - search covers every inbox; Add and the original email use the inbox the email is in");

// 4b. An Outlook inbox alongside the Gmail ones: Microsoft's account picker, read in the background, searched with the rest.
const ms = await post("/relay/my/gmail/connect", alice, { provider: "microsoft", another: true });
const msUrl = new URL((await ms.json()).url);
assert.equal(msUrl.searchParams.get("prompt"), "select_account"); assert.equal(msUrl.searchParams.get("login_hint"), null);
assert.match(loc(await call("/relay/microsoft/callback?code=code-M&state=" + msUrl.searchParams.get("state"))), /#outlook=added$/);
st = await get("/relay/my/gmail", alice);
assert.deepEqual(st.others.map(o => [o.mailbox, o.email, o.provider]), [[2, "alice.work@gmail.com", "google"], [3, "alice.home@outlook.com", "microsoft"]]);
await runJobs();
const sn = (await receiptsOf(alice)).find(r => r.orderRef === "SN-4001");
assert.ok(sn && sn.mailbox === 3, "the Outlook inbox's receipt, marked as inbox 3");
const mixed = (await (await post("/relay/my/gmail/find", alice, { query: "shirt" })).json()).results;
assert.deepEqual(mixed.map(x => [x.id, x.mailbox, x.inbox]), [["AAMkOutlookMsg0001", 3, "alice.home@outlook.com"]]);
assert.equal((await post("/relay/my/gmail/disconnect", alice, { mailbox: 3 })).status, 200);
assert.ok(!(await receiptsOf(alice)).some(r => r.orderRef === "SN-4001"), "its receipts go with it");
console.log("ok - an Outlook inbox works alongside Gmail ones: added, read, searched and removed on its own");

// 4c. Connect again: an inbox whose access Google ended says so, and connecting it again keeps its place and its receipts.
ended.add("B");
clock += 10 * 60 * 1000;   // Check now reads the other inboxes at most every few minutes
await post("/relay/my/gmail/scan", alice); await runJobs();
st = await get("/relay/my/gmail", alice);
assert.equal(st.needsReconnect, false, "the first inbox is fine");
assert.deepEqual(st.others.map(o => [o.mailbox, o.email, o.needsReconnect]), [[2, "alice.work@gmail.com", true]], "the second says it needs connecting again");
assert.equal((await post("/relay/my/gmail/connect", bob, { again: 2 })).status, 409, "Bob can't connect Alice's inbox again (he has none there)");
assert.equal((await post("/relay/my/gmail/connect", alice, { again: 9 })).status, 400, "only inboxes 1 to 5");
assert.equal((await post("/relay/my/gmail/connect", alice, { again: "2" })).status, 400);
const again2 = await post("/relay/my/gmail/connect", alice, { again: 2 });
assert.equal(again2.status, 200);
const againUrl = new URL((await again2.json()).url);
assert.equal(againUrl.origin + againUrl.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
assert.equal(againUrl.searchParams.get("login_hint"), "alice.work@gmail.com", "Google suggests that same inbox");
assert.equal(againUrl.searchParams.get("prompt"), "consent", "so Google gives Relay a new sign-in");
ended.delete("B");   // Google's new sign-in works
const keptBefore = refsOf(await receiptsOf(alice));
assert.match(loc(await call("/relay/gmail/callback?code=code-B&state=" + againUrl.searchParams.get("state"))), /#gmail=reconnected$/);
st = await get("/relay/my/gmail", alice);
assert.deepEqual(st.others.map(o => [o.mailbox, o.email, o.needsReconnect]), [[2, "alice.work@gmail.com", false]], "same place, fine again, not added twice");
assert.deepEqual(refsOf(await receiptsOf(alice)), keptBefore, "every receipt kept");
await runJobs();
assert.ok(st.others[0].checkedAt || (await get("/relay/my/gmail", alice)).others[0].checkedAt, "read again straight away");
// The first inbox too (inbox 1), suggesting its own address.
ended.add("A");
clock += 10 * 60 * 1000;
await post("/relay/my/gmail/scan", alice);
assert.equal((await get("/relay/my/gmail", alice)).needsReconnect, true);
const again1 = new URL((await (await post("/relay/my/gmail/connect", alice, { again: 1 })).json()).url);
assert.equal(again1.searchParams.get("login_hint"), "alice.main@gmail.com");
ended.delete("A");
assert.match(loc(await call("/relay/gmail/callback?code=code-A&state=" + again1.searchParams.get("state"))), /#gmail=reconnected$/);
st = await get("/relay/my/gmail", alice);
assert.equal(st.needsReconnect, false); assert.equal(st.email, "alice.main@gmail.com"); assert.equal(st.others.length, 1);
assert.deepEqual(refsOf(await receiptsOf(alice)), keptBefore, "every receipt kept");
await runJobs();
console.log("ok - an inbox whose access ended says so; Connect again keeps its place and receipts, and only its owner can");

// 5. At most five inboxes.
for (const a of ["C", "D", "E"]) assert.match((await connect(alice, a, true)).back, /#gmail=added$/);
const tooMany = await connect(alice, "F", true);
assert.equal(tooMany.status, 409); assert.equal(tooMany.body.error, "too_many_inboxes");
for (const n of [3, 4, 5]) assert.equal((await post("/relay/my/gmail/disconnect", alice, { mailbox: n })).status, 200);
console.log("ok - at most five inboxes");

// 6. Disconnecting the second inbox removes only what came from it; a receipt pasted in by hand stays.
const pasted = await (await post("/relay/my/receipts/add-pasted", alice, { email: order("Odd Bits", "oddbits.test", "OB-1", "Board Game", 2500) })).json();
assert.ok(pasted.ok);
revoked.length = 0;
assert.equal((await post("/relay/my/gmail/disconnect", bob, { mailbox: 2 })).status, 200);
assert.equal((await get("/relay/my/gmail", alice)).others.length, 1, "Bob can't disconnect Alice's inbox");
const off = await (await post("/relay/my/gmail/disconnect", alice, { mailbox: 2 })).json();
assert.ok(off.ok && off.deleted && off.revokedAtGoogle, JSON.stringify(off));
assert.deepEqual(revoked, ["refresh-B"], "Relay's access is cancelled at Google for that inbox only");
assert.deepEqual(refsOf(await receiptsOf(alice)), ["KO-1001", "OB-1"], "the first inbox's receipts and the pasted one stay");
st = await get("/relay/my/gmail", alice);
assert.equal(st.email, "alice.main@gmail.com"); assert.deepEqual(st.others, []);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM captured_receipts WHERE json_extract(details, '$.mailbox') = 2").get().n, 0, "not even the emails that weren't receipts are remembered");
console.log("ok - disconnecting one inbox removes only its receipts (pasted ones stay)");

// 7. Disconnecting the first inbox: the next one takes its place, with its receipts.
assert.match((await connect(alice, "B", true)).back, /#gmail=added$/);
await runJobs();
assert.ok(refsOf(await receiptsOf(alice)).includes("HC-2001"));
revoked.length = 0;
const first = await (await post("/relay/my/gmail/disconnect", alice, {})).json();
assert.equal(first.nowFirst, "alice.work@gmail.com");
assert.deepEqual(revoked, ["refresh-A"]);
st = await get("/relay/my/gmail", alice);
assert.ok(st.connected); assert.equal(st.email, "alice.work@gmail.com", "the second inbox is now the first"); assert.deepEqual(st.others, []);
rows = await receiptsOf(alice);
assert.deepEqual(refsOf(rows), ["FB-3001", "FB-3002", "HC-2001", "HC-2002", "KO-1002", "OB-1"], "its receipts stay, the first inbox's go");
assert.ok(rows.every(r => r.mailbox === undefined), "and they now belong to the first inbox");
// It carries on being read as the first inbox, without reading its emails a second time.
const before = sqlite.prepare("SELECT COUNT(*) AS n FROM captured_receipts").get().n;
do { res = await (await post("/relay/my/gmail/scan", alice, {})).json(); } while (res.more);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM captured_receipts").get().n, before, "nothing read twice");
console.log("ok - disconnecting the first inbox moves the next one into its place, receipts and all");

// 8. Download my data lists every inbox (never a key); withdrawing permission and deleting the account remove them all.
assert.match((await connect(alice, "A", true)).back, /#gmail=added$/);
const mine = await (await call("/relay/my/export", { token: alice })).json();
assert.equal(mine.emailConnection.address, "alice.work@gmail.com");
assert.deepEqual(mine.otherEmailConnections.map(o => [o.inbox, o.address, o.provider]), [[2, "alice.main@gmail.com", "Gmail"]]);
assert.ok(!JSON.stringify(mine).includes("refresh-"), "no keys in the download");
revoked.length = 0;
assert.equal((await post("/relay/my/consent/withdraw", alice)).status, 200);
assert.deepEqual(revoked.sort(), ["refresh-A", "refresh-B"], "both inboxes' access cancelled at Google");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM gmail_connections WHERE shopper_id = ? OR shopper_id LIKE ?").get(aliceId, aliceId + "~%").n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM mail_scan_jobs WHERE shopper_id = ? OR shopper_id LIKE ?").get(aliceId, aliceId + "~%").n, 0);
assert.deepEqual(await receiptsOf(alice), [], "withdrawing permission deletes everything read");
// The account: connect two again, then delete the account.
assert.equal((await post("/relay/my/consent", alice, { version: CONSENT_VERSION })).status, 200);
assert.match((await connect(alice, "A")).back, /#gmail=connected$/);
assert.match((await connect(alice, "B", true)).back, /#gmail=added$/);
revoked.length = 0;
assert.equal((await post("/relay/my/delete", alice, {})).status, 200);
assert.deepEqual(revoked.sort(), ["refresh-A", "refresh-B"], "deleting the account cancels every inbox's access");
for (const t of ["gmail_connections", "mail_scan_jobs", "gmail_oauth_states"])
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE shopper_id = ? OR shopper_id LIKE ?`).get(aliceId, aliceId + "~%").n, 0, t + " emptied");
console.log("ok - Download my data lists every inbox; withdrawing permission and deleting the account remove them all");
console.log("PASS more than one inbox: added through the account picker, all read, searched together, removed one at a time (FAKE Google and Microsoft)");
