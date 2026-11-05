// Offline test (real SQLite; Gmail and Anthropic are stand-ins): AI help, the AI second reader (worker/ai-reader.js,
// worker/ai-runner.js). Off until the AI key is set, and only for shoppers who switch it on; only receipts the rules weren't
// sure about, never one the shopper fixed; the email goes with personal details hidden; the AI's answer is checked; it fills
// gaps only and marks the receipt for the shopper to check; a shopper's fix wins; limits; a busy AI stops the run; turning it
// off deletes what it read; the health page counts where the AI and the rules agreed and differed. People, shops and
// emails are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, sealToken } from "../worker/gmail.js";
import { cleanAiReading, compareReadings, attachAiReads, FILLED, AGREED, DIFFER, RULES_ONLY } from "../worker/ai-reader.js";
import { runAiReads, AI_PER_RUN } from "../worker/ai-runner.js";

// The pieces.
{
  const ok = cleanAiReading('Here you go: {"isPurchase":true,"shop":"Brindle & Co","orderRef":"#1001","orderDate":"2026-10-12","currency":"GBP","totalPence":4500,' +
    '"items":[{"name":"Merino Wool Scarf","qty":1,"pricePence":3500},{"name":"Delivery to [address]","qty":1,"pricePence":500},{"name":"Gift Box","qty":0,"pricePence":-3}]}', "2026-11-06");
  assert.deepEqual(ok, { isPurchase: true, shop: "Brindle & Co", orderRef: "#1001", orderDate: "2026-10-12", currency: "GBP", totalPence: 4500,
    items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 3500 }, { name: "Gift Box", qty: 1, pricePence: null }] }, "a line with a hidden detail goes; bad numbers are left out");
  const odd = cleanAiReading({ isPurchase: "yes", shop: "Shopify", orderRef: "<b>1</b>", orderDate: "2027-01-01", currency: "pounds", totalPence: 12.5, items: "none" }, "2026-11-06");
  assert.deepEqual(odd, { isPurchase: false, shop: null, orderRef: null, orderDate: null, currency: null, totalPence: null, items: [] }, "only sensible values");
  assert.equal(cleanAiReading("Sorry, I can't help with that.", "2026-11-06"), null);
  const rules = { retailer: { name: "Shopify", domain: "shopifyemail.com" }, orderRef: "1001", orderDate: "2026-10-12", totalPence: 4000, items: [] };
  assert.deepEqual(compareReadings(rules, ok), { shop: FILLED, total: DIFFER, date: AGREED, number: AGREED, items: FILLED },
    "a payment company's name is no shop; 1001 and #1001 are the same number");
  assert.equal(compareReadings({ totalPence: 100 }, { ...ok, totalPence: null }).total, RULES_ONLY);
  // Filling gaps only, marked for the shopper to check; a fix still wins after.
  const card = { id: "a", status: "pending", retailer: { name: "Shopify", domain: "shopifyemail.com" }, orderRef: "1001", orderDate: null, totalPence: 4000, items: [] };
  attachAiReads([card], [{ id: "a", fields: JSON.stringify(ok), at: 1 }]);
  assert.deepEqual([card.retailer.name, card.totalPence, card.orderDate, card.orderRef, card.items.length, card.aiFilled, card.needsShopperConfirmation],
    ["Brindle & Co", 4000, "2026-10-12", "1001", 2, ["date", "items", "shop"], true], "the rules' total stays; only what they missed is filled");
  const no = { id: "b", status: "pending", retailer: { name: "Fennel" }, totalPence: null, items: [] };
  attachAiReads([no], [{ id: "b", fields: JSON.stringify({ ...ok, isPurchase: false }), at: 1 }]);
  assert.deepEqual([no.totalPence, no.aiFilled], [null, undefined], "an email the AI thinks isn't a purchase fills nothing");
  console.log("ok - the AI's answer is checked like typing; it fills only gaps, marked for the shopper to check");
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
  GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test" };
const MAIL = (ref) => ["From: Brindle & Co <orders@brindle.example>", "To: Jess Private <jess.private@example.com>", "Subject: Jess, your order " + ref,
  "Content-Type: text/plain; charset=utf-8", "", "Hi Jess,", "Thanks for order " + ref + ".", "Merino Wool Scarf 35.00", "Delivery 10.00", "Total paid 45.00",
  "Delivery address", "Jess Private", "12 High Street", "London", "SW1A 1AA", "", "Questions? Call 0800 123 4567 or email help@brindle.example"].join("\r\n");
const gmail = {};
let ai = "answer", aiCalls = [];
const ANSWER = { isPurchase: true, shop: "Brindle & Co", orderRef: "#1001", orderDate: "2026-10-12", currency: "GBP", totalPence: 4500,
  items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 3500 }] };
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "access-gmail" });
  const g = /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([A-Za-z0-9]+)\?format=raw$/.exec(url);
  if (g) return gmail[g[1]] ? Response.json({ raw: Buffer.from(gmail[g[1]]).toString("base64url") }) : new Response("{}", { status: 404 });
  if (url === "https://api.anthropic.com/v1/messages") {
    aiCalls.push({ headers: init.headers, body: JSON.parse(init.body) });
    if (ai === "busy") return new Response("{}", { status: 529 });
    const text = ai === "nonsense" ? "I couldn't read that." : JSON.stringify(ai === "notPurchase" ? { ...ANSWER, isPurchase: false } : ANSWER);
    return Response.json({ content: [{ type: "text", text }] });
  }
  return new Response("{}", { status: 404 });
};
let emails = [];
const clock = Date.UTC(2026, 10, 5, 9);
const call = (path, { method = "GET", body, token, ip = "1.1.1.1", e = env } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), e, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const jess = await signIn("jess.private@example.com", "5.5.5.1"), sam = await signIn("sam@example.com", "5.5.5.2"), ops = await signIn("ops@example.com", "5.5.5.3");
const J = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("jess.private@example.com").id, S = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("sam@example.com").id;
for (const t of [jess, sam]) assert.equal((await call("/relay/my/consent", { method: "POST", token: t, body: { version: CONSENT_VERSION } })).status, 200);
await call("/relay/my/receipts", { token: jess });
await call("/relay/my/profile", { method: "POST", token: jess, body: { name: "Jess Private" } });
for (const [id, address] of [[J, "jess.private@example.com"], [S, "sam@example.com"]]) {
  const s = await sealToken(env, "refresh-" + id);
  sqlite.prepare("INSERT INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at) VALUES (?,?,?,?,?)").run(id, address, s.iv, s.data, clock);
}
let n = 0;
const receipt = (who, details, status = "pending") => {
  const id = "00000000-0000-4000-8000-" + String(++n).padStart(12, "0");
  sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)").run(id, who, "m" + n, status,
    JSON.stringify({ kind: "receipt", retailer: { name: "Brindle & Co", domain: "brindle.example" }, currency: "GBP", parserVersion: 26, ...details }), clock - n * 1000);
  return id;
};
gmail.m1abcdef = MAIL("#1001"); gmail.m6abcdef = MAIL("#1006");
const unsure = receipt(J, { gmailId: "m1abcdef", orderRef: "#1001", orderDate: "2026-10-12", totalPence: null, confidence: "low", items: [] });
const sure = receipt(J, { gmailId: "m1abcdef", orderRef: "#1002", orderDate: "2026-10-13", totalPence: 2000, confidence: "high", items: [{ name: "Tea Towel", qty: 1 }] });
const fixed = receipt(J, { gmailId: "m1abcdef", orderRef: "#1003", totalPence: null, confidence: "low", items: [] });
const gone = receipt(J, { gmailId: "m9abcdef", orderRef: "#1004", totalPence: null, confidence: "medium", items: [] });
const pasted = receipt(J, { pasted: true, orderRef: "#1005", totalPence: null, confidence: "low", items: [] });
const samsUnsure = receipt(S, { gmailId: "m6abcdef", orderRef: "#1006", totalPence: null, confidence: "low", items: [] });
assert.equal((await call("/relay/my/receipts/" + fixed + "/fix", { method: "POST", token: jess, body: { totalPence: 999 } })).status, 200);
const reads = () => sqlite.prepare("SELECT receipt_id, fields, failed, not_purchase, shop, total, date, number, items FROM receipt_ai_reads ORDER BY receipt_id").all().map((r) => ({ ...r }));

// 1. Off until the key is set.
let r = await (await call("/relay/my/ai-reading", { token: jess })).json();
assert.deepEqual(r, { available: false, on: false, since: null });
assert.equal((await call("/relay/my/ai-reading", { method: "POST", token: jess, body: { on: true } })).status, 503);
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 0, why: "off" });
env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 0, failed: 0 }, "nobody has switched it on");
assert.equal(aiCalls.length, 0);
console.log("ok - off until the AI key is set, and then only for shoppers who switch it on");

// 2. Jess switches it on; the hourly run reads only what the rules weren't sure about, with her details hidden.
r = await (await call("/relay/my/ai-reading", { method: "POST", token: jess, body: { on: true } })).json();
assert.deepEqual(r, { available: true, on: true, since: new Date(clock).toISOString() });
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 1, failed: 0 });
assert.equal(aiCalls.length, 1, "one email read: not the confident one, the fixed one, the pasted one, or Sam's");
const sent = aiCalls[0];
assert.equal(sent.headers["x-api-key"], "sk-test-not-a-real-key"); assert.equal(sent.headers["anthropic-version"], "2023-06-01");
assert.equal(sent.body.model, "claude-haiku-5-5"); assert.match(sent.body.system, /Never invent anything/);
const text = sent.body.messages[0].content;
assert.match(text, /^Subject: \[name\], your order #1001\nFrom: Brindle & Co <\[email\]>/); assert.match(text, /Total paid 45\.00/);
for (const hidden of ["Jess", "Private", "12 High Street", "SW1A", "0800", "help@brindle", "jess.private"]) assert.ok(!text.includes(hidden), "not sent to the AI: " + hidden);
assert.deepEqual(reads(), [
  { receipt_id: unsure, fields: JSON.stringify({ ...ANSWER, v: 1 }), failed: null, not_purchase: 0, shop: AGREED, total: FILLED, date: AGREED, number: AGREED, items: FILLED },
  { receipt_id: gone, fields: null, failed: "email_not_found", not_purchase: 0, shop: 0, total: 0, date: 0, number: 0, items: 0 }].sort((a, b) => a.receipt_id.localeCompare(b.receipt_id)),
  "an email that's gone is remembered so it isn't asked for again");
const list = async () => (await (await call("/relay/my/receipts?all=1", { token: jess })).json()).receipts;
let card = (await list()).find((c) => c.id === unsure);
assert.deepEqual([card.totalPence, card.items.map((i) => i.name), card.aiFilled, card.needsShopperConfirmation], [4500, ["Merino Wool Scarf"], ["total", "items"], true]);
assert.equal((await list()).find((c) => c.id === fixed).totalPence, 999, "the shopper's fix stays");
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 0, failed: 0 }, "nothing is read twice");
console.log("ok - only receipts the rules weren't sure about, details hidden; gaps filled and marked for checking; a fix wins; nothing read twice");

// 3. Odd answers and a busy AI.
const two = receipt(J, { gmailId: "m1abcdef", orderRef: "#2001", totalPence: null, confidence: "low", items: [] });
ai = "busy"; aiCalls = [];
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 0, failed: 0, stopped: "ai_busy" }, "a busy AI stops the run");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE receipt_id = ?").get(two).n, 0, "and it's tried again later");
ai = "nonsense";
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 0, failed: 1 });
assert.equal(sqlite.prepare("SELECT failed FROM receipt_ai_reads WHERE receipt_id = ?").get(two).failed, "unreadable");
const three = receipt(J, { gmailId: "m1abcdef", orderRef: "#3001", totalPence: null, confidence: "low", items: [] });
ai = "notPurchase";
await runAiReads(env, clock, fetchImpl);
assert.equal(sqlite.prepare("SELECT not_purchase FROM receipt_ai_reads WHERE receipt_id = ?").get(three).not_purchase, 1);
card = (await list()).find((c) => c.id === three);
assert.deepEqual([card.totalPence, card.aiFilled], [null, undefined], "an email the AI thinks isn't a purchase changes nothing");
ai = "answer";
console.log("ok - an unreadable answer is remembered, a busy AI stops the run, 'not a purchase' changes nothing");

// 4. Limits: a few a run.
for (let i = 0; i < AI_PER_RUN + 5; i++) receipt(J, { gmailId: "m1abcdef", orderRef: "#4" + i, totalPence: null, confidence: "low", items: [] });
aiCalls = [];
assert.equal((await runAiReads(env, clock, fetchImpl)).read, AI_PER_RUN);
assert.equal(aiCalls.length, AI_PER_RUN, AI_PER_RUN + " a run");
console.log("ok - limits: " + AI_PER_RUN + " a run");

// 5. The health page counts where they agreed and differed; Download my data has it; off deletes what was read.
const h = await (await call("/relay/my/admin/health", { token: ops })).json();
assert.equal(h.aiReader.on, true); assert.equal(h.aiReader.shoppersOn, 1);
assert.equal(h.aiReader.reads, AI_PER_RUN + 4); assert.equal(h.aiReader.failed, 2); assert.equal(h.aiReader.notPurchase, 1);
assert.deepEqual(h.aiReader.parts.total, { filled: AI_PER_RUN + 1, agreed: 0, differed: 0 });
const exp = await (await call("/relay/my/export", { token: jess })).json();
assert.equal(exp.aiHelp.on, true); assert.ok(exp.aiHelp.readings.some((x) => x.receiptId === unsure && x.read.totalPence === 4500));
assert.equal((await call("/relay/my/receipts/" + unsure + "/dismiss", { method: "POST", token: jess, body: {} })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE receipt_id = ?").get(unsure).n, 0, "removing the receipt removes what the AI read");
r = await (await call("/relay/my/ai-reading", { method: "POST", token: jess, body: { on: false } })).json();
assert.deepEqual(r, { available: true, on: false, since: null });
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE shopper_id = ?").get(J).n, 0, "switching it off deletes what the AI read");
assert.equal((await list()).find((c) => c.id === three).aiFilled, undefined);
aiCalls = [];
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 0, failed: 0 }, "and nothing more is read");
assert.equal((await call("/relay/my/ai-reading", { method: "POST", token: jess, body: { on: "yes" } })).status, 400);
console.log("ok - counted on the health page; in Download my data; removing the receipt or switching off deletes what was read");

// 6. Withdrawing permission deletes the switch and what was read.
assert.equal((await call("/relay/my/ai-reading", { method: "POST", token: jess, body: { on: true } })).status, 200);
await runAiReads(env, clock, fetchImpl);
assert.ok(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE shopper_id = ?").get(J).n > 0);
assert.equal((await call("/relay/my/consent/withdraw", { method: "POST", token: jess, body: {} })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM receipt_ai_reads WHERE shopper_id = ?").get(J).n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_reading WHERE shopper_id = ?").get(J).n, 0);
console.log("ok - withdrawing permission deletes the switch and what the AI read");
console.log("PASS AI help: off until the key and the switch, unsure receipts only, details hidden, answers checked, gaps only, limits, deleted when off");
