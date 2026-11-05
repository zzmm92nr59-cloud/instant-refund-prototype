// The AI second reader: the parts that need nothing but the reading itself (ai-runner.js does the reading).
// When Relay's own reader (fixed rules on Relay's servers) isn't sure about a receipt, and only for shoppers who switched on
// "AI help", Claude (Anthropic's AI) reads that one email and fills in what the rules missed.
//
// Rules (do not weaken):
//  * Off unless the shopper switched it on, and off for everyone until ANTHROPIC_API_KEY is set (or AI_READER=off).
//  * Only the email's text goes to Anthropic, with the shopper's personal details hidden first (shared-emails.js
//    hideDetails). Anthropic's terms don't let it train its models on what Relay sends.
//  * It fills gaps only. What the rules read stays as it was; what the AI read is kept apart (receipt_ai_reads) and used
//    only where the rules found nothing, and such a receipt is marked for the shopper to check. A shopper's own fix wins.
//  * It never decides anything else: an email the AI thinks isn't a purchase is only counted, not removed.
//  * Turning it off deletes what the AI read. It also goes with the receipt, the inbox, the permission and the account.
//  * The health page counts where the AI and the rules agreed and where they didn't, so the rules can be made better.
import { cleanItems } from "./receipt-reader.js";

export const AI_READ_VERSION = 1;
export const AI_SETTING_SQL = `CREATE TABLE IF NOT EXISTS ai_reading (shopper_id TEXT PRIMARY KEY, on_since INTEGER NOT NULL)`;
// For each part (shop, total, date, number, items): 0 neither found it, 1 the AI filled a gap, 2 both found the same,
// 3 they differ, 4 only the rules found it. failed: why there's no reading ("email_not_found", "unreadable").
export const AI_READS_SQL = `CREATE TABLE IF NOT EXISTS receipt_ai_reads (
  shopper_id TEXT NOT NULL, receipt_id TEXT NOT NULL, fields TEXT, failed TEXT, not_purchase INTEGER NOT NULL DEFAULT 0,
  shop INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, date INTEGER NOT NULL DEFAULT 0, number INTEGER NOT NULL DEFAULT 0,
  items INTEGER NOT NULL DEFAULT 0, reader INTEGER, model TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (shopper_id, receipt_id))`;
export const PARTS = ["shop", "total", "date", "number", "items"];
export const FILLED = 1, AGREED = 2, DIFFER = 3, RULES_ONLY = 4;

export const aiAvailable = (env) => Boolean(env && env.ANTHROPIC_API_KEY) && String(env.AI_READER || "").toLowerCase() !== "off";

// A payment or ordering company's name is no shop name: the AI may fill the shop in when that's all the rules found.
const NOT_A_SHOP = /^(shopify|stripe|paypal|klarna|clearpay|square|sumup|global-?e|apple pay|google pay|worldpay)$/i;

// ---- What the AI is asked, and what's accepted back -------------------------------------------------------------------
export const AI_SYSTEM = [
  "You read one shopping email for Relay, a UK app that keeps people's receipts, and reply with one JSON object and nothing else.",
  "Personal details in the email have been replaced with markers such as [name], [address], [email], [link], [phone], [number], [code] and [postcode]. Leave them out, and never guess what they hide.",
  "Keys: isPurchase (true only if this email confirms something the person bought or paid for, such as an order confirmation or a receipt; false for adverts, newsletters, account emails, and delivery or return updates),",
  "shop (the shop or brand bought from, as a person would say it; never a payment company such as Shopify, Stripe, PayPal or Klarna), orderRef (the order number exactly as written),",
  "orderDate (YYYY-MM-DD, the day the order was placed), currency (three letters, such as GBP), totalPence (the total paid, in pence, as a whole number: with delivery, after discounts),",
  "items (what was bought: name as written, qty as a whole number, pricePence for that line in pence).",
  "Use null for anything the email doesn't say, and an empty list for no items. Never invent anything."
].join(" ");
const day = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && Number.isFinite(Date.parse(s + "T12:00:00Z")) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
const text = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "") || null;
const pence = (v) => (Number.isInteger(v) && v >= 0 && v <= 1e8 ? v : null);
// The AI's answer, checked like anything a person types: only sensible values, anything else left out. Null if it isn't
// one JSON object.
export function cleanAiReading(answer, latestDay) {
  let j = answer;
  if (typeof answer === "string") {
    const a = answer.indexOf("{"), b = answer.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try { j = JSON.parse(answer.slice(a, b + 1)); } catch { return null; }
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const shop = text(j.shop, 80), ref = text(j.orderRef, 40);
  const items = (Array.isArray(j.items) ? j.items : []).slice(0, 50).map((i) => i && typeof i === "object" ? {
    name: text(i.name, 120), qty: Number.isInteger(i.qty) && i.qty >= 1 && i.qty <= 999 ? i.qty : 1, pricePence: pence(i.pricePence) } : null)
    .filter((i) => i && i.name && !/\[(name|address|email|link|phone|number|code|postcode)\]/.test(i.name));
  return {
    isPurchase: j.isPurchase === true,
    shop: shop && !NOT_A_SHOP.test(shop) && !/\[[a-z]+\]/.test(shop) ? shop : null,
    orderRef: ref && /^[#A-Za-z0-9][A-Za-z0-9#\-_/. ]{0,39}$/.test(ref) ? ref : null,
    orderDate: day(j.orderDate) && j.orderDate >= "2000-01-01" && (!latestDay || j.orderDate <= latestDay) ? j.orderDate : null,
    currency: typeof j.currency === "string" && /^[A-Z]{3}$/.test(j.currency) ? j.currency : null,
    totalPence: pence(j.totalPence),
    items
  };
}

// ---- Comparing it with the rules' reading -----------------------------------------------------------------------------
const letters = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const sameText = (a, b) => { const x = letters(a), y = letters(b); return Boolean(x && y) && (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))); };
const sameRef = (a, b) => letters(a) === letters(b) && letters(a).length > 0;
function part(rules, ai, same) {
  const r = rules !== null && rules !== undefined && rules !== "", a = ai !== null && ai !== undefined && ai !== "";
  return !r && !a ? 0 : !r ? FILLED : !a ? RULES_ONLY : same() ? AGREED : DIFFER;
}
const shopOf = (d) => { const n = d && d.retailer && d.retailer.name; return n && !NOT_A_SHOP.test(String(n).trim()) ? n : null; };
// For each part: whether the AI filled a gap, agreed, differed, or found nothing the rules did. The receipt as the rules
// read it (details) against the AI's reading (ai).
export function compareReadings(details, ai) {
  const d = details || {}, rItems = cleanItems(d.items || []), aItems = ai.items || [];
  return {
    shop: part(shopOf(d), ai.shop, () => sameText(shopOf(d), ai.shop)),
    total: part(d.totalPence == null ? null : d.totalPence, ai.totalPence, () => d.totalPence === ai.totalPence),
    date: part(day(d.orderDate) ? d.orderDate : null, ai.orderDate, () => d.orderDate === ai.orderDate),
    number: part(d.orderRef || null, ai.orderRef, () => sameRef(d.orderRef, ai.orderRef)),
    items: part(rItems.length ? rItems : null, aItems.length ? aItems : null,
      () => rItems.length === aItems.length && aItems.every((it) => rItems.some((x) => sameText(x.name, it.name))))
  };
}

// ---- Using it ----------------------------------------------------------------------------------------------------------
// The receipts list: where the rules found nothing, the AI's reading fills in, and the receipt is marked for the shopper to
// check (aiFilled, and "Is this right?" if they haven't confirmed it). An order's latest AI reading across its emails is used.
// Runs before attachFixes, so a shopper's own fix always wins.
export function attachAiReads(orders, rows) {
  if (!rows || !rows.length) return;
  const byId = new Map();
  for (const r of rows) if (r.fields) { const prev = byId.get(r.id); if (!prev || r.at > prev.at) byId.set(r.id, r); }
  for (const c of orders) {
    const ids = [c.id, ...(Array.isArray(c.emailIds) ? c.emailIds : [])];
    const row = ids.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => b.at - a.at)[0];
    if (!row) continue;
    let f; try { f = JSON.parse(row.fields); } catch { continue; }
    if (!f || !f.isPurchase) continue;
    const filled = [];
    if (c.totalPence == null && f.totalPence != null) { c.totalPence = f.totalPence; c.currency = c.currency || f.currency || "GBP"; filled.push("total"); }
    if (!day(c.orderDate) && f.orderDate) { c.orderDate = f.orderDate; filled.push("date"); }
    if (!c.orderRef && f.orderRef) { c.orderRef = f.orderRef; filled.push("number"); }
    if (!cleanItems(c.items || []).length && f.items && f.items.length) { c.items = f.items.map((i) => ({ ...i })); filled.push("items"); }
    if (!shopOf(c) && f.shop) { c.retailer = { ...(c.retailer || {}), name: f.shop }; filled.push("shop"); }
    if (filled.length) { c.aiFilled = filled; if (c.status !== "confirmed") c.needsShopperConfirmation = true; }
  }
}
