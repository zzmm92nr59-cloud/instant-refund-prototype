// Shops' own published returns policies, for receipts whose emails give no return date or window.
//
// Rules (do not weaken):
//  * Only a policy read on the shop's own UK page, with the sentence that says it copied word for word into `quote`, and
//    the day it was read in `checked`. Nothing from memory, and nothing the page doesn't say plainly: a page that gives a
//    number of days without saying from when has from: null.
//  * A policy is what the shop allows for most items, not this order's deadline: sale items, underwear and the like often
//    have less, and Christmas often more. So it gives "until at least" a date, never a countdown, and the app says "most
//    items" and links the page. A Christmas extension is used only when the page gives its dates with the year.
//  * Only orders in pounds, or from a shop's .uk address: the same shops have different policies abroad.
//  * Re-read them every few months (scripts/test-return-policies.mjs fails once `checked` is over 180 days old). A policy
//    that has changed is updated; one that can't be read is removed.
export const RETURN_POLICIES = [
  { shop: "Zara", domains: ["zara.com"], days: 30, from: "dispatch", most: true, checked: "2026-11-04",
    url: "https://www.zara.com/uk/en/help-center/HowToReturn",
    quote: "Online shopping: you have 30 days from the shipping date of your order." },
  { shop: "H&M", domains: ["hm.com"], days: 30, from: "delivery", most: true, checked: "2026-11-04",
    url: "https://www2.hm.com/en_gb/customer-service/returns.html",
    quote: "If you are not satisfied with your order you have 30 days after receiving it (14 days for sale items and designer collection articles) to register a return." },
  { shop: "ASOS", domains: ["asos.com"], days: 28, from: "delivery", most: true, checked: "2026-11-04",
    url: "https://www.asos.com/customer-care/returns-refunds/how-do-i-return-something-to-you-from-the-uk",
    quote: "You have 28 days from the date your order was delivered or made available for collection to place your return and send it back to us." },
  { shop: "Next", domains: ["next.co.uk"], days: 28, from: "delivery", most: true, checked: "2026-11-04",
    url: "https://zendesk.next.co.uk/hc/en-gb/articles/16963491072913",
    quote: "The 28 days will start from the day after the items were delivered to your home address." },
  { shop: "John Lewis", domains: ["johnlewis.com", "johnlewis.co.uk"], days: 30, from: "delivery", most: true, checked: "2026-11-04",
    url: "https://www.johnlewis.com/customer-services/returns/how-to-return-your-item",
    quote: "You can return or exchange an unwanted item for free up to 30 days after you receive it." },
  // The festive page doesn't say what the 60 days count from, so they're counted from the order: the earliest they can start.
  { shop: "Nike", domains: ["nike.com"], days: 30, from: "delivery", most: true, checked: "2026-11-04",
    url: "https://www.nike.com/gb/help/a/returns-policy",
    quote: "You can return or exchange most Nike items within 30 days of an online order delivery or Nike store purchase.",
    festive: { bought: ["2026-11-01", "2026-12-31"], days: 60,
      quote: "Nike purchases made between 1 November 2026 and 31 December 2026 have an extended 60-day return policy (some exceptions apply)." } },
  { shop: "adidas", domains: ["adidas.co.uk", "adidas.com"], days: 30, from: "delivery", most: true, checked: "2026-11-04",
    url: "https://www.adidas.co.uk/terms_and_conditions",
    quote: "This allows you to withdraw from the contract of sale, without specifying any reasons, for an additional 16 days beyond the Withdrawal Period, so a total return period of 30 days" },
  { shop: "Uniqlo", domains: ["uniqlo.com"], days: 30, from: "delivery", most: true, checked: "2026-11-04",
    url: "https://faq-uk.uniqlo.com/articles/en_US/FAQ/What-is-your-online-returns-policy",
    quote: "within 30 days of receiving a product ordered from our website." },
  // Its page doesn't say plainly what the 35 days count from for online orders, so it's counted from the order.
  { shop: "Boots", domains: ["boots.com"], days: 35, from: null, most: true, checked: "2026-11-04",
    url: "https://www.boots.com/return-policy",
    quote: "You can return any unwanted items free of charge within 35 days for a refund or replacement." },
  { shop: "Currys", domains: ["currys.co.uk"], days: 30, from: null, most: true, checked: "2026-11-04",
    url: "https://www.currys.co.uk/returns-refunds.html",
    quote: "If you bought your item online, you can return it within 30 days - even if you’ve opened it for inspection." },
  { shop: "Argos", domains: ["argos.co.uk"], days: 30, from: "delivery", most: true, checked: "2026-11-04",
    url: "https://help.argos.co.uk/help/refunds-&-returns/returns-product-support-and-repairs/returnsproductsupportrepairs",
    quote: "If you've changed your mind and wish to return an item, you have 30 days from the date of collection or from the date of delivery to request to return your item(s).",
    festive: { bought: ["2026-09-23", "2026-12-25"], until: "2027-01-31",
      quote: "Items purchased from Wednesday 23rd September 2026 to Friday 25th December 2026 can be returned right up to Sunday 31st January 2027." } },
  { shop: "Gymshark", domains: ["gymshark.com"], days: 30, from: "delivery", most: true, checked: "2026-11-04",
    url: "https://support.gymshark.com/en-GB/article/returns-policy",
    quote: "Any unwanted product must be returned within 30 days from when your Gymshark order was delivered (if the order was placed online) or was purchased (if you bought the items in one of our stores).",
    festive: { bought: ["2026-11-01", "2027-01-01"], until: "2027-01-31",
      quote: "Purchases made between 1st November 2026 and 1st January 2027 can be returned up until 31st January 2027." } },
  { shop: "Mango", domains: ["mango.com"], days: 30, from: "dispatch", most: true, checked: "2026-11-04",
    url: "https://shop.mango.com/gb/en/help/returns/online-returns",
    quote: "You have 30 days from the dispatch date of your order to make exchanges and returns." },
  { shop: "COS", domains: ["cos.com", "cosstores.com"], days: 30, from: null, most: true, checked: "2026-11-04",
    url: "https://www.cos.com/en-gb/customer-service/returns",
    quote: "We hope you will love everything that you order from us but if something isn't quite right, you have 30 days to send it back to us." },
  { shop: "River Island", domains: ["riverisland.com"], days: 28, from: "delivery", most: true, checked: "2026-11-04",
    url: "https://www.riverisland.com/how-can-we-help/frequently-asked-questions/returnsrefunds/what-is-your-returns-policy-and-how-do-i-return",
    quote: "Items can be returned within 28 days of delivery or store purchase" },
  { shop: "New Look", domains: ["newlook.com"], days: 28, from: "delivery", most: true, checked: "2026-11-04",
    url: "https://help-uk.newlook.com/hc/en-gb/articles/360015244592-What-is-your-returns-policy",
    quote: "(Your 28 days start from the date on your receipt, or from the date when you received/collected any items you bought online)." },
  { shop: "IKEA", domains: ["ikea.com"], days: 365, from: null, most: true, checked: "2026-11-04",
    url: "https://www.ikea.com/gb/en/customer-service/returns-claims/return-policy/",
    quote: "You can return most* unopened IKEA products within 365 days for a full refund— no rush." },
  { shop: "Dunelm", domains: ["dunelm.com"], days: 28, from: "purchase", most: true, checked: "2026-11-04",
    url: "https://www.dunelm.com/info/help/returns-policy",
    quote: "This allows you to return products (subject to exclusions) within 28 days of purchase if you change your mind.",
    festive: { bought: ["2026-10-12", "2026-12-24"], until: "2027-01-31",
      quote: "Anything purchased between 12th October - 24th December 2026 can be returned until 31st January 2027." } }
];

const DAY_MS = 86400000;
const addDays = (iso, n) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : new Date(t + n * DAY_MS).toISOString().slice(0, 10); };

// The policy for a receipt's shop, or null. Matched on the shop's own web address (and its sub-addresses, such as
// email.hm.com), only for orders in pounds or from a .uk address.
export function policyFor(retailer, currency) {
  const r = retailer || {};
  const d = String(r.logoDomain || r.domain || "").toLowerCase().replace(/^www\d*\./, "");
  if (!d) return null;
  const p = RETURN_POLICIES.find(x => x.domains.some(k => d === k || d.endsWith("." + k)));
  if (!p) return null;
  return currency === "GBP" || /\.uk$/.test(d) ? p : null;
}

// What the app is told about a policy.
export function policyForApp(p) {
  return { shop: p.shop, days: p.days, from: p.from, most: Boolean(p.most), url: p.url, checked: p.checked,
    ...(p.festive ? { festive: { from: p.festive.bought[0], to: p.festive.bought[1], until: p.festive.until || null, days: p.festive.days || null } } : {}) };
}

// The least the shopper can count on under the policy, for most items. From the day it arrived when the policy counts
// from delivery and Relay knows that day; otherwise from the order date, the earliest that delivery, dispatch or purchase
// can be. A Christmas extension the page dates in full (with the year) gives its own date for orders placed in its dates.
// Always `estimate`: never shown as the order's deadline. Only a date still to come is given.
export function policyReturnBy(o, p, today) {
  const dv = o && o.delivery, arrived = dv && dv.status === "delivered" && dv.at ? dv.at : null;
  const ordered = /^\d{4}-\d{2}-\d{2}$/.test((o && o.orderDate) || "") && o.orderDate <= today ? o.orderDate : null;
  let date = null, from = null;
  if (p.from === "delivery" && arrived) { date = addDays(arrived, p.days); from = "delivery"; }
  else if (ordered) { date = addDays(ordered + "T00:00:00Z", p.days); from = "order"; }
  if (!date) return null;
  // Bought in a Christmas extension's dates: its date is the one to go by. Its pages don't say whether the usual window
  // still applies when that would end later, so the extension's date is the least that's sure. Days in an extension
  // count from the order, the earliest they can start.
  const f = p.festive;
  if (f && ordered && ordered >= f.bought[0] && ordered <= f.bought[1]) {
    const fest = f.until || (f.days ? addDays(ordered + "T00:00:00Z", f.days) : null);
    if (fest) { date = fest; from = "festive"; }
  }
  return date >= today ? { date, basis: "policy", from, estimate: true } : null;
}
