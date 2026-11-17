// When a shop's name doesn't say clearly what it sells (shop-kind.js isn't sure) and Relay doesn't know the shop, Claude
// (Anthropic's AI) is asked once which kind of shopping it is, and the answer is kept for that shop for good, for everyone.
//
// Rules (do not weaken):
//  * Off until ANTHROPIC_API_KEY is set (or with AI_READER=off), like the AI reader. Without it the name's own words decide
//    only when they are clear; otherwise the receipt's items decide, or it is Other. Nothing is pretended.
//  * Only the shop's name and its web address go to Anthropic: never a shopper's email, name, order, items or prices.
//    A forwarded receipt (from a personal mailbox) or a name that looks like a person's is never sent.
//  * One question per shop, ever: the answer (even "other") is kept in shop_kinds by the shop's key. At most 12 shops a
//    question, so a big inbox is learned over a few visits rather than in one long wait.
//  * The answer is a hint like a shop's own name: a shopper's choice for the shop, a shop Relay knows and clear item names
//    all win over it.
import { aiAvailable } from "./ai-reader.js";
import { aiModel } from "./ai-runner.js";
import { CATEGORIES, knownShop, storeKey, shopDisplayName, PERSONAL_MAIL } from "./receipt-category.js";
import { shopKind } from "./shop-kind.js";
import { isVia, looksLikePerson } from "./receipt-reader.js";

export const SHOP_KINDS_SQL = `CREATE TABLE IF NOT EXISTS shop_kinds (shop_key TEXT PRIMARY KEY, category TEXT NOT NULL, created_at INTEGER NOT NULL)`;
export const SHOPS_PER_ASK = 12;
const KINDS = Object.keys(CATEGORIES);

export const SHOP_KIND_SYSTEM = [
  "You help Relay, a UK shopping app, sort shops into kinds of shopping. You get a JSON list of shops, each with an id, the shop's name and, when known, its web address.",
  "Shop names are often words run together or shortened (\"tvbedsnorthwest\" is TV Beds North West, a furniture shop that sells beds).",
  "The word that says what is sold usually comes last: \"TV Beds\" sells beds, \"TV World\" sells televisions.",
  "Reply with one JSON object and nothing else: {\"shops\":[{\"id\":...,\"kind\":...}]}, one entry per shop.",
  "kind is exactly one of: " + KINDS.map((k) => "\"" + k + "\" (" + CATEGORIES[k] + ")").join(", ") + ".",
  "Use \"other\" when you don't recognise the shop and its name doesn't make clear what it sells. Never guess."
].join(" ");

// Which of a shopper's shops are worth asking about: not a shop Relay knows, not one whose name is clear, not forwarded,
// not a person's name, not one whose receipts' items already say what they are, and not asked about before. [{ key, name, domain }]
export function unclearShops(cards, asked) {
  const out = new Map();
  for (const c of cards || []) {
    const r = (c && c.retailer) || {};
    const domain = r.domain && !isVia(r.domain) ? String(r.domain).toLowerCase() : null;
    if (domain && PERSONAL_MAIL.test(domain)) continue;
    const name = shopDisplayName(r);
    if (!name || name === "Forwarded receipt" || (domain && looksLikePerson(name, domain))) continue;
    if (knownShop({ retailer: { name, domain } })) continue;
    if (shopKind(name, domain).confidence === "high") continue;
    // A receipt whose items say clearly what they are doesn't need the shop's kind.
    if ((c.items || []).some((i) => i && i.categorySure)) continue;
    const key = c.storeKey || storeKey(c);
    if (!key || out.has(key) || (asked && asked.has(key))) continue;
    out.set(key, { key, name: name.slice(0, 80), domain: domain ? domain.slice(0, 80) : null });
  }
  return [...out.values()];
}

// Only the listed kinds come back; anything else is dropped.
export function cleanShopKinds(text, ids) {
  let o; try { o = JSON.parse(String(text || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  if (!o || !Array.isArray(o.shops)) return null;
  const out = new Map();
  for (const x of o.shops) if (x && ids.has(String(x.id)) && KINDS.includes(x.kind)) out.set(String(x.id), x.kind);
  return out;
}

// What Relay has learned so far, for these shops' keys: Map key → kind. Never fails: no table yet means nothing learned.
export async function readShopKinds(db, keys) {
  const out = new Map(), list = [...new Set((keys || []).filter(Boolean))];
  try {
    for (let i = 0; i < list.length; i += 80) {
      const chunk = list.slice(i, i + 80);
      const rows = await db.prepare(`SELECT shop_key AS k, category FROM shop_kinds WHERE shop_key IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).all();
      for (const r of rows.results || []) if (KINDS.includes(r.category)) out.set(r.k, r.category);
    }
  } catch { /* the table is made the first time a shop is learned */ }
  return out;
}

// Asks about the shopper's unclear shops (at most SHOPS_PER_ASK) and keeps the answers. Returns how many were learned.
export async function learnShopKinds(env, cards, o = {}) {
  if (!aiAvailable(env)) return 0;
  const db = env.RELAY_DB, now = o.now || Date.now(), fetchImpl = o.fetchImpl || fetch;
  await db.prepare(SHOP_KINDS_SQL).run();
  const keys = (cards || []).map((c) => c.storeKey || storeKey(c));
  const asked = await readShopKinds(db, keys);
  const list = unclearShops(cards, asked).slice(0, SHOPS_PER_ASK).map((s, i) => ({ ...s, id: String(i + 1) }));
  if (!list.length) return 0;
  let r;
  try {
    r = await fetchImpl("https://api.anthropic.com/v1/messages", { method: "POST", signal: AbortSignal.timeout(15000),
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: aiModel(env), max_tokens: 800, system: SHOP_KIND_SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(list.map((s) => (s.domain ? { id: s.id, name: s.name, web: s.domain } : { id: s.id, name: s.name }))) }] }) });
  } catch { return 0; }
  if (!r || !r.ok) return 0;
  const body = await r.json().catch(() => null);
  const text = body && Array.isArray(body.content) ? body.content.filter((c) => c && c.type === "text").map((c) => c.text).join("") : "";
  const got = cleanShopKinds(text, new Set(list.map((s) => s.id)));
  if (!got) return 0;
  // A shop the answer left out is kept as "other", so it isn't asked about again and again.
  await db.batch(list.map((s) => db.prepare("INSERT OR IGNORE INTO shop_kinds (shop_key, category, created_at) VALUES (?, ?, ?)").bind(s.key, got.get(s.id) || "other", now)));
  return list.length;
}
