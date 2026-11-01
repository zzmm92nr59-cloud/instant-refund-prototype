// Builds a shopper's "Wrapped" from the receipts Relay has captured for them. Nothing here is invented:
// a receipt with no readable total is counted but never added to spending, and the answer says how many were left out.
import { PERSONAL_MAIL } from "./receipt-category.js";
// A name for someone whose year was mostly one kind of shopping. Plain and kind, never a judgement.
const KIND_LABEL = { digital: "The Digital Native", food: "The Foodie", fashion: "The Style Seeker", electronics: "The Gadget Lover",
  home: "The Nester", beauty: "The Self-Care Pro", travel: "The Wanderer" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const shopName = (c) => (c.retailer && (c.retailer.name || c.retailer.domain)) || "Unknown shop";
// Kinds of purchase that are physical things you could photograph. A photo from a food, travel or digital receipt is
// almost always a restaurant banner, an advert or an app icon, so those are never used.
const THINGS = new Set(["fashion", "electronics", "home", "beauty", "other"]);
const itemName = (it) => it && typeof it.name === "string" && it.name.trim().length > 1 && it.name.trim().length <= 80 ? it.name.trim() : null;

function whenOf(card) {
  if (card.orderDate && /^\d{4}-\d{2}-\d{2}$/.test(card.orderDate)) return card.orderDate;
  if (Number.isFinite(card.createdAt)) return new Date(card.createdAt).toISOString().slice(0, 10);
  return null;
}

export function buildWrapped(cards, year, now = Date.now()) {
  year = Number(year) || new Date(now).getUTCFullYear();
  // One order can arrive as several emails (confirmation, dispatch). It counts once.
  const seen = new Set();
  const inYear = (cards || []).filter(c => c && c.kind !== "return_instructions").filter(c => { const w = whenOf(c); return w && Number(w.slice(0, 4)) === year; });
  // A receipt the shopper forwarded to themselves is the same purchase as the shop's own email: count it once.
  const forwarded = c => PERSONAL_MAIL.test(String((c.retailer && c.retailer.domain) || ""));
  const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
  const originals = inYear.filter(c => !forwarded(c) && c.totalPence != null);
  const shopRefs = new Set((cards || []).filter(c => c && !forwarded(c) && c.orderRef).map(c => String(c.orderRef).toUpperCase()));
  const copy = c => forwarded(c) && ((c.orderRef && shopRefs.has(String(c.orderRef).toUpperCase())) || (c.totalPence != null && originals.some(o => o.totalPence === c.totalPence && days(whenOf(o), whenOf(c)) <= 7)));
  const mine = inYear.filter(c => !copy(c)).filter(c => {
    if (!c.orderRef) return true;
    const k = ((c.retailer && (c.retailer.domain || c.retailer.name)) || "") + "|" + c.orderRef;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  const gbp = mine.filter(c => c.totalPence != null && (!c.currency || c.currency === "GBP"));
  const otherCurrency = mine.filter(c => c.totalPence != null && c.currency && c.currency !== "GBP").length;
  const noTotal = mine.filter(c => c.totalPence == null).length;
  const spentPence = gbp.reduce((s, c) => s + c.totalPence, 0);
  const shops = new Map();
  for (const c of mine) {
    const name = forwarded(c) ? "Forwarded receipts" : (c.retailer && (c.retailer.name || c.retailer.domain)) || "Unknown shop";
    const key = name.toLowerCase();
    const s = shops.get(key) || { name, domain: c.retailer && c.retailer.domain || null, receipts: 0, spentPence: 0 };
    s.receipts++; if (gbp.includes(c)) s.spentPence += c.totalPence;
    shops.set(key, s);
  }
  const topShops = [...shops.values()].filter(s => s.name !== "Forwarded receipts").sort((a, b) => b.spentPence - a.spentPence || b.receipts - a.receipts).slice(0, 5);
  const cats = new Map();
  for (const c of mine) {
    const k = c.category || "other";
    const s = cats.get(k) || { category: k, label: c.categoryLabel || k, receipts: 0, spentPence: 0, _shops: new Map() };
    s.receipts++; if (gbp.includes(c)) s.spentPence += c.totalPence;
    if (!forwarded(c)) { const n = shopName(c); s._shops.set(n, (s._shops.get(n) || 0) + 1); }
    cats.set(k, s);
  }
  // The shop each kind of shopping went to most ("your go-to for food: Just Eat").
  for (const s of cats.values()) {
    const best = [...s._shops.entries()].sort((a, b) => b[1] - a[1])[0];
    s.topShop = best ? { name: best[0], receipts: best[1] } : null; delete s._shops;
  }
  const categories = [...cats.values()].sort((a, b) => b.receipts - a.receipts || b.spentPence - a.spentPence);
  const byMonth = MONTHS.map((m, i) => ({ month: m, receipts: 0, spentPence: 0, _i: i }));
  for (const c of mine) {
    const i = Number(whenOf(c).slice(5, 7)) - 1; if (i < 0 || i > 11) continue;
    byMonth[i].receipts++; if (gbp.includes(c)) byMonth[i].spentPence += c.totalPence;
  }
  byMonth.forEach(m => delete m._i);
  const busiest = byMonth.slice().sort((a, b) => b.receipts - a.receipts)[0];
  const biggest = gbp.slice().sort((a, b) => b.totalPence - a.totalPence)[0];
  const itemCount = mine.reduce((s, c) => s + (Array.isArray(c.items) ? c.items.reduce((n, i) => n + (Number(i && i.qty) > 0 ? Number(i.qty) : 1), 0) : 0), 0);
  const withReturn = mine.filter(c => c.returnPlan).length;
  const topCat = categories[0];
  // A label from what the receipts actually show. It is a plain description, not a personality test.
  const personality = !mine.length ? null
    : topCat && topCat.receipts / mine.length >= 0.5 ? { label: (KIND_LABEL[topCat.category] || topCat.label + " regular"), why: topCat.receipts + " of your " + mine.length + " receipts were " + topCat.label.toLowerCase() + (topCat.topShop ? ", most of them from " + topCat.topShop.name : "") + "." }
    : shops.size >= 10 ? { label: "The Explorer", why: "You bought from " + shops.size + " different shops." }
    : { label: "The Mixer", why: "Your shopping was spread across " + categories.length + " kinds of shop." };
  // Which years have any receipts, so the app can offer them (newest first).
  const yearCounts = new Map();
  for (const c of cards || []) { if (!c || c.kind === "return_instructions") continue; const w = whenOf(c); if (w) { const y = Number(w.slice(0, 4)); yearCounts.set(y, (yearCounts.get(y) || 0) + 1); } }
  const years = [...yearCounts.entries()].sort((a, b) => b[0] - a[0]).map(([y, n]) => ({ year: y, receipts: n }));
  // The thing bought most often (by name), only when it really was a repeat.
  const itemsByName = new Map();
  for (const c of mine) for (const it of (Array.isArray(c.items) ? c.items : [])) {
    const n = it && typeof it.name === "string" ? it.name.trim() : ""; if (!n || n.length > 80) continue;
    const k = n.toLowerCase(); const e = itemsByName.get(k) || { name: n, times: 0, shop: (c.retailer && c.retailer.name) || null }; e.times++; itemsByName.set(k, e);
  }
  const topItemE = [...itemsByName.values()].sort((a, b) => b.times - a.times)[0];
  const topItem = topItemE && topItemE.times >= 2 ? topItemE : null;
  // Money the shops sent back, from refund emails Relay matched to a purchase.
  const refunded = mine.filter(c => c.returnProgress && Number.isInteger(c.returnProgress.refundPence));
  const refundedPence = refunded.reduce((n, c) => n + c.returnProgress.refundPence, 0);
  const top = topShops[0] || null;
  const topShopShare = top && spentPence > 0 && top.spentPence > 0 ? Math.round(top.spentPence / spentPence * 100) : null;
  const activeMonths = byMonth.filter(m => m.receipts > 0).length;
  const firstDate = mine.map(whenOf).sort()[0] || null;
  // The first thing bought this year (by date), named when the receipt names it.
  const first = mine.slice().sort((a, b) => whenOf(a).localeCompare(whenOf(b)) || (a.createdAt || 0) - (b.createdAt || 0))[0];
  const firstBuy = first ? { shop: forwarded(first) ? null : shopName(first), item: itemName((first.items || [])[0]), date: whenOf(first) } : null;
  // Real photos of things bought: only from receipts where Relay checked the photo is of the item (hasImage), never a stand-in.
  const photos = mine.filter(c => c.hasImage && c.id && THINGS.has(c.category || "other") && !forwarded(c))
    .sort((a, b) => (b.totalPence || 0) - (a.totalPence || 0)).slice(0, 9)
    .map(c => ({ id: c.id, shop: shopName(c), item: itemName((c.items || [])[0]), more: Math.max(0, (c.items || []).length - 1), date: whenOf(c) }));
  // Things (not food, travel or apps) for the style slide: the app works the style out from these, on the device.
  const things = [];
  for (const c of mine) {
    if (forwarded(c) || !THINGS.has(c.category || "other")) continue;
    for (const it of (c.items || [])) { const n = itemName(it); if (n && things.length < 300) things.push({ name: n, variant: typeof it.variant === "string" ? it.variant.slice(0, 80) : null, shop: shopName(c), pricePence: Number.isInteger(it.pricePence) ? it.pricePence : null }); }
  }
  return {
    year, years, receipts: mine.length, shops: shops.size, items: itemCount, spentPence, currency: "GBP",
    topItem, refundedPence, refundsMatched: refunded.length, topShopShare, activeMonths, firstDate,
    coverage: { withTotal: gbp.length, noTotal, otherCurrency },
    topShops, categories, byMonth,
    busiestMonth: busiest && busiest.receipts ? busiest.month : null,
    biggest: biggest ? { shop: shopName(biggest), totalPence: biggest.totalPence, date: whenOf(biggest), item: (biggest.items || []).length === 1 ? itemName(biggest.items[0]) : null,
      photoId: biggest.hasImage && biggest.id && THINGS.has(biggest.category || "other") ? biggest.id : null } : null,
    firstBuy, photos, things,
    returnsStarted: withReturn, personality,
    note: "Based on the receipts and order emails Relay found. In-store card purchases without an email receipt aren't included."
  };
}
