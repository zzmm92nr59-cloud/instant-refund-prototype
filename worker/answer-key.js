// Shops as the answer key. When a shop connected to Relay confirms an order, its own record says what was really bought:
// the order number, the day, the total and every item. So Relay can check what its email reader read from that shop's email
// about the same order, automatically, without anyone reading an email. The Relay health page shows how often each part
// was right (health.js), so a change to the reader can be seen to make things better or worse.
//
// Rules (do not weaken):
//  * Only ever within one shopper. A shop's order is compared only with the receipts of the shopper it belongs to: the one
//    whose verified sign-in email the shop sent it to (the same rule that shows them the order in the app). Nothing about
//    one shopper's order is compared with, or shown next to, anyone else's emails.
//  * Counts only, apart from the admin's own orders (theirs). A shop is named only once `minShoppers` different shoppers'
//    orders there were checked, as on the rest of the health page.
//  * It only measures. What shoppers see is unchanged, and it's the reader's own reading that's checked: a shopper's
//    corrections ("Fix this receipt") are left out.
import { mergeOrderEmails } from "./gmail.js";
import { shopDisplayName, agreedShopNames, PERSONAL_MAIL } from "./receipt-category.js";
import { cleanItems, isVia, domainBase, nameFitsDomain } from "./receipt-reader.js";
import { ensureOrderRefColumn } from "./order-ref.js";

export const ANSWER_KEY_DAYS = 90;
const DAY = 864e5;
const n = (v) => Number(v) || 0;

// ---- Telling things apart ------------------------------------------------------------------------------------------------
const letters = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
// Words that say nothing about which shop it is.
const PLAIN = new Set(["the", "and", "co", "ltd", "limited", "uk", "gb", "shop", "store", "stores", "official", "online", "london", "home", "company", "group"]);
// (A name made only of those words, "The Home Store", keeps them all.)
const nameWords = (s) => {
  const all = String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/['’.]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  const kept = all.filter((w) => !PLAIN.has(w));
  return kept.length ? kept : all;
};
// "Brindle" and "Brindle & Co", "Bows & Whistles" and "Bows and Whistles", "brindle-co" (the shop's Shopify address).
export function sameName(a, b) {
  const A = nameWords(a).join(""), B = nameWords(b).join("");
  if (!A || !B) return false;
  if (A === B) return true;
  return Math.min(A.length, B.length) >= 4 && (A.includes(B) || B.includes(A));
}
const digits = (s) => String(s == null ? "" : s).replace(/\D/g, "");
// "Order #1001", "1001" and "#1001" are the same order number.
export function sameNumber(read, order) {
  const d = digits(read);
  return d.length >= 3 && (d === digits(order.ref) || d === String(order.ext || ""));
}
// The day an order was placed, in the UK.
const UK_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
export function ukDay(iso) {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t)) return null;
  const p = Object.fromEntries(UK_DAY.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return p.year + "-" + p.month + "-" + p.day;
}
const dayGap = (a, b) => Math.round(Math.abs(Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / DAY);
const validDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) && Number.isFinite(Date.parse(d + "T12:00:00Z"));

// The shop's name as the shopper sees it on the receipt (null when none was read, or it was forwarded from a personal address).
function shownName(card, agreed) {
  const r = card.retailer || {}, domain = r.domain ? String(r.domain).toLowerCase().replace(/[^a-z0-9.-]/g, "") : null;
  if (domain && PERSONAL_MAIL.test(domain)) return null;
  return (domain && agreed && agreed.get(domain)) || shopDisplayName({ ...r, domain }) || null;
}
function shopsDomain(card) {
  const d = String((card.retailer && card.retailer.domain) || "").toLowerCase();
  return d && !isVia(d) && !PERSONAL_MAIL.test(d) ? d : null;
}
// Could this receipt be from the shop that sent this order? By its name, or by the web address its email came from.
export function sameShop(card, order, agreed) {
  const shown = shownName(card, agreed), domain = shopsDomain(card);
  if (shown && (sameName(shown, order.label) || sameName(shown, order.handle))) return true;
  return Boolean(domain && (nameFitsDomain(order.label, domain) || sameName(domainBase(domain), order.handle)));
}

// ---- One order against one receipt ---------------------------------------------------------------------------------------
// The words of an item's name, for comparing what was read with what the shop calls it.
const itemWords = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 1);
export function sameItem(read, title) {
  const a = letters(read), b = letters(title);
  if (!a || !b) return false;
  if (a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)))) return true;
  const want = itemWords(title), got = new Set(itemWords(read));
  return want.length > 0 && want.filter((w) => got.has(w)).length / want.length >= 0.6;
}
// "right": every line the shop lists was read, with its quantity, and nothing else. Otherwise the main thing wrong.
function checkItems(read, lines) {
  if (!read.length) return { verdict: "none", missing: lines.map((l) => l.title), extra: [] };
  const used = new Set(), missing = [];
  let quantity = false;
  for (const l of lines) {
    const i = read.findIndex((it, k) => !used.has(k) && sameItem(it.name, l.title));
    if (i < 0) { missing.push(l.title); continue; }
    used.add(i);
    const q = Number(read[i].qty);
    if (Number.isInteger(q) && q > 0 && q !== n(l.quantity)) quantity = true;
  }
  const extra = read.filter((_, k) => !used.has(k)).map((it) => it.name);
  const verdict = missing.length ? "missing" : extra.length ? "extra" : quantity ? "quantity" : "right";
  return { verdict, missing, extra };
}
export function compareToOrder(card, order, agreed) {
  const shown = shownName(card, agreed), day = ukDay(order.orderedAt);
  const items = checkItems(cleanItems(card.items), order.lines || []);
  const parts = {
    shop: !shown ? "missing" : sameName(shown, order.label) || sameName(shown, order.handle) ? "right" : "wrong",
    total: card.totalPence == null ? "missing" : card.totalPence === n(order.amount) && (!card.currency || card.currency === order.currency) ? "right" : "wrong",
    date: !validDay(card.orderDate) || !day ? "missing" : dayGap(card.orderDate, day) <= 1 ? "right" : "wrong",
    // Orders kept before Relay kept the shop's order number can't be checked for it.
    number: !order.ref ? null : !card.orderRef ? "missing" : sameNumber(card.orderRef, order) ? "right" : "wrong",
    items: items.verdict
  };
  const allRight = Object.values(parts).every((v) => v === "right" || v === null);
  return { parts, allRight, shown, day, items };
}

// Finds each shop order among one shopper's receipts. First by the order number: from the same shop (whatever day was read,
// so a misread date is caught), or from a shop not recognised within a week (so a misread shop is caught, while another
// shop's order with the same number weeks apart isn't taken). Then, for what's left, the only receipt from the same shop
// within two days. When two receipts fit equally well, the order is left out as unsure rather than guessed. Each receipt is
// used for one order at most.
export function pairOrders(cards, orders, agreed) {
  const used = new Set(), pairs = [], left = [];
  const sorted = orders.slice().sort((a, b) => String(a.orderedAt).localeCompare(String(b.orderedAt)) || String(a.id).localeCompare(String(b.id)));
  const gapOf = (c, o) => { const d = ukDay(o.orderedAt); return validDay(c.orderDate) && d ? dayGap(c.orderDate, d) : null; };
  for (const o of sorted) {
    const shop = (c) => sameShop(c, o, agreed);
    const fits = cards.filter((c) => !used.has(c) && sameNumber(c.orderRef, o) && (shop(c) || gapOf(c, o) == null || gapOf(c, o) <= 7))
      .sort((a, b) => Number(shop(b)) - Number(shop(a)) || (gapOf(a, o) ?? 99) - (gapOf(b, o) ?? 99));
    if (fits.length) { used.add(fits[0]); pairs.push({ order: o, card: fits[0], how: "number" }); }
    else left.push(o);
  }
  // A receipt carrying another of these orders' numbers belongs to that order, even if it wasn't found by it.
  const claimed = (c) => orders.some((o) => o.ref && sameNumber(c.orderRef, o));
  const unpaired = [];
  for (const o of left) {
    const near = cards.filter((c) => !used.has(c) && !claimed(c) && gapOf(c, o) != null && gapOf(c, o) <= 2 && sameShop(c, o, agreed));
    const closest = Math.min(...near.map((c) => gapOf(c, o)));
    const top = near.filter((c) => gapOf(c, o) === closest);
    if (top.length === 1) { used.add(top[0]); pairs.push({ order: o, card: top[0], how: "shop" }); }
    else unpaired.push({ order: o, why: top.length > 1 ? "unsure" : "not_found" });
  }
  return { pairs: pairs.map((p) => ({ ...p, check: compareToOrder(p.card, p.order, agreed) })), unpaired };
}

// ---- The health page's part --------------------------------------------------------------------------------------------
const tally = () => ({ right: 0, wrong: 0, missing: 0 });
export function emptyAnswerKey() {
  return { days: ANSWER_KEY_DAYS, orders: 0, shoppers: 0, withInbox: 0, found: 0, byNumber: 0, notFound: 0, unsure: 0, allRight: 0,
    parts: { shop: tally(), total: tally(), date: tally(), number: tally(), items: { right: 0, none: 0, missing: 0, extra: 0, quantity: 0 } },
    byReader: [], shops: [], mine: { orders: 0, withInbox: false, found: 0, allRight: 0, differences: [], notFound: [] } };
}

// The last ANSWER_KEY_DAYS days of orders from connected Shopify shops that belong to a Relay shopper, each looked for among
// that shopper's own receipts. `me` is the admin asking: their own orders are listed in detail.
export async function answerKey(env, me, now = Date.now(), o = {}) {
  const db = env.RELAY_DB, minShoppers = o.minShoppers || 3, out = emptyAnswerKey();
  const since = new Date(now - ANSWER_KEY_DAYS * DAY).toISOString();
  const all = async (sql, ...a) => {
    try { return (await db.prepare(sql).bind(...a).all()).results || []; }
    catch (e) { if (/no such (table|column)/i.test(String(e && e.message))) return []; throw e; }
  };
  try { await ensureOrderRefColumn(db); } catch { /* the orders table isn't there yet: nothing to check */ }
  // Orders and who they belong to (by the keyed hash of the order's email: the address itself is never kept).
  const orders = await all(`SELECT o.id AS id, o.connection_id AS connection, o.external_order_id AS ext, o.order_ref AS ref, o.ordered_at AS orderedAt,
      o.amount_minor AS amount, o.currency AS currency, s.id AS shopper
    FROM retailer_orders o JOIN retailer_order_emails e ON e.order_id = o.id JOIN shoppers s ON s.email_hash = e.email_hash
    WHERE o.connection_id LIKE 'shopify:%' AND o.ordered_at >= ? ORDER BY o.ordered_at DESC LIMIT 1000`, since);
  if (!orders.length) return out;
  const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
  const lines = new Map();
  for (const ids of chunks(orders.map((x) => x.id), 90))
    for (const r of await all(`SELECT order_id AS id, title, quantity FROM order_items WHERE order_id IN (${ids.map(() => "?").join(",")})`, ...ids)) {
      if (!lines.has(r.id)) lines.set(r.id, []);
      lines.get(r.id).push({ title: r.title, quantity: n(r.quantity) });
    }
  const domains = [...new Set(orders.map((x) => String(x.connection).slice("shopify:".length)))];
  const labels = new Map();
  for (const ds of chunks(domains, 90))
    for (const r of await all(`SELECT domain, label FROM shopify_shops WHERE domain IN (${ds.map(() => "?").join(",")})`, ...ds)) labels.set(r.domain, r.label);
  for (const x of orders) {
    const domain = String(x.connection).slice("shopify:".length);
    x.handle = domain.replace(/\.myshopify\.com$/, "").replace(/-/g, " ");
    x.label = labels.get(domain) || x.handle;
    x.lines = lines.get(x.id) || [];
  }
  const people = [...new Set(orders.map((x) => x.shopper))];
  const withInbox = new Set(), rows = new Map();
  // A shopper's other inboxes are kept as "<id>~2", "<id>~3"; every inbox's receipts are filed under the shopper.
  const OWNER = "(CASE WHEN instr(shopper_id, '~') > 0 THEN substr(shopper_id, 1, instr(shopper_id, '~') - 1) ELSE shopper_id END)";
  for (const ids of chunks(people, 50)) {
    const qs = ids.map(() => "?").join(",");
    for (const r of await all(`SELECT DISTINCT ${OWNER} AS id FROM gmail_connections WHERE ${OWNER} IN (${qs})`, ...ids)) withInbox.add(r.id);
    for (const r of await all(`SELECT id, shopper_id AS shopper, status, details, created_at AS createdAt FROM captured_receipts
        WHERE shopper_id IN (${qs}) AND status NOT IN ('dismissed','not_receipt') AND COALESCE(json_extract(details, '$.kind'), 'receipt') = 'receipt'
        AND created_at >= ? LIMIT 5000`, ...ids, Date.parse(since) - DAY)) {
      if (!rows.has(r.shopper)) rows.set(r.shopper, []);
      try { rows.get(r.shopper).push({ id: r.id, status: r.status, createdAt: r.createdAt, ...JSON.parse(r.details) }); } catch { /* unreadable row */ }
    }
  }
  out.orders = orders.length; out.shoppers = people.length;
  const readers = new Map(), shops = new Map();
  const shopOf = (order) => { const k = order.connection; if (!shops.has(k)) shops.set(k, { name: order.label, people: new Set(), orders: 0, found: 0, allRight: 0, totalRight: 0, itemsRight: 0 }); return shops.get(k); };
  for (const who of people) {
    const mineToo = Boolean(me && me.id && who === me.id);
    const theirs = orders.filter((x) => x.shopper === who);
    if (mineToo) { out.mine.orders += theirs.length; out.mine.withInbox = withInbox.has(who); }
    // Without an inbox there's nothing to look in: those orders count only as orders (and not towards naming a shop).
    if (!withInbox.has(who)) continue;
    out.withInbox += theirs.length;
    for (const x of theirs) { const s = shopOf(x); s.people.add(who); s.orders++; }
    const cards = mergeOrderEmails(rows.get(who) || []);
    const agreed = agreedShopNames(cards);
    const { pairs, unpaired } = pairOrders(cards, theirs, agreed);
    for (const u of unpaired) {
      if (u.why === "unsure") out.unsure++; else out.notFound++;
      if (mineToo && out.mine.notFound.length < 6) out.mine.notFound.push({ shop: u.order.label, day: ukDay(u.order.orderedAt), number: u.order.ref || null, unsure: u.why === "unsure" });
    }
    for (const p of pairs) {
      const { parts, allRight } = p.check;
      out.found++; if (p.how === "number") out.byNumber++; if (allRight) out.allRight++;
      for (const k of ["shop", "total", "date", "number"]) if (parts[k]) out.parts[k][parts[k]]++;
      out.parts.items[parts.items]++;
      const v = n(p.card.parserVersion), r = readers.get(v) || { version: v, found: 0, allRight: 0 };
      r.found++; if (allRight) r.allRight++; readers.set(v, r);
      const s = shopOf(p.order); s.found++; if (allRight) s.allRight++; if (parts.total === "right") s.totalRight++; if (parts.items === "right") s.itemsRight++;
      if (mineToo) {
        out.mine.found++; if (allRight) out.mine.allRight++;
        if (!allRight && out.mine.differences.length < 10) out.mine.differences.push(difference(p));
      }
    }
  }
  out.byReader = [...readers.values()].sort((a, b) => b.version - a.version);
  out.shops = [...shops.values()].filter((s) => s.people.size >= minShoppers)
    .map((s) => ({ name: s.name, people: s.people.size, orders: s.orders, found: s.found, allRight: s.allRight, totalRight: s.totalRight, itemsRight: s.itemsRight }))
    .sort((a, b) => (a.allRight / Math.max(1, a.found)) - (b.allRight / Math.max(1, b.found)) || b.orders - a.orders).slice(0, 12);
  return out;
}

// What differed on one of the admin's own orders: what Relay read, beside what the shop's record says.
function difference(p) {
  const { parts, shown, day, items } = p.check, c = p.card, o = p.order, list = [];
  if (parts.shop !== "right") list.push({ part: "shop", read: shown, shop: o.label });
  if (parts.total !== "right") list.push({ part: "total", read: c.totalPence == null ? null : n(c.totalPence), shop: n(o.amount) });
  if (parts.date !== "right") list.push({ part: "date", read: validDay(c.orderDate) ? c.orderDate : null, shop: day });
  if (parts.number && parts.number !== "right") list.push({ part: "number", read: c.orderRef || null, shop: o.ref });
  if (parts.items !== "right") list.push({ part: "items", verdict: parts.items, read: cleanItems(c.items).length, shop: (o.lines || []).length,
    missing: items.missing.slice(0, 3).map((t) => String(t).slice(0, 80)), extra: items.extra.slice(0, 3).map((t) => String(t).slice(0, 80)) });
  return { shop: o.label, day, number: o.ref || null, readerVersion: n(c.parserVersion), how: p.how, parts: list };
}
