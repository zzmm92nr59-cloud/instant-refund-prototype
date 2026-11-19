// A whole made-up inbox, not one email (round 6, 19 Nov 2026). Sequences of emails go through the same path a real inbox
// does: Relay's own scan route (POST /relay/my/gmail/scan, worker/gmail.js scan + classify) reads them from a stand-in
// Gmail into a real SQLite database, and the shopper's receipts are then read back the way the app reads them
// (GET /relay/my/receipts?all=1, GET /relay/my/wrapped). Each sequence checks what the shopper ends up seeing:
//   * one order with many emails (confirmation, dispatch, out for delivery, delivered, return label, refund, cancellation),
//     forwarded or not, in or out of order, with the order number written in different ways, is ONE receipt with the
//     right items, delivery, refund and money;
//   * two different orders stay two; a refund never joins the wrong order; a parcel email is never a purchase;
//   * reading the inbox again (a new reader, "Read it again") never adds, loses or forgets the shopper's own choices;
//   * return dates are only ever the email's or the shop's, or plainly marked as Relay's own estimate; never for food,
//     downloads, tickets or services;
//   * money: totals never count an order twice, nor a cancelled one, and pounds are never added to euros.
// Every shop, person, order number and amount here is MADE UP. Gmail and Resend are stand-ins: nothing leaves this machine.
//
// SIM_REPORT=1 prints every sequence's result and carries on past failures (how the first-try score was taken).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { handleAuthRoute } from "../worker/auth.js";
import { CONSENT_VERSION, sealToken, PARSER_VERSION } from "../worker/gmail.js";

const REPORT = process.env.SIM_REPORT === "1";
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
const db = { prepare: (sql) => stmt(sql), async batch(list) { sqlite.exec("BEGIN"); try { for (const s of list) s._exec(); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; } return []; } };
const env = { RELAY_DB: db, AUTH_SECRET: "unit-test-auth-secret-0123456789", RESEND_API_KEY: "fake-key", GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-test" };

// ---- The stand-in Gmail: one inbox per shopper, each email with the day it arrived ---------------------------------------
const DAY = 864e5;
let clock = Date.UTC(2026, 10, 19, 12);
const boxes = new Map();       // access token -> Map(id -> { raw, at })
let emails = [];
const ymdOf = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "/");
const fetchImpl = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://api.resend.com/emails")) { emails.push(JSON.parse(init.body)); return new Response("{}"); }
  if (url === "https://oauth2.googleapis.com/token") {
    const rt = new URLSearchParams(String(init.body || "")).get("refresh_token") || "";
    return Response.json({ access_token: "acc-" + rt });
  }
  const auth = String((init.headers && (init.headers.Authorization || init.headers.authorization)) || "").replace(/^Bearer /, "");
  const box = boxes.get(auth);
  if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
    const q = decodeURIComponent(url), win = /after:(\d{4}\/\d{2}\/\d{2}) before:(\d{4}\/\d{2}\/\d{2})/.exec(q);
    if (!box || !win) return Response.json({ messages: [] });
    const ids = [...box.entries()].filter(([, e]) => e.listed !== false && ymdOf(e.at) >= win[1] && ymdOf(e.at) < win[2]).map(([id]) => ({ id }));
    return Response.json({ messages: ids });
  }
  const one = /messages\/([A-Za-z0-9]+)\?format=raw$/.exec(url);
  if (one) { const e = box && box.get(one[1]); return e ? Response.json({ raw: Buffer.from(e.raw).toString("base64url") }) : new Response("{}", { status: 404 }); }
  return new Response("{}", { status: 404 });
};
const call = (path, { method = "GET", body, token, ip = "1.1.1.1" } = {}) =>
  handleAuthRoute(new Request("https://w.test" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, new URL("https://w.test" + path), {}, { now: clock, fetchImpl, busyWaitMs: 0 });

let shopperN = 0;
// A new shopper with a connected (stand-in) Gmail inbox.
async function newShopper() {
  const n = ++shopperN, email = "sim.shopper" + n + "@example.com";
  emails = [];
  await call("/relay/auth/request", { method: "POST", body: { email }, ip: "9.9." + Math.floor(n / 200) + "." + (n % 200) });
  const link = /#signin=([A-Za-z0-9_-]{43})/.exec(emails[0].text)[1];
  const token = (await (await call("/relay/auth/verify", { method: "POST", body: { token: link } })).json()).sessionToken;
  const id = sqlite.prepare("SELECT id FROM shoppers WHERE email = ?").get(email).id;
  assert.equal((await call("/relay/my/consent", { method: "POST", token, body: { version: CONSENT_VERSION } })).status, 200);
  const s = await sealToken(env, "rt" + n);
  sqlite.prepare("INSERT INTO gmail_connections (shopper_id, google_email, token_iv, token_data, connected_at, provider) VALUES (?,?,?,?,?,?)").run(id, email, s.iv, s.data, clock, null);
  const box = new Map();
  boxes.set("acc-rt" + n, box);
  let k = 0;
  return {
    token, id, box,
    // Emails arriving: each { raw, at } (at: days ago).
    deliver(list) { for (const m of list) box.set("sim" + n + "m" + (++k) + "abcdef", { raw: m.raw, at: clock - (m.daysAgo || 0) * DAY }); },
    async scan(full = false) {
      for (let i = 0; i < 40; i++) {
        const r = await call("/relay/my/gmail/scan", { method: "POST", token, body: full ? { full: true } : {} });
        const b = await r.json(); if (process.env.SIM_DEBUG) console.log("scan", JSON.stringify(b).slice(0, 300));
        assert.equal(r.status, 200, JSON.stringify(b));
        if (!b.more) return b;
      }
      throw new Error("scan never finished");
    },
    async cards() { if (process.env.SIM_DEBUG) console.log(sqlite.prepare("SELECT status, json_extract(details,'$.kind') k, json_extract(details,'$.orderRef') r, json_extract(details,'$.readTries') t FROM captured_receipts WHERE shopper_id = ?").all(id)); return (await (await call("/relay/my/receipts?all=1", { token })).json()).receipts; },
    async wrapped(year = 2026) { return (await call("/relay/my/wrapped?year=" + year, { token })).json(); }
  };
}

// ---- Made-up emails ------------------------------------------------------------------------------------------------------
const rfc = (daysAgo, h = 10) => new Date(clock - daysAgo * DAY + (h - 12) * 3600e3).toUTCString();
const dayOf = (daysAgo) => new Date(clock - daysAgo * DAY).toISOString().slice(0, 10);
const longDay = (daysAgo) => new Date(clock - daysAgo * DAY).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const gbp = (p) => "£" + (p / 100).toFixed(2);
const eur = (p) => "€" + (p / 100).toFixed(2);
let mid = 0;
function mail({ from, subject, body, daysAgo = 0, to = "sim.shopper@example.com", messageId }) {
  const raw = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Date: ${rfc(daysAgo)}`, `Message-ID: ${messageId || "<sim-" + (++mid) + "@mail.example>"}`,
    "Content-Type: text/plain; charset=utf-8", "", body].join("\r\n");
  return { raw, daysAgo };
}
// A shop's order confirmation. items: [[name, qty, pence]].
function confirmation(shop, { ref, refText, items, daysAgo, extra = "", money = gbp, total, subject }) {
  const sum = items.reduce((n, [, q, p]) => n + q * p, 0);
  return mail({ from: `${shop.name} <orders@${shop.domain}>`, daysAgo,
    subject: subject || `Your ${shop.name} order confirmation ${refText || "#" + ref}`,
    body: [`Thanks for your order, Sam!`, `Order number: ${refText || ref}`, `Order date: ${longDay(daysAgo)}`, "",
      ...items.map(([n, q, p]) => `${n} - Qty ${q} - ${money(q * p)}`), "", `Subtotal: ${money(sum)}`, `Order total: ${money(total ?? sum)}`, extra].join("\n") });
}
const dispatch = (shop, { refText, daysAgo, tracking, items }) => mail({ from: `${shop.name} <orders@${shop.domain}>`, daysAgo,
  subject: `Your order ${refText} has been dispatched`,
  body: [`Good news! Your order ${refText} is on its way.`, ...(items ? ["", ...items.map(([n, q, p]) => `${n} - Qty ${q} - ${gbp(q * p)}`)] : []), "", `Royal Mail tracking number: ${tracking}`].join("\n") });
const outForDelivery = (shop, { tracking, daysAgo }) => mail({ from: "Royal Mail <no-reply@royalmail.com>", daysAgo,
  subject: "Your parcel is out for delivery", body: `Your parcel from ${shop.name} is out for delivery today.\nTracking number: ${tracking}` });
const delivered = (shop, { tracking, daysAgo }) => mail({ from: "Royal Mail <no-reply@royalmail.com>", daysAgo,
  subject: "Your parcel has been delivered", body: `Your parcel from ${shop.name} has been delivered.\nTracking number: ${tracking}` });
const shopDelivered = (shop, { refText, daysAgo, items }) => mail({ from: `${shop.name} <orders@${shop.domain}>`, daysAgo,
  subject: `Your order ${refText} has been delivered`,
  body: [`Your order ${refText} has been delivered.`, ...(items ? ["", ...items.map(([n, q, p]) => `${n} - Qty ${q} - ${gbp(q * p)}`), `Order total: ${gbp(items.reduce((n, [, q, p]) => n + q * p, 0))}`] : [])].join("\n") });
const returnRequest = (shop, { refText, daysAgo, by, refund, returnId = "RT" + (100000 + mid) }) => mail({ from: `${shop.name} <returns@${shop.domain}>`, daysAgo,
  subject: `Thanks for your return request for order ${refText}`,
  body: [`Thanks for your return request.`, `Return ID: ${returnId}`, `Order number: ${refText}`, by ? `Please send it back no later than ${by}.` : "", refund ? `Estimated refund: ${gbp(refund)}` : "", "Drop your parcel off at any Post Office with the label attached."].join("\n") });
const refundMail = (shop, { refText, daysAgo, pence, from }) => mail({ from: from || `${shop.name} <returns@${shop.domain}>`, daysAgo,
  subject: refText ? `Your refund for order ${refText} has been processed` : "Your refund has been processed",
  body: [`We've processed your refund of ${gbp(pence)}.`, refText ? `Order number: ${refText}` : "", "It can take 3-5 working days to reach your account."].join("\n") });
const cancelled = (shop, { refText, daysAgo, pence }) => mail({ from: `${shop.name} <orders@${shop.domain}>`, daysAgo,
  subject: `Your order ${refText} has been cancelled`,
  body: [`Your order ${refText} has been cancelled.`, `Order number: ${refText}`, pence ? `We've refunded ${gbp(pence)} to your original payment method.` : ""].join("\n") });
const forward = (m, who = "Sam Taylor <sam.taylor.private@gmail.com>", daysAgo = m.daysAgo) => {
  const [head, ...rest] = m.raw.split("\r\n\r\n");
  const g = (k) => (new RegExp("^" + k + ": (.*)$", "m").exec(head) || [])[1];
  return mail({ from: who, daysAgo, subject: "Fwd: " + g("Subject"),
    body: ["---------- Forwarded message ---------", `From: ${g("From")}`, `Date: ${g("Date")}`, `Subject: ${g("Subject")}`, `To: ${who}`, "", rest.join("\r\n\r\n")].join("\n") });
};

const KESTREL = { name: "Kestrel Outdoor", domain: "kestrel-outdoor.example" };
const LARK = { name: "Lark & Finch", domain: "larkandfinch.example" };
const MOSS = { name: "Moss Lane Clothing", domain: "mosslane.example" };
const BRAMBLE = { name: "Bramble Home", domain: "bramblehome.example" };

// ---- The sequences ---------------------------------------------------------------------------------------------------------
const purchases = (cards, shop) => cards.filter((c) => (c.retailer && (c.retailer.domain === shop.domain || c.retailer.name === shop.name)));
const names = (c) => (c.items || []).map((i) => i.name).sort();
const results = [];
async function sequence(name, fn) {
  const problems = [];
  const expect = (ok, what) => { if (!ok) problems.push(what); };
  try { await fn(expect); } catch (e) { problems.push("threw: " + String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")); }
  results.push({ name, problems });
  if (REPORT) console.log((problems.length ? "WRONG " : "right ") + name + (problems.length ? "\n    - " + problems.join("\n    - ") : ""));
  else assert.deepEqual(problems, [], name);
}

// 1. One order, every email, in order, the same order number throughout.
await sequence("one order: confirmation, dispatch, out for delivery, delivered, return label, full refund", async (expect) => {
  const s = await newShopper();
  const items = [["Ridge Fleece Jacket", 1, 6400], ["Trail Socks", 2, 1000]];
  s.deliver([confirmation(KESTREL, { ref: "KO-10001", refText: "KO-10001", items, daysAgo: 20 }),
    dispatch(KESTREL, { refText: "KO-10001", daysAgo: 19, tracking: "KO123456781GB" }),
    outForDelivery(KESTREL, { tracking: "KO123456781GB", daysAgo: 17 }), delivered(KESTREL, { tracking: "KO123456781GB", daysAgo: 17 }),
    returnRequest(KESTREL, { refText: "KO-10001", daysAgo: 12, by: "15 December 2026", refund: 8400 }),
    refundMail(KESTREL, { refText: "KO-10001", daysAgo: 5, pence: 8400 })]);
  await s.scan(true);
  const cards = await s.cards(), mine = purchases(cards, KESTREL);
  expect(cards.length === 1, "one receipt in all (saw " + cards.length + ")");
  const c = mine[0] || {};
  expect(JSON.stringify(names(c)) === JSON.stringify(["Ridge Fleece Jacket", "Trail Socks"]), "both items (saw " + names(c) + ")");
  expect(c.totalPence === 8400, "total £84.00 (saw " + c.totalPence + ")");
  expect(c.delivery && c.delivery.status === "delivered", "delivered (saw " + (c.delivery && c.delivery.status) + ")");
  expect(c.returnProgress && c.returnProgress.refundPence === 8400 && c.returnProgress.refundedAt, "refunded £84.00 (saw " + JSON.stringify(c.returnProgress && c.returnProgress.refundPence) + ")");
  expect(c.returnPlan && c.returnPlan.deadline === "2026-12-15", "the return's own deadline (saw " + (c.returnPlan && c.returnPlan.deadline) + ")");
});

// 1b. The same order's emails read back to front, over three reads of the inbox (refund first, confirmation last).
await sequence("one order read back to front over three reads", async (expect) => {
  const s = await newShopper();
  const items = [["Ridge Fleece Jacket", 1, 6400], ["Trail Socks", 2, 1000]];
  s.deliver([refundMail(KESTREL, { refText: "KO-10101", daysAgo: 0, pence: 2000 })]);
  await s.scan(true);
  expect((await s.cards()).length === 0, "a refund alone is no purchase");
  clock += 3600e3;
  s.deliver([returnRequest(KESTREL, { refText: "KO-10101", daysAgo: 0, by: "15 December 2026", refund: 2000 }), delivered(KESTREL, { tracking: "KO123450001GB", daysAgo: 0 })]);
  await s.scan();
  clock += 3600e3;
  s.deliver([confirmation(KESTREL, { ref: "KO-10101", refText: "KO-10101", items, daysAgo: 0 }), dispatch(KESTREL, { refText: "KO-10101", daysAgo: 0, tracking: "KO123450001GB" })]);
  await s.scan();
  const cards = await s.cards(), c = cards[0] || {};
  expect(cards.length === 1, "one receipt (saw " + cards.length + ")");
  expect(c.totalPence === 8400 && names(c).length === 2, "the confirmation's items and total (saw " + c.totalPence + " " + names(c) + ")");
  expect(c.delivery && c.delivery.status === "delivered", "delivered (saw " + (c.delivery && c.delivery.status) + ")");
  expect(c.returnProgress && c.returnProgress.refundPence === 2000, "refund £20.00 (saw " + JSON.stringify(c.returnProgress || null) + ")");
  expect(c.itemReturns && c.itemReturns[1] === "returning" && !c.itemReturns[0], "the socks are what went back (saw " + JSON.stringify(c.itemReturns || null) + ")");
});
// 1c. Every email of an order forwarded from another inbox.
await sequence("every email of an order forwarded from another inbox", async (expect) => {
  const s = await newShopper();
  const items = [["Down Gilet", 1, 11000]];
  s.deliver([forward(confirmation(LARK, { ref: "LF-20202", refText: "LF-20202", items, daysAgo: 9 })), forward(dispatch(LARK, { refText: "LF-20202", daysAgo: 8, tracking: "LF202020202GB" })),
    forward(shopDelivered(LARK, { refText: "LF-20202", daysAgo: 6 })), forward(refundMail(LARK, { refText: "LF-20202", daysAgo: 2, pence: 11000 }))]);
  await s.scan(true);
  const cards = await s.cards(), c = cards[0] || {};
  expect(cards.length === 1, "one receipt (saw " + cards.length + ")");
  expect(c.totalPence === 11000, "£110.00 (saw " + c.totalPence + ")");
  expect(c.delivery && c.delivery.status === "delivered", "delivered (saw " + (c.delivery && c.delivery.status) + ")");
  expect(c.returnProgress && c.returnProgress.refundPence === 11000, "refunded (saw " + JSON.stringify(c.returnProgress || null) + ")");
  const w = await s.wrapped();
  expect(w.spentPence === 11000, "Wrapped counts it once (saw " + w.spentPence + ")");
});
// 1d. A dispatch email for one order never joins another order from the same shop.
await sequence("two orders from one shop, each with its own dispatch and delivery", async (expect) => {
  const s = await newShopper();
  s.deliver([confirmation(MOSS, { ref: "ML-31001", refText: "ML-31001", items: [["Rain Mac", 1, 9000]], daysAgo: 10 }),
    confirmation(MOSS, { ref: "ML-31002", refText: "ML-31002", items: [["Bucket Hat", 1, 2500]], daysAgo: 9 }),
    dispatch(MOSS, { refText: "ML-31001", daysAgo: 8, tracking: "ML310010001GB" }), dispatch(MOSS, { refText: "ML-31002", daysAgo: 7, tracking: "ML310020002GB" }),
    delivered(MOSS, { tracking: "ML310020002GB", daysAgo: 5 })]);
  await s.scan(true);
  const cards = await s.cards();
  const a = cards.find((c) => c.orderRef === "ML-31001") || {}, b = cards.find((c) => c.orderRef === "ML-31002") || {};
  expect(cards.length === 2, "two receipts (saw " + cards.length + ")");
  expect(a.delivery && a.delivery.status === "shipped", "the mac is on its way, not delivered (saw " + (a.delivery && a.delivery.status) + ")");
  expect(b.delivery && b.delivery.status === "delivered", "the hat is delivered (saw " + (b.delivery && b.delivery.status) + ")");
});

// 2. The same order written three ways: "#12345", "Order 12345", "ORD-12345".
await sequence("one order, three ways of writing its number (#55012, Order 55012, ORD-55012)", async (expect) => {
  const s = await newShopper();
  s.deliver([confirmation(LARK, { ref: "55012", refText: "#55012", items: [["Linen Shirt", 1, 4500], ["Canvas Belt", 1, 1500]], daysAgo: 15 }),
    dispatch(LARK, { refText: "55012", daysAgo: 14, tracking: "LF223344556GB" }),
    shopDelivered(LARK, { refText: "#55012", daysAgo: 12 }),
    refundMail(LARK, { refText: "ORD-55012", daysAgo: 3, pence: 1500 })]);
  await s.scan(true);
  const cards = await s.cards();
  expect(cards.length === 1, "one receipt (saw " + cards.length + ": " + cards.map((c) => c.orderRef).join(", ") + ")");
  const c = purchases(cards, LARK)[0] || {};
  expect(c.delivery && c.delivery.status === "delivered", "delivered (saw " + (c.delivery && c.delivery.status) + ")");
  expect(c.returnProgress && c.returnProgress.refundPence === 1500, "the £15.00 refund is on it (saw " + JSON.stringify(c.returnProgress || null) + ")");
  expect(c.totalPence === 6000, "total still £60.00 (saw " + c.totalPence + ")");
});

// 3. A partial refund: one item of three.
await sequence("partial refund for one item of three", async (expect) => {
  const s = await newShopper();
  s.deliver([confirmation(MOSS, { ref: "ML-7781", refText: "ML-7781", items: [["Cord Trousers", 1, 5500], ["Rib Beanie", 1, 1800], ["Wool Scarf", 1, 2900]], daysAgo: 18 }),
    refundMail(MOSS, { refText: "ML-7781", daysAgo: 4, pence: 1800 })]);
  await s.scan(true);
  const cards = await s.cards(), c = cards[0] || {};
  expect(cards.length === 1, "one receipt (saw " + cards.length + ")");
  expect(c.totalPence === 10200, "the order's total stays £102.00 (saw " + c.totalPence + ")");
  expect(c.returnProgress && c.returnProgress.refundPence === 1800, "refund £18.00 (saw " + JSON.stringify(c.returnProgress || null) + ")");
  expect(c.itemReturns && c.itemReturns[1] === "returning" && !c.itemReturns[0] && !c.itemReturns[2], "the beanie is the one going back (saw " + JSON.stringify(c.itemReturns || null) + ")");
});

// 4. The confirmation forwarded from another inbox, the dispatch from the shop.
await sequence("forwarded confirmation + the shop's own dispatch email", async (expect) => {
  const s = await newShopper();
  const conf = confirmation(BRAMBLE, { ref: "BH-40021", refText: "BH-40021", items: [["Stoneware Mug", 4, 900], ["Oak Tray", 1, 3200]], daysAgo: 9 });
  s.deliver([forward(conf, undefined, 8), dispatch(BRAMBLE, { refText: "BH-40021", daysAgo: 7, tracking: "BH998877665GB" }),
    delivered(BRAMBLE, { tracking: "BH998877665GB", daysAgo: 6 })]);
  await s.scan(true);
  const cards = await s.cards();
  expect(cards.length === 1, "one receipt (saw " + cards.length + ")");
  const c = cards[0] || {};
  expect(c.totalPence === 6800, "£68.00 (saw " + c.totalPence + ")");
  expect(JSON.stringify(names(c)) === JSON.stringify(["Oak Tray", "Stoneware Mug"]), "both items (saw " + names(c) + ")");
  expect(c.delivery && c.delivery.status === "delivered", "delivered (saw " + (c.delivery && c.delivery.status) + ")");
});

// 5. Out of order: the dispatch and refund are read first; the confirmation turns up in a later read.
await sequence("out of order: dispatch and refund read before the confirmation arrives", async (expect) => {
  const s = await newShopper();
  s.deliver([dispatch(KESTREL, { refText: "KO-20002", daysAgo: 10, tracking: "KO555666777GB", items: [["Summit Rucksack", 1, 9500]] }),
    refundMail(KESTREL, { refText: "KO-20002", daysAgo: 1, pence: 9500 })]);
  await s.scan(true);
  let cards = await s.cards();
  expect(cards.length <= 1, "at most one receipt before the confirmation (saw " + cards.length + ")");
  clock += 3600e3;
  s.deliver([confirmation(KESTREL, { ref: "KO-20002", refText: "KO-20002", items: [["Summit Rucksack", 1, 9500]], daysAgo: 0 })]);
  await s.scan();
  cards = await s.cards();
  expect(cards.length === 1, "one receipt once the confirmation is read (saw " + cards.length + ")");
  const c = cards[0] || {};
  expect(c.returnProgress && c.returnProgress.refundPence === 9500, "refund on it (saw " + JSON.stringify(c.returnProgress || null) + ")");
  expect(c.totalPence === 9500, "£95.00 (saw " + c.totalPence + ")");
});

// 6. Parcel emails alone are never a purchase.
await sequence("carrier emails alone make no receipt", async (expect) => {
  const s = await newShopper();
  s.deliver([outForDelivery(LARK, { tracking: "LF000111222GB", daysAgo: 2 }), delivered(LARK, { tracking: "LF000111222GB", daysAgo: 2 })]);
  await s.scan(true);
  const cards = await s.cards();
  expect(cards.length === 0, "no receipts (saw " + cards.length + ")");
});

// 7. The shop's "delivered" email lists the items and the total again: still one receipt.
await sequence("the shop's delivered email repeats the items and total", async (expect) => {
  const s = await newShopper();
  const items = [["Waxed Jacket", 1, 12000]];
  s.deliver([confirmation(MOSS, { ref: "ML-9001", refText: "ML-9001", items, daysAgo: 8 }), shopDelivered(MOSS, { refText: "ML-9001", daysAgo: 5, items })]);
  await s.scan(true);
  const cards = await s.cards();
  expect(cards.length === 1, "one receipt (saw " + cards.length + ")");
  expect(cards[0] && cards[0].delivery && cards[0].delivery.status === "delivered", "delivered (saw " + JSON.stringify(cards[0] && cards[0].delivery) + ")");
});

// 8. The shop sent the confirmation twice (a resend).
await sequence("the same confirmation sent twice", async (expect) => {
  const s = await newShopper();
  const c1 = confirmation(LARK, { ref: "LF-3003", refText: "LF-3003", items: [["Silk Tie", 1, 3500]], daysAgo: 6 });
  s.deliver([c1, { ...c1, raw: c1.raw.replace(/Message-ID: <[^>]+>/, "Message-ID: <resend-1@mail.example>"), daysAgo: 6 }]);
  await s.scan(true);
  const cards = await s.cards();
  expect(cards.length === 1, "one receipt (saw " + cards.length + ")");
  const w = await s.wrapped();
  expect(w.spentPence === 3500, "Wrapped counts it once (saw " + w.spentPence + ")");
});

// 9. Two genuinely different orders, same shop, same day, same total.
await sequence("two different orders, same shop, same day, same total (different order numbers)", async (expect) => {
  const s = await newShopper();
  s.deliver([confirmation(BRAMBLE, { ref: "BH-50001", refText: "BH-50001", items: [["Linen Napkins", 1, 2400]], daysAgo: 4 }),
    confirmation(BRAMBLE, { ref: "BH-50002", refText: "BH-50002", items: [["Linen Napkins", 1, 2400]], daysAgo: 4 })]);
  await s.scan(true);
  const cards = await s.cards();
  expect(cards.length === 2, "two receipts (saw " + cards.length + ")");
  const w = await s.wrapped();
  expect(w.spentPence === 4800, "Wrapped counts both (saw " + w.spentPence + ")");
});
await sequence("two coffees, same café, same day, same total, no order numbers", async (expect) => {
  const s = await newShopper();
  const cafe = (n) => mail({ from: "Hazel Bean Coffee <receipts@hazelbean.example>", daysAgo: 3, subject: "Your receipt from Hazel Bean Coffee",
    body: ["Thanks for visiting Hazel Bean Coffee", `Receipt ${n}`, "Flat White - Qty 1 - £3.40", "Total: £3.40", "Paid by card"].join("\n") });
  s.deliver([cafe("one"), cafe("two")]);
  await s.scan(true);
  const cards = await s.cards();
  expect(cards.length === 2, "two receipts (saw " + cards.length + ")");
});

// 10. A refund for the second of two orders from the same shop.
await sequence("refund belongs to the right one of two orders", async (expect) => {
  const s = await newShopper();
  s.deliver([confirmation(KESTREL, { ref: "KO-30001", refText: "KO-30001", items: [["Bivvy Bag", 1, 7000]], daysAgo: 14 }),
    confirmation(KESTREL, { ref: "KO-30002", refText: "KO-30002", items: [["Head Torch", 1, 3000]], daysAgo: 13 }),
    refundMail(KESTREL, { refText: "KO-30002", daysAgo: 2, pence: 3000 })]);
  await s.scan(true);
  const cards = await s.cards();
  const a = cards.find((c) => c.orderRef === "KO-30001") || {}, b = cards.find((c) => c.orderRef === "KO-30002") || {};
  expect(cards.length === 2, "two receipts (saw " + cards.length + ")");
  expect(!(a.returnProgress && a.returnProgress.refundedAt), "the bivvy bag isn't refunded");
  expect(b.returnProgress && b.returnProgress.refundPence === 3000, "the head torch is (saw " + JSON.stringify(b.returnProgress || null) + ")");
});
// 11. A refund with no order number, from a shop with two orders: Relay can't know which, so neither.
await sequence("refund with no order number is not guessed onto an order", async (expect) => {
  const s = await newShopper();
  s.deliver([confirmation(MOSS, { ref: "ML-4101", refText: "ML-4101", items: [["Denim Jacket", 1, 6500]], daysAgo: 14 }),
    confirmation(MOSS, { ref: "ML-4102", refText: "ML-4102", items: [["Chore Coat", 1, 6500]], daysAgo: 12 }),
    refundMail(MOSS, { refText: null, daysAgo: 2, pence: 6500 })]);
  await s.scan(true);
  const cards = await s.cards();
  expect(cards.length === 2, "two receipts (saw " + cards.length + ")");
  expect(cards.every((c) => !(c.returnProgress && c.returnProgress.refundedAt)), "neither is shown as refunded (" + cards.map((c) => c.orderRef + ":" + JSON.stringify(c.returnProgress && c.returnProgress.refundPence)).join(", ") + ")");
});
// 12. Same order number at two different shops: never joined.
await sequence("the same order number at two different shops stays two orders", async (expect) => {
  const s = await newShopper();
  s.deliver([confirmation(LARK, { ref: "1001", refText: "#1001", items: [["Leather Wallet", 1, 4000]], daysAgo: 9 }),
    confirmation(BRAMBLE, { ref: "1001", refText: "#1001", items: [["Throw Cushion", 1, 2200]], daysAgo: 9 }),
    refundMail(BRAMBLE, { refText: "#1001", daysAgo: 1, pence: 2200 })]);
  await s.scan(true);
  const cards = await s.cards();
  expect(cards.length === 2, "two receipts (saw " + cards.length + ")");
  const l = purchases(cards, LARK)[0] || {}, b = purchases(cards, BRAMBLE)[0] || {};
  expect(!(l.returnProgress && l.returnProgress.refundedAt), "Lark & Finch's wallet isn't refunded");
  expect(b.returnProgress && b.returnProgress.refundPence === 2200, "Bramble's cushion is (saw " + JSON.stringify(b.returnProgress || null) + ")");
});

// 13. A cancelled order: still shown, but plainly cancelled, and not counted as money spent.
await sequence("cancelled order is marked cancelled and not counted as spent", async (expect) => {
  const s = await newShopper();
  s.deliver([confirmation(LARK, { ref: "LF-6006", refText: "LF-6006", items: [["Suede Loafers", 1, 8900]], daysAgo: 6 }),
    cancelled(LARK, { refText: "LF-6006", daysAgo: 5, pence: 8900 }),
    confirmation(MOSS, { ref: "ML-6007", refText: "ML-6007", items: [["Field Jacket", 1, 5000]], daysAgo: 6 })]);
  await s.scan(true);
  const cards = await s.cards();
  const l = purchases(cards, LARK)[0] || {};
  expect(cards.length === 2, "two receipts (saw " + cards.length + ")");
  expect(l.cancelled && l.cancelled.at, "the loafers say cancelled (saw " + JSON.stringify(l.cancelled || null) + ")");
  expect(!l.returnBy, "a cancelled order has nothing to send back (saw " + JSON.stringify(l.returnBy || null) + ")");
  const w = await s.wrapped();
  expect(w.spentPence === 5000, "Wrapped counts only the jacket (saw " + w.spentPence + ")");
});

// 14. Money: euros are never added to pounds.
await sequence("an order in euros is never added to pounds", async (expect) => {
  const s = await newShopper();
  s.deliver([confirmation({ name: "Atelier Nord", domain: "ateliernord.example" }, { ref: "AN-881", refText: "AN-881", items: [["Merino Jumper", 1, 9000]], daysAgo: 7, money: eur }),
    confirmation(MOSS, { ref: "ML-882", refText: "ML-882", items: [["Cotton Tee", 1, 2000]], daysAgo: 7 })]);
  await s.scan(true);
  const cards = await s.cards();
  const e = cards.find((c) => c.orderRef === "AN-881") || {};
  expect(e.currency === "EUR" && e.totalPence === 9000, "the euro order says €90.00 (saw " + e.currency + " " + e.totalPence + ")");
  const w = await s.wrapped();
  expect(w.spentPence === 2000, "Wrapped's pounds total is only the £20.00 (saw " + w.spentPence + ")");
  expect(w.otherCurrency && w.otherCurrency.EUR === 9000 || (w.otherCurrencies || []).some((x) => x.currency === "EUR" && x.spentPence === 9000), "Wrapped lists the euros separately (saw " + JSON.stringify(w.otherCurrency ?? w.otherCurrencies ?? null) + ")");
});

// 15. Paid with a gift card bought earlier: the money was spent once, when the gift card was bought.
await sequence("order paid in full with a gift card bought earlier is not counted twice", async (expect) => {
  const s = await newShopper();
  s.deliver([confirmation(BRAMBLE, { ref: "BH-7001", refText: "BH-7001", items: [["Bramble Home Gift Card", 1, 5000]], daysAgo: 30 }),
    confirmation(BRAMBLE, { ref: "BH-7002", refText: "BH-7002", items: [["Ceramic Lamp", 1, 5000]], daysAgo: 10, total: 0, extra: "Gift card BH-GC-1234: -£50.00\nAmount paid: £0.00" })]);
  await s.scan(true);
  const cards = await s.cards();
  expect(cards.length === 2, "both receipts shown (saw " + cards.length + ")");
  const w = await s.wrapped();
  expect(w.spentPence === 5000, "£50.00 spent in all, not £100.00 (saw " + w.spentPence + ")");
});

// 16. Return dates: only the email's or the shop's own; never for food, downloads, tickets or services; Relay's estimate marked.
await sequence("return dates: stated window, no window, food, download, ticket, service", async (expect) => {
  const s = await newShopper();
  s.deliver([
    confirmation(MOSS, { ref: "ML-1201", refText: "ML-1201", items: [["Wool Overshirt", 1, 7000]], daysAgo: 3, extra: "You can return unworn items within 30 days of your order date." }),
    confirmation(LARK, { ref: "LF-1202", refText: "LF-1202", items: [["Knit Polo", 1, 4000]], daysAgo: 3 }),
    mail({ from: "Pip's Noodle Bar <orders@pipsnoodles.example>", daysAgo: 2, subject: "Your Pip's Noodle Bar order #PN-8812",
      body: ["Thanks for your order!", "Order #PN-8812", "Chicken Ramen - Qty 1 - £11.50", "Prawn Gyoza - Qty 1 - £5.50", "Subtotal: £17.00", "Delivery fee: £2.00", "Total: £19.00", "Your food is being prepared."].join("\n") }),
    mail({ from: "Sketchpad Apps <receipts@sketchpadapps.example>", daysAgo: 2, subject: "Your receipt for Sketchpad Pro",
      body: ["Receipt", "Order ID: SP-77120", "Sketchpad Pro (annual licence) - Qty 1 - £24.99", "Total: £24.99", "Download your software from your account."].join("\n") }),
    mail({ from: "Riverside Theatre <tickets@riversidetheatre.example>", daysAgo: 2, subject: "Your tickets: The Winter's Tale, booking RT-55101",
      body: ["Booking confirmation", "Booking reference: RT-55101", "The Winter's Tale - Stalls - Qty 2 - £64.00", "Total: £64.00", `Performance: ${longDay(-20)}, 7.30pm`, "E-tickets are attached."].join("\n") }),
    mail({ from: "Sparkle Window Cleaning <bookings@sparklewindows.example>", daysAgo: 2, subject: "Invoice INV-2290 for window cleaning",
      body: ["Invoice INV-2290", "Window cleaning (3-bed house) - Qty 1 - £25.00", "Total: £25.00", "Thanks for your business."].join("\n") })]);
  await s.scan(true);
  const cards = await s.cards();
  const by = (ref) => cards.find((c) => c.orderRef === ref) || {};
  const moss = by("ML-1201"), lark = by("LF-1202");
  expect(moss.returnBy && moss.returnBy.date === dayOf(3 - 30) && moss.returnBy.basis === "window", "the stated 30 days from the order (saw " + JSON.stringify(moss.returnBy || null) + ")");
  // No window in the email and no known policy: Relay may only keep its own estimate, marked as one (the app never shows it
  // as the shop's deadline: statedDeadline in account.js).
  expect(!lark.returnBy || lark.returnBy.estimate === true || lark.returnBy.basis === "uk_law", "no stated window: only a marked estimate (saw " + JSON.stringify(lark.returnBy || null) + ")");
  expect(!(lark.returns && (lark.returns.deadline || lark.returns.windowDays)), "nothing invented as the shop's own window (saw " + JSON.stringify(lark.returns || null) + ")");
  for (const [ref, what] of [["PN-8812", "food"], ["SP-77120", "a download"], ["RT-55101", "tickets"], ["INV-2290", "a service"]]) {
    const c = by(ref);
    expect(c.id, what + " is read (" + ref + ")");
    expect(!c.returnBy && !(c.returns && c.returns.deadline), what + " has no return date (saw " + JSON.stringify(c.returnBy || (c.returns && c.returns.deadline) || null) + ", category " + c.category + ")");
  }
});

// 17. Reading the inbox again (a new reader version, a full re-read): nothing duplicated, lost or forgotten.
await sequence("reading the whole inbox again keeps every receipt and the shopper's own choices", async (expect) => {
  const s = await newShopper();
  s.deliver([confirmation(KESTREL, { ref: "KO-40001", refText: "KO-40001", items: [["Camp Stove", 1, 4500], ["Gas Canister", 2, 500]], daysAgo: 12 }),
    dispatch(KESTREL, { refText: "KO-40001", daysAgo: 11, tracking: "KO444555666GB" }),
    confirmation(BRAMBLE, { ref: "BH-40002", refText: "BH-40002", items: [["Glass Vase", 1, 3000]], daysAgo: 12 }),
    confirmation(BRAMBLE, { ref: "BH-40003", refText: "BH-40003", items: [["Glass Vase", 1, 3000]], daysAgo: 12 }),
    confirmation(LARK, { ref: "LF-40004", refText: "LF-40004", items: [["Promo Tote", 1, 0]], daysAgo: 12 })]);
  await s.scan(true);
  let cards = await s.cards();
  const before = cards.map((c) => c.id).sort();
  const k = cards.find((c) => c.orderRef === "KO-40001"), v = cards.find((c) => c.orderRef === "BH-40002"), t = cards.find((c) => c.orderRef === "LF-40004");
  // The shopper's own choices: a gift, a fixed shop name, an item going back, one dismissed.
  assert.equal((await call(`/relay/my/receipts/${v.id}/gift`, { method: "POST", token: s.token, body: { gift: true, for: "Mum" } })).status, 200);
  assert.equal((await call(`/relay/my/receipts/${k.id}/fix`, { method: "POST", token: s.token, body: { shop: "Kestrel" } })).status, 200);
  assert.equal((await call(`/relay/my/receipts/${k.id}/items`, { method: "POST", token: s.token, body: { items: [{ index: 1, status: "returning" }] } })).status, 200);
  assert.equal((await call(`/relay/my/receipts/${t.id}/dismiss`, { method: "POST", token: s.token, body: {} })).status, 200);
  const shown = (await s.cards()).map((c) => c.id).sort();
  // A new reader: every email is read again.
  sqlite.prepare("UPDATE captured_receipts SET details = json_set(details, '$.parserVersion', ?) WHERE shopper_id = ?").run(PARSER_VERSION - 1, s.id);
  clock += 3600e3;
  await s.scan(true);
  // And "Read it again" on one receipt.
  const rr = await call(`/relay/my/receipts/${k.id}/reread`, { method: "POST", token: s.token, body: {} });
  expect(rr.status === 200, "Read it again works (saw " + rr.status + ")");
  cards = await s.cards();
  expect(JSON.stringify(cards.map((c) => c.id).sort()) === JSON.stringify(shown), "the same receipts, no more, no fewer (before " + shown.length + ", after " + cards.length + ")");
  const k2 = cards.find((c) => c.id === k.id) || {}, v2 = cards.find((c) => c.id === v.id) || {};
  expect(v2.gift && v2.gift.for === "Mum", "still a gift for Mum");
  expect(k2.retailer && k2.retailer.name === "Kestrel", "the shopper's shop name stays (saw " + (k2.retailer && k2.retailer.name) + ")");
  expect(k2.itemReturns && k2.itemReturns[1] === "returning", "the canisters are still going back (saw " + JSON.stringify(k2.itemReturns || null) + ")");
  expect(!cards.some((c) => c.id === t.id), "the dismissed one stays dismissed");
  expect(before.length === 4, "four receipts at first (saw " + before.length + ")");
  // A second whole read with nothing new changes nothing either.
  await s.scan(true);
  expect((await s.cards()).length === cards.length, "a second read adds nothing");
});

// 18. Two inbox reads of the same forwarded copy plus the original (the shopper forwarded it to themselves).
await sequence("the original and a copy forwarded to yourself are one receipt, counted once", async (expect) => {
  const s = await newShopper();
  const conf = confirmation(MOSS, { ref: "ML-5150", refText: "ML-5150", items: [["Fisherman Jumper", 1, 8800]], daysAgo: 5 });
  s.deliver([conf, forward(conf, "Sam Taylor <sim.shopper@example.com>", 4)]);
  await s.scan(true);
  const cards = await s.cards();
  expect(cards.length === 1, "one receipt (saw " + cards.length + ")");
  const w = await s.wrapped();
  expect(w.spentPence === 8800, "Wrapped counts it once (saw " + w.spentPence + ")");
});

// 19. Partial cancellation: one item of two cancelled; the order isn't cancelled, the money comes back for that item.
await sequence("one item of two cancelled: the order stays, the money for that item is not spent", async (expect) => {
  const s = await newShopper();
  s.deliver([confirmation(BRAMBLE, { ref: "BH-8801", refText: "BH-8801", items: [["Rattan Basket", 1, 2500], ["Jute Rug", 1, 6000]], daysAgo: 6 }),
    mail({ from: `${BRAMBLE.name} <orders@${BRAMBLE.domain}>`, daysAgo: 5, subject: "Part of your order BH-8801 has been cancelled",
      body: ["Sorry, part of your order has been cancelled because it's out of stock.", "Order number: BH-8801", "Jute Rug - Qty 1 - £60.00", "We've refunded £60.00 to your original payment method."].join("\n") })]);
  await s.scan(true);
  const cards = await s.cards(), c = cards[0] || {};
  expect(cards.length === 1, "one receipt (saw " + cards.length + ")");
  expect(!(c.cancelled && !c.cancelled.partial), "the whole order isn't shown as cancelled (saw " + JSON.stringify(c.cancelled || null) + ")");
  expect(c.cancelled && c.cancelled.partial && c.cancelled.amountPence === 6000, "says £60.00 of it was cancelled (saw " + JSON.stringify(c.cancelled || null) + ")");
  const w = await s.wrapped();
  expect(w.spentPence === 2500, "Wrapped counts £25.00 (saw " + w.spentPence + ")");
});

const wrong = results.filter((r) => r.problems.length);
console.log((REPORT ? "\n" : "") + `inbox simulation: ${results.length - wrong.length}/${results.length} sequences end right` + (wrong.length ? ` (${wrong.length} wrong: ${wrong.map((r) => r.name).join("; ")})` : ""));
if (wrong.length) process.exit(1);
