// Builds a shopper's "Wrapped" from the receipts Relay has captured for them. Nothing here is invented:
// a receipt with no readable total is counted but never added to spending, and the answer says how many were left out.
import { PERSONAL_MAIL, CATEGORIES, itemKind, categoryShares } from "./receipt-category.js";
// A name for someone whose year was mostly one kind of shopping. Plain and kind, never a judgement.
const KIND_LABEL = { digital: "The Digital Native", food: "The Foodie", fashion: "The Style Seeker", electronics: "The Gadget Lover",
  home: "The Nester", beauty: "The Self-Care Pro", travel: "The Wanderer" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const shopName = (c) => (c.retailer && (c.retailer.name || c.retailer.domain)) || "Unknown shop";
// Kinds of purchase that are physical things you could photograph. A photo from a food, travel or digital receipt is
// almost always a restaurant banner, an advert or an app icon, so those are never used.
const THINGS = new Set(["fashion", "electronics", "home", "beauty", "other"]);
// Lines some shops print among the items that aren't things bought: savings, credits, charges and labels.
const NOT_A_THING = /^(you('ve| have)?\s+saved?|you\s+save|saved?|savings?|was|now|rrp|credit|credits|discount|voucher|promo(tion)?( code)?|offer|multi-?buy|delivery|service( fee| charge)?|bag charge|carrier bag|tip|total|sub-?total|vat|balance|deposit|nectar|clubcard|points?|apple\s?pay|google\s?pay|paypal|visa|mastercard|amex|card payment|gift card balance)\b|:\s*$/i;
const itemName = (it) => { const n = it && typeof it.name === "string" ? it.name.trim() : ""; return n.length > 1 && n.length <= 80 && !NOT_A_THING.test(n) ? n : null; };

function whenOf(card) {
  if (card.orderDate && /^\d{4}-\d{2}-\d{2}$/.test(card.orderDate)) return card.orderDate;
  if (Number.isFinite(card.createdAt)) return new Date(card.createdAt).toISOString().slice(0, 10);
  return null;
}

// The kinds of shopping a Wrapped can be about on its own ("your 2026 in fashion"), so a top 5 never mixes a coat with a coffee.
export const INDUSTRIES = Object.keys(CATEGORIES);
const kindOf = (c) => (c && CATEGORIES[c.category] ? c.category : "other");
// What one item is: the group the receipts list gave it (a supermarket shop's kitchen roll is Home & garden), or for a
// receipt from elsewhere, the receipt's own group.
const kindOfItem = (it, c) => (it && typeof it.category === "string" && CATEGORIES[it.category] ? it.category : kindOf(c));
// A receipt with different kinds of things in it (a supermarket shop with kitchen roll in it, an Amazon order of coffee
// pods and a charger) becomes one part per kind, each with its own items and its share of the total by what those items
// cost, so each kind's money and things are counted where they belong. Only when the receipt prices every item: Relay
// never guesses how money was split, so otherwise the receipt stays whole in its own group. The part that is the
// receipt's own kind keeps its photo, its return and any refund; the parts add up to the total exactly.
function partsOf(c) {
  const s = c.totalPence != null && !c.part ? categoryShares(c) : null;
  if (!s) return [c];
  const main = s.some(p => p.category === kindOf(c)) ? kindOf(c) : s[0].category;
  const pence = s.map(p => Math.floor(c.totalPence * p.share));
  const left = c.totalPence - pence.reduce((a, b) => a + b, 0);
  return s.map((p, j) => {
    const own = p.category === main;
    return { ...c, category: p.category, categoryLabel: CATEGORIES[p.category], items: p.items.map(i => c.items[i]), totalPence: pence[j] + (own ? left : 0),
      part: own ? "main" : "share", ...(own ? {} : { hasImage: false, returnPlan: null, returnProgress: null }) };
  }).filter(p => p.totalPence > 0 || p.part === "main");
}

export function buildWrapped(cards, year, now = Date.now(), opts = {}) {
  year = Number(year) || new Date(now).getUTCFullYear();
  const industry = opts && INDUSTRIES.includes(opts.industry) ? opts.industry : null;
  // One order can arrive as several emails (confirmation, dispatch). It counts once.
  const seen = new Set();
  const inYear = (cards || []).filter(c => c && c.kind !== "return_instructions").filter(c => { const w = whenOf(c); return w && Number(w.slice(0, 4)) === year; });
  // A receipt the shopper forwarded to themselves is the same purchase as the shop's own email: count it once.
  const forwarded = c => PERSONAL_MAIL.test(String((c.retailer && c.retailer.domain) || ""));
  const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
  const originals = inYear.filter(c => !forwarded(c) && c.totalPence != null);
  const shopRefs = new Set((cards || []).filter(c => c && !forwarded(c) && c.orderRef).map(c => String(c.orderRef).toUpperCase()));
  const copy = c => forwarded(c) && ((c.orderRef && shopRefs.has(String(c.orderRef).toUpperCase())) || (c.totalPence != null && originals.some(o => o.totalPence === c.totalPence && days(whenOf(o), whenOf(c)) <= 7)));
  const everything = inYear.filter(c => !copy(c)).filter(c => {
    if (!c.orderRef) return true;
    const k = ((c.retailer && (c.retailer.domain || c.retailer.name)) || "") + "|" + c.orderRef;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  // Each kind of shopping this year, biggest spend first, so the app can offer a Wrapped for each one. A receipt
  // with several kinds of things in it counts in each, with the money its things of that kind cost.
  const parts = everything.flatMap(partsOf);
  const kinds = new Map(), mainly = new Map();
  for (const c of parts) {
    const k = kindOf(c), e = kinds.get(k) || { category: k, label: CATEGORIES[k], receipts: 0, spentPence: 0 };
    e.receipts++; if (c.totalPence != null && (!c.currency || c.currency === "GBP")) e.spentPence += c.totalPence;
    kinds.set(k, e);
    if (c.part !== "share") mainly.set(k, (mainly.get(k) || 0) + 1);
  }
  const industries = [...kinds.values()].sort((a, b) => b.spentPence - a.spentPence || b.receipts - a.receipts);
  const mine = industry ? parts.filter(c => kindOf(c) === industry) : everything;
  // Words for the reasons below: "your spending" for the whole year, "your spending on fashion" for one kind.
  const on = industry ? " on " + CATEGORIES[industry].toLowerCase() : "";
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
  // Your biggest treat is for you: a present for someone else isn't one (it has its own place under gifts).
  const biggest = gbp.filter(c => !c.gift).sort((a, b) => b.totalPence - a.totalPence)[0];
  // In one kind's Wrapped, a thing that is plainly another kind (kitchen roll in a supermarket shop that couldn't be split
  // by price) isn't one of its things.
  const otherKind = (it, c) => {
    if (!industry) return false;
    const k = it && typeof it.category === "string" ? kindOfItem(it, c) : itemKind(it && it.name);
    return Boolean(k) && k !== industry;
  };
  const itemCount = mine.reduce((s, c) => s + (Array.isArray(c.items) ? c.items.reduce((n, i) => n + (otherKind(i, c) ? 0 : Number(i && i.qty) > 0 ? Number(i.qty) : 1), 0) : 0), 0);
  const withReturn = mine.filter(c => c.returnPlan).length;
  const topCat = categories[0];
  // A label from what the receipts actually show. It is a plain description, not a personality test.
  const personality = !mine.length || industry ? null
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
    const n = it && typeof it.name === "string" ? it.name.trim() : ""; if (!n || n.length > 80 || otherKind(it, c)) continue;
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
  // Each item by what it is, so a jacket from a supermarket counts and the bread in the same order doesn't. A present for
  // someone else says nothing about your own style, so gifts are left out.
  for (const c of mine) {
    if (forwarded(c) || c.gift) continue;
    for (const it of (c.items || [])) { const n = itemName(it); if (n && THINGS.has(kindOfItem(it, c)) && things.length < 300) things.push({ name: n, variant: typeof it.variant === "string" ? it.variant.slice(0, 80) : null, shop: shopName(c), pricePence: Number.isInteger(it.pricePence) ? it.pricePence : null }); }
  }
  // ---- The Spotify-style parts, each counted straight from the receipts. ----
  // Your year's list (like "Your Top Songs"): every named thing, ranked by how many separate orders it was in, then spend.
  const itemStats = new Map();
  for (const c of mine) {
    const here = new Set();
    for (const it of (c.items || [])) {
      const n = itemName(it); if (!n || otherKind(it, c)) continue;
      const k = n.toLowerCase(); if (here.has(k)) continue; here.add(k);
      const e = itemStats.get(k) || { name: n, times: 0, spentPence: 0, shop: forwarded(c) ? null : shopName(c) };
      e.times++;
      if (Number.isInteger(it.pricePence)) e.spentPence += it.pricePence * (Number(it.qty) > 1 && !it.lineTotal ? Number(it.qty) : 1);
      itemStats.set(k, e);
    }
  }
  const yearList = [...itemStats.values()].sort((a, b) => b.times - a.times || b.spentPence - a.spentPence).slice(0, 100);
  const topItems = yearList.slice(0, 5);
  // Your biggest buys (like "Top Albums"): the five largest receipts.
  const topBuys = gbp.filter(c => !forwarded(c)).sort((a, b) => b.totalPence - a.totalPence).slice(0, 5).map(c => ({ shop: shopName(c), item: (c.items || []).filter(itemName).length === 1 ? itemName((c.items || []).filter(itemName)[0]) : null,
    items: (c.items || []).filter(itemName).length, totalPence: c.totalPence, date: whenOf(c), photoId: c.hasImage && c.id && THINGS.has(c.category || "other") ? c.id : null }));
  // Shopping time (like "Minutes listened"): the days you bought something, and your favourite day of the week.
  const shopDays = new Set(mine.map(whenOf));
  const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], byDay = DAY.map(() => 0);
  for (const d of shopDays) byDay[new Date(d + "T12:00:00Z").getUTCDay()]++;
  const favDay = shopDays.size ? byDay.indexOf(Math.max(...byDay)) : -1;
  const weekendDays = byDay[0] + byDay[6];
  let streak = 0, run = 0; byMonth.forEach(m => { run = m.receipts ? run + 1 : 0; streak = Math.max(streak, run); });
  const shoppingTime = { days: shopDays.size, favouriteDay: favDay >= 0 ? DAY[favDay] : null, favouriteDayCount: favDay >= 0 ? byDay[favDay] : 0,
    weekendShare: shopDays.size ? Math.round(weekendDays / shopDays.size * 100) : 0, longestMonthStreak: streak };
  // Shop sprint (like "Top 5 Artist Sprint"): each top shop's orders month by month.
  const sprint = topShops.map(t => {
    const months = MONTHS.map(() => 0);
    for (const c of mine) if (!forwarded(c) && shopName(c).toLowerCase() === t.name.toLowerCase()) { const i = Number(whenOf(c).slice(5, 7)) - 1; if (i >= 0 && i < 12) months[i]++; }
    return { name: t.name, months };
  });
  // Subscriptions (like "Top Podcasts"): digital things you paid for in at least three different months.
  const subs = new Map();
  for (const c of mine) {
    if (c.category !== "digital" || forwarded(c)) continue;
    const n = shopName(c), e = subs.get(n) || { name: n, months: new Set(), spentPence: 0, item: null };
    e.months.add(whenOf(c).slice(0, 7)); if (gbp.includes(c)) e.spentPence += c.totalPence;
    if (!e.item && (c.items || []).length) e.item = itemName(c.items[0]);
    subs.set(n, e);
  }
  const subscriptions = [...subs.values()].filter(e => e.months.size >= 3).sort((a, b) => b.months.size - a.months.size || b.spentPence - a.spentPence).slice(0, 5)
    .map(e => ({ name: e.name, months: e.months.size, spentPence: e.spentPence, item: e.item }));
  // Gifts: receipts the shopper said were presents for someone else. They still count in the year's spending (the money
  // was spent), and here on their own: how many, what they cost, who they were for (only names the shopper typed).
  const giftCards = mine.filter(c => c.gift && c.part !== "share");
  const giftGbp = giftCards.filter(c => gbp.includes(c));
  const giftSpent = giftGbp.reduce((n, c) => n + c.totalPence, 0);
  const people = new Map();
  for (const c of giftCards) {
    const who = typeof c.gift.for === "string" ? c.gift.for.replace(/\s+/g, " ").trim() : "";
    if (!who) continue;
    const e = people.get(who.toLowerCase()) || { name: who, gifts: 0, spentPence: 0 };
    e.gifts++; if (gbp.includes(c)) e.spentPence += c.totalPence;
    people.set(who.toLowerCase(), e);
  }
  const giftMonths = MONTHS.map(() => 0);
  for (const c of giftCards) { const i = Number(whenOf(c).slice(5, 7)) - 1; if (i >= 0 && i < 12) giftMonths[i]++; }
  const giftPeak = Math.max(0, ...giftMonths);
  const gifts = giftCards.length ? {
    count: giftCards.length, spentPence: giftSpent, withTotal: giftGbp.length,
    share: spentPence > 0 && giftSpent > 0 ? Math.max(1, Math.round(giftSpent / spentPence * 100)) : null,
    // How many say who they were for, so the app never says "for 2 people" when some gifts don't say.
    named: giftCards.filter(c => typeof c.gift.for === "string" && c.gift.for.trim()).length,
    people: [...people.values()].sort((a, b) => b.gifts - a.gifts || b.spentPence - a.spentPence).slice(0, 5),
    // The month most of them were bought in, only when it really stood out (two or more, and more than any other month).
    busiestMonth: giftPeak >= 2 && giftMonths.filter(n => n === giftPeak).length === 1 ? MONTHS[giftMonths.indexOf(giftPeak)] : null,
    list: giftCards.slice().sort((a, b) => (b.totalPence || 0) - (a.totalPence || 0) || whenOf(b).localeCompare(whenOf(a))).slice(0, 6).map(c => {
      const named = (c.items || []).filter(itemName);
      return { item: named.length ? itemName(named[0]) : null, more: Math.max(0, named.length - 1), shop: forwarded(c) ? null : shopName(c),
        for: typeof c.gift.for === "string" && c.gift.for.trim() ? c.gift.for.trim() : null, totalPence: gbp.includes(c) ? c.totalPence : null, date: whenOf(c),
        photoId: c.hasImage && c.id && THINGS.has(c.category || "other") && !forwarded(c) ? c.id : null };
    })
  } : null;
  // Badges (like Spotify's identity cards): only ones the receipts prove, each with the reason.
  const badges = [];
  if (topShopShare && topShopShare >= 30 && top) badges.push({ label: "Loyal to " + top.name, why: topShopShare + "% of your spending" + on + " went there." });
  if (shops.size >= 15) badges.push({ label: "The Explorer", why: "You bought" + (industry ? " " + CATEGORIES[industry].toLowerCase() : "") + " from " + shops.size + " different shops." });
  if (shoppingTime.weekendShare >= 40 && shopDays.size >= 5) badges.push({ label: "Weekend Shopper", why: shoppingTime.weekendShare + "% of your shopping days were Saturdays or Sundays." });
  if (refunded.length >= 2 || withReturn >= 3) badges.push({ label: "Returns Pro", why: refunded.length >= 2 ? refunded.length + " refunds tracked back to you." : withReturn + " returns started." });
  if (subscriptions.length >= 3) badges.push({ label: "Subscriber", why: subscriptions.length + " things you paid for month after month." });
  if (streak >= 6) badges.push({ label: "Never Missed a Month", why: "You bought something " + streak + " months in a row." });
  if (mine.some(c => (c.items || []).length >= 5)) badges.push({ label: "Big Basket", why: "At least one order with 5 or more things in it." });
  if (giftCards.length >= 3) badges.push({ label: "The Gift Giver", why: giftCards.length + " of your orders were presents for someone else." });
  // One chapter per kind of shopping for the year's single story: its share of the year, where it went, what it was, and
  // one fun number of its own. Every figure is counted from the receipts, like the rest.
  // A kind gets its own chapter when some receipt was mostly that kind, or its things turned up in at least three
  // receipts (one pack of batteries in a supermarket shop isn't a year in electronics).
  const chapters = industry || opts.noChapters ? undefined : industries.filter(k => k.category !== "other" && k.receipts > 0 && (mainly.get(k.category) || k.receipts >= 3)).map(k => {
    const w = buildWrapped(cards, year, now, { industry: k.category, noChapters: true });
    const weeks = Math.max(1, Math.ceil((Math.min(now, Date.UTC(year + 1, 0, 1)) - Date.UTC(year, 0, 1)) / (7 * 864e5)));
    const named = (w.topItems || []).filter(x => x.name);
    const fact = chapterFact(k.category, w, weeks);
    return {
      category: k.category, label: CATEGORIES[k.category], receipts: w.receipts, spentPence: w.spentPence, withTotal: w.coverage.withTotal,
      share: spentPence > 0 && w.spentPence > 0 ? Math.max(1, Math.round(w.spentPence / spentPence * 100)) : null,
      topShop: w.topShops[0] ? { name: w.topShops[0].name, receipts: w.topShops[0].receipts, spentPence: w.topShops[0].spentPence } : null,
      shops: w.shops, items: w.items, topItem: named[0] && named[0].times >= 2 ? { name: named[0].name, times: named[0].times } : null,
      things: named.slice(0, 3).map(x => x.name),
      biggest: w.biggest ? { shop: w.biggest.shop, item: w.biggest.item, totalPence: w.biggest.totalPence, photoId: w.biggest.photoId } : null,
      busiestMonth: w.busiestMonth, favouriteDay: w.shoppingTime.days >= 3 ? w.shoppingTime.favouriteDay : null,
      photos: (w.photos || []).slice(0, 3), subscriptions: (w.subscriptions || []).length, fact,
    };
  });
  return {
    year, years, industry, industryLabel: industry ? CATEGORIES[industry] : null, industries, chapters,
    receipts: mine.length, shops: shops.size, items: itemCount, spentPence, currency: "GBP",
    topItem, refundedPence, refundsMatched: refunded.length, topShopShare, activeMonths, firstDate,
    coverage: { withTotal: gbp.length, noTotal, otherCurrency },
    topShops, categories, byMonth,
    busiestMonth: busiest && busiest.receipts ? busiest.month : null,
    biggest: biggest ? { shop: shopName(biggest), totalPence: biggest.totalPence, date: whenOf(biggest), item: (biggest.items || []).length === 1 ? itemName(biggest.items[0]) : null,
      photoId: biggest.hasImage && biggest.id && THINGS.has(biggest.category || "other") ? biggest.id : null } : null,
    firstBuy, photos, things, topItems, yearList, topBuys, shoppingTime, sprint, subscriptions, badges, gifts,
    returnsStarted: withReturn, personality,
    note: "Based on the receipts and order emails Relay found. In-store card purchases without an email receipt aren't included."
  };
}

// One playful number for each kind of shopping, worked out from that kind's receipts only (null when the receipts can't back it).
function chapterFact(kind, w, weeks) {
  const perWeek = w.spentPence ? Math.round(w.spentPence / weeks) : 0;
  const per = (n) => (w.coverage.withTotal && n ? Math.round(w.spentPence / n) : 0);
  if (kind === "food") return w.receipts >= 4 ? { kind: "perWeek", pence: perWeek, orders: w.receipts } : null;
  if (kind === "fashion") return w.items >= 2 && per(w.items) ? { kind: "perPiece", pence: per(w.items), pieces: w.items } : null;
  if (kind === "electronics") return w.items ? { kind: "gadgets", count: w.items } : null;
  if (kind === "home") return w.items ? { kind: "homeThings", count: w.items } : null;
  if (kind === "beauty") return w.items ? { kind: "beautyThings", count: w.items } : null;
  if (kind === "travel") return w.receipts ? { kind: "trips", count: w.receipts } : null;
  if (kind === "digital") return w.activeMonths ? { kind: "perMonth", pence: w.spentPence ? Math.round(w.spentPence / w.activeMonths) : 0, months: w.activeMonths } : null;
  if (kind === "experiences") return w.receipts ? { kind: "outings", count: w.receipts } : null;
  return null;
}
