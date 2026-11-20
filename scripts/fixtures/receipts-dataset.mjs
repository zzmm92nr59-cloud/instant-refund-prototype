// A made-up shopper with thousands of receipts, for timing the receipts list and checking it gives the same answer however
// it is built (scripts/test-receipts-list-speed.mjs). Every email comes from the receipt corpus (made-up orders from the
// layouts of real UK senders' emails, scripts/fixtures/receipt-emails), read by Relay's own reader, then copied with new
// dates, order numbers and tracking numbers across 16 years and two inboxes. Some orders get more emails (a dispatch, the
// same email in the other inbox, a refund, a cancellation), and the shopper has made choices (same order, different
// orders, fixes, gifts, items returning, dismissed receipts, reminders). Nothing here is anyone's real data.
import { readdirSync, readFileSync } from "node:fs";
import { rawEmail } from "./receipt-emails/lib.mjs";
import { classifyEmail } from "../../worker/gmail.js";

const DIR = new URL("./receipt-emails/", import.meta.url);
let templates = null;
// Each corpus email read once by Relay's reader (kept per process: reading 594 emails takes a few seconds).
export function corpusTemplates() {
  if (templates) return templates;
  templates = [];
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
    const e = JSON.parse(readFileSync(new URL(f, DIR), "utf8"));
    if (!e.headers || !(e.html || e.text || e.rawB64)) continue;
    let r; try { r = classifyEmail(rawEmail(e), { gmailId: "g-" + e.id }); } catch { continue; }
    if (!r || r.status === "not_receipt" || !r.details || r.details.kind === "not_receipt") continue;
    templates.push({ name: e.id, details: r.details, status: r.status });
  }
  return templates;
}

// A steady pseudo-random sequence, so every run makes the same shopper.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const DAY = 864e5;
const uuid = (r) => { const h = () => Math.floor(r() * 16).toString(16); return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, h); };
const DATE = /\b(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?/g;
// Every date in an email's details moved by the same number of days (an order's date, its return deadline, its parcel's).
function shiftDates(text, days) {
  return text.replace(DATE, (all, d, t) => {
    const x = new Date(Date.parse(d + "T00:00:00Z") + days * DAY);
    return Number.isNaN(x.getTime()) ? all : x.toISOString().slice(0, 10) + (t || "");
  });
}
const anchor = (d) => d.orderDate || (d.at && String(d.at).slice(0, 10)) || (d.sentAt && String(d.sentAt).slice(0, 10)) || null;
function copyOf(t, { day, refSuffix, trackSuffix, gmailId }) {
  let s = JSON.stringify(t.details);
  const a = anchor(t.details);
  if (a) s = shiftDates(s, Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY));
  const d0 = t.details;
  for (const ref of new Set([d0.orderRef, ...((d0.moreOrders || []).map((m) => m && m.orderRef))].filter((x) => typeof x === "string" && x.length >= 3)))
    s = s.split(JSON.stringify(ref)).join(JSON.stringify(ref + refSuffix));
  const track = (d0.shipment && d0.shipment.trackingNumber) || d0.trackingNumber;
  if (typeof track === "string" && track.length >= 4) s = s.split(JSON.stringify(track)).join(JSON.stringify(track + trackSuffix));
  const d = JSON.parse(s);
  if (!a) d.orderDate = day;
  if (gmailId) d.gmailId = gmailId;
  return d;
}

// Rows for captured_receipts and the shopper's choices. n: how many receipt rows (all kinds) the shopper has.
export function makeShopper(shopperId, n, { seed = 7, today = "2026-11-18" } = {}) {
  const T = corpusTemplates(), r = rng(seed);
  const buys = T.filter((t) => t.details.kind === "receipt"), news = T.filter((t) => t.details.kind !== "receipt");
  const byKind = (k) => news.filter((t) => t.details.kind === k);
  const refunds = byKind("return_update"), cancels = byKind("order_update");
  // The corpus is purchase emails, so parcel news and returns' instructions are made here, the way the reader keeps them.
  const CARRIERS = ["Royal Mail", "DPD", "Evri", "UPS", "DHL"], STAGES = ["shipped", "in_transit", "out_for_delivery", "delivered"];
  const delivery = (d, day, k) => {
    const how = r();
    return { kind: "delivery_update", gmailId: "d" + k, status: STAGES[Math.floor(r() * STAGES.length)], at: day + "T1" + Math.floor(r() * 10) + ":00:00Z", carrier: CARRIERS[Math.floor(r() * CARRIERS.length)],
      // By tracking number, by order number, or a carrier's "your parcel from <shop>" with neither.
      trackingNumber: how < 0.4 ? ((d.shipment && d.shipment.trackingNumber) || "TRK" + k + "GB") : null, merchant: how >= 0.75 ? ((d.retailer && d.retailer.name) || "Shop") : null,
      retailer: how >= 0.75 ? { name: CARRIERS[Math.floor(r() * CARRIERS.length)], domain: "carrier" + Math.floor(r() * 5) + ".example" } : d.retailer, orderRef: how >= 0.4 && how < 0.75 ? d.orderRef || null : null,
      source: "shopper_email", refundEligible: false, parserVersion: d.parserVersion };
  };
  const plan = (d, day, k) => ({ kind: "return_instructions", gmailId: "p" + k, at: day, retailer: d.retailer, orderRef: r() < 0.8 ? d.orderRef || null : null, orderDate: d.orderDate || null, returnId: "RT" + k,
    deadline: null, carrier: "Royal Mail", steps: ["Pack the item", "Drop it off"], qrMentioned: r() < 0.5, estimatedRefundPence: Number.isInteger(d.totalPence) ? d.totalPence : null, currency: "GBP", trackUrl: null,
    trackingNumber: r() < 0.5 ? "RTN" + k + "GB" : null, source: "shopper_email", refundEligible: false, parserVersion: d.parserVersion });
  const rows = [];
  const end = Date.parse(today + "T00:00:00Z"), span = 16 * 365 * DAY;
  let k = 0;
  const push = (details, status, day, extra = {}) => {
    const id = uuid(r);
    const created = Date.parse(day + "T00:00:00Z") + Math.floor(r() * DAY) + Math.floor(r() * 30) * DAY;
    rows.push({ id, shopper_id: extra.box || shopperId, message_ref: (extra.box ? "box2:" : "box1:") + id, status, details: JSON.stringify({ ...details, parserVersion: details.parserVersion }), created_at: Math.min(created, end + DAY), ...extra.meta });
    return id;
  };
  const orderIds = [];
  while (rows.length < n) {
    k++;
    // Newer years have more receipts (a shopper shops online more over time), and the last 60 days have plenty.
    const age = Math.pow(r(), 1.8) * span, day = new Date(end - age).toISOString().slice(0, 10);
    const t = buys[Math.floor(r() * buys.length)];
    const suffix = String(k), d = copyOf(t, { day, refSuffix: suffix, trackSuffix: "Q" + suffix, gmailId: "g" + k });
    const id = push(d, t.status === "confirmed" || r() < 0.08 ? "confirmed" : "pending", day);
    orderIds.push({ id, d, day });
    const roll = r();
    // The same email in the shopper's second inbox (two inboxes, one order).
    if (roll < 0.06) push({ ...d, gmailId: "h" + k }, "pending", day);
    // A dispatch or delivery email for the order: by tracking number, or by its order number.
    if (roll > 0.55 && rows.length < n) push(delivery(d, new Date(Date.parse(day) + (1 + Math.floor(r() * 4)) * DAY).toISOString().slice(0, 10), k), "pending", day);
    if (roll > 0.8 && rows.length < n) push(delivery(d, new Date(Date.parse(day) + (2 + Math.floor(r() * 4)) * DAY).toISOString().slice(0, 10), k + "b"), "pending", day);
    // A refund or a return's instructions for some orders, a cancellation for a few.
    if (roll > 0.9 && rows.length < n && refunds.length) {
      const rt = refunds[Math.floor(r() * refunds.length)];
      const rd = copyOf(rt, { day: new Date(Date.parse(day) + 10 * DAY).toISOString().slice(0, 10), refSuffix: suffix, trackSuffix: "R" + suffix, gmailId: "r" + k });
      rd.orderRef = d.orderRef || rd.orderRef; rd.retailer = d.retailer;
      push(rd, "pending", day);
    }
    if (roll > 0.94 && rows.length < n) push(plan(d, new Date(Date.parse(day) + 5 * DAY).toISOString().slice(0, 10), k), "pending", day);
    if (roll > 0.3 && roll < 0.33 && rows.length < n && cancels.length) {
      const ct = cancels[Math.floor(r() * cancels.length)];
      const cd = copyOf(ct, { day: new Date(Date.parse(day) + 1 * DAY).toISOString().slice(0, 10), refSuffix: suffix, trackSuffix: "C" + suffix, gmailId: "c" + k });
      if (r() < 0.6) { cd.orderRef = d.orderRef || cd.orderRef; cd.retailer = d.retailer; }
      push(cd, "pending", day);
    }
    // Other news on its own (a carrier's email, a newsletter-ish refund), with no order of its own here.
    if (roll > 0.4 && roll < 0.45 && rows.length < n && news.length) {
      const nt = news[Math.floor(r() * news.length)];
      push(copyOf(nt, { day, refSuffix: "N" + suffix, trackSuffix: "N" + suffix, gmailId: "n" + k }), "pending", day);
    }
  }
  rows.length = n;
  // A few rows the list must leave out: dismissed (and their order number hides the order's other emails) and not receipts.
  const pick = () => orderIds[Math.floor(r() * orderIds.length)];
  const alive = new Set(rows.map((x) => x.id));
  const live = orderIds.filter((o) => alive.has(o.id));
  const pickLive = () => live[Math.floor(r() * live.length)];
  for (let i = 0; i < Math.max(5, Math.floor(n / 60)); i++) { const o = rows.find((x) => x.id === pickLive().id); if (o && o.status !== "dismissed") o.status = "dismissed"; }
  for (let i = 0; i < Math.floor(n / 20); i++) rows.push({ id: uuid(r), shopper_id: shopperId, message_ref: "skip:" + i, status: "not_receipt", details: JSON.stringify({ kind: "not_receipt" }), created_at: end - i * DAY });
  // The shopper's own choices.
  const now = end;
  const joins = [], fixes = [], gifts = [], marks = [], reminders = [], learning = [];
  for (let i = 0; i < Math.max(4, Math.floor(n / 150)); i++) {
    const a = pickLive(), b = pickLive();
    if (a.id !== b.id) joins.push({ shopper_id: shopperId, a_id: a.id < b.id ? a.id : b.id, b_id: a.id < b.id ? b.id : a.id, kind: i % 3 === 2 ? "apart" : "same", domain: (a.d.retailer && a.d.retailer.domain) || null, other_domain: (b.d.retailer && b.d.retailer.domain) || null, reader: 51, created_at: now - i * 1000 });
  }
  // Two emails of one order the reader joined, said to be different orders.
  const joined = rows.filter((x) => x.message_ref.startsWith("box1:")).map((x) => ({ x, d: JSON.parse(x.details) })).filter((e) => e.d.kind === "receipt" && e.d.gmailId && e.d.gmailId.startsWith("h"));
  for (const e of joined.slice(0, 6)) {
    const lead = rows.find((y) => y.id !== e.x.id && JSON.parse(y.details).gmailId === "g" + e.d.gmailId.slice(1));
    if (lead) { const [a, b] = lead.id < e.x.id ? [lead.id, e.x.id] : [e.x.id, lead.id]; if (!joins.some((j) => j.a_id === a && j.b_id === b)) joins.push({ shopper_id: shopperId, a_id: a, b_id: b, kind: "apart", domain: null, other_domain: null, reader: 51, created_at: now }); }
  }
  for (let i = 0; i < Math.max(4, Math.floor(n / 120)); i++) {
    const o = pickLive();
    const f = i % 4 === 0 ? { shop: "Made-up Shop " + i } : i % 4 === 1 ? { totalPence: 1000 + i } : i % 4 === 2 ? { orderDate: "2025-0" + (1 + (i % 9)) + "-1" + (i % 9) } : { items: [{ name: "Thing " + i, qty: 1, pricePence: 500 }] };
    fixes.push({ shopper_id: shopperId, receipt_id: o.id, fields: JSON.stringify(f), shop: f.shop ? 1 : 0, total: f.totalPence ? 1 : 0, date: f.orderDate ? 1 : 0, items: f.items ? 1 : 0, created_at: now - i, updated_at: now - i });
  }
  for (let i = 0; i < Math.max(4, Math.floor(n / 100)); i++) gifts.push({ shopper_id: shopperId, receipt_id: pickLive().id, is_gift: i % 5 === 4 ? 0 : 1, recipient: i % 2 ? "Someone " + i : null, updated_at: now - i });
  for (let i = 0; i < Math.max(4, Math.floor(n / 100)); i++) marks.push({ shopper_id: shopperId, receipt_id: pickLive().id, item_index: 0, status: i % 3 ? "returning" : "keeping", updated_at: now - i });
  for (let i = 0; i < Math.max(3, Math.floor(n / 200)); i++) reminders.push({ shopper_id: shopperId, receipt_id: pickLive().id, deadline: "2026-12-01", remind_at: now + DAY, title: "Return by 1 December", sent_at: i % 2 ? now - i : null });
  const domains = [...new Set(live.map((o) => o.d.retailer && o.d.retailer.domain).filter(Boolean))];
  for (let i = 0; i < Math.min(12, domains.length); i++) learning.push({ shopper_id: shopperId, store_key: domains[i * 3 % domains.length], category: i % 4 === 3 ? null : ["home", "fashion", "electronics"][i % 3], promo: i % 4 === 3 ? 1 : 0, updated_at: now });
  void pick;
  return { rows, joins, fixes, gifts, marks, reminders, learning };
}
