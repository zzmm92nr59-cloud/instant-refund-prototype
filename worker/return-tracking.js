// Return tracking (Connor, 18 Nov 2026: instant refunds are Relay's main selling point, and the pilot pays one only once
// the return is confirmed on its way). Where a return has got to, on the receipt it belongs to:
//
//   Return started  →  Sent back (on its way to the shop)  →  Received by the shop  →  Refund issued / received
//
// Each step carries the day and who said so: a carrier ("from Royal Mail": its tracking through Ship24, or its own email),
// the shop ("from ASOS's email"), the shopper's bank ("seen in your bank payments", a refund only) or the shopper ("you
// said"). Whom Relay believes first, when two say the same step: the carrier's tracking, the carrier's email, the shop's
// email, the bank, the shopper. Relay never makes a step up: a step nobody told Relay about is not ticked, even when a
// later one is (24 Nov 2026; a refund doesn't prove a parcel was sent: some shops refund without one). It is marked
// `missed` so the app can say "Relay wasn't told".
//
// Where the news comes from:
//  * Emails, read from the shopper's own inboxes only (gmail.js, receipt-parser.js): the shop's return email with its label
//    or QR code (return_instructions), a carrier's label, drop-off or delivered-to-the-shop email, a shop's "your return is
//    on its way", "we've received your return" and "your refund has been processed" (return_update). Matched to one of that
//    shopper's own receipts (attachReturnTracking): the return parcel's tracking number; else the same shop and order
//    number; else the same shop, the refund amount (the order's total, an item's price or a set of its items) and a date
//    within 120 days of the order; else the same shop and that date window when exactly one of its orders already has a
//    return started. Anything that fits more than one receipt, or none, is left out: Relay doesn't guess.
//  * The shopper: "I've sent it back" on the receipt's page, with the return's tracking number if they have it
//    (POST /relay/my/receipts/<id>/return-sent). The carrier is worked out from the number only where its format is
//    unmistakable (guessCarrier); otherwise the app asks.
//  * Ship24, for the return parcel, under the same rules and the same 10-a-month allowance as deliveries
//    (parcel-tracking.js trackNumber): only when the shopper opens that receipt (GET /relay/my/receipts/<id>/return-parcel),
//    only with a tracking number, only before the shop has it, only for a return sent in the last 30 days. Never on a timer.
//
//  * The shopper's bank (bank.js refundCredits), for the refund only and only on a receipt whose return Relay already
//    knows of: money in, on one of their own cards or accounts, whose bank text names the shop, of the amount the shop's
//    refund email gave (or, with no such email, the order's total, an item's price or a set of its items), on or after the
//    day the return started, inside the 120 days. A credit that fits two receipts, or two credits that fit one, are left out.
//
// For a future Plus instant refund (no money moves here): each receipt carries returnInTransit and returnReceived, true only
// when a carrier or the shop said so, never on the shopper's word alone, and onItsWay: who confirmed the parcel left the
// shopper, how, and when (the carrier's first scan time when its tracking gave one). returnFacts; docs/RETURN_TRACKING.md.
//
// Kept with the shopper (return_tracks: what they typed), shown in Download my data, deleted with the receipt's inbox, the
// email permission or the account.
import { storeKey } from "./receipt-category.js";
import { indexBy, among } from "./list-index.js";
import { trackingLink } from "./receipt-parser.js";
import { TRACKING_NUMBER, trackingAvailable, trackNumber } from "./parcel-tracking.js";

export const RETURN_TRACKS_SQL = `CREATE TABLE IF NOT EXISTS return_tracks (shopper_id TEXT NOT NULL, receipt_id TEXT NOT NULL,
  tracking_number TEXT, carrier TEXT, sent_on TEXT NOT NULL, changes INTEGER NOT NULL DEFAULT 1, changes_day TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (shopper_id, receipt_id))`;

export const STEPS = ["started", "sent", "received", "refunded"];
export const RETURN_CARRIERS = ["Royal Mail", "Parcelforce", "Evri", "InPost", "DPD", "Collect+", "Yodel", "DHL", "UPS", "FedEx"];
// How many times a day one receipt's "I've sent it back" can be saved, and how many receipts a shopper can keep it on.
export const SAVES_PER_RECEIPT_PER_DAY = 10, RECEIPTS_WITH_TRACKING = 300;
export const REFUND_NUDGE_DAYS = 14, LIVE_DAYS = 30, MATCH_DAYS = 120;
const DAY = 864e5;
const day = (s) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const letters = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// A tracking number as the shopper typed or pasted it: spaces and dashes out, capitals. undefined when it can't be one.
export function cleanTrackingNumber(raw) {
  if (typeof raw !== "string") return undefined;
  const t = raw.toUpperCase().replace(/[\s-]+/g, "");
  return TRACKING_NUMBER.test(t) && /\d/.test(t) ? t : undefined;
}
// The carrier, only where the number's format belongs to one carrier: Royal Mail's tracked numbers (two letters, nine
// digits, GB), Yodel's (JJD and digits) and Evri's (H and fifteen letters and digits). Anything else: the app asks.
export function guessCarrier(tn) {
  const t = String(tn || "");
  if (/^[A-Z]{2}\d{9}GB$/.test(t)) return "Royal Mail";
  if (/^JJD\d{12,20}$/.test(t)) return "Yodel";
  if (/^H[0-9A-Z]{15}$/.test(t) && /\d/.test(t.slice(1))) return "Evri";
  return null;
}

// Does an amount the shop refunded fit this order: its total, one line's price, or one set of its lines?
// going: the lines the shopper said are going back, when they said (their positions in o.items). Then only the order's
// total or a set of those lines fits: money the size of a line they kept isn't taken to be this return's refund.
function amountFits(pence, o, going) {
  if (!Number.isInteger(pence) || pence <= 0) return false;
  if (Number.isInteger(o.totalPence) && pence === o.totalPence) return true;
  const told = going && going.length ? new Set(going) : null;
  const prices = (o.items || []).map((it, i) => (it && Number.isInteger(it.pricePence) && (!told || told.has(i)) ? it.pricePence * (Number(it.qty) > 0 && !it.lineTotal ? Number(it.qty) : 1) : null)).filter((p) => p != null);
  if (prices.length > 12) return prices.includes(pence);
  for (let mask = 1; mask < (1 << prices.length); mask++) {
    let sum = 0;
    for (let k = 0; k < prices.length; k++) if (mask & (1 << k)) sum += prices[k];
    if (sum === pence) return true;
  }
  return false;
}
const shopName = (o) => (o && o.retailer && (o.retailer.name || o.retailer.domain)) || null;
// A carrier names the shop a parcel is going to ("Your return to ASOS"): it fits when the names agree.
function nameFits(name, o) {
  const n = letters(name), mine = letters(o.retailer && o.retailer.name), key = storeKey(o);
  if (n.length < 3) return false;
  return n === mine || n === key || (mine.length >= 3 && (mine.startsWith(n) || n.startsWith(mine))) || (key.length >= 3 && (key.startsWith(n) || n.startsWith(key)));
}

// What each email or row says, in one shape: { stage, at, by: "carrier"|"shop"|"you", name, via, tn, carrier, ref, shopKey, shopNamed, amountPence, currency }.
function fromUpdate(u) {
  const carrierSaid = Boolean(u.fromCarrier);
  return { stage: u.stage, at: day(u.at), by: carrierSaid ? "carrier" : "shop", name: carrierSaid ? (u.carrier || null) : shopName(u), via: "email",
    tn: u.trackingNumber ? String(u.trackingNumber).toUpperCase() : null, carrier: u.carrier || null, ref: u.orderRef ? String(u.orderRef).toUpperCase() : null,
    shopKey: !carrierSaid && u.retailer && (u.retailer.domain || u.retailer.name) ? storeKey(u) : null, shopNamed: carrierSaid ? u.shopNamed || null : null,
    amountPence: Number.isInteger(u.amountPence) ? u.amountPence : null, currency: u.currency || null };
}
// Money back seen in the shopper's bank payments: the refund step only, and the weakest word after the shopper's own.
// `fits` is asked of each receipt whose return is already known. names(text, shop, domain): bank.js namesShop.
function creditNews(orders, credits, newsOf, names, goingOf) {
  const out = new Map(), taken = new Map();
  if (!names) return out;
  for (const c of credits || []) {
    if (!c || !Number.isInteger(c.pence) || c.pence <= 0 || !day(c.on) || !c.text) continue;
    const fit = orders.filter((o) => {
      const news = newsOf(o);
      if (!news.length || !o.orderDate || !o.retailer || String(o.currency || "GBP") !== String(c.currency || "GBP")) return false;
      if (!names(c.text, o.retailer.name, o.retailer.domain)) return false;
      const first = news.map((n) => n.at).filter(Boolean).sort()[0] || day(o.orderDate);
      if (c.on < first || c.on < day(o.orderDate) || daysBetween(day(o.orderDate), c.on) > MATCH_DAYS) return false;
      // The shop's own refund email gave an amount: only that amount. Otherwise what the order could refund.
      const said = news.filter((n) => n.stage === "refunded" && n.by !== "bank" && n.amountPence != null);
      return said.length ? said.some((n) => n.amountPence === c.pence) : amountFits(c.pence, o, goingOf ? goingOf(o) : null);
    });
    if (fit.length !== 1) continue;
    taken.set(fit[0], (taken.get(fit[0]) || []).concat([c]));
  }
  for (const [o, list] of taken) {
    if (list.length !== 1) continue;   // two credits that fit one receipt: Relay can't tell which is this return's
    const c = list[0];
    out.set(o, { stage: "refunded", at: day(c.on), by: "bank", name: c.account || null, via: "bank", amountPence: c.pence, currency: c.currency || "GBP" });
  }
  return out;
}

// A carrier's parcel email (delivery_update) only counts for a return when its tracking number is the return's.
function fromDelivery(d) {
  if (!d.trackingNumber) return null;
  const stage = d.status === "delivered" ? "received" : ["in_transit", "out_for_delivery", "due"].includes(d.status) ? "sent" : null;
  return stage ? { stage, at: day(d.at), by: "carrier", name: d.carrier || null, via: "email", tn: String(d.trackingNumber).toUpperCase(), carrier: d.carrier || null, onlyByNumber: true } : null;
}

// Puts each email's news on the one receipt it belongs to (or on none). orders: this shopper's receipts (merged, so an
// order's emails share one card). Returns Map(order → [news]).
export function matchReturnNews(orders, news, known, opened) {
  const out = new Map(orders.map((o) => [o, []]));
  const add = (o, n) => { out.get(o).push(n); if (n.tn && !known.has(n.tn)) known.set(n.tn, o); };
  const within = (n, o) => n.at && o.orderDate && n.at >= o.orderDate && daysBetween(o.orderDate, n.at) <= MATCH_DAYS;
  const shopFits = (n, o) => (n.shopKey ? n.shopKey === storeKey(o) : n.shopNamed ? nameFits(n.shopNamed, o) : false);
  // (Only the receipts that could fit are checked, by the same rules: those with the number the news names, or of the shop
  // it names. A shopper with thousands of receipts waited while each email was checked against all of them, 20 Nov 2026.)
  let byRef = null, byShop = null;
  const withRef = (ref) => { byRef = byRef || indexBy(orders, (o) => (o.orderRef ? [String(o.orderRef).toUpperCase()] : [])); return among(byRef, [ref]); };
  const ofShop = (n) => { if (!n.shopKey) return orders; byShop = byShop || indexBy(orders, (o) => [storeKey(o)]); return among(byShop, [n.shopKey]); };
  const pick = (n) => {
    if (n.tn && known.has(n.tn)) return known.get(n.tn);
    if (n.onlyByNumber) return undefined;     // wait: a later pass may learn the number
    if (n.ref) {
      const same = withRef(n.ref).filter((o) => o.orderRef && String(o.orderRef).toUpperCase() === n.ref && (n.shopKey || n.shopNamed ? shopFits(n, o) : true));
      if (same.length === 1) return same[0];
      if (same.length > 1) return null;
    }
    const pool = ofShop(n).filter((o) => shopFits(n, o) && within(n, o));
    const fit = n.amountPence != null ? pool.filter((o) => amountFits(n.amountPence, o)) : pool.filter((o) => opened.has(o));
    return fit.length === 1 ? fit[0] : n.tn ? undefined : null;
  };
  let left = news.slice().sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  // Twice round: news matched by order number can teach Relay the return's tracking number, which the rest is matched by.
  for (let pass = 0; pass < 2 && left.length; pass++) {
    const later = [];
    for (const n of left) { const o = pick(n); if (o) add(o, n); else if (o === undefined) later.push(n); }
    left = later;
  }
  return out;
}

// Who to believe for a step: the carrier's tracking, the carrier's email, the shop's email, the bank, then the shopper's
// own word; then the earliest (the latest for a refund).
const trust = (n) => (n.by === "carrier" ? (n.via === "tracking" ? 0 : 1) : n.by === "shop" ? 2 : n.by === "bank" ? 3 : 4);
const sureWord = (n) => n.by === "carrier" || n.by === "shop";
function best(list, stage) {
  if (!list.length) return null;
  const rank = trust;
  return list.slice().sort((a, b) => rank(a) - rank(b) || (stage === "refunded" ? (b.at || "").localeCompare(a.at || "") : (a.at || "9999").localeCompare(b.at || "9999")))[0];
}

// One receipt's return: its timeline and the facts a future instant refund can rely on. null when Relay knows of no return.
export function returnTimeline(o, news, today) {
  const by = Object.fromEntries(STEPS.map((s) => [s, news.filter((n) => n.stage === s)]));
  // The shop received it, or refunded it: that's the shop's own word that it arrived.
  const top = [...STEPS].reverse().find((s) => by[s].length);
  if (!top) return null;
  const typed = news.find((n) => n.typed) || null;
  const numbered = typed && typed.tn ? typed : news.find((n) => n.tn && sureWord(n)) || null;
  const tn = numbered ? numbered.tn : null;
  const carrier = (typed && typed.tn === tn && typed.carrier) || (numbered && numbered.carrier) || (tn && guessCarrier(tn)) || news.map((n) => n.carrier).find(Boolean) || null;
  const reach = STEPS.indexOf(top);
  const steps = STEPS.map((s, i) => {
    const b = best(by[s], s);
    // Nobody told Relay about this step: not done, even when a later one is (missed).
    if (!b) return { step: s, done: false, at: null, from: null, ...(i < reach ? { missed: true } : {}) };
    // The shop said it refunded and the money was also seen coming in: both are shown.
    const bank = s === "refunded" && b.by !== "bank" ? by[s].find((n) => n.by === "bank") : null;
    return { step: s, done: true, at: b.at || null, from: { by: b.by, name: b.by === "you" ? null : b.name || null, via: b.via },
      ...(b.atTime ? { atTime: b.atTime } : {}),
      ...(s === "refunded" && b.amountPence != null ? { amountPence: b.amountPence, currency: b.currency || "GBP" } : {}),
      ...(bank ? { seenInBank: { at: bank.at || null, account: bank.name || null } } : {}) };
  });
  // Only a carrier's or the shop's word makes a fact: never the shopper's, and never a bank payment that looks like the refund.
  const sure = (s) => by[s].some(sureWord);
  const returnReceived = sure("received") || sure("refunded");
  const returnInTransit = !returnReceived && sure("sent");
  const word = (n) => (n ? { by: n.by, name: n.name || null, at: n.at || null, via: n.via || null, atTime: n.atTime || null } : null);
  const confirmed = returnReceived ? best(by.received.concat(by.refunded).filter(sureWord), "received") : returnInTransit ? best(by.sent.filter(sureWord), "sent") : null;
  // The one fact a future instant refund asks for: did a carrier or the shop confirm the parcel left the shopper, how and
  // when? Their word that it's on its way; failing that, their word that it arrived (it was sent, though nobody said when).
  // A refund alone doesn't say a parcel was sent.
  const handed = best(by.sent.filter(sureWord), "sent") || best(by.received.filter(sureWord), "received");
  const onItsWay = handed ? { ...word(handed), ...(handed.stage === "received" ? { arrived: true } : {}) } : null;
  // "Refund not seen yet": only when Relay really saw the shop (or the carrier) say it arrived, and no refund since.
  const recv = best(by.received.filter(sureWord), "received");
  let refundNotSeen = null;
  if (recv && recv.at && !by.refunded.length && daysBetween(recv.at, today) >= REFUND_NUDGE_DAYS) refundNotSeen = { since: recv.at, days: daysBetween(recv.at, today) };
  const problem0 = news.find((n) => n.problem) || null, problem = problem0 ? { ...problem0, at: problem0.problemAt || problem0.at } : null;
  // When the parcel last moved, by anyone's word: Ship24 is asked only for a return sent in the last 30 days.
  const lastDay = [steps[1].at, steps[0].at, typed && typed.at].filter(Boolean).sort().pop() || null;
  const live = Boolean(tn && !returnReceived && top !== "refunded" && lastDay && daysBetween(lastDay, today) <= LIVE_DAYS);
  return {
    state: top, steps, trackingNumber: tn, carrier, trackUrl: tn ? trackingLink(carrier, tn) : null,
    typed: typed ? { trackingNumber: typed.tn || null, carrier: typed.carrier || null, sentOn: typed.at } : null,
    returnInTransit, returnReceived,
    confirmedBy: word(confirmed), onItsWay,
    refundNotSeen, ...(problem ? { problem: { at: problem.at || null, name: problem.name || null } } : {}),
    liveTracking: live
  };
}

// Puts the return timeline on each receipt (o.returnTracking), with returnInTransit and returnReceived beside it.
// plans: the shops' return emails already on their receipts (o.returnPlan). updates: return_update emails. deliveries:
// carriers' parcel emails. typed: this shopper's return_tracks rows. tracked: their parcel_tracks rows (Ship24). marks:
// receipt_item_marks rows ("I'm sending this back": { id, i, status, at }, i the line's position on the receipt).
// credits: money in from the shopper's bank payments (bank.js refundCredits), with names (bank.js namesShop).
export function attachReturnTracking(orders, { updates = [], deliveries = [], typed = [], tracked = [], marks = [], credits = [], names = null, today }) {
  const idsOf = (o) => o.emailIds || [o.id];
  const byId = new Map();
  for (const o of orders) for (const id of idsOf(o)) byId.set(id, o);
  const own = new Map(orders.map((o) => [o, []]));
  const known = new Map(), opened = new Set();
  for (const o of orders) {
    const p = o.returnPlan;
    if (p) {
      own.get(o).push({ stage: "started", at: day(p.at), by: "shop", name: shopName(o), via: "email", tn: p.trackingNumber ? String(p.trackingNumber).toUpperCase() : null, carrier: p.carrier || null });
      opened.add(o);
      if (p.trackingNumber) known.set(String(p.trackingNumber).toUpperCase(), o);
    }
  }
  // Which lines of each receipt the shopper said are going back (their positions in its items).
  const going = new Map();
  for (const m of marks) {
    const o = m.status === "returning" && byId.get(m.id);
    if (!o) continue;
    if (Number.isInteger(m.i) && m.i >= 0) going.set(o, (going.get(o) || []).concat([m.i]));
    if (!own.get(o).some((n) => n.marked)) own.get(o).push({ stage: "started", at: m.at ? new Date(Number(m.at)).toISOString().slice(0, 10) : null, by: "you", via: "app", marked: true });
    opened.add(o);
  }
  for (const r of typed) {
    const o = byId.get(r.receipt_id);
    if (!o) continue;
    const tn = r.tracking_number ? String(r.tracking_number).toUpperCase() : null;
    own.get(o).push({ stage: "sent", at: day(r.sent_on), by: "you", via: "app", tn, carrier: r.carrier || null, typed: true });
    opened.add(o);
    if (tn) known.set(tn, o);
  }
  const purchaseNumbers = new Set(orders.map((o) => o.delivery && o.delivery.trackingNumber && String(o.delivery.trackingNumber).toUpperCase()).filter(Boolean));
  const news = updates.map(fromUpdate).concat(deliveries.map(fromDelivery).filter((n) => n && !purchaseNumbers.has(n.tn)));
  const matched = matchReturnNews(orders, news, known, opened);
  // Ship24's word on the return parcel, once its number is known.
  const live = new Map((tracked || []).filter((r) => r && r.status).map((r) => [String(r.tracking_number).toUpperCase(), r]));
  const numbersOf = new Map();
  for (const [tn, o] of known) numbersOf.set(o, (numbersOf.get(o) || []).concat([tn]));
  const allOf = new Map();
  for (const o of orders) {
    const all = own.get(o).concat(matched.get(o) || []);
    allOf.set(o, all);
    for (const tn of numbersOf.get(o) || []) {
      if (!live.has(tn) || purchaseNumbers.has(tn)) continue;
      const r = live.get(tn), carrier = all.map((n) => n.carrier).find(Boolean) || guessCarrier(tn) || null;
      // The carrier's first scan: the day and time it first had the parcel (parcel-tracking.js firstScan). Without one
      // (a parcel looked up before Relay kept it), the day of the carrier's latest news; never its expected delivery day.
      const scan = r.first_scan && day(r.first_scan) ? { at: day(r.first_scan), atTime: String(r.first_scan) } : null;
      const said = { by: "carrier", name: carrier, via: "tracking", tn };
      if (r.status === "delivered") {
        all.push({ ...said, stage: "received", at: day(r.at) });
        if (scan) all.push({ ...said, stage: "sent", ...scan });
      } else if (r.status === "problem") {
        // Something went wrong with it. It counts as sent only if the carrier scanned it first.
        all.push(scan ? { ...said, stage: "sent", ...scan, problem: true, problemAt: day(r.at) } : { ...said, stage: null, at: day(r.at), problem: true });
      } else all.push({ ...said, stage: "sent", ...(scan || { at: r.status === "due" ? null : day(r.at) }) });
    }
  }
  // Money back seen in the bank: only on a receipt whose return is already known.
  const fromBank = creditNews(orders, credits, (o) => allOf.get(o).filter((n) => n.stage), names, (o) => going.get(o) || null);
  for (const o of orders) {
    const all = allOf.get(o);
    if (fromBank.has(o)) all.push(fromBank.get(o));
    const t = returnTimeline(o, all, today);
    if (!t) continue;
    // The lines this return is for, when the shopper said: the timeline and its tracking number are about those, not the
    // rest of the order. Left out when nobody said which (gmail.js attachItemReturns adds a refund's one clear answer).
    if (going.has(o)) { t.items = [...new Set(going.get(o))].sort((a, b) => a - b); t.itemsFrom = "you"; }
    o.returnTracking = t;
    o.returnInTransit = t.returnInTransit;
    o.returnReceived = t.returnReceived;
    // The older shape the app and Wrapped read (attachReturnProgress), filled in from the timeline where it was missing.
    const recv = t.steps[2], paid = t.steps[3];
    if (o.returnProgress) {
      const p = o.returnProgress;
      if (!p.receivedAt && recv.from && recv.from.by !== "you") p.receivedAt = recv.at;   // (a carrier or the shop: only they say "received")
      if (!p.refundedAt && paid.from && paid.from.by !== "bank") { p.refundedAt = paid.at; p.refundPence = paid.amountPence ?? null; p.currency = paid.currency || null; }
      if (!p.trackingNumber && t.trackingNumber) { p.trackingNumber = t.trackingNumber; p.carrier = p.carrier || t.carrier; p.trackUrl = p.trackUrl || t.trackUrl; }
    } else if (t.state !== "started" || o.returnPlan) {
      o.returnProgress = { trackingNumber: t.trackingNumber, carrier: t.carrier, trackUrl: t.trackUrl, parcel: null,
        receivedAt: recv.from && recv.from.by !== "you" ? recv.at : null, refundedAt: paid.from && paid.from.by !== "bank" ? paid.at : null,
        refundPence: paid.from && paid.from.by !== "bank" ? paid.amountPence ?? null : null, currency: paid.from && paid.from.by !== "bank" ? paid.currency || null : null };
    }
  }
}

// The facts a future Plus instant refund can rely on, for one receipt from the shopper's own list (docs/SECURITY.md).
// returnInTransit: a carrier (its email or its tracking) or the shop said the return parcel is on its way, and nobody has
// said it arrived. returnReceived: the shop said it has the return (or refunded it), or the carrier delivered it to the shop.
// The shopper's own word never makes either true, and neither does a bank payment that looks like the refund.
// onItsWay: the single fact to pay on. null until a carrier or the shop confirmed the parcel left the shopper; then
//   { by: "carrier" | "shop", name, via: "tracking" | "email", at: the day, atTime: the carrier's first scan time when its
//     tracking gave one (as the carrier wrote it), arrived: true when all Relay was told is that it arrived }.
// statement says the same in words, for logs and support ("On its way: confirmed by Royal Mail's tracking, first scan
// 2026-11-23T09:14:00"). docs/RETURN_TRACKING.md.
export function returnFacts(card) {
  const t = card && card.returnTracking, w = (t && t.onItsWay) || null;
  const who = w ? (w.by === "carrier" ? (w.name || "the carrier") + "'s " + (w.via === "tracking" ? "tracking" : "email") : (w.name || "the shop") + "'s email") : null;
  const statement = !w ? "Not confirmed on its way" : w.arrived ? "Arrived at the shop: confirmed by " + who + (w.at ? " on " + w.at : "")
    : "On its way: confirmed by " + who + (w.atTime ? ", first scan " + w.atTime : w.at ? " on " + w.at : "");
  return { receiptId: card ? card.id : null, returnInTransit: Boolean(t && t.returnInTransit), returnReceived: Boolean(t && t.returnReceived),
    confirmedBy: (t && t.confirmedBy) || null, onItsWay: w, statement, trackingNumber: (t && t.trackingNumber) || null, state: (t && t.state) || null };
}

export async function readReturnTracks(db, shopperId) {
  try { return (await db.prepare("SELECT receipt_id, tracking_number, carrier, sent_on FROM return_tracks WHERE shopper_id = ?").bind(shopperId).all()).results || []; }
  catch { return []; }   // not made yet: nothing typed
}

// "I've sent it back": what the shopper sent, checked. Answers { value } or { error }.
export function cleanReturnSent(b, today, orderDate) {
  const body = b && typeof b === "object" ? b : {};
  let tn = null;
  if (body.trackingNumber != null && String(body.trackingNumber).trim() !== "") { tn = cleanTrackingNumber(body.trackingNumber); if (!tn) return { error: "bad_tracking_number" }; }
  let carrier = null;
  if (body.carrier != null && body.carrier !== "") { if (!RETURN_CARRIERS.includes(body.carrier)) return { error: "bad_carrier" }; carrier = body.carrier; }
  let sentOn = today;
  if (body.sentOn != null && body.sentOn !== "") {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(body.sentOn) && !Number.isNaN(Date.parse(body.sentOn + "T00:00:00Z")) && new Date(body.sentOn + "T00:00:00Z").toISOString().slice(0, 10) === body.sentOn ? body.sentOn : null;
    if (!d || d > today || daysBetween(d, today) > 90 || (orderDate && d < orderDate)) return { error: "bad_date" };
    sentOn = d;
  }
  const guessed = !carrier && tn ? guessCarrier(tn) : null;
  return { value: { trackingNumber: tn, carrier: carrier || guessed, sentOn, guessed: Boolean(guessed), needsCarrier: Boolean(tn && !carrier && !guessed) } };
}

// Saves (or, with undo, removes) the shopper's "I've sent it back" on one of their own receipts (`card`, from their list).
export async function saveReturnSent(env, shopperId, card, body, now) {
  const db = env.RELAY_DB, today = new Date(now).toISOString().slice(0, 10);
  if (body && body.undo === true) {
    await db.prepare("DELETE FROM return_tracks WHERE shopper_id = ? AND receipt_id = ?").bind(shopperId, card.id).run();
    return { status: 200, body: { ok: true } };
  }
  const c = cleanReturnSent(body, today, day(card.orderDate));
  if (c.error) return { status: 400, body: { error: c.error } };
  const mine = await db.prepare("SELECT changes, changes_day FROM return_tracks WHERE shopper_id = ? AND receipt_id = ?").bind(shopperId, card.id).first();
  if (mine && mine.changes_day === today && mine.changes >= SAVES_PER_RECEIPT_PER_DAY) return { status: 429, body: { error: "too_many_requests" } };
  if (!mine) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM return_tracks WHERE shopper_id = ?").bind(shopperId).first();
    if (n && n.n >= RECEIPTS_WITH_TRACKING) return { status: 429, body: { error: "too_many_requests" } };
  }
  const v = c.value;
  await db.prepare(`INSERT INTO return_tracks (shopper_id, receipt_id, tracking_number, carrier, sent_on, changes, changes_day, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(shopper_id, receipt_id) DO UPDATE SET tracking_number = excluded.tracking_number, carrier = excluded.carrier,
    sent_on = excluded.sent_on, changes = CASE WHEN return_tracks.changes_day = excluded.changes_day THEN return_tracks.changes + 1 ELSE 1 END,
    changes_day = excluded.changes_day, updated_at = excluded.updated_at`)
    .bind(shopperId, card.id, v.trackingNumber, v.carrier, v.sentOn, today, now, now).run();
  return { status: 200, body: { ok: true, carrierGuessed: v.guessed, needsCarrier: v.needsCarrier } };
}

// Where the return parcel is, from the carrier through Ship24, when the shopper opens that receipt. `card` is from their own
// list. Answers { available, asked, reason? }; the caller reads the receipt again to show what changed.
export async function liveReturnParcel(env, shopperId, card, o = {}) {
  if (!trackingAvailable(env)) return { available: false, asked: false };
  const t = card && card.returnTracking;
  if (!t || !t.trackingNumber) return { available: true, asked: false, reason: "no_tracking_number" };
  if (t.returnReceived || t.state === "refunded") return { available: true, asked: false, reason: "arrived" };
  if (!t.liveTracking) return { available: true, asked: false, reason: "not_tracked" };
  const r = await trackNumber(env, shopperId, t.trackingNumber, t.carrier, o);
  return r.row ? { available: true, asked: true } : { available: true, asked: false, reason: r.reason };
}

