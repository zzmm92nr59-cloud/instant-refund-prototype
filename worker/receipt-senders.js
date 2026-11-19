// What a few senders' emails say in their own way, read from their own wording (round 10, 19 Nov 2026: Connor's real
// inbox). Every rule here is a pattern the sender uses for everyone (Uber's "Here's your receipt for", "Thanks for riding",
// Just Eat's "Your East Ocean order will be with you soon", Sainsbury's "Payment received" on the delivery-day email), never
// one person's order numbers or items. Pure functions: no network, no storage.

const MONEY = /£\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})/;
const pence = (m) => (m ? Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]) : null);
const rows = (text) => String(text || "").split("\n").map((x) => x.replace(/^[\s|]+|[\s|]+$/g, "").replace(/\s*\|\s*/g, " | ").trim()).filter(Boolean);
// The amount on a labelled row, "Refund | -£8.76", or on the row under the label.
function labelled(list, re) {
  for (let i = 0; i < list.length; i++) {
    const m = new RegExp("^(?:" + re.source + ")\\s*:?\\s*(?:\\|\\s*)?([-−–]?)\\s*(£\\s?[\\d,]+\\.\\d{2})$", "i").exec(list[i]);
    if (m) return pence(MONEY.exec(m[2]));
    if (new RegExp("^(?:" + re.source + ")\\s*:?$", "i").test(list[i]) && list[i + 1] && /^[-−–]?\s*£\s?[\d,]+\.\d{2}$/.test(list[i + 1])) return pence(MONEY.exec(list[i + 1]));
  }
  return null;
}
const tidyName = (s) => String(s || "").replace(/\s+/g, " ").replace(/[\s.,|]+$/, "").trim();

// ---- Uber and Uber Eats -------------------------------------------------------------------------------------------------
// Uber sends three kinds of email from the same address:
//  * an Uber Eats receipt that doesn't list what was ordered ("Here's your receipt for Popeyes." ... "To view your full
//    receipt go to Uber Eats, or download this PDF"), with "£Y / Uber One savings and other promotions applied" under the
//    total: a saving, never an item;
//  * a ride ("Thanks for riding", "We hope you enjoyed your ride", "Trip fare"): travel, one ride for what was paid. Its fare
//    lines, fees and credits ("Uber pet fee", "Wait Time", "Uber One credits earned") are not things bought;
//  * a changed total for an earlier Eats order ("We adjusted the total for your recent order from Grill & Do", "Previous
//    total", "Refund -£8.76", "New Total"): money back on that order, never a new purchase.
export function uberEmail(domain, subject, text) {
  const t = String(text || "").slice(0, 20000), list = rows(t);
  // (A receipt pasted in has no sender: it is Uber's when it says so itself.)
  if (!/(^|\.)uber\.com$/i.test(domain || "") && !(!domain && /\buber\b/i.test(t.slice(0, 3000) + " " + (subject || "")))) return null;
  const top = t.slice(0, 3000);
  const adj = /\bwe (?:adjusted|have adjusted|(?:'|’)ve adjusted) the total for your (?:recent )?order from ([^\n|]{2,80}?)\s*[.|\n]/i.exec(top);
  if (adj || (/\bprevious total\b/i.test(t) && /\bnew total\b/i.test(t))) {
    return { kind: "adjusted", merchant: adj ? tidyName(adj[1]) : null, refundPence: labelled(list, /refund/), previousPence: labelled(list, /previous total/), newPence: labelled(list, /new total/) };
  }
  if ((/\bthanks for riding\b|\bwe hope you enjoyed your (?:ride|trip)\b|\byour [^\n]{0,30}\btrip with uber\b/i.test(top + "\n" + (subject || "")) && /\btrip fare\b|\bfare\b/i.test(t)) ||
      (/^[\s|]*trip fare\b/im.test(t) && !/\bhere(?:'|’)s your receipt for\b|\buber eats\b/i.test(top))) {
    const pet = /\buber pet\b|\bpet fee\b/i.test(t);
    return { kind: "ride", item: pet ? "Uber Pet ride" : "Uber ride" };
  }
  const rest = /\bhere(?:'|’)s your receipt for ([^\n|]{2,80}?)\s*\.?\s*(?:\||\n|$)/i.exec(top);
  if (rest || /\bto view your full receipt go to uber eats\b/i.test(t)) {
    return { kind: "eats", merchant: rest ? tidyName(rest[1]) : null, noItemList: /\bto view your full receipt\b/i.test(t) };
  }
  return null;
}
// Amounts Uber prints with a line that says what they are, under the total: savings and credits, never items.
export const UBER_MONEY_NOTE = /^(?:uber one (?:savings|credits?)|savings and other promotions|[^|]{0,30}\bpromotions? applied\b|uber one credits earned|credits? earned)/i;

// ---- The restaurant on a takeaway app's order --------------------------------------------------------------------------
// Just Eat: "Your East Ocean order will be with you soon.", "Great news! East Ocean has received your order.", "Your PFC
// Poplar order will be ready soon."; Deliveroo: "Your order from Wagamama"; Uber Eats: "Here's your receipt for Popeyes."
export function takeawayMerchant(shopName, domain, subject, text) {
  const shop = String(shopName || "").toLowerCase(), t = String(text || "").slice(0, 4000);
  const app = /just ?eat/.test(shop) || /(^|\.)just-eat\.(co\.uk|com|ie)$/i.test(domain || "") ? "je"
    : /deliveroo/.test(shop) || /(^|\.)deliveroo\.(co\.uk|com|ie)$/i.test(domain || "") ? "dr"
    : /uber eats/.test(shop) ? "ue" : null;
  if (!app) return null;
  const pats = app === "je" ? [/\byour ([^\n|]{2,60}?) order (?:will be (?:with you|ready)|is being (?:prepped|prepared|made)|has been (?:accepted|received|sent|confirmed)|is on its way|is confirmed)\b/i,
    /\bgreat news!?\s+([^\n|]{2,60}?) has (?:received|accepted) your order\b/i]
    : app === "dr" ? [/\byour order from ([^\n|]{2,60}?)(?:\s+(?:is|has|was)\b|[.!|\n]|$)/im, /\b([^\n|]{2,60}?) (?:has accepted|is preparing|has) your order\b/i]
    : [/\bhere(?:'|’)s your receipt for ([^\n|]{2,80}?)\s*\.?\s*(?:\||\n|$)/i];
  for (const re of pats) {
    const m = re.exec(t) || (app === "dr" ? re.exec(String(subject || "")) : null);
    const name = m && tidyName(m[1]);
    if (name && name.length >= 2 && !/^(?:your|the|this|an?)$/i.test(name) && !/\b(?:order|delivery|courier|driver)\b/i.test(name)) return name;
  }
  return null;
}

// ---- A supermarket's delivery-day email ---------------------------------------------------------------------------------
// Sainsbury's sends the order confirmation first (the items, an estimated total), then on the day "Your order is ready for
// today" with "Payment received: £99.40", only the substitutions and short-life items, and the full receipt as a PDF. That
// second email is the same order, with what was actually paid: it joins the confirmation (gmail.js mergeOrderEmails), and is
// never a second purchase whose items are only its substitutions.
export function groceryDayOf(text) {
  const t = String(text || "").slice(0, 20000);
  if (!/\byour order is ready for today\b|\bwe(?:'|’)ve picked your items\b/i.test(t)) return null;
  const paid = /\bpayment (?:received|taken)\s*:?\s*\|?\s*(£\s?[\d,]+\.\d{2})/i.exec(t);
  if (!paid) return null;
  const ref = /\border (?:number|no\.?)\s*:?\s*\|?\s*(\d{6,14})\b/i.exec(t);
  return { paidPence: pence(MONEY.exec(paid[1])), orderRef: ref ? ref[1] : null };
}

// What the shop swapped on the day ("Substitutions (1)", then "Truffle Burrata 125g | at a quantity of 1 | £2.55 |",
// "Substituted with", "Italian Burrata 150g | at a quantity of 1 | £3.20 |"): each item ordered and what came instead, so
// the order's card can show what was actually delivered and paid for (gmail.js mergeOrderEmails). Round 12.
const SUB_ITEM = /^(\p{L}[^|£]{2,150}?)\s*\|\s*(?:(?:at a )?(?:qty|quantity)(?: of)?\s*:?\s*)?(\d{1,3})\s*\|\s*(£\s?[\d,]+\.\d{2})\s*\|?$/iu;
export function grocerySubstitutions(text) {
  const list = rows(String(text || "").slice(0, 30000));
  const out = [];
  for (let k = 0; k + 1 < list.length && out.length < 60; k++) {
    if (!/^(?:substituted|replaced|swapped) (?:with|by|for)\s*:?$/i.test(list[k])) continue;
    const a = SUB_ITEM.exec(list[k - 1] || ""), b = SUB_ITEM.exec(list[k + 1] || "");
    if (!a || !b) continue;
    out.push({ from: a[1].trim(), to: { name: b[1].trim(), qty: Number(b[2]), pricePence: pence(MONEY.exec(b[3])) } });
  }
  return out;
}

// A changed order ("We got your changes", "You've amended your order", "Your order has been updated"): the shop's whole new
// list and estimated total for the order it names. The latest one is the order (gmail.js mergeOrderEmails), never a second
// purchase. Round 12.
export function orderAmended(subject, text) {
  const t = String(subject || "") + "\n" + String(text || "").slice(0, 3000).replace(/\s+/g, " ");
  return /\bwe(?:'|’)?ve? got your changes\b|\byou(?:'|’)?ve (?:amended|changed|edited) your order\b|\byour order (?:has been|was) (?:amended|updated|changed)\b|\bchanges to your order (?:have been|are) (?:saved|confirmed)\b|^\s*(?:order amended|amended order)\b/i.test(t);
}

// Money back a shop's support team wrote out in a reply about an order ("I have processed a partial refund of £11.46 back to
// your original payment card", "we refunded you £4.99 on 31/08/25", "We've added a £3.99 credit to your account"): what
// came back and which order numbers the email names (the one the sentence names first, then the subject's). Only said
// as done; a refusal ("we're unable to refund") says nothing. Round 12.
const AMT = "£\\s?(\\d{1,3}(?:,\\d{3})+|\\d+)\\.(\\d{2})";
export function supportRefund(subject, text) {
  const t = String(text || "").slice(0, 8000).replace(/\*\*/g, "").replace(/\s+/g, " ");
  const one = (res) => { for (const re of res) { const m = new RegExp(re, "i").exec(t); if (m) return Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]); } return null; };
  const refundPence = one([
    "\\b(?:processed|issued|sent|given you|arranged|approved) (?:you )?an? (?:partial |full |further )?refund of " + AMT,
    "\\bwe(?:'|’)?(?:ve| have)? refunded (?:you |your (?:card|account|original payment method) )?(?:with )?" + AMT,
    "\\ban? (?:partial |full )?refund of " + AMT + " (?:has been|was|is being) (?:processed|issued|sent|made)\\b"]);
  const creditPence = one(["\\b(?:we(?:'|’)?(?:ve| have) )?added an? " + AMT + " credit to your\\b", "\\b" + AMT + " (?:of )?(?:account )?credit (?:has been|was) added\\b"]);
  if (refundPence == null && creditPence == null) return null;
  const refs = [];
  for (const src of [t, String(subject || "")]) for (const m of src.matchAll(/\border\s*(?:number|no\.?|id)?\s*[:#]?\s*#?\s*(\d{6,14})\b/gi)) if (!refs.includes(m[1])) refs.push(m[1]);
  return { refundPence, creditPence, refs };
}

// A payment service's "You've authorised £38.00 GBP to We Love Holidays Lim..." (money taken for a booking paid in parts:
// a deposit, then instalments): one payment towards a purchase made with the shop, never a purchase of its own. What was
// paid, to whom, on which day and the payment's own order number. Round 12.
export function paymentAuthorised(subject, text) {
  const t = String(text || "").slice(0, 6000);
  const m = /\byou(?:'|’)?ve authori[sz]ed (£\s?[\d,]+\.\d{2})(?: GBP)? to ([^\n|]{2,60}?)(?:\.{3}|…)?\s*(?:\n|\||$)/i.exec(t);
  if (!m) return null;
  const list = rows(t);
  const after = (re) => { const i = list.findIndex((x) => re.test(x)); return i >= 0 ? (list[i].replace(re, "").trim() || list[i + 1] || "") : ""; };
  const ref = /^[A-Z0-9-]{6,30}$/i.exec(after(/^order id\s*:?/i));
  return { amountPence: pence(MONEY.exec(m[1])), merchant: m[2].replace(/(?:\.{2,}|…)$/, "").trim(), orderRef: ref ? ref[0] : null, on: after(/^transaction date\s*:?/i) || null };
}

// ---- A game's web shop (Appcharge, Xsolla) --------------------------------------------------------------------------------
// "Items" then each thing in the pack with how many ("Mixy Meow | 1", "Checkerboard | 10", "Coins | 4,500"), then the
// subtotal: one purchase of the whole pack, named by what is in it ("Mixy Meow, 10 Checkerboard", "2,200 Coins").
export function gameBundle(text) {
  const list = rows(text);
  const i = list.findIndex((c) => /^items?$/i.test(c));
  if (i < 0) return null;
  const parts = [];
  for (let k = i + 1; k < list.length && k < i + 40; k++) {
    const r = list[k];
    if (/^(?:sub-?\s?total|total|tax|vat)\b/i.test(r)) break;
    // (How many, as "6,000" or "x 15". Round 12.)
    let m = /^(\p{L}[\p{L}\d '’&.-]{1,40}?) \| (?:x\s?)?(\d{1,3}(?:,\d{3})*|\d{1,7})$/u.exec(r);
    const next = /^(?:x\s?)?(\d{1,3}(?:,\d{3})*|\d{1,7})$/i.exec(list[k + 1] || "");
    if (!m && /^\p{L}[\p{L}\d '’&.-]{1,40}$/u.test(r) && next) { m = [null, r, next[1]]; k++; }
    // (Whatever follows the list ends it: the pack is what was read so far. A list of objects was once returned here, and
    // read as an item named "[object Object]". Round 12.)
    if (!m) break;
    parts.push({ name: m[1].trim(), amount: m[2] });
  }
  if (!parts.length) return null;
  return parts.map((p) => (p.amount === "1" ? p.name : p.amount + " " + p.name)).join(", ");
}
