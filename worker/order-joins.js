// "Same order" and "different orders": the shopper's own word on which emails are one purchase.
//
// The reader joins the emails of one order into one card (gmail.js mergeOrderEmails: the same shop and order number, a
// payment service's receipt with the shop's by money and time, the same order in two inboxes). For layouts it has never
// seen it will sometimes join two orders that are different, or leave one order as two cards. The shopper can then say:
//   * "Same order as another receipt": two cards become one. The fuller email leads (its items and total), and the other's
//     emails are part of it.
//   * "These are different orders": a card made of several emails is split back into one card per email.
// Rules (do not weaken):
//  * A choice is kept per shopper, by the emails' own ids (captured_receipts.id, which a re-read keeps), and is applied
//    after the reader's joining every time receipts are listed, so a new reader version re-reading every email never loses
//    or undoes it. Both are undone from the same receipt's page.
//  * Only the shopper's own receipts: both ids must be on their own list (anyone else's looks like one that doesn't exist).
//  * Each choice keeps the shop's web address and the reader's version, never anything from the email, so the Relay health
//    page can count, by shop, how often shoppers had to correct the joining (health.js).
export const RECEIPT_JOINS_SQL = `CREATE TABLE IF NOT EXISTS receipt_joins (
  shopper_id TEXT NOT NULL, a_id TEXT NOT NULL, b_id TEXT NOT NULL, kind TEXT NOT NULL, domain TEXT, other_domain TEXT, reader INTEGER,
  created_at INTEGER NOT NULL, PRIMARY KEY (shopper_id, a_id, b_id))`;

// Most emails one card can be split into at once (a split keeps every pair of them apart).
export const MAX_SPLIT = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = 864e5;
const json = (body, status, cors) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
const pair = (x, y) => (x < y ? [x, y] : [y, x]);
// A card's emails: emailIds while the reader is joining (not enumerable), then the card's own and its alsoEmails.
const emailsOf = (c) => (!c ? [] : c.emailIds && c.emailIds.length ? c.emailIds : [c.id, ...(c.alsoEmails || []).map((e) => e && e.id).filter(Boolean)]);

// The shopper's choices. A table nobody has used yet: none.
export async function readJoins(db, shopperId) {
  try { return (await db.prepare("SELECT a_id AS a, b_id AS b, kind FROM receipt_joins WHERE shopper_id = ?").bind(shopperId).all()).results || []; }
  catch (e) { if (/no such table/i.test(String(e && e.message))) return []; throw e; }
}

// What the choices change, given the cards the reader made (each card knows its emails: emailIds). null when nothing.
// keys: email id -> the group it must be in (for mergeOrderEmails' keyFor); same/apart: the choices that apply.
export function joinPlan(cards, rows) {
  if (!rows || !rows.length) return null;
  const where = new Map();
  cards.forEach((c, i) => { for (const e of emailsOf(c)) where.set(e, i); });
  const live = rows.filter((r) => where.has(r.a) && where.has(r.b) && r.a !== r.b);
  const same = live.filter((r) => r.kind === "same"), apart = live.filter((r) => r.kind === "apart");
  if (!same.length && !apart.length) return null;
  const touched = new Set();
  for (const r of same) if (where.get(r.a) !== where.get(r.b)) { touched.add(where.get(r.a)); touched.add(where.get(r.b)); }
  for (const r of apart) if (where.get(r.a) === where.get(r.b)) touched.add(where.get(r.a));
  const plan = { keys: new Map(), same, apart, changed: touched.size > 0 };
  if (!touched.size) return plan;
  // Cards said to be one order, together (union-find over the cards).
  const up = new Map(), root = (i) => { while (up.get(i) !== i) { up.set(i, up.get(up.get(i))); i = up.get(i); } return i; };
  for (const i of touched) up.set(i, i);
  for (const r of same) { const x = where.get(r.a), y = where.get(r.b); if (x !== y) up.set(root(x), root(y)); }
  const groups = new Map();
  for (const i of [...touched].sort((x, y) => x - y)) { const k = root(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  const apartSet = new Set(apart.map((r) => pair(r.a, r.b).join("|")));
  const sameSet = new Set(same.map((r) => pair(r.a, r.b).join("|")));
  const kept = (x, y) => apartSet.has(pair(x, y).join("|"));
  let n = 0;
  for (const idxs of groups.values()) {
    // Then emails said to be different orders, apart: each goes with the first part it isn't kept apart from.
    const parts = [];
    for (const e of idxs.flatMap((i) => emailsOf(cards[i]))) {
      const p = parts.find((q) => q.every((f) => !kept(e, f)));
      if (p) p.push(e); else parts.push([e]);
    }
    // Two emails said to be the same order end up in one part whenever nothing keeps them apart.
    for (let again = true; again;) {
      again = false;
      for (let i = 0; i < parts.length && !again; i++) for (let j = i + 1; j < parts.length && !again; j++) {
        const linked = parts[i].some((e) => parts[j].some((f) => sameSet.has(pair(e, f).join("|"))));
        if (linked && parts[i].every((e) => parts[j].every((f) => !kept(e, f)))) { parts[i].push(...parts.splice(j, 1)[0]); again = true; }
      }
    }
    for (const p of parts) { const key = "shopper-join|" + n++; for (const e of p) plan.keys.set(e, key); }
  }
  return plan;
}

// Marks each card for the app: joinedByYou (made one by the shopper), splitByYou (kept apart from another of their cards
// by the shopper), and alsoEmails (the other emails a card was made from: their shop, day and total, which are the
// shopper's own). Never the email ids of anything but their own receipts.
export function markJoins(cards, plan, summary) {
  const where = new Map();
  cards.forEach((c, i) => { for (const e of emailsOf(c)) where.set(e, i); });
  if (plan) {
    for (const r of plan.same) { const x = where.get(r.a), y = where.get(r.b); if (x != null && x === y) cards[x].joinedByYou = true; }
    for (const r of plan.apart) { const x = where.get(r.a), y = where.get(r.b); if (x != null && y != null && x !== y) { cards[x].splitByYou = true; cards[y].splitByYou = true; } }
  }
  for (const c of cards) {
    const ids = emailsOf(c);
    if (ids.length > 1) c.alsoEmails = ids.filter((e) => e !== c.id).slice(0, MAX_SPLIT).map((e) => summary(e)).filter(Boolean);
  }
  return cards;
}

// Likely other receipts for the same order: the same or a similar shop (or a payment service), close days, a close total.
// A short list, best first; never the card itself or emails already part of it.
export function sameOrderCandidates(card, cards, max = 6) {
  const mine = new Set(emailsOf(card));
  const day = (c) => (c.orderDate ? Date.parse(c.orderDate + "T00:00:00Z") : null);
  // (A web address counts without its ending: "fernhill.co.uk" is "fernhill".)
  const words = (c) => new Set(String(((c.retailer && (c.retailer.name || "")) || "") + " " + String((c.retailer && c.retailer.domain) || "").split(".").slice(0, -1).join(" ")).toLowerCase()
    .split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(?:the|and|com|net|org|ltd|limited|shop|store|www|mail|email|orders?|uk|co)$/.test(w)));
  const mw = words(card), md = day(card);
  const out = [];
  for (const c of cards) {
    if (!c || !c.id || !UUID.test(c.id) || emailsOf(c).some((e) => mine.has(e)) || c.kind === "return_instructions") continue;
    let s = 0;
    const r = c.retailer || {}, m = card.retailer || {};
    const sameShop = (r.domain && m.domain && r.domain === m.domain) || (c.storeKey && c.storeKey === card.storeKey);
    const cw = words(c), shared = [...cw].some((w) => mw.has(w));
    const via = Boolean(r.via) !== Boolean(m.via);
    if (sameShop) s += 4; else if (shared) s += 3; else if (via) s += 1;
    const d = day(c), gap = d != null && md != null ? Math.abs(d - md) / DAY : null;
    if (gap != null && gap > 31) continue;
    if (gap != null) s += gap <= 1 ? 3 : gap <= 4 ? 2 : gap <= 14 ? 1 : 0;
    const sameMoney = (c.currency || "GBP") === (card.currency || "GBP");
    if (sameMoney && Number.isInteger(c.totalPence) && Number.isInteger(card.totalPence)) {
      const diff = Math.abs(c.totalPence - card.totalPence), big = Math.max(c.totalPence, card.totalPence, 1);
      if (diff <= 1) s += 4; else if (diff / big <= 0.15) s += 1;
    }
    // Something must tie them: the shop, or the money with close days.
    if (!(sameShop || shared || (s >= 6 && gap != null && gap <= 4))) continue;
    out.push({ c, s, gap: gap == null ? 99 : gap });
  }
  return out.sort((x, y) => y.s - x.s || x.gap - y.gap).slice(0, max).map((x) => x.c);
}

// What the app shows for a card in the "pick the other receipt" list: only what its own receipt row shows.
export function candidateView(c) {
  const r = c.retailer || {};
  return { id: c.id, kind: c.kind || "receipt", retailer: { name: r.name || null, domain: r.domain || null, logoDomain: r.logoDomain || null, ...(r.via ? { via: r.via } : {}) },
    orderDate: c.orderDate || null, totalPence: Number.isInteger(c.totalPence) ? c.totalPence : null, currency: c.currency || "GBP", category: c.category || null,
    items: (c.items || []).filter((i) => i && i.name).slice(0, 3).map((i) => ({ name: String(i.name).slice(0, 120), qty: i.qty || 1 })), itemCount: c.itemCount || undefined };
}

const domainOf = (c) => { const r = (c && c.retailer) || {}; const d = String(r.domain || r.via || "").toLowerCase().replace(/[^a-z0-9.-]/g, ""); return d || null; };

// GET  /relay/my/receipts/<id>/join: the likely other receipts of the same order (a short list).
// POST /relay/my/receipts/<id>/join { action: "same", with } | { action: "apart" } | { action: "undo", kind: "same" | "apart" }
// list(): the shopper's own cards, as the receipts list makes them. Returns null for any other path.
export async function handleJoinRoute(path, method, request, env, cors, shopper, o, { list, ensure, readerVersion }) {
  const m = /^\/relay\/my\/receipts\/([0-9a-f-]{36})\/join$/.exec(path);
  if (!m || (method !== "GET" && method !== "POST")) return null;
  await ensure();
  const cards = await list();
  // (The receipt may now be part of another card: a double tap after the first one joined them.)
  const card = cards.find((c) => c.id === m[1]) || cards.find((c) => emailsOf(c).includes(m[1]));
  if (!card) return json({ error: "not_found" }, 404, cors);
  if (method === "GET") return json({ candidates: sameOrderCandidates(card, cards).map(candidateView) }, 200, cors);
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b) || !["same", "apart", "undo"].includes(b.action)) return json({ error: "bad_join" }, 400, cors);
  const db = env.RELAY_DB, now = (o && o.now) || Date.now(), me = shopper.id, mine = emailsOf(card);
  const ins = (x, y, kind, d1, d2) => { const [a, bb] = pair(x, y); return db.prepare(`INSERT INTO receipt_joins (shopper_id, a_id, b_id, kind, domain, other_domain, reader, created_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT (shopper_id, a_id, b_id) DO UPDATE SET kind = excluded.kind, domain = excluded.domain, other_domain = excluded.other_domain, reader = excluded.reader, created_at = excluded.created_at`)
    .bind(me, a, bb, kind, d1, d2, readerVersion, now); };
  const among = (ids, kind) => { const q = ids.map(() => "?").join(","); return db.prepare(`DELETE FROM receipt_joins WHERE shopper_id = ? AND kind = ? AND a_id IN (${q}) AND b_id IN (${q})`).bind(me, kind, ...ids, ...ids); };
  if (b.action === "same") {
    if (typeof b.with !== "string" || !UUID.test(b.with)) return json({ error: "bad_join" }, 400, cors);
    // The other receipt must be one of the shopper's own cards (or an email inside one).
    const other = cards.find((c) => c.id === b.with) || cards.find((c) => emailsOf(c).includes(b.with));
    if (!other) return json({ error: "not_found" }, 404, cors);
    // Already one card (a double tap, or the reader had joined them): nothing more to do.
    if (other === card) return json({ ok: true, already: true }, 200, cors);
    const both = [...new Set([...mine, ...emailsOf(other)])].filter((e) => UUID.test(e));
    // Saying they're one order takes back an earlier "different orders" between them.
    await db.batch([among(both, "apart"), ins(card.id, other.id, "same", domainOf(card), domainOf(other))]);
    return json({ ok: true }, 200, cors);
  }
  const ids = mine.filter((e) => UUID.test(e));
  if (b.action === "apart") {
    if (ids.length < 2) return json({ error: "not_joined" }, 409, cors);
    const some = ids.slice(0, MAX_SPLIT), st = [among(some, "same")];
    for (let i = 0; i < some.length; i++) for (let j = i + 1; j < some.length; j++) st.push(ins(some[i], some[j], "apart", domainOf(card), null));
    await db.batch(st);
    return json({ ok: true }, 200, cors);
  }
  if (b.kind !== "same" && b.kind !== "apart") return json({ error: "bad_join" }, 400, cors);
  const q = ids.map(() => "?").join(",");
  if (!ids.length) return json({ ok: true }, 200, cors);
  // Undo: "same" takes back the choices that made this card one; "apart" the ones that keep it from the others.
  await db.prepare(b.kind === "same" ? `DELETE FROM receipt_joins WHERE shopper_id = ? AND kind = 'same' AND (a_id IN (${q}) AND b_id IN (${q}))`
    : `DELETE FROM receipt_joins WHERE shopper_id = ? AND kind = 'apart' AND (a_id IN (${q}) OR b_id IN (${q}))`).bind(me, ...ids, ...ids).run();
  return json({ ok: true }, 200, cors);
}
