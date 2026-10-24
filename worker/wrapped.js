// Builds a shopper's "Wrapped" from the receipts Relay has captured for them. Nothing here is invented:
// a receipt with no readable total is counted but never added to spending, and the answer says how many were left out.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function whenOf(card) {
  if (card.orderDate && /^\d{4}-\d{2}-\d{2}$/.test(card.orderDate)) return card.orderDate;
  if (Number.isFinite(card.createdAt)) return new Date(card.createdAt).toISOString().slice(0, 10);
  return null;
}

export function buildWrapped(cards, year, now = Date.now()) {
  year = Number(year) || new Date(now).getUTCFullYear();
  // One order can arrive as several emails (confirmation, dispatch). It counts once.
  const seen = new Set();
  const mine = (cards || []).filter(c => c && c.kind !== "return_instructions").filter(c => { const w = whenOf(c); return w && Number(w.slice(0, 4)) === year; }).filter(c => {
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
    const name = (c.retailer && (c.retailer.name || c.retailer.domain)) || "Unknown shop";
    const key = name.toLowerCase();
    const s = shops.get(key) || { name, domain: c.retailer && c.retailer.domain || null, receipts: 0, spentPence: 0 };
    s.receipts++; if (gbp.includes(c)) s.spentPence += c.totalPence;
    shops.set(key, s);
  }
  const topShops = [...shops.values()].sort((a, b) => b.spentPence - a.spentPence || b.receipts - a.receipts).slice(0, 5);
  const cats = new Map();
  for (const c of mine) {
    const k = c.category || "other";
    const s = cats.get(k) || { category: k, label: c.categoryLabel || k, receipts: 0, spentPence: 0 };
    s.receipts++; if (gbp.includes(c)) s.spentPence += c.totalPence;
    cats.set(k, s);
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
    : topCat && topCat.receipts / mine.length >= 0.5 ? { label: topCat.label + " regular", why: topCat.receipts + " of your " + mine.length + " receipts were " + topCat.label.toLowerCase() + "." }
    : shops.size >= 10 ? { label: "The Explorer", why: "You bought from " + shops.size + " different shops." }
    : { label: "The Mixer", why: "Your shopping was spread across " + categories.length + " kinds of shop." };
  return {
    year, receipts: mine.length, shops: shops.size, items: itemCount, spentPence, currency: "GBP",
    coverage: { withTotal: gbp.length, noTotal, otherCurrency },
    topShops, categories, byMonth,
    busiestMonth: busiest && busiest.receipts ? busiest.month : null,
    biggest: biggest ? { shop: (biggest.retailer && biggest.retailer.name) || "Unknown shop", totalPence: biggest.totalPence, date: whenOf(biggest) } : null,
    returnsStarted: withReturn, personality,
    note: "Based on the receipts and order emails Relay found. In-store card purchases without an email receipt aren't included."
  };
}
