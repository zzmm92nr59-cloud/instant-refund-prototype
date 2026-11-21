// Offline test (real SQLite; Gmail and Anthropic are stand-ins): Relay's AI spending limits (worker/ai-spend.js) and which
// emails the AI reader gets. What each call cost is recorded from the answer's token counts, per month and feature, with
// nothing about the email; the monthly limit and each shopper's daily limit stop calls BEFORE they're made (allowing for
// the call's max_tokens), and every AI feature then does what it does without the key, until the next month or day; an
// email already read by the AI is never sent again when Relay's own reader version changes, only when the email or
// AI_READ_VERSION does; only receipts the rules weren't sure about, from shoppers who switched AI help on; the health
// page's "AI spending" numbers, for Relay's team only. People, shops and emails are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, sealToken } from "../worker/gmail.js";
import { AI_READ_VERSION } from "../worker/ai-reader.js";
import { runAiReads, aiModel } from "../worker/ai-runner.js";
import { costPence, priceOf, mostItCouldCost, claudeFetch, spendSummary, monthlyLimit, shopperDayLimit, DEFAULT_MODEL } from "../worker/ai-spend.js";
import { learnItemKinds } from "../worker/item-kinds.js";
import { learnShopKinds } from "../worker/shop-kind-ai.js";
import { readReceiptPhoto } from "../worker/receipt-photo.js";
import { askForItems } from "../worker/receipt-reread.js";
import { handleSupportRoute } from "../worker/support-chat.js";
import { handlePhotoSearchRoute } from "../worker/photo-search.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg + ": " + a + " vs " + b);

// 1. Prices and the model.
{
  const env = {};
  assert.equal(aiModel(env), "claude-haiku-5-5"); assert.equal(DEFAULT_MODEL, "claude-haiku-5-5");
  assert.equal(aiModel({ AI_READER_MODEL: "claude-sonnet-5-5" }), "claude-sonnet-5-5", "the model can be changed by a setting");
  assert.deepEqual([priceOf(env, "claude-haiku-5-5").in, priceOf(env, "claude-haiku-5-5").out], [0.10, 0.50]);
  assert.equal(priceOf(env, "claude-haiku-4-5-20251001").in, 1, "a dated version finds its family");
  assert.equal(priceOf(env, "claude-made-up-9").out, 75, "a model not in the table is costed at the dearest price");
  // 100,000 tokens in and 1,000,000 out on Haiku 5.5: $0.01 + $0.50, at 0.80 = 40.8p.
  near(costPence(env, "claude-haiku-5-5", { input_tokens: 1e5, output_tokens: 1e6 }), 40.8, "Haiku 5.5's list price");
  near(costPence(env, "claude-haiku-5-5", { input_tokens: 200000, output_tokens: 0 }), 200000 * 0.5 / 1e6 * 80, "a prompt over 100,000 tokens pays the higher price");
  near(costPence({ AI_USD_TO_GBP: "1" }, "claude-haiku-5-5", { input_tokens: 1e5, output_tokens: 0 }), 1, "the exchange rate can be set");
  near(costPence({ AI_PRICES: '{"claude-haiku-5-5":{"in":1,"out":2}}' }, "claude-haiku-5-5", { input_tokens: 1e6, output_tokens: 1e6 }), 240, "the price table can be set");
  near(costPence(env, "claude-haiku-5-5", { input_tokens: 0, cache_read_input_tokens: 1e5, output_tokens: 0 }), 0.08, "cache reads at a tenth");
  assert.equal(monthlyLimit({}), 2000, "£20 a month unless set"); assert.equal(monthlyLimit({ AI_MONTHLY_LIMIT_PENCE: "5000" }), 5000);
  assert.equal(monthlyLimit({ AI_MONTHLY_LIMIT_PENCE: "lots" }), 2000, "a setting that isn't a number keeps £20");
  assert.equal(monthlyLimit({ AI_MONTHLY_LIMIT_PENCE: "0" }), 0, "0 switches every AI feature off");
  assert.equal(shopperDayLimit({}), 10);
  const most = mostItCouldCost(env, { model: "claude-haiku-5-5", max_tokens: 1000, system: "x".repeat(300), messages: [{ role: "user", content: [{ type: "image" }, { type: "text", text: "y".repeat(300) }] }] });
  near(most, costPence(env, "claude-haiku-5-5", { input_tokens: 200 + 2000 + 50, output_tokens: 1000 }), "the most a call could cost: its text, its pictures and all of max_tokens");
  console.log("ok - prices from Anthropic's list (Haiku 5.5 by default), overridable; the most a call could cost");
}

// The rest runs against a database like Relay's.
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
  "Content-Type: text/plain; charset=utf-8", "", "Hi Jess,", "Thanks for order " + ref + ".", "Merino Wool Scarf £35.00", "Delivery £10.00", "Total paid £45.00",
  "Delivery address", "Jess Private", "12 High Street", "London", "SW1A 1AA"].join("\r\n");
const gmail = {};
let aiCalls = [], gmailCalls = 0, usage = { input_tokens: 2000, output_tokens: 300 };
const ANSWER = { isPurchase: true, shop: "Brindle & Co", orderRef: "#1001", orderDate: "2026-10-12", currency: "GBP", totalPence: 4500,
  items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 3500 }] };
// Anthropic's stand-in answers each kind of question in the shape that feature expects, with the token counts given.
const answerFor = (body) => {
  const sys = String(body.system || "");
  if (/order section/.test(sys)) return { items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 3500 }], subtotalPence: 3500, totalPence: 4500 };
  if (/photo of a paper/.test(sys)) return { ...ANSWER, confidence: "high" };
  if (/shop/i.test(sys) && Array.isArray(safe(body))) return { shops: safe(body).map((s) => ({ id: s.id, kind: "home" })) };
  if (/item|thing/i.test(sys) && Array.isArray(safe(body))) return { items: safe(body).map((x) => ({ id: x.id, mode: "again", kind: "scarf", look: ["scarf"], type: "clothing", sure: true })) };
  return ANSWER;
};
const safe = (body) => { try { return JSON.parse(body.messages[0].content); } catch { return null; } };
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "access-gmail" });
  const g = /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([A-Za-z0-9]+)\?format=raw$/.exec(url);
  if (g) { gmailCalls++; return gmail[g[1]] ? Response.json({ raw: Buffer.from(gmail[g[1]]).toString("base64url") }) : new Response("{}", { status: 404 }); }
  if (url === "https://api.anthropic.com/v1/messages") {
    const body = JSON.parse(init.body);
    aiCalls.push(body);
    const reply = /help/i.test(String(body.system || "")) && !/JSON/.test(String(body.system || "")) ? "Tap Receipts, then the receipt." : JSON.stringify(answerFor(body));
    return Response.json({ content: [{ type: "text", text: reply }], usage });
  }
  return new Response("{}", { status: 404 });
};
let emails = [];
const NOV = Date.UTC(2026, 10, 5, 9), DEC = Date.UTC(2026, 11, 1, 9);
let clock = NOV;
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const jess = await signIn("jess.private@example.com", "5.5.5.1"), sam = await signIn("sam@example.com", "5.5.5.2"), ops = await signIn("ops@example.com", "5.5.5.3"),
  kit = await signIn("kit@example.com", "5.5.5.4");
const idOf = (e) => sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(e).id;
const J = idOf("jess.private@example.com"), S = idOf("sam@example.com"), K = idOf("kit@example.com");
for (const t of [jess, sam, kit]) assert.equal((await call("/relay/my/consent", { method: "POST", token: t, body: { version: CONSENT_VERSION } })).status, 200);
await call("/relay/my/receipts", { token: jess });
for (const [id, address] of [[J, "jess.private@example.com"], [S, "sam@example.com"], [K, "kit@example.com"]]) {
  const s = await sealToken(env, "refresh-" + id);
  sqlite.prepare("INSERT INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at) VALUES (?,?,?,?,?)").run(id, address, s.iv, s.data, clock);
}
let n = 0;
const receipt = (who, details) => {
  const id = "00000000-0000-4000-8000-" + String(++n).padStart(12, "0"), gid = "m" + n + "abcdef";
  gmail[gid] = MAIL("#" + n);
  sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)").run(id, who, "ref" + n, "pending",
    JSON.stringify({ kind: "receipt", gmailId: gid, retailer: { name: "Brindle & Co", domain: "brindle.example" }, currency: "GBP", parserVersion: 26,
      orderRef: "#" + n, orderDate: "2026-10-12", totalPence: 4500, confidence: "high", items: [{ name: "Merino Wool Scarf", qty: 1, pricePence: 3500 }], ...details }), clock - n * 1000);
  return id;
};
const sent = () => sqlite.prepare("SELECT receipt_id AS id FROM receipt_ai_reads ORDER BY receipt_id").all().map((r) => r.id);
const spendRows = () => sqlite.prepare("SELECT * FROM ai_spend ORDER BY month, feature").all().map((r) => ({ ...r }));
env.ANTHROPIC_API_KEY = "sk-test-not-a-real-key";

// 2. Which emails the AI reader gets: only receipts the rules weren't sure about, only from shoppers who switched AI help on.
const sure = receipt(J, {});
const lowConf = receipt(J, { confidence: "low" });
const noTotal = receipt(J, { totalPence: null });
const notAddingUp = receipt(J, { itemsCheck: { complete: false, expectedPence: 4500, itemsPence: 3500 } });
const oddNames = receipt(J, { itemsCheck: { complete: true, namesOk: false } });
const noShop = receipt(J, { retailer: { name: null, domain: null } });
const addsUp = receipt(J, { itemsCheck: { complete: true, namesOk: true } });
const kitsUnsure = receipt(K, { confidence: "low" });   // Kit never switches AI help on
assert.equal((await call("/relay/my/ai-reading", { method: "POST", token: jess, body: { on: true } })).status, 200);
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 5, failed: 0 });
assert.deepEqual(sent(), [lowConf, noTotal, notAddingUp, oddNames, noShop].sort(), "low confidence, no total, items that don't add up, doubtful names, no shop: and nothing else");
assert.ok(!sent().includes(sure) && !sent().includes(addsUp) && !sent().includes(kitsUnsure), "never a receipt the rules are sure of, nor one of a shopper without AI help");
for (const b of aiCalls) assert.deepEqual(b.thinking, { type: "disabled" }, "the reader doesn't pay for thinking it doesn't need");
console.log("ok - only unsure receipts (low confidence, no total, items not adding up, doubtful names, no shop) and only with AI help on");

// 3. Spend recorded per call, from the answer's own token counts; nothing about the email or the shopper in it.
let rows = spendRows();
assert.equal(rows.length, 1);
const each = costPence(env, "claude-haiku-5-5", usage);
assert.deepEqual({ ...rows[0], pence: undefined }, { month: "2026-11", feature: "reader", calls: 5, input_tokens: 10000, output_tokens: 1500, pence: undefined });
near(rows[0].pence, 5 * each, "5 calls at their real token counts");
assert.deepEqual(Object.keys(rows[0]).sort(), ["calls", "feature", "input_tokens", "month", "output_tokens", "pence"], "no email, no shopper in the monthly record");
const jToday = () => Number((sqlite.prepare("SELECT pence FROM ai_spend_shopper WHERE shopper_id = ? AND day = ?").get(J, "2026-11-05") || {}).pence || 0);
near(jToday(), 5 * each, "and Jess's receipt reading today, for her daily limit");
console.log("ok - every call's cost recorded per month and feature from its usage (" + (5 * each).toFixed(4) + "p for 5 reads)");

// 4. Relay's own reader version goes up and every email is read again by the rules: nothing is sent to the AI again.
aiCalls = []; gmailCalls = 0;
sqlite.prepare("UPDATE captured_receipts SET details = json_set(details, '$.parserVersion', 61, '$.totalPence', 4500) WHERE shopper_id = ?").run(J);
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 0, failed: 0 });
assert.equal(aiCalls.length, 0, "no email is sent to the AI again because the rules changed");
assert.equal(gmailCalls, 0, "nor fetched from the inbox again");
const tot = sqlite.prepare("SELECT total, reader FROM receipt_ai_reads WHERE receipt_id = ?").get(noTotal);
assert.deepEqual({ ...tot }, { total: 2, reader: 61 }, "the stored AI reading is compared again with the new rules' reading (now they agree on the total)");
// The email itself changed (the receipt now points at another email): that one is read again, once.
gmail.m99abcdef = MAIL("#99");
sqlite.prepare("UPDATE captured_receipts SET details = json_set(details, '$.gmailId', 'm99abcdef') WHERE id = ?").run(lowConf);
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 1, failed: 0 });
assert.equal(aiCalls.length, 1, "a different email is read");
// A new AI_READ_VERSION: a reading made at an older one is read again, once.
sqlite.prepare("UPDATE receipt_ai_reads SET ai_version = ? WHERE receipt_id = ?").run(AI_READ_VERSION - 1, oddNames);
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 1, failed: 0 });
assert.equal(sqlite.prepare("SELECT ai_version FROM receipt_ai_reads WHERE receipt_id = ?").get(oddNames).ai_version, AI_READ_VERSION);
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 0, failed: 0 }, "and then never again at the same version");
assert.equal(aiCalls.length, 2);
// A reading kept from before these columns existed (no version, no email) counts as this version and this email.
sqlite.prepare("UPDATE receipt_ai_reads SET ai_version = NULL, email_key = NULL").run();
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 0, failed: 0 }, "readings from before are reused, not re-sent");
console.log("ok - a reader version bump re-sends nothing (the AI's reading is reused and compared again); only a changed email or AI_READ_VERSION is read again");

// 5. Each shopper's daily limit: Jess is stopped, Sam isn't; the next day Jess is read again.
assert.equal((await call("/relay/my/ai-reading", { method: "POST", token: sam, body: { on: true } })).status, 200);
env.AI_SHOPPER_DAY_LIMIT_PENCE = String(jToday() + 0.01);   // less than one more read's most-it-could-cost
const jMore = receipt(J, { confidence: "low" }), sMore = receipt(S, { confidence: "low" });
aiCalls = []; gmailCalls = 0;
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 1, failed: 0 });
assert.deepEqual(sent().filter((id) => id === jMore || id === sMore), [sMore], "Sam is read; Jess has reached her limit for today");
assert.equal(gmailCalls, 1, "Jess's inbox isn't even asked for the email");
// "Read it again" and a receipt photo for Jess today: as without the key.
const section = "Merino Wool Scarf £35.00\nTotal £45.00";
assert.deepEqual(await askForItems(env, section, fetchImpl, { shopperId: J, now: clock }), { error: "ai_off", capped: "shopper_day" });
assert.equal((await readReceiptPhoto(env, { type: "image/png", data: "bm90LWEtcmVhbC1waWM=" }, "2026-11-06", fetchImpl, { shopperId: J, now: clock })).error, "ai_off");
assert.equal(aiCalls.length, 1, "nothing asked for Jess");
assert.ok((await askForItems(env, section, fetchImpl, { shopperId: S, now: clock })).reading, "Sam's still works");
clock = NOV + 864e5;
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 1, failed: 0 });
assert.ok(sent().includes(jMore), "the next day Jess's receipt is read");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_spend_shopper WHERE day < ?").get("2026-11-05").n, 0, "a shopper's daily figures go after two days");
delete env.AI_SHOPPER_DAY_LIMIT_PENCE;
console.log("ok - a shopper's daily limit stops their receipt reading (inbox not even asked) until the next day; others carry on");

// 6. The monthly limit: checked before the call, allowing for its max_tokens, so it can't be overshot by much.
const spent = () => sqlite.prepare("SELECT COALESCE(SUM(pence), 0) AS p FROM ai_spend WHERE month = ?").get("2026-11").p;
const before = spent();
const req = { model: "claude-haiku-5-5", max_tokens: 1000, system: "s", messages: [{ role: "user", content: "hello" }] };
env.AI_MONTHLY_LIMIT_PENCE = String(before + mostItCouldCost(env, req) / 2);   // room for half the most it could cost
aiCalls = [];
const capped = await claudeFetch(env, "help_chat", fetchImpl, { method: "POST", headers: {}, body: JSON.stringify(req) }, { now: clock });
assert.deepEqual(capped, { capped: "month" }); assert.equal(aiCalls.length, 0, "not sent: it could have passed the limit");
env.AI_MONTHLY_LIMIT_PENCE = String(before + mostItCouldCost(env, req) + 0.001);
const ok = await claudeFetch(env, "help_chat", fetchImpl, { method: "POST", headers: {}, body: JSON.stringify(req) }, { now: clock });
assert.equal(ok.status, 200); assert.equal(aiCalls.length, 1);
assert.ok(spent() <= Number(env.AI_MONTHLY_LIMIT_PENCE), "never past the limit");
console.log("ok - the monthly limit is checked before each call with room for its max_tokens");

// 7. Over the monthly limit, every AI feature does what it does without the key.
env.AI_MONTHLY_LIMIT_PENCE = String(spent());
aiCalls = []; gmailCalls = 0;
const jLater = receipt(J, { confidence: "low" });
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 0, why: "spending_limit" }, "the AI reader: the rules only");
assert.equal(gmailCalls, 0, "no inbox is asked for an email the AI won't read");
// AI for picks and what things are: the rules decide, nothing is stored as if the AI had answered.
sqlite.exec("CREATE TABLE IF NOT EXISTS picks_ai (shopper_id TEXT PRIMARY KEY, on_since INTEGER NOT NULL)");
sqlite.prepare("INSERT OR IGNORE INTO picks_ai (shopper_id, on_since) VALUES (?, ?)").run(J, clock);
const kinds = await learnItemKinds(env, { id: J, email: "jess.private@example.com" }, { now: clock, fetchImpl });
assert.ok(kinds instanceof Map); assert.equal(kinds.size, 0, "nothing the AI didn't say");
assert.equal(await learnShopKinds(env, [{ retailer: { name: "Xqzzyblorp", domain: "xqzzyblorp.example" }, items: [] }], { now: clock, fetchImpl }), 0, "what shops sell: the name's own words");
assert.deepEqual(await askForItems(env, section, fetchImpl, { shopperId: S, now: clock }), { error: "ai_off", capped: "month" }, "Read it again: the rules only");
assert.deepEqual(await readReceiptPhoto(env, { type: "image/png", data: "bm90LWEtcmVhbC1waWM=" }, "2026-11-06", fetchImpl, { shopperId: S, now: clock }), { error: "ai_off", capped: "month" },
  "a receipt photo is kept as it is without the key");
const chatReq = (method, body) => new Request("https://w.test/relay/my/help/chat", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const samShopper = { id: S, email: "sam@example.com" };
const chatGet = await handleSupportRoute("/relay/my/help/chat", "GET", chatReq("GET"), env, {}, samShopper, { now: clock, fetchImpl });
assert.equal((await chatGet.json()).available, false, "the help chat says it's off right now (the app offers Talk to a person)");
const chatPost = await handleSupportRoute("/relay/my/help/chat", "POST", chatReq("POST", { messages: [{ role: "user", text: "How do I add a receipt?" }] }), env, {}, samShopper, { now: clock, fetchImpl });
assert.deepEqual([chatPost.status, await chatPost.json()], [503, { error: "chat_off" }], "the app's own plain words for that: 'The assistant is off right now'");
const photoReq = new Request("https://w.test/relay/my/photo-search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: "data:image/png;base64,bm90LWEtcmVhbC1waWM=" }) });
const ps = await handlePhotoSearchRoute(photoReq, env, new URL(photoReq.url), {}, samShopper, { now: clock, fetchImpl });
assert.deepEqual([ps.status, await ps.json()], [503, { error: "ai_off" }], "search by photo: off, as without the key");
assert.equal(aiCalls.length, 0, "nothing at all was sent to Anthropic");
// Through the app: "Read it again" answers as it does when the rules aren't sure, never with an error.
const rr = await (await call("/relay/my/receipts/" + jLater + "/reread", { method: "POST", token: jess, body: {} })).json();
assert.equal(rr.ok, true); assert.equal(aiCalls.length, 0);
assert.ok(!sent().includes(jLater));
// Next month: it all works again.
clock = DEC;
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 1, failed: 0 });
assert.ok(sent().includes(jLater), "the receipt waited and is read next month");
assert.equal((await (await handleSupportRoute("/relay/my/help/chat", "GET", chatReq("GET"), env, {}, samShopper, { now: clock, fetchImpl })).json()).available, true);
// A limit of 0 switches everything off.
env.AI_MONTHLY_LIMIT_PENCE = "0"; aiCalls = [];
receipt(J, { confidence: "low" });
assert.deepEqual(await runAiReads(env, clock, fetchImpl), { read: 0, why: "spending_limit" }); assert.equal(aiCalls.length, 0);
delete env.AI_MONTHLY_LIMIT_PENCE;
console.log("ok - over the monthly limit every feature falls back quietly (reader, picks, shops, Read it again, receipt photos, help chat, photo search); next month it's back");

// 8. The health page: this month's spend against the limit, by feature, and what the reader found; Relay's team only.
clock = NOV + 2 * 864e5;
const h = await (await call("/relay/my/admin/health", { token: ops })).json();
const sp = h.aiSpend, nov = await spendSummary(env, clock);
assert.equal(sp.month, "2026-11"); assert.equal(sp.limitPence, 2000); assert.equal(sp.shopperDayLimitPence, 10);
assert.deepEqual(sp.byFeature.map((f) => f.feature).sort(), ["help_chat", "reader", "reread"]);
assert.equal(sp.byFeature.find((f) => f.feature === "reader").calls, 9);
assert.equal(sp.calls, 11); assert.equal(sp.spentPence, nov.spentPence); assert.equal(sp.reached, false);
near(sp.spentPence, Math.round(sqlite.prepare("SELECT SUM(pence) AS p FROM ai_spend WHERE month = '2026-11'").get().p * 100) / 100, "the month's total");
const parts = h.aiReader.parts, add = (k) => ["shop", "total", "date", "number", "items"].reduce((t, p) => t + parts[p][k], 0);
assert.deepEqual(sp.reader, { filled: add("filled"), agreed: add("agreed"), differed: add("differed") }, "filled / agreed / differed, as receipt_ai_reads counts them");
assert.ok(sp.reader.agreed > 0);
assert.ok(!JSON.stringify(sp).includes(J) && !JSON.stringify(sp).includes("Brindle"), "no shopper and nothing read in it");
for (const t of [jess, sam]) assert.equal((await call("/relay/my/admin/health", { token: t })).status, 404, "not for shoppers");
assert.equal((await call("/relay/my/admin/health", {})).status, 401, "not for anyone signed out");
// Account deletion takes the shopper's daily figures with it.
assert.equal((await call("/relay/my/delete", { method: "POST", token: sam })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_spend_shopper WHERE shopper_id = ?").get(S).n, 0);
console.log("ok - Relay health: this month's spend against the £20 limit, by feature, and gaps filled / agreed / differed; team only");
console.log("PASS AI spending: recorded per call, monthly and per-shopper daily limits checked before each call, every feature falls back, no re-send on a reader version bump");
