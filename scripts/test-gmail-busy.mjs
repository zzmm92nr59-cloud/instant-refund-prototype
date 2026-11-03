// Offline test (FAKE Google and Gmail, real SQLite): a busy month. Gmail lists a search 100 emails a page and Relay takes
// 4 pages per window, so a 30-day window with more than 400 matching emails used to lose its oldest ones without any sign.
// Now the same stretch is listed again in shorter windows until it fits, and nothing in it is skipped.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION } from "../worker/gmail.js";

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

const DAY = 86400000, clock = Date.UTC(2026, 9, 31, 12);
const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "/");
const b64url = s => Buffer.from(s).toString("base64url");
// 520 shop newsletters over 12 days (all matching the search, none a receipt), and one receipt just before them,
// all inside one 30-day window.
const box = {};
for (let i = 0; i < 520; i++) box["n" + (1000 + i)] = { day: ymd(clock - 3 * DAY - Math.floor(i / 45) * DAY), at: clock - 3 * DAY - i * 30 * 60000,
  raw: `From: Example Outfitters <news@exampleoutfitters.test>\nSubject: New in: autumn order of the day ${i}\nContent-Type: text/plain\n\nTake a look at what's new this week.\n` };
box.r1 = { day: ymd(clock - 16 * DAY), at: clock - 16 * DAY,
  raw: `From: Example Outfitters <orders@exampleoutfitters.test>\nSubject: Your order confirmation #EO-7777\nContent-Type: text/plain\n\nOrder number: EO-7777\nOrder date: 15 Oct 2026\nWool jumper - Qty 1 - £59.00\nOrder total: £59.00\n` };
let emails = [], listCalls = 0;
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
  if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") return Response.json({ emailAddress: "alice@gmail.test" });
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
    listCalls++;
    const q = decodeURIComponent(url), w = /after:(\S+) before:(\S+)/.exec(q);
    // Like Gmail: newest first, 100 a page.
    const ids = Object.keys(box).filter(k => box[k].day >= w[1] && box[k].day < w[2]).sort((a, b) => box[b].at - box[a].at);
    const page = Number((/pageToken=p(\d+)/.exec(url) || [])[1] || 0);
    return Response.json({ messages: ids.slice(page * 100, page * 100 + 100).map(k => ({ id: idOf(k) })), ...(ids.length > page * 100 + 100 ? { nextPageToken: "p" + (page + 1) } : {}) });
  }
  const one = /messages\/(a[0-9a-f]+0)\?format=raw$/.exec(url);
  if (one) return Response.json({ raw: b64url(box[keyOf(one[1])].raw) });
  return new Response("nope", { status: 404 });
};
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
emails = [];
await call("/relay/auth/request", { method: "POST", body: { email: "alice@example.com" }, ip: "5.5.5.5" });
const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
const alice = (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
const post = (path, body) => call(path, { method: "POST", token: alice, body });
await post("/relay/my/consent", { version: CONSENT_VERSION });
const state = new URL((await (await post("/relay/my/gmail/connect")).json()).url).searchParams.get("state");
await call("/relay/gmail/callback?code=good&state=" + state);

let cursor = "", more = true, rounds = 0;
while (more && rounds < 80) { const j = await (await post("/relay/my/gmail/scan", cursor ? { cursor } : {})).json(); more = j.more; cursor = j.cursor; rounds++; }
assert.equal(more, false, "the scan finishes");
const seen = sqlite.prepare("SELECT COUNT(*) n FROM captured_receipts").get().n;
assert.equal(seen, 521, "every email in the busy month is looked at, not just the newest 400: " + seen);
const receipt = sqlite.prepare("SELECT details FROM captured_receipts WHERE status <> 'not_receipt'").all();
assert.equal(receipt.length, 1);
assert.match(receipt[0].details, /EO-7777/, "the receipt behind 520 newsletters in the same month is found");
console.log(`ok - a month with 521 matching emails is read in shorter windows: nothing skipped, the receipt behind the newsletters found (${rounds} rounds, ${listCalls} listings)`);
