// Auctions: shops on Relay put clothing up for auction, Relay shoppers bid, and the winner pays the shop at its own checkout.
//
// Who does what:
//  * A shop, with its Relay key (retailer.js), starts an auction for something in its catalogue or for a one-off that isn't on
//    its website (a sample, a return, the last of a line) with its own photos, and can cancel one nobody has bid on yet.
//    Auctions are for shops on Shopify: the winner's order is made in the shop's own Shopify (Relay needs its permission to
//    create orders, "write_orders"). Square shops on Relay are still on Square's test system.
//  * Anyone can see live auctions. Auctions at Relay's own test shops (Shopify development stores) show only to Relay's
//    testing tools (?test=1), like their products and orders.
//  * Bidding needs a signed-in Relay account with delivery details: the shop needs an address to send it to.
//
// Bidding (proxy bidding, as on eBay): a bid is the most the shopper would pay. Relay bids for them only as much as it takes
// to stay ahead: the price is one step above the second-highest maximum, never more than the leader's own. Equal maximums go
// to whoever got there first. A bid in the last 2 minutes moves the end to 2 minutes after it, so nobody wins by sniping.
// Nobody sees who's bidding: shoppers see the price and how many bids; the shop sees the same, never who.
//
// Winning and paying. Relay never takes, holds or moves money:
//  * When an auction ends, Relay makes the winner's order in the shop's own Shopify, at the winning price plus the delivery
//    price the shop set, with the winner's email and delivery details, marked as not paid yet. Shopify gives a link to pay
//    it at the shop's own checkout (any way the shop takes payment), and Relay shows that link to the winner.
//  * The winner has 24 hours to pay. If they don't, Relay cancels that order (the stock goes back) and offers the item to the
//    next-highest bidder, at what they'd have paid if the first winner hadn't bid. Two unpaid wins in 90 days stop an
//    account bidding for 30 days.
//  * Once Shopify says it's paid, the shop sends it like any order. It's an ordinary online order from a shop, so the
//    shopper's usual rights apply, including changing their mind within 14 days of delivery (online auctions aren't
//    "public auctions" under the Consumer Contracts Regulations 2013, reg. 28(1)(g)).
//  * A seller may not bid on its own auction unless that was announced (Sale of Goods Act 1979, s.57(4)). Relay never
//    announces it: the shop's dashboard and Relay's terms say a shop, its staff and anyone for it can't bid.
//
// Kept: auctions and their photos; each bidder's maximum until 90 days after the auction ends; the offers to winners (with
// the shopper replaced by "deleted" when they delete their account).
import { ensureOnce } from "./once.js";
import { readDelivery } from "./delivery.js";
import { ensurePushTables, sendPush, subsOf } from "./push.js";
import { listConnectedShopifyStores } from "./shopify-connect.js";
import { ensureShopPlanTable } from "./shopify.js";

const HOUR = 3600e3, DAY = 24 * HOUR, MINUTE = 60e3;
const API_VERSION = "2026-07";
export const DURATIONS = [24, 72, 120, 168]; // hours: a day, 3 days, 5 days, a week
export const PAY_HOURS = 24;
export const EXTEND_MS = 2 * MINUTE;
export const MAX_LIVE_PER_SHOP = 20, MAX_NEW_PER_DAY = 30, MAX_PHOTOS = 4, MAX_PHOTO_BYTES = 450 * 1024;
export const START_MIN = 100, START_MAX = 1000000, DELIVERY_MAX = 5000, BID_MAX = 10000000;
export const STRIKE_WINDOW = 90 * DAY, STRIKE_PAUSE = 30 * DAY, KEEP_BIDS = 90 * DAY, MAX_OFFERS = 3;
// A shop's Shopify can be busy for a while: an order that couldn't be made is tried again every few minutes for this long.
const RETRY_FOR = 30 * MINUTE;
export const CONDITIONS = { new_tags: "New with tags", new: "New without tags", returned: "Returned, unworn", sample: "Sample", worn_good: "Worn, good condition", worn_marks: "Worn, small marks" };
const TEXT = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "");
const LONG = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n) : "");
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const json = (body, status = 200, cors = {}, cache) => Response.json(body, { status, headers: { ...cors, "Cache-Control": cache || "no-store" } });
const pounds = (m) => "£" + (m / 100).toFixed(2);

export const AUCTION_SQL = [
  `CREATE TABLE IF NOT EXISTS auctions (id TEXT PRIMARY KEY, provider TEXT NOT NULL, shop_ref TEXT NOT NULL, store_label TEXT NOT NULL,
    test_shop INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL, variant_key TEXT, title TEXT NOT NULL, variant TEXT, size TEXT, description TEXT,
    condition TEXT NOT NULL, image_url TEXT, photos INTEGER NOT NULL DEFAULT 0, start_minor INTEGER NOT NULL, delivery_minor INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'GBP', starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, status TEXT NOT NULL, price_minor INTEGER,
    bids INTEGER NOT NULL DEFAULT 0, leader_id TEXT, outcome TEXT, version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, ended_at INTEGER)`,
  "CREATE INDEX IF NOT EXISTS idx_auctions_live ON auctions(status, ends_at)",
  "CREATE INDEX IF NOT EXISTS idx_auctions_shop ON auctions(provider, shop_ref, created_at)",
  `CREATE TABLE IF NOT EXISTS auction_bidders (auction_id TEXT NOT NULL, shopper_id TEXT NOT NULL, max_minor INTEGER NOT NULL,
    first_at INTEGER NOT NULL, raised_at INTEGER NOT NULL, PRIMARY KEY (auction_id, shopper_id))`,
  "CREATE INDEX IF NOT EXISTS idx_auction_bidders_shopper ON auction_bidders(shopper_id)",
  `CREATE TABLE IF NOT EXISTS auction_offers (id TEXT PRIMARY KEY, auction_id TEXT NOT NULL, shopper_id TEXT NOT NULL, rank INTEGER NOT NULL,
    price_minor INTEGER NOT NULL, status TEXT NOT NULL, order_gid TEXT, order_name TEXT, pay_url TEXT, offered_at INTEGER NOT NULL,
    pay_by INTEGER NOT NULL, settled_at INTEGER, checked_at INTEGER, told TEXT, detail TEXT)`,
  "CREATE INDEX IF NOT EXISTS idx_auction_offers_status ON auction_offers(status, pay_by)",
  "CREATE INDEX IF NOT EXISTS idx_auction_offers_auction ON auction_offers(auction_id, rank)",
  "CREATE INDEX IF NOT EXISTS idx_auction_offers_shopper ON auction_offers(shopper_id)",
  "CREATE TABLE IF NOT EXISTS auction_photos (auction_id TEXT NOT NULL, n INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (auction_id, n))",
  "CREATE TABLE IF NOT EXISTS auction_strikes (shopper_id TEXT NOT NULL, auction_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (shopper_id, auction_id))"
];
export function ensureAuctionTables(db) {
  return ensureOnce(db, "auctions", async () => { for (const sql of AUCTION_SQL) await db.prepare(sql).run(); });
}

// ---- Prices ----
// How much the price goes up by, from where it is now.
export function increment(price) { return price < 1000 ? 50 : price < 5000 ? 100 : price < 20000 ? 200 : price < 100000 ? 500 : 1000; }
// Who's winning and at what price. bidders: [{ shopperId, max, raisedAt }].
export function standing(bidders, start) {
  if (!bidders.length) return { leader: null, price: null };
  const s = bidders.slice().sort((a, b) => b.max - a.max || a.raisedAt - b.raisedAt);
  if (s.length === 1) return { leader: s[0].shopperId, price: start };
  const top = s[0], next = s[1];
  const price = top.max === next.max ? top.max : Math.min(top.max, next.max + increment(next.max));
  return { leader: top.shopperId, price: Math.max(start, price) };
}
// The least the next bid can be: the starting price, or a step above the current price.
export function nextMinimum(a) { return a.price_minor == null ? a.start_minor : a.price_minor + increment(a.price_minor); }

// ---- What people see ----
const photoPath = (id, n) => "/relay/auctions/" + id + "/photos/" + n;
// An auction as anyone sees it: never who's bidding.
export function publicAuction(a, now = Date.now()) {
  const pictures = [];
  for (let n = 1; n <= (a.photos || 0); n++) pictures.push(photoPath(a.id, n));
  if (a.image_url) pictures.push(a.image_url);
  const live = a.status === "live";
  return {
    id: a.id, shop: a.store_label, title: a.title, variant: a.variant || null, size: a.size || null, description: a.description || null,
    condition: a.condition, conditionText: CONDITIONS[a.condition] || null, fromCatalogue: a.kind === "catalogue", pictures,
    startMinor: a.start_minor, priceMinor: a.price_minor == null ? null : a.price_minor, nextMinor: live ? nextMinimum(a) : null,
    bids: a.bids || 0, deliveryMinor: a.delivery_minor, currency: a.currency || "GBP", endsAt: a.ends_at,
    status: live ? (a.ends_at <= now ? "ending" : "live") : a.status === "cancelled" ? "cancelled" : "ended",
    sold: a.outcome === "sold" ? true : undefined, ...(a.test_shop ? { test: true } : {})
  };
}
async function bidders(db, auctionId) {
  return ((await db.prepare("SELECT shopper_id AS shopperId, max_minor AS max, raised_at AS raisedAt FROM auction_bidders WHERE auction_id = ?").bind(auctionId).all()).results || []);
}

// ---- Bidding ----
async function strikesOf(db, shopperId, now) {
  const rows = ((await db.prepare("SELECT at FROM auction_strikes WHERE shopper_id = ? AND at > ? ORDER BY at DESC").bind(shopperId, now - STRIKE_WINDOW).all()).results || []);
  return rows.length >= 2 ? rows[0].at + STRIKE_PAUSE : null;
}
// Whether this shopper can bid at all right now, and if not, why (the app says so before they try).
export async function canBid(env, shopper, now = Date.now()) {
  const db = env.RELAY_DB;
  await ensureAuctionTables(db);
  const until = await strikesOf(db, shopper.id, now);
  if (until && until > now) return { ok: false, why: "bidding_paused", until };
  if (!(await readDelivery(env, shopper.id))) return { ok: false, why: "delivery_details_needed" };
  return { ok: true };
}
export async function placeBid(env, shopper, auctionId, max, o = {}) {
  const db = env.RELAY_DB, now = o.now || Date.now();
  await ensureAuctionTables(db);
  if (typeof auctionId !== "string" || !ID.test(auctionId)) return [404, { error: "not_found" }];
  if (!Number.isInteger(max) || max < 1) return [400, { error: "bid_too_low" }];
  if (max > BID_MAX) return [400, { error: "bid_too_high", maxMinor: BID_MAX }];
  let a = await db.prepare("SELECT * FROM auctions WHERE id = ?").bind(auctionId).first();
  if (!a) return [404, { error: "not_found" }];
  if (a.status !== "live" || a.ends_at <= now) return [409, { error: "auction_ended" }];
  const allowed = await canBid(env, shopper, now);
  if (!allowed.ok) return [allowed.why === "bidding_paused" ? 403 : 409, { error: allowed.why, ...(allowed.until ? { until: allowed.until } : {}) }];
  const mine = await db.prepare("SELECT max_minor FROM auction_bidders WHERE auction_id = ? AND shopper_id = ?").bind(auctionId, shopper.id).first();
  if (a.leader_id === shopper.id) {
    // The leader can raise their own maximum (it doesn't move the price).
    if (mine && max <= mine.max_minor) return [400, { error: "bid_not_higher", maxMinor: mine.max_minor }];
  } else if (max < nextMinimum(a)) return [400, { error: "bid_too_low", nextMinor: nextMinimum(a) }];
  const was = a.leader_id;
  await db.prepare(`INSERT INTO auction_bidders (auction_id, shopper_id, max_minor, first_at, raised_at) VALUES (?,?,?,?,?)
    ON CONFLICT(auction_id, shopper_id) DO UPDATE SET max_minor = excluded.max_minor, raised_at = excluded.raised_at`).bind(auctionId, shopper.id, max, now, now).run();
  // Two bids at the same moment: each works out the standing from every maximum and saves it only if nothing changed in
  // between (the version), otherwise it reads again. So no bid is ever lost. (The maximum itself is already saved, so even
  // if the auction stays busy, the end of the auction counts it.)
  let s = null;
  for (let tries = 0; tries < 6; tries++) {
    s = standing(await bidders(db, auctionId), a.start_minor);
    // The leader raising their own maximum never moves the price (even out of a tie): only someone else's bid does.
    if (a.leader_id === shopper.id && s.leader === shopper.id && a.price_minor != null) s = { leader: s.leader, price: a.price_minor };
    const ends = a.ends_at - now < EXTEND_MS ? now + EXTEND_MS : a.ends_at;
    const done = await db.prepare(`UPDATE auctions SET price_minor = ?, leader_id = ?, bids = bids + 1, ends_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'live' RETURNING *`).bind(s.price, s.leader, ends, auctionId, a.version).first();
    if (done) { a = done; break; }
    a = await db.prepare("SELECT * FROM auctions WHERE id = ?").bind(auctionId).first();
    if (!a || a.status !== "live") return [409, { error: "auction_ended" }];
  }
  if (was && was !== s.leader && was !== shopper.id)
    await tell(env, was, { title: "You've been outbid", body: a.title + " is now " + pounds(s.price) + ". Bid again before it ends.", url: "./#open=auction&id=" + a.id }, null, o);
  return [200, { auction: publicAuction({ ...a, price_minor: s.price, leader_id: s.leader }, now), you: { maxMinor: max, leading: s.leader === shopper.id } }];
}

// ---- Telling people ----
const appUrl = (env) => String(env.RELAY_APP_URL || "https://zzmm92nr59-cloud.github.io/instant-refund-prototype/").split("#")[0];
const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// A phone alert to every device the shopper turned them on for, and (for what they must act on) an email too.
async function tell(env, shopperId, push, mail, o = {}) {
  const db = env.RELAY_DB, f = o.fetchImpl || ((...a) => fetch(...a));
  if (!shopperId || shopperId === "deleted") return;
  try {
    await ensurePushTables(db);
    for (const s of await subsOf(db, shopperId)) { try { await sendPush(env, s, push, o); } catch { /* one device failing never stops the rest */ } }
  } catch { /* alerts are a nicety */ }
  if (!mail || !env.RESEND_API_KEY) return;
  const who = await db.prepare("SELECT email FROM shoppers WHERE id = ?").bind(shopperId).first().catch(() => null);
  if (!who || !who.email) return;
  const link = appUrl(env) + "#open=auction&id=" + mail.id;
  try {
    await f("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.RELAY_EMAIL_FROM || "Relay <onboarding@resend.dev>", to: [who.email], subject: mail.subject,
        text: mail.text + "\n\nOpen Relay: " + link + "\n\nYou bid on this in Relay. Relay emails you only when there's something to do.",
        html: "<p>" + esc(mail.text).replace(/\n/g, "<br>") + '</p><p><a href="' + esc(link) + '">Open Relay</a></p><p style="color:#666">You bid on this in Relay. Relay emails you only when there\'s something to do.</p>' }) });
  } catch { /* the app shows it anyway */ }
}
const byWhen = (t) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

// ---- The shop's Shopify ----
async function gql(shop, token, query, variables, f) {
  const r = await f("https://" + shop + "/admin/api/" + API_VERSION + "/graphql.json", { method: "POST", signal: AbortSignal.timeout(20000),
    headers: { "X-Shopify-Access-Token": token, "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
  if (r.status === 429 || r.status >= 500) { await r.text().catch(() => ""); throw Object.assign(new Error("shop_busy"), { retry: true }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.errors && j.errors.length)) throw Object.assign(new Error("shop_refused"), { retry: false, detail: String((j.errors && j.errors[0] && j.errors[0].message) || r.status).slice(0, 160) });
  return j.data || {};
}
const ORDER_CREATE = `mutation RelayAuctionOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    order { id legacyResourceId name paymentCollectionDetails { additionalPaymentCollectionUrl } }
    userErrors { field message } } }`;
const ORDER_STATE = `query RelayAuctionPaid($id: ID!) { order(id: $id) { displayFinancialStatus cancelledAt paymentCollectionDetails { additionalPaymentCollectionUrl } } }`;
const ORDER_CANCEL = `mutation RelayAuctionCancel($orderId: ID!, $note: String) {
  orderCancel(orderId: $orderId, reason: CUSTOMER, restock: true, notifyCustomer: false, staffNote: $note) { orderCancelUserErrors { field message } } }`;
const payLink = (u) => (typeof u === "string" && /^https:\/\/[^\s"'<>]{8,500}$/.test(u) ? u : null);
const PAID = new Set(["PAID", "AUTHORIZED", "PARTIALLY_REFUNDED", "REFUNDED"]);
const amount = (m) => (m / 100).toFixed(2);
const money = (m) => ({ shopMoney: { amount: amount(m), currencyCode: "GBP" } });

// What the shop's Shopify is asked to make: the item at the winning price, delivery, and where it goes. Not paid yet.
export function orderInput(a, offer, email, d) {
  const variant = a.kind === "catalogue" && /ProductVariant\/(\d{1,20})$/.exec(a.variant_key || "");
  const line = variant ? { variantId: "gid://shopify/ProductVariant/" + variant[1], quantity: 1, priceSet: money(offer.price_minor), requiresShipping: true }
    : { title: a.title + (a.size ? ", size " + a.size : ""), quantity: 1, priceSet: money(offer.price_minor), requiresShipping: true, taxable: true };
  return {
    order: {
      email, currency: "GBP", financialStatus: "PENDING", taxesIncluded: true, tags: ["relay-auction"],
      ...(a.test_shop ? { test: true } : {}),
      note: "Won in a Relay auction for " + pounds(offer.price_minor) + (a.delivery_minor ? " plus " + pounds(a.delivery_minor) + " delivery" : " with free delivery") +
        ". Not paid yet: send it once it's paid. Condition: " + (CONDITIONS[a.condition] || a.condition) + ".",
      lineItems: [line],
      shippingAddress: { firstName: d.firstName, lastName: d.lastName, address1: d.line1, ...(d.line2 ? { address2: d.line2 } : {}), city: d.town,
        zip: d.postcode, countryCode: "GB", ...(d.phone ? { phone: d.phone } : {}) },
      shippingLines: [{ title: a.delivery_minor ? "Delivery" : "Free delivery", priceSet: money(a.delivery_minor) }]
    },
    // A catalogue item takes one from the shop's stock (and isn't made if there's none left); a one-off has no stock to take.
    options: { sendReceipt: false, sendFulfillmentReceipt: false, inventoryBehaviour: variant ? "DECREMENT_OBEYING_POLICY" : "BYPASS" }
  };
}
async function shopStore(env, domain, o) {
  const stores = await (o.listStores ? o.listStores() : listConnectedShopifyStores(env, o)).catch(() => []);
  return stores.find(s => s.domain === domain) || null;
}
async function canOrder(db, domain) {
  const conn = await db.prepare("SELECT scopes FROM shopify_shops WHERE domain = ?").bind(domain).first().catch(() => null);
  return Boolean(conn && String(conn.scopes || "").split(",").map(x => x.trim()).includes("write_orders"));
}

// ---- After an auction ends ----
// Offers the item to the best bidder who hasn't been offered it yet, at what they'd pay against the bidders left. After the
// winner and two more, an auction nobody paid for ends unsold (by then the price is days old).
async function offerNext(env, a, now, o) {
  const db = env.RELAY_DB;
  const tried = new Set(((await db.prepare("SELECT shopper_id FROM auction_offers WHERE auction_id = ?").bind(a.id).all()).results || []).map(r => r.shopper_id));
  const left = tried.size >= MAX_OFFERS ? [] : (await bidders(db, a.id)).filter(b => !tried.has(b.shopperId));
  if (!left.length) {
    await db.prepare("UPDATE auctions SET outcome = ? WHERE id = ?").bind(tried.size ? "unsold" : "no_bids", a.id).run();
    return null;
  }
  // The winner pays exactly the price everyone saw at the end; anyone after them, what they'd pay against the bidders left.
  const first = !tried.size && a.leader_id && a.price_minor != null && left.some(b => b.shopperId === a.leader_id);
  const s = first ? { leader: a.leader_id, price: a.price_minor } : standing(left, a.start_minor);
  const offer = { id: crypto.randomUUID(), auction_id: a.id, shopper_id: s.leader, rank: tried.size + 1, price_minor: s.price, status: "pending", offered_at: now, pay_by: now + PAY_HOURS * HOUR };
  await db.prepare(`INSERT INTO auction_offers (id, auction_id, shopper_id, rank, price_minor, status, offered_at, pay_by) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(offer.id, a.id, offer.shopper_id, offer.rank, offer.price_minor, "pending", now, offer.pay_by).run();
  await db.prepare("UPDATE auctions SET outcome = 'awaiting_payment' WHERE id = ?").bind(a.id).run();
  await makeOrder(env, a, offer, now, o);
  return offer;
}
// Makes the winner's order in the shop's Shopify, then tells them. A busy shop is tried again for a while; a refusal
// (sold out, the shop took away Relay's permission) ends it, and the winner is told there's nothing to pay.
async function makeOrder(env, a, offer, now, o) {
  const db = env.RELAY_DB, f = o.fetchImpl || ((...x) => fetch(...x));
  const first = offer.rank === 1;
  const d = await readDelivery(env, offer.shopper_id);
  if (!d) {
    if (offer.status !== "needs_address") {
      await db.prepare("UPDATE auction_offers SET status = 'needs_address' WHERE id = ?").bind(offer.id).run();
      const what = first ? "You won " + a.title + " for " + pounds(offer.price_minor) + "." : a.title + " can be yours for " + pounds(offer.price_minor) + ".";
      await tell(env, offer.shopper_id, { title: first ? "You won!" : "It can be yours", body: what + " Add your delivery details in Relay, then pay " + a.store_label + " by " + byWhen(offer.pay_by) + ".", url: "./#open=auction&id=" + a.id },
        { id: a.id, subject: (first ? "You won: " : "Yours if you want it: ") + a.title, text: what + "\n\nAdd your delivery details in Relay so " + a.store_label + " can send it, then pay by " + byWhen(offer.pay_by) + "." }, o);
    }
    return;
  }
  const who = await db.prepare("SELECT email FROM shoppers WHERE id = ?").bind(offer.shopper_id).first();
  const store = a.provider === "shopify" ? await shopStore(env, a.shop_ref, o) : null;
  let fail = null, made = null;
  if (!who) fail = "no_account";
  else if (!store || !store.token) fail = "shop_unavailable";
  else if (!(await canOrder(db, a.shop_ref))) fail = "no_permission";
  else {
    try {
      const out = (await gql(a.shop_ref, store.token, ORDER_CREATE, orderInput(a, offer, who.email, d), f)).orderCreate;
      if (!out || (out.userErrors && out.userErrors.length) || !out.order) fail = "shop_refused:" + String((out && out.userErrors && out.userErrors[0] && out.userErrors[0].message) || "").slice(0, 120);
      else made = out.order;
    } catch (e) { fail = e.retry ? "busy" : "shop_refused:" + (e.detail || ""); }
  }
  if (fail === "busy" || fail === "shop_unavailable") {
    if (now - offer.offered_at < RETRY_FOR) { await db.prepare("UPDATE auction_offers SET status = 'pending', checked_at = ? WHERE id = ?").bind(now, offer.id).run(); return; }
  }
  if (fail) {
    console.error("auction_order_failed", a.id, fail.slice(0, 160));
    await db.prepare("UPDATE auction_offers SET status = 'shop_problem', settled_at = ?, detail = ? WHERE id = ?").bind(now, fail.slice(0, 200), offer.id).run();
    await db.prepare("UPDATE auctions SET outcome = 'shop_problem' WHERE id = ?").bind(a.id).run();
    await tell(env, offer.shopper_id, { title: a.store_label + " couldn't take the order", body: "There's nothing to pay for " + a.title + ". The shop couldn't take the order, so the auction has ended without a sale.", url: "./#open=auction&id=" + a.id },
      { id: a.id, subject: "Nothing to pay: " + a.title, text: a.store_label + " couldn't take the order for " + a.title + " (it may have sold out), so there's nothing to pay. The auction has ended without a sale." }, o);
    return;
  }
  const url = payLink(made.paymentCollectionDetails && made.paymentCollectionDetails.additionalPaymentCollectionUrl);
  await db.prepare("UPDATE auction_offers SET status = 'awaiting_payment', order_gid = ?, order_name = ?, pay_url = ?, checked_at = ? WHERE id = ?")
    .bind(String(made.id), String(made.name || "").slice(0, 40) || null, url, now, offer.id).run();
  const total = offer.price_minor + a.delivery_minor;
  const what = first ? "You won " + a.title + " for " + pounds(offer.price_minor) + "." : "The winner didn't pay, so " + a.title + " can be yours for " + pounds(offer.price_minor) + ".";
  await tell(env, offer.shopper_id, { title: first ? "You won!" : "It can be yours", body: what + " Pay " + a.store_label + " " + pounds(total) + " by " + byWhen(offer.pay_by) + ".", url: "./#open=auction&id=" + a.id },
    { id: a.id, subject: (first ? "You won: " : "Yours if you want it: ") + a.title, text: what + "\n\nPay " + a.store_label + " " + pounds(total) + (a.delivery_minor ? " including delivery" : " with free delivery") +
      " by " + byWhen(offer.pay_by) + " at their own checkout. Open Relay to pay." + (first ? " If it isn't paid by then, it goes to the next bidder." : "") }, o);
}

// Every minute (worker.js): ends auctions that are due, makes winners' orders, notices payments, and moves an unpaid item on.
export async function runAuctions(env, o = {}) {
  const db = env.RELAY_DB, now = o.now || Date.now(), f = o.fetchImpl || ((...x) => fetch(...x));
  if (!db) return { ended: 0 };
  await ensureAuctionTables(db);
  const out = { ended: 0, offered: 0, paid: 0, expired: 0 };
  // 1. Due auctions: each is claimed first, so it's only ever ended once.
  for (const row of ((await db.prepare("SELECT id FROM auctions WHERE status = 'live' AND ends_at <= ? ORDER BY ends_at LIMIT 20").bind(now).all()).results || [])) {
    const a = await db.prepare("UPDATE auctions SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'live' AND ends_at <= ? RETURNING *").bind(now, row.id, now).first();
    if (!a) continue;
    out.ended++;
    if (await offerNext(env, a, now, o)) out.offered++;
  }
  // 2. Orders still to make: the shop was busy, or the winner had no delivery details and has added them since.
  for (const offer of ((await db.prepare("SELECT * FROM auction_offers WHERE status IN ('pending','needs_address') AND pay_by > ? AND (checked_at IS NULL OR checked_at < ?) LIMIT 10").bind(now, now - 2 * MINUTE).all()).results || [])) {
    const a = await db.prepare("SELECT * FROM auctions WHERE id = ?").bind(offer.auction_id).first();
    if (!a) continue;
    if (offer.status === "needs_address") await db.prepare("UPDATE auction_offers SET checked_at = ? WHERE id = ?").bind(now, offer.id).run();
    await makeOrder(env, a, offer, now, o);
  }
  // 3. Waiting for payment: asks Shopify every few minutes whether it's been paid (or the shop cancelled it).
  for (const offer of ((await db.prepare("SELECT * FROM auction_offers WHERE status = 'awaiting_payment' AND (checked_at IS NULL OR checked_at < ? OR pay_by <= ?) ORDER BY checked_at LIMIT 15").bind(now - 4 * MINUTE, now).all()).results || [])) {
    const a = await db.prepare("SELECT * FROM auctions WHERE id = ?").bind(offer.auction_id).first();
    if (!a) continue;
    const st = await orderState(env, a, offer, o, f);
    if (st && st.paid) {
      await db.prepare("UPDATE auction_offers SET status = 'paid', settled_at = ?, checked_at = ? WHERE id = ?").bind(now, now, offer.id).run();
      await db.prepare("UPDATE auctions SET outcome = 'sold' WHERE id = ?").bind(a.id).run();
      out.paid++;
      await tell(env, offer.shopper_id, { title: "Paid", body: a.store_label + " has your payment for " + a.title + " and will send it to you.", url: "./#open=auction&id=" + a.id }, null, o);
      continue;
    }
    if (st && st.cancelled) {
      await db.prepare("UPDATE auction_offers SET status = 'shop_problem', settled_at = ?, detail = 'cancelled_by_shop' WHERE id = ?").bind(now, offer.id).run();
      await db.prepare("UPDATE auctions SET outcome = 'shop_problem' WHERE id = ?").bind(a.id).run();
      await tell(env, offer.shopper_id, { title: a.store_label + " cancelled the order", body: "There's nothing to pay for " + a.title + ".", url: "./#open=auction&id=" + a.id }, null, o);
      continue;
    }
    const url = st && st.url;
    await db.prepare("UPDATE auction_offers SET checked_at = ?, pay_url = COALESCE(?, pay_url) WHERE id = ?").bind(now, url || null, offer.id).run();
    if (offer.pay_by <= now) { await expire(env, a, offer, now, o, f); out.expired++; }
  }
  // 4. Winners who never added delivery details in time: moved on in the same way.
  for (const offer of ((await db.prepare("SELECT * FROM auction_offers WHERE status IN ('pending','needs_address') AND pay_by <= ? LIMIT 10").bind(now).all()).results || [])) {
    const a = await db.prepare("SELECT * FROM auctions WHERE id = ?").bind(offer.auction_id).first();
    if (a) { await expire(env, a, offer, now, o, f); out.expired++; }
  }
  // 5. Tidying: bidders' maximums 90 days after an auction ends, and photos of auctions that ended over 90 days ago.
  await db.prepare("DELETE FROM auction_bidders WHERE auction_id IN (SELECT id FROM auctions WHERE status != 'live' AND COALESCE(ended_at, ends_at) < ?)").bind(now - KEEP_BIDS).run();
  await db.prepare("DELETE FROM auction_photos WHERE auction_id IN (SELECT id FROM auctions WHERE status != 'live' AND COALESCE(ended_at, ends_at) < ?)").bind(now - KEEP_BIDS).run();
  return out;
}
async function orderState(env, a, offer, o, f) {
  if (!offer.order_gid) return null;
  const store = await shopStore(env, a.shop_ref, o);
  if (!store || !store.token) return null;
  try {
    const d = (await gql(a.shop_ref, store.token, ORDER_STATE, { id: offer.order_gid }, f)).order;
    if (!d) return null;
    return { paid: PAID.has(String(d.displayFinancialStatus || "")), cancelled: Boolean(d.cancelledAt), url: payLink(d.paymentCollectionDetails && d.paymentCollectionDetails.additionalPaymentCollectionUrl) };
  } catch { return null; }
}
// Not paid in time: the order is cancelled at the shop (its stock goes back), the winner is told, and the next bidder gets it.
async function expire(env, a, offer, now, o, f) {
  const db = env.RELAY_DB;
  const claimed = await db.prepare("UPDATE auction_offers SET status = 'expired', settled_at = ? WHERE id = ? AND status = ? RETURNING id").bind(now, offer.id, offer.status).first();
  if (!claimed) return;
  if (offer.order_gid) {
    const store = await shopStore(env, a.shop_ref, o);
    if (store && store.token) {
      try { await gql(a.shop_ref, store.token, ORDER_CANCEL, { orderId: offer.order_gid, note: "Relay auction: not paid within " + PAY_HOURS + " hours, so it was offered to the next bidder." }, f); }
      catch (e) { console.error("auction_cancel_failed", a.id, String(e && e.message || e).slice(0, 80)); }
    }
  }
  // Only the winner's own unpaid win counts against them: an item offered later, which they didn't ask for, doesn't.
  if (offer.rank === 1 && offer.shopper_id !== "deleted")
    await db.prepare("INSERT OR IGNORE INTO auction_strikes (shopper_id, auction_id, at) VALUES (?,?,?)").bind(offer.shopper_id, a.id, now).run();
  await tell(env, offer.shopper_id, { title: "Time ran out", body: a.title + " wasn't paid for in time, so it's gone to the next bidder.", url: "./#open=auction&id=" + a.id },
    offer.rank === 1 ? { id: a.id, subject: "Time ran out: " + a.title, text: a.title + " wasn't paid for within " + PAY_HOURS + " hours, so the order was cancelled and it's gone to the next bidder. Not paying for two wins in 90 days stops bidding for 30 days." } : null, o);
  await offerNext(env, a, now, o);
}

// ---- Shops' routes (retailer.js hands these over with the shop already known) ----
function decodePhoto(raw) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(raw || ""));
  if (!m) return null;
  let bin;
  try { bin = atob(m[2]); } catch { return null; }
  if (bin.length < 100 || bin.length > MAX_PHOTO_BYTES) return { error: "photo_too_big" };
  const b = (i) => bin.charCodeAt(i);
  // What the bytes really are, whatever the label says.
  const type = b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff ? "image/jpeg" : b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 ? "image/png"
    : bin.slice(0, 4) === "RIFF" && bin.slice(8, 12) === "WEBP" ? "image/webp" : null;
  return type ? { type, data: m[2] } : null;
}
async function shopCatalogue(db, shop) {
  const conn = "shopify:" + shop.shop_ref;
  const rows = ((await db.prepare(`SELECT v.id AS variantKey, i.title AS product, v.title AS variant, v.price_minor AS priceMinor, i.image_url AS imageUrl, s.quantity AS stock
      FROM retailer_catalog_variants v JOIN retailer_catalog_items i ON i.id = v.item_id
      LEFT JOIN retailer_inventory_snapshots s ON s.variant_id = v.id AND s.connection_id = i.provider
     WHERE i.provider = ? AND v.currency = 'GBP' ORDER BY i.title, v.title LIMIT 2000`).bind(conn).all().catch(() => ({ results: [] }))).results || []);
  return rows.map(r => ({ variantKey: r.variantKey, product: r.product, variant: r.variant && r.variant !== "Default Title" ? r.variant : null, priceMinor: r.priceMinor,
    imageUrl: /^https:\/\//.test(String(r.imageUrl || "")) ? r.imageUrl : null, stock: r.stock == null ? null : Number(r.stock) }));
}
function shopView(a, offers, now) {
  const handle = String(a.shop_ref).replace(/\.myshopify\.com$/, "");
  return { ...publicAuction(a, now), outcome: a.outcome || null, createdAt: a.created_at,
    offers: offers.map(x => ({ rank: x.rank, priceMinor: x.price_minor, status: x.status === "pending" || x.status === "needs_address" ? "setting_up" : x.status,
      payBy: x.pay_by, orderName: x.order_name || null,
      orderUrl: x.order_gid && /Order\/(\d{1,20})$/.test(x.order_gid) ? "https://admin.shopify.com/store/" + handle + "/orders/" + /Order\/(\d{1,20})$/.exec(x.order_gid)[1] : null })) };
}
export async function handleRetailerAuctionRoute(request, env, url, cors, shop, o = {}) {
  const path = url.pathname, m = request.method, db = env.RELAY_DB, now = o.now || Date.now();
  if (path !== "/relay/retailer/auctions" && !path.startsWith("/relay/retailer/auctions/")) return null;
  await ensureAuctionTables(db);
  if (shop.provider !== "shopify") return json({ error: "shopify_only" }, 400, cors);
  if (path === "/relay/retailer/auctions" && m === "GET") {
    const rows = ((await db.prepare("SELECT * FROM auctions WHERE provider = ? AND shop_ref = ? ORDER BY (status = 'live') DESC, created_at DESC LIMIT 100").bind(shop.provider, shop.shop_ref).all()).results || []);
    const offers = rows.length ? ((await db.prepare(`SELECT * FROM auction_offers WHERE auction_id IN (${rows.map(() => "?").join(",")}) ORDER BY rank`).bind(...rows.map(r => r.id)).all()).results || []) : [];
    return json({ store: shop.store_label, canOrder: await canOrder(db, shop.shop_ref), durations: DURATIONS, conditions: CONDITIONS,
      auctions: rows.map(a => shopView(a, offers.filter(x => x.auction_id === a.id), now)) }, 200, cors);
  }
  if (path === "/relay/retailer/auctions/catalogue" && m === "GET") return json({ items: await shopCatalogue(db, shop) }, 200, cors);
  if (path === "/relay/retailer/auctions" && m === "POST") {
    let b = {};
    try { b = JSON.parse(await request.text() || "{}"); } catch { return json({ error: "invalid_request" }, 400, cors); }
    const [st, body] = await createAuction(env, shop, b, now);
    return json(body, st, cors);
  }
  const cancel = /^\/relay\/retailer\/auctions\/([0-9a-f-]{36})\/cancel$/.exec(path);
  if (cancel && m === "POST") {
    // Once someone has bid, it runs to the end: they bid in good faith.
    const a = await db.prepare("UPDATE auctions SET status = 'cancelled', ended_at = ?, outcome = 'cancelled' WHERE id = ? AND provider = ? AND shop_ref = ? AND status = 'live' AND bids = 0 RETURNING *")
      .bind(now, cancel[1], shop.provider, shop.shop_ref).first();
    if (a) return json({ auction: shopView(a, [], now) }, 200, cors);
    const was = await db.prepare("SELECT status, bids FROM auctions WHERE id = ? AND provider = ? AND shop_ref = ?").bind(cancel[1], shop.provider, shop.shop_ref).first();
    return json({ error: !was ? "not_found" : was.status !== "live" ? "auction_ended" : "has_bids" }, !was ? 404 : 409, cors);
  }
  return json({ error: "not_found" }, 404, cors);
}
async function createAuction(env, shop, b, now) {
  const db = env.RELAY_DB;
  if (b.agree !== true) return [400, { error: "agree_needed" }];
  if (!(await canOrder(db, shop.shop_ref))) return [409, { error: "needs_order_permission" }];
  const kind = b.kind === "catalogue" ? "catalogue" : b.kind === "oneoff" ? "oneoff" : null;
  if (!kind) return [400, { error: "bad_kind" }];
  if (!Object.prototype.hasOwnProperty.call(CONDITIONS, b.condition)) return [400, { error: "bad_condition" }];
  if (!Number.isInteger(b.startMinor) || b.startMinor < START_MIN || b.startMinor > START_MAX) return [400, { error: "bad_start", min: START_MIN, max: START_MAX }];
  const delivery = b.deliveryMinor == null ? 0 : b.deliveryMinor;
  if (!Number.isInteger(delivery) || delivery < 0 || delivery > DELIVERY_MAX) return [400, { error: "bad_delivery", max: DELIVERY_MAX }];
  if (!DURATIONS.includes(b.hours)) return [400, { error: "bad_duration" }];
  const photos = [];
  for (const raw of Array.isArray(b.photos) ? b.photos.slice(0, MAX_PHOTOS + 1) : []) {
    const p = decodePhoto(raw);
    if (!p || p.error) return [400, { error: p && p.error ? p.error : "bad_photo" }];
    photos.push(p);
  }
  if (photos.length > MAX_PHOTOS) return [400, { error: "too_many_photos", max: MAX_PHOTOS }];
  // Relay is for UK shops selling in pounds: a shop whose catalogue is all in another currency can't run auctions.
  const conn = "shopify:" + shop.shop_ref;
  const cur = await db.prepare(`SELECT SUM(v.currency = 'GBP') AS gbp, COUNT(*) AS n FROM retailer_catalog_variants v JOIN retailer_catalog_items i ON i.id = v.item_id WHERE i.provider = ?`)
    .bind(conn).first().catch(() => null);
  if (cur && Number(cur.n) > 0 && !Number(cur.gbp)) return [409, { error: "not_gbp" }];
  let title, variant = null, imageUrl = null, variantKey = null;
  if (kind === "catalogue") {
    const prefix = conn + ":variant:gid://shopify/ProductVariant/";
    if (typeof b.variantKey !== "string" || !b.variantKey.startsWith(prefix) || !/^\d{1,20}$/.test(b.variantKey.slice(prefix.length))) return [404, { error: "not_your_item" }];
    const item = (await shopCatalogue(db, shop)).find(x => x.variantKey === b.variantKey);
    if (!item) return [404, { error: "not_your_item" }];
    title = TEXT(item.product, 120); variant = item.variant ? TEXT(item.variant, 80) : null; imageUrl = item.imageUrl; variantKey = item.variantKey;
  } else {
    title = TEXT(b.title, 120);
    if (title.length < 3) return [400, { error: "title_needed" }];
    if (!photos.length) return [400, { error: "photo_needed" }];
  }
  const live = await db.prepare("SELECT COUNT(*) AS n FROM auctions WHERE provider = ? AND shop_ref = ? AND status = 'live'").bind(shop.provider, shop.shop_ref).first();
  if (Number(live && live.n) >= MAX_LIVE_PER_SHOP) return [429, { error: "too_many_live", max: MAX_LIVE_PER_SHOP }];
  const today = await db.prepare("SELECT COUNT(*) AS n FROM auctions WHERE provider = ? AND shop_ref = ? AND created_at > ?").bind(shop.provider, shop.shop_ref, now - DAY).first();
  if (Number(today && today.n) >= MAX_NEW_PER_DAY) return [429, { error: "too_many_today", max: MAX_NEW_PER_DAY }];
  await ensureShopPlanTable(db);
  const plan = await db.prepare("SELECT test_shop FROM shopify_shop_plan WHERE domain = ?").bind(shop.shop_ref).first().catch(() => null);
  const a = { id: crypto.randomUUID(), provider: shop.provider, shop_ref: shop.shop_ref, store_label: shop.store_label, test_shop: plan && Number(plan.test_shop) === 1 ? 1 : 0,
    kind, variant_key: variantKey, title, variant, size: TEXT(b.size, 40) || null, description: LONG(b.description, 1000) || null, condition: b.condition, image_url: imageUrl,
    photos: photos.length, start_minor: b.startMinor, delivery_minor: delivery, currency: "GBP", starts_at: now, ends_at: now + b.hours * HOUR, status: "live",
    price_minor: null, bids: 0, leader_id: null, outcome: null, version: 0, created_at: now, ended_at: null };
  await db.batch([
    db.prepare(`INSERT INTO auctions (id, provider, shop_ref, store_label, test_shop, kind, variant_key, title, variant, size, description, condition, image_url, photos,
      start_minor, delivery_minor, currency, starts_at, ends_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(a.id, a.provider, a.shop_ref, a.store_label, a.test_shop, a.kind, a.variant_key, a.title, a.variant, a.size, a.description, a.condition, a.image_url, a.photos,
        a.start_minor, a.delivery_minor, a.currency, a.starts_at, a.ends_at, a.status, a.created_at),
    ...photos.map((p, i) => db.prepare("INSERT INTO auction_photos (auction_id, n, type, data) VALUES (?,?,?,?)").bind(a.id, i + 1, p.type, p.data))
  ]);
  return [200, { auction: shopView(a, [], now) }];
}

// ---- Anyone's routes: live auctions, one auction, its photos ----
export async function handleAuctionPublicRoute(request, env, url, cors, o = {}) {
  const path = url.pathname;
  if (path !== "/relay/auctions" && !path.startsWith("/relay/auctions/")) return null;
  if (request.method !== "GET") return json({ error: "not_found" }, 404, cors);
  const db = env.RELAY_DB, now = o.now || Date.now();
  if (!db) return json({ error: "not_available" }, 503, cors);
  await ensureAuctionTables(db);
  const test = url.searchParams.get("test") === "1";
  if (path === "/relay/auctions") {
    const rows = ((await db.prepare(`SELECT * FROM auctions WHERE status = 'live' AND ends_at > ? ${test ? "" : "AND test_shop = 0"} ORDER BY ends_at LIMIT 100`).bind(now).all()).results || []);
    return json({ auctions: rows.map(a => publicAuction(a, now)) }, 200, cors, "public, max-age=15");
  }
  const one = /^\/relay\/auctions\/([0-9a-f-]{36})$/.exec(path);
  if (one) {
    const a = await db.prepare("SELECT * FROM auctions WHERE id = ?").bind(one[1]).first();
    if (!a || (a.test_shop && !test) || (a.status !== "live" && Number(a.ended_at || a.ends_at) < now - 30 * DAY)) return json({ error: "not_found" }, 404, cors);
    return json({ auction: publicAuction(a, now) }, 200, cors);
  }
  const photo = /^\/relay\/auctions\/([0-9a-f-]{36})\/photos\/([1-4])$/.exec(path);
  if (photo) {
    const p = await db.prepare("SELECT type, data FROM auction_photos WHERE auction_id = ? AND n = ?").bind(photo[1], Number(photo[2])).first();
    if (!p) return json({ error: "not_found" }, 404, cors);
    return new Response(Uint8Array.from(atob(p.data), c => c.charCodeAt(0)), { status: 200,
      headers: { ...cors, "Content-Type": p.type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
  }
  return json({ error: "not_found" }, 404, cors);
}

// ---- Shoppers' routes ----
// What each of the shopper's auctions means for them, in one word the app turns into a sentence.
function yourState(a, me, offer, now) {
  if (offer) {
    if (offer.status === "paid") return "paid";
    if (offer.status === "expired") return "expired";
    if (offer.status === "shop_problem") return "shop_problem";
    if (offer.status === "needs_address") return "add_address";
    if (offer.status === "pending") return "setting_up";
    return offer.pay_by > now ? (offer.rank === 1 ? "pay" : "offered") : "expired";
  }
  if (a.status === "live") return a.leader_id === me.shopper_id ? "leading" : "outbid";
  return a.status === "cancelled" ? "cancelled" : a.leader_id === me.shopper_id && (a.outcome === "awaiting_payment" || !a.outcome) ? "setting_up" : "not_won";
}
export async function handleAuctionShopperRoute(request, env, url, cors, shopper, o = {}) {
  const path = url.pathname;
  if (path !== "/relay/my/auctions" && path !== "/relay/my/auctions/bid") return null;
  const db = env.RELAY_DB, now = o.now || Date.now();
  await ensureAuctionTables(db);
  if (path === "/relay/my/auctions" && request.method === "GET") {
    const mine = ((await db.prepare(`SELECT b.max_minor, b.shopper_id, b.raised_at, a.* FROM auction_bidders b JOIN auctions a ON a.id = b.auction_id
      WHERE b.shopper_id = ? ORDER BY (a.status = 'live') DESC, a.ends_at DESC LIMIT 100`).bind(shopper.id).all()).results || []);
    const offers = ((await db.prepare("SELECT * FROM auction_offers WHERE shopper_id = ? ORDER BY offered_at DESC LIMIT 100").bind(shopper.id).all()).results || []);
    const allowed = await canBid(env, shopper, now);
    return json({
      canBid: allowed.ok, ...(allowed.ok ? {} : { why: allowed.why, ...(allowed.until ? { until: allowed.until } : {}) }),
      auctions: mine.map(r => {
        const offer = offers.find(x => x.auction_id === r.id) || null;
        const state = yourState(r, r, offer, now);
        return { auction: publicAuction(r, now), you: { maxMinor: r.max_minor, state,
          ...(offer ? { priceMinor: offer.price_minor, totalMinor: offer.price_minor + r.delivery_minor, payBy: offer.pay_by,
            payUrl: state === "pay" || state === "offered" ? offer.pay_url || null : null } : {}) } };
      })
    }, 200, cors);
  }
  if (path === "/relay/my/auctions/bid" && request.method === "POST") {
    let b = {};
    try { b = JSON.parse(await request.text() || "{}"); } catch { return json({ error: "invalid_request" }, 400, cors); }
    const [st, body] = await placeBid(env, shopper, b.auctionId, b.maxMinor, o);
    return json(body, st, cors);
  }
  return json({ error: "not_found" }, 404, cors);
}

// "Delete my account": their maximums leave live auctions (whoever's next takes the lead), and their wins stop being theirs.
// A win waiting for payment is moved on straight away (its order at the shop is cancelled by the next run).
export async function forgetAuctionBidder(env, shopperId, now = Date.now()) {
  const db = env.RELAY_DB;
  await ensureAuctionTables(db);
  const live = ((await db.prepare("SELECT a.* FROM auction_bidders b JOIN auctions a ON a.id = b.auction_id WHERE b.shopper_id = ? AND a.status = 'live'").bind(shopperId).all()).results || []);
  await db.prepare("DELETE FROM auction_bidders WHERE shopper_id = ?").bind(shopperId).run();
  for (const a of live) {
    const s = standing(await bidders(db, a.id), a.start_minor);
    // Someone leaving never puts the price up for whoever is still winning.
    const price = s.leader && s.leader === a.leader_id && a.price_minor != null ? Math.min(s.price, a.price_minor) : s.price;
    await db.prepare("UPDATE auctions SET price_minor = ?, leader_id = ?, version = version + 1 WHERE id = ? AND status = 'live'").bind(price, s.leader, a.id).run();
  }
  await db.batch([
    db.prepare("UPDATE auction_offers SET pay_by = ? WHERE shopper_id = ? AND status IN ('pending','needs_address','awaiting_payment')").bind(now, shopperId),
    db.prepare("UPDATE auction_offers SET shopper_id = 'deleted' WHERE shopper_id = ?").bind(shopperId),
    db.prepare("DELETE FROM auction_strikes WHERE shopper_id = ?").bind(shopperId)
  ]);
}

// For "Download my data": each auction bid on (with the shopper's maximum) and each win offered to them.
export async function auctionsForExport(env, shopperId) {
  const db = env.RELAY_DB;
  try {
    await ensureAuctionTables(db);
    const bids = ((await db.prepare(`SELECT a.title, a.store_label AS shop, b.max_minor AS maxMinor, b.first_at AS firstAt, b.raised_at AS lastAt, a.ends_at AS endsAt
      FROM auction_bidders b JOIN auctions a ON a.id = b.auction_id WHERE b.shopper_id = ? ORDER BY b.first_at`).bind(shopperId).all()).results || []);
    const wins = ((await db.prepare(`SELECT a.title, a.store_label AS shop, o.price_minor AS priceMinor, o.status, o.offered_at AS offeredAt, o.pay_by AS payBy, o.order_name AS orderName
      FROM auction_offers o JOIN auctions a ON a.id = o.auction_id WHERE o.shopper_id = ? ORDER BY o.offered_at`).bind(shopperId).all()).results || []);
    const iso = (t) => (t ? new Date(t).toISOString() : null);
    return { bids: bids.map(x => ({ ...x, firstAt: iso(x.firstAt), lastAt: iso(x.lastAt), endsAt: iso(x.endsAt) })),
      wins: wins.map(x => ({ ...x, offeredAt: iso(x.offeredAt), payBy: iso(x.payBy) })) };
  } catch { return { bids: [], wins: [] }; }
}
