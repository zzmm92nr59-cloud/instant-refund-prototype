// Round 21 (21 Nov 2026): what a receipt is called, and digital purchases that can't be sent back. Connor's Receipts tab
// showed game coins counting down to "Return today", and a billing company's mailbox name as the shop. Every email here is
// MADE UP: shops, sites, games, items, prices, people and numbers.
//  1. Apple's "To cancel your purchase within 14 days of receiving this invoice, report a problem or contact us": the
//     window is read as a window to cancel (cancelWithin), and the email's own link to ask (its "report a problem") is kept
//     as cancelUrl, never as a returns page. The game the coins were bought in is kept with them (the item's variant).
//  2. A billing company's receipt for a membership on a site it names only in "because of your activity on site.example"
//     (its "Website" is only a page's path): the site is the shop.
//  3. One that names no site at all: the billing company is the shop, by its name ("Paybridge"), not its mailbox's
//     ("Paybridge Info").
//   node scripts/test-receipt-real-21.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { rawEmail } from "./fixtures/receipt-emails/lib.mjs";

// 1. Apple: the window to cancel, its link, and the game.
{
  const fx = JSON.parse(readFileSync(new URL("./fixtures/receipt-emails/holdout14a-apple-cancel-within.json", import.meta.url), "utf8"));
  const r = parseReceiptEmail(rawEmail(fx));
  assert.equal(r.returns.cancelWithin, true);
  assert.equal(r.returns.windowDays, 14);
  assert.equal(r.returns.cancelUrl, "https://reportaproblem.apple.com/", "the email's own 'report a problem' link: " + JSON.stringify(r.returns));
  assert.equal(r.returns.portalUrl, null, "never a returns page");
  assert.deepEqual(r.items.map((i) => [i.name, i.variant]), [["Treasure Chest Bundle", "Lantern Isles"]], "the game is kept with what was bought in it");
  console.log("ok - Apple's 14 days to cancel: a window to cancel, with its 'report a problem' link, and the game kept");
}

// A billing company's receipt, as such emails are laid out (one cell to a line).
const biller = (id, site, activity) => ({ id, headers: { from: "Paybridge Info <info@paybridge.example>", to: "sam.taylor@example.co.uk", subject: "Thank you for joining Riverlight's trial fanclub membership", date: "Sun, 15 Nov 2026 16:21:53 +0000" },
  html: "<html><body><table>" + ["Visit paybridge.example", "Thank you for joining Riverlight's fanclub", "Receipt 551122334", "Dear MoonHarbour42,",
    "You've just bought 2-day trial fanclub membership. Find the details of your purchase below.", "Amount paid", "£0.99", "Date", "November 15, 2026", "Payment method", "Card",
    "Username", "MoonHarbour42", "Website", site, "You will be securely billed for a full membership in 2 days. Manage subscription anytime on paybridge.example.",
    "Thank you for using our service.", "We sent you this info to sam.taylor@example.co.uk because of your activity on " + activity + " on November 15, 2026."]
    .map((t) => "<tr><td>" + t.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</td></tr>").join("") + "</table></body></html>" });

// 2. The site named only where the email says why it was sent.
{
  const r = parseReceiptEmail(rawEmail(biller("round21-biller-activity", "/creators/riverlight", "streamvault.example")));
  assert.deepEqual([r.retailer.name, r.retailer.domain], ["Streamvault", "streamvault.example"], "the site is the shop: " + JSON.stringify(r.retailer));
  assert.deepEqual(r.items.map((i) => [i.name, i.pricePence]), [["2-day trial fanclub membership", 99]]);
  assert.equal(r.orderRef, "551122334");
  console.log("ok - a billing company's receipt for a site named in 'because of your activity on …': the site is the shop");
}

// 3. No site named anywhere: the billing company, by its own name.
{
  const r = parseReceiptEmail(rawEmail(biller("round21-biller-nosite", "/creators/riverlight", "/creators/riverlight")));
  assert.equal(r.retailer.name, "Paybridge", "the billing company, not its mailbox: " + JSON.stringify(r.retailer));
  assert.deepEqual(r.items.map((i) => i.name), ["2-day trial fanclub membership"]);
  console.log("ok - no site named: the billing company is the shop by its own name ('Paybridge', not 'Paybridge Info')");
}
console.log("PASS round 21: digital purchases' window to cancel and its link, billing companies' receipts named by the site or by the company");
