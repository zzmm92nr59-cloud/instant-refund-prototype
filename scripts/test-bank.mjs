// Offline test (real SQLite; TrueLayer is a stand-in): bank and card payments through open banking (worker/bank.js). Off
// until the keys are set; while it uses test banks only the team and testers can use it; read-only scopes; the single-use
// state; tokens kept encrypted; payments read and matched to receipts (same amount, within a week, the bank names the shop,
// or the only one of that amount); each shopper sees only their own; disconnecting and deleting the account remove it all.
// People, shops and payments are made up.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION } from "../worker/gmail.js";
import { matchPayments, namesShop, BANK_SCOPES, shopName, isShopping } from "../worker/bank.js";

{
  assert.ok(namesShop("SAINSBURYS S/MKTS LONDON", "Sainsbury's", "sainsburys.co.uk"));
  assert.ok(namesShop("AMZNMKTPLACE AMAZON.CO.UK", "Amazon", "amazon.co.uk"));
  assert.ok(namesShop("LULULEMON ATHLETICA UK", "lululemon", "lululemon.co.uk"));
  assert.ok(!namesShop("TESCO STORES 3012", "Sainsbury's", "sainsburys.co.uk"));
  const R = [{ id: "r1", shop: "Brindle & Co", domain: "brindle.example", date: "2026-11-02", totalPence: 4500 }, { id: "r2", shop: "Fern Row", domain: "fernrow.example", date: "2026-11-03", totalPence: 4500 },
    { id: "r3", shop: "Oak Barn", domain: "oakbarn.example", date: "2026-11-05", totalPence: 1999 }, { id: "r4", shop: "Tiny Shop", domain: "tiny.example", date: "2026-11-05", totalPence: 300 }];
  const P = [{ payment_id: "a", paid_on: "2026-11-03", amount_minor: 4500, description: "BRINDLE AND CO LONDON" }, { payment_id: "b", paid_on: "2026-11-04", amount_minor: 4500, description: "SQ *MARKET STALL" },
    { payment_id: "c", paid_on: "2026-11-06", amount_minor: 1999, description: "CARD PAYMENT 0412" }, { payment_id: "d", paid_on: "2026-11-30", amount_minor: 1999, description: "OAK BARN" },
    { payment_id: "e", paid_on: "2026-11-05", amount_minor: 300, description: "CARD 99" }, { payment_id: "f", paid_on: "2026-11-03", amount_minor: -4500, description: "BRINDLE REFUND" }];
  const m = matchPayments(P, R);
  assert.deepEqual(Object.fromEntries(m), { a: { receiptId: "r1", match: "sure" }, b: { receiptId: "r2", match: "likely" }, c: { receiptId: "r3", match: "likely" } },
    "the bank names the shop: sure; the only receipt of that amount that week: likely; too late, too small or money coming in: nothing");
  assert.deepEqual(["ASDA STOES LTD", "PAYPAL *EBAY", "AMZNMKTPLACE AMAZON.CO.UK", "BRINDLE AND CO LONDON", "SQ *MARKET STALL", "H&M", "CARD PAYMENT 0412"].map((d) => shopName(d, null)),
    ["Asda", "eBay", "Amazon", "Brindle and Co", "Market Stall", "H&M", null], "shop names as a person would say them");
  assert.equal(shopName("CRD 1234", "Coffee Corner"), "Coffee Corner", "the bank's merchant name first");
  assert.deepEqual(["SAVE THE CHANGE", "PAYPAL BETFRED", "MT SECURETRADE LIM", "TRANSFER TO J SMITH", "CASH WITHDRAWAL"].map((d) => isShopping({ description: d })), [false, false, false, false, false], "not shopping");
  assert.equal(isShopping({ description: "NETFLIX.COM", transaction_category: "DIRECT_DEBIT" }), false);
  assert.equal(isShopping({ description: "TESCO EXTRA", transaction_category: "PURCHASE" }), true);
  assert.deepEqual(["EDF ENERGY", "E.ON NEXT", "RENT", "VANQUIS BANK", "BROADWAY GAMING LT CD 0315", "EE & T-MOBILE", "CREDITREPORTSERVIC", "REVOLUT", "HALIFAX", "NUDE FINANCE", "TALKTALK TELECOM"].map((d) => isShopping({ description: d })),
    [false, false, false, false, false, false, false, false, false, false, false], "bills, rent, credit, money to other banks and gaming aren't shopping");
  assert.equal(isShopping({ description: "CIRCLE K" }), true, "fuel is shopping");
  // Seen on a real Amex statement (16 Nov 2026): TfL fares are not shopping; a hyphen on its own is not part of a name.
  assert.equal(isShopping({ description: "TFL TRAVEL CHARGE TFL.GOV.UK/CP" }), false, "TfL fares");
  assert.equal(shopName("1234 - GUN -"), "Gun", "no stray hyphens");
  assert.equal(shopName("5678 - MADE-UP CAFE LONDON"), "Made-up Cafe", "and a place name at the end is dropped as before");
  assert.deepEqual(["NEXT RETAIL LTD", "WWW.TAILS.COM", "LAPTOP DIRECT LTD.", "MCDONALD'S", "W M MORRISONS PLC"].map((d) => shopName(d, null)), ["Next", "Tails.com", "Laptop Direct", "McDonald's", "Morrisons"]);
  console.log("ok - only shopping is kept (no round-ups, transfers, cash, bills or betting); shop names tidied");
  console.log("ok - matching: same amount, within a week, the bank's text names the shop (or it's the only one of that amount); nothing else guessed");
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
let calls = [];
const TL = { code: "good-code", access: "acc-1", refresh: "ref-1" };
const fetchImpl = async (url, init = {}) => {
  url = String(url); calls.push({ url, init });
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url === "https://auth.truelayer-sandbox.com/connect/token") {
    const f = new URLSearchParams(init.body);
    if (f.get("client_secret") !== "tl-secret-test") return new Response("{}", { status: 401 });
    if (f.get("grant_type") === "authorization_code" && f.get("code") === TL.code) return Response.json({ access_token: TL.access, refresh_token: TL.refresh, expires_in: 3600 });
    if (f.get("grant_type") === "refresh_token" && f.get("refresh_token") === TL.refresh) return Response.json({ access_token: "acc-2", refresh_token: "ref-2", expires_in: 3600 });
    return new Response("{}", { status: 400 });
  }
  if (url.startsWith("https://api.truelayer-sandbox.com/")) {
    const auth = (init.headers || {}).Authorization;
    if (auth !== "Bearer acc-1" && auth !== "Bearer acc-2") return new Response("{}", { status: 401 });
    const p = new URL(url).pathname;
    if (p === "/data/v1/me") return Response.json({ results: [{ provider: { display_name: "mock" } }] });
    if (p === "/data/v1/accounts") return Response.json({ results: [{ account_id: "acc0001", display_name: "Current account" }] });
    if (p === "/data/v1/cards") return Response.json({ results: [{ account_id: "card001", display_name: "Credit card", partial_card_number: "4242" }] });
    if (p === "/data/v1/accounts/acc0001/transactions") return Response.json({ results: [
      { transaction_id: "t1", timestamp: "2026-11-03T10:00:00Z", description: "BRINDLE AND CO LONDON", amount: -45.0, currency: "GBP", transaction_type: "DEBIT" },
      { transaction_id: "t2", timestamp: "2026-11-04T10:00:00Z", description: "SALARY", amount: 2000, currency: "GBP", transaction_type: "CREDIT" },
      { transaction_id: "t3", timestamp: "2026-11-04T10:00:00Z", description: "SAVE THE CHANGE", amount: -0.55, currency: "GBP", transaction_type: "DEBIT", transaction_category: "TRANSFER" },
      { transaction_id: "t4", timestamp: "2026-11-05T10:00:00Z", description: "PAYPAL BETFRED", amount: -2, currency: "GBP", transaction_type: "DEBIT" }] });
    if (p === "/data/v1/cards/card001/transactions") return Response.json({ results: [
      { transaction_id: "c1", timestamp: "2026-11-08T10:00:00Z", description: "COFFEE CORNER", merchant_name: "Coffee Corner", amount: 3.2, currency: "GBP", transaction_type: "DEBIT" }] });
    return new Response("{}", { status: 404 });
  }
  return new Response("{}", { status: 404 });
};
let emails = [];
let now = Date.UTC(2026, 10, 15, 9);
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now, fetchImpl });
async function signIn(email, ip) {
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  return (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
}
const jess = await signIn("jess.private@example.com", "5.5.5.1"), sam = await signIn("sam@example.com", "5.5.5.2");
const J = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get("jess.private@example.com").id;
for (const t of [jess, sam]) assert.equal((await call("/relay/my/consent", { method: "POST", token: t, body: { version: CONSENT_VERSION } })).status, 200);
sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)").run("00000000-0000-4000-8000-000000000001", J, "m1", "confirmed",
  JSON.stringify({ kind: "receipt", retailer: { name: "Brindle & Co", domain: "brindle.example" }, currency: "GBP", orderRef: "#1", orderDate: "2026-11-02", totalPence: 4500, category: "fashion", items: [{ name: "Scarf", qty: 1 }], parserVersion: 26 }), now);
const loc = (r) => r.headers.get("location");

// 1. Off until the keys are set; while it's on test banks, only the team and testers.
assert.deepEqual(await (await call("/relay/my/bank", { token: jess })).json(), { available: false, connections: [] });
assert.equal((await call("/relay/my/bank/connect", { method: "POST", token: jess })).status, 404);
env.TRUELAYER_CLIENT_ID = "relay-test-id"; env.TRUELAYER_CLIENT_SECRET = "tl-secret-test";
assert.deepEqual(await (await call("/relay/my/bank", { token: jess })).json(), { available: false, connections: [] }, "test banks: not for shoppers");
env.TRUELAYER_ENV = "live";
assert.deepEqual(await (await call("/relay/my/bank", { token: jess })).json(), { available: false, connections: [] }, "real banks: still team only until BANK_FOR_EVERYONE");
env.BANK_FOR_EVERYONE = "on";
assert.equal((await (await call("/relay/my/bank", { token: jess })).json()).available, true, "real banks, switched on for everyone");
assert.equal((await (await call("/relay/my/bank", { token: jess })).json()).testBanks, false);
delete env.TRUELAYER_ENV; delete env.BANK_FOR_EVERYONE;
env.RELAY_ADMIN_EMAILS = "jess.private@example.com"; env.SECOND_STEP = "off";
let r = await (await call("/relay/my/bank", { token: jess })).json();
assert.equal(r.available, true, "the team can"); assert.equal(r.testBanks, true);
console.log("ok - off until the keys are set; only Relay's team and testers, on test banks or real ones until switched on for everyone");

// 2. Connect: the bank's own page, read-only scopes, a single-use state; the code is swapped for tokens kept encrypted.
const start = await (await call("/relay/my/bank/connect", { method: "POST", token: jess })).json();
const u = new URL(start.url);
assert.equal(u.origin, "https://auth.truelayer-sandbox.com");
assert.equal(u.searchParams.get("scope"), BANK_SCOPES); assert.ok(!/payment|transfer/i.test(BANK_SCOPES), "read-only");
assert.equal(u.searchParams.get("redirect_uri"), "https://w.test/relay/bank/callback");
assert.match(u.searchParams.get("providers"), /uk-cs-mock/);
const state = u.searchParams.get("state");
assert.match(loc(await call("/relay/bank/callback?code=good-code&state=" + "x".repeat(43))), /#bank=failed$/, "an unknown state");
{ // A try that took longer than 15 minutes says so.
  const old = new URL((await (await call("/relay/my/bank/connect", { method: "POST", token: jess })).json()).url).searchParams.get("state");
  now += 16 * 60e3;
  assert.match(loc(await call("/relay/bank/callback?code=good-code&state=" + old)), /#bank=expired$/);
  now -= 16 * 60e3;
}
assert.match(loc(await call("/relay/bank/callback?error=access_denied&state=" + state)), /#bank=denied$/);
assert.match(loc(await call("/relay/bank/callback?code=good-code&state=" + state)), /#bank=connected$/);
assert.match(loc(await call("/relay/bank/callback?code=good-code&state=" + state)), /#bank=failed$/, "single-use");
const row = sqlite.prepare("SELECT * FROM bank_links WHERE shopper_id = ?").get(J);
assert.equal(row.bank, "Mock Bank");
for (const secret of ["acc-1", "ref-1"]) assert.ok(!JSON.stringify(row).includes(secret), "tokens kept encrypted");
console.log("ok - connect: the bank's own page, read-only, single-use state, tokens kept encrypted");

// 3. Payments read straight away and matched to receipts; money coming in isn't kept.
r = await (await call("/relay/my/bank/payments", { token: jess })).json();
assert.deepEqual(r.payments.map((p) => p.shop), ["Coffee Corner", "Brindle and Co"], "tidy names; round-ups and betting never kept");
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_payments WHERE description IN ('SAVE THE CHANGE', 'PAYPAL BETFRED')").get().n, 0);
assert.deepEqual(r.payments.map((p) => [p.account, p.date, p.amountPence, p.receiptId, p.match]), [
  ["Credit card ending 4242", "2026-11-08", 320, null, null], ["Current account", "2026-11-03", 4500, "00000000-0000-4000-8000-000000000001", "sure"]]);
r = await (await call("/relay/my/bank", { token: jess })).json();
assert.deepEqual(r.connections.map((c) => [c.bank, c.payments, c.matched, c.needsReconnect]), [["Mock Bank", 3, 1, false]]);
assert.deepEqual((await (await call("/relay/my/bank/payments", { token: sam })).json()), { error: "not_found" }, "Sam (not on the team) can't");
console.log("ok - payments read and matched to receipts; each shopper's own");

// 4. Reading again: not more than every 10 minutes; an expired token is renewed; a bank that ended the permission says so.
calls = [];
await call("/relay/my/bank/sync", { method: "POST", token: jess });
assert.equal(calls.filter((c) => c.url.includes("truelayer")).length, 0, "not again within 10 minutes");
now += 2 * 3600e3; calls = [];
await call("/relay/my/bank/sync", { method: "POST", token: jess });
assert.ok(calls.some((c) => c.url.endsWith("/connect/token") && new URLSearchParams(c.init.body).get("grant_type") === "refresh_token"), "renewed");
TL.refresh = "gone"; now += 2 * 3600e3;
sqlite.prepare("UPDATE bank_links SET token_iv = token_iv").run();
await call("/relay/my/bank/sync", { method: "POST", token: jess });
now += 2 * 3600e3;
const refreshAgain = await call("/relay/my/bank/sync", { method: "POST", token: jess });
r = await (await call("/relay/my/bank", { token: jess })).json();
assert.equal(r.connections[0].needsReconnect, true, "permission ended: connect again");
console.log("ok - reads at most every 10 minutes; renews its access; says when the bank needs connecting again");

// 5. In Download my data; disconnecting removes it; so does deleting the account.
const ex = await (await call("/relay/my/export", { token: jess })).json();
assert.equal(ex.banks.connections.length, 1); assert.ok(ex.banks.payments.length >= 2);
assert.ok(!JSON.stringify(ex).includes("ref-"), "no tokens in the copy");
const id = r.connections[0].id;
assert.equal((await call("/relay/my/bank/disconnect", { method: "POST", token: jess, body: { id: "00000000-0000-4000-8000-00000000abcd" } })).status, 404);
assert.equal((await call("/relay/my/bank/disconnect", { method: "POST", token: jess, body: { id } })).status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_payments WHERE shopper_id = ?").get(J).n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM bank_links WHERE shopper_id = ?").get(J).n, 0);
console.log("ok - in Download my data; disconnecting deletes the connection and its payments");
console.log("PASS open banking: off until set up, team and testers on test banks, read-only, single-use state, encrypted tokens, matching, disconnect");
