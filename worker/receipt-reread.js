// "Read it again": the shopper taps it on a receipt whose items don't add up (itemsCheck.complete === false), or one with an
// item name that doesn't look like a thing bought (itemsCheck.namesOk === false, item-names.js, round 9). Relay reads
// that one email again from their inbox: first with its own rules, with a wider pass than the scan uses; and, only if the
// items still don't add up and ANTHROPIC_API_KEY is set, Claude (Anthropic's AI) reads the email's order section.
//
// Rules (do not weaken):
//  * Only on the shopper's tap, for one of their own receipts (anyone else's answers 404). The tap is the consent for that
//    one email, as with the photo of a paper receipt: AI help doesn't need to be on.
//  * What goes to Anthropic is the order section only (from just above the first item to the total), with the shopper's
//    personal details hidden first (shared-emails.js hideDetails: names, addresses, postcodes, phone numbers, email
//    addresses, card and other long numbers, links). Never the whole email, its sender's address, or who the shopper is.
//  * Nothing is invented: the AI's items are kept only when they add up to what the email says they came to (the same totals
//    check as the rules', receipt-items.js checkItems). Otherwise nothing it said is kept.
//  * Limits: REREADS_PER_DAY a shopper; REREAD_AI_PER_DAY of those may go to the AI, and REREAD_AI_ALL_DAY across Relay.
//    Only counts are kept (receipt_rereads: who, which receipt, when, whether the AI was asked, and how it ended), deleted
//    with the receipt's inbox, the permission or the account.
import { aiAvailable } from "./ai-reader.js";
import { DEFAULT_MODEL, claudeFetch, isCapped, noThinking } from "./ai-spend.js";
import { checkItems, moneyOf, lineOf } from "./receipt-items.js";
import { cleanItems } from "./receipt-reader.js";
import { namesCheck } from "./item-names.js";

export const REREADS_PER_DAY = 20;
export const REREAD_AI_PER_DAY = 10;
export const REREAD_AI_ALL_DAY = 1000;
export const REREADS_SQL = `CREATE TABLE IF NOT EXISTS receipt_rereads (shopper_id TEXT NOT NULL, receipt_id TEXT NOT NULL, ai INTEGER NOT NULL DEFAULT 0,
  outcome TEXT, created_at INTEGER NOT NULL)`;
const MAX_SECTION = 6000;
const model = (env) => env.AI_READER_MODEL || DEFAULT_MODEL;

export const REREAD_SYSTEM = [
  "You read the order section of one shopping email for Relay, a UK app that keeps people's receipts, and reply with one JSON object and nothing else.",
  "Personal details have been replaced with markers such as [name], [address], [email], [link], [phone], [number], [code] and [postcode]. Leave them out, and never guess what they hide.",
  "Keys: items (every thing bought, in the order the email lists them: name exactly as written, qty as a whole number, pricePence for that whole line in pence as a whole number),",
  "subtotalPence (the items' subtotal as written, in pence, or null), totalPence (the total paid as written, in pence, or null).",
  "An extra or option under an item (such as \"+ Egg Fried Rice\" or \"Size: M\") belongs to that item: add it to the item's name after a comma, never as an item of its own.",
  "Delivery, service and bag fees, tips, discounts, vouchers, VAT and totals are never items. Items marked unavailable or not charged are left out.",
  "Copy only what is written. Never invent, guess or work out an item or a price; leave out anything you can't read."
].join(" ");

// The part of the email with the order in it: from a few lines above the first amount in pounds to just past the total.
export function orderSection(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const money = (l) => /£\s?\d/.test(l);
  const first = lines.findIndex(money);
  if (first < 0) return "";
  let last = first;
  for (let i = first; i < lines.length; i++) {
    if (money(lines[i])) last = i;
    if (/^\W*(?:order |grand |estimated )?total\b/i.test(lines[i]) && (money(lines[i]) || money(lines[i + 1] || ""))) { last = money(lines[i]) ? i : i + 1; break; }
  }
  const start = Math.max(0, first - 12);
  return lines.slice(start, last + 1).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_SECTION);
}

// The AI's answer, checked like anything a person types. null when it isn't one JSON object.
export function cleanRereadAnswer(answer) {
  let j = answer;
  if (typeof answer === "string") {
    const a = answer.indexOf("{"), b = answer.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try { j = JSON.parse(answer.slice(a, b + 1)); } catch { return null; }
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const pence = (v) => (Number.isInteger(v) && v >= 0 && v <= 1e8 ? v : null);
  const items = (Array.isArray(j.items) ? j.items : []).slice(0, 80).map((i) => {
    if (!i || typeof i !== "object" || typeof i.name !== "string") return null;
    const name = i.name.replace(/\s+/g, " ").trim().slice(0, 120);
    const qty = Number.isInteger(i.qty) && i.qty >= 1 && i.qty <= 999 ? i.qty : 1;
    const p = pence(i.pricePence);
    if (!name || p == null || /\[(?:name|address|email|link|phone|number|code|postcode)\]/.test(name)) return null;
    return { name, qty, pricePence: p, lineTotal: true };
  }).filter(Boolean);
  return { items: cleanItems(items), subtotalPence: pence(j.subtotalPence), totalPence: pence(j.totalPence) };
}

// Asks Claude for the items in one order section. { reading } or { error: "ai_off" | "ai_unreachable" | "ai_busy" | "ai_refused" | "unreadable" }.
// Over Relay's AI spending limit (the month's, or the shopper's for the day: o.shopperId) it is "ai_off", as without the key.
export async function askForItems(env, section, fetchImpl, o = {}) {
  if (!aiAvailable(env)) return { error: "ai_off" };
  let r;
  try {
    r = await claudeFetch(env, "reread", fetchImpl, { method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: model(env), max_tokens: 2000, ...noThinking(env), system: REREAD_SYSTEM, messages: [{ role: "user", content: section }] }),
      signal: AbortSignal.timeout(40000) }, o);
  } catch { return { error: "ai_unreachable" }; }
  if (isCapped(r)) return { error: "ai_off", capped: r.capped };
  if (r.status === 429 || r.status >= 500) return { error: "ai_busy" };
  if (!r.ok) return { error: "ai_refused" };
  const body = await r.json().catch(() => null);
  const out = body && Array.isArray(body.content) ? body.content.filter((c) => c && c.type === "text").map((c) => c.text).join("") : "";
  const reading = cleanRereadAnswer(out);
  return reading ? { reading } : { error: "unreadable" };
}

// The AI's items are kept only when they add up: against the email's own money lines as the rules read them, and the total
// Relay already has. Its own subtotal or total never stands in for the email's.
// Every item the AI names is written in the email: each word of its name is in the order section it was given. An item it
// made up to fill the total ("Your order £86.40" on an email whose items are only in its PDF) is never kept. Round 4.
const words = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[\p{L}\p{N}]{2,}/gu) || [];
export function namedInEmail(reading, sectionText) {
  const inEmail = new Set(words(sectionText));
  return Boolean(reading && reading.items.length) && reading.items.every((i) => { const w = words(i.name); return w.length > 0 && w.every((x) => inEmail.has(x)); });
}
// (Round 9: and every name the AI gives looks like a thing bought (item-names.js). A note or a size given as a name is
// treated like a missing item: nothing it said is kept.)
export function acceptAiItems(reading, sectionText, totalPence, shop) {
  if (!reading || !reading.items.length) return null;
  const money = moneyOf(sectionText);
  const check = { ...checkItems(reading.items, money, totalPence), ...namesCheck(reading.items, { shop: shop || "" }) };
  return check.complete && check.namesOk ? { items: reading.items, check } : null;
}

// How many re-reads the shopper (and Relay) has used in the last day.
export async function rereadsUsed(db, shopperId, now) {
  const since = now - 864e5;
  const mine = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(ai), 0) AS ai FROM receipt_rereads WHERE shopper_id = ? AND created_at > ?").bind(shopperId, since).first();
  const all = await db.prepare("SELECT COALESCE(SUM(ai), 0) AS ai FROM receipt_rereads WHERE created_at > ?").bind(since).first();
  return { mine: Number((mine && mine.n) || 0), mineAi: Number((mine && mine.ai) || 0), allAi: Number((all && all.ai) || 0) };
}
export const itemsSum = (items) => (items || []).reduce((n, i) => n + (lineOf(i) || 0), 0);
