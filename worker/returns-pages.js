// Big shops' own UK returns pages, so "Start return" (the app's returnGuide: the shop's page with the order number and email
// ready to copy) is offered when the shop's email had no returns link of its own. Connor, 25 Nov 2026: On's email had none.
//
// Rules (do not weaken):
//  * Only a page found on the shop's own web address (or one the shop's own help page links to), and read there: `checked` is
//    the day it was read and `source` says how. A page that couldn't be found or read for the UK is left out, never guessed.
//  * Only the address. No returns period, fee or policy is kept here: return-policies.js holds the windows that shops state
//    word for word, and Relay never shows a guessed one.
//  * The email's own returns link always wins (it is usually that order's own page). This is only what's used without one.
//  * The shop is matched with confidence: by its own web address (the address itself or one of its sub-addresses, e.g.
//    email.on.com for on.com), or, when the receipt has no web address of the shop's own (it came through PayPal or Klarna),
//    by its whole name exactly. Never part of a name: "On" is not "London", "Onyx" or "Only".
//  * Only for orders in pounds or from a shop's .uk address: the same shops have other pages abroad.
//  * Re-read every few months (scripts/test-returns-pages.mjs fails once `checked` is over 180 days old). A page that has
//    moved is updated; one that can't be found is removed.
import { plain } from "./shop-directory.js";

// source: "read" = the page itself was read; "search" = the page was found on the shop's own address by a web search, with
// its title, but its words couldn't be fetched (the site turns away automated readers); "linked" = the shop's own help page
// names it as where returns are started.
export const RETURNS_PAGES = [
  { shop: "On", names: ["On", "On Running"], domains: ["on.com", "on-running.com"], checked: "2026-11-25", source: "search",
    url: "https://www.on.com/en-gb/returns" },
  { shop: "Nike", names: ["Nike"], domains: ["nike.com"], checked: "2026-11-25", source: "read",
    url: "https://www.nike.com/gb/help/a/how-to-return" },
  { shop: "PUMA", names: ["PUMA", "Puma UK"], domains: ["puma.com"], checked: "2026-11-25", source: "read",
    url: "https://uk.puma.com/uk/en/help/return-policy" },
  { shop: "JD Sports", names: ["JD Sports"], domains: ["jdsports.co.uk"], checked: "2026-11-25", source: "read",
    url: "https://www.jdsports.co.uk/page/faqs/returns-and-refunds" },
  { shop: "M&S", names: ["M&S", "Marks & Spencer", "Marks and Spencer"], domains: ["marksandspencer.com"], checked: "2026-11-25", source: "read",
    url: "https://www.marksandspencer.com/help-and-support/returns-and-refunds" },
  { shop: "John Lewis", names: ["John Lewis", "John Lewis & Partners"], domains: ["johnlewis.com", "johnlewis.co.uk"], checked: "2026-11-25", source: "read",
    url: "https://www.johnlewis.com/customer-services/returns/how-to-return-your-item" },
  { shop: "Next", names: ["Next"], domains: ["next.co.uk"], checked: "2026-11-25", source: "read",
    url: "https://zendesk.next.co.uk/hc/en-gb/articles/4407488442129" },
  { shop: "ASOS", names: ["ASOS"], domains: ["asos.com"], checked: "2026-11-25", source: "read",
    url: "https://www.asos.com/customer-care/returns-refunds/how-do-i-return-something-to-you-from-the-uk" },
  { shop: "Zara", names: ["Zara"], domains: ["zara.com"], checked: "2026-11-25", source: "read",
    url: "https://www.zara.com/uk/en/help-center/HowToReturn" },
  { shop: "Uniqlo", names: ["Uniqlo"], domains: ["uniqlo.com"], checked: "2026-11-25", source: "read",
    url: "https://faq-uk.uniqlo.com/articles/en_US/FAQ/How-do-I-return-my-order" },
  { shop: "COS", names: ["COS"], domains: ["cos.com", "cosstores.com"], checked: "2026-11-25", source: "read",
    url: "https://www.cos.com/en-gb/customer-service/how-to-return-items" },
  { shop: "& Other Stories", names: ["& Other Stories", "Other Stories"], domains: ["stories.com"], checked: "2026-11-25", source: "read",
    url: "https://www.stories.com/en-gb/customer-service/return-refund/" },
  { shop: "Boden", names: ["Boden"], domains: ["boden.com", "boden.co.uk"], checked: "2026-11-25", source: "read",
    url: "https://www.boden.com/pages/returns-and-refunds" },
  { shop: "Mango", names: ["Mango"], domains: ["mango.com"], checked: "2026-11-25", source: "read",
    url: "https://shop.mango.com/gb/en/help/returns/online-returns" },
  // Amazon's help page "Return Items You Ordered" sends shoppers to its Returns Centre.
  { shop: "Amazon", names: ["Amazon", "Amazon.co.uk", "Amazon UK"], domains: ["amazon.co.uk"], checked: "2026-11-25", source: "linked",
    url: "https://www.amazon.co.uk/returns" },
  { shop: "Argos", names: ["Argos"], domains: ["argos.co.uk"], checked: "2026-11-25", source: "read",
    url: "https://help.argos.co.uk/help/refunds-&-returns/how-do-i-return-a-home-delivered-item-or-product-i-collected-in-store" },
  { shop: "Currys", names: ["Currys", "Currys PC World"], domains: ["currys.co.uk"], checked: "2026-11-25", source: "search",
    url: "https://www.currys.co.uk/services/shopping-with-us/returns-faqs.html" },
  { shop: "River Island", names: ["River Island"], domains: ["riverisland.com"], checked: "2026-11-25", source: "read",
    url: "https://www.riverisland.com/how-can-we-help/returns" },
  { shop: "New Look", names: ["New Look"], domains: ["newlook.com"], checked: "2026-11-25", source: "read",
    url: "https://help-uk.newlook.com/hc/en-gb/articles/360015244452-How-to-return-my-order-" },
  { shop: "Selfridges", names: ["Selfridges", "Selfridges & Co"], domains: ["selfridges.com"], checked: "2026-11-25", source: "read",
    url: "https://www.selfridges.com/info/returns/" },
  { shop: "Gymshark", names: ["Gymshark"], domains: ["gymshark.com"], checked: "2026-11-25", source: "read",
    url: "https://support.gymshark.com/en/articles/15069145-how-to-return-an-item-uk" },
  { shop: "Boots", names: ["Boots"], domains: ["boots.com"], checked: "2026-11-25", source: "read",
    url: "https://boots.com/returns-exchange" },
  { shop: "IKEA", names: ["IKEA"], domains: ["ikea.com"], checked: "2026-11-25", source: "read",
    url: "https://www.ikea.com/gb/en/customer-service/returns-claims/returns/" },
  { shop: "Apple", names: ["Apple Store"], domains: ["apple.com"], checked: "2026-11-25", source: "read",
    url: "https://www.apple.com/uk/shop/help/returns_refund" },
  { shop: "Superdrug", names: ["Superdrug"], domains: ["superdrug.com"], checked: "2026-11-25", source: "read",
    url: "https://superdrug.com/returnPolicy" },
];

const NAMES = new Map();
for (const p of RETURNS_PAGES) for (const n of p.names) NAMES.set(plain(n), p);
const cleanDomain = (d) => String(d || "").toLowerCase().replace(/[^a-z0-9.-]/g, "").replace(/^www\d*\./, "").replace(/\.+$/, "");

// The shop's returns page for a receipt's shop, or null. retailer: the receipt's { name, domain } as the receipts list has
// tidied it (domain null when the email came through a payment company). A receipt with a web address of its own is matched
// only by that address: a shop called "Next" on nextlevel.example is not Next.
export function returnsPageFor(retailer, currency) {
  const r = retailer || {};
  const d = cleanDomain(r.domain);
  let p = null;
  if (d) p = RETURNS_PAGES.find((x) => x.domains.some((k) => d === k || d.endsWith("." + k))) || null;
  else for (const n of [r.name, r.legalName]) { const k = plain(n); if (k && NAMES.has(k)) { p = NAMES.get(k); break; } }
  if (!p) return null;
  return currency === "GBP" || /\.uk$/.test(d) ? p : null;
}

// Whether a receipt is one a shop's online returns page is for: bought online, not in a shop (a till receipt, a photo of
// one, or an email the reader marked as from the till) and not something that never goes back.
export function wantsReturnsPage(c) {
  if (!c) return false;
  if (c.inStore || c.photoReceipt || c.source === "receipt_photo") return false;
  // (A return's own emails and things that aren't purchases are not orders to send back.)
  if (c.kind === "return_instructions" || c.kind === "return_update" || c.kind === "not_receipt") return false;
  return true;
}
